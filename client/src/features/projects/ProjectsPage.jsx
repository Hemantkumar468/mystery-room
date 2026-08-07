import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Plus, Search, MapPin, FolderKanban, ClipboardList, PlayCircle, PauseCircle,
  CheckCircle2, AlertTriangle, MoreHorizontal, ArrowUpRight, Copy, SlidersHorizontal,
  ChevronLeft, ChevronRight, ChevronDown, RotateCcw, X, PenLine, Pencil,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  ProgressBar, ProjectStatusBadge, HealthBadge, Avatar, EmptyState,
} from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useProjects, useDashboard } from '../../app/api/projectsApi.js';
import { fmtDate, daysUntil } from '../../lib/format.js';
import { HEALTH_META } from '../../lib/ui.js';
import { NewProjectModal } from './NewProjectModal.jsx';
import { useIsMobile } from '../../hooks/useBreakpoint.js';

/**
 * The six headline lenses. `kind` maps each to a real query dimension the
 * /pms/projects API already supports — a project status, or the health axis
 * for "At Risk". `statusKey`/`healthKey` read the live count out of the
 * dashboard summary's server-side aggregation, so every number here is real.
 */
const LENSES = [
  { key: 'all', label: 'All', kind: 'all', icon: FolderKanban, accent: '#6366F1', primary: true },
  { key: 'planning', label: 'Planning', kind: 'status', value: 'planning', statusKey: 'planning', icon: ClipboardList, accent: '#2563EB', primary: true },
  { key: 'active', label: 'Active', kind: 'status', value: 'active', statusKey: 'active', icon: PlayCircle, accent: '#059669', primary: true },
  { key: 'at_risk', label: 'At risk', kind: 'health', value: 'at_risk', healthKey: 'at_risk', icon: AlertTriangle, accent: '#DC2626', primary: true },
  { key: 'draft', label: 'Draft', kind: 'status', value: 'draft', statusKey: 'draft', icon: PenLine, accent: '#6B7280' },
  { key: 'on_hold', label: 'On Hold', kind: 'status', value: 'on_hold', statusKey: 'on_hold', icon: PauseCircle, accent: '#D97706' },
  { key: 'completed', label: 'Completed', kind: 'status', value: 'completed', statusKey: 'completed', icon: CheckCircle2, accent: '#0D9488' },
];

/**
 * The four lenses that earn a permanent chip. Seven chips wrapped onto two
 * rows and gave Draft/On Hold/Completed the same weight as At Risk, which is
 * the one anybody actually scans for. The rest live behind "More".
 */
const PRIMARY_LENSES = LENSES.filter((l) => l.primary);
const MORE_LENSES = LENSES.filter((l) => !l.primary);

const PAGE_SIZES = [10, 20, 50];

/**
 * Progress needs a word, not just a number: "12%" alone says nothing about
 * whether that is fine. This folds the health axis into the progress cell —
 * which is what removed Health as its own column without losing the signal.
 */
function progressMeta(p) {
  const pct = p.progress ?? 0;
  if (p.status === 'completed') return { pct, label: 'complete', color: HEALTH_META.on_track.color };
  if (pct === 0) return { pct, label: 'not started', color: 'var(--text-subtle)' };
  const h = HEALTH_META[p.health];
  if (p.health === 'at_risk' || p.health === 'delayed') {
    return { pct, label: p.health === 'delayed' ? 'delayed' : 'behind plan', color: h.color };
  }
  return { pct, label: 'on track', color: HEALTH_META.on_track.color };
}

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
  const isDraft = project.status === 'draft';
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
            {isDraft ? <><Pencil size={15} /> Continue Editing</> : <><ArrowUpRight size={15} /> Open project</>}
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

/**
 * Mobile (<768px) stand-in for one `<tr>` of the projects table — same data,
 * same click-to-open + RowMenu actions, laid out as a stacked card instead of
 * table columns squeezed into a narrow viewport. See .table's Location/
 * Progress/Dates/Owner columns above for the fields this mirrors.
 */
function ProjectCard({ project: p, onOpen }) {
  const dleft = daysUntil(p.targetEndDate);
  return (
    <div className="proj-card" onClick={onOpen}>
      <div className="proj-card-top">
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="proj-code">{p.code}</span>
          <span className="proj-name">{p.name}</span>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <RowMenu project={p} onOpen={onOpen} />
        </div>
      </div>

      <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
        <ProjectStatusBadge value={p.status} />
        <HealthBadge value={p.health} />
      </div>

      <span className="proj-loc"><MapPin size={13} className="subtle" />{p.city || '—'}</span>

      <div className="proj-progress-cell">
        <ProgressBar value={p.progress} height={6} />
        <span className="tabular sm" style={{ width: 36, textAlign: 'right', fontWeight: 650 }}>{p.progress ?? 0}%</span>
      </div>

      <div className="proj-card-dates">
        <div className="col gap-1">
          <span className="tiny subtle upper">Opening</span>
          <span className="sm">{fmtDate(p.plannedStartDate)}</span>
        </div>
        <div className="col gap-1">
          <span className="tiny subtle upper">Go-Live</span>
          <span className="sm">{fmtDate(p.targetEndDate)}</span>
          {dleft != null && (
            <span className="tiny" style={{ color: dleft < 0 ? 'var(--danger)' : 'var(--text-subtle)' }}>
              {dleft < 0 ? `${-dleft}d overdue` : `${dleft}d left`}
            </span>
          )}
        </div>
      </div>

      {p.owner && (
        <span className="proj-owner">
          <Avatar name={p.owner.name} color={p.owner.avatarColor} size={26} />
          <span className="proj-owner-name">{p.owner.name}</span>
        </span>
      )}
    </div>
  );
}

