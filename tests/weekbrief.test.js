import { describe, expect, it } from 'vitest';

import { weekBrief } from '../lib/data/weekbrief.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

describe('the weekly brief', () => {
  it('splits the change in margin exactly into sales, food and labour', () => {
    const b = weekBrief([
      { net: 40000, food: 12000, labour: 10000, earned: 18000, covers: 1300 },
      { net: 41000, food: 12500, labour: 9000, earned: 19500, covers: 1350 },
    ]);
    expect(b.vsLast.earned).toBe(1500);
    expect(b.parts.reduce((s, p) => s + p.amount, 0)).toBe(1500);
    expect(b.driver.key).toBe('sales'); // ties go to the first part
    expect(b.parts.find((p) => p.key === 'food').amount).toBe(-500);
  });

  it('says nothing with under two weeks', () => {
    expect(weekBrief([{ net: 1, food: 0, labour: 0, earned: 1, covers: 1 }])).toBeNull();
    expect(weekBrief([])).toBeNull();
  });

  it('on the sample, every part ties back to the history rows', () => {
    const d = deriveRoom(SEED, 'oakland');
    const b = weekBrief(d.room.history);
    const [prev, cur] = d.room.history.slice(-2);
    expect(b.vsLast.earned).toBeCloseTo(cur.earned - prev.earned, 6);
    expect(b.parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(cur.earned - prev.earned, 6);
    expect(b.trend).toHaveLength(8);
  });
});
