import {
  useStock as useStockQuery,
  useImsLocations as useImsLocationsQuery,
  useImsOverview,
  useMovements,
  useSetSafetyStock,
  useSetSafetyStockBulk,
  usePostMovement,
  usePostTransfer,
  useCreateImsLocation,
  useUpdateImsLocation,
  useCloseImsLocation,
  useRecountStock,
} from '../../app/api/imsApi.js';
import { useGetInventoryMetaQuery } from '../../app/api/inventoryApi.js';

/**
 * One import for everything an IMS screen reads or writes.
 *
 * A thin re-export rather than a second data layer: every hook below is the
 * RTK Query hook from `imsApi.js`, unchanged. It exists so an IMS page has one
 * import line instead of two — one reaching into the IMS cache and one
 * reaching across into the catalogue's — and so the one genuinely awkward
 * cross-module read (`useInventoryMetaForIms`) is named and explained in a
 * single place rather than repeated with a comment on three pages.
 */

export {
  useImsOverview,
  useMovements,
  useSetSafetyStock,
  useSetSafetyStockBulk,
  usePostMovement,
  usePostTransfer,
  useCreateImsLocation,
  useUpdateImsLocation,
  useCloseImsLocation,
  useRecountStock,
};

export const useStock = (params) => useStockQuery(params);
export const useImsLocations = (params) => useImsLocationsQuery(params);

/**
 * The catalogue's categories, units and vendor names, for the IMS filter bars.
 *
 * READS ACROSS TO THE MASTER'S CACHE on purpose. These lists are properties of
 * the ITEM, not of the stock — "Electrical" is a category whether or not a
 * single unit of it is on a shelf — so deriving them from stock rows would
 * give a different, smaller and confusingly inconsistent list on every IMS
 * screen depending on what happened to be stocked. One list, one owner.
 *
 * It is cheap: the master's meta is already fetched and cached by tag
 * ('Inventory'), so an IMS page that needs it usually pays nothing for it.
 */
export function useInventoryMetaForIms() {
  const { data } = useGetInventoryMetaQuery();
  return data?.data ?? data ?? {};
}
