/**
 * The four analytical tabs of the Project Closure Command Center — Budget
 * Analysis, Timeline Analysis, Vendor Performance and Department Performance.
 *
 * Each one reads a slice of the derivations in closureAnalytics.js and renders
 * it with the app's existing chartkit + primitives; none of them fetch or
 * compute anything of their own, so the overview KPIs and these tabs can never
 * disagree. Panels whose source submission doesn't exist yet render
 * <AwaitingData/> naming that submission, rather than an empty chart.
 */
import {
  Wallet, PiggyBank, Clock, CalendarRange, AlertTriangle,
  Users, Building2, FileSpreadsheet, FileText, Gauge, Target,
} from 'lucide-react';
import { SectionCard, Badge, ProgressBar } from '../../../components/ui/primitives.jsx';
import { DonutChart, ComparisonBar } from '../../../components/charts/chartkit.jsx';
import { fmtCurrency, fmtDate } from '../../../lib/format.js';
import { CHART_COLORS } from '../../../lib/ui.js';
import { MetricTile, ScoreBar, GradePill, AwaitingData, InfoTile } from './ClosureKit.jsx';
import { scoreTone } from './closureAnalytics.js';

const pct = (v, digits = 1) => (v == null ? '—' : `${v.toFixed(digits)}%`);
const days = (v) => (v == null ? '—' : `${v} ${Math.abs(v) === 1 ? 'day' : 'days'}`);

/** Shared export toolbar for an analysis tab — PDF/Excel of that tab's own rows. */
function ExportBar({ onPdf, onExcel, disabled }) {
  return (
    <div className="row gap-2">
      <button type="button" className="btn btn-subtle btn-sm" onClick={onPdf} disabled={disabled}>
        <FileText size={13} style={{ marginRight: 5 }} /> PDF
      </button>
      <button type="button" className="btn btn-subtle btn-sm" onClick={onExcel} disabled={disabled}>
        <FileSpreadsheet size={13} style={{ marginRight: 5 }} /> Excel
      </button>
    </div>
  );
}

/* ─────────────────────────────── Budget Analysis ──────────────────────────── */

/**
 * `costByCategory` rolls the vendors' captured `total_cost` up by vendor
 * category — that category axis is what the business tracks spend against, so
 * this is the real department-wise cost split rather than an allocation model.
 */
