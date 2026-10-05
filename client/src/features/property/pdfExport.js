/**
 * A PROPERTY'S REPORT, SAVED AS A PDF FILE — no print dialog.
 *
 * WHY NOT `window.print()`. That is what the report's Save button did: it opens
 * a print window and the person chooses "Save as PDF" and a filename. Fine for
 * one property, and unusable for five — five dialogs, five filenames to type.
 * Ticking properties and pressing Download has to produce the files itself.
 *
 * HOW. The report is already laid out on screen exactly as it should read, so
 * it is drawn to an image (html2canvas) and placed on A4 pages (jsPDF). The
 * trade-off, said plainly: the pages are IMAGES of the report, not selectable
 * text. They look identical to the screen and print crisply (rendered at 2x),
 * but cannot be searched or copied from. The libraries are imported on demand,
 * so the ~600 KB they weigh is paid by the person who clicks Download, not by
 * everyone who opens the page.
 *
 * PAGE BREAKS. A report is cut where one SECTION ends and the next begins, not
 * at a fixed height — a straight slice halves a field's label from its value
 * and a row of the media table from its neighbours. A section taller than a
 * page is the one case that still has to be cut mid-way.
 */

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 8;

/** A name that is safe as a file on Windows, macOS and Linux. */
export function pdfFileName(...parts) {
  const base = parts.filter(Boolean).join(' - ').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return `${(base || 'Property report').slice(0, 120)}.pdf`;
}

/**
 * Where a page may end: the bottom edge of every section, in canvas pixels,
 * measured from the top of the report.
 */
function sectionBreaks(node, scale) {
  const top = node.getBoundingClientRect().top;
  return [...node.querySelectorAll('.pr-section, .pd-sub-block')]
    .map((el) => Math.round((el.getBoundingClientRect().bottom - top) * scale))
    .filter((y) => y > 0)
    .sort((a, b) => a - b);
}

/**
 * Cut `totalH` pixels into pages of at most `pageH`, ending each at the last
 * section boundary that fits, provided that leaves the page at least 40% full
 * (otherwise a tall first section would strand a nearly empty page).
 */
export function planPages(totalH, pageH, breaks) {
  const pages = [];
  let start = 0;
  while (start < totalH) {
    const limit = start + pageH;
    if (limit >= totalH) { pages.push([start, totalH]); break; }
    const fits = breaks.filter((y) => y > start + pageH * 0.4 && y <= limit);
    const end = fits.length ? fits[fits.length - 1] : limit;
    pages.push([start, end]);
    start = end;
  }
  return pages;
}

/**
 * Render `node` to a PDF and save it as `fileName`.
 * Anything marked `.no-print` (tick boxes, buttons) is left out of the page.
 */
export async function exportNodeToPdf(node, fileName) {
  if (!node) throw new Error('There is nothing to export for this property.');

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  /* Fonts and the letterhead logo are still arriving on a cold load; drawing
     before they do prints the fallback face and a gap where the logo goes. */
  if (document.fonts?.ready) await document.fonts.ready;

  const scale = 2;
  const breaks = sectionBreaks(node, scale);
  const canvas = await html2canvas(node, {
    scale,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    ignoreElements: (el) => el.classList?.contains('no-print'),
  });

  const contentW = PAGE_W_MM - MARGIN_MM * 2;
  const pxPerMm = canvas.width / contentW;
  const pageH = Math.floor((PAGE_H_MM - MARGIN_MM * 2) * pxPerMm);
  const pages = planPages(canvas.height, pageH, breaks);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  pages.forEach(([from, to], i) => {
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = Math.max(1, to - from);
    const ctx = slice.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, from, canvas.width, to - from, 0, 0, canvas.width, to - from);
    if (i > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_MM, MARGIN_MM, contentW, (to - from) / pxPerMm);
  });

  pdf.save(fileName);
  return { pages: pages.length };
}
