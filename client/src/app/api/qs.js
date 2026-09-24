/**
 * Query-string builder shared by every domain endpoint file.
 *
 * Ported verbatim from the (now-removed) `lib/queries.js`, including the
 * string-literal `'undefined'`/`'null'` filtering — several call sites pass
 * values straight from `useParams()`/optional chaining, which can stringify
 * to those before a param is ever set.
 */
export const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== '' && v !== null && v !== 'undefined' && v !== 'null',
    ),
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

export default qs;
