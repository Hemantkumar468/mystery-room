import { useState } from 'react';
import {
  PlayCircle, Film, Plus, X, Upload, Loader2, CheckCircle2, XCircle, Link2, FileText, ExternalLink, Users,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { FileUploader } from '../../components/ops/FileUploader.jsx';
import { PeoplePicker } from '../settings/FmsAssignPage.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  uploadGameVideos,
  useCreateNewGameMutation, useUpdateNewGameMutation,
  useAddNewGameBoqMutation, useUpdateNewGameBoqMutation,
  useDecideNewGameBoqMutation, useCompleteNewGameStepMutation, useAssignNewGameStepMutation,
  useGetNewGamePeopleQuery, useWatchNewGameMutation,
} from '../../app/api/newGamesApi.js';

/* ── small shared pieces ────────────────────────────────────────────────── */

export const fmtD = (d) => (d ? fmtDate(d) : '—');
export const fmtDT = (d) => (d ? fmtDateTime(d) : '—');
export const money = (n) => (n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

/** The Purchase FMS's own categories, so a BOQ lands there without translation. */
export const BOQ_CATEGORIES = ['Electrical', 'Furniture', 'Game Props', 'AV', 'IT & Networking', 'Civil', 'Painting', 'Signage', 'Other'];

/** The Property FMS's own pill colours, one per state. */
const STATE = {
  done: { label: 'Done', tone: 'p-green' },
  ready: { label: 'To do', tone: 'p-blue' },
  late: { label: 'Late', tone: 'p-red' },
  waiting: { label: 'Waiting', tone: 'p-grey' },
};

export function StatePill({ state, done, lateDays, label }) {
  const m = STATE[state] || STATE.waiting;
  const text = label || (state === 'done' && done ? done : m.label);
  return (
    <span className={`pc2-pill ${m.tone}`}>
      {text}
      {state === 'late' && lateDays > 0 ? ` · ${lateDays}d` : ''}
    </span>
  );
}

const BOQ_STATUS = {
  submitted: { label: 'To check', tone: 'p-amber' },
  approved: { label: 'Approved', tone: 'p-green' },
  rejected: { label: 'Rejected', tone: 'p-red' },
};
export function BoqStatus({ boq }) {
  const m = BOQ_STATUS[boq.status] || BOQ_STATUS.submitted;
  return <span className={`pc2-pill ${m.tone}`}>{m.label}</span>;
}

/** Where a Purchase line has got to, in the same colours. */
export function LineStatus({ line }) {
  const tone = line.cancelled ? 'p-grey'
    : line.stage === 'short' ? 'p-red'
      : line.grnDone ? 'p-green'
        : line.po ? 'p-purple'
          : line.vendor ? 'p-blue' : 'p-amber';
  return <span className={`pc2-pill ${tone}`}>{line.label}</span>;
}

export function People({ list, empty = 'Nobody yet' }) {
  const people = (list || []).filter(Boolean);
  if (!people.length) return <span className="ng-muted">{empty}</span>;
  return (
    <span className="ng-people">
      {people.map((p) => (
        <span key={p.id} className="ng-person" title={p.title || p.name}>
          <b>{p.name}</b>{p.title && <em> · {p.title}</em>}
        </span>
      ))}
    </span>
  );
}

/* ── the video and its files ────────────────────────────────────────────── */

const VIDEO_RX = /\.(mp4|mov|webm|m4v|avi|mkv|wmv|flv|3gp|3g2|mpe?g|ogv|ts|mts|m2ts|vob)(\?|$)/i;
/** What a browser plays inline without a plug-in. */
const PLAYABLE_RX = /\.(mp4|webm|m4v|mov|ogv)(\?|$)/i;
export const isVideoFile = (f) => VIDEO_RX.test(f?.name || f?.url || '');
export const isPlayable = (f) => PLAYABLE_RX.test(f?.url || '') || PLAYABLE_RX.test(f?.name || '');

const hostOf = (url) => {
  if (/youtu\.?be/i.test(url)) return 'YouTube';
  if (/drive\.google|docs\.google/i.test(url)) return 'Drive';
  return 'Video link';
};

/**
 * A link that can be played inside the page: YouTube and Google Drive both
 * publish an embeddable player. Anything else opens in a new tab.
 */
export function embedOf(url) {
  const s = String(url || '');
  const yt = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const drive = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{10,})/i);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  return null;
}

