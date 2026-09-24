import { useMemo, useState } from 'react';
import {
  Phone, MessageSquare, Mail, StickyNote, Clock, UserCog, CheckSquare, Play,
} from 'lucide-react';

/**
 * One record's history, newest first.
 *
 * Shared by every drawer — lead, contact, deal — because a timeline is a
 * timeline. Three copies of this component is three places a new activity type
 * has to be taught how to render, and the third one always gets missed.
 *
 * THE FILTER CHIPS ARE NOT DECORATION. An agent opening a record thirty
 * seconds before a call wants the last three conversations, not fifty
 * automated receipts and stage changes in between. The chips only appear for
 * types actually present, so a quiet record shows no controls at all rather
 * than a row of buttons that filter nothing.
 */

const ICON = {
  call: Phone,
  whatsapp: MessageSquare,
  email: Mail,
  meeting: Clock,
  note: StickyNote,
  task: CheckSquare,
  stage_change: UserCog,
  system: Play,
};

const LABEL = {
  call: 'Calls',
  whatsapp: 'WhatsApp',
  email: 'Emails',
  meeting: 'Meetings',
  note: 'Notes',
  task: 'Tasks',
  stage_change: 'Stage changes',
  system: 'System',
};

/** Conversations first, then the record-keeping. The order the chips appear in
 *  is the order somebody scans them, so what a human said outranks what the
 *  system noted. */
const ORDER = ['call', 'whatsapp', 'email', 'meeting', 'note', 'task', 'stage_change', 'system'];

const when = (d) => new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function CrmTimeline({ items = [], empty = 'Nothing recorded yet.' }) {
  const [only, setOnly] = useState(null);

  const present = useMemo(() => {
    const counts = new Map();
    for (const a of items) counts.set(a.type, (counts.get(a.type) || 0) + 1);
    return ORDER.filter((t) => counts.has(t)).map((t) => ({ type: t, n: counts.get(t) }));
  }, [items]);

  const shown = only ? items.filter((a) => a.type === only) : items;

  if (!items.length) return <p className="crm-muted">{empty}</p>;

  return (
    <>
      {/* Only worth showing when there is actually something to narrow. */}
      {present.length > 1 && (
        <div className="crm-tlfilter" role="group" aria-label="Filter history">
          <button
            type="button" className={only === null ? 'is-on' : ''}
            onClick={() => setOnly(null)} aria-pressed={only === null}
          >
            All {items.length}
          </button>
          {present.map(({ type, n }) => {
            const Icon = ICON[type] || StickyNote;
            return (
              <button
                key={type} type="button" className={only === type ? 'is-on' : ''}
                onClick={() => setOnly(only === type ? null : type)}
                aria-pressed={only === type}
              >
                <Icon size={12} aria-hidden /> {LABEL[type] || type} {n}
              </button>
            );
          })}
        </div>
      )}

      <ol className="crm-timeline">
        {shown.map((a) => {
          const Icon = ICON[a.type] || StickyNote;
          return (
            <li key={a._id}>
              <span className="crm-timeline__icon"><Icon size={13} aria-hidden /></span>
              <div className="crm-timeline__body">
                <div className="crm-timeline__head">
                  <strong>{a.subject || a.type}</strong>
                  <span className="crm-muted">{when(a.occurredAt)}</span>
                </div>
                {a.body && <p className="crm-timeline__text">{a.body}</p>}
                <span className="crm-muted">
                  {a.actor?.name ? `— ${a.actor.name}` : ''}
                  {/* Provider-written rows are marked. A call the phone system
                      logged and a call somebody typed in are different kinds
                      of evidence, and the difference matters when a task
                      completion is being checked against it. */}
                  {a.providerEventId ? ' · recorded by the phone system' : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export default CrmTimeline;
