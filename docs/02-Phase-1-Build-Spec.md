# Phase 1 — Property Identification — Build Spec (Milestone 1)

> The **first thing we build** on top of the existing platform. A full vertical slice: a real dynamic capture form, a real table of property rows, real decisions (shortlist / reject) with audit, and the **gate** that hands shortlisted properties to Phase 2. Getting this right proves the pattern the whole product repeats.
>
> Read [`01-Master-Plan.md`](01-Master-Plan.md) first for the big picture and — importantly — for **what already exists**. This doc is the "how, concretely."

---

## 1. The story we enable (client's own words)

A manager decides to open an outlet in **Bhopal**. A **broker** (external — not a company user) lines up ~10 properties. A **doer** (an `executor`) goes property to property and, standing inside each one on a phone, captures its details, photos and a walkthrough video. **Each property becomes a row.** Back at HQ, the **manager/director** — who could not travel to Bhopal — opens the project, reviews all 10 rows, and marks each **Shortlist** or **Reject**. The shortlisted ones become the subjects of **Phase 2 (Site Evaluation)**.

Everything below serves that story.

---

## 2. Why the platform can't do this yet, and the one change that fixes it

The platform already has dynamic per-stage fields (`masterDataSchema`) and per-stage approval. But `Project.masterData[stageKey]` holds **one** record per stage — it cannot represent *ten properties as ten rows, each with its own status*.

**The change: give a stage a `captureMode`.**

