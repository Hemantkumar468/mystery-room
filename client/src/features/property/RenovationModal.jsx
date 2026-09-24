import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, UserCog, Gamepad2, Plus, Hammer, AlertCircle, CalendarDays, Gauge,
  FileText, Ruler, Sparkles, CheckCircle2,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useProjects, useCreateProject } from '../../app/api/projectsApi.js';
import {
  useLazyGetStageRecordsQuery, useGlobalStageRecords,
  useCreateRecordMutation, useUpdateRecordMutation,
} from '../../app/api/recordsApi.js';
import { useGames, areaLabel } from '../../app/api/gamesApi.js';

/**
 * Renovation & Add Games — its own form, not the new-project form with a
 * picker bolted onto it.
 *
 * WHY SEPARATE. Creating a centre asks what to build and where. Renovating one
 * asks neither: the site is already ours and already approved. The only real
 * question is WHICH GAMES — which of the ones running today are being redone,
 * and which new ones are coming in. The shared form could carry a centre
 * picker but it could never carry that list, and a renovation decided without
 * seeing what the centre already runs is decided blind.
 *
 * NOTHING IS ASKED THAT THE CENTRE ALREADY ANSWERS. Pick the project and its
 * code, city, area and project manager are SHOWN, not re-entered — they are
 * read off that project, so they cannot drift from it. The manager in
 * particular is named rather than chosen: whoever runs the centre runs its
 * renovation unless somebody decides otherwise, and that is a change to make
 * on the project, not a question to ask again here.
 *
 * WHAT IT WRITES, and why it does not write the obvious thing. Creating the
 * project with `kind: 'renovation'` + `sourceProjectId` makes the server carry
 * the site over, close Phases 1–3 (that property was found, assessed and
 * signed when the centre was built) and — this is the part worth knowing —
 * carryPlanFromSource() ALREADY creates the Project Plan (p20) draft with the
 * source centre's games in it. So this form does not create a second plan; it
 * finds that carried one and writes the decision made here into it. Creating
 * another would leave two plans on one project and no way to tell which the
 * planner should fill in. Only if the source centre predates p20 (nothing to
 * carry) does this file a plan itself.
 */
const PLAN_STAGE = 'p20';

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const today = () => new Date().toISOString().slice(0, 10);

