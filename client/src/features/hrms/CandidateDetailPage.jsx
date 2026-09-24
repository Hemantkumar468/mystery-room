/**
 * One candidate, end to end: who they are, every interview round, and the
 * one thing to do next.
 *
 * Written for a recruiter, not an engineer. The page answers three questions
 * in the order they get asked — "who is this?", "what happens next?", "what
 * has already happened?" — and every action is a labelled button rather than
 * a status dropdown someone has to decode.
 *
 * The pipeline STAGE and the interview ROUNDS are deliberately separate.
 * Stage is where the candidate sits on the board; a round is one conversation
 * with its own time, its own interviewer and its own verdict. Rolling them
 * into one meant either a stage per round (a board nobody could read) or one
 * interview per candidate (which is not how hiring works).
 */
import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, MapPin, Briefcase, FileText, Linkedin, CalendarPlus,
  Pencil, Trash2, Send, CheckCircle2, XCircle, Printer, Clock, UserCheck, Star, StickyNote,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { DatePicker } from '../../components/ui/DatePicker.jsx';
import { RemoveDialog } from './RemoveDialog.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { CvPreview } from './CvPreview.jsx';
import {
  useGetCandidateQuery, useGetHrmsMetaQuery, useMoveCandidateMutation,
  useUpdateCandidateMutation, useDeleteCandidateMutation,
  useScheduleInterviewMutation, useUpdateInterviewMutation, useDecideInterviewMutation,
  useSendInterviewInviteMutation, useCancelInterviewMutation,
} from '../../app/api/hrmsApi.js';
import { fmtDate, fmtDateTimeLong, fromNow } from '../../lib/format.js';
import {
  STAGE_META, SOURCE_LABEL, INTERVIEW_KIND_META, INTERVIEW_OUTCOME_META, INTERVIEW_LOCATION_HINT,
} from './hrmsUi.js';

const PIPELINE = ['applied', 'screening', 'interview', 'offer', 'hired'];
const NEXT_LABEL = {
  applied: 'Shortlist for screening',
  screening: 'Move to interview',
  interview: 'Make an offer',
  offer: 'Mark as hired',
};

/* ── local-time ⇄ ISO, by hand ───────────────────────────────────────────
   `new Date('2026-09-09')` parses as UTC midnight, which is the previous
   evening in India — an interview booked for the 9th would show as the 8th.
   Same reasoning as ApplyLinkCard; kept local to each because they are two
   different forms and sharing a half-helper would couple them for nothing. */
const pad = (n) => String(n).padStart(2, '0');

function toIso(ymd, minutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Math.floor(minutes / 60), minutes % 60, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fromIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return {
    ymd: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    minutes: d.getHours() * 60 + d.getMinutes(),
  };
}

/** Every quarter hour — interviews get booked at :15 and :45 far more than
 *  applications get closed at them, so this grid is finer than the link's. */
