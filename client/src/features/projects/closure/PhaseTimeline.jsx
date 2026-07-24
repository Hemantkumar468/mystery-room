/**
 * The 10-phase project timeline shown on the Closure Command Center's
 * overview. Every node is one real `project.stages[]` entry — its completion
 * date, owning department, elapsed duration and slippage all come from the
 * stage document itself (see closureAnalytics.js#buildPhases), so a phase that
 * was never started shows blanks rather than an invented schedule.
 *
 * Horizontal on desktop and vertical below the breakpoint, both from the same
 * markup — the layout switch is pure CSS (`.pcc-phase-rail`).
 */
import { Check, CircleDot, Circle, AlertTriangle } from 'lucide-react';
import { Badge } from '../../../components/ui/primitives.jsx';
import { fmtDate } from '../../../lib/format.js';
import { deptMeta } from '../../../lib/ui.js';

const NODE_META = {
  completed: { color: '#059669', Icon: Check, label: 'Completed' },
  in_progress: { color: '#2563EB', Icon: CircleDot, label: 'In Progress' },
  blocked: { color: '#DC2626', Icon: AlertTriangle, label: 'Blocked' },
  not_started: { color: '#94A3B8', Icon: Circle, label: 'Not Started' },
};

function PhaseNode({ phase, isLast }) {
  const meta = NODE_META[phase.status] || NODE_META.not_started;
  const { Icon } = meta;
  const dept = phase.ownerDepartment ? deptMeta(phase.ownerDepartment) : null;
  const slip = phase.slippageDays;

  return (
    <li className="pcc-phase-node" style={{ '--node-color': meta.color }}>
      <div className="pcc-phase-marker">
        <span className="pcc-phase-dot"><Icon size={13} strokeWidth={2.6} /></span>
        {!isLast && <span className="pcc-phase-connector" data-done={phase.status === 'completed'} />}
      </div>
      <div className="pcc-phase-body">
        <span className="pcc-phase-index">Phase {phase.index}</span>
        <span className="pcc-phase-name" title={phase.name}>{phase.name}</span>
        <span className="tiny muted">
          {phase.completedAt ? fmtDate(phase.completedAt) : phase.startedAt ? `Started ${fmtDate(phase.startedAt)}` : 'Not started'}
        </span>
        {dept && <span className="tiny subtle">{dept.label}</span>}
        <div className="pcc-phase-tags">
          <Badge color={meta.color} soft={`${meta.color}1A`}>{meta.label}</Badge>
          {phase.actualDays != null && (
            <span className="tiny muted tabular">{phase.actualDays}d</span>
          )}
          {slip != null && slip !== 0 && (
            <span className="tiny tabular" style={{ color: slip > 0 ? '#DC2626' : '#059669', fontWeight: 650 }}>
              {slip > 0 ? `+${slip}d` : `${slip}d`}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export function PhaseTimeline({ phases }) {
  if (!phases?.length) {
    return <div className="empty sm">This project has no phases to chart.</div>;
  }
  return (
    <ol className="pcc-phase-rail">
      {phases.map((p, i) => (
        <PhaseNode key={p.key} phase={p} isLast={i === phases.length - 1} />
      ))}
    </ol>
  );
}

export default PhaseTimeline;
