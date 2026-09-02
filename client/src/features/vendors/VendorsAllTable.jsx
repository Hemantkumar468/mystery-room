import { useMemo, useState } from 'react';
import { Handshake, Search, Star, X } from 'lucide-react';
import { Badge, CityChip, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import {
  useGetAllVendorsQuery, useUpdateRecord,
} from '../../app/api/recordsApi.js';
import { fromNow } from '../../lib/format.js';
import { STATUS_TONE, useVendorSchema } from './vendorSchema.js';

/**
 * Every vendor across every project, in one flat table — the second tab of the
 * Vendors page.
 *
 * The drill-down (projects → vendors → record) is the default and answers
 * "who is working on Bhopal?". It cannot answer "which project is this GST
 * number on?", because you have to pick a project before you can search — so
 * this view stays, for the cross-project lookup the three screens structurally
 * cannot do. Same reason the spec keeps a flat "Everything" tab on Approvals.
 */


/* Where a vendor is engaged. A vendor record belongs to a project, and the
   project is the only thing that knows its city — so the city is read through
   the project rather than stored twice and allowed to drift. */
const cityOf = (r) => r.project?.city || '';
const projectIdOf = (r) => String(r.project?._id || r.project?.id || r.project || '');
const nameKey = (r) => String(r.values?.vendor_name || '').trim().toLowerCase();

export function VendorsAllTable() {
  const { data, isLoading } = useGetAllVendorsQuery();
  const vendors = useMemo(() => data || [], [data]);

  const schema = useVendorSchema();

  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');

  const categories = useMemo(
    () => [...new Set(vendors.map((r) => r.values?.category).filter(Boolean))].sort(),
    [vendors],
  );

  /* Built from the vendors actually on the page, not the full project master:
     a filter that can only ever return nothing is worse than no filter. */
  const cities = useMemo(
    () => [...new Set(vendors.map(cityOf).filter(Boolean))].sort(),
    [vendors],
  );

  const projectOptions = useMemo(() => {
    const byId = new Map();
    for (const r of vendors) {
      const id = projectIdOf(r);
      if (!id || byId.has(id)) continue;
      byId.set(id, { name: r.project?.name || r.project?.code || 'Untitled', city: cityOf(r) });
    }
    return [...byId].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [vendors]);

  /* The "Noida +2" case. A vendor record is per-project, so the same firm
     engaged in three cities is three records — and the row would otherwise
     imply they only work in one. Keyed on the vendor's name, which is the only
     identity the schema gives us; GST would be stronger but is not always filled. */
  const citiesByVendor = useMemo(() => {
    const map = new Map();
    for (const r of vendors) {
      const key = nameKey(r);
      const c = cityOf(r);
      if (!key || !c) continue;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(c);
    }
    return map;
  }, [vendors]);

  /* Picking a city narrows the project list to that city's launches — and
     clears a project already chosen elsewhere, which would otherwise leave the
     table empty with two filters that look individually reasonable. */
  const visibleProjectOptions = useMemo(
    () => (city ? projectOptions.filter(([, p]) => p.city === city) : projectOptions),
    [projectOptions, city],
  );

  const pickCity = (next) => {
    setCity(next);
    if (next && project) {
      const stillValid = projectOptions.some(([id, p]) => id === project && p.city === next);
      if (!stillValid) setProject('');
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((r) => {
      const v = r.values || {};
      if (city && cityOf(r) !== city) return false;
      if (project && projectIdOf(r) !== project) return false;
      if (category && v.category !== category) return false;
      if (status && v.status !== status) return false;
      // Search covers where as well as who — typing "noida" should find the
      // vendors working there, which was impossible before.
      if (q && ![v.vendor_name, v.contact_person, v.contact_phone, v.email, v.gst,
        cityOf(r), r.project?.name, r.project?.code]
        .some((s) => String(s || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [vendors, search, city, project, category, status]);

  /* View/edit an existing vendor — in the project it belongs to. */
  const [openRec, setOpenRec] = useState(null); // { record, mode: 'view' | 'edit' }
  const updateRecord = useUpdateRecord(openRec?.record?.project?._id || openRec?.record?.project, 'p12');


  const clearFilters = () => {
    setSearch(''); setCity(''); setProject(''); setCategory(''); setStatus('');
  };
  const filtered = Boolean(search || city || project || category || status);

  return (
    <>
      <div className="col gap-3">
        <p className="pva-intro">
          Every vendor across every project — who they are, which city and which launch
          they are engaged for. Onboard new ones here, and open any row for the full
          record: contacts, statutory details, commercials and performance.
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
          <select className="select" style={{ width: 'auto' }} value={city} onChange={(e) => pickCity(e.target.value)} aria-label="Filter by city">
            <option value="">All cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
            <option value="">All projects</option>
            {visibleProjectOptions.map(([id, p]) => (
              <option key={id} value={id}>{p.city ? `${p.name} · ${p.city}` : p.name}</option>
            ))}
          </select>
          <select className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
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
                    <th>City</th>
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
                    const rowCity = cityOf(r);
                    // Every other city this same vendor is engaged in — see
                    // citiesByVendor above for why one row can understate it.
                    const otherCities = [...(citiesByVendor.get(nameKey(r)) || [])]
                      .filter((c) => c !== rowCity)
                      .sort();
                    return (
                      <tr key={r._id} style={{ cursor: 'pointer' }} onClick={() => setOpenRec({ record: r, mode: 'view' })}>
                        <td style={{ fontWeight: 600 }}>{v.vendor_name || '—'}</td>
                        <td className="vend-city-cell">
                          {rowCity
                            ? <CityChip city={rowCity} extra={otherCities.length} others={otherCities} />
                            : <span className="muted">—</span>}
                        </td>
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
                        <td className="muted">
                          {r.project?.name || '—'}
                          {r.project?.code && <div className="proj-code">{r.project.code}</div>}
                        </td>
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

    </>
  );
}

export default VendorsAllTable;
