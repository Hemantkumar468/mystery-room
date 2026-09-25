import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePropertyQueue } from '../../app/api/propertyCaptureApi.js';

/**
 * One hook holding everything the server needs to answer a page of the queue:
 * the filters, the sort, the page and the page size.
 *
 * WHY IT LIVES HERE AND NOT IN EACH STEP. All four steps ask the same question
 * with one word changed (`stage`), and four copies of this state is four
 * chances for one of them to forget to reset the page when a filter changes —
 * which strands somebody on page 7 of a result that now has two pages and
 * shows them an empty table.
 *
 * THE SEARCH IS DEBOUNCED. Every keystroke is a request otherwise, and typing
 * "Connaught" is nine of them racing each other to render. 300ms is long
 * enough to swallow a burst of typing and short enough not to feel laggy.
 */
export function usePropertyQuery(stage, {
  defaultSort = 'createdAt', defaultDir = 'desc', includeRejected = false,
} = {}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('');
  /* Where a property stands. Sent to the server rather than filtered here: a
     status filter applied in the browser can only see the 25 rows already
     fetched, so it would find nothing on page 2 while the footer still claimed
     54. See STATUS_LADDER in propertyCapture.service.js. */
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState({ key: defaultSort, dir: defaultDir });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  /* NOT STATE, AND NOT A TICKBOX. Rejected properties are out of every step
     of WORK — blending them into a queue of things still to do made each step
     lie about how much was left, which is why the old toolbar tickbox went.
     Step 1 is not a step of work, though: it is the register, it is called
     All Properties, and a property we said no to is still a property we
     looked at. So the caller declares it once, at the page, and Step 1 is the
     only page that does. The Rejected tab is unchanged — it asks for
     `stage: 'rejected'` and shows the reason and who gave it. */

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /* Any change to WHAT is being asked for returns to page 1. Page numbers are
     positions in a result set; keep one across a filter change and it points
     into a different set. */
  useEffect(() => { setPage(1); }, [debounced, city, source, status, stage, limit]);

  const params = useMemo(() => ({
    ...(stage ? { stage } : {}),
    /* Sent only when true. The server coerces this with `z.coerce.boolean()`,
       and Boolean('false') is true — so a literal `false` on the query string
       would turn the flag ON for every step. */
    ...(includeRejected ? { includeRejected: true } : {}),
    ...(source ? { source } : {}),
    ...(city ? { city } : {}),
    ...(status ? { status } : {}),
    ...(debounced ? { search: debounced } : {}),
    sort: sort.key,
    dir: sort.dir,
    page,
    limit,
  }), [stage, source, city, status, debounced, sort, page, limit, includeRejected]);

  const query = usePropertyQueue(params);
  /* The axios baseQuery already unwraps the envelope, so `data` IS the payload;
     the `data.data` fallback keeps this working if that ever changes. */
  const payload = query.data?.rows ? query.data : (query.data?.data ?? {});

  /**
   * Third click clears the sort rather than cycling back to ascending — "put
   * it back how it was" is a thing people want and otherwise cannot get.
   */
  const toggleSort = useCallback((key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: defaultSort, dir: defaultDir };
    });
    setPage(1);
  }, [defaultSort, defaultDir]);

  const active = [debounced, city, source, status].filter(Boolean).length;

  return {
    rows: payload.rows || [],
    counts: payload.counts || {},
    cities: payload.cities || [],
    /* Only the statuses actually present, built from the whole queue - see the
       service. Offering "Rejected" when nothing is rejected sends people
       looking for rows that do not exist. */
    statuses: payload.statuses || [],
    page: payload.page || page,
    limit: payload.limit || limit,
    total: payload.total || 0,
    totalPages: payload.totalPages || 1,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,

    search, setSearch,
    city, setCity,
    source, setSource,
    status, setStatus,
    /* `setSort` alongside `toggleSort`: the column headers cycle a sort, the
       Sort dropdown sets one outright, and they are the same state. */
    sort, setSort, toggleSort,
    setPage, setLimit,
    active,
    clear: () => {
      setSearch(''); setCity(''); setSource(''); setStatus('');
      setSort({ key: defaultSort, dir: defaultDir });
    },
  };
}

export default usePropertyQuery;
