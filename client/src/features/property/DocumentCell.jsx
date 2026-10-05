import { Check, AlertTriangle, FileText } from 'lucide-react';
import { fmtDate, PersonName } from './propertyUi.jsx';

/**
 * ONE COMMERCIAL DOCUMENT, banded — the same shape Step 3 gives an assessment.
 *
 * Closure was six columns of one word each: filed, or not. That is the only
 * question the sheet could answer, and it is not the question anybody on this
 * screen is asking. They are asking when the LOI expires, what date the lease
 * runs from, who is sitting on the legal check and how long the NOC has left.
 * All of it was inside the six forms, so finding out meant opening all six on
 * every property — on a step whose whole job is chasing paperwork.
 *
 * Each document now gets its own band with its own dates, its own owner and
 * its own clock, exactly as each assessment does. Reading across a row is
 * reading the closure.
 */

/**
 * WHICH DATES A DOCUMENT HAS, and what they are called on it.
 *
 * Six forms, six vocabularies: an LOI is dated and valid-until, a lease runs
 * start to end, an NOC only expires. Naming them per document rather than
 * forcing one pair of column headings on all six is the difference between a
 * date somebody can act on and a date they have to go and check the meaning of.
 *
 * `expires` is the one that drives the countdown — the date after which the
 * document stops being worth anything.
 */
const DATES = {
  loi: { fromKey: 'loi_date', fromLabel: 'Dated', expires: 'valid_until', expiresLabel: 'Valid until' },
  lease: { fromKey: 'lease_start_date', fromLabel: 'Starts', expires: 'lease_end_date', expiresLabel: 'Runs to' },
  legal: { fromKey: 'verification_date', fromLabel: 'Verified' },
  /* The deposit RECEIPT's own date. `available_from` is a Phase 1 property
     field and was never on this record — the column was blank on every row. */
  deposit: { fromKey: 'payment_date', fromLabel: 'Paid on' },
  nocs: { expires: 'expiry_date', expiresLabel: 'Expires' },
  approvals: {},
};

/** A second line under a document's dates, where the form has one worth it. */
const DETAIL = {
  loi: () => null,
  lease: (v) => v.renewal_option && `Renewal: ${v.renewal_option}`,
  legal: (v) => v.property_ownership || v.advocate_name || v.title_verification,
  deposit: (v) => (Number(v.security_deposit)
    ? `₹${Number(v.security_deposit).toLocaleString('en-IN')}`
    : v.payment_mode || null),
  nocs: (v) => v.noc_type,
  approvals: (v) => v.approval_level,
};

const dim = <span className="prop-dim">—</span>;
const DAY = 86400000;

/**
 * HOW LONG IS LEFT, said as a person would say it.
 *
 * "12 Nov 2026" is a fact; "expires in 9 days" is the thing somebody acts on,
 * and the reason this column exists. Past the date it says so plainly rather
 * than counting backwards in negatives — an LOI that lapsed three weeks ago is
 * not "-21 days", it is a problem.
 */
export function daysLeft(date) {
  if (!date) return null;
  const t = new Date(date).valueOf();
  if (Number.isNaN(t)) return null;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round((t - midnight.valueOf()) / DAY);
  if (days < 0) return { days, tone: 'gone', text: `expired ${Math.abs(days)}d ago` };
  if (days === 0) return { days, tone: 'soon', text: 'expires today' };
  if (days <= 30) return { days, tone: 'soon', text: `${days}d left` };
  return { days, tone: 'ok', text: `${days}d left` };
}

/** Not started / sent back / in progress / filed / approved. */
export const DOC_STATE = {
  start: { label: 'Open form', cls: 'is-start', hint: 'Nothing filed yet — this opens a blank form' },
  open: { label: 'In progress', cls: 'is-open', hint: 'Started but not filed — this opens what is there' },
  /* Filed once, refused, and back with the doer. It is a draft again, so it
     opens as a form like any other draft — what is different is that somebody
     is waiting on a correction, which "In progress" does not say. */
  back: { label: 'Sent back', cls: 'is-back', hint: 'Sent back to be filled in again — this opens the form' },
  filed: { label: 'Filed', cls: 'is-filed', hint: 'Filed and waiting on approval — this opens it' },
  done: { label: 'Approved', cls: 'is-done', hint: 'Approved — this opens it' },
};
const STATE = DOC_STATE;

