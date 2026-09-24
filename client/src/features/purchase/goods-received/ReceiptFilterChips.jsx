/**
 * The status row. Every chip carries its own count, computed against the
 * FULL receipt set rather than the filtered one — a chip that reads "0"
 * because another chip is currently active tells the reader nothing about
 * where the work is.
 */
export function ReceiptFilterChips({ chips, active, counts, onPick }) {
  return (
    <div className="gr-chips" id="gr-chips" role="tablist" aria-label="Receipt status">
      {chips.map((c) => (
        <button
          type="button"
          key={c.key}
          role="tab"
          aria-selected={active === c.key}
          className={`gr-chip${active === c.key ? ' is-on' : ''}`}
          onClick={() => onPick(c.key)}
        >
          {c.label}
          <span className="gr-chip-n">{counts[c.key]}</span>
        </button>
      ))}
    </div>
  );
}

export default ReceiptFilterChips;
