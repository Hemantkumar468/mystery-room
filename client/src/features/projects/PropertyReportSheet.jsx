import { useState } from 'react';
import {
  CircleCheck, ClipboardCheck, Building2, Wallet, User, Handshake, Paperclip, FileText, History,
  Image as ImageIcon, Video, Volume2, File as FileIcon,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { fmtDate, fmtDateTime, fmtCurrency, fmtFileSize } from '../../lib/format.js';
import { LocationPreviewModal } from './records/LocationPreviewModal.jsx';
import { RECORD_STATUS_META } from './records/recordUi.js';
import { FormSheetFrame } from '../../components/ui/FormSheetFrame.jsx';

/**
 * THE Property Report — one sheet, rendered wherever the report is asked for.
 *
 * It was written inside PropertyDetailPage and lived only there, which meant
 * the only way to read a property as a report was to leave whatever you were
 * doing and open that page. The property queue now shows the same report over
 * its own rows ("View Details"), and a second copy of this layout would have
 * started drifting from this one the first time either was touched — the
 * columns, the field order and the audit block would disagree about the same
 * record. So it is one component, imported twice.
 *
 * WHAT IT IS NOT. It is the captured record, printed: status, audit trail, the
 * template's own sections, the media and the notes. The activity timeline and
 * the AI panel stay with the page, because they are commentary ABOUT the
 * property rather than part of what was filed about it.
 *
 * `heading` / `subheading` let the caller name the sheet — the page titles it
 * "Property Report", the queue titles it with the property's own name, which
 * is what somebody reading a single site wants at the top.
 */
function groupBySection(schema) {
  const ordered = [...schema].sort((a, b) => (a.order || 0) - (b.order || 0));
  const out = [];
  const map = new Map();
  for (const f of ordered) {
    const title = f.section || 'Details';
    if (!map.has(title)) {
      const g = { title, fields: [] };
      map.set(title, g);
      out.push(g);
    }
    map.get(title).fields.push(f);
  }
  return out;
}

const SECTION_ICONS = {
  Status: CircleCheck,
  Audit: ClipboardCheck,
  'Property Information': Building2,
  'Commercial Information': Wallet,
  'Owner Details': User,
  'Broker Details': Handshake,
  Media: Paperclip,
  Notes: FileText,
  'Activity Timeline': History,
};

function fileKind(entry) {
  const mt = entry.mimetype || '';
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  return 'document';
}

const MEDIA_TABS = [
  { key: 'image', label: 'Images', icon: ImageIcon },
  { key: 'document', label: 'Documents', icon: FileIcon },
  { key: 'video', label: 'Videos', icon: Video },
  { key: 'audio', label: 'Audio', icon: Volume2 },
];

/** Read-only location value — opens the same Property Location Preview popup
 *  the editable Live Location field uses, rather than jumping straight out. */
function LocationValue({ value }) {
  const [open, setOpen] = useState(false);
  const hasPoint = value?.mapUrl || value?.lat != null;
  if (!hasPoint) return <span className="pr-empty-value">—</span>;
  return (
    <>
      <button
        type="button"
        className="pr-value-text"
        onClick={() => setOpen(true)}
        /* `fontFamily`, NOT the `font` shorthand. `font: inherit` resets
           font-size and font-weight too, so this button overrode the
           `.pr-value-text` class it carries and printed at 13px/400 — the one
           value on the sheet lighter than its own label. */
        style={{ color: '#1d4ed8', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
      >
        Open in Maps
      </button>
      <LocationPreviewModal open={open} onClose={() => setOpen(false)} value={value} />
    </>
  );
}

function FieldValue({ field, value }) {
  const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
  if (empty) return <span className="pr-empty-value">—</span>;
  switch (field.type) {
    case 'currency':
      return <span className="pr-value-text">{fmtCurrency(Number(value) || 0)}</span>;
    case 'date':
      return <span className="pr-value-text">{fmtDate(value)}</span>;
    case 'boolean':
      return <span className="pr-value-text">{value === true || value === 'true' ? 'Yes' : 'No'}</span>;
    case 'location':
      return <LocationValue value={value} />;
    case 'multiselect':
      return <span className="pr-value-text">{Array.isArray(value) ? value.join(', ') : String(value)}</span>;
    default:
      return <span className="pr-value-text" style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</span>;
  }
}

/* ---- Compact report field cell (label + value stacked) ---- */
function InfoCell({ label, children }) {
  return (
    <div className="pr-cell">
      <span className="pr-label">{label}</span>
      <div className="pr-value">{children}</div>
    </div>
  );
}

/* ---- Audit cell: name on top, datetime below ---- */
function AuditCell({ label, who, when, extra }) {
  if (!who && !when) return null;
  return (
    <InfoCell label={label}>
      {/* A name is a value like any other — 600, like every value on the
          sheet. At 700 it was heavier than the section heading above it. */}
      <span className="pr-value-text">{who?.name || '—'}</span>
      {when && <div className="pr-subtext">{fmtDateTime(when)}</div>}
      {extra && <div className="pr-subtext" style={{ color: 'var(--danger)' }}>{extra}</div>}
    </InfoCell>
  );
}

/* ---- Section header: icon + bold uppercase title + rule extending right ---- */
function SectionHeader({ title }) {
  const Icon = SECTION_ICONS[title] || FileText;
  return (
    <div className="pr-section-header sec-head">
      <Icon size={14} />
      <span>{title}</span>
    </div>
  );
}

function InfoGrid({ children }) {
  return <div className="pr-info-grid">{children}</div>;
}

function mediaUrl(e) {
  return e?.url || e?.secureUrl || e?.previewUrl || '';
}

/* In-page preview: opens the selected media inside a modal on the same page
   (image/video/audio render inline; other file types embed in an <iframe>). */
function MediaPreviewModal({ entry, onClose }) {
  if (!entry) return null;
  const url = mediaUrl(entry);
  const name = entry.originalName || entry.name || 'file';
  const kind = fileKind(entry);
  return (
    <Modal open onClose={onClose} title={name} subtitle={entry.mimetype || ''} width={880}>
      <div className="center" style={{ minHeight: 240 }}>
        {!url ? (
          <div className="pr-empty-note">Preview not available for this file.</div>
        ) : kind === 'image' ? (
          <img src={url} alt={name} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8 }} />
        ) : kind === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={url} controls autoPlay style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8, background: '#000' }} />
        ) : kind === 'audio' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio src={url} controls style={{ width: '100%' }} />
        ) : (
          <iframe src={url} title={name} style={{ width: '100%', height: '70vh', border: 'none', borderRadius: 8 }} />
        )}
      </div>
    </Modal>
  );
}

