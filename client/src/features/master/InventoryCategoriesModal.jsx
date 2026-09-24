import { useMemo, useState } from 'react';
import {
  Pencil, Check, X as XIcon, Archive, RotateCcw, AlertTriangle, Plus, Tag,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  useInventoryCategories,
  useCreateInventoryCategory,
  useUpdateInventoryCategory,
  useArchiveInventoryCategory,
} from '../../app/api/inventoryApi.js';

/**
 * The category list the inventory master is filed under.
 *
 * WHY IT IS A MANAGED LIST rather than whatever strings happen to be on the
 * items. Two things people asked for that a distinct-values query cannot do:
 * set up a category before anything is in it, and rename one without editing
 * every item by hand and creating a near-duplicate with the fiftieth. The
 * rename here rewrites the items with it, in one call — see
 * inventoryService.renameCategory.
 *
 * ADDING IS A TEXTAREA, one name per line, because somebody setting up a
 * section of the master has six of them written down already and six trips
 * through a one-field form is five trips too many.
 *
 * LOOSE SPELLINGS — a category that is on items but not in this list — are
 * shown dashed with an "adopt" button. They are the four compound spellings the
 * BoxHero export brought in ("Electronics , Game Elements") plus anything typed
 * freehand since. Hiding them would make the list disagree with the items;
 * adopting one is a click rather than a retype.
 */
export default function InventoryCategoriesModal({ open, onClose, meta }) {
  const { data, isLoading } = useInventoryCategories();
  const create = useCreateInventoryCategory();
  const update = useUpdateInventoryCategory();
  const archive = useArchiveInventoryCategory();

  const [names, setNames] = useState('');
  const [editing, setEditing] = useState(null);   // id
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const curated = data?.data || data || [];

  /** How many live items sit under each name — straight off the page's meta read. */
  const countOf = useMemo(() => {
    const m = new Map();
    for (const c of meta?.categories || []) m.set(c.name, c.count);
    return m;
  }, [meta]);

  /* On items, but not in the curated list. See the note above. */
  const loose = useMemo(() => {
    const known = new Set(curated.map((c) => c.name));
    return (meta?.categories || []).filter((c) => !c.curated && !known.has(c.name));
  }, [curated, meta]);

  const parsedNames = useMemo(
    () => [...new Set(names.split('\n').map((n) => n.trim()).filter(Boolean))],
    [names],
  );

  const addMany = async () => {
    setError(null); setNote(null);
    if (!parsedNames.length) { setError('Type at least one category name.'); return; }
    try {
      const res = await create.mutateAsync({ names: parsedNames });
      const added = (res?.data ?? res)?.added || [];
      setNames('');
      setNote(added.length
        ? `Added: ${added.join(', ')}.`
        : 'Every one of those was already in the list.');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not add those.');
    }
  };

  const startRename = (c) => { setEditing(c._id); setDraft(c.name); setError(null); setNote(null); };

  const commitRename = async (c) => {
    const next = draft.trim();
    if (!next || next === c.name) { setEditing(null); return; }
    try {
      await update.mutateAsync({ id: c._id, name: next });
      const moved = countOf.get(c.name) || 0;
      setNote(moved
        ? `"${c.name}" is now "${next}" — ${moved} item${moved === 1 ? '' : 's'} moved with it.`
        : `"${c.name}" is now "${next}".`);
      setEditing(null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not rename that.');
    }
  };

  const toggleActive = async (c) => {
    setError(null); setNote(null);
    try {
      if (c.active === false) await update.mutateAsync({ id: c._id, active: true });
      else await archive.mutateAsync(c._id);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not change that.');
    }
  };

  const adopt = async (name) => {
    setError(null); setNote(null);
    try {
      await create.mutateAsync({ names: [name] });
      setNote(`"${name}" is now in the list.`);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not adopt that one.');
    }
  };

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Categories"
      subtitle="What the inventory master is filed under. Renaming one moves its items with it."
      width={620}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      )}
    >
      <div className="inv-cats">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
        {note && <div className="pt-alert inv-alert--ok"><Check size={14} /> {note}</div>}

        <div className="inv-cat-add">
          <label className="pt-field">
            <span>Add categories — one per line</span>
            <textarea
              rows={3}
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder={'Safety Gear\nAudio\nSpare Parts'}
            />
          </label>
          <div className="row gap-2" style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
            <span className="tiny muted">
              {parsedNames.length ? `${parsedNames.length} to add` : 'A category can exist before anything is in it.'}
            </span>
            <button type="button" className="btn btn-primary btn-sm" disabled={create.isPending || !parsedNames.length} onClick={addMany}>
              <Plus size={13} /> {create.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>

        {isLoading ? <span className="tiny muted">Loading…</span> : (
          <div className="inv-cat-list">
            {curated.map((c) => (
              <div key={c._id} className={`inv-cat${c.active === false ? ' is-off' : ''}`}>
                <Tag size={13} style={{ flex: 'none', color: 'var(--text-subtle)' }} />
                <span className="inv-cat-name">
                  {editing === c._id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(c); }
                        if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                      }}
                    />
                  ) : c.name}
                </span>
                <span className="inv-cat-count">{countOf.get(c.name) || 0} items</span>
                <span className="inv-cat-actions">
                  {editing === c._id ? (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" title="Save" onClick={() => commitRename(c)}>
                        <Check size={13} />
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" title="Cancel" onClick={() => setEditing(null)}>
                        <XIcon size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" title="Rename — its items move with it" onClick={() => startRename(c)}>
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title={c.active === false ? 'Offer it again' : 'Retire — items already filed under it keep it'}
                        onClick={() => toggleActive(c)}
                      >
                        {c.active === false ? <RotateCcw size={12} /> : <Archive size={12} />}
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}

            {loose.map((c) => (
              <div key={`loose-${c.name}`} className="inv-cat is-loose">
                <Tag size={13} style={{ flex: 'none', color: 'var(--warning)' }} />
                <span className="inv-cat-name">{c.name}</span>
                <span className="inv-cat-count">{c.count} items · not in the list</span>
                <span className="inv-cat-actions">
                  <button type="button" className="btn btn-ghost btn-sm" title="Add it to the list" onClick={() => adopt(c.name)}>
                    <Plus size={13} />
                  </button>
                </span>
              </div>
            ))}

            {!curated.length && !loose.length && (
              <span className="tiny muted" style={{ padding: 8 }}>No categories yet — add the first above.</span>
            )}
          </div>
        )}

        <p className="inv-hint">
          Retiring a category stops it being offered on the form. Items already filed under it keep
          their category and keep reading exactly as they do now.
        </p>
      </div>
    </Modal>
  );
}
