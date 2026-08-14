import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPinned } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/primitives.jsx';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary.jsx';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import {
  selectSelectedLocationId, selectSelectedCity, selectMapLayers, LAYER_KEYS,
  selectScopedCountry,
  locationSelected, citySelected, flyRequested,
} from '../../app/slices/mapSlice.js';
import { selectTheme } from '../../app/slices/uiSlice.js';
import { useFranchiseData } from '../../hooks/useFranchiseData.js';
import { aggregateByCity, networkSummary } from './franchiseData.js';
import { MapCanvas, MAP_SHELL_ID } from './MapCanvas.jsx';
import { LocationMarkers } from './LocationMarkers.jsx';
import { CityMarkers } from './CityMarkers.jsx';
import { LocationDetailsPanel } from './LocationDetailsPanel.jsx';
import { MapFooter } from './MapFooter.jsx';
import { AddLeadModal } from './AddLeadModal.jsx';
import { MapHeader } from './MapHeader.jsx';
import { MapHoverCard } from './MapHoverCard.jsx';
import { BASEMAPS, SITE_VIEW, CITY_VIEW } from './mapStyles.js';
import { INDIA_VIEW, cityCoord } from './cityCoords.js';
import { countryBounds, country } from './countries.js';
import './networkMap.css';

/**
 * The Franchise Network Map — India, and then one city at a time.
 *
 * TWO LEVELS, AND THE DISTINCTION IS THE WHOLE DESIGN
 * ---------------------------------------------------
 *   INDIA  — a chart. One pin per city carrying a name and a count
 *            ("Delhi NCR (3)"), flat, on a pale basemap. The question at this
 *            level is "where are we, and what is late". Sixty individual pins
 *            overlapping across the Deccan cannot answer it; seventeen city
 *            pins can.
 *
 *   CITY   — a site view. Individual locations, real imagery, real OSM
 *            buildings extruded, terrain, pitched camera. The question here is
 *            "which unit is that, and what is happening to it".
 *
 * There is no third source of truth for which level we are on: a city being
 * selected IS the city level. Selecting one drills in, clearing it returns to
 * the country. That is why `selectedCity` doubles as the filter and the
 * navigation state rather than the two being tracked separately and drifting.
 *
 * The camera is constrained to India in `MapCanvas` (`maxBounds` +
 * `minZoom`) — there is no world map behind this one to get lost in.
 */
