/**
 * Turns a stored property Record into the dossier the prompts consume, plus
 * the fingerprint that drives caching.
 *
 * Records are schema-driven — `values` is free-form and its shape comes from
 * the stage's masterDataSchema — so this reads the well-known Phase-1 keys by
 * name and sweeps anything else it does not recognise into a generic
 * "other captured details" block. A new field added to the template therefore
 * reaches the model automatically, without an edit here.
 */

import crypto from 'node:crypto';
import { PROMPT_VERSION, RUBRIC_VERSION } from '../ai.constants.js';

/** Phase-1 keys this module understands explicitly (see storeLaunchTemplate.js). */
const KNOWN_KEYS = new Set([
  'property_name', 'locality', 'city', 'carpet_area', 'frontage_ft', 'floor',
  'live_location', 'commercial_type', 'monthly_rent', 'deposit', 'available_from',
  'lease_amount', 'lease_duration', 'owner_name', 'owner_phone', 'broker_name',
  'broker_phone', 'documents', 'audio', 'notes',
]);

const clean = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};

const inr = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num) || num === 0) return '';
  return `₹${num.toLocaleString('en-IN')}`;
};

/**
 * Live Location is a union: captured GPS `{ lat, lng }` or a pasted
 * `{ mapUrl }`. Only real coordinates are authoritative enough to tell the
 * model to trust over the typed address.
 */
function readLocation(loc) {
  if (!loc || typeof loc !== 'object') return { gps: '', mapUrl: '', lat: null, lng: null };
  if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    const accuracy = Number.isFinite(loc.accuracy) ? ` (±${Math.round(loc.accuracy)}m accuracy)` : '';
    return {
      gps: `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}${accuracy}`,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`,
      lat: loc.lat,
      lng: loc.lng,
    };
  }
  return { gps: '', mapUrl: clean(loc.mapUrl), lat: null, lng: null };
}

/** Commercial terms differ by type; render only the fields that apply. */
function readCommercials(values) {
  const type = clean(values.commercial_type);
  const parts = [];

  if (type === 'Lease') {
    const amount = inr(values.lease_amount);
    if (amount) parts.push(`Lease amount ${amount}`);
    if (values.lease_duration) parts.push(`Duration ${values.lease_duration} months`);
  } else if (type === 'Rent') {
    const rent = inr(values.monthly_rent);
    if (rent) parts.push(`Monthly rent ${rent}`);
  }

  const deposit = inr(values.deposit);
  if (deposit) parts.push(`Deposit ${deposit}`);

  // Rent per sq.ft is the number the model actually benchmarks against, and
  // it is far more reliable to compute here than to ask a model to divide.
  const area = Number(values.carpet_area);
  const monthly = Number(values.monthly_rent);
  if (Number.isFinite(area) && area > 0 && Number.isFinite(monthly) && monthly > 0) {
    parts.push(`≈ ₹${(monthly / area).toFixed(1)}/sq.ft/month`);
  }

  if (!parts.length) return type ? `${type} — terms not captured` : '';
  return `${type || 'Terms'}: ${parts.join(', ')}`;
}

/** Counts by media kind — evidence that a real site visit happened. */
function readMedia(record) {
  const values = record.values || {};
  const entries = [
    ...(Array.isArray(values.documents) ? values.documents : []),
    ...(Array.isArray(values.audio) ? values.audio : []),
    ...(Array.isArray(record.attachments) ? record.attachments : []),
  ];
  if (!entries.length) return '';

  const counts = entries.reduce((acc, e) => {
    const mt = e?.mimetype || e?.kind || '';
    const kind = mt.startsWith('image') ? 'photos'
      : mt.startsWith('video') ? 'videos'
        : mt.startsWith('audio') ? 'voice notes'
          : 'documents';
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
}

/** Any template field this module does not know by name, rendered generically. */
function readExtraFields(values, schema = []) {
  const labels = new Map(schema.map((f) => [f.key, f.label || f.key]));
  const lines = [];

  for (const [key, raw] of Object.entries(values)) {
    if (KNOWN_KEYS.has(key)) continue;
    const value = clean(raw);
    if (!value) continue;
    lines.push(`  • ${labels.get(key) || key}: ${value}`);
  }
  return lines.join('\n');
}

const dateStr = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? clean(v) : d.toISOString().slice(0, 10);
};

/**
 * Build the full analysis context for one property record.
 *
 * @param {object} record  A populated Record document (or plain object).
 * @param {object} project The parent Project — supplies the launch context.
 * @param {Array}  schema  The stage's masterDataSchema, for labelling extras.
 */
export function buildPropertyContext(record, project, schema = []) {
  const values = record.values || {};
  const { gps, mapUrl, lat, lng } = readLocation(values.live_location);

  const contacts = [
    clean(values.owner_name) && `Owner ${clean(values.owner_name)}`,
    clean(values.broker_name) && `Broker ${clean(values.broker_name)}`,
  ].filter(Boolean).join(', ');

  const city = clean(values.city) || clean(project?.city);

  return {
    recordId: String(record._id),
    projectId: String(project?._id || record.project),

    propertyName: clean(values.property_name) || clean(record.title),
    locality: clean(values.locality),
    city,
    region: clean(project?.state) || clean(project?.region),
    gps,
    mapUrl,
    lat,
    lng,
    area: clean(values.carpet_area),
    frontage: clean(values.frontage_ft),
    floor: clean(values.floor),
    commercials: readCommercials(values),
    availableFrom: dateStr(values.available_from),
    contacts,
    notes: clean(values.notes),
    mediaSummary: readMedia(record),
    extraFields: readExtraFields(values, schema),

    projectName: clean(project?.name),
    projectCity: clean(project?.city),
    projectStage: clean(project?.stages?.find((s) => s.key === record.stageKey)?.name),
  };
}

/**
 * Fields that would change the answer if they changed. A re-run is only worth
 * spending money on when one of these moves — cosmetic edits (a broker's phone
 * number, a note typo) should reuse the cached report.
 *
 * The prompt and rubric versions are folded in so that editing either
 * automatically invalidates every cached report rather than leaving two
 * scoring generations mixed in one comparison table.
 */
export function fingerprintOf(ctx) {
  const material = [
    ctx.propertyName, ctx.locality, ctx.city, ctx.region,
    // Coordinates rounded to ~11m: GPS jitter between two captures of the same
    // doorway must not invalidate a perfectly good report.
    ctx.lat != null ? ctx.lat.toFixed(4) : '',
    ctx.lng != null ? ctx.lng.toFixed(4) : '',
    ctx.area, ctx.frontage, ctx.floor, ctx.commercials,
    PROMPT_VERSION, RUBRIC_VERSION,
  ].join('|');

  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/**
 * Whether there is enough captured data to analyse at all. Running a costly
 * grounded analysis on a record holding only a property name produces
 * confident-sounding nonsense, so refuse it up front with a message that says
 * exactly what to fill in.
 */
export function validateContext(ctx) {
  const hasPlace = Boolean(ctx.gps || (ctx.locality && ctx.city) || ctx.mapUrl);
  if (!hasPlace) {
    return {
      ok: false,
      reason:
        'This property needs a location before it can be analysed. Add its Locality and City, or capture the Live Location on site.',
    };
  }
  return { ok: true };
}
