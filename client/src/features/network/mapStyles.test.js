import { describe, it, expect } from 'vitest';
import {
  indiaOnlyStyle, styleFor, BASEMAPS, hasBuildingGeometry,
  INDIA_TERRAIN_EXAGGERATION, TERRAIN_EXAGGERATION, exaggerationForZoom, INDIA_EXTRUSION_K, SRC, LYR,
} from './mapStyles.js';
import { INDIA_GEOJSON, INDIA_POLYGONS, INDIA_MASK_GEOJSON } from './indiaBoundary.js';
import {
  INDIA_BOUNDS, INDIA_ROTATE_BOUNDS, INDIA_MIN_ZOOM, INDIA_VIEW, INDIA_FLAT_VIEW,
} from './cityCoords.js';

describe('the national view is India and nothing else', () => {
  it('fetches nothing at all', () => {
    // THE REQUIREMENT, AS A TEST. A tile source draws the whole planet, which
    // is a world map you are not allowed to pan rather than a map of India.
    //
    // The country view briefly fetched an elevation DEM to get real mountains,
    // and that is now gone: the exaggeration needed to make relief visible at
    // country zoom (~77×) tore the terrain mesh apart, because the terrarium
    // DEM carries bathymetry and the seafloor dropped hundreds of kilometres.
    // Its third dimension comes from extruded geometry we own instead, so this
    // view is back to needing no network whatsoever.
    const style = indiaOnlyStyle('light');
    const sources = Object.values(style.sources);

    expect(sources.every((s) => s.type === 'geojson')).toBe(true);
    expect(sources.some((s) => s.tiles || s.url)).toBe(false);
  });

  it('paints out every country but India', () => {
    const style = indiaOnlyStyle('light');
    const ids = style.layers.map((l) => l.id);

    // The slab stands above the ground-level mask, and the coastline is drawn
    // last around its base.
    expect(ids.indexOf(LYR.INDIA_FILL)).toBeLessThan(ids.indexOf(LYR.INDIA_MASK));
    expect(ids.indexOf(LYR.INDIA_MASK)).toBeLessThan(ids.indexOf(LYR.INDIA_LINE));

    // And the mask must be the SAME colour as the background, or the seam
    // between "nothing" and "painted out" becomes visible.
    const background = style.layers.find((l) => l.id === LYR.INDIA_BG).paint['background-color'];
    const mask = style.layers.find((l) => l.id === LYR.INDIA_MASK).paint['fill-color'];
    expect(mask).toBe(background);
  });

  it('raises the country off the background as a solid', () => {
    // The whole reason the view reads as 3D rather than as a tilted picture of
    // a map: India has side walls, and rotating the camera sweeps them round.
    const fill = indiaOnlyStyle('light').layers.find((l) => l.id === LYR.INDIA_FILL);
    expect(fill.type).toBe('fill-extrusion');
    expect(fill.paint['fill-extrusion-base']).toBe(0);
    expect(fill.paint['fill-extrusion-height']).toBeTruthy();
  });

  it('keeps the slab a constant thickness on screen at every zoom', () => {
    /*
     * Height is metres; what matters is pixels. Metres-per-pixel halves each
     * zoom level, so a fixed height is a sliver zoomed out and a skyscraper
     * zoomed in — the same trap that made terrain unusable here.
     */
    const metresPerPixel = (z) => (156543.03392 * Math.cos((22 * Math.PI) / 180)) / 2 ** z;
    const thickness = (z) => (INDIA_EXTRUSION_K / 2 ** z) / metresPerPixel(z);

    for (const z of [3.4, 4, 6, 8, 10]) {
      expect(thickness(z)).toBeCloseTo(thickness(4), 5);
    }
    // Thick enough to read as solid, thin enough not to swallow the pins.
    expect(thickness(4)).toBeGreaterThan(8);
    expect(thickness(4)).toBeLessThan(45);
  });

  it.each(['light', 'dark'])('draws a country you can actually see (%s)', (theme) => {
    /*
     * THE REGRESSION TEST FOR THE DAY THE MAP WENT BLANK.
     *
     * The country was a 42%-opacity tint over a near-identical background,
     * which rendered as rgb(222,233,244) against rgb(232,239,247): a
     * ten-value difference on one channel. Every layer was present, the style
     * validated clean, the camera was correctly framed — and the screen was
     * an empty blue-grey field, because land and sea were the same colour.
     *
     * Relief was doing all the work of separating them, so the map depended on
     * a network request to show the one thing it is a map of. It must not.
     */
    const style = indiaOnlyStyle(theme);
    const fill = style.layers.find((l) => l.id === LYR.INDIA_FILL);
    const background = style.layers.find((l) => l.id === LYR.INDIA_BG).paint['background-color'];

    // Opaque: the land does not depend on anything underneath it.
    expect(fill.paint['fill-extrusion-opacity']).toBe(1);

    const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16));
    const land = channels(fill.paint['fill-extrusion-color']);
    const sea = channels(background);
    const contrast = Math.max(...land.map((c, i) => Math.abs(c - sea[i])));

    // 10/255 is what failed. Anything under ~40 is not a coastline.
    expect(contrast).toBeGreaterThan(40);
  });

  it('exaggerates relief hard at country scale and barely at city scale', () => {
    // India is ~3,000 km wide and ~8.6 km tall: 1:350. True to scale the
    // Himalayas are a rounding error, so the national view multiplies them.
    expect(INDIA_TERRAIN_EXAGGERATION).toBeGreaterThan(TERRAIN_EXAGGERATION);
    expect(INDIA_TERRAIN_EXAGGERATION).toBeGreaterThan(3);
  });

  it('renders relief you can actually SEE at country zoom', () => {
    /*
     * THE REGRESSION TEST FOR THE FLAT-LOOKING 3D MAP.
     *
     * Terrain was on and working, at a fixed exaggeration of 7. Terrain
     * displacement is metres divided by metres-per-pixel, and at zoom 4 over
     * India a pixel is ~9 km of ground — so Everest was lifted by SIX AND A
     * HALF PIXELS. Correct, enabled, and indistinguishable from flat.
     *
     * The value has to come from how tall the mountains should look, not from
     * a number that seemed reasonable.
     */
    const PEAK = 8848;
    const metresPerPixel = (z) => (156543.03392 * Math.cos((22 * Math.PI) / 180)) / 2 ** z;
    const reliefPx = (z) => (PEAK * exaggerationForZoom(z)) / metresPerPixel(z);

    // The old fixed 7 produced ~6.8px here. Anything under ~30 reads as flat.
    expect(reliefPx(4)).toBeGreaterThan(50);
    expect(reliefPx(5)).toBeGreaterThan(50);
    expect(reliefPx(6)).toBeGreaterThan(50);
  });

  it('keeps apparent relief constant instead of deforming as you zoom', () => {
    // The same fixed number that makes mountains at zoom 4 makes a bed of
    // spikes at zoom 12 — the required exaggeration halves per zoom level.
    // Constant apparent height is also what stops the ground heaving during a
    // flyTo from the country into a city.
    const at = (z) => exaggerationForZoom(z);
    expect(at(4) / at(5)).toBeCloseTo(2, 1);
    expect(at(5) / at(6)).toBeCloseTo(2, 1);
  });

  it('clamps at both ends so no zoom produces a spike field or a pancake', () => {
    // Floor: city zoom stays honest rather than flattening to nothing.
    expect(exaggerationForZoom(15)).toBeGreaterThanOrEqual(1.2);
    expect(exaggerationForZoom(22)).toBeGreaterThanOrEqual(1.2);
    // Ceiling: a noisy DEM tile at the far-out view must not become a bed of
    // nails.
    expect(exaggerationForZoom(0)).toBeLessThanOrEqual(130);
    expect(exaggerationForZoom(-5)).toBeLessThanOrEqual(130);
  });

  it('scales with latitude, because Mercator does', () => {
    // A degree of longitude is narrower near the poles, so metres-per-pixel
    // shrinks and the same exaggeration reads taller.
    expect(exaggerationForZoom(4, 8)).toBeGreaterThan(exaggerationForZoom(4, 35));
  });

  it('gives the tilted view a sky to rotate against', () => {
    // Without one a pitched map is a trapezoid on flat colour, which reads as
    // a broken 2D map rather than a 3D one.
    const style = indiaOnlyStyle('light');
    expect(style.sky).toBeTruthy();
    expect(style.sky['sky-color']).toBeTruthy();
    expect(indiaOnlyStyle('dark').sky['sky-color']).not.toBe(style.sky['sky-color']);
  });

  it('draws background, the raised country, the mask and the coastline', () => {
    const style = indiaOnlyStyle('light');
    expect(style.layers.map((l) => l.type)).toEqual([
      'background', 'fill-extrusion', 'fill', 'line',
    ]);
  });

  it('carries the country geometry inline, so the outline survives an outage', () => {
    const style = indiaOnlyStyle('light');
    expect(style.sources[SRC.INDIA].data).toBe(INDIA_GEOJSON);
    expect(style.sources[SRC.INDIA].data.geometry.type).toBe('MultiPolygon');
    // If the DEM host is unreachable the relief never engages, and this is
    // what is left: the country, drawn from a bundled file. Degraded, not blank.
    expect(style.sources[SRC.INDIA_MASK].data).toBe(INDIA_MASK_GEOJSON);
  });

  it('has a distinct palette in each theme', () => {
    // The style is drawn by us rather than fetched, so it has to follow the
    // app's own light/dark setting — a white country in a dark shell reads as
    // a bug, not a design.
    const light = indiaOnlyStyle('light');
    const dark = indiaOnlyStyle('dark');
    const bg = (s) => s.layers[0].paint['background-color'];
    expect(bg(light)).not.toBe(bg(dark));
  });

  it('is what styleFor returns for the India basemap', () => {
    const style = styleFor(BASEMAPS.INDIA, 0, 'light');
    expect(typeof style).toBe('object');
    expect(Object.values(style.sources)[0].type).toBe('geojson');
  });

  it('still hands a URL to the city basemaps', () => {
    expect(typeof styleFor(BASEMAPS.STREETS)).toBe('string');
    // Satellite is a built style object (raster tiles), not a URL.
    expect(typeof styleFor(BASEMAPS.SATELLITE)).toBe('object');
  });

  it('offers no building extrusion on the drawn outline', () => {
    expect(hasBuildingGeometry(BASEMAPS.INDIA)).toBe(false);
    expect(hasBuildingGeometry(BASEMAPS.SATELLITE)).toBe(false);
    expect(hasBuildingGeometry(BASEMAPS.STREETS)).toBe(true);
  });
});

