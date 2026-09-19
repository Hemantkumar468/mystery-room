import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Pencil, Loader2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { DynamicField } from '../projects/records/DynamicField.jsx';
import { isVisible, groupBySection } from '../projects/records/RecordFormModal.jsx';
import { resolvePendingUploads } from '../projects/records/recordUi.js';
import { useUploadMedia } from '../../app/api/recordsApi.js';

/**
 * The property capture form, asked one section at a time.
 *
 * Same schema, same fields, same `DynamicField` controls as the form inside
 * the project — this is a different way of ASKING, not a second form. The
 * long form is right when you are filing a site you already hold on paper;
 * this is right when you are standing in front of the site with a phone,
 * which is where most captures actually happen.
 *
 * ── Conditions decide the route, not just the fields ──────────────────
 * `showIf` already hides a field that does not apply. Here it does more: a
 * section whose every field is hidden is not a blank page you must click past,
 * it is DROPPED from the route entirely. Choose "Rent" and the lease questions
 * never appear; choose "Lease" and the rent ones never do. The step counter
 * re-reads off the live answers, so it always counts the steps you will
 * actually be asked.
 *
 * ── Why it advances by itself, and exactly when ───────────────────────
 * On a step that is a single choice, choosing IS the answer — there is nothing
 * else to do on that page, and making somebody confirm it is a second click
 * for no information. So those advance on their own. A step with a text box,
 * a number or several fields does NOT: something typed is not finished until
 * the person says so, and pulling the page out from under a half-typed address
 * is worse than the click it saved. Enter advances from any single-line field.
 *
 * ── Nothing is lost on the way ────────────────────────────────────────
 * Every answer stays in one `values` object for the whole run, so going back
 * shows what was typed, and the review at the end lists every answer with a
 * way back to the step that set it. The record is written once, at the end,
 * exactly as the long form writes it.
 */

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** A choice with a fixed list of options — the type that can answer itself. */
const isChoice = (f) => f.type === 'select' && Array.isArray(f.options) && f.options.length > 0;

