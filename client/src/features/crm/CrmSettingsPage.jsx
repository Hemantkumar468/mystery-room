import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Moon, Phone, Columns3, GitBranch, Save, Plus, Trash2, AlertTriangle, GripVertical,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import {
  usePreferences, useUpdatePreferences, usePipelines, useUpdatePipelineStages,
  useRoutingRules, useRoutingVocabulary, useCreateRoutingRule,
  useUpdateRoutingRule, useDeleteRoutingRule,
} from '../../app/api/crmApi.js';
import './crm.css';

/**
 * Everything configurable in the CRM, on one page with three tabs.
 *
 * ONE PAGE rather than three sidebar entries, because these are all "set this
 * up once and forget it" screens: a nav crowded with settings makes the four
 * pages people use every day harder to find. The tab is in the URL, so a
 * manager can still send somebody straight to the rules.
 *
 * MY SETTINGS is visible to everyone. STAGES and ROUTING are managers only —
 * both decide something about other people's work, and the server enforces it
 * regardless of what this page renders.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

/* ── Tab 1: my own settings ─────────────────────────────────── */

function MySettings() {
  const { data: prefs } = usePreferences();
  const save = useUpdatePreferences();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (prefs && !form) {
      setForm({
        phone: prefs.phone || '',
        quietHoursStart: prefs.quietHoursStart ?? '',
        quietHoursEnd: prefs.quietHoursEnd ?? '',
        crmAvailable: prefs.crmAvailable !== false,
        crmOpenLeadCap: prefs.crmOpenLeadCap ?? '',
      });
    }
  }, [prefs, form]);

  if (!form) return <div className="sm muted" style={{ padding: 24 }}>Loading…</div>;

  const set = (k, v) => { setForm((s) => ({ ...s, [k]: v })); setSaved(false); };

  const submit = async (e) => {
    e.preventDefault();
    await save.mutateAsync({
      phone: form.phone,
      quietHoursStart: form.quietHoursStart === '' ? null : Number(form.quietHoursStart),
      quietHoursEnd: form.quietHoursEnd === '' ? null : Number(form.quietHoursEnd),
      crmAvailable: form.crmAvailable,
      crmOpenLeadCap: form.crmOpenLeadCap === '' ? 0 : Number(form.crmOpenLeadCap),
    });
    setSaved(true);
  };

  const bothSet = form.quietHoursStart !== '' && form.quietHoursEnd !== '';

  return (
    <form className="crm-settings" onSubmit={submit}>
      <section className="crm-card">
        <h3 className="crm-section__title"><Phone size={14} aria-hidden /> Your phone</h3>
        <p className="crm-muted">
          Click-to-call rings THIS number first, then dials the customer. Without it,
          calls cannot be placed at all.
        </p>
        <input
          className="input" type="tel" style={{ maxWidth: 260 }}
          value={form.phone} onChange={(e) => set('phone', e.target.value)}
          placeholder="+91 98765 43210"
        />
      </section>

      <section className="crm-card">
        <h3 className="crm-section__title"><Moon size={14} aria-hidden /> Quiet hours</h3>
        <p className="crm-muted">
          Reminders that fall inside this window are <strong>held until it ends</strong>, not
          dropped. A reminder at eleven at night does not get the task done — it gets
          notifications switched off for good.
        </p>
        <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="crm-select" value={form.quietHoursStart}
            onChange={(e) => set('quietHoursStart', e.target.value)} aria-label="Quiet hours start"
          >
            <option value="">Not set</option>
            {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
          <span className="crm-muted">to</span>
          <select
            className="crm-select" value={form.quietHoursEnd}
            onChange={(e) => set('quietHoursEnd', e.target.value)} aria-label="Quiet hours end"
          >
            <option value="">Not set</option>
            {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </div>
        {bothSet && (
          <p className="crm-muted">
            {Number(form.quietHoursStart) > Number(form.quietHoursEnd)
              ? `Nothing will reach you between ${hourLabel(form.quietHoursStart)} and ${hourLabel(form.quietHoursEnd)} the next morning.`
              : `Nothing will reach you between ${hourLabel(form.quietHoursStart)} and ${hourLabel(form.quietHoursEnd)}.`}
          </p>
        )}
      </section>

      <section className="crm-card">
        <h3 className="crm-section__title">Lead rotation</h3>
        <label className="crm-consent__row">
          <input
            type="checkbox" checked={form.crmAvailable}
            onChange={(e) => set('crmAvailable', e.target.checked)}
          />
          <span>
            <strong>Available for new leads</strong>
            <span className="crm-muted">
              Untick while on leave. Leads still reach everyone else — an agent left in the
              rotation collects enquiries nobody looks at for a week.
            </span>
          </span>
        </label>

        <label className="crm-form__field" style={{ maxWidth: 260 }}>
          <span className="crm-form__label">Stop assigning past this many open leads</span>
          <input
            className="input" type="number" min="0"
            value={form.crmOpenLeadCap} onChange={(e) => set('crmOpenLeadCap', e.target.value)}
            placeholder="0 — no cap"
          />
          <span className="crm-muted">
            A smoothing device for campaign spikes, not a hard limit: if everyone is at
            their cap, leads are still assigned rather than left unowned.
          </span>
        </label>
      </section>

      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          <Save size={15} /> {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="crm-muted">Saved.</span>}
      </div>
    </form>
  );
}

/* ── Tab 2: pipeline stages ─────────────────────────────────── */

function StageSettings() {
  const { data: pipelines } = usePipelines();
  const save = useUpdatePipelineStages();
  const [pipelineId, setPipelineId] = useState('');
  const [stages, setStages] = useState(null);
  const [error, setError] = useState(null);

  const pipeline = pipelines?.find((p) => String(p._id) === String(pipelineId))
    || pipelines?.find((p) => p.isDefault) || pipelines?.[0];

  useEffect(() => {
    if (pipeline && stages === null) setStages(pipeline.stages.map((s) => ({ ...s })));
  }, [pipeline, stages]);

  if (!pipeline || !stages) return <div className="sm muted" style={{ padding: 24 }}>Loading…</div>;

  const edit = (i, key, value) => setStages((s) => s.map((st, n) => (n === i ? { ...st, [key]: value } : st)));
  const swap = (i, j) => setStages((s) => {
    if (j < 0 || j >= s.length) return s;
    const next = [...s];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      // Order is sent as the ARRAY order; the server re-gaps it to 100/200/300
      // so drag-reordering never has to compute spacing here.
      await save.mutateAsync({ id: pipeline._id, stages });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save those stages.');
    }
  };

  return (
    <form className="crm-settings" onSubmit={submit}>
      {error && <div className="crm-form__error">{error}</div>}

      {pipelines.length > 1 && (
        <select
          className="crm-select" value={String(pipeline._id)}
          onChange={(e) => { setPipelineId(e.target.value); setStages(null); }}
          aria-label="Pipeline"
        >
          {pipelines.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
      )}

      <p className="crm-muted">
        Probability is what makes the weighted forecast arithmetic rather than guesswork:
        pipeline value is the sum of each deal&apos;s value times its stage&apos;s probability.
        Changing it here reprices the forecast without touching a single deal.
      </p>

      <ul className="crm-stagelist">
        {stages.map((s, i) => (
          <li key={s._id || i}>
            <span className="crm-stagelist__grip" aria-hidden><GripVertical size={14} /></span>

            <input
              className="input" value={s.name}
              onChange={(e) => edit(i, 'name', e.target.value)} aria-label="Stage name"
            />

            <label className="crm-stagelist__prob">
              <input
                className="input" type="number" min="0" max="100"
                value={s.probability ?? 0}
                onChange={(e) => edit(i, 'probability', Number(e.target.value))}
                aria-label={`${s.name} probability`}
              />
              <span className="crm-muted">%</span>
            </label>

            <span className="crm-stagelist__flags">
              {s.isWon && <Badge color="#10b981" soft="var(--surface-2)">won</Badge>}
              {s.isLost && <Badge color="#dc2626" soft="var(--surface-2)">lost</Badge>}
            </span>

            <span className="crm-stagelist__move">
              <button type="button" onClick={() => swap(i, i - 1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" onClick={() => swap(i, i + 1)} disabled={i === stages.length - 1} aria-label="Move down">↓</button>
            </span>

            <button
              type="button" className="crm-stagelist__del"
              // Removing a stage that still holds deals is refused by the
              // server — those deals would point at a stage id that no longer
              // resolves and vanish from the board while still counting in
              // every total.
              onClick={() => setStages((st) => st.filter((_, n) => n !== i))}
              disabled={s.isWon || s.isLost}
              title={s.isWon || s.isLost ? 'A pipeline needs a won and a lost stage' : 'Remove'}
              aria-label={`Remove ${s.name}`}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>

      <div className="row gap-2">
        <button
          type="button" className="btn btn-subtle btn-sm"
          onClick={() => setStages((s) => {
            // Inserted before the terminal stages, which must stay last.
            const at = s.findIndex((x) => x.isWon || x.isLost);
            const fresh = { name: 'New stage', probability: 50 };
            return at === -1 ? [...s, fresh] : [...s.slice(0, at), fresh, ...s.slice(at)];
          })}
        >
          <Plus size={14} /> Add a stage
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>
          <Save size={14} /> {save.isPending ? 'Saving…' : 'Save stages'}
        </button>
      </div>
    </form>
  );
}

/* ── Tab 3: routing rules ───────────────────────────────────── */

function RoutingSettings() {
  const { data: rules } = useRoutingRules();
  const { data: vocab } = useRoutingVocabulary();
  const { employees } = useEmployees();
  const create = useCreateRoutingRule();
  const update = useUpdateRoutingRule();
  const remove = useDeleteRoutingRule();
  const [error, setError] = useState(null);

  const del = async (rule) => {
    setError(null);
    try {
      await remove.mutateAsync({ id: rule._id });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not delete that rule.');
    }
  };

  if (!rules) return <div className="sm muted" style={{ padding: 24 }}>Loading…</div>;

  return (
    <div className="crm-settings">
      {error && <div className="crm-form__error">{error}</div>}

      <p className="crm-muted">
        Rules are checked in priority order and the <strong>first match wins</strong>. The
        last one should match everything — without a catch-all, a lead that matches
        nothing has no owner named by any rule.
      </p>

      {!rules.length ? (
        <EmptyState
          icon={GitBranch}
          title="No rules yet"
          hint="Every lead currently goes to the whole-company rotation, which is the engine's own fallback — it works, it is just not written down anywhere."
        />
      ) : (
        <ul className="crm-rulelist">
          {rules.map((r) => (
            <li key={r._id} className={r.isActive ? '' : 'is-off'}>
              <span className="crm-rulelist__pri">{r.priority}</span>

              <span className="crm-rulelist__body">
                <strong>{r.name}</strong>
                <span className="crm-muted">
                  {r.conditions?.length
                    ? r.conditions.map((c) => `${c.field} ${c.op} ${Array.isArray(c.value) ? c.value.join('/') : c.value}`).join(' and ')
                    : 'matches everything (catch-all)'}
                </span>
                <span className="crm-muted">
                  → {r.strategy === 'specific-user'
                    ? (r.targetUser?.name || 'a specific person')
                    : `${r.strategy} across ${r.targetTeam || 'everyone'}`}
                  {/* A rule pointing at an empty team is the commonest way
                      routing "stops working", and it is invisible from the
                      rule itself. */}
                  {r.teamSize === 0 && (
                    <strong className="crm-rule__warn">
                      {' '}<AlertTriangle size={12} aria-hidden /> nobody is in that team
                    </strong>
                  )}
                </span>
              </span>

              <label className="crm-rulelist__toggle">
                <input
                  type="checkbox" checked={r.isActive}
                  onChange={(e) => update.mutate({ id: r._id, isActive: e.target.checked })}
                />
                <span className="crm-muted">{r.isActive ? 'on' : 'off'}</span>
              </label>

              <button
                type="button" className="crm-stagelist__del"
                onClick={() => del(r)} aria-label={`Delete ${r.name}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button" className="btn btn-subtle btn-sm"
        onClick={() => create.mutate({
          name: 'New rule',
          priority: (rules[rules.length - 1]?.priority || 100) + 10,
          conditions: [],
          strategy: 'round-robin',
          isActive: false, // off until somebody has actually configured it
        })}
      >
        <Plus size={14} /> Add a rule
      </button>

      {vocab && (
        <p className="crm-muted">
          A condition may test: {vocab.fields.join(', ')}.
        </p>
      )}
    </div>
  );
}

/* ── The page ───────────────────────────────────────────────── */

export function CrmSettingsPage() {
  const [params, setParams] = useSearchParams();
  const user = useAppSelector(selectCurrentUser);
  const isManager = can.manage?.(user?.role) ?? ['md', 'ea', 'manager'].includes(user?.role);

  const tab = params.get('tab') || 'me';
  const setTab = (t) => setParams({ tab: t }, { replace: true });

  const TABS = [
    { key: 'me', label: 'My settings', icon: Moon },
    ...(isManager ? [
      { key: 'stages', label: 'Pipeline stages', icon: Columns3 },
      { key: 'routing', label: 'Lead routing', icon: GitBranch },
    ] : []),
  ];

  return (
    <>
      <Topbar title="CRM settings" />

      <div className="content col gap-4">
        <div className="crm-viewtoggle" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.key} type="button" role="tab"
              className={tab === t.key ? 'is-on' : ''}
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'me' && <MySettings />}
        {tab === 'stages' && isManager && <StageSettings />}
        {tab === 'routing' && isManager && <RoutingSettings />}
      </div>
    </>
  );
}

export default CrmSettingsPage;
