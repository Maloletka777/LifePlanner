import {
  comparePlannerLocalDates,
  failure,
  success,
  validateDependencyGraph,
  type CandidateDependencyEdge,
  type EffectiveRange,
  type PlannerId,
  type Result,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type AddDependencyAggregatePersistenceInput,
  type HabitDependencyAggregate,
  type PlannerPersistenceError,
} from '../../repositories';
import {
  mapDependencyAggregateRows,
  mapDependencyGraphRows,
} from './planner-dependency-row-mappers';
import { habitVisualIdentityToParameters, mapHabitRow } from './planner-row-mappers';
import {
  insertHabitIdentityRow,
  insertHabitImportanceVersionRow,
  insertHabitReminderRow,
  insertHabitTrackingVersionRow,
  validateCategoryForCreation,
} from './sqlite-habit-repository';
import type {
  HabitDependencyVersionRow,
  HabitImportanceVersionRow,
  HabitReminderRow,
  HabitRow,
  HabitTrackingVersionRow,
} from './planner-row-types';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';
import { resolveRootSchedule } from './sqlite-habit-lifecycle-repository';

const READ_HABIT_SQL = 'SELECT * FROM habits WHERE id = $habitId;';
const READ_INTERSECTING_DEPENDENCIES_SQL = `
SELECT *
FROM habit_dependency_versions
WHERE ($candidateTo IS NULL OR effective_from < $candidateTo)
  AND (effective_to IS NULL OR effective_to > $candidateFrom)
ORDER BY effective_from, parent_habit_id, dependent_habit_id,
         relationship_id, version_number, id;
`;
const INSERT_DEPENDENCY_SQL = `
INSERT INTO habit_dependency_versions (
  id, relationship_id, version_number, parent_habit_id,
  dependent_habit_id, dependency_type, occurrence_mode,
  effective_from, effective_to, end_reason, created_at, updated_at
) VALUES (
  $relationshipVersionId, $relationshipId, 1, $parentHabitId,
  $dependentHabitId, $dependencyType, 'inherited_parent',
  $effectiveFrom, $effectiveTo, $endReason, $createdAt, $createdAt
);
`;
const READ_DEPENDENCY_SQL = `
SELECT * FROM habit_dependency_versions WHERE id = $relationshipVersionId;
`;
const READ_APPLICABLE_TRACKING_SQL = `
SELECT * FROM habit_tracking_versions
WHERE habit_id = $habitId
  AND effective_from <= $effectiveDate
  AND (effective_to IS NULL OR effective_to > $effectiveDate)
ORDER BY version_number, id;
`;
const READ_APPLICABLE_IMPORTANCE_SQL = `
SELECT * FROM habit_importance_versions
WHERE habit_id = $habitId
  AND effective_from <= $effectiveDate
  AND (effective_to IS NULL OR effective_to > $effectiveDate)
ORDER BY version_number, id;
`;
const READ_ACTIVE_REMINDERS_SQL = `
SELECT * FROM habit_reminders
WHERE habit_id = $habitId AND lifecycle = 'active'
ORDER BY trigger_local_time, id;
`;
const COUNT_DEPENDENT_SCHEDULES_SQL = `
SELECT count(*) AS count
FROM habit_schedule_versions
WHERE habit_id = $habitId;
`;
const COUNT_DEPENDENT_OBSERVATIONS_SQL = `
SELECT count(*) AS count
FROM habit_observations
WHERE habit_id = $habitId;
`;

