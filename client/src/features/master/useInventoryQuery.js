import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInventory } from '../../app/api/inventoryApi.js';

/**
 * Everything the server needs to answer one page of the inventory master: the
 * filters, the sort, the page and the page size.
 *
 * ONE HOOK rather than a dozen `useState`s in the page, for the reason
 * usePropertyQuery gives: the rule that any change to WHAT is being asked for
 * returns to page 1 has to hold for every filter, and a page that adds a
 * seventh filter next month will forget it. Keep a page number across a filter
 * change and it points into a different result set — the visible symptom is an
 * empty table on page 7 of a two-page result.
 *
 * THE SEARCH IS DEBOUNCED. Otherwise every keystroke is a request and typing
 * "masking tape" is twelve of them racing each other to render. 300ms swallows
 * a burst of typing without feeling laggy.
 */
export function useInventoryQuery() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState('');
  const [unit, setUnit] = useState('');
  const [vendor, setVendor] = useState('');
  const [uncategorised, setUncategorised] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, category, visibility, unit, vendor, uncategorised, includeArchived, limit, sort]);

  const params = useMemo(() => ({
    ...(debounced ? { search: debounced } : {}),
    ...(category ? { category } : {}),
    ...(visibility ? { visibility } : {}),
    ...(unit ? { unit } : {}),
    ...(vendor ? { vendor } : {}),
    ...(uncategorised ? { uncategorised: true } : {}),
    ...(includeArchived ? { includeArchived: true } : {}),
    sort: sort.key,
    dir: sort.dir,
    page,
    limit,
  }), [debounced, category, visibility, unit, vendor, uncategorised, includeArchived, sort, page, limit]);

  /**
   * The same question, minus the paging — what "export what I am looking at"
   * actually means. Derived from `params` rather than rebuilt beside it, so a
   * filter added later cannot end up in the table and not in the export.
   */
  const exportParams = useMemo(() => {
    const { page: _p, limit: _l, ...rest } = params;
    return rest;
  }, [params]);

  const query = useInventory(params);
  /* The axios baseQuery already unwraps the envelope, so `data` IS the
     payload; the `data.data` fallback keeps this working if that changes. */
  const payload = query.data?.rows ? query.data : (query.data?.data ?? {});

  /** Ascending, descending, then back to the default — "put it back how it was". */
  const toggleSort = useCallback((key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: 'name', dir: 'asc' };
    });
  }, []);

  /* `uncategorised` and a chosen category ask contradictory things of the same
     field, so picking one clears the other rather than returning nothing and
     looking broken. */
  const chooseCategory = useCallback((next) => {
    setCategory(next);
    if (next) setUncategorised(false);
  }, []);

  const toggleUncategorised = useCallback(() => {
    setUncategorised((prev) => {
      if (!prev) setCategory('');
      return !prev;
    });
  }, []);

  const activeFilters = [debounced, category, visibility, unit, vendor].filter(Boolean).length
    + (uncategorised ? 1 : 0) + (includeArchived ? 1 : 0);

  const clearFilters = useCallback(() => {
    setSearch('');
    setCategory('');
    setVisibility('');
    setUnit('');
    setVendor('');
    setUncategorised(false);
    setIncludeArchived(false);
  }, []);

  return {
    /* state + setters */
    search, setSearch,
    category, setCategory: chooseCategory,
    visibility, setVisibility,
    unit, setUnit,
    vendor, setVendor,
    uncategorised, toggleUncategorised,
    includeArchived, setIncludeArchived,
    sort, toggleSort,
    page, setPage,
    limit, setLimit,
    activeFilters, clearFilters, exportParams,

    /* the answer */
    rows: payload.rows || [],
    counts: payload.counts || {},
    total: payload.total || 0,
    totalPages: payload.totalPages || 1,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}

export default useInventoryQuery;
