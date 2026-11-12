// What a finding can do next, honestly: which test measures it (if any), where
// it stands against the room's test windows, and whether it may be acted on
// at all. Pure; screens and tests share it.

/**
 * The test that would measure this finding, or null when no metric for it is
 * read from the data yet (it can still be acted on, but not verified).
 * @param {{ kind: string, item?: string, id: string, lever: string, prevent?: boolean }} c
 * @returns {{ lever: string, dish?: string } | null}
 */
export function findingTest(c) {
  if (c.prevent) return null; // a prevented cost is never booked, so never tested
  if (c.kind === 'price' && c.item) return { lever: 'menu_margin', dish: c.item };
  if (c.kind === 'voids' || c.kind === 'comps') return { lever: 'void_comp' };
  if (c.lever === 'Labour') return { lever: c.id === 'ot' ? 'overtime' : 'labour' };
  if (c.lever === 'Throughput') return { lever: 'turns' };
  return null;
}

const OPEN = new Set(['running', 'waiting']);

/**
 * Where this finding stands against the room's windows. The newest matching
 * window wins (a dish test only matches the same dish).
 * @param {{ kind: string, item?: string, id: string, lever: string, prevent?: boolean }} c
 * @param {{ roomId: string, lever: string, dish?: string | null, status: string, startedAt?: string }[]} windows
 * @param {string} roomId
 * @returns {{ state: 'untestable' | 'none' | 'testing' | 'verified' | 'reversed' | 'ended', window?: object }}
 */
export function findingStatus(c, windows, roomId) {
  const t = findingTest(c);
  if (!t) return { state: 'untestable' };
  const mine = (windows || [])
    .filter((w) => w.roomId === roomId && w.lever === t.lever && (!t.dish || w.dish === t.dish))
    .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
  const w = mine[0];
  if (!w) return { state: 'none' };
  if (OPEN.has(w.status)) return { state: 'testing', window: w };
  if (w.status === 'verified') return { state: 'verified', window: w };
  if (w.status === 'reversed') return { state: 'reversed', window: w };
  return { state: 'ended', window: w };
}

/**
 * A finding whose value rests on an input the room hasn't given (a recipe cost
 * we only estimated) is shown, but not acted on: we don't fill a missing input
 * with an assumption and then recommend on it.
 * @param {{ kind: string, item?: string, needs?: string }} c
 * @param {{ menu?: { key: string, costEstimated?: boolean }[] }} room
 * @returns {string | null} why it's blocked, or null
 */
export function findingBlocked(c, room) {
  if (c.kind === 'price' && c.item) {
    const dish = (room.menu || []).find((m) => m.key === c.item);
    if (dish?.costEstimated) return 'The plate cost for this dish is estimated, not entered. Enter its recipe cost before changing the price.';
  }
  if (c.needs === 'recipes') return 'This rests on recipe costs that aren’t current. Update them before acting.';
  return null;
}
