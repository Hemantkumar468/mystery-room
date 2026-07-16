/**
 * Pure data helpers for seedEnterpriseDemo.js — no DB calls in this file.
 * Everything here is deliberately generic and driven off a template field's
 * *type* (plus a few key-name heuristics), rather than hardcoding every
 * field of every stage by hand: the seed script reads `masterDataSchema`
 * straight off the live default Template, so this stays correct even if the
 * template gains/loses fields later without any change here.
 */

// ---------------- Small randomness primitives ----------------

export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pick = (arr) => arr[rand(0, arr.length - 1)];
export const chance = (pct) => Math.random() * 100 < pct;

/** N distinct random items from arr (N capped to arr.length). */
export function pickN(arr, n) {
  const pool = [...arr];
  const out = [];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i += 1) {
    out.push(pool.splice(rand(0, pool.length - 1), 1)[0]);
  }
  return out;
}

/** Random date between two Dates (inclusive-ish). */
export function randomDateBetween(from, to) {
  const f = new Date(from).getTime();
  const t = new Date(to).getTime();
  if (t <= f) return new Date(f);
  return new Date(f + Math.random() * (t - f));
}

// ---------------- Name / contact pools ----------------

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra', 'Pari', 'Anika', 'Riya', 'Navya',
  'Rahul', 'Amit', 'Vikram', 'Suresh', 'Rajesh', 'Manoj', 'Sanjay', 'Deepak', 'Ashok', 'Ramesh',
  'Priya', 'Neha', 'Pooja', 'Sunita', 'Kavita', 'Meera', 'Anjali', 'Ritu', 'Shreya', 'Nisha',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Malhotra', 'Kapoor', 'Nair', 'Iyer', 'Reddy', 'Rao', 'Menon',
  'Agarwal', 'Bhatia', 'Chawla', 'Desai', 'Joshi', 'Mehta', 'Pillai', 'Chauhan', 'Yadav', 'Singh',
  'Khanna', 'Saxena', 'Bose', 'Chatterjee', 'Pandey', 'Trivedi', 'Ali', 'Sheikh', 'Khan', 'Das',
];
const FIRM_WORDS = ['Realty', 'Estates', 'Properties', 'Spaces', 'Ventures', 'Assets', 'Land', 'Group'];
const FIRM_PREFIX = ['Prime', 'Metro', 'Urban', 'Skyline', 'Golden', 'Landmark', 'Elite', 'Horizon', 'Summit', 'Apex'];

export function randomPersonName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

export function randomFirmName() {
  return `${pick(FIRM_PREFIX)} ${pick(FIRM_WORDS)}`;
}

export function randomPhone() {
  return `9${rand(1, 9)}${String(rand(0, 9999999)).padStart(8, '0')}`;
}

