import { describe, expect, it } from 'vitest';
import { isTopLevelNavPath } from './navDestinations.js';
import { PMS_NAV, MASTER_NAV, ADMIN_NAV } from './Sidebar.jsx';

/**
 * Topbar hides its back arrow on the sidebar's own destinations — they are all
 * one click away from each other in the rail, so "back" there only replays
 * history. The set is derived from the nav arrays rather than hand-written,
 * and this pins both halves of that: every rendered entry is covered, and the
 * detail pages underneath them are not.
 */
describe('isTopLevelNavPath', () => {
  it('covers every destination the sidebar renders', () => {
    for (const item of [...PMS_NAV, ...MASTER_NAV, ...ADMIN_NAV]) {
      expect(isTopLevelNavPath(item.to), item.to).toBe(true);
    }
  });

  it('covers the sidebar entries a module config contributes', () => {
    expect(isTopLevelNavPath('/hrms/candidates')).toBe(true);
    expect(isTopLevelNavPath('/purchase/orders')).toBe(true);
    expect(isTopLevelNavPath('/purchase/receipts')).toBe(true);
    expect(isTopLevelNavPath('/franchise/enquiries')).toBe(true);
  });

  it('leaves the pages below them alone', () => {
    // Detail and report pages: the sidebar cannot reach these, so back is the
    // only way up and must stay.
    expect(isTopLevelNavPath('/projects/abc123')).toBe(false);
    expect(isTopLevelNavPath('/my-tasks/T007')).toBe(false);
    expect(isTopLevelNavPath('/hrms/candidates/42')).toBe(false);
    expect(isTopLevelNavPath('/login')).toBe(false);
  });

  it('treats a trailing slash as the same page', () => {
    expect(isTopLevelNavPath('/projects/')).toBe(true);
    expect(isTopLevelNavPath('/')).toBe(true);
    expect(isTopLevelNavPath('')).toBe(true);
  });
});
