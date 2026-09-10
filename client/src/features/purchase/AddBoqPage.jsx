import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Save, Send } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkeletonForm } from '../../components/ui/Skeletons.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { DynamicField } from '../projects/records/DynamicField.jsx';
import { groupBySection, isVisible } from '../projects/records/RecordFormModal.jsx';
import { seedFor } from '../../lib/recordGroups.js';
import { BOQ_STAGE } from '../projects/orderTracking.jsx';
import { useProjects, useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useCreateRecord } from '../../app/api/recordsApi.js';
import { purchaseParentPath } from './config/purchase.routes.config.js';

/**
 * Add one BOQ line, on its own page.
 *
 * A BOQ line IS a purchase order (stage p13 — see purchase.routes.config.js),
 * so the thing this page files is the same record the Purchase Orders sheet
 * lists and the order/document/invoice pages then act on. It is the Phase 1
 * "Add New Property" flow at a Purchase address: pick where it belongs, fill
 * the phase's own form, and the new line is at the top of the list behind you.
 *
 * WHY IT COMPOSES RATHER THAN REUSES. RecordFormModal is the same form inside
 * a <Modal>, and the modal is the whole component — there is no page-shaped
 * export to borrow. So this renders the pieces the modal itself renders
 * (`groupBySection`, `isVisible`, `DynamicField`), which is the same
 * composition CommercialRecordReportPage already uses read-only. The form
 * therefore follows the template, not a second copy of the field list here.
 *
 * WHAT IS DELIBERATELY NOT COPIED. The modal's deferred file-upload pipeline:
 * no non-tracker p13 field is a FILE, so there is nothing on this form to
 * upload. Add one to the template and this page needs that pipeline too.
 */

/** Same rule as RecordFormModal's — a wide field takes the whole row. */
const WIDE_FIELD_TYPES = new Set(['textarea', 'file', 'location', 'multiselect', 'layout']);
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

