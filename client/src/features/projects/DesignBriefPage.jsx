/**
 * The PUBLIC design brief — what an outside architect sees when we send them
 * the work. No login, no app chrome, reachable at /design/:token outside the
 * authenticated shell.
 *
 * This page exists because a designer cannot design from a deadline. Handed
 * only "do the front elevations by the 30th", the first thing they do is ring
 * somebody and ask how big the unit is, where it is, and what has to fit
 * inside it — and somebody then reads those facts off a screen and types them
 * into WhatsApp. So the page leads with exactly those three answers: the site,
 * its measurements, and the games this outlet is opening with the floor space
 * each one needs. Then what to produce, then somewhere to put it.
 *
 * Deliberately does NOT use the app's axios client: it cancels any request
 * made without an access token, and the designer has none. Plain fetch,
 * same as the public job page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  MapPin, Ruler, CalendarClock, Upload, CheckCircle2, FileText, X, Gamepad2, Info,
} from 'lucide-react';
import '../../styles/designBrief.css';

const API = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const fmtDay = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const num = (v) => (v == null ? null : Number(v).toLocaleString('en-IN'));

/** Why a link is not working, said the way the person holding it would ask. */
const CLOSED = {
  revoked: {
    title: 'This link has been turned off',
    hint: 'Whoever sent it can issue a new one. Please ask them for a fresh link.',
  },
  expired: {
    title: 'This link has expired',
    hint: 'Links are time-limited. Ask your contact at Mystery Rooms to send a new one.',
  },
  unknown: {
    title: 'This link is not valid',
    hint: 'It may have been typed or copied incompletely. Try opening it straight from the message it arrived in.',
  },
};

export function DesignBriefPage() {
  const { token } = useParams();
  const [brief, setBrief] = useState(undefined); // undefined = loading
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    fetch(`${API}/pms/public/design/${token}`)
      .then((r) => r.json())
      .then((j) => setBrief(j?.data || { closed: true, reason: 'unknown' }))
      .catch(() => setError('We could not reach the server. Please check your connection and try again.'));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (error) return <Shell><p className="db-closed-hint">{error}</p></Shell>;
  if (brief === undefined) return <Shell><p className="db-closed-hint">Loading your brief…</p></Shell>;

  if (brief.closed) {
    const c = CLOSED[brief.reason] || CLOSED.unknown;
    return (
      <Shell>
        <div className="db-closed">
          <h2>{c.title}</h2>
          <p className="db-closed-hint">{c.hint}</p>
        </div>
      </Shell>
    );
  }

  return <Brief token={token} brief={brief} onFiled={load} />;
}

/** The masthead and page frame, shared by the brief and every closed state. */
function Shell({ children }) {
  return (
    <div className="db-page">
      <header className="db-top">
        <span className="db-brand">Mystery Rooms</span>
        <span className="db-brand-sub">Design brief</span>
      </header>
      <main className="db-main">{children}</main>
      <footer className="db-foot">
        Sent to you by Mystery Rooms. Anything you upload here goes straight to the
        project team for review.
      </footer>
    </div>
  );
}

