import { useDispatch, useSelector } from 'react-redux';

/**
 * Thin wrappers over react-redux's hooks.
 *
 * In a TypeScript codebase these would carry the store's types; here they
 * exist for a simpler reason — so that components import from one place. If
 * the store ever gains typing, or needs an app-specific default (a shallow
 * equality selector, say), there is a single seam to change rather than every
 * call site.
 *
 * Convention: components use these, never `useDispatch`/`useSelector` directly.
 */
export const useAppDispatch = () => useDispatch();
export const useAppSelector = useSelector;

export default { useAppDispatch, useAppSelector };
