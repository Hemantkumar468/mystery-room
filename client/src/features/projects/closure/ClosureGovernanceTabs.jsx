/**
 * The governance half of the Project Closure Command Center — Lessons Learned,
 * Project Documents, Final Approvals, the Report Center, the Archive panel and
 * the Audit Log.
 *
 * As in ClosureAnalyticsTabs.jsx, nothing here fetches or derives: each tab
 * renders a slice prepared by closureAnalytics.js and calls back up to the
 * page for the two things that mutate anything — opening a record's form and
 * archiving the project.
 */
import { useState } from 'react';
import {
  BookOpen, FileText, FileSpreadsheet, Image as ImageIcon, Video as VideoIcon, Paperclip,
  Archive, ShieldCheck, CheckCircle2, XCircle, Clock, Download, PenLine, Search,
  History as HistoryIcon, Lock, Award, ExternalLink, Layers,
} from 'lucide-react';
import { SectionCard, Badge, ProgressBar } from '../../../components/ui/primitives.jsx';
import { fmtDate, fmtDateTime } from '../../../lib/format.js';
import { AwaitingData, InfoTile } from './ClosureKit.jsx';
import { LESSON_CATEGORIES, auditCategory } from './closureAnalytics.js';

const isImageKind = (d) => d.kind === 'image' || /\.(jpe?g|png|gif|webp|heic|avif)$/i.test(d.name || '');
const isVideoKind = (d) => d.kind === 'video' || /\.(mp4|mov|webm|m4v|avi)$/i.test(d.name || '');

/* ─────────────────────────────── Lessons Learned ──────────────────────────── */

