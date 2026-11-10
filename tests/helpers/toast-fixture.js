/**
 * A synthetic restaurant's Toast data exports, with Toast's real headers and
 * value formats ("10/27/26 5:43 PM", "$12.00", "Void?" true/false). 13 weeks,
 * dinner 5–10 pm, four servers, two cooks, a bartender. Deterministic.
 */
import { toCSV } from '../../lib/data/ingest.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n) => String(n).padStart(2, '0');
export function toastDate(ms) {
  const d = new Date(ms);
  let h = d.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)} ${h}:${pad(d.getUTCMinutes())} ${ap}`;
}
const $ = (n) => `$${n.toFixed(2)}`;

export const DISHES = [
  { name: 'Grilled Salmon', price: 28, w: 5, cat: 'Food' },
  { name: 'Ribeye Steak', price: 42, w: 3, cat: 'Food' },
  { name: 'House Burger', price: 19, w: 6, cat: 'Food' },
  { name: 'Caesar Salad', price: 14, w: 4, cat: 'Food' },
  { name: 'Mushroom Risotto', price: 24, w: 3, cat: 'Food' },
  { name: 'Glass of Pinot', price: 15, w: 5, cat: 'Wine' },
];
const SERVERS = ['Ana P.', 'Ben K.', 'Cara L.', 'Dev S.'];

export function toastFixture({ weeks = 13, end = Date.UTC(2026, 9, 25), seed = 7, dinnerServers = 3 } = {}) {
  const rand = rng(seed);
  const items = [], orders = [], time = [], payments = [], kitchen = [];
  let orderNo = 1000;
  const start = end - weeks * 7 * 864e5;
  for (let day = start; day < end; day += 864e5) {
    const dow = new Date(day).getUTCDay();
    const busy = dow === 5 || dow === 6 ? 1.5 : dow === 1 ? 0.6 : 1;
    // Clock-ins: servers 4:30–10:30 pm, cooks 3–11 pm, bartender 4–11 pm.
    const crew = SERVERS.slice(0, dow === 5 || dow === 6 ? 4 : dinnerServers);
    for (const s of crew) time.push({ emp: s, job: 'Server', in: day + 16.5 * 36e5, out: day + 22.5 * 36e5, wage: 16.5 });
    for (const c of ['Eli M.', 'Fay R.']) time.push({ emp: c, job: 'Line Cook', in: day + 15 * 36e5, out: day + 23 * 36e5, wage: 24 });
    time.push({ emp: 'Gus T.', job: 'Bartender', in: day + 16 * 36e5, out: day + 23 * 36e5, wage: 18 });
    for (let h = 17; h < 22; h++) {
      const shape = [0.7, 1, 1.15, 1, 0.6][h - 17];
      const parties = Math.max(1, Math.round(6 * busy * shape * (0.8 + 0.4 * rand())));
      for (let p = 0; p < parties; p++) {
        const opened = day + h * 36e5 + Math.floor(rand() * 55) * 6e4;
        const guests = 1 + Math.floor(rand() * 4);
        const server = crew[Math.floor(rand() * crew.length)];
        const id = `ord-${++orderNo}`;
        const option = rand() < 0.86 ? 'Dine In' : rand() < 0.5 ? 'Take Out' : 'DoorDash - Delivery';
        const table = option === 'Dine In' ? `T${1 + Math.floor(rand() * 14)}` : '';
        let amount = 0;
        for (let g = 0; g < guests + 1; g++) {
          let r = rand() * DISHES.reduce((s, d) => s + d.w, 0);
          const dish = DISHES.find((d) => (r -= d.w) < 0) || DISHES[0];
          const voided = rand() < 0.02;
          const sent = opened + 4 * 6e4;
          items.push({
            Location: 'Fixture Bistro', 'Order Id': id, 'Order #': orderNo, 'Sent Date': toastDate(sent), 'Order Date': toastDate(opened), 'Check Id': `chk-${orderNo}`,
            Server: server, Table: table, 'Dining Area': 'Main', Service: 'Dinner', 'Dining Option': option, 'Item Selection Id': `sel-${orderNo}-${g}`,
            'Item Id': dish.name, 'Master Id': dish.name, SKU: '', 'Menu Item': dish.name, 'Menu Subgroup(s)': '', 'Menu Group': dish.cat, Menu: 'Dinner', 'Sales Category': dish.cat,
            'Gross Price': $(dish.price), Discnt: $(0), 'Net Price': $(voided ? 0 : dish.price), Qty: '1', Tax: $(dish.price * 0.09), 'Void?': voided ? 'true' : 'false',
            Deferred: 'false', 'Tax Exempt': 'false', 'Tax Inclusion Option': '', 'Dining Option Tax': '', 'Tab Name': '',
          });
          if (!voided) amount += dish.price;
          kitchen.push({ Location: 'Fixture Bistro', ID: `kt-${orderNo}-${g}`, Server: server, 'Check #': orderNo, Table: table, 'Check Opened': toastDate(opened), Station: dish.cat === 'Wine' ? 'Bar' : dish.name.includes('Steak') || dish.name.includes('Salmon') || dish.name.includes('Burger') ? 'Grill' : 'Saute', 'Expediter Level': '1', 'Fired Date': toastDate(sent), 'Fulfilled Date': toastDate(sent + 14 * 6e4), 'Fulfillment Time': `0:${pad(8 + Math.floor(rand() * 12))}:00`, 'Fulfilled By': 'Expo' });
        }
        const discount = rand() < 0.05 ? 10 : 0;
        const dur = 50 + Math.floor(rand() * 40);
        orders.push({
          Location: 'Fixture Bistro', 'Order Id': id, 'Order #': orderNo, Checks: 1, Opened: toastDate(opened), '# of Guests': guests, 'Tab Names': '', Server: server, Table: table,
          'Revenue Center': 'Dining Room', 'Dining Area': 'Main', Service: 'Dinner', 'Dining Options': option, 'Discount Amount': $(discount), Amount: $(amount - discount), Tax: $(amount * 0.09),
          Tip: $(amount * 0.18), Gratuity: $(0), Total: $(amount * 1.27), Voided: 'false', Paid: toastDate(opened + dur * 6e4), Closed: toastDate(opened + (dur + 2) * 6e4), 'Duration (Opened to Paid)': `0:${pad(dur % 60)}:00`.replace(/^0:/, `${Math.floor(dur / 60)}:`), 'Order Source': 'In store',
        });
        payments.push({ Location: 'Fixture Bistro', 'Payment Id': `pay-${orderNo}`, 'Order Id': id, 'Order #': orderNo, 'Paid Date': toastDate(opened + dur * 6e4), 'Order Date': toastDate(opened), 'Dining Option': option, Amount: $(amount - discount), 'Refund Amount': option.startsWith('DoorDash') && rand() < 0.1 ? $(12) : '', 'Refund Date': '' });
      }
    }
  }
  const timeRows = time.map((t, i) => {
    const hours = (t.out - t.in) / 36e5;
    const ot = t.job === 'Line Cook' && new Date(t.in).getUTCDay() === 6 ? 2 : 0;
    return {
      Location: 'Fixture Bistro', 'Location Code': 'FB', Id: i, GUID: `te-${i}`, 'Employee Id': t.emp, 'Employee GUID': t.emp, 'Employee External Id': '', Employee: t.emp, 'Job Id': t.job, 'Job GUID': t.job, 'Job Code': '', 'Job Title': t.job,
      'In Date': toastDate(t.in), 'Out Date': toastDate(t.out), 'Total Hours': hours.toFixed(2), 'Unpaid Break Time': '0', 'Paid Break Time': '0', 'Payable Hours': hours.toFixed(2),
      'Cash Tips Declared': '0', 'Non Cash Tips': '0', 'Total Gratuity': '0', 'Total Tips': '0', 'Tips Withheld': '0', Wage: $(t.wage), 'Regular Hours': (hours - ot).toFixed(2), 'Overtime Hours': ot.toFixed(2),
      'Regular Pay': $((hours - ot) * t.wage), 'Overtime Pay': $(ot * t.wage * 1.5), 'Total Pay': $((hours - ot) * t.wage + ot * t.wage * 1.5),
    };
  });
  const csv = (rows) => toCSV(Object.keys(rows[0]), rows);
  return {
    'ItemSelectionDetails.csv': csv(items),
    'OrderDetails.csv': csv(orders),
    'TimeEntries.csv': csv(timeRows),
    'PaymentDetails.csv': csv(payments),
    'KitchenTimings.csv': csv(kitchen),
  };
}
