import { SEED } from './data/seed.js';
import { allFindingIds } from './data/model.js';

/**
 * Every screen in the demo: its title, icon and URL. The single source of
 * truth for the sidebar, the top bar title and routing.
 *
 * `added` marks screens added in a design pass: true = V2, 'V3' = the operating-area
 * screens from the reference sheets, 'V4' = trends and data inputs, 'Pilot' = the live
 * platform as it runs in a pilot today (shown on the build plan).
 * `hidden` screens are reached from other screens (a verification packet from
 * Proof, a finding from The plan) and take an id in the URL.
 */
export const CV_PAGES = {
  today: { title: 'Today', icon: 'ListChecks' },
  service: { title: 'Service', icon: 'Activity' },
  week: { title: 'This week', icon: 'CalendarRange' },
  trends: { title: 'Trends', icon: 'ChartLine', isNew: true, added: 'V4' },
  // Scoreboard: one page, two tabs. `portfolio` is Every room, `daily` is Day by day; only portfolio is in the sidebar.
  daily: { title: 'Scoreboard', icon: 'CalendarDays', isNew: true, added: 'V4' },
  portfolio: { title: 'Scoreboard', icon: 'Trophy', added: true },
  meeting: { title: 'Weekly meeting', icon: 'Presentation', added: true },
  plan: { title: 'The plan', icon: 'Route' },
  finding: { title: 'Finding', icon: 'Search', hidden: true, added: true },
  menu: { title: 'Menu prices', icon: 'UtensilsCrossed' },
  labour: { title: 'Labor', icon: 'Users' },
  staff: { title: 'Staff', icon: 'IdCard', isNew: true, added: 'V4' },
  throughput: { title: 'Tables', icon: 'Armchair' },
  summary: { title: 'Lever Check', icon: 'Gauge', isNew: true },
  purchasing: { title: 'Supplier prices', icon: 'Truck' },
  inventory: { title: 'Food & drink used', icon: 'Package', isNew: true, added: 'V3' },
  kitchen: { title: 'Kitchen speed', icon: 'ChefHat', isNew: true, added: 'V3' },
  controls: { title: 'Giveaways', icon: 'ShieldCheck', isNew: true, added: 'V3' },
  channels: { title: 'Delivery', icon: 'Bike', isNew: true, added: 'V3' },
  proof: { title: 'Proof', icon: 'BadgeCheck' },
  windows: { title: 'Test windows', icon: 'Timer', isNew: true, added: 'Pilot' },
  levers: { title: 'Levers', icon: 'SlidersHorizontal', isNew: true, added: 'Pilot' },
  packet: { title: 'Verification packet', icon: 'FileCheck', hidden: true },
  ledger: { title: 'Savings ledger', icon: 'BookOpenCheck' },
  accountant: { title: 'Accountant', icon: 'Landmark' },
  billing: { title: 'Billing', icon: 'Receipt', added: true },
  start: { title: 'Getting started', icon: 'Sprout', added: true },
  comparison: { title: 'Comparison', icon: 'Columns3' },
  sources: { title: 'Sources', icon: 'Cable', dot: true },
  connect: { title: 'Connect your POS', icon: 'PlugZap', isNew: true, added: 'Pilot' },
  data: { title: 'Your data', icon: 'Database', isNew: true, added: 'Pilot' },
  inputs: { title: 'Add & Manage Data', navTitle: 'Data', icon: 'FilePen', isNew: true, added: 'V4' },
  fences: { title: 'Limits & alerts', icon: 'Fence', added: true },
  team: { title: 'Team & groups', icon: 'UserPlus', isNew: true, added: 'Accounts' },
  system: { title: 'System', icon: 'Bot' },
};

/**
 * The sidebar: four groups by how often a page is used. A group can label
 * stretches of its items with `sections` (first item id of a stretch: label).
 * Pages that are not listed here are tabs of a listed page (CV_TABS) or sit
 * behind the Settings gear (CV_SETTINGS).
 */
export const CV_NAV = [
  { label: 'Every day', items: ['today', 'service', 'inputs'] },
  { label: 'Every week', items: ['week', 'portfolio', 'meeting'] },
  {
    label: 'Levers',
    items: ['summary', 'throughput', 'channels', 'labour', 'staff', 'kitchen', 'controls', 'menu', 'purchasing', 'inventory'],
    sections: { throughput: 'Guests and sales', labour: 'Team and shift', menu: 'Food and drink' },
  },
  { label: 'Proof', items: ['proof', 'accountant'] },
];

