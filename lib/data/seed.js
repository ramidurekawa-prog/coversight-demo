/**
 * The sample restaurant group, as one deterministic dataset.
 *
 * Rosewood Restaurant Group: three rooms (Oakland, Berkeley, Walnut Creek),
 * a 40-dish catalog, 8 vendors and 30 invoice lines, a named staff list per
 * room, 52 weeks of weekly history, channel splits, usage counts, ticket
 * times, plan candidates and verification packets.
 *
 * Rules this file keeps:
 *  - Oakland's original figures are anchors, not outputs: its 15 original
 *    dishes, 7 original invoice lines, 6 named front-of-house people and the
 *    week of Oct 19 (net $41,620, food $12,130, hourly labour $10,550) are
 *    exactly as before. New rows are added around them, and a balancing
 *    "sides and add-ons" line per room closes menu sales and food cost to the
 *    room's week, so every total is the sum of its rows.
 *  - Generated rows use a seeded PRNG, so the dataset is identical on every
 *    build and in every test.
 *  - Nothing here is real. Names, prices and quantities are invented.
 *
 * Pure JS (no React): route files, tests and the browser all import it.
 */

/* ------------------------------------------------------------------ PRNG */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) {
  const u = Math.max(rand(), 1e-9), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ calendar */
export const NOW = { label: 'Tuesday, October 27, 2026', week: 'Week of Oct 19 – 25', time: '7:15 pm', iso: '2026-10-27' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 52 week-start Mondays, Oct 27 2025 → Oct 19 2026. */
export const HISTORY_WEEKS = Array.from({ length: 52 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 9, 27 + i * 7));
  return { i, iso: d.toISOString().slice(0, 10), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, month: d.getUTCMonth(), year: d.getUTCFullYear() };
});
/** The savings ledger runs from the first accrual. */
export const LEDGER_WEEKS = HISTORY_WEEKS.slice(34).map((w) => w.label); // Jun 22 → Oct 19 (18 weeks)

const MONTH_FACTOR = [0.9, 0.93, 0.97, 1.0, 1.02, 1.04, 1.05, 1.04, 1.0, 1.0, 0.98, 1.08];
const EVENT_FACTOR = { '2025-11-24': 0.86, '2025-12-22': 1.16, '2025-12-29': 1.05, '2026-02-09': 1.08, '2026-05-04': 1.09, '2026-07-06': 0.95 };
const seasonality = (w) => MONTH_FACTOR[w.month] * (EVENT_FACTOR[w.iso] || 1);

/* ------------------------------------------------------------------ rooms */
export const LOCS = [
  { id: 'oakland', name: 'Rosewood Oakland', short: 'Oakland', seats: 84, addr: '4801 Telegraph Ave', gm: 'Marcus Rivera' },
  { id: 'berkeley', name: 'Rosewood Berkeley', short: 'Berkeley', seats: 64, addr: '2120 Shattuck Ave', gm: 'Devon Clarke' },
  { id: 'walnut', name: 'Rosewood Walnut Creek', short: 'Walnut Creek', seats: 72, addr: '1380 N Main St', gm: 'Priya Shah' },
  { id: 'all', name: 'All three rooms', short: 'All rooms', seats: 220, addr: 'Rosewood Restaurant Group' },
];
export const ROOM_IDS = ['oakland', 'berkeley', 'walnut'];

/* Each room's week of Oct 19, the anchor every series and total closes to.
   earned = net − food − hourly labour; margin per cover = earned ÷ covers. */
const ANCHOR = {
  oakland: { net: 41620, food: 12130, labour: 10550, covers: 1412, growth: 0.03, foodRate: 0.291, labourRate: 0.253, matchedEarned: 18530 },
  berkeley: { net: 33180, food: 9713, labour: 9257, covers: 1176, growth: -0.02, foodRate: 0.293, labourRate: 0.279, matchedEarned: 14470 },
  walnut: { net: 37350, food: 11469, labour: 9001, covers: 1213, growth: 0.05, foodRate: 0.307, labourRate: 0.241, matchedEarned: 16340 },
};
/** Week indexes compared with this week: early Nov last year and late Sep–early Oct this year. */
export const MATCHED_WEEKS = [0, 1, 2, 47, 48, 49];

/* ------------------------------------------------------------------ vendors and SKUs */
export const VENDORS = [
  { name: 'Bay Fish Co.', cat: 'Seafood', terms: 'Net 14', rep: 'Lena Ortiz' },
  { name: 'Hollis Meats', cat: 'Proteins', terms: 'Net 21', rep: 'Sam Hollis' },
  { name: 'Valley Greens', cat: 'Produce and butter', terms: 'Net 14', rep: 'Ari Patel' },
  { name: 'Bayline Dairy', cat: 'Dairy and eggs', terms: 'Net 14', rep: 'June Park' },
  { name: 'Coast Dry Goods', cat: 'Dry goods and bakery', terms: 'Net 30', rep: 'Marco Bellini' },
  { name: 'Golden Gate Beverage', cat: 'Wine and spirits', terms: 'Net 30', rep: 'Tess Wong' },
  { name: 'Fog Line Brewing', cat: 'Beer', terms: 'COD', rep: 'Rob Diaz' },
  { name: 'Pacific Paper & Supply', cat: 'Packaging and disposables', terms: 'Net 30', rep: 'Kim Lee' },
];

/* Group contract prices: p0 = the 28 days before, p1 = the last 28 days.
   q = Oakland's last-28-day quantity; the other rooms scale from it. The
   first seven rows are Oakland's original invoice lines, unchanged. */
const SKUS = [
  { item: 'Salmon fillet', unit: 'lb', vendor: 'Bay Fish Co.', p0: 11.4, p1: 13.65, q0: 410, q1: 388 },
  { item: 'Romaine hearts', unit: 'case', vendor: 'Valley Greens', p0: 38.0, p1: 49.29, q0: 26, q1: 24 },
  { item: 'Ribeye, choice', unit: 'lb', vendor: 'Hollis Meats', p0: 14.2, p1: 14.64, q0: 300, q1: 289 },
  { item: 'Butter, unsalted', unit: 'lb', vendor: 'Valley Greens', p0: 4.1, p1: 4.35, q0: 220, q1: 230 },
  { item: 'Arborio rice', unit: 'lb', vendor: 'Coast Dry Goods', p0: 2.6, p1: 2.6, q0: 90, q1: 84 },
  { item: 'Heirloom tomatoes', unit: 'lb', vendor: 'Valley Greens', p0: 3.8, p1: 3.55, q0: 160, q1: 170 },
  { item: 'Chicken, whole', unit: 'lb', vendor: 'Hollis Meats', p0: 3.15, p1: 3.15, q0: 640, q1: 660 },
  { item: 'Shrimp, 16/20', unit: 'lb', vendor: 'Bay Fish Co.', p0: 9.8, p1: 10.4, q0: 72, q1: 75 },
  { item: 'Cod fillet', unit: 'lb', vendor: 'Bay Fish Co.', p0: 8.9, p1: 9.6, q0: 118, q1: 112 },
  { item: 'Ground chuck', unit: 'lb', vendor: 'Hollis Meats', p0: 4.6, p1: 4.6, q0: 320, q1: 334 },
  { item: 'Pancetta', unit: 'lb', vendor: 'Hollis Meats', p0: 9.2, p1: 9.45, q0: 48, q1: 50 },
  { item: 'Short rib, bone-in', unit: 'lb', vendor: 'Hollis Meats', p0: 7.8, p1: 8.4, q0: 104, q1: 98 },
  { item: 'Pork chop, frenched', unit: 'lb', vendor: 'Hollis Meats', p0: 6.1, p1: 6.1, q0: 58, q1: 60 },
  { item: 'Turkey breast', unit: 'lb', vendor: 'Hollis Meats', p0: 5.4, p1: 5.4, q0: 30, q1: 28 },
  { item: 'Eggs, large', unit: 'case', vendor: 'Bayline Dairy', p0: 52.0, p1: 47.5, q0: 9, q1: 9 },
  { item: 'Parmigiano', unit: 'lb', vendor: 'Bayline Dairy', p0: 16.8, p1: 17.3, q0: 34, q1: 35 },
  { item: 'Mozzarella, fresh', unit: 'lb', vendor: 'Bayline Dairy', p0: 6.9, p1: 6.9, q0: 118, q1: 122 },
  { item: 'Heavy cream', unit: 'gal', vendor: 'Bayline Dairy', p0: 14.2, p1: 14.9, q0: 26, q1: 26 },
  { item: 'Mixed mushrooms', unit: 'lb', vendor: 'Valley Greens', p0: 7.4, p1: 7.1, q0: 62, q1: 64 },
  { item: 'Lemons', unit: 'case', vendor: 'Valley Greens', p0: 42.0, p1: 44.0, q0: 6, q1: 6 },
  { item: 'Avocados', unit: 'case', vendor: 'Valley Greens', p0: 58.0, p1: 66.0, q0: 5, q1: 5 },
  { item: 'Yukon potatoes', unit: 'sack', vendor: 'Valley Greens', p0: 31.0, p1: 31.0, q0: 14, q1: 15 },
  { item: 'Flour, 00', unit: 'bag', vendor: 'Coast Dry Goods', p0: 38.0, p1: 38.0, q0: 12, q1: 12 },
  { item: 'Spaghetti, bronze-cut', unit: 'case', vendor: 'Coast Dry Goods', p0: 34.0, p1: 35.0, q0: 9, q1: 9 },
  { item: 'Olive oil, EVOO', unit: 'tin', vendor: 'Coast Dry Goods', p0: 41.0, p1: 44.5, q0: 10, q1: 10 },
  { item: 'Burger buns', unit: 'dozen', vendor: 'Coast Dry Goods', p0: 7.2, p1: 7.2, q0: 66, q1: 69 },
  { item: 'House red, bottle', unit: 'case', vendor: 'Golden Gate Beverage', p0: 112.0, p1: 112.0, q0: 30, q1: 31 },
  { item: 'Bourbon, 1L', unit: 'bottle', vendor: 'Golden Gate Beverage', p0: 37.0, p1: 38.5, q0: 34, q1: 35 },
  { item: 'IPA, half barrel', unit: 'keg', vendor: 'Fog Line Brewing', p0: 189.0, p1: 189.0, q0: 9, q1: 9 },
  { item: 'To-go containers', unit: 'case', vendor: 'Pacific Paper & Supply', p0: 64.0, p1: 69.0, q0: 11, q1: 12 },
];
/* Room purchase scale vs Oakland, and the SKUs a room doesn't buy. */
const ROOM_BUY = {
  oakland: { scale: 1, skip: ['Turkey breast', 'Eggs, large'], only7: false },
  berkeley: { scale: 0.79, skip: ['Turkey breast', 'Pork chop, frenched'] },
  walnut: { scale: 0.9, skip: [] },
};

