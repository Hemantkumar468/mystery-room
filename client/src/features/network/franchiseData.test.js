import { describe, it, expect } from 'vitest';
import {
  isGps, projectStatusToMapStatus, propertyCoords,
  projectToLocation, propertyToLocation, suggestionLocations,
  spreadOverlaps, buildLocations, aggregateByCity, networkSummary,
} from './franchiseData.js';
import { applyFilters, FRANCHISE_STATUSES } from '../../app/slices/mapSlice.js';

/** A p1 property record, shaped the way the API actually returns one. */
const property = (over = {}) => ({
  _id: 'p1',
  title: 'Crystal Plaza',
  status: 'shortlisted',
  project: { _id: 'proj1', city: 'Bhopal' },
  values: {
    live_location: { lat: 23.1976, lng: 77.4174, capturedAt: '2026-08-06T07:45:40Z' },
    locality: 'MP Nagar',
    carpet_area: 2400,
  },
  ...over,
});

const project = (over = {}) => ({
  _id: 'proj1',
  code: 'MR-BHO-001',
  name: 'Bhopal DB Mall',
  city: 'Bhopal',
  status: 'active',
  health: 'on_track',
  progress: 42,
  stages: [
    { key: 'p1', name: 'Property Identification', order: 0, status: 'completed' },
    { key: 'p2', name: 'Site Evaluation', order: 1, status: 'in_progress' },
  ],
  ...over,
});

describe('isGps', () => {
  it('accepts a real fix', () => {
    expect(isGps({ lat: 23.1976, lng: 77.4174 })).toBe(true);
  });

  it('rejects null island', () => {
    // 0,0 is in the Atlantic. In this database it means an uninitialised
    // field got saved, never a property.
    expect(isGps({ lat: 0, lng: 0 })).toBe(false);
  });

  it('rejects malformed and out-of-range values', () => {
    expect(isGps(null)).toBe(false);
    expect(isGps({})).toBe(false);
    expect(isGps({ lat: '23.1', lng: '77.4' })).toBe(false);
    expect(isGps({ lat: 200, lng: 77 })).toBe(false);
    expect(isGps({ lat: NaN, lng: 77 })).toBe(false);
  });
});

describe('projectStatusToMapStatus', () => {
  it('reads a live store as open', () => {
    expect(projectStatusToMapStatus(project({ status: 'store_live' }))).toBe('open');
    expect(projectStatusToMapStatus(project({ status: 'archived' }))).toBe('open');
  });

  it('reads poor health as delayed, whatever phase it is in', () => {
    expect(projectStatusToMapStatus(project({ health: 'delayed' }))).toBe('delayed');
    expect(projectStatusToMapStatus(project({ health: 'at_risk' }))).toBe('delayed');
  });

  it('lets open outrank poor health', () => {
    // A trading store is trading. Health belongs to the build, not the shop.
    expect(projectStatusToMapStatus(project({ status: 'store_live', health: 'delayed' }))).toBe('open');
  });

  it('treats everything else as a lead', () => {
    expect(projectStatusToMapStatus(project())).toBe('lead');
  });
});

describe('projectToLocation', () => {
  it('positions a project on its approved property\'s real GPS', () => {
    const approved = property({ status: 'approved' });
    const out = projectToLocation(project(), [approved]);

    expect(out.coordsSource).toBe('gps');
    expect(out.coords).toEqual({ lng: 77.4174, lat: 23.1976 });
    expect(out.pmsUrl).toBe('/projects/proj1');
  });

  it('falls back to the city centre when no site has a fix', () => {
    const out = projectToLocation(project(), []);
    expect(out.coordsSource).toBe('city');
    // Bhopal's centre, from cityCoords.
    expect(out.coords.lat).toBeCloseTo(23.2599, 3);
    // And it says so, rather than passing a guess off as a survey.
    expect(out.details.find((d) => d.label === 'Position').value).toMatch(/city centre/i);
  });

  it('refuses to place a project with an unknown city and no fix', () => {
    expect(projectToLocation(project({ city: 'Atlantis' }), [])).toBeNull();
  });

  it('ignores properties belonging to a different project', () => {
    const other = property({ _id: 'p9', project: { _id: 'other', city: 'Pune' } });
    expect(projectToLocation(project(), [other]).coordsSource).toBe('city');
  });
});

describe('propertyToLocation', () => {
  it('maps a shortlisted property to a lead', () => {
    const out = propertyToLocation(property());
    expect(out.status).toBe('lead');
    expect(out.pmsUrl).toBe('/projects/proj1/property-identification/p1');
  });

  it('drops rejected and archived properties', () => {
    // These are decisions on the record, not part of the network. Drawing them
    // would suggest we are still pursuing them.
    expect(propertyToLocation(property({ status: 'rejected' }))).toBeNull();
    expect(propertyToLocation(property({ status: 'archived' }))).toBeNull();
  });

  it('drops a property with no captured location', () => {
    expect(propertyToLocation(property({ values: { locality: 'MP Nagar' } }))).toBeNull();
  });
});

