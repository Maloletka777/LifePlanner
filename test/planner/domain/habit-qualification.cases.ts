import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExactQuantity,
  evaluateHabitQualification,
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerTimezone,
  validateTrackingDefinition,
  type ObservationChain,
  type ObservationFact,
  type ObservationValue,
  type PlannerId,
  type TrackingDefinition,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

test('HabitQualificationEvaluator qualifies checkbox true', () => {
  assert.equal(evaluate('checkbox', [chain(1, bool('checkbox', true))]).state, 'qualified');
});

test('HabitQualificationEvaluator keeps checkbox false incomplete', () => {
  assert.equal(evaluate('checkbox', [chain(1, bool('checkbox', false))]).state, 'incomplete');
});

test('HabitQualificationEvaluator qualifies explicit avoidance true', () => {
  assert.equal(evaluate('avoidance', [chain(1, bool('avoidance', true))]).state, 'qualified');
});

test('HabitQualificationEvaluator keeps explicit avoidance false incomplete', () => {
  assert.equal(evaluate('avoidance', [chain(1, bool('avoidance', false))]).state, 'incomplete');
});

test('counter at-least qualifies exactly at target', () => {
  assert.equal(
    evaluate('counter', [chain(1, counter(1)), chain(2, counter(2))]).state,
    'qualified',
  );
});

test('counter at-least remains incomplete below target', () => {
  assert.equal(evaluate('counter', [chain(1, counter(2))]).state, 'incomplete');
});

test('counter equal qualifies only at the exact target', () => {
  assert.equal(
    evaluateWith(tracking('counter', 'equal'), [chain(1, counter(3))]).state,
    'qualified',
  );
  assert.equal(
    evaluateWith(tracking('counter', 'equal'), [chain(1, counter(4))]).state,
    'incomplete',
  );
});

test('counter at-most remains provisional while the window is open', () => {
  assert.equal(
    evaluateWith(tracking('counter', 'at_most'), [chain(1, counter(4))], 'open').state,
    'provisional',
  );
});

test('counter at-most qualifies below or equal to target after close', () => {
  for (const value of [2, 3]) {
    assert.equal(
      evaluateWith(tracking('counter', 'at_most'), [chain(1, counter(value))], 'closed').state,
      'qualified',
    );
  }
});

test('counter at-most is incomplete above target after close', () => {
  assert.equal(
    evaluateWith(tracking('counter', 'at_most'), [chain(1, counter(4))], 'closed').state,
    'incomplete',
  );
});

test('quantity adds exact current roots and qualifies', () => {
  const result = evaluate('quantity', [chain(1, quantity(125, 2)), chain(2, quantity(75, 2))]);
  assert.equal(result.state, 'qualified');
  assert.deepEqual(result.actual, {
    kind: 'quantity',
    value: exact(200, 2),
  });
});

test('quantity qualification never uses floating-point arithmetic', () => {
  const definition = expectSuccess(validateTrackingDefinition({
    trackingMode: 'quantity',
    comparisonOperator: 'equal',
    target: { significand: 30n, scale: 2 },
    unit: { unitType: 'standard', standardUnitCode: 'litre' },
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  }));
  const result = evaluateWith(definition, [
    chain(1, quantity(10, 2)),
    chain(2, quantity(20, 2)),
  ]);
  assert.equal(result.state, 'qualified');
  assert.equal(
    result.actual?.kind === 'quantity' ? result.actual.value.significand : null,
    30n,
  );
});

test('duration adds whole-second roots and qualifies', () => {
  const result = evaluate('duration', [
    chain(1, { type: 'duration', durationSeconds: 1800 }),
    chain(2, { type: 'duration', durationSeconds: 900 }),
  ]);
  assert.equal(result.state, 'qualified');
  assert.deepEqual(result.actual, { kind: 'duration', seconds: 2700 });
});

test('no current fact returns no_current_fact', () => {
  assert.equal(evaluate('checkbox', []).state, 'no_current_fact');
});

test('a voided root contributes no current fact and is reported as voided', () => {
  assert.equal(
    evaluate('checkbox', [voidedChain(1, bool('checkbox', true))]).state,
    'voided',
  );
});

test('skipped returns skipped_policy_unresolved', () => {
  assert.equal(
    evaluate('checkbox', [chain(1, { type: 'skipped' })]).state,
    'skipped_policy_unresolved',
  );
});

test('qualification is independent of observation input ordering', () => {
  const first = chain(1, quantity(125, 2));
  const second = chain(2, quantity(75, 2));
  assert.deepEqual(
    evaluate('quantity', [first, second]),
    evaluate('quantity', [second, first]),
  );
});