function MediaTable({ entries, onOpen }) {
  if (!entries.length) {
    return <div className="pr-empty-note">No files in this category.</div>;
  }
  return (
    <table className="pr-media-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Size</th>
          <th>Uploaded On</th>
          <th>Uploaded By</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => {
          const url = mediaUrl(e);
          const name = e.originalName || e.name || 'file';
          return (
          <tr key={e.publicId || i}>
            <td>
              {url ? (
                <button
                  type="button"
                  onClick={() => onOpen(e)}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    /* Same trap as LocationValue above: the `font` shorthand
                       would reset the size the media table sets. */
                    color: '#1d4ed8', fontWeight: 600, textAlign: 'left', fontFamily: 'inherit', fontSize: 'inherit',
                  }}
                >
                  {name}
                </button>
              ) : (
                name
              )}
            </td>
            <td>{e.mimetype || '—'}</td>
            <td>{fmtFileSize(e.bytes ?? e.size)}</td>
            <td>—</td>
            <td>—</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MediaSection({ fields, values }) {
  const [tab, setTab] = useState('image');
  const [preview, setPreview] = useState(null);
  const entries = fields.flatMap((f) => {
    const v = values[f.key];
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    return arr;
  });
  const byKind = {
    image: entries.filter((e) => fileKind(e) === 'image'),
    document: entries.filter((e) => fileKind(e) === 'document'),
    video: entries.filter((e) => fileKind(e) === 'video'),
    audio: entries.filter((e) => fileKind(e) === 'audio'),
  };

  if (!entries.length) {
    return <div className="pr-empty-note">No media uploaded.</div>;
  }

  return (
    <div>
      <div className="pr-media-tabs no-print">
        {MEDIA_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pr-media-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <t.icon size={13} /> {t.label} ({byKind[t.key].length})
          </button>
        ))}
      </div>
      {MEDIA_TABS.map((t) => (
        <div
          key={t.key}
          className="pr-media-group"
          style={{ display: tab === t.key ? 'block' : 'none' }}
        >
          <div className="pr-media-group-title">{t.label}</div>
          <MediaTable entries={byKind[t.key]} onOpen={setPreview} />
        </div>
      ))}
      <MediaPreviewModal entry={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/**
 * @param record      the p1 record, as the API returns it
 * @param schema      that stage's masterDataSchema (sections come from it)
 * @param heading     the sheet's title line
 * @param subheading  the line under it
 * @param headerExtra anything to print beside the title — the queue puts the
 *                    city and the live location there, because a report about
 *                    one site is read by people asking "where is it?" first
 */
export function PropertyReportSheet({
  record,
  schema = [],
  heading = 'Property Report',
  subheading = 'Property Information Report',
  headerExtra = null,
  style = null,
  /**
   * WHICH FORM THIS IS — the step key, which `FormSheetFrame` turns into the
   * name printed at the top ("Property Capture Form", "Assessment Form",
   * "Commercial Form"). The frame and the body are the same for all of them;
   * this is the only thing that changes, which is the whole point of the
   * client's ask. A sheet with no module of its own passes `framed={false}`
   * and keeps the plain heading it had.
   */
  module = 'property-capture',
  /* The row of facts on dotted leaders, under the title. Built from the record
     when the caller does not say — see `refRow`. */
  reference = null,
  signatures = ['Prepared by', 'Approved by'],
  flat = false,
  showStatus = true,
  aside = undefined,
  title = undefined,
}) {
  if (!record) return null;

  const meta = RECORD_STATUS_META[record.status] || { label: record.status, color: '#7c7784' };
  const values = record.values || {};
  const sections = groupBySection(schema);

  /* Only the audit rows that actually happened — an empty "Rejected By" on a
     live property is a question the reader has to stop and answer. */
  const auditEntries = [
    { label: 'Created By', who: record.createdBy, when: record.createdAt },
    { label: 'Submitted By', who: record.submittedBy, when: record.submittedAt },
    { label: 'Shortlisted By', who: record.shortlistedBy, when: record.shortlistedAt },
    { label: 'Last Updated By', who: record.updatedBy, when: record.updatedAt },
    { label: 'Approved By', who: record.approvedBy, when: record.approvedAt },
    {
      label: 'Rejected By',
      who: record.rejectedBy,
      when: record.rejectedAt,
      extra: record.rejectReason ? `Reason: ${record.rejectReason}` : null,
    },
  ].filter((e) => e.who || e.when);

  /**
   * THE REFERENCE ROW — the reference form's "Date / SL NO / Order No", said
   * in the terms this system actually has. Dated by when the form was FILED
   * rather than when it was printed: a printout is evidence of a submission,
   * and today's date on it tells the reader nothing about the submission.
   */
  const refRow = reference || [
    { label: 'Date', value: fmtDate(record.submittedAt || record.createdAt) },
    { label: 'Form No', value: record.code || (record._id ? String(record._id).slice(-8).toUpperCase() : '') },
    { label: 'Status', value: meta.label },
  ];

  /* Three callers flatten this sheet by passing a border-less, full-width
     `style` — they render it inside a dialog or a panel that already draws the
     paper. That is exactly what the frame calls `flat`, so it is read off the
     style rather than made a second thing every caller has to remember. */
  const isFlat = flat || Boolean(style);

  return (
    <>
      <style>{`
        .pr-info-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px 24px;
        }
        @media (max-width: 1024px) {
          .pr-info-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 480px) {
          .pr-info-grid { grid-template-columns: 1fr; }
        }
        /* ONE SCALE, DECLARED IN form-sheet.css AND OBEYED HERE.
           A label used to be 11px/700 and its value 14.5px/600 — the label was
           the BOLDER of the two, so the eye had to work out which line was the
           question and which the answer on every cell. The label is lighter
           and smaller now and the value carries the weight, which is the whole
           of what makes a label read as a label. */
        .pr-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .pr-label {
          font-size: 11.5px; font-weight: 800; line-height: 1.35;
          text-transform: uppercase; letter-spacing: 0.05em; color: #1e3a8a;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .pr-value { line-height: 1.45; }
        .pr-value-text { font-size: 13.5px; font-weight: 600; color: #111827; }
        .pr-empty-value { font-size: 13.5px; font-weight: 500; color: #9CA3AF; }
        /* Secondary: the datetime under a name, the "last updated" line. */
        .pr-subtext { font-size: 11.5px; font-weight: 500; line-height: 1.4; color: #6B7280; margin-top: 1px; }
        /* The look of a section heading is the shared .sec-head class (globals.css) -
           the same bar the capture form uses. Only the SPACING is the report's:
           room above so a heading reads as the start of something rather than
           the last line of what came before it. */
        .pr-section-header { margin-top: 22px; margin-bottom: 10px; }
        .pr-empty-note { font-size: 11.5px; font-weight: 500; line-height: 1.4; color: #9CA3AF; font-style: italic; padding: 4px 0 2px; }
        .pr-media-tabs { display: flex; gap: 18px; border-bottom: 1px solid #E5E7EB; margin-bottom: 14px; }
        .pr-media-tab {
          display: inline-flex; align-items: center; gap: 6px;
          padding-bottom: 9px; font-size: 12.5px; font-weight: 600; color: #6B7280;
          background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
        }
        .pr-media-tab.active { color: #1d4ed8; border-bottom-color: #1d4ed8; }
        .pr-media-group-title { font-size: 11.5px; font-weight: 600; color: #4B5563; margin-bottom: 6px; }
        .pr-media-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        /* A column head is a label, so it is sized as one. */
        .pr-media-table th {
          text-align: left; padding: 6px 10px; font-size: 11.5px; font-weight: 600;
          line-height: 1.35; text-transform: uppercase; letter-spacing: 0.05em; color: #1e3a8a;
          background: #eff6ff;
          border-bottom: 1px solid #bfdbfe;
        }
        .pr-media-table td {
          padding: 7px 10px; font-size: 13px; font-weight: 500; line-height: 1.45;
          color: #1F2937; border-bottom: 1px solid #F1F5F9;
        }
        @media print {
          @page { size: A4; margin: 16mm; }
          body, .main, .content { background: #fff !important; padding: 0 !important; margin: 0 !important; }
          .pr-sheet {
            border: none !important; max-width: 100% !important; width: 100% !important;
            padding: 0 !important; margin: 0 !important;
          }
          .pr-section { page-break-inside: avoid; }
          .pr-media-group { display: block !important; margin-bottom: 14px; }
        }
      `}</style>

      <FormSheetFrame
        module={module}
        title={title}
        /* WHAT THE FORM IS CALLED comes from the module; what THIS one is
           about is the property. They were one line before, which is why the
           sheet could say "relinent plaza" at the top and never say what kind
           of document the reader was holding. */
        subject={heading}
        status={showStatus ? <Badge color={meta.color}>{meta.label}</Badge> : null}
        reference={refRow}
        aside={aside !== undefined ? aside : (
          <>
            <b style={{ display: 'block', color: '#1e3a8a', fontSize: 12 }}>{subheading}</b>
            {record.code ? <span>Ref {record.code}</span> : null}
          </>
        )}
        signatures={signatures}
        flat={isFlat}
      >
        {headerExtra}

        {auditEntries.length > 0 && (
          <div className="pr-section">
            <SectionHeader title="Audit" />
            <InfoGrid>
              {auditEntries.map((e) => (
                <AuditCell key={e.label} label={e.label} who={e.who} when={e.when} extra={e.extra} />
              ))}
            </InfoGrid>
          </div>
        )}

        {sections.map((section) => {
          if (section.title === 'Media') {
            return (
              <div key={section.title} className="pr-section">
                <SectionHeader title="Media" />
                <MediaSection fields={section.fields} values={values} />
              </div>
            );
          }
          if (section.title === 'Notes') {
            const notesField = section.fields[0];
            const noteText = notesField ? values[notesField.key] : null;
            return (
              <div key={section.title} className="pr-section">
                <SectionHeader title="Notes" />
                {noteText ? (
                  <>
                    <p style={{ fontSize: 13.5, fontWeight: 500, color: '#374151', lineHeight: 1.45, margin: '0 0 4px' }}>{noteText}</p>
                    <span className="pr-subtext">Last updated {fmtDateTime(record.updatedAt)}</span>
                  </>
                ) : (
                  <div className="pr-empty-note">No notes recorded.</div>
                )}
              </div>
            );
          }
          return (
            <div key={section.title} className="pr-section">
              <SectionHeader title={section.title} />
              <InfoGrid>
                {section.fields.map((f) => (
                  <InfoCell key={f.key} label={f.label}>
                    <FieldValue field={f} value={values[f.key]} />
                  </InfoCell>
                ))}
              </InfoGrid>
            </div>
          );
        })}
      </FormSheetFrame>
    </>
  );
}

export { groupBySection, SectionHeader, InfoGrid, InfoCell, FieldValue };
export default PropertyReportSheet;
