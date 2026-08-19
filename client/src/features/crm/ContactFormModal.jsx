import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  useCreateContact, useUpdateContact, useCompanies,
} from '../../app/api/crmApi.js';

/**
 * Add or edit a person.
 *
 * TWO FIELDS CARRY LEGAL WEIGHT and are therefore separated from the rest,
 * with the consequence spelled out rather than implied:
 *
 *   Do Not Disturb  — blocks calling outright, not "discourages"
 *   WhatsApp opt-in — the difference between a message that may be sent and
 *                     one that may not, under Meta's policy and the DPDP Act
 *
 * The server stamps WHEN consent was given and records the source; this form
 * never sends a date, because a date the client could choose is not evidence.
 */
export function ContactFormModal({ open, contact, onClose, onSaved }) {
  const isEdit = Boolean(contact?._id);
  const create = useCreateContact();
  const update = useUpdateContact();
  // Only while the modal is open — a company list nobody is looking at is a
  // request nobody asked for.
  const { data: companies } = useCompanies({ limit: 200, sort: 'name' }, { skip: !open });

  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(isEdit ? {
      name: contact.name || '',
      phone: contact.phone || '',
      email: contact.email || '',
      designation: contact.designation || '',
      company: String(contact.company?._id || contact.company || ''),
      city: contact.city || '',
      doNotDisturb: Boolean(contact.doNotDisturb),
      whatsappOptIn: Boolean(contact.whatsappOptIn),
      notes: contact.notes || '',
    } : {});
  }, [open, contact?._id]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: contact._id, ...form })
        : await create.mutateAsync(form);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save that contact.');
    }
  };

  const saving = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit contact' : 'New contact'}
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" form="crm-contact-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save contact'}
          </button>
        </div>
      )}
    >
      <form id="crm-contact-form" onSubmit={submit} className="crm-form">
        {error && <div className="crm-form__error">{error}</div>}

        <label className="crm-form__field">
          <span className="crm-form__label">Name<em aria-hidden> *</em></span>
          <input
            className="input" required autoFocus
            value={form.name ?? ''} onChange={(e) => set('name', e.target.value)}
          />
        </label>

        <div className="crm-form__pair">
          <label className="crm-form__field">
            <span className="crm-form__label">Phone</span>
            <input
              className="input" type="tel" inputMode="tel"
              value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)}
              placeholder="98765 43210"
            />
          </label>
          <label className="crm-form__field">
            <span className="crm-form__label">Email</span>
            <input
              className="input" type="email"
              value={form.email ?? ''} onChange={(e) => set('email', e.target.value)}
            />
          </label>
        </div>

        <div className="crm-form__pair">
          <label className="crm-form__field">
            <span className="crm-form__label">Designation</span>
            <input
              className="input" value={form.designation ?? ''}
              onChange={(e) => set('designation', e.target.value)}
              placeholder="Director, Owner…"
            />
          </label>
          <label className="crm-form__field">
            <span className="crm-form__label">City</span>
            <input className="input" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          </label>
        </div>

        <label className="crm-form__field">
          <span className="crm-form__label">Company</span>
          <select
            className="select" value={form.company ?? ''}
            onChange={(e) => set('company', e.target.value)}
          >
            <option value="">No company</option>
            {(companies?.items || []).map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </label>

        {/* ── The two that carry legal weight ─────────────────── */}
        <fieldset className="crm-consent">
          <legend>Contact permissions</legend>

          <label className="crm-consent__row">
            <input
              type="checkbox" checked={Boolean(form.doNotDisturb)}
              onChange={(e) => set('doNotDisturb', e.target.checked)}
            />
            <span>
              <strong>Do not call</strong>
              <span className="crm-muted">Blocks click-to-call entirely. Not a preference — a rule.</span>
            </span>
          </label>

          <label className="crm-consent__row">
            <input
              type="checkbox" checked={Boolean(form.whatsappOptIn)}
              onChange={(e) => set('whatsappOptIn', e.target.checked)}
            />
            <span>
              <strong>Agreed to WhatsApp messages</strong>
              <span className="crm-muted">
                Only tick this if they actually said so. The date is stamped by the
                server and becomes the evidence if it is ever questioned.
              </span>
            </span>
          </label>
        </fieldset>

        <label className="crm-form__field">
          <span className="crm-form__label">Notes</span>
          <textarea
            className="input" rows={3} value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </form>
    </Modal>
  );
}

export default ContactFormModal;
