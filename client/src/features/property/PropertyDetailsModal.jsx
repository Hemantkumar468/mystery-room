import { useRef, useState } from 'react';
import { MapPin, Paperclip, PenLine } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { FormSheetFrame } from '../../components/ui/FormSheetFrame.jsx';
import { PropertyReportSheet, SectionHeader, InfoGrid, InfoCell } from '../projects/PropertyReportSheet.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useRecord, useStageRecords } from '../../app/api/recordsApi.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { getEmployeeById } from '../../lib/employees.js';
import { LayoutPlanner } from '../projects/records/LayoutPlanner.jsx';
import { fmtDate, fmtNumber, fmtCurrency, fmtFileSize } from '../../lib/format.js';
import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { FIELD_GROUPS, labelOfField, formatFieldValue } from './assessmentFields.js';
import { rowStatus } from './PropertyWhyStatusModal.jsx';
import { documentStatus, closureStatus } from './DocumentCell.jsx';
import { PersonName } from './propertyUi.jsx';
import { useCaptureLabels } from './captureLabels.js';
import { displayMobile } from '../../lib/indianMobile.js';
import { exportNodeToPdf, pdfFileName } from './pdfExport.js';
import {
  DOCUMENT_TYPES, DOC_FIELD_GROUPS, DOC_FILE_FIELDS, NOC_TYPES,
  labelOfDocField, formatDocValue, instalmentPlan,
} from './documentFields.js';
import {
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
  scoreGradeFor,
} from '../projects/records/scoring.js';

/**
 * The Property Report, read over the queue — and printable as a PDF.
 *
 * WHY IT IS NOT A LINK TO THE PROJECT. "Open" used to navigate into Project
 * Management, which answered "show me this property" by replacing the page the
 * reader was working, losing their filters, their sort and their place in 46
 * rows. Nobody clicking it was asking to go anywhere. Where the data LIVES is
 * unchanged — the same p1 record on the same project — it is only read here.
 *
 * IT IS THE SAME REPORT PMS ALREADY PRODUCES, not a second design of one: the
 * sheet is `PropertyReportSheet`, the component the property page itself
 * renders, so status, audit, the template's own sections, the media table and
 * the notes are identical wherever the report is opened from.
 *
 * THREE THINGS ARE DIFFERENT HERE, all deliberate. The sheet is titled with
 * the PROPERTY's name rather than "Property Report", because this is opened on
 * one site out of forty-six and the first question is which one. The two
 * locations are stated at the top, because they are different questions that
 * both get called "location": the CITY is where we want to open, the LIVE
 * LOCATION is the pin on this particular shop in it.
 *
 * AND A STORE IS USUALLY MORE THAN ONE SHOP. Ten sites can be captured against
 * one store before it signs, and opening the report on whichever row was
 * clicked meant going back to the queue to read the next one. Where the store
 * has others, they are listed at the top: pick one, Apply, and the sheet — and
 * the PDF it prints — is that property's.
 */
const STAGE_CAPTURE = 'p1';

/**
 * Print the sheet, and only the sheet.
 *
 * It goes into a window of its own, carrying this app's stylesheets so it
 * looks the same on paper as on screen. The obvious approach — a print
 * stylesheet that blanks the rest of the page — printed an EMPTY sheet: the
 * report lives inside a dialog that is `overflow: hidden` and collapses to
 * zero height in print, and a clipped box cannot be un-clipped by making its
 * neighbours invisible. A separate window has no dialog to escape from, and
 * the browser's own print dialog is what saves it as a PDF.
 */
