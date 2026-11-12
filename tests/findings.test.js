import { describe, expect, it } from 'vitest';

import { findingBlocked, findingStatus, findingTest } from '../lib/data/findings.js';
import { LEVER_METRIC } from '../lib/data/readers.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

const d = deriveRoom(SEED, 'oakland');
const byId = Object.fromEntries(d.candidates.map((c) => [c.id, c]));

describe('which test measures a finding', () => {
  it('maps every testable finding to a real lever metric', () => {
    for (const c of d.candidates) {
      const t = findingTest(c);
      if (t) expect(LEVER_METRIC[t.lever], c.id).toBeTruthy();
    }
    expect(findingTest(byId.ribeye)).toEqual({ lever: 'menu_margin', dish: 'ribeye' });
    expect(findingTest(byId.voids)).toEqual({ lever: 'void_comp' });
    expect(findingTest(byId.satpeak)).toEqual({ lever: 'labour' });
  });

  it('never tests a prevented cost, and says so for levers with no metric yet', () => {
    expect(findingTest(byId.ot)).toBeNull();
    expect(findingTest(byId.vendor)).toBeNull();
    expect(findingStatus(byId.vendor, [], 'oakland').state).toBe('untestable');
  });
});

describe('where a finding stands', () => {
  const w = (o) => ({ roomId: 'oakland', lever: 'menu_margin', dish: 'ribeye', status: 'running', startedAt: '2026-10-01', ...o });
  it('follows the newest window for the same dish and room', () => {
    expect(findingStatus(byId.ribeye, [], 'oakland').state).toBe('none');
    expect(findingStatus(byId.ribeye, [w({ dish: 'salmon' })], 'oakland').state).toBe('none');
    expect(findingStatus(byId.ribeye, [w({ roomId: 'berkeley' })], 'oakland').state).toBe('none');
    expect(findingStatus(byId.ribeye, [w({ status: 'verified', startedAt: '2026-08-01' }), w({})], 'oakland').state).toBe('testing');
    expect(findingStatus(byId.ribeye, [w({ status: 'reversed' })], 'oakland').state).toBe('reversed');
    expect(findingStatus(byId.ribeye, [w({ status: 'rejected' })], 'oakland').state).toBe('ended');
  });
});

describe('a finding resting on a missing input', () => {
  it('is blocked, with the reason', () => {
    expect(findingBlocked(byId.salmon, d.room)).toMatch(/recipe costs/);
    expect(findingBlocked(byId.ribeye, d.room)).toBeNull();
    const room = { menu: [{ key: 'ribeye', costEstimated: true }] };
    expect(findingBlocked(byId.ribeye, room)).toMatch(/estimated/);
  });
});
