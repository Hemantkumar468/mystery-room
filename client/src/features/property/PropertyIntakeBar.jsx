import { useRef, useState } from 'react';
import {
  Share2, Copy, Check, ExternalLink, Handshake, MapPin, Plus, QrCode,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { NewProjectModal } from '../projects/NewProjectModal.jsx';

/**
 * The three doors a property can come in through, as three buttons.
 *
 * This queue only ever showed what had ALREADY arrived, with no way to open a
 * new source from it — the franchise link lived in the Franchise module and
 * New Project lived in Projects, so the person working the pipeline had to
 * leave it to feed it. All three now sit above the list they fill.
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
 * URL to send them, not the form. New Project is the opposite: it is internal
 * work, so it opens here as a dialog rather than sending anyone anywhere.
 */
const SOURCES = [
  {
    key: 'franchise',
    icon: Handshake,
    label: 'Franchisee link',
    blurb: 'For someone who wants to run a Mystery Rooms franchise. Asks whether they already have a property; if not, they tell us the city and it lands here as a sourcing request.',
    path: '/franchise/apply',
    tone: 'var(--p-tag-franchisee-fg)',
  },
  {
    key: 'referral',
    icon: MapPin,
    label: 'Property referral link',
    blurb: 'For brokers, agents, landlords — anyone who knows of a site. Asks only about the property, not about them running it.',
    path: '/refer-property',
    tone: 'var(--p-tag-broker-fg)',
  },
];

export function PropertyIntakeBar() {
  const [share, setShare] = useState(null);   // which link's dialog is open
  const [newProject, setNewProject] = useState(false);
  const [copied, setCopied] = useState(false);
  /* Shown only when both clipboard paths were refused — see `copy` below. */
  const [manual, setManual] = useState(false);
  const urlRef = useRef(null);

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
        <span className="prop-intake-label"><Share2 size={12} /> Add properties</span>

        {SOURCES.map((s) => (
          <button
            key={s.key}
            type="button"
            className="prop-intake-btn"
            style={{ '--tone': s.tone }}
            onClick={() => { setShare(s); setCopied(false); setManual(false); }}
            title={s.blurb}
          >
            <s.icon size={13} /> {s.label}
          </button>
        ))}

        {/* Internal, so it opens here instead of handing out a URL. */}
        <button
          type="button"
          className="prop-intake-btn is-primary"
          onClick={() => setNewProject(true)}
          title="We want a store in a city — start the project and the property search"
        >
          <Plus size={13} /> New project
        </button>
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

      <NewProjectModal open={newProject} onClose={() => setNewProject(false)} />
    </>
  );
}

export default PropertyIntakeBar;
