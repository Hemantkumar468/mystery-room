# Property Capture module

Everything the Mystery Rooms ERP holds about sourcing a site, from the moment a
property is mentioned to the moment a project is created against it.

> **Audience:** developers and analysts working on this codebase. It assumes you
> know React, Express and Mongo, but nothing about this module.

---

## 1. What it is, in one paragraph

Property Capture is the pipeline that runs **before** a project exists. A
property arrives from one of four doors, one decision routes it, assessments and
commercial documents are filed against it, and it ends as a project with games
and an opening date. It is four screens over **one** underlying record.

**It is its own module, not a PMS page.** Sourcing a site is not a phase of a
project — it is what happens before there is a project worth running. Most
properties never become one, and the people working this queue are not the
people running builds. Inside PMS it read as a report on projects, which is the
one thing it is not.

---

## 2. The critical design decision: this module owns no data

There is no `PropertyCapture` collection. **The module is a read model.**

The client asked for "one common property record" fed by four intakes. That
record already existed: a **Phase 1 (`p1`) Record**. The franchise decision
already filed an applicant's properties as `p1` records, and in-house scouting
filed them there too.

Adding a table would have meant the same property in two places, drifting apart
the first time somebody edited one — and every downstream phase (assessment,
LOI, the whole project) reads `p1`.

So the service **unions the intakes into one row shape** and gives that row its
two actions. A queue row is not a status machine of its own: its `stage` is read
off the record's real status and its real child records, so this page can never
claim a property is somewhere the project does not agree it is.

**Consequence for you:** to change what a property *is*, edit the `p1`
`masterDataSchema` on the template — not this module.

---

## 3. The four intakes

| Source | Label in UI | What it is |
|---|---|---|
| `franchise` | Franchisee | A franchisee applied through the franchise link **and** sent properties. Rows come off the enquiry *before* any decision, so the MD can act on the property without first approving the lead. |
| `broker` | Broker | A broker, agent, landlord or partner submitted a site through the open referral link. Same model, different intent (`source: 'broker'` on the enquiry). |
| `demand` | Wanted | Somebody wants a store in a city but **has no property**. Produced by a franchise applicant who ticked "interested, no property", or by New Project for a city. A standing ask, not a property. |
| `captured` | Captured | Already a `p1` record on a project. The rows the pipeline actually moves through assessment and closure. |

`demand` is the one to read twice. It is deliberately kept visible so the ask
does not quietly fall off the list — somebody has to go and find a site for it.

### Public intake forms

Both are unauthenticated by design; the person filling them in has no login.

| Route | Form |
|---|---|
| `/franchise/apply` | Franchisee application — asks whether they already have a property |
| `/refer-property` | Property referral — asks only about the property, not about them |

On the naming: *"Broker link"* was the original ask, but the people who send us
sites are brokers, agents, landlords, mall leasing teams and the occasional
friend of the MD. **Property referral** describes the act rather than the
sender's job, so it fits all of them. Rows still *tag* as "Broker", because that
is what the row is in practice.

---

## 4. The four steps

Defined once in `client/src/features/property/config/property.routes.config.js`,
which drives routing, the sidebar, breadcrumbs, titles and icons.

| Step | Route | What happens |
|---|---|---|
| 1 · Property Capture | `/property/capture` | Every property in front of us. The one routing decision is taken here. |
| 2 · Assessment | `/property/assessment` | The four Site Evaluations are filed. Ends in shortlist or reject. |
| 3 · Commercial Finalization | `/property/commercial` | The six documents. |
| 4 · Project & Games Planning | `/property/planning` | Games, opening date, create the project. |

The steps are **the flow, not a menu**. A property enters at Step 1 and the
decision on its row moves it. Nothing is filed twice — each step is the same
record seen at the point its own work happens.

### The stepper, and why it branches

`PropertySteps.jsx` renders the four steps as numbered discs joined by arrows,
with a **dashed branch from Step 1 to Step 3**: *skip assessment · straight to
commercial*.

The client's own diagram forks at Step 1 ("assessment required?"). A plain
1-2-3-4 chain would tell a new starter that every property goes through
assessment, when the whole point of the decision is that many do not. The branch
is drawn **inside** the stepper with its own arrowhead, in the same grammar as
the solid arrows, so it reads as a second way *through* the flow rather than a
footnote about it.

Its ends are anchored at 12.5% and 62.5% — the centres of the first and third of
four equal columns, which is where the discs sit.

---

## 5. Stage: how a row knows where it is

`stageOf()` in `propertyCapture.service.js`, derived in this order:

```
rejected     record.status is REJECTED or ARCHIVED
commercial   any commercial child record exists, or status is APPROVED
assessment   any assessment child record exists
capture      otherwise
```

Order matters: a property in commercial closure still has its assessment records
underneath it, so **the later fact is the true one**.

