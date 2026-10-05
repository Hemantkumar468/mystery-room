import { useEffect, useState } from 'react';
import { Hash, CalendarDays, Gauge, MapPin, Building2 } from 'lucide-react';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import { CityCombobox } from '../../components/ui/CityCombobox.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { useCreateProject } from '../../app/api/projectsApi.js';
import { useCreateRecordMutation } from '../../app/api/recordsApi.js';
import { useDefaultTemplate } from '../../app/api/templatesApi.js';

/**
 * Property in Hand — ONE form that creates the project and plans the outlet.
 *
 * WHY THE TWO ARE IN ONE DIALOG. This road is for a site we already hold, so
 * there is nothing to find, nothing to assess and nothing to negotiate on the
 * way — the server closes Phases 1-3 the moment the project is created
 * (KIND_SKIPS). That leaves exactly two things anybody has to say: where the
 * project is, and what the outlet will be. Splitting those across two dialogs
 * in a row made the second one look like an interruption; here the project
 * fields sit at the top of the plan, which is how the work actually reads.
 *
 * THE PLAN FIELDS ARE NOT A COPY. They are `p20.masterDataSchema` off the
 * published default template — the same schema Phase 4 renders, through the
 * same RecordFormModal — so the games list, the dates and the budget stay
 * whatever Templates says they are. The default template is the right one to
 * read: it is what the server will put this project on.
 *
 * AREA IS ASKED ONCE. The plan's "Confirmed Area" is the project's area — the
 * same number under two names, and a form that asks for it twice is a form
 * that will eventually hold two different answers. It is typed on the plan and
 * carried up to the project.
 *
 * WHAT IT WRITES, in order: the project (`kind: 'franchise'`), then its plan
 * against the id that comes back. If the plan write fails the project still
 * exists, and the message says so rather than implying nothing happened.
 */
const PLAN_STAGE = 'p20';

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

/** Mirrors the server's code prefix so the preview is honest — the sequence
 *  number is the server's to assign. See project.service.generateProjectCode. */
const codePreview = (city) => {
  const letters = (city || '').replace(/[^A-Za-z]/g, '');
  if (!letters) return 'MR-•••-###';
  return `MR-${letters.slice(0, 3).toUpperCase().padEnd(3, 'X')}-###`;
};

const today = () => new Date().toISOString().slice(0, 10);

export function PropertyInHandModal({ open, onClose }) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState(today);
  const [priority, setPriority] = useState('medium');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: tplResp, isLoading: loadingTemplate } = useDefaultTemplate();
  const template = tplResp?.data || tplResp || null;
  const stage = (template?.stages || []).find((st) => st.key === PLAN_STAGE) || null;
  const schema = stage?.masterDataSchema || [];

  const createProject = useCreateProject();
  const [createRecord] = useCreateRecordMutation();

  useEffect(() => {
    if (!open) return;
    setName('');
    setCity('');
    setPlannedStartDate(today());
    setPriority('medium');
    setRemarks('');
    setError(null);
  }, [open]);

  /**
   * Both buttons land here — "Save Draft" files the plan as a draft, the
   * primary one submits it. Either way the PROJECT is created for real: a
   * draft plan on no project would belong to nothing.
   */
  const save = async (payload) => {
    setError(null);
    if (!projectName) {
      const message = 'Give the project a name, or pick a city and it will be named after it.';
      setError(message);
      throw new Error(message);
    }
    if (!city.trim()) {
      const message = 'Pick the city this project is in.';
      setError(message);
      throw new Error(message); // keeps the form open, values intact
    }
    if (!plannedStartDate) {
      const message = 'Set the planned start date.';
      setError(message);
      throw new Error(message);
    }

    setBusy(true);
    try {
      const area = Number(payload.values?.confirmed_area);
      const project = await createProject.mutateAsync({
        name: projectName,
        kind: 'franchise',
        city: city.trim(),
        plannedStartDate,
        priority,
        ...(Number.isFinite(area) && area > 0 ? { areaSqft: area } : {}),
        ...(remarks.trim() ? { description: remarks.trim() } : {}),
      });

      let planned = true;
      try {
        await createRecord({
          projectId: project._id,
          stageKey: PLAN_STAGE,
          status: payload.status,
          values: payload.values,
        }).unwrap();
      } catch {
        planned = false;
      }

      flashSuccess(planned
        ? `${project.code} created — plan ${payload.status === 'draft' ? 'saved as a draft' : 'filed'}`
        : `${project.code} created — the plan could not be saved, file it on Phase 4`);
      onClose?.();
    } catch (err) {
      /* A project failure is the parent's to report; the dialog stays open so
         nothing typed is lost. Re-thrown so RecordFormModal does not announce
         a save that did not happen. */
      const message = err?.response?.data?.message || err?.message || 'Could not create the project.';
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  };

  /* Typed wins; otherwise the city names it. Derived at the point of use and
     never written into the field, so the default keeps up with the city
     instead of freezing on the first keystroke. */
  const derivedName = city.trim() ? `Mystery Rooms — ${city.trim()}` : '';
  const projectName = name.trim() || derivedName;

  if (!open) return null;

  return (
    <RecordFormModal
      open
      onClose={busy ? () => {} : onClose}
      loading={loadingTemplate}
      title="Property in Hand"
      subtitle="The property is already decided — create the project and plan the outlet, in one form."
      schema={schema}
      recordNoun={stage?.recordNoun || 'Project Plan'}
      submitLabel="Create project & plan"
      saving={busy}
      error={error}
      announce={false}
      onSaveDraft={save}
      onSubmit={save}
      preface={(
        <>
          <p className="np-kind-note">
            The property is already decided, so Phase 1 (capture) and Phase 2 (assessment) close
            themselves on creation. The project starts at commercial closure — LOI, lease, legal
            check, deposit, NOCs and approvals — and everything after it runs as normal.
          </p>

          <section className="col gap-2">
            <div className="sec-head">The Project</div>
            <div className="form-grid">
              <div className="field form-grid-full" style={{ marginBottom: 0 }}>
                <label className="label"><Building2 size={13} /> Project name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={derivedName || 'Mystery Rooms — <city>'}
                />
                <span className="tiny muted">
                  {name.trim()
                    ? 'This is what the project will be called.'
                    : 'Left blank, it is named after the city — type here to call it something else.'}
                </span>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label">Project code</label>
                <div className="np-code">
                  <Hash size={14} /> {codePreview(city)}
                  <em>Generated on create</em>
                </div>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label">
                  <MapPin size={13} /> City <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                {/* CityCombobox speaks in events, not strings — see its
                    `emit`, which wraps the picked city in a synthetic target. */}
                <CityCombobox value={city} onChange={(e) => setCity(e.target.value)} />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label">
                  <CalendarDays size={13} /> Planned start <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  className="input"
                  type="date"
                  value={plannedStartDate}
                  onChange={(e) => setPlannedStartDate(e.target.value)}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label"><Gauge size={13} /> Priority</label>
                <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <div className="field form-grid-full" style={{ marginBottom: 0 }}>
                <label className="label">Remarks</label>
                <textarea
                  className="textarea"
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Context for the launch team — landlord notes, mall tie-ups, timing constraints…"
                />
              </div>
            </div>
            {/* Said once, where the duplicate would otherwise appear. */}
            <span className="tiny muted">
              The project's area is the confirmed area you set on the plan below — it is not asked twice.
            </span>
          </section>
        </>
      )}
    />
  );
}

export default PropertyInHandModal;
