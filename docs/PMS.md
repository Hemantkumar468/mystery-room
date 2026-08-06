# System reference — PMS (Project Management System)

**Module:** PMS · Module 1 of the Mystery Rooms ERP
**Status:** In production use
**Depends on:** `User` (auth module). Depended on by AI (Module 2) and EMS (Module 3).

Read this file top to bottom before writing code against the PMS. It is written
to be executed without further clarification: every number in it was read out of
the running system, not estimated. Where a value is environment-specific it says
so.

This is a **reference**, not a build spec. For the one feature currently
specified but not built, see
[APPROVALS_QUEUE_SPEC.md](APPROVALS_QUEUE_SPEC.md) — read it before touching
anything in §8 (approvals) or §5 (status vocabulary), because it changes both.

Conventions in this repo. Violating one of these is a review rejection, not a
style preference:

- Every branch-on string lives in `server/src/core/constants/index.js`. Add there first.
- Every route is validated by `validate(schema)` (Zod) before reaching a service.
- Import `config`, never `process.env`, outside `server/src/config/index.js`.
- Client data layer is RTK Query, one `baseApi`, endpoints injected per domain.
- All label/colour maps live in `client/src/lib/ui.js`. Never hardcode a status colour.
- `decisionHistory` is append-only. Never overwrite, never delete an entry.
- Terminal statuses are one-way. Preserve the `TERMINAL_STATUSES` guard.
- The template is data. New field, new form, new checklist module → edit seed data, not components.

Sibling docs: [ARCHITECTURE.md](ARCHITECTURE.md) ·
[AI_MODULE.md](AI_MODULE.md) · [EMS-ARCHITECTURE.md](EMS-ARCHITECTURE.md) ·
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)

---

## 1. What this module does

It runs a franchise store from *"we should open in Indore"* to *"the store is
live and the books are closed"* as a single ten-phase workflow, with every
decision recorded and every phase gated.

One project = one physical store being opened. Ten phases, 68 approval forms,
179 blueprint tasks, 12 departments, four roles, 114 days of stage SLA end to
end.

### What it is not

Listed so it can be pointed at during scoping.

| Not in PMS | Where it lives |
|---|---|
| Site desk-research and scoring | AI module — [AI_MODULE.md](AI_MODULE.md) |
| Expense capture, budgets, vendor payments | EMS — [EMS-ARCHITECTURE.md](EMS-ARCHITECTURE.md) |
| Bulk approvals, delegation, SLA escalation | Specified, not built — [APPROVALS_QUEUE_SPEC.md](APPROVALS_QUEUE_SPEC.md) |
| Payroll, hiring pipeline | No HRMS module exists; `hr` is a department, not a system |
| Bookings, customers, revenue | No CRM module exists |
| Offline use | No offline layer in the client |

---

## 2. Setup — new machine

```bash
git clone <repo> && cd Mystery-Rooms
npm install                       # npm workspaces: installs server + client
cp server/.env.example server/.env
#  → set MONGO_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
npm run seed                      # template + 4 demo users + demo projects
npm run dev                       # server :5000 + client :5173
```

**Requires** Node ≥ 20, npm ≥ 10, MongoDB (local `mongod` or Atlas).

### Environment

`server/src/config/index.js` validates the whole environment with Zod and calls
`process.exit(1)` on any bad value. A misconfigured server must never boot
half-broken. Only four vars block boot:

| var | constraint |
|---|---|
| `MONGO_URI` | non-empty |
| `JWT_ACCESS_SECRET` | ≥ 10 chars |
| `JWT_REFRESH_SECRET` | ≥ 10 chars |
| `CLIENT_ORIGINS` | comma-separated; defaults to `http://localhost:5173` |

Everything else is optional and degrades: Cloudinary fails only when an upload
is attempted; AI provider keys absent → AI endpoints answer `503` with a reason
and the UI renders a "not configured" state.

**Client env is optional.** With no `VITE_API_BASE_URL`, `client/src/lib/api.js`
falls back to relative `/api/v1`, which the Vite dev proxy forwards to `:5000`.
Use that locally — it avoids CORS entirely. `client/.env.production` is
committed and holds the deployed backend URL.

### Seeded logins

`npm run seed` **wipes and rebuilds**. All seeded users share password
`Admin@123`:

