# Feature spec — Approvals Queue

**Module:** PMS
**Status:** Ready to build
**Depends on:** existing `Record`, `Task`, `Project`, `User` models

Read this file top to bottom before writing code. It is written to be executed
without further clarification. Where a decision is left open it is marked
**DECIDE** and must be raised before that section is built — do not guess.

Conventions in this repo that this spec assumes you follow:

- Every branch-on string lives in `server/src/core/constants/index.js`. Add there first.
- Every route is validated by `validate(schema)` (Zod) before reaching a service.
- Import `config`, never `process.env`.
- Client data layer is RTK Query, one `baseApi`, endpoints injected per domain.
- All label/colour maps live in `client/src/lib/ui.js`. Never hardcode a status colour.
- `decisionHistory` is append-only. Never overwrite, never delete an entry.
- Terminal statuses are one-way. Preserve the `TERMINAL_STATUSES` guard.

---

## 1. Why this exists

At time of writing 246 records sit in `submitted`, 238 older than a week. The
cause is structural, not behavioural:

1. An approver must navigate project → phase → record to act on one item.
2. There is no way to act on more than one item at a time.
3. Every approval routes to `admin` or `manager` because no other role can decide.
4. Routine and exceptional items are indistinguishable, so everything waits for a human.
5. `slaDays` exists on stages but nothing happens when it is breached.

This feature fixes all five. Success is measured by one number: **items older
than 7 days in a pending state**. Target is under 10 at any time.

---

## 2. Scope

### In scope

- A single queue showing every item awaiting the current user's decision
- Inline decision without leaving the queue
- Bulk approve and bulk reject
- Auto-approval rules, configurable by admin, no deploy required
- Delegation for a date range
- SLA escalation with notification
- Full audit trail of every decision, including auto-decisions
- Mobile layout for the same queue

### Out of scope — quote separately if requested

Listed here so it can be pointed at during UAT.

| Not building | Why |
|---|---|
| Multi-step approval chain editor (visual builder) | Rules engine covers the need; a builder is its own project |
| Approval via email reply | Requires inbound mail parsing infrastructure |
| WhatsApp approve/reject buttons | Requires WhatsApp Business API onboarding, separate commercial decision |
| Conditional routing by monetary value beyond the rule fields listed in §5 | Extend the rule schema later |
| Approval analytics dashboard (time-to-decide charts) | Belongs to MIS module |
| Offline approvals | No offline layer exists in the client |
| E-signature / DSC on approval | Legal requirement not yet confirmed by client |
| Comments threaded per decision | Single reason field per decision only |

---

## 3. Vocabulary fix — do this first

Three labels currently lie about DB values (`submitted` → "Under Review",
`todo` → "Assigned", `done` → "Completed"). Do not add a fourth. Before
building the queue, run a migration so DB values match spoken language.

Add to `server/src/seed/` as `migrate-status-vocabulary.mjs`:

| collection | from | to |
|---|---|---|
| records | `submitted` | `under_review` |
| tasks | `todo` | `assigned` |
| tasks | `done` | `completed` |

Update `RECORD_STATUS` and `TASK_STATUS` in constants, update every comparison,
update `lib/ui.js` meta maps, remove the three label overrides. Run
`npm test -w server` after.

Do this now, with four demo users and junk seed data. It becomes unaffordable
after real projects exist.

**Also introduce a single user-facing status vocabulary.** Internally you keep
nine task statuses; the UI shows four buckets. Add to `lib/ui.js`:

```js
export const WORK_BUCKET = {
  ASSIGNED:  'assigned',   // assigned
  DOING:     'doing',      // in_progress
  WAITING:   'waiting',    // blocked, review, waiting_approval,
                           // waiting_management_approval
  COMPLETED: 'completed',  // completed, approved
};
```

`rejected` is not a bucket — a rejected item returns to `assigned` with the
rejection reason shown on the card. A user should never see a status that
tells them they failed with no next step.

---

## 4. Data model

### 4.1 New: `Approval`

A pointer, not a copy. Do not duplicate record or task data into it — it goes
stale and creates two sources of truth.

`server/src/modules/pms/approvals/approval.model.js`

