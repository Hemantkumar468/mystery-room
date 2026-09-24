import { useState } from 'react';
import {
  Pencil, Square, Repeat, Users, CalendarRange, CalendarDays, MapPin, Building2, Tag, Paperclip, RefreshCcw, AlertTriangle, ArrowRight, FolderKanban,
} from 'lucide-react';
import { Drawer } from '../../components/ops/Drawer.jsx';
import { ChkStatusBadge, Kpi, Meta } from '../../components/ops/common.jsx';
import { Avatar, Spinner, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { useChecklistRoutine } from '../../lib/opsQueries.js';
import { drawers } from '../../store/drawerStore.js';
import { FREQ_LABEL, WEEKDAYS, chkState } from '../../lib/opsUi.js';
import { fmtDate, fmtDateTime, fromNow } from '../../lib/format.js';
import { DEPT_META } from '../../lib/ui.js';
import { RoutineFormModal } from './RoutineFormModal.jsx';
import { StopRoutineModal } from './ChecklistModals.jsx';

const dayName = (d) => WEEKDAYS.find((w) => w.value === d)?.label;

function scheduleText(r) {
  const parts = [FREQ_LABEL[r.frequency]];
  if (['weekly', 'fortnightly'].includes(r.frequency)) parts.push(`on ${dayName(r.anchorWeekday ?? 6)}`);
  if (r.frequency === 'monthly') parts.push(`on day ${r.anchorDay ?? 28}`);
  if (r.weeklyOffs?.length) parts.push(`skips ${r.weeklyOffs.map((d) => dayName(d)?.slice(0, 3)).join(', ')}`);
  return parts.join(' · ');
}

function OccurrenceRows({ rows }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {rows.map((o) => (
        <div key={o._id} className="row gap-3 row-link" style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }} onClick={() => drawers.checklistTask(o._id)}>
          <span className="mono tiny subtle" style={{ width: 90 }}>{o.code}</span>
          <span className="sm grow">{fmtDate(o.plannedDate)}</span>
          <span className="tiny muted">{o.doer?.name}</span>
          <span className="tiny muted" style={{ width: 120 }}>{o.actualDate ? fmtDateTime(o.actualDate) : '—'}</span>
          <ChkStatusBadge value={chkState(o)} />
          <ArrowRight size={14} className="subtle" />
        </div>
      ))}
    </div>
  );
}

/** A checklist routine in full: schedule, compliance, every occurrence (clickable), audit. */
export function RoutineDrawer({ id, onClose }) {
  const { data: r, isLoading, error } = useChecklistRoutine(id);
  const [editing, setEditing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const st = r?.stats || {};
  const branch = r?.branch?._id;

  const drill = (label, status, description) =>
    drawers.drill({ kind: 'checklist', label: `${r.taskName} · ${label}`, description, params: { master: id, branch, status } });

  return (
    <Drawer
      open
      onClose={onClose}
      width={760}
      title={r?.taskName || 'Checklist routine'}
      subtitle={r ? `${r.code} · ${scheduleText(r)}${r.isActive ? '' : ' · stopped'}` : ''}
      actions={
        r?.can?.edit ? (
          <div className="row gap-1">
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
            {r.isActive && <button className="btn btn-ghost btn-sm danger-text" onClick={() => setStopping(true)}><Square size={14} /> Stop</button>}
          </div>
        ) : null
      }
    >
      {isLoading && <Spinner label="Loading routine…" />}
      {error && <EmptyState icon={AlertTriangle} title="This routine isn't available" />}
      {r && (
        <div className="col gap-5">
          <div className="kpi-row">
            <Kpi label="Occurrences" value={st.total} onClick={() => drill('All occurrences', 'all', 'Every dated occurrence of this routine.')} />
            <Kpi label="Completed" value={st.completed} color="var(--success)" onClick={() => drill('Completed', 'completed', 'Closed as done.')} />
            <Kpi label="On time" value={st.onTime} color="var(--secondary)" onClick={() => drill('On time', 'on_time', 'Closed on or before the planned day.')} />
            <Kpi label="Done late" value={(st.completed || 0) - (st.onTime || 0)} color="#ea8a2b" onClick={() => drill('Done late', 'late', 'Closed after the planned day.')} />
            <Kpi label="Missed" value={st.missed} color="var(--danger)" onClick={() => drill('Missed', 'overdue', 'Past their planned day and still open.')} />
            <Kpi label="Non-functional" value={st.nonFunctional} color="var(--warning)" onClick={() => drill('Non-functional', 'non_functional', 'Closed as not applicable — excluded from compliance.')} />
            <Kpi label="Upcoming" value={st.upcoming} color="var(--info)" onClick={() => drill('Upcoming', 'upcoming', 'Scheduled after today.')} />
          </div>

          <div className="card card-pad col gap-2">
            <div className="row between"><span className="sm muted">Compliance</span><b className="tabular">{st.complianceRate ?? 100}%</b></div>
            <ProgressBar value={st.complianceRate ?? 100} height={8} gradient={st.complianceRate >= 90 ? 'var(--success)' : st.complianceRate >= 70 ? 'var(--warning)' : 'var(--danger)'} />
          </div>

          <div className="card card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 var(--space-6)' }}>
            <div>
              <Meta icon={Users} label="Doer"><span className="row gap-2" style={{ justifyContent: 'flex-end' }}><Avatar name={r.doer?.name} color={r.doer?.avatarColor} size={20} />{r.doer?.name}</span></Meta>
              <Meta icon={Repeat} label="Schedule">{scheduleText(r)}</Meta>
              <Meta icon={CalendarRange} label="Window">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</Meta>
              <Meta icon={RefreshCcw} label="Auto-renew">{r.autoRenew ? 'Yes — extends a year ahead' : 'No'}</Meta>
            </div>
            <div>
              <Meta icon={Building2} label="Branch">{r.branch ? `${r.branch.name} (${r.branch.code})` : null}</Meta>
              <Meta icon={MapPin} label="Site">{r.site}</Meta>
              <Meta icon={Tag} label="Department">{DEPT_META[r.department] || r.department}</Meta>
              <Meta icon={FolderKanban} label="Group">{r.group?.name}</Meta>
              <Meta icon={Paperclip} label="Proof">{r.proofRequired ? 'Required' : 'Not needed'}</Meta>
              <Meta icon={CalendarDays} label="Created">{fmtDate(r.createdAt)}{r.createdBy ? ` by ${r.createdBy.name}` : ''}</Meta>
            </div>
          </div>
          {r.description && <p className="sm" style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>}

          {r.upcoming?.length > 0 && (
            <div className="drawer-section"><span className="eyebrow">Next up</span><OccurrenceRows rows={r.upcoming} /></div>
          )}
          <div className="drawer-section">
            <span className="eyebrow">Recent occurrences</span>
            {r.recent?.length ? <OccurrenceRows rows={r.recent} /> : <div className="tiny muted">Nothing due yet</div>}
          </div>

          {r.activity?.length > 0 && (
            <div className="drawer-section">
              <span className="eyebrow">Activity</span>
              {r.activity.map((a) => (
                <div key={a._id} className="row gap-2 sm" style={{ padding: '5px 0' }}>
                  <Avatar name={a.actor?.name} color={a.actor?.avatarColor} size={20} />
                  <span className="grow"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.description}</span></span>
                  <span className="tiny subtle nowrap">{fromNow(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <RoutineFormModal open={editing} routine={r} onClose={() => setEditing(false)} />
      <StopRoutineModal routine={stopping ? r : null} onClose={() => setStopping(false)} />
    </Drawer>
  );
}

export default RoutineDrawer;
