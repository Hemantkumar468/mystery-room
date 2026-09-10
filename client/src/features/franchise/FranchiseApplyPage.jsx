import { useState } from 'react';
import {
  MapPin, Building2, User, Camera, CheckCircle2, Loader2, Plus, Trash2,
  Video, FileText, Link2, Compass,
} from 'lucide-react';
import '../hrms/hrms.css';

/**
 * The public franchise enquiry — the shared link an interested partner opens.
 *
 * PUBLIC PAGE, PLAIN FETCH ONLY: the app's authorised axios client cancels
 * tokenless requests, so everything here talks to the API bare (same rule as
 * the HRMS apply page). No login, no shell — just the form.
 *
 * The form forks on ONE question: "Do you already have a property?"
 *  - YES: they add every property they hold — five, six, more — each with its
 *    own details, photos, walkthrough videos (or Google Drive links when the
 *    files are too big), and documents. Each becomes a Phase 1 property
 *    capture the moment the MD approves.
 *  - NO: we take their interest seriously anyway — which city, which area,
 *    what they plan — and an approval starts the property search WITH them.
 */
const API = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const EMPTY_PROP = () => ({
  label: '', city: '', locality: '', address: '', carpetAreaSqft: '', floor: '',
  ownership: 'owned', gps: null, gpsBusy: false,
  photos: [], videos: [], documents: [], driveLinks: [], remarks: '',
});

const LIMITS = { photos: 6, videos: 3, documents: 4, driveLinks: 6 };
const ACCEPT = {
  photos: 'image/*',
  videos: 'video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo',
  documents: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*',
};

async function uploadOne(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/franchise/public/uploads`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Could not upload ${file.name}`);
  const ref = (await res.json())?.data;
  return { url: ref.url, name: file.name, publicId: ref.publicId };
}

const card = {
  border: '1px solid var(--border, #e5e7eb)', borderRadius: 10, padding: '14px 16px', marginTop: 12,
};

