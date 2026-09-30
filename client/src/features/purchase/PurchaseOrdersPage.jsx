/**
 * Every purchase order in the company, in one sheet — BOQ → PO → Tracking →
 * Delivery.
 *
 * The project tracker (ProcurementTrackerPage) is this same sheet for ONE
 * project; here the rows come from every project, with a centre column, and
 * the filters — stage, centre, vendor, category — live in the URL so
 * the overview can deep-link ("everything late", "this vendor's orders") and a
 * filtered view survives a refresh or a shared link.
 *
 * Two things are deliberate:
 *
 *   The pipeline strip along the top IS the filter. Clicking a stage narrows
 *   the sheet to it, so the counts and the rows can never describe different
 *   sets of orders.
 *
 *   The clock in the last column runs. It counts against the date the VENDOR
 *   gave, not against any internal target, because that is the date somebody
 *   can be held to. Red means the vendor is past its own word.
 *
 * Read-only by design: clicking a row opens the order beside the sheet, and
 * acting on it happens on its project's page, where the Update form, the GRN
 * and the send controls already are.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Download, Search, AlertTriangle, ClipboardList, ArrowRight, FilePlus2, Plus,
  ArrowLeft, MapPin, MoreHorizontal, SlidersHorizontal, ChevronLeft, X,
  ChevronRight, Eye, Package, Upload, Users, Truck,
  Zap, Sofa, Grid3x3, Pencil, Trash2, ShoppingCart, Check, Undo2,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import {
  useUpdateRecordTrackingMutation, useCreateRecordMutation, useGlobalStageRecords,
  useUpdateRecordMutation, useDeleteRecordMutation, useRecordDecisionMutation,
} from '../../app/api/recordsApi.js';
import { useGetOrderabilityQuery } from '../../app/api/flowApi.js';
import { useTasks as useFmsTasks } from '../../app/api/tasksApi.js';
import { useProject, useProjects } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import { RaisePurchaseModal } from './RaisePurchaseModal.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { ClampText } from '../../components/ui/ClampText.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { BOQ_STAGE, CLOSED, NOT_SENT, TONE, inr, sentAtOf } from '../projects/orderTracking.jsx';
import { usePurchaseOrders, inrShort } from './usePurchaseOrders.js';
import { purchaseParentPath } from './config/purchase.routes.config.js';
import { purchaseOrderPath } from '../projects/orderRoutes.js';
import {
  PIPELINE, actionPathOf, categoriesOf, categoryOf, clockOf, pipelineOf, promiseOf, stageOf, valueOf,
  boqOf, boqsOf, BOQ_NONE, FMS_STEPS, fmsTimeline,
} from './purchasePipeline.js';
import { PurchaseOrderDrawer } from './PurchaseOrderDrawer.jsx';
import { ReceivePanel } from './ReceivePanel.jsx';
import { GrnModal } from '../projects/OrderDetailPage.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';

/**
 * Create a purchase order, over the whole view.
 *
 * Three questions in the order somebody answers them — which centre, which
 * vendor, which of their lines — and then the number. Nothing is offered that
 * cannot be ordered: the list holds only lines with no PO on them yet, for the
 * centre and vendor chosen, so there is no way to reach a state the write
 * would refuse.
 *
 * It does not create BOQ lines. A line is a priced, approved commitment from
 * Phase 5; inventing one inside a purchase screen would put an unapproved
 * item on a vendor's order.
 */
/**
 * Tick BOQ lines, get purchase orders — one per project-and-vendor.
 *
 * The dialog is not a confirmation step for its own sake: it is where the PO
 * number is decided, and that is the one thing the system cannot decide for
 * anybody. Nothing keeps a PO series here, so a number invented silently would
 * collide the first time two people raised an order in the same hour. The
 * suggestion below is built from the numbers the project already carries; it
 * is editable, and a clash with an existing one is called out before the
 * button will write anything.
 */
