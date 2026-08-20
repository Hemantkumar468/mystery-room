import { useState } from 'react';
import { Send } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useSendCrmEmail } from '../../app/api/crmApi.js';

/**
 * Write to a customer from inside the record.
 *
 * WHY IT LIVES HERE AND NOT IN A MAIL CLIENT. An email sent from Outlook only
 * reaches the timeline if the rep remembers to BCC the dropbox. Sent from
 * here, it is on the record before it is on the wire — and it carries the
 * threading headers, so the customer sees a reply under the original rather
 * than a ninth unrelated message about the same enquiry.
 *
 * REPLYING PASSES `inReplyTo`. Composing fresh does not, and the message
 * starts its own thread. That single field is the whole difference between a
 * conversation and a pile of emails.
 */
export function EmailComposeModal({
  onClose, entityType, entityId, to, name, inReplyTo, subject: initialSubject,
}) {
  const send = useSendCrmEmail();
  const [form, setForm] = useState({
    subject: initialSubject ? `Re: ${initialSubject.replace(/^Re:\s*/i, '')}` : '',
    body: '',
  });
  const [error, setError] = useState(null);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await send.mutateAsync({
        entityType,
        entityId,
        to,
        subject: form.subject.trim(),
        body: form.body,
        inReplyTo,
      });
      onClose();
    } catch (err) {
      // Shown inline rather than only as a toast: the message they just typed
      // is still in the box, and they need to know it did NOT go.
      setError(err?.message || 'The email could not be sent.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={inReplyTo ? 'Reply' : 'Send an email'}
      subtitle={to ? `To ${name ? `${name} · ` : ''}${to}` : 'No email address on this record'}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button
            type="submit" form="crm-email-compose" className="btn btn-primary"
            disabled={send.isPending || !to || !form.subject.trim() || !form.body.trim()}
          >
            <Send size={15} /> {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
    >
      <form id="crm-email-compose" className="crm-form" onSubmit={submit}>
        {error && <div className="crm-form__error">{error}</div>}
        {!to && (
          <div className="crm-form__error">
            This record has no email address, so there is nowhere to send to. Add one first.
          </div>
        )}

        <label className="crm-form__field">
          <span className="crm-form__label">Subject<em aria-hidden> *</em></span>
          <input
            className="input" value={form.subject} maxLength={200}
            onChange={(e) => set('subject', e.target.value)}
            placeholder="Franchise details you asked for"
          />
        </label>

        <label className="crm-form__field">
          <span className="crm-form__label">Message<em aria-hidden> *</em></span>
          <textarea
            className="input" rows={9} value={form.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder="Write as you would in any mail client. Links are tracked."
          />
        </label>

        <p className="crm-muted sm">
          This lands on the timeline the moment it sends, and replies come back to the
          same conversation.
        </p>
      </form>
    </Modal>
  );
}

export default EmailComposeModal;