export function FranchiseApplyPage() {
  const [form, setForm] = useState({
    name: '', phone: '', email: '', background: '', investmentReady: '', message: '', website: '',
    interestCity: '', interestArea: '', plan: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [hasProperty, setHasProperty] = useState(null); // null until they choose
  const [props, setProps] = useState([EMPTY_PROP()]);
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState(null);

  const patchProp = (i, patch) => setProps((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const addFiles = async (i, kind, files) => {
    setUploading(true);
    setError(null);
    try {
      const room = LIMITS[kind] - props[i][kind].length;
      const added = [];
      for (const file of [...files].slice(0, room)) {
        if (kind === 'videos' && file.size > 50 * 1024 * 1024) {
          throw new Error(`${file.name} is over 50 MB — upload a shorter clip, or paste a Google Drive link below instead.`);
        }
        added.push(await uploadOne(file));
      }
      setProps((ps) => ps.map((p, idx) => (idx === i ? { ...p, [kind]: [...p[kind], ...added] } : p)));
    } catch (e) {
      setError(e.message || 'Upload failed — try again.');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (i, kind, url) =>
    setProps((ps) => ps.map((p, idx) => (idx === i ? { ...p, [kind]: p[kind].filter((f) => f.url !== url) } : p)));

  const captureGps = (i) => {
    if (!navigator.geolocation) return;
    patchProp(i, { gpsBusy: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => patchProp(i, { gps: { lat: pos.coords.latitude, lng: pos.coords.longitude }, gpsBusy: false }),
      () => patchProp(i, { gpsBusy: false }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (hasProperty === null) { setError('Tell us first: do you already have a property?'); return; }
    setState('sending');
    try {
      const body = {
        name: form.name, phone: form.phone,
        email: form.email || undefined,
        background: form.background || undefined,
        investmentReady: form.investmentReady || undefined,
        message: form.message || undefined,
        website: form.website,
        hasProperty,
        ...(hasProperty
          ? {
              properties: props.map((p) => ({
                label: p.label || undefined,
                city: p.city, locality: p.locality || undefined, address: p.address,
                carpetAreaSqft: p.carpetAreaSqft ? Number(p.carpetAreaSqft) : undefined,
                floor: p.floor || undefined, ownership: p.ownership,
                location: p.gps || undefined,
                photos: p.photos.length ? p.photos : undefined,
                videos: p.videos.length ? p.videos : undefined,
                documents: p.documents.length ? p.documents : undefined,
                driveLinks: p.driveLinks.filter((l) => l.trim()).length ? p.driveLinks.filter((l) => l.trim()) : undefined,
                remarks: p.remarks || undefined,
              })),
            }
          : {
              interestCity: form.interestCity,
              interestArea: form.interestArea || undefined,
              plan: form.plan || undefined,
            }),
      };
      const res = await fetch(`${API}/franchise/public/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || 'Could not submit — check the highlighted fields.');
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <div className="apply-shell">
        <div className="apply-card" style={{ textAlign: 'center' }}>
          <span className="apply-brand">Mystery Rooms</span>
          <CheckCircle2 size={44} style={{ color: 'var(--success, #16a34a)', margin: '12px auto' }} />
          <h1 className="apply-title">Thank you, {form.name.split(' ')[0]}!</h1>
          <p>
            Your franchise enquiry has reached our expansion team. We review every application
            personally — our team will contact you shortly at <b>{form.phone}</b>.
          </p>
        </div>
      </div>
    );
  }

  const chooserBtn = (on) => ({
    flex: 1, padding: '14px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
    border: on ? '2px solid var(--primary, #2563eb)' : '1px solid var(--border, #e5e7eb)',
    background: on ? 'color-mix(in srgb, var(--primary, #2563eb) 8%, transparent)' : 'transparent',
    fontWeight: on ? 650 : 500, fontSize: 14,
  });

  const fileChips = (i, kind) => props[i][kind].length > 0 && (
    <p style={{ fontSize: 13, margin: '4px 0' }}>
      {props[i][kind].map((f, n) => (
        <span key={f.url}>
          <a href={f.url} target="_blank" rel="noreferrer">{f.name || `${kind} ${n + 1}`}</a>
          {' '}<button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer' }} onClick={() => removeFile(i, kind, f.url)}>×</button>{' '}
        </span>
      ))}
    </p>
  );

  return (
    <div className="apply-shell">
      <form className="apply-card" onSubmit={submit}>
        <span className="apply-brand">Mystery Rooms</span>
        <h1 className="apply-title">Open a Mystery Rooms in your city</h1>
        <p style={{ marginTop: 0 }}>
          Whether you already hold a property or are simply serious about bringing Mystery Rooms
          to your city — tell us below. Our expansion team reviews every application personally.
        </p>

        <h2 className="apply-h"><User size={15} /> About you</h2>
        <div className="apply-grid">
          <label>Full name *<input className="input" required value={form.name} onChange={set('name')} /></label>
          <label>Phone (WhatsApp) *<input className="input" required value={form.phone} onChange={set('phone')} placeholder="+91…" /></label>
          <label>Email<input className="input" type="email" value={form.email} onChange={set('email')} /></label>
          <label>Investment readiness<input className="input" value={form.investmentReady} onChange={set('investmentReady')} placeholder="e.g. ₹60–80 lakh, self-funded" /></label>
        </div>
        <label>Your background<textarea className="input" rows={2} value={form.background} onChange={set('background')} placeholder="What you do today, businesses you run…" /></label>

        <h2 className="apply-h"><Building2 size={15} /> Do you already have a property for the centre?</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" style={chooserBtn(hasProperty === true)} onClick={() => setHasProperty(true)}>
            Yes — I have {props.length > 1 ? 'properties' : 'a property'} to show
          </button>
          <button type="button" style={chooserBtn(hasProperty === false)} onClick={() => setHasProperty(false)}>
            Not yet — but I'm interested
          </button>
        </div>

        {hasProperty === true && (
          <>
            <p className="tiny" style={{ color: '#6b7280', margin: '10px 0 0' }}>
              Add every property you'd like us to consider — details, photos, a walkthrough video
              if you have one. More options help our team choose the best site with you.
            </p>
            {props.map((p, i) => (
              <div key={i} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 14 }}>Property {i + 1}</strong>
                  {props.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProps((ps) => ps.filter((_, idx) => idx !== i))}>
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
                <div className="apply-grid">
                  <label>Name this property<input className="input" value={p.label} onChange={(e) => patchProp(i, { label: e.target.value })} placeholder="e.g. DB Mall first-floor shop" /></label>
                  <label>City *<input className="input" required value={p.city} onChange={(e) => patchProp(i, { city: e.target.value })} /></label>
                  <label>Locality / area<input className="input" value={p.locality} onChange={(e) => patchProp(i, { locality: e.target.value })} placeholder="e.g. Civil Lines" /></label>
                  <label>Carpet area (sq ft)<input className="input" type="number" min="0" value={p.carpetAreaSqft} onChange={(e) => patchProp(i, { carpetAreaSqft: e.target.value })} placeholder="2500–4000 works best" /></label>
                  <label>Floor<input className="input" value={p.floor} onChange={(e) => patchProp(i, { floor: e.target.value })} placeholder="e.g. Ground + first" /></label>
                  <label>Ownership
                    <select className="input" value={p.ownership} onChange={(e) => patchProp(i, { ownership: e.target.value })}>
                      <option value="owned">I own it</option>
                      <option value="family">Family-owned</option>
                      <option value="leased">Leased / can lease</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                </div>
                <label>Full address *<textarea className="input" rows={2} required value={p.address} onChange={(e) => patchProp(i, { address: e.target.value })} /></label>
                <label>Location pin
                  <button type="button" className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => captureGps(i)} disabled={p.gpsBusy}>
                    <MapPin size={13} /> {p.gpsBusy ? 'Getting your location…' : p.gps ? `${p.gps.lat.toFixed(5)}, ${p.gps.lng.toFixed(5)} ✓` : 'Use my location (if you are at the property)'}
                  </button>
                </label>

                <label><Camera size={13} /> Photos (up to {LIMITS.photos})
                  <input className="input" type="file" accept={ACCEPT.photos} multiple disabled={uploading || p.photos.length >= LIMITS.photos}
                    onChange={(e) => { addFiles(i, 'photos', e.target.files); e.target.value = ''; }} />
                </label>
                {fileChips(i, 'photos')}

                <label><Video size={13} /> Walkthrough videos (up to {LIMITS.videos}, max 50 MB each)
                  <input className="input" type="file" accept={ACCEPT.videos} multiple disabled={uploading || p.videos.length >= LIMITS.videos}
                    onChange={(e) => { addFiles(i, 'videos', e.target.files); e.target.value = ''; }} />
                </label>
                {fileChips(i, 'videos')}

                <label><Link2 size={13} /> Video too big? Paste Google Drive links
                  {p.driveLinks.map((l, li) => (
                    <span key={li} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <input className="input" type="url" value={l} placeholder="https://drive.google.com/…"
                        onChange={(e) => patchProp(i, { driveLinks: p.driveLinks.map((x, xi) => (xi === li ? e.target.value : x)) })} />
                      <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                        onClick={() => patchProp(i, { driveLinks: p.driveLinks.filter((_, xi) => xi !== li) })}>×</button>
                    </span>
                  ))}
                  {p.driveLinks.length < LIMITS.driveLinks && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}
                      onClick={() => patchProp(i, { driveLinks: [...p.driveLinks, ''] })}>
                      <Plus size={12} /> Add a Drive link
                    </button>
                  )}
                </label>

                <label><FileText size={13} /> Documents — plans, papers, brochure (up to {LIMITS.documents})
                  <input className="input" type="file" accept={ACCEPT.documents} multiple disabled={uploading || p.documents.length >= LIMITS.documents}
                    onChange={(e) => { addFiles(i, 'documents', e.target.files); e.target.value = ''; }} />
                </label>
                {fileChips(i, 'documents')}

                <label>Anything about this property?<textarea className="input" rows={2} value={p.remarks} onChange={(e) => patchProp(i, { remarks: e.target.value })} placeholder="Footfall nearby, parking, rent expectations…" /></label>
              </div>
            ))}
            {props.length < 12 && (
              <button type="button" className="btn btn-subtle" style={{ marginTop: 10 }} onClick={() => setProps((ps) => [...ps, EMPTY_PROP()])}>
                <Plus size={14} /> Add another property
              </button>
            )}
          </>
        )}

        {hasProperty === false && (
          <div style={card}>
            <h2 className="apply-h" style={{ marginTop: 0 }}><Compass size={15} /> Your interest</h2>
            <div className="apply-grid">
              <label>Which city are you interested in? *<input className="input" required value={form.interestCity} onChange={set('interestCity')} placeholder="e.g. Gwalior" /></label>
              <label>Preferred area / locality<input className="input" value={form.interestArea} onChange={set('interestArea')} placeholder="e.g. near City Centre mall" /></label>
            </div>
            <label>What are you planning?
              <textarea className="input" rows={3} value={form.plan} onChange={set('plan')} placeholder="e.g. I want to open a Mystery Rooms franchise myself; I can arrange a property within 3 months; looking to invest with a partner…" />
            </label>
            <p className="tiny" style={{ color: '#6b7280', margin: '6px 0 0' }}>
              No property is no problem — if we say yes, our team searches for the right site in your city together with you.
            </p>
          </div>
        )}

        <label style={{ marginTop: 12, display: 'block' }}>Anything else we should know?
          <textarea className="input" rows={3} value={form.message} onChange={set('message')} placeholder="Why this city, your timeline, questions for us…" />
        </label>

        {/* The honeypot — invisible to people, irresistible to bots. */}
        <input className="apply-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} placeholder="Website" aria-hidden="true" />

        {uploading && <p className="tiny" style={{ margin: '6px 0' }}><Loader2 size={12} className="spin" /> Uploading…</p>}
        {error && <div className="apply-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={state === 'sending' || uploading} style={{ width: '100%', marginTop: 14, padding: 12 }}>
          {state === 'sending' ? 'Sending…' : 'Submit my application'}
        </button>
        <p className="tiny" style={{ color: '#6b7280', marginTop: 10 }}>
          Your details go directly to the Mystery Rooms expansion team and are used only to evaluate this application.
        </p>
      </form>
    </div>
  );
}

export default FranchiseApplyPage;