function RaisePoDialog({ groups, existing, busy, onCancel, onCreate }) {
  const [numbers, setNumbers] = useState(() =>
    Object.fromEntries(groups.map((g) => [g.key, g.suggestion])));
  const set = (key) => (e) => setNumbers((n) => ({ ...n, [key]: e.target.value }));

  const clash = (g) => {
    const value = String(numbers[g.key] || '').trim();
    if (!value) return 'A purchase order needs a number.';
    /* Only within the same project: two centres may legitimately reuse a
       number, and the same number twice in one project is one order, not two. */
    if ((existing[g.projectId] || new Set()).has(value.toLowerCase())) {
      return 'This project already has an order with that number.';
    }
    const twice = groups.filter((o) => String(numbers[o.key] || '').trim().toLowerCase() === value.toLowerCase()
      && o.projectId === g.projectId);
    return twice.length > 1 ? 'Two of these orders would share a number.' : null;
  };
  const problems = groups.map(clash).filter(Boolean).length;

  return (
    <Modal
      open
      onClose={onCancel}
      title={`Raise ${groups.length} purchase order${groups.length === 1 ? '' : 's'}`}
      width={620}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || problems > 0}
            onClick={() => onCreate(groups.map((g) => ({ ...g, poNumber: String(numbers[g.key]).trim() })))}
          >
            {busy ? 'Writing…' : `Create ${groups.length} PO${groups.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        <p className="tiny muted" style={{ margin: 0 }}>
          Each order below gets its number written onto its BOQ lines, with your name and the
          time. Nothing is sent to anyone yet — send it from the order&rsquo;s own page.
        </p>
        {groups.map((g) => {
          const problem = clash(g);
          return (
            <div key={g.key} className="pu-raise-group">
              <div className="pu-raise-head">
                <div className="col" style={{ minWidth: 0 }}>
                  <b>{g.vendor}</b>
                  <span className="tiny muted">
                    {g.projectName} · {g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {inr(g.value)}
                  </span>
                </div>
                <label className="pt-field" style={{ minWidth: 210 }}>
                  <span>PO number</span>
                  <input value={numbers[g.key]} onChange={set(g.key)} />
                </label>
              </div>
              <ul className="pu-raise-lines">
                {g.lines.map(({ r, f }) => (
                  <li key={r._id}>
                    <span>{r.title || r.values?.item}</span>
                    <span className="tiny muted">
                      {r.values?.quantity} {r.values?.unit || ''} · {inr(f.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              {problem && <p className="pu-raise-problem"><AlertTriangle size={12} /> {problem}</p>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * The verb of each step, drawn.
 *
 * Keyed by the action's own words rather than by position, so re-ordering the
 * flow cannot silently give a row somebody else's mark. The steps themselves
 * carry no icon any more: they are numbered circles, and a number and a
 * picture competing inside one circle only made it harder to read.
 */
const ACTION_ICON = {
  'Set vendor': Users,
  'Raise PO': Upload,
  'Chase vendor': Truck,
  'Book GRN': Package,
  'View record': Eye,
};
/** A category's mark, by what it is. Anything else gets no mark rather than a
    wrong one. */
const CHIP_ICON = { electrical: Zap, furniture: Sofa, flooring: Grid3x3 };

/** The status word a row shows — four states, because that is what a reader acts on. */
function statusChip(f) {
  if (f.status === 'Received (GRN)') return <span className="pu-st is-done">Done</span>;
  if (f.status === 'Cancelled') return <span className="pu-st is-wait">Cancelled</span>;
  if (f.daysLate > 0) return <span className="pu-st is-over"><AlertTriangle size={11} /> Overdue</span>;
  if (f.status === NOT_SENT) return <span className="pu-st is-wait">Pending</span>;
  return <span className="pu-st is-prog">In progress</span>;
}

export function PurchaseOrdersPage() {
  const { rows, isLoading } = usePurchaseOrders();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(null);
  /* Ticked BOQ lines, by record id. Cleared whenever the view changes, so a
     selection can never survive into a filter that no longer shows it. */
  const [picked, setPicked] = useState(() => new Set());
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raising, setRaising] = useState(false);
  const [raiseError, setRaiseError] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  /* Which row's ... menu is open, by record id. */
  const [menuFor, setMenuFor] = useState(null);
  const menuRef = useRef(null);
  const [writeTracking] = useUpdateRecordTrackingMutation();
  /* Step 2. Ruling on a line is the same record decision the MD has always
     been able to take; what is new is that it has a place and an owner. */
  const [decideRecord] = useRecordDecisionMutation();
  const [checking, setChecking] = useState(null);      // line id mid-flight
  const [sendingBack, setSendingBack] = useState(null); // line awaiting a reason
  const [backReason, setBackReason] = useState('');
  const [createRecord] = useCreateRecordMutation();

  /* The row being received, and what the panel is doing. */
  const [receiving, setReceiving] = useState(null);

  /* ── Step 2: choosing the vendor ─────────────────────────────────────────
     The vendor is no longer asked on the BOQ form — listing what to buy and
     choosing who to buy it from are different steps done by different people
     at different times (the whole point of circle 2). The choice happens HERE,
     against the line, through the same tracking endpoint every other
     post-approval fact uses, so it lands in the changeLog with who and when. */
  /* Step 4 and step 5 popups: the status of an order on its way, and the GRN
     once it has arrived. One save path for both, so a refusal is always said. */
  const currentUser = useAppSelector(selectCurrentUser); // pre-fills "Received by" on the GRN
  const [statusFor, setStatusFor] = useState(null);
  const [grnFor, setGrnFor] = useState(null);
  const [trackBusy, setTrackBusy] = useState(false);
  const saveTracking = async (row, values, note, done) => {
    setTrackBusy(true);
    try {
      await writeTracking({ id: row.r._id, projectId: row.project.id, stageKey: BOQ_STAGE, values, note }).unwrap();
      done?.();
      return true;
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(err?.data?.message || 'Could not save this. Try again.');
      return false;
    } finally {
      setTrackBusy(false);
    }
  };

  const [vendorFor, setVendorFor] = useState(null);
  const [vendorBusy, setVendorBusy] = useState(false);
  const [vendorErr, setVendorErr] = useState(null);
  const { data: vendorMaster } = useGlobalStageRecords('p12');
  const vendorChoices = useMemo(() => {
    const fromMaster = (vendorMaster?.data || vendorMaster || [])
      .map((r) => (r.values?.vendor_name || '').trim()).filter(Boolean);
    const fromRows = rows.map(({ r }) => (r.values?.vendor || '').trim()).filter(Boolean);
    return [...new Set([...fromMaster, ...fromRows])].sort((a, b) => a.localeCompare(b));
  }, [vendorMaster, rows]);
  /* ── Edit and delete, on every stage's rows ─────────────────────────────
     "I sent the PO and then realised the item name is wrong" — so a line is
     editable (its own project's BOQ form, opened right here) and deletable
     for as long as it is not approved-and-frozen. The item list inside the
     form is the same add/remove list the create form has. */
  const [editingRow, setEditingRow] = useState(null);
  const [updateRecord, updateState] = useUpdateRecordMutation();
  const [deleteRecord] = useDeleteRecordMutation();
  const removeLine = async (row) => {
    const label = row.r.title || row.r.values?.item || 'this line';
    // eslint-disable-next-line no-alert -- a destructive click needs one plain question
    if (!window.confirm(`Delete "${label}" from ${row.project.name}? This removes the line and its history.`)) return;
    try {
      await deleteRecord({ id: row.r._id, projectId: row.project.id, stageKey: BOQ_STAGE }).unwrap();
      flashSuccess('Line deleted');
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(err?.data?.message || 'Could not delete this line — an approved line stays.');
    }
  };

  const saveVendor = async ({ name, source }) => {
    const row = vendorFor;
    if (!row || !name || !source) return;
    setVendorBusy(true);
    setVendorErr(null);
    try {
      await writeTracking({
        id: row.r._id,
        projectId: row.project.id,
        stageKey: BOQ_STAGE,
        values: { vendor: name, source_of_supply: source },
        note: `Vendor chosen from the Purchase sheet — ${name} (${source})`,
      }).unwrap();
      setVendorFor(null);
      // A vendor or source change can make the line orderable (or not).
      if (projectFilter) refetchOrderability();
      flashSuccess(`Vendor set — ${name} · ${source}.`);
    } catch (err) {
      setVendorErr(err?.data?.message || err?.error || 'Could not set the vendor. Try again.');
    } finally {
      setVendorBusy(false);
    }
  };
  const [recvBusy, setRecvBusy] = useState(false);
  const [recvError, setRecvError] = useState(null);
  const navigate = useNavigate();

  const stage = params.get('stage') || 'all';
  const filter = params.get('status') || 'all';       // kept: the overview's older deep links
  /* Two states: a centre is chosen, or it is not. There is no company-wide
     option here — that view is the Overview's, and offering it on the sheet
     as well gave one question two answers. */
  const projectFilter = params.get('project') || '';
  /* The raise-a-REQUEST dialog, which creates BOQ lines. Distinct from
     `raising` above, which is the busy flag for turning already-priced BOQ
     lines into vendor POs — one makes the line, the other orders it. */
  const [requestOpen, setRequestOpen] = useState(false);
  const oneCentre = Boolean(projectFilter);
  const vendorFilter = params.get('vendor') || '';
  const category = params.get('category') || 'all';
  /* A SET of BOQs, not one. Empty means every BOQ, which is also what the
     URL says by carrying no `boq` at all. */
  const boqPicked = new Set((params.get('boq') || '').split(',').map((x) => x.trim()).filter(Boolean));

  /**
   * One ticking clock for the whole sheet, not one per row. A hundred rows
   * with their own interval is a hundred timers fighting for the same second.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* Any filter change starts again at page one: staying on page 4 of a list
     that now has two rows shows an empty table and looks broken. */
  useEffect(() => { setPage(1); }, [stage, filter, projectFilter, vendorFilter, category, params.get('boq')]);

  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuFor(null); };
    const esc = (e) => { if (e.key === 'Escape') setMenuFor(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menuFor]);

  /* One setter: an empty value drops the key, so the URL stays clean. */
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  /**
   * EVERY PROJECT, NOT ONLY THE ONES THAT ALREADY HAVE A BOQ.
   *
   * This was built from `rows`, and a row is a BOQ line — so a project with
   * no lines yet never appeared in the picker, and a project with no lines
   * yet is EXACTLY the one somebody opens this page to write the first line
   * for. A new centre reached Purchase and the dropdown had nothing in it,
   * with "Add BOQ" sitting right there needing a project to add to. The list
   * excluded the only projects it needed to offer.
   *
   * Projects with lines keep their count and sort first, because those are
   * the ones being worked; the rest follow, marked as having nothing yet so
   * the choice is honest rather than looking like a loading list.
   */
  /* kind=all: a new game's host project (New Games Creation FMS, Step 5) is
     hidden from the store lists but its BOQ lines are ordered here. */
  const { data: allProjectsResp } = useProjects({ limit: 200, kind: 'all' });
  const projects = useMemo(() => {
    const m = new Map();
    /* The ones with work, from the rows themselves — no extra request
       needed and no chance of the two disagreeing about the name. */
    for (const { project } of rows) if (project.id && !m.has(project.id)) m.set(project.id, { ...project, lines: 0 });
    for (const { project } of rows) if (project.id) m.get(project.id).lines += 1;

    const live = allProjectsResp?.data?.items || allProjectsResp?.data || allProjectsResp || [];
    for (const p of (Array.isArray(live) ? live : [])) {
      /* A closed or archived project is not somewhere new orders belong. */
      if (p.archivedAt || p.status === 'draft') continue;
      const id = String(p._id || p.id || '');
      if (!id || m.has(id)) continue;
      m.set(id, { id, name: p.name || '—', code: p.code || '', city: p.city || '', lines: 0 });
    }

    return [...m.values()].sort((a, b) => (b.lines - a.lines) || a.name.localeCompare(b.name));
  }, [rows, allProjectsResp]);
  const vendorNames = useMemo(
    () => [...new Set(rows.map(({ r }) => r.values?.vendor).filter(Boolean))].sort(), [rows],
  );

  /**
   * The pipeline counts what the centre/vendor filters leave, but NOT
   * what the stage filter leaves — otherwise picking a stage would empty the
   * other five and the strip would stop being a way back out.
   */
  /**
   * EVERYTHING EXCEPT THE STAGE, and then the stage.
   *
   * The strip counts `scoped` and the table draws `visible`, so the split
   * between them decides whether the two agree. Only the STAGE is held back:
   * a stage filter must leave the other five boxes counting, or there is no
   * way to click out of the one you picked.
   *
   * Search and category used to be held back as well, which is a different
   * thing entirely — searching "santosh" cut the table to one row while the
   * strip still said nine. A number on the strip and the rows beneath it now
   * always describe the same set.
   */
  const scoped = rows.filter((row) => {
    const { r, f, project } = row;
    if (oneCentre && project.id !== projectFilter) return false;
    if (vendorFilter && r.values?.vendor !== vendorFilter) return false;
    if (filter === 'late' ? f.daysLate === 0 : filter !== 'all' && f.status !== filter) return false;
    if (category !== 'all' && categoryOf(row) !== category) return false;
    if (boqPicked.size && !boqPicked.has(boqOf(row))) return false;
    return true;
  });
  const pipeline = pipelineOf(scoped);
  /* The chips count what the OTHER filters leave, for the same reason the
     strip does: a category filter must not empty the chips it sits in. */
  const categories = categoriesOf(rows.filter(({ r, project }) => {
    if (oneCentre && project.id !== projectFilter) return false;
    if (vendorFilter && r.values?.vendor !== vendorFilter) return false;
    return true;
  }));

  /* The BOQs, counted over everything the OTHER filters leave — so picking one
     does not empty the list you picked it from. */
  const boqs = boqsOf(rows.filter(({ r, project }) => {
    if (oneCentre && project.id !== projectFilter) return false;
    if (vendorFilter && r.values?.vendor !== vendorFilter) return false;
    return true;
  }));

  /* The four working steps are REGISTERS, not queues: every line stays on
     the sheet at every step, and what changes is whether that step's column
     is filled (with its date and who) or still empty with the action beside
     it. Filtering a step to only its waiting rows made a line VANISH the
     moment its vendor was set — which reads as data loss, and hides exactly
     the done/pending comparison the register exists to show. Shortfall stays
     an exception list: a register of everything that is NOT short would be
     noise. */
  const REGISTER_STAGES = new Set(['vendor', 'raise', 'tracking', 'grn']);
  /* …but only lines that have REACHED the step. Listing every line put a
     "Select vendor" button beside BOQs nobody had filled or approved yet —
     an action the flow does not allow, on a line that is not there. A line
     joins a register when it arrives and stays once its step is done. */
  const RANK = Object.fromEntries(PIPELINE.map((s, i) => [s.key, i]));
  const reached = (row) => {
    const at = stageOf(row);
    if (at === 'cancelled') return row.r?.status === 'approved';
    return (RANK[at] ?? -1) >= RANK[stage];
  };
  const visible = scoped.filter((row) => {
    const { f } = row;
    if (REGISTER_STAGES.has(stage)) return reached(row);
    if (stage !== 'all' && stage !== 'over' && stageOf(row) !== stage) return false;
    if (stage === 'over' && f.daysLate === 0) return false;
    return true;
  });

  /* Whether each line can legally become a PO — the server's own rule
     (outside procurement, approved, a vendor with a signed contract), read so
     the Raise step names the blocker instead of offering a button the server
     will refuse. The rule is per project, so it is read once a centre is picked. */
  const { data: orderData, refetch: refetchOrderability } = useGetOrderabilityQuery(projectFilter, {
    skip: !projectFilter,
    refetchOnMountOrArgChange: true,
  });
  const orderRowById = useMemo(() => {
    const list = orderData?.rows || orderData?.data?.rows || [];
    return new Map(list.map((o) => [String(o.id), o]));
  }, [orderData]);

  /* ── The FMS columns, on every step ──────────────────────────────────────
     Assigned to · Assigned by · Plan · Actual · Done by. The step's owner is
     the project task that owns it (FMS_STEPS.taskKey), so the name here is the
     same person My Tasks shows; plans chain off actuals (fmsTimeline). */
  const { data: fmsTasksData } = useFmsTasks({ project: projectFilter, limit: 500 }, { skip: !projectFilter });
  const taskByKey = useMemo(() => {
    const list = fmsTasksData?.data || fmsTasksData?.items || fmsTasksData || [];
    return new Map((Array.isArray(list) ? list : []).filter((t) => t.templateTaskKey).map((t) => [t.templateTaskKey, t]));
  }, [fmsTasksData]);
  const ownerOf = (stepKey) => {
    const task = taskByKey.get(FMS_STEPS[stepKey]?.taskKey);
    if (!task) return null;
    const names = new Set();
    const to = [task.assignee, ...(task.assigneeRefs || [])]
      .filter((p) => p?.name && !names.has(p.name) && names.add(p.name));
    return { task, to, by: task.createdBy?.name || null };
  };
  /* `part`: 'lead' draws Assigned to + Plan, 'rest' draws Actual, Done by and
     Assigned by, and nothing draws all five in that order. The main sheet
     puts the lead pair right after the BOQ name — who owns the step and when
     it is due are the two things read first, and at the far end of a wide
     row they were under the scroll. */
  const fmsCellsFor = (row, stepKey, part) => {
    const owner = ownerOf(stepKey);
    const step = fmsTimeline(row, { boqTask: taskByKey.get(FMS_STEPS.all.taskKey), now })[stepKey];
    const tone = !step ? undefined : step.late ? 'var(--danger)' : step.actual ? 'var(--success)' : undefined;
    const lead = part !== 'rest';
    const rest = part !== 'lead';
    return (
      <>
        {lead && (
        <td className="pu-text-cell pu-fms">
          {owner?.to?.length
            ? owner.to.map((p) => (
              <span key={p.name} className="pu-fms-person"><b>{p.name}</b>{p.title && <em> · {p.title}</em>}</span>
            ))
            : <span className="muted">{projectFilter ? 'unassigned' : 'pick a centre'}</span>}
        </td>
        )}
        {lead && <td className="pt-nowrap pu-fms">{step?.plan ? fmtDateTime(step.plan) : <span className="muted">—</span>}</td>}
        {rest && (
        <td className="pt-nowrap pu-fms" style={{ color: tone, fontWeight: tone ? 650 : undefined }}>
          {!step && <span className="muted">n/a</span>}
          {step?.actual && (step.actual.at ? fmtDateTime(step.actual.at) : 'done')}
          {step?.late && <span className="pu-fms-late">{step.actual ? ' · ' : ''}{step.lateLabel}</span>}
          {step && !step.actual && !step.late && <span className="muted">pending</span>}
        </td>
        )}
        {rest && <td className="pt-nowrap pu-fms">{step?.actual?.by || <span className="muted">—</span>}</td>}
        {rest && <td className="pt-nowrap pu-fms">{owner ? (owner.by || 'Project template') : <span className="muted">—</span>}</td>}
      </>
    );
  };

  /* S.No. counts down the whole filtered list, not the page — row 1 of page
     two is 26, not 1 again. */
  const snoCell = (rowIdx) => (
    <td className="pu-sno"><b>{(current - 1) * perPage + rowIdx + 1}</b></td>
  );
  /* The BOQ's name, once. A line the plan opened IS its BOQ (item and BOQ
     are the same words); a line added by hand carries its own item, which
     is shown beneath the name rather than as a second column. */
  const boqNameCell = (row) => {
    const { r, project } = row;
    const v = r.values || {};
    const boq = boqOf(row);
    const item = String(r.title || v.item || '').trim();
    const name = boq === BOQ_NONE ? (item || 'Untitled') : boq;
    const sub = item && item.toLowerCase() !== name.toLowerCase() ? item : '';
    return (
      <td className="pu-text-cell">
        <ClampText as="b" lines={2} className="pu-item" title={name} onMore={() => setOpen(row)}>
          {name}
        </ClampText>
        {sub && <span className="pu-sub" title={sub}>{sub}</span>}
        <span className="pu-sub pu-where" title={`${project.name}${project.city ? ` · ${project.city}` : ''}`}>
          <MapPin size={11} />
          {project.name}{project.city ? ` · ${project.city}` : ''}
        </span>
      </td>
    );
  };

  const lateCount = scoped.filter(({ f }) => f.daysLate > 0).length;
  /* ── In serial-number order ──────────────────────────────────────────
     A line's number (#1, #2 …) is the order it was opened in, and for a
     project whose plan opened its six BOQs that is the order the business
     lists them. The sheet used to sort BOQ by BOQ alphabetically under a
     header band per BOQ — so the six read #3, #2, #1, #4 with every name
     printed three times (band, number cell, item). One row per line, by its
     number, with the BOQ name once. */
  const ordered = [...visible].sort((a, b) => (a.r.seq ?? 0) - (b.r.seq ?? 0));
  /* One page of rows. `visible` stays the full filtered set: the count beside
     the filters, the Export and the tick-all all describe what the filters
     left, not what page you happen to be on. */
  const pageCount = Math.max(1, Math.ceil(ordered.length / perPage));
  const current = Math.min(page, pageCount);
  const pageRows = ordered.slice((current - 1) * perPage, current * perPage);

  /* Everything narrowing the sheet right now — the number the Filters button
     shows and clears. */
  /* Choosing a centre is not a filter to clear — it is the thing that makes
     the sheet exist. Only narrowing PAST it counts. */
  /* How many lines each centre holds, so the picker says what it will open
     rather than making somebody try each one. */
  const countAt = (pid) => rows.filter((row) => row.project.id === pid).length;
  const activeFilters = [stage !== 'all', filter !== 'all', oneCentre, vendorFilter,
    category !== 'all', boqPicked.size > 0].filter(Boolean).length;

  /* ── raising POs from ticked BOQ lines ──────────────────────────────── */

  /* The column only appears on the BOQ stage. Everywhere else every row is
     already on an order, and a column of dead checkboxes is noise. */
  /* Planning a purchase happens before a PO exists, so the BOQ checklist and
     the row ticks belong to the first circle and the two after it. Circle 1 is
     the sheet's default view AND the BOQ step, which is why the checklist is
     there when the page opens: clicking BOQ is meant to show the BOQs. */
  const canPick = ['all', 'vendor', 'raise'].includes(stage);
  const pickable = visible.filter(({ r }) => (r.values?.vendor || '').trim());
  const chosen = visible.filter(({ r }) => picked.has(r._id));
  const togglePick = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  /* Any change of view drops the selection: rows the user can no longer see
     must not still be queued for an order. */
  useEffect(() => { setPicked(new Set()); }, [stage, filter, projectFilter, vendorFilter, category, params.get('boq')]);

  /* PO numbers already in use, per project — what a suggestion must avoid and
     what a typed number is checked against. */
  const existingNumbers = useMemo(() => {
    const byProject = {};
    for (const { r, project } of rows) {
      const no = String(r.values?.po_number || '').trim();
      if (!no) continue;
      (byProject[project.id] ||= new Set()).add(no.toLowerCase());
    }
    return byProject;
  }, [rows]);

  /** Ticked lines as orders: one per project AND vendor, each with a suggested number. */
  const raiseGroups = useMemo(() => {
    const by = new Map();
    for (const row of chosen) {
      const vendor = (row.r.values?.vendor || '').trim();
      if (!vendor) continue;
      const key = `${row.project.id}::${vendor}`;
      if (!by.has(key)) {
        by.set(key, {
          key, vendor, projectId: row.project.id,
          projectName: [row.project.name, row.project.city].filter(Boolean).join(' · '),
          projectCode: row.project.code || 'PO', lines: [], value: 0,
        });
      }
      const g = by.get(key);
      g.lines.push(row);
      g.value += row.f.amount;
    }
    /* The suggestion continues the project's own count rather than starting at
       one: a project with four orders on file gets 5, 6, … and not a number it
       has already used. */
    const used = {};
    return [...by.values()].map((g) => {
      const n = (existingNumbers[g.projectId]?.size || 0) + (used[g.projectId] = (used[g.projectId] || 0) + 1);
      return { ...g, suggestion: `${g.projectCode}/PO-${String(n).padStart(3, '0')}` };
    });
  }, [chosen, existingNumbers]);

  const chosenValue = chosen.reduce((sum, { f }) => sum + f.amount, 0);

  /**
   * Writing the orders.
   *
   * One PATCH per LINE, because a purchase order is not a row anywhere — it is
   * the number these rows now share. Sequential rather than parallel so that a
   * failure halfway leaves a partial order that can be seen and finished,
   * instead of an unknown number of writes racing each other.
   */
  /* Every GRN number already in use, so the panel cannot hand out one twice. */
  const existingGrns = useMemo(
    () => new Set(rows.map(({ r }) => (r.values?.grn_number || '').trim()).filter(Boolean)),
    [rows],
  );

  /**
   * Save what arrived, and act on the shortfall.
   *
   * The order matters: the receipt is written FIRST and the reorder only after
   * it lands. A reorder line created against a receipt that then failed to
   * save would be an order for a shortfall nobody had recorded.
   */
  const saveReceipt = async ({ values, shortPlan, short }) => {
    const row = receiving;
    if (!row) return;
    setRecvBusy(true);
    setRecvError(null);
    try {
      await writeTracking({
        id: row.r._id,
        projectId: row.project.id,
        stageKey: BOQ_STAGE,
        values,
        note: `Receipt recorded from the Purchase sheet — ${values.received_quantity ?? '—'} of ${row.f.qty}`,
      }).unwrap();

      if (shortPlan === 'reorder') {
        const v = row.r.values || {};
        await createRecord({
          projectId: row.project.id,
          stageKey: BOQ_STAGE,
          status: 'draft',
          values: {
            /* The same thing, in the quantity that did not come. */
            item: v.item || row.r.title || '',
            unit: v.unit || '',
            rate: v.rate,
            quantity: short,
            category: v.category || '',
            vendor: v.vendor || '',
            boq_type: v.boq_type || '',
            specification: v.specification || '',
            /* Named for what it is, so nobody reads it as a duplicate. */
            tracking_remarks: `Balance of ${short} short-received against ${row.f.po}`
              + `${v.grn_number ? ` (GRN ${v.grn_number})` : ''}.`,
          },
        }).unwrap();
      }
      setReceiving(null);
      flashSuccess(shortPlan === 'reorder'
        ? `Receipt saved, and ${short} raised as a new BOQ line to reorder.`
        : 'Receipt saved.');
    } catch (err) {
      setRecvError(err?.data?.message || err?.error || 'Could not save this. Try again.');
    } finally {
      setRecvBusy(false);
    }
  };

  const createOrders = async (withNumbers) => {
    setRaising(true);
    setRaiseError(null);
    let written = 0;
    try {
      for (const g of withNumbers) {
        for (const { r } of g.lines) {
          await writeTracking({
            id: r._id,
            projectId: g.projectId,
            stageKey: BOQ_STAGE,
            values: { po_number: g.poNumber },
            note: `Purchase order raised from the BOQ (${g.lines.length} line${g.lines.length === 1 ? '' : 's'})`,
          }).unwrap();
          written += 1;
        }
      }
      setPicked(new Set());
      setRaiseOpen(false);
      flashSuccess(`${withNumbers.length} purchase order${withNumbers.length === 1 ? '' : 's'} raised`);
    } catch (err) {
      setRaiseError(
        `${err?.data?.message || err?.message || 'Could not write the order.'}`
        + ` ${written} of ${withNumbers.reduce((n, g) => n + g.lines.length, 0)} lines were updated.`,
      );
    } finally {
      setRaising(false);
    }
  };

  /** CSV with a UTF-8 BOM so Excel opens ₹ and names correctly — what is on screen, nothing wider. */
  const exportExcel = () => {
    const cols = [
      ['Centre', ({ project }) => project.name], ['Centre code', ({ project }) => project.code], ['City', ({ project }) => project.city],
      ['PO No.', ({ f }) => f.po], ['Indent No.', ({ r }) => r.values?.indent_number],
      ['Item', ({ r }) => r.title || r.values?.item], ['Category', ({ r }) => r.values?.category],
      ['Stage', (row) => PIPELINE.find((s) => s.key === stageOf(row))?.name || row.f.status],
      ['Vendor', ({ r }) => r.values?.vendor], ['Qty ordered', ({ r }) => r.values?.quantity], ['Unit', ({ r }) => r.values?.unit],
      ['Rate', ({ r }) => r.values?.rate], ['Amount', ({ f }) => f.amount],
      ['Sent', ({ r }) => [sentAtOf(r.values?.sent_whatsapp_at) && `WhatsApp ${fmtDateTime(r.values.sent_whatsapp_at)}`, sentAtOf(r.values?.sent_email_at) && `Email ${fmtDateTime(r.values.sent_email_at)}`].filter(Boolean).join('; ')],
      ['Status', ({ f }) => f.status], ['Due', ({ f }) => f.due && fmtDate(f.due)], ['Days late', ({ f }) => f.daysLate || ''],
      ['Dispatched on', ({ r }) => r.values?.dispatch_date && fmtDate(r.values.dispatch_date)],
      ['Transporter', ({ r }) => r.values?.transporter], ['LR / Docket', ({ r }) => r.values?.lr_docket],
      ['Received on', ({ r }) => r.values?.received_date && fmtDate(r.values.received_date)],
      ['Qty received', ({ f }) => f.received], ['Qty pending', ({ f }) => f.pending], ['GRN No.', ({ r }) => r.values?.grn_number],
      ['Invoice No.', ({ r }) => r.values?.invoice_number],
      ['Last updated by', ({ f }) => f.lastBy], ['Last updated', ({ f }) => f.lastAt && fmtDateTime(f.lastAt)],
    ];
    const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(([h]) => esc(h)).join(','), ...visible.map((row) => cols.map(([, fn]) => esc(fn(row))).join(','))];
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'purchase-orders.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /**
   * Approve a BOQ line, or send it back with a reason.
   *
   * The reason is REQUIRED on the way back and there is no field for it on
   * the way forward: "why did you approve this" is answered by the line
   * itself, while "why was this returned" is the only thing that stops it
   * being re-raised unchanged next week.
   *
   * Completing step 2's task is the server's job, not a second call from
   * here — it closes once every line on the project has been ruled on
   * (record.service.js#settlePurchaseTasks). One line is not the step.
   */
  const ruleOnLine = async (row, decision, reason) => {
    const id = row.r._id;
    setChecking(id);
    try {
      await decideRecord({
        id, decision, reason,
        projectId: row.project?._id || row.r.project,
        stageKey: row.r.stageKey,
      }).unwrap();
      flashSuccess(decision === 'approve'
        ? `${row.r.title || 'Line'} approved — it can be given a vendor now`
        : `${row.r.title || 'Line'} sent back, with your reason on it`);
      setSendingBack(null);
      setBackReason('');
    } catch {
      /* The error toast is the middleware's; the row keeps its state so the
         decision can be retried rather than retyped. */
    } finally {
      setChecking(null);
    }
  };

  /* ── Stage-specific working views ──────────────────────────────────────
     Clicking a circle used to only FILTER the one flat table; the columns
     stayed those of the BOQ view, so "Choose the vendor" showed no way to
     choose one and "GRN" showed no received quantity. Each step is a
     different job, so each gets the columns and the ONE action that job
     needs — an FMS screen per step, over the same rows. The full BOQ view
     (circle 1 / All) keeps the original rich table. */
  const stageView = ['check', 'vendor', 'raise', 'tracking', 'grn', 'short'].includes(stage);
  const remainingOf = ({ f }) => Math.max(0, (Number(f.qty) || 0) - (Number(f.received) || 0));
  const stageTable = () => {
    const heads = {
      /* What a checker needs to rule on a line, and nothing else: what it is,
         which BOQ it belongs to, how many, at what rate, for how much. The
         vendor is deliberately absent — it has not been chosen yet, and a
         column of dashes invites people to think something is missing. */
      check: ['S.No.', 'BOQ', 'Qty', 'Rate', 'Amount', 'Status', 'Assigned to', 'Plan', 'Actual', 'Done by', 'Assigned by', 'Action', ''],
      vendor: ['S.No.', 'BOQ', 'Qty', 'Rate', 'Amount', 'Vendor', 'Assigned to', 'Plan', 'Actual', 'Done by', 'Assigned by', 'Action', ''],
      raise: ['S.No.', 'BOQ', 'Vendor', 'Amount', 'PO number', 'Email', 'WhatsApp', 'Assigned to', 'Plan', 'Actual', 'Done by', 'Assigned by', 'Action', ''],
      tracking: ['S.No.', 'PO number', 'BOQ', 'Vendor', 'Centre', 'Status', 'Assigned to', 'Plan', 'Actual', 'Done by', 'Assigned by', 'Action', ''],
      grn: ['S.No.', 'PO number', 'BOQ', 'Vendor', 'Ordered', 'Received', 'GRN no.', 'Assigned to', 'Plan', 'Actual', 'Done by', 'Assigned by', 'Action', ''],
      short: ['S.No.', 'BOQ', 'Vendor', 'Ordered', 'Received', 'Remaining', 'Assigned to', 'Plan', 'Actual', 'Done by', 'Assigned by', 'Action', ''],
    }[stage];
    /* Where ONE line stands against each step — the register's done/pending
       verdicts, independent of which step view is open. */
    const stepState = (row) => {
      const v = row.r.values || {};
      const { f } = row;
      const vendorDone = Boolean((v.vendor || '').trim());
      const raiseDone = Boolean(String(v.po_number || '').trim()) || Boolean(f.sent);
      const delivered = Boolean(v.received_date) || f.received != null
        || ['Delivered', 'Received (GRN)', 'Partly Received', 'Short / Damaged'].includes(v.order_status);
      const grnDone = Boolean(String(v.grn_number || '').trim())
        || (f.received != null && f.qty > 0 && f.received >= f.qty);
      return { vendorDone, raiseDone, delivered, grnDone };
    };
    const waitCell = (why) => <td><span className="pu-sub pu-wait">{why}</span></td>;
    const fmsCells = (row) => fmsCellsFor(row, stage);
    const toolsCell = (row) => (
      <td onClick={(e) => e.stopPropagation()}>
        <span className="pu-rowtools">
          <button type="button" title="Edit this line — items, quantities, anything" onClick={() => setEditingRow(row)}>
            <Pencil size={14} />
          </button>
          <button type="button" className="is-danger" title="Delete this line" onClick={() => removeLine(row)}>
            <Trash2 size={14} />
          </button>
        </span>
      </td>
    );
    return (
      <div className="pt-table-wrap pu-sheet-scroll" data-guide="pu-table">
        <table className="table pu-table pu-stage-table">
          <thead><tr>{heads.map((h) => <th key={h} className={h === 'S.No.' ? 'pu-sno' : ['Qty', 'Rate', 'Amount', 'Ordered', 'Received', 'Remaining'].includes(h) ? 'pu-r' : undefined}>{h}</th>)}</tr></thead>
          <tbody>
            {pageRows.map((row, rowIdx) => {
              const { r, f, project } = row;
              const v = r.values || {};
              const { said } = promiseOf(row);
              const itemCell = boqNameCell(row);
              const vendorCell = (
                <td className="pu-text-cell">
                  {(v.vendor || '').trim()
                    ? <ClampText lines={2} className="pu-vendor" title={v.vendor}>{v.vendor}</ClampText>
                    : <span className="pu-missing">— not chosen</span>}
                </td>
              );
              const poCell = <td className="pt-nowrap">{v.po_number ? <span className="pu-mono">{v.po_number}</span> : <span className="muted">not raised</span>}</td>;
              const sentCell = (key) => {
                const at = sentAtOf(v[key]);
                const to = v[key.replace('_at', '_to')] || '';
                const failed = v[key.replace('_at', '_status')] === 'failed';
                return (
                  <td className="pt-nowrap">
                    {!at
                      ? <span className="muted">not sent</span>
                      : failed
                        ? <span className="pu-sent-failed" title={`Attempted${to ? ` to ${to}` : ''} — not delivered`}>Failed · {fmtDateTime(at)}</span>
                        : <span className="pu-sent-ok" title={to}>Sent · {fmtDateTime(at)}</span>}
                  </td>
                );
              };
              const act = (label, onClick, done = false) => (
                <td>
                  <button type="button" className={`pu-act${done ? ' is-done' : ''}`} onClick={(e) => { e.stopPropagation(); onClick(); }}>
                    {label}
                  </button>
                </td>
              );
              return (
                <tr key={r._id} className={f.daysLate ? 'is-late' : ''} onClick={() => setOpen(row)} title="Open this order">
                  {snoCell(rowIdx)}
                  {stage === 'check' && (() => {
                    const ruled = r.status === 'approved' || r.status === 'rejected';
                    return (<>
                    {itemCell}
                    <td className="pu-r pt-nowrap">{f.qty || '—'}{v.unit ? ` ${v.unit}` : ''}</td>
                    <td className="pu-r pt-nowrap">{v.rate != null ? inr(v.rate) : <span className="pu-wait">no rate yet</span>}</td>
                    <td className="pu-r pt-nowrap"><b>{v.amount != null ? inr(v.amount) : '—'}</b></td>
                    <td className="pt-nowrap">
                      {r.status === 'approved' ? <span className="pu-ok">Approved</span>
                        : r.status === 'rejected' ? <span className="pu-bad">Rejected</span>
                          : <span className="pu-sub pu-wait">Waiting</span>}
                    </td>
                    {fmsCells(row)}
                    <td onClick={(e) => e.stopPropagation()}>
                      {/*
                        * TWO VERBS, BECAUSE IT IS TWO DECISIONS.
                        *
                        * Approving releases the line to the vendor step;
                        * sending it back stops it and says why. One button
                        * with a dropdown would hide the second behind a
                        * click, and the second is the one that needs saying
                        * out loud — a line rejected silently is a line
                        * somebody re-raises next week.
                        */}
                      {r.status === 'rejected' ? (
                        /* A REJECTED BOQ IS FIXED FROM HERE. It stays on this
                           step with its reason, and correcting it resubmits
                           it to the same desk — otherwise the only way back
                           was to find it on the main sheet. */
                        <button
                          type="button"
                          className="pu-act"
                          onClick={() => setEditingRow(row)}
                          title="Correct it and send it back for checking"
                        >
                          <Pencil size={13} /> Edit &amp; resubmit
                        </button>
                      ) : ruled ? (
                        <button
                          type="button"
                          className="pu-act is-done"
                          onClick={() => setOpen(row)}
                          title="Read the line"
                        >
                          <Eye size={13} /> View
                        </button>
                      ) : (
                        <span className="pu-checkacts">
                          <button
                            type="button"
                            className="pu-act"
                            disabled={checking === r._id}
                            onClick={() => ruleOnLine(row, 'approve')}
                            title="Approve this line — it can then be given a vendor"
                          >
                            <Check size={13} /> Approve
                          </button>
                          <button
                            type="button"
                            className="pu-act is-back"
                            disabled={checking === r._id}
                            onClick={() => setSendingBack(row)}
                            title="Reject it with a reason — nothing is deleted, and it can be corrected and resubmitted"
                          >
                            <Undo2 size={13} /> Reject
                          </button>
                          {/* EDIT, BESIDE THE VERDICT. A checker who spots a
                              wrong quantity should be able to correct it on
                              the spot rather than reject a whole BOQ over a
                              typo and wait for it to come back. */}
                          <button
                            type="button"
                            className="pu-act is-done"
                            onClick={() => setEditingRow(row)}
                            title="Correct this BOQ before approving it"
                          >
                            <Pencil size={13} /> Edit
                          </button>
                        </span>
                      )}
                    </td>
                    {toolsCell(row)}
                    </>);
                  })()}
                  {stage === 'vendor' && (() => {
                    const s = stepState(row);
                    return (<>
                    {itemCell}
                    <td className="pu-r pt-nowrap">{f.qty || '—'}{v.unit ? ` ${v.unit}` : ''}</td>
                    <td className="pu-r pt-nowrap">{v.rate != null ? inr(v.rate) : '—'}</td>
                    <td className="pu-r pt-nowrap"><b>{v.amount != null ? inr(v.amount) : '—'}</b></td>
                    {vendorCell}
                    {fmsCells(row)}
                    {act(s.vendorDone ? 'Change vendor' : 'Select vendor', () => { setVendorErr(null); setVendorFor(row); }, s.vendorDone)}
                    {toolsCell(row)}
                    </>);
                  })()}
                  {stage === 'raise' && (() => {
                    const s = stepState(row);
                    return (<>
                    {itemCell}
                    {vendorCell}
                    <td className="pu-r pt-nowrap"><b>{v.amount != null ? inr(v.amount) : '—'}</b></td>
                    {poCell}
                    {sentCell('sent_email_at')}
                    {sentCell('sent_whatsapp_at')}
                    {fmsCells(row)}
                    {(() => {
                      if (!s.vendorDone) return waitCell('vendor first — step 2');
                      const ord = orderRowById.get(String(r._id));
                      /* Stock and production never become POs — the one case
                         with no button. Everything else gets Raise the PO, with
                         any open control shown as a warning beneath it. */
                      if (!s.raiseDone && ord && !ord.orderable && !ord.blocked) return waitCell(ord.reason);
                      const notes = s.raiseDone ? [] : [...(ord?.warnings || []), ...(ord?.blocked ? [ord.reason] : [])];
                      return (
                        <td>
                          {/* Always the PO document — actionPathOf follows the line's
                              CURRENT stage, which sends a raised line to its tracker. */}
                          <Link className={`pu-act${s.raiseDone ? ' is-done' : ''}`} to={`${purchaseOrderPath(project.id, r._id)}/document`} onClick={(e) => e.stopPropagation()}>
                            {s.raiseDone ? 'Open the PO' : 'Raise the PO'}
                          </Link>
                          {notes.length > 0 && (
                            <span className="pu-sub" style={{ display: 'block', color: 'var(--warning)', marginTop: 3, whiteSpace: 'normal', maxWidth: 200 }}>
                              ⚠ {notes.join(' · ')}
                            </span>
                          )}
                        </td>
                      );
                    })()}
                    {toolsCell(row)}
                    </>);
                  })()}
                  {stage === 'tracking' && (() => {
                    const s = stepState(row);
                    const status = v.order_status || 'Ordered';
                    const tone = TONE[status] || TONE.Ordered;
                    return (<>
                    {poCell}
                    {itemCell}
                    {vendorCell}
                    <td className="pt-nowrap">{project.city || '—'}</td>
                    <td className="pt-nowrap">
                      {s.raiseDone
                        ? <span className="pu-badge" style={{ color: tone.color, background: tone.soft }}>{status}</span>
                        : <span className="muted">—</span>}
                    </td>
                    {fmsCells(row)}
                    {!s.raiseDone
                      ? waitCell('waiting for the PO — step 3')
                      : act('Update status', () => setStatusFor(row), s.delivered)}
                    {toolsCell(row)}
                    </>);
                  })()}
                  {stage === 'grn' && (() => {
                    const s = stepState(row);
                    return (<>
                    {poCell}
                    {itemCell}
                    {vendorCell}
                    <td className="pu-r pt-nowrap">{f.qty || '—'}</td>
                    <td className="pu-r pt-nowrap"><b>{f.received ?? '—'}</b></td>
                    <td className="pt-nowrap">{v.grn_number ? <span className="pu-mono">{v.grn_number}</span> : <span className="muted">—</span>}</td>
                    {fmsCells(row)}
                    {!s.delivered
                      ? waitCell(s.raiseDone ? 'waiting for delivery — step 4' : 'waiting for the PO — step 3')
                      : act(s.grnDone ? 'Open the GRN' : 'Book the GRN', () => setGrnFor(row), s.grnDone)}
                    {toolsCell(row)}
                    </>);
                  })()}
                  {stage === 'short' && (<>
                    {itemCell}
                    {vendorCell}
                    <td className="pu-r pt-nowrap">{f.qty || '—'}</td>
                    <td className="pu-r pt-nowrap">{f.received ?? '—'}</td>
                    <td className="pu-r pt-nowrap"><b className="pu-remaining">{remainingOf(row)} short</b></td>
                    {fmsCells(row)}
                    {act('Receive / reorder', () => { setRecvError(null); setReceiving(row); })}
                    {toolsCell(row)}
                  </>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <Topbar
        title="Purchase Orders"
        back={purchaseParentPath('purchase-orders')}
        actions={(
          <div className="row gap-2">
            {/* SENT HERE BY A TASK. The task link carries `&task=<code>`, so
                the way back sits on screen rather than in the browser's back
                button. The task closes itself when this step is done for
                every line, so going back shows it finished. */}
            {params.get('task') && projectFilter && (
              <Link className="btn btn-subtle btn-sm" to={`/projects/${projectFilter}/tasks/${params.get('task')}`}>
                <ArrowLeft size={14} /> Back to task {params.get('task')}
              </Link>
            )}
            {/* A BOQ line IS an order, so this is where a new one starts.
                Carries the chosen centre across so the form does not ask
                again for something this page already knows. */}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate(`/purchase/orders/new${projectFilter ? `?project=${projectFilter}` : ''}`)}
              data-guide="pu-add-boq"
            >
              <Plus size={14} /> Add BOQ
            </button>
            {/* The other way in: a doer says WHAT is needed, across several
                items at once, and the lines land on the BOQ for pricing. "Add
                BOQ" is the priced, one-line-at-a-time form; this is the
                request that comes before it. */}
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              onClick={() => setRequestOpen(true)}
            >
              <ShoppingCart size={14} /> Raise a request
            </button>
            <button type="button" className="btn btn-subtle btn-sm" onClick={exportExcel} disabled={!oneCentre || visible.length === 0} data-guide="pu-export">
              <Download size={14} /> Export to Excel
            </button>
          </div>
        )}
      />
      <div className="content">
        <div className="col gap-3 fade-in">
          <div className="pu-toolbar">
            <select
              className={`pt-select${oneCentre ? '' : ' pu-centre-ask'}`}
              value={projectFilter}
              onChange={(e) => setParam('project', e.target.value)}
              aria-label="Project"
              data-guide="pu-centre"
            >
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.city ? ` · ${p.city}` : ''}
                  {p.lines ? ` (${p.lines})` : ' — no BOQ yet'}
                </option>
              ))}
            </select>
            {oneCentre && (
              <select className="pt-select" value={vendorFilter} onChange={(e) => setParam('vendor', e.target.value)} aria-label="Vendor">
                <option value="">All vendors</option>
                {vendorNames.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            {/* Only once there is a sheet to count. While the page is still
                asking which centre, "9 of 9 orders" describes rows nobody can
                see. */}
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>
              {oneCentre ? `${visible.length} of ${scoped.length} orders` : ''}
            </span>
            {/* Named for what it holds, and it clears what it counts. A button
                labelled "Filters" that opens nothing would be furniture. */}
            {oneCentre && (
              <button
                type="button"
                className={`btn btn-subtle btn-sm${activeFilters ? ' is-on' : ''}`}
                disabled={!activeFilters}
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
                title={activeFilters ? `Clear ${activeFilters} filter${activeFilters === 1 ? '' : 's'}` : 'No filters applied'}
              >
                <SlidersHorizontal size={14} /> Filters
                {activeFilters > 0 && <span className="pu-filter-count">{activeFilters}</span>}
              </button>
            )}
          </div>

          {/* Until a project is named, one line saying what the picker above
              will do — the same shape Data Explorer waits in, without the
              icon. Everything below this belongs to one project. */}
          {!oneCentre ? (
            <div className="empty pu-pick">
              <div className="col gap-1 center">
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                  Select a project to see its purchase orders
                </div>
                <div className="sm muted">
                  Choose one above and everything fills in for it — the flow from BOQ line to GRN,
                  its BOQs, and every order line with its vendor, amount and promised date.
                </div>
              </div>
            </div>
          ) : (
            <>
            {/* the flow: BOQ line to vendor to PO to tracking to GRN, and the
                one branch that leaves it.

                Each circle is a step AND the filter for it, which is why the
                count sits on the circle rather than in a legend: the number you
                click is the number of rows you get. The arrow between two
                circles is captioned with what has to happen for a line to move
                on, and the last arrow is dashed because a shortfall is a line
                falling out of the flow, not advancing along it. */}
            <div className="pu-flow" data-guide="pu-pipe">
              {pipeline.map((st) => (
                <Fragment key={st.key}>
                  <button
                    type="button"
                    className={`pu-node${stage === st.key || (st.key === 'all' && stage === 'all') ? ' is-on' : ''}${st.count === 0 && st.key !== 'all' ? ' is-empty' : ''}`}
                    style={{ '--tone': st.tone }}
                    onClick={() => setParam('stage', st.key === 'all' ? '' : st.key)}
                    aria-label={`${st.name} — ${st.key === 'all' ? `every line, ${inrShort(valueOf(scoped))}` : `${st.count} line${st.count === 1 ? '' : 's'}, ${inrShort(st.value)}`}`}
                  >
                    <span className="pu-node-grp">{st.group}</span>
                    <span className="pu-node-ring">
                      <b className="pu-node-n">{st.n}</b>
                      <span className={`pu-node-c${st.late ? ' is-late' : ''}`}>{st.count}</span>
                    </span>
                    <span className="pu-node-name">{st.name}</span>
                    <span className={`pu-node-sub${st.late ? ' is-late' : ''}`}>
                      {st.late ? `${st.late} overdue` : inrShort(st.value)}
                    </span>
                    {/* Hover card: who owns this step, who assigned it, and its plan. */}
                    {(() => {
                      const def = FMS_STEPS[st.key];
                      const o = ownerOf(st.key);
                      return (
                        <span className="pu-node-tip" role="tooltip">
                          <b className="pu-tip-title">{st.n}. {def?.what || st.name}</b>
                          <span>
                            <em>Assigned to</em>
                            {o?.to?.length
                              ? o.to.map((p) => `${p.name}${p.title ? ` — ${p.title}` : ''}`).join(', ')
                              : (projectFilter ? 'nobody yet' : 'pick a centre to see')}
                          </span>
                          <span><em>Assigned by</em>{o ? (o.by || 'Project template') : '—'}</span>
                          <span>
                            <em>Plan</em>
                            {def ? (def.leadDays ? `within ${def.leadDays} day${def.leadDays === 1 ? '' : 's'} of ${def.after}` : `by ${def.after}`) : '—'}
                          </span>
                          {o?.task?.plannedEnd && <span><em>Task due</em>{fmtDateTime(o.task.plannedEnd)}</span>}
                          <span>
                            <em>Lines</em>
                            {st.key === 'all' ? scoped.length : st.count}
                            {st.late ? <b className="pu-fms-late"> · {st.late} overdue</b> : null}
                          </span>
                        </span>
                      );
                    })()}
                  </button>

                  {st.next && (
                    <span className={`pu-arrow${st.nextIsException ? ' is-exception' : ''}`} aria-hidden="true">
                      <span className="pu-arrow-cap">{st.next}</span>
                      <span className="pu-arrow-line" />
                    </span>
                  )}
                </Fragment>
              ))}
            </div>

            {/* The seven BOQ cards — step 1 ONLY. They are the BOQ step's own
                furniture: which documents exist, what each is worth, what is
                still to order. On "Choose the vendor" or any later step they
                are a second screen of noise above the rows the step is
                actually about, so every other circle goes straight to its
                table. */}
            {stage === 'all' && boqs.length > 0 && (
              <div className="pu-boqs-panel">
                <div className="pu-boqs-head">
                  <span className="pu-boqs-icon"><ClipboardList size={15} /></span>
                  <span className="pu-boqs-title">
                    BOQs
                    <span className="tiny muted">
                      {boqPicked.size
                        ? ` — ${boqPicked.size} of ${boqs.length} ticked`
                        : ' — none ticked, so every BOQ is in view'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-subtle btn-sm"
                    onClick={() => setParam('boq', boqPicked.size === boqs.length ? '' : boqs.map((g) => g.key).join(','))}
                  >
                    {boqPicked.size === boqs.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="pu-boqs">
                  {boqs.map((g) => {
                    const on = boqPicked.has(g.key);
                    return (
                      <div
                        key={g.key}
                        className={`pu-boq${on ? ' is-on' : ''}${g.key === BOQ_NONE ? ' is-none' : ''}`}
                        title={g.key === BOQ_NONE
                          ? 'Lines with no BOQ set on the Phase 5 form'
                          : `${g.lines.length} lines · ${g.toOrder} still to order`}
                      >
                        <span className="pu-boq-top">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              /* A new set every time rather than mutating the one
                                 React is rendering from. */
                              const next = new Set(boqPicked);
                              if (on) next.delete(g.key); else next.add(g.key);
                              setParam('boq', [...next].join(','));
                            }}
                          />
                          <span className="pu-boq-name">{g.key}</span>
                        </span>
                        <span className="pu-boq-meta">
                          {g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {inrShort(g.value)}
                        </span>
                        {g.toOrder > 0 && <span className="pu-boq-n">{g.toOrder} to order</span>}
                        {g.key !== BOQ_NONE && (
                          <Link
                            className="pu-boq-open"
                            to={`/purchase/orders/new?project=${encodeURIComponent(projectFilter)}&boq=${encodeURIComponent(g.key)}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open BOQ <ArrowRight size={12} />
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── category chips, built from the categories actually present ── */}
            <div className="pu-chips" data-guide="pu-chips">
              <button type="button" className={`pu-chip${category === 'all' && stage !== 'over' ? ' is-on' : ''}`} onClick={() => { setParam('category', ''); }}>
                All categories <span>{scoped.length}</span>
              </button>
              {categories.map((c) => (
                <button type="button" key={c.key} className={`pu-chip${category === c.key ? ' is-on' : ''}`} onClick={() => setParam('category', c.key)}>
                  {(() => { const I = CHIP_ICON[String(c.key).toLowerCase()]; return I ? <I size={12} /> : null; })()}
                  {c.key} <span>{c.n}</span>
                </button>
              ))}
              <button type="button" className={`pu-chip${stage === 'over' ? ' is-on' : ''}`} onClick={() => setParam('stage', stage === 'over' ? '' : 'over')}>
                Past the vendor&rsquo;s own date <span>{lateCount}</span>
              </button>
            </div>

            {/* Only on the BOQ stage, and only once something is ticked. A bar
                that is always there is a permanent invitation to an action that
                usually does not apply. */}
            {canPick && chosen.length > 0 && (
              <div className="pu-pickbar">
                <b>{chosen.length} line{chosen.length === 1 ? '' : 's'}</b>
                <span>
                  {raiseGroups.length} order{raiseGroups.length === 1 ? '' : 's'} · {inr(chosenValue)}
                </span>
                {chosen.length > raiseGroups.reduce((n, g) => n + g.lines.length, 0) && (
                  <span className="pu-pickbar-warn">
                    <AlertTriangle size={12} /> lines with no vendor cannot be ordered
                  </span>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
                  Clear
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={raiseGroups.length === 0}
                  onClick={() => { setRaiseError(null); setRaiseOpen(true); }}
                >
                  <FilePlus2 size={13} /> Raise {raiseGroups.length} PO{raiseGroups.length === 1 ? '' : 's'}
                </button>
              </div>
            )}

            {raiseError && (
              <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {raiseError}</div>
            )}

            {isLoading ? <SkTable rows={8} /> : rows.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No purchase orders yet" hint="Orders come from the BOQ lines in each project's Phase 5. Add them there and they appear here automatically." />
            ) : visible.length === 0 ? (
              <EmptyState icon={Search} title="Nothing matches these filters" hint="Try another stage, vendor or BOQ." />
            ) : stageView ? stageTable() : (
              <div className="pt-table-wrap pu-sheet-scroll" data-guide="pu-table">
                <table className="table pu-table">
                  <thead>
                    <tr>
                      {canPick && (
                        <th className="pu-tick">
                          <input
                            type="checkbox"
                            aria-label="Select every line that can be ordered"
                            checked={pickable.length > 0 && chosen.length === pickable.length}
                            /* Some but not all: the box shows a dash rather than
                               claiming either state. */
                            ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && chosen.length < pickable.length; }}
                            onChange={(e) => setPicked(new Set(e.target.checked ? pickable.map(({ r }) => r._id) : []))}
                          />
                        </th>
                      )}
                      <th className="pu-sno">S.No.</th>
                      <th>BOQ</th>
                      <th>Assigned to</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Category</th>
                      {/* Quantity has a column of its own. It used to exist
                          only as the "393 nos × ₹0" sub-line under Amount,
                          which is unreadable as a column: you cannot scan how
                          much was asked for down a page, and on a line with no
                          rate yet the whole cell reads as ₹0. Quantity is what
                          the request WAS; the amount is what it later costs. */}
                      <th className="pu-r">Qty</th>
                      <th className="pu-r">Amount</th>
                      <th>Vendor</th>
                      <th>PO number</th>
                      <th>Promised</th>
                      <th>Actual</th>
                      <th>Done by</th>
                      <th>Assigned by</th>
                      <th className="pu-pin-action">Action</th>
                      <th className="pu-more-col" aria-label="More" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, rowIdx) => {
                      const { r, f, project } = row;
                      const v = r.values || {};
                      const meta = PIPELINE.find((s) => s.key === stageOf(row));
                      const clock = clockOf(f, now);
                      const { said } = promiseOf(row);
                      const done = CLOSED.has(f.status);
                      return (
                        <Fragment key={r._id}>
                        <tr
                          className={f.daysLate ? 'is-late' : ''}
                          onClick={() => setOpen(row)}
                          title="Open this order"
                        >
                          {canPick && (
                            <td className="pu-tick" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={picked.has(r._id)}
                                disabled={!(v.vendor || '').trim()}
                                title={(v.vendor || '').trim()
                                  ? `Include this line in a PO for ${v.vendor}`
                                  : 'No vendor on this line — set one on the BOQ before it can be ordered'}
                                aria-label={`Select ${r.title || v.item || 'this line'}`}
                                onChange={() => togglePick(r._id)}
                              />
                            </td>
                          )}
                          {snoCell(rowIdx)}
                          {boqNameCell(row)}
                          {fmsCellsFor(row, 'all', 'lead')}
                          <td>{statusChip(f)}</td>
                          <td><span className="pu-cat" title={v.category || 'Uncategorised'}>{v.category || 'Uncategorised'}</span></td>
                          <td className="pu-r pt-nowrap">
                            <b>{v.quantity || '—'}</b>
                            {v.unit && <span className="pu-sub">{v.unit}</span>}
                          </td>
                          <td className="pu-r pt-nowrap">
                            <b>{inr(f.amount)}</b>
                            {/* Says WHY the amount is what it is. A line still
                                waiting on a rate says so in words rather than
                                showing "× ₹0", which reads as free. */}
                            <span className="pu-sub">
                              {Number(v.rate) > 0
                                ? `${v.quantity || '—'} × ${inr(v.rate)}`
                                : 'no rate yet'}
                            </span>
                          </td>
                          <td className="pu-text-cell pu-vendor-cell">
                            {v.vendor
                              ? (
                                <ClampText lines={2} className="pu-vendor" title={v.vendor} onMore={() => setOpen(row)}>
                                  {v.vendor}
                                </ClampText>
                              )
                              : <span className="muted">—</span>}
                          </td>
                          <td className="pt-nowrap">
                            {v.po_number
                              ? <span className="pu-mono" title={v.po_number}>{v.po_number}</span>
                              : <span className="muted">not raised</span>}
                            {v.indent_number && <span className="pu-sub" title={`indent ${v.indent_number}`}>indent {v.indent_number}</span>}
                          </td>
                          {/* The date, what the vendor promised against it, and
                              the clock running on it — one cell, because they
                              are one fact. It was two columns and the second was
                              153px the table did not have. */}
                          <td className="pt-nowrap">
                            {f.due ? (
                              <>
                                <span className={`pu-when${f.daysLate ? ' is-late' : ''}`}>{fmtDate(f.due)}</span>
                                <span className="pu-sub">{said != null ? `vendor said ${said} days` : 'vendor gave a date'}</span>
                                <span className={`pu-due is-${clock.tone}`}>{clock.text}</span>
                              </>
                            ) : <span className="muted">not ordered</span>}
                            {f.received != null && (
                              <span className={`pu-sub${f.excess > 0 ? ' pu-over' : ''}`}>
                                {f.received} of {f.qty || '?'} in
                                {f.excess > 0 ? ` · ${f.excess} extra` : ''}
                              </span>
                            )}
                          </td>
                          {/* The other places this order lives. The row opens the
                              drawer and its button goes to the stage's own page,
                              so these are the destinations neither of those
                              covers. */}
                          {fmsCellsFor(row, 'all', 'rest')}
                          <td className="pu-pin-action" onClick={(e) => e.stopPropagation()}>
                            {/* The button is named after an action, so it does
                                that action. Most of them ARE somewhere — raising
                                and chasing at the PO document (send by WhatsApp
                                or email, with attachments), tracking and
                                receiving at the order page (GRN, uploads,
                                notes) — so those are real links.

                                SETTING THE VENDOR IS NOT A PLACE. It is a
                                choice from the Phase 4B vendor master, and this
                                page already owns that dialog (VendorModal, the
                                one step 2's panel opens). It was sent through
                                the same `actionPathOf` as the rest, so a row
                                whose next action was "Set vendor" navigated to
                                the order page instead — the one action on this
                                sheet that never reached the thing it names.

                                stopPropagation on both, or the row would ALSO
                                open its drawer behind. */}
                            {/* A DRAFT IS WAITING ON ITS BUILDER. The plan opens
                                every line with the quantity at one lot and no
                                rate, and the BOQ form will not submit without a
                                rate — so the one useful button on a draft is the
                                one that opens it to be priced. "View record"
                                told the builder nothing about what was wanted. */}
                            {r.status === 'draft' ? (
                              <button
                                type="button"
                                className="pu-act"
                                onClick={() => setEditingRow(row)}
                                title="Open this BOQ and fill in its items, quantity and rate — submitting it sends it for checking"
                              >
                                <Pencil size={13} />
                                Fill BOQ
                              </button>
                            ) : meta?.action === 'Set vendor' ? (
                              <button
                                type="button"
                                className={`pu-act${done ? ' is-done' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setVendorErr(null);
                                  setVendorFor(row);
                                }}
                                title="Pick the vendor for this line, from the vendor master"
                              >
                                <Users size={13} />
                                Select vendor
                              </button>
                            ) : (
                              <Link
                                className={`pu-act${done ? ' is-done' : ''}`}
                                to={actionPathOf(row)}
                                onClick={(e) => e.stopPropagation()}
                                title={`${meta?.action || 'Open'} — opens this order`}
                              >
                                {(() => { const I = ACTION_ICON[meta?.action]; return I ? <I size={13} /> : null; })()}
                                {meta?.action || 'Open'}
                              </Link>
                            )}
                          </td>
                          <td className="pu-more-col" onClick={(e) => e.stopPropagation()}>
                            <div className="pu-more" ref={menuFor === r._id ? menuRef : null}>
                              <button
                                type="button"
                                className="pu-more-btn"
                                aria-haspopup="menu"
                                aria-expanded={menuFor === r._id}
                                aria-label={`More for ${r.title || v.item || 'this order'}`}
                                title="More"
                                onClick={() => setMenuFor(menuFor === r._id ? null : r._id)}
                              >
                                <MoreHorizontal size={15} />
                              </button>
                              {menuFor === r._id && (
                                <div className="pu-more-menu" role="menu">
                                  {/* The one thing done most often, first and
                                      without leaving the sheet. */}
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setMenuFor(null); setRecvError(null); setReceiving(row); }}
                                  >
                                    Receive / update status
                                  </button>
                                  <button type="button" role="menuitem" onClick={() => { setMenuFor(null); setEditingRow(row); }}>
                                    Edit this line
                                  </button>
                                  <button type="button" role="menuitem" onClick={() => { setMenuFor(null); removeLine(row); }}>
                                    Delete this line
                                  </button>
                                  <Link role="menuitem" to={purchaseOrderPath(project.id, r._id)}>Open the order</Link>
                                  <Link role="menuitem" to={`${purchaseOrderPath(project.id, r._id)}/document`}>PO document</Link>
                                  <a role="menuitem" href={`/projects/${project.id}/phase/p13`} target="_blank" rel="noopener">
                                    Its BOQ line
                                  </a>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>

                {/* Which slice of the filtered set is on screen, and how to move
                    through it. Hidden entirely when everything already fits —
                    a pager over a single page is a control with nothing to do. */}
                {/* Drawn whenever there are rows, not only when they overflow a
                    page. Hiding it at "fits on one page" took the page-size
                    control with it: pick 25 with 23 rows and the whole pager
                    vanished, leaving no way back to 10. The page BUTTONS are
                    what disappear when there is a single page. */}
                {visible.length > 0 && (
                  <div className="pu-pager">
                    <span className="pu-pager-count">
                      Showing <b>{(current - 1) * perPage + 1}–{Math.min(current * perPage, visible.length)}</b> of {visible.length}
                    </span>
                    <div className="pu-pager-ctl">
                      {pageCount > 1 && (
                        <>
                          <button
                            type="button"
                            className="pu-pager-btn"
                            disabled={current === 1}
                            onClick={() => setPage(current - 1)}
                            aria-label="Previous page"
                          >
                            <ChevronLeft size={15} />
                          </button>
                          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                            <button
                              type="button"
                              key={n}
                              className={`pu-pager-btn${n === current ? ' is-on' : ''}`}
                              aria-current={n === current ? 'page' : undefined}
                              onClick={() => setPage(n)}
                            >
                              {n}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="pu-pager-btn"
                            disabled={current === pageCount}
                            onClick={() => setPage(current + 1)}
                            aria-label="Next page"
                          >
                            <ChevronRight size={15} />
                          </button>
                        </>
                      )}
                      <select
                        className="pt-select pu-pager-size"
                        value={perPage}
                        onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
                        aria-label="Rows per page"
                      >
                        {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {/* What the colours mean, once, under the sheet that uses them. */}
                <div className="pu-cmap">
                  <span className="pu-cmap-t">Colour map</span>
                  <span><i style={{ background: 'var(--primary)' }} />Gold — work to do</span>
                  <span><i style={{ background: 'var(--success)' }} />Green — done, on time</span>
                  <span><i style={{ background: 'var(--border-strong)' }} />Grey — pending, not started</span>
                  <span><i style={{ background: 'var(--danger)' }} />Red — past the vendor&rsquo;s own date</span>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </div>

      <PurchaseOrderDrawer row={open} onClose={() => setOpen(null)} />

      {/* Edit one line in place — its own project's BOQ form, item list included. */}
      {editingRow && (
        <EditLineModal
          row={editingRow}
          saving={updateState.isLoading}
          onClose={() => setEditingRow(null)}
          onSave={async ({ values, status }) => {
            await updateRecord({
              id: editingRow.r._id,
              projectId: editingRow.project.id,
              stageKey: BOQ_STAGE,
              values,
              status,
            }).unwrap();
            setEditingRow(null);
          }}
        />
      )}

      {/* Step 4: where the order has got to. */}
      {statusFor && (
        <StatusModal
          row={statusFor}
          busy={trackBusy}
          onClose={() => setStatusFor(null)}
          onSave={(values, note) => saveTracking(statusFor, values, note, () => {
            setStatusFor(null);
            flashSuccess(values.order_status === 'Delivered'
              ? 'Marked Delivered — book the GRN in step 5'
              : `Status updated — ${values.order_status}`);
          })}
        />
      )}

      {/* Step 5: the goods receipt — counted, dated, proven. */}
      {grnFor && (
        <GrnModal
          record={grnFor.r}
          facts={grnFor.f}
          user={currentUser}
          saving={trackBusy}
          onClose={() => setGrnFor(null)}
          onSave={(values) => saveTracking(grnFor, values, 'Goods receipt recorded (GRN)', () => {
            setGrnFor(null);
            flashSuccess(Number(values.pending_quantity) > 0
              ? `GRN recorded — ${values.pending_quantity} short, see Shortfall (step 6)`
              : 'GRN recorded — received in full');
          })}
        />
      )}

      {/* Step 3's one decision: who to buy this line from. */}
      {vendorFor && (
        <VendorModal
          row={vendorFor}
          vendors={vendorChoices}
          busy={vendorBusy}
          error={vendorErr}
          onClose={() => setVendorFor(null)}
          onSave={saveVendor}
        />
      )}

      {/*
        * SENDING A LINE BACK ASKS WHY, and will not proceed without it.
        *
        * A line returned with no reason is re-raised unchanged the following
        * week by somebody who never learned what was wrong with it — which
        * is the whole cost of a rejection nobody wrote down. Approving needs
        * no dialog: the line itself is the reason.
        */}
      {sendingBack && (
        <Modal
          open
          onClose={() => { setSendingBack(null); setBackReason(''); }}
          title="Reject this BOQ"
          subtitle={[sendingBack.r.title || sendingBack.r.values?.item, sendingBack.project?.name]
            .filter(Boolean).join(' · ')}
          width={520}
          footer={(
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setSendingBack(null); setBackReason(''); }}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--danger)' }}
                disabled={!backReason.trim() || checking === sendingBack.r._id}
                onClick={() => ruleOnLine(sendingBack, 'reject', backReason.trim())}
              >
                {checking === sendingBack.r._id ? 'Rejecting…' : 'Reject it'}
              </button>
            </div>
          )}
        >
          <div className="col gap-3">
            <p className="sm" style={{ margin: 0 }}>
              It stops here and stays on the BOQ with your reason on it. Nothing is deleted, and
              whoever wrote the line can correct it and put it back up.
            </p>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="pu-back-why">
                What is wrong with it? <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <textarea
                id="pu-back-why"
                className="textarea"
                rows={3}
                autoFocus
                placeholder="Quantity is double the drawing — recheck against the layout, and add the rate."
                value={backReason}
                onChange={(e) => setBackReason(e.target.value)}
              />
              <span className="tiny muted">
                This is shown on the line and in its history, so the next person reads it before redoing the work.
              </span>
            </div>
          </div>
        </Modal>
      )}

      {receiving && (
        <ReceivePanel
          row={receiving}
          existingGrns={existingGrns}
          busy={recvBusy}
          error={recvError}
          onClose={() => { setReceiving(null); setRecvError(null); }}
          onSave={saveReceipt}
        />
      )}

      {raiseOpen && raiseGroups.length > 0 && (
        <RaisePoDialog
          groups={raiseGroups}
          existing={existingNumbers}
          busy={raising}
          onCancel={() => setRaiseOpen(false)}
          onCreate={createOrders}
        />
      )}

      {/* Creates the BOQ lines a purchase order is later raised FROM. */}
      <RaisePurchaseModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        projectId={projectFilter}
      />
    </>
  );
}

/**
 * Edit one BOQ line from the sheet — the same form the phase page uses,
 * against the row's own project's template, so the item add/remove list,
 * quantity, rate and every other field behave identically wherever the line
 * is touched. An approved line's content is frozen by the server; anything
 * before that stays correctable, which is the point: "I sent the PO and then
 * saw the item name was wrong" must not need a phone call.
 */
function EditLineModal({ row, saving, onClose, onSave }) {
  const { data: project } = useProject(row.project.id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const schema = template?.stages?.find((s) => s.key === BOQ_STAGE)?.masterDataSchema || [];
  /* Mounted only once the schema is here: the form seeds its item list from
     the schema's multiAdd field in its FIRST render, so mounting it earlier
     would seed an empty list and never revisit it. */
  if (!schema.length) return null;
  /* A draft is a BOQ still to be FILLED (Step 1) — submitting it is what
     sends it to the checker. One already on the checker's desk is being
     corrected and stays there; a rejected or approved one goes back to be
     checked again, and the button says so. */
  const filling = row.r.status === 'draft';
  const boqName = row.r.values?.boq_type || row.r.values?.item || 'BOQ';
  const submitLabel = filling ? 'Submit for checking'
    : row.r.status === 'submitted' ? 'Save changes'
      : 'Resubmit for checking';
  return (
    <RecordFormModal
      open
      onClose={onClose}
      schema={schema.filter((f) => !f.tracker)}
      recordNoun="BOQ"
      title={`${filling ? 'Fill' : 'Edit'} · ${boqName}`}
      submitLabel={submitLabel}
      recordNo={row.r.title || row.r.values?.item}
      initialValues={row.r.values}
      projectId={row.project.id}
      loading={!schema.length}
      saving={saving}
      onSaveDraft={({ values }) => onSave({ values, status: 'draft' })}
      onSubmit={({ values }) => onSave({ values, status: 'submitted' })}
    />
  );
}

/**
 * Step 2's popup: pick the vendor for ONE line, from the Phase 4B vendor
 * master. Written through the tracking endpoint, so the choice lands in the
 * line's changeLog with who chose and when — the plan-vs-actual trail every
 * FMS step keeps.
 */
/**
 * Step 4's popup: where the order has got to. Only the on-its-way statuses —
 * receiving belongs to the GRN (step 5), which counts what arrived. The day a
 * status becomes true is stamped for you; transporter and LR are asked only
 * once something is actually moving.
 */
const TRAVEL_STATUSES = ['Ordered', 'Dispatched', 'In Transit', 'Delivered', 'Cancelled'];

function StatusModal({ row, busy, onClose, onSave }) {
  const v = row.r.values || {};
  const current = TRAVEL_STATUSES.includes(v.order_status) ? v.order_status : 'Ordered';
  const [status, setStatus] = useState(current === 'Ordered' ? 'Dispatched' : current);
  const [transporter, setTransporter] = useState(v.transporter || '');
  const [lr, setLr] = useState(v.lr_docket || '');
  const [note, setNote] = useState('');
  const moving = status === 'Dispatched' || status === 'In Transit';
  const save = () => {
    const values = { order_status: status };
    if (moving && !v.dispatch_date) values.dispatch_date = new Date().toISOString().slice(0, 10);
    if (moving && transporter.trim()) values.transporter = transporter.trim();
    if (moving && lr.trim()) values.lr_docket = lr.trim();
    if (note.trim()) values.tracking_remarks = note.trim();
    onSave(values, `Status set to ${status} from the Purchase sheet`);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Update the order status"
      subtitle={`${row.f.po} · ${row.r.title || v.item || 'this order'} · ${v.vendor || 'no vendor'}`}
      width={480}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || (status === current && !note.trim())}>
            {busy ? <span className="spinner" /> : 'Update status'}
          </button>
        </div>
      )}
    >
      <div className="col gap-2">
        <label className="label" htmlFor="pu-status-pick">Status</label>
        <select id="pu-status-pick" className="select" value={status} onChange={(e) => setStatus(e.target.value)} autoFocus>
          {TRAVEL_STATUSES.map((s) => <option key={s} value={s}>{s}{s === current ? ' (current)' : ''}</option>)}
        </select>
        {moving && (
          <div className="form-grid">
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="pu-status-tr">Transporter <span className="np-optional">Optional</span></label>
              <input id="pu-status-tr" className="input" value={transporter} onChange={(e) => setTransporter(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="pu-status-lr">LR / docket no. <span className="np-optional">Optional</span></label>
              <input id="pu-status-lr" className="input" value={lr} onChange={(e) => setLr(e.target.value)} />
            </div>
          </div>
        )}
        <label className="label" htmlFor="pu-status-note">Note <span className="np-optional">Optional</span></label>
        <textarea id="pu-status-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. vendor confirmed dispatch on call" />
        <span className="tiny muted">
          {status === 'Delivered'
            ? 'Delivered moves the order to GRN (step 5), where you count what arrived and attach the proof.'
            : 'Who changed it and when is recorded on the order automatically.'}
        </span>
      </div>
    </Modal>
  );
}

/* Mirrors SOURCE_OF_SUPPLY in server/src/seed/boqMaster.js — only "Outside
   procurement" ever becomes a vendor PO; stock and production are earmarked. */
const SOURCES = ['Outside procurement', 'Delhi production', 'Delhi stock'];

function VendorModal({ row, vendors, busy, error, onClose, onSave }) {
  const v = row.r.values || {};
  const [name, setName] = useState((v.vendor || '').trim());
  const [source, setSource] = useState((v.source_of_supply || '').trim() || SOURCES[0]);
  return (
    <Modal
      open
      onClose={onClose}
      title="Select the vendor"
      subtitle={`${row.r.title || v.item || 'This line'} · ${row.project.name}`}
      width={460}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave({ name, source })} disabled={busy || !name || !source}>
            {busy ? <span className="spinner" /> : 'Select vendor'}
          </button>
        </div>
      )}
    >
      <div className="col gap-2">
        <label className="label" htmlFor="pu-vendor-pick">Vendor</label>
        <select id="pu-vendor-pick" className="select" value={name} onChange={(e) => setName(e.target.value)} autoFocus>
          <option value="">Pick from the vendor master…</option>
          {vendors.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="tiny muted">
          From the Phase 4B vendor panel (the Vendors page). Add a vendor there and it appears here.
        </span>
        <label className="label" htmlFor="pu-source-pick" style={{ marginTop: 6 }}>Source of supply</label>
        <select id="pu-source-pick" className="select" value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="tiny muted">
          Only “Outside procurement” becomes a purchase order, and it needs a signed contract with this
          vendor (Phase 8). Delhi stock and Delhi production are earmarked — never ordered.
        </span>
        {error && <div className="pt-alert pt-alert--bad" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

export default PurchaseOrdersPage;
