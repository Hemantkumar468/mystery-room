import { createApi } from '@reduxjs/toolkit/query/react';
import { axiosBaseQuery } from './axiosBaseQuery.js';

/**
 * THE single RTK Query API instance. Every domain adds its endpoints through
 * `baseApi.injectEndpoints` from its own file under `app/api/`.
 *
 * Why one instance rather than one `createApi` per domain: tags are scoped to
 * a createApi instance, so cross-domain invalidation (approving a task must
 * refresh Dashboard, Calendar and MIS) is only expressible inside a single
 * cache. Splitting by domain is what forces manual bridge code between
 * caches — the failure mode of the 2026-07-24 attempt, which stood up a
 * separate `approvalsApi` and then needed a bridge to keep it honest.
 *
 * Every business module now injects its endpoints here — Auth, Notifications,
 * Projects, Tasks, Records, Templates, Calendar, MIS, Users, AI. RTK Query is
 * the app's sole data layer; React Query and `lib/queries.js` are gone.
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery(),

  /**
   * Tag vocabulary, declared up front so domains can reference each other's
   * tags as they land.
   *
   * Entity tags name a thing the server stores. Derived tags name a
   * server-computed VIEW over those things — Dashboard, Calendar, MIS,
   * MyTasks and the closure gates are all recomputed from Projects/Tasks/
   * Records. They exist as tags because the audit found four classes of
   * missing invalidation in the React Query layer, all of the same shape:
   * a mutation changed an entity and nobody remembered to invalidate the
   * aggregate that derives from it (nothing ever invalidates ['calendar'] or
   * ['mis'], ['my-tasks'] only on create, stage completion misses
   * ['dashboard'] and ['closure-readiness']). Declaring the aggregate as a
   * tag makes that relationship explicit at the endpoint instead of relying
   * on memory.
   */
  tagTypes: [
    // ── Entities ──
    'Project',
    'Task',
    'Record',
    'Template',
    'User',
    'Notification',
    // ── Server-derived views ──
    'Dashboard',
    'Calendar',
    'Mis',
    'Activity',
    'Board',
    'MyTasks',
    'ClosureReadiness',
    'StageGate',
    // ── AI ──
    // Analyses and comparisons are stored server-side per record/project, so
    // they are entities in their own right; scores are a derived view over
    // them that the Property Identification table reads.
    'AiAnalysis',
    'AiScores',
    'AiComparison',
    // Live counters for a running whole-project sweep. Server-side and
    // in-memory, so this is polled rather than invalidated into freshness.
    'AiSweep',
    // ── CRM ──
    // The lead, then the dashboard as a derived view over all of them:
    // capturing or working one lead moves six of the dashboard's numbers, so
    // the aggregate is its own tag rather than something to remember to
    // refetch by hand.
    'Lead',
    // The board is its own tag id under 'Deal': a drag invalidates neither
    // (it patches the cache optimistically), but creating or deleting a deal
    // must refresh both the board and the list.
    'Deal',
    // Stages change rarely and every board render needs them, so they are
    // cached hard and invalidated only by the pipeline admin.
    'Pipeline',
    // Follow-ups. 'TODAY' is its own id because that screen is a derived
    // view over the same rows the task list shows.
    'CrmTask',
    'Contact',
    'Company',
    'RoutingRule',
    'CrmPrefs',
    'CrmDashboard',
    // Inbound email: the status tile and the unfiled queue on the settings page.
    'EmailDropbox',
    // Support tickets and the SLA targets they are measured against.
    'Ticket',
    'SlaPolicy',
    // Scorecard, stage drop-off and loss analysis.
    'Performance',
  ],

  /**
   * Mirrors the React Query defaults the app used before this migration
   * (staleTime 30s, no refetch on window focus) — caching improvements are a
   * separate, reviewable change from the data-layer swap itself.
   */
  keepUnusedDataFor: 30,
  refetchOnFocus: false,
  refetchOnReconnect: true,

  endpoints: () => ({}),
});

export default baseApi;
