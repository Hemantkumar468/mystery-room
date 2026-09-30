import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CalendarDays, UserPlus, Users, Gamepad2, CheckCircle2, Flame, ClipboardCheck, Eye, Workflow,
  PlayCircle, ShoppingCart, ListChecks, Wrench, ShieldCheck, Plus,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { PRIORITY_META } from '../../lib/ui.js';
import dayjs from '../../lib/dayjs.js';
import { timeLeft } from '../tasks/MyTasksPage.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { useAccess } from '../../hooks/useAccess.js';
import { useGetNewGameQuery, useWatchNewGameMutation } from '../../app/api/newGamesApi.js';
import {
  BoqStatus, LineStatus, BoqModal, ReviewModal, DoneModal, WatchModal, StatePill, VideoCards, fmtD, fmtDT, money,
} from './newGamesUi.jsx';
import '../../styles/property-capture-blue.css';
import '../../styles/new-games.css';

const ORDER = ['indent', 'video', 'boq', 'check', 'order', 'assemble', 'testing'];

function Fact({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="tf-fact">
      <span className="tf-fact-ic" aria-hidden><Icon size={14} /></span>
      <span className="tf-fact-body">
        <span className="tf-fact-label">{label}</span>
        <span className="tf-fact-value">{value || '—'}</span>
        {sub && <span className="tf-fact-sub" style={tone ? { color: tone } : undefined}>{sub}</span>}
      </span>
    </div>
  );
}

/**
 * ONE STEP OF ONE NEW GAME, as a task — what My Tasks opens.
 *
 * The same card as a project task (tf-card): where it stands, when it is due,
 * who gave it and who has it, then the one thing to do and Complete Task
 * beside it. The work itself happens where it belongs:
 *
 *   Watch the video — the video and every file as cards, played right here.
 *   Make the BOQ    — "Create BOQ" opens the FMS on this game with the form
 *                     open; add as many as the game needs, then Complete.
 *   Check the BOQ   — "Check BOQs" opens the FMS on this game's BOQs to
 *                     approve or reject one by one, then Complete.
 *   Assemble / Testing — Complete Task, with an optional note.
 */
