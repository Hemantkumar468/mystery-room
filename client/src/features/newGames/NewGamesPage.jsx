import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, CheckCircle2, FileText, Pencil, Trash2, UserPlus, Eye, ChevronLeft, ChevronRight,
  ShoppingCart, Send, ArrowRight, Building2, ClipboardList, Video, ListChecks, ClipboardCheck, Wrench,
  ShieldCheck, FileSearch,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { useAccess } from '../../hooks/useAccess.js';
import {
  useGetNewGamesQuery, useRemoveNewGameBoqMutation, useSendNewGameToPurchaseMutation,
} from '../../app/api/newGamesApi.js';
import {
  IndentModal, BoqModal, ReviewModal, AssignModal, DoneModal,
  VideoLinks, StatePill, BoqStatus, LineStatus, People, fmtD, fmtDT, money,
} from './newGamesUi.jsx';
import '../../styles/property-capture-blue.css';
import '../../styles/new-games.css';

const WORK_STEPS = new Set(['assemble', 'testing']);
const PER_PAGE = 25;
const HQ = 'Head Office (HQ)';

/** Each step's icon in the step strip. */
const STEP_ICON = {
  indent: ClipboardList, video: Video, boq: ListChecks, check: ClipboardCheck,
  order: ShoppingCart, assemble: Wrench, testing: ShieldCheck,
};

/** Actual: when it was done, and by whom — the name under the date. */
function ActualCell({ at, by, note, rowSpan }) {
  return (
    <td rowSpan={rowSpan} className="ng-nowrap">
      {at ? (
        <>
          {fmtDT(at)}
          {by?.name && <span className="ng-sub ng-by">by <b>{by.name}</b></span>}
          {note && <span className="ng-sub" title={note}>{note}</span>}
        </>
      ) : <span className="ng-muted">—</span>}
    </td>
  );
}

/** The game, once, at the left of its rows — the Property FMS's one-row-per-city idea. */
function GameCell({ g, rowSpan, children }) {
  return (
    <td rowSpan={rowSpan} className="ng-game">
      <b className="ng-game-name" title={g.name}>{g.name}</b>
      <span className="ng-sub">{g.code}</span>
      {children}
    </td>
  );
}

/** Where the game is now: its current step's number and name. */
function CurrentStep({ g, steps, rowSpan }) {
  const at = steps.find((s) => s.key === g.currentStep);
  return (
    <td rowSpan={rowSpan}>
      {g.status === 'complete'
        ? <span className="ngx-current is-done"><CheckCircle2 size={13} /> In the Games master</span>
        : at && <span className="ngx-current"><i>{at.n}</i>{at.label}</span>}
    </td>
  );
}

