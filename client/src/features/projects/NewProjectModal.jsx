import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Star, Store, Hash, MapPin, CalendarDays, UserCog, Flag,
  Layers, ClipboardList,
  Rocket, CheckCircle2, Info, AlertCircle, FileText, Wallet,
  Save, Landmark, ChevronDown, Check, Search,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { NumberInput } from '../../components/ui/NumberInput.jsx';
import { useTemplates, useUsers, useCreateProject } from '../../lib/queries.js';
import { INDIAN_CITIES } from '../../lib/indianCities.js';
import { fmtCurrency, fmtDate } from '../../lib/format.js';
import dayjs from 'dayjs';

const DRAFT_KEY = 'mr-new-project-draft';

// Real backend enum (PRIORITY in core/constants) surfaced as a picker — these
// are the actual persisted values, not sample data.
const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const EMPTY_FORM = {
  name: '',
  templateId: '',
  city: '',
  address: '',
  plannedStartDate: dayjs().format('YYYY-MM-DD'),
  targetEndDate: '',
  owner: '',
  priority: 'medium',
  areaSqft: '',
  budgetPlanned: '',
  description: '',
};

/** Mirror the server's project-code prefix (project.service.generateProjectCode)
 * so the auto-generated code is previewed honestly — the trailing sequence is
 * assigned on the server, shown here as ###. */
const codePreview = (city) => {
  const letters = (city || '').replace(/[^A-Za-z]/g, '');
  if (!letters) return 'MR-•••-###';
  return `MR-${letters.slice(0, 3).toUpperCase().padEnd(3, 'X')}-###`;
};

/** Section header + body. Defined at module scope (never inside the modal's
 * render) so its identity is stable — otherwise React would remount each
 * section every keystroke and text inputs would lose focus. */
