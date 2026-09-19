import { useEffect, useState } from 'react';
import {
  Image as ImageIcon, Video, FileText, Music, Link2, ExternalLink,
  Maximize2, Minimize2, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';

/**
 * Everything attached to one property — as a LIST OF LINKS, with a preview
 * that opens over it.
 *
 * WHY LINKS AND NOT A WALL OF THUMBNAILS. Every one of these is an object in
 * our own S3 behind a signed URL, and a grid of them means the browser fetches
 * every photo of every property the moment somebody glances at the row —
 * megabytes to answer a question they have not asked yet. A named line per
 * file answers "what came with this property?" immediately and costs nothing;
 * the bytes are only fetched for the one file somebody clicks.
 *
 * THE PREVIEW IS SMALL FIRST, BIG ON REQUEST. Clicking a line opens it inside
 * this dialog at a size that still leaves the list readable — because the next
 * thing people do is look at the next photo, and a full-screen viewer that has
 * to be dismissed between each one turns five photos into ten clicks. Enlarge
 * fills the screen for the one that deserves it, ← → walk the set, and "Open
 * original" hands over the real file.
 *
 * Nothing here is re-hosted. These are the URLs as stored, which is what keeps
 * whoever owns that Drive folder in control of their own files.
 */
const KIND = {
  photo: { icon: ImageIcon, label: 'Photos', viewable: true },
  video: { icon: Video, label: 'Videos', viewable: true },
  document: { icon: FileText, label: 'Documents', viewable: false },
  audio: { icon: Music, label: 'Audio', viewable: true },
  link: { icon: Link2, label: 'Drive links', viewable: false },
};

const ORDER = ['photo', 'video', 'document', 'audio', 'link'];

/** A filename worth showing, or the last meaningful bit of the URL. */
export const fileNameOf = (f, i = 0) => f.name || (() => {
  try {
    const tail = decodeURIComponent(new URL(f.url, window.location.origin).pathname.split('/').filter(Boolean).pop() || '');
    return tail || `${f.kind} ${i + 1}`;
  } catch { return `${f.kind} ${i + 1}`; }
})();

/** An image by extension, whatever the record filed it under — a photo
 *  uploaded through the Documents field is still a photo to look at. */
const looksLikeImage = (f) => /\.(png|jpe?g|gif|webp|bmp|avif)(\?|$)/i.test(f.url || '');
const looksLikeVideo = (f) => /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(f.url || '');
const looksLikeAudio = (f) => /\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(f.url || '');

/**
 * One file, previewed in place.
 *
 * `index` walks the whole attachment list rather than one kind's, so ← →
 * cross from the last photo into the videos instead of dead-ending.
 */
export function MediaPreview({ files, index, onIndex, onClose }) {
  const [big, setBig] = useState(false);
  const file = files[index];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (big) setBig(false); else onClose(); }
      if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big, index, files.length, onIndex, onClose]);

  if (!file) return null;
  const isImage = file.kind === 'photo' || looksLikeImage(file);
  const isVideo = file.kind === 'video' || looksLikeVideo(file);
  const isAudio = file.kind === 'audio' || looksLikeAudio(file);

  return (
    <div className={`mv${big ? ' is-big' : ''}`} role="dialog" aria-label={fileNameOf(file, index)}>
      <div className="mv-bar">
        <span className="mv-name" title={fileNameOf(file, index)}>{fileNameOf(file, index)}</span>
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
        {isImage ? (
          /* A dead link says so. These URLs point at S3 objects behind signed
             access that expires, so a blank white box is a real state and must
             not be mistaken for a slow one. */
          <img
            src={file.url}
            alt={fileNameOf(file, index)}
            onError={(e) => { e.currentTarget.closest('.mv-stage')?.classList.add('is-broken'); }}
          />
        ) : isVideo ? (
          <video src={file.url} controls preload="metadata" />
        ) : isAudio ? (
          <audio src={file.url} controls />
        ) : (
          <div className="mv-noview">
            <FileText size={22} />
            <b>This one opens in its own tab</b>
            <span>A document or an outside link — nothing useful can be shown inside a box this size.</span>
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

/** `startAt` opens straight on one file — the link that was clicked in the
 *  sheet. Null opens the list. */
export function PropertyMediaModal({ row, startAt = null, onClose }) {
  const files = row.media?.files || [];
  const [at, setAt] = useState(startAt);

  const byKind = ORDER
    .map((kind) => ({ kind, items: files.map((f, i) => ({ f, i })).filter(({ f }) => f.kind === kind) }))
    .filter((g) => g.items.length);

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title}
      subtitle={[row.city, row.locality].filter(Boolean).join(' · ') || 'Attachments'}
      width={720}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span className="tiny muted">
            {files.length
              ? `${files.length} file${files.length === 1 ? '' : 's'} — click one to preview it here`
              : 'Nothing attached'}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="col gap-3">
        {/* The property's own details, because somebody opening the files is
            usually deciding on the property and should not have to hold the
            carpet area in their head from the row behind the dialog. */}
        <div className="pm-facts">
          {[
            ['Carpet area', row.areaSqft ? `${Number(row.areaSqft).toLocaleString('en-IN')} sq ft` : null],
            ['Floor', row.floor],
            ['Ownership', row.ownership],
            ['Submitted by', row.submittedByName],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="pm-fact"><span>{k}</span><b>{v}</b></div>
          ))}
        </div>

        {row.address && <p className="pm-address">{row.address}</p>}
        {row.remarks && <p className="pm-remarks">“{row.remarks}”</p>}

        {files.length === 0 ? (
          <div className="pm-none">
            <ImageIcon size={20} />
            <b>Nothing attached to this property</b>
            <span>No photos, videos or documents came with the submission.</span>
          </div>
        ) : byKind.map(({ kind, items }) => {
          const { icon: Icon, label } = KIND[kind];
          return (
            <section key={kind} className="col gap-2">
              <span className="pm-head"><Icon size={13} /> {label} · {items.length}</span>
              <div className="col gap-1">
                {items.map(({ f, i }) => (
                  <div key={f.url + i} className={`pm-row${at === i ? ' is-open' : ''}`}>
                    <Icon size={14} />
                    <button
                      type="button"
                      className="pm-row-name pm-row-link"
                      onClick={() => setAt(i)}
                      title="Preview it here"
                    >
                      {fileNameOf(f, i)}
                    </button>
                    <a
                      className="pm-row-go"
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the original in a new tab"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

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
