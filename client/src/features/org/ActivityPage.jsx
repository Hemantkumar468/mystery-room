import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { History, Search, ChevronLeft, ChevronRight, ShieldAlert, ListTodo, ListChecks, Network, RotateCcw } from 'lucide-react';
import '../../styles/ops-org.css';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Avatar, Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { Segmented } from '../../components/ops/common.jsx';
import { useActivityLog } from '../../lib/opsQueries.js';
import { errMsg } from '../../lib/opsUi.js';
import { fromNow } from '../../lib/format.js';
import { useMe, useDebounced, isForbidden, tone } from './orgCommon.jsx';

const LIMIT = 30;

const MODULE_META = {
  delegation: { label: 'Delegation', ...tone('var(--primary)') },
  checklist: { label: 'Checklist', ...tone('var(--success)') },
  org: { label: 'Org', ...tone('var(--info)') },
};

const MODULE_OPTIONS = [
  { value: 'all', label: 'All', icon: History },
  { value: 'delegation', label: 'Delegation', icon: ListTodo },
  { value: 'checklist', label: 'Checklist', icon: ListChecks },
  { value: 'org', label: 'Org', icon: Network },
];

const humanize = (s = '') => {
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

const dayLabel = (key) => {
  const d = dayjs(key);
  if (d.isSame(dayjs(), 'day')) return 'Today';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  return d.format(d.isSame(dayjs(), 'year') ? 'dddd, DD MMM' : 'dddd, DD MMM YYYY');
};

const FORBIDDEN = (
  <div className="card">
    <EmptyState icon={ShieldAlert} title="Only admins and managers can see the activity log" hint="Ask an admin if you need an audit trail for your work." />
  </div>
);

export function ActivityPage() {
  const me = useMe();
  return (
    <>
      <Topbar title="Activity log" subtitle="Everything that happened across delegation, checklists and the organisation — who did what, and when" />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          {me.canCurate ? <ActivityFeed /> : FORBIDDEN}
        </div>
      </div>
    </>
  );
}

function ActivityFeed() {
  const [module, setModule] = useState('all');
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(search.trim(), 350);
  // The page belongs to one set of filters — changing any filter starts again at page 1.
  const sig = [module, q, actor, from, to].join('|');
  const [pager, setPager] = useState({ sig, page: 1 });
  const page = pager.sig === sig ? pager.page : 1;
  const setPage = (fn) => setPager({ sig, page: fn(page) });

  const { data: res, isLoading, isError, error, isFetching } = useActivityLog({
    module: module === 'all' ? undefined : module,
    search: q || undefined,
    actor: actor || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    limit: LIMIT,
  });
  const entries = res?.data;
  const meta = res?.meta || {};
  const filtered = module !== 'all' || q || actor || from || to;

  const days = useMemo(() => {
    const groups = new Map();
    (entries || []).forEach((e) => {
      const key = dayjs(e.createdAt).format('YYYY-MM-DD');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
    return [...groups.entries()];
  }, [entries]);

  const reset = () => {
    setModule('all');
    setSearch('');
    setActor('');
    setFrom('');
    setTo('');
  };

  if (isError && isForbidden(error)) return FORBIDDEN;

  return (
    <>
      <div className="card filter-bar">
        <Segmented value={module} onChange={setModule} options={MODULE_OPTIONS} />
        <div className="search-box">
          <Search size={15} className="subtle" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or description…" />
        </div>
        <div className="filter-select" style={{ minWidth: 220 }}>
          <span className="tiny subtle upper">Actor</span>
          <PersonPicker value={actor} onChange={setActor} placeholder="Anyone" />
        </div>
        <label className="filter-select">
          <span className="tiny subtle upper">From</span>
          <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="filter-select">
          <span className="tiny subtle upper">To</span>
          <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {filtered && (
          <button className="btn btn-ghost" onClick={reset}><RotateCcw size={14} /> Reset</button>
        )}
      </div>

      {isLoading ? (
        <SkTable rows={8} />
      ) : isError ? (
        <div className="card"><EmptyState icon={History} title="Couldn't load the activity log" hint={errMsg(error)} /></div>
      ) : !entries?.length ? (
        <div className="card">
          <EmptyState icon={History} title="Nothing logged here" hint={filtered ? 'Try widening the filters.' : 'Activity appears as people work.'} />
        </div>
      ) : (
        <div className="card card-pad" style={{ opacity: isFetching ? 0.7 : 1, transition: 'var(--transition)' }}>
          {days.map(([key, list]) => (
            <div className="activity-day" key={key}>
              <span className="eyebrow">{dayLabel(key)}</span>
              {list.map((e) => <ActivityItem key={e._id} e={e} />)}
            </div>
          ))}
        </div>
      )}

      {meta.total > 0 && (
        <div className="row between wrap gap-3">
          <span className="sm muted tabular">
            {(meta.page - 1) * (meta.limit || LIMIT) + 1}–{Math.min(meta.page * (meta.limit || LIMIT), meta.total)} of {meta.total}
          </span>
          <div className="row gap-2">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={15} /> Prev
            </button>
            <span className="sm tabular">Page {meta.page || page} of {meta.totalPages || 1}</span>
            <button className="btn btn-ghost btn-sm" disabled={!meta.hasNextPage || isFetching} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ActivityItem({ e }) {
  const m = MODULE_META[e.module] || { label: humanize(e.module), ...tone('var(--text-muted)') };
  return (
    <div className="activity-item">
      <Avatar name={e.actor?.name || 'System'} color={e.actor?.avatarColor || 'var(--text-subtle)'} size={32} />
      <div className="col gap-1 grow" style={{ minWidth: 0 }}>
        <div className="row gap-2 wrap">
          <span style={{ fontWeight: 650 }}>{e.actor?.name || 'System'}</span>
          {e.actor?.title && <span className="tiny subtle">{e.actor.title}</span>}
          <Badge color={m.color} soft={m.soft}>{m.label}</Badge>
          {e.type && <span className="chip chip-sm">{humanize(e.type)}</span>}
        </div>
        <div className="sm">
          <span style={{ fontWeight: 600 }}>{e.title}</span>
          {e.description && <span className="muted desc"> — {e.description}</span>}
        </div>
      </div>
      <span className="tiny muted nowrap tabular" title={fromNow(e.createdAt)}>{dayjs(e.createdAt).format('HH:mm')}</span>
    </div>
  );
}

export default ActivityPage;
