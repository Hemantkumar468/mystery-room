# Data Explorer — As-Built Reference

`/data-explorer` · `client/src/features/projects/DataExplorerPage.jsx` (664 lines)
· nav key `data-explorer` · **v1, as it stands on branch `HEM_3SEP`**

This is the auditor's walk through one project: pick a launch, step through its
phases left to right, and read every form entry and every task as spreadsheet
rows — who filed what, when, whether the date was kept, and what was decided.

Everything below is read off the live code, not off a plan. Where the code and
the in-app guide disagree, the code wins and the disagreement is written down.

---

## 1. Where it lives

| | |
|---|---|
| Route | `/data-explorer` — [App.jsx:130](client/src/App.jsx#L130), wrapped in `<Gate k={NAV_KEYS.DATA_EXPLORER}>` |
| Component | [DataExplorerPage.jsx](client/src/features/projects/DataExplorerPage.jsx) |
| Sidebar | [Sidebar.jsx:55](client/src/components/layout/Sidebar.jsx#L55), icon `Table2` |
| Nav key | `DATA_EXPLORER: 'data-explorer'` — [navPolicy.js:39](client/src/lib/navPolicy.js#L39) |
| Verdict engine | [client/src/lib/deliveryStatus.js](client/src/lib/deliveryStatus.js) *(untracked — new on this branch)* |
| Styles | `.dx-*` in [projects.css:2960-3067](client/src/styles/projects.css#L2960-L3067) |
| Guided tour | `data-explorer` guide, 3 steps — [guides.js:259](client/src/features/guide/guides.js#L259) |

### Who can open it

From [navPolicy.js](client/src/lib/navPolicy.js) — the key appears in four role
lists:

| Role | Has Data Explorer |
|---|---|
| MD | yes |
| EA | yes |
| Manager | yes |
| Viewer | yes (read-only role) |
| Employee | **no** — not in the employee nav list |

### Ways in

1. Sidebar → **Data Explorer** (opens with no project chosen).
2. [ProjectTree.jsx:233](client/src/features/projects/ProjectTree.jsx#L233) —
   *"Data Explorer — every entry, phase by phase →"*, deep-linked as
   `/data-explorer?project=<id>`.

### URL state

Two search params, both written with `replace: true` so the walk does not fill
the back button:

| Param | Meaning |
|---|---|
| `project` | project `_id`. Changing it **clears** `phase`. |
| `phase` | stage `key` (`p1`, `p3`, `p20`…) |

---

## 2. What it fetches — four queries, two of them whole-project

| # | Hook | Call | Why |
|---|---|---|---|
| 1 | `useProjects({ limit: 200 })` | list | fills the project picker |
| 2 | `useProject(projectId)` | one project | gives `project.stages[]` (the per-project snapshot) |
| 3 | `useTemplate(templateId)` | one template | gives `masterDataSchema` + `assessmentTypes` — the **column definitions** |
| 4 | `useStageRecords(projectId, undefined, {}, { enabled })` | **all records of the project** | one fetch, grouped client-side by `stageKey` |
| 5 | `useTasks({ project, limit: 1000 })` | **all tasks of the project** | same — grouped client-side by `stageKey` |

`useStageRecords` normally requires a `stageKey`; here it is called with
`undefined` and an explicit `enabled: Boolean(projectId)` override, which is
what makes it return the whole project.

**Why whole-project and not per-tab:** a phase tab's colour is derived from that
phase's tasks. Fetching a phase at a time would mean the tab bar could not be
painted until you had already clicked every tab — the one thing the colours
exist to save you from. Both results are reduced into `Map<stageKey, [...]>`
(`byStage`, `tasksByStage`) inside `useMemo`.

`templateId` is read defensively: `project?.template?.ref?._id || project?.template?.ref`
— the field is sometimes populated, sometimes a raw ObjectId.

---

## 3. The screen, top to bottom

```
┌ Topbar ─────────────────────────────────────────────────────────────┐
│ 🔲 Data Explorer                                                     │
│ Every entry of every phase, laid out like a spreadsheet — who filed  │
│ what, when, whether the date was kept, and what was decided          │
└──────────────────────────────────────────────────────────────────────┘
  [ Pick a launch…  ▾ ]        Open the project →

  ── What the colours mean ──────────────────────────────────────────
  ● Completed on time  ● Completed late  ● Delayed  ● In progress
  ● Not started                Anything late carries the days it slipped.

┌ card ────────────────────────────────────────────────────────────────┐
│ ●Phase 1 ⁴  ●Phase 2 ⁸  ●Phase 3 ³  ●Phase 4 …   ← step tab bar      │
│ ─────────────────────────────────────────────────────────────────    │
│ ● Phase 3 — Commercial Closure  [Delayed by 4 days]                  │
│   Planned to close 12 Aug 2026 · 3 entries · 5 tasks                 │
└──────────────────────────────────────────────────────────────────────┘

┌ card ─ the phase's entries ──────────────────────────────────────────┐
│ Click a row to open just that entry's form…        [ Export CSV ]    │
│ # | Form | Title | …every filled field… | Status | Filed by | …      │
└──────────────────────────────────────────────────────────────────────┘

┌ card ─ Tasks in this phase ──────────────────────────────────────────┐
│                                                    [ Export CSV ]    │
│ Code | Task | Assignee | Department | Planned | Done on | Status |…  │
└──────────────────────────────────────────────────────────────────────┘
```

### Empty / loading states

| Condition | What shows |
|---|---|
| no `project` param | `EmptyState` — *"Pick a launch to walk through"* |
| project or records still loading | `SkTable rows={4}` |
| phase has no records | `EmptyState` — *"Nothing filed in this phase yet"* |
| phase has no tasks | `No tasks in this phase.` |
| tasks still loading | `SkTable rows={3}` |

### Which phase opens first

`useEffect` picks, in order: the first phase whose verdict is `in_progress`,
else the first `delayed`, else `stages[0]`. A `?phase=` in the URL wins over all
of it (it seeds `stageKey` directly).

---

## 4. The delivery verdict — one answer, one colour, everywhere

`lib/deliveryStatus.js`. **Five states, and only five.** They are about
*delivery against a promised date*, not about workflow status — "complete"
alone says nothing about whether the date was kept, and that is the question a
reviewer is actually asking.

| State | Colour | Soft | Means | Label reads |
|---|---|---|---|---|
| `done_on_time` | `#059669` green | `#DCFCE7` | finished on or before planned date | `Completed on time` / `Completed · N days early` / `Completed` (no dates) |
| `done_late` | `#D97706` amber | `#FEF3C7` | finished after it | `Completed · N days late` |
| `delayed` | `#DC2626` red | `#FEE2E2` | planned date passed, still open | `Delayed by N days` |
| `in_progress` | `#2563EB` blue | `#DBEAFE` | underway, inside its date | `In progress · N days left` |
| `not_started` | `#6B7280` grey | `#F3F4F6` | nothing recorded yet | `Not started · due in N days` |

Legend order: `DELIVERY_ORDER = [done_on_time, done_late, delayed, in_progress, not_started]`
— the two finished states first, then the live ones. Sorting the **On time?**
column sorts by index into this array, so the delayed rows collect at one end.

Days are whole days, both sides truncated to midnight (`dayDiff`), so a 4 pm
completion on the due date reads as **0 days late**, not "part of a day".

**Colours are literal hex, not `var(--success)`** — so the same value can be
handed to a chart, an inline style or a CSS custom property. They match
`tokens.css` exactly.

### `taskDelivery(task)`

```
plannedEnd  = task.plannedEnd || task.dueAt
completedAt = task.completedAt
started     = task.status !== 'pending'
complete    = task.status === 'complete'
```

### `phaseDelivery(stage, tasks)`

```
complete    = tasks.length > 0 && every task complete
started     = some task !== 'pending'
plannedEnd  = stage.plannedEnd || latest(task.plannedEnd || task.dueAt)
completedAt = complete ? (stage.completedAt || latest(task.completedAt)) : null
```

Two deliberate rules here:

- **Derived from the tasks, never from `stage.status`.** The project stage
  snapshot has no `status` field at all — progress is computed from the tasks
  server-side on every read (`phaseProgress.js`). That is why every phase used
  to report "Not started" however finished it was.
- **A phase with no tasks is `not_started`, not complete.** Nothing-to-do and
  everything-done look identical to a counter and are opposite to a person.

---

## 5. The step tab bar

One `<button role="tab">` per phase, in `order` ascending, carrying:

- the delivery dot in the phase's verdict colour (`--tone`, `--tone-soft`),
- the literal words `Phase 1`, `Phase 2`… — **the index, not the phase name**,
- a count badge, only when the phase has ≥ 1 record,
- `title="<phase name> — <verdict label>"` as the only place the name appears
  before you click.

Under the bar, the active phase's heading: dot, `stage.name`, a
`DeliveryBadge`, then `Planned to close <date> · N entries · N task(s)`.

---

## 6. The records sheet

### How the columns are chosen

1. Collect every key that appears in **any** record's `values` on this phase →
   `used`.
2. Build the candidate field list:
   - phase has `assessmentTypes` → `[...masterDataSchema, ...every type's masterDataSchema]`
   - otherwise → `masterDataSchema` alone.
3. De-duplicate by `key` (first definition wins), then keep only fields in `used`.

So the sheet is **sparse by design** — a field nobody has filled in anywhere in
the phase does not become an empty column. The schema comes from the
**template**, the values from the **records**.

### Columns

| Column | Sort key | Source |
|---|---|---|
| `#` | — | row index after sorting (1-based) |
| `Form` *(only if the phase has assessment modules)* | `__form` | `assessmentType` → module `name` |
| `Title` | `__title` | `record.title` |
| …one per used field… | field `key` | `record.values[key]` |
| `Status` | `__status` | `record.status` + `rejectReason` under it in red |
| `Filed by` | `__by` | `submittedBy.name \|\| createdBy.name` |
| `Filed on` | `__on` | `submittedAt \|\| createdAt` |
| `Decided by` | `__decided` | `approvedBy \|\| rejectedBy \|\| decidedBy`, with `approvedAt \|\| rejectedAt` under it |
| `Form` (button) | — | `Open form` |

### Sorting

`useSort()` — click a header to sort ascending, click again to flip, click a
third time to clear. Numeric when *both* values parse as finite numbers and
round-trip as the same trimmed string; `localeCompare` otherwise.

### How a cell renders (`CellValue`)

| Value shape | Renders as |
|---|---|
| `null` / `undefined` / `''` | `—` (muted) |
| array containing `{url}` objects | one `.dx-file` link per file, `name \|\| originalName \|\| "file N"`, `target="_blank"` |
| any other array | joined with `, ` (objects `JSON.stringify`d) |
| `{lat, lng}` both finite | Google Maps link, `lat.toFixed(4), lng.toFixed(4)` |
| `{mapUrl}` | link reading `map` |
| `{url}` | file link |
| any other object | `JSON.stringify` |
| boolean | `Yes` / `No` |
| string matching `^\d{4}-\d{2}-\d{2}` | `fmtDateTime` if longer than 10 chars, else `fmtDate` |
| anything else | as-is |

`cellText()` is the same logic for CSV: files collapse to **space-joined URLs**,
locations to `lat, lng`.

### Record status vocabulary — and its gap

```js
RECORD_STATUS_LABEL = {
  draft:       'Draft',
  submitted:   'Waiting for review',
  approved:    'Approved',
  shortlisted: 'Shortlisted',
  rejected:    'Changes requested',
}
RECORD_STATUS_TONE = {
  approved:    var(--success),
  shortlisted: var(--primary),
  submitted:   var(--warning),
  rejected:    var(--danger),
}
```

> ⚠️ **Known gap.** `RECORD_STATUS` on the server
> ([core/constants/index.js:258](server/src/core/constants/index.js#L258)) has
> **eight** values: `draft, submitted, shortlisted, evaluation_in_progress,
> rejected, approved, archived, locked`. Three of them —
> `evaluation_in_progress`, `archived`, `locked` — have no label and no tone
> here, so they fall through to the raw database string in grey. Same class of
> bug as the task-status one that was already fixed below.

### Task status vocabulary

```js
TASK_STATUS_LABEL = { pending: 'Not started', processing: 'In progress', complete: 'Complete' }
```

Matches `TASK_STATUS` on the server exactly. The comment in the file records
that the map which stood here previously spoke `todo / in_progress /
waiting_approval` — a vocabulary the server stopped sending — so every row
silently fell through to the raw string.

> Note: the Data Explorer shows `status` only. `Task.approvalState`
> (`none / waiting_department / waiting_management / approved / rejected`) is a
> **second, independent axis** — a task can be complete and unsigned — and it is
> **not surfaced anywhere on this page**.

---

## 7. The tasks sheet

| Column | Sort key | Source |
|---|---|---|
| `Code` | `code` | `task.code` |
| `Task` | `title` | `task.title` |
| `Assignee` | `assignee` | `assignee.name` |
| `Department` | `department` | `task.department` |
| `Planned` | `plannedStart` | `plannedStart → plannedEnd`, both `fmtDate` |
| `Done on` | `completedAt` | `completedAt`, with `by <completedBy.name>` under it |
| `Status` | `status` | `TASK_STATUS_LABEL`, tinted by the **delivery** colour |
| `On time?` | `__timing` | `DeliveryBadge` (sorted by `DELIVERY_ORDER` index) |
| `Open` | — | `Link` → `/projects/:id/tasks/:code` |

Each row carries `class="dx-row-tone"` with `--tone` set to the verdict colour,
which paints a 3px inset bar down the first cell.

---

## 8. CSV export

Two buttons, one per sheet. Both write UTF-8 **with a BOM** (`﻿`) so Excel
opens ₹ and non-ASCII names correctly, escape every cell by doubling `"`, and
trigger a synthetic `<a download>` click on an object URL that is revoked
immediately after.

**Records** → `<PROJECT_CODE>-<stageKey>-records.csv`

```
No, [Form,] Title, <one column per used field's label>,
Status, Filed by, Filed on, Decided by, Decided on, Reject reason
```

**Tasks** → `<PROJECT_CODE>-<stageKey>-tasks.csv`

```
Code, Task, Assignee, Department, Planned start, Planned end,
Completed on, Status, On time?, Days late
```

Both export **the sorted rows**, so what you exported is what you were looking
at. Dates in the CSV are raw ISO strings, not `fmtDate` output — deliberate, so
Excel can parse them.

> ⚠️ **Guide vs code.** The in-app guide claims the export carries *"EVERY field
> of every record — not just the visible columns"*
> ([guides.js:252](client/src/features/guide/guides.js#L252)). It does not: the
> CSV uses the same `fields` array as the table, which is already filtered to
> fields that at least one record filled in. In practice the two statements
> agree unless a record holds a value whose key is in no schema at all.

---

## 9. The record form modal — one click, one form

Clicking a row (or its **Open form** button) opens `RecordFormModal` with
`readOnly`.

- **A single piece of state.** `openForm` refuses to replace an already-open
  record, so a double click — or a click landing on both the row and the button
  inside it — cannot stack a second form or swap the one you are reading.
- **Links are exempt.** `rowClick` bails on `e.target.closest('a, button')`, so
  file and map links keep their own destination.
- **Changing what you look at closes it.** Switching project or phase sets
  `openRecord` to `null` — a Phase 2 form left hanging over Phase 7's sheet is a
  misread waiting to happen.

### Which schema the modal uses

`openSchema` resolves, in order:

1. the record's own `assessmentType` module's `masterDataSchema`, so clicking
   Feasibility opens the **Feasibility** form, not the phase's generic one;
2. else the phase's `masterDataSchema`;
3. else a single placeholder textarea reading *"This phase has no form defined
   in its template"*, whose body points the reader back at the table behind it.

### `meta` passed to the modal

`typeLabel`, `submissionNo` (the row's `#`), `submittedBy`, `submittedOn`,
`statusLabel`, `statusColor`, `decidedBy`, `decidedOn`, `rejectReason`.

---

## 10. CSS surface — `projects.css:2960-3067`

| Class | Role |
|---|---|
| `.dx-steps` / `.dx-step` / `.dx-step-num` / `.dx-step-name` | an **older card-style step list — no longer rendered** by the page |
| `.dx-tabbar-card`, `.dx-tabbar`, `.dx-tab`, `.dx-tab-count` | the live step tab bar |
| `.dx-section-title`, `.dx-section-name`, `.dx-section-meta` | the active phase heading |
| `.dx-legend`, `.dx-legend-title`, `.dx-legend-item`, `.dx-legend-note` | the colour key |
| `.dx-verdict`, `.dx-verdict.is-sm` | the verdict pill |
| `.dx-dot` | the tone dot, used by legend / tab / heading / pill alike |
| `.dx-scroll`, `.dx-table`, `.dx-th`, `.dx-status`, `.dx-file` | the sheets |
| `.dx-row-tone` | inset colour bar on task rows |
| `.dx-row-open` | pointer cursor + hover tint on clickable record rows |

Every one of them drives colour through a single `--tone` custom property, which
is why one verdict object can paint five different components without any of
them knowing about `deliveryStatus.js`.

---

## 11. What v1 does **not** do

These are the honest gaps, and they are the input to
[DATA_EXPLORER_V2_SPEC.md](DATA_EXPLORER_V2_SPEC.md).

| # | Gap |
|---|---|
| 1 | **No lineage.** A phase is shown alone. Standing on *Phase 3 — Commercial Closure* there is nothing on screen saying what Phase 2 decided, which property was selected, or what Phase 3 unlocks. |
| 2 | **No client / owner identity.** The header names the page, never the launch. No client, city, owner, template, planned-vs-actual, or "currently in Phase N of 15". PMS `Project` has **no `client` field at all** — the nearest identity is `name / code / city / owner`, and CRM `companies` are not linked to a project. |
| 3 | **Phase tabs say "Phase 1", not the phase name.** The name is in a `title` tooltip only. |
| 4 | **Task lineage is invisible.** `parentTaskRef`, `brief.what/who/when/how`, `approval.approver`, `extensionRequests`, `transfers` are all on the model and none are shown. |
| 5 | **Record lineage is invisible.** `parentRecordId` (assessment → the property it assesses) and `decisionHistory` (the append-only reject-then-approve trail) are never rendered — only the *latest* decision stamp is. |
| 6 | **Gate and exit criteria are not shown.** `stage.exitCriteria`, `stage.gate {label, approver, unlocks}`, `stage.requiresApproval`, `stage.approverRoles`, `stage.whatWhoWhenHow`, `stage.parallelGroup` are all snapshotted onto the project and none reach the screen. |
| 7 | **No cross-phase view.** No "everything filed in this project", no filter by person, no filter by date range, no search. One phase at a time only. |
| 8 | **Three record statuses render raw** (§6). |
| 9 | **`approvalState` never shown** — a complete-but-unsigned task looks finished. |
| 10 | **CSV only, per sheet.** No whole-project export, no XLSX, no PDF. |
| 11 | **`limit: 1000` on tasks, `limit: 200` on projects** — silent truncation past those, with no "showing 1000 of N" anywhere. |
| 12 | **No empty-schema warning.** If the template lost a field the records still hold, its values are invisible in the table *and* in the CSV. |
