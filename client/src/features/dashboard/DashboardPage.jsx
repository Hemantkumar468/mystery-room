/**
 * DashboardPage — premium command centre.
 * Compact count-only KPI cards + a dedicated analytics band (charts pulled out
 * of the stat cards), then Active Launches + Portfolio Health.
 * Warm cream/beige aesthetic · real data from useDashboard() · recharts via chartkit.
 */
import { useNavigate } from "react-router-dom";
import {
  FolderKanban,
  Activity as ActivityIcon,
  TrendingUp,
  AlertTriangle,
  MapPin,
  ArrowUpRight,
  Clock,
  RotateCcw,
} from "lucide-react";
import { Topbar } from "../../components/layout/Topbar.jsx";
import { DonutChart, TrendArea, ComparisonBar } from "../../components/charts/chartkit.jsx";
import { HealthBadge, Avatar } from "../../components/ui/primitives.jsx";
import { SkDashboard } from "../../components/ui/Skeletons.jsx";
import { useDashboard } from "../../app/api/projectsApi.js";
import { HEALTH_META } from "../../lib/ui.js";
import { daysUntil } from "../../lib/format.js";

/* ─── colour constants ──────────────────────────────────────────────────
 * Accent tints stay literal hex — they get alpha suffixes appended (e.g.
 * `${tint}1a`), which only works on hex. Everything structural (surfaces,
 * text, borders) points at the app's theme tokens so the dashboard follows
 * light/dark mode exactly like the rest of the app. */
const C = {
  gold: "#e0a13a",
  teal: "#16a79a",
  violet: "#7c6ef2",
  delayed: "#f43f5e",
  atRisk: "#ea8a2b",
  pageBg: "var(--bg)",
  cardBg: "var(--surface)",
  cardBorder: "var(--border)",
  shadow: "var(--shadow-2, 0 2px 12px rgba(60,40,10,0.07))",
  text: "var(--text)",
  muted: "var(--text-subtle)",
  subtle: "var(--border-strong)",
};

/* ─── compact KPI stat card — count only, no embedded chart ──────────── */
function KpiCard({ icon: Icon, label, value, tint, foot, chip, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: 14,
        boxShadow: C.shadow,
        padding: "14px 16px",
        minWidth: 0,
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow 140ms, transform 140ms",
      }}
      onMouseEnter={(e) => {
        if (!onClick) return;
        e.currentTarget.style.boxShadow = "var(--shadow-3, 0 4px 18px rgba(60,40,10,0.12))";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        if (!onClick) return;
        e.currentTarget.style.boxShadow = C.shadow;
        e.currentTarget.style.transform = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: `${tint}1a`,
            display: "grid",
            placeItems: "center",
            color: tint,
            flexShrink: 0,
          }}
        >
          {Icon && <Icon size={15} strokeWidth={2.2} />}
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: C.muted,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            lineHeight: 1.3,
          }}
        >
          {label}
        </span>
        {chip && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              fontWeight: 700,
              color: chip.color,
              background: `${chip.color}16`,
              padding: "2px 7px",
              borderRadius: 99,
              whiteSpace: "nowrap",
              alignSelf: "flex-start",
            }}
          >
            {chip.text}
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 28,
          fontWeight: 760,
          color: C.text,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {foot && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5, fontWeight: 500 }}>
          {foot}
        </div>
      )}
    </div>
  );
}

