import { ArrowRight, FileText, Play, Plus } from 'lucide-react';
import { Badge } from '../../../components/ui/primitives.jsx';
import { fmtDate } from '../../../lib/format.js';
import { cardStatusMeta } from './recordUi.js';

const DESCRIPTIONS = {
  feasibility: 'Evaluate the feasibility and viability of the selected property.',
  financial: 'Analyze financial metrics and investment potential.',
  technical: 'Evaluate technical aspects and infrastructure requirements.',
  operational: 'Assess operational requirements and resource availability.',
};

/**
 * A card's action is state-dependent: no record yet → start one; a draft →
 * resume it in place; anything already submitted (under review, approved,
 * rejected) → the record is no longer editable from here, so the card takes
 * the user to its full report instead (which has its own Edit action for
 * authorized users).
 */
export function AssessmentCard({ type, record, onOpen, onContinue, onViewReport }) {
  const hasRecord = !!record;
  const isDraft = hasRecord && record.status === 'draft';
  const meta = cardStatusMeta(record);
  const description = DESCRIPTIONS[type.key] || type.description || 'Fill out the details for this evaluation.';

  const handleClick = () => {
    if (!hasRecord) onOpen?.();
    else if (isDraft) onContinue?.();
    else onViewReport?.();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      title={!hasRecord ? 'Click to start assessment' : isDraft ? 'Continue this draft' : 'View this assessment\'s report'}
      className="card card-hover assessment-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '16px 20px',
        minHeight: 220,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        border: '1px solid var(--border)',
        position: 'relative',
        background: 'var(--surface)',
        cursor: 'pointer',
      }}
    >
      <div>
        {/* Status Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge>
        </div>

        {/* Title & Metadata or Description */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {type.name} {type.name.toLowerCase().includes('assessment') ? '' : 'Assessment'}
          </span>

          {hasRecord ? (
            <div className="col gap-2 fade-in" style={{ marginTop: 12, fontSize: 13, color: 'var(--text-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 6 }}>
                <span>{isDraft ? 'Last Saved:' : 'Submitted On:'}</span>
                <strong style={{ color: 'var(--text)' }}>{fmtDate(record.updatedAt || record.createdAt)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>Submitted By:</span>
                <strong style={{ color: 'var(--text)' }}>{record.submittedBy?.name || record.createdBy?.name || '—'}</strong>
              </div>
            </div>
          ) : (
            <span className="fade-in" style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5, marginTop: 4 }}>
              {description}
            </span>
          )}
        </div>
      </div>

      {/* Button Actions Block */}
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-outline-primary fade-in"
          onClick={(e) => { e.stopPropagation(); handleClick(); }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {!hasRecord && (<><Plus size={15} strokeWidth={2.5} /> New Assessment</>)}
          {hasRecord && isDraft && (<><Play size={13} strokeWidth={2.5} /> Continue</>)}
          {hasRecord && !isDraft && (<><FileText size={13} strokeWidth={2.5} /> View Report <ArrowRight size={13} /></>)}
        </button>
      </div>
    </div>
  );
}

export default AssessmentCard;
