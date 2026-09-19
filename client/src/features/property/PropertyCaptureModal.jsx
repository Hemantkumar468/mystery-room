import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Search, ArrowRight, Plus, ArrowLeft, Info, MapPin,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { CityCombobox } from '../../components/ui/CityCombobox.jsx';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { useProjects, useProject, useCreateProject } from '../../app/api/projectsApi.js';
import { useTemplate, useDefaultTemplate } from '../../app/api/templatesApi.js';
import { useCreateRecordMutation } from '../../app/api/recordsApi.js';
import { useGetPropertyQueueQuery } from '../../app/api/propertyCaptureApi.js';

/**
 * Capture a property from the queue it lands in.
 *
 * THE FORM IS NOT A NEW ONE. It is the Phase 1 (`p1`) property-capture form
 * off the template — the same `masterDataSchema` PhasePage renders inside a
 * project, through the same `DynamicField` controls. A second copy of those
 * fields would drift from the template the day somebody edits one.
 *
 * ── IT ASKS FOR A CITY, NOT A PROJECT ─────────────────────────────────
 * A captured property is a `p1` Record and a Record belongs to a project, so
 * this form has to land on one. But "which project is this site for?" is not a
 * question the person filling it in is answering — they are answering "where
 * do we want a store, and which shop in that city is this?". So the form asks
 * the CITY, and the project is derived from it: the live project for that city
 * if there is one, a new project for that city if there is not. Nobody picks
 * an id out of a list to describe a place.
 *
 * TWO LOCATIONS, AND THEY ARE NOT THE SAME QUESTION. The city is where we want
 * to open — Bhopal. The Live Location further down is the pin on THIS shop
 * inside it. They were being conflated, and a form that asks for "location"
 * once gets one of the two answers and loses the other.
 *
 * With no project yet, the schema comes from the PUBLISHED DEFAULT TEMPLATE —
 * the template that new project will be created on, so the fields are the ones
 * it would have asked for anyway. When the city resolves to an existing
 * project, that project's own template takes over, because a project put on a
 * different template must get that template's fields.
 *
 * ── Saving ────────────────────────────────────────────────────────────
 * One action: the project is created if it needs to be, then the property is
 * filed on it. The queue stays open behind the dialog — the new row appearing
 * in it is the proof, and the flash names the project it went to, because
 * "where did it go?" is the one thing not navigating leaves unanswered.
 */
const STAGE_CAPTURE = 'p1';
const NEW_PROJECT = '__new__';

/**
 * NEWEST FIRST, EVERYWHERE, AND ALWAYS WITH ITS DATE.
 *
 * Alphabetical order is only useful when you already know the name you are
 * looking for. Nobody opening one of these lists does: they are looking for
 * the thing they filed this morning, and on a list of forty it sat wherever
 * the alphabet put it. Newest first puts it on the first line, and the date
 * beside each option is what makes two sites with near-identical names
 * distinguishable at all.
 */
const newestFirst = (list, dateOf = (x) => x?.createdAt) => [...(list || [])]
  .sort((a, b) => new Date(dateOf(b) || 0) - new Date(dateOf(a) || 0));

/** "12 Sep '26" — short enough for an <option>, unambiguous across a year end. */
const shortDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  : '');


function Gate({ onYes, onNo }) {
  return (
    <div className="col gap-3">
      <p className="sm" style={{ margin: 0 }}>
        A property is filed against the store it is a candidate for, so it can be
        compared with the other options for that store.
      </p>
      <div className="pcw-gate">
        <button type="button" className="pcw-gate-btn" onClick={onYes}>
          <Building2 size={18} />
          <span className="pcw-gate-main">Yes, the project exists</span>
          <span className="pcw-gate-sub">Pick it and start filling in the property</span>
          <ArrowRight size={14} className="pcw-gate-go" />
        </button>
        <button type="button" className="pcw-gate-btn" onClick={onNo}>
          <Plus size={18} />
          <span className="pcw-gate-main">No, there is no project yet</span>
          <span className="pcw-gate-sub">Fill the property in — the project is created with it</span>
          <ArrowRight size={14} className="pcw-gate-go" />
        </button>
      </div>
    </div>
  );
}

