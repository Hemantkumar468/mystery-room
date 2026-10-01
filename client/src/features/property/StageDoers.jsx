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

export default StageDoers;
