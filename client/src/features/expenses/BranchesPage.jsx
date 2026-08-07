import { useEffect, useState } from 'react';
import {
  Building2, Store, Warehouse, MapPin, Plus, Search,
  ChevronLeft, ChevronRight, Pencil,
} from 'lucide-react';
import { ModulePageShell } from '../../components/layout/ModulePageShell.jsx';
import { PermissionGate } from '../../components/permissions/PermissionGate.jsx';
import { EmptyState, ErrorState, MasterDataStatusBadge } from '../../components/ui/primitives.jsx';
import { SkeletonTable } from '../../components/ui/Skeletons.jsx';
import { useCurrentRouteMeta, useBreadcrumbTrail } from '../../lib/moduleRoutes.jsx';
import { useBranches, useBranchSummary } from '../../app/api/branchesApi.js';
import { emsRoutesConfig } from './config/ems.routes.config.js';
import { BranchFormModal } from './components/BranchFormModal.jsx';
import { CAN_MANAGE } from '../../lib/roles.js';

/* Same fix as ems.routes.config.js: 'admin' is not a role, so this locked the
   MD out of the branch master-data actions. */
const ADMIN_MANAGER = { allowed: CAN_MANAGE };
const KIND_ICON = { store: Store, hq: Building2, warehouse: Warehouse, other: Building2 };
const KIND_LABEL = { store: 'Store', hq: 'HQ', warehouse: 'Warehouse', other: 'Other' };

/** Debounces a fast-changing value (search/city text input) so the API isn't
 * called on every keystroke — no new dependency, just a small timer. */
function useDebounced(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function BranchesPage() {
  const route = useCurrentRouteMeta(emsRoutesConfig);
  const trail = useBreadcrumbTrail(emsRoutesConfig);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const debouncedSearch = useDebounced(search);
  const debouncedCity = useDebounced(city);

  const filtersActive = Boolean(debouncedSearch || debouncedCity || status || kind);
  const params = { page, limit: 20, search: debouncedSearch, city: debouncedCity, status, kind };

  const { data: result, isLoading, isFetching, isError, error, refetch } = useBranches(params);
  const { data: summary } = useBranchSummary();
  const items = result?.data || [];
  const meta = result?.meta;

  // Any filter change resets to page 1 — otherwise a narrowed result set can
  // land you on a page that no longer exists.
  useEffect(() => { setPage(1); }, [debouncedSearch, debouncedCity, status, kind]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const openCreate = () => { setEditingBranch(null); setModalOpen(true); };
  const openEdit = (branch) => { setEditingBranch(branch); setModalOpen(true); };

  const kpis = summary ? [
    { key: 'total', label: 'Total Branches', value: summary.total, icon: Building2, color: '#4F46E5', soft: '#EEF2FF' },
    { key: 'active', label: 'Active', value: summary.active, icon: Building2, color: '#059669', soft: '#DCFCE7' },
    { key: 'inactive', label: 'Inactive', value: summary.inactive, icon: Building2, color: '#6B7280', soft: '#F3F4F6' },
    { key: 'stores', label: 'Stores', value: summary.byKind.store, icon: Store, color: '#D97706', soft: '#FEF3C7' },
  ] : undefined;

  return (
    <ModulePageShell
      title={route?.title}
      subtitle={route?.description}
      breadcrumbTrail={trail}
      kpis={kpis}
      actions={(
        <PermissionGate requirement={ADMIN_MANAGER}>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> New Branch
          </button>
        </PermissionGate>
      )}
      filters={(
        <>
          <div className="row gap-2" style={{ alignItems: 'center', flex: 1, minWidth: 200 }}>
            <Search size={14} className="muted" />
            <input
              className="input"
              placeholder="Search by name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="row gap-2" style={{ alignItems: 'center', minWidth: 160 }}>
            <MapPin size={14} className="muted" />
            <input className="input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} style={{ maxWidth: 140 }}>
            <option value="">All kinds</option>
            <option value="store">Store</option>
            <option value="hq">HQ</option>
            <option value="warehouse">Warehouse</option>
            <option value="other">Other</option>
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 140 }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </>
      )}
    >
      {isLoading ? (
        <SkeletonTable columns={['24%', '14%', '12%', '14%', '20%', '10%', '6%']} rows={6} />
      ) : isError ? (
        <ErrorState
          title="Couldn't load branches"
          hint={error?.response?.data?.message || error?.message || 'Please try again.'}
          onRetry={refetch}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={filtersActive ? 'No branches match your filters' : 'No branches yet'}
          hint={filtersActive ? 'Try clearing search or filters.' : 'Create the first branch to start attributing expenses to it.'}
          action={!filtersActive && (
            <PermissionGate requirement={ADMIN_MANAGER}>
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> New Branch
              </button>
            </PermissionGate>
          )}
        />
      ) : (
        <div className="col gap-3">
          <div className="table-wrap" style={{ opacity: isFetching ? 0.6 : 1, transition: 'opacity 0.15s ease' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Kind</th>
                  <th>City</th>
                  <th>Manager</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((b) => {
                  const KindIcon = KIND_ICON[b.kind] || Building2;
                  return (
                    <tr key={b._id}>
                      <td>
                        <div className="row gap-2" style={{ alignItems: 'center' }}>
                          <KindIcon size={15} className="muted" />
                          <span style={{ fontWeight: 600 }}>{b.name}</span>
                        </div>
                      </td>
                      <td className="muted">{b.code}</td>
                      <td>{KIND_LABEL[b.kind] || b.kind}</td>
                      <td>{b.city || '—'}</td>
                      <td>{b.manager?.name || '—'}</td>
                      <td><MasterDataStatusBadge value={b.status} /></td>
                      <td>
                        <PermissionGate requirement={ADMIN_MANAGER}>
                          <button type="button" className="btn btn-ghost btn-icon" onClick={() => openEdit(b)} aria-label={`Edit ${b.name}`}>
                            <Pencil size={14} />
                          </button>
                        </PermissionGate>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
              <span className="sm muted">
                Page {meta.page} of {meta.totalPages} · {meta.total} total
              </span>
              <button type="button" className="btn btn-ghost btn-icon" disabled={!meta.hasPrevPage} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft size={16} />
              </button>
              <button type="button" className="btn btn-ghost btn-icon" disabled={!meta.hasNextPage} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      <BranchFormModal open={modalOpen} onClose={() => setModalOpen(false)} branch={editingBranch} />
    </ModulePageShell>
  );
}

export default BranchesPage;
