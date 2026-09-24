# 23 September 2026 — Property FMS fixes and the August data clear-out

What changed today, why each change was needed, and what to watch afterwards.
Written for whoever picks this repo up next — including the person who wrote
it, in a month.

---

## 1 · Step 6 · Document Approvals returned 400 on every load

**Symptom.** Opening Step 6 failed with
`Validation failed · stage: Invalid enum value. Expected 'capture' | 'routing'
| 'demand' | 'assessment' | 'selection' | 'commercial' | 'rejected', received
'docreview'`.

**Cause.** Not a code fault. `propertyCapture.routes.js` already accepted
`docreview`, and the service already handled it. The API **process** was
started before that merge landed and was still running the old seven-stage
enum from memory.

**Fix.** Restarted the API. No code change.

**Worth knowing.** A long-running `node src/index.js` does not pick up merges.
After pulling, restart it — or run `npm run dev` (nodemon), which does it for
you. This cost a session's worth of confusion for a fault that did not exist
in the source.

---

## 2 · Dead space in the Action column — Steps 2, 4 and 6

**Symptom.** A wide band of empty column pinned to the right of every row.
Because the column is pinned, the gap follows you as you scroll, so it reads
as a column that failed to load rather than one with nothing in it.

**Cause.** One fixed width sized for the widest possible content — Approve +
Reject + Details — while the reader signed in (a Technical Expert) cannot
decide anything and only ever sees "View only" + Details. ~120px of nothing
on every row.

**Fix.** The width is now derived from what the column will actually hold:

| Step | Reader | Width | Slack |
| --- | --- | --- | --- |
| 2 · MD Review & Decision | can decide | 264 | 24px |
| 2 · MD Review & Decision | view only | 168 | 24px |
| 4 · MD Review & Approval | can decide | 262 | ~24px |
| 4 · MD Review & Approval | view only | 168 | 24px |
| 6 · Document Approvals | anyone | 172 | 18px |

Files: `PropertyMdReviewPage.jsx`, `PropertySelectionPage.jsx`,
`PropertyDocApprovalPage.jsx`.

---

## 3 · The seven KPI tiles wrapped to a second line on a 14" laptop

**Symptom.** At 100% zoom on a 1366px screen the seventh tile dropped onto its
own line, costing a whole band of vertical space above the table on exactly
the screens with the least of it.

**Cause.** The rule itself. Below 1400px a media query *raised* the tile
minimum to 200px; seven tiles then need 1460px and a 14" laptop offers about
1060, so `auto-fit` did as it was told and wrapped.

**Fix.** `grid-auto-flow: column` with `grid-auto-columns: minmax(0, 1fr)` —
put them all on one row and let them share the width. Padding, icon and
number sizes step down below 1500px so the content still reads at ~142px per
tile. Below 1100px they wrap deliberately: seven across stops being legible
at any size.

Verified at 1366×768 on Steps 2, 4 and 5: **7 tiles, 1 line, narrowest 142px**.

Side effect fixed on the way: labels were first clipped to protect the layout,
which turned "Documents Pending" into "Documents Pe…". Since the columns are
strictly equal a long label cannot steal space from its neighbours, so the
clipping was protecting against nothing and was removed.

File: `client/src/styles/property-capture-blue.css`.

---

## 4 · Step 4's approve dialog and Step 5's document rows

This work was written on another machine, arrived with the merge, and was
sitting staged but unverified. Verified end to end today and finished.

### Step 4 — the verdict dialog

Shows the property's basic facts, then only the assessments that actually came
back, then their average (gold border), then the two roads as **checkboxes**:

- Both can be ticked; they are not alternatives.
- **Commercial cannot be unticked.** The six documents open whatever road is
  chosen — an outlet cannot open without a lease — so it is locked on and
  labelled `ALWAYS`. Confirmed in the browser: ticking games leaves both
  checked and the button becomes *Approve → closure + games*.

### Step 5 — one row per document, not six columns

Six documents were six bands across the sheet, so reading one property's
closure meant scrolling right past thirty columns. Turned on its side: a
property that reaches closure owes six documents, so it gets six rows and
every column means the same thing all the way down. **102 rows = 17 properties
× 6.** The property is named once per block, with a border between blocks.

Two faults found and fixed during verification:

- **Every document claimed "In progress".** All six open as empty drafts the
  moment a property reaches closure, so the sheet reported a hundred documents
  underway when nobody had touched one. `documentState()` now treats an
  untouched draft as `start` → **"Open form"**. (`DocumentCell.jsx`)
- **"Uploaded" sat off the right-hand edge** — the column the step exists to
  answer, pushed out by 13 columns. Trimmed to **9 columns, no horizontal
  scroll**: Source dropped (identical on all six rows, already on Step 1),
  Details folded under the document's name, Done by + Filed on merged, and Key
  date + Expires became one **Dates** column labelled per row — a lease
  *starts/runs to*, an LOI is *dated/expires*, a legal check is just
  *verified*, so two fixed columns left one empty on most rows.

---

