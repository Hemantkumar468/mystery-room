import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Hash, MapPin, CalendarDays, Layers, Ruler, Gauge, Rocket, CheckCircle2, Info, AlertCircle, FileText, Save, UserCheck,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { NumberInput } from '../../components/ui/NumberInput.jsx';
import { CityCombobox } from '../../components/ui/CityCombobox.jsx';
import { useCreateProject, useUpdateProject, usePublishDraft, useProject, useProjects } from '../../app/api/projectsApi.js';
import { useUsers } from '../../app/api/usersApi.js';
import { useAppDispatch } from '../../app/hooks.js';
import { toastPushed } from '../../app/slices/notificationSlice.js';
import { fmtDate } from '../../lib/format.js';
import dayjs from 'dayjs';

// Real backend enum (PRIORITY in core/constants) surfaced as a picker — these
// are the actual persisted values, not sample data.
const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

/**
 * What kind of undertaking this is. It is the first question because it
 * decides which phases even exist: a renovation of a running centre has
 * no property to scout, nothing to assess, no lease to negotiate — the
 * server auto-completes Phases 1-3 and work starts at planning. A
 * franchise project normally arrives through the public enquiry link
 * (Phases 1-2 auto-complete), but can be started here too.
 */
/**
 * The heading says which road this is.
 *
 * One form serves three of them and the road is chosen by the button that
 * opened it, so a single fixed title left every one of them announcing itself
 * as "Create New Franchise Project" — including the renovation of a centre we
 * already run. The heading is the only thing on screen that can say what is
 * being created before anything is typed.
 */
