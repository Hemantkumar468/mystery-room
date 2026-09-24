import { cityCoord, cityRegion, CITY_COORDS } from './cityCoords.js';

/**
 * Turning what the PMS actually stores into what a map can draw.
 *
 * Pure functions only — no React, no Redux, no network. That is what makes
 * this the part worth testing, and `useFranchiseData` the thin part that is
 * not.
 *
 * WHERE THE DATA COMES FROM
 * -------------------------
 * Nothing is invented. Two real collections already carry everything a
 * network map needs:
 *
 *   Projects   — one store being opened, with a city, a status and a health
 *                flag. These are the network's nodes.
 *   Properties — p1 Property Identification records, which carry a REAL GPS
 *                fix (`values.live_location`) captured on site from a phone.
 *
 * A project is positioned at its chosen property's GPS when there is one, and
 * at its city centre otherwise. Candidate properties that are not yet anyone's
 * chosen site show as leads in their own right.
 *
 * @typedef {{lng: number, lat: number}} Coords
 * @typedef {{label: string, value: string}} Detail
 * @typedef {{
 *   id: string, name: string, city: string, region: ?string,
 *   coords: Coords, displayCoords: Coords, coordsSource: 'gps'|'city',
 *   coordsAdjustedForDisplay: boolean,
 *   status: 'open'|'lead'|'delayed'|'ai', score: ?number,
 *   details: Detail[], pmsUrl: string, kind: 'project'|'property'|'suggestion'
 * }} FranchiseLocation
 */

/** Metres per degree of latitude — good enough for a 30 m collision test. */
const M_PER_DEG = 111_320;

/** True when a value looks like a real captured GPS fix. */
export function isGps(v) {
  return Boolean(
    v && typeof v === 'object'
    && Number.isFinite(v.lat) && Number.isFinite(v.lng)
    && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180
    // 0,0 is in the Atlantic. It is never a real Indian property; it is an
    // uninitialised field that got saved.
    && !(v.lat === 0 && v.lng === 0),
  );
}

/**
 * Map a project's status + health onto the map's four-colour vocabulary.
 *
 * `delayed` deliberately outranks everything except being open: a project that
 * is live is live, but one that is behind plan should read as behind plan on
 * the map no matter which phase it happens to be in.
 */
export function projectStatusToMapStatus(project) {
  const status = project?.status;
  if (status === 'store_live' || status === 'archived' || status === 'completed') return 'open';
  if (project?.health === 'delayed' || project?.health === 'at_risk') return 'delayed';
  return 'lead';
}

/**
 * Which franchise-pipeline stage a project is at, derived from how far its ten
 * PMS phases have actually got.
 *
 * The two vocabularies are different on purpose. The PMS tracks ten
 * operational phases; the business talks about a five-step funnel. Rather than
 * add a `stage` field for someone to keep in sync by hand — which would be
 * wrong within a week — it is read off the phases that are genuinely complete.
 *
 * The mapping follows the gates that already exist in the PMS:
 *   p1 Property Identification  → property
 *   p3 Commercial Finalization  → loi        (the LOI is the p3 gate)
 *   p6 Execution                → fitout
 *   store live                  → live
 *
 * @param {object} project
 * @returns {string} a STAGE_KEYS value
 */
export function projectStage(project) {
  if (project?.status === 'store_live' || project?.status === 'archived') return 'live';

  const done = new Set(
    (project?.stages || []).filter((s) => s.status === 'completed').map((s) => s.key),
  );

  if (done.has('p6') || done.has('p5')) return 'fitout';
  if (done.has('p3')) return 'loi';
  if (done.has('p1')) return 'property';
  return 'enquiry';
}

/** A short, human "where is this" line for the details panel. */
function phaseLabel(project) {
  const stages = project?.stages || [];
  const current = [...stages].sort((a, b) => a.order - b.order).find((s) => s.status !== 'completed');
  return current?.name || (stages.length ? 'All phases complete' : '—');
}

/**
 * The GPS fix on a property record, if it captured one.
 * @param {object} record
 * @returns {?Coords}
 */
export function propertyCoords(record) {
  const loc = record?.values?.live_location;
  return isGps(loc) ? { lng: loc.lng, lat: loc.lat } : null;
}

