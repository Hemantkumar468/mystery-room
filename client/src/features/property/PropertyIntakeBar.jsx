import { useRef, useState } from 'react';
import {
  Share2, Copy, Check, ExternalLink, QrCode, Plus, MapPin,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { NewProjectModal } from '../projects/NewProjectModal.jsx';
import { PropertyCaptureModal } from './PropertyCaptureModal.jsx';

/**
 * The doors a property can come in through, as buttons above the queue they
 * fill.
 *
 * This queue only ever showed what had ALREADY arrived, with no way to open a
 * new source from it — the franchise link lived in the Franchise module and
 * New Project lived in Projects, so the person working the pipeline had to
 * leave it to feed it. Two links to send out, and two forms to fill in here.
 *
 * ON THE NAME. "Broker link" was the ask, but the people who send us sites are
 * brokers, property agents, landlords, mall leasing teams and the occasional
 * friend of the MD — and a link labelled "broker" invites the ones who are not
 * brokers to assume it is not for them. **Property referral** is the
 * recommended name: it describes the ACT rather than the sender's job, so it
 * fits every one of them. The queue still tags what arrives as "Broker",
 * because that is what the row is in practice.
 *
 * WHY LINKS AND NOT EMBEDS. Both forms are public and unauthenticated by
 * design — the person filling them in has no login. So what this offers is the
 * URL to send them, not the form. Capture a property is the opposite: it is
 * internal work, so it opens here as a dialog rather than sending anyone
 * anywhere.
 */
/**
 * ONE LINK TO SHARE, NOT TWO.
 *
 * There used to be a franchisee link and a broker link, which made whoever
 * was sharing decide which kind of person they were writing to — and send the
 * wrong one whenever they guessed. The public page now opens with that
 * question, asked of the person who actually knows the answer, and shows the
 * matching form. One address covers both.
 */
const SOURCES = [
  {
    key: 'public',
    icon: Share2,
    label: 'Share Property Link',
    blurb: 'One link for both: it asks whether they want to run a Mystery Rooms or are a broker with a site, then opens the right form. Franchise applications and broker leads both land in this queue.',
    path: '/franchise/apply',
    tone: 'var(--p-tag-franchisee-fg)',
  },
];

export function PropertyIntakeBar() {
  /**
   * EACH DOOR IS GRANTED SEPARATELY — see access.catalog.js.
   *
   * Reading the queue and adding to it are different jobs. A Cluster Manager
   * watches their region's pipeline and has no business opening a new store;
   * the consultant who files sites all week should not be handing out the
   * public application link. Until now all three buttons shipped with Step 1
   * and there was no way to take one away.
   *
   * `edit`, not `view`: every one of these WRITES. Someone with view-only on
   * Step 1 can read the pipeline and is shown no way to add to it, rather
   * than a button that ends in a refusal.
   */
  const access = useAccess();
  const canLink = access.step('property-intake-link', 'edit');
  const canStore = access.step('property-intake-store', 'edit');
  const canCapture = access.step('property-intake-capture', 'edit');

  const [share, setShare] = useState(null);   // which link's dialog is open
  const [newProject, setNewProject] = useState(false);
  const [capture, setCapture] = useState(false);
  const [copied, setCopied] = useState(false);
  /* Shown only when both clipboard paths were refused — see `copy` below. */
  const [manual, setManual] = useState(false);
  const urlRef = useRef(null);

  /* All three taken away = no bar. An "Add properties" label with nothing
     after it reads as three buttons that failed to load. */
  if (!canLink && !canStore && !canCapture) return null;

  const urlFor = (path) => `${window.location.origin}${path}`;

  /**
   * Copy, with somewhere to fall back to at every step.
   *
   * `navigator.clipboard` is refused in more places than people expect —
   * plain http on a LAN address, an unfocused document, a locked-down browser
   * policy. The first version of this swallowed that and did NOTHING: the
   * click landed, no text was copied, and no message said so. A copy button
   * that silently fails is worse than no copy button, because the person
   * walks away believing they have the link.
   *
   * So: try the modern API, fall back to the old execCommand path, and if
   * both refuse, select the text and say "press Ctrl+C" — which always works,
   * because the field is right there.
   */
  const copy = async (text) => {
    const ok = await (async () => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch { /* fall through */ }
      try {
        const el = urlRef.current;
        if (!el) return false;
        el.select();
        el.setSelectionRange(0, text.length);
        return document.execCommand('copy');
      } catch { return false; }
    })();

    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      urlRef.current?.select();
      setManual(true);
      setTimeout(() => setManual(false), 4000);
    }
  };

  return (
    <>
      <div className="prop-intake">
        {/* NO "Add properties" LABEL. The three controls beside it already
            say what they do — Property link, New Store, Capture Property —
            and a heading over them only repeated the verb in all three, in
            the widest, palest type on the row. The bar is read as buttons,
            not as a labelled group. */}
        {canLink && SOURCES.map((s) => (
          <button
            key={s.key}
            type="button"
            className="prop-intake-btn"
            style={{ '--tone': s.tone }}
            onClick={() => { setShare(s); setCopied(false); setManual(false); }}
            title={s.blurb}
          >
            <Share2 size={13} />
            {s.label}
          </button>
        ))}

        {/* A store we want in a city, with no site in hand yet. Internal work,
            so it opens here as a dialog rather than handing out a URL — and it
            is the same form Projects uses, so a project started here is not a
            different kind of project. */}
        {canStore && (
          <button
            type="button"
            className="prop-intake-btn is-primary"
            onClick={() => setNewProject(true)}
            title="We want a store in a city — start the project and the property search"
          >
            <Plus size={13} /> New Store
          </button>
        )}

        {/**
         * A SITE FOR A STORE WE ALREADY HAVE.
         *
         * The row-level "Find a site" is gone from the queue, and a store that
         * looks at ten shops before signing one still needs the second, third
         * and fourth filed somewhere. Here it is a toolbar action instead: the
         * city is chosen on the form, so a property can be captured without
         * first hunting down one of that store's existing rows to start from.
         */}
        {canCapture && (
          <button
            type="button"
            className="prop-intake-btn is-primary"
            onClick={() => setCapture(true)}
            title="File a site against a store we already have — pick the city, then fill the property in"
          >
            <MapPin size={13} /> Capture Property
          </button>
        )}

        {/* No "Renovation and Add Games" here — the button is off this bar by
            request. THE FEATURE IS INTACT: RenovationModal.jsx still holds the
            whole form (pick the centre, tick the games it runs, add new ones,
            and its project manager shown rather than re-chosen). Putting it
            back is this button and its two lines of state, nothing more. */}

        {/* No "Property in Hand" here — the button is off this bar by request,
            the same way "Renovation and Add Games" is above.

            THE FEATURE IS INTACT. PropertyInHandModal.jsx still holds the
            whole form, and the road behind it is untouched: a site we have
            already settled on has nothing left to find and nothing left to
            assess, so KIND_SKIPS in project.service.js closes the early
            phases on creation and leaves commercial closure (LOI, lease,
            legal check, deposit, NOCs, approvals) open — the work that
            actually remains. Putting the door back is this button and its two
            lines of state, nothing more. */}

        {/* No "Capture a property" here. The capture form itself is untouched
            and is still reached from the queue below — "Find a site" on a
            sourcing row opens the same PropertyCaptureModal, seeded with what
            that row already knows. Only this shortcut is gone. */}
      </div>

      {share && (
        <Modal
          open
          onClose={() => setShare(null)}
          title={share.label}
          subtitle="Anyone with this link can fill the form — no login needed."
          width={560}
          footer={(
            <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
              <a className="btn btn-ghost" href={share.path} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Preview the form
              </a>
              <button type="button" className="btn btn-primary" onClick={() => copy(urlFor(share.path))}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
              </button>
            </div>
          )}
        >
          <div className="col gap-3">
            <p className="sm" style={{ margin: 0 }}>{share.blurb}</p>

            {/* Selectable and read-only. A link you can highlight is the
                fallback for every browser where the clipboard API is refused.
                The copy button sits ON the field rather than only in the
                footer, because the field is where the eye already is once it
                has read the URL — that is the moment the hand reaches. */}
            <div className="prop-share-row">
              <input
                ref={urlRef}
                className="prop-share-url"
                readOnly
                value={urlFor(share.path)}
                onFocus={(e) => e.target.select()}
                onClick={(e) => e.target.select()}
              />
              <button
                type="button"
                className={`prop-share-copy${copied ? ' is-done' : ''}`}
                onClick={() => copy(urlFor(share.path))}
                title={copied ? 'Copied' : 'Copy link'}
                aria-label={copied ? 'Copied' : 'Copy link'}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>

            {manual ? (
              <p className="prop-share-manual">
                Your browser blocked the clipboard — the link is selected, press <kbd>Ctrl</kbd>+<kbd>C</kbd>.
              </p>
            ) : (
              <p className="tiny muted" style={{ margin: 0 }}>
                <QrCode size={11} /> Submissions land in Step 1 of this pipeline as soon as they arrive,
                tagged with where they came from.
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* STAYS HERE. Creating a store used to navigate into the project, which
          answered "add a store to this queue" by leaving the queue — the
          filters, the page and the list all gone, and the new row never seen.
          `onCreated` makes this caller own what happens next: close, say where
          it went, and let the row appear in the list behind. */}
      <NewProjectModal
        open={newProject}
        onClose={() => setNewProject(false)}
        onCreated={(p) => {
          setNewProject(false);
          flashSuccess(`${p.code} created — it is in the list below, waiting for a site`);
        }}
      />

      {/* No `startProject` and no `prefill` on purpose: the modal already asks
          for the city and, when that city holds more than one store, which of
          them to file into. Passing nothing is what makes it the picker. */}
      <PropertyCaptureModal
        open={capture}
        onClose={() => setCapture(false)}
      />
    </>
  );
}

export default PropertyIntakeBar;
