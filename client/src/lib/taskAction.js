import { getTaskPath } from '../features/projects/stagesConfig.jsx';

/**
 * WHERE A TASK'S WORK HAPPENS — the one "do it" link for a task row.
 *
 * A sheet of tasks is only useful if every row can be acted on from the row.
 * The answer to "where do I go to do this?" is decided here, in one order:
 *
 *   1. A link someone attached to the task   — a Drive folder, a Google Form,
 *      a vendor portal. If a person pasted it onto the job, it IS the job.
 *   2. Another module (`appPath`)            — hiring lives in HRMS.
 *   3. A form that can be filled right here  — the task's own form, filed and
 *      stamped with the task, landing in the phase's sheet.
 *   4. The phase page, focused on the task   — everything else.
 *
 * Phase 3's tasks carry no `formKey`, so the form is inferred exactly the way
 * TaskBrief infers it — by the template task key, then the department, then
 * the title. The rules are copied from TaskBrief.jsx rather than imported
 * because that file is mid-edit elsewhere; fold TaskBrief onto this once it
 * lands, so the two cannot drift.
 */

const LEGACY_TASK_FORM_KEYS = {
  p3: { p3_t1: 'loi', p3_t2: 'lease', p3_t3: 'legal', p3_t4: 'deposit', p3_t5: 'nocs' },
  p4: { p4_t1: 'project_creation', p4_t2: 'project_creation', p4_t3: 'project_creation' },
  p5: {
    p5_t1: 'construction', p5_t2: 'interior', p5_t3: 'procurement', p5_t4: 'automation', p5_t5: 'it',
    p5_t6: 'marketing', p5_t7: 'hr', p5_t8: 'finance', p5_t9: 'operations', p5_t10: 'legal',
  },
};

const TITLE_FORM_HINTS = [
  { stageKey: 'p3', formKey: 'loi', test: /\b(loi|letter of intent)\b/i },
  { stageKey: 'p3', formKey: 'lease', test: /\b(lease|agreement)\b/i },
  { stageKey: 'p3', formKey: 'legal', test: /\b(legal|title|due diligence)\b/i },
  { stageKey: 'p3', formKey: 'deposit', test: /\b(deposit|payment|token)\b/i },
  { stageKey: 'p3', formKey: 'nocs', test: /\b(noc|statutory|approvals?)\b/i },
  { stageKey: 'p4', formKey: 'project_creation', test: /\b(project|budget|opening|manager)\b/i },
];

/** Forms filed once per record of an earlier phase — Site Evaluation, per property. */
const PER_PARENT_STAGES = new Set(['p2']);

/** Phases worked on a purpose-built page, never through a generic form. */
const PAGE_ONLY_STAGES = new Set(['p15']);

const hasModule = (stage, key) => Boolean(key) && (stage?.assessmentTypes || []).some((a) => a.key === key);

export function inferFormKey(task, templateStage) {
  if (!task) return null;
  if (hasModule(templateStage, task.formKey)) return task.formKey;
  const byTaskKey = (LEGACY_TASK_FORM_KEYS[task.stageKey] || {})[task.templateTaskKey];
  if (hasModule(templateStage, byTaskKey)) return byTaskKey;
  const byDepartment = task.stageKey === 'p5' ? task.department : null;
  if (hasModule(templateStage, byDepartment)) return byDepartment;
  const hinted = TITLE_FORM_HINTS.find((h) => h.stageKey === task.stageKey && h.test.test(task.title || ''))?.formKey;
  if (hasModule(templateStage, hinted)) return hinted;
  return task.formKey || null;
}

/** "drive.google.com" — enough to recognise a link without its full address. */
export function linkName(link) {
  if (link?.label) return link.label;
  try { return new URL(link.url).hostname.replace(/^www\./, ''); } catch { return 'Open link'; }
}

/**
 * The action for one task: `{ kind, label, href, mod, group }`.
 *
 *   kind 'link'   — external, opens in a new tab
 *   kind 'module' — in-app route to another module
 *   kind 'form'   — fill here; `mod` (a named form) or `group` (a list) says which
 *   kind 'parent' — fill here, but once per property, from the sheet above
 *   kind 'page'   — the phase page, focused on this task
 *
 * `href` is always set, so a reader without permission to fill still gets
 * somewhere to go.
 */
export function taskActionFor(task, { projectId, templateStage } = {}) {
  if (!task) return null;

  const attached = (task.links || []).find((l) => l?.url);
  if (attached) return { kind: 'link', label: linkName(attached), href: attached.url };

  if (task.appPath) {
    return { kind: 'module', label: task.appPath.startsWith('/hrms') ? 'Open HRMS' : 'Open the module', href: task.appPath };
  }

  const formKey = inferFormKey(task, templateStage);
  const page = task.stageKey === 'p13'
    ? `/purchase/orders?project=${encodeURIComponent(projectId)}`
    : getTaskPath(projectId, task.stageKey, { formKey, code: task.code });

  if (PAGE_ONLY_STAGES.has(task.stageKey) || task.openPhaseOnly) {
    return { kind: 'page', label: 'Open the phase', href: page };
  }

  const mod = (templateStage?.assessmentTypes || []).find((a) => a.key === formKey) || null;
  if (mod) {
    return PER_PARENT_STAGES.has(task.stageKey)
      ? { kind: 'parent', label: `Fill ${mod.name} per property`, href: page, mod }
      : { kind: 'form', label: `Fill ${mod.name}`, href: page, mod };
  }

  if ((templateStage?.masterDataSchema || []).length) {
    const group = (templateStage?.recordGroups || []).find((g) => g.taskKey === task.templateTaskKey) || null;
    return {
      kind: 'form',
      label: `Add ${group?.label || templateStage?.recordNoun || 'an entry'}`,
      href: page,
      group,
    };
  }

  return { kind: 'page', label: 'Open the phase', href: page };
}

export default taskActionFor;