/**
 * One project → one map location.
 *
 * @param {object} project
 * @param {Array<object>} properties every p1 record (used to find its site)
 * @returns {?FranchiseLocation} null when we cannot place it at all
 */
export function projectToLocation(project, properties = []) {
  if (!project?._id) return null;

  // The site this project is actually being built on: its own approved
  // property. Falls back to any property filed against it that has a fix,
  // then to the city centre.
  const own = properties.filter((p) => String(p.project?._id || p.project) === String(project._id));
  const chosen = own.find((p) => p.status === 'approved')
    || own.find((p) => p.status === 'shortlisted')
    || own.find((p) => propertyCoords(p));

  const gps = chosen ? propertyCoords(chosen) : null;
  const city = cityCoord(project.city);
  const coords = gps || (city ? { lng: city.lng, lat: city.lat } : null);
  if (!coords) return null; // unknown city and no fix — nothing honest to draw

  const status = projectStatusToMapStatus(project);

  return {
    id: `project:${project._id}`,
    projectId: String(project._id),
    kind: 'project',
    name: project.name,
    city: (project.city || '').trim() || '—',
    region: cityRegion(project.city),
    stage: projectStage(project),
    coords,
    displayCoords: coords,
    coordsSource: gps ? 'gps' : 'city',
    coordsAdjustedForDisplay: false,
    status,
    score: Number.isFinite(project.progress) ? project.progress : null,
    details: [
      { label: 'Code', value: project.code || '—' },
      { label: 'Status', value: String(project.status || '—').replace(/_/g, ' ') },
      { label: 'Health', value: String(project.health || '—').replace(/_/g, ' ') },
      { label: 'Current phase', value: phaseLabel(project) },
      { label: 'Progress', value: Number.isFinite(project.progress) ? `${project.progress}%` : '—' },
      { label: 'Owner', value: project.owner?.name || 'Unassigned' },
      { label: 'Type', value: project.projectType === 'franchise' ? 'Franchise' : 'Branch' },
      { label: 'Site', value: chosen?.title || 'Not yet chosen' },
      { label: 'Position', value: gps ? 'On-site GPS capture' : 'City centre (no GPS yet)' },
    ],
    pmsUrl: `/projects/${project._id}`,
  };
}

/**
 * A candidate property that is not the chosen site of any project → a lead.
 * Rejected properties are excluded: they are decisions on the record, not part
 * of the network, and drawing them would suggest we are still pursuing them.
 *
 * @param {object} record
 * @returns {?FranchiseLocation}
 */
export function propertyToLocation(record) {
  if (!record?._id) return null;
  if (record.status === 'rejected' || record.status === 'archived') return null;

  const gps = propertyCoords(record);
  if (!gps) return null; // a lead with no location cannot go on a map

  const projectId = record.project?._id || record.project;
  const city = (record.project?.city || record.values?.city || '').trim() || null;

  return {
    id: `property:${record._id}`,
    projectId: projectId ? String(projectId) : null,
    recordStatus: record.status || null,
    kind: 'property',
    name: record.title || record.values?.property_name || 'Candidate property',
    city: city || '—',
    region: cityRegion(city),
    // A candidate property IS the Property step of the funnel, by definition.
    stage: 'property',
    coords: gps,
    displayCoords: gps,
    coordsSource: 'gps',
    coordsAdjustedForDisplay: false,
    status: 'lead',
    score: null,
    details: [
      { label: 'Locality', value: record.values?.locality || '—' },
      { label: 'Area', value: record.values?.carpet_area ? `${record.values.carpet_area} sq ft` : '—' },
      { label: 'Floor', value: record.values?.floor || '—' },
      { label: 'Commercial', value: record.values?.commercial_type || '—' },
      { label: 'Broker', value: record.values?.broker_name || '—' },
      { label: 'Record status', value: String(record.status || '—').replace(/_/g, ' ') },
    ],
    pmsUrl: projectId
      ? `/projects/${projectId}/property-identification/${record._id}`
      : '/properties',
  };
}

