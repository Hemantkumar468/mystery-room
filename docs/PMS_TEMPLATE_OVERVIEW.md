# PMS Templates — Phases, Doers & Durations

Every phase, every task, who does it and how long it is planned to take — extracted from the seeded template definitions in `server/src/seed/` plus the org chart in `server/src/seed/realRoster.js`.

**How to read the Doers column.** A template task names its people by `employeeId`; `assignRealPeople.js` stamps the real Mystery Rooms roster onto the live templates using `realRoster.js`. This document therefore shows the roster assignment — a named per-task rule where one exists, otherwise that department's head (the `DEPARTMENT_FALLBACK`). Every doer listed gets the task in their own **My Tasks**, and the first to complete it closes it for the rest. Buddies are cover: they can pick the task up, but it does not sit in their list demanding action.

**How to read Duration.** Two different numbers: a task's **estimated days** (planned working days for that piece of work) and a phase's **SLA days** (the target duration for the whole phase). They do not have to match — a phase whose tasks run in parallel has an SLA shorter than the sum of its tasks.

## Contents

- **A. Branch Opening — Client Flow** `MR-PMS-CLIENT-FLOW` — 17 phases, 59 tasks
- **B. Store Launch — Official PMS Workflow** `MR-PMS-STORE-LAUNCH` — 10 phases, 179 tasks _(default)_
- **C. Franchise Outlet Launch** `MR-FRANCHISE-LAUNCH` — 8 phases, 38 tasks
- **D. Workload by person** — tasks and planned days per doer
- **E. The roster** — who each person is

<!-- GENERATED:template-phases -->

_Generated from `server/src/seed/` by `exportTemplatePhases.mjs` — do not edit by hand._

**Branch Opening — Client Flow** `MR-PMS-CLIENT-FLOW` — **17 phases**, 59 tasks, 237 planned days, 3 gates, 1 branch.

| # | Phase | Key | SLA | Dept | Tasks | Runs with | Branch of | Gate |
|---|---|---|---|---|---|---|---|---|
| 1 | Phase 1 — Property Research & Site Capture | `p1` | 15d | expansion | 1 | — | — | — |
| 2 | Phase 2 — Site Evaluation | `p2` | 5d | expansion | 5 | — | — | Gate 1 — Property Approved |
| 3 | Phase 3 — Commercial Closure | `p3` | 7d | legal | 5 | — | — | Gate 2 — LOI Approved |
| 4 | Phase 4 — Project Planning & Games | `p20` | 3d | projects | 1 | — | — | — |
| 5 | HR Hiring & Training | `p22` | 30d | hr | 1 | — | p20 | — |
| 6 | Phase 5 — Design & Drawings | `p11` | 20d | projects | 2 | design-vendor | — | — |
| 7 | Phase 6 — Vendor & Contractor Panel | `p12` | 10d | procurement | 1 | design-vendor | — | — |
| 8 | Phase 7 — BOQ & Budget | `p13` | 5d | projects | 1 | — | — | — |
| 9 | Phase 8 — Contracts & Work Orders | `p21` | 5d | projects | 2 | — | — | — |
| 10 | Phase 9 — Purchase Orders & Delivery Tracking | `p15` | 45d | procurement | 2 | build-procure | — | — |
| 11 | Phase 10 — Site Execution / Civil Works | `p6` | 45d | projects | 3 | build-procure | — | — |
| 12 | Phase 11 — Quality Check | `p16` | 5d | operations | 4 | — | — | — |
| 13 | Phase 12 — Assembly & Installation | `p18` | 10d | automation | 3 | — | — | — |
| 14 | Phase 13 — Testing & Trial Run | `p19` | 10d | operations | 3 | — | — | — |
| 15 | Phase 14 — Readiness Checklist | `p8` | 10d | operations | 9 | — | — | Gate 3 — Launch Clearance |
| 16 | Phase 15 — Branch Opening / Handover | `p9` | 5d | operations | 12 | — | — | — |
| 17 | Phase 16 — Closure & Delay Analysis | `p10` | 7d | finance | 4 | — | — | — |

<!-- /GENERATED:template-phases -->

---

## A. Branch Opening — Client Flow

`MR-PMS-CLIENT-FLOW` · The client-approved end-to-end Branch / Franchise Opening lifecycle: project initiation through closure and delay analysis, with three approval gates and parallel design, vendor, procurement and execution streams.

