import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal.jsx';
import { DynamicField } from './DynamicField.jsx';
import { SkeletonForm, SkLine } from '../../../components/ui/Skeletons.jsx';
import { Avatar } from '../../../components/ui/primitives.jsx';
import { useUploadMedia } from '../../../app/api/recordsApi.js';
import { fmtDateTime } from '../../../lib/format.js';

function MetaTile({ label, value, tone }) {
  if (value == null || value === '') return null;
  return (
    <div className="col gap-1" style={{ minWidth: 120 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value}</span>
    </div>
  );
}

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** India default dial code prefilled into empty phone fields. */
const PHONE_PREFIX = '+91 ';

/**
 * A text field that holds a phone number — matched on its machine key or label
 * (e.g. owner_phone, broker_phone, "Owner Phone", "Mobile"). Used to prefill
 * the +91 dial code so the user only types the local number.
 */
const isPhoneField = (field) =>
  field?.type !== 'file'
  && /(phone|mobile|whatsapp|contact_no|contact_number)/i.test(`${field?.key || ''} ${field?.label || ''}`);

/**
 * Normalise a phone field's value to the fixed "+91 " prefix followed by at
 * most 10 local digits. The prefix is sticky (re-added even if the user tries
 * to delete it) and anything beyond 10 digits is dropped, so a phone number can
 * never exceed 10 digits.
 */
const formatPhone = (raw) => {
  const s = String(raw ?? '');
  const local = s.startsWith(PHONE_PREFIX) ? s.slice(PHONE_PREFIX.length) : s.replace(/^\+?91[\s-]*/, '');
  const digits = local.replace(/\D/g, '').slice(0, 10);
  return PHONE_PREFIX + digits;
};

/** Unit options for a measurement field. Area-type fields measure surface,
 * length-type fields (frontage/height/width/…) measure distance, so each gets
 * the units that make sense for it. */
const AREA_UNITS = ['sq.ft', 'sq.m', 'sq.yd', 'acre'];
const LENGTH_UNITS = ['ft', 'inch', 'm', 'cm'];

/** The unit list a numeric measurement field should offer, or null if the
 * field isn't a measurement (so it gets no unit selector). The chosen unit is
 * stored next to the value under `<key>_unit`. */
const unitOptionsFor = (field) => {
  if (field?.type !== 'number') return null;
  const hay = `${field?.key || ''} ${field?.label || ''}`.toLowerCase();
  if (!/(area|frontage|height|width|depth|length|ceiling|road|carpet|built|super|plot|saleable|floor)/.test(hay)) return null;
  const isLength = /(frontage|height|width|depth|length|ceiling|road)/.test(hay);
  return isLength ? LENGTH_UNITS : AREA_UNITS;
};

/** Companion key holding a measurement field's unit, e.g. carpet_area → carpet_area_unit. */
const unitKeyOf = (fieldKey) => `${fieldKey}_unit`;

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
export function isVisible(field, values) {
  if (!field.showIf?.field) return true;
  return (field.showIf.in || []).includes(values[field.showIf.field]);
}

/**
 * Field types whose control is inherently wide — a file dropzone, a map
 * picker, a multi-select chip list or a paragraph box. Squeezed into half a
 * row they either clip or wrap into something unreadable, so they always take
 * the full width.
 */
const WIDE_FIELD_TYPES = new Set(['textarea', 'file', 'location', 'multiselect']);

/**
 * Should this field span the whole row?
 *
 * Wide types always do. So does the only field in its section: several
 * sections hold exactly one entry — every module's "Documents" is a lone file
 * upload, and Commercial Approvals' "Details" is a single select — and a lone
 * half-width box beside an empty half reads as a rendering fault rather than a
 * deliberate layout.
 */
const fullWidthField = (field, fieldsInSection) =>
  WIDE_FIELD_TYPES.has(field.type) || fieldsInSection === 1;

/**
 * Group a flat `masterDataSchema` into ordered sections, keyed by each field's
 * `section` metadata. Section order follows first appearance (after sorting by
 * `order`), so grouping stays fully data-driven — no hardcoded sections here.
 */
export function groupBySection(schema) {
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
 *
 * `readOnly` renders the same schema-driven sections in View mode instead of
 * Edit mode: every DynamicField degrades to its read-only rendering (see
 * DynamicField), Save Draft/Submit are replaced by Close (plus whichever of
 * Edit/Approve/Reject the parent opts into — see below), and two optional
 * blocks render around the fields —
 *   - `meta`: submission facts (type, submission #, submitted by/on, status,
 *     decision, rejection reason) shown above the form.
 *   - `activity`: this record's own activity-log entries, shown below the
 *     form as its Activity History.
 * This is the same component Fill/Edit uses, just switched into a display
 * mode — the field list can never drift between "what you submitted" and
 * "what you see back", because it's the exact same schema/values render path.
 *
 * There's no separate Actions column in the records table anymore — View is
 * just clicking the row, and Edit/Approve/Reject (`onEdit`/`onApprove`/
 * `onReject`, each optional) live in this View mode's footer instead, so a
 * record's available actions are decided in exactly one place. The parent
 * passes a handler only when that action should be offered (e.g. `onEdit`
 * omitted once a record is Approved, `onApprove`/`onReject` omitted unless
 * the viewer can decide and the record is still Submitted).
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
  readOnly = false,
  meta = null,
  activity = null,
  onEdit = null,
  onApprove = null,
  onReject = null,
  decidePending = false,
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

  // Hide the "Doer's Notes" field everywhere it appears, and drop its section
  // if that leaves it empty — display-only, so no template/DB change needed.
  const sections = useMemo(
    () => groupBySection(schema.filter((f) => f.label !== "Doer's Notes")).filter((s) => s.fields.length),
    [schema],
  );

  // Cancel / close without saving discards every not-yet-uploaded local
  // preview (picked file or recorded clip) — nothing lingers once the form
  // is gone. Reads the latest values via a ref so the unmount-only cleanup
  // below always sees what's actually in the form at close time.
  const valuesRef = useRef(values);
  useEffect(() => { valuesRef.current = values; }, [values]);

  // Seed field defaults once the schema is available: the +91 dial code into
  // empty phone fields, and the default unit for measurement fields. Never
  // overwrites a value the user (or an existing record) already has, and stays
  // out of read-only view mode. Runs once per open.
  const defaultsSeededRef = useRef(false);
  useEffect(() => {
    if (readOnly || defaultsSeededRef.current || !schema.length) return;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const f of schema) {
        if (isPhoneField(f) && isEmpty(next[f.key])) { next[f.key] = PHONE_PREFIX; changed = true; }
        const units = unitOptionsFor(f);
        if (units && isEmpty(next[unitKeyOf(f.key)])) { next[unitKeyOf(f.key)] = units[0]; changed = true; }
      }
      return changed ? next : prev;
    });
    defaultsSeededRef.current = true;
  }, [schema, readOnly]);
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
      // Awaited: onSaveDraft returns the parent's save promise, so a backend
      // failure (validation, permission, network) lands in this catch block
      // instead of vanishing silently — without awaiting, a rejected save
      // promise here was previously unobserved and the modal would just sit
      // there with no error and no close, looking like "nothing happened".
      await onSaveDraft?.({ values: resolved, status: 'draft' });
    } catch (err) {
      setUploadError(err?.response?.data?.message || err?.message || 'Failed to save. Please try again.');
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
      // See handleDraft — must be awaited for save failures to surface.
      await onSubmit?.({ values: resolved, status: 'submitted', submittedAt: new Date().toISOString() });
    } catch (err) {
      setUploadError(err?.response?.data?.message || err?.message || 'Failed to save. Please try again.');
    } finally {
      setActiveAction(null);
    }
  };

  const busy = saving || activeAction != null;

  const footer = readOnly ? (
    <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
      <div className="row gap-2">
        {onApprove && (
          <button type="button" className="btn btn-outline-success" disabled={decidePending} onClick={onApprove}>
            ✓ Approve
          </button>
        )}
        {onReject && (
          <button type="button" className="btn btn-outline-danger" disabled={decidePending} onClick={onReject}>
            ✕ Reject
          </button>
        )}
      </div>
      <div className="row gap-2">
        {onEdit && <button type="button" className="btn btn-subtle" onClick={onEdit}>Edit</button>}
        <button type="button" className="btn btn-subtle" onClick={onClose}>Close</button>
      </div>
    </div>
  ) : loading ? (
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
      title={readOnly ? `View ${recordNoun}` : `${isEdit ? 'Edit' : 'Add New'} ${recordNoun}`}
      subtitle={isEdit && recordNo ? recordNo : undefined}
      width={760}
      footer={footer}
    >
      {loading ? (
        <SkeletonForm sections={3} fieldsPerSection={3} />
      ) : (
        <div className="col gap-3">
          {meta && (
            <div className="col gap-2">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-3)' }}>
                <MetaTile label="Assessment Type" value={meta.typeLabel} />
                <MetaTile label="Submission No." value={meta.submissionNo ? `#${meta.submissionNo}` : undefined} />
                <MetaTile label="Submitted By" value={meta.submittedBy} />
                <MetaTile label="Submitted On" value={meta.submittedOn} />
                <MetaTile label="Status" value={meta.statusLabel} tone={meta.statusColor} />
                <MetaTile label="Decided By" value={meta.decidedBy} />
                <MetaTile label="Decided On" value={meta.decidedOn} />
              </div>
              {meta.rejectReason && (
                <div className="sm" style={{ color: 'var(--danger)', padding: '8px 10px', border: '1px solid var(--danger)', borderRadius: 8 }}>
                  <b>Rejection Reason:</b> {meta.rejectReason}
                </div>
              )}
            </div>
          )}
          {uploadError && (
            <div className="sm" style={{ color: 'var(--danger)', padding: '8px 10px', border: '1px solid var(--danger)', borderRadius: 8 }}>
              {uploadError}
            </div>
          )}
          {sections.map((section) => (
            <section key={section.title} className="col gap-2">
              {/* Every section renders fully expanded, all at once — no
                  collapse/accordion state. A plain in-flow heading (not
                  sticky) so nothing stacks over or hides the fields below it. */}
              <div
                className="section-title"
                style={{
                  padding: '3px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                {section.title}
              </div>
              {/* Two columns on desktop, one on mobile (.form-grid).
                  `WIDE_FIELD_TYPES` and any section holding a single field take
                  the whole row — see fullWidthField below. */}
              <div className="form-grid">
                {(() => {
                  const shown = section.fields.filter((field) => isVisible(field, values));
                  return shown.map((field) => {
                  const units = readOnly ? null : unitOptionsFor(field);
                  const dyn = (
                    <DynamicField
                      field={field}
                      value={values[field.key]}
                      onChange={(next) => setValue(field.key, isPhoneField(field) ? formatPhone(next) : next)}
                      error={errors[field.key]}
                      readOnly={readOnly}
                    />
                  );
                  return (
                    <div
                      className={`field${fullWidthField(field, shown.length) ? ' form-grid-full' : ''}`}
                      key={field.key}
                      style={{ marginBottom: 0 }}
                    >
                      {field.label && (
                        <label className="label" htmlFor={`field-${field.key}`}>
                          {field.label}
                          {field.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                        </label>
                      )}
                      {units ? (
                        <div className="mr-unit-group">
                          <div>{dyn}</div>
                          {/* Unit selector — joined to the value box; stored
                              under `<key>_unit` so the unit is captured with it. */}
                          <select
                            className="select mr-unit-select"
                            value={values[unitKeyOf(field.key)] || units[0]}
                            onChange={(e) => setValue(unitKeyOf(field.key), e.target.value)}
                            aria-label={`${field.label || field.key} unit`}
                          >
                            {units.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                      ) : dyn}
                    </div>
                  );
                  });
                })()}
              </div>
            </section>
          ))}
          {readOnly && activity && (
            <section className="col gap-2">
              <div className="section-title" style={{ padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                Activity History
              </div>
              {activity.length ? (
                <div className="col gap-2">
                  {activity.map((a) => (
                    <div key={a._id} className="row gap-3">
                      <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={26} />
                      <div className="col grow">
                        <div className="sm"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span></div>
                        <div className="tiny muted">{fmtDateTime(a.createdAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="tiny muted">No activity yet</div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

export default RecordFormModal;
