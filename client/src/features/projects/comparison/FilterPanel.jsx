import { useEffect, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';

export const DEFAULT_SE_FILTERS = {
  city: '', locality: '', investMin: '', investMax: '',
  roiMin: '', roiMax: '', scoreMin: '', scoreMax: '',
  evaluationStatus: 'all', decision: 'all', recommendation: '', riskLevel: '', progress: 'all',
  approvedBy: '', rejectedBy: '', dateFrom: '', dateTo: '',
};

export const activeSeFilterCount = (f) =>
  (f.city ? 1 : 0) +
  (f.locality ? 1 : 0) +
  (f.investMin ? 1 : 0) +
  (f.investMax ? 1 : 0) +
  (f.roiMin ? 1 : 0) +
  (f.roiMax ? 1 : 0) +
  (f.scoreMin ? 1 : 0) +
  (f.scoreMax ? 1 : 0) +
  (f.evaluationStatus !== 'all' ? 1 : 0) +
  (f.decision !== 'all' ? 1 : 0) +
  (f.recommendation ? 1 : 0) +
  (f.riskLevel ? 1 : 0) +
  (f.progress !== 'all' ? 1 : 0) +
  (f.approvedBy ? 1 : 0) +
  (f.rejectedBy ? 1 : 0) +
  (f.dateFrom ? 1 : 0) +
  (f.dateTo ? 1 : 0);

function Field({ label, children }) {
  return (
    <div className="col gap-1">
      <span className="tiny subtle upper">{label}</span>
      {children}
    </div>
  );
}

/**
 * Filters as a right-side drawer, opened only via the page's "Filters"
 * button (`open`) — replaces the old always-visible sidebar. Deferred
 * (draft) filtering — every control edits a local draft, committed to the
 * page's real filter state only on "Apply Filters" (and cleared via
 * "Reset") — so typing an Investment/ROI/Score range doesn't re-filter and
 * re-render the tables on every keystroke, which matters once a project
 * has hundreds of properties. The draft resets to the currently-applied
 * `value` every time the drawer opens, so a closed-without-applying edit
 * never leaks into the next time it's opened.
 *
 * Self-contained: owns its own overlay, ESC-to-close, outside-click-to-
 * close and background-scroll-lock, so every consumer (Site Evaluation's
 * dashboard, the Comparison page) gets identical behavior for free instead
 * of re-implementing it per anchor point.
 */
export function FilterPanel({ open, onClose, cityOptions, localityOptions, value, onApply, onReset }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));
  const apply = () => onApply(draft);
  const reset = () => { setDraft(DEFAULT_SE_FILTERS); onReset(); };

  return (
    <div className="se-filters-overlay" onMouseDown={onClose}>
      <div
        className="se-filters-drawer fade-in"
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="se-filters-head">
          <span className="section-title">Filters</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="se-filters-body">
          <Field label="City">
            <select className="select" value={draft.city} onChange={(e) => set('city', e.target.value)}>
              <option value="">All Cities</option>
              {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <Field label="Locality">
            <select className="select" value={draft.locality} onChange={(e) => set('locality', e.target.value)}>
              <option value="">All Localities</option>
              {localityOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>

          <Field label="Investment Range">
            <div className="row gap-2">
              <input className="input" type="number" min="0" placeholder="Min" value={draft.investMin} onChange={(e) => set('investMin', e.target.value)} />
              <input className="input" type="number" min="0" placeholder="Max" value={draft.investMax} onChange={(e) => set('investMax', e.target.value)} />
            </div>
          </Field>

          <Field label="Return on Investment (%)">
            <div className="row gap-2">
              <input className="input" type="number" min="0" placeholder="Min" value={draft.roiMin} onChange={(e) => set('roiMin', e.target.value)} />
              <input className="input" type="number" min="0" placeholder="Max" value={draft.roiMax} onChange={(e) => set('roiMax', e.target.value)} />
            </div>
          </Field>

          <Field label="Overall Score">
            <div className="row gap-2">
              <input className="input" type="number" min="0" max="100" placeholder="Min" value={draft.scoreMin} onChange={(e) => set('scoreMin', e.target.value)} />
              <input className="input" type="number" min="0" max="100" placeholder="Max" value={draft.scoreMax} onChange={(e) => set('scoreMax', e.target.value)} />
            </div>
          </Field>

          <Field label="Evaluation Status">
            <select className="select" value={draft.evaluationStatus} onChange={(e) => set('evaluationStatus', e.target.value)}>
              <option value="all">All</option>
              <option value="approved">Completed</option>
              <option value="in_progress">In Progress</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>

          <Field label="Decision">
            <select className="select" value={draft.decision} onChange={(e) => set('decision', e.target.value)}>
              <option value="all">All</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="pending">Pending</option>
            </select>
          </Field>

          <Field label="Recommendation">
            <select className="select" value={draft.recommendation} onChange={(e) => set('recommendation', e.target.value)}>
              <option value="">All</option>
              <option value="Highly Recommended">Highly Recommended</option>
              <option value="Recommended">Recommended</option>
              <option value="Consider">Consider</option>
              <option value="Low Priority">Low Priority</option>
            </select>
          </Field>

          <Field label="Risk Level">
            <select className="select" value={draft.riskLevel} onChange={(e) => set('riskLevel', e.target.value)}>
              <option value="">All</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </Field>

          <Field label="Progress">
            <select className="select" value={draft.progress} onChange={(e) => set('progress', e.target.value)}>
              <option value="all">All</option>
              <option value="not_started">Not Started</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </Field>

          <Field label="Assigned / Submitted By">
            <input className="input" placeholder="Name" value={draft.approvedBy} onChange={(e) => set('approvedBy', e.target.value)} />
          </Field>

          <Field label="Rejected By">
            <input className="input" placeholder="Name" value={draft.rejectedBy} onChange={(e) => set('rejectedBy', e.target.value)} />
          </Field>

          <Field label="Evaluation Date">
            <div className="row gap-2">
              <input className="input" type="date" value={draft.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} />
              <input className="input" type="date" value={draft.dateTo} onChange={(e) => set('dateTo', e.target.value)} />
            </div>
          </Field>
        </div>

        <div className="se-filters-footer">
          <button type="button" className="btn btn-subtle" onClick={reset}>
            <RotateCcw size={13} /> Reset
          </button>
          <button type="button" className="btn btn-primary" onClick={apply}>
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
}

export default FilterPanel;
