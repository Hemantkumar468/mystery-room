/**
 * The realism stack: real imagery, real streets, real OSM buildings, real
 * terrain. No API key, no account, nothing procedural or generated.
 *
 * WHY THESE SOURCES
 * -----------------
 * Every one is free and keyless, which is the same constraint
 * `LocationPreviewModal.jsx` already works under (keyless Google embed, keyless
 * Nominatim reverse geocoding). A map that needs a billing account to render
 * is a map that breaks the day someone forgets to set an env var.
 *
 *   Esri World Imagery — real satellite/aerial photography, global.
 *   OpenFreeMap "liberty" — a full OpenMapTiles vector style, free, no key,
 *                           no rate limit. Carries the `building` layer that
 *                           the 3D extrusion reads.
 *   AWS Terrain Tiles — the terrarium-encoded DEM, public S3, no key.
 *
 * ATTRIBUTION IS NOT OPTIONAL. Each source below carries its `attribution`
 * string and MapLibre renders it. Do not strip it — it is the licence
 * condition these are free under.
 */

import { INDIA_GEOJSON, INDIA_MASK_GEOJSON } from './indiaBoundary.js';

/* ── Source ids, shared so hooks and styles cannot disagree ─────────────── */
export const SRC = Object.freeze({
  SATELLITE: 'mr-satellite',
  LABELS: 'mr-labels',
  TERRAIN: 'mr-terrain-dem',
  INDIA: 'mr-india',
  INDIA_MASK: 'mr-india-mask',
});

export const LYR = Object.freeze({
  SATELLITE: 'mr-satellite-layer',
  LABELS: 'mr-labels-layer',
  HILLSHADE: 'mr-hillshade',
  BUILDINGS: 'mr-3d-buildings',
  INDIA_BG: 'mr-india-bg',
  INDIA_MASK: 'mr-india-mask-layer',
  INDIA_FILL: 'mr-india-fill',
  INDIA_LINE: 'mr-india-line',
});

/** Esri's own attribution wording. */
const ESRI_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/**
 * Satellite basemap — Esri World Imagery, with Esri's reference overlay
 * (roads, boundaries, place names) on top so the photography is still
 * navigable. Two sources rather than one because imagery and labels are
 * separately toggleable, which is the whole point of the Labels switch.
 */
export const satelliteStyle = Object.freeze({
  version: 8,
  // MapLibre needs a glyph endpoint declared for any text layer. This style
  // has none — its labels are a raster overlay — so nothing is fetched from
  // here in practice. It is declared anyway because a style with no `glyphs`
  // throws the moment anything adds a symbol layer to it.
  glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
  sources: {
    [SRC.SATELLITE]: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
    [SRC.LABELS]: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
  },
  layers: [
    { id: LYR.SATELLITE, type: 'raster', source: SRC.SATELLITE },
    { id: LYR.LABELS, type: 'raster', source: SRC.LABELS },
  ],
});

/**
 * Streets basemap — real OSM vector data, so the city looks like the city and
 * the `building` source-layer is there for the 3D extrusion to read.
 *
 * TWO CANDIDATES, TRIED IN ORDER, AND THE REASON IS NOT HYPOTHETICAL.
 * OpenFreeMap was unreachable from the network this was built on — DNS
 * resolved, TCP never connected, while Esri, AWS and other Cloudflare-fronted
 * hosts were all fine. Whether that was an outage or a local block could not be
 * determined from inside, and it does not matter: a single hardcoded tile host
 * means one bad day upstream leaves "Streets 3D" as a white rectangle with no
 * explanation.
 *
 * `MapCanvas` advances through this list on a style-load error. Both entries
 * are keyless, both carry OSM buildings with real heights:
 *
 *   OpenFreeMap liberty — fullest detail, `render_height` + `building:levels`.
 *   CARTO Voyager      — `render_height`, `render_min_height`, `hide_3d`;
 *                        exactly the fields the extrusion expression reads.
 */
