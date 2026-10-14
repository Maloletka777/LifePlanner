import {
  habitIconIdentitiesEqual,
  failure,
  getImportanceWeight,
  success,
  type EffectiveRange,
  type PlannerLocalDate,
  type Result,
  type ScheduleDefinition,
  type TrackingDefinition,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type EditHabitPersistenceInput,
  type EditHabitReceipt,
  type PlannerPersistenceError,
} from '../../repositories';
import {
  mapImportanceRow,
  mapScheduleRow,
  mapTrackingRow,
  mapHabitVisualIdentityRow,
  habitVisualIdentityToParameters,
  scheduleDefinitionToParameters,
  trackingDefinitionToParameters,
} from './planner-row-mappers';
import type {
  HabitImportanceVersionRow,
  HabitRow,
  HabitScheduleVersionRow,
  HabitTrackingVersionRow,
  HabitVisualIdentityRow,
} from './planner-row-types';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

type Family = 'schedule' | 'tracking' | 'importance' | 'planned_time';
interface PlannedTimeRow { readonly id: string; readonly version_number: number; readonly effective_from: string; readonly effective_to: string | null; readonly planned_local_time: string | null; readonly planned_duration_minutes: number | null; readonly planned_block: string | null }

export async function editHabit(
  database: PlannerSqliteDatabase,
  input: EditHabitPersistenceInput,
): Promise<Result<EditHabitReceipt, PlannerPersistenceError>> {
  const habit = await database.getFirstAsync<HabitRow>('SELECT * FROM habits WHERE id=$habitId;', { $habitId: input.habitId });
  if (habit === null) return editFailure('edit_habit_not_found', 'The habit no longer exists.');
  if (habit.lifecycle !== 'active') return editFailure('edit_habit_archived', 'Restore the habit before editing it.');
  if (input.effectiveLocalDate < input.currentLocalDate) return editFailure('edit_past_effective_date', 'Habit changes cannot begin in the past.');
  if (!Number.isSafeInteger(habit.updated_at) || input.updatedAt < Number(habit.updated_at)) return editFailure('edit_stale_conflict', 'The habit changed before this draft could be saved.');

  const [scheduleRow, trackingRow, importanceRow, plannedTimeRow, visualIdentityRow] = await Promise.all([
    applicableVersion<HabitScheduleVersionRow>(database, 'habit_schedule_versions', input.habitId, input.currentLocalDate),
    applicableVersion<HabitTrackingVersionRow>(database, 'habit_tracking_versions', input.habitId, input.currentLocalDate),
    applicableVersion<HabitImportanceVersionRow>(database, 'habit_importance_versions', input.habitId, input.currentLocalDate),
    applicableVersion<PlannedTimeRow>(database, 'habit_planned_time_versions', input.habitId, input.currentLocalDate),
    database.getFirstAsync<HabitVisualIdentityRow>('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: input.habitId }),
  ]);
  // The live reminder, read the way the catalogue reads it: active, enabled, earliest
  // first — so the row this compares against is the row the interface showed.
  const reminderRow = await database.getFirstAsync<{ id: string; trigger_local_time: string }>(
    `SELECT id, trigger_local_time FROM habit_reminders
     WHERE habit_id=$habitId AND lifecycle='active' AND enabled=1
     ORDER BY trigger_local_time LIMIT 1;`,
    { $habitId: input.habitId },
  );
  if (scheduleRow === null || trackingRow === null || importanceRow === null || plannedTimeRow === null || visualIdentityRow === null) return editFailure('edit_data_integrity_failure', 'Current habit configuration or visual identity is missing or ambiguous.');
  const schedule = mapScheduleRow(scheduleRow);
  const tracking = mapTrackingRow(trackingRow);
  const importance = mapImportanceRow(importanceRow);
  const visualIdentity = mapHabitVisualIdentityRow(visualIdentityRow);
  if (!schedule.ok || !tracking.ok || !importance.ok || !visualIdentity.ok || visualIdentity.value.habitId !== input.habitId) return editFailure('edit_data_integrity_failure', 'Current habit configuration or visual identity is malformed.');

  const changedFamilies: ('identity' | 'visual_identity' | 'reminder' | Family)[] = [];
  if (String(habit.name) !== input.name || (habit.description as string | null) !== input.description) changedFamilies.push('identity');
  if (!sameParameters(scheduleDefinitionToParameters(schedule.value.model.definition), scheduleDefinitionToParameters(input.schedule), ['$effectiveFrom', '$effectiveTo'])) changedFamilies.push('schedule');
  if (!sameParameters(trackingDefinitionToParameters(tracking.value.model.definition), trackingDefinitionToParameters(input.tracking), ['$effectiveFrom', '$effectiveTo'])) changedFamilies.push('tracking');
  if (importance.value.model.importance !== input.importance) changedFamilies.push('importance');
  // **Both halves of «when» count as a change to it.** Comparing the minute alone meant
  // an edit that only re-cut the day — 07:00 for thirty minutes becoming 07:00 for an
  // hour — reported nothing changed and appended no version, so the new length was
  // silently dropped. The length is the same family and is compared with it.
  if (
    plannedTimeRow.planned_local_time !== input.plannedLocalTime ||
    (plannedTimeRow.planned_duration_minutes ?? null) !== (input.plannedDurationMinutes ?? null) ||
    // All three halves of «when», for the same reason: moving a thing from the
    // morning to the evening and changing nothing else is a change to when it is.
    (plannedTimeRow.planned_block ?? null) !== (input.plannedBlock ?? null)
  ) changedFamilies.push('planned_time');
  if (input.visualIdentity !== null && (!habitIconIdentitiesEqual(visualIdentity.value.iconIdentity, input.visualIdentity.iconIdentity) || visualIdentity.value.persistedAccentKey !== input.visualIdentity.persistedAccentKey)) changedFamilies.push('visual_identity');
  if ((reminderRow?.trigger_local_time ?? null) !== input.reminderLocalTime) changedFamilies.push('reminder');

  if (changedFamilies.length === 0) {
    return success(Object.freeze({ habitId: input.habitId, outcome: 'no_change', changedFamilies: Object.freeze([]), effectiveLocalDate: input.effectiveLocalDate }));
  }

  const configFamilies = changedFamilies.filter((family): family is Family => family !== 'identity' && family !== 'visual_identity' && family !== 'reminder');
  if (configFamilies.length > 0) {
    if (input.effectiveLocalDate === input.currentLocalDate) {
      const eligibility = await validateSameDayEligibility(database, input, { schedule: scheduleRow, tracking: trackingRow, importance: importanceRow, planned_time: plannedTimeRow }, configFamilies);
      if (!eligibility.ok) return eligibility;
      for (const family of configFamilies) await replaceSameDayFamily(database, input, family, { schedule: scheduleRow, tracking: trackingRow, importance: importanceRow, planned_time: plannedTimeRow });
    } else {
      const conflict = await findFutureConflict(database, input, configFamilies);
      if (conflict !== null) return editFailure('edit_future_version_conflict', `A ${familyWord(conflict)} change is already planned for a later date.`);
      let idIndex = 0;
      for (const family of configFamilies) {
        const generatedId = input.generatedIds[idIndex++];
        if (generatedId === undefined) return editFailure('edit_data_integrity_failure', 'A configuration version identifier is missing.');
        const appended = await appendFutureFamily(database, input, family, generatedId, habit.active_to as string | null);
        if (!appended.ok) return appended;
      }
    }
  }

  if (changedFamilies.includes('visual_identity') && input.visualIdentity !== null) {
    await database.runAsync(
      'UPDATE habit_visual_identities SET icon_kind=$iconKind,symbol_key=$symbolKey,emoji_value=$emojiValue,accent_key=$accentKey,updated_at=$updatedAt WHERE habit_id=$habitId;',
      { ...habitVisualIdentityToParameters(input.visualIdentity), $updatedAt: input.updatedAt, $habitId: input.habitId },
    );
  }

  /**
   * The reminder, applied in place beside the visual identity rather than as a version.
   *
   * **Removing one deletes the row rather than archiving it**, and that is load-bearing:
   * the catalogue only ever exposes an *active* reminder, so an archived row would be
   * invisible to the reconciliation — and the notifications it had already put in the
   * operating system would never be cancelled. Deleting makes them orphans instead, and
   * the reconciliation's orphan rule cancels an orphan by construction.
   *
   * The projection goes first, for the reason the delete chain learned the hard way: it
   * references the reminder `ON DELETE RESTRICT`.
   */
  if (changedFamilies.includes('reminder')) {
    if (reminderRow !== null) {
      await database.runAsync('DELETE FROM habit_reminder_schedules WHERE reminder_id=$id;', { $id: String(reminderRow.id) });
      await database.runAsync('DELETE FROM habit_reminders WHERE id=$id;', { $id: String(reminderRow.id) });
    }
    if (input.reminderLocalTime !== null) {
      await database.runAsync(
        `INSERT INTO habit_reminders (id, habit_id, trigger_local_time, timezone_mode, timezone_id, enabled, lifecycle, created_at, updated_at, archived_at)
         VALUES ($id, $habitId, $trigger, 'schedule_timezone', NULL, 1, 'active', $now, $now, NULL);`,
        { $habitId: input.habitId, $id: input.reminderId, $now: input.updatedAt, $trigger: input.reminderLocalTime },
      );
    }
  }

  if (changedFamilies.includes('identity')) {
    await database.runAsync('UPDATE habits SET name=$name,description=$description,updated_at=$updatedAt WHERE id=$habitId;', {
      $name: input.name,
      $description: input.description,
      $updatedAt: input.updatedAt,
      $habitId: input.habitId,
    });
  } else {
    await database.runAsync('UPDATE habits SET updated_at=$updatedAt WHERE id=$habitId;', { $updatedAt: input.updatedAt, $habitId: input.habitId });
  }

  const readback = await database.getFirstAsync<{ name: string; description: string | null; lifecycle: string; updated_at: number }>('SELECT name,description,lifecycle,updated_at FROM habits WHERE id=$habitId;', { $habitId: input.habitId });
  if (readback?.name !== input.name || readback.description !== input.description || readback.lifecycle !== 'active' || readback.updated_at !== input.updatedAt) {
    return editFailure('edit_data_integrity_failure', 'Habit edit readback failed.');
  }
  const identityReadback = await database.getFirstAsync<HabitVisualIdentityRow>('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: input.habitId });
  const expectedIdentity = input.visualIdentity ?? visualIdentity.value;
  const mappedIdentityReadback = identityReadback === null ? null : mapHabitVisualIdentityRow(identityReadback);
  if (mappedIdentityReadback === null || !mappedIdentityReadback.ok || !habitIconIdentitiesEqual(mappedIdentityReadback.value.iconIdentity, expectedIdentity.iconIdentity) || mappedIdentityReadback.value.persistedAccentKey !== expectedIdentity.persistedAccentKey || (changedFamilies.includes('visual_identity') && mappedIdentityReadback.value.updatedAt !== input.updatedAt)) {
    return editFailure('edit_data_integrity_failure', 'Habit visual identity readback failed.');
  }
  return success(Object.freeze({ habitId: input.habitId, outcome: 'changed', changedFamilies: Object.freeze(changedFamilies), effectiveLocalDate: input.effectiveLocalDate }));
}

async function applicableVersion<T>(database: PlannerSqliteDatabase, table: string, habitId: string, date: PlannerLocalDate): Promise<T | null> {
  const rows = await database.getAllAsync<T>(`SELECT * FROM ${table} WHERE habit_id=$habitId AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$date) ORDER BY version_number;`, { $habitId: habitId, $date: date });
  return rows.length === 1 ? rows[0] : null;
}

/** Which observation column references a family's version, where one does at all. */
function observationColumn(family: Family): string | null {
  if (family === 'schedule') return 'schedule_version_id';
  if (family === 'tracking') return 'tracking_version_id';
  if (family === 'importance') return 'importance_version_id';
  return null;
}

async function validateSameDayEligibility(
  database: PlannerSqliteDatabase,
  input: EditHabitPersistenceInput,
  rows: Readonly<{ schedule: HabitScheduleVersionRow; tracking: HabitTrackingVersionRow; importance: HabitImportanceVersionRow; planned_time: PlannedTimeRow }>,
  families: readonly Family[],
): Promise<Result<null, PlannerPersistenceError>> {
  for (const family of families) {
    const row = rows[family];
    const table = familyTable(family);
    const later = await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM ${table} WHERE habit_id=$habitId AND (version_number>$version OR effective_from>$date);`, { $habitId: input.habitId, $version: Number(row.version_number), $date: input.effectiveLocalDate });
    const referenceColumn = observationColumn(family);
    const references = referenceColumn === null ? { count: 0 } : await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM habit_observations WHERE ${referenceColumn}=$versionId;`, { $versionId: String(row.id) });
    const laterFacts = await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_observations WHERE habit_id=$habitId AND occurrence_local_date>=$date;', { $habitId: input.habitId, $date: input.effectiveLocalDate });
    if (row.effective_from !== input.effectiveLocalDate || later?.count !== 0 || references?.count !== 0 || laterFacts?.count !== 0) {
      return editFailure('edit_same_day_correction_not_eligible', 'Recorded history protects today\'s configuration. Choose tomorrow or a later date.');
    }
  }
  return success(null);
}

async function replaceSameDayFamily(
  database: PlannerSqliteDatabase,
  input: EditHabitPersistenceInput,
  family: Family,
  rows: Readonly<{ schedule: HabitScheduleVersionRow; tracking: HabitTrackingVersionRow; importance: HabitImportanceVersionRow; planned_time: PlannedTimeRow }>,
): Promise<void> {
  const row = rows[family];
  if (family === 'schedule') {
    const parameters = withoutEffectiveRangeParameters(scheduleDefinitionToParameters(withScheduleRange(input.schedule, { effectiveFrom: row.effective_from as PlannerLocalDate, effectiveTo: row.effective_to as PlannerLocalDate | null })));
    await database.runAsync(`UPDATE habit_schedule_versions SET schedule_type=$scheduleType,evaluation_timezone=$evaluationTimezone,interval_days=$intervalDays,weekdays_mask=$weekdaysMask,weekday=$weekday,period_target_count=$periodTargetCount,anchor_date=$anchorDate,month_day=$monthDay,month_number=$monthNumber,week_start=$weekStart,updated_at=$updatedAt WHERE id=$id;`, { ...parameters, $updatedAt: input.updatedAt, $id: String(row.id) });
  } else if (family === 'tracking') {
    const parameters = withoutEffectiveRangeParameters(trackingDefinitionToParameters(withTrackingRange(input.tracking, { effectiveFrom: row.effective_from as PlannerLocalDate, effectiveTo: row.effective_to as PlannerLocalDate | null })));
    await database.runAsync(`UPDATE habit_tracking_versions SET tracking_mode=$trackingMode,comparison_operator=$comparisonOperator,unit_type=$unitType,standard_unit_code=$standardUnitCode,custom_unit_label=$customUnitLabel,target_significand=$targetSignificand,target_scale=$targetScale,target_duration_seconds=$targetDurationSeconds,updated_at=$updatedAt WHERE id=$id;`, { ...parameters, $updatedAt: input.updatedAt, $id: String(row.id) });
  } else if (family === 'importance') {
    await database.runAsync('UPDATE habit_importance_versions SET importance_level=$importance,weight=$weight,updated_at=$updatedAt WHERE id=$id;', { $importance: input.importance, $weight: getImportanceWeight(input.importance), $updatedAt: input.updatedAt, $id: String(row.id) });
  } else {
    // The length travels with the minute: they are one family, so a correction that
    // moved the time and left the old length behind would describe a day nobody planned.
    await database.runAsync('UPDATE habit_planned_time_versions SET planned_local_time=$plannedTime,planned_duration_minutes=$plannedDuration,planned_block=$plannedBlock,updated_at=$updatedAt WHERE id=$id;', { $plannedTime: input.plannedLocalTime, $plannedDuration: input.plannedDurationMinutes, $plannedBlock: input.plannedBlock, $updatedAt: input.updatedAt, $id: String(row.id) });
  }
}

/**
 * What a family is called when a person is told about it.
 *
 * The raw name went into the message, so a device read "A planned planned_time change
 * already exists at or after this date" — a column name and an English sentence sharing
 * one line.
 */
function familyWord(family: Family): string {
  if (family === 'planned_time') return 'time';
  if (family === 'importance') return 'priority';
  if (family === 'schedule') return 'repeat';
  return 'tracking';
}

/**
 * A change already planned for a date **later** than this one.
 *
 * **A pending version starting on the very date being edited is not a conflict**, and
 * treating it as one is what made an item's configuration permanently unchangeable: the
 * editor falls back to tomorrow when today is protected by history (PD-EDIT-007), the
 * fallback appends a version starting tomorrow, and the next edit then found the version
 * the previous one had made and refused. Reported from the device twice — a priority
 * that could not be changed, and a placement into a free window that failed on
 * confirmation — and reproduced against a real database. Nothing has happened on a day
 * that has not arrived, so rewriting the plan for it is not rewriting history.
 *
 * A version starting **later** still is a conflict: silently discarding a change the
 * person scheduled for another day would be worse than saying no.
 */
async function findFutureConflict(database: PlannerSqliteDatabase, input: EditHabitPersistenceInput, families: readonly Family[]): Promise<Family | null> {
  for (const family of families) {
    const table = familyTable(family);
    const later = await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM ${table} WHERE habit_id=$habitId AND effective_from>$boundary;`, { $habitId: input.habitId, $boundary: input.effectiveLocalDate });
    if ((later?.count ?? 0) > 0) return family;
    // Two versions beginning on one date is a shape this cannot reason about, so it is
    // refused rather than half-replaced.
    const pending = await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM ${table} WHERE habit_id=$habitId AND effective_from=$boundary;`, { $habitId: input.habitId, $boundary: input.effectiveLocalDate });
    if ((pending?.count ?? 0) > 1) return family;
  }
  return null;
}