test('qualification reports exact additive overflow as a typed failure', () => {
  expectError(
    evaluateHabitQualification({
      tracking: tracking('quantity'),
      observationChains: [
        chain(1, quantity(5_000_000_000_000_000, 2)),
        chain(2, quantity(5_000_000_000_000_000, 2)),
      ],
      evaluationWindow: 'closed',
    }),
    'qualification_exact_value_overflow',
  );
});

function evaluate(
  mode: TrackingDefinition['trackingMode'],
  chains: readonly ObservationChain[],
) {
  return evaluateWith(tracking(mode), chains);
}

function evaluateWith(
  definition: TrackingDefinition,
  chains: readonly ObservationChain[],
  evaluationWindow: 'open' | 'closed' = 'closed',
) {
  return expectSuccess(
    evaluateHabitQualification({
      tracking: definition,
      observationChains: chains,
      evaluationWindow,
    }),
  );
}

function tracking(
  mode: TrackingDefinition['trackingMode'],
  operator: 'at_least' | 'at_most' | 'equal' = 'at_least',
): TrackingDefinition {
  const range = { effectiveFrom: '2026-01-01', effectiveTo: null };
  if (mode === 'checkbox' || mode === 'avoidance') {
    return expectSuccess(
      validateTrackingDefinition({
        ...range,
        trackingMode: mode,
        comparisonOperator: 'boolean_success',
      }),
    );
  }
  if (mode === 'counter') {
    return expectSuccess(
      validateTrackingDefinition({
        ...range,
        trackingMode: mode,
        comparisonOperator: operator,
        target: { significand: 3n, scale: 0 },
        unit: { unitType: 'standard', standardUnitCode: 'session' },
      }),
    );
  }
  if (mode === 'quantity') {
    return expectSuccess(
      validateTrackingDefinition({
        ...range,
        trackingMode: mode,
        comparisonOperator: operator,
        target: { significand: 200n, scale: 2 },
        unit: { unitType: 'standard', standardUnitCode: 'litre' },
      }),
    );
  }
  return expectSuccess(
    validateTrackingDefinition({
      ...range,
      trackingMode: mode,
      comparisonOperator: operator,
      targetDurationSeconds: 2700,
      unit: { unitType: 'standard', standardUnitCode: 'second' },
    }),
  );
}

function bool(
  type: 'checkbox' | 'avoidance',
  booleanValue: boolean,
): ObservationValue {
  return { type, booleanValue };
}

function counter(counterDelta: number): ObservationValue {
  return { type: 'counter', counterDelta };
}

function quantity(significand: number, scale: number): ObservationValue {
  return { type: 'quantity', quantity: exact(significand, scale) };
}

function exact(significand: number, scale: number) {
  return expectSuccess(createExactQuantity({ significand, scale }));
}

function chain(seed: number, value: ObservationValue): ObservationChain {
  const root = fact(seed, value);
  return Object.freeze({
    root,
    facts: Object.freeze([root]),
    currentLeaf: root,
    isVoided: false,
    measuredType:
      value.type === 'skipped' || value.type === 'void' ? null : value.type,
  });
}

function voidedChain(seed: number, value: ObservationValue): ObservationChain {
  const root = fact(seed, value);
  const leaf = fact(seed + 100, { type: 'void' }, {
    supersedesObservationId: root.id,
    correctionReason: 'reversal',
  });
  return Object.freeze({
    root,
    facts: Object.freeze([root, leaf]),
    currentLeaf: leaf,
    isVoided: true,
    measuredType:
      value.type === 'skipped' || value.type === 'void' ? null : value.type,
  });
}

function fact(
  seed: number,
  value: ObservationValue,
  overrides: Partial<ObservationFact> = {},
): ObservationFact {
  return Object.freeze({
    id: id(seed),
    habitId: id(900),
    scheduleVersionId: id(901),
    trackingVersionId: id(902),
    importanceVersionId: id(903),
    dependencyVersionId: null,
    occurrenceLocalDate: expectSuccess(parsePlannerLocalDate('2026-08-03')),
    occurrenceLocalTime: null,
    occurrenceTimezone: expectSuccess(parsePlannerTimezone('Europe/London')),
    observationType: value.type,
    value,
    note: null,
    supersedesObservationId: null,
    correctionReason: null,
    observedAt: 1000 + seed,
    createdAt: 1000 + seed,
    ...overrides,
  });
}

function id(seed: number): PlannerId {
  return expectSuccess(
    parsePlannerId(`00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`),
  );
}
