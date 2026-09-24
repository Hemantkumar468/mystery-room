import { baseApi } from './baseApi.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * The Inventory Management System — how much of each catalogue item is at each
 * location, and every movement that put it there.
 *
 * THE MASTER AND THE COUNT ARE TWO CACHES, on purpose. `inventoryApi` owns the
 * catalogue ('Inventory'); this owns the stock ('Stock', 'StockMovement',
 * 'ImsLocation'). Correcting an item's name must not refetch every stock page,
 * and issuing six bulbs must not refetch the 1,322-row master. They meet only
 * where they genuinely overlap: a movement invalidates 'Stock' and
 * 'StockMovement' but never 'Inventory', because no count has ever changed a
 * catalogue row.
 *
 * ONE WRITE PATH, mirroring the server. Receiving, issuing and counting are
 * the same POST with a different `type` — see ims.service.js#move for why
 * three endpoints would be three places to get the balance rule wrong.
 */
export const imsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** Locations, each with its own SKU / unit / low counts already summed. */
    getImsLocations: build.query({
      query: (params = {}) => ({ url: '/ims/locations', method: 'GET', params }),
      providesTags: ['ImsLocation'],
    }),
    createImsLocation: build.mutation({
      query: (body) => ({ url: '/ims/locations', method: 'POST', data: body }),
      invalidatesTags: ['ImsLocation', 'Stock'],
    }),
    updateImsLocation: build.mutation({
      query: ({ id, ...body }) => ({ url: `/ims/locations/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: ['ImsLocation', 'Stock'],
    }),
    /** Closes it. Its stock rows and its history stay readable — see the route. */
    closeImsLocation: build.mutation({
      query: (id) => ({ url: `/ims/locations/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ImsLocation', 'Stock'],
    }),

    /** One page of item × location rows, filtered and sorted server-side. */
    getStock: build.query({
      query: (params = {}) => ({ url: '/ims/stock', method: 'GET', params }),
      providesTags: ['Stock'],
    }),
    getImsOverview: build.query({
      query: (params = {}) => ({ url: '/ims/overview', method: 'GET', params }),
      providesTags: ['Stock', 'StockMovement', 'ImsLocation'],
    }),
    getMovements: build.query({
      query: (params = {}) => ({ url: '/ims/movements', method: 'GET', params }),
      providesTags: ['StockMovement'],
    }),
    /** One item's whole story at one location — the drill-down behind a row. */
    getItemHistory: build.query({
      query: ({ itemId, ...params }) => ({ url: `/ims/history/${itemId}`, method: 'GET', params }),
      providesTags: ['StockMovement'],
    }),

    /**
     * Receive, issue or count. `{ location, type, lines: [{ item, qty }] }`.
     * Invalidates the location list too, because its per-location unit and
     * low-stock counts have just moved.
     */
    postMovement: build.mutation({
      query: (body) => ({ url: '/ims/movements', method: 'POST', data: body }),
      invalidatesTags: ['Stock', 'StockMovement', 'ImsLocation'],
    }),
    postTransfer: build.mutation({
      query: (body) => ({ url: '/ims/transfers', method: 'POST', data: body }),
      invalidatesTags: ['Stock', 'StockMovement', 'ImsLocation'],
    }),

    /**
     * The safety level. NOT a movement — it changes what "enough" means, not
     * how much there is, so it invalidates 'Stock' (every row's status is
     * derived from it) but never 'StockMovement'.
     */
    setSafetyStock: build.mutation({
      query: (body) => ({ url: '/ims/safety', method: 'PATCH', data: body }),
      invalidatesTags: ['Stock', 'ImsLocation'],
    }),
    setSafetyStockBulk: build.mutation({
      query: (body) => ({ url: '/ims/safety/bulk', method: 'PATCH', data: body }),
      invalidatesTags: ['Stock', 'ImsLocation'],
    }),

    /** Rebuild cached balances from the ledger — the "this count looks wrong" answer. */
    recountStock: build.mutation({
      query: (body = {}) => ({ url: '/ims/recount', method: 'POST', data: body }),
      invalidatesTags: ['Stock', 'ImsLocation'],
    }),
  }),
});

