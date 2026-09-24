/**
 * City centre coordinates for the cities Mystery Rooms operates in or is
 * expanding into.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `lib/indianCities.js` is 500+ city NAMES with no coordinates — it powers an
 * autocomplete, and that is all it was ever for. A map needs somewhere to fly
 * to. Rather than bloat that list with a lng/lat for every city in India (most
 * of which this business will never open in), this covers the operating set
 * from `MR_CITIES` plus the cities with live projects.
 *
 * Coordinates are city centres to ~4 decimal places (roughly 10 m), which is
 * far more precision than a "fly to this city" camera needs. They are static
 * facts, so no geocoding call, no key, no network dependency — the same
 * reasoning behind `indianCities.js` being bundled rather than fetched.
 *
 * A city that is missing here simply cannot be flown to; `cityCoord()` returns
 * null and the caller falls back to fitting the visible pins instead. Adding
 * one is a two-value edit.
 */

/** @typedef {{lng: number, lat: number, region: string}} CityCoord */

/** @type {Record<string, CityCoord>} */
export const CITY_COORDS = Object.freeze({
  Delhi: { lng: 77.2090, lat: 28.6139, region: 'North' },
  // The projects data spells the capital both ways; both must place.
  'New Delhi': { lng: 77.2090, lat: 28.6139, region: 'North' },
  Noida: { lng: 77.3910, lat: 28.5355, region: 'North' },
  Gurgaon: { lng: 77.0266, lat: 28.4595, region: 'North' },
  Jaipur: { lng: 75.7873, lat: 26.9124, region: 'North' },
  Chandigarh: { lng: 76.7794, lat: 30.7333, region: 'North' },
  Ludhiana: { lng: 75.8573, lat: 30.9010, region: 'North' },
  Lucknow: { lng: 80.9462, lat: 26.8467, region: 'North' },

  Mumbai: { lng: 72.8777, lat: 19.0760, region: 'West' },
  Pune: { lng: 73.8567, lat: 18.5204, region: 'West' },
  Ahmedabad: { lng: 72.5714, lat: 23.0225, region: 'West' },
  Nagpur: { lng: 79.0882, lat: 21.1458, region: 'West' },
  Indore: { lng: 75.8577, lat: 22.7196, region: 'Central' },
  Bhopal: { lng: 77.4126, lat: 23.2599, region: 'Central' },

  Bangalore: { lng: 77.5946, lat: 12.9716, region: 'South' },
  Bengaluru: { lng: 77.5946, lat: 12.9716, region: 'South' },
  Chennai: { lng: 80.2707, lat: 13.0827, region: 'South' },
  Hyderabad: { lng: 78.4867, lat: 17.3850, region: 'South' },
  Visakhapatnam: { lng: 83.2185, lat: 17.6868, region: 'South' },
  Kochi: { lng: 76.2673, lat: 9.9312, region: 'South' },

  Kolkata: { lng: 88.3639, lat: 22.5726, region: 'East' },
  Bhubaneswar: { lng: 85.8245, lat: 20.2961, region: 'East' },
  Guwahati: { lng: 91.7362, lat: 26.1445, region: 'East' },
});

/** Every city we can fly to, alphabetical. */
export const MAPPED_CITIES = Object.keys(CITY_COORDS).sort();

/**
 * Coordinates for a city name, or null if we do not have them.
 * Case- and whitespace-insensitive, because city values come from a free-text
 * field with an autocomplete over it — "  bhopal" is a real thing users type.
 *
 * @param {?string} city
 * @returns {?CityCoord}
 */
export function cityCoord(city) {
  if (!city) return null;
  const exact = CITY_COORDS[city];
  if (exact) return exact;
  const needle = String(city).trim().toLowerCase();
  const key = Object.keys(CITY_COORDS).find((k) => k.toLowerCase() === needle);
  return key ? CITY_COORDS[key] : null;
}

/** The region a city sits in, or null. Drives the region filter. */
export function cityRegion(city) {
  return cityCoord(city)?.region ?? null;
}

/** Distinct regions, for the filter dropdown. */
export const REGIONS = Object.freeze(
  [...new Set(Object.values(CITY_COORDS).map((c) => c.region))].sort(),
);

