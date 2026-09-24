import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCorners, useDroppable,
} from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LayoutList, Columns3, AlertTriangle, Plus, Search } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { useCrmBoard, usePipelines, useMoveDeal } from '../../app/api/crmApi.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { LostReasonModal } from './LostReasonModal.jsx';
import { DealListView } from './DealListView.jsx';
import { DealDrawer } from './DealDrawer.jsx';
import { DealFormModal } from './DealFormModal.jsx';
import './crm.css';

/**
 * The pipeline board.
 *
 * OPTIMISTIC BY DESIGN. The card moves on drop and the request follows. A
 * board that waits 300ms for a round trip before the card moves feels broken,
 * and reps stop using it — which means the pipeline data stops being true,
 * which is the only thing the board exists for. The rollback lives in
 * crmApi's `moveDeal.onQueryStarted`, so a refusal puts the card back exactly
 * where it was.
 *
 * FIVE THINGS ON A CARD, no more. Title, amount, contact, days in stage, owner.
 * A sixth makes a ten-card column unreadable, and the column is what people
 * actually scan.
 *
 * The list view beside it is not a second implementation — same query, same
 * cache, different presentation. A manager reviewing 200 deals needs sorting,
 * not drag and drop.
 */

const fmtMoney = (v) => (v ? `₹${(v / 100000).toFixed(1)}L` : '—');

/** Days since the deal entered its current stage — the one number on a card
 *  that says "this one is going stale". */
function daysInStage(deal) {
  if (!deal.stageEnteredAt) return null;
  return Math.floor((Date.now() - new Date(deal.stageEnteredAt).getTime()) / 86_400_000);
}

/** Amber past a week, red past a fortnight. Thresholds from the spec, and
 *  deliberately absolute rather than relative to the stage's own median — a
 *  colour that changes meaning per column teaches nothing. */
function ageTone(days) {
  if (days == null) return '';
  if (days > 14) return 'is-red';
  if (days > 7) return 'is-amber';
  return '';
}

function DealCard({ deal, dragging }) {
  const days = daysInStage(deal);
  return (
    <article className={`crm-cardx ${dragging ? 'is-dragging' : ''}`}>
      <h4 className="crm-cardx__title">{deal.title}</h4>
      <div className="crm-cardx__row">
        <strong>{fmtMoney(deal.value)}</strong>
        {deal.contact?.name && <span className="crm-muted">{deal.contact.name}</span>}
      </div>
      <div className="crm-cardx__foot">
        <span className={`crm-cardx__age ${ageTone(days)}`}>
          {days == null ? '—' : `${days}d in stage`}
        </span>
        {deal.assignedTo?.name && (
          <Avatar name={deal.assignedTo.name} size={22} title={deal.assignedTo.name} />
        )}
      </div>
    </article>
  );
}

function SortableCard({ deal, onOpen }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: String(deal._id), data: { deal } });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(deal)}
    >
      <DealCard deal={deal} />
    </div>
  );
}