/* ------------------------------------------------------------------ menu catalog
   price/cost are Oakland's; e = elasticity fitted from price history, se its
   standard error, null = not enough price changes to learn from. The first
   15 are Oakland's original menu, unchanged. */
const CATALOG = [
  { key: 'salmon', name: 'Grilled Salmon', cat: 'Food', price: 28, cost: 11.9, units: 142, e: -0.8, se: 0.3 },
  { key: 'ribeye', name: 'Ribeye Steak', cat: 'Food', price: 42, cost: 17.6, units: 64, e: -0.31, se: 0.14 },
  { key: 'chicken', name: 'Roast Half Chicken', cat: 'Food', price: 24, cost: 7.4, units: 118, e: -0.9, se: 0.3 },
  { key: 'carbonara', name: 'Pasta Carbonara', cat: 'Food', price: 21, cost: 5.1, units: 142, e: -0.85, se: 0.25 },
  { key: 'pizza', name: 'Margherita Pizza', cat: 'Food', price: 19, cost: 4.2, units: 166, e: -1.2, se: 0.3 },
  { key: 'caesar', name: 'Caesar Salad', cat: 'Food', price: 15, cost: 3.9, units: 120, e: -1.1, se: 0.35 },
  { key: 'burger', name: 'Rosewood Burger', cat: 'Food', price: 18, cost: 5.8, units: 188, e: -1.4, se: 0.3 },
  { key: 'tacos', name: 'Fish Tacos', cat: 'Food', price: 17, cost: 5.95, units: 96, e: -1.3, se: 0.4 },
  { key: 'risotto', name: 'Mushroom Risotto', cat: 'Food', price: 22, cost: 6.2, units: 58, e: -1.0, se: 0.5 },
  { key: 'soup', name: 'Heirloom Tomato Soup', cat: 'Food', price: 9, cost: 2.1, units: 44, e: null, se: null },
  { key: 'red', name: 'House Red (glass)', cat: 'Alcohol', price: 14, cost: 3.92, units: 210, e: -0.7, se: 0.2 },
  { key: 'oldf', name: 'Barrel Old Fashioned', cat: 'Alcohol', price: 15, cost: 3.0, units: 132, e: -0.6, se: 0.2 },
  { key: 'ipa', name: 'Fog Line IPA (draft)', cat: 'Alcohol', price: 9, cost: 2.25, units: 176, e: -0.8, se: 0.25 },
  { key: 'lemonade', name: 'Sparkling Lemonade', cat: 'Non-alc', price: 6, cost: 1.1, units: 70, e: -1.5, se: 0.6 },
  { key: 'torte', name: 'Chocolate Torte', cat: 'Dessert', price: 11, cost: 3.1, units: 62, e: -1.1, se: 0.4 },
  { key: 'calamari', name: 'Fried Calamari', cat: 'Food', price: 16, cost: 3.9, units: 32, e: -1.2, se: 0.4 },
  { key: 'burrata', name: 'Burrata & Stone Fruit', cat: 'Food', price: 17, cost: 4.6, units: 28, e: -0.9, se: 0.45 },
  { key: 'wings', name: 'Smoked Wings', cat: 'Food', price: 15, cost: 3.4, units: 36, e: -1.3, se: 0.35 },
  { key: 'fries', name: 'Truffle Fries', cat: 'Food', price: 9, cost: 1.4, units: 70, e: -0.6, se: 0.3 },
  { key: 'brussels', name: 'Crispy Brussels Sprouts', cat: 'Food', price: 11, cost: 2.1, units: 40, e: -1.0, se: 0.5 },
  { key: 'shrimp', name: 'Garlic Shrimp Linguine', cat: 'Food', price: 26, cost: 7.6, units: 30, e: -0.95, se: 0.35 },
  { key: 'shortrib', name: 'Braised Short Rib', cat: 'Food', price: 34, cost: 10.9, units: 24, e: -0.55, se: 0.3 },
  { key: 'porkchop', name: 'Grilled Pork Chop', cat: 'Food', price: 29, cost: 8.2, units: 18, e: null, se: null },
  { key: 'veggie', name: 'Roasted Vegetable Bowl', cat: 'Food', price: 19, cost: 4.0, units: 22, e: -1.1, se: 0.5 },
  { key: 'club', name: 'Turkey Club', cat: 'Food', price: 17, cost: 5.2, units: 12, e: -0.6, se: 0.3 },
  { key: 'kale', name: 'Kale & Quinoa Salad', cat: 'Food', price: 14, cost: 3.0, units: 18, e: -1.2, se: 0.6 },
  { key: 'flatbread', name: 'Mushroom Flatbread', cat: 'Food', price: 16, cost: 3.2, units: 24, e: -1.0, se: 0.4 },
  { key: 'kidsmac', name: 'Kids Mac & Cheese', cat: 'Food', price: 9, cost: 1.8, units: 16, e: null, se: null },
  { key: 'benedict', name: 'Crab Benedict', cat: 'Brunch', price: 24, cost: 8.1, units: 0, e: -0.5, se: 0.25 },
  { key: 'pancakes', name: 'Lemon Ricotta Pancakes', cat: 'Brunch', price: 16, cost: 3.4, units: 0, e: -0.8, se: 0.35 },
  { key: 'cheesecake', name: 'Basque Cheesecake', cat: 'Dessert', price: 11, cost: 2.3, units: 28, e: -1.0, se: 0.45 },
  { key: 'affogato', name: 'Affogato', cat: 'Dessert', price: 8, cost: 1.7, units: 18, e: -1.2, se: 0.6 },
  { key: 'white', name: 'House White (glass)', cat: 'Alcohol', price: 13, cost: 2.9, units: 70, e: -0.75, se: 0.25 },
  { key: 'spritz', name: 'Aperol Spritz', cat: 'Alcohol', price: 14, cost: 2.6, units: 38, e: -0.9, se: 0.35 },
  { key: 'margarita', name: 'Spicy Margarita', cat: 'Alcohol', price: 15, cost: 2.7, units: 42, e: -0.7, se: 0.3 },
  { key: 'martini', name: 'Gin Martini', cat: 'Alcohol', price: 16, cost: 2.8, units: 24, e: -0.5, se: 0.3 },
  { key: 'lager', name: 'Bay Lager (draft)', cat: 'Alcohol', price: 8, cost: 1.6, units: 54, e: -0.9, se: 0.3 },
  { key: 'zero', name: 'Zero-proof Spritz', cat: 'Non-alc', price: 10, cost: 1.8, units: 16, e: null, se: null },
  { key: 'coffee', name: 'Coffee & Espresso', cat: 'Non-alc', price: 5, cost: 0.7, units: 70, e: -0.4, se: 0.3 },
  { key: 'sides', name: 'Sides & add-ons', cat: 'Food', price: 6, cost: 2, units: 160, e: null, se: null, balancing: true },
];
const ORIGINAL_15 = CATALOG.slice(0, 15).map((m) => m.key);

/* Per-room menu adjustments vs Oakland: price delta, unit multiplier by
   category, and dish-level overrides. Berkeley prices a dollar lower on
   mains and sells more burgers and delivery-friendly dishes; Walnut Creek
   runs weekend brunch and sells more cocktails. */
const ROOM_MENU = {
  berkeley: {
    priceDelta: { Food: -1, Alcohol: -1, Brunch: 0 }, unitMult: { Food: 0.82, Alcohol: 0.7, 'Non-alc': 0.95, Dessert: 0.8, Brunch: 0 },
    over: { burger: { units: 196 }, chicken: { units: 124 }, salmon: { price: 27, units: 96 }, ribeye: { price: 40, units: 34, e: -0.35, se: 0.16 }, risotto: { units: 38 }, porkchop: { units: 0 }, club: { units: 0 }, kale: { units: 30 }, veggie: { units: 34 } },
    sidesUnits: 150, costMult: 0.965, // smaller portions on the bowls and salads
  },
  walnut: {
    priceDelta: { Food: 0, Alcohol: 1, Brunch: 0 }, unitMult: { Food: 0.9, Alcohol: 1.05, 'Non-alc': 1.0, Dessert: 1.0, Brunch: 1 },
    over: { benedict: { units: 58 }, pancakes: { units: 64 }, club: { units: 46, e: -0.6, se: 0.25 }, spritz: { units: 66 }, margarita: { units: 70 }, oldf: { units: 150 }, tacos: { units: 70 }, coffee: { units: 120 } },
    sidesUnits: 170, costMult: 1.085, // premium proteins and a delivery surcharge from two vendors
  },
};

/* Recipe quantities per plate, in the SKU's count unit. Used for
   theoretical usage = Σ plates × qty. */
export const RECIPES = {
  salmon: [['Salmon fillet', 0.5], ['Butter, unsalted', 0.06]],
  ribeye: [['Ribeye, choice', 1.0], ['Butter, unsalted', 0.06]],
  chicken: [['Chicken, whole', 1.4]],
  carbonara: [['Pancetta', 0.08], ['Spaghetti, bronze-cut', 0.016], ['Parmigiano', 0.05]],
  pizza: [['Mozzarella, fresh', 0.22], ['Flour, 00', 0.006]],
  caesar: [['Romaine hearts', 0.04375], ['Parmigiano', 0.03]],
  burger: [['Ground chuck', 0.4], ['Burger buns', 0.0833]],
  tacos: [['Cod fillet', 0.28], ['Avocados', 0.01]],
  risotto: [['Arborio rice', 0.3], ['Mixed mushrooms', 0.25]],
  shrimp: [['Shrimp, 16/20', 0.5]],
  shortrib: [['Short rib, bone-in', 1.0]],
  porkchop: [['Pork chop, frenched', 0.75]],
  club: [['Turkey breast', 0.3]],
  flatbread: [['Mixed mushrooms', 0.15], ['Mozzarella, fresh', 0.12]],
  benedict: [['Eggs, large', 0.0111]],
  red: [['House red (oz)', 6]],
  oldf: [['Bourbon (oz)', 2]],
};

/* ------------------------------------------------------------------ staff
   Oakland's six named front-of-house people are the originals. Everyone else
   is generated. sales/postVoid/comps/disc are last-28-day totals; hours are
   this week; rate is the loaded hourly rate. */
