import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, UserCheck, Loader2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useCreateLead, useDuplicateCheck, useCrmOptions } from '../../app/api/crmApi.js';

/**
 * Manual lead entry — a walk-in, a phone call, a conversation at an event.
 *
 * FAST, NOT COMPLETE. Sales reps fill this in standing in a corridor, on a
 * phone, with the customer still talking. So the required set is a name and a
 * number, and everything else is collapsed behind one toggle. A form that asks
 * for eleven fields is a form that gets filled in on paper "properly later",
 * which means never.
 *
 * THE DUPLICATE BANNER IS THE POINT. It appears while the number is still
 * being typed, before anything is submitted, because the useful moment to
 * learn "Rahul already exists and Priya is working him" is BEFORE you have
 * spent ninety seconds typing a record that will be merged away.
 */

/** Long enough that a full number is typed before the first request, short
 *  enough to feel immediate. Re-checking on every keystroke would fire ten
 *  requests to answer one question. */
const DEBOUNCE_MS = 450;

/** Ten digits is a complete Indian mobile — below that any answer would be
 *  "no match" simply because the number is not finished. */
const worthChecking = (phone, email) => (
  String(phone || '').replace(/\D/g, '').length >= 10 || /.+@.+\..+/.test(email || '')
);

export function NewLeadModal({
  open, onClose, onCreated,
  /** A number to start from — the screen-pop passes the caller's, so an
   *  unknown inbound call becomes a lead without anybody retyping it. */
  phone,
}) {
  const create = useCreateLead();
  const { data: options } = useCrmOptions();

  const [form, setForm] = useState({});
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState(null);
  const [debounced, setDebounced] = useState({ phone: '', email: '' });

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setForm(phone ? { phone } : {});
    setShowMore(false);
    setError(null);
    // Seeded into the debounced value too, so the duplicate check runs
    // immediately on a prefilled number instead of waiting for a keystroke
    // that is never going to come.
    setDebounced({ phone: phone || '', email: '' });
  }, [open, phone]);

  // Debounce what the duplicate check is asked about, not the input itself —
  // the field stays instant, only the request waits.
  useEffect(() => {
    const t = setTimeout(
      () => setDebounced({ phone: form.phone || '', email: form.email || '' }),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [form.phone, form.email]);

  const checkable = open && worthChecking(debounced.phone, debounced.email);
  const { data: dupe, isFetching: checking } = useDuplicateCheck(
    { phone: debounced.phone, email: debounced.email },
    checkable,
  );

  const match = dupe?.duplicate || dupe?.confidence === 'low' ? dupe : null;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const saved = await create.mutateAsync({
        ...form,
        // Only ever true when the agent has SEEN the banner and chosen to go
        // ahead — the server treats this as "I know, do it anyway".
        force: form.force || undefined,
      });
      onCreated?.(saved);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save that lead.');
    }
  };

  const saving = create.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New lead"
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" form="crm-new-lead" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save lead'}
          </button>
        </div>
      )}
    >
      <form id="crm-new-lead" onSubmit={submit} className="crm-form">
        {error && <div className="crm-form__error">{error}</div>}

        <label className="crm-form__field">
          <span className="crm-form__label">Name<em aria-hidden> *</em></span>
          <input
            className="input" required autoFocus
            value={form.name ?? ''} onChange={(e) => set('name', e.target.value)}
            placeholder="Who enquired?"
          />
        </label>

        <label className="crm-form__field">
          <span className="crm-form__label">
            Phone
            {checking && <Loader2 className="crm-spin" size={13} aria-label="Checking for duplicates" />}
          </span>
          <input
            className="input"
            // `tel` so a phone shows the number pad — this form is used on
            // phones far more than on desktops.
            type="tel" inputMode="tel"
            value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)}
            placeholder="98765 43210"
          />
        </label>

        {/* ── The duplicate banner ────────────────────────────── */}
        {match && (
          <div className={`crm-dupe ${match.confidence === 'low' ? 'crm-dupe--maybe' : ''}`}>
            <UserCheck size={16} aria-hidden />
            <div>
              <strong>{match.match?.name || 'Someone'}</strong>
              {' already exists'}
              {match.match?.assignedTo && ' — already assigned'}
              <span className="crm-muted"> · {match.reason}</span>

              {match.confidence !== 'low' && (
                <label className="crm-dupe__force">
                  <input
                    type="checkbox"
                    checked={Boolean(form.force)}
                    onChange={(e) => set('force', e.target.checked)}
                  />
                  {/* Without this, saving records a re-enquiry on the existing
                      lead — which is usually what you want, so it is the
                      default and creating a second record is the deliberate act. */}
                  <span>This is a different person — create a separate lead</span>
                </label>
              )}
            </div>
          </div>
        )}

        <label className="crm-form__field">
          <span className="crm-form__label">Email</span>
          <input
            className="input" type="email" inputMode="email"
            value={form.email ?? ''} onChange={(e) => set('email', e.target.value)}
            placeholder="name@example.com"
          />
        </label>

        <button
          type="button"
          className="crm-form__more"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
        >
          {showMore ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showMore ? 'Fewer details' : 'More details'}
        </button>

        {/* Collapsed by default and genuinely optional. Everything here can be
            filled in later from the lead's own page. */}
        {showMore && (
          <div className="crm-form__extra">
            <label className="crm-form__field">
              <span className="crm-form__label">Company</span>
              <input className="input" value={form.company ?? ''} onChange={(e) => set('company', e.target.value)} />
            </label>

            <label className="crm-form__field">
              <span className="crm-form__label">City</span>
              <input className="input" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
            </label>

            <label className="crm-form__field">
              <span className="crm-form__label">Source</span>
              <select className="select" value={form.source ?? ''} onChange={(e) => set('source', e.target.value)}>
                <option value="">Manual entry</option>
                {(options?.sources || []).map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>

            <label className="crm-form__field">
              <span className="crm-form__label">What did they ask for?</span>
              <textarea
                className="input" rows={3}
                value={form.message ?? ''} onChange={(e) => set('message', e.target.value)}
                placeholder="Budget, city, timeline — whatever they said"
              />
            </label>
          </div>
        )}
      </form>
    </Modal>
  );
}

export default NewLeadModal;
