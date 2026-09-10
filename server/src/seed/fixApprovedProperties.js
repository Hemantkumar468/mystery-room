/**
 * Repair Phase 1 properties that were "approved" — a status that phase has no
 * such thing as.
 *
 * WHAT WENT WRONG. The Approvals queue listed every submitted record from
 * every phase and gave each one a plain Approve button. Pressed on a property,
 * it set `status: 'approved'`. Phase 1 does not approve properties — it
 * shortlists or rejects them, and the winner is marked by a SECOND shortlist
 * after Site Evaluation.
 *
 * WHY IT MATTERS MORE THAN A LABEL. `isPropertyApprovedAtP2` requires
 * `status === 'shortlisted'`. An approved property therefore can never be
 * resolved as the chosen one: Site Evaluation cannot select it, Commercial
 * Finalization cannot find it, and the project simply stops being able to
 * progress — with no error, on any screen, saying why.
 *
 * WHAT THIS DOES. Turns those records into exactly what the person pressing
 * the button meant: shortlisted. The approval stamp moves to the shortlist
 * stamp, so who decided and when survives untouched; only the word changes.
 * Nothing is invented — a record with no approval stamp keeps its `decidedBy`.
 *
 * Rejected properties are not touched: reject means the same thing on every
 * phase, and it was never ambiguous.
 *
 * NEITHER ARE FRANCHISE PROJECTS, by default. That flow files the applicant's
 * own property as approved ON PURPOSE (franchise.service.js) — there is only
 * ever one property, the MD's decision on the enquiry IS the decision on it,
 * and the project starts at Phase 3 having skipped Site Evaluation entirely.
 * Whether that should also be `shortlisted` is a real question, but it is a
 * question for whoever owns that flow, not something to rewrite underneath
 * them. Pass --include-franchise to fold them in once that is agreed.
 *
 *   node src/seed/fixApprovedProperties.js
 *   node src/seed/fixApprovedProperties.js --apply
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');
const INCLUDE_FRANCHISE = process.argv.includes('--include-franchise');

/* eslint-disable no-console */
async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });

  const { withoutTenant } = await import('../core/tenancy/tenantContext.js');
  const { Record } = await import('../modules/pms/records/record.model.js');
  const { Project } = await import('../modules/pms/projects/project.model.js');

  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  await withoutTenant('repairing a wrong status wherever it happened', async () => {
    const found = await Record.find({ stageKey: 'p1', status: 'approved' }).lean();
    if (!found.length) {
      console.log('\nNothing to repair — no Phase 1 property is in the approved status.');
      return;
    }

    const projects = await Project.find({ _id: { $in: found.map((r) => r.project) } })
      .select('code name kind').lean();
    const nameOf = new Map(projects.map((p) => [String(p._id), `${p.code} ${p.name}`]));
    const isFranchise = new Set(projects.filter((p) => p.kind === 'franchise').map((p) => String(p._id)));

    const skipped = INCLUDE_FRANCHISE ? [] : found.filter((r) => isFranchise.has(String(r.project)));
    const broken = INCLUDE_FRANCHISE ? found : found.filter((r) => !isFranchise.has(String(r.project)));

    if (skipped.length) {
      console.log(`\n${skipped.length} franchise property record(s) left exactly as they are — that flow files them approved on purpose:`);
      for (const r of skipped) console.log(`  ${nameOf.get(String(r.project))} · "${r.title}"`);
    }
    if (!broken.length) {
      console.log('\nNothing else to repair.');
      return;
    }

    console.log(`\n${broken.length} property record(s) stuck in "approved":\n`);
    for (const r of broken) {
      console.log(`  ${nameOf.get(String(r.project)) || r.project}`);
      console.log(`      "${r.title || r.values?.property_name || 'untitled'}" → shortlisted`);
      console.log(`      decided ${r.decidedAt ? new Date(r.decidedAt).toISOString().slice(0, 10) : 'unknown'}, kept as-is`);
    }

    if (!APPLY) {
      console.log('\nNothing written. Re-run with --apply.');
      return;
    }

    let done = 0;
    for (const r of broken) {
      // The approval stamp becomes the shortlist stamp — same person, same
      // moment, the word corrected. `decidedBy`/`decidedAt` are untouched:
      // they are what every downstream gate reads.
      // eslint-disable-next-line no-await-in-loop -- a handful of rows, and
      // one at a time keeps the log honest about which succeeded.
      await Record.updateOne(
        { _id: r._id },
        {
          $set: {
            status: 'shortlisted',
            shortlistedBy: r.approvedBy || r.decidedBy,
            shortlistedAt: r.approvedAt || r.decidedAt,
          },
          $unset: { approvedBy: '', approvedAt: '' },
        },
      );
      done += 1;
    }
    console.log(`\nRepaired ${done} record(s). They are shortlisted properties again and can be selected at Site Evaluation.`);
  });
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
