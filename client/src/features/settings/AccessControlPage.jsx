import { useMemo, useState } from 'react';
import {
  ShieldCheck, Users, Search, RotateCcw, Save, Info, AlertTriangle,
  ChevronDown, ChevronRight, UserCog, Layers, Trash2, X, Eye,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  Avatar, Badge, EmptyState, ErrorState, Spinner,
} from '../../components/ui/primitives.jsx';
import {
  useGetAccessCatalogQuery, useGetAccessPolicyQuery, useGetAccessPeopleQuery,
  useGetAccessPreviewQuery, useSaveRoleAccessMutation, useResetRoleAccessMutation,
  useSaveUserAccessMutation, useClearUserAccessMutation,
} from '../../app/api/accessApi.js';
import {
  ACCESS, ACCESS_LABELS, ACCESS_HINTS, ACCESS_COLORS, ACCESS_RANK, INHERIT,
} from '../../lib/access.js';
import '../../styles/access.css';

/**
 * Access Control — who sees which module, which STEP of which flow, and what
 * they may do once they are there.
 *
 * THE PROBLEM THIS SCREEN SOLVES. Every FMS in this ERP is a flow of steps:
 * property capture runs six (all properties, MD review, assessment, MD
 * approval, commercial, project creation), hiring runs five, purchase three.
 * The steps exist because different people own different ones. Until this
 * screen there was no way to say so — the nav policy was a table in the
 * source, it worked on whole modules only, and every doer was handed all six
 * property steps and left to work out which two were theirs.
 *
 * TWO TABS, BECAUSE THERE ARE TWO REAL QUESTIONS.
 *
 *   BY ROLE is the standing policy — what a Manager gets, what an Employee
 *   gets. It is where nearly every decision belongs, because it keeps
 *   working when somebody leaves and their replacement is hired.
 *
 *   BY PERSON is the exception, and the ERP needs one: two site engineers on
 *   the same grade genuinely do different halves of the property flow, and
 *   inventing a role for each of them would be worse. An override is a thin
 *   layer over the role, one key at a time, and setting a key back to "Same
 *   as role" removes it rather than freezing today's answer.
 *
 * WHAT IS SAVED IS ONLY WHAT WAS CHANGED. A cell left at its default writes
 * nothing. That is deliberate and it matters a year from now: a policy that
 * stored all forty answers would be a frozen copy of the defaults as they
 * were on the day it was saved, and the next module to ship would be
 * invisible to everyone who had ever pressed Save.
 *
 * THE CASCADE IS SHOWN, NOT ENFORCED HERE. Hiding a module hides its steps —
 * but the steps keep their own values, and the screen greys them instead of
 * rewriting them, so turning the module back on restores the flow the admin
 * had already built rather than a row of blanks.
 */

const LEVELS = [ACCESS.NONE, ACCESS.VIEW, ACCESS.EDIT, ACCESS.MANAGE];

/** Compact, colour-coded level picker. A native select on purpose: forty
 *  rows times five roles is two hundred controls, and two hundred segmented
 *  button groups is a page that scrolls badly and reads worse. */
function LevelSelect({
  value, onChange, disabled, options = LEVELS, inheritLabel, dimmed, title,
}) {
  const color = ACCESS_COLORS[value] ?? '#9AA0A6';
  return (
    <select
      className={`ac-level ac-level--${value}${dimmed ? ' is-dimmed' : ''}`}
      style={{ '--lvl': color }}
      value={value}
      disabled={disabled}
      title={title ?? ACCESS_HINTS[value]}
      onChange={(e) => onChange(e.target.value)}
    >
      {inheritLabel && <option value={INHERIT}>{inheritLabel}</option>}
      {options.map((l) => <option key={l} value={l}>{ACCESS_LABELS[l]}</option>)}
    </select>
  );
}

/** The four words, explained once, above both tabs. */
function LevelLegend() {
  return (
    <div className="ac-legend">
      {LEVELS.map((l) => (
        <span key={l} className="ac-legend-item" title={ACCESS_HINTS[l]}>
          <i style={{ background: ACCESS_COLORS[l] }} />
          <b>{ACCESS_LABELS[l]}</b>
          <span className="tiny muted">{ACCESS_HINTS[l]}</span>
        </span>
      ))}
    </div>
  );
}

/* ══ Tab 1 · By role ═══════════════════════════════════════════════════ */

