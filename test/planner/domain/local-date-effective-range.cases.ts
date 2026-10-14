import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addPlannerCalendarDays,
  comparePlannerLocalDates,
  effectiveRangesIntersect,
  isLocalDateInEffectiveRange,
  measurePlannerCalendarDays,
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  parsePlannerTimezone,
  validateEffectiveRange,
  validateEffectiveRangesDoNotOverlap,
  validateNoEffectiveRangeOverlap,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

test('local dates validate real Gregorian days and canonical syntax', () => {
  assert.equal(expectSuccess(parsePlannerLocalDate('2024-02-29')), '2024-02-29');
  assert.equal(expectSuccess(parsePlannerLocalDate('2026-04-30')), '2026-04-30');
  expectError(parsePlannerLocalDate('2026-02-30'), 'invalid_local_date');
  expectError(parsePlannerLocalDate('2025-02-29'), 'invalid_local_date');
  expectError(parsePlannerLocalDate('2026-04-31'), 'invalid_local_date');
  expectError(parsePlannerLocalDate('2026-4-03'), 'invalid_local_date');
  expectError(parsePlannerLocalDate('2026-04-3'), 'invalid_local_date');
  expectError(parsePlannerLocalDate('0000-01-01'), 'invalid_local_date');
});

test('local times and IANA timezones validate without device state', () => {
  assert.equal(expectSuccess(parsePlannerLocalTime('23:59')), '23:59');
  expectError(parsePlannerLocalTime('24:00'), 'invalid_local_time');
  expectError(parsePlannerLocalTime('9:30'), 'invalid_local_time');

  assert.equal(
    expectSuccess(parsePlannerTimezone('Europe/London')),
    'Europe/London',
  );
  assert.equal(
    expectSuccess(parsePlannerTimezone('Europe/Stockholm')),
    'Europe/Stockholm',
  );
  expectError(parsePlannerTimezone('Europe/Not_A_Zone'), 'invalid_timezone');
});

test('local date comparison and calendar-day arithmetic are deterministic', () => {
  const leapDay = expectSuccess(parsePlannerLocalDate('2024-02-29'));
  const marchFirst = expectSuccess(parsePlannerLocalDate('2024-03-01'));
  assert.equal(comparePlannerLocalDates(leapDay, marchFirst), -1);
  assert.equal(comparePlannerLocalDates(leapDay, leapDay), 0);
  assert.equal(measurePlannerCalendarDays(leapDay, marchFirst), 1);
  assert.equal(expectSuccess(addPlannerCalendarDays(leapDay, 1)), marchFirst);
  assert.equal(
    expectSuccess(addPlannerCalendarDays(marchFirst, -1)),
    leapDay,
  );
});

test('effective ranges use inclusive starts and exclusive ends', () => {
  const closed = expectSuccess(
    validateEffectiveRange({
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-02-01',
    }),
  );
  const start = expectSuccess(parsePlannerLocalDate('2026-01-01'));
  const lastInside = expectSuccess(parsePlannerLocalDate('2026-01-31'));
  const exclusiveEnd = expectSuccess(parsePlannerLocalDate('2026-02-01'));
  assert.equal(isLocalDateInEffectiveRange(start, closed), true);
  assert.equal(isLocalDateInEffectiveRange(lastInside, closed), true);
  assert.equal(isLocalDateInEffectiveRange(exclusiveEnd, closed), false);

  const open = expectSuccess(
    validateEffectiveRange({
      effectiveFrom: '2026-02-01',
      effectiveTo: null,
    }),
  );
  assert.equal(isLocalDateInEffectiveRange(exclusiveEnd, open), true);
  assert.equal(effectiveRangesIntersect(closed, open), false);
  assert.equal(
    expectSuccess(validateNoEffectiveRangeOverlap(open, [closed])),
    null,
  );
});

test('effective range overlap catches closed and open intersections', () => {
  const first = expectSuccess(
    validateEffectiveRange({
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-02-01',
    }),
  );
  const overlapping = expectSuccess(
    validateEffectiveRange({
      effectiveFrom: '2026-01-15',
      effectiveTo: '2026-03-01',
    }),
  );
  const open = expectSuccess(
    validateEffectiveRange({
      effectiveFrom: '2026-01-20',
      effectiveTo: null,
    }),
  );
  assert.equal(effectiveRangesIntersect(first, overlapping), true);
  assert.equal(effectiveRangesIntersect(first, open), true);
  expectError(
    validateNoEffectiveRangeOverlap(overlapping, [first]),
    'overlapping_effective_range',
  );
  expectError(
    validateEffectiveRangesDoNotOverlap([first, open]),
    'overlapping_effective_range',
  );
});

test('zero-length and reversed effective ranges are rejected', () => {
  expectError(
    validateEffectiveRange({
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-01-01',
    }),
    'invalid_effective_range',
  );
  expectError(
    validateEffectiveRange({
      effectiveFrom: '2026-02-01',
      effectiveTo: '2026-01-01',
    }),
    'invalid_effective_range',
  );
});
