/**
 * Layout-aware skeletons — they mirror the shape of the content that's loading
 * so the page doesn't jump when data arrives.
 */

export function SkLine({ w = '100%', h = 12, style }) {
  return <div className="sk sk-line" style={{ width: w, height: h, ...style }} />;
}
export function SkCircle({ size = 36 }) {
  return <div className="sk sk-circle" style={{ width: size, height: size }} />;
}
export function SkBlock({ h = 120, style }) {
  return <div className="sk" style={{ height: h, borderRadius: 14, ...style }} />;
}

/* ---------------- Reusable composable primitives ----------------
 * Every skeleton in the app is built from these seven pieces, all of which
 * ultimately render `.sk` (the shimmering block) — one shimmer implementation,
 * reused everywhere, never redefined per-page.
 */

/** A line of placeholder text — e.g. a label, a title, a table-cell value. */
export const SkeletonText = SkLine;
/** A circular placeholder — user/avatar initials. */
export const SkeletonAvatar = SkCircle;

/** One labelled form field: a short label line above an input-height block. */
export function SkeletonInput({ labelW = '35%' }) {
  return (
    <div className="col gap-2">
      <SkLine w={labelW} h={11} />
      <SkBlock h={38} style={{ borderRadius: 8 }} />
    </div>
  );
}

/** One horizontal row of independently-sized cells — the building block of SkeletonTable. */
export function SkeletonRow({ cells = [80, '100%', 60, 60, 90], h = 12 }) {
  return (
    <div className="row gap-4" style={{ alignItems: 'center' }}>
      {cells.map((w, i) => <SkLine key={i} w={w} h={h} />)}
    </div>
  );
}

/** A titled card with either custom children or a generic body block. */
export function SkeletonCard({ title = true, titleW = 140, h = 200, children }) {
  return (
    <div className="card">
      {title && <div className="card-head"><SkLine w={titleW} h={13} /></div>}
      <div className="card-body">{children || <SkBlock h={h} style={{ borderRadius: 8 }} />}</div>
    </div>
  );
}

/**
 * A table skeleton: a shimmering header + N body rows, columns proportioned by
 * `columns` (relative flex-basis strings, e.g. ['5%','25%','15%',…]). Generic —
 * reusable for any data table in the app, not just Property Records.
 */
export function SkeletonTable({ columns = ['8%', '26%', '14%', '14%', '12%', '12%', '14%'], rows = 5 }) {
  const cellStyle = (w) => ({ flex: `0 0 ${w}`, minWidth: 0 });
  return (
    <div className="col gap-0" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div className="row gap-4" style={{ padding: '10px var(--space-4)', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        {columns.map((w, i) => <div key={i} style={cellStyle(w)}><SkLine h={10} w="60%" /></div>)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="row gap-4"
          style={{ padding: '14px var(--space-4)', borderBottom: r < rows - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}
        >
          {columns.map((w, i) => <div key={i} style={cellStyle(w)}><SkLine h={12} w={i === 0 ? '40%' : '75%'} /></div>)}
        </div>
      ))}
    </div>
  );
}

/** A grid of label+value tiles — mirrors the InfoTile grids used across stage/property pages. */
export function SkeletonTileGrid({ count = 6 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div className="col gap-2" key={i}>
          <SkLine w="55%" h={10} />
          <SkLine w="80%" h={14} />
        </div>
      ))}
    </div>
  );
}

/** One activity-feed row: avatar + two lines. Reused by every Activity Timeline in the app. */
export function SkeletonActivityRow() {
  return (
    <div className="row gap-3">
      <SkCircle size={28} />
      <div className="col grow gap-2">
        <SkLine w="65%" h={12} />
        <SkLine w="30%" h={10} />
      </div>
    </div>
  );
}

export function SkeletonActivity({ rows = 4 }) {
  return (
    <div className="col gap-4">
      {Array.from({ length: rows }).map((_, i) => <SkeletonActivityRow key={i} />)}
    </div>
  );
}

/**
 * A full form skeleton: repeated (section title → labelled fields) groups, an
 * upload-area block, a notes block, and skeleton action buttons — mirrors
 * RecordFormModal's section-grouped layout so the modal never flashes empty.
 */
export function SkeletonForm({ sections = 3, fieldsPerSection = 3 }) {
  return (
    <div className="col gap-5">
      {Array.from({ length: sections }).map((_, s) => (
        <div className="col gap-3" key={s}>
          <SkLine w={150} h={12} />
          <div className="form-grid">
            {Array.from({ length: fieldsPerSection }).map((_, f) => <SkeletonInput key={f} />)}
          </div>
        </div>
      ))}
      <div className="col gap-3">
        <SkLine w={110} h={12} />
        <SkBlock h={64} style={{ borderRadius: 8 }} />
      </div>
      <div className="col gap-3">
        <SkLine w={100} h={12} />
        <SkBlock h={72} style={{ borderRadius: 8 }} />
      </div>
      <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
        <SkLine w={100} h={34} style={{ borderRadius: 8 }} />
        <SkLine w={90} h={34} style={{ borderRadius: 8 }} />
      </div>
    </div>
  );
}

