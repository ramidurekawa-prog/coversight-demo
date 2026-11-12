// A stand-in for Toast's Standard API, enough for the sync: login, restaurant,
// labor and config lists (employees paged by token), ordersBulk paged by number,
// and time entries, all by business day. Deterministic per day.
export const GUID = '6b2f5e3a-1c4d-4e8f-9a0b-2c3d4e5f6a7b';

const EMP = [
  { guid: 'e1', firstName: 'Ana', lastName: 'Ruiz' }, { guid: 'e2', firstName: 'Ben', lastName: 'Cho' },
  { guid: 'e3', firstName: 'Cam', lastName: 'Diaz' }, { guid: 'e4', firstName: 'Dee', lastName: 'Park' },
  { guid: 'e5', firstName: 'Eli', lastName: 'Moss' },
];
const JOBS = [{ guid: 'j1', title: 'Server' }, { guid: 'j2', title: 'Line Cook' }, { guid: 'j3', title: 'Bartender' }];
const DINING = [{ guid: 'd1', name: 'Dine In' }, { guid: 'd2', name: 'Take Out' }, { guid: 'd3', name: 'DoorDash Delivery' }];
const CATS = [{ guid: 'c1', name: 'Food' }, { guid: 'c2', name: 'Liquor' }];
const TABLES = Array.from({ length: 12 }, (_, i) => ({ guid: `t${i + 1}`, name: String(i + 1) }));
const MENU = [
  { name: 'Burger', price: 18, cat: 'c1' }, { name: 'Salmon', price: 29, cat: 'c1' }, { name: 'Salad', price: 14, cat: 'c1' },
  { name: 'Ribeye', price: 42, cat: 'c1' }, { name: 'Old Fashioned', price: 15, cat: 'c2' },
];

/** Orders for one business day: more on Fri/Sat, enough on Saturday to need a second page. */
export function ordersFor(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay();
  const n = dow === 6 ? 130 : dow === 5 ? 95 : 40 + (d.getUTCDate() % 7);
  const out = [];
  for (let i = 0; i < n; i++) {
    // Open between 5pm and 9pm Pacific = 00:00–04:00 UTC the next day.
    const open = new Date(Date.parse(`${day}T00:00:00Z`) + 864e5 + (i % 48) * 5 * 6e4);
    const paid = new Date(open.getTime() + (55 + (i % 30)) * 6e4);
    const item = MENU[i % MENU.length]!;
    const voidedAfterSend = i % 37 === 0;
    out.push({
      guid: `${day}-o${i}`, openedDate: open.toISOString(), closedDate: paid.toISOString(), paidDate: paid.toISOString(), voided: false,
      numberOfGuests: 1 + (i % 4), server: { guid: EMP[i % 3]!.guid }, table: { guid: TABLES[i % 12]!.guid }, diningOption: { guid: DINING[i % 10 === 0 ? 2 : i % 6 === 0 ? 1 : 0]!.guid },
      checks: [{
        guid: `${day}-c${i}`, amount: item.price * 2, paidDate: paid.toISOString(), appliedDiscounts: i % 11 === 0 ? [{ discountAmount: 5 }] : [],
        selections: [
          { guid: `${day}-s${i}a`, displayName: item.name, quantity: 2, price: item.price * 2, preDiscountPrice: item.price * 2, salesCategory: { guid: item.cat }, fulfillmentStatus: 'SENT', createdDate: open.toISOString() },
          ...(voidedAfterSend ? [{ guid: `${day}-s${i}v`, displayName: 'Ribeye', quantity: 1, price: 42, preDiscountPrice: 42, voided: true, salesCategory: { guid: 'c1' }, fulfillmentStatus: 'SENT', createdDate: open.toISOString() }] : []),
        ],
        payments: [{ guid: `${day}-p${i}`, paidDate: paid.toISOString(), amount: item.price * 2, ...(i % 50 === 0 ? { refund: { refundAmount: 6, refundDate: paid.toISOString() } } : {}) }],
      }],
    });
  }
  return out;
}

export function timeFor(day: string) {
  const base = Date.parse(`${day}T23:00:00Z`); // 4pm Pacific
  return EMP.map((e, i) => ({
    guid: `${day}-te${i}`, employeeReference: { guid: e.guid }, jobReference: { guid: JOBS[i < 3 ? 0 : i === 3 ? 1 : 2]!.guid },
    inDate: new Date(base).toISOString(), outDate: new Date(base + 7 * 36e5).toISOString(), regularHours: 7, overtimeHours: i === 3 ? 1 : 0, hourlyWage: 18 + i,
  }));
}

export function fakeToastApi({ auth = 200, throttleOnce = false, failOrders = 0 }: { auth?: number; throttleOnce?: boolean; failOrders?: number } = {}) {
  const calls: string[] = [];
  let throttled = false;
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push(url);
    const u = new URL(url);
    const p = u.pathname;
    if (p.endsWith('/authentication/login')) return auth === 200 ? json({ token: { accessToken: 'tok-123' } }) : json({}, auth);
    if (init?.headers?.authorization !== 'Bearer tok-123') return json({}, 401);
    if (p.startsWith('/restaurants/v1/restaurants/')) return json({ general: { locationName: 'Fixture Bistro', timeZone: 'America/Los_Angeles' } });
    if (p === '/labor/v1/employees') return u.searchParams.get('pageToken') === 'p2' ? json(EMP.slice(3)) : json(EMP.slice(0, 3), 200, { 'Toast-Next-Page-Token': 'p2' });
    if (p === '/labor/v1/jobs') return json(JOBS);
    if (p === '/config/v2/diningOptions') return json(DINING);
    if (p === '/config/v2/salesCategories') return json(CATS);
    if (p === '/config/v2/tables') return json(TABLES);
    if (p === '/config/v2/menuGroups') return json([]);
    const bd = u.searchParams.get('businessDate') ?? '';
    const day = `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6, 8)}`;
    if (p === '/orders/v2/ordersBulk') {
      if (throttleOnce && !throttled) { throttled = true; return json({}, 429, { 'Retry-After': '1' }); }
      if (failOrders) return json({}, failOrders);
      const page = Number(u.searchParams.get('page')), size = Number(u.searchParams.get('pageSize'));
      return json(ordersFor(day).slice((page - 1) * size, page * size));
    }
    if (p === '/labor/v1/timeEntries') return json(timeFor(day));
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}
