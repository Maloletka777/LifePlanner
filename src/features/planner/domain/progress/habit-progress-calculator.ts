import { createExactQuantity, type ExactQuantity } from '../exact-quantity/exact-quantity';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import type { HabitQualificationActual } from '../qualification/habit-qualification-evaluator';
import { failure, success, type Result } from '../result';
import type { TrackingDefinition } from '../tracking/tracking-definition';
import type { DependencyExpectationReason, DependencyExpectationState } from '../dependency/dependency-expectation-resolver';
import type { PlannerLocalDate } from '../values/local-date';
import type { ImportanceWeight } from '../values/importance';

export interface ExactProgressFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export type HabitProgressValue =
  | Readonly<{ kind: 'boolean'; value: boolean | null }>
  | Readonly<{ kind: 'exact_quantity'; value: ExactQuantity }>
  | Readonly<{ kind: 'duration_seconds'; value: number }>;

export type HabitProgressExclusionReason =
  | 'blocked'
  | 'future'
  | 'provisional'
  | 'skipped_policy_unresolved';

export interface HabitCompletionProgress {
  readonly completionCredit: ExactProgressFraction;
  readonly actual: HabitProgressValue;
  readonly target: HabitProgressValue;
  readonly inclusion: 'included' | 'excluded';
  readonly exclusionReason: HabitProgressExclusionReason | null;
}

export interface HabitCompletionProgressInput {
  readonly tracking: TrackingDefinition;
  readonly qualificationActual: HabitQualificationActual | null;
  readonly expectationState: DependencyExpectationState;
  readonly expectationReason: DependencyExpectationReason;
  readonly selectedLocalDate: PlannerLocalDate;
  readonly evaluationBoundary: PlannerLocalDate;
}

export interface GroupProgressRowInput {
  readonly included: boolean;
  readonly completionCredit: ExactProgressFraction;
  readonly historicalWeight: ImportanceWeight;
  readonly isChild: boolean;
  readonly qualified: boolean;
}

export interface PlannerGroupProgress {
  readonly includedRowCount: number;
  readonly completionCreditSum: ExactProgressFraction;
  readonly equalProgress: ExactProgressFraction | null;
  readonly weightedNumerator: ExactProgressFraction;
  readonly weightedDenominator: number;
  readonly weightedProgress: ExactProgressFraction | null;
  readonly childCompletedCount: number;
  readonly childApplicableCount: number;
}

const ZERO = Object.freeze({ numerator: 0n, denominator: 1n });
const ONE = Object.freeze({ numerator: 1n, denominator: 1n });

export function calculateHabitCompletionProgress(
  input: HabitCompletionProgressInput,
): Result<HabitCompletionProgress, PlannerDomainError> {
  const values = progressValues(input.tracking, input.qualificationActual);
  if (!values.ok) return values;
  const exclusionReason = progressExclusionReason(input);
  if (exclusionReason !== null) {
    return success(Object.freeze({
      completionCredit: ZERO,
      actual: values.value.actual,
      target: values.value.target,
      inclusion: 'excluded' as const,
      exclusionReason,
    }));
  }
  const credit = input.expectationState === 'qualified'
    ? success(ONE)
    : incompleteCredit(input.tracking, values.value.actual, values.value.target);
  if (!credit.ok) return credit;
  return success(Object.freeze({
    completionCredit: credit.value,
    actual: values.value.actual,
    target: values.value.target,
    inclusion: 'included' as const,
    exclusionReason: null,
  }));
}

export function calculatePlannerGroupProgress(
  rows: readonly GroupProgressRowInput[],
): Result<PlannerGroupProgress, PlannerDomainError> {
  let completionCreditSum: ExactProgressFraction = ZERO;
  let weightedNumerator: ExactProgressFraction = ZERO;
  let includedRowCount = 0;
  let weightedDenominator = 0;
  let childCompletedCount = 0;
  let childApplicableCount = 0;
  for (const row of rows) {
    if (
      row.completionCredit.denominator <= 0n ||
      row.completionCredit.numerator < 0n ||
      row.completionCredit.numerator > row.completionCredit.denominator
    ) {
      return progressFailure('A group row completion credit must be bounded from zero through one.');
    }
    if (!row.included) continue;
    includedRowCount += 1;
    weightedDenominator += row.historicalWeight;
    completionCreditSum = addProgressFractions(completionCreditSum, row.completionCredit);
    weightedNumerator = addProgressFractions(
      weightedNumerator,
      multiplyProgressFraction(row.completionCredit, row.historicalWeight),
    );
    if (row.isChild) {
      childApplicableCount += 1;
      if (row.qualified) childCompletedCount += 1;
    }
  }
  if (!Number.isSafeInteger(weightedDenominator)) return progressFailure('The group progress weight is outside the supported range.');
  const equalProgress = includedRowCount === 0 ? null : divideProgressFraction(completionCreditSum, includedRowCount);
  const weightedProgress = weightedDenominator === 0 ? null : divideProgressFraction(weightedNumerator, weightedDenominator);
  if (
    (equalProgress !== null && equalProgress.numerator > equalProgress.denominator) ||
    (weightedProgress !== null && weightedProgress.numerator > weightedProgress.denominator)
  ) {
    return progressFailure('Calculated group progress is outside the supported zero-through-one range.');
  }
  return success(Object.freeze({
    includedRowCount,
    completionCreditSum,
    equalProgress,
    weightedNumerator,
    weightedDenominator,
    weightedProgress,
    childCompletedCount,
    childApplicableCount,
  }));
}

