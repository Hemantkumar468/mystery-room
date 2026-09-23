/* eslint-disable no-console */
/**
 * Put the company's own roles onto the accounts that hold them.
 *
 * THE SHEET IS THE AUTHORITY. SHEET/USERROLE.xlsx names 26 seats across 20
 * distinct roles, each against the email of the person who holds it. That
 * pairing is the fact this migration copies into the database; nothing here
 * invents a seat, and nothing here guesses who fills one.
 *
 * WHAT WENT WRONG BEFORE, and what this fixes. The roles were migrated as a
 * free-text `title` on each account. Three consequences, all of them visible
 * on screen:
 *
 *   1. Every screen that asks "what is this person" reads `role` — the
 *      five-value SECURITY tier — so the Employees page and Access Control
 *      showed "Manager" where the company says "IT Head".
 *   2. `seedOrgRoles` created a placeholder account per seat
 *      (civil.head@mysteryrooms.in) at the same time as the real person from
 *      the sheet was created (ramsingh989929@gmail.com), so eleven seats have
 *      two accounts and the directory reads double.
 *   3. A title is prose. "Managing Director (MD)" and "Managing Director
 *      (MD) / Admin" are the same seat and no code could know it.
 *
 * WHAT IT DOES
 *
 *   · Reads the workbook and CHECKS IT against core/constants/jobRoles.js,
 *     refusing to run if the two have drifted. A migration that silently
 *     applies a stale copy of the source data is worse than one that stops.
 *   · Assigns `jobRoles` by EMAIL, exactly as the sheet pairs them. A person
 *     named on three rows gets three seats.
 *   · Adopts an account the sheet does not name only when its title is
 *     EXACTLY a seat's title — which in this directory means the stand-in
 *     accounts seedOrgRoles created. A near miss is left for a human.
 *   · DEACTIVATES a seeded placeholder once the real holder from the sheet is
 *     in place. Deactivated, never deleted: whatever was already assigned to
 *     it keeps its owner, and the account can be switched back on.
 *   · Leaves everybody else alone, with no seat. The pre-sheet demo and QA
 *     accounts keep working on their system role; the Employees page flags
 *     them so somebody can assign one deliberately.
 *
 * WHAT IT WILL NOT DO. It never changes `role`, the security tier. Handing
 * somebody the MD's tier is a decision, not a data migration — the report
 * names every account whose tier disagrees with its seat and leaves them for
 * a human.
 *
 *   npm run migrate:jobroles              # report only, changes nothing
 *   npm run migrate:jobroles -- --apply   # write it
 */
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { readXlsx } from './lib/readXlsx.mjs';
import { JOB_ROLES, jobRoleFromTitle, systemRoleFor } from '../core/constants/jobRoles.js';
/* Only for the list of addresses it seeds a stand-in account at. Importing
   it neither connects nor seeds — see the guard at the bottom of that file. */
import { ORG_ROLES } from './seedOrgRoles.js';

dotenv.config();
/* Atlas is reached over an SRV record and some networks refuse the
   `_mongodb._tcp` lookup — the same workaround config/database.js applies. */
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHEET = path.resolve(HERE, '../../SHEET/USERROLE.xlsx');

const lower = (s) => String(s ?? '').trim().toLowerCase();

/** The sheet, as {no, title, email} — the numbered rows and nothing else. */
function readSheet() {
  const { grid } = readXlsx(SHEET);
  return grid
    .map((r) => r.slice(0, 4).map((c) => String(c ?? '').trim()))
    .filter((c) => /^\d+$/.test(c[0]))
    .map((c) => ({ no: Number(c[0]), title: c[1], email: lower(c[2]) }));
}

/**
 * Refuse to run against a registry that no longer matches the workbook.
 *
 * The registry is what the rest of the application reads — the enum on the
 * user, the columns on the Access Control screen. If somebody adds a row to
 * the sheet and runs this, the honest outcome is a message naming the row,
 * not a migration that quietly skips it.
 */
function checkRegistry(rows) {
  const problems = [];
  const bySheetTitle = new Map();
  for (const r of rows) {
    if (!bySheetTitle.has(r.title)) bySheetTitle.set(r.title, []);
    bySheetTitle.get(r.title).push(r.email);
  }

  for (const [title, emails] of bySheetTitle) {
    const reg = JOB_ROLES.find((j) => j.title === title);
    if (!reg) { problems.push(`Sheet row "${title}" has no entry in core/constants/jobRoles.js`); continue; }
    const regEmails = reg.sheetEmails.map(lower);
    if (JSON.stringify(regEmails) !== JSON.stringify(emails)) {
      problems.push(`"${title}": sheet says ${emails.join(', ')} — registry says ${regEmails.join(', ')}`);
    }
    if (reg.seats !== emails.length) {
      problems.push(`"${title}": sheet has ${emails.length} seat(s), registry says ${reg.seats}`);
    }
  }
  for (const j of JOB_ROLES) {
    if (!bySheetTitle.has(j.title)) problems.push(`Registry role "${j.title}" is no longer in the sheet`);
  }
  return problems;
}

