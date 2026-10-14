import {
  failure,
  parsePlannerLocalTime,
  parsePlannerTimezone,
  parseReminderTimezoneMode,
  success,
  validateTrackingDefinition,
  type PlannerDomainError,
  type PlannerLocalTime,
  type PlannerTimezone,
  type ReminderTimezoneMode,
  type Result,
  type TrackingDefinition,
} from '../domain';

export const MAX_HABIT_NAME_LENGTH = 200;

export interface HabitReminderInput {
  readonly triggerLocalTime: PlannerLocalTime;
  readonly timezoneMode: ReminderTimezoneMode;
  readonly timezoneId: PlannerTimezone | null;
}

export type ValidatedHabitReminder = HabitReminderInput;

export interface HabitInputValidationError {
  readonly field: string;
  readonly message: string;
  readonly cause?: PlannerDomainError;
}

export function normalizeHabitNameInput(
  input: unknown,
): Result<string, HabitInputValidationError> {
  if (typeof input !== 'string') {
    return inputFailure('name', 'Enter a habit name.');
  }
  const name = input.trim();
  const characterCount = Array.from(name).length;
  if (characterCount < 1 || characterCount > MAX_HABIT_NAME_LENGTH) {
    return inputFailure(
      'name',
      `Habit names must contain between 1 and ${MAX_HABIT_NAME_LENGTH} characters.`,
    );
  }
  return success(name);
}

export function normalizeHabitDescriptionInput(
  input: unknown,
): Result<string | null, HabitInputValidationError> {
  if (input === null) return success(null);
  if (typeof input !== 'string') {
    return inputFailure('description', 'The description must be text.');
  }
  return success(input.trim().length === 0 ? null : input);
}

export function revalidateHabitTracking(
  tracking: TrackingDefinition,
): Result<TrackingDefinition, HabitInputValidationError> {
  if (typeof tracking !== 'object' || tracking === null) {
    return inputFailure('tracking', 'The tracking definition is required.');
  }
  const base = {
    trackingMode: tracking.trackingMode,
    comparisonOperator: tracking.comparisonOperator,
    effectiveFrom: tracking.effectiveRange?.effectiveFrom,
    effectiveTo: tracking.effectiveRange?.effectiveTo,
  };
  let input: unknown;

  switch (tracking.trackingMode) {
    case 'checkbox':
    case 'avoidance':
      input = base;
      break;
    case 'counter':
    case 'quantity':
      input = { ...base, target: tracking.target, unit: tracking.unit };
      break;
    case 'duration':
      input = {
        ...base,
        targetDurationSeconds: tracking.targetDurationSeconds,
        unit: tracking.unit,
      };
      break;
    default:
      return inputFailure(
        'tracking.trackingMode',
        'The tracking mode is unsupported.',
      );
  }

  const result = validateTrackingDefinition(input);
  return result.ok
    ? success(result.value)
    : inputFailure('tracking', 'The tracking definition is invalid.', result.error);
}

export function validateHabitReminder(
  reminder: HabitReminderInput | null,
): Result<ValidatedHabitReminder | null, HabitInputValidationError> {
  if (reminder === null) return success(null);
  if (typeof reminder !== 'object') {
    return inputFailure('reminder', 'The reminder is malformed.');
  }

  const timeResult = parsePlannerLocalTime(
    reminder.triggerLocalTime,
    'reminder.triggerLocalTime',
  );
  if (!timeResult.ok) {
    return inputFailure(
      'reminder.triggerLocalTime',
      'The reminder time is invalid.',
      timeResult.error,
    );
  }
  const modeResult = parseReminderTimezoneMode(
    reminder.timezoneMode,
    'reminder.timezoneMode',
  );
  if (!modeResult.ok) {
    return inputFailure(
      'reminder.timezoneMode',
      'The reminder timezone mode is invalid.',
      modeResult.error,
    );
  }

  if (modeResult.value === 'schedule_timezone') {
    if (reminder.timezoneId !== null) {
      return inputFailure(
        'reminder.timezoneId',
        'A schedule-timezone reminder cannot include a fixed timezone.',
      );
    }
    return success(
      Object.freeze({
        triggerLocalTime: timeResult.value,
        timezoneMode: modeResult.value,
        timezoneId: null,
      }),
    );
  }

  const timezoneResult = parsePlannerTimezone(
    reminder.timezoneId,
    'reminder.timezoneId',
  );
  if (!timezoneResult.ok) {
    return inputFailure(
      'reminder.timezoneId',
      'The reminder timezone is invalid.',
      timezoneResult.error,
    );
  }
  return success(
    Object.freeze({
      triggerLocalTime: timeResult.value,
      timezoneMode: modeResult.value,
      timezoneId: timezoneResult.value,
    }),
  );
}

function inputFailure<T>(
  field: string,
  message: string,
  cause?: PlannerDomainError,
): Result<T, HabitInputValidationError> {
  return failure(Object.freeze({ field, message, ...(cause ? { cause } : {}) }));
}
