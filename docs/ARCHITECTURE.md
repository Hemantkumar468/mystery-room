# Architecture

## Guiding principles

1. **Modular monolith.** One deployable app, many self-contained business modules. A module owns
   its models, services, controllers, routes, and validation. Modules never import each other's
   internals — they talk through exported services only. This keeps the ERP easy to reason about
   now and cheap to split into services later.
2. **Feature-first folders.** Code is grouped by _business capability_ (templates, projects,
   tasks…), not by technical type. Adding a module = adding a folder, then registering its router.
3. **Thin controllers, fat services.** Controllers do HTTP (parse, validate, respond). Services
   hold business logic and are unit-testable without Express. Models hold persistence + schema
   rules only.
4. **Everything validated at the edge.** Zod schemas guard every write route; nothing untrusted
   reaches a service.
5. **One error contract.** `ApiError` + the global error handler produce a single, predictable
   JSON error shape. Success responses use `ApiResponse`.

## Backend layering

```
Request
  → route (mounts middleware: auth, validate(schema))
    → controller (asyncHandler wraps; parses req, calls service, sends ApiResponse)
      → service (business logic, orchestration, transactions)
        → model (Mongoose schema, indexes, hooks, statics)
Response ← ApiResponse | ApiError (→ errorHandler)
```

### Module anatomy

Every module folder follows the same shape:

```
modules/<domain>/<feature>/
  <feature>.model.js        # Mongoose schema, indexes, virtuals, statics
  <feature>.service.js      # business logic (pure-ish, testable)
  <feature>.controller.js   # HTTP glue
  <feature>.routes.js       # express.Router(), middleware wiring
  <feature>.validation.js   # Zod request schemas
```

Modules are registered in [`server/src/routes/index.js`](../server/src/routes/index.js). To add a
new ERP module (e.g. CRM), create `modules/crm/**`, export a router, and mount it there. No other
file changes.

Registered today:

| Mount | Module |
| --- | --- |
| `/auth` | authentication & user directory |
| `/pms` | Project Management System |
| `/org` | organisation layer — branches, teams, groups, categories/tags, holidays, people, notifications, ops audit log |
| `/delegation` | delegated tasks and their lifecycle ([details](DELEGATION_CHECKLIST.md)) |
| `/checklist` | recurring routines and their dated occurrences |
| `/performance` | KRA report and scoreboard, derived from delegation + checklist |
| `/files` | evidence / proof / reference uploads |

Cross-module reactions (a group deleted, a category renamed, a holiday declared) go through the
small hook registry in `modules/org/org.events.js`, so the org module never imports delegation or
checklist internals. Scheduled work lives in `server/src/jobs/` and runs in the business timezone.

## PMS domain model

```
User ──assignee──┐
                 │
Template ──(instantiated as)──▶ Project ──has many──▶ Task
  │  stages[]                     │  stages[] (snapshot)   │ assignee, dates,
  │   ├─ tasks[] (blueprint)      │  masterData{}          │ status, SLA, checklist
  │   └─ masterDataSchema[]       │  progress, health      │
  └─ versioned, publishable       └─ per-city instance     └─ drives Board / Calendar / MIS
```

- **Template** — the reusable blueprint. Ops designs stages, the ordered tasks inside each stage,
  per-task defaults (assignee role, estimate, priority, dependencies, checklist), and the
  **master-data schema** that must be captured at each stage. Templates are versioned and
  publishable so live projects aren't disturbed by edits.
- **Project** — a template instantiated for one city/site. It snapshots the template's stages so
  the plan is immutable per project, tracks live state (progress %, current stage, health), holds
  the captured master data, and rolls up budget planned-vs-actual.
- **Task** — the atomic unit of work, a separate collection for fast board/calendar/MIS queries.
  Carries planned vs actual dates & hours, dependencies, checklist, and derived SLA/on-time flags.
- **Activity** — append-only audit trail for every meaningful mutation.

Derived layers (no own collection, computed via aggregation):

- **Dashboard** — portfolio counts, health mix, overdue tasks, upcoming milestones, city spread.
- **MIS** — on-time %, per-stage cycle time, planned-vs-actual, throughput, assignee load, SLA
  breaches.
- **Calendar** — tasks + milestones projected into date-range events.

## Conventions

- Async controllers/services are wrapped in `asyncHandler`; never `try/catch` for flow control.
- IDs referenced across modules are Mongo `ObjectId`s; human-facing codes (`MR-PUN-001`) are
  generated in services.
- All timestamps are UTC in the DB; the client localizes.
- Config is read **once** at boot from validated env (`config/index.js`) — never `process.env`
  scattered through code.
