import {
  P, BY, PAIRS, STAGES, SEQ, DAYS, OPEN_DAY, TODAY_DAY,
  DRAW, SET1, SET2, SET1_DONE, BOQS, STREAMS, FIXES, RULES, BUILD, QS,
  cssv, who, stampAt, clockOf,
} from './pmsFlowData.js';

/**
 * "The specs, as data" — the seven tabs below the board.
 *
 * Every table here is a straight read of the constants in pmsFlowData.js, so a
 * figure quoted in a row and the same figure drawn on a circle can never drift
 * apart. Rows that belong to a phase carry `data-go`; the page delegates hover
 * and click from the wrapper, which is why no handler is passed down.
 *
 * Only the phase table moves on its own — its "Time left" column re-reads the
 * clock on the `now` prop's tick. Everything else is static, so the tabs are
 * built once in the page and memoised.
 */

/* the prototype's td() helper — some cells are markup from the spec text, and
   those are the ones that come in through `html` */
function Td({ cls, html, children }) {
  if (html != null) return <td className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
  return <td className={cls}>{children}</td>;
}

function personCell(k, when) {
  const w = who(k);
  return (
    <>
      <b>{w.n}</b>
      <small>
        {w.r}
        {when ? <><br />{when}</> : null}
      </small>
    </>
  );
}

