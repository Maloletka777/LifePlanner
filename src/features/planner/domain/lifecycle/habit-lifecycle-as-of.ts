import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import type { EffectiveRange } from '../validation/effective-range';
import type { PlannerLocalDate } from '../values/local-date';
import type { Lifecycle } from '../values/stored-values';

export type HabitAsOfLifecycleState = Lifecycle | 'pre_active';

export type HabitActionUnavailableReason =
  | 'habit_not_active_yet'
  | 'habit_already_archived'
  | 'habit_not_archived'
  | 'lifecycle_history_not_current'
  | 'not_supported';

export interface HabitActionAvailability {
  readonly available: boolean;
  readonly unavailableReason: HabitActionUnavailableReason | null;
  readonly earliestEffectiveLocalDate: PlannerLocalDate | null;
}

export interface HabitLifecycleActionAvailability {
  readonly archive: HabitActionAvailability;
  readonly restore: HabitActionAvailability;
  readonly edit: HabitActionAvailability;
  readonly delete: HabitActionAvailability;
  readonly pause: HabitActionAvailability;
  readonly resume: HabitActionAvailability;
}

export interface HabitLifecycleAsOfTransitionInput {
  readonly sequenceNumber: number;
  readonly lifecycle: Lifecycle;
  readonly effectiveLocalDate: PlannerLocalDate;
}

export interface HabitLifecycleAsOfResult {
  readonly asOfLocalDate: PlannerLocalDate;
  readonly lifecycleState: HabitAsOfLifecycleState;
  readonly isPreActive: boolean;
  readonly activeFrom: PlannerLocalDate;
  readonly lifecycleEffectiveLocalDate: PlannerLocalDate | null;
  readonly nextLifecycleState: Lifecycle | null;
  readonly nextLifecycleEffectiveLocalDate: PlannerLocalDate | null;
  readonly latestSequenceNumber: number;
  readonly actionAvailability: HabitLifecycleActionAvailability;
}

