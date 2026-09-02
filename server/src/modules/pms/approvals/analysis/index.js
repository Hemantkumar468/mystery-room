import { scheduleBlock } from './schedule.js';
import { commercialBlock } from './commercial.js';
import { propertyBlock } from './property.js';

/**
 * The analysis registry.
 *
 * Each block declares what it applies to and how to build itself, so adding a
 * fourth is one file and one line here — no branching added to the approval
 * service, and no phase key hardcoded anywhere but inside the block that cares
 * about it.
 *
 * A block contract:
 *   key      stable id, used by the client to pick a renderer
 *   title    the card heading
 *   applies  (task) => boolean — cheap, synchronous, no I/O
 *   build    async (task, ctx) => data | null — null means "nothing to say"
 *
 * `build` returning null is not an error and not an empty card: the block ran,
 * found nothing worth showing, and the client renders nothing at all. That is
 * what keeps a task with no analysis from displaying three empty panels.
 */
const BLOCKS = [scheduleBlock, commercialBlock, propertyBlock];

/**
 * Every block that applies to this task, built.
 *
 * Blocks run in parallel and are independent: one throwing must not cost the
 * approver the other two, so a failure is reported in place as that block's
 * error rather than failing the whole request. An approver seeing "Commercial
 * could not be computed" still has the schedule and the submission in front of
 * them, and can still decide.
 */
export async function buildAnalysis(task, ctx = {}) {
  const applicable = BLOCKS.filter((b) => {
    try {
      return b.applies(task);
    } catch {
      return false;
    }
  });

  const built = await Promise.all(applicable.map(async (b) => {
    try {
      const data = await b.build(task, ctx);
      return data == null ? null : { key: b.key, title: b.title, data };
    } catch (err) {
      return { key: b.key, title: b.title, error: err.message || 'Could not be computed' };
    }
  }));

  return built.filter(Boolean);
}

export default buildAnalysis;
