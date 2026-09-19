import { useState } from 'react';
import {
  ChevronDown, ChevronRight, Target, User, Clock, ListChecks,
} from 'lucide-react';
import { PhaseBrief } from '../../components/ui/PhaseBrief.jsx';
import { useDefaultTemplate } from '../../app/api/templatesApi.js';
import { PROPERTY_FMS, fmsRowsFor } from './propertyFms.js';

/**
 * What, Who, When and How for the Property step you are looking at.
 *
 * WHY IT IS COLLAPSED. The four pillars are how the step is DEFINED, not what
 * you do minute to minute — somebody working the queue needs the table once,
 * and then needs the queue. A four-column table opening above every step would
 * push the actual work below the fold, which is the same call
 * `StageExplainer` already makes on the phase pages.
 *
 * The one line that stays visible is the deliverable, because that is the
 * pillar most often got wrong: "Signed LOI uploaded" is a milestone, "talk to
 * the landlord" is an activity, and a step whose name is an activity cannot be
 * marked done by anybody except the person who did it.
 *
 * WHERE THE ROWS COME FROM. The template's own `whatWhoWhenHow` for the stage
 * this step works on — see propertyFms.js. The DEFAULT template, because this
 * module is cross-project: the queue holds properties from every project at
 * once, and there is no single project whose template could speak for the
 * step. Where a project is on a different template its stage rows may differ,
 * and the place that shows a project's own are its phase pages.
 */
export function PropertyFmsBrief({ stepKey, title }) {
  const [open, setOpen] = useState(false);
  const { data: template } = useDefaultTemplate();

  const entry = PROPERTY_FMS[stepKey];
  const rows = fmsRowsFor(stepKey, template);
  if (!entry) return null;

  return (
    <div className={`pfms${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="pfms-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="pfms-label">What, who, when &amp; how</span>
        {/* The deliverable stays on the collapsed row: it is the pillar a step
            is most often defined wrongly against. */}
        <span className="pfms-deliverable" title={entry.deliverable}>{entry.deliverable}</span>
      </button>

      {open && (
        <div className="pfms-body">
          {/* The same four-column table the phase pages and the master flow
              show, so the brief reads identically wherever it appears. */}
          <PhaseBrief stage={{ whatWhoWhenHow: rows }} compact />

          {rows.length === 0 && (
            <p className="pfms-none">
              The template carries no What/Who/When/How for this step yet. Add it to the
              stage in Templates and it appears here — nothing is invented in its place.
            </p>
          )}

          {/* THE "HOW" PILLAR, as a destination rather than a description. The
              template says what kind of thing to do; this says where it is. */}
          <div className="pfms-how">
            <span className="pfms-how-icon"><ListChecks size={15} /></span>
            <span className="pfms-how-body">
              <span className="pfms-how-title">{entry.how.label}</span>
              <span className="pfms-how-hint">{entry.how.hint}</span>
            </span>
          </div>

          <div className="pfms-pillars">
            <span><Target size={12} /> What — the deliverable, not the activity</span>
            <span><User size={12} /> Who — exactly one owner</span>
            <span><Clock size={12} /> When — turnaround from the step before</span>
            <span><ListChecks size={12} /> How — the form, linked{title ? ` on ${title}` : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PropertyFmsBrief;
