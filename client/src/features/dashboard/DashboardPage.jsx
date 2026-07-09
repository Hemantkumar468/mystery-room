import { useNavigate } from 'react-router-dom';
import {
  FolderKanban,
  Activity as ActivityIcon,
  TrendingUp,
  AlertTriangle,
  CalendarClock,
  MapPin,
  ArrowUpRight,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { DonutChart, ComparisonBar } from '../../components/charts/chartkit.jsx';
import {
  ProgressBar,
  HealthBadge,
  Avatar,
  SectionCard,
} from '../../components/ui/primitives.jsx';
import { SkDashboard } from '../../components/ui/Skeletons.jsx';
import { useDashboard } from '../../lib/queries.js';
import { HEALTH_META } from '../../lib/ui.js';
import { fromNow, fmtDateShort, daysUntil } from '../../lib/format.js';

export function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const navigate = useNavigate();

  return (
    <>
      <Topbar title="Dashboard" subtitle="Franchise expansion — portfolio command centre" />
      <div className="content">
        {isLoading || !data ? (
          <SkDashboard />
        ) : (
          <div className="col gap-5 content-narrow fade-in">
            {/* KPI tiles with live micro-trends */}
            <div className="stat-grid">
              <StatCard
                icon={FolderKanban}
                label="Total Projects"
                value={data.kpis.totalProjects}
                tint="var(--gold-500)"
                soft="var(--primary-soft)"
                bars={data.cityProgress}
                foot={`Across ${data.kpis.cities} cities`}
              />
              <StatCard
                icon={ActivityIcon}
                label="Active Launches"
                value={data.kpis.activeProjects}
                tint="var(--teal-500)"
                soft="var(--secondary-soft)"
                spark={data.throughput}
                foot={`Weekly delivery momentum · ${data.kpis.planningProjects} in planning`}
              />
              <StatCard
                icon={TrendingUp}
                label="Avg Progress"
                value={`${data.kpis.avgProgress}%`}
                tint="var(--gold-400)"
                soft="var(--accent-soft)"
                gradient
                bars={data.cityProgress}
                foot="Progress by city"
              />
              <StatCard
                icon={AlertTriangle}
                label="Overdue Tasks"
                value={data.kpis.overdueTasks}
                tint="var(--danger)"
                soft="var(--danger-soft)"
                delta={{ dir: data.kpis.overdueTasks > 0 ? 'down' : 'flat', text: `${data.kpis.dueThisWeek} due 7d` }}
                bars={data.dueTrend}
                foot="Workload landing this week"
              />
            </div>

            {/* Active launches + health */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 'var(--space-5)' }} className="dash-split">
              <SectionCard
                title="Active Launches"
                subtitle="Ranked by health & nearest go-live"
                bodyClass=""
                action={<button className="btn btn-ghost btn-sm" onClick={() => navigate('/projects')}>View all <ArrowUpRight size={14} /></button>}
              >
                <div className="col">
                  {data.activeProjects.map((p, i) => {
                    const dleft = daysUntil(p.targetEndDate);
                    return (
                      <div
                        key={p._id}
                        className="row gap-4 launch-row"
                        style={{ padding: '13px 20px', borderTop: '1px solid var(--border)', cursor: 'pointer', transition: 'var(--transition)' }}
                        onClick={() => navigate(`/projects/${p._id}`)}
                      >
                        <span className="rank">{String(i + 1).padStart(2, '0')}</span>
                        <div className="col grow" style={{ minWidth: 0 }}>
                          <div className="row gap-2">
                            <span className="mono tiny" style={{ color: 'var(--primary)', fontWeight: 700 }}>{p.code}</span>
                            <HealthBadge value={p.health} />
                          </div>
                          <div className="truncate" style={{ fontWeight: 620, marginTop: 3 }}>{p.name}</div>
                          <div className="row gap-1 tiny muted" style={{ marginTop: 3 }}>
                            <MapPin size={12} /> {p.city}
                          </div>
                        </div>
                        <div className="col" style={{ width: 148 }}>
                          <div className="row between tiny" style={{ marginBottom: 5 }}>
                            <span className="tabular" style={{ fontWeight: 700 }}>{p.progress}%</span>
                            <span className="muted">{dleft != null ? (dleft < 0 ? `${-dleft}d over` : `${dleft}d left`) : '—'}</span>
                          </div>
                          <ProgressBar value={p.progress} height={6} />
                        </div>
                        <Avatar name={p.owner?.name} color={p.owner?.avatarColor} />
                      </div>
                    );
                  })}
                  {!data.activeProjects.length && <div className="empty">No active launches</div>}
                </div>
              </SectionCard>

              <SectionCard title="Portfolio Health">
                <DonutChart
                  data={data.healthDistribution.map((h) => ({
                    name: HEALTH_META[h.health]?.label || h.health,
                    value: h.count,
                    color: HEALTH_META[h.health]?.color,
                  }))}
                  centerLabel={{ value: data.kpis.totalProjects, label: 'Projects' }}
                />
                <div className="col gap-2" style={{ marginTop: 14 }}>
                  {data.healthDistribution.map((h) => (
                    <div key={h.health} className="row between health-legend" style={{ padding: '7px 10px', borderRadius: 'var(--radius)' }}>
                      <span className="row gap-2 sm">
                        <span className="badge-dot" style={{ background: HEALTH_META[h.health]?.color, width: 8, height: 8 }} />
                        {HEALTH_META[h.health]?.label}
                      </span>
                      <span className="tabular" style={{ fontWeight: 700 }}>{h.count}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            {/* City footprint + milestones */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 'var(--space-5)' }} className="dash-split">
              <SectionCard title="Franchise Footprint" subtitle="Outlets under development by city">
                <ComparisonBar
                  data={data.cityDistribution.map((c) => ({ label: c.city, Outlets: c.count }))}
                  keys={[{ key: 'Outlets', name: 'Outlets', color: '#e0a13a' }]}
                  height={240}
                />
              </SectionCard>

              <SectionCard title="Upcoming Milestones" subtitle="Next 7 days">
                <div className="col gap-3">
                  {data.upcomingMilestones.map((t) => (
                    <div key={t._id} className="row gap-3 milestone-row" style={{ padding: '4px 6px', borderRadius: 'var(--radius)' }}>
                      <div className="center" style={{ width: 44, height: 44, background: 'var(--accent-soft)', color: 'var(--accent-hover)', borderRadius: 'var(--radius)', flexShrink: 0 }}>
                        <CalendarClock size={18} />
                      </div>
                      <div className="col grow" style={{ minWidth: 0 }}>
                        <div className="truncate sm" style={{ fontWeight: 620 }}>{t.title}</div>
                        <div className="tiny muted truncate">{t.project?.code} · {t.stageName}</div>
                      </div>
                      <span className="badge" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>{fmtDateShort(t.plannedEnd)}</span>
                    </div>
                  ))}
                  {!data.upcomingMilestones.length && <div className="empty sm">Nothing due this week 🎉</div>}
                </div>
              </SectionCard>
            </div>

            {/* Activity feed */}
            <SectionCard title="Recent Activity">
              <div className="col gap-1">
                {data.recentActivity.map((a) => (
                  <div key={a._id} className="row gap-3 activity-row" style={{ padding: '9px 8px', borderRadius: 'var(--radius)' }}>
                    <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={28} />
                    <div className="col grow" style={{ minWidth: 0 }}>
                      <div className="sm">
                        <b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span>
                      </div>
                      <div className="tiny muted">
                        {a.project?.code ? `${a.project.code} · ` : ''}{fromNow(a.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        )}
      </div>
    </>
  );
}

export default DashboardPage;
