# Branch Opening — Client Flow

`MR-PMS-CLIENT-FLOW`  ·  **default template**  ·  version 2  ·  status published

Generated from the LIVE template record, not from the seed file — the seed is
only what this template started as, and it has been edited since.

## At a glance

| | |
|---|---|
| Phases | **15** |
| Blueprint tasks | **56** |
| Assessment modules | **51** |
| Form fields, all told | **664** |
| Planned duration | **189 days** (the sum of every phase's SLA) |

## Every phase, in order

| # | Key | Phase | Dept | SLA | Tasks | Modules | Fields | Capture |
|---|---|---|---|---|---|---|---|---|
| 1 | `p1` | Phase 1 — Property Research & Site Capture | expansion | 15d | 2 | 0 | 19 | collection |
| 2 | `p2` | Phase 2 — Site Evaluation (4 Assessments) | expansion | 5d | 5 | 4 | 55 | collection |
| 3 | `p3` | Phase 3 — Commercial Closure | legal | 7d | 5 | 6 | 41 | collection |
| 4 | `p20` | Phase 3B — Project Planning & Games | projects | 3d | 1 | 0 | 15 | single |
| 5 | `p11` | Phase 4 — Design & Drawings | projects | 10d | 1 | 0 | 5 | collection |
| 6 | `p12` | Phase 4B — Vendor Identification | procurement | 10d | 1 | 0 | 18 | collection |
| 7 | `p13` | Phase 5 — BOQ, Budget & Gantt | projects | 2d | 1 | 0 | 37 | collection |
| 8 | `p15` | Phase 6 — Purchase Orders & Delivery Tracking | procurement | 45d | 2 | 0 | 0 | single |
| 9 | `p6` | Phase 7 — Site Execution / Civil Works | projects | 45d | 3 | 11 | 151 | collection |
| 10 | `p16` | Phase 8 — Quality Check | operations | 5d | 4 | 0 | 10 | collection |
| 11 | `p18` | Phase 9 — Assembly & Installation | automation | 10d | 3 | 0 | 10 | collection |
| 12 | `p19` | Phase 10 — Testing & Trial Run | operations | 10d | 3 | 0 | 15 | collection |
| 13 | `p8` | Phase 11 — Readiness Checklist | operations | 10d | 9 | 14 | 129 | collection |
| 14 | `p9` | Phase 12 — Branch Opening / Handover | operations | 5d | 12 | 8 | 77 | collection |
| 15 | `p10` | Phase 13 — Closure & Delay Analysis | finance | 7d | 4 | 8 | 82 | collection |

The SLA column is what the project tree lays end to end from a project's
planned start, so phase 1 runs for its own SLA, phase 2 begins where phase 1
was due to end, and so on.

---

## 1. Phase 1 — Property Research & Site Capture

**Key** `p1` · **Order** 0 · **SLA** 15 days · **Department** expansion · **Capture mode** collection · **Record noun** Property

> The property consultant visits each option with the broker and records it on the spot from a phone. Ten properties can sit under one search, all comparable side by side.

**Exit criteria** — Properties recorded and one or more shortlisted (typically 10 listed → 4 shortlisted).

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Visit each property with broker | Property Consultant | 7–15 days | Physical visit, on-site mobile entry |
| Capture property details + media | Property Consultant | At the site | Mobile form with live GPS |
| Run AI location analysis | System (AI) / Consultant | Instant, on demand | AI engine |
| Review & shortlist properties | MD / PM Head | Within 2 days of listing | Comparison view |

### Blueprint tasks (2)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p1_capture` | Capture the properties on site | expansion | 15 | high | — | 4 |
| 2 | `p1_shortlist` | Review the captured properties & shortlist | expansion | 3 | high | — | 2 |

<details><summary>Checklist items</summary>

**Capture the properties on site**

- Brokers engaged
- At least 5 properties captured **(required)**
- Photos & video uploaded for each **(required)**
- Live GPS captured at each site

**Review the captured properties & shortlist**

- Every property has a decision **(required)**
- Rejection reasons recorded

</details>

### The phase's own form (19 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `property_name` | Property Name | text | **yes** | — | — |
| 2 | `locality` | Locality | text | **yes** | — | — |
| 3 | `carpet_area` | Area | number | **yes** | — | — |
| 4 | `frontage_ft` | Frontage | number | no | — | — |
| 5 | `floor` | Floor | select | no | Ground, First, Second, Basement, Other | — |
| 6 | `live_location` | Live Location | location | no | — | — |
| 7 | `commercial_type` | Commercial Type | select | **yes** | Rent, Lease | — |
| 8 | `monthly_rent` | Monthly Rent | currency | no | — | — |
| 9 | `deposit` | Deposit | currency | no | — | — |
| 10 | `available_from` | Available From | date | no | — | — |
| 11 | `lease_amount` | Lease Amount | currency | no | — | — |
| 12 | `lease_duration` | Lease Duration (months) | number | no | — | — |
| 13 | `owner_name` | Owner Name | text | no | — | — |
| 14 | `owner_phone` | Owner Phone | text | no | — | — |
| 15 | `broker_name` | Broker Name | text | no | — | — |
| 16 | `broker_phone` | Broker Phone | text | no | — | — |
| 17 | `documents` | Documents | file | no | accepts .jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar · multiple | — |
| 18 | `audio` | Audio | file | no | accepts .mp3,.wav,.m4a,.aac,.ogg,audio/* · multiple · audio capture | — |
| 19 | `notes` | — | textarea | no | — | — |

---

## 2. Phase 2 — Site Evaluation (4 Assessments)

**Key** `p2` · **Order** 1 · **SLA** 5 days · **Department** expansion · **Capture mode** collection · **Record noun** Assessment

> Each shortlisted property goes through four independent expert assessments — feasibility, financial, operational and technical — consolidated into one comparable report.

**Exit criteria** — One final property selected and approved with signature.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Feasibility Assessment | Feasibility Expert | 2 days | Form + AI prefill |
| Financial Assessment | Finance Expert | 2 days | Form (human-driven) |
| Operational Assessment | Operations Expert | 2 days | Form + AI prefill |
| Technical Assessment | Technical Expert | 2 days | Site visit + form |
| Consolidated report generation | System | Instant on completion | Auto-compiled PDF |
| Approve / Reject property | MD | Within 2 days | Digital approval with reason |

### Blueprint tasks (5)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p2_feasibility` | Do the Feasibility assessment | expansion | 2 | high | `feasibility` | 3 |
| 2 | `p2_financial` | Do the Financial assessment | finance | 2 | high | `financial` | 3 |
| 3 | `p2_operational` | Do the Operational assessment | operations | 2 | high | `operational` | 3 |
| 4 | `p2_technical` | Do the Technical assessment | projects | 2 | high | `technical` | 4 |
| 5 | `p2_decision` | Select the final property | expansion | 2 | critical | — | 3 |

<details><summary>Checklist items</summary>

**Do the Feasibility assessment**

- Catchment & audience reviewed
- Competition checked
- Recommendation with rating given **(required)**

**Do the Financial assessment**

- Rent vs projected revenue done
- Setup & monthly cost estimated
- Break-even and ROI calculated **(required)**

**Do the Operational assessment**

- Shift feasibility checked **(required)**
- Staffing requirement set
- Landlord operating hours confirmed

**Do the Technical assessment**

- Site visited **(required)**
- Power & water load checked
- Fire safety / NOC feasibility checked **(required)**
- Ceiling height recorded

**Select the final property**

- All four assessments reviewed
- One property approved **(required)**
- Digital signature recorded **(required)**

</details>

### Assessment modules (4)

| # | Key | Module | Fields | Sub-item field | Log only |
|---|---|---|---|---|---|
| 1 | `feasibility` | Feasibility | 12 | — | no |
| 2 | `financial` | Financial | 13 | — | no |
| 3 | `technical` | Technical | 15 | — | no |
| 4 | `operational` | Operational | 15 | — | no |

#### Feasibility — `feasibility` (12 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `purpose` | Purpose | textarea | no | — | — |
| 2 | `market_potential` | Market Potential | select | **yes** | Low, Medium, High | — |
| 3 | `competitor_analysis` | Competitor Analysis | textarea | no | — | — |
| 4 | `footfall_assessment` | Footfall Assessment (Score /10) | number | no | min 0 · max 10 | — |
| 5 | `accessibility` | Accessibility | select | no | Poor, Average, Good, Excellent | — |
| 6 | `target_audience` | Target Audience | text | no | — | — |
| 7 | `expansion_potential` | Expansion Potential | select | no | Low, Medium, High | — |
| 8 | `risk_factors` | Risk Factors | textarea | no | — | — |
| 9 | `remarks` | Remarks | textarea | no | — | — |
| 10 | `documents` | Documents | file | no | accepts .jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar · multiple | — |
| 11 | `audio` | Audio | file | no | accepts .mp3,.wav,.m4a,.aac,.ogg,audio/* · multiple · audio capture | — |
| 12 | `notes` | Doer's Notes | textarea | no | — | — |

#### Financial — `financial` (13 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `purpose` | Purpose | textarea | no | — | — |
| 2 | `estimated_investment` | Estimated Investment | currency | **yes** | — | — |
| 3 | `monthly_revenue` | Monthly Revenue | currency | no | — | — |
| 4 | `roi` | Return on Investment (%) | number | no | — | — |
| 5 | `payback_period` | Investment Recovery Time (months) | number | no | — | — |
| 6 | `capex` | Setup Cost | currency | no | — | — |
| 7 | `opex` | Monthly Operating Cost | currency | no | — | — |
| 8 | `profit_margin` | Profit Margin (%) | number | no | — | — |
| 9 | `financial_risk` | Financial Risk | select | no | Low, Medium, High | — |
| 10 | `financial_remarks` | Financial Remarks | textarea | no | — | — |
| 11 | `documents` | Documents | file | no | accepts .jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar · multiple | — |
| 12 | `audio` | Audio | file | no | accepts .mp3,.wav,.m4a,.aac,.ogg,audio/* · multiple · audio capture | — |
| 13 | `notes` | Doer's Notes | textarea | no | — | — |

#### Technical — `technical` (15 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `purpose` | Purpose | textarea | no | — | — |
| 2 | `building_condition` | Building Condition | select | **yes** | Poor, Average, Good, Excellent | — |
| 3 | `civil_condition` | Civil | select | no | Poor, Average, Good, Excellent | — |
| 4 | `electrical_capacity` | Electrical Capacity (kW) | number | no | — | — |
| 5 | `hvac` | HVAC | select | no | Not Available, Available, Centralized | — |
| 6 | `water_supply` | Water Supply | select | no | Not Available, Available, Abundant | — |
| 7 | `internet_availability` | Internet Availability | select | no | Not Available, Available | — |
| 8 | `fire_safety` | Fire Safety | select | no | Not Compliant, Compliant | — |
| 9 | `parking` | Parking | select | no | Not Available, Limited, Adequate, Ample | — |
| 10 | `maintenance` | Maintenance | textarea | no | — | — |
| 11 | `structural_assessment` | Structural Assessment | textarea | no | — | — |
| 12 | `technical_remarks` | Technical Remarks | textarea | no | — | — |
| 13 | `documents` | Documents | file | no | accepts .jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar · multiple | — |
| 14 | `audio` | Audio | file | no | accepts .mp3,.wav,.m4a,.aac,.ogg,audio/* · multiple · audio capture | — |
| 15 | `notes` | Doer's Notes | textarea | no | — | — |

#### Operational — `operational` (15 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `purpose` | Purpose | textarea | no | — | — |
| 2 | `staff_requirement` | Staff Requirement (Headcount) | number | **yes** | — | — |
| 3 | `operating_hours` | Operating Hours | select | no | 9 AM - 9 PM, 10 AM - 10 PM, 11 AM - 11 PM, 10 AM - 11 PM, 12 PM - 12 AM, 24 Hours | — |
| 4 | `operations_readiness` | Operations Readiness | select | no | Not Ready, Partially Ready, Ready | — |
| 5 | `security` | Security | select | no | Not Required, Required | — |
| 6 | `inventory` | Inventory | select | no | Poor, Adequate, Good | — |
| 7 | `training` | Training | select | no | Not Started, In Progress, Completed | — |
| 8 | `customer_flow` | Customer Flow | textarea | no | — | — |
| 9 | `utility_availability` | Utility Availability | select | no | Poor, Adequate, Good | — |
| 10 | `vendor_availability` | Vendor Availability | select | no | Poor, Adequate, Good | — |
| 11 | `operational_risks` | Operational Risks | textarea | no | — | — |
| 12 | `operational_remarks` | Operational Remarks | textarea | no | — | — |
| 13 | `documents` | Documents | file | no | accepts .jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar · multiple | — |
| 14 | `audio` | Audio | file | no | accepts .mp3,.wav,.m4a,.aac,.ogg,audio/* · multiple · audio capture | — |
| 15 | `notes` | Doer's Notes | textarea | no | — | — |

---

## 3. Phase 3 — Commercial Closure

**Key** `p3` · **Order** 2 · **SLA** 7 days · **Department** legal · **Capture mode** collection · **Record noun** Commercial Record

> Negotiation, LOI and lease for the selected property. LOI approval is the hard gate: every downstream stream unlocks from here, and the rent-free fit-out period starts running.

**Exit criteria** — LOI approved and lease executed; downstream parallel streams released.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Negotiate & submit counter-proposal | PM / MD | 3–7 days | Counter-proposal vs landlord quote |
| Issue and sign LOI | MD | On agreement | Document upload + OCR |
| Execute Lease / Rent Agreement | Legal / PM | As agreed | Document upload + OCR |
| Initiate statutory NOCs | PM / Compliance | Parallel, ongoing | Compliance tracker |
| Release downstream streams | System | On LOI approval | Auto-trigger |

### Blueprint tasks (5)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p3_t1` | Issue Letter of Intent (LOI) | legal | 2 | high | — | 3 |
| 2 | `p3_t2` | Draft & finalize lease agreement | legal | 3 | critical | — | 4 |
| 3 | `p3_t3` | Legal verification & title due diligence | legal | 2 | critical | — | 3 |
| 4 | `p3_t4` | Security deposit & token payment | finance | 1 | high | — | 3 |
| 5 | `p3_t5` | NOCs & statutory approvals | legal | 2 | high | — | 4 |

<details><summary>Checklist items</summary>

**Issue Letter of Intent (LOI)**

- Commercials agreed with landlord
- LOI drafted
- LOI countersigned **(required)**

**Draft & finalize lease agreement**

- Lock-in period agreed
- Escalation clause agreed
- Exit clause reviewed
- Agreement registered **(required)**

**Legal verification & title due diligence**

- Title chain verified **(required)**
- Encumbrance certificate obtained
- Landlord identity verified

**Security deposit & token payment**

- Deposit approved **(required)**
- Payment released
- Receipt filed

**NOCs & statutory approvals**

- Fire NOC applied **(required)**
- Trade licence applied **(required)**
- Society / mall NOC obtained
- Signage permission obtained

</details>

### Assessment modules (6)

| # | Key | Module | Fields | Sub-item field | Log only |
|---|---|---|---|---|---|
| 1 | `loi` | LOI | 11 | — | no |
| 2 | `lease` | Lease Agreement | 7 | — | no |
| 3 | `legal` | Legal Verification | 9 | — | no |
| 4 | `deposit` | Deposit Management | 7 | — | no |
| 5 | `nocs` | NOC Management | 4 | `noc_type` | no |
| 6 | `approvals` | Commercial Approvals | 3 | `approval_level` | no |

#### LOI — `loi` (11 fields)

_Letter of Intent_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `loi_number` | LOI Number | text | **yes** | — | — |
| 2 | `loi_date` | LOI Date | date | **yes** | — | — |
| 3 | `valid_until` | Valid Until | date | no | — | — |
| 4 | `proposed_rent` | Proposed Rent | currency | **yes** | — | — |
| 5 | `deposit_amount` | Deposit Amount | currency | no | — | — |
| 6 | `lockin_period_months` | Lock-in Period (months) | number | no | — | — |
| 7 | `notice_period_months` | Notice Period (months) | number | no | — | — |
| 8 | `revenue_share_pct` | Revenue Share (%) | number | no | — | — |
| 9 | `commercial_terms` | Commercial Terms | textarea | no | — | — |
| 10 | `documents` | Attach Documents | file | no | accepts .pdf,.doc,.docx,.jpg,.jpeg,.png · multiple | — |
| 11 | `remarks` | Remarks | textarea | no | — | — |

#### Lease Agreement — `lease` (7 fields)

_Lease Agreement_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `lease_start_date` | Lease Start Date | date | **yes** | — | — |
| 2 | `lease_end_date` | Lease End Date | date | **yes** | — | — |
| 3 | `renewal_option` | Renewal Option | select | no | Yes, No | — |
| 4 | `stamp_duty` | Stamp Duty | currency | no | — | — |
| 5 | `registration_details` | Registration Details | textarea | no | — | — |
| 6 | `lease_document` | Lease Copy Upload | file | **yes** | accepts .pdf,.doc,.docx,.jpg,.jpeg,.png · multiple | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |

#### Legal Verification — `legal` (9 fields)

_Property Legal Verification_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `property_ownership` | Property Ownership | text | no | — | — |
| 2 | `title_verification` | Title Verification | select | **yes** | Clear, Issues Found, Pending | — |
| 3 | `encumbrance_check` | Encumbrance Check | select | no | Clear, Encumbered, Pending | — |
| 4 | `litigation_status` | Litigation Status | select | no | None, Pending, Resolved | — |
| 5 | `legal_opinion` | Legal Opinion | textarea | no | — | — |
| 6 | `advocate_name` | Advocate Name | text | no | — | — |
| 7 | `verification_date` | Verification Date | date | no | — | — |
| 8 | `documents` | Documents | file | no | accepts .pdf,.doc,.docx,.jpg,.jpeg,.png · multiple | — |
| 9 | `remarks` | Remarks | textarea | no | — | — |

#### Deposit Management — `deposit` (7 fields)

_Deposit & Payment_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `security_deposit` | Security Deposit | currency | **yes** | — | — |
| 2 | `advance_rent` | Advance Rent | currency | no | — | — |
| 3 | `payment_mode` | Payment Mode | select | no | Cheque, NEFT/RTGS, UPI, Cash, Other | — |
| 4 | `transaction_number` | Transaction Number | text | no | — | — |
| 5 | `payment_date` | Payment Date | date | no | — | — |
| 6 | `payment_proof` | Payment Proof | file | **yes** | accepts .pdf,.jpg,.jpeg,.png · multiple | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |

#### NOC Management — `nocs` (4 fields)

_Government & Statutory NOCs_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `noc_type` | NOC Type | select | **yes** | Fire NOC, Municipal NOC, Pollution NOC, Electricity Approval, Water Approval, Trade License, Building Approval | — |
| 2 | `noc_document` | Document | file | **yes** | accepts .pdf,.jpg,.jpeg,.png · multiple | — |
| 3 | `expiry_date` | Expiry Date | date | no | — | — |
| 4 | `remarks` | Remarks | textarea | no | — | — |

#### Commercial Approvals — `approvals` (3 fields)

_Management Sign-off_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `approval_level` | Approval Level | select | **yes** | Legal, Finance, Operations, Management, CEO | — |
| 2 | `approval_document` | Approval Document | file | no | accepts .pdf,.doc,.docx,.jpg,.jpeg,.png · multiple | — |
| 3 | `remarks` | Remarks | textarea | no | — | — |

---

## 4. Phase 3B — Project Planning & Games

**Key** `p20` · **Order** 3 · **SLA** 3 days · **Department** projects · **Capture mode** single · **Record noun** Project Plan

> With the property signed, fix the plan for this specific site: which games it will hold, the real opening date, and the construction and testing milestones every other phase is scheduled against.

**Exit criteria** — Games selected, opening date fixed, and the outline budget agreed.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Confirm the site plan against the signed property | Project Manager | Day 1 | Planning form |
| Select the games for this outlet | MD / Operations Head | Within 2 days | Game list — pick multiple |
| Fix opening, construction & testing dates | Project Manager / MD | Within 2 days | Milestone dates on the form |
| Approve the plan | MD | Within 3 days | Digital approval |

### Blueprint tasks (1)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p20_games` | Fill the project plan — games, dates & budget | operations | 2 | critical | — | 3 |

<details><summary>Checklist items</summary>

**Fill the project plan — games, dates & budget**

- Games selected against the confirmed area **(required)**
- Construction, testing and opening dates set **(required)**
- Outline budget entered

</details>

### The phase's own form (15 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `confirmed_area` | Confirmed Area (sq.ft) | number | **yes** | — | From the signed property. Everything below is planned against this number. |
| 2 | `site_shape` | Shape / Layout Notes | textarea | no | AI assist | Anything about the shape that constrains the layout — columns, level changes, odd corners. |
| 3 | `selected_games` | Games for this outlet | multiselect | **yes** | — | Pick every game this outlet will run. The area each one needs is shown beside it. Guide: 4-5 games for 3,000-5,000 sq.ft, about 12 for 12,000 sq.ft. |
| 4 | `game_count` | Number of Games | number | no | counts selected_games | — |
| 5 | `game_notes` | Game Planning Notes | textarea | no | AI assist | Mandatory vs preferred games, and what was ruled out for this area. |
| 6 | `construction_start` | Construction Start | date | **yes** | — | — |
| 7 | `handover_date` | Site Handover Date | date | no | — | — |
| 8 | `testing_date` | Testing / Trial Run Date | date | no | — | — |
| 9 | `target_opening` | Target Opening Date | date | **yes** | — | The date the launch countdown runs to. |
| 10 | `setup_cost` | Estimated Setup Cost | currency | no | — | — |
| 11 | `monthly_operating_cost` | Estimated Monthly Operating Cost | currency | no | — | — |
| 12 | `project_manager` | Project Manager | user | no | — | — |
| 13 | `departments_involved` | Departments Involved | multiselect | no | Construction, Interior, Procurement, Automation, IT, Marketing, HR, Finance… | — |
| 14 | `cad_files` | Site CAD / Floor Plan | file | no | accepts .dwg,.dxf,.dwf,.dgn,.rvt,.rfa,.ifc,.skp,.3ds,.max,.obj,.fbx,.dae,.step,.stp,.iges,.igs,.stl,.ai,.psd,.indd,.eps,.cdr,.pdf,.jpg,.jpeg,.png,.webp,.zip,.rar · multiple | The as-signed site drawing the architect will design against. |
| 15 | `remarks` | Remarks | textarea | no | — | — |

---

## 5. Phase 4 — Design & Drawings

**Key** `p11` · **Order** 4 · **SLA** 10 days · **Department** projects · **Capture mode** collection · **Record noun** Drawing

> The architect prepares layouts for the actual site area and shape. Multiple drawing rounds are expected — every revision is kept, and only the latest approved one is live.

**Exit criteria** — Final drawing set approved and signed.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Prepare drawings (Phase 1 & Phase 2 sets) | Architect | Within 10 days | CAD / DWG upload |
| Review drawings | Project Manager / Operations | 2 days per round | Review screen with comments |
| Revise as per comments | Architect | As required | New revision upload |
| Approve final drawings | MD / Operations Head | On final round | Digital signature |

### Blueprint tasks (1)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p11_draw` | Create the drawings for this property | projects | 10 | high | — | 3 |

<details><summary>Checklist items</summary>

**Create the drawings for this property**

- Site measurements confirmed **(required)**
- Layout & game zoning drafted
- Full standard set uploaded **(required)**

</details>

### The phase's own form (5 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `drawing_name` | Drawing Name | text | **yes** | — | — |
| 2 | `drawing_type` | Drawing Type | select | **yes** | Layout Plan, Game Zoning, Electrical, Plumbing, HVAC, False Ceiling, Flooring, Furniture… | — |
| 3 | `revision_no` | Revision Number | number | **yes** | — | Start at 1. Increase it each time you upload a new round — earlier ones stay available. |
| 4 | `drawing_file` | Upload the Drawing | file | **yes** | accepts .dwg,.dxf,.dwf,.dgn,.rvt,.rfa,.ifc,.skp,.3ds,.max,.obj,.fbx,.dae,.step,.stp,.iges,.igs,.stl,.ai,.psd,.indd,.eps,.cdr,.pdf,.jpg,.jpeg,.png,.webp,.zip,.rar · multiple | CAD, BIM, 3D or design files up to 150 MB each — DWG, DXF, RVT, SKP, AI, PSD, PDF and more. Add as many as you need. |
| 5 | `remarks` | Notes for the reviewer | textarea | no | — | Anything the reviewer should know — assumptions made, what changed since the last revision, open questions. |

---

## 6. Phase 4B — Vendor Identification

**Key** `p12` · **Order** 5 · **SLA** 10 days · **Department** procurement · **Capture mode** collection · **Record noun** Vendor

> Runs alongside drawings. The category checklist is pre-loaded so no trade is forgotten, quotations are compared side by side, and one vendor is finalised per category.

**Exit criteria** — Vendors finalised per category.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Circulate vendor checklist by category | Project Manager | Day 1 | Pre-loaded checklist |
| Collect quotations | Project Manager / Procurement | Within 10 days | Quotation upload & comparison |
| Finalise vendors | Project Manager / MD | Within 10 days | Comparison + approval |

### Blueprint tasks (1)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p12_finalise` | Finalise the vendors for this project | procurement | 10 | high | — | 5 |

<details><summary>Checklist items</summary>

**Finalise the vendors for this project**

- All categories covered **(required)**
- At least 3 quotations per category
- Quotations uploaded
- One vendor finalised per category **(required)**
- High-value categories sent to MD

</details>

### The phase's own form (18 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `vendor_name` | Vendor Name | text | **yes** | — | — |
| 2 | `category` | Category | select | **yes** | Civil, Furniture, Electrical, Signage, Windows, Painting, HVAC, Fire… | — |
| 3 | `contact_person` | Contact Person | text | no | — | — |
| 4 | `contact_phone` | Contact Number | text | no | — | — |
| 5 | `email` | Email | text | no | — | — |
| 6 | `address` | Address | textarea | no | — | — |
| 7 | `gst` | GST Number | text | no | — | — |
| 8 | `pan` | PAN | text | no | — | — |
| 9 | `bank_details` | Bank Details | textarea | no | — | — |
| 10 | `quoted_amount` | Quoted Amount | currency | no | — | — |
| 11 | `negotiated_amount` | Negotiated Amount | currency | no | — | — |
| 12 | `payment_terms` | Payment Terms | text | no | — | — |
| 13 | `credit_period_days` | Credit Period (days) | number | no | — | — |
| 14 | `past_performance` | Past Performance Notes | textarea | no | — | Delivery delays, quality issues and rework on previous projects. |
| 15 | `rating` | Rating (out of 10) | number | no | — | — |
| 16 | `status` | Status | select | **yes** | Identified, Quotation Received, Under Comparison, Finalised, Rejected, Blacklisted | — |
| 17 | `documents` | Documents & Quotation | file | no | accepts .jpg,.jpeg,.png,.heic,.webp,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.doc,.docx · multiple | — |
| 18 | `remarks` | Remarks | textarea | no | — | — |

---

## 7. Phase 5 — BOQ, Budget & Gantt

**Key** `p13` · **Order** 6 · **SLA** 2 days · **Department** projects · **Capture mode** collection · **Record noun** BOQ Item

> Approved drawings plus finalised vendor rates converge into the plan the MD monitors for the rest of the project. The Gantt is the primary tracking view; the approved plan is frozen as the baseline so all later slippage is measurable.

**Exit criteria** — BOQ, budget and Gantt approved. Baseline frozen.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Generate BOQ from approved drawings | Project Manager | Within 2 days | BOQ builder (item, qty, unit, rate) |
| Derive budget from BOQ | System | Instant | Rate presets × quantities |
| Build Gantt chart | Project Manager / System | Within 2 days | Auto-generated from template + lead times |
| Approve budget & timeline | MD | 2 days | Digital approval |

### Blueprint tasks (1)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p13_t1` | Build the BOQ — one line per thing to buy | projects | 3 | critical | — | 3 |

<details><summary>Checklist items</summary>

**Build the BOQ — one line per thing to buy**

- Every drawing costed **(required)**
- Quantities cross-checked against drawing areas
- Vendor set on each line **(required)**

</details>

### The phase's own form (37 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item` | Item | text | **yes** | — | — |
| 2 | `description` | Description | textarea | no | AI assist | What exactly is being ordered — specification, size, finish. AI can draft it from the item name. |
| 3 | `category` | Category | select | **yes** | Civil, Furniture, Electrical, Signage, Painting, HVAC, Fire, IT & Networking… | — |
| 4 | `unit` | Unit | select | no | sq ft, running ft, nos, set, lot, kg, litre, day | — |
| 5 | `quantity` | Quantity | number | **yes** | — | — |
| 6 | `rate` | Rate | currency | **yes** | — | Defaults from the rate master where one exists; override if the negotiated rate differs. |
| 7 | `amount` | Amount | currency | no | product of ['quantity', 'rate'] | Quantity × Rate — filled in for you, override it if the agreed amount differs. |
| 8 | `vendor` | Vendor | select | no | options from {'stageKey': 'p12', 'field': 'vendor_name', 'scope': 'global'} | From the vendor master (Phase 4B / the Vendors page). Add a vendor there and it appears here. |
| 9 | `planned_start` | Planned Start | date | no | — | — |
| 10 | `planned_end` | Planned End | date | no | — | — |
| 11 | `depends_on` | Depends On | text | no | — | Comma-separated items that must finish first — drives the critical path. |
| 12 | `is_milestone` | Is a Milestone | boolean | no | — | Milestones: property finalised, LOI signed, drawings approved, procurement complete, civil complete, installation complete, trial run complete, launch. |
| 13 | `remarks` | Remarks | textarea | no | — | — |
| 14 | `po_number` | PO Number | text | no | — | Filled in automatically the first time the order is sent (PO-001, PO-002…). Change it if your PO book uses different numbers. |
| 15 | `indent_number` | Indent Number | text | no | — | — |
| 16 | `order_status` | Order Status | select | no | Ordered, Dispatched, Delivered, Partly Received, Received (GRN), Short / Damaged, Cancelled | Ordered is the default once the PO is sent. Change it as the vendor reports. |
| 17 | `promised_delivery` | Vendor promised delivery | date | no | — | — |
| 18 | `sent_whatsapp_at` | WhatsApp sent at | text | no | — | — |
| 19 | `sent_whatsapp_to` | WhatsApp sent to | text | no | — | — |
| 20 | `sent_email_at` | Email sent at | text | no | — | — |
| 21 | `sent_email_to` | Email sent to | text | no | — | — |
| 22 | `dispatch_date` | Dispatched on | date | no | — | — |
| 23 | `transporter` | Transporter | text | no | — | — |
| 24 | `lr_docket` | LR / Docket No. | text | no | — | — |
| 25 | `delivery_challan_no` | Delivery Challan No. | text | no | — | — |
| 26 | `received_date` | Received on | date | no | — | — |
| 27 | `received_quantity` | Quantity received | number | no | — | — |
| 28 | `pending_quantity` | Quantity still pending | number | no | — | Ordered minus received — worked out for you on the tracker. |
| 29 | `grn_number` | GRN Number | text | no | — | — |
| 30 | `shortage_note` | Short / damaged — details | textarea | no | — | — |
| 31 | `tracking_remarks` | Tracking remarks | textarea | no | — | — |
| 32 | `received_by` | Received by | text | no | — | — |
| 33 | `receipt_photos` | Receipt photos / documents | file | no | multiple | — |
| 34 | `invoice_number` | Invoice Number | text | no | — | — |
| 35 | `invoice_date` | Invoice Date | date | no | — | — |
| 36 | `sent_invoice_at` | Invoice sent at | text | no | — | — |
| 37 | `sent_invoice_to` | Invoice sent to | text | no | — | — |

---

## 8. Phase 6 — Purchase Orders & Delivery Tracking

**Key** `p15` · **Order** 7 · **SLA** 45 days · **Department** procurement · **Capture mode** single · **Record noun** Order

> Every BOQ line from Phase 5 is a purchase order. Send each one to its vendor, then track it on one sheet — ordered, dispatched, delivered, received — with the PO, indent, challan and GRN numbers, what arrived against what was ordered, and who updated what, when. Runs alongside civil works on site.

**Exit criteria** — Every purchase order sent and dispatched by its vendor; deliveries and GRNs tracked to closure on the same sheet.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Send every purchase order (WhatsApp / email) | Procurement | Within 3 days of BOQ approval | Order page on each BOQ line — the send time is recorded for you |
| Track each order to dispatch | Procurement | Daily until dispatched | Tracker: status, vendor promised date, challan / LR number |
| Receive at site and raise the GRN | Store Manager / Site Supervisor | On arrival | Tracker: received quantity, GRN number, short / damaged note |
| Chase delays | Procurement | Whenever a date slips | Late orders show in red; AI drafts the follow-up |

### Blueprint tasks (2)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p15_t1` | Send every PO and keep the tracker honest | procurement | 45 | critical | — | 4 |
| 2 | `p15_t3` | Receive goods at site and record the GRN | operations | 45 | high | — | 3 |

<details><summary>Checklist items</summary>

**Send every PO and keep the tracker honest**

- Every BOQ line sent as a PO **(required)**
- PO and indent numbers filled in
- Statuses kept current as vendors report **(required)**
- Late orders chased

**Receive goods at site and record the GRN**

- Received quantity entered for every delivery
- GRN number recorded **(required)**
- Short / damaged items noted

</details>

---

## 9. Phase 7 — Site Execution / Civil Works

**Key** `p6` · **Order** 8 · **SLA** 45 days · **Department** projects · **Capture mode** collection · **Record noun** Execution Task

> Physical construction on site, reported daily by the site supervisor from a mobile-friendly form designed to take under two minutes.

**Exit criteria** — Civil and fit-out works complete as per approved drawings and BOQ.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Daily site progress report | Site Supervisor | Every working day | Mobile daily form |
| Hiring for the centre | HR | Parallel with the build | HRMS — requisitions, AI JDs, pipeline |
| Technical rough-in | IT | Parallel with the build | Cabling, power, connectivity |
| Track against Gantt | System | Continuous | Auto plan-vs-actual |

### Blueprint tasks (3)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p6_daily_report` | Report from site every working day | construction | 45 | high | `daily_site_report` | 4 |
| 2 | `p6_hiring` | Start hiring for this centre | hr | 12 | high | — | 4 |
| 3 | `p6_tech` | Get the site technically ready | it | 12 | high | — | 4 |

<details><summary>Checklist items</summary>

**Report from site every working day**

- A report filed for every working day **(required)**
- Photographs attached to every report
- Every blocker raised the same day it appeared
- Civil and fit-out works complete as per approved drawings and BOQ **(required)**

**Start hiring for this centre**

- Requisition created for every role **(required)**
- JDs approved and applications open **(required)**
- Apply link shared (WhatsApp / portals)
- First interviews scheduled

**Get the site technically ready**

- Internet connection ordered
- Network & CCTV cabling routed **(required)**
- Power points as per game layout **(required)**
- Control room space ready

</details>

### Assessment modules (11)

| # | Key | Module | Fields | Sub-item field | Log only |
|---|---|---|---|---|---|
| 1 | `construction` | Construction Execution | 13 | — | no |
| 2 | `interior` | Interior Execution | 13 | — | no |
| 3 | `procurement` | Procurement Tracking | 13 | — | no |
| 4 | `automation` | Automation Installation | 13 | — | no |
| 5 | `it` | IT Infrastructure | 13 | — | no |
| 6 | `marketing` | Marketing Execution | 13 | — | no |
| 7 | `hr` | HR Readiness | 13 | — | no |
| 8 | `finance` | Finance Tracking | 13 | — | no |
| 9 | `operations` | Operations Readiness | 13 | — | no |
| 10 | `legal` | Legal Compliance | 13 | — | no |
| 11 | `daily_site_report` | Daily Site Report | 21 | — | no |

#### Construction Execution — `construction` (13 fields)

_Track civil construction work_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### Interior Execution — `interior` (13 fields)

_Track interior and furnishing work_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### Procurement Tracking — `procurement` (13 fields)

_Track material procurement_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### Automation Installation — `automation` (13 fields)

_Track automation installation_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### IT Infrastructure — `it` (13 fields)

_Track IT infrastructure setup_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### Marketing Execution — `marketing` (13 fields)

_Track marketing campaigns_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### HR Readiness — `hr` (13 fields)

_Track hiring and training_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### Finance Tracking — `finance` (13 fields)

_Track budget and expense flow_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### Operations Readiness — `operations` (13 fields)

_Track store readiness and SOP_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### Legal Compliance — `legal` (13 fields)

_Track licenses and compliance_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `task_name` | Task Name | text | **yes** | — | — |
| 2 | `priority` | Priority | select | **yes** | Low, Medium, High, Critical | — |
| 3 | `status` | Status | select | **yes** | Not Started, In Progress, Completed, Delayed, Blocked, On Hold, Cancelled | — |
| 4 | `progress_pct` | Progress % | number | **yes** | — | — |
| 5 | `risk_level` | Risk Level | select | no | Low, Medium, High | — |
| 6 | `assigned_to` | Assigned To | text | **yes** | — | — |
| 7 | `start_date` | Start Date | date | no | — | — |
| 8 | `due_date` | Due Date | date | **yes** | — | — |
| 9 | `completed_date` | Completed Date | date | no | — | — |
| 10 | `dependencies` | Dependencies (task names) | text | no | — | Comma-separated names of tasks this depends on |
| 11 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx · multiple | Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads |
| 13 | `remarks` | Remarks | textarea | no | — | — |

#### Daily Site Report — `daily_site_report` (21 fields)

_Filed by the site supervisor every working day_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `report_date` | Report for (date) | date | **yes** | — | Today, normally. Filing for an earlier day is allowed — it is marked as a late entry. |
| 2 | `shift` | Shift | select | no | Day, Evening, Night | — |
| 3 | `overall_progress_pct` | Overall site progress (%) | number | **yes** | min 0 · max 100 | Your honest estimate of how much of the whole civil + fit-out job is done, 0–100. |
| 4 | `work_done` | Work completed today | textarea | **yes** | AI assist | Activity-wise — e.g. "Partition framing in rooms 2–3 done, flooring screed in lobby 60%". |
| 5 | `planned_workers` | Workers planned today | number | no | min 0 | — |
| 6 | `masons` | Masons | number | no | min 0 | — |
| 7 | `carpenters` | Carpenters | number | no | min 0 | — |
| 8 | `electricians` | Electricians | number | no | min 0 | — |
| 9 | `painters` | Painters | number | no | min 0 | — |
| 10 | `helpers` | Helpers | number | no | min 0 | — |
| 11 | `materials_received` | Materials received today | textarea | no | — | — |
| 12 | `materials_consumed` | Materials consumed today | textarea | no | — | — |
| 13 | `material_shortage` | Any material shortage? | boolean | no | — | — |
| 14 | `shortage_details` | What is short, and what it is holding up | textarea | no | — | — |
| 15 | `quality_issues` | Quality observations / rework needed | textarea | no | — | Leave blank if nothing to report. |
| 16 | `blocked` | Is anything blocking work? | boolean | no | — | — |
| 17 | `blocker_details` | What is blocking, and since when | textarea | **yes** | — | — |
| 18 | `blocker_owner` | Who needs to act on it | text | no | — | A name or a department — the person whose decision or delivery unblocks the site. |
| 19 | `site_photos` | Today's site photographs | file | **yes** | accepts image/*,video/* · multiple | Mandatory every day. A few wide shots of the work areas plus anything you flagged above. |
| 20 | `backdate_reason` | Reason, if filing for an earlier day | textarea | no | — | Only needed when the report date is not today. |
| 21 | `remarks` | Remarks | textarea | no | — | — |

---

## 10. Phase 8 — Quality Check

**Key** `p16` · **Order** 9 · **SLA** 5 days · **Department** operations · **Capture mode** collection · **Record noun** QC Item

> An independent quality gate before material transfer and installation begin. Any Fail raises a rectification task automatically — the gate cannot pass while a mandatory Fail is open.

**Exit criteria** — QC passed with all mandatory items cleared.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Physical site inspection | Operations Head | Within 5 days | On-site inspection |
| Complete QC checklist | Operations Head | Within 5 days | Digital checklist |
| Report issues | Operations Head | Immediately | Issue log with photos |
| Rectify & re-check | Contractor → Operations Head | As required | Re-inspection loop |

### Blueprint tasks (4)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p16_inspect` | Inspect the site & file QC items | operations | 3 | critical | — | 3 |
| 2 | `p16_rectify` | Fix what failed & re-check | construction | 5 | critical | — | 3 |
| 3 | `p16_hiring_check` | Check hiring is on track | hr | 2 | high | — | 2 |
| 4 | `p16_tech_check` | Verify the technical setup | it | 2 | high | — | 3 |

<details><summary>Checklist items</summary>

**Inspect the site & file QC items**

- Every area inspected and filed as a QC item **(required)**
- Photos attached to every item
- Owner and fix-by date on every Fail **(required)**

**Fix what failed & re-check**

- All Critical and Major fails rectified **(required)**
- Closure evidence attached
- Re-check recorded on every fix

**Check hiring is on track**

- Hired count reviewed against headcount **(required)**
- Every open role has interviews scheduled

**Verify the technical setup**

- Internet tested at site **(required)**
- Power points verified against layout
- Cable routes verified

</details>

### The phase's own form (10 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `qc_area` | Area | select | **yes** | Civil, Tiles / Flooring, False Ceiling, HVAC, Fire Line, Electrical, Plumbing, Paint… | — |
| 2 | `check_item` | Check Item | text | **yes** | — | — |
| 3 | `result` | Result | select | **yes** | Pass, Fail, Not Applicable | — |
| 4 | `severity` | Severity | select | no | Critical, Major, Minor | Only meaningful on a Fail — drives how hard the gate blocks. |
| 5 | `observation` | Observation | textarea | no | — | — |
| 6 | `evidence` | Photographic Evidence | file | no | accepts .jpg,.jpeg,.png,.heic,.webp,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.doc,.docx · multiple | — |
| 7 | `responsible_party` | Who must fix it | text | no | — | — |
| 8 | `rectification_due` | Fix it by | date | no | — | — |
| 9 | `rectification_status` | Rectification Status | select | no | Open, In Progress, Rectified, Re-checked & Closed | — |
| 10 | `closure_evidence` | Closure Evidence | file | no | accepts .jpg,.jpeg,.png,.heic,.webp,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.doc,.docx · multiple | — |

---

## 11. Phase 9 — Assembly & Installation

**Key** `p18` · **Order** 10 · **SLA** 10 days · **Department** automation · **Capture mode** collection · **Record noun** Installation

> Game specialist and technical teams install games, props, AV, IT and networking to the approved layout, following the setup standard for each game.

**Exit criteria** — All games and systems installed and verified.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Deploy resources as per plan | Game Specialist Team | Within 10 days | Resource plan |
| Install games, props, AV, IT | Game Specialist / IT Team | Within 10 days | Installation checklist |
| Verify work completion | Project Manager | On completion | Checklist verification |

### Blueprint tasks (3)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p18_games` | Install games, props & AV | automation | 10 | critical | — | 3 |
| 2 | `p18_it` | Install IT, network & systems | it | 5 | critical | — | 4 |
| 3 | `p18_verify` | Verify every installation | projects | 2 | high | — | 2 |

<details><summary>Checklist items</summary>

**Install games, props & AV**

- All games installed **(required)**
- Props placed to layout
- AV commissioned

**Install IT, network & systems**

- Internet live **(required)**
- Network & CCTV commissioned
- POS / booking terminal live **(required)**
- Inventory system integrated

**Verify every installation**

- Every installation record verified **(required)**
- Photographs attached to each

</details>

### The phase's own form (10 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `game_or_zone` | Games / zones being installed | multiselect | **yes** | — | Chosen in Phase 3B. Tick every game or zone this entry covers. |
| 2 | `install_type` | Type | select | **yes** | Game, Prop, AV, IT & Network, CCTV, POS / Booking Terminal, Lighting, Control Room | — |
| 3 | `technician` | Technician | text | no | — | — |
| 4 | `install_start` | Installation Start | date | no | — | — |
| 5 | `install_complete` | Installation Complete | date | no | — | — |
| 6 | `status` | Status | select | **yes** | Not Started, In Progress, Installed, Calibrated, Verified | — |
| 7 | `calibration_notes` | Calibration & Setup Notes | textarea | no | — | — |
| 8 | `photographs` | Installation Photographs | file | no | accepts .jpg,.jpeg,.png,.heic,.webp,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.doc,.docx · multiple | — |
| 9 | `verified_by` | Verified By | text | no | — | — |
| 10 | `remarks` | Remarks | textarea | no | — | — |

---

## 12. Phase 10 — Testing & Trial Run

**Key** `p19` · **Order** 11 · **SLA** 10 days · **Department** operations · **Capture mode** collection · **Record noun** Test Run

> The branch is physically played and tested end to end. Errors are logged, rectified and re-tested in a loop until All-OK — only then does the readiness gate open.

**Exit criteria** — All-OK confirmed; trial run report submitted.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Physical playing & testing | Cluster / Branch Manager | Within 7–10 days | Trial run form |
| Error identification | Cluster Manager / Team | During testing | Issue log |
| Rectify errors | Concerned vendor / department | As per severity | Auto-assigned task |
| Re-test | Cluster Manager | Until All OK | Re-test loop |
| Report submission | Cluster Manager | On completion | Consolidated report |

### Blueprint tasks (3)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p19_test` | Play & test every game — log every error | operations | 7 | critical | — | 3 |
| 2 | `p19_fix` | Fix the errors & re-test until All-OK | automation | 5 | critical | — | 3 |
| 3 | `p19_staff` | Staff readiness & mock run | hr | 5 | high | — | 4 |

<details><summary>Checklist items</summary>

**Play & test every game — log every error**

- Every game played end to end **(required)**
- Safety checked per game
- Every error logged with severity and owner **(required)**

**Fix the errors & re-test until All-OK**

- All Critical and Major errors closed **(required)**
- Re-test passed on every rectified game
- All-OK confirmed **(required)**

**Staff readiness & mock run**

- Training completed **(required)**
- Game briefing done
- SOP acknowledged
- Mock customer run completed **(required)**

</details>

### The phase's own form (15 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `game` | Game | text | **yes** | — | — |
| 2 | `test_date` | Test Date | date | **yes** | — | — |
| 3 | `testers` | Testers | text | no | — | — |
| 4 | `duration_mins` | Duration (minutes) | number | no | — | — |
| 5 | `result` | Result | select | **yes** | Pass, Fail | — |
| 6 | `observations` | Observations | textarea | no | AI assist | — |
| 7 | `customer_experience` | Customer Experience Notes | textarea | no | AI assist | — |
| 8 | `safety_observations` | Safety Observations | textarea | no | — | — |
| 9 | `error_description` | Error Description | textarea | no | AI assist | — |
| 10 | `error_severity` | Severity | select | no | Critical, Major, Minor | — |
| 11 | `error_owner` | Owner | text | no | — | — |
| 12 | `error_target_date` | Target Date | date | no | — | — |
| 13 | `retest_result` | Re-test Result | select | no | Pending, Passed, Failed Again | — |
| 14 | `evidence` | Evidence | file | no | accepts .jpg,.jpeg,.png,.heic,.webp,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.doc,.docx · multiple | — |
| 15 | `remarks` | Remarks | textarea | no | — | — |

---

## 13. Phase 11 — Readiness Checklist

**Key** `p8` · **Order** 12 · **SLA** 10 days · **Department** operations · **Capture mode** collection · **Record noun** Checklist Submission

> The final consolidated gate. Every department independently confirms its own readiness; mandatory items block launch, optional items are tracked but do not.

**Exit criteria** — All mandatory departmental checklists approved.

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Complete departmental checklist | Each Department Head | Rolling, before launch | Departmental checklist screen |
| Department approval | Department Head | On completion | Digital sign-off |
| Consolidated readiness review | Operations Head / MD | Before launch | Readiness dashboard |

### Blueprint tasks (9)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p8_g1` | Readiness: Construction | construction | 3 | medium | — | 10 |
| 2 | `p8_g2` | Readiness: Utilities | construction | 3 | critical | — | 9 |
| 3 | `p8_g3` | Readiness: It Systems | it | 3 | high | — | 12 |
| 4 | `p8_g4` | Readiness: Hiring | hr | 3 | high | — | 6 |
| 5 | `p8_g5` | Readiness: Training | hr | 3 | high | — | 6 |
| 6 | `p8_g6` | Readiness: Marketing | marketing | 3 | medium | — | 10 |
| 7 | `p8_g7` | Readiness: Testing | operations | 3 | critical | — | 8 |
| 8 | `p8_g8` | Readiness: Inventory | procurement | 3 | high | — | 10 |
| 9 | `p8_g9` | Readiness: Compliance | legal | 3 | critical | — | 10 |

<details><summary>Checklist items</summary>

**Readiness: Construction**

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

**Readiness: Utilities**

- Permanent power connection live
- DG / UPS backup tested
- Electrical panel & wiring certified
- Earthing & safety checks passed
- Lighting fixtures installed
- Water & drainage live
- Water heater installed
- HVAC commissioned
- Utility billing account activated

**Readiness: It Systems**

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

**Readiness: Hiring**

- Outlet manager onboarded
- Game masters onboarded
- Front desk staff onboarded
- Housekeeping staff onboarded
- Background verification completed
- Employment documentation completed

**Readiness: Training**

- Game master certification passed
- Safety drill completed
- POS training completed
- Customer service training completed
- Emergency response training completed
- Product / experience knowledge test passed

**Readiness: Marketing**

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

**Readiness: Testing**

- Full dry run completed
- Puzzle / game difficulty tuned
- Reset time measured & optimized
- End-to-end customer journey tested
- Emergency override & safety systems tested
- Staff shift simulation completed
- Booking-to-checkout flow tested
- Feedback from soft-launch reviewed

**Readiness: Inventory**

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

**Readiness: Compliance**

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

### Assessment modules (14)

| # | Key | Module | Fields | Sub-item field | Log only |
|---|---|---|---|---|---|
| 1 | `construction_readiness` | Construction Readiness | 14 | — | no |
| 2 | `electrical_utilities` | Electrical & Utilities | 12 | — | no |
| 3 | `it_infrastructure` | IT Infrastructure | 10 | — | no |
| 4 | `internet_network` | Internet & Network | 8 | — | no |
| 5 | `security_cctv` | Security & CCTV | 9 | — | no |
| 6 | `furniture_fixtures` | Furniture & Fixtures | 10 | — | no |
| 7 | `inventory_stock` | Inventory Stock | 11 | — | no |
| 8 | `pos_billing` | POS & Billing | 7 | — | no |
| 9 | `hiring_complete` | Hiring Complete | 8 | — | no |
| 10 | `staff_training` | Staff Training | 8 | — | no |
| 11 | `marketing_ready` | Marketing Ready | 8 | — | no |
| 12 | `branding_signage` | Branding & Signage | 6 | — | no |
| 13 | `fire_safety` | Fire & Safety | 8 | — | no |
| 14 | `licenses_compliance` | Licenses & Compliance | 10 | — | no |

#### Construction Readiness — `construction_readiness` (14 fields)

_Civil work, finishing & handover_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Civil work complete | boolean | no | — | — |
| 2 | `item_2` | Flooring complete | boolean | no | — | — |
| 3 | `item_3` | Ceiling work complete | boolean | no | — | — |
| 4 | `item_4` | Wall finishes complete | boolean | no | — | — |
| 5 | `item_5` | Washrooms complete | boolean | no | — | — |
| 6 | `item_6` | Fire exits constructed | boolean | no | — | — |
| 7 | `item_7` | Structural safety certified | boolean | no | — | — |
| 8 | `item_8` | Paint & finishing complete | boolean | no | — | — |
| 9 | `item_9` | Signage mounting points ready | boolean | no | — | — |
| 10 | `item_10` | Snag list closed | boolean | no | — | — |
| 11 | `item_11` | Handover certificate issued | boolean | no | — | — |
| 12 | `item_12` | Site cleared of construction debris | boolean | no | — | — |
| 13 | `remarks` | Remarks | textarea | no | — | — |
| 14 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Electrical & Utilities — `electrical_utilities` (12 fields)

_Power, water & HVAC live_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Permanent power connection live | boolean | no | — | — |
| 2 | `item_2` | DG / UPS backup tested | boolean | no | — | — |
| 3 | `item_3` | Electrical panel & wiring certified | boolean | no | — | — |
| 4 | `item_4` | Earthing & safety checks passed | boolean | no | — | — |
| 5 | `item_5` | Lighting fixtures installed | boolean | no | — | — |
| 6 | `item_6` | Water & drainage live | boolean | no | — | — |
| 7 | `item_7` | Water heater installed | boolean | no | — | — |
| 8 | `item_8` | HVAC commissioned | boolean | no | — | — |
| 9 | `item_9` | Exhaust & ventilation tested | boolean | no | — | — |
| 10 | `item_10` | Utility billing account activated | boolean | no | — | — |
| 11 | `remarks` | Remarks | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### IT Infrastructure — `it_infrastructure` (10 fields)

_Systems, software & support ready_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Broadband live with backup link | boolean | no | — | — |
| 2 | `item_2` | LAN & Wi-Fi access points installed | boolean | no | — | — |
| 3 | `item_3` | Local systems & servers configured | boolean | no | — | — |
| 4 | `item_4` | Software licenses activated | boolean | no | — | — |
| 5 | `item_5` | Printer & peripherals installed | boolean | no | — | — |
| 6 | `item_6` | IT asset inventory logged | boolean | no | — | — |
| 7 | `item_7` | Helpdesk / support contact set up | boolean | no | — | — |
| 8 | `item_8` | Backup & data recovery tested | boolean | no | — | — |
| 9 | `remarks` | Remarks | textarea | no | — | — |
| 10 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Internet & Network — `internet_network` (8 fields)

_Connectivity & Wi-Fi ready_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Primary ISP connection live | boolean | no | — | — |
| 2 | `item_2` | Backup ISP link tested | boolean | no | — | — |
| 3 | `item_3` | Network switches configured | boolean | no | — | — |
| 4 | `item_4` | Static IP / firewall configured | boolean | no | — | — |
| 5 | `item_5` | Wi-Fi coverage tested across floor | boolean | no | — | — |
| 6 | `item_6` | Network uptime monitoring enabled | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Security & CCTV — `security_cctv` (9 fields)

_CCTV, access control & alarms ready_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | CCTV cameras installed | boolean | no | — | — |
| 2 | `item_2` | CCTV live & recording tested | boolean | no | — | — |
| 3 | `item_3` | Access control system installed | boolean | no | — | — |
| 4 | `item_4` | Alarm system tested | boolean | no | — | — |
| 5 | `item_5` | Security guard posted | boolean | no | — | — |
| 6 | `item_6` | Visitor log process set up | boolean | no | — | — |
| 7 | `item_7` | Emergency lockdown procedure tested | boolean | no | — | — |
| 8 | `remarks` | Remarks | textarea | no | — | — |
| 9 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Furniture & Fixtures — `furniture_fixtures` (10 fields)

_Furniture installation complete_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Reception furniture installed | boolean | no | — | — |
| 2 | `item_2` | Seating & waiting area set up | boolean | no | — | — |
| 3 | `item_3` | Storage & cabinets installed | boolean | no | — | — |
| 4 | `item_4` | Game room furniture installed | boolean | no | — | — |
| 5 | `item_5` | Lighting fixtures fitted | boolean | no | — | — |
| 6 | `item_6` | Curtains / blinds installed | boolean | no | — | — |
| 7 | `item_7` | Signage & branding fixtures mounted | boolean | no | — | — |
| 8 | `item_8` | Furniture safety check passed | boolean | no | — | — |
| 9 | `remarks` | Remarks | textarea | no | — | — |
| 10 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Inventory Stock — `inventory_stock` (11 fields)

_Stock received & verified_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Opening stock received | boolean | no | — | — |
| 2 | `item_2` | Consumables buffer in place | boolean | no | — | — |
| 3 | `item_3` | Asset register updated | boolean | no | — | — |
| 4 | `item_4` | Stock stored & labeled | boolean | no | — | — |
| 5 | `item_5` | Inventory management system updated | boolean | no | — | — |
| 6 | `item_6` | Reorder levels configured | boolean | no | — | — |
| 7 | `item_7` | Stock audit completed | boolean | no | — | — |
| 8 | `item_8` | Damaged / expired stock removed | boolean | no | — | — |
| 9 | `item_9` | Vendor supply schedule confirmed | boolean | no | — | — |
| 10 | `remarks` | Remarks | textarea | no | — | — |
| 11 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### POS & Billing — `pos_billing` (7 fields)

_POS installed & tested_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | POS hardware installed | boolean | no | — | — |
| 2 | `item_2` | POS software installed & tested | boolean | no | — | — |
| 3 | `item_3` | Payment gateway integrated | boolean | no | — | — |
| 4 | `item_4` | Billing staff login credentials issued | boolean | no | — | — |
| 5 | `item_5` | Test transaction completed successfully | boolean | no | — | — |
| 6 | `remarks` | Remarks | textarea | no | — | — |
| 7 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Hiring Complete — `hiring_complete` (8 fields)

_All staff onboarded successfully_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Outlet manager onboarded | boolean | no | — | — |
| 2 | `item_2` | Game masters onboarded | boolean | no | — | — |
| 3 | `item_3` | Front desk staff onboarded | boolean | no | — | — |
| 4 | `item_4` | Housekeeping staff onboarded | boolean | no | — | — |
| 5 | `item_5` | Background verification completed | boolean | no | — | — |
| 6 | `item_6` | Employment documentation completed | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Staff Training — `staff_training` (8 fields)

_Training & orientation complete_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Game master certification passed | boolean | no | — | — |
| 2 | `item_2` | Safety drill completed | boolean | no | — | — |
| 3 | `item_3` | POS training completed | boolean | no | — | — |
| 4 | `item_4` | Customer service training completed | boolean | no | — | — |
| 5 | `item_5` | Emergency response training completed | boolean | no | — | — |
| 6 | `item_6` | Product / experience knowledge test passed | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Marketing Ready — `marketing_ready` (8 fields)

_Marketing collateral ready_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Google Business listing live | boolean | no | — | — |
| 2 | `item_2` | Booking page live | boolean | no | — | — |
| 3 | `item_3` | Launch campaign scheduled | boolean | no | — | — |
| 4 | `item_4` | Social media pages live | boolean | no | — | — |
| 5 | `item_5` | Local marketing collateral distributed | boolean | no | — | — |
| 6 | `item_6` | Influencer / press outreach initiated | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Branding & Signage — `branding_signage` (6 fields)

_Branding and signage installed_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Storefront signage installed | boolean | no | — | — |
| 2 | `item_2` | Interior branding installed | boolean | no | — | — |
| 3 | `item_3` | Directional signage installed | boolean | no | — | — |
| 4 | `item_4` | Brand guideline compliance verified | boolean | no | — | — |
| 5 | `remarks` | Remarks | textarea | no | — | — |
| 6 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Fire & Safety — `fire_safety` (8 fields)

_Fire safety and alarms ready_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Fire extinguishers installed | boolean | no | — | — |
| 2 | `item_2` | Fire alarm system tested | boolean | no | — | — |
| 3 | `item_3` | Emergency exits clearly marked | boolean | no | — | — |
| 4 | `item_4` | Fire drill conducted | boolean | no | — | — |
| 5 | `item_5` | First aid kit stocked | boolean | no | — | — |
| 6 | `item_6` | Emergency contact list displayed | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Licenses & Compliance — `licenses_compliance` (10 fields)

_All licenses and approvals in place_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Fire NOC received | boolean | no | — | — |
| 2 | `item_2` | Trade licence received | boolean | no | — | — |
| 3 | `item_3` | Insurance active | boolean | no | — | — |
| 4 | `item_4` | Shops & Establishment registered | boolean | no | — | — |
| 5 | `item_5` | GST registration updated for outlet | boolean | no | — | — |
| 6 | `item_6` | Signage / hoarding permission received | boolean | no | — | — |
| 7 | `item_7` | Local municipal compliance certificate received | boolean | no | — | — |
| 8 | `item_8` | Labour law compliance documentation filed | boolean | no | — | — |
| 9 | `remarks` | Remarks | textarea | no | — | — |
| 10 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

---

## 14. Phase 12 — Branch Opening / Handover

**Key** `p9` · **Order** 13 · **SLA** 5 days · **Department** operations · **Capture mode** collection · **Record noun** Module Submission

> Formal go-live and transfer of the completed site to the operations team, with the full handover pack.

**Exit criteria** — Branch live; handover accepted by Operations.

**Needs approval** from: Management

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Final approval | Director / MD | 3 days | Digital approval |
| Handover to Operations | Project Manager → Operations Head | On approval | Handover checklist & sign-off |
| Branch go-live | Operations | Launch date | Live status change |

### Blueprint tasks (12)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p9_g1` | Go-live: Operations | operations | 3 | medium | — | 9 |
| 2 | `p9_g2` | Go-live: It | it | 3 | high | — | 5 |
| 3 | `p9_g3` | Go-live: Pos | it | 3 | critical | — | 6 |
| 4 | `p9_g4` | Go-live: Internet | it | 3 | critical | — | 4 |
| 5 | `p9_g5` | Go-live: Power Backup | construction | 3 | critical | — | 4 |
| 6 | `p9_g6` | Go-live: Staff | hr | 3 | high | — | 5 |
| 7 | `p9_g7` | Go-live: Security | operations | 3 | high | — | 4 |
| 8 | `p9_g8` | Go-live: Emergency Contacts | operations | 3 | medium | — | 4 |
| 9 | `p9_g9` | Go-live: Inventory | procurement | 3 | high | — | 5 |
| 10 | `p9_g10` | Go-live: Marketing | marketing | 3 | high | — | 5 |
| 11 | `p9_g11` | Go-live: Legal | legal | 3 | critical | — | 5 |
| 12 | `p9_g12` | Go-live: Finance | finance | 3 | medium | — | 4 |

<details><summary>Checklist items</summary>

**Go-live: Operations**

- Final cleanliness inspection passed
- All fixtures & fittings verified
- Safety walkthrough completed
- Emergency exits verified clear
- Final photography documentation completed
- Snag list closed
- Inspection sign-off obtained
- Store handover accepted from Construction
- Final Go-Live Approval

**Go-live: It**

- IT systems final go-live check
- Helpdesk on standby for launch day
- Local servers & backup verified live
- POS network connectivity confirmed
- IT asset inventory reconciled

**Go-live: Pos**

- POS hardware powered on & tested
- Billing software live
- Payment gateway activated
- Test transaction completed successfully
- Billing staff logins issued
- Receipt printer tested

**Go-live: Internet**

- Primary ISP live on launch day
- Backup ISP link tested
- Guest Wi-Fi live
- Network speed verified

**Go-live: Power Backup**

- Mains power confirmed live
- DG / UPS backup tested on launch day
- Backup runtime verified
- Power failover tested end-to-end

**Go-live: Staff**

- All staff reported on time
- Attendance system verified
- Uniforms & ID badges issued
- Shift roster confirmed
- Final staff briefing completed

**Go-live: Security**

- CCTV live & recording on launch day
- Security guard posted
- Access control tested
- Emergency lockdown procedure briefed

**Go-live: Emergency Contacts**

- Emergency contact list posted on-site
- Fire department contact verified
- Nearest hospital contact verified
- Local police contact verified

**Go-live: Inventory**

- Opening stock counted
- Stock tallied against purchase orders
- Consumables buffer verified
- Inventory system updated with opening stock
- Reorder levels configured

**Go-live: Marketing**

- Launch campaign activated
- Social media announcement posted
- Google Business listing updated to open
- Opening day offers configured
- Press / influencer outreach completed

**Go-live: Legal**

- Trade license displayed
- Fire NOC displayed
- Insurance certificate on file
- Statutory signage displayed
- Local compliance certificate verified

**Go-live: Finance**

- Petty cash float set up
- Bank settlement account linked
- Daily settlement process briefed
- Finance sign-off obtained

</details>

### The phase's own form (4 fields)

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `launchDateTime` | Launch Date & Time | datetime | **yes** | — | — |
| 2 | `storeType` | Store Type | select | no | Flagship, Standard, Kiosk, Mall | — |
| 3 | `regionalHead` | Regional Head | text | no | — | — |
| 4 | `opsHead` | Ops Head | text | no | — | — |

### Assessment modules (8)

| # | Key | Module | Fields | Sub-item field | Log only |
|---|---|---|---|---|---|
| 1 | `go_live_approval` | Go-Live Approval | 17 | — | no |
| 2 | `final_store_inspection` | Final Store Inspection | 10 | — | no |
| 3 | `inventory_verification` | Inventory Verification | 8 | — | no |
| 4 | `pos_billing_activation` | POS & Billing Activation | 8 | — | no |
| 5 | `staff_attendance_verification` | Staff Attendance Verification | 7 | — | no |
| 6 | `marketing_launch` | Marketing Launch | 8 | — | no |
| 7 | `store_opening_ceremony` | Store Opening Ceremony | 8 | — | no |
| 8 | `customer_go_live` | Customer Go Live | 7 | — | no |

#### Go-Live Approval — `go_live_approval` (17 fields)

_Final management sign-off before opening_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `store_manager` | Store Manager | text | **yes** | — | — |
| 2 | `actual_opening_date` | Actual Opening Date | date | **yes** | — | — |
| 3 | `actual_cost` | Actual Cost | currency | **yes** | — | — |
| 4 | `item_1` | Store Open | boolean | no | — | — |
| 5 | `item_2` | POS Running | boolean | no | — | — |
| 6 | `item_3` | Internet Working | boolean | no | — | — |
| 7 | `item_4` | Electricity | boolean | no | — | — |
| 8 | `item_5` | Billing Tested | boolean | no | — | — |
| 9 | `item_6` | Employees Present | boolean | no | — | — |
| 10 | `item_7` | Security Ready | boolean | no | — | — |
| 11 | `item_8` | Cleaning Done | boolean | no | — | — |
| 12 | `item_9` | Marketing Active | boolean | no | — | — |
| 13 | `item_10` | Opening Stock Available | boolean | no | — | — |
| 14 | `item_11` | Emergency Contact Ready | boolean | no | — | — |
| 15 | `item_12` | Compliance Verified | boolean | no | — | — |
| 16 | `remarks` | Remarks | textarea | no | — | — |
| 17 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Final Store Inspection — `final_store_inspection` (10 fields)

_Final walkthrough before go-live_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Final cleanliness inspection passed | boolean | no | — | — |
| 2 | `item_2` | All fixtures & fittings verified | boolean | no | — | — |
| 3 | `item_3` | Safety walkthrough completed | boolean | no | — | — |
| 4 | `item_4` | Signage & branding verified | boolean | no | — | — |
| 5 | `item_5` | Emergency exits verified clear | boolean | no | — | — |
| 6 | `item_6` | Final photography documentation completed | boolean | no | — | — |
| 7 | `item_7` | Snag list closed | boolean | no | — | — |
| 8 | `item_8` | Inspection sign-off obtained | boolean | no | — | — |
| 9 | `remarks` | Remarks | textarea | no | — | — |
| 10 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Inventory Verification — `inventory_verification` (8 fields)

_Opening stock counted & verified_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Opening stock counted | boolean | no | — | — |
| 2 | `item_2` | Stock tallied against purchase orders | boolean | no | — | — |
| 3 | `item_3` | Consumables buffer verified | boolean | no | — | — |
| 4 | `item_4` | Inventory system updated with opening stock | boolean | no | — | — |
| 5 | `item_5` | Damaged / short stock reported | boolean | no | — | — |
| 6 | `item_6` | Reorder levels configured | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### POS & Billing Activation — `pos_billing_activation` (8 fields)

_Point-of-sale & billing systems live_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | POS hardware powered on & tested | boolean | no | — | — |
| 2 | `item_2` | Billing software live | boolean | no | — | — |
| 3 | `item_3` | Payment gateway activated | boolean | no | — | — |
| 4 | `item_4` | Test transaction completed successfully | boolean | no | — | — |
| 5 | `item_5` | Billing staff logins issued | boolean | no | — | — |
| 6 | `item_6` | Receipt printer tested | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Staff Attendance Verification — `staff_attendance_verification` (7 fields)

_All staff reported & verified_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | All staff reported on time | boolean | no | — | — |
| 2 | `item_2` | Attendance system verified | boolean | no | — | — |
| 3 | `item_3` | Uniforms & ID badges issued | boolean | no | — | — |
| 4 | `item_4` | Shift roster confirmed | boolean | no | — | — |
| 5 | `item_5` | Staff briefing completed | boolean | no | — | — |
| 6 | `remarks` | Remarks | textarea | no | — | — |
| 7 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Marketing Launch — `marketing_launch` (8 fields)

_Grand opening campaign launched_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Launch campaign activated | boolean | no | — | — |
| 2 | `item_2` | Social media announcement posted | boolean | no | — | — |
| 3 | `item_3` | Local marketing collateral distributed | boolean | no | — | — |
| 4 | `item_4` | Google Business listing updated to open | boolean | no | — | — |
| 5 | `item_5` | Press / influencer outreach completed | boolean | no | — | — |
| 6 | `item_6` | Opening day offers configured | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Store Opening Ceremony — `store_opening_ceremony` (8 fields)

_Inauguration event completed_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Ceremony date & time confirmed | boolean | no | — | — |
| 2 | `item_2` | Guest list & invitations sent | boolean | no | — | — |
| 3 | `item_3` | Ribbon-cutting arrangements ready | boolean | no | — | — |
| 4 | `item_4` | Ceremony logistics confirmed | boolean | no | — | — |
| 5 | `item_5` | Inauguration event executed | boolean | no | — | — |
| 6 | `item_6` | Ceremony photos / videos captured | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Customer Go Live — `customer_go_live` (7 fields)

_Store is now live for customers_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | Store opened to customers | boolean | no | — | — |
| 2 | `item_2` | First customer transaction completed | boolean | no | — | — |
| 3 | `item_3` | Customer feedback mechanism live | boolean | no | — | — |
| 4 | `item_4` | Day-1 footfall tracked | boolean | no | — | — |
| 5 | `item_5` | Customer service desk operational | boolean | no | — | — |
| 6 | `remarks` | Remarks | textarea | no | — | — |
| 7 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

---

## 15. Phase 13 — Closure & Delay Analysis

**Key** `p10` · **Order** 14 · **SLA** 7 days · **Department** finance · **Capture mode** collection · **Record noun** Module Submission

> Plan versus actual for every phase, department-wise delay attribution, budget variance and vendor performance — the learning that feeds back into the template.

**Exit criteria** — Closure report accepted; project archived but permanently searchable.

**Needs approval** from: Management

### What / Who / When / How

| What | Who | When | How |
|---|---|---|---|
| Compile plan vs actual | System | Automatic | Baseline vs actual engine |
| Delay analysis | Project Manager | On closure | Variance report |
| Lessons learned | Project Manager / MD | On closure | Closure form |
| Close project | Project Manager | On acceptance | Status change to Closed |

### Blueprint tasks (4)

| # | Key | Title | Dept | Est. days | Priority | Opens form | Checklist |
|---|---|---|---|---|---|---|---|
| 1 | `p10_t1` | Budget variance analysis | finance | 2 | high | — | 3 |
| 2 | `p10_t2` | Delay & schedule analysis | projects | 1 | medium | — | 2 |
| 3 | `p10_t3` | Vendor performance review | procurement | 1 | medium | — | 2 |
| 4 | `p10_t4` | Lessons learned documentation | operations | 1 | medium | — | 2 |

<details><summary>Checklist items</summary>

**Budget variance analysis**

- Planned vs actual compiled
- Overruns explained
- Final cost signed off **(required)**

**Delay & schedule analysis**

- Phase-wise slippage computed
- Root causes documented

**Vendor performance review**

- Vendors scored
- Blacklist / preferred list updated

**Lessons learned documentation**

- Retrospective held
- Playbook updated for next outlet **(required)**

</details>

### Assessment modules (8)

| # | Key | Module | Fields | Sub-item field | Log only |
|---|---|---|---|---|---|
| 1 | `budget_analysis` | Budget Analysis | 8 | — | no |
| 2 | `delay_analysis` | Delay Analysis | 10 | — | no |
| 3 | `vendor_performance` | Vendor Performance | 15 | — | no |
| 4 | `financial_closure` | Financial Closure | 9 | — | no |
| 5 | `asset_handover` | Asset Handover | 8 | — | no |
| 6 | `document_archive` | Document Archive | 9 | — | no |
| 7 | `lessons_learned` | Lessons Learned | 12 | — | no |
| 8 | `project_sign_off` | Project Sign-Off | 11 | — | no |

#### Budget Analysis — `budget_analysis` (8 fields)

_Compare budget and actual cost, and variance_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `planned_budget` | Planned Budget | currency | **yes** | — | — |
| 2 | `actual_cost` | Actual Cost | currency | **yes** | — | — |
| 3 | `variance_notes` | Variance Notes | textarea | no | — | — |
| 4 | `item_1` | Planned vs actual cost compiled | boolean | no | — | — |
| 5 | `item_2` | Cost overruns explained | boolean | no | — | — |
| 6 | `item_3` | Final cost signed off by Finance | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Delay Analysis — `delay_analysis` (10 fields)

_Analyze delays, root cause and rollup_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `planned_duration_days` | Planned Duration (days) | number | **yes** | — | — |
| 2 | `actual_duration_days` | Actual Duration (days) | number | **yes** | — | — |
| 3 | `delay_reason` | Delay Reason | textarea | no | — | — |
| 4 | `root_cause_category` | Root Cause | select | no | Vendor, Approval, Material, Manpower, Statutory / NOC, Design Change, Weather, Other | — |
| 5 | `recovery_actions` | Recovery Actions Taken | textarea | no | — | — |
| 6 | `item_1` | Phase-wise slippage computed | boolean | no | — | — |
| 7 | `item_2` | Root causes documented | boolean | no | — | — |
| 8 | `item_3` | Recovery actions logged | boolean | no | — | — |
| 9 | `remarks` | Remarks | textarea | no | — | — |
| 10 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Vendor Performance — `vendor_performance` (15 fields)

_Evaluate vendor score and quality_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `vendor_name` | Vendor Name | text | **yes** | — | — |
| 2 | `vendor_category` | Vendor Category | select | no | Construction, Interior, Procurement, Automation, IT, Marketing, Other | — |
| 3 | `rating` | Rating (out of 5) | number | **yes** | — | — |
| 4 | `on_time_delivery` | On-Time Delivery | select | no | Yes, No, Partial | — |
| 5 | `assigned_tasks` | Assigned Tasks | number | no | — | — |
| 6 | `completed_tasks` | Completed Tasks | number | no | — | — |
| 7 | `delayed_tasks` | Delayed Tasks | number | no | — | — |
| 8 | `quality_score` | Quality Score (out of 100) | number | no | — | — |
| 9 | `sla_compliance` | SLA Compliance (%) | number | no | — | — |
| 10 | `total_cost` | Total Cost | currency | no | — | — |
| 11 | `payment_status` | Payment Status | select | no | Paid, Partial, Pending | — |
| 12 | `item_1` | Vendor scorecard completed | boolean | no | — | — |
| 13 | `item_2` | Preferred / blacklist status updated | boolean | no | — | — |
| 14 | `remarks` | Remarks | textarea | no | — | — |
| 15 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Financial Closure — `financial_closure` (9 fields)

_Invoices, payments and final dues_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `total_invoiced` | Total Invoiced | currency | no | — | — |
| 2 | `total_paid` | Total Paid | currency | no | — | — |
| 3 | `pending_payment` | Pending Payment | currency | no | — | — |
| 4 | `closure_certificate_no` | Closure Certificate No. | text | no | — | — |
| 5 | `item_1` | All vendor invoices reconciled | boolean | no | — | — |
| 6 | `item_2` | Final payments released | boolean | no | — | — |
| 7 | `item_3` | Financial closure certificate issued | boolean | no | — | — |
| 8 | `remarks` | Remarks | textarea | no | — | — |
| 9 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Asset Handover — `asset_handover` (8 fields)

_Handover of all assets and equipment_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `item_1` | All fixed assets handed over | boolean | no | — | — |
| 2 | `item_2` | Keys & access cards handed over | boolean | no | — | — |
| 3 | `item_3` | Warranty documents handed over | boolean | no | — | — |
| 4 | `item_4` | AMC / service contracts handed over | boolean | no | — | — |
| 5 | `item_5` | Equipment inventory verified | boolean | no | — | — |
| 6 | `item_6` | Handover certificate signed | boolean | no | — | — |
| 7 | `remarks` | Remarks | textarea | no | — | — |
| 8 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Document Archive — `document_archive` (9 fields)

_Archive all project documents and media_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `document_category` | Document Category | select | **yes** | Final Reports, Completion Certificates, Vendor Reports, Financial Reports, Approval Documents, Contracts, Invoices, Legal… | — |
| 2 | `documents_count` | Documents Archived (count) | number | **yes** | — | — |
| 3 | `item_1` | Legal documents archived | boolean | no | — | — |
| 4 | `item_2` | Financial documents archived | boolean | no | — | — |
| 5 | `item_3` | Vendor contracts archived | boolean | no | — | — |
| 6 | `item_4` | Project photos & videos archived | boolean | no | — | — |
| 7 | `item_5` | Compliance certificates & NOCs archived | boolean | no | — | — |
| 8 | `remarks` | Remarks | textarea | no | — | — |
| 9 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Lessons Learned — `lessons_learned` (12 fields)

_Key learnings, challenges and recommendations_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `lesson_category` | Category | select | **yes** | Success, Failure, Risk, Recommendation, Future Improvement, Best Practice | — |
| 2 | `lesson_title` | Title | text | **yes** | — | — |
| 3 | `key_learnings` | Key Learnings | textarea | **yes** | — | — |
| 4 | `challenges` | Challenges Faced | textarea | no | — | — |
| 5 | `recommendations` | Recommendations for Next Project | textarea | no | — | — |
| 6 | `impact_area` | Impact Area | select | no | Budget, Timeline, Quality, Vendor, Process, People, Compliance | — |
| 7 | `meeting_notes` | Retrospective Meeting Notes | textarea | no | — | — |
| 8 | `item_1` | Retrospective meeting held | boolean | no | — | — |
| 9 | `item_2` | Key learnings documented | boolean | no | — | — |
| 10 | `item_3` | Playbook updated for next outlet | boolean | no | — | — |
| 11 | `remarks` | Remarks | textarea | no | — | — |
| 12 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

#### Project Sign-Off — `project_sign_off` (11 fields)

_Collect final sign-off from all stakeholders_

| # | Field key | Label | Type | Required | Options / limits | Help text |
|---|---|---|---|---|---|---|
| 1 | `sign_off_role` | Sign-Off Authority | select | **yes** | Department Head, Finance, Operations, Regional Manager, Management, CEO | — |
| 2 | `signed_off_by` | Signed Off By | text | **yes** | — | — |
| 3 | `sign_off_date` | Sign-off Date | date | **yes** | — | — |
| 4 | `digital_signature` | Digital Signature | text | no | — | Type your full name to sign — stored verbatim as the signature of record |
| 5 | `overall_rating` | Overall Project Rating (out of 100) | number | **yes** | — | — |
| 6 | `item_1` | All stakeholders signed off | boolean | no | — | — |
| 7 | `item_2` | All closure modules completed | boolean | no | — | — |
| 8 | `item_3` | Final closure report generated | boolean | no | — | — |
| 9 | `item_4` | Project formally closed | boolean | no | — | — |
| 10 | `remarks` | Remarks | textarea | no | — | — |
| 11 | `attachments` | Attachments | file | no | accepts .jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx · multiple | Photos, certificates, evidence documents — unlimited uploads |

---

