import { useEffect } from 'react';
import { useAppSelector } from '../app/hooks.js';
import { selectMapLayers, LAYER_KEYS } from '../app/slices/mapSlice.js';
import {
  SRC, LYR, terrainSource, TERRAIN_EXAGGERATION, exaggerationForZoom,
  hillshadeLayer, skySpec, buildingsLayer, hasBuildingGeometry,
  indiaMaskLayers, BASEMAPS,
} from '../features/network/mapStyles.js';
import { countryPolygons } from '../features/network/countries.js';

/**
 * Apply layer toggles to a live map, imperatively.
 *
 * WHY IMPERATIVE. Remounting `<Map>` to change a layer throws away the tile
 * cache, the camera, and the WebGL context, and the user watches their city
 * redraw from scratch because they ticked a checkbox. MapLibre's own API is
 * imperative for exactly this reason, and react-map-gl hands you the instance
 * so you can use it. These effects add/remove/restyle in place; the map is
 * mounted once.
 *
 * ORDERING. Every effect is guarded on `styleLoaded` — calling `addSource`
 * before the style is up throws, and a style CHANGE (satellite ⇄ streets)
 * wipes every source and layer we added. `styleVersion` is bumped by the
 * caller on `styledata` so all of this re-runs and re-adds.
 *
 * LEVEL. The national view is a chart: one pin per city, counts to read, and
 * nothing that benefits from relief or extruded geometry. Buildings and
 * terrain are suppressed there regardless of the user's toggles — they cost
 * tiles and frames to render something invisible at country zoom — and come
 * back the moment you drill into a city, which is where there is a site to
 * look at. The toggles are not overwritten, only ignored while zoomed out, so
 * a user's choice is still theirs when they arrive in a city.
 *
 * @param {?object} map the maplibre-gl Map instance
 * @param {{styleLoaded: boolean, styleVersion: number, basemap: string,
 *          level: 'india'|'city'}} opts
 */
