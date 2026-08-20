import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  useCreateDeal, usePipelines, useContacts,
} from '../../app/api/crmApi.js';

/**
 * Open a deal.
 *
 * Four fields, and only the title is required. A deal is created at the moment
 * somebody decides there is money in a conversation — often mid-call — and a
 * form asking for a close date and a contact before it will save is a form
 * that gets skipped, which means the pipeline stops reflecting reality.
 *
 * Everything else is filled in from the deal's own drawer later, when it is
 * actually known.
 */
export function DealFormModal({ open, onClose, onSaved, pipelineId }) {
  const create = useCreateDeal();
  const { data: pipelines } = usePipelines();
  const { data: contacts } = useContacts({ limit: 200, sort: 'name' }, { skip: !open });

  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const pipeline = pipelines?.find((p) => String(p._id) === String(pipelineId))
    || pipelines?.find((p) => p.isDefault)
    || pipelines?.[0];

  useEffect(() => {
    if (open) { setForm({}); setError(null); }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const saved = await create.mutateAsync({
        title: form.title,
        value: form.value ? Number(form.value) : 0,
        pipeline: pipeline?._id,
        // Omitted deliberately when blank — the service picks the first stage
        // by ORDER, which is not the same as stages[0] once one has been
        // inserted in the middle.
        stage: form.stage || undefined,
        contact: form.contact || undefined,
        expectedCloseDate: form.expectedCloseDate || undefined,
      });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not create that deal.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New deal"
      width={480}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" form="crm-deal-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create deal'}
          </button>
        </div>
      )}
    >
      <form id="crm-deal-form" onSubmit={submit} className="crm-form">
        {error && <div className="crm-form__error">{error}</div>}

        <label className="crm-form__field">
          <span className="crm-form__label">What is the deal?<em aria-hidden> *</em></span>
          <input
            className="input" required autoFocus
            value={form.title ?? ''} onChange={(e) => set('title', e.target.value)}
            placeholder="Indore franchise — Sharma"
          />
        </label>

        <div className="crm-form__pair">
          <label className="crm-form__field">
            <span className="crm-form__label">Value (₹)</span>
            <input
              className="input" type="number" min="0" step="10000"
              value={form.value ?? ''} onChange={(e) => set('value', e.target.value)}
              placeholder="1200000"
            />
          </label>
          <label className="crm-form__field">
            <span className="crm-form__label">Expected close</span>
            <input
              className="input" type="date"
              value={form.expectedCloseDate ?? ''}
              onChange={(e) => set('expectedCloseDate', e.target.value)}
            />
          </label>
        </div>

        {pipeline && (
          <label className="crm-form__field">
            <span className="crm-form__label">Starting stage</span>
            <select className="select" value={form.stage ?? ''} onChange={(e) => set('stage', e.target.value)}>
              <option value="">{pipeline.stages?.[0]?.name || 'First stage'} (default)</option>
              {(pipeline.stages || [])
                // Terminal stages are not a place to START. A deal created
                // directly in "Closed Won" has no history to learn from and
                // silently inflates every conversion number.
                .filter((s) => !s.isWon && !s.isLost)
                .map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </label>
        )}

        <label className="crm-form__field">
          <span className="crm-form__label">Contact</span>
          <select className="select" value={form.contact ?? ''} onChange={(e) => set('contact', e.target.value)}>
            <option value="">Nobody linked yet</option>
            {(contacts?.items || []).map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  );
}

export default DealFormModal;
