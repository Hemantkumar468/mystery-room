import { baseApi } from './baseApi.js';
import { api } from '../../lib/api.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * The inventory master — every SKU the company stocks, migrated from the
 * BoxHero export and maintained on Master Data → Inventory.
 *
 * THE LIST IS SERVER-PAGED. `getInventory` takes the filters, the sort and the
 * page as query params and gets back `{ rows, page, limit, total, totalPages,
 * counts }`. The master is over 1,300 rows, so nothing here ever holds the
 * whole collection — see inventory.service.js.
 *
 * `getInventoryMeta` is the small companion read the dropdowns and the Add
 * form's suggestions use: the categories, units and vendor names actually
 * present. It is invalidated by every write, because adding one item with a
 * new vendor should make that vendor selectable on the next.
 */
export const inventoryApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getInventory: build.query({
      query: (params = {}) => ({ url: '/pms/inventory', method: 'GET', params }),
      providesTags: ['Inventory'],
    }),
    getInventoryMeta: build.query({
      query: () => ({ url: '/pms/inventory/meta', method: 'GET' }),
      providesTags: ['Inventory', 'InventoryCategory'],
    }),
    getInventoryCategories: build.query({
      query: () => ({ url: '/pms/inventory/categories', method: 'GET' }),
      providesTags: ['InventoryCategory'],
    }),

    createInventoryItem: build.mutation({
      query: (body) => ({ url: '/pms/inventory', method: 'POST', data: body }),
      invalidatesTags: ['Inventory', 'InventoryCategory'],
    }),
    /** Many at once — the paste-from-a-spreadsheet path. Partial success: the
        response names every row it could not take and why. */
    bulkCreateInventoryItems: build.mutation({
      query: (items) => ({ url: '/pms/inventory/bulk', method: 'POST', data: { items } }),
      invalidatesTags: ['Inventory', 'InventoryCategory'],
    }),
    updateInventoryItem: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/inventory/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: ['Inventory', 'InventoryCategory'],
    }),
    /** Archives it — the SKU stays reserved and past paperwork still reads. */
    archiveInventoryItem: build.mutation({
      query: (id) => ({ url: `/pms/inventory/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Inventory'],
    }),
    restoreInventoryItem: build.mutation({
      query: (id) => ({ url: `/pms/inventory/${id}/restore`, method: 'POST' }),
      invalidatesTags: ['Inventory'],
    }),

    /** Accepts `{ name, description }` for one, or `{ names: [...] }` for several. */
    createInventoryCategory: build.mutation({
      query: (body) => ({ url: '/pms/inventory/categories', method: 'POST', data: body }),
      invalidatesTags: ['InventoryCategory', 'Inventory'],
    }),
    /** A changed name rewrites every item filed under the old spelling, so this
        invalidates the item list too. */
    updateInventoryCategory: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/inventory/categories/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: ['InventoryCategory', 'Inventory'],
    }),
    archiveInventoryCategory: build.mutation({
      query: (id) => ({ url: `/pms/inventory/categories/${id}`, method: 'DELETE' }),
      invalidatesTags: ['InventoryCategory', 'Inventory'],
    }),
  }),
});

export const {
  useGetInventoryQuery,
  useGetInventoryMetaQuery,
  useGetInventoryCategoriesQuery,
  useCreateInventoryItemMutation,
  useBulkCreateInventoryItemsMutation,
  useUpdateInventoryItemMutation,
  useArchiveInventoryItemMutation,
  useRestoreInventoryItemMutation,
  useCreateInventoryCategoryMutation,
  useUpdateInventoryCategoryMutation,
  useArchiveInventoryCategoryMutation,
} = inventoryApi;

export const useInventory = (params) => useGetInventoryQuery(params);
export const useInventoryMeta = () => useGetInventoryMetaQuery();
export const useInventoryCategories = () => useGetInventoryCategoriesQuery();

export const useCreateInventoryItem = () => useCompatMutation(useCreateInventoryItemMutation);
export const useBulkCreateInventoryItems = () => useCompatMutation(useBulkCreateInventoryItemsMutation);
export const useUpdateInventoryItem = () => useCompatMutation(useUpdateInventoryItemMutation);
export const useArchiveInventoryItem = () => useCompatMutation(useArchiveInventoryItemMutation);
export const useRestoreInventoryItem = () => useCompatMutation(useRestoreInventoryItemMutation);
export const useCreateInventoryCategory = () => useCompatMutation(useCreateInventoryCategoryMutation);
export const useUpdateInventoryCategory = () => useCompatMutation(useUpdateInventoryCategoryMutation);
export const useArchiveInventoryCategory = () => useCompatMutation(useArchiveInventoryCategoryMutation);

/** The two states BoxHero files an item under, in the order the filter offers them. */
export const VISIBILITIES = ['Listed', 'Unlisted'];

/**
 * The columns the bulk-add box understands, in the order it reads them.
 *
 * Exported so the paste parser, the column headings above the rows and the
 * "what can I paste?" hint all read from one list — three copies of a column
 * order is three chances for the hint to describe a layout the parser does not
 * actually accept.
 */
export const BULK_COLUMNS = [
  { key: 'sku', label: 'SKU', hint: 'Blank = we mint one', width: 112 },
  { key: 'name', label: 'Item name', hint: 'Required', width: 200, required: true },
  { key: 'category', label: 'Category', width: 140 },
  { key: 'unit', label: 'Unit', width: 86 },
  { key: 'visibility', label: 'Visibility', width: 112 },
  { key: 'vendorName', label: 'Vendor', width: 150 },
  { key: 'vendorDetails', label: 'Vendor contact', width: 120 },
  { key: 'price', label: 'Price (₹)', width: 92 },
  { key: 'imageUrl', label: 'Image URL', width: 150 },
];

/**
 * Download the current view as a CSV.
 *
 * Goes through the app's own axios instance rather than pointing the browser
 * at the URL, because the export route is authenticated with a Bearer token
 * that lives in memory — a plain `window.open` carries no header and comes
 * back a 401. The blob is turned into a click here and revoked straight after,
 * so nothing is left holding the file.
 *
 * `params` are the SAME filters the table is showing. See the note on the
 * route: an export that quietly returns everything when the screen shows a
 * filtered set is worse than no export at all.
 */
export async function downloadInventoryCsv(params = {}) {
  const res = await api({
    url: '/pms/inventory/export',
    method: 'GET',
    params,
    responseType: 'blob',
  });

  const disposition = res.headers?.['content-disposition'] || '';
  const named = /filename="?([^";]+)"?/.exec(disposition)?.[1];
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = named || 'inventory.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return named;
}