const FIRST = ['Ana', 'Luis', 'Marisol', 'Theo', 'Priya', 'Dani', 'Noah', 'Iris', 'Caleb', 'Mei', 'Jonah', 'Rosa', 'Eli', 'Grace', 'Omar', 'Lucia', 'Ben', 'Hana', 'Felix', 'Tara', 'Quinn', 'Ivy', 'Hugo', 'Nia', 'Rafa', 'Sol', 'Wren', 'Zoe', 'Kai', 'Lena', 'Milo', 'Ada', 'Cruz', 'Bea', 'Leo', 'Maya', 'Ezra', 'Nora', 'Arlo', 'June'];
const LAST_I = 'ABCDEFGHJKLMNPRSTVWY';
const ORIGINAL_FOH = [
  { name: 'Tomás R.', role: 'Server', sales: 24100, postVoid: 140, comps: 210, disc: 310 },
  { name: 'Jess M.', role: 'Server', sales: 22400, postVoid: 120, comps: 180, disc: 290 },
  { name: 'Kayla P.', role: 'Server', sales: 21300, postVoid: 610, comps: 240, disc: 280 },
  { name: 'Sam O.', role: 'Server', sales: 19800, postVoid: 95, comps: 160, disc: 260 },
  { name: 'Rina D.', role: 'Bartender', sales: 26900, postVoid: 70, comps: 520, disc: 190 },
  { name: 'Owen L.', role: 'Bartender', sales: 18200, postVoid: 60, comps: 330, disc: 150 },
];
/* Oakland's "everyone else (11)" totals from the original controls screen. */
const OAK_REST = { n: 11, sales: 33780, postVoid: 180, comps: 400, disc: 620 };

const STAFF_PLAN = {
  oakland: { servers: 7, bartenders: 2, hosts: 3, bussers: 3, boh: [['Chef de cuisine', 1], ['Sous chef', 1], ['Line cook', 5], ['Prep cook', 2], ['Dishwasher', 3]] },
  berkeley: { servers: 7, bartenders: 2, hosts: 2, bussers: 2, boh: [['Chef de cuisine', 1], ['Sous chef', 1], ['Line cook', 4], ['Prep cook', 2], ['Dishwasher', 2]] },
  walnut: { servers: 8, bartenders: 3, hosts: 2, bussers: 2, boh: [['Chef de cuisine', 1], ['Sous chef', 1], ['Line cook', 5], ['Prep cook', 1], ['Dishwasher', 2]] },
};
const RATE = { Server: 14.5, Bartender: 15.5, Host: 17.5, Busser: 16.5, 'Chef de cuisine': 34, 'Sous chef': 27, 'Line cook': 22, 'Prep cook': 20, Dishwasher: 18.5 };
const HOURS = { Server: 26, Bartender: 30, Host: 20, Busser: 22, 'Chef de cuisine': 48, 'Sous chef': 46, 'Line cook': 36, 'Prep cook': 34, Dishwasher: 30 };

/* ------------------------------------------------------------------ build */
function buildMenu(roomId) {
  const base = CATALOG.map((m) => ({ ...m }));
  if (roomId === 'oakland') return base.filter((m) => m.units > 0 || m.balancing);
  const cfg = ROOM_MENU[roomId];
  return base
    .map((m) => {
      if (m.balancing) return { ...m, units: cfg.sidesUnits };
      const o = cfg.over[m.key] || {};
      const price = o.price ?? m.price + (cfg.priceDelta[m.cat] || 0);
      const units = o.units ?? Math.round(m.units * (cfg.unitMult[m.cat] ?? 1));
      return { ...m, price, units, cost: r2(m.cost * (cfg.costMult || 1)), e: o.e ?? m.e, se: o.se ?? m.se };
    })
    .filter((m) => m.units > 0 || m.balancing);
}

function buildInvoices(roomId, rand) {
  const cfg = ROOM_BUY[roomId];
  return SKUS.filter((s) => !cfg.skip.includes(s.item)).map((s, i) => {
    if (roomId === 'oakland') return { ...s };
    const jit = () => 1 + gauss(rand) * 0.04;
    const scale = cfg.scale * (s.item === 'Eggs, large' || s.item === 'Turkey breast' ? 1.6 : 1);
    const q0 = Math.max(1, Math.round(s.q0 * scale * jit()));
    const q1 = Math.max(1, Math.round(s.q1 * scale * jit()));
    return { ...s, q0, q1 };
  });
}

