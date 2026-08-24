# Phase 6 — Purchase Orders & Delivery Tracking

**Page:** `/projects/:id/procurement` (stage key `p15`) · **Client:** `features/projects/ProcurementTrackerPage.jsx`

## The idea in one line

A purchase order **is** a Phase 5 BOQ line. Phase 6 never asks anyone to re-enter an order — it is one sheet over the same lines, tracking each from *sent* to *received*.

## What a row holds

| Column | Where it comes from |
|---|---|
| PO no., item, category, vendor, qty, amount | The Phase 5 BOQ line (approved content — never edited here) |
| Sent (WhatsApp / email, when, to whom) | Stamped automatically by the Order page when a PO is sent |
| Status | `Ordered → Dispatched → Delivered → Partly Received → Received (GRN)`, plus `Short / Damaged`, `Cancelled`. Shown as **Not sent yet** until the first send. |
| Due + delay | Vendor promised date (else the BOQ's planned end). Past due and not closed → **Late N days** in red |
| Received | Quantity received of quantity ordered; pending is worked out; `Partly Received` / `Received (GRN)` set automatically |
| Paper trail | Indent no., delivery challan no., LR / docket, GRN no. |
| Last update | Who, when — from the record's append-only `changeLog` |

## How the data works

* Tracking fields live on the **Phase 5 BOQ schema** with `tracker: true` (`server/src/seed/clientFlowTemplate.js`). They are hidden from the Phase 5 form (`RecordFormModal` filters them) and written only through
  `PATCH /api/v1/pms/records/:id/tracking` — which is allowed on **approved** records because it is the order's execution history, not the approved content. The service rejects any key that is not a tracker field.
* Every change appends `{ field, label, from, to, by, at, note }` to `Record.changeLog` and writes an activity-log line.
* The Order page (`PurchaseOrderPage`) logs each send both as a comment (human-readable send log) and as tracker stamps (`sent_whatsapp_at/_to`, `sent_email_at/_to`), fixing `po_number` and setting `order_status = Ordered` on the first send.
* **Phase completion gate** (`project.service.js#completeStage`, `p15`): every BOQ line must be *Dispatched or beyond* (or Cancelled). Receipt and GRN continue to be tracked on the same sheet afterwards.
* **AI brief** — `POST/GET /api/v1/ai/procurement-brief/:projectId` (`modules/ai/analysis/procurementBrief.service.js`): what to chase today (with a WhatsApp-ready message each), risks, what's fine. Grounded only in the rows; saved as an `AiAnalysis` of kind `procurement_brief`.

## Migrating live projects

```
node src/seed/installClientFlowTemplate.js --apply                      # refresh the template
node src/seed/syncProjectStage.js --stage p15 --template MR-PMS-CLIENT-FLOW \
     --apply --reopen --migrate-orders                                  # every project on it
node src/seed/syncProjectStage.js --stage p15 --project MR-BHO-003 …    # or one project
```

`syncProjectStage.js` refreshes the stage snapshot, keeps finished tasks as history, removes unfinished old tasks, re-issues the template's current tasks (same doer resolution as project creation), copies old Phase 6 "indent" facts and send-log comments onto the BOQ lines, and (with `--reopen`) puts a completed Phase 6 back in progress. Dry run by default.

## Known follow-ups

* Phase 9 (Logistics & Dispatch) now overlaps the tracker's dispatch/GRN fields — candidate for removal once the client signs off.
* A PO still equals one BOQ line. If one PO should carry several lines for one vendor, the BOQ form needs a lines table (not done).
