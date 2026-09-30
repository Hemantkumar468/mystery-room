import { baseApi } from './baseApi.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * Property capture — the one queue every property lands in, and the one
 * decision taken on it.
 *
 * The rows are a server-side union of p1 records and undecided enquiries (see
 * propertyCapture.service.js), so nothing here owns state. Routing a property
 * writes through to the record, which is why it invalidates 'Record' as well:
 * the project board is looking at the same document.
 */
export const propertyCaptureApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getPropertyQueue: build.query({
      query: (params = {}) => ({ url: '/pms/property-capture', method: 'GET', params }),
      providesTags: ['PropertyCapture'],
    }),
    routeProperty: build.mutation({
      query: ({ recordId, ...body }) => ({
        url: `/pms/property-capture/${recordId}/route`, method: 'POST', data: body,
      }),
      invalidatesTags: ['PropertyCapture', 'Record', 'ProjectTree'],
    }),
    /**
     * A submitted property's next step — assessment (and which), or straight
     * to commercial. Approving the lead is what that answer DOES, so it is one
     * call: see propertyCapture.service.js#routeSubmission. Invalidates
     * 'Franchise' too, because the enquiry queue has just lost a row.
     */
    routeSubmission: build.mutation({
      query: ({ enquiryId, ...body }) => ({
        url: `/pms/property-capture/submissions/${enquiryId}/route`, method: 'POST', data: body,
      }),
      invalidatesTags: ['PropertyCapture', 'Record', 'ProjectTree', 'Project', 'Franchise', 'MyTasks'],
    }),
    /**
     * Changing a decision that was already taken — see
     * propertyCapture.service.js#changeDecision. Invalidates the same tags a
     * decision does: the queue row moves, and the record behind it changed.
     */
    changePropertyDecision: build.mutation({
      query: ({ recordId, ...body }) => ({
        url: `/pms/property-capture/${recordId}/change-decision`, method: 'POST', data: body,
      }),
      invalidatesTags: ['PropertyCapture', 'Record', 'ProjectTree', 'Project'],
    }),

    /** The verdict after assessment — shortlist for commercial, or reject. */
    decideProperty: build.mutation({
      query: ({ recordId, ...body }) => ({
        url: `/pms/property-capture/${recordId}/decide`, method: 'POST', data: body,
      }),
      invalidatesTags: ['PropertyCapture', 'Record', 'ProjectTree'],
    }),

    /**
     * Step 4's Reject: the assessment goes back to the doer, redone.
     *
     * Invalidates Task as well as the queue - the point of it is that work
     * reappears in somebody's My Tasks, and that list is cached too.
     */
    reassessProperty: build.mutation({
      query: ({ recordId, ...body }) => ({
        url: `/pms/property-capture/${recordId}/reassess`, method: 'POST', data: body,
      }),
      invalidatesTags: ['PropertyCapture', 'Record', 'ProjectTree', 'Task'],
    }),

    /**
     * Document Approvals' Reject: the document goes back to be filled in
     * again, as a draft, with the reason attached to it.
     *
     * Invalidates Task for the same reason `reassessProperty` does — the whole
     * point is that work reappears in somebody's My Tasks, and that list is
     * cached too.
     */
    sendDocumentsBack: build.mutation({
      query: ({ recordId, ...body }) => ({
        url: `/pms/property-capture/${recordId}/documents/send-back`, method: 'POST', data: body,
      }),
      invalidatesTags: ['PropertyCapture', 'Record', 'ProjectTree', 'Task'],
    }),
  }),
});

export const {
  useGetPropertyQueueQuery, useRoutePropertyMutation, useDecidePropertyMutation,
  useRouteSubmissionMutation, useChangePropertyDecisionMutation,
  useReassessPropertyMutation, useSendDocumentsBackMutation,
} = propertyCaptureApi;
export const usePropertyQueue = (params) => useGetPropertyQueueQuery(params);
export const useRouteProperty = () => useCompatMutation(useRoutePropertyMutation);
export const useDecideProperty = () => useCompatMutation(useDecidePropertyMutation);
export const useRouteSubmission = () => useCompatMutation(useRouteSubmissionMutation);
export const useChangePropertyDecision = () => useCompatMutation(useChangePropertyDecisionMutation);
export const useReassessProperty = () => useCompatMutation(useReassessPropertyMutation);
export const useSendDocumentsBack = () => useCompatMutation(useSendDocumentsBackMutation);

/** The four Site Evaluation assessments, in the order the forms are worked. */
export const ASSESSMENTS = [
  { key: 'feasibility', label: 'Feasibility', hint: 'Market, footfall, competition' },
  { key: 'financial', label: 'Financial', hint: 'Rent, deposit, payback' },
  { key: 'technical', label: 'Technical', hint: 'Power, civil, services' },
  { key: 'operational', label: 'Operational', hint: 'Staffing, access, logistics' },
];

/**
 * The six documents commercial closure produces, in the order they are worked.
 * Mirrors DOCUMENTS in propertyCapture.service.js — `project_creation` is the
 * handover after these, not one of them.
 */
export const DOCUMENTS = [
  { key: 'loi', label: 'LOI' },
  { key: 'lease', label: 'Lease' },
  { key: 'legal', label: 'Legal' },
  { key: 'deposit', label: 'Deposit' },
  { key: 'nocs', label: 'NOCs' },
];

/**
 * How each intake is labelled, and its colour on the row.
 *
 * 'demand' is the one worth reading twice: it is not a property. It is a
 * standing ask — a franchisee interested in a city with nothing in hand, or
 * an MD's New Project — and the queue shows it so somebody goes and finds a
 * site rather than the ask quietly falling off the list.
 */
export const SOURCES = {
  franchise: { label: 'Franchisee', color: '#6366F1' },
  broker: { label: 'Broker', color: '#0ea5e9' },
  demand: { label: 'Wanted', color: '#D97706' },
  captured: { label: 'Captured', color: '#16a79a' },
};

export const STAGES = {
  demand: { label: 'Sourcing', color: '#D97706' },
  capture: { label: 'Captured', color: '#6a655f' },
  assessment: { label: 'Assessment', color: '#2563EB' },
  commercial: { label: 'Commercial', color: '#059669' },
};