export const {
  useGetImsLocationsQuery,
  useCreateImsLocationMutation,
  useUpdateImsLocationMutation,
  useCloseImsLocationMutation,
  useGetStockQuery,
  useGetImsOverviewQuery,
  useGetMovementsQuery,
  useGetItemHistoryQuery,
  usePostMovementMutation,
  usePostTransferMutation,
  useSetSafetyStockMutation,
  useSetSafetyStockBulkMutation,
  useRecountStockMutation,
} = imsApi;

export const useImsLocations = (params) => useGetImsLocationsQuery(params);
export const useStock = (params) => useGetStockQuery(params);
export const useImsOverview = (params) => useGetImsOverviewQuery(params);
export const useMovements = (params) => useGetMovementsQuery(params);

export const useCreateImsLocation = () => useCompatMutation(useCreateImsLocationMutation);
export const useUpdateImsLocation = () => useCompatMutation(useUpdateImsLocationMutation);
export const useCloseImsLocation = () => useCompatMutation(useCloseImsLocationMutation);
export const usePostMovement = () => useCompatMutation(usePostMovementMutation);
export const usePostTransfer = () => useCompatMutation(usePostTransferMutation);
export const useSetSafetyStock = () => useCompatMutation(useSetSafetyStockMutation);
export const useSetSafetyStockBulk = () => useCompatMutation(useSetSafetyStockBulkMutation);
export const useRecountStock = () => useCompatMutation(useRecountStockMutation);

/* ── the vocabulary, in one place ────────────────────────────────────── */

/**
 * The five stock states, with the words and colours the whole module uses.
 *
 * Mirrors `stockStatus()` in ims.service.js, which is the authority — the
 * server decides the status and sends it down, so this table only says how to
 * DRAW each one. It never recomputes the rule, because a page that decides
 * "low" differently from the alert that fires is the worst failure this module
 * could have.
 */
export const STOCK_STATUS = Object.freeze({
  out: { label: 'Out of stock', tone: 'danger', hint: 'Nothing on the shelf, and a safety level is set.' },
  critical: { label: 'Critical', tone: 'danger', hint: 'At or under half the safety level — reorder now.' },
  low: { label: 'Low', tone: 'warning', hint: 'At or under the safety level.' },
  ok: { label: 'In stock', tone: 'success', hint: 'Above the safety level.' },
  unset: { label: 'No floor set', tone: 'muted', hint: 'Stock is held here but nobody has said what "enough" is, so it is never reported as low.' },
  empty: { label: 'Not stocked', tone: 'muted', hint: 'Nothing here and no safety level — this location does not carry it.' },
});

/** Receive / Issue / Count — the three things the drawers do, and their words. */
export const MOVEMENT_KINDS = Object.freeze({
  in: {
    label: 'Stock in', verb: 'Receive', gerund: 'receiving', tone: 'success',
    reasons: [
      { value: 'purchase', label: 'Purchase / delivery' },
      { value: 'opening_stock', label: 'Opening stock' },
      { value: 'return_from_site', label: 'Returned from a site' },
      { value: 'found', label: 'Found / recovered' },
    ],
  },
  out: {
    label: 'Stock out', verb: 'Issue', gerund: 'issuing', tone: 'danger',
    reasons: [
      { value: 'issued_to_site', label: 'Issued to a site' },
      { value: 'consumed', label: 'Consumed' },
      { value: 'damaged', label: 'Damaged' },
      { value: 'lost', label: 'Lost' },
      { value: 'returned_to_vendor', label: 'Returned to vendor' },
      { value: 'sold', label: 'Sold' },
    ],
  },
  adjust: {
    label: 'Stock count', verb: 'Count', gerund: 'counting', tone: 'primary',
    reasons: [
      { value: 'stock_count', label: 'Physical count' },
      { value: 'correction', label: 'Correction' },
    ],
  },
});

export const LOCATION_TYPES = Object.freeze([
  { value: 'warehouse', label: 'Warehouse', hint: 'The central store everything is issued from' },
  { value: 'outlet', label: 'Outlet', hint: 'A company-run centre that consumes stock' },
  { value: 'franchise', label: 'Franchise', hint: 'A partner-run centre we supply but do not operate' },
]);
