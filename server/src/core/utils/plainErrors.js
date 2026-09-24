/**
 * ERRORS, SAID THE WAY A PERSON WOULD SAY THEM.
 *
 * A validation failure used to reach the screen as the library wrote it:
 *
 *   Validation failed
 *   source: Invalid enum value. Expected 'franchise' | 'broker' | 'demand' |
 *   'captured', received 'other'
 *
 * Every word of that is true and none of it is for the person reading it.
 * "Invalid enum value" is a type-system term; the pipe-separated list is the
 * internal codes we store rows under, not the words on their tabs; and the
 * headline says a thing failed without saying what or what to do. Somebody
 * clicked a tab and got a sentence they could only escalate.
 *
 * So the edge translates. The technical form is still produced — it goes to
 * the log, where the person who can act on it is looking — and the screen gets
 * one plain sentence about the one thing that went wrong.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: invent reassurance, or hide that
 * something broke. "Source does not accept that value" is plain and true. A
 * cheerful "Oops! Something went wrong 🙈" is neither.
 */

/**
 * Field names people would recognise.
 *
 * Only where the raw key is jargon or genuinely ambiguous. `city` needs no
 * entry; `dir` and `limit` do, because nobody calls them that.
 */
const LABELS = {
  source: 'Source',
  stage: 'Step',
  sort: 'Sort column',
  dir: 'Sort direction',
  limit: 'Rows per page',
  page: 'Page',
  search: 'Search',
  includeRejected: 'Include rejected',
  recordId: 'Property',
  projectId: 'Project',
  enquiryId: 'Enquiry',
  assessmentType: 'Assessment',
  stageKey: 'Phase',
  drawingNo: 'Drawing number',
  assignedTo: 'Assigned to',
  plannedDate: 'Planned date',
  approvalState: 'Approval',
};

/** "assignedTo" -> "Assigned to"; "plan.start_date" -> "Start date". */
export function fieldLabel(field) {
  if (!field) return 'One of the details';
  const last = String(field).split('.').pop();
  if (LABELS[last]) return LABELS[last];
  const spaced = last
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * One Zod issue, as a sentence.
 *
 * The allowed values are NOT listed back. They are the codes rows are stored
 * under — `captured`, `demand` — and the reader has never seen those words;
 * printing them explains nothing and invites somebody to type one in.
 */
export function plainZodIssue(issue) {
  const field = issue.path.slice(1).join('.') || issue.path.join('.');
  const L = fieldLabel(field);

  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? `${L} is missing.`
        : `${L} is not in a form we can read.`;

    case 'invalid_enum_value':
    case 'invalid_literal':
      return `${L} does not accept “${issue.received}”.`;

    case 'too_small':
      if (issue.type === 'string') {
        return issue.minimum === 1 ? `${L} cannot be empty.` : `${L} is too short.`;
      }
      if (issue.type === 'array') return `${L} needs at least ${issue.minimum}.`;
      return `${L} is too small.`;

    case 'too_big':
      if (issue.type === 'string') return `${L} is too long.`;
      if (issue.type === 'array') return `${L} allows at most ${issue.maximum}.`;
      return `${L} is too large.`;

    case 'invalid_string':
      if (issue.validation === 'email') return `${L} is not a valid email address.`;
      if (issue.validation === 'url') return `${L} is not a valid web address.`;
      return `${L} is not in a form we can read.`;

    case 'unrecognized_keys':
      return 'Something was sent that does not belong on this form.';

    case 'invalid_date':
      return `${L} is not a real date.`;

    default:
      /* Zod's own message where it wrote one deliberately (`.refine`s in this
         codebase carry sentences meant for people); the generic line where it
         did not. */
      return issue.message && !/^Invalid|^Expected/.test(issue.message)
        ? issue.message
        : `${L} is not valid.`;
  }
}

/**
 * A whole failure as one headline plus, where it helps, the list.
 *
 * ONE issue gets its sentence as the headline and NO list — the toast would
 * otherwise print the same words twice, which reads as two problems.
 */
export function plainZodError(issues) {
  const lines = issues.map(plainZodIssue);
  const unique = [...new Set(lines)];
  if (unique.length === 1) return { message: unique[0], details: undefined };
  return {
    message: `${unique.length} of the details sent were not accepted.`,
    details: unique,
  };
}

/** Mongoose's own validation errors, same treatment. */
export function plainMongooseIssue(e) {
  const L = fieldLabel(e.path);
  if (e.kind === 'required') return `${L} is missing.`;
  if (e.kind === 'enum') return `${L} does not accept “${e.value}”.`;
  if (e.kind === 'ObjectId' || e.name === 'CastError') return `${L} is not something we recognise.`;
  if (e.kind === 'min') return `${L} is too small.`;
  if (e.kind === 'max') return `${L} is too large.`;
  /* Schema authors write these by hand and usually write them for people;
     strip the framework's own decoration and keep the sentence. */
  return String(e.message || `${L} is not valid.`)
    .replace(/^Path `[^`]+` /, `${L} `)
    .replace(/`/g, '');
}

export default { fieldLabel, plainZodIssue, plainZodError, plainMongooseIssue };
