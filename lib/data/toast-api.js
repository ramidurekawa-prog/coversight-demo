/**
 * Toast API → the same rows as Toast's data-export CSVs.
 *
 * The live sync (server/pos-sync.ts) pulls one business day at a time from
 * Toast's Standard API (orders, time entries, plus the reference lists that
 * turn GUIDs into names) and maps it here into ItemSelectionDetails,
 * OrderDetails, TimeEntries and PaymentDetails rows. summarizeToast() in
 * toast.js then reads them exactly as it reads an uploaded export, so a
 * group's figures don't depend on which lane brought the data in.
 *
 * Pure JS, no network. Toast timestamps are UTC; the exports (and so the
 * summary) use the restaurant's local wall clock, so every stamp is shifted
 * into the restaurant's time zone.
 */

/** "2026-10-24T01:43:12.000+0000" in a zone → "2026-10-23 18:43:12" (local wall clock). */
export function localStamp(iso, tz = 'America/Los_Angeles') {
  if (!iso) return '';
  const ms = Date.parse(String(iso).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (!Number.isFinite(ms)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 20261024 or "2026-10-24" → "2026-10-24". */
export function businessDay(d) {
  const s = String(d ?? '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}
/** "2026-10-24" → 20261024 (Toast's businessDate parameter). */
export const toBusinessDate = (iso) => Number(iso.replace(/-/g, ''));

const money = (n) => (Number.isFinite(+n) ? (Math.round(+n * 100) / 100).toFixed(2) : '0.00');
const minsBetween = (a, b) => {
  const x = Date.parse(String(a || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')), y = Date.parse(String(b || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < x) return '';
  const m = (y - x) / 6e4;
  return `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}:${String(Math.round((m * 60) % 60) % 60).padStart(2, '0')}`;
};
const ref = (o) => (o && typeof o === 'object' ? o.guid : null);
const index = (list) => new Map((Array.isArray(list) ? list : []).map((x) => [x.guid, x]));
const personName = (e) => (e ? [e.chosenName || e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.email || e.guid : '');
/** Selections that were sent to the kitchen before they were voided. */
const SENT = new Set(['SENT', 'READY', 'HOLD']);

/**
 * @param {{
 *   orders?: any[], timeEntries?: any[],
 *   refs?: { employees?: any[], jobs?: any[], diningOptions?: any[], salesCategories?: any[], tables?: any[], menuGroups?: any[] },
 *   tz?: string,
 * }} day one business day from Toast
 * @returns {{ items: Record<string,string>[], orders: Record<string,string>[], time: Record<string,string>[], payments: Record<string,string>[] }}
 */
export function mapToastDay({ orders = [], timeEntries = [], refs = {}, tz = 'America/Los_Angeles' }) {
  const emp = index(refs.employees), job = index(refs.jobs), dine = index(refs.diningOptions), cat = index(refs.salesCategories), table = index(refs.tables), group = index(refs.menuGroups);
  const out = { items: [], orders: [], time: [], payments: [] };
  const L = (iso) => localStamp(iso, tz);

  for (const o of orders) {
    if (!o || typeof o !== 'object') continue;
    const id = String(o.guid || o.displayNumber || '');
    const server = personName(emp.get(ref(o.server)));
    const option = dine.get(ref(o.diningOption))?.name || '';
    const checks = Array.isArray(o.checks) ? o.checks : [];
    const amount = checks.filter((c) => !c.voided && !c.deleted).reduce((s, c) => s + (+c.amount || 0), 0);
    const discount = checks.filter((c) => !c.voided && !c.deleted).flatMap((c) => c.appliedDiscounts || []).reduce((s, d) => s + Math.abs(+d.discountAmount || 0), 0)
      + checks.filter((c) => !c.voided && !c.deleted).flatMap((c) => c.selections || []).flatMap((s) => s.appliedDiscounts || []).reduce((s, d) => s + Math.abs(+d.discountAmount || 0), 0);
    const paid = checks.map((c) => c.paidDate).filter(Boolean).sort().at(-1) || o.paidDate || '';
    out.orders.push({
      'Order Id': id, Opened: L(o.openedDate || o.createdDate), Closed: L(o.closedDate), Paid: L(paid),
      '# of Guests': String(Math.max(0, +o.numberOfGuests || 0)), Server: server, Table: table.get(ref(o.table))?.name || '',
      'Dining Options': option, Amount: money(amount), 'Discount Amount': money(discount), Voided: o.voided || o.deleted ? 'true' : 'false',
      'Duration (Opened to Paid)': minsBetween(o.openedDate || o.createdDate, paid),
    });
    for (const c of checks) {
      if (c.deleted) continue;
      for (const s of c.selections || []) {
        if (s.deleted) continue;
        const voided = !!(s.voided || c.voided || o.voided);
        const sent = SENT.has(String(s.fulfillmentStatus || '').toUpperCase()) || !!s.sentDate;
        const qty = +s.quantity || 1;
        const net = +s.price || 0; // Toast: price after discounts, for the whole quantity
        const gross = Number.isFinite(+s.preDiscountPrice) ? +s.preDiscountPrice : net;
        out.items.push({
          'Order Id': id, 'Order Date': L(o.openedDate || s.createdDate), 'Sent Date': voided && !sent ? '' : L(s.sentDate || s.createdDate || o.openedDate),
          'Menu Item': String(s.displayName || '').trim(), 'Menu Group': group.get(ref(s.itemGroup))?.name || '', 'Sales Category': cat.get(ref(s.salesCategory))?.name || '',
          Qty: String(qty), 'Net Price': money(net), 'Gross Price': money(gross), 'Void?': voided ? 'true' : 'false', Server: server, 'Dining Option': option,
        });
      }
      for (const p of c.payments || []) {
        const refund = p.refund || null;
        out.payments.push({
          'Payment Id': String(p.guid || ''), 'Order Id': id, 'Dining Option': option, 'Paid Date': L(p.paidDate),
          'Refund Amount': money(refund ? refund.refundAmount : 0), 'Refund Date': refund ? L(refund.refundDate) : '',
        });
      }
    }
  }

  for (const t of timeEntries) {
    if (!t || typeof t !== 'object' || t.deleted) continue;
    const reg = +t.regularHours || 0, ot = +t.overtimeHours || 0;
    const wage = +t.hourlyWage || 0;
    out.time.push({
      Employee: personName(emp.get(ref(t.employeeReference))), 'Job Title': job.get(ref(t.jobReference))?.title || '',
      'In Date': L(t.inDate), 'Out Date': L(t.outDate), Wage: money(wage),
      'Regular Hours': String(reg), 'Overtime Hours': String(ot), 'Payable Hours': String(reg + ot), 'Total Hours': String(reg + ot),
      'Total Pay': money(wage * reg + wage * 1.5 * ot),
    });
  }
  return out;
}

/** Concatenate mapped days into the file list summarizeToast() reads. */
export function daysToFiles(days) {
  const files = [];
  for (const kind of ['items', 'orders', 'time', 'payments']) {
    const rows = days.flatMap((d) => d[kind] || []);
    if (rows.length) files.push({ kind, name: `toast-api:${kind}`, rows });
  }
  return files;
}