| email | role |
|---|---|
| `admin@mysteryrooms.in` | admin |
| `priya@mysteryrooms.in` | manager · expansion |
| `arjun@mysteryrooms.in` | manager · projects |
| `vikram@mysteryrooms.in` | executor |

### Scripts

| command | effect |
|---|---|
| `npm run dev` | both apps, colour-tagged, concurrently |
| `npm run dev:server` / `dev:client` | one at a time |
| `npm run seed` / `seed:destroy` | rebuild / clear demo data |
| `npm run lint` | eslint both workspaces |
| `npm test -w server` | regression suite, `server/tests/run-all.mjs` |
| `npm run migrate:*` | one-off migrations in `server/src/seed/` |

### Verify the setup worked

- [ ] `npm run dev` prints `MongoDB connected` and `listening on :5000`
- [ ] `GET http://localhost:5000/api/v1` returns `modules: ['auth','pms','ai','finance']`
- [ ] Login at `:5173` with `admin@mysteryrooms.in` / `Admin@123`
- [ ] Projects page lists seeded projects with non-zero counts
- [ ] A project detail page shows a 10-stage stepper

---

## 3. Stack

| layer | choice |
|---|---|
| Server | Node 20, Express, Mongoose, Zod, Winston |
| Auth | JWT access token + httpOnly refresh cookie, bcrypt (cost 12) |
| Client | React 18, Vite, Redux Toolkit + RTK Query, React Router, Recharts, lucide-react |
| Uploads | Cloudinary, optional |
| Dates | dayjs, both sides |

**One RTK Query instance**, `client/src/app/api/baseApi.js`. Every domain
injects into it. This is load-bearing: cache tags are scoped per `createApi`, so
cross-domain invalidation (approving a task must refresh Dashboard, Calendar
*and* MIS) is only expressible inside a single cache. A previous attempt at one
`createApi` per domain required manual bridge code between caches and was
reverted.

---

## 4. Data model

Four nouns in strict containment order.

```
Template  ── the blueprint. 10 stages, their forms, their tasks. Versioned.
   │            Exactly one carries isDefault.
   ▼  SNAPSHOT at project creation — the plan is immutable per project
Project   ── one store being opened. Owns a COPY of the template's stages.
   ├──▶ Stage  ── one of 10 phases. Status, SLA, dates, completion flags.
   │      ├──▶ Record ── a filled-in dynamic form. The unit of APPROVAL.
   │      └──▶ Task   ── work with an owner and a checklist. The unit of EXECUTION.
```

### 4.1 Record vs Task — the distinction that explains the codebase

| | Record | Task |
|---|---|---|
| Is | data captured on a form | work with an assignee |
| Shape | free-form `values` object, shaped by the stage's `masterDataSchema` | fixed schema + checklist |
| Drives | **gates** — whether a phase can close | **progress %** and the calendar |
| Decided by | approve / reject / shortlist | status transitions + 2-tier approval |
| History | append-only `decisionHistory[]` | Activity rows |

A stage can have both. p8 has 81 tasks and 14 record forms.

### 4.2 Why the template is snapshotted

`project.template = { ref, name, version }`, and the stages are **copied** into
`project.stages[]` at creation.

A project started under template v3 keeps v3's plan after the template moves to
v5. Without this, editing a template would silently rewrite the plan — SLAs,
forms and completion gates — of every project already in flight. Do not
"optimise" this into a live reference.

### 4.3 Project — `projects/project.model.js`

| field | note |
|---|---|
| `code` | unique, uppercase, `MR-PUN-001` |
| `template` | `{ ref, name, version }` snapshot |
| `city`, `plannedStartDate` | required **unless** `status === 'draft'` |
| `status`, `health`, `priority` | see §5 |
| `owner`, `members` | User refs |
| `storeLiveAt` / `storeLiveBy` | stamped once at p9. Never cleared. |
| `closedAt` / `closedBy` / `closureRemarks` | stamped at p10 sign-off |
| `archivedAt` / `archivedBy` / `archiveRemarks` | stamped at archive. Final. |
| `stages[]` | the snapshot, with live execution state |
| `masterData` | `{ [stageKey]: { [fieldKey]: value } }` |
| `progress` | derived, cached |
| `budget`, `broker` | franchise context |

Virtuals: `daysRemaining`, `budgetUtilization`.

### 4.4 Template — `templates/template.model.js`

A stage holds `tasks[]`, `masterDataSchema[]`, `assessmentTypes[]`,
`captureMode`, `recordNoun`, `slaDays`, `ownerDepartment`, `requiresApproval`,
`approverRoles[]`.

