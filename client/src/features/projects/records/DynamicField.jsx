import { useEffect, useRef, useState } from 'react';
import { Play, MapPin, Camera } from 'lucide-react';
import { NumberInput } from '../../../components/ui/NumberInput.jsx';
import { Badge } from '../../../components/ui/primitives.jsx';
import { useDestroyMedia } from '../../../app/api/recordsApi.js';
import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { fmtFileSize, fmtDuration } from '../../../lib/format.js';
import { LocationPreviewModal } from './LocationPreviewModal.jsx';
import { MediaCaptureModal } from './MediaCaptureModal.jsx';
import { EMPLOYEES, getEmployeeById } from '../../../lib/employees.js';

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
      <select id={`field-${field.key}`} className="select" disabled value={value ?? ''} onChange={() => {}}>
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
function LocationInput({ value, onChange, readOnly }) {
  const [status, setStatus] = useState('idle'); // idle | loading | denied
  const [manual, setManual] = useState('');
  const [manualErr, setManualErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [showMap, setShowMap] = useState(false); // location-preview popup
  const authUser = useAppSelector(selectCurrentUser);

  const captured = hasLocation(value);
  const showControls = !readOnly && (editing || !captured);

  if (readOnly && !captured) return <span className="sm muted">—</span>;

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
          ...(Number.isFinite(pos.coords.accuracy) ? { accuracy: pos.coords.accuracy } : {}),
          ...(authUser ? { capturedBy: { name: authUser.name, role: authUser.role } } : {}),
        });
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
export function DynamicField({ field, value, onChange, error, readOnly = false }) {
  const common = {
    className: 'input',
    id: `field-${field.key}`,
    value: value ?? '',
    placeholder: field.placeholder || '',
    'aria-invalid': error ? true : undefined,
    disabled: readOnly,
    onChange: (e) => onChange(e.target.value),
  };

  let input;
  switch (field.type) {
    case 'textarea':
      input = <textarea {...common} className="textarea" rows={3} />;
      break;

    case 'number':
      input = (
        <NumberInput
          {...common}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value)}
        />
      );
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
        <select id={`field-${field.key}`} className="select" disabled={readOnly} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
      break;

    case 'select':
      input = <SelectField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
      break;

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      const options = field.options || [];
      const toggle = (opt) =>
        onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]);
      const allSelected = options.length > 0 && options.every((o) => selected.includes(o));
      const toggleAll = () => onChange(allSelected ? [] : [...options]);
      input = readOnly ? (
        selected.length ? (
          <div className="row wrap gap-2" style={{ padding: '4px 0' }}>
            {selected.map((o) => <Badge key={o}>{o}</Badge>)}
          </div>
        ) : <span className="sm muted">—</span>
      ) : (
        <div className="col gap-2" style={{ padding: '4px 0' }}>
          <label className="row gap-2 sm" style={{ cursor: 'pointer', fontWeight: 600 }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Select All
          </label>
          <div className="row wrap gap-3">
            {options.map((o) => (
              <label key={o} className="row gap-2 sm" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
                {o}
              </label>
            ))}
          </div>
        </div>
      );
      break;
    }

    case 'file':
      input = field.recordAudio
        ? <AudioRecorderField field={field} value={value} onChange={onChange} readOnly={readOnly} />
        : <FileField field={field} value={value} onChange={onChange} readOnly={readOnly} />;
      break;

    case 'user': {
      const employeeOptions = field.options?.length ? field.options : EMPLOYEES;
      input = readOnly ? (
        <span className="sm">{getEmployeeById(value)?.name || value || '—'}</span>
      ) : (
        <select id={`field-${field.key}`} className="select" disabled={readOnly} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {employeeOptions.map((o) => (
            <option key={o.value || o.id || o} value={o.value || o.id || o}>{o.label || o.name || o}</option>
          ))}
        </select>
      );
      break;
    }

    case 'location':
      input = <LocationInput field={field} value={value} onChange={onChange} readOnly={readOnly} />;
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