| | |
|---|---|
| **Category** | Store Launch |
| **Status** | published |
| **Phases** | 15 |
| **Tasks** | 56 |
| **Total task effort** | 336 working days (sum of every task's estimate) |
| **Total phase SLA** | 189 days (sum of each phase's target duration) |
| **Auto-assign** | Yes — creating a project generates every task with its owner, buddy, lead time and checklist |

### Phase summary

| # | Phase | Owner dept | SLA (days) | Tasks | Task effort (days) | Runs with |
|---:|---|---|---:|---:|---:|---|
| 1 | Phase 1 — Property Research & Site Capture `p1` | expansion | 15 | 2 | 18 | — |
| 2 | Phase 2 — Site Evaluation (4 Assessments) `p2` | expansion | 5 | 5 | 10 | — |
| 3 | Phase 3 — Commercial Closure `p3` | legal | 7 | 5 | 10 | — |
| 4 | Phase 3B — Project Planning & Games `p20` | projects | 3 | 1 | 2 | — |
| 5 | Phase 4 — Design & Drawings `p11` | projects | 10 | 1 | 10 | design-vendor |
| 6 | Phase 4B — Vendor Identification `p12` | procurement | 10 | 1 | 10 | design-vendor |
| 7 | Phase 5 — BOQ, Budget & Gantt `p13` | projects | 2 | 1 | 3 | — |
| 8 | Phase 6 — Purchase Orders & Delivery Tracking `p15` | procurement | 45 | 2 | 90 | build-procure |
| 9 | Phase 7 — Site Execution / Civil Works `p6` | projects | 45 | 3 | 69 | build-procure |
| 10 | Phase 8 — Quality Check `p16` | operations | 5 | 4 | 12 | — |
| 11 | Phase 9 — Assembly & Installation `p18` | automation | 10 | 3 | 17 | — |
| 12 | Phase 10 — Testing & Trial Run `p19` | operations | 10 | 3 | 17 | — |
| 13 | Phase 11 — Readiness Checklist `p8` | operations | 10 | 9 | 27 | — |
| 14 | Phase 12 — Branch Opening / Handover `p9` | operations | 5 | 12 | 36 | — |
| 15 | Phase 13 — Closure & Delay Analysis `p10` | finance | 7 | 4 | 5 | — |

**Where the doers come from:** 48 task(s) have a per-task rule in `realRoster.js`, 8 fall back to their department's head, 0 keep the names written in the template file.

### Phase by phase — tasks, doers, duration

#### 1. Phase 1 — Property Research & Site Capture  `p1`

The property consultant visits each option with the broker and records it on the spot from a phone. Ten properties can sit under one search, all comparable side by side.

*Owner department:* **expansion** · *Phase SLA:* **15 days** · *Tasks:* **2** · *Task effort:* **18 days** · *Capture mode:* collection

*Exit criteria:* Properties recorded and one or more shortlisted (typically 10 listed → 4 shortlisted).

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Capture the properties on site `p1_capture` | expansion | 15 | high | Manoj Parihar | Siddharth Kumar | Not required |
| 2 | Review the captured properties & shortlist `p1_shortlist` | expansion | 3 | high | Prateek, Shikhir, Sapna | Siddharth Kumar | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Capture the properties on site | Property Consultant | 7–15 days | At each property, press "Submit Property" and fill the form on your phone right there — area, rent, photos, video, live GPS. One entry per property, again and again: 10–12 captures for a search is normal. Nothing to get approved — just capture them all. |
| Review the captured properties & shortlist | MD / PM Head | Within 2 days of listing | Open the property list — every captured property side by side with its photos, rent and AI report. Open each one, then mark it Shortlisted, On Hold or Rejected with a reason. What you shortlist is exactly what Phase 2 assesses. |

</details>

<details><summary>Checklists</summary>

- **Capture the properties on site**
  - Brokers engaged
  - **(required)** At least 5 properties captured
  - **(required)** Photos & video uploaded for each
  - Live GPS captured at each site
- **Review the captured properties & shortlist**
  - **(required)** Every property has a decision
  - Rejection reasons recorded

</details>

#### 2. Phase 2 — Site Evaluation (4 Assessments)  `p2`

Each shortlisted property goes through four independent expert assessments — feasibility, financial, operational and technical — consolidated into one comparable report.

*Owner department:* **expansion** · *Phase SLA:* **5 days** · *Tasks:* **5** · *Task effort:* **10 days** · *Capture mode:* collection

*Exit criteria:* One final property selected and approved with signature.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Do the Feasibility assessment `p2_feasibility` | expansion | 2 | high | Prateek | Siddharth Kumar | Not required |
| 2 | Do the Financial assessment `p2_financial` | finance | 2 | high | Prateek | Siddharth Kumar | Not required |
| 3 | Do the Operational assessment `p2_operational` | operations | 2 | high | Shishir | Ajay Sahni | Not required |
| 4 | Do the Technical assessment `p2_technical` | projects | 2 | high | Om Prakash | Ram Singh | Not required |
| 5 | Select the final property `p2_decision` | expansion | 2 | critical | Prateek, Shikhir, Sapna | Siddharth Kumar | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Do the Feasibility assessment | Feasibility Expert | 2 days | Open the Feasibility form on each shortlisted property. AI pre-fills competition, footfall and audience — you validate and give the recommendation. |
| Do the Financial assessment | Finance Expert | 2 days | Open the Financial form. Human-driven — AI is used only for city benchmarks. |
| Do the Operational assessment | Operations Expert | 2 days | Open the Operational form — shifts, staffing, permitted hours, customer flow. |
| Do the Technical assessment | Technical Expert | 2 days — site visit required | Visit the site, then fill the Technical form — civil, power, water, fire NOC, HVAC, ceiling height. |
| Select the final property | MD | Within 2 days of all four being complete | Read the consolidated report, then approve exactly one property or reject with a reason. Digitally signed. |

</details>

<details><summary>Checklists</summary>

- **Do the Feasibility assessment**
  - Catchment & audience reviewed
  - Competition checked
  - **(required)** Recommendation with rating given
- **Do the Financial assessment**
  - Rent vs projected revenue done
  - Setup & monthly cost estimated
  - **(required)** Break-even and ROI calculated
- **Do the Operational assessment**
  - **(required)** Shift feasibility checked
  - Staffing requirement set
  - Landlord operating hours confirmed
- **Do the Technical assessment**
  - **(required)** Site visited
  - Power & water load checked
  - **(required)** Fire safety / NOC feasibility checked
  - Ceiling height recorded
- **Select the final property**
  - All four assessments reviewed
  - **(required)** One property approved
  - **(required)** Digital signature recorded

</details>

#### 3. Phase 3 — Commercial Closure  `p3`

Negotiation, LOI and lease for the selected property. LOI approval is the hard gate: every downstream stream unlocks from here, and the rent-free fit-out period starts running.

*Owner department:* **legal** · *Phase SLA:* **7 days** · *Tasks:* **5** · *Task effort:* **10 days** · *Capture mode:* collection

*Exit criteria:* LOI approved and lease executed; downstream parallel streams released.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Issue Letter of Intent (LOI) `p3_t1` | legal | 2 | high | Prateek, Shikhir, Sapna | Siddharth Kumar | Not required |
| 2 | Draft & finalize lease agreement `p3_t2` | legal | 3 | critical | Prateek, Shikhir, Sapna | Siddharth Kumar | Not required |
| 3 | Legal verification & title due diligence `p3_t3` | legal | 2 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna | Not required |
| 4 | Security deposit & token payment `p3_t4` | finance | 1 | high | Prateek | Siddharth Kumar | Not required |
| 5 | NOCs & statutory approvals `p3_t5` | legal | 2 | high | Siddharth Kumar | Ajay Sahni | Not required |

<details><summary>Checklists</summary>

- **Issue Letter of Intent (LOI)**
  - Commercials agreed with landlord
  - LOI drafted
  - **(required)** LOI countersigned
- **Draft & finalize lease agreement**
  - Lock-in period agreed
  - Escalation clause agreed
  - Exit clause reviewed
  - **(required)** Agreement registered
- **Legal verification & title due diligence**
  - **(required)** Title chain verified
  - Encumbrance certificate obtained
  - Landlord identity verified
- **Security deposit & token payment**
  - **(required)** Deposit approved
  - Payment released
  - Receipt filed
- **NOCs & statutory approvals**
  - **(required)** Fire NOC applied
  - **(required)** Trade licence applied
  - Society / mall NOC obtained
  - Signage permission obtained

</details>

#### 4. Phase 3B — Project Planning & Games  `p20`

With the property signed, fix the plan for this specific site: which games it will hold, the real opening date, and the construction and testing milestones every other phase is scheduled against.

*Owner department:* **projects** · *Phase SLA:* **3 days** · *Tasks:* **1** · *Task effort:* **2 days** · *Capture mode:* single

*Exit criteria:* Games selected, opening date fixed, and the outline budget agreed.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Fill the project plan — games, dates & budget `p20_games` | operations | 2 | critical | Ram Singh, Ajay Sahni | Prateek, Shikhir, Sapna | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Fill the project plan — games, dates & budget | Operations Head / PM | Within 2 days of the lease being signed | One form, everything this phase needs: the games this site will hold (by its confirmed area and shape), construction start, handover, testing and target opening dates, and the outline budget. Submit it and the plan goes to the MD to approve — every later phase is scheduled from what is approved here. |

</details>

<details><summary>Checklists</summary>

- **Fill the project plan — games, dates & budget**
  - **(required)** Games selected against the confirmed area
  - **(required)** Construction, testing and opening dates set
  - Outline budget entered

</details>

#### 5. Phase 4 — Design & Drawings  `p11`

The architect prepares layouts for the actual site area and shape. Multiple drawing rounds are expected — every revision is kept, and only the latest approved one is live.

*Owner department:* **projects** · *Phase SLA:* **10 days** · *Tasks:* **1** · *Task effort:* **10 days** · *Capture mode:* collection

*Exit criteria:* Final drawing set approved and signed.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Create the drawings for this property `p11_draw` | projects | 10 | high | Architect / Design Team | Siddharth Kumar | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Create the drawings for this property | Architect / Interior Designer | Within 10 days | Draw the standard set for this site's actual area and shape, then upload each one. Upload a new revision each round — nothing is overwritten. |

</details>

<details><summary>Checklists</summary>

- **Create the drawings for this property**
  - **(required)** Site measurements confirmed
  - Layout & game zoning drafted
  - **(required)** Full standard set uploaded

</details>

#### 6. Phase 4B — Vendor Identification  `p12`

Runs alongside drawings. The category checklist is pre-loaded so no trade is forgotten, quotations are compared side by side, and one vendor is finalised per category.

*Owner department:* **procurement** · *Phase SLA:* **10 days** · *Tasks:* **1** · *Task effort:* **10 days** · *Capture mode:* collection

*Exit criteria:* Vendors finalised per category.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Finalise the vendors for this project `p12_finalise` | procurement | 10 | high | Store / Procurement Manager, Siddharth Kumar | Store Head | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Finalise the vendors for this project | Project Manager | Within 10 days | Work down the pre-loaded category checklist. Add each vendor on the vendor form, upload their quotation, compare, and mark one Finalised per category. |

</details>

<details><summary>Checklists</summary>

- **Finalise the vendors for this project**
  - **(required)** All categories covered
  - At least 3 quotations per category
  - Quotations uploaded
  - **(required)** One vendor finalised per category
  - High-value categories sent to MD

</details>

#### 7. Phase 5 — BOQ, Budget & Gantt  `p13`

Approved drawings plus finalised vendor rates converge into the plan the MD monitors for the rest of the project. The Gantt is the primary tracking view; the approved plan is frozen as the baseline so all later slippage is measurable.

*Owner department:* **projects** · *Phase SLA:* **2 days** · *Tasks:* **1** · *Task effort:* **3 days** · *Capture mode:* collection

*Exit criteria:* BOQ, budget and Gantt approved. Baseline frozen.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Build the BOQ — one line per thing to buy `p13_t1` | projects | 3 | critical | Siddharth Kumar | Store / Procurement Manager | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Build the BOQ — one line per thing to buy | Project Manager | Within 3 days of drawings being approved | Open the BOQ list and add one line per item — item, quantity, rate, vendor. Each line goes to the MD for approval and then becomes a purchase order you can print and send. The budget totals itself from the lines, and the timeline is already on the Gantt — there is nothing else to prepare here. |

</details>

<details><summary>Checklists</summary>

- **Build the BOQ — one line per thing to buy**
  - **(required)** Every drawing costed
  - Quantities cross-checked against drawing areas
  - **(required)** Vendor set on each line

</details>

#### 8. Phase 6 — Purchase Orders & Delivery Tracking  `p15`

Every BOQ line from Phase 5 is a purchase order. Send each one to its vendor, then track it on one sheet — ordered, dispatched, delivered, received — with the PO, indent, challan and GRN numbers, what arrived against what was ordered, and who updated what, when. Runs alongside civil works on site.

*Owner department:* **procurement** · *Phase SLA:* **45 days** · *Tasks:* **2** · *Task effort:* **90 days** · *Capture mode:* single

*Exit criteria:* Every purchase order sent and dispatched by its vendor; deliveries and GRNs tracked to closure on the same sheet.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Send every PO and keep the tracker honest `p15_t1` | procurement | 45 | critical | Store / Procurement Manager, Store Head | Siddharth Kumar | Not required |
| 2 | Receive goods at site and record the GRN `p15_t3` | operations | 45 | high | Store Head, Fardeen | Logistics Head | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Send every PO and keep the tracker honest | Procurement | From BOQ approval until the last order lands | Open the order tracker. Send each BOQ line as a PO by WhatsApp or email, then keep its status current as the vendor reports — Ordered, Dispatched, Delivered — with challan / LR numbers. Late orders turn red; use Chase to draft the follow-up. Sending and tracking are one continuous job, not two tasks. |
| Receive goods at site and record the GRN | Store Manager / Site Supervisor | On each delivery | Count what arrived. In the tracker, enter the received quantity, GRN number and received date — the pending quantity and "Partly Received" are worked out for you. Note anything short or damaged. |

</details>

<details><summary>Checklists</summary>

- **Send every PO and keep the tracker honest**
  - **(required)** Every BOQ line sent as a PO
  - PO and indent numbers filled in
  - **(required)** Statuses kept current as vendors report
  - Late orders chased
- **Receive goods at site and record the GRN**
  - Received quantity entered for every delivery
  - **(required)** GRN number recorded
  - Short / damaged items noted

</details>

#### 9. Phase 7 — Site Execution / Civil Works  `p6`

Physical construction on site, reported daily by the site supervisor from a mobile-friendly form designed to take under two minutes.

*Owner department:* **projects** · *Phase SLA:* **45 days** · *Tasks:* **3** · *Task effort:* **69 days** · *Capture mode:* collection

*Exit criteria:* Civil and fit-out works complete as per approved drawings and BOQ.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Report from site every working day `p6_daily_report` | construction | 45 | high | Fardeen | Ram Singh | Yes — Project Manager |
| 2 | Start hiring for this centre `p6_hiring` | hr | 12 | high | Radhika | Ajay Sahni | Yes |
| 3 | Get the site technically ready `p6_tech` | it | 12 | high | Chandan Kumar | Siddharth Kumar | Yes |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Report from site every working day | Site Supervisor | Every working day, by 6 pm | Open the daily form on your phone: progress, manpower, materials, photos, blockers — under two minutes. The reports build the list the PM and MD watch. |
| Start hiring for this centre | HR / Hiring owner | Start within 3 days of site handover | Open HRMS and create a requisition for every role this centre needs — the centre presets (Game Masters ×4, Centre Manager…) are one click. Draft each JD with AI, open applications, and share the public apply link on WhatsApp and job portals. Move candidates through the pipeline as interviews happen; Phase 8 checks the hired count against headcount. |
| Get the site technically ready | IT / Technical | Alongside civil works | Work with the contractor while the walls are open: internet line ordered, network and CCTV cable routes laid, power points placed to the game layout, control-room space kept. Phase 10 installs onto what you rough-in here — anything missed now means breaking finished walls later. |

</details>

<details><summary>Checklists</summary>

- **Report from site every working day**
  - **(required)** A report filed for every working day
  - Photographs attached to every report
  - Every blocker raised the same day it appeared
  - **(required)** Civil and fit-out works complete as per approved drawings and BOQ
- **Start hiring for this centre**
  - **(required)** Requisition created for every role
  - **(required)** JDs approved and applications open
  - Apply link shared (WhatsApp / portals)
  - First interviews scheduled
- **Get the site technically ready**
  - Internet connection ordered
  - **(required)** Network & CCTV cabling routed
  - **(required)** Power points as per game layout
  - Control room space ready

</details>

#### 10. Phase 8 — Quality Check  `p16`

An independent quality gate before material transfer and installation begin. Any Fail raises a rectification task automatically — the gate cannot pass while a mandatory Fail is open.

*Owner department:* **operations** · *Phase SLA:* **5 days** · *Tasks:* **4** · *Task effort:* **12 days** · *Capture mode:* collection

*Exit criteria:* QC passed with all mandatory items cleared.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Inspect the site & file QC items `p16_inspect` | operations | 3 | critical | Ajay Sahni | Shishir | Not required |
| 2 | Fix what failed & re-check `p16_rectify` | construction | 5 | critical | Ram Singh | Fardeen | Not required |
| 3 | Check hiring is on track `p16_hiring_check` | hr | 2 | high | Radhika | Ajay Sahni | Not required |
| 4 | Verify the technical setup `p16_tech_check` | it | 2 | high | Chandan Kumar | Siddharth Kumar | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Inspect the site & file QC items | Operations Head | Within 3 days | Walk the whole site and file one QC Item per check — civil, tiles, HVAC, fire, electrical… Pass or Fail, photos attached. A Fail asks who must fix it and by when. Every item goes to the MD to accept or reject; a rejected item comes back to you with the reason, to redo. |
| Fix what failed & re-check | Contractor / Site team | As fails are filed | Work the Fail list: fix each item, attach closure photos, and set its rectification status to Re-checked & Closed. The phase cannot pass while a Critical or Major fail is open. |
| Check hiring is on track | HR / Hiring owner | During QC week | Open the HRMS overview: hired vs needed for this centre. Chase every role still open — trial runs (Phase 11) need the team standing on site. |
| Verify the technical setup | IT / Technical | During QC week | Test what Phase 7 roughed in: internet live at the site, every power point against the game layout, CCTV and AV routes usable. Log a QC Item with a Fail for anything short — the gate holds it open. |

</details>

<details><summary>Checklists</summary>

- **Inspect the site & file QC items**
  - **(required)** Every area inspected and filed as a QC item
  - Photos attached to every item
  - **(required)** Owner and fix-by date on every Fail
- **Fix what failed & re-check**
  - **(required)** All Critical and Major fails rectified
  - Closure evidence attached
  - Re-check recorded on every fix
- **Check hiring is on track**
  - **(required)** Hired count reviewed against headcount
  - Every open role has interviews scheduled
- **Verify the technical setup**
  - **(required)** Internet tested at site
  - Power points verified against layout
  - Cable routes verified

</details>

#### 11. Phase 9 — Assembly & Installation  `p18`

Game specialist and technical teams install games, props, AV, IT and networking to the approved layout, following the setup standard for each game.

*Owner department:* **automation** · *Phase SLA:* **10 days** · *Tasks:* **3** · *Task effort:* **17 days** · *Capture mode:* collection

*Exit criteria:* All games and systems installed and verified.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Install games, props & AV `p18_games` | automation | 10 | critical | Ram Singh | Chandan Kumar | Not required |
| 2 | Install IT, network & systems `p18_it` | it | 5 | critical | Chandan Kumar | Siddharth Kumar | Not required |
| 3 | Verify every installation `p18_verify` | projects | 2 | high | Siddharth Kumar | Ajay Sahni | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Install games, props & AV | Game Specialist Team | Within 10 days | One Installation record per game / prop zone / AV rig: dates, technician, calibration notes, photos — status ends at Verified, nothing less. |
| Install IT, network & systems | IT Team | Alongside the game installs | Bring the site live on what Phase 7 roughed in: internet, network and CCTV, POS / booking terminal, inventory system. One Installation record per system. |
| Verify every installation | Project Manager | As installs complete | Walk every installation record: photographs attached, calibration noted, then mark it Verified. Phase 11 tests only what is verified here. |

</details>

<details><summary>Checklists</summary>

- **Install games, props & AV**
  - **(required)** All games installed
  - Props placed to layout
  - AV commissioned
- **Install IT, network & systems**
  - **(required)** Internet live
  - Network & CCTV commissioned
  - **(required)** POS / booking terminal live
  - Inventory system integrated
- **Verify every installation**
  - **(required)** Every installation record verified
  - Photographs attached to each

</details>

#### 12. Phase 10 — Testing & Trial Run  `p19`

The branch is physically played and tested end to end. Errors are logged, rectified and re-tested in a loop until All-OK — only then does the readiness gate open.

*Owner department:* **operations** · *Phase SLA:* **10 days** · *Tasks:* **3** · *Task effort:* **17 days** · *Capture mode:* collection

*Exit criteria:* All-OK confirmed; trial run report submitted.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Play & test every game — log every error `p19_test` | operations | 7 | critical | Ajay Sahni | Shishir | Not required |
| 2 | Fix the errors & re-test until All-OK `p19_fix` | automation | 5 | critical | Ram Singh | Chandan Kumar | Not required |
| 3 | Staff readiness & mock run `p19_staff` | hr | 5 | high | Radhika | Ajay Sahni | Not required |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Play & test every game — log every error | Cluster / Branch Manager | Within 7 days | Play every game end to end as a customer would. One Test Run record per game: result, observations (AI drafts the write-up), safety notes — and every error found, with its severity and owner. Finding and logging the errors IS the testing. |
| Fix the errors & re-test until All-OK | Game / technical team | As errors are logged | Work the error log: fix each one, then the game is played again and its re-test result recorded. The loop ends only at All-OK — a fix without a passed re-test is not closed. |
| Staff readiness & mock run | HR / Centre Manager | Before the readiness gate | The hired team (from Phase 7's HRMS pipeline) is trained, briefed per game, signs the SOP, and runs a full mock-customer day. |

</details>

<details><summary>Checklists</summary>

- **Play & test every game — log every error**
  - **(required)** Every game played end to end
  - Safety checked per game
  - **(required)** Every error logged with severity and owner
- **Fix the errors & re-test until All-OK**
  - **(required)** All Critical and Major errors closed
  - Re-test passed on every rectified game
  - **(required)** All-OK confirmed
- **Staff readiness & mock run**
  - **(required)** Training completed
  - Game briefing done
  - SOP acknowledged
  - **(required)** Mock customer run completed

</details>

#### 13. Phase 11 — Readiness Checklist  `p8`

The final consolidated gate. Every department independently confirms its own readiness; mandatory items block launch, optional items are tracked but do not.

*Owner department:* **operations** · *Phase SLA:* **10 days** · *Tasks:* **9** · *Task effort:* **27 days** · *Capture mode:* collection

*Exit criteria:* All mandatory departmental checklists approved.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Readiness: Construction `p8_g1` | construction | 3 | medium | Ram Singh | Fardeen | Yes |
| 2 | Readiness: Utilities `p8_g2` | construction | 3 | critical | Ram Singh | Chandan Kumar | Yes |
| 3 | Readiness: It Systems `p8_g3` | it | 3 | high | Chandan Kumar | Siddharth Kumar | Yes |
| 4 | Readiness: Hiring `p8_g4` | hr | 3 | high | Radhika | Ajay Sahni | Yes |
| 5 | Readiness: Training `p8_g5` | hr | 3 | high | Radhika | Ajay Sahni | Yes |
| 6 | Readiness: Marketing `p8_g6` | marketing | 3 | medium | Marketing Head | Ajay Sahni | Yes |
| 7 | Readiness: Testing `p8_g7` | operations | 3 | critical | Ajay Sahni | Shishir | Yes |
| 8 | Readiness: Inventory `p8_g8` | procurement | 3 | high | Store Head | Store / Procurement Manager | Yes |
| 9 | Readiness: Compliance `p8_g9` | legal | 3 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna | Yes |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Readiness: Construction | Construction department head | Before launch | Tick each item, attach evidence, then give one sign-off for Construction. |
| Readiness: Utilities | Utilities department head | Before launch | Tick each item, attach evidence, then give one sign-off for Utilities. |
| Readiness: It Systems | It Systems department head | Before launch | Tick each item, attach evidence, then give one sign-off for It Systems. |
| Readiness: Hiring | Hiring department head | Before launch | Tick each item, attach evidence, then give one sign-off for Hiring. |
| Readiness: Training | Training department head | Before launch | Tick each item, attach evidence, then give one sign-off for Training. |
| Readiness: Marketing | Marketing department head | Before launch | Tick each item, attach evidence, then give one sign-off for Marketing. |
| Readiness: Testing | Testing department head | Before launch | Tick each item, attach evidence, then give one sign-off for Testing. |
| Readiness: Inventory | Inventory department head | Before launch | Tick each item, attach evidence, then give one sign-off for Inventory. |
| Readiness: Compliance | Compliance department head | Before launch | Tick each item, attach evidence, then give one sign-off for Compliance. |

</details>

<details><summary>Checklists</summary>

- **Readiness: Construction**
  - Civil work complete
  - Flooring complete
  - Ceiling & wall finishes complete
  - Washrooms complete
  - Fire exits constructed
  - Structural safety certified
  - Paint & finishing complete
  - Signage mounting points ready
  - Snag list closed
  - Handover certificate issued
- **Readiness: Utilities**
  - Permanent power connection live
  - DG / UPS backup tested
  - Electrical panel & wiring certified
  - Earthing & safety checks passed
  - Lighting fixtures installed
  - Water & drainage live
  - Water heater installed
  - HVAC commissioned
  - Utility billing account activated
- **Readiness: It Systems**
  - Broadband live with backup link
  - LAN & Wi-Fi access points installed
  - Local systems & servers configured
  - Software licenses activated
  - Helpdesk / support contact set up
  - Backup & data recovery tested
  - Network switches & firewall configured
  - CCTV installed & recording tested
  - Access control & alarm system tested
  - POS hardware installed
  - POS software tested & payment gateway integrated
  - Test transaction completed successfully
- **Readiness: Hiring**
  - Outlet manager onboarded
  - Game masters onboarded
  - Front desk staff onboarded
  - Housekeeping staff onboarded
  - Background verification completed
  - Employment documentation completed
- **Readiness: Training**
  - Game master certification passed
  - Safety drill completed
  - POS training completed
  - Customer service training completed
  - Emergency response training completed
  - Product / experience knowledge test passed
- **Readiness: Marketing**
  - Google Business listing live
  - Booking page live
  - Launch campaign scheduled
  - Social media pages live
  - Local marketing collateral distributed
  - Influencer / press outreach initiated
  - Storefront signage installed
  - Interior branding installed
  - Directional signage installed
  - Brand guideline compliance verified
- **Readiness: Testing**
  - Full dry run completed
  - Puzzle / game difficulty tuned
  - Reset time measured & optimized
  - End-to-end customer journey tested
  - Emergency override & safety systems tested
  - Staff shift simulation completed
  - Booking-to-checkout flow tested
  - Feedback from soft-launch reviewed
- **Readiness: Inventory**
  - Opening stock received
  - Consumables buffer in place
  - Asset register updated
  - Stock stored & labeled
  - Inventory management system updated
  - Reorder levels configured
  - Stock audit completed
  - Vendor supply schedule confirmed
  - Furniture & fixtures installed
  - Furniture safety check passed
- **Readiness: Compliance**
  - Fire NOC received
  - Trade licence received
  - Insurance active
  - Shops & Establishment registered
  - GST registration updated for outlet
  - Signage / hoarding permission received
  - Local municipal compliance certificate received
  - Labour law compliance documentation filed
  - Fire extinguishers & alarm system tested
  - Fire drill conducted

</details>

#### 14. Phase 12 — Branch Opening / Handover  `p9`

Formal go-live and transfer of the completed site to the operations team, with the full handover pack.

*Owner department:* **operations** · *Phase SLA:* **5 days** · *Tasks:* **12** · *Task effort:* **36 days** · *Capture mode:* collection

*Exit criteria:* Branch live; handover accepted by Operations.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Go-live: Operations `p9_g1` | operations | 3 | medium | Ajay Sahni | Shishir, Yogita Chauhan, Yash Shroff, Ashwini Rawale, Vishal Saluja, Dawood Yousuf | Yes |
| 2 | Go-live: It `p9_g2` | it | 3 | high | Chandan Kumar | Siddharth Kumar | Yes |
| 3 | Go-live: Pos `p9_g3` | it | 3 | critical | Chandan Kumar | Store Head | Yes |
| 4 | Go-live: Internet `p9_g4` | it | 3 | critical | Chandan Kumar | Siddharth Kumar | Yes |
| 5 | Go-live: Power Backup `p9_g5` | construction | 3 | critical | Ram Singh | Chandan Kumar | Yes |
| 6 | Go-live: Staff `p9_g6` | hr | 3 | high | Radhika | Ajay Sahni | Yes |
| 7 | Go-live: Security `p9_g7` | operations | 3 | high | Ajay Sahni | Ram Singh | Yes |
| 8 | Go-live: Emergency Contacts `p9_g8` | operations | 3 | medium | Ajay Sahni | Radhika | Yes |
| 9 | Go-live: Inventory `p9_g9` | procurement | 3 | high | Store Head | Store / Procurement Manager | Yes |
| 10 | Go-live: Marketing `p9_g10` | marketing | 3 | high | Marketing Head | Ajay Sahni | Yes |
| 11 | Go-live: Legal `p9_g11` | legal | 3 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna | Yes |
| 12 | Go-live: Finance `p9_g12` | finance | 3 | medium | Prateek | Siddharth Kumar | Yes |

<details><summary>Who / when / how (client document wording)</summary>

| Task | Who | When | How |
|---|---|---|---|
| Go-live: Operations | Operations department head | Before launch | Tick each item, attach evidence, then give one sign-off for Operations. |
| Go-live: It | It department head | Before launch | Tick each item, attach evidence, then give one sign-off for It. |
| Go-live: Pos | Pos department head | Before launch | Tick each item, attach evidence, then give one sign-off for Pos. |
| Go-live: Internet | Internet department head | Before launch | Tick each item, attach evidence, then give one sign-off for Internet. |
| Go-live: Power Backup | Power Backup department head | Before launch | Tick each item, attach evidence, then give one sign-off for Power Backup. |
| Go-live: Staff | Staff department head | Before launch | Tick each item, attach evidence, then give one sign-off for Staff. |
| Go-live: Security | Security department head | Before launch | Tick each item, attach evidence, then give one sign-off for Security. |
| Go-live: Emergency Contacts | Emergency Contacts department head | Before launch | Tick each item, attach evidence, then give one sign-off for Emergency Contacts. |
| Go-live: Inventory | Inventory department head | Before launch | Tick each item, attach evidence, then give one sign-off for Inventory. |
| Go-live: Marketing | Marketing department head | Before launch | Tick each item, attach evidence, then give one sign-off for Marketing. |
| Go-live: Legal | Legal department head | Before launch | Tick each item, attach evidence, then give one sign-off for Legal. |
| Go-live: Finance | Finance department head | Before launch | Tick each item, attach evidence, then give one sign-off for Finance. |

</details>

<details><summary>Checklists</summary>

- **Go-live: Operations**
  - Final cleanliness inspection passed
  - All fixtures & fittings verified
  - Safety walkthrough completed
  - Emergency exits verified clear
  - Final photography documentation completed
  - Snag list closed
  - Inspection sign-off obtained
  - Store handover accepted from Construction
  - Final Go-Live Approval
- **Go-live: It**
  - IT systems final go-live check
  - Helpdesk on standby for launch day
  - Local servers & backup verified live
  - POS network connectivity confirmed
  - IT asset inventory reconciled
- **Go-live: Pos**
  - POS hardware powered on & tested
  - Billing software live
  - Payment gateway activated
  - Test transaction completed successfully
  - Billing staff logins issued
  - Receipt printer tested
- **Go-live: Internet**
  - Primary ISP live on launch day
  - Backup ISP link tested
  - Guest Wi-Fi live
  - Network speed verified
- **Go-live: Power Backup**
  - Mains power confirmed live
  - DG / UPS backup tested on launch day
  - Backup runtime verified
  - Power failover tested end-to-end
- **Go-live: Staff**
  - All staff reported on time
  - Attendance system verified
  - Uniforms & ID badges issued
  - Shift roster confirmed
  - Final staff briefing completed
- **Go-live: Security**
  - CCTV live & recording on launch day
  - Security guard posted
  - Access control tested
  - Emergency lockdown procedure briefed
- **Go-live: Emergency Contacts**
  - Emergency contact list posted on-site
  - Fire department contact verified
  - Nearest hospital contact verified
  - Local police contact verified
- **Go-live: Inventory**
  - Opening stock counted
  - Stock tallied against purchase orders
  - Consumables buffer verified
  - Inventory system updated with opening stock
  - Reorder levels configured
- **Go-live: Marketing**
  - Launch campaign activated
  - Social media announcement posted
  - Google Business listing updated to open
  - Opening day offers configured
  - Press / influencer outreach completed
- **Go-live: Legal**
  - Trade license displayed
  - Fire NOC displayed
  - Insurance certificate on file
  - Statutory signage displayed
  - Local compliance certificate verified
- **Go-live: Finance**
  - Petty cash float set up
  - Bank settlement account linked
  - Daily settlement process briefed
  - Finance sign-off obtained

</details>

#### 15. Phase 13 — Closure & Delay Analysis  `p10`

Plan versus actual for every phase, department-wise delay attribution, budget variance and vendor performance — the learning that feeds back into the template.

*Owner department:* **finance** · *Phase SLA:* **7 days** · *Tasks:* **4** · *Task effort:* **5 days** · *Capture mode:* collection

*Exit criteria:* Closure report accepted; project archived but permanently searchable.

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) | Approval |
|---:|---|---|---:|---|---|---|---|
| 1 | Budget variance analysis `p10_t1` | finance | 2 | high | Prateek | Siddharth Kumar | — |
| 2 | Delay & schedule analysis `p10_t2` | projects | 1 | medium | Siddharth Kumar | Prateek | — |
| 3 | Vendor performance review `p10_t3` | procurement | 1 | medium | Store / Procurement Manager, Store Head | Siddharth Kumar | — |
| 4 | Lessons learned documentation `p10_t4` | operations | 1 | medium | Siddharth Kumar, Ajay Sahni | Prateek, Shikhir, Sapna | — |

<details><summary>Checklists</summary>

- **Budget variance analysis**
  - Planned vs actual compiled
  - Overruns explained
  - **(required)** Final cost signed off
- **Delay & schedule analysis**
  - Phase-wise slippage computed
  - Root causes documented
- **Vendor performance review**
  - Vendors scored
  - Blacklist / preferred list updated
- **Lessons learned documentation**
  - Retrospective held
  - **(required)** Playbook updated for next outlet

</details>

---

## B. Store Launch — Official PMS Workflow

`MR-PMS-STORE-LAUNCH` · The complete 10-phase lifecycle for opening a new outlet — property identification through project closure, with departmental checklists, doers and backup buddies.

| | |
|---|---|
| **Category** | Store Launch |
| **Status** | published · **default template** (new project starts here) |
| **Phases** | 10 |
| **Tasks** | 179 |
| **Total task effort** | 238 working days (sum of every task's estimate) |
| **Total phase SLA** | 114 days (sum of each phase's target duration) |

### Phase summary

| # | Phase | Owner dept | SLA (days) | Tasks | Task effort (days) | Runs with |
|---:|---|---|---:|---:|---:|---|
| 1 | Property Identification `p1` | expansion | 10 | 4 | 10 | — |
| 2 | Site Evaluation `p2` | expansion | 8 | 4 | 7 | — |
| 3 | Commercial Finalization `p3` | legal | 12 | 5 | 10 | — |
| 4 | Project Creation `p4` | projects | 5 | 3 | 5 | — |
| 5 | Department Planning `p5` | projects | 7 | 10 | 10 | — |
| 6 | Execution `p6` | projects | 45 | 5 | 45 | — |
| 7 | Approval Workflow `p7` | operations | 5 | 3 | 5 | — |
| 8 | Store Readiness Checklist `p8` | operations | 10 | 81 | 81 | — |
| 9 | Store Launch `p9` | operations | 5 | 60 | 60 | — |
| 10 | Project Closure `p10` | finance | 7 | 4 | 5 | — |

**Where the doers come from:** 9 task(s) have a per-task rule in `realRoster.js`, 170 fall back to their department's head, 0 keep the names written in the template file.

### Phase by phase — tasks, doers, duration

#### 1. Property Identification  `p1`

Search the catchment, capture every option in a comparable format, and shortlist or reject.

*Owner department:* **expansion** · *Phase SLA:* **10 days** · *Tasks:* **4** · *Task effort:* **10 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Search & source candidate properties `p1_t1` | expansion | 3 | high | Manoj Parihar | Siddharth Kumar |
| 2 | Capture property details `p1_t2` | expansion | 2 | medium | Manoj Parihar | Siddharth Kumar |
| 3 | Upload documents & photographs `p1_t3` | expansion | 2 | medium | Manoj Parihar | Siddharth Kumar |
| 4 | Shortlist or reject decision `p1_t4` | expansion | 3 | high | Manoj Parihar | Siddharth Kumar |

<details><summary>Checklists</summary>

- **Search & source candidate properties**
  - **(required)** Local brokers engaged
  - Minimum 5 options sourced
  - Target localities agreed
- **Capture property details**
  - **(required)** Carpet area recorded
  - Frontage & floor recorded
  - Quoted rent recorded
  - Landlord contact captured
- **Upload documents & photographs**
  - **(required)** Ownership documents uploaded
  - Site photographs uploaded
  - Floor plan uploaded
- **Shortlist or reject decision**
  - **(required)** Scorecard completed for each option
  - Rejection reasons logged
  - **(required)** Shortlist signed off by Expansion Head

</details>

#### 2. Site Evaluation  `p2`

Run the feasibility, financial, technical and operational assessments on every shortlisted site.

*Owner department:* **expansion** · *Phase SLA:* **8 days** · *Tasks:* **4** · *Task effort:* **7 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Feasibility assessment `p2_t1` | expansion | 2 | high | Manoj Parihar | Siddharth Kumar |
| 2 | Financial assessment `p2_t2` | finance | 2 | critical | Prateek | Siddharth Kumar |
| 3 | Technical assessment `p2_t3` | construction | 2 | high | Ram Singh | Fardeen |
| 4 | Operational assessment `p2_t4` | operations | 1 | medium | Ajay Sahni | Shishir |

<details><summary>Checklists</summary>

- **Feasibility assessment**
  - **(required)** Footfall & catchment study done
  - Competitor mapping done
  - Accessibility & parking assessed
- **Financial assessment**
  - Rent-to-revenue ratio modelled
  - **(required)** Break-even month projected
  - Setup Cost estimate prepared
  - **(required)** Return on Investment threshold met
- **Technical assessment**
  - **(required)** Structural survey completed
  - Power load verified
  - Water & drainage verified
  - **(required)** Fire exits verified
- **Operational assessment**
  - Game room layout viable
  - Staff room & storage viable
  - Customer flow simulated

</details>

#### 3. Commercial Finalization  `p3`

LOI, lease agreement, legal verification, deposits, NOCs and statutory approvals.

*Owner department:* **legal** · *Phase SLA:* **12 days** · *Tasks:* **5** · *Task effort:* **10 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Issue Letter of Intent (LOI) `p3_t1` | legal | 2 | high | Prateek, Shikhir, Sapna | Siddharth Kumar |
| 2 | Draft & finalize lease agreement `p3_t2` | legal | 3 | critical | Prateek, Shikhir, Sapna | Siddharth Kumar |
| 3 | Legal verification & title due diligence `p3_t3` | legal | 2 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 4 | Security deposit & token payment `p3_t4` | finance | 1 | high | Prateek | Siddharth Kumar |
| 5 | NOCs & statutory approvals `p3_t5` | legal | 2 | high | Siddharth Kumar | Ajay Sahni |

<details><summary>Checklists</summary>

- **Issue Letter of Intent (LOI)**
  - Commercials agreed with landlord
  - LOI drafted
  - **(required)** LOI countersigned
- **Draft & finalize lease agreement**
  - Lock-in period agreed
  - Escalation clause agreed
  - Exit clause reviewed
  - **(required)** Agreement registered
- **Legal verification & title due diligence**
  - **(required)** Title chain verified
  - Encumbrance certificate obtained
  - Landlord identity verified
- **Security deposit & token payment**
  - **(required)** Deposit approved
  - Payment released
  - Receipt filed
- **NOCs & statutory approvals**
  - **(required)** Fire NOC applied
  - **(required)** Trade licence applied
  - Society / mall NOC obtained
  - Signage permission obtained

</details>

#### 4. Project Creation  `p4`

Convert the commercially finalized site into a live project — information, budget, timeline, manager, team and final approval.

*Owner department:* **projects** · *Phase SLA:* **5 days** · *Tasks:* **3** · *Task effort:* **5 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Define project budget `p4_t1` | finance | 2 | critical | Prateek | Siddharth Kumar |
| 2 | Set target opening date `p4_t2` | projects | 1 | high | Siddharth Kumar | Ajay Sahni |
| 3 | Assign project manager `p4_t3` | projects | 2 | high | Siddharth Kumar | Ajay Sahni |

<details><summary>Checklists</summary>

- **Define project budget**
  - Setup Cost heads broken down
  - Contingency % agreed
  - **(required)** Budget approved by Management
- **Set target opening date**
  - Backward schedule prepared
  - Long-lead items identified
  - **(required)** Date communicated to all departments
- **Assign project manager**
  - **(required)** PM named & accepted
  - Handover from Expansion completed
  - Kick-off meeting held

</details>

#### 5. Department Planning  `p5`

Allocate the work packet to every department. Each allocation names a doer and a backup buddy.

*Owner department:* **projects** · *Phase SLA:* **7 days** · *Tasks:* **10** · *Task effort:* **10 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Allocate Construction scope `p5_t1` | construction | 1 | high | Ram Singh | Fardeen |
| 2 | Allocate Interior scope `p5_t2` | interior | 1 | high | Architect / Design Team | Siddharth Kumar |
| 3 | Allocate Procurement scope `p5_t3` | procurement | 1 | high | Store / Procurement Manager | Store Head |
| 4 | Allocate Automation scope `p5_t4` | automation | 1 | medium | Ram Singh | Chandan Kumar |
| 5 | Allocate IT scope `p5_t5` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 6 | Allocate Marketing scope `p5_t6` | marketing | 1 | medium | Marketing Head | Ajay Sahni |
| 7 | Allocate HR scope `p5_t7` | hr | 1 | medium | Radhika | Ajay Sahni |
| 8 | Allocate Finance scope `p5_t8` | finance | 1 | medium | Prateek | Siddharth Kumar |
| 9 | Allocate Operations scope `p5_t9` | operations | 1 | medium | Ajay Sahni | Shishir |
| 10 | Allocate Legal scope `p5_t10` | legal | 1 | medium | Siddharth Kumar | Prateek, Shikhir, Sapna |

<details><summary>Checklists</summary>

- **Allocate Construction scope**
  - Scope of work issued
  - Contractor shortlisted
  - Timeline committed
- **Allocate Interior scope**
  - Theme brief issued
  - Drawings approved
  - Timeline committed
- **Allocate Procurement scope**
  - BOQ finalized
  - **(required)** Long-lead items ordered
  - Vendor SLAs signed
- **Allocate Automation scope**
  - Game automation spec issued
  - Integration plan agreed
- **Allocate IT scope**
  - Network & POS spec issued
  - Hardware indent raised
- **Allocate Marketing scope**
  - Launch campaign brief issued
  - Budget allocated
- **Allocate HR scope**
  - Manpower plan approved
  - Hiring timeline committed
- **Allocate Finance scope**
  - Cash-flow plan issued
  - Payment milestones agreed
- **Allocate Operations scope**
  - SOP pack issued
  - Opening rota drafted
- **Allocate Legal scope**
  - Compliance calendar issued
  - Vendor contracts queued

</details>

#### 6. Execution  `p6`

Run the build. Track status, progress, attachments, dependencies and delays against the plan.

*Owner department:* **projects** · *Phase SLA:* **45 days** · *Tasks:* **5** · *Task effort:* **45 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Track task status & progress `p6_t1` | projects | 12 | high | Siddharth Kumar | Ajay Sahni |
| 2 | Maintain attachments & site evidence `p6_t2` | projects | 8 | low | Siddharth Kumar | Ajay Sahni |
| 3 | Manage inter-department dependencies `p6_t3` | projects | 10 | high | Siddharth Kumar | Ajay Sahni |
| 4 | Flag & escalate delays `p6_t4` | projects | 8 | critical | Siddharth Kumar | Ajay Sahni |
| 5 | Weekly progress review `p6_t5` | operations | 7 | medium | Ajay Sahni | Shishir |

<details><summary>Checklists</summary>

- **Track task status & progress**
  - Progress % updated weekly
  - Blockers raised within 24h
- **Maintain attachments & site evidence**
  - Weekly site photos uploaded
  - Bills & invoices attached
- **Manage inter-department dependencies**
  - **(required)** Dependency map maintained
  - Handover dates confirmed
- **Flag & escalate delays**
  - Delays flagged with reason
  - **(required)** Recovery plan agreed
  - Management informed
- **Weekly progress review**
  - Review deck circulated
  - Actions assigned with owners

</details>

#### 7. Approval Workflow  `p7`

Department and management approvals that gate progression to store readiness.

*Owner department:* **operations** · *Phase SLA:* **5 days** · *Tasks:* **3** · *Task effort:* **5 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Department head sign-off `p7_t1` | operations | 2 | high | Ajay Sahni | Shishir |
| 2 | Management approval `p7_t2` | finance | 2 | critical | Prateek | Siddharth Kumar |
| 3 | Stage progression gate `p7_t3` | projects | 1 | high | Siddharth Kumar | Ajay Sahni |

<details><summary>Checklists</summary>

- **Department head sign-off**
  - **(required)** Every department has signed off
  - Open snags listed
- **Management approval**
  - Budget variance reviewed
  - Schedule variance reviewed
  - **(required)** Approval recorded
- **Stage progression gate**
  - **(required)** All prior phases marked complete
  - Gate decision logged

</details>

#### 8. Store Readiness Checklist  `p8`

The pre-launch gate: construction, utilities, IT, hiring, training, marketing, testing, inventory and compliance.

*Owner department:* **operations** · *Phase SLA:* **10 days** · *Tasks:* **81** · *Task effort:* **81 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Civil work complete `p8_construction_1` | construction | 1 | medium | Ram Singh | Fardeen |
| 2 | Flooring complete `p8_construction_2` | construction | 1 | medium | Ram Singh | Fardeen |
| 3 | Ceiling & wall finishes complete `p8_construction_3` | construction | 1 | medium | Ram Singh | Fardeen |
| 4 | Washrooms complete `p8_construction_4` | construction | 1 | medium | Ram Singh | Fardeen |
| 5 | Fire exits constructed `p8_construction_5` | construction | 1 | high | Ram Singh | Fardeen |
| 6 | Structural safety certified `p8_construction_6` | construction | 1 | high | Ram Singh | Fardeen |
| 7 | Paint & finishing complete `p8_construction_7` | construction | 1 | medium | Ram Singh | Fardeen |
| 8 | Signage mounting points ready `p8_construction_8` | construction | 1 | low | Ram Singh | Fardeen |
| 9 | Snag list closed `p8_construction_9` | construction | 1 | high | Ram Singh | Fardeen |
| 10 | Handover certificate issued `p8_construction_10` | construction | 1 | high | Ram Singh | Fardeen |
| 11 | Permanent power connection live `p8_utilities_1` | construction | 1 | critical | Ram Singh | Fardeen |
| 12 | DG / UPS backup tested `p8_utilities_2` | construction | 1 | high | Ram Singh | Fardeen |
| 13 | Electrical panel & wiring certified `p8_utilities_3` | construction | 1 | high | Ram Singh | Fardeen |
| 14 | Earthing & safety checks passed `p8_utilities_4` | construction | 1 | high | Ram Singh | Fardeen |
| 15 | Lighting fixtures installed `p8_utilities_5` | construction | 1 | medium | Ram Singh | Fardeen |
| 16 | Water & drainage live `p8_utilities_6` | construction | 1 | high | Ram Singh | Fardeen |
| 17 | Water heater installed `p8_utilities_7` | construction | 1 | medium | Ram Singh | Fardeen |
| 18 | HVAC commissioned `p8_utilities_8` | construction | 1 | high | Ram Singh | Fardeen |
| 19 | Utility billing account activated `p8_utilities_9` | construction | 1 | medium | Ram Singh | Fardeen |
| 20 | Broadband live with backup link `p8_it_1` | it | 1 | high | Chandan Kumar | Siddharth Kumar |
| 21 | LAN & Wi-Fi access points installed `p8_it_2` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 22 | Local systems & servers configured `p8_it_3` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 23 | Software licenses activated `p8_it_4` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 24 | Helpdesk / support contact set up `p8_it_5` | it | 1 | low | Chandan Kumar | Siddharth Kumar |
| 25 | Backup & data recovery tested `p8_it_6` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 26 | Network switches & firewall configured `p8_it_7` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 27 | CCTV installed & recording tested `p8_it_8` | it | 1 | high | Chandan Kumar | Siddharth Kumar |
| 28 | Access control & alarm system tested `p8_it_9` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 29 | POS hardware installed `p8_it_10` | it | 1 | high | Chandan Kumar | Siddharth Kumar |
| 30 | POS software tested & payment gateway integrated `p8_it_11` | it | 1 | critical | Chandan Kumar | Siddharth Kumar |
| 31 | Test transaction completed successfully `p8_it_12` | it | 1 | high | Chandan Kumar | Siddharth Kumar |
| 32 | Outlet manager onboarded `p8_hiring_1` | hr | 1 | high | Radhika | Ajay Sahni |
| 33 | Game masters onboarded `p8_hiring_2` | hr | 1 | high | Radhika | Ajay Sahni |
| 34 | Front desk staff onboarded `p8_hiring_3` | hr | 1 | medium | Radhika | Ajay Sahni |
| 35 | Housekeeping staff onboarded `p8_hiring_4` | hr | 1 | medium | Radhika | Ajay Sahni |
| 36 | Background verification completed `p8_hiring_5` | hr | 1 | medium | Radhika | Ajay Sahni |
| 37 | Employment documentation completed `p8_hiring_6` | hr | 1 | medium | Radhika | Ajay Sahni |
| 38 | Game master certification passed `p8_training_1` | hr | 1 | high | Radhika | Ajay Sahni |
| 39 | Safety drill completed `p8_training_2` | hr | 1 | high | Radhika | Ajay Sahni |
| 40 | POS training completed `p8_training_3` | hr | 1 | medium | Radhika | Ajay Sahni |
| 41 | Customer service training completed `p8_training_4` | hr | 1 | medium | Radhika | Ajay Sahni |
| 42 | Emergency response training completed `p8_training_5` | hr | 1 | medium | Radhika | Ajay Sahni |
| 43 | Product / experience knowledge test passed `p8_training_6` | hr | 1 | medium | Radhika | Ajay Sahni |
| 44 | Google Business listing live `p8_marketing_1` | marketing | 1 | medium | Marketing Head | Ajay Sahni |
| 45 | Booking page live `p8_marketing_2` | marketing | 1 | high | Marketing Head | Ajay Sahni |
| 46 | Launch campaign scheduled `p8_marketing_3` | marketing | 1 | medium | Marketing Head | Ajay Sahni |
| 47 | Social media pages live `p8_marketing_4` | marketing | 1 | medium | Marketing Head | Ajay Sahni |
| 48 | Local marketing collateral distributed `p8_marketing_5` | marketing | 1 | low | Marketing Head | Ajay Sahni |
| 49 | Influencer / press outreach initiated `p8_marketing_6` | marketing | 1 | low | Marketing Head | Ajay Sahni |
| 50 | Storefront signage installed `p8_marketing_7` | marketing | 1 | high | Marketing Head | Ajay Sahni |
| 51 | Interior branding installed `p8_marketing_8` | marketing | 1 | medium | Marketing Head | Ajay Sahni |
| 52 | Directional signage installed `p8_marketing_9` | marketing | 1 | low | Marketing Head | Ajay Sahni |
| 53 | Brand guideline compliance verified `p8_marketing_10` | marketing | 1 | medium | Marketing Head | Ajay Sahni |
| 54 | Full dry run completed `p8_testing_1` | operations | 1 | critical | Ajay Sahni | Shishir |
| 55 | Puzzle / game difficulty tuned `p8_testing_2` | operations | 1 | medium | Ajay Sahni | Shishir |
| 56 | Reset time measured & optimized `p8_testing_3` | operations | 1 | medium | Ajay Sahni | Shishir |
| 57 | End-to-end customer journey tested `p8_testing_4` | operations | 1 | high | Ajay Sahni | Shishir |
| 58 | Emergency override & safety systems tested `p8_testing_5` | operations | 1 | critical | Ajay Sahni | Shishir |
| 59 | Staff shift simulation completed `p8_testing_6` | operations | 1 | medium | Ajay Sahni | Shishir |
| 60 | Booking-to-checkout flow tested `p8_testing_7` | operations | 1 | high | Ajay Sahni | Shishir |
| 61 | Feedback from soft-launch reviewed `p8_testing_8` | operations | 1 | low | Ajay Sahni | Shishir |
| 62 | Opening stock received `p8_inventory_1` | procurement | 1 | high | Store / Procurement Manager | Store Head |
| 63 | Consumables buffer in place `p8_inventory_2` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 64 | Asset register updated `p8_inventory_3` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 65 | Stock stored & labeled `p8_inventory_4` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 66 | Inventory management system updated `p8_inventory_5` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 67 | Reorder levels configured `p8_inventory_6` | procurement | 1 | low | Store / Procurement Manager | Store Head |
| 68 | Stock audit completed `p8_inventory_7` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 69 | Vendor supply schedule confirmed `p8_inventory_8` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 70 | Furniture & fixtures installed `p8_inventory_9` | procurement | 1 | high | Store / Procurement Manager | Store Head |
| 71 | Furniture safety check passed `p8_inventory_10` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 72 | Fire NOC received `p8_compliance_1` | legal | 1 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 73 | Trade licence received `p8_compliance_2` | legal | 1 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 74 | Insurance active `p8_compliance_3` | legal | 1 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 75 | Shops & Establishment registered `p8_compliance_4` | legal | 1 | high | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 76 | GST registration updated for outlet `p8_compliance_5` | legal | 1 | medium | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 77 | Signage / hoarding permission received `p8_compliance_6` | legal | 1 | medium | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 78 | Local municipal compliance certificate received `p8_compliance_7` | legal | 1 | medium | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 79 | Labour law compliance documentation filed `p8_compliance_8` | legal | 1 | medium | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 80 | Fire extinguishers & alarm system tested `p8_compliance_9` | legal | 1 | high | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 81 | Fire drill conducted `p8_compliance_10` | legal | 1 | medium | Siddharth Kumar | Prateek, Shikhir, Sapna |

#### 9. Store Launch  `p9`

Go-live approval and the public opening.

*Owner department:* **operations** · *Phase SLA:* **5 days** · *Tasks:* **60** · *Task effort:* **60 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Final cleanliness inspection passed `p9_operations_1` | operations | 1 | medium | Ajay Sahni | Shishir |
| 2 | All fixtures & fittings verified `p9_operations_2` | operations | 1 | medium | Ajay Sahni | Shishir |
| 3 | Safety walkthrough completed `p9_operations_3` | operations | 1 | high | Ajay Sahni | Shishir |
| 4 | Emergency exits verified clear `p9_operations_4` | operations | 1 | critical | Ajay Sahni | Shishir |
| 5 | Final photography documentation completed `p9_operations_5` | operations | 1 | low | Ajay Sahni | Shishir |
| 6 | Snag list closed `p9_operations_6` | operations | 1 | high | Ajay Sahni | Shishir |
| 7 | Inspection sign-off obtained `p9_operations_7` | operations | 1 | high | Ajay Sahni | Shishir |
| 8 | Store handover accepted from Construction `p9_operations_8` | operations | 1 | high | Ajay Sahni | Shishir |
| 9 | IT systems final go-live check `p9_it_1` | it | 1 | high | Chandan Kumar | Siddharth Kumar |
| 10 | Helpdesk on standby for launch day `p9_it_2` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 11 | Local servers & backup verified live `p9_it_3` | it | 1 | high | Chandan Kumar | Siddharth Kumar |
| 12 | POS network connectivity confirmed `p9_it_4` | it | 1 | critical | Chandan Kumar | Siddharth Kumar |
| 13 | IT asset inventory reconciled `p9_it_5` | it | 1 | low | Chandan Kumar | Siddharth Kumar |
| 14 | POS hardware powered on & tested `p9_pos_1` | it | 1 | critical | Chandan Kumar | Siddharth Kumar |
| 15 | Billing software live `p9_pos_2` | it | 1 | critical | Chandan Kumar | Siddharth Kumar |
| 16 | Payment gateway activated `p9_pos_3` | it | 1 | critical | Chandan Kumar | Siddharth Kumar |
| 17 | Test transaction completed successfully `p9_pos_4` | it | 1 | high | Chandan Kumar | Siddharth Kumar |
| 18 | Billing staff logins issued `p9_pos_5` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 19 | Receipt printer tested `p9_pos_6` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 20 | Primary ISP live on launch day `p9_internet_1` | it | 1 | critical | Chandan Kumar | Siddharth Kumar |
| 21 | Backup ISP link tested `p9_internet_2` | it | 1 | high | Chandan Kumar | Siddharth Kumar |
| 22 | Guest Wi-Fi live `p9_internet_3` | it | 1 | low | Chandan Kumar | Siddharth Kumar |
| 23 | Network speed verified `p9_internet_4` | it | 1 | medium | Chandan Kumar | Siddharth Kumar |
| 24 | Mains power confirmed live `p9_power_1` | construction | 1 | critical | Ram Singh | Fardeen |
| 25 | DG / UPS backup tested on launch day `p9_power_2` | construction | 1 | high | Ram Singh | Fardeen |
| 26 | Backup runtime verified `p9_power_3` | construction | 1 | medium | Ram Singh | Fardeen |
| 27 | Power failover tested end-to-end `p9_power_4` | construction | 1 | high | Ram Singh | Fardeen |
| 28 | All staff reported on time `p9_staff_1` | hr | 1 | high | Radhika | Ajay Sahni |
| 29 | Attendance system verified `p9_staff_2` | hr | 1 | medium | Radhika | Ajay Sahni |
| 30 | Uniforms & ID badges issued `p9_staff_3` | hr | 1 | medium | Radhika | Ajay Sahni |
| 31 | Shift roster confirmed `p9_staff_4` | hr | 1 | medium | Radhika | Ajay Sahni |
| 32 | Final staff briefing completed `p9_staff_5` | hr | 1 | high | Radhika | Ajay Sahni |
| 33 | CCTV live & recording on launch day `p9_security_1` | operations | 1 | high | Ajay Sahni | Shishir |
| 34 | Security guard posted `p9_security_2` | operations | 1 | high | Ajay Sahni | Shishir |
| 35 | Access control tested `p9_security_3` | operations | 1 | medium | Ajay Sahni | Shishir |
| 36 | Emergency lockdown procedure briefed `p9_security_4` | operations | 1 | medium | Ajay Sahni | Shishir |
| 37 | Emergency contact list posted on-site `p9_emergency_1` | operations | 1 | medium | Ajay Sahni | Shishir |
| 38 | Fire department contact verified `p9_emergency_2` | operations | 1 | medium | Ajay Sahni | Shishir |
| 39 | Nearest hospital contact verified `p9_emergency_3` | operations | 1 | medium | Ajay Sahni | Shishir |
| 40 | Local police contact verified `p9_emergency_4` | operations | 1 | medium | Ajay Sahni | Shishir |
| 41 | Opening stock counted `p9_inventory_1` | procurement | 1 | high | Store / Procurement Manager | Store Head |
| 42 | Stock tallied against purchase orders `p9_inventory_2` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 43 | Consumables buffer verified `p9_inventory_3` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 44 | Inventory system updated with opening stock `p9_inventory_4` | procurement | 1 | medium | Store / Procurement Manager | Store Head |
| 45 | Reorder levels configured `p9_inventory_5` | procurement | 1 | low | Store / Procurement Manager | Store Head |
| 46 | Launch campaign activated `p9_marketing_1` | marketing | 1 | high | Marketing Head | Ajay Sahni |
| 47 | Social media announcement posted `p9_marketing_2` | marketing | 1 | medium | Marketing Head | Ajay Sahni |
| 48 | Google Business listing updated to open `p9_marketing_3` | marketing | 1 | medium | Marketing Head | Ajay Sahni |
| 49 | Opening day offers configured `p9_marketing_4` | marketing | 1 | low | Marketing Head | Ajay Sahni |
| 50 | Press / influencer outreach completed `p9_marketing_5` | marketing | 1 | low | Marketing Head | Ajay Sahni |
| 51 | Trade license displayed `p9_legal_1` | legal | 1 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 52 | Fire NOC displayed `p9_legal_2` | legal | 1 | critical | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 53 | Insurance certificate on file `p9_legal_3` | legal | 1 | high | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 54 | Statutory signage displayed `p9_legal_4` | legal | 1 | medium | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 55 | Local compliance certificate verified `p9_legal_5` | legal | 1 | high | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 56 | Petty cash float set up `p9_finance_1` | finance | 1 | medium | Prateek | Siddharth Kumar |
| 57 | Bank settlement account linked `p9_finance_2` | finance | 1 | high | Prateek | Siddharth Kumar |
| 58 | Daily settlement process briefed `p9_finance_3` | finance | 1 | medium | Prateek | Siddharth Kumar |
| 59 | Finance sign-off obtained `p9_finance_4` | finance | 1 | high | Prateek | Siddharth Kumar |
| 60 | Final Go-Live Approval `p9_golive_final` | operations | 1 | critical | Ajay Sahni | Shishir |

#### 10. Project Closure  `p10`

Close the book: budget variance, delay analysis, vendor performance and lessons learned.

*Owner department:* **finance** · *Phase SLA:* **7 days** · *Tasks:* **4** · *Task effort:* **5 days** · *Capture mode:* collection

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Budget variance analysis `p10_t1` | finance | 2 | high | Prateek | Siddharth Kumar |
| 2 | Delay & schedule analysis `p10_t2` | projects | 1 | medium | Siddharth Kumar | Prateek |
| 3 | Vendor performance review `p10_t3` | procurement | 1 | medium | Store / Procurement Manager, Store Head | Siddharth Kumar |
| 4 | Lessons learned documentation `p10_t4` | operations | 1 | medium | Siddharth Kumar, Ajay Sahni | Prateek, Shikhir, Sapna |

<details><summary>Checklists</summary>

- **Budget variance analysis**
  - Planned vs actual compiled
  - Overruns explained
  - **(required)** Final cost signed off
- **Delay & schedule analysis**
  - Phase-wise slippage computed
  - Root causes documented
- **Vendor performance review**
  - Vendors scored
  - Blacklist / preferred list updated
- **Lessons learned documentation**
  - Retrospective held
  - **(required)** Playbook updated for next outlet

</details>

---

## C. Franchise Outlet Launch

`MR-FRANCHISE-LAUNCH` · End-to-end playbook to open a new Mystery Rooms outlet — site sourcing through soft launch.

| | |
|---|---|
| **Category** | Franchise Launch |
| **Status** | published |
| **Phases** | 8 |
| **Tasks** | 38 |
| **Total task effort** | 109 working days (sum of every task's estimate) |
| **Total phase SLA** | 96 days (sum of each phase's target duration) |

### Phase summary

| # | Phase | Owner dept | SLA (days) | Tasks | Task effort (days) | Runs with |
|---:|---|---|---:|---:|---:|---|
| 1 | Site Sourcing `sourcing` | expansion | 10 | 4 | 10 | — |
| 2 | Site Inspection `inspection` | expansion | 7 | 5 | 7 | — |
| 3 | Negotiation & Deal `negotiation` | finance | 8 | 4 | 8 | — |
| 4 | Legal & Contract `legal` | legal | 10 | 4 | 10 | — |
| 5 | Design & Fit-out `fitout` | projects | 30 | 7 | 34 | — |
| 6 | Staffing & HR `staffing` | hr | 14 | 5 | 19 | — |
| 7 | Marketing & Pre-Launch `marketing` | marketing | 12 | 5 | 16 | — |
| 8 | Soft Launch & Handover `launch` | operations | 5 | 4 | 5 | — |

**Where the doers come from:** 0 task(s) have a per-task rule in `realRoster.js`, 38 fall back to their department's head, 0 keep the names written in the template file.

### Phase by phase — tasks, doers, duration

#### 1. Site Sourcing  `sourcing`

Engage brokers, gather site options and shortlist the strongest catchments.

*Owner department:* **expansion** · *Phase SLA:* **10 days** · *Tasks:* **4** · *Task effort:* **10 days**

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Engage local brokers `engage_brokers` | expansion | 2 | high | Manoj Parihar | Siddharth Kumar |
| 2 | Collect site options `collect_options` | expansion | 4 | — | Manoj Parihar | Siddharth Kumar |
| 3 | Shortlist top 3 sites `shortlist` | expansion | 2 | high | Manoj Parihar | Siddharth Kumar |
| 4 | Preliminary footfall study `prelim_footfall` | expansion | 2 | — | Manoj Parihar | Siddharth Kumar |

<details><summary>Checklists</summary>

- **Shortlist top 3 sites**
  - **(required)** Locality footfall reviewed
  - Rent range within budget

</details>

#### 2. Site Inspection  `inspection`

Physically inspect shortlisted sites against the launch scorecard.

*Owner department:* **expansion** · *Phase SLA:* **7 days** · *Tasks:* **5** · *Task effort:* **7 days**

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Physical site inspection `physical_inspection` | expansion | 2 | high | Manoj Parihar | Siddharth Kumar |
| 2 | Structural & Vaastu check `structural_check` | projects | 1 | — | Siddharth Kumar | Ajay Sahni |
| 3 | Footfall & catchment analysis `catchment` | expansion | 2 | — | Manoj Parihar | Siddharth Kumar |
| 4 | Utilities & power load check `utilities_check` | projects | 1 | — | Siddharth Kumar | Ajay Sahni |
| 5 | Complete inspection scorecard `scorecard` | expansion | 1 | high | Manoj Parihar | Siddharth Kumar |

<details><summary>Checklists</summary>

- **Complete inspection scorecard**
  - **(required)** Area meets minimum
  - **(required)** Power load sufficient
  - **(required)** Emergency exits present

</details>

#### 3. Negotiation & Deal  `negotiation`

Negotiate commercials and secure internal approval for the site.

*Owner department:* **finance** · *Phase SLA:* **8 days** · *Tasks:* **4** · *Task effort:* **8 days**

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Rent & terms negotiation `rate_negotiation` | expansion | 3 | high | Manoj Parihar | Siddharth Kumar |
| 2 | Finalize commercials `commercials` | finance | 2 | — | Prateek | Siddharth Kumar |
| 3 | Landlord background check `landlord_check` | legal | 2 | — | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 4 | Internal deal approval `deal_approval` | finance | 1 | critical | Prateek | Siddharth Kumar |

#### 4. Legal & Contract  `legal`

Draft, vet, and register the lease agreement.

*Owner department:* **legal** · *Phase SLA:* **10 days** · *Tasks:* **4** · *Task effort:* **10 days**

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Draft lease agreement `draft_agreement` | legal | 3 | — | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 2 | Legal due diligence `due_diligence` | legal | 3 | high | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 3 | Stamp duty & registration `stamp_registration` | legal | 3 | — | Siddharth Kumar | Prateek, Shikhir, Sapna |
| 4 | Signed agreement handover `signed_handover` | legal | 1 | high | Siddharth Kumar | Prateek, Shikhir, Sapna |

#### 5. Design & Fit-out  `fitout`

Design the theme, build the rooms, install games and props.

*Owner department:* **projects** · *Phase SLA:* **30 days** · *Tasks:* **7** · *Task effort:* **34 days**

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Concept & layout design `concept_design` | projects | 5 | high | Siddharth Kumar | Ajay Sahni |
| 2 | Fit-out vendor selection `vendor_selection` | projects | 3 | — | Siddharth Kumar | Ajay Sahni |
| 3 | Civil & interior work `civil_work` | projects | 10 | high | Siddharth Kumar | Ajay Sahni |
| 4 | Game room construction `game_construction` | projects | 7 | — | Siddharth Kumar | Ajay Sahni |
| 5 | Theme props & set installation `props_install` | projects | 4 | — | Siddharth Kumar | Ajay Sahni |
| 6 | Electrical, lighting & AV `electrical_av` | projects | 3 | — | Siddharth Kumar | Ajay Sahni |
| 7 | Snagging & handover `snagging` | projects | 2 | high | Siddharth Kumar | Ajay Sahni |

<details><summary>Checklists</summary>

- **Snagging & handover**
  - **(required)** All puzzles tested
  - **(required)** Safety audit passed

</details>

#### 6. Staffing & HR  `staffing`

Hire and certify the outlet team.

*Owner department:* **hr** · *Phase SLA:* **14 days** · *Tasks:* **5** · *Task effort:* **19 days**

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Hire Outlet Manager `hire_manager` | hr | 5 | high | Radhika | Ajay Sahni |
| 2 | Hire Game Masters `hire_gms` | hr | 5 | — | Radhika | Ajay Sahni |
| 3 | Hire front-desk staff `hire_frontdesk` | hr | 4 | — | Radhika | Ajay Sahni |
| 4 | Staff onboarding `onboarding` | hr | 2 | — | Radhika | Ajay Sahni |
| 5 | Game-master training & certification `gm_training` | operations | 3 | high | Ajay Sahni | Shishir |

#### 7. Marketing & Pre-Launch  `marketing`

Build local demand and fill the pre-launch booking calendar.

*Owner department:* **marketing** · *Phase SLA:* **12 days** · *Tasks:* **5** · *Task effort:* **16 days**

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Local SEO & Google Business listing `gmb_seo` | marketing | 3 | — | Marketing Head | Ajay Sahni |
| 2 | Paid ads plan & setup `paid_ads` | marketing | 3 | — | Marketing Head | Ajay Sahni |
| 3 | Influencer & PR tie-ups `influencers` | marketing | 4 | — | Marketing Head | Ajay Sahni |
| 4 | WhatsApp & CRM flows `crm_flows` | marketing | 2 | — | Marketing Head | Ajay Sahni |
| 5 | Pre-launch bookings drive `prelaunch_bookings` | marketing | 4 | high | Marketing Head | Ajay Sahni |

#### 8. Soft Launch & Handover  `launch`

Trial runs, fixes, and go-live handover to operations.

*Owner department:* **operations** · *Phase SLA:* **5 days** · *Tasks:* **4** · *Task effort:* **5 days**

| # | Task | Dept | Duration (days) | Priority | Doers | Buddies (cover) |
|---:|---|---|---:|---|---|---|
| 1 | Trial & dry runs `dry_runs` | operations | 2 | high | Ajay Sahni | Shishir |
| 2 | Fix game bugs & tune difficulty `fix_bugs` | operations | 1 | — | Ajay Sahni | Shishir |
| 3 | Soft-launch event `soft_launch` | marketing | 1 | high | Marketing Head | Ajay Sahni |
| 4 | Ops handover & go-live `ops_handover` | operations | 1 | critical | Ajay Sahni | Shishir |

<details><summary>Checklists</summary>

- **Ops handover & go-live**
  - **(required)** POS & booking system live
  - **(required)** Staff rota published
  - **(required)** Go-live sign-off

</details>

---

## D. Workload by person

Counted over **Branch Opening — Client Flow** only — the client-approved flow, and the one template that auto-assigns every task on project creation. So these numbers are what one branch opening actually puts on each person's desk.

| Person | Role | Tasks as doer | Planned days | Tasks as buddy |
|---|---|---:|---:|---:|
| Siddharth Kumar | Project Management Head · Project Manager | 9 | 27 | 19 |
| Prateek | Managing Director (MD) / Admin · Financial Expert · Feasibility Expert | 9 | 20 | 6 |
| Ajay Sahni | Operations Head | 8 | 25 | 11 |
| Ram Singh | Civil Head · Games Head | 7 | 31 | 3 |
| Chandan Kumar | IT Head | 7 | 31 | 4 |
| Radhika | HR Head | 6 | 28 | 1 |
| Store Head | Store Head | 5 | 97 | 2 |
| Shikhir | Managing Director (MD) / Admin | 4 | 10 | 5 |
| Sapna | Managing Director (MD) / Admin | 4 | 10 | 5 |
| Store / Procurement Manager | Store / Procurement Manager | 3 | 56 | 3 |
| Fardeen | Site Supervisor / Contractor | 2 | 90 | 2 |
| Marketing Head | Marketing Head | 2 | 6 | 0 |
| Manoj Parihar | Property / Franchise Consultant | 1 | 15 | 0 |
| Architect / Design Team | Architect / Design Team | 1 | 10 | 0 |
| Shishir | Operational Expert | 1 | 2 | 4 |
| Om Prakash | Technical Expert | 1 | 2 | 0 |
| Logistics Head | Logistics Head | 0 | 0 | 1 |
| Yogita Chauhan | Cluster / Branch Manager | 0 | 0 | 1 |
| Yash Shroff | Cluster / Branch Manager | 0 | 0 | 1 |
| Ashwini Rawale | Cluster / Branch Manager | 0 | 0 | 1 |
| Vishal Saluja | Cluster / Branch Manager | 0 | 0 | 1 |
| Dawood Yousuf | Cluster / Branch Manager | 0 | 0 | 1 |

## E. The roster

| ID | Name | Role(s) |
|---|---|---|
| MR-01 | Prateek | Managing Director (MD) / Admin · Financial Expert · Feasibility Expert |
| MR-02 | Shikhir | Managing Director (MD) / Admin |
| MR-03 | Sapna | Managing Director (MD) / Admin |
| MR-04 | Siddharth Kumar | Project Management Head · Project Manager |
| MR-05 | Manoj Parihar | Property / Franchise Consultant |
| MR-06 | Om Prakash | Technical Expert |
| MR-07 | Shishir | Operational Expert |
| MR-08 | Architect / Design Team | Architect / Design Team |
| MR-09 | Ram Singh | Civil Head · Games Head |
| MR-10 | Chandan Kumar | IT Head |
| MR-11 | Radhika | HR Head |
| MR-12 | Marketing Head | Marketing Head |
| MR-13 | Store Head | Store Head |
| MR-14 | Logistics Head | Logistics Head |
| MR-15 | Fardeen | Site Supervisor / Contractor |
| MR-16 | Store / Procurement Manager | Store / Procurement Manager |
| MR-17 | Ajay Sahni | Operations Head |
| MR-18 | Yogita Chauhan | Cluster / Branch Manager |
| MR-19 | Yash Shroff | Cluster / Branch Manager |
| MR-20 | Ashwini Rawale | Cluster / Branch Manager |
| MR-21 | Vishal Saluja | Cluster / Branch Manager |
| MR-22 | Dawood Yousuf | Cluster / Branch Manager |

---

_Generated from the template definitions in `server/src/seed/` on 2026-09-02._
