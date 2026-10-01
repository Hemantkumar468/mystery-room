import { useMemo, useState } from 'react';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords, useCreateRecord, useUpdateRecord } from '../../app/api/recordsApi.js';

/** Phase 4 — "Project Planning & Games". Its games, dates and budget live here. */
const PLAN_STAGE = 'p20';

/**
 * The plan for ONE property: its games, its opening date, its trial run.
 *
 * WHY THIS EXISTS RATHER THAN A LINK. Step 4's button used to navigate to
 * `/projects/:id?stage=p20`, which opens the whole phase — every panel, every
 * task, the stage overview — and leaves the reader to find the form and work
 * out which property it is about. They arrived at a page when what they asked
 * for was a form. Worse, it threw away the queue: the filters, the page they
 * were on, and the other twelve properties they were working through.
 *
 * So the form opens here, over the row it belongs to, already carrying the
 * property. Saving returns them to exactly where they were, with the row's
 * Games and Opening columns filled in.
 *
 * IT IS THE SAME FORM, not a copy. The schema comes from the project's own
 * template (`p20.masterDataSchema`), so a field added to Phase 4 appears here
 * with no second place to edit — and it renders through RecordFormModal, the
 * same component the phase page uses, so the pickers, the uploads and the AI
 * draft all behave identically.
 */
export function PropertyPlanModal({ row, onClose, onSaved, subtitle = null }) {
  const projectId = row?.projectId;

  const { data: project } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  const stage = template?.stages?.find((s) => s.key === PLAN_STAGE) || null;
  const schema = stage?.masterDataSchema || [];

  /* The plan is filed per project — an outlet has one set of games however
     many properties were looked at on the way. Read live rather than trusting
     the row's snapshot, because the form is about to write to it. */
  const { data: plans, isLoading: plansLoading } = useStageRecords(projectId, PLAN_STAGE, {}, {
    enabled: Boolean(projectId),
  });
  const existing = (plans?.data || plans || [])[0] || null;

  const create = useCreateRecord(projectId, PLAN_STAGE);
  const update = useUpdateRecord(projectId, PLAN_STAGE);
  const [error, setError] = useState(null);

  /**
   * What the form starts with on a NEW plan.
   *
   * The property is not a field somebody should retype — it is the reason
   * this form is open. Anything the schema does not declare is dropped by
   * RecordFormModal, so seeding generously is safe.
   */
  const seed = useMemo(() => ({
    property_name: row?.title || '',
    city: row?.city || '',
    locality: row?.locality || '',
    carpet_area: row?.areaSqft ?? '',
    /* The area the plan actually asks for. It is the same figure under a
       different key, and typing it again is how the two come to disagree. */
    confirmed_area: row?.areaSqft ?? '',
  }), [row]);

  /* RecordFormModal hands over the whole record body — `{ values, status }`,
     not the values alone. Wrapping it again filed everything one level deep
     under `values.values`, where no field on the plan could read it. */
  const save = async (payload) => {
    setError(null);
    try {
      const body = { values: payload.values, status: payload.status };
      if (existing) await update.mutateAsync({ id: existing._id, ...body });
      else await create.mutateAsync(body);
      onSaved?.();
      onClose();
    } catch (err) {
      /* The dialog stays open on failure — the values somebody just typed are
         the one thing they cannot get back. */
      setError(err?.response?.data?.message || 'Could not save the plan.');
    }
  };

  const loading = templateLoading || plansLoading;

  return (
    <RecordFormModal
      open
      onClose={onClose}
      loading={loading}
      schema={schema}
      recordNoun={stage?.recordNoun || 'Project Plan'}
      subtitle={subtitle}
      projectId={projectId}
      initialValues={existing?.values || null}
      seedValues={seed}
      /* The same word the button that opened it uses, and the same word the
         step is called. It said "Create plan" while the row said "Plan it"
         and the step said "Project Creation" — three names for one thing. */
      /* The LOI hand-off creates an empty draft so the assigned person has a
         task. Keep the user-facing action as Create Project until this draft
         is actually submitted; stored values still override the seed. */
      submitLabel={['submitted', 'approved', 'locked'].includes(existing?.status) ? 'Update project' : 'Create project'}
      saving={create.isPending || update.isPending}
      error={error}
      onSaveDraft={save}
      onSubmit={save}
    />
  );
}

export default PropertyPlanModal;