describe('the bundled India boundary', () => {
  it('spans the real extent of the country', () => {
    let minLng = 180;
    let maxLng = -180;
    let minLat = 90;
    let maxLat = -90;
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]);
        minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
      } else c.forEach(walk);
    };
    walk(INDIA_POLYGONS);

    // Gujarat's western tip to Arunachal; Indira Point to the top of Kashmir.
    expect(minLng).toBeGreaterThan(66); expect(minLng).toBeLessThan(70);
    expect(maxLng).toBeGreaterThan(96); expect(maxLng).toBeLessThan(99);
    expect(minLat).toBeGreaterThan(6); expect(minLat).toBeLessThan(9);
    expect(maxLat).toBeGreaterThan(35); expect(maxLat).toBeLessThan(38);
  });

  it('has closed rings with enough points to be a polygon', () => {
    for (const polygon of INDIA_POLYGONS) {
      for (const ring of polygon) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
      }
    }
  });

  it('stays small enough to bundle', () => {
    // The whole point of simplifying: 10.7 MB of source geometry is not
    // something to ship to a browser. If a re-generation blows past this,
    // the tolerance was set wrong.
    const bytes = JSON.stringify(INDIA_POLYGONS).length;
    expect(bytes).toBeLessThan(120 * 1024);
  });
});

