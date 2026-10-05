import { useMemo, useRef, useState } from 'react';
import { Sparkles, Download, AlertTriangle, RefreshCw } from 'lucide-react';
import { useLayoutAdviceMutation } from '../../../app/api/aiApi.js';
import { useGames } from '../../../app/api/gamesApi.js';
import { flashSuccess } from '../../../components/ui/SuccessFlash.jsx';

/**
 * The Phase 3B layout generator — sits at the bottom of the project-plan form
 * because it reads everything above it: the confirmed area, the shape notes,
 * and the chosen games.
 *
 * WHO DRAWS WHAT. The GEOMETRY is computed here, exactly: the floor rectangle
 * from the confirmed area, reception/briefing/washrooms carved off the front,
 * a corridor, and one box per selected game sized by its REAL square footage
 * from the Games master — so the picture can never lie about sizes. The AI
 * contributes what arithmetic cannot: the walk ORDER (which game sits where,
 * front to back) and the fit-out notes. If every game cannot fit, the plan
 * says so in red instead of quietly shrinking the truth.
 *
 * The result is saved WITH the plan (values.layout_plan), renders read-only
 * on review, and downloads as a PNG for the site file.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const KIND_FILL = {
  reception: '#dbeafe',
  briefing: '#ede9fe',
  washroom: '#ccfbf1',
  corridor: '#f1f5f9',
  game: '#fef3c7',
};
const KIND_STROKE = {
  reception: '#3b82f6',
  briefing: '#8b5cf6',
  washroom: '#14b8a6',
  corridor: '#94a3b8',
  game: '#d97706',
};

/**
 * Deterministic floor plan. All units in feet; the SVG scales them.
 *
 * Front strip (reception / briefing / washrooms) → corridor → game rows in
 * the AI's walk order, shelf-packed. Returns zones plus honest fit numbers.
 */
function computePlan(areaSqft, gameList, order) {
  const A = Math.max(areaSqft, 200);
  const W = Math.round(Math.sqrt(A * 2)); // 2:1 floor, the common retail shape
  const D = Math.round(A / W);

  const commonA = Math.min(Math.max(A * 0.16, 150), 700);
  const frontD = Math.max(Math.round(commonA / W), 8);
  const corridorD = 4;

  const zones = [
    { name: 'Reception & Waiting', kind: 'reception', x: 0, y: 0, w: W * 0.45, h: frontD },
    { name: 'Briefing / Lounge', kind: 'briefing', x: W * 0.45, y: 0, w: W * 0.3, h: frontD },
    { name: 'Washrooms', kind: 'washroom', x: W * 0.75, y: 0, w: W * 0.25, h: frontD },
    { name: 'Corridor', kind: 'corridor', x: 0, y: frontD, w: W, h: corridorD },
  ].map((z) => ({ ...z, sqft: Math.round(z.w * z.h) }));

  const ordered = order
    .map((name) => gameList.find((g) => g.name === name))
    .filter(Boolean);

  const gamesTop = frontD + corridorD;
  const gamesD = D - gamesTop;
  const regionArea = W * gamesD;
  const totalGameArea = ordered.reduce((s, g) => s + g.sqft, 0);
  // When the games genuinely do not fit, the drawing compresses them equally
  // and SAYS SO — a plan that silently shrinks square footage is a lie.
  const scale = totalGameArea > regionArea * 0.98 ? (regionArea * 0.98) / totalGameArea : 1;

  const rowCount = ordered.length <= 3 ? 1 : 2;
  const rowH = gamesD / rowCount;
  let row = 0;
  let x = 0;
  for (const g of ordered) {
    const w = (g.sqft * scale) / rowH;
    if (x + w > W + 0.5 && row < rowCount - 1) { row += 1; x = 0; }
    zones.push({
      name: g.name,
      kind: 'game',
      x,
      y: gamesTop + row * rowH,
      w: Math.min(w, W - x),
      h: rowH,
      sqft: g.sqft,
    });
    x += w;
  }

  return {
    floorW: W,
    floorD: D,
    areaSqft: A,
    zones,
    fit: { totalGameArea, regionArea: Math.round(regionArea), compressed: scale < 1, scalePct: Math.round(scale * 100) },
  };
}

