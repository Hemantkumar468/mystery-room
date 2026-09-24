// A stray `undefined`/`null` reaching a template literal (e.g. a URL built
// with `${maybeMissingId}`) stringifies to the literal text "undefined" /
// "null" — a plain `!!id` truthiness check doesn't catch that. Route params
// and ids threaded through props should be checked with this instead.
//
// Lives here (not lib/queries.js) because it's a generic string check with
// no React Query dependency — every RTK Query endpoint file needs it too,
// and importing it from queries.js would leave a fake dependency on a file
// that's being deleted in Final Cleanup.
export const isValidId = (v) => typeof v === 'string' && v.length > 0 && v !== 'undefined' && v !== 'null';

export default isValidId;