`rejected` is checked first, and that is a bug fix, not a nicety. Nothing looked
at `status` for a negative, so a rejected site kept reporting as "captured" and
sat in Step 1 forever, identical to the live ones. Two real properties were
doing it. Rejected rows are excluded by default (`includeRejected`).

---

## 6. The three write actions

All three are on `/api/v1/pms/property-capture`.

### `POST /:recordId/route` — manager tier (`CAN_MANAGE`)

The one decision in the flow: **does this property need assessment?**

- **Yes** → opens the chosen Site Evaluation forms (any subset of four)
- **No** (`skip: true`) → opens the six commercial documents instead

Either way it first **shortlists** the record if it is not already, because
shortlisting is what marks a property as one we are pursuing.

Re-routing an already-routed property is allowed and is **not destructive** —
the server skips assessments that already exist, so adding Technical later adds
Technical and disturbs nothing else.

### `POST /submissions/:enquiryId/route` — decision tier (`CAN_DECIDE`)

The same question for a property that arrived through a public link, plus the
approve/reject of the lead itself. It is **one call** because answering the
question is what approves the lead and creates the project.

### `POST /:recordId/decide` — manager tier (`CAN_MANAGE`)

The verdict after assessment: `shortlist` or `reject` (reject requires a
reason). **Shortlisting opens the paperwork** — the six commercial documents are
created as part of the same call.

### `GET /` and `GET /meta`

Reading is open to any signed-in user; the expansion team works this list.
`/meta` serves the four assessments and six documents so the client cannot drift
from the server.

---

## 7. The four assessments and six documents

Keys match `assessmentTypes` on `p2` and `p3` in `storeLaunchTemplate.js`.

**Assessments (`p2`)** — `feasibility`, `financial`, `technical`, `operational`.
The MD picks any subset; all four is the common case.

**Documents (`p3`)** — `loi`, `lease`, `legal`, `deposit`, `nocs`, `approvals`.

`project_creation` is deliberately **not** one of the six: it is the handover
after them, not a document somebody files. Step 3 counts out of six — counting
out of seven would mean the bar never reached full until the project had already
started.

**The LOI is the one document Step 4 cares about.** Signed and uploaded, the
site is committed and planning it is safe. It is reported as a *fact, not a
lock* — the client was explicit that a promising site should not have its games
and dates held hostage to a slow landlord, so Step 4 shows the LOI state and
still lets planning start.

---

## 8. Server: file by file

`server/src/modules/pms/propertyCapture/`

| File | Lines | Contents |
|---|---|---|
| `propertyCapture.service.js` | ~985 | The union, the row shape, stage derivation, the three actions |
| `propertyCapture.routes.js` | ~130 | Zod schemas, authorization tiers |

### Things worth knowing in the service

- **Pagination is server-side.** The union is the whole pipeline; shipping every
  row so the client can show 25 wastes the transfer and the render, and gets
  slower every month. `counts` rides along in the same response so the four
  stepper totals stay correct on every page without a second round trip.
  `DEFAULT_LIMIT` / `MAX_LIMIT` are exported.
- **Sorting is a whitelist** (`SORTABLE` / `SORT_KEYS`), not a passthrough. A
  sort key arriving from a query string handed straight to a comparator over
  arbitrary property paths is how you get one that reads fields the caller was
  never shown.
- **Media is normalised** by `mediaOf()`. An enquiry carries
  `photos`/`videos`/`documents`/`driveLinks`; a filed `p1` record carries
  `photos`/`videos`/`documents`/`drive_links` plus `audio` (in-app capture
  only). One shape, so the page has one thing to render. A Drive link stays a
  link with its own label rather than being coerced into a file it is not.
- **Phase 4 plan keys are copied from the template, not guessed.** An earlier
  version looked for `games` / `opening_date` and hit neither: `p20` calls them
  `selected_games` and `target_opening`. A guess that misses does not fail
  loudly — it returns `undefined`, and the column reported "None chosen yet" for
  outlets whose games had been picked weeks earlier.

---

## 9. Client: file by file

`client/src/features/property/` — ~3,400 lines.

### Pages

| File | Purpose |
|---|---|
| `PropertySteps.jsx` | The shell: the four-step stepper + `<Outlet/>` |
| `PropertyCapturePage.jsx` | Step 1 queue |
| `PropertyAssessmentPage.jsx` | Step 2 |
| `PropertyCommercialPage.jsx` | Step 3 |
| `PropertyPlanningPage.jsx` | Step 4 |

### Dialogs

