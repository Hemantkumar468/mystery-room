import { useRef } from 'react';
import { Printer, MapPin, Paperclip, PenLine } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { PropertyReportSheet } from '../projects/PropertyReportSheet.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useRecord } from '../../app/api/recordsApi.js';
import { fmtDate, fmtNumber, fmtCurrency } from '../../lib/format.js';
import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { FIELD_GROUPS, labelOfField, formatFieldValue } from './assessmentFields.js';
import { askedAssessments, skippedAssessments } from './assessmentRows.jsx';
import {
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
  scoreGradeFor,
} from '../projects/records/scoring.js';

/**
 * The Property Report, read over the queue — and printable as a PDF.
 *
 * WHY IT IS NOT A LINK TO THE PROJECT. "Open" used to navigate into Project
 * Management, which answered "show me this property" by replacing the page the
 * reader was working, losing their filters, their sort and their place in 46
 * rows. Nobody clicking it was asking to go anywhere. Where the data LIVES is
 * unchanged — the same p1 record on the same project — it is only read here.
 *
 * IT IS THE SAME REPORT PMS ALREADY PRODUCES, not a second design of one: the
 * sheet is `PropertyReportSheet`, the component the property page itself
 * renders, so status, audit, the template's own sections, the media table and
 * the notes are identical wherever the report is opened from.
 *
 * THREE THINGS ARE DIFFERENT HERE, all deliberate. The sheet is titled with
 * the PROPERTY's name rather than "Property Report", because this is opened on
 * one site out of forty-six and the first question is which one. The two
 * locations are stated at the top, because they are different questions that
 * both get called "location": the CITY is where we want to open, the LIVE
 * LOCATION is the pin on this particular shop in it.
 *
 * AND A STORE IS USUALLY MORE THAN ONE SHOP. Ten sites can be captured against
 * one store before it signs, and opening the report on whichever row was
 * clicked meant going back to the queue to read the next one. Where the store
 * has others, they are listed at the top: pick one, Apply, and the sheet — and
 * the PDF it prints — is that property's.
 */
const STAGE_CAPTURE = 'p1';

/**
 * Print the sheet, and only the sheet.
 *
 * It goes into a window of its own, carrying this app's stylesheets so it
 * looks the same on paper as on screen. The obvious approach — a print
 * stylesheet that blanks the rest of the page — printed an EMPTY sheet: the
 * report lives inside a dialog that is `overflow: hidden` and collapses to
 * zero height in print, and a clipped box cannot be un-clipped by making its
 * neighbours invisible. A separate window has no dialog to escape from, and
 * the browser's own print dialog is what saves it as a PDF.
 */
function printDoc(node, title) {
  if (!node) return;
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((el) => el.outerHTML)
    .join('');
  const win = window.open('', '_blank', 'width=960,height=1000');
  if (!win) return; // pop-up blocked — the dialog stays open, nothing is lost
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}`
    + '<style>body{margin:0;background:#fff}.no-print{display:none!important}</style></head><body>'
    + `${node.innerHTML}</body></html>`,
  );
  win.document.close();
  /* Stylesheets are still loading when write() returns; printing into them
     half-applied is how a report comes out unstyled. */
  const go = () => { win.focus(); win.print(); };
  if (win.document.readyState === 'complete') setTimeout(go, 350);
  else win.addEventListener('load', () => setTimeout(go, 350));
}

/** The two locations, side by side, because both are called "location". */
function LocationLine({ row, values }) {
  const live = values?.live_location;
  const lat = live?.lat ?? live?.latitude;
  const lng = live?.lng ?? live?.longitude;
  const hasPin = Number.isFinite(Number(lat));

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 10 }}>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">City — where we want to open</span>
        <span className="pr-value-text">{row.city || '—'}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">Live location — this site</span>
        {hasPin ? (
          <a
            className="pr-value-text"
            style={{ color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            href={live.mapUrl || `https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noreferrer"
          >
            <MapPin size={12} /> {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
          </a>
        ) : (
          <span className="pr-value-text">{[row.locality, row.address].filter(Boolean)[0] || 'Not captured'}</span>
        )}
      </span>

      {/* WHO AND WHEN, ON THE SITE ITSELF.
          The queue groups its rows by location, so the Assigned / Done by /
          date columns out there carry the FIRST property's values for the
          whole group. For every other site in that location this report is
          the only place its own people and dates are readable. */}
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">Assigned to</span>
        <span className="pr-value-text">
          {(row.capturePlan?.assignedNames || []).join(', ') || 'Unassigned'}
        </span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">Filed by</span>
        <span className="pr-value-text">{row.filedBy || 'Not yet'}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="pr-label">Filed on</span>
        <span className="pr-value-text">
          {row.filedAt
            ? fmtDate(row.filedAt)
            : row.capturePlan?.planDate
              ? `Not yet — due ${fmtDate(row.capturePlan.planDate)}`
              : 'Not yet'}
        </span>
      </span>
    </div>
  );
}

