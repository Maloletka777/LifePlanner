import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import { isLocalDateInEffectiveRange, type EffectiveRange } from '../validation/effective-range';
import {
  addPlannerCalendarDays,
  comparePlannerLocalDates,
  measurePlannerCalendarDays,
  plannerIsoWeekday,
  plannerLocalDateFromParts,
  type PlannerLocalDate,
  type PlannerTimezone,
} from '../values/local-date';
import type { ScheduleDefinition } from './schedule-definition';
import {
  resolveMonthlyOccurrenceDate,
  resolveYearlyOccurrenceDate,
} from './schedule-definition-validator';

export interface ScheduleEvaluationInput {
  readonly evaluatedLocalDate: PlannerLocalDate;
  readonly habitActiveRange: EffectiveRange;
  readonly schedule: ScheduleDefinition;
  readonly evaluationTimezone: PlannerTimezone;
  readonly comparisonBoundary?: PlannerLocalDate;
}

export type ScheduleEvaluation =
  | Readonly<{
      kind: 'applicable_fixed_date';
      occurrenceLocalDate: PlannerLocalDate;
      evaluationTimezone: PlannerTimezone;
      scheduleType: ScheduleDefinition['scheduleType'];
    }>
  | Readonly<{
      kind: 'applicable_flexible_period';
      periodStart: PlannerLocalDate;
      periodEndExclusive: PlannerLocalDate;
      targetCount: number;
      evaluationTimezone: PlannerTimezone;
      scheduleType: 'times_per_week' | 'times_per_month' | 'times_per_year';
      isOpen: boolean | null;
    }>
  | Readonly<{
      kind: 'not_scheduled';
      evaluatedLocalDate: PlannerLocalDate;
    }>
  | Readonly<{
      kind: 'outside_habit_active_range';
      evaluatedLocalDate: PlannerLocalDate;
    }>
  | Readonly<{
      kind: 'outside_schedule_effective_range';
      evaluatedLocalDate: PlannerLocalDate;
    }>;

export function evaluateSchedule(
  input: ScheduleEvaluationInput,
): Result<ScheduleEvaluation, PlannerDomainError> {
  if (input.evaluationTimezone !== input.schedule.evaluationTimezone) {
    return failure(
      createPlannerDomainError(
        'observation_context_mismatch',
        'The supplied evaluation timezone does not match the schedule.',
        { field: 'evaluationTimezone' },
      ),
    );
  }
  if (!isLocalDateInEffectiveRange(input.evaluatedLocalDate, input.habitActiveRange)) {
    return success(Object.freeze({
      kind: 'outside_habit_active_range',
      evaluatedLocalDate: input.evaluatedLocalDate,
    }));
  }
  if (!isLocalDateInEffectiveRange(input.evaluatedLocalDate, input.schedule.effectiveRange)) {
    return success(Object.freeze({
      kind: 'outside_schedule_effective_range',
      evaluatedLocalDate: input.evaluatedLocalDate,
    }));
  }

  const date = input.evaluatedLocalDate;
  switch (input.schedule.scheduleType) {
    case 'daily':
      return fixed(input);
    case 'selected_weekdays': {
      const bit = 1 << (isoWeekday(date) - 1);
      return (input.schedule.weekdaysMask & bit) !== 0 ? fixed(input) : notScheduled(date);
    }
    case 'every_n_days': {
      const distance = measurePlannerCalendarDays(input.schedule.anchorDate, date);
      return distance >= 0 && distance % input.schedule.intervalDays === 0
        ? fixed(input)
        : notScheduled(date);
    }
    case 'weekly':
      return isoWeekday(date) === input.schedule.weekday
        ? fixed(input)
        : notScheduled(date);
    case 'monthly': {
      const parts = dateParts(date);
      const occurrence = resolveMonthlyOccurrenceDate(
        parts.year,
        parts.month,
        input.schedule.monthDay,
      );
      if (!occurrence.ok) return occurrence;
      return occurrence.value === date ? fixed(input) : notScheduled(date);
    }
    case 'yearly': {
      const parts = dateParts(date);
      const occurrence = resolveYearlyOccurrenceDate(
        parts.year,
        input.schedule.monthNumber,
        input.schedule.monthDay,
      );
      if (!occurrence.ok) return occurrence;
      return occurrence.value === date ? fixed(input) : notScheduled(date);
    }
    case 'times_per_week': {
      const offset = positiveModulo(isoWeekday(date) - input.schedule.weekStart, 7);
      const start = addPlannerCalendarDays(date, -offset);
      if (!start.ok) return start;
      const end = addPlannerCalendarDays(start.value, 7);
      if (!end.ok) return end;
      return flexible(input, start.value, end.value, input.schedule.periodTargetCount);
    }
    case 'times_per_month': {
      const parts = dateParts(date);
      const start = plannerLocalDateFromParts(parts.year, parts.month, 1);
      if (!start.ok) return start;
      const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
      const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
      const end = plannerLocalDateFromParts(nextYear, nextMonth, 1);
      if (!end.ok) return end;
      return flexible(input, start.value, end.value, input.schedule.periodTargetCount);
    }
    case 'times_per_year': {
      const year = dateParts(date).year;
      const start = plannerLocalDateFromParts(year, 1, 1);
      const end = plannerLocalDateFromParts(year + 1, 1, 1);
      if (!start.ok) return start;
      if (!end.ok) return end;
      return flexible(input, start.value, end.value, input.schedule.periodTargetCount);
    }
    default:
      return unreachableSchedule(input.schedule);
  }
}

