import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateSchedule,
  parsePlannerLocalDate,
  parsePlannerTimezone,
  validateEffectiveRange,
  validateScheduleDefinition,
  type PlannerLocalDate,
  type ScheduleDefinition,
} from '../../../src/features/planner/domain';
import { expectSuccess } from './test-helpers';

const LONDON = expectSuccess(parsePlannerTimezone('Europe/London'));
const ACTIVE = expectSuccess(
  validateEffectiveRange({ effectiveFrom: '2024-01-01', effectiveTo: '2027-01-01' }),
);

test('ScheduleEvaluator accepts daily, selected weekday, every-N, and weekly dates', () => {
  assert.equal(evaluate('2026-08-03', schedule('daily')).kind, 'applicable_fixed_date');
  assert.equal(
    evaluate('2026-08-03', schedule('selected_weekdays', { weekdaysMask: 1 })).kind,
    'applicable_fixed_date',
  );
  assert.equal(
    evaluate('2026-08-04', schedule('selected_weekdays', { weekdaysMask: 1 })).kind,
    'not_scheduled',
  );
  assert.equal(
    evaluate(
      '2026-08-05',
      schedule(
        'every_n_days',
        { intervalDays: 2, anchorDate: date('2026-08-01') },
        '2026-08-01',
        '2027-01-01',
      ),
    ).kind,
    'applicable_fixed_date',
  );
  assert.equal(
    evaluate(
      '2026-08-04',
      schedule(
        'every_n_days',
        { intervalDays: 2, anchorDate: date('2026-08-01') },
        '2026-08-01',
        '2027-01-01',
      ),
    ).kind,
    'not_scheduled',
  );
  assert.equal(
    evaluate('2026-08-05', schedule('weekly', { weekday: 3, weekStart: 1 })).kind,
    'applicable_fixed_date',
  );
});

test('ScheduleEvaluator applies monthly last-day and yearly leap-day fallbacks', () => {
  assert.equal(
    evaluate('2026-04-15', schedule('monthly', { monthDay: 15 })).kind,
    'applicable_fixed_date',
  );
  assert.equal(
    evaluate('2026-02-28', schedule('monthly', { monthDay: 31 })).kind,
    'applicable_fixed_date',
  );
  assert.equal(
    evaluate('2026-07-19', schedule('yearly', { monthNumber: 7, monthDay: 19 })).kind,
    'applicable_fixed_date',
  );
  assert.equal(
    evaluate('2025-02-28', schedule('yearly', { monthNumber: 2, monthDay: 29 })).kind,
    'applicable_fixed_date',
  );
});

test('ScheduleEvaluator returns exact weekly, monthly, and yearly flexible periods', () => {
  assert.deepEqual(evaluate('2026-08-05', schedule('times_per_week', {
    periodTargetCount: 3,
    weekStart: 1,
  })), {
    kind: 'applicable_flexible_period',
    periodStart: '2026-08-03',
    periodEndExclusive: '2026-08-10',
    targetCount: 3,
    evaluationTimezone: LONDON,
    scheduleType: 'times_per_week',
    isOpen: null,
  });
  const monthly = evaluate('2026-08-31', schedule('times_per_month', {
    periodTargetCount: 4,
  }), '2026-08-31');
  assert.deepEqual(monthly, {
    kind: 'applicable_flexible_period',
    periodStart: '2026-08-01',
    periodEndExclusive: '2026-09-01',
    targetCount: 4,
    evaluationTimezone: LONDON,
    scheduleType: 'times_per_month',
    isOpen: true,
  });
  const yearly = evaluate('2026-12-31', schedule('times_per_year', {
    periodTargetCount: 12,
  }), '2027-01-01');
  assert.equal(yearly.kind, 'applicable_flexible_period');
  if (yearly.kind === 'applicable_flexible_period') {
    assert.equal(yearly.periodStart, '2026-01-01');
    assert.equal(yearly.periodEndExclusive, '2027-01-01');
    assert.equal(yearly.isOpen, false);
  }
});

test('ScheduleEvaluator distinguishes habit and schedule range exclusions deterministically', () => {
  const narrowHabit = expectSuccess(
    validateEffectiveRange({ effectiveFrom: '2026-08-01', effectiveTo: '2026-09-01' }),
  );
  const outsideHabit = expectSuccess(evaluateSchedule({
    evaluatedLocalDate: date('2026-07-31'),
    habitActiveRange: narrowHabit,
    schedule: schedule('daily'),
    evaluationTimezone: LONDON,
  }));
  assert.equal(outsideHabit.kind, 'outside_habit_active_range');

  const narrowSchedule = schedule('daily', {}, '2026-08-01', '2026-09-01');
  const outsideSchedule = expectSuccess(evaluateSchedule({
    evaluatedLocalDate: date('2026-09-01'),
    habitActiveRange: ACTIVE,
    schedule: narrowSchedule,
    evaluationTimezone: LONDON,
  }));
  assert.equal(outsideSchedule.kind, 'outside_schedule_effective_range');
  assert.deepEqual(
    evaluate('2026-08-03', schedule('selected_weekdays', { weekdaysMask: 1 })),
    evaluate('2026-08-03', schedule('selected_weekdays', { weekdaysMask: 1 })),
  );
});

function evaluate(
  value: string,
  definition: ScheduleDefinition,
  comparison?: string,
) {
  return expectSuccess(evaluateSchedule({
    evaluatedLocalDate: date(value),
    habitActiveRange: ACTIVE,
    schedule: definition,
    evaluationTimezone: LONDON,
    ...(comparison === undefined ? {} : { comparisonBoundary: date(comparison) }),
  }));
}

function schedule(
  type: ScheduleDefinition['scheduleType'],
  fields: Readonly<Record<string, unknown>> = {},
  effectiveFrom = '2024-01-01',
  effectiveTo: string | null = '2027-01-01',
): ScheduleDefinition {
  return expectSuccess(validateScheduleDefinition({
    scheduleType: type,
    effectiveFrom,
    effectiveTo,
    evaluationTimezone: LONDON,
    ...fields,
  }));
}

function date(value: string): PlannerLocalDate {
  return expectSuccess(parsePlannerLocalDate(value));
}