/* ---------------------------------------------------------------- who did it */
export function WhoTable() {
  return (
    <div className="panel">
      <h3>Who did it, and when</h3>
      <p className="s2">
        Three different questions with three different answers. The person a phase is
        {' '}<b>assigned to</b> owns it; the person who <b>did</b> it is often somebody else — the drawings are
        assigned to the Project Manager but drawn by Studio Vibhor; the person who <b>approved</b> it is a
        third name again. Every one carries its own stamp.
      </p>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th className="r">#</th><th>Phase</th><th>Assigned to</th><th>Done by</th>
              <th>Approved by</th><th className="r">Planned</th><th className="r">Actual</th><th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {P.map((p) => {
              const a = p.act;
              const col = cssv(STAGES[p.stage].c);
              let doneCell; let actual; let variance;
              if (p.status === 'complete' && a && a.e != null) {
                const took = a.e - a.s;
                const dv = took - p.sla;
                doneCell = personCell(p.team.did, `finished ${stampAt(p, a.e, 2)}`);
                actual = `${took}d`;
                variance = dv === 0 ? <span className="pill ok">on target</span>
                  : dv < 0 ? <span className="pill ok">{`${Math.abs(dv)}d early`}</span>
                    : <span className="pill dan">{`+${dv}d over`}</span>;
              } else if (p.status === 'processing' && a) {
                const over = TODAY_DAY - p.ef;
                doneCell = personCell(p.team.did, `started ${stampAt(p, a.s, 1)}`);
                actual = `${TODAY_DAY - a.s}d so far`;
                variance = over > 0 ? <span className="pill dan">{`${over}d past target`}</span>
                  : <span className="pill warn">running</span>;
              } else {
                doneCell = <span style={{ color: 'var(--ink-400)' }}>nobody yet</span>;
                actual = '—';
                variance = <span className="pill grey">not started</span>;
              }
              const appr = (p.status === 'complete' && a && a.e != null)
                ? personCell(p.team.sg, `signed ${stampAt(p, a.e, 3)}`)
                : personCell(p.team.sg, 'not yet signed');
              return (
                <tr key={p.id} data-go={p.id}>
                  <Td cls="r">{p.no}</Td>
                  <Td cls="nme"><b style={{ color: col }}>{p.name}</b></Td>
                  <Td cls="nme">{personCell(p.team.as, `assigned ${stampAt(p, p.es, 0)}`)}</Td>
                  <Td cls="nme">{doneCell}</Td>
                  <Td cls="nme">{appr}</Td>
                  <Td cls="r">{`${p.sla}d`}</Td>
                  <Td cls="r">{actual}</Td>
                  <Td>{variance}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the phase list */
export function PhasesTable() {
  return (
    <div className="panel">
      <h3>The phases</h3>
      <p className="s2">
        Letter suffixes are gone — 3B and 4B become plain numbers. <b>The keys do not change</b>
        {' '}(<span className="mono">p20</span> still sits fourth, <span className="mono">p6</span> tenth), so every
        existing form, approval rule and saved project keeps working. Users read names; the key is internal.
      </p>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Phase</th><th>Key</th><th>Was</th><th>Owner</th>
              <th className="r">Days</th><th>Day span</th><th className="r">Time left</th>
              <th>Runs with</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {P.map((p) => {
              const col = cssv(STAGES[p.stage].c);
              const pair = p.pair ? PAIRS.filter((x) => x.n === p.pair)[0] : null;
              const runs = pair
                ? <span className="pill warn">{`‖ ${BY[pair.ids.filter((i) => i !== p.id)[0]].name}`}</span>
                : <span style={{ color: 'var(--ink-400)' }}>—</span>;
              const st = p.status === 'complete' ? <span className="pill ok">complete</span>
                : p.status === 'processing' ? <span className="pill warn">{`${p.pct}% running`}</span>
                  : <span className="pill grey">not started</span>;
              const c = clockOf(p);
              return (
                <tr key={p.id} data-go={p.id}>
                  <Td><b>{p.no}</b></Td>
                  <Td cls="nme">
                    <b style={{ color: col }}>{p.name}</b>
                    {p.gate ? <> <span className="pill vio">{p.gate.n}</span></> : null}
                    {p.isNew ? <> <span className="pill warn">new</span></> : null}
                    <small>{p.alias}</small>
                  </Td>
                  <Td cls="mono">{p.key}</Td>
                  <Td cls="mono">{p.was}</Td>
                  <Td>{p.dept}</Td>
                  <Td cls="r">{`${p.sla}d`}</Td>
                  <Td cls="mono">{`day ${p.es} → ${p.ef}`}</Td>
                  <Td cls="r"><b className="cdcell mono" style={{ color: c.c }}>{c.t}</b></Td>
                  <Td>{runs}</Td>
                  <Td>{st}</Td>
                </tr>
              );
            })}
            <tr className="tot">
              <Td />
              <Td>{`All ${P.length} phases`}</Td>
              <Td /><Td /><Td />
              <Td cls="r">{`${SEQ}d`}</Td>
              <Td cls="mono">{`day 0 → ${DAYS}`}</Td>
              <Td />
              <Td><span className="pill warn">2 pairs</span></Td>
              <Td><b>{`${SEQ - DAYS} days saved`}</b></Td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- calendar arithmetic */
export function MathTable() {
  const rows = [
    ['Add up every phase target', `${SEQ} days`, 'the Days column above, one behind the other'],
    ['Saved by Drawings ‖ Vendor Panel', '10 days', 'both start when Gate 2 clears'],
    ['Saved by Purchase Orders ‖ Site Execution', '45 days', 'both start when the contract is signed'],
    ['The doors open', `${OPEN_DAY} days`, 'end of Phase 15 — this is the number the client quotes'],
    ['Project fully closed', `${DAYS} days`, 'end of Phase 16, seven days of closure after opening'],
  ];
  return (
    <div className="panel">
      <h3>The calendar arithmetic</h3>
      <div className="tw">
        <table>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r[0]} className={i >= 3 ? 'tot' : undefined}>
                <Td>{r[0]}</Td>
                <Td cls="r"><b style={{ fontSize: 16 }}>{r[1]}</b></Td>
                <Td><span style={{ color: 'var(--muted)' }}>{r[2]}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="s2" style={{ paddingTop: 10 }}>
        <b>One number in Spec 00 needs correcting.</b> It says “200 days of phase targets → ≈145 calendar
        days”. The 145 is right — that is the day the doors open. But the phase table sums to <b>{SEQ} days</b>,
        not 200. Either a duration is wrong or the total is; worth settling before it goes on a deck, because
        every saving figure is derived from it.
      </p>
    </div>
  );
}

/* ------------------------------------------------- Spec 00 §1 — the five fixes */
export function FixesTab() {
  return (
    <>
      <div className="rule">
        <b>Five things the old PMS could not hold.</b>
        <p>
          Each one was found by walking a real property — DB Mall, Bhopal — through the system. These are
          structural, not cosmetic: every one of them changes what a screen has to be.
        </p>
      </div>
      <div className="panel">
        <h3>Spec 00 §1 — what was wrong, and what fixes it</h3>
        <div className="tw">
          <table>
            <thead>
              <tr><th>#</th><th>What actually happens</th><th>What the PMS assumed</th><th>The fix</th><th>Where</th></tr>
            </thead>
            <tbody>
              {FIXES.map((f) => (
                <tr key={f[0]} data-go={f[4]}>
                  <Td><span className="pill dan">{f[0]}</span></Td>
                  <Td html={f[1]} />
                  <Td html={`<span style="color:var(--muted)">${f[2]}</span>`} />
                  <Td html={f[3]} />
                  <Td cls="nme"><b>{`Phase ${f[4]}`}</b></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------ Spec 03 §1 — 37 drawings */
export function DrawingsTab() {
  const cats = {};
  DRAW.forEach((d) => { cats[d[1]] = cats[d[1]] || [0, 0]; cats[d[1]][d[3] - 1] += 1; });
  return (
    <div className="panel">
      <h3>Drawing Checklist Master — 37 drawings, 9 categories, 2 sets</h3>
      <p className="s2">
        <b>Set 1 (29) blocks the BOQ. Set 2 (8) blocks nothing</b> and runs on into execution.
        All 37 rows exist on every project from day one at <span className="pill grey">not started</span> —
        the checklist is the deliverable, not the uploads.
      </p>
      <div className="stats" style={{ padding: '0 17px 14px', marginTop: 0 }}>
        <div className="stat"><b style={{ color: 'var(--primary-500)' }}>{SET1}</b><span>Set 1 — blocks the BOQ</span></div>
        <div className="stat"><b style={{ color: 'var(--secondary-600)' }}>{SET2}</b><span>Set 2 — blocks nothing</span></div>
        <div className="stat"><b>{DRAW.length}</b><span>Drawings in the checklist</span></div>
        <div className="stat"><b>{Object.keys(cats).length}</b><span>Categories</span></div>
        <div className="stat"><b style={{ color: 'var(--accent-600)' }}>{`${SET1_DONE} / ${SET1}`}</b><span>Set 1 approved today</span></div>
      </div>
      <div className="tw">
        <table>
          <thead>
            <tr><th className="r">#</th><th>Category</th><th>Drawing</th><th>Set</th><th>Blocks the BOQ?</th></tr>
          </thead>
          <tbody>
            {DRAW.map((d) => (
              <tr key={d[0]} data-go="5">
                <Td cls="r">{d[0]}</Td>
                <Td><b>{d[1]}</b></Td>
                <Td cls="nme">{d[2]}</Td>
                <Td>{d[3] === 1 ? <span className="pill vio">Set 1</span> : <span className="pill info">Set 2</span>}</Td>
                <Td>{d[3] === 1 ? <span className="pill dan">blocks</span> : <span style={{ color: 'var(--ink-400)' }}>no</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- Spec 03 §2 — the BOQs */
export function BoqTab() {
  const scols = [cssv('--accent-500'), cssv('--primary-500'), cssv('--secondary-500')];
  return (
    <>
      <div className="panel">
        <h3>The BOQ is three things — construction, furniture, procurement</h3>
        <p className="s2">
          Seven sheets, but only three kinds of work, and each kind goes to a different track.
          {' '}<b>Construction</b> is built on site by the local contractor. <b>Furniture</b> is made to drawing
          at the Delhi facility. <b>Procurement</b> is bought in from panel vendors. Every one of the seven
          BOQs belongs to exactly one of the three.
        </p>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Stream</th><th>What happens to it</th><th>Goes to</th>
                <th className="r">BOQs</th><th className="r">Share of spend</th><th>Which sheets</th>
              </tr>
            </thead>
            <tbody>
              {STREAMS.map((st, i) => (
                <tr key={st.k} data-go="7">
                  <Td cls="nme"><b style={{ color: scols[i] }}>{st.ttl}</b></Td>
                  <Td><span style={{ color: 'var(--muted)' }}>{st.who}</span></Td>
                  <Td cls="nme"><b>{st.goes}</b></Td>
                  <Td cls="r">{st.count}</Td>
                  <Td cls="r">{`~${st.share}%`}</Td>
                  <Td><span style={{ color: 'var(--muted)' }}>{st.rows.map((b) => b[1]).join(' · ')}</span></Td>
                </tr>
              ))}
              <tr className="tot">
                <Td>All three</Td><Td /><Td />
                <Td cls="r">{BOQS.length}</Td>
                <Td cls="r">{`${STREAMS.reduce((a, x) => a + x.share, 0)}%`}</Td>
                <Td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>BOQ Master — seven BOQs, not one</h3>
        <p className="s2">
          The seven map one-to-one onto the seven vendor categories in Phase 6, which is what
          makes the chain work: a category with no vendor produces a BOQ with no rates.
        </p>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th className="r">#</th><th>BOQ</th><th>Stream</th><th>Vendor category</th>
                <th>Typical supply source</th><th className="r">Share</th><th>Feeds</th>
              </tr>
            </thead>
            <tbody>
              {BOQS.map((b) => {
                const stm = STREAMS.filter((x) => x.k === b[6])[0];
                const sc = scols[STREAMS.indexOf(stm)];
                return (
                  <tr key={b[0]} data-go="7">
                    <Td cls="r">{b[0]}</Td>
                    <Td cls="nme"><b>{b[1]}</b></Td>
                    <Td><span className="pill" style={{ color: sc }}>{stm.ttl}</span></Td>
                    <Td>{b[2]}</Td>
                    <Td><span className={`pill ${b[3].indexOf('Delhi') >= 0 ? 'info' : 'warn'}`}>{b[3]}</span></Td>
                    <Td cls="r">{`~${b[4]}%`}</Td>
                    <Td><span style={{ color: 'var(--muted)' }}>{b[5]}</span></Td>
                  </tr>
                );
              })}
              <tr className="tot">
                <Td /><Td>All seven</Td><Td>3 streams</Td><Td>7 vendor categories</Td>
                <Td /><Td cls="r">100%</Td><Td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rule">
        <b>One BOQ line = one purchase order = one delivery = one GRN.</b>
        <p>
          With one addition the client’s flow demands: <b>source of supply</b>. A line marked
          {' '}<i>Delhi stock</i> is earmarked and never becomes a PO. <i>Delhi production</i> enters the 20–25 day
          queue. Only <i>outside procurement</i> produces a vendor PO — and only against a signed contract.
        </p>
      </div>
    </>
  );
}

/* --------------------------------------------------------- gates and rules */
export function GatesTab() {
  const gates = [
    ['Gate 1 — Property Approved', 'Phase 2 — Site Evaluation', 'MD', 'Commercial negotiation on exactly one property', '2'],
    ['Gate 2 — LOI Approved', 'Phase 3 — Commercial Closure', 'MD', '<b>Phases 5 and 6 together, and the rent-free fit-out clock</b>', '3'],
    ['Gate 3 — Launch Clearance', 'Phase 14 — Readiness Checklist', 'All department heads → Director', 'Branch opening and handover to Operations', '14'],
  ];
  return (
    <>
      <div className="panel">
        <h3>The three gates — the only hard stops</h3>
        <div className="tw">
          <table>
            <thead>
              <tr><th>Gate</th><th>Sits after</th><th>Who signs</th><th>What it releases</th></tr>
            </thead>
            <tbody>
              {gates.map((r) => (
                <tr key={r[0]} data-go={r[4]}>
                  <Td cls="nme"><b>{r[0]}</b></Td>
                  <Td>{r[1]}</Td>
                  <Td>{r[2]}</Td>
                  <Td html={r[3]} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h3>The five rules this flow encodes — Spec 00 §3</h3>
        <div className="tw">
          <table>
            <tbody>
              {RULES.map((r) => (
                <tr key={r[0]}>
                  <Td><span className="pill vio">{`Rule ${r[0]}`}</span></Td>
                  <Td html={r[1]} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------ screens & build order */
export function ScreensTab() {
  return (
    <>
      <div className="panel">
        <h3>Screen inventory — build order</h3>
        <p className="s2">Steps 1–4 are what the client asked to see first. Each step is demoable on its own.</p>
        <div className="tw">
          <table>
            <thead>
              <tr><th className="r">Step</th><th>Build</th><th>Screens</th><th>Why here</th></tr>
            </thead>
            <tbody>
              {BUILD.map((b) => (
                <tr key={b[0]}>
                  <Td cls="r"><b>{b[0]}</b></Td>
                  <Td cls="nme"><b>{b[1]}</b></Td>
                  <Td cls="mono">{b[2]}</Td>
                  <Td><span style={{ color: 'var(--muted)' }}>{b[3]}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h3>Screens per phase</h3>
        <div className="tw">
          <table>
            <thead>
              <tr><th>Phase</th><th>ID</th><th>Screen</th><th>Route</th></tr>
            </thead>
            <tbody>
              {P.flatMap((p) => p.screens.map((s, i) => (
                <tr key={`${p.id}-${s[0]}`} data-go={p.id}>
                  <Td cls="nme">{i === 0 ? <b>{`${p.no} · ${p.name}`}</b> : ''}</Td>
                  <Td><span className="mono">{s[0]}</span></Td>
                  <Td>{i === 0 ? p.alias : ''}</Td>
                  <Td><span className="mono">{s[1]}</span></Td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------- Spec 03 §7 — questions */
export function QuestionsTab() {
  return (
    <div className="panel" style={{ borderLeft: '4px solid var(--accent-500)' }}>
      <h3>Eight questions that block seeding</h3>
      <p className="s2">
        From Spec 03 §7, plus one the arithmetic threw up. Each one stops a specific piece of
        work, so they are worth ten minutes with the client before the prototype is seeded.
      </p>
      <div className="tw">
        <table>
          <thead>
            <tr><th>#</th><th>Question</th><th>Blocks</th></tr>
          </thead>
          <tbody>
            {QS.map((q) => (
              <tr key={q[0]}>
                <Td><span className={`pill ${q[0] === 'Q-9' ? 'dan' : 'warn'}`}>{q[0]}</span></Td>
                <Td cls="nme" html={q[1]} />
                <Td><span style={{ color: 'var(--muted)' }}>{q[2]}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