| field | type | note |
|---|---|---|
| `subjectType` | enum `record` \| `task` | which collection `subjectId` points at |
| `subjectId` | ObjectId | indexed |
| `projectId` | ObjectId | denormalised for scope filtering, indexed |
| `stageKey` | string | denormalised, for grouping |
| `tier` | string | see `APPROVAL_TIERS` below |
| `status` | enum | `pending` \| `approved` \| `rejected` \| `withdrawn` \| `superseded` |
| `assignedRole` | string | role that may decide |
| `assignedDepartment` | string | nullable; department scope |
| `assignedUserId` | ObjectId | nullable; when routed to a named person |
| `decidedBy` | ObjectId | nullable |
| `decidedOnBehalfOf` | ObjectId | nullable — set when a delegate acted |
| `decidedAt` | Date | nullable |
| `decisionReason` | string | required on reject, optional on approve |
| `autoDecided` | Boolean | default false |
| `autoRuleId` | ObjectId | nullable — which rule fired |
| `dueAt` | Date | computed from stage `slaDays` |
| `escalatedAt` | Date | nullable |
| `escalatedToUserId` | ObjectId | nullable |
| `createdAt` / `updatedAt` | Date | |

Compound index: `{ status: 1, assignedRole: 1, assignedDepartment: 1, dueAt: 1 }`.
This is the queue's primary read path — verify with `.explain()` that the queue
list query uses it before merging.

**`withdrawn`** — the submitter cancelled before a decision.
**`superseded`** — the underlying record was edited and resubmitted; the old
approval is closed and a new one opened. Never leave two pending approvals on
one subject.

### 4.2 New: `ApprovalRule`

`server/src/modules/pms/approvals/approvalRule.model.js`

| field | type | note |
|---|---|---|
| `name` | string | shown in audit: "auto-approved by rule: Small NOC" |
| `enabled` | Boolean | default true |
| `priority` | number | lower runs first; first match wins |
| `scope` | object | `{ stageKeys[], assessmentTypes[], departments[], projectIds[] }`, empty array means "any" |
| `conditions` | array | see below |
| `action` | enum `auto_approve` \| `auto_route` \| `require_extra_tier` | |
| `routeToRole` / `routeToDepartment` / `routeToUserId` | | used by `auto_route` |
| `createdBy` / `updatedBy` | ObjectId | |

A condition is `{ field, operator, value }` where `field` is a dotted path into
the subject's `values` object (e.g. `values.depositAmount`), and `operator` is
one of `eq, neq, lt, lte, gt, gte, in, nin, exists, notExists, contains`.

All conditions in a rule are ANDed. For OR, create two rules. This is a
deliberate constraint — an admin can reason about AND; nested boolean logic in
a UI is where these features become unusable.

**Hard requirement:** rules never auto-*reject*. A rule may approve, route, or
add a tier. Automatic rejection destroys trust in the system the first time it
misfires and is not recoverable by an apology.

### 4.3 New: `Delegation`

| field | type |
|---|---|
| `fromUserId` | ObjectId |
| `toUserId` | ObjectId |
| `startsAt` / `endsAt` | Date |
| `scope` | `all` \| array of `projectIds` |
| `active` | Boolean (derived from dates, but stored for query simplicity) |

A delegate acting on an approval sets `decidedBy = delegate` and
`decidedOnBehalfOf = original`. Both names appear in the audit line. A
delegation may not be chained — if the delegate is themselves out, the
original user must appoint someone else. Reject chained delegation at
validation with a clear message.

### 4.4 Changes to existing models

**Stage (in template and project snapshot):** add `approvalTiers: [String]`.
This moves the p7 six-tier chain out of code and into template data. Existing
gate branches in `project.service.js#completeStage` stay for now; a follow-up
migration moves them.

**Record / Task:** no schema change. `decisionHistory` on Record remains the
canonical per-record history and must continue to be appended on every
decision, including auto-decisions.

### 4.5 Constants to add

```js
export const APPROVAL_STATUS = {
  PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn', SUPERSEDED: 'superseded',
};

export const APPROVAL_TIERS = {
  DEPARTMENT: 'department_review',
  FUNCTIONAL:  'functional_review',
  FINANCE:     'finance_approval',
  LEGAL:       'legal_review',
  MANAGEMENT:  'management_approval',
  FINAL:       'final_approval',
};

export const APPROVAL_RULE_ACTION = { ... };
export const APPROVAL_CONDITION_OPERATOR = { ... };
```

