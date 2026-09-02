import { useMemo, useState } from 'react';
import { X, Search, Building2 } from 'lucide-react';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import { useCreateRecord, useGetAllVendorsQuery } from '../../app/api/recordsApi.js';
import { useProjects } from '../../app/api/projectsApi.js';
import { useVendorSchema, FIRM_FIELDS } from './vendorSchema.js';

/**
 * Onboarding a vendor, in at most three steps: which project, which firm, then
 * the standard Phase 4B form.
 *
 * `projectId` skips the first step. Opened from inside a project's vendor list
 * the project is already known, so asking again is a question with one possible
 * answer — and, per the spec, it is then impossible to leave blank.
 *
 * The second step is the duplicate guard. A vendor engaged on a second project
 * is a second p12 record either way, but retyping the GST and phone is how the
 * two copies end up disagreeing. Picking the existing firm copies its
 * firm-level fields forward; the commercials stay empty, because those are
 * what differ per project.
 */
export function AddVendorFlow({ open, projectId: fixedProjectId, onClose, onCreated }) {
  const schema = useVendorSchema();
  const [pickedProject, setPickedProject] = useState('');
  const projectId = fixedProjectId || pickedProject;

  const [firmChosen, setFirmChosen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [firmSearch, setFirmSearch] = useState('');

  const { data: projResp } = useProjects({ limit: 100 });
  const projects = useMemo(() => projResp?.data || projResp || [], [projResp]);
  const { data: vendorData } = useGetAllVendorsQuery(undefined, { skip: !open });
  const existing = useMemo(() => vendorData || [], [vendorData]);

  const createRecord = useCreateRecord(projectId, 'p12');

  /* City → its launches, cities alphabetical, unplaced drafts last. Names like
     "demo" or "p13" are indistinguishable in a flat list; the city tells
     them apart. */
  const projectGroups = useMemo(() => {
    const groups = new Map();
    for (const p of projects) {
      const key = p.city || 'No city set';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return [...groups].sort((a, b) => {
      if (a[0] === 'No city set') return 1;
      if (b[0] === 'No city set') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [projects]);

  /**
   * One entry per distinct firm already on file, and where it is engaged.
   * Matched GST first, then phone, then name — the same ordering the server
   * uses in `firmKeyOf`, so the two never disagree about what one firm is.
   */
  const firms = useMemo(() => {
    const byKey = new Map();
    for (const r of existing) {
      const v = r.values || {};
      const gst = String(v.gst || '').trim().toUpperCase().replace(/\s/g, '');
      const phone = String(v.contact_phone || '').replace(/\D/g, '').slice(-10);
      const name = String(v.vendor_name || '').trim().toLowerCase();
      const key = gst ? `gst:${gst}` : phone.length === 10 ? `phone:${phone}` : name ? `name:${name}` : '';
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { key, values: v, projects: [] });
      const entry = byKey.get(key);
      if (r.project?.name) {
        entry.projects.push({ name: r.project.name, city: r.project.city || null });
      }
    }
    return [...byKey.values()].sort((a, b) => String(a.values.vendor_name || '')
      .localeCompare(String(b.values.vendor_name || '')));
  }, [existing]);

  const visibleFirms = useMemo(() => {
    const q = firmSearch.trim().toLowerCase();
    if (!q) return firms;
    return firms.filter((f) => [f.values.vendor_name, f.values.contact_phone, f.values.gst, f.values.category]
      .some((s) => String(s || '').toLowerCase().includes(q)));
  }, [firms, firmSearch]);

  const reset = () => {
    setPickedProject(''); setFirmChosen(false); setPrefill(null); setFirmSearch('');
  };
  const close = () => { reset(); onClose?.(); };

  if (!open) return null;

  /* Step 1 — which project. */
  if (!projectId) {
    return (
      <div className="overlay" onMouseDown={close}>
        <div className="modal fade-in" style={{ maxWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="card-head modal-header">
            <div className="section-title">Which project is this vendor for?</div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Close"><X size={15} /></button>
          </div>
          <div className="modal-body col gap-2" style={{ padding: 16 }}>
            <p className="sm muted" style={{ margin: 0 }}>
              A vendor is engaged for a project — pick it, then fill their details once.
              They appear here and in that project&rsquo;s Phase 4B.
            </p>
            {projectGroups.map(([groupCity, rows]) => (
              <div key={groupCity} className="col gap-1">
                <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                  {groupCity}
                </div>
                {rows.map((p) => (
                  <button
                    key={p._id}
                    type="button"
                    className="btn btn-subtle"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => setPickedProject(p._id)}
                  >
                    {p.name} <span className="muted">· {p.code}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* Step 2 — an existing firm, or a new one. Skipped when nothing is on file. */
  if (!firmChosen && firms.length > 0) {
    return (
      <div className="overlay" onMouseDown={close}>
        <div className="modal fade-in" style={{ maxWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="card-head modal-header">
            <div className="section-title">Have we worked with them before?</div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Close"><X size={15} /></button>
          </div>
          <div className="modal-body col gap-2" style={{ padding: 16 }}>
            <p className="sm muted" style={{ margin: 0 }}>
              Pick an existing firm to carry its contact and statutory details across.
              The commercials stay blank — those are this project&rsquo;s own.
            </p>

            <div className="proj-search">
              <Search size={15} />
              <input
                style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'var(--text)' }}
                placeholder="Search name, phone or GST…"
                value={firmSearch}
                onChange={(e) => setFirmSearch(e.target.value)}
              />
            </div>

            <div className="col gap-1" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {visibleFirms.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="btn btn-subtle"
                  style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 10px' }}
                  onClick={() => {
                    const seed = {};
                    for (const k of FIRM_FIELDS) {
                      if (f.values[k] !== undefined && f.values[k] !== '') seed[k] = f.values[k];
                    }
                    setPrefill(seed);
                    setFirmChosen(true);
                  }}
                >
                  <div className="col" style={{ alignItems: 'flex-start', gap: 2 }}>
                    <span style={{ fontWeight: 650 }}>{f.values.vendor_name || 'Unnamed'}</span>
                    <span className="tiny muted">
                      {[f.values.category, f.values.contact_phone].filter(Boolean).join(' · ')}
                      {f.projects.length > 0 && ` · already on ${f.projects.map((p) => p.city || p.name).join(', ')}`}
                    </span>
                  </div>
                </button>
              ))}
              {visibleFirms.length === 0 && (
                <p className="tiny muted" style={{ margin: '4px 2px' }}>No firm matches that.</p>
              )}
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ justifyContent: 'center' }}
              onClick={() => { setPrefill(null); setFirmChosen(true); }}
            >
              <Building2 size={14} /> This is a new vendor
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* Step 3 — the standard Phase 4B form. */
  if (!schema.length) return null;

  const finish = () => { reset(); onCreated?.(); onClose?.(); };

  return (
    <RecordFormModal
      open
      onClose={close}
      schema={schema}
      recordNoun="Vendor"
      projectId={projectId}
      initialValues={prefill || undefined}
      saving={createRecord.isPending}
      onSaveDraft={async ({ values }) => {
        await createRecord.mutateAsync({ values, status: 'draft' });
        finish();
      }}
      onSubmit={async ({ values }) => {
        await createRecord.mutateAsync({ values, status: 'submitted' });
        finish();
      }}
    />
  );
}

export default AddVendorFlow;