export function SkStatGrid({ count = 4 }) {
  return (
    <div className="stat-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="stat" key={i}>
          <div className="stat-top">
            <div className="stat-head"><SkCircle size={30} /><SkLine w="46%" h={11} /></div>
            <SkLine w="42%" h={24} />
          </div>
          <SkBlock h={48} style={{ marginTop: 12, borderRadius: 0 }} />
        </div>
      ))}
    </div>
  );
}

export function SkDashboard() {
  return (
    <div className="col gap-5 content-narrow">
      <SkStatGrid />
      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 'var(--space-5)' }} className="dash-split">
        <div className="card">
          <div className="card-head"><SkLine w={150} h={13} /></div>
          <div className="card-body col gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="row gap-4" key={i}>
                <SkLine w={20} h={12} />
                <div className="col grow gap-2"><SkLine w="45%" h={11} /><SkLine w="70%" h={13} /></div>
                <SkLine w={130} h={8} />
                <SkCircle size={30} />
              </div>
            ))}
          </div>
        </div>
        <SkeletonCard h={240} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 'var(--space-5)' }} className="dash-split">
        <SkeletonCard h={220} /><SkeletonCard h={220} />
      </div>
    </div>
  );
}

export function SkTable({ rows = 6 }) {
  return (
    <div className="card">
      <div className="card-body col gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="row gap-4" key={i}>
            <div className="col grow gap-2"><SkLine w="30%" h={10} /><SkLine w="55%" h={13} /></div>
            <SkLine w={70} h={20} style={{ borderRadius: 99 }} />
            <SkLine w={70} h={20} style={{ borderRadius: 99 }} />
            <SkLine w={120} h={8} />
            <SkCircle size={30} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkBoard({ cols = 5 }) {
  return (
    <div className="board">
      {Array.from({ length: cols }).map((_, c) => (
        <div className="board-col" key={c}>
          <div className="board-col-head"><SkLine w={90} h={12} /></div>
          {Array.from({ length: 3 - (c % 2) }).map((_, i) => (
            <div className="task-card" key={i} style={{ cursor: 'default' }}>
              <SkLine w="40%" h={10} />
              <SkLine w="85%" h={13} style={{ marginTop: 10 }} />
              <div className="row between" style={{ marginTop: 14 }}><SkLine w={50} h={10} /><SkCircle size={22} /></div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkCharts() {
  return (
    <div className="col gap-5 content-narrow">
      <SkStatGrid />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-5)' }} className="dash-split">
        <SkeletonCard h={220} /><SkeletonCard h={220} /><SkeletonCard h={220} />
      </div>
      <SkeletonCard h={280} />
    </div>
  );
}

export function SkDetail() {
  return (
    <div className="col gap-5 content-narrow">
      <div className="card card-pad">
        <div className="row gap-4"><SkCircle size={72} /><div className="col gap-3 grow"><SkLine w={180} h={20} /><SkLine w={240} h={12} /></div></div>
        <SkBlock h={40} style={{ marginTop: 20, borderRadius: 8 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 'var(--space-5)' }} className="dash-split">
        <SkeletonCard h={260} /><SkeletonCard h={260} />
      </div>
    </div>
  );
}

/**
 * Property Identification dashboard — Stage Overview, Task Assignment, the
 * search bar + Property Records table, and the Activity Timeline, all
 * shimmering in the exact section order the real page renders them in.
 */
export function SkPropertyIdentification() {
  return (
    <div className="col gap-5 content-narrow">
      <SkeletonCard title={false}><SkeletonTileGrid count={6} /></SkeletonCard>
      <SkeletonCard title={false}><SkeletonTileGrid count={6} /></SkeletonCard>
      <SkeletonCard title={false}>
        <div className="col gap-4">
          <div className="row gap-3">
            <SkBlock h={38} style={{ flex: 1, borderRadius: 8 }} />
            <SkBlock h={38} style={{ width: 160, borderRadius: 8 }} />
          </div>
          <SkeletonTable
            columns={['6%', '20%', '12%', '12%', '10%', '12%', '12%', '12%', '12%', '12%']}
            rows={5}
          />
        </div>
      </SkeletonCard>
      <SkeletonCard title={false}><SkeletonActivity rows={4} /></SkeletonCard>
    </div>
  );
}

/**
 * Property Detail page — header, audit tiles, the schema-driven section cards,
 * and the Activity Timeline.
 */
export function SkPropertyDetail() {
  return (
    <div className="col gap-5 content-narrow">
      <div className="card card-pad row between">
        <SkLine w={140} h={18} />
        <SkBlock h={32} style={{ width: 200, borderRadius: 8 }} />
      </div>
      <SkeletonCard title={false}><SkeletonTileGrid count={5} /></SkeletonCard>
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} title={false}><SkeletonTileGrid count={4} /></SkeletonCard>
      ))}
      <SkeletonCard title={false}><SkeletonActivity rows={3} /></SkeletonCard>
    </div>
  );
}
