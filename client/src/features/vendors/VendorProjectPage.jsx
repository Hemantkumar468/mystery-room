import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Handshake, Plus, ChevronRight, ChevronLeft } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { CityChip, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useGetProjectVendorsQuery } from '../../app/api/vendorsApi.js';
import { AddVendorFlow } from './AddVendorFlow.jsx';

/**
 * Screen 2 — this project's vendors. Name and trade, nothing else.
 *
 * This is a menu, not a report. The temptation is to add phone, status and
 * rating here "while we are showing a list anyway", and the cost is that the
 * screen stops being scannable: the whole point of the middle level is that
 * your eye finds the right vendor in one pass and clicks through. Everything
 * else is one click away on screen 3, which has room to lay it out properly.
 */
export default function VendorProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError } = useGetProjectVendorsQuery(projectId);

  const project = data?.project;
  const vendors = data?.vendors || [];

  return (
    <>
      <Topbar
        title={project?.name || 'Vendors'}
        actions={(
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add Vendor
          </button>
        )}
      />

      <div className="content col gap-3">
        <div className="col gap-1">
          <button type="button" className="vend-back" onClick={() => navigate('/vendors')}>
            <ChevronLeft size={13} /> All projects
          </button>
          <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
            <h2 className="vend-drill-title">{project?.name || '—'}</h2>
            {project?.city && <CityChip city={project.city} />}
            {project?.code && <span className="proj-code">{project.code}</span>}
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>
              {vendors.length} vendor{vendors.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {isLoading ? <SkTable /> : isError ? (
          <EmptyState
            icon={Handshake}
            title="Couldn’t load this project’s vendors"
            hint="The vendors service didn’t respond."
          />
        ) : vendors.length === 0 ? (
          <EmptyState
            icon={Handshake}
            title="No vendors on this project yet"
            hint="Add the first one — the project is already filled in."
            action={(
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus size={14} /> Add Vendor
              </button>
            )}
          />
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {vendors.map((v) => (
              <button
                key={v.linkId}
                type="button"
                className="vend-drill-row"
                onClick={() => navigate(`/vendors/project/${projectId}/vendor/${v.vendorId}`)}
              >
                <div className="col" style={{ gap: 2, alignItems: 'flex-start', minWidth: 0 }}>
                  <span className="vend-drill-name">{v.name}</span>
                  <span className="tiny muted">{v.category || '—'}</span>
                </div>
                <ChevronRight size={16} className="subtle" style={{ marginLeft: 'auto' }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The project is fixed, so it is pre-filled and cannot be left blank. */}
      <AddVendorFlow open={adding} projectId={projectId} onClose={() => setAdding(false)} />
    </>
  );
}
