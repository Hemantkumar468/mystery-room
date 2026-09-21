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
    // The project screen's one read: phases with their tasks. Separate from
    // 'Project' so a task state change refreshes the tree without pulling
    // the project header, its activity and its closure readiness with it.
    'ProjectTree',
    'Task',
    'Record',
    'Template',
    // The game catalogue — a company master read by the Phase 3B and
    // Phase 10 pickers, maintained on the Games page.
    'Game',
    // The supply vendor master — who we buy each kind of item from. Read by
    // the BOQ and work-order vendor pickers, maintained on Master Data →
    // Vendors. Separate from 'Record' (the p12 vendors engaged on a project):
    // adding a supplier to the master must not invalidate every project's
    // record cache, and approving a p12 record must not refetch the master.
    'VendorMaster',
    // The inventory master — every SKU the company stocks, migrated from the
    // BoxHero export and maintained on Master Data → Inventory. Its category
    // list is a tag of its own because renaming a category rewrites items
    // while adding one does not, and only the first needs the paged item list
    // refetched.
    'Inventory',
    'InventoryCategory',
    // The IMS — the COUNT, kept apart from the catalogue above on purpose.
    // Correcting an item name must not refetch every stock page, and issuing
    // six bulbs must not refetch the 1,322-row master. See imsApi.js.
    'Stock',
    'StockMovement',
    'ImsLocation',
    // Employee Performance (ERS). ONE tag for the whole module, deliberately:
    // the counts, the podium, the leaderboard and the drawer are all views of
    // a single upstream response, so refreshing one without the others would
    // let two figures on the same screen disagree. See ersApi.js.
    'ErsBoard',
    // The property queue — a server-side union of p1 records and undecided
    // enquiries. Owns no data, so it is invalidated BY record writes rather
    // than the other way round.
    'PropertyCapture',
    // Invitations to outside designers: the link, who it went to, what came
    // back. Scoped per project+phase, refreshed on send/revoke.
    'OutsourceLink',
    'User',
    // Access control. 'Access' is the signed-in person's OWN effective map -
    // every session holds one and a policy save must refresh it, or the
    // sidebar keeps drawing what the editor just took away. 'AccessPolicy'
    // is the Settings screen's view of everybody's, and 'AccessCatalog' is
    // the registry of grantable surfaces, which only a deploy changes.
    'Access',
    'AccessPolicy',
    'AccessCatalog',
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
    // Design & Drawings FMS — the multi-project dashboard (aggregate) and its
    // per-project detail. A derived view over 'Record', same reasoning as
    // 'PropertyCapture': owns no data of its own, invalidated BY record and
    // drawing-plan writes rather than the other way round.
    'DesignDrawingsOverview',
    'DesignDrawingsProject',
    // The rows behind one KPI card — the same portfolio pass the overview
    // totals come from, so it invalidates alongside them and the card and the
    // page it opens can never show two different numbers.
    'DesignDrawingsBreakdown',
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
    // Portfolio/project timeline — derived from Projects + Tasks, so any
    // mutation to either should invalidate it.
    'Gantt',
    // ── HRMS ──
    // Requisitions (roles + JDs) and candidates (their pipelines);
    // HrmsStats is the overview any hiring mutation can move.
    // Ask-the-Map conversations — saved threads the map's Ask tab lists,
    // reopens by URL, and appends to.
    'MapChat',
    // Public franchise enquiries awaiting the MD's yes/no.
    'Franchise',
    'Requisition',
    'Candidate',
    'HrmsStats',

    // ── WhatsApp notifications ──
    // The template mirror and the event map are admin-edited and rarely
    // change, so both are cached hard and invalidated only by their own
    // screen. Logs are their own tag because a test send adds a row without
    // touching either of the other two, and WhatsappSettings is separate
    // again so flipping the global switch does not refetch the log table.
    'WhatsappTemplate',
    'WhatsappEventMap',
    'WhatsappLog',
    'WhatsappSettings',

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
