'use client';

import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

// One file per page: components/screens/pages/<pageId>.jsx (one import line each, sorted).
import { CvAccountant } from './screens/pages/accountant';
import { CvBilling } from './screens/pages/billing';
import { CvBuild } from './screens/pages/build';
import { CvChannels } from './screens/pages/channels';
import { CvComparison } from './screens/pages/comparison';
import { CvConnect } from './screens/pages/connect';
import { CvControls } from './screens/pages/controls';
import { CvCoverage } from './screens/pages/coverage';
import { CvDaily } from './screens/pages/daily';
import { CvData } from './screens/pages/data';
import { CvFences } from './screens/pages/fences';
import { CvFinding } from './screens/pages/finding';
import { CvInputs } from './screens/pages/inputs';
import { CvInventory } from './screens/pages/inventory';
import { CvKitchen } from './screens/pages/kitchen';
import { CvLabour } from './screens/pages/labour';
import { CvLedger } from './screens/pages/ledger';
import { CvLevers } from './screens/pages/levers';
import { CvMeeting } from './screens/pages/meeting';
import { CvMenu } from './screens/pages/menu';
import { CvPacket } from './screens/pages/packet';
import { CvPlan } from './screens/pages/plan';
import { CvPortfolio } from './screens/pages/portfolio';
import { CvProof } from './screens/pages/proof';
import { CvPurchasing } from './screens/pages/purchasing';
import { CvService } from './screens/pages/service';
import { CvSources } from './screens/pages/sources';
import { CvStart } from './screens/pages/start';
import { CvSystem } from './screens/pages/system';
import { CvTeam } from './screens/pages/team';
import { CvThroughput } from './screens/pages/throughput';
import { CvToday } from './screens/pages/today';
import { CvTrends } from './screens/pages/trends';
import { CvThisWeek } from './screens/pages/week';
import { CvWindows } from './screens/pages/windows';
import { pathFor } from '../lib/pages';

/** Page id → screen component. Every key in CV_PAGES has one (tests check). */
export const SCREENS = {
  today: CvToday,
  service: CvService,
  week: CvThisWeek,
  trends: CvTrends,
  daily: CvDaily,
  inputs: CvInputs,
  portfolio: CvPortfolio,
  meeting: CvMeeting,
  plan: CvPlan,
  finding: CvFinding,
  menu: CvMenu,
  labour: CvLabour,
  throughput: CvThroughput,
  purchasing: CvPurchasing,
  coverage: CvCoverage,
  inventory: CvInventory,
  kitchen: CvKitchen,
  controls: CvControls,
  channels: CvChannels,
  proof: CvProof,
  windows: CvWindows,
  levers: CvLevers,
  team: CvTeam,
  packet: CvPacket,
  ledger: CvLedger,
  accountant: CvAccountant,
  billing: CvBilling,
  start: CvStart,
  comparison: CvComparison,
  sources: CvSources,
  connect: CvConnect,
  data: CvData,
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