export function resolveHabitLifecycleAsOf(input: Readonly<{
  activeRange: EffectiveRange;
  aggregateLifecycle: Lifecycle;
  asOfLocalDate: PlannerLocalDate;
  transitions: readonly HabitLifecycleAsOfTransitionInput[];
}>): Result<HabitLifecycleAsOfResult, PlannerDomainError> {
  const orderedBySequence = [...input.transitions].sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  if (orderedBySequence.length === 0 || orderedBySequence.some((transition, index) =>
    transition.sequenceNumber !== index + 1 ||
    (transition.lifecycle !== 'active' && transition.lifecycle !== 'archived') ||
    (index > 0 && (
      transition.lifecycle === orderedBySequence[index - 1]!.lifecycle ||
      transition.effectiveLocalDate < orderedBySequence[index - 1]!.effectiveLocalDate
    ))
  )) {
    return invalidHistory('Lifecycle history must contain one contiguous ordered transition chain.');
  }
  const firstEffectiveDate = orderedBySequence.reduce(
    (earliest, transition) => transition.effectiveLocalDate < earliest ? transition.effectiveLocalDate : earliest,
    orderedBySequence[0]!.effectiveLocalDate,
  );
  const latestBySequence = orderedBySequence[orderedBySequence.length - 1]!;
  if (firstEffectiveDate !== input.activeRange.effectiveFrom || latestBySequence.lifecycle !== input.aggregateLifecycle) {
    return invalidHistory('Lifecycle history and the habit projection disagree.');
  }
  const effective = orderedBySequence
    .filter((transition) => transition.effectiveLocalDate <= input.asOfLocalDate)
    .sort(compareLifecycleTransitionsDescending)[0] ?? null;
  const future = orderedBySequence
    .filter((transition) => transition.effectiveLocalDate > input.asOfLocalDate)
    .sort(compareLifecycleTransitionsAscending)[0] ?? null;
  if (effective === null && input.asOfLocalDate >= input.activeRange.effectiveFrom) {
    return invalidHistory('Lifecycle history has no transition for an active-range date.');
  }
  const isPreActive = effective === null;
  const state: HabitAsOfLifecycleState = isPreActive ? 'pre_active' : effective.lifecycle;
  const boundary = isPreActive ? future?.effectiveLocalDate ?? input.activeRange.effectiveFrom : input.asOfLocalDate;
  const projectionMatchesAsOf = !isPreActive && effective.lifecycle === input.aggregateLifecycle;
  const nextAtBoundary = isPreActive
    ? orderedBySequence
        .filter((transition) => transition.effectiveLocalDate === boundary)
        .sort(compareLifecycleTransitionsDescending)[0] ?? null
    : future;
  const archive = input.aggregateLifecycle === 'archived'
    ? unavailable('habit_already_archived')
    : isPreActive || projectionMatchesAsOf
      ? available(boundary)
      : unavailable('lifecycle_history_not_current');
  const restore = input.aggregateLifecycle === 'active'
    ? unavailable('habit_not_archived')
    : isPreActive || projectionMatchesAsOf
      ? available(boundary)
      : unavailable('lifecycle_history_not_current');
  /**
   * A habit that has not started yet can be deleted and edited like any other.
   *
   * It used to be refused with `habit_not_active_yet`, which read backwards: a
   * habit scheduled for next week has no marks against it at all, so it is the
   * *safest* thing in the catalogue to remove, and the one most likely to have
   * been created by mistake. The guard that remains is the one about data rather
   * than about the calendar — `lifecycle_history_not_current` still refuses when
   * the projection and the aggregate disagree, because that is an integrity
   * question and not a scheduling one.
   *
   * Changed on the owner's explicit instruction: any task or habit must be
   * editable and deletable whatever it is planned for.
   */
  const deleteAction = isPreActive || projectionMatchesAsOf
    ? available(isPreActive ? boundary : input.asOfLocalDate)
    : unavailable('lifecycle_history_not_current');
  const editAction = input.aggregateLifecycle === 'archived'
    ? unavailable('habit_already_archived')
    : deleteAction;
  return success(Object.freeze({
    asOfLocalDate: input.asOfLocalDate,
    lifecycleState: state,
    isPreActive,
    activeFrom: input.activeRange.effectiveFrom,
    lifecycleEffectiveLocalDate: effective?.effectiveLocalDate ?? null,
    nextLifecycleState: nextAtBoundary?.lifecycle ?? null,
    nextLifecycleEffectiveLocalDate: nextAtBoundary?.effectiveLocalDate ?? null,
    latestSequenceNumber: latestBySequence.sequenceNumber,
    actionAvailability: Object.freeze({
      archive,
      restore,
      edit: editAction,
      delete: deleteAction,
      pause: unavailable('not_supported'),
      resume: unavailable('not_supported'),
    }),
  }));
}

function available(earliestEffectiveLocalDate: PlannerLocalDate): HabitActionAvailability {
  return Object.freeze({ available: true, unavailableReason: null, earliestEffectiveLocalDate });
}

function unavailable(
  unavailableReason: HabitActionUnavailableReason,
  earliestEffectiveLocalDate: PlannerLocalDate | null = null,
): HabitActionAvailability {
  return Object.freeze({ available: false, unavailableReason, earliestEffectiveLocalDate });
}

function compareLifecycleTransitionsAscending(
  left: HabitLifecycleAsOfTransitionInput,
  right: HabitLifecycleAsOfTransitionInput,
): number {
  return left.effectiveLocalDate.localeCompare(right.effectiveLocalDate) || right.sequenceNumber - left.sequenceNumber;
}

function compareLifecycleTransitionsDescending(
  left: HabitLifecycleAsOfTransitionInput,
  right: HabitLifecycleAsOfTransitionInput,
): number {
  return right.effectiveLocalDate.localeCompare(left.effectiveLocalDate) || right.sequenceNumber - left.sequenceNumber;
}

function invalidHistory<T>(message: string): Result<T, PlannerDomainError> {
  return failure(createPlannerDomainError('lifecycle_history_invalid', message, { field: 'transitions' }));
}
