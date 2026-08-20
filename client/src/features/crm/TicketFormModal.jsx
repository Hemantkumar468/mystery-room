import { useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useCreateTicket, useContacts } from '../../app/api/crmApi.js';

/**
 * Raise a ticket.
 *
 * DELIBERATELY SHORT. The clock starts the moment this is submitted, so every
 * extra field is time a customer is already waiting. Subject and priority are
 * enough to start; everything else can be filled in from the drawer once
 * somebody is actually working it.
 *
 * PRIORITY IS THE ONE CHOICE THAT MATTERS, because it picks the deadline — so
 * it says what each option means in hours rather than leaving "high" to be
 * guessed at.
 */

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent — answer within 30 working minutes' },
  { value: 'high', label: 'High — answer within an hour' },
  { value: 'normal', label: 'Normal — answer within four working hours' },
  { value: 'low', label: 'Low — answer within a working day' },
];

export function TicketFormModal({ onClose, requester, entityType, entityId }) {
  const create = useCreateTicket();
  const { data: contacts } = useContacts({ limit: 100 });
  const [form, setForm] = useState({
    subject: '', description: '', priority: 'normal', requester: requester || '', source: 'manual',
  });
  const [error, setError] = useState(null);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        subject: form.subject.trim(),
        description: form.description || undefined,
        priority: form.priority,
        source: form.source,
        requester: form.requester || undefined,
        entityType,
        entityId,
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'The ticket could not be raised.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Raise a ticket"
      subtitle="The SLA clock starts now, counted in working hours."
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button
            type="submit" form="crm-new-ticket" className="btn btn-primary"
            disabled={create.isPending || !form.subject.trim()}
          >
            {create.isPending ? 'Raising…' : 'Raise ticket'}
          </button>
        </div>
      )}
    >
      <form id="crm-new-ticket" className="crm-form" onSubmit={submit}>
        {error && <div className="crm-form__error">{error}</div>}

        <label className="crm-form__field">
          <span className="crm-form__label">What is wrong?<em aria-hidden> *</em></span>
          <input
            className="input" value={form.subject} maxLength={200}
            onChange={(e) => set('subject', e.target.value)}
            placeholder="Projector in Room 2 will not switch on"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        </label>

        <label className="crm-form__field">
          <span className="crm-form__label">Priority</span>
          <select className="crm-select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        <label className="crm-form__field">
          <span className="crm-form__label">Who reported it</span>
          <select className="crm-select" value={form.requester} onChange={(e) => set('requester', e.target.value)}>
            <option value="">Not recorded</option>
            {/* `items`, not `rows` — every list endpoint here returns
                { total, items }. Reading the wrong key fails silently: the
                dropdown just renders empty, which looks like "no contacts
                yet" rather than a bug. */}
            {(contacts?.items || []).map((c) => (
              <option key={String(c._id)} value={String(c._id)}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="crm-form__field">
          <span className="crm-form__label">How it reached us</span>
          <select className="crm-select" value={form.source} onChange={(e) => set('source', e.target.value)}>
            {['manual', 'phone', 'email', 'whatsapp', 'web'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label className="crm-form__field">
          <span className="crm-form__label">Anything else worth knowing</span>
          <textarea
            className="input" rows={4} value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What they tried, what happened, anything they have been told already."
          />
        </label>
      </form>
    </Modal>
  );
}

export default TicketFormModal;
