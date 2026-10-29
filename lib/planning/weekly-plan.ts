/**
 * Conservative, evidence-gated manager plan for Coversight 2.0.
 *
 * This module is a planning supplement, NOT a replacement for the existing
 * finding rank, action authorization, verification, or ROI engines.
 * The input's conservative benefit is an ESTIMATE supplied upstream; this
 * module never mints "verified" value and NEVER executes operational changes.
 *
 * Algorithm: deterministic value-per-manager-minute greedy selection under
 * budget + overlap constraints. It is intentionally not advertised as a
 * globally optimal knapsack solver (overlaps, dependencies and guardrails
 * require explicit review). Net weekly figures are NOT summed: cross-detector
 * economic correlations may remain even after overlap-group suppression.
 */

export type DecisionReadiness = 'blocked' | 'investigate' | 'ready_for_review';
export type PlanGuardrail = 'pass' | 'watch' | 'fail';
export type PlanDataQuality = 'healthy' | 'degraded' | 'missing';
export type PlanRiskLevel = 'low' | 'medium' | 'high';

export type PlanReason =
  | 'invalid_inputs'
  | 'already_committed'
  | 'missing_data'
  | 'degraded_data'
  | 'stale_data'
  | 'no_source_evidence'
  | 'low_confidence'
  | 'guardrail_failed'
  | 'guardrail_watch'
  | 'high_operational_risk'
  | 'no_verification_plan'
  | 'no_conservative_benefit'
  | 'nonpositive_net_benefit'
  | 'overlap'
  | 'insufficient_manager_time';

export interface WeeklyPlanCandidate {
  id: string;
  locationId: string;
  title: string;
  /** References to a source/rollup snapshot — not raw personally identifiable data. */
  sourceRefs: readonly string[];
  dataQuality: PlanDataQuality;
  /** Nonnegative age since this opportunity's supporting inputs were confirmed. */
  sourceAgeDays: number;
  /** Upstream confidence with source-quality caps already applied, 0–100. */
  confidencePct: number;
  guardrail: PlanGuardrail;
  riskLevel: PlanRiskLevel;
  verificationPlanReady: boolean;
  /**
   * Conservative weekly benefit scenario (NOT verified). Null when no
   * defensible economic range exists. This is not a statistical confidence
   * bound unless the upstream model explicitly produces and labels one.
   */
  conservativeWeeklyBenefitCents: number | null;
  incrementalWeeklyCostCents: number;
  implementationCostCents: number;
  /** Weeks over which to allocate one-time implementation cost. */
  benefitHorizonWeeks: number;
  managerMinutes: number;
  /** Comparable interventions sharing a pool of economic value. */
  overlapGroup?: string | null;
  /** Already progressing interventions may not be recommended again. */
  executionStatus?: 'not_started' | 'committed' | 'monitoring' | 'verified' | 'blocked';
  approvalRequired?: 'none' | 'gm' | 'owner';
  approvalGranted?: boolean;
}

export interface WeeklyPlanDecision {
  id: string;
  locationId: string;
  title: string;
  readiness: DecisionReadiness;
  reasons: readonly PlanReason[];
  /**
   * A planning score only: conservative benefit minus recurring expense and
   * amortized one-time expense, NOT booked/verified financial benefit.
   */
  conservativeNetWeekCents: number | null;
  managerMinutes: number;
  approvalRequired: 'none' | 'gm' | 'owner';
  approvalGranted: boolean;
  /** Never grant execution through a ranking calculation. */
  executionAllowed: false;
  /** This module cannot issue a verified money claim. */
  estimatedOnly: true;
  overlapGroup: string | null;
}

export interface WeeklyPlan {
  selected: readonly WeeklyPlanDecision[];
  investigate: readonly WeeklyPlanDecision[];
  blocked: readonly WeeklyPlanDecision[];
  deferred: readonly WeeklyPlanDecision[];
  usedManagerMinutes: number;
  remainingManagerMinutes: number;
  /** Never add estimates into a customer savings or billing claim. */
  maySumEstimatedSavings: false;
  selectionMethod: 'conservative_greedy_per_manager_minute';
}

export const PLAN_MAX_SOURCE_AGE_DAYS = 7;
export const PLAN_MIN_CONFIDENCE_PCT = 80;

function amount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function valid(candidate: WeeklyPlanCandidate): boolean {
  return Boolean(
    candidate.id &&
    candidate.locationId &&
    candidate.title &&
    Array.isArray(candidate.sourceRefs) &&
    Number.isFinite(candidate.sourceAgeDays) &&
    candidate.sourceAgeDays >= 0 &&
    Number.isFinite(candidate.confidencePct) &&
    candidate.confidencePct >= 0 &&
    candidate.confidencePct <= 100 &&
    Number.isSafeInteger(candidate.managerMinutes) &&
    candidate.managerMinutes > 0 &&
    Number.isSafeInteger(candidate.benefitHorizonWeeks) &&
    candidate.benefitHorizonWeeks > 0 &&
    amount(candidate.incrementalWeeklyCostCents) &&
    amount(candidate.implementationCostCents) &&
    (candidate.conservativeWeeklyBenefitCents === null ||
      amount(candidate.conservativeWeeklyBenefitCents)) &&
    ['healthy', 'degraded', 'missing'].includes(candidate.dataQuality) &&
    ['pass', 'watch', 'fail'].includes(candidate.guardrail) &&
    ['low', 'medium', 'high'].includes(candidate.riskLevel) &&
    (!candidate.executionStatus ||
      ['not_started', 'committed', 'monitoring', 'verified', 'blocked'].includes(candidate.executionStatus))
  );
}

