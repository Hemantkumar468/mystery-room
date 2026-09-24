import { Fragment, useMemo, useState } from 'react';
import { ClipboardCheck, ChevronDown, ChevronRight, ListTodo, ListChecks } from 'lucide-react';
import { Avatar, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { Kpi } from '../../components/ops/common.jsx';
import { useKra } from '../../lib/opsQueries.js';
import { errMsg } from '../../lib/opsUi.js';
import { DEPT_META } from '../../lib/ui.js';
import { ScoreRing, ScoreNum, TeamChips, scoreColor, isNum, round, pct, num, fmtInt } from './perfCommon.jsx';

const KRA_LABEL = {
  timeliness: 'Timeliness',
  quality: 'Quality',
  responsiveness: 'Responsiveness',
  ownership: 'Ownership',
  priority: 'Priority focus',
};

/** How each KRA input is labelled and formatted. Unknown keys fall back to a humanised label. */
const FIELD = {
  onTimePct: ['on-time', pct],
  avgDelayDays: ['avg delay', (v) => (isNum(v) ? `${num(v)}d` : '—')],
  overduePendingPct: ['overdue pending', pct],
  avgRevisions: ['avg revisions', (v) => num(v)],
  reworkPct: ['rework', pct],
  sentBackPct: ['sent back', pct],
  avgFollowUp: ['avg follow-ups', (v) => num(v)],
  followUpPct: ['followed up', pct],
  totalTasks: ['tasks', fmtInt],
  completionPct: ['completed', pct],
  shiftedPct: ['shifted', pct],
  priorityCompletionPct: ['high/critical done', pct],
  totalCriticalHigh: ['high/critical tasks', fmtInt],
};

const humanize = (k) => k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();

function describe(block) {
  return Object.entries(block || {})
    .filter(([k, v]) => k !== 'score' && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => {
      const [label, fmt] = FIELD[k] || [humanize(k), (x) => (isNum(x) ? num(x) : String(x ?? '—'))];
      return `${label} ${fmt(v)}`;
    })
    .join(' · ');
}

/** KRA report — a scored, explainable view of how each person works. */
export function KraReport({ params, canSeeOthers }) {
  const { data, isLoading, isError, error, isFetching } = useKra(params);
  const [open, setOpen] = useState(null);
  const rows = data?.rows;

  const summary = useMemo(() => {
    const scored = (rows || []).filter((r) => isNum(r.overallScore));
    const avg = scored.length ? scored.reduce((s, r) => s + r.overallScore, 0) / scored.length : null;
    return {
      people: rows?.length || 0,
      avg,
      strong: scored.filter((r) => r.overallScore >= 80).length,
      weak: scored.filter((r) => r.overallScore < 60).length,
    };
  }, [rows]);

  if (isLoading) return <SkTable rows={7} />;
  if (isError) {
    return <div className="card"><EmptyState icon={ClipboardCheck} title="Couldn't load the KRA report" hint={errMsg(error)} /></div>;
  }

  return (
    <div className="col gap-5">
      <div className="kpi-row">
        <Kpi label="People scored" value={summary.people} />
        <Kpi label="Average score" value={isNum(summary.avg) ? round(summary.avg) : '—'} color={scoreColor(summary.avg)} />
        <Kpi label="Scoring 80+" value={summary.strong} color="var(--success)" />
        <Kpi label="Below 60" value={summary.weak} color="var(--danger)" />
      </div>

      {!canSeeOthers && (
        <div className="info-line">This report shows your own KRA scores. Managers see their people and department; admins see everyone.</div>
      )}

      {!rows?.length ? (
        <div className="card">
          <EmptyState icon={ClipboardCheck} title="No tasks in this range" hint="Widen the date range or clear a filter." />
        </div>
      ) : (
        <div className="card" style={{ opacity: isFetching ? 0.7 : 1, transition: 'var(--transition)' }}>
          <div className="table-wrap">
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Rank</th>
                  <th>Person</th>
                  <th style={{ textAlign: 'center' }}>Overall</th>
                  <th style={{ textAlign: 'center' }}>Delegation</th>
                  <th style={{ textAlign: 'center' }}>Checklist</th>
                  <th style={{ textAlign: 'right' }}>Tasks</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open === r.doerId;
                  return (
                    <Fragment key={r.doerId}>
                      <tr className={`kra-row ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : r.doerId)}>
                        <td><span className="rank" style={{ width: 'auto' }}>#{r.rank ?? '—'}</span></td>
                        <td>
                          <div className="row gap-3">
                            <Avatar name={r.doer} color={r.avatarColor} size={32} />
                            <div className="col gap-1" style={{ minWidth: 0 }}>
                              <span className="nowrap" style={{ fontWeight: 600 }}>{r.doer}</span>
                              <span className="tiny muted">{[r.title, DEPT_META[r.department]].filter(Boolean).join(' · ') || ' '}</span>
                              <TeamChips teams={r.teams} />
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}><ScoreRing value={r.overallScore} /></td>
                        <td style={{ textAlign: 'center' }}><ScoreNum value={r.delegation?.score} /></td>
                        <td style={{ textAlign: 'center' }}><ScoreNum value={r.checklist?.score} /></td>
                        <td className="tabular" style={{ textAlign: 'right' }}>{fmtInt(r.totalTasks)}</td>
                        <td>{isOpen ? <ChevronDown size={16} className="subtle" /> : <ChevronRight size={16} className="subtle" />}</td>
                      </tr>
                      {isOpen && (
                        <tr className="kra-row open">
                          <td colSpan={7} style={{ cursor: 'default' }}>
                            <div className="kra-detail">
                              <KraBlock title="Delegation" icon={ListTodo} block={r.delegation} />
                              <KraBlock title="Checklist" icon={ListChecks} block={r.checklist} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KraBlock({ title, icon: Icon, block }) {
  if (!block) {
    return (
      <div className="kra-block">
        <div className="row gap-2" style={{ fontWeight: 700 }}><Icon size={16} /> {title}</div>
        <div className="sm muted" style={{ marginTop: 8 }}>No {title.toLowerCase()} tasks in this range — not scored.</div>
      </div>
    );
  }
  const kra = block.kra || {};
  return (
    <div className="kra-block">
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="row gap-2" style={{ fontWeight: 700 }}><Icon size={16} /> {title}</span>
        <span className="row gap-2">
          <span className="tiny muted">{fmtInt(block.totalTasks)} tasks</span>
          <ScoreRing value={block.score} size={40} />
        </span>
      </div>
      {Object.keys(KRA_LABEL)
        .filter((k) => kra[k] !== undefined)
        .map((k) => {
          const s = kra[k]?.score;
          return (
            <div className="kra-line" key={k}>
              <span className="sm" style={{ fontWeight: 600 }}>{KRA_LABEL[k]}</span>
              <div className="col gap-1" style={{ minWidth: 0 }}>
                {isNum(s) ? (
                  <ProgressBar value={s} height={6} gradient={scoreColor(s)} />
                ) : (
                  <span className="tiny subtle">Not applicable</span>
                )}
                <span className="tiny muted">{kra[k] ? describe(kra[k]) || '—' : '—'}</span>
              </div>
              <span className="tabular" style={{ textAlign: 'right', fontWeight: 750, color: scoreColor(s) }}>
                {isNum(s) ? round(s) : '—'}
              </span>
            </div>
          );
        })}
    </div>
  );
}

export default KraReport;