export function useMapLayers(map, {
  styleLoaded, styleVersion, basemap, level = 'city', theme = 'light', scopedCountry = null,
}) {
  const layers = useAppSelector(selectMapLayers);
  const inCity = level === 'city';

  const showBuildings = layers[LAYER_KEYS.BUILDINGS] && inCity;
  const showLabels = layers[LAYER_KEYS.LABELS];

  /*
   * Terrain runs at BOTH levels, for different reasons and at very different
   * strengths — and at both it is the user's to switch off.
   *
   *   India — the relief is what makes the country a solid rather than a
   *           shape on paper, at an exaggeration computed from zoom.
   *   City  — real ground under a real site, near-honest scale.
   *
   * It used to be forced on at country level on the reasoning that the relief
   * IS the view. That reasoning was wrong twice over: it left the Terrain
   * chip greyed out on the screen where the terrain is most dramatic, and it
   * took away the flat top-down read that is genuinely the better way to
   * compare cities.
   */
  /*
   * Terrain is a CITY-level feature only.
   *
   * It was briefly run at country level too, with the exaggeration cranked to
   * ~77× so the Himalayas would be more than seven pixels tall. That broke the
   * map: the terrarium DEM carries bathymetry, so the seafloor around India
   * was displaced 300-550 km downward while peaks rose 680 km, and the scene
   * left the view frustum entirely. MapLibre's terrain is built for ~1-3×, and
   * no honest value in that range is visible at country zoom.
   *
   * The country now gets its third dimension from an extruded polygon instead
   * — geometry we own, stable at every zoom, no DEM required. See
   * indiaOnlyStyle. Real elevation still runs here in a city, where a pixel is
   * metres rather than kilometres and 1.2× is both honest and legible.
   */
  const showTerrain = inCity && layers[LAYER_KEYS.TERRAIN];

  /* ── Terrain + hillshade + sky ─────────────────────────────────────── */
  useEffect(() => {
    if (!map || !styleLoaded) return undefined;

    /**
     * Re-apply exaggeration for the current zoom.
     *
     * Terrain displacement is metres converted to pixels, and that conversion
     * halves with every zoom level — so a fixed exaggeration is either
     * invisible when zoomed out or a bed of spikes when zoomed in. It gets
     * recomputed instead. See exaggerationForZoom for the arithmetic and the
     * bug that forced it.
     */
    const applyTerrain = () => {
      const zoom = map.getZoom();
      const latitude = map.getCenter().lat;
      const exaggeration = inCity
        ? TERRAIN_EXAGGERATION
        : exaggerationForZoom(zoom, latitude);

      const current = map.getTerrain();
      // setTerrain rebuilds the mesh, so it is not something to call on every
      // frame of a pinch. Only bother when the value has moved enough to be
      // visible — 5% is well under one pixel of relief.
      if (current && Math.abs(current.exaggeration - exaggeration) / exaggeration < 0.05) return;
      map.setTerrain({ source: SRC.TERRAIN, exaggeration });
    };

    try {
      if (showTerrain) {
        if (!map.getSource(SRC.TERRAIN)) map.addSource(SRC.TERRAIN, terrainSource);
        // The India style ships its own relief layer, correctly ordered over
        // the land and under the mask. Adding the city hillshade on top of it
        // there would shade the whole subcontinent AND every neighbour,
        // straight through the mask that exists to prevent exactly that.
        if (inCity && !map.getLayer(LYR.HILLSHADE)) {
          // Beneath everything else: hillshade is ground shading, and drawn
          // last it would sit on top of the buildings it is meant to be under.
          const first = map.getStyle()?.layers?.[0]?.id;
          map.addLayer(hillshadeLayer, first);
        }
        applyTerrain();
        // Sky is a style property in MapLibre v5+, not a layer — see skySpec.
        // The India style declares its own, so only the city view needs this.
        if (inCity) map.setSky?.(skySpec);
      } else {
        map.setTerrain(null);
        if (map.getLayer(LYR.HILLSHADE)) map.removeLayer(LYR.HILLSHADE);
      }

      if (!showTerrain) return undefined;
    } catch {
      // A tile host being unreachable must degrade to a flat map, not a blank
      // screen. The country still renders from its own bundled outline; it
      // simply stops being a solid.
      return undefined;
    }

    // Keep apparent relief constant as the user zooms. Without this the
    // mountains would grow to absurdity on the way in and flatten on the way
    // out, and the ground would visibly deform under a flyTo.
    const onZoom = () => { try { applyTerrain(); } catch { /* mid-style-swap */ } };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map, styleLoaded, styleVersion, showTerrain, inCity]);

  /* ── 3D buildings ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (!map || !styleLoaded) return;

    try {
      if (!showBuildings) {
        if (map.getLayer(LYR.BUILDINGS)) map.removeLayer(LYR.BUILDINGS);
        return;
      }
      if (map.getLayer(LYR.BUILDINGS)) return;

      // Only a vector basemap carries building footprints. Satellite tiles are
      // photographs — there is no geometry in them to extrude, so the toggle is
      // inert there rather than silently broken.
      if (!hasBuildingGeometry(basemap)) return;

      // Find the real vector source in the loaded style rather than assuming
      // it is called "openmaptiles" — a style can name its source anything.
      const style = map.getStyle();
      const buildingLayer = (style?.layers || []).find(
        (l) => l['source-layer'] === 'building' && l.source,
      );
      const source = buildingLayer?.source
        || Object.entries(style?.sources || {}).find(([, s]) => s.type === 'vector')?.[0];
      if (!source) return;

      // Insert beneath the first symbol layer so street names and place
      // labels stay readable on top of the extrusions.
      const firstSymbol = (style.layers || []).find((l) => l.type === 'symbol')?.id;
      map.addLayer(buildingsLayer(source, 'building'), firstSymbol);
    } catch {
      // Style without a building layer — nothing to extrude, carry on flat.
    }
  }, [map, styleLoaded, styleVersion, showBuildings, basemap]);

  /* ── India mask ────────────────────────────────────────────────────────
   * At country level, paint out every country but this one.
   *
   * This is what lets the national view use a REAL basemap. Tiles render the
   * whole planet; a world-sized rectangle with India cut out of it goes over
   * the top, and what is left is a real map of India and nothing else. Both
   * layers are added last so they sit above every basemap layer — the mask
   * has to cover roads and labels in Pakistan, not just their background.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!map || !styleLoaded) return;

    // Masked only when scoped to a country. At world scope there is nothing to
    // paint out — the whole point of that scope is seeing everything.
    const polygons = countryPolygons(scopedCountry);
    const wanted = Boolean(scopedCountry) && polygons && basemap !== BASEMAPS.INDIA;

    try {
      if (!wanted) {
        // The bundled-outline style draws its own mask as part of the style,
        // so removing these there would be removing the map.
        if (basemap !== BASEMAPS.INDIA) {
          if (map.getLayer(LYR.INDIA_MASK)) map.removeLayer(LYR.INDIA_MASK);
          if (map.getLayer(LYR.INDIA_LINE)) map.removeLayer(LYR.INDIA_LINE);
        }
        return;
      }

      const { maskSource, outlineSource, mask, outline } = indiaMaskLayers(theme, basemap, polygons);

      if (!map.getSource(maskSource.id)) map.addSource(maskSource.id, maskSource.spec);
      if (!map.getSource(outlineSource.id)) map.addSource(outlineSource.id, outlineSource.spec);

      // Re-added rather than restyled when the palette changes: the surround
      // colour depends on the basemap, and a style swap has already destroyed
      // these anyway.
      if (map.getLayer(mask.id)) map.removeLayer(mask.id);
      if (map.getLayer(outline.id)) map.removeLayer(outline.id);
      map.addLayer(mask);
      map.addLayer(outline);
    } catch {
      // Style still settling — the next styledata bump re-runs this. Failing
      // here shows a world map for a moment, never a blank one.
    }
  }, [map, styleLoaded, styleVersion, scopedCountry, basemap, theme]);

  /* ── Labels ────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!map || !styleLoaded) return;
    const visibility = showLabels ? 'visible' : 'none';

    try {
      // The satellite style's labels are a single raster overlay.
      if (map.getLayer(LYR.LABELS)) {
        map.setLayoutProperty(LYR.LABELS, 'visibility', visibility);
        return;
      }
      // Vector style: labels are every symbol layer in it.
      for (const layer of map.getStyle()?.layers || []) {
        if (layer.type === 'symbol') {
          map.setLayoutProperty(layer.id, 'visibility', visibility);
        }
      }
    } catch {
      // Style still settling; the next styledata bump re-runs this.
    }
  }, [map, styleLoaded, styleVersion, showLabels, basemap]);
}

export default useMapLayers;