function nameGen(rand, used) {
  for (;;) {
    const n = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST_I[Math.floor(rand() * LAST_I.length)]}.`;
    if (!used.has(n)) { used.add(n); return n; }
  }
}

/* Split `total` into n positive parts with mild variation. */
function split(total, n, rand, spread = 0.35) {
  const w = Array.from({ length: n }, () => 1 + (rand() - 0.5) * 2 * spread);
  const s = w.reduce((a, b) => a + b, 0);
  const parts = w.map((x) => Math.round((x / s) * total));
  parts[n - 1] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

function buildStaff(roomId, rand, foh4wk, labourTarget) {
  const plan = STAFF_PLAN[roomId];
  const used = new Set(['Kayla P.', 'Jess M.', 'Tomás R.', 'Sam O.', 'Rina D.', 'Owen L.', 'Ana B.', 'Luis F.']);
  const staff = [];
  if (roomId === 'oakland') {
    ORIGINAL_FOH.forEach((p) => staff.push({ ...p }));
    const sales = split(OAK_REST.sales, OAK_REST.n, rand, 0.3);
    const pv = split(OAK_REST.postVoid, OAK_REST.n, rand, 0.25);
    const co = split(OAK_REST.comps, OAK_REST.n, rand, 0.25);
    const di = split(OAK_REST.disc, OAK_REST.n, rand, 0.25);
    for (let i = 0; i < OAK_REST.n; i++) staff.push({ name: nameGen(rand, used), role: i < 8 ? 'Server' : 'Bartender', sales: sales[i], postVoid: pv[i], comps: co[i], disc: di[i] });
  } else {
    const n = plan.servers + plan.bartenders;
    const sales = split(foh4wk.sales, n, rand, 0.3);
    const pv = split(foh4wk.postVoid, n, rand, 0.25);
    const co = split(foh4wk.comps, n, rand, 0.25);
    const di = split(foh4wk.disc, n, rand, 0.25);
    for (let i = 0; i < n; i++) staff.push({ name: nameGen(rand, used), role: i < plan.servers ? 'Server' : 'Bartender', sales: sales[i], postVoid: pv[i], comps: co[i], disc: di[i] });
    if (roomId === 'walnut') {
      /* The bartender behind Walnut Creek's comp excursions: same person on 4 of 5. */
      const b = staff.find((s) => s.role === 'Bartender');
      b.name = 'Dani K.';
      const extra = 900;
      b.comps += extra;
      const others = staff.filter((s) => s !== b);
      const take = split(extra, others.length, rand, 0.1);
      others.forEach((s, i) => { s.comps = Math.max(10, s.comps - take[i]); });
    }
  }
  for (let i = 0; i < plan.hosts; i++) staff.push({ name: nameGen(rand, used), role: 'Host' });
  for (let i = 0; i < plan.bussers; i++) staff.push({ name: nameGen(rand, used), role: 'Busser' });
  plan.boh.forEach(([role, n]) => {
    for (let i = 0; i < n; i++) {
      let name = nameGen(rand, used);
      if (roomId === 'oakland' && role === 'Prep cook') name = i === 0 ? 'Ana B.' : 'Luis F.';
      staff.push({ name, role });
    }
  });
  /* Hours and rates, then scale hours so Σ hours × rate = the room's hourly labour exactly. */
  staff.forEach((s) => {
    s.rate = RATE[s.role];
    s.hours = r1(HOURS[s.role] * (1 + (rand() - 0.5) * 0.3));
    s.postVoid ??= 0; s.comps ??= 0; s.disc ??= 0; s.sales ??= 0;
  });
  const cost = staff.reduce((a, s) => a + s.hours * s.rate, 0);
  const k = labourTarget / cost;
  staff.forEach((s) => { s.hours = r2(s.hours * k); });
  const drift = labourTarget - staff.reduce((a, s) => a + s.hours * s.rate, 0);
  const last = staff[staff.length - 1];
  last.hours = +(last.hours + drift / last.rate).toFixed(4);
  const rename = (role, name, projected) => {
    const p = staff.find((x) => x.role === role && !x.renamed);
    if (p) { p.name = name; p.renamed = true; if (projected) p.projected = projected; }
  };
  if (roomId === 'berkeley') rename('Server', 'Theo S.', 43);
  if (roomId === 'walnut') rename('Line cook', 'Iris N.', 44);
  if (roomId === 'oakland') {
    const ana = staff.find((s) => s.name === 'Ana B.');
    ana.projected = 44; // tracking to 44 hours this week, the overtime the plan prevents
  }
  return staff;
}

/** Scale the un-overridden dishes so the balancing line lands near a $6 side. */
function fitVolumes(menu, gross, over) {
  const sides = menu.find((m) => m.balancing);
  const fixed = menu.filter((m) => !m.balancing && over[m.key]);
  const free = menu.filter((m) => !m.balancing && !over[m.key]);
  const want = gross - sides.units * 6 - fixed.reduce((s, m) => s + m.price * m.units, 0);
  const k = want / free.reduce((s, m) => s + m.price * m.units, 0);
  free.forEach((m) => { m.units = Math.max(4, Math.round(m.units * k)); });
}

/** Close menu sales and food cost to the room's week with the balancing line. */
function balanceMenu(menu, gross, food) {
  const sides = menu.find((m) => m.balancing);
  const rest = menu.filter((m) => !m.balancing);
  const sales = rest.reduce((s, m) => s + m.price * m.units, 0);
  const cost = rest.reduce((s, m) => s + m.cost * m.units, 0);
  sides.price = (gross - sales) / sides.units;
  sides.cost = (food - cost) / sides.units;
  return menu;
}

/* Per-room room-level exceptions (4 weeks) for generated staff. */
const FOH_4WK = {
  berkeley: { postVoid: 740, comps: 1880, disc: 2240 },
  walnut: { postVoid: 690, comps: 3120, disc: 2310 },
};

function buildHistory(roomId, rand, a, menuNow, excNow) {
  const g = a.growth;
  const last = seasonality(HISTORY_WEEKS[51]);
  const rows = HISTORY_WEEKS.map((w) => {
    const trend = Math.pow(1 + g, (w.i - 51) / 52);
    const noise = w.i === 51 ? 1 : 1 + gauss(rand) * 0.03;
    const net = Math.round((a.net * seasonality(w)) / last * trend * noise);
    const covers = Math.round(a.covers * (net / a.net) * (1 + gauss(rand) * 0.015));
    /* Oakland's food rate steps up after Bay Fish Co.'s increase (week of Sep 14). */
    const fr = a.foodRate + (roomId === 'oakland' && w.i < 46 ? -0.006 : 0) + gauss(rand) * 0.006;
    const lr = a.labourRate + (roomId === 'berkeley' && w.i >= 36 ? 0.008 : 0) + gauss(rand) * 0.008;
    return { ...w, net, covers, food: Math.round(net * fr), labour: Math.round(net * lr) };
  });
  const lw = rows[51];
  lw.net = a.net; lw.covers = a.covers; lw.food = a.food; lw.labour = a.labour;
  rows.forEach((r) => { r.earned = r.net - r.food - r.labour; });
  /* Matched weeks average to the room's stated comparison figure. */
  const mean = MATCHED_WEEKS.reduce((s, i) => s + rows[i].earned, 0) / MATCHED_WEEKS.length;
  const d = a.matchedEarned - mean;
  MATCHED_WEEKS.forEach((i) => { rows[i].labour -= d; rows[i].earned += d; });
  /* Weighted margin per item: flat, then Berkeley slides over the last 13 weeks. */
  rows.forEach((r) => {
    const slide = roomId === 'berkeley' ? Math.max(0, 51 - r.i) <= 13 ? (0.73 * (51 - r.i)) / 13 : 0.73 : 0;
    r.wcm = r2(menuNow + slide + gauss(rand) * 0.08 * (r.i === 51 ? 0 : 1));
    /* Register exceptions as a share of sales: steady around this week's level. */
    r.excPct = r2(excNow * (1 + gauss(rand) * 0.045) * (roomId === 'walnut' && r.i >= 49 ? 1.04 : 1));
  });
  return rows;
}

/* ------------------------------------------------------------------ hand-written room content */
const CONTENT = {
  oakland: {
    channels: [
      { k: 'dine', name: 'Dine-in', sales: 34180, avg: 64, fee: 0.029, pack: 0, refunds: 0 },
      { k: 'take', name: 'Takeout', sales: 3940, avg: 38, fee: 0.029, pack: 0.9, refunds: 12 },
      { k: 'dd', name: 'DoorDash', sales: 2610, avg: 41, fee: 0.25, pack: 1.1, refunds: 96 },
      { k: 'ue', name: 'Uber Eats', sales: 890, avg: 43, fee: 0.3, pack: 1.1, refunds: 38 },
    ],
    /* Opening count, received, closing count over the last 28 days, per SKU (count units). */
    counts: [
      { item: 'Salmon fillet', unit: 'lb', open: 40, received: 388, close: 121, tol: 0.03, cat: 'Kitchen', cost: 13.65 },
      { item: 'Romaine hearts', unit: 'case', open: 2.5, received: 24, close: 3.4, tol: 0.03, cat: 'Kitchen', cost: 49.29 },
      { item: 'Ribeye, choice', unit: 'lb', open: 22, received: 289, close: 48, tol: 0.03, cat: 'Kitchen', cost: 14.64 },
      { item: 'Chicken, whole', unit: 'lb', open: 70, received: 660, close: 58, tol: 0.03, cat: 'Kitchen', cost: 3.15 },
      { item: 'Ground chuck', unit: 'lb', open: 36, received: 334, close: 64, tol: 0.03, cat: 'Kitchen', cost: 4.6 },
      { item: 'Shrimp, 16/20', unit: 'lb', open: 8, received: 75, close: 22, tol: 0.03, cat: 'Kitchen', cost: 10.4 },
      { item: 'Cod fillet', unit: 'lb', open: 10, received: 112, close: 12, tol: 0.03, cat: 'Kitchen', cost: 9.6 },
      { item: 'Mozzarella, fresh', unit: 'lb', open: 44, received: 122, close: 6, tol: 0.03, cat: 'Kitchen', cost: 6.9 },
      { item: 'House red (oz)', unit: 'oz', open: 1520, received: 4720, close: 910, tol: 0.04, cat: 'Bar', cost: 3.92 / 6, label: 'House red' },
      { item: 'Bourbon (oz)', unit: 'oz', open: 340, received: 1180, close: 418, tol: 0.04, cat: 'Bar', cost: 1.3, label: 'Bourbon' },
    ],
    waste: [],
    tickets: { target: 14, fri: [11.2, 13.1, 17.6, 18.4, 14.0, 10.8], sat: [11.8, 13.9, 18.9, 19.6, 15.2, 11.1], stations: [['Grill', 58], ['Sauté', 21], ['Fry', 9], ['Garde manger', 7], ['Pizza', 5]], friLunch: 14, bottleneck: 'Grill',
      manager: 'Saturday at 8 the grill is the bottleneck. Tickets wait almost 20 minutes there while sauté has room. Nobody\'s slow on purpose; the salmon and the ribeye both land on one station.',
      fix: 'Move the salmon to sauté on Friday and Saturday from 7 to 9 pm, and pre-fire ribeye sides when the ticket prints.' },
    labour: {
      kpis: { idle: 11, short: 37, rate: 5.29 },
      note: 'The old engine assumed 14 covers per server-hour. This room has never done better than 5.29. Measured properly, Oakland isn\'t 137 hours idle. It\'s 11 hours idle and 37 hours short, mostly on Friday and Saturday nights.',
      tue: { label: 'Tuesday dinner', hours: ['4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm'], sched: [3, 5, 5, 5, 5, 4], need: [2, 3, 4, 5, 4, 2], covers: [6, 14, 22, 26, 18, 9] },
      sat: { label: 'Saturday dinner', hours: ['4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm'], sched: [4, 6, 7, 7, 7, 6], need: [3, 6, 8, 9, 8, 5], covers: [12, 30, 41, 46, 40, 24] },
      draft: { approval: 'draft-schedule', note: 'This draft adds one hour net. It costs $18.50 more and puts a server back on Saturday\'s peak, where slow turns cost you covers.' },
    },
    throughput: { constrained: [['Mon', 0, 0], ['Tue', 0, 0], ['Wed', 0, 0], ['Thu', 0, 0], ['Fri', 0, 6], ['Sat', 0, 25], ['Sun', 0, 0]], intervals: 5, total: 224, seatUse: 31, bestWorst: 4.3, ceiling: 1047,
      fullNote: 'The room was full for five 15-minute intervals all week: four on Saturday 7–8 pm and one on Friday at 7:30.', oldClaim: 26157 },
    service: {
      day: 'Tuesday dinner', mode: 'cut', pace: -22,
      comp: [3, 4, 5, 6, 7, 8, 8, 9, 9, 8, 7, 6, 5, 4, 4, 3, 2, 2, 1, 1], actual: [3, 3, 4, 5, 5, 6, 6, 7, 7], now: 9, factor: 0.78,
      title: 'Cut one server at 8:00', body: 'Even at the top of the band, four servers cover 8–10 pm.', yes: 'Yes, cut Jess at 8', approval: 'tue-cut', value: 37,
      tiles: [['Ticket time', '14 min', 'line 16'], ['Turn time', '47 min', 'guard 52'], ['Servers on', '5', 'need 4']],
    },
    queue: [
      { id: 'cut', when: 'staff:Jess M.', tone: 'accent', icon: 'UserMinus', title: 'Approve: cut one server at 8:00 tonight', mins: 2, claim: 'obs', value: '$37 tonight', body: 'Covers are pacing 22% under a comparable Tuesday, and the band has narrowed enough to act.', primary: 'Review', approval: 'tue-cut' },
      { id: 'recipes', when: 'stale:Recipe costs', tone: 'warn', icon: 'FileSpreadsheet', title: 'Upload this week\'s recipe costs', mins: 5, claim: 'none', value: 'Unblocks 2 actions', body: 'Recipe costs are 18 days old. Two of this week\'s three chosen actions need them, and the salmon test is quarantined until they arrive.', primary: 'Upload CSV', go: 'inputs', input: 'recipes' },
      { id: '7shifts', tone: 'bad', icon: 'PlugZap', title: 'Reconnect 7shifts', mins: 1, claim: 'none', value: 'Protects the Tuesday test', body: 'The access token went stale 18 hours ago. Labour verification is degraded until it\'s reconnected.', primary: 'Reconnect' },
      { id: 'salmon', when: 'cand:salmon', tone: '', icon: 'Fish', title: 'Decide on the salmon price', mins: 4, claim: 'mod', value: '{salmonWk}', body: '$28 to $30. You\'d sell about {salmonLost} fewer a week, and each one left earns $2 more.', primary: 'Open simulator', go: 'menu', refuse: true },
      { id: 'ot', when: 'staff:Ana B.', tone: 'good', icon: 'CalendarClock', title: 'Move 4 hours off Ana\'s week before Thursday', mins: 1, claim: 'obs', value: '$44 prevented', body: 'Ana is tracking to 44 hours. Moving 4 to Luis avoids the overtime premium. Prevented cost is never counted as saved.', primary: 'Apply' },
      { id: 'count', when: 'flagged', tone: '', icon: 'ClipboardList', title: 'Spot-count {flaggedList}', mins: 15, claim: 'est', value: 'Separates waste from portions', body: '{flaggedLead} past tolerance on theoretical vs actual usage. A count this week tells us whether it\'s portions, waste or something rung in wrong.', primary: 'Enter the count', go: 'inputs', input: 'counts' },
    ],
    alarms: [],
    banked: { note: 'Thursday prep now starts at 8:00, and it has held for 18 weeks. Nothing new verified this week, and nothing reversed.', from: 'from one change that is holding' },
    meeting: [
      { k: 'What banked', mins: 2, icon: 'BadgeCheck', body: '{banked} at {room} from Thursday prep, week 18 and holding. Walnut Creek\'s Tuesday close added $382. Nothing new verified, nothing reversed.', go: 'ledger' },
      { k: 'What alarmed', mins: 3, icon: 'Siren', body: 'Nothing at {room}. Walnut Creek bar comps crossed the control limit on the Saturday Oct 17 close. Same bartender on 4 of 5 excursions. Accrual on the comp reset is paused.', go: 'proof' },
      { k: 'In flight', mins: 3, icon: 'Timer', body: 'Tuesday dinner with five servers: checkpoint 1 of 2 passed, turn time 47 min against the 52-minute guard. Window closes Nov 3. Monday prep pars test opened Oct 19.', go: 'proof' },
      { k: 'One decision', when: 'cand:salmon', mins: 5, icon: 'Gavel', body: 'Raise the salmon from $28 to $30? About {salmonWk}, 61% chance it verifies. It needs current recipe costs first.', decision: ['Approve $30 after recipes upload', 'Hold for two weeks', 'Not for us'] },
      { k: 'Commit this week\'s plan', mins: 2, icon: 'Route', body: '{planCount} actions fit 2 manager-hours: {planList}.', go: 'plan' },
    ],
    areas: {
      labour: ['verify', 'Thursday prep verified; Tuesday dinner in testing'], demand: ['act', 'Cut one server at 8, ready on the phone'], menu: ['act', 'Salmon, ribeye and carbonara ranked'],
      purchasing: ['act', 'Two vendor calls drafted'], inventory: ['detect', 'Salmon and romaine flagged; needs a spot count'], bar: ['detect', 'House red over-pouring'],
      kitchen: ['understand', 'Grill bottleneck Fri and Sat 7–9 pm'], foh: ['understand', 'Ceiling {ceiling}/mo; needs the waitlist'], controls: ['act', 'One server above her limit'],
      channels: ['act', '10% delivery markup ready to review'],
    },
    feeds: { '7shifts': ['stale', '18 hours ago', 370, 'The access token expired. Labour verification is degraded, which puts the Tuesday dinner test at risk.'], 'Recipe costs': ['stale', '18 days ago', 'salmon', 'Too old to price the salmon from. The plate-cost test is quarantined and the salmon price move can\'t verify.'], 'Kitchen display': ['partial', '1 hour ago', 0, 'Exporting hourly averages by station, not each ticket. Ticket-time changes can be estimated, not measured.'] },
    autonomy: { Labour: [2, 3], Menu: [1, 1], Purchasing: [1, 2], Controls: [1, 1], Throughput: [0, 0] },
    managerHours: 2, bankedPerHour: 48,
  },
  berkeley: {
    channels: [
      { k: 'dine', name: 'Dine-in', sales: 23900, avg: 52, fee: 0.029, pack: 0, refunds: 0 },
      { k: 'take', name: 'Takeout', sales: 3880, avg: 34, fee: 0.029, pack: 0.9, refunds: 18 },
      { k: 'dd', name: 'DoorDash', sales: 4150, avg: 38, fee: 0.25, pack: 1.1, refunds: 162 },
      { k: 'ue', name: 'Uber Eats', sales: 1250, avg: 39, fee: 0.3, pack: 1.1, refunds: 58 },
    ],
    counts: [
      { item: 'Salmon fillet', unit: 'lb', open: 30, received: 0, close: 26, tol: 0.03, cat: 'Kitchen', gap: 0.022 },
      { item: 'Romaine hearts', unit: 'case', open: 2, received: 0, close: 2.1, tol: 0.03, cat: 'Kitchen', gap: 0.026 },
      { item: 'Ribeye, choice', unit: 'lb', open: 14, received: 0, close: 20, tol: 0.03, cat: 'Kitchen', gap: 0.019 },
      { item: 'Chicken, whole', unit: 'lb', open: 60, received: 0, close: 52, tol: 0.03, cat: 'Kitchen', gap: 0.012 },
      { item: 'Ground chuck', unit: 'lb', open: 40, received: 0, close: 38, tol: 0.03, cat: 'Kitchen', gap: 0.071 },
      { item: 'Shrimp, 16/20', unit: 'lb', open: 6, received: 0, close: 9, tol: 0.03, cat: 'Kitchen', gap: 0.015 },
      { item: 'Cod fillet', unit: 'lb', open: 9, received: 0, close: 8, tol: 0.03, cat: 'Kitchen', gap: 0.024 },
      { item: 'Mozzarella, fresh', unit: 'lb', open: 12, received: 0, close: 6, tol: 0.03, cat: 'Kitchen', gap: 0.054 },
      { item: 'House red (oz)', unit: 'oz', open: 1100, received: 0, close: 760, tol: 0.04, cat: 'Bar', gap: 0.031, label: 'House red', cost: 3.92 / 6 },
      { item: 'Bourbon (oz)', unit: 'oz', open: 220, received: 0, close: 260, tol: 0.04, cat: 'Bar', gap: 0.028, label: 'Bourbon', cost: 1.3 },
    ],
    waste: [],
    tickets: { target: 14, fri: [12.4, 15.2, 18.8, 19.4, 16.1, 12.0], sat: [12.9, 15.8, 19.2, 20.3, 16.8, 12.6], stations: [['Expo', 41], ['Grill', 27], ['Fry', 17], ['Pizza', 9], ['Garde manger', 6]], friLunch: 19, bottleneck: 'Expo',
      manager: 'Food is coming up on time; it\'s waiting at the pass. Expo is where 41% of late tickets sit on Friday and Saturday nights, mostly delivery bags waiting to be checked while dine-in plates die under the lamp.',
      fix: 'Give delivery its own bag-check station from 6 to 9 pm on weekends, so expo only runs the dining room.' },
    labour: {
      kpis: { idle: 19, short: 22, rate: 4.88 },
      note: 'Berkeley runs 27.9% labour, the highest of the three rooms, on the lowest sales. It\'s 19 hours idle, mostly weekday lunches, and 22 hours short on Friday and Saturday nights. Friday cuts are off the table after August\'s reversal.',
      tue: { label: 'Tuesday dinner', hours: ['4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm'], sched: [3, 4, 5, 5, 4, 3], need: [2, 3, 4, 4, 3, 2], covers: [5, 11, 18, 21, 14, 7] },
      sat: { label: 'Saturday dinner', hours: ['4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm'], sched: [3, 5, 6, 6, 6, 5], need: [3, 5, 7, 8, 7, 4], covers: [10, 24, 34, 39, 33, 19] },
      draft: { approval: 'bk-draft', note: 'This draft moves 6 weekday-lunch hours onto Saturday 6–9 pm. Net hours don\'t change, so neither does cost; it puts people where the room is short.' },
    },
    throughput: { constrained: [['Mon', 0, 0], ['Tue', 0, 0], ['Wed', 0, 0], ['Thu', 0, 3], ['Fri', 4, 22], ['Sat', 0, 31], ['Sun', 6, 0]], intervals: 9, total: 224, seatUse: 38, bestWorst: 3.6, ceiling: 1380,
      fullNote: 'The room was full for nine 15-minute intervals: Friday and Saturday nights, plus Friday and Sunday lunch, when the campus crowd lands at once.', oldClaim: 19840 },
    service: {
      day: 'Tuesday dinner', mode: 'quiet', pace: 6,
      comp: [2, 3, 4, 5, 6, 6, 7, 7, 6, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1], actual: [2, 3, 5, 5, 6, 7, 7, 8, 7], now: 9, factor: 1.06,
      title: 'Nothing to do tonight', body: 'Covers are 6% over a comparable Tuesday and inside the band. Four servers is right. The phone stays silent.',
      tiles: [['Ticket time', '15 min', 'line 16'], ['Turn time', '49 min', 'guard 52'], ['Servers on', '4', 'need 4']],
    },
    queue: [
      { id: 'kds', tone: 'bad', icon: 'MonitorCog', title: 'Fix the kitchen display export', mins: 5, claim: 'none', value: 'Unblocks the expo retest', body: 'The KDS has exported nothing for 6 days. The expo coaching test came back inconclusive for lack of data, and it can\'t be re-run until ticket times flow again.', primary: 'Fix export', go: 'sources' },
      { id: 'mix', when: 'cand:bk-mix', tone: 'accent', icon: 'LayoutList', title: 'Review: move the burger and chicken up the menu', mins: 4, claim: 'mod', value: '{bk-mix}', body: 'Weighted margin per dish slid {wcmSlide} in 13 weeks while plate costs held. Guests are drifting to lower-earning dishes; placement is the lever, not price.', primary: 'See the menu', go: 'menu' },
      { id: 'delivery', tone: '', icon: 'Bike', title: 'Decide on a delivery markup', mins: 3, claim: 'est', value: '{markupRange}', body: 'Delivery is {deliveryShare} of Berkeley\'s sales and keeps about half what dine-in does. A 10% markup is a test, not a sure thing.', primary: 'Review', go: 'channels' },
      { id: 'ot', when: 'staff:Theo S.', tone: 'good', icon: 'CalendarClock', title: 'Move 3 hours off Theo\'s week before Saturday', mins: 1, claim: 'obs', value: '$33 prevented', body: 'Theo is tracking to 43 hours. Moving 3 to a weekday server avoids the overtime premium. Prevented, never saved.', primary: 'Apply' },
      { id: 'refunds', tone: 'warn', icon: 'PackageX', title: 'Add a bag check for delivery orders', mins: 2, claim: 'obs', value: '{refunds}/wk in refunds', body: 'Missing-item refunds on DoorDash and Uber Eats are the highest in the group. Most start on orders with modifiers.', primary: 'Add to expo checklist' },
    ],
    alarms: [],
    banked: { note: 'Nothing is banked at Berkeley. The Friday server cut was reversed back to Aug 3 when turn times breached the guard, and the expo coaching test was underpowered. Both stay on the record.', from: 'nothing verified and holding' },
    meeting: [
      { k: 'What banked', mins: 2, icon: 'BadgeCheck', body: 'Nothing at {room} yet. The Friday server cut reversed in August and its $555 left every figure. That\'s the system working, not failing.', go: 'ledger' },
      { k: 'What alarmed', mins: 3, icon: 'Siren', body: 'Nothing crossed a limit at {room}. Delivery refunds are high but steady, so they\'re a fix, not an alarm.', go: 'channels' },
      { k: 'In flight', mins: 3, icon: 'Timer', body: 'Monday lunch with one server fewer: week 2 of 4. The menu-placement test starts once the new menu cards print.', go: 'proof' },
      { k: 'One decision', when: 'cand:bk-mix', mins: 5, icon: 'Gavel', body: 'Move the burger and half chicken to the top of the menu? About {bk-mix}, 50% chance it verifies. Costs one menu reprint.', decision: ['Reprint the menu this week', 'Try table cards first', 'Not for us'] },
      { k: 'Commit this week\'s plan', mins: 2, icon: 'Route', body: '{planCount} actions fit 2 manager-hours: {planList}.', go: 'plan' },
    ],
    areas: {
      labour: ['act', 'Friday cut reversed; Monday lunch in testing'], demand: ['understand', 'Pacing inside the band tonight; nothing to do'], menu: ['act', 'Mix slide; placement move ranked'],
      purchasing: ['act', 'Same vendor rises as the group'], inventory: ['detect', 'Ground chuck and mozzarella flagged'], bar: ['detect', 'Pours inside tolerance'],
      kitchen: ['detect', 'Expo backs up; KDS export broken'], foh: ['understand', 'Ceiling {ceiling}/mo; needs the waitlist'], controls: ['understand', 'Everyone inside their limits'],
      channels: ['act', 'Highest delivery share in the group'],
    },
    feeds: { 'Kitchen display': ['stale', '6 days ago', 0, 'No export since Oct 21. Ticket times and the expo retest are blocked.'], 'Recipe costs': ['healthy', '4 days ago', 0, null], '7shifts': ['healthy', '1 hour ago', 0, null] },
    autonomy: { Labour: [1, 1], Menu: [1, 1], Purchasing: [1, 1], Controls: [1, 1], Throughput: [0, 0] },
    managerHours: 2, bankedPerHour: 0,
  },
  walnut: {
    channels: [
      { k: 'dine', name: 'Dine-in', sales: 31200, avg: 61, fee: 0.029, pack: 0, refunds: 0 },
      { k: 'take', name: 'Takeout', sales: 3100, avg: 36, fee: 0.029, pack: 0.9, refunds: 9 },
      { k: 'dd', name: 'DoorDash', sales: 2250, avg: 42, fee: 0.25, pack: 1.1, refunds: 71 },
      { k: 'ue', name: 'Uber Eats', sales: 800, avg: 44, fee: 0.3, pack: 1.1, refunds: 26 },
    ],
    counts: [
      { item: 'Salmon fillet', unit: 'lb', open: 34, received: 0, close: 30, tol: 0.03, cat: 'Kitchen', gap: 0.018 },
      { item: 'Romaine hearts', unit: 'case', open: 2, received: 0, close: 2.4, tol: 0.03, cat: 'Kitchen', gap: 0.021 },
      { item: 'Ribeye, choice', unit: 'lb', open: 18, received: 0, close: 26, tol: 0.03, cat: 'Kitchen', gap: 0.024 },
      { item: 'Chicken, whole', unit: 'lb', open: 62, received: 0, close: 49, tol: 0.03, cat: 'Kitchen', gap: 0.016 },
      { item: 'Ground chuck', unit: 'lb', open: 34, received: 0, close: 40, tol: 0.03, cat: 'Kitchen', gap: 0.02 },
      { item: 'Turkey breast', unit: 'lb', open: 10, received: 0, close: 7, tol: 0.03, cat: 'Kitchen', gap: 0.062 },
      { item: 'Eggs, large', unit: 'case', open: 1.5, received: 0, close: 1.2, tol: 0.03, cat: 'Kitchen', gap: 0.027 },
      { item: 'Mozzarella, fresh', unit: 'lb', open: 12, received: 0, close: 10, tol: 0.03, cat: 'Kitchen', gap: 0.019 },
      { item: 'House red (oz)', unit: 'oz', open: 1400, received: 0, close: 980, tol: 0.04, cat: 'Bar', gap: 0.036, label: 'House red', cost: 3.92 / 6 },
      { item: 'Bourbon (oz)', unit: 'oz', open: 380, received: 0, close: 300, tol: 0.04, cat: 'Bar', gap: 0.094, label: 'Bourbon', cost: 1.3 },
    ],
    waste: [],
    tickets: { target: 14, fri: [10.9, 12.8, 15.1, 15.9, 13.2, 10.4], sat: [11.2, 13.4, 16.0, 16.4, 13.8, 10.9], stations: [['Grill', 36], ['Sauté', 30], ['Fry', 14], ['Garde manger', 12], ['Pizza', 8]], friLunch: 15, bottleneck: 'Grill',
      manager: 'Weekend dinner runs a couple of minutes over at the peak, split between grill and sauté. It\'s close to target and the room is rarely full, so there\'s no money in it yet.',
      fix: 'Nothing this week. Re-check after the brunch staffing change, which moves one line cook earlier on Sundays.' },
    labour: {
      kpis: { idle: 8, short: 14, rate: 5.61 },
      note: 'Walnut Creek has the leanest labour in the group at 24.1%, after the Tuesday close change verified in August. The short hours are Sunday brunch, when the line is two cooks light for the first ninety minutes.',
      tue: { label: 'Tuesday dinner', hours: ['4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm'], sched: [2, 4, 4, 5, 4, 3], need: [2, 3, 4, 4, 4, 2], covers: [6, 12, 20, 23, 17, 8] },
      sat: { label: 'Saturday dinner', hours: ['4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm'], sched: [3, 5, 7, 7, 6, 5], need: [3, 5, 7, 8, 7, 4], covers: [11, 27, 38, 42, 36, 21] },
      draft: { approval: 'wc-draft', note: 'This draft starts one line cook and one server 30 minutes earlier on Sunday. One hour net, $22 more, aimed at brunch tickets that run long in the first wave.' },
    },
    throughput: { constrained: [['Mon', 0, 0], ['Tue', 0, 0], ['Wed', 0, 0], ['Thu', 0, 0], ['Fri', 0, 3], ['Sat', 8, 9], ['Sun', 19, 0]], intervals: 4, total: 252, seatUse: 27, bestWorst: 5.1, ceiling: 820,
      fullNote: 'The room was full for four 15-minute intervals: Sunday brunch at 11 and Saturday at 7:30.', oldClaim: 21410 },
    service: {
      day: 'Tuesday dinner', mode: 'wait', pace: -15,
      comp: [3, 4, 5, 6, 7, 7, 8, 8, 8, 7, 6, 5, 5, 4, 3, 3, 2, 2, 1, 1], actual: [3, 3, 4, 5, 6, 6, 6, 7, 6], now: 9, factor: 0.85,
      title: 'Watching, not acting yet', body: 'Covers are 15% under a comparable Tuesday, but the band is still too wide: at its top, five servers are needed. We\'ll check again at 7:45.',
      tiles: [['Ticket time', '13 min', 'line 16'], ['Turn time', '45 min', 'guard 52'], ['Servers on', '5', 'need 4–5']],
    },
    queue: [
      { id: 'comps', when: 'signal:comps', tone: 'bad', icon: 'Siren', title: 'Talk to the bar about comps', mins: 10, claim: 'obs', value: '{compsExcess} over limit, 28 days', body: 'Bar comps crossed the control limit on the Oct 17 close. Dani K. was on 4 of the 5 excursions. The comp reset\'s accrual is paused until comps are back inside.', primary: 'See the numbers', go: 'controls' },
      { id: 'pour', when: 'flag:Bourbon (oz)', tone: 'accent', icon: 'Wine', title: 'Approve measured pours on bourbon', mins: 2, claim: 'est', value: 'Bourbon gap {bourbonGap}', body: 'Bourbon usage is {bourbonGap} over what the Old Fashioneds sold need, past the 4% tolerance. Measured pour spouts are a 6-week test.', primary: 'Review', go: 'inventory' },
      { id: 'brunch', when: 'cand:wc-brunch', tone: '', icon: 'Sunrise', title: 'Publish the Sunday brunch schedule', mins: 2, claim: 'mod', value: '{wc-brunch}', body: 'One line cook and one server 30 minutes earlier on Sunday. Brunch\'s first wave is two cooks short.', primary: 'Review', approval: 'wc-draft' },
      { id: 'ot', when: 'staff:Iris N.', tone: 'good', icon: 'CalendarClock', title: 'Move 4 hours off Iris\'s week before Sunday', mins: 1, claim: 'obs', value: '$51 prevented', body: 'Iris is tracking to 44 hours. Moving 4 to a weekday cook avoids the overtime premium. Prevented, never saved.', primary: 'Apply' },
    ],
    alarms: [{ when: 'signal:comps', title: 'Bar comps crossed the control limit', body: 'Started on the Saturday Oct 17 close. The comp policy reset from September is drifting, so accrual on it pauses until it\'s back inside the limit.', go: 'controls' }],
    banked: { note: 'The Tuesday close change has held for 9 weeks. The comp reset verified at $88 a week but is paused: comps crossed their limit on Oct 17, and nothing accrues while a guardrail is amber.', from: 'from one change holding, one paused' },
    meeting: [
      { k: 'What banked', mins: 2, icon: 'BadgeCheck', body: '{banked} at {room} from the Tuesday close, week 9. The comp reset\'s $88 is paused this week.', go: 'ledger' },
      { k: 'What alarmed', when: 'signal:comps', alt: 'Nothing crossed a control limit this week.', mins: 3, icon: 'Siren', body: 'Bar comps crossed the control limit on the Oct 17 close. Dani K. on 4 of 5 excursions. A conversation, not an accusation.', go: 'controls' },
      { k: 'In flight', mins: 3, icon: 'Timer', body: 'Measured pours on well spirits: week 1 of 6. Club sandwich portion trim closed directional, no claim.', go: 'proof' },
      { k: 'One decision', when: 'cand:wc-benedict', mins: 5, icon: 'Gavel', body: 'Raise the crab benedict from $24 to $26? About {wc-benedict}, 60% chance it verifies. Brunch demand barely moves with price here.', decision: ['Approve $26', 'Hold until after the holidays', 'Not for us'] },
      { k: 'Commit this week\'s plan', mins: 2, icon: 'Route', body: '{planCount} actions fit 2 manager-hours: {planList}.', go: 'plan' },
    ],
    areas: {
      labour: ['verify', 'Tuesday close verified; brunch staffing ranked'], demand: ['understand', 'Watching tonight; band still too wide'], menu: ['act', 'Benedict and club price moves ranked'],
      purchasing: ['act', 'Same vendor rises as the group'], inventory: ['detect', 'Turkey breast over; needs a count'], bar: ['act', 'Bourbon 9% over; pour spouts in test'],
      kitchen: ['understand', 'Near target; nothing to claim'], foh: ['understand', 'Brunch is the only full room'], controls: ['verify', 'Comp reset verified, now paused'],
      channels: ['understand', 'Smallest delivery share; low priority'],
    },
    feeds: { '7shifts': ['healthy', '40 min ago', 0, null], 'Recipe costs': ['healthy', '2 days ago', 0, null], 'Kitchen display': ['healthy', '3 min ago', 0, null], Waitlist: ['partial', 'Sundays only', 0, 'Connected for brunch reservations only. Weeknight walk-ins aren\'t captured.'] },
    autonomy: { Labour: [3, 3], Menu: [1, 1], Purchasing: [1, 2], Controls: [2, 2], Throughput: [0, 1] },
    managerHours: 2, bankedPerHour: 71,
  },
};

/* ------------------------------------------------------------------ plan candidates
   Specs, valued by the model from the room's own data. kind 'price' values a
   price move on the menu; 'vendor' wins back 60% of the named SKUs' price
   leg; 'usage' is the weekly cost of named SKUs' unexplained gap; 'voids' is
   the weekly post-send excess; 'comps' the weekly comp excess; 'markup' is
   the delivery markup range; 'fixed' carries its own numbers. */
const CANDIDATES = {
  oakland: [
    { id: 'ribeye', kind: 'price', item: 'ribeye', to: 44, lever: 'Menu', p: 0.58, persist: 'structural', hours: 0.5, claim: 'mod', why: 'Demand for the ribeye barely moves with price here (elasticity {e}). The old engine valued this at $0.' },
    { id: 'salmon', kind: 'price', item: 'salmon', to: 30, lever: 'Menu', p: 0.61, persist: 'structural', hours: 0.5, claim: 'mod', needs: 'recipes', why: 'Food cost on the salmon is {fc} since Bay Fish Co. raised prices. At {to} you\'d sell about {lost} fewer a week, and each one left earns {step} more. Needs current recipe costs to verify.' },
    { id: 'vendor', kind: 'vendor', skus: ['Salmon fillet', 'Romaine hearts'], title: 'Renegotiate salmon and romaine', lever: 'Purchasing', p: 0.85, persist: 'holds', hours: 1.0, claim: 'obs', why: 'Bay Fish Co. raised salmon {pct0} and Valley Greens raised romaine {pct1}. Winning back 60% of that is typical.' },
    { id: 'satpeak', kind: 'fixed', title: 'Add one server back, Saturday 6–9 pm', lever: 'Labour', value: 58, lo: 21, hi: 96, p: 0.55, persist: 'upkeep', hours: 0.25, claim: 'mod', why: 'Saturday\'s peak is understaffed by 4 server-hours. Turns slow and covers walk.' },
    { id: 'ot', who: 'Ana B.', kind: 'fixed', title: 'Move 4 hours off Ana\'s week before Thursday', lever: 'Labour', value: 44, lo: 44, hi: 44, p: 0.95, persist: 'week', hours: 0.25, claim: 'obs', prevent: true, why: 'Ana is tracking to 44 hours. Moving 4 to Luis avoids $44 of overtime premium. This is prevented cost, so it is never counted as saved.' },
    { id: 'carb', kind: 'price', item: 'carbonara', to: 22, lever: 'Menu', p: 0.52, persist: 'structural', hours: 0.5, claim: 'mod', why: 'Smaller lift and a looser elasticity estimate. Worth doing once the two bigger price moves have read out.' },
    { id: 'shoulder', kind: 'fixed', title: 'Trim Wednesday 3–5 pm by one server', lever: 'Labour', value: 38, lo: 4, hi: 71, p: 0.66, persist: 'upkeep', hours: 0.5, claim: 'mod', why: 'Two idle server-hours most Wednesdays between lunch and dinner.' },
    { id: 'paystage', kind: 'fixed', title: 'Speed up the Friday pay stage', lever: 'Throughput', value: 0, lo: 0, hi: 0, p: 0, persist: 'structural', hours: 1.0, claim: 'obs', why: 'The room is full for 1 interval on Friday. A faster turn there seats nobody new, so it is worth $0.' },
    { id: 'voids', kind: 'voids', title: 'Reason code on post-send voids', lever: 'Controls', p: 0.5, persist: 'upkeep', hours: 0.5, claim: 'obs', why: 'One server\'s post-send voids run well above her limit. A manager PIN and reason code usually settles the rate inside a month.' },
    { id: 'spotcount', kind: 'usage', skus: ['Salmon fillet', 'Romaine hearts'], title: 'Spot-count and portion salmon and romaine', lever: 'Inventory', p: 0.45, persist: 'holds', hours: 0.5, claim: 'est', why: 'Both are past tolerance on theoretical vs actual usage. A count separates portions from waste; a scale on the grill fixes portions.' },
    { id: 'delivery', kind: 'markup', title: 'Raise delivery prices 10%', lever: 'Channels', p: 0.4, persist: 'structural', hours: 0.5, claim: 'est', why: 'Delivery charges dine-in prices on a channel that keeps far less. No delivery price has moved here, so the range is wide and only a test can narrow it.' },
    { id: 'grill', kind: 'fixed', title: 'Move the salmon to sauté on weekend nights', lever: 'Kitchen', value: 0, lo: 0, hi: 0, p: 0, persist: 'structural', hours: 0.5, claim: 'obs', why: 'The grill is the bottleneck at the same hours the room is full. Without a waitlist, faster tickets there can\'t be shown to seat anyone new.' },
  ],
  berkeley: [
    { id: 'bk-mix', kind: 'fixed', title: 'Move the burger and half chicken to the top of the menu', lever: 'Menu', value: 132, lo: 38, hi: 224, p: 0.5, persist: 'structural', hours: 0.5, claim: 'mod', why: 'Weighted margin per dish slid in 13 weeks while plate costs held: a mix problem. The burger and chicken earn the most per minute of kitchen time and sit at the bottom of the card.' },
    { id: 'bk-ribeye', kind: 'price', item: 'ribeye', to: 42, lever: 'Menu', p: 0.55, persist: 'structural', hours: 0.5, claim: 'mod', why: 'Berkeley\'s ribeye demand is nearly as insensitive to price as Oakland\'s (elasticity {e}), and it\'s priced $2 lower.' },
    { id: 'bk-salmon', kind: 'price', item: 'salmon', to: 29, lever: 'Menu', p: 0.5, persist: 'structural', hours: 0.5, claim: 'mod', needs: 'recipes', why: 'Same Bay Fish Co. increase as Oakland; salmon food cost is {fc} at {from}.' },
    { id: 'bk-vendor', kind: 'vendor', skus: ['Salmon fillet', 'Romaine hearts'], title: 'Renegotiate salmon and romaine (group contract)', lever: 'Purchasing', p: 0.8, persist: 'holds', hours: 0.75, claim: 'obs', why: 'Berkeley buys on the group contract, so the same two increases hit here: salmon {pct0}, romaine {pct1}.' },
    { id: 'bk-lunch', kind: 'fixed', title: 'Trim Monday and Tuesday lunch by one server', lever: 'Labour', value: 46, lo: 12, hi: 80, p: 0.6, persist: 'upkeep', hours: 0.25, claim: 'mod', why: 'Weekday lunch averages 2.1 covers per server-hour, the lowest service in the group.' },
    { id: 'bk-ot', who: 'Theo S.', kind: 'fixed', title: 'Move 3 hours off Theo\'s week before Saturday', lever: 'Labour', value: 33, lo: 33, hi: 33, p: 0.95, persist: 'week', hours: 0.25, claim: 'obs', prevent: true, why: 'Theo is tracking to 43 hours. Prevented cost, never counted as saved.' },
    { id: 'bk-delivery', kind: 'markup', title: 'Raise delivery prices 10%', lever: 'Channels', p: 0.45, persist: 'structural', hours: 0.5, claim: 'est', why: 'Delivery is the biggest share of sales in the group here. A markup is the most valuable channel test in the group, and the least certain.' },
    { id: 'bk-chuck', kind: 'usage', skus: ['Ground chuck', 'Mozzarella, fresh'], title: 'Portion burgers and pizza cheese', lever: 'Inventory', p: 0.45, persist: 'holds', hours: 0.5, claim: 'est', why: 'Ground chuck and mozzarella are both past tolerance. Burger patties are hand-formed here; Oakland uses a press.' },
    { id: 'bk-expo', kind: 'fixed', title: 'Separate delivery bag check from expo', lever: 'Kitchen', value: 0, lo: 0, hi: 0, p: 0, persist: 'structural', hours: 0.5, claim: 'obs', why: 'Worth $0 until the kitchen display export is fixed, because nothing about ticket times can be measured right now.' },
  ],
  walnut: [
    { id: 'wc-comps', kind: 'comps', title: 'Coach the bar on the comp policy', lever: 'Controls', p: 0.7, persist: 'upkeep', hours: 0.25, claim: 'obs', why: 'Bar comps are over the control limit, with one bartender on 4 of 5 excursions. Getting back inside also restarts the paused $88 a week.' },
    { id: 'wc-benedict', kind: 'price', item: 'benedict', to: 26, lever: 'Menu', p: 0.6, persist: 'structural', hours: 0.5, claim: 'mod', why: 'Brunch demand barely moves with price here (elasticity {e}). The benedict is the best seller on Sunday.' },
    { id: 'wc-club', kind: 'price', item: 'club', to: 18, lever: 'Menu', p: 0.55, persist: 'structural', hours: 0.5, claim: 'mod', why: 'The club sells well at lunch and its demand is steady (elasticity {e}). The portion-trim test closed directional, so price is the cleaner move.' },
    { id: 'wc-vendor', kind: 'vendor', skus: ['Salmon fillet', 'Romaine hearts'], title: 'Renegotiate salmon and romaine (group contract)', lever: 'Purchasing', p: 0.8, persist: 'holds', hours: 0.75, claim: 'obs', why: 'Same group-contract increases as the other rooms: salmon {pct0}, romaine {pct1}.' },
    { id: 'wc-brunch', kind: 'fixed', title: 'Start Sunday brunch staff 30 minutes earlier', lever: 'Labour', value: 64, lo: 20, hi: 110, p: 0.62, persist: 'upkeep', hours: 0.5, claim: 'mod', why: 'The first brunch wave is two cooks short for ninety minutes. Long tickets there are the room\'s only full-room hours.' },
    { id: 'wc-ot', who: 'Iris N.', kind: 'fixed', title: 'Move 4 hours off Iris\'s week before Sunday', lever: 'Labour', value: 51, lo: 51, hi: 51, p: 0.95, persist: 'week', hours: 0.25, claim: 'obs', prevent: true, why: 'Iris is tracking to 44 hours. Prevented cost, never counted as saved.' },
    { id: 'wc-pours', kind: 'usage', skus: ['Bourbon (oz)', 'Turkey breast'], title: 'Measured pours on bourbon, portion the turkey', lever: 'Inventory', p: 0.5, persist: 'holds', hours: 0.5, claim: 'est', why: 'Bourbon is 9% over what the Old Fashioneds need, past the bar\'s 4% tolerance; turkey breast is over too.' },
    { id: 'wc-delivery', kind: 'markup', title: 'Raise delivery prices 10%', lever: 'Channels', p: 0.4, persist: 'structural', hours: 0.5, claim: 'est', why: 'Smallest delivery share in the group, so the smallest prize. Worth testing after the bigger moves read out.' },
    { id: 'wc-host', kind: 'fixed', title: 'Add a host for Sunday brunch, 10:30–12:30', lever: 'Throughput', value: 0, lo: 0, hi: 0, p: 0, persist: 'structural', hours: 0.5, claim: 'obs', why: 'Brunch is the only time the room is full, and the waitlist only captures reservations. Worth $0 until walk-ins are counted.' },
  ],
};

/* ------------------------------------------------------------------ verification packets (all rooms)
   ledger: [first ledger week index, last index or null for ongoing, weekly value]. */
const PROOF = [
  { id: 'thu-prep', loc: 'oakland', lever: 'Labour', title: 'Pull Thursday prep start back to 8:00', outcome: 'verified', bookable: 97, point: 112, lo: 97, hi: 127, since: 'Jun 22', held: '18 weeks', persist: 'Needs upkeep', method: 'Difference-in-differences vs 9 matched Thursdays', owner: 'Maria Reyes', ledger: [0, null, 97], accrualDays: 127, septDays: 30, q3Days: 92, octDays: 26 },
  { id: 'wc-close', loc: 'walnut', lever: 'Labour', title: 'Trim Tuesday close, back of house, by 6 hours', outcome: 'limited', bookable: 382, point: 445, lo: 382, hi: 508, since: 'Aug 24', held: '9 weeks', persist: 'Needs upkeep', method: 'Matched control services, 4-week window', limitation: 'Shorter window than policy (4 weeks, not 6)', owner: 'Priya Shah', ledger: [9, null, 382], accrualDays: 64, septDays: 30, q3Days: 38, octDays: 26 },
  { id: 'wc-comps', loc: 'walnut', lever: 'Controls', title: 'Reset the bar comp policy', outcome: 'verified', bookable: 88, point: 101, lo: 88, hi: 114, since: 'Sep 28', held: 'Paused Oct 19', paused: true, reason: 'Comps crossed the control limit on the Oct 17 close, so accrual is paused until they are back inside it.', persist: 'Needs upkeep', method: 'Control chart, 1 false alarm per quarter', owner: 'Priya Shah', ledger: [14, 16, 88], accrualDays: 21, septDays: 3, q3Days: 3, octDays: 18 },
  { id: 'tue-dinner', loc: 'oakland', lever: 'Labour', title: 'Run Tuesday dinner with five servers, not six', outcome: 'testing', bookable: 0, point: 288, lo: -40, hi: 610, since: 'Oct 13', held: 'Window closes Nov 3', persist: '—', method: 'Matched control services, 3-week window', checkpoint: 'Checkpoint 1 of 2 passed', owner: 'Maria Reyes', closes: 'Nov 3', progress: 55 },
  { id: 'salmon-plate', loc: 'oakland', lever: 'Menu', title: 'Trim the salmon plate cost', outcome: 'data', bookable: 0, point: null, since: 'Oct 6', held: 'Quarantined', persist: '—', method: 'Recipe-cost delta × units', reason: 'Recipe costs are 18 days old. We can\'t tell what the plate costs now.', owner: 'Maria Reyes', unblockedBy: 'recipes' },
  { id: 'oak-pars', loc: 'oakland', lever: 'Inventory', title: 'Cut Monday prep pars by 15%', outcome: 'testing', bookable: 0, point: 41, lo: -18, hi: 96, since: 'Oct 19', held: 'Window closes Nov 30', persist: '—', method: 'Usage variance vs 6 matched Mondays', checkpoint: 'Week 1 of 6', owner: 'Marcus Rivera', closes: 'Nov 30', progress: 15 },
  { id: 'oak-wine', loc: 'oakland', lever: 'Menu', title: 'Feature the house red by the glass', outcome: 'directional', bookable: 0, point: 22, since: 'Aug 31', held: 'Closed Oct 12', persist: '—', method: 'Difference-in-differences vs 5 comparable drinks', reason: 'Glasses rose, but the interval crosses zero ($−9 to $53). No claim.', owner: 'Marcus Rivera' },
  { id: 'oak-brunch', loc: 'oakland', lever: 'Throughput', title: 'Seat the 7:30 Saturday rush in two waves', outcome: 'inconclusive', bookable: 0, point: 35, since: 'Aug 1', held: 'Closed Sep 12', persist: '—', method: 'Matched control services', reason: 'Only 4 full-room intervals in the window; the design needed 10. Says nothing about whether waves work.', owner: 'Marcus Rivera' },
  { id: 'bk-friday', loc: 'berkeley', lever: 'Labour', title: 'Cut one Friday dinner server', outcome: 'reversed', bookable: 0, point: 185, removed: 555, since: 'Aug 3', held: 'Reversed Aug 24', persist: '—', method: 'Matched control services', reason: 'Table turns breached the 52-minute guardrail (54 min observed). $555 removed from every figure, back to Aug 3.', owner: 'Maria Reyes', ledger: [6, 8, -185] },
  { id: 'bk-expo', loc: 'berkeley', lever: 'Throughput', title: 'Coach the Thursday expo hand-off', outcome: 'inconclusive', bookable: 0, point: 64, since: 'Sep 21', held: 'Closed Oct 19', persist: '—', method: 'Matched control services', reason: 'Underpowered. The design needed 9 comparable services and had 4. This says nothing about whether coaching works.', owner: 'Devon Clarke' },
  { id: 'bk-lunch', loc: 'berkeley', lever: 'Labour', title: 'Monday lunch with one server fewer', outcome: 'testing', bookable: 0, point: 52, lo: -8, hi: 112, since: 'Oct 12', held: 'Window closes Nov 9', persist: '—', method: 'Matched control services, 4-week window', checkpoint: 'Week 2 of 4', owner: 'Devon Clarke', closes: 'Nov 9', progress: 50 },
  { id: 'bk-tickets', loc: 'berkeley', lever: 'Kitchen', title: 'Fire appetizers on seat, not on order', outcome: 'data', bookable: 0, point: null, since: 'Oct 5', held: 'Quarantined', persist: '—', method: 'Ticket time vs 6 matched services', reason: 'The kitchen display stopped exporting on Oct 21. No ticket times, no test.', owner: 'Devon Clarke' },
  { id: 'bk-happy', loc: 'berkeley', lever: 'Menu', title: 'Move happy hour from 3–5 to 4–6', outcome: 'directional', bookable: 0, point: 48, since: 'Aug 17', held: 'Closed Sep 28', persist: '—', method: 'Difference-in-differences vs Oakland and Walnut Creek', reason: 'Bar sales rose, but the interval crosses zero ($−21 to $117). No claim; it raises the prior for timing moves.', owner: 'Devon Clarke' },
  { id: 'wc-club', loc: 'walnut', lever: 'Menu', title: 'Trim the club sandwich portion', outcome: 'directional', bookable: 0, point: 41, since: 'Sep 14', held: 'Closed Oct 12', persist: '—', method: 'Difference-in-differences vs 6 comparable items', reason: 'Moved the right way, but the interval crosses zero ($−12 to $94). No claim; it raises the prior for portion trims.', owner: 'Priya Shah' },
  { id: 'wc-pours', loc: 'walnut', lever: 'Inventory', title: 'Measured pours on well spirits', outcome: 'testing', bookable: 0, point: 60, lo: -5, hi: 125, since: 'Oct 19', held: 'Window closes Nov 30', persist: '—', method: 'Pour variance vs 6 matched weeks', checkpoint: 'Week 1 of 6', owner: 'Priya Shah', closes: 'Nov 30', progress: 15 },
  { id: 'wc-romaine', loc: 'walnut', lever: 'Purchasing', title: 'Switch romaine to a second supplier', outcome: 'reversed', bookable: 0, point: 64, removed: 128, since: 'Sep 7', held: 'Reversed Sep 21', persist: '—', method: 'Invoice unit price vs group contract', reason: 'Quality complaints on the Caesar doubled (guardrail 1.5×). Back on Valley Greens; $128 removed back to Sep 7.', owner: 'Priya Shah', ledger: [11, 12, -64] },
];

/* ------------------------------------------------------------------ the dataset */
export function buildSeed() {
  const rooms = {};
  ROOM_IDS.forEach((id, n) => {
    const rand = mulberry32(20261027 + n * 7919);
    const a = ANCHOR[id];
    const content = CONTENT[id];
    const menu = buildMenu(id);
    const foh = id === 'oakland' ? null : { ...FOH_4WK[id], sales: 0 };
    /* Weekly exceptions from staff; gross = net + comps + discounts. */
    const staff4wk = id === 'oakland'
      ? { comps: ORIGINAL_FOH.reduce((s, p) => s + p.comps, 0) + OAK_REST.comps, disc: ORIGINAL_FOH.reduce((s, p) => s + p.disc, 0) + OAK_REST.disc }
      : { comps: FOH_4WK[id].comps, disc: FOH_4WK[id].disc };
    const gross = a.net + (staff4wk.comps + staff4wk.disc) / 4;
    if (id !== 'oakland') fitVolumes(menu, gross, ROOM_MENU[id].over);
    balanceMenu(menu, gross, a.food);
    if (foh) foh.sales = a.net * 4;
    const staff = buildStaff(id, rand, foh, a.labour);
    const invoices = buildInvoices(id, rand);
    const wcm = menu.reduce((s, m) => s + (m.price - m.cost) * m.units, 0) / menu.reduce((s, m) => s + m.units, 0);
    const excNow = (staff.reduce((s, p) => s + p.postVoid + p.comps + p.disc, 0) / 4 / a.net) * 100;
    const history = buildHistory(id, rand, a, wcm, excNow);
    /* Counts for the generated rooms: received from invoices, close set so the
       usage gap matches the room's stated gap. Oakland's are the originals. */
    const counts = content.counts.map((c) => {
      if (id === 'oakland') return { ...c };
      const inv = invoices.find((r) => r.item === c.item);
      const theo = theoreticalUsage(menu, c.item);
      const want = theo * (1 + c.gap);
      /* Use the invoice quantity when it's a plausible match for usage; otherwise the SKU also feeds dishes outside the recipe map. */
      const received = inv && inv.q1 > want * 0.85 && inv.q1 < want * 1.15 ? inv.q1 : r1(want + c.close - c.open);
      const close = r2(c.open + received - theo * (1 + c.gap));
      return { ...c, received, close, cost: c.cost ?? (inv ? inv.p1 : 0) };
    });
    rooms[id] = {
      id, profile: LOCS.find((l) => l.id === id), anchor: { ...a },
      menu, invoices, staff, history, counts,
      channels: content.channels.map((c) => ({ ...c })), waste: content.waste.map((w) => ({ ...w })),
      tickets: content.tickets, labour: content.labour, throughput: content.throughput, service: content.service,
      queue: content.queue, alarms: content.alarms, banked: content.banked, meeting: content.meeting, areas: content.areas,
      feeds: content.feeds, autonomy: content.autonomy, managerHours: content.managerHours, bankedPerHour: content.bankedPerHour,
      candidates: CANDIDATES[id],
    };
  });
  return { version: 1, now: NOW, locs: LOCS, vendors: VENDORS, recipes: RECIPES, weeks: HISTORY_WEEKS, ledgerWeeks: LEDGER_WEEKS, matchedWeeks: MATCHED_WEEKS, rooms, proof: PROOF.map((p) => ({ ...p })), originals: { menu: ORIGINAL_15 } };
}

/** Σ plates × recipe quantity, over 28 days. */
export function theoreticalUsage(menu, sku) {
  let q = 0;
  menu.forEach((m) => {
    (RECIPES[m.key] || []).forEach(([s, qty]) => { if (s === sku) q += m.units * 4 * qty; });
  });
  return q;
}

/** The one shared seed. Built once per process. */
export const SEED = buildSeed();
