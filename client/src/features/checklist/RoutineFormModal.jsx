import { useState } from 'react';
import dayjs from 'dayjs';
import { Info, Plus, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { toast } from '../../components/ops/toast.jsx';
import {
  useBranches, useChecklistSites, useCreateRoutine, useGroups, useSaveSite, useUpdateRoutine,
} from '../../lib/opsQueries.js';
import { CHK_FREQUENCIES, WEEKDAYS, errMsg } from '../../lib/opsUi.js';
import { DEPT_META } from '../../lib/ui.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { useOpsStore } from '../../store/opsStore.js';
import { can } from '../../lib/roles.js';

const NEW_SITE = '__new__';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const idOf = (v) => (v && typeof v === 'object' ? v._id : v) || '';

function initialState(routine, user, branch) {
  if (routine) {
    return {
      taskName: routine.taskName || '',
      description: routine.description || '',
      doer: idOf(routine.doer),
      proofRequired: !!routine.proofRequired,
      department: routine.department || '',
      site: routine.site || '',
      group: idOf(routine.group),
      endDate: routine.endDate || '',
      autoRenew: !!routine.autoRenew,
      isActive: routine.isActive !== false,
    };
  }
  return {
    taskName: '',
    description: '',
    doer: '',
    frequency: 'daily',
    startDate: dayjs().format('YYYY-MM-DD'),
    endDate: '',
    weeklyOffs: [],
    anchorWeekday: 6,
    anchorDay: 28,
    autoRenew: true,
    proofRequired: false,
    branch: branch && branch !== 'all' ? branch : '',
    department: user?.department && DEPT_META[user.department] ? user.department : '',
    site: '',
    group: '',
  };
}

/** Site dropdown fed by the sites list, with an inline "add new site" input. */
function SiteSelect({ value, onChange, branch }) {
  const { data } = useChecklistSites({ branch: branch || undefined });
  const saveSite = useSaveSite();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const sites = data?.sites || [];
  const options = value && !sites.includes(value) ? [value, ...sites] : sites;

  const add = async () => {
    const next = name.trim();
    if (!next) return;
    try {
      await saveSite.mutateAsync({ name: next, branch: branch && branch !== 'all' ? branch : undefined });
      onChange(next);
      setAdding(false);
      setName('');
      toast.success(`Site "${next}" added`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (adding) {
    return (
      <div className="row gap-2">
        <input
          className="input grow"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
            if (e.key === 'Escape') setAdding(false);
          }}
          placeholder="e.g. Room 2 — The Heist"
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={!name.trim() || saveSite.isPending}>
          {saveSite.isPending ? <span className="spinner" /> : 'Add'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Cancel" onClick={() => setAdding(false)}>
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <select
      className="select"
      value={value}
      onChange={(e) => (e.target.value === NEW_SITE ? setAdding(true) : onChange(e.target.value))}
    >
      <option value="">No specific site</option>
      {options.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
      <option value={NEW_SITE}>+ Add new site…</option>
    </select>
  );
}

function RoutineForm({ routine, onClose }) {
  const user = useAppSelector(selectCurrentUser);
  const storeBranch = useOpsStore((s) => s.branch);
  const isEdit = !!routine;
  const isManager = can.manage(user?.role);
  const [f, setF] = useState(() => initialState(routine, user, storeBranch));
  const set = (patch) => setF((s) => ({ ...s, ...patch }));

  const create = useCreateRoutine();
  const update = useUpdateRoutine();
  const busy = create.isPending || update.isPending;
  const { data: groups = [] } = useGroups();
  const { data: branchData } = useBranches();
  const branches = branchData?.data || [];

  const siteBranch = isEdit ? idOf(routine.branch) : f.branch || storeBranch;
  const needsWeekday = f.frequency === 'weekly' || f.frequency === 'fortnightly';
  const needsDay = f.frequency === 'monthly';
  const defaultEnd = f.startDate ? `31 Dec ${f.startDate.slice(0, 4)}` : '31 Dec';

  const endBeforeStart = f.endDate && (isEdit ? routine.startDate : f.startDate) && f.endDate < (isEdit ? routine.startDate : f.startDate);
  const valid = f.taskName.trim().length >= 2 && !endBeforeStart && (isEdit || (f.frequency && f.startDate));

  const toggleOff = (d) =>
    set({ weeklyOffs: f.weeklyOffs.includes(d) ? f.weeklyOffs.filter((x) => x !== d) : [...f.weeklyOffs, d] });

  const submitCreate = async () => {
    const body = {
      taskName: f.taskName.trim(),
      description: f.description.trim() || undefined,
      doer: isManager && f.doer ? f.doer : undefined,
      frequency: f.frequency,
      startDate: f.startDate,
      endDate: f.endDate || undefined,
      weeklyOffs: f.weeklyOffs.length ? [...f.weeklyOffs].sort() : undefined,
      anchorWeekday: needsWeekday ? Number(f.anchorWeekday) : undefined,
      anchorDay: needsDay ? Number(f.anchorDay) : undefined,
      autoRenew: f.autoRenew,
      proofRequired: f.proofRequired,
      branch: f.branch || undefined,
      department: f.department || undefined,
      site: f.site || undefined,
      group: f.group || undefined,
    };
    const res = await create.mutateAsync(body);
    const n = res?.data?.generated ?? 0;
    toast.success(`Routine created — ${plural(n, 'occurrence')} scheduled`);
  };

  const submitEdit = async () => {
    const init = initialState(routine);
    const body = {};
    if (f.taskName.trim() !== init.taskName) body.taskName = f.taskName.trim();
    if (f.description.trim() !== init.description) body.description = f.description.trim();
    if (isManager && f.doer && f.doer !== init.doer) body.doer = f.doer;
    if (f.proofRequired !== init.proofRequired) body.proofRequired = f.proofRequired;
    if (f.department !== init.department) body.department = f.department || null;
    if (f.site !== init.site) body.site = f.site || null;
    if (f.group !== init.group) body.group = f.group || null;
    if (f.endDate && f.endDate !== init.endDate) body.endDate = f.endDate;
    if (f.autoRenew !== init.autoRenew) body.autoRenew = f.autoRenew;
    if (f.isActive !== init.isActive) body.isActive = f.isActive;
    if (!Object.keys(body).length) {
      toast.success('Nothing changed');
      return;
    }
    const res = await update.mutateAsync({ id: routine._id, ...body });
    const { cascaded = 0, generated = 0, removed = 0 } = res?.data || {};
    const bits = [
      cascaded && `${plural(cascaded, 'upcoming occurrence')} updated`,
      generated && `${generated} added`,
      removed && `${removed} removed`,
    ].filter(Boolean);
    toast.success(bits.length ? `Routine saved — ${bits.join(', ')}` : 'Routine saved');
  };

  const submit = async () => {
    if (!valid || busy) return;
    try {
      await (isEdit ? submitEdit() : submitCreate());
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit routine ${routine.code}` : 'New checklist routine'}
      subtitle={isEdit ? routine.taskName : 'A recurring check that schedules its own occurrences'}
      width={720}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>
            {busy ? <span className="spinner" /> : isEdit ? 'Save changes' : <><Plus size={15} /> Create routine</>}
          </button>
        </>
      }
    >
      {isEdit && (
        <div className="chk-callout">
          <Info size={15} />
          <span>
            Changes apply to upcoming open occurrences only — completed and missed history stays as it was.
            Moving the end date later schedules more occurrences; moving it earlier removes open ones.
          </span>
        </div>
      )}

      <div className="form-grid">
        <div className="field span-2">
          <label className="label">Task name<span className="danger-text"> *</span></label>
          <input
            className="input"
            autoFocus
            value={f.taskName}
            onChange={(e) => set({ taskName: e.target.value })}
            placeholder="e.g. Reset props & check locks in Room 1"
          />
        </div>
        <div className="field span-2">
          <label className="label">Description</label>
          <textarea
            className="textarea"
            value={f.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Steps, standards, what 'done' looks like…"
          />
        </div>

        <div className="field">
          <label className="label">Doer</label>
          {isManager ? (
            <PersonPicker value={f.doer} onChange={(doer) => set({ doer })} placeholder={isEdit ? 'Keep current doer' : 'Me (default)'} />
          ) : (
            <div className="chk-callout" style={{ margin: 0 }}>
              <Info size={15} />
              <span>{isEdit ? 'Only a manager can change the doer.' : 'Routines you create are assigned to you.'}</span>
            </div>
          )}
        </div>

        {isEdit ? (
          <div className="field">
            <label className="label">Schedule</label>
            <div className="input muted" style={{ background: 'var(--surface-hover)' }}>
              {CHK_FREQUENCIES.find((x) => x.value === routine.frequency)?.label || routine.frequency} · from {routine.startDate}
            </div>
          </div>
        ) : (
          <div className="field">
            <label className="label">Branch</label>
            <select className="select" value={f.branch} onChange={(e) => set({ branch: e.target.value, site: '' })}>
              <option value="">My branch</option>
              {branches.map((b) => (
                <option key={b._id} value={b._id}>{b.name} ({b.code})</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!isEdit && (
        <div className="form-section">
          <span className="eyebrow">Schedule</span>
          <div className="form-grid">
            <div className="field">
              <label className="label">Frequency<span className="danger-text"> *</span></label>
              <select className="select" value={f.frequency} onChange={(e) => set({ frequency: e.target.value })}>
                {CHK_FREQUENCIES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Start date<span className="danger-text"> *</span></label>
              <input className="input" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </div>

            {needsWeekday && (
              <div className="field">
                <label className="label">Falls on</label>
                <select className="select" value={f.anchorWeekday} onChange={(e) => set({ anchorWeekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            )}
            {needsDay && (
              <div className="field">
                <label className="label">Day of month</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={31}
                  value={f.anchorDay}
                  onChange={(e) => set({ anchorDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                />
                <span className="tiny muted">Falls back to the last day in short months.</span>
              </div>
            )}

            <div className="field span-2">
              <label className="label">Skip these days</label>
              <div className="day-picker">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    className={f.weeklyOffs.includes(d.value) ? 'on' : ''}
                    onClick={() => toggleOff(d.value)}
                    title={d.label}
                    disabled={!f.weeklyOffs.includes(d.value) && f.weeklyOffs.length >= 6}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
              <span className="tiny muted">
                Outlets usually trade 7 days a week — skip nothing. Head office may skip Sunday. Occurrences landing on a skipped day or a holiday roll forward.
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="form-grid">
        <div className="field">
          <label className="label">End date</label>
          <input
            className="input"
            type="date"
            value={f.endDate}
            min={isEdit ? routine.startDate : f.startDate}
            onChange={(e) => set({ endDate: e.target.value })}
          />
          {endBeforeStart ? (
            <span className="tiny danger-text">The end date must fall after the start date.</span>
          ) : (
            <span className="tiny muted">
              {isEdit ? 'Later schedules more occurrences; earlier removes open ones.' : `Leave empty to run until ${defaultEnd} and auto-renew every year.`}
            </span>
          )}
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <label className="toggle-row">
            <input type="checkbox" checked={f.autoRenew} onChange={(e) => set({ autoRenew: e.target.checked })} />
            <span>Auto-renew for the next year when it ends</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={f.proofRequired} onChange={(e) => set({ proofRequired: e.target.checked })} />
            <span>Proof document required to complete</span>
          </label>
          {isEdit && (
            <label className="toggle-row">
              <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
              <span>Routine is active</span>
            </label>
          )}
        </div>

        <div className="field">
          <label className="label">Department</label>
          <select className="select" value={f.department} onChange={(e) => set({ department: e.target.value })}>
            <option value="">None</option>
            {Object.entries(DEPT_META).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Group</label>
          <select className="select" value={f.group} onChange={(e) => set({ group: e.target.value })}>
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g._id} value={g._id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="field span-2" style={{ marginBottom: 0 }}>
          <label className="label">Site</label>
          <SiteSelect value={f.site} onChange={(site) => set({ site })} branch={siteBranch} />
          <span className="tiny muted">The room or area this check happens in.</span>
        </div>
      </div>
    </Modal>
  );
}

/** Create (no `routine`) or edit (`routine`) a checklist routine. */
export function RoutineFormModal({ open, routine, onClose }) {
  if (!open) return null;
  return <RoutineForm key={routine?._id || 'new'} routine={routine} onClose={onClose} />;
}

export default RoutineFormModal;
