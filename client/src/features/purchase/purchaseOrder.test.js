import { describe, expect, it } from 'vitest';
import { byNewestFirst, recencyOf } from './purchasePipeline.js';

/**
 * Every purchase list reads newest first.
 *
 * The rows used to arrive sorted by centre name, which is a filter on these
 * pages and not a reading order: it put the alphabet at the top of the sheet
 * and today's work wherever its centre happened to fall. These pin the two
 * halves of the replacement — what counts as "latest" for a row, and that the
 * comparator really does put it first.
 */

/** A row shaped the way usePurchaseOrders builds one. */
const row = (id, { lastAt, updatedAt, createdAt, seq } = {}) => ({
  r: { _id: id, seq, updatedAt, createdAt },
  f: { lastAt },
  project: { id: 'p1', name: 'A centre' },
});

const order = (rows) => [...rows].sort(byNewestFirst).map(({ r }) => r._id);

describe('recencyOf', () => {
  it('reads the last change first — an old order received today is today\'s row', () => {
    const received = row('a', { lastAt: '2026-09-08T10:00:00Z', createdAt: '2025-01-01T00:00:00Z' });
    const typed = row('b', { createdAt: '2026-01-01T00:00:00Z' });
    expect(recencyOf(received)).toBeGreaterThan(recencyOf(typed));
  });

  it('falls back to updatedAt, then createdAt, for a line nothing has happened to', () => {
    expect(recencyOf(row('a', { updatedAt: '2026-05-05T00:00:00Z' })))
      .toBe(Date.parse('2026-05-05T00:00:00Z'));
    expect(recencyOf(row('a', { createdAt: '2026-05-05T00:00:00Z' })))
      .toBe(Date.parse('2026-05-05T00:00:00Z'));
  });

  /* Real BOQ rows carry junk in date-shaped fields — see orderTracking's
     sentAtOf for the same problem. An unparseable stamp must sort as "no date"
     rather than as NaN, which poisons every comparison it takes part in. */
  it('treats a missing or unparseable date as no date at all, never NaN', () => {
    expect(recencyOf(row('a'))).toBe(0);
    expect(recencyOf(row('a', { lastAt: '+91 ' }))).toBe(0);
    expect(recencyOf(undefined)).toBe(0);
  });
});

describe('byNewestFirst', () => {
  it('puts the latest at the top and the oldest at the bottom', () => {
    expect(order([
      row('old', { lastAt: '2024-03-01T00:00:00Z' }),
      row('newest', { lastAt: '2026-09-09T00:00:00Z' }),
      row('middle', { lastAt: '2025-07-04T00:00:00Z' }),
    ])).toEqual(['newest', 'middle', 'old']);
  });

  it('breaks a tie on the line number, so a seeded BOQ still reads newest first', () => {
    // One write stamps every row it creates with the same instant; without the
    // tiebreak those rows come out in whatever order the array happened to be.
    const same = '2026-09-09T12:00:00Z';
    expect(order([
      row('line-1', { lastAt: same, seq: 1 }),
      row('line-3', { lastAt: same, seq: 3 }),
      row('line-2', { lastAt: same, seq: 2 }),
    ])).toEqual(['line-3', 'line-2', 'line-1']);
  });

  it('leaves undated rows at the bottom rather than at the top', () => {
    expect(order([
      row('undated'),
      row('dated', { lastAt: '2020-01-01T00:00:00Z' }),
    ])).toEqual(['dated', 'undated']);
  });
});
