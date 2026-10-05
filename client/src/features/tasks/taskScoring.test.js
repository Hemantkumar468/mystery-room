import { describe, expect, it } from 'vitest';
import dayjs from '../../lib/dayjs.js';
import { calculateTaskScore } from './taskScoring.js';

describe('calculateTaskScore', () => {
  it('deducts by progress, completion timing, and overdue status', () => {
    const now = dayjs('2026-10-05T12:00:00');
    const result = calculateTaskScore([
      { state: 'completed', plannedEnd: '2026-10-05', actualEnd: '2026-10-05T17:00:00' },
      { state: 'completed', plannedEnd: '2026-10-04', completedAt: '2026-10-05T09:00:00' },
      { state: 'progress', plannedEnd: '2026-10-06' },
      { state: 'pending', plannedEnd: '2026-10-06' },
      { state: 'pending', plannedEnd: '2026-10-04' },
      { state: 'waiting', plannedEnd: '2026-10-04' },
      { state: 'completed' },
    ], now);

    expect(result).toMatchObject({
      total: 7,
      doneOnTime: 1,
      doneLate: 1,
      inProgress: 1,
      notStarted: 1,
      overdue: 1,
      neutral: 2,
      score: -23,
    });
  });

  it('returns zero for only on-time tasks and -100 for all-overdue tasks', () => {
    const now = dayjs('2026-10-05T12:00:00');
    expect(calculateTaskScore([
      { state: 'completed', plannedEnd: '2026-10-05', actualEnd: '2026-10-05T17:00:00' },
    ], now).score).toBe(0);
    expect(calculateTaskScore([
      { state: 'pending', plannedEnd: '2026-10-04' },
    ], now).score).toBe(-100);
  });

  it('has no score for an empty task list', () => {
    expect(calculateTaskScore([]).score).toBeNull();
  });
});