export function documentState(doc) {
  if (!doc) return 'start';
  if (doc.status === 'approved' || doc.status === 'locked') return 'done';
  if (doc.status === 'submitted' || doc.status === 'awaiting_review') return 'filed';
  /* Checked after the filed states and before the draft ones: the reason stays
     on the record after it is resubmitted, so a document that has come back
     and gone in again must read as filed, not as still sent back. */
  if (doc.sentBackReason) return 'back';

  /**
   * A DRAFT NOBODY HAS TYPED INTO IS NOT "IN PROGRESS".
   *
   * All six documents open as empty drafts the moment a property reaches
   * closure (propertyCapture.service#openChildForms), so every one of them
   * reported itself as underway before a single person had touched it — a
   * sheet of seventeen properties claiming a hundred documents were being
   * worked on, when none of them were. An empty draft is the same thing as
   * no draft to anybody reading the step: work that has not started.
   */
  const values = doc.values || {};
  const started = Object.values(values).some((v) => (Array.isArray(v) ? v.length : v !== '' && v != null))
    || (doc.attachments || []).length > 0;
  return started ? 'open' : 'start';
}

/**
 * THE ONE WORD FOR A DOCUMENT'S STATUS — used by the Commercial table AND the
 * report that opens from it, so the two can never say different things.
 * Filed-and-waiting is still Pending: it is not done until it is approved.
 */
const STATUS_OF_STATE = {
  start: { label: 'Pending', cls: 's-go' },
  open: { label: 'Pending', cls: 's-go' },
  back: { label: 'Sent back', cls: 's-no' },
  filed: { label: 'Pending', cls: 's-go' },
  done: { label: 'Completed', cls: 's-done' },
};
export const documentStatus = (doc) => STATUS_OF_STATE[documentState(doc)];

/** A property's closure: Completed only when every document is. */
export function closureStatus(documents, types) {
  const done = types.filter((t) => documentState((documents || []).find((x) => x.type === t) || null) === 'done').length;
  const all = done === types.length;
  return {
    label: all ? 'Completed' : `Pending · ${done}/${types.length}`,
    cls: all ? 's-done' : 's-go',
    hint: `${done} of ${types.length} documents completed`,
  };
}

/**
 * WHERE THE STATUS BUTTON GOES — the form, or the filed record.
 *
 * "OPEN FORM" DID NOT OPEN A FORM. All six documents open as empty drafts the
 * moment a property reaches closure, so `doc.id` always existed, and both
 * steps sent every click to CommercialRecordReportPage on the strength of
 * that id alone. Pressing a button labelled "Open form" therefore showed a
 * read-only REPORT of a record nobody had typed into yet — a page of blanks,
 * with no way to fill any of them in.
 *
 * The destination is now decided by the same `documentState()` that writes
 * the button's label, so the two cannot disagree again:
 *
 *   start / open  (draft)              -> the form, at `?form=<type>`
 *   filed / done  (submitted+)         -> the record, which is what there is
 *                                         to read, and it carries its own Edit
 *
 * The draft cut-off matches CommercialFinalizationPage's own: it refuses to
 * open the form for a record that is past draft or rejected, so sending a
 * filed document to `?form=` would land on the phase page with nothing open.
 */
export const documentOpensAsForm = (doc) => ['start', 'open', 'back'].includes(documentState(doc));

/**
 * The five columns for one document, banded under its name.
 *
 * Returned as a set rather than written out six times, so the six can never
 * drift into showing different things about themselves — the same reason
 * `assessmentColumns` exists.
 */
