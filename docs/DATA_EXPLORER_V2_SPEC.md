# Data Explorer v2 — "the walk, with its context"

Spec for the next version of `/data-explorer`. Companion to
[DATA_EXPLORER_REFERENCE.md](DATA_EXPLORER_REFERENCE.md), which describes v1
exactly as it is today. **Nothing here is built yet.**

---

## 1. The problem, in one screen

> Somebody is standing on **Phase 3 — Commercial Closure**. The sheet tells
> them what was filed *in Phase 3*. It does not tell them what Phase 2 decided,
> **which property was actually selected**, who signed it off, what Phase 3 is
> supposed to hand to Phase 3B, or which task they are picking up from.
>
> Every fact needed to answer that is already in the database. None of it is on
> the screen.

v1 renders **one phase, in isolation**. A launch is a chain — Property →
Evaluation → Commercial → Planning → Design → BOQ → PO → Civil → QC →
Install → Test → Readiness → Opening → Closure — and the Data Explorer is the
one screen where the chain should be readable end to end.

v2 does not add a new page. It adds **lineage and identity** to the page that
already exists.

### The four questions v2 must answer without a second click

| # | Question | v1 answer |
|---|---|---|
| 1 | *Whose launch is this, and where has it got to?* | nothing — the header names the page, not the project |
| 2 | *What came before this phase, and what did it decide?* | nothing |
| 3 | *What does this phase owe the next one?* | nothing |
| 4 | *What is my task the continuation of?* | nothing |

---

## 2. What v2 looks like

