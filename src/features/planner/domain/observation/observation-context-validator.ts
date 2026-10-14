import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import { evaluateSchedule, type ScheduleEvaluation } from '../schedule/schedule-evaluator';
import type { ScheduleDefinition } from '../schedule/schedule-definition';
import type { TrackingDefinition } from '../tracking/tracking-definition';
import {
  isLocalDateInEffectiveRange,
  type EffectiveRange,
} from '../validation/effective-range';
import type { Lifecycle } from '../values/stored-values';
import type { PlannerId } from '../values/planner-id';
import type {
  PlannerLocalDate,
  PlannerTimezone,
} from '../values/local-date';
import { addPlannerCalendarDays } from '../values/local-date';
import type { ObservationValue } from './observation';
import { validateObservationValue } from './observation-value-validator';

export interface ObservationContextHabit {
  readonly id: PlannerId;
  readonly lifecycle: Lifecycle;
  readonly activeRange: EffectiveRange;
}

export interface ObservationScheduleVersionContext {
  readonly id: PlannerId;
  readonly habitId: PlannerId;
  readonly definition: ScheduleDefinition;
}

export interface ObservationTrackingVersionContext {
  readonly id: PlannerId;
  readonly habitId: PlannerId;
  readonly definition: TrackingDefinition;
}

export interface ObservationImportanceVersionContext {
  readonly id: PlannerId;
  readonly habitId: PlannerId;
  readonly effectiveRange: EffectiveRange;
}

export interface ObservationDependencyVersionContext {
  readonly id: PlannerId;
  readonly dependentHabitId: PlannerId;
  readonly occurrenceMode: 'inherited_parent';
  readonly effectiveRange: EffectiveRange;
}

export interface IndependentObservationContextInput {
  readonly habit: ObservationContextHabit | null;
  readonly occurrenceLocalDate: PlannerLocalDate;
  readonly occurrenceTimezone: PlannerTimezone;
  readonly scheduleVersions: readonly ObservationScheduleVersionContext[];
  readonly trackingVersions: readonly ObservationTrackingVersionContext[];
  readonly importanceVersions: readonly ObservationImportanceVersionContext[];
  readonly dependencyVersions: readonly ObservationDependencyVersionContext[];
  readonly value: ObservationValue;
  readonly allowVoid: boolean;
  readonly comparisonBoundary?: PlannerLocalDate;
}

export interface IndependentObservationContext {
  readonly habit: ObservationContextHabit;
  readonly scheduleVersion: ObservationScheduleVersionContext;
  readonly trackingVersion: ObservationTrackingVersionContext;
  readonly importanceVersion: ObservationImportanceVersionContext;
  readonly scheduleEvaluation: Extract<
    ScheduleEvaluation,
    { kind: 'applicable_fixed_date' | 'applicable_flexible_period' }
  >;
  readonly occurrenceWindow: Readonly<{
    start: PlannerLocalDate;
    endExclusive: PlannerLocalDate;
  }>;
  readonly value: ObservationValue;
}

