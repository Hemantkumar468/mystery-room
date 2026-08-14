import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Hash, MapPin, CalendarDays, Flag,
  Layers, Ruler, UserCog, Gauge,
  Rocket, CheckCircle2, Info, AlertCircle, FileText,
  Save, Landmark,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { NumberInput } from '../../components/ui/NumberInput.jsx';
import { CityCombobox } from '../../components/ui/CityCombobox.jsx';
import { useUsers } from '../../app/api/usersApi.js';
import { useTemplates } from '../../app/api/templatesApi.js';
import { useCreateProject, useUpdateProject, usePublishDraft, useProject } from '../../app/api/projectsApi.js';
import { useAppDispatch } from '../../app/hooks.js';
import { toastPushed } from '../../app/slices/notificationSlice.js';
import { fmtCurrency, fmtDate } from '../../lib/format.js';
import dayjs from 'dayjs';

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
  city: '',
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

/**
 * `draftId` — pass a draft project's id to open the modal in "Continue
 * Editing" mode (fetches and pre-populates the form, and Save Draft/Create
 * Project act on that same document from then on). Omit it for a fresh
 * create — behaves exactly as before. Drafts live in MongoDB as real
 * `Project` documents with `status: 'draft'` (see project.service.js#
 * createDraft/publishDraft) — nothing here touches localStorage.
 */
