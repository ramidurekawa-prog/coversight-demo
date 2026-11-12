// Comparing a group's own rooms, fairly. Every metric is a rate (share of
// sales, per cover), so rooms of different sizes compare on the same footing;
// totals are shown only as context. A room is called ahead only when the gap
// is bigger than the week-to-week wobble in both rooms; otherwise the page
// says the rooms are level. No outside benchmark is ever shown: that needs a
// cohort of comparable rooms we don't have.

export const PEER_COHORT_MIN = 40;

/** @type {{ k: string, label: string, better: 'low' | 'high' | 'neutral', of: (r: any) => number | null, f: (x: number) => string, screen?: string }[]} */
export const METRICS = [
  { k: 'labour', label: 'Labour, share of sales', better: 'low', of: (r) => (r.net ? (r.labour / r.net) * 100 : null), f: (x) => `${x.toFixed(1)}%`, screen: 'labour' },
  { k: 'food', label: 'Food cost, share of sales', better: 'low', of: (r) => (r.net ? (r.food / r.net) * 100 : null), f: (x) => `${x.toFixed(1)}%`, screen: 'menu' },
  { k: 'prime', label: 'Prime cost, share of sales', better: 'low', of: (r) => (r.net ? ((r.food + r.labour) / r.net) * 100 : null), f: (x) => `${x.toFixed(1)}%` },
  { k: 'mpc', label: 'Margin per cover', better: 'high', of: (r) => (r.covers ? r.earned / r.covers : null), f: (x) => `$${x.toFixed(2)}` },
  { k: 'check', label: 'Average check', better: 'neutral', of: (r) => (r.covers ? r.net / r.covers : null), f: (x) => `$${x.toFixed(2)}` },
  { k: 'exc', label: 'Voids, comps and discounts, share of sales', better: 'low', of: (r) => (Number.isFinite(r.excPct) ? r.excPct : null), f: (x) => `${x.toFixed(2)}%`, screen: 'controls' },
  { k: 'covers', label: 'Covers a week', better: 'neutral', of: (r) => r.covers ?? null, f: (x) => Math.round(x).toLocaleString('en-US') },
  { k: 'net', label: 'Net sales a week', better: 'neutral', of: (r) => r.net ?? null, f: (x) => `$${Math.round(x).toLocaleString('en-US')}` },
];

/** @param {number[]} xs */
const stats = (xs) => {
  const n = xs.length;
  if (!n) return null;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, sd, lo: Math.min(...xs), hi: Math.max(...xs), n };
};

/**
 * @param {{ id: string, name: string, history: any[] }[]} rooms
 * @param {{ weeks?: number }} [opts]
 */
export function compareRooms(rooms, { weeks = 8 } = {}) {
  if (rooms.length < 2) return { ok: false, reason: 'Comparison needs at least two rooms in the group.', rows: [], rooms: rooms.map((r) => ({ id: r.id, name: r.name })) };
  const recent = rooms.map((r) => ({ id: r.id, name: r.name, h: (r.history || []).slice(-weeks) }));
  const rows = METRICS.map((m) => {
    const per = recent.map((r) => ({ id: r.id, name: r.name, ...stats(r.h.map(m.of).filter((x) => x != null && Number.isFinite(x))) }));
    if (per.some((p) => p.mean == null)) return { ...m, per, leader: null, verdict: 'missing' };
    if (m.better === 'neutral') return { ...m, per, leader: null, verdict: 'context' };
    const order = [...per].sort((a, b) => (m.better === 'low' ? a.mean - b.mean : b.mean - a.mean));
    const [first, second] = order;
    const noise = Math.max(first.sd, second.sd);
    const gap = Math.abs(first.mean - second.mean);
    return gap > noise && noise >= 0
      ? { ...m, per, leader: first.id, gap, noise, verdict: 'clear' }
      : { ...m, per, leader: null, gap, noise, verdict: 'level' };
  });
  const covers = rows.find((r) => r.k === 'covers').per.map((p) => p.mean);
  const sizeRatio = Math.max(...covers) / Math.max(1, Math.min(...covers));
  // The single biggest fair gap, in units of week-to-week noise.
  const clear = rows.filter((r) => r.verdict === 'clear').map((r) => {
    const sorted = [...r.per].sort((a, b) => (r.better === 'low' ? a.mean - b.mean : b.mean - a.mean));
    const worst = sorted[sorted.length - 1];
    return { ...r, best: sorted[0], worst, spread: Math.abs(sorted[0].mean - worst.mean), z: r.noise ? r.gap / r.noise : Infinity };
  }).sort((a, b) => b.z - a.z);
  return { ok: true, weeks, rows, sizeRatio, unlike: sizeRatio > 2, top: clear[0] ?? null, rooms: recent.map((r) => ({ id: r.id, name: r.name, weeks: r.h.length, own: r.h.some((x) => x.own) })) };
}
