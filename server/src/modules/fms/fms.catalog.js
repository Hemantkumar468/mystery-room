/**
 * THE WORK EACH FMS HANDS OUT — every recurring job, by the step it belongs to.
 *
 * This is the list the Settings → FMS · Assign Work screen draws, and the
 * list the task builder consults to decide who a newly created task goes to.
 *
 * WHY IT IS KEYED BY (stageKey, taskKey) AND NOTHING ELSE. Those two are what
 * a Task already carries from the template it was made from, so an assignment
 * saved here matches the task without a translation table in between. Every
 * other candidate key was worse: a title is prose and gets edited, a formKey
 * only exists on the four assessments, and a position in a list moves the day
 * somebody reorders a phase.
 *
 * WHAT IT IS NOT. It is not permission — Access Control decides who may OPEN
 * Step 3. This decides who the work is GIVEN to. The two are genuinely
 * different questions: a regional head may need to see every assessment
 * without a single one being addressed to them, and an assessor needs their
 * four jobs without being able to reach the commercial documents at all.
 *
 * DOERS AND BUDDIES, because the client's own flow works that way. A job goes
 * to one or more doers — whoever finishes it first closes it for the rest
 * (task.service#myTasks) — and a buddy is the person who covers it. Buddies
 * become the task's watchers, so they see it and can pick it up, without it
 * sitting in their own list as work they owe.
 *
 * PROPERTY CAPTURING AND PURCHASE ARE FILLED IN. IMS is still declared empty
 * rather than guessed at; adding it is a matter of listing its template task
 * keys here, and the screen and the resolver pick them up with no further
 * change.
 */