export async function validateAndInsertDependencyAggregate(
  database: PlannerSqliteDatabase,
  input: AddDependencyAggregatePersistenceInput,
): Promise<Result<HabitDependencyAggregate, PlannerPersistenceError>> {
  const parentResult = await loadEligibleHabit(
    database,
    input.relationship.parentHabitId,
    input.relationship.effectiveRange,
    'parent',
  );
  if (!parentResult.ok) return parentResult;

  if (input.relationship.parentHabitId === input.relationship.dependentHabitId) {
    return dependencyFailure(
      'dependency_self_link',
      'A habit cannot depend on itself.',
      'validateDependencyEligibility',
    );
  }

  if (input.source === 'existing') {
    const dependentResult = await loadEligibleHabit(
      database,
      input.relationship.dependentHabitId,
      input.relationship.effectiveRange,
      'dependent',
    );
    if (!dependentResult.ok) return dependentResult;
    const ordinaryConflict = await database.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count
       FROM habit_ordinary_parent_versions
       WHERE child_habit_id = $dependentHabitId
         AND effective_from < COALESCE($effectiveTo, '9999-12-31')
         AND (effective_to IS NULL OR effective_to > $effectiveFrom);`,
      {
        $dependentHabitId: input.relationship.dependentHabitId,
        $effectiveFrom: input.relationship.effectiveRange.effectiveFrom,
        $effectiveTo: input.relationship.effectiveRange.effectiveTo,
      },
    );
    if ((ordinaryConflict?.count ?? 0) > 0) {
      return dependencyFailure(
        'dependency_relationship_mode_conflict',
        'An ordinary sub-habit cannot also use a conditional dependency relationship in the same range.',
        'validateRelationshipMode',
      );
    }
  } else {
    const categoryResult = await validateCategoryForCreation(
      database,
      input.newDependent.categoryId,
    );
    if (!categoryResult.ok) {
      return dependencyFailure(
        categoryResult.error.code === 'category_archived'
          ? 'dependency_category_archived'
          : categoryResult.error.code === 'category_not_found'
            ? 'dependency_category_not_found'
            : 'dependency_data_integrity_failure',
        categoryResult.error.message,
        'validateNewDependentCategory',
        categoryResult.error,
      );
    }
  }

  const graphRows = await database.getAllAsync<HabitDependencyVersionRow>(
    READ_INTERSECTING_DEPENDENCIES_SQL,
    {
      $candidateFrom: input.relationship.effectiveRange.effectiveFrom,
      $candidateTo: input.relationship.effectiveRange.effectiveTo,
    },
  );
  const graphResult = mapDependencyGraphRows(graphRows);
  if (!graphResult.ok) return graphResult;

  const candidate: CandidateDependencyEdge = Object.freeze({
    relationshipId: input.relationship.relationshipId,
    relationshipVersionId: input.relationship.relationshipVersionId,
    parentHabitId: input.relationship.parentHabitId,
    dependentHabitId: input.relationship.dependentHabitId,
    dependencyType: input.relationship.dependencyType,
    occurrenceMode: input.relationship.occurrenceMode,
    effectiveRange: input.relationship.effectiveRange,
  });
  const validation = validateDependencyGraph(graphResult.value, candidate);
  if (!validation.ok) {
    return dependencyFailure(
      validation.error.code,
      validation.error.message,
      'validateDependencyGraph',
      validation.error,
    );
  }

  if (input.source === 'new') {
    await insertHabitIdentityRow(database, input.newDependent);
    await database.runAsync(
      'INSERT INTO habit_visual_identities(id,habit_id,icon_kind,symbol_key,emoji_value,accent_key,created_at,updated_at) VALUES($habitId,$habitId,$iconKind,$symbolKey,$emojiValue,$accentKey,$now,$now);',
      {
        $habitId: input.newDependent.habitId,
        ...habitVisualIdentityToParameters(input.newDependent.visualIdentity),
        $now: input.newDependent.createdAt,
      },
    );
    const rootSchedule = await resolveRootSchedule(database, input.relationship.parentHabitId, input.relationship.effectiveRange.effectiveFrom);
    if (!rootSchedule.ok) return dependencyFailure('dependency_data_integrity_failure', 'The dependent lifecycle boundary could not resolve its root schedule.', 'insertDependentLifecycle', rootSchedule.error);
    await database.runAsync(`INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at) VALUES($id,$habitId,1,'active',$date,$timezone,$now,$now);`, {
      $id: input.newDependent.lifecycleTransitionId,
      $habitId: input.newDependent.habitId,
      $date: input.newDependent.activeRange.effectiveFrom,
      $timezone: rootSchedule.value.model.definition.evaluationTimezone,
      $now: input.newDependent.createdAt,
    });
    await insertHabitTrackingVersionRow(database, input.newDependent);
    await insertHabitImportanceVersionRow(database, input.newDependent);
    await database.runAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at) VALUES($id,$habitId,1,$effectiveFrom,$effectiveTo,NULL,$now,$now);`, {
      $id: input.newDependent.plannedTimeVersionId,
      $habitId: input.newDependent.habitId,
      $effectiveFrom: input.newDependent.activeRange.effectiveFrom,
      $effectiveTo: input.newDependent.activeRange.effectiveTo,
      $now: input.newDependent.createdAt,
    });
    if (input.newDependent.reminder !== null) {
      await insertHabitReminderRow(database, {
        habitId: input.newDependent.habitId,
        reminder: input.newDependent.reminder,
        createdAt: input.newDependent.createdAt,
      });
    }
  }

  await database.runAsync(INSERT_DEPENDENCY_SQL, {
    $relationshipVersionId: input.relationship.relationshipVersionId,
    $relationshipId: input.relationship.relationshipId,
    $parentHabitId: input.relationship.parentHabitId,
    $dependentHabitId: input.relationship.dependentHabitId,
    $dependencyType: input.relationship.dependencyType,
    $effectiveFrom: input.relationship.effectiveRange.effectiveFrom,
    $effectiveTo: input.relationship.effectiveRange.effectiveTo,
    $endReason: input.relationship.endReason,
    $createdAt: input.relationship.createdAt,
  });

  return readDependencyAggregate(database, input);
}

