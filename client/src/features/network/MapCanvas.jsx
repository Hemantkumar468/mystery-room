import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  NavigationControl, ScaleControl, AttributionControl, FullscreenControl,
} from 'react-map-gl/maplibre';
// Namespace import, not a default one. maplibre-gl v6 ships ESM with named
// exports only — it has no default export, and `import maplibregl from
// 'maplibre-gl'` fails the build outright rather than degrading. react-map-gl
// wants the module object here, which is exactly what this gives it.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppDispatch } from '../../app/hooks.js';
import { cameraSettled } from '../../app/slices/mapSlice.js';
import { useMapLayers } from '../../hooks/useMapLayers.js';
import { useFlyTo } from '../../hooks/useFlyTo.js';
import { styleFor, BASEMAPS, STREETS_STYLE_CANDIDATES } from './mapStyles.js';
import { INDIA_VIEW, INDIA_MIN_ZOOM } from './cityCoords.js';
import { countryBounds } from './countries.js';

/**
 * The id on the map shell.
 *
 * Shared rather than typed twice because FullscreenControl finds its target by
 * id string — a mismatch between here and NetworkMapPage would leave the
 * button present and silently doing nothing.
 */
export const MAP_SHELL_ID = 'mr-map-shell';

/**
 * The map itself — mounted once, then updated in place.
 *
 * Deliberately thin. It owns the MapLibre instance and nothing else: layers
 * are applied by `useMapLayers`, the camera by `useFlyTo`, and the pins are
 * children. Everything it knows about the outside world arrives as props or
 * through those hooks, which is what keeps a filter change from remounting a
 * WebGL context.
 *
 * `styleVersion` is the load-bearing detail. Switching basemaps replaces the
 * whole style, and MapLibre discards every source and layer added on top of
 * the old one. Bumping this counter on `styledata` makes the layer hooks
 * re-run and re-add what was lost — without it, buildings and terrain vanish
 * the first time someone switches to Streets and never come back.
 */