export const STREETS_STYLE_CANDIDATES = Object.freeze([
  { id: 'openfreemap', url: 'https://tiles.openfreemap.org/styles/liberty', label: 'OpenFreeMap Liberty' },
  { id: 'carto', url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json', label: 'CARTO Voyager' },
]);

/** The first choice, kept as a named export for anything that just wants one. */
export const STREETS_STYLE_URL = STREETS_STYLE_CANDIDATES[0].url;

/**
 * The national view: India drawn from its own geometry, and nothing else.
 *
 * THIS IS NOT A WORLD MAP CROPPED TO INDIA. Every general-purpose basemap
 * draws the whole planet, so fencing the camera still leaves Pakistan, China
 * and the Gulf rendering around the edges — a world map you are not allowed to
 * pan, which is a different thing from a map of India. This style has no tile
 * source at all: one background colour, the country polygon, its outline. The
 * only thing on screen is India.
 *
 * Three things follow from that, all of them good:
 *   • It cannot fail. No tile host, no network, no outage, no rate limit. The
 *     national view renders offline.
 *   • It is instant. 59 KB of bundled geometry against dozens of tile requests.
 *   • It is unambiguous. Nobody can pan to Europe, because Europe was never
 *     drawn.
 *
 * Real tiles come back the moment you open a city, which is where imagery and
 * streets mean something.
 *
 * @param {'light'|'dark'} theme
 */
/**
 * Slab height, as `K / 2^zoom` metres.
 *
 * Chosen from apparent thickness rather than picked: metres-per-pixel at
 * latitude 22 is 145,120 / 2^zoom, so a slab of K / 2^zoom metres is always
 * K / 145,120 pixels thick — independent of zoom. K here is ~20 px of
 * thickness, which reads as solid when tilted without the side walls
 * swallowing the pins standing on top of it.
 */
export const INDIA_EXTRUSION_K = 20 * 145120;

export function indiaOnlyStyle(theme = 'light') {
  const dark = theme === 'dark';

  /*
   * LAND MUST BE VISIBLE WITHOUT THE RELIEF.
   *
   * The first version of this made the country a 42%-opacity tint so the
   * hillshade beneath would show through. The arithmetic on that: #cfe0f0 at
   * 42% over #e8eff7 renders as rgb(222,233,244) against rgb(232,239,247) — a
   * ten-value difference on one channel, about 4%. The country was drawn
   * correctly and was, to the eye, not there. Relief was the only thing
   * separating land from sea, so any moment the DEM was slow, throttled or
   * unreachable, the map went blank.
   *
   * So: land is opaque and plainly different from the background, and the
   * relief now sits ABOVE it as shading rather than beneath it as the sole
   * source of contrast. Lose the elevation tiles now and you lose the
   * mountains, not the country.
   */
  // Same sunlit-sea family as the masked basemaps, so switching to the offline
  // outline is a change of detail rather than a change of place.
  const background = dark ? '#1a5478' : '#8fd0f0'; // sea around India
  const land = dark ? '#27394d' : '#f7fafc';

  return {
    version: 8,
    // No text layers here — every label on this view is an HTML marker — but a
    // style with no `glyphs` throws the moment anything adds a symbol layer,
    // so it is declared rather than left as a trap for the next person.
    glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
    sources: {
      [SRC.INDIA]: { type: 'geojson', data: INDIA_GEOJSON },
      [SRC.INDIA_MASK]: { type: 'geojson', data: INDIA_MASK_GEOJSON },
    },
    layers: [
      {
        id: LYR.INDIA_BG,
        type: 'background',
        // Deliberately NOT white: the country sits on it, and a white ground
        // under a near-white landmass leaves no coastline.
        paint: { 'background-color': background },
      },
      /*
       * THE COUNTRY, AS A SOLID.
       *
       * A fill-extrusion rather than a flat fill: India is raised off the
       * background as a slab with real side walls, so tilting the camera
       * shows its thickness and rotating it sweeps the walls around. That is
       * what makes this read as 3D rather than as a tilted picture of a map.
       *
       * WHY NOT TERRAIN HERE, WHICH WOULD GIVE REAL MOUNTAINS. Terrain
       * displacement is metres over metres-per-pixel, and at country zoom a
       * pixel is ~9 km of ground — so honest relief is ~7 px and invisible.
       * Forcing it to ~77× made the Himalayas visible and simultaneously tore
       * the mesh apart: the terrarium DEM carries BATHYMETRY, so the seafloor
       * around India dropped 300-550 km while peaks rose 680 km, and the scene
       * left the view frustum. MapLibre's terrain is built for ~1-3×.
       *
       * So the country view gets its third dimension from geometry it owns,
       * which is stable at every zoom and needs no network at all. Real
       * elevation still runs at city level, where a pixel is metres and 1.2×
       * is honest and legible.
       */
      {
        id: LYR.INDIA_FILL,
        type: 'fill-extrusion',
        source: SRC.INDIA,
        paint: {
          'fill-extrusion-color': land,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-base': 0,
          /*
           * Height is metres, but what matters is how thick the slab LOOKS.
           * Metres-per-pixel halves with every zoom level, so a fixed height
           * would be a sliver zoomed out and a skyscraper zoomed in. Halving
           * the height per zoom level keeps the apparent thickness constant —
           * about 20 px, enough to read as solid without the walls swallowing
           * the pins that sit on top of it.
           */
          /*
           * Written as an interpolation rather than the arithmetic it is,
           * because the style spec refuses `zoom` anywhere except as the
           * direct input of a top-level `step`/`interpolate` — a plain
           * `["/", K, ["^", 2, ["zoom"]]]` fails validation.
           *
           * `["exponential", 0.5]` between two stops that are themselves
           * K/2^z reproduces K/2^z EXACTLY at every zoom in between, not
           * approximately: the base-0.5 curve and the halving are the same
           * function. Two stops are therefore enough.
           */
          'fill-extrusion-height': [
            'interpolate', ['exponential', 0.5], ['zoom'],
            3, INDIA_EXTRUSION_K / 2 ** 3,
            16, INDIA_EXTRUSION_K / 2 ** 16,
          ],
        },
      },
      {
        // Everything that is not India, painted flat at ground level. The slab
        // stands above it, so this reads as the surface the country sits on.
        id: LYR.INDIA_MASK,
        type: 'fill',
        source: SRC.INDIA_MASK,
        paint: { 'fill-color': background, 'fill-opacity': 1 },
      },
      {
        // The coastline, drawn at ground level around the base of the slab.
        id: LYR.INDIA_LINE,
        type: 'line',
        source: SRC.INDIA,
        paint: {
          'line-color': dark ? '#6d90b0' : '#5b7ea3',
          'line-width': 1.2,
          'line-opacity': 0.9,
        },
      },
    ],
    // Sky and atmospheric haze. With terrain on, this is what gives the view a
    // horizon to rotate against — without it a tilted map is a trapezoid on a
    // flat colour, which reads as a broken 2D map rather than a 3D one.
    sky: dark
      ? {
        'sky-color': '#0a1526',
        'horizon-color': '#1d3a55',
        'fog-color': '#0b1220',
        'fog-ground-blend': 0.55,
        'horizon-fog-blend': 0.6,
        'sky-horizon-blend': 0.7,
        'atmosphere-blend': 0.75,
      }
      : {
        'sky-color': '#8cbde8',
        'horizon-color': '#dbe8f5',
        'fog-color': '#e8eff7',
        'fog-ground-blend': 0.5,
        'horizon-fog-blend': 0.55,
        'sky-horizon-blend': 0.65,
        'atmosphere-blend': 0.8,
      },
  };
}

/**
 * Terrain exaggeration, computed from zoom so relief stays VISIBLE.
 *
 * THE ARITHMETIC THAT MADE THIS NECESSARY. Terrain displacement is measured in
 * metres and drawn in pixels, and the conversion collapses as you zoom out:
 *
 *     pixels = elevation × exaggeration ÷ metresPerPixel
 *     metresPerPixel = 156543 × cos(latitude) ÷ 2^zoom
 *
 * At zoom 4 over India a pixel is ~9 km of ground. A fixed exaggeration of 7
 * therefore lifted Everest by 6.8 pixels — terrain switched on, working
 * exactly as asked, and completely invisible. The country looked flat because
 * at country zoom it WAS flat, to within a few pixels.
 *
 * A single constant cannot fix that, because the same number that makes
 * mountains at zoom 4 makes a spiky catastrophe at zoom 12: the required value
 * halves with every zoom level. So it is computed rather than chosen, from the
 * one thing that actually matters — how tall the mountains should LOOK.
 *
 * The result is constant apparent relief: the Himalayas stand the same height
 * on screen whether you are looking at the whole country or one city, which is
 * also what stops the terrain deforming under you as you fly in.
 *
 * MapLibre's `exaggeration` takes a plain number and no zoom expression, so
 * this has to be re-applied as the user zooms — see useMapLayers.
 */

/** How many pixels tall the highest ground should read. Tuned by eye. */
export const RELIEF_TARGET_PX = 75;

/** Everest, the tallest thing the DEM will hand us over India. */
const PEAK_ELEVATION_M = 8848;

/**
 * Exaggeration that renders `RELIEF_TARGET_PX` of relief at a given zoom.
 *
 * Clamped at both ends: the floor keeps city-level terrain honest rather than
 * flattening it to nothing, and the ceiling stops the far-out view turning
 * into a bed of nails when the DEM has a noisy tile.
 *
 * @param {number} zoom
 * @param {number} [latitude] Mercator scale is latitude-dependent.
 * @returns {number}
 */
export function exaggerationForZoom(zoom, latitude = 22) {
  const metresPerPixel = (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  const ideal = (RELIEF_TARGET_PX * metresPerPixel) / PEAK_ELEVATION_M;
  return Math.max(1.2, Math.min(130, ideal));
}

/**
 * The country-level value, kept as a named export for tests and for anything
 * that wants one number rather than the curve. ~77 at the default overview
 * zoom — an order of magnitude above the 7 that rendered flat.
 */
export const INDIA_TERRAIN_EXAGGERATION = exaggerationForZoom(4);

export const BASEMAPS = Object.freeze({
  /**
   * Real satellite imagery. The default everywhere, including the country
   * view: it is the most literally real thing we can draw, and India renders
   * green because India is green.
   */
  SATELLITE: 'satellite',
  /** Real OSM streets, parks, water and labels. */
  STREETS: 'streets',
  /**
   * The bundled outline — no tiles at all. Kept as the always-works fallback:
   * it renders with no network, so a tile outage degrades to a plain drawing
   * of the country rather than to an empty screen.
   */
  INDIA: 'india',
});

/**
 * The country view, drawn over a REAL basemap with everything else painted out.
 *
 * WHY THIS REPLACED THE DRAWN POLYGON. The country view used to render its own
 * flat shape, because any world basemap shows the world. The mask solves that
 * properly: real tiles render globally underneath, and a world-sized rectangle
 * with India cut out of it goes over the top. What survives on screen is a
 * real map of India — real vegetation, real water, real roads — and nothing
 * else. The old approach was a drawing of a country; this is a map of one.
 *
 * Added imperatively AFTER the basemap style loads (see useMapLayers), because
 * a vector basemap arrives as a URL and cannot have layers merged into it
 * beforehand.
 *
 * @param {'light'|'dark'} theme
 * @param {string} basemap
 */
/**
 * A world-sized rectangle with `polygons` punched out of it, for masking
 * everything outside one country.
 *
 * Generalised from the India-only version. The winding is measured rather than
 * assumed — see indiaBoundary.js, where reversing every ring on the assumption
 * they arrived counter-clockwise produced a mask with no holes in it, which
 * would have painted out the country along with the world.
 *
 * @param {Array} polygons a country's MultiPolygon coordinates
 */
export function maskOutside(polygons) {
  const rect = [[-179.9, -85], [179.9, -85], [179.9, 85], [-179.9, 85], [-179.9, -85]];

  const signedArea = (ring) => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return a / 2;
  };
  const wind = (ring, wantCcw) => (
    (signedArea(ring) > 0) === wantCcw ? ring : [...ring].reverse()
  );

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      // Outer ring counter-clockwise, every hole clockwise. Only each
      // polygon's OUTER ring becomes a hole — a country's own inner rings are
      // holes in it, and punching those too would paint them back in.
      coordinates: [
        wind(rect, true),
        ...polygons.map((poly) => wind(poly[0], false)),
      ],
    },
  };
}

