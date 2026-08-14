import { memo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { STATUS_META } from '../../app/slices/mapSlice.js';

/**
 * One pin per city — the national view.
 *
 * A city carries a NAME and a COUNT next to its pin, because at country zoom
 * the useful question is "where are we, and how much is there" and neither
 * half is answerable from a bare dot. A city holding more than one unit shows
 * its count the way the chart does: `Delhi NCR (3)`.
 *
 * The pin's colour is the city's worst status, not its most common one — see
 * `aggregateByCity`. A city with four open outlets and one delayed build shows
 * red, because the delayed build is the reason anyone opened this screen.
 *
 * Clicking drills into that city. That is the whole interaction of this view.
 */

const CityPin = memo(function CityPin({ city, onOpen, onHover, showLabel }) {
  const meta = STATUS_META[city.status] || STATUS_META.lead;
  const many = city.count > 1;

  return (
    <Marker
      longitude={city.displayCoords.lng}
      latitude={city.displayCoords.lat}
      anchor="bottom"
      onClick={(e) => {
        e.originalEvent?.stopPropagation();
        onOpen(city);
      }}
    >
      <button
        type="button"
        className="mr-city-pin"
        aria-label={`${city.city} — ${city.count} location${city.count === 1 ? '' : 's'}, ${meta.label}. Open the ${city.city} map.`}
        // No `title`: the hover card carries far more than a native tooltip
        // could, and the two firing together is a duplicate that also blocks
        // the card behind an OS-drawn box.
        onMouseEnter={() => onHover?.(city)}
        onMouseLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(city)}
        onBlur={() => onHover?.(null)}
      >
        {/*
          The Labels toggle acts here on the country view. This style has no
          symbol layers of its own — every label on it is one of these — so
          hiding them is what "Labels off" has to mean. The pins stay, and the
          accessible name on the button still carries the city, so switching
          labels off is a visual choice rather than a loss of information.
        */}
        {showLabel && (
          <span className="mr-city-pin__label">
            {city.city}
            {many && <span className="mr-city-pin__count">{`(${city.count})`}</span>}
          </span>
        )}
        <svg width="20" height="27" viewBox="0 0 24 32" role="presentation" focusable="false">
          <path
            d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20c0-6.6-5.4-12-12-12z"
            fill={meta.color}
            stroke="#ffffff"
            strokeWidth="1.6"
          />
          <circle cx="12" cy="12" r="4.2" fill="#ffffff" />
        </svg>
      </button>
    </Marker>
  );
});

export function CityMarkers({ cities, onOpenCity, onHover, showLabels = true }) {
  return cities.map((city) => (
    <CityPin key={city.id} city={city} onOpen={onOpenCity} onHover={onHover} showLabel={showLabels} />
  ));
}

export default CityMarkers;
