import { useEffect, useRef, useState, useMemo } from 'react';
import { Play, MapPin, Camera, Sparkles } from 'lucide-react';
import { useFieldAssist } from '../../../app/api/aiApi.js';
import { NumberInput } from '../../../components/ui/NumberInput.jsx';
import { DatePicker } from '../../../components/ui/DatePicker.jsx';
import { Badge } from '../../../components/ui/primitives.jsx';
import { useDestroyMedia, useStageRecords, useGlobalStageRecords } from '../../../app/api/recordsApi.js';
import { useGames, areaLabel } from '../../../app/api/gamesApi.js';
import { useGetVendorMasterQuery, asPickerRow } from '../../../app/api/vendorMasterApi.js';
import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { fmtFileSize, fmtDuration } from '../../../lib/format.js';
import { LocationPreviewModal } from './LocationPreviewModal.jsx';
import { MediaCaptureModal } from './MediaCaptureModal.jsx';
import { LayoutPlanner } from './LayoutPlanner.jsx';
// Mock roster kept ONLY as a display fallback for legacy stored ids
// ('emp-prj-002' ...) — pickers read the real user directory via useEmployees.
import { getEmployeeById } from '../../../lib/employees.js';
import { useEmployees } from '../../../hooks/useEmployees.js';

const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg']);
const SHEET_EXT = new Set(['xls', 'xlsx', 'csv']);
const OFFICE_EXT = new Set(['doc', 'docx', 'ppt', 'pptx']);
const ARCHIVE_EXT = new Set(['zip', 'rar']);

const extOf = (name = '') => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();

/** One of: image | video | audio | pdf | sheet | office | archive | other. */
function kindOf(entry) {
  const mt = entry.mimetype || entry.type || '';
  const ext = extOf(entry.name || entry.originalName || '');
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio';
  if (ext === 'pdf' || mt === 'application/pdf') return 'pdf';
  if (SHEET_EXT.has(ext)) return 'sheet';
  if (OFFICE_EXT.has(ext)) return 'office';
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  return 'other';
}

const KIND_EMOJI = { image: '🖼', video: '🎥', audio: '🎵', pdf: '📄', sheet: '📊', office: '📄', archive: '🗜', other: '📄' };

const ellipsisName = {
  display: 'block',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/**
 * Shared add/remove semantics for any field storing a list of media entries
 * (picked files or recorded clips) — both FileField and AudioRecorderField
 * build on this so "pending vs uploaded" handling lives in exactly one place.
 */
function useMediaEntries(field, value, onChange) {
  const destroy = useDestroyMedia();
  const isMulti = !!field.multiple;
  const entries = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];

  const commit = (next) => onChange(isMulti ? next : next[0] || null);
  const addMany = (newEntries) => commit([...entries, ...newEntries]);
  const remove = (entry) => {
    if (entry.pending) {
      URL.revokeObjectURL(entry.previewUrl);
      commit(entries.filter((x) => x.id !== entry.id));
    } else {
      if (entry.publicId) destroy.mutate({ publicId: entry.publicId, resourceType: entry.resourceType });
      commit(entries.filter((x) => x.publicId !== entry.publicId));
    }
  };

  return { entries, isMulti, addMany, remove };
}

/**
 * Renders the entry list shared by FileField and AudioRecorderField: a
 * thumbnail/icon, name (ellipsised, never wraps), size (+ duration for
 * audio/video), an inline player for audio, Preview/Open, and Remove.
 * `onRemove` omitted (view mode) simply drops the Remove button — everything
 * else (thumbnails, Preview/Open, the audio player) stays, since those are
 * just viewing, not mutating.
 */