export function indiaMaskLayers(theme = 'light', basemap = BASEMAPS.SATELLITE, polygons = null) {
  const dark = theme === 'dark';

  /*
   * A VEIL, NOT A LID.
   *
   * This was an opaque fill — the world outside the country was simply gone,
   * and the map ended at the border with nothing beyond it. That answers
   * "which country am I looking at" and destroys the answer to "what is it
   * next to", which for a franchise map is half the point: Nepal, Bangladesh
   * and the Arabian Sea are context, not noise.
   *
   * So the surround is now translucent. The real basemap still renders
   * underneath — neighbouring countries, their coastlines, the sea — washed
   * almost colourless so the scoped country is the only saturated thing on
   * screen. Spotlight rather than blackout.
   *
   * Opacity is the whole tuning knob: too low and the country stops standing
   * out, too high and you are back to a lid with extra steps.
   */
  const surround = dark ? '#0a121c' : '#eef4f8';
  const surroundOpacity = dark ? 0.7 : 0.72;

  // `polygons` is the scoped country's outline; India's own bundled geometry
  // is only the default so the home country keeps its official boundary.
  const outline = polygons || INDIA_GEOJSON.geometry.coordinates;

  return {
    surround,
    maskSource: {
      id: SRC.INDIA_MASK,
      spec: { type: 'geojson', data: maskOutside(outline) },
    },
    outlineSource: {
      id: SRC.INDIA,
      spec: {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiPolygon', coordinates: outline },
        },
      },
    },
    mask: {
      id: LYR.INDIA_MASK,
      type: 'fill',
      source: SRC.INDIA_MASK,
      paint: { 'fill-color': surround, 'fill-opacity': surroundOpacity },
    },
    outline: {
      id: LYR.INDIA_LINE,
      type: 'line',
      source: SRC.INDIA,
      paint: {
        // Against a washed-out surround a pale line disappears, so the border
        // is drawn dark on light and light on dark — it is now separating the
        // country from a visible neighbour rather than from flat colour.
        'line-color': dark ? '#8fc4ec' : '#123f5f',
        'line-width': 1.8,
        'line-opacity': 0.9,
      },
    },
  };
}

