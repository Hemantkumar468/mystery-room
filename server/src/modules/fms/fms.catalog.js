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
 * PROPERTY CAPTURING IS THE ONE FILLED IN. Purchase and IMS are declared
 * empty rather than guessed at; adding them is a matter of listing their
 * template task keys here, and the screen and the resolver pick them up with
 * no further change.
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