export function BudgetAnalysisTab({ budget, financials, vendors, onExportPdf, onExportExcel }) {
  const costByCategory = Object.entries(
    vendors.reduce((acc, v) => {
      if (v.cost == null) return acc;
      acc[v.category || 'Uncategorised'] = (acc[v.category || 'Uncategorised'] || 0) + v.cost;
      return acc;
    }, {}),
  )
    .map(([name, value], i) => ({ name, value, color: CHART_COLORS[i % CHART_COLORS.length] }))
    .sort((a, b) => b.value - a.value);

  const vendorCostRows = vendors
    .filter((v) => v.cost != null)
    .sort((a, b) => b.cost - a.cost)
    .map((v) => ({ label: v.name, cost: v.cost }));

  const hasBudget = budget.planned != null || budget.actual != null;

  return (
    <div className="col gap-3">
      <SectionCard
        title="Budget Summary"
        subtitle="Planned versus actual, closed out against the Budget Analysis submission"
        action={<ExportBar onPdf={onExportPdf} onExcel={onExportExcel} disabled={!hasBudget} />}
      >
        {!hasBudget ? (
          <AwaitingData
            icon={Wallet}
            title="No budget figures captured yet"
            hint="Submit and approve the Budget Analysis module to populate this tab."
          />
        ) : (
          <div className="col gap-3">
            <div className="pcc-metric-row">
              <MetricTile label="Planned Budget" value={fmtCurrency(budget.planned)} />
              <MetricTile label="Actual Cost" value={fmtCurrency(budget.actual)} />
              <MetricTile
                label={budget.variance != null && budget.variance < 0 ? 'Cost Overrun' : 'Savings'}
                value={fmtCurrency(Math.abs(budget.variance ?? 0) || null)}
                tone={budget.variance == null ? undefined : budget.variance < 0 ? '#DC2626' : '#059669'}
                sub={budget.variancePct != null ? pct(Math.abs(budget.variancePct), 2) : undefined}
              />
              <MetricTile
                label="Budget Utilisation"
                value={pct(budget.utilizationPct)}
                tone={budget.utilizationPct != null && budget.utilizationPct > 100 ? '#DC2626' : '#059669'}
              />
              <MetricTile label="Financial Score" value={budget.score != null ? `${Math.round(budget.score)}/100` : '—'} tone={scoreTone(budget.score)} />
            </div>

            <div className="pcc-split">
              <div className="col gap-2">
                <span className="sm" style={{ fontWeight: 650 }}>Planned vs Actual</span>
                <ComparisonBar
                  height={230}
                  data={[{ label: 'Project Budget', planned: budget.planned ?? 0, actual: budget.actual ?? 0 }]}
                  keys={[
                    { key: 'planned', name: 'Planned', color: '#2563EB' },
                    { key: 'actual', name: 'Actual', color: budget.variance != null && budget.variance < 0 ? '#DC2626' : '#059669' },
                  ]}
                />
              </div>
              <div className="col gap-2">
                <span className="sm" style={{ fontWeight: 650 }}>Cost Breakdown by Vendor Category</span>
                {costByCategory.length ? (
                  <DonutChart
                    height={230}
                    data={costByCategory}
                    centerLabel={{ value: fmtCurrency(costByCategory.reduce((s, d) => s + d.value, 0)), label: 'VENDOR SPEND' }}
                  />
                ) : (
                  <AwaitingData
                    icon={PiggyBank}
                    title="No vendor costs captured"
                    hint="Fill Total Cost on each Vendor Performance submission to break spend down here."
                  />
                )}
              </div>
            </div>

            {budget.notes && (
              <div className="pcc-note">
                <span className="tiny subtle upper">Variance Notes</span>
                <p className="sm" style={{ margin: 0 }}>{budget.notes}</p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <div className="pcc-split">
        <SectionCard title="Financial Closure" subtitle="Invoices, payments and final dues">
          {!financials.record ? (
            <AwaitingData icon={Wallet} title="Financial Closure not submitted" hint="Approve the Financial Closure module to see invoicing and settlement here." />
          ) : (
            <div className="col gap-3">
              <div className="pcc-metric-row">
                <MetricTile label="Total Invoiced" value={fmtCurrency(financials.invoiced)} />
                <MetricTile label="Total Paid" value={fmtCurrency(financials.paid)} />
                <MetricTile
                  label="Pending Payment"
                  value={fmtCurrency(financials.pending)}
                  tone={financials.pending ? '#DC2626' : '#059669'}
                />
              </div>
              <ScoreBar label="Settlement Progress" value={financials.settledPct} />
              <InfoTile label="Closure Certificate No." value={financials.certificateNo} mono />
            </div>
          )}
        </SectionCard>

        <SectionCard title="Vendor-Wise Cost" subtitle="Captured spend per evaluated vendor">
          {vendorCostRows.length === 0 ? (
            <AwaitingData icon={Users} title="No vendor spend captured" hint="Total Cost is an optional field on each Vendor Performance submission." />
          ) : (
            <div className="col gap-2">
              {vendorCostRows.map((r) => {
                const max = vendorCostRows[0].cost || 1;
                return (
                  <div key={r.label} className="pcc-score-row">
                    <span className="sm pcc-score-row-label">{r.label}</span>
                    <div className="pcc-score-row-track"><ProgressBar value={(r.cost / max) * 100} height={6} gradient="#16a79a" /></div>
                    <span className="sm tabular" style={{ fontWeight: 650, minWidth: 76, textAlign: 'right' }}>{fmtCurrency(r.cost)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ────────────────────────────── Timeline Analysis ─────────────────────────── */

export function TimelineAnalysisTab({ schedule, phases, departmentDelays, criticalDelays, onExportPdf, onExportExcel }) {
  const phaseRows = phases.filter((p) => p.actualDays != null || p.plannedDays != null);
  const milestones = phases.filter((p) => p.completedAt);

  return (
    <div className="col gap-3">
      <SectionCard
        title="Schedule Summary"
        subtitle="Planned versus actual duration, closed out against the Delay Analysis submission"
        action={<ExportBar onPdf={onExportPdf} onExcel={onExportExcel} disabled={!phaseRows.length} />}
      >
        <div className="pcc-metric-row">
          <MetricTile label="Planned Duration" value={days(schedule.planned)} />
          <MetricTile label="Actual Duration" value={days(schedule.actual)} />
          <MetricTile
            label={schedule.delayDays != null && schedule.delayDays < 0 ? 'Ahead of Schedule' : 'Delay'}
            value={schedule.delayDays == null ? '—' : schedule.delayDays === 0 ? 'On Time' : days(Math.abs(schedule.delayDays))}
            tone={schedule.delayDays == null ? undefined : schedule.delayDays > 0 ? '#DC2626' : '#059669'}
          />
          <MetricTile
            label="Timeline Efficiency"
            value={pct(schedule.efficiencyPct)}
            tone={schedule.efficiencyPct != null && schedule.efficiencyPct >= 100 ? '#059669' : '#D97706'}
          />
          <MetricTile label="Timeline Score" value={schedule.score != null ? `${Math.round(schedule.score)}/100` : '—'} tone={scoreTone(schedule.score)} />
        </div>
        {(schedule.reason || schedule.rootCause || schedule.recovery) && (
          <div className="col gap-2" style={{ marginTop: 14 }}>
            {schedule.rootCause && <InfoTile label="Root Cause" value={schedule.rootCause} />}
            {schedule.reason && (
              <div className="pcc-note">
                <span className="tiny subtle upper">Delay Reason</span>
                <p className="sm" style={{ margin: 0 }}>{schedule.reason}</p>
              </div>
            )}
            {schedule.recovery && (
              <div className="pcc-note">
                <span className="tiny subtle upper">Recovery Actions</span>
                <p className="sm" style={{ margin: 0 }}>{schedule.recovery}</p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Phase-Wise Schedule Performance" subtitle="Elapsed time per phase against its planned window">
        {phaseRows.length === 0 ? (
          <AwaitingData icon={CalendarRange} title="No phase schedule data" hint="Phase durations appear once phases carry planned dates and completion timestamps." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th><th>Phase</th><th>Planned</th><th>Actual</th><th>Slippage</th><th>Completed On</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {phaseRows.map((p) => (
                  <tr key={p.key}>
                    <td className="tiny muted tabular">{p.index}</td>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="tabular">{p.plannedDays != null ? `${p.plannedDays}d` : '—'}</td>
                    <td className="tabular">{p.actualDays != null ? `${p.actualDays}d` : '—'}</td>
                    <td className="tabular" style={{ color: p.slippageDays == null ? undefined : p.slippageDays > 0 ? '#DC2626' : '#059669', fontWeight: 650 }}>
                      {p.slippageDays == null ? '—' : p.slippageDays === 0 ? 'On time' : `${p.slippageDays > 0 ? '+' : ''}${p.slippageDays}d`}
                    </td>
                    <td className="sm">{p.completedAt ? fmtDate(p.completedAt) : '—'}</td>
                    <td>
                      <Badge
                        color={p.status === 'completed' ? '#059669' : p.status === 'blocked' ? '#DC2626' : '#2563EB'}
                        soft={p.status === 'completed' ? '#DCFCE7' : p.status === 'blocked' ? '#FEE2E2' : '#DBEAFE'}
                        dot
                      >
                        {p.status === 'completed' ? 'Completed' : p.status === 'blocked' ? 'Blocked' : p.status === 'in_progress' ? 'In Progress' : 'Not Started'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="pcc-split">
        <SectionCard title="Department Delays" subtitle="Tasks that missed their planned end date, by owning department">
          {departmentDelays.length === 0 ? (
            <AwaitingData icon={Clock} title="No department delays" hint="Every department's tasks finished on or before their planned end date." />
          ) : (
            <div className="col gap-2">
              {departmentDelays.map((d) => (
                <div key={d.key} className="pcc-score-row">
                  <span className="sm pcc-score-row-label">{d.label}</span>
                  <div className="pcc-score-row-track"><ProgressBar value={d.delayPct} height={6} gradient="#DC2626" /></div>
                  <span className="sm tabular" style={{ fontWeight: 650, minWidth: 74, textAlign: 'right' }}>{d.delayed}/{d.total}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Critical Delays"
          subtitle="High-priority work that ran past its due date"
          action={<Badge color="#DC2626" soft="#FEE2E2">{criticalDelays.length}</Badge>}
        >
          {criticalDelays.length === 0 ? (
            <AwaitingData icon={AlertTriangle} title="No critical delays" hint="No high or critical priority task overran its planned end date." />
          ) : (
            <div className="col gap-2">
              {criticalDelays.slice(0, 10).map((t) => (
                <div key={t._id} className="pcc-list-row">
                  <span className="sm grow" style={{ fontWeight: 600 }}>{t.title}</span>
                  <Badge color="#DC2626" soft="#FEE2E2">{t.priority}</Badge>
                  <span className="tiny muted">{t.plannedEnd ? `Due ${fmtDate(t.plannedEnd)}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Milestone Analysis" subtitle="Every phase that reached completion, in the order it closed">
        {milestones.length === 0 ? (
          <AwaitingData icon={Target} title="No milestones reached yet" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Milestone</th><th>Completed On</th><th>Duration</th><th>Outcome</th></tr></thead>
              <tbody>
                {[...milestones].sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt)).map((m) => (
                  <tr key={m.key}>
                    <td style={{ fontWeight: 600 }}>Phase {m.index} · {m.name}</td>
                    <td className="sm">{fmtDate(m.completedAt)}</td>
                    <td className="tabular">{m.actualDays != null ? `${m.actualDays}d` : '—'}</td>
                    <td>
                      {m.onTime == null
                        ? <span className="tiny muted">—</span>
                        : <Badge color={m.onTime ? '#059669' : '#DC2626'} soft={m.onTime ? '#DCFCE7' : '#FEE2E2'}>{m.onTime ? 'On Time' : 'Delayed'}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ───────────────────────────── Vendor Performance ─────────────────────────── */

export function VendorPerformanceTab({ vendors, onOpenRecord, onExportPdf, onExportExcel }) {
  if (!vendors.length) {
    return (
      <SectionCard title="Vendor Scorecard">
        <AwaitingData
          icon={Users}
          title="No vendor evaluations approved yet"
          hint="File one Vendor Performance submission per vendor — each approved submission becomes a row of this scorecard."
        />
      </SectionCard>
    );
  }

  const rated = vendors.filter((v) => v.overall != null);
  const best = rated.length ? rated.reduce((a, b) => (b.overall > a.overall ? b : a)) : null;
  const worst = rated.length ? rated.reduce((a, b) => (b.overall < a.overall ? b : a)) : null;
  const totalCost = vendors.reduce((s, v) => s + (v.cost || 0), 0);
  const unpaid = vendors.filter((v) => v.paymentStatus !== 'Paid').length;

  return (
    <div className="col gap-3">
      <SectionCard
        title={`Vendor Scorecard (${vendors.length})`}
        subtitle="One row per approved Vendor Performance submission"
        action={<ExportBar onPdf={onExportPdf} onExcel={onExportExcel} />}
      >
        <div className="pcc-metric-row" style={{ marginBottom: 14 }}>
          <MetricTile label="Vendors Evaluated" value={vendors.length} />
          <MetricTile label="Top Performer" value={best?.name || '—'} sub={best?.overall != null ? `${Math.round(best.overall)}/100` : undefined} tone="#059669" />
          <MetricTile label="Needs Review" value={worst?.name || '—'} sub={worst?.overall != null ? `${Math.round(worst.overall)}/100` : undefined} tone="#DC2626" />
          <MetricTile label="Total Vendor Cost" value={totalCost ? fmtCurrency(totalCost) : '—'} />
          <MetricTile label="Payments Outstanding" value={unpaid} tone={unpaid ? '#DC2626' : '#059669'} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table table-clickable">
            <thead>
              <tr>
                <th>Vendor</th><th>Category</th><th>Assigned</th><th>Completed</th><th>Delayed</th>
                <th>Quality</th><th>SLA</th><th>Rating</th><th>Cost</th><th>Payment</th><th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} onClick={() => onOpenRecord?.(v.record)}>
                  <td style={{ fontWeight: 650 }}>{v.name}</td>
                  <td><Badge color="#64748B" soft="#F1F5F9">{v.category}</Badge></td>
                  <td className="tabular">{v.assigned ?? '—'}</td>
                  <td className="tabular">{v.completed ?? '—'}</td>
                  <td className="tabular" style={{ color: v.delayed ? '#DC2626' : undefined }}>{v.delayed ?? '—'}</td>
                  <td className="tabular">{v.quality != null ? `${v.quality}` : '—'}</td>
                  <td className="tabular">{v.sla != null ? `${v.sla}%` : '—'}</td>
                  <td className="tabular">{v.rating != null ? `${v.rating}/5` : '—'}</td>
                  <td className="tabular">{v.cost != null ? fmtCurrency(v.cost) : '—'}</td>
                  <td>
                    <Badge
                      color={v.paymentStatus === 'Paid' ? '#059669' : v.paymentStatus === 'Partial' ? '#D97706' : '#DC2626'}
                      soft={v.paymentStatus === 'Paid' ? '#DCFCE7' : v.paymentStatus === 'Partial' ? '#FEF3C7' : '#FEE2E2'}
                    >
                      {v.paymentStatus}
                    </Badge>
                  </td>
                  <td><GradePill score={v.overall} grade={v.grade} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {rated.length > 0 && (
        <SectionCard title="Vendor Performance Ranking" subtitle="Blended score across rating, quality and SLA compliance">
          <div className="col gap-2">
            {[...rated].sort((a, b) => b.overall - a.overall).map((v) => (
              <ScoreBar key={v.id} label={v.name} value={v.overall} hint={v.category} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ─────────────────────────── Department Performance ───────────────────────── */

function DepartmentCard({ dept, onOpen }) {
  const tone = scoreTone(dept.overall);
  return (
    <button type="button" className="card pcc-dept-card" onClick={onOpen} style={{ '--dept-color': dept.color }}>
      <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="pcc-dept-chip"><Building2 size={16} strokeWidth={2} /></span>
        <GradePill score={dept.overall} grade={dept.grade} />
      </div>
      <div className="col gap-1">
        <span style={{ fontWeight: 650 }}>{dept.label}</span>
        <span className="tiny muted">{dept.total} task{dept.total === 1 ? '' : 's'} · {dept.completed} approved</span>
      </div>
      <div className="col gap-2" style={{ width: '100%' }}>
        <ScoreBar label="Completion" value={dept.completionPct} width={64} />
        <ScoreBar label="Quality" value={dept.qualityPct} width={64} />
        <ScoreBar label="Productivity" value={dept.productivityPct} width={64} />
      </div>
      <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <span className="tiny muted">{dept.delayed} delayed · {dept.blocked} blocked</span>
        <span className="sm tabular" style={{ fontWeight: 750, color: tone }}>
          {dept.overall == null ? '—' : `${Math.round(dept.overall)}/100`}
        </span>
      </div>
    </button>
  );
}

export function DepartmentPerformanceTab({ departments, truncatedNote, onOpenDepartment, onExportPdf, onExportExcel }) {
  if (!departments.length) {
    return (
      <SectionCard title="Department Performance">
        <AwaitingData
          icon={Building2}
          title="No departmental work on this project"
          hint="Scorecards are built from the tasks each department owns across every phase."
        />
      </SectionCard>
    );
  }

  return (
    <div className="col gap-3">
      {truncatedNote && (
        <div className="pcc-note" style={{ borderLeftColor: '#D97706' }}>
          <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}>
            <AlertTriangle size={12} /> Partial coverage
          </span>
          <p className="sm" style={{ margin: 0 }}>{truncatedNote}</p>
        </div>
      )}
      <SectionCard
        title={`Department Scorecards (${departments.length})`}
        subtitle="Completion, delay, quality and productivity computed from each department's own tasks"
        action={<ExportBar onPdf={onExportPdf} onExcel={onExportExcel} />}
      >
        <div className="pcc-dept-grid">
          {departments.map((d) => (
            <DepartmentCard key={d.key} dept={d} onOpen={() => onOpenDepartment?.(d)} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Department Comparison" subtitle="Overall rating side by side">
        <ComparisonBar
          height={280}
          suffix="%"
          data={departments.map((d) => ({
            label: d.label,
            completion: Math.round(d.completionPct ?? 0),
            quality: Math.round(d.qualityPct ?? 0),
            productivity: Math.round(d.productivityPct ?? 0),
          }))}
          keys={[
            { key: 'completion', name: 'Completion', color: '#2563EB' },
            { key: 'quality', name: 'Quality', color: '#059669' },
            { key: 'productivity', name: 'Productivity', color: '#7C3AED' },
          ]}
        />
      </SectionCard>

      <SectionCard title="Department Detail">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Department</th><th>Tasks</th><th>Approved</th><th>Delayed</th><th>Rework</th>
                <th>Completion</th><th>Quality</th><th>Productivity</th><th>Overall</th><th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.key}>
                  <td style={{ fontWeight: 650 }}><Badge color={d.color}>{d.label}</Badge></td>
                  <td className="tabular">{d.total}</td>
                  <td className="tabular">{d.completed}</td>
                  <td className="tabular" style={{ color: d.delayed ? '#DC2626' : undefined }}>{d.delayed}</td>
                  <td className="tabular">{d.reworked}</td>
                  <td className="tabular">{d.completionPct == null ? '—' : `${Math.round(d.completionPct)}%`}</td>
                  <td className="tabular">{d.qualityPct == null ? '—' : `${Math.round(d.qualityPct)}%`}</td>
                  <td className="tabular">{d.productivityPct == null ? '—' : `${Math.round(d.productivityPct)}%`}</td>
                  <td className="tabular" style={{ fontWeight: 700, color: scoreTone(d.overall) }}>
                    {d.overall == null ? '—' : Math.round(d.overall)}
                  </td>
                  <td><GradePill score={d.overall} grade={d.grade} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* ───────────────────────────── Project Health Report ──────────────────────── */

/** The eight-axis health report — also embedded on the overview's right rail. */
export function HealthReportPanel({ health, compact }) {
  const filled = health.axes.filter((a) => a.value != null);
  return (
    <div className="col gap-3">
      <div className="pcc-health-head">
        <div className="col gap-1">
          <span className="pcc-health-score" style={{ color: scoreTone(health.overall) }}>
            {health.overall == null ? '—' : Math.round(health.overall)}
            <span className="pcc-health-score-max">/100</span>
          </span>
          <span className="tiny muted">Overall project score across {filled.length} of {health.axes.length} axes</span>
        </div>
        <div className="col gap-1" style={{ alignItems: 'flex-end' }}>
          <span className="tiny subtle upper">Risk Index</span>
          <span className="sm tabular" style={{ fontWeight: 750, color: health.riskIndex == null ? undefined : scoreTone(100 - health.riskIndex) }}>
            {health.riskIndex == null ? '—' : `${Math.round(health.riskIndex)}%`}
          </span>
        </div>
      </div>
      <div className="col gap-2">
        {health.axes.map((a) => <ScoreBar key={a.key} label={a.label} value={a.value} width={compact ? 70 : 120} />)}
      </div>
      {filled.length < health.axes.length && (
        <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}>
          <Gauge size={12} /> Axes without an approved submission are excluded from the overall score rather than counted as zero.
        </span>
      )}
    </div>
  );
}
