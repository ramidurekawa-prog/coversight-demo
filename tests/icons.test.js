import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { ICON_NAMES } from '../components/kit.jsx';
import { CV_PAGES } from '../lib/pages.js';

/* Icons are a static map (tree-shaken), so a name missing from it renders
 * nothing. Scan the source for every icon string and check the map has it. */
test('every icon name used in the source is in the icon map', () => {
  const files = ['components/shell.jsx', ...readdirSync('components/screens').map((f) => join('components/screens', f))];
  const used = new Set(Object.values(CV_PAGES).map((p) => p.icon));
  const patterns = [
    /<Icon\b[^>]*?\bname=\{?\s*["']([A-Z][A-Za-z0-9]+)["']/g, // <Icon name="X" />
    /\b(?:icon|iconRight)\s*[=:]\s*\{?\s*["']([A-Z][A-Za-z0-9]+)["']/g, // icon="X", icon: "X"
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const re of patterns) for (const m of src.matchAll(re)) used.add(m[1]);
  }
  const missing = [...used].filter((n) => !ICON_NAMES.includes(n));
  expect(used.size).toBeGreaterThan(40);
  expect(missing).toEqual([]);
});
