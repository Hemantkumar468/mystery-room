import { useMemo } from 'react';
import { useDefaultTemplate } from '../../app/api/templatesApi.js';

/**
 * THE NAME OF A FIELD, AS THE FORM ITSELF CALLS IT.
 *
 * The queue's columns and the report's cells were each given a label by hand
 * when they were written, and the hand-written ones drifted from the form:
 * the form asks for "Carpet Area (sq ft)", "Commercial Type", "Property Name",
 * "Owner Name" and "Term (months)", and the table said "Carpet area",
 * "Commercial type", "Property", "Owner" and "Lease (yrs)" — the last one not
 * even naming the unit the number is in. Two names for one field is how
 * somebody comes to look for "Term" in a column that calls it "Lease".
 *
 * So the heading is read from the form definition (the Phase 1 stage of the
 * default template), keyed by the field's machine key, and the wording a
 * caller supplies is only the FALLBACK — used while the template is still
 * loading, or for a field the template no longer has. Rename a field in the
 * template and every column and report cell that shows it follows.
 *
 * The default template is the largest response the API serves, but it is the
 * same one the capture form opens on, so it is fetched once and shared.
 */
const CAPTURE_STAGE = 'p1';

export function useCaptureLabels() {
  const { data: template } = useDefaultTemplate();

  const labels = useMemo(() => {
    const stage = template?.stages?.find((s) => s.key === CAPTURE_STAGE);
    const map = new Map();
    for (const f of stage?.masterDataSchema || []) {
      /* An empty label (the Notes field has none — its SECTION is the name)
         would blank the heading, so it is skipped and the fallback is kept. */
      if (f?.key && String(f.label || '').trim()) map.set(f.key, String(f.label).trim());
    }
    return map;
  }, [template]);

  /** `labelOf('carpet_area', 'Carpet area')` -> the form's own wording, or the fallback. */
  const labelOf = (key, fallback) => labels.get(key) || fallback;

  return { labelOf, ready: labels.size > 0 };
}
