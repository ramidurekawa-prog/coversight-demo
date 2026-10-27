/**
 * Every screen in the demo: its title, icon and URL. The single source of
 * truth for the sidebar, the top bar title and routing.
 *
 * `added` marks screens added in the V2 design pass (shown on the build plan).
 * `hidden` screens are reached from other screens (a verification packet from
 * Proof, a finding from The plan) and take an id in the URL.
 */
export const CV_PAGES = {
  today: { title: 'Today', icon: 'ListChecks' },
  service: { title: 'Service', icon: 'Activity' },
  week: { title: 'This week', icon: 'CalendarRange' },
  portfolio: { title: 'All rooms', icon: 'Building2', added: true },
  meeting: { title: 'Weekly meeting', icon: 'Presentation', added: true },
  plan: { title: 'The plan', icon: 'Route' },
  finding: { title: 'Finding', icon: 'Search', hidden: true, added: true },
  menu: { title: 'Menu', icon: 'UtensilsCrossed' },
  labour: { title: 'Labour', icon: 'Users' },
  throughput: { title: 'Throughput', icon: 'Armchair' },
  purchasing: { title: 'Purchasing', icon: 'Truck', isNew: true },
  proof: { title: 'Proof', icon: 'BadgeCheck' },
  packet: { title: 'Verification packet', icon: 'FileCheck', hidden: true },
  ledger: { title: 'Savings ledger', icon: 'BookOpenCheck' },
  accountant: { title: 'Accountant', icon: 'Landmark' },
  billing: { title: 'Billing', icon: 'Receipt', added: true },
  start: { title: 'First six weeks', icon: 'Sprout', added: true },
  comparison: { title: 'Comparison', icon: 'Columns3' },
  sources: { title: 'Sources', icon: 'Cable', dot: true },
  fences: { title: 'Fences & alerts', icon: 'Fence', added: true },
  system: { title: 'System', icon: 'Bot' },
};

export const CV_NAV = [
  { label: 'Every day', items: ['today', 'service'] },
  { label: 'Every week', items: ['week', 'portfolio', 'meeting', 'plan'] },
  { label: 'Levers', items: ['menu', 'labour', 'throughput', 'purchasing'] },
  { label: 'Proof', items: ['proof', 'ledger', 'accountant', 'billing'] },
  { label: 'Setup', items: ['start', 'comparison', 'sources', 'fences', 'system'] },
];

export const CV_ROLES = {
  owner: { label: 'Owner', person: 'Maria Reyes', sub: 'Owner · 3 rooms', initials: 'MR', home: 'week', nav: null },
  gm: { label: 'GM', person: 'Marcus Rivera', sub: 'GM · Oakland', initials: 'MR', home: 'today', nav: ['Every day', 'Every week', 'Levers', 'Proof'] },
  accountant: { label: 'Accountant', person: 'Elena Park', sub: 'Group controller', initials: 'EP', home: 'accountant', nav: ['Proof', 'Setup'] },
};

/** Screens that read every room. Choosing "All rooms" elsewhere goes to the portfolio. */
export const GROUP_PAGES = ['portfolio', 'proof', 'ledger', 'comparison', 'billing', 'accountant', 'system', 'fences'];

/** Default ids for the hidden screens, so a bare link still lands somewhere real. */
export const DEFAULT_IDS = { packet: 'thu-prep', finding: 'salmon' };

/** Page id (+ optional id param) → URL. This week is the home page. */
export function pathFor(page, params = {}) {
  if (page === 'week') return '/';
  if (page === 'packet' || page === 'finding') return `/${page}/${params.id ?? DEFAULT_IDS[page]}`;
  return `/${page}`;
}

/** URL → { page, id }. Unknown paths fall back to This week. */
export function pageFromPath(pathname) {
  const parts = (pathname || '/').replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { page: 'week', id: null };
  const [page, id = null] = parts;
  if (page === 'build') return { page: 'build', id: null };
  return CV_PAGES[page] ? { page, id } : { page: 'week', id: null };
}

/**
 * Ids the static export pre-renders for the id screens. Kept here (plain data)
 * because route files run on the server and cannot read values out of client
 * modules. tests/routes.test.js checks these match the screens' own data.
 */
export const PACKET_IDS = ['thu-prep', 'wc-close', 'wc-comps', 'tue-dinner', 'salmon-plate', 'bk-friday', 'bk-expo', 'wc-club'];
export const FINDING_IDS = ['ribeye', 'salmon', 'vendor', 'satpeak', 'ot', 'carb', 'shoulder', 'paystage'];

/** Top-level screens served at /{page} (This week is /, the id screens have their own routes). */
export const SCREEN_PAGES = Object.keys(CV_PAGES).filter((p) => p !== 'week' && p !== 'packet' && p !== 'finding');