function fixed(
  input: ScheduleEvaluationInput,
): Result<ScheduleEvaluation, PlannerDomainError> {
  return success(Object.freeze({
    kind: 'applicable_fixed_date',
    occurrenceLocalDate: input.evaluatedLocalDate,
    evaluationTimezone: input.evaluationTimezone,
    scheduleType: input.schedule.scheduleType,
  }));
}

function flexible(
  input: ScheduleEvaluationInput,
  periodStart: PlannerLocalDate,
  periodEndExclusive: PlannerLocalDate,
  targetCount: number,
): Result<ScheduleEvaluation, PlannerDomainError> {
  if (
    input.schedule.scheduleType !== 'times_per_week' &&
    input.schedule.scheduleType !== 'times_per_month' &&
    input.schedule.scheduleType !== 'times_per_year'
  ) {
    return invalidFlexibleSchedule(input.schedule);
  }
  const boundary = input.comparisonBoundary;
  return success(Object.freeze({
    kind: 'applicable_flexible_period',
    periodStart,
    periodEndExclusive,
    targetCount,
    evaluationTimezone: input.evaluationTimezone,
    scheduleType: input.schedule.scheduleType,
    isOpen:
      boundary === undefined
        ? null
        : comparePlannerLocalDates(boundary, periodStart) >= 0 &&
          comparePlannerLocalDates(boundary, periodEndExclusive) < 0,
  }));
}

function notScheduled(
  date: PlannerLocalDate,
): Result<ScheduleEvaluation, PlannerDomainError> {
  return success(Object.freeze({ kind: 'not_scheduled', evaluatedLocalDate: date }));
}

// Shared with the growth diagnosis, which asks the same question of the same dates.
const isoWeekday = plannerIsoWeekday;

function dateParts(date: PlannerLocalDate): Readonly<{ year: number; month: number }> {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function unreachableSchedule(value: never): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'observation_data_integrity_failure',
      'The schedule type is not supported by the evaluator.',
      { diagnostics: { scheduleType: String(value) } },
    ),
  );
}

function invalidFlexibleSchedule(
  value: ScheduleDefinition,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'observation_data_integrity_failure',
      'The schedule type is not supported by the evaluator.',
      { diagnostics: { scheduleType: String(value.scheduleType) } },
    ),
  );
}