/* ─── reusable panel shell (title + optional action) ────────────────── */
function Panel({ title, subtitle, action, children, bodyStyle }) {
  return (
    <div
      style={{
        background: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: 16,
        boxShadow: C.shadow,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "16px 20px 14px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          borderBottom: `1px solid ${C.cardBorder}`,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 720, color: C.text }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{subtitle}</div>
          )}
        </div>
        {action}
      </div>
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}

/* ─── launch row ────────────────────────────────────────────────────── */
function LaunchRow({ project, index, onClick }) {
  const dleft = daysUntil(project.targetEndDate);
  const progressColor =
    project.health === "delayed"
      ? C.delayed
      : project.health === "at_risk"
      ? C.atRisk
      : C.teal;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "13px 20px",
        borderTop: `1px solid ${C.cardBorder}`,
        cursor: "pointer",
        transition: "background 140ms",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        style={{
          fontSize: 12, fontWeight: 720, color: C.subtle,
          width: 22, flexShrink: 0, fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <span
            style={{
              fontSize: 10.5, fontWeight: 750, color: C.teal,
              fontFamily: "monospace", letterSpacing: "0.03em",
            }}
          >
            {project.code}
          </span>
          <HealthBadge value={project.health} />
        </div>
        <div
          style={{
            fontSize: 13.5, fontWeight: 650, color: C.text,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {project.name}
        </div>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 4,
            fontSize: 11.5, color: C.muted, marginTop: 3,
          }}
        >
          <MapPin size={11} strokeWidth={2} />
          {project.city}
        </div>
      </div>

      <div style={{ width: 148, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span
            style={{
              fontSize: 12, fontWeight: 720, color: C.text,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {project.progress}%
          </span>
          <span style={{ fontSize: 11, color: C.muted }}>
            {dleft != null
              ? dleft < 0
                ? `${-dleft}d over`
                : `${dleft}d left`
              : "—"}
          </span>
        </div>
        <div
          style={{
            height: 5, borderRadius: 99,
            background: "var(--surface-hover)", overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, project.progress))}%`,
              background: progressColor,
              borderRadius: 99,
              transition: "width 0.5s ease",
            }}
          />
        </div>
      </div>

      <Avatar
        name={project.owner?.name}
        color={project.owner?.avatarColor || C.teal}
        size={32}
      />
    </div>
  );
}

/* ─── portfolio health ──────────────────────────────────────────────── */
function PortfolioHealth({ totalProjects, healthDistribution }) {
  const donutData = healthDistribution.map((h) => ({
    name: HEALTH_META[h.health]?.label || h.health,
    value: h.count,
    color: HEALTH_META[h.health]?.color,
  }));

  const legendOrder = ["on_track", "at_risk", "delayed"];
  const countMap = Object.fromEntries(
    healthDistribution.map((h) => [h.health, h.count])
  );

  return (
    <Panel title="Portfolio Health" bodyStyle={{ padding: "8px 0 0" }}>
      <DonutChart
        data={donutData}
        height={200}
        innerRadius={62}
        outerRadius={88}
        centerLabel={{ value: totalProjects, label: "PROJECTS" }}
      />
      <div
        style={{
          padding: "8px 20px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {legendOrder.map((key) => {
          const meta = HEALTH_META[key];
          const count = countMap[key] ?? 0;
          return (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                borderRadius: 10,
                background: count > 0 ? `${meta.color}12` : "transparent",
              }}
            >
              <span
                style={{
                  display: "flex", alignItems: "center", gap: 9,
                  fontSize: 13, color: C.text, fontWeight: 550,
                }}
              >
                <span
                  style={{
                    width: 9, height: 9, borderRadius: "50%",
                    background: meta.color, flexShrink: 0,
                  }}
                />
                {meta.label}
              </span>
              <span
                style={{
                  fontSize: 14, fontWeight: 730, color: C.text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ─── page ──────────────────────────────────────────────────────────── */
export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboard();
  const navigate = useNavigate();

  /* Build chart series from the same numbers the stat cards used to embed. */
  const momentum = (data?.throughput || []).map((v, i, arr) => ({
    label: i === arr.length - 1 ? "Now" : `W-${arr.length - 1 - i}`,
    completed: v,
  }));
  const cityBars = (data?.cityDistribution || [])
    .filter((c) => c.city)
    .slice(0, 8)
    .map((c) => ({ label: c.city, progress: c.avgProgress }));

  if (isError) {
    return (
      <>
        <Topbar title="Dashboard" subtitle="Franchise expansion — portfolio command centre" />
        <div className="content">
          <div className="card">
            <div className="pd-error">
              <span className="pd-error-icon"><AlertTriangle size={24} /></span>
              <div className="col gap-1 center">
                <span style={{ fontWeight: 700 }}>Couldn’t load the dashboard</span>
                <span className="sm muted">The dashboard service didn’t respond. Please try again.</span>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => refetch()}><RotateCcw size={15} style={{ marginRight: 6 }} /> Retry</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle="Franchise expansion — portfolio command centre"
      />

      <div className="content" style={{ background: C.pageBg }}>
        {isLoading || !data ? (
          <SkDashboard />
        ) : (
          <div
            className="fade-in"
            style={{
              maxWidth: 1200,
              margin: "0 auto",
              padding: "0 0 40px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* 4 compact KPI cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 16,
              }}
            >
              <KpiCard
                icon={FolderKanban}
                label="Total Projects"
                value={data.kpis.totalProjects}
                tint={C.gold}
                foot={`Across ${data.kpis.cities} cities`}
                onClick={() => navigate("/projects")}
              />
              <KpiCard
                icon={ActivityIcon}
                label="Active Launches"
                value={data.kpis.activeProjects}
                tint={C.teal}
                foot={`${data.kpis.planningProjects} more in planning`}
                onClick={() => navigate("/projects", { state: { lens: "active" } })}
              />
              <KpiCard
                icon={TrendingUp}
                label="Avg Progress"
                value={`${data.kpis.avgProgress}%`}
                tint={C.violet}
                foot="Portfolio-wide completion"
                onClick={() => navigate("/projects")}
              />
              <KpiCard
                icon={AlertTriangle}
                label="Overdue Tasks"
                value={data.kpis.overdueTasks}
                tint={C.delayed}
                chip={
                  data.kpis.dueThisWeek > 0
                    ? { text: `${data.kpis.dueThisWeek} due · 7d`, color: C.delayed }
                    : null
                }
                foot="Needs attention now"
                onClick={() => navigate("/tasks/overdue")}
              />
            </div>

            {/* Analytics band — charts pulled out of the stat cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr",
                gap: 16,
                alignItems: "stretch",
              }}
            >
              <Panel
                title="Delivery Momentum"
                subtitle="Tasks completed per week · last 8 weeks"
                action={
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 11.5, fontWeight: 600, color: C.teal,
                      background: `${C.teal}14`, padding: "4px 10px", borderRadius: 8,
                    }}
                  >
                    <Clock size={12} strokeWidth={2.2} /> Weekly
                  </span>
                }
                bodyStyle={{ padding: "14px 16px 10px" }}
              >
                {momentum.length ? (
                  <TrendArea
                    data={momentum}
                    dataKey="completed"
                    name="Completed"
                    color={C.teal}
                    height={230}
                  />
                ) : (
                  <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
                    No throughput data yet
                  </div>
                )}
              </Panel>

              <Panel
                title="Progress by City"
                subtitle="Average completion across active markets"
                bodyStyle={{ padding: "14px 16px 10px" }}
              >
                {cityBars.length ? (
                  <ComparisonBar
                    data={cityBars}
                    keys={[{ key: "progress", name: "Avg Progress", color: C.gold }]}
                    height={230}
                    suffix="%"
                  />
                ) : (
                  <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
                    No city data yet
                  </div>
                )}
              </Panel>
            </div>

            {/* Two-column: Active Launches + Portfolio Health */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.85fr 1fr",
                gap: 16,
                alignItems: "start",
              }}
            >
              <Panel
                title="Active Launches"
                subtitle="Ranked by health & nearest go-live"
                action={
                  <button
                    onClick={() => navigate("/projects")}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 12.5, fontWeight: 650, color: C.teal,
                      background: `${C.teal}14`,
                      border: `1px solid ${C.teal}33`,
                      borderRadius: 8, padding: "5px 12px",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = `${C.teal}24`)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = `${C.teal}14`)}
                  >
                    View all <ArrowUpRight size={13} strokeWidth={2.4} />
                  </button>
                }
                bodyStyle={{ maxHeight: 430, overflowY: "auto" }}
              >
                {data.activeProjects.length === 0 ? (
                  <div
                    style={{
                      padding: 40, textAlign: "center",
                      color: C.muted, fontSize: 13,
                    }}
                  >
                    No active launches yet
                  </div>
                ) : (
                  data.activeProjects.map((p, i) => (
                    <LaunchRow
                      key={p._id}
                      project={p}
                      index={i}
                      onClick={() => navigate(`/projects/${p._id}`)}
                    />
                  ))
                )}
              </Panel>

              <PortfolioHealth
                totalProjects={data.kpis.totalProjects}
                healthDistribution={data.healthDistribution}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default DashboardPage;
