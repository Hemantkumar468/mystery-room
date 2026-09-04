import { AlertTriangle, CalendarClock, IndianRupee, MapPin } from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { fmtRupeesFull } from '../../lib/format.js';

/**
 * Renderers for the analysis blocks, keyed by the block key the server sends.
 *
 * Mirrors the server registry: adding a fourth block is a file there and one
 * entry here, with no change to the page that renders them. A key with no
 * renderer is skipped rather than crashing — a server deployed ahead of the
 * client must degrade, not white-screen.
 */

function Stat({ label, value, tone }) {
  return (
    <div className="apr-stat">
      <span className="apr-stat-label">{label}</span>
      <span className="apr-stat-value" style={tone ? { color: tone } : undefined}>{value}</span>
    </div>
  );
}

function ScheduleBlock({ data }) {
  const { varianceDays, verdict, plannedEnd, actualEnd, blocking, blockingCount } = data;
  const tone = verdict === 'late' ? 'var(--danger)'
    : verdict === 'early' ? 'var(--success)' : undefined;
  const variance = varianceDays === null ? '—'
    : varianceDays === 0 ? 'On time'
      : varianceDays > 0 ? `${varianceDays}d late` : `${Math.abs(varianceDays)}d early`;

  return (
    <>
      <div className="apr-stat-row">
        <Stat label="Planned" value={plannedEnd ? dayjs(plannedEnd).format('D MMM YYYY') : '—'} />
        <Stat label="Completed" value={actualEnd ? dayjs(actualEnd).format('D MMM YYYY') : '—'} />
        <Stat label="Variance" value={variance} tone={tone} />
      </div>
      {blockingCount > 0 && (
        <p className="apr-analysis-note">
          <AlertTriangle size={13} style={{ color: 'var(--warning)' }} />
          {' '}
          Blocks {blockingCount} downstream task{blockingCount === 1 ? '' : 's'}:{' '}
          {blocking.map((b) => b.code).join(', ')}
        </p>
      )}
    </>
  );
}

function CommercialBlock({ data }) {
  const {
    lineCount, total, budgetPlanned, varianceAmount, variancePercent,
    overBudget, largeLines, largeLineThresholdPercent,
  } = data;

  return (
    <>
      <div className="apr-stat-row">
        <Stat label="Line items" value={lineCount} />
        <Stat label="Total" value={fmtRupeesFull(total) || '—'} />
        <Stat label="Budget" value={budgetPlanned ? fmtRupeesFull(budgetPlanned) : 'Not set'} />
        <Stat
          label="Variance"
          value={varianceAmount === null ? '—'
            : `${varianceAmount >= 0 ? '+' : '−'}${fmtRupeesFull(Math.abs(varianceAmount))} (${variancePercent >= 0 ? '+' : ''}${variancePercent}%)`}
          tone={overBudget ? 'var(--danger)' : varianceAmount === null ? undefined : 'var(--success)'}
        />
      </div>
      {budgetPlanned === null && (
        <p className="apr-analysis-note muted">
          No budget set on this project, so there is nothing to compare against.
        </p>
      )}
      {largeLines.length > 0 && (
        <p className="apr-analysis-note">
          <AlertTriangle size={13} style={{ color: 'var(--warning)' }} />
          {' '}
          {largeLines.length} line{largeLines.length === 1 ? ' is' : 's are'} each over{' '}
          {largeLineThresholdPercent}% of the total:{' '}
          {largeLines.map((l) => `${l.label} (${fmtRupeesFull(l.value)})`).join(', ')}
        </p>
      )}
    </>
  );
}

function PropertyBlock({ data }) {
  const { visited, shortlisted, rejected, awaiting, rejections, scope } = data;
  return (
    <>
      <div className="apr-stat-row">
        <Stat label="Visited" value={visited} />
        <Stat label="Shortlisted" value={shortlisted} tone="var(--success)" />
        <Stat label="Rejected" value={rejected} />
        <Stat label="Awaiting" value={awaiting} />
      </div>
      {rejections.length > 0 && (
        <ul className="apr-rejection-list">
          {rejections.map((r) => (
            <li key={r.id}>
              <span className="apr-rejection-name">{r.label}</span>
              <span className={r.reason ? 'muted' : 'apr-noreason'}>
                {r.reason || 'no reason recorded'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {scope === 'phase' && (
        <p className="apr-analysis-note muted">
          Counted across the whole phase — shortlisting happens later, on the phase page,
          against properties filed over several sittings.
        </p>
      )}
    </>
  );
}

const RENDERERS = {
  schedule: { icon: CalendarClock, Component: ScheduleBlock },
  commercial: { icon: IndianRupee, Component: CommercialBlock },
  property: { icon: MapPin, Component: PropertyBlock },
};

export function AnalysisBlocks({ blocks = [] }) {
  // Server sends nothing when nothing applies, so this renders nothing at all
  // rather than an empty card.
  const renderable = blocks.filter((b) => RENDERERS[b.key] || b.error);
  if (renderable.length === 0) return null;

  return (
    <section className="col gap-2">
      <h3 className="apr-section-title">Analysis</h3>
      {renderable.map((b) => {
        const entry = RENDERERS[b.key];
        const Icon = entry?.icon;
        return (
          <div key={b.key} className="apr-analysis-card">
            <div className="apr-analysis-head">
              {Icon && <Icon size={14} />}
              {b.title}
            </div>
            {b.error ? (
              /* One block failing must not cost the approver the others, so it
                 says so in place instead of taking the page down. */
              <p className="apr-analysis-note muted">{b.error}</p>
            ) : (
              <entry.Component data={b.data} />
            )}
          </div>
        );
      })}
    </section>
  );
}

export default AnalysisBlocks;
