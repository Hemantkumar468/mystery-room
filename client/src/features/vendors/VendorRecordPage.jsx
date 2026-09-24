import { useNavigate, useParams, Link } from 'react-router-dom';
import { Handshake, ChevronLeft, Star, FileText, Pencil } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, CityChip, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useGetVendorDetailQuery } from '../../app/api/vendorsApi.js';
import { fmtRupeesFull } from '../../lib/format.js';
import { STATUS_TONE } from './vendorSchema.js';
import { getStagePath } from '../projects/stagesConfig.jsx';

/**
 * Screen 3 — everything about this vendor on this project.
 *
 * The layout follows the split the server draws: the FIRM on the left
 * (contacts, GST, PAN — identical wherever you open them from) and THIS
 * ENGAGEMENT on the right (quoted, PO, terms — this project's own). Reading
 * down one column tells you about a company; reading down the other tells you
 * about a deal, and mixing them is what made the old single table unreadable.
 *
 * A missing value shows its label and an em dash rather than disappearing. A
 * blank GST is information: it tells a finance user this vendor cannot raise a
 * tax invoice yet. Hiding the row hides the problem.
 */

/** Label + value. Never hidden when empty — see the note above. */
function Field({ label, children }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="vend-field">
      <dt>{label}</dt>
      <dd className={empty ? 'muted' : undefined}>{empty ? '—' : children}</dd>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <section className="vend-group">
      <h3 className="vend-group-title">{title}</h3>
      <dl className="vend-group-body">{children}</dl>
    </section>
  );
}

export default function VendorRecordPage() {
  const { projectId, vendorId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGetVendorDetailQuery({ projectId, vendorId });

  if (isLoading) {
    return (
      <>
        <Topbar title="Vendor" />
        <div className="content"><SkTable /></div>
      </>
    );
  }

  if (isError || !data) {
    return (
      <>
        <Topbar title="Vendor" />
        <div className="content">
          <EmptyState
            icon={Handshake}
            title="Couldn’t load this vendor"
            hint="It may have been removed from this project."
            action={(
              <button type="button" className="btn btn-subtle" onClick={() => navigate(`/vendors/project/${projectId}`)}>
                Back to the project
              </button>
            )}
          />
        </div>
      </>
    );
  }

  const { project, vendor, link, alsoOn, documents, performance } = data;
  const tone = STATUS_TONE[link.status] || {};

  return (
    <>
      <Topbar title={vendor.vendor_name || 'Vendor'} />

      <div className="content col gap-3">
        <div className="col gap-1">
          <button
            type="button"
            className="vend-back"
            onClick={() => navigate(`/vendors/project/${projectId}`)}
          >
            <ChevronLeft size={13} /> {project.name || 'Project'}
          </button>
          <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
            <h2 className="vend-drill-title">{vendor.vendor_name || '—'}</h2>
            {vendor.category && <Badge soft="var(--surface-2)">{vendor.category}</Badge>}
            {link.status && (
              <Badge color={tone.color} soft={tone.soft || 'var(--surface-2)'}>{link.status}</Badge>
            )}
            {project.city && <CityChip city={project.city} />}
          </div>
        </div>

        <div className="vend-record-grid">
          <div className="col gap-3">
            <Group title="Contact">
              <Field label="Contact person">{vendor.contact_person}</Field>
              <Field label="Phone">
                {vendor.contact_phone
                  ? <a href={`tel:${vendor.contact_phone}`}>{vendor.contact_phone}</a>
                  : null}
              </Field>
              <Field label="Email">
                {vendor.email ? <a href={`mailto:${vendor.email}`}>{vendor.email}</a> : null}
              </Field>
              <Field label="Address">{vendor.address}</Field>
            </Group>

            <Group title="Statutory">
              <Field label="GST number">{vendor.gst}</Field>
              <Field label="PAN">{vendor.pan}</Field>
              <Field label="Bank details">{vendor.bank_details}</Field>
            </Group>
          </div>

          <div className="col gap-3">
            <Group title="Commercials">
              <Field label="Quoted">{fmtRupeesFull(link.quoted_amount)}</Field>
              <Field label="Negotiated / PO">{fmtRupeesFull(link.negotiated_amount)}</Field>
              <Field label="Payment terms">{link.payment_terms}</Field>
              <Field label="Credit period">
                {link.credit_period_days ? `${link.credit_period_days} days` : null}
              </Field>
            </Group>

            <Group title="Performance">
              <Field label="Rating">
                {vendor.rating ? (
                  <span className="row gap-1" style={{ alignItems: 'center' }}>
                    <Star size={12} fill="currentColor" style={{ color: 'var(--warning)' }} />
                    {vendor.rating} / 10
                  </span>
                ) : null}
              </Field>
              {/* No task in the model points at a vendor, so this cannot be
                  computed — an em dash rather than an invented "4 of 5". */}
              <Field label="Tasks on time">
                {performance.tasksTotal
                  ? `${performance.tasksOnTime} of ${performance.tasksTotal}`
                  : null}
              </Field>
              <Field label="Past performance">{vendor.past_performance}</Field>
            </Group>
          </div>
        </div>

        <div className="vend-work">
          <h3 className="vend-group-title">Work assigned on this project</h3>
          {link.work_scope || link.linked_task_code ? (
            <>
              <div className="vend-work-scope">{link.work_scope || 'Scope not recorded'}</div>
              <div className="tiny muted">
                {link.linked_task_code ? (
                  <Link to={`/projects/${projectId}/tasks/${link.linked_task_code}`}>
                    {link.linked_task_code}
                  </Link>
                ) : 'No task linked'}
                {project.name ? ` · ${project.name}` : ''}
              </div>
            </>
          ) : (
            <p className="tiny muted" style={{ margin: 0 }}>
              Nothing recorded yet. Add “Work to be done” and a task code on the vendor’s
              Phase 4B form to fill this in.
            </p>
          )}
        </div>

        {/* Where else this same firm is engaged. Matched on GST, then phone,
            then name — so the page never implies this project is the whole
            relationship. */}
        {alsoOn.length > 0 && (
          <div className="vend-work">
            <h3 className="vend-group-title">Also engaged on</h3>
            <div className="row gap-2 wrap">
              {alsoOn.map((o) => (
                <Link
                  key={o.vendorId}
                  to={`/vendors/project/${o.projectId}/vendor/${o.vendorId}`}
                  className="btn btn-subtle btn-sm"
                >
                  {o.city ? `${o.city} · ` : ''}{o.projectName}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="vend-work">
          <h3 className="vend-group-title">Documents</h3>
          {documents.length === 0 ? (
            <p className="tiny muted" style={{ margin: 0 }}>Nothing uploaded for this project.</p>
          ) : (
            <div className="row gap-2 wrap">
              {documents.map((d) => (
                <a
                  key={d.id}
                  href={d.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-subtle btn-sm"
                >
                  <FileText size={13} /> {d.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="row gap-2">
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            onClick={() => navigate(getStagePath(projectId, 'p12'))}
          >
            <Pencil size={13} /> Edit on the Phase 4B form
          </button>
        </div>
      </div>
    </>
  );
}