---

## 5. Rules engine

`server/src/modules/pms/approvals/approvalRule.service.js`

Evaluation happens once, at approval creation:

1. Load enabled rules whose `scope` matches the subject, sorted by `priority`.
2. Evaluate conditions against the subject document.
3. First match wins. Apply its action. Stop.
4. No match → create a normal pending approval routed by tier defaults.

If `auto_approve` fires: create the Approval already in `approved` state with
`autoDecided: true` and `autoRuleId` set, append to `decisionHistory`, write an
Activity row, and advance the subject exactly as a human approval would. **Do
not skip the state transition** — the rest of the system must not be able to
tell the difference.

Rule evaluation must be pure and synchronous. No network calls, no AI. If a
rule throws, log it, disable nothing, and fall through to a human approval.
A broken rule must never block work.

### Admin screen for rules

Non-technical admins must be able to write these. The editor is a sentence
builder, not JSON:

> When stage is `[Commercial Finalization ▾]` and `[Deposit Amount ▾]` is
> `[less than ▾]` `[50,000]` then `[auto-approve ▾]`

Below the builder, always show **"This rule would have matched 34 of the last
200 records"** computed live against historical data. Without that preview an
admin cannot judge whether a rule is safe, and will not enable any of them.

Every rule change writes an Activity row naming the user and the diff.

---

## 6. API

Add `server/src/modules/pms/approvals/` following the existing module shape:
`approval.model.js`, `approval.routes.js`, `approval.controller.js`,
`approval.service.js`, `approval.validation.js`.

Register in `pms.routes.js` at `/pms/approvals`.

```
GET    /pms/approvals                 queue for current user
GET    /pms/approvals/count           badge count, cheap, no population
GET    /pms/approvals/:id             single, with full subject populated
POST   /pms/approvals/:id/decide      { decision, reason }
POST   /pms/approvals/bulk-decide     { ids[], decision, reason }
POST   /pms/approvals/:id/withdraw    submitter only
GET    /pms/approvals/rules           admin
POST   /pms/approvals/rules           admin
PATCH  /pms/approvals/rules/:id       admin
POST   /pms/approvals/rules/preview   { rule } → { matched, total, samples[] }
GET    /pms/delegations               own + received
POST   /pms/delegations               create
DELETE /pms/delegations/:id           revoke
```

**Query params on the queue list:** `page`, `limit`, `sort` (default `dueAt: 1`
— oldest first, this is the whole point), `projectId`, `stageKey`,
`subjectType`, `tier`, `overdue` (bool), `search`.

Response shape follows the existing convention:
`{ success, data, meta: { page, limit, total, totalPages, hasNextPage, hasPrevPage } }`.

### Bulk decide semantics

This is where bugs will live. Specify precisely:

- Maximum 100 ids per call. Reject 101 with `400 BULK_LIMIT_EXCEEDED`.
- Process each independently. **Partial success is the expected outcome**, not
  an error.
- Response: `{ succeeded: [ids], failed: [{ id, code, message }] }` with HTTP 200
  even when some fail.
- Never wrap the whole batch in one transaction. One bad record must not roll
  back 99 good decisions.
- Bulk reject **requires** a reason. Bulk approve does not.
- The reason applies to all items in the batch; the UI must say so explicitly.

### Error codes

Return machine codes alongside human messages, matching the existing
`APPROVAL_OUT_OF_ORDER` precedent:

| code | when |
|---|---|
| `APPROVAL_NOT_PENDING` | already decided by someone else |
| `APPROVAL_NOT_YOURS` | outside the user's role/department/project scope |
| `APPROVAL_OUT_OF_ORDER` | an earlier tier is still pending |
| `APPROVAL_SUBJECT_CHANGED` | subject `updatedAt` newer than approval `createdAt` |
| `APPROVAL_PROJECT_TERMINAL` | project is `store_live` or `archived` |
| `REASON_REQUIRED` | reject without reason |
| `BULK_LIMIT_EXCEEDED` | more than 100 ids |
| `DELEGATION_CHAIN` | delegating to someone who is themselves delegating |

---

## 7. Screen — desktop

Route `/approvals`. Sidebar item second from top with a count badge.

