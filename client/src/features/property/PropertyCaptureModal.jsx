import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Search, ArrowRight, ArrowLeft, Info, MapPin,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { CityCombobox } from '../../components/ui/CityCombobox.jsx';
import { RecordFormModal } from '../projects/records/RecordFormModal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { useProjects, useProject, useCreateProject } from '../../app/api/projectsApi.js';
import { useTemplate, useDefaultTemplate } from '../../app/api/templatesApi.js';
import { useCreateRecordMutation } from '../../app/api/recordsApi.js';
import { useGetPropertyQueueQuery } from '../../app/api/propertyCaptureApi.js';
import { CaptureTaskDone } from './CaptureTaskDone.jsx';
import { decisionOnly } from './propertyUi.jsx';

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


/**
 * NO GATE IN FRONT OF THE FORM.
 *
 * Capture Property used to open a question first — "do we already have this
 * location, yes or no?" — and only then the form. It was asking something the
 * form goes on to ask anyway, and asking it at the worst possible moment:
 * before you have typed a single thing, with no city on screen to reason
 * about. Worse, the honest answer is often "I don't know" — whether we run a
 * store in Indore is a fact about our estate, not about the shop somebody is
 * standing in.
 *
 * So the form opens straight away and the city field settles it. Type Bhopal
 * and the form says we already have it and files the site into that store;
 * type somewhere new and a store is created with the property as its first
 * candidate site. Either way the answer is derived from the city, which is
 * how the properties end up grouped by location on the queue — one row per
 * city, every site filed under it — rather than from a click that could
 * disagree with what was typed underneath it.
 *
 * `ProjectPicker` below is kept for the one case the form cannot resolve: a
 * template with no Phase 1 capture form, where the only way forward is to
 * pick a store whose template has one.
 */

/**
 * LOCATION FIRST, THEN THE STORE IN IT.
 *
 * This listed every project by name, so "Mystery Rooms — Bhopal" appeared
 * twice with nothing to tell the two apart, and somebody looking for a city
 * had to read 35 project names to find it. The question being asked is which
 * LOCATION the site belongs to; the store inside that location is a second,
 * much smaller question, and usually has one obvious answer.
 */