An `assessmentType` is an independent form nested under one stage — this is how
p2 hosts four unrelated assessments without becoming four stages in the stepper
and SLA tracking. It may declare `subKeyField`, naming a `select` field whose
options become a required checklist: the type is only complete when **every**
option has its own approved Record. Used by p3's NOC and approval modules.

Virtuals: `totalStages`, `totalTasks`, `totalChecklistItems`,
`estimatedDurationDays`.

### 4.5 Record — `records/record.model.js`

Key fields: `project`, `stageKey`, `assessmentType`, `seq` (stable display
number, set once), `title`, `values`, `status`, `attachments[]`, `comments[]`,
`parentRecordId`, and `decisionHistory[]`.

`parentRecordId` links an assessment back to what it assesses — a p2
feasibility Record points at the p1 property Record.

**`decisionHistory` exists because the `approvedBy`/`rejectedBy`/`decidedBy`
stamps only ever hold the latest decision.** Each new decision clears the last,
so without the history a reject-then-approve cycle left no trace on the record
itself. Append-only. Undo appends; it does not remove.

Indexes: `{ project, stageKey, status }` and
`{ project, stageKey, parentRecordId, assessmentType }` — the second is the
approval pipeline's read path, resolving one module for one property.

### 4.6 Dynamic field types

`MASTER_DATA_FIELD_TYPES`: `text, textarea, number, currency, date, datetime,
boolean, select, multiselect, file, user, location`.

Fields support `section` (grouping), `showIf: { field, in[] }` (conditional
display), `min`/`max`, `accept`/`multiple` (files), `recordAudio` (microphone
capture), `order`.

All of it is data-driven. `RecordFormModal` and `DynamicField` render whatever
the schema declares. **Adding a field, a section, or an entire assessment type
is a seed-data change with zero frontend code.** If you find yourself writing a
per-field `if`, you have taken a wrong turn.

---

## 5. Status vocabulary

> `APPROVALS_QUEUE_SPEC.md` §3 mandates migrating three of these values before
> the approvals queue is built. Read it before adding a fourth label override.

### Project — `PROJECT_STATUS`

```
draft ──publish──▶ planning ──▶ active ──▶ completed
                                   │           │
                                on_hold     (p9 done)
                                   │           ▼
                              cancelled    store_live ──(p10 + archive)──▶ archived
```

**`draft`** — saved from the Create Project modal, never committed. No stages,
tasks or notifications materialise until `POST /:id/publish`, which re-validates
`city` and `plannedStartDate` strictly.

**`store_live` and `archived` are one-way doors.** `recompute()` carries a
`TERMINAL_STATUSES` guard (7 references in `project.service.js`) so routine
progress recalculation can never downgrade them back to `completed`. Break that
guard and live projects silently un-launch.

### Health — `PROJECT_HEALTH`
`on_track` · `at_risk` · `delayed`. Drives the Projects page "At risk" lens and
the dashboard banner.

### Record — `RECORD_STATUS`
`draft` · `submitted` · `shortlisted` · `evaluation_in_progress` · `rejected` ·
`approved` · `archived` · `locked`

### Task — `TASK_STATUS`
`todo` · `in_progress` · `blocked` · `review` · `done` · `waiting_approval` ·
`waiting_management_approval` · `approved` · `rejected`

Only four are settable via the generic `PATCH /:id` — `TASK_STATUS_SELECTABLE`
is `todo, in_progress, blocked, done`. The approval states are reachable
**only** through `submit-approval` and `decision`; a guard in
`task.service.js#update()` enforces this. Two tiers: own department manager
(`waiting_approval`) → cross-department management
(`waiting_management_approval`) → `approved`.

### Three labels currently lie about DB values

| DB value | UI label | why |
|---|---|---|
| `submitted` | "Under Review" | renaming needed a migration across every phase page's comparisons |
| `todo` | "Assigned" | reads wrong under the approval workflow |
| `done` | "Completed" | same |

**Do not add a fourth.** Expect this mismatch when reading code.

---

## 6. The ten phases

Source of truth: `server/src/seed/storeLaunchTemplate.js`, code
`MR-PMS-STORE-LAUNCH`, `isDefault: true`. All ten are `captureMode: 'collection'`.

