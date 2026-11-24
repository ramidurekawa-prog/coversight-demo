/**
 * The food cost loop on invoices: find the money leaking on what the vendors
 * bill, draft the ask, approve it, and confirm it on the next invoice.
 *
 * Three checks, each read straight from the room's invoice lines (Observed):
 *  - price creep: an item billed above the price it was before (or above the
 *    price agreed on the order guide, when one is entered) by more than 3%;
 *  - pack size: a case that now holds fewer units than before (or than the
 *    order guide says) at a price that didn't fall as far, so each unit costs
 *    more even when the case looks the same or cheaper;
 *  - unit mix-up: a price that jumped or fell by 3 times or more, which is
 *    almost always a case billed as a unit (or the reverse). No dollars are
 *    claimed on it; it is checked first.
 *
 * The dollars are over the last 28 days of invoices (Observed). What a vendor
 * gives back is confirmed on a later invoice and counted then, as Observed;
 * nothing here is Bookable (only a Proof test is).
 *
 * Each check carries an approval id the server re-checks (server/tasks.ts):
 *   vendor:<item-slug>:price:<target price>   vendor:<item-slug>:pack:<units>
 *
 * Pure JS: the server, the screens and the tests use it.
 */

/** Price creep counts past this share of the earlier price, and this many dollars over 28 days. */
export const CREEP_PCT = 3;
export const CREEP_MIN = 20;
/** A move this many times over (or under) is read as a unit mix-up, not a price. */
export const MIXUP_RATIO = 3;

const r2 = (x) => Math.round(x * 100) / 100;
export const itemSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
const money = (x) => `$${x.toFixed(2)}`;

/**
 * Every leak on the room's invoice lines, biggest first.
 * @param {{ invoices?: any[], profile?: { name?: string } }} room
 */
export function foodCostChecks(room) {
  const out = [];
  for (const r of room?.invoices || []) {
    if (!(r.p1 > 0) || !(r.q1 > 0)) continue;
    const slug = itemSlug(r.item);
    const before = r.agreed ?? r.p0;
    const vs = r.agreed != null ? 'the price on your order guide' : 'what they charged the 28 days before';
    // Unit mix-up first: a 3× move is a unit, not a price, and nothing is claimed until it's checked.
    if (r.p0 > 0 && (r.p1 / r.p0 >= MIXUP_RATIO || r.p0 / r.p1 >= MIXUP_RATIO)) {
      out.push({
        id: `vendor:${slug}:unit`, kind: 'unit', item: r.item, vendor: r.vendor, unit: r.unit, cents: null, claim: 'obs',
        title: `Check the unit on ${r.item}`,
        say: `${r.item} went from ${money(r.p0)} to ${money(r.p1)} per ${r.unit}. That's usually a case billed as a ${r.unit}, or the reverse.`,
        todo: `Look at the ${r.vendor} invoice and fix the unit on Data.`,
        approvalId: null,
      });
      continue;
    }
    // Pack size: fewer units per case than before (or than the order guide), at a price that didn't fall as far.
    const pack0 = r.agreedPack ?? r.pack0 ?? null;
    if (pack0 && r.pack1 && r.pack1 < pack0) {
      const per0 = r.p0 / pack0, per1 = r.p1 / r.pack1;
      if (per1 > per0 * 1.005) {
        const cents = Math.round((per1 - per0) * r.pack1 * r.q1 * 100);
        out.push({
          id: `vendor:${slug}:pack`, kind: 'pack', item: r.item, vendor: r.vendor, unit: r.unit, packUnit: r.packUnit || 'units', pack0, pack1: r.pack1,
          before: r2(per0), now: r2(per1), pct: r2((per1 / per0 - 1) * 100), cents, claim: 'obs',
          title: `${r.item}: smaller ${r.unit}, same money`,
          say: `A ${r.unit} of ${r.item} now holds ${r.pack1} ${r.packUnit || 'units'}, not ${pack0}. Each one costs ${Math.round((per1 / per0 - 1) * 100)}% more, even though the ${r.unit} price ${r.p1 <= r.p0 ? 'went down' : 'barely moved'}.`,
          todo: `Ask ${r.vendor} for the ${pack0}-${r.packUnit || 'unit'} ${r.unit}, or a price that matches ${r.pack1}.`,
          approvalId: `vendor:${slug}:pack:${pack0}`,
          target: { pack: pack0, perUnit: r2(per0) },
        });
        continue;
      }
    }
    // Price creep: billed above the earlier (or agreed) price.
    if (before > 0 && r.p1 > before * (1 + CREEP_PCT / 100)) {
      const cents = Math.round((r.p1 - before) * r.q1 * 100);
      if (cents < CREEP_MIN * 100) continue;
      out.push({
        id: `vendor:${slug}:price`, kind: 'price', item: r.item, vendor: r.vendor, unit: r.unit, before: r2(before), now: r2(r.p1), pct: r2((r.p1 / before - 1) * 100), cents, claim: 'obs', vs,
        title: `${r.item}: ${Math.round((r.p1 / before - 1) * 100)}% more from ${r.vendor}`,
        say: `${r.vendor} now bills ${money(r.p1)} per ${r.unit} for ${r.item}, up from ${money(before)} (${vs}). That's ${`$${Math.round(cents / 100).toLocaleString('en-US')}`} more over the last 28 days.`,
        todo: `Ask ${r.vendor} to go back to ${money(before)}, or say what changed.`,
        approvalId: `vendor:${slug}:price:${before.toFixed(2)}`,
        target: { price: r2(before) },
      });
    }
  }
  return out.sort((a, b) => (b.cents ?? -1) - (a.cents ?? -1));
}

