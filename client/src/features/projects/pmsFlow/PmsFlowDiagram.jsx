import { forwardRef } from 'react';
import {
  P, BY, STAGES, R, RING, W, H, LAST_X, MID_Y, OPEN_DAY,
  ORDER, SITE, SET1, SET1_DONE, SET2_DONE, DRAW, DEP,
  cssv, arc, wrapN, checkTxt, clockOf, lakh,
} from './pmsFlowData.js';

/**
 * The board itself — four stage bands, the dependency edges, and one circle per
 * phase carrying its ring, its progress arc, its checklist and its countdown.
 *
 * A direct port of the prototype's imperative SVG builder. The geometry (cx/cy,
 * W/H, the lane snapping) is all decided in pmsFlowData.js; this file only
 * draws it, so the two halves can be reasoned about separately.
 *
 * `highlight` is the set of phase ids currently lit — `{ '5': 1, '7': 1 }` or
 * null for none. It drives both the amber ring on a node and the thickened
 * amber edge between two lit nodes.
 *
 * Every pointer handler lives on the <svg> rather than on each node: a phase is
 * a <g> of a dozen shapes, and moving the pointer from its circle onto its own
 * label fires mouseout then mouseover again. Delegating and comparing
 * relatedTarget is what stops the hover card flickering on every crossing.
 */

/* the label rows under a circle: the checklist first, then whatever detail
   that particular phase carries */
function extrasFor(p) {
  const extra = [];
  if (p.items) {
    extra.push({
      t: checkTxt(p),
      c: p.done === p.items ? cssv('--success') : (p.done ? cssv('--text') : cssv('--ink-400')),
      b: 1,
    });
  }
  if (p.isBoq) extra.push({ t: 'construction · furniture · procurement', c: cssv('--primary-500'), b: 1 });
  if (p.isDraw && SET1_DONE < SET1) {
    extra.push({ t: `Set 1 ${SET1_DONE} of ${SET1} · BOQ blocked`, c: cssv('--accent-600') });
  }
  if (p.isPo) extra.push({ t: `${ORDER.sent} sent · ${ORDER.late} late`, c: cssv('--accent-600') });
  if (p.isSite) extra.push({ t: `civil ${SITE[0].pct}% · IT ${SITE[1].pct}%`, c: cssv('--accent-600') });
  if (p.isDeposit) {
    extra.push({ t: `deposit ${DEP.pct}% paid`, c: cssv('--accent-600'), b: 1 });
    extra.push({ t: `${lakh(DEP.paid)} of ${lakh(DEP.total)} · ${lakh(DEP.due)} left`, c: cssv('--ink-500') });
  }
  return extra;
}

