import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import {
  type IsoWeekday,
  type ScheduleDefinition,
  type WeekdaysMask,
} from './schedule-definition';
import {
  validateEffectiveRange,
  type EffectiveRange,
} from '../validation/effective-range';
import { hasOnlyKeys, isRecord, isSafeIntegerInRange } from '../validation/input';
import {
  comparePlannerLocalDates,
  getGregorianMonthLength,
  parsePlannerLocalDate,
  parsePlannerTimezone,
  plannerLocalDateFromParts,
  type PlannerLocalDate,
  type PlannerTimezone,
} from '../values/local-date';
import { parseScheduleType } from '../values/stored-values';

const BASE_KEYS = [
  'scheduleType',
  'effectiveFrom',
  'effectiveTo',
  'evaluationTimezone',
] as const;

interface ValidatedScheduleBase {
  readonly effectiveRange: EffectiveRange;
  readonly evaluationTimezone: PlannerTimezone;
}

export function validateScheduleDefinition(
  input: unknown,
): Result<ScheduleDefinition, PlannerDomainError> {
  if (!isRecord(input)) {
    return invalidSchedule('scheduleDefinition', 'definition_type');
  }

  const typeResult = parseScheduleType(input.scheduleType, 'scheduleType');
  if (!typeResult.ok) {
    return typeResult;
  }

  const baseResult = validateBase(input);
  if (!baseResult.ok) {
    return baseResult;
  }

  const { effectiveRange, evaluationTimezone } = baseResult.value;
  switch (typeResult.value) {
    case 'daily':
      if (!hasOnlyKeys(input, BASE_KEYS)) {
        return invalidSchedule('scheduleDefinition', 'irrelevant_field');
      }
      return success(
        Object.freeze({
          scheduleType: 'daily',
          effectiveRange,
          evaluationTimezone,
        }),
      );

    case 'selected_weekdays': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'weekdaysMask'])) {
        return invalidSchedule('scheduleDefinition', 'irrelevant_field');
      }
      const maskResult = parseWeekdaysMask(input.weekdaysMask);
      if (!maskResult.ok) {
        return maskResult;
      }
      return success(
        Object.freeze({
          scheduleType: 'selected_weekdays',
          effectiveRange,
          evaluationTimezone,
          weekdaysMask: maskResult.value,
        }),
      );
    }

    case 'every_n_days': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'intervalDays', 'anchorDate'])) {
        return invalidSchedule('scheduleDefinition', 'irrelevant_field');
      }
      const intervalResult = positiveInteger(input.intervalDays, 'intervalDays');
      if (!intervalResult.ok) {
        return intervalResult;
      }
      const anchorResult = parsePlannerLocalDate(input.anchorDate, 'anchorDate');
      if (!anchorResult.ok) {
        return invalidSchedule('anchorDate', 'invalid_anchor_date');
      }
      if (
        comparePlannerLocalDates(
          anchorResult.value,
          effectiveRange.effectiveFrom,
        ) > 0
      ) {
        return invalidSchedule('anchorDate', 'anchor_after_effective_from');
      }
      return success(
        Object.freeze({
          scheduleType: 'every_n_days',
          effectiveRange,
          evaluationTimezone,
          intervalDays: intervalResult.value,
          anchorDate: anchorResult.value,
        }),
      );
    }

    case 'times_per_week': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'periodTargetCount', 'weekStart'])) {
        return invalidSchedule('scheduleDefinition', 'irrelevant_field');
      }
      const countResult = positiveInteger(
        input.periodTargetCount,
        'periodTargetCount',
      );
      if (!countResult.ok) {
        return countResult;
      }
      const weekStartResult = isoWeekday(input.weekStart, 'weekStart');
      if (!weekStartResult.ok) {
        return weekStartResult;
      }
      return success(
        Object.freeze({
          scheduleType: 'times_per_week',
          effectiveRange,
          evaluationTimezone,
          periodTargetCount: countResult.value,
          weekStart: weekStartResult.value,
        }),
      );
    }

    case 'times_per_month':
    case 'times_per_year': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'periodTargetCount'])) {
        return invalidSchedule('scheduleDefinition', 'irrelevant_field');
      }
      const countResult = positiveInteger(
        input.periodTargetCount,
        'periodTargetCount',
      );
      if (!countResult.ok) {
        return countResult;
      }
      return success(
        Object.freeze({
          scheduleType: typeResult.value,
          effectiveRange,
          evaluationTimezone,
          periodTargetCount: countResult.value,
        }),
      );
    }

    case 'weekly': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'weekday', 'weekStart'])) {
        return invalidSchedule('scheduleDefinition', 'irrelevant_field');
      }
      const weekdayResult = isoWeekday(input.weekday, 'weekday');
      if (!weekdayResult.ok) {
        return weekdayResult;
      }
      const weekStartResult = isoWeekday(input.weekStart, 'weekStart');
      if (!weekStartResult.ok) {
        return weekStartResult;
      }
      return success(
        Object.freeze({
          scheduleType: 'weekly',
          effectiveRange,
          evaluationTimezone,
          weekday: weekdayResult.value,
          weekStart: weekStartResult.value,
        }),
      );
    }

    case 'monthly': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'monthDay'])) {
        return invalidSchedule('scheduleDefinition', 'irrelevant_field');
      }
      if (!isSafeIntegerInRange(input.monthDay, 1, 31)) {
        return invalidSchedule('monthDay', 'month_day_range');
      }
      return success(
        Object.freeze({
          scheduleType: 'monthly',
          effectiveRange,
          evaluationTimezone,
          monthDay: input.monthDay,
        }),
      );
    }

    case 'yearly': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'monthNumber', 'monthDay'])) {
        return invalidSchedule('scheduleDefinition', 'irrelevant_field');
      }
      if (!isSafeIntegerInRange(input.monthNumber, 1, 12)) {
        return invalidSchedule('monthNumber', 'month_number_range');
      }
      if (
        !isSafeIntegerInRange(
          input.monthDay,
          1,
          getGregorianMonthLength(2024, input.monthNumber),
        )
      ) {
        return invalidSchedule('monthDay', 'invalid_yearly_month_day');
      }
      return success(
        Object.freeze({
          scheduleType: 'yearly',
          effectiveRange,
          evaluationTimezone,
          monthNumber: input.monthNumber,
          monthDay: input.monthDay,
        }),
      );
    }

    default:
      return unreachableScheduleType(typeResult.value);
  }
}