/**
 * Every way to watch the game's video — each link and each uploaded file — as
 * a button that opens it; documents get their own button, named.
 */
export function VideoLinks({ game, empty = 'No video' }) {
  const links = game?.videoLinks || [];
  const files = game?.videoFiles || [];
  if (!links.length && !files.length) return <span className="ng-muted">{empty}</span>;
  return (
    <span className="ng-videos">
      {links.map((url) => (
        <a key={url} className="ng-vbtn" href={url} target="_blank" rel="noreferrer" title={url} onClick={(e) => e.stopPropagation()}>
          <PlayCircle size={13} aria-hidden /> {hostOf(url)}
        </a>
      ))}
      {files.map((f) => (isVideoFile(f) ? (
        <a key={f.url} className="ng-vbtn is-file" href={f.url} target="_blank" rel="noreferrer" title={f.name || 'Video'} onClick={(e) => e.stopPropagation()}>
          <Film size={13} aria-hidden /> Video file
        </a>
      ) : (
        <a key={f.url} className="ng-vbtn is-doc" href={f.url} target="_blank" rel="noreferrer" title={f.name || 'Document'} onClick={(e) => e.stopPropagation()}>
          <FileText size={13} aria-hidden /> {f.name ? (f.name.length > 22 ? `${f.name.slice(0, 20)}…` : f.name) : 'Document'}
        </a>
      )))}
    </span>
  );
}

const sizeOf = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const youtubeId = (url) => (String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i) || [])[1];

/**
 * THE VIDEO AND ITS FILES AS CARDS — what a watcher sees on their task.
 *
 * One card per link and per upload, each saying what it is and with its own
 * button: Watch plays it in the popup (YouTube, Drive and the browser's own
 * formats), Open takes it to its own tab. A YouTube link shows its thumbnail,
 * so the right video is recognisable before anything is pressed.
 */