export function RenovationModal({ open, onClose }) {
  const navigate = useNavigate();
  const [sourceId, setSourceId] = useState('');
  const [renovating, setRenovating] = useState(() => new Set());
  const [adding, setAdding] = useState(() => new Set());
  const [plannedStartDate, setPlannedStartDate] = useState(today);
  const [priority, setPriority] = useState('medium');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const { data: projResp } = useProjects({ limit: 200 });
  const allProjects = projResp?.data?.items || projResp?.data || projResp || [];
  const { data: planRows } = useGlobalStageRecords(PLAN_STAGE, { enabled: open });
  const { data: gameRows } = useGames();

  const createProject = useCreateProject();
  const [fetchStageRecords] = useLazyGetStageRecordsQuery();
  const [createRecord] = useCreateRecordMutation();
  const [updateRecord] = useUpdateRecordMutation();

  useEffect(() => {
    if (!open) return;
    setSourceId('');
    setRenovating(new Set());
    setAdding(new Set());
    setPlannedStartDate(today());
    setPriority('medium');
    setRemarks('');
    setError('');
    setCreated(null);
  }, [open]);

  /* Only real centres can be renovated — a draft was never built. */
  /* Newest first, with the date on the option: the centre somebody is about to
     renovate is far more often a recent one than one beginning with "A". */
  const centres = useMemo(() => [...(Array.isArray(allProjects) ? allProjects : [])]
    .filter((p) => p.status !== 'draft' && p.kind !== 'renovation')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)), [allProjects]);
  const source = centres.find((p) => String(p._id) === String(sourceId)) || null;

  /* The games the chosen centre runs today, read off its own Project Plan —
     the one place that list actually lives (values.selected_games). */
  const running = useMemo(() => {
    if (!source) return [];
    const rows = Array.isArray(planRows) ? planRows : (planRows?.data || []);
    const plan = rows
      .filter((r) => String(r.project?._id || r.project) === String(source._id))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
    const games = plan?.values?.selected_games;
    return Array.isArray(games) ? games.filter(Boolean) : [];
  }, [source, planRows]);

  /* A game the centre already runs cannot be "added" — it can only be redone,
     and it is already on the list above. */
  const addable = useMemo(() => {
    const have = new Set(running.map((g) => String(g).toLowerCase()));
    const rows = Array.isArray(gameRows) ? gameRows : (gameRows?.data || []);
    return rows.filter((g) => !have.has(String(g.name || '').toLowerCase()));
  }, [gameRows, running]);

  const toggle = (setter) => (value) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  const redo = [...renovating];
  const fresh = [...adding];
  const canSubmit = Boolean(source) && (redo.length > 0 || fresh.length > 0) && Boolean(plannedStartDate);

  /* What the outlet runs AFTER this renovation: everything it runs today
     (redone or not — a game left alone is still installed) plus the new ones.
     Which of them this renovation actually touches is said in the notes, so
     the planner reads one honest list and one honest scope. */
  const afterGames = [...running, ...fresh];

  const planValues = (centre) => ({
    selected_games: afterGames,
    game_count: afterGames.length,
    confirmed_area: centre.areaSqft ?? undefined,
    game_notes: [
      redo.length
        ? `Being renovated: ${redo.join(', ')}.`
        : 'No existing game is being renovated — this is an addition only.',
      fresh.length ? `Being added: ${fresh.join(', ')}.` : null,
      running.filter((g) => !renovating.has(g)).length
        ? `Untouched (stays as-is): ${running.filter((g) => !renovating.has(g)).join(', ')}.`
        : null,
      remarks.trim() || null,
    ].filter(Boolean).join('\n'),
  });

  const submit = async () => {
    setError('');
    if (!source) { setError('Pick the project being renovated.'); return; }
    if (!redo.length && !fresh.length) {
      setError('Tick at least one game — one to renovate, one to add, or both.');
      return;
    }
    setBusy(true);
    try {
      /* City, address and area are deliberately NOT sent: the server takes
         them off the source centre. The owner is, so the centre's project
         manager stays its project manager through the renovation. */
      const project = await createProject.mutateAsync({
        name: `${source.name} — Renovation`,
        kind: 'renovation',
        sourceProjectId: source._id,
        plannedStartDate,
        priority,
        ...(source.owner?._id ? { owner: source.owner._id } : {}),
        ...(remarks.trim() ? { description: remarks.trim() } : {}),
      });

      /* Write the game decision onto the plan the server just carried over,
         rather than filing a second one beside it. */
      let planned = true;
      try {
        const rows = await fetchStageRecords({ projectId: project._id, stageKey: PLAN_STAGE }).unwrap();
        const carried = (Array.isArray(rows) ? rows : []).find((r) => r.status === 'draft') || (rows || [])[0];
        if (carried) {
          await updateRecord({
            id: carried._id,
            projectId: project._id,
            stageKey: PLAN_STAGE,
            values: { ...(carried.values || {}), ...planValues(source) },
          }).unwrap();
        } else {
          await createRecord({
            projectId: project._id,
            stageKey: PLAN_STAGE,
            status: 'draft',
            values: planValues(source),
          }).unwrap();
        }
      } catch {
        planned = false;
      }

      setCreated({ project, planned });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not start the renovation.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  if (created) {
    const { project, planned } = created;
    return (
      <Modal open onClose={onClose} width={null} className="np-modal rnv-modal" title="Renovation started" subtitle={project.name}>
        <div className="np-success">
          <span className="np-success-ring"><CheckCircle2 size={38} strokeWidth={2.2} /></span>
          <div className="np-success-title">{project.name}</div>
          <div className="np-success-sub">
            {planned
              ? <>Project <span className="np-success-code">{project.code}</span> is open, and its plan already carries {afterGames.length} game{afterGames.length === 1 ? '' : 's'} — {redo.length} being renovated, {fresh.length} new.</>
              : <>Project <span className="np-success-code">{project.code}</span> is open. The game list could not be written to its plan — open the plan and tick them there.</>}
          </div>
          <div className="np-success-meta">
            {project.city && <span className="np-success-chip"><Building2 size={13} /> {project.city}</span>}
            <span className="np-success-chip"><CalendarDays size={13} /> {plannedStartDate}</span>
            <span className="np-success-chip"><Gamepad2 size={13} /> {afterGames.length} games</span>
          </div>
          <div className="row gap-2" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Stay here</button>
            <button type="button" className="btn btn-primary" onClick={() => { onClose?.(); navigate(`/projects/${project._id}`); }}>
              Open the renovation
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      width={null}
      className="np-modal rnv-modal"
      title="Renovation & Add Games"
      subtitle="An existing centre — redo the games it runs, bring new ones in, or both"
      footer={(
        <>
          {error
            ? <span className="np-footer-err"><AlertCircle size={15} /> {error}</span>
            : (
              <span className="rnv-tally">
                {source
                  ? <>{redo.length} to renovate · {fresh.length} to add</>
                  : 'Pick the project being renovated'}
              </span>
            )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !canSubmit}>
            {busy ? <span className="spinner" /> : <><Hammer size={15} style={{ marginRight: 6 }} /> Start the renovation</>}
          </button>
        </>
      )}
    >
      <div className="np-body rnv-body">
        <div className="np-field np-field--full">
          <label className="np-label">Which project is being renovated? <span className="np-req">*</span></label>
          <select
            className="input"
            value={sourceId}
            onChange={(e) => { setSourceId(e.target.value); setRenovating(new Set()); setAdding(new Set()); }}
          >
            <option value="">Pick the project…</option>
            {centres.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}{p.code ? ` — ${p.code}` : ''}{p.city ? ` · ${p.city}` : ''}
                {p.createdAt
                  ? ` · ${new Date(p.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}`
                  : ''}
              </option>
            ))}
          </select>
          {!source && <span className="tiny muted">Everything below is read off the project you pick — nothing about the site is retyped.</span>}
        </div>

        {/* Facts the centre already holds, shown rather than asked for. */}
        {source && (
          <div className="rnv-centre">
            <span className="rnv-centre-head"><Building2 size={14} /> {source.name}</span>
            <div className="rnv-facts">
              <span className="rnv-fact"><b>Code</b>{source.code || '—'}</span>
              <span className="rnv-fact"><b>City</b>{source.city || '—'}</span>
              <span className="rnv-fact"><Ruler size={12} /><b>Area</b>{source.areaSqft ? `${Number(source.areaSqft).toLocaleString('en-IN')} sq ft` : '—'}</span>
              <span className="rnv-fact rnv-fact--pm">
                <UserCog size={12} /><b>Project manager</b>
                {source.owner?.name || 'Unassigned'}
              </span>
            </div>
            <span className="tiny muted">
              The site, city and area carry over, and Phases 1–3 close themselves — that property was
              found, assessed and signed when the centre was built. The manager stays the same unless
              it is changed on the project.
            </span>
          </div>
        )}

        {source && (
          <>
            <div className="rnv-section">
              <h4 className="rnv-section-title">
                <Gamepad2 size={14} /> Games running at {source.code || source.name}
                <span className="rnv-count">{running.length}</span>
              </h4>
              {!running.length ? (
                <p className="rnv-empty">
                  This centre has no game list on its plan, so there is nothing here to renovate —
                  bring games in below instead.
                </p>
              ) : (
                <>
                  <p className="rnv-hint">Tick the ones being renovated. The rest stay exactly as they are.</p>
                  <div className="rnv-games">
                    {running.map((g) => (
                      <label key={g} className={`rnv-game${renovating.has(g) ? ' is-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={renovating.has(g)}
                          onChange={() => toggle(setRenovating)(g)}
                        />
                        <span className="rnv-game-name" title={g}>{g}</span>
                        <span className="rnv-game-tag">{renovating.has(g) ? 'renovating' : 'running'}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="rnv-section">
              <h4 className="rnv-section-title">
                <Plus size={14} /> Add new games
                <span className="rnv-count">{addable.length} available</span>
              </h4>
              {!addable.length ? (
                <p className="rnv-empty">Every game in the catalogue already runs at this centre.</p>
              ) : (
                <div className="rnv-games">
                  {addable.map((g) => (
                    <label key={g._id} className={`rnv-game${adding.has(g.name) ? ' is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={adding.has(g.name)}
                        onChange={() => toggle(setAdding)(g.name)}
                      />
                      <span className="rnv-game-name" title={g.name}>{g.name}</span>
                      <span className="rnv-game-tag is-new"><Sparkles size={10} /> {areaLabel(g) || 'new'}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="rnv-row">
              <div className="np-field">
                <label className="np-label"><CalendarDays size={13} /> Planned start <span className="np-req">*</span></label>
                <input className="input" type="date" value={plannedStartDate} onChange={(e) => setPlannedStartDate(e.target.value)} />
              </div>
              <div className="np-field">
                <label className="np-label"><Gauge size={13} /> Priority</label>
                <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <div className="np-field np-field--full">
              <label className="np-label"><FileText size={13} /> Remarks <span className="np-optional">Optional</span></label>
              <textarea
                className="textarea"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="What is being changed and why — read by whoever plans the work"
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default RenovationModal;
