import { useMemo } from 'react';
import { useStageDoers } from '../../app/api/projectsApi.js';

/**
 * WHO IS GOING TO DO THE WORK THIS DIALOG IS ABOUT TO ORDER.
 *
 * Every decision in the property FMS commits somebody else's week. Step 2 ticks
 * assessments; Step 4 approves a site into commercial closure, and optionally
 * into project creation as well. Both wrote real jobs onto real people's My
 * Tasks and neither said whose — the MD chose the work and found out who it had
 * landed on afterwards, from a different screen. So the one question that makes
 * these decisions rather than forms ("is that person free? is that even the
 * right person?") could not be asked at the moment it could still be answered.
 *
 * The names come from the server reading the SAME rule that will build the
 * tasks (`resolveTaskDoers`), so this cannot drift from what actually happens.
 * A name is never invented when none resolves: "nobody assigned yet" is the
 * honest answer and the useful one, because it is still fixable from here.
 */
export function DoersList({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="prop-assess-doers">
      <span className="prop-assess-doers-head">{title}</span>
      <ul>
        {rows.map((r) => {
          const who = r.doers?.length
            ? r.doers.map((d) => d.name).filter(Boolean).join(', ')
            : null;
          const cover = r.buddies?.length ? r.buddies[0]?.name : null;
          return (
            <li key={r.key || r.formKey || r.label}>
              <b>{r.label}</b>
              {who
                ? <span>{who}{cover ? ` · cover: ${cover}` : ''}</span>
                : <em>Nobody assigned yet — set it in Settings › FMS · Assign Work</em>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The same list, fetching a phase for itself.
 *
 * `when` is the dialog's own condition — the route is not ticked, the road is
 * not chosen — so a phase whose work is not being ordered is never asked about.
 *
 * NOTHING IS RENDERED UNTIL THERE IS A REAL ANSWER. An empty result would read
 * as "nobody is assigned to any of this", which is what a property with no
 * project yet and a dialog still loading would both wrongly announce.
 */
export function StageDoers({ projectId, stage, title, when = true }) {
  const { data } = useStageDoers(projectId, stage, { skip: !when });
  const rows = useMemo(() => {
    const list = data?.data || data || [];
    return Array.isArray(list) ? list : [];
  }, [data]);

  if (!when || !rows.length) return null;
  return <DoersList title={title} rows={rows} />;
}

/**
 * One phase, as the rows the list prints.
 *
 * A phase is several template tasks, each with its own owner (closure is five:
 * LOI, lease, legal, deposit, NOCs). When they all land on the SAME people the
 * phase is one line — "Commercial Closure — Sneha" — because five identical rows
 * say one thing five times. When they differ, every task gets its own line under
 * the phase's name, because merging two different owners into one name would be
 * wrong in the one way this list exists to prevent.
 *
 * A phase whose template has no tasks at all still gets its line, with nobody
 * on it: that is the answer, and it is still fixable from here.
 */
export function phaseRows(label, tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!list.length) return [{ key: label, label, doers: [], buddies: [] }];
  const sig = (t) => `${(t.doers || []).map((d) => d.id).join(',')}|${(t.buddies || []).map((d) => d.id).join(',')}`;
  if (list.every((t) => sig(t) === sig(list[0]))) {
    return [{ key: label, label, doers: list[0].doers || [], buddies: list[0].buddies || [] }];
  }
  return list.map((t) => ({
    key: `${label}:${t.key}`,
    label: `${label} \u2014 ${t.label}`,
    doers: t.doers || [],
    buddies: t.buddies || [],
  }));
}

/**
 * WHICH PHASES A ROAD ORDERS.
 *
 * Straight to commercial opens the closure documents. Straight to PROJECT opens
 * the closure documents AND the project plan — the server does both on that
 * road (see propertyCapture.service#route) — so its list has to name both
 * owners, or the MD is told about half the jobs they are about to create.
 * Assessments are the other road and have their own list in AssessmentPicker.
 */
const ROAD_PHASES = {
  skip: [{ stage: 'p3', label: 'Commercial Closure' }],
  project: [{ stage: 'p3', label: 'Commercial Closure' }, { stage: 'p20', label: 'Project & Games' }],
};

const asList = (data) => {
  const list = data?.data || data;
  return Array.isArray(list) ? list : null;
};

/**
 * WHO WILL DO THE WORK OF THE ROAD THE MD HAS PICKED — closure and project.
 *
 * Same list, same look as the assessments' "Who will do these"; only the phases
 * differ. Each phase is asked of the server, which answers with the rule that
 * will actually build the tasks, so the names here are the names the tasks will
 * carry and they move the moment FMS · Assign Work does.
 *
 * NOTHING IS PRINTED UNTIL EVERY PHASE HAS ANSWERED. Showing the first phase's
 * owner while the second is still loading would present half a list as the whole
 * of it, and an empty answer in flight reads as "nobody assigned" — the one thing
 * this must not say by accident. A property with no project yet (a franchise
 * enquiry) has nothing to ask about and prints nothing.
 */
export function RoadDoers({ projectId, road, title = 'Who will do these' }) {
  const phases = ROAD_PHASES[road] || [];
  const asks = (stage) => phases.some((ph) => ph.stage === stage) && Boolean(projectId);
  const p3 = useStageDoers(projectId, 'p3', { skip: !asks('p3') });
  const p20 = useStageDoers(projectId, 'p20', { skip: !asks('p20') });
  const answers = { p3: asList(p3.data), p20: asList(p20.data) };

  const rows = useMemo(() => {
    if (!phases.length || !projectId) return null;
    if (phases.some((ph) => answers[ph.stage] == null)) return null;
    return phases.flatMap((ph) => phaseRows(ph.label, answers[ph.stage]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [road, projectId, p3.data, p20.data]);

  if (!rows) return null;
  return <DoersList title={title} rows={rows} />;
}

export default StageDoers;
