import type { PlannerId, PlannerLocalDate } from '../domain';

export interface RoutineRelationshipConversionInput {
  readonly relationshipId: PlannerId;
  readonly currentRelationshipVersionId: PlannerId;
  readonly childHabitId: PlannerId;
  readonly newRelationshipVersionId: PlannerId | null;
}

export interface RoutineConversionPersistenceInput {
  readonly parentHabitId: PlannerId;
  readonly effectiveLocalDate: PlannerLocalDate;
  readonly relationships: readonly RoutineRelationshipConversionInput[];
  readonly updatedAt: number;
}

export interface RoutineConversionReceipt {
  readonly parentHabitId: PlannerId;
  readonly effectiveLocalDate: PlannerLocalDate;
  readonly convertedChildHabitIds: readonly PlannerId[];
  readonly convertedRelationshipIds: readonly PlannerId[];
  readonly directRoutineStepCount: number;
  readonly retainedOrganizationalChildCount: number;
  readonly mixedStructure: boolean;
}

export interface RoutineConversionPersistenceConflict {
  readonly reason:
    | 'parent_observations'
    | 'parent_inactive'
    | 'no_eligible_relationships'
    | 'stale_relationships'
    | 'cycle'
    | 'depth';
  readonly earliestSafeEffectiveDate?: PlannerLocalDate;
}
