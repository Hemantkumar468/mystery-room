import { STAGES, TODAY_DAY, cssv, who, stampAt } from './pmsFlowData.js';

/**
 * The hover card.
 *
 * It answers four questions and nothing else: who the phase is assigned to,
 * who did it, who approved it, and when each of those happened.
 *
 * A phase that has not opened has nobody who has done it, and saying so is the
 * point — a name there would be a lie the dashboard repeats every time you
 * look at it. The one exception is a phase marked complete with no actual
 * window recorded: it falls back to its planned dates rather than claiming
 * nobody finished it.
 *
 * Returns a markup string. The card is small, the markup is entirely built
 * here from trusted constants, and returning a string is what lets the page
 * skip a re-render when the pointer moves inside one phase.
 */
export function tipHTML(p) {
  const col = cssv(STAGES[p.stage].c);
  let a = p.act;
  if (p.status === 'complete' && (!a || a.e == null)) a = { s: p.es, e: p.ef };

  function line(k, when, late) {
    const w = who(k);
    return '<div class="pr">'
      + `<b>${w.n}</b><span class="ro">${w.r}</span>`
      + `<em${late ? ' class="lt"' : ''}>${when}</em></div>`;
  }

  let done;
  let appr;
  if (p.status === 'complete' && a) {
    const took = a.e - a.s;
    const dv = took - p.sla;
    done = line(p.team.did, `finished ${stampAt(p, a.e, 2)}`
      + ` · took ${took} of ${p.sla} days${dv > 0 ? ` (+${dv})` : dv < 0 ? ` (${dv})` : ''}`, dv > 0);
    appr = line(p.team.sg, `signed ${stampAt(p, a.e, 3)}`);
  } else if (p.status === 'processing' && a) {
    const inN = TODAY_DAY - a.s;
    const over = TODAY_DAY - p.ef;
    done = line(p.team.did, `started ${stampAt(p, a.s, 1)}`
      + (over > 0 ? ` · still working, ${over} days past its ${p.sla}-day window`
        : ` · day ${inN} of ${p.sla}, still working`), over > 0);
    appr = `<div class="pr"><b>${who(p.team.sg).n}</b><span class="ro">${who(p.team.sg).r}`
      + '</span><em class="lt">not signed yet</em></div>';
  } else {
    done = `<div class="pr"><span class="ro">nobody yet — opens day ${p.es}</span></div>`;
    appr = `<div class="pr"><b>${who(p.team.sg).n}</b><span class="ro">${who(p.team.sg).r}`
      + '</span><em>waiting</em></div>';
  }

  return `<h4 style="color:${col}">${p.no} · ${p.name}</h4>`
    + `<p class="lb">Assigned to</p>${line(p.team.as, `assigned ${stampAt(p, p.es, 0)}`)}`
    + `<p class="lb">Done by</p>${done}`
    + `<p class="lb">Approved by</p>${appr}`;
}

export default tipHTML;
