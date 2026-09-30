import { useMemo } from 'react';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useCreateRecord, useUpdateRecord } from '../../app/api/recordsApi.js';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';

const STAGE_CLOSURE = 'p3';

/**
 * A CLOSURE DOCUMENT'S OWN FORM, OPENED WHERE THE ROW IS.
 *
 * Pressing "Open form" on Step 5 used to navigate to
 * `/projects/:id/commercial-finalization?form=loi` — a different module, with
 * its own header, its own six module cards and its own back button. The
 * reader went to fill one field and arrived somewhere they had to find their
 * way out of, and the queue they were working through was gone: filing six
 * documents meant six round trips through a page that has nothing to do with
 * the sheet.
 *
 * The FORM was never the problem — it is the same `RecordFormModal` the
 * project screen renders, off the same template schema, saving through the
 * same two mutations. Only the journey to it was. So this lifts the form out
 * of that page and opens it over the row instead. Nothing about how a
 * document is stored, validated or submitted changes; the project screen
 * keeps working exactly as it did, for anyone who starts from there.
 *
 * It fetches its own template because the queue row does not carry one —
 * the schema belongs to the project's template, and Step 5 lists properties
 * from many projects.
 */
export function ClosureFormModal({ property, docKey, doc, onClose, onSaved }) {
  const projectId = property?.projectId || null;
  const { data: project } = useProject(projectId || undefined);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  const create = useCreateRecord(projectId, STAGE_CLOSURE);
  const update = useUpdateRecord(projectId, STAGE_CLOSURE);

  /* The one of the six this row is for. Found by key rather than by index —
     a template that gains or reorders its documents must not silently open
     the wrong form. */
  const type = useMemo(() => {
    const stage = template?.stages?.find((st) => st.key === STAGE_CLOSURE);
    return (stage?.assessmentTypes || []).find((t) => t.key === docKey) || null;
  }, [template, docKey]);

  const save = async (values, status) => {
    /**
     * EDIT WHAT EXISTS, CREATE WHAT DOES NOT — and never edit an approved
     * record. Same rule as the project screen's `saveAssessment`: once a
     * document is approved, a change has to come back through a new
     * submission so the approval it carries still means something.
     */
    if (doc?.id && doc.status !== 'approved') {
      await update.mutateAsync({ id: doc.id, values, status });
    } else {
      await create.mutateAsync({
        values,
        status,
        assessmentType: docKey,
        parentRecordId: property.recordId,
      });
    }
    onSaved?.(status);
    onClose?.();
  };

  if (!projectId) return null;

  return (
    <RecordFormModal
      open
      onClose={onClose}
      schema={type?.masterDataSchema || []}
      recordNoun={type?.name || 'Document'}
      /* The form names the fields; only the row knows which SITE they are
         being filled for, and on a sheet of six properties that is the fact
         most easily lost between pressing a button and typing a number. */
      subtitle={[property.title, property.city].filter(Boolean).join(' · ')}
      initialValues={doc?.values || null}
      projectId={projectId}
      submitLabel="Submit"
      saving={doc?.id ? update.isPending : create.isPending}
      loading={templateLoading}
      onSubmit={({ values }) => save(values, 'submitted')}
    />
  );
}

export default ClosureFormModal;
