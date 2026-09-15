/** One labeled fact row inside a DetailPanel section — an icon, a small
 * caption, and the value, stacked the same way on every phase page. */
export function Fact({ icon: Icon, label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="fms-fact">
      {Icon && <Icon size={13} className="fms-fact-icon" />}
      <div className="col" style={{ gap: 1, minWidth: 0 }}>
        <span className="fms-fact-label">{label}</span>
        <span className="fms-fact-value">{value}</span>
      </div>
    </div>
  );
}

/** A titled group of Fact rows, with a light divider above it. */
export function FactSection({ title, children }) {
  return (
    <div className="fms-fact-section">
      {title && <div className="fms-fact-section-title">{title}</div>}
      <div className="fms-fact-grid">{children}</div>
    </div>
  );
}

export default Fact;
