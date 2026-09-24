import { baseApi } from './baseApi.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * The supply vendor master — the standing "who do we buy this from" list,
 * transcribed from SHEET/F Vendor.xlsx and maintained on Master Data → Vendors.
 *
 * Two readers that must never disagree: the page itself, and the vendor
 * dropdown on a BOQ line / work order (see DynamicField.jsx). Both read this
 * one list, so a supplier added here is selectable on every project at once
 * with no template to edit and nothing to type twice.
 */
export const vendorMasterApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getVendorMaster: build.query({
      query: () => ({ url: '/pms/vendor-master', method: 'GET' }),
      providesTags: ['VendorMaster'],
    }),
    createMasterVendor: build.mutation({
      query: (body) => ({ url: '/pms/vendor-master', method: 'POST', data: body }),
      invalidatesTags: ['VendorMaster'],
    }),
    updateMasterVendor: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/vendor-master/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: ['VendorMaster'],
    }),
    /** Really removes the row — see the note on the DELETE route for why. */
    deleteMasterVendor: build.mutation({
      query: (id) => ({ url: `/pms/vendor-master/${id}`, method: 'DELETE' }),
      invalidatesTags: ['VendorMaster'],
    }),
  }),
});

export const {
  useGetVendorMasterQuery,
  useCreateMasterVendorMutation,
  useUpdateMasterVendorMutation,
  useDeleteMasterVendorMutation,
} = vendorMasterApi;

export const useVendorMaster = () => useGetVendorMasterQuery();
export const useCreateMasterVendor = () => useCompatMutation(useCreateMasterVendorMutation);
export const useUpdateMasterVendor = () => useCompatMutation(useUpdateMasterVendorMutation);
export const useDeleteMasterVendor = () => useCompatMutation(useDeleteMasterVendorMutation);

/**
 * The master shaped like the p12 vendor records the pickers already read, so
 * one dropdown can offer both without caring which list a name came from.
 *
 * The key names are the p12 schema's, not this model's (`contact_phone`, not
 * `contactNumber`) — the picker's "Fetched: …" line and its `fillFrom` copy
 * read those keys, and translating here rather than at the call site keeps the
 * difference between the two lists in one place.
 */
export const asPickerRow = (v) => ({
  values: {
    vendor_name: v.vendorName,
    contact_person: v.contactPerson || '',
    contact_phone: v.contactNumber || '',
    email: v.email || '',
    /* What they supply. The p12 record has no equivalent, and it is the whole
       point of this list — "Balloon" is why you picked Utsav Trading. */
    item: v.item || '',
  },
});