/**
 * Cities with no project yet, as AI opportunity pins.
 *
 * DERIVED, NOT INVENTED — and it matters that the difference is visible. These
 * carry `kind: 'suggestion'` and the violet 'ai' status precisely so nobody
 * mistakes one for a real site. They answer "where are we absent" off the real
 * project list; they are not a prediction, and the details panel says so.
 *
 * @param {Array<FranchiseLocation>} existing
 * @returns {Array<FranchiseLocation>}
 */
export function suggestionLocations(existing) {
  const covered = new Set(existing.map((l) => (l.city || '').toLowerCase()));
  return Object.entries(CITY_COORDS)
    // Bengaluru/Bangalore are the same place under two names — one pin.
    .filter(([name]) => name !== 'Bengaluru')
    .filter(([name]) => !covered.has(name.toLowerCase()))
    .map(([name, c]) => ({
      id: `suggestion:${name}`,
      kind: 'suggestion',
      name: `${name} — no presence`,
      city: name,
      region: c.region,
      // Not in the funnel at all — nobody has enquired. Left null so a stage
      // filter excludes them, which is right: they are an absence, not a deal.
      stage: null,
      coords: { lng: c.lng, lat: c.lat },
      displayCoords: { lng: c.lng, lat: c.lat },
      coordsSource: 'city',
      coordsAdjustedForDisplay: false,
      status: 'ai',
      score: null,
      details: [
        { label: 'Region', value: c.region },
        { label: 'Why shown', value: 'An operating city with no project on the books' },
        { label: 'Basis', value: 'Derived from the live project list — not a forecast' },
      ],
      pmsUrl: '/projects',
    }));
}

/**
 * Fan out pins that sit on top of each other so they can all be clicked.
 *
 * THE PROBLEM THIS SOLVES IS REAL IN THIS DATABASE: every property captured so
 * far shares one coordinate to within two metres, because they were all
 * captured from the same desk during testing. Drawn faithfully, eight
 * properties are one pin and seven of them are unclickable.
 *
 * The captured coordinate is never altered — `coords` stays exactly as filed,
 * and only `displayCoords` moves, onto a small deterministic circle. Every
 * moved pin is flagged `coordsAdjustedForDisplay` so the details panel can say
 * so out loud. Deterministic (index-based, no randomness) so a pin does not
 * jump to a different spot on every render.
 *
 * @param {Array<FranchiseLocation>} locations
 * @param {number} thresholdM how close counts as "the same place"
 * @returns {Array<FranchiseLocation>}
 */
