import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3, AlertTriangle, TrendingDown, Users, RefreshCw,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Avatar, Badge } from '../../components/ui/primitives.jsx';
import { RankedBar } from '../../components/charts/chartkit.jsx';
import {
  usePerformance, useDropOff, useLossAnalysis,
} from '../../app/api/crmApi.js';
import './crm.css';

/**
 * Who is doing how much, and where each person is losing deals.
 *
 * TWO QUESTIONS, KEPT APART. The scorecard counts. The drop-off table explains.
 * A single conversion-rate number makes four different problems look identical
 * — nobody is calling, the demo is weak, price came up too late, the leads were
 * never real — and a manager reading one number cannot tell which they have.
 * Stage-wise drop-off tells them apart, which is the only version of this
 * screen that changes what anybody does on Monday.
 *
 * THE GAP COLUMN IS THE POINT. An agent's drop at a stage means little on its
 * own; the same drop measured against what everyone else loses at that stage
 * is a specific, coachable fact.
 *
 * Two rules the server enforces and this screen must not undermine:
 *
 *   SMALL SAMPLES ARE SHOWN BUT NOT FLAGGED. A 50% drop on two deals means
 *   nothing, and flagging it destroys trust in every other row on the page.
 *
 *   THE BASELINE IS THE MEDIAN, NOT THE MEAN. One outstanding or disastrous
 *   performer must not move everybody else's baseline.
 */

const TABS = [
  { key: 'scorecard', label: 'Scorecard', icon: Users },
  { key: 'dropoff', label: 'Stage drop-off', icon: TrendingDown },
  { key: 'losses', label: 'Losses', icon: AlertTriangle },
];

const RANGES = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
];

const pct = (n) => (n == null ? '—' : `${Math.round(n)}%`);
const money = (n) => (n ? `₹${(n / 100000).toFixed(1)}L` : '—');
const mins = (n) => {
  if (n == null) return '—';
  if (n < 60) return `${Math.round(n)}m`;
  const h = n / 60;
  return h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
};

/* ── Scorecard ──────────────────────────────────────────────── */