**Three-pane layout.** Filters left (220px), list centre (flexible), detail
right (420px). The detail pane is the critical part: the approver must see
enough to decide without navigating away. If they have to click into the
project, this feature has failed and the backlog returns.

**Left — filters.** Everything, Overdue, Due today, By project, By stage, By
type. Each with a live count. "Overdue" is selected by default on first load.

**Centre — list.** One row per item, sorted oldest first:

- Checkbox (bulk select)
- Subject title, and beneath it: project name · stage name · submitter name
- Age chip — grey under 3 days, amber 3–7, red over 7
- Tier label if the stage has more than one tier
- Rows are keyboard navigable

Select-all selects the **filtered set**, not the page. When more than one page
is selected show "All 47 selected" with an explicit "select only this page"
escape. Ambiguity here causes accidental mass approvals.

**Right — detail.** Full form values in read-only layout, grouped by the
schema's `section`. Attachments viewable inline — images and PDFs render in
place, never force a download to make a decision. Below that, the record's
`decisionHistory` as a timeline. At the bottom, fixed: Approve, Reject, and
a reason field.

**Keyboard shortcuts** — mandatory, not a nice-to-have. `j`/`k` move,
`a` approve, `r` reject, `x` select, `Enter` open, `?` shows the map.
A user clearing 60 items with a mouse will stop at 20.

**After a decision**, advance to the next item automatically and show an undo
toast for 8 seconds. Undo is a real state transition — a `withdrawn` decision
plus a new pending approval, both in history. Never a silent delete.

---

## 8. Screen — mobile

Same route, single column. The detail is a full-screen sheet, not a pane.

- Cards, not rows. Title, project, age chip, one-line summary.
- Tap opens the sheet. Approve and Reject are a fixed bottom bar, thumb height.
- Swipe right to approve, left to reject — with undo toast. Swipe is optional
  polish; the buttons are mandatory.
- **No bulk mode on mobile.** Multi-select with a thumb causes mistakes. This
  is a deliberate omission, record it in the out-of-scope list.

---

## 9. States — build all of these

Missing states are where "you didn't implement this" comes from. Every one
below must exist before the feature is called done.

| state | what shows |
|---|---|
| Loading | Skeleton rows, not a spinner. Reuse `components/ui/Skeletons`. |
| Empty — nothing pending | "Nothing waiting on you." Plus a link to what they approved recently. |
| Empty — filter matched nothing | "No overdue items. Clear filters." with a clear button. |
| Error — list failed | Inline message plus retry. Never a blank page. |
| Error — decision failed | Toast with the human message, item stays selected, no optimistic state left behind. |
| Already decided by another user | Row greys out live, detail pane shows who decided and when. |
| Subject deleted while queue open | Row shows "No longer available", decision buttons disabled. |
| Permission revoked mid-session | Next action returns `APPROVAL_NOT_YOURS`; redirect to queue with an explanation. |
| Project went terminal | Item auto-`superseded`, shown greyed with reason. |
| Offline | Banner. Disable decision buttons. Do not queue actions locally. |
| Rejected item, submitter's view | Rejection reason on the card, item back in their work list. |

---

## 10. Notifications

Every notification must deep-link to the specific approval, not to the queue.

| trigger | to | channel |
|---|---|---|
| Approval created | assigned role/dept/user | in-app + digest |
| Decision made | submitter | in-app |
| Rejected | submitter | in-app + push |
| 75% of SLA elapsed | assignee | in-app |
| SLA breached | assignee + their manager | in-app + push |
| Escalated | new assignee + original | in-app + push |
| Delegation starts / ends | both users | in-app |

**Digest, not per-item.** One summary at 9am — "8 approvals waiting, 3
overdue" — plus immediate alerts only for overdue and rejection. Per-item
notification at this volume trains people to ignore all notifications, which
is how you got a 246-item backlog in the first place.

**DECIDE:** WhatsApp channel. Out of scope for this build but design the
notification service with a pluggable channel interface so adding it later is
one adapter, not a refactor.

---

## 11. Escalation

A scheduled job, hourly. `server/src/jobs/approvalEscalation.job.js`.

1. Find pending approvals past `dueAt` and not yet escalated.
2. Set `escalatedAt`, set `escalatedToUserId` to the assignee's manager.
3. Widen `assignedUserId` so both the original and the escalation target can decide.
4. Notify both.
5. Write an Activity row.

