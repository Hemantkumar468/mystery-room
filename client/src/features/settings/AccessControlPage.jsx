import { useMemo, useState } from 'react';
import {
  ShieldCheck, Users, Search, RotateCcw, Save, Info, AlertTriangle,
  ChevronDown, ChevronRight, UserCog, Layers, Trash2, X, Eye, EyeOff, Pencil, Check,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  Avatar, Badge, EmptyState, ErrorState, Spinner,
} from '../../components/ui/primitives.jsx';
import {
  useGetAccessCatalogQuery, useGetAccessPolicyQuery, useGetAccessPeopleQuery,
  useGetAccessPreviewQuery, useSaveRoleAccessMutation, useResetRoleAccessMutation,
  useSaveJobRoleAccessMutation, useResetJobRoleAccessMutation,
  useSaveUserAccessMutation, useClearUserAccessMutation,
} from '../../app/api/accessApi.js';
import { ACCESS, ACCESS_RANK, INHERIT } from '../../lib/access.js';
import '../../styles/access.css';

/**
 * Access Control — who can open what, and what they can do there.
 *
 * WRITTEN FOR SOMEBODY WHO IS NOT TECHNICAL. The person who decides that a
 * Feasibility Expert works Step 3 and nothing else runs the business; they do
 * not know what a "surface" or a "grant" is and should never have to. So the
 * screen is four buttons repeated down a page — Hidden, Can view, Can edit,
 * Full — with sections folded until opened, a sentence under every heading,
 * and one line at the top that says in words what the role ends up with.
 *
 * DELIBERATELY NOT ON SCREEN: the words policy, grant, surface or cascade,
 * and any internal key. The cascade is SHOWN instead — a step under a hidden
 * section is greyed, and hovering it says why.
 *
 * TWO TABS, BECAUSE THERE ARE TWO REAL QUESTIONS.
 *
 *   BY ROLE is the standing decision and where nearly everything belongs: it
 *   keeps working when somebody leaves and their replacement is hired. The
 *   roles are the company's own, from SHEET/USERROLE.xlsx — Civil Head, IT
 *   Head, Cluster / Branch Manager — not the software's five access tiers.
 *
 *   ONE PERSON ONLY is the exception. Two site engineers on the same grade do
 *   different halves of the property flow, and inventing a role per person
 *   would be worse.
 *
 * ONLY WHAT WAS CHANGED IS SAVED. A row left alone writes nothing, so a
 * module added to the ERP next year reaches everyone it was meant for instead
 * of being invisible to every role somebody had already pressed Save on.
 */

/* ── the four answers, in the words the screen uses ────────────────────── */

const LEVELS = [
  {
    value: ACCESS.NONE,
    label: 'Hidden',
    icon: EyeOff,
    color: '#8A9099',
    says: 'They never see it. Not in the menu, and the page refuses to open.',
  },
  {
    value: ACCESS.VIEW,
    label: 'Can view',
    icon: Eye,
    color: '#0EA5E9',
    says: 'They can open it and read it. Nothing they do there will save.',
  },
  {
    value: ACCESS.EDIT,
    label: 'Can edit',
    icon: Pencil,
    color: '#16A34A',
    says: 'They can do the work here — fill it in, update it, move it along.',
  },
  {
    value: ACCESS.MANAGE,
    label: 'Full',
    icon: ShieldCheck,
    color: '#6741D9',
    says: 'All of the above, plus approving, rejecting and changing settings.',
  },
];

const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.value, l]));
const LEVEL_VALUES = LEVELS.map((l) => l.value);

/* The words the business already uses for these things. "Module" is what
   the sidebar calls Purchase and HRMS and what everybody says out loud; the
   fold above a group of them is the section. Calling both "section" made a
   module row look like a repeat of its own heading. */
const KIND_LABEL = { module: 'Module', step: 'Step', stage: 'Stage' };

/** Access tiers, strongest first — how the role list is grouped. */
const TIER_ORDER = ['md', 'ea', 'manager', 'employee', 'viewer'];
const TIER_LABEL = {
  md: 'Managing Director', ea: 'Executive Assistant', manager: 'Manager', employee: 'Employee', viewer: 'Viewer',
};
const TIER_HINT = {
  md: 'Can do anything, including things that cannot be undone',
  ea: 'The MD’s desk, minus the irreversible',
  manager: 'Runs the work: assigns it, approves it',
  employee: 'Does the work: fills things in and submits them',
  viewer: 'Reads only. Never changes anything',
};

