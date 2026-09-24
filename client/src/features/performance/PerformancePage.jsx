import { useState } from 'react';
import dayjs from 'dayjs';
import { Trophy, Users, ClipboardCheck, RotateCcw } from 'lucide-react';
import '../../styles/ops-org.css';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { BranchSwitcher } from '../../components/ops/BranchSwitcher.jsx';
import { Segmented, FilterSelect } from '../../components/ops/common.jsx';
import { useScoreboard, useTeams, useGroups } from '../../lib/opsQueries.js';
import { useOpsStore } from '../../store/opsStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { DEPT_META } from '../../lib/ui.js';
import { Scoreboard } from './Scoreboard.jsx';
import { Boards } from './Boards.jsx';
import { KraReport } from './KraReport.jsx';

const PERIODS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'all', label: 'All time' },
];
const SOURCES = [
  { value: 'all', label: 'All' },
  { value: 'delegation', label: 'Delegation' },
  { value: 'checklist', label: 'Checklist' },
];
const TABS = [
  { value: 'scoreboard', label: 'Scoreboard', icon: Trophy },
  { value: 'boards', label: 'Team & branch boards', icon: Users },
  { value: 'kra', label: 'KRA report', icon: ClipboardCheck },
];
const DEPT_OPTIONS = Object.entries(DEPT_META).map(([value, label]) => ({ value, label }));
const monthStart = () => dayjs().startOf('month').format('YYYY-MM-DD');
const today = () => dayjs().format('YYYY-MM-DD');

export function PerformancePage() {
  const branch = useOpsStore((s) => s.branch);
  const user = useAuthStore((s) => s.user);
  const myId = user?.id || user?._id;
  const canSeeOthers = user?.role === 'admin' || user?.role === 'manager';

  const [tab, setTab] = useState('scoreboard');
  const [period, setPeriod] = useState('month');
  const [source, setSource] = useState('all');
  const [team, setTeam] = useState('');
  const [group, setGroup] = useState('');
  const [department, setDepartment] = useState('');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);

  const { data: teams = [] } = useTeams();
  const { data: groups = [] } = useGroups();

  const common = {
    branch: branch || undefined,
    team: team || undefined,
    group: group || undefined,
    department: department || undefined,
    source,
  };
  const board = useScoreboard({ ...common, period });

  const filtered = team || group || department || source !== 'all';
  const reset = () => {
    setTeam('');
    setGroup('');
    setDepartment('');
    setSource('all');
  };

  return (
    <>
      <Topbar
        title="Performance"
        subtitle="Scoreboards that celebrate good work, and KRA scores that explain it"
        actions={<div className="row gap-2"><BranchSwitcher /></div>}
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          <div className="card filters-card">
            {tab === 'kra' ? (
              <>
                <label className="grp">
                  <span className="tiny subtle upper">From</span>
                  <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="grp">
                  <span className="tiny subtle upper">To</span>
                  <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                </label>
              </>
            ) : (
              <div className="grp">
                <span className="tiny subtle upper">Period</span>
                <Segmented value={period} onChange={setPeriod} options={PERIODS} />
              </div>
            )}
            <div className="grp">
              <span className="tiny subtle upper">Source</span>
              <Segmented value={source} onChange={setSource} options={SOURCES} />
            </div>
            <FilterSelect label="Team" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t._id, label: t.name }))} allLabel="All teams" />
            <FilterSelect label="Group" value={group} onChange={setGroup} options={groups.map((g) => ({ value: g._id, label: g.name }))} allLabel="All groups" />
            <FilterSelect label="Department" value={department} onChange={setDepartment} options={DEPT_OPTIONS} allLabel="All departments" />
            {filtered && (
              <button className="btn btn-ghost" onClick={reset}><RotateCcw size={14} /> Reset</button>
            )}
          </div>

          <div><Segmented value={tab} onChange={setTab} options={TABS} /></div>

          {tab === 'scoreboard' && <Scoreboard query={board} myId={myId} />}
          {tab === 'boards' && <Boards query={board} />}
          {tab === 'kra' && <KraReport params={{ ...common, from: from || undefined, to: to || undefined }} canSeeOthers={canSeeOthers} />}
        </div>
      </div>
    </>
  );
}

export default PerformancePage;