/** The email for one check, with the invoice numbers in it, ready to send from the manager's own email. */
export function vendorAsk(check, { room = 'our restaurant', from = 'Purchasing' } = {}) {
  if (check.kind === 'pack') {
    return {
      subject: `${check.item}: pack size on our last invoices`,
      body: `Hi ${check.vendor} team,\n\nOur recent invoices for ${room} show ${check.item} at ${check.pack1} ${check.packUnit} per ${check.unit}. We've been getting ${check.pack0}. Per ${check.packUnit.replace(/s$/, '')}, that's ${money(check.before)} going to ${money(check.now)} (up ${check.pct.toFixed(1)}%).\n\nCan you send the ${check.pack0}-${check.packUnit} ${check.unit} again, or adjust the ${check.unit} price to match ${check.pack1}? A credit for the difference on recent deliveries would be appreciated.\n\nThanks,\n${from}, ${room}`,
    };
  }
  if (check.kind === 'price') {
    return {
      subject: `${check.item}: price on our last invoices`,
      body: `Hi ${check.vendor} team,\n\nOn our recent invoices for ${room}, ${check.item} is ${money(check.now)} per ${check.unit}, up from ${money(check.before)} (${check.vs}), ${check.pct.toFixed(1)}% higher.\n\nCan you bring it back to ${money(check.before)}, or tell us what changed and what volume would get it there? We'd like to keep ordering from you.\n\nThanks,\n${from}, ${room}`,
    };
  }
  return null;
}

/** What a later invoice has to show for the ask to count as done. */
export function vendorExpect(approvalId) {
  const m = /^vendor:([a-z0-9-]+):(price|pack):([\d.]+)$/.exec(approvalId || '');
  if (!m) return null;
  return m[2] === 'price' ? { type: 'vendor', item: m[1], kind: 'price', price: +m[3] } : { type: 'vendor', item: m[1], kind: 'pack', pack: +m[3] };
}

/**
 * Does the room's own latest invoice show the vendor fixed it? Only lines the
 * room entered itself count (never the sample's). null = can't tell yet.
 * Returns the money back over 28 days at the latest quantity (Observed).
 */
export function vendorCheck(expect, room) {
  if (expect?.type !== 'vendor') return null;
  const r = (room?.invoices || []).find((x) => itemSlug(x.item) === expect.item);
  if (!r || !r.own) return null;
  if (expect.kind === 'price') {
    const ok = r.p1 <= expect.price * 1.01;
    return { ok, note: ok ? `The latest ${r.vendor} invoice bills ${r.item} at ${money(r.p1)} per ${r.unit}.` : `The latest ${r.vendor} invoice still bills ${money(r.p1)} per ${r.unit}.`, now: r.p1 };
  }
  const ok = (r.pack1 ?? 0) >= expect.pack;
  return { ok, note: ok ? `The latest ${r.vendor} invoice has ${r.pack1} per ${r.unit} again.` : `The latest ${r.vendor} invoice still has ${r.pack1 ?? 'an unknown number'} per ${r.unit}.`, now: r.pack1 ?? null };
}
