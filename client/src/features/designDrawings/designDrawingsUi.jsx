import {
  FolderKanban, FileStack, CheckCircle2, Clock, Hourglass, AlertTriangle,
} from 'lucide-react';

/**
 * The Design & Drawings KPI strip — the six cards, and the card itself.
 *
 * Shared rather than declared on the dashboard, because the strip now appears
 * on two pages: the dashboard, and the breakdown page you reach by clicking
 * one of them. Defining the six in one place is what keeps a card's label, its
 * tint and the page it opens describing the same thing — the alternative is a
 * second copy that drifts the first time a label is reworded.
 */

const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0);

/**
 * `metric` is the server's own key (designDrawingsFms.service.js#FMS_METRICS),
 * so the card, its URL and the rows the breakdown counts are the same word all
 * the way down; an unknown one is a 400, not an empty page.
 */
export function kpiCards(t) {
  if (!t) return [];
  return [
    {
      metric: 'projects',
      icon: FolderKanban,
      tint: 'var(--p-gold)',
      value: t.projects,
      label: 'Total Projects',
      sub: 'All ongoing projects',
    },
    {
      metric: 'drawings',
      icon: FileStack,
      tint: 'var(--p-muted)',
      value: t.drawings,
      label: 'Total Drawings',
      sub: `${t.projects} × 37 checklist rows`,
    },
    {
      metric: 'submitted',
      icon: CheckCircle2,
      tint: 'var(--p-tag-captured-fg)',
      value: t.submitted,
      share: pct(t.submitted, t.drawings),
      label: 'Submitted',
      sub: 'On time submissions',
    },
    {
      metric: 'inProgress',
      icon: Clock,
      tint: 'var(--p-tag-wanted-fg)',
      value: t.inProgress,
      share: pct(t.inProgress, t.drawings),
      label: 'In Progress',
      sub: 'Being worked on',
    },
    {
      metric: 'pending',
      icon: Hourglass,
      tint: 'var(--p-muted)',
      value: t.pending,
      share: pct(t.pending, t.drawings),
      label: 'Pending',
      sub: 'Not yet submitted',
    },
    {
      metric: 'delayed',
      icon: AlertTriangle,
      tint: 'var(--danger)',
      value: t.delayed,
      share: pct(t.delayed, t.drawings),
      label: 'Delayed',
      sub: 'Past planned date',
    },
  ];
}

/**
 * One KPI card.
 *
 * `share` turns the four status cards into a share of the total — the number
 * alone doesn't say whether 1,030 is most of them. A card without one still
 * reserves the bar's height (`.dd-stat-sub` sits at the bottom of a stretched
 * card), so the row reads as six of one thing rather than four and two.
 *
 * `onOpen` makes the card a button rather than a div. Every card counts rows
 * somebody will want to see, and the count on its own is the one thing that
 * cannot answer "which ones?".
 */
export function StatCard({
  icon: Icon, tint, value, share, label, sub, onOpen, active,
}) {
  const inner = (
    <>
      <div className="dd-stat-top">
        <span className="dd-stat-label">{label}</span>
        <span className="dd-stat-icon" style={{ background: `color-mix(in srgb, ${tint} 13%, transparent)`, color: tint }}>
          <Icon size={15} />
        </span>
      </div>
      <div className="dd-stat-row">
        <b className="dd-stat-value">{Number(value).toLocaleString('en-IN')}</b>
        {share != null && <span className="dd-stat-share" style={{ color: tint }}>{share}%</span>}
      </div>
      {share != null && (
        <span className="dd-stat-track"><i style={{ width: `${share}%`, background: tint }} /></span>
      )}
      <div className="dd-stat-sub">{sub}</div>
    </>
  );

  if (!onOpen) return <div className="dd-card dd-stat">{inner}</div>;
  return (
    <button
      type="button"
      className={`dd-card dd-stat dd-stat-open${active ? ' is-active' : ''}`}
      style={active ? { borderColor: tint } : undefined}
      onClick={onOpen}
      title={`See the ${Number(value).toLocaleString('en-IN')} behind "${label}"`}
    >
      {inner}
    </button>
  );
}

export default StatCard;
