// An org's dataset as the screens see it: base data plus every live input.
// Jobs and server routes use this so the server never computes a figure
// differently from the browser.
import { applyInputs } from '../lib/data/apply.js';
import type { Db } from './db/client';
import { loadBase, loadInputs } from './org';

export async function loadDataset(db: Db, orgId: string, roomScope: string[] | null = null) {
  const loaded = await loadBase(db, orgId, roomScope);
  if (!loaded) return null;
  const { inputs } = await loadInputs(db, orgId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ds = applyInputs(loaded.base as any, inputs as any) as any;
  return { org: loaded.org, ds };
}
