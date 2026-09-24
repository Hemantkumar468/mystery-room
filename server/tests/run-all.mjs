/* eslint-disable no-console */
/**
 * Regression suite runner.
 *
 * Executes every tests/regression/*.test.mjs in order, each in its own
 * process (so one suite's connection or a hard failure can't affect the
 * next), and exits non-zero if any suite fails.
 *
 *   npm run test:regression                 # all suites
 *   npm run test:regression -- 07 09        # only suites matching those prefixes
 *
 * These suites talk to the database named by MONGO_URI and create/tear down
 * their own fixtures. They are safe to run against a working database, but
 * point them at a staging copy if you would rather not touch production.
 */
import { readdirSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'regression');
const filters = process.argv.slice(2);

const suites = readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort();

if (!suites.length) {
  console.error(`No suites matched ${JSON.stringify(filters)}`);
  process.exit(1);
}

const run = (file) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
  child.on('close', (code) => resolve(code ?? 1));
});

const results = [];
for (const file of suites) {
  console.log(`\n${'━'.repeat(64)}\n▶ ${file}\n${'━'.repeat(64)}`);
  // eslint-disable-next-line no-await-in-loop
  const code = await run(file);
  results.push({ file, code });
}

console.log(`\n${'═'.repeat(64)}\nREGRESSION SUMMARY\n${'═'.repeat(64)}`);
for (const r of results) console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.file}`);
const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} suites passed.`);
process.exit(failed.length ? 1 : 0);
