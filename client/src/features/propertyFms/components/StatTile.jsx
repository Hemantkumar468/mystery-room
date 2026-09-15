import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/** One stat card: icon, big number, label, one-line sub-caption. `onClick`
 * (or `to`) makes it a jump to the filtered view the number describes. */
export function StatTile({ icon: Icon, value, label, sub, tone = '#6366f1', to, onClick }) {
  const navigate = useNavigate();
  const clickable = Boolean(to || onClick);
  const handleClick = clickable ? () => (onClick ? onClick() : navigate(to)) : undefined;
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag type={clickable ? 'button' : undefined} className={`fms-stat${clickable ? ' is-link' : ''}`} onClick={handleClick}>
      <span className="fms-stat-icon" style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
        <Icon size={19} />
      </span>
      <div className="col gap-1" style={{ minWidth: 0, flex: 1 }}>
        <span className="fms-stat-value">{value}</span>
        <span className="fms-stat-label">{label}</span>
        {sub && <span className="fms-stat-sub">{sub}</span>}
      </div>
      {clickable && <ChevronRight size={16} className="fms-stat-chevron" />}
    </Tag>
  );
}

export default StatTile;
