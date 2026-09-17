import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X as XIcon, Warehouse, Store, Handshake } from 'lucide-react';
import { useGetInventoryQuery } from '../../app/api/inventoryApi.js';
import { STOCK_STATUS } from '../../app/api/imsApi.js';
import { n, Thumb } from '../master/inventoryUi.jsx';

/**
 * The pieces the IMS screens are built from.
 *
 * Deliberately small and shared: the stock bar, the status pill and the item
 * picker each appear on three or four screens, and three copies of "what
 * counts as low" or "how do I find an item among 1,322" is three chances for
 * two screens to answer the same question differently.
 */

/**
 * How much is here, against how much ought to be.
 *
 * WHY A BAR AND NOT JUST NUMBERS. "14 / 20" makes the reader do a comparison
 * for every row; over fifty rows that is fifty small acts of arithmetic, and
 * the one that matters gets missed. The bar does the comparison, and the tick
 * marks where the safety level sits, so "am I under the line" is answered
 * before either number is read.
 *
 * The fill is capped at 100% but the NUMBERS are not — holding three times the
 * floor is a full bar and a large number, which is exactly right: overstocked
 * is not a problem this bar exists to flag, and a bar that overflowed its
 * track to say so would make every healthy row look broken.
 */
export function StockBar({ onHand = 0, safetyStock = 0, status = 'unset' }) {
  const hasFloor = safetyStock > 0;
  /* With no floor there is nothing to be a fraction OF, so the bar shows
     presence rather than a ratio — full if anything is there, empty if not. */
  const pct = hasFloor
    ? Math.min(100, Math.round((onHand / safetyStock) * 100))
    : (onHand > 0 ? 100 : 0);

  return (
    <div className="ims-qty">
      <span className="ims-qty-nums">
        <span className="ims-qty-on">{n(onHand)}</span>
        <span className="ims-qty-min">{hasFloor ? `/ ${n(safetyStock)} min` : 'no floor set'}</span>
      </span>
      <span className={`ims-bar ims-bar--${status}`} title={hasFloor ? `${pct}% of the safety level` : 'No safety level set here'}>
        <span className="ims-bar-fill" style={{ width: `${pct}%` }} />
        {/* The floor, drawn on the bar. Only where the fill can overshoot it —
            at 100% the mark would sit on the end cap and read as a glitch. */}
        {hasFloor && pct < 100 && <span className="ims-bar-mark" style={{ left: '100%' }} />}
      </span>
    </div>
  );
}

/** The server decides the status; this only says how to draw it. See imsApi.js. */
export function StatusPill({ status }) {
  const s = STOCK_STATUS[status] || STOCK_STATUS.unset;
  return <span className={`ims-status ims-status--${s.tone}`} title={s.hint}>{s.label}</span>;
}

const LOCATION_ICON = { warehouse: Warehouse, outlet: Store, franchise: Handshake };

/** The location's kind, as an icon that matches the colour on its card. */
export function LocationIcon({ type = 'outlet', size = 18 }) {
  const Icon = LOCATION_ICON[type] || Store;
  return (
    <span className={`ims-loc-icon ims-loc-icon--${type}`}>
      <Icon size={size} />
    </span>
  );
}

/**
 * Find one catalogue item among 1,322.
 *
 * A `<select>` is not an option at this size — the browser would build a list
 * box of 1,322 nodes and the person would still have to scroll it. This is a
 * search box that queries the SERVER (the same paged endpoint the master page
 * uses, limited to eight) and shows what it finds. Nothing is held in the
 * browser, so it stays exactly as fast at ten thousand items.
 *
 * SEARCHES BY SKU AS WELL AS NAME, because the person standing at a shelf with
 * a box in their hand is reading a code off a label, not recalling a name.
 *
 * `exclude` is the items already on the form — offering one twice would let
 * somebody add the same SKU on two lines, and the two would fight over the
 * same balance on the way in.
 */
export function ItemPicker({ onPick, exclude = [], placeholder = 'Search an item by name or SKU…', autoFocus = false }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  /* No query until something is typed: an empty picker must not fetch the
     first eight items of the master every time a drawer opens. */
  const { data: raw, isFetching } = useGetInventoryQuery(
    { search: debounced, limit: 8, sort: 'name' },
    { skip: debounced.length < 2 },
  );

  const excluded = useMemo(() => new Set(exclude.map(String)), [exclude]);
  const results = useMemo(() => {
    const payload = raw?.rows ? raw : (raw?.data ?? {});
    return (payload.rows || []).filter((r) => !excluded.has(String(r._id)));
  }, [raw, excluded]);

  /* Click anywhere else and the list goes away — a floating panel that stays
     open over the form underneath is a panel people close by reloading. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => { setActive(0); }, [debounced]);

  const choose = (item) => {
    onPick(item);
    setTerm('');
    setDebounced('');
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
  };

  return (
    <div className="ims-picker" ref={box}>
      <label className="inv-search" style={{ maxWidth: 'none', width: '100%' }}>
        <Search size={15} />
        <input
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
        />
        {term && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 2 }} onClick={() => { setTerm(''); setOpen(false); }} aria-label="Clear">
            <XIcon size={13} />
          </button>
        )}
      </label>

      {open && debounced.length >= 2 && (
        <div className="ims-picker-results">
          {isFetching && results.length === 0 ? (
            <div className="ims-picker-empty">Searching…</div>
          ) : results.length === 0 ? (
            <div className="ims-picker-empty">
              Nothing matches “{debounced}”.
              <br />
              <span className="tiny">Items are added on Master Data → Item Master.</span>
            </div>
          ) : results.map((item, i) => (
            <button
              key={item._id}
              type="button"
              className={`ims-picker-row${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
            >
              <Thumb src={item.imageUrl} alt={item.name} size={28} radius={7} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="inv-ellipsis" style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</span>
                <span className="tiny muted">{item.category || 'Unfiled'}{item.unit ? ` · ${item.unit}` : ''}</span>
              </span>
              <span className="inv-sku">{item.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
