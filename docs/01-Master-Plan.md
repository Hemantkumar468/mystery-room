# Mystery Rooms PMS — Master Plan

### A dynamic, phase-based Project Management System (growing into an ERP) for franchise-outlet expansion

> **Read this first.** It is the single source of truth for *what* we're building, *why*, and — importantly — *what already exists in this repo* so nobody rebuilds it. A teammate or another AI assistant should be able to read this plus [`02-Phase-1-Build-Spec.md`](02-Phase-1-Build-Spec.md) and start contributing without spelunking the whole codebase.
>
> **Status:** the platform skeleton, the 10-phase workflow template, projects, tasks, dashboard, calendar and MIS are **already built and working**. The active piece of work is **Phase 1 — Property Identification**, which needs one genuinely new capability described in §5.

---

## 1. The client & the business (60 seconds)

**Mystery Rooms** ([mysteryrooms.in](https://mysteryrooms.in/)) is India's largest live **escape-room** brand. Customers book a themed room (prison break, heist, haunted, Da Vinci…), get locked in with their team, and race a countdown to solve physical puzzles and "escape." It runs on a **franchise (FOFO) model** and expands **city by city** — Bhopal, Nagpur, Indore, and so on.

**Opening one outlet is a long, repeatable, multi-department project:** find a property → evaluate it → sign the lease → build & theme the rooms → hire & train game masters → market → soft-launch → go live → close the books. A ready site goes live in roughly **45–60 days**.

**The real pain is not any single step — it's running many of these journeys at once**, in different cities, each at a different phase, when the people accountable (owner, director, expansion managers) cannot physically be everywhere. Today that lives in WhatsApp, Excel and memory. When the director asks *"where exactly is Nagpur, and why is it late?"* nobody has a clean answer.

**This system is the answer** — a live control tower over every city's launch, with every field, photo, approval and delay recorded and accountable.

---

## 2. What already exists in this repo (do NOT rebuild)

This is a **MERN modular-monolith ERP**. Module 1 is the **PMS**. It is real, seeded, and runnable (`npm run dev`). The building blocks:

| Concept | Where | What it is |
|---|---|---|
| **Template** | `server/.../pms/templates` | A reusable **playbook**: an ordered list of **stages**; each stage has **tasks** (with checklists, doers, dependencies), a **master-data schema** (dynamic fields to capture), an owner department, an SLA, and an optional **approval gate**. |
| **Stage** | inside a Template / Project | One phase of the journey (e.g. *Property Identification*). Carries order, colour, SLA, owner dept, its task list, its master-data field schema, and `requiresApproval`. |
| **Task** | `server/.../pms/tasks` | A unit of execution work under a stage: status, priority, department, assignees + backup buddy, planned/actual dates, checklist, dependencies, comments. |
| **Project** | `server/.../pms/projects` | **One outlet-opening journey in a city**, instantiated *from a Template*. Snapshots the template's stages (so the plan is immutable per project), materializes real Task documents on a cascaded timeline, tracks budget/health/progress, and stores captured **master data** per stage. |
| **Master Data** | `Project.masterData` | The captured answers for a stage's dynamic fields: `{ [stageKey]: { [fieldKey]: value } }`. |
| **Dashboard / Calendar / MIS** | `server/.../pms/*`, `client/.../features/*` | Portfolio summary, a month calendar of task deadlines, and analytics. |
| **Auth + RBAC** | `server/.../auth` | JWT (access + refresh), bcrypt, roles: **admin · manager · executor (doer) · viewer**. Every mutation is attributable. |
| **Activity log** | `server/.../pms/activity` | Append-only audit trail on meaningful mutations. |
| **Design system** | `client/src/styles`, `components/ui` | Hand-crafted "Vault" design tokens (light + dark) and UI primitives (cards, badges, modal, progress, avatars…). |

**The default seeded playbook is the client's official 10-phase workflow** (`server/src/seed/storeLaunchTemplate.js`, code `MR-PMS-STORE-LAUNCH`). Its stages `p1…p10` are exactly the PDF's phases:

```
p1  Property Identification      p6   Execution
p2  Site Evaluation              p7   Approval Workflow
p3  Commercial Finalization      p8   Store Readiness Checklist
p4  Project Creation             p9   Store Launch
p5  Department Planning          p10  Project Closure
```

Every phase, task, checklist row and field in that file is **editable in the template builder** — nothing is hard-coded into logic. That is the "fully dynamic" promise the client asked for, and it is already true at the workflow level.

---

## 3. The design pillars (the promises every screen keeps)

| Pillar | What it means in practice |
|---|---|
| **1. Dynamic workflow** | The 10 phases are a *default template*, not hard-coded. Admins add / remove / rename / reorder stages and tasks and save reusable templates. A future "kiosk" or "café add-on" can use a shorter playbook. |
| **2. Dynamic forms** | Each stage's capture form is built from configurable **fields** — text, number, currency, date, yes/no, dropdown, multi-select, file, user… Add or remove a field with **no code change**. |
| **3. Role-based & accountable** | Every action is tied to a person + timestamp in the activity log. Doers fill; managers approve; directors watch. Brokers are **external** — captured as data, not users. |
| **4. Gated progression** | Data flows forward only through explicit decisions. In Phase 1 a property advances only when **shortlisted**; rejected items are **kept** (with reason + who decided), never deleted. |
| **5. Centralized visibility** | One portfolio view shows every city, its current phase, progress, budget health and delay flags. Drill down anywhere. |

**Design bar:** *user-friendly first.* Clean, calm, obvious — a manager who has never seen the tool understands a screen in 10 seconds. **Modular code** (one folder per domain concept, thin controllers, small files) so the client's inevitable change-requests are cheap and safe.

---

## 4. The core mental model (read twice)

The single most important idea: **early phases narrow *many candidate properties* down to *one chosen outlet*; later phases build out that one outlet.**

```
        PROJECT = "open an outlet in <City>"   (e.g. Bhopal Expansion)
        │
   ┌────┴──────────────────────────────────────────────────────────┐
   │  SELECTION FUNNEL  (many candidates → one)                     │
   │  p1 Property Identification   ▸ ~10 candidate properties       │
   │        broker lines them up, a doer captures each              │
   │        ── shortlist / reject ──▶                               │
   │  p2 Site Evaluation           ▸ ~4 shortlisted survive         │
   │        feasibility · financial · technical · operational       │
   │        ── approve / reject ──▶                                 │
   │  p3 Commercial Finalization   ▸ 1 finalist locked as the site  │
   └───────────────────────────────┬───────────────────────────────┘
                                    │  the ONE property is locked
   ┌────────────────────────────────┴──────────────────────────────┐
   │  BUILD-OUT  (one outlet, many departments)                    │
   │  p4 Project Creation   p5 Department Planning   p6 Execution   │
   │  p7 Approval Workflow  p8 Store Readiness        p9 Launch     │
   │  p10 Project Closure                                           │
   └────────────────────────────────────────────────────────────────┘
```

A **Project** is one city's journey. Inside it, **candidate properties compete through p1–p3**; one wins and becomes the outlet that p4–p10 deliver.

---

## 5. The ONE new capability Phase 1 needs — **Stage Records (collection mode)**

Here is the crux, stated plainly.

Today a stage captures **one** master-data record per project: `Project.masterData.p1 = { broker_name, options_count, … }`. That is perfect for stages like *Commercial Finalization*, where there is a single set of lease terms.

But **Phase 1 is different.** The doer visits ~10 properties and captures **each one as its own row**, with its own fields, its own photos, and its own decision (**shortlist / reject**). One master-data record cannot hold ten properties. So we add a mode:

> **A stage can be `captureMode: 'single'` (one record — today's behaviour, unchanged) or `captureMode: 'collection'` (many records — a table of rows).**
> A **`Record`** is one row: a dynamic form instance (`values`) + a `status` + attachments + who created it. Phase 1's "10 properties" are 10 `Record`s on stage `p1`.

This is additive — every existing single-mode stage behaves exactly as before. Only stages flagged `collection` (Phase 1, and later Phase 2's assessments) use records.

**The gate:** a `Record` on `p1` with `status: 'shortlisted'` is *the* signal that a property advances. Phase 2 (built next) simply lists the shortlisted `p1` records as its subjects. Nothing is deleted; rejected rows stay, filtered, with their reason.

The concrete build of this — model, endpoints, UI — is [`02-Phase-1-Build-Spec.md`](02-Phase-1-Build-Spec.md).

---

## 6. Domain model (grounded in the real code)

Names in `code` are the real entities. **Bold** marks what Phase 1 adds.

```
Template ──< stages[] (embedded)
                ├── tasks[]            (blueprint tasks → real Task docs per project)
                ├── masterDataSchema[] (the dynamic FIELD definitions)
                ├── captureMode        ← 'single' | 'collection'  (NEW)
                └── requiresApproval

Project (instantiated from a Template)
   ├── stages[]         (snapshot: status, planned/actual dates, approval)
   ├── masterData       ({ [stageKey]: {…} })  ← single-mode captured values
   ├── budget / health / progress / currentStageKey
   └──< Task docs        (real execution tasks on a cascaded timeline)

Record (NEW) ──> belongs to a Project + a stageKey (collection-mode stages)
   ├── values           (the dynamic answers — one row)
   ├── status           draft | submitted | shortlisted | rejected | approved | locked
   ├── attachments[]    (photos / video / files per field)
   ├── decidedBy / decidedAt / decisionReason
   └── createdBy

Activity (audit)   User + Role (admin/manager/executor/viewer)
```

**Field types available** (`MASTER_DATA_FIELD_TYPES`): `text` · `textarea` · `number` · `currency` · `date` · `boolean` (yes/no) · `select` · `multiselect` · `file` · `user`. New types (e.g. rating, checklist) are a one-file addition to the renderer.

**Why Mongo fits:** form *definitions* are structured metadata (the `masterDataSchema` field list); form *answers* live as an embedded free-form `values` object (on `Project.masterData` for single-mode, on a `Record` for collection-mode), validated against the definition at save time. A stage with 4 fields and one with 40 are just documents of different shapes — no migrations, no 200-nullable-column table, no EAV pain.

---

## 7. Roles & permissions (as implemented)

| Role | Can do | Person |
|---|---|---|
| **admin** | Everything — config, templates, employees, delete. | Owner / super-admin |
| **manager** | Owns projects; assigns work; **makes shortlist / approve / reject decisions**; edits records. | Director, expansion manager |
| **executor** (doer) | Fills forms and tasks for their area; creates/edits their own records; **cannot decide**. | Field staff, dept executives |
| **viewer** | Read-only dashboards, MIS, detail. | Stakeholders, investors |
| **broker** | **Not a user.** Name/phone/agency captured as record *fields*. |

---

## 8. Data flow between phases — the gate

```
p1: ~10 property Records, status ∈ {draft, submitted, shortlisted, rejected}
                         │  manager clicks "Shortlist" on ~4
                         ▼
p2: opens showing ONLY those shortlisted properties as its subjects.
    Each gets its assessment data (feasibility/financial/technical/ops),
    fillable by different doers; a Master comparison view lays them side by side.
                         │  manager "Approves" 1–2
                         ▼
p3: opens showing ONLY the approved finalist(s); one is "Locked" as the site.
                         ▼
p4+: the project is now about that one outlet.
```

Rejected properties are never deleted — they stay under a "Rejected" filter with the reason and decider, so every decision is auditable.

---

## 9. Key screens (UX map)

1. **Portfolio Dashboard** *(control tower)* — per-city cards: current phase, progress, budget health, on-track/at-risk/delayed. *(built)*
2. **Project Detail** — a horizontal **phase stepper** across the top; tabs for Overview / Task Board / **Master Data** / Activity; click a phase for its detail. *(built)*
3. **Phase workspace (Phase 1)** — inside the Master Data area, a collection-mode stage shows an **"➕ Add Property"** button, the **Records table** with status chips + filter tabs, and per-row **Shortlist / Reject / View**. *(this milestone)*
4. **Record detail drawer** — all captured values, photo/video gallery, decision buttons, per-record activity. *(this milestone)*
5. **Master / comparison view** — Phase 2's side-by-side grid of candidates × assessments. *(next milestone)*
6. **Template builder** — design/edit workflow templates, stages, tasks and fields. *(built; extend for captureMode + field editing)*

**Mobile matters for capture.** The Phase-1 doer stands inside a property with a phone, shooting photos and a walkthrough. That form must be mobile-friendly (big inputs, camera upload, save-as-draft). Dashboards stay desktop-first.

---

## 10. Architecture & stack (as built)

| Layer | Choice |
|---|---|
| **Backend** | Node 20, **Express 4**, **MongoDB + Mongoose**, modular monolith (`modules/<domain>/{model,service,controller,routes,validation}.js`). |
| **Auth** | JWT access+refresh, bcrypt, RBAC middleware. |
| **Validation** | **Zod** at the route boundary (`validate` middleware). |
| **Security/ops** | Helmet, CORS, rate-limit, mongo-sanitize, hpp, compression; Winston logging. |
| **Frontend** | **React 18 + Vite**, React Router, **TanStack Query**, React Hook Form, Recharts. |
| **Design** | Hand-crafted design-token system (light + dark), UI primitives. |
| **Response contract** | `{ success, message, data, meta }` via `ApiResponse`; API under `/api/v1`, PMS under `/pms/*`. |

**Non-negotiables (client asked for these, and the repo honours them):**
- **Modular, not one giant file** — one folder per domain concept; thin controllers; logic in services.
- **Config over code** — phases, tasks, fields and approvals are *data*, so "add a field / a step" is a settings change.
- **Everything auditable** — write to the activity log on every meaningful action.

---

## 11. Folder structure (real)

```
server/src/
  config/            env, logger, database
  core/              middleware (auth, validate, error), utils, constants
  modules/
    auth/
    pms/
      templates/     template.{model,service,controller,routes,validation}.js
      projects/
      tasks/
      records/       ← NEW (Phase 1: collection-mode rows)
      activity/  dashboard/  calendar/  mis/
  routes/            versioned aggregation (/api/v1)
  seed/              storeLaunchTemplate.js (default 10-phase), franchiseTemplate.js

client/src/
  app/ components/{ui,layout,charts}
  features/
    dashboard/ templates/ projects/ tasks/ calendar/ mis/ employees/
    projects/records/   ← NEW (RecordsPanel, RecordFormModal, RecordDetailDrawer, DynamicField)
  lib/ (api, queries, format, ui)  styles/ (tokens, globals)
```

---

## 12. Build roadmap (vertical slices)

- **M0 — Foundation** — repo, stack, auth/RBAC, templates, projects, tasks, dashboard, calendar, MIS. **✅ done.**
- **M1 — Phase 1 end-to-end** *(current)* — Stage Records (collection mode): add-property form (dynamic, mobile-friendly, attachments), records table + status chips + filters, shortlist/reject decisions with audit, and the `shortlisted` gate endpoint. **← we are here.**
- **M2 — Phase 2 + Master view** — shortlisted properties flow into Site Evaluation; four assessment groups by different doers; side-by-side comparison; approve/reject.
- **M3 — Field/form builder polish** — edit `masterDataSchema` + `captureMode` visually in the template builder; real file-upload pipeline (presigned URLs / storage).
- **M4 — Phases 3–4** — commercial finalization + project creation (lock the outlet).
- **M5 — Execution (5–7)** — department planning, task tracking, dependencies, delays, approvals. *(much already exists via Tasks.)*
- **M6 — Readiness → Launch → Closure (8–10)** — checklist, go-live, retrospective & reports.

Rationale: **Phase 1 alone proves the whole pattern** (dynamic form → rows → decision → gate). Everything after is that pattern repeated and enriched — which is exactly why the code must stay modular.

---

## 13. Open questions to confirm with the client (none block Phase 1)

1. **Attachments** — expected photo/video sizes? Where do we store binaries — cloud object storage (S3/R2 with presigned URLs) or self-hosted? *(M1 captures attachment references; the binary-upload pipeline is M3.)*
2. **Hosting / data residency** — India region (Mongo Atlas Mumbai)? Cloud vs on-prem?
3. **Existing data** — any current Excel/sheet of properties or projects to import?
4. **Languages** — English only, or Hindi/regional too?
5. **Broker** — data-only (recommended), or eventually a limited broker portal?

---

## 14. What happens next

We build **M1: Phase 1, end-to-end**, exactly as detailed in [`02-Phase-1-Build-Spec.md`](02-Phase-1-Build-Spec.md) — the concrete model, endpoints, screens, statuses, and the gate that hands shortlisted properties to Phase 2. It is written so a developer (or another AI assistant) can pick it up and start immediately.