export function validateIndependentObservationContext(
  input: IndependentObservationContextInput,
): Result<IndependentObservationContext, PlannerDomainError> {
  const habit = input.habit;
  if (habit === null) {
    return contextFailure('observation_habit_not_found', 'The observed habit does not exist.');
  }
  if (habit.lifecycle !== 'active') {
    return contextFailure('observation_habit_archived', 'Archived habits cannot receive observations.');
  }
  if (!isLocalDateInEffectiveRange(input.occurrenceLocalDate, habit.activeRange)) {
    return contextFailure(
      'observation_outside_active_range',
      'The observation date is outside the habit active range.',
    );
  }

  const dependencies = input.dependencyVersions.filter((version) =>
    isLocalDateInEffectiveRange(input.occurrenceLocalDate, version.effectiveRange),
  );
  if (dependencies.some((version) => version.dependentHabitId !== habit.id)) {
    return integrityFailure('An applicable dependency does not belong to the observed habit.');
  }
  if (dependencies.length > 1) {
    return integrityFailure(
      'More than one inherited dependency applies on the observation date.',
    );
  }
  if (dependencies.length > 0) {
    return contextFailure(
      'dependency_occurrence_resolution_required',
      'Dependent-habit observations require occurrence expectation resolution.',
    );
  }

  const scheduleResult = resolveOne(
    input.scheduleVersions.filter((version) =>
      isLocalDateInEffectiveRange(input.occurrenceLocalDate, version.definition.effectiveRange),
    ),
    'observation_schedule_missing',
    'observation_schedule_ambiguous',
    'schedule',
  );
  if (!scheduleResult.ok) return scheduleResult;
  if (scheduleResult.value.habitId !== habit.id) {
    return integrityFailure('The applicable schedule does not belong to the observed habit.');
  }

  const trackingResult = resolveOne(
    input.trackingVersions.filter((version) =>
      isLocalDateInEffectiveRange(input.occurrenceLocalDate, version.definition.effectiveRange),
    ),
    'observation_tracking_missing',
    'observation_tracking_ambiguous',
    'tracking',
  );
  if (!trackingResult.ok) return trackingResult;
  if (trackingResult.value.habitId !== habit.id) {
    return integrityFailure('The applicable tracking version does not belong to the observed habit.');
  }

  const importanceResult = resolveOne(
    input.importanceVersions.filter((version) =>
      isLocalDateInEffectiveRange(input.occurrenceLocalDate, version.effectiveRange),
    ),
    'observation_importance_missing',
    'observation_importance_ambiguous',
    'importance',
  );
  if (!importanceResult.ok) return importanceResult;
  if (importanceResult.value.habitId !== habit.id) {
    return integrityFailure('The applicable importance version does not belong to the observed habit.');
  }

  if (input.occurrenceTimezone !== scheduleResult.value.definition.evaluationTimezone) {
    return contextFailure(
      'observation_context_mismatch',
      'The occurrence timezone must match the schedule evaluation timezone.',
    );
  }
  const scheduleEvaluation = evaluateSchedule({
    evaluatedLocalDate: input.occurrenceLocalDate,
    habitActiveRange: habit.activeRange,
    schedule: scheduleResult.value.definition,
    evaluationTimezone: input.occurrenceTimezone,
    ...(input.comparisonBoundary === undefined
      ? {}
      : { comparisonBoundary: input.comparisonBoundary }),
  });
  if (!scheduleEvaluation.ok) return scheduleEvaluation;
  if (scheduleEvaluation.value.kind === 'outside_habit_active_range') {
    return contextFailure('observation_outside_active_range', 'The observation date is outside the habit active range.');
  }
  if (scheduleEvaluation.value.kind === 'outside_schedule_effective_range') {
    return contextFailure('observation_schedule_missing', 'No schedule version applies on the observation date.');
  }
  if (scheduleEvaluation.value.kind === 'not_scheduled') {
    return contextFailure('observation_not_scheduled', 'The habit is not scheduled on the observation date.');
  }

  const valueResult = validateObservationValue(
    input.value,
    trackingResult.value.definition,
    { allowVoid: input.allowVoid },
  );
  if (!valueResult.ok) return valueResult;

  const occurrenceWindow =
    scheduleEvaluation.value.kind === 'applicable_fixed_date'
      ? oneDayWindow(input.occurrenceLocalDate)
      : success(Object.freeze({
          start: scheduleEvaluation.value.periodStart,
          endExclusive: scheduleEvaluation.value.periodEndExclusive,
        }));
  if (!occurrenceWindow.ok) return occurrenceWindow;

  return success(Object.freeze({
    habit,
    scheduleVersion: scheduleResult.value,
    trackingVersion: trackingResult.value,
    importanceVersion: importanceResult.value,
    scheduleEvaluation: scheduleEvaluation.value,
    occurrenceWindow: occurrenceWindow.value,
    value: valueResult.value,
  }));
}

function oneDayWindow(
  date: PlannerLocalDate,
): Result<Readonly<{ start: PlannerLocalDate; endExclusive: PlannerLocalDate }>, PlannerDomainError> {
  const tomorrow = addPlannerCalendarDays(date, 1);
  return tomorrow.ok
    ? success(Object.freeze({ start: date, endExclusive: tomorrow.value }))
    : failure(tomorrow.error);
}

function resolveOne<T>(
  values: readonly T[],
  missingCode: Parameters<typeof createPlannerDomainError>[0],
  ambiguousCode: Parameters<typeof createPlannerDomainError>[0],
  kind: string,
): Result<T, PlannerDomainError> {
  if (values.length === 0) {
    return contextFailure(missingCode, `No applicable ${kind} version exists.`);
  }
  if (values.length !== 1) {
    return contextFailure(ambiguousCode, `More than one applicable ${kind} version exists.`);
  }
  return success(values[0]);
}

function integrityFailure(message: string): Result<never, PlannerDomainError> {
  return contextFailure('observation_data_integrity_failure', message);
}

function contextFailure(
  code: Parameters<typeof createPlannerDomainError>[0],
  message: string,
): Result<never, PlannerDomainError> {
  return failure(createPlannerDomainError(code, message));
}