/**
 * The style MapLibre should load.
 *
 * @param {string} basemap
 * @param {number} [streetsIndex] which streets candidate to use; MapCanvas
 *   increments this when one fails to load.
 * @param {'light'|'dark'} [theme]
 */
export function styleFor(basemap, streetsIndex = 0, theme = 'light') {
  if (basemap === BASEMAPS.INDIA) return indiaOnlyStyle(theme);
  if (basemap !== BASEMAPS.STREETS) return satelliteStyle;
  const candidate = STREETS_STYLE_CANDIDATES[streetsIndex]
    || STREETS_STYLE_CANDIDATES[STREETS_STYLE_CANDIDATES.length - 1];
  return candidate.url;
}

/** Does this basemap carry vector building geometry to extrude? */
export function hasBuildingGeometry(basemap) {
  return basemap === BASEMAPS.STREETS;
}

/* ── Terrain ────────────────────────────────────────────────────────────── */

/**
 * AWS Terrain Tiles, terrarium encoding. `encoding: 'terrarium'` is
 * load-bearing — the default is Mapbox's own encoding, and reading terrarium
 * tiles as mapbox-encoded produces a landscape of enormous spikes rather than
 * an obvious error.
 */
export const terrainSource = Object.freeze({
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  tileSize: 256,
  maxzoom: 15,
  encoding: 'terrarium',
  attribution: 'Elevation © Mapzen / AWS Terrain Tiles',
});