| # | Phase | SLA | Owner dept | Tasks | Forms |
|---|---|---:|---|---:|---:|
| p1 | Property Identification | 10d | expansion | 4 | 1 flat, 20 fields |
| p2 | Site Evaluation | 8d | expansion | 4 | 4 |
| p3 | Commercial Finalization | 12d | legal | 5 | 6 |
| p4 | Project Creation | 5d | projects | 3 | 1 |
| p5 | Department Planning | 7d | projects | 10 | 10 |
| p6 | Execution | 45d | projects | 5 | 10 |
| p7 | Approval Workflow | 5d | operations | 3 | 6 |
| p8 | Store Readiness Checklist | 10d | operations | 81 | 14 |
| p9 | Store Launch | 5d | operations | 60 | 8 |
| p10 | Project Closure | 7d | finance | 4 | 8 |
| | **total** | **114d** | | **179** | **68** |

**p1 · Property Identification** — `recordNoun: "Property"`. Every candidate
property from a broker is one Record on a 20-field sectioned form. Managers
shortlist or reject. The only phase using a flat `masterDataSchema` rather than
`assessmentTypes`.

**p2 · Site Evaluation** — every *shortlisted* property gets four assessments:
`feasibility, financial, technical, operational`, each linked by
`parentRecordId`.

**p3 · Commercial Finalization** — `loi, lease, legal, deposit, nocs,
approvals`. `nocs` and `approvals` use `subKeyField` (one Record per NOC type /
per approval level).

**p4 · Project Creation** — `project_creation`. The handoff: a property becomes
a build project.

**p5 · Department Planning** — ten plans, one per department: `construction,
interior, procurement, automation, it, marketing, hr, finance, operations,
legal`.

**p6 · Execution** — 45-day SLA, the long one. Same ten departments, executing.
Home of the two-tier task approval pipeline.

**p7 · Approval Workflow** — six sequential tiers: `department_review →
functional_review → finance_approval → legal_review → management_approval →
final_approval`. *(The approvals spec moves this chain out of code into
`stage.approvalTiers[]`.)*

**p8 · Store Readiness Checklist** — the pre-launch gate. 14 modules
(`construction_readiness, electrical_utilities, it_infrastructure,
internet_network, security_cctv, furniture_fixtures, inventory_stock,
pos_billing, hiring_complete, staff_training, marketing_ready,
branding_signage, fire_safety, licenses_compliance`), 81 tasks.

**p9 · Store Launch** — 8 modules including `go_live_approval`, which carries
the launch datetime driving the countdown widget. Completing this stage sets
`status = store_live` and stamps `storeLiveAt`. One-way.

**p10 · Project Closure** — `budget_analysis, delay_analysis,
vendor_performance, financial_closure, asset_handover, document_archive,
lessons_learned, project_sign_off`. Completing it stamps `closedAt`; a separate
archive action stamps `archivedAt` and freezes the project.

---

## 7. Flow

```
 Manager creates a project, picks a template (default MR-PMS-STORE-LAUNCH)
   → 10 stages COPIED onto the project
   → every blueprint task instantiated as a real Task
        │
 p1  capture candidate properties → shortlist / reject
 p2  4 assessments per shortlisted property
 p3  6 commercial modules approved per property
 p4  property becomes a build project
 p5  10 department plans
 p6  execution — tasks through the 2-tier approval pipeline
 p7  6 sequential approval tiers
 p8  14 readiness modules + 81 tasks
 p9  go-live  →  status = store_live         (one-way)
 p10 8 closure modules  →  closedAt
        │
        └─ archive  →  status = archived     (one-way, read-only)
```

Every transition writes an Activity row (`ACTIVITY_ACTIONS`), and a
Notification where a person needs to know.

---

## 8. Stage gates

`project.service.js#completeStage` refuses to close a stage until its rule
holds. These are the real business rules — they live in code, not prompts. One
`if (stageKey === 'pN')` branch per gate.

| stage | refuses unless |
|---|---|
| p2 | at least one property has cleared Site Evaluation |
| p3 | every mandatory module approved, per property |
| p4 | at least one property has cleared Commercial Finalization |
| p5 | p4 is completed |
| p6 | its tasks are resolved |
| p7 | its tasks are resolved |
| p8 | no mandatory readiness module left with an empty checklist |
| p9 | no earlier phase incomplete |
| p10 | no earlier phase incomplete |

Machine error code for tier violations: `APPROVAL_OUT_OF_ORDER`.