/** What an answer looks like on the review page. */
function readable(field, value) {
  if (isEmpty(value)) return null;
  if (field.type === 'file') {
    const list = Array.isArray(value) ? value : [value];
    return `${list.length} file${list.length === 1 ? '' : 's'}`;
  }
  if (field.type === 'location') {
    if (typeof value === 'string') return value;
    return [value?.lat, value?.lng].filter(Boolean).join(', ') || 'Location captured';
  }
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function PropertyCaptureWizard({
  open, onClose, schema, projectId, projectName, recordNoun = 'Property',
  saving = false, error = null, onSubmit, onSaveDraft,
}) {
  const [values, setValues] = useState({});
  const [at, setAt] = useState(0);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null);
  const [failed, setFailed] = useState(null);
  const upload = useUploadMedia();
  const bodyRef = useRef(null);

  /**
   * The route through the form, recomputed from the live answers.
   *
   * A section survives only if it still has a visible field, so answering
   * "Rent" removes the lease step rather than showing it empty. `values` is a
   * dependency on purpose — this list is meant to change underfoot.
   */
  const steps = useMemo(() => groupBySection(schema)
    .map((sec) => ({ ...sec, fields: sec.fields.filter((f) => isVisible(f, values)) }))
    .filter((sec) => sec.fields.length > 0), [schema, values]);

  const total = steps.length;
  /* Clamped: answering a question can shorten the route, and the step you were
     on may no longer exist. */
  const index = Math.min(at, total);
  const onReview = index >= total;
  const step = steps[index] || null;

  /* Back to the top of the panel on every step — a long section leaves the
     next one scrolled halfway down itself. */
  useEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); }, [index]);

  const setValue = (key, v) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  /** Required fields of THIS step only — the whole point of asking in parts. */
  const checkStep = () => {
    if (!step) return true;
    const next = {};
    for (const f of step.fields) {
      if (f.required && isEmpty(values[f.key])) next[f.key] = `${f.label || 'This'} is required`;
    }
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(`field-${step.fields.find((f) => next[f.key]).key}`)?.focus();
      return false;
    }
    return true;
  };

  const forward = () => { if (checkStep()) setAt(index + 1); };
  const back = () => { setErrors({}); setAt(Math.max(0, index - 1)); };

  /**
   * A single-choice step answers itself — but only once it is really answered.
   *
   * THE TRAP THIS AVOIDS. A choice usually reveals its own follow-ups, and
   * they live in the SAME section: picking "Rent" turns on Monthly Rent,
   * Deposit and Available From, all under Commercial Information. Advancing
   * on the click skipped straight past the three questions the click had just
   * asked for. So the step is re-read against the answer that was just given,
   * and the form moves on only if there is genuinely nothing left on this
   * screen — otherwise it stays and the new fields appear underneath.
   *
   * Queued rather than run inline because `setValues` has not landed yet when
   * the change fires; the route is derived from the answers, so stepping in
   * the same tick would step against the old one.
   */
  const answer = (field, v) => {
    setValue(field.key, v);
    if (!step || !isChoice(field) || isEmpty(v)) return;
    const after = { ...values, [field.key]: v };
    const stillHere = groupBySection(schema)
      .find((sec) => sec.title === step.title)?.fields
      .filter((f) => isVisible(f, after)) || [];
    if (stillHere.length === 1 && stillHere[0].key === field.key) {
      setTimeout(() => setAt((i) => i + 1), 180);
    }
  };

  const finish = async (status) => {
    setFailed(null);
    setBusy(status);
    try {
      const resolved = await resolvePendingUploads(schema, values, upload.mutateAsync);
      setValues(resolved);
      const payload = { values: resolved, status };
      if (status === 'submitted') payload.submittedAt = new Date().toISOString();
      await (status === 'draft' ? onSaveDraft : onSubmit)?.(payload);
    } catch (err) {
      setFailed(err?.response?.data?.message || err?.message || 'Could not save. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  const answered = schema
    .filter((f) => isVisible(f, values) && !isEmpty(values[f.key]))
    .map((f) => ({ field: f, text: readable(f, values[f.key]) }));
  /* Required questions still unanswered, named — a Submit that just refuses is
     the most common way a long form traps somebody. */
  const missing = schema.filter((f) => f.required && isVisible(f, values) && isEmpty(values[f.key]));
  const stepOf = (key) => steps.findIndex((sec) => sec.fields.some((f) => f.key === key));

  return (
    <Modal
      open
      onClose={onClose}
      title={onReview ? 'Check it over' : step?.title}
      subtitle={projectName ? `${recordNoun} for ${projectName}` : recordNoun}
      width={620}
      footer={(
        <div className="pcw-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={index === 0 ? onClose : back}
            disabled={!!busy}
          >
            {index === 0 ? 'Cancel' : <><ArrowLeft size={14} /> Back</>}
          </button>

          <div className="row gap-2">
            {onSaveDraft && (
              <button type="button" className="btn btn-ghost" disabled={!!busy || saving} onClick={() => finish('draft')}>
                {busy === 'draft' ? <><Loader2 size={14} className="spin" /> Saving…</> : 'Save & finish later'}
              </button>
            )}
            {onReview ? (
              <button type="button" className="btn btn-primary" disabled={!!busy || saving} onClick={() => finish('submitted')}>
                {busy === 'submitted' ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Check size={14} /> Save the {recordNoun.toLowerCase()}</>}
              </button>
            ) : (
              /* Named after where it goes, never "Next step" — the label is
                 the one place the form can say what it is about to ask. */
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={forward}>
                {index + 1 < total ? steps[index + 1].title : 'Check it over'}
              </button>
            )}
          </div>
        </div>
      )}
    >
      <div className="pcw" ref={bodyRef}>
        <div className="pcw-rail" aria-hidden="true">
          {steps.map((sec, i) => (
            <span key={sec.title} className={`pcw-tick${i < index ? ' is-done' : ''}${i === index ? ' is-now' : ''}`} />
          ))}
          <span className={`pcw-tick${onReview ? ' is-now' : ''}`} />
        </div>
        <div className="pcw-count">
          {onReview ? `All ${total} answered` : `${index + 1} of ${total}`}
        </div>

        {(error || failed) && <div className="pcw-error">{failed || error}</div>}

        {onReview ? (
          <div className="col gap-3">
            {missing.length > 0 && (
              <div className="pcw-missing">
                Still needed: {missing.map((f) => f.label).join(', ')}.
                <button type="button" className="pcw-jump" onClick={() => setAt(Math.max(0, stepOf(missing[0].key)))}>
                  Go and fill it in
                </button>
              </div>
            )}
            {!answered.length ? (
              <p className="sm muted" style={{ margin: 0 }}>Nothing filled in yet.</p>
            ) : (
              <div className="pcw-review">
                {answered.map(({ field, text }) => (
                  <div key={field.key} className="pcw-review-row">
                    <span className="pcw-review-label">{field.label || field.key}</span>
                    <span className="pcw-review-value">{text}</span>
                    <button
                      type="button"
                      className="pcw-jump"
                      onClick={() => setAt(Math.max(0, stepOf(field.key)))}
                      title={`Change ${field.label || field.key}`}
                    >
                      <Pencil size={11} /> Change
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="pcw-fields">
            {step.fields.map((field) => (
              <div key={field.key} className="pcw-field">
                <label className="pcw-label" htmlFor={`field-${field.key}`}>
                  {field.label || field.section}
                  {field.required && <span className="pcw-req"> *</span>}
                </label>
                <div
                  onKeyDown={(e) => {
                    /* Enter moves on, but not out of a paragraph box, where it
                       is how you start a new line. */
                    if (e.key === 'Enter' && field.type !== 'textarea' && !e.shiftKey) {
                      e.preventDefault();
                      forward();
                    }
                  }}
                >
                  <DynamicField
                    field={field}
                    value={values[field.key]}
                    onChange={(v) => answer(field, v)}
                    formValues={values}
                    projectId={projectId}
                    error={errors[field.key]}
                  />
                </div>
                {errors[field.key] && <div className="pcw-field-error">{errors[field.key]}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default PropertyCaptureWizard;