export function spreadOverlaps(locations, thresholdM = 30) {
  const buckets = new Map();
  const round = (n) => Math.round((n * M_PER_DEG) / thresholdM);

  for (const loc of locations) {
    const key = `${round(loc.coords.lat)}:${round(loc.coords.lng)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(loc);
  }

  const out = [];
  for (const group of buckets.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    // Radius grows with the crowd so twelve pins do not overlap on the circle.
    const radiusM = thresholdM * (1 + group.length / 8);
    group.forEach((loc, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      const dLat = (radiusM * Math.sin(angle)) / M_PER_DEG;
      const lonScale = Math.cos((loc.coords.lat * Math.PI) / 180) || 1;
      const dLng = (radiusM * Math.cos(angle)) / (M_PER_DEG * lonScale);
      out.push({
        ...loc,
        displayCoords: { lng: loc.coords.lng + dLng, lat: loc.coords.lat + dLat },
        coordsAdjustedForDisplay: true,
        overlapCount: group.length,
      });
    });
  }
  return out;
}

/**
 * Which status a city as a whole should be drawn in when its pins disagree.
 *
 * Worst-first, and that ordering is the point: a city with four open outlets
 * and one delayed build is a city with a problem in it, and a green pin over
 * the top of that is a map that hides the thing you opened it to find.
 */
const STATUS_PRIORITY = ['delayed', 'lead', 'open', 'ai'];

/**
 * Collapse locations into one pin per city — the national view.
 *
 * This is what makes the country-level map readable. Seventeen cities with a
 * count each ("Delhi NCR (3)", "Mumbai (2)") says more at a glance than sixty
 * individual pins overlapping across the Deccan, and it is the level at which
 * the question is "where are we?" rather than "which unit is that?".
 *
 * The city's pin sits at the mean of its members rather than at the city
 * centre from `cityCoords`, so a cluster of outlets in one suburb pulls the
 * pin to the suburb instead of to a town hall nobody works in.
 *
 * @param {Array<FranchiseLocation>} locations
 * @returns {Array<{
 *   id: string, city: string, region: ?string, coords: Coords,
 *   displayCoords: Coords, count: number, status: string,
 *   breakdown: Record<string, number>, members: Array<FranchiseLocation>
 * }>}
 */
export function aggregateByCity(locations = []) {
  const byCity = new Map();

  for (const loc of locations) {
    /*
     * TRIMMED, and it is not cosmetic. `city` comes from a free-text field
     * with an autocomplete over it, so the database genuinely holds both
     * "Lucknow" and "Lucknow " — and untrimmed they aggregate into two pins
     * sitting on top of each other, each claiming to be the whole city. The
     * live data had exactly that.
     */
    const raw = typeof loc.city === 'string' ? loc.city.trim() : '';
    const city = raw && raw !== '—' ? raw : 'Unknown';
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city).push(loc);
  }

  return [...byCity.entries()].map(([city, members]) => {
    const lng = members.reduce((s, m) => s + m.coords.lng, 0) / members.length;
    const lat = members.reduce((s, m) => s + m.coords.lat, 0) / members.length;

    const breakdown = members.reduce((acc, m) => {
      acc[m.status] = (acc[m.status] || 0) + 1;
      return acc;
    }, {});

    const status = STATUS_PRIORITY.find((s) => breakdown[s]) || 'lead';

    return {
      id: `city:${city}`,
      city,
      region: members.find((m) => m.region)?.region ?? cityRegion(city),
      coords: { lng, lat },
      displayCoords: { lng, lat },
      count: members.length,
      status,
      breakdown,
      members,
    };
  }).sort((a, b) => b.count - a.count);
}

/**
 * The four headline numbers on the national view.
 *
 * AI suggestions are excluded from every count: they are places we are NOT,
 * and folding them into a total labelled "network" would inflate it with
 * cities that have nothing in them.
 *
 * @param {Array<FranchiseLocation>} locations
 */
export function networkSummary(locations = []) {
  const real = locations.filter((l) => l.kind !== 'suggestion');
  return {
    open: real.filter((l) => l.status === 'open').length,
    inProgress: real.filter((l) => l.status === 'lead' && l.kind === 'project').length,
    leads: real.filter((l) => l.status === 'lead' && l.kind === 'property').length,
    delayed: real.filter((l) => l.status === 'delayed').length,
    cities: new Set(real.map((l) => l.city).filter((c) => c && c !== '—')).size,
  };
}

/**
 * Everything above, in order: projects, then leads that are not already a
 * project's chosen site, then (optionally) AI suggestions, then de-overlapped.
 *
 * `extra` is for locations that come from neither collection — the sample
 * franchise leads and anything added through the Add Lead form. They join
 * before de-overlapping, so a new lead dropped on a city that already has a
 * project fans out with it rather than hiding underneath it.
 *
 * @param {{projects: Array<object>, properties: Array<object>,
 *          includeAi: boolean, extra: Array<FranchiseLocation>}} input
 * @returns {Array<FranchiseLocation>}
 */
export function buildLocations({
  projects = [], properties = [], includeAi = false, extra = [],
}) {
  const projectLocations = projects
    .map((p) => projectToLocation(p, properties))
    .filter(Boolean);

  // A property that is already positioning a project must not also appear as
  // its own lead — that is one site drawn twice.
  const claimed = new Set(
    projectLocations
      .filter((l) => l.coordsSource === 'gps')
      .map((l) => `${l.coords.lng},${l.coords.lat}`),
  );

  const propertyLocations = properties
    .map(propertyToLocation)
    .filter(Boolean)
    // Not dropped — flagged. The default view hides these (one site drawn
    // twice), but an explicit project/property filter means "show me the
    // captured list", where the chosen site absolutely belongs.
    .map((l) => (claimed.has(`${l.coords.lng},${l.coords.lat}`)
      ? { ...l, claimedByProject: true }
      : l));

  const real = [...projectLocations, ...propertyLocations, ...extra];
  const all = includeAi ? [...real, ...suggestionLocations(real)] : real;
  return spreadOverlaps(all);
}