| File | Purpose |
|---|---|
| `PropertyCaptureModal.jsx` | Capture a property — project gate, picker, then the form |
| `PropertyCaptureWizard.jsx` | The same form as guided steps. **Currently unused** (see §11) |
| `PropertyRouteModal.jsx` | The assessment-or-skip decision |
| `EnquiryDecisionModal.jsx` | Approve/reject a public submission |
| `PropertyVerdictModal.jsx` | Shortlist or reject after assessment |
| `PropertyPlanModal.jsx` | Games and dates |
| `PropertyMediaModal.jsx` | Photos, videos, documents, audio, links |

### Shared

| File | Purpose |
|---|---|
| `usePropertyQuery.js` | Filters, sort, page and page size — **one hook for all four steps** |
| `PropTable.jsx` | The table every step renders |
| `PropPager.jsx` | The pager |
| `propertyUi.jsx` | `PageHead`, `PropertyCell`, `ContactCell`, `PropertyToolbar`, `PropEmpty`, badges |
| `AssessmentPicker.jsx` | The road choice and the four tick boxes |
| `AssessmentScoreCell.jsx`, `GamesCell.jsx` | Column renderers |
| `PropertyIntakeBar.jsx` | The "Add properties" row above the queue |

`usePropertyQuery` is shared deliberately: all four steps ask the same question
with one word changed (`stage`), and four copies is four chances for one of them
to forget to reset the page on a filter change — which strands somebody on page
7 of a result that now has two pages.

Search is debounced at 300ms: every keystroke is otherwise a request, and typing
"Connaught" is nine of them racing each other to render.

### RTK Query

`client/src/app/api/propertyCaptureApi.js`. The queue provides the
`PropertyCapture` tag; all three mutations invalidate it along with `Record` and
`ProjectTree`, because the project board is looking at the same document.

**`recordInvalidation` in `recordsApi.js` also busts `PropertyCapture` for any
`p1` write.** Without it, filing a property from anywhere — including inside a
project — left this queue showing the list as it was before the property
existed.

---

## 10. Capturing a property

Three entry points, **one form**.

| Entry point | Where |
|---|---|
| **Capture a property** | The intake bar on Step 1 |
| **Find a site** | On a `demand` row |
| **Add New Property** | Inside the project, PMS Phase 1 |

All three open the same `RecordFormModal` over the `p1` `masterDataSchema` from
the project's own template — not the default template, because a project put on
a different template must get that template's fields. Verified identical: same
title, sections, field labels, control count and footer.

### The gate

**Capture a property** asks one question first: *is there a project for this
site yet?*

- **Yes** → pick it, then capture
- **No** → create it, then come **back here** to capture

A captured property is a `p1` Record and a Record belongs to a project — that is
what makes a site comparable against the other options for the same store.
Asking first costs one click; asking afterwards costs twenty fields.

`NewProjectModal` takes an optional `onCreated` which hands the project back
*instead of navigating to it*, and leaves the closing to the caller. Without it,
somebody who answered "no project yet" was dropped on the new project page and
lost the site they came to record.

### After saving

The dialog closes and **you stay on the queue**. The record is a PMS Phase 1
record either way — filed on the project, moving through the phase — but the
person who filed it was working this queue, and sending them to the project page
ended the session they were in the middle of. The new row appearing behind the
closing dialog is the proof. The flash names the project, because *"where did it
go?"* is the one thing not navigating leaves unanswered.

---

## 11. Known state and loose ends

- **`PropertyCaptureWizard.jsx` is unused.** It renders the same schema one
  section at a time, with conditional routing (choosing "Rent" drops the lease
  step entirely), auto-advance on single-choice steps, and a review page. It is
  still reachable via `form="guided"` on `PropertyCaptureModal`; the default is
  `form="classic"`. Delete it or wire it back — do not leave it ambiguous.
- **Action button labels** on Step 1 are `Action and Review` and `Action`. They
  no longer describe what the buttons do, and they sit in a column already
  headed ACTION.
- **`project_creation`** is excluded from the six documents by design. Do not
  "fix" the count to seven.

---

## 12. Gotchas

1. **Never add a property table.** See §2.
2. **Stage is derived, never stored.** Do not add a `stage` field to `p1`.
3. **`rejected` must stay first** in `stageOf`. See §5.
4. **Rate and required fields:** a `p1` record only enforces required fields on
   `submitted`; a draft skips validation. That is how partial captures are saved.
5. **Sorting:** add to `SORTABLE` in the service, not to the client.
6. **The four assessments and six documents are defined twice** — server
   (`propertyCapture.service.js`) and client (`propertyCaptureApi.js`). They must
   match; `/meta` exists so the client can check rather than assume.

---

## 13. Quick reference

```
Server   server/src/modules/pms/propertyCapture/
Client   client/src/features/property/
API      client/src/app/api/propertyCaptureApi.js
Styles   client/src/styles/property-capture.css
Routes   /property/capture | /assessment | /commercial | /planning
Public   /franchise/apply | /refer-property
Stages   p1 property · p2 assessments · p3 documents · p20 plan
```
