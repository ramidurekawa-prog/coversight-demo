import { SEED } from './data/seed.js';
import { allFindingIds } from './data/model.js';

/**
 * Every screen in the demo: its title, icon and URL. The single source of
 * truth for the sidebar, the top bar title and routing.
 *
 * `added` marks screens added in a design pass: true = V2, 'V3' = the operating-area
 * screens from the reference sheets, 'V4' = trends and data inputs (shown on the build plan).
 * `hidden` screens are reached from other screens (a verification packet from
 * Proof, a finding from The plan) and take an id in the URL.
 */
export const CV_PAGES = {
  today: { title: 'Today', icon: 'ListChecks' },
  service: { title: 'Service', icon: 'Activity' },
  week: { title: 'This week', icon: 'CalendarRange' },
  trends: { title: 'Trends', icon: 'ChartLine', isNew: true, added: 'V4' },
  portfolio: { title: 'All rooms', icon: 'Building2', added: true },
  meeting: { title: 'Weekly meeting', icon: 'Presentation', added: true },
  plan: { title: 'The plan', icon: 'Route' },
  finding: { title: 'Finding', icon: 'Search', hidden: true, added: true },
  menu: { title: 'Menu', icon: 'UtensilsCrossed' },
  labour: { title: 'Labour', icon: 'Users' },
  throughput: { title: 'Throughput', icon: 'Armchair' },
  coverage: { title: 'Coverage map', icon: 'LayoutGrid', isNew: true, added: 'V3' },
  purchasing: { title: 'Purchasing', icon: 'Truck' },
  inventory: { title: 'Inventory & waste', icon: 'Package', isNew: true, added: 'V3' },
  kitchen: { title: 'Kitchen', icon: 'ChefHat', isNew: true, added: 'V3' },
  controls: { title: 'Controls', icon: 'ShieldCheck', isNew: true, added: 'V3' },
  channels: { title: 'Delivery & channels', icon: 'Bike', isNew: true, added: 'V3' },
  proof: { title: 'Proof', icon: 'BadgeCheck' },
  packet: { title: 'Verification packet', icon: 'FileCheck', hidden: true },
  ledger: { title: 'Savings ledger', icon: 'BookOpenCheck' },
  accountant: { title: 'Accountant', icon: 'Landmark' },
  billing: { title: 'Billing', icon: 'Receipt', added: true },
  start: { title: 'First six weeks', icon: 'Sprout', added: true },
  comparison: { title: 'Comparison', icon: 'Columns3' },
  sources: { title: 'Sources', icon: 'Cable', dot: true },
  inputs: { title: 'Data inputs', icon: 'FilePen', isNew: true, added: 'V4' },
  fences: { title: 'Fences & alerts', icon: 'Fence', added: true },
  system: { title: 'System', icon: 'Bot' },
};

export const CV_NAV = [
  { label: 'Every day', items: ['today', 'service', 'inputs'] },
  { label: 'Every week', items: ['week', 'trends', 'portfolio', 'meeting', 'plan'] },
  { label: 'Levers', items: ['coverage', 'labour', 'menu', 'purchasing', 'inventory', 'kitchen', 'throughput', 'controls', 'channels'] },
  { label: 'Proof', items: ['proof', 'ledger', 'accountant', 'billing'] },
  { label: 'Setup', items: ['sources', 'start', 'comparison', 'fences', 'system'] },
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
  if (page === 'inputs' && params.kind) return `/inputs#${params.kind}`;
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
 * Ids the static export pre-renders for the id screens, read straight from
 * the dataset (plain JS, so route files can import it).
 */
export const PACKET_IDS = SEED.proof.map((p) => p.id);
export const FINDING_IDS = allFindingIds(SEED);

/** Top-level screens served at /{page} (This week is /, the id screens have their own routes). */
export const SCREEN_PAGES = Object.keys(CV_PAGES).filter((p) => p !== 'week' && p !== 'packet' && p !== 'finding');
