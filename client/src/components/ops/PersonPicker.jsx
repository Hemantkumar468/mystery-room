import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { usePeople } from '../../lib/opsQueries.js';
import { Avatar } from '../ui/primitives.jsx';

/**
 * Searchable people picker. Single (`value` = id) or multi (`multiple`,
 * `value` = ids[]). `recentIds` float to the top so familiar people come first.
 */
export function PersonPicker({
  value,
  onChange,
  multiple = false,
  placeholder = 'Select a person…',
  recentIds = [],
  exclude = [],
  filter,
  allowClear = true,
  disabled = false,
}) {
  const { data: people = [] } = usePeople(filter);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = multiple ? value || [] : value ? [value] : [];
  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p._id, p])), [people]);

  const options = useMemo(() => {
    const rank = new Map(recentIds.map((id, i) => [id, i]));
    const needle = q.trim().toLowerCase();
    return people
      .filter((p) => !exclude.includes(p._id))
      .filter((p) => !needle || `${p.name} ${p.title || ''} ${p.department || ''}`.toLowerCase().includes(needle))
      .sort((a, b) => (rank.get(a._id) ?? 999) - (rank.get(b._id) ?? 999) || a.name.localeCompare(b.name));
  }, [people, q, recentIds, exclude]);

  const toggle = (id) => {
    if (multiple) {
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    } else {
      onChange(id);
      setOpen(false);
    }
  };

  // Escape closes just the dropdown — not the modal or drawer the picker sits in.
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className={`picker ${disabled ? 'disabled' : ''}`} ref={ref} onKeyDown={onKeyDown}>
      <button type="button" className="picker-trigger input" onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled}>
        {selected.length === 0 && <span className="subtle">{placeholder}</span>}
        {!multiple && selected[0] && (
          <span className="row gap-2">
            <Avatar name={byId[selected[0]]?.name} color={byId[selected[0]]?.avatarColor} size={20} />
            {byId[selected[0]]?.name || 'Unknown'}
          </span>
        )}
        {multiple && selected.length > 0 && (
          <span className="row gap-1 wrap">
            {selected.map((id) => (
              <span key={id} className="chip chip-sm">
                {byId[id]?.name || '…'}
                <X
                  size={12}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(id);
                  }}
                />
              </span>
            ))}
          </span>
        )}
        <span className="row gap-1" style={{ marginLeft: 'auto' }}>
          {allowClear && selected.length > 0 && !multiple && (
            <X
              size={14}
              className="subtle"
              onClick={(e) => {
                e.stopPropagation();
                onChange(multiple ? [] : '');
              }}
            />
          )}
          <ChevronDown size={15} className="subtle" />
        </span>
      </button>

      {open && (
        <div className="picker-panel fade-in">
          <div className="row gap-2 picker-search">
            <Search size={14} className="subtle" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" />
          </div>
          <div className="picker-list">
            {options.map((p) => {
              const on = selected.includes(p._id);
              return (
                <button type="button" key={p._id} className={`picker-option ${on ? 'on' : ''}`} onClick={() => toggle(p._id)}>
                  <Avatar name={p.name} color={p.avatarColor} size={26} />
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 600 }}>{p.name}</span>
                    <span className="tiny muted truncate">
                      {[p.title, p.branch?.name].filter(Boolean).join(' · ') || p.role}
                    </span>
                  </span>
                  {recentIds.includes(p._id) && <span className="tiny subtle">recent</span>}
                  {on && <Check size={15} style={{ color: 'var(--primary)' }} />}
                </button>
              );
            })}
            {!options.length && <div className="empty sm" style={{ padding: 16 }}>No one matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default PersonPicker;
