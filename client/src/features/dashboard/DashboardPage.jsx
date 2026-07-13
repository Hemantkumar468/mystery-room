/**
 * DashboardPage — redesigned premium command centre.
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
} from "lucide-react";
import { Topbar } from "../../components/layout/Topbar.jsx";
import { DonutChart, Sparkline, MiniBars } from "../../components/charts/chartkit.jsx";
import { HealthBadge, Avatar } from "../../components/ui/primitives.jsx";
import { SkDashboard } from "../../components/ui/Skeletons.jsx";
import { useDashboard } from "../../lib/queries.js";
import { HEALTH_META } from "../../lib/ui.js";
import { daysUntil } from "../../lib/format.js";

/* ─── colour constants ──────────────────────────────────────────────── */
const C = {
  gold: "#e0a13a",
  teal: "#16a79a",
  delayed: "#f43f5e",
  atRisk: "#ea8a2b",
  pageBg: "#f0ede6",
  cardBg: "#faf9f6",
  cardBorder: "#e8e4da",
  shadow: "0 2px 12px rgba(60,40,10,0.07), 0 1px 3px rgba(60,40,10,0.04)",
  text: "#201e1a",
  muted: "#7a756e",
  subtle: "#b5b0a6",
};

/* ─── KPI stat card ─────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, tint, foot, delta, spark, bars }) {
  return (
    <div
      style={{
        background: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: 16,
        boxShadow: C.shadow,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      <div style={{ padding: "18px 20px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: `${tint}22`,
              display: "grid", placeItems: "center",
              color: tint, flexShrink: 0,
            }}
          >
            {Icon && <Icon size={14} strokeWidth={2.2} />}
          </span>
          <span
            style={{
              fontSize: 11.5, fontWeight: 650, color: C.muted,
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}
          >
            {label}
          </span>
          {delta && (
            <span
              style={{
                marginLeft: "auto", fontSize: 10.5, fontWeight: 700,
                color: C.delayed, background: "#ffe4e6",
                padding: "2px 7px", borderRadius: 99,
                display: "inline-flex", alignItems: "center", gap: 3,
                whiteSpace: "nowrap",
              }}
            >
              ↑ {delta.text}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 32, fontWeight: 780, color: C.text,
            lineHeight: 1, letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </div>
        {foot && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 5, fontWeight: 500 }}>
            {foot}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 52 }}>
        {spark && <Sparkline data={spark} color={tint} height={52} bleed />}
        {bars && !spark && <MiniBars data={bars} color={tint} height={52} bleed />}
      </div>
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
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f1eb")}
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
            background: "#e8e3da", overflow: "hidden",
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
          padding: "18px 20px 14px",
          borderBottom: `1px solid ${C.cardBorder}`,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 720, color: C.text }}>
          Portfolio Health
        </div>
      </div>

      <div style={{ padding: "8px 0 0" }}>
        <DonutChart
          data={donutData}
          height={200}
          innerRadius={62}
          outerRadius={88}
          centerLabel={{ value: totalProjects, label: "PROJECTS" }}
        />
      </div>

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
    </div>
  );
}

/* ─── page ──────────────────────────────────────────────────────────── */
export function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const navigate = useNavigate();

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
              gap: 24,
            }}
          >
            {/* 4 KPI cards */}
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
                bars={data.cityProgress}
                foot={`Across ${data.kpis.cities} cities`}
              />
              <KpiCard
                icon={ActivityIcon}
                label="Active Launches"
                value={data.kpis.activeProjects}
                tint={C.teal}
                spark={data.throughput}
                foot={`Weekly delivery momentum · ${data.kpis.planningProjects} in planning`}
              />
              <KpiCard
                icon={TrendingUp}
                label="Avg Progress"
                value={`${data.kpis.avgProgress}%`}
                tint={C.gold}
                bars={data.cityProgress}
                foot="Progress by city"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Overdue Tasks"
                value={data.kpis.overdueTasks}
                tint={C.delayed}
                delta={
                  data.kpis.overdueTasks > 0
                    ? { text: `${data.kpis.dueThisWeek} due 7d` }
                    : null
                }
                bars={data.dueTrend}
                foot="Workload landing this week"
              />
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
              {/* Active Launches panel */}
              <div
                style={{
                  background: C.cardBg,
                  border: `1px solid ${C.cardBorder}`,
                  borderRadius: 16,
                  boxShadow: C.shadow,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "18px 20px 14px",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    borderBottom: `1px solid ${C.cardBorder}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 720, color: C.text }}>
                      Active Launches
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                      Ranked by health &amp; nearest go-live
                    </div>
                  </div>
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
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = `${C.teal}24`)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = `${C.teal}14`)
                    }
                  >
                    View all <ArrowUpRight size={13} strokeWidth={2.4} />
                  </button>
                </div>

                <div style={{ maxHeight: 430, overflowY: "auto" }}>
                  {data.activeProjects.length === 0 ? (
                    <div
                      style={{
                        padding: 40,
                        textAlign: "center",
                        color: C.muted,
                        fontSize: 13,
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
                </div>
              </div>

              {/* Portfolio Health donut */}
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
