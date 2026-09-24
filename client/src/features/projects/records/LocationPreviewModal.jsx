import { useEffect, useState } from 'react';
import {
  MapPin, Navigation, Crosshair, CalendarClock, User, Copy, Check, ExternalLink,
} from 'lucide-react';
import { Modal } from '../../../components/ui/Modal.jsx';
import { fmtDateTime } from '../../../lib/format.js';

const isGps = (v) => v && typeof v === 'object' && typeof v.lat === 'number' && typeof v.lng === 'number';
const mapsHref = (v) => (isGps(v) ? `https://www.google.com/maps?q=${v.lat},${v.lng}` : v?.mapUrl);
/** Keyless Google Maps embed; `t` is the layer — m = map, k = satellite. */
const embedSrc = (v, t) => (isGps(v) ? `https://maps.google.com/maps?q=${v.lat},${v.lng}&z=16&hl=en&t=${t}&output=embed` : null);

function Tile({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="col gap-1" style={{ flex: '1 1 120px', minWidth: 118, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
      <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}>
        <Icon size={12} style={{ color }} /> {label}
      </span>
      <span className="sm" style={{ fontWeight: 650 }}>{value}</span>
      {sub && <span className="tiny muted">{sub}</span>}
    </div>
  );
}

/**
 * Property Location Preview — opened from the Live Location field's link. Shows
 * the captured GPS metadata (lat/lng/accuracy/when/who), an embedded map with a
 * Map/Satellite toggle, a reverse-geocoded address, and quick actions (open in
 * Google Maps, copy coordinates, copy link). Reverse geocoding uses the keyless
 * OpenStreetMap Nominatim endpoint and degrades gracefully to the raw
 * coordinates if it's unavailable.
 */
export function LocationPreviewModal({ open, onClose, value }) {
  const gps = isGps(value);
  const [mapType, setMapType] = useState('m'); // 'm' map | 'k' satellite
  const [address, setAddress] = useState(null); // null = loading, '' = none, string = resolved
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (open) setMapType('m');
  }, [open]);

  useEffect(() => {
    if (!open || !gps) return undefined;
    let alive = true;
    setAddress(null);
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${value.lat}&lon=${value.lng}`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setAddress(d?.display_name || ''); })
      .catch(() => { if (alive) setAddress(''); });
    return () => { alive = false; };
  }, [open, gps, value?.lat, value?.lng]);

  if (!value) return null;

  const coordText = gps ? `${value.lat}, ${value.lng}` : '';
  const href = mapsHref(value);

  const copy = (text, key) => {
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    }).catch(() => {});
  };

  const seg = (active) => ({
    padding: '5px 12px',
    fontSize: 12.5,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    background: active ? 'var(--primary)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--text-muted)',
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Property Location Preview"
      subtitle="Review the captured location below"
      width={720}
      footer={(
        <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap', alignItems: 'center' }}>
          <a className="btn btn-primary" href={href} target="_blank" rel="noreferrer">
            <MapPin size={14} style={{ marginRight: 6 }} /> Open in Google Maps <ExternalLink size={13} style={{ marginLeft: 6 }} />
          </a>
          <button type="button" className="btn btn-subtle" onClick={() => copy(href, 'link')}>
            {copied === 'link' ? <Check size={14} style={{ marginRight: 6, color: 'var(--success)' }} /> : <Copy size={14} style={{ marginRight: 6 }} />}
            Copy Maps Link
          </button>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="col gap-3">
        {/* Capture metadata */}
        <div className="row gap-2 wrap">
          <Tile icon={Navigation} label="Latitude" value={gps ? value.lat.toFixed(5) : '—'} color="var(--info)" />
          <Tile icon={Navigation} label="Longitude" value={gps ? value.lng.toFixed(5) : '—'} color="var(--success)" />
          <Tile icon={Crosshair} label="Accuracy" value={value.accuracy ? `± ${Math.round(value.accuracy)} meters` : 'Not recorded'} color="var(--chart-7)" />
          <Tile icon={CalendarClock} label="Captured On" value={value.capturedAt ? fmtDateTime(value.capturedAt) : '—'} color="var(--warning)" />
          <Tile icon={User} label="Captured By" value={value.capturedBy?.name || '—'} sub={value.capturedBy?.role} color="var(--primary)" />
        </div>

        {/* Map */}
        {embedSrc(value, mapType) ? (
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, display: 'flex', borderRadius: 6, overflow: 'hidden', boxShadow: 'var(--shadow-2)', border: '1px solid var(--border)' }}>
              <button type="button" style={seg(mapType === 'm')} onClick={() => setMapType('m')}>Map</button>
              <button type="button" style={seg(mapType === 'k')} onClick={() => setMapType('k')}>Satellite</button>
            </div>
            <iframe
              title="Location preview"
              src={embedSrc(value, mapType)}
              style={{ width: '100%', height: 320, border: 0, borderRadius: 8, display: 'block' }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : (
          <div className="col gap-2 center" style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
            <MapPin size={28} style={{ color: 'var(--text-subtle)' }} />
            <span className="sm muted">This location was saved as a map link — open it in Google Maps to view the map.</span>
          </div>
        )}

        {/* Address */}
        <div className="row gap-2" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', alignItems: 'flex-start' }}>
          <MapPin size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
          <div className="col">
            <span className="tiny subtle upper">Address</span>
            <span className="sm">
              {address === null ? 'Looking up address…' : (address || (gps ? coordText : 'Saved map link'))}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default LocationPreviewModal;