function printDoc(node, title) {
  if (!node) return;
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((el) => el.outerHTML)
    .join('');
  const win = window.open('', '_blank', 'width=960,height=1000');
  if (!win) return; // pop-up blocked — the dialog stays open, nothing is lost
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}`
    + '<style>body{margin:0;background:#fff}.no-print{display:none!important}</style></head><body>'
    + `${node.innerHTML}</body></html>`,
  );
  win.document.close();
  /**
   * Stylesheets are still loading when write() returns; printing into them
   * half-applied is how a report comes out unstyled.
   *
   * SO ARE THE IMAGES, and the form's letterhead is one of them. The fixed
   * 350ms wait was enough for CSS off the same cache and not for `/logo.png`
   * on a cold load, which printed the branded form with a gap where its logo
   * should be. Waiting on the images themselves is the only thing that is
   * true on both a warm and a cold cache; the timeout is the backstop, so a
   * logo that 404s can never leave somebody staring at a window that refuses
   * to print.
   */
  const go = () => { win.focus(); win.print(); };
  const ready = () => {
    const imgs = [...win.document.images].filter((i) => !i.complete);
    if (!imgs.length) { setTimeout(go, 120); return; }
    let left = imgs.length;
    const done = () => { left -= 1; if (left <= 0) setTimeout(go, 120); };
    imgs.forEach((i) => { i.addEventListener('load', done); i.addEventListener('error', done); });
    setTimeout(go, 2500);
  };
  if (win.document.readyState === 'complete') setTimeout(ready, 250);
  else win.addEventListener('load', () => setTimeout(ready, 250));
}

function LocationLine({ row }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 10 }}>
      {/* WHO AND WHEN, ON THE SITE ITSELF. */}
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">Assigned to</span>
        <span className="pr-value-text">
          {(row.capturePlan?.assignedNames || []).join(', ') || 'Unassigned'}
        </span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">Filed by</span>
        <span className="pr-value-text">{row.filedBy ? <PersonName name={row.filedBy} /> : 'Not yet'}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">Filed on</span>
        <span className="pr-value-text">
          {row.filedAt
            ? fmtDate(row.filedAt)
            : row.capturePlan?.planDate
              ? `Not yet — due ${fmtDate(row.capturePlan.planDate)}`
              : 'Not yet'}
        </span>
      </span>
    </div>
  );
}

/** The same four scorers the queue's columns use, so a report and the sheet it
 *  was opened from can never disagree about a number. */
const SCORERS = {
  feasibility: feasibilityPercent,
  financial: financialPercent,
  technical: technicalPercent,
  operational: operationalPercent,
};

/**
 * THE FOUR ASSESSMENTS, IN THE REPORT ABOUT THE PROPERTY THEY ASSESS.
 *
 * This report had nothing about them. It is opened from Step 3 and Step 4 -
 * the two screens whose entire subject is the assessments - and it answered
 * with the capture form and no mention of what anybody had found. The four
 * were readable only as four bands on a sheet 2,000px wide, a column at a
 * time, with no way to see one property's four together.
 *
 * EVERY ASSESSMENT THAT WAS ASKED FOR IS LISTED, including the ones nobody
 * has filed. "Technical has not come back" is the fact a reader deciding on
 * this site most needs, and a section that silently omitted it would read as a
 * site with two assessments rather than one with a gap.
 *
 * The ones that were NEVER asked for are not listed at all — see
 * `PropertyAssessments`. Printing them made every report four headings long
 * whatever the MD had chosen, which buried the gap this section exists to
 * show: four blocks, two of them "Not asked for", is a worse answer to "what
 * is outstanding here?" than two blocks, one of them empty.
 */
const SOURCE_KIND = {
  franchise: 'Franchise application',
  broker: 'Sent by a broker or agent',
  other: 'Sent in by someone who knows the site',
  demand: 'A store we are looking for a site for',
  captured: 'Captured by our own team',
};

/**
 * Maps a property's source to its formal sheet / form title.
 *
 * Matches the system's sources:
 * - Company Owned (internal site capture / demand)
 * - Franchisee (partner application)
 * - Broker (opportunity / referral)
 * - Other (public referral / someone else)
 */
export function formTitleForSource(source, fallback = 'Company Owned') {
  if (!source) return fallback;
  const s = String(source).toLowerCase().trim();
  if (['company', 'company_owned', 'company owned', 'demand', 'captured'].includes(s)) {
    return 'Company Owned';
  }
  if (['franchise', 'franchisee'].includes(s)) {
    return 'Franchisee';
  }
  if (['broker', 'referral'].includes(s)) {
    return 'Broker';
  }
  if (['other', 'someone_else', 'someone else'].includes(s)) {
    return 'Other';
  }
  return fallback;
}

export function getSourceTitle(site, record, row) {
  const raw = site?.source
    || site?.details?.source
    || site?.intakeSource
    || site?.intakeType
    || site?.sourceKey
    || site?.submission?.source
    || record?.source
    || record?.values?.source
    || record?.details?.source
    || record?.intakeSource
    || row?.source
    || row?.details?.source
    || '';
  if (raw) return formTitleForSource(raw);
  if (site?.capturePlan || site?.filedBy) return 'Company Owned';
  return 'Company Owned';
}

/**
 * WHO FILLED IT IN — stated on EACH property, not once at the top.
 *
 * The first version of this put one "Captured by our own team / Filled in by
 * System" band above everything, taken from whichever property came back
 * first. Bhopal holds five sites: three our team walked and two a franchise
 * applicant sent in, filed by three different people on three different days.
 * One line spoke for all five and was wrong about two of them, which is the
 * same mistake the queue's columns made before they were stacked per property.
 *
 * "Filled in by" is `filedBy` — the person who filled OUR form. The applicant
 * or agent who sent the site in is a different person and gets its own line
 * when there is one; the phone is a link because the reason to know who sent
 * it is usually that you are about to ring them.
 */
function FilledBy({ site }) {
  /* "System" is the server's stand-in for a record whose `createdBy` was never
     set - older rows, mostly. Printing "Sent in by System" names a person who
     does not exist; saying nothing is the truthful version. */
  const raw = site.submittedByName || site.submission?.by || null;
  const contact = raw && raw !== 'System' ? raw : null;
  const filed = site.filedBy || null;
  return (
    <span className="pd-who-facts">
      <span><b>Source</b>{SOURCE_KIND[site.source] || 'Property'}</span>
      <span><b>Filled in by</b>{filed || (site.recordId ? 'Not recorded' : 'Not filed yet')}</span>
      <span>
        <b>On</b>
        {site.filedAt ? fmtDate(site.filedAt) : site.createdAt ? fmtDate(site.createdAt) : 'Not recorded'}
      </span>
      {contact && contact !== filed && (
        <span>
          <b>Sent in by</b>
          {contact}
          {displayMobile(site.submittedByPhone) && (
            <a className="pd-who-tel" href={`tel:${displayMobile(site.submittedByPhone).replace(/\s/g, '')}`}>{displayMobile(site.submittedByPhone)}</a>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * What this report covers, in one line.
 *
 * Deliberately only the facts that are true of the WHOLE set — where, and how
 * many. Anything about who or when belongs to a property, and a group of five
 * has five answers.
 */
function ReportScope({ row, count, anyRecord }) {
  return (
    <div className="pd-who">
      <span className="pd-who-kind">
        {count === 1
          ? 'One property'
          : `${count} properties in ${row.city || 'this location'}`}
      </span>
      <span className="pd-who-note">
        {/* "Capture form" is the right word only where one has been filled in.
            On a site somebody sent us there is no form yet — what follows is
            what they sent, and calling that a capture form would have the
            reader looking for fields nobody was ever asked. */}
        {anyRecord
          ? 'Each one below is its own capture form, in the order the queue numbers them.'
          : 'What follows is what was sent in, in the order the queue numbers it.'}
      </span>
    </div>
  );
}

/** A row of facts, with the blanks left out rather than printed as dashes. */
function FactGrid({ title, facts }) {
  const shown = facts.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <div className="pd-sub-block">
      <h4 className="pd-sub-title">{title}</h4>
      <dl className="pd-sub-grid">
        {shown.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const FILE_KIND = {
  photo: 'Photo', video: 'Video', document: 'Document', audio: 'Voice note', link: 'Drive link',
};

/**
 * WHAT A SUBMITTED PROPERTY ACTUALLY CONTAINS.
 *
 * Details on one of these used to open a dialog that said, in a paragraph and
 * nothing else, that the property had not been filed as a Phase 1 record so
 * there was no report on it. That is true about the RECORD and useless to the
 * reader: this is Step 2, the whole job there is deciding whether to shortlist
 * the site, and the dialog withheld every fact the decision turns on — the
 * address, the floor, the area, what the sender said about it, the photos they
 * attached, their phone number — all of which the submission is carrying and
 * the server already sends down on the row.
 *
 * So Details shows what was sent. Anything the public form does not ask for is
 * absent rather than dashed: an empty "Monthly rent" line on a form that never
 * had a rent field reads as a missing answer instead of a question nobody was
 * asked. The one sentence about filing survives at the bottom, as the note it
 * always was — what happens next, not a reason to show nothing.
 */
function SubmissionReport({ site, total, statusInfo, row }) {
  /* Field names come from the form itself - see captureLabels.js. */
  const { labelOf } = useCaptureLabels();
  const live = site.details?.liveLocation;
  const lat = Number(live?.lat ?? live?.latitude);
  const lng = Number(live?.lng ?? live?.longitude);
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng);
  const files = site.media?.files || [];
  const d = site.details || {};
  const propName = site.title || site.locality || site.city || 'Property';
  const formTitle = getSourceTitle(site, null, row);

  return (
    <FormSheetFrame
      title={formTitle}
      aside={(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              color: '#1e3a8a',
              fontWeight: 800,
              fontSize: '11px',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              {labelOf('property_name', 'Property Name')}:
            </span>
            <span style={{
              color: '#0f172a',
              fontWeight: 650,
              fontSize: '13px',
              wordBreak: 'break-word',
            }}>
              {site.title || site.locality || 'Not submitted'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              color: '#1e3a8a',
              fontWeight: 800,
              fontSize: '11px',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              City:
            </span>
            <span style={{
              color: '#0f172a',
              fontWeight: 650,
              fontSize: '13px',
              wordBreak: 'break-word',
            }}>
              {site.city || 'Not submitted'}
            </span>
          </div>
        </div>
      )}
      reference={[
        { label: 'Date', value: fmtDate(site.createdAt || site.submittedAt) },
        {
          label: 'Status',
          value: (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {statusInfo?.label && (
                <span className={`pc2-status ${statusInfo.cls}`}>
                  {statusInfo.label}
                </span>
              )}
            </div>
          ),
        },
      ]}
      flat
    >
      <div className="pr-section">
        <SectionHeader title="Where it is" />
        <InfoGrid>
          <InfoCell label="City">
            <span className="pr-value-text">{site.city || 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('locality', 'Location')}>
            <span className="pr-value-text">{site.locality || 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('address', 'Full Address')}>
            <span className="pr-value-text">{site.address || 'Not submitted'}</span>
          </InfoCell>
          {hasPin ? (
            <InfoCell label={labelOf('live_location', 'Live Location')}>
              <a
                href={live.mapUrl || `https://www.google.com/maps?q=${lat},${lng}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
              >
                Open in Maps
              </a>
            </InfoCell>
          ) : (
            <InfoCell label={labelOf('live_location', 'Live Location')}>
              <span className="pr-empty-value">Not submitted</span>
            </InfoCell>
          )}
        </InfoGrid>
      </div>

      <div className="pr-section">
        <SectionHeader title="The site, as it was described" />
        <InfoGrid>
          <InfoCell label={labelOf('carpet_area', 'Carpet Area')}>
            <span className="pr-value-text">{site.areaSqft ? `${fmtNumber(site.areaSqft)} sq ft` : 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('floor', 'Floor')}>
            <span className="pr-value-text">{site.floor || 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label="Ownership">
            <span className="pr-value-text">{site.ownership || 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('frontage_ft', 'Frontage')}>
            <span className="pr-value-text">{d.frontageFt ? `${d.frontageFt} ft` : 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('commercial_type', 'Commercial Type')}>
            <span className="pr-value-text">{d.commercialType || 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('monthly_rent', 'Monthly Rent')}>
            <span className="pr-value-text">{d.monthlyRent ? fmtCurrency(d.monthlyRent) : 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('deposit', 'Deposit')}>
            <span className="pr-value-text">{d.deposit ? fmtCurrency(d.deposit) : 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('lease_amount', 'Lease Amount')}>
            <span className="pr-value-text">{d.leaseAmount ? fmtCurrency(d.leaseAmount) : 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('lease_duration', 'Term (months)')}>
            <span className="pr-value-text">{d.leaseDuration ? `${d.leaseDuration} months` : 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label={labelOf('available_from', 'Available From')}>
            <span className="pr-value-text">{d.availableFrom ? fmtDate(d.availableFrom) : 'Not submitted'}</span>
          </InfoCell>
        </InfoGrid>
      </div>

      <div className="pr-section">
        <SectionHeader title="Who sent it" />
        <InfoGrid>
          <InfoCell label="Name">
            <span className="pr-value-text">{site.submittedByName || 'Not submitted'}</span>
          </InfoCell>
          <InfoCell label="Phone">
            <span className="pr-value-text">
              {displayMobile(site.submittedByPhone) ? (
                <a
                  href={`tel:${displayMobile(site.submittedByPhone).replace(/\s/g, '')}`}
                  style={{ color: '#1d4ed8', fontWeight: 600 }}
                >
                  {displayMobile(site.submittedByPhone)}
                </a>
              ) : 'Not submitted'}
            </span>
          </InfoCell>
          <InfoCell label="Email">
            <span className="pr-value-text">
              {site.submittedByEmail ? (
                <a
                  href={`mailto:${site.submittedByEmail}`}
                  style={{ color: '#1d4ed8', fontWeight: 600 }}
                >
                  {site.submittedByEmail}
                </a>
              ) : 'Not submitted'}
            </span>
          </InfoCell>
          <InfoCell label="Sent On">
            <span className="pr-value-text">{site.createdAt ? fmtDate(site.createdAt) : 'Not submitted'}</span>
          </InfoCell>
          {site.submission?.total > 1 && (
            <InfoCell label="Part of">
              <span className="pr-value-text">
                {`site ${site.submission.index} of ${site.submission.total} in one submission`}
              </span>
            </InfoCell>
          )}
        </InfoGrid>
      </div>

      {site.remarks && (
        <div className="pr-section">
          <SectionHeader title="Notes" />
          <p style={{ fontSize: 13.5, fontWeight: 500, color: '#374151', lineHeight: 1.45, margin: '0 0 4px' }}>
            {site.remarks}
          </p>
        </div>
      )}

      {files.length > 0 && (
        <div className="pr-section">
          <SectionHeader title="Media" />
          <table className="pr-media-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, i) => (
                <tr key={`${f.url}-${i}`}>
                  <td>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
                    >
                      {f.name || f.url}
                    </a>
                  </td>
                  <td>{FILE_KIND[f.kind] || f.kind || 'File'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="pd-prop-none" style={{ marginTop: 18 }}>
        {site.blockedReason
          || (formTitle === 'Broker'
            ? 'Approve the broker submission first — that creates the project this property files into.'
            : formTitle === 'Other'
              ? 'Approve the submission first — that creates the project this property files into.'
              : formTitle === 'Company Owned'
                ? 'Capture or approve this property first — that creates the project this property files into.'
                : 'Approve the franchise enquiry first — that creates the project this property files into.')}
      </p>
    </FormSheetFrame>
  );
}

/**
 * ONE PROPERTY'S CAPTURE FORM, in full.
 *
 * Its own component because each property needs its own record fetched, and a
 * hook cannot be called in a loop from the parent. Rendering N of these is how
 * the report shows all of them.
 */
function OnePropertyReport({ site, index, total, schema, row, pick, pickKey, clickedKey = '', statusOverride = null }) {
  const propSheetRef = useRef(null);
  const { data: record, isLoading } = useRecord(site.recordId, { enabled: Boolean(site.recordId) });
  const statusInfo = statusOverride || rowStatus({
    ...site,
    ...(record ? {
      status: record.status || site.status,
      shortlistedBy: record.shortlistedBy || site.shortlistedBy,
      shortlistedAt: record.shortlistedAt || site.shortlistedAt,
      decision: (record.shortlistedAt || record.shortlistedBy)
        ? { state: 'shortlisted', ...(site.decision || {}) }
        : site.decision,
    } : {}),
  });

  const formTitle = getSourceTitle(site, record, row);
  const propName = site.title || record?.values?.property_name || record?.title || 'Property';


  return (
    <div
      className="pd-prop"
      ref={(el) => { propSheetRef.current = el; pick?.register(pickKey, el); }}
    >
      {/* Simple checkbox only when there are multiple forms (total > 1).
          If only one form (total === 1), no checkbox is rendered. */}
      {total > 1 && pick && (
        <label className="pd-pick no-print" title="Select to download">
          <input
            type="checkbox"
            checked={Boolean(pick.on(pickKey))}
            onChange={() => pick.toggle(pickKey)}
          />
        </label>
      )}
      {!site.recordId ? (
        <SubmissionReport
          site={site}
          total={total}
          statusInfo={statusInfo}
          row={row}
        />
      ) : isLoading ? (
        <p className="pd-prop-none">Loading this property’s form…</p>
      ) : (
        <PropertyReportSheet
          record={record}
          schema={schema}
          /* Audit (created/submitted/shortlisted/updated by) is left off this report:
             it sat above the property's own information. The media list gets tick
             boxes so the documents can be chosen and downloaded from the footer. */
          hideAudit
          module="property-capture"
          title={formTitle}
          heading={null}
          showStatus={false}
          reference={[
            { label: 'Date', value: fmtDate(record?.submittedAt || record?.createdAt) },
            {
              label: 'Status',
              value: (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {statusInfo?.label && (
                    <span className={`pc2-status ${statusInfo.cls}`}>
                      {statusInfo.label}
                    </span>
                  )}
                </div>
              ),
            },
          ]}
          aside={(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  color: '#1e3a8a',
                  fontWeight: 800,
                  fontSize: '11px',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  Property Name:
                </span>
                <span style={{
                  color: '#0f172a',
                  fontWeight: 650,
                  fontSize: '13px',
                  wordBreak: 'break-word',
                }}>
                  {site.title || record?.values?.property_name || record?.title || '—'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  color: '#1e3a8a',
                  fontWeight: 800,
                  fontSize: '11px',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  City:
                </span>
                <span style={{
                  color: '#0f172a',
                  fontWeight: 650,
                  fontSize: '13px',
                  wordBreak: 'break-word',
                }}>
                  {site.city || record?.values?.city || '—'}
                </span>
              </div>
            </div>
          )}
          headerExtra={<LocationLine row={site} />}
          style={{ background: '#fff', border: 0, maxWidth: 'none', margin: 0, padding: 0 }}
        />
      )}
    </div>
  );
}

/**
 * ONE ASSESSMENT, IN FULL AND ON ITS OWN.
 *
 * These were four cards in a grid, three across, each showing five lines:
 * purpose, who, when, files. A grid is for comparing, and nobody comparing
 * four different assessments of the SAME property - they are four different
 * questions, not four candidates. What it cost was everything the assessor
 * actually wrote: a feasibility form has a market potential, a footfall
 * score, an accessibility grade, a competitor analysis and a risk note, and
 * the card had room for none of them.
 *
 * So each one is a block of its own, full width, running down the page:
 * feasibility and all of its answers, then financial and all of its answers,
 * and so on. That is also what prints - one PDF with the property and every
 * assessment under it, which is the thing somebody carries into a meeting.
 *
 * AN ASSESSMENT NOBODY HAS FILED STILL GETS ITS BLOCK, with its fields empty.
 * A missing block reads as an assessment this property does not need; an
 * empty one reads as work outstanding, which is what it is.
 */
function AssessmentBlock({ type, label, entry, slot }) {
  const routed = Boolean(slot?.state) && slot.state !== 'not_routed';
  const asked = Boolean(entry) || routed || Boolean(slot?.assignedTo || slot?.planDate);
  const isFiled = slot?.state === 'filed' || Boolean(slot?.filedAt || entry?.at);
  const waiting = isFiled ? 'Filed — nothing to score'
    : slot?.state === 'open' ? 'Started, not filed yet'
      : asked ? 'Not filed yet'
        : 'Not asked for';

  const values = entry?.values || {};
  const pct = entry?.values ? SCORERS[type]?.(values) ?? null : null;
  const grade = typeof pct === 'number' ? scoreGradeFor(pct) : null;
  const files = entry?.media?.files || [];
  const groups = FIELD_GROUPS[type] || [];

  return (
    <div
      className="pr-assessment-card"
      style={{
        border: '1.5px solid #bfdbfe',
        borderRadius: 8,
        background: '#ffffff',
        boxShadow: '0 1px 3px rgba(30, 58, 138, 0.05)',
        marginTop: 22,
        marginBottom: 20,
        overflow: 'hidden',
      }}
    >
      {/* Box Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: '#eff6ff',
          borderBottom: '1.5px solid #bfdbfe',
        }}
      >
        <span
          style={{
            color: '#1e3a8a',
            fontWeight: 800,
            fontSize: '13.5px',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {label.toUpperCase()}
        </span>
        <div>
          {typeof pct === 'number' ? (
            <span
              style={{
                color: grade?.color || '#16a34a',
                fontWeight: 700,
                fontSize: '12px',
                background: '#ffffff',
                padding: '3px 10px',
                borderRadius: 12,
                border: '1px solid #bfdbfe',
              }}
            >
              {pct}% ({grade?.label || ''})
            </span>
          ) : (
            <span
              style={{
                color: '#475569',
                fontWeight: 600,
                fontSize: '12px',
                background: '#ffffff',
                padding: '3px 10px',
                borderRadius: 12,
                border: '1px solid #cbd5e1',
              }}
            >
              {waiting}
            </span>
          )}
        </div>
      </div>

      {/* Box Inner Details */}
      <div style={{ padding: '16px 18px' }}>
        <InfoGrid>
          <InfoCell label="ASSIGNED TO">
            <span className="pr-value-text">{slot?.assignedTo || 'Unassigned'}</span>
          </InfoCell>
          <InfoCell label="FILED BY">
            <span className="pr-value-text">{slot?.filedBy || entry?.by || 'Not yet'}</span>
          </InfoCell>
          <InfoCell label="FILED ON">
            <span className="pr-value-text">
              {(slot?.filedAt || entry?.at)
                ? fmtDate(slot?.filedAt || entry?.at)
                : slot?.planDate
                  ? `Not yet — due ${fmtDate(slot.planDate)}`
                  : 'Not yet'}
            </span>
          </InfoCell>
          <InfoCell label="STATUS">
            <span className="pr-value-text">
              {typeof pct === 'number' ? `${pct}% (${grade?.label || ''})` : waiting}
            </span>
          </InfoCell>
        </InfoGrid>

        {groups.map((g) => {
          const longKeys = new Set(g.long || []);
          const shortKeys = g.keys.filter((k) => !longKeys.has(k));
          const longList = g.keys.filter((k) => longKeys.has(k));
          return (
            <div className="pr-section" key={g.label} style={{ marginTop: 16 }}>
              <SectionHeader title={g.label.toUpperCase()} />
              <InfoGrid>
                {shortKeys.map((k) => (
                  <InfoCell key={k} label={labelOfField(type, k)}>
                    <span className="pr-value-text">
                      {formatFieldValue(k, values[k]) ?? <span className="pr-empty-value">—</span>}
                    </span>
                  </InfoCell>
                ))}
                {longList.map((k) => (
                  <div key={k} className="pr-cell" style={{ gridColumn: '1 / -1' }}>
                    <span className="pr-label">{labelOfField(type, k)}</span>
                    <div className="pr-value">
                      {values[k] ? (
                        <span className="pr-value-text" style={{ whiteSpace: 'pre-wrap' }}>
                          {String(values[k])}
                        </span>
                      ) : (
                        <span className="pr-empty-note" style={{ fontStyle: 'italic', color: '#94a3b8' }}>
                          Not answered
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </InfoGrid>
            </div>
          );
        })}

        <div className="pr-section" style={{ marginTop: 16 }}>
          <SectionHeader title="ATTACHED" />
          {files.length > 0 ? (
            <table className="pr-media-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {files.map((x, i) => (
                  <tr key={x.url + i}>
                    <td>{x.name || `File ${i + 1}`}</td>
                    <td>
                      <a
                        href={x.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
                      >
                        View File
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="pr-empty-note" style={{ fontStyle: 'italic', color: '#94a3b8' }}>Nothing attached.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function OnePropertyAssessmentReport({ site, row }) {
  const byType = new Map((site.assessments || []).map((a) => [a.type, a]));
  const slotOf = (key) => (site.assessmentSlots || []).find((s) => s.type === key);
  const asked = ASSESSMENTS.filter(({ key }) => (
    Boolean(byType.get(key)) || slotOf(key)?.state !== 'not_routed'
  ));
  const propName = site?.title || row?.title || site?.propertyName || row?.propertyName || site?.locality || row?.locality || 'Property';
  const cityName = site?.city || row?.city || '—';

  return (
    <div className="pd-prop" style={{ marginBottom: 28 }}>
      <FormSheetFrame
        title={`Assessment (${propName})`}
        aside={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                color: '#1e3a8a',
                fontWeight: 800,
                fontSize: '11px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                Property Name:
              </span>
              <span style={{
                color: '#0f172a',
                fontWeight: 650,
                fontSize: '13px',
                wordBreak: 'break-word',
              }}>
                {propName}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                color: '#1e3a8a',
                fontWeight: 800,
                fontSize: '11px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                City:
              </span>
              <span style={{
                color: '#0f172a',
                fontWeight: 650,
                fontSize: '13px',
                wordBreak: 'break-word',
              }}>
                {cityName}
              </span>
            </div>
          </div>
        )}
        flat
      >
        {!asked.length ? (
          <div className="pr-empty-note" style={{ padding: '20px 0', textAlign: 'center' }}>
            No assessment was asked for on this property.
          </div>
        ) : (
          asked.map(({ key, label }) => (
            <AssessmentBlock
              key={key}
              type={key}
              label={label}
              entry={byType.get(key)}
              slot={slotOf(key)}
            />
          ))
        )}
      </FormSheetFrame>
    </div>
  );
}

function AssessmentsSection({ row }) {
  const sites = (row.siblings || []).filter((s) => s.stage !== 'demand' && s.title);
  if (sites.length <= 1) {
    return <OnePropertyAssessmentReport site={row} row={row} index={0} total={1} isClicked />;
  }

  const clicked = String(row.id ?? row.recordId ?? '');
  const ordered = [
    ...sites.filter((s) => String(s.id ?? s.recordId ?? '') === clicked),
    ...sites.filter((s) => String(s.id ?? s.recordId ?? '') !== clicked),
  ];

  return (
    <div>
      {ordered.map((s, i) => (
        <OnePropertyAssessmentReport
          key={s.id || s.recordId || i}
          site={s}
          row={row}
          index={i}
          total={sites.length}
          isClicked={String(s.id ?? s.recordId ?? '') === clicked}
        />
      ))}
    </div>
  );
}

/** The filing moment to the minute — "when did it come in" is often a clock
    question, not a calendar one, and the sheet already shows the date. */
function fmtDateTime(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return fmtDate(v);
  return `${fmtDate(v)}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Filed against due, in whole days. Null unless BOTH dates exist — "on
    time" is a claim, and no due date cannot support one. */
function latenessOf(planned, actual) {
  if (!planned || !actual) return null;
  const a = new Date(actual); const b = new Date(planned);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const DAY = 24 * 60 * 60 * 1000;
  const days = Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
    - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / DAY);
  if (days > 0) return { days, text: `${days} day${days === 1 ? '' : 's'} late` };
  if (days < 0) return { days, text: `${-days} day${days === -1 ? '' : 's'} early` };
  return { days: 0, text: 'On time' };
}

function DocumentBlock({ type, label, entry, slot }) {
  const filed = slot?.state === 'filed' || Boolean(entry?.values);
  const started = slot?.state === 'open';
  const status = documentStatus(entry || null);

  if (!filed) {
    return (
      <div
        style={{
          border: '1.5px solid #bfdbfe',
          borderRadius: 8,
          background: '#ffffff',
          boxShadow: '0 1px 3px rgba(30, 58, 138, 0.05)',
          marginTop: 22,
          marginBottom: 20,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: '#eff6ff',
            borderBottom: '1.5px solid #bfdbfe',
          }}
        >
          <span style={{ color: '#1e3a8a', fontWeight: 800, fontSize: '13.5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {label.toUpperCase()}
          </span>
          <span className={`pc2-status ${status.cls}`}>{status.label}</span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <InfoGrid>
            <InfoCell label="STATUS">
              <span className={`pc2-status ${status.cls}`}>{status.label}</span>
            </InfoCell>
            <InfoCell label="FORM">
              <span className="pr-empty-value">{started ? 'Started, not filed yet' : 'Not filed yet'}</span>
            </InfoCell>
            <InfoCell label="ASSIGNED TO">
              <span className="pr-value-text">{slot?.assignedTo || 'Unassigned'}</span>
            </InfoCell>
            <InfoCell label="ASSIGNED BY">
              <span className="pr-value-text">{slot?.assignedBy || '—'}</span>
            </InfoCell>
            <InfoCell label="DUE DATE">
              <span className="pr-value-text">{slot?.planDate ? fmtDate(slot.planDate) : '—'}</span>
            </InfoCell>
          </InfoGrid>
        </div>
      </div>
    );
  }

  const values = entry?.values || {};
  const groups = DOC_FIELD_GROUPS[type] || [];
  const filedAt = slot?.filedAt || entry?.at || null;
  const late = latenessOf(slot?.planDate, filedAt);
  const plan = type === 'loi' ? instalmentPlan(values) : null;
  const files = entry?.media?.files
    || (DOC_FILE_FIELDS[type] || []).flatMap((k) => (Array.isArray(values[k]) ? values[k] : []))
    || [];

  return (
    <div
      style={{
        border: '1.5px solid #bfdbfe',
        borderRadius: 8,
        background: '#ffffff',
        boxShadow: '0 1px 3px rgba(30, 58, 138, 0.05)',
        marginTop: 22,
        marginBottom: 20,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: '#eff6ff',
          borderBottom: '1.5px solid #bfdbfe',
        }}
      >
        <span style={{ color: '#1e3a8a', fontWeight: 800, fontSize: '13.5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {label.toUpperCase()}
        </span>
        <span className={`pc2-status ${status.cls}`}>{status.label}</span>
      </div>

      <div style={{ padding: '16px 18px' }}>
        <InfoGrid>
          <InfoCell label="ASSIGNED TO">
            <span className="pr-value-text"><PersonName name={slot?.assignedTo} />{!slot?.assignedTo && '—'}</span>
          </InfoCell>
          {slot?.assignedBy && (
            <InfoCell label="ASSIGNED BY">
              <span className="pr-value-text"><PersonName name={slot.assignedBy} /></span>
            </InfoCell>
          )}
          <InfoCell label="FILED BY">
            <span className="pr-value-text"><PersonName name={slot?.filedBy || entry?.by} />{!(slot?.filedBy || entry?.by) && '—'}</span>
          </InfoCell>
          <InfoCell label="PLAN DATE">
            <span className="pr-value-text">{slot?.planDate ? fmtDate(slot.planDate) : '—'}</span>
          </InfoCell>
          <InfoCell label="ACTUAL DATE">
            <span className="pr-value-text">{filedAt ? fmtDateTime(filedAt) : '—'}</span>
          </InfoCell>

        </InfoGrid>

        {groups.map((g) => {
          const longKeys = new Set(g.long || []);
          const shortKeys = g.keys.filter((k) => !longKeys.has(k) && formatDocValue(k, values[k]) !== null);
          const longList = g.keys.filter((k) => longKeys.has(k) && formatDocValue(k, values[k]) !== null);
          if (!shortKeys.length && !longList.length) return null;
          return (
            <div className="pr-section" key={g.label} style={{ marginTop: 16 }}>
              <SectionHeader title={g.label.toUpperCase()} />
              <InfoGrid>
                {shortKeys.map((k) => (
                  <InfoCell key={k} label={labelOfDocField(k)}>
                    <span className="pr-value-text">{formatDocValue(k, values[k])}</span>
                  </InfoCell>
                ))}
                {longList.map((k) => (
                  <div key={k} className="pr-cell" style={{ gridColumn: '1 / -1' }}>
                    <span className="pr-label">{labelOfDocField(k)}</span>
                    <div className="pr-value">
                      <span className="pr-value-text" style={{ whiteSpace: 'pre-wrap' }}>
                        {formatDocValue(k, values[k])}
                      </span>
                    </div>
                  </div>
                ))}
              </InfoGrid>
            </div>
          );
        })}

        {plan && (
          <div className="pr-section" style={{ marginTop: 16 }}>
            <SectionHeader title={`DEPOSIT SCHEDULE — ${plan.rows.length} INSTALMENTS${plan.equal ? ' (EQUAL)' : ''}`} />
            <table className="pr-media-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Share</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    <td>{Math.round(r.pct * 10) / 10}%</td>
                    <td style={{ fontWeight: 600 }}>₹{r.amount.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ fontWeight: 800, textTransform: 'uppercase', color: '#1e3a8a' }}>Total Deposit</td>
                  <td style={{ fontWeight: 800, color: '#1e3a8a' }}>₹{plan.total.toLocaleString('en-IN')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="pr-section" style={{ marginTop: 16 }}>
          <SectionHeader title="ATTACHED" />
          {files.length ? (
            <table className="pr-media-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {files.map((x, i) => (
                  <tr key={(x.url || x) + i}>
                    <td>{x.name || `File ${i + 1}`}</td>
                    <td>
                      <a
                        href={x.url || x}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
                      >
                        View File
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="pr-empty-note" style={{ fontStyle: 'italic', color: '#94a3b8' }}>Nothing attached.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function NocChecklist({ nocs, doc }) {
  const status = documentStatus(doc);
  const held = new Map();
  for (const n of nocs || []) {
    const key = (n.nocType || '').trim();
    if (key) held.set(key.toLowerCase(), n);
  }
  const extra = (nocs || []).filter((n) => {
    const k = (n.nocType || '').trim();
    return k && !NOC_TYPES.some((t) => t.toLowerCase() === k.toLowerCase());
  });
  const rows = [
    ...NOC_TYPES.map((t) => ({ label: t, entry: held.get(t.toLowerCase()) || null })),
    ...extra.map((n) => ({ label: n.nocType, entry: n })),
  ];
  const have = rows.filter((r) => r.entry).length;

  return (
    <div className="pr-section" style={{ marginTop: 24 }}>
      <SectionHeader title="NOCS & PERMITS" />
      <InfoGrid>
        <InfoCell label="STATUS">
          <span className={`pc2-status ${status.cls}`}>{status.label}</span>
        </InfoCell>
        <InfoCell label="NOCS HELD">
          <span className="pr-value-text" style={{ color: have ? 'var(--c-green, #16a34a)' : undefined, fontWeight: 700 }}>
            {have} of {rows.length} held
          </span>
        </InfoCell>
      </InfoGrid>

      <div style={{ marginTop: 16 }}>
        <table className="pr-media-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>Status</th>
              <th>Permit Name</th>
              <th>Expiry</th>
              <th>Filed By</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, entry }) => (
              <tr key={label}>
                <td>
                  <input type="checkbox" checked={Boolean(entry)} readOnly disabled />
                </td>
                <td style={{ fontWeight: 600 }}>{label}</td>
                <td>{entry?.expiryDate ? fmtDate(entry.expiryDate) : entry ? 'No expiry' : '—'}</td>
                <td>{entry?.by || '—'}</td>
                <td>
                  {(entry?.media?.files || []).length > 0 ? (
                    entry.media.files.map((x, i) => (
                      <a
                        key={`${entry.id || label}-${i}`}
                        href={x.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline', marginRight: 8 }}
                      >
                        {x.name || `File ${i + 1}`}
                      </a>
                    ))
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClosureSection({ row, only }) {
  const byType = new Map((row.documents || []).map((d) => [d.type, d]));
  const slotOf = (key) => (row.documentSlots || []).find((s) => s.type === key);
  const shown = only
    ? DOCUMENT_TYPES.filter((d) => d.key === only)
    : DOCUMENT_TYPES;

  const propName = row.title || row.locality || row.city || 'Property';
  const cityName = row.city || '—';
  const formTitle = `Commercial Details (${propName})`;
  /* The same words as the Commercial table this opened from: one document's
     own status when viewing one, the property's closure when viewing all. */
  const statusInfo = only
    ? documentStatus(byType.get(only) || null)
    : closureStatus(row.documents, DOCUMENT_TYPES.map((d) => d.key));

  return (
    <div className="pd-prop" style={{ marginBottom: 28 }}>
      <FormSheetFrame
        title={formTitle}
        aside={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                color: '#1e3a8a',
                fontWeight: 800,
                fontSize: '11px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                Property Name:
              </span>
              <span style={{
                color: '#0f172a',
                fontWeight: 650,
                fontSize: '13px',
                wordBreak: 'break-word',
              }}>
                {propName}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                color: '#1e3a8a',
                fontWeight: 800,
                fontSize: '11px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                City:
              </span>
              <span style={{
                color: '#0f172a',
                fontWeight: 650,
                fontSize: '13px',
                wordBreak: 'break-word',
              }}>
                {cityName}
              </span>
            </div>
          </div>
        )}
        reference={[
          { label: 'Date', value: fmtDate(row.createdAt || row.filedAt) },
          {
            label: 'Status',
            value: (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {statusInfo?.label && (
                  <span className={`pc2-status ${statusInfo.cls}`}>
                    {statusInfo.label}
                  </span>
                )}
              </div>
            ),
          },
        ]}
        flat
      >
        <LocationLine row={row} />

        {shown.map(({ key, label }) => (
          key === 'nocs'
            ? <NocChecklist key={key} nocs={row.nocList} doc={byType.get(key) || null} />
            : (
              <DocumentBlock
                key={key}
                type={key}
                label={label}
                entry={byType.get(key)}
                slot={slotOf(key)}
              />
            )
        ))}
      </FormSheetFrame>
    </div>
  );
}

function FlatDocumentSection({ type, label, entry, slot }) {
  const filed = slot?.state === 'filed' || Boolean(entry?.values);
  const started = slot?.state === 'open';
  const status = documentStatus(entry || null);
  const values = entry?.values || {};
  const groups = DOC_FIELD_GROUPS[type] || [];
  const filedAt = slot?.filedAt || entry?.at || null;
  const plan = type === 'loi' ? instalmentPlan(values) : null;
  const files = entry?.media?.files
    || (DOC_FILE_FIELDS[type] || []).flatMap((k) => (Array.isArray(values[k]) ? values[k] : []))
    || [];

  return (
    <div style={{ marginTop: 18, marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1.5px solid #e2e8f0',
          paddingBottom: 6,
          marginBottom: 10,
        }}
      >
        <span style={{ color: '#1e3a8a', fontWeight: 800, fontSize: '12px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span className={`pc2-status ${status.cls}`}>{status.label}</span>
      </div>

      {!filed ? (
        <InfoGrid>
          <InfoCell label="STATUS">
            <span className={`pc2-status ${status.cls}`}>{status.label}</span>
          </InfoCell>
          <InfoCell label="FORM">
            <span className="pr-empty-value">{started ? 'Started, not filed yet' : 'Not filed yet'}</span>
          </InfoCell>
          <InfoCell label="ASSIGNED TO">
            <span className="pr-value-text">{slot?.assignedTo ? <PersonName name={slot.assignedTo} /> : 'Unassigned'}</span>
          </InfoCell>
          <InfoCell label="DUE DATE">
            <span className="pr-value-text">{slot?.planDate ? fmtDate(slot.planDate) : '—'}</span>
          </InfoCell>
        </InfoGrid>
      ) : (
        <>
          <InfoGrid>
            <InfoCell label="ASSIGNED TO">
              <span className="pr-value-text"><PersonName name={slot?.assignedTo} />{!slot?.assignedTo && '—'}</span>
            </InfoCell>
            <InfoCell label="FILED BY">
              <span className="pr-value-text"><PersonName name={slot?.filedBy || entry?.by} />{!(slot?.filedBy || entry?.by) && '—'}</span>
            </InfoCell>
            <InfoCell label="PLAN DATE">
              <span className="pr-value-text">{slot?.planDate ? fmtDate(slot.planDate) : '—'}</span>
            </InfoCell>
            <InfoCell label="ACTUAL DATE">
              <span className="pr-value-text">{filedAt ? fmtDateTime(filedAt) : '—'}</span>
            </InfoCell>
            {groups.flatMap((g) => {
              const longKeys = new Set(g.long || []);
              return g.keys
                .filter((k) => !longKeys.has(k) && formatDocValue(k, values[k]) !== null)
                .map((k) => (
                  <InfoCell key={k} label={labelOfDocField(k)}>
                    <span className="pr-value-text">{formatDocValue(k, values[k])}</span>
                  </InfoCell>
                ));
            })}
          </InfoGrid>

          {groups.flatMap((g) => {
            const longKeys = new Set(g.long || []);
            return g.keys
              .filter((k) => longKeys.has(k) && formatDocValue(k, values[k]) !== null)
              .map((k) => (
                <div key={k} style={{ marginTop: 8 }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>
                    {labelOfDocField(k)}
                  </div>
                  <div className="pr-value-text" style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: '6px 10px', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                    {formatDocValue(k, values[k])}
                  </div>
                </div>
              ));
          })}

          {plan && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', marginBottom: 6 }}>
                Deposit Schedule ({plan.rows.length} Instalments)
              </div>
              <table className="pr-media-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Share</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr key={r.n}>
                      <td>{r.n}</td>
                      <td>{Math.round(r.pct * 10) / 10}%</td>
                      <td style={{ fontWeight: 600 }}>₹{r.amount.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 800, textTransform: 'uppercase', color: '#1e3a8a' }}>Total Deposit</td>
                    <td style={{ fontWeight: 800, color: '#1e3a8a' }}>₹{plan.total.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {files.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <table className="pr-media-table">
                <thead>
                  <tr>
                    <th>Attachment</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((x, i) => (
                    <tr key={(x.url || x) + i}>
                      <td>{x.name || `File ${i + 1}`}</td>
                      <td>
                        <a
                          href={x.url || x}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
                        >
                          View File
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FlatNocChecklist({ nocs, doc }) {
  const status = documentStatus(doc);
  const held = new Map();
  for (const n of nocs || []) {
    const key = (n.nocType || '').trim();
    if (key) held.set(key.toLowerCase(), n);
  }
  const extra = (nocs || []).filter((n) => {
    const k = (n.nocType || '').trim();
    return k && !NOC_TYPES.some((t) => t.toLowerCase() === k.toLowerCase());
  });
  const rows = [
    ...NOC_TYPES.map((t) => ({ label: t, entry: held.get(t.toLowerCase()) || null })),
    ...extra.map((n) => ({ label: n.nocType, entry: n })),
  ];
  const have = rows.filter((r) => r.entry).length;

  return (
    <div style={{ marginTop: 18, marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1.5px solid #e2e8f0',
          paddingBottom: 6,
          marginBottom: 10,
        }}
      >
        <span style={{ color: '#1e3a8a', fontWeight: 800, fontSize: '12px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          NOCS & PERMITS ({have} OF {rows.length} HELD)
        </span>
        <span className={`pc2-status ${status.cls}`}>{status.label}</span>
      </div>

      <table className="pr-media-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>Status</th>
            <th>Permit Name</th>
            <th>Expiry</th>
            <th>Filed By</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, entry }) => (
            <tr key={label}>
              <td>
                <input type="checkbox" checked={Boolean(entry)} readOnly disabled />
              </td>
              <td style={{ fontWeight: 600 }}>{label}</td>
              <td>{entry?.expiryDate ? fmtDate(entry.expiryDate) : entry ? 'No expiry' : '—'}</td>
              <td>{entry?.by || '—'}</td>
              <td>
                {(entry?.media?.files || []).length > 0 ? (
                  entry.media.files.map((x, i) => (
                    <a
                      key={`${entry.id || label}-${i}`}
                      href={x.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline', marginRight: 8 }}
                    >
                      {x.name || `File ${i + 1}`}
                    </a>
                  ))
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlatAssessmentSection({ type, label, entry, slot }) {
  const routed = Boolean(slot?.state) && slot.state !== 'not_routed';
  const asked = Boolean(entry) || routed || Boolean(slot?.assignedTo || slot?.planDate);
  const isFiled = slot?.state === 'filed' || Boolean(slot?.filedAt || entry?.at);
  const waiting = isFiled ? 'Filed — nothing to score'
    : slot?.state === 'open' ? 'Started, not filed yet'
      : asked ? 'Not filed yet'
        : 'Not asked for';

  const values = entry?.values || {};
  const pct = entry?.values ? SCORERS[type]?.(values) ?? null : null;
  const grade = typeof pct === 'number' ? scoreGradeFor(pct) : null;
  const files = entry?.media?.files || [];
  const groups = FIELD_GROUPS[type] || [];

  return (
    <div style={{ marginTop: 18, marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1.5px solid #e2e8f0',
          paddingBottom: 6,
          marginBottom: 10,
        }}
      >
        <span style={{ color: '#1e3a8a', fontWeight: 800, fontSize: '12px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {label}
        </span>
        {typeof pct === 'number' ? (
          <span style={{ color: grade?.color || '#16a34a', fontWeight: 700, fontSize: '12px' }}>
            Score: {pct}% ({grade?.label || ''})
          </span>
        ) : (
          <span style={{ color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
            {waiting}
          </span>
        )}
      </div>

      <InfoGrid>
        <InfoCell label="ASSIGNED TO">
          <span className="pr-value-text">{slot?.assignedTo ? <PersonName name={slot.assignedTo} /> : 'Unassigned'}</span>
        </InfoCell>
        <InfoCell label="FILED BY">
          <span className="pr-value-text">{slot?.filedBy || entry?.by ? <PersonName name={slot?.filedBy || entry?.by} /> : 'Not yet'}</span>
        </InfoCell>
        <InfoCell label="FILED ON">
          <span className="pr-value-text">
            {(slot?.filedAt || entry?.at) ? fmtDate(slot?.filedAt || entry?.at) : (slot?.planDate ? `Due ${fmtDate(slot.planDate)}` : '—')}
          </span>
        </InfoCell>
        {groups.flatMap((g) => {
          const longKeys = new Set(g.long || []);
          return g.keys
            .filter((k) => !longKeys.has(k) && formatFieldValue(k, values[k]) !== null)
            .map((k) => (
              <InfoCell key={k} label={labelOfField(k)}>
                <span className="pr-value-text">{formatFieldValue(k, values[k])}</span>
              </InfoCell>
            ));
        })}
      </InfoGrid>

      {groups.flatMap((g) => {
        const longKeys = new Set(g.long || []);
        return g.keys
          .filter((k) => longKeys.has(k) && formatFieldValue(k, values[k]) !== null)
          .map((k) => (
            <div key={k} style={{ marginTop: 8 }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>
                {labelOfField(k)}
              </div>
              <div className="pr-value-text" style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: '6px 10px', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                {formatFieldValue(k, values[k])}
              </div>
            </div>
          ));
      })}

      {files.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <table className="pr-media-table">
            <thead>
              <tr>
                <th>Attachment</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {files.map((x, i) => (
                <tr key={(x.url || x) + i}>
                  <td>{x.name || `File ${i + 1}`}</td>
                  <td>
                    <a
                      href={x.url || x}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
                    >
                      View File
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlanningSection({ row, schema }) {
  const projectId = row?.projectId || row?.project?._id || row?.project;
  const { data: plansData } = useStageRecords(projectId, 'p20', {}, { enabled: Boolean(projectId) });
  const liveRecord = (plansData?.data || plansData || [])[0] || null;
  const lv = liveRecord?.values || {};

  const basePlan = row?.plan || {};
  const games = (Array.isArray(lv.selected_games) && lv.selected_games.length > 0)
    ? lv.selected_games.filter(Boolean)
    : (Array.isArray(basePlan.games) ? basePlan.games.filter(Boolean) : []);

  const { resolve } = useEmployees();

  const rawManager = lv.project_manager || basePlan.manager;
  const managerName = rawManager ? (resolve(rawManager)?.name || getEmployeeById(rawManager)?.name || rawManager) : null;

  const submitterRaw = liveRecord?.submittedBy?.name || liveRecord?.submittedBy || basePlan.by;
  const submitterName = submitterRaw ? (resolve(submitterRaw)?.name || getEmployeeById(submitterRaw)?.name || submitterRaw) : null;

  const plan = {
    ...basePlan,
    ...lv,
    status: liveRecord?.status || basePlan.status,
    by: submitterName,
    at: liveRecord?.submittedAt || basePlan.at,
    games,
    gameCount: lv.game_count ?? (games.length || basePlan.gameCount || 0),
    confirmedArea: lv.confirmed_area ?? basePlan.confirmedArea ?? row.areaSqft,
    openingDate: lv.target_opening || basePlan.openingDate,
    trialDate: lv.testing_date || basePlan.trialDate,
    constructionStart: lv.construction_start || basePlan.constructionStart,
    handoverDate: lv.handover_date || basePlan.handoverDate,
    setupCost: lv.setup_cost ?? basePlan.setupCost,
    monthlyCost: lv.monthly_operating_cost ?? basePlan.monthlyCost,
    manager: managerName,
    siteShape: lv.site_shape || basePlan.siteShape,
    gameNotes: lv.game_notes || basePlan.gameNotes,
    departments: Array.isArray(lv.departments_involved)
      ? lv.departments_involved
      : (lv.departments_involved ? [lv.departments_involved] : (basePlan.departments || [])),
    cadFiles: Array.isArray(lv.cad_files)
      ? lv.cad_files
      : (basePlan.cadFiles || liveRecord?.media?.files || []),
    layoutPlan: lv.layout_plan || basePlan.layoutPlan,
    remarks: lv.remarks || basePlan.remarks,
  };

  const propName = row.title || row.locality || row.city || 'Property';
  const cityName = row.city || '—';
  const formTitle = `PROJECT CREATION (${propName.toUpperCase()})`;

  const byType = new Map((row.documents || []).map((d) => [d.type, d]));
  const slotOf = (key) => (row.documentSlots || []).find((s) => s.type === key);

  const asmtByType = new Map((row.assessments || []).map((a) => [a.type, a]));
  const asmtSlotOf = (key) => (row.assessmentSlots || []).find((s) => s.type === key);
  const askedAsmts = ASSESSMENTS.filter(({ key }) => (
    Boolean(asmtByType.get(key)) || asmtSlotOf(key)?.state !== 'not_routed'
  ));

  const d = row.details || {};
  const files = row.media?.files || [];
  const live = d.liveLocation;
  const lat = Number(live?.lat ?? live?.latitude);
  const lng = Number(live?.lng ?? live?.longitude);
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng);

  return (
    <div className="pd-prop" style={{ marginBottom: 28 }}>
      <FormSheetFrame
        title={formTitle}
        aside={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                color: '#1e3a8a',
                fontWeight: 800,
                fontSize: '11px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                Property Name:
              </span>
              <span style={{
                color: '#0f172a',
                fontWeight: 650,
                fontSize: '13px',
                wordBreak: 'break-word',
              }}>
                {propName}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                color: '#1e3a8a',
                fontWeight: 800,
                fontSize: '11px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                City:
              </span>
              <span style={{
                color: '#0f172a',
                fontWeight: 650,
                fontSize: '13px',
                wordBreak: 'break-word',
              }}>
                {cityName}
              </span>
            </div>
          </div>
        )}
        reference={[
          { label: 'Date', value: fmtDate(plan.at || row.createdAt || row.filedAt) },
          {
            label: 'Status',
            value: (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className={`pc2-status ${['submitted', 'approved', 'locked'].includes(plan.status) ? 's-done' : 's-go'}`}>
                  {['submitted', 'approved', 'locked'].includes(plan.status) ? 'Project Created' : 'In Planning'}
                </span>
              </div>
            ),
          },
        ]}
        flat
      >
        <LocationLine row={row} />

        {/* 1. PROJECT & OUTLET PLANNING */}
        <div className="pr-section" style={{ marginTop: 20 }}>
          <SectionHeader title="PROJECT & OUTLET PLANNING" />
          <InfoGrid>
            <InfoCell label="PROJECT MANAGER">
              <span className="pr-value-text">{plan.manager ? <PersonName name={plan.manager} /> : '—'}</span>
            </InfoCell>
            <InfoCell label="CONFIRMED AREA">
              <span className="pr-value-text">
                {plan.confirmedArea != null && plan.confirmedArea !== ''
                  ? `${Number(plan.confirmedArea).toLocaleString('en-IN')} sq ft`
                  : (row.areaSqft ? `${Number(row.areaSqft).toLocaleString('en-IN')} sq ft` : '—')}
              </span>
            </InfoCell>
            <InfoCell label="SETUP BUDGET">
              <span className="pr-value-text">
                {plan.setupCost != null && plan.setupCost !== ''
                  ? (Number.isFinite(Number(plan.setupCost)) ? `₹${Number(plan.setupCost).toLocaleString('en-IN')}` : plan.setupCost)
                  : '—'}
              </span>
            </InfoCell>
            <InfoCell label="MONTHLY RUNNING COST">
              <span className="pr-value-text">
                {plan.monthlyCost != null && plan.monthlyCost !== ''
                  ? (Number.isFinite(Number(plan.monthlyCost)) ? `₹${Number(plan.monthlyCost).toLocaleString('en-IN')}` : plan.monthlyCost)
                  : '—'}
              </span>
            </InfoCell>
            <InfoCell label="TARGET OPENING">
              <span className="pr-value-text">{plan.openingDate ? fmtDate(plan.openingDate) : '—'}</span>
            </InfoCell>
            <InfoCell label="TRIAL RUN">
              <span className="pr-value-text">{plan.trialDate ? fmtDate(plan.trialDate) : '—'}</span>
            </InfoCell>
            <InfoCell label="CONSTRUCTION START">
              <span className="pr-value-text">{plan.constructionStart ? fmtDate(plan.constructionStart) : '—'}</span>
            </InfoCell>
            <InfoCell label="HANDOVER DATE">
              <span className="pr-value-text">{plan.handoverDate ? fmtDate(plan.handoverDate) : '—'}</span>
            </InfoCell>
            <InfoCell label="NUMBER OF GAMES">
              <span className="pr-value-text">{plan.gameCount || games.length || '—'}</span>
            </InfoCell>
            <InfoCell label="PLANNED BY">
              <span className="pr-value-text">{plan.by ? <PersonName name={plan.by} /> : '—'}</span>
            </InfoCell>
          </InfoGrid>

          {/* DEPARTMENTS INVOLVED */}
          {Array.isArray(plan.departments) && plan.departments.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
                DEPARTMENTS INVOLVED ({plan.departments.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {plan.departments.map((dept, idx) => (
                  <span
                    key={idx}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 10px',
                      borderRadius: '4px',
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      fontWeight: 600,
                      fontSize: '11.5px',
                    }}
                  >
                    🏢 {dept}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* SITE SHAPE / CONSTRAINTS */}
          {plan.siteShape && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
                SHAPE / LAYOUT NOTES
              </div>
              <div className="pr-value-text" style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                {plan.siteShape}
              </div>
            </div>
          )}

          {/* GAMES LIST */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
              GAMES SELECTED ({games.length})
            </div>
            {games.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {games.map((g, idx) => (
                  <span
                    key={idx}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1e40af',
                      fontWeight: 650,
                      fontSize: '12px',
                    }}
                  >
                    🎮 {g}
                  </span>
                ))}
              </div>
            ) : (
              <div className="pr-empty-note" style={{ fontStyle: 'italic', color: '#94a3b8' }}>
                No games chosen yet.
              </div>
            )}
          </div>

          {/* GAME PLANNING NOTES */}
          {plan.gameNotes && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
                GAME PLANNING NOTES
              </div>
              <div className="pr-value-text" style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                {plan.gameNotes}
              </div>
            </div>
          )}

          {/* SITE CAD / FLOOR PLAN ATTACHMENTS */}
          {Array.isArray(plan.cadFiles) && plan.cadFiles.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
                SITE CAD / FLOOR PLANS ({plan.cadFiles.length})
              </div>
              <table className="pr-media-table">
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.cadFiles.map((f, i) => {
                    const fileUrl = typeof f === 'string' ? f : (f.url || f.previewUrl || '#');
                    const fileName = typeof f === 'string' ? f.split('/').pop() : (f.name || f.originalName || `Drawing ${i + 1}`);
                    return (
                      <tr key={(f.url || f.publicId || f) + i}>
                        <td>{fileName}</td>
                        <td>
                          <a
                            href={fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
                          >
                            View Drawing
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* OUTLET LAYOUT (AI-GENERATED) */}
          {plan.layoutPlan && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
                OUTLET LAYOUT (AI-GENERATED)
              </div>
              <LayoutPlanner
                value={plan.layoutPlan}
                readOnly
                formValues={{
                  confirmed_area: plan.confirmedArea,
                  selected_games: games,
                  site_shape: plan.siteShape,
                }}
              />
            </div>
          )}

          {plan.remarks && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
                PLAN NOTES / REMARKS
              </div>
              <div className="pr-value-text" style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                {plan.remarks}
              </div>
            </div>
          )}
        </div>

        {/* 2. COMMERCIAL & LEGAL CLOSURE */}
        <div className="pr-section" style={{ marginTop: 28 }}>
          <SectionHeader title="COMMERCIAL & LEGAL CLOSURE" />
          {DOCUMENT_TYPES.map(({ key, label }) => (
            key === 'nocs'
              ? <FlatNocChecklist key={key} nocs={row.nocList} doc={byType.get(key) || null} />
              : (
                <FlatDocumentSection
                  key={key}
                  type={key}
                  label={label}
                  entry={byType.get(key)}
                  slot={slotOf(key)}
                />
              )
          ))}
        </div>

        {/* 3. SITE EVALUATION & ASSESSMENTS */}
        <div className="pr-section" style={{ marginTop: 28 }}>
          <SectionHeader title="SITE EVALUATION & ASSESSMENTS" />
          {!askedAsmts.length ? (
            <div className="pr-empty-note" style={{ padding: '12px 0', fontStyle: 'italic', color: '#94a3b8' }}>
              No assessment records filed.
            </div>
          ) : (
            askedAsmts.map(({ key, label }) => (
              <FlatAssessmentSection
                key={key}
                type={key}
                label={label}
                entry={asmtByType.get(key)}
                slot={asmtSlotOf(key)}
              />
            ))
          )}
        </div>

        {/* 4. BASIC PROPERTY & SITE SPECIFICATIONS */}
        <div className="pr-section" style={{ marginTop: 28 }}>
          <SectionHeader title="PROPERTY SPECIFICATIONS & CAPTURE DETAILS" />
          <InfoGrid>
            <InfoCell label="Carpet Area">
              <span className="pr-value-text">{row.areaSqft ? `${fmtNumber(row.areaSqft)} sq ft` : '—'}</span>
            </InfoCell>
            <InfoCell label="Floor">
              <span className="pr-value-text">{row.floor || '—'}</span>
            </InfoCell>
            <InfoCell label="Ownership">
              <span className="pr-value-text">{row.ownership || '—'}</span>
            </InfoCell>
            <InfoCell label="Frontage">
              <span className="pr-value-text">{d.frontageFt ? `${d.frontageFt} ft` : '—'}</span>
            </InfoCell>
            <InfoCell label="Monthly Rent">
              <span className="pr-value-text">{d.monthlyRent ? fmtCurrency(d.monthlyRent) : '—'}</span>
            </InfoCell>
            <InfoCell label="Deposit">
              <span className="pr-value-text">{d.deposit ? fmtCurrency(d.deposit) : '—'}</span>
            </InfoCell>
            <InfoCell label="Full Address">
              <span className="pr-value-text">{row.address || row.locality || '—'}</span>
            </InfoCell>
            {hasPin ? (
              <InfoCell label="Live Location">
                <a
                  href={live.mapUrl || `https://www.google.com/maps?q=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
                >
                  Open in Maps
                </a>
              </InfoCell>
            ) : null}
            <InfoCell label="Contact Person">
              <span className="pr-value-text">{row.submittedByName || '—'}</span>
            </InfoCell>
            {row.submittedByPhone ? (
              <InfoCell label="Phone">
                <span className="pr-value-text">{displayMobile(row.submittedByPhone)}</span>
              </InfoCell>
            ) : null}
          </InfoGrid>

          {files.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
                ATTACHED PHOTOS & DRAWINGS ({files.length})
              </div>
              <table className="pr-media-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((x, i) => (
                    <tr key={(x.url || x) + i}>
                      <td>{x.name || `File ${i + 1}`}</td>
                      <td>
                        <a
                          href={x.url || x}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'underline' }}
                        >
                          View File
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </FormSheetFrame>
    </div>
  );
}

/**
 * @param showAssessments  Off by default. Step 1 is the intake sheet and its
 *   report is about what was CAPTURED; four assessment blocks under it were
 *   four screens of "Not asked for" on a property nobody has routed yet, which
 *   buries the thing the reader opened the report to read. The steps whose
 *   subject IS the assessments pass it.
 */
/**
 * THE PROPERTY, IN A LINE, above its assessments.
 *
 * Enough to be certain which site the scores belong to - the name, where it
 * is, how big, what floor, what it costs - and no more. The full capture
 * report is Step 1's, and repeating it here is what pushed the assessments
 * below the fold on screen and onto page two in print.
 */
/**
 * THE HEAD EVERY "View" WEARS, whatever was pressed.
 *
 * Which property am I looking at, before what am I looking at it FOR. This was
 * the assessment report's own head and only the assessment report had it: open
 * a capture report and the sheet began with the form, so the one question a
 * reader asks first — "is this the right site?" — was answered somewhere in
 * the middle of it, if at all. Documents, assessments, closure and capture all
 * open with these three lines now.
 *
 * The facts line is whatever this property HAS — area, floor, commercial type,
 * rent — never a placeholder for what it has not. A head that prints "— sq ft ·
 * — · —" tells the reader nothing and takes a line to do it.
 */
export function PropertyViewHead({ row, kicker = null }) {
  const facts = [
    row.areaSqft && `${Number(row.areaSqft).toLocaleString('en-IN')} sq ft`,
    row.floor,
    row.details?.commercialType,
    Number(row.details?.monthlyRent) && `\u20b9${Number(row.details.monthlyRent).toLocaleString('en-IN')}/mo`,
  ].filter(Boolean);

  return (
    <header className="pd-arh">
      {kicker && <p className="pd-arh-kicker">{kicker}</p>}
      <h2 className="pd-arh-name">{row.title}</h2>
      <p className="pd-arh-where">
        {[row.locality, row.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' \u00b7 ') || '\u2014'}
      </p>
      {facts.length > 0 && (
        <p className="pd-arh-facts">{facts.join('  \u00b7  ')}</p>
      )}
    </header>
  );
}

export function PropertyDetailsModal({
  row, onClose, showAssessments = false, showClosure = false, showPlanning = false, focusDocument = null, onEdit,
}) {
  const sheetRef = useRef(null);
  /**
   * WHICH PROPERTIES ARE TICKED — one box per property in this report.
   *
   * Stored as OVERRIDES of a default rather than as a set, because the default
   * depends on how many properties there are and that is not known until the
   * report has been worked out below: a report about ONE property starts ticked
   * (there is nothing else to choose between, so Download should be one click),
   * and a report about several starts with none. Anything the person does
   * wins over the default.
   */
  const [overrides, setOverrides] = useState({});
  const [dlBusy, setDlBusy] = useState(false);
  const [dlNote, setDlNote] = useState(null);
  /* The rendered report of each property, by key. Registered by the report itself
     and read when Download is pressed, so the PDF is made from exactly what is
     on screen. */
  const nodes = useRef(new Map());
  const hasRecord = Boolean(row?.recordId);

  /**
   * EVERY PROPERTY THIS REPORT COVERS.
   *
   * The queue folds a location into one row, so a franchise application
   * describing four sites, or four sites our team captured in one city, is one
   * line holding four properties. The report is about all of them: the row's
   * own siblings where it has them, otherwise just itself.
   *
   * `demand` rows are left out - a store still looking for a site is an ask,
   * not a property, and it has no capture form to print.
   */
  const reported = (row?.siblings?.length
    ? row.siblings.filter((s) => s.stage !== 'demand' && (s.title || s.property_name || s.recordId || s.id || s.locality || s.city))
    : [row]).filter(Boolean);

  /* A property's identity in this report. `index` backs it up for a submission
     that has neither an id nor a record yet. */
  const siteKey = (site, index) => String(site?.id || site?.recordId || `site-${index}`);
  /* WHICH ONE THEY PRESSED. A location of four prints four reports, and
     without this the site they came to read is just the first of them — the
     same reason the assessments list marks it. */
  const clickedSiteKey = String(row?.id ?? row?.recordId ?? '');
  const isOn = (key) => (key in overrides ? overrides[key] : reported.length === 1);
  const pickedKeys = reported.map(siteKey).filter(isOn);
  const pick = {
    on: isOn,
    toggle: (key) => setOverrides((o) => ({ ...o, [key]: !isOn(key) })),
    register: (key, el) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); },
  };

  /**
   * DOWNLOAD EVERY TICKED PROPERTY AS ITS OWN PDF.
   *
   * One file per property, named after it, in the order they appear in the
   * report. A short pause between them: browsers treat a burst of downloads
   * from one click as suspicious and drop all but the first, and the first time
   * ask the person to allow several. A property that cannot be made (its form
   * has not finished loading) is skipped and NAMED, never silently missing.
   */
  const runDownload = async () => {
    if (!pickedKeys.length || dlBusy) return;
    setDlBusy(true);
    setDlNote(null);
    const failed = [];
    const used = new Set();
    try {
      for (let i = 0; i < reported.length; i += 1) {
        const site = reported[i];
        const key = siteKey(site, i);
        if (!pickedKeys.includes(key)) continue;
        const label = [site.title, site.city].filter(Boolean).join(' - ') || `Property ${i + 1}`;
        let file = pdfFileName(label);
        for (let n = 2; used.has(file); n += 1) file = pdfFileName(`${label} (${n})`);
        used.add(file);
        try {
          const node = nodes.current.get(key);
          if (!node) throw new Error('Form not rendered yet');
          await exportNodeToPdf(node, file);
        } catch (err) {
          failed.push(label);
        }
        await new Promise((r) => setTimeout(r, 450));
      }
    } finally {
      setDlBusy(false);
    }
    if (failed.length) {
      setDlNote({ tone: 'bad', text: `Could not make a PDF for: ${failed.join(', ')}.` });
    }
  };

  /**
   * The template comes from whichever property in the group HAS a project.
   *
   * It used to come from the clicked row alone, so a location holding one
   * submitted site and three filed ones rendered the three filed forms with no
   * schema — every section empty — purely because the row the reader happened
   * to press was the one without a record.
   */
  const withProject = reported.find((s) => s?.projectId) || null;
  const anyRecord = reported.some((s) => s?.recordId);
  const { data: project } = useProject(withProject?.projectId || undefined);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  if (!row) return null;

  /* Only the TEMPLATE is waited for here. Each property fetches its own record
     inside its own block, so one slow record does not hold up the four that
     have already arrived. */
  const loading = anyRecord && templateLoading;
  const stage = template?.stages?.find((st) => st.key === STAGE_CAPTURE) || null;
  const schema = stage?.masterDataSchema || [];
  const shownTitle = row.title;

  return (
    <Modal
      open
      onClose={onClose}
      title={null}
      subtitle={null}
      width={940}
      className="pdoc-modal"
      footer={(
        <div className="pdoc-foot" style={{ justifyContent: 'flex-end' }}>
          {/* Only ever a message: it says which property a PDF could not be made for. */}
          {dlNote && (
            <div className="pdoc-sel" aria-live="polite">
              <span className={`pdoc-sel-note is-${dlNote.tone}`}>{dlNote.text}</span>
            </div>
          )}
          <div className="pdoc-foot-acts">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
            {/* READ, THEN FIX, WITHOUT GOING BACK FOR IT. Somebody reading a
                report is the likeliest person to notice something wrong in
                it, and until now the only way to act on that was to close the
                report, find the row again and press Edit there. Shown only
                where the caller has somewhere to send them. */}
            {onEdit && hasRecord && (
              <button
                type="button"
                className="btn btn-subtle"
                onClick={() => onEdit(row)}
                title="Open the form behind this report and change it"
              >
                <PenLine size={14} /> Edit
              </button>
            )}
            {/* THE PROPERTY REPORT'S ONE ACTION IS DOWNLOAD. It was Save / Save All,
                which opened the print dialog; it now saves a PDF for every ticked
                property. The Assessment and Closure reports are not about choosing
                between properties and keep their own print button below. */}
            {!showClosure && !showAssessments && !showPlanning && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading || dlBusy || !pickedKeys.length}
                onClick={runDownload}
                title={pickedKeys.length
                  ? `Download ${pickedKeys.length === 1 ? 'the ticked property' : `the ${pickedKeys.length} ticked properties`} as PDF`
                  : 'Tick at least one property to download'}
              >
                {dlBusy ? 'Preparing…' : 'Download'}
                {!dlBusy && pickedKeys.length > 0 && <span className="pdoc-dl-n">{pickedKeys.length}</span>}
              </button>
            )}
            {(showClosure || showAssessments || showPlanning) && (
              <button
                type="button"
                className="btn btn-primary"
                /* There is always something to print now — a submission prints
                   as what was sent in. Only an unfinished fetch disables it. */
                disabled={loading}
                onClick={() => {
                  const titleForDoc = getSourceTitle(reported[0], null, row);
                  printDoc(sheetRef.current, `${shownTitle} — ${showPlanning
                    ? 'project creation report'
                    : showClosure
                      ? (focusDocument
                        ? `${DOCUMENT_TYPES.find((dd) => dd.key === focusDocument)?.label || 'document'}`.toLowerCase()
                        : 'closure report')
                      : `${titleForDoc.toLowerCase()} report`}`);
                }}
              >
                {reported.length > 1 ? 'Save All' : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}
    >
      {loading ? (
        <div className="prop-pick-empty">Fetching the property…</div>
      ) : (
        <>
          <div ref={sheetRef}>
            {showPlanning ? (
              <PlanningSection row={row} schema={schema} />
            ) : (
              <>
                {!showAssessments && !(showClosure && focusDocument) && reported.map((s, i) => (
                  <OnePropertyReport
                    key={s.id || s.recordId || i}
                    site={s}
                    index={i}
                    total={reported.length}
                    schema={schema}
                    row={row}
                    clickedKey={clickedSiteKey}
                    pick={!showClosure && !showAssessments ? pick : null}
                    pickKey={siteKey(s, i)}
                    /* Opened from Commercial, the property's status IS its closure —
                       "Shortlisted" above "Pending · 1/5" read as two answers. */
                    statusOverride={showClosure ? closureStatus(row.documents, DOCUMENT_TYPES.map((d) => d.key)) : null}
                  />
                ))}
                {showAssessments && <AssessmentsSection row={row} />}
                {showClosure && <ClosureSection row={row} only={focusDocument} />}
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

export default PropertyDetailsModal;