/**
 * The map is India, and only India.
 *
 * These bounds are handed to MapLibre as `maxBounds`, which is a hard stop:
 * the camera physically cannot be panned outside them, and combined with
 * `INDIA_MIN_ZOOM` there is no way to zoom out to a world map. This is not
 * decoration — it is the difference between "a franchise map of India" and "a
 * world map that happens to have Indian pins on it", and every stray pan to
 * the Atlantic is a user wondering whether they broke something.
 *
 * Padded a little beyond the coastline and the Himalayas so border cities are
 * not pinned against the edge of the viewport, and so Sri Lanka and the
 * neighbouring labels stay visible for context the way they do on the chart.
 *
 * Order is [[west, south], [east, north]] — MapLibre's LngLatBounds convention.
 */
export const INDIA_BOUNDS = Object.freeze([
  [58.0, 0.0],    // south-west
  [106.0, 42.0],  // north-east
]);

/**
 * The fence used while the country view is tilted.
 *
 * `maxBounds` constrains the VIEWPORT, and a pitched camera sees vastly more
 * ground than a top-down one — at 52° the far half of the screen runs to the
 * horizon. Applying the tight box to a tilted, rotating view means MapLibre
 * is continually shoving the camera back inside it: rotation stutters, drags
 * snap back, and the map feels broken rather than constrained.
 *
 * So the country view gets a much looser fence. It costs nothing, because
 * this view has no world basemap behind it — pan past the coast and there is
 * simply background there. Nothing of another country exists to be revealed.
 * The tight box still applies at city level, where real world tiles are live
 * and panning far enough genuinely would leave India.
 */
export const INDIA_ROTATE_BOUNDS = Object.freeze([
  [20.0, -30.0],
  [145.0, 65.0],
]);

/**
 * Why the box is wider than India rather than hugging the coastline.
 *
 * `maxBounds` constrains the VIEWPORT, not the centre. Clamped tight to the
 * landmass (66–98.5°E), a wide monitor cannot fit that 32° of longitude at the
 * overview zoom, so MapLibre silently zooms in until the width fits — and
 * crops Kashmir and Kanyakumari off the top and bottom on exactly the large
 * screens this is meant to be read on.
 *
 * Padding it to ~48° of longitude leaves the whole country comfortably visible
 * at any sane window size while still being emphatically a box around India:
 * there is no Europe, no Africa, no Americas, and no way to zoom out to a
 * world map. The framing is done by INDIA_VIEW and INDIA_MIN_ZOOM; this is the
 * fence, not the frame.
 */

/** Zooming out past this would start showing the rest of the world. */
export const INDIA_MIN_ZOOM = 3.4;

/**
 * The national overview.
 *
 * Pitched, because the country is rendered as a solid with real elevation
 * rather than as a shape on paper — and a 3D relief viewed straight down is
 * indistinguishable from a flat one. 52° is enough for the Himalayas to stand
 * against the horizon without the far edge of the country compressing into a
 * sliver.
 *
 * A slight initial bearing is deliberate too: dead-on north reads as a
 * standard flat map, and the first thing anyone should notice is that this one
 * turns.
 */
/**
 * Flat and north-up, not tilted.
 *
 * This is only the FIRST frame — the scope effect fits the country's bounds
 * immediately after mount, so whatever is here is replaced within one
 * animation. It matters anyway: a pitched, rotated first frame that snaps
 * flat a moment later reads as the map correcting a mistake. Starting close
 * to where the fit lands makes the settle invisible.
 *
 * The 3D is still one tap away on the tilt button, and every rotation gesture
 * still works — it is just no longer forced on you before you have seen the
 * country whole.
 */
export const INDIA_VIEW = Object.freeze({
  longitude: 82.5,
  latitude: 22.0,
  zoom: 3.7,
  pitch: 0,
  bearing: 0,
});

/** Straight down, north up — what the compass button returns you to. */
export const INDIA_FLAT_VIEW = Object.freeze({
  ...INDIA_VIEW,
  pitch: 0,
  bearing: 0,
});

export default CITY_COORDS;
