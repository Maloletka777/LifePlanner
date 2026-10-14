import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateHabitCompletionProgress,
  calculatePlannerGroupProgress,
  calculateRoutineStepProgress,
  createExactQuantity,
  parsePlannerLocalDate,
  validateTrackingDefinition,
  type HabitCompletionProgressInput,
  type HabitQualificationActual,
  type TrackingDefinition,
} from '../../../src/features/planner/domain';
import { expectSuccess } from './test-helpers';

const DATE = expectSuccess(parsePlannerLocalDate('2026-07-22'));
const FUTURE = expectSuccess(parsePlannerLocalDate('2026-07-23'));
const RANGE = { effectiveFrom: DATE, effectiveTo: null } as const;

test('checkbox and avoidance credit is exact, bounded, and based on explicit success', () => {
  const checkbox = progress(tracking('checkbox'), { kind: 'boolean', value: true }, 'qualified');
  assert.deepEqual(checkbox.completionCredit, fraction(1n, 1n));
  assert.equal(checkbox.inclusion, 'included');
  const avoidance = progress(tracking('avoidance'), { kind: 'boolean', value: false }, 'expected_incomplete');
  assert.deepEqual(avoidance.completionCredit, fraction(0n, 1n));
  assert.deepEqual(avoidance.actual, { kind: 'boolean', value: false });
});

test('counter, quantity, and duration partial credit uses exact clamped ratios', () => {
  const counter = progress(tracking('counter'), exactActual('counter', 1n, 0), 'expected_incomplete');
  assert.deepEqual(counter.completionCredit, fraction(1n, 4n));
  const quantity = progress(tracking('quantity'), exactActual('quantity', 125n, 2), 'expected_incomplete');
  assert.deepEqual(quantity.completionCredit, fraction(5n, 8n));
  const differentlyScaledQuantity = progress(tracking('quantity'), exactActual('quantity', 5n, 1), 'expected_incomplete');
  assert.deepEqual(differentlyScaledQuantity.completionCredit, fraction(1n, 4n));
  const duration = progress(tracking('duration'), { kind: 'duration', seconds: 45 }, 'expected_incomplete');
  assert.deepEqual(duration.completionCredit, fraction(3n, 4n));
});

test('equal clamps actual over target while failed at-most credit is zero', () => {
  const equal = progress(tracking('quantity', 'equal'), exactActual('quantity', 250n, 2), 'expected_incomplete');
  assert.deepEqual(equal.completionCredit, fraction(1n, 1n));
  const atMost = progress(tracking('counter', 'at_most'), exactActual('counter', 5n, 0), 'expected_incomplete');
  assert.deepEqual(atMost.completionCredit, fraction(0n, 1n));
});

test('blocked, future, provisional, and policy-unresolved rows are neutral exclusions', () => {
  const cases = [
    { state: 'blocked', reason: 'parent_not_qualified', selectedLocalDate: DATE, exclusion: 'blocked' },
    { state: 'expected_incomplete', reason: null, selectedLocalDate: FUTURE, exclusion: 'future' },
    { state: 'provisional', reason: 'evaluation_window_open', selectedLocalDate: DATE, exclusion: 'provisional' },
    { state: 'skipped_policy_unresolved', reason: 'skipped_policy_pending', selectedLocalDate: DATE, exclusion: 'skipped_policy_unresolved' },
  ] as const;
  for (const item of cases) {
    const result = expectSuccess(calculateHabitCompletionProgress({
      tracking: tracking('checkbox'),
      qualificationActual: null,
      expectationState: item.state,
      expectationReason: item.reason,
      selectedLocalDate: item.selectedLocalDate,
      evaluationBoundary: DATE,
    }));
    assert.equal(result.inclusion, 'excluded');
    assert.equal(result.exclusionReason, item.exclusion);
    assert.deepEqual(result.completionCredit, fraction(0n, 1n));
  }
});

test('group progress derives exact equal and weighted arithmetic without writes', () => {
  const result = expectSuccess(calculatePlannerGroupProgress([
    { included: true, completionCredit: fraction(1n, 1n), historicalWeight: 3, isChild: false, qualified: true },
    { included: true, completionCredit: fraction(1n, 2n), historicalWeight: 1, isChild: true, qualified: false },
    { included: false, completionCredit: fraction(0n, 1n), historicalWeight: 4, isChild: true, qualified: false },
  ]));
  assert.deepEqual(result, {
    includedRowCount: 2,
    completionCreditSum: fraction(3n, 2n),
    equalProgress: fraction(3n, 4n),
    weightedNumerator: fraction(7n, 2n),
    weightedDenominator: 4,
    weightedProgress: fraction(7n, 8n),
    childCompletedCount: 0,
    childApplicableCount: 1,
  });
  const empty = expectSuccess(calculatePlannerGroupProgress([]));
  assert.equal(empty.equalProgress, null);
  assert.equal(empty.weightedProgress, null);
});

