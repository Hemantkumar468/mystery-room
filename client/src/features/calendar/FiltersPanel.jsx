import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Avatar } from '../../components/ui/primitives.jsx';
import { TASK_STATUS_META, TASK_STATUS_ORDER, PRIORITY_META } from '../../lib/ui.js';
import { EMPTY_FILTERS, deptLabel, activeFilterCount } from './calendarUtils.js';

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

function Section({ title, children }) {
  return (
    <div className="cal-filter-sec">
      <div className="cal-filter-sec-title">{title}</div>
      <div className="cal-filter-chips">{children}</div>
    </div>
  );
}

function Toggle({ active, color, onClick, children }) {
  return (
    <button
      className={`cal-fchip ${active ? 'active' : ''}`}
      style={color ? { '--chip': color } : undefined}
      onClick={onClick}
      aria-pressed={active}
    >
      {color && <span className="cal-fchip-dot" />}
      {children}
    </button>
  );
}

/**
 * Every facet is multi-select and additive; an empty facet means "no narrowing"
 * rather than "nothing", which keeps the default view showing everything.
 */
export function FiltersPanel({ filters, setFilters, facets }) {
  const toggle = (key, value) =>
    setFilters((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));

  const count = activeFilterCount(filters);

  return (
    <div className="cal-filters">
      <div className="cal-filters-head">
        <span className="cal-filter-sec-title" style={{ margin: 0 }}>Filters</span>
        {count > 0 && (
          <button
            className="cal-reset"
            onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, q: f.q }))}
          >
            <RotateCcw size={12} /> Reset
          </button>
        )}
      </div>

      <Section title="Type">
        <Toggle active={filters.types.includes('task')} color="#6366f1" onClick={() => toggle('types', 'task')}>
          Tasks
        </Toggle>
        <Toggle active={filters.types.includes('milestone')} color="var(--primary-strong)" onClick={() => toggle('types', 'milestone')}>
          Go-Live
        </Toggle>
        <Toggle
          active={filters.overdueOnly}
          color="var(--danger)"
          onClick={() => setFilters((f) => ({ ...f, overdueOnly: !f.overdueOnly }))}
        >
          <AlertTriangle size={11} strokeWidth={2.5} style={{ marginRight: 2 }} />
          Overdue
        </Toggle>
      </Section>

      <Section title="Status">
        {TASK_STATUS_ORDER.map((s) => (
          <Toggle key={s} active={filters.statuses.includes(s)} color={TASK_STATUS_META[s].color} onClick={() => toggle('statuses', s)}>
            {TASK_STATUS_META[s].label}
          </Toggle>
        ))}
      </Section>

      <Section title="Priority">
        {PRIORITY_ORDER.map((p) => (
          <Toggle key={p} active={filters.priorities.includes(p)} color={PRIORITY_META[p].color} onClick={() => toggle('priorities', p)}>
            {PRIORITY_META[p].label}
          </Toggle>
        ))}
      </Section>

      {facets.projects.length > 0 && (
        <Section title="Project">
          {facets.projects.map((p) => (
            <Toggle key={p.id} active={filters.projects.includes(p.id)} onClick={() => toggle('projects', p.id)}>
              {p.code || p.name}
            </Toggle>
          ))}
        </Section>
      )}

      {facets.departments.length > 0 && (
        <Section title="Department">
          {facets.departments.map((d) => (
            <Toggle key={d} active={filters.departments.includes(d)} onClick={() => toggle('departments', d)}>
              {deptLabel(d)}
            </Toggle>
          ))}
        </Section>
      )}

      {facets.assignees.length > 0 && (
        <Section title="Owner">
          {facets.assignees.map((a) => (
            <button
              key={a.name}
              className={`cal-fchip cal-fchip-user ${filters.assignees.includes(a.name) ? 'active' : ''}`}
              onClick={() => toggle('assignees', a.name)}
              aria-pressed={filters.assignees.includes(a.name)}
            >
              <Avatar name={a.name} color={a.avatarColor || 'var(--ink-500)'} size={18} />
              {a.name}
            </button>
          ))}
        </Section>
      )}
    </div>
  );
}

export default FiltersPanel;
