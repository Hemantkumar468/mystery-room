import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search, AlertTriangle, FileText, Upload, ClipboardCheck, Eye, Paperclip,
  Plus, MoreVertical, UserPlus, History as HistoryIcon, Play, Link2,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { OutsourcePanel } from '../projects/OutsourcePanel.jsx';
import { useGetOutsourceLinksQuery } from '../../app/api/outsourceApi.js';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { PropTable } from '../property/PropTable.jsx';
import { PropPager } from '../property/PropPager.jsx';
import { PageHead, PropEmpty } from '../property/propertyUi.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { useCreateRecord } from '../../app/api/recordsApi.js';
import {
  useGetFmsOverviewQuery, useGetFmsProjectQuery, useGetDrawingRevisionsQuery,
  useAssignDrawingMutation, useApproveDrawingMutation, useResendDrawingMutation,
} from '../../app/api/designDrawingsApi.js';
/* `property-capture.css` is already loaded globally by main.jsx — the `.prop-*`
   classes below come from there, not from a stylesheet this page owns. */

/**
 * Design & Drawings FMS — the three-step flow a drawing actually moves along.
 *
 *   1. Design Submission — not yet filed. Upload is one click and needs no
 *      drawing-picker: pressing THIS row's button already says which of the 37
 *      it is.
 *   2. Review & Handover — filed, awaiting a decision. Approve moves it on;
 *      Reject asks why and sends it back to step 1 as a new revision.
 *   3. Approved Designs — the terminal view over the same 37 rows.
 *
 * A row's step is never stored: it is read off its own status and approved
 * flag, the same way Purchase's `stageOf()` reads a BOQ line's stage.
 *
 * WHY IT BORROWS PROPERTY'S STYLESHEET. This is the same kind of screen as the
 * Property FMS — a stepper over a wide operational table — and the client asked
 * for the same treatment. Importing `property-capture.css` and using its
 * `.prop-*` classes means the two modules cannot drift: one gold, one cream,
 * one table, one pager, defined once. `PropTable`/`PropPager` come along for
 * the same reason.
 */

const STAGES = [
  { key: 'checklist', n: 1, title: 'Design Submission', desc: 'Upload against the 37-drawing checklist' },
  { key: 'review', n: 2, title: 'Review & Handover', desc: 'Filed — approve it or send it back' },
  { key: 'approved', n: 3, title: 'Approved Designs', desc: 'Signed off, the set the build works to' },
];

/** Which of the three steps a row is on right now. */
function rowStage(row) {
  if (row.approved) return 'approved';
  if (row.status === 'Submitted for review') return 'review';
  return 'checklist'; // Not started, In progress, or just sent back for changes
}

/**
 * The row's status chip. Same four real workflow states, but a "Not started"
 * row reads as "Not Submitted" once it is past its planned date and "Pending"
 * before that — presentation only, off two facts already on the row.
 *
 * Colours come from the Property module's own tag tokens so the two FMSs use
 * one palette; only the overdue red has no `--p-tag-*` of its own.
 */
function statusChip(row, nowMs) {
  if (row.status === 'Approved') return { label: 'Approved', bg: 'var(--p-tag-captured-bg)', fg: 'var(--p-tag-captured-fg)' };
  if (row.status === 'Submitted for review') return { label: 'Submitted', bg: 'var(--p-tag-captured-bg)', fg: 'var(--p-tag-captured-fg)' };
  if (row.status === 'In progress') return { label: 'In Progress', bg: 'var(--p-tag-wanted-bg)', fg: 'var(--p-tag-wanted-fg)' };
  const overdue = row.plannedDate && new Date(row.plannedDate).getTime() < nowMs;
  if (overdue) return { label: 'Not Submitted', bg: 'color-mix(in srgb, var(--danger) 15%, transparent)', fg: 'var(--danger)' };
  return { label: 'Pending', bg: 'var(--p-tag-neutral-bg)', fg: 'var(--p-tag-neutral-fg)' };
}

const Chip = ({ bg, fg, children }) => (
  <span className="prop-badge" style={{ background: bg, color: fg }}>{children}</span>
);

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
const VIDEO_RE = /\.(mp4|mov|webm|m4v|avi|mkv)$/i;

/**
 * What a file IS, so the UI can decide between an <img>, a <video> and a
 * download chip. The MIME the upload recorded wins; the extension is only the
 * fallback for files stored before the API sent one.
 */