const SOURCE_SAID = {
  person: 'set for this person by name',
  jobRole: 'comes from their role',
  role: 'comes from their access tier — they have no role in the org sheet',
  module: 'the section above it is hidden, so this is out of reach',
  default: 'nobody has changed it — the normal setting for their role',
};

/* ── the control everything is made of ─────────────────────────────────── */

/**
 * Four buttons, not a dropdown.
 *
 * A dropdown hides three of the four answers until it is clicked, which makes
 * a page of them impossible to scan — you cannot see at a glance that one row
 * in twenty is set differently, and that is the single most useful thing this
 * screen can tell anybody. Buttons show the answer AND the alternatives at
 * once, read without clicking, and are far easier to hit on a trackpad.
 */
function LevelPicker({
  value, onChange, allowed = LEVEL_VALUES, inherit = false, inheritOf = null, dimmed = false, why = '',
}) {
  return (
    <div className={`lv${dimmed ? ' is-dimmed' : ''}`} title={why || undefined}>
      {inherit && (
        <button
          type="button"
          className={`lv-btn${value === INHERIT ? ' is-on' : ''}`}
          style={{ '--c': '#8A9099' }}
          onClick={() => onChange(INHERIT)}
          title={inheritOf ? `Follow their role — which gives ${LEVEL[inheritOf]?.label}` : 'Follow their role'}
        >
          <Check size={13} />
          <span>Same as role</span>
        </button>
      )}
      {LEVELS.filter((l) => allowed.includes(l.value)).map((l) => (
        <button
          key={l.value}
          type="button"
          className={`lv-btn${value === l.value ? ' is-on' : ''}`}
          style={{ '--c': l.color }}
          onClick={() => onChange(l.value)}
          title={l.says}
        >
          <l.icon size={13} />
          <span>{l.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The four answers explained once, at the top, in full sentences. */
function Legend() {
  return (
    <div className="ac-legend">
      {LEVELS.map((l) => (
        <div key={l.value} className="ac-legend-item">
          <span className="ac-legend-chip" style={{ '--c': l.color }}>
            <l.icon size={13} /> {l.label}
          </span>
          <span className="tiny muted">{l.says}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Who holds a role, said once.
 *
 * Several seats in the org sheet are shared mailboxes whose account is named
 * after the seat itself — `marketing@mysteryrooms.in` is called "Marketing
 * Head" — so printing the role and then the holder gives "Marketing Head /
 * Marketing Head", which reads as a bug. Where the name adds nothing, the
 * address does.
 */
const heldBy = (role, cap = 0) => {
  const names = (role.holders ?? [])
    .map((h) => (h.name?.trim().toLowerCase() === (role.title ?? role.label ?? '').trim().toLowerCase()
      ? h.email : h.name));
  if (!cap || names.length <= cap) return names.join(', ');
  return `${names.slice(0, cap).join(', ')} +${names.length - cap} more`;
};

/** "5 people" / "1 person" / "nobody". Said the same way for every layer. */
const reachCount = (layer) => {
  const n = (layer?.holders ?? []).length;
  return n === 0 ? 'nobody' : n === 1 ? '1 person' : `${n} people`;
};

/** Which sections to draw, after the search box. */
function useSections(catalog, search) {
  return useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog.sections ?? [])
      .map((section) => ({
        ...section,
        surfaces: section.surfaces.filter((s) => !q || `${s.label} ${section.label}`.toLowerCase().includes(q)),
      }))
      .filter((section) => section.surfaces.length > 0);
  }, [catalog.sections, search]);
}

/**
 * One section — the things in it, with its flow's steps indented underneath.
 *
 * FOLDED BY DEFAULT, and this is the single biggest thing that makes the
 * screen readable. Flat, it is fifty-four rows of identical controls and the
 * eye cannot tell a whole module from one step of one flow. Folded, it is a
 * dozen names somebody recognises from their own sidebar, with the detail one
 * click away on the one they actually came to change.
 */
function SectionBlock({
  section, valueOf, onSet, onSetSection, openByDefault, person = false,
}) {
  const [open, setOpen] = useState(openByDefault);
  /* `useState` reads its argument ONCE. So a section folded before you typed
     stayed folded through the search: you searched "New Store", the section
     holding it reported "3 things" and showed you none of them, and the row
     you were looking for was one click away with nothing saying so. Re-sync
     whenever the answer changes — the same derived-state pattern RoleEditor
     uses to clear its draft when the role changes. */
  const [lastDefault, setLastDefault] = useState(openByDefault);
  if (lastDefault !== openByDefault) { setLastDefault(openByDefault); setOpen(openByDefault); }
  const modules = section.surfaces.filter((s) => s.kind === 'module');
  const childrenOf = (key) => section.surfaces.filter((s) => s.parent === key);
  const orphans = section.surfaces.filter((s) => s.kind !== 'module' && !modules.some((m) => m.key === s.parent));
  const stepCount = section.surfaces.length - modules.length;

  /**
   * WHAT THE WHOLE SECTION IS SET TO, or nothing when its rows disagree.
   *
   * This is what makes "hide all of PMS" one click instead of thirteen. Some
   * sections are a single module with its steps underneath — hiding the
   * module already takes the steps with it, because a step cannot be more
   * open than what contains it. But PMS, Master Data and Administration are
   * LISTS of separate modules with no parent between them, so there was
   * nothing to click once. Now every section has the same switch, and the
   * reader does not have to know which shape they are looking at.
   */
  const levels = section.surfaces.map((x) => valueOf(x.key));
  const uniform = levels.every((l) => l === levels[0]) ? levels[0] : null;

  const row = (surface, inside) => {
    const value = valueOf(surface.key);
    const parentValue = surface.parent ? valueOf(surface.parent) : null;
    /* Its own answer is kept — turning the section back on must restore the
       flow already built here — but nobody reaches it today, and the screen
       has to say so rather than let it read as live. */
    const outOfReach = surface.parent
      && ACCESS_RANK[parentValue === INHERIT ? (surface.roleLevel ?? ACCESS.NONE) : parentValue] === 0
      && ACCESS_RANK[value === INHERIT ? (surface.roleLevel ?? ACCESS.NONE) : value] > 0;

    return (
      <div key={surface.key} className={`ac-line${inside ? ' is-inside' : ''}`}>
        <div className="ac-line-what">
          <span className={`ac-kind ac-kind--${surface.kind}`}>{KIND_LABEL[surface.kind]}</span>
          {/* Several sections hold one module of the same name — "Property
              Capturing FMS" inside "Property Capturing FMS" — and printing it
              twice, once as the fold header and again as the first row, makes
              the row look like a repeat rather than the switch for the whole
              thing. Said plainly instead. */}
          <span className="ac-line-label">
            {surface.label === section.label ? 'The whole module' : surface.label}
          </span>
          {surface.hint && <span className="tiny muted ac-line-hint">{surface.hint}</span>}
        </div>
        <LevelPicker
          value={value}
          dimmed={outOfReach}
          why={outOfReach ? 'The section above this one is hidden, so nobody reaches this yet.' : ''}
          allowed={surface.maxLevel
            ? LEVEL_VALUES.filter((v) => ACCESS_RANK[v] <= ACCESS_RANK[surface.maxLevel])
            : LEVEL_VALUES}
          inherit={person}
          inheritOf={person ? surface.roleLevel : null}
          onChange={(level) => onSet(surface.key, level)}
        />
      </div>
    );
  };

  return (
    <div className="ac-block">
      {/* A row, not one big button: the fold and the whole-section switch are
          two different actions and a <button> may not contain buttons. */}
      <div className="ac-block-head">
        <button type="button" className="ac-block-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="col" style={{ minWidth: 0 }}>
            <b>{section.label}</b>
            <span className="tiny muted">{section.hint}</span>
          </span>
        </button>

        <div className="ac-block-right">
          <span className="ac-block-count">
            {section.surfaces.length} thing{section.surfaces.length === 1 ? '' : 's'}
            {stepCount > 0 && <>, {stepCount} of them steps</>}
          </span>
          <span className="tiny muted ac-block-setall">Set the whole section</span>
          <LevelPicker
            value={uniform}
            inherit={person}
            onChange={(level) => onSetSection(section, level)}
          />
        </div>
      </div>

      {open && (
        <div className="ac-block-body">
          {modules.map((m) => (
            <div key={m.key} className="ac-group">
              {row(m, false)}
              {childrenOf(m.key).length > 0 && (
                <div className="ac-children">{childrenOf(m.key).map((c) => row(c, true))}</div>
              )}
            </div>
          ))}
          {orphans.length > 0 && <div className="ac-children">{orphans.map((c) => row(c, true))}</div>}
        </div>
      )}
    </div>
  );
}

/* ══ By role ═══════════════════════════════════════════════════════════ */

function RoleEditor({
  catalog, policy, search, roleKey, kind,
}) {
  const layer = kind === 'jobRole' ? policy.roles[roleKey] : policy.tiers[roleKey];
  const [draft, setDraft] = useState({});
  const [saveJobRole, saveJobState] = useSaveJobRoleAccessMutation();
  const [resetJobRole, resetJobState] = useResetJobRoleAccessMutation();
  const [saveTier, saveTierState] = useSaveRoleAccessMutation();
  const [resetTier, resetTierState] = useResetRoleAccessMutation();

  /* Forget the pending edit when the chosen role changes, so half a change to
     Civil Head cannot be saved onto IT Head by clicking away and back. */
  const [lastKey, setLastKey] = useState(roleKey);
  if (lastKey !== roleKey) { setLastKey(roleKey); setDraft({}); }

  const busy = saveJobState.isLoading || resetJobState.isLoading
    || saveTierState.isLoading || resetTierState.isLoading;

  const valueOf = (key) => draft[key] ?? layer?.saved?.[key] ?? layer?.defaults?.[key] ?? ACCESS.NONE;
  const defaultOf = (key) => layer?.defaults?.[key] ?? ACCESS.NONE;
  const setOne = (key, level) => setDraft((d) => ({ ...d, [key]: level }));

  const sections = useSections(catalog, search);
  const allKeys = useMemo(() => (catalog.surfaces ?? []).map((s) => s.key), [catalog.surfaces]);

  const dirty = Object.entries(draft).some(([k, v]) => v !== (layer?.saved?.[k] ?? defaultOf(k)));
  const changed = allKeys.filter((k) => valueOf(k) !== defaultOf(k)).length;

  /** In words, because a count of levels is not an answer anybody asked for. */
  const tally = allKeys.reduce((t, k) => {
    const r = ACCESS_RANK[valueOf(k)];
    return {
      open: t.open + (r > 0 ? 1 : 0),
      edit: t.edit + (r >= 2 ? 1 : 0),
      full: t.full + (r >= 3 ? 1 : 0),
    };
  }, { open: 0, edit: 0, full: 0 });

  /** Every row that differs from the normal setting, and nothing else. */
  const grants = () => {
    const merged = { ...(layer?.saved ?? {}), ...draft };
    const out = {};
    for (const [k, v] of Object.entries(merged)) if (v !== defaultOf(k)) out[k] = v;
    return out;
  };

  const save = async () => {
    try {
      if (kind === 'jobRole') await saveJobRole({ key: roleKey, grants: grants() }).unwrap();
      else await saveTier({ role: roleKey, grants: grants() }).unwrap();
      setDraft({});
    } catch {
      /* Already a toast (app/middleware/errorMiddleware.js). The edit stays on
         screen so it can be retried rather than retyped. */
    }
  };

  const reset = () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Put ${layer?.title ?? layer?.label} back to normal? Every change made for this role is undone.`)) return;
    setDraft({});
    if (kind === 'jobRole') resetJobRole(roleKey); else resetTier(roleKey);
  };

  /**
   * Set a whole list of things at once, respecting each one's own ceiling.
   *
   * `maxLevel` matters here: ERS is somebody else's data with no write path,
   * so "Full access for everyone" must still leave it at Can view rather
   * than making a promise the API cannot keep.
   */
  const setMany = (surfaces, level) => {
    const next = {};
    for (const x of surfaces) {
      next[x.key] = x.maxLevel && ACCESS_RANK[level] > ACCESS_RANK[x.maxLevel] ? x.maxLevel : level;
    }
    setDraft((d) => ({ ...d, ...next }));
  };

  /** Every section on screen — the "Start from" buttons at the top. */
  const setAll = (level) => setMany(sections.flatMap((x) => x.surfaces), level);

  return (
    <section className="ac-editor">
      <div className="ac-role-head">
        <span className="ac-role-swatch" style={{ background: layer?.color ?? '#8A9099' }} />
        <div className="col" style={{ minWidth: 0 }}>
          <b className="ac-role-title">{layer?.title ?? layer?.label ?? roleKey}</b>
          <span className="tiny muted">
            {kind === 'jobRole' ? (
              <>
                {layer?.holders?.length
                  ? <>Held by <b>{heldBy(layer)}</b></>
                  : <span style={{ color: 'var(--warning)' }}>Nobody holds this role yet — nothing you set here will be felt</span>}
                {' · '}row {layer?.sheetRows} of the org sheet
              </>
            ) : (
              /* WHO IT REACHES, said before what it is. An admin editing a
                 tier needs to know it only answers for people with no seat in
                 the sheet — otherwise they set it, sign in as somebody who
                 does have a seat, and find their change was never consulted. */
              <>
                {layer?.holders?.length
                  ? <>Reaches <b>{reachCount(layer)}</b> — {heldBy(layer, 4)}</>
                  : <span style={{ color: 'var(--warning)' }}>Reaches nobody right now</span>}
                {' · '}only for people with no role in the org sheet
              </>
            )}
          </span>
        </div>
        <div className="row gap-2" style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
            <RotateCcw size={14} /> Undo all
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || busy}>
            <Save size={14} /> {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* The answer in one sentence, before any of the detail. */}
      <div className="ac-summary">
        <span>
          Someone with this role <b>can open {tally.open}</b> of {allKeys.length} things,
          {' '}<b>can change {tally.edit}</b> of them, and <b>can approve {tally.full}</b>.
        </span>
        {changed > 0 && <span className="ac-summary-chip">{changed} set differently from normal</span>}
      </div>

      <div className="ac-quick">
        <span className="tiny muted">Start from</span>
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => setAll(ACCESS.NONE)}>
          <EyeOff size={13} /> Nothing
        </button>
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => setAll(ACCESS.VIEW)}>
          <Eye size={13} /> View everything
        </button>
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => setAll(ACCESS.MANAGE)}>
          <ShieldCheck size={13} /> Full access
        </button>
        <span className="tiny muted">then change the few that differ</span>
      </div>

      {dirty && (
        <div className="ac-savebar">
          <AlertTriangle size={15} />
          <span>
            Not saved yet. Saving changes what
            {' '}<b>{layer?.holders?.length ? heldBy(layer) : 'everyone with this role'}</b>
            {' '}sees straight away.
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft({})}>
            <X size={14} /> Discard
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            <Save size={14} /> Save
          </button>
        </div>
      )}

      {sections.map((section, i) => (
        <SectionBlock
          key={section.key}
          section={section}
          valueOf={valueOf}
          onSet={setOne}
          onSetSection={(sec, level) => setMany(sec.surfaces, level)}
          openByDefault={i === 0 || Boolean(search.trim())}
        />
      ))}
    </section>
  );
}

/**
 * The roles, as the company lists them.
 *
 * Grouped by the access tier each maps to, because that is the one thing this
 * screen cannot change — a Feasibility Expert cannot be handed a Manager's
 * approvals here — and the grouping says so before anybody tries.
 */
function RoleList({ policy, picked, onPick, seatless = 0 }) {
  const seats = Object.values(policy.roles ?? {});
  const groups = TIER_ORDER
    .map((tier) => ({ tier, roles: seats.filter((r) => r.systemRole === tier) }))
    .filter((g) => g.roles.length);

  return (
    <aside className="ac-role-list">
      {groups.map(({ tier, roles }) => (
        <div key={tier} className="ac-role-group">
          <div className="ac-role-group-head">
            {TIER_LABEL[tier]}
            <span className="tiny muted">{TIER_HINT[tier]}</span>
          </div>
          {roles.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`ac-role-item${picked.kind === 'jobRole' && picked.key === r.key ? ' is-on' : ''}`}
              onClick={() => onPick({ kind: 'jobRole', key: r.key })}
            >
              <span className="ac-role-swatch" style={{ background: r.color }} />
              <span className="col" style={{ minWidth: 0 }}>
                <span className="ac-role-name">{r.title}</span>
                <span className="tiny muted">
                  {r.holders.length ? heldBy(r) : 'nobody yet'}
                </span>
              </span>
              {Object.keys(r.saved ?? {}).length > 0 && (
                <span className="ac-role-badge" title="Things set differently from normal for this role">
                  {Object.keys(r.saved).length}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}

      <div className="ac-role-group">
        <div className="ac-role-group-head">
          Everyone else
          <span className="tiny muted">
            {seatless > 0
              ? `${seatless} ${seatless === 1 ? 'account has' : 'accounts have'} no role in the org sheet — they follow these`
              : 'People with no role in the org sheet'}
          </span>
        </div>
        {Object.entries(policy.tiers ?? {}).map(([tier, layer]) => (
          <button
            key={tier}
            type="button"
            className={`ac-role-item${picked.kind === 'tier' && picked.key === tier ? ' is-on' : ''}`}
            onClick={() => onPick({ kind: 'tier', key: tier })}
          >
            <span className="ac-role-swatch" style={{ background: '#C6CAD1' }} />
            <span className="col" style={{ minWidth: 0 }}>
              <span className="ac-role-name">{layer.label}</span>
              {/* WHO IT REACHES, not what it is called. A tier only answers
                  for somebody with no role in the sheet, and that is most of
                  the company — so this is the number that decides whether an
                  edit here will be felt at all. */}
              <span className={`tiny${layer.holders?.length ? ' muted' : ' ac-reaches-none'}`}>
                {layer.holders?.length
                  ? `${reachCount(layer)} — ${heldBy(layer, 2)}`
                  : 'nobody — every account with this tier also has a role'}
              </span>
            </span>
            {Object.keys(layer.saved ?? {}).length > 0 && (
              <span className="ac-role-badge">{Object.keys(layer.saved).length}</span>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}

function RolesTab({ catalog, policy, search }) {
  const first = Object.keys(policy.roles ?? {})[0];
  const [picked, setPicked] = useState({ kind: 'jobRole', key: first });

  /**
   * THE ONE FACT THAT DECIDES WHETHER ANY OF THIS LANDS.
   *
   * A role layer is only read for somebody who HOLDS that role. Accounts with
   * no seat in the org sheet fall through to their access tier instead — and
   * most accounts are in that state, because the sheet names about twenty
   * people and the ERP has fifty logins.
   *
   * Nothing said so, which produced the most expensive kind of failure this
   * screen can have: an admin narrows Feasibility Expert, signs in as the
   * person they had in mind to check, finds everything exactly as before, and
   * concludes that access control does not work. It did work. It was never
   * consulted, because that person holds no seat.
   *
   * Said here, once, above the thing it is about — with the fix beside it,
   * since giving them the role on the Employees page is what makes the layer
   * apply to them.
   */
  const seatless = useMemo(
    () => Object.values(policy.tiers ?? {}).reduce((n, t) => n + (t.holders?.length ?? 0), 0),
    [policy.tiers],
  );

  if (!picked.key) return <EmptyState icon={Layers} title="No roles to set up" />;

  return (
    <>
      {seatless > 0 && (
        <div className="ac-reach-note">
          <AlertTriangle size={15} />
          <div>
            <b>
              {seatless} {seatless === 1 ? 'account has' : 'accounts have'} no role from the org sheet.
            </b>
            {' '}
            A role below is only read for the people who hold it, so nothing you change here
            will reach those {seatless}. They follow their <b>access tier</b> instead — the grey
            list under “Everyone else”. Give someone a role on the <b>Employees</b> page and this
            side starts applying to them.
          </div>
        </div>
      )}
      <div className="ac-two">
        <RoleList policy={policy} picked={picked} onPick={setPicked} seatless={seatless} />
        <RoleEditor catalog={catalog} policy={policy} search={search} roleKey={picked.key} kind={picked.kind} />
      </div>
    </>
  );
}

/* ══ One person only ═══════════════════════════════════════════════════ */

/** What this person ends up with once everything is taken into account. */
function PersonEffect({ data, isLoading }) {
  if (isLoading) return <Spinner label="Working out what they see…" />;
  if (!data) return null;

  const visible = data.rows.filter((r) => ACCESS_RANK[r.level] > 0);

  return (
    <div className="ac-effect">
      <div className="ac-effect-head">
        <Eye size={14} />
        <b>{data.user.name} can open {visible.length} of {data.rows.length} things</b>
        <span className="tiny muted">everything else is hidden from them</span>
      </div>
      <div className="ac-effect-list">
        {visible.map((r) => (
          <span
            key={r.key}
            className="ac-chip"
            style={{ '--lvl': LEVEL[r.level]?.color ?? '#8A9099' }}
            title={`${LEVEL[r.level]?.label} — ${SOURCE_SAID[r.source] ?? r.source}`}
          >
            {r.label}
            {r.source === 'person' && <i className="ac-chip-dot" />}
          </span>
        ))}
      </div>
    </div>
  );
}

function PersonTab({ catalog, policy, search }) {
  const [picked, setPicked] = useState(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({});
  const [note, setNote] = useState('');

  const { data: list = [], isLoading: peopleLoading } = useGetAccessPeopleQuery({ search: query || undefined });
  /* What their ROLES give them, row by row. Read from the preview because
     somebody may hold several — the sheet names Prateek three times — and the
     honest answer is the union the server already works out. */
  const { data: preview, isLoading: previewLoading } = useGetAccessPreviewQuery(picked?.id, { skip: !picked?.id });
  const [saveUser, saveState] = useSaveUserAccessMutation();
  const [clearUser, clearState] = useClearUserAccessMutation();

  const saved = useMemo(() => {
    const row = policy.people.find((p) => String(p.userId) === String(picked?.id));
    return row?.grants ?? {};
  }, [policy.people, picked]);

  const roleLevels = useMemo(
    () => Object.fromEntries((preview?.rows ?? []).map((r) => [r.key, r.roleLevel])),
    [preview],
  );

  const valueOf = (key) => draft[key] ?? saved[key] ?? INHERIT;
  const dirty = Object.entries(draft).some(([k, v]) => v !== (saved[k] ?? INHERIT));
  const sections = useSections(catalog, search);

  /* The role's own answer rides along on each row, so "Same as role" can say
     what that actually is instead of leaving the reader to go and look. */
  const withRoleLevels = useMemo(() => sections.map((s) => ({
    ...s,
    surfaces: s.surfaces.map((x) => ({ ...x, roleLevel: roleLevels[x.key] })),
  })), [sections, roleLevels]);

  const save = async () => {
    const merged = { ...saved, ...draft };
    /* "Same as role" is a removal, not a stored answer — a person's list of
       exceptions should hold only actual exceptions. */
    const grants = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== INHERIT));
    try {
      await saveUser({ userId: picked.id, grants, note: note || undefined }).unwrap();
      setDraft({});
    } catch {
      /* Toasted centrally; the edit stays on screen so it can be retried. */
    }
  };

  return (
    <div className="ac-two">
      <aside className="ac-role-list">
        <div className="input-icon-wrap">
          <Search size={15} className="input-icon" />
          <input className="input" placeholder="Find a person…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {peopleLoading ? <Spinner /> : list.length === 0 ? (
          <EmptyState icon={Users} title="Nobody matches" hint="Search by name or email." />
        ) : list.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`ac-role-item${picked?.id === p.id ? ' is-on' : ''}`}
            onClick={() => { setPicked(p); setDraft({}); setNote(''); }}
          >
            <Avatar name={p.name} color={p.avatarColor} size={26} />
            <span className="col" style={{ minWidth: 0 }}>
              <span className="ac-role-name">{p.name}</span>
              <span className="tiny muted">
                {p.jobRoleTitles?.length ? p.jobRoleTitles.join(' · ') : <em>no role in the org sheet</em>}
              </span>
            </span>
            {p.hasOverrides && <Badge color="#6741D9" soft>own rules</Badge>}
          </button>
        ))}
      </aside>

      <section className="ac-editor">
        {!picked ? (
          <EmptyState
            icon={UserCog}
            title="Pick a person to give them their own rules"
            hint="Almost every decision belongs on the By role tab — it keeps working when somebody leaves. Use this only for real exceptions, like the one site engineer who works assessments and nothing else."
          />
        ) : (
          <>
            <div className="ac-role-head">
              <Avatar name={picked.name} color={picked.avatarColor} size={36} />
              <div className="col" style={{ minWidth: 0 }}>
                <b className="ac-role-title">{picked.name}</b>
                <span className="tiny muted">
                  {picked.jobRoleTitles?.length ? (
                    <>Follows <b>{picked.jobRoleTitles.join(' + ')}</b> for anything left on “Same as role”</>
                  ) : (
                    <>No role in the org sheet — better to give them one on the Employees page than rules of their own</>
                  )}
                </span>
              </div>
              <div className="row gap-2" style={{ marginLeft: 'auto' }}>
                {Object.keys(saved).length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={clearState.isLoading}
                    onClick={() => {
                      // eslint-disable-next-line no-alert
                      if (!window.confirm(`Remove every special rule for ${picked.name}? They go back to following their role.`)) return;
                      clearUser(picked.id);
                      setDraft({});
                    }}
                  >
                    <Trash2 size={14} /> Remove their rules
                  </button>
                )}
                <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saveState.isLoading} onClick={save}>
                  <Save size={14} /> {saveState.isLoading ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <PersonEffect data={preview} isLoading={previewLoading} />

            <input
              className="input"
              placeholder="Why is this person different? (optional — shown beside their name)"
              value={note || policy.people.find((p) => String(p.userId) === String(picked.id))?.note || ''}
              onChange={(e) => setNote(e.target.value)}
            />

            {dirty && (
              <div className="ac-savebar">
                <AlertTriangle size={15} />
                <span>Not saved yet. This changes what <b>{picked.name}</b> sees straight away.</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft({})}>
                  <X size={14} /> Discard
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saveState.isLoading}>
                  <Save size={14} /> Save
                </button>
              </div>
            )}

            {withRoleLevels.map((section, i) => (
              <SectionBlock
                key={section.key}
                section={section}
                valueOf={valueOf}
                onSet={(key, level) => setDraft((d) => ({ ...d, [key]: level }))}
                onSetSection={(sec, level) => setDraft((d) => ({
                  ...d,
                  ...Object.fromEntries(sec.surfaces.map((x) => [
                    x.key,
                    /* `inherit` is not a level, so it is never capped — it
                       means "whatever their role says", and their role has
                       already been capped. */
                    level !== INHERIT && x.maxLevel && ACCESS_RANK[level] > ACCESS_RANK[x.maxLevel]
                      ? x.maxLevel
                      : level,
                  ])),
                }))}
                openByDefault={i === 0 || Boolean(search.trim())}
                person
              />
            ))}
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

  const { data: catalog, isLoading: catalogLoading, isError: catalogError } = useGetAccessCatalogQuery();
  const { data: policy, isLoading: policyLoading, isError: policyError } = useGetAccessPolicyQuery();

  const loading = catalogLoading || policyLoading;
  const failed = catalogError || policyError;
  const overridden = policy?.people?.length ?? 0;

  return (
    <>
      {/*
        * OUTSIDE `.content`, not inside it.
        *
        * `.content` is the scroller (globals.css) and `.topbar` is
        * `position: sticky`. Nested inside, the bar sticks to the top of the
        * scrolling BOX rather than the page, and the page's own heading slides
        * up behind it — which is exactly the overlap this screen shipped with.
        * Every other page in the app places it here, as a sibling.
        */}
      <Topbar
        title={<span className="row gap-2" style={{ alignItems: 'center' }}><ShieldCheck size={18} /> Access Control</span>}
        subtitle="Decide what each role can open, and what they can do there"
      />

      <div className="content ac-page">
        <div className="ac-tabs">
          <button type="button" className={`ac-tab${tab === 'role' ? ' is-on' : ''}`} onClick={() => setTab('role')}>
            <Layers size={15} /> By role
          </button>
          <button type="button" className={`ac-tab${tab === 'person' ? ' is-on' : ''}`} onClick={() => setTab('person')}>
            <UserCog size={15} /> One person only
            {overridden > 0 && <span className="ac-tab-count">{overridden}</span>}
          </button>

          <div className="ac-tools">
            <div className="input-icon-wrap" style={{ width: 260 }}>
              <Search size={15} className="input-icon" />
              <input
                className="input"
                placeholder="Find something — “assessment”, “stock”…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <Legend />

        <div className="ac-note-strip">
          <Info size={14} />
          <span>
            Pick a role on the left, then set each thing to Hidden, Can view, Can edit or Full.
            Anything you leave alone keeps its normal setting, so a new part of the ERP still
            reaches the people it was meant for. The Managing Director can never be locked out
            of this screen.
          </span>
        </div>

        {loading ? (
          <Spinner label="Loading…" />
        ) : failed ? (
          <ErrorState
            title="Could not load this screen"
            hint="Only the Managing Director and the Executive Assistant can open it."
          />
        ) : tab === 'role' ? (
          <RolesTab catalog={catalog} policy={policy} search={search} />
        ) : (
          <PersonTab catalog={catalog} policy={policy} search={search} />
        )}
      </div>
    </>
  );
}

export default AccessControlPage;
