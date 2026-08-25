import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { isValidId } from '../../lib/id.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * Templates domain — Phase 8. Same pattern as the other domain files.
 *
 * Note: the server (`template.routes.js`) also exposes `/publish` — it has no
 * corresponding hook here and no client code calls it, so it remains
 * unmigrated. `/archive` and `/clone` are wired below (Duplicate/Archive
 * actions on TemplatesPage).
 */
export const templatesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getTemplates: build.query({
      query: (params) => ({ url: `/pms/templates${qs(params)}`, method: 'GET' }),
      // Old hook returned the full envelope ({data, meta}) as `data` — preserved.
      transformResponse: (payload, meta) => ({ data: payload, meta }),
      providesTags: (result) => [
        { type: 'Template', id: 'LIST' },
        ...((result?.data) || []).map((t) => ({ type: 'Template', id: t._id })),
      ],
    }),

    getTemplate: build.query({
      query: (id) => ({ url: `/pms/templates/${id}`, method: 'GET' }),
      // The client-flow template is a very large document (every stage,
      // schema and task), and every TaskBrief needs it. At the default
      // 30s it was re-downloaded on nearly every task open — the visible
      // 10-15s wait before "Submit Drawing" appeared. Templates change
      // rarely; hold them for the session.
      keepUnusedDataFor: 3600,
      providesTags: (_result, _error, id) => [{ type: 'Template', id }],
    }),

    getDefaultTemplate: build.query({
      query: () => ({ url: '/pms/templates/default', method: 'GET' }),
      providesTags: [{ type: 'Template', id: 'DEFAULT' }],
    }),

    createTemplate: build.mutation({
      query: (body) => ({ url: '/pms/templates', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'Template', id: 'LIST' }],
    }),

    updateTemplate: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/templates/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Template', id: 'LIST' }, { type: 'Template', id }],
    }),

    deleteTemplate: build.mutation({
      query: (id) => ({ url: `/pms/templates/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Template', id: 'LIST' }, { type: 'Template', id: 'DEFAULT' }, { type: 'Template', id }],
    }),

    setDefaultTemplate: build.mutation({
      query: (id) => ({ url: `/pms/templates/${id}/default`, method: 'POST' }),
      // The server demotes whichever template previously held the default
      // flag, so every list entry and the DEFAULT pointer both need refreshing.
      invalidatesTags: [{ type: 'Template', id: 'LIST' }, { type: 'Template', id: 'DEFAULT' }],
    }),

    archiveTemplate: build.mutation({
      query: (id) => ({ url: `/pms/templates/${id}/archive`, method: 'POST' }),
      // Archiving force-clears isDefault server-side, so the DEFAULT pointer
      // needs refreshing alongside the list.
      invalidatesTags: (_result, _error, id) => [{ type: 'Template', id: 'LIST' }, { type: 'Template', id: 'DEFAULT' }, { type: 'Template', id }],
    }),

    cloneTemplate: build.mutation({
      query: (id) => ({ url: `/pms/templates/${id}/clone`, method: 'POST' }),
      invalidatesTags: [{ type: 'Template', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetTemplatesQuery,
  useGetTemplateQuery,
  useGetDefaultTemplateQuery,
  useCreateTemplateMutation,
  useUpdateTemplateMutation,
  useDeleteTemplateMutation,
  useSetDefaultTemplateMutation,
  useArchiveTemplateMutation,
  useCloneTemplateMutation,
} = templatesApi;

/* ---------- Old-name read wrappers ---------- */

/** `options` is RTK Query's own ({ skip, pollingInterval, … }) — passed straight
 *  through so a caller can avoid the request entirely (e.g. the New Project
 *  modal, which only needs the list if the user chooses to pick a template). */
export const useTemplates = (params, options) => useGetTemplatesQuery(params, options);

export const useTemplate = (id) => useGetTemplateQuery(id, { skip: !isValidId(id) });

/** `data` is null when no template is set as default. */
export const useDefaultTemplate = () => useGetDefaultTemplateQuery();

/* ---------- Old-name mutation wrappers ---------- */

export const useCreateTemplate = () => useCompatMutation(useCreateTemplateMutation);

/** `useUpdateTemplate(id)` — mutate/mutateAsync take the patch body only, id bound here. */
export const useUpdateTemplate = (id) => {
  const compat = useCompatMutation(useUpdateTemplateMutation);
  return {
    ...compat,
    mutate: (body, opts) => compat.mutate({ id, ...body }, opts),
    mutateAsync: (body) => compat.mutateAsync({ id, ...body }),
  };
};

export const useDeleteTemplate = () => useCompatMutation(useDeleteTemplateMutation);

export const useSetDefaultTemplate = () => useCompatMutation(useSetDefaultTemplateMutation);

export const useArchiveTemplate = () => useCompatMutation(useArchiveTemplateMutation);

export const useCloneTemplate = () => useCompatMutation(useCloneTemplateMutation);

export default templatesApi;
