import { describe, it, expect } from 'vitest';
import reducer, {
  FRANCHISE_STATUSES, LAYER_KEYS,
  citySelected, statusFilterToggled, searchSet, filtersReset,
  layerToggled, locationSelected, flyRequested, flyConsumed, tourModeToggled,
  selectHasActiveFilters, applyFilters,
  stageFilterSet, addLeadOpened, leadAdded, cameraSettled,
  notificationRead, notificationsAllRead, notificationsCleared,
  selectUnreadNotificationCount,
} from './mapSlice.js';

/** The reducer's own starting state, without exporting it just for tests. */
const initial = reducer(undefined, { type: '@@INIT' });

/** Minimal shape — only the fields applyFilters actually reads. */
const loc = (over = {}) => ({
  id: 'x', name: 'Andheri West', city: 'Mumbai', region: 'West', status: 'open', ...over,
});

describe('mapSlice — initial state', () => {
  it('starts with every status visible', () => {
    // A map that opens with pins already hidden reads as missing data.
    expect(initial.filters.statuses).toEqual([...FRANCHISE_STATUSES]);
  });

  it('starts with AI opportunities off and the real layers on', () => {
    expect(initial.layers[LAYER_KEYS.AI]).toBe(false);
    expect(initial.layers[LAYER_KEYS.BUILDINGS]).toBe(true);
    expect(initial.layers[LAYER_KEYS.TERRAIN]).toBe(true);
  });
});

describe('mapSlice — filters', () => {
  it('toggles a status off and back on', () => {
    const off = reducer(initial, statusFilterToggled('delayed'));
    expect(off.filters.statuses).not.toContain('delayed');

    const on = reducer(off, statusFilterToggled('delayed'));
    expect(on.filters.statuses).toContain('delayed');
  });

  it('reports active filters, and clears them all at once', () => {
    expect(selectHasActiveFilters({ map: initial })).toBe(false);

    const narrowed = [
      citySelected('Bhopal'),
      searchSet('plaza'),
      statusFilterToggled('ai'),
    ].reduce(reducer, initial);

    expect(selectHasActiveFilters({ map: narrowed })).toBe(true);

    const cleared = reducer(narrowed, filtersReset());
    expect(selectHasActiveFilters({ map: cleared })).toBe(false);
    // Clearing filters must also drop the city, or "Clear" leaves you looking
    // at one city with no visible reason why.
    expect(cleared.selectedCity).toBeNull();
  });
});

describe('mapSlice — layers and selection', () => {
  it('toggles a known layer and ignores an unknown one', () => {
    const on = reducer(initial, layerToggled(LAYER_KEYS.AI));
    expect(on.layers[LAYER_KEYS.AI]).toBe(true);

    const unchanged = reducer(on, layerToggled('not-a-layer'));
    expect(unchanged.layers).toEqual(on.layers);
  });

  it('selects and deselects a location', () => {
    const picked = reducer(initial, locationSelected('project:abc'));
    expect(picked.selectedLocationId).toBe('project:abc');
    expect(reducer(picked, locationSelected(null)).selectedLocationId).toBeNull();
  });
});

describe('mapSlice — fly requests', () => {
  it('makes a repeat request to the same place a NEW request', () => {
    // The bug this guards: without a sequence number the second payload is
    // deep-equal to the first, the effect never re-runs, and clicking the
    // already-selected city does nothing.
    const first = reducer(initial, flyRequested({ lng: 77.4, lat: 23.2 }));
    const second = reducer(first, flyRequested({ lng: 77.4, lat: 23.2 }));

    expect(second.flyTarget.at).toBeGreaterThan(first.flyTarget.at);
    expect(second.flyTarget).not.toEqual(first.flyTarget);
  });

  it('clears the target once the map has consumed it', () => {
    const requested = reducer(initial, flyRequested({ lng: 1, lat: 2 }));
    expect(reducer(requested, flyConsumed()).flyTarget).toBeNull();
  });

  it('toggles tour mode', () => {
    expect(reducer(initial, tourModeToggled()).tourMode).toBe(true);
  });
});

