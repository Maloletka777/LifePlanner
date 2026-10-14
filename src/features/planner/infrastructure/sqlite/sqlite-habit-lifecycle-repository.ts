import { addPlannerCalendarDays, failure, parsePlannerId, parsePlannerLocalDate, parsePlannerTimezone, resolveHabitLifecycleAsOf, success, type EffectiveRange, type PlannerId, type PlannerLocalDate, type PlannerTimezone, type Result } from '../../domain';
import {
  createPlannerPersistenceError,
  type DeleteHabitInput,
  type DeleteHabitReceipt,
  type DeleteHabitChainImpact,
  type DeleteHabitChainInput,
  type DeleteHabitChainReceipt,
  type DeleteHabitChainTarget,
  type HabitLifecycleTransition,
  type LifecycleWriteInput,
  type LifecycleWriteReceipt,
  type PlannerPersistenceError,
  type PreviewDeleteHabitChainInput,
} from '../../repositories';
import { mapScheduleRow, scheduleDefinitionToParameters } from './planner-row-mappers';
import type { HabitDependencyVersionRow, HabitRow, HabitScheduleVersionRow } from './planner-row-types';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

interface LifecycleRow { readonly id:unknown; readonly habit_id:unknown; readonly sequence_number:unknown; readonly lifecycle:unknown; readonly effective_local_date:unknown; readonly boundary_timezone:unknown; readonly transitioned_at:unknown; readonly created_at:unknown }
interface LiveObservationRow { readonly id:string; readonly habit_id:string; readonly schedule_version_id:string; readonly dependency_version_id:string; readonly occurrence_local_date:string }
interface DeleteChainEdgeRow { readonly id: unknown; readonly parent_habit_id: unknown; readonly child_habit_id: unknown }
interface DeleteChainSnapshot {
  readonly impact: DeleteHabitChainImpact;
  readonly relationVersionIds: readonly PlannerId[];
  readonly unrelatedHabitIds: readonly PlannerId[];
}

export async function archiveHabit(database:PlannerSqliteDatabase,input:LifecycleWriteInput):Promise<Result<LifecycleWriteReceipt,PlannerPersistenceError>> {
  return changeLifecycle(database,input,'archived');
}
export async function restoreHabit(database:PlannerSqliteDatabase,input:LifecycleWriteInput):Promise<Result<LifecycleWriteReceipt,PlannerPersistenceError>> {
  return changeLifecycle(database,input,'active');
}

