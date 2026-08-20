import { useMemo, useState } from 'react';
import {
  BookOpen, Search, Play, ListOrdered, ChevronDown, ChevronRight, Clock, X,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { GUIDE_MODULES, guidesForRole } from './guides.js';
import { useGuide } from './GuideContext.jsx';

/**
 * The User Guide centre — every module's guides, filtered to what THIS role
 * can actually do, searchable, each one available three ways:
 *
 *   ▶ Walk me through   — the interactive tour, you click Next
 *   ⏵ Auto-play         — the same tour advancing by itself
 *   ☰ Read the steps    — the written version, expandable in place
 *
 * Role filtering is the point, not decoration: a Viewer is never taught
 * buttons they don't have, and an Employee's list leads with their own flow.
 * New modules (CRM, HRMS…) appear here by registering in guides.js — this
 * page renders whatever is registered. See docs/USER_GUIDE_SYSTEM.md.
 */

/** Rough reading/watching time: one step ≈ its auto-advance interval. */
const minutesFor = (guide) =>
  Math.max(1, Math.round(((guide.steps.length * (guide.autoAdvanceMs || 8000)) / 60000)));

const ROLE_LABEL = {
  md: 'MD', ea: 'EA', manager: 'Managers', employee: 'Employees', viewer: 'Viewers',
};

export default function UserGuidePage() {
  const user = useAppSelector(selectCurrentUser);
  const { start } = useGuide();
  const [q, setQ] = useState('');
  const [openSteps, setOpenSteps] = useState(null); // guide.key whose written steps are open

  /* Modules narrowed to this role, then to the search. Searching looks inside
     step text too — "checklist" should find the doer guide even though the
     word is not in its title. */
  const modules = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return GUIDE_MODULES.map((m) => ({
      ...m,
      guides: guidesForRole(m, user?.role).filter((g) => {
        if (!needle) return true;
        const hay = [
          g.title, g.description,
          ...g.steps.flatMap((s) => [s.title, s.body]),
        ].join(' ').toLowerCase();
        return hay.includes(needle);
      }),
    })).filter((m) => m.guides.length > 0);
  }, [q, user]);

  return (
    <>
      <Topbar title="User Guide" />
      <div className="content col gap-4">
        <div className="ug-hero">
          <div className="ug-hero-text">
            <h1>Learn the system by using it</h1>
            <p>
              Every guide here can walk you through the real screens, step by step —
              or play itself while you watch. Pick what you are about to do.
              You are seeing the guides for <strong>your role</strong>; buttons you
              don&rsquo;t have are never taught to you.
            </p>
          </div>
          <div className="proj-search ug-search">
            <Search size={15} />
            <input
              style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'var(--text)' }}
              placeholder="Search the guides — try “checklist”, “approve”, “vendor”…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button type="button" className="gd-icon" onClick={() => setQ('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {modules.length === 0 ? (
          <EmptyState icon={BookOpen} title="Nothing matches that search" hint="Try a different word — or clear the search." />
        ) : modules.map((m) => (
          <section key={m.key} className="col gap-3">
            <div>
              <h2 className="ug-module">{m.label}</h2>
              <p className="ug-module-sub">{m.description}</p>
            </div>

            <div className="ug-grid">
              {m.guides.map((g) => {
                const stepsOpen = openSteps === g.key;
                return (
                  <article key={g.key} className="ug-card">
                    <div className="ug-card-head">
                      <h3>{g.title}</h3>
                      <span className="ug-mins"><Clock size={11} /> ~{minutesFor(g)} min</span>
                    </div>
                    <p className="ug-desc">{g.description}</p>
                    <div className="ug-meta">
                      {g.roles
                        ? g.roles.map((r) => <Badge key={r} soft="var(--surface-2)">{ROLE_LABEL[r] || r}</Badge>)
                        : <Badge soft="var(--surface-2)">Everyone</Badge>}
                      <span className="tiny muted">{g.steps.length} steps</span>
                    </div>

                    <div className="ug-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => start(g)}>
                        Walk me through
                      </button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        title={`Plays by itself, one step every ${Math.round((g.autoAdvanceMs || 8000) / 1000)} seconds`}
                        onClick={() => start(g, { autoplay: true })}
                      >
                        <Play size={13} /> Auto-play
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setOpenSteps(stepsOpen ? null : g.key)}
                        aria-expanded={stepsOpen}
                      >
                        <ListOrdered size={13} /> Read {stepsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    </div>

                    {stepsOpen && (
                      <ol className="ug-steps">
                        {g.steps.map((s) => (
                          <li key={s.title}>
                            <strong>{s.title}.</strong> {s.body}
                          </li>
                        ))}
                      </ol>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        <p className="tiny muted" style={{ maxWidth: '70ch' }}>
          A tour can be exited any time with Esc, stepped with the arrow keys, and paused
          from its own card. Nothing a tour shows can change your data — it only points.
        </p>
      </div>
    </>
  );
}
