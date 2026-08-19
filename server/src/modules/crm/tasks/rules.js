import {
  CRM_EVENT, TASK_TYPE, TASK_PRIORITY, ENTITY_TYPE,
  FIRST_CALL_DUE_MINUTES, QUIET_AFTER_DAYS,
} from '../crm.constants.js';

/**
 * What the system decides somebody owes, and when.
 *
 * DATA, NOT CODE-IN-A-SWITCH. Each rule is an object with a trigger, an
 * optional condition and a task template, so the set can be read top to bottom
 * by somebody who does not write JavaScript — and so moving one to a database
 * table later is a change of source, not a rewrite of the engine.
 *
 * WHY EACH RULE EXISTS, since a rule nobody can justify is a rule that
 * eventually gets switched off in irritation:
 *
 *   first call in 2h   — speed to first contact predicts conversion better than
 *                        anything else the CRM measures
 *   demo → follow-up   — the day after a demo is when interest is highest and
 *                        most often wasted
 *   negotiation → send — a proposal that is late is a proposal a competitor
 *                        answers first
 *   quiet for 3 days   — the single cheapest save available: most stalled
 *                        records are not lost, just forgotten
 *   won → onboarding   — the handover nobody owns is the one that goes wrong
 *
 * `dedupeKey` is what stops a rule firing twice for the same record. Without
 * it, a lead nudged through three statuses in an afternoon collects three
 * identical "call them" tasks and the agent stops reading their list.
 */

/** Tomorrow at a given hour, local time. */
function tomorrowAt(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Today at a given hour — or right now, if that hour has already passed.
 *  A task created at 4pm and due at 10am is overdue the moment it exists. */
function todayAt(hour) {
  const d = new Date();
  if (d.getHours() >= hour) return new Date(Date.now() + 60 * 60_000);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const inMinutes = (n) => new Date(Date.now() + n * 60_000);

export const TASK_RULES = Object.freeze([
  {
    key: 'first-call',
    on: CRM_EVENT.LEAD_CREATED,
    task: (ctx) => ({
      title: `Call ${ctx.record.name}`,
      type: TASK_TYPE.CALL,
      priority: TASK_PRIORITY.HIGH,
      dueAt: inMinutes(FIRST_CALL_DUE_MINUTES),
      // Reminded 30 minutes before it is late, because a task due in two hours
      // that is only announced when it is due has already failed.
      reminderOffsetMinutes: 30,
      notes: ctx.record.message
        ? `They said: "${String(ctx.record.message).slice(0, 300)}"`
        : undefined,
    }),
  },

  {
    key: 'demo-followup',
    on: CRM_EVENT.DEAL_STAGE_CHANGED,
    when: (ctx) => /demo/i.test(ctx.stageName || ''),
    task: (ctx) => ({
      title: `Follow up on the demo — ${ctx.record.title}`,
      type: TASK_TYPE.FOLLOW_UP,
      priority: TASK_PRIORITY.HIGH,
      dueAt: tomorrowAt(10),
      reminderOffsetMinutes: 60,
    }),
  },

  {
    key: 'send-proposal',
    on: CRM_EVENT.DEAL_STAGE_CHANGED,
    when: (ctx) => /negotiation/i.test(ctx.stageName || ''),
    task: (ctx) => ({
      title: `Send the proposal — ${ctx.record.title}`,
      type: TASK_TYPE.DOCUMENT,
      priority: TASK_PRIORITY.HIGH,
      dueAt: todayAt(17),
      reminderOffsetMinutes: 60,
    }),
  },

  {
    key: 'onboarding-handover',
    on: CRM_EVENT.DEAL_STAGE_CHANGED,
    when: (ctx) => ctx.isWon,
    task: (ctx) => ({
      title: `Onboarding handover — ${ctx.record.title}`,
      type: TASK_TYPE.MEETING,
      priority: TASK_PRIORITY.NORMAL,
      dueAt: tomorrowAt(11),
      reminderOffsetMinutes: 60,
    }),
  },

  {
    key: 're-engage',
    on: CRM_EVENT.RECORD_WENT_QUIET,
    task: (ctx) => ({
      title: `Nothing for ${QUIET_AFTER_DAYS} days — re-engage ${ctx.record.name || ctx.record.title}`,
      type: TASK_TYPE.CALL,
      priority: TASK_PRIORITY.NORMAL,
      dueAt: todayAt(16),
      reminderOffsetMinutes: 30,
      notes: 'Nobody has logged anything against this record. A short call now is '
        + 'usually the difference between a slow deal and a dead one.',
    }),
  },
]);

/**
 * The key that identifies "this rule, for this record".
 *
 * Deliberately excludes the date: the point is that `re-engage` fires ONCE per
 * quiet record, not once per day it stays quiet — which is how a to-do list
 * becomes a wall of identical rows that people close without reading.
 */
export const dedupeKey = (rule, entityType, entityId) => `${rule.key}:${entityType}:${entityId}`;

/** Rules listening for one event. */
export const rulesFor = (event) => TASK_RULES.filter((r) => r.on === event);

export { ENTITY_TYPE };
export default TASK_RULES;