async function changeLifecycle(database:PlannerSqliteDatabase,input:LifecycleWriteInput,target:'active'|'archived'):Promise<Result<LifecycleWriteReceipt,PlannerPersistenceError>> {
  const habit=await loadHabit(database,input.habitId);
  if (!habit.ok) return habit;
  if (habit.value===null) return lifecycleFailure(target==='archived'?'archive_habit_not_found':'restore_habit_not_found','The habit does not exist.');
  const history=await loadLifecycleHistory(database,input.habitId);
  if (!history.ok) return history;
  const activeRange=mapHabitActiveRange(habit.value);
  if (!activeRange.ok) return activeRange;
  if (habit.value.lifecycle!=='active' && habit.value.lifecycle!=='archived') return lifecycleFailure(target==='archived'?'archive_data_integrity_failure':'restore_data_integrity_failure','The habit lifecycle projection is malformed.');
  const temporal=resolveHabitLifecycleAsOf({activeRange:activeRange.value,aggregateLifecycle:habit.value.lifecycle,asOfLocalDate:input.effectiveLocalDate,transitions:history.value});
  if (!temporal.ok) return lifecycleFailure(target==='archived'?'archive_data_integrity_failure':'restore_data_integrity_failure',temporal.error.message,temporal.error);
  const action=target==='archived'?temporal.value.actionAvailability.archive:temporal.value.actionAvailability.restore;
  if (!action.available) {
    if (target==='archived' && action.unavailableReason==='habit_already_archived') return success(Object.freeze({habitId:input.habitId,requestedEffectiveLocalDate:input.effectiveLocalDate,effectiveLocalDate:temporal.value.nextLifecycleEffectiveLocalDate??input.effectiveLocalDate,state:target,transition:null,affectedDependentCount:0,outcome:'already_archived' as const,suggestedRestoreSchedule:null}));
    if (target==='active' && action.unavailableReason==='habit_not_archived') return success(Object.freeze({habitId:input.habitId,requestedEffectiveLocalDate:input.effectiveLocalDate,effectiveLocalDate:temporal.value.nextLifecycleEffectiveLocalDate??input.effectiveLocalDate,state:target,transition:null,affectedDependentCount:0,outcome:'already_active' as const,suggestedRestoreSchedule:null}));
    return lifecycleFailure('lifecycle_transition_unavailable',`The ${target==='archived'?'Archive':'Restore'} transition is not available on the requested date.`);
  }
  const effectiveLocalDate=action.earliestEffectiveLocalDate;
  if(effectiveLocalDate===null) return lifecycleFailure('lifecycle_transition_unavailable','The lifecycle transition has no valid effective date.');
  const effectiveInput=Object.freeze({...input,effectiveLocalDate});
  if ((habit.value.lifecycle==='active') !== (habit.value.archived_at===null)) return lifecycleFailure(target==='archived'?'archive_data_integrity_failure':'restore_data_integrity_failure','Lifecycle projection and history disagree.');
  if (input.transitionedAt < Number(habit.value.updated_at)) return lifecycleFailure(target==='archived'?'archive_data_integrity_failure':'restore_data_integrity_failure','The lifecycle clock moved backwards.');
  const root=await resolveRootScheduleOptional(database,input.habitId,effectiveLocalDate);
  if (!root.ok) return root;
  if (root.value!==null && root.value.model.definition.evaluationTimezone!==input.boundaryTimezone) return lifecycleFailure(target==='archived'?'archive_data_integrity_failure':'restore_data_integrity_failure','The confirmed lifecycle timezone is stale.');

  let affected=0;
  if (target==='archived') {
    const boundary=addPlannerCalendarDays(effectiveLocalDate,1);
    if(!boundary.ok) return lifecycleFailure('archive_data_integrity_failure','The post-archive boundary is invalid.');
    const future=await database.getFirstAsync<{count:number}>(`SELECT count(*) AS count FROM habit_dependency_versions WHERE (parent_habit_id=$habitId OR dependent_habit_id=$habitId) AND effective_from>$date;`,{$habitId:input.habitId,$date:effectiveLocalDate});
    if(future===null || future.count!==0) return lifecycleFailure('archive_data_integrity_failure','Future dependency state prevents archive.');
    const conversion=await ensureDirectDependents(database,input.habitId,effectiveLocalDate,boundary.value,input.transitionedAt,input.generatedIds.slice(1));
    if(!conversion.ok) return conversion;
    affected=conversion.value;
    await database.runAsync(`UPDATE habit_ordinary_parent_versions SET effective_to=$boundary,end_reason=CASE WHEN parent_habit_id=$habitId THEN 'parent_archived' ELSE 'child_archived' END,updated_at=$now WHERE (parent_habit_id=$habitId OR child_habit_id=$habitId) AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$boundary);`,{$boundary:boundary.value,$now:input.transitionedAt,$habitId:input.habitId,$date:effectiveLocalDate});
    await database.runAsync(`UPDATE habit_dependency_versions SET effective_to=$boundary,end_reason=CASE WHEN parent_habit_id=$habitId THEN 'parent_archived' ELSE 'dependent_archived' END,updated_at=$now WHERE (parent_habit_id=$habitId OR dependent_habit_id=$habitId) AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$boundary);`,{$boundary:boundary.value,$now:input.transitionedAt,$habitId:input.habitId,$date:effectiveLocalDate});
  } else {
    const schedules=await applicableSchedules(database,input.habitId,effectiveLocalDate);
    if(!schedules.ok) return schedules;
    if(schedules.value.length>1) return lifecycleFailure('restore_data_integrity_failure','Restore found ambiguous independent schedules.');
    if(schedules.value.length===0 && input.restoreSchedule===undefined) {
      const suggestion=await suggestedRestoreSchedule(database,input.habitId,effectiveLocalDate,habit.value);
      if(!suggestion.ok) return suggestion;
      return success(Object.freeze({habitId:input.habitId,requestedEffectiveLocalDate:input.effectiveLocalDate,effectiveLocalDate,state:'archived' as const,transition:null,affectedDependentCount:0,outcome:'schedule_required' as const,suggestedRestoreSchedule:suggestion.value}));
    }
    if(schedules.value.length===0 && input.restoreSchedule!==undefined) {
      const inserted=await insertRestoreSchedule(database,effectiveInput,habit.value);
      if(!inserted.ok) return inserted;
    }
    if(input.restorePlannedLocalTime!==undefined) {
      const planned=await writeRestorePlannedTime(database,effectiveInput,habit.value);
      if(!planned.ok) return planned;
    }
  }

  const next=temporal.value.latestSequenceNumber+1;
  const transitionId=input.generatedIds[0];
  if(transitionId===undefined) return lifecycleFailure(target==='archived'?'archive_data_integrity_failure':'restore_data_integrity_failure','A lifecycle transition identifier is missing.');
  await database.runAsync(`INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at) VALUES($id,$habitId,$sequence,$lifecycle,$date,$timezone,$now,$now);`,{$id:transitionId,$habitId:input.habitId,$sequence:next,$lifecycle:target,$date:effectiveLocalDate,$timezone:input.boundaryTimezone,$now:input.transitionedAt});
  await database.runAsync(`UPDATE habits SET lifecycle=$lifecycle,archived_at=$archivedAt,updated_at=$now WHERE id=$habitId;`,{$lifecycle:target,$archivedAt:target==='archived'?input.transitionedAt:null,$now:input.transitionedAt,$habitId:input.habitId});
  const readback=await resolveLifecycle(database,input.habitId,effectiveLocalDate);
  if(!readback.ok || readback.value.lifecycle!==target || readback.value.sequenceNumber!==next) return lifecycleFailure(target==='archived'?'archive_data_integrity_failure':'restore_data_integrity_failure','Lifecycle readback failed.');
  return success(Object.freeze({habitId:input.habitId,requestedEffectiveLocalDate:input.effectiveLocalDate,effectiveLocalDate,state:target,transition:readback.value,affectedDependentCount:affected,outcome:'changed',suggestedRestoreSchedule:null}));
}

