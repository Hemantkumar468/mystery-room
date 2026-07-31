import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Plus, Search, MapPin, FolderKanban, ClipboardList, PlayCircle, PauseCircle,
  CheckCircle2, AlertTriangle, MoreHorizontal, ArrowUpRight, Copy, SlidersHorizontal,
  ChevronLeft, ChevronRight, RotateCcw, X,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  ProgressBar, ProjectStatusBadge, HealthBadge, Avatar, EmptyState,
} from '../../components/ui/primitives.jsx';
import { SkTable, SkeletonTileGrid } from '../../components/ui/Skeletons.jsx';
import { AnimatedCounter } from './closure/ClosureKit.jsx';
import { useProjects, useDashboard } from '../../app/api/projectsApi.js';
import { fmtDate, daysUntil } from '../../lib/format.js';
import { NewProjectModal } from './NewProjectModal.jsx';

/**
 * The six headline lenses. `kind` maps each to a real query dimension the
 * /pms/projects API already supports — a project status, or the health axis
 * for "At Risk". `statusKey`/`healthKey` read the live count out of the
 * dashboard summary's server-side aggregation, so every number here is real.
 */
const LENSES = [
  { key: 'all', label: 'All Projects', kind: 'all', icon: FolderKanban, accent: '#6366F1' },
  { key: 'planning', label: 'Planning', kind: 'status', value: 'planning', statusKey: 'planning', icon: ClipboardList, accent: '#2563EB' },
  { key: 'active', label: 'Active', kind: 'status', value: 'active', statusKey: 'active', icon: PlayCircle, accent: '#059669' },
  { key: 'on_hold', label: 'On Hold', kind: 'status', value: 'on_hold', statusKey: 'on_hold', icon: PauseCircle, accent: '#D97706' },
  { key: 'completed', label: 'Completed', kind: 'status', value: 'completed', statusKey: 'completed', icon: CheckCircle2, accent: '#0D9488' },
  { key: 'at_risk', label: 'At Risk', kind: 'health', value: 'at_risk', healthKey: 'at_risk', icon: AlertTriangle, accent: '#DC2626' },
];

const PAGE_SIZES = [10, 20, 50];

/** Windowed page list with ellipsis markers, e.g. [1,'…',4,5,6,'…',12]. */
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push('…l');
  for (let p = from; p <= to; p += 1) out.push(p);
  if (to < total - 1) out.push('…r');
  out.push(total);
  return out;
}

/**
 * Per-row actions — a portalled menu so the table's own scroll container can't
 * clip it. Every action is real: it opens the project (the same navigation the
 * row click performs) or copies the project's human code. No placeholder items.
 */
function RowMenu({ project, onOpen }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [copied, setCopied] = useState(false);
  const btnRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 190) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!e.target.closest?.('.proj-row-menu')) setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(project.code); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard unavailable */ }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="proj-actions-btn"
        aria-label="Row actions"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && pos && createPortal(
        <div className="proj-row-menu" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { setOpen(false); onOpen(); }}>
            <ArrowUpRight size={15} /> Open project
          </button>
          <hr />
          <button type="button" onClick={copyCode}>
            <Copy size={15} /> {copied ? 'Code copied' : 'Copy project code'}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

/** One KPI tile — real count + share-of-total, animated. Doubles as the lens filter. */
function KpiCard({ lens, count, total, active, onClick, loading }) {
  const share = total ? (count / total) * 100 : null;
  return (
    <button
      type="button"
      className={`proj-kpi${active ? ' active' : ''}`}
      style={{ '--kpi-accent': lens.accent }}
      onClick={onClick}
      aria-pressed={active}
    >
      <div className="proj-kpi-top">
        <span className="proj-kpi-icon"><lens.icon size={17} strokeWidth={2.1} /></span>
        {!loading && lens.kind !== 'all' && share != null && (
          <span className="proj-kpi-share">{share.toFixed(1)}%</span>
        )}
      </div>
      <span className="proj-kpi-value">
        {loading ? <span className="tabular" style={{ opacity: 0.4 }}>—</span> : <AnimatedCounter value={count} />}
      </span>
      <span className="proj-kpi-label">{lens.label}</span>
    </button>
  );
}

/**
 * Projects — the enterprise list dashboard. Presentation is rebuilt around the
 * SAME data the page always used: the paginated /pms/projects list (status /
 * health / city / search filters + page/limit meta) and the /pms/dashboard/
 * summary aggregation for the headline counts. No value on this page is
 * hardcoded, mocked, or randomly generated — a count with no data reads 0/—.
 */
