import { Link } from 'react-router-dom';
import { LayoutList, ArrowRight } from 'lucide-react';

/**
 * The bridge from a phase's REGISTER to its BOARD.
 *
 * Three phases of the client flow have a purpose-built overview beside their
 * form: the drawing checklist (Phase 5), the seven-BOQ workspace (Phase 7) and
 * the contracts screen (Phase 8).
 *
 * ── Why a link and not a redirect ────────────────────────────────────
 * The obvious move is to add these to DEDICATED_PHASE_PATHS so the phase opens
 * on its board — which is what p15 does. That would be wrong here. p15 has no
 * form of its own: the tracker IS the phase. These three have real forms, and
 * filing a drawing, a BOQ line or a contract happens on the register. Sending
 * "Open the phase" to a read-only board would leave a doer with no way to do
 * the work they were assigned.
 *
 * So the register stays the phase, and this points at the view over it. The
 * boards link back the same way, so the pair is navigable in both directions.
 */
const BOARDS = {
  p11: {
    path: 'drawings',
    label: 'Open the drawing checklist',
    hint: 'All 37 drawings in two sets, with what Set 1 still owes the BOQ.',
  },
  p12: {
    path: 'vendor-panel',
    label: 'Open the vendor & contractor panel',
    hint: 'Seven rows, one per BOQ — which team, at what rate, and their rate cards.',
  },
  p13: {
    path: 'boq',
    label: 'Open the BOQ list in Purchase',
    hint: 'The six BOQs for this centre. Choose one, then add its item lines.',
  },
  p21: {
    path: 'contracts',
    label: 'Open the contracts board',
    hint: 'What is signed, and which BOQ lines it releases for ordering.',
  },
};

export function PhaseBoardLink({ stageKey, projectId }) {
  const board = BOARDS[stageKey];
  if (!board || !projectId) return null;
  const href = stageKey === 'p13'
    ? `/purchase/orders?project=${encodeURIComponent(projectId)}`
    : `/projects/${projectId}/${board.path}`;

  return (
    <Link
      to={href}
      className="card"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px',
        textDecoration: 'none', color: 'inherit', borderLeft: '3px solid var(--primary)',
      }}
    >
      <LayoutList size={17} style={{ color: 'var(--primary)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{board.label}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{board.hint}</div>
      </div>
      <ArrowRight size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
    </Link>
  );
}

export default PhaseBoardLink;
