import { createSlice, createSelector } from '@reduxjs/toolkit';
import {
  ACCESS, atLeast, isVisible, surfaceKey, setAccessLevels, clearAccessLevels,
} from '../../lib/access.js';

/**
 * The signed-in person's effective access map, in Redux.
 *
 * Two homes for one fact, deliberately, and the split is the same one
 * `authSlice` already makes with the access token: components need to
 * RE-RENDER when the answer changes, which only a store subscription gives
 * them, while plain helpers under `lib/` need to READ it from places that
 * have no hooks and may not import from `app/`. This slice owns the first
 * half and mirrors into `lib/access.js` for the second.
 *
 * ONE WRITER. `accessLoaded` is dispatched by accessApi's `onQueryStarted`
 * and by nothing else, so the two copies cannot drift.
 */

const initialState = {
  /** null until /access/me answers. Not {} — see lib/access.js#levelOf. */
  levels: null,
  role: null,
  /** True when somebody has decided part of this person's access by name. */
  hasOverrides: false,
  loaded: false,
};

const accessSlice = createSlice({
  name: 'access',
  initialState,
  reducers: {
    accessLoaded: (state, action) => {
      state.levels = action.payload?.levels ?? null;
      state.role = action.payload?.role ?? null;
      state.hasOverrides = Boolean(action.payload?.hasOverrides);
      state.loaded = true;
      /* Mirrored here rather than in a listener: this is the only place the
         map is ever set, so keeping the two copies together is what makes
         "they cannot drift" checkable by reading one function. */
      setAccessLevels(state.levels);
    },

    /** On logout. Leaving a map behind would let the next person inherit it. */
    accessCleared: (state) => {
      state.levels = null;
      state.role = null;
      state.hasOverrides = false;
      state.loaded = false;
      clearAccessLevels();
    },
  },
});

export const { accessLoaded, accessCleared } = accessSlice.actions;

export const selectAccessLevels = (state) => state.access.levels;
export const selectAccessReady = (state) => state.access.loaded;
export const selectHasOwnOverrides = (state) => state.access.hasOverrides;

/**
 * The bound helpers components use. Memoised on the map itself, so every
 * consumer of `useAccess()` shares one object and a re-render only happens
 * when the policy actually changed.
 */
export const selectAccess = createSelector([selectAccessLevels, selectAccessReady], (levels, loaded) => {
  const levelOf = (key) => (levels ? levels[key] : undefined);
  /* Unknown surface -> allowed. A screen that has not been registered in the
     catalogue yet must not vanish; see lib/access.js#levelOf. */
  const can = (key, need = ACCESS.VIEW) => {
    const have = levelOf(key);
    return have === undefined ? true : atLeast(have, need);
  };
  const shows = (key) => {
    const have = levelOf(key);
    return have === undefined ? true : isVisible(have);
  };

  return {
    loaded,
    levels,
    levelOf,
    can,
    /** Is this surface visible at all? */
    shows,
    /** Sugar, so callers never hand-build a namespaced key. */
    module: (id, need) => can(surfaceKey.module(id), need),
    step: (id, need) => can(surfaceKey.step(id), need),
    stage: (id, need) => can(surfaceKey.stage(id), need),
    showsModule: (id) => shows(surfaceKey.module(id)),
    showsStep: (id) => shows(surfaceKey.step(id)),
    showsStage: (id) => shows(surfaceKey.stage(id)),
    levelOfStep: (id) => levelOf(surfaceKey.step(id)),
    levelOfModule: (id) => levelOf(surfaceKey.module(id)),
  };
});

export default accessSlice.reducer;
