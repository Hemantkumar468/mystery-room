import { memo, useState } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { STATUS_META } from '../../app/slices/mapSlice.js';

/**
 * The pins.
 *
 * ANCHORING. `anchor="bottom"` puts the pin's tip on the coordinate, so it
 * stays on its spot as the map pitches and rotates. The default (`center`)
 * floats the middle of the marker over the point, which looks fine flat and
 * visibly drifts off the building the moment you tilt.
 *
 * `pitchAlignment`/`rotationAlignment` stay at their `viewport` defaults on
 * purpose: a pin should face the viewer and stay upright and readable however
 * the camera is angled. It is a label on the world, not an object in it.
 *
 * MEMOISATION. One `<Marker>` per location, each memoised on its own props.
 * Without it, every camera frame would re-render every pin, which is what
 * turns a map with a hundred pins into a slideshow.
 */

const PinShape = memo(function PinShape({ color, selected, hovered, pulsing }) {
  const scale = selected ? 1.25 : hovered ? 1.12 : 1;
  return (
    <span
      style={{
        display: 'grid',
        placeItems: 'center',
        transform: `scale(${scale})`,
        transformOrigin: 'bottom center',
        transition: 'transform 120ms ease',
        filter: selected ? 'drop-shadow(0 3px 6px rgba(0,0,0,.45))' : 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
      }}
    >
      {/* The AI halo is a separate, purely decorative ring so the pin itself
          never changes size and the anchor point never moves. */}
      {pulsing && (
        <span
          aria-hidden="true"
          className="mr-map-pulse"
          style={{ background: color }}
        />
      )}
      <svg width="24" height="32" viewBox="0 0 24 32" role="presentation" focusable="false">
        <path
          d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20c0-6.6-5.4-12-12-12z"
          fill={color}
          stroke="#ffffff"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="12" r="4.5" fill="#ffffff" />
      </svg>
    </span>
  );
});

const LocationMarker = memo(function LocationMarker({
  location, selected, onSelect, onHover,
}) {
  const [hovered, setHovered] = useState(false);
  const meta = STATUS_META[location.status] || STATUS_META.lead;

  return (
    <Marker
      longitude={location.displayCoords.lng}
      latitude={location.displayCoords.lat}
      anchor="bottom"
      onClick={(e) => {
        // Without this the click also reaches the map, which clears the
        // selection we are in the middle of making.
        e.originalEvent?.stopPropagation();
        onSelect(location.id);
      }}
    >
      <button
        type="button"
        className="mr-map-pin"
        aria-label={`${location.name}, ${location.city} — ${meta.label}`}
        aria-pressed={selected}
        title={`${location.name} · ${meta.label}`}
        onMouseEnter={() => { setHovered(true); onHover?.(location); }}
        onMouseLeave={() => { setHovered(false); onHover?.(null); }}
        onFocus={() => { setHovered(true); onHover?.(location); }}
        onBlur={() => { setHovered(false); onHover?.(null); }}
      >
        <PinShape
          color={meta.color}
          selected={selected}
          hovered={hovered}
          pulsing={location.status === 'ai'}
        />
      </button>
    </Marker>
  );
});

export function LocationMarkers({ locations, selectedId, onSelect, onHover }) {
  return locations.map((location) => (
    <LocationMarker
      key={location.id}
      location={location}
      selected={location.id === selectedId}
      onSelect={onSelect}
      onHover={onHover}
    />
  ));
}

export default LocationMarkers;
