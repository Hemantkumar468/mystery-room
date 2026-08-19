/**
 * Gantt chart — planned vs actual, on a real date axis.
 *
 * Hand-built rather than pulled from a library. The three things that matter
 * here — two bars per row (planned above actual), the client's own status
 * colours, and a left pane that stays put while the timeline scrolls — are
 * exactly the parts every Gantt library makes hardest to change, and none of
 * them is difficult with absolute positioning over a computed day scale.
 *
 * Layout is two panes side by side: a fixed-width label pane and a horizontally
 * scrolling timeline. They share one vertical scroll container so a row's label
 * can never drift out of line with its bars.
 *
 * Colour follows the client document (§9.2): on track green, at risk amber,
 * delayed red, completed grey. A row that finished late is drawn completed
 * (grey) but keeps a red verdict, because the bar answers "is this still a
 * problem?" and the label answers "how did it go?".
 */
import { useMemo, useRef, useState } from 'react';
import { ChevronRight, Flag } from 'lucide-react';
import dayjs from '../../lib/dayjs.js';

const DAY_MS = 86_400_000;

/** Pixels per day at each zoom. Also decides which axis ticks are legible. */
export const ZOOMS = {
  day: { key: 'day', label: 'Day', px: 34 },
  week: { key: 'week', label: 'Week', px: 12 },
  month: { key: 'month', label: 'Month', px: 4.2 },
  quarter: { key: 'quarter', label: 'Quarter', px: 1.6 },
};

/** timing.state → bar colour + how the verdict text should read. */
const STATE_STYLE = {
  ontrack: { bar: 'var(--success)', text: 'var(--success)' },
  atrisk: { bar: 'var(--warning)', text: 'var(--warning)' },
  due: { bar: 'var(--warning)', text: 'var(--warning)' },
  overdue: { bar: 'var(--danger)', text: 'var(--danger)' },
  // Finished work is grey whatever the outcome — it is no longer actionable.
  // The verdict text carries whether it landed early, on time or late.
  early: { bar: 'var(--text-subtle)', text: 'var(--success)' },
  ontime: { bar: 'var(--text-subtle)', text: 'var(--success)' },
  late: { bar: 'var(--text-subtle)', text: 'var(--danger)' },
  done: { bar: 'var(--text-subtle)', text: 'var(--text-subtle)' },
  nodate: { bar: 'var(--border-strong)', text: 'var(--text-subtle)' },
};

const styleFor = (state) => STATE_STYLE[state] || STATE_STYLE.nodate;

/** Month bands across the axis — always drawn, at every zoom. */
function monthTicks(start, end) {
  const out = [];
  let cur = dayjs(start).startOf('month');
  const last = dayjs(end).endOf('month');
  while (cur.isBefore(last)) {
    const next = cur.add(1, 'month');
    out.push({ key: cur.format('YYYY-MM'), label: cur.format('MMM YYYY'), start: cur, end: next });
    cur = next;
  }
  return out;
}

/** The finer row of ticks under the months — days, or week-commencing dates. */
function minorTicks(start, end, zoom) {
  if (zoom === 'quarter') return [];
  const out = [];
  const step = zoom === 'day' ? 'day' : 'week';
  let cur = dayjs(start).startOf(step === 'day' ? 'day' : 'isoWeek');
  const last = dayjs(end);
  // Guard rather than trust the range: a corrupt window must not spin forever.
  let guard = 0;
  while (cur.isBefore(last) && guard < 800) {
    out.push({
      key: cur.format('YYYY-MM-DD'),
      label: step === 'day' ? cur.format('D') : cur.format('D MMM'),
      at: cur,
      weekend: step === 'day' && [0, 6].includes(cur.day()),
    });
    cur = cur.add(1, step === 'day' ? 'day' : 'week');
    guard += 1;
  }
  return out;
}

