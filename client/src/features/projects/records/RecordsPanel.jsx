import { useMemo, useState } from 'react';
import { Plus, Building2, Eye, Check } from 'lucide-react';
import { Badge, EmptyState, Spinner } from '../../../components/ui/primitives.jsx';
import { useStageRecords, useRecordDecision } from '../../../lib/queries.js';
import { useAuthStore } from '../../../store/authStore.js';
import { STAGE_STATUS_META } from '../../../lib/ui.js';
import { RecordFormModal } from './RecordFormModal.jsx';
import { RecordDetailDrawer } from './RecordDetailDrawer.jsx';
import {
  RECORD_STATUS_META,
  RECORD_FILTER_TABS,
  formatFieldValue,
  titleFieldKey,
  summaryFields,
} from './recordUi.js';

const DECIDE_ROLES = ['admin', 'manager'];
const CAPTURE_ROLES = ['admin', 'manager', 'executor'];

/**
 * The workspace for a `collection`-mode stage (e.g. Phase 1). Shows an
 * "Add {recordNoun}" action, funnel filter tabs, and the rows table with
 * per-row status chips and shortlist/reject actions.
 */
export function RecordsPanel({ project, stage, schema = [] }) {
  const role = useAuthStore((s) => s.user?.role);
  const canDecide = DECIDE_ROLES.includes(role);
  const canCapture = CAPTURE_ROLES.includes(role);
  const recordNoun = stage.recordNoun || 'Record';

  const { data: records, isLoading } = useStageRecords(project._id, stage.key);
  const quickDecide = useRecordDecision(project._id, stage.key);

  const [filter, setFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const rows = records || [];
  const titleKey = useMemo(() => titleFieldKey(schema), [schema]);
  const cols = useMemo(() => summaryFields(schema, titleKey), [schema, titleKey]);

  const counts = useMemo(() => {
    const c = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const stageMeta = STAGE_STATUS_META[stage.status];

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (record) => { setDetail(null); setEditing(record); setFormOpen(true); };

  return (
    <div className="card">
      <div className="card-head">
        <div className="row gap-3">
          <span className="badge-dot" style={{ background: stage.color, width: 10, height: 10 }} />
          <div className="col">
            <span className="section-title">{stage.name}</span>
            <span className="tiny muted">
              {rows.length} {recordNoun.toLowerCase()}{rows.length === 1 ? '' : 's'} captured
              {stageMeta ? <> · <span style={{ color: stageMeta.color }}>{stageMeta.label}</span></> : null}
            </span>
          </div>
        </div>
        {canCapture && (
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={14} /> Add {recordNoun}
          </button>
        )}
      </div>

      <div className="card-body col gap-4">
        {/* Funnel filter tabs */}
        <div className="tabs">
          {RECORD_FILTER_TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${filter === t.key ? 'active' : ''}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}{counts[t.key] ? ` (${counts[t.key]})` : ''}
            </button>
          ))}
        </div>

        {isLoading ? (
          <Spinner label={`Loading ${recordNoun.toLowerCase()}s…`} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={filter === 'all' ? `No ${recordNoun.toLowerCase()}s yet` : `Nothing ${filter}`}
            hint={filter === 'all' ? `Add the first ${recordNoun.toLowerCase()} a broker has lined up.` : 'Try another filter.'}
            action={canCapture && filter === 'all' ? (
              <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> Add {recordNoun}</button>
            ) : null}
          />
        ) : (
          <div className="col">
            {shown.map((r) => {
              const meta = RECORD_STATUS_META[r.status] || { label: r.status, color: '#7c7784' };
              const undecided = r.status === 'draft' || r.status === 'submitted';
              return (
                <div key={r._id} className="row between gap-3 wrap" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="col gap-1 grow" style={{ minWidth: 220 }}>
                    <button
                      type="button"
                      onClick={() => setDetail(r)}
                      className="sm"
                      style={{ fontWeight: 700, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)' }}
                    >
                      {r.title || `Untitled ${recordNoun.toLowerCase()}`}
                    </button>
                    <span className="tiny muted">
                      {cols.map((f, i) => {
                        const v = formatFieldValue(f, r.values?.[f.key]);
                        if (v === '—') return null;
                        return <span key={f.key}>{i > 0 ? ' · ' : ''}{f.label}: {v}</span>;
                      })}
                    </span>
                  </div>
                  <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
                    <Badge color={meta.color} soft={meta.soft}>{meta.label}</Badge>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDetail(r)}><Eye size={14} /> View</button>
                    {canDecide && undecided && (
                      <button
                        className="btn btn-sm"
                        onClick={() => quickDecide.mutate({ id: r._id, decision: 'shortlist' })}
                        disabled={quickDecide.isPending}
                        style={{ background: '#10b981', color: '#fff', borderColor: '#10b981' }}
                      >
                        <Check size={14} /> Shortlist
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RecordFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        projectId={project._id}
        stageKey={stage.key}
        schema={schema}
        recordNoun={recordNoun}
        record={editing}
      />
      <RecordDetailDrawer
        open={!!detail}
        onClose={() => setDetail(null)}
        record={detail}
        schema={schema}
        recordNoun={recordNoun}
        projectId={project._id}
        stageKey={stage.key}
        canDecide={canDecide}
        onEdit={canCapture ? openEdit : undefined}
      />
    </div>
  );
}

export default RecordsPanel;
