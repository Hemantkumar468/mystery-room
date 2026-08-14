import { createSlice } from '@reduxjs/toolkit';

/**
 * Franchise Network Map state.
 *
 * Everything the map and any list beside it must agree on lives here — which
 * city we are looking at, what is filtered out, which layers are on, and which
 * location is selected. The map does NOT own this: the map is one view of it,
 * a list or a table would be another, and both stay in sync because neither
 * holds the state.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 * -------------------------------
 * The live camera (centre/zoom/pitch/bearing as the user drags). MapLibre owns
 * that internally and it changes on every animation frame; mirroring it into
 * Redux would dispatch dozens of actions a second to no benefit. What IS here
 * is `flyTarget` — an *intent* to move the camera, set by a city switch or a
 * search hit, which the map consumes and acts on. Intent is state; the
 * resulting 60fps camera is not.
 *
 * @typedef {'open'|'lead'|'delayed'|'ai'} FranchiseStatus
 */

/** @type {FranchiseStatus[]} */
export const FRANCHISE_STATUSES = ['open', 'lead', 'delayed', 'ai'];

/**
 * Status → how it is drawn and what it means. One table, so the pin colour,
 * the legend swatch and the filter chip can never disagree.
 */
export const STATUS_META = Object.freeze({
  open: { label: 'Open', color: '#16a34a', hint: 'Trading outlet' },
  lead: { label: 'Lead', color: '#f59e0b', hint: 'Site under evaluation' },
  delayed: { label: 'Delayed', color: '#dc2626', hint: 'Behind plan or blocked' },
  ai: { label: 'AI Opportunity', color: '#8b5cf6', hint: 'Suggested by the AI module' },
});

/** The layers a user can switch on and off. */
export const LAYER_KEYS = Object.freeze({
  SATELLITE: 'satellite',
  BUILDINGS: 'buildings',
  TERRAIN: 'terrain',
  LABELS: 'labels',
  AI: 'ai',
});

/**
 * The franchise pipeline, in order.
 *
 * Ordered because the order is the meaning: this is a funnel, and "everything
 * from LOI onwards" is a question people actually ask. `order` makes that a
 * comparison rather than a hand-maintained list of which stages count as late.
 *
 * Deliberately NOT the same axis as `status`. Stage is how far along the deal
 * is; status is whether it is healthy. A site can be at Fit-out and delayed,
 * or at Enquiry and perfectly on track — collapsing the two into one dropdown
 * is what makes a pipeline unreadable.
 */
export const STAGES = Object.freeze([
  { key: 'enquiry', label: 'Enquiry', order: 0 },
  { key: 'property', label: 'Property', order: 1 },
  { key: 'loi', label: 'LOI', order: 2 },
  { key: 'fitout', label: 'Fit-out', order: 3 },
  { key: 'live', label: 'Live', order: 4 },
]);

export const STAGE_KEYS = Object.freeze(STAGES.map((s) => s.key));

/** Stage metadata by key, for labels without a `.find()` at every call site. */
export const STAGE_META = Object.freeze(
  Object.fromEntries(STAGES.map((s) => [s.key, s])),
);

/**
 * How much of the planet the map is showing.
 *
 * `WORLD` is the whole globe, unmasked and unfenced. `COUNTRY` masks everything
 * outside one country and fences the camera to its bounds — which is exactly
 * what the map used to do for India permanently, now as a choice rather than
 * a hard-coded assumption.
 */
export const SCOPES = Object.freeze({
  WORLD: 'world',
  COUNTRY: 'country',
});

/**
 * The country the map opens on.
 *
 * A plain constant here rather than an import from `features/network` — the
 * slice is under `app/` and must not reach into a feature folder for its own
 * initial state. countries.js exports the same value and the two agree; if a
 * second home country ever exists, this is the one to change.
 */
export const HOME_COUNTRY = 'IN';

