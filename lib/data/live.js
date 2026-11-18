/**
 * Tonight, live: covers per 15-minute slot from 5 pm, read from the same
 * order rows the Toast sync keeps (pos_days, shaped like the exports), the
 * usual night from the same weekday's stored days, and a manager's own entry
 * when no feed is there or it's down. Pure, so the browser and the server
 * count it the same way. Nothing here guesses a number that wasn't recorded:
 * with no comparable nights there's no pace, and a hand-entered total is
 * never spread into a made-up curve.
 */

/** Dinner is read in 15-minute slots from 5:00 pm (20 slots, to 10 pm). */
export const LIVE = { startMin: 17 * 60, slotMin: 15, slots: 20, comparableWeeks: 8, minComparable: 2, refreshMs: 5 * 60_000, staleMs: 20 * 60_000 };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "2026-11-17" → "Tuesday". */
export const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
/** "2026-11-17 18:42:10" → minutes after midnight, or null. */
const stampMin = (s) => {
  const m = /\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? +m[1] * 60 + +m[2] : null;
};
/** Clock minutes → the slot it falls in, or -1 outside dinner. */
export const slotOf = (min) => {
  if (min == null || min < LIVE.startMin) return -1;
  const i = Math.floor((min - LIVE.startMin) / LIVE.slotMin);
  return i < LIVE.slots ? i : -1;
};
/** How many slots have started by this clock time (0 before 5 pm, 20 after 10). */
export const slotsBy = (min) => (min == null ? 0 : Math.max(0, Math.min(LIVE.slots, Math.ceil((min - LIVE.startMin + 1) / LIVE.slotMin))));

/** Covers per slot from one day's order rows (voided orders don't count). */
export function coversBySlot(orders) {
  const out = Array(LIVE.slots).fill(0);
  let n = 0;
  for (const o of orders || []) {
    if (String(o.Voided).toLowerCase() === 'true') continue;
    const i = slotOf(stampMin(o.Opened));
    if (i < 0) continue;
    out[i] += Math.max(0, Math.round(+o['# of Guests'] || 0));
    n++;
  }
  return { slots: out, orders: n };
}

/**
 * The usual night: the average covers per slot over the same weekday's
 * stored days before today (newest first, up to 8). Null with fewer than two.
 * @param {{ day: string, orders: any[] }[]} days
 */
export function usualNight(days, today) {
  const wd = weekdayOf(today);
  const same = (days || []).filter((x) => x.day < today && weekdayOf(x.day) === wd).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, LIVE.comparableWeeks);
  const nights = same.map((x) => coversBySlot(x.orders).slots).filter((s) => s.some(Boolean));
  if (nights.length < LIVE.minComparable) return { comp: null, nights: nights.length, weekday: wd };
  const comp = Array.from({ length: LIVE.slots }, (_, i) => Math.round((nights.reduce((a, s) => a + s[i], 0) / nights.length) * 10) / 10);
  return { comp, nights: nights.length, weekday: wd };
}

const sum = (a, n) => a.slice(0, n).reduce((x, y) => x + y, 0);

/**
 * Tonight as the page shows it, from what's stored for the room today.
 * source: 'toast' (pulled), 'manual' (entered by hand; newer than the last
 * pull, or there's no feed), or 'none'. Pace only when there's a usual night
 * to compare with. Staffing only from a schedule feed or an entry: without
 * it the page says nothing about staffing being right.
 * @param {{ day: string, slots?: number[]|null, orders?: number, pulledAt?: string|null, error?: string|null,
 *   manual?: { covers?: number, servers?: number, at: string, by?: string }|null, staff?: number[]|null, staffAt?: string|null, staffError?: string|null }} row
 * @param {{ comp: number[]|null, nights: number }} usual
 * @param {{ nowMs: number, nowMin: number, connected: { toast: boolean, staff: boolean } }} at
 */
export function liveTonight(row, usual, { nowMs, nowMin, connected }) {
  const weekday = weekdayOf(row.day);
  const n = slotsBy(nowMin);
  const pulled = row.pulledAt ? Date.parse(row.pulledAt) : null;
  const manualAt = row.manual?.at ? Date.parse(row.manual.at) : null;
  const pulledOk = pulled != null && Array.isArray(row.slots) && row.slots.length === LIVE.slots;
  const stale = connected.toast && (!pulled || nowMs - pulled > LIVE.staleMs);
  const useManual = row.manual?.covers != null && (!pulledOk || stale || (manualAt != null && manualAt > (pulled ?? 0)));
  const source = useManual ? 'manual' : pulledOk ? 'toast' : 'none';
  const comp = usual?.comp || null;

  let so = null, usualSo = null, actual = null, asOf = null;
  if (source === 'toast') {
    actual = row.slots.slice(0, Math.max(1, n));
    so = sum(row.slots, n);
    usualSo = comp ? sum(comp, n) : null;
    asOf = row.pulledAt;
  } else if (source === 'manual') {
    so = Math.round(row.manual.covers);
    const at = new Date(row.manual.at);
    asOf = row.manual.at;
    // Compared with the usual night up to the time it was entered, not now.
    const enteredMin = nowMin - Math.max(0, Math.round((nowMs - at.getTime()) / 60_000));
    usualSo = comp ? sum(comp, slotsBy(enteredMin)) : null;
  }
  const pace = so != null && usualSo ? Math.round((so / usualSo - 1) * 100) : null;
  const staffNow = Array.isArray(row.staff) && n > 0 ? row.staff[Math.min(n, LIVE.slots) - 1] ?? null : null;
  const servers = row.manual?.servers != null && (!Array.isArray(row.staff) || (manualAt ?? 0) > (row.staffAt ? Date.parse(row.staffAt) : 0)) ? row.manual.servers : staffNow;
  return {
    day: `${weekday} dinner`,
    weekday,
    mode: 'pace',
    live: true,
    source,
    started: n > 0,
    so,
    usual: usualSo,
    pace,
    factor: pace == null ? null : so / usualSo,
    comp,
    actual,
    now: n,
    nights: usual?.nights ?? 0,
    asOf,
    servers,
    serversFrom: row.manual?.servers != null && servers === row.manual.servers ? 'manual' : staffNow != null ? '7shifts' : null,
    feeds: {
      toast: !connected.toast ? 'off' : row.error && stale ? 'down' : stale ? 'stale' : 'ok',
      staff: !connected.staff ? 'off' : row.staffError ? 'down' : 'ok',
    },
    error: row.error || null,
    staffError: row.staffError || null,
    enteredBy: useManual ? row.manual.by ?? null : null,
  };
}
