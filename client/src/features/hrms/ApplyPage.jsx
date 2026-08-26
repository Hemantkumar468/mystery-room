/**
 * The PUBLIC job page — what an applicant sees when HR shares the link.
 * No login, no app chrome. Reachable at /apply/:id outside the authenticated
 * shell.
 *
 * Deliberately does NOT use the app's axios instance: that client cancels any
 * request made without an access token (by design), and an applicant has no
 * token. Plain fetch against the same API base.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Briefcase, Clock, CheckCircle2, Upload, FileText, ChevronDown, ChevronUp } from 'lucide-react';

const API = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export function ApplyPage() {
  const { id } = useParams();
  const [job, setJob] = useState(undefined); // undefined = loading, null = closed
  const [form, setForm] = useState({ name: '', phone: '', email: '', city: '', resumeUrl: '', linkedinUrl: '', coverNote: '', experienceYears: '', website: '' });
  const [state, setState] = useState('idle'); // idle | sending | done | error

  /* The job description is what this page is FOR; the form is what you do
     about it. Eight empty boxes under the JD ask people to commit before
     they have finished reading, so the questions wait behind the button. */
  const [showForm, setShowForm] = useState(false);

  /* The description collapses when the form opens; this reopens it. */
  const [jdOpen, setJdOpen] = useState(false);

  /* The CV, and which fields it filled — the applicant is shown what was
     read for them, because a form that silently fills itself is one that
     nobody proof-reads. */
  const [cv, setCv] = useState(null);
  const [cvState, setCvState] = useState('idle'); // idle | uploading | done | error
  const [cvError, setCvError] = useState(null);
  const [autoFilled, setAutoFilled] = useState([]);

  /* Tapping Apply happens at the BOTTOM of the description — that is where the
     button sits after a long JD. Collapsing the description then removes
     everything above the form, so the page is left scrolled past the card and
     the applicant sees a headless form with the wordmark cut off. Going back
     to the top puts them at the start of what they now have to fill in. */
  useEffect(() => {
    if (!showForm) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [showForm]);

  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    let on = true;
    fetch(`${API}/hrms/public/jobs/${id}`)
      .then((r) => r.json())
      .then((j) => { if (on) setJob(j?.data ?? null); })
      .catch(() => { if (on) setJob(null); });
    return () => { on = false; };
  }, [id]);

  /**
   * Store the CV, then let the server read it back into the form.
   *
   * Uploading and reading are separate outcomes on purpose: an unreadable
   * CV is still attached and the applicant simply types. Losing somebody's
   * application over an awkward PDF would be the worst trade available.
   */
  const onResume = async (file) => {
    if (!file) return;
    setCvError(null);
    setCvState('uploading');
    try {
      const body = new FormData();
      body.append('resume', file);
      const res = await fetch(`${API}/hrms/public/resume`, { method: 'POST', body });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.success === false) throw new Error(j?.message || 'Could not upload that file');

      const d = j?.data || {};
      setCv({ name: d.resumeName || file.name, url: d.resumeUrl });

      const got = d.fields || {};
      const filled = [];
      setForm((f) => {
        const next = { ...f, resumeUrl: d.resumeUrl || f.resumeUrl };
        for (const [k, v] of Object.entries(got)) {
          // Never overwrite what the applicant has already typed: what they
          // wrote about themselves beats what a parser inferred.
          if (k in next && !String(next[k] ?? '').trim()) {
            next[k] = v;
            filled.push(k);
          }
        }
        return next;
      });
      setAutoFilled(filled);
      setCvState('done');
      setShowForm(true);
    } catch (err) {
      setCvError(err.message || 'Could not upload that file');
      setCvState('error');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setState('sending'); setError(null);
    try {
      const res = await fetch(`${API}/hrms/public/jobs/${id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email || undefined,
          city: form.city || undefined,
          resumeUrl: form.resumeUrl || undefined,
          coverNote: form.coverNote || undefined,
          experienceYears: form.experienceYears === '' ? undefined : Number(form.experienceYears),
          website: form.website, // honeypot — humans never see or fill it
        }),
      });
      const j = await res.json();
      if (!res.ok || j?.success === false) throw new Error(j?.message || 'Could not submit');
      setState('done');
    } catch (err) {
      setState('error'); setError(err.message);
    }
  };

  if (job === undefined) return <div className="apply-shell"><div className="apply-card"><p className="muted">Loading…</p></div></div>;

  if (job === null) {
    return (
      <div className="apply-shell">
        <div className="apply-card center col gap-2">
          <h1 className="apply-title">This position is closed</h1>
          <p className="muted sm">The role is no longer accepting applications. Thank you for your interest in Mystery Rooms.</p>
        </div>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="apply-shell">
        <div className="apply-card center col gap-2">
          <CheckCircle2 size={40} style={{ color: 'var(--success)' }} />
          <h1 className="apply-title">Application received</h1>
          <p className="muted sm">Thanks, {form.name.split(' ')[0]} — the hiring team will be in touch if your profile matches.</p>
        </div>
      </div>
    );
  }

  const exp = job.experienceMinYears != null || job.experienceMaxYears != null
    ? `${job.experienceMinYears ?? 0}–${job.experienceMaxYears ?? '+'} yrs`
    : null;

  return (
    <div className="apply-shell">
      <div className={`apply-card${showForm ? ' is-applying' : ''}`}>
          <span className="apply-brand">Mystery Rooms · Careers</span>
        <h1 className="apply-title">{job.title}</h1>
        <div className="row gap-3 wrap tiny muted" style={{ marginBottom: 12 }}>
          {(job.city || job.centre) && <span className="row gap-1"><MapPin size={12} /> {job.centre ? `${job.centre}${job.city ? `, ${job.city}` : ''}` : job.city}</span>}
          <span className="row gap-1"><Briefcase size={12} /> {String(job.employmentType || '').replace('_', ' ')}</span>
          {exp && <span className="row gap-1"><Clock size={12} /> {exp} experience</span>}
          {job.salary && (job.salary.min || job.salary.max) && (
            <span>₹{job.salary.min?.toLocaleString('en-IN')}–{job.salary.max?.toLocaleString('en-IN')}/mo</span>
          )}
        </div>

        {/* Once they have decided to apply, the description has done its job.
            Collapsing it is what lets the form sit on one screen instead of
            below three lists they have already read — and it stays one click
            away, because people do check a requirement mid-form. */}
        {showForm && (
          <button type="button" className="apply-jd-toggle" onClick={() => setJdOpen((v) => !v)}>
            {jdOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {jdOpen ? 'Hide the job description' : 'Read the job description again'}
          </button>
        )}
        <div className={`apply-jd${showForm && !jdOpen ? ' is-collapsed' : ''}`}>
        {job.jd?.summary && <p className="sm" style={{ lineHeight: 1.65 }}>{job.jd.summary}</p>}
        {job.jd?.responsibilities?.length > 0 && (
          <><h2 className="apply-h">What you'll do</h2><ul className="hrms-jd-list">{job.jd.responsibilities.map((x) => <li key={x}>{x}</li>)}</ul></>
        )}
        {job.jd?.requirements?.length > 0 && (
          <><h2 className="apply-h">What we need</h2><ul className="hrms-jd-list">{job.jd.requirements.map((x) => <li key={x}>{x}</li>)}</ul></>
        )}
        {job.jd?.niceToHave?.length > 0 && (
          <><h2 className="apply-h">Nice to have</h2><ul className="hrms-jd-list">{job.jd.niceToHave.map((x) => <li key={x}>{x}</li>)}</ul></>
        )}
        </div>

        {!showForm && (
          <div className="apply-gate">
            <button type="button" className="btn btn-primary apply-cta" onClick={() => setShowForm(true)}>
              Apply for this role
            </button>
            <span className="tiny muted">About a minute. Attach your CV and we fill in what we can.</span>
          </div>
        )}

        {showForm && (
        <>
        <h2 className="apply-h" style={{ marginTop: 18 }}>Apply</h2>

        {/* The CV comes first: everything below may fill itself from it. */}
        <div className="apply-cv">
          <label className="apply-cv-drop">
            <input
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => onResume(e.target.files?.[0])}
              disabled={cvState === 'uploading'}
            />
            <Upload size={18} aria-hidden />
            <span className="apply-cv-main">
              {cvState === 'uploading' ? 'Reading your CV…' : cv ? cv.name : 'Attach your CV'}
            </span>
            <span className="tiny muted">PDF or Word, up to 5 MB</span>
          </label>

        {cv?.url && (
          <a className="apply-cv-open" href={cv.url} target="_blank" rel="noreferrer">
            <FileText size={13} aria-hidden /> View the CV you attached
          </a>
        )}
          {cvState === 'done' && (autoFilled.length > 0
            ? <p className="apply-cv-note ok">Filled in {autoFilled.length} field{autoFilled.length === 1 ? '' : 's'} from your CV — please check them and correct anything wrong.</p>
            : <p className="apply-cv-note">CV attached. We could not read it automatically, so please fill the form in yourself.</p>
          )}
          {cvState === 'error' && <p className="apply-cv-note bad">{cvError}</p>}
        </div>
        <form onSubmit={submit} className="col gap-3">
          {error && <div className="apply-error">{error}</div>}
          <div className="apply-grid">
            <label className="col gap-1"><span className="label">Your name *</span><input className="input" required minLength={2} value={form.name} onChange={set('name')} /></label>
            <label className="col gap-1"><span className="label">Phone *</span><input className="input" required minLength={6} inputMode="tel" value={form.phone} onChange={set('phone')} /></label>
            <label className="col gap-1"><span className="label">Email</span><input className="input" type="email" value={form.email} onChange={set('email')} /></label>
            <label className="col gap-1"><span className="label">City</span><input className="input" value={form.city} onChange={set('city')} /></label>
            <label className="col gap-1"><span className="label">Experience (years)</span><input className="input" type="number" min={0} value={form.experienceYears} onChange={set('experienceYears')} /></label>
            <label className="col gap-1"><span className="label">LinkedIn profile</span><input className="input" type="url" placeholder="linkedin.com/in/…" value={form.linkedinUrl} onChange={set('linkedinUrl')} /></label>
          </div>
          <label className="col gap-1"><span className="label">Anything you'd like us to know</span><textarea className="textarea" rows={3} value={form.coverNote} onChange={set('coverNote')} /></label>
          {/* Honeypot: hidden from people, filled by bots. */}
          <input className="apply-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} placeholder="Website" aria-hidden="true" />
          <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Submit application'}
          </button>
        </form>
        </>
        )}
      </div>
    </div>
  );
}

export default ApplyPage;
