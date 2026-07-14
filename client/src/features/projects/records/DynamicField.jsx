import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { NumberInput } from '../../../components/ui/NumberInput.jsx';
import { useDestroyMedia } from '../../../lib/queries.js';
import { fmtFileSize, fmtDuration } from '../../../lib/format.js';

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
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(entry)}>{removeLabel}</button>
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
 * to Cloudinary happens later, orchestrated by RecordFormModal right before
 * Save Draft / Submit persists the record. Entries not yet uploaded carry
 * `pending: true`; RecordFormModal resolves those into real refs at save time.
 */
function FileField({ field, value, onChange }) {
  const { entries, isMulti, addMany, remove } = useMediaEntries(field, value, onChange);
  const inputRef = useRef(null);
  const idRef = useRef(0);
  const canAdd = isMulti || entries.length === 0;

  const onPick = (e) => {
    const picked = [...e.target.files];
    e.target.value = '';
    const added = picked.map((file) => ({
      pending: true,
      id: `p${(idRef.current += 1)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
      mimetype: file.type,
    }));
    addMany(added);
  };

  const label = (field.label || 'File').replace(/^upload\s+/i, '');

  return (
    <div className="col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={field.accept}
        multiple={isMulti}
        style={{ display: 'none' }}
        onChange={onPick}
      />
      {canAdd && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>
          ⬆ Select {label}
        </button>
      )}
      <MediaEntryList entries={entries} onRemove={remove} />
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
function AudioRecorderField({ field, value, onChange }) {
  const { entries, isMulti, addMany, remove } = useMediaEntries(field, value, onChange);
  const idRef = useRef(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  const [status, setStatus] = useState('idle'); // idle | requesting | recording | paused
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  const canAdd = isMulti || entries.length === 0;
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
      <MediaEntryList entries={entries} onRemove={remove} removeLabel="Delete Recording" />
    </div>
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
function LocationInput({ value, onChange }) {
  const [status, setStatus] = useState('idle'); // idle | loading | denied
  const [manual, setManual] = useState('');
  const [manualErr, setManualErr] = useState('');
  const [editing, setEditing] = useState(false);

  const captured = hasLocation(value);
  const showControls = editing || !captured;

  const capture = () => {
    if (!navigator.geolocation) {
      setStatus('denied');
      return;
    }
    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          capturedAt: new Date().toISOString(),
        });
        setStatus('idle');
        setEditing(false);
      },
      () => setStatus('denied'), // permission denied / unavailable → paste fallback
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const applyManual = () => {
    const text = manual.trim();
    if (!text) return;
    const coords = parseCoords(text); // raw "lat, lng" still supported
    if (coords) {
      onChange({ ...coords, capturedAt: new Date().toISOString() });
    } else if (isValidUrl(text)) {
      onChange({ mapUrl: text });
    } else {
      setManualErr('Enter a valid Google Maps link or “lat, lng” coordinates.');
      return;
    }
    setManual('');
    setManualErr('');
    setStatus('idle');
    setEditing(false);
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
            <a
              className="sm"
              href={mapsHref(value)}
              target="_blank"
              rel="noreferrer"
              style={{ fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all' }}
            >
              📍 Open in Google Maps
              {isGps(value) ? ` · ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : ''}
            </a>
            <span className="row gap-1" style={{ flexShrink: 0 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>Remove</button>
            </span>
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
              />
              <button type="button" className="btn btn-subtle btn-sm" onClick={applyManual}>Set</button>
            </div>
            {manualErr && <span className="tiny" style={{ color: 'var(--danger)' }}>{manualErr}</span>}
          </div>
        </div>
      )}
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
 */
export function DynamicField({ field, value, onChange, error }) {
  const common = {
    className: 'input',
    id: `field-${field.key}`,
    value: value ?? '',
    placeholder: field.placeholder || '',
    'aria-invalid': error ? true : undefined,
    onChange: (e) => onChange(e.target.value),
  };

  let input;
  switch (field.type) {
    case 'textarea':
      input = <textarea {...common} className="textarea" rows={3} />;
      break;

    case 'number':
      input = <NumberInput {...common} onChange={(e) => onChange(e.target.value)} />;
      break;

    case 'currency':
      input = (
        <NumberInput
          {...common}
          placeholder={field.placeholder || '₹'}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;

    case 'date':
      input = (
        <input
          {...common}
          type="date"
          value={value ? String(value).slice(0, 10) : ''}
        />
      );
      break;

    case 'boolean':
      input = (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
      break;

    case 'select':
      input = (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
      break;

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      const toggle = (opt) =>
        onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]);
      input = (
        <div className="row wrap gap-3" style={{ padding: '4px 0' }}>
          {(field.options || []).map((o) => (
            <label key={o} className="row gap-2 sm" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
              {o}
            </label>
          ))}
        </div>
      );
      break;
    }

    case 'file':
      input = field.recordAudio
        ? <AudioRecorderField field={field} value={value} onChange={onChange} />
        : <FileField field={field} value={value} onChange={onChange} />;
      break;

    case 'user':
      input = (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.options || []).map((o) => (
            <option key={o.value || o} value={o.value || o}>{o.label || o}</option>
          ))}
        </select>
      );
      break;

    case 'location':
      input = <LocationInput field={field} value={value} onChange={onChange} />;
      break;

    case 'text':
    default:
      input = <input {...common} type="text" />;
      break;
  }

  return (
    <div className="col gap-1">
      {input}
      {error && <span className="tiny" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

export default DynamicField;
