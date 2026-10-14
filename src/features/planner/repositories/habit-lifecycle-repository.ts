import type { Lifecycle, PlannerId, PlannerLocalDate, PlannerLocalTime, PlannerTimezone, Result, ScheduleDefinition } from '../domain';
import type { PlannerPersistenceError } from './planner-persistence-error';

export interface HabitLifecycleTransition {
  readonly id: PlannerId;
  readonly habitId: PlannerId;
  readonly sequenceNumber: number;
  readonly lifecycle: Lifecycle;
  readonly effectiveLocalDate: PlannerLocalDate;
  readonly boundaryTimezone: PlannerTimezone;
  readonly transitionedAt: number;
  readonly createdAt: number;
}

export interface LifecycleWriteInput {
  readonly habitId: PlannerId;
  readonly effectiveLocalDate: PlannerLocalDate;
  readonly boundaryTimezone: PlannerTimezone;
  readonly transitionedAt: number;
  readonly generatedIds: readonly PlannerId[];
  readonly restoreSchedule?: ScheduleDefinition;
  readonly restorePlannedLocalTime?: PlannerLocalTime | null;
}

export interface LifecycleWriteReceipt {
  readonly habitId: PlannerId;
  readonly requestedEffectiveLocalDate: PlannerLocalDate;
  readonly effectiveLocalDate: PlannerLocalDate;
  readonly state: Lifecycle;
  readonly transition: HabitLifecycleTransition | null;
  readonly affectedDependentCount: number;
  readonly outcome: 'changed' | 'already_archived' | 'already_active' | 'schedule_required';
  readonly suggestedRestoreSchedule: ScheduleDefinition | null;
}

export interface DeleteHabitInput extends LifecycleWriteInput {
  readonly confirmed: true;
}

export interface DeleteHabitReceipt {
  readonly deleted: true;
  readonly affectedDependentCount: number;
  readonly detachedObservationCount: number;
}

export interface DeleteHabitChainTarget {
  readonly habitId: PlannerId;
  readonly name: string;
  readonly depth: number;
  readonly boundaryTimezone: PlannerTimezone | null;
}

export interface DeleteHabitChainImpact {
  readonly rootHabitId: PlannerId;
  readonly rootHabitName: string;
  readonly orderedTargetHabitIds: readonly PlannerId[];
  readonly targets: readonly DeleteHabitChainTarget[];
  readonly targetCount: number;
  readonly relationshipCount: number;
  readonly observationCount: number;
  readonly correctionCount: number;
  readonly visualIdentityCount: number;
  readonly unrelatedPreservedCount: number;
}

export interface PreviewDeleteHabitChainInput {
  readonly rootHabitId: PlannerId;
  readonly asOfLocalDate: PlannerLocalDate;
}

export interface DeleteHabitChainInput extends LifecycleWriteInput {
  readonly expectedOrderedTargetHabitIds: readonly PlannerId[];
  readonly confirmed: true;
}

export interface DeleteHabitChainReceipt {
  readonly deleted: true;
  readonly impact: DeleteHabitChainImpact;
  readonly affectedDependentCount: number;
  readonly detachedObservationCount: number;
}

export type LifecyclePersistenceResult<T> = Promise<Result<T, PlannerPersistenceError>>;