/** The whole flow, what/when/who/how for every step — "View details". */
function FlowModal({ steps, onClose }) {
  return (
    <Modal open onClose={onClose} title="New Games Creation — the FMS flow" subtitle="Left to right: what, when, who and how for every step" width={900}>
      <div className="ngx-tablewrap">
        <table className="ngx-table ngx-flowtable">
          <thead><tr><th>Step</th><th>What</th><th>When</th><th>Who</th><th>How</th></tr></thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.key}>
                <td className="ng-nowrap"><span className="ngx-current"><i>{s.n}</i>{s.label}</span></td>
                <td>{s.what}</td>
                <td>{s.when}</td>
                <td>{s.who}</td>
                <td>{s.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function NewGamesPage() {
  const [params, setParams] = useSearchParams();
  const stepKey = params.get('step') || 'indent';
  const status = params.get('status') || 'active';
  const location = params.get('location') || 'all';
  const q = params.get('q') || '';
  const page = Math.max(1, Number(params.get('page') || 1));
  const [search, setSearch] = useState(q);
  const [flowOpen, setFlowOpen] = useState(false);
  useEffect(() => { setSearch(q); }, [q]);

  const user = useAppSelector(selectCurrentUser);
  const me = String(user?._id || user?.id || '');
  const access = useAccess();
  const canEdit = access.module('new-games', 'edit');
  const canManage = access.module('new-games', 'manage');

  const { data, isLoading, isFetching, isError, refetch } = useGetNewGamesQuery(
    { status, q, location, page, limit: PER_PAGE },
    /* Step 5 moves in the Purchase FMS, so coming back here re-reads it. */
    { refetchOnMountOrArgChange: true },
  );
  const [removeBoq] = useRemoveNewGameBoqMutation();
  const [sendToPurchase, sendState] = useSendNewGameToPurchaseMutation();

  /* THERE IS MORE TO THE RIGHT — said out loud, as the Property FMS does: a
     fade before the pinned Actions column and a "scroll →" pill while columns
     are hidden, over a scroll bar that stays on screen. */
  const wrapRef = useRef(null);
  const [more, setMore] = useState(false);
  const [pinR, setPinR] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const sync = () => {
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
      setPinR(el.querySelector('thead th.ng-act')?.offsetWidth || 0);
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const table = el.querySelector('table');
    if (table) ro.observe(table);
    return () => { el.removeEventListener('scroll', sync); ro.disconnect(); };
  }, [data, stepKey]);

  const [indent, setIndent] = useState(null); // {} for new, game for edit
  const [boqFor, setBoqFor] = useState(null); // { g, boq? }
  const [review, setReview] = useState(null); // { g, boq }
  const [assign, setAssign] = useState(null); // { g, step, label }
  const [done, setDone] = useState(null); // { g, step }

  const setParamsTo = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const setParam = (k, v) => setParamsTo({ [k]: v });
  const runSearch = () => setParam('q', search.trim());
  const clearAll = () => { setSearch(''); setParamsTo({ q: '', status: '' }); };

  const steps = data?.steps || [];
  const games = data?.games || [];
  const counts = data?.counts || {};
  const locations = data?.locations || [];
  const total = data?.total ?? 0;
  const def = steps.find((s) => s.key === stepKey) || steps[0];
  const stepIndex = steps.findIndex((s) => s.key === def?.key);
  const sno = (i) => (page - 1) * PER_PAGE + i + 1;
  const isDoer = (s) => (s?.doers || []).some((p) => p?.id === me);
  const canActOn = (s) => isDoer(s) || canManage;
  const locationOf = (g) => g.location || HQ;

  const onRemoveBoq = async (g, b) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove “${b.name}” from ${g.name}?`)) return;
    try {
      await removeBoq({ id: g.id, boqId: b.id }).unwrap();
      flashSuccess('BOQ removed');
    } catch { /* toasted centrally */ }
  };
  const onSend = async (g) => {
    try {
      await sendToPurchase(g.id).unwrap();
      flashSuccess(`${g.name} sent to the Purchase FMS — the BOQs are at Vendor finalisation`);
    } catch { /* toasted centrally */ }
  };

  const assignBtn = (g, step, label) => canManage && (
    <button type="button" className="ng-textbtn" onClick={(e) => { e.stopPropagation(); setAssign({ g, step, label }); }}>
      <UserPlus size={12} /> Assign
    </button>
  );
  const viewLink = (g, step) => (
    <Link className="pc2-act" to={`/new-games/tasks/${g.id}/${step}`}><Eye size={13} /> View</Link>
  );
  const purchaseLink = (g, stage) => `/purchase/orders?project=${g.steps.order.purchaseProject}${stage ? `&stage=${stage}` : ''}`;

  /* ── the tables, one per step ─────────────────────────────────────────── */

  const heads = {
    indent: ['#', 'Game Name', 'Location', 'Current Step', 'Video & files', 'Filed on', 'Assigned to watch', 'Watch-by Date', 'Status', 'Actions'],
    video: ['#', 'Game Name', 'Location', 'Current Step', 'Video & files', 'Assigned To', 'Watch-by Date', 'Actual', 'Status', 'Actions'],
    boq: ['#', 'Game Name', 'BOQ', 'Lead time', 'Est. cost', 'BOQ status', 'Assigned To', 'Plan', 'Actual', 'Status', 'Actions'],
    check: ['#', 'Game Name', 'BOQ', 'Lead time', 'Est. cost', 'Status', 'Assigned To', 'Plan', 'Actual', 'Actions'],
    order: ['#', 'Game Name', 'Item', 'Vendor & PO', 'Status', 'Ordered', 'Received', 'Assigned To', 'Plan', 'Actual', 'Actions'],
    work: ['#', 'Game Name', 'Location', 'Assigned To', 'Plan', 'Actual', 'Status', 'Actions'],
  }[WORK_STEPS.has(stepKey) ? 'work' : stepKey] || [];

  const rowsFor = () => {
    if (stepKey === 'indent') {
      return games.map((g, i) => {
        const cur = g.currentStep && g.steps[g.currentStep];
        return (
          <tr key={g.id} className="ng-first">
            <td className="ng-sno">{sno(i)}</td>
            <GameCell g={g} />
            <td>{locationOf(g)}</td>
            <CurrentStep g={g} steps={steps} />
            <td><VideoLinks game={g} /></td>
            <ActualCell at={g.createdAt} by={g.createdBy} />
            <td><People list={g.steps.video.doers} empty="Nobody yet" />{assignBtn(g, 'video', 'Watch the video')}</td>
            <td className="ng-nowrap">{fmtDT(g.steps.video.plan)}</td>
            <td>{g.status === 'complete' ? <span className="pc2-pill p-green">Completed</span> : cur && <StatePill state={cur.state} lateDays={cur.lateDays} />}</td>
            <td className="ng-act">
              <span className="pc2-acts ng-stack">
                {canEdit && (g.createdBy?.id === me || canManage) && g.status === 'active' && (
                  <button type="button" className="pc2-act" onClick={() => setIndent(g)}><Pencil size={13} /> Edit</button>
                )}
                {g.currentStep && viewLink(g, g.currentStep)}
              </span>
            </td>
          </tr>
        );
      });
    }

    /* Step 2: one row per person under the game. Watching and marking it
       happen in each person's My Tasks; Actions here is only View / Assign. */
    if (stepKey === 'video') {
      return games.map((g, i) => {
        const s = g.steps.video;
        const rows = s.rows.length ? s.rows : [null];
        const span = rows.length;
        return rows.map((r, ri) => (
          <tr key={`${g.id}-${r?.person?.id || 'none'}`} className={ri === 0 ? 'ng-first' : ''}>
            {ri === 0 && <td rowSpan={span} className="ng-sno">{sno(i)}</td>}
            {ri === 0 && (
              <GameCell g={g} rowSpan={span}>
                <span className="ng-sub">{s.watchedCount} of {s.watcherCount} watched</span>
              </GameCell>
            )}
            {ri === 0 && <td rowSpan={span}>{locationOf(g)}</td>}
            {ri === 0 && <CurrentStep g={g} steps={steps} rowSpan={span} />}
            {ri === 0 && <td rowSpan={span} className="ng-videocell"><VideoLinks game={g} /></td>}
            {r ? (
              <>
                <td>
                  <People list={[r.person]} />
                  <span className="ng-sub">{r.stillAssigned ? `assigned ${fmtDT(r.assignedAt)}` : 'no longer assigned'}</span>
                </td>
                <td className="ng-nowrap">{fmtDT(r.plan)}</td>
                <ActualCell at={r.doneAt} by={r.person} />
                <td><StatePill state={r.state} done="Completed" lateDays={r.lateDays} /></td>
              </>
            ) : (
              <td colSpan={4} className="ng-muted">Nobody is assigned to watch yet{canManage ? ' — use Assign.' : '.'}</td>
            )}
            {ri === 0 && (
              <td rowSpan={span} className="ng-act">
                <span className="pc2-acts ng-stack">
                  {viewLink(g, 'video')}
                  {assignBtn(g, 'video', 'Watch the video')}
                </span>
              </td>
            )}
          </tr>
        ));
      });
    }

    if (stepKey === 'boq') {
      return games.map((g, i) => {
        const s = g.steps.boq;
        const boqs = g.boqs.length ? g.boqs : [null];
        const span = boqs.length;
        const mine = canActOn(s) && g.status === 'active';
        return boqs.map((b, bi) => (
          <tr key={`${g.id}-${b?.id || 'none'}`} className={bi === 0 ? 'ng-first' : ''}>
            {bi === 0 && <td rowSpan={span} className="ng-sno">{sno(i)}</td>}
            {bi === 0 && <GameCell g={g} rowSpan={span}><span className="ng-sub">{locationOf(g)}</span></GameCell>}
            {b ? (
              <>
                <td>
                  <b className="ng-boq">{b.name}</b>
                  {mine && b.status !== 'approved' && !s.doneAt && (
                    <span className="ng-rowtools">
                      <button type="button" className="ng-icon" title={b.status === 'rejected' ? 'Correct and resubmit' : 'Edit'} onClick={() => setBoqFor({ g, boq: b })}><Pencil size={13} /></button>
                      <button type="button" className="ng-icon is-danger" title="Remove" onClick={() => onRemoveBoq(g, b)}><Trash2 size={13} /></button>
                    </span>
                  )}
                  {b.category && <span className="ng-sub">{b.category}</span>}
                  {b.status === 'rejected' && b.reason && <span className="ng-sub ng-bad" title={b.reason}>Rejected: {b.reason}</span>}
                </td>
                <td className="ng-nowrap">{b.leadTimeDays != null ? `${b.leadTimeDays} days` : '—'}</td>
                <td className="ng-nowrap ng-r">{money(b.estimatedCost)}</td>
                <td><BoqStatus boq={b} /></td>
              </>
            ) : (
              <td colSpan={4} className="ng-muted">No BOQ yet — they appear here as they are made</td>
            )}
            {bi === 0 && (
              <>
                <td rowSpan={span}><People list={s.doers} />{assignBtn(g, 'boq', 'Make the BOQ')}</td>
                <td rowSpan={span} className="ng-nowrap">{fmtD(s.plan)}</td>
                <ActualCell rowSpan={span} at={s.doneAt} by={s.doneBy} />
                <td rowSpan={span}><StatePill state={s.state} lateDays={s.lateDays} /></td>
                <td rowSpan={span} className="ng-act">
                  {s.doneAt ? <span className="ng-ok"><CheckCircle2 size={13} /> Done</span> : mine ? (
                    <span className="pc2-acts ng-stack">
                      <button type="button" className="pc2-act a-view" onClick={() => setBoqFor({ g })}><Plus size={13} /> Add BOQ</button>
                      <button
                        type="button"
                        className="pc2-act a-go"
                        disabled={!g.boqs.length || g.boqs.some((x) => x.status === 'rejected') || s.state === 'waiting'}
                        title={s.state === 'waiting' ? 'Everyone has to watch the video first' : 'Every BOQ for this game is in'}
                        onClick={() => setDone({ g, step: 'boq' })}
                      >
                        <CheckCircle2 size={13} /> Complete
                      </button>
                    </span>
                  ) : viewLink(g, 'boq')}
                </td>
              </>
            )}
          </tr>
        ));
      });
    }

    if (stepKey === 'check') {
      const withBoqs = games.filter((g) => g.boqs.length);
      return withBoqs.map((g, i) => {
        const s = g.steps.check;
        const span = g.boqs.length;
        const checker = canActOn(s);
        return g.boqs.map((b, bi) => (
          <tr key={`${g.id}-${b.id}`} className={bi === 0 ? 'ng-first' : ''}>
            {bi === 0 && <td rowSpan={span} className="ng-sno">{sno(i)}</td>}
            {bi === 0 && (
              <GameCell g={g} rowSpan={span}>
                <span className="ng-sub">{g.boqs.length} BOQ{g.boqs.length === 1 ? '' : 's'} · {g.boqs.filter((x) => x.status === 'approved').length} approved</span>
                <StatePill state={s.state} lateDays={s.lateDays} label={s.state === 'done' ? 'All approved' : undefined} />
              </GameCell>
            )}
            <td>
              <b className="ng-boq">{b.name}</b>
              {b.category && <span className="ng-sub">{b.category}</span>}
              {b.reason && <span className={`ng-sub${b.status === 'rejected' ? ' ng-bad' : ''}`} title={b.reason}>{b.reason}</span>}
            </td>
            <td className="ng-nowrap">{b.leadTimeDays != null ? `${b.leadTimeDays} days` : '—'}</td>
            <td className="ng-nowrap ng-r">{money(b.estimatedCost)}</td>
            <td>
              <BoqStatus boq={b} />
              {b.decidedAt && <span className="ng-sub">{b.decidedBy?.name || '—'} · {fmtDT(b.decidedAt)}</span>}
            </td>
            {bi === 0 && (
              <>
                <td rowSpan={span}><People list={s.doers} />{assignBtn(g, 'check', 'Check the BOQ')}</td>
                <td rowSpan={span} className="ng-nowrap">{fmtD(s.plan)}</td>
                <ActualCell rowSpan={span} at={s.doneAt} by={s.doneBy} />
              </>
            )}
            <td className="ng-act">
              {b.status === 'submitted' && checker
                ? <button type="button" className="pc2-act a-view" onClick={() => setReview({ g, boq: b })}><ClipboardCheck size={13} /> Check / Review</button>
                : <button type="button" className="pc2-act" onClick={() => setReview({ g, boq: b })}><Eye size={13} /> View</button>}
            </td>
          </tr>
        ));
      });
    }

    /* Step 5: the Purchase FMS's own lines for this game, read back. */
    if (stepKey === 'order') {
      return games.map((g, i) => {
        const s = g.steps.order;
        const lines = s.lines.length ? s.lines : [null];
        const span = lines.length;
        const ready = g.steps.check.state === 'done';
        return lines.map((l, li) => (
          <tr key={`${g.id}-${l?.id || 'none'}`} className={li === 0 ? 'ng-first' : ''}>
            {li === 0 && <td rowSpan={span} className="ng-sno">{sno(i)}</td>}
            {li === 0 && (
              <GameCell g={g} rowSpan={span}>
                {s.purchaseProject && <span className="ng-sub">{s.counts.received} of {s.counts.total} received</span>}
                <StatePill state={s.state} lateDays={s.lateDays} label={s.state === 'done' ? 'Every GRN booked' : undefined} />
                {s.purchaseProject && <Link className="ng-textbtn" to={purchaseLink(g)}><ShoppingCart size={12} /> Open in Purchase</Link>}
              </GameCell>
            )}
            {l ? (
              <>
                <td><b className="ng-boq">{l.item}</b>{l.boq && <span className="ng-sub">{l.boq}</span>}</td>
                <td>
                  {l.vendor ? <b className="ng-boq">{l.vendor}</b> : <span className="ng-muted">No vendor yet</span>}
                  {l.po && <span className="ng-sub">PO {l.po}</span>}
                </td>
                <td>
                  <LineStatus line={l} />
                  {l.promised && !l.grnDone && <span className="ng-sub">due {fmtD(l.promised)}</span>}
                  {l.receivedAt && <span className="ng-sub">in {fmtD(l.receivedAt)}</span>}
                </td>
                <td className="ng-nowrap ng-r"><b>{l.qty || '—'}</b> <span className="ng-muted">{l.unit}</span></td>
                <td className="ng-nowrap ng-r">
                  {l.received != null ? <b className={l.received < l.qty ? 'ng-bad' : ''}>{l.received}</b> : <span className="ng-muted">—</span>}
                  {l.grn && <span className="ng-sub">GRN {l.grn}</span>}
                </td>
              </>
            ) : (
              <td colSpan={5} className="ng-muted">
                {ready
                  ? 'Every BOQ is approved but it has not reached Purchase yet.'
                  : 'Opens when every BOQ is approved — they then go to the Purchase FMS at Vendor finalisation.'}
              </td>
            )}
            {li === 0 && (
              <>
                <td rowSpan={span}><People list={s.doers} empty="Purchase team" /></td>
                <td rowSpan={span} className="ng-nowrap">{fmtD(s.plan)}</td>
                <ActualCell rowSpan={span} at={s.doneAt} />
              </>
            )}
            <td className="ng-act">
              {l ? (
                <Link className="pc2-act a-view" to={purchaseLink(g, l.stage)}>
                  <ShoppingCart size={13} /> {l.grnDone ? 'View' : 'Open in Purchase'}
                </Link>
              ) : ready && canManage && !s.purchaseProject ? (
                <button type="button" className="pc2-act a-go" disabled={sendState.isLoading} onClick={() => onSend(g)}>
                  <Send size={13} /> Send to Purchase
                </button>
              ) : <span className="ng-muted">—</span>}
            </td>
          </tr>
        ));
      });
    }

    /* Steps 6–7: one row per game. */
    return games.map((g, i) => {
      const s = g.steps[stepKey];
      const before = steps.find((x) => x.n === def.n - 1);
      return (
        <tr key={g.id} className="ng-first">
          <td className="ng-sno">{sno(i)}</td>
          <GameCell g={g} />
          <td>{locationOf(g)}</td>
          <td><People list={s.doers} />{assignBtn(g, stepKey, def.label)}</td>
          <td className="ng-nowrap">{fmtD(s.plan)}</td>
          <ActualCell at={s.doneAt} by={s.doneBy} note={s.note} />
          <td><StatePill state={s.state} lateDays={s.lateDays} /></td>
          <td className="ng-act">
            {s.state === 'done'
              ? <span className="ng-ok"><CheckCircle2 size={13} /> {stepKey === 'testing' ? 'In the master' : 'Done'}</span>
              : s.state === 'waiting'
                ? <span className="ng-muted" title={`Waits for ${before?.label}`}>Waits for Step {before?.n}</span>
                : canActOn(s) && g.status === 'active'
                  ? <button type="button" className="pc2-act a-go" onClick={() => setDone({ g, step: stepKey })}><CheckCircle2 size={13} /> Complete</button>
                  : viewLink(g, stepKey)}
          </td>
        </tr>
      );
    });
  };

  const body = rowsFor();
  const empty = stepKey === 'check' ? !games.some((g) => g.boqs.length) : games.length === 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total ? (page - 1) * PER_PAGE + 1 : 0;
  const to = Math.min(page * PER_PAGE, total);
  const StepIcon = STEP_ICON[def?.key] || ClipboardList;
  const pageList = pages <= 7
    ? Array.from({ length: pages }, (_, i) => i + 1)
    : [...new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))];

  return (
    <>
      <Topbar
        title="New Games Creation FMS"
        subtitle="Create and manage new games from concept to completion."
        showSubtitle
        actions={(
          <div className="row gap-2">
            {/* Where the games are for: every location, the Head Office's own
                (no franchise on the indent), or one franchise. */}
            <label className="ngx-loc" title="Show the games for one location">
              <Building2 size={15} aria-hidden />
              <select value={location} onChange={(e) => setParam('location', e.target.value === 'all' ? '' : e.target.value)} aria-label="Location">
                <option value="all">All locations</option>
                <option value="hq">{HQ}</option>
                {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            {canEdit && (
              <button type="button" className="btn btn-sm ngx-new" onClick={() => setIndent({})}>
                <Plus size={15} /> New game
              </button>
            )}
          </div>
        )}
      />
      <div className="content ngx ng">
        {/* ── the figures ─────────────────────────────────────────────── */}
        <div className="ngx-card ngx-kpis">
          {[
            { n: counts.active, label: 'In Creation', tone: 'blue', go: () => setParamsTo({ status: '', step: '' }) },
            { n: counts.late, label: 'Late', tone: 'red', go: () => setParamsTo({ status: '' }) },
            { n: counts.boqsToCheck, label: 'BOQs to Check', tone: 'amber', go: () => setParamsTo({ step: 'check', status: '' }) },
            { n: counts.complete, label: 'Completed', tone: 'green', go: () => setParamsTo({ status: 'complete' }) },
            { n: counts.atStep?.indent, label: 'Indents Filed', tone: 'purple', go: () => setParamsTo({ status: 'all', step: '' }) },
          ].map((k) => (
            <button key={k.label} type="button" className={`ngx-kpi t-${k.tone}`} onClick={k.go}>
              <i aria-hidden />
              <span>
                <b>{typeof k.n === 'number' ? k.n : '—'}</b>
                <span>{k.label}</span>
              </span>
            </button>
          ))}
        </div>

        {/* ── the flow ────────────────────────────────────────────────── */}
        <div className="ngx-card ngx-flow">
          <div className="ngx-flow-head">
            <FileText size={16} aria-hidden />
            <b>FMS Flow</b>
            <span>Follow the steps to create a new game</span>
            <button type="button" className="ngx-link" onClick={() => setFlowOpen(true)}>View details <ArrowRight size={14} /></button>
          </div>
          <div className="ngx-stepper">
            {steps.map((s, i) => {
              const n = counts.atStep?.[s.key];
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`ngx-step${s.key === stepKey ? ' is-on' : ''}${i <= stepIndex ? ' is-reached' : ''}`}
                  onClick={() => setParam('step', s.key === 'indent' ? '' : s.key)}
                  title={`${s.label}${n ? ` — ${n} game${n === 1 ? '' : 's'} here` : ''}`}
                >
                  <span className="ngx-dot">
                    {s.n}
                    {n > 0 && s.key !== 'indent' && <em className="ngx-badge">{n}</em>}
                  </span>
                  <span className="ngx-step-l">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── the step: what, when, who, how ──────────────────────────── */}
        {def && (
          <div className="ngx-card ngx-brief">
            <div className="ngx-brief-step">
              <span className="ngx-brief-ico"><StepIcon size={18} aria-hidden /></span>
              <span><small>Step {def.n}</small><b>{def.label}</b></span>
            </div>
            <div><span>What</span>{def.what}</div>
            <div><span>When</span>{def.when}</div>
            <div><span>Who</span>{def.who}</div>
            <div><span>How</span>{def.how}</div>
          </div>
        )}

        {/* ── search ──────────────────────────────────────────────────── */}
        <form className="ngx-toolbar" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
          <label className="ngx-search">
            <Search size={16} aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search game, code, location…" aria-label="Search games" />
          </label>
          <div className="ngx-toolbar-right">
            <label className="ngx-field">
              <span>Status</span>
              <select value={status} onChange={(e) => setParam('status', e.target.value === 'active' ? '' : e.target.value)}>
                <option value="active">In creation</option>
                <option value="complete">Completed</option>
                <option value="all">All games</option>
              </select>
            </label>
            <button type="submit" className="ngx-btn is-primary">Search</button>
            <button type="button" className="ngx-btn is-soft" onClick={clearAll}>Clear</button>
          </div>
        </form>

        {/* ── the table ───────────────────────────────────────────────── */}
        <div className={`ngx-card ngx-tablecard${isFetching ? ' is-busy' : ''}`}>
          <div className={`ngx-tableframe${more ? ' is-more' : ''}`} style={{ '--pin-r': `${pinR}px` }}>
          {more && <span className="ngx-more-hint" aria-hidden="true">scroll →</span>}
          <div className="ngx-tablewrap" ref={wrapRef}>
            <table className="ngx-table">
              <thead><tr>{heads.map((h) => <th key={h} className={h === '#' ? 'ng-sno' : h === 'Actions' ? 'ng-act' : ['Ordered', 'Received', 'Est. cost'].includes(h) ? 'ng-r' : undefined}>{h}</th>)}</tr></thead>
              <tbody>
                {isError ? (
                  <tr><td colSpan={heads.length}><div className="ngx-empty"><b>Could not load the games</b><button type="button" className="ngx-btn is-soft" onClick={refetch}>Try again</button></div></td></tr>
                ) : isLoading ? (
                  <tr><td colSpan={heads.length}><div className="ngx-empty"><span className="spinner" /> Loading…</div></td></tr>
                ) : empty ? (
                  <tr>
                    <td colSpan={heads.length}>
                      <div className="ngx-empty">
                        <span className="ngx-empty-ico"><FileSearch size={30} aria-hidden /></span>
                        <b>{q ? 'No games match the search' : stepKey === 'check' && games.length ? 'No BOQ has been made yet' : 'No games found'}</b>
                        <p>
                          {q
                            ? 'Try another name or code, or clear the search.'
                            : <>Click <b>“New game”</b> to fill the indent form — that starts the FMS.</>}
                        </p>
                        {q
                          ? <button type="button" className="ngx-btn is-soft" onClick={clearAll}>Clear search</button>
                          : canEdit && <button type="button" className="ngx-btn is-primary" onClick={() => setIndent({})}><Plus size={15} /> New game</button>}
                      </div>
                    </td>
                  </tr>
                ) : body}
              </tbody>
            </table>
          </div>
          </div>
          <div className="ngx-foot">
            <span>{total ? `Showing ${from}–${to} of ${total} game${total === 1 ? '' : 's'}` : 'Showing 0 of 0 games'}</span>
            <span className="ngx-pages">
              <button type="button" className="ngx-page" disabled={page <= 1} onClick={() => setParamsTo({ page: String(page - 1) })} aria-label="Previous page"><ChevronLeft size={14} /></button>
              {pageList.map((n, i) => (
                <Fragment key={n}>
                  {i > 0 && n - pageList[i - 1] > 1 && <span className="ngx-gap">…</span>}
                  <button type="button" className={`ngx-page${n === page ? ' is-on' : ''}`} onClick={() => setParamsTo({ page: n === 1 ? '' : String(n) })}>{n}</button>
                </Fragment>
              ))}
              <button type="button" className="ngx-page" disabled={page >= pages} onClick={() => setParamsTo({ page: String(page + 1) })} aria-label="Next page"><ChevronRight size={14} /></button>
            </span>
          </div>
        </div>
      </div>

      {flowOpen && <FlowModal steps={steps} onClose={() => setFlowOpen(false)} />}
      {indent && <IndentModal game={indent.id ? indent : null} onClose={() => setIndent(null)} />}
      {boqFor && <BoqModal game={boqFor.g} boq={boqFor.boq} onClose={() => setBoqFor(null)} />}
      {review && <ReviewModal game={review.g} boq={review.boq} canDecide={canActOn(review.g.steps.check)} onClose={() => setReview(null)} />}
      {assign && <AssignModal game={assign.g} step={assign.step} stepLabel={assign.label} onClose={() => setAssign(null)} />}
      {done && <DoneModal game={done.g} step={done.step} def={steps.find((s) => s.key === done.step)} onClose={() => setDone(null)} />}
    </>
  );
}

export default NewGamesPage;