export function documentColumns(d, onOpen) {
  const group = d.label;
  const dates = DATES[d.key] || {};
  const detail = DETAIL[d.key];

  const docOf = (r) => (r.documents || []).find((x) => x.type === d.key);
  const slotOf = (r) => (r.documentSlots || []).find((x) => x.type === d.key);

  return [
    {
      /* THE CELL IS THE ACTION. Empty opens a blank form, filled opens what
         was filed — one control that both reports the state and is the way to
         change it, which is what the client asked for on this step. */
      key: `${d.key}_state`, group, label: 'Status', width: 126,
      render: (r) => {
        const doc = docOf(r);
        const s = STATE[documentState(doc)];
        return (
          <button
            type="button"
            className={`pc2-doc ${s.cls}`}
            onClick={(e) => { e.stopPropagation(); onOpen(r, d.key, doc); }}
            title={`${d.label} — ${s.hint}`}
          >
            {documentState(doc) === 'done' ? <Check size={11} /> : <FileText size={11} />}
            {s.label}
          </button>
        );
      },
    },
    {
      key: `${d.key}_from`, group, label: dates.fromLabel || 'Details', width: 128,
      render: (r) => {
        const v = docOf(r)?.values || {};
        const on = dates.fromKey ? fmtDate(v[dates.fromKey]) : null;
        const sub = detail ? detail(v) : null;
        if (!on && !sub) return dim;
        return (
          <>
            {on && <div className="as-when">{on}</div>}
            {sub && <div className="prop-sub" title={sub}>{sub}</div>}
          </>
        );
      },
    },
    {
      key: `${d.key}_expiry`, group, label: dates.expiresLabel || 'Expires', width: 132,
      render: (r) => {
        if (!dates.expires) return <span className="prop-dim" title="This document does not expire">n/a</span>;
        const v = docOf(r)?.values || {};
        const when = v[dates.expires];
        if (!when) return dim;
        const left = daysLeft(when);
        return (
          <>
            <div className="as-when">{fmtDate(when)}</div>
            {left && <span className={`pc2-expiry t-${left.tone}`}>
              {left.tone === 'gone' && <AlertTriangle size={10} />}
              {left.text}
            </span>}
          </>
        );
      },
    },
    {
      /* WHOSE JOB THIS ONE IS, off its own task */
      key: `${d.key}_by`, group, label: 'Assign person', width: 130,
      render: (r) => {
        const slot = slotOf(r);
        const assigned = slot?.assignedTo || null;
        return assigned
          ? <PersonName name={assigned} />
          : dim;
      },
    },
    {
      /* WHO ACTUALLY COMPLETED / FILED IT */
      key: `${d.key}_done_by`, group, label: 'Done by', width: 120,
      render: (r) => {
        const slot = slotOf(r);
        const filedBy = slot?.filedBy || docOf(r)?.by || null;
        return filedBy
          ? <PersonName name={filedBy} />
          : <span className="prop-dim">Not yet</span>;
      },
    },
    {
      /* PLANNED COMPLETION DATE */
      key: `${d.key}_plan_date`, group, label: 'Plan date', width: 110,
      render: (r) => {
        const slot = slotOf(r);
        const planDate = slot?.planDate;
        if (!planDate) return dim;
        const isDone = Boolean(slot?.filedAt || docOf(r)?.at);
        const isLate = !isDone && new Date(planDate) < new Date();
        return (
          <span className={`plan-date-pill${isLate ? ' is-delayed' : ''}`}>
            {fmtDate(planDate)}
          </span>
        );
      },
    },
    {
      /* ACTUAL DATE WHEN COMPLETED / FILED */
      key: `${d.key}_at`, group, label: 'Actual date', width: 115,
      render: (r) => {
        const slot = slotOf(r);
        const at = slot?.filedAt || docOf(r)?.at;
        if (at) return <span className="as-when">{fmtDate(at)}</span>;
        /* Not filed yet: show the planned due date */
        return slot?.planDate
          ? <span className="as-due" title="Planned date — not done yet">due {fmtDate(slot.planDate)}</span>
          : dim;
      },
    },
  ];
}

export default documentColumns;
