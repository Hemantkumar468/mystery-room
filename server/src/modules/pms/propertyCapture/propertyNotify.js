import { notificationService } from '../notifications/notification.service.js';
import { User } from '../../auth/auth.model.js';
import { LEADERSHIP } from '../../../core/constants/index.js';
import { logger } from '../../../config/logger.js';

/**
 * EVERY NOTIFICATION THE PROPERTY FMS SENDS, WRITTEN IN ONE PLACE.
 *
 * WHY A TEMPLATE FILE AND NOT A STRING AT EACH CALL SITE. The bell filled up
 * with whatever sentence a caller happened to pass — "Escalated (19522%):
 * ZZTKT-93CZ9 Half way" is a real one. Every word of that is true and none of
 * it tells the reader what they are supposed to do. A person glancing at a
 * bell has about two seconds, and in that time a notification has to answer
 * four questions:
 *
 *   WHAT happened          "Feasibility assessment is yours"
 *   WHICH thing            "gandhi naagr · Amritsar"
 *   WHO caused it          "Assigned by Prateek"
 *   WHAT to do, and by when "Fill it in from My Tasks — due 20 Oct"
 *
 * Those four are the `title`, `entity`, `actorName` and `message`/`due` on
 * the notification document, and the bell renders them the same way for every
 * row. Writing them here, once per event, is what stops the next call site
 * inventing a fifth shape.
 *
 * WHY THE LINK MATTERS AS MUCH AS THE WORDS. A notification that cannot be
 * acted on is an interruption. A doer's notification goes to My Tasks, where
 * their work is; the MD's goes to the step that is waiting on them. Neither
 * ever points at a page the reader then has to navigate out of.
 *
 * FIRE AND FORGET, ALWAYS. The property must move even if the bell cannot be
 * written — a failed notification is never allowed to fail a decision. Every
 * function here swallows its own errors, so no caller needs a try/catch.
 */

/** "gandhi naagr · Amritsar" — the thing a row is about, said the same way. */
export function entityOf(property) {
  if (!property) return '';
  const name = property.title || property.name || property.propertyName || '';
  const city = property.city || property.location || '';
  return [name, city].filter(Boolean).join(' · ');
}