function Section({ icon: Icon, title, sub, children }) {
  return (
    <section className="np-section">
      <div className="np-section-head">
        <span className="np-section-num"><Icon size={14} /></span>
        <div>
          <div className="np-section-title">{title}</div>
          {sub && <div className="np-section-sub">{sub}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * City picker — a searchable combobox. Click (or the chevron) opens the full
 * bundled Indian-cities list; typing filters it; picking a row fills the field.
 * Still fully free-text: any city not in the list can be typed and kept, so no
 * real value is ever blocked. Options come from INDIAN_CITIES, never hardcoded
 * inline.
 */
function CityCombobox({ value, onChange, onBlur, invalid }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const query = (value || '').trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return INDIAN_CITIES;
    const starts = [];
    const contains = [];
    for (const c of INDIAN_CITIES) {
      const lc = c.toLowerCase();
      if (lc.startsWith(query)) starts.push(c);
      else if (lc.includes(query)) contains.push(c);
    }
    return [...starts, ...contains];
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) {
        setOpen(false);
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onBlur]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active];
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const emit = (v) => onChange({ target: { value: v } });
  const pick = (c) => { emit(c); setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open) {
      if (matches[active]) { e.preventDefault(); pick(matches[active]); }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={`np-combo${open ? ' open' : ''}`} ref={wrapRef}>
      <div className="np-combo-control">
        <MapPin size={14} className="np-combo-lead" />
        <input
          className={`input np-combo-input${invalid ? ' np-invalid' : ''}`}
          value={value}
          onChange={(e) => { onChange(e); setActive(0); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search or type any Indian city…"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="np-city-list"
        />
        <button
          type="button"
          className="np-combo-toggle"
          tabIndex={-1}
          aria-label="Toggle city list"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {open && (
        <div className="np-combo-pop">
          <ul className="np-combo-list" id="np-city-list" role="listbox" ref={listRef}>
            {matches.length === 0 ? (
              <li className="np-combo-empty">
                <Search size={13} /> No match — “{value}” will be used as a custom city.
              </li>
            ) : (
              matches.slice(0, 100).map((c, i) => (
                <li
                  key={c}
                  role="option"
                  aria-selected={c === value}
                  className={`np-combo-opt${i === active ? ' active' : ''}${c === value ? ' selected' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                >
                  <MapPin size={13} className="np-combo-opt-icon" />
                  {c}
                  {c === value && <Check size={14} className="np-combo-opt-check" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export function NewProjectModal({ open, onClose }) {
  const templates = useTemplates({ status: 'published' });
  const users = useUsers({ role: 'manager' });
  const create = useCreateProject();
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});
  const [created, setCreated] = useState(null);
  const [hasDraft, setHasDraft] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const templateList = templates.data?.data || [];
  const defaultTemplate = templateList.find((t) => t.isDefault);
  const templatesLoading = templates.isLoading;

  // Reset transient state each time the modal opens, and offer to restore a
  // previously saved draft (a real, locally-persisted form — never mock data).
  useEffect(() => {
    if (!open) return;
    create.reset();
    setCreated(null);
    setTouched({});
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      setHasDraft(Boolean(raw));
    } catch {
      setHasDraft(false);
    }
    setForm(EMPTY_FORM);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preselect the default playbook once templates load, without overriding a
  // choice the user has already made.
  useEffect(() => {
    if (!open || !defaultTemplate) return;
    setForm((f) => (f.templateId ? f : { ...f, templateId: defaultTemplate._id }));
  }, [open, defaultTemplate]);

  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setForm({ ...EMPTY_FORM, ...JSON.parse(raw) });
    } catch { /* corrupt draft — ignore */ }
    setHasDraft(false);
  };

  const discardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* no-op */ }
    setHasDraft(false);
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      setHasDraft(false);
    } catch { /* storage unavailable */ }
  };

  // The selected template carries all summary numbers as real virtuals
  // (totalStages/totalTasks/totalChecklistItems/estimatedDurationDays) plus its
  // stages — departments and approval gates are derived from those, not faked.
  const selected = useMemo(
    () => templateList.find((t) => t._id === form.templateId) || null,
    [templateList, form.templateId],
  );

  // Client-side mirror of the backend's own required rules (zod: name≥2,
  // templateId, city≥2, plannedStartDate). Not a second source of truth — the
  // server re-validates — just gates the button and drives inline hints.
  const errors = {
    name: form.name.trim().length < 2 ? 'Enter a project name (min 2 characters).' : '',
    templateId: !form.templateId ? 'Select a workflow template.' : '',
    city: form.city.trim().length < 2 ? 'Enter the store city.' : '',
    targetEndDate:
      form.targetEndDate && form.plannedStartDate && dayjs(form.targetEndDate).isBefore(dayjs(form.plannedStartDate))
        ? 'Opening target is before the planned start.'
        : '',
  };
  const isValid = !errors.name && !errors.templateId && !errors.city && !errors.targetEndDate;

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, templateId: true, city: true, targetEndDate: true });
    if (!isValid) return;
    const body = {
      name: form.name.trim(),
      templateId: form.templateId,
      city: form.city.trim(),
      plannedStartDate: form.plannedStartDate,
      priority: form.priority,
      ...(form.address ? { address: form.address.trim() } : {}),
      ...(form.targetEndDate ? { targetEndDate: form.targetEndDate } : {}),
      ...(form.owner ? { owner: form.owner } : {}),
      ...(form.areaSqft ? { areaSqft: Number(form.areaSqft) } : {}),
      ...(form.description ? { description: form.description.trim() } : {}),
      ...(form.budgetPlanned ? { budget: { planned: Number(form.budgetPlanned), currency: 'INR' } } : {}),
    };
    const project = await create.mutateAsync(body);
    discardDraft();
    // Brief success confirmation with the real, server-assigned project code,
    // then continue with the existing router navigation.
    setCreated(project);
    setTimeout(() => {
      onClose();
      navigate(`/projects/${project._id}`);
    }, 1400);
  };

  const err = create.error?.response?.data?.message;
  const showErr = (k) => (touched[k] || create.isError) && errors[k];

  // ---- Success view ----------------------------------------------------------
  if (created) {
    return (
      <Modal open={open} onClose={onClose} width={null} className="np-modal" title="Project created" subtitle="Launch is being set up">
        <div className="np-success">
          <span className="np-success-ring"><CheckCircle2 size={38} strokeWidth={2.2} /></span>
          <div className="np-success-title">{created.name}</div>
          <div className="np-success-sub">
            Your franchise project <span className="np-success-code">{created.code}</span> is ready. Tasks, checklists and
            team assignments have been generated from the template. Taking you there now…
          </div>
          <div className="np-success-meta">
            {created.city && <span className="np-success-chip"><MapPin size={13} /> {created.city}</span>}
            {created.plannedStartDate && <span className="np-success-chip"><CalendarDays size={13} /> {fmtDate(created.plannedStartDate)}</span>}
            <span className="np-success-chip"><Layers size={13} /> {(created.stages || []).length} phases</span>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={null}
      className="np-modal"
      title="Create New Franchise Project"
      subtitle="Spin up a launch from a published template"
      footer={
        <>
          {err ? (
            <span className="np-footer-err"><AlertCircle size={15} /> {err}</span>
          ) : (
            !isValid && (touched.name || touched.city) && (
              <span className="np-footer-err"><Info size={15} /> Complete the required fields to continue</span>
            )
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={create.isPending}>Cancel</button>
          <button type="button" className="btn btn-subtle" onClick={saveDraft} disabled={create.isPending}>
            <Save size={15} style={{ marginRight: 6 }} /> Save draft
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={create.isPending || !isValid}>
            {create.isPending ? <span className="spinner" /> : <><Rocket size={15} style={{ marginRight: 6 }} /> Create project</>}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="np-body">
        {hasDraft && (
          <div className="np-draft">
            <Save size={15} />
            You have a saved draft for a new project.
            <span className="np-draft-actions">
              <button type="button" className="np-linkbtn" onClick={restoreDraft}>Restore</button>
              <button type="button" className="np-linkbtn" style={{ color: 'var(--text-subtle)' }} onClick={discardDraft}>Discard</button>
            </span>
          </div>
        )}

        <div className="np-grid">
          {/* ============ LEFT: form ============ */}
          <div className="np-form">
            {/* SECTION 1 — Project information */}
            <Section icon={ClipboardList} title="Project Information" sub="Name, code and the workflow it runs on">
              <div className="np-fields">
                <div className="np-field np-field--full">
                  <label className="np-label">Project name <span className="np-req">*</span></label>
                  <input
                    className={`input${showErr('name') ? ' np-invalid' : ''}`}
                    value={form.name}
                    onChange={set('name')}
                    onBlur={blur('name')}
                    placeholder="Mystery Rooms — Indiranagar"
                    maxLength={100}
                    autoFocus
                  />
                  {showErr('name')
                    ? <span className="np-err"><AlertCircle size={12} /> {errors.name}</span>
                    : <span className="np-hint">{form.name.length}/100</span>}
                </div>

                <div className="np-field">
                  <label className="np-label">Project code <span className="np-optional">Auto</span></label>
                  <div className="np-code">
                    <Hash size={14} /> {codePreview(form.city)}
                    <em>Generated on create</em>
                  </div>
                </div>

                <div className="np-field">
                  <label className="np-label">Template <span className="np-req">*</span></label>
                  {templatesLoading ? (
                    <div className="np-sk" style={{ height: 38 }} />
                  ) : (
                    <select
                      className={`select${showErr('templateId') ? ' np-invalid' : ''}`}
                      value={form.templateId}
                      onChange={set('templateId')}
                      onBlur={blur('templateId')}
                    >
                      <option value="">Select a template…</option>
                      {templateList.map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.name} · {t.totalStages} phases{t.isDefault ? ' · default' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {showErr('templateId') && <span className="np-err"><AlertCircle size={12} /> {errors.templateId}</span>}
                </div>

                {defaultTemplate && form.templateId === defaultTemplate._id && (
                  <div className="np-field np-field--full">
                    <div className="np-note">
                      <Star size={13} fill="currentColor" />
                      Using the default playbook — its tasks, checklists, doers and buddies are assigned automatically.
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {/* SECTION 2 — Store details */}
            <Section icon={Store} title="Store Details" sub="Where this franchise opens and how big it is">
              <div className="np-fields">
                <div className="np-field">
                  <label className="np-label">City <span className="np-req">*</span></label>
                  {/* Searchable dropdown over the bundled Indian-cities list, but
                      still free-text: any city not in the list can be typed. */}
                  <CityCombobox
                    value={form.city}
                    onChange={set('city')}
                    onBlur={blur('city')}
                    invalid={showErr('city')}
                  />
                  {showErr('city') && <span className="np-err"><AlertCircle size={12} /> {errors.city}</span>}
                </div>

                <div className="np-field">
                  <label className="np-label">Area (sq.ft) <span className="np-optional">Optional</span></label>
                  <div className="np-adorn">
                    <NumberInput className="input" value={form.areaSqft} onChange={set('areaSqft')} placeholder="3000" style={{ paddingRight: 44 }} />
                    <span className="np-adorn-suffix">sq.ft</span>
                  </div>
                </div>

                <div className="np-field np-field--full">
                  <label className="np-label">Location / address <span className="np-optional">Optional</span></label>
                  <input
                    className="input"
                    value={form.address}
                    onChange={set('address')}
                    placeholder="Unit 4, Ground Floor, 100 Ft Road…"
                  />
                </div>

                <div className="np-field">
                  <label className="np-label"><CalendarDays size={13} /> Planned start <span className="np-req">*</span></label>
                  <input className="input" type="date" value={form.plannedStartDate} onChange={set('plannedStartDate')} />
                </div>

                <div className="np-field">
                  <label className="np-label"><Flag size={13} /> Opening target <span className="np-optional">Optional</span></label>
                  <input
                    className={`input${showErr('targetEndDate') ? ' np-invalid' : ''}`}
                    type="date"
                    value={form.targetEndDate}
                    min={form.plannedStartDate}
                    onChange={set('targetEndDate')}
                    onBlur={blur('targetEndDate')}
                  />
                  {showErr('targetEndDate') && <span className="np-err"><AlertCircle size={12} /> {errors.targetEndDate}</span>}
                </div>
              </div>
            </Section>

            {/* SECTION 3 — Project management */}
            <Section icon={UserCog} title="Project Management" sub="Ownership and delivery priority">
              <div className="np-fields">
                <div className="np-field">
                  <label className="np-label">Project manager <span className="np-optional">Optional</span></label>
                  {users.isLoading ? (
                    <div className="np-sk" style={{ height: 38 }} />
                  ) : (
                    <select className="select" value={form.owner} onChange={set('owner')}>
                      <option value="">Unassigned</option>
                      {(users.data || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                    </select>
                  )}
                </div>

                <div className="np-field">
                  <label className="np-label"><Flag size={13} /> Priority</label>
                  <select className="select" value={form.priority} onChange={set('priority')}>
                    {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
            </Section>

            {/* SECTION 4 — Financial details */}
            <Section icon={Wallet} title="Financial Details" sub="Planned budget and notes for this launch">
              <div className="np-fields">
                <div className="np-field">
                  <label className="np-label">Planned budget</label>
                  <div className="np-adorn">
                    <span className="np-adorn-sym">₹</span>
                    <NumberInput className="input" value={form.budgetPlanned} onChange={set('budgetPlanned')} placeholder="4,500,000" />
                  </div>
                  {form.budgetPlanned && <span className="np-hint"><Landmark size={12} /> {fmtCurrency(Number(form.budgetPlanned))} · INR</span>}
                </div>

                <div className="np-field np-field--full">
                  <label className="np-label"><FileText size={13} /> Remarks <span className="np-optional">Optional</span></label>
                  <textarea
                    className="textarea"
                    value={form.description}
                    onChange={set('description')}
                    placeholder="Context for the launch team — landlord notes, mall tie-ups, timing constraints…"
                    rows={3}
                  />
                </div>
              </div>
            </Section>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default NewProjectModal;