export function MapCanvas({
  basemap = BASEMAPS.INDIA,
  level = 'india',
  theme = 'light',
  scopedCountry = null,
  children,
  onMapReady,
  onTileSourceFallback,
}) {
  const dispatch = useAppDispatch();
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  /** Which streets-style candidate we are on — advanced when one fails. */
  const [streetsIndex, setStreetsIndex] = useState(0);

  const handleLoad = useCallback((e) => {
    const instance = e?.target || mapRef.current?.getMap?.();
    if (!instance) return;
    setMap(instance);
    setStyleLoaded(true);
    setStyleVersion((v) => v + 1);
    onMapReady?.(instance);
    // Debug handle. The map is a WebGL object with no DOM to inspect, so
    // without this there is no way to ask it what it is actually showing —
    // which is exactly how "the country is cut off" stayed a matter of opinion
    // instead of a measurement. Dev only; never present in a production build.
    if (import.meta.env?.DEV) window.__mrMap = instance;
  }, [onMapReady]);

  /**
   * Mirror the settled camera into Redux — on move-END only.
   *
   * Never per frame. Bearing and pitch change sixty times a second during a
   * drag, and dispatching that would re-render every connected component for
   * the whole gesture to describe a camera that has not stopped moving. The
   * map owns the live camera; the store gets where it came to rest.
   */
  useEffect(() => {
    if (!map) return undefined;
    const onMoveEnd = () => {
      const c = map.getCenter();
      dispatch(cameraSettled({
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      }));
    };
    map.on('moveend', onMoveEnd);
    return () => { map.off('moveend', onMoveEnd); };
  }, [map, dispatch]);

  // A style swap wipes our sources/layers — tell the hooks to put them back.
  useEffect(() => {
    if (!map) return undefined;
    const onStyleData = () => {
      if (map.isStyleLoaded?.()) {
        setStyleLoaded(true);
        setStyleVersion((v) => v + 1);
      }
    };
    map.on('styledata', onStyleData);
    return () => { map.off('styledata', onStyleData); };
  }, [map]);

  /**
   * A tile host that will not answer must not leave a white rectangle.
   *
   * MapLibre reports every network problem through `error`, including a
   * missing tile, so this deliberately reacts ONLY to the style document
   * itself failing — that is the failure that produces an empty map. A handful
   * of missing tiles is normal and self-heals on the next pan.
   */
  useEffect(() => {
    if (!map) return undefined;

    const onError = (e) => {
      const url = e?.error?.url || e?.source?.url || '';
      const isStyleDoc = STREETS_STYLE_CANDIDATES.some((c) => url && c.url.startsWith(url.split('?')[0]));
      const failedToLoadStyle = e?.error?.status >= 400 || e?.error?.message?.includes('Failed to fetch');
      if (!failedToLoadStyle) return;

      const nextIndex = streetsIndex + 1;
      if (basemap === BASEMAPS.STREETS && (isStyleDoc || !map.isStyleLoaded?.())
        && nextIndex < STREETS_STYLE_CANDIDATES.length) {
        setStreetsIndex(nextIndex);
        onTileSourceFallback?.(STREETS_STYLE_CANDIDATES[nextIndex]);
      }
    };

    map.on('error', onError);
    return () => { map.off('error', onError); };
  }, [map, basemap, streetsIndex, onTileSourceFallback]);

  useMapLayers(map, { styleLoaded, styleVersion, basemap, level, theme, scopedCountry });

  /**
   * The camera fence for the current scope, padded so a tilted view can still
   * be rotated. Null at world scope, which means no fence at all.
   */
  const scopeBounds = useMemo(() => {
    if (!scopedCountry) return null;
    const box = countryBounds(scopedCountry);
    if (!box) return null;
    const [[west, south], [east, north]] = box;
    /*
     * Padded by a full span, not half.
     *
     * `maxBounds` constrains the VIEWPORT, and MapLibre raises the effective
     * minimum zoom until the viewport fits inside it. Half a span was close
     * enough to the fitted view that on a wide window the fence was setting
     * the zoom instead of the fit — squeezing the country rather than framing
     * it. A full span leaves the fit in charge and still keeps the fence far
     * from any other continent.
     */
    const padX = Math.max(20, east - west);
    const padY = Math.max(20, north - south);
    return [
      [Math.max(-180, west - padX), Math.max(-85, south - padY)],
      [Math.min(180, east + padX), Math.min(85, north + padY)],
    ];
  }, [scopedCountry]);
  useFlyTo(map);

  /**
   * Memoised, and it is not an optimisation — it is correctness.
   *
   * The India style is BUILT, not a URL: `styleFor` returns a fresh object
   * every call. react-map-gl compares `mapStyle` by identity, so an unmemoised
   * call hands it a "new" style on every single render — which tears down and
   * reloads the style, which fires `styledata`, which bumps `styleVersion`,
   * which re-renders. A pan would have reloaded the country continuously.
   */
  const mapStyle = useMemo(
    () => styleFor(basemap, streetsIndex, theme),
    [basemap, streetsIndex, theme],
  );

  return (
    <Map
      ref={mapRef}
      mapLib={maplibregl}
      initialViewState={INDIA_VIEW}
      mapStyle={mapStyle}
      onLoad={handleLoad}
      style={{ width: '100%', height: '100%' }}
      // 85 is MapLibre's practical ceiling; past that the horizon fills the
      // viewport and there is nothing but sky to look at.
      maxPitch={85}
      /*
       * Fenced only when scoped to a country.
       *
       * At world scope there is deliberately no `maxBounds` at all and the
       * minimum zoom drops to 1 — the whole point of that scope is being able
       * to see and reach everything.
       *
       * Scoped to a country, the fence is the country's own bounding box
       * padded out. The padding is not cosmetic: `maxBounds` constrains the
       * VIEWPORT, and a camera tilted to 50° sees to the horizon, so a box
       * hugging the coastline makes MapLibre shove the camera back every few
       * degrees of rotation and the map feels broken.
       */
      maxBounds={scopeBounds}
      /*
       * The floor is low enough that a fit is never clamped by it.
       *
       * It used to be INDIA_MIN_ZOOM (3.4), which was fine for India on a
       * large window and wrong for a big country on a small one: fitBounds
       * would ask for a zoom below the floor, get clamped upward, and crop.
       * Wandering is stopped by `maxBounds`, which is the right tool for it —
       * a zoom floor was never doing that job anyway.
       */
      minZoom={scopeBounds ? 1.5 : 1}
      maxZoom={19}
      // ── 360° ──
      // Every rotation gesture MapLibre offers, on. Right-drag and ctrl-drag
      // spin the bearing a full turn; two-finger drag pitches on touch.
      // `touchZoomRotate` is what makes a phone able to rotate at all.
      dragRotate
      touchZoomRotate
      touchPitch
      pitchWithRotate
      // The default control carries the sources' attribution, which is the
      // licence condition Esri/OSM/AWS tiles are free under. It is collapsed,
      // not removed.
      attributionControl={false}
      // Keyboard users need to pan, zoom AND rotate without a mouse —
      // shift+arrow turns the bearing, shift+up/down pitches.
      keyboard
      cooperativeGestures={false}
    >
      {/*
        Fullscreen targets the SHELL, not the canvas.
        ----------------------------------------------
        `containerId` is the load-bearing part. Left to itself the control
        fullscreens MapLibre's own canvas element — and the header, the footer,
        the pins' overlay and the camera buttons are all siblings of that
        canvas, so they would every one of them vanish the moment you expanded.
        Pointing it at the shell takes the whole composition full screen.
      */}
      <FullscreenControl position="top-right" containerId={MAP_SHELL_ID} />

      {/* `visualizePitch` puts the tilt on the compass needle, so a rotated
          view can be read at a glance and reset with one click. */}
      <NavigationControl position="top-right" visualizePitch showCompass showZoom />
      <ScaleControl position="bottom-left" unit="metric" />
      <AttributionControl position="bottom-right" compact />
      {children}
    </Map>
  );
}

export default MapCanvas;
