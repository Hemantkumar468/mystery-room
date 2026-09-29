import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ThumbsUp, ThumbsDown, RotateCcw, Eye, AlertTriangle,
} from 'lucide-react';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { useChangePropertyDecision } from '../../app/api/propertyCaptureApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { PropertyRouteModal } from './PropertyRouteModal.jsx';
import { PropertyRejectModal } from './PropertyRejectModal.jsx';
import { EnquiryDecisionModal } from './EnquiryDecisionModal.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyWhyStatusModal } from './PropertyWhyStatusModal.jsx';
import { propertySheetColumns, PropertySheetFooter, PER_SITE_KEYS } from './PropertySheet.jsx';
import {
  PropertyToolbar, PropEmpty, fmtDate, StageBadge,
  groupByCity, stackPerSite, dropEmptyColumns,
} from './propertyUi.jsx';

/**
 * Step 2 — MD Review & Decision.
 *
 * WHAT IT IS FOR. A captured property is a candidate, not a plan. Somebody has
 * walked the shop, filled the Phase 1 form and filed it; nothing happens next
 * until one person says which road it takes. That decision is this step, and
 * it belongs to one desk.
 *
 * THIS PAGE DOES NOT OWN A TABLE. It renders Step 1's — `propertySheetColumns`
 * in PropertySheet.jsx — and asks the server the same question Step 1 asks,
 * with no stage filter. Read that file for the sheet itself; what is left here
 * is only what is genuinely this step's:
 *
 *   - four columns Step 1 has no use for (Decided by / on, Project, Waiting
 *     since), spliced in beside the facts they qualify;
 *   - the verdict, which is the entire difference between the two screens.
 *
 * It took four passes to get here, and the reason is worth writing down. Each
 * time the sheet was narrowed on a reasonable-sounding argument — this step
 * only needs the facts a verdict turns on; this step only needs rows still
 * awaiting a road — and each time the result was properties the reader had
 * just been looking at going missing, with nothing on either screen to account
 * for them. And because the columns were declared twice, the two sheets drifted
 * every time one was edited. One declaration, imported, is what stops both.
 *
 * ONE LOCATION, SEVERAL PROPERTIES, SEVERAL DECISIONS. Step 1's action belongs
 * to the row; here the verdict belongs to the PROPERTY, and a Bhopal row
 * holding five sites needs five answers. So the Action column is stacked per
 * site like every other per-property column, one verdict per numbered box,
 * aligned with it. A single button on a five-property row would have
 * shortlisted whichever site happened to come back first.
 *
 * AND THE VERDICT FITS THE ROW IT IS ON. A store still looking for a site has
 * nothing to rule on; a site somebody sent us has no record for `decide()` to
 * act on, so its verdict is the submission one; a property already in
 * assessment cannot be shortlisted again. The alternative — one button
 * everywhere — is a Shortlist that fails when pressed, which is a worse lie
 * than a missing row.
 *
 * NOTHING IS FILED HERE. This step reads what was captured and records a
 * decision about it; the property record itself is unchanged apart from the
 * status that decision sets.
 */
const EMPTY_HINT = 'This step lists every property Step 1 lists. Nothing is in the pipeline yet.';

const dash = <span className="prop-dim">—</span>;

/** This step's own per-property columns, on top of the sheet's. */
const OWN_PER_SITE = ['decidedBy', 'decidedOn', 'sentTo', 'project', 'createdAt', 'action'];

