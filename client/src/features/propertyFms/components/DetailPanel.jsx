import { X, Building2 } from 'lucide-react';

/**
 * The right-hand panel every phase page opens when a row is selected. Shell
 * only — tabs switch what `children` the caller renders, so each page's own
 * "Details / Documents / Activity …" set can differ while the frame (image,
 * headline, badge, close button, footer actions) stays identical everywhere.
 */
export function DetailPanel({
  icon: Icon = Building2,
  title, eyebrow, badge,
  tabs, activeTab, onTabChange,
  onClose,
  children,
  footer,
}) {
  return (
    <aside className="fms-detail">
      <div className="fms-detail-tabbar">
        <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`fms-detail-tab${activeTab === t.key ? ' active' : ''}`}
              onClick={() => onTabChange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="fms-detail-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="fms-detail-body">
        <div className="fms-detail-image">
          <Icon size={30} strokeWidth={1.4} />
        </div>

        <div className="col gap-1">
          {eyebrow}
          <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 className="fms-detail-title">{title}</h3>
            {badge}
          </div>
        </div>

        {children}
      </div>

      {footer && <div className="fms-detail-footer">{footer}</div>}
    </aside>
  );
}

export default DetailPanel;