/** The same four scorers the queue's columns use, so a report and the sheet it
 *  was opened from can never disagree about a number. */
const SCORERS = {
  feasibility: feasibilityPercent,
  financial: financialPercent,
  technical: technicalPercent,
  operational: operationalPercent,
};

/**
 * THE FOUR ASSESSMENTS, IN THE REPORT ABOUT THE PROPERTY THEY ASSESS.
 *
 * This report had nothing about them. It is opened from Step 3 and Step 4 -
 * the two screens whose entire subject is the assessments - and it answered
 * with the capture form and no mention of what anybody had found. The four
 * were readable only as four bands on a sheet 2,000px wide, a column at a
 * time, with no way to see one property's four together.
 *
 * ALL FOUR ARE ALWAYS LISTED, including the ones nobody has filed. "Technical
 * has not come back" is the fact a reader deciding on this site most needs,
 * and a section that silently omitted it would read as a site with three
 * assessments rather than one with a gap. The ones that were never asked for
 * say so too, because not-asked and not-done are different situations and
 * chasing the wrong one wastes a week.
 */
const SOURCE_KIND = {
  franchise: 'Franchise application',
  broker: 'Sent by a broker or agent',
  other: 'Sent in by someone who knows the site',
  demand: 'A store we are looking for a site for',
  captured: 'Captured by our own team',
};

/**
 * WHO FILLED IT IN — stated on EACH property, not once at the top.
 *
 * The first version of this put one "Captured by our own team / Filled in by
 * System" band above everything, taken from whichever property came back
 * first. Bhopal holds five sites: three our team walked and two a franchise
 * applicant sent in, filed by three different people on three different days.
 * One line spoke for all five and was wrong about two of them, which is the
 * same mistake the queue's columns made before they were stacked per property.
 *
 * "Filled in by" is `filedBy` — the person who filled OUR form. The applicant
 * or agent who sent the site in is a different person and gets its own line
 * when there is one; the phone is a link because the reason to know who sent
 * it is usually that you are about to ring them.
 */