export default function PropertyMdReviewPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.manage(user?.role);

  /**
   * NO STAGE FILTER, exactly as Step 1 passes none.
   *
   * This asked for `stage=routing` — only what still needed a road — which is
   * what made Bhopal five properties there and two here. Rejected ones stay
   * out of both; the server drops those from every step, and they are read on
   * Step 1's own Rejected tab.
   */
  const q = usePropertyQuery('decide');
  const [routing, setRouting] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  /* Which SUBMISSION's decision is open — a site somebody sent in that we
     have not filed as a record yet. */
  const [deciding, setDeciding] = useState(null);
  const [details, setDetails] = useState(null);
  const [media, setMedia] = useState(null);
  /* Which property's status is being asked about. */
  const [whyRow, setWhyRow] = useState(null);
  /* Which property is being put back, and anything that went wrong doing it.
     A failed revert has to be SAID: the row simply not changing reads as a
     button that does nothing. */
  const [reverting, setReverting] = useState(null);
  const [revertError, setRevertError] = useState(null);
  /* Said when a withdrawal could only go part of the way — see `revert`. */
  const [revertNote, setRevertNote] = useState(null);
  const change = useChangePropertyDecision();

  /**
   * Withdraw a decision, in place.
   *
   * `to: 'waiting'` is the server's own word for it (changeDecision), and it
   * clears the verdict without inventing a new one - which is why no reason
   * is asked for and none is required. The queue refetches on its own through
   * the mutation's cache tags, so the row's buttons change under the cursor
   * rather than after a reload.
   */
  const revert = async (r) => {
    if (!r.recordId || reverting) return;
    setReverting(r.recordId);
    setRevertError(null);
    setRevertNote(null);
    try {
      const res = await change.mutateAsync({ recordId: r.recordId, to: 'waiting' });
      const out = res?.data || res || {};
      /**
       * WHEN IT DOES NOT FULLY COME BACK, SAY SO.
       *
       * Withdrawing closes the empty forms the decision opened, and with them
       * gone the property returns to this step with both buttons. But a form
       * somebody has already worked in is their work and is not deleted - so
       * that property stays where it is, and the row does not change. Silence
       * there reads as a button that did nothing. It did something; it just
       * could not do all of it, and the reason is the one thing the reader
       * needs to know.
       */
      if (out.formsKept > 0) {
        setRevertNote(`${r.title}: the decision is withdrawn, but ${out.formsKept} form(s) already `
          + 'have work in them, so it stays where it is. Empty forms were closed. '
          + 'Clear or reject those forms to bring it all the way back.');
      }
    } catch (err) {
      setRevertError(err?.response?.data?.message || `Could not put ${r.title} back.`);
    } finally {
      setReverting(null);
    }
  };

  const columns = useMemo(() => propertySheetColumns({
    page: q.page,
    limit: q.limit,
    onMedia: (row, at) => setMedia({ row, at }),
    onDetails: (row) => setDetails(row),
    onWhy: (row) => setWhyRow(row),

    insertAfter: {
      /* Behind the capture's own who-and-when, because that is what they
         continue: the property was filed on this date by this person, and
         then answered on that date by that one. */
      captureDoneAt: [
        {
          key: 'decidedBy', label: 'Decided by', width: 140,
          render: (r) => (r.decision?.by
            ? <span className="prop-person" title={r.decision.by}>{r.decision.by}</span>
            : <span className="prop-dim">Waiting</span>),
        },
        {
          key: 'decidedOn', label: 'Decided on', width: 112,
          render: (r) => (r.decision?.at
            ? <span className="as-when">{fmtDate(r.decision.at)}</span>
            : dash),
        },
        {
          key: 'sentTo', label: 'Sent to', width: 130, sort: true,
          render: (r) => {
            const stage = r.stage;
            if (!stage || stage === 'capture') return dash;
            return <StageBadge stage={stage} />;
          },
        },
      ],
      documents: [],

      /* THE ACTION, LAST AND PINNED. Last because a property has to be read
         before it can be answered — leading with two buttons asks for the
         decision before the facts it turns on. Pinned because being last on a
         table this wide would otherwise mean scrolling to reach it; see
         `pin: 'right'` in PropTable.jsx. */
      remarks: [{
        /**
         * WIDE ENOUGH FOR WHAT IT ACTUALLY HOLDS, which is not the same for
         * everybody. A reader who can decide gets Shortlist, Reject and
         * Details; everybody else gets "View only" and Details. Sized for
         * the first, the second left 120px of empty column pinned to the
         * right of every row — and the pin means that gap follows you as
         * you scroll, so it reads as a column that failed to load rather
         * than as one with nothing to put there.
         */
        key: 'action', pin: 'right', label: 'Action', width: canDecide ? 264 : 168,
        render: (r) => {
          /* A store still looking for a site. There is no property to rule on,
             and the Property column already prints a dash for it. */
          const noProperty = !r.recordId && !r.enquiryId;
          /**
           * A PROPERTY WE WERE SENT TAKES A DIFFERENT DIALOG, NOT A DIFFERENT
           * ANSWER. A franchise or referral site has no record behind it yet,
           * so there is nothing for `decide()` to decide ON — its verdict is
           * the submission one, which files the property as part of answering.
           * The buttons stay Shortlist and Reject so the column reads the same
           * all the way down; only what opens underneath changes, and that
           * dialog asks this step's own question (assess and which, or
           * straight to closure, or no).
           *
           * ONE CAVEAT, SAID OUT LOUD BECAUSE THE BUTTON CANNOT SAY IT: one
           * application can carry several sites, and that dialog decides the
           * application with every site ticked to begin with. Pressing
           * Shortlist on one of them opens the whole thing, so untick what you
           * did not mean. This is exactly how Step 1 behaves; making Step 2
           * pretend otherwise would have been a second, quieter lie.
           */
          const submitted = !r.recordId && r.enquiryId;
          /* Past this step already — assessment, closure, planning. Its road
             was chosen; the only thing left to do to it here is change that. */
          const moved = Boolean(r.recordId) && r.stage && r.stage !== 'capture';
          return (
            <span className="pc2-acts">
              {noProperty ? (
                <span className="tiny muted" title="This location is a standing ask — nothing has been captured here yet to decide on">
                  Nothing to decide yet
                </span>
              ) : canDecide && submitted ? (
                <>
                  <button
                    type="button" className="pc2-act a-go"
                    onClick={(e) => { e.stopPropagation(); setDeciding({ id: r.enquiryId, mode: null }); }}
                    title="Decide on the application this site arrived in — assessment, closure, or no"
                  >
                    <ThumbsUp size={12} /> Shortlist
                  </button>
                  <button
                    type="button" className="pc2-act a-reject"
                    onClick={(e) => { e.stopPropagation(); setDeciding({ id: r.enquiryId, mode: 'reject' }); }}
                    title="Turn the application down, with a reason"
                  >
                    <ThumbsDown size={12} /> Reject
                  </button>
                </>
              ) : canDecide && (r.decision || moved) ? (
                /* ALREADY DECIDED. Shortlist and Reject are the first answer,
                   and offering them again on a decided property was a click
                   that failed: a rejected one cannot be re-shortlisted
                   straight (see recordService.decide's transition table).
                   Changing the answer is its own action, with its own dialog
                   and its own reason. */
                /**
                 * REVERT, AND NOTHING ELSE.
                 *
                 * This was "Change", and it opened a dialog asking which new
                 * answer to give and why. That dialog is right for the rare
                 * case - turning a shortlist into a rejection, with a reason
                 * the next reader needs. It is wrong for the common one,
                 * which is simply "put it back": somebody pressed the wrong
                 * button, or the site changed, and all they want is the two
                 * buttons again. Three clicks and a mandatory paragraph for
                 * that is why it was never used.
                 *
                 * So it withdraws the decision in one press. The property
                 * returns to waiting, right here, and Shortlist and Reject
                 * come back on the row - which IS the outcome people were
                 * using the dialog to reach. Nothing else about the property
                 * is touched: the forms already filed against it stay filed,
                 * and the audit keeps who withdrew it and when.
                 */
                <button
                  type="button" className="pc2-act"
                  disabled={reverting === r.recordId}
                  onClick={(e) => { e.stopPropagation(); revert(r); }}
                  title={r.decision
                    ? `Put it back to waiting \u2014 it is ${r.decision.state} now, and Shortlist and Reject return`
                    : `Already in ${r.stage} \u2014 this puts it back to waiting`}
                >
                  <RotateCcw size={12} /> {reverting === r.recordId ? 'Reverting\u2026' : 'Revert'}
                </button>
              ) : canDecide ? (
                <>
                  <button
                    type="button" className="pc2-act a-go"
                    onClick={(e) => { e.stopPropagation(); setRouting(r); }}
                    title="Take it forward — assessment (and which), commercial closure, or straight to project"
                  >
                    <ThumbsUp size={12} /> Shortlist
                  </button>
                  <button
                    type="button" className="pc2-act a-reject"
                    onClick={(e) => { e.stopPropagation(); setRejecting(r); }}
                    title="Take it off the table, with a reason"
                  >
                    <ThumbsDown size={12} /> Reject
                  </button>
                </>
              ) : (
                <span className="tiny muted" title="Only the MD decides where a property goes">View only</span>
              )}
              {/* LAST, AND THE CELL IS RIGHT-ALIGNED — so View closes every
                  row at the same x whatever sits before it. Ordering alone
                  cannot line it up: the group's width changes with how many
                  buttons the row earns, so whichever end is NOT pinned drifts.
                  Pinning the right end is what makes the last button a
                  column. */}
              {!noProperty && (
                <button
                  type="button"
                  className="pc2-act a-view"
                  onClick={(e) => { e.stopPropagation(); setDetails(r); }}
                  title="Read the whole property report here, without leaving the queue"
                >
                  <Eye size={12} /> View
                </button>
              )}
            </span>
          );
        },
      }],
    },
  }), [canDecide, navigate, q.page, q.limit, reverting]);

  const perSite = useMemo(
    () => stackPerSite(columns, [...PER_SITE_KEYS, ...OWN_PER_SITE]),
    [columns],
  );
  const rows = useMemo(() => groupByCity(q.rows), [q.rows]);
  /* Read off the UNGROUPED rows: a grouped row only exposes its first
     property's `details`, so asking it would hide a column that four of the
     five sites behind it do answer. */
  const shown = useMemo(() => dropEmptyColumns(perSite, q.rows), [perSite, q.rows]);

  return (
    <>
      <PropertyToolbar q={q} />

      {revertError && (
        <p className="psel-table-note is-bad">
          <AlertTriangle size={12} /> {revertError}
        </p>
      )}

      {revertNote && (
        <p className="psel-table-note">
          <AlertTriangle size={12} /> {revertNote}
        </p>
      )}

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'No properties yet'}
              hint={q.active ? 'Clear the filters to see the whole step.' : EMPTY_HINT}
            />
          ) : (
            <>
              <div className="pc2-tablewrap">
                <PropTable
                  columns={shown}
                  rows={rows}
                  rowKey={(r) => r.id}
                  sort={q.sort}
                  onSort={q.toggleSort}
                  busy={q.isFetching}
                />
              </div>
              <PropertySheetFooter q={q} />
            </>
          )}

      {routing && (
        <PropertyRouteModal
          row={routing}
          /* All three roads: this step IS the routing decision. */
          allowProject
          onClose={() => setRouting(null)}
          onDone={(result) => {
            setRouting(null);
            /* Follow the property to where the server says it landed — the
               decision and its consequence in one movement. */
            const to = result?.nextStage === 'commercial' ? '/property/commercial'
              : result?.nextStage === 'planning' ? '/property/planning'
                : '/property/assessment';
            navigate(to);
          }}
        />
      )}

      {rejecting && (
        <PropertyRejectModal
          row={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => setRejecting(null)}
        />
      )}

      {deciding && (
        <EnquiryDecisionModal
          enquiryId={deciding.id}
          initialMode={deciding.mode}
          onClose={() => setDeciding(null)}
          onDone={(result) => {
            setDeciding(null);
            /* Follow it to wherever answering sent it, exactly as a filed
               property's routing does. */
            if (result?.nextStage === 'commercial') navigate('/property/commercial');
            else if (result?.nextStage === 'assessment') navigate('/property/assessment');
          }}
        />
      )}

      {whyRow && <PropertyWhyStatusModal row={whyRow} onClose={() => setWhyRow(null)} />}

      {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}
    </>
  );
}