function kindOf(f) {
  const mime = f?.mime || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime) return 'file';
  const n = f?.name || f?.url || '';
  if (IMAGE_RE.test(n)) return 'image';
  if (VIDEO_RE.test(n)) return 'video';
  return 'file';
}
const extOf = (f) => ((f?.name || '').split('.').pop() || 'file').slice(0, 4);
function sizeOf(f) {
  const b = f?.bytes;
  if (!b) return null;
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

/** One file, at full size — an image, a playable video, or a download card. */
function FileStage({ file }) {
  const kind = kindOf(file);
  if (kind === 'image') return <img src={file.url} alt={file.name} />;
  if (kind === 'video') {
    /* `controls` and nothing else: no autoplay, because a walkthrough video
       starting on its own while a reviewer reads the notes is the kind of
       thing that gets a feature turned off. */
    return <video src={file.url} controls preload="metadata" />;
  }
  return (
    <a className="dd-preview-file" href={file.url} target="_blank" rel="noreferrer">
      <Paperclip size={13} /> {file.name}{sizeOf(file) ? ` · ${sizeOf(file)}` : ''}
    </a>
  );
}

/**
 * Every file on the drawing, not just the first. A designer sends a plan, a
 * render and sometimes a walkthrough; showing one of them and silently hiding
 * the rest is how a reviewer approves a drawing they have not actually seen.
 */
function FileLinks({ files }) {
  /* Open on a file that can be SHOWN. A drawing is often filed as a DWG plus
     a render; landing on the DWG means the reviewer's first sight of the work
     is a download link. */
  const leadIndex = Math.max(0, (files || []).findIndex((f) => kindOf(f) !== 'file'));
  const [sel, setSel] = useState(leadIndex);
  if (!files?.length) return <span className="prop-dim">No file on record.</span>;
  const current = files[Math.min(sel, files.length - 1)];
  return (
    <div className="dd-preview">
      {files.length > 1 && (
        <div className="dd-gal-strip">
          {files.map((f, i) => (
            <button
              key={i}
              type="button"
              className={`dd-gal-tile${i === sel ? ' active' : ''}`}
              onClick={() => setSel(i)}
              title={f.name}
            >
              {kindOf(f) === 'image'
                ? <img src={f.url} alt="" />
                : <span className="dd-thumb-ext">{kindOf(f) === 'video' ? 'VIDEO' : extOf(f)}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="dd-gal-stage">
        <FileStage file={current} />
        <div className="dd-gal-meta">
          {files.length > 1 ? `${sel + 1} of ${files.length} · ` : ''}
          <a href={current.url} target="_blank" rel="noreferrer" style={{ color: 'var(--p-gold)' }}>{current.name}</a>
          {sizeOf(current) ? ` · ${sizeOf(current)}` : ''}
        </div>
      </div>
    </div>
  );
}

/** The table's file cell — the first previewable file, and how many there are. */
function FileCell({ files, onOpen }) {
  if (!files?.length) return <span className="prop-dim">—</span>;
  /* Lead with something that can actually be shown: if the plan is a DWG and
     the render beside it is a JPG, the JPG is the useful thumbnail. */
  const lead = files.find((f) => kindOf(f) === 'image') || files[0];
  const kind = kindOf(lead);
  return (
    <button
      type="button"
      className="dd-thumb"
      onClick={onOpen}
      title={files.map((f) => f.name).join('\n')}
      aria-label={`Preview ${files.length} file${files.length === 1 ? '' : 's'}`}
    >
      {kind === 'image' ? <img src={lead.url} alt="" /> : <span className="dd-thumb-ext">{kind === 'video' ? 'VID' : extOf(lead)}</span>}
      {kind === 'video' && <span className="dd-thumb-play"><Play size={14} /></span>}
      {files.length > 1 && <span className="dd-thumb-count">{files.length}</span>}
    </button>
  );
}

function FilePreviewModal({ row, onClose }) {
  const n = row.files?.length || 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Drawing file${n === 1 ? '' : 's'} — #${row.no} ${row.name}`}
      subtitle={n > 1 ? `${n} files on revision ${row.revision ?? '—'}` : undefined}
      width={820}
    >
      <div className="col gap-2">
        <div className="sm muted">
          Revision {row.revision ?? '—'} · filed {fmtDateTime(row.submittedAt)}
          {row.submittedBy ? ` by ${row.submittedBy.name}` : ''}
        </div>
        {row.remarks && <div className="sm">“{row.remarks}”</div>}
        <FileLinks files={row.files} />
      </div>
    </Modal>
  );
}

/** The ⋮ on each row: the actions that are not the step's main one. */
/** Why a cell shows a value nobody set on this drawing. */
const inheritHint = (row, what) => `The ${what} comes from the phase task "${row.fromTask}" `
  + '— set it here to override it for this one drawing';

/**
 * The muted second line under an inherited value.
 *
 * Inherited data has to SAY it is inherited. Presented bare it reads as a
 * decision somebody made about drawing #14, and the first person to disagree
 * with it goes looking for a per-drawing setting that was never written.
 */
function SubNote({ row, field, extra }) {
  const parts = [row.inherited?.[field] ? 'phase task' : null, extra].filter(Boolean);
  if (!parts.length) return null;
  return <div className="prop-dim" style={{ fontSize: 11 }}>{parts.join(' · ')}</div>;
}

/**
 * A blank that can be filled from where it is read.
 *
 * Assigned To, Designer / Owner and Planned Date are three faces of the one
 * DrawingPlan doc, so all three open the same modal. Until now the only way in
 * was the row's kebab menu, and 37 rows of "—" gave no hint that the blanks
 * were fillable at all — the table looked like a report, not a worksheet.
 */
function PlanCell({ value, empty, onOpen, hint }) {
  if (value) {
    return (
      <button type="button" className="dd-plan" onClick={onOpen} title={hint || 'Change who owns this and when it is due'}>
        {value}
      </button>
    );
  }
  return (
    <button type="button" className="dd-plan is-empty" onClick={onOpen} title="Nobody is on this yet — click to set it">
      <Plus size={11} /> {empty}
    </button>
  );
}

/**
 * Promised date vs the date it actually landed.
 *
 * Compared whole-day: the plan carries a date and an advisory time, so a
 * drawing filed at 23:00 on its planned day is on time, not an hour late.
 */
function lateness(row) {
  if (!row.plannedDate || !row.submittedAt) return null;
  const day = (d) => Math.floor(new Date(d).setHours(0, 0, 0, 0) / 86400000);
  const diff = day(row.submittedAt) - day(row.plannedDate);
  if (diff <= 0) return { late: false, label: 'On time' };
  return { late: true, label: `${diff} day${diff === 1 ? '' : 's'} late` };
}

function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        className="prop-open"
        style={{ padding: '6px 7px' }}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVertical size={13} />
      </button>
      {open && (
        <span
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20, minWidth: 168,
            display: 'flex', flexDirection: 'column', padding: 4, borderRadius: 9,
            background: 'var(--p-paper)', border: '1px solid var(--p-line)',
            boxShadow: '0 10px 28px -12px rgba(0,0,0,.28)',
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onClick(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6,
                border: 0, background: 'none', font: 'inherit', fontSize: 13, color: 'var(--p-text)',
                cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
              }}
            >
              <it.icon size={14} /> {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * Upload — the point of step 1.
 *
 * This is the PMS's OWN drawing form (`RecordFormModal`), not a second one
 * built here. Filing from the FMS and filing from the phase page therefore
 * produce the same record, validated by the same schema, with the same Save
 * Draft — there is no parallel write path to drift.
 *
 * What the FMS adds is the context the phase page has to ask for: the row you
 * pressed already answers "which drawing is this?" and "which revision?", so
 * both arrive seeded. They stay editable, exactly as PhasePage's own group
 * seeding does.
 *
 * `taskId` is the link the client asked for. Without it an entry belongs to no
 * task and the PMS task page can only show "everything filed on this phase" —
 * see Record.task. Set 1 rows file against the Phase 1 drawing task, Set 2
 * against the Phase 2 one, the same mapping the phase page's own lists use.
 */
function UploadModal({ row, pickFrom, onClose, onSaved }) {
  const [pickedNo, setPickedNo] = useState(row?.no || pickFrom?.[0]?.no || null);
  const target = row || (pickFrom || []).find((r) => r.no === Number(pickedNo));
  const projectId = target?.projectId;

  const { data: project } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const fullSchema = template?.stages?.find((s) => s.key === 'p11')?.masterDataSchema || [];
  /**
   * The fields the ROW already answered, hidden from this entry point.
   *
   * Opened from the phase page the form has to ask "which drawing is this?",
   * because nothing there has said. Opened from a checklist row, all four of
   * these are already decided — and `drawing_type` is worse than redundant:
   * it is the pre-checklist list (Layout Plan, Game Zoning, Electrical …),
   * so a row that IS "Floor layout plan with furniture" would be asked to
   * pick its type again from a coarser, older vocabulary.
   *
   * They are hidden, never dropped: `save` stamps every one of them below, so
   * the filed record is identical to one filed from the phase page.
   */
  const schema = fullSchema.filter((f) => ![
    'checklist_drawing', 'checklist_status', 'drawing_name', 'drawing_type',
    'revision_no',
  ].includes(f.key));

  /* R1 for the first filing, R2 for the next, and so on — counted from the
     records that exist, not typed. Two people who each believe they are
     filing "R2" is how a revision history stops being a history. */
  const nextRevision = (target?.revisions || 0) + 1;

  const { data: taskResp } = useTasks({ project: projectId, stageKey: 'p11', limit: 200 });
  const tasks = taskResp?.data || taskResp || [];
  const taskKey = target?.set === 2 ? 'p11_draw2' : 'p11_draw';
  const task = tasks.find((t) => t.templateTaskKey === taskKey) || null;

  const createRecord = useCreateRecord(projectId, 'p11');
  const [error, setError] = useState(null);

  const save = async ({ values, extraValues }, status) => {
    setError(null);
    try {
      const withTask = task?._id ? { taskId: task._id } : {};
      /* What the row already decided, stamped rather than asked. A draft is
         not "submitted for review" — saying so would put an unfinished
         drawing into the reviewer's step. */
      const fixed = {
        checklist_drawing: target.name,
        drawing_name: target.name,
        revision_no: nextRevision,
        checklist_status: status === 'draft' ? 'In progress' : 'Submitted for review',
      };
      await createRecord.mutateAsync({ values: { ...values, ...fixed }, status, ...withTask });
      for (const extra of extraValues || []) {
        // eslint-disable-next-line no-await-in-loop -- one record per extra value, in order
        await createRecord.mutateAsync({ values: { ...extra, ...fixed }, status, ...withTask });
      }
      flashSuccess(status === 'draft' ? 'Saved as draft' : 'Submitted for review');
      onSaved?.();
    } catch (e) {
      setError(e?.data?.message || e?.response?.data?.message || 'Could not save — try again.');
    }
  };

  /* Which drawing, when the toolbar's "Add Drawing" was used instead of a
     row's own button. Once chosen the real form opens seeded with it. */
  if (!row && !target) return null;
  if (!row && pickFrom && pickedNo == null) return null;

  /* `fullSchema`, not `schema`: an empty filtered list would mean the template
     defines nothing BUT the hidden fields, which is not "still loading". */
  if (!fullSchema.length) {
    return (
      <Modal open onClose={onClose} title="Upload a drawing">
        <div className="sm muted">Loading the drawing form…</div>
      </Modal>
    );
  }

  return (
    <>
      {!row && (
        <Modal open onClose={onClose} title="Which drawing?" width={520}>
          <label className="col gap-1">
            <span className="sm muted">Pick the checklist row this drawing answers</span>
            <select value={pickedNo || ''} onChange={(e) => setPickedNo(e.target.value)}>
              {(pickFrom || []).map((r) => <option key={r.no} value={r.no}>#{r.no} · {r.category} · {r.name}</option>)}
            </select>
          </label>
        </Modal>
      )}
      <RecordFormModal
        open
        onClose={onClose}
        schema={schema}
        recordNoun={`Drawing — #${target.no} ${target.name} · R${nextRevision}`}
        /* Nothing left to seed — every value the row already decides is
           stamped in `save`, so none of them can be edited into disagreement
           with the row they were filed against. */
        seedValues={{}}
        projectId={projectId}
        saving={createRecord.isPending}
        error={error}
        onSaveDraft={(payload) => save(payload, 'draft')}
        onSubmit={(payload) => save(payload, 'submitted')}
        documentRead={{ projectId, stageKey: 'p11' }}
      />
    </>
  );
}

/** Review — see the document and decide, in one place. */
function ReviewModal({ row, onClose, onDecided }) {
  const [approveDrawing, { isLoading: approving }] = useApproveDrawingMutation();
  const [resend, { isLoading: resending }] = useResendDrawingMutation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const doApprove = async () => {
    setError(null);
    try {
      await approveDrawing({ projectId: row.projectId, drawingNo: row.no }).unwrap();
      flashSuccess('Drawing approved');
      onDecided?.();
    } catch (e) {
      setError(e?.data?.message || 'Could not approve — try again.');
    }
  };

  const doReject = async () => {
    if (!reason.trim()) { setError('Say what needs to change.'); return; }
    setError(null);
    try {
      await resend({ projectId: row.projectId, drawingNo: row.no, reason }).unwrap();
      flashSuccess('Sent back for changes');
      onDecided?.();
    } catch (e) {
      setError(e?.data?.message || 'Could not send back — try again.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Review — #${row.no} ${row.name}`}
      footer={rejecting ? (
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={() => setRejecting(false)}>Back</button>
          <button type="button" className="btn btn-danger" onClick={doReject} disabled={resending}>
            {resending ? 'Sending…' : 'Confirm reject'}
          </button>
        </div>
      ) : (
        <div className="row gap-2">
          <button type="button" className="btn btn-danger" onClick={() => setRejecting(true)} disabled={approving}>Reject</button>
          <button type="button" className="btn btn-primary" onClick={doApprove} disabled={approving}>
            {approving ? 'Approving…' : 'Approve'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        <div className="sm muted">
          Revision {row.revision ?? '—'} · Submitted {fmtDateTime(row.submittedAt)}{row.submittedBy ? ` by ${row.submittedBy.name}` : ''}
        </div>
        {row.remarks && <div className="sm">“{row.remarks}”</div>}
        <div className="col gap-1">
          <span className="sm muted" style={{ fontWeight: 600 }}>Document{row.files?.length > 1 ? 's' : ''}</span>
          <FileLinks files={row.files} />
        </div>
        {rejecting && (
          <label className="col gap-1">
            <span className="sm muted">What needs to change?</span>
            <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required — the designer sees this." />
          </label>
        )}
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
      </div>
    </Modal>
  );
}

function AssignModal({ row, onClose, onSaved }) {
  const { employees } = useEmployees();
  const [assign, { isLoading }] = useAssignDrawingMutation();
  const [form, setForm] = useState({
    assignedTo: row.assignedTo?._id || '',
    designerOwner: row.designerOwner?._id || '',
    plannedDate: row.plannedDate ? row.plannedDate.slice(0, 10) : '',
    plannedTime: row.plannedTime || '',
    notes: row.notes || '',
  });
  const [error, setError] = useState(null);

  const save = async () => {
    setError(null);
    try {
      await assign({
        projectId: row.projectId,
        drawingNo: row.no,
        ...form,
        assignedTo: form.assignedTo || null,
        designerOwner: form.designerOwner || null,
        plannedDate: form.plannedDate || null,
      }).unwrap();
      flashSuccess('Assignment saved');
      onSaved?.();
    } catch (e) {
      setError(e?.data?.message || 'Could not save — try again.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Assign — #${row.no} ${row.name}`}
      footer={(
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={isLoading}>
            {isLoading ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        <label className="col gap-1">
          <span className="sm muted">Assigned To</span>
          <select value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}>
            <option value="">— Unassigned —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label className="col gap-1">
          <span className="sm muted">Designer / Owner</span>
          <select value={form.designerOwner} onChange={(e) => setForm((f) => ({ ...f, designerOwner: e.target.value }))}>
            <option value="">— Unassigned —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <div className="row gap-2">
          <label className="col gap-1" style={{ flex: 1 }}>
            <span className="sm muted">Planned Date</span>
            <input type="date" value={form.plannedDate} onChange={(e) => setForm((f) => ({ ...f, plannedDate: e.target.value }))} />
          </label>
          <label className="col gap-1" style={{ flex: 1 }}>
            <span className="sm muted">Planned Time</span>
            <input type="time" value={form.plannedTime} onChange={(e) => setForm((f) => ({ ...f, plannedTime: e.target.value }))} />
          </label>
        </div>
        <label className="col gap-1">
          <span className="sm muted">Notes</span>
          <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
      </div>
    </Modal>
  );
}

function HistoryModal({ row, onClose }) {
  const { data, isFetching } = useGetDrawingRevisionsQuery({ projectId: row.projectId, drawingNo: row.no });
  return (
    <Modal open onClose={onClose} title={`Revision history — #${row.no} ${row.name}`} width={640}>
      {isFetching ? <SkDetail /> : !data?.length ? (
        <div className="sm muted">Nothing has been filed against this drawing yet.</div>
      ) : (
        <div className="col gap-2">
          {data.map((r) => (
            <div key={r.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ fontSize: 13 }}>Revision {r.revision ?? '—'}</b>
                <span className="sm muted">{r.status}</span>
              </div>
              <div className="sm muted" style={{ marginTop: 6 }}>
                Submitted {fmtDateTime(r.submittedAt)}{r.submittedBy ? ` · ${r.submittedBy.name}` : ''}
              </div>
              {r.remarks && <div className="sm" style={{ marginTop: 2 }}>“{r.remarks}”</div>}
              {r.files?.length > 0 && <div style={{ marginTop: 6 }}><FileLinks files={r.files} /></div>}
              {r.approvedAt && (
                <div className="sm" style={{ color: 'var(--success)', marginTop: 6 }}>
                  Approved {fmtDateTime(r.approvedAt)}{r.approvedBy ? ` · ${r.approvedBy.name}` : ''}
                </div>
              )}
              {r.rejectedAt && (
                <div className="sm" style={{ color: 'var(--danger)', marginTop: 6 }}>
                  Sent back {fmtDateTime(r.rejectedAt)}{r.rejectedBy ? ` · ${r.rejectedBy.name}` : ''} — {r.rejectReason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function DesignDrawingsProjectPage() {
  /**
   * Two ways in, one screen: `/design-drawings/fms` (the sidebar tab, project
   * picked in-page) and `/design-drawings/:id` (drilled in from the dashboard).
   */
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { data: overview } = useGetFmsOverviewQuery();
  const [pickedId, setPickedId] = useState('');
  const id = routeId || pickedId || overview?.projects?.[0]?.id || '';
  const pickProject = (next) => (routeId ? navigate(`/design-drawings/${next}`) : setPickedId(next));

  const { data, isLoading, isError, refetch } = useGetFmsProjectQuery(id, { skip: !id });

  const [activeStage, setActiveStage] = useState('checklist');
  const [category, setCategory] = useState('all');
  const [phase, setPhase] = useState('all');
  const [assignedTo, setAssignedTo] = useState('all');
  const [designer, setDesigner] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  /* 50, not 25 — the checklist is 37 rows, and a default that split it left
     every Phase 2 drawing stranded on page 2 where nobody looked for it. */
  const [limit, setLimit] = useState(50);

  const [uploadRow, setUploadRow] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [reviewRow, setReviewRow] = useState(null);
  const [assignRow, setAssignRow] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);
  const [previewRow, setPreviewRow] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const now = Date.now();

  /* The designer links already issued for this project's drawings. Same
     store the phase page's own panel reads — this page does not mint its own
     kind of link, it shows the one the system already has. */
  const { data: linkResp } = useGetOutsourceLinksQuery({ projectId: id, stageKey: 'p11' }, { skip: !id });
  const links = linkResp?.data || linkResp || [];
  const liveLinks = useMemo(
    () => links.filter((l) => !l.revokedAt && (!l.expiresAt || new Date(l.expiresAt).getTime() > now)),
    [links, now],
  );
  /* A link is scoped to the phase, optionally narrowed to one of its lists —
     so a Set 1 row is covered by a Set 1 link or by a whole-phase one. */
  const linkForRow = (r) => liveLinks.find(
    (l) => !l.groupKey || l.groupKey === (r.set === 2 ? 'set_2' : 'set_1'),
  ) || null;

  const { data: pageTaskResp } = useTasks({ project: id, stageKey: 'p11', limit: 200 }, { enabled: !!id });
  const pageTasks = pageTaskResp?.data || pageTaskResp || [];

  const rows = useMemo(() => (data?.rows || []).map((r) => ({ ...r, projectId: id })), [data, id]);

  const counts = useMemo(() => {
    const c = { checklist: 0, review: 0, approved: 0 };
    rows.forEach((r) => { c[rowStage(r)] += 1; });
    return c;
  }, [rows]);

  const stageRows = useMemo(() => rows.filter((r) => rowStage(r) === activeStage), [rows, activeStage]);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))], [rows]);
  const assignees = useMemo(() => [...new Map(
    rows.filter((r) => r.assignedTo).map((r) => [r.assignedTo._id, r.assignedTo]),
  ).values()], [rows]);
  const designers = useMemo(() => [...new Map(
    rows.filter((r) => r.designerOwner).map((r) => [r.designerOwner._id, r.designerOwner]),
  ).values()], [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stageRows.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (phase !== 'all' && String(r.set) !== phase) return false;
      if (assignedTo !== 'all' && r.assignedTo?._id !== assignedTo) return false;
      if (designer !== 'all' && r.designerOwner?._id !== designer) return false;
      const planned = r.plannedDate ? r.plannedDate.slice(0, 10) : '';
      if (fromDate && (!planned || planned < fromDate)) return false;
      if (toDate && (!planned || planned > toDate)) return false;
      if (needle && !`${r.no} ${r.name} ${r.category}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [stageRows, category, phase, assignedTo, designer, fromDate, toDate, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const shownPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((shownPage - 1) * limit, shownPage * limit);

  const filtersOn = [category !== 'all', phase !== 'all', assignedTo !== 'all', designer !== 'all', !!fromDate, !!toDate, !!q.trim()]
    .filter(Boolean).length;
  const clearFilters = () => {
    setCategory('all'); setPhase('all'); setAssignedTo('all'); setDesigner('all');
    setFromDate(''); setToDate(''); setQ(''); setPage(1);
  };

  const afterChange = () => {
    setUploadRow(null); setReviewRow(null); setAssignRow(null); setAddOpen(false);
    refetch();
  };

  const columns = useMemo(() => {
    const menuFor = (r) => {
      const items = [
        { label: 'Assign / plan', icon: UserPlus, onClick: () => setAssignRow(r) },
        { label: 'Revision history', icon: HistoryIcon, onClick: () => setHistoryRow(r) },
      ];
      if (rowStage(r) === 'review') items.unshift({ label: 'Review & decide', icon: ClipboardCheck, onClick: () => setReviewRow(r) });
      if (rowStage(r) === 'checklist') items.unshift({ label: 'Upload drawing', icon: Upload, onClick: () => setUploadRow(r) });
      if (r.files?.length) items.splice(1, 0, { label: 'View the drawing', icon: Eye, onClick: () => setPreviewRow(r) });
      return items;
    };

    return [
      { key: 'no', label: '#', width: 58, render: (r) => <span className="prop-dim">{r.no}</span> },
      {
        key: 'action',
        label: 'Action',
        width: 156,
        render: (r) => {
          const stage = rowStage(r);
          return (
            <div className="prop-action-cell">
              {stage === 'checklist' && (
                <button type="button" className="prop-action-btn" onClick={() => setUploadRow(r)}>
                  <Upload size={13} /> Upload
                </button>
              )}
              {stage === 'review' && (
                <button type="button" className="prop-action-btn" onClick={() => setReviewRow(r)}>
                  <ClipboardCheck size={13} /> Review
                </button>
              )}
              {stage === 'approved' && (
                <button type="button" className="prop-open" onClick={() => setHistoryRow(r)}>
                  <Eye size={12} /> View
                </button>
              )}
              <RowMenu items={menuFor(r)} />
            </div>
          );
        },
      },
      { key: 'phase', label: 'Phase', width: 96, render: (r) => <span className="prop-badge">{r.setLabel?.replace('Set', 'Phase')}</span> },
      { key: 'category', label: 'Category', width: 128, render: (r) => r.category },
      {
        key: 'name',
        label: 'Drawing / Checklist Description',
        width: 300,
        render: (r) => (
          <>
            <div className="prop-name">{r.name}</div>
            {r.rejectReason && rowStage(r) === 'checklist' && (
              <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 2 }}>Sent back: {r.rejectReason}</div>
            )}
          </>
        ),
      },
      {
        key: 'file',
        label: 'File',
        width: 86,
        render: (r) => <FileCell files={r.files} onOpen={() => setPreviewRow(r)} />,
      },
      {
        /* Design-time, from the template: how long this half of the checklist
           is allowed. Editing the template moves it — nothing is copied. */
        key: 'planDays',
        label: 'Plan Days',
        width: 98,
        render: (r) => (r.planDays
          ? <span title={`The template allows ${r.planDays} working days for ${r.setLabel?.replace('Set', 'Phase')}`}>{r.planDays} days</span>
          : <span className="prop-dim">—</span>),
      },
      {
        key: 'planned',
        label: 'Planned Date',
        width: 136,
        render: (r) => (
          <PlanCell
            onOpen={() => setAssignRow(r)}
            empty="Set date"
            hint={r.inherited?.plannedDate ? inheritHint(r, 'due date') : undefined}
            value={r.plannedDate ? (
              <span>
                {fmtDate(r.plannedDate)}
                <SubNote row={r} field="plannedDate" extra={r.plannedTime} />
              </span>
            ) : null}
          />
        ),
      },
      {
        /* The planned date is a promise; this is what actually happened. Side
           by side they answer "did this slip?" without the reader doing the
           arithmetic, which is the whole reason the planned date is captured. */
        key: 'submitted',
        label: 'Submitted Date',
        width: 142,
        render: (r) => {
          if (!r.submittedAt) return <span className="prop-dim">Not yet filed</span>;
          const slip = lateness(r);
          return (
            <>
              <div>{fmtDateTime(r.submittedAt)}</div>
              {slip && (
                <div style={{ fontSize: 11.5, color: slip.late ? 'var(--danger)' : 'var(--success)' }}>
                  {slip.label}
                </div>
              )}
            </>
          );
        },
      },
      {
        key: 'assigned',
        label: 'Assigned To',
        width: 172,
        render: (r) => {
          const extra = r.alsoAssigned || [];
          return (
            <PlanCell
              onOpen={() => setAssignRow(r)}
              empty="Assign"
              hint={r.inherited?.assignedTo
                ? `${inheritHint(r, 'doer')}${r.buddy ? `
Buddy: ${r.buddy.name} — takes over when the doer cannot` : ''}`
                : undefined}
              value={r.assignedTo?.name ? (
                <span>
                  {r.assignedTo.name}
                  <SubNote row={r} field="assignedTo" extra={extra.length ? `+${extra.length} more` : null} />
                  {/* The stand-in, named. A drawing with a doer and no buddy is
                      the one that stalls the week that person is away. */}
                  {r.buddy?.name && (
                    <div className="prop-dim" style={{ fontSize: 11 }}>buddy: {r.buddy.name}</div>
                  )}
                </span>
              ) : null}
            />
          );
        },
      },
      {
        /* Nobody had to be assigned in advance for this to be answerable: the
           person who filed the drawing IS its owner until a PM says otherwise,
           so the column falls back to them rather than reading "—" forever
           after an upload. The tooltip says which of the two it is. */
        key: 'designer',
        label: 'Designer / Owner',
        width: 176,
        render: (r) => {
          const open = () => setAssignRow(r);
          if (r.designerOwner?.name) {
            return (
              <PlanCell
                onOpen={open}
                empty="Assign"
                hint="Assigned as the designer for this drawing"
                value={<span>{r.designerOwner.name}</span>}
              />
            );
          }
          if (r.submittedBy?.name) {
            return (
              <PlanCell
                onOpen={open}
                empty="Assign"
                hint="Filed this drawing — no designer assigned yet"
                value={(
                  <span>
                    {r.submittedBy.name}
                    <div className="prop-dim" style={{ fontSize: 11 }}>filed it</div>
                  </span>
                )}
              />
            );
          }
          /* Nobody named anywhere — but the template still says whose job this
             is. A role is not a person, so it is styled as the weaker claim it
             is, and naming someone here replaces it. */
          if (r.responsibleRole) {
            return (
              <PlanCell
                onOpen={open}
                empty="Assign"
                hint={`The template holds "${r.responsibleRole}" responsible for this phase — name a person here to be specific`}
                value={<span className="dd-role">{r.responsibleRole}</span>}
              />
            );
          }
          return <PlanCell onOpen={open} empty="Assign" value={null} />;
        },
      },
      {
        key: 'status',
        label: 'Status',
        width: 138,
        render: (r) => { const c = statusChip(r, now); return <Chip bg={c.bg} fg={c.fg}>{c.label}</Chip>; },
      },
      { key: 'revision', label: 'Revision', width: 92, render: (r) => (r.revision ? `R${r.revision}` : <span className="prop-dim">—</span>) },
      {
        key: 'updated',
        label: 'Last Updated',
        width: 128,
        render: (r) => (r.updatedAt
          ? <>{fmtDate(r.updatedAt)}{r.submittedBy ? <div className="prop-dim" style={{ fontSize: 11.5 }}>{r.submittedBy.name}</div> : null}</>
          : <span className="prop-dim">—</span>),
      },
      {
        /* A designer link is issued per phase (optionally per list), not per
           drawing, so every row it covers reports the same live link — with
           who it went to, which is the thing worth knowing at a glance. */
        key: 'link',
        label: 'Link Generated',
        width: 132,
        render: (r) => {
          const l = linkForRow(r);
          if (!l) return <span className="prop-dim">No</span>;
          return (
            <span title={`Sent to ${l.contact?.name || 'a designer'}${l.contact?.company ? ` · ${l.contact.company}` : ''}`}>
              Yes
              {l.contact?.name && <div className="prop-dim" style={{ fontSize: 11 }}>{l.contact.name}</div>}
            </span>
          );
        },
      },
      { key: 'notes', label: 'Notes', width: 168, render: (r) => r.notes || r.remarks || <span className="prop-dim">—</span> },
    ];
  }, [now, liveLinks]);

  if (isLoading || (!id && !overview)) {
    return <><Topbar title="Design & Drawings FMS" /><div className="content"><SkDetail /></div></>;
  }
  if (!id || isError || !data) {
    return (
      <>
        <Topbar title="Design & Drawings FMS" />
        <div className="content">
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <AlertTriangle size={26} style={{ color: 'var(--warning)' }} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>{!id ? 'No projects yet' : 'Could not load this project'}</div>
            <div className="sm muted" style={{ marginTop: 4 }}>
              {!id ? "A project's 37-drawing checklist appears here as soon as the project exists." : 'Try again in a moment.'}
            </div>
          </div>
        </div>
      </>
    );
  }

  const { project } = data;

  return (
    <>
      <Topbar title="Design & Drawings FMS" back={routeId ? '/design-drawings' : false} />

      <div className="prop-shell dd-shell">
        <div className="prop-page dd-page">

          <div className="prop-toolbar is-bare" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <PageHead
              title={project.name}
              subtitle={`Design & Drawings · ${project.city || '—'} · ${project.owner?.name || 'No manager set'} · ${rows.length} drawings on the checklist`}
            />
            <div className="dd-head-actions">
              <label className="prop-field">
                <span className="prop-field-label">PROJECT</span>
                <select className="prop-city" value={id} onChange={(e) => pickProject(e.target.value)}>
                  {(overview?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              {/* The page's one action belongs in the header, not stranded on
                  its own line under five filters. */}
              {/* The designer link, the same one the phase page issues — an
                  outside architect opens it and files against this checklist
                  without an account. Styled like Property Capture's own link
                  buttons because it is the same kind of thing. */}
              <button type="button" className="prop-open" onClick={() => setLinkOpen(true)}>
                <Link2 size={13} /> Drawing link
                {liveLinks.length > 0 && <span className="prop-badge" style={{ marginLeft: 6, padding: '1px 7px' }}>{liveLinks.length}</span>}
              </button>
              <button
                type="button"
                className="prop-action-btn"
                onClick={() => setAddOpen(true)}
                disabled={counts.checklist === 0}
                title={counts.checklist === 0 ? 'Every drawing has been filed' : 'Upload against any outstanding checklist row'}
              >
                <Plus size={14} /> Add Drawing
              </button>
            </div>
          </div>

          {/* The three steps as a FLOW: numbered discs joined by arrows, so the
              rail says a drawing MOVES along it. Each disc filters the table. */}
          <div className="dd-rail">
            {STAGES.map((s, i) => (
              <Fragment key={s.key}>
                <button
                  type="button"
                  className={`dd-rail-step${activeStage === s.key ? ' active' : ''}`}
                  onClick={() => { setActiveStage(s.key); setPage(1); }}
                  aria-current={activeStage === s.key ? 'step' : undefined}
                >
                  <span className="dd-rail-num">{s.n}</span>
                  <span className="dd-rail-label">
                    <span className="dd-rail-titlerow">
                      <span className="dd-rail-title">{s.title}</span>
                      <span className="dd-rail-count">{counts[s.key] || 0}</span>
                    </span>
                    <span className="dd-rail-sub">{s.desc}</span>
                  </span>
                </button>
                {i < STAGES.length - 1 && <span className="dd-rail-arrow" aria-hidden="true" />}
              </Fragment>
            ))}
          </div>

          <div className="prop-toolbar dd-filter-toolbar">
            <div className="prop-filters dd-filters">
              <label className="prop-field dd-filter-search">
                <span className="prop-field-label">SEARCH</span>
                <span className="prop-search">
                  <Search size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                  <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Drawing name or description..." />
                </span>
              </label>
              {/* Phase first: it is the coarsest cut of the checklist, and the
                  one question ("where are the Phase 2 drawings?") the 37 rows
                  are most often read to answer. */}
              <label className="prop-field">
                <span className="prop-field-label">PHASE</span>
                <select className="prop-city" value={phase} onChange={(e) => { setPhase(e.target.value); setPage(1); }}>
                  <option value="all">All Phases</option>
                  <option value="1">Phase 1 — the initial set</option>
                  <option value="2">Phase 2 — finishes &amp; coordination</option>
                </select>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">CATEGORY</span>
                <select className="prop-city" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
                  <option value="all">All Categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">ASSIGNED TO</span>
                <select className="prop-city" value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); setPage(1); }}>
                  <option value="all">All</option>
                  {assignees.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                </select>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">DESIGNER / OWNER</span>
                <select className="prop-city" value={designer} onChange={(e) => { setDesigner(e.target.value); setPage(1); }}>
                  <option value="all">All</option>
                  {designers.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                </select>
              </label>
              <label className="prop-field dd-filter-date">
                <span className="prop-field-label">PLANNED DATE</span>
                <span className="dd-date-range">
                  <input type="date" className="prop-city" style={{ minWidth: 0 }} value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} aria-label="Planned from" />
                  <span className="prop-dim">→</span>
                  <input type="date" className="prop-city" style={{ minWidth: 0 }} value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} aria-label="Planned to" />
                </span>
              </label>
              {filtersOn > 0 && (
                <div className="prop-field">
                  <span className="prop-field-label">&nbsp;</span>
                  <button type="button" className="prop-clear" onClick={clearFilters}>Clear · {filtered.length} found</button>
                </div>
              )}
            </div>
          </div>

          {!pageRows.length ? (
            <PropEmpty
              title={activeStage === 'checklist' ? 'Nothing waiting on an upload' : activeStage === 'review' ? 'Nothing pending review' : 'Nothing approved yet'}
              hint={filtersOn ? 'Clear the filters, or try another step above.' : 'Try another step above.'}
            />
          ) : (
            <PropTable columns={columns} rows={pageRows} rowKey={(r) => r.no} />
          )}

          <PropPager
            page={shownPage}
            totalPages={totalPages}
            total={filtered.length}
            limit={limit}
            onPage={setPage}
            onLimit={(n) => { setLimit(n); setPage(1); }}
          />
        </div>
      </div>

      {uploadRow && <UploadModal row={uploadRow} onClose={() => setUploadRow(null)} onSaved={afterChange} />}
      {addOpen && (
        <UploadModal
          pickFrom={rows.filter((r) => rowStage(r) === 'checklist')}
          onClose={() => setAddOpen(false)}
          onSaved={afterChange}
        />
      )}
      {reviewRow && <ReviewModal row={reviewRow} onClose={() => setReviewRow(null)} onDecided={afterChange} />}
      {assignRow && <AssignModal row={assignRow} onClose={() => setAssignRow(null)} onSaved={afterChange} />}
      {historyRow && <HistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />}
      {previewRow && <FilePreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />}
      {linkOpen && (
        <Modal
          open
          onClose={() => setLinkOpen(false)}
          title={`Drawing link — ${project.name}`}
          subtitle="One link per project. The designer opens it, reads the brief and files drawings against this checklist — no account needed."
          width={720}
        >
          <OutsourcePanel
            projectId={id}
            projectName={project.name}
            stageKey="p11"
            group={null}
            task={pageTasks[0] || null}
            canInvite
          />
        </Modal>
      )}
    </>
  );
}
