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
  Zap, Sofa, Grid3x3,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import {
  useUpdateRecordTrackingMutation, useCreateRecordMutation,
} from '../../app/api/recordsApi.js';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { ClampText } from '../../components/ui/ClampText.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { BOQ_STAGE, CLOSED, NOT_SENT, inr, sentAtOf } from '../projects/orderTracking.jsx';
import { usePurchaseOrders, inrShort } from './usePurchaseOrders.js';
import { purchaseParentPath } from './config/purchase.routes.config.js';
import { purchaseOrderPath } from '../projects/orderRoutes.js';
import {
  PIPELINE, actionPathOf, categoriesOf, categoryOf, clockOf, pipelineOf, promiseOf, stageOf, valueOf,
  boqOf, boqsOf, BOQ_NONE,
} from './purchasePipeline.js';
import { PurchaseOrderDrawer } from './PurchaseOrderDrawer.jsx';
import { ReceivePanel } from './ReceivePanel.jsx';

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
  const [createRecord] = useCreateRecordMutation();

  /* The row being received, and what the panel is doing. */
  const [receiving, setReceiving] = useState(null);
  const [recvBusy, setRecvBusy] = useState(false);
  const [recvError, setRecvError] = useState(null);
  const navigate = useNavigate();

  const stage = params.get('stage') || 'all';
  const filter = params.get('status') || 'all';       // kept: the overview's older deep links
  /* Two states: a centre is chosen, or it is not. There is no company-wide
     option here — that view is the Overview's, and offering it on the sheet
     as well gave one question two answers. */
  const projectFilter = params.get('project') || '';
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

  const projects = useMemo(() => {
    const m = new Map();
    for (const { project } of rows) if (project.id && !m.has(project.id)) m.set(project.id, project);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
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

  const visible = scoped.filter((row) => {
    const { f } = row;
    if (stage !== 'all' && stage !== 'over' && stageOf(row) !== stage) return false;
    if (stage === 'over' && f.daysLate === 0) return false;
    return true;
  });

  const lateCount = scoped.filter(({ f }) => f.daysLate > 0).length;
  /* One page of rows. `visible` stays the full filtered set: the count beside
     the filters, the Export and the tick-all all describe what the filters
     left, not what page you happen to be on. */
  const pageCount = Math.max(1, Math.ceil(visible.length / perPage));
  const current = Math.min(page, pageCount);
  const pageRows = visible.slice((current - 1) * perPage, current * perPage);

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

  return (
    <>
      <Topbar
        title="Purchase Orders"
        back={purchaseParentPath('purchase-orders')}
        actions={(
          <div className="row gap-2">
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
                  {p.name}{p.city ? ` · ${p.city}` : ''} ({countAt(p.id)})
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
                    title={st.key === 'all'
                      ? `Every line in view - ${inrShort(valueOf(scoped))}`
                      : `${st.count} line${st.count === 1 ? '' : 's'} - ${inrShort(st.value)}`}
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

            {/* The seven BOQs — on the steps where planning a purchase happens. Each card says the one thing that
                decides whether to open it: how many of its lines are not yet on
                an order. */}
            {canPick && boqs.length > 0 && (
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
                      <label
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
                      </label>
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
            ) : (
              <div className="pt-table-wrap" data-guide="pu-table">
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
                      <th>Action</th>
                      <th>BOQ line</th>
                      <th>Item</th>
                      <th>Vendor</th>
                      <th>PO number</th>
                      <th>Status</th>
                      <th>Category</th>
                      <th className="pu-r">Amount</th>
                      <th>Promised</th>
                      <th className="pu-more-col" aria-label="More" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => {
                      const { r, f, project } = row;
                      const v = r.values || {};
                      const meta = PIPELINE.find((s) => s.key === stageOf(row));
                      const clock = clockOf(f, now);
                      const { said } = promiseOf(row);
                      const done = CLOSED.has(f.status);
                      return (
                        <tr
                          key={r._id}
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
                          <td>
                            {/* A real link, not a span: the button is named after
                                an action, so it goes to the page that performs it
                                — raising and chasing to the PO document (send by
                                WhatsApp or email, with attachments), tracking and
                                receiving to the order page (GRN, uploads, notes).
                                stopPropagation, or the row would ALSO open its
                                drawer behind the navigation. */}
                            <Link
                              className={`pu-act${done ? ' is-done' : ''}`}
                              to={actionPathOf(row)}
                              onClick={(e) => e.stopPropagation()}
                              title={`${meta?.action || 'Open'} — opens this order`}
                            >
                              {(() => { const I = ACTION_ICON[meta?.action]; return I ? <I size={13} /> : null; })()}
                              {meta?.action || 'Open'}
                            </Link>
                          </td>
                          <td className="pt-nowrap">
                            <b className="pu-mono">#{r.seq ?? '—'}</b>
                            <span className="pu-sub">Phase 5 BOQ</span>
                          </td>
                          <td className="pu-text-cell">
                            {/* BOQ item names are free text and some of them are
                                a sentence. Two lines, then "View more" — which
                                opens the drawer rather than expanding the cell,
                                because growing one row here pushes every row
                                below it down and loses the reader's place. */}
                            <ClampText
                              as="b"
                              lines={2}
                              className="pu-item"
                              title={r.title || v.item || 'Untitled'}
                              onMore={() => setOpen(row)}
                            >
                              {r.title || v.item || 'Untitled'}
                            </ClampText>
                            {/* Clipped to one line by .pu-sub; the whole thing is
                                here for a hover, and in the drawer. */}
                            <span className="pu-sub pu-where" title={`${project.name}${project.city ? ` · ${project.city}` : ''}`}>
                              <MapPin size={11} />
                              {project.name}{project.city ? ` · ${project.city}` : ''}
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
                          <td>{statusChip(f)}</td>
                          <td><span className="pu-cat" title={v.category || 'Uncategorised'}>{v.category || 'Uncategorised'}</span></td>
                          <td className="pu-r pt-nowrap">
                            <b>{inr(f.amount)}</b>
                            <span className="pu-sub">{v.quantity || '—'} {v.unit || ''} × {inr(v.rate)}</span>
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
    </>
  );
}

export default PurchaseOrdersPage;
