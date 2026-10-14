import {
  addPlannerCalendarDays,
  failure,
  success,
  type PlannerLocalDate,
  type Result,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type PlannerPersistenceError,
  type RoutineConversionPersistenceConflict,
  type RoutineConversionPersistenceInput,
  type RoutineConversionReceipt,
} from '../../repositories';
import { validateOrdinaryGraph } from './sqlite-habit-ordinary-parent-repository';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

interface HabitRow {
  readonly id: string;
  readonly lifecycle: 'active' | 'archived';
  readonly active_from: string;
  readonly active_to: string | null;
  readonly updated_at: number;
}

interface OrdinaryRow {
  readonly id: string;
  readonly relationship_id: string;
  readonly version_number: number;
  readonly parent_habit_id: string;
  readonly child_habit_id: string;
  readonly completion_role: 'organizational' | 'routine_step';
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly end_reason: 'scheduled_end' | 'detached' | 'reparented' | 'parent_archived' | 'child_archived' | null;
  readonly created_at: number;
}

interface ObservationBoundaryRow {
  readonly count: number;
  readonly latest_date: string | null;
}

export async function convertOrganizationalParentToRoutine(
  database: PlannerSqliteDatabase,
  input: RoutineConversionPersistenceInput,
): Promise<Result<RoutineConversionReceipt, PlannerPersistenceError>> {
  const parent = await database.getFirstAsync<HabitRow>(
    'SELECT id,lifecycle,active_from,active_to,updated_at FROM habits WHERE id=$id;',
    { $id: input.parentHabitId },
  );
  if (parent === null) return conversionFailure('ordinary_habit_not_found', 'The routine parent no longer exists.');
  if (parent.lifecycle !== 'active') return conversionConflict('ordinary_habit_archived', 'Restore the parent before converting it.', { reason: 'parent_inactive' });
  if (!contains(parent, input.effectiveLocalDate)) return conversionFailure('ordinary_boundary_conflict', 'The conversion date is outside the parent active range.');
  if (!Number.isSafeInteger(input.updatedAt) || input.updatedAt < parent.updated_at) {
    return conversionFailure('ordinary_data_integrity_failure', 'The parent changed before conversion could be saved.');
  }
  if (input.relationships.length === 0) {
    return conversionConflict('ordinary_boundary_conflict', 'Choose at least one direct organizational child.', { reason: 'no_eligible_relationships' });
  }
  if (
    new Set(input.relationships.map((relationship) => relationship.childHabitId)).size !== input.relationships.length ||
    new Set(input.relationships.map((relationship) => relationship.relationshipId)).size !== input.relationships.length
  ) {
    return conversionFailure('ordinary_data_integrity_failure', 'The conversion selection contains duplicate relationships.');
  }

  const observationBoundary = await database.getFirstAsync<ObservationBoundaryRow>(
    `SELECT count(*) AS count,max(occurrence_local_date) AS latest_date
     FROM habit_observations
     WHERE habit_id=$parent AND occurrence_local_date>=$date;`,
    { $parent: input.parentHabitId, $date: input.effectiveLocalDate },
  );
  if ((observationBoundary?.count ?? 0) > 0 && observationBoundary?.latest_date !== null) {
    const latest = observationBoundary?.latest_date as PlannerLocalDate;
    const next = addPlannerCalendarDays(latest, 1);
    return conversionConflict(
      'ordinary_boundary_conflict',
      'Parent observations protect independent completion at and after the requested boundary.',
      {
        reason: 'parent_observations',
        ...(next.ok ? { earliestSafeEffectiveDate: next.value } : {}),
      },
    );
  }

  const currentRows = await database.getAllAsync<OrdinaryRow>(
    `SELECT id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,
            effective_from,effective_to,end_reason,created_at
     FROM habit_ordinary_parent_versions
     WHERE parent_habit_id=$parent AND effective_from<=$date
       AND (effective_to IS NULL OR effective_to>$date)
     ORDER BY child_habit_id,relationship_id,id;`,
    { $parent: input.parentHabitId, $date: input.effectiveLocalDate },
  );
  const currentByChild = new Map(currentRows.map((row) => [row.child_habit_id, row] as const));
  const selectedRows: OrdinaryRow[] = [];
  for (const selection of input.relationships) {
    const row = currentByChild.get(selection.childHabitId);
    if (
      row === undefined || row.completion_role !== 'organizational' ||
      row.id !== selection.currentRelationshipVersionId ||
      row.relationship_id !== selection.relationshipId
    ) {
      return conversionConflict('ordinary_boundary_conflict', 'The conversion preview is stale.', { reason: 'stale_relationships' });
    }
    const child = await database.getFirstAsync<HabitRow>(
      'SELECT id,lifecycle,active_from,active_to,updated_at FROM habits WHERE id=$id;',
      { $id: selection.childHabitId },
    );
    if (child === null || child.lifecycle !== 'active' || !contains(child, input.effectiveLocalDate)) {
      return conversionConflict('ordinary_boundary_conflict', 'A selected child is no longer eligible.', { reason: 'stale_relationships' });
    }
    if (row.effective_from < input.effectiveLocalDate && selection.newRelationshipVersionId === null) {
      return conversionFailure('ordinary_data_integrity_failure', 'A split relationship version identifier is missing.');
    }
    if (row.effective_from === input.effectiveLocalDate && selection.newRelationshipVersionId !== null) {
      return conversionFailure('ordinary_data_integrity_failure', 'A same-boundary conversion must preserve the current version identifier.');
    }
    const future = await database.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM habit_ordinary_parent_versions
       WHERE relationship_id=$relationship AND effective_from>$date;`,
      { $relationship: row.relationship_id, $date: input.effectiveLocalDate },
    );
    if ((future?.count ?? 0) > 0) {
      return conversionConflict('ordinary_boundary_conflict', 'A selected relationship already has future state.', { reason: 'stale_relationships' });
    }
    selectedRows.push(row);
  }

  const graphRows = await database.getAllAsync<{ parent_habit_id: string; child_habit_id: string }>(
    `SELECT parent_habit_id,child_habit_id FROM habit_ordinary_parent_versions
     WHERE effective_from<=$date AND (effective_to IS NULL OR effective_to>$date)
     ORDER BY child_habit_id,parent_habit_id;`,
    { $date: input.effectiveLocalDate },
  );
  const graphConflict = validateOrdinaryGraph(graphRows);
  if (graphConflict !== null) {
    return conversionConflict(
      graphConflict,
      graphConflict === 'ordinary_cycle'
        ? 'The existing ordinary hierarchy contains a cycle.'
        : 'The existing ordinary hierarchy exceeds five levels.',
      { reason: graphConflict === 'ordinary_cycle' ? 'cycle' : 'depth' },
    );
  }

  for (const [index, row] of selectedRows.entries()) {
    const selection = input.relationships[index];
    if (row.effective_from === input.effectiveLocalDate) {
      await database.runAsync(
        `UPDATE habit_ordinary_parent_versions
         SET completion_role='routine_step',updated_at=$now WHERE id=$id;`,
        { $now: input.updatedAt, $id: row.id },
      );
      continue;
    }
    await database.runAsync(
      `UPDATE habit_ordinary_parent_versions
       SET effective_to=$date,end_reason='reparented',updated_at=$now WHERE id=$id;`,
      { $date: input.effectiveLocalDate, $now: input.updatedAt, $id: row.id },
    );
    await database.runAsync(
      `INSERT INTO habit_ordinary_parent_versions(
         id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,
         effective_from,effective_to,end_reason,created_at,updated_at
       ) VALUES(
         $id,$relationship,$version,$parent,$child,'routine_step',
         $date,$end,$endReason,$now,$now
       );`,
      {
        $id: selection.newRelationshipVersionId,
        $relationship: row.relationship_id,
        $version: row.version_number + 1,
        $parent: row.parent_habit_id,
        $child: row.child_habit_id,
        $date: input.effectiveLocalDate,
        $end: row.effective_to,
        $endReason: row.end_reason,
        $now: input.updatedAt,
      },
    );
  }

  const roleCounts = await database.getFirstAsync<{ routine_count: number; organizational_count: number }>(
    `SELECT
       sum(CASE WHEN completion_role='routine_step' THEN 1 ELSE 0 END) AS routine_count,
       sum(CASE WHEN completion_role='organizational' THEN 1 ELSE 0 END) AS organizational_count
     FROM habit_ordinary_parent_versions
     WHERE parent_habit_id=$parent AND effective_from<=$date
       AND (effective_to IS NULL OR effective_to>$date);`,
    { $parent: input.parentHabitId, $date: input.effectiveLocalDate },
  );
  const routineCount = roleCounts?.routine_count ?? 0;
  const organizationalCount = roleCounts?.organizational_count ?? 0;
  if (routineCount < selectedRows.length) {
    return conversionFailure('ordinary_data_integrity_failure', 'Routine conversion readback failed.');
  }
  return success(Object.freeze({
    parentHabitId: input.parentHabitId,
    effectiveLocalDate: input.effectiveLocalDate,
    convertedChildHabitIds: Object.freeze(input.relationships.map((relationship) => relationship.childHabitId)),
    convertedRelationshipIds: Object.freeze(input.relationships.map((relationship) => relationship.relationshipId)),
    directRoutineStepCount: routineCount,
    retainedOrganizationalChildCount: organizationalCount,
    mixedStructure: routineCount > 0 && organizationalCount > 0,
  }));
}

function contains(habit: HabitRow, date: string): boolean {
  return habit.active_from <= date && (habit.active_to === null || date < habit.active_to);
}

function conversionConflict<T = never>(
  code: PlannerPersistenceError['code'],
  message: string,
  conflict: RoutineConversionPersistenceConflict,
): Result<T, PlannerPersistenceError> {
  return failure(createPlannerPersistenceError(code, message, {
    operation: 'convertOrganizationalParentToRoutine',
    cause: Object.freeze(conflict),
  }));
}

function conversionFailure<T = never>(
  code: PlannerPersistenceError['code'],
  message: string,
): Result<T, PlannerPersistenceError> {
  return failure(createPlannerPersistenceError(code, message, {
    operation: 'convertOrganizationalParentToRoutine',
  }));
}
