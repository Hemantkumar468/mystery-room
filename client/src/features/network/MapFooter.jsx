import {
  Layers, Satellite, Building2, Mountain, Type, Sparkles, RotateCw, X,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import {
  STATUS_META, LAYER_KEYS,
  selectMapLayers, selectHasActiveFilters, selectTourMode,
  layerToggled, filtersReset, tourModeToggled,
} from '../../app/slices/mapSlice.js';
import { BASEMAPS } from './mapStyles.js';
import { ViewControls } from './ViewControls.jsx';

/**
 * The strip along the bottom of the map: the network's headline numbers on the
 * left, how the map is drawn on the right.
 *
 * WHY THE BOTTOM AND NOT THE SIDE. All of this used to be a stack of cards
 * floating over the left third of the map — which is a third of India you
 * cannot see, permanently, on the one screen whose entire job is showing you
 * India. Laid out horizontally it costs a 44px strip instead, and the country
 * gets the full width back.
 *
 * The top was not an option: the header already lives there, and two stacked
 * bars would take more height than the side panel ever took width.
 *
 * The summary and the legend used to be separate cards saying the same thing
 * twice — four coloured dots each. They are one row now, because a swatch next
 * to a number IS the legend.
 */

const LAYER_TOGGLES = [
  { key: LAYER_KEYS.BUILDINGS, label: '3D Buildings', Icon: Building2 },
  { key: LAYER_KEYS.TERRAIN, label: 'Terrain', Icon: Mountain },
  { key: LAYER_KEYS.LABELS, label: 'Labels', Icon: Type },
  { key: LAYER_KEYS.AI, label: 'AI', Icon: Sparkles },
];

export function MapFooter({
  title, summary, basemap, onBasemapChange, level = 'india', visibleCount, map,
}) {
  const dispatch = useAppDispatch();
  const layers = useAppSelector(selectMapLayers);
  const hasFilters = useAppSelector(selectHasActiveFilters);
  const tourMode = useAppSelector(selectTourMode);

  const stats = [
    { key: 'open', label: 'Open', value: summary.open, color: STATUS_META.open.color },
    { key: 'inProgress', label: 'In progress', value: summary.inProgress, color: '#2563eb' },
    { key: 'leads', label: 'Leads', value: summary.leads, color: STATUS_META.lead.color },
    { key: 'delayed', label: 'Delayed', value: summary.delayed, color: STATUS_META.delayed.color },
  ];

  return (
    <footer className="mr-map-footer" role="region" aria-label="Network summary and map layers">
      {/* ── Headline numbers, doubling as the colour key ── */}
      <div className="mr-map-footer__stats">
        <span className="mr-map-footer__title">{title}</span>
        {stats.map((s) => (
          <span key={s.key} className="mr-map-footer__stat">
            <span aria-hidden="true" className="mr-map-footer__dot" style={{ background: s.color }} />
            <span className="mr-map-footer__stat-label">{s.label}</span>
            <strong className="mr-map-footer__stat-value">{s.value}</strong>
          </span>
        ))}
        <span className="mr-map-footer__note">
          {level === 'india' ? 'Pin count = locations in that city' : `${visibleCount} shown`}
        </span>
      </div>

      {/* ── How the map is drawn ── */}
      <div className="mr-map-footer__controls">
        <label className="mr-map-footer__field">
          <Satellite size={11} aria-hidden="true" />
          <select
            className="mr-map-footer__select"
            value={basemap}
            onChange={(e) => onBasemapChange(e.target.value)}
            aria-label="Basemap"
          >
            <option value={BASEMAPS.SATELLITE}>Satellite</option>
            <option value={BASEMAPS.STREETS}>Streets</option>
            <option value={BASEMAPS.INDIA}>Outline (offline)</option>
          </select>
        </label>

        <span className="mr-map-footer__divider" aria-hidden="true" />

        <Layers size={11} className="muted" aria-hidden="true" />
        {LAYER_TOGGLES.map(({ key, label, Icon }) => {
          const on = layers[key];
          // Set, but nothing on this screen for it to act on yet — buildings
          // need vector geometry and a city zoom. The chip stays clickable and
          // says where the setting will land; a disabled control teaches
          // nothing.
          const pending = key === LAYER_KEYS.BUILDINGS
            && (level === 'india' || basemap === BASEMAPS.SATELLITE);
          return (
            <button
              key={key}
              type="button"
              className="mr-map-chip"
              aria-pressed={on}
              onClick={() => dispatch(layerToggled(key))}
              title={pending
                ? `${label} — applies inside a city on the Streets basemap. Satellite tiles are photographs, with no building geometry to extrude.`
                : label}
              style={{
                borderColor: on ? 'var(--primary)' : 'var(--border)',
                background: on ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
                opacity: on ? 1 : 0.62,
              }}
            >
              <Icon size={11} />
              {label}
              {pending && on && <span className="mr-map-chip__pending" title="Takes effect in a city">•</span>}
            </button>
          );
        })}

        <button
          type="button"
          className="mr-map-chip"
          aria-pressed={tourMode}
          onClick={() => dispatch(tourModeToggled())}
          title="Slowly rotate the camera. Any interaction stops it."
          style={{
            borderColor: tourMode ? 'var(--primary)' : 'var(--border)',
            background: tourMode ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
            opacity: tourMode ? 1 : 0.62,
          }}
        >
          <RotateCw size={11} />
          Tour
        </button>

        {hasFilters && (
          <button
            type="button"
            className="mr-map-chip"
            onClick={() => dispatch(filtersReset())}
            title="Clear every filter"
          >
            <X size={11} /> Clear
          </button>
        )}

        {/* Camera controls live down here with everything else rather than in
            a floating column against the right edge — one place to look for a
            control, and it stops them overlapping the map they operate on. */}
        <span className="mr-map-footer__divider" aria-hidden="true" />
        <ViewControls map={map} />
      </div>
    </footer>
  );
}

export default MapFooter;
