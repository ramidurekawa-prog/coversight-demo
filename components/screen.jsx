'use client';

import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { CvPlan, CvService, CvThisWeek, CvToday } from './screens/week';
import { CvLabour, CvMenu, CvPurchasing, CvThroughput } from './screens/levers';
import { CvAccountant, CvComparison, CvLedger, CvPacket, CvProof, CvSources, CvSystem } from './screens/proof';
import { CvBilling, CvBuild, CvFences, CvFinding, CvMeeting, CvPortfolio, CvStart } from './screens/extra';
import { pathFor } from '../lib/pages';

/** Page id → screen component. Every key in CV_PAGES has one (tests check). */
export const SCREENS = {
  today: CvToday,
  service: CvService,
  week: CvThisWeek,
  portfolio: CvPortfolio,
  meeting: CvMeeting,
  plan: CvPlan,
  finding: CvFinding,
  menu: CvMenu,
  labour: CvLabour,
  throughput: CvThroughput,
  purchasing: CvPurchasing,
  proof: CvProof,
  packet: CvPacket,
  ledger: CvLedger,
  accountant: CvAccountant,
  billing: CvBilling,
  start: CvStart,
  comparison: CvComparison,
  sources: CvSources,
  fences: CvFences,
  system: CvSystem,
};

/** @param {{ page: string, id?: string | null }} props */
export function Screen({ page, id = null }) {
  const C = SCREENS[page];
  return <C params={id ? { id } : {}} />;
}

/** The build plan. Its focus (which screen's gaps to show) lives in the URL hash. */
export function BuildScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [focus, setFocus] = React.useState(null);
  React.useEffect(() => {
    const read = () => setFocus(window.location.hash.slice(1) || null);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [pathname]);
  const onOpen = (p, open) => {
    if (p && open) router.push(pathFor(p));
    else {
      history.replaceState(null, '', '/build');
      setFocus(null);
    }
  };
  return <CvBuild focus={focus} onOpen={onOpen} />;
}