const initialState = {
  /**
   * Opens scoped to India — the home country, and where every location in the
   * data actually is. Opening on the whole world meant landing on a globe with
   * every pin clustered into one small patch of Asia, which is a worse first
   * screen than the country itself.
   *
   * `country` is remembered across a switch to WORLD and back, so stepping out
   * to check something global and returning does not lose where you were.
   */
  scope: SCOPES.COUNTRY,
  country: HOME_COUNTRY,

  /** City name, or null for "everywhere". Matched against location.city. */
  selectedCity: null,

  filters: {
    /**
     * Which statuses are visible. Absent from the array = hidden. Starts with
     * every status on: a map that opens with things already hidden makes
     * people think data is missing.
     */
    statuses: [...FRANCHISE_STATUSES],
    region: null,
    /**
     * Pipeline stage, or null for all. A single value rather than an array
     * like `statuses`: "show me everything at LOI" is the real question, and
     * an arbitrary subset of a funnel is not.
     */
    stage: null,
    /** Free text, matched against name + city. Debounced at the input. */
    search: '',
  },

  layers: {
    [LAYER_KEYS.SATELLITE]: true,
    [LAYER_KEYS.BUILDINGS]: true,
    [LAYER_KEYS.TERRAIN]: true,
    [LAYER_KEYS.LABELS]: true,
    [LAYER_KEYS.AI]: false,
  },

  /** Which pin's details panel is open. */
  selectedLocationId: null,

  /**
   * A requested camera move: { lng, lat, zoom?, pitch?, bearing?, at }.
   * `at` is a monotonically increasing counter, not a timestamp — it exists so
   * that flying to the SAME coordinates twice still registers as two separate
   * requests. Without it the second click on an already-selected city would be
   * a no-op, because the payload would be deep-equal to the last one.
   */
  flyTarget: null,
  flySeq: 0,

  /** Gentle idle rotation. Off by default and suppressed for reduced-motion. */
  tourMode: false,

  /**
   * Last known camera, mirrored here on move-END only.
   *
   * NOT on every frame. Bearing and pitch change sixty times a second while
   * someone drags, and pushing that through a store would re-render every
   * connected component for the whole gesture. The map owns its live camera;
   * this is a settled snapshot, for anything that wants to read or restore
   * where the user was looking.
   */
  camera: {
    center: [78.9, 22.6],
    zoom: 4.2,
    pitch: 55,
    bearing: 0,
  },

  /** Is the Add Lead form open? */
  addLeadOpen: false,

  /**
   * Leads created in this session.
   *
   * Kept in the slice rather than in RTK Query cache because there is no
   * create endpoint behind them yet — see mockLeads.js. When one lands, this
   * becomes the optimistic layer over it and nothing else has to move.
   */
  draftLeads: [],

  /**
   * Map-domain notifications: a lead added, a filter hiding everything, and
   * so on. Separate from the app-wide bell in the Topbar, which carries
   * server notifications from the PMS — mixing "your approval is waiting"
   * with "you just added a pin" would devalue both.
   */
  notifications: [],
  notificationSeq: 0,
};

const mapSlice = createSlice({
  name: 'map',
  initialState,
  reducers: {
    /** Show the whole world. Keeps `country` so switching back restores it. */
    scopeWorldSet: (state) => {
      state.scope = SCOPES.WORLD;
      // A city drill-in is meaningless at world scope, and leaving it set
      // would keep the pins filtered to one city with no visible reason why.
      state.selectedCity = null;
      state.selectedLocationId = null;
    },

    /** Narrow to one country by ISO alpha-2 code. */
    scopeCountrySet: (state, action) => {
      const code = action.payload;
      if (!code) return;
      state.scope = SCOPES.COUNTRY;
      // Changing country invalidates a city selected inside the old one.
      if (state.country !== code) {
        state.selectedCity = null;
        state.selectedLocationId = null;
      }
      state.country = code;
    },

    /** Select a city (or pass null for "everywhere"). Does not fly on its own. */
    citySelected: (state, action) => {
      state.selectedCity = action.payload ?? null;
    },

    statusFilterToggled: (state, action) => {
      const status = action.payload;
      const on = state.filters.statuses.includes(status);
      state.filters.statuses = on
        ? state.filters.statuses.filter((s) => s !== status)
        : [...state.filters.statuses, status];
    },

    statusFiltersSet: (state, action) => {
      state.filters.statuses = action.payload ?? [];
    },

    regionFilterSet: (state, action) => {
      state.filters.region = action.payload ?? null;
    },

    stageFilterSet: (state, action) => {
      state.filters.stage = action.payload ?? null;
    },

    searchSet: (state, action) => {
      state.filters.search = action.payload ?? '';
    },

    filtersReset: (state) => {
      state.filters = {
        statuses: [...FRANCHISE_STATUSES],
        region: null,
        stage: null,
        search: '',
      };
      state.selectedCity = null;
    },

    layerToggled: (state, action) => {
      const key = action.payload;
      if (key in state.layers) state.layers[key] = !state.layers[key];
    },

    layerSet: (state, action) => {
      const { key, value } = action.payload;
      if (key in state.layers) state.layers[key] = Boolean(value);
    },

    locationSelected: (state, action) => {
      state.selectedLocationId = action.payload ?? null;
    },

    /**
     * Ask the map to move. See `flyTarget`'s note on `flySeq` — the sequence
     * number is what makes a repeat request to the same place still count.
     */
    flyRequested: (state, action) => {
      state.flySeq += 1;
      state.flyTarget = { ...action.payload, at: state.flySeq };
    },

    flyConsumed: (state) => {
      state.flyTarget = null;
    },

    tourModeToggled: (state) => {
      state.tourMode = !state.tourMode;
    },

    tourModeSet: (state, action) => {
      state.tourMode = Boolean(action.payload);
    },

    /** Settled camera, written on move-end. See `camera` on the initial state. */
    cameraSettled: (state, action) => {
      const { center, zoom, pitch, bearing } = action.payload || {};
      if (Array.isArray(center)) state.camera.center = center;
      if (Number.isFinite(zoom)) state.camera.zoom = zoom;
      if (Number.isFinite(pitch)) state.camera.pitch = pitch;
      if (Number.isFinite(bearing)) state.camera.bearing = bearing;
    },

    addLeadOpened: (state) => { state.addLeadOpen = true; },
    addLeadClosed: (state) => { state.addLeadOpen = false; },

    /**
     * Record a new lead and announce it.
     *
     * The id is supplied by the caller rather than generated here — a reducer
     * must be a pure function of its arguments, and `Date.now()` inside one
     * makes the same action produce different state on replay, which breaks
     * time-travel debugging and any future optimistic-update reconciliation.
     */
    leadAdded: {
      reducer: (state, action) => {
        state.draftLeads.push(action.payload);
        state.notificationSeq += 1;
        state.notifications.unshift({
          id: `n-${state.notificationSeq}`,
          kind: 'lead_added',
          title: 'Lead added',
          message: `${action.payload.name} — ${action.payload.city}`,
          at: action.payload.createdAt,
          read: false,
        });
        state.addLeadOpen = false;
      },
      prepare: (lead) => ({ payload: lead }),
    },

    notificationRead: (state, action) => {
      const found = state.notifications.find((n) => n.id === action.payload);
      if (found) found.read = true;
    },

    notificationsAllRead: (state) => {
      state.notifications.forEach((n) => { n.read = true; });
    },

    notificationsCleared: (state) => {
      state.notifications = [];
    },
  },
});

