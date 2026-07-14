import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal.jsx';
import { DynamicField } from './DynamicField.jsx';
import { SkeletonForm, SkLine } from '../../../components/ui/Skeletons.jsx';
import { useUploadMedia } from '../../../lib/queries.js';

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * A field with no gating `field` name is always visible. Otherwise it's
 * visible only when `values[showIf.field]` is one of `showIf.in` — drives the
 * Commercial Information type-specific fields purely from schema metadata.
 *
 * Checks `showIf?.field` rather than just `showIf` because Mongoose persists
 * an empty `{ in: [] }` subdocument for every field's `showIf` path (an array
 * path always gets its `[]` default), even fields that never declared one —
 * so `field.showIf` alone is truthy for every field, not just gated ones.
 */
function isVisible(field, values) {
  if (!field.showIf?.field) return true;
  return (field.showIf.in || []).includes(values[field.showIf.field]);
}

/**
 * Group a flat `masterDataSchema` into ordered sections, keyed by each field's
 * `section` metadata. Section order follows first appearance (after sorting by
 * `order`), so grouping stays fully data-driven — no hardcoded sections here.
 */
function groupBySection(schema) {
  const ordered = [...schema].sort((a, b) => (a.order || 0) - (b.order || 0));
  const sections = [];
  const byTitle = new Map();
  for (const field of ordered) {
    const title = field.section || 'Details';
    if (!byTitle.has(title)) {
      const group = { title, fields: [] };
      byTitle.set(title, group);
      sections.push(group);
    }
    byTitle.get(title).fields.push(field);
  }
  return sections;
}

/**
 * RecordFormModal — the Add/Edit form for a collection-mode stage (e.g. a
 * candidate Property). Renders `schema` grouped into labelled sections, single
 * column for mobile use, with two distinct actions:
 *   - Save Draft  → status 'draft'      (no required-field validation)
 *   - Submit      → status 'submitted'  (required fields enforced) + submittedAt
 *
 * Persistence is provided by the parent via `onSaveDraft` / `onSubmit`.
 *
 * `loading` covers the schema still being fetched (distinct from `saving`,
 * which covers a save already in flight) — while true, the body and footer
 * render as a SkeletonForm instead of flashing an empty form.
 */