export function VideoCards({ game, onWatch }) {
  const links = game?.videoLinks || [];
  const files = game?.videoFiles || [];
  if (!links.length && !files.length) return <p className="ng-muted">No video or file was attached to this indent.</p>;
  return (
    <div className="ng-vcards">
      {links.map((url) => {
        const yt = youtubeId(url);
        const host = hostOf(url);
        return (
          <div key={url} className="ng-vcard">
            <div
              className={`ng-vcard-thumb${yt ? ' has-img' : ' is-link'}`}
              style={yt ? { backgroundImage: `url(https://img.youtube.com/vi/${yt}/mqdefault.jpg)` } : undefined}
            >
              <PlayCircle size={30} aria-hidden />
            </div>
            <div className="ng-vcard-body">
              <b>{host === 'Video link' ? 'Reference video' : `${host} video`}</b>
              <span title={url}>{url.replace(/^https?:\/\//, '')}</span>
            </div>
            <div className="ng-vcard-acts">
              {embedOf(url) && onWatch && (
                <button type="button" className="pc2-act a-view" onClick={onWatch}><PlayCircle size={13} /> Watch</button>
              )}
              <a className="pc2-act" href={url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>
            </div>
          </div>
        );
      })}
      {files.map((f) => {
        const video = isVideoFile(f);
        return (
          <div key={f.url} className="ng-vcard">
            <div className={`ng-vcard-thumb ${video ? 'is-video' : 'is-doc'}`}>
              {video ? <Film size={28} aria-hidden /> : <FileText size={28} aria-hidden />}
            </div>
            <div className="ng-vcard-body">
              <b title={f.name}>{f.name || (video ? 'Video file' : 'Document')}</b>
              <span>{video ? 'Uploaded video' : 'Document'}{f.size ? ` · ${sizeOf(f.size)}` : ''}</span>
            </div>
            <div className="ng-vcard-acts">
              {video && isPlayable(f) && onWatch && (
                <button type="button" className="pc2-act a-view" onClick={onWatch}><PlayCircle size={13} /> Play</button>
              )}
              <a className="pc2-act" href={f.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const errText = (e) => e?.data?.message || e?.message || 'Something went wrong — please try again.';

/**
 * WATCH VIDEO — the video, the game, who else is watching, and the button that
 * finishes the task, in one place. YouTube and Drive links play inside the
 * popup; uploaded videos play in the page's own player; any other link and
 * every document open beside it.
 */
export function WatchModal({ game, canMark, onClose }) {
  const [watch, state] = useWatchNewGameMutation();
  const s = game.steps.video;
  const embeds = (game.videoLinks || []).map((url) => ({ url, src: embedOf(url) }));
  const playable = (game.videoFiles || []).filter(isPlayable);
  const others = [
    ...embeds.filter((e) => !e.src).map((e) => ({ url: e.url, name: `Watch on ${hostOf(e.url)}`, link: true })),
    ...(game.videoFiles || []).filter((f) => !isPlayable(f)),
  ];

  const mark = async () => {
    try {
      await watch(game.id).unwrap();
      flashSuccess('Marked as watched — this task is complete');
      onClose();
    } catch { /* toasted centrally */ }
  };

  return (
    <Modal
      open
      onClose={state.isLoading ? undefined : onClose}
      title={`Watch the video · ${game.name}`}
      subtitle={`${game.code} · watch by ${fmtDT(s.plan)}`}
      width={880}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose} disabled={state.isLoading}>Close</button>
          {canMark && (
            <button type="button" className="btn ng-btn-approve" onClick={mark} disabled={state.isLoading}>
              {state.isLoading ? <span className="spinner" /> : <><CheckCircle2 size={15} /> Mark Task Completed</>}
            </button>
          )}
        </div>
      )}
    >
      <div className="ng-review">
        {embeds.filter((e) => e.src).map((e) => (
          <iframe
            key={e.url}
            className="ng-embed"
            src={e.src}
            title={`${game.name} — video`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ))}
        {playable.map((f) => (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={f.url} className="ng-player" src={f.url} controls preload="metadata" />
        ))}
        {others.length > 0 && (
          <div className="ng-videos">
            {others.map((o) => (
              <a key={o.url} className={`ng-vbtn${o.link ? '' : isVideoFile(o) ? ' is-file' : ' is-doc'}`} href={o.url} target="_blank" rel="noreferrer">
                <ExternalLink size={13} aria-hidden /> {o.name || 'Open'}
              </a>
            ))}
          </div>
        )}
        {!embeds.length && !(game.videoFiles || []).length && <p className="ng-muted">No video was attached to this indent.</p>}

        {game.concept && <p className="ng-note"><b>The game:</b> {game.concept}</p>}

        <div className="ng-watchers">
          <h4><Users size={13} aria-hidden /> Assigned to watch — {s.watchedCount} of {s.watcherCount} watched</h4>
          <ul>
            {s.rows.filter((r) => r.stillAssigned).map((r) => (
              <li key={r.person?.id}>
                <span><b>{r.person?.name}</b>{r.person?.title && <em> · {r.person.title}</em>}</span>
                <span>{r.doneAt ? <span className="ng-ok"><CheckCircle2 size={12} /> {fmtDT(r.doneAt)}</span> : <StatePill state={r.state} lateDays={r.lateDays} />}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/* ── Step 1 · the indent form ───────────────────────────────────────────── */

/** Two working days out at 6 pm — the design's two days, as a starting point. */
function defaultWatchBy() {
  const d = new Date();
  let left = 2;
  while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0) left -= 1; }
  d.setHours(18, 0, 0, 0);
  return d;
}
/** A Date as the value a `datetime-local` input wants, in local time. */
const toLocalInput = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};

const blankIndent = () => ({
  name: '', concept: '', playersMin: '', playersMax: '', durationMinutes: '',
  location: '', priority: 'high', watchBy: toLocalInput(defaultWatchBy()),
  videoLinks: [''], videoFiles: [], watchers: [],
});

/**
 * THE INDENT — kept to what the flow needs. The name, what the game is, the
 * video everyone watches in Step 2 (a link, an upload, or both — any video or
 * document), who watches it and by when. Players and duration are optional and
 * carry into the Games master.
 */
export function IndentModal({ game, onClose, onSaved }) {
  const editing = Boolean(game);
  const [f, setF] = useState(() => (editing ? {
    ...blankIndent(),
    name: game.name, concept: game.concept,
    playersMin: game.playersMin ?? '', playersMax: game.playersMax ?? '', durationMinutes: game.durationMinutes ?? '',
    location: game.location, priority: game.priority,
    watchBy: game.watchBy ? toLocalInput(game.watchBy) : toLocalInput(defaultWatchBy()),
    videoLinks: game.videoLinks?.length ? game.videoLinks : [''],
    videoFiles: game.videoFiles || [],
  } : blankIndent()));
  const [err, setErr] = useState('');
  const [upBusy, setUpBusy] = useState(false);
  const [upPct, setUpPct] = useState(0);
  const { data: people = [] } = useGetNewGamePeopleQuery(undefined, { skip: editing });
  const [create, createState] = useCreateNewGameMutation();
  const [update, updateState] = useUpdateNewGameMutation();
  const busy = createState.isLoading || updateState.isLoading || upBusy;

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setLink = (i, v) => setF((x) => ({ ...x, videoLinks: x.videoLinks.map((l, j) => (j === i ? v : l)) }));

  const onUpload = async (files) => {
    if (!files?.length) return;
    setErr('');
    setUpBusy(true);
    setUpPct(0);
    try {
      const got = await uploadGameVideos(files, setUpPct);
      setF((x) => ({ ...x, videoFiles: [...x.videoFiles, ...got] }));
    } catch (e) {
      setErr(e?.response?.data?.message || 'The file could not be uploaded.');
    } finally {
      setUpBusy(false);
    }
  };

  const submit = async () => {
    setErr('');
    const links = f.videoLinks.map((l) => l.trim()).filter(Boolean);
    if (!f.name.trim()) return setErr('Give the game a name.');
    if (links.some((l) => !/^https?:\/\//i.test(l))) return setErr('A video link must start with https:// — paste the full YouTube or Drive address.');
    if (!links.length && !f.videoFiles.length) return setErr('Add the reference video — paste a link or upload the file.');
    if (!f.watchBy) return setErr('Choose the date and time the video must be watched by.');
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      name: f.name.trim(), concept: f.concept || null,
      playersMin: n(f.playersMin), playersMax: n(f.playersMax), durationMinutes: n(f.durationMinutes),
      location: f.location || null, priority: f.priority, videoLinks: links, videoFiles: f.videoFiles,
      watchBy: new Date(f.watchBy).toISOString(),
    };
    try {
      if (editing) {
        await update({ id: game.id, ...body }).unwrap();
        flashSuccess('Indent updated');
      } else {
        const made = await create({ ...body, watchers: f.watchers }).unwrap();
        flashSuccess(`${made.code} filed — the FMS has started for ${made.name}`);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
    return undefined;
  };

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={editing ? `Edit indent · ${game.code}` : 'Step 1 · Indent form'}
      subtitle={editing ? game.name : 'Submitting it starts the New Games FMS for this game'}
      width={640}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {createState.isLoading || updateState.isLoading ? <span className="spinner" /> : editing ? 'Save indent' : 'Submit indent form'}
          </button>
        </div>
      )}
    >
      <div className="ng-form">
        <label className="ng-field ng-span2">
          <span>Game name *</span>
          <input className="input" value={f.name} onChange={set('name')} placeholder="e.g. The Lost Temple" maxLength={120} />
        </label>
        <label className="ng-field ng-span2">
          <span>Game concept &amp; what is needed</span>
          <textarea className="input" rows={3} value={f.concept || ''} onChange={set('concept')} placeholder="Theme, story, puzzles, room size…" maxLength={4000} />
        </label>

        <div className="ng-field ng-span2">
          <span>Reference video — link (YouTube, Drive…)</span>
          {f.videoLinks.map((l, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className="ng-linkrow">
              <Link2 size={14} aria-hidden className="ng-muted" />
              <input className="input" value={l} onChange={(e) => setLink(i, e.target.value)} placeholder="https://" />
              {f.videoLinks.length > 1 && (
                <button type="button" className="ng-icon" aria-label="Remove link" onClick={() => setF((x) => ({ ...x, videoLinks: x.videoLinks.filter((_, j) => j !== i) }))}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="ng-textbtn" onClick={() => setF((x) => ({ ...x, videoLinks: [...x.videoLinks, ''] }))}>
            <Plus size={13} /> Add another link
          </button>
        </div>

        <div className="ng-field ng-span2">
          <span>…or upload the video and documents (any video, PDF, Word, Excel, images — up to 200 MB each)</span>
          <div className="ng-uploads">
            {f.videoFiles.map((v) => (
              <span key={v.url} className="ng-upchip">
                {isVideoFile(v) ? <Film size={13} aria-hidden /> : <FileText size={13} aria-hidden />}
                <a href={v.url} target="_blank" rel="noreferrer">{v.name || 'File'}</a>
                <button type="button" className="ng-icon" aria-label={`Remove ${v.name || 'file'}`} onClick={() => setF((x) => ({ ...x, videoFiles: x.videoFiles.filter((y) => y.url !== v.url) }))}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <label className={`btn btn-subtle btn-sm${upBusy ? ' is-disabled' : ''}`}>
              {upBusy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
              {upBusy ? ` Uploading… ${upPct}%` : ' Upload files'}
              <input type="file" hidden disabled={upBusy} multiple onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
        </div>

        {!editing && (
          <div className="ng-field ng-span2">
            <span>Who should watch the video (Step 2)</span>
            <PeoplePicker value={f.watchers} people={people} onChange={(v) => setF((x) => ({ ...x, watchers: v }))} placeholder="Add people" />
            <em className="ng-hint">Leave empty to use Settings → FMS · Assign Work.</em>
          </div>
        )}

        <label className="ng-field">
          <span>Watch by — date &amp; time *</span>
          <input className="input" type="datetime-local" value={f.watchBy} onChange={set('watchBy')} />
          <em className="ng-hint">The plan date for Step 2 — everyone assigned watches it by then.</em>
        </label>
        <label className="ng-field">
          <span>Priority</span>
          <select className="select" value={f.priority} onChange={set('priority')}>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>

        <div className="ng-field">
          <span>Players</span>
          <div className="ng-inline">
            <input className="input" type="number" min={0} value={f.playersMin} onChange={set('playersMin')} placeholder="Min" />
            <span className="ng-muted">–</span>
            <input className="input" type="number" min={0} value={f.playersMax} onChange={set('playersMax')} placeholder="Max" />
          </div>
        </div>
        <label className="ng-field">
          <span>Duration (minutes)</span>
          <input className="input" type="number" min={0} value={f.durationMinutes} onChange={set('durationMinutes')} placeholder="60" />
        </label>
        <label className="ng-field ng-span2">
          <span>For which franchise / location (optional)</span>
          <input className="input" value={f.location || ''} onChange={set('location')} placeholder="Leave empty if it is for every franchise" maxLength={160} />
        </label>

        {err && <div className="ng-err ng-span2">{err}</div>}
      </div>
    </Modal>
  );
}

/* ── Step 3 · one BOQ ───────────────────────────────────────────────────── */

export function BoqModal({ game, boq, onClose }) {
  const editing = Boolean(boq);
  const [f, setF] = useState(() => ({
    name: boq?.name || '', category: boq?.category || '', leadTimeDays: boq?.leadTimeDays ?? '',
    deadline: boq?.deadline ? String(boq.deadline).slice(0, 10) : '', estimatedCost: boq?.estimatedCost ?? '',
    items: boq?.items || '', notes: boq?.notes || '', files: (boq?.files || []).map((x) => x.url),
  }));
  const [err, setErr] = useState('');
  const [add, addState] = useAddNewGameBoqMutation();
  const [save, saveState] = useUpdateNewGameBoqMutation();
  const busy = addState.isLoading || saveState.isLoading;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    setErr('');
    if (!f.name.trim()) return setErr('Name the BOQ — e.g. “Electronics BOQ”.');
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      name: f.name.trim(), category: f.category || null, leadTimeDays: n(f.leadTimeDays),
      deadline: f.deadline || null, estimatedCost: n(f.estimatedCost), items: f.items || null, notes: f.notes || null,
      files: f.files.map((url) => ({ url, name: decodeURIComponent(String(url).split('/').pop() || 'file') })),
    };
    try {
      if (editing) {
        await save({ id: game.id, boqId: boq.id, ...body }).unwrap();
        flashSuccess(boq.status === 'rejected' ? 'BOQ corrected — sent back for checking' : 'BOQ saved');
      } else {
        await add({ id: game.id, ...body }).unwrap();
        flashSuccess('BOQ added — it is waiting for the check');
      }
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
    return undefined;
  };

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={editing ? `Edit BOQ · ${boq.name}` : 'Step 3 · Add a BOQ'}
      subtitle={`${game.name} · ${game.code}`}
      width={620}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : editing && boq.status === 'rejected' ? 'Save & resubmit' : editing ? 'Save BOQ' : 'Submit BOQ'}
          </button>
        </div>
      )}
    >
      <div className="ng-form">
        {boq?.status === 'rejected' && boq.reason && (
          <div className="ng-err ng-span2"><b>Rejected:</b> {boq.reason}</div>
        )}
        <label className="ng-field ng-span2">
          <span>BOQ name *</span>
          <input className="input" value={f.name} onChange={set('name')} placeholder="e.g. Electronics BOQ" maxLength={160} />
        </label>
        <label className="ng-field">
          <span>Category</span>
          <select className="select" value={f.category} onChange={set('category')}>
            <option value="">Choose…</option>
            {BOQ_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="ng-field">
          <span>Lead time (days)</span>
          <input className="input" type="number" min={0} value={f.leadTimeDays} onChange={set('leadTimeDays')} placeholder="e.g. 7" />
        </label>
        <label className="ng-field">
          <span>Deadline</span>
          <input className="input" type="date" value={f.deadline} onChange={set('deadline')} />
        </label>
        <label className="ng-field">
          <span>Estimated cost (₹)</span>
          <input className="input" type="number" min={0} value={f.estimatedCost} onChange={set('estimatedCost')} placeholder="0" />
        </label>
        <label className="ng-field ng-span2">
          <span>Items — one per line: item, quantity, unit, rate</span>
          <textarea className="input" rows={5} value={f.items} onChange={set('items')} placeholder={'Arduino Mega controller, 3, nos, 1200\nRFID reader module, 6, nos, 450\nMagnetic lock 12V, 8, nos'} maxLength={4000} />
          <em className="ng-hint">Each line becomes one Purchase line with its quantity once the BOQ is approved.</em>
        </label>
        <label className="ng-field ng-span2">
          <span>Notes</span>
          <textarea className="input" rows={2} value={f.notes} onChange={set('notes')} maxLength={2000} />
        </label>
        <div className="ng-field ng-span2">
          <span>BOQ sheet / attachments</span>
          <FileUploader value={f.files} onChange={(v) => setF((x) => ({ ...x, files: v }))} label="Attach BOQ file" />
        </div>
        {err && <div className="ng-err ng-span2">{err}</div>}
      </div>
    </Modal>
  );
}

/* ── Step 4 · Check / Review ────────────────────────────────────────────── */

export function ReviewModal({ game, boq, onClose, canDecide }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [decide, state] = useDecideNewGameBoqMutation();
  const open = boq.status === 'submitted';

  const rule = async (decision) => {
    setErr('');
    if (decision === 'reject' && !reason.trim()) return setErr('Write why it is rejected — the BOQ maker needs the reason.');
    try {
      const g = await decide({ id: game.id, boqId: boq.id, decision, reason: reason.trim() || undefined }).unwrap();
      flashSuccess(decision === 'approve'
        ? (g?.steps?.order?.purchaseProject && !game.steps?.order?.purchaseProject
          ? 'Every BOQ approved — sent to the Purchase FMS at Vendor finalisation'
          : `${boq.name} approved`)
        : `${boq.name} rejected — sent back to the BOQ maker`);
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
    return undefined;
  };

  return (
    <Modal
      open
      onClose={state.isLoading ? undefined : onClose}
      title={`Check / Review · ${boq.name}`}
      subtitle={`${game.name} · ${game.code}`}
      width={620}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose} disabled={state.isLoading}>Close</button>
          {open && canDecide && (
            <>
              <button type="button" className="btn ng-btn-reject" onClick={() => rule('reject')} disabled={state.isLoading}>
                <XCircle size={15} /> Reject
              </button>
              <button type="button" className="btn ng-btn-approve" onClick={() => rule('approve')} disabled={state.isLoading}>
                <CheckCircle2 size={15} /> Approve
              </button>
            </>
          )}
        </div>
      )}
    >
      <div className="ng-review">
        <div className="ng-kv">
          <span>Status</span><span><BoqStatus boq={boq} /></span>
          <span>Category</span><span>{boq.category || '—'}</span>
          <span>Lead time</span><span>{boq.leadTimeDays != null ? `${boq.leadTimeDays} days` : '—'}</span>
          <span>Deadline</span><span>{fmtD(boq.deadline)}</span>
          <span>Estimated cost</span><span>{money(boq.estimatedCost)}</span>
          <span>Made by</span><span>{boq.createdBy?.name || '—'} · {fmtDT(boq.createdAt)}</span>
          {boq.decidedAt && (<><span>{boq.status === 'approved' ? 'Approved by' : 'Rejected by'}</span><span>{boq.decidedBy?.name || '—'} · {fmtDT(boq.decidedAt)}</span></>)}
        </div>
        {boq.items && (<><h4>Items</h4><pre className="ng-items">{boq.items}</pre></>)}
        {boq.notes && (<><h4>Notes</h4><p className="ng-note">{boq.notes}</p></>)}
        {boq.files?.length > 0 && (
          <div className="ng-videos">
            {boq.files.map((x) => <a key={x.url} className="ng-vbtn is-doc" href={x.url} target="_blank" rel="noreferrer"><FileText size={13} /> {x.name || 'Attachment'}</a>)}
          </div>
        )}
        {boq.reason && <div className={boq.status === 'rejected' ? 'ng-err' : 'ng-note'}><b>Reason:</b> {boq.reason}</div>}
        {open && canDecide && (
          <label className="ng-field">
            <span>Remark (needed to reject)</span>
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </label>
        )}
        {open && !canDecide && <p className="ng-muted">Only the BOQ checker or a manager can approve or reject it.</p>}
        {err && <div className="ng-err">{err}</div>}
      </div>
    </Modal>
  );
}

/* ── assign one step of one game ────────────────────────────────────────── */

export function AssignModal({ game, step, stepLabel, onClose }) {
  const current = (step === 'video' ? game.steps.video.doers : game.steps[step].doers).filter(Boolean).map((p) => p.id);
  const [doers, setDoers] = useState(current);
  const [err, setErr] = useState('');
  const { data: people = [] } = useGetNewGamePeopleQuery();
  const [assign, state] = useAssignNewGameStepMutation();

  const submit = async () => {
    setErr('');
    try {
      await assign({ id: game.id, step, doers }).unwrap();
      flashSuccess(`${stepLabel} assigned for ${game.name}`);
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <Modal
      open
      onClose={state.isLoading ? undefined : onClose}
      title={`Assign · ${stepLabel}`}
      subtitle={`${game.name} · ${game.code}`}
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose} disabled={state.isLoading}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={state.isLoading}>
            {state.isLoading ? <span className="spinner" /> : 'Save'}
          </button>
        </div>
      )}
    >
      <div className="ng-form">
        <div className="ng-field ng-span2">
          <span>Who does this step for this game</span>
          <PeoplePicker value={doers} people={people} onChange={setDoers} placeholder="Add people" />
          <em className="ng-hint">Everyone added gets it in My Tasks. Leave empty to follow Settings → FMS · Assign Work.</em>
        </div>
        {err && <div className="ng-err ng-span2">{err}</div>}
      </div>
    </Modal>
  );
}

/* ── complete a step ────────────────────────────────────────────────────── */

export function DoneModal({ game, step, def, onClose }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [complete, state] = useCompleteNewGameStepMutation();
  const last = step === 'testing';

  const submit = async () => {
    setErr('');
    try {
      const g = await complete({ id: game.id, step, note: note.trim() || undefined }).unwrap();
      flashSuccess(g.status === 'complete' ? `${g.name} is finished — added to the Games master` : `${def.label} completed`);
      onClose(g);
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <Modal
      open
      onClose={state.isLoading ? undefined : () => onClose()}
      title={`Complete · ${def.label}`}
      subtitle={`${game.name} · ${game.code}`}
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={() => onClose()} disabled={state.isLoading}>Cancel</button>
          <button type="button" className="btn ng-btn-approve" onClick={submit} disabled={state.isLoading}>
            {state.isLoading ? <span className="spinner" /> : <><CheckCircle2 size={15} /> Complete Task</>}
          </button>
        </div>
      )}
    >
      <div className="ng-form">
        <p className="ng-note ng-span2">
          <b>{def.what}.</b> {def.how}.
          {last && ' Completing it finishes the game and adds it to the Games master, so every franchise can pick it.'}
          {step === 'check' && ' Completing it sends every approved BOQ to the Purchase FMS, at Vendor finalisation.'}
          {step === 'boq' && ' Completing it sends the BOQs to Step 4 for checking.'}
        </p>
        <label className="ng-field ng-span2">
          <span>Note (optional)</span>
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Anything the next step should know" />
        </label>
        {err && <div className="ng-err ng-span2">{err}</div>}
      </div>
    </Modal>
  );
}
