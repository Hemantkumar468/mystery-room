/**
 * A spreadsheet READER in one file, with no dependency.
 *
 * The companion to miniXlsx.mjs, which writes. The same reasoning applies and
 * is worth restating: this repo has no spreadsheet package, and pulling one in
 * so a migration script can read a single export is a dependency the whole
 * project then carries — audited, updated and shipped — long after the script
 * has run once. An .xlsx is a ZIP of XML parts, and the subset a plain
 * header-plus-rows table needs is small enough to read honestly.
 *
 * WHAT IT DOES NOT DO, deliberately: no formulas (the cached `<v>` is taken as
 * the value), no styles, no date conversion — a serial date comes back as the
 * number Excel stored. Nothing in the sheets this repo imports uses any of
 * them, and the day one does, that belongs in a library rather than here.
 *
 * WHY IT INFLATES where the writer only stores. Files written by Excel itself
 * are deflated, so reading one means a real inflate — `zlib.inflateRawSync`,
 * which is in Node's standard library and costs nothing to reach for.
 */
import fs from 'fs';
import zlib from 'zlib';

/* ── ZIP ───────────────────────────────────────────────────────────────── */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * Every entry in the archive, by name.
 *
 * The end-of-central-directory record is searched for backwards from the tail,
 * because it is the only structure in a ZIP whose position is not recorded
 * anywhere — it carries a variable-length comment after it, so the format
 * gives no way to find it other than looking.
 */
function unzip(buf) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66_000); /* 64K comment + the record */
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record) — is the file really an .xlsx?');

  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (at === 0xFFFFFFFF) throw new Error('ZIP64 archives are not supported by this reader.');

  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(at) !== SIG_CENTRAL) throw new Error('Corrupt central directory.');
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);

    if (buf.readUInt32LE(localAt) !== SIG_LOCAL) throw new Error(`Corrupt local header for "${name}".`);
    /* The local header repeats the name and extra lengths, and they are NOT
       always the same as the central directory's — Excel writes extra fields
       into one and not the other — so the data offset must be computed from
       the local header's own numbers. */
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const raw = buf.subarray(dataAt, dataAt + compressed);

    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`"${name}" uses an unsupported compression method (${method}).`);

    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ── XML ───────────────────────────────────────────────────────────────── */

/* `&amp;` is undone LAST, so a literal "&amp;lt;" in a cell survives as the
   text "&lt;" instead of turning into "<". */
const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** All the `<t>` text under one node, joined — a rich-text run per fragment. */
const textOf = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
  .map((m) => unescapeXml(m[1]))
  .join('');

/** "BC" → 54. Excel addresses columns by letter; arrays want an index. */
function columnIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ── the sheet ─────────────────────────────────────────────────────────── */

/**
 * Read one worksheet as a grid of strings.
 *
 * Empty cells come back as `''` rather than being absent, and short rows are
 * padded to the widest row, so a caller can index a column without checking
 * whether that particular row happened to have a value in it.
 */
function grid(sheetXml, shared) {
  const rows = [];
  let width = 0;

  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/>/g)) {
    const body = rowMatch[1] ?? '';
    const cells = [];
    for (const cellMatch of body.matchAll(/<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];

      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(inner);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v != null) value = unescapeXml(v);

      /* An unreferenced cell simply follows the previous one — the format
         allows `r` to be omitted, and a few exporters do. */
      const at = ref ? columnIndex(ref[1]) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    width = Math.max(width, cells.length);
    rows.push(cells);
  }

  return rows.map((r) => {
    const padded = r.slice();
    while (padded.length < width) padded.push('');
    return padded.map((c) => (c == null ? '' : String(c)));
  });
}

/**
 * Read a workbook.
 *
 * @param {string} file  path to the .xlsx
 * @param {{ sheet?: number }} [opts]  which sheet, 0-based (default: the first)
 * @returns {{ header: string[], rows: object[], grid: string[][] }}
 *          `rows` are objects keyed by the header cell above them — trimmed,
 *          because a header read out of a hand-maintained export routinely
 *          carries a trailing space and nobody should have to know that.
 */
export function readXlsx(file, { sheet = 0 } = {}) {
  const files = unzip(fs.readFileSync(file));

  const sharedXml = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  /* The workbook lists its sheets in display order; the parts they live in are
     named by relationship id, not by position, so the order of
     `worksheets/sheetN.xml` is not reliably the order shown in Excel. */
  const workbook = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const sheetTags = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]);
  if (!sheetTags.length) throw new Error('The workbook declares no sheets.');
  if (sheet >= sheetTags.length) throw new Error(`The workbook has ${sheetTags.length} sheet(s); sheet ${sheet} was asked for.`);

  const rid = /r:id="([^"]+)"/.exec(sheetTags[sheet])?.[1];
  const target = rid
    ? new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1]
    : null;
  const part = target
    ? `xl/${String(target).replace(/^\/?xl\//, '').replace(/^\//, '')}`
    : `xl/worksheets/sheet${sheet + 1}.xml`;

  const sheetXml = (files.get(part) ?? files.get(`xl/worksheets/sheet${sheet + 1}.xml`))?.toString('utf8');
  if (!sheetXml) throw new Error(`Could not find the worksheet part "${part}" inside the workbook.`);

  const cells = grid(sheetXml, shared);
  if (!cells.length) return { header: [], rows: [], grid: [] };

  const header = cells[0].map((h) => h.trim());
  const rows = cells.slice(1)
    /* A wholly blank line is the gap an author left below the table, not a
       record — Excel keeps writing `<row>` for it. */
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h || `column${i + 1}`, (r[i] ?? '').trim()])));

  return { header, rows, grid: cells };
}

export default readXlsx;
