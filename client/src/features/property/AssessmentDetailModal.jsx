import { Modal } from '../../components/ui/Modal.jsx';
import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { FIELD_GROUPS, labelOfField, formatFieldValue } from './assessmentFields.js';

/**
 * One assessment, in full — every answer the assessor gave.
 *
 * WHY THIS EXISTS. Half the fields on these forms are prose: Purpose,
 * Competitor Analysis, Risk Factors, Structural Assessment, Customer Flow,
 * Remarks, the doer's own Notes. A sheet column can hold about eight words of
 * that, and the rest was reachable only as a browser tooltip — which cannot
 * be scrolled, cannot be selected, cannot be copied into an email, and
 * vanishes the moment the mouse moves. So the long answers were effectively
 * written into a field nobody could read back.
 *
 * The cell now shows the opening line and says "See more"; this is what
 * opens. It shows the WHOLE assessment rather than the one field clicked,
 * because the question behind "what does the Purpose say" is almost always
 * "what did they actually find", and the next three fields are the answer.
 *
 * READ-ONLY, DELIBERATELY. Changing an answer belongs on the form, which the
 * Score cell opens and which carries the validation, the attachments and the
 * submit. A second place to edit the same values is a second place for them
 * to disagree.
 */
export function AssessmentDetailModal({ row, type, entry, onClose }) {
  const meta = ASSESSMENTS.find((a) => a.key === type);
  const values = entry?.values || {};
  const groups = FIELD_GROUPS[type] || [];

  /* Only what was answered. An empty form printed as thirty "—" rows reads as
     a fault in the page rather than as work nobody has done yet. */
  const answered = (keys) => keys.filter((k) => {
    const v = values[k];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
  });

  const filled = groups
    .map((g) => ({ ...g, keys: answered(g.keys) }))
    .filter((g) => g.keys.length);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${meta?.label || type} assessment`}
      subtitle={[row?.title, row?.city].filter(Boolean).join(' · ')}
      width={680}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      )}
    >
      {!filled.length ? (
        <p className="sm muted" style={{ margin: 0 }}>
          Nothing has been filled in on this assessment yet. Open the form from the Score cell to start it.
        </p>
      ) : (
        <div className="ad-groups">
          {filled.map((g) => (
            <section key={g.label} className="ad-group">
              <h4 className="ad-group-head">{g.label}</h4>
              <dl className="ad-list">
                {g.keys.map((k) => (
                  <div key={k} className={`ad-item${g.long?.includes(k) ? ' is-long' : ''}`}>
                    <dt>{labelOfField(type, k)}</dt>
                    <dd>{formatFieldValue(k, values[k])}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default AssessmentDetailModal;
