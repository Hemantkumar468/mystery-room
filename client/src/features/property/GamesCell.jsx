import { Gamepad2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';

/**
 * How many games this outlet will hold, and which ones.
 *
 * THE PROBLEM THIS SOLVES. An outlet can hold anything from one game to
 * twenty-three. Printing every name makes the row as tall as a paragraph and
 * ruins the column for every other row in the table; printing only a count
 * answers "how many" but never "which", which is the question somebody
 * scanning this step is usually asking.
 *
 * So the cell leads with the COUNT — one glance, always the same height — and
 * names as many as fit on one line. The rest are behind a link that says how
 * many it is hiding, because "+11 more" is a fact somebody can act on and a
 * bare "…" is not.
 */
const PREVIEW = 2;

export function GamesCell({ row, onOpen }) {
  const games = row.plan?.games || [];
  const n = row.plan?.gameCount ?? games.length;

  if (!row.plan) return <span className="prop-dim">Not planned</span>;
  if (!n) return <span className="prop-dim">None chosen yet</span>;

  const shown = games.slice(0, PREVIEW);
  const hidden = Math.max(n - shown.length, 0);

  return (
    <div className="pg-cell">
      <span className="pg-count" title={`${n} game${n === 1 ? '' : 's'} selected`}>
        <Gamepad2 size={11} /> {n}
      </span>
      {shown.map((g) => <span key={g} className="prop-chip" title={g}>{g}</span>)}
      {hidden > 0 && (
        <button type="button" className="pg-more" onClick={() => onOpen(row)}>
          +{hidden} more
        </button>
      )}
      {hidden === 0 && games.length > 0 && (
        /* Even with nothing hidden the list stays reachable — the names are
           truncated to fit the column, and "see them in full" should not
           depend on whether there happened to be a third one. */
        <button type="button" className="pg-more is-quiet" onClick={() => onOpen(row)}>View</button>
      )}
    </div>
  );
}

/** Every game chosen for one outlet, in full. */
export function GamesModal({ row, onClose }) {
  const games = row.plan?.games || [];
  return (
    <Modal
      open
      onClose={onClose}
      title={`${games.length} game${games.length === 1 ? '' : 's'} for ${row.title}`}
      subtitle={[row.city, row.plan?.confirmedArea ? `${Number(row.plan.confirmedArea).toLocaleString('en-IN')} sq ft confirmed` : null]
        .filter(Boolean).join(' · ')}
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    >
      {games.length === 0 ? (
        <p className="sm muted" style={{ margin: 0 }}>No games have been chosen for this outlet yet.</p>
      ) : (
        /* Numbered, because "is Kohinoor on the list?" and "how many are
           there?" are both asked of this, and a numbered list answers the
           second one without anybody counting. */
        <ol className="pg-list">
          {games.map((g) => <li key={g}>{g}</li>)}
        </ol>
      )}
    </Modal>
  );
}

export default GamesCell;
