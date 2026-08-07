import { useMemo, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { Avatar } from './primitives.jsx';
import { useUsers } from '../../app/api/usersApi.js';
import { DEPT_META } from '../../lib/ui.js';

/**
 * Rich user picker — shows Name, Employee ID, Department, and Email per
 * candidate instead of a bare name in a native <select>, since a name alone
 * doesn't disambiguate people in a real org (two "Rahul"s, a stale employee
 * record, etc.). Generic enough to reuse anywhere a form needs to assign a
 * person to a field — not specific to Branch.manager, so future EMS forms
 * (Vendor contact owner, Expense approver overrides, …) can reuse it as-is.
 */
export function UserPicker({
  value, onChange, placeholder = 'Search by name, employee ID, department, or email…',
  allowClear = true, department = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Scoped when a department is given, everyone when it is not. Narrowing is
  // a convenience, never a precondition: a picker that refuses to list anyone
  // until some other field is filled in reads as broken.
  const { data: users } = useUsers(department ? { department } : {});
  const list = users || [];
  const selected = useMemo(() => list.find((u) => u._id === value), [list, value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((u) => (
      u.name?.toLowerCase().includes(q)
      || u.employeeId?.toLowerCase().includes(q)
      || u.email?.toLowerCase().includes(q)
      || u.department?.toLowerCase().includes(q)
    ));
  }, [list, query]);

  const summaryLine = (u) => {
    const dept = DEPT_META[u.department] || u.department || '—';
    return `${u.employeeId || '—'} · ${dept} · ${u.email}`;
  };

  if (selected && !open) {
    return (
      <div className="row gap-2 user-picker-selected" style={{ alignItems: 'center' }}>
        <Avatar name={selected.name} color={selected.avatarColor} size={26} />
        <div className="col" style={{ lineHeight: 1.2, flex: 1 }}>
          <span className="sm" style={{ fontWeight: 600 }}>{selected.name}</span>
          <span className="tiny muted">{summaryLine(selected)}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Change</button>
        {allowClear && (
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => onChange(null)} aria-label="Clear selection">
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="col gap-1 user-picker">
      <div className="row gap-2 user-picker-search" style={{ alignItems: 'center' }}>
        <Search size={14} className="muted" />
        <input
          className="input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={open}
        />
      </div>
      <div className="user-picker-list">
        {filtered.length === 0 && (
          <div className="sm muted" style={{ padding: 8 }}>
            {department
              ? `Nobody in ${DEPT_META[department] || department} matches. Clear the department to search everyone.`
              : 'No matches'}
          </div>
        )}
        {filtered.map((u) => (
          <button
            type="button"
            key={u._id}
            className={`user-picker-row${u._id === value ? ' active' : ''}`}
            onClick={() => { onChange(u._id); setOpen(false); setQuery(''); }}
          >
            <Avatar name={u.name} color={u.avatarColor} size={26} />
            <div className="col" style={{ lineHeight: 1.2, flex: 1, textAlign: 'left' }}>
              <span className="sm" style={{ fontWeight: 600 }}>{u.name}</span>
              <span className="tiny muted">{summaryLine(u)}</span>
            </div>
            {u._id === value && <Check size={14} className="muted" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export default UserPicker;
