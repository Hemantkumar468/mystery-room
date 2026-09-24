import { useRef, useState } from 'react';
import { Paperclip, X, FileText, Loader2 } from 'lucide-react';
import { uploadFiles } from '../../lib/opsQueries.js';
import { errMsg } from '../../lib/opsUi.js';
import { toast } from './toast.jsx';

const nameOf = (url) => decodeURIComponent(String(url).split('/').pop() || 'file');
const isImage = (url) => /\.(png|jpe?g|gif|webp)$/i.test(url);

/** Upload evidence / proof / references; value is a list of URLs. */
export function FileUploader({ value = [], onChange, multiple = true, label = 'Attach files', accept }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const uploaded = await uploadFiles(files);
      const urls = uploaded.map((f) => f.url);
      onChange(multiple ? [...value, ...urls] : urls.slice(0, 1));
    } catch (e) {
      toast.error(errMsg(e, 'Upload failed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="col gap-2">
      <div className="row gap-2 wrap">
        {value.map((url) => (
          <span key={url} className="file-chip">
            {isImage(url) ? <img src={url} alt="" /> : <FileText size={14} />}
            <a href={url} target="_blank" rel="noreferrer" className="truncate">{nameOf(url)}</a>
            <X size={13} className="subtle" style={{ cursor: 'pointer' }} onClick={() => onChange(value.filter((u) => u !== url))} />
          </span>
        ))}
        {(multiple || !value.length) && (
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} />} {busy ? 'Uploading…' : label}
          </button>
        )}
      </div>
      <input ref={input} type="file" hidden multiple={multiple} accept={accept} onChange={(e) => pick(e.target.files)} />
    </div>
  );
}

/** Read-only attachment list. */
export function Attachments({ urls = [] }) {
  if (!urls?.length) return null;
  return (
    <div className="row gap-2 wrap">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="file-chip">
          {isImage(url) ? <img src={url} alt="" /> : <FileText size={14} />}
          <span className="truncate">{nameOf(url)}</span>
        </a>
      ))}
    </div>
  );
}

export default FileUploader;
