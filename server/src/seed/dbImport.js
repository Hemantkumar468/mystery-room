/**
 * Load a dump made by dbExport.js into any MongoDB — normally the local one.
 *
 * Needs no `mongorestore`; it uses the driver the app already ships with.
 *
 * SAFE BY DEFAULT: prints what it would write and touches nothing. Pass
 * --apply to write. Existing collections are REPLACED (dropped, then filled),
 * because a half-merged database is worse than either state on its own — so
 * the target is named explicitly on the command line every time, never guessed
 * from .env.
 *
 *   node src/seed/dbImport.js --to "mongodb://127.0.0.1:27017/mysteryrooms_erp"
 *   node src/seed/dbImport.js --to "mongodb://127.0.0.1:27017/mysteryrooms_erp" --apply
 *   … --from ../backup/atlas-dump
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');

const TO = arg('--to');
const FROM = path.resolve(arg('--from') || path.join(process.cwd(), 'backup', 'atlas-dump'));
const BATCH = 500;

const human = (n) => n.toLocaleString('en-IN');

async function main() {
  if (!TO) throw new Error('Pass --to "mongodb://127.0.0.1:27017/<database>"');
  if (!fs.existsSync(FROM)) throw new Error(`No dump at ${FROM} — run dbExport.js first`);

  const meta = JSON.parse(fs.readFileSync(path.join(FROM, '_meta.json'), 'utf8'));
  const indexes = JSON.parse(fs.readFileSync(path.join(FROM, '_indexes.json'), 'utf8'));

  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (nothing written) - pass --apply ==');
  console.log(`From : ${FROM}`);
  console.log(`       ${meta.collections.length} collections, ${human(meta.documents)} documents, taken ${meta.exportedAt}`);
  console.log(`To   : ${TO.replace(/\/\/[^@]+@/, '//***@')}\n`);

  const client = new MongoClient(TO, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db();
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

  let total = 0;
  for (const name of meta.collections) {
    const file = path.join(FROM, `${name}.json`);
    if (!fs.existsSync(file)) { console.log(`  ${name.padEnd(28)} SKIPPED (missing from the dump)`); continue; }
    const docs = EJSON.parse(fs.readFileSync(file, 'utf8'), { relaxed: false });
    const note = existing.has(name) ? 'replaces existing' : 'new';
    console.log(`  ${name.padEnd(28)} ${String(human(docs.length)).padStart(8)} documents   ${indexes[name]?.length || 0} index(es)   ${note}`);
    total += docs.length;
    if (!APPLY) continue;

    if (existing.has(name)) await db.collection(name).drop().catch(() => {});
    const coll = db.collection(name);
    // Batched: one insertMany of 50k documents is how you hit the 16MB
    // command limit and lose the whole collection to a single error.
    for (let i = 0; i < docs.length; i += BATCH) {
      await coll.insertMany(docs.slice(i, i + BATCH), { ordered: false });
    }
    for (const ix of indexes[name] || []) {
      const { key, name: ixName, v, ...opts } = ix;
      await coll.createIndex(key, { name: ixName, ...opts }).catch((e) => {
        console.log(`      ! index ${ixName}: ${e.message}`);
      });
    }
  }

  console.log(`\n${human(total)} documents ${APPLY ? 'restored' : 'would be restored'}.`);
  if (APPLY) {
    console.log('\nPoint the app at it by setting this in server/.env:');
    console.log(`  MONGO_URI=${TO}`);
  } else {
    console.log('\nNothing written. Re-run with --apply.');
  }
  await client.close();
}

main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
