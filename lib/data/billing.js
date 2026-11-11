/**
 * Invoices from proof. A month's bill is the subscription (per room) plus a
 * performance fee on reconciled savings: what verified tests booked (the lower
 * bound, never an estimate), accrued day by day while each one stayed
 * verified that month. A result reversed after it was billed comes back as a
 * credit for the days billed after the reversal.
 *
 * Pure JS, in whole cents; the server stores the result, screens show it.
 */

export const DEFAULT_PRICING = { perRoomMonthlyCents: 34900, feePct: 15 };

const DAY = 864e5;
const dayOf = (d) => Math.floor(new Date(d).getTime() / DAY); // UTC day number
const monthBounds = (period) => {
  const [y, m] = period.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1) / DAY;
  const end = Date.UTC(y, m, 1) / DAY; // exclusive
  return { start, end, days: end - start };
};

/** Days in [from, to) a window was verified within the month, and their booked cents. */
export function accrual(w, period) {
  const { start, end } = monthBounds(period);
  if (!w.closedAt || w.bookedCents == null) return { days: 0, cents: 0, from: null, to: null };
  const from = Math.max(start, dayOf(w.closedAt) + 1); // accrues from the day after it verified
  const to = Math.min(end, w.reversedAt ? dayOf(w.reversedAt) : end);
  const days = Math.max(0, to - from);
  const weekly = w.status === 'reversed' ? (w.bookedCentsBeforeReversal ?? 0) : w.bookedCents;
  return { days, cents: Math.round((weekly / 7) * days), from: days ? from : null, to: days ? to : null };
}

/** @param {unknown} p @returns {p is string} */
export const isPeriod = (p) => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
export const periodOf = (d) => new Date(d).toISOString().slice(0, 7);
export const previousPeriod = (d = new Date()) => { const x = new Date(d); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - 1); return periodOf(x); };

/**
 * @param {{ period: string, rooms: number, pricing?: { perRoomMonthlyCents: number, feePct: number },
 *   windows: { id: string, title: string, roomId: string, status: string, bookedCents: number, bookedCentsBeforeReversal?: number, closedAt?: string|Date, reversedAt?: string|Date|null }[],
 *   billed?: { windowId: string, period: string, to: number, cents: number }[] }} input
 *   billed: earlier finalized accruals, to credit any days billed after a later reversal
 */
export function buildInvoice({ period, rooms, pricing = DEFAULT_PRICING, windows, billed = [] }) {
  if (!isPeriod(period)) throw new Error(`bad period ${period}`);
  const lines = [];
  const sub = rooms * pricing.perRoomMonthlyCents;
  lines.push({ kind: 'subscription', label: `Subscription, ${rooms} room${rooms === 1 ? '' : 's'} × $${(pricing.perRoomMonthlyCents / 100).toFixed(2)}`, cents: sub });
  const accruals = [];
  for (const w of windows) {
    const a = accrual(w, period);
    if (a.days > 0 && a.cents > 0) accruals.push({ windowId: w.id, title: w.title, roomId: w.roomId, period, days: a.days, from: a.from, to: a.to, cents: a.cents });
  }
  const reconciled = accruals.reduce((s, a) => s + a.cents, 0);
  const fee = Math.round((reconciled * pricing.feePct) / 100);
  lines.push({ kind: 'fee', label: `Performance fee, ${pricing.feePct}% × $${(reconciled / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} reconciled`, cents: fee });
  // Credits: fee on days already billed after a result's reversal date.
  const credits = [];
  for (const b of billed) {
    const w = windows.find((x) => x.id === b.windowId);
    if (!w?.reversedAt) continue;
    const rev = dayOf(w.reversedAt);
    if (b.to <= rev) continue;
    const overDays = Math.min(b.to - rev, b.to - (b.from ?? b.to));
    const perDay = b.days ? b.cents / b.days : 0;
    const cents = Math.round(perDay * overDays * pricing.feePct / 100);
    if (cents > 0) credits.push({ kind: 'credit', label: `Credit: ${w.title} reversed; fee on ${overDays} day${overDays === 1 ? '' : 's'} of ${b.period} returned`, cents: -cents, windowId: w.id });
  }
  lines.push(...credits);
  const total = lines.reduce((s, l) => s + l.cents, 0);
  return { period, lines, accruals, reconciledCents: reconciled, feeCents: fee, creditCents: credits.reduce((s, c) => s - c.cents, 0), totalCents: total, keptCents: reconciled - total };
}
