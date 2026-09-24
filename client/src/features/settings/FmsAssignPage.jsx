import { useMemo, useState } from 'react';
import {
  Users, Search, Save, Info, X, ChevronDown, ChevronRight, RotateCcw,
  UserPlus, ShieldQuestion, Workflow,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  Avatar, EmptyState, ErrorState, Spinner,
} from '../../components/ui/primitives.jsx';
import {
  useGetFmsAssignmentsQuery, useSaveFmsAssignmentMutation, useClearFmsAssignmentMutation,
} from '../../app/api/fmsApi.js';
import '../../styles/fms-assign.css';

/**
 * FMS · Assign Work — who does each job in a flow, and who covers them.
 *
 * THE QUESTION THIS ANSWERS. A flow is a sequence of steps, and each step is
 * one or more recurring jobs: Step 3 of the property flow is four
 * assessments, Step 5 is five documents. Every new property creates one task
 * per job, and until now who those tasks went to was decided by the project
 * template — a list of roster codes nobody outside the code has ever seen.
 * This is where the company says it instead, in names.
 *
 * NOT THE SAME AS ACCESS CONTROL, and kept apart on purpose. That screen
 * decides who may OPEN Step 3; this decides who Step 3's work is GIVEN to. A
 * regional head may need to see every assessment without one of them being
 * addressed to them, and an assessor needs their four jobs without being able
 * to reach the commercial documents at all.
 *
 * DOERS AND BUDDIES. The work goes to the doers — all of them see it, and the
 * first to finish closes it for the rest. A buddy is cover: they can see the
 * task and step in, but it never sits in their own list as work they owe.
 * That distinction is the client's own, and conflating the two would double
 * everybody's apparent workload.
 *
 * A ROW NOBODY HAS TOUCHED SAYS WHAT HAPPENS ANYWAY. It does not sit empty
 * and accusing — it states the fallback in words ("Om Prakash — the Technical
 * Expert named in the org sheet"), so an untouched screen is still readable
 * as the truth rather than as a to-do list.
 */

/* ── the people picker ─────────────────────────────────────────────────── */

/**
 * Pick several people. Not a multi-select <select>, which hides everything
 * until clicked, is unusable on touch, and gives no way to see at a glance
 * who is already on a job — which is the main thing this screen is read for.
 */
