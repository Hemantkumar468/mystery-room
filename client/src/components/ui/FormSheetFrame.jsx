import '../../styles/form-sheet.css';

/**
 * THE PRINTED FORM — one frame, every module.
 *
 * Built to the reference the client supplied (the Admission Form): a coloured
 * band across the top, the sheet's name under a rule, a row of reference
 * fields on dotted leaders, the body, signature lines, a band across the
 * bottom. What is NOT the reference is the colour and the branding — blue
 * rather than orange, and the Mystery Rooms logo where that form had an empty
 * PHOTO box, because a form that goes to a landlord or a franchisee has to say
 * whose form it is before it says anything else.
 *
 * ONE FRAME, NOT ONE PER MODULE. The whole point of the client's ask is that
 * Property Capture, Assessment and Commercial print as the same document with
 * a different name on it — a reader who has signed one knows where to look on
 * the next. Six copies of this layout is six documents that start the same and
 * drift apart the first time any one of them is touched, which is exactly what
 * happened to the property sheet before `PropertyReportSheet` existed.
 *
 * So a module supplies a KEY, not a design. `FORM_TITLES` below is the only
 * place a form is named, and `title` is there for the one-off that has no
 * module of its own.
 */

/**
 * What each module's form is called, keyed by the SAME string the route
 * config, the sidebar and the server's access catalogue use. One spelling, so
 * renaming a step renames its printout with it rather than leaving a PDF
 * carrying a name the app stopped using a year ago.
 */
export const FORM_TITLES = {
  'property-capture': 'Property Capture Form',
  'property-md-review': 'Property Review Form',
  'property-assessment': 'Assessment Form',
  'property-selection': 'Property Approval Form',
  'property-commercial': 'Commercial Form',
  'property-doc-approval': 'Document Approval Form',
  'property-planning': 'Project Creation Form',
};

export const formTitleFor = (module, fallback = 'Form') => FORM_TITLES[module] || fallback;

/**
 * The band at the top and the one at the bottom.
 *
 * An SVG rather than a CSS gradient because `background` is the first thing a
 * browser drops when "Background graphics" is off in the print dialog — which
 * it is by default — and a branded form whose branding disappears on paper is
 * not a branded form. An inline <svg> is content: it prints either way.
 */
function Band({ flip = false }) {
  return (
    <svg
      className={`fsf-band${flip ? ' is-flip' : ''}`}
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Two waves, the lighter one riding on the darker — the reference's
          swoosh, which is what stops the band reading as a plain ruled strip. */}
      <path d="M0 0H1200V58C1040 104 880 30 660 60S240 118 0 78Z" fill="#1d4ed8" />
      <path d="M0 0H1200V30C1020 78 900 8 640 36S220 90 0 46Z" fill="#60a5fa" opacity=".5" />
    </svg>
  );
}

/**
 * @param module      the step key — names the form through FORM_TITLES
 * @param title       an explicit name, for a sheet with no module of its own
 * @param subject     what this one form is ABOUT: the property, the centre
 * @param reference   the row of facts on dotted leaders — `[{label, value}]`.
 *                    Three is what the reference form carries and what fits on
 *                    one line; more wrap rather than shrink.
 * @param status      a chip beside the title, when the record has a state
 * @param aside       the framed box on the right, where the reference form put
 *                    its photo. The caller decides what belongs there.
 * @param signatures  the names under the lines at the foot — `[string]`.
 *                    Empty means no signature block, which is right for a
 *                    report nobody counter-signs.
 * @param flat        drop the paper (border, shadow, max-width) and print the
 *                    frame into whatever is already around it
 */
export function FormSheetFrame({
  module,
  title,
  subject = null,
  reference = [],
  status = null,
  aside = null,
  signatures = [],
  flat = false,
  children,
}) {
  const name = title !== undefined ? title : formTitleFor(module, 'Form');

  return (
    <div className={`fsf${flat ? ' is-flat' : ''}`}>
      <Band />

      <div className="fsf-body">
        <header className="fsf-head">
          <div className="fsf-brand">
            {/* The logo is content, not decoration — it is the one mark that
                says which company issued the sheet, so it must survive the
                print dialog's "no background graphics". */}
            <img className="fsf-logo" src="/logo.png" alt="Mystery Rooms" />
            <div className="fsf-titles">
              {name && <h1 className="fsf-title">{name}</h1>}
              {subject && <p className="fsf-subject">{subject}</p>}
            </div>
            {status && <div className="fsf-status">{status}</div>}
          </div>
          {aside && <div className="fsf-aside">{aside}</div>}
        </header>

        {reference.length > 0 && (
          <div className="fsf-ref">
            {reference.map((r) => (
              <span className="fsf-ref-item" key={r.label}>
                <span className="fsf-ref-label">{r.label}</span>
                {/* The dotted leader is the reference form's signature, and it
                    is drawn under the VALUE rather than instead of it: on
                    paper it reads as a filled-in field, which is what this is,
                    and not as a blank somebody forgot. */}
                <span className="fsf-ref-value">{r.value || '—'}</span>
              </span>
            ))}
          </div>
        )}

        <div className="fsf-content">{children}</div>

        {signatures.length > 0 && (
          <div className="fsf-signs">
            {signatures.map((s) => (
              <div className="fsf-sign" key={s}>
                <div className="fsf-sign-rule" />
                <span className="fsf-sign-label">{s}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Band flip />
    </div>
  );
}

export default FormSheetFrame;