export function NewProjectModal({ open, onClose, draftId }) {
  const users = useUsers({ role: 'manager' });
  const create = useCreateProject();
  const publish = usePublishDraft();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const showToast = (message, kind = 'success') => dispatch(toastPushed({ kind, message }));

  const [form, setForm] = useState(EMPTY_FORM);

  /**
   * Which workflow this project runs.
   *
   * 'default' keeps the behaviour this modal always had — send no template and
   * let the server apply the published Default Template. It stays preselected
   * because it is the right answer nearly every time, and an MD opening this
   * form to add a city should not have to make a decision to get the standard
   * flow. 'pick' is the deliberate escape hatch: choose another published
   * playbook (the client flow, the franchise fast-track, or a customised copy).
   */
  const [templateChoice, setTemplateChoice] = useState('default');
  const [pickedTemplateId, setPickedTemplateId] = useState('');
  // Only fetched once the user actually asks to choose — the default path
  // needs no template list at all.
  const { data: templateResp } = useTemplates(
    { status: 'published', limit: 50 },
    { skip: templateChoice !== 'pick' },
  );
  const templates = templateResp?.data || templateResp || [];
  const [touched, setTouched] = useState({});
  const [created, setCreated] = useState(null);
  // The Mongo _id of the draft this session is saving to — starts as
  // `draftId` (Continue Editing) or null (fresh create, until the first
  // Save Draft click creates one and we start PATCHing it instead).
  const [currentDraftId, setCurrentDraftId] = useState(draftId || null);
  const updateDraft = useUpdateProject(currentDraftId);
  const draftQuery = useProject(draftId);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  // Reset transient state each time the modal opens.
  useEffect(() => {
    if (!open) return;
    create.reset();
    updateDraft.reset();
    publish.reset();
    setCreated(null);
    setTouched({});
    setCurrentDraftId(draftId || null);
    if (!draftId) setForm(EMPTY_FORM);
  }, [open, draftId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continue Editing: populate the form once the draft's own data loads.
  useEffect(() => {
    if (!open || !draftId || !draftQuery.data) return;
    const d = draftQuery.data;
    setForm({
      name: d.name || '',
      city: d.city || '',
      plannedStartDate: d.plannedStartDate ? dayjs(d.plannedStartDate).format('YYYY-MM-DD') : '',
      targetEndDate: d.targetEndDate ? dayjs(d.targetEndDate).format('YYYY-MM-DD') : '',
      owner: d.owner?._id || d.owner || '',
      priority: d.priority || 'medium',
      areaSqft: d.areaSqft ?? '',
      budgetPlanned: d.budget?.planned ?? '',
      description: d.description || '',
    });
  }, [open, draftId, draftQuery.data]);

  // Client-side mirror of the backend's own required rules (zod: name≥2,
  // city≥2, plannedStartDate). Not a second source of truth — the server
  // re-validates — just gates the button and drives inline hints. The
  // template is never chosen here — the backend assigns the published
  // Default Template automatically (see project.service.js#create/publishDraft).
  const errors = {
    name: form.name.trim().length < 2 ? 'Enter a project name (min 2 characters).' : '',
    city: form.city.trim().length < 2 ? 'Enter the store city.' : '',
    targetEndDate:
      form.targetEndDate && form.plannedStartDate && dayjs(form.targetEndDate).isBefore(dayjs(form.plannedStartDate))
        ? 'Opening target is before the planned start.'
        : '',
  };
  const isValid = !errors.name && !errors.city && !errors.targetEndDate;

  // Full, strict payload — used for a one-shot fresh create (no draft
  // involved at all), identical to what this modal has always sent.
  const buildBody = () => ({
    name: form.name.trim(),
    city: form.city.trim(),
    plannedStartDate: form.plannedStartDate,
    priority: form.priority,
    ...(form.targetEndDate ? { targetEndDate: form.targetEndDate } : {}),
    ...(form.owner ? { owner: form.owner } : {}),
    ...(form.areaSqft ? { areaSqft: Number(form.areaSqft) } : {}),
    ...(form.description ? { description: form.description.trim() } : {}),
    ...(form.budgetPlanned ? { budget: { planned: Number(form.budgetPlanned), currency: 'INR' } } : {}),
    // Omitted on the default path, so the server picks the published Default
    // Template exactly as it always has.
    ...(templateChoice === 'pick' && pickedTemplateId ? { templateId: pickedTemplateId } : {}),
  });

  // Lenient payload for saving a draft — omits any field that's still blank
  // instead of sending an empty string, since createDraftSchema/updateProjectSchema
  // reject e.g. `city: ''` (fails its own min-length check) even though the
  // field as a whole is optional for a draft.
  const buildDraftBody = () => ({
    ...(form.name.trim() ? { name: form.name.trim() } : {}),
    ...(form.city.trim() ? { city: form.city.trim() } : {}),
    ...(form.plannedStartDate ? { plannedStartDate: form.plannedStartDate } : {}),
    ...(form.targetEndDate ? { targetEndDate: form.targetEndDate } : {}),
    ...(form.owner ? { owner: form.owner } : {}),
    ...(form.areaSqft ? { areaSqft: Number(form.areaSqft) } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.budgetPlanned ? { budget: { planned: Number(form.budgetPlanned), currency: 'INR' } } : {}),
    priority: form.priority,
  });

  // Save Draft — no success toast and the modal closes immediately (the
  // new/updated row appearing in the Projects list, via the same cache
  // invalidation createProject/updateProject already trigger, IS the
  // confirmation). A failure still surfaces, since silently losing the
  // save would be worse than a toast.
  const saveDraft = async () => {
    try {
      if (currentDraftId) {
        await updateDraft.mutateAsync(buildDraftBody());
      } else {
        const draft = await create.mutateAsync({ ...buildDraftBody(), status: 'draft' });
        setCurrentDraftId(draft._id);
      }
      onClose();
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not save the draft.', 'error');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, city: true, targetEndDate: true });
    if (!isValid) return;
    let project;
    if (currentDraftId) {
      // Persist any edits made since the last Save Draft first —
      // publishDraft materializes from what's already stored, not from a
      // request body, so nothing typed since the last save would otherwise
      // make it into the created project.
      await updateDraft.mutateAsync(buildDraftBody());
      project = await publish.mutateAsync(currentDraftId);
    } else {
      project = await create.mutateAsync(buildBody());
    }
    setCreated(project);
    // Brief success confirmation with the real, server-assigned project code,
    // then continue with the existing router navigation.
    setTimeout(() => {
      onClose();
      navigate(`/projects/${project._id}`);
    }, 1400);
  };

  const isPending = create.isPending || updateDraft.isPending || publish.isPending;
  const err = create.error?.response?.data?.message
    || updateDraft.error?.response?.data?.message
    || publish.error?.response?.data?.message;
  const showErr = (k) => (touched[k] || create.isError || publish.isError) && errors[k];

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
      title={draftId ? 'Continue Draft' : 'Create New Franchise Project'}
      subtitle={draftId ? 'Pick up where you left off' : 'Spin up a launch from a published template'}
      footer={
        <>
          {err ? (
            <span className="np-footer-err"><AlertCircle size={15} /> {err}</span>
          ) : (
            !isValid && (touched.name || touched.city) && (
              <span className="np-footer-err"><Info size={15} /> Complete the required fields to continue</span>
            )
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isPending}>Cancel</button>
          <button type="button" className="btn btn-subtle" onClick={saveDraft} disabled={isPending}>
            {create.isPending || updateDraft.isPending ? <span className="spinner" /> : <><Save size={15} style={{ marginRight: 6 }} /> Save draft</>}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={isPending || !isValid}>
            {isPending ? <span className="spinner" /> : <><Rocket size={15} style={{ marginRight: 6 }} /> Create project</>}
          </button>
        </>
      }
    >
      {draftId && draftQuery.isLoading ? (
        <div className="np-body">
          <div className="np-sk" style={{ height: 280 }} />
        </div>
      ) : (
      <form onSubmit={submit} className="np-body">
        <div className="np-grid">
          {/* ============ LEFT: form ============ */}
          <div className="np-form">
            {/* Single packed grid — every field paired two-per-row (instead of
                per-section grids with lone full-width rows) so the whole form
                fits without scrolling the modal body. */}
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
                <label className="np-label"><Ruler size={13} /> Area (sq.ft) <span className="np-optional">Optional</span></label>
                <div className="np-adorn">
                  <NumberInput className="input" value={form.areaSqft} onChange={set('areaSqft')} placeholder="3000" style={{ paddingRight: 44 }} />
                  <span className="np-adorn-suffix">sq.ft</span>
                </div>
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

              <div className="np-field">
                <label className="np-label"><UserCog size={13} /> Project manager <span className="np-optional">Optional</span></label>
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
                <label className="np-label"><Gauge size={13} /> Priority</label>
                <select className="select" value={form.priority} onChange={set('priority')}>
                  {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

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
                  rows={2}
                />
              </div>

              {/* Which workflow runs. Two plainly-worded options rather than a
                  bare dropdown — the reader has to understand the consequence
                  ("all the tasks appear automatically") to choose sensibly. */}
              <div className="np-field np-field--full">
                <label className="np-label"><Layers size={13} /> Workflow</label>
                <div className="np-choice">
                  <button
                    type="button"
                    className={`np-choice-card${templateChoice === 'default' ? ' is-on' : ''}`}
                    onClick={() => setTemplateChoice('default')}
                    aria-pressed={templateChoice === 'default'}
                  >
                    <span className="np-choice-title">Use the standard flow</span>
                    <span className="np-choice-sub">
                      Every phase, task, owner and deadline is created automatically. Recommended.
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`np-choice-card${templateChoice === 'pick' ? ' is-on' : ''}`}
                    onClick={() => setTemplateChoice('pick')}
                    aria-pressed={templateChoice === 'pick'}
                  >
                    <span className="np-choice-title">Choose a different one</span>
                    <span className="np-choice-sub">
                      Start from another playbook — franchise fast-track, renovation, or your own edited copy.
                    </span>
                  </button>
                </div>

                {templateChoice === 'pick' && (
                  <>
                    <select
                      className="select"
                      style={{ marginTop: 10 }}
                      value={pickedTemplateId}
                      onChange={(e) => setPickedTemplateId(e.target.value)}
                    >
                      <option value="">Use the standard flow</option>
                      {templates.map((tpl) => (
                        <option key={tpl._id} value={tpl._id}>
                          {tpl.name} — {tpl.totalStages} phases
                        </option>
                      ))}
                    </select>
                    <span className="tiny muted" style={{ marginTop: 6, display: 'block' }}>
                      Want to change the phases or owners themselves? Edit the template in
                      {' '}<Link to="/templates" target="_blank" rel="noreferrer">Templates</Link>{' '}
                      first — a project keeps a copy of the template it started from, so later
                      edits never disturb a project already running.
                    </span>
                  </>
                )}
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
