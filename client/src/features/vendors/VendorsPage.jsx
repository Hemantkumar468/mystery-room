import { useMemo, useState } from 'react';
import { Handshake, Search, Plus, Star, X } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import {
  useGetAllVendorsQuery, useCreateRecord, useUpdateRecord,
} from '../../app/api/recordsApi.js';
import { useProjects } from '../../app/api/projectsApi.js';
import { useTemplates } from '../../app/api/templatesApi.js';
import { fromNow } from '../../lib/format.js';

/**
 * Vendors — the vendor MASTER. Every vendor recorded in any project's Phase 4B,
 * on one page: filter, open the full record, and onboard new vendors from here
 * rather than digging into a project first.
 *
 * The data model stays what it is — a vendor is a p12 record belonging to a
 * project — so adding one asks which project it belongs to. That is honest to
 * how vendors are engaged today (per project, per quotation); a project-less
 * global vendor collection is a schema change for another day, and this page's
 * URL and UI won't need to change when it comes.
 */

const STATUS_TONE = {
  Identified: { soft: 'var(--surface-2)' },
  'Quotation Received': { color: 'var(--primary)', soft: 'var(--primary-soft, var(--surface-2))' },
  'Under Comparison': { color: 'var(--warning)', soft: 'var(--warning-soft)' },
  Finalised: { color: 'var(--success)', soft: 'var(--success-soft)' },
  Rejected: { color: 'var(--danger)', soft: 'var(--danger-soft, #FEE2E2)' },
  Blacklisted: { color: '#fff', soft: 'var(--danger)' },
};

