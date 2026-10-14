import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';

export const PLANNER_PROGRESS_MODES = ['equal', 'weighted'] as const;
export const LIFECYCLES = ['active', 'archived'] as const;
export const SCHEDULE_TYPES = [
  'daily',
  'selected_weekdays',
  'every_n_days',
  'times_per_week',
  'times_per_month',
  'times_per_year',
  'weekly',
  'monthly',
  'yearly',
] as const;
export const TRACKING_MODES = [
  'checkbox',
  'counter',
  'quantity',
  'duration',
  'avoidance',
] as const;
export const COMPARISON_OPERATORS = [
  'at_least',
  'at_most',
  'equal',
  'boolean_success',
] as const;
export const UNIT_TYPES = ['none', 'standard', 'custom'] as const;
export const IMPORTANCE_LEVELS = ['low', 'normal', 'high', 'critical'] as const;
export const DEPENDENCY_TYPES = ['follow_up', 'prerequisite'] as const;
export const DEPENDENCY_OCCURRENCE_MODES = ['inherited_parent'] as const;
export const DEPENDENCY_END_REASONS = [
  'scheduled_end',
  'replaced',
  'unlinked',
  'parent_archived',
  'dependent_archived',
] as const;
export const OBSERVATION_TYPES = [
  'checkbox',
  'counter',
  'quantity',
  'duration',
  'avoidance',
  'skipped',
  'void',
] as const;
export const OBSERVATION_CORRECTION_REASONS = [
  'correct_value',
  'correct_date',
  'duplicate_entry',
  'reversal',
  'other',
] as const;
export const REMINDER_TIMEZONE_MODES = [
  'schedule_timezone',
  'fixed_timezone',
] as const;
export const DAILY_FOCUS_PROVENANCE_TYPES = [
  'original',
  'copied_forward',
  'extended',
] as const;

export type PlannerProgressMode = (typeof PLANNER_PROGRESS_MODES)[number];
export type Lifecycle = (typeof LIFECYCLES)[number];
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];
export type TrackingMode = (typeof TRACKING_MODES)[number];
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];
export type NumericComparisonOperator = Exclude<
  ComparisonOperator,
  'boolean_success'
>;
export type UnitType = (typeof UNIT_TYPES)[number];
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];
export type DependencyOccurrenceMode =
  (typeof DEPENDENCY_OCCURRENCE_MODES)[number];
export type DependencyEndReason = (typeof DEPENDENCY_END_REASONS)[number];
export type ObservationType = (typeof OBSERVATION_TYPES)[number];
export type ObservationCorrectionReason =
  (typeof OBSERVATION_CORRECTION_REASONS)[number];
export type ReminderTimezoneMode = (typeof REMINDER_TIMEZONE_MODES)[number];
export type DailyFocusLifecycle = Lifecycle;
export type DailyFocusProvenanceType =
  (typeof DAILY_FOCUS_PROVENANCE_TYPES)[number];

function parseStoredValue<const TValues extends readonly string[]>(
  input: unknown,
  values: TValues,
  kind: string,
  field: string,
): Result<TValues[number], PlannerDomainError> {
  if (
    typeof input === 'string' &&
    (values as readonly string[]).includes(input)
  ) {
    return success(input as TValues[number]);
  }

  return failure(
    createPlannerDomainError(
      'unsupported_stored_value',
      `Unsupported Planner ${kind}.`,
      {
        field,
        diagnostics: {
          storedValueKind: kind,
          acceptedValueCount: values.length,
        },
      },
    ),
  );
}

export const parsePlannerProgressMode = (
  input: unknown,
  field = 'progressMode',
) => parseStoredValue(input, PLANNER_PROGRESS_MODES, 'progress mode', field);

export const parseLifecycle = (input: unknown, field = 'lifecycle') =>
  parseStoredValue(input, LIFECYCLES, 'lifecycle', field);

export const parseScheduleType = (input: unknown, field = 'scheduleType') =>
  parseStoredValue(input, SCHEDULE_TYPES, 'schedule type', field);

export const parseTrackingMode = (input: unknown, field = 'trackingMode') =>
  parseStoredValue(input, TRACKING_MODES, 'tracking mode', field);

export const parseComparisonOperator = (
  input: unknown,
  field = 'comparisonOperator',
) => parseStoredValue(input, COMPARISON_OPERATORS, 'comparison operator', field);

export const parseUnitType = (input: unknown, field = 'unitType') =>
  parseStoredValue(input, UNIT_TYPES, 'unit type', field);

export const parseImportanceLevel = (
  input: unknown,
  field = 'importanceLevel',
) => parseStoredValue(input, IMPORTANCE_LEVELS, 'importance level', field);

export const parseDependencyType = (
  input: unknown,
  field = 'dependencyType',
) => parseStoredValue(input, DEPENDENCY_TYPES, 'dependency type', field);

export const parseDependencyOccurrenceMode = (
  input: unknown,
  field = 'occurrenceMode',
) =>
  parseStoredValue(
    input,
    DEPENDENCY_OCCURRENCE_MODES,
    'dependency occurrence mode',
    field,
  );

export const parseDependencyEndReason = (
  input: unknown,
  field = 'endReason',
) => parseStoredValue(input, DEPENDENCY_END_REASONS, 'dependency end reason', field);

export const parseObservationType = (
  input: unknown,
  field = 'observationType',
) => parseStoredValue(input, OBSERVATION_TYPES, 'observation type', field);

export const parseObservationCorrectionReason = (
  input: unknown,
  field = 'correctionReason',
) =>
  parseStoredValue(
    input,
    OBSERVATION_CORRECTION_REASONS,
    'observation correction reason',
    field,
  );

export const parseReminderTimezoneMode = (
  input: unknown,
  field = 'timezoneMode',
) =>
  parseStoredValue(
    input,
    REMINDER_TIMEZONE_MODES,
    'reminder timezone mode',
    field,
  );

export const parseDailyFocusLifecycle = (
  input: unknown,
  field = 'lifecycle',
) => parseStoredValue(input, LIFECYCLES, 'Daily Focus lifecycle', field);

export const parseDailyFocusProvenanceType = (
  input: unknown,
  field = 'provenanceType',
) =>
  parseStoredValue(
    input,
    DAILY_FOCUS_PROVENANCE_TYPES,
    'Daily Focus provenance',
    field,
  );
