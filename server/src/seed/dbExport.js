/**
 * Copy an entire MongoDB database out to local files.
 *
 * Written against the driver that ships with the app rather than `mongodump`,
 * so it needs nothing installed — which is the whole point: it runs on a
 * machine that has no MongoDB server or command-line tools at all.
 *
 * Documents are written as CANONICAL Extended JSON, so an ObjectId stays an
 * ObjectId and a Date stays a Date on the way back in. Plain `JSON.stringify`
 * would turn every _id into a string and quietly break every reference in the
 * database — the failure you would only discover weeks later.
 *
 * Indexes are exported alongside the data (`_indexes.json`) because a restore
 * without them is a database that works and then gets slow, and loses its
 * unique constraints (project code, user email) in the meantime.
 *
 *   node src/seed/dbExport.js                       # from MONGO_URI in .env
 *   node src/seed/dbExport.js --uri "mongodb://..." # from somewhere else
 *   node src/seed/dbExport.js --out ../backup/mydump
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import { config } from '../config/index.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };

const URI = arg('--uri') || config.db.uri;
const OUT = path.resolve(arg('--out') || path.join(process.cwd(), 'backup', 'atlas-dump'));

const human = (n) => n.toLocaleString('en-IN');

async function main() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db();
  console.log(`\nSource : ${URI.replace(/\/\/[^@]+@/, '//***@')}`);
  console.log(`Database: ${db.databaseName}`);
  console.log(`Writing : ${OUT}\n`);

  fs.mkdirSync(OUT, { recursive: true });
  const collections = (await db.listCollections().toArray())
    .filter((c) => c.type !== 'view' && !c.name.startsWith('system.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const indexes = {};
  let grandTotal = 0;

  for (const { name } of collections) {
    const coll = db.collection(name);
    const docs = await coll.find({}).toArray();
    fs.writeFileSync(path.join(OUT, `${name}.json`), EJSON.stringify(docs, { relaxed: false }));
    // `_id` is recreated automatically; keeping it would make the restore fail.
    indexes[name] = (await coll.indexes()).filter((ix) => ix.name !== '_id_');
    grandTotal += docs.length;
    console.log(`  ${name.padEnd(28)} ${String(human(docs.length)).padStart(8)} documents   ${indexes[name].length} index(es)`);
  }

  fs.writeFileSync(path.join(OUT, '_indexes.json'), JSON.stringify(indexes, null, 2));
  fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify({
    database: db.databaseName,
    exportedAt: new Date().toISOString(),
    collections: collections.map((c) => c.name),
    documents: grandTotal,
  }, null, 2));

  console.log(`\n${collections.length} collections, ${human(grandTotal)} documents written.`);
  console.log(`Restore with:  node src/seed/dbImport.js --to "mongodb://127.0.0.1:27017/${db.databaseName}" --apply`);
  await client.close();
}

main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
