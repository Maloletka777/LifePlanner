import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExactQuantity,
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerTimezone,
  validateObservationChain,
  validateObservationValue,
  validateObservationValueShape,
  validateTrackingDefinition,
  type ObservationFact,
  type ObservationValue,
  type PlannerId,
  type TrackingDefinition,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

test('ObservationValueValidator accepts all tracking values and skipped', () => {
  const fixtures: readonly [TrackingDefinition, ObservationValue][] = [
    [tracking('checkbox'), { type: 'checkbox', booleanValue: true }],
    [tracking('avoidance'), { type: 'avoidance', booleanValue: false }],
    [tracking('counter'), { type: 'counter', counterDelta: 2 }],
    [
      tracking('quantity'),
      {
        type: 'quantity',
        quantity: expectSuccess(createExactQuantity({ significand: 125n, scale: 2 })),
      },
    ],
    [tracking('duration'), { type: 'duration', durationSeconds: 900 }],
  ];
  for (const [definition, value] of fixtures) {
    assert.equal(validateObservationValue(value, definition, { allowVoid: false }).ok, true);
    assert.equal(
      validateObservationValue({ type: 'skipped' }, definition, { allowVoid: false }).ok,
      true,
    );
  }
});

test('ObservationValueValidator rejects type and normalized quantity scale mismatches', () => {
  expectError(
    validateObservationValue(
      { type: 'quantity', quantity: { significand: 1n, scale: 2 } },
      tracking('counter'),
      { allowVoid: false },
    ),
    'observation_type_mismatch',
  );
  expectError(
    validateObservationValue(
      { type: 'quantity', quantity: { significand: 1n, scale: 1 } },
      tracking('quantity'),
      { allowVoid: false },
    ),
    'observation_quantity_scale_mismatch',
  );
});

test('ObservationValueValidator rejects non-positive additive values and measured skipped facts', () => {
  for (const value of [
    { type: 'counter', counterDelta: 0 },
    { type: 'counter', counterDelta: -1 },
    { type: 'quantity', quantity: { significand: 0n, scale: 2 } },
    { type: 'quantity', quantity: { significand: -1n, scale: 2 } },
    { type: 'duration', durationSeconds: 0 },
    { type: 'duration', durationSeconds: 1.5 },
    { type: 'skipped', counterDelta: 1 },
  ]) {
    expectError(
      validateObservationValueShape(value, { allowVoid: false }),
      'observation_invalid_value',
    );
  }
  expectError(
    validateObservationValueShape({ type: 'void' }, { allowVoid: false }),
    'observation_invalid_correction',
  );
  assert.deepEqual(
    expectSuccess(validateObservationValueShape({ type: 'void' }, { allowVoid: true })),
    { type: 'void' },
  );
});

test('ObservationChainValidator resolves a root, linear correction, and void leaf by links', () => {
  const root = fact(1);
  const correction = fact(2, {
    supersedesObservationId: root.id,
    correctionReason: 'correct_value',
    value: { type: 'checkbox', booleanValue: true },
    observationType: 'checkbox',
  });
  const voided = fact(3, {
    supersedesObservationId: correction.id,
    correctionReason: 'reversal',
    value: { type: 'void' },
    observationType: 'void',
  });
  const one = expectSuccess(validateObservationChain([root]));
  assert.equal(one.currentLeaf.id, root.id);
  const linear = expectSuccess(validateObservationChain([correction, root]));
  assert.deepEqual(linear.facts.map(({ id }) => id), [root.id, correction.id]);
  const chain = expectSuccess(validateObservationChain([voided, root, correction]));
  assert.equal(chain.currentLeaf.id, voided.id);
  assert.equal(chain.isVoided, true);
});

test('ObservationChainValidator rejects branches, cycles, missing parents, and cross-habit links', () => {
  const root = fact(10);
  const first = fact(11, {
    supersedesObservationId: root.id,
    correctionReason: 'correct_value',
  });
  const second = fact(12, {
    supersedesObservationId: root.id,
    correctionReason: 'correct_value',
  });
  expectError(
    validateObservationChain([root, first, second]),
    'observation_correction_branch',
  );

  const cycleA = fact(20, {
    supersedesObservationId: id(21),
    correctionReason: 'other',
  });
  const cycleB = fact(21, {
    supersedesObservationId: cycleA.id,
    correctionReason: 'other',
  });
  expectError(validateObservationChain([cycleA, cycleB]), 'observation_correction_cycle');

  expectError(
    validateObservationChain([
      fact(30, { supersedesObservationId: id(999), correctionReason: 'other' }),
    ]),
    'observation_data_integrity_failure',
  );
  expectError(
    validateObservationChain([
      root,
      fact(31, {
        habitId: id(500),
        supersedesObservationId: root.id,
        correctionReason: 'other',
      }),
    ]),
    'observation_context_mismatch',
  );
});

test('ObservationChainValidator allows correction of only the current leaf', () => {
  const root = fact(40);
  const leaf = fact(41, {
    supersedesObservationId: root.id,
    correctionReason: 'correct_value',
  });
  expectError(
    validateObservationChain([root, leaf], { selectedObservationId: root.id }),
    'observation_not_current_leaf',
  );
  assert.equal(
    validateObservationChain([root, leaf], { selectedObservationId: leaf.id }).ok,
    true,
  );
});

function tracking(mode: TrackingDefinition['trackingMode']): TrackingDefinition {
  const base = {
    trackingMode: mode,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  };
  switch (mode) {
    case 'checkbox':
    case 'avoidance':
      return expectSuccess(validateTrackingDefinition({ ...base, comparisonOperator: 'boolean_success' }));
    case 'counter':
      return expectSuccess(validateTrackingDefinition({
        ...base,
        comparisonOperator: 'at_least',
        target: { significand: 3n, scale: 0 },
        unit: { unitType: 'standard', standardUnitCode: 'session' },
      }));
    case 'quantity':
      return expectSuccess(validateTrackingDefinition({
        ...base,
        comparisonOperator: 'at_least',
        target: { significand: 200n, scale: 2 },
        unit: { unitType: 'standard', standardUnitCode: 'litre' },
      }));
    case 'duration':
      return expectSuccess(validateTrackingDefinition({
        ...base,
        comparisonOperator: 'at_least',
        targetDurationSeconds: 60,
        unit: { unitType: 'standard', standardUnitCode: 'second' },
      }));
  }
}

function fact(seed: number, overrides: Partial<ObservationFact> = {}): ObservationFact {
  const value = overrides.value ?? { type: 'checkbox', booleanValue: false };
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