export const FMS_CATALOG = Object.freeze([
  {
    key: 'property',
    label: 'Property Capturing FMS',
    hint: 'From a site first walked to the project created against it.',
    steps: [
      {
        key: 'property-capture',
        label: 'Step 1 · All Properties',
        hint: 'Every site in front of us, however it arrived.',
        items: [
          {
            key: 'p1:p1_capture',
            stageKey: 'p1',
            taskKey: 'p1_capture',
            label: 'Capture each property',
            hint: 'Visit the site and file it — area, floor, terms, owner, photos, GPS.',
          },
        ],
      },
      {
        key: 'property-md-review',
        label: 'Step 2 · MD Review & Decision',
        hint: 'Which road a filed property takes.',
        items: [
          {
            key: 'p1:p1_shortlist',
            stageKey: 'p1',
            taskKey: 'p1_shortlist',
            label: 'Shortlist or reject each property',
            hint: 'The decision that opens the assessment or commercial forms.',
          },
        ],
      },
      {
        key: 'property-assessment',
        label: 'Step 3 · All Property Assessment',
        hint: 'The four site evaluations. One task per property, per assessment.',
        items: [
          {
            key: 'p2:p2_feasibility', stageKey: 'p2', taskKey: 'p2_feasibility', formKey: 'feasibility', label: 'Feasibility assessment',
          },
          {
            key: 'p2:p2_financial', stageKey: 'p2', taskKey: 'p2_financial', formKey: 'financial', label: 'Financial assessment',
          },
          {
            key: 'p2:p2_technical', stageKey: 'p2', taskKey: 'p2_technical', formKey: 'technical', label: 'Technical assessment',
          },
          {
            key: 'p2:p2_operational', stageKey: 'p2', taskKey: 'p2_operational', formKey: 'operational', label: 'Operational assessment',
          },
        ],
      },
      {
        key: 'property-selection',
        label: 'Step 4 · MD Review & Approval',
        hint: 'One site taken forward per project.',
        items: [
          {
            key: 'p2:p2_decision',
            stageKey: 'p2',
            taskKey: 'p2_decision',
            label: 'Select the final property',
          },
        ],
      },
      {
        key: 'property-commercial',
        label: 'Step 5 · All Property Commercial',
        hint: 'The documents that close the site. One task each.',
        items: [
          {
            key: 'p3:p3_t1', stageKey: 'p3', taskKey: 'p3_t1', label: 'Letter of Intent (LOI)',
          },
          {
            key: 'p3:p3_t2', stageKey: 'p3', taskKey: 'p3_t2', label: 'Lease agreement',
          },
          {
            key: 'p3:p3_t3', stageKey: 'p3', taskKey: 'p3_t3', label: 'Legal check & title due diligence',
          },
          {
            key: 'p3:p3_t4', stageKey: 'p3', taskKey: 'p3_t4', label: 'Security deposit & token payment',
          },
          {
            key: 'p3:p3_t5', stageKey: 'p3', taskKey: 'p3_t5', label: 'NOCs & statutory approvals',
          },
        ],
      },
      {
        key: 'property-planning',
        label: 'Step 6 · All Project Creation',
        hint: 'Games, dates, and the project itself.',
        items: [
          {
            key: 'p20:p20_games', stageKey: 'p20', taskKey: 'p20_games', label: 'Select the games for this outlet',
          },
        ],
      },
    ],
  },

  /**
   * PURCHASE — a BOQ line from written down to received.
   *
   * SIX STEPS, SIX JOBS, and until now three of them were one task. "Send
   * every PO and keep the tracker honest" covered choosing the vendor,
   * raising the order AND chasing the delivery, so naming a person for the
   * vendor step also handed them the chasing — which is why procurement
   * work could not be split across a team here the way property work can.
   * The template now carries one task per step (clientFlowTemplate.js) and
   * these are those tasks.
   *
   * The stage keys look odd together and are correct: the BOQ is written and
   * checked in Phase 5 (p13), and everything after it happens in Phase 6
   * (p15). The split is where the business actually hands over — the BOQ is
   * the project manager's document, the orders are procurement's.
   */
  {
    key: 'purchase',
    label: 'Purchase FMS',
    hint: 'From a BOQ line written down to the goods booked in at site.',
    steps: [
      {
        key: 'purchase-boq',
        label: 'Step 1 · BOQ',
        hint: 'One line per thing to buy, with quantity, rate and drawing.',
        items: [
          {
            key: 'p13:p13_t1',
            stageKey: 'p13',
            taskKey: 'p13_t1',
            formKey: 'boq-build',
            label: 'Build the BOQ',
            hint: 'Write the lines — item, quantity, rate, vendor.',
          },
        ],
      },
      {
        key: 'purchase-check',
        label: 'Step 2 · Check the BOQ',
        hint: 'Approve each line, or send it back with a reason.',
        items: [
          {
            key: 'p13:p13_t2',
            stageKey: 'p13',
            taskKey: 'p13_t2',
            formKey: 'boq-check',
            label: 'Check and approve the BOQ',
            hint: 'The gate the whole purchase flow waits on — only an approved line can be given a vendor.',
          },
        ],
      },
      {
        key: 'purchase-vendor',
        label: 'Step 3 · Choose the vendor',
        hint: 'Pick the supplier and agree the rate, per approved line.',
        items: [
          {
            key: 'p15:p15_vendor',
            stageKey: 'p15',
            taskKey: 'p15_vendor',
            formKey: 'po-vendor',
            label: 'Choose the vendor',
          },
        ],
      },
      {
        key: 'purchase-po',
        label: 'Step 4 · Raise the PO',
        hint: 'Raise the order, check the document, send it by WhatsApp or email.',
        items: [
          {
            key: 'p15:p15_t1',
            stageKey: 'p15',
            taskKey: 'p15_t1',
            formKey: 'po-raise',
            label: 'Raise and send the PO',
          },
        ],
      },
      {
        key: 'purchase-tracking',
        label: 'Step 5 · Tracking',
        hint: 'Keep each order current until it reaches the door.',
        items: [
          {
            key: 'p15:p15_track',
            stageKey: 'p15',
            taskKey: 'p15_track',
            formKey: 'po-tracking',
            label: 'Track the delivery',
          },
        ],
      },
      {
        key: 'purchase-grn',
        label: 'Step 6 · Goods received (GRN)',
        hint: 'Count what arrived against what was ordered, and book it in.',
        items: [
          {
            key: 'p15:p15_t3',
            stageKey: 'p15',
            taskKey: 'p15_t3',
            formKey: 'po-grn',
            label: 'Receive goods and record the GRN',
          },
        ],
      },
    ],
  },

  /**
   * NEW GAMES CREATION FMS. Not project work: a game is built once, centrally.
   * `ng` is not a template stage — these keys are read by
   * modules/newGames/newGame.service.js, which takes each step's people from
   * here unless a game names its own. Step 5 (order & receive) is not here:
   * it runs in the Purchase FMS, whose jobs are listed above.
   */
  {
    key: 'new-games',
    label: 'New Games Creation FMS',
    hint: 'A new game from the indent form to the Games master.',
    steps: [
      {
        key: 'ng-video', label: 'Step 2 · Watch the video', hint: 'Everyone named here watches the reference video.',
        items: [{ key: 'ng:ng_video', stageKey: 'ng', taskKey: 'ng_video', label: 'Watch the reference video' }],
      },
      {
        key: 'ng-boq', label: 'Step 3 · Make the BOQ', hint: 'One BOQ per category, with its lead time.',
        items: [{ key: 'ng:ng_boq', stageKey: 'ng', taskKey: 'ng_boq', label: 'Make the BOQs' }],
      },
      {
        key: 'ng-check', label: 'Step 4 · Check the BOQ', hint: 'Approve each BOQ, or reject it with a reason.',
        items: [{ key: 'ng:ng_check', stageKey: 'ng', taskKey: 'ng_check', label: 'Check and approve the BOQs' }],
      },
      {
        key: 'ng-assemble', label: 'Step 6 · Assemble', hint: 'Put the room together once the goods are in.',
        items: [{ key: 'ng:ng_assemble', stageKey: 'ng', taskKey: 'ng_assemble', label: 'Assemble the game' }],
      },
      {
        key: 'ng-testing', label: 'Step 7 · Testing & quality test', hint: 'Play it end to end and check every machine.',
        items: [{ key: 'ng:ng_testing', stageKey: 'ng', taskKey: 'ng_testing', label: 'Test the game and check its quality' }],
      },
    ],
  },
]);

/** Every item, flat, each carrying the FMS and step it sits in. */
export const ALL_ITEMS = Object.freeze(
  FMS_CATALOG.flatMap((fms) => fms.steps.flatMap((step) => step.items.map((item) => ({
    ...item, fms: fms.key, fmsLabel: fms.label, step: step.key, stepLabel: step.label,
  })))),
);

const BY_KEY = new Map(ALL_ITEMS.map((i) => [i.key, i]));

export const itemFor = (key) => BY_KEY.get(key) ?? null;
export const isKnownItem = (key) => BY_KEY.has(key);

/** The key a Task resolves to — the same two fields it already carries. */
export const itemKeyOf = (stageKey, taskKey) => `${stageKey}:${taskKey}`;

export default FMS_CATALOG;