const TIMES = Array.from({ length: 96 }, (_, i) => {
  const mins = i * 15;
  const h24 = Math.floor(mins / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { value: mins, label: `${h12}:${pad(mins % 60)} ${h24 < 12 ? 'AM' : 'PM'}` };
});

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const money = (n) => (n == null ? null : `₹${Number(n).toLocaleString('en-IN')}`);

/* ── Schedule / reschedule a round ─────────────────────────────────────── */

function InterviewModal({ open, onClose, candidate, existing, mailConfigured }) {
  const editing = Boolean(existing);
  const start = fromIso(existing?.scheduledAt);
  const [form, setForm] = useState(() => ({
    kind: existing?.kind || 'in_person',
    ymd: start?.ymd || todayYmd(),
    minutes: start?.minutes ?? 11 * 60,
    durationMins: existing?.durationMins || 30,
    interviewerName: existing?.interviewerName || existing?.interviewer?.name || '',
    location: existing?.location || '',
    sendInvite: !editing && Boolean(candidate.email) && mailConfigured,
  }));
  const [error, setError] = useState(null);
  const [schedule, { isLoading: scheduling }] = useScheduleInterviewMutation();
  const [update, { isLoading: updating }] = useUpdateInterviewMutation();
  const busy = scheduling || updating;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const scheduledAt = toIso(form.ymd, Number(form.minutes));
    if (!scheduledAt) { setError('Pick a date for the interview.'); return; }
    const body = {
      kind: form.kind,
      scheduledAt,
      durationMins: Number(form.durationMins) || 30,
      interviewerName: form.interviewerName.trim() || undefined,
      location: form.location.trim() || undefined,
    };
    try {
      if (editing) {
        await update({ id: candidate._id, interviewId: existing._id, ...body }).unwrap();
      } else {
        await schedule({
          id: candidate._id,
          requisition: candidate.requisition?._id,
          ...body,
          sendInvite: Boolean(form.sendInvite),
        }).unwrap();
      }
      onClose();
    } catch (err) {
      setError(err?.data?.message || 'Could not save the interview');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Round ${existing.round} — change the details` : 'Schedule an interview'}>
      <form className="col gap-3" onSubmit={submit}>
        <label className="col gap-1">
          <span className="label">What kind of interview?</span>
          <select className="input" value={form.kind} onChange={set('kind')}>
            {Object.entries(INTERVIEW_KIND_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
        </label>

        <div className="row gap-2 wrap">
          <label className="col gap-1" style={{ flex: '1 1 150px' }}>
            <span className="label">Date</span>
            <DatePicker value={form.ymd} onChange={(v) => setForm((f) => ({ ...f, ymd: v }))} placeholder="Pick a day" />
          </label>
          <label className="col gap-1" style={{ flex: '0 1 130px' }}>
            <span className="label">Time</span>
            <select className="input" value={form.minutes} onChange={set('minutes')}>
              {TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="col gap-1" style={{ flex: '0 1 120px' }}>
            <span className="label">How long</span>
            <select className="input" value={form.durationMins} onChange={set('durationMins')}>
              {[15, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n} minutes</option>)}
            </select>
          </label>
        </div>

        <label className="col gap-1">
          <span className="label">Who will take it?</span>
          <input className="input" value={form.interviewerName} onChange={set('interviewerName')} placeholder="Name of the interviewer" />
        </label>

        <label className="col gap-1">
          <span className="label">Where / how</span>
          <input className="input" value={form.location} onChange={set('location')} placeholder={INTERVIEW_LOCATION_HINT[form.kind]} />
        </label>

        {!editing && (
          <label className="row gap-2" style={{ alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={form.sendInvite}
              disabled={!candidate.email || !mailConfigured}
              onChange={(e) => setForm((f) => ({ ...f, sendInvite: e.target.checked }))}
              style={{ marginTop: 3 }}
            />
            <span className="col gap-1">
              <span className="sm">Email the details to {candidate.name.split(' ')[0]}</span>
              {!candidate.email && <span className="tiny muted">No email address on file for this candidate.</span>}
              {candidate.email && !mailConfigured && (
                <span className="tiny muted">Email is not set up on this server, so nothing would be sent.</span>
              )}
            </span>
          </label>
        )}

        {error && <p className="tiny" style={{ color: 'var(--danger)' }}>{error}</p>}

        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Schedule it'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Record how a round went ───────────────────────────────────────────── */

function OutcomeModal({ open, onClose, candidate, interview }) {
  const [form, setForm] = useState({
    outcome: interview?.outcome === 'pending' ? 'selected' : interview?.outcome || 'selected',
    feedback: interview?.feedback || '',
    rating: interview?.rating || '',
  });
  const [error, setError] = useState(null);
  const [decide, { isLoading }] = useDecideInterviewMutation();

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await decide({
        id: candidate._id,
        interviewId: interview._id,
        requisition: candidate.requisition?._id,
        outcome: form.outcome,
        feedback: form.feedback.trim() || undefined,
        rating: form.rating ? Number(form.rating) : undefined,
      }).unwrap();
      onClose();
    } catch (err) {
      setError(err?.data?.message || 'Could not save the outcome');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Round ${interview?.round} — how did it go?`}>
      <form className="col gap-3" onSubmit={submit}>
        <div className="col gap-1">
          <span className="label">The verdict</span>
          <div className="cdp-choices">
            {['selected', 'rejected', 'no_show'].map((k) => (
              <button
                key={k}
                type="button"
                className={`cdp-choice${form.outcome === k ? ' is-on' : ''}`}
                onClick={() => setForm((f) => ({ ...f, outcome: k }))}
              >
                {INTERVIEW_OUTCOME_META[k].label}
              </button>
            ))}
          </div>
          <span className="tiny muted">
            This is the verdict on <em>this round only</em>. It does not reject the candidate — you do that
            from the top of the page, and it asks for a reason.
          </span>
        </div>

        <label className="col gap-1">
          <span className="label">Out of 5 (optional)</span>
          <select className="input" value={form.rating} onChange={(e) => setForm((f) => ({ ...f, rating: e.target.value }))}>
            <option value="">Not rated</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} — {['Poor', 'Weak', 'Okay', 'Good', 'Excellent'][n - 1]}</option>)}
          </select>
        </label>

        <label className="col gap-1">
          <span className="label">Notes for whoever picks this up next</span>
          <textarea
            className="input"
            rows={4}
            value={form.feedback}
            onChange={(e) => setForm((f) => ({ ...f, feedback: e.target.value }))}
            placeholder="What they were good at, what worried you, anything the next round should probe."
          />
        </label>

        {error && <p className="tiny" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={isLoading}>
            {isLoading ? 'Saving…' : 'Save the outcome'}
          </button>
        </div>
      </form>
    </Modal>
  );
}


