import { Gamepad2, CalendarDays, Ruler, Wallet, UserCog, StickyNote } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { fmtDate } from './propertyUi.jsx';

/**
 * WHAT THE PROJECT PLAN SAYS, on one short screen.
 *
 * Step 7's View used to open the property's CAPTURE report — the whole
 * intake sheet, which is the right report for Step 1 and the wrong one here.
 * The question on this step is not "what is this site?" but "what was
 * planned for it?": which games, how big, and the four dates the build runs
 * to. None of that was readable without scrolling a twenty-column sheet
 * sideways, and those columns have now gone.
 *
 * SHORT ON PURPOSE. Every field here is one the plan form asks for, and only
 * the ones it asks for. A plan nobody has filed shows one sentence rather
 * than a screen of dashes — "nothing yet" is a fact worth stating plainly,
 * not something to be inferred from twelve empty rows.
 */

const money = (v) => (Number(v) ? `₹${Number(v).toLocaleString('en-IN')}` : null);
const sqft = (v) => (Number(v) ? `${Number(v).toLocaleString('en-IN')} sq ft` : null);

function Line({ icon: Icon, label, value, sub }) {
  return (
    <div className="plan-line">
      <span className="plan-line-ic" aria-hidden><Icon size={14} /></span>
      <span className="plan-line-body">
        <span className="plan-line-label">{label}</span>
        <span className={`plan-line-value${value ? '' : ' is-empty'}`}>{value || 'Not set'}</span>
        {sub && <span className="plan-line-sub">{sub}</span>}
      </span>
    </div>
  );
}

export function PlanSummaryModal({ row, onClose, onEdit }) {
  if (!row) return null;
  const plan = row.plan || null;
  const games = plan?.games || [];
  const gameCount = plan?.gameCount ?? games.length;

  /* Filed means somebody committed to it. A draft the system opened when the
     LOI was approved is not a plan; it is an empty form waiting for one. */
  const filed = ['submitted', 'approved', 'locked'].includes(plan?.status);

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title || 'Project plan'}
      /* DEDUPED, case-insensitively: a property in 'Amritsar' whose locality
         is 'amritsar' printed 'Amritsar · amritsar', which reads as two
         places and is really one typed twice. */
      subtitle={[...new Map(
        [row.city, row.locality].filter(Boolean).map((v) => [v.trim().toLowerCase(), v]),
      ).values()].join(' · ') || 'Project plan'}
      width={780}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span className="tiny muted">
            {filed
              ? `Filed${plan?.by ? ` by ${plan.by}` : ''}${plan?.at ? ` on ${fmtDate(plan.at)}` : ''}`
              : 'Nothing filed yet'}
          </span>
          <span className="row gap-2">
            {onEdit && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onEdit(row)}>
                {filed ? 'Edit project' : 'Create project'}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          </span>
        </div>
      )}
    >
      <div className="plan-sum">
        {/* The project this property became, if it became one. */}
        <div className="plan-head">
          <div className="col gap-1" style={{ minWidth: 0 }}>
            <span className="plan-head-label">Project</span>
            <span className="plan-head-value">{row.projectName || 'Not created yet'}</span>
          </div>
          <span className={`plan-pill ${filed ? 'is-on' : 'is-off'}`}>
            {filed ? 'Plan filed' : 'Plan not filed'}
          </span>
        </div>

        {!filed ? (
          /* ONE SENTENCE, NOT TWELVE DASHES. */
          <p className="plan-none">
            No plan has been filed for this property yet. Use
            {' '}<b>{row.projectName ? 'Edit project' : 'Create project'}</b>{' '}
            to choose the games and fix the construction, handover, opening and
            trial dates — that is what creates the project.
          </p>
        ) : (
          <>
            <section className="plan-sec">
              <h4 className="plan-sec-title">
                <Gamepad2 size={13} aria-hidden />
                Games selected
                {gameCount ? <span className="plan-sec-count">{gameCount}</span> : null}
              </h4>
            <div className="plan-games">
              <span className="plan-line-body">
                {games.length ? (
                  <span className="plan-chips">
                    {games.map((g) => (
                      <span className="plan-chip" key={g.id || g._id || g.name || g}>
                        {g.name || g.title || String(g)}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="plan-line-value is-empty">
                    {gameCount ? `${gameCount} chosen` : 'None chosen'}
                  </span>
                )}
              </span>
            </div>
            </section>

            {/* THE FOUR DATES THE BUILD RUNS TO, in the order they happen —
                which is the order anybody reads them in, and not the order
                the form happens to ask for them. */}
            {/* GROUPED, AND THE GROUPS ARE HEADINGS. Eight facts in one flat
                grid made the reader work out for themselves that four of
                them are dates and three are money. Saying so costs two
                lines and removes the sorting. */}
            <section className="plan-sec">
              <h4 className="plan-sec-title"><CalendarDays size={13} aria-hidden /> Schedule</h4>
              <div className="plan-grid">
                <Line icon={CalendarDays} label="Construction starts" value={fmtDate(plan?.constructionStart)} />
                <Line icon={CalendarDays} label="Handover" value={fmtDate(plan?.handoverDate)} />
                <Line icon={CalendarDays} label="Trial run" value={fmtDate(plan?.trialDate)} />
                <Line icon={CalendarDays} label="Opening" value={fmtDate(plan?.openingDate)} />
              </div>
            </section>

            <section className="plan-sec">
              <h4 className="plan-sec-title"><Wallet size={13} aria-hidden /> Size &amp; cost</h4>
              <div className="plan-grid">
                <Line icon={Ruler} label="Confirmed area" value={sqft(plan?.confirmedArea)} sub={row.areaSqft ? `captured at ${sqft(row.areaSqft)}` : null} />
                <Line icon={Wallet} label="Setup budget" value={money(plan?.setupCost)} />
                <Line icon={Wallet} label="Monthly running" value={money(plan?.monthlyCost)} />
                <Line icon={UserCog} label="Project manager" value={plan?.manager || plan?.projectManager || null} />
              </div>
            </section>

            {plan?.remarks && (
              <div className="plan-notes">
                <span className="plan-line-ic" aria-hidden><StickyNote size={14} /></span>
                <span className="plan-line-body">
                  <span className="plan-line-label">Notes</span>
                  <span className="plan-line-value">{plan.remarks}</span>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export default PlanSummaryModal;