/** Exaggeration ~1.2: visible relief without turning the Deccan into the Alps. */
export const TERRAIN_EXAGGERATION = 1.2;

export const hillshadeLayer = Object.freeze({
  id: LYR.HILLSHADE,
  type: 'hillshade',
  source: SRC.TERRAIN,
  paint: {
    'hillshade-shadow-color': '#3a3a3a',
    'hillshade-exaggeration': 0.35,
  },
});

/**
 * Sky and atmospheric fog.
 *
 * NOTE FOR ANYONE UPDATING MAPLIBRE: in v5+ this is a top-level STYLE PROPERTY
 * set with `map.setSky(...)`. It is no longer a layer with `type: 'sky'` — that
 * layer type was removed, and adding one now throws. `fog-color` only has an
 * effect while 3D terrain is on.
 */
export const skySpec = Object.freeze({
  'sky-color': '#84b7ec',
  'horizon-color': '#dfe9f5',
  'fog-color': '#e8eef6',
  'fog-ground-blend': 0.6,
  'horizon-fog-blend': 0.5,
  'sky-horizon-blend': 0.6,
  'atmosphere-blend': 0.8,
});

/* ── 3D buildings ───────────────────────────────────────────────────────── */

/**
 * Real OSM building footprints, extruded to their real heights.
 *
 * The height expression is a fallback chain, in order of how much we trust it:
 *   1. `render_height`  — OpenMapTiles' own resolved height, in metres.
 *   2. `building:levels` × 3 m — a real, mapped storey count.
 *   3. 10 m — only where OSM knows the footprint but nothing about height.
 *      A flat 10 m is honest about being a guess; inventing a varied skyline
 *      would look better and mean less.
 *
 * `fill-extrusion-height` must be a number, and OSM tags arrive as strings, so
 * every branch coerces with `to-number`.
 *
 * @param {string} sourceLayer the vector source-layer holding buildings
 * @param {string} source the vector source id in the loaded style
 */
