import {
  addPlannerCalendarDays,
  evaluateSchedule,
  isOneDayRange,
  parsePlannerLocalDate,
  type EffectiveRange,
  type PlannerLocalDate,
  type PlannerTimezone,
  type ScheduleDefinition,
  type ScheduleType,
} from '../domain';

import type { ActiveRangeDraft, ScheduleDraft } from './ui-adapters';

/**
 * Six modes over the nine canonical schedule types.
 *
 * The nine types stay exactly as they are in the domain; this is a presentation
 * grouping, so a person choosing "Times" does not have to know whether the schema
 * calls it `times_per_week` or `times_per_month`. Nothing here decides expectation
 * — `evaluateSchedule` remains the only authority on which dates a habit lands on.
 */
export type CreateScheduleMode = 'daily' | 'days' | 'interval' | 'times' | 'date' | 'once';

export const CREATE_SCHEDULE_MODES: readonly CreateScheduleMode[] = Object.freeze([
  'daily', 'days', 'interval', 'times', 'date', 'once',
] as const);

/**
 * The three that live on the create screen, and the three that do not.
 *
 * Six segments in one row gave 55 pt cells with "Inte…" clipped — on `тест9` they
 * were hard to hit at all. Three fit whole at ~110 pt. Times, Date and Once are
 * rare enough at creation to move into the dates sheet rather than to cost the
 * common case its legibility.
 */
export const CREATE_PRIMARY_SCHEDULE_MODES: readonly CreateScheduleMode[] = Object.freeze([
  'daily', 'days', 'interval',
] as const);

export const CREATE_EXTRA_SCHEDULE_MODES: readonly CreateScheduleMode[] = Object.freeze([
  'times', 'date', 'once',
] as const);

export const CREATE_SCHEDULE_MODE_LABELS: Readonly<Record<CreateScheduleMode, string>> = Object.freeze({
  daily: 'Every day',
  days: 'Weekdays',
  interval: 'Interval',
  times: 'Times a period',
  date: 'Day of month',
  once: 'Once only',
});

/** Which types each mode owns. `weekly` is read as Days; new habits write `selected_weekdays`. */
const MODE_TYPES: Readonly<Record<CreateScheduleMode, readonly ScheduleType[]>> = Object.freeze({
  daily: Object.freeze(['daily'] as const),
  days: Object.freeze(['selected_weekdays', 'weekly'] as const),
  interval: Object.freeze(['every_n_days'] as const),
  times: Object.freeze(['times_per_week', 'times_per_month', 'times_per_year'] as const),
  date: Object.freeze(['monthly', 'yearly'] as const),
  once: Object.freeze(['daily'] as const),
});

export const CREATE_TIMES_PERIODS = Object.freeze(['times_per_week', 'times_per_month', 'times_per_year'] as const);
export const CREATE_DATE_PERIODS = Object.freeze(['monthly', 'yearly'] as const);

/**
 * A one-off habit is a daily schedule that stops the day after it starts. The
 * schema has no `once` type, and inventing one would be a migration; this is the
 * same shape the previous Create screen wrote, kept so existing drafts read back.
 */
export function isOnceRange(range: ActiveRangeDraft): boolean {
  // The same arithmetic every other surface asks the domain for, rather than a
  // second copy of it here: what differs is only that a draft holds half-typed
  // strings, so it parses first and answers `false` for anything unfinished.
  const from = parsePlannerLocalDate(range.activeFrom);
  const to = parsePlannerLocalDate(range.activeTo);
  return from.ok && to.ok && isOneDayRange(from.value, to.value);
}

export function createScheduleModeFor(schedule: ScheduleDraft, range: ActiveRangeDraft): CreateScheduleMode {
  if (schedule.scheduleType === 'daily') return isOnceRange(range) ? 'once' : 'daily';
  const found = CREATE_SCHEDULE_MODES.find((mode) => mode !== 'once' && MODE_TYPES[mode].includes(schedule.scheduleType));
  return found ?? 'daily';
}

/**
 * Moving between modes keeps every value the next mode needs and supplies a
 * working default for the rest, so switching back and forth never empties a field
 * the user already filled in.
 */
