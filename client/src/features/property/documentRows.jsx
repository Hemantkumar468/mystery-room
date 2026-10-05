import { DOCUMENTS } from '../../app/api/propertyCaptureApi.js';

/**
 * ONE ROW PER (PROPERTY × CLOSURE DOCUMENT).
 *
 * Step 5 has read this way for a while and Step 6 did not: the approver's
 * in-tray was one row per property with the six documents banded across it,
 * so answering "which document is waiting on me?" meant scrolling a
 * 2,000px sheet sideways and reading six groups of five columns. The two
 * screens are about the same six documents and the person approving a lease
 * needs what the person chasing it needed — one of them being a sideways
 * version of the other is how they came to disagree.
 *
 * So both now build their rows here. The property is named once at the top
 * of its block and each row underneath is one document: what it is, who owes
 * it, when it was due, when it landed, and where it stands.
 *
 * ALL SIX, ALWAYS — and this is the difference from the assessments, which
 * are chosen. A property owes every closure document whether or not anybody
 * has started it, so the empty ones are rows too: that list IS the list of
 * what is left to do. Leaving them out would make a property with one filed
 * document look finished.
 */
export function documentRows(properties) {
  const out = [];
  for (const property of properties || []) {
    DOCUMENTS.forEach((d, i) => {
      const doc = (property.documents || []).find((x) => x.type === d.key) || null;
      const slot = (property.documentSlots || []).find((x) => x.type === d.key) || null;
      out.push({
        id: `${property.id}:${d.key}`,
        property,
        doc,
        slot,
        docKey: d.key,
        /* How tall this property's block is, so Location and Property can be
           ONE merged cell down the whole of it rather than a value on the
           first line and four blanks under it. */
        span: DOCUMENTS.length,
        docLabel: d.label,
        /* The name is printed once per block and the block is ruled off from
           the next — repeating it is what reads as several properties. */
        isFirst: i === 0,
        isLast: i === DOCUMENTS.length - 1,
      });
    });
  }
  return out;
}

export default documentRows;
