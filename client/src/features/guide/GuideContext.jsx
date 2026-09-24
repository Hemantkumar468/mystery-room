import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  X, ChevronLeft, ChevronRight, Play, Pause, Sparkles,
} from 'lucide-react';

/**
 * The tour engine. A tour is a list of steps (see guides.js); this renders one
 * step at a time as either
 *   - a SPOTLIGHT: the page dims, the target element stays lit and a card sits
 *     beside it, or
 *   - a CENTRED CARD, when the step has no selector or the element is not on
 *     the page (steps about data-dependent screens degrade gracefully instead
 *     of breaking the tour).
 *
 * Auto-play advances every `autoAdvanceMs` (per guide, default 8s) and stops on
 * the last step. Arrow keys step, Escape exits. The overlay never captures the
 * spotlighted element's clicks — the dimmed area does, so a stray click can't
 * fall through onto the app mid-tour.
 */

const GuideContext = createContext(null);

export const useGuide = () => useContext(GuideContext);

export function GuideProvider({ children }) {
  const [active, setActive] = useState(null); // { guide, moduleKey }
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const start = useCallback((guide, { autoplay = false } = {}) => {
    setActive({ guide });
    setStepIndex(0);
    setPlaying(autoplay);
  }, []);

  const stop = useCallback(() => { setActive(null); setPlaying(false); }, []);

  const value = useMemo(
    () => ({ active, stepIndex, playing, start, stop, setStepIndex, setPlaying }),
    [active, stepIndex, playing, start, stop],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {active && <GuideOverlay />}
    </GuideContext.Provider>
  );
}

/** Rect of the current step's target, re-measured while the tour is on it. */
function useTargetRect(selector, routeReady) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!selector || !routeReady) { setRect(null); return undefined; }
    let raf = null;
    let tries = 0;
    let interval = null;

    const measure = () => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      return true;
    };

    // The element may render a moment after navigation — poll briefly, then
    // keep tracking so scrolling/resizing moves the spotlight with it.
    const settle = () => {
      if (measure()) {
        const el = document.querySelector(selector);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        interval = setInterval(measure, 250);
      } else if (tries++ < 20) {
        raf = setTimeout(settle, 150);
      } else {
        setRect(null); // never appeared — the overlay falls back to a centred card
      }
    };
    settle();

    const onWin = () => measure();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return () => {
      clearTimeout(raf);
      clearInterval(interval);
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
    };
  }, [selector, routeReady]);

  return rect;
}

function GuideOverlay() {
  const { active, stepIndex, playing, stop, setStepIndex, setPlaying } = useGuide();
  const navigate = useNavigate();
  const location = useLocation();

  const guide = active.guide;
  const steps = guide.steps || [];
  const step = steps[stepIndex] || steps[0];
  const isLast = stepIndex >= steps.length - 1;

  /* Route first, spotlight second: a step that lives on another page navigates
     there, and measuring waits until the URL agrees. */
  const routeReady = !step.route || location.pathname === step.route;
  useEffect(() => {
    if (step.route && location.pathname !== step.route) navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  const rect = useTargetRect(step.selector, routeReady);

  const next = useCallback(() => {
    if (isLast) { stop(); return; }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [isLast, stop, setStepIndex, steps.length]);

  const prev = useCallback(() => setStepIndex((i) => Math.max(i - 1, 0)), [setStepIndex]);

  /* Auto-play: one timer per step, so reading time restarts on every advance.
     Stops itself on the last step rather than looping — a guide that restarts
     unasked stops being a guide. */
  useEffect(() => {
    if (!playing) return undefined;
    if (isLast) { setPlaying(false); return undefined; }
    const t = setTimeout(next, guide.autoAdvanceMs || 8000);
    return () => clearTimeout(t);
  }, [playing, stepIndex, isLast, next, guide.autoAdvanceMs, setPlaying]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') stop();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop, next, prev]);

  /* Card placement: under the target if there is room, above it otherwise,
     clamped to the viewport; centred when there is no target. */
  const cardStyle = useMemo(() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    const CARD_W = 380;
    const below = rect.top + rect.height + 16;
    const spaceBelow = window.innerHeight - below;
    const top = spaceBelow > 240 ? below : Math.max(16, rect.top - 16 - 220);
    const left = Math.min(Math.max(16, rect.left), window.innerWidth - CARD_W - 16);
    return { top, left };
  }, [rect]);

  return (
    <div className="gd-root" role="dialog" aria-modal="true" aria-label={`Guide: ${guide.title}`}>
      {/* Dimmer: with a target it is the spotlight's shadow; without, a plain veil. */}
      {rect ? (
        <div
          className="gd-spot"
          style={{
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
          }}
        />
      ) : (
        <div className="gd-veil" />
      )}

      <div className="gd-card" style={cardStyle}>
        <div className="gd-card-top">
          <span className="gd-kicker"><Sparkles size={12} /> {guide.title}</span>
          <button type="button" className="gd-icon" onClick={stop} aria-label="Exit guide"><X size={15} /></button>
        </div>

        <h3 className="gd-title">{step.title}</h3>
        <p className="gd-body">{step.body}</p>

        <div className="gd-progress" aria-hidden>
          {steps.map((s, i) => (
            <button
              type="button"
              key={s.title}
              className={`gd-dot${i === stepIndex ? ' is-on' : ''}${i < stepIndex ? ' is-done' : ''}`}
              onClick={() => setStepIndex(i)}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        <div className="gd-controls">
          <span className="gd-count">Step {stepIndex + 1} of {steps.length}</span>
          <span className="gd-buttons">
            <button
              type="button"
              className="gd-icon"
              onClick={() => setPlaying((p) => !p)}
              title={playing ? 'Pause auto-play' : `Auto-play (advances every ${Math.round((guide.autoAdvanceMs || 8000) / 1000)}s)`}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={prev} disabled={stepIndex === 0}>
              <ChevronLeft size={14} /> Back
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={next}>
              {isLast ? 'Finish' : 'Next'} {!isLast && <ChevronRight size={14} />}
            </button>
          </span>
        </div>

        {playing && !isLast && (
          <div className="gd-timer" key={stepIndex} style={{ animationDuration: `${guide.autoAdvanceMs || 8000}ms` }} />
        )}
      </div>
    </div>
  );
}

export default GuideProvider;
