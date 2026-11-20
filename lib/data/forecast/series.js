/**
 * Covercast inputs: one shape for every lane. A room's history becomes
 *   days:     [{ iso, covers, net, source }]           one row per open day
 *   hours:    [{ iso, hour, covers, sales }]            when order times are known
 *   quarters: [{ iso, min, covers, sales }]             15-minute slots, from order times only
 * from the sample's dense detail, from Toast order rows (sync or export), or
 * from days a manager typed in. Nothing is spread or invented here: a day
 * entered by hand has no hours, and the sample's hours have no quarters.
 */
import { densify } from '../dense.js';
import { isIso } from './calendar.js';

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The sample room's days and hours (null for a room on its own data). */
export function seriesFromSample(room) {
  const d = densify(room);
  if (!d) return null;
  return {
    days: d.days.map((x) => ({ iso: x.iso, covers: x.covers, net: x.net, source: 'sample' })),
    hours: d.hours.map((h) => ({ iso: h.iso, hour: h.hour, covers: h.covers, sales: h.sales })),
    quarters: [],
    // The sample keeps dish units by week only (no daily item counts).
    itemWeeks: d.items.flatMap((m) => d.weeks.map((iso, w) => ({ week: iso, item: m.name, qty: m.units[w] }))),
    items: [],
    source: 'sample',
  };
}

/** "2026-11-17 18:42:10" → minutes after midnight, or null. */
const stampMin = (s) => {
  const m = /\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? +m[1] * 60 + +m[2] : null;
};
const money = (s) => { const n = parseFloat(String(s ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };

/**
 * Days, hours and quarters from stored order rows (pos_days, shaped like the
 * Toast exports). Voided orders don't count. A day with no orders is left
 * out (closed or not pulled), never counted as zero.
 * @param {{ day: string, orders: Record<string, string>[], items?: Record<string, string>[] }[]} posDays
 */
export function seriesFromOrders(posDays) {
  const days = [], hours = [], quarters = [], items = [];
  for (const p of [...(posDays || [])].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    if (!isIso(p.day)) continue;
    const live = (p.orders || []).filter((o) => String(o.Voided).toLowerCase() !== 'true');
    if (!live.length) continue;
    let covers = 0, net = 0;
    const byH = new Map(), byQ = new Map();
    for (const o of live) {
      const c = Math.max(0, Math.round(+o['# of Guests'] || 0));
      const s = money(o.Amount);
      covers += c; net += s;
      const min = stampMin(o.Opened);
      if (min == null) continue;
      const h = Math.floor(min / 60), q = Math.floor(min / 15) * 15;
      const bh = byH.get(h) ?? { covers: 0, sales: 0 }; bh.covers += c; bh.sales += s; byH.set(h, bh);
      const bq = byQ.get(q) ?? { covers: 0, sales: 0 }; bq.covers += c; bq.sales += s; byQ.set(q, bq);
    }
    days.push({ iso: p.day, covers, net: r2(net), source: 'pos' });
    for (const [hour, b] of [...byH].sort((a, b) => a[0] - b[0])) hours.push({ iso: p.day, hour, covers: b.covers, sales: r2(b.sales) });
    for (const [min, b] of [...byQ].sort((a, b) => a[0] - b[0])) quarters.push({ iso: p.day, min, covers: b.covers, sales: r2(b.sales) });
    // Items sold that day (not voided), for prep.
    const byI = new Map();
    for (const it of p.items || []) {
      if (String(it['Void?']).toLowerCase() === 'true') continue;
      const name = String(it['Menu Item'] || '').trim();
      if (!name) continue;
      byI.set(name, (byI.get(name) ?? 0) + (+it.Qty || 1));
    }
    for (const [item, qty] of byI) items.push({ iso: p.day, item, qty });
  }
  return { days, hours, quarters, items, itemWeeks: [], source: 'pos' };
}

/**
 * Add days a manager entered by hand where the feed has none (a feed day
 * always wins: it's the record). Labelled `manual` all the way through.
 * @param {{ days: any[], hours: any[], quarters: any[], source?: string } | null} series
 * @param {{ date: string, covers?: number, net?: number }[]} manualDays
 */
export function withManualDays(series, manualDays = []) {
  const base = series ?? { days: [], hours: [], quarters: [], source: 'manual' };
  const have = new Set(base.days.map((d) => d.iso));
  const add = (manualDays || []).filter((m) => isIso(m.date) && !have.has(m.date) && (num(m.covers) != null || num(m.net) != null))
    .map((m) => ({ iso: m.date, covers: num(m.covers), net: num(m.net), source: 'manual' }));
  if (!add.length) return base;
  return { ...base, days: [...base.days, ...add].sort((a, b) => (a.iso < b.iso ? -1 : 1)) };
}