describe('propertyCoords', () => {
  it('reads the live_location field', () => {
    expect(propertyCoords(property())).toEqual({ lng: 77.4174, lat: 23.1976 });
  });

  it('returns null when there is nothing to read', () => {
    expect(propertyCoords({})).toBeNull();
    expect(propertyCoords(null)).toBeNull();
  });
});

describe('spreadOverlaps', () => {
  const stacked = (id) => ({
    id,
    coords: { lat: 23.1976, lng: 77.4174 },
    displayCoords: { lat: 23.1976, lng: 77.4174 },
    coordsAdjustedForDisplay: false,
  });

  it('leaves a lone pin exactly where it was captured', () => {
    const [out] = spreadOverlaps([stacked('a')]);
    expect(out.displayCoords).toEqual(out.coords);
    expect(out.coordsAdjustedForDisplay).toBe(false);
  });

  it('fans out pins that share a coordinate', () => {
    // The real case: every property in this database was captured from the
    // same desk, so eight properties are one unclickable pin.
    const out = spreadOverlaps([stacked('a'), stacked('b'), stacked('c')]);

    expect(out).toHaveLength(3);
    const positions = new Set(out.map((l) => `${l.displayCoords.lat},${l.displayCoords.lng}`));
    expect(positions.size).toBe(3);
    expect(out.every((l) => l.coordsAdjustedForDisplay)).toBe(true);
    expect(out.every((l) => l.overlapCount === 3)).toBe(true);
  });

  it('never alters the captured coordinate', () => {
    const out = spreadOverlaps([stacked('a'), stacked('b')]);
    expect(out.every((l) => l.coords.lat === 23.1976 && l.coords.lng === 77.4174)).toBe(true);
  });

  it('is deterministic — the same input gives the same output', () => {
    // No randomness anywhere, so a pin cannot jump on re-render.
    const a = spreadOverlaps([stacked('a'), stacked('b'), stacked('c')]);
    const b = spreadOverlaps([stacked('a'), stacked('b'), stacked('c')]);
    expect(a.map((l) => l.displayCoords)).toEqual(b.map((l) => l.displayCoords));
  });

  it('leaves genuinely separate pins alone', () => {
    const far = { ...stacked('z'), coords: { lat: 19.076, lng: 72.8777 } };
    const out = spreadOverlaps([stacked('a'), far]);
    expect(out.every((l) => !l.coordsAdjustedForDisplay)).toBe(true);
  });
});

describe('suggestionLocations', () => {
  it('suggests only cities with nothing in them', () => {
    const existing = [{ city: 'Bhopal' }, { city: 'Mumbai' }];
    const cities = suggestionLocations(existing).map((l) => l.city);
    expect(cities).not.toContain('Bhopal');
    expect(cities).not.toContain('Mumbai');
    expect(cities).toContain('Chennai');
  });

  it('does not offer Bengaluru and Bangalore as two places', () => {
    const cities = suggestionLocations([]).map((l) => l.city);
    expect(cities).toContain('Bangalore');
    expect(cities).not.toContain('Bengaluru');
  });

  it('labels every suggestion as an AI marker, not a site', () => {
    const out = suggestionLocations([]);
    expect(out.every((l) => l.status === 'ai' && l.kind === 'suggestion')).toBe(true);
  });
});

describe('buildLocations', () => {
  it('flags — not drops — the site that positions the project', () => {
    // The chosen property IS one site drawn twice in the default view, so
    // it is flagged and applyFilters hides it there. But under an explicit
    // project or property-stage filter the full captured list is what was
    // asked for, and the chosen site belongs in it.
    const approved = property({ status: 'approved' });
    const out = buildLocations({ projects: [project()], properties: [approved] });
    expect(out).toHaveLength(2);
    expect(out.find((l) => l.kind === 'property').claimedByProject).toBe(true);

    const defaults = { statuses: [...FRANCHISE_STATUSES], project: null, propertyStatus: null, region: null, stage: null, search: '' };
    expect(applyFilters(out, defaults, null).map((l) => l.kind)).toEqual(['project']);
    expect(applyFilters(out, { ...defaults, project: 'proj1' }, null)).toHaveLength(2);
  });

  it('keeps the OTHER candidates when one of them positions the project', () => {
    // A project usually has several shortlisted sites. The one it is placed on
    // must not be drawn twice, but the rest are still live candidates and
    // belong on the map as leads.
    const chosen = property({ _id: 'p1', status: 'approved' });
    const alsoInTheRunning = property({
      _id: 'p2',
      title: 'Shree Plaza',
      status: 'shortlisted',
      values: { live_location: { lat: 22.7196, lng: 75.8577 } },
    });

    const out = buildLocations({
      projects: [project()],
      properties: [chosen, alsoInTheRunning],
    });

    expect(out.map((l) => l.kind).sort()).toEqual(['project', 'property', 'property']);
    // Only the chosen one carries the flag; the live candidate does not.
    expect(out.find((l) => l.name === 'Shree Plaza').claimedByProject).toBeUndefined();
    expect(out.find((l) => l.kind === 'property' && l.name !== 'Shree Plaza').claimedByProject).toBe(true);
  });

  it('adds AI suggestions only when asked', () => {
    const withoutAi = buildLocations({ projects: [project()], properties: [], includeAi: false });
    const withAi = buildLocations({ projects: [project()], properties: [], includeAi: true });

    expect(withoutAi.some((l) => l.status === 'ai')).toBe(false);
    expect(withAi.some((l) => l.status === 'ai')).toBe(true);
  });

  it('survives empty input', () => {
    expect(buildLocations({})).toEqual([]);
  });
});

