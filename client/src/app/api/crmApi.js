import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * CRM endpoints, injected into the single `baseApi` instance.
 *
 * Same pattern as every other domain file — one `createApi`, many injections —
 * so a CRM mutation can invalidate a PMS tag (and vice versa) without a bridge
 * between two caches.
 *
 * ENDPOINT NAMES ARE GLOBAL. Every domain file injects into the SAME
 * `baseApi`, so two files cannot both define `getTasks` — RTK Query keeps
 * the first and silently ignores the second, and the loser's hooks then
 * call the winner's URL. That is exactly what happened here: CRM's
 * `getTasks` and `getBoard` resolved to the PMS ones and fetched
 * `/pms/tasks`. Hence the `Crm` in the names below — check tasksApi.js and
 * projectsApi.js before adding another.
 *
 * TAGS. `CrmDashboard` is declared as its own tag rather than being invalidated
 * by hand: capturing a lead changes six of the dashboard's numbers, and the
 * mutation that moved them is the only place that reliably knows.
 */
export const crmApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** Every counter on the dashboard, in one call — so no two tiles can
     *  describe different moments while the page settles. */
    getCrmDashboard: build.query({
      query: () => ({ url: '/crm/dashboard', method: 'GET' }),
      providesTags: [{ type: 'CrmDashboard', id: 'SUMMARY' }],
    }),

    /** Statuses and sources, from the server — a value the API would reject
     *  must never appear in a dropdown. */
    getCrmOptions: build.query({
      query: () => ({ url: '/crm/options', method: 'GET' }),
      keepUnusedDataFor: 3600,
    }),

    getLeads: build.query({
      query: (params) => ({ url: `/crm/leads${qs(params)}`, method: 'GET' }),
      providesTags: [{ type: 'Lead', id: 'LIST' }],
    }),

    getLead: build.query({
      query: (id) => ({ url: `/crm/leads/${id}`, method: 'GET' }),
      providesTags: (_r, _e, id) => [{ type: 'Lead', id }],
    }),

    /**
     * The live duplicate check, called while the phone number is being typed.
     *
     * A query rather than a mutation because it changes nothing — which also
     * means RTK Query caches it, so re-typing the same number does not re-ask.
     */
    checkDuplicate: build.query({
      query: (params) => ({ url: `/crm/leads/check-duplicate${qs(params)}`, method: 'GET' }),
      keepUnusedDataFor: 30,
    }),

    createLead: build.mutation({
      query: (body) => ({ url: '/crm/leads', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'Lead', id: 'LIST' }, { type: 'CrmDashboard', id: 'SUMMARY' }],
    }),

    reassignLead: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/leads/${id}/assign`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Lead', id }, { type: 'Lead', id: 'LIST' }, { type: 'CrmDashboard', id: 'SUMMARY' },
      ],
    }),

    setLeadStatus: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/leads/${id}/status`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Lead', id }, { type: 'Lead', id: 'LIST' }, { type: 'CrmDashboard', id: 'SUMMARY' },
      ],
    }),

    /* ── Telephony ───────────────────────────────────────── */

    /**
     * THE SCREEN-POP. A long poll: the request is held open until a call rings
     * for this agent, or until it times out.
     *
     * `keepUnusedDataFor: 0` because a ring is a moment, not a value worth
     * caching — a cached one would pop again on the next mount.
     */
    ringing: build.query({
      query: (wait = 25000) => ({ url: `/crm/telephony/ringing?wait=${wait}`, method: 'GET' }),
      keepUnusedDataFor: 0,
    }),

    clickToCall: build.mutation({
      query: (body) => ({ url: '/crm/telephony/call', method: 'POST', data: body }),
    }),

    /* ── Contacts and companies ──────────────────────────── */

    getContacts: build.query({
      query: (params) => ({ url: `/crm/contacts${qs(params)}`, method: 'GET' }),
      providesTags: [{ type: 'Contact', id: 'LIST' }],
    }),

    getContact: build.query({
      query: (id) => ({ url: `/crm/contacts/${id}`, method: 'GET' }),
      providesTags: (_r, _e, id) => [{ type: 'Contact', id }],
    }),

    createContact: build.mutation({
      query: (body) => ({ url: '/crm/contacts', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'Contact', id: 'LIST' }],
    }),

    updateContact: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/contacts/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Contact', id }, { type: 'Contact', id: 'LIST' }],
    }),

    getCompanies: build.query({
      query: (params) => ({ url: `/crm/companies${qs(params)}`, method: 'GET' }),
      providesTags: [{ type: 'Company', id: 'LIST' }],
    }),

    getCompany: build.query({
      query: (id) => ({ url: `/crm/companies/${id}`, method: 'GET' }),
      providesTags: (_r, _e, id) => [{ type: 'Company', id }],
    }),

    createCompany: build.mutation({
      query: (body) => ({ url: '/crm/companies', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'Company', id: 'LIST' }],
    }),

    updateCompany: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/companies/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Company', id }, { type: 'Company', id: 'LIST' }],
    }),

    /* ── One deal ────────────────────────────────────────── */

    getDeal: build.query({
      query: (id) => ({ url: `/crm/deals/${id}`, method: 'GET' }),
      providesTags: (_r, _e, id) => [{ type: 'Deal', id }],
    }),

    /* ── Routing rules ───────────────────────────────────── */

    getRoutingRules: build.query({
      query: () => ({ url: '/crm/routing/rules', method: 'GET' }),
      providesTags: [{ type: 'RoutingRule', id: 'LIST' }],
    }),

    getRoutingVocabulary: build.query({
      query: () => ({ url: '/crm/routing/vocabulary', method: 'GET' }),
      keepUnusedDataFor: 3600,
    }),

    createRoutingRule: build.mutation({
      query: (body) => ({ url: '/crm/routing/rules', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'RoutingRule', id: 'LIST' }],
    }),

    updateRoutingRule: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/routing/rules/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: [{ type: 'RoutingRule', id: 'LIST' }],
    }),

    deleteRoutingRule: build.mutation({
      query: ({ id }) => ({ url: `/crm/routing/rules/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'RoutingRule', id: 'LIST' }],
    }),

    /* ── Pipeline stages ─────────────────────────────────── */

    updatePipelineStages: build.mutation({
      query: ({ id, stages }) => ({ url: `/crm/pipelines/${id}/stages`, method: 'PATCH', data: { stages } }),
      invalidatesTags: [{ type: 'Pipeline', id: 'LIST' }, { type: 'Deal', id: 'BOARD' }],
    }),

    /* ── My own settings ─────────────────────────────────── */

    getPreferences: build.query({
      query: () => ({ url: '/crm/preferences', method: 'GET' }),
      providesTags: [{ type: 'CrmPrefs', id: 'ME' }],
    }),

    updatePreferences: build.mutation({
      query: (body) => ({ url: '/crm/preferences', method: 'PATCH', data: body }),
      invalidatesTags: [{ type: 'CrmPrefs', id: 'ME' }],
    }),

    /* ── Tasks ───────────────────────────────────────────── */

    /** The whole Today screen in one call, so no two panels can describe
     *  different moments while the page settles. */
    getToday: build.query({
      query: () => ({ url: '/crm/today', method: 'GET' }),
      providesTags: [{ type: 'CrmTask', id: 'TODAY' }],
    }),

    getCrmTasks: build.query({
      query: (params) => ({ url: `/crm/tasks${qs(params)}`, method: 'GET' }),
      providesTags: [{ type: 'CrmTask', id: 'LIST' }],
    }),

    createCrmTask: build.mutation({
      query: (body) => ({ url: '/crm/tasks', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'CrmTask', id: 'TODAY' }, { type: 'CrmTask', id: 'LIST' }],
    }),

    completeTask: build.mutation({
      query: ({ id }) => ({ url: `/crm/tasks/${id}/complete`, method: 'PATCH' }),
      // The dashboard too: completing a task logs an activity, which is what
      // takes a lead out of the "never contacted" count.
      invalidatesTags: [{ type: 'CrmTask', id: 'TODAY' }, { type: 'CrmTask', id: 'LIST' },
        { type: 'CrmDashboard', id: 'SUMMARY' }, { type: 'Lead', id: 'LIST' }],
    }),

    cancelTask: build.mutation({
      query: ({ id }) => ({ url: `/crm/tasks/${id}/cancel`, method: 'PATCH' }),
      invalidatesTags: [{ type: 'CrmTask', id: 'TODAY' }, { type: 'CrmTask', id: 'LIST' }],
    }),

    /* ── Pipeline and deals ──────────────────────────────── */

    /** Stages and their deals in ONE call — see dealService.board for why the
     *  columns cannot be fetched separately. */
    getCrmBoard: build.query({
      query: (params) => ({ url: `/crm/board${qs(params)}`, method: 'GET' }),
      providesTags: [{ type: 'Deal', id: 'BOARD' }],
    }),

    getPipelines: build.query({
      query: () => ({ url: '/crm/pipelines', method: 'GET' }),
      providesTags: [{ type: 'Pipeline', id: 'LIST' }],
      keepUnusedDataFor: 600,
    }),

    getDeals: build.query({
      query: (params) => ({ url: `/crm/deals${qs(params)}`, method: 'GET' }),
      providesTags: [{ type: 'Deal', id: 'LIST' }],
    }),

    createDeal: build.mutation({
      query: (body) => ({ url: '/crm/deals', method: 'POST', data: body }),
      invalidatesTags: [
        { type: 'Deal', id: 'BOARD' }, { type: 'Deal', id: 'LIST' },
        { type: 'CrmDashboard', id: 'SUMMARY' },
      ],
    }),

    /**
     * One drag = one call.
     *
     * NOT tagged for invalidation. The board updates itself optimistically
     * below and rolls back on failure; invalidating would fire a full board
     * refetch on every drop, and the card would visibly jump twice — once to
     * where you put it, once to where the server says it is.
     */
    moveDeal: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/deals/${id}/move`, method: 'PATCH', data: body }),
      async onQueryStarted({
        id, stage, boardArgs, beforeId, afterId,
      }, { dispatch, queryFulfilled }) {
        const patch = dispatch(crmApi.util.updateQueryData('getCrmBoard', boardArgs, (draft) => {
          // Find the card and move it between columns in the cached response,
          // so the UI reflects the drop before the request has left.
          let card = null;
          for (const col of draft.stages) {
            const i = col.deals.findIndex((d) => String(d._id) === String(id));
            if (i === -1) continue;
            [card] = col.deals.splice(i, 1);
            col.count -= 1;
            col.value -= card.value || 0;
            break;
          }
          if (!card) return;
          const target = draft.stages.find((c) => String(c._id) === String(stage || card.stage));
          if (!target) return;
          card.stage = target._id;

          /**
           * Put it back WHERE IT WAS DROPPED, between the same two neighbours
           * the server is being told about.
           *
           * This used to `push`, which always meant the bottom of the column.
           * Drop a card at the top and it visibly landed at the bottom, then
           * silently corrected itself the next time the board was fetched —
           * so the position you saw was wrong until you happened to reload.
           * There is no invalidation here (see above) to cover for it, which
           * makes this patch the only thing the user sees.
           */
          const at = (needle, offset) => {
            const i = target.deals.findIndex((d) => String(d._id) === String(needle));
            return i === -1 ? -1 : i + offset;
          };
          let index = -1;
          if (afterId) index = at(afterId, 0);
          if (index === -1 && beforeId) index = at(beforeId, 1);
          target.deals.splice(index === -1 ? target.deals.length : index, 0, card);

          target.count += 1;
          target.value += card.value || 0;
        }));

        try {
          await queryFulfilled;
        } catch {
          // The server refused — a lost stage with no reason, a stale card,
          // a network failure. Put it back exactly where it was.
          patch.undo();
        }
      },
    }),

    /* ---------- Performance & loss analysis ---------- */

    getPerformance: build.query({
      query: (params) => ({ url: `/crm/performance${qs(params)}` }),
      providesTags: [{ type: 'Performance', id: 'SCORECARD' }],
    }),

    getDropOff: build.query({
      query: (params) => ({ url: `/crm/performance/dropoff${qs(params)}` }),
      providesTags: [{ type: 'Performance', id: 'DROPOFF' }],
    }),

    getLossAnalysis: build.query({
      query: (params) => ({ url: `/crm/performance/losses${qs(params)}` }),
      providesTags: [{ type: 'Performance', id: 'LOSSES' }],
    }),

    /* ---------- Tickets ---------- */

    getTickets: build.query({
      query: (params) => ({ url: `/crm/tickets${qs(params)}` }),
      providesTags: [{ type: 'Ticket', id: 'LIST' }],
    }),

    getTicketSummary: build.query({
      query: () => ({ url: '/crm/tickets/summary' }),
      providesTags: [{ type: 'Ticket', id: 'SUMMARY' }],
    }),

    getTicket: build.query({
      query: (id) => ({ url: `/crm/tickets/${id}` }),
      providesTags: (_r, _e, id) => [{ type: 'Ticket', id }],
    }),

    getSlaPolicies: build.query({
      query: () => ({ url: '/crm/tickets/sla-policies' }),
      providesTags: [{ type: 'SlaPolicy', id: 'LIST' }],
    }),

    updateSlaPolicy: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/tickets/sla-policies/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: [{ type: 'SlaPolicy', id: 'LIST' }],
    }),

    createTicket: build.mutation({
      query: (body) => ({ url: '/crm/tickets', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'Ticket', id: 'LIST' }, { type: 'Ticket', id: 'SUMMARY' }],
    }),

    /** Everything below changes the clock, the queue, or both — so all of them
     *  invalidate the summary as well as the row. */
    respondToTicket: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/tickets/${id}/respond`, method: 'POST', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Ticket', id }, { type: 'Ticket', id: 'LIST' }, { type: 'Ticket', id: 'SUMMARY' },
      ],
    }),

    setTicketStatus: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/tickets/${id}/status`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Ticket', id }, { type: 'Ticket', id: 'LIST' }, { type: 'Ticket', id: 'SUMMARY' },
      ],
    }),

    setTicketPriority: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/tickets/${id}/priority`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Ticket', id }, { type: 'Ticket', id: 'LIST' }, { type: 'Ticket', id: 'SUMMARY' },
      ],
    }),

    assignTicket: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/tickets/${id}/assign`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Ticket', id }, { type: 'Ticket', id: 'LIST' }],
    }),

    /* ---------- The BCC email dropbox ---------- */

    /** Is inbound email actually working? Named for the CRM specifically, like
     *  every other endpoint here — RTK Query's endpoint names are one global
     *  namespace across all injections, and the first definition of a name
     *  wins while later ones are dropped in silence. */
    getEmailDropboxStatus: build.query({
      query: () => ({ url: '/crm/email/dropbox/status' }),
      providesTags: [{ type: 'EmailDropbox', id: 'STATUS' }],
    }),

    getUnfiledEmail: build.query({
      query: (params) => ({ url: '/crm/email/dropbox/unfiled', params }),
      providesTags: [{ type: 'EmailDropbox', id: 'UNFILED' }],
    }),

    /** One click from "unknown sender" to a real lead with the mail on it. */
    createLeadFromEmail: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/email/dropbox/unfiled/${id}/create-lead`, method: 'POST', data: body }),
      invalidatesTags: [
        { type: 'EmailDropbox', id: 'UNFILED' }, { type: 'EmailDropbox', id: 'STATUS' },
        { type: 'Lead', id: 'LIST' }, { type: 'CrmDashboard', id: 'SUMMARY' },
      ],
    }),

    /** Outbound mail. Invalidates the record so the timeline shows it at once. */
    sendCrmEmail: build.mutation({
      query: (body) => ({ url: '/crm/email/send', method: 'POST', data: body }),
      invalidatesTags: (_r, _e, { entityType, entityId }) => [
        { type: entityType === 'contact' ? 'Contact' : 'Lead', id: entityId },
      ],
    }),

    resolveUnfiledEmail: build.mutation({
      query: (id) => ({ url: `/crm/email/dropbox/unfiled/${id}/resolve`, method: 'PATCH' }),
      invalidatesTags: [{ type: 'EmailDropbox', id: 'UNFILED' }, { type: 'EmailDropbox', id: 'STATUS' }],
    }),

    /** Logging a call or a note is what stops a lead counting as untouched, so
     *  it moves the dashboard as well as the record. */
    logLeadActivity: build.mutation({
      query: ({ id, ...body }) => ({ url: `/crm/leads/${id}/activities`, method: 'POST', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Lead', id }, { type: 'Lead', id: 'LIST' }, { type: 'CrmDashboard', id: 'SUMMARY' },
      ],
    }),
  }),
});

export const {
  useRingingQuery,
  useGetContactsQuery,
  useGetContactQuery,
  useGetCompaniesQuery,
  useGetCompanyQuery,
  useGetDealQuery,
  useGetRoutingRulesQuery,
  useGetRoutingVocabularyQuery,
  useGetPreferencesQuery,
  useGetTodayQuery,
  useGetCrmTasksQuery,
  useGetCrmBoardQuery,
  useGetPipelinesQuery,
  useGetDealsQuery,
  useGetCrmDashboardQuery,
  useGetCrmOptionsQuery,
  useGetLeadsQuery,
  useGetLeadQuery,
  useCheckDuplicateQuery,
  useGetPerformanceQuery,
  useGetDropOffQuery,
  useGetLossAnalysisQuery,
  useGetTicketsQuery,
  useGetTicketQuery,
  useGetTicketSummaryQuery,
  useGetSlaPoliciesQuery,
  useGetEmailDropboxStatusQuery,
  useGetUnfiledEmailQuery,
} = crmApi;

/* ---------- Old-name wrappers, matching the other domain files ---------- */

export const useCrmDashboard = (options) => useGetCrmDashboardQuery(undefined, options);
export const useCrmOptions = () => useGetCrmOptionsQuery();
export const useLeads = (params, options) => useGetLeadsQuery(params, options);
export const useLead = (id) => useGetLeadQuery(id, { skip: !id });

/** `skip` until there is something worth asking about — an empty check would
 *  return every lead's worth of nothing on every keystroke. */
export const useDuplicateCheck = (params, enabled) =>
  useCheckDuplicateQuery(params, { skip: !enabled });

export const useRinging = (wait) => useRingingQuery(wait, { refetchOnMountOrArgChange: true });
export const useContacts = (params, options) => useGetContactsQuery(params, options);
export const useContact = (id) => useGetContactQuery(id, { skip: !id });
export const useCompanies = (params, options) => useGetCompaniesQuery(params, options);
export const useCompany = (id) => useGetCompanyQuery(id, { skip: !id });
export const useDeal = (id) => useGetDealQuery(id, { skip: !id });
export const useRoutingRules = () => useGetRoutingRulesQuery();
export const useRoutingVocabulary = () => useGetRoutingVocabularyQuery();
export const usePreferences = () => useGetPreferencesQuery();

export const useClickToCall = () => useCompatMutation(crmApi.useClickToCallMutation);
export const useCreateContact = () => useCompatMutation(crmApi.useCreateContactMutation);
export const useUpdateContact = () => useCompatMutation(crmApi.useUpdateContactMutation);
export const useCreateCompany = () => useCompatMutation(crmApi.useCreateCompanyMutation);
export const useUpdateCompany = () => useCompatMutation(crmApi.useUpdateCompanyMutation);
export const useCreateRoutingRule = () => useCompatMutation(crmApi.useCreateRoutingRuleMutation);
export const useUpdateRoutingRule = () => useCompatMutation(crmApi.useUpdateRoutingRuleMutation);
export const useDeleteRoutingRule = () => useCompatMutation(crmApi.useDeleteRoutingRuleMutation);
export const useUpdatePipelineStages = () => useCompatMutation(crmApi.useUpdatePipelineStagesMutation);
export const useUpdatePreferences = () => useCompatMutation(crmApi.useUpdatePreferencesMutation);

export const useToday = (options) => useGetTodayQuery(undefined, options);
export const useCrmTasks = (params, options) => useGetCrmTasksQuery(params, options);
export const useCreateCrmTask = () => useCompatMutation(crmApi.useCreateCrmTaskMutation);
export const useCompleteTask = () => useCompatMutation(crmApi.useCompleteTaskMutation);
export const useCancelTask = () => useCompatMutation(crmApi.useCancelTaskMutation);

export const useCrmBoard = (params, options) => useGetCrmBoardQuery(params, options);
export const usePipelines = () => useGetPipelinesQuery();
export const useDeals = (params, options) => useGetDealsQuery(params, options);

export const useCreateDeal = () => useCompatMutation(crmApi.useCreateDealMutation);
export const useMoveDeal = () => useCompatMutation(crmApi.useMoveDealMutation);

export const useCreateLead = () => useCompatMutation(crmApi.useCreateLeadMutation);
export const useReassignLead = () => useCompatMutation(crmApi.useReassignLeadMutation);
export const useSetLeadStatus = () => useCompatMutation(crmApi.useSetLeadStatusMutation);
export const useLogLeadActivity = () => useCompatMutation(crmApi.useLogLeadActivityMutation);

export const usePerformance = (params, options) => useGetPerformanceQuery(params, options);
export const useDropOff = (params, options) => useGetDropOffQuery(params, options);
export const useLossAnalysis = (params, options) => useGetLossAnalysisQuery(params, options);

export const useTickets = (params, options) => useGetTicketsQuery(params, options);
export const useTicket = (id, options) => useGetTicketQuery(id, options);
export const useTicketSummary = (options) => useGetTicketSummaryQuery(undefined, options);
export const useSlaPolicies = () => useGetSlaPoliciesQuery();
export const useUpdateSlaPolicy = () => useCompatMutation(crmApi.useUpdateSlaPolicyMutation);
export const useCreateTicket = () => useCompatMutation(crmApi.useCreateTicketMutation);
export const useRespondToTicket = () => useCompatMutation(crmApi.useRespondToTicketMutation);
export const useSetTicketStatus = () => useCompatMutation(crmApi.useSetTicketStatusMutation);
export const useSetTicketPriority = () => useCompatMutation(crmApi.useSetTicketPriorityMutation);
export const useAssignTicket = () => useCompatMutation(crmApi.useAssignTicketMutation);

export const useCreateLeadFromEmail = () => useCompatMutation(crmApi.useCreateLeadFromEmailMutation);
export const useSendCrmEmail = () => useCompatMutation(crmApi.useSendCrmEmailMutation);

export const useEmailDropboxStatus = (options) => useGetEmailDropboxStatusQuery(undefined, options);
export const useUnfiledEmail = (params, options) => useGetUnfiledEmailQuery(params, options);
export const useResolveUnfiledEmail = () => useCompatMutation(crmApi.useResolveUnfiledEmailMutation);

export default crmApi;
