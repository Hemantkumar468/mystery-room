import { useState } from 'react';
import { MapPin, Building2, User, IndianRupee, Camera, CheckCircle2, Loader2 } from 'lucide-react';
import '../hrms/hrms.css';

/**
 * The public franchise enquiry — the shared link an interested partner opens.
 *
 * PUBLIC PAGE, PLAIN FETCH ONLY: the app's authorised axios client cancels
 * tokenless requests, so everything here talks to the API bare (same rule as
 * the HRMS apply page). No login, no shell — just the form.
 *
 * The form deliberately DOUBLES as the property capture: the applicant has
 * the place, so they describe it — address, area, floor, photos, even a live
 * GPS pin if they are standing there. When the MD approves, this data becomes
 * the project's approved Phase 1 property, and the project starts at the LOI.
 */
const API = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const EMPTY = {
  name: '', phone: '', email: '', background: '',
  city: '', locality: '', address: '', carpetAreaSqft: '', floor: '', ownership: 'owned',
  investmentReady: '', message: '', website: '',
};

export function FranchiseApplyPage() {
  const [form, setForm] = useState(EMPTY);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [gps, setGps] = useState(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState(null);

  const addPhotos = async (files) => {
    setUploading(true);
    setError(null);
    try {
      const added = [];
      for (const file of [...files].slice(0, 6 - photos.length)) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API}/franchise/public/uploads`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || 'Upload failed');
        const ref = (await res.json())?.data;
        added.push({ url: ref.url, name: file.name, publicId: ref.publicId });
      }
      setPhotos((ps) => [...ps, ...added]);
    } catch (e) {
      setError(e.message || 'Photo upload failed — try again.');
    } finally {
      setUploading(false);
    }
  };

  const captureGps = () => {
    if (!navigator.geolocation) return;
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsBusy(false); },
      () => setGpsBusy(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setState('sending');
    try {
      const res = await fetch(`${API}/franchise/public/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          email: form.email || undefined,
          carpetAreaSqft: form.carpetAreaSqft ? Number(form.carpetAreaSqft) : undefined,
          location: gps || undefined,
          photos: photos.length ? photos : undefined,
        }),
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
          <p>Your franchise enquiry for <b>{form.city}</b> has reached our expansion team. We review every property personally — expect to hear from us at <b>{form.phone}</b>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="apply-shell">
      <form className="apply-card" onSubmit={submit}>
        <span className="apply-brand">Mystery Rooms</span>
        <h1 className="apply-title">Open a Mystery Rooms in your city</h1>
        <p style={{ marginTop: 0 }}>
          Have a property and the ambition? Tell us about yourself and the place —
          our team reviews every enquiry, and a yes takes you straight to the agreement stage.
        </p>

        <h2 className="apply-h"><User size={15} /> About you</h2>
        <div className="apply-grid">
          <label>Full name *<input className="input" required value={form.name} onChange={set('name')} /></label>
          <label>Phone (WhatsApp) *<input className="input" required value={form.phone} onChange={set('phone')} placeholder="+91…" /></label>
          <label>Email<input className="input" type="email" value={form.email} onChange={set('email')} /></label>
          <label>Investment readiness<input className="input" value={form.investmentReady} onChange={set('investmentReady')} placeholder="e.g. ₹60–80 lakh, self-funded" /></label>
        </div>
        <label>Your background<textarea className="input" rows={2} value={form.background} onChange={set('background')} placeholder="What you do today, businesses you run…" /></label>

        <h2 className="apply-h"><Building2 size={15} /> The property</h2>
        <div className="apply-grid">
          <label>City *<input className="input" required value={form.city} onChange={set('city')} /></label>
          <label>Locality / area<input className="input" value={form.locality} onChange={set('locality')} placeholder="e.g. Civil Lines" /></label>
          <label>Carpet area (sq ft)<input className="input" type="number" min="0" value={form.carpetAreaSqft} onChange={set('carpetAreaSqft')} placeholder="2500–4000 works best" /></label>
          <label>Floor<input className="input" value={form.floor} onChange={set('floor')} placeholder="e.g. Ground + first" /></label>
        </div>
        <label>Full address *<textarea className="input" rows={2} required value={form.address} onChange={set('address')} /></label>
        <div className="apply-grid">
          <label>Ownership
            <select className="input" value={form.ownership} onChange={set('ownership')}>
              <option value="owned">I own it</option>
              <option value="family">Family-owned</option>
              <option value="leased">Leased / can lease</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Location pin
            <button type="button" className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={captureGps} disabled={gpsBusy}>
              <MapPin size={13} /> {gpsBusy ? 'Getting your location…' : gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} ✓` : 'Use my location (if you are at the property)'}
            </button>
          </label>
        </div>

        <label><Camera size={14} /> Photos of the property (up to 6)
          <input className="input" type="file" accept="image/*" multiple disabled={uploading || photos.length >= 6}
            onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
        </label>
        {uploading && <p className="tiny" style={{ margin: '4px 0' }}><Loader2 size={12} className="spin" /> Uploading…</p>}
        {photos.length > 0 && (
          <p style={{ fontSize: 13, margin: '4px 0' }}>
            {photos.map((p, i) => (
              <span key={p.url}>
                <a href={p.url} target="_blank" rel="noreferrer">{p.name || `photo ${i + 1}`}</a>
                {' '}<button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer' }} onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))}>×</button>{' '}
              </span>
            ))}
          </p>
        )}

        <label>Anything else we should know?
          <textarea className="input" rows={3} value={form.message} onChange={set('message')} placeholder="Footfall nearby, parking, why this location…" />
        </label>

        {/* The honeypot — invisible to people, irresistible to bots. */}
        <input className="apply-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} placeholder="Website" aria-hidden="true" />

        {error && <div className="apply-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={state === 'sending' || uploading} style={{ width: '100%', marginTop: 14, padding: 12 }}>
          {state === 'sending' ? 'Sending…' : 'Submit my enquiry'}
        </button>
        <p className="tiny" style={{ color: '#6b7280', marginTop: 10 }}>
          Your details go directly to the Mystery Rooms expansion team and are used only to evaluate this enquiry.
        </p>
      </form>
    </div>
  );
}

export default FranchiseApplyPage;
