import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, Users, AlertTriangle, PackageCheck, ArrowRight, HardHat,
} from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { fmtDate } from '../../lib/format.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { useGetHrmsOverviewQuery } from '../../app/api/hrmsApi.js';

/**
 * Live signals from the OTHER phases, shown where a phase checks their work.
 *
 * The client's flow is explicit that the checking phases do not re-collect
 * information that already exists: Quality Check reads what the site reported
 * daily and what HRMS says about hiring; Readiness reads the order tracker.
 * These strips are those reads — every card links to the module that owns the
 * data, and nothing here is editable, so there is never a second copy to
 * drift.
 */

function SignalCard({ icon: Icon, tone, title, value, detail, to, linkText }) {
  return (
    <div className="psig-card">
      <span className="psig-icon" style={{ background: `${tone}18`, color: tone }}><Icon size={16} /></span>
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="psig-title">{title}</span>
        <span className="psig-value">{value}</span>
        {detail && <span className="tiny muted">{detail}</span>}
      </div>
      {to && (
        <Link className="psig-link" to={to}>{linkText || 'Open'} <ArrowRight size={11} aria-hidden /></Link>
      )}
    </div>
  );
}

/** What the site reported, straight from the Phase 7 daily reports. */
function SiteReportSignal({ projectId }) {
  const { data } = useStageRecords(projectId, 'p6', { assessmentType: 'daily_site_report' });
  const reports = useMemo(() => [...(data?.data || data || [])].sort(
    (a, b) => new Date(b.values?.report_date || b.createdAt) - new Date(a.values?.report_date || a.createdAt),
  ), [data]);
  const latest = reports[0];
  const pct = latest ? Number(latest.values?.overall_progress_pct) : null;
  const blockers = reports.filter((r) => r.values?.blocked === true).length;
  const stale = latest && dayjs().diff(dayjs(latest.values?.report_date || latest.createdAt), 'day') > 2;

  return (
    <SignalCard
      icon={HardHat}
      tone={stale ? 'var(--warning)' : 'var(--primary)'}
      title="Site — daily reports"
      value={latest ? `${Number.isFinite(pct) ? `${pct}% reported` : 'Reported'} · ${reports.length} report${reports.length === 1 ? '' : 's'}` : 'No reports filed yet'}
      detail={latest
        ? `last on ${fmtDate(latest.values?.report_date || latest.createdAt)}${stale ? ' — gone quiet' : ''}${blockers ? ` · ${blockers} blocker${blockers === 1 ? '' : 's'} raised` : ''}`
        : 'The supervisor files one every working day in Phase 7'}
      to={`/projects/${projectId}/daily-reports`}
      linkText="All reports"
    />
  );
}

/** Hiring for THIS centre, straight from HRMS. */
function HiringSignal({ projectId }) {
  const { data } = useGetHrmsOverviewQuery();
  const row = (data?.byProject || []).find((p) => String(p.projectId) === String(projectId));
  const hired = row?.hired || 0;
  const needed = row?.headcount || 0;
  const short = needed > hired;

  return (
    <SignalCard
      icon={Users}
      tone={!row ? 'var(--text-subtle)' : short ? 'var(--warning)' : 'var(--success)'}
      title="Hiring — from HRMS"
      value={row ? `${hired} hired of ${needed} needed` : 'No requisitions yet'}
      detail={row
        ? `${row.openRoles ?? row.requisitions ?? ''} ${row.openRoles != null ? 'role(s) still open' : 'requisition(s)'}`.trim()
        : 'Phase 7’s hiring task creates them'}
      to="/hrms/overview"
      linkText="HRMS"
    />
  );
}

/** Order book for this project, straight from the Phase 5 BOQ / Phase 6 tracker. */
function OrdersSignal({ projectId }) {
  const { data } = useStageRecords(projectId, 'p13');
  const lines = data?.data || data || [];
  const by = { received: 0, moving: 0, ordered: 0, notSent: 0 };
  for (const l of lines) {
    const s = l.values?.order_status;
    if (s === 'Received (GRN)') by.received += 1;
    else if (s === 'Dispatched' || s === 'Delivered' || s === 'Partly Received') by.moving += 1;
    else if (s === 'Ordered' || s === 'Short / Damaged') by.ordered += 1;
    else by.notSent += 1;
  }
  const done = lines.length > 0 && by.received === lines.length;

  return (
    <SignalCard
      icon={PackageCheck}
      tone={done ? 'var(--success)' : by.notSent ? 'var(--warning)' : 'var(--primary)'}
      title="Orders — from the tracker"
      value={lines.length ? `${by.received} of ${lines.length} received` : 'No BOQ lines yet'}
      detail={lines.length ? `${by.moving} on the way · ${by.ordered} ordered · ${by.notSent} not sent` : 'Phase 5 creates the BOQ; Phase 6 orders it'}
      to={`/projects/${projectId}/procurement`}
      linkText="Order tracker"
    />
  );
}

/** Open QC fails, from this phase's own records — the number the gate watches. */
function QcFailSignal({ projectId }) {
  const { data } = useStageRecords(projectId, 'p16');
  const items = data?.data || data || [];
  const fails = items.filter((r) => r.values?.result === 'Fail');
  const open = fails.filter((r) => !['Rectified', 'Re-checked & Closed'].includes(r.values?.rectification_status));

  return (
    <SignalCard
      icon={AlertTriangle}
      tone={open.length ? 'var(--danger)' : 'var(--success)'}
      title="QC fails"
      value={items.length ? `${open.length} open of ${fails.length} fail${fails.length === 1 ? '' : 's'}` : 'No QC items yet'}
      detail={items.length ? `${items.length} item${items.length === 1 ? '' : 's'} inspected — the gate holds while a mandatory fail is open` : 'Log one per area inspected'}
    />
  );
}

/** Trial-run verdict, from the Phase 11 test records. */
function TrialSignal({ projectId }) {
  const { data } = useStageRecords(projectId, 'p19');
  const runs = data?.data || data || [];
  const failed = runs.filter((r) => r.values?.result === 'Fail' && r.values?.retest_result !== 'Passed');
  const allOk = runs.length > 0 && failed.length === 0;

  return (
    <SignalCard
      icon={ClipboardList}
      tone={!runs.length ? 'var(--text-subtle)' : allOk ? 'var(--success)' : 'var(--danger)'}
      title="Trial runs"
      value={runs.length ? (allOk ? `All-OK — ${runs.length} test${runs.length === 1 ? '' : 's'} passed` : `${failed.length} game${failed.length === 1 ? '' : 's'} failing`) : 'Not tested yet'}
      detail={runs.length ? 'Phase 11 — every game played end to end' : 'Phase 11 logs one record per test'}
    />
  );
}

/** Which signals belong on which phase. */
const SIGNALS = {
  p16: [SiteReportSignal, HiringSignal, QcFailSignal],
  p19: [QcFailSignal, HiringSignal],
  // The readiness gate reads everything: is the team hired, is QC clean,
  // has every order landed, did the trials pass.
  p8: [HiringSignal, QcFailSignal, OrdersSignal, TrialSignal],
};

export function PhaseSignals({ stageKey, projectId }) {
  const list = SIGNALS[stageKey];
  if (!list || !projectId) return null;
  return (
    <div className="psig-strip" data-guide="phase-signals">
      {list.map((S, i) => <S key={i} projectId={projectId} />)}
    </div>
  );
}

export default PhaseSignals;
