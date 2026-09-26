import { useState } from 'react';
import {
  CheckCircle2, PowerOff, UserCog, MessageSquare, Repeat, Users, CalendarDays, Clock, MapPin, Building2, Tag, Paperclip,
  AlertTriangle, ArrowRight, History, FolderKanban, Megaphone, RotateCcw,
} from 'lucide-react';
import { Drawer } from '../../components/ops/Drawer.jsx';
import { ChkStatusBadge, Meta } from '../../components/ops/common.jsx';
import { Avatar, Spinner, EmptyState } from '../../components/ui/primitives.jsx';
import { Attachments } from '../../components/ops/FileUploader.jsx';
import { useChecklistTask } from '../../lib/opsQueries.js';
import { useDrawerStore, drawers } from '../../store/drawerStore.js';
import { FREQ_LABEL, chkState, lateDays, parseRemarkLines } from '../../lib/opsUi.js';
import { fmtDate, fmtDateTime, fromNow } from '../../lib/format.js';
import { DEPT_META } from '../../lib/ui.js';
import { CompleteTaskModal, NonFunctionalModal, ReassignModal, ReopenTaskModal, TaskRemarksModal } from './ChecklistModals.jsx';

function Channel({ label, value, tone }) {
  const lines = parseRemarkLines(value);
  if (!lines.length) return null;
  return (
    <div className="drawer-section">
      <span className="eyebrow" style={{ color: tone }}>{label} · {lines.length}</span>
      {lines.map((l, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="remark-line">
          {l.at && <div className="tiny subtle tabular">{l.at}</div>}
          <div className="sm">{l.text}</div>
        </div>
      ))}
    </div>
  );
}

