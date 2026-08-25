import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';

/**
 * The Google-Maps-style area cover for an Ask finding.
 *
 * When the answer points at an AREA — "Civil Lines", "the MP Nagar belt" —
 * a pin alone under-tells it: the reader needs to see roughly WHERE the
 * locality runs. This draws a dashed red ring with a soft fill over the
 * finding's honest radius (the model states radius_km per area), so "this
 * area" reads as this area, not as one doorstep.
 *
 * Red on purpose, and dashed always: this is the AI's outline of a locality,
 * approximate by nature — it must never read as an official boundary.
 */
const M_PER_DEG_LAT = 110.574; // km per degree of latitude

function circlePolygon(lat, lng, radiusKm, points = 64) {
  const dLat = radiusKm / M_PER_DEG_LAT;
  const dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180) || 1);
  const ring = [];
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

export function AskAreaHighlight({ highlight }) {
  const data = useMemo(() => {
    if (!highlight || !Number.isFinite(highlight.lat) || !Number.isFinite(highlight.lng)) return null;
    return circlePolygon(highlight.lat, highlight.lng, highlight.radiusKm || 0.6);
  }, [highlight]);

  if (!data) return null;
  return (
    <Source id="ask-area" type="geojson" data={data}>
      <Layer
        id="ask-area-fill"
        type="fill"
        paint={{ 'fill-color': '#ef4444', 'fill-opacity': 0.1 }}
      />
      <Layer
        id="ask-area-line"
        type="line"
        paint={{ 'line-color': '#ef4444', 'line-width': 2.5, 'line-dasharray': [2, 1.6] }}
      />
    </Source>
  );
}

export default AskAreaHighlight;