export function progressFraction(numerator: bigint, denominator: bigint): Result<ExactProgressFraction, PlannerDomainError> {
  if (numerator < 0n || denominator <= 0n) return progressFailure('A progress fraction must be non-negative with a positive denominator.');
  return success(normalizeFraction(numerator, denominator));
}

export function addProgressFractions(left: ExactProgressFraction, right: ExactProgressFraction): ExactProgressFraction {
  return normalizeFraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function multiplyProgressFraction(value: ExactProgressFraction, multiplier: number): ExactProgressFraction {
  return normalizeFraction(value.numerator * BigInt(multiplier), value.denominator);
}

export function divideProgressFraction(value: ExactProgressFraction, divisor: number): ExactProgressFraction {
  return normalizeFraction(value.numerator, value.denominator * BigInt(divisor));
}

function progressValues(
  tracking: TrackingDefinition,
  actual: HabitQualificationActual | null,
): Result<Readonly<{ actual: HabitProgressValue; target: HabitProgressValue }>, PlannerDomainError> {
  switch (tracking.trackingMode) {
    case 'checkbox':
    case 'avoidance':
      if (actual !== null && actual.kind !== 'boolean') return progressFailure('Boolean progress received a mismatched actual value.');
      return success(Object.freeze({
        actual: Object.freeze({ kind: 'boolean' as const, value: actual?.kind === 'boolean' ? actual.value : null }),
        target: Object.freeze({ kind: 'boolean' as const, value: true }),
      }));
    case 'counter': {
      if (actual !== null && actual.kind !== 'counter') return progressFailure('Counter progress received a mismatched actual value.');
      const zero = createExactQuantity({ significand: 0n, scale: 0 });
      if (!zero.ok) return progressFailure('Counter progress could not create an exact zero.');
      return success(Object.freeze({
        actual: Object.freeze({ kind: 'exact_quantity' as const, value: actual?.kind === 'counter' ? actual.value : zero.value }),
        target: Object.freeze({ kind: 'exact_quantity' as const, value: tracking.target }),
      }));
    }
    case 'quantity': {
      if (actual !== null && actual.kind !== 'quantity') return progressFailure('Quantity progress received a mismatched actual value.');
      const zero = createExactQuantity({ significand: 0n, scale: tracking.target.scale });
      if (!zero.ok) return progressFailure('Quantity progress could not create an exact zero.');
      return success(Object.freeze({
        actual: Object.freeze({ kind: 'exact_quantity' as const, value: actual?.kind === 'quantity' ? actual.value : zero.value }),
        target: Object.freeze({ kind: 'exact_quantity' as const, value: tracking.target }),
      }));
    }
    case 'duration':
      if (actual !== null && actual.kind !== 'duration') return progressFailure('Duration progress received a mismatched actual value.');
      return success(Object.freeze({
        actual: Object.freeze({ kind: 'duration_seconds' as const, value: actual?.kind === 'duration' ? actual.seconds : 0 }),
        target: Object.freeze({ kind: 'duration_seconds' as const, value: tracking.targetDurationSeconds }),
      }));
    default:
      return progressFailure('Progress received an unsupported tracking definition.');
  }
}

function progressExclusionReason(input: HabitCompletionProgressInput): HabitProgressExclusionReason | null {
  if (input.selectedLocalDate > input.evaluationBoundary) return 'future';
  if (input.expectationState === 'blocked' || input.expectationState === 'prerequisite_blocked_parent') return 'blocked';
  if (input.expectationState === 'provisional' || input.expectationReason === 'evaluation_window_open') return 'provisional';
  if (input.expectationState === 'skipped_policy_unresolved' || input.expectationReason === 'skipped_policy_pending') return 'skipped_policy_unresolved';
  return null;
}

function incompleteCredit(
  tracking: TrackingDefinition,
  actual: HabitProgressValue,
  target: HabitProgressValue,
): Result<ExactProgressFraction, PlannerDomainError> {
  if (tracking.trackingMode === 'checkbox' || tracking.trackingMode === 'avoidance') return success(ZERO);
  if (tracking.comparisonOperator === 'at_most') return success(ZERO);
  if (actual.kind === 'exact_quantity' && target.kind === 'exact_quantity') {
    return success(clampedExactQuantityRatio(actual.value, target.value));
  }
  if (actual.kind === 'duration_seconds' && target.kind === 'duration_seconds') {
    return success(clampedRatio(BigInt(actual.value), BigInt(target.value)));
  }
  return progressFailure('Numeric progress received incompatible actual and target values.');
}

function clampedExactQuantityRatio(actual: ExactQuantity, target: ExactQuantity): ExactProgressFraction {
  const commonScale = Math.max(actual.scale, target.scale);
  const numerator = actual.significand * 10n ** BigInt(commonScale - actual.scale);
  const denominator = target.significand * 10n ** BigInt(commonScale - target.scale);
  return clampedRatio(numerator, denominator);
}

function clampedRatio(numerator: bigint, denominator: bigint): ExactProgressFraction {
  if (numerator <= 0n) return ZERO;
  if (numerator >= denominator) return ONE;
  return normalizeFraction(numerator, denominator);
}

function normalizeFraction(numerator: bigint, denominator: bigint): ExactProgressFraction {
  const divisor = greatestCommonDivisor(numerator, denominator);
  return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function progressFailure(message: string): Result<never, PlannerDomainError> {
  return failure(createPlannerDomainError('qualification_invalid_tracking_context', message));
}