function Scorecard({ days, onPickAgent }) {
  const { data, isFetching, isError, refetch } = usePerformance({ days });

  if (isError) {
    return (
      <EmptyState
        icon={AlertTriangle} title="The scorecard could not be loaded"
        hint="This is not an empty team — the numbers could not be fetched."
        action={<button type="button" className="btn btn-primary" onClick={refetch}>Try again</button>}
      />
    );
  }
  if (!data) return <div className="sm muted" style={{ padding: 24 }}>Loading…</div>;

  const rows = data.rows || [];
  if (!rows.length) {
    return (
      <EmptyState
        icon={Users} title="Nothing to measure yet"
        hint="No leads were assigned in this period, so there is nothing to count. Widen the range or wait for the pipeline to move."
      />
    );
  }

  return (
    <>
      {data.thin && (
        /* Said plainly rather than shown as a confident-looking table. A report
           built on a handful of deals is not wrong so much as meaningless, and
           a manager who acts on it once and gets burned stops trusting the
           screen for good. */
        <div className="crm-note">
          <AlertTriangle size={14} aria-hidden />
          <span>
            Only
            {' '}
            <strong>{data.thin.deals}</strong>
            {' '}
            deals and
            {' '}
            <strong>{data.thin.leads}</strong>
            {' '}
            leads moved in this period. These numbers describe too little
            activity to rank anybody on — treat them as a shape, not a verdict.
          </span>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Assigned</th>
            <th>Contacted</th>
            <th>Response</th>
            <th>Booked</th>
            <th>Conversion</th>
            <th>Revenue</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.agent._id} className="is-clickable"
              onClick={() => onPickAgent(r.agent._id)}
            >
              <td>
                <span className="row gap-2" style={{ alignItems: 'center' }}>
                  <Avatar name={r.agent.name} color={r.agent.avatarColor} size={24} />
                  <strong>{r.agent.name}</strong>
                </span>
              </td>
              <td>{r.assigned}</td>
              <td>
                {r.contacted}
                {' '}
                <span className="crm-muted">{pct(r.contactRate)}</span>
              </td>
              {/* Response time next to conversion deliberately: ranking on
                  revenue alone measures who was handed the best leads. */}
              <td className={r.avgResponseMinutes > (data.medians?.avgResponseMinutes ?? Infinity) ? 'crm-worse' : ''}>
                {mins(r.avgResponseMinutes)}
              </td>
              <td>{r.booked}</td>
              <td>{pct(r.conversionRate)}</td>
              <td>{money(r.revenue)}</td>
              <td className="crm-muted">
                {r.openCount}
                {' · '}
                {money(r.openValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="crm-muted sm">
        Team median — contact rate
        {' '}
        {pct(data.medians?.contactRate)}
        , conversion
        {' '}
        {pct(data.medians?.conversionRate)}
        , response
        {' '}
        {mins(data.medians?.avgResponseMinutes)}
        .
        {' '}
        {isFetching && 'Refreshing…'}
      </p>
    </>
  );
}

/* ── Stage drop-off ─────────────────────────────────────────── */

function DropOff({ days, agentId, onPickAgent }) {
  const { data, isError, refetch } = useDropOff({ days, agent: agentId || undefined });

  if (isError) {
    return (
      <EmptyState
        icon={AlertTriangle} title="Drop-off could not be loaded"
        action={<button type="button" className="btn btn-primary" onClick={refetch}>Try again</button>}
      />
    );
  }
  if (!data) return <div className="sm muted" style={{ padding: 24 }}>Loading…</div>;

  const stages = data.stages || [];

  return (
    <>
      <div className="crm-toolbar">
        <select
          className="crm-select" value={agentId || ''}
          onChange={(e) => onPickAgent(e.target.value)} aria-label="Agent"
        >
          <option value="">Whole team</option>
          {(data.agents || []).map((a) => (
            <option key={a._id} value={String(a._id)}>{a.name}</option>
          ))}
        </select>
        <span className="crm-muted sm">
          A gap is only flagged once a stage has at least
          {' '}
          {data.minSample}
          {' '}
          deals in it.
        </span>
      </div>

      {!stages.length ? (
        <EmptyState
          icon={TrendingDown} title="No stage movement in this period"
          hint="Deals have to move between stages before there is any drop-off to measure."
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Entered</th>
              <th>Moved on</th>
              <th>Drop</th>
              <th>Team median</th>
              <th>Gap</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.stageId}>
                <td>
                  <strong>{s.name}</strong>
                  {s.labelHi && <span className="crm-muted"> · {s.labelHi}</span>}
                </td>
                <td>{s.entered}</td>
                <td>{s.movedOn}</td>
                <td>{pct(s.dropPercent)}</td>
                <td className="crm-muted">{pct(s.teamMedianDrop)}</td>
                <td>
                  {/* Shown in BOTH directions. An agent well above the median
                      at a stage is someone whose approach the others should
                      be learning, and a screen that only ever points at
                      failure gets read as an attack. */}
                  {!s.flagged ? (
                    <span className="crm-muted">
                      {s.entered < data.minSample ? `too few (${s.entered})` : '—'}
                    </span>
                  ) : s.gap > 0 ? (
                    <Badge color="#dc2626" soft="var(--surface-2)">
                      {Math.round(s.gap)}
                      {' '}
                      pts worse
                    </Badge>
                  ) : (
                    <Badge color="#10b981" soft="var(--surface-2)">
                      {Math.abs(Math.round(s.gap))}
                      {' '}
                      pts better
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ── Losses ─────────────────────────────────────────────────── */

function Losses({ days }) {
  const { data, isError, refetch } = useLossAnalysis({ days });

  if (isError) {
    return (
      <EmptyState
        icon={AlertTriangle} title="Loss analysis could not be loaded"
        action={<button type="button" className="btn btn-primary" onClick={refetch}>Try again</button>}
      />
    );
  }
  if (!data) return <div className="sm muted" style={{ padding: 24 }}>Loading…</div>;

  if (!data.total) {
    return (
      <EmptyState
        icon={AlertTriangle} title="No deals were lost in this period"
        hint="Which is good news, but it also means there is nothing here to learn from yet."
      />
    );
  }

  return (
    <div className="col gap-4">
      <section className="crm-card">
        <h3 className="crm-section__title">Why we lost — {data.total} deals</h3>
        <RankedBar data={data.byReason} color="#dc2626" />
      </section>

      <section className="crm-card">
        <h3 className="crm-section__title">Where in the pipeline they died</h3>
        <p className="crm-muted sm">
          Losing at the first stage is a lead-quality problem. Losing at Price Talk is a
          sales problem. They need different fixes.
        </p>
        <RankedBar data={data.byStage} color="#d97706" />
      </section>

      <section className="crm-card">
        <h3 className="crm-section__title">Which sources produce deals that die</h3>
        <RankedBar data={data.bySource} color="#6366f1" />
      </section>

      {data.heatmap?.length > 0 && (
        <section className="crm-card">
          <h3 className="crm-section__title">Reason × stage</h3>
          <p className="crm-muted sm">
            “Price too high” showing up early rather than at Price Talk means budget is
            being discussed before value — which no single-axis chart would reveal.
          </p>
          <div className="crm-heat" style={{ gridTemplateColumns: `160px repeat(${data.stageNames.length}, 1fr)` }}>
            <span />
            {data.stageNames.map((s) => <span key={s} className="crm-heat__head">{s}</span>)}
            {data.heatmap.map((row) => (
              <>
                <span key={row.reason} className="crm-heat__label">{row.label}</span>
                {row.cells.map((c, i) => (
                  <span
                    key={`${row.reason}-${data.stageNames[i]}`}
                    className="crm-heat__cell"
                    style={{ opacity: c ? 0.15 + (c / data.heatMax) * 0.85 : 0 }}
                    title={`${row.label} at ${data.stageNames[i]}: ${c}`}
                  >
                    {c || ''}
                  </span>
                ))}
              </>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── The page ───────────────────────────────────────────────── */

export function PerformancePage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'scorecard';
  const days = params.get('days') || '30';
  const agentId = params.get('agent') || '';
  const [, force] = useState(0);

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const pickAgent = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('agent', id); else next.delete('agent');
    next.set('tab', 'dropoff');
    setParams(next, { replace: true });
  };

  return (
    <>
      <Topbar title="Performance" />

      <div className="content col gap-4">
        <div className="crm-toolbar">
          <div className="crm-viewtoggle" role="tablist" aria-label="Performance sections">
            {TABS.map((t) => (
              <button
                key={t.key} type="button" role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'is-on' : ''}
                onClick={() => set('tab', t.key)}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>

          <select
            className="crm-select" value={days}
            onChange={(e) => set('days', e.target.value)} aria-label="Period"
          >
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>

          <button type="button" className="btn btn-ghost btn-sm" onClick={() => force((n) => n + 1)}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {tab === 'scorecard' && <Scorecard days={days} onPickAgent={pickAgent} />}
        {tab === 'dropoff' && <DropOff days={days} agentId={agentId} onPickAgent={pickAgent} />}
        {tab === 'losses' && <Losses days={days} />}
      </div>
    </>
  );
}

export default PerformancePage;
