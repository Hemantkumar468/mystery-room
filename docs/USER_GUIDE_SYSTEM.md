# User Guide System — How It Works & How to Extend It

**Audience:** whoever adds the next module (CRM, HRMS, Inventory…) or the next
guide — a developer, or an AI given this file. Everything needed is here.

---

## 1. What the user sees

A **User Guide** entry in the sidebar (visible to every role) opens the guide
centre at `/guide`:

- **Guides grouped by module** (PMS today), each offered three ways:
  - **Walk me through** — an interactive tour over the real screens. The page
    dims, the relevant element stays spotlit, a card explains it. Next / Back /
    dots / arrow keys; Esc exits.
  - **Auto-play** — the same tour advancing by itself (default one step every
    8 s, per-guide configurable). A draining bar on the card shows the timer;
    it can be paused, and it stops at the last step rather than looping.
  - **Read** — the written steps expanded in place, for people who prefer text.
- **Search** across titles, descriptions *and step text* — "checklist" finds
  the doer guide even though the word isn't in its title.
- **Role filtering** — a guide declares who it is *for*; the centre never
  teaches a role buttons it doesn't have. A Viewer sees reading guides, an
  Employee's list leads with their own flow, the MD sees everything.

Tours never mutate data — they point, navigate and explain, nothing else.

---

## 2. The three files

| File | Role |
|---|---|
| `client/src/features/guide/guides.js` | **The content.** Modules → guides → steps. Data only — this is the ONLY file you edit to add content. |
| `client/src/features/guide/GuideContext.jsx` | **The engine.** Provider + overlay: spotlight, centred cards, navigation between routes, auto-play, keyboard. Mounted once in `AppShell`, so a tour works from any page. |
| `client/src/features/guide/UserGuidePage.jsx` | **The centre** at `/guide`. Renders whatever `guides.js` registers; search + role filter live here. |

Styling: `client/src/styles/guide.css` (`.ug-*` centre, `.gd-*` engine).

---

## 3. Adding a guide (or a whole module)

### 3.1 A new guide inside an existing module

Append to that module's `guides` array in `guides.js`:

```js
{
  key: 'unique-kebab-key',
  title: 'Verb-first, outcome-shaped title',
  description: 'One sentence: what the reader will be able to do afterwards.',
  roles: ['md', 'ea', 'manager'],   // or null = everyone
  autoAdvanceMs: 10000,             // auto-play pace; omit for 8000
  steps: [ /* see 3.3 */ ],
}
```

### 3.2 A new module (CRM, HRMS…)

Append one object to `GUIDE_MODULES`:

```js
{
  key: 'crm',
  label: 'CRM — Franchise Leads',
  description: 'One line on what the module is for.',
  guides: [ /* start with an orientation guide — see 4 */ ],
}
```

That is the entire registration. The centre page, search and role filtering
pick it up with no other change.

### 3.3 Writing a step

```js
{
  title: 'Click Start Work',                    // one short line
  body: '2–4 plain sentences. Name buttons exactly as the screen shows them.',
  route: '/my-tasks',                           // optional: navigate first
  selector: 'a[href="/my-tasks"]',              // optional: what to spotlight
}
```

**Selector rules — this is where tours rot if you're careless:**

1. **Nav links:** `a[href="/route"]` — stable, no code change needed.
2. **Buttons/areas:** add a `data-guide="name"` attribute to the element and
   select `[data-guide="name"]`. Never select by CSS class — classes change
   for styling reasons and the tour silently breaks. (`data-guide="new-project"`
   on the Projects page's New Project button is the existing example.)
3. **No selector at all** → the step renders as a **centred card**. This is the
   RIGHT choice, not a fallback, for steps about data-dependent screens (a
   specific task, a filled form) — a tour must never depend on particular data
   existing.

The engine also degrades safely: if a selector matches nothing within ~3 s
(slow load, permission-hidden element), the step shows centred instead of
hanging the tour.

**Copy rules (what makes these guides work for non-technical users):**

- Write to *you*, present tense: "Click Start Work", never "The user should…".
- Name screen text verbatim: **Mark as Complete**, not "the completion action".
- One idea per step. If a body needs a third sentence to change subject, that
  is a second step.
- Say what the system does *for* them ("the task goes to the approver by
  itself — you never chase anyone"), because that is what replaces training.
- Steps should read correctly even with zero data on screen.

### 3.4 Role filtering

`roles: null` → everyone. Otherwise an array of role keys
(`md | ea | manager | employee | viewer` — from `core/constants` ROLES).
Filter on what the guide *teaches*: if it teaches an approve button, Viewers
and Employees must not see it.

---

## 4. Conventions per module

Every module should ship, in this order:

1. **Orientation** (`roles: null`) — where things live. First, always.
2. **The doer flow** — the end-to-end "your work arrived → it is approved" walk.
3. **The manager/decision flow** — creating, reviewing, approving.
4. **Reading guides** (`roles: null`) — reports, exports.
5. Feature guides (AI, vendors…) as needed.

Order in the array = display order. Lead with what a brand-new person needs
first.

---

## 5. Engine behaviours you get for free

- Cross-page tours: a step's `route` navigates, then the spotlight waits for
  the element (poll ≈3 s) and scrolls it into view centre.
- The spotlight tracks its element through scrolling and resizing.
- Smooth animated transitions between targets; `prefers-reduced-motion`
  disables all animation.
- Auto-play: per-guide pace, visible countdown bar, pause/resume, stops at the
  end. Manual clicks work during auto-play; the timer restarts per step.
- Keyboard: ← → step, Esc exits. Progress dots are clickable.
- Dimmed areas swallow clicks (no accidental app interaction mid-tour); the
  spotlit element itself stays visually pristine.

---

## 6. Checklist for "add guides for module X"

- [ ] Register the module in `guides.js` with an orientation guide.
- [ ] One guide per real user journey, roles declared honestly.
- [ ] `data-guide` attributes added for any non-nav element a step spotlights.
- [ ] Every step readable with an empty database.
- [ ] Role check: log in as each role the module serves; the centre must show
      only what that role can actually click.
- [ ] Search check: the module's key nouns (e.g. "lead", "follow-up") appear in
      step text so search finds them.
