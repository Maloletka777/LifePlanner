import type { OrdinaryCompletionRole, PlannerId, PlannerLocalDate, Result } from '../domain';
import type { PlannerPersistenceError } from './planner-persistence-error';

export interface OrdinaryParentChangeInput {
  readonly action: 'attach' | 'reparent' | 'detach';
  readonly childHabitId: PlannerId;
  readonly parentHabitId: PlannerId | null;
  readonly effectiveLocalDate: PlannerLocalDate;
  readonly relationshipId: PlannerId | null;
  readonly relationshipVersionId: PlannerId | null;
  readonly completionRole: OrdinaryCompletionRole;
  readonly updatedAt: number;
}

export interface OrdinaryParentChangeReceipt {
  readonly childHabitId: PlannerId;
  readonly parentHabitId: PlannerId | null;
  readonly completionRole: OrdinaryCompletionRole | null;
  readonly outcome: 'attached' | 'reparented' | 'detached' | 'no_change';
  readonly effectiveLocalDate: PlannerLocalDate;
}

export type OrdinaryParentChangeResult = Promise<Result<OrdinaryParentChangeReceipt, PlannerPersistenceError>>;