function Column({ stage, onOpen }) {
  // The column itself is a drop target, so an empty one can still be dropped
  // into — without this, a stage with no cards is impossible to move a deal to.
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage._id}`, data: { stage } });

  return (
    <section className={`crm-col ${isOver ? 'is-over' : ''} ${stage.isWon ? 'is-won' : ''} ${stage.isLost ? 'is-lost' : ''}`}>
      <header className="crm-col__head">
        <h3>
          {stage.name}
          {/* From the stage, never a lookup table in here. Stage names are
              data — a manager can rename them — so a hardcoded translation
              would be right until the first rename and then quietly show the
              old Hindi under the new English. A stage with none renders the
              English alone. */}
          {stage.labelHi && <span className="crm-col__hi">{stage.labelHi}</span>}
        </h3>
        {/* Count and value first — managers read these before any card. */}
        <span className="crm-col__stat">{stage.count} · {fmtMoney(stage.value)}</span>
      </header>
      {stage.exitCriteria && <p className="crm-col__hint">{stage.exitCriteria}</p>}

      <div ref={setNodeRef} className="crm-col__body">
        <SortableContext
          items={stage.deals.map((d) => String(d._id))}
          strategy={verticalListSortingStrategy}
        >
          {stage.deals.map((deal) => <SortableCard key={deal._id} deal={deal} onOpen={onOpen} />)}
        </SortableContext>
        {!stage.deals.length && <p className="crm-col__empty">Drop a deal here</p>}
      </div>
    </section>
  );
}

export function DealBoardPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const pipelineId = params.get('pipeline') || undefined;

  const boardArgs = useMemo(() => ({
    pipeline: pipelineId,
    assignedTo: params.get('assignedTo') || undefined,
    search: params.get('search') || undefined,
  }), [pipelineId, params]);
  const { data, isLoading, isError, error } = useCrmBoard(boardArgs);
  const { data: pipelines } = usePipelines();
  const move = useMoveDeal();
  const { employees } = useEmployees();

  const [activeDeal, setActiveDeal] = useState(null);
  /** A drop onto a lost stage, held until the reason modal answers. */
  const [pendingLoss, setPendingLoss] = useState(null);
  const [adding, setAdding] = useState(false);

  /** Which deal is open, in the URL — so a card can be linked to from a
   *  contact, a company, or a colleague pasting the address. */
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const hasFilters = Boolean(params.get('search') || params.get('assignedTo'));
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete('search'); next.delete('assignedTo');
    setParams(next, { replace: true });
  };

  const openId = params.get('open');
  const openDeal = (deal) => {
    const next = new URLSearchParams(params);
    next.set('open', String(deal._id));
    setParams(next, { replace: true });
  };
  const closeDeal = () => {
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  };

  // Pointer sensor with a small distance so a click on a card is still a
  // click — without it, opening a deal becomes impossible because every press
  // starts a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const setView = (v) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  };

  /** Which stage a drop landed in, whether it hit a card or the column. */
  const stageOf = (over) => {
    if (!over) return null;
    const id = String(over.id);
    if (id.startsWith('stage:')) return data.stages.find((s) => String(s._id) === id.slice(6));
    const card = data.stages.flatMap((s) => s.deals).find((d) => String(d._id) === id);
    return card ? data.stages.find((s) => String(s._id) === String(card.stage)) : null;
  };

  /** The two cards a drop landed between, BY ID — the server resolves their
   *  positions itself, because the order numbers this page holds are a
   *  snapshot that a renormalisation invalidates. */
  const neighbours = (stage, overId, draggedId) => {
    const cards = stage.deals.filter((d) => String(d._id) !== String(draggedId));
    const idx = cards.findIndex((d) => String(d._id) === String(overId));
    if (idx === -1) return { beforeId: cards[cards.length - 1]?._id, afterId: undefined };
    return { beforeId: cards[idx - 1]?._id, afterId: cards[idx]?._id };
  };

  const onDragEnd = ({ active, over }) => {
    setActiveDeal(null);
    if (!over || !data) return;

    const deal = data.stages.flatMap((s) => s.deals).find((d) => String(d._id) === String(active.id));
    const stage = stageOf(over);
    if (!deal || !stage) return;

    const payload = {
      id: String(deal._id),
      stage: String(stage._id),
      boardArgs,
      ...neighbours(stage, over.id, deal._id),
    };

    // A lost stage needs a reason BEFORE the move is sent — the server refuses
    // it otherwise, and asking afterwards is how deals end up closed with no
    // reason recorded at all.
    if (stage.isLost && String(deal.stage) !== String(stage._id)) {
      setPendingLoss({ deal, payload });
      return;
    }
    move.mutate(payload);
  };

  if (isError) {
    return (
      <>
        <Topbar title="Pipeline" />
        <div className="content">
          <EmptyState
            icon={AlertTriangle}
            title="The board could not be loaded"
            hint={error?.data?.message || 'The server refused the request.'}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Pipeline"
        actions={(
          <div className="row gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
              <Plus size={15} /> New deal
            </button>
            <div className="crm-viewtoggle" role="group" aria-label="View">
              <button
                type="button" className={view === 'board' ? 'is-on' : ''}
                onClick={() => setView('board')} aria-pressed={view === 'board'}
              >
                <Columns3 size={14} /> Board
              </button>
              <button
                type="button" className={view === 'list' ? 'is-on' : ''}
                onClick={() => setView('list')} aria-pressed={view === 'list'}
              >
                <LayoutList size={14} /> List
              </button>
            </div>
          </div>
        )}
      />

      <div className="content col gap-3">
        {/* Filters, in the URL — so a manager can send "look at Priya's
            pipeline" as a link, and the back button works. */}
        <div className="crm-toolbar">
          <label className="crm-search">
            <Search size={15} aria-hidden />
            <input
              className="crm-search__input"
              placeholder="Search deals…"
              defaultValue={params.get('search') || ''}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter('search', e.currentTarget.value.trim()); }}
              aria-label="Search deals"
            />
          </label>

          <select
            className="crm-select" value={params.get('assignedTo') || ''}
            onChange={(e) => setFilter('assignedTo', e.target.value)} aria-label="Owner"
          >
            <option value="">Everyone</option>
            {employees
              .filter((emp) => emp.systemRole !== 'viewer')
              .map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>

          {hasFilters && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>

        {/* Pipeline switcher — only when there is more than one, because a
            dropdown with a single option is a control that does nothing. */}
        {(pipelines?.length || 0) > 1 && (
          <div className="crm-toolbar">
            <select
              className="crm-select"
              value={pipelineId || pipelines.find((p) => p.isDefault)?._id || ''}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set('pipeline', e.target.value);
                setParams(next, { replace: true });
              }}
              aria-label="Pipeline"
            >
              {pipelines.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {isLoading || !data ? (
          <div className="sm muted" style={{ padding: 24 }}>Loading…</div>
        ) : view === 'list' ? (
          <DealListView pipelineId={data.pipeline._id} />
        ) : (
          <>
            <div className="crm-boardtotals">
              <span><strong>{data.totals.count}</strong> open deals</span>
              <span><strong>{fmtMoney(data.totals.value)}</strong> total</span>
              {/* Σ(value × stage probability). Arithmetic, not a prediction —
                  which is exactly why it can be trusted. */}
              <span className="crm-muted">{fmtMoney(data.totals.weighted)} weighted</span>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={({ active }) => setActiveDeal(active.data.current?.deal || null)}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveDeal(null)}
            >
              <div className="crm-board">
                {data.stages.map((stage) => (
                  <Column key={stage._id} stage={stage} onOpen={openDeal} />
                ))}
              </div>

              {/* The card follows the cursor at full opacity while the original
                  sits faded in place, so it is always clear what is moving. */}
              <DragOverlay>{activeDeal ? <DealCard deal={activeDeal} dragging /> : null}</DragOverlay>
            </DndContext>
          </>
        )}
      </div>

      <DealDrawer id={openId} onClose={closeDeal} />
      <DealFormModal
        open={adding}
        onClose={() => setAdding(false)}
        pipelineId={data?.pipeline?._id}
        onSaved={(deal) => deal?._id && openDeal(deal)}
      />

      <LostReasonModal
        open={Boolean(pendingLoss)}
        deal={pendingLoss?.deal}
        pending={move.isPending}
        // Cancelling sends nothing, so the card never left its column —
        // the optimistic patch only runs when the mutation does.
        onCancel={() => setPendingLoss(null)}
        onConfirm={(reason) => {
          move.mutate({ ...pendingLoss.payload, ...reason });
          setPendingLoss(null);
        }}
      />
    </>
  );
}

export default DealBoardPage;
