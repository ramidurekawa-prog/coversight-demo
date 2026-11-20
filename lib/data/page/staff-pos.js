// Staff page, from Toast's own rows: each person's orders and clock-ins summed
// by week and service slot, in the same columns as the sample's rows
// (lib/data/seed.js STAFF_COLS), so lib/data/page/staff.js reads both alike.
// Called from summarizeToast() (lib/data/toast.js), which both lanes use: the
// browser's export import and the server's API sync (rows shaped like the
// exports). Same rules as Toast's employee rows there: sales are item net
// prices, cancellations are voided items that had been sent to the kitchen,
// giveaways are order discounts. Fields Toast's exports don't carry are null
// (late clock-ins need a schedule; reasons left blank and refunds by person
// aren't in these files), and the page says so instead of guessing.
import { STAFF_COLS, STAFF_SLOTS } from '../seed.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STARTER = /starter|appetizer|appetiser|small plate|shareable|to share/i;
const DESSERT = /dessert|sweet|pastry|pudding/i;
const DRINK = /drink|bev|wine|beer|cocktail|liquor|spirit|bar|soda|coffee|tea|juice/i;

/** Weekday lunch 0 · Mon–Thu dinner 1 · Fri–Sat dinner 2 · weekend day and Sunday dinner 3. */
export function slotOf(ms) {
  const d = new Date(ms);
  const day = DAYS[d.getUTCDay()], h = d.getUTCHours();
  const weekend = day === 'Sat' || day === 'Sun';
  if (h < 16) return weekend ? 3 : 0;
  if (day === 'Fri' || day === 'Sat') return 2;
  return day === 'Sun' ? 3 : 1;
}

/**
 * @param {{ items: object[], orders: object[], time: object[] }} rows Toast export rows
 * @param {{ weekOf: (ms:number)=>number, weeksCovered: number, parse: (s:string)=>number|null, money: (s:any)=>number, yes: (s:any)=>boolean, minutes: (s:any)=>number|null, isDineIn: (s:any)=>boolean }} h
 */
export function staffShiftsFromExports({ items = [], orders = [], time = [] }, h) {
  const weeks = Math.min(13, Math.max(1, h.weeksCovered || 1));
  const names = [];
  const pIx = new Map();
  const job = new Map();
  const cells = new Map();
  const person = (name) => {
    const k = String(name || '').trim();
    if (!k) return null;
    if (!pIx.has(k)) { pIx.set(k, names.length); names.push(k); }
    return pIx.get(k);
  };
  const cell = (p, ms) => {
    const back = h.weekOf(ms);
    if (back < 0 || back >= weeks) return null;
    const w = weeks - 1 - back, slot = slotOf(ms);
    const key = `${p}|${w}|${slot}`;
    if (!cells.has(key)) cells.set(key, { p, w, slot, shifts: 0, hours: 0, sales: 0, guests: 0, checks: 0, items: 0, starters: 0, desserts: 0, drinks: 0, tips: null, tableMin: 0, comps: 0, disc: 0, voids: 0, refunds: null, noReason: null, late: null, ot: 0 });
    return cells.get(key);
  };
  for (const r of time) {
    const t = h.parse(r['In Date']); if (t == null) continue;
    const p = person(r.Employee); if (p == null) continue;
    const c = cell(p, t); if (!c) continue;
    const out = h.parse(r['Out Date']);
    const hours = h.money(r['Payable Hours']) || h.money(r['Total Hours']) || (out != null && out > t ? (out - t) / 36e5 : 0);
    c.shifts += 1; c.hours += hours; c.ot += h.money(r['Overtime Hours']);
    if (r['Job Title'] && !job.has(p)) job.set(p, String(r['Job Title']).trim());
  }
  for (const r of items) {
    const t = h.parse(r['Order Date'] || r['Sent Date']); if (t == null) continue;
    const p = person(r.Server); if (p == null) continue;
    const c = cell(p, t); if (!c) continue;
    if (h.yes(r['Void?'])) { if (String(r['Sent Date'] || '').trim()) c.voids += Math.abs(h.money(r['Gross Price']) || h.money(r['Net Price'])); continue; }
    const qty = h.money(r.Qty) || 1;
    c.sales += h.money(r['Net Price']);
    c.items += qty;
    const cat = `${r['Sales Category'] || ''} ${r['Menu Group'] || ''}`;
    if (DESSERT.test(cat)) c.desserts += qty;
    else if (STARTER.test(cat)) c.starters += qty;
    else if (DRINK.test(cat)) c.drinks += qty;
  }
  for (const r of orders) {
    const t = h.parse(r.Opened); if (t == null || h.yes(r.Voided)) continue;
    const p = person(r.Server); if (p == null) continue;
    const c = cell(p, t); if (!c) continue;
    c.checks += 1;
    c.guests += Math.max(0, Math.round(h.money(r['# of Guests'])));
    c.disc += Math.abs(h.money(r['Discount Amount']));
    if (r.Tip != null && r.Tip !== '') c.tips = (c.tips || 0) + h.money(r.Tip);
    if (!items.length) c.sales += h.money(r.Amount);
    if (h.isDineIn(r['Dining Options'])) {
      const dur = h.minutes(r['Duration (Opened to Paid)']) ?? (h.parse(r.Paid) != null ? (h.parse(r.Paid) - t) / 6e4 : null);
      if (dur != null && dur > 5 && dur < 360) c.tableMin += dur;
    }
  }
  if (!cells.size) return null;
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const rows = [...cells.values()].sort((a, b) => a.p - b.p || a.w - b.w || a.slot - b.slot)
    .map((c) => STAFF_COLS.map((k) => (['hours', 'sales', 'tips', 'comps', 'disc', 'voids', 'refunds', 'noReason', 'ot', 'tableMin'].includes(k) ? r2(c[k]) : c[k])));
  const sold = new Set(rows.filter((r) => r[STAFF_COLS.indexOf('sales')] > 0).map((r) => r[0]));
  return {
    weeks, slots: STAFF_SLOTS, cols: STAFF_COLS,
    names: names.map((n, i) => [n, job.get(i) || (sold.has(i) ? 'Server' : '')]),
    rows: rows.slice(0, 20000),
  };
}