/** Pagination footer — identical under the table (desktop/tablet) and the card list (mobile). */
function Pager({ rangeFrom, rangeTo, totalMatches, isFetching, meta, page, totalPages, limit, setPage, setLimit }) {
  return (
    <div className="proj-pager">
      <span className="proj-pager-info">
        Showing {rangeFrom}–{rangeTo} of {totalMatches} project{totalMatches === 1 ? '' : 's'}
        {isFetching && <span className="muted"> · updating…</span>}
        {/* Stated because the order is not obvious from the rows themselves,
            and an unexplained order reads as no order. Kept truthful by the
            `sort: 'targetEndDate'` sent with the query. */}
        <span className="proj-sort-note">Sorted by go-live date, soonest first</span>
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
  );
}

/**
 * A single line naming what needs a decision, above the list rather than
 * inside it.
 *
 * This replaces the six KPI tiles. Those cost roughly a third of the first
 * screen to restate counts the filter chips already carry, and none of them
 * said which number was a problem. Only renders when something is actually
 * wrong — a banner that is always present stops being read.
 *
 * Both counts come from the server-side aggregation, so this never disagrees
 * with the chips beside it.
 */
function AttentionBanner({ atRisk, planning, onView }) {
  if (!atRisk && !planning) return null;

  const parts = [];
  if (atRisk) parts.push(`${atRisk} project${atRisk === 1 ? ' is' : 's are'} at risk`);
  if (planning) parts.push(`${planning} ${planning === 1 ? 'is' : 'are'} still in planning`);

  return (
    <div className="proj-banner" role="status">
      <AlertTriangle size={17} className="proj-banner-icon" strokeWidth={2.2} />
      <span className="proj-banner-text">{parts.join(' and ')}</span>
      {atRisk > 0 && (
        <button type="button" className="proj-banner-btn" onClick={onView}>
          View these
        </button>
      )}
    </div>
  );
}

