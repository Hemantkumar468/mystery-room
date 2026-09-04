# WhatsApp — Ideas and Open Questions

Companion to [WHATSAPP_SETTINGS_SPEC.md](WHATSAPP_SETTINGS_SPEC.md). That file is the agreed build. This one is everything **not** yet decided — ideas worth doing later, traps worth avoiding, and questions someone has to answer before the system grows.

Nothing here is committed. Treat each item as a proposal.

---

## 1. Ideas worth building after v1

### 1.1 Two-way replies — "Mark as done" from WhatsApp

Today the doer reads the message and then opens the ERP. With reply buttons on the message, they could update the task without leaving WhatsApp.

Needs an inbound webhook, which SmartWhap may or may not support (open question 5.1). Also needs a state machine: which button belongs to which task, what happens on a stale tap, what happens when someone replies with free text instead.

**Recommendation:** do not attempt in v1. One-way notification first — it is 80% of the value at 20% of the complexity. Revisit once delivery is proven stable for a month.

### 1.2 Daily digest instead of message-per-event

A doer with seven tasks moving in a day should not get seven WhatsApp messages. One morning digest — *"You have 7 open tasks, 2 due today, 1 overdue"* — respects the person and protects the number's quality rating.

The `daily_task_digest` template already exists in the plan. What is missing is the rule for **which events collapse into the digest** and which stay immediate:

| Immediate | Digest |
|---|---|
| New task assigned | Reminders |
| Overdue escalation to manager | Status changes |
| Approval blocking someone | Phase started |

### 1.3 Escalation ladder

Currently: overdue → doer, and after N days → manager. A fuller ladder is more useful and needs no new templates, only different recipients:

```
Day 0 overdue    → doer
Day 3 overdue    → doer + reporting manager
Day 7 overdue    → manager + MD
Day 14 overdue   → MD only, weekly, doer left alone
```

Stopping messages to the doer after day 7 matters. Someone who has ignored six reminders will not act on the seventh — they will block the number.

### 1.4 Signed deep links

`{{6}}` currently points at a plain ERP URL, so the doer lands on the login screen and often gives up. A short-lived signed token in the link (valid ~24 hours, single task scope) would take them straight to the task.

This is a genuine security decision — a link in WhatsApp can be forwarded — so it needs its own review. Scope the token to one task, read-plus-status-update only, never account-wide.

### 1.5 Hindi templates

Site staff and vendor coordinators may read Hindi more comfortably than English. WhatsApp treats each language as a separate template under the same name, so `pms_task_assigned` can exist in both `en` and `hi`.

Add a `preferredLanguage` field on the user and pick the template language from it at send time. Worth doing when the doer list grows beyond head office.

### 1.6 Delivery health monitoring

A silent drop in delivery rate is the failure mode nobody notices. Suggested alert: if the failure rate over the last 100 messages exceeds 20%, notify the MD in-app.

Common causes, all worth catching early: the number's quality rating dropped, a template got paused, the plan's message quota ran out, or a bulk of stale phone numbers entered the system.

### 1.7 Per-user notification preferences

Let each employee choose in their profile: all notifications / only assignments and overdue / digest only / off. This reduces blocks and is expected in any serious HR-facing system. Cheap to build, and it becomes essential once HRMS goes live.

---

## 2. Extending beyond PMS

The same channel serves every future module. Roughly what each one needs:

| Module | Templates | Notes |
|---|---|---|
| **Document expiry** (LOI, agreements) | `pms_document_expiry` | One template covers 30-day / 7-day / tomorrow / expired via the alert-text variable |
| **HRMS — recruitment** | `hrms_application_received`, `hrms_candidate_status`, `hrms_interview_scheduled` | `candidate_status` covers shortlisted / on hold / not selected in one template |
| **HRMS — onboarding** | `hrms_document_request` | Joining document checklist |
| **Leave** | `leave_status_update`, `leave_request_pending` | Approved / rejected in one; manager reminder in the other |
| **Payroll** | `payroll_salary_processed` | See the warning in 3.3 |

**Naming convention, decide now:** `module_event` — `pms_task_assigned`, `hrms_interview_scheduled`, `leave_status_update`. With 40+ templates coming, an unprefixed list becomes unreadable.

**Category rule:** everything is UTILITY. The one exception to watch is recruitment outreach to people who never applied — that is MARKETING and will be throttled.

---

## 3. Traps to avoid

### 3.1 One template per scenario

The instinct is a new template for every situation, which ends in 50 templates, an unmanageable config, and a delay for approval on every small change.

Ask first: *can an existing template carry this by changing a variable?* One `pms_task_reminder` handles "3 days left", "due today" and "overdue by 5 days" purely through `{{5}}`.

### 3.2 Treating `sent` as success

Every failure in testing returned HTTP `201` with `status: "sent"`. Delivery is a separate step that happens later. Any dashboard, report or "notified on" column built on the send response will lie.

### 3.3 Sensitive data in messages

Never put salary amounts, bank details, PAN, or performance ratings in a WhatsApp message. A phone gets handed to a family member, screenshots get forwarded, and the message sits unencrypted in backups.

Correct pattern: *"Your salary for August 2026 has been processed. Please check the ERP portal for details."*

### 3.4 Ignoring the quality rating

Meta scores the number on how people react. Enough blocks or reports and messaging limits drop, then messaging stops. This is not recoverable in a day.

Protection: daily caps, quiet hours, digests, an opt-out, and never sending a doer more than a few messages a day.

### 3.5 No test path

Sending real messages to real employees to test a change is how staff lose trust in the system. Keep one dedicated test number in the settings, and have a "test mode" that routes every message to it regardless of recipient.

---

## 4. Cost

Each 24-hour conversation is billed once, not each message — so ten messages to one person in a day cost roughly the same as one, provided they fall in the same window. That argues for immediate notifications *and* against spreading them thinly across the day for no reason.

Before rollout, work out: doers × events per day × working days, then confirm the UTILITY conversation rate with SmartWhap. Add a monthly volume tile to the settings page so the bill never arrives as a surprise.

---

## 5. Open questions

| # | Question | Ask | Blocks |
|---|---|---|---|
| 5.1 | Does SmartWhap support inbound webhooks for status and replies? | SmartWhap | Two-way replies (1.1); status polling can be replaced |
| 5.2 | Can the token get `account:read`, and a template-write scope? | SmartWhap | Plan/quota display; template creation from ERP |
| 5.3 | Is their `POST /whatsapp-template` planned for deployment? | SmartWhap | Creating templates from the settings page |
| 5.4 | What is the per-conversation UTILITY rate on our plan? | SmartWhap | Cost forecast |
| 5.5 | What is the current messaging tier (250 / 1000 / unlimited unique users per day)? | SmartWhap | Rollout size |
| 5.6 | Public ERP base URL for deep links? | Internal | Template variable `{{6}}` |
| 5.7 | Who owns the doer phone-number data and keeps it current? | Internal | Delivery rate |
| 5.8 | Should candidates and vendors get messages, or only employees? | Internal | HRMS scope, opt-in rules |

---

## 6. Suggested order

1. **v1** — task assigned, reminder, overdue, completed; one-way only; settings page (the spec)
2. **v1.1** — daily digest, per-user preferences, delivery health alert
3. **v1.2** — document expiry alerts (reuses everything)
4. **v2** — HRMS and Leave templates on the same channel
5. **v3** — two-way replies, signed deep links, Hindi templates

Steps 2 and 3 add real value for very little work, because the channel, queue, logging and settings page already exist by then. Step 5 is a project of its own — plan it separately rather than sliding it into a sprint.