export function randomEmailFor(name, domain = 'example.com') {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}${rand(1, 99)}@${domain}`;
}

// ---------------- Cities ----------------

/** Approximate real bounding boxes so `location` fields land somewhere plausible on the map, plus a small locality-name pool per city. */
export const CITY_INFO = {
  Delhi: { bbox: [28.45, 28.75, 76.95, 77.35], localities: ['Connaught Place', 'Karol Bagh', 'Saket', 'Rajouri Garden', 'Dwarka', 'Lajpat Nagar', 'Rohini', 'Janakpuri'] },
  Mumbai: { bbox: [18.95, 19.25, 72.80, 72.98], localities: ['Andheri West', 'Bandra West', 'Powai', 'Malad', 'Borivali', 'Ghatkopar', 'Chembur', 'Thane West'] },
  Lucknow: { bbox: [26.75, 26.95, 80.85, 81.05], localities: ['Hazratganj', 'Gomti Nagar', 'Alambagh', 'Indira Nagar', 'Aliganj', 'Chinhat'] },
  Noida: { bbox: [28.45, 28.65, 77.30, 77.45], localities: ['Sector 18', 'Sector 62', 'Sector 50', 'Sector 137', 'Sector 76'] },
  Indore: { bbox: [22.65, 22.80, 75.80, 75.95], localities: ['Vijay Nagar', 'Rajwada', 'Palasia', 'Bhawarkuan', 'Sudama Nagar'] },
  Pune: { bbox: [18.45, 18.65, 73.75, 73.95], localities: ['Koregaon Park', 'Viman Nagar', 'Baner', 'Hinjewadi', 'Kothrud', 'Aundh'] },
  Jaipur: { bbox: [26.80, 26.95, 75.75, 75.90], localities: ['C-Scheme', 'Malviya Nagar', 'Vaishali Nagar', 'Mansarovar', 'Tonk Road'] },
  Ahmedabad: { bbox: [22.98, 23.10, 72.50, 72.65], localities: ['Navrangpura', 'Satellite', 'Vastrapur', 'Bopal', 'Maninagar'] },
  Hyderabad: { bbox: [17.35, 17.50, 78.35, 78.55], localities: ['Banjara Hills', 'Jubilee Hills', 'Gachibowli', 'Madhapur', 'Kukatpally'] },
  Bangalore: { bbox: [12.90, 13.05, 77.55, 77.70], localities: ['Indiranagar', 'Koramangala', 'Whitefield', 'HSR Layout', 'Jayanagar', 'Marathahalli'] },
  Kolkata: { bbox: [22.50, 22.62, 88.30, 88.42], localities: ['Park Street', 'Salt Lake', 'Ballygunge', 'Gariahat', 'New Town'] },
  Chennai: { bbox: [13.00, 13.15, 80.20, 80.30], localities: ['T. Nagar', 'Adyar', 'Anna Nagar', 'Velachery', 'OMR'] },
};

export const CITIES = Object.keys(CITY_INFO);

export function randomLocality(city) {
  return pick(CITY_INFO[city]?.localities || ['Central']);
}

export function randomLatLng(city) {
  const box = CITY_INFO[city]?.bbox || [20, 21, 78, 79];
  const [latMin, latMax, lngMin, lngMax] = box;
  return {
    lat: Number((latMin + Math.random() * (latMax - latMin)).toFixed(6)),
    lng: Number((lngMin + Math.random() * (lngMax - lngMin)).toFixed(6)),
  };
}

// ---------------- Attachments (fake metadata — no real uploads, see plan) ----------------

const DOC_NAMES = ['Site_Survey_Report', 'Ownership_Proof', 'Floor_Plan', 'NOC_Certificate', 'Lease_Draft', 'Inspection_Report', 'Vendor_Quote', 'Compliance_Certificate'];

/** One fake attachment entry, matching the shape record.attachments / a FILE field's value array both read (url/publicId/originalName/mimetype/resourceType). Images point at a real, license-free placeholder service; documents/videos/audio carry no real backing URL. */
export function fakeAttachment(fieldKey, kind = 'image') {
  const id = `${fieldKey}-${Date.now()}-${rand(1000, 9999)}`;
  if (kind === 'image') {
    return {
      fieldKey,
      name: `Photo_${rand(1, 999)}.jpg`,
      originalName: `Photo_${rand(1, 999)}.jpg`,
      url: `https://picsum.photos/seed/${id}/480/320`,
      publicId: id,
      mimetype: 'image/jpeg',
      resourceType: 'image',
      kind: 'image',
    };
  }
  if (kind === 'video') {
    return {
      fieldKey,
      name: 'Site_Walkthrough.mp4',
      originalName: 'Site_Walkthrough.mp4',
      url: null,
      publicId: id,
      mimetype: 'video/mp4',
      resourceType: 'video',
      kind: 'video',
    };
  }
  if (kind === 'audio') {
    return {
      fieldKey,
      name: 'Doer_Note.mp3',
      originalName: 'Doer_Note.mp3',
      url: null,
      publicId: id,
      mimetype: 'audio/mpeg',
      resourceType: 'raw',
      kind: 'audio',
    };
  }
  const doc = pick(DOC_NAMES);
  return {
    fieldKey,
    name: `${doc}.pdf`,
    originalName: `${doc}.pdf`,
    url: null,
    publicId: id,
    mimetype: 'application/pdf',
    resourceType: 'raw',
    kind: 'raw',
  };
}

// ---------------- Themed remark phrases (per rough topic, for text/textarea fields) ----------------

const REMARK_PHRASES = [
  'Looks good, proceeding as planned.',
  'Minor clarifications needed from the vendor before final sign-off.',
  'On track, no blockers at this time.',
  'Awaiting one more round of documentation.',
  'Escalated to management for faster turnaround.',
  'Site visit confirmed the details captured here.',
  'Cross-checked with the landlord/vendor — all good.',
  'Slight delay expected, tracking recovery plan.',
  'Reviewed and approved after internal discussion.',
  'Follow-up scheduled next week to close remaining items.',
];

export function randomRemark() {
  return pick(REMARK_PHRASES);
}

// ---------------- Generic per-field-type value generator ----------------