/* ── Correcting what the form (or the CV parser) got wrong ─────────────── */

/**
 * Every field a recruiter can fix.
 *
 * This exists because a good half of these values were typed by the applicant
 * on a phone, or read off a PDF by a parser — a transposed digit in a phone
 * number is the difference between a hire and a candidate who "never
 * responded". Blanks are sent as empty strings so a wrong value can actually
 * be CLEARED, not just replaced with another wrong one.
 */
function EditCandidateModal({ open, onClose, candidate }) {
  const [form, setForm] = useState(() => ({
    name: candidate.name || '',
    phone: candidate.phone || '',
    email: candidate.email || '',
    city: candidate.city || '',
    experienceYears: candidate.experienceYears ?? '',
    currentSalary: candidate.currentSalary ?? '',
    expectedSalary: candidate.expectedSalary ?? '',
    noticePeriodDays: candidate.noticePeriodDays ?? '',
    source: candidate.source || 'other',
    referredBy: candidate.referredBy || '',
    linkedinUrl: candidate.linkedinUrl || '',
    resumeUrl: candidate.resumeUrl || '',
    coverNote: candidate.coverNote || '',
    notes: candidate.notes || '',
  }));
  const [error, setError] = useState(null);
  const [update, { isLoading }] = useUpdateCandidateMutation();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    /* Numbers come out of <input> as strings; '' must become undefined rather
       than 0, or clearing "expected salary" would record that they expect
       nothing. */
    const num = (v) => (String(v).trim() === '' ? undefined : Number(v));
    try {
      await update({
        id: candidate._id,
        requisition: candidate.requisition?._id,
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        city: form.city.trim(),
        experienceYears: num(form.experienceYears),
        currentSalary: num(form.currentSalary),
        expectedSalary: num(form.expectedSalary),
        noticePeriodDays: num(form.noticePeriodDays),
        source: form.source,
        referredBy: form.referredBy.trim(),
        linkedinUrl: form.linkedinUrl.trim(),
        resumeUrl: form.resumeUrl.trim(),
        coverNote: form.coverNote.trim(),
        notes: form.notes.trim(),
      }).unwrap();
      onClose();
    } catch (err) {
      setError(err?.data?.message || 'Could not save the changes');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${candidate.name}`}>
      <form className="col gap-3" onSubmit={submit}>
        <div className="apply-grid">
          <label className="col gap-1"><span className="label">Name *</span>
            <input className="input" value={form.name} onChange={set('name')} required /></label>
          <label className="col gap-1"><span className="label">Phone</span>
            <input className="input" value={form.phone} onChange={set('phone')} /></label>
          <label className="col gap-1"><span className="label">Email</span>
            <input className="input" type="email" value={form.email} onChange={set('email')} /></label>
          <label className="col gap-1"><span className="label">City</span>
            <input className="input" value={form.city} onChange={set('city')} /></label>
          <label className="col gap-1"><span className="label">Experience (years)</span>
            <input className="input" type="number" min="0" value={form.experienceYears} onChange={set('experienceYears')} /></label>
          <label className="col gap-1"><span className="label">Notice period (days)</span>
            <input className="input" type="number" min="0" value={form.noticePeriodDays} onChange={set('noticePeriodDays')} /></label>
          <label className="col gap-1"><span className="label">Current salary (₹/year)</span>
            <input className="input" type="number" min="0" value={form.currentSalary} onChange={set('currentSalary')} /></label>
          <label className="col gap-1"><span className="label">Expected salary (₹/year)</span>
            <input className="input" type="number" min="0" value={form.expectedSalary} onChange={set('expectedSalary')} /></label>
          <label className="col gap-1"><span className="label">How they reached us</span>
            <select className="input" value={form.source} onChange={set('source')}>
              {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label className="col gap-1"><span className="label">Referred by</span>
            <input className="input" value={form.referredBy} onChange={set('referredBy')} placeholder="Who sent them" /></label>
        </div>

        <label className="col gap-1"><span className="label">LinkedIn profile</span>
          <input className="input" value={form.linkedinUrl} onChange={set('linkedinUrl')} placeholder="linkedin.com/in/…" /></label>
        <label className="col gap-1"><span className="label">CV link</span>
          <input className="input" value={form.resumeUrl} onChange={set('resumeUrl')} placeholder="Link to the uploaded CV" /></label>
        <label className="col gap-1"><span className="label">Their note</span>
          <textarea className="input" rows={2} value={form.coverNote} onChange={set('coverNote')} /></label>
        <label className="col gap-1"><span className="label">Internal notes</span>
          <textarea className="input" rows={3} value={form.notes} onChange={set('notes')}
            placeholder="Only the hiring team sees this." /></label>

        {error && <p className="tiny" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={isLoading}>
            {isLoading ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
/* ── Rejecting the person (not a round) ────────────────────────────────── */

function RejectModal({ open, onClose, candidate }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [move, { isLoading }] = useMoveCandidateMutation();

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await move({
        id: candidate._id,
        requisition: candidate.requisition?._id,
        stage: 'rejected',
        rejectionReason: reason.trim(),
      }).unwrap();
      onClose();
    } catch (err) {
      setError(err?.data?.message || 'Could not reject this candidate');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Reject ${candidate.name}`}>
      <form className="col gap-3" onSubmit={submit}>
        <label className="col gap-1">
          <span className="label">Why? *</span>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Kept on the record, and it is what the next round of hiring learns from." />
        </label>
        {error && <p className="tiny" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={isLoading || reason.trim().length < 3}>
            {isLoading ? 'Saving…' : 'Reject'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── One round in the list ─────────────────────────────────────────────── */

function InterviewRow({ c, iv, canEdit, onEdit, onDecide }) {
  const [invite, { isLoading: sending }] = useSendInterviewInviteMutation();
  const [cancel, { isLoading: cancelling }] = useCancelInterviewMutation();
  const [note, setNote] = useState(null);
  const om = INTERVIEW_OUTCOME_META[iv.outcome] || INTERVIEW_OUTCOME_META.pending;
  const km = INTERVIEW_KIND_META[iv.kind] || { label: iv.kind };
  const past = new Date(iv.scheduledAt) < new Date();
  const who = iv.interviewer?.name || iv.interviewerName;

  const send = async () => {
    setNote(null);
    try {
      const r = await invite({ id: c._id, interviewId: iv._id }).unwrap();
      /* The server answers 200 whether or not it sent, because "this server
         has no mail configured" is not a failure. Say which one happened. */
      setNote(r?.sent
        ? { ok: true, text: `Sent to ${r.to}` }
        : { ok: false, text: r?.reason || (r?.skipped === 'mail not configured'
          ? 'Email is not set up on this server, so nothing was sent.'
          : `Not sent — ${r?.skipped || 'unknown reason'}`) });
    } catch (err) {
      setNote({ ok: false, text: err?.data?.message || 'Could not send the invite' });
    }
  };

  const drop = async () => {
    if (!window.confirm(`Cancel round ${iv.round}? The candidate is not told automatically.`)) return;
    await cancel({ id: c._id, interviewId: iv._id, requisition: c.requisition?._id });
  };

  return (
    <li className="cdp-round">
      <div className="cdp-round-head">
        <span className="cdp-round-n">Round {iv.round}</span>
        <span className="cdp-round-kind">{km.label}</span>
        <Badge color={om.color} soft={om.soft} dot>{om.label}</Badge>
      </div>

      <p className="cdp-round-when">
        <Clock size={13} aria-hidden /> {fmtDateTimeLong(iv.scheduledAt)}
        <span className="muted"> · {iv.durationMins || 30} min</span>
        {past && iv.outcome === 'pending' && <span className="cdp-overdue"> · this has already happened</span>}
      </p>

      {(who || iv.location) && (
        <p className="cdp-round-meta">
          {who && <span><UserCheck size={12} aria-hidden /> {who}</span>}
          {iv.location && <span><MapPin size={12} aria-hidden /> {iv.location}</span>}
        </p>
      )}

      <p className="cdp-round-meta">
        {iv.inviteSentAt
          ? <span className="cdp-sent"><CheckCircle2 size={12} aria-hidden /> Invite sent to {iv.inviteTo} · {fromNow(iv.inviteSentAt)}</span>
          : <span className="muted tiny">The candidate has not been emailed about this round.</span>}
      </p>

      {iv.feedback && <p className="cdp-round-fb">“{iv.feedback}”</p>}
      {iv.rating && (
        <p className="cdp-round-meta">
          <span><Star size={12} aria-hidden /> {iv.rating} out of 5</span>
          {iv.decidedBy?.name && <span className="muted">by {iv.decidedBy.name}</span>}
        </p>
      )}

      {note && <p className={`cdp-note${note.ok ? ' ok' : ''}`}>{note.text}</p>}

      {canEdit && (
        <div className="cdp-round-actions">
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => onDecide(iv)}>
            <CheckCircle2 size={13} /> {iv.outcome === 'pending' ? 'Record the outcome' : 'Change the outcome'}
          </button>
          {/* Disabled rather than left live-but-doomed. A button that always
              answers "nothing was sent" teaches people to ignore the message,
              and the title says which of the two reasons it is. */}
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            onClick={send}
            disabled={sending || !c.email || !c.mailConfigured}
            title={!c.email
              ? 'This candidate has no email address on file'
              : !c.mailConfigured
                ? 'Email is not set up on this server'
                : undefined}
          >
            <Send size={13} /> {iv.inviteSentAt ? 'Send again' : 'Send the invite'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(iv)}>
            <Pencil size={13} /> Change time
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={drop} disabled={cancelling}>
            <Trash2 size={13} /> Cancel
          </button>
        </div>
      )}
    </li>
  );
}

/* ── The page ──────────────────────────────────────────────────────────── */

export function CandidateDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: c, isLoading } = useGetCandidateQuery(id);
  const { data: meta } = useGetHrmsMetaQuery();
  const [move, { isLoading: moving }] = useMoveCandidateMutation();
  const [remove, { isLoading: removingNow }] = useDeleteCandidateMutation();
  /* Moving a candidate ON is a write into the stage AHEAD of them, so that
     is the stage the policy is asked about — not the one they are in. The
     server checks the same surface on POST /candidates/:id/move; this only
     saves the person a refusal they cannot act on. */
  const access = useAccess();

  const [booking, setBooking] = useState(false);
  const [editingRound, setEditingRound] = useState(null);
  const [deciding, setDeciding] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const rounds = c?.interviews || [];
  const nextUp = useMemo(() => {
    const now = Date.now();
    return rounds
      .filter((iv) => iv.outcome === 'pending' && new Date(iv.scheduledAt).getTime() >= now)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0] || null;
  }, [rounds]);

  if (isLoading || !c) {
    return (<><Topbar title="Candidate" /><div className="content"><SkDetail /></div></>);
  }

  const canEdit = Boolean(meta?.canEdit);
  const sm = STAGE_META[c.stage] || {};
  const done = c.stage === 'hired' || c.stage === 'rejected';
  const nextStage = PIPELINE[PIPELINE.indexOf(c.stage) + 1];

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={16} /></button>
            <span className="page-title-text">{c.name}</span>
            <Badge color={sm.color} soft={sm.soft} dot>{sm.label}</Badge>
          </span>
        )}
        actions={(
          <div className="row gap-2">
            {/* Print is the single-candidate "report": a panel wants this on
                paper or as a PDF, and the browser already does both well. */}
            {/* "Save as PDF", not "Print": the browser's print dialog offers
                both, and a header with five buttons cannot afford the longer
                label — it pushed the candidate's name onto a second line. */}
            <button type="button" className="btn btn-subtle btn-sm" title="Opens the print dialog — choose Save as PDF there" onClick={() => window.print()}>
              <Printer size={13} /> Save as PDF
            </button>
            {canEdit && !done && nextStage && access.stage(`hrms-${nextStage}`, 'edit') && (
              <button type="button" className="btn btn-subtle btn-sm" disabled={moving}
                onClick={() => move({ id: c._id, requisition: c.requisition?._id, stage: nextStage })}>
                {NEXT_LABEL[c.stage] || `Move to ${STAGE_META[nextStage]?.label}`}
              </button>
            )}
            {canEdit && c.stage !== 'rejected' && access.stage('hrms-rejected', 'edit') && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(true)}>
                <XCircle size={13} /> Reject
              </button>
            )}
          </div>
        )}
      />

      <div className="content">
        <div className="content-wide col gap-3 fade-in">
          <div className="row gap-3 wrap" style={{ alignItems: 'stretch' }}>
            {/* Edit and Remove belong to THIS card, not the page header: they act
                on exactly the fields it shows. Moving them here also gave the
                header room — five buttons had pushed the name onto two lines. */}
            <SectionCard
              title="Who this is"
              style={{ flex: '1 1 320px' }}
              action={canEdit && (
                <div className="cdp-record-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(true)}>
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              )}
            >
              <div className="col gap-2">
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <Avatar name={c.name} color={c.owner?.avatarColor} />
                  <div className="col">
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span className="tiny muted">
                      Applied {fromNow(c.createdAt)} · {SOURCE_LABEL[c.source] || c.source}
                    </span>
                  </div>
                </div>

                <div className="cdp-facts">
                  {c.phone && (
                    <div><span className="cdp-k"><Phone size={12} /> Phone</span>
                      <a className="cdp-v" href={`tel:${c.phone}`}>{c.phone}</a></div>
                  )}
                  {c.email && (
                    <div><span className="cdp-k"><Mail size={12} /> Email</span>
                      <a className="cdp-v" href={`mailto:${c.email}`}>{c.email}</a></div>
                  )}
                  {c.city && <div><span className="cdp-k"><MapPin size={12} /> City</span><span className="cdp-v">{c.city}</span></div>}
                  <div><span className="cdp-k"><Briefcase size={12} /> Role</span>
                    <span className="cdp-v">
                      {c.requisition
                        ? <Link to={`/hrms/requisitions/${c.requisition._id}`}>{c.requisition.title}</Link>
                        : '—'}
                    </span></div>
                  {c.experienceYears != null && <div><span className="cdp-k">Experience</span><span className="cdp-v">{c.experienceYears} yrs</span></div>}
                  {money(c.currentSalary) && <div><span className="cdp-k">Current</span><span className="cdp-v">{money(c.currentSalary)}</span></div>}
                  {money(c.expectedSalary) && <div><span className="cdp-k">Expected</span><span className="cdp-v">{money(c.expectedSalary)}</span></div>}
                  {c.noticePeriodDays != null && <div><span className="cdp-k">Notice</span><span className="cdp-v">{c.noticePeriodDays} days</span></div>}
                </div>

                {/* Screening is reading CVs. Doing that in another tab is how you
                    lose track of which of eleven applicants you were looking at. */}
                {c.resumeUrl && <CvPreview url={c.resumeUrl} name={`${c.name} — CV`} />}
                {c.linkedinUrl && (
                  <a className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}
                    href={/^https?:/.test(c.linkedinUrl) ? c.linkedinUrl : `https://${c.linkedinUrl}`}
                    target="_blank" rel="noreferrer">
                    <Linkedin size={13} /> LinkedIn
                  </a>
                )}
                {!c.resumeUrl && (
                  <span className="tiny muted">No CV on file — add a link with Edit.</span>
                )}

                {c.coverNote && <p className="sm" style={{ margin: 0, lineHeight: 1.6 }}>{c.coverNote}</p>}
                {c.notes && (
                  <p className="cdp-notes"><StickyNote size={12} aria-hidden /> {c.notes}</p>
                )}
                {c.rejectionReason && (
                  <p className="cdp-reject">Rejected — {c.rejectionReason}</p>
                )}
              </div>
            </SectionCard>

            {/* The whole point of the page: what to do next, in one sentence
                and one button. Everything else on screen is reference. */}
            <SectionCard title="What happens next" style={{ flex: '1 1 260px' }}>
              <div className="col gap-2">
                {done ? (
                  <p className="sm" style={{ margin: 0 }}>
                    {c.stage === 'hired'
                      ? 'Hired. Nothing further is needed here — create their login from the requisition page.'
                      : 'This candidate was rejected. Nothing further is needed.'}
                  </p>
                ) : nextUp ? (
                  <>
                    <p className="cdp-next">
                      <strong>Round {nextUp.round}</strong> — {INTERVIEW_KIND_META[nextUp.kind]?.label}
                      <br />{fmtDateTimeLong(nextUp.scheduledAt)}
                    </p>
                    <span className="tiny muted">
                      {nextUp.inviteSentAt
                        ? 'The candidate has been emailed the details.'
                        : 'The candidate has NOT been told yet — send the invite below.'}
                    </span>
                  </>
                ) : (
                  <p className="sm" style={{ margin: 0 }}>
                    Nothing is booked. {rounds.length
                      ? 'Every round so far has a verdict — either book the next one or move them along.'
                      : 'Book the first conversation to get this moving.'}
                  </p>
                )}

                {canEdit && !done && (
                  <button type="button" className="btn btn-primary btn-sm" data-guide="candidate-schedule" onClick={() => setBooking(true)}>
                    <CalendarPlus size={13} /> Schedule an interview
                  </button>
                )}
                {!c.mailConfigured && (
                  <span className="tiny muted">
                    Email is not set up on this server, so invites cannot be sent — everything else works.
                  </span>
                )}
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title="Interview rounds"
            subtitle={rounds.length ? `${rounds.length} round${rounds.length === 1 ? '' : 's'} so far` : undefined}
            action={canEdit && !done && (
              <button type="button" className="btn btn-subtle btn-sm" onClick={() => setBooking(true)}>
                <CalendarPlus size={13} /> Add a round
              </button>
            )}
          >
            {rounds.length === 0 ? (
              <EmptyState
                title="No interviews yet"
                subtitle="A round is one conversation — a call, a meeting, or the HR discussion. Book as many as the role needs."
              />
            ) : (
              <ul className="cdp-rounds">
                {rounds.map((iv) => (
                  <InterviewRow
                    key={iv._id}
                    c={c}
                    iv={iv}
                    canEdit={canEdit}
                    onEdit={setEditingRound}
                    onDecide={setDeciding}
                  />
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="What has happened so far" collapsible defaultCollapsed>
            <ul className="cdp-history">
              {[...(c.stageHistory || [])].reverse().map((h, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}>
                  <Badge color={STAGE_META[h.stage]?.color} soft={STAGE_META[h.stage]?.soft}>{STAGE_META[h.stage]?.label || h.stage}</Badge>
                  <span className="tiny muted">{fmtDate(h.at)}</span>
                  {h.by?.name && <span className="tiny muted">· {h.by.name}</span>}
                  {h.note && <span className="tiny">— {h.note}</span>}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>

      {booking && (
        <InterviewModal open onClose={() => setBooking(false)} candidate={c} mailConfigured={c.mailConfigured} />
      )}
      {editingRound && (
        <InterviewModal
          open
          onClose={() => setEditingRound(null)}
          candidate={c}
          existing={editingRound}
          mailConfigured={c.mailConfigured}
        />
      )}
      {deciding && <OutcomeModal open onClose={() => setDeciding(null)} candidate={c} interview={deciding} />}
      {rejecting && <RejectModal open onClose={() => setRejecting(false)} candidate={c} />}
      {editing && <EditCandidateModal open onClose={() => setEditing(false)} candidate={c} />}
      {removing && (
        <RemoveDialog
          open
          onClose={() => setRemoving(false)}
          title={`Remove ${c.name}`}
          confirmLabel="Remove this candidate"
          consequence={`Every interview round on this application goes with them. The role itself is not affected.`}
          busy={removingNow}
          onConfirm={async (reason) => {
            await remove({ id: c._id, requisition: c.requisition?._id, reason }).unwrap();
            navigate('/hrms/candidates');
          }}
        />
      )}
    </>
  );
}

export default CandidateDetailPage;