/** "20 Oct" — short, because the bell has one line for it. */
const shortDate = (d) => {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** "— due 20 Oct", or nothing at all when the work carries no date. */
const dueClause = (d) => {
  const s = shortDate(d);
  return s ? ` — due ${s}` : '';
};

/**
 * THE MD'S DESK, which is not only the MD.
 *
 * An EA who cannot see what the MD is being asked to decide cannot do the job
 * of an EA, and a decision that reaches one person reaches nobody when that
 * person is on a flight. Same resolution the PMS notification service already
 * uses for its admin fan-out — stated here so the Property FMS does not grow
 * a second, quieter answer to the same question.
 */
async function leadership(excludeId) {
  try {
    const people = await User.find({ role: { $in: LEADERSHIP }, isActive: { $ne: false } }).select('_id').lean();
    return people
      .map((p) => String(p._id))
      .filter((id) => !excludeId || id !== String(excludeId));
  } catch (err) {
    logger.warn('Could not resolve leadership for a property notification', { error: err.message });
    return [];
  }
}

/** One send, with every failure swallowed. See the note at the top. */
async function send(payload) {
  if (!payload.recipients?.length) return;
  try {
    await notificationService.notify({ module: 'property', ...payload });
  } catch (err) {
    logger.warn('Property notification not sent', { error: err.message, title: payload.title });
  }
}

/**
 * The handoffs in the Property FMS, as the reader sees them.
 *
 * Each is one event in the flow where something stops being one person's
 * problem and becomes another's — which is exactly, and only, when somebody
 * should be interrupted. Steps that move a record without changing whose desk
 * it is on deliberately send nothing: a bell that rings for everything is a
 * bell nobody reads.
 *
 * WORK LANDING ON A DOER IS NOT HERE. That is every PMS task, not just a
 * property one, and project.service#notifyBulkAssigned already fires on
 * every task write using these same template fields. A second copy for
 * property tasks would ring the doer twice for one assignment.
 */
export const propertyNotify = {
  /**
   * STEP 2 — a property has been filed and is waiting on the MD's road.
   *
   * The MD's own work is deciding, and nothing was telling them there was a
   * decision to take. This is the other half of the ask: not just "tell the
   * doer their work arrived" but "tell the MD their work arrived", where the
   * MD's work is the answer itself.
   */
  async decisionNeeded({ property, projectId, actorId, actorName, rowId, how }) {
    /**
     * THE WHOLE DESK, INCLUDING WHOEVER FILED IT.
     *
     * Every other notification here drops the actor, and for every other one
     * that is right: nobody needs a bell telling them they just approved
     * something. This one is different, and the difference is the point of
     * the step. CAPTURING a property and DECIDING its road are two separate
     * jobs that happen days apart, and an MD does both. Excluding the filer
     * meant that when the MD filed a site themselves — which is most of them
     * on this system — the one person who owes the decision was the one
     * person not told it was owed. The bell went to the other two MDs and
     * the EAs, and the person looking at the screen concluded notifications
     * were broken.
     *
     * So `leadership()` is called with no exclusion. A filer who is not
     * leadership is not on the list anyway; a filer who IS gets the row,
     * because they are going to have to action it.
     */
    const recipients = await leadership(null);
    await send({
      recipients,
      project: projectId,
      type: 'approval_needed',
      title: how ? `New property via ${how}` : 'A property is waiting on your decision',
      entity: entityOf(property),
      actorName,
      message: 'Read the full report, then send it for assessment, straight to commercial, or straight to project.',
      /* STRAIGHT INTO THE REPORT. The MD's first question about a new
         property is "what is it?", and the answer is the report Step 1's
         View already opens — the whole capture, printable. Landing on the
         queue instead would mean finding the row first, on a page that can
         be forty rows long by the time anybody reads the bell.

         `rowId` is the queue's own id for the thing — `rec:<id>` for a
         captured property, the bare enquiry id for a public submission —
         so one link opens either without the page having to guess which.
         Without one it still works, just on the queue.

         `/property` is an index REDIRECT and a redirect drops the query
         string, so this names the page itself. */
      link: rowId
        ? `/property/capture?report=${encodeURIComponent(rowId)}`
        : '/property/capture',
    });
  },

  /**
   * STEP 4 — every assessment the MD asked for is in.
   *
   * Counted against what was ASKED FOR, never against four: a property sent
   * for one assessment is ready when that one lands. The caller decides that;
   * this only carries the words.
   */
  async readyToShortlist({ property, projectId, filed, total, actorId, actorName }) {
    const recipients = await leadership(actorId);
    const n = Number(total) || 0;
    await send({
      recipients,
      project: projectId,
      type: 'approval_needed',
      title: 'Assessments are in — ready to shortlist',
      entity: entityOf(property),
      actorName,
      message: `${filed} of ${n} asked-for assessment${n === 1 ? '' : 's'} filed. Shortlist it for the next phase, or send it back.`,
      link: '/property/selection',
    });
  },

  /**
   * STEP 3 → 4 — ONE assessment has landed, and it needs the MD.
   *
   * WHY THIS EXISTS ALONGSIDE readyToShortlist. The only assessment bell
   * used to be the one above, which waits for the LAST of the asked-for
   * assessments. The reasoning was sound as far as it went — the Step 4
   * shortlist cannot be taken until they are all in, so ringing three times
   * about work nobody can action is noise.
   *
   * It missed that a filed assessment is ALREADY the MD's work. It arrives
   * `submitted`, and submitted means somebody has to approve it or send it
   * back; that is a decision per assessment, not one at the end. So a
   * property sent for four assessments with one filed had a doer waiting on
   * an approval that the MD was never told about — and on a property that
   * takes a fortnight to assess, "you will hear when the fourth one lands"
   * is a silence long enough to look broken.
   *
   * SO BOTH RING, AND THEY SAY DIFFERENT THINGS. This one on every filing:
   * what landed, and how far through we are. The other once, at the end:
   * the property is ready to shortlist. The count in this message is what
   * stops the two reading as duplicates.
   *
   * IT LINKS TO MY TASKS, NOT TO THE STEP. Asked for directly: the bell goes
   * to the queue of what this person owes, and the row there carries them on
   * to Step 4. One road in, so nobody has to learn two.
   */
  async assessmentFiled({
    property, projectId, assessmentLabel, filed, total, actorId, actorName,
  }) {
    /* The filer is excluded here — unlike a captured property, where the MD
       who files it still owes the decision. An assessor who fills in their
       own form does not need telling they filled it in. */
    const recipients = await leadership(actorId);
    const n = Number(total) || 0;
    const f = Number(filed) || 0;
    const rest = Math.max(0, n - f);
    await send({
      recipients,
      project: projectId,
      type: 'approval_needed',
      title: `${assessmentLabel || 'An assessment'} is in — your approval is needed`,
      entity: entityOf(property),
      actorName,
      message: rest
        ? `${f} of ${n} assessments filed. Approve it or send it back from My Tasks — ${rest} still to come before this property can be shortlisted.`
        : `${f} of ${n} assessments filed — that is all of them. Approve it from My Tasks, then shortlist the property.`,
      link: '/my-tasks',
    });
  },

  /** STEP 6 — a document has been filed and needs the MD's approval. */
  async approvalNeeded({ property, projectId, documentLabel, actorId, actorName }) {
    const recipients = await leadership(actorId);
    await send({
      recipients,
      project: projectId,
      type: 'approval_needed',
      title: `${documentLabel || 'A document'} is waiting on your approval`,
      entity: entityOf(property),
      actorName,
      message: 'Read it and approve it, or send it back with a reason.',
      link: '/property/approvals',
    });
  },

  /**
   * THE ANSWER, BACK TO WHOEVER DID THE WORK.
   *
   * A decision that is never reported is a decision the doer learns about by
   * noticing. Both outcomes are sent, because "it was approved" is as much
   * news as "it was not" — and silence after filing something reads as the
   * work having gone nowhere.
   */
  async decided({ recipients, property, projectId, approved, what, reason, actorName }) {
    if (!recipients?.length) return;
    await send({
      recipients: recipients.map(String),
      project: projectId,
      type: 'decision_made',
      title: approved ? `${what} approved` : `${what} sent back`,
      entity: entityOf(property),
      actorName,
      message: approved
        ? 'Nothing more is needed from you on this one.'
        : `${reason || 'No reason was given'} — it is back in My Tasks.`,
      link: '/my-tasks',
    });
  },

  /** Work put back on somebody's desk, in the decider's own words. */
  async returned({ recipients, property, projectId, what, reason, actorName, taskCode }) {
    if (!recipients?.length) return;
    await send({
      recipients: recipients.map(String),
      project: projectId,
      type: 'work_returned',
      title: `${what} — sent back to be done again`,
      entity: entityOf(property),
      actorName,
      message: `${reason || 'No reason was given'} — it is back on your list.`,
      /* The task that came back, not the list holding it. */
      link: taskCode && projectId ? `/my-tasks/projects/${projectId}/tasks/${taskCode}` : '/my-tasks',
    });
  },
};

export default propertyNotify;
