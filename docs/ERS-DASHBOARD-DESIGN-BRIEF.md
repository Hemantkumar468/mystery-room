# Employee Performance Dashboard — Design Brief

**For:** UI/Figma generation.
**Product:** Mystery Rooms ERP → a new read-only module showing employee ratings, KPIs and leaderboards.
**Source:** ERS 2.0 (Employee Review System) API — `feedback.mysteryrooms.co.in`.

> Customers rate the staff member who served them at an outlet. Those ratings roll up
> into per-employee scores, ranks and leaderboards. **This dashboard only DISPLAYS
> that data — there is no create, edit or delete anywhere in it.**

All numbers and names below are **real, live data** pulled from the API — use them
verbatim so the mockups look like the real product.

---

## Scale of the data

| | |
|---|---|
| Employees | **148** ranked (205 in the directory) |
| Reviews | **4,671** |
| Outlets | **30** |
| Brands | **2** (Mystery Rooms, Challenge Rooms) |
| Cities / States | **16 / 13** |
| Overall average rating | **4.85** (global average 4.76) |

---

## Screen 1 — Performance Overview (landing)

### A. KPI cards — one row, 6 cards

| Card | Value | Sub-label |
|---|---|---|
| Employees ranked | **148** | across 30 outlets |
| Total reviews | **4,671** | all time |
| Average rating | **4.85** | global avg 4.76 |
| Perfect | **124** | 4.8★ and above |
| Good | **14** | 4.0 – 4.79★ |
| Needs improvement | **1** | below 4.0★ |

Also available: `no_reviews_count: 9` (employees with zero reviews) — could be a 7th
card or a warning chip.

Style: tinted cards, each with an icon tile, a large number, a quiet sub-line.
Suggested colours — blue / indigo / green / emerald / amber / red.

### B. Filter bar — one line

`Period` (Week · Month · Quarter · Year · All time) · `Brand` · `Outlet` · `City` ·
`State` · `Reset`

### C. Top 3 podium (optional hero)

Cards for ranks 1–3 with photo, name, CPS score, outlet. Gold / silver / bronze.

### D. Leaderboard table

| # | Employee | Position | Outlet | City | Rating | Reviews | CPS | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | KRISHNAKANT KAILASH GUPTA | Customer Relationship Officer | Andheri West | Mumbai | 4.85 ★ | 240 | 4.79 | Perfect |
| 2 | Vipin Kumar | Customer Relationship Officer | Sec 104, Noida | Noida | 4.94 ★ | 165 | 4.57 | Perfect |
| 3 | Kolla Diwakar | Customer Relationship Officer | WhiteField | Banglore | 4.85 ★ | 156 | 4.44 | Perfect |
| 4 | Nupur verma | Branch Manager | Indira Nagar | Banglore | 4.94 ★ | 116 | 4.36 | Perfect |
| 5 | Alina Khan | Customer Relationship Officer | Wave One | Noida | 4.97 ★ | 106 | 4.35 | Perfect |
| 6 | Shivani | Customer Relationship Officer | Sector 35 | Chandigrah | 4.91 ★ | 111 | 4.31 | Perfect |

Notes for the designer:
- **Employee cell** = circular photo + name on line 1, employee code (`MR427`) on line 2.
- **Rank cell** = large number; medal icon for 1–3.
- **Status** = pill. `Perfect` green · `Good` amber · `Needs Improvement` red · `No reviews` grey.
- **Rating** = number + star glyph. **CPS** = the composite score, 2 decimals, bold.
- Rows are dense (~56px). 148 rows, so it paginates or scrolls with a sticky header.

---

## Screen 2 — Employee detail (side drawer)

Opens from a row. Read-only.

**Header:** photo, name, position, employee code, outlet · city · brand, status pill.

**Metric tiles** (8 — all real field names, sample values from rank 1):

| Metric | Value | Meaning |
|---|---|---|
| Average rating | 4.85 | raw customer average |
| Total reviews | 240 | volume |
| Positive % | 100% | share of positive ratings |
| CPS | 4.7889 | **the headline composite score** |
| Bayesian score | 4.839 | rating adjusted for low volume |
| Consistency (σ) | 0.361 | lower = steadier |
| Volume bonus | 5.0 | out of 5 |
| Consistency bonus | 4.015 | out of 5 |

**Rank panel** — the same person ranked at five levels. Show rank, total and percentile:

| Scope | Rank | Percentile |
|---|---|---|
| Global | 1 of 148 | 100th |
| Country | 1 of 148 | 100th |
| State | 1 of 17 | 100th |
| City | 1 of 10 | 100th |
| Outlet | 1 of 6 | 100th |

Suggested visual: five horizontal percentile bars, or five compact stat chips.

**"How is this scored?" explainer** — a collapsible panel. The API returns the formula,
so it can be shown verbatim:

> **Composite Performance Score (CPS) v2.0**
> `CPS = BWR × 0.70 + VB × 0.20 + CB × 0.10`
> - **Bayesian Weighted Rating (70%)** — stops someone with three 5★ reviews outranking someone with 200 consistent 4.8★ reviews.
> - **Volume Bonus (20%)** — rewards serving more customers.
> - **Consistency Bonus (10%)** — rewards steady service over erratic 5★/2★ swings.

---

## Screen 3 — Outlet comparison (optional, same data)

The same employee list grouped by outlet: outlet name, employee count, average rating,
total reviews, best performer. Card grid or table. No extra API needed.

---

## Every field available (for reference)

**Per employee:** `id`, `name`, `photo`, `position`, `join_date`, `zimyo_id` (employee
code), `outlet{id,name}`, `brand{id,name}`, `city{id,name}`, `state{id,name}`,
`country{id,name}`, `status`

**`metrics`:** `avg_rating`, `total_reviews`, `positive_pct`, `bayesian_score`, `cps`,
`stddev`, `volume_bonus`, `consistency_bonus`

**`ranks`:** `global` · `country` · `state` · `city` · `outlet` — each with
`{rank, total, percentile}`

**`summary`:** `total_employees`, `total_reviews`, `overall_avg`, `perfect_count`,
`good_count`, `needs_improvement_count`, `no_reviews_count`, `global_avg`

**Also:** `period`, `lastUpdated` (timestamp — show as "Updated 2 min ago"),
`filterOptions` (outlets, employees, brands, states, cities, statuses, ratings)

---

## Out of scope — do NOT design these

These need an API key we do not have yet, so nothing can fill them:

- Individual review text / customer comments (`/api/feedback` → 401)
- Admin stat blocks (`/api/dashboard/stats` → 401)
- Employee directory management (`/api/employees` → 401)
- Anything that creates, edits, approves or deletes

If the client supplies a key later, the natural additions are a **Reviews** page
(paged table of individual reviews, filterable by outlet/employee/rating/date) and
rating-trend charts over time.

---

## Visual direction

Match the existing ERP: light surfaces, 14px radius cards, 1px `#e5e7eb` borders,
dark sidebar, amber/gold primary. Dense tables, pill badges, tabular-lining numerals
for all figures. Must read well at **1366×768** (14" laptop) — that is the primary
screen; the filter bar stays on one line and the table's action column is pinned.
