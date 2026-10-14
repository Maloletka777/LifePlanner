import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COUNTER_STANDARD_UNIT_CODES,
  convertExactStandardUnit,
  createExactQuantity,
  DURATION_STANDARD_UNIT_CODES,
  parseExactQuantity,
  QUANTITY_STANDARD_UNIT_CODES,
  STANDARD_UNIT_DEFINITIONS,
  standardUnitLabel,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

test('standard unit registry exposes every approved stable semantic code', () => {
  assert.deepEqual(Object.keys(STANDARD_UNIT_DEFINITIONS), [
    'millilitre', 'litre',
    'gram', 'kilogram',
    'metre', 'kilometre',
    'repetition', 'page', 'serving', 'session',
    'second', 'minute', 'hour',
  ]);
  assert.deepEqual(COUNTER_STANDARD_UNIT_CODES, ['repetition', 'page', 'serving', 'session']);
  assert.deepEqual(QUANTITY_STANDARD_UNIT_CODES, ['millilitre', 'litre', 'gram', 'kilogram', 'metre', 'kilometre']);
  assert.deepEqual(DURATION_STANDARD_UNIT_CODES, ['second', 'minute', 'hour']);
  assert.equal(standardUnitLabel('litre', 'symbol'), 'L');
  assert.equal(standardUnitLabel('page', 'singular'), 'page');
  assert.equal(standardUnitLabel('kilogram'), 'kilograms');
});

test('compatible standard units convert with exact integer-and-scale arithmetic', () => {
  const cases = [
    ['500', 'millilitre', 'litre', 5n, 1],
    ['0.5', 'litre', 'millilitre', 500n, 0],
    ['1250', 'gram', 'kilogram', 125n, 2],
    ['1.25', 'kilogram', 'gram', 1250n, 0],
    ['2500', 'metre', 'kilometre', 25n, 1],
    ['1.5', 'kilometre', 'metre', 1500n, 0],
    ['90', 'second', 'minute', 15n, 1],
    ['1.5', 'minute', 'second', 90n, 0],
    ['2', 'hour', 'minute', 120n, 0],
  ] as const;

  for (const [input, from, to, significand, scale] of cases) {
    const converted = expectSuccess(
      convertExactStandardUnit(expectSuccess(parseExactQuantity(input)), from, to),
    );
    assert.deepEqual(converted, expectSuccess(createExactQuantity({ significand, scale })), `${input} ${from} to ${to}`);
  }
});

test('unit conversion rejects incompatible meanings and non-representable precision', () => {
  const one = expectSuccess(parseExactQuantity('1'));
  expectError(convertExactStandardUnit(one, 'litre', 'kilogram'), 'invalid_tracking_definition');
  expectError(convertExactStandardUnit(one, 'repetition', 'page'), 'invalid_tracking_definition');
  expectError(convertExactStandardUnit(one, 'second', 'minute'), 'exact_quantity_precision_exceeded');
});
