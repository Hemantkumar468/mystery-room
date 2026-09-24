import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal.jsx';
import { flashSuccess } from '../../../components/ui/SuccessFlash.jsx';
import { DynamicField } from './DynamicField.jsx';
import { SkeletonForm, SkLine } from '../../../components/ui/Skeletons.jsx';
import { Avatar } from '../../../components/ui/primitives.jsx';
import { useUploadMedia } from '../../../app/api/recordsApi.js';
import { usePrefillAssessment, useDocumentExtract } from '../../../app/api/aiApi.js';
import { fmtDateTime } from '../../../lib/format.js';
import { resolvePendingUploads as resolveUploads } from './recordUi.js';

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
  // Compared as strings on purpose. The template schema stores showIf.in
  // as [String], so a boolean condition written as `in: [true]` is persisted
  // as ["true"] — and a strict includes() against the form's real `true`
  // never matched, which silently hid every field behind a yes/no toggle.
  const v = values[field.showIf.field];
  return (field.showIf.in || []).some((x) => String(x) === String(v));
}

/**
 * Field types whose control is inherently wide — a file dropzone, a map
 * picker, a multi-select chip list or a paragraph box. Squeezed into half a
 * row they either clip or wrap into something unreadable, so they always take
 * the full width.
 */
const WIDE_FIELD_TYPES = new Set(['textarea', 'file', 'location', 'multiselect', 'layout']);

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
  /** Overrides the header's second line. A capture opened from the property
   *  queue uses it to name the project being filed against, which is the one
   *  thing the form itself never says. */
  subtitle = null,
  /** Overrides the header's first line, for a dialog that is more than this
   *  record — "Property in Hand" creates the project and files its plan in one
   *  form, and calling that "Add New Project Plan" would hide half of it. */
  title = null,
  /** Rendered above the schema's own sections. Fields that belong to the same
   *  sitting but not to this record (the project being created alongside it)
   *  go here, so there is one form rather than two dialogs in a row. */
  preface = null,
  /** The built-in "submitted"/"draft saved" flash. Turned off by a caller that
   *  saves more than this record and wants to say so itself, rather than two
   *  messages stacking up. */
  announce = true,
  initialValues = null,
  /**
   * Values already known from elsewhere in the project (the chosen property,
   * the project record itself), used to pre-fill a NEW form so nobody retypes
   * what the system has. Every seeded field stays ordinary and editable, and
   * `initialValues` always overrides on edit.
   */
  seedValues = null,
  /** Enables fields whose options come from another stage's records. */
  projectId = null,
  onSaveDraft,
  onSubmit,
  submitLabel = 'Submit',
  saving = false,
  /** A save that failed. Shown at the top of the form, which stays open so
   *  the values are not lost — the one thing a person cannot recover. */
  error = null,
  loading = false,
  readOnly = false,
  meta = null,
  activity = null,
  onEdit = null,
  onApprove = null,
  /* What the positive decision is CALLED on this phase. Phase 1 shortlists
     properties rather than approving them, and a button that says the wrong
     word is how five real properties ended up in a status their own phase
     does not have. See lib/recordDecisions. */
  approveLabel = 'Approve',
  onReject = null,
  decidePending = false,
  /**
   * Enables the "Draft with AI" action. Supplied only where a draft is allowed
   * — the Phase 2 feasibility and operational assessments — so the button
   * simply does not exist on the forms a person must complete themselves.
   * @type {{ recordId: string, stageKey: string, assessmentType: string } | null}
   */
  aiPrefill = null,
  /**
   * Phase 3 only: `{ projectId, assessmentType }`. Enables "Read the document"
   * — uploads whatever is attached, has AI read it, and fills the form from
   * what the document actually says, quoting each value.
   */
  documentRead = null,
}) {
  const isEdit = Boolean(initialValues);
  // Seed first, then initialValues on top: seeds only ever fill fields an
  // existing record hasn't already answered, and a stored value always wins.
  // Kept separate from `initialValues` so pre-filling a NEW form does not flip
  // the modal into its "Edit" identity (isEdit above keys off initialValues).
  const [values, setValues] = useState(() => {
    const base = { ...(seedValues || {}), ...(initialValues || {}) };
    /* A multi-add field's stored value is the JOINED list ("sofa, chair") —
       on edit the list itself is exploded into the item list below, so the
       input starts empty rather than showing the join back as one item. */
    const mf = schema.find((f) => f.multiAdd);
    if (mf && initialValues && (Array.isArray(initialValues[`${mf.key}_list`]) && initialValues[`${mf.key}_list`].length
      || String(initialValues[mf.key] || '').includes(','))) {
      base[mf.key] = '';
    }
    return base;
  });

  /* ── "Add more" on one field (schema flag `multiAdd`) ──────────────────
     The BOQ's Item: an order for furniture is sofa AND chair AND table from
     one vendor on one PO — so the values collected here stay ONE record,
     with the full list stored beside the field (`<key>_list`) and the field
     itself carrying the readable joined form every page and PO document
     already shows. Editing reopens the same list: items can be removed or
     added at any point before the line is approved. */
  const multiField = !readOnly ? schema.find((f) => f.multiAdd) : null;
  const [moreValues, setMoreValues] = useState(() => {
    const mf = schema.find((f) => f.multiAdd);
    if (!mf || !initialValues) return [];
    const list = initialValues[`${mf.key}_list`];
    if (Array.isArray(list) && list.length) return list;
    const joined = String(initialValues[mf.key] || '');
    return joined.includes(',') ? joined.split(',').map((s) => s.trim()).filter(Boolean) : [];
  });
  const addMore = () => {
    const current = String(values[multiField.key] ?? '').trim();
    if (!current) return;
    setMoreValues((list) => [...list, current]);
    setValues((v) => ({ ...v, [multiField.key]: '' }));
    document.getElementById(`field-${multiField.key}`)?.focus();
  };
  /* The one record's item fields, resolved from the list + whatever is still
     in the input. Empty list = the field's own single value stands alone. */
  const withMultiItems = (vals) => {
    if (!multiField) return vals;
    const names = [...moreValues, String(vals[multiField.key] ?? '').trim()].filter(Boolean);
    if (names.length === 0) return vals;
    return { ...vals, [multiField.key]: names.join(', '), [`${multiField.key}_list`]: names };
  };

  // Which fields AI drafted, so they can be labelled as suggestions. Cleared
  // per field as soon as the expert edits it — once they have changed a value
  // it is theirs, and continuing to mark it "AI" would misattribute their work.
  const [aiFilled, setAiFilled] = useState(() => new Set());
  const [aiNotes, setAiNotes] = useState(null);
  const prefill = usePrefillAssessment();

  /* ── Reading the attached document ───────────────────────────────────
     Two steps, in this order and for a reason. The attachment is still a
     browser File at this point (uploads are deferred to save time), and the
     reader works on the STORED object — so the file goes to S3 first and the
     entry is rewritten as a real reference. That also means pressing this
     button never causes a second copy: submitting afterwards finds the file
     already uploaded and leaves it alone. */
  const [docNotes, setDocNotes] = useState(null);
  const [docFields, setDocFields] = useState({});   // key -> { evidence, confidence }
  /** null | 'picking' | 'uploading' | 'reading' — drives the progress line. */
  const [docStage, setDocStage] = useState(null);
  const docInputRef = useRef(null);
  const extract = useDocumentExtract();
  const docBusy = docStage === 'uploading' || docStage === 'reading';

  /** The file field a picked document should live in — the first one on the form. */
  const docFieldKey = useMemo(() => schema.find((f) => f.type === 'file')?.key || null, [schema]);

  /**
   * Read a document into this form.
   *
   * One click does the whole thing. Before, the button only worked if you had
   * already scrolled to the bottom, opened the file picker and attached
   * something — so the first press always failed and told you to go and do
   * that. Now pressing it opens the picker when nothing is attached, and the
   * upload, the reading and the filling happen in front of you with the stage
   * named as it goes.
   */
  const runRead = async (picked) => {
    if (!documentRead) return;
    setDocNotes(null);
    try {
      const current = { ...valuesRef.current };
      const refs = [];

      // 1. Anything the user picked just now, plus anything already attached.
      setDocStage('uploading');
      const incoming = picked ? [...picked] : [];
      if (incoming.length && docFieldKey) {
        const existing = Array.isArray(current[docFieldKey]) ? [...current[docFieldKey]] : (current[docFieldKey] ? [current[docFieldKey]] : []);
        for (const file of incoming) {
          const ref = await upload.mutateAsync({ file });
          const stored = {
            url: ref.url, publicId: ref.publicId, resourceType: ref.resourceType,
            originalName: file.name, mimetype: file.type, bytes: file.size,
          };
          existing.push(stored);
          refs.push({ publicId: ref.publicId, name: file.name, mimetype: file.type });
        }
        current[docFieldKey] = existing;
      }

      // 2. Attachments already on the form. A pending one is still a browser
      //    File — it goes to storage now and its entry is rewritten, so
      //    submitting later never uploads the same document twice.
      for (const f of schema.filter((x) => x.type === 'file')) {
        const raw = current[f.key];
        const list = Array.isArray(raw) ? [...raw] : raw ? [raw] : [];
        for (let i = 0; i < list.length; i += 1) {
          const entry = list[i];
          if (!entry) continue;
          if (entry.pending && entry.file) {
            const ref = await upload.mutateAsync({ file: entry.file });
            list[i] = {
              url: ref.url, publicId: ref.publicId, resourceType: ref.resourceType,
              originalName: entry.name, mimetype: entry.mimetype, bytes: entry.size,
            };
            refs.push({ publicId: ref.publicId, name: entry.name, mimetype: entry.mimetype });
          } else if (entry.publicId && !refs.some((r) => r.publicId === entry.publicId)) {
            refs.push({ publicId: entry.publicId, name: entry.originalName || entry.name, mimetype: entry.mimetype });
          }
        }
        current[f.key] = list;
      }
      setValues(current);

      if (!refs.length) {
        setDocStage(null);
        setDocNotes({ tone: 'empty', text: 'No document was chosen.' });
        return;
      }

      // 3. Read it.
      setDocStage('reading');
      const draft = await extract.mutateAsync({ ...documentRead, files: refs });
      const got = Object.entries(draft?.values || {});
      if (!got.length) {
        setDocNotes({
          tone: 'empty',
          text: draft?.warnings?.length
            ? `Nothing could be read with confidence. ${draft.warnings.join(' ')}`
            : 'Nothing could be read from that document with confidence — please fill the form by hand.',
        });
        return;
      }
      // Only into EMPTY fields: what a person already typed is their answer.
      const applied = [];
      setValues((prev) => {
        const next = { ...prev };
        for (const [k, v] of got) {
          if (next[k] === undefined || next[k] === null || next[k] === '') { next[k] = v; applied.push(k); }
        }
        return next;
      });
      setAiFilled(new Set(applied));
      setDocFields(draft.fields || {});
      setDocNotes({
        tone: 'ok',
        count: applied.length,
        documentType: draft.documentType,
        warnings: draft.warnings || [],
      });
    } catch (err) {
      setDocNotes({ tone: 'error', text: err?.response?.data?.message || err?.message || 'The document could not be read.' });
    } finally {
      setDocStage(null);
    }
  };

  /** The button: open the picker when nothing is attached, otherwise just read. */
  const readDocument = () => {
    const attached = schema
      .filter((f) => f.type === 'file')
      .flatMap((f) => {
        const raw = valuesRef.current[f.key];
        return Array.isArray(raw) ? raw : raw ? [raw] : [];
      })
      .filter(Boolean);
    if (attached.length) { runRead(null); return; }
    setDocStage('picking');
    docInputRef.current?.click();
  };

  const runPrefill = async () => {
    if (!aiPrefill) return;
    try {
      const draft = await prefill.mutateAsync(aiPrefill);
      const filled = Object.keys(draft?.values || {});
      if (!filled.length) {
        setAiNotes({ tone: 'empty', text: 'AI had nothing solid to suggest for this property — fill the form as normal.' });
        return;
      }
      // Never overwrite what the expert already typed: a draft is a starting
      // point for BLANK fields, not a replacement for their judgement.
      setValues((prev) => {
        const next = { ...prev };
        const applied = [];
        for (const [k, v] of Object.entries(draft.values)) {
          const existing = next[k];
          if (existing === undefined || existing === null || existing === '') {
            next[k] = v;
            applied.push(k);
          }
        }
        setAiFilled(new Set(applied));
        return next;
      });
      setAiNotes({
        tone: 'ok',
        text: draft.notes || '',
        confident: draft.confident || [],
        basedOnResearch: draft.source?.basedOnPriorResearch,
      });
    } catch (err) {
      setAiNotes({
        tone: 'error',
        text: err?.response?.data?.message || 'Could not draft this assessment. Fill it in as normal.',
      });
    }
  };
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
    // `tracker` fields belong to the Phase 6 order tracker, which writes them
    // after approval through its own endpoint — never to this form.
    () => groupBySection(schema.filter((f) => f.label !== "Doer's Notes" && !f.tracker)).filter((s) => s.fields.length),
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
        // A field whose answer never varies (an assessment's Purpose) arrives
        // already written. Only ever into an EMPTY field, so editing an
        // existing record never has its wording rewritten underneath it.
        if (f.defaultValue && isEmpty(next[f.key])) { next[f.key] = f.defaultValue; changed = true; }
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

  /**
   * Merge several values at once — what a `fillFrom` picker calls when the
   * chosen source record's fields are copied in. Overwrites deliberately:
   * picking a BOQ line IS the instruction to take its facts; every field
   * stays editable afterwards.
   */
  const fillValues = (patch) => {
    setValues((prev) => ({ ...prev, ...patch }));
    setErrors((e) => {
      const cleared = { ...e };
      for (const k of Object.keys(patch)) cleared[k] = undefined;
      return cleared;
    });
  };
  const setValue = (key, next) => {
    // Once the expert touches a drafted field, it stops being AI's — it is
    // their answer, and the "AI draft" marker would misattribute it.
    if (aiFilled.has(key)) {
      setAiFilled((prev) => {
        const rest = new Set(prev);
        rest.delete(key);
        return rest;
      });
    }
    setValues((v) => {
      const updated = { ...v, [key]: next };
      // A field that just became hidden by this change (e.g. switching
      // Commercial Type away from "Rental") has its stale value cleared, so
      // an irrelevant value never gets silently submitted.
      for (const field of schema) {
        if (field.showIf?.field === key && !isVisible(field, updated)) {
          updated[field.key] = undefined;
        }
        // Data-driven auto-count: a field declaring `countOf: <key>` follows
        // that multiselect's selection size (game_count ← selected_games).
        // It tracks every tick/untick; typing over it holds only until the
        // selection next changes, which is the honest behaviour for a field
        // whose whole meaning is "how many are ticked".
        if (field.countOf === key && Array.isArray(next)) {
          updated[field.key] = next.length;
        }
        // Same idea for an arithmetic total: a field declaring
        // `productOf: ['quantity', 'rate']` follows the product of those
        // fields — the BOQ's Amount. It stays an ordinary editable input:
        // typing a negotiated total over it holds until one of its inputs
        // next changes, exactly as countOf above behaves. Left untouched
        // while any input is blank, so clearing Quantity cannot silently
        // write a 0 into a money column.
        if (Array.isArray(field.productOf) && field.productOf.includes(key)) {
          const parts = field.productOf.map((k) => (k === key ? next : updated[k]));
          const nums = parts.map((v) => (v === '' || v == null ? NaN : Number(v)));
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
      if (field.required && isVisible(field, values) && isEmpty(values[field.key])) {
        // An empty multi-add input with items already listed IS answered.
        if (field.multiAdd && moreValues.length) continue;
        next[field.key] = `${field.label} is required`;
      }
    }
    setErrors(next);
    return next;
  };

  /* The deferred-upload step, shared with the guided capture form — see
     resolvePendingUploads in recordUi.js. */
  const resolvePendingUploads = (vals) => resolveUploads(schema, vals, upload.mutateAsync);

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
      await onSaveDraft?.({ values: withMultiItems(resolved), status: 'draft' });
      if (announce) flashSuccess('Draft saved — you can finish it later');
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
      /* Multi-add: everything listed rides in ONE record — one order of many
         items, not many orders. See withMultiItems. */
      const finalValues = withMultiItems(resolved);
      const itemCount = multiField ? (finalValues[`${multiField.key}_list`] || []).length : 0;
      // See handleDraft — must be awaited for save failures to surface.
      await onSubmit?.({ values: finalValues, status: 'submitted', submittedAt: new Date().toISOString() });
      // The acknowledgement the submit button was missing: the modal closes
      // and this centred flash is the visible proof the form went through.
      if (announce) flashSuccess(itemCount > 1 ? `${recordNoun} submitted — ${itemCount} items on one order` : `${recordNoun} submitted`);
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
            ✓ {approveLabel}
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
      title={title || (readOnly ? `View ${recordNoun}` : `${isEdit ? 'Edit' : 'Add New'} ${recordNoun}`)}
      subtitle={subtitle || (isEdit && recordNo ? recordNo : undefined)}
      width={760}
      footer={footer}
    >
      {loading ? (
        <SkeletonForm sections={3} fieldsPerSection={3} />
      ) : (
        <div className="col gap-3">
          {error && (
            <div className="pt-alert pt-alert--bad" role="alert">{error}</div>
          )}
          {/* Offered only where the document allows a draft, and worded as a
              starting point rather than an answer — the expert still owns the
              recommendation, so the copy must not imply the form is done. */}
          {/* Phase 3 is six folders of paperwork whose numbers were being
              re-keyed by hand. Reading the document is offered here, and every
              value it proposes carries the quote it came from — the reviewer
              checks one line, not the whole deed. */}
          {documentRead && !readOnly && docFieldKey && (
            <div className="ai-prefill">
              <div className="ai-prefill-row">
                <span className="ai-prefill-copy">
                  <strong>Have the document?</strong> Choose it here and I will store it, read it,
                  and fill this form from what it actually says — each value shown with the exact
                  line it came from. Nothing is saved until you submit.
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={readDocument}
                  disabled={docBusy}
                  data-guide="read-document"
                >
                  {docBusy ? 'Working…' : 'Upload & read the document'}
                </button>
                {/* The picker the button opens when nothing is attached yet. */}
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const picked = [...e.target.files];
                    e.target.value = '';
                    if (picked.length) runRead(picked);
                    else setDocStage(null);
                  }}
                />
              </div>

              {/* Something is happening, and it says what. Reading a scanned
                  lease takes several seconds; a button that just goes quiet
                  reads as broken. */}
              {docBusy && (
                <p className="doc-progress">
                  <span className="doc-spinner" aria-hidden />
                  {docStage === 'uploading' ? 'Storing the document securely…' : 'Reading the document — this can take a few seconds…'}
                </p>
              )}

              {docNotes && !docBusy && (
                <p className={`ai-prefill-note is-${docNotes.tone === 'ok' ? 'ok' : docNotes.tone}`}>
                  {docNotes.tone === 'ok' ? (
                    <>
                      <strong>{docNotes.count} field{docNotes.count === 1 ? '' : 's'} read
                      {docNotes.documentType ? ` from the ${docNotes.documentType}` : ''}.</strong>{' '}
                      Check each against the quoted line below it before submitting — these are legal
                      documents and the reading is not a substitute for reading them.
                      {docNotes.warnings?.length > 0 && ` ⚠ ${docNotes.warnings.join(' ')}`}
                    </>
                  ) : docNotes.text}
                </p>
              )}
            </div>
          )}
          {aiPrefill && !readOnly && (
            <div className="ai-prefill">
              <div className="ai-prefill-row">
                <span className="ai-prefill-copy">
                  <strong>Start from an AI draft?</strong> It fills the empty fields from this
                  property&rsquo;s research so you review and correct rather than start blank.
                  Nothing is saved until you submit.
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={runPrefill}
                  disabled={prefill.isPending}
                >
                  {prefill.isPending ? 'Drafting…' : 'Draft with AI'}
                </button>
              </div>

              {aiNotes && (
                <p className={`ai-prefill-note is-${aiNotes.tone}`}>
                  {aiNotes.tone === 'ok' && (
                    <>
                      <strong>{aiFilled.size} field{aiFilled.size === 1 ? '' : 's'} drafted.</strong>{' '}
                      Every one is editable — check them before submitting.
                      {aiNotes.basedOnResearch && ' Based on this property’s existing AI research.'}
                      {aiNotes.confident?.length > 0
                        && aiNotes.confident.length < aiFilled.size
                        && ' Fields outside the researched ones are informed guesses.'}
                      {aiNotes.text ? ` ${aiNotes.text}` : ''}
                    </>
                  )}
                  {aiNotes.tone !== 'ok' && aiNotes.text}
                </p>
              )}
            </div>
          )}
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
          {preface}
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
                      onFill={fillValues}
                      error={errors[field.key]}
                      readOnly={readOnly}
                      formValues={values}
                      projectId={projectId}
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
                      {/* The proof. A value read from a lease is only as good
                          as the line it came from, so the line is shown right
                          here — the reviewer checks one sentence instead of
                          re-reading the deed, and a misread is obvious. */}
                      {docFields[field.key] && (
                        <span className={`doc-evidence is-${docFields[field.key].confidence}`}>
                          <span className="doc-evidence-tag">
                            read from the document
                            {docFields[field.key].confidence !== 'high' ? ` · ${docFields[field.key].confidence} confidence — check this` : ''}
                          </span>
                          <q>{docFields[field.key].evidence}</q>
                        </span>
                      )}
                      {/* "Add more": several values of this one field, filed
                          as one record each on submit. The numbered list is
                          the receipt — what will be created, in order. */}
                      {multiField && field.key === multiField.key && (
                        <div className="col gap-1" style={{ marginTop: 6 }}>
                          {moreValues.length > 0 && (
                            <ol style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 4 }}>
                              {moreValues.map((name, i) => (
                                <li key={`${name}-${i}`} className="sm">
                                  {name}
                                  {' '}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${name}`}
                                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)' }}
                                    onClick={() => setMoreValues((list) => list.filter((_, idx) => idx !== i))}
                                  >
                                    ×
                                  </button>
                                </li>
                              ))}
                            </ol>
                          )}
                          <div className="row gap-2" style={{ alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-subtle btn-sm"
                              disabled={!String(values[field.key] ?? '').trim()}
                              onClick={addMore}
                            >
                              + Add more
                            </button>
                            <span className="tiny muted">
                              {moreValues.length > 0
                                ? `${moreValues.length + (String(values[field.key] ?? '').trim() ? 1 : 0)} items on this ONE order — one vendor, one PO, one GRN.`
                                : 'Ordering several things together? Type one, press “Add more”, repeat — they stay on one order.'}
                            </span>
                          </div>
                        </div>
                      )}
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
