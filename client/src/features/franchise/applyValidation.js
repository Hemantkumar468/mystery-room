/**
 * What a franchise application must say before we can send it — in the words
 * the person filling it in would use.
 *
 * WHY IT IS ITS OWN FILE. The page had `required` on four inputs and nothing
 * else: a name could be "98765", a phone could be "call me", and the
 * property — the thing the whole
 * application is about — was optional. The browser's own bubble ("Please fill
 * in this field") says nothing about WHY, and the server's Zod errors are
 * written for developers. So every rule lives here, once, with the sentence
 * the applicant reads, and the page and the summary both read it.
 *
 * TWO JOBS, deliberately separate:
 *   type*()  — what a field ACCEPTS while being typed (a name never takes a
 *              digit, a phone never takes a letter). Wrong characters cannot
 *              be typed at all, so nobody is told off for them afterwards.
 *   check*() — what is MISSING or wrong when Submit is pressed, as a list the
 *              page can count: "3 things are missing before we can send this".
 */

/** Letters (any script), spaces and the punctuation real names carry. */
const NAME_OK = /^[\p{L}][\p{L}\s.'-]*$/u;
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const digits = (v) => String(v ?? '').replace(/\D/g, '');

/** A name being typed: letters, spaces, apostrophes, dots and hyphens only. */
export const typeName = (v) => String(v ?? '').replace(/[^\p{L}\s.'-]/gu, '');

/**
 * A phone being typed: digits, and a leading + if they started with one.
 * Capped at what a number can actually be, so a stray keypress cannot make a
 * 15-digit "number" that only fails at the end.
 */
export const typePhone = (v) => {
  const raw = String(v ?? '');
  const plus = raw.trim().startsWith('+');
  const d = digits(raw).slice(0, plus ? 12 : 10);
  return plus ? `+${d}` : d;
};

/**
 * A PLACE being typed — a locality, a floor description.
 *
 * Digits stay allowed here and are stripped from a city, which is the whole
 * difference: "Sector 12" without its 12 is a different locality and "Ground +
 * first" without its + is a different floor, while no Indian city has a digit
 * in its name. What this does remove is the junk neither can contain —
 * @ # $ % * = and the rest.
 */
export const typePlace = (v) => String(v ?? '').replace(/[^\p{L}\p{N}\s.,'’+/&()-]/gu, '');

/** A number being typed: digits only — no letters, no e, no minus. */
export const typeNumber = (v, max = 9) => digits(v).slice(0, max);

/** The 10 digits of an Indian mobile, whatever shape it was typed in. */
export const mobileDigits = (v) => {
  const d = digits(v);
  if (d.length > 10 && d.startsWith('91')) return d.slice(-10);
  if (d.length > 10 && d.startsWith('091')) return d.slice(-10);
  return d;
};

/**
 * Everything wrong with this application, in the order it appears on screen.
 *
 * Each problem carries the field's own words (`label`) for the summary at the
 * top, and the sentence shown under the field itself (`message`) — what is
 * needed and why it is needed, never "invalid input".
 */
export function checkApplication({ form, props }) {
  const problems = [];
  const add = (path, label, message) => problems.push({ path, label, message });
  const t = (v) => String(v ?? '').trim();

  const name = t(form.name);
  if (!name) add('name', 'Your full name', 'Please write your full name — our team will address you by it when they call.');
  else if (name.length < 2) add('name', 'Your full name', 'That looks too short to be a name — please write it in full.');
  else if (!NAME_OK.test(name)) add('name', 'Your full name', 'A name cannot contain numbers or symbols. Please write it in letters only.');

  const phone = mobileDigits(form.phone);
  if (!t(form.phone)) add('phone', 'Your phone number', 'We need a mobile number — this is how our expansion team reaches you, usually on WhatsApp.');
  else if (phone.length !== 10) add('phone', 'Your phone number', 'An Indian mobile number has 10 digits. Please check it — we cannot reach you otherwise.');
  else if (!/^[6-9]/.test(phone)) add('phone', 'Your phone number', 'An Indian mobile number starts with 6, 7, 8 or 9. Please check the number.');

  const email = t(form.email);
  if (!email) add('email', 'Your email', 'We send the written reply to your application by email, so we need an address that works.');
  else if (!EMAIL_OK.test(email)) add('email', 'Your email', 'That address looks incomplete — it should look like name@example.com.');

  /* THE PROPERTY IS THE APPLICATION. An enquiry with no site is a wish; the
     expansion team cannot assess, cost or shortlist anything from it. */
  if (!props.length) {
    add('prop.0.city', 'The property', 'Add the property you want the centre in — an application without a site cannot be assessed.');
  }

  props.forEach((p, i) => {
    const where = props.length > 1 ? `Property ${i + 1} — ` : '';
    if (!t(p.city)) add(`prop.${i}.city`, `${where}City`, 'Which city is this property in? Our team is organised city by city.');
    else if (/\d/.test(t(p.city))) add(`prop.${i}.city`, `${where}City`, 'A city name has no numbers in it — put the sector or phase in Locality / area instead.');
    if (!t(p.locality)) add(`prop.${i}.locality`, `${where}Locality / area`, 'Which part of the city — the locality or the nearest landmark? Footfall depends on it.');
    if (!t(p.address)) add(`prop.${i}.address`, `${where}Full address`, 'The full address, so our team can find the shop and visit it.');
    else if (t(p.address).length < 10) add(`prop.${i}.address`, `${where}Full address`, 'That address is too short to find the place — please add the road and the landmark.');

    const area = Number(digits(p.carpetAreaSqft));
    if (!t(p.carpetAreaSqft)) add(`prop.${i}.carpetAreaSqft`, `${where}Carpet area`, 'How big is it, in square feet? Numbers only, e.g. 2400. A Mystery Rooms centre needs the space to fit the games.');
    else if (!area || area < 100) add(`prop.${i}.carpetAreaSqft`, `${where}Carpet area`, 'That looks too small for a centre. Please check the square feet — e.g. 2400.');
    else if (area > 100000) add(`prop.${i}.carpetAreaSqft`, `${where}Carpet area`, 'That looks too large to be right. Please check the square feet.');

    (p.driveLinks || []).forEach((l, li) => {
      const link = t(l);
      if (link && !/^https?:\/\/\S+\.\S+/i.test(link)) {
        add(`prop.${i}.driveLinks.${li}`, `${where}Drive link`, 'That does not look like a link. Paste the full address from your browser, starting with https://');
      }
    });
  });

  return problems;
}

/** The problems as `{ path: message }`, for the field showing its own line. */
export const byPath = (problems) => Object.fromEntries(problems.map((p) => [p.path, p.message]));

/**
 * The sentence at the top of the form: how many things, and why it matters.
 * Counting is the point — "some fields are required" makes a person hunt.
 */
export const summaryLine = (n) => (n === 1
  ? 'One thing is missing before we can send your application:'
  : `${n} things are missing before we can send your application:`);

export default { typeName, typePlace, typePhone, typeNumber, mobileDigits, checkApplication, byPath, summaryLine };
