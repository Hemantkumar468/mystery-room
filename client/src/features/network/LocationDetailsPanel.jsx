import { useNavigate } from 'react-router-dom';
import {
  X, ExternalLink, MapPin, Crosshair, AlertTriangle, Sparkles,
} from 'lucide-react';
import { Badge } from '../../components/ui/primitives.jsx';
import { STATUS_META } from '../../app/slices/mapSlice.js';

/**
 * Details for the selected pin, plus the way back into the PMS.
 *
 * "Open in PMS" is the point of this panel. A map that can only look at the
 * network is a poster; the job is to get from "that one is red" to the project
 * page where something can be done about it, in one click.
 *
 * The two honesty notices matter as much as the data:
 *   • a pin placed at a city centre because no GPS was ever captured says so;
 *   • a pin nudged off its true coordinate so it could be clicked says so too.
 * Neither is a defect worth hiding — silently showing a city centre as if it
 * were a surveyed position is how a map starts lying.
 */
export function LocationDetailsPanel({ location, onClose }) {
  const navigate = useNavigate();
  if (!location) return null;

  const meta = STATUS_META[location.status] || STATUS_META.lead;
  const isSuggestion = location.kind === 'suggestion';

  return (
    <aside
      className="card mr-map-panel"
      role="region"
      aria-label={`Details for ${location.name}`}
    >
      <div className="card-head">
        <div className="col gap-1" style={{ minWidth: 0 }}>
          <div className="section-title" style={{ overflowWrap: 'anywhere' }}>{location.name}</div>
          <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge color={meta.color} soft>{meta.label}</Badge>
            <span className="sm muted row gap-1" style={{ alignItems: 'center' }}>
              <MapPin size={12} />
              {location.city}
              {location.region ? ` · ${location.region}` : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={16} />
        </button>
      </div>

      <div className="card-body col gap-3">
        {Number.isFinite(location.score) && (
          <div className="col gap-1">
            <span className="tiny subtle upper">Progress</span>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <div
                style={{
                  flex: 1, height: 6, borderRadius: 999,
                  background: 'var(--surface-2)', overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, location.score))}%`,
                    height: '100%',
                    background: meta.color,
                  }}
                />
              </div>
              <strong className="sm">{`${location.score}%`}</strong>
            </div>
          </div>
        )}

        <dl className="col gap-2" style={{ margin: 0 }}>
          {location.details.map((d) => (
            <div key={d.label} className="row gap-2" style={{ justifyContent: 'space-between', gap: 12 }}>
              <dt className="sm muted" style={{ flexShrink: 0 }}>{d.label}</dt>
              <dd className="sm" style={{ margin: 0, textAlign: 'right', overflowWrap: 'anywhere' }}>
                {d.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="col gap-1" style={{ paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}>
            <Crosshair size={11} /> Coordinates
          </span>
          <span className="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {`${location.coords.lat.toFixed(5)}, ${location.coords.lng.toFixed(5)}`}
          </span>

          {location.coordsSource === 'city' && !isSuggestion && (
            <span className="tiny muted row gap-1" style={{ alignItems: 'flex-start' }}>
              <AlertTriangle size={11} style={{ marginTop: 2, flexShrink: 0 }} />
              Placed at the city centre — no on-site GPS has been captured for this
              project yet.
            </span>
          )}

          {location.coordsAdjustedForDisplay && (
            <span className="tiny muted row gap-1" style={{ alignItems: 'flex-start' }}>
              <AlertTriangle size={11} style={{ marginTop: 2, flexShrink: 0 }} />
              {`Drawn slightly off its true position so all ${location.overlapCount} pins at this spot can be clicked. The coordinates above are the real capture.`}
            </span>
          )}

          {isSuggestion && (
            <span className="tiny muted row gap-1" style={{ alignItems: 'flex-start' }}>
              <Sparkles size={11} style={{ marginTop: 2, flexShrink: 0 }} />
              An opportunity marker, not a site. Derived from cities with no
              project on the books.
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate(location.pmsUrl)}
        >
          <ExternalLink size={14} />
          {isSuggestion ? 'Open Projects' : 'Open in PMS'}
        </button>
      </div>
    </aside>
  );
}

export default LocationDetailsPanel;
