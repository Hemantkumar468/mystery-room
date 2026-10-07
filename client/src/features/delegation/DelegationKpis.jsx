import {
  ChevronRight, Send, CalendarDays, Hourglass, AlertTriangle,
  PlayCircle, CheckCircle2, ShieldCheck, Gauge,
} from 'lucide-react';
import { SCORE_WEIGHT } from '../tasks/taskScoring.js';

/**
 * THE EIGHT CARDS, DEFINED ONCE FOR EVERY DELEGATION VIEW.
 *
 * My Work, Delegated by me, In the loop and All tasks each used to carry
 * their own hand-written set — five cards on one, three on another, with
 * different names for the same number ("All pending" / "Pending", "All tasks
 * assigned" / "Delegated by me"). Nobody could compare two screens, because
 * no two screens counted the same things.
 *
 * So the set is one list and the SCOPE is the only thing that differs: the
 * server already counts within whatever filter the view is asking under
 * (delegation.service#list builds `meta.counts` from the same base filter as
 * the rows), so "Overdue" on In the loop means overdue in your loop, and on
 * All tasks it means overdue across everything that person is allowed to
 * see. An MD who can see the company sees the company's totals here; a doer
 * sees their own. That is the access model doing its job, not a second rule.
 *
 * EVERY CARD IS A DRILL-DOWN. A number nobody can open is a number nobody
 * can act on — pressing one lists exactly the tasks behind it, counted in
 * the same scope, so the card and the list can never disagree.
 */

/**
 * YOUR SCORE, FROM THE SAME FORMULA MY TASKS USES.
 *
 * Deliberately not a second scoring system. `taskScoring.js` already defines
 * what late work costs, and two scores on two screens that disagree about
 * the same person is worse than no score at all — so the weights are
 * imported rather than restated, and only the SOURCE differs: My Tasks adds
 * up a list it holds, this adds up the counts the server returned for a
 * scope that may be thousands of rows.
 *
 * It only ever deducts from 100. Work finished on time costs nothing;
 * everything else is measured against it.
 *
 * WHERE THE BUCKETS COME FROM, and the one judgement call: `dependent` and
 * `blocked` are counted as started-but-not-moving rather than as never
 * started. Somebody waiting on another team has done their part, and
 * charging them the full not-started penalty would score the business's
 * bottleneck against the person stuck behind it.
 */
export function scoreFromCounts(counts = {}) {
  const n = (k) => Number(counts[k]) || 0;
  const total = n('all');
  if (!total) return { score: null, total: 0, onTime: 0, late: 0, overdue: 0 };

  const onTime = n('on_time');
  const late = n('completed_late');
  const overdue = n('overdue');
  const inProgress = n('in_progress') + n('dependent') + n('blocked');
  const notStarted = n('pending') + n('accepted');

  const penalty = inProgress * SCORE_WEIGHT.inProgress
    + notStarted * SCORE_WEIGHT.notStarted
    + late * SCORE_WEIGHT.late
    + overdue * SCORE_WEIGHT.overdue;
  const average = Math.round(penalty / total);

  return {
    score: average ? -average : 0, total, onTime, late, overdue,
  };
}

/**
 * The eight, in reading order: how much there is, what is due, what is
 * owed, what is late — then what is moving, what is finished, how much of
 * it was on time, and what that adds up to.
 */
export const DELEGATION_CARDS = [
  {
    key: 'all',
    label: 'Total task',
    icon: Send,
    color: '#2563eb',
    desc: 'Every task in this view, whatever its status.',
  },
  {
    key: 'due_today',
    label: 'Due today',
    icon: CalendarDays,
    color: '#d97706',
    desc: 'Open tasks whose due date is today.',
    empty: 'nothing due today',
  },
  {
    key: 'incomplete',
    label: 'Pending',
    icon: Hourglass,
    color: '#8b5cf6',
    desc: 'Not finished yet — including work submitted and waiting on approval.',
  },
  {
    key: 'overdue',
    label: 'Overdue',
    icon: AlertTriangle,
    color: '#dc2626',
    desc: 'Past the due date and still open.',
  },
  {
    key: 'in_progress',
    label: 'In progress',
    icon: PlayCircle,
    color: '#4f46e5',
    desc: 'Accepted and actively being worked on.',
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: CheckCircle2,
    color: '#16a34a',
    desc: 'Finished and approved.',
  },
  {
    key: 'on_time',
    label: 'On time',
    icon: ShieldCheck,
    color: '#0d9488',
    desc: 'Completed on or before the due date.',
  },
  {
    key: 'score',
    label: 'Your score',
    icon: Gauge,
    color: '#7c3aed',
    /* Not a status, so it has no list behind it — see the guard in the
       component. The formula is on the tile instead, because a score
       nobody can check is a score nobody trusts. */
    desc: null,
  },
];

