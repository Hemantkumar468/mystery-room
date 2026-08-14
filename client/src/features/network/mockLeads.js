import { cityCoord, cityRegion } from './cityCoords.js';

/**
 * Franchise leads, as sample data.
 *
 * WHY THIS EXISTS ALONGSIDE REAL RECORDS. The PMS already carries real
 * projects and real on-site GPS captures, and those are on the map. What it
 * has no concept of is a *franchise enquiry* — someone who has approached us
 * about opening in a city where no project exists yet. There is no table for
 * them, so until there is, they are this file.
 *
 * These are clearly sample records and must not be mistaken for the real ones:
 * every id is prefixed `mock:`, and `isMock` is carried through to the details
 * panel, which says so on screen.
 *
 * SWAPPING IN THE REAL API. `useFranchiseData` merges three sources — real
 * projects, real properties, and these. Replace this import with an RTK Query
 * endpoint (`baseApi.injectEndpoints`, a `Lead` tag, the same shape below) and
 * nothing else in the feature has to change.
 *
 * @typedef {import('./franchiseData.js').FranchiseLocation} FranchiseLocation
 */

/** Raw sample rows — city names resolve to coordinates below. */
const ROWS = [
  {
    id: 'FR-PNE-0147',
    name: 'Rohan Kulkarni',
    city: 'Pune',
    locality: 'Baner',
    stage: 'loi',
    status: 'lead',
    site: '4,800 sq ft · Baner High Street',
    investment: '₹1.4 – 1.8 Cr (self-funded)',
    nextStep: 'Site evaluation · due 15 Aug',
    owner: 'P. Nair (Franchise team)',
    contact: '+91 98xxx 21x40',
  },
  {
    id: 'FR-JAI-0132',
    name: 'Meera Agarwal',
    city: 'Jaipur',
    locality: 'C-Scheme',
    stage: 'property',
    status: 'lead',
    site: '3,600 sq ft · C-Scheme',
    investment: '₹1.1 – 1.4 Cr',
    nextStep: 'Shortlist two more sites',
    owner: 'A. Deshpande (Franchise team)',
    contact: '+91 99xxx 55x02',
  },
  {
    id: 'FR-KOL-0119',
    name: 'Arindam Bose',
    city: 'Kolkata',
    locality: 'Salt Lake',
    stage: 'enquiry',
    status: 'lead',
    site: 'Not yet identified',
    investment: '₹1.0 Cr (indicative)',
    nextStep: 'Qualification call',
    owner: 'P. Nair (Franchise team)',
    contact: '+91 98xxx 77x31',
  },
  {
    id: 'FR-HYD-0104',
    name: 'Sai Krishna Reddy',
    city: 'Hyderabad',
    locality: 'Gachibowli',
    stage: 'fitout',
    status: 'delayed',
    site: '5,200 sq ft · Gachibowli',
    investment: '₹1.9 Cr',
    nextStep: 'Civil works 9 days behind plan',
    owner: 'S. Iyer (Projects)',
    contact: '+91 97xxx 10x88',
  },
  {
    id: 'FR-CHD-0098',
    name: 'Gurpreet Sandhu',
    city: 'Chandigarh',
    locality: 'Sector 17',
    stage: 'live',
    status: 'open',
    site: '4,100 sq ft · Sector 17',
    investment: '₹1.5 Cr',
    nextStep: 'Trading since 12 Jun',
    owner: 'Operations',
    contact: '+91 98xxx 44x10',
  },
  {
    id: 'FR-AMD-0091',
    name: 'Nikhil Shah',
    city: 'Ahmedabad',
    locality: 'Prahlad Nagar',
    stage: 'loi',
    status: 'lead',
    site: '4,400 sq ft · Prahlad Nagar',
    investment: '₹1.3 Cr',
    nextStep: 'LOI countersignature pending',
    owner: 'A. Deshpande (Franchise team)',
    contact: '+91 99xxx 08x76',
  },
];

/**
 * Sample leads as map locations.
 *
 * A lead with no coordinates for its city is DROPPED rather than placed
 * somewhere plausible — a pin in the wrong place is worse than an absent one,
 * because it looks like knowledge.
 *
 * @returns {FranchiseLocation[]}
 */
export function mockLeadLocations() {
  return ROWS.map((row) => {
    const coord = cityCoord(row.city);
    if (!coord) return null;

    // Nudge off the exact city centre so a sample lead never sits precisely on
    // top of a real project in the same city. Deterministic, derived from the
    // id, so it does not move between renders.
    const jitter = ([...row.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 40) / 1000;

    return {
      id: `mock:${row.id}`,
      kind: 'lead',
      isMock: true,
      name: row.name,
      city: row.city,
      region: cityRegion(row.city),
      stage: row.stage,
      status: row.status,
      score: null,
      coords: { lng: coord.lng + jitter, lat: coord.lat - jitter },
      displayCoords: { lng: coord.lng + jitter, lat: coord.lat - jitter },
      coordsSource: 'city',
      coordsAdjustedForDisplay: false,
      details: [
        { label: 'Franchise lead', value: `${row.city} · ${row.locality}` },
        { label: 'Proposed site', value: row.site },
        { label: 'Investment', value: row.investment },
        { label: 'Next step', value: row.nextStep },
        { label: 'Owner', value: row.owner },
        { label: 'Contact', value: row.contact },
      ],
      pmsUrl: `/network-map?lead=${row.id}`,
    };
  }).filter(Boolean);
}

export default mockLeadLocations;
