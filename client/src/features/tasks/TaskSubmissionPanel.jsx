import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Pencil, FileText, ArrowRight } from 'lucide-react';
import { PropertyReportSheet } from '../projects/PropertyReportSheet.jsx';

/* The phase a filed form belongs to, as the step key that names its printout.
   Only the three phases whose forms a doer actually fills are listed; anything
   else falls back to the capture form rather than inventing a name. */
const MODULE_BY_STAGE = {
  p1: 'property-capture',
  p2: 'property-assessment',
  p3: 'property-commercial',
};
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';

/**
 * WHAT THE DOER ACTUALLY FILLED IN, on the task that asked for it.
 *
 * The task page said a form had been submitted and stopped there: to read a
 * single answer you reopened the form, which is the one thing a reader who is
 * only reading must not be made to do — an open form invites an edit, and an
 * accidental keystroke in a filed assessment is somebody's professional
 * judgement changed by mistake. So the answers are printed here, as answers.
 *
 * IT IS THE SAME SHEET THE PROPERTY REPORT USES. `PropertyReportSheet` renders
 * any record against any schema — status, audit trail, the template's own
 * sections in the template's own order — so the task page, the property page
 * and the property queue all show a filed form identically, and a field added
 * to a template appears in all three with nothing to change.
 *
 * AND IT WORKS FOR EVERY FORM, not only assessments. The record is found the
 * way the server finds it when a submit completes a task (see
 * record.service.js#completeTaskForForm): same project, same stage, same form
 * key, and — where the phase files one form per property — the same property.
 * Phase 1's capture, Phase 2's four assessments, Phase 3's six documents and
 * Phase 4's plan all resolve through that one rule.
 *
 * TWO ACTIONS, AND THE DIFFERENCE BETWEEN THEM IS THE POINT. Print / Save as
 * PDF hands somebody the filed answers without touching them. Edit reopens the
 * real form — the same one the button above opens — because correcting a
 * mistake has to go through the form's own validation and its own audit trail,
 * not through a second editor grown here.
 */
const FORMLESS = new Set(['', null, undefined]);

/** Print the sheet, and only the sheet — see PropertyDetailsModal#printDoc for
 *  why this cannot be done with a print stylesheet on the page itself. */
function printDoc(node, title) {
  if (!node) return;
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((el) => el.outerHTML)
    .join('');
  const win = window.open('', '_blank', 'width=960,height=1000');
  if (!win) return; // pop-up blocked — nothing is lost, the panel stays
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}`
    + '<style>body{margin:0;background:#fff}.no-print{display:none!important}</style></head><body>'
    + `${node.innerHTML}</body></html>`,
  );
  win.document.close();
  const go = () => { win.focus(); win.print(); };
  if (win.document.readyState === 'complete') setTimeout(go, 350);
  else win.addEventListener('load', () => setTimeout(go, 350));
}

export function TaskSubmissionPanel({ task, projectId, formLabel }) {
  const sheetRef = useRef(null);

  const stageKey = task?.stageKey;
  const formKey = task?.formKey || '';
  /* A task with no form has nothing filed against it — a site visit, a phone
     call, a decision taken elsewhere. Those tasks are ticked, not filled in. */
  const isForm = Boolean(task?.appPath) && !FORMLESS.has(formKey);

  const { data: records, isLoading: recordsLoading } = useStageRecords(
    projectId,
    stageKey,
    { assessmentType: formKey },
    { enabled: Boolean(isForm && projectId && stageKey) },
  );

  const { data: project } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  if (!isForm) return null;

  const list = Array.isArray(records) ? records : (records?.data || []);
  /**
   * The record this task's form produced.
   *
   * Where a phase files one form per property (Phase 2's assessments), the
   * property is what tells four otherwise identical records apart; where it
   * does not (Phase 3's documents are per project), the newest filed one is
   * the answer. Same two rules, same order, as the server's own matcher.
   */
  const subject = task?.subjectRecord && String(task.subjectRecord._id || task.subjectRecord);
  /**
   * NO FALLBACK WHEN THE TASK NAMES A PROPERTY.
   *
   * Phase 2 opens one task per property per form, so "the financial
   * assessment on this project" is four different documents. Falling back to
   * the newest one when this task's own is missing printed ANOTHER property's
   * answers under this task's heading — a form that had not been filled in
   * reading as filled, with somebody else's numbers. No match means nothing
   * filed, and that is what it says.
   */
  const mine = subject
    ? list.filter((r) => String(r.parentRecordId?._id || r.parentRecordId || '') === subject)
    : list;
  const record = [...mine]
    .sort((a, b) => new Date(b.submittedAt || b.updatedAt || 0) - new Date(a.submittedAt || a.updatedAt || 0))[0] || null;

  const stage = template?.stages?.find((s) => s.key === stageKey) || null;
  /* p2/p3 keep a schema per form; p1/p20 have one for the whole stage. */
  const schema = stage?.assessmentTypes?.find((a) => a.key === formKey)?.masterDataSchema
    || stage?.masterDataSchema
    || [];

  const loading = recordsLoading || templateLoading;
  const title = formLabel || task?.title || 'Submitted form';

  return (
    <section className="tsub">
      <header className="tsub-head no-print">
        <span className="tsub-title">
          <FileText size={14} aria-hidden /> What was filed
        </span>
        <span className="tsub-actions">
          {/* Reading and changing are different acts, and the buttons say so.
              Edit goes to the form itself — the record's own validation and
              audit trail live there, not here. */}
          {task.appPath && (
            <Link className="btn btn-ghost btn-sm" to={task.appPath}>
              <Pencil size={13} aria-hidden /> {record ? 'Edit the form' : 'Open the form'}
            </Link>
          )}
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            disabled={!record || loading}
            onClick={() => printDoc(sheetRef.current, `${title} — filed form`)}
          >
            <Printer size={13} aria-hidden /> Print / Save as PDF
          </button>
        </span>
      </header>

      {loading ? (
        <p className="tsub-empty">Fetching what was filed…</p>
      ) : !record ? (
        /* NOT FILED IS A REAL STATE, and it is said rather than shown as an
           empty sheet — an empty sheet reads as a form that failed to load. */
        <p className="tsub-empty">
          Nothing has been filed against this task yet.
          {task.appPath && (
            <Link className="tsub-empty-link" to={task.appPath}>
              Open {title} <ArrowRight size={12} aria-hidden />
            </Link>
          )}
        </p>
      ) : !schema.length ? (
        <p className="tsub-empty">
          This form has been filed, but its template no longer describes the fields, so there is
          nothing to lay out. Open the form to read it.
        </p>
      ) : (
        <div ref={sheetRef}>
          <PropertyReportSheet
            record={record}
            schema={schema}
            /* WHICH FORM THE DOER FILLED, named by the phase it belongs to —
               p1 is a capture, p2 an assessment, p3 a commercial document. The
               panel knows the stage already; without this every filed form
               printed as a "Property Capture Form" whatever it actually was. */
            module={MODULE_BY_STAGE[stageKey] || 'property-capture'}
            heading={title}
            subheading={`${task.code || ''}${task.code && project?.name ? ' · ' : ''}${project?.name || ''}`.trim() || 'Filed form'}
            style={{ background: 'transparent', border: 0, maxWidth: 'none', margin: 0, padding: 0 }}
          />
        </div>
      )}
    </section>
  );
}

export default TaskSubmissionPanel;
