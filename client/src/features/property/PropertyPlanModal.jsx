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
  /**
   * THE RECORD THAT ACTUALLY HOLDS THE PLAN — not whichever came back first.
   *
   * THE BUG: this was `[0]`. A project can carry more than one p20 record,
   * because approving the LOI opens an EMPTY draft so the assigned person
   * has something in My Tasks, and the plan somebody later files is a
   * second row. One project in the live data has exactly that pair: a draft
   * with no values and a submitted record with all of them.
   *
   * When `[0]` landed on the empty draft, "Edit project" opened a blank
   * form on a property whose plan was filed — and because `save()` writes
   * to this same record, the correction would have gone into the draft and
   * left the real plan untouched. Reading the wrong row is a display bug;
   * writing to it is a data one.
   *
   * Order of preference: a plan somebody committed to, then anything with
   * values in it, then whatever exists so a blank form still opens.
   */
  const existing = useMemo(() => {
    const all = plans?.data || plans || [];
    const hasValues = (r) => Object.keys(r?.values || {}).length > 0;
    return all.find((r) => ['submitted', 'approved', 'locked'].includes(r.status))
      || all.find(hasValues)
      || all[0]
      || null;
  }, [plans]);

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
      /**
       * REMOUNTED ONCE THE PLAN IS ACTUALLY HERE.
       *
       * THE BUG: RecordFormModal seeds its form state in a `useState`
       * initialiser, which React runs ONCE on mount. This modal mounts it
       * straight away and fetches the plan afterwards, so on the first
       * render `initialValues` is still empty — and the seventeen stored
       * values that arrive a moment later never reach the inputs. Pressing
       * "Edit project" on a property whose plan was filed opened a blank
       * form, and saving it would have written the blanks back.
       *
       * Keying on the record and on whether the schema has landed forces a
       * fresh mount at the point both are known, so the initialiser runs
       * with the real values. The spinner below still covers the wait.
       */
      key={`${existing?._id || 'new'}:${schema.length}`}
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
