// A location's weekly schedule or payroll export is matched the way it was
// confirmed last time, without asking again; a different file shape is not.
import { describe, expect, it } from 'vitest';

import { rememberedMapping } from '../lib/data/page/inputs.js';

const saved = [
  { kind: 'shifts', mapping: { 'Shift Day': 'date', Job: 'role', In: 'start', Out: 'end', 'Team Member': 'name', 'Pay $': 'rate' } },
];
const headers = ['Shift Day', 'Job', 'In', 'Out', 'Team Member', 'Pay $'];

describe('rememberedMapping', () => {
  it('reuses the last confirmed matching for the same headers, in any order or case', () => {
    expect(rememberedMapping(saved, ['pay $', 'shift day', 'JOB', 'In', 'Out', 'Team Member'], 'shifts')).toEqual({
      'shift day': 'date', JOB: 'role', In: 'start', Out: 'end', 'Team Member': 'name', 'pay $': 'rate',
    });
  });

  it('does not reuse it for a file with a new or missing column', () => {
    expect(rememberedMapping(saved, [...headers, 'Tips'], 'shifts')).toBeNull();
    expect(rememberedMapping(saved, headers.slice(0, 5), 'shifts')).toBeNull();
  });

  it('does not reuse another kind’s matching, or one that points at a column this kind no longer has', () => {
    expect(rememberedMapping(saved, headers, 'services')).toBeNull();
    expect(rememberedMapping([{ kind: 'shifts', mapping: { ...saved[0].mapping, 'Pay $': 'gone' } }], headers, 'shifts')).toBeNull();
  });

  it('takes the newest matching first', () => {
    const newer = { kind: 'shifts', mapping: { ...saved[0].mapping, 'Pay $': 'paid_hours' } };
    expect(rememberedMapping([newer, ...saved], headers, 'shifts')['Pay $']).toBe('paid_hours');
  });
});
