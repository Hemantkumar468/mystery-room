import { memo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { Sparkles, Building2, MapPin } from 'lucide-react';

/**
 * Pins for what an Ask-the-Map answer talked about.
 *
 * Deliberately NOT the network's own pin language: these are the AI's
 * findings — a competitor, a mall, an approximate area — and they must never
 * be mistaken for our own units. Violet, dashed ring when the location is
 * approximate, and they exist only until the next question or the panel
 * closes.
 */
const KIND_ICON = {
  our_centre: Building2,
  our_property: Building2,
  competitor: Sparkles,
  place: MapPin,
  area: MapPin,
};

export const AskFindingMarkers = memo(function AskFindingMarkers({ findings, onPick }) {
  const pinnable = (findings || []).filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng));
  if (!pinnable.length) return null;
  return pinnable.map((f, i) => {
    const Icon = KIND_ICON[f.kind] || MapPin;
    return (
      <Marker key={`${f.name}-${i}`} longitude={f.lng} latitude={f.lat} anchor="bottom">
        <button
          type="button"
          className={`ask-pin${f.approx ? ' is-approx' : ''}`}
          title={`${f.name} — ${f.detail}${f.approx ? ' (approximate location)' : ''}`}
          onClick={() => onPick?.(f)}
        >
          <Icon size={12} />
          <span className="ask-pin-label">{f.name}</span>
        </button>
      </Marker>
    );
  });
});

export default AskFindingMarkers;
