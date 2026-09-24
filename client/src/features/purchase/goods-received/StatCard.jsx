/**
 * One KPI. `tone` colours the icon well only — see the note in
 * goodsReceived.css about why the number itself stays neutral.
 */
export function StatCard({ icon: Icon, label, value, hint, tone = 'plain', money = false }) {
  return (
    <article className={`gr-stat t-${tone}`}>
      <span className="gr-stat-icon">{Icon && <Icon size={24} strokeWidth={2} />}</span>
      <div className="gr-stat-body">
        <span className="gr-stat-label">{label}</span>
        <span className={`gr-stat-value${money ? ' is-money' : ''}`}>{value}</span>
        {hint && <span className="gr-stat-hint">{hint}</span>}
      </div>
    </article>
  );
}

export default StatCard;
