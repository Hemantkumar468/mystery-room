import { useState } from 'react';
import {
  Trash2, FileText, FileSpreadsheet, Play, MessageCircle, Activity as ActivityIcon,
} from 'lucide-react';
import { Avatar, EmptyState } from '../../components/ui/primitives.jsx';
import { fmtDate, fmtDateTime, fmtFileSize, fmtDuration } from '../../lib/format.js';
import { activityMeta } from '../projects/DepartmentPlanningPage.jsx';

/**
 * Pieces shared between the task's own detail page (TaskDetailPage.jsx) and
 * the Approval Workflow request panel (ApprovalWorkflowPage.jsx) — both show
 * the same attachment/comment/activity data for a task, just inside
 * different chrome. Kept here once so they can't drift apart.
 */

export const extOf = (name = '') => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
export function isImage(a) {
  return (a.mimetype || '').startsWith('image/') || a.resourceType === 'image'
    || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extOf(a.originalName));
}
export function isVideo(a) {
  return (a.mimetype || '').startsWith('video/') || a.resourceType === 'video'
    || ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(extOf(a.originalName));
}
export const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/** Icon + tint for a non-image/video file, read off its extension — PDF/Excel/Word
 * get their own color so the Attachments list reads at a glance, same idea as
 * TASK_STATUS_META's color-coded badges elsewhere in this app. */
export function fileMeta(name = '') {
  const ext = extOf(name);
  if (ext === 'pdf') return { Icon: FileText, color: 'var(--danger)' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { Icon: FileSpreadsheet, color: 'var(--success)' };
  if (['doc', 'docx'].includes(ext)) return { Icon: FileText, color: 'var(--info)' };
  return { Icon: FileText, color: 'var(--text-subtle)' };
}

/** One attachment row — image thumbnail or file chip, open link, delete. */
export function AttachmentRow({ a, onDelete, deleting }) {
  const img = isImage(a);
  const fm = fileMeta(a.originalName);
  return (
    <div className="row gap-2" style={{ padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', alignItems: 'center' }}>
      {img ? (
        <a href={a.url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
          <img src={a.url} alt={a.originalName || ''} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />
        </a>
      ) : (
        <span className="center" style={{ width: 44, height: 44, borderRadius: 6, background: `${fm.color}1A`, color: fm.color, flexShrink: 0 }}>
          <fm.Icon size={18} />
        </span>
      )}
      <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <span className="sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.originalName}>
          {a.originalName || 'file'}
        </span>
        <span className="tiny muted">{a.bytes ? fmtFileSize(a.bytes) : ''}{a.uploadedBy?.name ? ` · ${a.uploadedBy.name}` : ''}{a.createdAt ? ` · ${fmtDate(a.createdAt)}` : ''}</span>
      </div>
      <a className="btn btn-ghost btn-sm" href={a.url} target="_blank" rel="noreferrer">{img ? 'Open' : 'Preview'}</a>
      {onDelete && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ color: 'var(--danger)' }} disabled={deleting} onClick={() => onDelete(a)} title="Delete attachment">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * A video's card — compact (poster frame + play overlay + duration badge,
 * click opens the file) or full (real `<video controls>`). Duration is never
 * fabricated — it's read straight off the file via the video element's own
 * `loadedmetadata` event.
 */
export function VideoCard({ a, compact, onDelete, deleting }) {
  const [duration, setDuration] = useState(null);
  const onLoaded = (e) => setDuration(e.target.duration);

  if (compact) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="col gap-1" style={{ textDecoration: 'none' }}>
        <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000' }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={`${a.url}#t=0.5`} muted preload="metadata" onLoadedMetadata={onLoaded} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
          <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center' }}>
              <Play size={13} fill="#fff" color="#fff" />
            </span>
          </span>
          {duration != null && (
            <span className="tiny" style={{ position: 'absolute', right: 4, bottom: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '1px 5px', borderRadius: 4 }}>
              {fmtDuration(duration)}
            </span>
          )}
        </div>
        <span className="tiny" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.originalName}</span>
      </a>
    );
  }

  return (
    <div className="col gap-1">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={a.url} controls preload="metadata" onLoadedMetadata={onLoaded} style={{ width: '100%', borderRadius: 8, background: '#000' }} />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.originalName}{duration != null ? ` · ${fmtDuration(duration)}` : ''}{a.bytes ? ` · ${fmtFileSize(a.bytes)}` : ''}
        </span>
        {onDelete && (
          <button type="button" style={{ background: 'none', border: 'none', cursor: deleting ? 'default' : 'pointer', color: 'var(--danger)', padding: 0, flexShrink: 0, opacity: deleting ? 0.5 : 1 }} disabled={deleting} onClick={() => onDelete(a)} title="Delete">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Full Comments tab content — composer (unless `locked`) + thread. */
export function CommentsThread({ comments, draft, onDraftChange, onSubmit, pending, locked }) {
  return (
    <div className="col gap-4">
      {!locked && (
        <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
          <textarea
            className="textarea grow" rows={2} placeholder="Write a comment…"
            value={draft} onChange={(e) => onDraftChange(e.target.value)}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={pending || !draft.trim()} onClick={onSubmit}>
            {pending ? 'Posting…' : 'Post'}
          </button>
        </div>
      )}
      {comments.length === 0 ? (
        <EmptyState icon={MessageCircle} title="No comments yet" hint="Discussion and feedback on this task will show up here." />
      ) : (
        <div className="col gap-3">
          {comments.map((c) => (
            <div key={c._id} className="row gap-2" style={{ alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <Avatar name={c.author?.name} color={c.author?.avatarColor} size={30} />
              <div className="col grow" style={{ minWidth: 0 }}>
                <span className="row gap-2" style={{ alignItems: 'center' }}>
                  <span className="sm" style={{ fontWeight: 600 }}>{c.author?.name || 'Someone'}</span>
                  <span className="tiny muted">{fmtDateTime(c.createdAt)}</span>
                </span>
                <span className="sm">{c.body}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Full Activity tab content — this task's activity log entries, newest first (as returned). */
export function ActivityLog({ activity }) {
  if (activity.length === 0) {
    return <EmptyState icon={ActivityIcon} title="No activity yet" hint="Status changes, uploads and comments on this task will show up here." />;
  }
  return (
    <div className="col">
      {activity.map((a) => {
        const { Icon, color } = activityMeta(a.message);
        return (
          <div key={a._id} className="row gap-3" style={{ alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <div className="list-row-icon" style={{ width: 28, height: 28, background: `${color}1A`, color, flexShrink: 0 }}>
              <Icon size={13} strokeWidth={2} />
            </div>
            <div className="col grow" style={{ minWidth: 0 }}>
              <span className="sm" style={{ fontWeight: 600 }}>{a.actor?.name || 'System'}</span>
              <span className="tiny muted">{a.message}</span>
            </div>
            <span className="tiny muted" style={{ flexShrink: 0 }}>{fmtDateTime(a.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