export async function permanentlyDeleteHabit(database:PlannerSqliteDatabase,input:DeleteHabitInput):Promise<Result<DeleteHabitReceipt,PlannerPersistenceError>> {
  const habit=await loadHabit(database,input.habitId);
  if(!habit.ok) return habit;
  if(habit.value===null) return lifecycleFailure('delete_habit_not_found','The habit does not exist.');
  const root=await resolveRootScheduleOptional(database,input.habitId,input.effectiveLocalDate);
  if(!root.ok) return root;
  if(root.value!==null && root.value.model.definition.evaluationTimezone!==input.boundaryTimezone) return lifecycleFailure('delete_data_integrity_failure','The confirmed deletion context is stale.');
  const boundary=addPlannerCalendarDays(input.effectiveLocalDate,1);
  if(!boundary.ok) return lifecycleFailure('delete_data_integrity_failure','The post-deletion boundary is invalid.');
  const conversion=await ensureDirectDependents(database,input.habitId,input.effectiveLocalDate,boundary.value,input.transitionedAt,input.generatedIds);
  if(!conversion.ok) return conversion;
  const detached=await detachAffectedObservations(database,input);
  if(!detached.ok) return detached;

  let remaining=await ownedObservationCount(database,input.habitId);
  while(remaining>0) {
    await database.runAsync(`DELETE FROM habit_observations WHERE habit_id=$habitId AND NOT EXISTS(SELECT 1 FROM habit_observations child WHERE child.supersedes_observation_id=habit_observations.id);`,{$habitId:input.habitId});
    const next=await ownedObservationCount(database,input.habitId);
    if(next>=remaining) return lifecycleFailure('delete_data_integrity_failure','Observation correction deletion made no progress.');
    remaining=next;
  }
  await database.runAsync('DELETE FROM habit_observation_schedule_contexts WHERE habit_id=$habitId;',{$habitId:input.habitId});
  // **The projection goes before the reminder it is about**, for the same reason a tick
  // goes before its line: `habit_reminder_schedules` (012) references `habit_reminders`
  // `ON DELETE RESTRICT`, so deleting the reminder first would leave an orphan that the
  // `foreign_key_check` at the foot of this function would find — and an item with a
  // reminder would have become undeletable, which is **exactly** the failure
  // PD-SUBTASK-005 recorded the last time a table arrived after this chain was written.
  // Caught here rather than on a device because that decision said to look.
  await database.runAsync('DELETE FROM habit_reminder_schedules WHERE reminder_id IN (SELECT id FROM habit_reminders WHERE habit_id=$habitId);',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_reminders WHERE habit_id=$habitId;',{$habitId:input.habitId});
  // **The checklist and the closure rule, which nothing here used to remove.**
  //
  // Three tables arrived after this function was written — `habit_checklist_items`
  // (008), `habit_checklist_ticks` (009) and `habit_closure_rules` (011) — and each
  // references its owner `ON DELETE RESTRICT`. So `DELETE FROM habits` was allowed
  // through only because the caller defers foreign keys, and the `foreign_key_check`
  // at the foot of this function then found the orphans and reported *"Permanent
  // deletion verification failed"*: **an item with a subtask could not be deleted at
  // all.** Removing the subtask first did not help either, because a line is retired
  // by a date rather than a delete (PD-SUBTASK-001) — the row, and its foreign key,
  // outlive the removal on purpose.
  //
  // Ticks go before lines, because a tick references the line rather than the habit.
  await database.runAsync('DELETE FROM habit_checklist_ticks WHERE checklist_item_id IN (SELECT id FROM habit_checklist_items WHERE habit_id=$habitId);',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_checklist_items WHERE habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_closure_rules WHERE habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_ordinary_parent_versions WHERE parent_habit_id=$habitId OR child_habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_dependency_versions WHERE parent_habit_id=$habitId OR dependent_habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_schedule_versions WHERE habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_tracking_versions WHERE habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_importance_versions WHERE habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_planned_time_versions WHERE habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_lifecycle_transitions WHERE habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habit_visual_identities WHERE habit_id=$habitId;',{$habitId:input.habitId});
  await database.runAsync('DELETE FROM habits WHERE id=$habitId;',{$habitId:input.habitId});
  const remains=await database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habits WHERE id=$habitId;',{$habitId:input.habitId});
  const fk=await database.getAllAsync<unknown>('PRAGMA foreign_key_check;');
  if(remains?.count!==0 || fk.length!==0) return lifecycleFailure('delete_data_integrity_failure','Permanent deletion verification failed.');
  return success(Object.freeze({deleted:true,affectedDependentCount:conversion.value,detachedObservationCount:detached.value}));
}

export async function previewDeleteHabitChain(
  database: PlannerSqliteDatabase,
  input: PreviewDeleteHabitChainInput,
): Promise<Result<DeleteHabitChainImpact, PlannerPersistenceError>> {
  const snapshot = await loadDeleteHabitChainSnapshot(database, input.rootHabitId, input.asOfLocalDate);
  return snapshot.ok ? success(snapshot.value.impact) : snapshot;
}

export async function deleteHabitChain(
  database: PlannerSqliteDatabase,
  input: DeleteHabitChainInput,
): Promise<Result<DeleteHabitChainReceipt, PlannerPersistenceError>> {
  await database.execAsync('PRAGMA defer_foreign_keys = ON;');
  const snapshot = await loadDeleteHabitChainSnapshot(database, input.habitId, input.effectiveLocalDate);
  if (!snapshot.ok) return snapshot;
  if (!plannerIdListsEqual(snapshot.value.impact.orderedTargetHabitIds, input.expectedOrderedTargetHabitIds)) {
    return lifecycleFailure('delete_routine_stale_confirmation', 'The habit chain changed after the deletion preview.');
  }
  let affectedDependentCount = 0;
  let detachedObservationCount = 0;
  for (let index = 0; index < snapshot.value.impact.targets.length; index += 1) {
    const target = snapshot.value.impact.targets[index];
    const generatedIds = input.generatedIds.slice(index * 32, (index + 1) * 32);
    if (generatedIds.length !== 32) {
      return lifecycleFailure('delete_routine_data_integrity_failure', 'Delete-chain identifiers were exhausted.');
    }
    const deleted = await permanentlyDeleteHabit(database, {
      habitId: target.habitId,
      effectiveLocalDate: input.effectiveLocalDate,
      boundaryTimezone: target.boundaryTimezone ?? input.boundaryTimezone,
      transitionedAt: input.transitionedAt,
      generatedIds,
      confirmed: true,
    });
    if (!deleted.ok) return deleted;
    affectedDependentCount += deleted.value.affectedDependentCount;
    detachedObservationCount += deleted.value.detachedObservationCount;
  }
  const remainingHabits = await database.getAllAsync<{ readonly id: unknown }>('SELECT id FROM habits ORDER BY id;');
  const remainingHabitIds = new Set(remainingHabits.map(({ id }) => String(id)));
  if (snapshot.value.impact.orderedTargetHabitIds.some((id) => remainingHabitIds.has(id))) {
    return lifecycleFailure('delete_routine_data_integrity_failure', 'A selected habit survived delete-chain execution.');
  }
  if (snapshot.value.unrelatedHabitIds.some((id) => !remainingHabitIds.has(id))) {
    return lifecycleFailure('delete_routine_data_integrity_failure', 'Delete-chain execution removed an unrelated habit.');
  }
  const remainingRelationshipIds = new Set((await loadAllRelationshipVersionRows(database)).map(({ id }) => String(id)));
  if (snapshot.value.relationVersionIds.some((id) => remainingRelationshipIds.has(id))) {
    return lifecycleFailure('delete_routine_data_integrity_failure', 'A selected relationship survived delete-chain execution.');
  }
  const foreignKeyFailures = await database.getAllAsync<unknown>('PRAGMA foreign_key_check;');
  if (foreignKeyFailures.length !== 0) {
    return lifecycleFailure('delete_routine_data_integrity_failure', 'Delete-chain execution left a foreign-key violation.');
  }
  return success(Object.freeze({
    deleted: true as const,
    impact: snapshot.value.impact,
    affectedDependentCount,
    detachedObservationCount,
  }));
}

async function loadDeleteHabitChainSnapshot(
  database: PlannerSqliteDatabase,
  rootHabitId: PlannerId,
  asOfLocalDate: PlannerLocalDate,
): Promise<Result<DeleteChainSnapshot, PlannerPersistenceError>> {
  const habitRows = await database.getAllAsync<{ readonly id: unknown; readonly name: unknown }>('SELECT id,name FROM habits ORDER BY name,id;');
  const names = new Map<PlannerId, string>();
  for (const row of habitRows) {
    const id = parsePlannerId(row.id, 'habitId');
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!id.ok || name === '') return lifecycleFailure('delete_routine_data_integrity_failure', 'A delete-chain habit row is malformed.');
    names.set(id.value, name);
  }
  if (!names.has(rootHabitId)) return lifecycleFailure('delete_habit_not_found', 'The habit does not exist.');
  const ordinaryEdges = await database.getAllAsync<DeleteChainEdgeRow>(
    `SELECT id,parent_habit_id,child_habit_id FROM habit_ordinary_parent_versions
     WHERE effective_from<=$date AND (effective_to IS NULL OR effective_to>$date) ORDER BY id;`,
    { $date: asOfLocalDate },
  );
  const conditionalEdges = await database.getAllAsync<DeleteChainEdgeRow>(
    `SELECT id,parent_habit_id,dependent_habit_id AS child_habit_id FROM habit_dependency_versions
     WHERE effective_from<=$date AND (effective_to IS NULL OR effective_to>$date) ORDER BY id;`,
    { $date: asOfLocalDate },
  );
  const adjacency = new Map<PlannerId, PlannerId[]>();
  for (const row of [...ordinaryEdges, ...conditionalEdges]) {
    const parent = parsePlannerId(row.parent_habit_id, 'parentHabitId');
    const child = parsePlannerId(row.child_habit_id, 'childHabitId');
    if (!parent.ok || !child.ok || !names.has(parent.value) || !names.has(child.value)) {
      return lifecycleFailure('delete_routine_data_integrity_failure', 'A delete-chain relationship is malformed.');
    }
    const children = adjacency.get(parent.value) ?? [];
    if (!children.includes(child.value)) children.push(child.value);
    adjacency.set(parent.value, children);
  }
  const compareHabitIds = (left: PlannerId, right: PlannerId) =>
    names.get(left)!.localeCompare(names.get(right)!) || left.localeCompare(right);
  for (const children of adjacency.values()) children.sort(compareHabitIds);
  const depths = new Map<PlannerId, number>([[rootHabitId, 0]]);
  const validatePath = (habitId: PlannerId, depth: number, path: ReadonlySet<PlannerId>): Result<true, PlannerPersistenceError> => {
    if (depth > 5) return lifecycleFailure('delete_routine_data_integrity_failure', 'The descendant chain exceeds the approved depth.');
    const previousDepth = depths.get(habitId) ?? 0;
    depths.set(habitId, Math.max(previousDepth, depth));
    const nextPath = new Set(path);
    nextPath.add(habitId);
    for (const childId of adjacency.get(habitId) ?? []) {
      if (nextPath.has(childId)) return lifecycleFailure('delete_routine_data_integrity_failure', 'The descendant chain contains a cycle.');
      const validated = validatePath(childId, depth + 1, nextPath);
      if (!validated.ok) return validated;
    }
    return success(true);
  };
  const validated = validatePath(rootHabitId, 0, new Set());
  if (!validated.ok) return validated;
  const orderedTargetHabitIds: PlannerId[] = [];
  const visited = new Set<PlannerId>();
  const appendPostorder = (habitId: PlannerId) => {
    if (visited.has(habitId)) return;
    visited.add(habitId);
    for (const childId of adjacency.get(habitId) ?? []) appendPostorder(childId);
    orderedTargetHabitIds.push(habitId);
  };
  appendPostorder(rootHabitId);
  const targetSet = new Set(orderedTargetHabitIds);
  const targets: DeleteHabitChainTarget[] = [];
  for (const habitId of orderedTargetHabitIds) {
    const timezone = await deletionBoundaryTimezone(database, habitId, asOfLocalDate);
    if (!timezone.ok) return timezone;
    targets.push(Object.freeze({ habitId, name: names.get(habitId)!, depth: depths.get(habitId) ?? 0, boundaryTimezone: timezone.value }));
  }
  const allRelationshipRows = await loadAllRelationshipVersionRows(database);
  const selectedRelationshipIds: PlannerId[] = [];
  for (const row of allRelationshipRows) {
    const relationshipId = parsePlannerId(row.id, 'relationshipVersionId');
    const parentId = parsePlannerId(row.parent_habit_id, 'parentHabitId');
    const childId = parsePlannerId(row.child_habit_id, 'childHabitId');
    if (!relationshipId.ok || !parentId.ok || !childId.ok) {
      return lifecycleFailure('delete_routine_data_integrity_failure', 'A delete-chain relationship history row is malformed.');
    }
    if (targetSet.has(parentId.value) || targetSet.has(childId.value)) selectedRelationshipIds.push(relationshipId.value);
  }
  const observationRows = await database.getAllAsync<{ readonly habit_id: unknown; readonly supersedes_observation_id: unknown }>('SELECT habit_id,supersedes_observation_id FROM habit_observations;');
  const selectedObservations = observationRows.filter((row) => targetSet.has(String(row.habit_id) as PlannerId));
  const visualRows = await database.getAllAsync<{ readonly habit_id: unknown }>('SELECT habit_id FROM habit_visual_identities;');
  const unrelatedHabitIds = [...names.keys()].filter((id) => !targetSet.has(id)).sort();
  const impact = Object.freeze({
    rootHabitId,
    rootHabitName: names.get(rootHabitId)!,
    orderedTargetHabitIds: Object.freeze(orderedTargetHabitIds),
    targets: Object.freeze(targets),
    targetCount: orderedTargetHabitIds.length,
    relationshipCount: selectedRelationshipIds.length,
    observationCount: selectedObservations.length,
    correctionCount: selectedObservations.filter((row) => row.supersedes_observation_id !== null).length,
    visualIdentityCount: visualRows.filter((row) => targetSet.has(String(row.habit_id) as PlannerId)).length,
    unrelatedPreservedCount: unrelatedHabitIds.length,
  });
  if (![impact.targetCount, impact.relationshipCount, impact.observationCount, impact.correctionCount, impact.visualIdentityCount, impact.unrelatedPreservedCount].every(Number.isSafeInteger)) {
    return lifecycleFailure('delete_routine_data_integrity_failure', 'Delete-chain impact counts are malformed.');
  }
  return success(Object.freeze({
    impact,
    relationVersionIds: Object.freeze(selectedRelationshipIds),
    unrelatedHabitIds: Object.freeze(unrelatedHabitIds),
  }));
}

async function loadAllRelationshipVersionRows(database: PlannerSqliteDatabase): Promise<readonly DeleteChainEdgeRow[]> {
  const ordinary = await database.getAllAsync<DeleteChainEdgeRow>('SELECT id,parent_habit_id,child_habit_id FROM habit_ordinary_parent_versions;');
  const conditional = await database.getAllAsync<DeleteChainEdgeRow>('SELECT id,parent_habit_id,dependent_habit_id AS child_habit_id FROM habit_dependency_versions;');
  return Object.freeze([...ordinary, ...conditional]);
}

function plannerIdListsEqual(left: readonly PlannerId[], right: readonly PlannerId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

async function deletionBoundaryTimezone(
  database: PlannerSqliteDatabase,
  habitId: PlannerId,
  asOfLocalDate: PlannerLocalDate,
): Promise<Result<PlannerTimezone | null, PlannerPersistenceError>> {
  const schedule = await resolveRootScheduleOptional(database, habitId, asOfLocalDate);
  if (!schedule.ok) return schedule;
  return success(schedule.value?.model.definition.evaluationTimezone ?? null);
}

async function detachAffectedObservations(database:PlannerSqliteDatabase,input:DeleteHabitInput):Promise<Result<number,PlannerPersistenceError>> {
  const observations=await database.getAllAsync<LiveObservationRow>(`SELECT id,habit_id,schedule_version_id,dependency_version_id,occurrence_local_date FROM habit_observations WHERE context_mode='live_dependent' AND habit_id<>$habitId ORDER BY id;`,{$habitId:input.habitId});
  let count=0;
  for(const observation of observations) {
    const ancestry=await ancestryContains(database,observation.habit_id,observation.occurrence_local_date,input.habitId);
    if(!ancestry.ok) return ancestry;
    if(!ancestry.value) continue;
    const schedule=await database.getFirstAsync<HabitScheduleVersionRow>('SELECT * FROM habit_schedule_versions WHERE id=$id;',{$id:observation.schedule_version_id});
    const dependency=await database.getFirstAsync<HabitDependencyVersionRow>('SELECT * FROM habit_dependency_versions WHERE id=$id;',{$id:observation.dependency_version_id});
    if(schedule===null || dependency===null || dependency.dependent_habit_id!==observation.habit_id) return lifecycleFailure('delete_observation_detachment_failure','A surviving observation context is inconsistent.');
    const mapped=mapScheduleRow(schedule); if(!mapped.ok) return lifecycleFailure('delete_observation_detachment_failure','A surviving schedule context is malformed.');
    const p=scheduleDefinitionToParameters(mapped.value.model.definition);
    await database.runAsync(`INSERT INTO habit_observation_schedule_contexts(id,habit_id,schedule_type,schedule_effective_from,schedule_effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,dependency_type,occurrence_mode,dependency_effective_from,dependency_effective_to,detachment_reason,detached_at,created_at) VALUES($id,$habitId,$scheduleType,$effectiveFrom,$effectiveTo,$evaluationTimezone,$intervalDays,$weekdaysMask,$weekday,$periodTargetCount,$anchorDate,$monthDay,$monthNumber,$weekStart,$dependencyType,'inherited_parent',$dependencyFrom,$dependencyTo,'parent_deleted',$now,$now);`,{...p,$id:observation.id,$habitId:observation.habit_id,$dependencyType:String(dependency.dependency_type),$dependencyFrom:String(dependency.effective_from),$dependencyTo:dependency.effective_to as string|null,$now:input.transitionedAt});
    await database.runAsync(`UPDATE habit_observations SET context_mode='detached_dependent',schedule_version_id=NULL,dependency_version_id=NULL,detached_schedule_context_id=id WHERE id=$id;`,{$id:observation.id});
    count+=1;
  }
  return success(count);
}

async function ancestryContains(database:PlannerSqliteDatabase,start:string,date:string,target:PlannerId):Promise<Result<boolean,PlannerPersistenceError>> {
  let current=start; const seen=new Set<string>();
  for(let depth=0;depth<=5;depth+=1) {
    if(seen.has(current)) return lifecycleFailure('delete_observation_detachment_failure','Dependency ancestry is cyclic.'); seen.add(current);
    const rows=await database.getAllAsync<{parent_habit_id:string}>(`SELECT parent_habit_id FROM habit_dependency_versions WHERE dependent_habit_id=$id AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$date);`,{$id:current,$date:date});
    if(rows.length>1) return lifecycleFailure('delete_observation_detachment_failure','Dependency ancestry is ambiguous.');
    if(rows.length===0) return success(false);
    current=rows[0].parent_habit_id;
    if(current===target) return success(true);
  }
  return lifecycleFailure('delete_observation_detachment_failure','Dependency ancestry exceeds the approved depth.');
}

async function ensureDirectDependents(database:PlannerSqliteDatabase,parent:PlannerId,actionDate:PlannerLocalDate,boundary:PlannerLocalDate,now:number,ids:readonly PlannerId[]):Promise<Result<number,PlannerPersistenceError>> {
  const relations=await database.getAllAsync<{dependent_habit_id:string;effective_from:string;effective_to:string|null}>(`SELECT dependent_habit_id,effective_from,effective_to FROM habit_dependency_versions WHERE parent_habit_id=$parent ORDER BY dependent_habit_id,effective_from,version_number,id;`,{$parent:parent});
  const byDependent=new Map<string,{dependent_habit_id:string;effective_from:string;effective_to:string|null}[]>();
  for(const relation of relations){const current=byDependent.get(relation.dependent_habit_id)??[];current.push(relation);byDependent.set(relation.dependent_habit_id,current);}
  let idIndex=0; let affected=0;
  for(const [dependentId,history] of [...byDependent].sort(([left],[right])=>left.localeCompare(right))) {
    const parsed=parsePlannerId(dependentId); if(!parsed.ok) return lifecycleFailure('delete_dependent_conversion_failure','A dependent identifier is malformed.');
    const habit=await loadHabit(database,parsed.value); if(!habit.ok || habit.value===null) return lifecycleFailure('delete_dependent_conversion_failure','A dependent habit is missing.');
    if(habit.value.lifecycle!=='active' || String(habit.value.active_from)>boundary || (habit.value.active_to!==null && String(habit.value.active_to)<=boundary)) continue;
    const otherIncoming=await database.getAllAsync<{parent_habit_id:string}>(`SELECT parent_habit_id FROM habit_dependency_versions WHERE dependent_habit_id=$habitId AND parent_habit_id<>$parent AND effective_from<=$boundary AND (effective_to IS NULL OR effective_to>$boundary);`,{$habitId:parsed.value,$parent:parent,$boundary:boundary});
    if(otherIncoming.length>1) return lifecycleFailure('delete_dependent_conversion_failure','A surviving dependent has ambiguous current parentage.');
    if(otherIncoming.length===1) { affected+=1; continue; }
    const existing=await applicableSchedules(database,parsed.value,boundary); if(!existing.ok) return existing;
    if(existing.value.length>1) return lifecycleFailure('delete_dependent_conversion_failure','A dependent schedule is ambiguous.');
    if(existing.value.length===0) {
      const active=history.find((relation)=>relation.effective_from<=actionDate&&(relation.effective_to===null||relation.effective_to>actionDate));
      const past=[...history].filter((relation)=>relation.effective_from<=actionDate).sort((left,right)=>(right.effective_to??'9999-12-31').localeCompare(left.effective_to??'9999-12-31')||right.effective_from.localeCompare(left.effective_from))[0];
      const futureRelationship=[...history].filter((relation)=>relation.effective_from>actionDate).sort((left,right)=>left.effective_from.localeCompare(right.effective_from))[0];
      const source=active??past??futureRelationship;
      if(source===undefined) return lifecycleFailure('delete_dependent_conversion_failure','A surviving dependent has no retained relationship context.');
      const sourceDate=parsePlannerLocalDate(source.effective_from); if(!sourceDate.ok) return lifecycleFailure('delete_dependent_conversion_failure','A retained relationship boundary is malformed.');
      const root=await resolveRootSchedule(database,parent,active===undefined?sourceDate.value:actionDate); if(!root.ok) return lifecycleFailure('delete_dependent_conversion_failure','A safe independent schedule could not be recovered for a surviving child.',root.error);
      const futureSchedule=await database.getFirstAsync<{date:string|null;version:number}>(`SELECT min(effective_from) AS date,(SELECT coalesce(max(version_number),0) FROM habit_schedule_versions WHERE habit_id=$habitId) AS version FROM habit_schedule_versions WHERE habit_id=$habitId AND effective_from>$boundary;`,{$habitId:parsed.value,$boundary:boundary});
      const rawEnd=futureSchedule?.date ?? (habit.value.active_to as string|null);
      const parsedEnd=rawEnd===null ? null : parsePlannerLocalDate(rawEnd);
      if(parsedEnd!==null && !parsedEnd.ok) return lifecycleFailure('delete_dependent_conversion_failure','A dependent schedule boundary is malformed.');
      const end=parsedEnd===null ? null : parsedEnd.value;
      const id=ids[idIndex++]; if(id===undefined) return lifecycleFailure('delete_dependent_conversion_failure','Dependent schedule identifiers were exhausted.');
      const definition=Object.freeze({...root.value.model.definition,effectiveRange:Object.freeze({effectiveFrom:boundary,effectiveTo:end})});
      const p=scheduleDefinitionToParameters(definition);
      await database.runAsync(`INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at) VALUES($id,$habitId,$version,$scheduleType,$effectiveFrom,$effectiveTo,$evaluationTimezone,$intervalDays,$weekdaysMask,$weekday,$periodTargetCount,$anchorDate,$monthDay,$monthNumber,$weekStart,$now,$now);`,{...p,$id:id,$habitId:parsed.value,$version:(futureSchedule?.version??0)+1,$now:now});
    }
    affected+=1;
  }
  return success(affected);
}

async function suggestedRestoreSchedule(database:PlannerSqliteDatabase,habitId:PlannerId,date:PlannerLocalDate,habit:HabitRow) {
  const row=await database.getFirstAsync<HabitScheduleVersionRow>(`SELECT * FROM habit_schedule_versions WHERE habit_id=$habitId ORDER BY CASE WHEN effective_from<$date THEN 0 ELSE 1 END,CASE WHEN effective_from<$date THEN effective_from END DESC,CASE WHEN effective_from>=$date THEN effective_from END ASC,version_number DESC,id DESC LIMIT 1;`,{$habitId:habitId,$date:date});
  if(row===null) return success(null);
  const mapped=mapScheduleRow(row);
  if(!mapped.ok) return lifecycleFailure('restore_data_integrity_failure','The previous schedule is malformed.');
  const end=await nextConfigurationBoundary(database,'habit_schedule_versions',habitId,date,habit.active_to);
  if(!end.ok) return end;
  return success(Object.freeze({...mapped.value.model.definition,effectiveRange:Object.freeze({effectiveFrom:date,effectiveTo:end.value})}));
}

async function insertRestoreSchedule(database:PlannerSqliteDatabase,input:LifecycleWriteInput,habit:HabitRow):Promise<Result<null,PlannerPersistenceError>> {
  const schedule=input.restoreSchedule;
  if(schedule===undefined) return lifecycleFailure('restore_schedule_required','Choose a schedule before restoring.');
  const end=await nextConfigurationBoundary(database,'habit_schedule_versions',input.habitId,input.effectiveLocalDate,habit.active_to);
  if(!end.ok) return end;
  const normalizedSchedule=Object.freeze({...schedule,effectiveRange:Object.freeze({effectiveFrom:input.effectiveLocalDate,effectiveTo:end.value})});
  const version=await database.getFirstAsync<{value:number}>('SELECT coalesce(max(version_number),0)+1 AS value FROM habit_schedule_versions WHERE habit_id=$habitId;',{$habitId:input.habitId});
  const id=input.generatedIds[1];
  if(id===undefined || version===null || !Number.isSafeInteger(version.value)) return lifecycleFailure('restore_data_integrity_failure','The restore schedule could not be versioned safely.');
  const parameters=scheduleDefinitionToParameters(normalizedSchedule);
  await database.runAsync(`INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at) VALUES($id,$habitId,$version,$scheduleType,$effectiveFrom,$effectiveTo,$evaluationTimezone,$intervalDays,$weekdaysMask,$weekday,$periodTargetCount,$anchorDate,$monthDay,$monthNumber,$weekStart,$now,$now);`,{...parameters,$id:id,$habitId:input.habitId,$version:version.value,$now:input.transitionedAt});
  return success(null);
}

async function writeRestorePlannedTime(database:PlannerSqliteDatabase,input:LifecycleWriteInput,habit:HabitRow):Promise<Result<null,PlannerPersistenceError>> {
  const rows=await database.getAllAsync<{id:string;version_number:number;effective_from:string;planned_local_time:string|null;planned_duration_minutes:number|null}>(`SELECT id,version_number,effective_from,planned_local_time,planned_duration_minutes FROM habit_planned_time_versions WHERE habit_id=$habitId AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$date) ORDER BY version_number,id;`,{$habitId:input.habitId,$date:input.effectiveLocalDate});
  if(rows.length>1) return lifecycleFailure('restore_data_integrity_failure','Restore found ambiguous planned-time history.');
  const value=input.restorePlannedLocalTime ?? null;
  if(rows.length===1 && rows[0].planned_local_time===value) return success(null);
  if(rows.length===1 && rows[0].effective_from===input.effectiveLocalDate) {
    await database.runAsync('UPDATE habit_planned_time_versions SET planned_local_time=$time,updated_at=$now WHERE id=$id;',{$time:value,$now:input.transitionedAt,$id:rows[0].id});
    return success(null);
  }
  if(rows.length===1) await database.runAsync('UPDATE habit_planned_time_versions SET effective_to=$date,updated_at=$now WHERE id=$id;',{$date:input.effectiveLocalDate,$now:input.transitionedAt,$id:rows[0].id});
  const end=await nextConfigurationBoundary(database,'habit_planned_time_versions',input.habitId,input.effectiveLocalDate,habit.active_to);
  if(!end.ok) return end;
  const version=await database.getFirstAsync<{value:number}>('SELECT coalesce(max(version_number),0)+1 AS value FROM habit_planned_time_versions WHERE habit_id=$habitId;',{$habitId:input.habitId});
  const id=input.generatedIds[2];
  if(id===undefined || version===null || !Number.isSafeInteger(version.value)) return lifecycleFailure('restore_data_integrity_failure','The restore planned time could not be versioned safely.');
  /**
   * **The length is carried forward, not dropped.**
   *
   * Restoring says when the habit runs again; it says nothing about how long it takes,
   * and the version this opens replaces the one that held it. Writing NULL here would
   * lose a stored duration silently on every restore — the archived habit would come
   * back a different shape from the one that was archived.
   */
  const carriedDuration=rows.length===1 ? rows[0].planned_duration_minutes ?? null : null;
  await database.runAsync('INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes) VALUES($id,$habitId,$version,$date,$end,$time,$now,$now,$duration);',{$id:id,$habitId:input.habitId,$version:version.value,$date:input.effectiveLocalDate,$end:end.value,$time:value,$duration:carriedDuration,$now:input.transitionedAt});
  return success(null);
}

async function nextConfigurationBoundary(database:PlannerSqliteDatabase,table:'habit_schedule_versions'|'habit_planned_time_versions',habitId:PlannerId,date:PlannerLocalDate,rawActiveTo:unknown):Promise<Result<PlannerLocalDate|null,PlannerPersistenceError>> {
  const row=await database.getFirstAsync<{date:string|null}>(`SELECT min(effective_from) AS date FROM ${table} WHERE habit_id=$habitId AND effective_from>$date;`,{$habitId:habitId,$date:date});
  const raw=row?.date ?? rawActiveTo;
  if(raw===null) return success(null);
  const parsed=parsePlannerLocalDate(raw);
  return parsed.ok ? success(parsed.value) : lifecycleFailure('restore_data_integrity_failure','A retained configuration boundary is malformed.');
}

async function resolveRootScheduleOptional(database:PlannerSqliteDatabase,habitId:PlannerId,date:PlannerLocalDate) {
  let current=habitId; const seen=new Set<string>();
  for(let depth=0;depth<=5;depth+=1) {
    if(seen.has(current)) return lifecycleFailure('data_integrity_failure','Dependency ancestry is cyclic.'); seen.add(current);
    const incoming=await database.getAllAsync<{parent_habit_id:string}>(`SELECT parent_habit_id FROM habit_dependency_versions WHERE dependent_habit_id=$id AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$date);`,{$id:current,$date:date});
    if(incoming.length>1) return lifecycleFailure('data_integrity_failure','Dependency ancestry is ambiguous.');
    if(incoming.length===0) break;
    const parsed=parsePlannerId(incoming[0].parent_habit_id); if(!parsed.ok) return lifecycleFailure('data_integrity_failure','Dependency ancestry is malformed.'); current=parsed.value;
    if(depth===5) return lifecycleFailure('data_integrity_failure','Dependency ancestry exceeds the approved depth.');
  }
  const schedules=await applicableSchedules(database,current,date); if(!schedules.ok) return schedules;
  if(schedules.value.length>1) return lifecycleFailure('data_integrity_failure','The root schedule is ambiguous.');
  return success(schedules.value[0]??null);
}

export async function resolveRootSchedule(database:PlannerSqliteDatabase,habitId:PlannerId,date:PlannerLocalDate) {
  const resolved=await resolveRootScheduleOptional(database,habitId,date);
  if(!resolved.ok) return resolved;
  return resolved.value===null ? lifecycleFailure('data_integrity_failure','One root schedule could not be resolved.') : success(resolved.value);
}

async function applicableSchedules(database:PlannerSqliteDatabase,habitId:PlannerId,date:PlannerLocalDate) {
  const rows=await database.getAllAsync<HabitScheduleVersionRow>(`SELECT * FROM habit_schedule_versions WHERE habit_id=$habitId AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$date) ORDER BY version_number,id;`,{$habitId:habitId,$date:date});
  const values=[]; for(const row of rows){const mapped=mapScheduleRow(row);if(!mapped.ok)return lifecycleFailure('data_integrity_failure','A schedule row is malformed.');values.push(mapped.value);} return success(values);
}

async function resolveLifecycle(database:PlannerSqliteDatabase,habitId:PlannerId,date:PlannerLocalDate):Promise<Result<HabitLifecycleTransition,PlannerPersistenceError>> {
  const row=await database.getFirstAsync<LifecycleRow>(`SELECT * FROM habit_lifecycle_transitions WHERE habit_id=$habitId AND effective_local_date<=$date ORDER BY effective_local_date DESC,sequence_number DESC LIMIT 1;`,{$habitId:habitId,$date:date});
  if(row===null) return lifecycleFailure('data_integrity_failure','Lifecycle history is missing.');
  return mapLifecycleRow(row,habitId);
}

async function loadLifecycleHistory(database:PlannerSqliteDatabase,habitId:PlannerId):Promise<Result<readonly HabitLifecycleTransition[],PlannerPersistenceError>> {
  const rows=await database.getAllAsync<LifecycleRow>('SELECT * FROM habit_lifecycle_transitions WHERE habit_id=$habitId ORDER BY sequence_number;',{$habitId:habitId});
  if(rows.length===0) return lifecycleFailure('data_integrity_failure','Lifecycle history is missing.');
  const transitions:HabitLifecycleTransition[]=[];
  for(const row of rows){const mapped=mapLifecycleRow(row,habitId);if(!mapped.ok)return mapped;transitions.push(mapped.value);}
  return success(Object.freeze(transitions));
}

function mapLifecycleRow(row:LifecycleRow,expectedHabitId:PlannerId):Result<HabitLifecycleTransition,PlannerPersistenceError> {
  const id=parsePlannerId(row.id); const owner=parsePlannerId(row.habit_id); const effective=parsePlannerLocalDate(row.effective_local_date); const timezone=parsePlannerTimezone(row.boundary_timezone);
  if(!id.ok||!owner.ok||owner.value!==expectedHabitId||!effective.ok||!timezone.ok||(row.lifecycle!=='active'&&row.lifecycle!=='archived')||!Number.isSafeInteger(row.sequence_number)||Number(row.sequence_number)<1||!Number.isSafeInteger(row.transitioned_at)||!Number.isSafeInteger(row.created_at)) return lifecycleFailure('data_integrity_failure','Lifecycle history is malformed.');
  return success(Object.freeze({id:id.value,habitId:owner.value,sequenceNumber:Number(row.sequence_number),lifecycle:row.lifecycle,effectiveLocalDate:effective.value,boundaryTimezone:timezone.value,transitionedAt:Number(row.transitioned_at),createdAt:Number(row.created_at)}));
}

function mapHabitActiveRange(habit:HabitRow):Result<EffectiveRange,PlannerPersistenceError> {
  const activeFrom=parsePlannerLocalDate(habit.active_from,'habit.activeFrom');
  const activeTo=habit.active_to===null?success(null):parsePlannerLocalDate(habit.active_to,'habit.activeTo');
  if(!activeFrom.ok||!activeTo.ok||(activeTo.value!==null&&activeTo.value<=activeFrom.value)) return lifecycleFailure('data_integrity_failure','The habit active range is malformed.');
  return success(Object.freeze({effectiveFrom:activeFrom.value,effectiveTo:activeTo.value}));
}

async function loadHabit(database:PlannerSqliteDatabase,habitId:PlannerId):Promise<Result<HabitRow|null,PlannerPersistenceError>> { try{return success(await database.getFirstAsync<HabitRow>('SELECT * FROM habits WHERE id=$habitId;',{$habitId:habitId}));}catch(cause:unknown){return lifecycleFailure('database_failure','The habit lifecycle could not be read.',cause);} }
async function ownedObservationCount(database:PlannerSqliteDatabase,habitId:PlannerId){const row=await database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habit_observations WHERE habit_id=$habitId;',{$habitId:habitId});return row?.count??-1;}
function lifecycleFailure<T=never>(code:PlannerPersistenceError['code'],message:string,cause?:unknown):Result<T,PlannerPersistenceError>{return failure(createPlannerPersistenceError(code,message,{operation:'habitLifecycle',...(cause===undefined?{}:{cause})}));}