```
┌ LAUNCH HEADER ──────────────────────────────────────────────────────────┐
│ Baner Hub, Pune            MR-PUN-004     ● Delayed by 6 days           │
│ Client: Mystery Rooms (own outlet) · Owner: A. Kulkarni · 4,200 sq.ft   │
│ Template: MR-PMS-CLIENT-FLOW v2 · Plan 12 Mar → 16 Sep · Actual 19 Mar →│
│ ▓▓▓▓▓▓▓▓▓▓░░░░░  Phase 3 of 15 — Commercial Closure                     │
└──────────────────────────────────────────────────────────────────────────┘

  ● Completed on time  ● Completed late  ● Delayed  ● In progress  ● Not started

┌ STEP BAR ───────────────────────────────────────────────────────────────┐
│ ●1 Property ⁴  ●2 Site Eval ⁸  ●3 Commercial ³  ○4 Planning  ○5 Design…│  ← names, not "Phase 3"
└──────────────────────────────────────────────────────────────────────────┘

┌ LINEAGE RAIL — the heart of v2 ─────────────────────────────────────────┐
│ ◀ CAME BEFORE            ▶ YOU ARE HERE            UNLOCKS NEXT ▶       │
│                                                                          │
│ Phase 2 — Site Evaluation  Phase 3 — Commercial     Phase 3B — Planning  │
│ ● Completed · 3 days late  ● Delayed by 4 days      ○ Not started        │
│ Closed 22 Jul · MD signed  5 tasks · 3 entries      Starts when LOI      │
│                            Planned close 12 Aug     is approved          │
│ IT HANDED OVER             EXIT CRITERIA            IT WILL NEED         │
│ · Property: Baner Hub      LOI approved and lease   · confirmed_area     │
│ · Area: 4,200 sq.ft        executed; downstream      · target_opening    │
│ · 4 assessments approved   streams released         · selected_games     │
│ · Decided by: MD, 22 Jul   Gate: Management                              │
│                                                     [ open Phase 3B → ]  │
└──────────────────────────────────────────────────────────────────────────┘

┌ Entries in this phase ──────────────── [All entries ▾] [Export ▾] ──────┐
│ # │ Form │ Title │ …fields… │ Status │ Filed by │ Filed on │ Decided by │
│ ▸ 1 │ LOI │ LOI-0041 │ … │ Approved │ R. Shah │ 04 Aug │ MD, 06 Aug    │
│   └─ came from: Property "Baner Hub" (Phase 1) → Assessment (Phase 2)   │
└──────────────────────────────────────────────────────────────────────────┘

┌ Tasks in this phase ────────────────────────────────────────────────────┐
│ Code │ Task │ Comes after │ Assignee │ Planned │ Done │ Status │ Sign-off│
│ T014 │ Issue LOI │ T013 Select property │ R. Shah │ … │ … │ ✓ │ Approved│
│  ▸ what/who/when/how · 3 of 3 checklist · 1 extension approved (+2d)     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Feature by feature

### F1 — Launch header (answers Q1)

Replaces the naked `<select>`. The picker moves into the header as a compact
switcher; the header itself always states **which launch you are reading**.

| Line | Fields | Source |
|---|---|---|
| Title | `name`, `code`, whole-project delivery verdict | `project`, new `projectDelivery()` |
| Identity | **client**, `owner.name`, `city`, `areaSqft` | `project` (+ see below) |
| Plan | `template.name` `v{version}`, `plannedStartDate → targetEndDate`, `actualStartDate → actualEndDate` | `project.template`, `project` |
| Position | progress bar + `Phase N of M — <name>` | derived from `verdictByStage` |

> **On the word "client".** `Project` has **no `client` field**. There is a CRM
> module with `companies` and `contacts`, but no PMS project links to it. Two
> honest options — pick one before building this line:
>
> - **(a) Own-outlet model** *(recommended, zero schema change)* — "client" is
>   the outlet itself. Render `name · code · city` as the identity and label the
>   accountable person as **Owner**, not Client.
> - **(b) Real client model** *(schema change)* — add to `project.model.js`:
>   ```js
>   client: {
>     name:    { type: String, trim: true },
>     kind:    { type: String, enum: ['own', 'franchise', 'partner'] },
>     company: { type: Schema.Types.ObjectId, ref: 'Company' }, // CRM link
>     contact: { type: Schema.Types.ObjectId, ref: 'Contact' },
>   }
>   ```
>   Needed the moment franchise launches ride the same template
>   (`franchiseTemplate.js` already exists in the seed folder).

### F2 — Phase names on the step bar

`Phase 3` becomes `3 · Commercial Closure`, truncated with `text-overflow`, the
full name still in `title`. One-line change, biggest readability win per byte.

### F3 — The lineage rail (answers Q2 and Q3) — **the core of v2**

A three-column strip between the step bar and the sheets. Left and right cells
are clickable and switch the active phase.

**Left — CAME BEFORE.** The previous phase in `order`. Shows its name, its
verdict badge, when it actually closed and who signed it, then **what it handed
over**.

**Centre — YOU ARE HERE.** The current phase's name, verdict, counts, planned
close, **exit criteria** (`stage.exitCriteria`) and **gate**
(`stage.gate.label / approver / unlocks`, `stage.requiresApproval`,
`stage.approverRoles`) — all already snapshotted onto `project.stages[]` and all
currently unrendered.

**Right — UNLOCKS NEXT.** The next phase in `order`, its verdict, and the fields
it will need that this phase produces.

**Parallel phases.** `stage.parallelGroup` exists on the snapshot. When the
previous phase shares a `parallelGroup` with others, the left cell lists all of
them ("Runs alongside: Phase 4B — Vendor Identification") rather than pretending
the chain is linear. Phase 4 / 4B and Phase 6 / 7 in the live template are
exactly this case.

### F4 — "It handed over" — the carry-forward facts

The one genuinely new piece of logic. A declarative map, new file
`client/src/lib/phaseLineage.js`:

```js
/**
 * What each phase inherits from the ones before it. Keyed by stage key, each
 * entry naming a source phase and how to pull one fact out of its records.
 * `pick` resolves against the phase's records, preferring approved/shortlisted
 * ones — a rejected LOI is not what Phase 3B inherits.
 */