export function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Dashboard KPI cards ("Active Launches" etc.) navigate here with a
  // preselected lens via router state, e.g. navigate('/projects', { state:
  // { lens: 'active' } }) — falls back to 'all' for direct navigation.
  const [lens, setLens] = useState(() => {
    const requested = location.state?.lens;
    return LENSES.some((l) => l.key === requested) ? requested : 'all';
  });
  const [city, setCity] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const filtersRef = useRef(null);

  // Debounce the search box so a keystroke doesn't fire a request each time.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change returns to the first page — otherwise you can land on a
  // now-empty page (e.g. page 4 of a filter that only has 1 page of results).
  useEffect(() => { setPage(1); }, [lens, city, search, limit]);

  // Close the Filters popover on an outside click.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    const close = (e) => { if (!filtersRef.current?.contains(e.target)) setFiltersOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filtersOpen]);

  const activeLens = LENSES.find((l) => l.key === lens) || LENSES[0];
  const listParams = {
    ...(activeLens.kind === 'status' ? { status: activeLens.value } : {}),
    ...(activeLens.kind === 'health' ? { health: activeLens.value } : {}),
    ...(city ? { city } : {}),
    ...(search ? { search } : {}),
    page,
    limit,
  };

  const { data, isLoading, isError, refetch, isFetching } = useProjects(listParams);
  const { data: dash, isLoading: dashLoading } = useDashboard();

  const projects = data?.data || [];
  const meta = data?.meta || {};
  const totalPages = meta.totalPages || 1;
  const totalMatches = meta.total ?? projects.length;

  // Headline counts straight from the server-side aggregation.
  const byStatus = useMemo(
    () => Object.fromEntries((dash?.statusDistribution || []).map((s) => [s.status, s.count])),
    [dash],
  );
  const byHealth = useMemo(
    () => Object.fromEntries((dash?.healthDistribution || []).map((h) => [h.health, h.count])),
    [dash],
  );
  const totalProjects = dash?.kpis?.totalProjects ?? 0;
  const countFor = (l) => (l.kind === 'all' ? totalProjects : l.statusKey ? (byStatus[l.statusKey] || 0) : (byHealth[l.healthKey] || 0));

  // Real city options for the Filters popover — from the same aggregation.
  const cityOptions = useMemo(
    () => (dash?.cityDistribution || []).map((c) => ({ city: c.city, count: c.count })).filter((c) => c.city),
    [dash],
  );

  const rangeFrom = totalMatches === 0 ? 0 : (page - 1) * limit + 1;
  const rangeTo = Math.min(page * limit, totalMatches);

  return (
    <>
      <Topbar
        title="Projects"
        subtitle="Every franchise launch, end to end"
        actions={
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> New Project
          </button>
        }
      />
      <div className="content projects-content">
        <div className="content-wide col gap-2 fade-in projects-page">
          {/* KPI strip — global counts across every project, not just this page. */}
          {dashLoading ? (
            <SkeletonTileGrid count={6} />
          ) : (
            <div className="proj-kpi-grid">
              {LENSES.map((l) => (
                <KpiCard
                  key={l.key}
                  lens={l}
                  count={countFor(l)}
                  total={totalProjects}
                  active={lens === l.key}
                  loading={dashLoading}
                  onClick={() => setLens(l.key)}
                />
              ))}
            </div>
          )}

          {/* Toolbar — lens chips + search + filters */}
          <div className="proj-toolbar">
            <div className="proj-chips">
              {LENSES.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={`proj-chip${lens === l.key ? ' active' : ''}`}
                  style={{ '--chip-accent': l.accent }}
                  onClick={() => setLens(l.key)}
                >
                  {l.label}
                  {!dashLoading && <span className="proj-chip-count">{countFor(l)}</span>}
                </button>
              ))}
            </div>

            <div className="proj-tools">
              <div className="proj-search">
                <Search size={15} className="subtle" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search projects…"
                  aria-label="Search projects"
                />
                {searchInput && (
                  <button type="button" className="proj-actions-btn" style={{ width: 22, height: 22 }} onClick={() => setSearchInput('')} aria-label="Clear search">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div style={{ position: 'relative' }} ref={filtersRef}>
                <button
                  type="button"
                  className={`proj-filter-btn${city ? ' active' : ''}`}
                  onClick={() => setFiltersOpen((o) => !o)}
                >
                  <SlidersHorizontal size={15} /> Filters
                  {city && <span className="proj-filter-dot" />}
                </button>
                {filtersOpen && (
                  <div className="proj-filters-pop">
                    <div className="col gap-1">
                      <span className="tiny subtle upper">City</span>
                      <select className="proj-page-size" style={{ height: 36, width: '100%' }} value={city} onChange={(e) => setCity(e.target.value)}>
                        <option value="">All cities</option>
                        {cityOptions.map((c) => (
                          <option key={c.city} value={c.city}>{c.city} ({c.count})</option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn btn-subtle btn-sm"
                      disabled={!city}
                      onClick={() => { setCity(''); setFiltersOpen(false); }}
                    >
                      <RotateCcw size={13} style={{ marginRight: 6 }} /> Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Table / states */}
          {isLoading ? (
            <div className="card"><SkTable rows={limit > 10 ? 10 : limit} /></div>
          ) : isError ? (
            <div className="card">
              <div className="proj-error">
                <span className="proj-error-icon"><AlertTriangle size={24} /></span>
                <div className="col gap-1 center">
                  <span style={{ fontWeight: 700 }}>Couldn’t load projects</span>
                  <span className="sm muted">The projects service didn’t respond. Check your connection and try again.</span>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => refetch()}>
                  <RotateCcw size={15} style={{ marginRight: 6 }} /> Retry
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              {!projects.length ? (
                <EmptyState
                  icon={FolderKanban}
                  title={search || city || lens !== 'all' ? 'No projects match these filters' : 'No projects yet'}
                  hint={search || city || lens !== 'all' ? 'Try clearing the search or filters.' : 'Create your first franchise launch from a template.'}
                  action={
                    search || city || lens !== 'all'
                      ? <button className="btn btn-subtle" onClick={() => { setLens('all'); setCity(''); setSearchInput(''); }}>Clear filters</button>
                      : <button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={16} /> New Project</button>
                  }
                />
              ) : (
                <>
                  <div className="proj-table-wrap">
                    <table className="table table-clickable proj-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Location</th>
                          <th>Status</th>
                          <th>Health</th>
                          <th style={{ width: 160 }}>Progress</th>
                          <th>Opening Date</th>
                          <th>Go-Live</th>
                          <th>Owner</th>
                          <th style={{ width: 60, textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map((p) => {
                          const dleft = daysUntil(p.targetEndDate);
                          const open = () => navigate(`/projects/${p._id}`);
                          return (
                            <tr key={p._id} onClick={open}>
                              <td>
                                <div className="col" style={{ gap: 2 }}>
                                  <span className="proj-code">{p.code}</span>
                                  <span className="proj-name">{p.name}</span>
                                </div>
                              </td>
                              <td>
                                <span className="proj-loc"><MapPin size={13} className="subtle" />{p.city || '—'}</span>
                                {p.address && <span className="proj-loc-sub" title={p.address}>{p.address}</span>}
                              </td>
                              <td><ProjectStatusBadge value={p.status} /></td>
                              <td><HealthBadge value={p.health} /></td>
                              <td>
                                <div className="proj-progress-cell">
                                  <ProgressBar value={p.progress} height={6} />
                                  <span className="tabular sm" style={{ width: 36, textAlign: 'right', fontWeight: 650 }}>{p.progress ?? 0}%</span>
                                </div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}><span className="sm">{fmtDate(p.plannedStartDate)}</span></td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div className="col">
                                  <span className="sm">{fmtDate(p.targetEndDate)}</span>
                                  {dleft != null && (
                                    <span className="tiny" style={{ color: dleft < 0 ? 'var(--danger)' : 'var(--text-subtle)' }}>
                                      {dleft < 0 ? `${-dleft}d overdue` : `${dleft}d left`}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td>
                                {p.owner ? (
                                  <span className="proj-owner">
                                    <Avatar name={p.owner.name} color={p.owner.avatarColor} size={28} />
                                    <span className="proj-owner-name">{p.owner.name}</span>
                                  </span>
                                ) : <span className="subtle sm">—</span>}
                              </td>
                              <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                                <RowMenu project={p} onOpen={open} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination — driven entirely by the API's own meta. */}
                  <div className="proj-pager">
                    <span className="proj-pager-info">
                      Showing {rangeFrom}–{rangeTo} of {totalMatches} project{totalMatches === 1 ? '' : 's'}
                      {isFetching && <span className="muted"> · updating…</span>}
                    </span>
                    <div className="proj-pager-controls">
                      <button
                        type="button"
                        className="proj-page-btn"
                        disabled={!meta.hasPrevPage}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={15} />
                      </button>
                      {pageWindow(page, totalPages).map((p) => (
                        typeof p === 'number' ? (
                          <button
                            key={p}
                            type="button"
                            className={`proj-page-btn${p === page ? ' active' : ''}`}
                            onClick={() => setPage(p)}
                            aria-current={p === page ? 'page' : undefined}
                          >
                            {p}
                          </button>
                        ) : <span key={p} className="proj-page-ellipsis">…</span>
                      ))}
                      <button
                        type="button"
                        className="proj-page-btn"
                        disabled={!meta.hasNextPage}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        aria-label="Next page"
                      >
                        <ChevronRight size={15} />
                      </button>
                      <select
                        className="proj-page-size"
                        value={limit}
                        onChange={(e) => setLimit(Number(e.target.value))}
                        aria-label="Rows per page"
                      >
                        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

export default ProjectsPage;