export function NewGameTaskPage() {
  const { id, step } = useParams();
  const { data: g, isLoading, isError } = useGetNewGameQuery(id, { refetchOnMountOrArgChange: true });
  const [watch, watchState] = useWatchNewGameMutation();
  const user = useAppSelector(selectCurrentUser);
  const me = String(user?._id || user?.id || '');
  const access = useAccess();
  const canManage = access.module('new-games', 'manage');

  const [boqFor, setBoqFor] = useState(null);
  const [review, setReview] = useState(null);
  const [done, setDone] = useState(false);
  const [watching, setWatching] = useState(false);

  if (isLoading) return (<><Topbar title="Task" back="/my-tasks" /><div className="content"><div className="ng-empty"><span className="spinner" /> Loading…</div></div></>);
  if (isError || !g || !g.steps?.[step]) {
    return (<><Topbar title="Task" back="/my-tasks" /><div className="content"><div className="ng-empty">This task could not be found. <Link to="/my-tasks">Back to My Tasks</Link></div></div></>);
  }

  /**
   * DENIED IS NOT MISSING, and it does not read as a bug.
   *
   * The step is in the URL, so this page is reachable from a bookmark or a
   * stale My Tasks row even when the seat has been taken off that step since.
   * Saying "could not be found" about a task that plainly exists sends people
   * to support; naming the reason sends them to whoever owns the policy,
   * which is the same thing the server's own refusal does.
   */
  if (!access.step(`ng-${step}`)) {
    return (
      <>
        <Topbar title="Task" back="/my-tasks" />
        <div className="content">
          <div className="ng-empty">
            Your access does not include “{g.flow?.find((x) => x.key === step)?.label || `Step ${ORDER.indexOf(step) + 1}`}”
            of the New Games FMS. Ask whoever manages Access Control in Settings.
            {' '}<Link to="/my-tasks">Back to My Tasks</Link>
          </div>
        </div>
      </>
    );
  }

  const s = g.steps[step];
  const def = g.flow?.find((x) => x.key === step) || { key: step, label: step, what: step, how: '' };
  const n = def.n || ORDER.indexOf(step) + 1;
  const myRow = step === 'video' ? s.rows.find((r) => r.person?.id === me) : null;
  const doneForMe = step === 'video' ? Boolean(myRow?.doneAt) : s.state === 'done';
  const doneAt = step === 'video' ? myRow?.doneAt : s.doneAt;
  const plan = step === 'video' ? (myRow?.plan || s.plan) : s.plan;
  const isDoer = step === 'video' ? Boolean(myRow?.stillAssigned) : s.doers.some((p) => p?.id === me);
  /* Three things, all required: it is your task, the game is still running,
     and your seat holds this job. The last one is the policy half — the
     server gates the same surface, so a button that skipped it would open
     onto a 403. */
  const canWork = (isDoer || canManage) && g.status === 'active' && access.step(`ng-${step}`, 'edit');
  const waiting = s.state === 'waiting';

  const left = timeLeft(plan, dayjs());
  const late = !doneForMe && plan && dayjs().isAfter(dayjs(plan));
  const badge = doneForMe
    ? { label: 'Completed', color: 'var(--success)' }
    : waiting ? { label: 'Waiting', color: 'var(--text-subtle)' }
      : late ? { label: 'Late', color: 'var(--danger)' } : { label: 'Pending', color: 'var(--info)' };
  const pr = PRIORITY_META?.[g.priority] || {};
  const dueTone = late ? 'var(--danger)' : left?.tone === 'near' ? 'var(--warning)' : 'var(--text-subtle)';

  const doers = step === 'video' ? s.rows.filter((r) => r.stillAssigned).map((r) => r.person) : s.doers;
  const doerNames = doers.filter(Boolean).map((p) => p.name).join(', ');
  const purchaseLink = (stage) => `/purchase/orders?project=${g.steps.order.purchaseProject}${stage ? `&stage=${stage}` : ''}`;
  /* The FMS, opened on this game and this step, with the task on top. */
  const fmsLink = (extra = '') => `/new-games?step=${step}&game=${g.id}&task=${step}${extra}`;

  const approved = g.boqs.filter((b) => b.status === 'approved').length;
  const blockCompletion = step === 'boq'
    ? (!g.boqs.length ? 'Add at least one BOQ first'
      : g.boqs.some((b) => b.status === 'rejected') ? 'A BOQ was rejected — correct and resubmit it first' : '')
    : step === 'check'
      ? (!g.boqs.length ? 'There is no BOQ to check yet'
        : approved < g.boqs.length ? `Approve every BOQ first — ${approved} of ${g.boqs.length} approved` : '')
      : '';

  const onWatched = async () => {
    try {
      await watch(g.id).unwrap();
      flashSuccess('Task completed — you have watched the video');
    } catch { /* toasted centrally */ }
  };

  const completeBtn = (
    <button
      type="button"
      className="tf-btn tf-btn-complete"
      disabled={Boolean(blockCompletion)}
      title={blockCompletion || 'Close this task'}
      onClick={() => setDone(true)}
    >
      <CheckCircle2 size={16} aria-hidden /> Complete Task
    </button>
  );

  return (
    <>
      <Topbar title="Task" back="/my-tasks" />
      <div className="content pc2 ng-task">
        <section className="tf-card">
          <div className="tf-card-header">
            <div className="tf-card-header-left">
              <div className="tf-badges">
                <Badge color={badge.color} soft dot>{badge.label}</Badge>
                {pr.label && (
                  <Badge color={pr.color} soft={pr.soft}>
                    <Flame size={11} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden />
                    {pr.label} priority
                  </Badge>
                )}
              </div>
              <h1 className="tf-title">{def.what} — {g.name}</h1>
              <p className="tf-sub">{g.code}-S{n} · New Games FMS · Step {n} · {def.label}</p>
            </div>
          </div>

          <div className="tf-facts">
            <Fact icon={CalendarDays} label={step === 'video' ? 'Watch by' : 'Due date'} value={plan ? (step === 'video' ? fmtDT(plan) : fmtD(plan)) : 'No deadline'} sub={doneForMe ? null : left?.text} tone={dueTone} />
            <Fact icon={UserPlus} label="Assigned by" value={g.createdBy?.name || 'The flow'} sub={g.createdAt ? `on ${fmtD(g.createdAt)}` : null} />
            <Fact
              icon={Users}
              label="Assigned to"
              value={doerNames || 'Nobody yet'}
              sub={step === 'video' ? `${s.watchedCount} of ${s.watcherCount} watched` : doers.length > 1 ? `${doers.length} people` : doers[0]?.title}
            />
            <Fact icon={Gamepad2} label="Game" value={g.name} sub={[g.code, g.location].filter(Boolean).join(' · ')} />
          </div>

          {def.how && <p className="ng-howto"><b>How:</b> {def.how}.</p>}
          {g.concept && <p className="ng-concept"><b>The game:</b> {g.concept}</p>}

          {/* ── the work ─────────────────────────────────────────────── */}
          {step === 'video' && (
            <>
              <h3 className="ng-section-h"><PlayCircle size={15} aria-hidden /> Reference video &amp; files</h3>
              <VideoCards game={g} onWatch={() => setWatching(true)} />
              <div className="ng-watchers ng-watchers--card">
                <h4><Users size={13} aria-hidden /> Assigned to watch — {s.watchedCount} of {s.watcherCount} done</h4>
                <ul>
                  {s.rows.filter((r) => r.stillAssigned).map((r) => (
                    <li key={r.person?.id}>
                      <span><b>{r.person?.name}</b>{r.person?.title && <em> · {r.person.title}</em>}</span>
                      <span>{r.doneAt ? <span className="ng-ok"><CheckCircle2 size={12} /> {fmtDT(r.doneAt)}</span> : <StatePill state={r.state} lateDays={r.lateDays} />}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {(step === 'boq' || step === 'check') && (
            <div className="ng-boqlist">
              <h3 className="ng-section-h">
                <ListChecks size={15} aria-hidden /> BOQs for this game
                <span className="ng-muted"> · {g.boqs.length} made{g.boqs.length ? `, ${approved} approved` : ''}</span>
              </h3>
              {g.boqs.length === 0 ? <p className="ng-muted">No BOQ yet{step === 'boq' ? ' — Create BOQ opens the form.' : '.'}</p> : (
                <table className="prop-table ng-table ng-mini">
                  <thead><tr><th>BOQ</th><th>Lead time</th><th className="ng-r">Est. cost</th><th>Status</th><th className="ng-act">Action</th></tr></thead>
                  <tbody>
                    {g.boqs.map((b) => (
                      <tr key={b.id}>
                        <td><b>{b.name}</b>{b.category && <span className="ng-sub">{b.category}</span>}{b.status === 'rejected' && b.reason && <span className="ng-sub ng-bad">Rejected: {b.reason}</span>}</td>
                        <td>{b.leadTimeDays != null ? `${b.leadTimeDays} days` : '—'}</td>
                        <td className="ng-r">{money(b.estimatedCost)}</td>
                        <td><BoqStatus boq={b} /></td>
                        <td className="ng-act">
                          {step === 'boq' && canWork && b.status !== 'approved' && !s.doneAt
                            ? <button type="button" className="pc2-act" onClick={() => setBoqFor({ boq: b })}>Edit</button>
                            : step === 'check' && b.status === 'submitted' && canWork
                              ? <button type="button" className="pc2-act a-view" onClick={() => setReview(b)}><ClipboardCheck size={13} /> Check / Review</button>
                              : <button type="button" className="pc2-act" onClick={() => setReview(b)}><Eye size={13} /> View</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {step === 'order' && (
            <div className="ng-boqlist">
              {!g.steps.order.lines.length ? <p className="ng-muted">Nothing has reached the Purchase FMS yet — it opens when Step 4 is completed.</p> : (
                <table className="prop-table ng-table ng-mini">
                  <thead><tr><th>Item</th><th>Vendor &amp; PO</th><th>Status</th><th className="ng-r">Ordered</th><th className="ng-r">Received</th></tr></thead>
                  <tbody>
                    {g.steps.order.lines.map((l) => (
                      <tr key={l.id}>
                        <td><b>{l.item}</b>{l.boq && <span className="ng-sub">{l.boq}</span>}</td>
                        <td>{l.vendor || <span className="ng-muted">No vendor yet</span>}{l.po && <span className="ng-sub">PO {l.po}</span>}</td>
                        <td><LineStatus line={l} /></td>
                        <td className="ng-r">{l.qty} {l.unit}</td>
                        <td className="ng-r">{l.received ?? '—'}{l.grn && <span className="ng-sub">GRN {l.grn}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── the buttons: the work, then Complete Task ─────────────── */}
          <div className="tf-cta">
            {doneForMe ? (
              <span className="tf-done-note">
                <CheckCircle2 size={15} aria-hidden />
                {step === 'video' ? 'You watched it' : 'This task is complete'}
                {doneAt ? ` · ${fmtDT(doneAt)}` : ''}{s.doneBy?.name && step !== 'video' ? ` by ${s.doneBy.name}` : ''}
              </span>
            ) : waiting ? (
              <span className="tf-done-note ng-waiting">This opens once the step before it is finished.</span>
            ) : step === 'video' ? (
              isDoer && (
                <>
                  <button type="button" className="tf-btn" onClick={() => setWatching(true)}>
                    <PlayCircle size={16} aria-hidden /> Watch Video
                  </button>
                  <button type="button" className="tf-btn tf-btn-complete" disabled={watchState.isLoading || !access.step('ng-video', 'edit')} onClick={onWatched}>
                    <CheckCircle2 size={16} aria-hidden /> {watchState.isLoading ? 'Saving…' : 'Complete Task'}
                  </button>
                </>
              )
            ) : step === 'boq' ? (
              canWork && (
                <>
                  <Link className="tf-btn" to={fmsLink('&add=1')}>
                    <Plus size={16} aria-hidden /> Create BOQ
                  </Link>
                  {completeBtn}
                </>
              )
            ) : step === 'check' ? (
              canWork && (
                <>
                  <Link className="tf-btn" to={fmsLink()}>
                    <ClipboardCheck size={16} aria-hidden /> Check BOQs
                  </Link>
                  {completeBtn}
                </>
              )
            ) : step === 'order' ? (
              g.steps.order.purchaseProject && (
                <Link className="tf-btn" to={purchaseLink('vendor')}><ShoppingCart size={16} aria-hidden /> Open in Purchase</Link>
              )
            ) : canWork && (
              <>
                <Link className="tf-btn" to={fmsLink()}>
                  {step === 'assemble' ? <Wrench size={16} aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
                  {step === 'assemble' ? ' Open Assemble' : ' Open Testing'}
                </Link>
                {completeBtn}
              </>
            )}
            {step === 'video' && doneForMe && (
              <button type="button" className="tf-btn ng-btn-ghost" onClick={() => setWatching(true)}>
                <PlayCircle size={15} aria-hidden /> Watch again
              </button>
            )}
            {!['boq', 'check', 'assemble', 'testing'].includes(step) || doneForMe || waiting ? (
              <Link className="tf-btn ng-btn-ghost" to={fmsLink()}>
                <Workflow size={15} aria-hidden /> Open in the FMS
              </Link>
            ) : null}
          </div>
          {!doneForMe && blockCompletion && ['boq', 'check'].includes(step) && canWork && (
            <p className="ng-hint ng-cta-hint">{blockCompletion}.</p>
          )}
        </section>
      </div>

      {watching && <WatchModal game={g} canMark={isDoer && !doneForMe && g.status === 'active' && access.step('ng-video', 'edit')} onClose={() => setWatching(false)} />}
      {boqFor && <BoqModal game={g} boq={boqFor.boq} onClose={() => setBoqFor(null)} />}
      {/* The assigned checker (or a manager) on a seat that may work Step 4 —
          the same two gates the server applies to a decision. */}
      {review && (
        <ReviewModal
          game={g}
          boq={review}
          canDecide={step === 'check' && (isDoer || canManage) && g.status === 'active' && access.step('ng-check', 'edit')}
          onClose={() => setReview(null)}
        />
      )}
      {done && <DoneModal game={g} step={step} def={def} onClose={() => setDone(false)} />}
    </>
  );
}

export default NewGameTaskPage;
