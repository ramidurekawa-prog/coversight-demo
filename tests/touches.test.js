import { describe, expect, test } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { deriveRoom } from '../lib/data/model.js';
import { proofPlain, roomReason, scheduleFit, serviceChecks } from '../lib/data/touches.js';

/* The quiet additions read the derived room and say nothing when there's nothing to say. */
describe('touches', () => {
  const rooms = Object.keys(SEED.rooms).map((id) => deriveRoom(SEED, id));

  test('every room gets a potential reason from its own biggest candidate', () => {
    for (const d of rooms) {
      const r = roomReason(d);
      const best = d.candidates.filter((c) => !c.prevent && c.value > 0.5).sort((a, b) => b.value - a.value)[0];
      if (!best) expect(r).toBeNull();
      else expect(r.text).toMatch(/^Potential: .*\/wk$/);
    }
  });

  test('service checks count only what is green', () => {
    for (const d of rooms) {
      const c = serviceChecks(d);
      expect(c.total).toBe(c.list.length);
      expect(c.good).toBe(c.list.filter((x) => x.ok).length);
    }
    expect(serviceChecks(rooms[0]).list.find((x) => x.k === 'kept').ok).toBe(rooms[0].hist.marginMove >= 0);
  });

  test('schedule grade matches the idle and short hours', () => {
    expect(scheduleFit({ sched: [4, 4], need: [4, 4] })).toMatchObject({ grade: 'A', off: 0 });
    expect(scheduleFit({ sched: [6, 2], need: [4, 4] })).toMatchObject({ grade: 'D', off: 4 });
    expect(scheduleFit({ sched: [], need: [] })).toBeNull();
  });

  test('"how we know" only explains verified results, with the counted amount', () => {
    const oak = rooms.find((d) => d.id === 'oakland');
    const v = oak.proofs.find((p) => p.outcome === 'verified');
    expect(proofPlain(v)).toContain(`$${v.bookable} of the $${v.point}`);
    expect(proofPlain(oak.proofs.find((p) => p.outcome === 'testing'))).toBeNull();
  });
});
