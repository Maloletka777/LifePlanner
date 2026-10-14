import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isoWeekdaysToMask,
  resolveMonthlyOccurrenceDate,
  resolveYearlyOccurrenceDate,
  validateScheduleDefinition,
  weekdaysMaskToIsoWeekdays,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

const scheduleBase = {
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  evaluationTimezone: 'Europe/London',
} as const;

test('all nine schedule discriminators accept a valid fixture', () => {
  const fixtures = [
    { ...scheduleBase, scheduleType: 'daily' },
    { ...scheduleBase, scheduleType: 'selected_weekdays', weekdaysMask: 21 },
    {
      ...scheduleBase,
      scheduleType: 'every_n_days',
      intervalDays: 2,
      anchorDate: '2025-12-31',
    },
    {
      ...scheduleBase,
      scheduleType: 'times_per_week',
      periodTargetCount: 3,
      weekStart: 1,
    },
    {
      ...scheduleBase,
      scheduleType: 'times_per_month',
      periodTargetCount: 4,
    },
    {
      ...scheduleBase,
      scheduleType: 'times_per_year',
      periodTargetCount: 12,
    },
    { ...scheduleBase, scheduleType: 'weekly', weekday: 3, weekStart: 1 },
    { ...scheduleBase, scheduleType: 'monthly', monthDay: 31 },
    { ...scheduleBase, scheduleType: 'yearly', monthNumber: 2, monthDay: 29 },
  ] as const;

  assert.deepEqual(
    fixtures.map((fixture) =>
      expectSuccess(validateScheduleDefinition(fixture)).scheduleType,
    ),
    [
      'daily',
      'selected_weekdays',
      'every_n_days',
      'times_per_week',
      'times_per_month',
      'times_per_year',
      'weekly',
      'monthly',
      'yearly',
    ],
  );
});

test('selected ISO weekdays map directly to and from the frozen bit mask', () => {
  assert.equal(expectSuccess(isoWeekdaysToMask([1, 3, 5])), 21);
  assert.deepEqual(expectSuccess(weekdaysMaskToIsoWeekdays(65)), [1, 7]);
  expectError(isoWeekdaysToMask([]), 'invalid_schedule_definition');
  expectError(isoWeekdaysToMask([1, 1]), 'invalid_schedule_definition');
  expectError(weekdaysMaskToIsoWeekdays(128), 'invalid_schedule_definition');
});

test('schedule numeric and anchor invariants reject invalid definitions', () => {
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'selected_weekdays',
      weekdaysMask: 0,
    }),
    'invalid_schedule_definition',
  );
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'weekly',
      weekday: 8,
      weekStart: 1,
    }),
    'invalid_schedule_definition',
  );
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'times_per_month',
      periodTargetCount: 0,
    }),
    'invalid_schedule_definition',
  );
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'every_n_days',
      intervalDays: 0,
      anchorDate: '2026-01-01',
    }),
    'invalid_schedule_definition',
  );
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'every_n_days',
      intervalDays: 2,
      anchorDate: '2026-01-02',
    }),
    'invalid_schedule_definition',
  );
});

test('monthly and yearly occurrence helpers apply only approved fallbacks', () => {
  assert.equal(
    expectSuccess(resolveMonthlyOccurrenceDate(2025, 2, 31)),
    '2025-02-28',
  );
  assert.equal(
    expectSuccess(resolveMonthlyOccurrenceDate(2024, 2, 31)),
    '2024-02-29',
  );
  assert.equal(
    expectSuccess(resolveYearlyOccurrenceDate(2025, 2, 29)),
    '2025-02-28',
  );
  assert.equal(
    expectSuccess(resolveYearlyOccurrenceDate(2024, 2, 29)),
    '2024-02-29',
  );
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'yearly',
      monthNumber: 4,
      monthDay: 31,
    }),
    'invalid_schedule_definition',
  );
});

test('schedule boundary rejects unknown discriminators, timezones, and extra fields', () => {
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'fortnightly',
    }),
    'unsupported_stored_value',
  );
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'daily',
      evaluationTimezone: 'Europe/Not_A_Zone',
    }),
    'invalid_timezone',
  );
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'daily',
      effectiveTo: '2026-01-01',
    }),
    'invalid_effective_range',
  );
  expectError(
    validateScheduleDefinition({
      ...scheduleBase,
      scheduleType: 'daily',
      monthDay: 1,
    }),
    'invalid_schedule_definition',
  );
});