export function applyCreateScheduleMode(
  mode: CreateScheduleMode,
  schedule: ScheduleDraft,
  range: ActiveRangeDraft,
): Readonly<{ schedule: ScheduleDraft; range: ActiveRangeDraft }> {
  const openRange = Object.freeze({ activeFrom: range.activeFrom, activeTo: '' });
  if (mode === 'once') {
    return Object.freeze({
      range: Object.freeze({ activeFrom: range.activeFrom, activeTo: addCalendarDay(range.activeFrom) }),
      schedule: Object.freeze({ ...schedule, scheduleType: 'daily' as const }),
    });
  }
  if (mode === 'daily') return Object.freeze({ range: openRange, schedule: Object.freeze({ ...schedule, scheduleType: 'daily' as const }) });
  if (mode === 'days') {
    return Object.freeze({
      range: openRange,
      schedule: Object.freeze({
        ...schedule,
        scheduleType: 'selected_weekdays' as const,
        selectedWeekdays: schedule.selectedWeekdays.length === 0 ? Object.freeze([1]) : schedule.selectedWeekdays,
      }),
    });
  }
  if (mode === 'interval') {
    return Object.freeze({
      range: openRange,
      schedule: Object.freeze({
        ...schedule,
        anchorDate: schedule.anchorDate === '' ? range.activeFrom : schedule.anchorDate,
        intervalDays: schedule.intervalDays === '' ? '2' : schedule.intervalDays,
        scheduleType: 'every_n_days' as const,
      }),
    });
  }
  if (mode === 'times') {
    const kept = CREATE_TIMES_PERIODS.find((type) => type === schedule.scheduleType);
    return Object.freeze({
      range: openRange,
      schedule: Object.freeze({
        ...schedule,
        periodTargetCount: schedule.periodTargetCount === '' ? '3' : schedule.periodTargetCount,
        scheduleType: kept ?? 'times_per_week',
      }),
    });
  }
  const kept = CREATE_DATE_PERIODS.find((type) => type === schedule.scheduleType);
  return Object.freeze({
    range: openRange,
    schedule: Object.freeze({
      ...schedule,
      monthDay: schedule.monthDay === '' ? dayOfMonth(range.activeFrom) : schedule.monthDay,
      monthNumber: schedule.monthNumber === '' ? monthOfYear(range.activeFrom) : schedule.monthNumber,
      scheduleType: kept ?? 'monthly',
    }),
  });
}

/**
 * The next dates the habit is actually expected on, asked of the domain one day at
 * a time rather than re-derived here. A flexible period has no fixed dates at all,
 * so it returns none and the caller says what the period is instead of inventing
 * days that the schema never promised.
 */
export function plannerScheduleNextDates(
  schedule: ScheduleDefinition,
  activeRange: EffectiveRange,
  timezone: PlannerTimezone,
  from: PlannerLocalDate,
  limit = 3,
  horizonDays = 400,
): readonly PlannerLocalDate[] {
  const found: PlannerLocalDate[] = [];
  let cursor: PlannerLocalDate = from;
  for (let step = 0; step < horizonDays && found.length < limit; step += 1) {
    const evaluation = evaluateSchedule({
      evaluatedLocalDate: cursor,
      evaluationTimezone: timezone,
      habitActiveRange: activeRange,
      schedule,
    });
    if (!evaluation.ok) break;
    if (evaluation.value.kind === 'applicable_fixed_date') found.push(cursor);
    if (evaluation.value.kind === 'applicable_flexible_period') return Object.freeze([]);
    const next = addPlannerCalendarDays(cursor, 1);
    if (!next.ok) break;
    cursor = next.value;
  }
  return Object.freeze(found);
}

function addCalendarDay(value: string): string {
  const parsed = parseLocalDate(value);
  if (parsed === null) return '';
  const moved = addPlannerCalendarDays(parsed, 1);
  return moved.ok ? moved.value : '';
}

function dayOfMonth(value: string): string {
  return value.length === 10 ? String(Number(value.slice(8, 10))) : '1';
}

function monthOfYear(value: string): string {
  return value.length === 10 ? String(Number(value.slice(5, 7))) : '1';
}

function parseLocalDate(value: string): PlannerLocalDate | null {
  const parsed = parsePlannerLocalDate(value);
  return parsed.ok ? parsed.value : null;
}
