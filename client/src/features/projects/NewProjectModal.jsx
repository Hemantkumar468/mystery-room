import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store, FileText, MapPin, Maximize2, CalendarDays, Calendar,
  Users, Flag, Hash, ChevronDown, Rocket, X, CheckCircle2, AlertCircle, Info, Layers,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { NumberInput } from '../../components/ui/NumberInput.jsx';
import { CityCombobox } from '../../components/ui/CityCombobox.jsx';
import { TimePicker } from '../../components/ui/TimePicker.jsx';
import { CityPropertiesPanel } from '../property/CityPropertiesPanel.jsx';
import { useCreateProject, useUpdateProject, usePublishDraft, useProject, useProjects } from '../../app/api/projectsApi.js';
import { useUsers } from '../../app/api/usersApi.js';
import { useGetFmsDefaultDoerQuery } from '../../app/api/fmsApi.js';
import { useAppDispatch } from '../../app/hooks.js';
import { toastPushed } from '../../app/slices/notificationSlice.js';
import { fmtDate } from '../../lib/format.js';
import dayjs from 'dayjs';

const DEFAULT_DEADLINE_TIME = '18:00';

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', color: '#10b981' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
];

const HEADING = {
  new_centre: {
    title: 'New Store',
    subtitle: 'Create a project for a new store. Fill in the details below and get started.',
  },
  renovation: {
    title: 'Renovation and Add Games',
    subtitle: 'An existing centre — its site and games carry over; work starts at planning.',
  },
  franchise: {
    title: 'Property in Hand',
    subtitle: 'The property is already decided — work starts at the LOI, NOCs and deposit.',
  },
};

const EMPTY_FORM = {
  name: '',
  city: '',
  plannedStartDate: dayjs().format('YYYY-MM-DDTHH:mm'),
  targetEndDate: dayjs().add(7, 'day').hour(18).minute(0).format('YYYY-MM-DDTHH:mm'),
  owner: '',
  captureAssignee: '',
  priority: 'medium',
  areaSqft: '',
  budgetPlanned: '',
  description: '',
};

const codePreview = (city) => {
  const letters = (city || '').replace(/[^A-Za-z]/g, '');
  if (!letters) return 'MR-•••-###';
  return `MR-${letters.slice(0, 3).toUpperCase().padEnd(3, 'X')}-###`;
};

