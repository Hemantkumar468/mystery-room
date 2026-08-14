import { RotateCcw, RotateCw, Mountain, Compass, Play, Pause } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectTourMode, tourModeToggled } from '../../app/slices/mapSlice.js';
import { prefersReducedMotion } from '../../hooks/useFlyTo.js';

/**
 * On-screen camera controls: rotate, tilt, reset north, auto-orbit.
 *
 * WHY THESE EXIST WHEN MAPLIBRE ALREADY ROTATES. Its rotation gestures are
 * right-drag and ctrl-drag — both real, both completely undiscoverable. A user
 * told the map rotates will left-drag it, watch it pan, and conclude it does
 * not. Buttons make the capability visible; the gestures still work for anyone
 * who knows them, and the compass in the corner still resets with one click.
 *
 * These drive the live map imperatively rather than through Redux. Bearing and
 * pitch change continuously during an animation, and pushing sixty frames a
 * second of them through a store would re-render every connected component for
 * the duration of a drag. The map owns its camera; this asks it to move.
 * `tourMode` is the exception — it is a persisted preference, not a position.
 */
export function ViewControls({ map }) {
  const dispatch = useAppDispatch();
  const tourMode = useAppSelector(selectTourMode);
  const reducedMotion = prefersReducedMotion();

  if (!map) return null;

  /** Turn by a fixed step, animated unless the OS asked us not to animate. */
  const rotateBy = (degrees) => {
    const next = map.getBearing() + degrees;
    if (reducedMotion) map.setBearing(next);
    else map.easeTo({ bearing: next, duration: 420 });
  };

  /**
   * Tilt between flat and a strong 3D angle.
   *
   * A toggle rather than a slider: the two useful answers are "show me the
   * shape of this" and "let me read it like a chart", and everything between
   * is available by dragging anyway.
   */
  const togglePitch = () => {
    const isFlat = map.getPitch() < 15;
    const next = isFlat ? 55 : 0;
    if (reducedMotion) map.setPitch(next);
    else map.easeTo({ pitch: next, duration: 520 });
  };

  /** North up, flat — the way out of any camera someone has got lost in. */
  const resetNorth = () => {
    if (reducedMotion) { map.setBearing(0); map.setPitch(0); return; }
    map.easeTo({ bearing: 0, pitch: 0, duration: 520 });
  };

  return (
    <div className="mr-map-viewctl" role="group" aria-label="Map camera controls">
      <button
        type="button"
        className="mr-map-viewctl__btn"
        onClick={() => rotateBy(-30)}
        aria-label="Rotate the map 30 degrees anticlockwise"
        title="Rotate left (or right-drag the map)"
      >
        <RotateCcw size={15} />
      </button>

      <button
        type="button"
        className="mr-map-viewctl__btn"
        onClick={() => rotateBy(30)}
        aria-label="Rotate the map 30 degrees clockwise"
        title="Rotate right (or right-drag the map)"
      >
        <RotateCw size={15} />
      </button>

      <button
        type="button"
        className="mr-map-viewctl__btn"
        onClick={togglePitch}
        aria-label="Toggle between the tilted 3D view and a flat top-down one"
        title="Tilt / flatten"
      >
        <Mountain size={15} />
      </button>

      <button
        type="button"
        className="mr-map-viewctl__btn"
        onClick={resetNorth}
        aria-label="Reset the map to north-up and flat"
        title="Reset to north"
      >
        <Compass size={15} />
      </button>

      {/*
        Auto-orbit is hidden entirely under prefers-reduced-motion rather than
        shown disabled: a control whose only function is continuous movement
        has nothing to offer someone who has asked for none.
      */}
      {!reducedMotion && (
        <button
          type="button"
          className="mr-map-viewctl__btn"
          aria-pressed={tourMode}
          onClick={() => dispatch(tourModeToggled())}
          aria-label={tourMode ? 'Stop rotating the map automatically' : 'Rotate the map automatically'}
          title={tourMode ? 'Stop auto-orbit' : 'Auto-orbit 360°'}
          style={tourMode ? { color: 'var(--primary)' } : undefined}
        >
          {tourMode ? <Pause size={15} /> : <Play size={15} />}
        </button>
      )}
    </div>
  );
}

export default ViewControls;