/** Overflow lenses — the ones that don't earn a permanent chip. */
function MoreLensMenu({ lens, setLens, countFor, loading }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Surfaces the active lens on the chip itself, so a filter selected from in
  // here is never invisible behind a generic "More".
  const activeInMore = MORE_LENSES.find((l) => l.key === lens);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        className={`proj-chip${activeInMore ? ' active' : ''}`}
        style={{ '--chip-accent': activeInMore?.accent || '#6B7280' }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {activeInMore ? activeInMore.label : 'More'}
        {activeInMore && !loading && <span className="proj-chip-count">{countFor(activeInMore)}</span>}
        <ChevronDown size={13} strokeWidth={2.4} style={{ marginLeft: 2 }} />
      </button>
      {open && (
        <div className="proj-more-menu" role="menu">
          {MORE_LENSES.map((l) => (
            <button
              key={l.key}
              type="button"
              role="menuitem"
              className={lens === l.key ? 'active' : undefined}
              onClick={() => { setLens(l.key); setOpen(false); }}
            >
              <span className="proj-more-dot" style={{ background: l.accent }} />
              {l.label}
              {!loading && <span className="proj-more-count">{countFor(l)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
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
  const isMobile = useIsMobile();

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
  // Which draft (if any) the modal is Continuing Editing — null for a fresh
  // "+ New Project" create. See NewProjectModal's `draftId` prop. Same
  // router-state pattern as `lens` above — ProjectDetailPage's draft guard
  // navigates back here with `state: { continueDraftId }` when someone lands
  // directly on a draft's URL, so the modal reopens on the right one.
  const [editingDraftId, setEditingDraftId] = useState(() => location.state?.continueDraftId || null);
  const [modalOpen, setModalOpen] = useState(() => Boolean(location.state?.continueDraftId));
  const filtersRef = useRef(null);

  const openNewProjectModal = () => { setEditingDraftId(null); setModalOpen(true); };

  // Drafts have no materialized stages/tasks yet — ProjectDetailPage assumes
  // a real project, so a draft row opens the Create Project modal (Continue
  // Editing) instead of navigating there.
  const openProject = (p) => {
    if (p.status === 'draft') { setEditingDraftId(p._id); setModalOpen(true); return; }
    navigate(`/projects/${p._id}`);
  };

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
    // Soonest go-live first. The API defaults to newest-created, which is an
    // accident of data entry rather than an order anyone runs a launch by —
    // and it is what the footer now states, so it has to be genuinely applied.
    sort: 'targetEndDate',
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
        // Hidden on mobile — the bottom nav's "Projects" tab is already
        // highlighted active, so the title was redundant there; still
        // shows on tablet/desktop, which have no equivalent nav indicator.
        title={isMobile ? undefined : 'Projects'}
        // Says what the page holds and whether any of it needs the reader,
        // rather than restating the page's own name in a sentence.
        subtitle={
          dashLoading
            ? 'Every franchise launch, end to end'
            : `${totalProjects} franchise launch${totalProjects === 1 ? '' : 'es'}` +
              ((byHealth.at_risk || 0) > 0 ? ` · ${byHealth.at_risk} need attention` : '')
        }
        actions={
          <button className="btn btn-primary" onClick={openNewProjectModal}>
            <Plus size={16} /> New Project
          </button>
        }
      />
      <div className="content projects-content">
        <div className="content-wide col gap-2 fade-in projects-page">
          {!dashLoading && (
            <AttentionBanner
              atRisk={byHealth.at_risk || 0}
              planning={byStatus.planning || 0}
              onView={() => setLens('at_risk')}
            />
          )}

          {/* Toolbar — lens chips + search + filters */}
          <div className="proj-toolbar">
            <div className="proj-chips">
              {PRIMARY_LENSES.map((l) => (
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
              <MoreLensMenu lens={lens} setLens={setLens} countFor={countFor} loading={dashLoading} />
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
                      : <button className="btn btn-primary" onClick={openNewProjectModal}><Plus size={16} /> New Project</button>
                  }
                />
              ) : isMobile ? (
                <>
                  <div className="proj-card-list">
                    {projects.map((p) => (
                      <ProjectCard key={p._id} project={p} onOpen={() => openProject(p)} />
                    ))}
                  </div>

                  <Pager
                    rangeFrom={rangeFrom} rangeTo={rangeTo} totalMatches={totalMatches} isFetching={isFetching}
                    meta={meta} page={page} totalPages={totalPages} limit={limit} setPage={setPage} setLimit={setLimit}
                  />
                </>
              ) : (
                <>
                  <div className="proj-table-wrap">
                    <table className="table table-clickable proj-table">
                      {/* Nine columns became five. Owner and code moved into
                          the Project cell, Health folded into the progress
                          label, and Opening Date left entirely — Go-live is
                          the date a launch is actually run against. */}
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th style={{ width: 140 }}>City</th>
                          <th style={{ width: 130 }}>Status</th>
                          <th style={{ width: 210 }}>Progress</th>
                          <th style={{ width: 150 }}>Go-live</th>
                          <th style={{ width: 52 }} aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map((p) => {
                          const dleft = daysUntil(p.targetEndDate);
                          const open = () => openProject(p);
                          const prog = progressMeta(p);
                          return (
                            <tr key={p._id} onClick={open}>
                              <td>
                                <div className="proj-cell-project">
                                  <Avatar name={p.owner?.name || p.name} color={p.owner?.avatarColor} size={32} />
                                  <div className="col" style={{ gap: 1, minWidth: 0 }}>
                                    <span className="proj-name">{p.name}</span>
                                    <span className="proj-sub">
                                      <span className="proj-code">{p.code}</span>
                                      {p.owner?.name && <> · {p.owner.name}</>}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="sm">{p.city || '—'}</td>
                              <td><ProjectStatusBadge value={p.status} /></td>
                              <td>
                                <div className="col" style={{ gap: 5 }}>
                                  <ProgressBar value={prog.pct} height={5} />
                                  <span className="proj-progress-label">
                                    <span className="tabular" style={{ fontWeight: 700 }}>{prog.pct}%</span>
                                    <span style={{ color: prog.color }}> · {prog.label}</span>
                                  </span>
                                </div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div className="col" style={{ gap: 1 }}>
                                  <span className="sm">{fmtDate(p.targetEndDate)}</span>
                                  {dleft != null && (
                                    <span className="tiny" style={{ color: dleft < 0 ? 'var(--danger)' : 'var(--text-subtle)' }}>
                                      {dleft < 0 ? `${-dleft} days overdue` : `${dleft} days left`}
                                    </span>
                                  )}
                                </div>
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

                  <Pager
                    rangeFrom={rangeFrom} rangeTo={rangeTo} totalMatches={totalMatches} isFetching={isFetching}
                    meta={meta} page={page} totalPages={totalPages} limit={limit} setPage={setPage} setLimit={setLimit}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <NewProjectModal open={modalOpen} draftId={editingDraftId} onClose={() => setModalOpen(false)} />
    </>
  );
}

export default ProjectsPage;
