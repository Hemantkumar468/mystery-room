import {
  Gauge, Timer, ListChecks, AlertTriangle, TrendingUp, Hourglass,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { SectionCard } from '../../components/ui/primitives.jsx';
import { SkCharts } from '../../components/ui/Skeletons.jsx';
import { DonutChart, ComparisonBar, TrendArea, HBar } from '../../components/charts/chartkit.jsx';
import { useMisPortfolio } from '../../app/api/misApi.js';
import { TASK_STATUS_META, HEALTH_META } from '../../lib/ui.js';

export function MisPage() {
  const { data, isLoading } = useMisPortfolio();

  return (
    <>
      <Topbar title="MIS & Analytics" subtitle="Live management information across the portfolio" />
      <div className="content">
        {isLoading || !data ? (
          <SkCharts />
        ) : (
          <div className="content-narrow col gap-5 fade-in">
            {/* KPIs */}
            <div className="stat-grid">
              <StatCard icon={Gauge} label="Completion Rate" value={`${data.kpis.completionRate}%`} tint="var(--gold-500)" soft="var(--primary-soft)" foot={<span className="muted">{data.kpis.doneTasks}/{data.kpis.totalTasks} tasks</span>} />
              <StatCard icon={Timer} label="On-Time Delivery" value={`${data.onTimeRate.rate}%`} tint="var(--teal-500)" soft="var(--secondary-soft)" foot={<span className="muted">{data.onTimeRate.late} late</span>} />
              <StatCard icon={AlertTriangle} label="Overdue Tasks" value={data.kpis.overdueTasks} tint="var(--danger)" soft="var(--danger-soft)" />
              <StatCard icon={Hourglass} label="Effort (Est/Act)" value={`${data.kpis.actualHours}h`} tint="var(--gold-400)" soft="var(--accent-soft)" foot={<span className="muted">planned {data.kpis.estimatedHours}h</span>} />
            </div>

            {/* Row 1: on-time + status + health */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-5)' }}>
              <SectionCard title="On-Time Performance" subtitle="Completed tasks meeting their deadline">
                <DonutChart
                  data={[
                    { name: 'On time', value: data.onTimeRate.onTime, color: '#10b981' },
                    { name: 'Late', value: data.onTimeRate.late, color: '#f43f5e' },
                  ]}
                  centerLabel={{ value: `${data.onTimeRate.rate}%`, label: 'On time' }}
                />
              </SectionCard>

              <SectionCard title="Task Status Mix" subtitle="Distribution across the board">
                <DonutChart
                  data={data.statusDistribution.map((s) => ({
                    name: TASK_STATUS_META[s.status]?.label || s.status,
                    value: s.count,
                    color: TASK_STATUS_META[s.status]?.color,
                  }))}
                  centerLabel={{ value: data.kpis.totalTasks, label: 'Tasks' }}
                />
              </SectionCard>

              <SectionCard title="Project Health" subtitle="Portfolio-wide">
                <DonutChart
                  data={data.healthDistribution.map((h) => ({
                    name: HEALTH_META[h.health]?.label || h.health,
                    value: h.count,
                    color: HEALTH_META[h.health]?.color,
                  }))}
                  centerLabel={{ value: data.kpis.totalProjects, label: 'Projects' }}
                />
              </SectionCard>
            </div>

            {/* Row 2: planned vs actual */}
            <SectionCard title="Planned vs Actual Duration" subtitle="Working days per stage — where we slip">
              {data.plannedVsActual.length ? (
                <ComparisonBar
                  data={data.plannedVsActual.map((s) => ({ label: s.stage, Planned: s.planned, Actual: s.actual }))}
                  keys={[
                    { key: 'Planned', name: 'Planned', color: '#6366f1' },
                    { key: 'Actual', name: 'Actual', color: '#e0a13a' },
                  ]}
                  height={280}
                  suffix="d"
                />
              ) : (
                <div className="empty sm">Not enough completed tasks yet</div>
              )}
            </SectionCard>

            {/* Row 3: throughput + cycle time */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 'var(--space-5)' }} className="dash-split">
              <SectionCard title="Throughput" subtitle="Tasks completed per week (last 8 weeks)">
                <TrendArea data={data.throughput.map((t) => ({ label: t.week, completed: t.completed }))} dataKey="completed" name="Completed" color="#16a79a" height={260} />
              </SectionCard>

              <SectionCard title="Stage Cycle Time" subtitle="Avg days a stage's tasks take">
                {data.stageCycleTime.length ? (
                  <ComparisonBar
                    data={data.stageCycleTime.map((s) => ({ label: s.stage, Days: s.avgDays }))}
                    keys={[{ key: 'Days', name: 'Avg days', color: '#a855f7' }]}
                    height={260}
                    suffix="d"
                  />
                ) : (
                  <div className="empty sm">No completed stages yet</div>
                )}
              </SectionCard>
            </div>

            {/* Row 4: assignee load */}
            <SectionCard title="Team Workload" subtitle="Open vs overdue tasks per assignee">
              {data.assigneeLoad.length ? (
                <HBar data={data.assigneeLoad.map((a) => ({ label: a.name, open: a.open - a.overdue, overdue: a.overdue }))} height={Math.max(200, data.assigneeLoad.length * 40)} />
              ) : (
                <div className="empty sm">No open tasks assigned</div>
              )}
            </SectionCard>
          </div>
        )}
      </div>
    </>
  );
}

export default MisPage;