test('one root plus one applicable child yields exact 0, one-half, one-half, and one credit', () => {
  const cases = [
    [false, false, fraction(0n, 1n)],
    [false, true, fraction(1n, 2n)],
    [true, false, fraction(1n, 2n)],
    [true, true, fraction(1n, 1n)],
  ] as const;
  for (const [rootComplete, childComplete, expected] of cases) {
    const result = expectSuccess(calculatePlannerGroupProgress([
      { included: true, completionCredit: fraction(rootComplete ? 1n : 0n, 1n), historicalWeight: 2, isChild: false, qualified: rootComplete },
      { included: true, completionCredit: fraction(childComplete ? 1n : 0n, 1n), historicalWeight: 2, isChild: true, qualified: childComplete },
    ]));
    assert.deepEqual(result.equalProgress, expected);
    assert.equal(result.childApplicableCount, 1);
    assert.equal(result.childCompletedCount, childComplete ? 1 : 0);
  }
});

test('group progress rejects an unbounded row credit', () => {
  const result = calculatePlannerGroupProgress([
    { included: true, completionCredit: fraction(3n, 2n), historicalWeight: 1, isChild: false, qualified: true },
  ]);
  assert.equal(result.ok, false);
});

test('routine-step progress uses only applicable direct credits and completes only when all apply', () => {
  const result = expectSuccess(calculateRoutineStepProgress([
    { applicable: true, completionCredit: fraction(1n, 1n), isCanonicallyComplete: true },
    { applicable: true, completionCredit: fraction(1n, 2n), isCanonicallyComplete: false },
    { applicable: false, completionCredit: fraction(1n, 1n), isCanonicallyComplete: true },
  ]));
  assert.deepEqual(result, {
    applicableStepCount: 2,
    completedStepCount: 1,
    remainingStepCount: 1,
    exactProgress: fraction(3n, 4n),
    isCanonicallyComplete: false,
  });
});

test('routine-step progress makes no-applicable explicit and rejects impossible credit', () => {
  assert.deepEqual(expectSuccess(calculateRoutineStepProgress([
    { applicable: false, completionCredit: fraction(1n, 1n), isCanonicallyComplete: true },
  ])), {
    applicableStepCount: 0,
    completedStepCount: 0,
    remainingStepCount: 0,
    exactProgress: null,
    isCanonicallyComplete: false,
  });
  assert.equal(calculateRoutineStepProgress([
    { applicable: true, completionCredit: fraction(2n, 1n), isCanonicallyComplete: true },
  ]).ok, false);
});

function progress(
  definition: TrackingDefinition,
  qualificationActual: HabitQualificationActual | null,
  expectationState: HabitCompletionProgressInput['expectationState'],
) {
  return expectSuccess(calculateHabitCompletionProgress({
    tracking: definition,
    qualificationActual,
    expectationState,
    expectationReason: null,
    selectedLocalDate: DATE,
    evaluationBoundary: DATE,
  }));
}

function tracking(mode: TrackingDefinition['trackingMode'], operator: 'at_least' | 'at_most' | 'equal' = 'at_least'): TrackingDefinition {
  if (mode === 'checkbox' || mode === 'avoidance') return expectSuccess(validateTrackingDefinition({ ...RANGE, trackingMode: mode, comparisonOperator: 'boolean_success' }));
  if (mode === 'counter') return expectSuccess(validateTrackingDefinition({ ...RANGE, trackingMode: mode, comparisonOperator: operator, target: { significand: 4n, scale: 0 }, unit: { unitType: 'standard', standardUnitCode: 'repetition' } }));
  if (mode === 'quantity') return expectSuccess(validateTrackingDefinition({ ...RANGE, trackingMode: mode, comparisonOperator: operator, target: { significand: 200n, scale: 2 }, unit: { unitType: 'standard', standardUnitCode: 'litre' } }));
  return expectSuccess(validateTrackingDefinition({ ...RANGE, trackingMode: mode, comparisonOperator: operator, targetDurationSeconds: 60, unit: { unitType: 'standard', standardUnitCode: 'second' } }));
}

function exactActual(kind: 'counter' | 'quantity', significand: bigint, scale: number): HabitQualificationActual {
  const value = expectSuccess(createExactQuantity({ significand, scale }));
  return kind === 'counter'
    ? { kind, value: value as typeof value & { readonly scale: 0 } }
    : { kind, value };
}

function fraction(numerator: bigint, denominator: bigint) {
  return { numerator, denominator };
}