async function appendFutureFamily(
  database: PlannerSqliteDatabase,
  input: EditHabitPersistenceInput,
  family: Family,
  generatedId: string,
  activeTo: string | null,
): Promise<Result<null, PlannerPersistenceError>> {
  const table = familyTable(family);
  // **A plan already made for this same date is replaced, not stacked**, so the day the
  // person is planning has exactly one answer. The version before it is reopened to the
  // range the pending one held, and the append below then closes it at the boundary
  // again — the ordinary path, reached from a tidied state.
  const pending = await database.getAllAsync<{ id: string; effective_to: string | null }>(`SELECT id,effective_to FROM ${table} WHERE habit_id=$habitId AND effective_from=$boundary;`, { $habitId: input.habitId, $boundary: input.effectiveLocalDate });
  if (pending.length === 1) {
    const referenceColumn = observationColumn(family);
    const references = referenceColumn === null
      ? { count: 0 }
      : await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM habit_observations WHERE ${referenceColumn}=$versionId;`, { $versionId: String(pending[0].id) });
    // A version something was recorded against is history, whatever its date says.
    if ((references?.count ?? 0) !== 0) return editFailure('edit_future_version_conflict', `A ${familyWord(family)} change is already planned for a later date.`);
    // **The pending row goes first, and the order is the whole fix.** `uq_habit_planned_time_open`
    // admits one open planned-time version per habit, and SQLite tests a unique index
    // **per statement** rather than at commit. Reopening the previous row while the
    // pending one is still open therefore makes two open versions for exactly the width
    // of that one UPDATE, and the transaction dies with `SQLITE_CONSTRAINT_UNIQUE`
    // (2067). It reached the device as «The lifecycle transaction failed.» — the fallback
    // branch's message for anything that escapes raw rather than as a domain refusal —
    // and it made filing an already-timed item into a part of the day impossible for
    // anybody who had edited that item once before. Reproduced against a real database
    // before this line moved. The two statements do not otherwise interact: the pending
    // row is open, so it never matched the UPDATE's `effective_to=$boundary` anyway.
    await database.runAsync(`DELETE FROM ${table} WHERE id=$id;`, { $id: String(pending[0].id) });
    await database.runAsync(`UPDATE ${table} SET effective_to=$restore,updated_at=$updatedAt WHERE habit_id=$habitId AND effective_to=$boundary;`, { $restore: pending[0].effective_to, $updatedAt: input.updatedAt, $habitId: input.habitId, $boundary: input.effectiveLocalDate });
  }
  const currentRows = await database.getAllAsync<{ id: string; version_number: number; effective_to: string | null }>(`SELECT id,version_number,effective_to FROM ${table} WHERE habit_id=$habitId AND effective_from<$boundary AND (effective_to IS NULL OR effective_to>$boundary) ORDER BY version_number;`, { $habitId: input.habitId, $boundary: input.effectiveLocalDate });
  if (currentRows.length !== 1) return editFailure('edit_data_integrity_failure', `The current ${family} range is missing or ambiguous.`);
  const current = currentRows[0];
  await database.runAsync(`UPDATE ${table} SET effective_to=$boundary,updated_at=$updatedAt WHERE id=$id;`, { $boundary: input.effectiveLocalDate, $updatedAt: input.updatedAt, $id: current.id });
  const range = Object.freeze({ effectiveFrom: input.effectiveLocalDate, effectiveTo: activeTo as PlannerLocalDate | null });
  if (family === 'schedule') {
    const p = scheduleDefinitionToParameters(withScheduleRange(input.schedule, range));
    await database.runAsync(`INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at) VALUES($id,$habitId,$version,$scheduleType,$effectiveFrom,$effectiveTo,$evaluationTimezone,$intervalDays,$weekdaysMask,$weekday,$periodTargetCount,$anchorDate,$monthDay,$monthNumber,$weekStart,$now,$now);`, { ...p, $id: generatedId, $habitId: input.habitId, $version: current.version_number + 1, $now: input.updatedAt });
  } else if (family === 'tracking') {
    const p = trackingDefinitionToParameters(withTrackingRange(input.tracking, range));
    await database.runAsync(`INSERT INTO habit_tracking_versions(id,habit_id,version_number,tracking_mode,comparison_operator,unit_type,standard_unit_code,custom_unit_label,target_significand,target_scale,target_duration_seconds,effective_from,effective_to,created_at,updated_at) VALUES($id,$habitId,$version,$trackingMode,$comparisonOperator,$unitType,$standardUnitCode,$customUnitLabel,$targetSignificand,$targetScale,$targetDurationSeconds,$effectiveFrom,$effectiveTo,$now,$now);`, { ...p, $id: generatedId, $habitId: input.habitId, $version: current.version_number + 1, $now: input.updatedAt });
  } else if (family === 'importance') {
    await database.runAsync(`INSERT INTO habit_importance_versions(id,habit_id,version_number,importance_level,weight,effective_from,effective_to,created_at,updated_at) VALUES($id,$habitId,$version,$importance,$weight,$effectiveFrom,$effectiveTo,$now,$now);`, { $id: generatedId, $habitId: input.habitId, $version: current.version_number + 1, $importance: input.importance, $weight: getImportanceWeight(input.importance), $effectiveFrom: input.effectiveLocalDate, $effectiveTo: activeTo, $now: input.updatedAt });
  } else {
    await database.runAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes,planned_block) VALUES($id,$habitId,$version,$effectiveFrom,$effectiveTo,$plannedTime,$now,$now,$plannedDuration,$plannedBlock);`, { $id: generatedId, $habitId: input.habitId, $version: current.version_number + 1, $effectiveFrom: input.effectiveLocalDate, $effectiveTo: activeTo, $plannedTime: input.plannedLocalTime, $plannedDuration: input.plannedDurationMinutes, $plannedBlock: input.plannedBlock, $now: input.updatedAt });
  }
  return success(null);
}