/** Inspect a candidate without mutating it or granting execution. */
export function assessPlanCandidate(candidate: WeeklyPlanCandidate): WeeklyPlanDecision {
  const reasons: PlanReason[] = [];
  const isValid = valid(candidate);
  if (!isValid) reasons.push('invalid_inputs');

  // A numeric result is permitted only for valid economic inputs.
  const conservativeNetWeekCents =
    isValid && candidate.conservativeWeeklyBenefitCents !== null
      ? candidate.conservativeWeeklyBenefitCents -
        candidate.incrementalWeeklyCostCents -
        Math.ceil(candidate.implementationCostCents / candidate.benefitHorizonWeeks)
      : null;

  if (isValid) {
    if (candidate.executionStatus && candidate.executionStatus !== 'not_started') {
      reasons.push('already_committed');
    }
    if (candidate.guardrail === 'fail') reasons.push('guardrail_failed');
    if (candidate.dataQuality === 'missing') reasons.push('missing_data');
    if (candidate.dataQuality === 'degraded') reasons.push('degraded_data');
    if (candidate.sourceAgeDays > PLAN_MAX_SOURCE_AGE_DAYS) reasons.push('stale_data');
    if (candidate.sourceRefs.length === 0) reasons.push('no_source_evidence');
    if (candidate.confidencePct < PLAN_MIN_CONFIDENCE_PCT) reasons.push('low_confidence');
    if (candidate.guardrail === 'watch') reasons.push('guardrail_watch');
    if (candidate.riskLevel === 'high') reasons.push('high_operational_risk');
    if (!candidate.verificationPlanReady) reasons.push('no_verification_plan');
    if (candidate.conservativeWeeklyBenefitCents === null) reasons.push('no_conservative_benefit');
    if (conservativeNetWeekCents !== null && conservativeNetWeekCents <= 0) {
      reasons.push('nonpositive_net_benefit');
    }
  }

  const hardBlock: readonly PlanReason[] = [
    'invalid_inputs', 'already_committed', 'guardrail_failed', 'missing_data',
  ];
  const readiness: DecisionReadiness =
    reasons.some((reason) => hardBlock.includes(reason))
      ? 'blocked'
      : reasons.length > 0
        ? 'investigate'
        : 'ready_for_review';

  return {
    id: candidate.id,
    locationId: candidate.locationId,
    title: candidate.title,
    readiness,
    reasons,
    conservativeNetWeekCents,
    managerMinutes: candidate.managerMinutes,
    approvalRequired: candidate.approvalRequired ?? 'gm',
    approvalGranted: candidate.approvalGranted === true,
    executionAllowed: false,
    estimatedOnly: true,
    overlapGroup: candidate.overlapGroup || null,
  };
}

/**
 * Construct a human-review-only weekly plan. A review-ready suggestion may
 * still require GM/owner approval; the action transition engine enforces it.
 *
 * This deterministic greedy policy is simple to audit, not globally optimal.
 * Budget minutes are a hard limit, and a known overlap group is selected once.
 */
export function buildWeeklyPlan(
  candidates: readonly WeeklyPlanCandidate[],
  managerBudgetMinutes: number,
): WeeklyPlan {
  if (!Number.isSafeInteger(managerBudgetMinutes) || managerBudgetMinutes < 0) {
    throw new RangeError('managerBudgetMinutes must be a nonnegative integer');
  }
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) throw new Error('duplicate candidate id');
    ids.add(candidate.id);
  }

  const assessed = candidates.map(assessPlanCandidate);
  const blocked = assessed.filter((d) => d.readiness === 'blocked');
  const investigate = assessed.filter((d) => d.readiness === 'investigate');
  const viable = assessed
    .filter((d) => d.readiness === 'ready_for_review')
    .sort((a, b) => {
      const aScore = a.conservativeNetWeekCents! / a.managerMinutes;
      const bScore = b.conservativeNetWeekCents! / b.managerMinutes;
      return (
        bScore - aScore ||
        b.conservativeNetWeekCents! - a.conservativeNetWeekCents! ||
        a.id.localeCompare(b.id)
      );
    });

  let remaining = managerBudgetMinutes;
  const selected: WeeklyPlanDecision[] = [];
  const deferred: WeeklyPlanDecision[] = [];
  const usedOverlapGroups = new Set<string>();

  for (const candidate of viable) {
    if (candidate.overlapGroup && usedOverlapGroups.has(candidate.overlapGroup)) {
      deferred.push({ ...candidate, reasons: ['overlap'] });
      continue;
    }
    if (candidate.managerMinutes > remaining) {
      deferred.push({ ...candidate, reasons: ['insufficient_manager_time'] });
      continue;
    }
    selected.push(candidate);
    remaining -= candidate.managerMinutes;
    if (candidate.overlapGroup) usedOverlapGroups.add(candidate.overlapGroup);
  }

  return {
    selected,
    blocked,
    investigate,
    deferred,
    usedManagerMinutes: managerBudgetMinutes - remaining,
    remainingManagerMinutes: remaining,
    maySumEstimatedSavings: false,
    selectionMethod: 'conservative_greedy_per_manager_minute',
  };
}