export function GanttChart({
  data,
  zoom = 'week',
  onRowClick,
  height = 520,
  showToday = true,
}) {
  const scrollRef = useRef(null);
  const [collapsed, setCollapsed] = useState(() => new Set());

  const px = ZOOMS[zoom]?.px ?? ZOOMS.week.px;

  const { rangeStart, rangeEnd, totalDays, width } = useMemo(() => {
    // Pad the window so bars never begin flush against the first pixel.
    const s = dayjs(data?.range?.start).startOf('day').subtract(2, 'day');
    const e = dayjs(data?.range?.end).endOf('day').add(2, 'day');
    const days = Math.max(1, Math.ceil(e.diff(s) / DAY_MS));
    return { rangeStart: s, rangeEnd: e, totalDays: days, width: Math.max(320, days * px) };
  }, [data?.range?.start, data?.range?.end, px]);

  const months = useMemo(() => monthTicks(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const minors = useMemo(() => minorTicks(rangeStart, rangeEnd, zoom), [rangeStart, rangeEnd, zoom]);

  const xOf = (date) => (dayjs(date).diff(rangeStart) / DAY_MS) * px;

  /** Rows actually drawn: children of a collapsed parent are dropped. */
  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (!collapsed.size) return all;
    const hidden = new Set();
    for (const r of all) {
      if (r.parentId && (collapsed.has(r.parentId) || hidden.has(r.parentId))) hidden.add(r.id);
    }
    return all.filter((r) => !hidden.has(r.id));
  }, [data?.rows, collapsed]);

  const hasChildren = useMemo(() => {
    const s = new Set();
    for (const r of data?.rows || []) if (r.parentId) s.add(r.parentId);
    return s;
  }, [data?.rows]);

  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const todayX = xOf(new Date());
  const todayVisible = showToday && todayX >= 0 && todayX <= width;

  if (!rows.length) {
    return (
      <div className="tl-empty">
        Nothing to plot. Every row has been filtered out, or no phase has planned dates yet.
      </div>
    );
  }

  return (
    <div className="gantt" style={{ '--tl-height': `${height}px` }}>
      <div className="tl-scroll" ref={scrollRef}>
        {/* Label pane — sticky horizontally so it survives timeline scroll. */}
        <div className="tl-labels">
          <div className="tl-labels-head">Phase / task</div>
          {rows.map((r) => (
            <div
              key={r.id}
              className={`tl-label tl-label--${r.type}`}
              style={{ paddingLeft: 10 + (r.type === 'task' ? 22 : r.parentId ? 14 : 0) }}
            >
              {hasChildren.has(r.id) ? (
                <button
                  type="button"
                  className="tl-caret"
                  onClick={() => toggle(r.id)}
                  aria-label={collapsed.has(r.id) ? 'Expand' : 'Collapse'}
                  aria-expanded={!collapsed.has(r.id)}
                >
                  <ChevronRight
                    size={13}
                    style={{ transform: collapsed.has(r.id) ? 'none' : 'rotate(90deg)', transition: 'transform var(--transition)' }}
                  />
                </button>
              ) : <span className="tl-caret-spacer" />}

              <button
                type="button"
                className="tl-label-text"
                onClick={() => onRowClick?.(r)}
                title={`${r.label}${r.sublabel ? ` — ${r.sublabel}` : ''}`}
              >
                <span className="tl-label-main truncate">{r.label}</span>
                {r.sublabel && <span className="tl-label-sub truncate">{r.sublabel}</span>}
              </button>
            </div>
          ))}
        </div>

        {/* Timeline pane */}
        <div className="tl-track" style={{ width }}>
          <div className="tl-axis">
            <div className="tl-axis-months">
              {months.map((m) => {
                const left = xOf(m.start);
                const w = xOf(m.end) - left;
                return (
                  <div key={m.key} className="tl-month" style={{ left, width: w }}>
                    <span className="truncate">{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="tl-axis-minor">
              {minors.map((t) => (
                <div
                  key={t.key}
                  className={`tl-tick${t.weekend ? ' is-weekend' : ''}`}
                  style={{ left: xOf(t.at), width: px }}
                >
                  {zoom !== 'month' && <span>{t.label}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="tl-rows">
            {/* Weekend/period shading, drawn once behind every row. */}
            {zoom === 'day' && minors.filter((t) => t.weekend).map((t) => (
              <div key={`bg-${t.key}`} className="tl-weekend" style={{ left: xOf(t.at), width: px }} />
            ))}
            {months.map((m) => (
              <div key={`ml-${m.key}`} className="tl-monthline" style={{ left: xOf(m.start) }} />
            ))}

            {todayVisible && (
              <div className="tl-today" style={{ left: todayX }}>
                <span className="tl-today-flag"><Flag size={10} /> Today</span>
              </div>
            )}

            {rows.map((r) => (
              <GanttRow key={r.id} row={r} xOf={xOf} px={px} onRowClick={onRowClick} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One row: the planned window as a light track, the actual as a solid bar
 * beneath it. A row with no planned dates still renders its actual bar — the
 * gap between them is the finding, so hiding either half defeats the chart.
 */
function GanttRow({ row, xOf, px, onRowClick }) {
  const style = styleFor(row.timing?.state);

  const plannedLeft = row.plannedStart ? xOf(row.plannedStart) : null;
  const plannedWidth = row.plannedStart && row.plannedEnd
    ? Math.max(px * 0.6, xOf(row.plannedEnd) - plannedLeft)
    : null;

  // An in-flight row has a start but no end. Drawing it to today is the honest
  // reading — the work is still consuming time — and it is the only way an
  // active phase appears on the chart at all.
  const actualLeft = row.actualStart ? xOf(row.actualStart) : null;
  const actualEndDate = row.actualEnd || (row.actualStart ? new Date() : null);
  const actualWidth = actualLeft != null && actualEndDate
    ? Math.max(px * 0.6, xOf(actualEndDate) - actualLeft)
    : null;
  const openEnded = Boolean(row.actualStart && !row.actualEnd);

  // Completed, but with no recorded start. Common in this data: a stage stores
  // `completedAt` when it is signed off, while `startedAt` is only written if
  // someone actually opened the phase first. Drawn as a milestone diamond on
  // the completion date — inventing a start so a bar could be drawn would be
  // fabricating the one number the chart exists to report.
  const milestoneX = !row.actualStart && row.actualEnd ? xOf(row.actualEnd) : null;

  const tip = [
    row.label,
    row.plannedStart ? `Planned: ${dayjs(row.plannedStart).format('DD MMM')} – ${row.plannedEnd ? dayjs(row.plannedEnd).format('DD MMM YYYY') : '?'}` : 'Planned: not set',
    row.actualStart ? `Actual: ${dayjs(row.actualStart).format('DD MMM')} – ${row.actualEnd ? dayjs(row.actualEnd).format('DD MMM YYYY') : 'in progress'}` : 'Actual: not started',
    row.timing?.label,
  ].filter(Boolean).join('\n');

  return (
    <div className={`tl-row tl-row--${row.type}`} onClick={() => onRowClick?.(row)} title={tip}>
      {plannedLeft != null && plannedWidth != null && (
        <div className="tl-bar tl-bar--planned" style={{ left: plannedLeft, width: plannedWidth }} />
      )}

      {milestoneX != null && (
        <span
          className="tl-milestone"
          style={{ left: milestoneX, background: style.bar }}
          aria-label="Completed (no start recorded)"
        />
      )}

      {actualLeft != null && actualWidth != null && (
        <div
          className={`tl-bar tl-bar--actual${openEnded ? ' is-open' : ''}`}
          style={{ left: actualLeft, width: actualWidth, background: style.bar }}
        >
          {row.progress != null && row.progress > 0 && row.progress < 100 && (
            <span className="tl-bar-progress" style={{ width: `${row.progress}%` }} />
          )}
        </div>
      )}

      {/* Verdict sits after whichever bar ends furthest right, so it never
          covers the bars it is describing. */}
      {row.timing?.label && (
        <span
          className="tl-verdict"
          style={{
            left: Math.max(
              plannedLeft ?? 0,
              (plannedLeft ?? 0) + (plannedWidth ?? 0),
              (actualLeft ?? 0) + (actualWidth ?? 0),
              (milestoneX ?? 0) + 7,
            ) + 8,
            color: style.text,
          }}
        >
          {row.timing.label}
        </span>
      )}
    </div>
  );
}

export default GanttChart;
