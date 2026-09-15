import { FMS_PHASES } from '../propertyFmsUi.js';

/**
 * The banner every Property FMS page opens with: an icon + title + one-line
 * purpose on the left, a short italic quote in the middle, and which phase
 * this is (X of 6) on the right. Sits below the app's own Topbar — this is
 * the module's own header, not a replacement for it.
 */
export function PhaseHero({ icon: Icon, title, subtitle, quote, phaseKey }) {
  const phase = FMS_PHASES.find((p) => p.key === phaseKey);
  return (
    <div className="fms-hero">
      <div className="fms-hero-main">
        {Icon && (
          <span className="fms-hero-icon">
            <Icon size={22} />
          </span>
        )}
        <div className="col gap-1" style={{ minWidth: 0 }}>
          <h1 className="fms-hero-title">{title}</h1>
          {subtitle && <p className="fms-hero-subtitle">{subtitle}</p>}
        </div>
      </div>

      {quote && (
        <div className="fms-hero-quote">
          <span className="fms-hero-quote-rule" />
          <p>&ldquo;{quote}&rdquo;</p>
        </div>
      )}

      {phase && (
        <div className="fms-hero-phase">
          <span className="fms-hero-phase-badge">Phase {phase.order} of {FMS_PHASES.length}</span>
          <span className="fms-hero-phase-sub">{phase.sub}</span>
        </div>
      )}
    </div>
  );
}

export default PhaseHero;