/** One checklist occurrence in full — what, who, when, proof, remarks, and its routine's recent track record. */
export function ChecklistTaskDrawer({ id, onClose }) {
  const { data: t, isLoading, error } = useChecklistTask(id);
  const replaceTop = useDrawerStore((s) => s.replaceTop);
  const [modal, setModal] = useState(null);
  const state = chkState(t);
  const late = state === 'overdue' ? lateDays(t?.plannedDate) : 0;
  const can = t?.can || {};

  return (
    <Drawer
      open
      onClose={onClose}
      width={700}
      title={t?.taskName || 'Checklist task'}
      subtitle={t ? `${t.code}${t.master ? ` · routine ${t.master.code}` : ''}` : ''}
    >
      {isLoading && <Spinner label="Loading…" />}
      {error && <EmptyState icon={AlertTriangle} title="This checklist task isn't available" hint="It may be outside what you can see." />}
      {t && (
        <div className="col gap-4">
          <div className="row gap-2 wrap">
            <ChkStatusBadge value={state} />
            {late > 0 && <span className="late-pill">{late}d late</span>}
            <span className="chip chip-sm"><Repeat size={11} /> {FREQ_LABEL[t.frequency] || 'One-off'}</span>
            {t.proofRequired && <span className="chip chip-sm"><Paperclip size={11} /> {t.documentUrl ? 'Proof attached' : 'Proof required'}</span>}
            {t.followUpCount > 0 && <span className="chip chip-sm danger-text"><Megaphone size={11} /> {t.followUpCount} follow-up(s)</span>}
          </div>

          <div className="action-bar">
            {can.complete && <button className="btn btn-primary btn-sm" onClick={() => setModal('complete')}><CheckCircle2 size={14} /> Complete</button>}
            {can.nonFunctional && <button className="btn btn-subtle btn-sm" onClick={() => setModal('nf')}><PowerOff size={14} /> Non-functional</button>}
            {can.reassign && <button className="btn btn-subtle btn-sm" onClick={() => setModal('reassign')}><UserCog size={14} /> Reassign</button>}
            {can.reopen && <button className="btn btn-subtle btn-sm" onClick={() => setModal('reopen')}><RotateCcw size={14} /> Reopen</button>}
            <button className="btn btn-subtle btn-sm" onClick={() => setModal('remarks')}><MessageSquare size={14} /> Remarks</button>
            {t.master && <button className="btn btn-ghost btn-sm" onClick={() => drawers.routine(t.master._id)}><Repeat size={14} /> Open routine</button>}
          </div>

          <div className="card card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 var(--space-6)' }}>
            <div>
              <Meta icon={Users} label="Doer"><span className="row gap-2" style={{ justifyContent: 'flex-end' }}><Avatar name={t.doer?.name} color={t.doer?.avatarColor} size={20} />{t.doer?.name}</span></Meta>
              {t.reassignedFrom && <Meta icon={UserCog} label="Reassigned from">{t.reassignedFrom.name}{t.reassignedAt ? ` · ${fmtDate(t.reassignedAt)}` : ''}</Meta>}
              <Meta icon={Building2} label="Branch">{t.branch ? `${t.branch.name} (${t.branch.code})` : null}</Meta>
              <Meta icon={MapPin} label="Site">{t.site}</Meta>
              <Meta icon={Tag} label="Department">{DEPT_META[t.department] || t.department}</Meta>
              <Meta icon={FolderKanban} label="Group">{t.group?.name}</Meta>
            </div>
            <div>
              <Meta icon={CalendarDays} label="Planned">{fmtDate(t.plannedDate)}</Meta>
              <Meta icon={Clock} label="Closed">
                {t.actualDate ? (
                  <span style={{ color: state === 'late' ? 'var(--warning)' : undefined }}>{fmtDateTime(t.actualDate)}{state === 'late' ? ' · late' : ''}</span>
                ) : null}
              </Meta>
              <Meta icon={Repeat} label="Routine">
                {t.master ? <button className="link-btn" onClick={() => drawers.routine(t.master._id)}>{t.master.code}</button> : '—'}
              </Meta>
              <Meta icon={CalendarDays} label="Routine window">{t.master ? `${fmtDate(t.master.startDate)} → ${fmtDate(t.master.endDate)}` : null}</Meta>
              <Meta icon={Paperclip} label="Proof">{t.proofRequired ? (t.documentUrl ? 'Attached' : 'Required') : 'Not needed'}</Meta>
            </div>
          </div>

          {t.documentUrl && (
            <div className="drawer-section"><span className="eyebrow">Proof of completion</span><Attachments urls={[t.documentUrl]} /></div>
          )}
          {t.master?.description && <p className="sm muted" style={{ whiteSpace: 'pre-wrap' }}>{t.master.description}</p>}

          <Channel label="Management follow-ups" value={t.managementRemark} tone="var(--danger)" />
          <Channel label="Coordinator notes" value={t.coordinatorRemark} tone="var(--info)" />

          {t.history?.length > 0 && (
            <div className="drawer-section">
              <span className="eyebrow row gap-1"><History size={12} /> Recent occurrences of this routine</span>
              <div className="card" style={{ overflow: 'hidden' }}>
                {t.history.map((h) => {
                  const hs = chkState(h);
                  return (
                    <div key={h._id} className="row gap-3 row-link" style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }} onClick={() => replaceTop({ type: 'checklistTask', id: h._id })}>
                      <span className="mono tiny subtle" style={{ width: 90 }}>{h.code}</span>
                      <span className="sm grow">{fmtDate(h.plannedDate)}</span>
                      <span className="tiny muted">{h.doer?.name}</span>
                      <span className="tiny muted" style={{ width: 110 }}>{h.actualDate ? fmtDate(h.actualDate) : '—'}</span>
                      <ChkStatusBadge value={hs} />
                      <ArrowRight size={14} className="subtle" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {t.activity?.length > 0 && (
            <div className="drawer-section">
              <span className="eyebrow">Activity</span>
              {t.activity.map((a) => (
                <div key={a._id} className="row gap-2 sm" style={{ padding: '5px 0' }}>
                  <Avatar name={a.actor?.name} color={a.actor?.avatarColor} size={20} />
                  <span className="grow"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.description}</span></span>
                  <span className="tiny subtle nowrap">{fromNow(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CompleteTaskModal task={modal === 'complete' ? t : null} onClose={() => setModal(null)} />
      <NonFunctionalModal task={modal === 'nf' ? t : null} onClose={() => setModal(null)} />
      <ReassignModal task={modal === 'reassign' ? t : null} onClose={() => setModal(null)} />
      <ReopenTaskModal task={modal === 'reopen' ? t : null} onClose={() => setModal(null)} />
      <TaskRemarksModal task={modal === 'remarks' ? t : null} canRemark={can.remark} onClose={() => setModal(null)} />
    </Drawer>
  );
}

export default ChecklistTaskDrawer;