export async function readDependencyAggregate(
  database: PlannerSqliteDatabase,
  expected: AddDependencyAggregatePersistenceInput,
): Promise<Result<HabitDependencyAggregate, PlannerPersistenceError>> {
  const relationshipParameters = {
    $relationshipVersionId: expected.relationship.relationshipVersionId,
  };
  const habitParameters = {
    $habitId: expected.relationship.dependentHabitId,
  };
  const applicableConfigurationParameters = {
    ...habitParameters,
    $effectiveDate: expected.relationship.effectiveRange.effectiveFrom,
  };
  const [
    relationship,
    parent,
    dependent,
    tracking,
    importance,
    reminders,
    scheduleCount,
    observationCount,
  ] =
    await Promise.all([
      database.getFirstAsync<HabitDependencyVersionRow>(
        READ_DEPENDENCY_SQL,
        relationshipParameters,
      ),
      database.getFirstAsync<HabitRow>(READ_HABIT_SQL, {
        $habitId: expected.relationship.parentHabitId,
      }),
      database.getFirstAsync<HabitRow>(READ_HABIT_SQL, {
        $habitId: expected.relationship.dependentHabitId,
      }),
      database.getAllAsync<HabitTrackingVersionRow>(
        READ_APPLICABLE_TRACKING_SQL,
        applicableConfigurationParameters,
      ),
      database.getAllAsync<HabitImportanceVersionRow>(
        READ_APPLICABLE_IMPORTANCE_SQL,
        applicableConfigurationParameters,
      ),
      database.getAllAsync<HabitReminderRow>(
        READ_ACTIVE_REMINDERS_SQL,
        habitParameters,
      ),
      database.getFirstAsync<{ count: number }>(
        COUNT_DEPENDENT_SCHEDULES_SQL,
        habitParameters,
      ),
      database.getFirstAsync<{ count: number }>(
        COUNT_DEPENDENT_OBSERVATIONS_SQL,
        habitParameters,
      ),
    ]);

  if (
    relationship === null ||
    parent === null ||
    dependent === null ||
    tracking.length !== 1 ||
    importance.length !== 1 ||
    scheduleCount === null ||
    observationCount === null ||
    !Number.isSafeInteger(scheduleCount.count) ||
    scheduleCount.count < 0 ||
    !Number.isSafeInteger(observationCount.count) ||
    observationCount.count < 0
  ) {
    return dependencyFailure(
      'dependency_data_integrity_failure',
      'The persisted dependency aggregate is incomplete.',
      'readDependencyAggregate',
    );
  }

  return mapDependencyAggregateRows(
    {
      relationship,
      parent,
      dependent,
      dependentTracking: tracking[0],
      dependentImportance: importance[0],
      dependentReminders: reminders,
      dependentScheduleCount: scheduleCount.count,
      dependentObservationCount: observationCount.count,
    },
    expected,
  );
}

async function loadEligibleHabit(
  database: PlannerSqliteDatabase,
  habitId: PlannerId,
  relationshipRange: EffectiveRange,
  role: 'parent' | 'dependent',
): Promise<Result<null, PlannerPersistenceError>> {
  const row = await database.getFirstAsync<HabitRow>(READ_HABIT_SQL, {
    $habitId: habitId,
  });
  if (row === null) {
    return dependencyFailure(
      role === 'parent'
        ? 'dependency_parent_not_found'
        : 'dependency_dependent_not_found',
      `The dependency ${role} does not exist.`,
      'loadEligibleHabit',
    );
  }
  const habit = mapHabitRow(row);
  if (!habit.ok) {
    return dependencyFailure(
      'dependency_data_integrity_failure',
      `The persisted dependency ${role} is malformed.`,
      'loadEligibleHabit',
      habit.error,
    );
  }
  if (habit.value.lifecycle !== 'active') {
    return dependencyFailure(
      role === 'parent'
        ? 'dependency_parent_archived'
        : 'dependency_dependent_archived',
      `The dependency ${role} is archived.`,
      'loadEligibleHabit',
    );
  }
  if (!rangeContains(habit.value.activeRange, relationshipRange)) {
    return dependencyFailure(
      role === 'parent'
        ? 'dependency_outside_parent_active_range'
        : 'dependency_outside_dependent_active_range',
      `The relationship is outside the ${role} active range.`,
      'loadEligibleHabit',
    );
  }
  return success(null);
}

function rangeContains(container: EffectiveRange, nested: EffectiveRange): boolean {
  if (
    comparePlannerLocalDates(nested.effectiveFrom, container.effectiveFrom) < 0
  ) {
    return false;
  }
  if (container.effectiveTo === null) return true;
  return (
    nested.effectiveTo !== null &&
    comparePlannerLocalDates(nested.effectiveTo, container.effectiveTo) <= 0
  );
}

function dependencyFailure<T>(
  code: PlannerPersistenceError['code'],
  message: string,
  operation: string,
  cause?: unknown,
): Result<T, PlannerPersistenceError> {
  return failure(
    createPlannerPersistenceError(code, message, { operation, cause }),
  );
}
