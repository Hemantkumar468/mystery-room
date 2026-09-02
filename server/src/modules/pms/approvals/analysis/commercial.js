import { Project } from '../../projects/project.model.js';

/**
 * What is this going to cost, and is it within what was budgeted?
 *
 * Applies to the money phases: p13 (BOQ) and p15 (procurement / purchase
 * orders). Both file line items as Records, so the numbers come from the
 * submission itself rather than from a separate ledger.
 *
 * The comparison an approver actually needs is against `project.budget.planned`
 * — not against the previous submission, and not against nothing. A total with
 * no denominator ("₹ 8,40,000") tells you the size of the number and nothing
 * about whether to sign it.
 */

const MONEY_STAGES = new Set(['p13', 'p15']);

/** Lines above this share of the submission total are called out individually. */
const LARGE_LINE_SHARE = 0.25;

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** The line's value: an explicit amount if the form captured one, else qty × rate. */
function lineValue(values = {}) {
  const amount = num(values.amount ?? values.value ?? values.po_value);
  if (amount) return amount;
  const qty = num(values.quantity);
  const rate = num(values.rate);
  return qty * rate;
}

export const commercialBlock = {
  key: 'commercial',
  title: 'Commercial',

  applies: (task) => MONEY_STAGES.has(task.stageKey),

  async build(task, { records = [] } = {}) {
    /* Nothing filed means nothing to analyse — better to render no card than a
       card full of zeroes, which reads as "this costs nothing". */
    if (!records.length) return null;

    const lines = records.map((r) => ({
      id: String(r._id),
      label: r.title || r.values?.item || r.values?.vendor_name || 'Line',
      value: lineValue(r.values),
    }));

    const total = lines.reduce((sum, l) => sum + l.value, 0);

    const project = await Project.findById(task.project).select('budget').lean();
    const planned = project?.budget?.planned || 0;

    /* Variance is only meaningful against a budget that was actually set. A
       project left at the default 0 would otherwise report "+100% over
       budget" on its first BOQ, which is noise, not a finding. */
    const hasBudget = planned > 0;
    const varianceAmount = hasBudget ? total - planned : null;
    const variancePercent = hasBudget ? Math.round(((total - planned) / planned) * 100) : null;

    const largeLines = total > 0
      ? lines.filter((l) => l.value / total >= LARGE_LINE_SHARE)
        .sort((a, b) => b.value - a.value)
      : [];

    return {
      lineCount: lines.length,
      total,
      currency: project?.budget?.currency || 'INR',
      budgetPlanned: hasBudget ? planned : null,
      varianceAmount,
      variancePercent,
      overBudget: hasBudget ? total > planned : null,
      // Each of these is a quarter or more of the submission on its own —
      // where a mis-keyed rate shows up.
      largeLines,
      largeLineThresholdPercent: LARGE_LINE_SHARE * 100,
    };
  },
};

export default commercialBlock;