export const PHASE_INHERITS = {
  p3:  [
    { from: 'p1', label: 'Selected property', pick: { status: 'shortlisted', field: '__title' } },
    { from: 'p1', label: 'Area (sq.ft)',      pick: { status: 'shortlisted', field: 'carpet_area' } },
    { from: 'p2', label: 'Assessments signed', pick: { status: 'approved',   agg: 'count' } },
  ],
  p20: [
    { from: 'p3', label: 'LOI number',    pick: { module: 'loi',   field: 'loi_number' } },
    { from: 'p3', label: 'Lease start',   pick: { module: 'lease', field: 'lease_start_date' } },
    { from: 'p1', label: 'Confirmed area', pick: { status: 'shortlisted', field: 'carpet_area' } },
  ],
  p11: [{ from: 'p20', label: 'Confirmed area', pick: { field: 'confirmed_area' } },
        { from: 'p20', label: 'Games',          pick: { field: 'selected_games' } }],
  p13: [{ from: 'p11', label: 'Approved drawings', pick: { status: 'approved', agg: 'count' } },
        { from: 'p12', label: 'Vendors finalised', pick: { field: 'status', eq: 'Finalised', agg: 'count' } }],
  p15: [{ from: 'p13', label: 'BOQ lines',   pick: { agg: 'count' } },
        { from: 'p13', label: 'BOQ value',   pick: { field: 'amount', agg: 'sum', as: 'currency' } }],
  // …p6, p16, p18, p19, p8, p9, p10
};
```

Resolved by one pure function against the **already-fetched** `byStage` map — no
new request, no server change:

```js
resolveInherited(stageKey, byStage, template) -> [{ label, value, fromStage, recordId }]
```

Each resolved fact is a **link**: clicking "Selected property — Baner Hub" jumps
to Phase 1 and opens that record's read-only form. That is the whole answer to
*"he doesn't know what the previous one was"*.

Fallback when a phase has no entry in the map: show the previous phase's
**approved record titles** (up to three) plus its decider — generic, still
useful, never blank.

### F5 — Task lineage (answers Q4)

Two additions to the tasks sheet:

**a) A "Comes after" column.** The predecessor task.

> ⚠️ **Data gap to close first.** `Task.dependencies` is a real
> `[ObjectId ref Task]` on the model, and `Template.tasks[].dependencies` is a
> real `[String]` of task keys — but **`buildTaskDoc()` in
> `project.service.js:466` never copies it**, so every project task is created
> with `dependencies: []`. The template seeds do not declare task dependencies
> either. So today the field is structurally present and factually empty.
>
> - **Short term (no server change):** derive the predecessor as *the previous
>   task in the same phase by `order`, then `plannedStart`* — and label the
>   column honestly as **"Comes after (by plan order)"**.
> - **Proper fix (server, small):** add `dependencies` to the cascade — resolve
>   template task keys to the ids created in the same pass, in
>   `buildTaskDoc`/`cascadeStage`, then render the real chain and drop the
>   qualifier. The Gantt (`gantt.service.js:221`) and the blocks-downstream
>   analysis (`approvals/analysis/schedule.js:34`) already read this field and
>   would light up for free.

**b) An expandable row.** Click the chevron on a task row to reveal, without
leaving the page:

- `brief.what / who / when / how` — the doer's job description, snapshotted from
  the template and currently invisible everywhere except the task page;
- checklist progress `n of m`, required items marked;
- **`approvalState`** with `TASK_APPROVAL_LABELS` — the second axis v1 hides
  entirely, so a complete-but-unsigned task stops looking finished;
- `approval.approver` (who is meant to sign) vs `approvedBy` / `managementApprovedBy` (who did);
- `extensionRequest` — *"deadline moved 12 Aug → 14 Aug, approved by X"*, which
  is the honest explanation behind half the amber rows;
- `transferHistory` — *"reassigned from A to B by C"*;
- `completedBy` when it differs from `assignee`.

### F6 — Record lineage in the modal

Two blocks added to `RecordFormModal`'s read-only meta:

- **Breadcrumb** — follow `parentRecordId` upward: *Assessment (Feasibility) →
  Property "Baner Hub" (Phase 1)*. Each hop clickable. Already a populated field
  on `Record`, never rendered.
- **Decision timeline** — render `decisionHistory[]`, the append-only trail. v1
  shows only the *latest* stamp, so a reject-then-fix-then-approve cycle looks
  like a clean first-time approval. Verify the list endpoint populates
  `decisionHistory.by`; if it does not, that is a one-line `populate`.

### F7 — Cross-phase views

A view switcher beside the phase bar:

| View | What it shows |
|---|---|
| **Phase** *(default, = v1)* | one phase's entries and tasks |
| **All entries** | every record in the project, one flat sheet, with a Phase column, sorted by `Filed on` |
| **Timeline** | every filed record and completed task on one date-ordered feed — the project's real history |
| **People** | grouped by `Filed by` / `Assignee` — *"what has R. Shah actually done on this launch"* |

All four run off the **same two fetches already in place**. Plus a filter bar
that survives the view switch: free-text search, person, date range, status,
department, and *"only what is late"*.

### F8 — Fixes carried from the v1 gap list

| Ref | Fix |
|---|---|
| Gap 8 | Add `evaluation_in_progress` → *"Under evaluation"*, `archived` → *"Archived"*, `locked` → *"Locked"* to `RECORD_STATUS_LABEL`/`_TONE`. Better: export the map from a shared lib so it cannot drift from `RECORD_STATUS` again. |
| Gap 11 | Show *"showing 1,000 of N tasks"* when the page limit truncates, instead of silently lying. |
| Gap 12 | Any `values` key with no field in the template renders in a trailing **"Unmapped fields"** column group rather than vanishing. |
| Gap 10 | `Export ▾` → **This phase (CSV)** · **Whole project (CSV per phase, zipped)** · **Whole project (one XLSX, one sheet per phase)**. |
| §8 note | Correct the guide's "EVERY field" claim, or make it true by unioning schema fields with observed keys. |

---

## 4. What is needed where

| Item | Client | Server | Schema |
|---|---|---|---|
| F1 launch header, option (a) | yes | — | — |
| F1 launch header, option (b) client model | yes | small | **`Project.client`** |
| F2 phase names on tabs | yes | — | — |
| F3 lineage rail | yes | — | — |
| F4 carry-forward facts | yes (`lib/phaseLineage.js`) | — | — |
| F5a predecessor, derived | yes | — | — |
| F5a predecessor, real | yes | **`buildTaskDoc` cascade** | — |
| F5b task expander | yes | — | — |
| F6 record breadcrumb | yes | — | — |
| F6 decision timeline | yes | verify `populate` | — |
| F7 cross-phase views | yes | — | — |
| F8 fixes | yes | — | — |

**Ten of thirteen items need no server work at all** — the data is already on
the wire in the two whole-project fetches v1 makes.

---

## 5. Files

```
client/src/features/projects/DataExplorerPage.jsx     rewrite — split it up
client/src/features/projects/dx/LaunchHeader.jsx      new  (F1)
client/src/features/projects/dx/LineageRail.jsx       new  (F3, F4)
client/src/features/projects/dx/RecordsSheet.jsx      moved out of the page
client/src/features/projects/dx/TasksSheet.jsx        moved out  (F5)
client/src/features/projects/dx/TaskDetailRow.jsx     new  (F5b)
client/src/features/projects/dx/FilterBar.jsx         new  (F7)
client/src/features/projects/dx/AllEntriesSheet.jsx   new  (F7)
client/src/features/projects/dx/TimelineView.jsx      new  (F7)
client/src/lib/phaseLineage.js                        new  (F4) — PHASE_INHERITS + resolveInherited
client/src/lib/recordStatus.js                        new  (F8) — one shared status vocabulary
client/src/lib/deliveryStatus.js                      + projectDelivery()  (F1)
client/src/features/projects/records/RecordFormModal.jsx  + lineage/timeline blocks (F6)
client/src/styles/projects.css                        + .dx-rail-*, .dx-header-*; delete dead .dx-step*
client/src/features/guide/guides.js                   guide rewritten for the rail
server/src/modules/pms/projects/project.service.js    dependencies cascade (F5a, optional)
```

At 664 lines the page is already past the point where one file is right; the
split is a precondition for the rest, not a nice-to-have.

---

## 6. Build order

| Stage | Ships | Why first |
|---|---|---|
| **1** | Split the page into `dx/*` + `lib/recordStatus.js` (F8 statuses) + F2 phase names | pure refactor, no behaviour change, unblocks everything |
| **2** | **F3 lineage rail + F4 carry-forward** | the actual ask — ship it before anything cosmetic |
| **3** | F1 launch header + `projectDelivery()` | the identity line, once the rail proves the layout |
| **4** | F5 task lineage (derived) + F6 record lineage | completes "what came before" at row level |
| **5** | F7 cross-phase views + filters | biggest surface, least urgent |
| **6** | F8 exports; server `dependencies` cascade; guide rewrite | cleanup and the one server change |

Stages 1–2 are the release the user asked for. Everything after is v2 proper.

---

## 7. Acceptance criteria

1. Opening **any** phase names the phase before it, its verdict, its close date,
   and at least one concrete fact it handed over — with **zero** extra clicks
   and **zero** extra requests.
2. Clicking an inherited fact opens **that** source record's read-only form,
   from the source phase.
3. The header names the launch, its owner and its position (*"Phase 3 of 15"*)
   on every screen that is not the empty state.
4. Every phase tab reads its **name**, not its index.
5. Every task row states what it comes after, and whether it is **signed off** —
   not just whether it is complete.
6. No record status ever renders as a raw database string.
7. A rejected-then-approved record shows **both** decisions, in order.
8. Every count on screen is either complete or labelled *"showing X of N"*.
9. Two fetches per project, still. If v2 needs a third, it is wrong.
10. Every colour on the page still comes from `deliveryStatus.js`. No component
    invents a verdict of its own.

---

## 8. Explicitly out of scope

- Editing anything. The Data Explorer is where a record is **read**; the modal
  stays `readOnly` and nothing on this page mutates.
- Cross-**project** comparison (that is Plan vs Actual / MIS).
- A new server aggregation endpoint. If a v2 view needs one, it is a sign the
  view belongs on MIS instead.
- Charts. This screen is a sheet, deliberately.
