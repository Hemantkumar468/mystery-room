/**
 * The CV, on screen, without leaving the candidate.
 *
 * Screening is a two-window job — the CV in one, the pipeline in the other —
 * and every context switch is a chance to lose which of eleven applicants you
 * were reading. So a PDF opens in place, beside everything else about them.
 *
 * WORD FILES ARE NOT PREVIEWED, deliberately. A browser cannot render .doc or
 * .docx, and the honest answer is a download button rather than an embed that
 * shows a blank rectangle and looks broken. Roughly one CV in five is Word.
 */
import { useState } from 'react';
import { FileText, Download, ExternalLink, X } from 'lucide-react';

/** Word and PDF arrive from the same field; only one of them can be shown. */
const isPdf = (url) => /\.pdf(\?|#|$)/i.test(String(url || ''));

export function CvPreview({ url, name = 'CV' }) {
  const [open, setOpen] = useState(false);
  if (!url) return null;

  const pdf = isPdf(url);

  return (
    <>
      <div className="row gap-2 wrap">
        {pdf && (
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => setOpen(true)}>
            <FileText size={13} /> Read the CV here
          </button>
        )}
        <a className={`btn btn-sm ${pdf ? 'btn-ghost' : 'btn-subtle'}`} href={url} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Open in a new tab
        </a>
        {/* `download` is a hint the browser may ignore for a cross-origin file
            (the CV lives on S3), so this is also a plain working link rather
            than a button that does nothing when the hint is refused. */}
        <a className="btn btn-ghost btn-sm" href={url} download target="_blank" rel="noreferrer">
          <Download size={13} /> Download
        </a>
      </div>

      {!pdf && (
        <span className="tiny muted">
          This CV is a Word file, so it cannot be shown here — open or download it above.
        </span>
      )}

      {open && (
        <div className="cv-overlay" role="dialog" aria-modal="true" aria-label={`${name} preview`}>
          <div className="cv-frame">
            <div className="cv-frame-head">
              <span className="sm" style={{ fontWeight: 650 }}>{name}</span>
              <div className="row gap-2">
                <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> New tab
                </a>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setOpen(false)} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            </div>
            {/* An <object> rather than an <iframe>: when it cannot render the
                PDF it shows the children below, where an iframe would leave a
                blank white rectangle that reads as a broken page. */}
            <object className="cv-object" data={url} type="application/pdf" aria-label={name}>
              <div className="cv-fallback">
                {/* Two different failures land here — a browser that will not
                    render PDFs inline, and a file that could not be fetched —
                    and <object> gives no way to tell them apart. Naming only
                    one of them would send people looking in the wrong place. */}
                <p className="sm">The CV could not be shown here.</p>
                <p className="tiny muted">Either this browser will not display PDFs inline, or the file could not be reached.</p>
                <a className="btn btn-primary btn-sm" href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> Open it in a new tab
                </a>
              </div>
            </object>
          </div>
          <button type="button" className="cv-backdrop" onClick={() => setOpen(false)} aria-label="Close preview" />
        </div>
      )}
    </>
  );
}

export default CvPreview;