export function NetworkMapPage() {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector(selectSelectedLocationId);
  const selectedCity = useAppSelector(selectSelectedCity);

  const level = selectedCity ? 'city' : 'india';

  /**
   * One basemap for both levels now, and switchable at both.
   *
   * It used to be forced to the drawn outline at country level, because a
   * world basemap shows the world. The India mask solves that properly — real
   * tiles underneath, everything but India painted out over the top — so the
   * country view can be a real satellite map of India, which is what it now
   * opens as. The bundled outline is still selectable as the offline fallback.
   */
  const [basemap, setBasemap] = useState(BASEMAPS.SATELLITE);
  // The India style is drawn by us, not fetched, so it has to follow the app's
  // own light/dark setting — a blazing white country in a dark shell reads as
  // a bug. Tile-based city basemaps carry their own palette and ignore this.
  const theme = useAppSelector(selectTheme);
  // The country style has no symbol layers, so the Labels toggle has to act on
  // the city-name pills the pins carry — see CityMarkers.
  const mapLayers = useAppSelector(selectMapLayers);
  const scopedCountry = useAppSelector(selectScopedCountry);

  const [hovered, setHovered] = useState(null);
  /**
   * Cursor position within the map shell, for placing the hover card.
   *
   * Plain state updated on mousemove, deliberately NOT in Redux — it changes
   * on every pointer event, and pushing that through a store would re-render
   * every connected component continuously while the mouse merely moves.
   */
  const [pointer, setPointer] = useState(null);
  const [shellBox, setShellBox] = useState(null);

  /**
   * Latest cursor position, in a ref rather than state.
   *
   * THE BUG THIS FIXES: gating the mousemove handler on `hovered` meant that
   * on the FIRST hover of a pin there was no pointer position yet — mouseenter
   * fires before the next mousemove — so the card rendered at 0,0 in the
   * corner of the map, under the header, until the mouse happened to move
   * again.
   *
   * Tracking into a ref costs nothing (no re-render) and means the position is
   * already known the instant a pin reports a hover.
   */
  const pointerRef = useRef(null);
  const boxRef = useRef(null);
  const hoveredRef = useRef(null);

  const shellRef = useCallback((node) => {
    if (!node) return;
    const box = { width: node.clientWidth, height: node.clientHeight };
    boxRef.current = box;
    setShellBox(box);
  }, []);

  const trackPointer = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    boxRef.current = { width: rect.width, height: rect.height };
    // Only push into state — and so re-render — while a card is actually up.
    if (hoveredRef.current) {
      setPointer(pointerRef.current);
      setShellBox(boxRef.current);
    }
  }, []);

  /** A pin reporting hover. Places the card immediately, at the known cursor. */
  const handleHover = useCallback((item) => {
    hoveredRef.current = item;
    setHovered(item);
    if (item && pointerRef.current) {
      setPointer(pointerRef.current);
      setShellBox(boxRef.current);
    }
  }, []);
  const [tileFallback, setTileFallback] = useState(null);
  /**
   * The live MapLibre instance, held so the camera buttons can drive it.
   *
   * Local state, not Redux: it is a WebGL object rather than data, and the
   * store's serializableCheck would rightly reject it.
   */
  const [mapInstance, setMapInstance] = useState(null);

  const { locations, filtered, counts, isLoading, isError, refetch } = useFranchiseData();

  // At country level the pins are cities; inside a city they are locations.
  const cities = useMemo(() => aggregateByCity(filtered), [filtered]);
  const summary = useMemo(() => networkSummary(filtered), [filtered]);

  const selected = useMemo(
    () => filtered.find((l) => l.id === selectedId) || null,
    [filtered, selectedId],
  );

  /** Drill into a city: select it, and fly the camera down to it. */
  const openCity = useCallback((city) => {
    dispatch(citySelected(city.city));
    dispatch(locationSelected(null));
    dispatch(flyRequested({
      lng: city.displayCoords.lng,
      lat: city.displayCoords.lat,
      ...CITY_VIEW,
    }));
  }, [dispatch]);

  /** The fit for the current scope — one definition, used by every caller. */
  const scopeFit = useCallback(() => {
    /*
     * Padding is MEASURED, not guessed.
     *
     * The header and footer are drawn OVER the map, so the area actually
     * available is the canvas minus their heights. Hard-coded insets were
     * close enough on a wide window and wrong on a narrow one: the header
     * wraps its filters onto a second row below ~1400px, growing to roughly
     * twice the height the constant assumed, and Kashmir ended up behind the
     * search bar on a view that measured as "fully fitted".
     *
     * Reading the real heights costs one layout query per fit and cannot drift
     * from the CSS.
     */
    const headerH = document.querySelector('.mr-map-header')?.offsetHeight ?? 56;
    const footerH = document.querySelector('.mr-map-footer')?.offsetHeight ?? 46;
    const GAP = 22; // breathing room so the coastline never touches a bar

    const padding = {
      top: headerH + GAP,
      bottom: footerH + GAP,
      left: 48,
      right: 48,
    };

    const box = scopedCountry ? countryBounds(scopedCountry) : null;
    return box
      ? { bounds: box, padding }
      : { bounds: [[-165, -55], [180, 72]], padding };
  }, [scopedCountry]);

  /**
   * Back out to the whole scoped country — fitted, not flown to a fixed zoom.
   *
   * It used to return to a hardcoded INDIA_VIEW, which was wrong twice: it
   * ignored the viewport (so the country could come back cropped) and it
   * ignored the scope entirely, so backing out of a city in Brazil sent the
   * camera to India.
   */
  const backToIndia = useCallback(() => {
    dispatch(citySelected(null));
    dispatch(locationSelected(null));
    dispatch(flyRequested(scopeFit()));
  }, [dispatch, scopeFit]);

  const handleSelect = useCallback((id) => {
    dispatch(locationSelected(id));
    const loc = filtered.find((l) => l.id === id);
    if (loc) {
      dispatch(flyRequested({
        lng: loc.displayCoords.lng,
        lat: loc.displayCoords.lat,
        ...SITE_VIEW,
      }));
    }
  }, [dispatch, filtered]);

  const clearSelection = useCallback(() => dispatch(locationSelected(null)), [dispatch]);

  /**
   * Fly to whatever the scope now is.
   *
   * Changing scope has to move the camera or the change is invisible: pick
   * Brazil while looking at India and the mask moves to Brazil while the view
   * stays over the Deccan, so the screen goes entirely sea. Fitting the
   * country's bounds is the only honest response to "show me this country".
   *
   * Keyed on the scope alone — it must not re-fire when pins or filters
   * change, or every keystroke in search would yank the camera back.
   */
  /**
   * Re-fit when the map's container changes size.
   *
   * THE BUG THIS FIXES, measured rather than guessed: `fitBounds` ran once on
   * mount and never again, so the zoom it computed for one window size was
   * kept for every other. Projecting India's extremes at 1280×720 put Kashmir
   * at y=-144 and Kanyakumari at y=762 on a 655px-tall canvas — the country
   * was cropped top and bottom purely because the window was smaller than the
   * one the fit was calculated for.
   *
   * Only while looking at a whole country: inside a city the user has chosen
   * where to be, and yanking the camera back on a window resize would undo
   * that.
   */
  useEffect(() => {
    const shell = document.getElementById(MAP_SHELL_ID);
    if (!shell || typeof ResizeObserver === 'undefined') return undefined;

    let timer = null;
    const observer = new ResizeObserver(() => {
      // Debounced: a drag-resize fires this continuously, and re-fitting on
      // every frame of it would animate the camera against the user's hand.
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!hoveredRef.current && !selectedCity) dispatch(flyRequested(scopeFit()));
      }, 220);
    });

    observer.observe(shell);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [dispatch, scopeFit, selectedCity]);

  useEffect(() => {
    dispatch(flyRequested(scopeFit()));
  }, [scopeFit, dispatch]);

  const knownCity = level === 'city' && Boolean(cityCoord(selectedCity));
  const nothingToShow = level === 'india' ? cities.length === 0 : filtered.length === 0;

  return (
    <>
      {/* The breadcrumb lives in the map's own header bar now, so this is just
          the page title. Carrying it in both places meant "Franchise map ›
          India" was on screen twice, six millimetres apart. */}
      <Topbar
        title={(
          <span className="row gap-2" style={{ alignItems: 'center' }}>
            <MapPinned size={18} />
            Franchise Network Map
          </span>
        )}
        subtitle={level !== 'city'
          ? `${summary.cities} cit${summary.cities === 1 ? 'y' : 'ies'} · ${filtered.length} location${filtered.length === 1 ? '' : 's'}`
          : `${filtered.length} location${filtered.length === 1 ? '' : 's'} in ${selectedCity}`}
      />

      {/*
        Full-bleed. `.content` normally pads every page and `.content-wide`
        caps it at --page-max and centres it, which is right for a page of
        cards and wrong for a map: it left a gutter down both sides and a band
        of empty background under the shell.
        `mr-map-page` zeroes the padding and drops the width cap, so the map
        runs edge to edge and fills the height that is left.
      */}
      <div className="content mr-map-page">
        <div className="mr-map-page__inner">
          {isError ? (
            <div className="mr-map-state">
            <ErrorState
              title="Couldn't load the network"
              hint="Something went wrong fetching projects and properties."
              onRetry={refetch}
            />
            </div>
          ) : (
            <div
              className="mr-map-shell"
              id={MAP_SHELL_ID}
              ref={shellRef}
              onMouseMove={trackPointer}
            >
              <ErrorBoundary
                title="The map could not start"
                hint="This usually means WebGL is unavailable, or the page is running inside a sandboxed preview pane that blocks Web Workers. Opening the app in a normal browser tab fixes it."
                onReset={refetch}
              >
                <MapCanvas
                  basemap={basemap}
                  level={level}
                  theme={theme}
                  scopedCountry={scopedCountry}
                  onMapReady={setMapInstance}
                  onTileSourceFallback={setTileFallback}
                >
                  {level === 'india' ? (
                    <CityMarkers
                      cities={cities}
                      onOpenCity={openCity}
                      onHover={handleHover}
                      showLabels={mapLayers[LAYER_KEYS.LABELS]}
                    />
                  ) : (
                    <LocationMarkers
                      locations={filtered}
                      selectedId={selectedId}
                      onSelect={handleSelect}
                      onHover={handleHover}
                    />
                  )}
                </MapCanvas>
              </ErrorBoundary>

              {/* Over the canvas, not above it — a header that pushes the map
                  down costs about a fifth of the country on a laptop. */}
              <MapHeader level={level} locations={locations} onBack={backToIndia} />

              {/* Along the bottom rather than down the left: as a side stack
                  this permanently covered a third of the country on the one
                  screen whose job is showing the country. */}
              {/* The title has to name what is actually on screen. Hardcoded
                  "India network" survived the scope filter and sat over a map
                  of Brazil. */}
              <MapFooter
                title={level === 'city'
                  ? `${selectedCity} network`
                  : scopedCountry
                    ? `${country(scopedCountry)?.name || scopedCountry} network`
                    : 'Global network'}
                summary={summary}
                basemap={basemap}
                onBasemapChange={setBasemap}
                level={level}
                visibleCount={filtered.length}
                map={mapInstance}
              />

              {selected && (
                <div className="mr-map-overlay mr-map-overlay--right">
                  <LocationDetailsPanel location={selected} onClose={clearSelection} />
                </div>
              )}

              {tileFallback && basemap === BASEMAPS.STREETS && (
                <div className="mr-map-notice" role="status">
                  {`Primary street tiles were unreachable — showing ${tileFallback.label} instead.`}
                </div>
              )}

              {level === 'city' && !knownCity && (
                <div className="mr-map-notice" role="status">
                  {`No coordinates on file for ${selectedCity} — showing its locations where they were captured.`}
                </div>
              )}

              {/* Shown even when something is selected: the details panel is
                  pinned to the right, so it never occupies the same space, and
                  surveying other pins while one is open is the normal way to
                  compare two sites. */}
              {hovered && (
                <MapHoverCard
                  item={hovered}
                  kind={level === 'india' ? 'city' : 'location'}
                  point={pointer}
                  box={shellBox}
                />
              )}

                            {isLoading && (
                <div className="mr-map-veil">
                  <Spinner label="Loading the network…" />
                </div>
              )}

              {!isLoading && nothingToShow && (
                <div className="mr-map-veil">
                  <EmptyState
                    icon={MapPinned}
                    title={locations.length ? 'Nothing matches these filters' : 'No mappable locations yet'}
                    hint={locations.length
                      ? 'Widen the status, region or city filters to bring pins back.'
                      : 'A project needs a known city, or a property needs an on-site GPS capture, before it can be placed on the map.'}
                    action={level === 'city' ? (
                      <button type="button" className="btn btn-subtle" onClick={backToIndia}>
                        Back to India
                      </button>
                    ) : undefined}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rendered outside the map shell so the modal is never clipped by the
          shell's `overflow: hidden`. */}
      <AddLeadModal />
    </>
  );
}

export default NetworkMapPage;
