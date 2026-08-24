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
import { MapPin, Briefcase, Clock, CheckCircle2 } from 'lucide-react';

const API = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export function ApplyPage() {
  const { id } = useParams();
  const [job, setJob] = useState(undefined); // undefined = loading, null = closed
  const [form, setForm] = useState({ name: '', phone: '', email: '', city: '', resumeUrl: '', coverNote: '', experienceYears: '', website: '' });
  const [state, setState] = useState('idle'); // idle | sending | done | error
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
      <div className="apply-card">
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

        <h2 className="apply-h" style={{ marginTop: 18 }}>Apply</h2>
        <form onSubmit={submit} className="col gap-3">
          {error && <div className="apply-error">{error}</div>}
          <div className="apply-grid">
            <label className="col gap-1"><span className="label">Your name *</span><input className="input" required minLength={2} value={form.name} onChange={set('name')} /></label>
            <label className="col gap-1"><span className="label">Phone *</span><input className="input" required minLength={6} inputMode="tel" value={form.phone} onChange={set('phone')} /></label>
            <label className="col gap-1"><span className="label">Email</span><input className="input" type="email" value={form.email} onChange={set('email')} /></label>
            <label className="col gap-1"><span className="label">City</span><input className="input" value={form.city} onChange={set('city')} /></label>
            <label className="col gap-1"><span className="label">Experience (years)</span><input className="input" type="number" min={0} value={form.experienceYears} onChange={set('experienceYears')} /></label>
            <label className="col gap-1"><span className="label">Resume link</span><input className="input" placeholder="Google Drive / LinkedIn" value={form.resumeUrl} onChange={set('resumeUrl')} /></label>
          </div>
          <label className="col gap-1"><span className="label">Anything you'd like us to know</span><textarea className="textarea" rows={3} value={form.coverNote} onChange={set('coverNote')} /></label>
          {/* Honeypot: hidden from people, filled by bots. */}
          <input className="apply-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} placeholder="Website" aria-hidden="true" />
          <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Submit application'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ApplyPage;