function Brief({ token, brief, onFiled }) {
  const { project, site, games, work, form, filed, note, invitedAs, expiresAt } = brief;

  return (
    <Shell>
      <div className="db-hello">
        <h1>{work.list}</h1>
        <p>
          {invitedAs ? `${invitedAs}, this` : 'This'} is the design work for{' '}
          <strong>{project.name}</strong>{project.city ? `, ${project.city}` : ''}.
          {work.dueAt && <> It is needed by <strong>{fmtDay(work.dueAt)}</strong>.</>}
        </p>
      </div>

      {note && (
        <section className="db-card db-note">
          <h2><Info size={14} /> From the project team</h2>
          <p>{note}</p>
        </section>
      )}

      {/* ── The three facts nobody can design without ── */}
      <section className="db-card">
        <h2><MapPin size={14} /> The site</h2>
        <dl className="db-facts">
          {site.propertyName && <div><dt>Property</dt><dd>{site.propertyName}</dd></div>}
          <div><dt>City</dt><dd>{project.city || '—'}</dd></div>
          {(site.locality || project.address) && (
            <div><dt>Where</dt><dd>{site.locality || project.address}</dd></div>
          )}
          <div>
            <dt><Ruler size={11} /> Area to work with</dt>
            <dd className="db-big">{site.areaSqft != null ? `${num(site.areaSqft)} sq ft` : 'Not recorded'}</dd>
          </div>
          {site.frontageFt != null && <div><dt>Frontage</dt><dd>{num(site.frontageFt)} ft</dd></div>}
          {site.floor && <div><dt>Floor</dt><dd>{site.floor}</dd></div>}
          {project.targetOpening && (
            <div><dt><CalendarClock size={11} /> Store opens</dt><dd>{fmtDay(project.targetOpening)}</dd></div>
          )}
        </dl>
        {site.mapLocation && (
          <a className="db-map" href={site.mapLocation} target="_blank" rel="noreferrer">
            <MapPin size={12} /> Open the location on a map
          </a>
        )}
      </section>

      {/* ── What has to fit inside it ── */}
      {games?.length > 0 && <GamesCard games={games} areaSqft={site.areaSqft} />}

      {/* ── What to produce ── */}
      <section className="db-card">
        <h2><FileText size={14} /> What is being asked for</h2>
        {work.what && <p className="db-sub">{work.what}</p>}
        {work.how && <p className="db-how">{work.how}</p>}
        {work.checklist?.length > 0 && (
          <ul className="db-check">
            {work.checklist.map((c) => (
              <li key={c.label}>
                <CheckCircle2 size={13} />
                <span>{c.label}{c.required && <em> — required</em>}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {filed?.length > 0 && (
        <section className="db-card db-done">
          <h2><CheckCircle2 size={14} /> Already sent by you</h2>
          <ul className="db-filed">
            {filed.map((f, i) => (
              <li key={`${f.at}-${i}`}>
                <span>{f.title}</span>
                <span className="db-filed-when">{fmtDay(f.at)} · {f.status === 'approved' ? 'approved' : 'with the team for review'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <UploadForm token={token} schema={form.schema} onFiled={onFiled} expiresAt={expiresAt} />
    </Shell>
  );
}

/**
 * The games, and the sum a designer would otherwise reach for a calculator to get.
 *
 * The list on its own is only half the constraint. What decides the layout is
 * whether the smallest approved version of every game fits in the unit at all
 * — and on a real site it often does not, because the games are picked as a
 * wish list before anyone lays them out. Saying so here, in the designer's own
 * arithmetic, turns a surprise found three days into the work into the first
 * thing they read. Circulation, walls and back-of-house are on top of this,
 * which is why the note says the gap is tighter than the number suggests.
 */
function GamesCard({ games, areaSqft }) {
  const known = games.filter((g) => g.minAreaSqft != null);
  const smallest = known.reduce((sum, g) => sum + g.minAreaSqft, 0);
  const partial = known.length < games.length;
  const over = areaSqft != null && smallest > areaSqft;

  return (
    <section className="db-card">
      <h2><Gamepad2 size={14} /> The games this outlet is opening with</h2>
      <p className="db-sub">
        {games.length} game{games.length === 1 ? '' : 's'}. The area beside each one is the
        floor space it needs, on its smallest approved layout.
      </p>
      <ul className="db-games">
        {games.map((g) => (
          <li key={g.name}>
            <span className="db-game-name">{g.name}</span>
            <span className="db-game-area">{g.areaLabel || '—'}</span>
          </li>
        ))}
      </ul>

      {known.length > 0 && (
        <p className={`db-total${over ? ' is-over' : ''}`}>
          <strong>{num(smallest)} sq ft</strong> for all {known.length}
          {partial ? ' with a recorded size' : ''} on their smallest layouts
          {areaSqft != null && <>, against <strong>{num(areaSqft)} sq ft</strong> on site</>}.
          {over
            ? ' They do not all fit as listed — please plan around what does, and say in your notes what you left out.'
            : ' Circulation, walls and back-of-house come out of what is left.'}
        </p>
      )}
    </section>
  );
}

/**
 * The upload form, built from the phase's own field list.
 *
 * Only the field TYPES a designer would meet are rendered specially; anything
 * else falls back to a text box rather than being dropped, because a missing
 * question is worse than a plain one. Files go up one at a time as they are
 * chosen, so a slow upload never costs somebody a filled-in form.
 */
function UploadForm({ token, schema, onFiled, expiresAt }) {
  const [values, setValues] = useState({});
  const [files, setFiles] = useState({});   // key → [{ url, name }]
  const [busy, setBusy] = useState(null);   // key currently uploading
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const honeypot = useRef(null);

  const fileFields = schema.filter((f) => f.type === 'file');
  const plainFields = schema.filter((f) => f.type !== 'file');

  const upload = async (field, fileList) => {
    setBusy(field.key);
    setError(null);
    try {
      const uploaded = [];
      for (const file of Array.from(fileList)) {
        const body = new FormData();
        body.append('file', file);
        // eslint-disable-next-line no-await-in-loop -- one at a time on purpose: a
        // designer's twenty options over a phone connection should not be twenty
        // parallel uploads competing for the same uplink.
        const res = await fetch(`${API}/pms/public/design/${token}/uploads`, { method: 'POST', body });
        const j = await res.json();
        if (!res.ok || j?.data?.closed) throw new Error(j?.message || 'That file was not accepted.');
        uploaded.push({ ...j.data, name: file.name });
      }
      setFiles((f) => ({ ...f, [field.key]: [...(f[field.key] || []), ...uploaded] }));
    } catch (err) {
      setError(err.message || 'That file could not be uploaded.');
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const payload = { ...values };
      for (const [key, list] of Object.entries(files)) payload[key] = list;
      const res = await fetch(`${API}/pms/public/design/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: payload, website_url: honeypot.current?.value || '' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message || 'We could not accept that. Please try again.');
      }
      setDone(true);
      setValues({});
      setFiles({});
      onFiled?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <section className="db-card db-thanks">
        <CheckCircle2 size={28} />
        <h2>Received — thank you</h2>
        <p>The project team can see it now. They will come back to you if anything needs changing.</p>
        <button type="button" className="btn btn-subtle" onClick={() => setDone(false)}>Send something else</button>
      </section>
    );
  }

  return (
    <section className="db-card db-upload">
      <h2><Upload size={14} /> Send your work</h2>
      <form className="col gap-3" onSubmit={submit}>
        {plainFields.map((f) => (
          <div className="field" key={f.key}>
            <label className="label">{f.label}{f.required && ' *'}</label>
            {f.type === 'textarea' ? (
              <textarea
                className="textarea" rows={3} required={f.required}
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            ) : f.type === 'select' ? (
              <select
                className="input" required={f.required}
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              >
                <option value="">Select…</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="input" required={f.required}
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({
                  ...v, [f.key]: f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                }))}
              />
            )}
            {f.helpText && <span className="tiny muted">{f.helpText}</span>}
          </div>
        ))}

        {fileFields.map((f) => (
          <div className="field" key={f.key}>
            <label className="label">{f.label}{f.required && ' *'}</label>
            <input
              className="input" type="file" multiple={f.multiple !== false}
              accept={f.accept || undefined}
              disabled={busy === f.key}
              onChange={(e) => { if (e.target.files?.length) upload(f, e.target.files); e.target.value = ''; }}
            />
            {busy === f.key && <span className="tiny muted">Uploading…</span>}
            {f.helpText && <span className="tiny muted">{f.helpText}</span>}
            {(files[f.key] || []).length > 0 && (
              <ul className="db-files">
                {files[f.key].map((u, i) => (
                  <li key={`${u.url}-${i}`}>
                    <FileText size={12} /> <span>{u.name}</span>
                    <button
                      type="button" aria-label={`Remove ${u.name}`}
                      onClick={() => setFiles((all) => ({ ...all, [f.key]: all[f.key].filter((_, j) => j !== i) }))}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {/* Left empty by people, filled by bots. Hidden from both eyes and screen readers. */}
        <input ref={honeypot} name="website_url" tabIndex={-1} autoComplete="off" aria-hidden="true" className="db-hp" />

        {error && <p className="os-error">{error}</p>}

        <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="tiny muted">
            {expiresAt ? `This link works until ${fmtDay(expiresAt)}.` : ''}
          </span>
          <button type="submit" className="btn btn-primary" disabled={sending || Boolean(busy)}>
            {sending ? 'Sending…' : 'Send it to the team'}
          </button>
        </div>
      </form>
    </section>
  );
}

export default DesignBriefPage;
