import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CUSTOM_UNIT_LABEL_LENGTH,
  validateTrackingDefinition,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

const trackingBase = {
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
} as const;

test('all five tracking discriminators accept a valid fixture', () => {
  const checkbox = expectSuccess(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'checkbox',
      comparisonOperator: 'boolean_success',
    }),
  );
  const avoidance = expectSuccess(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'avoidance',
      comparisonOperator: 'boolean_success',
    }),
  );
  const counter = expectSuccess(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'counter',
      comparisonOperator: 'at_least',
      target: { significand: 3n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode: 'session' },
    }),
  );
  const quantity = expectSuccess(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'at_least',
      target: { significand: 200n, scale: 2 },
      unit: { unitType: 'standard', standardUnitCode: 'litre' },
    }),
  );
  const duration = expectSuccess(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'duration',
      comparisonOperator: 'at_least',
      targetDurationSeconds: 2700,
      unit: { unitType: 'standard', standardUnitCode: 'second' },
    }),
  );

  assert.deepEqual(
    [checkbox, avoidance, counter, quantity, duration].map(
      (definition) => definition.trackingMode,
    ),
    ['checkbox', 'avoidance', 'counter', 'quantity', 'duration'],
  );
});

test('boolean tracking rejects numeric, unit, and incompatible operator fields', () => {
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'checkbox',
      comparisonOperator: 'boolean_success',
      target: { significand: 1n, scale: 0 },
    }),
    'invalid_tracking_definition',
  );
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'avoidance',
      comparisonOperator: 'boolean_success',
      unit: { unitType: 'none' },
    }),
    'invalid_tracking_definition',
  );
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'checkbox',
      comparisonOperator: 'equal',
    }),
    'invalid_tracking_definition',
  );
});

test('counter requires a positive integral target at scale zero', () => {
  for (const target of [
    { significand: 3n, scale: 1 },
    { significand: 0n, scale: 0 },
    { significand: 1.5, scale: 0 },
  ]) {
    expectError(
      validateTrackingDefinition({
        ...trackingBase,
        trackingMode: 'counter',
        comparisonOperator: 'equal',
        target,
        unit: { unitType: 'none' },
      }),
      target.scale === 1
        ? 'invalid_tracking_definition'
        : 'invalid_exact_quantity',
    );
  }
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'counter',
      comparisonOperator: 'equal',
      target: { significand: 1n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode: 'litre' },
    }),
    'invalid_tracking_definition',
  );
});

test('quantity requires a positive exact target and compatible unit', () => {
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'at_least',
      target: { significand: 2n, scale: 0 },
      unit: { unitType: 'none' },
    }),
    'invalid_tracking_definition',
  );
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'at_least',
      target: { significand: 2n, scale: 7 },
      unit: { unitType: 'standard', standardUnitCode: 'litre' },
    }),
    'invalid_exact_quantity',
  );
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'at_least',
      target: { significand: -2n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode: 'litre' },
    }),
    'invalid_exact_quantity',
  );
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'at_least',
      target: { significand: 2n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode: 'second' },
    }),
    'invalid_tracking_definition',
  );
});

test('mode-specific standard units accept the expanded catalogue exhaustively', () => {
  for (const standardUnitCode of ['repetition', 'page', 'serving', 'session'] as const) {
    const result = validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'counter',
      comparisonOperator: 'at_least',
      target: { significand: 1n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode },
    });
    assert.equal(result.ok, true, standardUnitCode);
  }
  for (const standardUnitCode of ['millilitre', 'litre', 'gram', 'kilogram', 'metre', 'kilometre'] as const) {
    const result = validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'at_least',
      target: { significand: 1n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode },
    });
    assert.equal(result.ok, true, standardUnitCode);
  }
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'counter',
      comparisonOperator: 'at_least',
      target: { significand: 1n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode: 'gram' },
    }),
    'invalid_tracking_definition',
  );
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'at_least',
      target: { significand: 1n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode: 'page' },
    }),
    'invalid_tracking_definition',
  );
});

test('duration is positive whole seconds using only standard second', () => {
  for (const targetDurationSeconds of [0, -1, 1.5]) {
    expectError(
      validateTrackingDefinition({
        ...trackingBase,
        trackingMode: 'duration',
        comparisonOperator: 'at_least',
        targetDurationSeconds,
        unit: { unitType: 'standard', standardUnitCode: 'second' },
      }),
      'invalid_tracking_definition',
    );
  }
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'duration',
      comparisonOperator: 'at_least',
      targetDurationSeconds: 60,
      unit: { unitType: 'standard', standardUnitCode: 'session' },
    }),
    'invalid_tracking_definition',
  );
});

test('custom units normalize whitespace and enforce the frozen 40-character limit', () => {
  const boundaryLabel = 'u'.repeat(MAX_CUSTOM_UNIT_LABEL_LENGTH);
  const valid = expectSuccess(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'equal',
      target: { significand: 1n, scale: 0 },
      unit: { unitType: 'custom', customUnitLabel: ` ${boundaryLabel} ` },
    }),
  );
  assert.equal(
    valid.trackingMode === 'quantity' && valid.unit.unitType === 'custom'
      ? valid.unit.customUnitLabel
      : null,
    boundaryLabel,
  );

  for (const label of ['', ' '.repeat(3), 'u'.repeat(41)]) {
    expectError(
      validateTrackingDefinition({
        ...trackingBase,
        trackingMode: 'quantity',
        comparisonOperator: 'equal',
        target: { significand: 1n, scale: 0 },
        unit: { unitType: 'custom', customUnitLabel: label },
      }),
      'invalid_tracking_definition',
    );
  }
});

test('unit shapes cannot set standard and custom values simultaneously', () => {
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'equal',
      target: { significand: 1n, scale: 0 },
      unit: {
        unitType: 'standard',
        standardUnitCode: 'litre',
        customUnitLabel: 'bottle',
      },
    }),
    'invalid_tracking_definition',
  );
});

test('unknown tracking modes, operators, and units return stored-value errors', () => {
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'rating',
      comparisonOperator: 'equal',
    }),
    'unsupported_stored_value',
  );
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'checkbox',
      comparisonOperator: 'approximately',
    }),
    'unsupported_stored_value',
  );
  expectError(
    validateTrackingDefinition({
      ...trackingBase,
      trackingMode: 'quantity',
      comparisonOperator: 'equal',
      target: { significand: 1n, scale: 0 },
      unit: { unitType: 'standard', standardUnitCode: 'gallon' },
    }),
    'unsupported_stored_value',
  );
});