function RoleMatrix({ catalog, policy, search, showSteps }) {
  const roles = catalog.roles ?? [];
  /** role -> { surfaceKey: level } — only what this session has changed. */
  const [draft, setDraft] = useState({});
  const [closed, setClosed] = useState({});
  const [saveRole, saveState] = useSaveRoleAccessMutation();
  const [resetRole, resetState] = useResetRoleAccessMutation();

  /** The value a cell shows: this session's edit, then the saved policy,
   *  then the shipped default. Uncascaded — the clamp is drawn, not stored. */
  const valueOf = (role, key) => draft[role]?.[key]
    ?? policy.roles[role]?.saved?.[key]
    ?? policy.roles[role]?.defaults?.[key]
    ?? ACCESS.NONE;

  const defaultOf = (role, key) => policy.roles[role]?.defaults?.[key] ?? ACCESS.NONE;

  const setCell = (role, key, level) => setDraft((d) => ({
    ...d, [role]: { ...(d[role] ?? {}), [key]: level },
  }));

  /** Every role this session has actually changed, with its unsaved cells. */
  const dirtyRoles = Object.keys(draft).filter((role) => Object
    .entries(draft[role] ?? {})
    .some(([key, level]) => level !== (policy.roles[role]?.saved?.[key] ?? defaultOf(role, key))));

  /**
   * What gets persisted for one role: every cell that differs from the
   * shipped default, and nothing else. See the note at the top of the file
   * for why a full copy would rot.
   */
  const grantsFor = (role) => {
    const merged = { ...(policy.roles[role]?.saved ?? {}), ...(draft[role] ?? {}) };
    const out = {};
    for (const [key, level] of Object.entries(merged)) {
      if (level !== defaultOf(role, key)) out[key] = level;
    }
    return out;
  };

  /**
   * One request per changed role, in order.
   *
   * The draft is cleared only for roles that actually saved — a failure
   * mid-way must leave the rest of the edit on screen rather than silently
   * discarding work the server never received. The refusal itself is already
   * a toast (app/middleware/errorMiddleware.js).
   */
  const save = async () => {
    const done = [];
    try {
      for (const role of dirtyRoles) {
        // eslint-disable-next-line no-await-in-loop -- at most five, and order is worth the wait
        await saveRole({ role, grants: grantsFor(role) }).unwrap();
        done.push(role);
      }
    } catch {
      /* Toasted centrally; what matters here is not losing the unsaved rest. */
    }
    setDraft((d) => {
      const next = { ...d };
      for (const role of done) delete next[role];
      return next;
    });
  };

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.sections
      .map((section) => ({
        ...section,
        surfaces: section.surfaces.filter((s) => {
          if (!showSteps && s.kind !== 'module') return false;
          if (!q) return true;
          return `${s.label} ${section.label} ${s.key}`.toLowerCase().includes(q);
        }),
      }))
      .filter((section) => section.surfaces.length > 0);
  }, [catalog.sections, search, showSteps]);

  const busy = saveState.isLoading || resetState.isLoading;

  return (
    <>
      {dirtyRoles.length > 0 && (
        <div className="ac-savebar">
          <AlertTriangle size={15} />
          <span>
            Unsaved changes to <b>{dirtyRoles.map((r) => policy.roles[r]?.label ?? r).join(', ')}</b>.
            {' '}Everyone in {dirtyRoles.length === 1 ? 'that role' : 'those roles'} is affected the
            {' '}moment this is saved.
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft({})} disabled={busy}>
            <X size={14} /> Discard
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            <Save size={14} /> {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      <div className="ac-matrix-wrap">
        <table className="ac-matrix">
          <thead>
            <tr>
              <th className="ac-col-surface">Module / step</th>
              {roles.map((r) => (
                <th key={r.value} className="ac-col-role">
                  <div className="col" style={{ alignItems: 'center', gap: 2 }}>
                    <span>{r.label}</span>
                    <button
                      type="button"
                      className="ac-reset"
                      title={`Put ${r.label} back to the shipped defaults`}
                      disabled={busy}
                      onClick={() => {
                        /* Confirmed, because it discards every decision the
                           company ever made for this role in one click and
                           there is no undo — the previous values are gone. */
                        // eslint-disable-next-line no-alert
                        if (!window.confirm(`Put ${r.label} back to the shipped defaults? Every change made for this role is discarded.`)) return;
                        setDraft((d) => { const n = { ...d }; delete n[r.value]; return n; });
                        resetRole(r.value);
                      }}
                    >
                      <RotateCcw size={11} /> reset
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {sections.map((section) => {
            const isClosed = closed[section.key];
            return (
              <tbody key={section.key}>
                <tr className="ac-section-row">
                  <td colSpan={roles.length + 1}>
                    <button type="button" className="ac-section-btn" onClick={() => setClosed((c) => ({ ...c, [section.key]: !c[section.key] }))}>
                      {isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      <b>{section.label}</b>
                      <span className="tiny muted">{section.hint}</span>
                    </button>
                  </td>
                </tr>

                {!isClosed && section.surfaces.map((surface) => (
                  <tr key={surface.key} className={`ac-row ac-row--${surface.kind}`}>
                    <td className="ac-col-surface">
                      <div className="ac-surface">
                        <span className={`ac-kind ac-kind--${surface.kind}`}>
                          {surface.kind === 'module' ? 'Module' : surface.kind === 'step' ? 'Step' : 'Stage'}
                        </span>
                        <span className="ac-surface-label">{surface.label}</span>
                        {surface.hint && <span className="tiny muted ac-surface-hint">{surface.hint}</span>}
                      </div>
                    </td>

                    {roles.map((r) => {
                      const value = valueOf(r.value, surface.key);
                      const isDefault = value === defaultOf(r.value, surface.key);
                      /* A child of a hidden module. Drawn dim rather than
                         rewritten: turning the module back on must restore
                         the flow that was already built here. */
                      const parentHidden = surface.parent
                        && ACCESS_RANK[valueOf(r.value, surface.parent)] === 0
                        && ACCESS_RANK[value] > 0;
                      return (
                        <td key={r.value} className="ac-col-role">
                          <LevelSelect
                            value={value}
                            dimmed={parentHidden}
                            title={parentHidden
                              ? `${surface.label} is set to "${ACCESS_LABELS[value]}", but the module above it is hidden for ${r.label}, so nobody in this role reaches it.`
                              : ACCESS_HINTS[value]}
                            options={surface.maxLevel
                              ? LEVELS.filter((l) => ACCESS_RANK[l] <= ACCESS_RANK[surface.maxLevel])
                              : LEVELS}
                            onChange={(level) => setCell(r.value, surface.key, level)}
                          />
                          {!isDefault && <span className="ac-changed" title="Changed from the shipped default" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </>
  );
}

/* ══ Tab 2 · By person ═════════════════════════════════════════════════ */

/** What one person actually ends up with, and why — the preview panel. */
function PersonEffect({ userId }) {
  const { data, isLoading } = useGetAccessPreviewQuery(userId, { skip: !userId });
  if (isLoading) return <Spinner label="Working out what they see…" />;
  if (!data) return null;

  const visible = data.rows.filter((r) => ACCESS_RANK[r.level] > 0);
  const hidden = data.rows.filter((r) => ACCESS_RANK[r.level] === 0);

  return (
    <div className="ac-effect">
      <div className="ac-effect-head">
        <Eye size={14} />
        <b>{data.user.name} reaches {visible.length} of {data.rows.length}</b>
        <span className="tiny muted">{hidden.length} hidden</span>
      </div>
      <div className="ac-effect-list">
        {visible.map((r) => (
          <span key={r.key} className="ac-chip" style={{ '--lvl': ACCESS_COLORS[r.level] }} title={`${ACCESS_LABELS[r.level]} — ${r.source === 'person' ? 'set for this person' : r.source === 'role' ? 'from their role policy' : r.source === 'module' ? 'limited by the module above it' : 'the shipped default'}`}>
            {r.label}
            {r.source === 'person' && <i className="ac-chip-dot" />}
          </span>
        ))}
      </div>
    </div>
  );
}

function PersonTab({ catalog, policy, search, showSteps }) {
  const [picked, setPicked] = useState(null);
  const [people, setPeople] = useState('');
  const [draft, setDraft] = useState({});
  const [note, setNote] = useState('');

  const { data: list = [], isLoading: peopleLoading } = useGetAccessPeopleQuery({ search: people || undefined });
  const [saveUser, saveState] = useSaveUserAccessMutation();
  const [clearUser, clearState] = useClearUserAccessMutation();

  const saved = useMemo(() => {
    const row = policy.people.find((p) => String(p.userId) === String(picked?.id));
    return row?.grants ?? {};
  }, [policy.people, picked]);

  const roleLevels = picked ? (policy.roles[picked.role]?.levels ?? {}) : {};

  const valueOf = (key) => draft[key] ?? saved[key] ?? INHERIT;
  const dirty = Object.entries(draft).some(([key, v]) => v !== (saved[key] ?? INHERIT));

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.sections
      .map((section) => ({
        ...section,
        surfaces: section.surfaces.filter((s) => {
          if (!showSteps && s.kind !== 'module') return false;
          if (!q) return true;
          return `${s.label} ${section.label} ${s.key}`.toLowerCase().includes(q);
        }),
      }))
      .filter((section) => section.surfaces.length > 0);
  }, [catalog.sections, search, showSteps]);

  const save = async () => {
    const merged = { ...saved, ...draft };
    /* "Same as role" is a removal, not a stored value — a person's override
       list is read as the ways they differ from their role, and a row that
       differs in no way only makes the list longer. */
    const grants = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== INHERIT));
    try {
      await saveUser({ userId: picked.id, grants, note: note || undefined }).unwrap();
      setDraft({});
    } catch {
      /* Toasted centrally. The edit stays on screen so it can be retried. */
    }
  };

  return (
    <div className="ac-people">
      <aside className="ac-people-list">
        <div className="input-icon-wrap">
          <Search size={15} className="input-icon" />
          <input
            className="input" placeholder="Find a person…"
            value={people} onChange={(e) => setPeople(e.target.value)}
          />
        </div>

        {peopleLoading ? <Spinner /> : list.length === 0 ? (
          <EmptyState icon={Users} title="Nobody matches" hint="Search by name, email, title or employee code." />
        ) : (
          <div className="ac-person-rows">
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`ac-person${picked?.id === p.id ? ' is-on' : ''}`}
                onClick={() => { setPicked(p); setDraft({}); setNote(''); }}
              >
                <Avatar name={p.name} color={p.avatarColor} size={26} />
                <span className="col" style={{ minWidth: 0 }}>
                  <span className="ac-person-name">{p.name}</span>
                  <span className="tiny muted">{p.title || policy.roles[p.role]?.label || p.role}</span>
                </span>
                {p.hasOverrides && <Badge color="#6741D9" soft>own rules</Badge>}
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="ac-person-editor">
        {!picked ? (
          <EmptyState
            icon={UserCog}
            title="Pick a person to give them their own rules"
            hint="Nearly every decision belongs on the By role tab — it keeps working when somebody leaves. Use this for the genuine exceptions: the one site engineer who works assessments and nothing else."
          />
        ) : (
          <>
            <div className="ac-person-head">
              <Avatar name={picked.name} color={picked.avatarColor} size={38} />
              <div className="col" style={{ minWidth: 0 }}>
                <b>{picked.name}</b>
                <span className="tiny muted">
                  {picked.email} · follows <b>{policy.roles[picked.role]?.label ?? picked.role}</b> wherever
                  {' '}nothing is set below
                </span>
              </div>
              <div className="row gap-2" style={{ marginLeft: 'auto' }}>
                {Object.keys(saved).length > 0 && (
                  <button
                    type="button" className="btn btn-ghost btn-sm"
                    disabled={clearState.isLoading}
                    onClick={() => {
                      // eslint-disable-next-line no-alert
                      if (!window.confirm(`Remove every rule set for ${picked.name}? They go back to following their role.`)) return;
                      clearUser(picked.id);
                      setDraft({});
                    }}
                    title="Remove every rule set for this person — they follow their role again"
                  >
                    <Trash2 size={14} /> Clear all
                  </button>
                )}
                <button
                  type="button" className="btn btn-primary btn-sm"
                  disabled={!dirty || saveState.isLoading}
                  onClick={save}
                >
                  <Save size={14} /> {saveState.isLoading ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <PersonEffect userId={picked.id} />

            <input
              className="input ac-note"
              placeholder="Why does this person differ? (shown beside their name)"
              value={note || policy.people.find((p) => String(p.userId) === String(picked.id))?.note || ''}
              onChange={(e) => setNote(e.target.value)}
            />

            <div className="ac-matrix-wrap">
              <table className="ac-matrix ac-matrix--person">
                <thead>
                  <tr>
                    <th className="ac-col-surface">Module / step</th>
                    <th className="ac-col-role">Their role gives</th>
                    <th className="ac-col-role">This person</th>
                  </tr>
                </thead>

                {sections.map((section) => (
                  <tbody key={section.key}>
                    <tr className="ac-section-row">
                      <td colSpan={3}><b>{section.label}</b></td>
                    </tr>
                    {section.surfaces.map((surface) => {
                      const fromRole = roleLevels[surface.key] ?? ACCESS.NONE;
                      const value = valueOf(surface.key);
                      return (
                        <tr key={surface.key} className={`ac-row ac-row--${surface.kind}`}>
                          <td className="ac-col-surface">
                            <div className="ac-surface">
                              <span className={`ac-kind ac-kind--${surface.kind}`}>
                                {surface.kind === 'module' ? 'Module' : surface.kind === 'step' ? 'Step' : 'Stage'}
                              </span>
                              <span className="ac-surface-label">{surface.label}</span>
                            </div>
                          </td>
                          <td className="ac-col-role">
                            <span className="ac-inherited" style={{ '--lvl': ACCESS_COLORS[fromRole] }}>
                              {ACCESS_LABELS[fromRole]}
                            </span>
                          </td>
                          <td className="ac-col-role">
                            <LevelSelect
                              value={value}
                              inheritLabel={`Same as role (${ACCESS_LABELS[fromRole]})`}
                              options={surface.maxLevel
                                ? LEVELS.filter((l) => ACCESS_RANK[l] <= ACCESS_RANK[surface.maxLevel])
                                : LEVELS}
                              onChange={(level) => setDraft((d) => ({ ...d, [surface.key]: level }))}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ══ The page ══════════════════════════════════════════════════════════ */

export function AccessControlPage() {
  const [tab, setTab] = useState('role');
  const [search, setSearch] = useState('');
  const [showSteps, setShowSteps] = useState(true);

  const { data: catalog, isLoading: catalogLoading, isError: catalogError } = useGetAccessCatalogQuery();
  const { data: policy, isLoading: policyLoading, isError: policyError } = useGetAccessPolicyQuery();

  const loading = catalogLoading || policyLoading;
  const failed = catalogError || policyError;

  const overridden = policy?.people?.length ?? 0;

  return (
    <div className="content ac-page">
      <Topbar
        title="Access Control"
        subtitle="Who sees which module, which step of which flow, and what they may do there"
      />

      <div className="ac-head">
        <div className="ac-head-left">
          <span className="ac-head-icon"><ShieldCheck size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <h1 className="ac-head-title">Access Control</h1>
            <p className="ac-head-sub">
              Every module and every step of every FMS, granted at one of four levels. Set the
              standing policy by role; give a named person their own rules only where the role
              genuinely does not fit. Hiding something here hides the sidebar entry, refuses the
              URL, and refuses the API — all three, or it is not hidden.
            </p>
          </div>
        </div>
      </div>

      <div className="ac-tabs">
        <button type="button" className={`ac-tab${tab === 'role' ? ' is-on' : ''}`} onClick={() => setTab('role')}>
          <Layers size={15} /> By role
        </button>
        <button type="button" className={`ac-tab${tab === 'person' ? ' is-on' : ''}`} onClick={() => setTab('person')}>
          <UserCog size={15} /> By person
          {overridden > 0 && <span className="ac-tab-count">{overridden}</span>}
        </button>

        <div className="ac-tools">
          <div className="input-icon-wrap" style={{ width: 240 }}>
            <Search size={15} className="input-icon" />
            <input
              className="input" placeholder="Find a module or step…"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="ac-toggle" title="Modules only, or every step and pipeline stage inside them">
            <input type="checkbox" checked={showSteps} onChange={(e) => setShowSteps(e.target.checked)} />
            <span>Show steps &amp; stages</span>
          </label>
        </div>
      </div>

      <LevelLegend />

      <div className="ac-note-strip">
        <Info size={14} />
        <span>
          Nothing is stored for a cell left at its default, so a module added to the ERP later
          reaches everyone it was meant for instead of being invisible to whoever pressed Save
          first. The Managing Director cannot be locked out of this screen — the server refuses it.
        </span>
      </div>

      {loading ? (
        <Spinner label="Loading the catalogue…" />
      ) : failed ? (
        <ErrorState
          title="Could not load the access policy"
          hint="Only the Managing Director and the Executive Assistant can open this screen by default."
        />
      ) : tab === 'role' ? (
        <RoleMatrix catalog={catalog} policy={policy} search={search} showSteps={showSteps} />
      ) : (
        <PersonTab catalog={catalog} policy={policy} search={search} showSteps={showSteps} />
      )}
    </div>
  );
}

export default AccessControlPage;
