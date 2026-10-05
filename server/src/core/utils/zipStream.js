import { crc32 } from 'node:zlib';

/**
 * A ZIP, WRITTEN AS IT IS STREAMED — no library, no temp file, no buffering a
 * whole archive in memory.
 *
 * WHY HAND-ROLLED. The one thing needed is "put these N files in one download",
 * and that is a small, stable format. Adding an archiver dependency for it
 * means a new package to keep patched on a server that otherwise has no use
 * for one; this is ~80 lines and is checked against a real unzip in the tests.
 *
 * HOW. Every entry is STORED (method 0, uncompressed). The files are photos,
 * videos and PDFs — already compressed — so deflating them costs CPU and saves
 * almost nothing. Sizes and CRCs are not known until a file has been read to
 * the end, so each entry uses a DATA DESCRIPTOR (flag bit 3): the local header
 * says "the numbers follow the data", and the real figures are written right
 * after it and again in the central directory at the end. That is what lets a
 * file be streamed straight from storage without being held first.
 *
 * LIMITS, said plainly: no ZIP64, so an archive past 4 GB or a single file past
 * 4 GB is refused rather than written corrupt; names are UTF-8 (flag bit 11).
 */

const U32_MAX = 0xffffffff;

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

/** MS-DOS date and time, which is what a ZIP entry stores. */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

/** A name that is safe INSIDE an archive: no path climbing, no separators, never empty. */
export function safeEntryName(raw, fallback = 'file') {
  const cleaned = String(raw ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || fallback;
}

/** "a.jpg", then "a (2).jpg", "a (3).jpg" — two files with one name must not overwrite each other. */
export function uniqueName(name, taken) {
  if (!taken.has(name)) { taken.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (taken.has(`${stem} (${i})${ext}`)) i += 1;
  const next = `${stem} (${i})${ext}`;
  taken.add(next);
  return next;
}

/**
 * Write `entries` as one zip to `out` (any writable: an HTTP response, a file).
 *
 * @param entries  async-iterable-friendly: [{ name, stream: () => AsyncIterable<Buffer>|Readable }]
 *                 `stream` is a function so a file is opened only when its turn
 *                 comes — forty entries do not mean forty open connections.
 * @param out      a Writable
 * @returns        { written: string[], failed: [{name, error}] } — a file that
 *                 cannot be read is SKIPPED and reported, never left half-written
 *                 in the archive.
 */
export async function writeZip(entries, out) {
  const central = [];
  const written = [];
  const failed = [];
  let offset = 0;

  /* ONE error listener for the whole archive. This used to attach a fresh one
     on every chunk written — a 6 MB file in 64 KB pieces left a hundred of them
     on the stream and tripped Node's leak warning, and on a real download of a
     few videos it would have been thousands. A write that fails (the browser
     closed the connection) rejects the NEXT write, which ends the archive. */
  let streamError = null;
  out.once('error', (err) => { streamError = err; });

  const write = (buf) => new Promise((resolve, reject) => {
    if (streamError) { reject(streamError); return; }
    offset += buf.length;
    if (out.write(buf)) { resolve(); return; }
    const onDrain = () => { out.off('error', onErr); resolve(); };
    const onErr = (err) => { out.off('drain', onDrain); reject(err); };
    out.once('drain', onDrain);
    out.once('error', onErr);
  });

  const { time, date } = dosDateTime();

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const flags = 0x0008 | 0x0800;               // data descriptor + UTF-8 names
    const headerOffset = offset;

    /* Open it BEFORE writing anything for it: if storage says no, nothing for
       this entry has reached the archive yet, so skipping it leaves no hole. */
    let source;
    try {
      source = await entry.stream();
    } catch (err) {
      failed.push({ name: entry.name, error: err.message || String(err) });
      continue;
    }

    await write(Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(0), u16(time), u16(date),
      u32(0), u32(0), u32(0), u16(nameBuf.length), u16(0), nameBuf,
    ]));

    let crc = 0;
    let size = 0;
    try {
      for await (const chunk of source) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        crc = crc32(buf, crc);
        size += buf.length;
        if (size > U32_MAX) throw new Error('File is larger than 4 GB, which this zip format cannot hold');
        await write(buf);
      }
    } catch (err) {
      /* Mid-file failure: the header is out, so the entry cannot be taken back.
         Abort the whole archive rather than ship one that unzips with an error. */
      throw Object.assign(new Error(`Could not finish "${entry.name}": ${err.message}`), { zipAborted: true });
    }

    await write(Buffer.concat([u32(0x08074b50), u32(crc), u32(size), u32(size)]));
    central.push({ nameBuf, flags, crc, size, headerOffset, time, date });
    written.push(entry.name);
  }

  const dirStart = offset;
  for (const c of central) {
    if (c.headerOffset > U32_MAX) throw new Error('Archive is larger than 4 GB, which this zip format cannot hold');
    await write(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(c.flags), u16(0), u16(c.time), u16(c.date),
      u32(c.crc), u32(c.size), u32(c.size), u16(c.nameBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(c.headerOffset), c.nameBuf,
    ]));
  }
  const dirSize = offset - dirStart;
  await write(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(dirSize), u32(dirStart), u16(0),
  ]));

  return { written, failed };
}
