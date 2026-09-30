import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Plus, Tag, Tags, CalendarDays, LayoutTemplate, Pencil, Trash2, Check, X, ChevronLeft, ChevronRight, Info, ListPlus,
} from 'lucide-react';
import '../../styles/ops-org.css';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable, SkBlock } from '../../components/ui/Skeletons.jsx';
import { Segmented } from '../../components/ops/common.jsx';
import { toast } from '../../components/ops/toast.jsx';
import {
  useCatalog, useSaveCatalog, useDeleteCatalog, useHolidays, useAddHolidays, useDeleteHoliday,
} from '../../lib/opsQueries.js';
import { errMsg } from '../../lib/opsUi.js';
import { fmtDate } from '../../lib/format.js';
import { useMe, ColorSwatches, ConfirmModal, SWATCHES } from './orgCommon.jsx';
import { TemplatesPanel } from './TemplatesPanel.jsx';
import { useAccess } from '../../hooks/useAccess.js';

const TABS = [
  { value: 'categories', label: 'Categories', icon: Tag },
  { value: 'tags', label: 'Tags', icon: Tags },
  { value: 'holidays', label: 'Holidays', icon: CalendarDays },
  { value: 'templates', label: 'Task templates', icon: LayoutTemplate },
];

export function OpsSettingsPage() {
  const me = useMe();
  /* Curating these lists is an Ops-settings write; catalog.routes.js gates
     the same surface, so the panels go read-only rather than 403 on save. */
  const mayCurate = useAccess().step('org-settings', 'edit');
  const [tab, setTab] = useState('categories');

  return (
    <>
      <Topbar title="Operations settings" subtitle="The shared vocabulary of delegation and checklists — categories, tags, holidays and task templates" />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          <div><Segmented value={tab} onChange={setTab} options={TABS} /></div>
          {tab === 'categories' && <CatalogPanel key="categories" kind="categories" canEdit={me.canCurate && mayCurate} />}
          {tab === 'tags' && <CatalogPanel key="tags" kind="tags" canEdit={me.canCurate && mayCurate} />}
          {tab === 'holidays' && <HolidaysPanel canEdit={me.isAdmin} />}
          {tab === 'templates' && <TemplatesPanel me={me} />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Categories & tags                                                   */
/* ------------------------------------------------------------------ */

function CatalogPanel({ kind, canEdit }) {
  const isCat = kind === 'categories';
  const noun = isCat ? 'category' : 'tag';
  const Noun = isCat ? 'Category' : 'Tag';
  const { data: items, isLoading, isError, error } = useCatalog(kind);
  const save = useSaveCatalog(kind);
  const del = useDeleteCatalog(kind);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState({ name: '', color: '' });
  const [deleting, setDeleting] = useState(null);

  const sorted = useMemo(() => [...(items || [])].sort((a, b) => a.name.localeCompare(b.name)), [items]);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await save.mutateAsync({ name: name.trim(), color });
      toast.success(`${Noun} “${name.trim()}” added`);
      setName('');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const startEdit = (item) => {
    setEditId(item._id);
    setDraft({ name: item.name, color: item.color || SWATCHES[0] });
  };

  const saveEdit = async (item) => {
    if (!draft.name.trim()) return;
    try {
      const res = await save.mutateAsync({ _id: item._id, name: draft.name.trim(), color: draft.color });
      const n = res?.meta?.cascaded || 0;
      toast.success(n ? `${Noun} renamed — ${n} task${n === 1 ? '' : 's'} updated` : `${Noun} saved`);
      setEditId(null);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const remove = async () => {
    try {
      await del.mutateAsync(deleting._id);
      toast.success(`${Noun} “${deleting.name}” deleted`);
    } catch (err) {
      toast.error(errMsg(err));
      throw err;
    }
  };

  return (
    <div className="col gap-4">
      {canEdit && (
        <div className="card card-pad col gap-3">
          <form className="catalog-add" onSubmit={add}>
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={`New ${noun} name…`} />
            <ColorSwatches value={color} onChange={setColor} small />
            <button className="btn btn-primary" type="submit" disabled={!name.trim() || save.isPending}>
              <Plus size={15} /> Add {noun}
            </button>
          </form>
          {isCat && (
            <div className="info-line"><Info size={14} /> Renaming a category renames it on existing tasks too.</div>
          )}
        </div>
      )}

      {isLoading ? (
        <SkTable rows={5} />
      ) : isError ? (
        <div className="card"><EmptyState icon={Tag} title={`Couldn't load ${kind}`} hint={errMsg(error)} /></div>
      ) : !sorted.length ? (
        <div className="card"><EmptyState icon={isCat ? Tag : Tags} title={`No ${kind} yet`} hint={canEdit ? `Add the first ${noun} above.` : undefined} /></div>
      ) : (
        <div className="card">
          {sorted.map((item) =>
            editId === item._id ? (
              <div className="catalog-row" key={item._id}>
                <span className="color-dot" style={{ background: draft.color }} />
                <input
                  className="input"
                  style={{ maxWidth: 260 }}
                  autoFocus
                  value={draft.name}
                  maxLength={60}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(item);
                    if (e.key === 'Escape') setEditId(null);
                  }}
                />
                <ColorSwatches value={draft.color} onChange={(c) => setDraft((d) => ({ ...d, color: c }))} small />
                <div className="row gap-1" style={{ marginLeft: 'auto' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => saveEdit(item)} disabled={!draft.name.trim() || save.isPending}>
                    <Check size={14} /> Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="catalog-row" key={item._id}>
                <span className="color-dot" style={{ background: item.color || 'var(--text-subtle)' }} />
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                {canEdit && (
                  <div className="row gap-1" style={{ marginLeft: 'auto' }}>
                    <button className="btn btn-ghost btn-icon btn-sm" title="Rename / recolour" onClick={() => startEdit(item)}><Pencil size={14} /></button>
                    <button className="btn btn-ghost btn-icon btn-sm danger-text" title="Delete" onClick={() => setDeleting(item)}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${noun}?`}
        message={`“${deleting?.name}” will no longer be offered when creating or editing tasks.`}
        onConfirm={remove}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Holidays                                                            */
/* ------------------------------------------------------------------ */

const LINE_RX = /^(\d{4}-\d{2}-\d{2})(?:\s*[,;|\t]\s*|\s+)(.+)$/;

function parseBulk(text) {
  const valid = [];
  const invalid = [];
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const m = line.match(LINE_RX);
      const ok = m && dayjs(m[1]).isValid() && dayjs(m[1]).format('YYYY-MM-DD') === m[1] && m[2].trim().length >= 2;
      if (ok) valid.push({ date: m[1], name: m[2].trim() });
      else invalid.push(line);
    });
  return { valid, invalid };
}

function holidayMessage(result) {
  const d = result?.data || {};
  const n = d.created?.length || 0;
  const skipped = Array.isArray(d.skipped) ? d.skipped.length : Number(d.skipped) || 0;
  let msg = n === 0 ? 'No new holidays added' : n === 1 ? 'Holiday added' : `${n} holidays added`;
  const adj = d.adjusted;
  if (adj && (adj.shifted || adj.removedDaily)) {
    msg += ` — ${adj.shifted || 0} checklist occurrence${adj.shifted === 1 ? '' : 's'} moved, ${adj.removedDaily || 0} daily removed`;
  }
  if (skipped) msg += ` (${skipped} already declared)`;
  return msg;
}

function HolidaysPanel({ canEdit }) {
  const [year, setYear] = useState(() => dayjs().year());
  const { data: holidays, isLoading, isError, error } = useHolidays({ year });
  const addHolidays = useAddHolidays();
  const delHoliday = useDeleteHoliday();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState('');
  const [deleting, setDeleting] = useState(null);
  const today = dayjs().format('YYYY-MM-DD');
  const parsed = useMemo(() => parseBulk(bulk), [bulk]);

  const byMonth = useMemo(() => {
    const groups = new Map();
    [...(holidays || [])]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .forEach((h) => {
        const key = String(h.date).slice(0, 7);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(h);
      });
    return [...groups.entries()];
  }, [holidays]);

  const addOne = async (e) => {
    e.preventDefault();
    if (!date || name.trim().length < 2) return;
    try {
      const res = await addHolidays.mutateAsync({ name: name.trim(), date });
      toast.success(holidayMessage(res));
      setName('');
      setDate('');
      setYear(Number(date.slice(0, 4)));
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const addMany = async () => {
    if (!parsed.valid.length) return;
    try {
      const res = await addHolidays.mutateAsync({ holidays: parsed.valid.slice(0, 60) });
      toast.success(holidayMessage(res));
      setBulk('');
      setBulkOpen(false);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const remove = async () => {
    try {
      await delHoliday.mutateAsync(deleting._id);
      toast.success(`${deleting.name} removed`);
    } catch (err) {
      toast.error(errMsg(err));
      throw err;
    }
  };

  return (
    <div className="col gap-4">
      <div className="info-line">
        <Info size={14} />
        Declaring a holiday moves open checklist occurrences off that day (daily ones are dropped).
      </div>

      {canEdit && (
        <div className="card card-pad col gap-3">
          <form className="catalog-add" onSubmit={addOne}>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 170 }} />
            <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Holiday name, e.g. Diwali" />
            <button className="btn btn-primary" type="submit" disabled={!date || name.trim().length < 2 || addHolidays.isPending}>
              <Plus size={15} /> Add holiday
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setBulkOpen((o) => !o)}>
              <ListPlus size={15} /> {bulkOpen ? 'Hide bulk add' : 'Add several'}
            </button>
          </form>
          {bulkOpen && (
            <div className="col gap-2">
              <textarea
                className="textarea mono"
                style={{ minHeight: 130, fontSize: 12.5 }}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={'One per line: YYYY-MM-DD, Name\n2026-10-20, Dussehra\n2026-11-08, Diwali'}
              />
              <div className="row between wrap gap-2">
                <span className="tiny muted">
                  {parsed.valid.length} ready
                  {parsed.invalid.length > 0 && <span className="danger-text"> · {parsed.invalid.length} line(s) not understood: {parsed.invalid.slice(0, 2).join(' | ')}</span>}
                  {parsed.valid.length > 60 && <span className="danger-text"> · only the first 60 are sent</span>}
                </span>
                <button className="btn btn-primary btn-sm" onClick={addMany} disabled={!parsed.valid.length || addHolidays.isPending}>
                  {addHolidays.isPending ? <span className="spinner" /> : `Add ${Math.min(parsed.valid.length, 60)} holidays`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="col">
            <div className="section-title">Holidays in {year}</div>
            <div className="sm muted">{holidays ? `${holidays.length} declared` : ' '}</div>
          </div>
          <div className="year-nav">
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year"><ChevronLeft size={16} /></button>
            <span className="year tabular">{year}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year"><ChevronRight size={16} /></button>
          </div>
        </div>
        <div className="card-body">
          {isLoading ? (
            <div className="col gap-2">{[0, 1, 2, 3].map((i) => <SkBlock key={i} h={46} />)}</div>
          ) : isError ? (
            <EmptyState icon={CalendarDays} title="Couldn't load holidays" hint={errMsg(error)} />
          ) : !byMonth.length ? (
            <EmptyState icon={CalendarDays} title={`No holidays declared for ${year}`} hint={canEdit ? 'Add one above.' : undefined} />
          ) : (
            byMonth.map(([month, list]) => (
              <div className="holiday-month" key={month}>
                <span className="eyebrow">{dayjs(`${month}-01`).format('MMMM')}</span>
                {list.map((h) => (
                  <div className={`holiday-row ${h.date < today ? 'past' : ''}`} key={h._id}>
                    <span className="sm tabular" style={{ fontWeight: 600 }}>{fmtDate(h.date)}</span>
                    <span className="tiny muted upper">{dayjs(h.date).format('ddd')}</span>
                    <span className="col" style={{ minWidth: 0 }}>
                      <span className="truncate" style={{ fontWeight: 600 }}>{h.name}</span>
                      {h.createdBy?.name && <span className="tiny subtle">Declared by {h.createdBy.name}</span>}
                    </span>
                    {canEdit ? (
                      <button className="btn btn-ghost btn-icon btn-sm danger-text" title="Remove holiday" onClick={() => setDeleting(h)}>
                        <X size={14} />
                      </button>
                    ) : <span />}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Remove holiday?"
        message={deleting ? `${deleting.name} (${fmtDate(deleting.date)}) will be a working day again.` : ''}
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}

export default OpsSettingsPage;
