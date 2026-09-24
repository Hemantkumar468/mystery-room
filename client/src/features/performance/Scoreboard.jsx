import { Trophy, Info } from 'lucide-react';
import { Avatar, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkBlock, SkTable } from '../../components/ui/Skeletons.jsx';
import { errMsg } from '../../lib/opsUi.js';
import { fmtDate, fromNow } from '../../lib/format.js';
import { DEPT_META } from '../../lib/ui.js';
import { MEDAL, pct, fmtInt, isNum, TeamChips } from './perfCommon.jsx';

/** Personal standing, podium and the full leaderboard. */
export function Scoreboard({ query, myId }) {
  const { data, isLoading, isError, error } = query;

  if (isLoading) {
    return (
      <div className="col gap-5">
        <SkBlock h={110} />
        <div className="podium">{[0, 1, 2].map((i) => <SkBlock key={i} h={180} />)}</div>
        <SkTable rows={6} />
      </div>
    );
  }
  if (isError) {
    return <div className="card"><EmptyState icon={Trophy} title="Couldn't load the scoreboard" hint={errMsg(error)} /></div>;
  }

  const standings = data?.standings || [];
  const top = data?.top || [];
  const levels = data?.levels || [];

  return (
    <div className="col gap-5">
      <MeStrip me={data?.me} total={data?.totalPlayers} />

      <div className="info-line">
        <Info size={14} />
        <span>
          <strong>How points work:</strong> +10 per completed task · +5 on time · +5 high/critical · −5 if reworked or sent back.
          {levels.length > 0 && (
            <> Levels: {levels.map((l) => `${l.name} ${fmtInt(l.min)}+`).join(' · ')}.</>
          )}
          {data?.since && <> Counting since {fmtDate(data.since)}.</>}
          {data?.updatedAt && <> Updated {fromNow(data.updatedAt)}.</>}
        </span>
      </div>

      {!standings.length ? (
        <div className="card">
          <EmptyState icon={Trophy} title="No scores yet for this period" hint="Completed delegation and checklist tasks earn XP — check back once work gets done." />
        </div>
      ) : (
        <>
          {top.length > 0 && <Podium top={top} />}
          <Standings rows={standings} myId={myId} />
        </>
      )}
    </div>
  );
}

function MeStrip({ me, total }) {
  if (!me) {
    return (
      <div className="card card-pad row gap-3">
        <Trophy size={18} style={{ color: 'var(--gold-400)' }} />
        <span className="sm muted">You're not on this board for the selected filters — complete tasks to start earning XP.</span>
      </div>
    );
  }
  return (
    <div className="card card-pad me-strip">
      <div className="me-rank tabular" title="Your rank">#{me.rank}</div>
      <div className="col gap-2" style={{ minWidth: 0 }}>
        <div className="row gap-2 wrap">
          <span className="eyebrow">Your standing</span>
          {me.level && <span className="level-pill">{me.level}</span>}
          {me.streak > 0 && <span className="sm" title="Current streak">🔥 {me.streak}</span>}
        </div>
        <div className="row gap-3" style={{ alignItems: 'baseline' }}>
          <span className="xp tabular">{fmtInt(me.xp)} XP</span>
          {isNum(total) && <span className="sm muted">rank {me.rank} of {total}</span>}
        </div>
        {me.nextLevel ? (
          <div className="col gap-1" style={{ maxWidth: 420 }}>
            <ProgressBar value={me.nextLevel.progressPct || 0} />
            <span className="tiny muted">{fmtInt(me.nextLevel.xpNeeded)} XP to <strong>{me.nextLevel.name}</strong></span>
          </div>
        ) : (
          <span className="tiny muted">Top level reached — keep the streak alive.</span>
        )}
      </div>
      <div className="me-stats">
        <div className="col">
          <span className="v tabular">{fmtInt(me.completed)}</span>
          <span className="tiny muted">completed</span>
        </div>
        <div className="col">
          <span className="v tabular">{pct(me.onTimePct)}</span>
          <span className="tiny muted">on time</span>
        </div>
        <div className="col">
          <span className="v">
            {me.badges?.length ? me.badges.map((b) => <span key={b.id} className="badge-emoji" title={b.label}>{b.icon}</span>) : '—'}
          </span>
          <span className="tiny muted">badges</span>
        </div>
      </div>
    </div>
  );
}