`PRE_LAUNCH_STAGE_KEYS` = `p1`–`p8`. These become frozen history the moment the
store goes live. p9 is excluded — its own tasks set `store_live`. p10 is
excluded — closure happens strictly after go-live.

Archiving carries its own gate naming the specific `CLOSURE_MODULES` it
requires: financial closure, document archive, sign-off.

Stages auto-complete from their tasks. An explicit **Mark Done** sets
`completedManually: true`, after which `recompute()` leaves that stage alone
until a manager reopens it. `reopenedBy`/`reopenedAt` are recorded **alongside**
`completedBy`/`completedAt`, never overwriting them.

---

## 9. Roles, departments, permissions

`ROLES` — four:

| role | grants |
|---|---|
| `admin` | everything, incl. config, users, hard delete |
| `manager` | owns projects, assigns, approves, completes stages |
| `executor` | the doer — captures records, completes tasks |
| `viewer` | read-only dashboards and MIS |

Enforcement is `authenticate` + `authorize(...roles)` from
`server/src/core/middleware/auth.js`. Each route file declares its own local
alias so the role set is readable where it is used:

```js
// projects/project.routes.js, tasks/task.routes.js
const canManage  = authorize(ROLES.ADMIN, ROLES.MANAGER);
// records/record.routes.js
const canCapture = authorize(ROLES.ADMIN, ROLES.MANAGER, ROLES.EXECUTOR);
const canDecide  = authorize(ROLES.ADMIN, ROLES.MANAGER);
```

`viewer` appears in no write guard. Hard project delete is
`authorize(ROLES.ADMIN)` alone.

**`DEPARTMENTS` is a separate axis from roles** — 12 values (`expansion, legal,
projects, hr, marketing, finance, operations, construction, interior,
procurement, automation, it`). Roles gate *permission*; departments gate
*scope*.

> Known hole: any `manager` can currently approve any project's work. There is
> no project-scope check. `APPROVALS_QUEUE_SPEC.md` §13 closes this by replacing
> role guards with a `can(user, permission, resource)` helper.

---

## 10. API

Base `/api/v1`. PMS at `/pms` (`pms.routes.js`), beside `/auth`, `/ai`,
`/finance`.

```
/pms/templates          CRUD + publish
/pms/projects           list, get, by-code, create, patch, publish,
                        complete/reopen stage, archive, closure-audit,
                        activity, closure-readiness, delete
/pms/tasks              list, board, mine, by-code, create, patch, status,
                        comments, submit-approval, decision, delete
/pms/records            list, get, create, patch, open, comments,
                        decision, undo-decision, uploads, delete
/pms/dashboard          summary aggregation — KPIs, status/health/city distributions
/pms/calendar/events    ?from&to&project — tasks + go-live milestones
/pms/mis                management reports
/pms/notifications      inbox, unread-count
```

**List conventions.** `page`, `limit`, `sort` (`-field` descending; default
`createdAt: -1`), plus per-resource filters (`status`, `health`, `city`,
`search`). Envelope:

```
{ success, data, meta: { page, limit, total, totalPages, hasNextPage, hasPrevPage } }
```

Errors carry an HTTP status, a human message, and where useful a machine `code`.

---

## 11. Client

```
client/src/
├── app/
│   ├── api/         RTK Query — baseApi.js + one file per domain
│   ├── slices/      auth, ui
│   ├── middleware/  error, UI persistence
│   └── store.js
├── components/
│   ├── layout/      AppShell, Sidebar, Topbar, BottomNav, Breadcrumbs
│   ├── ui/          primitives.jsx, Skeletons.jsx
│   ├── charts/      chartkit.jsx (recharts wrappers)
│   ├── permissions/ PermissionGate
│   └── routing/     RouteGuards
├── features/
│   ├── dashboard/
│   ├── projects/    ProjectsPage, ProjectDetailPage, one page per phase,
│   │                stagesConfig.jsx
│   ├── calendar/    CalendarPage, MonthCalendar, DayDossier, calendarUtils.js
│   ├── tasks/  mis/  notifications/
│   ├── ai/          Module 2 panels
│   └── expenses/    Module 3
├── lib/             ui.js (all *_META maps), format.js, api.js
└── styles/          tokens.css, globals.css, per-feature sheets
```

