import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, ThumbsUp, ThumbsDown, Building2, AlertTriangle,
} from 'lucide-react';
import {
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
  scoreGradeFor,
} from '../projects/records/scoring.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropertyVerdictModal } from './PropertyVerdictModal.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import {
  PageHead, PropEmpty, PropertyToolbar, PlanDateCell, fmtDate,
} from './propertyUi.jsx';
import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';

/**
 * Step 4 — one site chosen per project, and the rest taken off the table.
 *
 * WHY THIS IS A STEP AND NOT A BUTTON. The template already calls for it:
 * Phase 2's exit criteria is "One final property selected and approved with
 * signature", and its gate reads "unlocks commercial negotiation on exactly
 * one selected property". That is a comparison, and a comparison cannot be
 * made one row at a time. Step 3 is a flat list of assessments in filing
 * order, so choosing between the four sites assessed for Bhopal meant
 * scrolling, remembering numbers and hoping. This page puts the candidates
 * for one project side by side with their four scores and asks the only
 * question left: which one?
 *
 * WHAT APPEARS HERE. A property still at the assessment stage whose
 * assessments are ALL filed — `assessmentsComplete`. That is what makes a
 * comparison fair: picking between a site with four scores and one with two is
 * not a choice, it is a guess. A property that should be killed before its
 * forms are in is still killed from Step 3, where deciding early is allowed on
 * purpose (a site that fails Feasibility outright should not need three more
 * forms to be rejected).
 *
 * IT WRITES NOTHING NEW. Selecting is the same `decide('shortlist')` the
 * verdict already used — which opens the six commercial documents — and
 * rejecting is the same reject with its reason. This step changes where the
 * decision is taken and what you can see while taking it, not what it does.
 */

const SCORERS = {
  feasibility: feasibilityPercent,
  financial: financialPercent,
  technical: technicalPercent,
  operational: operationalPercent,
};

/** A property's four scores, and their average — the number to sort on. */
/** The most recent filed assessment — this step's "actual" date. */
const lastFiled = (list) => (list || [])
  .filter((x) => x?.at)
  .sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;

function scoresOf(row) {
  const byType = new Map((row.assessments || []).map((a) => [a.type, a]));
  const each = ASSESSMENTS.map(({ key, label }) => {
    const a = byType.get(key);
    const pct = a?.values ? SCORERS[key]?.(a.values) ?? null : null;
    return { key, label, pct };
  });
  const got = each.filter((s) => typeof s.pct === 'number');
  const average = got.length ? Math.round(got.reduce((n, s) => n + s.pct, 0) / got.length) : null;
  return { each, average, counted: got.length };
}

/** The candidates for one project, best first. */
function groupByProject(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.projectId || 'none';
    if (!groups.has(key)) {
      groups.set(key, { key, name: r.projectName || 'Not on a project', city: r.city, rows: [] });
    }
    groups.get(key).rows.push({ ...r, scores: scoresOf(r) });
  }
  return [...groups.values()].map((g) => ({
    ...g,
    rows: g.rows.sort((a, b) => (b.scores.average ?? -1) - (a.scores.average ?? -1)),
  })).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
}

