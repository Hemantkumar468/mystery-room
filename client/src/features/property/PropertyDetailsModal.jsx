import { useEffect, useRef, useState } from 'react';
import { Printer, MapPin, Check } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { PropertyReportSheet } from '../projects/PropertyReportSheet.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useRecord, useStageRecords } from '../../app/api/recordsApi.js';

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
 * NEWEST FIRST, EVERYWHERE, AND ALWAYS WITH ITS DATE.
 *
 * Alphabetical order is only useful when you already know the name you are
 * looking for. Nobody opening one of these lists does: they are looking for
 * the thing they filed this morning, and on a list of forty it sat wherever
 * the alphabet put it. Newest first puts it on the first line, and the date
 * beside each option is what makes two sites with near-identical names
 * distinguishable at all.
 */
const newestFirst = (list, dateOf = (x) => x?.createdAt) => [...(list || [])]
  .sort((a, b) => new Date(dateOf(b) || 0) - new Date(dateOf(a) || 0));

/** "12 Sep '26" — short enough for an <option>, unambiguous across a year end. */
const shortDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  : '');


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
  /* Stylesheets are still loading when write() returns; printing into them
     half-applied is how a report comes out unstyled. */
  const go = () => { win.focus(); win.print(); };
  if (win.document.readyState === 'complete') setTimeout(go, 350);
  else win.addEventListener('load', () => setTimeout(go, 350));
}

/** The two locations, side by side, because both are called "location". */
function LocationLine({ row, values }) {
  const live = values?.live_location;
  const lat = live?.lat ?? live?.latitude;
  const lng = live?.lng ?? live?.longitude;
  const hasPin = Number.isFinite(Number(lat));

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 10 }}>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">City — where we want to open</span>
        <span className="pr-value-text">{row.city || '—'}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">Live location — this site</span>
        {hasPin ? (
          <a
            className="pr-value-text"
            style={{ color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            href={live.mapUrl || `https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noreferrer"
          >
            <MapPin size={12} /> {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
          </a>
        ) : (
          <span className="pr-value-text">{[row.locality, row.address].filter(Boolean)[0] || 'Not captured'}</span>
        )}
      </span>
    </div>
  );
}

export function PropertyDetailsModal({ row, onClose }) {
  const sheetRef = useRef(null);
  const hasRecord = Boolean(row?.recordId);

  /* Which of the store's properties the sheet is showing. `pending` is what
     the dropdown holds before Apply — merely opening the list must not swap
     the page out from under somebody halfway through reading it. */
  const [shownId, setShownId] = useState(row?.recordId || null);
  const [pendingId, setPendingId] = useState(row?.recordId || null);
  useEffect(() => {
    setShownId(row?.recordId || null);
    setPendingId(row?.recordId || null);
  }, [row?.recordId]);

  /* Every candidate site captured against this store. One is the ordinary
     case, and then no picker is drawn at all. */
  const { data: siblings } = useStageRecords(row?.projectId, 'p1', {}, {
    enabled: Boolean(row?.projectId),
  });
  const candidates = newestFirst((Array.isArray(siblings) ? siblings : (siblings?.data || []))
    .filter((x) => x?._id));

  const { data: record, isLoading: recordLoading } = useRecord(shownId, { enabled: Boolean(shownId) });
  const { data: project } = useProject(hasRecord ? row?.projectId : undefined);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  if (!row) return null;

  const loading = hasRecord && (recordLoading || templateLoading);
  const stage = template?.stages?.find((st) => st.key === STAGE_CAPTURE) || null;
  const schema = stage?.masterDataSchema || [];
  const values = record?.values || {};

  /* The sheet names the property it is ACTUALLY showing, which is not the row
     that was clicked once the picker has been used. */
  const shownTitle = (shownId !== row.recordId
    ? (record?.title || values.property_name)
    : row.title) || row.title;

  return (
    <Modal
      open
      onClose={onClose}
      title="Property report"
      subtitle={[row.title, row.city].filter(Boolean).join(' · ')}
      width={940}
      className="pdoc-modal"
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span className="tiny muted">
            {hasRecord
              ? 'The same report the property page prints.'
              : 'Sent through the public form — not filed as a property record yet.'}
          </span>
          <div className="row gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!hasRecord || loading}
              onClick={() => printDoc(sheetRef.current, `${shownTitle} — property report`)}
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </div>
        </div>
      )}
    >
      {!hasRecord ? (
        /* Nothing has been filed yet — Shortlist is what files it — so there
           is no report to print. Said plainly rather than shown as an empty
           one, which would read as a report that failed to load. */
        <div className="prop-pick-empty">
          This property arrived through the public form and has not been filed as a
          Phase 1 record yet, so there is no report on it. Shortlisting it files the
          record — the report exists from that moment.
        </div>
      ) : loading ? (
        <div className="prop-pick-empty">Fetching the property…</div>
      ) : (
        <>
          {/* WHICH SITE, when the store has more than one. Screen only: the
              printed sheet is one property, and a dropdown on paper is
              nonsense. */}
          {candidates.length > 1 && (
            <div className="pdoc-pick no-print">
              <span className="pdoc-pick-label">
                {candidates.length} properties captured for {row.projectName || 'this store'} — which one?
              </span>
              <select className="select" value={pendingId || ''} onChange={(e) => setPendingId(e.target.value)}>
                {candidates.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.title || c.values?.property_name || 'Untitled property'}
                    {c.values?.locality ? ` — ${c.values.locality}` : ''}
                    {c.values?.carpet_area ? ` · ${Number(c.values.carpet_area).toLocaleString('en-IN')} sq ft` : ''}
                    {c.createdAt ? ` · ${shortDate(c.createdAt)}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={pendingId === shownId}
                onClick={() => setShownId(pendingId)}
                title="Show this property's report — the PDF prints whatever is shown"
              >
                <Check size={13} /> Apply
              </button>
            </div>
          )}

          <div ref={sheetRef}>
            <PropertyReportSheet
              record={record}
              schema={schema}
              /* The PROPERTY's name, not the project's — this report is about
                 one site, and which site is the first thing to answer. */
              heading={shownTitle}
              subheading="Property Information Report"
              headerExtra={<LocationLine row={row} values={values} />}
              style={{ background: '#fff', border: 0, maxWidth: 'none', margin: 0, padding: 0 }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}

export default PropertyDetailsModal;