function MediaEntryList({ entries, onRemove, removeLabel = 'Remove' }) {
  const [durations, setDurations] = useState({}); // entry id/publicId -> seconds, from <audio> metadata

  if (!entries.length) return null;
  return (
    <div className="col gap-2">
      {entries.map((entry) => {
        const kind = kindOf(entry);
        const src = entry.pending ? entry.previewUrl : entry.url;
        const durationKey = entry.pending ? entry.id : entry.publicId;
        const duration = entry.duration ?? durations[durationKey];
        return (
          <div
            key={entry.pending ? entry.id : entry.publicId}
            className="row gap-2"
            style={{ padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', alignItems: 'center' }}
          >
            {kind === 'image' ? (
              <a href={src} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
                <img src={src} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />
              </a>
            ) : kind === 'video' ? (
              <a href={src} target="_blank" rel="noreferrer" style={{ position: 'relative', flexShrink: 0, display: 'block' }}>
                {/* A muted <video> with no controls renders its first frame as a static thumbnail. */}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={src} muted preload="metadata" style={{ width: 56, height: 44, objectFit: 'cover', borderRadius: 6, background: '#000' }} />
                <Play size={16} color="#fff" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
              </a>
            ) : (
              <span className="center" style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--surface-hover)', fontSize: 18, flexShrink: 0 }}>
                {KIND_EMOJI[kind]}
              </span>
            )}

            <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
              <span className="sm" style={{ fontWeight: 600, ...ellipsisName }} title={entry.name || entry.originalName}>
                {entry.name || entry.originalName || 'file'}
              </span>
              <span className="tiny muted row gap-2">
                <span>{fmtFileSize(entry.size ?? entry.bytes)}</span>
                {duration != null && <span>· {fmtDuration(duration)}</span>}
                {!entry.pending && <span style={{ color: 'var(--success)' }}>· ✓ Uploaded</span>}
                {entry.pending && <span style={{ color: 'var(--text-subtle)' }}>· Not yet uploaded</span>}
              </span>
              {kind === 'audio' && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio
                  src={src}
                  controls
                  style={{ height: 30, maxWidth: 260 }}
                  onLoadedMetadata={(e) => setDurations((d) => ({ ...d, [durationKey]: e.target.duration }))}
                />
              )}
            </div>

            <span className="row gap-1" style={{ flexShrink: 0 }}>
              {kind !== 'audio' && (
                <a className="btn btn-ghost btn-sm" href={src} target="_blank" rel="noreferrer">
                  {kind === 'pdf' ? 'Preview' : 'Open'}
                </a>
              )}
              {onRemove && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(entry)}>{removeLabel}</button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Media picker for `file` fields — deferred upload. Selecting a file only adds
 * it to a local preview list (object URL, no network call); the actual upload
 * to S3 happens later, orchestrated by RecordFormModal right before
 * Save Draft / Submit persists the record. Entries not yet uploaded carry
 * `pending: true`; RecordFormModal resolves those into real refs at save time.
 */
function FileField({ field, value, onChange, readOnly }) {
  const { entries, isMulti, addMany, remove } = useMediaEntries(field, value, onChange);
  const idRef = useRef(0);
  const [capturing, setCapturing] = useState(false);
  const canAdd = !readOnly && (isMulti || entries.length === 0);

  // Add picked files (from the modal's Documents tab) as deferred-upload
  // entries — same shape a captured photo/video uses.
  const addFiles = (files) => {
    const added = [...files].map((file) => ({
      pending: true,
      id: `p${(idRef.current += 1)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
      mimetype: file.type,
    }));
    if (added.length) addMany(added);
  };

  const onCaptured = ({ file, duration }) => {
    addMany([{
      pending: true,
      id: `p${(idRef.current += 1)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
      mimetype: file.type,
      ...(duration != null ? { duration } : {}),
    }]);
  };

  if (readOnly && !entries.length) return <span className="sm muted">—</span>;

  return (
    <div className="col gap-2">
      {/* Only "Capture" outside — selecting documents now lives inside the modal
          (its Documents tab), which handles any kind of file. */}
      {canAdd && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ alignSelf: 'flex-start' }}
          title="Capture a photo/video or select documents"
          onClick={() => setCapturing(true)}
        >
          <Camera size={13} style={{ marginRight: 6, verticalAlign: '-2px' }} /> Capture
        </button>
      )}
      <MediaEntryList entries={entries} onRemove={readOnly ? undefined : remove} />
      <MediaCaptureModal
        open={capturing}
        onClose={() => setCapturing(false)}
        onCapture={onCaptured}
        onSelectFiles={addFiles}
        multiple={isMulti}
      />
    </div>
  );
}

const RECORDER_MIME_CANDIDATES = ['audio/webm', 'audio/ogg', 'audio/mp4'];
const RECORDER_EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

/**
 * In-browser microphone recorder for `file` fields marked `recordAudio: true`
 * (replaces the file-picker button entirely). Records via MediaRecorder, then
 * hands the finished clip to the same deferred-upload pipeline FileField uses
 * — it's just another pending entry, uploaded only on Save Draft / Submit.
 */
function AudioRecorderField({ field, value, onChange, readOnly }) {
  const { entries, isMulti, addMany, remove } = useMediaEntries(field, value, onChange);
  const idRef = useRef(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  const [status, setStatus] = useState('idle'); // idle | requesting | recording | paused
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  const canAdd = !readOnly && (isMulti || entries.length === 0);
  const isBusy = status === 'recording' || status === 'paused' || status === 'requesting';

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  const startTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };
  const stopTimer = () => clearInterval(timerRef.current);

  /** Imperative-only teardown (no state updates) — safe to call on unmount. */
  const discardRecording = () => {
    stopTimer();
    if (recorderRef.current) {
      recorderRef.current.onstop = null; // stopping the stream would otherwise auto-fire
      // onstop and finalize a stray entry — null it first so the in-progress
      // recording is genuinely discarded, matching "Cancel/close discards temp files".
      try { recorderRef.current.stop(); } catch { /* already inactive */ }
    }
    stopStream();
    chunksRef.current = [];
  };

  // Closing the form (Cancel, backdrop click, Escape, or the X button) while
  // recording must discard it, not silently finalize it after unmount.
  useEffect(() => () => discardRecording(), []);

  const start = async () => {
    setError('');
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = RECORDER_MIME_CANDIDATES.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stopTimer();
        stopStream();
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const ext = RECORDER_EXT[type.split(';')[0]] || 'webm';
        const file = new File([blob], `Recording ${new Date().toLocaleTimeString()}.${ext}`, { type });
        addMany([{
          pending: true,
          id: `p${(idRef.current += 1)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          name: file.name,
          size: file.size,
          mimetype: file.type,
          duration: seconds,
        }]);
        setSeconds(0);
        setStatus('idle');
      };
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setStatus('recording');
      startTimer();
    } catch {
      setStatus('idle');
      setError('Microphone permission was denied or is unavailable — check your browser settings.');
    }
  };

  const pause = () => { recorderRef.current?.pause(); stopTimer(); setStatus('paused'); };
  const resume = () => { recorderRef.current?.resume(); startTimer(); setStatus('recording'); };
  const stop = () => recorderRef.current?.stop(); // finalizes via onstop → adds the entry

  const cancel = () => {
    discardRecording();
    setSeconds(0);
    setStatus('idle');
  };

  if (readOnly && !entries.length) return <span className="sm muted">—</span>;

  return (
    <div className="col gap-2">
      {!isBusy && canAdd && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={start}>
          🎙 Record Audio
        </button>
      )}
      {status === 'requesting' && <span className="tiny muted">Requesting microphone permission…</span>}
      {(status === 'recording' || status === 'paused') && (
        <div
          className="row gap-3 wrap"
          style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', alignItems: 'center' }}
        >
          <span className="row gap-2 sm" style={{ fontWeight: 650 }}>
            <span
              style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: status === 'recording' ? 'var(--danger)' : 'var(--text-subtle)',
              }}
            />
            {fmtDuration(seconds)}
          </span>
          <span className="row gap-1 wrap">
            {status === 'recording' ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={pause}>Pause</button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resume}>Resume</button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={stop}>Stop</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>Cancel</button>
          </span>
        </div>
      )}
      {error && <span className="tiny" style={{ color: 'var(--danger)' }}>{error}</span>}
      <MediaEntryList entries={entries} onRemove={readOnly ? undefined : remove} removeLabel="Delete Recording" />
    </div>
  );
}

/**
 * `select` field with an "Other" free-text fallback. Several schema fields
 * (Floor, Vendor Category, Document Category, Payment Mode, …) list 'Other'
 * as an option purely as a "type your own" escape hatch — picking it swaps
 * the dropdown for a text input, and whatever the user types there becomes
 * the field's actual stored value directly (no separate "_other" companion
 * field, no schema/backend change). Fields whose options don't include
 * 'Other' behave exactly like a plain select, unaffected.
 */
function SelectField({ field, value, onChange, readOnly }) {
  const options = field.options || [];
  const isCustomValue = !!value && !options.includes(value);
  const [customMode, setCustomMode] = useState(isCustomValue);

  if (readOnly) {
    if (isCustomValue) return <span className="sm">{value}</span>;
    return (
      <select id={`field-${field.key}`} className="select" disabled value={value ?? ''} onChange={() => { }}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (customMode) {
    return (
      <input
        id={`field-${field.key}`}
        className="input"
        value={value ?? ''}
        placeholder="Please specify…"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <select
      id={`field-${field.key}`}
      className="select"
      value={options.includes(value) ? value : ''}
      onChange={(e) => {
        if (e.target.value === 'Other') {
          setCustomMode(true);
          onChange('');
        } else {
          onChange(e.target.value);
        }
      }}
    >
      <option value="">Select…</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** Pull "lat,lng" out of a pasted Google Maps URL or raw coordinate string. */
function parseCoords(text) {
  const m = String(text).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

/**
 * COORDINATES OUT OF A GOOGLE MAPS LINK.
 *
 * A pasted link is stored as `{ mapUrl }` with no lat/lng, so there is nothing
 * to reverse-geocode from unless they can be read back out of the URL. Google
 * writes them in two places — `@lat,lng,zoom` in the path of a place link, and
 * `?q=` / `?ll=` / `!3dlat!4dlng` in the query — so all three are tried.
 *
 * A SHORT LINK (maps.app.goo.gl) CARRIES NONE OF THEM. It resolves only by
 * following a redirect, which the browser cannot do cross-origin. Those return
 * null and the address is simply not auto-filled — which is the honest
 * outcome; the box stays empty and typeable rather than being filled with a
 * guess.
 */
function coordsFromMapUrl(url) {
  const s = String(url || '');
  const at = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  const d = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (d) return { lat: Number(d[1]), lng: Number(d[2]) };
  const q = s.match(/[?&](?:q|ll|daddr)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (q) return { lat: Number(q[1]), lng: Number(q[2]) };
  return null;
}

/**
 * The street address for a pin — OpenStreetMap's Nominatim, keyless, the same
 * endpoint LocationPreviewModal already reverse-geocodes with. Returns null on
 * anything at all going wrong: a network failure here must never stop somebody
 * filling in a form, and a wrong address is worse than none.
 */
async function addressForPin({ lat, lng }) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.display_name || null;
  } catch {
    return null;
  }
}

const isGps = (v) =>
  v && typeof v === 'object' && typeof v.lat === 'number' && typeof v.lng === 'number';
const isMapUrl = (v) => v && typeof v === 'object' && typeof v.mapUrl === 'string' && v.mapUrl;
const hasLocation = (v) => isGps(v) || isMapUrl(v);
const mapsHref = (v) => (isGps(v) ? `https://www.google.com/maps?q=${v.lat},${v.lng}` : v.mapUrl);

/** A pasted value is a usable URL (Google Maps link) if it parses as http(s). */
function isValidUrl(text) {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Live Location capture (optional). Two ways to set it:
 *  1. Geolocation API → { lat, lng, capturedAt }.
 *  2. Paste a Google Maps link → { mapUrl }  (also accepts raw "lat, lng").
 * Shows a success indicator, an "Open in Google Maps" link, and edit/remove.
 */
function LocationInput({ value, onChange, readOnly, onResolveAddress }) {
  const [status, setStatus] = useState('idle'); // idle | loading | denied
  const [manual, setManual] = useState('');
  const [manualErr, setManualErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [showMap, setShowMap] = useState(false); // location-preview popup
  const authUser = useAppSelector(selectCurrentUser);

  const captured = hasLocation(value);
  const showControls = !readOnly && (editing || !captured);

  if (readOnly && !captured) return <span className="sm muted">—</span>;

  /**
   * THE PIN ANSWERS THE ADDRESS BOX.
   *
   * Every way of setting a location ends here, so there is one place that
   * resolves a street address for it and hands it to whoever asked
   * (`onResolveAddress` — the property capture form routes it into Full
   * Address). Fire-and-forget on purpose: the pin is already saved, and a
   * geocoder that is slow or down must not hold up the form or fail it.
   */
  const resolveAddress = (coords) => {
    if (!onResolveAddress || !coords) return;
    addressForPin(coords).then((text) => { if (text) onResolveAddress(text); });
  };

  const capture = () => {
    if (!navigator.geolocation) {
      setStatus('denied');
      return;
    }
    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onChange({
          ...coords,
          capturedAt: new Date().toISOString(),
          ...(Number.isFinite(pos.coords.accuracy) ? { accuracy: pos.coords.accuracy } : {}),
          ...(authUser ? { capturedBy: { name: authUser.name, role: authUser.role } } : {}),
        });
        resolveAddress(coords);
        setStatus('idle');
        setEditing(false);
      },
      () => setStatus('denied'), // permission denied / unavailable → paste fallback
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const applyText = (text) => {
    if (!text) return;
    const coords = parseCoords(text); // raw "lat, lng" still supported
    if (coords) {
      onChange({ ...coords, capturedAt: new Date().toISOString() });
      resolveAddress(coords);
    } else if (isValidUrl(text)) {
      onChange({ mapUrl: text });
      /* A pasted Maps link usually carries its coordinates somewhere in the
         URL; a short link does not, and then nothing is filled in. */
      resolveAddress(coordsFromMapUrl(text));
    } else {
      setManualErr('Enter a valid Google Maps link or “lat, lng” coordinates.');
      return;
    }
    setManual('');
    setManualErr('');
    setStatus('idle');
    setEditing(false);
  };

  // Pasting a link or coordinates sets it immediately — no separate confirm
  // step. Reads straight off the clipboard event so it applies in the same
  // tick as the paste, rather than waiting on the input's own onChange.
  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text').trim();
    if (!text) return;
    e.preventDefault();
    applyText(text);
  };

  const remove = () => {
    onChange(null);
    setManual('');
    setManualErr('');
    setStatus('idle');
    setEditing(false);
  };

  return (
    <div className="col gap-2">
      {captured && !editing && (
        <div
          className="col gap-1"
          style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}
        >
          <span className="tiny" style={{ color: 'var(--success)', fontWeight: 650 }}>
            ✓ Location {isGps(value) ? 'captured' : 'link added'}
          </span>
          <div className="row between gap-2 wrap">
            <button
              type="button"
              className="sm row gap-1"
              onClick={() => setShowMap(true)}
              style={{ fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', alignItems: 'center' }}
              title="Preview location"
            >
              <MapPin size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
              Open in Google Maps
              {isGps(value) ? ` · ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : ''}
            </button>
            {!readOnly && (
              <span className="row gap-1" style={{ flexShrink: 0 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>Remove</button>
              </span>
            )}
          </div>
        </div>
      )}

      {showControls && (
        <div className="col gap-2">
          <div className="row gap-2 wrap">
            <button type="button" className="btn btn-ghost btn-sm" onClick={capture} disabled={status === 'loading'}>
              {status === 'loading' ? 'Locating…' : '📍 Capture Location'}
            </button>
            {captured && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            )}
          </div>
          <div className="col gap-1">
            {status === 'denied' && (
              <span className="tiny" style={{ color: 'var(--danger)' }}>
                Location unavailable — paste a Google Maps link instead.
              </span>
            )}
            <div className="row gap-2">
              <input
                className="input grow"
                placeholder='Paste Google Maps link  or  "23.2599, 77.4126"'
                value={manual}
                onChange={(e) => {
                  setManual(e.target.value);
                  setManualErr('');
                }}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); applyText(manual.trim()); }
                }}
              />
            </div>
            {manualErr && <span className="tiny" style={{ color: 'var(--danger)' }}>{manualErr}</span>}
          </div>
        </div>
      )}

      <LocationPreviewModal open={showMap && captured} onClose={() => setShowMap(false)} value={value} />
    </div>
  );
}

/**
 * DynamicField — renders one input for a `masterDataSchema` field, chosen by
 * `field.type`. One branch per type, so adding a new field type later is a
 * self-contained change (Phase-1 spec §8). Reuses the app's existing input
 * classes (`input` / `select` / `textarea`) and `NumberInput`.
 *
 * Props:
 *  - field:    { key, label, type, options?, placeholder?, multiple?, accept? }
 *  - value:    current value (controlled)
 *  - onChange: (nextValue) => void
 *  - error:    optional inline error string
 *  - readOnly: render the submitted value only, no editing (RecordFormModal's
 *              View mode) — every branch below degrades to a disabled input
 *              or a static "—", rather than a second field renderer, so the
 *              two modes can never drift apart from schema changes.
 */
/**
 * A `user`-type field: pick a person from the REAL employee directory.
 *
 * Built on useEmployees (both branches fixed the mock-roster bug; the hook is
 * the fuller fix): registered accounts only, cached across the app, with
 * legacy roster ids still resolvable for display. Storing a real User id is
 * also what lets the server match Project Setup's "Project Manager" to
 * `project.owner` — an invented roster name could never match.
 *
 * Its own component (not inline in the switch) because it uses a hook.
 */
function UserSelect({ field, value, onChange, readOnly }) {
  const { employees, resolve } = useEmployees();
  // `resolve` first (correct on first paint), module cache as last resort.
  const nameOf = (id) => (!id ? '—' : resolve(id)?.name || getEmployeeById(id)?.name || id);

  if (readOnly) return <span className="sm">{nameOf(value)}</span>;

  // A template may still pin explicit options; otherwise the live directory.
  const fromOptions = field.options?.length;
  const options = fromOptions ? field.options : employees;
  return (
    <select
      id={`field-${field.key}`}
      className="select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o.value || o.id || o} value={o.value || o.id || o}>{o.label || o.name || o}</option>
      ))}
      {/* A stored value not in the current list (deactivated user, legacy
          roster id) stays selectable rather than silently vanishing. */}
      {value && !fromOptions && !employees.some((e) => String(e.id) === String(value)) && (
        <option value={value}>{nameOf(value)}</option>
      )}
    </select>
  );
}

/**
 * Is this the field that means "pick a vendor"?
 *
 * Named once, here, rather than spelled out at each use. Two schema fields
 * declare it — the BOQ line's Vendor (Phase 5, which is also the purchase
 * order) and the work order's Vendor (Phase 6) — and both must offer the same
 * list, because they are the same choice made twice about one order.
 */
const isVendorPicker = (cfg) => cfg?.stageKey === 'p12' && cfg?.field === 'vendor_name';

/**
 * A select whose options are another stage's records — the schema's
 * `optionsFromStage: { stageKey, field }`. The BOQ's Vendor picks from the
 * vendor master rather than retyping a name, and shows the picked vendor's own
 * contact details underneath so "auto-fetched" is visible, not taken on faith.
 *
 * THE VENDOR PICKER READS TWO LISTS, because the business has two and a buyer
 * placing an order does not care which one a supplier is on:
 *
 *   - the p12 records — vendors already ENGAGED on some project, with their
 *     quotes and terms, which is where this field has always looked; and
 *   - Master Data → Vendors, the standing supply list off F Vendor.xlsx. The
 *     balloon supplier we have rung for years is on that list and on no
 *     project's Phase 4B, so before this it could not be chosen on an order at
 *     all — somebody had to type the name in somewhere else first.
 *
 * Merged rather than switched: dropping the p12 half would empty the dropdown
 * on every project mid-flight. Names are deduplicated, and where a firm is on
 * both lists the p12 record wins the "Fetched:" details, since a vendor
 * engaged on a project has been confirmed more recently than the master.
 */
function StageOptionsSelect({ field, value, onChange, onFill, readOnly, projectId }) {
  const cfg = field.optionsFromStage;
  // `scope: 'global'` reads the stage across every project — a company-wide
  // master. Vendors are the case that forced it: a supplier finalised on one
  // launch is the same supplier on the next, so scoping the picker to THIS
  // project left it empty on every project but the one the vendor was typed
  // into. Both hooks are called unconditionally (rules of hooks); the unused
  // one is skipped, so only one request is ever issued.
  const isGlobal = cfg?.scope === 'global';
  const scoped = useStageRecords(projectId, cfg?.stageKey, {}, { enabled: !isGlobal && Boolean(projectId && cfg?.stageKey) });
  const global = useGlobalStageRecords(cfg?.stageKey, { enabled: isGlobal && Boolean(cfg?.stageKey) });
  // Same rule: called unconditionally, fetched only for the one field that
  // wants it, so no other dropdown pays for the vendor master.
  const master = useGetVendorMasterQuery(undefined, { skip: !isVendorPicker(cfg) });
  const data = isGlobal ? global.data : scoped.data;
  const stageRows = data?.data || data || [];
  const masterRows = (master.data?.data || master.data || []).map(asPickerRow);
  // p12 first, so its values win the dedupe below.
  const rows = [...stageRows, ...masterRows];

  const names = [...new Set(rows.map((r) => r.values?.[cfg?.field]).filter(Boolean))];
  const chosen = rows.find((r) => r.values?.[cfg?.field] === value);
  const cv = chosen?.values || {};
  /* What the chosen firm supplies. Only the master knows it, and it is the
     reason this supplier was picked ("Balloon" is why you chose Utsav
     Trading). ALL its rows are read, not just the first: one firm can be
     listed under several items — the sheet has Engenius Lab under both
     "Modules" and "Modules and Sensor" — and showing one of the two would
     quietly misreport what we buy from them. */
  const suppliedItems = [...new Set(
    masterRows
      .filter((r) => r.values?.vendor_name === value && r.values?.item)
      .map((r) => r.values.item),
  )].join(', ');
  const details = [suppliedItems, cv.contact_person, cv.contact_phone, cv.email]
    .filter(Boolean).join(' · ');

  if (readOnly) return <span className="sm">{value || '—'}</span>;

  return (
    <div className="col gap-1">
      <select
        id={`field-${field.key}`}
        className="select"
        value={value ?? ''}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          // `fillFrom: { targetKey: sourceKey }` — picking an entry copies the
          // source record's values into the form (still editable afterwards).
          // The Phase 6 indent's 'Item from BOQ' uses this so vendor, items,
          // quantity, rate and value never have to be retyped from Phase 5.
          if (onFill && field.fillFrom && next) {
            const src = rows.find((r) => r.values?.[cfg?.field] === next);
            if (src) {
              const patch = {};
              for (const [target, source] of Object.entries(field.fillFrom)) {
                const val = src.values?.[source];
                if (val !== undefined && val !== null && val !== '') patch[target] = val;
              }
              if (Object.keys(patch).length) onFill(patch);
            }
          }
        }}
      >
        <option value="">Select…</option>
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
        {/* A stored value whose source record was renamed/removed stays
            selectable rather than silently vanishing from the form. */}
        {value && !names.includes(value) && <option value={value}>{value}</option>}
      </select>
      {details && <span className="tiny muted">Fetched: {details}</span>}
      {!names.length && (
        <span className="tiny muted">
          {isVendorPicker(cfg)
            ? 'No vendors yet — add one under Master Data → Vendors and it appears here for every project.'
            : isGlobal
              ? 'No entries in the master yet — add one and it appears here for every project.'
              : 'Nothing recorded in that phase yet — add entries there first.'}
        </span>
      )}
    </div>
  );
}

/**
 * The small AI helper inside a textarea (opt-in via `field.aiAssist`).
 * Two verbs, both modest: Suggest drafts the field from the rest of the form;
 * Improve tidies what the user wrote without replacing their meaning. The
 * result lands in the ordinary editable field — nothing is saved by the click.
 */
function FieldAssist({ field, value, onChange, formValues }) {
  const assist = useFieldAssist();
  const [err, setErr] = useState(null);

  const run = async (mode) => {
    setErr(null);
    try {
      // The rest of the form, minus files/objects the model can't read and
      // minus this field itself (it travels as currentValue in improve mode).
      const context = {};
      for (const [k, val] of Object.entries(formValues || {})) {
        if (k === field.key) continue;
        if (val == null || typeof val === 'object' && !Array.isArray(val)) continue;
        context[k] = val;
      }
      const out = await assist.mutateAsync({
        label: field.label || field.key,
        helpText: field.helpText,
        currentValue: mode === 'improve' ? String(value || '') : undefined,
        context,
        mode,
      });
      if (out?.text) onChange(out.text);
    } catch (e) {
      setErr(e?.response?.data?.message || 'AI is unavailable right now.');
    }
  };

  const hasText = Boolean(String(value || '').trim());
  return (
    <div className="fassist">
      <span className="fassist-buttons">
        <button type="button" className="fassist-btn" disabled={assist.isPending} onClick={() => run('suggest')}>
          <Sparkles size={11} aria-hidden /> {assist.isPending ? 'Working…' : 'Suggest'}
        </button>
        {hasText && (
          <button type="button" className="fassist-btn" disabled={assist.isPending} onClick={() => run('improve')}>
            Improve
          </button>
        )}
      </span>
      {err && <span className="fassist-err">{err}</span>}
    </div>
  );
}


/**
 * Options that come from somewhere other than the field's own `options` list.
 *
 *   optionsFrom: 'games'          the game catalogue (Master Data → Games)
 *   optionsFrom: 'project_games'  only the games THIS project chose in Phase 3B
 *
 * The second one is the point of the pair: Phase 10 installs games, and the
 * only games it can possibly install are the ones the outlet actually picked.
 * Offering the whole catalogue there invites a typo into the install record
 * for a game the site was never going to have.
 *
 * Returns `null` when the field names no source, so the caller falls back to
 * its static `options` and nothing else changes.
 */
function useDynamicOptions(field, projectId) {
  const source = field?.optionsFrom || null;
  // Both hooks run unconditionally (rules of hooks); the unused one is skipped.
  const games = useGames(false);
  const planStage = useStageRecords(projectId, 'p20', {}, { enabled: source === 'project_games' && Boolean(projectId) });

  return useMemo(() => {
    if (!source) return null;
    if (source === 'games') {
      const rows = games.data?.data || games.data || [];
      return {
        values: rows.map((g) => g.name),
        labelOf: (v) => {
          const g = rows.find((x) => x.name === v);
          return g ? `${g.name}${areaLabel(g) ? ` — ${areaLabel(g)}` : ''}` : v;
        },
        loading: games.isLoading,
        empty: !games.isLoading && rows.length === 0
          ? 'No games in the catalogue yet — add them under Master Data → Games.'
          : null,
      };
    }
    if (source === 'project_games') {
      const rows = planStage.data?.data || planStage.data || [];
      // Phase 3B files one plan record; take every game any of them selected.
      const picked = [...new Set(rows.flatMap((r) => {
        const v = r.values?.selected_games;
        return Array.isArray(v) ? v : (v ? [v] : []);
      }))];
      return {
        values: picked,
        labelOf: (v) => v,
        loading: planStage.isLoading,
        empty: !planStage.isLoading && picked.length === 0
          ? 'No games chosen yet — pick them in Phase 3B (Project Planning & Games) first.'
          : null,
      };
    }
    return null;
  }, [source, games.data, games.isLoading, planStage.data, planStage.isLoading]);
}

export function DynamicField({
  field, value, onChange, onFill, error, readOnly = false, formValues = null, projectId = null,
  /* A location field calls this with the street address its pin resolves to.
     Only the form that has somewhere to put it passes one. */
  onResolveAddress = null,
  /* Values already used elsewhere for this field, offered as you type. */
  suggestions = null,
}) {
  const dynamic = useDynamicOptions(field, projectId);
  const common = {
    className: 'input',
    id: `field-${field.key}`,
    value: value ?? '',
    placeholder: field.placeholder || (field.label ? `Enter ${field.label.toLowerCase()}` : ''),
    'aria-invalid': error ? true : undefined,
    disabled: readOnly,
    onChange: (e) => onChange(e.target.value),
  };

  let input;
  switch (field.type) {
    case 'textarea':
      input = (
        <div className="fassist-wrap">
          <textarea {...common} className="textarea" rows={3} />
          {field.aiAssist && !readOnly && (
            <FieldAssist field={field} value={value} onChange={onChange} formValues={formValues} />
          )}
        </div>
      );
      break;

    case 'number': {
      const isPct = field.variant === 'percentage' || (field.label && field.label.includes('%')) || field.key === 'roi' || field.key === 'profit_margin' || field.key === 'revenue_share_pct' || field.key === 'progress_pct';
      const isDurationMonths = field.variant === 'months'
        || ['payback_period', 'lease_duration', 'lockin_period_months', 'notice_period_months'].includes(field.key)
        || (field.label && /\bmonths?\b/i.test(field.label) && !/monthly|cost|rent|revenue|amount|budget|investment/i.test(field.label));
      const effectiveMin = field.min !== undefined ? field.min : (isDurationMonths ? 1 : 0);
      const effectiveMax = field.max !== undefined ? field.max : (isPct ? 100 : (isDurationMonths ? 360 : undefined));
      const effectiveVariant = isPct ? 'percentage' : (isDurationMonths ? 'integer' : field.variant);

      input = (
        <NumberInput
          {...common}
          variant={effectiveVariant}
          min={effectiveMin}
          max={effectiveMax}
          integer={isDurationMonths || field.integer}
          placeholder={field.placeholder || (isPct ? '0–100%' : (isDurationMonths ? '1–360 months' : field.placeholder))}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    }

    case 'currency': {
      const effectiveMin = field.min !== undefined ? field.min : 0;
      const effectiveMax = field.max !== undefined ? field.max : 500000000;
      input = (
        <NumberInput
          {...common}
          min={effectiveMin}
          max={effectiveMax}
          placeholder={field.placeholder || '₹ Enter amount'}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    }

    case 'date':
      /* Our own calendar, not the browser's — see components/ui/DatePicker.jsx.
         The native one is chrome we cannot size or move, and on a phone it
         opened wider than the screen. `common` carries onChange as a DOM event
         handler, so it is overridden with the plain value the picker emits;
         what gets stored (YYYY-MM-DD) is identical either way. */
      input = (
        <DatePicker
          {...common}
          onChange={onChange}
          value={value ? String(value).slice(0, 10) : ''}
          placeholder={field.placeholder || 'Select a date'}
        />
      );
      break;

    case 'boolean':
      input = (
        <select id={`field-${field.key}`} className="select" disabled={readOnly} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
      break;

    case 'select':
      /* `radio: true` — a short choice (Yes / No) drawn as radio buttons, so
         the answer is one click and visible at a glance. */
      if (field.radio && !field.optionsFromStage) {
        input = (
          <div className="df-radios" role="radiogroup" aria-label={field.label}>
            {(field.options || []).map((opt) => (
              <label key={opt} className={`df-radio${String(value) === String(opt) ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name={`field-${field.key}`}
                  value={opt}
                  checked={String(value) === String(opt)}
                  disabled={readOnly}
                  onChange={() => onChange(opt)}
                />
                {opt}
              </label>
            ))}
          </div>
        );
        break;
      }
      input = field.optionsFromStage
        ? <StageOptionsSelect field={field} value={value} onChange={onChange} onFill={onFill} readOnly={readOnly} projectId={projectId} />
        : <SelectField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
      break;

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      // A catalogue-backed field (Phase 3B's games, Phase 10's install list)
      // resolves its options live; everything else keeps its static list.
      const options = dynamic ? dynamic.values : (field.options || []);
      const labelOf = dynamic ? dynamic.labelOf : ((o) => o);
      const toggle = (opt) =>
        onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]);
      const allSelected = options.length > 0 && options.every((o) => selected.includes(o));
      const toggleAll = () => onChange(allSelected ? [] : [...options]);
      input = (
        <div className="col gap-2" style={{ padding: '4px 0' }}>
          {!readOnly && (
            <label className="row gap-2 sm" style={{ cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select All
            </label>
          )}
          <div className="row wrap gap-3">
            {options.map((o) => (
              <label
                key={o}
                className="row gap-2 sm"
                style={{
                  cursor: readOnly ? 'default' : 'pointer',
                  opacity: readOnly && !selected.includes(o) ? 0.6 : 1,
                  fontWeight: selected.includes(o) ? 600 : 400,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o)}
                  disabled={readOnly}
                  onChange={() => toggle(o)}
                />
                <span style={{ color: selected.includes(o) && readOnly ? '#1e40af' : undefined }}>
                  {labelOf(o)}
                </span>
              </label>
            ))}
          </div>
          {/* A catalogue-backed field with nothing to offer must say why, or it
              reads as a broken form. */}
          {dynamic?.loading && <span className="tiny muted">Loading…</span>}
          {dynamic?.empty && <span className="tiny muted">{dynamic.empty}</span>}
          {readOnly && !options.length && <span className="sm muted">Not provided</span>}
        </div>
      );
      break;
    }

    case 'file':
      input = field.recordAudio
        ? <AudioRecorderField field={field} value={value} onChange={onChange} readOnly={readOnly} />
        : <FileField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
      break;

    case 'layout':
      input = <LayoutPlanner value={value} onChange={onChange} formValues={formValues} readOnly={readOnly} />;
      break;

    case 'user':
      input = <UserSelect field={field} value={value} onChange={onChange} readOnly={readOnly} />;
      break;

    case 'location':
      input = (
        <LocationInput
          field={field}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          onResolveAddress={onResolveAddress}
        />
      );
      break;

    case 'text':
    default: {
      /**
       * WHAT OTHER PEOPLE ALREADY TYPED HERE.
       *
       * A plain `datalist`, not a select: the list is a shortcut, never a
       * restriction — a location nobody has used yet has to be typeable, and
       * it is the FIRST property in a city that has the most right to name
       * the place. It stops "Connaught Place" becoming four spellings that
       * no longer group.
       */
      const listId = suggestions?.length ? `dl-${field.key}` : undefined;
      input = (
        <>
          <input {...common} type="text" list={listId} autoComplete="off" />
          {listId && (
            <datalist id={listId}>
              {suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          )}
        </>
      );
      break;
    }
  }

  return (
    <div className="col gap-1">
      {input}
      {error && <span className="tiny" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

export default DynamicField;