describe('the not-India mask', () => {
  const rings = INDIA_MASK_GEOJSON.geometry.coordinates;

  it('is one polygon: a rectangle with the country punched out', () => {
    expect(INDIA_MASK_GEOJSON.geometry.type).toBe('Polygon');
    // Outer ring plus one hole per India polygon.
    expect(rings).toHaveLength(1 + INDIA_POLYGONS.length);
  });

  it('covers far more than the country it hides', () => {
    // The mask has to reach past anything a rotated, tilted camera can see,
    // or the Hindu Kush reappears in the corner of the screen at 200° bearing.
    const outer = rings[0];
    const lngs = outer.map((c) => c[0]);
    const lats = outer.map((c) => c[1]);

    expect(Math.min(...lngs)).toBeLessThan(0);
    expect(Math.max(...lngs)).toBeGreaterThan(150);
    expect(Math.min(...lats)).toBeLessThan(-40);
    expect(Math.max(...lats)).toBeGreaterThan(60);
  });

  it('punches only outer rings, never India\'s own holes', () => {
    // A lake inside India is a hole in India. Punching it through the mask as
    // well would paint it back in as background — a hole in the hole.
    expect(rings.length - 1).toBe(INDIA_POLYGONS.length);
  });

  it('winds its holes opposite to the outer ring', () => {
    // earcut takes the first ring as the outline and the rest as holes, and
    // gets winding wrong often enough to be worth asserting.
    const signedArea = (ring) => {
      let a = 0;
      for (let i = 0; i < ring.length - 1; i += 1) {
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      return a / 2;
    };
    const outerSign = Math.sign(signedArea(rings[0]));
    const holeSigns = rings.slice(1).map((r) => Math.sign(signedArea(r)));
    expect(holeSigns.every((s) => s === -outerSign || s === 0)).toBe(true);
  });

  it('has closed rings', () => {
    for (const ring of rings) {
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });
});

describe('the camera cannot leave India', () => {
  it('is fenced by bounds that exclude other continents', () => {
    const [[west, south], [east, north]] = INDIA_BOUNDS;
    // Padded wider than the coastline on purpose (maxBounds constrains the
    // viewport, not the centre), but nowhere near another continent.
    expect(west).toBeGreaterThan(40);   // no Africa or Europe
    expect(east).toBeLessThan(120);     // no east Asia or Pacific
    expect(south).toBeGreaterThanOrEqual(-10);
    expect(north).toBeLessThan(50);
  });

  it('contains the whole country inside the fence', () => {
    const [[west, south], [east, north]] = INDIA_BOUNDS;
    let ok = true;
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        if (c[0] < west || c[0] > east || c[1] < south || c[1] > north) ok = false;
      } else c.forEach(walk);
    };
    walk(INDIA_POLYGONS);
    expect(ok).toBe(true);
  });

  it('opens flat and north-up, so the country is seen whole first', () => {
    /*
     * This used to assert the opposite — that the map opened tilted and off
     * north, so the 3D was the first thing you noticed. It came at a cost
     * nobody wanted: a tilted camera brings the near edge closer while the far
     * edge runs to the horizon, so India arrived with its extremities cropped.
     *
     * Seeing the country whole beats seeing it dramatically. The tilt and the
     * full 360° rotation are one tap away on the camera controls.
     */
    expect(INDIA_VIEW.pitch).toBe(0);
    expect(INDIA_VIEW.bearing).toBe(0);
    expect(INDIA_FLAT_VIEW.pitch).toBe(0);
    expect(INDIA_FLAT_VIEW.bearing).toBe(0);
  });

  it('never lets the opening zoom sit below the floor', () => {
    // The first frame is replaced by a fitBounds almost immediately, but a
    // starting zoom under minZoom would be clamped upward on mount and show a
    // visible jump before the fit even begins.
    expect(INDIA_MIN_ZOOM).toBeGreaterThan(3);
    expect(INDIA_VIEW.zoom).toBeGreaterThanOrEqual(INDIA_MIN_ZOOM);
  });

  it('loosens the fence for the tilted country view', () => {
    // maxBounds constrains the viewport, and a pitched camera sees to the
    // horizon. The tight box against a tilted, rotating view means MapLibre
    // shoves the camera back every few degrees and rotation feels broken.
    const [[tightW, tightS], [tightE, tightN]] = INDIA_BOUNDS;
    const [[loosW, loosS], [loosE, loosN]] = INDIA_ROTATE_BOUNDS;

    expect(loosW).toBeLessThan(tightW);
    expect(loosE).toBeGreaterThan(tightE);
    expect(loosS).toBeLessThan(tightS);
    expect(loosN).toBeGreaterThan(tightN);
  });
});