- `captureMode: 'single'` → one master-data record per project (today's behaviour — **every existing stage keeps working unchanged**).
- `captureMode: 'collection'` → many **`Record`** rows, each a dynamic form instance with its own `status`, attachments and decision.

Phase 1's stage `p1` becomes `collection`. That's the keystone; everything else is standard CRUD + a decision endpoint.

---

## 3. Scope of M1 (in / out)

**In scope**
- `captureMode` on template & project stages (default `'single'`; additive, breaks nothing).
- A **`Record`** model + module (model/service/controller/routes/validation) for collection-mode rows.
- Seed `p1` as `collection` with the property-capture field set (§5).
- **Dynamic Add-Property form** rendered from the stage's `masterDataSchema` — mobile-friendly.
- **Records table** for `p1`: rows with a title, key fields, status chip, filter tabs (All / Submitted / Shortlisted / Rejected).
- **Decision actions** per row: **Shortlist**, **Reject** (with reason), **Undo** — manager-only, audited.
- **Record detail drawer**: all values + attachments + per-record activity.
- The **gate**: `GET …?status=shortlisted` returns the shortlisted properties (Phase 2 consumes it).

**Out of scope for M1** (later)
- Phase 2 assessment forms + the side-by-side Master view (M2) — but the gate endpoint lands now.
- A binary **upload pipeline** (presigned URLs / object storage). M1 captures attachment **references** (a filename/URL per file field); real upload is M3. *(Flag this to the client — see Master Plan §13.)*
- Visual editing of `captureMode`/fields in the template builder (M3).

---

## 4. Statuses & the decision flow

A **Record** moves through:

```
draft ──submit──▶ submitted ──shortlist──▶ shortlisted ──▶ (Phase-2 subject)
                       │
                       └──reject (reason)──▶ rejected
shortlisted / rejected ──undo──▶ submitted
```

- **Doer (executor)** creates → `draft` or `submitted`, and may edit their own record.
- **Manager/Director** acts on rows → `shortlisted` or `rejected` (reject requires a short reason).
- Decisions are reversible (`undo` → `submitted`); every change is logged to the activity trail.
- **Gate:** `status === 'shortlisted'` on a `p1` record is the signal that creates a Phase-2 subject. M1 persists this and exposes the query; M2 consumes it.

`RECORD_STATUS` (new constant): `draft · submitted · shortlisted · rejected · approved · locked`. (`approved`/`locked` are for p2/p3; harmless to define now.)

---

## 5. The seed Phase-1 capture form (rendered dynamically)

Set as `p1.masterDataSchema` with `p1.captureMode = 'collection'`, `p1.recordNoun = 'Property'`. Stored as data → later edits need no code change.

| # | key | Label | Type | Required | Notes |
|---|---|---|---|---|---|
| 1 | `property_name` | Property / building name | text | ✔ | used as the row title |
| 2 | `locality` | Locality / address | text | ✔ | map pin later |
| 3 | `carpet_area` | Carpet area (sq.ft) | number | ✔ | |
| 4 | `frontage_ft` | Frontage (ft) | number | | visibility/signage |
| 5 | `floor` | Floor | select | | Ground / First / Second / Basement / Other |
| 6 | `monthly_rent` | Expected monthly rent | currency | | ₹ |
| 7 | `deposit` | Expected deposit | currency | | |
| 8 | `available_from` | Available from | date | | calendar picker |
| 9 | `owner_name` | Owner name | text | | |
| 10 | `owner_phone` | Owner contact | text | | |
| 11 | `broker_name` | Broker name | text | | broker is external — data only |
| 12 | `broker_phone` | Broker contact | text | | |
| 13 | `photos` | Site photos | file | | multiple; camera upload |
| 14 | `walkthrough` | Video walkthrough | file | | |
| 15 | `notes` | Doer's notes / pros & cons | textarea | | |

> Because the form is data-driven, the client can later add e.g. "parking (yes/no)" or "competition nearby" with no developer.

---

## 6. Data shape (real Mongoose, mirrors repo conventions)

```js
// Record — one row of a collection-mode stage (e.g. a candidate property)
new Schema({
  project:   { type: ObjectId, ref: 'Project', required: true, index: true },
  stageKey:  { type: String, required: true, index: true },   // "p1"
  title:     { type: String },                                 // derived from values for the table
  values:    { type: Object, default: {} },                    // the dynamic answers (embedded)
  status:    { type: String, enum: RECORD_STATUS_VALUES, default: 'submitted', index: true },
  attachments: [{ fieldKey: String, name: String, url: String, kind: String }],
  decidedBy:      { type: ObjectId, ref: 'User' },
  decidedAt:      Date,
  decisionReason: String,
  parentRecordId: { type: ObjectId, ref: 'Record' },           // gate/carry-forward (future p2)
  createdBy:      { type: ObjectId, ref: 'User' },
}, { timestamps: true })
```

Stage schemas gain two fields (both default so existing data is untouched):

```js
captureMode: { type: String, enum: ['single','collection'], default: 'single' },
recordNoun:  { type: String, default: 'Record' },   // UI label, e.g. "Property"
```

Add `'record'` to the `Activity.entityType` enum so record actions are auditable.

---

## 7. API endpoints (M1) — mounted at `/api/v1/pms/records`

```
POST   /pms/records                     create a row   body: { projectId, stageKey, values, status?, attachments? }
GET    /pms/records?projectId&stageKey&status   list rows (filterable) — also the gate when status=shortlisted
GET    /pms/records/:id                  one row + audit
PATCH  /pms/records/:id                  edit values/attachments (doer, own row)
POST   /pms/records/:id/decision         { decision: "shortlist"|"reject"|"approve"|"lock", reason? }  (manager)
POST   /pms/records/:id/undo-decision    back to submitted
DELETE /pms/records/:id                  remove a row (admin/manager)
```

- Auth: create/edit → `admin·manager·executor`; decision/undo → `admin·manager`; delete → `admin·manager`; list/get → any authenticated.
- Every write appends to the **activity log** (`entityType:'record'`, `meta:{ stageKey }`).
- Validation via **Zod** at the boundary, mirroring `project.validation.js`.

---

## 8. The dynamic record renderer (build once, reuse forever)

A small `DynamicField` component: `switch (field.type)` → the matching input (text / textarea / number / currency / date / boolean / select / multiselect / file / user). Validation (required, non-negative numbers) mirrors the server. **One input branch per type** so adding a new field type later is a self-contained change — the modularity the client asked for.

Once this renderer exists, **every other phase's form is free** — Phase 2's assessments are just different `masterDataSchema` data fed to the same component.

---

## 9. Screens & where they live (client)

New feature folder `client/src/features/projects/records/`:

- **`RecordsPanel.jsx`** — for a collection-mode stage: header with **"➕ Add {recordNoun}"**, filter tabs, and the rows table (title · key fields · status chip · Shortlist/Reject/View).
- **`RecordFormModal.jsx`** — the Add/Edit form; renders `masterDataSchema` via `DynamicField`; Save-as-draft & Submit.
- **`RecordDetailDrawer.jsx`** — read view of all values + attachments + decision buttons (manager) + per-record activity.
- **`DynamicField.jsx`** — the shared field renderer.
- **`recordUi.js`** — `RECORD_STATUS_META` (label + colour per status), mirroring `lib/ui.js`.

**Wiring:** `MasterDataPanel.jsx` already renders one card per stage. Update it so a **collection-mode** stage renders `RecordsPanel` instead of the single-record form; **single-mode** stages are untouched. This puts Phase-1's "form + rows below" exactly where a user expects it, inside the project's **Master Data** tab, with zero disruption to existing stages.

Query hooks go in `lib/queries.js`: `useStageRecords`, `useCreateRecord`, `useUpdateRecord`, `useRecordDecision`, `useUndoRecordDecision`, `useDeleteRecord` — following the existing `useSaveMasterData` pattern (invalidate `['records', projectId, stageKey]` + `['project', projectId]`).

---

## 10. Definition of Done for M1

- [ ] Seeded default template has `p1` as `collection` with the property fields; existing single-mode stages behave exactly as before.
- [ ] On a phone, a doer can Add a property, fill the form, attach photo/video references, and submit.
- [ ] All properties show in the `p1` records table with correct status chips and filter tabs.
- [ ] A manager can Shortlist and Reject (with reason); statuses update; actions are reversible; each is in the activity log.
- [ ] Clicking a row opens full detail + attachments + its activity.
- [ ] `GET /pms/records?projectId=…&stageKey=p1&status=shortlisted` returns exactly the shortlisted properties (proving the Phase-2 gate).
- [ ] Code is modular: a self-contained `records` server module and a `records` client feature; one input branch per field type.

When these are true, the core pattern is proven and **M2 (Phase 2 + the Master comparison view)** becomes a straightforward repeat.

---

## 11. First coding steps (order)

1. **Constants** — add `RECORD_STATUS` (+ values) and `STAGE_CAPTURE_MODE` (+ values); add `'record'` to the activity enum.
2. **Schema plumbing** — `captureMode` + `recordNoun` on template & project stage schemas; carry them through `materializeFromTemplate`.
3. **Records module** — model → service → controller → validation → routes; mount under `/pms/records`.
4. **Seed** — flip `p1` to `collection` + the property field set; re-run `npm run seed`.
5. **Client** — query hooks → `DynamicField` → `RecordFormModal` → `RecordsPanel` → `RecordDetailDrawer`; wire collection stages into `MasterDataPanel`.
6. **Verify** — create a Bhopal project, add properties on `p1`, shortlist/reject, confirm the gate query and the audit trail.

*Next milestone: `Phase 2 — Site Evaluation`, which reuses `DynamicField` for the four assessment groups and adds the side-by-side Master comparison view over the shortlisted properties.*
