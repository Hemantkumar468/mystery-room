import { Lock } from 'lucide-react';
import { InfoPanel } from './primitives.jsx';

/** True once a project has gone live (Phase 9's Launch Store) or been archived
 * (Phase 10's Archive Project) — both one-way doors, see PROJECT_STATUS's doc
 * comments on the server. Every Phase 1-8 page uses this single check for its
 * soft read-only lock instead of duplicating the string comparison. */
export function useProjectReadOnly(project) {
  return project?.status === 'store_live' || project?.status === 'archived';
}

/** True only for the terminal archived state — Phase 9 and 10's own surfaces
 * stay editable after go-live but lock completely once archived. */
export function useProjectArchived(project) {
  return project?.status === 'archived';
}

/** Banner shown at the top of a Phase 1-8 page once the project has gone
 * live — data stays visible, but the page's own action buttons should be
 * disabled alongside this (see each page's `readOnly` usage). */
export function ReadOnlyProjectBanner() {
  return (
    <InfoPanel icon={Lock} tone="info" title="Project Closed — Read Only">
      This store has gone live. Earlier phases are preserved for reference and can no longer be edited.
    </InfoPanel>
  );
}

export default ReadOnlyProjectBanner;