function Podium({ top }) {
  const places = [
    { row: top[1], place: 2 },
    { row: top[0], place: 1 },
    { row: top[2], place: 3 },
  ].filter((p) => p.row);
  return (
    <div className="podium">
      {places.map(({ row, place }) => (
        <div key={row.doerId} className={`podium-card ${place === 1 ? 'first' : ''}`}>
          <div className="podium-rank">{MEDAL[place]}</div>
          <Avatar name={row.doer} color={row.avatarColor} size={place === 1 ? 64 : 52} />
          <div style={{ fontWeight: 700 }}>{row.doer}</div>
          <div className="tiny muted">{row.title || DEPT_META[row.department] || ' '}</div>
          <div className="xp tabular" style={{ marginTop: 8 }}>{fmtInt(row.xp)} XP</div>
          <div className="row gap-2 center" style={{ marginTop: 6 }}>
            {row.level && <span className="level-pill">{row.level}</span>}
            {row.streak > 0 && <span className="sm" title="Current streak">🔥 {row.streak}</span>}
          </div>
          {row.badges?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {row.badges.map((b) => <span key={b.id} className="badge-emoji" title={b.label}>{b.icon}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Standings({ rows, myId }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="section-title">Full standings</div>
        <span className="sm muted tabular">{rows.length} players</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 56 }}>Rank</th>
              <th>Person</th>
              <th>Level</th>
              <th style={{ textAlign: 'right' }}>XP</th>
              <th style={{ textAlign: 'right' }}>Completed</th>
              <th style={{ minWidth: 150 }}>On time</th>
              <th>Streak</th>
              <th>Badges</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const mine = myId && r.doerId === myId;
              return (
                <tr key={r.doerId} style={mine ? { background: 'var(--primary-soft)' } : undefined}>
                  <td>
                    {MEDAL[r.rank] ? <span className="badge-emoji" style={{ fontSize: 18 }}>{MEDAL[r.rank]}</span> : <span className="rank" style={{ width: 'auto' }}>#{r.rank}</span>}
                  </td>
                  <td>
                    <div className="row gap-3">
                      <Avatar name={r.doer} color={r.avatarColor} size={32} />
                      <div className="col gap-1" style={{ minWidth: 0 }}>
                        <span className="nowrap" style={{ fontWeight: 600 }}>
                          {r.doer}
                          {mine && <span className="tiny" style={{ color: 'var(--primary)', marginLeft: 6 }}>you</span>}
                        </span>
                        <TeamChips teams={r.teams} />
                      </div>
                    </div>
                  </td>
                  <td>{r.level ? <span className="level-pill">{r.level}</span> : '—'}</td>
                  <td className="tabular" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtInt(r.xp)}</td>
                  <td className="tabular" style={{ textAlign: 'right' }}>{fmtInt(r.completed)}</td>
                  <td>
                    <div className="row gap-2">
                      <div className="grow"><ProgressBar value={r.onTimePct || 0} height={6} /></div>
                      <span className="tiny tabular" style={{ width: 36, textAlign: 'right' }}>{pct(r.onTimePct)}</span>
                    </div>
                  </td>
                  <td className="nowrap">{r.streak > 0 ? `🔥 ${r.streak}` : <span className="subtle">—</span>}</td>
                  <td className="nowrap">
                    {r.badges?.length ? r.badges.map((b) => <span key={b.id} className="badge-emoji" title={b.label}>{b.icon}</span>) : <span className="subtle">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Scoreboard;
