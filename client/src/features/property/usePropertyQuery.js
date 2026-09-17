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
export function usePropertyQuery(stage, { defaultSort = 'createdAt', defaultDir = 'desc' } = {}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState({ key: defaultSort, dir: defaultDir });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  /* Rejected properties are out of the pipeline by default — see the service. */
  const [includeRejected, setIncludeRejected] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /* Any change to WHAT is being asked for returns to page 1. Page numbers are
     positions in a result set; keep one across a filter change and it points
     into a different set. */
  useEffect(() => { setPage(1); }, [debounced, city, source, stage, limit, includeRejected]);

  const params = useMemo(() => ({
    ...(stage ? { stage } : {}),
    ...(source ? { source } : {}),
    ...(city ? { city } : {}),
    ...(debounced ? { search: debounced } : {}),
    sort: sort.key,
    dir: sort.dir,
    page,
    limit,
    ...(includeRejected ? { includeRejected: true } : {}),
  }), [stage, source, city, debounced, sort, page, limit, includeRejected]);

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

  const active = [debounced, city, source].filter(Boolean).length;

  return {
    rows: payload.rows || [],
    counts: payload.counts || {},
    cities: payload.cities || [],
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
    sort, toggleSort,
    setPage, setLimit,
    includeRejected, setIncludeRejected,
    active,
    clear: () => { setSearch(''); setCity(''); setSource(''); },
  };
}

export default usePropertyQuery;
