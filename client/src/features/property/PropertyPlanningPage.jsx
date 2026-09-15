import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2 } from 'lucide-react';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropTable } from './PropTable.jsx';
import {
  PropertyCell, PropertyToolbar, PageHead, PropEmpty, Badge,
  filesColumn,
} from './propertyUi.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';

/**
 * Step 4 — Project & Games Planning.
 *
 * WHAT THIS STEP IS. Phase 4 (`p20`, "Project Planning & Games") already owns
 * this work: which games the outlet will hold, the opening date, the trial run.
 * The form was built once, in the project, and this page links to it rather
 * than growing a second copy. The same is true of Project Creation, which is
 * the `project_creation` document filed in commercial closure.
 *
 * THE LOI IS A SIGNAL, NOT A GATE, and that is the point of the design. Signed
 * and uploaded, the site is committed and planning it is safe — the row leads
 * with it. But a landlord who takes three weeks to sign should not stop us
 * choosing games for a site we are sure about, so the button works either way
 * and simply warns when the LOI is not in yet. A hard lock here would mean the
 * one thing the client asked for could not happen.
 *
 * EVERY COMMERCIAL PROPERTY IS LISTED, not only the ones already being
 * planned. This step is where you come to START planning, so a property with
 * no plan yet is exactly the row you are looking for.
 */
const fmtDate = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.valueOf())
    ? String(d)
    : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
};

/** Sorts a date column by its real instant, not by the text we print. */
const dateValue = (d) => {
  if (!d) return null;
  const t = new Date(d).valueOf();
  return Number.isNaN(t) ? null : t;
};

/** What to say when the step is genuinely empty rather than just filtered. */
const EMPTY_HINT = 'A property reaches this step once it is in commercial closure.';

export default function PropertyPlanningPage() {
  const navigate = useNavigate();
  const q = usePropertyQuery('commercial');
  const [media, setMedia] = useState(null);

  /** Phase 4's own form — games, opening date, trial run. */
  const openPlan = (r) => navigate(`/projects/${r.projectId}?stage=p20`);
  /** The Project Creation document, filed in commercial closure. */
  const openCreation = (r) => navigate(`/projects/${r.projectId}/commercial-finalization?form=project_creation`);

  const columns = useMemo(() => [
    {
      key: 'action', label: 'Action', width: 236,
      render: (r) => {
        const planned = Boolean(r.plan);
        return (
          <div className="prop-action-cell">
            <button
              type="button"
              className={`prop-action-btn${r.loiFiled || planned ? '' : ' is-quiet'}`}
              onClick={() => openPlan(r)}
              title={r.loiFiled
                ? 'Choose games and fix the dates'
                : 'The LOI is not filed yet — you can still plan, but the site is not committed'}
            >
              <Gamepad2 size={13} /> {planned ? 'Open plan' : 'Plan games'}
            </button>
            <button type="button" className="prop-open" onClick={() => openCreation(r)} title="The Project Creation document">
              Create ›
            </button>
          </div>
        );
      },
    },
    { key: 'title', label: 'Property', width: 235, sort: true, render: (r) => <PropertyCell row={r} /> },
    filesColumn(setMedia),
    { key: 'city', label: 'City', width: 100, sort: true, render: (r) => r.city || <span className="prop-dim">—</span> },
    {
      key: 'loi', label: 'LOI', width: 112,
      /* Signed outranks uploaded outranks nothing — sorting this column should
         bring the committed sites to the top, not alphabetise three words. */
      sort: true,
      render: (r) => (r.loiDone ? <Badge kind="captured">Signed</Badge>
        : r.loiFiled ? <Badge kind="commercial">Uploaded</Badge>
          : <Badge kind="wanted">Not filed</Badge>),
    },
    {
      key: 'games', label: 'Games selected', width: 196, sort: true,
      render: (r) => {
        const games = r.plan?.games || [];
        if (!games.length) return <span className="prop-dim">{r.plan ? 'None chosen yet' : 'Not planned'}</span>;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} title={games.join(', ')}>
            {games.slice(0, 3).map((g) => <span key={g} className="prop-chip">{g}</span>)}
            {games.length > 3 && <span className="prop-dim">+{games.length - 3}</span>}
          </div>
        );
      },
    },
    {
      key: 'opening', label: 'Opening', width: 106, sort: true,
      render: (r) => fmtDate(r.plan?.openingDate) || <span className="prop-dim">—</span>,
    },
    {
      key: 'trial', label: 'Trial run', width: 106, sort: true,
      render: (r) => fmtDate(r.plan?.trialDate) || <span className="prop-dim">—</span>,
    },
    {
      key: 'project', label: 'Project', width: 158, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">—</span>),
    },
  ], [navigate]);

  return (
    <>
      <PageHead
        title="Signed and shortlisted sites"
        subtitle="Choose the games, fix the opening date, and create the project."
      />
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : q.rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing here yet'}
              hint={q.active ? 'Clear the filters to see the whole step.' : EMPTY_HINT}
            />
          ) : (
            <>
              <PropTable
                columns={columns}
                rows={q.rows}
                rowKey={(r) => r.id}
                sort={q.sort}
                onSort={q.toggleSort}
                busy={q.isFetching}
              />
              <PropPager
                page={q.page}
                totalPages={q.totalPages}
                total={q.total}
                limit={q.limit}
                onPage={q.setPage}
                onLimit={q.setLimit}
              />
            </>
          )}

      {media && <PropertyMediaModal row={media} onClose={() => setMedia(null)} />}
    </>
  );
}