function PhaseNode({ p, lit }) {
  const col = cssv(STAGES[p.stage].c);
  const lite = cssv(`${STAGES[p.stage].c}-l`);
  const solid = p.status !== 'pending';
  const lbl = String(p.no);
  const y = p.cy + RING + 21;
  const my = y + 3 * 14 + 6;
  const clock = clockOf(p);

  return (
    <g
      className={`node${lit ? ' fx' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`${p.no} ${p.name}, ${p.dept}, ${p.sla} days`}
      data-id={p.id}
    >
      <circle cx={p.cx} cy={p.cy} r={RING + 9} fill="none" stroke={cssv('--accent-500')} strokeWidth={2.5} className="fxring" />
      {p.status === 'processing' && (
        <circle cx={p.cx} cy={p.cy} r={RING + 7} fill="none" stroke={col} strokeWidth={1} opacity={0.45} />
      )}
      {p.isNew && (
        <>
          <rect x={p.cx - 24} y={p.cy - RING - 32} width={48} height={17} rx={4} fill={cssv('--accent-500')} />
          <text x={p.cx} y={p.cy - RING - 19.5} textAnchor="middle" className="gatelab">NEW</text>
        </>
      )}
      <circle cx={p.cx} cy={p.cy} r={RING} fill="none" stroke={cssv('--ink-200')} strokeWidth={6} />

      {/* the progress ring. Four phases measure something more specific than a
          percentage, and each shows its own pale-under-solid pair. */}
      {p.isDeposit ? (
        <>
          {/* pale = the whole amount the LOI commits · gold = what has actually been paid */}
          <path d={arc(p.cx, p.cy, RING, 1)} fill="none" stroke={lite} strokeWidth={6} strokeLinecap="round" />
          <path d={arc(p.cx, p.cy, RING, DEP.paid / DEP.total)} fill="none" stroke={cssv('--accent-500')} strokeWidth={6} strokeLinecap="round" />
        </>
      ) : p.isPo ? (
        <>
          {/* pale = lines sent to a vendor · solid = lines received against a GRN */}
          <path d={arc(p.cx, p.cy, RING, ORDER.sent / ORDER.lines)} fill="none" stroke={lite} strokeWidth={6} strokeLinecap="round" />
          <path d={arc(p.cx, p.cy, RING, ORDER.received / ORDER.lines)} fill="none" stroke={col} strokeWidth={6} strokeLinecap="round" />
        </>
      ) : p.isDraw ? (
        <>
          {/* pale = whole checklist, solid = Set 1 approved */}
          <path d={arc(p.cx, p.cy, RING, (SET1_DONE + SET2_DONE) / DRAW.length)} fill="none" stroke={lite} strokeWidth={6} strokeLinecap="round" />
          <path d={arc(p.cx, p.cy, RING, SET1_DONE / DRAW.length)} fill="none" stroke={col} strokeWidth={6} strokeLinecap="round" />
        </>
      ) : p.pct > 0 ? (
        <path d={arc(p.cx, p.cy, RING, p.pct / 100)} fill="none" stroke={col} strokeWidth={6} strokeLinecap="round" />
      ) : null}

      <circle
        cx={p.cx}
        cy={p.cy}
        r={R}
        fill={solid ? col : '#fff'}
        stroke={solid ? col : lite}
        strokeWidth={solid ? 2 : 2.5}
      />
      <text
        x={p.cx}
        y={p.cy - (p.status === 'complete' ? 5 : 6)}
        textAnchor="middle"
        dominantBaseline="central"
        className="num"
        fill={solid ? '#fff' : col}
        style={{ fontSize: lbl.length > 1 ? 16 : 21 }}
      >
        {lbl}
      </text>
      {p.status === 'complete' ? (
        <text x={p.cx} y={p.cy + 17} textAnchor="middle" className="tick">✓</text>
      ) : p.status === 'processing' ? (
        <text x={p.cx} y={p.cy + 16} textAnchor="middle" className="pctin" fill="#fff">{`${p.pct}%`}</text>
      ) : (
        /* not started is 0%, not a duration */
        <text x={p.cx} y={p.cy + 17} textAnchor="middle" className="pctin" fill={cssv('--ink-400')}>0%</text>
      )}

      {wrapN(`${p.no} · ${p.name}`, 22, 3).map((t, i) => (
        <text key={t + i} x={p.cx} y={y + i * 14} textAnchor="middle" className="nm">{t}</text>
      ))}
      <text x={p.cx} y={my} textAnchor="middle" className="tgt">{`${p.sla}${p.sla === 1 ? ' day' : ' days'}`}</text>
      <text x={p.cx} y={my + 14} textAnchor="middle" className="meta">{`day ${p.es}→${p.ef}`}</text>
      <text x={p.cx} y={my + 29} textAnchor="middle" className="cd" fill={clock.c}>{clock.s || clock.t}</text>
      {extrasFor(p).map((x, i) => (
        <text
          key={x.t}
          x={p.cx}
          y={my + 43 + i * 13}
          textAnchor="middle"
          className="ck"
          fill={x.c}
          style={x.b ? { fontWeight: 700 } : undefined}
        >
          {x.t}
        </text>
      ))}
    </g>
  );
}

export const PmsFlowDiagram = forwardRef(function PmsFlowDiagram(props, ref) {
  const { highlight, onPointerOver, onPointerMove, onPointerOut, onPick } = props;
  const lit = (id) => !!(highlight && highlight[id]);

  return (
    <svg
      ref={ref}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      onClick={(e) => { const n = e.target.closest('.node'); if (n) onPick(n.dataset.id); }}
      onKeyDown={(e) => {
        const n = e.target.closest('.node');
        if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(n.dataset.id); }
      }}
      onMouseOver={onPointerOver}
      onMouseMove={onPointerMove}
      onMouseOut={onPointerOut}
    >
      <defs>
        <marker id="mMain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M1 1L9 5L1 9" fill="none" stroke="#241157" strokeWidth="2.2" strokeLinecap="round" />
        </marker>
        <marker id="mSide" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M1 1L9 5L1 9" fill="none" stroke="#9AA0AE" strokeWidth="1.8" strokeLinecap="round" />
        </marker>
        <marker id="mFx" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M1 1L9 5L1 9" fill="none" stroke="#F5A623" strokeWidth="2.2" strokeLinecap="round" />
        </marker>
      </defs>

      {/* the four stage bands */}
      <g>
        {STAGES.map((st, i) => {
          const inSt = P.filter((p) => p.stage === i);
          if (!inSt.length) return null;
          const x1 = Math.min(...inSt.map((p) => p.cx)) - R - 34;
          const x2 = Math.max(...inSt.map((p) => p.cx)) + R + 34;
          const done = inSt.filter((p) => p.status === 'complete').length;
          return (
            <g key={st.n}>
              <rect
                x={x1}
                y={20}
                width={x2 - x1}
                height={H - 40}
                rx={10}
                fill={cssv(`${st.c}-t`)}
                opacity={0.55}
                stroke={cssv(`${st.c}-l`)}
                strokeWidth={1}
              />
              <text x={x1 + 20} y={44} className="bandsub" fill={cssv(st.c)}>{st.sub}</text>
              <text x={x1 + 20} y={64} className="bandttl" fill={cssv(st.c)}>{st.n}</text>
              <text x={x2 - 20} y={64} textAnchor="end" className="bandcnt" fill={cssv(st.c)}>
                {`${done} of ${inSt.length} done`}
              </text>
            </g>
          );
        })}
      </g>

      {/* edges */}
      <g>
        {P.flatMap((p) => p.after.map((a) => {
          if (a.hide) return null; /* dependency without a drawn arrow */
          const s = BY[a.id];
          const ang = Math.atan2(p.cy - s.cy, p.cx - s.cx);
          const x1 = s.cx + Math.cos(ang) * (RING + 5);
          const y1 = s.cy + Math.sin(ang) * (RING + 5);
          const x2 = p.cx - Math.cos(ang) * (RING + 12);
          const y2 = p.cy - Math.sin(ang) * (RING + 12);
          const main = s.critical && p.critical;
          const on = lit(a.id) && lit(p.id);
          return (
            <path
              key={`${a.id}->${p.id}`}
              d={`M${x1} ${y1} L${x2} ${y2}`}
              className="edge"
              stroke={on ? cssv('--accent-500') : (main ? '#241157' : '#9AA0AE')}
              strokeWidth={on ? 3.2 : (main ? 2.4 : 1.6)}
              markerEnd={on ? 'url(#mFx)' : (main ? 'url(#mMain)' : 'url(#mSide)')}
            />
          );
        }))}
      </g>

      {/* nodes */}
      <g>
        {P.map((p) => <PhaseNode key={p.id} p={p} lit={lit(p.id)} />)}
      </g>

      {/* the milestone at the end of the spine */}
      <g>
        <rect x={LAST_X + 58} y={MID_Y - 32} width={130} height={64} rx={8} className="msr" />
        <text x={LAST_X + 123} y={MID_Y - 6} textAnchor="middle" className="mst">Doors open</text>
        <text x={LAST_X + 123} y={MID_Y + 13} textAnchor="middle" className="msd">{`day ${OPEN_DAY}`}</text>
      </g>
    </svg>
  );
});

export default PmsFlowDiagram;