/**
 * Best-effort plausible value for one masterDataSchema field, driven by
 * `field.type` plus a few `field.key`/`field.label` heuristics for realism
 * (currency-ish keys get rupee-scale numbers, "pct"/"percent" keys get
 * 0-100, "days" keys get a small day count, "date" fields land within the
 * given `dateWindow`). Never hardcodes a specific stage's field list.
 */
export function valueForField(field, { dateWindow, cityHint } = {}) {
  const key = (field.key || '').toLowerCase();
  const [from, to] = dateWindow || [new Date(Date.now() - 60 * 86400000), new Date(Date.now() + 60 * 86400000)];

  switch (field.type) {
    case 'boolean':
      return chance(85);
    case 'number': {
      if (key.includes('pct') || key.includes('percent')) return rand(60, 100);
      if (key.includes('day')) return rand(5, 45);
      if (key.includes('headcount') || key.includes('staff')) return rand(4, 25);
      if (key.includes('rating')) return rand(3, 5);
      if (key.includes('score') || key.includes('footfall')) return rand(5, 10);
      if (key.includes('roi')) return rand(12, 32);
      if (key.includes('capacity')) return rand(20, 120);
      if (key.includes('area') || key.includes('frontage')) return rand(800, 6000);
      return rand(1, 100);
    }
    case 'currency': {
      if (key.includes('deposit') || key.includes('advance')) return rand(200000, 3000000);
      if (key.includes('rent') || key.includes('lease_amount')) return rand(80000, 900000);
      if (key.includes('budget') || key.includes('investment') || key.includes('cost') || key.includes('capex')) return rand(1500000, 15000000);
      if (key.includes('opex') || key.includes('revenue')) return rand(100000, 2000000);
      return rand(50000, 2000000);
    }
    case 'date':
      return randomDateBetween(from, to);
    case 'select':
      return field.options?.length ? pick(field.options) : '';
    case 'multiselect':
      return field.options?.length ? pickN(field.options, rand(1, Math.min(3, field.options.length))) : [];
    case 'location':
      return { ...randomLatLng(cityHint), capturedAt: new Date().toISOString() };
    case 'user':
      return randomPersonName();
    case 'file':
      return undefined; // handled separately by the caller (needs attachment fan-out)
    case 'textarea':
      if (key.includes('remark') || key.includes('note')) return randomRemark();
      return randomRemark();
    case 'text':
    default: {
      if (key.includes('name') && key.includes('owner')) return randomPersonName();
      if (key.includes('name') && key.includes('broker')) return randomFirmName();
      if (key.includes('name') && (key.includes('vendor') || key.includes('contractor'))) return randomFirmName();
      if (key.includes('name') && (key.includes('manager') || key.includes('head') || key.includes('advocate') || key.includes('approver') || key.includes('signed'))) return randomPersonName();
      if (key.includes('phone')) return randomPhone();
      if (key.includes('email')) return randomEmailFor(randomPersonName());
      if (key.includes('number') || key.includes('_no') || key.endsWith('no')) return `${key.slice(0, 3).toUpperCase()}-${rand(1000, 9999)}`;
      if (key.includes('type') || key.includes('approval_type')) return pick(['Standard', 'Fast-Track', 'Escalated']);
      if (key === 'city') return cityHint || pick(CITIES);
      return randomFirmName();
    }
  }
}

/**
 * Fill an entire masterDataSchema: required fields always get a value,
 * optional fields ~75% of the time (believable gaps, not every record
 * maximally complete). FILE fields fan out into 0-3 fake attachments both
 * in the returned `values[key]` array and the parallel `attachments` list
 * (matching Record.attachments' `fieldKey`-tagged shape).
 */
export function fillSchemaValues(schema, ctx = {}) {
  const values = {};
  const attachments = [];
  for (const field of schema || []) {
    if (field.showIf) {
      const gate = values[field.showIf.field];
      if (!field.showIf.in.includes(gate)) continue; // conditional field not applicable — skip
    }
    const include = field.required || chance(75);
    if (!include) continue;

    if (field.type === 'file') {
      if (!field.required && !chance(60)) continue; // optional media sometimes just isn't attached
      const kind = field.recordAudio ? 'audio' : field.accept?.includes('mp4') ? 'video' : field.accept?.includes('.jpg') || field.accept?.includes('.png') ? 'image' : 'document';
      const n = field.multiple ? rand(1, 3) : 1;
      const files = Array.from({ length: n }, () => fakeAttachment(field.key, kind));
      values[field.key] = files;
      attachments.push(...files);
      continue;
    }

    const v = valueForField(field, ctx);
    if (v !== undefined) values[field.key] = v;
  }
  return { values, attachments };
}