export default function VendorsPage() {
  const { data, isLoading } = useGetAllVendorsQuery();
  const vendors = useMemo(() => data || [], [data]);

  /* The p12 form definition, from the published client-flow template — the
     same schema every project's Phase 4B uses, so the master and the phases
     can never disagree about what a vendor is. */
  const { data: tplResp } = useTemplates({ status: 'published', limit: 50 });
  const templates = tplResp?.data || tplResp || [];
  const schema = useMemo(() => {
    for (const t of templates) {
      const stage = (t.stages || []).find((s) => s.key === 'p12');
      if (stage?.masterDataSchema?.length) return stage.masterDataSchema;
    }
    return [];
  }, [templates]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');

  const categories = useMemo(
    () => [...new Set(vendors.map((r) => r.values?.category).filter(Boolean))].sort(),
    [vendors],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((r) => {
      const v = r.values || {};
      if (category && v.category !== category) return false;
      if (status && v.status !== status) return false;
      if (q && ![v.vendor_name, v.contact_person, v.contact_phone, v.email, v.gst]
        .some((s) => String(s || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [vendors, search, category, status]);

  /* View/edit an existing vendor — in the project it belongs to. */
  const [openRec, setOpenRec] = useState(null); // { record, mode: 'view' | 'edit' }
  const updateRecord = useUpdateRecord(openRec?.record?.project?._id || openRec?.record?.project, 'p12');

  /* Onboard a new vendor: pick the project it is being engaged for, then the
     same Phase 4B form. */
  const [adding, setAdding] = useState(false);
  const [addProject, setAddProject] = useState('');
  const { data: projResp } = useProjects({ limit: 100 });
  const projects = projResp?.data || projResp || [];
  const createRecord = useCreateRecord(addProject, 'p12');

  const clearFilters = () => { setSearch(''); setCategory(''); setStatus(''); };
  const filtered = Boolean(search || category || status);

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
        <p className="pva-intro">
          Every vendor across every project — onboard new ones here, and open any row for
          the full record: contacts, statutory details, commercials and performance.
        </p>

        <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
          <div className="proj-search" style={{ maxWidth: 320 }}>
            <Search size={15} />
            <input
              style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'var(--text)' }}
              placeholder="Search name, contact, phone, GST…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              <X size={13} /> Clear
            </button>
          )}
          <span className="tiny muted" style={{ marginLeft: 'auto' }}>
            {visible.length} of {vendors.length} vendor{vendors.length === 1 ? '' : 's'}
          </span>
        </div>

        {isLoading ? <SkTable /> : visible.length === 0 ? (
          <EmptyState
            icon={Handshake}
            title={filtered ? 'No vendors match these filters' : 'No vendors yet'}
            hint={filtered ? 'Try clearing a filter.' : 'Use “Add Vendor” to onboard the first one.'}
          />
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="pi-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Contact</th>
                    <th>Rating</th>
                    <th>Status</th>
                    <th>Project</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const v = r.values || {};
                    const tone = STATUS_TONE[v.status] || {};
                    return (
                      <tr key={r._id} style={{ cursor: 'pointer' }} onClick={() => setOpenRec({ record: r, mode: 'view' })}>
                        <td style={{ fontWeight: 600 }}>{v.vendor_name || '—'}</td>
                        <td>{v.category || '—'}</td>
                        <td>
                          {v.contact_person || '—'}
                          {v.contact_phone && <span className="muted"> · {v.contact_phone}</span>}
                        </td>
                        <td>
                          {v.rating
                            ? <span className="row gap-1" style={{ alignItems: 'center' }}><Star size={12} fill="currentColor" style={{ color: 'var(--warning)' }} /> {v.rating}/10</span>
                            : '—'}
                        </td>
                        <td><Badge color={tone.color} soft={tone.soft || 'var(--surface-2)'}>{v.status || '—'}</Badge></td>
                        <td className="muted">{r.project?.name || '—'}</td>
                        <td className="muted">{r.updatedAt ? fromNow(r.updatedAt) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Full record — same form the phase uses, so nothing can drift. */}
      {openRec && schema.length > 0 && (
        <RecordFormModal
          open
          onClose={() => setOpenRec(null)}
          schema={schema}
          recordNoun="Vendor"
          readOnly={openRec.mode === 'view'}
          initialValues={openRec.record.values}
          projectId={openRec.record.project?._id || openRec.record.project}
          onEdit={openRec.mode === 'view' ? () => setOpenRec({ ...openRec, mode: 'edit' }) : null}
          saving={updateRecord.isPending}
          onSaveDraft={async ({ values }) => {
            await updateRecord.mutateAsync({ id: openRec.record._id, values });
            setOpenRec(null);
          }}
          onSubmit={async ({ values }) => {
            await updateRecord.mutateAsync({ id: openRec.record._id, values, status: 'submitted' });
            setOpenRec(null);
          }}
        />
      )}

      {/* Onboarding: which project engages this vendor, then the standard form. */}
      {adding && !addProject && (
        <div className="overlay" onMouseDown={() => setAdding(false)}>
          <div className="modal fade-in" style={{ maxWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="card-head modal-header">
              <div className="section-title">Which project is this vendor for?</div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setAdding(false)} aria-label="Close"><X size={15} /></button>
            </div>
            <div className="modal-body col gap-2" style={{ padding: 16 }}>
              <p className="sm muted" style={{ margin: 0 }}>
                A vendor is engaged for a project — pick it, then fill their details once.
                They appear here and in that project&rsquo;s Phase 4B.
              </p>
              {projects.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  className="btn btn-subtle"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => setAddProject(p._id)}
                >
                  {p.name} <span className="muted">· {p.code}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {adding && addProject && schema.length > 0 && (
        <RecordFormModal
          open
          onClose={() => { setAdding(false); setAddProject(''); }}
          schema={schema}
          recordNoun="Vendor"
          projectId={addProject}
          saving={createRecord.isPending}
          onSaveDraft={async ({ values }) => {
            await createRecord.mutateAsync({ values, status: 'draft' });
            setAdding(false); setAddProject('');
          }}
          onSubmit={async ({ values }) => {
            await createRecord.mutateAsync({ values, status: 'submitted' });
            setAdding(false); setAddProject('');
          }}
        />
      )}
    </>
  );
}
