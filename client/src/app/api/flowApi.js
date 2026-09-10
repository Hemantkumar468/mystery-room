import { baseApi } from './baseApi.js';

/**
 * The client flow's gates and rollups — PMS_UI_SPEC_00.
 *
 * Every endpoint is a READ MODEL over the phase records (p11 drawings, p12
 * vendors, p13 BOQ lines, p21 contracts). There is no separate collection for
 * any of them, so they all provide the same `Record` tag family that
 * `recordInvalidation()` already busts when a record is created or edited:
 * approving a drawing in Phase 5 refreshes the BOQ workspace's "quantities
 * ready" banner with no extra wiring, and cannot leave it stale.
 *
 * `getProjectFlow` deliberately returns the WHOLE board in one call. The
 * screens that need it need all of it at once — the drawing gate decides
 * whether the BOQ can start, the panel decides whether it can be priced, and
 * the contracts decide whether any of it can be ordered. Fetched separately,
 * a page could render three answers taken at three different moments and
 * contradict itself.
 */
export const flowApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getProjectFlow: build.query({
      query: (projectId) => ({ url: `/pms/flow/${projectId}`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),

    getDrawingChecklist: build.query({
      query: (projectId) => ({ url: `/pms/flow/${projectId}/drawings`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),

    getBoqWorkspace: build.query({
      query: (projectId) => ({ url: `/pms/flow/${projectId}/boq`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),

    getFlowContracts: build.query({
      query: (projectId) => ({ url: `/pms/flow/${projectId}/contracts`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),

    getVendorPanel: build.query({
      query: (projectId) => ({ url: `/pms/flow/${projectId}/panel`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),

    /**
     * The panel BOARD — one row per BOQ with its assigned team and rate-card
     * state. Separate from `getVendorPanel`, which is the gate summary the BOQ
     * workspace reads: the board carries per-row detail no other screen wants,
     * and the workspace should not pay for it to render a banner.
     */
    getPanelBoard: build.query({
      query: (projectId) => ({ url: `/pms/flow/${projectId}/panel-board`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),

    getRateCard: build.query({
      query: ({ projectId, vendorId }) => ({
        url: `/pms/flow/${projectId}/panel/${vendorId}/rate-card`,
        method: 'GET',
      }),
      providesTags: (_r, _e, { projectId, vendorId }) => [
        { type: 'Record', id: vendorId },
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),

    /**
     * The deposit: the LOI's instalment plan with what has actually arrived
     * laid against it. Read from the server rather than matched again here —
     * the board and the ledger screen must not be able to disagree about
     * whether instalment 2 is settled.
     */
    getDepositLedger: build.query({
      query: (projectId) => ({ url: `/pms/flow/${projectId}/deposit`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),

    getOrderability: build.query({
      query: (projectId) => ({ url: `/pms/flow/${projectId}/orderability`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetProjectFlowQuery,
  useGetDrawingChecklistQuery,
  useGetBoqWorkspaceQuery,
  useGetFlowContractsQuery,
  useGetVendorPanelQuery,
  useGetPanelBoardQuery,
  useGetRateCardQuery,
  useGetDepositLedgerQuery,
  useGetOrderabilityQuery,
} = flowApi;

export default flowApi;
