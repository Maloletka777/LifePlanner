import { failure, isOrdinaryCompletionRole, success, type OrdinaryCompletionRole, type PlannerLocalDate, type Result } from '../../domain';
import { createPlannerPersistenceError, type OrdinaryParentChangeInput, type OrdinaryParentChangeReceipt, type PlannerPersistenceError } from '../../repositories';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

interface HabitStateRow { readonly id: string; readonly lifecycle: string; readonly active_from: string; readonly active_to: string | null; readonly updated_at: number }
interface OrdinaryRow { readonly id: string; readonly relationship_id: string; readonly parent_habit_id: string; readonly child_habit_id: string; readonly completion_role: OrdinaryCompletionRole; readonly effective_from: string; readonly effective_to: string | null }
interface EdgeRow { readonly parent_habit_id: string; readonly child_habit_id: string }

export async function changeOrdinaryParent(database: PlannerSqliteDatabase, input: OrdinaryParentChangeInput): Promise<Result<OrdinaryParentChangeReceipt, PlannerPersistenceError>> {
  if (!isOrdinaryCompletionRole(input.completionRole)) return ordinaryFailure('ordinary_data_integrity_failure', 'The ordinary relationship completion role is invalid.');
  const child = await loadHabit(database, input.childHabitId);
  if (child === null) return ordinaryFailure('ordinary_habit_not_found', 'The child habit no longer exists.');
  if (child.lifecycle !== 'active') return ordinaryFailure('ordinary_habit_archived', 'Restore the child before changing its ordinary parent.');
  if (!contains(child, input.effectiveLocalDate)) return ordinaryFailure('ordinary_boundary_conflict', 'The relationship date is outside the child habit range.');
  if (input.updatedAt < child.updated_at) return ordinaryFailure('ordinary_data_integrity_failure', 'The child changed before the relationship could be saved.');

  let parent: HabitStateRow | null = null;
  if (input.parentHabitId !== null) {
    parent = await loadHabit(database, input.parentHabitId);
    if (parent === null) return ordinaryFailure('ordinary_habit_not_found', 'The parent habit no longer exists.');
    if (parent.lifecycle !== 'active') return ordinaryFailure('ordinary_habit_archived', 'Restore the parent before attaching a child.');
    if (parent.id === child.id) return ordinaryFailure('ordinary_cycle', 'A habit cannot be its own ordinary parent.');
    if (!contains(parent, input.effectiveLocalDate)) return ordinaryFailure('ordinary_boundary_conflict', 'The relationship date is outside the parent habit range.');
    const schedules = await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_schedule_versions WHERE habit_id=$child AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$date);', { $child: child.id, $date: input.effectiveLocalDate });
    if (schedules?.count !== 1) return ordinaryFailure('ordinary_data_integrity_failure', 'An ordinary child requires one independent schedule.');
  }

  const currentRows = await database.getAllAsync<OrdinaryRow>('SELECT id,relationship_id,parent_habit_id,child_habit_id,completion_role,effective_from,effective_to FROM habit_ordinary_parent_versions WHERE child_habit_id=$child AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$date) ORDER BY effective_from;', { $child: child.id, $date: input.effectiveLocalDate });
  if (currentRows.length > 1) return ordinaryFailure('ordinary_data_integrity_failure', 'The child has ambiguous ordinary parents.');
  const current = currentRows[0] ?? null;
  if (current !== null && !isOrdinaryCompletionRole(current.completion_role)) return ordinaryFailure('ordinary_data_integrity_failure', 'The current ordinary relationship completion role is invalid.');
  if (input.action === 'detach' && current === null) return success(receipt(input, null, null, 'no_change'));
  if (input.action === 'attach' && current !== null) {
    if (current.parent_habit_id === input.parentHabitId && current.completion_role === input.completionRole) return success(receipt(input, input.parentHabitId, current.completion_role, 'no_change'));
    return ordinaryFailure('ordinary_relationship_mode_conflict', 'The child already has an ordinary parent; choose reparent.');
  }
  if (input.action === 'reparent' && current === null) return ordinaryFailure('ordinary_boundary_conflict', 'The child has no ordinary parent to replace.');

  const future = await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_ordinary_parent_versions WHERE child_habit_id=$child AND effective_from>$date;', { $child: child.id, $date: input.effectiveLocalDate });
  if ((future?.count ?? 0) > 0) return ordinaryFailure('ordinary_boundary_conflict', 'A future ordinary-parent change already exists.');

  if (input.action !== 'detach' && parent !== null) {
    const end = earliestEnd(parent.active_to, child.active_to);
    const dependencyConflict = await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM habit_dependency_versions WHERE dependent_habit_id=$child AND effective_from<COALESCE($end,'9999-12-31') AND (effective_to IS NULL OR effective_to>$start);`, { $child: child.id, $start: input.effectiveLocalDate, $end: end });
    if ((dependencyConflict?.count ?? 0) > 0) return ordinaryFailure('ordinary_relationship_mode_conflict', 'The child already uses a conditional dependency relationship in this range.');
    const graph = await loadCandidateGraph(database, input, current);
    const graphResult = validateOrdinaryGraph(graph);
    if (graphResult !== null) return ordinaryFailure(graphResult, graphResult === 'ordinary_cycle' ? 'The ordinary hierarchy would contain a cycle.' : 'The ordinary hierarchy cannot be deeper than five levels.');
  }

  if (input.action === 'detach') {
    if (current === null || current.effective_from >= input.effectiveLocalDate) return ordinaryFailure('ordinary_boundary_conflict', 'Detach must preserve a non-empty historical relationship range.');
    await database.runAsync(`UPDATE habit_ordinary_parent_versions SET effective_to=$date,end_reason='detached',updated_at=$now WHERE id=$id;`, { $date: input.effectiveLocalDate, $now: input.updatedAt, $id: current.id });
    return success(receipt(input, null, current.completion_role, 'detached'));
  }

  if (parent === null || input.parentHabitId === null || input.relationshipId === null || input.relationshipVersionId === null) return ordinaryFailure('ordinary_data_integrity_failure', 'The ordinary-parent identifiers are missing.');
  if (current !== null && current.parent_habit_id === parent.id && current.completion_role === input.completionRole) return success(receipt(input, input.parentHabitId, current.completion_role, 'no_change'));
  if (current !== null && current.effective_from === input.effectiveLocalDate) {
    await database.runAsync('UPDATE habit_ordinary_parent_versions SET parent_habit_id=$parent,completion_role=$completionRole,updated_at=$now WHERE id=$id;', { $parent: parent.id, $completionRole: input.completionRole, $now: input.updatedAt, $id: current.id });
    return success(receipt(input, input.parentHabitId, input.completionRole, 'reparented'));
  }
  if (current !== null) await database.runAsync(`UPDATE habit_ordinary_parent_versions SET effective_to=$date,end_reason='reparented',updated_at=$now WHERE id=$id;`, { $date: input.effectiveLocalDate, $now: input.updatedAt, $id: current.id });
  const end = earliestEnd(parent.active_to, child.active_to);
  if (end !== null && end <= input.effectiveLocalDate) return ordinaryFailure('ordinary_boundary_conflict', 'The ordinary relationship would have no valid range.');
  await database.runAsync(`INSERT INTO habit_ordinary_parent_versions(id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,effective_from,effective_to,end_reason,created_at,updated_at) VALUES($id,$relationshipId,1,$parent,$child,$completionRole,$start,$end,$reason,$now,$now);`, { $id: input.relationshipVersionId, $relationshipId: input.relationshipId, $parent: parent.id, $child: child.id, $completionRole: input.completionRole, $start: input.effectiveLocalDate, $end: end, $reason: end === null ? null : 'scheduled_end', $now: input.updatedAt });
  const readback = await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_ordinary_parent_versions WHERE id=$id AND parent_habit_id=$parent AND child_habit_id=$child AND completion_role=$completionRole;', { $id: input.relationshipVersionId, $parent: parent.id, $child: child.id, $completionRole: input.completionRole });
  if (readback?.count !== 1) return ordinaryFailure('ordinary_data_integrity_failure', 'Ordinary relationship readback failed.');
  return success(receipt(input, input.parentHabitId, input.completionRole, current === null ? 'attached' : 'reparented'));
}

async function loadCandidateGraph(database: PlannerSqliteDatabase, input: OrdinaryParentChangeInput, current: OrdinaryRow | null): Promise<EdgeRow[]> {
  const rows = await database.getAllAsync<EdgeRow>('SELECT parent_habit_id,child_habit_id FROM habit_ordinary_parent_versions WHERE effective_from<=$date AND (effective_to IS NULL OR effective_to>$date) ORDER BY child_habit_id;', { $date: input.effectiveLocalDate });
  const filtered = rows.filter((row) => row.child_habit_id !== current?.child_habit_id && row.child_habit_id !== input.childHabitId);
  if (input.parentHabitId !== null) filtered.push({ parent_habit_id: input.parentHabitId, child_habit_id: input.childHabitId });
  return filtered;
}

export function validateOrdinaryGraph(edges: readonly EdgeRow[]): 'ordinary_cycle' | 'ordinary_depth_exceeded' | null {
  const parentByChild = new Map<string, string>();
  for (const edge of edges) {
    if (parentByChild.has(edge.child_habit_id)) return 'ordinary_depth_exceeded';
    parentByChild.set(edge.child_habit_id, edge.parent_habit_id);
  }
  const nodes = new Set([...parentByChild.keys(), ...parentByChild.values()]);
  for (const node of nodes) {
    const seen = new Set<string>(); let current = node; let depth = 0;
    while (parentByChild.has(current)) {
      if (seen.has(current)) return 'ordinary_cycle';
      seen.add(current); current = parentByChild.get(current)!; depth += 1;
      if (depth > 5) return 'ordinary_depth_exceeded';
    }
  }
  return null;
}

async function loadHabit(database: PlannerSqliteDatabase, id: string): Promise<HabitStateRow | null> { return database.getFirstAsync<HabitStateRow>('SELECT id,lifecycle,active_from,active_to,updated_at FROM habits WHERE id=$id;', { $id: id }); }
function contains(habit: HabitStateRow, date: string): boolean { return habit.active_from <= date && (habit.active_to === null || date < habit.active_to); }
function earliestEnd(left: string | null, right: string | null): PlannerLocalDate | null { const values = [left, right].filter((value): value is string => value !== null).sort(); return (values[0] ?? null) as PlannerLocalDate | null; }
function receipt(input: OrdinaryParentChangeInput, parentHabitId: OrdinaryParentChangeReceipt['parentHabitId'], completionRole: OrdinaryParentChangeReceipt['completionRole'], outcome: OrdinaryParentChangeReceipt['outcome']): OrdinaryParentChangeReceipt { return Object.freeze({ childHabitId: input.childHabitId, parentHabitId, completionRole, outcome, effectiveLocalDate: input.effectiveLocalDate }); }
function ordinaryFailure<T = never>(code: PlannerPersistenceError['code'], message: string): Result<T, PlannerPersistenceError> { return failure(createPlannerPersistenceError(code, message, { operation: 'changeOrdinaryParent' })); }
