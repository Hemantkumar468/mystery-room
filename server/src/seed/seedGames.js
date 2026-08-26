/**
 * Load the game catalogue (gamesMaster.js, from the client's spreadsheet) into
 * the database.
 *
 * Re-runnable and non-destructive: games are matched by `code`, so a second run
 * refreshes areas and drawing links without duplicating anything, and anything
 * added on the Games page that is not in the sheet is left alone.
 *
 * SAFE BY DEFAULT: dry run, prints the plan, writes nothing.
 *
 *   node src/seed/seedGames.js            # show the plan
 *   node src/seed/seedGames.js --apply    # load / refresh
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { Game } from '../modules/pms/games/game.model.js';
import { GAMES_MASTER } from './gamesMaster.js';

const APPLY = process.argv.includes('--apply');
const area = (g) => (g.minAreaSqft === g.maxAreaSqft ? `${g.maxAreaSqft}` : `${g.minAreaSqft}-${g.maxAreaSqft}`);

async function main() {
  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) - pass --apply to persist ==');
  console.log(`${GAMES_MASTER.length} games in the sheet\n`);

  let created = 0;
  let updated = 0;
  for (const g of GAMES_MASTER) {
    const existing = await Game.findOne({ code: g.code });
    const tag = existing ? '~ refresh' : '+ new    ';
    console.log(`  ${tag} ${g.code.padEnd(18)} ${g.name.padEnd(18)} ${area(g).padStart(9)} sq ft   ${g.layouts.length} layout(s)${g.extraDrawings?.length ? `, ${g.extraDrawings.length} extra drawing(s)` : ''}`);
    if (existing) updated += 1; else created += 1;
    if (!APPLY) continue;
    await Game.findOneAndUpdate(
      { code: g.code },
      // `active` is deliberately not forced back to true: a game retired on
      // the Games page stays retired even when the sheet is re-seeded.
      { $set: { ...g }, $setOnInsert: { active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const total = await Game.countDocuments();
  console.log(`\n${created} new, ${updated} refreshed.${APPLY ? ` Catalogue now holds ${total} games.` : ''}`);
  console.log(APPLY ? 'Phase 3B and Phase 10 pick from this list.' : '\nNothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
