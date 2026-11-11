/**
 * Guided write-backs. Where a system has no open write API (Toast menu prices
 * are pre-release only; Toast permissions, delivery-app menus and kitchen
 * displays have none; 7shifts needs an account we don't have yet), an
 * approval becomes a task: exact steps for the manager to do in that system,
 * a Done button, and, where the data can show it, a check on the next data
 * upload that the change really happened.
 *
 * Pure JS: the server builds the steps and the check; screens show them.
 */

/** Where each system's change is made. */
export const WHERE = {
  'Toast menu': { app: 'Toast Web', path: 'Menus → Menu manager → find the item → Price', publish: 'Save, then Publish so the change reaches the POS' },
  Toast: { app: 'Toast Web', path: 'Employees → Job settings → Permissions (Voids: require manager approval and a void reason)', publish: 'Save; the permission applies at the next clock-in' },
  'Toast delivery menus': { app: 'Toast Web', path: 'Menus → Price levels → the DoorDash and Uber Eats price level (or each app’s menu in Toast Partner Connect)', publish: 'Save and publish; the apps pick it up within an hour' },
  '7shifts': { app: '7shifts', path: 'Schedule → next week → Edit', publish: 'Publish the schedule so the team is notified' },
  'Kitchen display': { app: 'Toast Web', path: 'Kitchen → Display setup → Routing', publish: 'Save; the KDS updates on its next sync' },
};
const DEFAULT_WHERE = { app: 'the system', path: 'the relevant settings', publish: 'Save the change' };

/** The checklist for one approval: open the system, each change from the diff, publish, tap Done. */
export function stepsFor(system, diff = []) {
  const w = WHERE[system] || DEFAULT_WHERE;
  const changes = diff
    .filter(([what, was, now]) => what && now && now !== '—' && was !== now)
    .map(([what, was, now]) => (was && was !== '—' ? `${what}: change “${was}” to “${now}”` : `${what}: set to “${now}”`));
  return [`Open ${w.app} → ${w.path}`, ...changes, w.publish, 'Come back here and tap Done'];
}

/**
 * What the data can confirm, parsed from the approval id (never from the
 * client's text): a price change shows up as the new price in the next Toast
 * export. Everything else is confirmed by the manager's Done.
 */
export function expectFor(approvalId) {
  const m = /^price:([\w-]+):([\d.]+)$/.exec(approvalId || '');
  if (m) return { type: 'price', dish: m[1], price: +m[2] };
  return { type: 'manual' };
}

/** Does the room's data show the change? null = can't tell (yet). */
export function checkExpect(expect, room) {
  if (expect?.type !== 'price' || !room?.fromToast) return null;
  const item = room.menu.find((m) => m.key === expect.dish) || null;
  if (!item) return null;
  // The latest week's paid price (the menu price is a 4-week average, which lags a change).
  const ph = room.levers?.priceHistory?.[expect.dish];
  const latest = ph?.length ? ph[ph.length - 1].price : item.price;
  return Math.abs(latest - expect.price) <= 0.1;
}
