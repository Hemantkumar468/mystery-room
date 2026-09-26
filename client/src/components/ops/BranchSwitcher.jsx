import { Building2 } from 'lucide-react';
import { useBranches } from '../../lib/opsQueries.js';
import { useOpsStore } from '../../store/opsStore.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';

/**
 * Headquarters-wise switch: every delegation / checklist / performance list is
 * partitioned by branch. MD, EA and managers can also look across all branches.
 */
export function BranchSwitcher({ allowAll = true }) {
  const { branch, setBranch } = useOpsStore();
  const user = useAppSelector(selectCurrentUser);
  const role = user?.role;
  const { data } = useBranches();
  const branches = data?.data || [];
  const canSeeAll = allowAll && can.manage(role);
  const home = branches.find((b) => b._id === (user?.branch || data?.meta?.defaultBranchId));

  return (
    <label className="branch-switch" title="Branch">
      <Building2 size={15} />
      <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
        <option value="">{home ? `My branch · ${home.name}` : 'My branch'}</option>
        {canSeeAll && <option value="all">All branches</option>}
        {branches.map((b) => (
          <option key={b._id} value={b._id}>
            {b.name} ({b.code})
          </option>
        ))}
      </select>
    </label>
  );
}

export default BranchSwitcher;
