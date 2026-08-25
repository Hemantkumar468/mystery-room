import { logger } from '../../../config/logger.js';

/**
 * Place-name → coordinates, via OpenStreetMap's Nominatim.
 *
 * WHY THIS EXISTS. Ask-the-Map findings name real localities — "Civil Lines,
 * Sagar", "Tili Road" — but the model reliably refuses to guess their
 * coordinates (correctly: it would be inventing digits). A finding without
 * coordinates cannot be a pin or an area ring, and the map is the point. So
 * the NAME comes from grounded research and the POSITION comes from a real
 * geocoder — each source doing the thing it is actually good at.
 *
 * Nominatim usage policy: identify the app, at most one request per second.
 * Both are honoured here — a named User-Agent and a global 1.1 s spacing —
 * and results are cached in-process because the same localities recur
 * constantly ("MP Nagar" is asked about weekly, not once).
 */

const cache = new Map(); // query -> { lat, lng } | null
const MAX_CACHE = 500;

let lastCallAt = 0;
const SPACING_MS = 1100;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function nominatim(query) {
  // Global spacing across all callers — the policy is per-service, not per-request.
  const wait = lastCallAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MysteryRooms-PMS/1.0 (network map)' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const hit = rows?.[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Best-effort geocode of "name (, city), India". Never throws — a finding
 * that cannot be placed simply stays a list row, exactly as before.
 */
export async function geocodePlace(name, city) {
  const base = String(name || '').trim();
  if (!base) return null;

  // "Civil Lines / Station Road" — try the full phrase, then the first part.
  const variants = [...new Set([base, base.split('/')[0].trim()])].filter(Boolean);
  const suffix = [city, 'India'].filter(Boolean).join(', ');

  for (const v of variants) {
    const query = suffix ? `${v}, ${suffix}` : v;
    if (cache.has(query)) {
      const hit = cache.get(query);
      if (hit) return hit;
      continue; // cached miss — try the next variant
    }
    try {
      const hit = await nominatim(query);
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(query, hit);
      if (hit) return hit;
    } catch (err) {
      logger.debug(`geocode failed for "${query}": ${err.message}`);
      return null; // network trouble — don't hammer through the other variants
    }
  }
  return null;
}

/**
 * Fill coordinates into findings that name a place but could not place it.
 * Sequential on purpose (the 1 req/s policy), capped so one answer can never
 * spend more than a few seconds geocoding.
 */
export async function placeFindings(findings, { max = 6 } = {}) {
  let done = 0;
  for (const f of findings) {
    if (done >= max) break;
    if (Number.isFinite(f.lat) && Number.isFinite(f.lng)) continue;
    const hit = await geocodePlace(f.name, f.city);
    done += 1;
    if (hit) {
      f.lat = hit.lat;
      f.lng = hit.lng;
      f.approx = true; // a geocoded locality centre, not a surveyed address
    }
  }
  return findings;
}

export default geocodePlace;
