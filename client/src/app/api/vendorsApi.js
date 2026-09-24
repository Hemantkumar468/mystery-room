import { baseApi } from './baseApi.js';

/**
 * The vendor drill-down: projects → that project's vendors → the full record.
 *
 * Three endpoints, one per screen, deliberately not one fat tree. Screen 1
 * needs a count per project and nothing else, so it must not pay for every
 * vendor's contact details to render a number.
 *
 * Every one of these is a READ MODEL over the p12 records — there is no
 * separate vendor collection — so they all provide the same `VENDORS_ALL` tag
 * that `recordInvalidation()` already busts whenever a p12 record is created
 * or edited. Adding a vendor inside a project's Phase 4B therefore refreshes
 * these three screens with no extra wiring, and cannot leave them stale.
 */
export const vendorsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getVendorProjects: build.query({
      query: () => ({ url: '/pms/vendors/projects', method: 'GET' }),
      providesTags: [{ type: 'Record', id: 'VENDORS_ALL' }],
    }),

    getProjectVendors: build.query({
      query: (projectId) => ({ url: `/pms/vendors/projects/${projectId}`, method: 'GET' }),
      providesTags: [{ type: 'Record', id: 'VENDORS_ALL' }],
    }),

    getVendorDetail: build.query({
      query: ({ projectId, vendorId }) => ({
        url: `/pms/vendors/projects/${projectId}/vendors/${vendorId}`,
        method: 'GET',
      }),
      providesTags: (_result, _error, { vendorId }) => [
        { type: 'Record', id: vendorId },
        { type: 'Record', id: 'VENDORS_ALL' },
      ],
    }),
  }),
});

export const {
  useGetVendorProjectsQuery,
  useGetProjectVendorsQuery,
  useGetVendorDetailQuery,
} = vendorsApi;

export default vendorsApi;
