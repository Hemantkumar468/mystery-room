import { useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, AlertTriangle, ClipboardPaste, Rows3, Check, Info, FileUp,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { BULK_COLUMNS, VISIBILITIES, useBulkCreateInventoryItems } from '../../app/api/inventoryApi.js';

/**
 * Add many items at once — the other half of "add an item", and the half the
 * stores team actually needs.
 *
 * WHY TWO WAYS IN. A delivery arrives with eleven new things in it, and the
 * person entering them has them either in their head or already in a
 * spreadsheet. Those are different jobs: typing wants a grid you can tab
 * across, and a spreadsheet wants to be pasted in one go. Making the second
 * person retype what they already have is the thing that gets a master
 * abandoned, so both are here and they write through the same endpoint.
 *
 * A BLANK SKU IS MINTED SERVER-SIDE, which is why the column is first and
 * still optional. "What code shall I give it?" is the question that stops
 * somebody adding the thing at all, and the system can answer it better than
 * they can — see uniqueSku() in inventoryItem.model.js.
 *
 * PARTIAL SUCCESS IS THE POINT, and this is the screen that makes it legible.
 * Forty pasted lines with two bad ones add thirty-eight; the two stay in the
 * grid with the server's reason printed beneath them, ready to be fixed and
 * sent again. Refusing all forty would mean finding those two by hand.
 */

const blankRow = () => Object.fromEntries(BULK_COLUMNS.map((c) => [c.key, '']));

/** Four empty lines to start — enough to look like a grid, few enough not to look like homework. */
const startingRows = () => [blankRow(), blankRow(), blankRow(), blankRow()];

/**
 * Split one delimited line into cells, honouring quotes.
 *
 * Needed because the export this reads back writes RFC 4180: a vendor called
 * "Sharma, Bros" comes back as one quoted cell, and a naive `split(',')` would
 * shunt every later column one place left for that row only — the kind of
 * corruption nobody notices until the data is already in.
 */
function splitLine(line, delim) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cell); cell = ''; }
    else cell += ch;
  }
  out.push(cell);
  /* Our own export prefixes a cell starting with = + - @ with an apostrophe so
     spreadsheets do not treat it as a formula. Strip it on the way back in, or
     a round trip renames the item. */
  return out.map((c) => c.trim().replace(/^'(?=[=+\-@])/, ''));
}

/**
 * Turn a pasted block — or an uploaded file — into rows.
 *
 * TAB-SEPARATED FIRST, because that is what the clipboard holds after copying
 * cells out of Excel or Sheets, and it is the case worth being exact about.
 * Commas are accepted too, so a CSV exported from this very page can be edited
 * and fed straight back. A line with no delimiter at all is taken as a bare
 * item name — pasting a plain list of things is the other way people arrive
 * here, and demanding they add eight empty columns to it would be pedantry.
 *
 * THE HEADER IS MATCHED BY NAME, not dropped by position. Somebody exports,
 * reorders the columns in Excel and pastes it back; mapping by the header's
 * own words means that still lands in the right fields, and a file with no
 * header falls back to the documented column order. Without this, a reordered
 * paste silently files every vendor name as a category.
 */
function parsePaste(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];

  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : null;
  if (!delim) return lines.map((l) => ({ ...blankRow(), name: l.trim() }));

  /* The header's words → our keys. Loose on purpose: "Item name", "ITEM_NAME"
     and "name" are the same column, and insisting on one spelling would make
     this refuse the file it just produced. */
  const ALIASES = {
    sku: 'sku',
    name: 'name',
    itemname: 'name',
    item: 'name',
    category: 'category',
    unit: 'unit',
    uom: 'unit',
    visibility: 'visibility',
    status: null,
    vendor: 'vendorName',
    vendorname: 'vendorName',
    vendordetails: 'vendorDetails',
    vendorcontact: 'vendorDetails',
    contact: 'vendorDetails',
    price: 'price',
    priceinr: 'price',
    imageurl: 'imageUrl',
    image: 'imageUrl',
    notes: 'notes',
  };
  const norm = (s) => String(s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '');

  const first = splitLine(lines[0], delim);
  const mapped = first.map((h) => ALIASES[norm(h)]);
  /* A header only if at least two cells name a column we know AND one of them
     is the name or the SKU — otherwise a genuine first data row whose category
     happens to read "Unit" would be eaten. */
  const known = mapped.filter(Boolean);
  const isHeader = known.length >= 2 && (known.includes('name') || known.includes('sku'));

  const order = isHeader ? mapped : BULK_COLUMNS.map((c) => c.key);
  const body = isHeader ? lines.slice(1) : lines;

  return body.map((line) => {
    const row = blankRow();
    const cells = splitLine(line, delim);
    order.forEach((key, i) => {
      if (!key || !(key in row)) return;
      row[key] = cells[i] ?? '';
    });
    /* A visibility spelled differently ("listed", "LISTED") is worth accepting;
       anything else is left blank and the server defaults it, which is better
       than filing an item under a state nobody chose. */
    const v = VISIBILITIES.find((x) => x.toLowerCase() === String(row.visibility).toLowerCase());
    row.visibility = v || '';
    /* "₹1,250.00" is what a spreadsheet hands back for a price column. */
    row.price = String(row.price).replace(/[₹,\s]/g, '');
    return row;
  });
}