export function NewProjectModal({
  open, onClose, draftId, prefill, onCreated, intent = 'new_centre',
}) {
  const create = useCreateProject();
  /* NO DUPLICATE-CITY CHECK. A city is not a slot that one store fills:
     several franchises can open in the same city, and a New Store is really
     an instruction to go and find properties there, which the MD may give
     again next week for the same city and a different person. The old
     "… already covers this city" error blocked exactly the case the button
     exists for, so the 500-project fetch that fed it is gone too. */
  const [kind, setKind] = useState(intent);
  const publish = usePublishDraft();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const showToast = (message, kind = 'success') => dispatch(toastPushed({ kind, message }));

  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});
  const [created, setCreated] = useState(null);
  const [currentDraftId, setCurrentDraftId] = useState(draftId || null);
  const updateDraft = useUpdateProject(currentDraftId);
  const draftQuery = useProject(draftId);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  /**
   * WHO THE SITE HUNT GOES TO, FILLED IN BEFORE THE MD TOUCHES IT.
   *
   * The field shipped as "Nobody yet — assign later" and was left there
   * almost every time, so a store was created and its property capture
   * belonged to no one. It is not a question the MD should have to answer:
   * the org sheet says whose job this is, and the FMS · Assign Work screen
   * is where a company changes its mind. The form's job is to SHOW the
   * answer, so it can be overridden in the one case in ten that needs it.
   *
   * Only pre-filled while the field is still untouched — see the guard
   * below — because a default that reapplies itself is not a default, it is
   * a form that will not let you say "nobody".
   */
  const { data: captureDefault } = useGetFmsDefaultDoerQuery('p1:p1_capture', { skip: !open });

  useEffect(() => {
    if (!open || draftId || !captureDefault?.id) return;
    setForm((f) => (f.captureAssignee || touched.captureAssignee
      ? f
      : { ...f, captureAssignee: captureDefault.id }));
  }, [open, draftId, captureDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    create.reset();
    updateDraft.reset();
    publish.reset();
    setCreated(null);
    setTouched({});
    setCurrentDraftId(draftId || null);
    if (!draftId) setForm({ ...EMPTY_FORM, ...(prefill || {}) });
    setKind(intent);
    setSourceProjectId('');
  }, [open, draftId, prefill, intent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !draftId || !draftQuery.data) return;
    const d = draftQuery.data;
    setForm({
      name: d.name || '',
      city: d.city || '',
      plannedStartDate: d.plannedStartDate ? dayjs(d.plannedStartDate).format('YYYY-MM-DDTHH:mm') : '',
      targetEndDate: d.targetEndDate ? dayjs(d.targetEndDate).format('YYYY-MM-DDTHH:mm') : (d.plannedStartDate ? dayjs(d.plannedStartDate).format('YYYY-MM-DDTHH:mm') : ''),
      owner: d.owner?._id || d.owner || '',
      priority: d.priority || 'medium',
      areaSqft: d.areaSqft ?? '',
      budgetPlanned: d.budget?.planned ?? '',
      description: d.description || '',
    });
  }, [open, draftId, draftQuery.data]);

  const deadlineSource = form.targetEndDate || form.plannedStartDate || '';
  const deadlineDate = deadlineSource ? dayjs(deadlineSource).format('YYYY-MM-DD') : '';
  const deadlineTime = deadlineSource ? dayjs(deadlineSource).format('HH:mm') : '';
  const dateRef = useRef(null);

  const setDeadline = (date, time) => {
    if (!date) { setForm((f) => ({ ...f, targetEndDate: '' })); return; }
    setForm((f) => ({
      ...f,
      targetEndDate: `${date}T${time || DEFAULT_DEADLINE_TIME}`,
      plannedStartDate: f.plannedStartDate || dayjs().format('YYYY-MM-DDTHH:mm'),
    }));
  };

  const projectName = form.name.trim() || (form.city.trim() ? `Mystery Rooms — ${form.city.trim()}` : '');

  const errors = {
    name: projectName.length < 2 ? 'Enter the store city — the project is named from it.' : '',
    city: form.city.trim().length < 2 ? 'Enter the store city.' : '',
    targetEndDate:
      form.targetEndDate && form.plannedStartDate && dayjs(form.targetEndDate).isBefore(dayjs(form.plannedStartDate))
        ? 'Opening target is before the planned start.'
        : '',
  };
  const isValid = !errors.name && !errors.city && !errors.targetEndDate;

  const [sourceProjectId, setSourceProjectId] = useState('');
  const { data: allProjResp } = useProjects({ limit: 200 }, { skip: !open });
  const { data: usersResp } = useUsers({}, { skip: !open });
  const people = (Array.isArray(usersResp) ? usersResp : (usersResp?.data || []))
    .filter((u) => u.isActive !== false)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const allProjects = allProjResp?.data?.items || allProjResp?.data || allProjResp || [];
  const renovatable = (Array.isArray(allProjects) ? allProjects : [])
    .filter((p) => p.status !== 'draft')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  /* The live stores this city already runs. Matched case-insensitively on
     purpose: the same city has been filed as "Bhopal" and "BHOPAL", and a
     check that reads them as two cities is the check that lets the second
     store be opened without anybody seeing the first. */
  const cityKey = form.city.trim().toLowerCase();
  const storesInCity = cityKey
    ? (Array.isArray(allProjects) ? allProjects : []).filter((p) => (
      p.status !== 'draft' && !p.archivedAt
        && String(p.city || '').trim().toLowerCase() === cityKey
    ))
    : [];
  const sourceProject = renovatable.find((p) => p._id === sourceProjectId) || null;
  const pickSource = (id) => {
    setSourceProjectId(id);
    const src = renovatable.find((p) => p._id === id);
    if (src) {
      setForm((f) => ({
        ...f,
        name: `${src.name} — Renovation`,
        city: src.city || f.city,
        areaSqft: src.areaSqft ?? f.areaSqft,
      }));
    }
  };

  const buildBody = () => ({
    name: projectName,
    ...(kind === 'renovation' && sourceProjectId ? { sourceProjectId } : {}),
    kind,
    city: form.city.trim(),
    plannedStartDate: form.plannedStartDate,
    priority: form.priority,
    ...(form.targetEndDate ? { targetEndDate: form.targetEndDate } : {}),
    ...(form.owner ? { owner: form.owner } : {}),
    ...(form.captureAssignee ? { captureAssignee: form.captureAssignee } : {}),
    ...(form.areaSqft ? { areaSqft: Number(form.areaSqft) } : {}),
    ...(form.description ? { description: form.description.trim() } : {}),
    ...(form.budgetPlanned ? { budget: { planned: Number(form.budgetPlanned), currency: 'INR' } } : {}),
  });

  const buildDraftBody = () => ({
    ...(projectName ? { name: projectName } : {}),
    ...(form.city.trim() ? { city: form.city.trim() } : {}),
    ...(form.plannedStartDate ? { plannedStartDate: form.plannedStartDate } : {}),
    ...(form.targetEndDate ? { targetEndDate: form.targetEndDate } : {}),
    ...(form.owner ? { owner: form.owner } : {}),
    ...(form.captureAssignee ? { captureAssignee: form.captureAssignee } : {}),
    ...(form.areaSqft ? { areaSqft: Number(form.areaSqft) } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.budgetPlanned ? { budget: { planned: Number(form.budgetPlanned), currency: 'INR' } } : {}),
    priority: form.priority,
  });

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, city: true, targetEndDate: true });
    if (!isValid) return;
    let project;
    if (currentDraftId) {
      await updateDraft.mutateAsync(buildDraftBody());
      project = await publish.mutateAsync(currentDraftId);
    } else {
      project = await create.mutateAsync(buildBody());
    }
    setCreated(project);
    setTimeout(() => {
      if (onCreated) { onCreated(project); return; }
      onClose();
      navigate(`/projects/${project._id}`);
    }, 1400);
  };

  const isPending = create.isPending || updateDraft.isPending || publish.isPending;
  const err = create.error?.response?.data?.message
    || updateDraft.error?.response?.data?.message
    || publish.error?.response?.data?.message;
  const showErr = (k) => (touched[k] || create.isError || publish.isError) && errors[k];

  // Success view
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
      icon={<div className="np-store-icon"><Store size={22} /></div>}
      title={draftId ? 'Continue Draft' : HEADING[kind].title}
      subtitle={draftId ? 'Pick up where you left off' : HEADING[kind].subtitle}
      footer={
        <div className="np-modal-footer">
          <button type="button" className="np-btn-cancel" onClick={onClose} disabled={isPending}>
            <X size={15} /> Cancel
          </button>
          <div className="np-modal-footer-right">
            {err && <span className="np-footer-err"><AlertCircle size={14} /> {err}</span>}
            {/* NO "Save draft". Removed by request, the same way it went from
                every record form: a second button beside the one that
                finishes the job was being pressed by mistake, and a project
                saved as a draft looks to everyone else exactly like a store
                nobody got round to opening.

                DRAFTS THAT ALREADY EXIST ARE UNAFFECTED: opening one still
                loads it here under "Continue Draft", `updateDraft` still
                saves the edits, and `publish` still turns it into a real
                project. Only the button that CREATED a new draft is gone,
                and `saveDraft` with it — a function nothing could call is
                worse than no function. */}
            <button type="button" className="np-btn-create" onClick={submit} disabled={isPending || !isValid}>
              {isPending ? <span className="spinner" /> : <><Rocket size={15} /> Create project</>}
            </button>
          </div>
        </div>
      }
    >
      {draftId && draftQuery.isLoading ? (
        <div className="np-body">
          <div className="np-sk" style={{ height: 280 }} />
        </div>
      ) : (
        <form onSubmit={submit} className="np-body">
          <div className="np-grid">
            <div className="np-form">
              <div className="np-fields">
                {kind === 'franchise' && (
                  <div className="np-field np-field--full">
                    <span className="np-kind-note">
                      The property is already decided, so Phase 1 (capture) and Phase 2
                      (assessment) close themselves on creation.
                    </span>
                  </div>
                )}
                {kind === 'renovation' && (
                  <div className="np-field np-field--full">
                    <label className="np-label">Which centre is being renovated? <span className="np-req">*</span></label>
                    <select
                      className="input"
                      value={sourceProjectId}
                      onChange={(e) => pickSource(e.target.value)}
                    >
                      <option value="">Pick the centre…</option>
                      {renovatable.map((pj) => (
                        <option key={pj._id} value={pj._id}>{pj.name} — {pj.code}{pj.city ? ` · ${pj.city}` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 1. Project Code */}
                <div className="np-field">
                  <label className="np-label">
                    <FileText size={14} className="np-icon-blue" />
                    <span>Project Code</span>
                    <span className="np-req">*</span>
                    <span className="np-badge-auto">AUTO</span>
                  </label>
                  <div className="np-code-box">
                    <span className="np-code-prefix"><Hash size={14} /></span>
                    <span className="np-code-value">{codePreview(form.city)}</span>
                    <span className="np-code-tag">Generated on create</span>
                  </div>
                </div>

                {/* 2. City */}
                <div className="np-field">
                  <label className="np-label">
                    <MapPin size={14} className="np-icon-blue" />
                    <span>City</span>
                    {kind === 'renovation' ? <span className="np-badge-opt">Inherited</span> : <span className="np-req">*</span>}
                  </label>
                  {kind === 'renovation' ? (
                    <input className="input" value={sourceProject?.city || form.city || ''} disabled title="Comes from the centre being renovated" />
                  ) : (
                    <CityCombobox
                      value={form.city}
                      onChange={set('city')}
                      onBlur={blur('city')}
                      invalid={showErr('city')}
                    />
                  )}
                  {kind !== 'renovation' && showErr('city') && (
                    <span className="np-err"><AlertCircle size={12} /> {errors.city}</span>
                  )}
                </div>

                {/* WHAT THIS CITY ALREADY HOLDS, the moment it is chosen.
                    A store was being started here without ever seeing the
                    sites and stores already running in that city, which is how
                    one city ended up carrying four stores all named after it.
                    It does not block — the NO DUPLICATE-CITY CHECK note at the
                    top of this file is still the rule, and a city really can
                    hold a company outlet and a franchise — it only makes the
                    existing ones impossible to miss.

                    Full width, and below the row rather than inside the City
                    field: the city combobox opens its own list downwards over
                    exactly this spot, and half the panel is the half nobody
                    reads. Renovation has a centre already and no site to find,
                    so it is not asking this question. */}
                {kind !== 'renovation' && form.city.trim() && (
                  <div className="np-field np-field--full">
                    <CityPropertiesPanel city={form.city} stores={storesInCity} />
                  </div>
                )}

                {/* 3. Area (sq.ft) */}
                <div className="np-field">
                  <label className="np-label">
                    <Maximize2 size={14} className="np-icon-blue" />
                    <span>Area (sq.ft)</span>
                  </label>
                  <div className="np-adorn-wrap">
                    <NumberInput
                      className="input np-input-area"
                      value={form.areaSqft}
                      onChange={set('areaSqft')}
                      placeholder="3,000"
                    />
                    <span className="np-suffix-tag">sq.ft</span>
                  </div>
                </div>

                {/* 4. Deadline & Time */}
                <div className="np-field">
                  <label className="np-label">
                    <CalendarDays size={14} className="np-icon-blue" />
                    <span>Deadline & Time</span>
                    <span className="np-req">*</span>
                  </label>
                  <div className="np-dt-row">
                    <div className="np-dt-date-wrap" onClick={() => { try { dateRef.current?.showPicker?.(); } catch {} }}>
                      <input
                        ref={dateRef}
                        className="input np-dt-date-input"
                        type="date"
                        aria-label="Deadline date"
                        value={deadlineDate}
                        onChange={(e) => setDeadline(e.target.value, deadlineTime || DEFAULT_DEADLINE_TIME)}
                      />
                      <Calendar size={15} className="np-dt-date-icon" />
                    </div>
                    {/* A CLOCK, NOT THE BROWSER'S SPINNER. `<input type="time">`
                        drew "--:-- --" with a caret in it whether or not anybody
                        had answered — the noisiest control on the form, about the
                        one field still empty, and styled differently in every
                        browser. See components/ui/TimePicker.jsx. */}
                    <TimePicker
                      className="np-dt-time-wrap"
                      ariaLabel="Deadline time"
                      value={deadlineTime}
                      onChange={(t) => setDeadline(deadlineDate || dayjs().format('YYYY-MM-DD'), t)}
                    />
                  </div>
                </div>

                {/* 5. Property capture assigned to */}
                <div className="np-field">
                  <label className="np-label">
                    <Users size={14} className="np-icon-blue" />
                    <span>Property capture assigned to</span>
                  </label>
                  <div className="np-select-wrap">
                    <select
                      className="select np-select-styled"
                      value={form.captureAssignee}
                      onChange={(e) => {
                        setTouched((t) => ({ ...t, captureAssignee: true }));
                        set('captureAssignee')(e);
                      }}
                    >
                      <option value="">Nobody yet — assign later</option>
                      {people.map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.name}{u.role ? ` — ${u.role}` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={15} className="np-select-chevron" />
                  </div>
                  {/* WHERE THE NAME CAME FROM. A field that fills itself in
                      and does not say why is the kind of thing people undo
                      on principle. One line, and it names the screen where
                      the standing answer is changed. */}
                  {captureDefault && form.captureAssignee === captureDefault.id && (
                    <p className="np-hint-text">
                      {captureDefault.source === 'chosen'
                        ? `${captureDefault.name} — chosen on Settings → FMS · Assign Work`
                        : captureDefault.says}
                      . They get the “capture this property” task as soon as the store is created.
                    </p>
                  )}
                </div>

                {/* 6. Priority */}
                <div className="np-field">
                  <label className="np-label">
                    <Flag size={14} className="np-icon-blue" />
                    <span>Priority</span>
                  </label>
                  <div className="np-select-wrap np-priority-wrap">
                    <span className={`np-prio-dot is-${form.priority}`} />
                    <select className="select np-select-styled np-prio-select" value={form.priority} onChange={set('priority')}>
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={15} className="np-select-chevron" />
                  </div>
                </div>

                {/* 7. Remarks */}
                <div className="np-field np-field--full">
                  <label className="np-label">
                    <FileText size={14} className="np-icon-blue" />
                    <span>Remarks</span>
                  </label>
                  <div className="np-textarea-wrap">
                    <FileText size={15} className="np-textarea-lead-icon" />
                    <textarea
                      className="textarea np-textarea-styled"
                      value={form.description}
                      onChange={set('description')}
                      placeholder="Context for the launch team — landlord notes, mall tie-ups, timing constraints…"
                      maxLength={500}
                      rows={2}
                    />
                  </div>
                  <div className="np-textarea-footer">
                    <span className="np-char-counter">{form.description?.length || 0}/500</span>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default NewProjectModal;