export function isoWeekdaysToMask(
  weekdays: readonly unknown[],
): Result<WeekdaysMask, PlannerDomainError> {
  let mask = 0;
  for (let index = 0; index < weekdays.length; index += 1) {
    const weekdayResult = isoWeekday(weekdays[index], `weekdays[${index}]`);
    if (!weekdayResult.ok) {
      return weekdayResult;
    }
    const bit = 1 << (weekdayResult.value - 1);
    if ((mask & bit) !== 0) {
      return invalidSchedule(`weekdays[${index}]`, 'duplicate_weekday');
    }
    mask |= bit;
  }
  return parseWeekdaysMask(mask);
}

export function weekdaysMaskToIsoWeekdays(
  input: unknown,
): Result<readonly IsoWeekday[], PlannerDomainError> {
  const maskResult = parseWeekdaysMask(input);
  if (!maskResult.ok) {
    return maskResult;
  }
  const weekdays: IsoWeekday[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    if ((maskResult.value & (1 << (weekday - 1))) !== 0) {
      weekdays.push(weekday as IsoWeekday);
    }
  }
  return success(Object.freeze(weekdays));
}

export function resolveMonthlyOccurrenceDate(
  year: number,
  month: number,
  requestedMonthDay: number,
): Result<PlannerLocalDate, PlannerDomainError> {
  if (
    !isSafeIntegerInRange(year, 1, 9999) ||
    !isSafeIntegerInRange(month, 1, 12) ||
    !isSafeIntegerInRange(requestedMonthDay, 1, 31)
  ) {
    return invalidSchedule('occurrenceDate', 'invalid_monthly_occurrence_input');
  }
  const effectiveDay = Math.min(
    requestedMonthDay,
    getGregorianMonthLength(year, month),
  );
  return plannerLocalDateFromParts(year, month, effectiveDay, 'occurrenceDate');
}

export function resolveYearlyOccurrenceDate(
  year: number,
  month: number,
  requestedMonthDay: number,
): Result<PlannerLocalDate, PlannerDomainError> {
  if (
    !isSafeIntegerInRange(year, 1, 9999) ||
    !isSafeIntegerInRange(month, 1, 12) ||
    !isSafeIntegerInRange(
      requestedMonthDay,
      1,
      getGregorianMonthLength(2024, month),
    )
  ) {
    return invalidSchedule('occurrenceDate', 'invalid_yearly_occurrence_input');
  }
  const effectiveDay =
    month === 2 && requestedMonthDay === 29
      ? Math.min(29, getGregorianMonthLength(year, month))
      : requestedMonthDay;
  return plannerLocalDateFromParts(year, month, effectiveDay, 'occurrenceDate');
}

function validateBase(
  input: Readonly<Record<string, unknown>>,
): Result<ValidatedScheduleBase, PlannerDomainError> {
  const rangeResult = validateEffectiveRange({
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  });
  if (!rangeResult.ok) {
    return rangeResult;
  }
  const timezoneResult = parsePlannerTimezone(
    input.evaluationTimezone,
    'evaluationTimezone',
  );
  if (!timezoneResult.ok) {
    return timezoneResult;
  }
  return success({
    effectiveRange: rangeResult.value,
    evaluationTimezone: timezoneResult.value,
  });
}

function parseWeekdaysMask(
  input: unknown,
): Result<WeekdaysMask, PlannerDomainError> {
  if (!isSafeIntegerInRange(input, 1, 127)) {
    return invalidSchedule('weekdaysMask', 'weekdays_mask_range');
  }
  return success(input as WeekdaysMask);
}

function positiveInteger(
  input: unknown,
  field: string,
): Result<number, PlannerDomainError> {
  if (!isSafeIntegerInRange(input, 1, Number.MAX_SAFE_INTEGER)) {
    return invalidSchedule(field, 'positive_integer');
  }
  return success(input);
}

function isoWeekday(
  input: unknown,
  field: string,
): Result<IsoWeekday, PlannerDomainError> {
  if (!isSafeIntegerInRange(input, 1, 7)) {
    return invalidSchedule(field, 'iso_weekday');
  }
  return success(input as IsoWeekday);
}

function invalidSchedule(
  field: string,
  reason: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_schedule_definition',
      'The schedule definition contains an invalid or incompatible value.',
      { field, diagnostics: { reason } },
    ),
  );
}

function unreachableScheduleType(
  scheduleType: never,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_schedule_definition',
      'The schedule discriminator is not implemented.',
      {
        field: 'scheduleType',
        diagnostics: { reason: 'unreachable_discriminator' },
      },
    ),
  );
}