export default function InventoryBulkAddModal({ open, onClose, meta, onDone }) {
  const [mode, setMode] = useState('grid');        // 'grid' | 'paste' | 'file'
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const [rows, setRows] = useState(startingRows);
  const [paste, setPaste] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);      // the server's last answer

  const bulkCreate = useBulkCreateInventoryItems();

  const categories = meta?.categories || [];
  const units = meta?.units || [];
  const vendors = meta?.vendors || [];

  /** The lines that will actually be sent — a row with no name is just an empty line. */
  const filled = useMemo(() => rows.filter((r) => r.name.trim()), [rows]);

  /** Categories named in the grid that are not in the master yet, so the person
      can see that adding these items also adds those categories. */
  const newCategories = useMemo(() => {
    const known = new Set(categories.map((c) => c.name.toLowerCase()));
    return [...new Set(
      filled.map((r) => r.category.trim()).filter((c) => c && !known.has(c.toLowerCase())),
    )];
  }, [filled, categories]);

  const setCell = (i, key, value) => setRows((prev) => {
    const next = prev.slice();
    next[i] = { ...next[i], [key]: value };
    /* Typing in the last line grows the grid, so the form never runs out of
       room and nobody has to find the "add a row" button mid-flow. */
    if (i === prev.length - 1 && value.trim()) next.push(blankRow());
    return next;
  });

  const dropRow = (i) => setRows((prev) => (prev.length > 1 ? prev.filter((_, n) => n !== i) : [blankRow()]));

  const applyPaste = () => {
    const parsed = parsePaste(paste);
    if (!parsed.length) { setError('Nothing to read in that — paste rows copied from a spreadsheet, or one item name per line.'); return; }
    setError(null);
    setRows([...parsed, blankRow()]);
    setPaste('');
    setMode('grid');
    setResult(null);
  };


  /**
   * Read a dropped or chosen file into the same grid the paste box fills.
   *
   * READ IN THE BROWSER, not uploaded. The file becomes rows the person can
   * see and correct BEFORE anything is sent — which is the whole reason this
   * modal exists rather than a fire-and-forget upload endpoint. An import that
   * lands 400 rows and then reports what it disliked has already put them in.
   *
   * .xlsx is deliberately refused with an instruction rather than attempted: a
   * binary workbook needs a parser this bundle should not carry for a path
   * where "save as CSV" takes five seconds and loses nothing.
   */
  const readFile = (file) => {
    if (!file) return;
    setError(null);
    if (/.xlsx?$/i.test(file.name)) {
      setError(`${file.name} is an Excel workbook. Save it as CSV (File → Save As → CSV) and drop that in, or copy the cells and use the Paste tab.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError(`Could not read ${file.name}.`);
    reader.onload = () => {
      const parsed = parsePaste(String(reader.result || ''));
      if (!parsed.length) { setError(`${file.name} had no rows in it.`); return; }
      setRows([...parsed, blankRow()]);
      setMode('grid');
      setResult(null);
    };
    reader.readAsText(file);
  };

  const reset = () => { setRows(startingRows()); setPaste(''); setError(null); setResult(null); setMode('grid'); };

  const close = () => { reset(); onClose(); };

  const save = async () => {
    setError(null);
    if (!filled.length) { setError('Add at least one item name.'); return; }

    try {
      const res = await bulkCreate.mutateAsync(filled.map((r) => ({
        sku: r.sku.trim(),
        name: r.name.trim(),
        category: r.category.trim(),
        unit: r.unit.trim(),
        visibility: VISIBILITIES.includes(r.visibility) ? r.visibility : undefined,
        vendorName: r.vendorName.trim(),
        vendorDetails: r.vendorDetails.trim(),
        /* Blank stays null rather than 0 — "unpriced" and "free" are different
           answers and the master keeps them apart. A cell that is not a number
           is dropped rather than sent, so one bad price in a paste of forty
           does not have the server refuse the whole line. */
        price: r.price.trim() === '' || !Number.isFinite(Number(r.price)) ? null : Number(r.price),
        imageUrl: r.imageUrl.trim(),
      })));
      const payload = res?.data ?? res;
      setResult(payload);

      if (!payload.skipped?.length) {
        onDone?.(payload);
        close();
        return;
      }
      /* Only the refused lines are left in the grid. Everything that went in
         is gone from the form, so "what is still outstanding" is answered by
         looking at it rather than by reading a count. */
      const badIndexes = new Set(payload.skipped.map((s) => s.index));
      setRows([...filled.filter((_, i) => badIndexes.has(i)), blankRow()]);
      onDone?.(payload);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not add those.');
    }
  };

  /** The server's reason for refusing line `i`, if it refused it. */
  const reasonFor = (i) => result?.skipped?.find((s) => s.index === i)?.reason;

  if (!open) return null;

  return (
    <Modal
      open
      onClose={close}
      title="Import items"
      subtitle="Type them, paste from a spreadsheet, or drop a CSV. Leave the SKU blank and we'll mint one."
      width={1120}
      footer={(
        <div className="inv-bulk-foot">
          <span className="tiny muted">
            {filled.length
              ? <><b>{filled.length}</b> item{filled.length === 1 ? '' : 's'} ready
                {newCategories.length > 0 && <> · <b>{newCategories.length}</b> new categor{newCategories.length === 1 ? 'y' : 'ies'}</>}
              </>
              : 'Nothing to add yet.'}
          </span>
          <div className="row gap-2">
            <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={bulkCreate.isPending || !filled.length} onClick={save}>
              {bulkCreate.isPending ? 'Adding…' : `Add ${filled.length || ''} item${filled.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    >
      <div className="inv-bulk">
        <div className="inv-tabs">
          <button type="button" className={`inv-tab${mode === 'grid' ? ' is-on' : ''}`} onClick={() => setMode('grid')}>
            <Rows3 size={13} /> Type them
          </button>
          <button type="button" className={`inv-tab${mode === 'paste' ? ' is-on' : ''}`} onClick={() => setMode('paste')}>
            <ClipboardPaste size={13} /> Paste from a spreadsheet
          </button>
          <button type="button" className={`inv-tab${mode === 'file' ? ' is-on' : ''}`} onClick={() => setMode('file')}>
            <FileUp size={13} /> Upload a file
          </button>
        </div>

        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {/* The outcome of the last send, kept on screen. A toast would take the
            one thing somebody needs to act on away after four seconds.
            `.pt-alert` is already the warning treatment, so only the
            all-went-in case needs a variant of its own. */}
        {result && (
          <div className={`pt-alert${result.skipped?.length ? '' : ' inv-alert--ok'}`}>
            {result.skipped?.length ? <AlertTriangle size={14} /> : <Check size={14} />}
            <span>
              <b>{result.created}</b> added
              {result.skipped?.length ? <> · <b>{result.skipped.length}</b> left below to fix</> : null}
              {result.newCategories?.length ? <> · new categories: {result.newCategories.join(', ')}</> : null}
              {result.warnings?.length ? <> · {result.warnings.length} share a name with something already in the master</> : null}
            </span>
          </div>
        )}

        {mode === 'file' ? (
          <>
            <p className="inv-hint">
              Drop a <b>CSV</b> or <b>TSV</b> here — including one exported from this page, edited and
              brought back. Columns are matched by their heading, so reordering them in Excel is fine;
              a file with no heading is read in this order: <b>{BULK_COLUMNS.map((c) => c.label).join(' · ')}</b>.
            </p>
            {/* Read in the browser, never uploaded — see `readFile`. The rows
                land in the grid where they can be corrected BEFORE anything
                is sent. */}
            <div
              className={`inv-drop${dragging ? ' is-over' : ''}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files?.[0]); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}
            >
              <FileUp size={26} />
              <b style={{ fontSize: 13.5 }}>Drop a file, or click to choose one</b>
              <span className="tiny">.csv or .tsv · read in your browser, nothing is uploaded until you press Add</span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              style={{ display: 'none' }}
              onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </>
        ) : mode === 'paste' ? (
          <>
            <p className="inv-hint">
              Copy the cells straight out of Excel and paste them here — columns in this order:{' '}
              <b>{BULK_COLUMNS.map((c) => c.label).join(' · ')}</b>. A heading row is recognised and
              used to match the columns, so a reordered paste still lands correctly.
              One item name per line works too, if that is all you have.
            </p>
            <textarea
              className="inv-paste"
              autoFocus
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'SKU-VC5ZE5AI\tMasking Tape 2 inch\tStationary\tPiece\tListed\tJanta Pustak Bhandar\t1125449605\n\t3 Blower Sensor\tSensor\tPiece\tUnlisted\tChina Prop'}
            />
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={!paste.trim()} onClick={applyPaste}>
                Read {parsePaste(paste).length || ''} line{parsePaste(paste).length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="inv-bulk-wrap">
              <table className="inv-bulk-grid">
                <thead>
                  <tr>
                    <th className="inv-bulk-num">#</th>
                    {BULK_COLUMNS.map((c) => (
                      <th key={c.key} style={{ minWidth: c.width }}>
                        {c.label}
                        {c.hint && <small>{c.hint}</small>}
                      </th>
                    ))}
                    <th className="inv-bulk-drop" aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const reason = reasonFor(i);
                    return (
                      <tr key={i} className={reason ? 'is-bad' : ''}>
                        <td className="inv-bulk-num">{i + 1}</td>
                        {BULK_COLUMNS.map((c, ci) => (
                          <td key={c.key}>
                            {c.key === 'visibility' ? (
                              <select value={row.visibility} onChange={(e) => setCell(i, 'visibility', e.target.value)}>
                                <option value="">Unlisted (default)</option>
                                {VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                            ) : (
                              <input
                                autoFocus={i === 0 && ci === 1}
                                value={row[c.key]}
                                onChange={(e) => setCell(i, c.key, e.target.value)}
                                /* Free typing with suggestions, rather than a
                                   closed dropdown: a new category or a new
                                   supplier is exactly what a delivery of new
                                   things brings, and a list that cannot accept
                                   one sends people back to the spreadsheet. */
                                list={
                                  c.key === 'category' ? 'inv-dl-categories'
                                    : c.key === 'unit' ? 'inv-dl-units'
                                      : c.key === 'vendorName' ? 'inv-dl-vendors' : undefined
                                }
                                placeholder={c.key === 'sku' ? 'auto' : ''}
                              />
                            )}
                          </td>
                        ))}
                        <td className="inv-bulk-drop">
                          <button type="button" onClick={() => dropRow(i)} title="Remove this line">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {result?.skipped?.map((s) => (
                    <tr key={`why-${s.index}`} className="is-bad">
                      <td />
                      <td className="inv-bulk-reason" colSpan={BULK_COLUMNS.length + 1}>{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((p) => [...p, blankRow()])}>
                <Plus size={13} /> Add a line
              </button>
              <span className="tiny muted">
                <Info size={11} /> Typing in the last line adds another. Tab moves along the row.
              </span>
            </div>
          </>
        )}

        {newCategories.length > 0 && (
          <p className="inv-hint">
            <Check size={12} /> These categories will be created with the items:{' '}
            <b>{newCategories.join(', ')}</b>.
          </p>
        )}

        {/* One set of suggestion lists for the whole grid — a datalist per cell
            would be 9 × 40 copies of the same hundred-odd vendor names. */}
        <datalist id="inv-dl-categories">{categories.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        <datalist id="inv-dl-units">{units.map((u) => <option key={u} value={u} />)}</datalist>
        <datalist id="inv-dl-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
      </div>
    </Modal>
  );
}
