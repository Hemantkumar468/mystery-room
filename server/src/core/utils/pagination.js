/**
 * Hard ceiling on a page size. Dashboards that aggregate over a whole
 * project's task list (Phase 8's readiness checklist, Phase 9's go-live
 * checklist, Phase 10's department scorecards) legitimately need the entire
 * set in one request — a lower cap silently truncated them, so every figure
 * derived from the list under-reported without saying so. 1000 comfortably
 * covers a single project while still bounding the response.
 */
const MAX_PAGE_SIZE = 1000;

/**
 * Normalize pagination/sort query params and build a consistent meta block.
 * `meta.total` is always the unpaginated count, so a caller can detect that it
 * was capped rather than assuming it received everything.
 */
export function getPagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/** Turn `?sort=-createdAt,name` into a Mongoose sort object. */
export function parseSort(sort, fallback = { createdAt: -1 }) {
  if (!sort || typeof sort !== 'string') return fallback;
  const out = {};
  for (const raw of sort.split(',')) {
    const field = raw.trim();
    if (!field) continue;
    if (field.startsWith('-')) out[field.slice(1)] = -1;
    else out[field] = 1;
  }
  return Object.keys(out).length ? out : fallback;
}

export function buildMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  };
}

export default { getPagination, parseSort, buildMeta };