const HEADING = {
  new_centre: {
    title: 'New Store',
    subtitle: 'The full journey — find the property, assess it, sign it, build it.',
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

const PROJECT_KINDS = [
  { value: 'new_centre', label: 'New centre', hint: 'The full journey — find the property, assess, sign, build.' },
  { value: 'renovation', label: 'Renovation / add games', hint: 'An existing centre — starts at planning; property, assessment and commercial phases close themselves.' },
  { value: 'franchise', label: 'Franchise partner', hint: 'Partner brings the property — starts at the LOI; capture and assessment close themselves.' },
];

const EMPTY_FORM = {
  name: '',
  city: '',
  plannedStartDate: dayjs().format('YYYY-MM-DD'),
  targetEndDate: '',
  owner: '',
  /* Who walks the market and files the sites for this store. Not the project
     manager: on a new store those are routinely two different people. */
  captureAssignee: '',
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
/**
 * `prefill` seeds a fresh create with fields somebody has already told us —
 * the Property module opens this straight off a franchise lead who named a
 * city but has no site yet, and asking them to retype the city they just
 * submitted is how that hand-off gets skipped. Ignored when continuing a
 * draft, which has its own values and must not be overwritten.
 */
/**
 * `onCreated` hands the new project back to the caller INSTEAD of navigating
 * to it, and leaves the closing to them too. The property-capture flow needs
 * that: somebody who answered "no, there is no project yet" is here to capture
 * a site, and dropping them on the new project page loses the site they came
 * to record. Nothing passes it by default, so every existing caller still
 * lands on the project exactly as before.
 */
export function NewProjectModal({
  open, onClose, draftId, prefill, onCreated, intent = 'new_centre',
}) {
  const create = useCreateProject();
  /**
   * ONE STORE PER CITY.
   *
   * The queue had three "Bhopal" rows — two stores somebody opened twice and
   * a franchise application for the same place — and nothing downstream can
   * tell which of them a property, a drawing or a BOQ belongs to. The city is
   * checked while it is being typed, not on submit, because by submit the
   * person has already filled the rest of the form.
   */
  const { data: existingResp } = useProjects({ limit: 500 });
  const existing = existingResp?.rows || existingResp?.data || existingResp || [];
  /* Declared here rather than beside its own comment further down: the
     duplicate-city check below reads `kind`, and a `const` read above its
     declaration is a temporal-dead-zone crash, not a warning. */
  const [kind, setKind] = useState(intent);
  const publish = usePublishDraft();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const showToast = (message, kind = 'success') => dispatch(toastPushed({ kind, message }));

  const [form, setForm] = useState(EMPTY_FORM);

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
    if (!draftId) setForm({ ...EMPTY_FORM, ...(prefill || {}) });
    /* The road is the caller's, and a stale one from the last opening would
       silently file a renovation as a new centre (or the reverse). */
    setKind(intent);
    setSourceProjectId('');
  }, [open, draftId, prefill, intent]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /**
   * The project name is no longer a field, but it is still a value.
   *
   * It is required — it gates Create, and it is what every downstream screen
   * calls the project (the property queue's Project column, Purchase's picker,
   * the Design & Drawings list). So it falls back to "Mystery Rooms — <City>",
   * which is exactly what the removed field's own placeholder suggested.
   *
   * DERIVED AT THE POINT OF USE, never written into `form`. Storing it meant
   * writing the name on the first keystroke of the city and then never
   * updating it — a project called "Mystery Rooms — I". A real name still
   * wins: a renovation names itself off its source ("<source> — Renovation")
   * and a prefilled create arrives already named by the lead that opened it.
   */
  const projectName = form.name.trim() || (form.city.trim() ? `Mystery Rooms — ${form.city.trim()}` : '');

  /**
   * Opening target, Project manager and Planned budget are no longer ASKED
   * here — they were optional at creation and are set where they are actually
   * known: the opening date on Property Step 6, the manager on the project
   * itself, the budget with the BOQ. The keys stay on `form` so the payload
   * shape is unchanged and the server still receives them (empty), rather than
   * the create call quietly changing shape.
   */
  /* The store that already holds this city, if there is one. Matched on the
     trimmed, lower-cased name so "bhopal", "Bhopal " and "BHOPAL" are the one
     city they obviously are. */
  const cityClash = useMemo(() => {
    if (kind === 'renovation') return null;
    const wanted = form.city.trim().toLowerCase();
    if (wanted.length < 2) return null;
    const list = Array.isArray(existing) ? existing : [];
    return list.find((pr) => String(pr.city || '').trim().toLowerCase() === wanted
      && String(pr._id || pr.id || '') !== String(draftId || '')) || null;
  }, [existing, form.city, kind, draftId]);

  const errors = {
    name: projectName.length < 2 ? 'Enter the store city — the project is named from it.' : '',
    city: form.city.trim().length < 2
      ? 'Enter the store city.'
      : cityClash
        ? `${cityClash.name || cityClash.city} already covers this city. Add the new site to it as another property — a second store in ${form.city.trim()} would split its properties, drawings and BOQ across two projects that cannot see each other.`
        : '',
    targetEndDate:
      form.targetEndDate && form.plannedStartDate && dayjs(form.targetEndDate).isBefore(dayjs(form.plannedStartDate))
        ? 'Opening target is before the planned start.'
        : '',
  };
  const isValid = !errors.name && !errors.city && !errors.targetEndDate;

  // Full, strict payload — used for a one-shot fresh create (no draft
  // involved at all), identical to what this modal has always sent.
  /**
   * The kind is no longer chosen in the form — it is chosen by the button that
   * opened it. "New Store Location" opens the new-centre road; "Renovation &
   * Add Games" opens this same form on an existing centre. `setKind` is kept
   * because the reset effect below uses it.
   */
  /* Renovation: the work belongs to an existing centre, so the centre is
     PICKED, never described. Name pre-fills; city/address/area inherit
     server-side from the source — nothing here can drift from it. */
  const [sourceProjectId, setSourceProjectId] = useState('');
  const { data: allProjResp } = useProjects({ limit: 200 });
  /* Everyone who could be sent to find a site. Active only — assigning work to
     somebody who has left is a task that will never be done and a queue that
     will never clear. */
  const { data: usersResp } = useUsers({});
  const people = (Array.isArray(usersResp) ? usersResp : (usersResp?.data || []))
    .filter((u) => u.isActive !== false)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const allProjects = allProjResp?.data?.items || allProjResp?.data || allProjResp || [];
  const renovatable = (Array.isArray(allProjects) ? allProjects : [])
    .filter((p) => p.status !== 'draft')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
    /* No templateId, ever. The server answers that with the published Default
       Template and materialises every phase in it, so which workflow a new
       project runs is decided in Templates — where it is edited — rather than
       re-decided in this form each time. */
  });

  // Lenient payload for saving a draft — omits any field that's still blank
  // instead of sending an empty string, since createDraftSchema/updateProjectSchema
  // reject e.g. `city: ''` (fails its own min-length check) even though the
  // field as a whole is optional for a draft.
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
      /* With `onCreated` the caller owns what happens next, INCLUDING the
         close. Calling onClose() first here tore down the flow that was
         waiting for the project — the capture form never got to open. */
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
      title={draftId ? 'Continue Draft' : HEADING[kind].title}
      subtitle={draftId ? 'Pick up where you left off' : HEADING[kind].subtitle}
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
              {/* The FIRST question, because it decides which phases exist. */}
              {/* The kind selector is not shown: the road is decided by the
                  button that opened this form, and `kind` still rides in the
                  payload so the server behaves exactly as before. What the
                  road DOES is said out loud, because the form looks the same
                  whichever button opened it. */}
              {kind === 'franchise' && (
                <div className="np-field np-field--full">
                  <span className="np-kind-note">
                    The property is already decided, so Phase 1 (capture) and Phase 2
                    (assessment) close themselves on creation. The project starts at
                    commercial closure — LOI, lease, legal check, deposit, NOCs and
                    approvals — and everything after it runs as normal.
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
                  {sourceProject ? (
                    <span className="tiny" style={{ color: 'var(--success)' }}>
                      Inherits from {sourceProject.code}: {sourceProject.city}{sourceProject.areaSqft ? ` · ${sourceProject.areaSqft} sq ft` : ''} · its site and current games carry over — nothing to retype.
                    </span>
                  ) : (
                    <span className="tiny muted">City, area and the approved site all come from the centre you pick.</span>
                  )}
                </div>
              )}
              {/* Project name is derived from the city rather than asked for —
                  see the effect above. Not shown, still set, still validated. */}

              <div className="np-field">
                <label className="np-label">Project code <span className="np-optional">Auto</span></label>
                <div className="np-code">
                  <Hash size={14} /> {codePreview(form.city)}
                  <em>Generated on create</em>
                </div>
              </div>

              <div className="np-field">
                <label className="np-label">City {kind === 'renovation' ? <span className="np-optional">Inherited</span> : <span className="np-req">*</span>}</label>
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
                {/* A clash shows the moment the city matches, without waiting for
                    the field to be blurred: it is not a mistake in what they
                    typed, it is news about what already exists. */}
                {kind !== 'renovation' && (showErr('city') || cityClash) && (
                  <span className="np-err"><AlertCircle size={12} /> {errors.city}</span>
                )}
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

              {/**
                * WHO IS ON THE PROPERTY HUNT — named here, at the moment the
                * store is created.
                *
                * Phase 1's tasks are materialised unassigned, so a new store
                * has always arrived in the property queue reading
                * "Unassigned": a step with no owner, which is the one thing
                * the standard this module is built to forbids. It is asked on
                * the form that starts the work rather than fixed afterwards on
                * a page nobody thinks to open.
                *
                * Not the same as the project manager. The PM runs the build;
                * this person walks the market and files the sites, and on a
                * new store they are routinely two different people.
                */}
              <div className="np-field">
                <label className="np-label">
                  <UserCheck size={13} /> Property capture assigned to <span className="np-optional">Optional</span>
                </label>
                <select className="select" value={form.captureAssignee} onChange={set('captureAssignee')}>
                  <option value="">Nobody yet — assign later</option>
                  {people.map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name}{u.role ? ` — ${u.role}` : ''}
                    </option>
                  ))}
                </select>
                <span className="tiny muted">
                  Every Phase 1 task on this store goes to them, and the property queue shows their
                  name against it from the first second.
                </span>
              </div>

              <div className="np-field">
                <label className="np-label"><Gauge size={13} /> Priority</label>
                <select className="select" value={form.priority} onChange={set('priority')}>
                  {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
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

            </div>
          </div>
        </div>
      </form>
      )}
    </Modal>
  );
}

export default NewProjectModal;
