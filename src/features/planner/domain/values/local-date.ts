import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';

declare const plannerLocalDateBrand: unique symbol;
declare const plannerLocalTimeBrand: unique symbol;
declare const plannerDurationMinutesBrand: unique symbol;
declare const plannerTimezoneBrand: unique symbol;

export type PlannerLocalDate = string & {
  readonly [plannerLocalDateBrand]: true;
};
export type PlannerLocalTime = string & {
  readonly [plannerLocalTimeBrand]: true;
};
export type PlannerDurationMinutes = number & {
  readonly [plannerDurationMinutesBrand]: true;
};
export type PlannerTimezone = string & {
  readonly [plannerTimezoneBrand]: true;
};

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function isGregorianLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function getGregorianMonthLength(year: number, month: number): number {
  const monthLengths = [31, isGregorianLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  return monthLengths[month - 1] ?? 0;
}

export function parsePlannerLocalDate(
  input: unknown,
  field = 'localDate',
): Result<PlannerLocalDate, PlannerDomainError> {
  if (typeof input !== 'string') {
    return invalidLocalDate(field, 'type');
  }

  const match = LOCAL_DATE_PATTERN.exec(input);
  if (match === null) {
    return invalidLocalDate(field, 'format');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLength = getGregorianMonthLength(year, month);

  if (year < 1 || monthLength === 0 || day < 1 || day > monthLength) {
    return invalidLocalDate(field, 'calendar');
  }

  return success(input as PlannerLocalDate);
}

export function parsePlannerLocalTime(
  input: unknown,
  field = 'localTime',
): Result<PlannerLocalTime, PlannerDomainError> {
  if (typeof input !== 'string') {
    return invalidLocalTime(field, 'type');
  }

  const match = LOCAL_TIME_PATTERN.exec(input);
  if (match === null) {
    return invalidLocalTime(field, 'format');
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return invalidLocalTime(field, 'clock');
  }

  return success(input as PlannerLocalTime);
}

/**
 * How long a planned thing is meant to take, in whole minutes.
 *
 * It lives beside the local time rather than in a module of its own because it is the
 * other half of the same fact: a start without a length and a length without a start are
 * both halves of «when», and Migration 013 stores them in one effective-dated row for
 * exactly that reason.
 *
 * **Absence is not zero.** A duration is optional everywhere — most items have never had
 * one and never will — so `null` travels as `null` and only a stated length reaches this
 * parser. Zero is refused rather than treated as absence: a thing that takes no time is
 * not a short thing, it is a thing that does not happen.
 *
 * The upper bound is the day itself. Whether a length may run past the end of the day's
 * own drawn window is a different question, decided where that window is, because it
 * cannot be answered without the minute the length is measured from.
 */
export const PLANNER_MAX_DURATION_MINUTES = 1440;

export function parsePlannerDurationMinutes(
  input: unknown,
  field = 'durationMinutes',
): Result<PlannerDurationMinutes, PlannerDomainError> {
  if (typeof input !== 'number') {
    return invalidDurationMinutes(field, 'type');
  }
  if (!Number.isInteger(input)) {
    return invalidDurationMinutes(field, 'precision');
  }
  if (input <= 0 || input > PLANNER_MAX_DURATION_MINUTES) {
    return invalidDurationMinutes(field, 'range');
  }
  return success(input as PlannerDurationMinutes);
}

export function parsePlannerTimezone(
  input: unknown,
  field = 'timezone',
): Result<PlannerTimezone, PlannerDomainError> {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input !== input.trim() ||
    /\s/.test(input)
  ) {
    return invalidTimezone(field, 'format');
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: input }).format(0);
    return success(input as PlannerTimezone);
  } catch {
    return invalidTimezone(field, 'unknown');
  }
}

export function comparePlannerLocalDates(
  left: PlannerLocalDate,
  right: PlannerLocalDate,
): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function measurePlannerCalendarDays(
  start: PlannerLocalDate,
  end: PlannerLocalDate,
): number {
  const startParts = localDateParts(start);
  const endParts = localDateParts(end);
  return daysFromCivil(endParts.year, endParts.month, endParts.day) -
    daysFromCivil(startParts.year, startParts.month, startParts.day);
}

/**
 * Which day of the week a date is, 1 for Monday through 7 for Sunday.
 *
 * It lives here, beside the rest of the calendar arithmetic, because two places now need
 * it — the schedule evaluator and the diagnosis that looks for «Wednesdays don't work» —
 * and two copies of one rule is exactly the divergence this project keeps shared modules
 * to prevent. The anchor is a known Monday.
 */
export function plannerIsoWeekday(date: PlannerLocalDate): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const monday = parsePlannerLocalDate('1970-01-05');
  if (!monday.ok) throw new Error('Static ISO weekday anchor is invalid.');
  const offset = measurePlannerCalendarDays(monday.value, date);
  return (((offset % 7) + 7) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export function addPlannerCalendarDays(
  date: PlannerLocalDate,
  days: number,
): Result<PlannerLocalDate, PlannerDomainError> {
  if (!Number.isSafeInteger(days)) {
    return failure(
      createPlannerDomainError(
        'invalid_local_date',
        'Calendar day offset must be a safe whole number.',
        { field: 'days', diagnostics: { reason: 'invalid_day_offset' } },
      ),
    );
  }

  const parts = localDateParts(date);
  const result = civilFromDays(
    daysFromCivil(parts.year, parts.month, parts.day) + days,
  );
  if (result.year < 1 || result.year > 9999) {
    return failure(
      createPlannerDomainError(
        'invalid_local_date',
        'Calendar operation produced a date outside the supported range.',
        { field: 'localDate', diagnostics: { reason: 'date_range' } },
      ),
    );
  }

  return parsePlannerLocalDate(
    `${String(result.year).padStart(4, '0')}-${String(result.month).padStart(2, '0')}-${String(result.day).padStart(2, '0')}`,
  );
}

export function plannerLocalDateFromParts(
  year: number,
  month: number,
  day: number,
  field = 'localDate',
): Result<PlannerLocalDate, PlannerDomainError> {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    year > 9999
  ) {
    return invalidLocalDate(field, 'parts');
  }

  return parsePlannerLocalDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    field,
  );
}

function invalidLocalDate(
  field: string,
  reason: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_local_date',
      'Enter a real local date in YYYY-MM-DD format.',
      { field, diagnostics: { reason } },
    ),
  );
}

function invalidDurationMinutes(
  field: string,
  reason: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_planned_duration',
      'Enter how long this takes as a whole number of minutes, up to a day.',
      { field, diagnostics: { reason } },
    ),
  );
}

function invalidLocalTime(
  field: string,
  reason: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_local_time',
      'Enter a local time in 24-hour HH:mm format.',
      { field, diagnostics: { reason } },
    ),
  );
}

function invalidTimezone(
  field: string,
  reason: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_timezone',
      'Select a recognized IANA timezone.',
      { field, diagnostics: { reason } },
    ),
  );
}

function localDateParts(date: PlannerLocalDate): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

function daysFromCivil(yearValue: number, month: number, day: number): number {
  const year = yearValue - (month <= 2 ? 1 : 0);
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra;
}

function civilFromDays(serialDay: number): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  const era = Math.floor(serialDay / 146097);
  const dayOfEra = serialDay - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra +
      Math.floor(yearOfEra / 4) -
      Math.floor(yearOfEra / 100));
  const adjustedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * adjustedMonth + 2) / 5) + 1;
  const month = adjustedMonth + (adjustedMonth < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return { year, month, day };
}
