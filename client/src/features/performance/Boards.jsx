import { Users, Building2 } from 'lucide-react';
import { EmptyState, Badge, SectionCard } from '../../components/ui/primitives.jsx';
import { SkBlock, SkTable } from '../../components/ui/Skeletons.jsx';
import { ComparisonBar } from '../../components/charts/chartkit.jsx';
import { BRANCH_TYPE_LABEL, errMsg } from '../../lib/opsUi.js';
import { MEDAL, CHART_HEX, fmtInt, num } from './perfCommon.jsx';

const rankCell = (i) => (MEDAL[i + 1] ? <span className="badge-emoji" style={{ fontSize: 17 }}>{MEDAL[i + 1]}</span> : <span className="rank" style={{ width: 'auto' }}>#{i + 1}</span>);

/** Team and branch leaderboards from the same scoreboard payload. */
export function Boards({ query }) {
  const { data, isLoading, isError, error } = query;

  if (isLoading) {
    return (
      <div className="col gap-5">
        <SkBlock h={300} />
        <div className="board-split"><SkTable rows={5} /><SkTable rows={5} /></div>
      </div>
    );
  }
  if (isError) {
    return <div className="card"><EmptyState icon={Users} title="Couldn't load the boards" hint={errMsg(error)} /></div>;
  }

  const teams = [...(data?.teams || [])].sort((a, b) => (b.avgPoints || 0) - (a.avgPoints || 0));
  const branches = [...(data?.branches || [])].sort((a, b) => (b.points || 0) - (a.points || 0));
  const chart = teams.map((t) => ({ label: t.name, avg: Math.round(t.avgPoints || 0), total: Math.round(t.points || 0) }));

  return (
    <div className="col gap-5">
      <SectionCard title="Team comparison" subtitle="Average XP per member keeps small and large teams comparable">
        {chart.length ? (
          <ComparisonBar
            data={chart}
            height={280}
            keys={[
              { key: 'avg', name: 'Avg XP / member', color: CHART_HEX.gold },
              { key: 'total', name: 'Total XP', color: CHART_HEX.teal },
            ]}
          />
        ) : (
          <EmptyState icon={Users} title="No team scores yet" />
        )}
      </SectionCard>

      <div className="board-split">
        <div className="card">
          <div className="card-head">
            <div className="col">
              <div className="section-title">Team leaderboard</div>
              <div className="sm muted">Ranked by average XP per member</div>
            </div>
          </div>
          {teams.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Team</th>
                    <th style={{ textAlign: 'right' }}>Avg XP</th>
                    <th style={{ textAlign: 'right' }}>Total XP</th>
                    <th style={{ textAlign: 'right' }}>Completed</th>
                    <th style={{ textAlign: 'right' }}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t, i) => (
                    <tr key={t.teamId}>
                      <td>{rankCell(i)}</td>
                      <td>
                        <span className="row gap-2">
                          <span className="color-dot" style={{ background: t.color || 'var(--text-subtle)' }} />
                          <span style={{ fontWeight: 600 }}>{t.name}</span>
                        </span>
                      </td>
                      <td className="tabular" style={{ textAlign: 'right', fontWeight: 700 }}>{num(t.avgPoints, 1)}</td>
                      <td className="tabular" style={{ textAlign: 'right' }}>{fmtInt(t.points)}</td>
                      <td className="tabular" style={{ textAlign: 'right' }}>{fmtInt(t.completed)}</td>
                      <td className="tabular muted" style={{ textAlign: 'right' }} title="Members who scored / all members">
                        {fmtInt(t.active)}/{fmtInt(t.members)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="No teams to rank" hint="Create teams on the Teams & People page." />
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="col">
              <div className="section-title">Branch leaderboard</div>
              <div className="sm muted">Ranked by total XP</div>
            </div>
          </div>
          {branches.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Branch</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>XP</th>
                    <th style={{ textAlign: 'right' }}>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b, i) => (
                    <tr key={b.branchId || i}>
                      <td>{rankCell(i)}</td>
                      <td>
                        <span className="col">
                          <span style={{ fontWeight: 600 }}>{b.name}</span>
                          <span className="mono tiny subtle">{b.code}</span>
                        </span>
                      </td>
                      <td>{b.type ? <Badge color="var(--text-muted)" soft="var(--surface-hover)">{BRANCH_TYPE_LABEL[b.type] || b.type}</Badge> : '—'}</td>
                      <td className="tabular" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtInt(b.points)}</td>
                      <td className="tabular" style={{ textAlign: 'right' }}>{fmtInt(b.completed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Building2} title="No branch scores yet" />
          )}
        </div>
      </div>
    </div>
  );
}

export default Boards;
