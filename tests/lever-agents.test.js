import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { CV_NAV } from '../lib/pages.js';

/** Hub pages in the Levers group that are not themselves a lever page. */
const HUBS = new Set(['coverage', 'summary']);
const leverPages = () => CV_NAV.find((g) => g.label === 'Levers').items.filter((p) => !HUBS.has(p));

describe('lever redesign agents', () => {
  const brief = readFileSync('docs/LEVER_REDESIGN.md', 'utf8');

  test('every lever page has its own redesign agent', () => {
    for (const p of leverPages()) {
      const file = `.claude/agents/lever-${p}.md`;
      expect(existsSync(file), file).toBe(true);
      const md = readFileSync(file, 'utf8');
      const front = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
      expect(front, file).toMatch(new RegExp(`^name: lever-${p}$`, 'm'));
      expect(front, file).toMatch(/^description: \S/m);
      expect(md, file).toContain(`components/screens/pages/${p}.jsx`);
      expect(md, file).toContain('docs/LEVER_REDESIGN.md');
    }
  });

  test('the shared brief lists every lever agent', () => {
    for (const p of leverPages()) expect(brief, p).toContain(`\`lever-${p}\``);
  });
});