export function RecordFormModal({
  open,
  onClose,
  schema = [],
  recordNoun = 'Property',
  recordNo = null,
  initialValues = null,
  onSaveDraft,
  onSubmit,
  submitLabel = 'Submit',
  saving = false,
  loading = false,
}) {
  const isEdit = Boolean(initialValues);
  const [values, setValues] = useState(() => ({ ...(initialValues || {}) }));
  const [errors, setErrors] = useState({});
  const upload = useUploadMedia();
  // 'draft' | 'submit' | null — which action is currently resolving pending
  // file uploads. Distinct from `saving` (the parent's record-persist step),
  // so the two phases of "select → preview → Save/Submit → upload → save"
  // each get their own visible state.
  const [activeAction, setActiveAction] = useState(null);
  const [uploadError, setUploadError] = useState('');

  const sections = useMemo(() => groupBySection(schema), [schema]);

  // Cancel / close without saving discards every not-yet-uploaded local
  // preview (picked file or recorded clip) — nothing lingers once the form
  // is gone. Reads the latest values via a ref so the unmount-only cleanup
  // below always sees what's actually in the form at close time.
  const valuesRef = useRef(values);
  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => () => {
    const fileFields = schema.filter((f) => f.type === 'file');
    for (const field of fileFields) {
      const raw = valuesRef.current[field.key];
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const entry of list) {
        if (entry?.pending && entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValue = (key, next) => {
    setValues((v) => {
      const updated = { ...v, [key]: next };
      // A field that just became hidden by this change (e.g. switching
      // Commercial Type away from "Rental") has its stale value cleared, so
      // an irrelevant value never gets silently submitted.
      for (const field of schema) {
        if (field.showIf?.field === key && !isVisible(field, updated)) {
          updated[field.key] = undefined;
        }
      }
      return updated;
    });
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const validateRequired = () => {
    const next = {};
    for (const field of schema) {
      if (field.required && isVisible(field, values) && isEmpty(values[field.key])) {
        next[field.key] = `${field.label} is required`;
      }
    }
    setErrors(next);
    return next;
  };

  /**
   * Upload any files the user has picked but not yet uploaded (FileField marks
   * them `pending: true`) — the deferred-upload workflow: select → preview →
   * Save Draft/Submit → upload → save. Reuses the same shared upload endpoint
   * FileField used to call directly on pick.
   */
  const resolvePendingUploads = async (vals) => {
    const fileFields = schema.filter((f) => f.type === 'file');
    const next = { ...vals };
    for (const field of fileFields) {
      const raw = next[field.key];
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!list.some((e) => e?.pending)) continue;

      const resolved = [];
      for (const entry of list) {
        if (!entry?.pending) { resolved.push(entry); continue; }
        const ref = await upload.mutateAsync({ file: entry.file });
        URL.revokeObjectURL(entry.previewUrl);
        resolved.push(ref);
      }
      next[field.key] = field.multiple ? resolved : (resolved[0] || null);
    }
    return next;
  };

  const handleDraft = async () => {
    // Drafts never block on required-field validation, but files still upload.
    setUploadError('');
    setActiveAction('draft');
    try {
      const resolved = await resolvePendingUploads(values);
      setValues(resolved);
      onSaveDraft?.({ values: resolved, status: 'draft' });
    } catch (err) {
      setUploadError(err?.response?.data?.message || err?.message || 'Failed to upload one or more files.');
    } finally {
      setActiveAction(null);
    }
  };

  const handleSubmit = async () => {
    const found = validateRequired();
    if (Object.keys(found).length) {
      const firstKey = schema.find((f) => found[f.key])?.key;
      if (firstKey) document.getElementById(`field-${firstKey}`)?.focus();
      return;
    }
    setUploadError('');
    setActiveAction('submit');
    try {
      const resolved = await resolvePendingUploads(values);
      setValues(resolved);
      onSubmit?.({ values: resolved, status: 'submitted', submittedAt: new Date().toISOString() });
    } catch (err) {
      setUploadError(err?.response?.data?.message || err?.message || 'Failed to upload one or more files.');
    } finally {
      setActiveAction(null);
    }
  };

  const busy = saving || activeAction != null;

  const footer = loading ? (
    <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
      <SkLine w={100} h={34} style={{ borderRadius: 8 }} />
      <SkLine w={90} h={34} style={{ borderRadius: 8 }} />
    </div>
  ) : (
    <div className="row gap-3" style={{ alignItems: 'center' }}>
      {activeAction && <span className="tiny muted">Uploading files…</span>}
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" onClick={handleDraft} disabled={busy}>
          {activeAction === 'draft' ? <span className="spinner" /> : 'Save Draft'}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={busy}>
          {activeAction === 'submit' || saving ? <span className="spinner" /> : submitLabel}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${isEdit ? 'Edit' : 'Add New'} ${recordNoun}`}
      subtitle={isEdit && recordNo ? recordNo : undefined}
      width={760}
      footer={footer}
    >
      {loading ? (
        <SkeletonForm sections={3} fieldsPerSection={3} />
      ) : (
        <div className="col gap-4">
          {uploadError && (
            <div className="sm" style={{ color: 'var(--danger)', padding: '8px 10px', border: '1px solid var(--danger)', borderRadius: 8 }}>
              {uploadError}
            </div>
          )}
          {sections.map((section) => (
            <section key={section.title} className="col gap-3">
              {/* Every section renders fully expanded, all at once — no
                  collapse/accordion state. A plain in-flow heading (not
                  sticky) so nothing stacks over or hides the fields below it. */}
              <div
                className="section-title"
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                {section.title}
              </div>
              {/* Compact 3-col grid on desktop, 2 on tablet, 1 on mobile (.form-grid).
                  Notes/textarea fields always take the full row width. */}
              <div className="form-grid">
                {section.fields.filter((field) => isVisible(field, values)).map((field) => (
                  <div
                    className={`field${field.type === 'textarea' ? ' form-grid-full' : ''}`}
                    key={field.key}
                    style={{ marginBottom: 0 }}
                  >
                    <label className="label" htmlFor={`field-${field.key}`}>
                      {field.label}
                      {field.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                    </label>
                    <DynamicField
                      field={field}
                      value={values[field.key]}
                      onChange={(next) => setValue(field.key, next)}
                      error={errors[field.key]}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default RecordFormModal;
