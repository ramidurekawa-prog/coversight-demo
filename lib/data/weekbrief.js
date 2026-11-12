// The weekly brief: what changed, why, and what next, from the room's own
// weekly history. Pure; every figure comes from history rows, never typed.
//
// earned = net − food − labour, so a change in earned splits exactly into a
// sales part, a food part and a labour part. "Why" names the biggest of those.

/** @param {number[]} xs */
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * @param {{ net: number, food: number, labour: number, earned: number, covers: number, iso?: string, label?: string, own?: boolean }[]} history oldest first
 * @returns {null | {
 *   week: { label?: string, iso?: string, net: number, earned: number, covers: number, foodRate: number, labourRate: number },
 *   vsLast: { earned: number, net: number, covers: number },
 *   vsAvg4: { earned: number, net: number, covers: number },
 *   parts: { key: 'sales' | 'food' | 'labour', label: string, amount: number }[],
 *   driver: { key: 'sales' | 'food' | 'labour', label: string, amount: number },
 *   trend: { label?: string, earned: number }[],
 *   own: boolean,
 * }}
 */
export function weekBrief(history) {
  const h = (history || []).filter((r) => Number.isFinite(r.net) && Number.isFinite(r.earned));
  if (h.length < 2) return null;
  const cur = h[h.length - 1], prev = h[h.length - 2];
  const prior4 = h.slice(-5, -1);
  const rate = (r, k) => (r.net ? r[k] / r.net : 0);
  // Positive amount = helped this week's margin.
  const parts = /** @type {const} */ ([
    { key: 'sales', label: 'Sales', amount: cur.net - prev.net },
    { key: 'food', label: 'Food cost', amount: -(cur.food - prev.food) },
    { key: 'labour', label: 'Labour', amount: -(cur.labour - prev.labour) },
  ]).map((p) => ({ ...p }));
  const driver = parts.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
  return {
    week: { label: cur.label, iso: cur.iso, net: cur.net, earned: cur.earned, covers: cur.covers, foodRate: rate(cur, 'food'), labourRate: rate(cur, 'labour') },
    vsLast: { earned: cur.earned - prev.earned, net: cur.net - prev.net, covers: cur.covers - prev.covers },
    vsAvg4: {
      earned: cur.earned - mean(prior4.map((r) => r.earned)),
      net: cur.net - mean(prior4.map((r) => r.net)),
      covers: cur.covers - mean(prior4.map((r) => r.covers)),
    },
    parts,
    driver,
    trend: h.slice(-8).map((r) => ({ label: r.label, earned: r.earned })),
    own: !!cur.own,
  };
}
