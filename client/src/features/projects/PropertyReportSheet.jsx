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
        style={{ color: 'var(--primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
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
      <span className="pr-value-text" style={{ fontWeight: 700 }}>{who?.name || '—'}</span>
      {when && <div className="pr-subtext">{fmtDateTime(when)}</div>}
      {extra && <div className="pr-subtext" style={{ color: 'var(--danger)' }}>{extra}</div>}
    </InfoCell>
  );
}

/* ---- Section header: icon + bold uppercase title + rule extending right ---- */
function SectionHeader({ title }) {
  const Icon = SECTION_ICONS[title] || FileText;
  return (
    <div className="pr-section-header">
      <Icon size={14} />
      <span>{title}</span>
      <div className="pr-section-rule" />
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
                    color: 'var(--primary)', fontWeight: 500, textAlign: 'left', font: 'inherit',
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
        .pr-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .pr-label {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.07em; color: #6B7280;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .pr-value { line-height: 1.4; }
        .pr-value-text { font-size: 14.5px; font-weight: 600; color: #111827; }
        .pr-empty-value { font-size: 14.5px; color: #9CA3AF; }
        .pr-subtext { font-size: 11px; color: #6B7280; margin-top: 1px; }
        .pr-section-header {
          display: flex; align-items: center; gap: 8px;
          padding-top: 22px; padding-bottom: 8px; color: #374151;
        }
        .pr-section-header svg { flex-shrink: 0; opacity: 0.8; }
        .pr-section-header span {
          font-size: 13px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; white-space: nowrap;
        }
        .pr-section-rule { flex: 1; height: 1px; background: #D1D5DB; }
        .pr-empty-note { font-size: 12.5px; color: #9CA3AF; font-style: italic; padding: 4px 0 2px; }
        .pr-media-tabs { display: flex; gap: 18px; border-bottom: 1px solid #E5E7EB; margin-bottom: 14px; }
        .pr-media-tab {
          display: inline-flex; align-items: center; gap: 6px;
          padding-bottom: 9px; font-size: 12.5px; font-weight: 650; color: #6B7280;
          background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
        }
        .pr-media-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
        .pr-media-group-title { font-size: 11.5px; font-weight: 700; color: #4B5563; margin-bottom: 6px; }
        .pr-media-table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 4px; }
        .pr-media-table th {
          text-align: left; padding: 6px 10px; font-size: 10.5px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em; color: #6B7280;
          border-bottom: 1px solid #D1D5DB;
        }
        .pr-media-table td {
          padding: 7px 10px; color: #1F2937; border-bottom: 1px solid #F1F5F9;
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

      <div
        className="pr-sheet"
        style={style || { background: '#fff', border: '1px solid #E2E8F0', maxWidth: 900, margin: '0 auto', padding: '36px 44px 44px' }}
      >
        <div style={{ borderBottom: '2px solid #1A202C', paddingBottom: 16, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: 0, textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
            {heading}
          </h1>
          <span style={{ fontSize: 12.5, color: '#6B7280', fontWeight: 600 }}>{subheading}</span>
          {headerExtra}
        </div>

        <div className="pr-section">
          <SectionHeader title="Status" />
          <Badge color={meta.color}>{meta.label}</Badge>
        </div>

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
                    <p style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6, margin: '0 0 4px' }}>{noteText}</p>
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
      </div>
    </>
  );
}

export { groupBySection, SectionHeader, InfoGrid, InfoCell, FieldValue };
export default PropertyReportSheet;