/**
 * Pages that share one sidebar entry, shown as tabs above the page. The key
 * is the sidebar page; each tab is [page id, label]. Every tab keeps its own
 * URL, so old links still land on the right tab.
 */
export const CV_TABS = {
  inputs: [['inputs', 'Add today'], ['sources', 'Connections'], ['data', 'Your data']],
  week: [['week', 'Scorecard'], ['plan', 'The plan']],
  portfolio: [['portfolio', 'Locations'], ['daily', 'Day by day'], ['trends', 'Trends'], ['comparison', 'Before and after']],
  proof: [['proof', 'Proven savings'], ['windows', 'Tests running'], ['ledger', 'Savings ledger']],
  accountant: [['accountant', 'Monthly close'], ['billing', 'Billing']],
  team: [['team', 'Team'], ['fences', 'Limits & alerts'], ['system', 'Autonomy'], ['levers', 'Lever pilots'], ['start', 'Getting started']],
};

/** The Settings gear at the foot of the sidebar opens this page; its tabs are CV_TABS.team. */
export const CV_SETTINGS = 'team';

/** Pages reached from inside a tab, lit as that tab. */
const TAB_CHILD = { connect: 'sources', finding: 'plan', packet: 'proof' };

/** The sidebar page a page belongs to, the tab that is lit and the tab list (null when the page has no tabs). */
export function familyOf(page) {
  const tab = TAB_CHILD[page] || page;
  for (const [parent, tabs] of Object.entries(CV_TABS)) if (tabs.some(([id]) => id === tab)) return { parent, tab, tabs };
  return { parent: page, tab: page, tabs: null };
}

/**
 * `nav`: the sidebar groups a role sees (null = all). `hide`: pages left out
 * of that role's sidebar. `settings`: whether the Settings gear shows.
 */
export const CV_ROLES = {
  owner: { label: 'Owner', person: 'Maria Reyes', sub: 'Owner · 3 rooms', initials: 'MR', home: 'week', nav: null, hide: [], settings: true },
  gm: { label: 'GM', person: 'Marcus Rivera', sub: 'GM · Oakland', initials: 'MR', home: 'today', nav: ['Every day', 'Every week', 'Levers'], hide: ['portfolio'], settings: false },
  accountant: { label: 'Accountant', person: 'Elena Park', sub: 'Group controller', initials: 'EP', home: 'accountant', nav: ['Proof'], hide: [], settings: true },
};

/** Screens that read every room. Choosing "All rooms" elsewhere goes to the portfolio. */
export const GROUP_PAGES = ['portfolio', 'proof', 'ledger', 'comparison', 'billing', 'accountant', 'system', 'fences', 'team'];

/** Default ids for the hidden screens, so a bare link still lands somewhere real. */
export const DEFAULT_IDS = { packet: 'thu-prep', finding: 'salmon' };

/** Page id (+ optional id param) → URL. This week is the home page. */
export function pathFor(page, params = {}) {
  if (page === 'week') return '/';
  if (page === 'packet' || page === 'finding') return `/${page}/${params.id ?? DEFAULT_IDS[page]}`;
  if (page === 'inputs' && params.kind) return `/inputs#${params.kind}`;
  return `/${page}`;
}

/** URL → { page, id }. Unknown paths fall back to This week. */
export function pageFromPath(pathname) {
  const parts = (pathname || '/').replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { page: 'week', id: null };
  const [page, id = null] = parts;
  if (page === 'build') return { page: 'build', id: null };
  if (page === 'coverage') return { page: 'summary', id: null }; // the Coverage map became Lever Check
  return CV_PAGES[page] ? { page, id } : { page: 'week', id: null };
}

/**
 * Ids the static export pre-renders for the id screens, read straight from
 * the dataset (plain JS, so route files can import it).
 */
export const PACKET_IDS = SEED.proof.map((p) => p.id);
export const FINDING_IDS = allFindingIds(SEED);

/** Top-level screens served at /{page} (This week is /, the id screens have their own routes). */
export const SCREEN_PAGES = Object.keys(CV_PAGES).filter((p) => p !== 'week' && p !== 'packet' && p !== 'finding');
