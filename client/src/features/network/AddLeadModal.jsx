import { useState } from 'react';
import { MapPin, Crosshair, Info } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import {
  STAGES, FRANCHISE_STATUSES, STATUS_META,
  selectAddLeadOpen, addLeadClosed, leadAdded, flyRequested,
} from '../../app/slices/mapSlice.js';
import { MAPPED_CITIES, cityCoord, cityRegion, REGIONS } from './cityCoords.js';
import { SITE_VIEW } from './mapStyles.js';

/**
 * Capture a new franchise lead and drop it on the map.
 *
 * WHERE THE PIN GOES. A lead needs a position, and there are only two honest
 * ways to get one: pick a city we already hold coordinates for, or type the
 * coordinates yourself. There is deliberately no third option that guesses —
 * a pin in roughly the right place looks exactly like a pin in the right
 * place, and the whole value of this map is that a position means something.
 *
 * Choosing a city fills the coordinates in and leaves them editable, so the
 * common case is two clicks and the precise case is still available.
 *
 * NO API YET. There is no franchise-lead table in the PMS — see mockLeads.js.
 * The lead is dispatched into the store, which is also where the optimistic
 * layer would sit once a real endpoint exists, so wiring one up later means
 * adding the mutation call beside this dispatch and nothing else.
 */
export function AddLeadModal() {
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectAddLeadOpen);

  const [form, setForm] = useState({
    name: '',
    city: '',
    lng: '',
    lat: '',
    status: 'lead',
    region: '',
    stage: 'enquiry',
    notes: '',
  });
  const [touched, setTouched] = useState(false);

  if (!open) return null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  /** Picking a city fills in what we know, without locking it. */
  const onCityChange = (e) => {
    const city = e.target.value;
    const coord = cityCoord(city);
    setForm((f) => ({
      ...f,
      city,
      region: cityRegion(city) || f.region,
      lng: coord ? String(coord.lng) : f.lng,
      lat: coord ? String(coord.lat) : f.lat,
    }));
  };

  const lng = Number(form.lng);
  const lat = Number(form.lat);

  // Validated against India's actual extent, not merely "is a number". A lead
  // at 0,0 or at a transposed lat/lng would otherwise be accepted and then
  // silently vanish, because the camera cannot leave the country to show it.
  const errors = {
    name: form.name.trim().length < 2 ? 'Enter the lead or franchisee name.' : '',
    city: form.city.trim().length < 2 ? 'Enter a city.' : '',
    coords: !Number.isFinite(lng) || !Number.isFinite(lat)
      ? 'Enter both coordinates, or pick a city to fill them in.'
      : (lng < 68 || lng > 97.5 || lat < 6.5 || lat > 37.5)
        ? 'That position is outside India — check the values are not swapped.'
        : '',
  };
  const isValid = !errors.name && !errors.city && !errors.coords;

  const close = () => { setTouched(false); dispatch(addLeadClosed()); };

  const submit = () => {
    setTouched(true);
    if (!isValid) return;

    const id = `lead:${form.city.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const coords = { lng, lat };

    dispatch(leadAdded({
      id,
      kind: 'lead',
      isDraft: true,
      name: form.name.trim(),
      city: form.city.trim(),
      region: form.region || cityRegion(form.city) || null,
      stage: form.stage,
      status: form.status,
      score: null,
      coords,
      displayCoords: coords,
      coordsSource: 'manual',
      coordsAdjustedForDisplay: false,
      createdAt: new Date().toISOString(),
      details: [
        { label: 'Stage', value: STAGES.find((s) => s.key === form.stage)?.label || form.stage },
        { label: 'Region', value: form.region || cityRegion(form.city) || '—' },
        { label: 'Added', value: 'This session — not yet saved to the PMS' },
        ...(form.notes.trim() ? [{ label: 'Notes', value: form.notes.trim() }] : []),
      ],
      pmsUrl: '/network-map',
    }));

    // Take the user to what they just created, rather than leaving them to
    // find it. Coordinates are known-good by this point.
    dispatch(flyRequested({ ...coords, ...SITE_VIEW }));
    setForm({
      name: '', city: '', lng: '', lat: '', status: 'lead', region: '', stage: 'enquiry', notes: '',
    });
    setTouched(false);
  };

  const err = (key) => (touched && errors[key] ? errors[key] : '');

  return (
    <Modal
      open
      onClose={close}
      title="Add franchise lead"
      width={520}
      footer={(
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Add lead
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        <div className="field">
          <label className="label" htmlFor="lead-name">Name</label>
          <input
            id="lead-name"
            className="input"
            value={form.name}
            onChange={set('name')}
            placeholder="Franchisee or lead name"
            autoComplete="off"
          />
          {err('name') && <span className="sm" style={{ color: 'var(--danger)' }}>{err('name')}</span>}
        </div>

        <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label className="label" htmlFor="lead-city">City</label>
            <input
              id="lead-city"
              className="input"
              list="lead-city-options"
              value={form.city}
              onChange={onCityChange}
              placeholder="Pune"
              autoComplete="off"
            />
            {/* A datalist, not a select: cities we have coordinates for are
                offered, but a city we do not yet know can still be typed. */}
            <datalist id="lead-city-options">
              {MAPPED_CITIES.map((c) => <option key={c} value={c} />)}
            </datalist>
            {err('city') && <span className="sm" style={{ color: 'var(--danger)' }}>{err('city')}</span>}
          </div>

          <div className="field" style={{ flex: '1 1 140px' }}>
            <label className="label" htmlFor="lead-region">Region</label>
            <select id="lead-region" className="select" value={form.region} onChange={set('region')}>
              <option value="">—</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="label">
            <span className="row gap-1" style={{ alignItems: 'center' }}>
              <Crosshair size={13} /> Coordinates
            </span>
          </label>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 140px' }}
              value={form.lng}
              onChange={set('lng')}
              placeholder="Longitude (73.85)"
              inputMode="decimal"
              aria-label="Longitude"
            />
            <input
              className="input"
              style={{ flex: '1 1 140px' }}
              value={form.lat}
              onChange={set('lat')}
              placeholder="Latitude (18.52)"
              inputMode="decimal"
              aria-label="Latitude"
            />
          </div>
          <span className="sm muted row gap-1" style={{ alignItems: 'flex-start' }}>
            <MapPin size={12} style={{ marginTop: 2, flexShrink: 0 }} />
            Picking a known city fills these in. Edit them for an exact site.
          </span>
          {err('coords') && <span className="sm" style={{ color: 'var(--danger)' }}>{err('coords')}</span>}
        </div>

        <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label className="label" htmlFor="lead-stage">Stage</label>
            <select id="lead-stage" className="select" value={form.stage} onChange={set('stage')}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          <div className="field" style={{ flex: '1 1 160px' }}>
            <label className="label" htmlFor="lead-status">Status</label>
            <select id="lead-status" className="select" value={form.status} onChange={set('status')}>
              {FRANCHISE_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="lead-notes">Notes</label>
          <textarea
            id="lead-notes"
            className="textarea"
            value={form.notes}
            onChange={set('notes')}
            placeholder="Anything worth knowing about this lead…"
          />
        </div>

        <span className="sm muted row gap-1" style={{ alignItems: 'flex-start' }}>
          <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
          Saved to this session only. The PMS has no franchise-lead table yet, so
          this pin will not survive a reload.
        </span>
      </div>
    </Modal>
  );
}

export default AddLeadModal;