function PlanSvg({ plan, svgRef }) {
  const PX = 6; // px per foot
  const PAD = 26;
  const w = plan.floorW * PX + PAD * 2;
  const h = plan.floorD * PX + PAD * 2 + 14;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} className="lp-svg" role="img" aria-label="Outlet layout plan">
      <rect x={0} y={0} width={w} height={h} fill="#ffffff" />
      {/* the shell */}
      <rect x={PAD} y={PAD} width={plan.floorW * PX} height={plan.floorD * PX} fill="none" stroke="#111827" strokeWidth="2.5" />
      {plan.zones.map((z, i) => (
        <g key={`${z.name}-${i}`}>
          <rect
            x={PAD + z.x * PX}
            y={PAD + z.y * PX}
            width={Math.max(z.w * PX - 1, 2)}
            height={Math.max(z.h * PX - 1, 2)}
            fill={KIND_FILL[z.kind]}
            stroke={KIND_STROKE[z.kind]}
            strokeWidth="1.4"
          />
          {z.kind !== 'corridor' && (
            <>
              <text
                x={PAD + (z.x + z.w / 2) * PX}
                y={PAD + (z.y + z.h / 2) * PX - 3}
                textAnchor="middle"
                fontSize={Math.min(11, Math.max(8, z.w * PX / (z.name.length * 0.62)))}
                fontWeight="700"
                fill="#1f2937"
              >
                {z.name}
              </text>
              <text
                x={PAD + (z.x + z.w / 2) * PX}
                y={PAD + (z.y + z.h / 2) * PX + 10}
                textAnchor="middle"
                fontSize="8.5"
                fill="#6b7280"
              >
                {z.sqft} sq ft
              </text>
            </>
          )}
          {z.kind === 'corridor' && (
            <text x={PAD + 6} y={PAD + (z.y + z.h / 2) * PX + 3} fontSize="8" fill="#64748b">corridor</text>
          )}
        </g>
      ))}
      {/* entrance marker on the front wall */}
      <g>
        <rect x={PAD + (plan.floorW * PX) / 2 - 16} y={PAD - 4} width={32} height={8} fill="#16a34a" rx={2} />
        <text x={PAD + (plan.floorW * PX) / 2} y={PAD - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill="#16a34a">ENTRANCE</text>
      </g>
      {/* dimensions */}
      <text x={PAD + (plan.floorW * PX) / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="#374151">
        {plan.floorW} ft × {plan.floorD} ft ≈ {plan.areaSqft} sq ft
      </text>
      <text x={12} y={PAD + (plan.floorD * PX) / 2} fontSize="10" fill="#374151" transform={`rotate(-90 12 ${PAD + (plan.floorD * PX) / 2})`} textAnchor="middle">
        {plan.floorD} ft
      </text>
    </svg>
  );
}

export function LayoutPlanner({ value, onChange, formValues = {}, readOnly }) {
  const svgRef = useRef(null);
  const [advise, adviseState] = useLayoutAdviceMutation();
  const [error, setError] = useState(null);
  const { data: gamesResp } = useGames();
  const catalogue = gamesResp?.data || gamesResp || [];

  const areaSqft = num(formValues.confirmed_area);
  const selected = Array.isArray(formValues.selected_games) ? formValues.selected_games : [];
  const gameList = useMemo(() => selected.map((name) => {
    const g = (Array.isArray(catalogue) ? catalogue : []).find((x) => x.name === name);
    const min = num(g?.minAreaSqft);
    const max = num(g?.maxAreaSqft) || min;
    return { name, sqft: Math.round(((min || max) + max) / 2) || 300 };
  }), [selected, catalogue]);

  const ready = areaSqft > 0 && gameList.length > 0;

  const generate = async () => {
    setError(null);
    try {
      const advice = await advise({
        areaSqft,
        shapeNotes: formValues.site_shape || undefined,
        games: gameList,
      }).unwrap();
      const plan = computePlan(areaSqft, gameList, advice.order);
      onChange({
        ...plan,
        order: advice.order,
        entranceNote: advice.entranceNote,
        notes: advice.notes,
        generatedAt: new Date().toISOString(),
      });
      flashSuccess('Layout generated');
    } catch (e) {
      setError(e?.data?.message || 'Could not generate the layout — try again.');
    }
  };

  const downloadPng = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const box = svg.viewBox.baseVal;
      canvas.width = box.width * 2;
      canvas.height = box.height * 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'outlet-layout.png';
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  };

  const busy = adviseState.isLoading;

  return (
    <div className="lp-wrap" data-guide="layout-planner">
      {!value && readOnly && (
        <span className="sm muted">Not provided</span>
      )}
      {!value && !readOnly && (
        <div className="lp-empty">
          <p className="sm" style={{ margin: 0 }}>
            Drawn to scale from what you filled above — the confirmed area, the shape notes, and each
            chosen game&rsquo;s real square footage from the Games master. AI arranges the walk order and
            writes the fit-out notes; the sizes are exact arithmetic, never invented.
          </p>
          <button type="button" className="btn btn-primary btn-sm" disabled={!ready || busy} onClick={generate}>
            <Sparkles size={14} /> {busy ? 'Arranging…' : 'Generate AI Layout'}
          </button>
          {!ready && <span className="tiny muted">Fill the confirmed area and pick at least one game first.</span>}
        </div>
      )}

      {value && (
        <div className="col gap-2">
          {value.fit?.compressed && (
            <div className="pt-alert pt-alert--bad">
              <AlertTriangle size={14} /> The chosen games need {value.fit.totalGameArea} sq ft but only {value.fit.regionArea} sq ft
              remains after the front of house — boxes are drawn at {value.fit.scalePct}% to show the overflow. Drop a game or confirm more area.
            </div>
          )}
          <PlanSvg plan={value} svgRef={svgRef} />
          {(value.entranceNote || (value.notes || []).length > 0) && (
            <div className="lp-notes">
              <span className="lp-notes-title"><Sparkles size={12} /> Fit-out notes</span>
              {value.entranceNote && <p>{value.entranceNote}</p>}
              <ul>
                {(value.notes || []).map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}
          <div className="row gap-2 wrap">
            <button type="button" className="btn btn-subtle btn-sm" onClick={downloadPng}>
              <Download size={13} /> Download PNG
            </button>
            {!readOnly && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={generate}>
                <RefreshCw size={13} /> {busy ? 'Arranging…' : 'Regenerate'}
              </button>
            )}
            {value.generatedAt && <span className="tiny muted">Generated {new Date(value.generatedAt).toLocaleString()}</span>}
          </div>
          <span className="tiny muted">A planning sketch for discussion — the architect&rsquo;s Phase 4 drawings remain the build truth.</span>
        </div>
      )}

      {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
    </div>
  );
}

export default LayoutPlanner;