describe('aggregateByCity', () => {
  const at = (city, status, lng, lat, kind = 'project') => ({
    id: `${city}-${status}-${lng}`,
    city,
    status,
    kind,
    region: 'West',
    coords: { lng, lat },
    displayCoords: { lng, lat },
  });

  it('collapses a city into one pin carrying its count', () => {
    const out = aggregateByCity([
      at('Mumbai', 'open', 72.87, 19.07),
      at('Mumbai', 'open', 72.89, 19.09),
      at('Pune', 'lead', 73.85, 18.52),
    ]);

    expect(out).toHaveLength(2);
    // Sorted biggest-first, so the busiest city leads the list.
    expect(out[0].city).toBe('Mumbai');
    expect(out[0].count).toBe(2);
    expect(out[1].count).toBe(1);
  });

  it('shows a city in its WORST status, not its most common one', () => {
    // Four open outlets and one delayed build is a city with a problem in it.
    // A green pin over the top of that hides the thing you opened the map for.
    const [mumbai] = aggregateByCity([
      at('Mumbai', 'open', 72.87, 19.07),
      at('Mumbai', 'open', 72.88, 19.08),
      at('Mumbai', 'open', 72.89, 19.09),
      at('Mumbai', 'delayed', 72.90, 19.10),
    ]);

    expect(mumbai.status).toBe('delayed');
    expect(mumbai.breakdown).toEqual({ open: 3, delayed: 1 });
  });

  it('places the pin at the mean of its members, not the city centre', () => {
    // A cluster of outlets in one suburb should pull the pin to the suburb.
    const [pune] = aggregateByCity([
      at('Pune', 'open', 73.80, 18.50),
      at('Pune', 'open', 73.90, 18.60),
    ]);

    expect(pune.coords.lng).toBeCloseTo(73.85, 5);
    expect(pune.coords.lat).toBeCloseTo(18.55, 5);
  });

  it('keeps every member so a city can be drilled into', () => {
    const [mumbai] = aggregateByCity([
      at('Mumbai', 'open', 72.87, 19.07),
      at('Mumbai', 'lead', 72.88, 19.08),
    ]);
    expect(mumbai.members).toHaveLength(2);
  });

  it('buckets locations with no city rather than dropping them', () => {
    const out = aggregateByCity([at('—', 'lead', 77, 23)]);
    expect(out[0].city).toBe('Unknown');
  });

  it('survives empty input', () => {
    expect(aggregateByCity([])).toEqual([]);
    expect(aggregateByCity()).toEqual([]);
  });
});

describe('networkSummary', () => {
  const loc = (status, kind, city = 'Pune') => ({ status, kind, city });

  it('counts projects in progress separately from franchise leads', () => {
    const out = networkSummary([
      loc('open', 'project'),
      loc('lead', 'project'),
      loc('lead', 'property'),
      loc('lead', 'property'),
      loc('delayed', 'project'),
    ]);

    expect(out).toMatchObject({ open: 1, inProgress: 1, leads: 2, delayed: 1 });
  });

  it('excludes AI suggestions from every count', () => {
    // They are places we are NOT. Folding them into a total labelled "network"
    // would inflate it with cities that have nothing in them.
    const out = networkSummary([
      loc('open', 'project', 'Pune'),
      loc('ai', 'suggestion', 'Kochi'),
    ]);

    expect(out.open).toBe(1);
    expect(out.cities).toBe(1);
  });

  it('counts distinct cities', () => {
    const out = networkSummary([
      loc('open', 'project', 'Pune'),
      loc('open', 'project', 'Pune'),
      loc('lead', 'property', 'Mumbai'),
    ]);
    expect(out.cities).toBe(2);
  });
});