function ProjectPicker({ projects, onPickCity, onBack }) {
  const live = useMemo(
    () => projects.filter((p) => p.status !== 'draft' && !p.archivedAt),
    [projects],
  );

  /* One entry per city, with the stores that sit in it. */
  const byCity = useMemo(() => {
    const map = new Map();
    for (const p of live) {
      const label = String(p.city || '').trim() || 'No city set';
      const key = label.toLowerCase();
      if (!map.has(key)) map.set(key, { label, stores: [] });
      map.get(key).stores.push(p);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [live]);

  const [q, setQ] = useState('');

  /* Typed text filters the list; it is not a second way of saying the answer.
     The location still has to be PICKED, because a property filed against a
     city nobody runs a store in has nowhere to go. */
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return byCity;
    return byCity.filter((c) => c.label.toLowerCase().includes(needle)
      || c.stores.some((s) => [s.name, s.code].some((v) => String(v || '').toLowerCase().includes(needle))));
  }, [byCity, q]);

  return (
    <div className="col gap-3">
      {/* Type OR pick. A bare <select> means scrolling 23 options to reach
          Ujjain; a bare text box means knowing the spelling we stored. The
          box narrows the list and the list is still the thing you click, so
          neither knowledge is required. */}
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label" htmlFor="pcw-loc">Location</label>
        <span className="prop-search" style={{ width: '100%' }}>
          <Search size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
          <input
            id="pcw-loc"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              /* Enter takes the only one left — typing "ujj" and pressing
                 Enter opens the form on Ujjain, which is the whole
                 interaction when you know where you mean. */
              if (e.key === 'Enter' && matches.length === 1) {
                e.preventDefault();
                onPickCity(matches[0]);
              }
            }}
            placeholder="Type a location, or pick one below…"
            autoFocus
            autoComplete="off"
          />
        </span>
      </div>

      {!byCity.length && (
        <div className="prop-pick-empty">There is no location to file a property against yet.</div>
      )}

      {/* A LOCATION CLICK IS THE ANSWER, not the first half of one.
          This used to open a second list of that city's stores — but the
          capture form already asks "Which store in Bhopal?" whenever the city
          holds more than one, so the middle step asked the same question
          twice and delayed the form by a click for every single-store city. */}
      {byCity.length > 0 && (
        matches.length ? (
          <div className="prop-pick-list">
            {matches.map((c) => (
              <button
                key={c.label}
                type="button"
                className="prop-pick-row"
                onClick={() => onPickCity(c)}
              >
                <span className="prop-pick-main">
                  <span className="prop-pick-name">{c.label}</span>
                  <span className="prop-pick-sub">
                    {c.stores.length} store{c.stores.length === 1 ? '' : 's'}
                  </span>
                </span>
                <ArrowRight size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
              </button>
            ))}
          </div>
        ) : (
          <div className="prop-pick-empty">
            No location matches “{q.trim()}”. Use “No, this location is new” if it is not ours yet.
          </div>
        )
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
  /* 'capture' always, and 'pick' only as the escape hatch when the template
     turns out to have no capture form on it. Nothing opens on a question. */
  const [phase, setPhase] = useState('capture');
  const [project, setProject] = useState(null);
  /* The city this site is for. The project follows from it. */
  const [city, setCity] = useState('');
  /* Which project in that city it files into — set only when the city has more
     than one and somebody has to say which. */
  const [fileInto, setFileInto] = useState(NEW_PROJECT);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  /**
   * WHAT WAS FILED, AND ON WHAT.
   *
   * Capturing is not one form filled once: a store is hunted by walking
   * several shops and writing each down, so the form ends on a question —
   * another, or finished? — rather than simply closing. `filed` counts this
   * sitting, which is what makes "3 filed" true rather than guessed.
   */
  const [done, setDone] = useState(null);   // { project, title } once saved
  const [filed, setFiled] = useState(0);

  const startId = startProject?._id || null;
  const seeded = Boolean(prefill);
  useEffect(() => {
    if (!open) return;
    if (startId) { setProject(startProject); setPhase('capture'); }
    else if (seeded) { setProject(null); setPhase('capture'); }
    else { setProject(null); setPhase('capture'); }
    setCity((prefill?.city || '').trim());
    setFileInto(NEW_PROJECT);
    setError(null);
    setDone(null);
    setFiled(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startId, seeded]);

  /* Only while the dialog is open. This component is mounted by the property
     queue whether or not anybody has pressed Capture Property, so this ran on
     every visit to that page and fetched the full project list - the single
     biggest response in the app - to fill a dropdown nobody could see. */
  const { data: projResp, isLoading: loadingProjects } = useProjects({ limit: 200 }, { skip: !open });
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
  /* Closed means nothing to build a form from, and this is the app's heaviest
     response. See the project list above for the same reasoning. */
  const { data: defResp, isLoading: loadingDefault } = useDefaultTemplate({ skip: !open });
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
    setDone(null);
    setFiled(0);
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
      /**
       * A DRAFT IS NOT A FILING, so it closes as it always did — there is
       * nothing to review and nothing to finish. Only a real submission
       * reaches the question below.
       */
      if (payload.status === 'draft') {
        flashSuccess(`Saved on ${target.name} — you can finish it later`);
        close();
        return;
      }
      flashSuccess(`Property "${String(payload.values?.property_name || '').trim() || 'Untitled'}" saved successfully`);
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

  /**
   * THE END OF A FILING, not the end of the job.
   *
   * See CaptureTaskDone: the capture task stays open when a property is
   * saved, because a store is hunted by walking several shops. This is where
   * the person doing it says which of the two things is happening — another
   * one, or that is the lot.
   */
  if (phase === 'done' && done) {
    return (
      <Modal
        open
        onClose={close}
        title="Property captured"
        subtitle={done.project?.name ? `On ${done.project.name}` : undefined}
        width={520}
      >
        <CaptureTaskDone
          project={done.project}
          filedThisSession={filed}
          lastTitle={done.title}
          onAnother={() => {
            /* Same store, blank form. The city and the project stay put —
               re-typing Bhopal for the second shop in Bhopal is the friction
               that stops the third and fourth ever being filed. */
            setProject(done.project);
            setDone(null);
            setError(null);
            setPhase('capture');
          }}
          onClose={(out) => {
            if (out?.finished) flashSuccess('Your capture task is done — the properties are with MD Review');
            else if (out?.failed) flashSuccess('Properties are filed. Your task could not be closed — try it from My Tasks.');
            close();
          }}
        />
      </Modal>
    );
  }

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
        allowDraft={false}
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

              {/* SAY SO WHEN THE LOCATION IS ALREADY OURS.
                  Down the "this location is new" road, a city we already run
                  was silently filed into the store that holds it — correct,
                  but invisible, so somebody who believed they were opening a
                  new location never learned they were not. One store is stated
                  here; several is a real question and is asked below. */}
              {!project && inCity.length === 1 && (
                <p className="pcap-exists">
                  <Building2 size={13} />
                  <span>
                    We already have <b>{city.trim()}</b> — {inCity[0].name}
                    {inCity[0].code ? ` (${inCity[0].code})` : ''}. This property will be
                    filed into it rather than opening a second location.
                  </span>
                </p>
              )}

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
                        {/* NOT `r.stage`. This printed the raw pipeline word —
                            "assessment", "commercial" — on somebody else's
                            property, to a person filing a new one. Where the
                            site has been routed to is the MD's business; the
                            verdict is the only part that is the filer's. */}
                        {(() => {
                          const v = decisionOnly(r);
                          return v ? <em className={`pcap-city-stage is-${v.cls}`}>{v.label}</em> : null;
                        })()}
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
        ? 'Which location is this site a candidate for?'
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
      ) : (
        loadingProjects ? (
          <div className="prop-pick-empty">Loading projects…</div>
        ) : (
          <ProjectPicker
            projects={projectList}
            onPickCity={(c) => {
              /* The city is the answer; the store inside it is left to the
                 form, which asks only when the city holds more than one.
                 `fileInto` starts on an existing store rather than on "a new
                 store in Bhopal" — they picked a location we already have,
                 so defaulting to opening another one would be the opposite
                 of what the click said. */
              setProject(null);
              setCity(c.label);
              setFileInto(c.stores[0]?._id || NEW_PROJECT);
              setPhase('capture');
            }}
            onBack={() => setPhase('capture')}
          />
        )
      )}
    </Modal>
  );
}

export default PropertyCaptureModal;