describe('applyFilters', () => {
  const locations = [
    loc({ id: 'a', status: 'open', city: 'Mumbai', region: 'West' }),
    loc({ id: 'b', status: 'lead', city: 'Bhopal', region: 'Central', name: 'Crystal Plaza' }),
    loc({ id: 'c', status: 'delayed', city: 'Bhopal', region: 'Central', name: 'DB Mall' }),
    loc({ id: 'd', status: 'ai', city: 'Chennai', region: 'South', name: 'Chennai — no presence' }),
  ];

  it('keeps everything when nothing is narrowed', () => {
    expect(applyFilters(locations, initial.filters, null)).toHaveLength(4);
  });

  it('filters by status', () => {
    const filters = { ...initial.filters, statuses: ['open', 'lead'] };
    expect(applyFilters(locations, filters, null).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('filters by city', () => {
    expect(applyFilters(locations, initial.filters, 'Bhopal').map((l) => l.id)).toEqual(['b', 'c']);
  });

  it('filters by region', () => {
    const filters = { ...initial.filters, region: 'South' };
    expect(applyFilters(locations, filters, null).map((l) => l.id)).toEqual(['d']);
  });

  it('searches name and city, case-insensitively', () => {
    expect(applyFilters(locations, { ...initial.filters, search: 'crystal' }, null)
      .map((l) => l.id)).toEqual(['b']);
    expect(applyFilters(locations, { ...initial.filters, search: 'CHENNAI' }, null)
      .map((l) => l.id)).toEqual(['d']);
  });

  it('combines filters rather than replacing one with another', () => {
    const filters = { ...initial.filters, statuses: ['delayed'], search: 'mall' };
    expect(applyFilters(locations, filters, 'Bhopal').map((l) => l.id)).toEqual(['c']);
  });

  it('survives being handed nothing', () => {
    expect(applyFilters(undefined, initial.filters, null)).toEqual([]);
    expect(applyFilters(null, initial.filters, null)).toEqual([]);
  });
});

describe('mapSlice — stage filter', () => {
  it('sets and clears a single stage', () => {
    const at = reducer(initial, stageFilterSet('loi'));
    expect(at.filters.stage).toBe('loi');
    expect(reducer(at, stageFilterSet(null)).filters.stage).toBeNull();
  });

  it('counts as an active filter, and is cleared with the rest', () => {
    const narrowed = reducer(initial, stageFilterSet('fitout'));
    expect(selectHasActiveFilters({ map: narrowed })).toBe(true);
    expect(reducer(narrowed, filtersReset()).filters.stage).toBeNull();
  });

  it('filters locations by stage', () => {
    const rows = [
      loc({ id: 'a', stage: 'loi' }),
      loc({ id: 'b', stage: 'fitout' }),
      loc({ id: 'c', stage: 'loi' }),
    ];
    const filters = { ...initial.filters, stage: 'loi' };
    expect(applyFilters(rows, filters, null).map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('excludes unstaged locations rather than waving them through', () => {
    // "Show me everything at LOI" must not also return the records nobody has
    // staged yet — an AI suggestion is an absence, not a deal at some stage.
    const rows = [loc({ id: 'a', stage: 'loi' }), loc({ id: 'b', stage: null })];
    const filters = { ...initial.filters, stage: 'loi' };
    expect(applyFilters(rows, filters, null).map((l) => l.id)).toEqual(['a']);
  });

  it('combines with status and city rather than replacing them', () => {
    const rows = [
      loc({ id: 'a', stage: 'loi', status: 'lead', city: 'Pune' }),
      loc({ id: 'b', stage: 'loi', status: 'delayed', city: 'Pune' }),
      loc({ id: 'c', stage: 'loi', status: 'lead', city: 'Mumbai' }),
    ];
    const filters = { ...initial.filters, stage: 'loi', statuses: ['lead'] };
    expect(applyFilters(rows, filters, 'Pune').map((l) => l.id)).toEqual(['a']);
  });
});

describe('mapSlice — leads and notifications', () => {
  const lead = {
    id: 'lead:pune-1', name: 'Rohan Kulkarni', city: 'Pune',
    stage: 'loi', status: 'lead', createdAt: '2026-08-13T10:00:00.000Z',
  };

  it('adds a lead, announces it, and closes the form', () => {
    const opened = reducer(initial, addLeadOpened());
    expect(opened.addLeadOpen).toBe(true);

    const added = reducer(opened, leadAdded(lead));
    expect(added.draftLeads).toHaveLength(1);
    expect(added.addLeadOpen).toBe(false);
    expect(added.notifications[0]).toMatchObject({ kind: 'lead_added', read: false });
    expect(added.notifications[0].message).toContain('Pune');
  });

  it('puts the newest notification first', () => {
    const two = [leadAdded(lead), leadAdded({ ...lead, id: 'lead:pune-2', name: 'Meera' })]
      .reduce(reducer, initial);
    expect(two.notifications[0].message).toContain('Meera');
  });

  it('gives every notification a distinct id', () => {
    // Ids come from a counter in state, not from Date.now() — two leads added
    // inside the same millisecond must not collide and break React keys.
    const two = [leadAdded(lead), leadAdded({ ...lead, id: 'lead:x' })].reduce(reducer, initial);
    const ids = two.notifications.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks one, all, and clears', () => {
    const added = reducer(reducer(initial, leadAdded(lead)), leadAdded({ ...lead, id: 'lead:2' }));
    expect(selectUnreadNotificationCount({ map: added })).toBe(2);

    const one = reducer(added, notificationRead(added.notifications[0].id));
    expect(selectUnreadNotificationCount({ map: one })).toBe(1);

    expect(selectUnreadNotificationCount({ map: reducer(added, notificationsAllRead()) })).toBe(0);
    expect(reducer(added, notificationsCleared()).notifications).toEqual([]);
  });
});

describe('mapSlice — camera', () => {
  it('records a settled camera', () => {
    const moved = reducer(initial, cameraSettled({
      center: [73.85, 18.52], zoom: 12.5, pitch: 60, bearing: -30,
    }));
    expect(moved.camera).toEqual({ center: [73.85, 18.52], zoom: 12.5, pitch: 60, bearing: -30 });
  });

  it('ignores partial or malformed payloads instead of writing undefined', () => {
    // moveend can fire mid-teardown; a NaN zoom in the store would poison
    // every consumer that reads it.
    const partial = reducer(initial, cameraSettled({ zoom: 9 }));
    expect(partial.camera.zoom).toBe(9);
    expect(partial.camera.center).toEqual(initial.camera.center);

    const junk = reducer(initial, cameraSettled({ zoom: NaN, center: 'nope' }));
    expect(junk.camera).toEqual(initial.camera);
  });
});