function FilledBy({ site }) {
  /* "System" is the server's stand-in for a record whose `createdBy` was never
     set - older rows, mostly. Printing "Sent in by System" names a person who
     does not exist; saying nothing is the truthful version. */
  const raw = site.submittedByName || site.submission?.by || null;
  const contact = raw && raw !== 'System' ? raw : null;
  const filed = site.filedBy || null;
  return (
    <span className="pd-who-facts">
      <span><b>Source</b>{SOURCE_KIND[site.source] || 'Property'}</span>
      <span><b>Filled in by</b>{filed || (site.recordId ? 'Not recorded' : 'Not filed yet')}</span>
      <span>
        <b>On</b>
        {site.filedAt ? fmtDate(site.filedAt) : site.createdAt ? fmtDate(site.createdAt) : 'Not recorded'}
      </span>
      {contact && contact !== filed && (
        <span>
          <b>Sent in by</b>
          {contact}
          {site.submittedByPhone && (
            <a className="pd-who-tel" href={`tel:${site.submittedByPhone}`}>{site.submittedByPhone}</a>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * What this report covers, in one line.
 *
 * Deliberately only the facts that are true of the WHOLE set — where, and how
 * many. Anything about who or when belongs to a property, and a group of five
 * has five answers.
 */
function ReportScope({ row, count, anyRecord }) {
  return (
    <div className="pd-who">
      <span className="pd-who-kind">
        {count === 1
          ? 'One property'
          : `${count} properties in ${row.city || 'this location'}`}
      </span>
      <span className="pd-who-note">
        {/* "Capture form" is the right word only where one has been filled in.
            On a site somebody sent us there is no form yet — what follows is
            what they sent, and calling that a capture form would have the
            reader looking for fields nobody was ever asked. */}
        {anyRecord
          ? 'Each one below is its own capture form, in the order the queue numbers them.'
          : 'What follows is what was sent in, in the order the queue numbers it.'}
      </span>
    </div>
  );
}

/** A row of facts, with the blanks left out rather than printed as dashes. */
function FactGrid({ title, facts }) {
  const shown = facts.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <div className="pd-sub-block">
      <h4 className="pd-sub-title">{title}</h4>
      <dl className="pd-sub-grid">
        {shown.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const FILE_KIND = {
  photo: 'Photo', video: 'Video', document: 'Document', audio: 'Voice note', link: 'Drive link',
};

/**
 * WHAT A SUBMITTED PROPERTY ACTUALLY CONTAINS.
 *
 * Details on one of these used to open a dialog that said, in a paragraph and
 * nothing else, that the property had not been filed as a Phase 1 record so
 * there was no report on it. That is true about the RECORD and useless to the
 * reader: this is Step 2, the whole job there is deciding whether to shortlist
 * the site, and the dialog withheld every fact the decision turns on — the
 * address, the floor, the area, what the sender said about it, the photos they
 * attached, their phone number — all of which the submission is carrying and
 * the server already sends down on the row.
 *
 * So Details shows what was sent. Anything the public form does not ask for is
 * absent rather than dashed: an empty "Monthly rent" line on a form that never
 * had a rent field reads as a missing answer instead of a question nobody was
 * asked. The one sentence about filing survives at the bottom, as the note it
 * always was — what happens next, not a reason to show nothing.
 */
function SubmissionReport({ site }) {
  const live = site.details?.liveLocation;
  const lat = Number(live?.lat ?? live?.latitude);
  const lng = Number(live?.lng ?? live?.longitude);
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng);
  const files = site.media?.files || [];
  const d = site.details || {};

  return (
    <div className="pd-sub">
      <FactGrid
        title="Where it is"
        facts={[
          ['City', site.city],
          ['Locality', site.locality],
          ['Address', site.address],
          ['Live location', hasPin ? (
            <a
              href={live.mapUrl || `https://www.google.com/maps?q=${lat},${lng}`}
              target="_blank"
              rel="noreferrer"
              className="pd-sub-link"
            >
              <MapPin size={12} /> {lat.toFixed(5)}, {lng.toFixed(5)}
            </a>
          ) : null],
        ]}
      />

      <FactGrid
        title="The site, as it was described"
        facts={[
          ['Carpet area', site.areaSqft ? `${fmtNumber(site.areaSqft)} sq ft` : null],
          ['Floor', site.floor],
          ['Ownership', site.ownership],
          ['Frontage', d.frontageFt ? `${d.frontageFt} ft` : null],
          ['Commercial type', d.commercialType],
          ['Monthly rent', d.monthlyRent ? fmtCurrency(d.monthlyRent) : null],
          ['Deposit', d.deposit ? fmtCurrency(d.deposit) : null],
          ['Lease amount', d.leaseAmount ? fmtCurrency(d.leaseAmount) : null],
          ['Lease duration', d.leaseDuration ? `${d.leaseDuration} months` : null],
          ['Available from', d.availableFrom ? fmtDate(d.availableFrom) : null],
        ]}
      />

      <FactGrid
        title="Who sent it"
        facts={[
          ['Name', site.submittedByName],
          ['Phone', site.submittedByPhone
            ? <a className="pd-sub-link" href={`tel:${site.submittedByPhone}`}>{site.submittedByPhone}</a>
            : null],
          ['Email', site.submittedByEmail
            ? <a className="pd-sub-link" href={`mailto:${site.submittedByEmail}`}>{site.submittedByEmail}</a>
            : null],
          ['Sent on', site.createdAt ? fmtDate(site.createdAt) : null],
          /* Six sites can arrive in one form, and which of the six this is
             answers "why does that phone number appear on four rows". */
          ['Part of', site.submission?.total > 1
            ? `site ${site.submission.index} of ${site.submission.total} in one submission`
            : null],
        ]}
      />

      {site.remarks && (
        <div className="pd-sub-block">
          <h4 className="pd-sub-title">What they told us about it</h4>
          <p className="pd-sub-remarks">{site.remarks}</p>
        </div>
      )}

      {files.length > 0 && (
        <div className="pd-sub-block">
          <h4 className="pd-sub-title">
            <Paperclip size={12} /> What came with it — {files.length}
            {files.length === 1 ? ' file' : ' files'}
          </h4>
          <ul className="pd-sub-files">
            {files.map((f, i) => (
              <li key={`${f.url}-${i}`}>
                <span className="pd-sub-kind">{FILE_KIND[f.kind] || 'File'}</span>
                <a className="pd-sub-link" href={f.url} target="_blank" rel="noreferrer">
                  {f.name || f.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The original sentence, kept — but as the footnote it always was. */}
      <p className="pd-prop-none">
        {site.blockedReason
          || 'Not filed as a Phase 1 record yet. Shortlisting it files the record, and the full capture form and assessments follow from that.'}
      </p>
    </div>
  );
}

/**
 * ONE PROPERTY'S CAPTURE FORM, in full.
 *
 * Its own component because each property needs its own record fetched, and a
 * hook cannot be called in a loop from the parent. Rendering N of these is how
 * the report shows all of them.
 */
function OnePropertyReport({ site, index, total, schema }) {
  const { data: record, isLoading } = useRecord(site.recordId, { enabled: Boolean(site.recordId) });
  const values = record?.values || {};

  return (
    <div className="pd-prop">
      {total > 1 && (
        <div className="pd-prop-head">
          <span className="pd-prop-no">{index + 1}</span>
          <span className="pd-prop-name">{site.title}</span>
          <span className="pd-prop-sub">{[site.locality, site.city].filter(Boolean).join(' \u00b7 ')}</span>
        </div>
      )}
      {/* WHOSE CLAIM THIS ONE IS, before its numbers. A rent and a floor mean
          different things depending on whether our own surveyor measured them
          or an agent typed them in. */}
      <FilledBy site={site} />
      {!site.recordId ? (
        /* No capture form behind it yet, so the report is of the SUBMISSION —
           which is a real thing with real content, not an absence. */
        <SubmissionReport site={site} />
      ) : isLoading ? (
        <p className="pd-prop-none">Loading this property’s form…</p>
      ) : (
        <PropertyReportSheet
          record={record}
          schema={schema}
          heading={site.title}
          subheading="Property Information Report"
          headerExtra={<LocationLine row={site} values={values} />}
          style={{ background: '#fff', border: 0, maxWidth: 'none', margin: 0, padding: 0 }}
        />
      )}
    </div>
  );
}

/**
 * ONE ASSESSMENT, IN FULL AND ON ITS OWN.
 *
 * These were four cards in a grid, three across, each showing five lines:
 * purpose, who, when, files. A grid is for comparing, and nobody comparing
 * four different assessments of the SAME property - they are four different
 * questions, not four candidates. What it cost was everything the assessor
 * actually wrote: a feasibility form has a market potential, a footfall
 * score, an accessibility grade, a competitor analysis and a risk note, and
 * the card had room for none of them.
 *
 * So each one is a block of its own, full width, running down the page:
 * feasibility and all of its answers, then financial and all of its answers,
 * and so on. That is also what prints - one PDF with the property and every
 * assessment under it, which is the thing somebody carries into a meeting.
 *
 * AN ASSESSMENT NOBODY HAS FILED STILL GETS ITS BLOCK, with its fields empty.
 * A missing block reads as an assessment this property does not need; an
 * empty one reads as work outstanding, which is what it is.
 */
function AssessmentBlock({ type, label, entry, slot }) {
  /**
   * NOT ROUTED IS NOT THE SAME AS NOT ASKED FOR.
   *
   * `state` is about the p2 RECORD, and it reads 'not_routed' whenever that
   * record does not exist - including when the task for it has been raised,
   * assigned to a named person and given a due date. An earlier draft printed
   * "Not asked for" directly beside "Assigned to Ananya Das", which is a card
   * arguing with itself. The task decides whether it was asked for; the record
   * decides how far it has got.
   */
  const asked = Boolean(entry) || Boolean(slot?.assignedTo || slot?.planDate);
  const waiting = slot?.state === 'open' ? 'Started, not filed yet'
    : asked ? 'Not filed yet'
      : 'Not asked for';

  const values = entry?.values || {};
  const pct = entry?.values ? SCORERS[type]?.(values) ?? null : null;
  const grade = typeof pct === 'number' ? scoreGradeFor(pct) : null;
  const files = entry?.media?.files || [];
  const groups = FIELD_GROUPS[type] || [];

  return (
    <section className="pd-as">
      <header className="pd-as-head">
        <h4 className="pd-as-name">{label}</h4>
        {typeof pct === 'number' ? (
          <span className="pd-as-pct" style={{ color: grade.color }}>
            {pct}% <span className="pd-as-grade">{grade.label}</span>
          </span>
        ) : (
          <span className="pd-as-waiting">{waiting}</span>
        )}
      </header>

      {/* WHO AND WHEN, before what they found - the same four facts the queue
          leads every step with, so the report and the sheet agree. */}
      <dl className="pd-as-meta">
        <div><dt>Assigned to</dt><dd>{slot?.assignedTo || '\u2014'}</dd></div>
        <div><dt>Filed by</dt><dd>{slot?.filedBy || entry?.by || '\u2014'}</dd></div>
        <div>
          <dt>Filed on</dt>
          <dd>
            {(slot?.filedAt || entry?.at)
              ? fmtDate(slot?.filedAt || entry?.at)
              : slot?.planDate
                ? `Not yet \u2014 due ${fmtDate(slot.planDate)}`
                : '\u2014'}
          </dd>
        </div>
      </dl>

      {groups.map((g) => {
        const longKeys = new Set(g.long || []);
        const shortKeys = g.keys.filter((k) => !longKeys.has(k));
        const longList = g.keys.filter((k) => longKeys.has(k));
        return (
          <div className="pd-as-group" key={g.label}>
            <span className="pd-as-group-label">{g.label}</span>

            {shortKeys.length > 0 && (
              <dl className="pd-as-fields">
                {shortKeys.map((k) => (
                  <div key={k}>
                    <dt>{labelOfField(type, k)}</dt>
                    <dd>{formatFieldValue(k, values[k])}</dd>
                  </div>
                ))}
              </dl>
            )}

            {longList.map((k) => (
              <div className="pd-as-long" key={k}>
                <span className="pd-as-long-label">{labelOfField(type, k)}</span>
                {/* An empty prose field says so rather than leaving a blank
                    where the reader cannot tell a missing answer from a
                    rendering fault. */}
                <p>{values[k] ? String(values[k]) : <span className="pd-as-empty">Not answered</span>}</p>
              </div>
            ))}
          </div>
        );
      })}

      <div className="pd-as-group">
        <span className="pd-as-group-label">Attached</span>
        {files.length ? (
          <div className="pd-as-files">
            {files.map((x, i) => (
              <a key={x.url + i} href={x.url} target="_blank" rel="noreferrer" className="pd-assess-file">
                {x.name || `File ${i + 1}`}
              </a>
            ))}
          </div>
        ) : <p className="pd-as-empty">Nothing attached.</p>}
      </div>
    </section>
  );
}

/**
 * A PROPERTY'S ASSESSMENTS — THE ONES IT WAS SENT FOR, AND ONLY THOSE.
 *
 * This used to print all four, always. The reasoning was that an empty block
 * reads as work outstanding while a missing one reads as work not needed —
 * which is right for an assessment that WAS asked for and has not been filed,
 * and wrong for one that was never asked for at all. On a property the MD
 * routed to Feasibility alone, the report opened on four headings, three of
 * them "Not asked for" over a screen of dashes. The reader has to scroll past
 * three empty forms to reach the one that has anything in it, and the obvious
 * question — "why is it showing me Financial if we never ordered Financial?"
 * — is the one that came back from the client.
 *
 * So: a block per assessment that was actually asked for, and a single quiet
 * line naming the rest. The distinction the old comment was protecting is
 * kept, because "asked for" includes an assessment that has a task but no
 * form yet — that one still gets its block, still empty, still outstanding.
 * See wasAskedFor in assessmentRows.jsx.
 */
function PropertyAssessments({ row }) {
  const asked = askedAssessments(row);
  const skipped = skippedAssessments(row);

  /* Nothing chosen yet. One sentence beats four empty forms: the property is
     waiting on a decision, which is a different state from waiting on work. */
  if (!asked.length) {
    return (
      <p className="pd-as-none">
        No assessment has been asked for on this property yet — the MD chooses
        which of the {ASSESSMENTS.length} it needs on Step 2.
      </p>
    );
  }

  return (
    <>
      {asked.map(({ key, label, entry, slot }) => (
        <AssessmentBlock key={key} type={key} label={label} entry={entry} slot={slot} />
      ))}

      {/* Named rather than silent: a reader who knows there are four should
          be told the other two were a decision, not a gap in the report. */}
      {skipped.length > 0 && (
        <p className="pd-as-skipped">
          Not asked for: {skipped.map((a) => a.label).join(', ')}
        </p>
      )}
    </>
  );
}

/**
 * THE LOCATION'S ASSESSMENTS, PROPERTY BY PROPERTY.
 *
 * The queue folds a city into one row, so Bhopal is one line holding two
 * sites and eight assessments between them. Opening the report gave you one
 * site's four; the other four meant closing it, finding the second numbered
 * box and opening that. Two reports to answer one question about one city.
 *
 * So the report carries the whole location: each property in turn, numbered
 * the way the queue numbers them, headed with the facts you need before
 * reading a score — what it is called, who was sent to assess it, who filed
 * it and when — and then its four assessments.
 *
 * THE ONE THAT WAS CLICKED COMES FIRST, and is marked. It is the site the
 * reader was looking at when they pressed the button; burying it third
 * because the server happened to return it third would make them hunt for
 * the thing they already had.
 */
function AssessmentsSection({ row }) {
  const sites = (row.siblings || []).filter((s) => s.stage !== 'demand' && s.title);
  /* A location of one, or a report opened from somewhere that does not group:
     the section is about this property and says so without ceremony. */
  if (sites.length <= 1) {
    return (
      <section className="pr-section" style={{ marginTop: 18 }}>
        <h3 className="pr-section-title">Site assessments</h3>
        <PropertyAssessments row={row} />
      </section>
    );
  }

  const clicked = String(row.id ?? row.recordId ?? '');
  const ordered = [
    ...sites.filter((s) => String(s.id ?? s.recordId ?? '') === clicked),
    ...sites.filter((s) => String(s.id ?? s.recordId ?? '') !== clicked),
  ];

  return (
    <section className="pr-section" style={{ marginTop: 18 }}>
      <h3 className="pr-section-title">
        Site assessments — {sites.length} properties in {row.city || 'this location'}
      </h3>
      {ordered.map((s, i) => {
        const isClicked = String(s.id ?? s.recordId ?? '') === clicked;
        const lastFiled = [...(s.assessments || [])]
          .filter((a) => a?.at)
          .sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
        const filedCount = (s.assessments || []).filter((a) => a.at).length;
        return (
          <div className="pd-site" key={s.id || s.recordId || i}>
            <div className="pd-site-head">
              <span className="pd-site-no">{i + 1}</span>
              <span className="pd-site-name">
                {s.title}
                {isClicked && <span className="pd-site-here">the one you opened</span>}
              </span>
              <span className="pd-site-facts">
                {/* ABOUT THE ASSESSMENTS, NOT THE CAPTURE.
                    These fell back to `filedBy` / `filedAt` when no assessment
                    had been filed, and those belong to the capture form - so a
                    site with nothing assessed read "Filed by Prateek, 21 Sep,
                    Done 0 of 4" under a heading that says Site assessments.
                    Three facts, two of them about a different form, and the
                    one that was right was the one nobody would believe. */}
                <span><b>Assigned</b> {(s.assessmentPlan?.assignedNames || []).join(', ') || 'Unassigned'}</span>
                <span><b>Filed by</b> {lastFiled?.by || 'Not yet'}</span>
                <span><b>Filed on</b> {lastFiled?.at ? fmtDate(lastFiled.at) : 'Not yet'}</span>
                <span><b>Done</b> {filedCount} of {(s.assessments || []).length || 4}</span>
              </span>
            </div>
            <PropertyAssessments row={s} />
          </div>
        );
      })}
    </section>
  );
}

/**
 * @param showAssessments  Off by default. Step 1 is the intake sheet and its
 *   report is about what was CAPTURED; four assessment blocks under it were
 *   four screens of "Not asked for" on a property nobody has routed yet, which
 *   buries the thing the reader opened the report to read. The steps whose
 *   subject IS the assessments pass it.
 */
/**
 * THE PROPERTY, IN A LINE, above its assessments.
 *
 * Enough to be certain which site the scores belong to - the name, where it
 * is, how big, what floor, what it costs - and no more. The full capture
 * report is Step 1's, and repeating it here is what pushed the assessments
 * below the fold on screen and onto page two in print.
 */
function AssessmentReportHead({ row }) {
  const facts = [
    row.areaSqft && `${Number(row.areaSqft).toLocaleString('en-IN')} sq ft`,
    row.floor,
    row.details?.commercialType,
    Number(row.details?.monthlyRent) && `\u20b9${Number(row.details.monthlyRent).toLocaleString('en-IN')}/mo`,
  ].filter(Boolean);

  return (
    <header className="pd-arh">
      <h2 className="pd-arh-name">{row.title}</h2>
      <p className="pd-arh-where">
        {[row.locality, row.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' \u00b7 ') || '\u2014'}
      </p>
      {facts.length > 0 && (
        <p className="pd-arh-facts">{facts.join('  \u00b7  ')}</p>
      )}
    </header>
  );
}

export function PropertyDetailsModal({ row, onClose, showAssessments = false, onEdit }) {
  const sheetRef = useRef(null);
  const hasRecord = Boolean(row?.recordId);

  /**
   * EVERY PROPERTY THIS REPORT COVERS.
   *
   * The queue folds a location into one row, so a franchise application
   * describing four sites, or four sites our team captured in one city, is one
   * line holding four properties. The report is about all of them: the row's
   * own siblings where it has them, otherwise just itself.
   *
   * `demand` rows are left out - a store still looking for a site is an ask,
   * not a property, and it has no capture form to print.
   */
  const reported = (row?.siblings?.length
    ? row.siblings.filter((s) => s.stage !== 'demand' && s.title)
    : [row]).filter(Boolean);

  /**
   * The template comes from whichever property in the group HAS a project.
   *
   * It used to come from the clicked row alone, so a location holding one
   * submitted site and three filed ones rendered the three filed forms with no
   * schema — every section empty — purely because the row the reader happened
   * to press was the one without a record.
   */
  const withProject = reported.find((s) => s?.projectId) || null;
  const anyRecord = reported.some((s) => s?.recordId);
  const { data: project } = useProject(withProject?.projectId || undefined);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  if (!row) return null;

  /* Only the TEMPLATE is waited for here. Each property fetches its own record
     inside its own block, so one slow record does not hold up the four that
     have already arrived. */
  const loading = anyRecord && templateLoading;
  const stage = template?.stages?.find((st) => st.key === STAGE_CAPTURE) || null;
  const schema = stage?.masterDataSchema || [];
  const shownTitle = row.title;

  return (
    <Modal
      open
      onClose={onClose}
      title={showAssessments ? 'Assessment report' : 'Property report'}
      subtitle={[row.title, row.city].filter(Boolean).join(' · ')}
      width={940}
      className="pdoc-modal"
      footer={(
        <div className="pdoc-foot">
          {/* Hidden on a phone, where it is three lines of explanation wedged
              beside the controls it explains. */}
          <span className="tiny muted pdoc-foot-hint">
            {showAssessments
              ? 'The assessments only — the full capture report is on Step 1.'
              : hasRecord
                ? 'The same report the property page prints.'
                : 'Sent through the public form — not filed as a property record yet.'}
          </span>
          <div className="pdoc-foot-acts">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
            {/* READ, THEN FIX, WITHOUT GOING BACK FOR IT. Somebody reading a
                report is the likeliest person to notice something wrong in
                it, and until now the only way to act on that was to close the
                report, find the row again and press Edit there. Shown only
                where the caller has somewhere to send them. */}
            {onEdit && hasRecord && (
              <button
                type="button"
                className="btn btn-subtle"
                onClick={() => onEdit(row)}
                title="Open the form behind this report and change it"
              >
                <PenLine size={14} /> Edit
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              /* There is always something to print now — a submission prints
                 as what was sent in. Only an unfinished fetch disables it. */
              disabled={loading}
              onClick={() => printDoc(sheetRef.current, `${shownTitle} — property report`)}
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </div>
        </div>
      )}
    >
      {loading ? (
        <div className="prop-pick-empty">Fetching the property…</div>
      ) : (
        <>
          {/* NO PICKER ANY MORE.
              It asked "5 properties captured for this store - which one?" and
              then showed one, which is a question the reader had not asked and
              an answer that hid the other four. One person describing four
              sites in one sitting is ONE piece of work; the report is now that
              piece of work, in order, and the dropdown-plus-Apply that used to
              be the only way to reach sites two to five is gone with it. */}
          <div ref={sheetRef}>
            {/**
              * TWO REPORTS OUT OF ONE DIALOG, because two different people
              * open it.
              *
              * From Step 1 the question is "what did we capture here", so the
              * capture form is the report and the assessments are not shown
              * at all. From Step 3 and Step 4 the question is "what did the
              * assessors find", and the capture form is forty lines of area,
              * rent, landlord and audit in front of it — the reader scrolls
              * past all of it to reach the one thing they came for, and the
              * printed PDF puts it on page one.
              *
              * So the assessment report states the property in a line and
              * then gets out of the way. Nothing is lost: the full capture
              * report is one click away on Step 1, which is where it belongs.
              */}
            {showAssessments ? (
              <AssessmentReportHead row={row} />
            ) : (
              <>
                <ReportScope row={row} count={reported.length} anyRecord={anyRecord} />
                {reported.map((s, i) => (
                  <OnePropertyReport
                    key={s.id || s.recordId || i}
                    site={s}
                    index={i}
                    total={reported.length}
                    schema={schema}
                  />
                ))}
              </>
            )}
            {/* Inside the printed area on purpose: a property report that goes
                to the MD without its assessments is the same omission on paper
                as it was on screen. Left out entirely where nothing in the
                group is a record yet — four cards all reading "not asked for"
                is noise on a site nobody has decided to assess. */}
            {showAssessments && anyRecord && <AssessmentsSection row={row} />}
          </div>
        </>
      )}
    </Modal>
  );
}

export default PropertyDetailsModal;