export const {
  scopeWorldSet,
  scopeCountrySet,
  citySelected,
  statusFilterToggled,
  statusFiltersSet,
  regionFilterSet,
  stageFilterSet,
  searchSet,
  filtersReset,
  layerToggled,
  layerSet,
  locationSelected,
  flyRequested,
  flyConsumed,
  tourModeToggled,
  tourModeSet,
  cameraSettled,
  addLeadOpened,
  addLeadClosed,
  leadAdded,
  notificationRead,
  notificationsAllRead,
  notificationsCleared,
} = mapSlice.actions;

/* ── Selectors ─────────────────────────────────────────────────────────── */

export const selectMapState = (state) => state.map;
export const selectSelectedCity = (state) => state.map.selectedCity;
export const selectScope = (state) => state.map.scope;
export const selectCountry = (state) => state.map.country;
/** The country code the map is masked to, or null when showing the world. */
export const selectScopedCountry = (state) => (
  state.map.scope === SCOPES.COUNTRY ? state.map.country : null
);
export const selectMapFilters = (state) => state.map.filters;
export const selectMapLayers = (state) => state.map.layers;
export const selectSelectedLocationId = (state) => state.map.selectedLocationId;
export const selectFlyTarget = (state) => state.map.flyTarget;
export const selectTourMode = (state) => state.map.tourMode;
export const selectCamera = (state) => state.map.camera;
export const selectAddLeadOpen = (state) => state.map.addLeadOpen;
export const selectDraftLeads = (state) => state.map.draftLeads;
export const selectMapNotifications = (state) => state.map.notifications;
export const selectUnreadNotificationCount = (state) =>
  state.map.notifications.filter((n) => !n.read).length;

/** True when any filter is narrowing the view — drives the "Clear" affordance. */
export const selectHasActiveFilters = (state) => {
  const { statuses, region, stage, search } = state.map.filters;
  return (
    statuses.length !== FRANCHISE_STATUSES.length
    || Boolean(region)
    || Boolean(stage)
    || Boolean(search.trim())
    || Boolean(state.map.selectedCity)
  );
};

/**
 * Apply the current filters to a list of locations.
 *
 * A plain function rather than a memoised selector on purpose: the locations
 * come from RTK Query, not from this slice, so there is no single state path
 * to select them from. `useFranchiseData` calls this inside a `useMemo`, which
 * is where the memoisation belongs.
 *
 * @param {Array<object>} locations
 * @param {{statuses: string[], region: ?string, search: string}} filters
 * @param {?string} selectedCity
 * @returns {Array<object>}
 */
export function applyFilters(locations, filters, selectedCity) {
  if (!Array.isArray(locations)) return [];
  const needle = (filters?.search || '').trim().toLowerCase();
  const statuses = filters?.statuses || [];

  return locations.filter((loc) => {
    if (!statuses.includes(loc.status)) return false;
    if (selectedCity && loc.city !== selectedCity) return false;
    if (filters?.region && loc.region !== filters.region) return false;
    // A location with no stage is filtered OUT when a stage is selected, not
    // waved through. "Show me everything at LOI" must not also return the
    // records nobody has staged yet.
    if (filters?.stage && loc.stage !== filters.stage) return false;
    if (needle) {
      const haystack = `${loc.name || ''} ${loc.city || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export default mapSlice.reducer;