function ProjectPicker({ projects, onPick, onBack }) {
  const [q, setQ] = useState('');

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = projects.filter((p) => p.status !== 'draft' && !p.archivedAt);
    if (!needle) return list;
    return list.filter((p) => [p.name, p.code, p.city]
      .some((f) => f && String(f).toLowerCase().includes(needle)));
  }, [projects, q]);

  return (
    <div className="col gap-3">
      <span className="prop-search" style={{ width: '100%' }}>
        <Search size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Project, code or city…" autoFocus />
      </span>

      {!matches.length ? (
        <div className="prop-pick-empty">
          {q ? 'No project matches that.' : 'There is no project to file a property against yet.'}
        </div>
      ) : (
        <div className="prop-pick-list">
          {matches.map((p) => (
            <button key={p._id} type="button" className="prop-pick-row" onClick={() => onPick(p)}>
              <span className="prop-pick-main">
                <span className="prop-pick-name">{p.name}</span>
                <span className="prop-pick-sub">{[p.code, p.city].filter(Boolean).join(' · ') || 'No code'}</span>
              </span>
              <ArrowRight size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}

      <button type="button" className="pcw-jump" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        <ArrowLeft size={11} /> Back
      </button>
    </div>
  );
}

/**
 * @param startProject  file straight against this project — "Find a site" on a
 *                      sourcing row that already has one.
 * @param prefill       no project yet: what the lead already told us, used to
 *                      name and place the project this capture creates.
 */
export function PropertyCaptureModal({
  open, onClose, startProject = null, prefill = null,
}) {
  /* 'gate' → 'pick' → 'capture'. Both real entry points skip straight to
     'capture': with a project, or with the project asked for on the form. */
  const [phase, setPhase] = useState('capture');
  const [project, setProject] = useState(null);
  /* The city this site is for. The project follows from it. */
  const [city, setCity] = useState('');
  /* Which project in that city it files into — set only when the city has more
     than one and somebody has to say which. */
  const [fileInto, setFileInto] = useState(NEW_PROJECT);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const startId = startProject?._id || null;
  const seeded = Boolean(prefill);
  useEffect(() => {
    if (!open) return;
    if (startId) { setProject(startProject); setPhase('capture'); }
    else if (seeded) { setProject(null); setPhase('capture'); }
    else { setProject(null); setPhase('gate'); }
    setCity((prefill?.city || '').trim());
    setFileInto(NEW_PROJECT);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startId, seeded]);

  const { data: projResp, isLoading: loadingProjects } = useProjects({ limit: 200 });
  const projects = projResp?.data?.items || projResp?.data || projResp || [];
  const projectList = newestFirst((Array.isArray(projects) ? projects : [])
    .filter((p) => p.status !== 'draft' && !p.archivedAt));

  /* Every live project in the city that was typed. One is the ordinary case
     and is used without asking; several is a real question, and only then is
     it put to the reader. */
  const cityKey = city.trim().toLowerCase();
  const inCity = cityKey
    ? projectList.filter((p) => String(p.city || '').trim().toLowerCase() === cityKey)
    : [];

  /* Whichever project the form is filing into right now — the one it was
     opened on, the one the city resolves to, or the one picked when the city
     has more than one. */
  const chosen = project
    || (fileInto !== NEW_PROJECT ? inCity.find((p) => p._id === fileInto) : null)
    || (inCity.length === 1 ? inCity[0] : null)
    || null;

  /* The schema comes from that project's OWN template; with no project yet,
     from the published default — the one the new project will run. */
  const { data: full } = useProject(chosen?._id);
  const templateId = full?.template?.ref?._id || full?.template?.ref;
  const { data: template, isLoading: loadingTemplate } = useTemplate(templateId);
  const { data: defResp, isLoading: loadingDefault } = useDefaultTemplate();
  const defaultTemplate = defResp?.data || defResp || null;

  const active = chosen ? template : defaultTemplate;
  const stage = active?.stages?.find((st) => st.key === STAGE_CAPTURE) || null;
  const schema = stage?.masterDataSchema || [];

  /**
   * What we are already looking at in that city.
   *
   * Typing "Bhopal" on a blank capture form is the moment somebody is about to
   * write down a site — and the one thing they cannot know from the form is
   * whether the same shop was filed last week by somebody else, or what else
   * is on the table there. The queue already answers that per city, so it is
   * asked as the city is typed and the answer sits under the field.
   */
  /* The city in play: typed here, or the one the store already has. */
  const cityShown = (full?.city || project?.city || city).trim();
  const { data: cityQueue, isFetching: cityLoading } = useGetPropertyQueueQuery(
    { city: cityShown, limit: 50 },
    { skip: !cityShown },
  );
  const cityRows = cityQueue?.rows || cityQueue?.data?.rows || [];
  const cityProperties = newestFirst(cityRows.filter((r) => r.stage !== 'demand'));

  const createProject = useCreateProject();
  const [createRecord] = useCreateRecordMutation();

  const close = () => {
    setPhase('capture');
    setProject(null);
    setError(null);
    onClose?.();
  };

  /** The project this capture lands on — made now if it does not exist yet. */
  const resolveProject = async () => {
    if (chosen) return chosen;
    const where = city.trim();
    if (!where) throw new Error('Say which city this property is in.');
    return createProject.mutateAsync({
      name: (prefill?.name || '').trim() || `Mystery Rooms — ${where}`,
      kind: 'new_centre',
      city: where,
      plannedStartDate: new Date().toISOString().slice(0, 10),
      priority: 'medium',
      ...(prefill?.notes ? { description: prefill.notes } : {}),
    });
  };

  /**
   * Save, and STAY HERE. The person filing this was working the queue; sending
   * them to the project page to prove the save ended the session they were in
   * the middle of. The new row appearing behind the closing dialog is the
   * proof — `recordInvalidation` busts the PropertyCapture tag on a p1 write.
   */
  const save = async (payload) => {
    setError(null);
    setBusy(true);
    try {
      const target = await resolveProject();
      await createRecord({
        projectId: target._id,
        stageKey: STAGE_CAPTURE,
        status: payload.status,
        values: payload.values,
      }).unwrap();
      flashSuccess(payload.status === 'draft'
        ? `Saved on ${target.name} — you can finish it later`
        : `Property captured on ${target.name}`);
      close();
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Could not save the property.';
      setError(message);
      throw new Error(message); // keeps the form open, values intact
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  if (phase === 'capture' && schema.length > 0) {
    return (
      <RecordFormModal
        open
        onClose={busy ? () => {} : close}
        loading={loadingTemplate || loadingDefault}
        schema={schema}
        recordNoun={stage?.recordNoun || 'Property'}
        projectId={chosen?._id || null}
        subtitle={chosen ? `On ${chosen.name}${chosen.code ? ` · ${chosen.code}` : ''}` : undefined}
        saving={busy}
        error={error}
        announce={false}
        onSaveDraft={save}
        onSubmit={save}
        documentRead={chosen ? { projectId: chosen._id, stageKey: STAGE_CAPTURE } : null}
        /* The city, where every other answer is given — not a project id in
           front of the form as a gate somebody has to get past. */
        preface={(
          <section className="col gap-2">
            <div
              className="section-title"
              style={{ padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}
            >
              Where do we want to open?
            </div>
            <div className="form-grid">
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label">
                  <MapPin size={13} /> City {!project && <span style={{ color: 'var(--danger)' }}>*</span>}
                </label>
                {/* A store that already exists HAS a city — it is stated, not
                    asked again, and it is stated first because "where" is the
                    question a site is written down against. */}
                {project ? (
                  <div className="pcap-city-fixed">
                    <b>{cityShown || 'No city on this store'}</b>
                    <span>{project.name}{project.code ? ` · ${project.code}` : ''}</span>
                  </div>
                ) : (
                  /* CityCombobox speaks in events, not strings — see its `emit`. */
                  <CityCombobox value={city} onChange={(e) => setCity(e.target.value)} />
                )}
                <span className="tiny muted">
                  The city this store is for. Where exactly in it — this shop, this pin — is the
                  Live Location below.
                </span>
              </div>

              {/* Only a city with SEVERAL live projects is a question. One is
                  used without asking, none creates one; putting either to the
                  reader would be asking them to confirm the obvious. */}
              {!project && inCity.length > 1 && (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label">Which store in {city.trim()}?</label>
                  <select className="select" value={fileInto} onChange={(e) => setFileInto(e.target.value)}>
                    <option value={NEW_PROJECT}>A new store in {city.trim()}</option>
                    {inCity.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}{p.code ? ` — ${p.code}` : ''}
                        {p.createdAt ? ` · ${shortDate(p.createdAt)}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Everything already on the table in that city — so nobody files
                the same shop twice, and so the site being written down can be
                weighed against the ones beside it. */}
            {cityShown && (
              <div className="pcap-city">
                <span className="pcap-city-head">
                  {cityLoading ? `Looking at ${cityShown}…`
                    : cityProperties.length
                      ? `${cityProperties.length} propert${cityProperties.length === 1 ? 'y' : 'ies'} already in ${cityShown}`
                      : `Nothing captured in ${cityShown} yet — this is the first`}
                </span>
                {cityProperties.length > 0 && (
                  <ul className="pcap-city-list">
                    {cityProperties.slice(0, 6).map((r) => (
                      <li key={r.id}>
                        <b>{r.title}</b>
                        <span>
                          {[r.locality, r.areaSqft ? `${Number(r.areaSqft).toLocaleString('en-IN')} sq ft` : null,
                            r.projectName, shortDate(r.createdAt)].filter(Boolean).join(' · ')}
                        </span>
                        <em className={`pcap-city-stage is-${r.stage}`}>{r.stage}</em>
                      </li>
                    ))}
                    {cityProperties.length > 6 && (
                      <li className="pcap-city-more">+{cityProperties.length - 6} more in the queue</li>
                    )}
                  </ul>
                )}
              </div>
            )}

            <span className="tiny muted" style={{ display: 'inline-flex', gap: 6 }}>
              <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
              {!cityShown
                ? 'Name the city and this property is filed against its store — an existing one, or a new one created with it.'
                : chosen
                  ? `Filed against ${chosen.name}${chosen.code ? ` · ${chosen.code}` : ''}, alongside its other candidate sites.`
                  : `A store for ${cityShown} is created when you save, and this property is filed as its first candidate site.`}
            </span>
          </section>
        )}
      />
    );
  }

  const waitingForForm = phase === 'capture';

  return (
    <Modal
      open
      onClose={close}
      title="Capture a property"
      subtitle={phase === 'pick'
        ? 'Which store is this site a candidate for?'
        : 'The Phase 1 property form, filled in from here.'}
      width={520}
    >
      {waitingForForm ? (
        <div className="prop-pick-empty">
          {loadingTemplate || loadingDefault || !active
            ? 'Fetching the property form…'
            : 'The template has no Phase 1 capture form, so there is nothing to fill in. Add the form to the template, or pick another project.'}
          {!loadingTemplate && active && (
            <button
              type="button"
              className="prop-intake-btn"
              style={{ marginTop: 10 }}
              onClick={() => { setProject(null); setPhase('pick'); }}
            >
              <Building2 size={13} /> Pick a different project
            </button>
          )}
        </div>
      ) : phase === 'pick' ? (
        loadingProjects ? (
          <div className="prop-pick-empty">Loading projects…</div>
        ) : (
          <ProjectPicker
            projects={projectList}
            onPick={(p) => { setProject(p); setPhase('capture'); }}
            onBack={() => setPhase('gate')}
          />
        )
      ) : (
        <Gate onYes={() => setPhase('pick')} onNo={() => { setProject(null); setPhase('capture'); }} />
      )}
    </Modal>
  );
}

export default PropertyCaptureModal;
