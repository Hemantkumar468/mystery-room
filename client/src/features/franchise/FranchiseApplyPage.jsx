import { useEffect, useRef, useState } from 'react';
import {
  MapPin, Building2, User, Camera, CheckCircle2, Loader2, Plus, Trash2, Handshake, Users, ArrowLeft,
  Video, FileText, Link2, AlertTriangle,
} from 'lucide-react';
import {
  typeName, typePlace, typePhone, typeNumber, checkApplication, byPath, summaryLine,
} from './applyValidation.js';
import { LocationPreviewModal } from '../projects/records/LocationPreviewModal.jsx';
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

/**
 * `mode="referral"` is the same form asked of a different person.
 *
 * A broker, agent or landlord sending us a site is not applying to run a
 * franchise: there is no "do you have a property" fork (they would not be here
 * otherwise), and background/investment are not their business. So the fork is
 * fixed to yes, those fields drop away, and the submission posts to the broker
 * endpoint, which tags it `source: 'broker'` and keeps it out of the franchise
 * lead queue. One form, because it is genuinely one form — a second copy would
 * be the same eight upload handlers drifting apart.
 */
export function FranchiseApplyPage({ mode }) {
  /**
   * ONE LINK, TWO KINDS OF PERSON.
   *
   * There were two public URLs for what is nearly the same form, so whoever
   * shared them had to know which of the two the recipient was before they
   * sent it — and sent the wrong one whenever they did not. The link now asks
   * the visitor, who is the only one who actually knows.
   *
   * `mode` is still honoured so the old /refer-property link keeps landing a
   * broker straight on the broker form rather than 404ing or asking them a
   * question they already answered by clicking it.
   */
  const [chosen, setChosen] = useState(mode || null);
  /* Both referral roads ask the same narrower set of questions — the site,
     not the person's plans for it. They differ only in what the row is
     labelled when it lands, which is what the team needs to know before
     picking up the phone. */
  const isReferral = chosen === 'referral' || chosen === 'other';
  const referralSource = chosen === 'other' ? 'other' : 'broker';
  const [form, setForm] = useState({
    name: '', phone: '', email: '', message: '', website: '',
    interestCity: '', interestArea: '', plan: '',
  });
  /* What each field ACCEPTS as it is typed — a name cannot take a digit, a
     phone cannot take a letter. Nobody is corrected for a character the field
     never let them type in the first place. */
  const CLEAN = { name: typeName, phone: typePhone };
  const set = (k) => (e) => {
    const value = CLEAN[k] ? CLEAN[k](e.target.value) : e.target.value;
    const next = { ...form, [k]: value };
    setForm(next);
    clearIfFixed(next, null);
  };
  /* EVERY application now carries a property. It used to fork — "not yet, but
     I am interested" — and those enquiries reached the MD with nothing to
     assess: no address, no size, no photographs. The interest road is not
     gone; it is simply not something a person fills in alone any more, the
     expansion team records it. */
  const hasProperty = true;
  const [props, setProps] = useState([EMPTY_PROP()]);
  /**
   * BRING THE NEW PROPERTY INTO VIEW.
   *
   * The card is appended ABOVE the button that made it, so somebody reading at
   * the foot of a long form saw the button jump down and nothing else — the
   * form they had just asked for was off the top of the screen. Scrolling to
   * it and putting the cursor in its first real field says "here it is, carry
   * on", which is what pressing the button meant.
   */
  const [previewGps, setPreviewGps] = useState(null);
  const propRefs = useRef([]);
  const [showProp, setShowProp] = useState(null);

  const addProperty = () => {
    setShowProp(props.length); // the index the new card is about to take
    setProps((ps) => [...ps, EMPTY_PROP()]);
  };

  useEffect(() => {
    if (showProp == null) return;
    const card = propRefs.current[showProp];
    if (!card) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
    /* The property's own name — the first field of the card, and the one
       that tells the applicant which property they are now filling in.
       `preventScroll` so focus does not fight the smooth scroll. */
    card.querySelector('[data-firstfield]')?.focus({ preventScroll: true });
    setShowProp(null);
  }, [showProp]);
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState(null);
  /* What was wrong when Submit was pressed: the list for the summary at the
     top, and `errors[path]` for the line under each field. Rechecked on every
     keystroke once it has complained, so the form stops shouting the moment
     it is right. */
  const [problems, setProblems] = useState([]);
  const errors = byPath(problems);
  const clearIfFixed = (nextForm, nextProps) => {
    if (!problems.length) return;
    setProblems(checkApplication({
      form: nextForm || form,
      props: nextProps || props,
    }));
  };
  const fieldProps = (path) => ({
    id: `f-${path}`,
    className: `input${errors[path] ? ' is-bad' : ''}`,
    'aria-invalid': errors[path] ? 'true' : undefined,
    'aria-describedby': errors[path] ? `e-${path}` : undefined,
  });
  const Err = ({ path }) => (errors[path]
    ? <span className="apply-fielderr" id={`e-${path}`}>{errors[path]}</span>
    : null);

  const patchProp = (i, patch) => {
    const next = props.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setProps(next);
    clearIfFixed(null, next);
  };

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
      /* accuracy and the timestamp come free from the fix and are two of the
         five tiles the preview shows — dropping them would leave it reading
         "Not recorded" against a pin that was recorded seconds ago. */
      (pos) => patchProp(i, {
        gps: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
        },
        gpsBusy: false,
      }),
      () => patchProp(i, { gpsBusy: false }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    /* Checked here, not left to the browser: "Please fill in this field" does
       not say which field, how many are left, or why any of it is needed. */
    const found = checkApplication({ form, props });
    setProblems(found);
    if (found.length) {
      const first = document.getElementById(`f-${found[0].path}`);
      if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        first.focus({ preventScroll: true });
      }
      return;
    }
    setState('sending');
    try {
      const body = {
        name: form.name, phone: form.phone,
        email: form.email || undefined,
        /* Not asked for on a referral, so not sent — the broker endpoint does
           not accept them and would reject the whole submission. */
        ...(isReferral ? { source: referralSource } : {
        }),
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
      const res = await fetch(`${API}/franchise/public/${isReferral ? 'properties' : 'enquiries'}`, {
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

  if (!chosen) {
    return (
      <div className="apply-shell">
        <div className="apply-card">
          <span className="apply-brand">Mystery Rooms</span>
          <h1 className="apply-title">Tell us who you are</h1>
          <p style={{ marginTop: 0 }}>
            Both roads end with our expansion team reading what you send. They
            ask for different things, so pick the one that fits.
          </p>
          <div className="apply-who">
            <button type="button" className="apply-who-card" onClick={() => setChosen('franchise')}>
              <Handshake size={20} />
              <b>I want to run a Mystery Rooms</b>
              <span>
                You are applying for a franchise. We will ask about you as well as
                about the property.
              </span>
            </button>
            <button type="button" className="apply-who-card" onClick={() => setChosen('referral')}>
              <MapPin size={20} />
              <b>Broker opportunity</b>
              <span>
                You deal in property. We will ask only about the site — nothing
                about you running it.
              </span>
            </button>
            <button type="button" className="apply-who-card" onClick={() => setChosen('other')}>
              <Users size={20} />
              <b>Someone else — I just know a good site</b>
              <span>
                A friend, a customer, a neighbour. Same few questions about the
                property; we will come back to you either way.
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="apply-shell">
      <form className="apply-card" onSubmit={submit}>
        <span className="apply-brand">Mystery Rooms</span>
        {/* Above the title, where a back control is looked for, and drawn as a
            real button: as a grey text line under the heading it read as a
            caption on the heading rather than something to press. Shown only
            when they were asked — somebody who arrived on the broker link
            directly was never given a choice to go back to. */}
        {!mode && (
          <button
            type="button"
            className="apply-who-back"
            onClick={() => setChosen(null)}
            title="Go back and pick whether you are applying for a franchise, are a broker, or just know of a site"
          >
            <ArrowLeft size={14} /> Back
          </button>
        )}
        <h1 className="apply-title">
          {chosen === 'other'
            ? 'Know a place that would make a good Mystery Rooms?'
            : isReferral ? 'Know a site that would suit Mystery Rooms?' : 'Open a Mystery Rooms in your city'}
        </h1>
        <p style={{ marginTop: 0 }}>
          {isReferral
            ? (chosen === 'other'
              ? 'Tell us about it — where it is, roughly how big, and a photo or two if you have any. You do not need to be in property; our expansion team reads every one of these and will come back to you.'
              : 'Send us the property — where it is, how big it is, and a few photos if you have them. Our expansion team looks at every site personally and will come back to you.')
            : 'Whether you already hold a property or are simply serious about bringing Mystery Rooms to your city — tell us below. Our expansion team reviews every application personally.'}
        </p>

        <h2 className="apply-h"><User size={15} /> About you</h2>
        <div className="apply-grid">
          <label>Full name *
            <input {...fieldProps('name')} value={form.name} onChange={set('name')} placeholder="As it appears on your ID" autoComplete="name" />
            <Err path="name" />
          </label>
          <label>Phone (WhatsApp) *
            <input
              {...fieldProps('phone')} value={form.phone} onChange={set('phone')}
              type="tel" inputMode="numeric" placeholder="10-digit mobile number" autoComplete="tel"
            />
            <Err path="phone" />
          </label>
          <label>Email *
            <input {...fieldProps('email')} type="email" value={form.email} onChange={set('email')} placeholder="name@example.com" autoComplete="email" />
            <Err path="email" />
          </label>
        </div>

        <h2 className="apply-h">
          <Building2 size={15} /> {isReferral ? 'The property' : 'The property for the centre'}
        </h2>
        {hasProperty === true && (
          <>
            <p className="tiny" style={{ color: '#6b7280', margin: '10px 0 0' }}>
              Add every property you'd like us to consider — details, photos, a walkthrough video
              if you have one. More options help our team choose the best site with you.
            </p>
            {/* Above the cards, so a press opens the next one below where you
                pressed rather than behind it. It is also the only place the
                button stays reachable: after twelve full-height property cards
                it was a long scroll from the thing that made you want it. */}
            {props.length < 12 && (
              <button type="button" className="btn btn-subtle apply-addprop" onClick={addProperty}>
                <Plus size={14} /> Add another property
              </button>
            )}
            {props.map((p, i) => (
              <div
                key={i}
                className="apply-prop"
                style={card}
                ref={(el) => { propRefs.current[i] = el; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 14 }}>Property {i + 1}</strong>
                  {props.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProps((ps) => ps.filter((_, idx) => idx !== i))}>
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
                <div className="apply-grid">
                  <label>Name this property <span className="apply-opt">(optional)</span>
                    <input data-firstfield className="input" value={p.label} onChange={(e) => patchProp(i, { label: e.target.value })} placeholder="e.g. DB Mall first-floor shop" />
                  </label>
                  <label>City *
                    <input {...fieldProps(`prop.${i}.city`)} value={p.city} onChange={(e) => patchProp(i, { city: typeName(e.target.value) })} placeholder="e.g. Bhopal" />
                    <Err path={`prop.${i}.city`} />
                  </label>
                  <label>Locality / area *
                    <input {...fieldProps(`prop.${i}.locality`)} value={p.locality} onChange={(e) => patchProp(i, { locality: typePlace(e.target.value) })} placeholder="e.g. Civil Lines" />
                    <Err path={`prop.${i}.locality`} />
                  </label>
                  <label>Carpet area (sq ft) *
                    <input
                      {...fieldProps(`prop.${i}.carpetAreaSqft`)} value={p.carpetAreaSqft}
                      onChange={(e) => patchProp(i, { carpetAreaSqft: typeNumber(e.target.value, 6) })}
                      inputMode="numeric" placeholder="2500–4000 works best"
                    />
                    <Err path={`prop.${i}.carpetAreaSqft`} />
                  </label>
                  <label>Floor <span className="apply-opt">(optional)</span>
                    <input className="input" value={p.floor} onChange={(e) => patchProp(i, { floor: typePlace(e.target.value) })} placeholder="e.g. Ground + first" />
                  </label>
                  <label>Ownership
                    <select className="input" value={p.ownership} onChange={(e) => patchProp(i, { ownership: e.target.value })}>
                      <option value="owned">I own it</option>
                      <option value="family">Family-owned</option>
                      <option value="leased">Leased / can lease</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                </div>
                <label>Full address *
                  <textarea {...fieldProps(`prop.${i}.address`)} rows={2} value={p.address} onChange={(e) => patchProp(i, { address: e.target.value })} placeholder="Shop number, road, landmark, pin code" />
                  <Err path={`prop.${i}.address`} />
                </label>
                <label>Location pin
                  <button type="button" className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => captureGps(i)} disabled={p.gpsBusy}>
                    <MapPin size={13} /> {p.gpsBusy ? 'Getting your location…' : p.gps ? `${p.gps.lat.toFixed(5)}, ${p.gps.lng.toFixed(5)} ✓` : 'Use my location (if you are at the property)'}
                  </button>
                  {/* THE SAME PREVIEW THE PMS USES — the component itself, not a
                      second copy of it. Google's keyless embed with the
                      Map/Satellite toggle, the reverse-geocoded address and the
                      accuracy of the fix, so an applicant checking their own pin
                      sees exactly what the expansion team will see of it. */}
                  {p.gps && (
                    <span className="apply-gps-foot">
                      <button type="button" className="apply-gps-preview" onClick={() => setPreviewGps(p.gps)}>
                        <MapPin size={12} /> Preview location
                      </button>
                      <button type="button" className="apply-gps-clear" onClick={() => patchProp(i, { gps: null })}>
                        Clear pin
                      </button>
                    </span>
                  )}
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

                {/* A <label> with no full-width input inside it collapses to the
                    width of its own text, so this one sat inline and the
                    Documents label floated up beside it — a label, a button and
                    another label crowded onto one line. A block of its own,
                    directly under the videos it belongs to, is where it reads. */}
                <div className="apply-drive">
                  <span className="apply-drive-label">
                    <Link2 size={13} /> Video too big? Paste Google Drive links
                  </span>
                  {/* The button sits ABOVE the boxes it creates, so pressing it
                      opens a new one directly underneath where you pressed —
                      reading downward. Below the list it pushed itself further
                      down the page with every click and the new box appeared
                      behind your finger. */}
                  {p.driveLinks.length < LIMITS.driveLinks && (
                    <button type="button" className="btn btn-ghost btn-sm apply-drive-add"
                      onClick={() => patchProp(i, { driveLinks: [...p.driveLinks, ''] })}>
                      <Plus size={12} /> Add a Drive link
                    </button>
                  )}
                  {p.driveLinks.map((l, li) => (
                    <span key={li} className="apply-drive-row">
                      <input
                        {...fieldProps(`prop.${i}.driveLinks.${li}`)} type="url" value={l} placeholder="https://drive.google.com/…"
                        onChange={(e) => patchProp(i, { driveLinks: p.driveLinks.map((x, xi) => (xi === li ? e.target.value : x)) })}
                      />
                      <button type="button" className="apply-drive-x" aria-label="Remove this link"
                        onClick={() => patchProp(i, { driveLinks: p.driveLinks.filter((_, xi) => xi !== li) })}>×</button>
                    </span>
                  ))}
                </div>

                <label><FileText size={13} /> Documents — plans, papers, brochure (up to {LIMITS.documents})
                  <input className="input" type="file" accept={ACCEPT.documents} multiple disabled={uploading || p.documents.length >= LIMITS.documents}
                    onChange={(e) => { addFiles(i, 'documents', e.target.files); e.target.value = ''; }} />
                </label>
                {fileChips(i, 'documents')}

                <label>Anything about this property?<textarea className="input" rows={2} value={p.remarks} onChange={(e) => patchProp(i, { remarks: e.target.value })} placeholder="Footfall nearby, parking, rent expectations…" /></label>
              </div>
            ))}
          </>
        )}

        <label style={{ marginTop: 12, display: 'block' }}>Anything else we should know? <span className="apply-opt">(optional)</span>
          <textarea className="input" rows={3} value={form.message} onChange={set('message')} placeholder="Why this city, your timeline, questions for us…" />
        </label>

        {/* The honeypot — invisible to people, irresistible to bots. */}
        <input className="apply-hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} placeholder="Website" aria-hidden="true" />

        {uploading && <p className="tiny" style={{ margin: '6px 0' }}><Loader2 size={12} className="spin" /> Uploading…</p>}
        {problems.length > 0 && (
          /* WHAT is missing, HOW MANY, and WHY it stops the application —
             counted, listed and clickable, because "check the highlighted
             fields" makes a person hunt through their own form. */
          <div className="apply-summary" role="alert">
            <p className="apply-summary-head">
              <AlertTriangle size={15} /> {summaryLine(problems.length)}
            </p>
            <ol>
              {problems.map((pr) => (
                <li key={pr.path}>
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(`f-${pr.path}`);
                      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
                    }}
                  >
                    {pr.label}
                  </button>
                  <span> — {pr.message}</span>
                </li>
              ))}
            </ol>
            <p className="apply-summary-foot">
              Nothing you have written is lost. Fill these in and press Submit again.
            </p>
          </div>
        )}

        {error && <div className="apply-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={state === 'sending' || uploading} style={{ width: '100%', marginTop: 14, padding: 12 }}>
          {state === 'sending' ? 'Sending…' : 'Submit my application'}
        </button>
        <p className="tiny" style={{ color: '#6b7280', marginTop: 10 }}>
          Your details go directly to the Mystery Rooms expansion team and are used only to evaluate this application.
        </p>
      </form>
      {/* One instance for the page: the pin being previewed is whichever was
          clicked, so a second modal per property would be dead weight. */}
      <LocationPreviewModal open={!!previewGps} value={previewGps} onClose={() => setPreviewGps(null)} />
    </div>
  );
}

export default FranchiseApplyPage;