export function buildingsLayer(source = 'openmaptiles', sourceLayer = 'building') {
  return {
    id: LYR.BUILDINGS,
    type: 'fill-extrusion',
    source,
    'source-layer': sourceLayer,
    // Below ~14 there are too many footprints to be anything but noise, and
    // the tiles rarely carry them anyway.
    minzoom: 13,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      // Taller reads warmer — a cheap depth cue that survives both themes.
      'fill-extrusion-color': [
        'interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'render_height']], 10],
        0, '#d8dbe0',
        40, '#c3c7ce',
        120, '#a9aeb8',
      ],
      'fill-extrusion-height': [
        'case',
        ['has', 'render_height'], ['to-number', ['get', 'render_height']],
        ['has', 'building:levels'], ['*', ['to-number', ['get', 'building:levels']], 3],
        10,
      ],
      'fill-extrusion-base': [
        'case',
        ['has', 'render_min_height'], ['to-number', ['get', 'render_min_height']],
        0,
      ],
      'fill-extrusion-opacity': 0.85,
    },
  };
}

/* ── Camera ─────────────────────────────────────────────────────────────── */

/** Close enough to read a street, pitched enough for the extrusions to matter. */
export const CITY_VIEW = Object.freeze({ zoom: 15.2, pitch: 60, bearing: -18 });

/** Tight on a single site. */
export const SITE_VIEW = Object.freeze({ zoom: 17.4, pitch: 62, bearing: -22 });

/* ── The Google Photorealistic 3D Tiles seam ───────────────────────────── */

/**
 * Whether a photorealistic-tiles key is configured.
 *
 * The seam, deliberately narrow: nothing else in the feature branches on this.
 * Swapping in Google Photorealistic 3D Tiles (or Cesium) means implementing a
 * renderer behind this one check, not editing components — they ask
 * `photorealAvailable()` and otherwise render the free stack, which is the
 * only stack that exists today.
 *
 * Why it is not implemented now: Google's 3D Tiles are OGC 3D Tiles, which
 * MapLibre cannot render natively. It needs CesiumJS or deck.gl's Tile3DLayer
 * alongside — a real dependency and a real bill, both of which should be a
 * deliberate decision rather than something that switches on when an env var
 * appears.
 *
 * @returns {boolean}
 */
export function photorealAvailable() {
  return Boolean(import.meta.env?.VITE_GOOGLE_3D_TILES_KEY);
}

/** The key, for whoever implements the seam. Never logged, never sent anywhere else. */
export function photorealKey() {
  return import.meta.env?.VITE_GOOGLE_3D_TILES_KEY || null;
}
