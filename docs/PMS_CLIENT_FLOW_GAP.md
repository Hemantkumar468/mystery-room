# PMS — Client Flow vs Built System: Gap Analysis

**Baseline documents**
- `docs/PMS_Functional_Flow_Document.docx` — client-approved functional flow & scope (v1.0 Review Draft)
- `docs/PMS_Visual_Flowchart.pdf` — client-approved end-to-end visual flow

**Purpose.** Map every phase the client signed off against what exists in the
codebase today, so the build order is decided from evidence rather than from
memory. This is the Stage 1 "frozen functional baseline" the client document
asks for in §11.

**Status:** analysis complete; build route chosen and step 1 built. The
16-phase template exists as `server/src/seed/clientFlowTemplate.js`. See
[Decisions taken](#6-decisions-taken).

---

## 1. Headline

The client flow has **16 phases (0–15)**. The system has **10 (`p1`–`p10`)**.

- **6 phases already exist** and need renaming or light extension, not rebuilding.
- **8 phases do not exist at all** and are the bulk of the work.
- **1 phase disappears** as a phase (`p7` Approval Workflow becomes gates).
- **1 phase moves position** — Project Initiation goes from 4th to *first*.

The good news the client's document confirms: Phases 1, 2 and 3 — property
capture, the four assessments, and commercial closure — are the deepest parts
of what is already built, and they map almost exactly.

---

## 2. Phase-by-phase map

Legend — ✅ built · 🟡 partial · ❌ missing

| Client | Phase | Owner | Built as | State | Work needed |
|---|---|---|---|---|---|
| **0** | Project Initiation | MD / PM Head | `p4` Project Creation | 🟡 | **Move to front.** Exists but sits after commercial closure. |
| **1** | Property Research & Site Capture | Property Consultant | `p1` Property Identification | ✅ | Rename; add GPS-at-site, voice notes, opportunity entry. |
| **2** | Site Evaluation — 4 Assessments | Assessment Experts | `p2` Site Evaluation | ✅ | Near-exact match (Feasibility/Financial/Technical/Operational). |
| **3** | Final Selection & Commercial Closure | MD | `p3` Commercial Finalization | ✅ | Add negotiation trail (quote → counter → final). |
| **4** | Design & Drawings *(parallel A)* | Architect | — | ❌ | **New.** Drawing register, revisions, approve-latest-only. |
| **4B** | Vendor Identification *(parallel B)* | Project Manager | — | ❌ | **New.** Vendor master, categories, quotation comparison. |
| **5** | Project Planning — BOQ, Budget, Gantt | Project Manager | — | ❌ | **New.** BOQ builder, budget derivation, Gantt + baseline. |
| **6** | Documentation & Vendor Agreements | Project Manager | — | ❌ | **New.** Agreement generation, signature tracking. |
| **7** | Procurement & Manufacturing | Store Mgr / PM | `p5` (Procurement dept only) | 🟡 | Indent → PO → GRN chain absent. |
| **8** | Site Execution / Civil Works | Contractor / Supervisor | `p6` Execution | 🟡 | **Daily site report is the gap** — highest-frequency screen. |
| **9** | Quality Check | Operations Head | — | ❌ | **New.** QC checklist, fail → auto rectification task. |
| **10** | Logistics & Dispatch | Logistics Head | — | ❌ | **New.** Dispatch board, GRN, damage → replacement task. |
| **11** | Assembly & Installation | Game Specialist | — | ❌ | **New.** Per-game install checklist. |
| **12** | Testing & Trial Run | Cluster Manager | — | ❌ | **New.** Trial runs, error log, re-test loop until All-OK. |
| **13** | Readiness Checklist | All Dept Heads | `p8` Store Readiness | ✅ | Match. ~79 items confirmed against our count. |
| **14** | Branch Opening / Handover | Director | `p9` Store Launch | ✅ | Match. Add handover pack. |
| **15** | Closure & Delay Analysis | Project Manager | `p10` Project Closure | ✅ | Match. Add department-wise delay attribution. |
| — | *(removed)* | — | `p7` Approval Workflow | ⚠️ | Becomes **gates inside phases**, not a phase. |

---

## 3. The three structural changes

These are not renames. Each changes how the system behaves.

### 3.1 Project Initiation moves to Phase 0

Today a project is created at `p4`, *after* a property is chosen. The client
requires the opposite:

> "A project exists the moment the intent to open in a city is created — well
> before any property is finalised. This ensures the pipeline is visible from
> day one." — §7 Phase 0

**Consequence.** The project record becomes the container that property search
happens *inside*, rather than the output of it. Phases 1–2 become work items
within a project rather than precursors to one. This inverts the current
`p1 → p4` creation order and is the single highest-impact change in the document.

### 3.2 Parallel streams replace the linear queue

The system runs one phase at a time. The client flow explicitly branches:

- **Phases 4 and 4B run together** (drawings ‖ vendor identification)
- **Phases 7 and 8 run together** (procurement ‖ civil works)
- IT / HR / Marketing departmental streams run alongside both

> "The rent-free fit-out period (typically 3 months) is the working window, so
> the system starts these streams the moment the LOI gate clears rather than
> waiting for full documentation." — §6

**Consequence.** Stage completion can no longer be a single cursor advancing
`p1 → p2 → p3`. Phases need a dependency graph — "unlocks when Gate 2 clears" —
not a sequence position. This affects `project.service.js#recompute()` and
every gate check.

### 3.3 Approvals become gates, not a phase

The flowchart marks exactly **three hard gates**:

| Gate | After phase | Who signs | Blocks |
|---|---|---|---|
| **Gate 1** | 2 — Site Evaluation | MD | Property selection; reject needs reason + digital signature |
| **Gate 2** | 3 — Commercial Closure | MD | **Releases all downstream parallel streams** |
| **Gate 3** | 13 — Readiness | All Dept Heads → Director | Launch clearance |

Compliance documents may stay Pending without blocking execution — only LOI and
Lease are hard gates — but they *do* block Gate 3.

**Consequence.** `p7` Approval Workflow is deleted as a stage. This matches the
direction already taken when tier badges were removed and MD was made able to
approve anywhere.

---

## 4. The split — Direct Franchise Enquiry (fast-track)

A second entry path, drawn on the flowchart as *Alternate Entry*, for people
who already have a property.

```
Public / WhatsApp link → enquiry form (personal + property details)
  → AI location & feasibility analysis runs automatically
  → internal team verifies
  → MD approves            ← the only gate
  → project created, template runs from Phase 3 onward
```

**Skips Phases 1 and 2 entirely** — replaced by approval-based verification. A
light technical assessment can still be triggered on demand if the MD asks.

Partially anticipated: `server/src/seed/franchiseTemplate.js` exists. What is
missing is the public intake form, the auto-AI-on-submit trigger, and the
restricted franchisee dashboard.

Roughly 500 existing franchise leads are to be imported into this module.

---

## 5. Cross-cutting gaps

Features the client specifies across *every* phase, independent of the phase work:

| Area | Requirement | State |
|---|---|---|
| **Gantt** | Project + portfolio level, frozen baseline, critical path, drag-to-reschedule | ❌ absent |
| **Plan vs Actual** | Every task carries planned/actual start & end, variance auto-coloured | 🟡 fields exist, variance surface does not |
| **Buddy / backup owner** | Every task has a secondary owner, auto-notified if primary is unavailable | ❌ absent |
| **WhatsApp** | Task alerts, reminders, escalations (DoubleTick / SmartWeb) | ❌ absent |
| **Escalation ladder** | Doer → PM (d1) → Dept Head (d2) → MD (d3) | ❌ absent |
| **MIS scoring & leaderboard** | On-time 50% · Quality 25% · Rework 15% · Rejections 10% | ❌ absent |
| **Document library** | One repository, expiry tracking, plain-language AI search | 🟡 per-record attachments only |
| **Back-fill / Late Entry** | Missed entries added later, flagged with true timestamp | ❌ absent |
| **Offline capture** | Site entries survive network loss and sync | ❌ absent |
| **Soft delete + reason** | Everywhere, admin-recoverable | 🟡 partial |
| **Export to PDF/Excel** | Every list, report, checklist, Gantt | 🟡 partial |

The AI layer is the strongest existing asset: property analysis with confidence
score, cited sources and PDF report already matches what §9.6 asks for in the
Property Research row. OCR, delay projection and NL search are not built.

---

## 6. Decisions taken

1. **Template strategy — new template alongside.** `clientFlowTemplate.js`
   publishes the 16-phase flow as a second template. `storeLaunchTemplate.js`
   is untouched and stays `isDefault`, so every existing project and the
   current demo keep working while the eight new phases are built out.
   `isDefault` moves once they are deep enough to lead with.

2. **Build order — Phase 0 reorder + rename first.** Done. The remaining
   order is in [§7](#7-suggested-sequencing).

3. **Phase keys — internal keys stay, display names change.** Users see the
   client's numbering (`Phase 0 — Project Initiation`); the database keeps
   `p1`–`p10` for reused phases so every existing gate check, migration and URL
   keeps working, with `p11`–`p19` for the new ones. Nothing matches on the new
   keys yet, which is exactly why they were free to choose.

Non-blocking, already answered by the document: role list (§4), phase durations
(§6), gate authorities (§13.4), escalation ladder (§13.7), MIS weightages
(§13.8).

### What step 1 produced

| File | Purpose |
|---|---|
| `server/src/seed/clientFlowTemplate.js` | The 16-phase template. Reuses 6 phases by key; defines 8 new ones. |
| `server/src/seed/installClientFlowTemplate.js` | Non-destructive installer for an existing database. Dry run by default; `--apply` to persist. |
| `server/src/seed/seed.js` | Now seeds the client flow alongside the other two templates. |

Reusing by key carried the existing depth across untouched — `p8` brought all
81 readiness checklist tasks, `p9` its 60, and `p2`/`p3`/`p6` their assessment
and department modules. 202 tasks across 17 stage rows (16 phases; 4 and 4B are
two parallel rows under one number, as the flowchart draws them).

---

## 7. Suggested sequencing

Assuming core-first, each step independently demoable:

| Step | Work | Why here |
|---|---|---|
| 1 | Phase 0 reorder + rename existing 6 | Makes the flow *read* like the client doc immediately |
| 2 | Gates 1/2/3 replace `p7` | Removes a phase; simplifies rather than adds |
| 3 | Phase 5 — BOQ, Budget, Gantt | The MD's primary view; unlocks plan-vs-actual everywhere |
| 4 | Phase 4B + 6 — Vendor master & agreements | Feeds procurement and BOQ rates |
| 5 | Phase 4 — Drawings register | Independent; needed before execution |
| 6 | Phase 8 — Daily site report | Highest-frequency screen; mobile-first |
| 7 | Phases 7, 9, 10, 11, 12 | The execution chain, in flow order |
| 8 | Parallel-stream engine | Once ≥2 real parallel phases exist to test against |
| 9 | Fast-track franchise split | Reuses phases 3+ once stable |

Cross-cutting items (Gantt baseline, buddy owner, escalation, MIS) attach to
step 3 and later rather than forming steps of their own.