/**
 * THE TILE IS A FIGURE AND NOTHING ELSE.
 *
 * It used to carry a gloss beside the number — "1 on time · 0 late · 0
 * overdue" under the score, "nothing due today" under a zero. At 140px
 * wide, folded eight to a row, that text ran out past the card's own
 * border. Three numbers crammed into a tile that already shows one number
 * is a summary of a summary, and it was the thing that broke the layout.
 *
 * So: icon, label, figure. Everything the gloss used to say now lives in
 * the TOOLTIP, which has room for a sentence and does not have to fit.
 */
function Card({
  card, value, title, active, onClick,
}) {
  const Icon = card.icon;
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      className={`dkpi${clickable ? ' is-clickable' : ''}${active ? ' is-active' : ''}`}
      style={{ '--dkpi': card.color }}
      onClick={onClick}
      disabled={!clickable}
      title={title}
      aria-pressed={clickable ? Boolean(active) : undefined}
    >
      <span className="dkpi-top">
        <span className="dkpi-icon" aria-hidden><Icon size={17} /></span>
        {clickable && <ChevronRight size={15} className="dkpi-go" aria-hidden />}
      </span>
      <span className="dkpi-label">{card.label}</span>
      <span className="dkpi-value tabular">{value}</span>
    </button>
  );
}

/**
 * @param {object} counts  `meta.counts` from the delegation list endpoint.
 * @param {boolean} ready  false while the first request is in flight — the
 *                         cards show a dash rather than a confident zero,
 *                         because "0 overdue" and "not loaded yet" are very
 *                         different things to read at a glance.
 * @param {string} active  the status the list below is currently filtered to,
 *                         so the card that caused it can show as pressed.
 * @param {function} onSelect (statusKey) — FILTERS THE TABLE BELOW.
 *
 * PRESSING A CARD FILTERS THE LIST; it does not open a drawer over it. The
 * drawer was a second surface showing the same rows the table was about to
 * show anyway, so the card and the table disagreed about what you were
 * looking at until you dismissed one of them. Now "Pending 6" puts the list
 * on Pending and lights up the matching status tab, and pressing it again
 * clears back to everything — which is what a filter chip does everywhere
 * else in the product.
 */
export function DelegationKpis({
  counts = {}, ready = true, active = 'all', onSelect,
}) {
  const scoring = scoreFromCounts(counts);

  return (
    <div className="dkpi-row">
      {DELEGATION_CARDS.map((card) => {
        /* THE SCORE IS NOT A FILTER. There is no "score" status to narrow
           the list to, so it stays a read-out — and its tooltip carries the
           whole formula, because a score nobody can check is a score nobody
           trusts. */
        if (card.key === 'score') {
          const has = ready && scoring.score !== null;
          return (
            <Card
              key={card.key}
              card={card}
              value={has ? `${scoring.score}%` : '—'}
              title={has
                ? [
                  'YOUR SCORE — starts at 100% and only ever comes down.',
                  '',
                  `Each task costs points while it is not finished on time:`,
                  `· in progress      −${SCORE_WEIGHT.inProgress}`,
                  `· not started      −${SCORE_WEIGHT.notStarted}`,
                  `· completed late   −${SCORE_WEIGHT.late}`,
                  `· overdue          −${SCORE_WEIGHT.overdue}`,
                  'Finished on time costs nothing.',
                  '',
                  `Right now: ${scoring.onTime} on time, ${scoring.late} late, ${scoring.overdue} overdue.`,
                  `Total points off ÷ ${scoring.total} task${scoring.total === 1 ? '' : 's'} = ${scoring.score}%.`,
                  '',
                  'The same formula My Tasks uses.',
                ].join('\n')
                : 'No tasks in this view yet, so there is nothing to score.'}
            />
          );
        }

        const value = ready ? (Number(counts[card.key]) || 0) : '—';
        const isZero = ready && value === 0;
        const isOn = active === card.key;

        /* Every tile explains itself, and says what pressing it will do —
           the one thing a number on a dashboard can never say by itself. */
        const tip = [
          `${card.label.toUpperCase()} — ${card.desc}`,
          ready ? '' : null,
          ready
            ? (isZero
              ? (card.empty ? `There are none — ${card.empty}.` : 'There are none in this view.')
              : (isOn
                ? `Showing these ${value} below. Press again to show everything.`
                : `Press to show only these ${value} in the list below.`))
            : null,
        ].filter((l) => l !== null).join('\n');

        return (
          <Card
            key={card.key}
            card={card}
            value={value}
            title={tip}
            active={isOn}
            /* A zero filters to an empty table, which is a dead end the card
               can already predict — so it is not a button. */
            onClick={isZero || !ready || !onSelect
              ? undefined
              : () => onSelect(isOn ? 'all' : card.key)}
          />
        );
      })}
    </div>
  );
}

export default DelegationKpis;