function PeoplePicker({
  value = [], people, onChange, placeholder, tone = 'doer',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const chosen = value.map((id) => people.find((p) => p.id === id)).filter(Boolean);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people
      .filter((p) => !value.includes(p.id))
      .filter((p) => !needle || `${p.name} ${p.title} ${p.email}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [people, value, q]);

  return (
    <div className={`fa-picker fa-picker--${tone}`}>
      <div className="fa-chips">
        {chosen.map((p) => (
          <span key={p.id} className="fa-chip" title={p.title || p.email}>
            <Avatar name={p.name} color={p.avatarColor} size={18} />
            {p.name}
            <button type="button" onClick={() => onChange(value.filter((id) => id !== p.id))} aria-label={`Remove ${p.name}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        <button type="button" className="fa-add" onClick={() => { setOpen((o) => !o); setQ(''); }}>
          <UserPlus size={13} /> {chosen.length ? 'Add' : placeholder}
        </button>
      </div>

      {open && (
        <div className="fa-menu">
          <div className="input-icon-wrap">
            <Search size={14} className="input-icon" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the menu opened because they mean to type a name */}
            <input className="input" autoFocus placeholder="Type a name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="fa-menu-list">
            {matches.length === 0 ? (
              <span className="tiny muted" style={{ padding: 8 }}>Nobody else matches.</span>
            ) : matches.map((p) => (
              <button
                key={p.id}
                type="button"
                className="fa-menu-item"
                onClick={() => { onChange([...value, p.id]); setOpen(false); setQ(''); }}
              >
                <Avatar name={p.name} color={p.avatarColor} size={22} />
                <span className="col" style={{ minWidth: 0 }}>
                  <span className="fa-menu-name">{p.name}</span>
                  <span className="tiny muted">{p.title || p.email}</span>
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="fa-menu-close" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}

/* ── one job ───────────────────────────────────────────────────────────── */

function JobRow({ row, people }) {
  const [draft, setDraft] = useState(null);
  const [save, saveState] = useSaveFmsAssignmentMutation();
  const [clear, clearState] = useClearFmsAssignmentMutation();

  const savedDoers = row.source === 'chosen' ? row.doers.map((d) => d.id) : [];
  const savedBuddies = row.source === 'chosen' ? row.buddies.map((d) => d.id) : [];
  const doers = draft?.doers ?? savedDoers;
  const buddies = draft?.buddies ?? savedBuddies;

  const dirty = draft !== null
    && (JSON.stringify(doers) !== JSON.stringify(savedDoers)
      || JSON.stringify(buddies) !== JSON.stringify(savedBuddies));

  const set = (patch) => setDraft({ doers, buddies, ...patch });
  const busy = saveState.isLoading || clearState.isLoading;

  const onSave = async () => {
    try {
      await save({ item: row.key, doers, buddies }).unwrap();
      setDraft(null);
    } catch {
      /* Toasted centrally; the edit stays so it can be retried. */
    }
  };

  return (
    <div className={`fa-row${dirty ? ' is-dirty' : ''}`}>
      <div className="fa-row-what">
        <span className="fa-row-label">{row.label}</span>
        {row.hint && <span className="tiny muted">{row.hint}</span>}
        {/* What happens today when nobody has chosen. Said in words, because
            an empty row otherwise reads as "this job reaches nobody". */}
        {row.source !== 'chosen' && (
          <span className="fa-fallback">
            <ShieldQuestion size={12} />
            {row.fallbackSays}
          </span>
        )}
      </div>

      <div className="fa-row-who">
        <label className="fa-field">
          <span className="fa-field-label">Doing it</span>
          <PeoplePicker
            value={doers}
            people={people}
            placeholder="Choose who does this"
            onChange={(next) => set({ doers: next })}
          />
        </label>

        <label className="fa-field">
          <span className="fa-field-label">
            Covering
            <span className="tiny muted"> · sees it, can step in</span>
          </span>
          <PeoplePicker
            value={buddies}
            people={people}
            tone="buddy"
            placeholder="Choose a buddy"
            onChange={(next) => set({ buddies: next })}
          />
        </label>
      </div>

      <div className="fa-row-actions">
        {dirty && (
          <>
            <button type="button" className="fa-btn" onClick={() => setDraft(null)} disabled={busy}>
              <X size={13} /> Discard
            </button>
            <button type="button" className="fa-btn is-blue" onClick={onSave} disabled={busy}>
              <Save size={13} /> {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
        {!dirty && row.source === 'chosen' && (
          <button
            type="button"
            className="fa-btn"
            disabled={busy}
            onClick={() => {
              // eslint-disable-next-line no-alert
              if (!window.confirm(`Clear "${row.label}"? It goes back to whoever the org sheet or the project template names.`)) return;
              setDraft(null);
              clear(row.key);
            }}
          >
            <RotateCcw size={13} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}

/* ── one step ──────────────────────────────────────────────────────────── */

function StepBlock({ step, rows, people, openByDefault }) {
  const [open, setOpen] = useState(openByDefault);
  const mine = rows.filter((r) => r.step === step.key);
  if (!mine.length) return null;

  const set = mine.filter((r) => r.source === 'chosen').length;

  return (
    <div className="fa-step">
      <button type="button" className="fa-step-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="col" style={{ minWidth: 0 }}>
          <b>{step.label}</b>
          <span className="tiny muted">{step.hint}</span>
        </span>
        <span className="fa-step-count">
          {mine.length} job{mine.length === 1 ? '' : 's'}
          {set > 0 && <> · {set} assigned</>}
        </span>
      </button>
      {open && <div className="fa-step-body">{mine.map((r) => <JobRow key={r.key} row={r} people={people} />)}</div>}
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export function FmsAssignPage() {
  const { data, isLoading, isError } = useGetFmsAssignmentsQuery();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.rows ?? [];
    return (data?.rows ?? []).filter((r) => `${r.label} ${r.stepLabel}`.toLowerCase().includes(q));
  }, [data, search]);

  const assigned = (data?.rows ?? []).filter((r) => r.source === 'chosen').length;

  return (
    <>
      <Topbar
        title={<span className="row gap-2" style={{ alignItems: 'center' }}><Workflow size={18} /> FMS · Assign Work</span>}
        subtitle="Who does each job in a flow, and who covers them"
      />

      <div className="content fa-page">
        <div className="fa-head">
          <div className="fa-tools">
            <div className="input-icon-wrap" style={{ width: 280 }}>
              <Search size={15} className="input-icon" />
              <input
                className="input"
                placeholder="Find a job — “feasibility”, “lease”…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {data && (
              <span className="tiny muted">
                {assigned} of {data.rows.length} jobs assigned by hand — the rest follow the org sheet
              </span>
            )}
          </div>
        </div>

        <div className="fa-note">
          <Info size={14} />
          <span>
            Every new property creates one task per job below, and it goes to whoever is named
            here. <b>Doing it</b> is the work — everyone listed sees it, and the first to finish
            closes it for the rest. <b>Covering</b> is the buddy: they can see it and step in, but
            it never sits in their own task list. Changing a job here affects work created from
            now on; tasks already out there stay with whoever has them.
          </span>
        </div>

        {isLoading ? (
          <Spinner label="Loading the flows…" />
        ) : isError ? (
          <ErrorState
            title="Could not load this screen"
            hint="It is open to the Managing Director, the Executive Assistant and Managers."
          />
        ) : !data?.fms?.length ? (
          <EmptyState icon={Users} title="No flows to assign yet" />
        ) : data.fms.map((fms) => (
          <section key={fms.key} className="fa-fms">
            <div className="fa-fms-head">
              <h2>{fms.label}</h2>
              <span className="tiny muted">{fms.hint}</span>
            </div>
            {fms.steps.map((step, i) => (
              <StepBlock
                key={step.key}
                step={step}
                rows={rows}
                people={data.people}
                openByDefault={i === 2 || Boolean(search.trim())}
              />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

export default FmsAssignPage;
