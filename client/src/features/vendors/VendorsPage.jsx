import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Handshake, Plus, ChevronRight } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { CityChip, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useGetVendorProjectsQuery } from '../../app/api/vendorsApi.js';
import { VendorsAllTable } from './VendorsAllTable.jsx';
import { AddVendorFlow } from './AddVendorFlow.jsx';

/**
 * Screen 1 of the vendor drill-down: your live projects, each with a city and
 * a vendor count.
 *
 * Why this replaced a flat table. The table listed every vendor across every
 * project with the project as one column among seven, so the first question
 * anyone actually has — "who is working on Bhopal?" — took a filter to answer,
 * and the city was nowhere at all. Leading with the project makes the shape of
 * the work visible before any of the detail.
 *
 * The flat table survives as the second tab, and deliberately: it answers the
 * one question the drill-down structurally cannot, "which project is this GST
 * number on?", because there you must pick a project before you can search.
 * The spec keeps the same escape hatch on Approvals for the same reason.
 */

const TABS = [
  { key: 'projects', label: 'By project' },
  { key: 'all', label: 'All vendors' },
];

export default function VendorsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('projects');
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useGetVendorProjectsQuery();
  const projects = data || [];

  return (
    <>
      <Topbar
        title="Vendors"
        actions={(
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add Vendor
          </button>
        )}
      />

      <div className="content col gap-3">
        <div className="apr-filters">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`proj-chip${tab === t.key ? ' active' : ''}`}
              style={{ '--chip-accent': '#6366F1' }}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === 'projects' && <span className="proj-chip-count">{projects.length}</span>}
            </button>
          ))}
        </div>

        {tab === 'all' ? <VendorsAllTable /> : (
          <>
            <p className="pva-intro">
              Projects with work in progress. Open one to see its vendors, then open a
              vendor for the full record.
            </p>

            {isLoading ? <SkTable /> : projects.length === 0 ? (
              <EmptyState
                icon={Handshake}
                title="No active projects yet"
                hint="Vendors are engaged for a project, so a project comes first."
                action={(
                  <button type="button" className="btn btn-subtle" onClick={() => navigate('/projects')}>
                    Go to Projects
                  </button>
                )}
              />
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="vend-drill-row"
                    onClick={() => navigate(`/vendors/project/${p.id}`)}
                  >
                    <div className="col" style={{ gap: 4, alignItems: 'flex-start', minWidth: 0 }}>
                      <span className="vend-drill-name">{p.name}</span>
                      <div className="row gap-2" style={{ alignItems: 'center' }}>
                        {p.city
                          ? <CityChip city={p.city} />
                          : <span className="tiny muted">No city set</span>}
                        {/* A project outside the live statuses is still listed so its
                            vendor history stays reachable — but it says so. */}
                        {!p.isLive && <span className="tiny muted">· {String(p.status).replace(/_/g, ' ')}</span>}
                      </div>
                    </div>
                    <span className="vend-drill-count">
                      {p.vendorCount} vendor{p.vendorCount === 1 ? '' : 's'}
                    </span>
                    <ChevronRight size={16} className="subtle" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <AddVendorFlow open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