export default function PropertySelectionPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.manage(user?.role);

  const q = usePropertyQuery('selection');
  const [deciding, setDeciding] = useState(null);
  const [media, setMedia] = useState(null);

  const groups = useMemo(() => groupByProject(q.rows || []), [q.rows]);

  return (
    <>
      <PageHead
        title="Which site goes forward?"
        subtitle="Fully assessed properties, grouped by project. One is chosen per project; the rest come off the table."
      />

      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : !groups.length ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing ready to choose between'}
              hint={q.active
                ? 'Clear the filters to see the whole step.'
                : 'A property appears here once all of its assessments are filed. Ones still being assessed are on Step 3.'}
            />
          ) : (
            <div className="psel">
              {groups.map((g) => (
                <section key={g.key} className="psel-group">
                  <header className="psel-group-head">
                    <span className="psel-group-name">
                      <Building2 size={14} /> {g.name}
                      {g.city && <span className="psel-group-city">{g.city}</span>}
                    </span>
                    {/* The whole reason for the page: how many are in the running. */}
                    <span className="psel-group-count">
                      {g.rows.length === 1
                        ? 'One candidate'
                        : `${g.rows.length} candidates — choose one`}
                    </span>
                  </header>

                  <div className="psel-cards">
                    {g.rows.map((r, i) => {
                      const { each, average, counted } = r.scores;
                      const grade = average != null ? scoreGradeFor(average) : null;
                      /* "Best" only means best SCORE — said plainly so it reads
                         as a ranking, not as the system's recommendation. */
                      const leads = i === 0 && g.rows.length > 1 && average != null;
                      return (
                        <article key={r.id} className={`psel-card${leads ? ' is-lead' : ''}`}>
                          {leads && <span className="psel-lead"><Trophy size={11} /> Highest average</span>}

                          <h3 className="psel-name" title={r.title}>{r.title}</h3>
                          <p className="psel-meta">
                            {[r.locality, r.city].filter(Boolean).join(' · ') || 'No address'}
                            {r.areaSqft ? ` · ${Number(r.areaSqft).toLocaleString('en-IN')} sq ft` : ''}
                            {r.floor ? ` · ${r.floor}` : ''}
                          </p>

                          {/* WHO / WHEN, the same four facts every other step
                              prints as columns — a card is not an excuse to
                              drop them. Who owns the assessment work, when it
                              was due, and who actually filed the last of it. */}
                          <dl className="psel-who">
                            <div>
                              <dt>Assigned</dt>
                              <dd>{r.assessmentPlan?.assignedNames?.length
                                ? r.assessmentPlan.assignedNames.join(', ')
                                : <span className="prop-dim">Unassigned</span>}
                              </dd>
                            </div>
                            <div>
                              <dt>Done by</dt>
                              <dd>{lastFiled(r.assessments)?.by || <span className="prop-dim">Not yet</span>}</dd>
                            </div>
                            <div>
                              <dt>Plan date</dt>
                              <dd><PlanDateCell plan={r.assessmentPlan} /></dd>
                            </div>
                            <div>
                              <dt>Actual date</dt>
                              <dd>{lastFiled(r.assessments)?.at
                                ? fmtDate(lastFiled(r.assessments).at)
                                : <span className="prop-dim">—</span>}
                              </dd>
                            </div>
                          </dl>

                          <div className="psel-avg">
                            {average != null ? (
                              <>
                                <b style={{ color: grade.color }}>{average}%</b>
                                <span className="psel-avg-label">{grade.label} · average of {counted}</span>
                              </>
                            ) : <span className="psel-avg-label">Not scored</span>}
                          </div>

                          <div className="psel-scores">
                            {each.map((s) => (
                              <span key={s.key} className="psel-score" title={s.label}>
                                <span className="psel-score-label">{s.label.slice(0, 4)}</span>
                                <b style={{ color: typeof s.pct === 'number' ? scoreGradeFor(s.pct).color : 'var(--p-muted)' }}>
                                  {typeof s.pct === 'number' ? `${s.pct}%` : '—'}
                                </b>
                              </span>
                            ))}
                          </div>

                          <div className="psel-actions">
                            {canDecide ? (
                              <>
                                <button type="button" className="prop-action-btn" onClick={() => setDeciding({ ...r, intent: 'shortlist' })}>
                                  <ThumbsUp size={12} /> Take this one forward
                                </button>
                                <button type="button" className="psel-drop" onClick={() => setDeciding({ ...r, intent: 'reject' })}>
                                  <ThumbsDown size={12} /> Not this one
                                </button>
                              </>
                            ) : (
                              <span className="tiny muted">View only — routing is a manager decision</span>
                            )}
                            <button type="button" className="prop-open" onClick={() => navigate(`/projects/${r.projectId}/property-identification/${r.recordId}`)}>
                              Open ›
                            </button>
                          </div>

                          {r.media?.counts?.total > 0 && (
                            <button type="button" className="psel-files" onClick={() => setMedia(r)}>
                              {r.media.counts.total} file{r.media.counts.total === 1 ? '' : 's'}
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>

                  {g.rows.length > 1 && (
                    <p className="psel-note">
                      <AlertTriangle size={12} /> Taking one forward opens its six commercial documents.
                      The others stay here until they are decided — they are not rejected for you.
                    </p>
                  )}
                </section>
              ))}
            </div>
          )}

      {media && <PropertyMediaModal row={media} onClose={() => setMedia(null)} />}

      {deciding && (
        <PropertyVerdictModal
          row={deciding}
          onClose={() => setDeciding(null)}
          onDone={() => { setDeciding(null); navigate('/property/commercial'); }}
        />
      )}
    </>
  );
}
