import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { containsBackControl } from './BackButton.jsx';

/**
 * Topbar draws a back button on every page, and stands down on the ~30 pages
 * that already draw their own inside the title they hand it. Getting this
 * wrong shows up as two arrows side by side, so the title shapes those pages
 * actually use are pinned here.
 *
 * Written with createElement rather than JSX only because this suite runs on
 * `src/**\/*.test.js` — see vite.config.js. It is a pure-function test either
 * way; nothing is rendered.
 */
describe('containsBackControl', () => {
  it('is false for the plain string titles most pages pass', () => {
    expect(containsBackControl('Leads')).toBe(false);
    expect(containsBackControl(null)).toBe(false);
    expect(containsBackControl(undefined)).toBe(false);
  });

  it('finds the arrow nested in a page-built title', () => {
    // ProjectDetailPage's exact shape.
    const title = h(
      'span',
      { className: 'row gap-3' },
      h('button', { className: 'btn btn-ghost btn-icon' }, h(ArrowLeft, { size: 16 })),
      'Project',
    );
    expect(containsBackControl(title)).toBe(true);
  });

  it('finds a back control identified only by its label', () => {
    const title = h(
      'span',
      null,
      h('button', { 'aria-label': 'Back to project' }, '\u27F5'),
      'Approval Workflow',
    );
    expect(containsBackControl(title)).toBe(true);
  });

  it('ignores other icons and other labelled buttons in a title', () => {
    const title = h(
      'span',
      { className: 'row gap-2' },
      'Site Evaluation',
      h('button', { 'aria-label': 'Next property' }, h(ChevronRight, { size: 13 })),
    );
    expect(containsBackControl(title)).toBe(false);
  });

  it('walks arrays of children', () => {
    expect(containsBackControl([h('span', { key: 'a' }, 'Tasks'), h(ArrowLeft, { key: 'b', size: 16 })])).toBe(true);
  });
});
