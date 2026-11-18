'use client';

/* Data inputs: where each kind of this room's data comes from now, one row
 * per kind in step order. Feeds the coverage ring and the kind tiles. */

import { CV_D } from '../core';
import { SCHEMAS, STEP_ORDER, sourceOf } from '../../../lib/data/page/inputs';

export function boardRows(links, history) {
  const linkedKinds = new Set(links.filter((l) => l.roomId === CV_D.id).flatMap((l) => l.picks.map((p) => p.kind)));
  return STEP_ORDER.map((kind) => {
    const schema = SCHEMAS[kind];
    const entry = CV_D.inputs[kind];
    const feed = schema.feed ? CV_D.feeds.find((f) => f.name === schema.feed) : null;
    const src = sourceOf({ entry, feed, linked: linkedKinds.has(kind) });
    const last = history.find((e) => e.kind === kind && e.room === CV_D.id && e.current);
    return { kind, schema, entry, feed, src, last };
  });
}
