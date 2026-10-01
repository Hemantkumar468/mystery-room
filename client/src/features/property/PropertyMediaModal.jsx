import { useEffect, useState } from 'react';
import {
  ExternalLink, Maximize2, Minimize2, ChevronLeft, ChevronRight, X, FileText,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { ASSESSMENTS, DOCUMENTS } from '../../app/api/propertyCaptureApi.js';
import { fileTypeOf, fileMetaOf, fileSizeText } from './fileTypes.js';

/**
 * PROPERTY DOCUMENTS — one plain list of everything filed against a property,
 * and a viewer that opens over it.
 *
 * ONE LIST, NOT SECTIONS OR CARDS. The previous version grouped files under
 * headings by the form they came with and led with a block of the property's
 * own facts (carpet area, floor, ownership, remarks). All of it true, none of
 * it what somebody pressing "View Documents" is after: they want the files.
 * So a row is an icon, a name, what kind of file it is, how big, and an
 * action — and which form it came with is a quiet word on the second line,
 * not a heading that splits the list.
 *
 * WHY LINKS AND NOT A WALL OF THUMBNAILS. Every one of these is an object in
 * our own S3 behind a signed URL, and a grid of them means the browser fetches
 * every photo of every property the moment somebody glances at the row.
 * A named line per file costs nothing; the bytes are fetched only for the
 * file somebody opens.
 *
 * THE VIEWER OPENS INSIDE THIS DIALOG, so the property page behind it is
 * never lost. Images, video, audio and PDFs are shown in place; Word, Excel
 * and the rest cannot be rendered by a browser and are handed to it to open
 * or download, which is what the application has always done with them.
 *
 * Nothing here is re-hosted. These are the URLs as stored, which is what keeps
 * whoever owns that Drive folder in control of their own files.
 */

/** A filename worth showing, or the last meaningful bit of the URL. */
export const fileNameOf = (f, i = 0) => f.name || (() => {
  try {
    const tail = decodeURIComponent(new URL(f.url, window.location.origin).pathname.split('/').filter(Boolean).pop() || '');
    return tail || `${f.kind} ${i + 1}`;
  } catch { return `${f.kind} ${i + 1}`; }
})();

/**
 * EVERYTHING FILED AGAINST ONE PROPERTY, in the order somebody would look.
 *
 * The viewer used to open on `row.media` alone, which is what came in with the
 * CAPTURE — the photos, the owner's documents. A property with a signed lease,
 * a survey from the feasibility expert and three NOC certificates held all of
 * that in the database and showed none of it here.
 *
 * Returned as sections (so each file can say which form it came with) and as
 * ONE flat array (so the preview's arrows walk every file in the order the
 * list shows them, and an index means the same thing in both places).
 *
 * `onlyMedia` is the escape hatch for a row-shaped stand-in: the per-assessment
 * document cells build one carrying a single assessment's media, and that must
 * open that assessment's files, not the whole property's.
 */
export function collectPropertyFiles(row) {
  const withGroup = (list, group) => (list || []).map((f) => ({ ...f, group }));
  const sections = [];
  const add = (label, list) => {
    const files = withGroup(list, label);
    if (files.length) sections.push({ label, files });
  };

  add(row?.onlyMedia ? 'Attachments' : 'Property capture', row?.media?.files);

  if (!row?.onlyMedia) {
    for (const a of row?.assessments || []) {
      const label = ASSESSMENTS.find((x) => x.key === a.type)?.label || a.type;
      add(`${label} assessment`, a.media?.files);
    }
    for (const d of row?.documents || []) {
      /* NOCs are listed below, one section per permit — their `documents` entry
         is only the best-ranked one of several, and would show one certificate
         twice. */
      if (d.type === 'nocs') continue;
      const label = DOCUMENTS.find((x) => x.key === d.type)?.label
        || (d.type ? d.type.charAt(0).toUpperCase() + d.type.slice(1) : 'Document');
      add(label, d.media?.files);
    }
    for (const n of row?.nocList || []) add(n.nocType || 'NOC', n.media?.files);
  }

  const files = sections.flatMap((x) => x.files);
  return { sections, files };
}

/** Sources that say nothing a reader does not already know. */
const PLAIN_SOURCES = new Set(['Property capture', 'Attachments']);

/**
 * One file, previewed in place.
 *
 * `index` walks the whole attachment list rather than one kind's, so ← →
 * cross from the last photo into the videos instead of dead-ending.
 */
export function MediaPreview({ files, index, onIndex, onClose }) {
  /* OPENS LARGE. This started small so the list stayed readable beside it, but
     the thing somebody clicked a document for is to read it — and a lease at
     400px wide is not readable. Shrink is one click for the person who is
     walking through photos and wants the list back. */
  const [big, setBig] = useState(true);
  const file = files[index];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        /* THE VIEWER OWNS ESCAPE WHILE IT IS OPEN. `Modal` listens for it on
           `window` as well, so one press used to shrink the preview AND close the
           whole Documents dialog under it — and the viewer is a layer ON the
           list, so closing it must land you back on the list. Listening in the
           CAPTURE phase and stopping the event means the dialog never sees it. */
        e.stopPropagation();
        if (big) setBig(false); else onClose();
      }
      if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [big, index, files.length, onIndex, onClose]);

  if (!file) return null;
  const type = fileTypeOf(file);
  const meta = fileMetaOf(file);
  const name = fileNameOf(file, index);

  return (
    <div className={`mv${big ? ' is-big' : ''}`} role="dialog" aria-label={name}>
      <div className="mv-bar">
        <span className="mv-name" title={name}>{name}</span>
        <span className="mv-of">{index + 1} of {files.length}</span>
        <button type="button" className="mv-btn" onClick={() => onIndex(index - 1)} disabled={index === 0} title="Previous (←)">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="mv-btn" onClick={() => onIndex(index + 1)} disabled={index >= files.length - 1} title="Next (→)">
          <ChevronRight size={14} />
        </button>
        <button type="button" className="mv-btn" onClick={() => setBig((b) => !b)} title={big ? 'Shrink' : 'Enlarge'}>
          {big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <a className="mv-btn" href={file.url} target="_blank" rel="noreferrer" title="Open the original file">
          <ExternalLink size={14} />
        </a>
        <button type="button" className="mv-btn" onClick={onClose} title="Close (Esc)"><X size={14} /></button>
      </div>

      <div className="mv-stage">
        {type === 'image' ? (
          /* A dead link says so. These URLs point at S3 objects behind signed
             access that expires, so a blank white box is a real state and must
             not be mistaken for a slow one. */
          <img
            src={file.url}
            alt={name}
            onError={(e) => { e.currentTarget.closest('.mv-stage')?.classList.add('is-broken'); }}
          />
        ) : type === 'video' ? (
          <video src={file.url} controls preload="metadata" />
        ) : type === 'audio' ? (
          <audio src={file.url} controls />
        ) : type === 'pdf' ? (
          /* SHOWN, NOT HANDED OFF. A PDF is the commonest closure document and
             the browser can display it itself. */
          <iframe title={name} src={file.url} className="mv-pdf" />
        ) : (
          <div className="mv-noview">
            <FileText size={22} />
            <b>{meta.label} files open in their own tab</b>
            <span>A browser cannot show this kind of file inside the page. Open it to read or download it.</span>
            <a className="btn btn-primary btn-sm" href={file.url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Open it
            </a>
          </div>
        )}
        <span className="mv-fail">Preview unavailable — open the original.</span>
      </div>
    </div>
  );
}

/** `startAt` opens straight on one file. Null — the default — opens the list. */
export function PropertyMediaModal({ row, startAt = null, onClose }) {
  const { files } = collectPropertyFiles(row);
  const [at, setAt] = useState(startAt);

  return (
    <Modal
      open
      onClose={onClose}
      title="Property Documents"
      subtitle={[row.title, row.city].filter(Boolean).join(' · ') || undefined}
      width={640}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span className="tiny muted">
            {files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    >
      {files.length === 0 ? (
        <p className="pdocs-none">No documents have been submitted for this property yet.</p>
      ) : (
        <ul className="pdocs">
          {files.map((f, i) => {
            const meta = fileMetaOf(f);
            const Icon = meta.icon;
            const size = fileSizeText(f);
            const source = f.group && !PLAIN_SOURCES.has(f.group) ? f.group : null;
            const name = fileNameOf(f, i);
            return (
              <li key={f.url + i} className={`pdocs-row${at === i ? ' is-open' : ''}`}>
                <span className="pdocs-ico" style={{ '--tone': meta.tone }}><Icon size={16} /></span>
                <span className="pdocs-main">
                  {meta.inline ? (
                    <button type="button" className="pdocs-name" onClick={() => setAt(i)} title={name}>{name}</button>
                  ) : (
                    <a className="pdocs-name" href={f.url} target="_blank" rel="noreferrer" title={name}>{name}</a>
                  )}
                  <span className="pdocs-meta">{[meta.label, size, source].filter(Boolean).join(' · ')}</span>
                </span>
                {meta.inline ? (
                  <button type="button" className="pdocs-act" onClick={() => setAt(i)}>View</button>
                ) : (
                  <a className="pdocs-act" href={f.url} target="_blank" rel="noreferrer">Open</a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {at != null && (
        <MediaPreview
          files={files}
          index={at}
          onIndex={(i) => setAt(Math.max(0, Math.min(files.length - 1, i)))}
          onClose={() => setAt(null)}
        />
      )}
    </Modal>
  );
}

export default PropertyMediaModal;
