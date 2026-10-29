import { describe, expect, it } from 'vitest';

import {
  assessPlanCandidate,
  buildWeeklyPlan,
  type WeeklyPlanCandidate,
} from './weekly-plan';

function candidate(override: Partial<WeeklyPlanCandidate> = {}): WeeklyPlanCandidate {
  return {
    id: 'labor-friday',
    title: 'Review Friday closing labor',
    locationId: 'oakland',
    sourceRefs: ['labor-daypart-2026-10-23', 'pos-sales-2026-10-23'],
    dataQuality: 'healthy',
    sourceAgeDays: 1,
    confidencePct: 88,
    guardrail: 'pass',
    riskLevel: 'medium',
    verificationPlanReady: true,
    conservativeWeeklyBenefitCents: 50_000,
    incrementalWeeklyCostCents: 5_000,
    implementationCostCents: 2_000,
    benefitHorizonWeeks: 4,
    managerMinutes: 20,
    overlapGroup: 'labor-friday-closing',
    executionStatus: 'not_started',
    approvalRequired: 'gm',
    approvalGranted: false,
    ...override,
  };
}

describe('assessPlanCandidate', () => {
  it('uses conservative benefit net of recurring cost and amortized implementation cost', () => {
    const result = assessPlanCandidate(candidate());
    expect(result.readiness).toBe('ready_for_review');
    expect(result.conservativeNetWeekCents).toBe(44_500);
    expect(result.estimatedOnly).toBe(true);
    expect(result.executionAllowed).toBe(false);
    expect(result.approvalRequired).toBe('gm');
    expect(result.approvalGranted).toBe(false);
  });

  it('never grants execution even if an approval flag is supplied', () => {
    const result = assessPlanCandidate(candidate({ approvalGranted: true }));
    expect(result.readiness).toBe('ready_for_review');
    expect(result.executionAllowed).toBe(false);
  });

  it('blocks unsafe, missing-data, invalid, or already committed interventions', () => {
    const cases: Array<Partial<WeeklyPlanCandidate>> = [
      { guardrail: 'fail' },
      { dataQuality: 'missing' },
      { incrementalWeeklyCostCents: -1 },
      { managerMinutes: 0 },
      { confidencePct: Number.NaN },
      { executionStatus: 'monitoring' },
    ];
    cases.forEach((testCase) => {
      expect(assessPlanCandidate(candidate(testCase)).readiness).toBe('blocked');
    });
  });

  it('sends weak or stale evidence, high operational risk and watch guardrails to investigation', () => {
    const cases: Array<Partial<WeeklyPlanCandidate>> = [
      { sourceAgeDays: 8 },
      { dataQuality: 'degraded' },
      { sourceRefs: [] },
      { confidencePct: 79 },
      { riskLevel: 'high' },
      { guardrail: 'watch' },
      { verificationPlanReady: false },
      { conservativeWeeklyBenefitCents: null },
    ];
    cases.forEach((testCase) => {
      const result = assessPlanCandidate(candidate(testCase));
      expect(result.readiness).toBe('investigate');
      expect(result.estimatedOnly).toBe(true);
    });
  });

  it('does not suggest interventions with nonpositive conservative net benefit', () => {
    const result = assessPlanCandidate(candidate({
      conservativeWeeklyBenefitCents: 1000,
      incrementalWeeklyCostCents: 1200,
      implementationCostCents: 0,
    }));
    expect(result.readiness).toBe('investigate');
    expect(result.reasons).toContain('nonpositive_net_benefit');
  });

  it('does not confuse a missing lower-bound estimate with zero verified savings', () => {
    const result = assessPlanCandidate(candidate({ conservativeWeeklyBenefitCents: null }));
    expect(result.conservativeNetWeekCents).toBeNull();
    expect(result.estimatedOnly).toBe(true);
  });
});

describe('buildWeeklyPlan', () => {
  it('uses manager time and never claims estimated benefit is additive verified savings', () => {
    const result = buildWeeklyPlan([
      candidate(),
      candidate({
        id: 'void-control',
        title: 'Review discount exceptions',
        overlapGroup: null,
        conservativeWeeklyBenefitCents: 20_000,
        incrementalWeeklyCostCents: 0,
        implementationCostCents: 0,
        managerMinutes: 10,
      }),
      candidate({
        id: 'menu',
        title: 'Test price change',
        overlapGroup: null,
        conservativeWeeklyBenefitCents: 40_000,
        incrementalWeeklyCostCents: 0,
        implementationCostCents: 0,
        managerMinutes: 45,
      }),
    ], 30);
    expect(result.selected.map((item) => item.id)).toEqual(['labor-friday', 'void-control']);
    expect(result.usedManagerMinutes).toBe(30);
    expect(result.remainingManagerMinutes).toBe(0);
    expect(result.deferred).toEqual([
      expect.objectContaining({ id: 'menu', reasons: ['insufficient_manager_time'] }),
    ]);
    expect(result.maySumEstimatedSavings).toBe(false);
  });

  it('does not double-prioritize known overlapping interventions', () => {
    const result = buildWeeklyPlan([
      candidate(),
      candidate({
        id: 'labor-alternative',
        title: 'Alternative labor intervention',
        conservativeWeeklyBenefitCents: 30_000,
      }),
    ], 60);
    expect(result.selected).toHaveLength(1);
    expect(result.deferred.map((d) => d.reasons)).toEqual([['overlap']]);
  });

  it('does not remove or mutate candidates, and uses deterministic id ordering for ties', () => {
    const a = Object.freeze(candidate({ id: 'a', overlapGroup: null }));
    const b = Object.freeze(candidate({ id: 'b', overlapGroup: null }));
    const source = Object.freeze([b, a]);
    const result = buildWeeklyPlan(source, 40);
    expect(result.selected.map((d) => d.id)).toEqual(['a', 'b']);
    expect(source.map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('splits blocked, investigation and budget-deferred work, preserving the reasons', () => {
    const result = buildWeeklyPlan([
      candidate({ id: 'bad', guardrail: 'fail' }),
      candidate({ id: 'stale', sourceAgeDays: 9 }),
      candidate({ id: 'ready' }),
    ], 0);
    expect(result.blocked.map((d) => d.id)).toEqual(['bad']);
    expect(result.investigate.map((d) => d.id)).toEqual(['stale']);
    expect(result.deferred.map((d) => d.id)).toEqual(['ready']);
    expect(result.selected).toHaveLength(0);
  });

  it('rejects nonsensical budgets and duplicate ids', () => {
    expect(() => buildWeeklyPlan([], -1)).toThrow(RangeError);
    expect(() => buildWeeklyPlan([], 5.2)).toThrow(RangeError);
    expect(() => buildWeeklyPlan([candidate(), candidate()], 100)).toThrow('duplicate candidate id');
  });
});
