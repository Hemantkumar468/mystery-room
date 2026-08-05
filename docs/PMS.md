# PMS — Project Management System

The first and largest module of the Mystery Rooms ERP. It runs a franchise
store from *"we should open in Indore"* to *"the store is live and the books
are closed"* as a single, auditable, ten-phase workflow.

This file is written to be **self-contained**: hand it to a person or an AI
with no other context and they should be able to set the project up, find their
way around the code, and understand why it is shaped the way it is.

> Sibling docs: [ARCHITECTURE.md](ARCHITECTURE.md) (whole-system),
> [AI_MODULE.md](AI_MODULE.md) (Module 2 — property intelligence),
> [EMS-ARCHITECTURE.md](EMS-ARCHITECTURE.md) (expense management),
> [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (UI conventions).

---

## 1. Setting up on a new machine

```bash
git clone <repo> && cd Mystery-Rooms
npm install                      # npm workspaces — installs server + client
cp server/.env.example server/.env
# edit server/.env: MONGO_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
npm run seed                     # template + demo users + demo projects
npm run dev                      # server :5000 + client :5173, concurrently
```

**Requirements:** Node ≥ 20, npm ≥ 10, a MongoDB (local `mongod` or an Atlas
connection string).

### The four env vars that actually block boot

`server/src/config/index.js` validates the whole environment with Zod and
**exits the process** on a bad value — a misconfigured server never boots
half-broken. Only these are mandatory:

| var | note |
|---|---|
| `MONGO_URI` | local or Atlas |
| `JWT_ACCESS_SECRET` | min 10 chars |
| `JWT_REFRESH_SECRET` | min 10 chars |
| `CLIENT_ORIGINS` | defaults to `http://localhost:5173`; comma-separated |

Everything else (Cloudinary uploads, all AI provider keys) is optional and
degrades gracefully — uploads fail loudly only when used, AI endpoints answer
`503` with a reason.

### Client environment

`client/.env` is optional. With no `VITE_API_BASE_URL`, `client/src/lib/api.js`
falls back to a relative `/api/v1`, which `vite.config.js`'s dev proxy forwards
to `:5000`. That is the recommended local setup — no CORS involved.
`client/.env.production` is committed and holds the deployed backend URL.

### Seeded logins

`npm run seed` wipes and rebuilds the demo data. Every seeded user shares the
password **`Admin@123`**:

| email | role |
|---|---|
| `admin@mysteryrooms.in` | admin |
| `priya@mysteryrooms.in` | manager (expansion) |
| `arjun@mysteryrooms.in` | manager (projects) |
| `vikram@mysteryrooms.in` | executor |

`npm run seed:destroy` clears without reseeding.

### Useful scripts

| command | what it does |
|---|---|
| `npm run dev` | both apps, colour-tagged |
| `npm run dev:server` / `dev:client` | one at a time |
| `npm run seed` | reset demo data |
| `npm run lint` | eslint both workspaces |
| `npm test -w server` | regression suite (`server/tests/run-all.mjs`) |
| `npm run migrate:*` | one-off data migrations, see `server/src/seed/` |

---

## 2. Stack

| layer | choice |
|---|---|
| Server | Node 20, Express, Mongoose, Zod validation, Winston logging |
| Auth | JWT access token + httpOnly refresh cookie, bcrypt passwords |
| Client | React 18, Vite, Redux Toolkit + **RTK Query** (sole data layer), React Router, Recharts, lucide-react |
| Uploads | Cloudinary (optional) |
| Dates | dayjs, both sides |

The client has **one** RTK Query API instance (`client/src/app/api/baseApi.js`);
every domain injects endpoints into it. This is deliberate — tags are scoped per
`createApi`, so cross-domain invalidation (approving a task must refresh
Dashboard, Calendar *and* MIS) is only expressible inside a single cache.

---

## 3. The core idea

Four nouns, in a strict containment order:

```
Template  ── the blueprint. 10 stages, their forms, their tasks.
   │            Versioned and published. One is `isDefault`.
   ▼  (snapshot at project creation — the plan is immutable per project)
Project   ── one franchise store being opened. Carries its own COPY of the
   │            template's stages, so editing the template never mutates a
   │            project already in flight.
   ├──▶ Stage    ── one of the 10 phases, with status/SLA/dates.
   │       ├──▶ Record ── a filled-in dynamic form (a property, an
   │       │                assessment, a closure module). The unit of
   │       │                *approval*.
   │       └──▶ Task   ── a unit of *work* with an assignee and a
   │                        checklist. The unit of *execution*.
```

**Record vs Task** is the distinction that explains most of the codebase:

- A **Record** is data someone captured on a form, which a manager then
  approves or rejects. Its `values` object is free-form; the stage's
  `masterDataSchema` defines the shape. Records drive the *gates*.
- A **Task** is work with an owner, a due date and a checklist. Tasks drive
  *progress %* and the calendar.

A stage can have both. Phase 8 has 81 tasks and 14 record forms.

### Why the template is snapshotted

`project.template = { ref, name, version }` and the stages are **copied** into
`project.stages[]` at creation. A project started in January under template v3
keeps v3's plan even after the template moves to v5. Without this, editing a
template would silently rewrite the plan of every live project — including
their SLAs and completion gates.

---

## 4. The ten phases

Defined in `server/src/seed/storeLaunchTemplate.js`
(code `MR-PMS-STORE-LAUNCH`, `isDefault: true`). All ten are
`captureMode: 'collection'` — every phase captures many Record rows.

| # | Phase | SLA | Owner dept | Tasks | Forms |
|---|---|---:|---|---:|---:|
| p1 | Property Identification | 10d | expansion | 4 | 20 fields, one flat form |
| p2 | Site Evaluation | 8d | expansion | 4 | 4 |
| p3 | Commercial Finalization | 12d | legal | 5 | 6 |
| p4 | Project Creation | 5d | projects | 3 | 1 |
| p5 | Department Planning | 7d | projects | 10 | 10 |
| p6 | Execution | 45d | projects | 5 | 10 |
| p7 | Approval Workflow | 5d | operations | 3 | 6 |
| p8 | Store Readiness Checklist | 10d | operations | 81 | 14 |
| p9 | Store Launch | 5d | operations | 60 | 8 |
| p10 | Project Closure | 7d | finance | 4 | 8 |

### What each phase does

**p1 · Property Identification** — `recordNoun: "Property"`. A doer captures
every candidate property from a broker as one Record, using a 20-field form
grouped into sections. Managers then **shortlist** or **reject** each one. This
is the only phase with a single flat `masterDataSchema` rather than
`assessmentTypes`.

**p2 · Site Evaluation** — `recordNoun: "Assessment"`. Every *shortlisted*
property gets four independent assessments:
`feasibility, financial, technical, operational`. Each is its own Record linked
back to the property by `parentRecordId`.

**p3 · Commercial Finalization** — six modules:
`loi, lease, legal, deposit, nocs, approvals`. Two of these use `subKeyField`,
where a single module tracks *several* required sub-items (one Record per NOC
type, one per approval level) and only counts as complete when every option in
that select field has its own approved Record.

**p4 · Project Creation** — one module, `project_creation`. The handoff point:
the property is now a build project.

**p5 · Department Planning** — ten department plans, one per department:
`construction, interior, procurement, automation, it, marketing, hr, finance,
operations, legal`.

**p6 · Execution** — the long one (45d SLA). Same ten departments, now
executing. This is where the task approval pipeline lives.

**p7 · Approval Workflow** — six sequential review tiers:
`department_review → functional_review → finance_approval → legal_review →
management_approval → final_approval`.

**p8 · Store Readiness Checklist** — the pre-launch gate. 14 modules
(`construction_readiness, electrical_utilities, it_infrastructure,
internet_network, security_cctv, furniture_fixtures, inventory_stock,
pos_billing, hiring_complete, staff_training, marketing_ready,
branding_signage, fire_safety, licenses_compliance`) and 81 tasks.

**p9 · Store Launch** — go-live. 8 modules including `go_live_approval`, which
carries the launch date/time that drives the countdown widget. Completing this
stage flips `project.status` to `store_live` and stamps `storeLiveAt` — a
**one-way door**.

**p10 · Project Closure** — 8 modules (`budget_analysis, delay_analysis,
vendor_performance, financial_closure, asset_handover, document_archive,
lessons_learned, project_sign_off`). Completing it stamps `closedAt`; a
separate **archive** action then stamps `archivedAt` and freezes the project.

---

## 5. Lifecycles

### Project status — `PROJECT_STATUS`

```
draft ──publish──▶ planning ──▶ active ──▶ completed
                                   │            │
                                on_hold      (p9 done)
                                   │            ▼
                               cancelled    store_live ──(p10 + archive)──▶ archived
```

- **`draft`** — saved from the Create Project modal but never committed. No
  stages, tasks or notifications materialize until `POST /:id/publish`. While
  draft, `city` and `plannedStartDate` are *not* required; publishing
  re-validates them strictly.
- **`store_live`** and **`archived`** are **terminal one-way doors**.
  `recompute()` has a `TERMINAL_STATUSES` guard so routine progress
  recalculation can never silently downgrade them back to `completed`.

### Project health — `PROJECT_HEALTH`
`on_track` · `at_risk` · `delayed`. Derived, drives the "At risk" lens on the
Projects page and the dashboard banner.

### Record status — `RECORD_STATUS`
`draft` · `submitted` · `shortlisted` · `evaluation_in_progress` · `rejected` ·
`approved` · `archived` · `locked`

> `submitted` **displays as "Under Review"**. The DB value was left alone to
> avoid a migration across every phase page's status comparison — only the
> label changed. Expect this mismatch when reading the code.

### Task status — `TASK_STATUS`
`todo` · `in_progress` · `blocked` · `review` · `done` · `waiting_approval` ·
`waiting_management_approval` · `approved` · `rejected`

Only four are settable through the generic `PATCH /:id`
(`TASK_STATUS_SELECTABLE`: todo, in_progress, blocked, done). The approval
states are reachable **only** via the dedicated `submit-approval` and
`decision` endpoints — a guard in `task.service.js#update()` enforces this.

Two-tier approval: a task clears its own department manager
(`waiting_approval`) and then cross-department management
(`waiting_management_approval`) before reaching `approved`.

`todo` is labelled **"Assigned"** and `done` **"Completed"** in the UI, for the
same reason as `submitted` above.

### Stage status — `STAGE_STATUS`
`not_started` · `in_progress` · `blocked` · `completed`

Stages normally auto-complete from their tasks. An explicit **"Mark Done"**
sets `completedManually: true`, after which `recompute()` leaves that stage
alone until a manager reopens it.

---

## 6. The end-to-end flow

```
 Manager creates a project
     │  picks a template (default: MR-PMS-STORE-LAUNCH)
     │  → template's 10 stages are COPIED onto the project
     │  → every template task is instantiated as a real Task
     ▼
 p1  Doer captures candidate properties as Records
     │  Manager shortlists / rejects each
     ▼
 p2  Each shortlisted property gets 4 assessment Records
     │  (parentRecordId → the property)
     ▼
 p3  6 commercial modules approved per property
     ▼
 p4  Property becomes a build project
     ▼
 p5  10 department plans
     ▼
 p6  Execution — tasks flow through the 2-tier approval pipeline
     ▼
 p7  6 sequential approval tiers
     ▼
 p8  14 readiness modules + 81 tasks
     ▼
 p9  Go-live  →  project.status = store_live  (one-way)
     ▼
 p10 8 closure modules  →  closedAt
     │
     └─ archive  →  project.status = archived  (one-way, read-only)
```

Every transition writes an **Activity** row (`ACTIVITY_ACTIONS`) and, where a
person needs to know, a **Notification**.

---

## 7. Stage completion gates

`project.service.js#completeStage` refuses to close a stage until its rule is
satisfied. These are the real business rules — they live in code, not prompts.
Each `if (stageKey === 'pN')` branch is one gate:

| stage | refuses unless |
|---|---|
| p2 | at least one property has cleared Site Evaluation |
| p3 | every mandatory module is approved (per property) |
| p4 | at least one property has cleared Commercial Finalization |
| p5 | p4 is completed |
| p6 | its tasks are resolved |
| p7 | its tasks are resolved |
| p8 | no mandatory readiness module is left with an empty checklist |
| p9 | no earlier phase is incomplete |
| p10 | no earlier phase is incomplete |

`PRE_LAUNCH_STAGE_KEYS` (`p1`–`p8`) become **frozen history** the moment the
store goes live. p9 is excluded (its own tasks set `store_live`), p10 is
excluded (closure happens strictly *after* go-live).

Archiving has its own gate naming the specific closure modules it needs:
financial closure, document archive, sign-off (`CLOSURE_MODULES`).

---

## 8. Roles and permissions

`ROLES` — four, in `server/src/core/constants/index.js`:

| role | can |
|---|---|
| `admin` | everything, including config, users, hard delete |
| `manager` | owns projects, assigns work, approves, completes stages |
| `executor` | the "doer" — captures records, completes tasks |
| `viewer` | read-only dashboards and MIS |

Enforcement is `authenticate` + `authorize(...roles)` from
`server/src/core/middleware/auth.js`. Each route file defines its own local
alias over `authorize` rather than importing a shared one — so the role set is
readable at the top of the file it guards:

```js
// projects/project.routes.js, tasks/task.routes.js
const canManage  = authorize(ROLES.ADMIN, ROLES.MANAGER);
// records/record.routes.js
const canCapture = authorize(ROLES.ADMIN, ROLES.MANAGER, ROLES.EXECUTOR);
const canDecide  = authorize(ROLES.ADMIN, ROLES.MANAGER);
```

`viewer` appears in no write guard — it reads only. Hard delete of a project is
`authorize(ROLES.ADMIN)` alone.

`DEPARTMENTS` is a **separate axis** from roles — 12 values (`expansion, legal,
projects, hr, marketing, finance, operations, construction, interior,
procurement, automation, it`). Roles gate *permission*; departments gate
*scope* (whose queue a task lands in).

---

## 9. Data models

All under `server/src/modules/pms/*/`.

**Project** (`projects/project.model.js`) — name, unique `code` (`MR-PUN-001`),
template snapshot, city/address/areaSqft, status/health/priority, owner +
members, planned/actual dates, the one-way stamps (`storeLiveAt`, `closedAt`,
`archivedAt` and their `*By` users), budget, broker, `stages[]`, `masterData`,
cached `progress`, `currentStageKey`.

**Template** (`templates/template.model.js`) — name, unique code, version,
`isDefault`, `stages[]`. A stage holds `tasks[]`, `masterDataSchema[]`,
`assessmentTypes[]`, `captureMode`, `recordNoun`, `slaDays`,
`ownerDepartment`, `requiresApproval`. Virtuals compute `totalStages`,
`totalTasks`, `totalChecklistItems`, `estimatedDurationDays`.

**Record** (`records/record.model.js`) — project + stageKey + optional
`assessmentType`, `seq` (stable display number), `title`, free-form `values`,
status, attachments, comments, the decision stamps, `parentRecordId`, and an
**append-only `decisionHistory[]`**. That history exists because the
`approvedBy`/`rejectedBy` stamps only ever hold the *latest* decision — without
it, a reject-then-approve cycle left no trace on the record.

**Task** (`tasks/task.model.js`) — the work unit: title, assignees, dates,
status, priority, checklist, `taskCategory` (the p8/p9 grouping axis),
dependencies.

**Notification / Activity** (`notifications/`, `activity/`) — the audit and
inbox trail.

### Field types a template designer can use

`MASTER_DATA_FIELD_TYPES`: `text, textarea, number, currency, date, datetime,
boolean, select, multiselect, file, user, location`.

Fields support `section` (grouping), `showIf: { field, in[] }` (conditional
display), `min`/`max`, `accept`/`multiple` (files), and `recordAudio` (capture
via microphone). All of this is **data-driven** — `RecordFormModal` and
`DynamicField` render whatever the schema declares, so adding a field or a
whole new assessment type is a seed-data change with **no frontend code
change**.

---

## 10. API surface

Everything is under `/api/v1`. PMS lives at `/pms` (`pms.routes.js`), beside
`/auth`, `/ai` and `/finance`.

```
/pms/templates      CRUD + publish
/pms/projects       list, get, create, patch, publish draft,
                    complete/reopen stage, archive, closure-audit, delete
/pms/tasks          list, board, mine, by-code, create, patch, status,
                    comments, submit-approval, decision, delete
/pms/records        list, get, create, patch, open, comments,
                    decision, undo-decision, uploads, delete
/pms/dashboard      the summary aggregation (KPIs, distributions)
/pms/calendar/events  ?from&to&project — tasks + go-live milestones
/pms/mis            management reports
/pms/notifications  inbox, unread-count
```

Conventions: list endpoints accept `page`, `limit`, `sort` (`-field` for
descending, default `createdAt: -1`), plus per-resource filters
(`status`, `health`, `city`, `search`). Responses carry
`{ data, meta: { page, limit, total, totalPages, hasNextPage, hasPrevPage } }`.

Every response is `{ success, data | message }`. Errors carry an HTTP status,
a human message, and sometimes a machine `code` (e.g. `APPROVAL_OUT_OF_ORDER`).

---

## 11. Client structure

```
client/src/
├── app/
│   ├── api/         RTK Query — baseApi.js + one file per domain
│   ├── slices/      auth, ui
│   ├── middleware/  error + UI persistence
│   └── store.js
├── components/
│   ├── layout/      AppShell, Sidebar, Topbar, BottomNav, Breadcrumbs
│   ├── ui/          primitives.jsx (badges, Avatar, ProgressBar…), Skeletons
│   ├── charts/      chartkit.jsx (recharts wrappers)
│   ├── permissions/ PermissionGate
│   └── routing/     RouteGuards
├── features/
│   ├── dashboard/   DashboardPage
│   ├── projects/    ProjectsPage, ProjectDetailPage, + one page per phase
│   │                 (PropertyIdentificationPage, SiteEvaluationPage,
│   │                  CommercialFinalizationPage, DepartmentPlanningPage,
│   │                  ExecutionPage, ApprovalWorkflowPage,
│   │                  StoreReadinessDashboardPage, StoreLaunchPage,
│   │                  ProjectClosurePage), stagesConfig.jsx
│   ├── calendar/    CalendarPage, MonthCalendar, DayDossier, calendarUtils
│   ├── tasks/, mis/, notifications/
│   ├── ai/          Module 2 panels
│   └── expenses/    EMS (Module 3)
├── lib/             ui.js (all *_META label/colour maps), format.js, api.js
└── styles/          tokens.css, globals.css, + per-feature sheets
```

`features/projects/stagesConfig.jsx` maps each stage key to its page, icon and
label — the single place the client knows the phase list.

`lib/ui.js` holds every label/colour map (`TASK_STATUS_META`,
`PROJECT_STATUS_META`, `HEALTH_META`, `PRIORITY_META`, `DEPT_META`). Never
hardcode a status colour in a component; read it from here.

---

## 12. Conventions worth knowing before editing

- **Constants are shared vocabulary.** Any string the system branches on lives
  in `server/src/core/constants/index.js`. Add there first.
- **Config is read once.** Import `config`, never `process.env`, outside
  `config/index.js`.
- **Zod validates every route**, via `validate(schema)` middleware. Bad input
  never reaches a service.
- **The template is data.** New field, new assessment type, new checklist
  module → edit `storeLaunchTemplate.js` and reseed. No component changes.
- **Approvals are append-only.** Never overwrite `decisionHistory`.
- **Terminal statuses are one-way.** If you touch `recompute()`, preserve the
  `TERMINAL_STATUSES` guard or live projects will silently un-launch.
- **Labels lie about DB values** in three known places: `submitted` → "Under
  Review", `todo` → "Assigned", `done` → "Completed".

### Adding a new phase

1. Add the stage to `storeLaunchTemplate.js` (key `pN`, name, SLA,
   `ownerDepartment`, `captureMode`, `assessmentTypes[]`).
2. Add its gate branch in `project.service.js#completeStage` if it needs one.
3. Add a page and register it in `stagesConfig.jsx`.
4. Reseed, or write a migration in `server/src/seed/`.

Nothing else changes — routes, models, the approval pipeline, the calendar and
the dashboard all read the stage list generically.

---

## 13. Known rough edges

- **Seed data is test junk.** Real project names include `dsfghjk` and
  `new-project`; most sit at 0% progress. The workflow is sound, the demo
  content is not presentable.
- **The approvals backlog is real.** At time of writing 246 records sit in
  `submitted`, 238 of them older than a week. The Dashboard's Pending Approvals
  panel surfaces the five oldest; it is not a UI bug.
- **`franchiseTemplate.js`** is a second, older template kept beside the
  official one. `MR-PMS-STORE-LAUNCH` is the `isDefault`.
- **Atlas + SRV DNS.** `server/src/config/database.js` pins
  `dns.setServers(['8.8.8.8'])` because some networks refuse SRV lookups, which
  `mongodb+srv://` requires. Timeouts there are sized for a slow link
  (`serverSelectionTimeoutMS: 30s`).
