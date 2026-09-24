import { useEffect, useState } from 'react';
import { RotateCcw, Search, Trash2 } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { BranchSwitcher } from '../../components/ops/BranchSwitcher.jsx';
import { DlgStatusBadge } from '../../components/ops/common.jsx';
import { Avatar, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useDeletedDelegations, useRestoreDelegation } from '../../lib/opsQueries.js';
import { useOpsStore } from '../../store/opsStore.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { errMsg } from '../../lib/opsUi.js';
import { drawers } from '../../store/drawerStore.js';
import { fmtDate, fromNow } from '../../lib/format.js';
import { can } from '../../lib/roles.js';

/** Soft-deleted tasks — admins see all, everyone else the ones they assigned. */
export function TrashPage() {
  const branch = useOpsStore((s) => s.branch) || undefined;
  const role = useAppSelector(selectCurrentUser)?.role;
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data: rows = [], isLoading } = useDeletedDelegations({ branch, search: q || undefined });
  const restore = useRestoreDelegation();

  const doRestore = async (t) => {
    try {
      await restore.mutateAsync(t._id);
      toast.success(`${t.code} restored`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <>
      <Topbar
        title="Trash"
        subtitle={can.actForLeadership(role) ? 'Every deleted task — restore brings back its sub-tasks too' : 'Tasks you assigned that were deleted'}
        actions={<BranchSwitcher />}
      />
      <div className="content">
        <div className="content-narrow col gap-4 fade-in">
          <label className="search-box" style={{ maxWidth: 360 }}>
            <Search size={15} className="subtle" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deleted tasks…" />
          </label>
          {isLoading ? <SkTable rows={6} /> : !rows.length ? (
            <div className="card"><EmptyState icon={Trash2} title="Trash is empty" /></div>
          ) : (
            <div className="card">
              <table className="table table-clickable">
                <thead>
                  <tr><th>Task</th><th>Doer</th><th>Status</th><th>Due</th><th>Deleted</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t._id} className="row-link" onClick={() => drawers.task(t._id)} title="Open the deleted task">
                      <td>
                        <div className="col">
                          <span className="mono tiny subtle">{t.code}</span>
                          <span style={{ fontWeight: 600 }}>{t.title}</span>
                        </div>
                      </td>
                      <td><span className="row gap-2"><Avatar name={t.doer?.name} color={t.doer?.avatarColor} size={24} />{t.doer?.name}</span></td>
                      <td><DlgStatusBadge value={t.status} /></td>
                      <td className="sm">{fmtDate(t.dueDate)}</td>
                      <td className="sm"><span title={fmtDate(t.deletedAt)}>{fromNow(t.deletedAt)}</span><div className="tiny muted">by {t.deletedBy?.name || '—'}</div></td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-subtle btn-sm" onClick={(e) => { e.stopPropagation(); doRestore(t); }} disabled={restore.isPending}><RotateCcw size={14} /> Restore</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default TrashPage;
