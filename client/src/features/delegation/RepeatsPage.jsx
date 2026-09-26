import { useState } from 'react';
import { Repeat, Pause, Play, CalendarX } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { BranchSwitcher } from '../../components/ops/BranchSwitcher.jsx';
import { Segmented } from '../../components/ops/common.jsx';
import { Avatar, Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useRecurrences, useUpdateRecurrence } from '../../lib/opsQueries.js';
import { useOpsStore } from '../../store/opsStore.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { FREQ_LABEL, WEEKDAYS, errMsg } from '../../lib/opsUi.js';
import { drawers } from '../../store/drawerStore.js';
import { fmtDate } from '../../lib/format.js';
import { can } from '../../lib/roles.js';

const dayName = (d) => WEEKDAYS.find((w) => w.value === d)?.short;
const dates = (list = []) => list.map((x) => (x === 'last' ? 'last day' : x)).join(', ');

/** Human sentence for a repeat rule. */
export function describeRule(r) {
  switch (r.frequency) {
    case 'daily': return 'Every day';
    case 'weekly': return `Every ${(r.weeklyDays || []).map(dayName).join(', ')}`;
    case 'monthly': return `Monthly on ${dates(r.monthDates)}`;
    case 'yearly': return `Every year on ${fmtDate(r.startDate).slice(0, 6)}`;
    case 'periodically': return `Every ${r.intervalDays} days`;
    case 'custom':
      return r.custom?.every === 'week'
        ? `Every ${r.custom.value} weeks on ${(r.custom.weekdays || []).map(dayName).join(', ')}`
        : `Every ${r.custom?.value} months on ${dates(r.custom?.dates)}`;
    default: return FREQ_LABEL[r.frequency] || r.frequency;
  }
}

/** Repeat rules behind recurring delegations — pause, resume or end them. */
export function RepeatsPage() {
  const branch = useOpsStore((s) => s.branch) || undefined;
  const user = useAppSelector(selectCurrentUser);
  const me = user?.id || user?._id;
  const [active, setActive] = useState('true');
  const { data: rules = [], isLoading } = useRecurrences({ branch, active: active === 'true' ? 'true' : undefined });
  const update = useUpdateRecurrence();
  const [ending, setEnding] = useState(null);
  const [endDate, setEndDate] = useState('');

  const toggle = async (r) => {
    try {
      await update.mutateAsync({ id: r._id, isActive: !r.isActive });
      toast.success(r.isActive ? 'Paused — no new instances will be created' : 'Resumed');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveEnd = async () => {
    try {
      await update.mutateAsync({ id: ending._id, endDate: endDate || null });
      toast.success(endDate ? `Ends on ${fmtDate(endDate)}` : 'End date removed');
      setEnding(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <>
      <Topbar title="Repeat rules" subtitle="Recurring delegations — the nightly job creates each day's instance" actions={<BranchSwitcher />} />
      <div className="content">
        <div className="content-narrow col gap-4 fade-in">
          <Segmented value={active} onChange={setActive} options={[{ value: 'true', label: 'Active' }, { value: 'all', label: 'All' }]} />
          {isLoading ? <SkTable rows={5} /> : !rules.length ? (
            <div className="card"><EmptyState icon={Repeat} title="No repeat rules" hint='Tick "Repeat this task" when assigning a task to create one.' /></div>
          ) : (
            <div className="card">
              <table className="table table-clickable">
                <thead>
                  <tr><th>Task</th><th>Schedule</th><th>Doer</th><th>Next</th><th>Window</th><th /></tr>
                </thead>
                <tbody>
                  {rules.map((r) => {
                    const mine = can.actForLeadership(user?.role) || String(r.blueprint?.assigner?._id) === String(me);
                    return (
                      <tr key={r._id} className="row-link" onClick={() => drawers.recurrence(r._id)}>
                        <td>
                          <div className="col">
                            <span style={{ fontWeight: 600 }}>{r.blueprint?.title}</span>
                            <span className="tiny muted">by {r.blueprint?.assigner?.name} · {r.blueprint?.category}</span>
                          </div>
                        </td>
                        <td className="sm">
                          <span className="row gap-1"><Repeat size={13} className="subtle" /> {describeRule(r)}</span>
                          {!r.isActive && <Badge color="#7c7784">Paused</Badge>}
                        </td>
                        <td><span className="row gap-2"><Avatar name={r.blueprint?.doer?.name} color={r.blueprint?.doer?.avatarColor} size={24} />{r.blueprint?.doer?.name}</span></td>
                        <td className="sm">{r.nextDates?.length ? r.nextDates.map((d) => fmtDate(d).slice(0, 6)).join(' · ') : '—'}</td>
                        <td className="sm">{fmtDate(r.startDate)} → {r.endDate ? fmtDate(r.endDate) : 'ongoing'}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                          {mine && (
                            <>
                              <button className="btn btn-ghost btn-sm" onClick={() => toggle(r)} disabled={update.isPending}>
                                {r.isActive ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => { setEnding(r); setEndDate(r.endDate || ''); }}>
                                <CalendarX size={14} /> End date
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <Modal
        open={Boolean(ending)}
        onClose={() => setEnding(null)}
        title="When should it stop?"
        subtitle={ending?.blueprint?.title}
        width={440}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEnding(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEnd} disabled={update.isPending}>Save</button>
          </>
        }
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">Last day (leave empty to keep it ongoing)</label>
          <input className="input" type="date" value={endDate} min={ending?.startDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}

export default RepeatsPage;
