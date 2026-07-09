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

function SkCard({ children, h }) {
  return (
    <div className="card">
      <div className="card-head"><SkLine w={140} h={13} /></div>
      <div className="card-body">{children || <SkBlock h={h || 200} style={{ borderRadius: 8 }} />}</div>
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
        <SkCard h={240} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 'var(--space-5)' }} className="dash-split">
        <SkCard h={220} /><SkCard h={220} />
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
        <SkCard h={220} /><SkCard h={220} /><SkCard h={220} />
      </div>
      <SkCard h={280} />
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
        <SkCard h={260} /><SkCard h={260} />
      </div>
    </div>
  );
}