export function AddBoqPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  /* The centre arrives from the list's own filter when one was picked, so
     "Add BOQ" from a chosen centre never asks again. */
  const [projectId, setProjectId] = useState(params.get('project') || '');
  const [boqKey, setBoqKey] = useState('');
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');

  const { data: projectsResp, isLoading: projectsLoading } = useProjects({ limit: 200, sort: '-createdAt' });
  const projectOptions = projectsResp?.data || [];

  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  const stage = project?.stages?.find((s) => s.key === BOQ_STAGE);
  const templateStage = template?.stages?.find((s) => s.key === BOQ_STAGE);
  const schema = useMemo(() => templateStage?.masterDataSchema || [], [templateStage]);
  const recordNoun = stage?.recordNoun || 'BOQ Item';

  const createRecord = useCreateRecord(projectId, BOQ_STAGE);

  /**
   * Which of the named BOQs this line goes into.
   *
   * `boq_type` is a `tracker` field — it stays writable after approval so that
   * lines filed before the seven BOQs existed can still be filed — and the
   * form hides every tracker field. On a phase page the list you pressed "Add
   * a line" inside answers it (recordGroups → seedFor). This page has no such
   * list, so it asks here; without it every line added from Purchase would
   * land in "Not assigned to a BOQ".
   */
  const boqGroups = useMemo(
    () => (templateStage?.recordGroups || []).filter((g) => seedFor(g)),
    [templateStage],
  );

  /* Same filter as the modal: tracker fields belong to the Phase 6 tracker,
     which writes them after approval through its own endpoint. */
  const sections = useMemo(
    () => groupBySection(schema.filter((f) => f.label !== "Doer's Notes" && !f.tracker))
      .filter((s) => s.fields.length),
    [schema],
  );

  /* A different centre can be on a different template, so the answers to the
     old form cannot carry over to the new one. */
  useEffect(() => {
    setValues({});
    setErrors({});
    setSaveError('');
    setBoqKey('');
  }, [projectId]);

  /* Fields that arrive already answered (a template `defaultValue`) — only
     ever into an empty field, never over something already typed. */
  const seededFor = useRef(null);
  useEffect(() => {
    if (!schema.length || seededFor.current === templateId) return;
    seededFor.current = templateId;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const f of schema) {
        if (f.defaultValue && isEmpty(next[f.key])) { next[f.key] = f.defaultValue; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [schema, templateId]);

  /** Pre-filled from a field that offers it (the rate master fills Rate). */
  const fillValues = (patch) => {
    setValues((prev) => ({ ...prev, ...patch }));
    setErrors((e) => {
      const cleared = { ...e };
      for (const k of Object.keys(patch)) cleared[k] = undefined;
      return cleared;
    });
  };

  const setValue = (key, next) => {
    setValues((v) => {
      const updated = { ...v, [key]: next };
      for (const field of schema) {
        // A field this change just hid loses its stale value, so an
        // irrelevant answer is never submitted underneath the form.
        if (field.showIf?.field === key && !isVisible(field, updated)) {
          updated[field.key] = undefined;
        }
        // `productOf: ['quantity', 'rate']` — Amount follows Quantity × Rate
        // and stays editable: a negotiated total holds until one of its
        // inputs next changes. Left alone while either is blank, so clearing
        // Quantity cannot write a silent 0 into a money column.
        if (Array.isArray(field.productOf) && field.productOf.includes(key)) {
          const parts = field.productOf.map((k) => (k === key ? next : updated[k]));
          const nums = parts.map((x) => (x === '' || x == null ? NaN : Number(x)));
          if (nums.every((n) => Number.isFinite(n))) {
            updated[field.key] = nums.reduce((a, b) => a * b, 1);
          }
        }
      }
      return updated;
    });
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const validateRequired = () => {
    const next = {};
    for (const field of schema) {
      if (field.tracker) continue;
      if (field.required && isVisible(field, values) && isEmpty(values[field.key])) {
        next[field.key] = `${field.label} is required`;
      }
    }
    setErrors(next);
    return Object.keys(next).length > 0;
  };

  /* Draft saves what is there; Submit enforces the form's required fields —
     the same two doors the modal offers, and the same meaning. */
  const save = async (status) => {
    setSaveError('');
    if (!projectId) { setSaveError('Choose the centre this BOQ line belongs to.'); return; }
    if (status === 'submitted' && validateRequired()) return;

    const group = boqGroups.find((g) => g.key === boqKey);
    const seed = group ? seedFor(group) : null;

    try {
      await createRecord.mutateAsync({ values: { ...(seed || {}), ...values }, status });
      flashSuccess(status === 'draft' ? `${recordNoun} saved as a draft` : `${recordNoun} added`);
      navigate(`/purchase/orders?project=${projectId}`);
    } catch (err) {
      // Kept on the page with the values intact — a lost form is the one
      // thing the person cannot get back.
      setSaveError(err?.data?.message || err?.message || 'Could not save this line. Try again.');
    }
  };

  const loadingForm = Boolean(projectId) && (projectLoading || templateLoading);

  return (
    <>
      <Topbar
        title={`Add ${recordNoun}`}
        /* From the config's own `parentKey`, so moving this screen under a
           different parent moves its back arrow with it. */
        back={purchaseParentPath('purchase-order-new')}
        subtitle="A BOQ line is a purchase order — it lands on the Purchase Orders sheet."
      />
      <div className="content">
        <div className="col gap-3 fade-in">
          <div className="card">
            <div className="card-body col gap-4">
              {/* Where the line belongs. Both answers are needed before the
                  form means anything, so they lead rather than sit inside it. */}
              <div className="form-grid">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label" htmlFor="boq-centre">
                    Centre<span style={{ color: 'var(--danger)' }}> *</span>
                  </label>
                  <select
                    id="boq-centre"
                    className="select"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    disabled={projectsLoading}
                  >
                    <option value="">{projectsLoading ? 'Loading centres…' : 'Select a centre…'}</option>
                    {projectOptions.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}{p.city ? ` · ${p.city}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {boqGroups.length > 0 && (
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="boq-which">BOQ</label>
                    <select
                      id="boq-which"
                      className="select"
                      value={boqKey}
                      onChange={(e) => setBoqKey(e.target.value)}
                    >
                      <option value="">Not assigned to a BOQ</option>
                      {boqGroups.map((g) => (
                        <option key={g.key} value={g.key}>{g.label}</option>
                      ))}
                    </select>
                    <span className="sm muted">
                      Lines of one BOQ are planned, approved and ordered together.
                    </span>
                  </div>
                )}
              </div>

              {saveError && <div className="pt-alert pt-alert--bad" role="alert">{saveError}</div>}

              {!projectId ? (
                <EmptyState
                  icon={ClipboardList}
                  title="Choose a centre first"
                  hint="The form below is that centre's own BOQ form, so it cannot be shown until one is picked."
                />
              ) : loadingForm ? (
                <SkeletonForm sections={2} fieldsPerSection={4} />
              ) : !stage || !sections.length ? (
                <EmptyState
                  icon={ClipboardList}
                  title="This centre has no BOQ phase"
                  hint="Its template does not carry Phase 5 (BOQ & Budget), so there is no BOQ line to add here."
                />
              ) : (
                sections.map((section) => (
                  <div className="col gap-2" key={section.title}>
                    <div
                      className="section-title"
                      style={{ padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                    >
                      {section.title}
                    </div>
                    <div className="form-grid">
                      {(() => {
                        const shown = section.fields.filter((field) => isVisible(field, values));
                        return shown.map((field) => (
                          <div
                            className={`field${WIDE_FIELD_TYPES.has(field.type) || shown.length === 1 ? ' form-grid-full' : ''}`}
                            key={field.key}
                            style={{ marginBottom: 0 }}
                          >
                            {field.label && (
                              <label className="label" htmlFor={`field-${field.key}`}>
                                {field.label}
                                {field.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                              </label>
                            )}
                            <DynamicField
                              field={field}
                              value={values[field.key]}
                              onChange={(next) => setValue(field.key, next)}
                              onFill={fillValues}
                              error={errors[field.key]}
                              formValues={values}
                              /* Lets `optionsFromStage` fields load — Vendor
                                 reads the p12 vendor master through this. */
                              projectId={projectId}
                            />
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                ))
              )}

              <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-subtle"
                  onClick={() => navigate('/purchase/orders')}
                  disabled={createRecord.isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => save('draft')}
                  disabled={!projectId || createRecord.isPending}
                >
                  <Save size={14} /> Save Draft
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => save('submitted')}
                  disabled={!projectId || createRecord.isPending}
                >
                  {createRecord.isPending ? <span className="spinner" /> : <Send size={14} />}
                  {createRecord.isPending ? 'Saving…' : `Add ${recordNoun}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default AddBoqPage;
