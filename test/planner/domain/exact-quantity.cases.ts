import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addExactQuantities,
  compareExactQuantities,
  createExactQuantity,
  exactQuantitiesEqual,
  formatExactQuantity,
  JAVASCRIPT_SAFE_INTEGER_MAX,
  normalizeExactQuantity,
  parseExactQuantity,
  SQLITE_SIGNED_64_MAX,
  subtractExactQuantities,
  validatePositiveExactQuantity,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

test('canonical decimal parsing and formatting preserve exact significand and scale', () => {
  const parsed = expectSuccess(parseExactQuantity('1.25'));
  assert.equal(parsed.significand, 125n);
  assert.equal(parsed.scale, 2);
  assert.equal(formatExactQuantity(parsed), '1.25');
  assert.equal(Object.isFrozen(parsed), true);

  const fixed = expectSuccess(
    createExactQuantity({ significand: 200n, scale: 2 }),
  );
  assert.equal(formatExactQuantity(fixed), '2');
  assert.equal(formatExactQuantity(fixed, { fixedScale: true }), '2.00');
});

test('exact decimal parsing supports every canonical scale from zero through six', () => {
  for (let scale = 0; scale <= 6; scale += 1) {
    const text = scale === 0 ? '1' : `1.${'0'.repeat(scale - 1)}1`;
    const parsed = expectSuccess(parseExactQuantity(text));
    assert.equal(parsed.scale, scale, text);
    assert.equal(parsed.significand, scale === 0 ? 1n : BigInt(`1${'0'.repeat(scale - 1)}1`), text);
  }
});

test('normalization changes scale exactly and rejects precision loss', () => {
  const two = expectSuccess(parseExactQuantity('2'));
  const scaled = expectSuccess(normalizeExactQuantity(two, 2));
  assert.equal(scaled.significand, 200n);
  assert.equal(scaled.scale, 2);

  const exactDownscale = expectSuccess(normalizeExactQuantity(scaled, 0));
  assert.equal(exactDownscale.significand, 2n);
  expectError(
    normalizeExactQuantity(expectSuccess(parseExactQuantity('1.25')), 1),
    'exact_quantity_precision_exceeded',
  );
});

test('addition and subtraction use exact integer-and-scale arithmetic', () => {
  const half = expectSuccess(parseExactQuantity('0.50'));
  const quarter = expectSuccess(parseExactQuantity('0.25'));
  const one = expectSuccess(addExactQuantities(half, half));
  const total = expectSuccess(addExactQuantities(one, quarter));
  assert.equal(total.significand, 125n);
  assert.equal(total.scale, 2);
  assert.equal(formatExactQuantity(total), '1.25');

  const tenth = expectSuccess(parseExactQuantity('0.1'));
  const twoTenths = expectSuccess(addExactQuantities(tenth, tenth));
  const threeTenths = expectSuccess(
    addExactQuantities(twoTenths, expectSuccess(parseExactQuantity('0.1'))),
  );
  assert.equal(formatExactQuantity(threeTenths), '0.3');
  assert.equal(
    formatExactQuantity(
      expectSuccess(subtractExactQuantities(total, quarter)),
    ),
    '1',
  );
});

test('comparison and equality work across different scales', () => {
  const two = expectSuccess(parseExactQuantity('2'));
  const twoFixed = expectSuccess(parseExactQuantity('2.00'));
  const smaller = expectSuccess(parseExactQuantity('1.999'));
  assert.equal(compareExactQuantities(two, twoFixed), 0);
  assert.equal(exactQuantitiesEqual(two, twoFixed), true);
  assert.equal(compareExactQuantities(smaller, two), -1);
});

test('precision, locale separators, unsafe integers, and 64-bit overflow are rejected', () => {
  expectError(
    parseExactQuantity('1.1234567'),
    'exact_quantity_precision_exceeded',
  );
  expectError(parseExactQuantity('1,25'), 'invalid_exact_quantity');
  expectError(parseExactQuantity('1 000.25'), 'invalid_exact_quantity');
  expectError(parseExactQuantity('1e3'), 'invalid_exact_quantity');
  expectError(
    createExactQuantity({
      significand: Number.MAX_SAFE_INTEGER + 1,
      scale: 0,
    }),
    'exact_quantity_overflow',
  );
  const unsafeRuntimeError = expectError(
    createExactQuantity({
      significand: JAVASCRIPT_SAFE_INTEGER_MAX + 1n,
      scale: 0,
    }),
    'exact_quantity_overflow',
  );
  assert.equal(unsafeRuntimeError.diagnostics?.limit, 'javascript_safe_integer');
  const sqliteError = expectError(
    createExactQuantity({
      significand: SQLITE_SIGNED_64_MAX + 1n,
      scale: 0,
    }),
    'exact_quantity_overflow',
  );
  assert.equal(sqliteError.diagnostics?.limit, 'sqlite_signed_64');
});

test('positive exact targets reject zero and negative values', () => {
  expectError(
    validatePositiveExactQuantity(expectSuccess(parseExactQuantity('0'))),
    'invalid_exact_quantity',
  );
  expectError(
    validatePositiveExactQuantity(expectSuccess(parseExactQuantity('-1'))),
    'invalid_exact_quantity',
  );
  assert.equal(
    expectSuccess(
      validatePositiveExactQuantity(expectSuccess(parseExactQuantity('0.01'))),
    ).significand,
    1n,
  );
});