export function LessonsLearnedTab({ lessons, onOpenRecord, onExportPdf, onExportExcel }) {
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');

  const visible = lessons.rows.filter((l) => {
    if (category && l.category !== category) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return [l.title, l.learnings, l.challenges, l.recommendations, l.impactArea]
        .some((v) => (v || '').toLowerCase().includes(q));
    }
    return true;
  });

  if (!lessons.rows.length) {
    return (
      <SectionCard title="Lessons Learned Knowledge Base">
        <AwaitingData
          icon={BookOpen}
          title="No learnings captured yet"
          hint="File one Lessons Learned submission per learning — categorise it as a Success, Failure, Risk, Recommendation, Future Improvement or Best Practice and it lands in this knowledge base."
        />
      </SectionCard>
    );
  }

  return (
    <div className="col gap-3">
      <SectionCard
        title={`Lessons Learned Knowledge Base (${lessons.rows.length})`}
        subtitle="Every approved learning, categorised for reuse on the next outlet"
        action={
          <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
            <div className="filter-search" style={{ minWidth: 190 }}>
              <Search size={14} className="muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search learnings…" />
            </div>
            <button type="button" className="btn btn-subtle btn-sm" onClick={onExportPdf}><FileText size={13} style={{ marginRight: 5 }} /> PDF</button>
            <button type="button" className="btn btn-subtle btn-sm" onClick={onExportExcel}><FileSpreadsheet size={13} style={{ marginRight: 5 }} /> Excel</button>
          </div>
        }
      >
        <div className="pcc-chip-row">
          <button type="button" className={`pcc-chip${category === '' ? ' active' : ''}`} onClick={() => setCategory('')}>
            All <span className="pcc-chip-count">{lessons.rows.length}</span>
          </button>
          {lessons.byCategory.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`pcc-chip${category === c.key ? ' active' : ''}`}
              onClick={() => setCategory(category === c.key ? '' : c.key)}
              style={{ '--chip-color': c.color }}
            >
              {c.key} <span className="pcc-chip-count">{c.items.length}</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <AwaitingData icon={Search} title="No learnings match this filter" hint="Clear the search or pick a different category." />
        ) : (
          <div className="pcc-lesson-grid">
            {visible.map((l) => {
              const meta = LESSON_CATEGORIES.find((c) => c.key === l.category) || LESSON_CATEGORIES[3];
              const images = l.attachments.filter(isImageKind);
              const videos = l.attachments.filter((a) => !isImageKind(a) && isVideoKind(a));
              const docs = l.attachments.filter((a) => !isImageKind(a) && !isVideoKind(a));
              return (
                <button
                  key={l.id}
                  type="button"
                  className="card pcc-lesson-card"
                  style={{ '--lesson-color': meta.color }}
                  onClick={() => onOpenRecord?.(l.record)}
                >
                  <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Badge color={meta.color} soft={`${meta.color}1A`} dot>{l.category}</Badge>
                    {l.impactArea && <span className="tiny subtle upper">{l.impactArea}</span>}
                  </div>
                  <span className="pcc-lesson-title">{l.title}</span>
                  {l.learnings && <p className="sm muted pcc-lesson-body">{l.learnings}</p>}
                  {l.recommendations && (
                    <p className="tiny pcc-lesson-body" style={{ color: 'var(--text-subtle)' }}>
                      <strong>Recommendation:</strong> {l.recommendations}
                    </p>
                  )}
                  <div className="row gap-3" style={{ marginTop: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="tiny muted">{l.capturedBy}</span>
                    <span className="tiny subtle">{fmtDate(l.capturedAt)}</span>
                    {images.length > 0 && <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}><ImageIcon size={11} />{images.length}</span>}
                    {videos.length > 0 && <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}><VideoIcon size={11} />{videos.length}</span>}
                    {docs.length > 0 && <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}><Paperclip size={11} />{docs.length}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {lessons.rows.some((l) => l.meetingNotes) && (
        <SectionCard title="Retrospective Meeting Notes">
          <div className="col gap-3">
            {lessons.rows.filter((l) => l.meetingNotes).map((l) => (
              <div key={l.id} className="pcc-note">
                <span className="tiny subtle upper">{l.title} · {l.capturedBy} · {fmtDate(l.capturedAt)}</span>
                <p className="sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{l.meetingNotes}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ────────────────────────────── Project Documents ─────────────────────────── */

export function DocumentsTab({ documents, archiveSummary }) {
  const [category, setCategory] = useState('');
  const categories = [...new Set(documents.map((d) => d.category))].sort();
  const visible = category ? documents.filter((d) => d.category === category) : documents;

  const images = visible.filter(isImageKind);
  const videos = visible.filter((d) => !isImageKind(d) && isVideoKind(d));
  const files = visible.filter((d) => !isImageKind(d) && !isVideoKind(d));

  return (
    <div className="col gap-3">
      {archiveSummary.length > 0 && (
        <SectionCard title="Archived Document Register" subtitle="Counts declared on each approved Document Archive submission">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Category</th><th>Documents Archived</th><th>Archived By</th><th>Archived On</th><th>Status</th></tr></thead>
              <tbody>
                {archiveSummary.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.category}</td>
                    <td className="tabular">{r.count ?? '—'}</td>
                    <td className="sm">{r.by}</td>
                    <td className="sm">{r.at ? fmtDate(r.at) : '—'}</td>
                    <td><Badge color="#059669" soft="#DCFCE7" dot>Archived</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={`Project Documents (${documents.length})`}
        subtitle="Every file uploaded on a closure submission, grouped by document category"
      >
        {documents.length === 0 ? (
          <AwaitingData
            icon={FileText}
            title="No documents uploaded yet"
            hint="Attachments on any closure module submission — reports, certificates, contracts, invoices, photos and videos — appear here."
          />
        ) : (
          <div className="col gap-3">
            <div className="pcc-chip-row">
              <button type="button" className={`pcc-chip${category === '' ? ' active' : ''}`} onClick={() => setCategory('')}>
                All <span className="pcc-chip-count">{documents.length}</span>
              </button>
              {categories.map((c) => (
                <button key={c} type="button" className={`pcc-chip${category === c ? ' active' : ''}`} onClick={() => setCategory(category === c ? '' : c)}>
                  {c} <span className="pcc-chip-count">{documents.filter((d) => d.category === c).length}</span>
                </button>
              ))}
            </div>

            {images.length > 0 && (
              <div className="col gap-2">
                <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}><ImageIcon size={12} /> Images ({images.length})</span>
                <div className="pcc-media-grid">
                  {images.map((d) => (
                    <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="pcc-media-tile">
                      <img src={d.url} alt={d.name} loading="lazy" />
                      <span className="pcc-media-name">{d.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {videos.length > 0 && (
              <div className="col gap-2">
                <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}><VideoIcon size={12} /> Videos ({videos.length})</span>
                <div className="pcc-media-grid">
                  {videos.map((d) => (
                    <video key={d.id} src={d.url} controls preload="metadata" className="pcc-media-video" />
                  ))}
                </div>
              </div>
            )}

            {files.length > 0 && (
              <div className="col gap-2">
                <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}><Paperclip size={12} /> Documents ({files.length})</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead><tr><th>Document</th><th>Category</th><th>Module</th><th>Uploaded By</th><th>Uploaded On</th><th /></tr></thead>
                    <tbody>
                      {files.map((d) => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 600 }}>{d.name}</td>
                          <td><Badge color="#64748B" soft="#F1F5F9">{d.category}</Badge></td>
                          <td className="sm muted">{d.module}</td>
                          <td className="sm">{d.uploadedBy}</td>
                          <td className="sm">{d.uploadedAt ? fmtDateTime(d.uploadedAt) : '—'}</td>
                          <td>
                            <a className="btn btn-ghost btn-sm" href={d.url} target="_blank" rel="noreferrer">
                              <ExternalLink size={13} style={{ marginRight: 4 }} /> Open
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ─────────────────────────────── Final Approvals ──────────────────────────── */

export function ApprovalsTab({ signOffs, modules, onOpenRecord }) {
  const signed = signOffs.filter((s) => s.status === 'approved').length;
  const signOffPct = signOffs.length ? Math.round((signed / signOffs.length) * 100) : 0;

  return (
    <div className="col gap-3">
      <SectionCard
        title="Final Approvals"
        subtitle="One row per sign-off authority — a pending row is an outstanding signature, not missing data"
        action={<Badge color={signOffPct === 100 ? '#059669' : '#D97706'} soft={signOffPct === 100 ? '#DCFCE7' : '#FEF3C7'}>{signed}/{signOffs.length} signed</Badge>}
      >
        <ProgressBar value={signOffPct} height={7} gradient={signOffPct === 100 ? '#059669' : '#D97706'} />
        <div className="col gap-2" style={{ marginTop: 14 }}>
          {signOffs.map((s) => (
            <div
              key={`${s.role}-${s.record?._id || 'pending'}`}
              className="pcc-signoff-row"
              role={s.record ? 'button' : undefined}
              tabIndex={s.record ? 0 : undefined}
              onClick={() => s.record && onOpenRecord?.(s.record)}
              onKeyDown={(e) => { if (s.record && (e.key === 'Enter' || e.key === ' ')) onOpenRecord?.(s.record); }}
            >
              <span className="pcc-signoff-icon" data-signed={s.status === 'approved'}>
                {s.status === 'approved' ? <CheckCircle2 size={16} /> : <Clock size={16} />}
              </span>
              <div className="col gap-1 grow" style={{ minWidth: 150 }}>
                <span className="sm" style={{ fontWeight: 650 }}>{s.role}</span>
                <span className="tiny muted">{s.signedBy || 'Awaiting signature'}</span>
              </div>
              <InfoTile label="Approved On" value={s.signedAt ? fmtDate(s.signedAt) : null} />
              <InfoTile label="Reviewed By" value={s.approvedBy} />
              <div className="col gap-1 grow" style={{ minWidth: 140 }}>
                <span className="tiny subtle upper">Remarks</span>
                <span className="sm" title={s.remarks || undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.remarks || '—'}
                </span>
              </div>
              <div className="col gap-1" style={{ minWidth: 150 }}>
                <span className="tiny subtle upper">Digital Signature</span>
                {s.signature
                  ? <span className="pcc-signature"><PenLine size={12} /> {s.signature}</span>
                  : <span className="sm muted">—</span>}
              </div>
              <Badge color={s.status === 'approved' ? '#059669' : '#6B7280'} soft={s.status === 'approved' ? '#DCFCE7' : '#F3F4F6'} dot>
                {s.status === 'approved' ? 'Approved' : 'Pending'}
              </Badge>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Closure Module Approvals" subtitle="Review state of all eight closure modules">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Module</th><th>Submissions</th><th>Approved</th><th>Rejected</th><th>Awaiting Review</th><th>Status</th></tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.type.key}>
                  <td style={{ fontWeight: 650 }}>{m.type.name}</td>
                  <td className="tabular">{m.total}</td>
                  <td className="tabular">{m.approved}</td>
                  <td className="tabular" style={{ color: m.rejected ? '#DC2626' : undefined }}>{m.rejected}</td>
                  <td className="tabular" style={{ color: m.pendingReview ? '#D97706' : undefined }}>{m.pendingReview}</td>
                  <td><Badge color={m.statusMeta.color} soft={m.statusMeta.soft} dot>{m.statusMeta.label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* ──────────────────────────────── Report Center ───────────────────────────── */

const REPORTS = [
  { key: 'executive', label: 'Executive Summary', hint: 'One-page closure brief — status, scores, budget, schedule and sign-off.', icon: Layers },
  { key: 'budget', label: 'Budget Report', hint: 'Planned vs actual, variance, utilisation and vendor-wise cost.', icon: FileSpreadsheet },
  { key: 'delay', label: 'Delay Report', hint: 'Phase slippage, department delays and critical overruns.', icon: Clock },
  { key: 'vendor', label: 'Vendor Report', hint: 'Full vendor scorecard with grades, SLA and payment status.', icon: ShieldCheck },
  { key: 'department', label: 'Department Report', hint: 'Per-department completion, quality and productivity scores.', icon: HistoryIcon },
  { key: 'lessons', label: 'Lessons Learned Report', hint: 'Every captured learning, by category and impact area.', icon: BookOpen },
];

export function ReportCenterTab({ onOpenFullReport, onExport, onCertificate, canCertify }) {
  return (
    <div className="col gap-3">
      <SectionCard
        title="Report Center"
        subtitle="Every report is generated live from this project's own closure data — nothing is snapshotted or cached"
      >
        <div className="pcc-report-grid">
          {REPORTS.map((r) => (
            <div key={r.key} className="card pcc-report-card">
              <span className="pcc-report-icon"><r.icon size={16} strokeWidth={2.1} /></span>
              <div className="col gap-1">
                <span style={{ fontWeight: 650 }}>{r.label}</span>
                <span className="tiny muted">{r.hint}</span>
              </div>
              <div className="row gap-2" style={{ marginTop: 'auto' }}>
                <button type="button" className="btn btn-subtle btn-sm" onClick={() => onExport(r.key, 'pdf')}>
                  <FileText size={13} style={{ marginRight: 5 }} /> PDF
                </button>
                <button type="button" className="btn btn-subtle btn-sm" onClick={() => onExport(r.key, 'excel')}>
                  <FileSpreadsheet size={13} style={{ marginRight: 5 }} /> Excel
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="pcc-split">
        <SectionCard title="Project Closure Report" subtitle="The full printable closure document">
          <div className="col gap-3">
            <p className="sm muted" style={{ margin: 0 }}>
              Opens the complete closure report — executive summary, phase timeline, budget and delay analysis,
              vendor and department scorecards, lessons learned, approvals and the audit trail — formatted for print
              or Save as PDF.
            </p>
            <button type="button" className="btn btn-primary" onClick={onOpenFullReport} style={{ alignSelf: 'flex-start' }}>
              <Download size={15} style={{ marginRight: 6 }} /> Open Closure Report
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Closure Certificate" subtitle="Issued once the project is formally archived">
          <div className="col gap-3">
            <p className="sm muted" style={{ margin: 0 }}>
              {canCertify
                ? 'This project has been archived — the certificate of closure carries the archive date, final score and sign-off of record.'
                : 'The certificate becomes available once every closure gate has cleared and the project is archived.'}
            </p>
            <button type="button" className="btn btn-outline" disabled={!canCertify} onClick={onCertificate} style={{ alignSelf: 'flex-start' }}>
              <Award size={15} style={{ marginRight: 6 }} /> {canCertify ? 'Print Closure Certificate' : 'Certificate Locked'}
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

/* ───────────────────────────────── Archive Panel ──────────────────────────── */

export function ArchivePanelTab({
  gates, gatesLoading, isArchived, project, canArchive, archiving, archiveError,
  remarks, onRemarksChange, onArchive,
}) {
  const passed = gates.filter((g) => g.passed).length;
  const ready = gates.length > 0 && passed === gates.length;

  return (
    <div className="col gap-3">
      {isArchived && (
        <div className="pcc-banner pcc-banner-success">
          <Archive size={18} />
          <div className="col gap-1">
            <span className="sm" style={{ fontWeight: 700 }}>Project Archived</span>
            <span className="tiny muted">
              Archived {project.archivedAt ? fmtDateTime(project.archivedAt) : '—'}
              {project.archivedBy?.name ? ` by ${project.archivedBy.name}` : ''} · the project is now read-only.
            </span>
          </div>
        </div>
      )}

      <SectionCard
        title="Archive Readiness"
        subtitle="All six gates are re-validated on the server when Archive Project is pressed — this checklist is the same rule, shown early"
        action={<Badge color={ready ? '#059669' : '#D97706'} soft={ready ? '#DCFCE7' : '#FEF3C7'}>{passed}/{gates.length} cleared</Badge>}
      >
        {gatesLoading ? (
          <div className="empty sm">Checking closure gates…</div>
        ) : gates.length === 0 ? (
          <AwaitingData icon={ShieldCheck} title="Closure gates unavailable" hint="Reload the page to re-check archive readiness." />
        ) : (
          <div className="col gap-2">
            {gates.map((g) => (
              <div key={g.key} className="pcc-gate-row" data-passed={g.passed}>
                <span className="pcc-gate-icon">{g.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span>
                <div className="col gap-1 grow">
                  <span className="sm" style={{ fontWeight: 650 }}>{g.label}</span>
                  <span className="tiny muted">{g.detail}</span>
                </div>
                <Badge color={g.passed ? '#059669' : '#DC2626'} soft={g.passed ? '#DCFCE7' : '#FEE2E2'} dot>
                  {g.passed ? 'Cleared' : 'Blocked'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Archive Project" subtitle="The final, irreversible action of the project lifecycle">
        {isArchived ? (
          <div className="col gap-2">
            <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 650 }}>
              <Lock size={15} /> This project is archived and cannot be re-archived or reopened.
            </span>
            {project.archiveRemarks && (
              <div className="pcc-note">
                <span className="tiny subtle upper">Closure Remarks</span>
                <p className="sm" style={{ margin: 0 }}>{project.archiveRemarks}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="col gap-3">
            <p className="sm muted" style={{ margin: 0 }}>
              Archiving formally closes the project: its status becomes Archived, the closure date and archiving
              manager are stamped permanently, stakeholders are notified, and every phase becomes read-only.
              This cannot be undone.
            </p>
            <div className="col gap-1">
              <span className="tiny subtle upper">Closure Remarks (optional)</span>
              <textarea
                className="input"
                rows={3}
                value={remarks}
                onChange={(e) => onRemarksChange(e.target.value)}
                placeholder="Final note for the closure record…"
                disabled={!canArchive}
              />
            </div>
            {archiveError && <span className="tiny" style={{ color: 'var(--danger)' }}>{archiveError}</span>}
            {!canArchive && <span className="tiny muted">Only a manager or admin can archive a project.</span>}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canArchive || !ready || archiving}
              onClick={onArchive}
              style={{ alignSelf: 'flex-start' }}
            >
              <Archive size={15} style={{ marginRight: 6 }} /> {archiving ? 'Archiving…' : 'Archive Project'}
            </button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ────────────────────────────────── Audit Log ─────────────────────────────── */

const AUDIT_CATEGORY_COLOR = {
  Archive: '#7C3AED', Export: '#0EA5E9', Approval: '#059669',
  Phase: '#2563EB', Document: '#D97706', Budget: '#16A79A', Record: '#64748B',
};

export function AuditLogTab({ trail, onExportPdf, onExportExcel }) {
  const [category, setCategory] = useState('');
  const rows = trail.map((a) => ({ ...a, category: auditCategory(a) }));
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  const visible = category ? rows.filter((r) => r.category === category) : rows;

  return (
    <SectionCard
      title={`Audit Log (${rows.length})`}
      subtitle="Every phase event, approval, budget update, document upload, archive action and export recorded against this closure"
      action={
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle btn-sm" onClick={onExportPdf}><FileText size={13} style={{ marginRight: 5 }} /> PDF</button>
          <button type="button" className="btn btn-subtle btn-sm" onClick={onExportExcel}><FileSpreadsheet size={13} style={{ marginRight: 5 }} /> Excel</button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <AwaitingData icon={HistoryIcon} title="No closure activity yet" hint="Entries appear as closure modules are filed, reviewed, exported and archived." />
      ) : (
        <div className="col gap-3">
          <div className="pcc-chip-row">
            <button type="button" className={`pcc-chip${category === '' ? ' active' : ''}`} onClick={() => setCategory('')}>
              All <span className="pcc-chip-count">{rows.length}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`pcc-chip${category === c ? ' active' : ''}`}
                style={{ '--chip-color': AUDIT_CATEGORY_COLOR[c] }}
                onClick={() => setCategory(category === c ? '' : c)}
              >
                {c} <span className="pcc-chip-count">{rows.filter((r) => r.category === c).length}</span>
              </button>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>#</th><th>Activity</th><th>Category</th><th>Actor</th><th>Date &amp; Time</th></tr></thead>
              <tbody>
                {visible.map((a, i) => (
                  <tr key={a._id}>
                    <td className="tiny muted tabular">{i + 1}</td>
                    <td className="sm">{a.message}</td>
                    <td><Badge color={AUDIT_CATEGORY_COLOR[a.category] || '#64748B'} soft={`${AUDIT_CATEGORY_COLOR[a.category] || '#64748B'}1A`}>{a.category}</Badge></td>
                    <td className="sm">{a.actor?.name || 'System'}</td>
                    <td className="sm muted">{fmtDateTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