async function run() {
  const rows = readSheet();
  const drift = checkRegistry(rows);
  if (drift.length) {
    console.error('\nThe sheet and core/constants/jobRoles.js disagree. Fix the registry, then re-run.\n');
    for (const d of drift) console.error(`  · ${d}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Sheet read: ${rows.length} seats across ${JOB_ROLES.length} roles — registry matches.\n`);

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const users = mongoose.connection.collection('users');
  const all = await users.find({}, {
    projection: {
      name: 1, email: 1, role: 1, title: 1, jobRoles: 1, isActive: 1,
    },
  }).toArray();
  const byEmail = new Map(all.map((u) => [lower(u.email), u]));

  /** email -> the seats the sheet gives that person, in sheet order. */
  const seatsByEmail = new Map();
  for (const r of rows) {
    const reg = JOB_ROLES.find((j) => j.title === r.title);
    if (!seatsByEmail.has(r.email)) seatsByEmail.set(r.email, []);
    const list = seatsByEmail.get(r.email);
    if (!list.includes(reg.key)) list.push(reg.key);
  }

  const assigned = [];   // accounts named by the sheet
  const adopted = [];    // not in the sheet, but the title is unmistakably a seat
  const missing = [];    // the sheet names somebody with no account
  const untouched = [];  // no seat — left alone, flagged on the Employees page
  const tierNotes = [];  // seat and security tier disagree; a human decides

  for (const [email, keys] of seatsByEmail) {
    const user = byEmail.get(email);
    if (!user) { missing.push({ email, keys }); continue; }
    assigned.push({ user, keys, source: 'sheet' });
  }

  /*
   * EXACT TITLES ONLY, deliberately.
   *
   * Each seat also declares the aliases it is known by, and matching on them
   * here would sweep up "MD", "Manager User" and "Projects Head" — demo
   * accounts that predate the sheet and are not the people the company means.
   * An alias is close enough to avoid creating a DUPLICATE account (what
   * seedOrgRoles uses it for); it is not close enough to hand somebody a seat
   * and the access that comes with it. Anything short of an exact match is
   * left for a person to assign on the Employees screen.
   */
  for (const user of all) {
    if (seatsByEmail.has(lower(user.email))) continue;
    const seat = jobRoleFromTitle(user.title, { aliases: false });
    if (seat) adopted.push({ user, keys: [seat.key], source: 'title' });
    else untouched.push(user);
  }

  /**
   * The placeholders, named exactly rather than guessed at.
   *
   * seedOrgRoles.js declares the address it creates each seat's stand-in
   * account at, so "is this a placeholder" is a lookup in that list, not a
   * pattern match on an email. A heuristic here would eventually deactivate
   * somebody real who happened to be reachable at a role-shaped address, and
   * that failure looks like a person losing their login for no reason.
   *
   * It is only a placeholder if the seat is ALSO held by somebody the sheet
   * names. A seeded account standing in for a seat no real person holds yet
   * is the only account for that seat, and switching it off would leave the
   * seat's work with nowhere to go.
   */
  const heldBySheet = new Set(assigned.flatMap((a) => a.keys));
  const seededEmails = new Set(ORG_ROLES.map((r) => lower(r.email)));
  const placeholders = adopted.filter(({ user, keys }) => seededEmails.has(lower(user.email))
    && keys.every((k) => heldBySheet.has(k)));

  for (const { user, keys } of [...assigned, ...adopted]) {
    const should = systemRoleFor(keys);
    if (should && should !== user.role) {
      tierNotes.push(`${user.name} <${user.email}> is ${user.role}, but ${keys.join(' + ')} implies ${should}`);
    }
  }

  /* ── report ───────────────────────────────────────────────────────── */
  console.log(`NAMED BY THE SHEET — ${assigned.length} account(s)`);
  for (const { user, keys } of assigned) {
    console.log(`  ${user.name.padEnd(22)} ${user.email.padEnd(34)} ${keys.join(' + ')}`);
  }

  console.log(`\nADOPTED BY TITLE — ${adopted.length} account(s) the sheet does not name`);
  for (const { user, keys } of adopted) {
    const ph = placeholders.some((p) => String(p.user._id) === String(user._id));
    console.log(`  ${user.name.padEnd(22)} ${user.email.padEnd(34)} ${keys.join(' + ')}${ph ? '   → placeholder, will be deactivated' : ''}`);
  }

  if (missing.length) {
    console.log(`\nIN THE SHEET, NO ACCOUNT — ${missing.length}`);
    for (const m of missing) console.log(`  ${m.email.padEnd(34)} ${m.keys.join(' + ')}`);
  }

  console.log(`\nNO SEAT IN THE SHEET — ${untouched.length} account(s), left as they are`);
  for (const u of untouched) console.log(`  ${(u.name ?? '?').padEnd(22)} ${u.email.padEnd(34)} ${u.title ?? '(no title)'}`);

  if (tierNotes.length) {
    console.log('\nSEAT AND SECURITY TIER DISAGREE — not changed, decide these by hand:');
    for (const n of tierNotes) console.log(`  · ${n}`);
  }

  if (!APPLY) {
    console.log('\nReport only. Re-run with --apply to write it.');
    await mongoose.disconnect();
    return;
  }

  /* ── apply ────────────────────────────────────────────────────────── */
  let written = 0;
  for (const { user, keys } of [...assigned, ...adopted]) {
    const primary = JOB_ROLES.find((j) => j.key === keys[0]);
    const res = await users.updateOne({ _id: user._id }, {
      $set: {
        jobRoles: keys,
        /* The sheet's exact wording, so the printed designation and the seat
           can no longer disagree about what somebody is called. */
        title: primary?.title ?? user.title,
      },
    });
    written += res.modifiedCount;
  }

  let switchedOff = 0;
  for (const { user } of placeholders) {
    const res = await users.updateOne({ _id: user._id }, { $set: { isActive: false } });
    switchedOff += res.modifiedCount;
  }

  console.log(`\nApplied: ${written} account(s) given their seats, ${switchedOff} placeholder(s) deactivated.`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