function familyTable(family: Family): string {
  return family === 'schedule' ? 'habit_schedule_versions' : family === 'tracking' ? 'habit_tracking_versions' : family === 'importance' ? 'habit_importance_versions' : 'habit_planned_time_versions';
}

function sameParameters(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>, ignored: readonly string[]): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (!ignored.includes(key) && left[key] !== right[key]) return false;
  return true;
}

function withoutEffectiveRangeParameters<T extends Readonly<Record<string, unknown>>>(parameters: T): Omit<T, '$effectiveFrom' | '$effectiveTo'> {
  const { $effectiveFrom: _effectiveFrom, $effectiveTo: _effectiveTo, ...rest } = parameters;
  return rest;
}

function withScheduleRange(definition: ScheduleDefinition, effectiveRange: EffectiveRange): ScheduleDefinition {
  return Object.freeze({ ...definition, effectiveRange }) as ScheduleDefinition;
}

function withTrackingRange(definition: TrackingDefinition, effectiveRange: EffectiveRange): TrackingDefinition {
  return Object.freeze({ ...definition, effectiveRange }) as TrackingDefinition;
}

function editFailure<T = never>(code: PlannerPersistenceError['code'], message: string): Result<T, PlannerPersistenceError> {
  return failure(createPlannerPersistenceError(code, message, { operation: 'editHabit' }));
}