Phase pages: `PropertyIdentificationPage`, `SiteEvaluationPage`,
`CommercialFinalizationPage`, `ProjectCreationPage`, `DepartmentPlanningPage`,
`ExecutionPage`, `ApprovalWorkflowPage`, `StoreReadinessDashboardPage`,
`StoreLaunchPage`, `ProjectClosurePage`.

`features/projects/stagesConfig.jsx` maps stage key → page, icon, label. The
single place the client knows the phase list.

`lib/ui.js` holds every label/colour map: `TASK_STATUS_META`,
`PROJECT_STATUS_META`, `HEALTH_META`, `PRIORITY_META`, `DEPT_META`.

---

## 12. Extending

### Add a field, form, or checklist module
Edit `storeLaunchTemplate.js`. Reseed, or write a migration in
`server/src/seed/`. **No component changes.**

### Add a phase
1. Add the stage to `storeLaunchTemplate.js` — key `pN`, name, `slaDays`,
   `ownerDepartment`, `captureMode`, `assessmentTypes[]`.
2. Add a gate branch in `project.service.js#completeStage` if it needs one.
3. Add a page, register it in `stagesConfig.jsx`.
4. Reseed or migrate.

Routes, models, the approval pipeline, calendar and dashboard all read the
stage list generically and need no change.

### Add a module beside PMS
Follow `pms.routes.js`'s shape: `model / routes / controller / service /
validation` per resource, mounted under its own top-level namespace in
`server/src/routes/index.js`.

---

## 13. Hard rules

Breaking one of these causes silent data corruption, not a visible error.

1. **Never make the project's stage array a live reference to the template.**
   It is a snapshot. See §4.2.
2. **Never overwrite or delete a `decisionHistory` entry.** Append only, undo
   included.
3. **Never let `recompute()` write over a terminal status.** Preserve the
   `TERMINAL_STATUSES` guard.
4. **Never set an approval task status through the generic PATCH.** Use
   `submit-approval` / `decision`.
5. **Never add a fourth label that disagrees with its DB value.** Migrate
   instead — see `APPROVALS_QUEUE_SPEC.md` §3.
6. **Never hardcode a status colour or label in a component.** `lib/ui.js`.
7. **Never branch on a string literal that is not in `constants/index.js`.**

---

## 14. Current state of the data

Measured against the live Atlas database on **2026-08-06**, not estimated.
These drift daily — re-measure before quoting them.

| metric | value |
|---|---|
| Records in `submitted` | **246** |
| Of those, waiting > 7 days | **238** |
| Oldest pending item | **58 days** |
| Calendar events, Aug 2026 window | 109 — 12 go-lives, 97 tasks |
| Overdue tasks in that window | 33 |
| Users | 24 |

Re-measure with:

```bash
cd server && node -e "
const dns=require('dns');dns.setServers(['8.8.8.8']);
Promise.all([import('mongoose'),import('dotenv')]).then(async([m,d])=>{
  d.default.config();
  await m.default.connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:30000});
  const rs=await m.default.connection.collection('records')
    .find({status:'submitted'}).project({submittedAt:1,updatedAt:1}).toArray();
  const age=r=>Math.floor((Date.now()-new Date(r.submittedAt||r.updatedAt))/864e5);
  console.log('submitted:',rs.length,'| >7d:',rs.filter(r=>age(r)>=7).length,
              '| oldest:',Math.max(...rs.map(age))+'d');
  await m.default.disconnect();});"
```

The approval backlog is structural, not behavioural — an approver must navigate
project → phase → record to act on one item, and there is no bulk action. That
is exactly what `APPROVALS_QUEUE_SPEC.md` exists to fix; its success metric is
this table's second row going under 10.

---

## 15. Known rough edges

| edge | detail |
|---|---|
| Seed data is test junk | Real project names include `dsfghjk`, `hemannt`, `new-project`; most sit at 0% progress. The workflow is sound; the demo content is not presentable. |
| Two templates exist | `franchiseTemplate.js` is older. `MR-PMS-STORE-LAUNCH` is `isDefault`. |
| Atlas SRV DNS | `config/database.js` pins `dns.setServers(['8.8.8.8'])` — some networks refuse SRV lookups, which `mongodb+srv://` requires. `serverSelectionTimeoutMS` is 30s because a measured connect took 21s on a lossy link. |
| No project scope on approvals | Any manager can approve any project. See §9. |
| `slaDays` is decorative | Set on every stage, but nothing fires when breached. Escalation is specified in `APPROVALS_QUEUE_SPEC.md` §11, not built. |
