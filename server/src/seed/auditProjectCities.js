/**
 * Which projects have no city, and what each one should be.
 *
 * The spec that asked for this assumed no entity stored a city and that the
 * column had to be added and backfilled. It does not: `Project.city` already
 * exists and is REQUIRED for every project that is not a draft (see
 * project.model.js, and publishDraft which re-validates it before a draft can
 * leave DRAFT status). So the constraint the spec wanted is already enforced —
 * what is left is finding rows that predate it, or drafts that never picked one.
 *
 * Suggestions come only from a project's own name, and are never applied
 * automatically: "noida" is unambiguous, "p13" is not, and guessing a city onto
 * a project is exactly the kind of quiet wrong answer that survives for months.
 *
 *   node src/seed/auditProjectCities.js                       # report
 *   node src/seed/auditProjectCities.js --set MR-BHO-001=Bhopal --apply
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';

const APPLY = process.argv.includes('--apply');

/** `--set CODE=City`, repeatable. Matched on project code, which is unique. */
const assignments = new Map(
  process.argv
    .filter((a) => a.startsWith('--set'))
    .map((a) => a.replace(/^--set[=\s]*/, ''))
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      return i === -1 ? null : [pair.slice(0, i).trim().toUpperCase(), pair.slice(i + 1).trim()];
    })
    .filter(Boolean),
);

/** Cities we can recognise inside a project name. Extend as the roster grows. */
const KNOWN_CITIES = [
  'Noida', 'Jhansi', 'Ahmedabad', 'Bhopal', 'Pune', 'Indore', 'Delhi',
  'Gurgaon', 'Mumbai', 'Bengaluru', 'Bangalore', 'Hyderabad', 'Chennai',
  'Kolkata', 'Jaipur', 'Lucknow', 'Kanpur', 'Nagpur', 'Surat', 'Patna',
];

function suggestFrom(name = '') {
  const hay = String(name).toLowerCase();
  return KNOWN_CITIES.find((c) => hay.includes(c.toLowerCase())) || null;
}

async function run() {
  await connectDatabase();

  const missing = await Project.find({
    $or: [{ city: { $exists: false } }, { city: null }, { city: '' }],
  }).select('name code city status');

  if (assignments.size) {
    let set = 0;
    for (const [code, city] of assignments) {
      const project = await Project.findOne({ code });
      if (!project) {
        console.log(`✗ ${code} — no such project`);
        continue;
      }
      console.log(`${APPLY ? '✔' : '·'} ${project.code} (${project.name}) → ${city}`);
      if (APPLY) {
        project.city = city;
        await project.save();
      }
      set += 1;
    }
    console.log(
      `\n${set} project(s) ${APPLY ? 'updated.' : 'would change — re-run with --apply to persist.'}`,
    );
    return;
  }

  if (!missing.length) {
    console.log('Every project has a city. Nothing to do.');
    return;
  }

  console.log(`${missing.length} project(s) with no city:\n`);
  const unresolved = [];
  for (const p of missing) {
    const guess = suggestFrom(p.name);
    if (guess) {
      console.log(`  ${p.code}  ${p.name}  → suggested: ${guess}`);
    } else {
      console.log(`  ${p.code}  ${p.name}  → NO SUGGESTION (status: ${p.status})`);
      unresolved.push(p);
    }
  }

  console.log('\nApply the ones you agree with:');
  for (const p of missing) {
    const guess = suggestFrom(p.name);
    if (guess) console.log(`  node src/seed/auditProjectCities.js --set ${p.code}=${guess} --apply`);
  }

  if (unresolved.length) {
    console.log(
      `\n${unresolved.length} project(s) carry no city in their name and must be set by hand`
      + ' (or archived, if they are test data):',
    );
    unresolved.forEach((p) => console.log(`  ${p.code}  ${p.name}`));
  }
}

run()
  .catch((err) => {
    console.error('Audit failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
