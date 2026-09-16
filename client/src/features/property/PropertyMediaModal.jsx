import { useState } from 'react';
import {
  Image as ImageIcon, Video, FileText, Music, Link2, ExternalLink, Download,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';

/**
 * Everything attached to one property — the photos, the walkthrough videos,
 * the documents, and the Drive links a franchisee sent instead of uploading a
 * 400MB file.
 *
 * WHY A PREVIEW AND NOT A LIST OF LINKS. The question somebody asks of this is
 * "what does the shop look like?", and a column of blue URLs does not answer
 * it. Photos render as a grid you can click through; everything that cannot be
 * shown inline (a document, a Drive folder) is a labelled row that opens in a
 * new tab, so it is honest about what it is rather than pretending to preview.
 *
 * Nothing here is re-hosted. These are the URLs as submitted, which is what
 * keeps the owner of that Drive in control of their own files.
 */
const KIND = {
  photo: { icon: ImageIcon, label: 'Photos' },
  video: { icon: Video, label: 'Videos' },
  document: { icon: FileText, label: 'Documents' },
  audio: { icon: Music, label: 'Audio' },
  link: { icon: Link2, label: 'Drive links' },
};

const ORDER = ['photo', 'video', 'document', 'audio', 'link'];

/** A filename worth showing, or the last meaningful bit of the URL. */
const nameOf = (f, i) => f.name || (() => {
  try {
    const tail = decodeURIComponent(new URL(f.url).pathname.split('/').filter(Boolean).pop() || '');
    return tail || `${f.kind} ${i + 1}`;
  } catch { return `${f.kind} ${i + 1}`; }
})();

export function PropertyMediaModal({ row, onClose }) {
  const files = row.media?.files || [];
  const [lightbox, setLightbox] = useState(null);

  const byKind = ORDER
    .map((kind) => ({ kind, items: files.filter((f) => f.kind === kind) }))
    .filter((g) => g.items.length);

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title}
      subtitle={[row.city, row.locality].filter(Boolean).join(' · ') || 'Attachments'}
      width={720}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="col gap-3">
        {/* The property's own details, because somebody opening the photos is
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
          /* Says so plainly. A property with nothing attached is a normal
             state, not an error, and the reader needs to know they have seen
             everything rather than wonder whether it failed to load. */
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

              {kind === 'photo' ? (
                <div className="pm-grid">
                  {items.map((f, i) => (
                    <button key={f.url + i} type="button" className="pm-thumb" onClick={() => setLightbox(f)}>
                      {/* A dead link says so. These URLs redirect to presigned
                          S3 objects that expire, so a blank white box is a
                          real state and it must not look like a loading one. */}
                      <img
                        src={f.url}
                        alt={nameOf(f, i)}
                        loading="lazy"
                        onError={(e) => { e.currentTarget.closest('.pm-thumb')?.classList.add('is-broken'); }}
                      />
                      <span className="pm-thumb-fail">Preview unavailable — open it</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="col gap-1">
                  {items.map((f, i) => (
                    <a key={f.url + i} className="pm-row" href={f.url} target="_blank" rel="noreferrer">
                      <Icon size={14} />
                      <span className="pm-row-name">{nameOf(f, i)}</span>
                      <ExternalLink size={12} className="pm-row-go" />
                    </a>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* One photo, full size, over the dialog. Clicking anywhere closes it —
          a lightbox that needs its own close button found first is a lightbox
          people get stuck in. */}
      {lightbox && (
        <div className="pm-lightbox" onClick={() => setLightbox(null)} role="presentation">
          <img src={lightbox.url} alt={lightbox.name || 'Property photo'} />
          <a
            className="pm-lightbox-open"
            href={lightbox.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={13} /> Open original
          </a>
        </div>
      )}
    </Modal>
  );
}

export default PropertyMediaModal;
