import { useMemo, useState } from 'react';
import {
  Gamepad2, Search, Plus, Pencil, Archive, FileText, Ruler, X, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import {
  useGames, useCreateGame, useUpdateGame, useRetireGame, areaLabel,
} from '../../app/api/gamesApi.js';

/**
 * The game catalogue — Master Data → Games.
 *
 * Route: /games
 *
 * Every game Mystery Rooms can build, with the floor area each one needs. Two
 * places read it and must never disagree with it: Phase 3B, where an outlet's
 * games are chosen against its area, and Phase 10, where they are installed.
 * Seeded from the client's own spreadsheet and maintained here from then on.
 *
 * A game can have several approved layouts at different areas (Forgotten fits
 * 532 sq ft or 716), each with its own PDF and DWG — so the area is shown as a
 * range and the layouts are listed underneath, rather than flattening the
 * catalogue into one number per game and losing the drawings.
 */

const isLink = (v) => /^https?:\/\//i.test(String(v || '').trim());

/** A drawing link, or the bare filename the sheet gave when it is not a link. */
function DrawingLink({ url, label }) {
  if (!url) return null;
  if (!isLink(url)) return <span className="tiny muted" title="Not a link in the source sheet">{label}: {url}</span>;
  return (
    <a className="tiny" href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>
      {label} <ExternalLink size={10} />
    </a>
  );
}

const blank = {
  name: '', minAreaSqft: '', maxAreaSqft: '', category: '',
  durationMinutes: '', playersMin: '', playersMax: '', notes: '',
};

export default function GamesPage() {
  const user = useAppSelector(selectCurrentUser);
  const canManage = can.decide(user?.role);

  const [showRetired, setShowRetired] = useState(false);
  const { data, isLoading, isError } = useGames(showRetired);
  const create = useCreateGame();
  const update = useUpdateGame();
  const retire = useRetireGame();

  const [search, setSearch] = useState('');
  const [fits, setFits] = useState('');       // "what fits in this many sq ft?"
  const [editing, setEditing] = useState(null); // game | 'new'
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const games = data?.data || data || [];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const area = Number(fits);
    return games.filter((g) => {
      if (q && ![g.name, g.code, g.category].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      // "Fits in": the SMALLEST approved layout is what decides whether a game
      // can go into a space at all, so that is what this compares.
      if (Number.isFinite(area) && area > 0 && (g.minAreaSqft ?? 0) > area) return false;
      return true;
    });
  }, [games, search, fits]);

  const totals = useMemo(() => ({
    games: games.length,
    layouts: games.reduce((n, g) => n + (g.layouts?.length || 0), 0),
    smallest: games.reduce((m, g) => (g.minAreaSqft != null ? Math.min(m, g.minAreaSqft) : m), Infinity),
  }), [games]);

  const openNew = () => { setForm(blank); setEditing('new'); setError(null); };
  const openEdit = (g) => {
    setForm({
      name: g.name || '', minAreaSqft: g.minAreaSqft ?? '', maxAreaSqft: g.maxAreaSqft ?? '',
      category: g.category || '', durationMinutes: g.durationMinutes ?? '',
      playersMin: g.playersMin ?? '', playersMax: g.playersMax ?? '', notes: g.notes || '',
    });
    setEditing(g);
    setError(null);
  };

  const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
  const save = async () => {
    setError(null);
    const body = {
      name: form.name.trim(),
      minAreaSqft: numOrNull(form.minAreaSqft),
      maxAreaSqft: numOrNull(form.maxAreaSqft),
      category: form.category.trim() || null,
      durationMinutes: numOrNull(form.durationMinutes),
      playersMin: numOrNull(form.playersMin),
      playersMax: numOrNull(form.playersMax),
      notes: form.notes.trim() || null,
    };
    if (!body.name) { setError('The game needs a name.'); return; }
    try {
      if (editing === 'new') await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing._id, ...body });
      setEditing(null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save that.');
    }
  };

  const toggleRow = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const busy = create.isPending || update.isPending || create.isLoading || update.isLoading;

  return (
    <>
      <Topbar title={<span className="row gap-2" style={{ alignItems: 'center' }}><Gamepad2 size={18} /> Games</span>} />

      <div className="content col gap-4">
        <div className="stage-explain">
          <div className="stage-explain-main">
            <span className="stage-explain-step">Master data</span>
            <p className="stage-explain-text">
              Every game we can build, and the floor area each one needs. Phase 3B picks an outlet’s
              games from this list and Phase 10 installs them — so a game added here is available on
              every project, with no template to edit.
            </p>
          </div>
        </div>

        <div className="pt-kpis">
          <div className="pt-kpi"><span className="pt-kpi-label">Games</span><span className="pt-kpi-value">{totals.games}</span></div>
          <div className="pt-kpi"><span className="pt-kpi-label">Approved layouts</span><span className="pt-kpi-value">{totals.layouts}</span></div>
          <div className="pt-kpi">
            <span className="pt-kpi-label">Smallest game</span>
            <span className="pt-kpi-value is-small">{Number.isFinite(totals.smallest) ? `${totals.smallest.toLocaleString('en-IN')} sq ft` : '—'}</span>
          </div>
        </div>

        <section className="card pt-card">
          <div className="card-head pt-toolbar">
            <h2 className="card-title">Game catalogue</h2>
            <div className="pt-filters">
              <label className="pt-search">
                <Search size={14} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a game…" />
              </label>
              {/* The question a planner actually asks of this list. */}
              <label className="pt-search" title="Show only games that fit in this area">
                <Ruler size={14} />
                <input
                  type="number" min={0} style={{ width: 120 }} value={fits}
                  onChange={(e) => setFits(e.target.value)} placeholder="Fits in sq ft"
                />
              </label>
              <label className="row gap-1 tiny muted" style={{ alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
                Show retired
              </label>
              {canManage && (
                <button type="button" className="btn btn-primary btn-sm" onClick={openNew} data-guide="games-add">
                  <Plus size={14} /> Add a game
                </button>
              )}
            </div>
          </div>

          {isLoading ? <SkTable rows={6} /> : isError ? (
            <EmptyState icon={AlertTriangle} title="Could not load the catalogue" hint="The games service didn’t respond." />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Gamepad2}
              title={games.length ? 'No game matches that' : 'No games yet'}
              hint={games.length ? 'Try a different search or area.' : 'Run seedGames.js, or add the first game here.'}
            />
          ) : (
            <div className="pt-table-wrap">
              <table className="table pt-table" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>Game</th>
                    <th>Min area</th>
                    <th>Max area (sq ft)</th>
                    <th>Layouts</th>
                    <th>Drawings</th>
                    {canManage && <th style={{ width: 120 }} />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((g, i) => {
                    const open = expanded.has(g._id);
                    const layouts = g.layouts || [];
                    return (
                      <RowGroup key={g._id}>
                        <tr className="pt-row" onClick={() => layouts.length && toggleRow(g._id)} title={layouts.length ? 'Show the layouts' : ''}>
                          <td className="muted">{i + 1}</td>
                          <td>
                            <div className="pt-order">
                              <b>{g.name}</b>
                              <span className="tiny muted">
                                {[g.category, g.playersMin && `${g.playersMin}–${g.playersMax || g.playersMin} players`,
                                  g.durationMinutes && `${g.durationMinutes} min`].filter(Boolean).join(' · ') || g.code}
                              </span>
                            </div>
                          </td>
                          {/* Min = the smallest approved layout; Max = the
                              sheet's own "maximum area required" — shown
                              apart, because "how much space can this game
                              take" is its own planning question. */}
                          <td className="pt-nowrap">{g.minAreaSqft != null ? `${g.minAreaSqft} sq ft` : <span className="muted">—</span>}</td>
                          <td className="pt-nowrap"><b>{g.maxAreaSqft != null ? `${g.maxAreaSqft} sq ft` : (g.minAreaSqft != null ? `${g.minAreaSqft} sq ft` : '—')}</b></td>
                          <td className="pt-nowrap">
                            {layouts.length ? (
                              <span className="tiny">{layouts.length} option{layouts.length === 1 ? '' : 's'} · {open ? 'hide' : 'show'}</span>
                            ) : <span className="muted tiny">—</span>}
                          </td>
                          <td className="pt-nowrap">
                            {layouts.filter((l) => l.pdfUrl).length + (g.extraDrawings?.length || 0)} PDF ·{' '}
                            {layouts.filter((l) => l.dwgUrl).length} DWG
                          </td>
                          {canManage && (
                            <td onClick={(e) => e.stopPropagation()}>
                              <span className="pt-actions">
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(g)} title="Edit">
                                  <Pencil size={13} />
                                </button>
                                {g.active !== false ? (
                                  <button
                                    type="button" className="btn btn-ghost btn-sm" title="Retire — projects that ran it keep it"
                                    onClick={() => retire.mutate(g._id)}
                                  >
                                    <Archive size={13} />
                                  </button>
                                ) : <Badge soft="var(--surface-2)">Retired</Badge>}
                              </span>
                            </td>
                          )}
                        </tr>
                        {open && (
                          <tr className="pt-panel-row">
                            <td colSpan={canManage ? 7 : 6}>
                              <div className="col gap-2">
                                {layouts.map((l, k) => (
                                  <div key={k} className="row gap-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                    <b className="sm" style={{ minWidth: 90 }}>{l.label || `Option ${k + 1}`}</b>
                                    <span className="sm">{l.areaSqft != null ? `${l.areaSqft.toLocaleString('en-IN')} sq ft` : '—'}</span>
                                    <DrawingLink url={l.pdfUrl} label="PDF" />
                                    <DrawingLink url={l.dwgUrl} label="DWG" />
                                  </div>
                                ))}
                                {(g.extraDrawings || []).length > 0 && (
                                  <div className="row gap-3 wrap" style={{ alignItems: 'center' }}>
                                    <b className="sm" style={{ minWidth: 90 }}>Also filed</b>
                                    {g.extraDrawings.map((u, k) => <DrawingLink key={k} url={u} label={`Drawing ${k + 1}`} />)}
                                  </div>
                                )}
                                {g.notes && <span className="tiny muted">{g.notes}</span>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </RowGroup>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing === 'new' ? 'Add a game' : `Edit ${editing.name}`}
          width={520}
          footer={(
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        >
          <div className="col gap-3">
            {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
            <label className="pt-field"><span>Game name</span>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. School of magic" />
            </label>
            <div className="po-ccbcc">
              <label className="pt-field"><span>Smallest area (sq ft)</span>
                <input type="number" min={0} value={form.minAreaSqft} onChange={(e) => setForm((f) => ({ ...f, minAreaSqft: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Maximum area (sq ft)</span>
                <input type="number" min={0} value={form.maxAreaSqft} onChange={(e) => setForm((f) => ({ ...f, maxAreaSqft: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Category</span>
                <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Horror, Adventure…" />
              </label>
              <label className="pt-field"><span>Duration (minutes)</span>
                <input type="number" min={0} value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Players — min</span>
                <input type="number" min={0} value={form.playersMin} onChange={(e) => setForm((f) => ({ ...f, playersMin: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Players — max</span>
                <input type="number" min={0} value={form.playersMax} onChange={(e) => setForm((f) => ({ ...f, playersMax: e.target.value }))} />
              </label>
            </div>
            <label className="pt-field"><span>Notes</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
            <span className="tiny muted">
              <FileText size={11} /> Layout drawings come from the master spreadsheet. Re-run the seed to refresh them.
            </span>
          </div>
        </Modal>
      )}
    </>
  );
}

/** One key per row pair (the row and its expanded panel) without extra markup. */
function RowGroup({ children }) { return <>{children}</>; }
