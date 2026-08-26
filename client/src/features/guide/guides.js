/**
 * The user-guide registry — every module, guide and tour step in one place.
 *
 * This file is DATA. The engine (GuideContext.jsx) and the centre
 * (UserGuidePage.jsx) render whatever is registered here, so adding a guide —
 * or a whole module when CRM/HRMS arrive — is an edit to this file only.
 * The full authoring manual lives in docs/USER_GUIDE_SYSTEM.md.
 *
 * A tour step:
 *   {
 *     title:     one short line — what this step is about
 *     body:      2–4 plain sentences. Write for someone who has never seen the
 *                system. Name buttons exactly as they appear on screen.
 *     route?:    navigate here before showing the step ('/my-tasks')
 *     selector?: CSS selector to SPOTLIGHT. Prefer stable anchors:
 *                a[href="/x"] for nav links, [data-guide="x"] for buttons.
 *                Omit it and the step shows as a centred card — the right
 *                choice for steps about pages that need live data (a specific
 *                task, a specific project).
 *   }
 *
 * `roles: null` = everyone. Otherwise list who the guide is FOR — the centre
 * hides what a role cannot do, so a Viewer is never taught buttons they
 * don't have.
 */

export const GUIDE_MODULES = [
  {
    key: 'pms',
    label: 'PMS — Store Launch',
    description: 'Opening a new Mystery Rooms centre, from finding the property to going live.',
    guides: [
      {
        key: 'orientation',
        title: 'Find your way around',
        description: 'The sidebar, your tasks, and where everything lives. Start here on day one.',
        roles: null,
        autoAdvanceMs: 9000,
        steps: [
          {
            title: 'Welcome to Mystery Rooms PMS',
            body: 'This system runs the whole journey of opening a new centre — every phase, every task, every approval. This short tour shows you where things live. You can pause it, click through at your own pace, or let it play by itself.',
          },
          {
            title: 'My Tasks — your own work',
            body: 'Everything assigned to YOU, in one list. Most days this is the only page you need: open it, see what is due, click a task, do it. The number badge shows what is due today or overdue.',
            selector: 'a[href="/my-tasks"]',
          },
          {
            title: 'Projects — every store opening',
            body: 'Each new centre is one project. Open a project and its phases appear in the sidebar — Property Research, Site Evaluation, and so on, in order. Green ticks mean a phase is finished.',
            selector: 'a[href="/projects"]',
          },
          {
            title: 'Plan vs Actual — the whole story on one page',
            body: 'For any project: every phase, who does it, when it was planned, and when it actually happened. Click any phase there to see everything filled in it, and export it to Excel.',
            selector: 'a[href="/plan-vs-actual"]',
          },
          {
            title: 'Approvals — decisions waiting on you',
            body: 'Work that someone finished and now needs a sign-off. If you are a Manager, EA or the MD, check this daily — the badge is the number of people waiting on your decision.',
            selector: 'a[href="/approvals"]',
          },
          {
            title: 'Vendors — the vendor master',
            body: 'Every vendor across every project: contacts, GST, ratings and status. Onboard new vendors here and they appear wherever vendors are picked.',
            selector: 'a[href="/vendors"]',
          },
          {
            title: 'That is the map',
            body: 'Everything else you will meet — forms, checklists, approvals — is explained by its own guide in this User Guide section. Pick the one that matches what you are about to do.',
          },
        ],
      },

      {
        key: 'doer-flow',
        title: 'Do your assigned task, end to end',
        description: 'From "a task appeared in My Tasks" to "it is approved" — the exact clicks, in order.',
        roles: ['employee', 'manager', 'ea', 'md'],
        autoAdvanceMs: 11000,
        steps: [
          {
            title: 'Start in My Tasks',
            body: 'When a project is created, the template assigns work automatically — your tasks simply appear here with a due date. Nothing to set up. Click any task to open it.',
            route: '/my-tasks',
            selector: 'a[href="/my-tasks"]',
          },
          {
            title: 'Read the task brief',
            body: 'At the top of every task is "WHAT YOU NEED TO DO" — what the task is, who does it, by when, and how. Below it, the site’s own details (area, floor, photos) are one click away, so you never hunt for facts.',
          },
          {
            title: 'Click Start Work',
            body: 'Top-right of the task. This tells everyone — including the Plan vs Actual report — that the work has actually begun. The status moves to "In Progress".',
          },
          {
            title: 'Submit the form',
            body: 'If the task asks for information — a property, a drawing, a BOQ line — the orange "Submit …" button in the brief opens the right form here. Fields the system already knows (area, dates, vendor details) come pre-filled. Look for the ✨ buttons: AI can draft text for you, and you edit it.',
          },
          {
            title: 'Tick the checklist',
            body: 'Scroll to the Checklist. Items marked with a red * are the important ones. An open checklist never blocks you: if you click "Mark as Complete" with items still unticked, it tells you which ones and asks whether to finish anyway — take "Go Back" and it highlights them here, or complete the task and they stay on it as pending.',
          },
          {
            title: 'Mark as Complete',
            body: 'Once the form is in and the checklist ticked. Your part is now DONE — the task goes to the named approver by itself ("Waiting for approval by MD" tells you who). You never chase anyone.',
          },
          {
            title: 'If changes are requested',
            body: 'The reviewer must give a reason, and the task comes back to you as "Changes requested" with that reason on it. Fix it, resubmit, done. One approval finishes it — there is no second or third round of sign-offs.',
          },
        ],
      },

      {
        key: 'md-create-project',
        title: 'Create a project — the template does the rest',
        description: 'One short form, and every phase, task, owner and deadline is generated automatically.',
        roles: ['md', 'ea', 'manager'],
        autoAdvanceMs: 10000,
        steps: [
          {
            title: 'One form starts everything',
            body: 'Decide the city, click New Project, fill the short form — name, city, dates, budget, owner. That is the whole setup.',
            route: '/projects',
            selector: '[data-guide="new-project"]',
          },
          {
            title: 'Choose the workflow',
            body: 'The form ends with two cards: "Use the standard flow" (recommended — the full Branch Opening playbook) or "Choose a different one" for special cases like a franchise fast-track. The standard flow is right almost every time.',
          },
          {
            title: 'The template runs itself',
            body: 'On Create, every phase appears with every task already assigned — owner, backup buddy, lead time, checklist. ~74 tasks from one form. Each person’s work lands in their My Tasks with a due date; nobody hand-allocates anything.',
          },
          {
            title: 'Watch it in Plan vs Actual',
            body: 'Pick the project here to see the whole plan — and, as work happens, what actually happened against it, phase by phase, in plain words like "Finished 2 days early".',
            route: '/plan-vs-actual',
            selector: 'a[href="/plan-vs-actual"]',
          },
          {
            title: 'Where you come back in',
            body: 'The system brings decisions to you: Approvals for sign-offs, the three gates (property, LOI, launch) for the big yes/no moments, and phase pages’ "Mark phase complete" when a phase’s work is approved.',
            selector: 'a[href="/approvals"]',
          },
        ],
      },

      {
        key: 'review-approve',
        title: 'Review and approve work',
        description: 'Where submissions wait, how to approve or send back, and what your decision does.',
        roles: ['md', 'ea', 'manager'],
        autoAdvanceMs: 10000,
        steps: [
          {
            title: 'Approvals is your queue',
            body: 'Everything waiting on a decision from someone like you, across all projects. The badge is the live count.',
            route: '/approvals',
            selector: 'a[href="/approvals"]',
          },
          {
            title: 'Or review inside the phase',
            body: 'On any phase page, submitted records show "Waiting for review" with a Review button. It opens the submission exactly as it was filled — every field, every attachment — with Approve and Request changes at the bottom.',
          },
          {
            title: 'One approval is final',
            body: 'Your approval finishes the task or record — there is no second "management" round. The template names who approves what, and nobody can approve their own work (the MD excepted, by design).',
          },
          {
            title: 'Sending back requires a reason',
            body: 'Request changes asks you what needs to change, and the doer sees exactly that on the returned item. A rejection without a reason is not possible — it would be unusable to the person who has to act on it.',
          },
          {
            title: 'Closing a phase',
            body: 'When a phase’s submissions are approved, its page shows "Mark phase complete" in the Phase status card. If something is still outstanding, clicking it tells you precisely what, in a sentence.',
          },
        ],
      },

      {
        key: 'order-tracker',
        title: 'Phase 6 — send purchase orders and track deliveries',
        description: 'One sheet for every order: sent when, where it is, what arrived, and who updated it.',
        roles: null,
        autoAdvanceMs: 10000,
        steps: [
          {
            title: 'Every BOQ line is a purchase order',
            body: 'Phase 5 builds the BOQ — one line per thing to buy. Phase 6 never asks you to type those orders again: open the project, click Phase 6, and every line is already a row on the sheet.',
          },
          {
            title: 'Step 1 — Send it',
            body: 'Rows that have not gone out show a "Send order" button. It opens the purchase order, ready to send by WhatsApp or email. The moment you send, the sheet records the time, the channel and the PO number — and the status becomes Ordered.',
            selector: '[data-guide="pt-order"]',
          },
          {
            title: 'Step 2 — Keep the status true',
            body: 'The Status dropdown on each row is the whole tracker: Ordered → Dispatched → Delivered → Received (GRN). Pick what the vendor tells you. Dates you would otherwise type (dispatched on, received on) are filled in for you.',
            selector: '[data-guide="pt-status"]',
          },
          {
            title: 'Step 3 — Update the details',
            body: 'Click anywhere on a row to open that order on its own page — everything about it in one place, editable there. Or click Update on the row to add the indent number, the vendor’s promised date, the delivery challan / LR number and — on delivery — the quantity received and the GRN number. Ordered 100, received 80? The sheet shows 20 pending and sets "Partly Received" itself.',
            selector: '[data-guide="pt-update"]',
          },
          {
            title: 'Late orders show in red',
            body: 'When a promised date passes and the order has not arrived, the row says "Late N days". The Late chip at the top lists them all.',
          },
          {
            title: 'Who changed what',
            body: 'The clock icon on a row opens its history: every change, who made it and when — and the send log. Nothing is ever overwritten silently.',
          },
          {
            title: 'What to chase today',
            body: 'The AI card reads the sheet and lists the orders that need a nudge, each with a short message you can copy straight into WhatsApp. It only uses what is on the sheet and never changes anything.',
            selector: '[data-guide="pt-ai"]',
          },
          {
            title: 'Export to Excel',
            body: 'Everything on the sheet, with the filters you have applied, as a spreadsheet — for a vendor review or the MD’s meeting.',
            selector: '[data-guide="pt-export"]',
          },
        ],
      },

      {
        key: 'plan-vs-actual',
        title: 'Read the Plan vs Actual report',
        description: 'Who does what, planned against actual, and everything filled — exportable to Excel.',
        roles: null,
        autoAdvanceMs: 9000,
        steps: [
          {
            title: 'Open Plan vs Actual',
            body: 'Pick the project you want. The most recently worked-on is first, and you can search by name, code or city.',
            route: '/plan-vs-actual',
            selector: 'a[href="/plan-vs-actual"]',
          },
          {
            title: 'One row per phase',
            body: 'Each row: the phase, WHO does it (real names), the PLANNED window with its day count, the ACTUAL window, and the result in plain words — "Finished 2 days early", "Took 3 days longer than planned". Phases that run in parallel say so.',
          },
          {
            title: 'Click a phase to open it in place',
            body: 'You get the full What/Who/When/How table and "What was filled in this phase" — every record with its values, status, and when it was last touched.',
          },
          {
            title: 'Export to Excel',
            body: 'One click inside any opened phase. The export carries EVERY field of every record — not just the visible columns — and opens cleanly in Excel, ₹ signs and all.',
          },
        ],
      },

      {
        key: 'vendors-po',
        title: 'Vendors and purchase orders',
        description: 'Onboard a vendor once, then raise, print and send purchase orders against them.',
        roles: ['md', 'ea', 'manager', 'employee'],
        autoAdvanceMs: 10000,
        steps: [
          {
            title: 'The vendor master',
            body: 'Every vendor across every project. Filter by category or status, search by name, phone or GST, and open any row for the full record.',
            route: '/vendors',
            selector: 'a[href="/vendors"]',
          },
          {
            title: 'Add Vendor — once',
            body: 'Top-right. Pick which project engages them, fill their details — contacts, GST, bank, rating. From then on they are PICKED everywhere (BOQ lines, purchase orders), never retyped.',
          },
          {
            title: 'A BOQ line becomes a purchase order',
            body: 'In a project’s BOQ phase, every line has an Order button. It opens a branded PO document — the vendor’s details fetched automatically from the master — ready to preview and download as PDF.',
          },
          {
            title: 'The orange button takes you to sending',
            body: 'On the PO page, the top-right card leads with “Send to vendor — WhatsApp & Email”. One click scrolls you to the composer: Email on the left (To, CC, BCC, subject, body, attachments), WhatsApp on the right (number and message), both ticked by default.',
          },
          {
            title: 'When it arrives: the GRN',
            body: 'On the order page, “Record receipt (GRN)” opens a pre-filled form: who received (you), when (today), how much of what was ordered — enter 80 of 100 and the pending 20 and the “Partly Received” status work themselves out. Attach photos of the goods and the challan; the proof lives on the order forever.',
          },
          {
            title: 'From GRN to invoice',
            body: 'Once a GRN exists, the order page shows “Invoice”. It opens a branded invoice billing exactly what was RECEIVED at the approved rate, quoting the GRN as evidence — preview the PDF, then send it by Email and WhatsApp from the same split composer, AI-drafted and logged like every other send.',
          },
          {
            title: 'Write it with AI, send with one button',
            body: 'Each side has its own ✨ chips — formal, Hindi, "mention 50% advance" — and you verify before anything goes. One Send button fires whichever channels are ticked: email sends in place, WhatsApp opens ready to press send. Every send is logged on the order.',
          },
        ],
      },

      {
        key: 'ai-everywhere',
        title: 'Where AI helps you',
        description: 'Every place the ✨ appears, what it does, and the one rule it always follows.',
        roles: ['md', 'ea', 'manager', 'employee'],
        autoAdvanceMs: 10000,
        steps: [
          {
            title: 'The one rule first',
            body: 'AI in this system drafts and suggests — a person always verifies and decides. Nothing AI writes is saved or sent until you do it. And it may never invent facts: numbers and dates come from your data or not at all.',
          },
          {
            title: 'Property analysis',
            body: 'On any captured property: a full location report — competition, footfall, audience, risks — with a confidence score and cited sources, saved with a PDF download. Run once, kept forever.',
          },
          {
            title: 'Assessment pre-fill',
            body: 'Opening a Feasibility or Operational assessment offers "Draft with AI": the form comes back filled from the property’s research, every field editable. Financial and Technical stay human — deliberately.',
          },
          {
            title: 'Design ideas',
            body: 'On a drawing task: "Get design ideas" suggests how the space could be zoned — how many games fit, what goes where, what to confirm on site — from the site’s real area, floor and photos. Saved, so viewing it twice is free.',
          },
          {
            title: 'Writing help in forms',
            body: 'Textareas with ✨ Suggest / Improve draft or polish text from the rest of the form — the BOQ description, planning notes. Your words stay yours; Improve keeps every fact you typed.',
          },
          {
            title: 'Message writer',
            body: 'On purchase orders: "Write with AI" composes the vendor message for WhatsApp or email. Style chips (Formal, Hindi, Short…) plus your own instruction line shape it; you always read it before sending.',
          },
        ],
      },

      {
        key: 'network-map-intel',
        title: 'The map that thinks — Network Map',
        description: 'Your whole network on one map, plus the AI that researches cities and tells you where to open next.',
        roles: ['md', 'ea', 'manager', 'viewer'],
        autoAdvanceMs: 10000,
        steps: [
          {
            title: 'The network at a glance',
            body: 'Open Network Map from the sidebar. India first: one pin per city with its count. Green is live, amber is being opened, red is running late. Click a city to drop into it — real satellite imagery, one pin per site, exactly where its GPS was captured.',
            selector: 'a[href="/network-map"]',
          },
          {
            title: 'The ✨ Intelligence button',
            body: 'Top-left of the map. This is what makes this more than a map: it researches markets for you, with live web search — not from memory.',
            selector: '[data-guide="map-intel-fab"]',
          },
          {
            title: 'Ask the Map — any question, researched',
            body: 'The Ask tab is a research analyst in a box. “Are there escape rooms within 5 km of this centre?” — “Where are we paying the highest rent?” Your own data answers exactly; the live web answers the rest. What the answer talks about appears as violet pins on the map — dashed when the location is approximate — and every claim carries a confidence level and an honest “could not verify” note.',
          },
          {
            title: 'Market Scout — should we open here?',
            body: 'Type any city (or click one first) and press Scout. In about 20 seconds: the demand story, every escape-room competitor it can verify by name, the 3–5 localities worth physically walking, the realistic rent range, the risks, and a straight verdict. It already knows what your own PMS has scouted there.',
          },
          {
            title: 'Expansion Radar — where next?',
            body: 'One button: AI weighs the network you already have against live market data and ranks the next six cities — each with why, the one thing to watch out for, and which areas to scout first. “See on map” flies you straight there. The answer is kept for six hours; “Fresh” re-researches.',
          },
          {
            title: 'The catchment check — automatic',
            body: 'Click any site pin and the panel shows the nearest existing centre and the distance. Under 3 km it warns you: two centres that close eat each other’s footfall. Pure geometry, instant, no AI needed.',
          },
          {
            title: 'Trust it the right way',
            body: 'The scout and radar are researched, not invented — but they are a first pass, not a signature. Send the property consultant to the areas it names; the map tells you where to look, the ground tells you the truth.',
          },
        ],
      },
      {
        key: 'phases-map',
        title: 'The phases, at a glance',
        description: 'What each phase of a store opening is for, and the three gates between them.',
        roles: null,
        autoAdvanceMs: 12000,
        steps: [
          {
            title: 'The shape of an opening',
            body: 'Find a property → check it properly → sign it → plan the space → design and buy in parallel → build → verify → launch. Each arrow is a phase with named owners and deadlines, generated the day the project is created.',
          },
          {
            title: 'Phases 1–3: the property',
            body: 'Property Research captures every candidate site on a phone, with photos and GPS. Site Evaluation runs four expert assessments on the shortlist. Commercial Closure negotiates and signs the LOI and lease. Gate 1 (MD approves the property) and Gate 2 (LOI approved) sit here — Gate 2 unlocks everything downstream.',
          },
          {
            title: 'Phase 3B: plan the site',
            body: 'With the lease signed, the real plan: which games this outlet runs (picked against its actual area), the opening date the countdown runs to, construction and testing milestones, and the outline budget.',
          },
          {
            title: 'Phases 4–5: design and money, in parallel',
            body: 'Design & Drawings and Vendor Identification run AT THE SAME TIME — the rent-free fit-out window is too valuable to queue. Then BOQ, Budget & Gantt turns approved drawings and vendor rates into the plan the MD tracks; each BOQ line can become a purchase order.',
          },
          {
            title: 'Phases 6–11: build and verify',
            body: 'Procurement & Manufacturing runs parallel with Site Execution — the order tracker carries every delivery through to its GRN. Then Quality Check (fails get owners and deadlines), Assembly & Installation, and Testing & Trial Run — the centre is physically played until All-OK.',
          },
          {
            title: 'Phases 12–14: launch and learn',
            body: 'The Readiness Checklist is Gate 3 — every department signs off its own items before launch is possible. Branch Opening hands the finished centre to Operations. Closure & Delay Analysis records what ran to plan and what slipped, so the next opening is faster.',
          },
        ],
      },
    ],
  },

  {
    key: 'hrms',
    label: 'HRMS — Hiring',
    description: 'Raising a role, sharing the apply link, and closing it when you have enough people.',
    guides: [
      {
        key: 'apply-link',
        title: 'The apply link — share it, then close it',
        description: 'How the public job link works, how to set a closing date and time, and how to switch it off the moment you are done.',
        roles: ['md', 'ea', 'manager', 'employee'],
        steps: [
          {
            title: 'What the apply link is',
            body: 'Every requisition has one public link. Anyone who opens it sees the job and can apply — no login, no account. That is what makes it safe to paste into WhatsApp, a job portal or a poster QR code.',
            route: '/hrms/requisitions',
            selector: 'a[href="/hrms/requisitions"]',
          },
          {
            title: 'Open a role to find its link',
            body: 'Click any requisition in this list. On the right you will see a card called "Share the job". That card holds the link and every control for it.',
            route: '/hrms/requisitions',
          },
          {
            title: 'The green line tells you if it is on',
            body: 'The top of the card says Live, Turned off, Opens later or Closed, and then one sentence explaining exactly what someone opening the link right now would see. If it says Live, people can apply. If it does not, they cannot. There is nothing else to check.',
            selector: '[data-guide="apply-link-status"]',
          },
          {
            title: 'Give the link a closing date',
            body: 'Use "In 1 week", "In 2 weeks" or "In 1 month" for the usual cases — one click and it is set. Choose "Pick date & time" if you need an exact day and hour. The link then switches itself off at that moment, even if you are on leave.',
            selector: '[data-guide="apply-link-schedule"]',
          },
          {
            title: 'Or stop it right now',
            body: 'Got enough candidates today? Press "Stop accepting applications now". It takes effect immediately. The link still opens — it simply tells the person that applications have closed, which is far better than a page that does not load.',
            selector: '[data-guide="apply-link-kill"]',
          },
          {
            title: 'You can always turn it back on',
            body: 'Nothing here is permanent. The same button reads "Start accepting applications again" once the link is off, and "No end date" removes a closing date you no longer want. Candidates who already applied are never affected — they stay in the pipeline below.',
          },
          {
            title: 'What the candidate sees',
            body: 'While the link is live, a closing date is shown on the job page so nobody is timed out by a deadline they were never told about. After it closes, they get a short, polite page — "applications have closed", or "this role has been filled" — instead of a dead link.',
          },
        ],
      },
      {
        key: 'candidate-pipeline',
        title: 'From application to hired',
        description: 'Shortlisting, booking interviews, recording who was selected, and finishing the hire.',
        roles: ['md', 'ea', 'manager', 'employee'],
        steps: [
          {
            title: 'Everyone who applied is here',
            body: 'Candidates lists every application across every role. Click any row to open that person. You can also reach them from a requisition — click their name on the pipeline board.',
            route: '/hrms/candidates',
            selector: 'a[href="/hrms/candidates"]',
          },
          {
            title: 'The page tells you what to do next',
            body: 'Open any candidate. The "What happens next" box on the right is the whole page in one line — either the next interview and when it is, or a nudge that nothing is booked yet. If you only read one thing, read that.',
            route: '/hrms/candidates',
          },
          {
            title: 'Booking an interview',
            body: 'Press "Schedule an interview". Choose whether it is a phone call, a video call, an in-person meeting or the HR round, then pick the day and the time. Tick the box and the candidate is emailed the details automatically.',
            selector: '[data-guide="candidate-schedule"]',
          },
          {
            title: 'Rounds, not stages',
            body: 'You can book as many rounds as the role needs — a first call, a panel, then HR. Each one keeps its own time, its own interviewer and its own verdict, so nothing gets overwritten by the next round.',
          },
          {
            title: 'After the interview',
            body: 'Press "Record the outcome" on that round and choose Selected, Not selected, or Did not attend. Add notes and a score out of 5 if you want. This is only about that one conversation.',
          },
          {
            title: 'Rejecting the person is separate',
            body: 'Marking a round "Not selected" does NOT reject the candidate — panels disagree, and one bad round is not always the end. To actually turn someone down, use Reject at the top of the page. It asks for a reason, on purpose.',
          },
          {
            title: 'Moving them forward',
            body: 'The button at the top always says the next step in plain words — "Shortlist for screening", then "Move to interview", "Make an offer", "Mark as hired". One click each; you never pick from a list of statuses.',
          },
          {
            title: 'Taking it out of the system',
            body: 'On the candidate page, "Save as PDF" gives you one person on paper — or as a file — for an interview panel. On the Candidates list, "Download as CSV" gives you everyone matching your current search and filter — exactly what is on screen, nothing wider.',
          },
        ],
      },
    ],
  },

  /* Future modules (CRM, HRMS, Inventory…) register here — one object each,
     same shape. See docs/USER_GUIDE_SYSTEM.md for the checklist. */
];

/** Guides one role may see: `roles: null` means everyone. */
export const guidesForRole = (module, role) =>
  module.guides.filter((g) => !g.roles || g.roles.includes(role));

export default GUIDE_MODULES;