**Escalation widens, never transfers.** Removing the original assignee's
ability to act creates a second bottleneck and destroys their ownership.

Escalate once. A second breach notifies again but does not escalate further —
infinite escalation chains end at the MD and defeat the purpose.

---

## 12. Audit

Every decision writes an Activity row. Nothing in this feature may mutate state
without one. Each row records: who, on behalf of whom, what, which subject,
which rule if automatic, the reason, and the timestamp.

The audit view must be **exportable to CSV**, filtered by date range and
project. Ask any client about compliance and this is the first thing they ask
for; building it now costs an afternoon.

`decisionHistory` on the Record stays append-only. Undo appends; it does not
remove.

---

## 13. Permissions

Do not check roles in route guards for this module. Check permissions.

Add `server/src/core/permissions/` with a `can(user, permission, resource)`
helper. Permissions used here:

`approval.view` · `approval.decide` · `approval.bulk_decide` ·
`approval.rule.manage` · `approval.delegate` · `approval.audit.export`

`can()` returns true only when **all three** hold:

1. The user's roles grant the permission.
2. The resource's project is in the user's project scope (or the user has
   global scope).
3. The resource's department matches the user's department scope, where the
   permission is department-scoped.

Seed role → permission mappings, do not hardcode them. `manager` today holds
`approval.decide` for their own projects only — this closes the existing hole
where any manager can approve any project's work.

---

## 14. Test checklist

`npm test -w server`. A green run must cover every line below.

**Concurrency**
- Two approvers decide the same item simultaneously → one succeeds, one gets `APPROVAL_NOT_PENDING`. No double state transition.
- Bulk decide overlapping sets from two users → each item transitions exactly once.

**Ordering**
- Deciding tier 3 while tier 2 pending → `APPROVAL_OUT_OF_ORDER`.
- Tier 2 rejected → tiers 3-6 are `superseded`, not left pending.

**Bulk**
- 100 ids succeeds; 101 rejected.
- 50 valid + 50 already-decided → 200 with 50 succeeded, 50 failed.
- Bulk reject without reason → 400.

**Rules**
- Two rules match → lower `priority` wins, other does not fire.
- Rule throws → falls through to human approval, error logged, nothing blocked.
- `auto_approve` produces identical downstream state to a human approval.
- Disabling a rule does not retroactively change past decisions.

**Delegation**
- Delegate decides → `decidedBy` and `decidedOnBehalfOf` both set.
- Delegation expires mid-session → next decision fails cleanly.
- Chained delegation rejected with `DELEGATION_CHAIN`.

**Terminal states**
- Project goes `store_live` with pending approvals → they become `superseded`.
- No approval can transition a subject in an `archived` project.
- `recompute()` after bulk approve does not downgrade a terminal status.

**Scope**
- Manager on project A cannot see or decide project B's approvals — verify on both the list endpoint and the direct `:id` fetch.
- Department-scoped approval invisible to another department.

**Undo**
- Undo within window restores pending, appends two history entries, leaves no orphan.
- Undo after the subject advanced → fails with a clear message.

**Data integrity**
- Subject edited after approval created → `APPROVAL_SUBJECT_CHANGED`.
- Subject deleted → approval `superseded`, queue does not crash.
- No subject ever holds two `pending` approvals for the same tier.

**Performance**
- Queue list with 5,000 pending approvals returns under 300ms. Confirm the compound index is used via `.explain()`.
- Count endpoint under 50ms.

---

## 15. Definition of done

Not done until all of these are true:

- [ ] Status vocabulary migration run, three label lies removed
- [ ] All endpoints in §6 implemented, Zod-validated, returning documented error codes
- [ ] Every state in §9 implemented and visually verified
- [ ] Keyboard shortcuts working, `?` overlay present
- [ ] Rule admin screen with live match preview
- [ ] Escalation job running and verified against a seeded overdue item
- [ ] Audit CSV export working
- [ ] Mobile layout verified on a 360px viewport
- [ ] Every test in §14 passing
- [ ] Backlog cleared: seed data reduced to under 10 items older than 7 days
- [ ] Demo script written: 10 approvals cleared in under 60 seconds

That last line is the client demo. If it cannot be done in 60 seconds, the
feature is not finished regardless of what else passes.
