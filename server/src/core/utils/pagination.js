/**
 * Normalize pagination/sort query params and build a consistent meta block.
 */
export function getPagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
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
