import { useEffect, useMemo, useState } from 'react';
import { Save, Send } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal.jsx';
import { useCreateRecord, useUpdateRecord } from '../../../lib/queries.js';
import { DynamicField } from './DynamicField.jsx';
import { isEmptyValue } from './recordUi.js';

/**
 * Add / edit one collection-mode record (e.g. a candidate property). Renders the
 * stage's `masterDataSchema` dynamically. "Save draft" skips required-field
 * validation; "Submit" enforces it.
 */
export function RecordFormModal({ open, onClose, projectId, stageKey, schema, recordNoun = 'Record', record }) {
  const isEdit = !!record;
  const create = useCreateRecord(projectId, stageKey);
  const update = useUpdateRecord(projectId, stageKey);
  const pending = create.isPending || update.isPending;

  const orderedSchema = useMemo(
    () => [...(schema || [])].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [schema],
  );

  const [values, setValues] = useState({});
  const [showErrors, setShowErrors] = useState(false);

  // Reset the form whenever the modal opens or the edited record changes.
  useEffect(() => {
    if (open) {
      setValues(record?.values ? { ...record.values } : {});
      setShowErrors(false);
    }
  }, [open, record]);

  const setField = (key) => (v) => setValues((s) => ({ ...s, [key]: v }));

  const missing = orderedSchema.filter((f) => f.required && isEmptyValue(values[f.key]));

  const persist = async (status) => {
    if (status === 'submitted' && missing.length) {
      setShowErrors(true);
      return;
    }
    if (isEdit) {
      await update.mutateAsync({ id: record._id, values, status });
    } else {
      await create.mutateAsync({ values, status });
    }
    onClose();
  };

  const err = create.error?.response?.data?.message || update.error?.response?.data?.message;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${recordNoun}` : `Add ${recordNoun}`}
      subtitle="Capture the details — save as a draft or submit for review"
      width={720}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn btn-secondary" onClick={() => persist('draft')} disabled={pending}>
            <Save size={14} /> Save draft
          </button>
          <button className="btn btn-primary" onClick={() => persist('submitted')} disabled={pending}>
            {pending ? <span className="spinner" /> : <><Send size={14} /> Submit</>}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
        {orderedSchema.map((f) => {
          const invalid = showErrors && f.required && isEmptyValue(values[f.key]);
          const fullWidth = f.type === 'textarea';
          return (
            <div
              className="field"
              key={f.key}
              style={{ marginBottom: 0, gridColumn: fullWidth ? '1 / -1' : undefined }}
            >
              <label className="label">
                {f.label}
                {f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
              </label>
              <DynamicField field={f} value={values[f.key]} onChange={setField(f.key)} />
              {invalid && <span className="tiny" style={{ color: 'var(--danger)' }}>This field is required</span>}
              {!invalid && f.helpText && <span className="tiny subtle">{f.helpText}</span>}
            </div>
          );
        })}
      </div>

      {showErrors && missing.length > 0 && (
        <div className="badge" style={{ marginTop: 'var(--space-4)', background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          Please fill {missing.length} required field{missing.length > 1 ? 's' : ''} before submitting.
        </div>
      )}
      {err && (
        <div className="badge" style={{ marginTop: 'var(--space-3)', background: 'var(--danger-soft)', color: 'var(--danger)' }}>{err}</div>
      )}
    </Modal>
  );
}

export default RecordFormModal;