## 5 · "Plan it" → "Create project" on Step 7

The step is called *All Project Creation*, the row button said *Plan it*, and
the form's submit said *Create plan* — three names for one action. All three
now say **Create project** (and **Edit project** once one exists).

Files: `PropertyPlanningPage.jsx`, `PropertyPlanModal.jsx`.

---

## 6 · August project data deleted

### What was asked, and what was actually there

The request was "delete July and August project data, not employees".
**There were no July projects** — the oldest in the database was 6 August.

August held 18 projects. Deleting all of them was flagged first, because they
were not old test data: they were the projects being demoed all week (Bhopal,
Noida, Connaught Place, Delhi NCR, Lucknow), and they fill Steps 3–7 of the
Property FMS. The narrow option was taken first, then the full month on a
second, explicit instruction.

### Deleted, in two passes

| Pass | Projects | Documents |
| --- | --- | --- |
| Test only | `DRAFT-2A56D201` pune project, `MR-AHM-001` demo | 100 |
| All remaining August | 16 projects | 2,385 |
| **Total** | **18** | **2,485** |

The 2,385 breaks down as 1,039 tasks, 209 records, 741 activities, 370
notifications, 9 AI analyses, 1 outsource link, 16 projects.

### Afterwards

```
projects       19   (all September)      was 37
tasks        1097                        was 2197
records        78                        was  297
users          65   ← untouched
```

Employees, job roles, templates, games, vendors, the inventory master and
stock were never in scope and are intact. Verified that **nothing is left
pointing at a deleted project**, and every affected endpoint still answers
200: Projects, all four Property FMS stages, My Tasks, Dashboard summary, MIS
portfolio.

### Backups — two full snapshots, either restores everything

- `backup/pre-delete-2026-09-23/` — before anything was touched, 15,407 docs
- `backup/pre-august-delete-2026-09-23/` — before the August pass, 15,307 docs

Restore with `node src/seed/dbImport.js --to "<uri>" --apply`.

### Known, pre-existing, NOT caused by this

**2,935 orphaned documents** point at projects deleted long before today:
2,925 activities, 9 AI analyses, 1 notification. Checked explicitly — none of
them reference anything removed today. They are invisible in the UI but
inflate the activities collection. Not cleaned up, because that is more
deletion than was asked for.

### One consequence worth naming

The assessment tasks assigned to Om Prakash, Shishir and Prateek belonged to
August projects and went with them. **The assignment rules survive** — the
org-sheet ownership map and the FMS · Assign Work screen are untouched — so
properties created from September onward hand their assessments to the right
people automatically.

---

## 7 · Tooling added or fixed

### `server/src/seed/deleteProjects.js` — new

Report-first project deletion with the full cascade. Nothing is written
without `--apply`, and it re-checks for orphans after deleting.

```bash
node src/seed/deleteProjects.js --codes MR-AHM-001,DRAFT-2A56D201
node src/seed/deleteProjects.js --created 2026-08..2026-08
node src/seed/deleteProjects.js --match "demo|test" --apply
```

It refuses to run with no selector at all, which would match every project.
It never touches users, templates, games, vendors, inventory or stock.

### `server/src/seed/dbExport.js` — fixed

Added the two-line DNS override every other seed script already carries. Atlas
is reached over an SRV record and this network's resolver refuses the
`_mongodb._tcp` lookup, so the one tool you reach for *before* deleting
anything failed with `querySrv ECONNREFUSED`.

### `.gitignore` — `backup/` added

The dumps are a full copy of the live database — every staff email, phone
number and record — and 13 MB a run. They were not ignored, so the next
`git add .` would have committed them. **If you have already committed one,
it needs removing from history, not just deleting.**

---

## Files touched today

```
client/src/features/property/PropertyMdReviewPage.jsx      action column width
client/src/features/property/PropertySelectionPage.jsx     action column width
client/src/features/property/PropertyDocApprovalPage.jsx   action column width
client/src/features/property/PropertyCommercialPage.jsx    9 columns, merged cells
client/src/features/property/DocumentCell.jsx              untouched draft = "Open form"
client/src/features/property/PropertyPlanningPage.jsx      Create project
client/src/features/property/PropertyPlanModal.jsx         Create project
client/src/styles/property-capture-blue.css                KPI tiles on one line
server/src/seed/deleteProjects.js                          NEW
server/src/seed/dbExport.js                                DNS override
.gitignore                                                 backup/
```

---

## Earlier this week, for continuity

- **21 Sep** — Access Control: every module and FMS step grantable at four
  levels, by role and by named person, enforced in the sidebar, the router and
  the API.
- **22 Sep** — The org sheet's 20 job roles became a real field on the account
  (`SHEET/USERROLE.xlsx`, 26 seats), 36 accounts migrated and 14 placeholder
  logins deactivated; Access Control rebuilt around those roles; **FMS ·
  Assign Work** added (who does each job in a flow, and who covers them); My
  Tasks moved out of PMS to its own top-level entry; task pages gained a
  direct "Fill the … assessment" button and close their task on submit.
