import { failure, success, type PlannerId, type Result } from '../../domain';
import {
  createPlannerPersistenceError,
  type HabitAggregate,
  type InitialHabitAggregatePersistenceInput,
  type PlannerPersistenceError,
} from '../../repositories';
import {
  mapInitialHabitRows,
  mapHabitVisualIdentityRow,
  habitVisualIdentityToParameters,
  scheduleDefinitionToParameters,
  trackingDefinitionToParameters,
} from './planner-row-mappers';
import type {
  HabitCategoryStatusRow,
  HabitImportanceVersionRow,
  HabitReminderRow,
  HabitRow,
  HabitScheduleVersionRow,
  HabitTrackingVersionRow,
  HabitVisualIdentityRow,
} from './planner-row-types';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

const READ_CATEGORY_STATUS_SQL = `
SELECT id, lifecycle
FROM habit_categories
WHERE id = $categoryId;
`;

const INSERT_HABIT_SQL = `
INSERT INTO habits (
  id, name, description, category_id, active_from, active_to,
  sort_order, lifecycle, created_at, updated_at, archived_at
) VALUES (
  $habitId, $name, $description, $categoryId, $activeFrom, $activeTo,
  0, 'active', $createdAt, $createdAt, NULL
);
`;
const INSERT_INITIAL_LIFECYCLE_SQL = `INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at) VALUES($transitionId,$habitId,1,'active',$effectiveFrom,$timezone,$createdAt,$createdAt);`;
const INSERT_VISUAL_IDENTITY_SQL = `INSERT INTO habit_visual_identities(id,habit_id,icon_kind,symbol_key,emoji_value,accent_key,created_at,updated_at) VALUES($habitId,$habitId,$iconKind,$symbolKey,$emojiValue,$accentKey,$createdAt,$createdAt);`;

const INSERT_SCHEDULE_SQL = `
INSERT INTO habit_schedule_versions (
  id, habit_id, version_number, schedule_type, effective_from, effective_to,
  evaluation_timezone, interval_days, weekdays_mask, weekday,
  period_target_count, anchor_date, month_day, month_number, week_start,
  created_at, updated_at
) VALUES (
  $scheduleVersionId, $habitId, 1, $scheduleType, $effectiveFrom, $effectiveTo,
  $evaluationTimezone, $intervalDays, $weekdaysMask, $weekday,
  $periodTargetCount, $anchorDate, $monthDay, $monthNumber, $weekStart,
  $createdAt, $createdAt
);
`;

const INSERT_TRACKING_SQL = `
INSERT INTO habit_tracking_versions (
  id, habit_id, version_number, tracking_mode, comparison_operator,
  unit_type, standard_unit_code, custom_unit_label, target_significand,
  target_scale, target_duration_seconds, effective_from, effective_to,
  created_at, updated_at
) VALUES (
  $trackingVersionId, $habitId, 1, $trackingMode, $comparisonOperator,
  $unitType, $standardUnitCode, $customUnitLabel, $targetSignificand,
  $targetScale, $targetDurationSeconds, $effectiveFrom, $effectiveTo,
  $createdAt, $createdAt
);
`;

const INSERT_IMPORTANCE_SQL = `
INSERT INTO habit_importance_versions (
  id, habit_id, version_number, importance_level, weight,
  effective_from, effective_to, created_at, updated_at
) VALUES (
  $importanceVersionId, $habitId, 1, $importance, $importanceWeight,
  $effectiveFrom, $effectiveTo, $createdAt, $createdAt
);
`;

const INSERT_PLANNED_TIME_SQL = `
INSERT INTO habit_planned_time_versions (
  id, habit_id, version_number, effective_from, effective_to,
  planned_local_time, created_at, updated_at, planned_duration_minutes, planned_block
) VALUES (
  $plannedTimeVersionId, $habitId, 1, $effectiveFrom, $effectiveTo,
  $plannedLocalTime, $createdAt, $createdAt, $plannedDurationMinutes, $plannedBlock
);
`;

const INSERT_REMINDER_SQL = `
INSERT INTO habit_reminders (
  id, habit_id, trigger_local_time, timezone_mode, timezone_id,
  enabled, lifecycle, created_at, updated_at, archived_at
) VALUES (
  $reminderId, $habitId, $triggerLocalTime, $timezoneMode, $timezoneId,
  1, 'active', $createdAt, $createdAt, NULL
);
`;

const READ_HABIT_SQL = `SELECT * FROM habits WHERE id = $habitId;`;
const READ_SCHEDULE_SQL = `
SELECT * FROM habit_schedule_versions
WHERE habit_id = $habitId AND version_number = 1;
`;
const READ_TRACKING_SQL = `
SELECT * FROM habit_tracking_versions
WHERE habit_id = $habitId AND version_number = 1;
`;
const READ_IMPORTANCE_SQL = `
SELECT * FROM habit_importance_versions
WHERE habit_id = $habitId AND version_number = 1;
`;
const READ_REMINDERS_SQL = `
SELECT * FROM habit_reminders
WHERE habit_id = $habitId AND lifecycle = 'active'
ORDER BY id;
`;
const READ_VISUAL_IDENTITY_SQL = `SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;`;

export async function validateCategoryForCreation(
  database: PlannerSqliteDatabase,
  categoryId: PlannerId | null,
): Promise<Result<null, PlannerPersistenceError>> {
  if (categoryId === null) return success(null);
  const row = await database.getFirstAsync<HabitCategoryStatusRow>(
    READ_CATEGORY_STATUS_SQL,
    { $categoryId: categoryId },
  );
  if (row === null) {
    return failure(
      createPlannerPersistenceError(
        'category_not_found',
        'The requested category does not exist.',
        { operation: 'validateCategoryForCreation' },
      ),
    );
  }
  if (row.id !== categoryId || row.lifecycle !== 'active') {
    return failure(
      createPlannerPersistenceError(
        row.id === categoryId && row.lifecycle === 'archived'
          ? 'category_archived'
          : 'data_integrity_failure',
        row.lifecycle === 'archived'
          ? 'The requested category is archived.'
          : 'The persisted category status is malformed.',
        { operation: 'validateCategoryForCreation' },
      ),
    );
  }
  return success(null);
}

export async function insertInitialHabitRows(
  database: PlannerSqliteDatabase,
  input: InitialHabitAggregatePersistenceInput,
): Promise<void> {
  const common = {
    $habitId: input.habitId,
    $effectiveFrom: input.activeRange.effectiveFrom,
    $effectiveTo: input.activeRange.effectiveTo,
    $createdAt: input.createdAt,
  };
  await insertHabitIdentityRow(database, {
    habitId: input.habitId,
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    activeRange: input.activeRange,
    createdAt: input.createdAt,
  });
  await database.runAsync(INSERT_VISUAL_IDENTITY_SQL, {
    $habitId: input.habitId,
    ...habitVisualIdentityToParameters(input.visualIdentity),
    $createdAt: input.createdAt,
  });
  await database.runAsync(INSERT_INITIAL_LIFECYCLE_SQL, {
    $transitionId: input.lifecycleTransitionId,
    $habitId: input.habitId,
    $effectiveFrom: input.activeRange.effectiveFrom,
    $timezone: input.schedule.evaluationTimezone,
    $createdAt: input.createdAt,
  });
  await database.runAsync(INSERT_SCHEDULE_SQL, {
    ...common,
    $scheduleVersionId: input.scheduleVersionId,
    ...scheduleDefinitionToParameters(input.schedule),
  });
  await insertHabitTrackingVersionRow(database, {
    habitId: input.habitId,
    trackingVersionId: input.trackingVersionId,
    activeRange: input.activeRange,
    tracking: input.tracking,
    createdAt: input.createdAt,
  });
  await insertHabitImportanceVersionRow(database, {
    habitId: input.habitId,
    importanceVersionId: input.importanceVersionId,
    activeRange: input.activeRange,
    importance: input.importance,
    importanceWeight: input.importanceWeight,
    createdAt: input.createdAt,
  });
  await database.runAsync(INSERT_PLANNED_TIME_SQL, {
    ...common,
    $plannedTimeVersionId: input.plannedTimeVersionId,
    $plannedLocalTime: input.plannedLocalTime,
    $plannedDurationMinutes: input.plannedDurationMinutes,
    $plannedBlock: input.plannedBlock,
  });
  if (input.reminder !== null) {
    await insertHabitReminderRow(database, {
      habitId: input.habitId,
      reminder: input.reminder,
      createdAt: input.createdAt,
    });
  }
}

export async function insertHabitIdentityRow(
  database: PlannerSqliteDatabase,
  input: Pick<
    InitialHabitAggregatePersistenceInput,
    'name' | 'description' | 'categoryId' | 'activeRange' | 'createdAt'
  > & Readonly<{ habitId: PlannerId }>,
): Promise<void> {
  await database.runAsync(INSERT_HABIT_SQL, {
    $habitId: input.habitId,
    $name: input.name,
    $description: input.description,
    $categoryId: input.categoryId,
    $activeFrom: input.activeRange.effectiveFrom,
    $activeTo: input.activeRange.effectiveTo,
    $createdAt: input.createdAt,
  });
}

export async function insertHabitTrackingVersionRow(
  database: PlannerSqliteDatabase,
  input: Pick<
    InitialHabitAggregatePersistenceInput,
    'trackingVersionId' | 'activeRange' | 'tracking' | 'createdAt'
  > & Readonly<{ habitId: PlannerId }>,
): Promise<void> {
  await database.runAsync(INSERT_TRACKING_SQL, {
    $habitId: input.habitId,
    $effectiveFrom: input.activeRange.effectiveFrom,
    $effectiveTo: input.activeRange.effectiveTo,
    $createdAt: input.createdAt,
    $trackingVersionId: input.trackingVersionId,
    ...trackingDefinitionToParameters(input.tracking),
  });
}

export async function insertHabitImportanceVersionRow(
  database: PlannerSqliteDatabase,
  input: Pick<
    InitialHabitAggregatePersistenceInput,
    | 'importanceVersionId'
    | 'activeRange'
    | 'importance'
    | 'importanceWeight'
    | 'createdAt'
  > & Readonly<{ habitId: PlannerId }>,
): Promise<void> {
  await database.runAsync(INSERT_IMPORTANCE_SQL, {
    $habitId: input.habitId,
    $effectiveFrom: input.activeRange.effectiveFrom,
    $effectiveTo: input.activeRange.effectiveTo,
    $createdAt: input.createdAt,
    $importanceVersionId: input.importanceVersionId,
    $importance: input.importance,
    $importanceWeight: input.importanceWeight,
  });
}

export async function insertHabitReminderRow(
  database: PlannerSqliteDatabase,
  input: Readonly<{
    habitId: PlannerId;
    reminder: NonNullable<InitialHabitAggregatePersistenceInput['reminder']>;
    createdAt: number;
  }>,
): Promise<void> {
  await database.runAsync(INSERT_REMINDER_SQL, {
    $reminderId: input.reminder.id,
    $habitId: input.habitId,
    $triggerLocalTime: input.reminder.triggerLocalTime,
    $timezoneMode: input.reminder.timezoneMode,
    $timezoneId: input.reminder.timezoneId,
    $createdAt: input.createdAt,
  });
}

export async function readInitialHabitAggregate(
  database: PlannerSqliteDatabase,
  habitId: string,
  expected: InitialHabitAggregatePersistenceInput | null = null,
): Promise<Result<HabitAggregate | null, PlannerPersistenceError>> {
  const parameters = { $habitId: habitId };
  const habit = await database.getFirstAsync<HabitRow>(READ_HABIT_SQL, parameters);
  if (habit === null) return success(null);
  const [schedule, tracking, importance, reminders, visualIdentity] = await Promise.all([
    database.getFirstAsync<HabitScheduleVersionRow>(READ_SCHEDULE_SQL, parameters),
    database.getFirstAsync<HabitTrackingVersionRow>(READ_TRACKING_SQL, parameters),
    database.getFirstAsync<HabitImportanceVersionRow>(READ_IMPORTANCE_SQL, parameters),
    database.getAllAsync<HabitReminderRow>(READ_REMINDERS_SQL, parameters),
    database.getFirstAsync<HabitVisualIdentityRow>(READ_VISUAL_IDENTITY_SQL, parameters),
  ]);
  if (schedule === null || tracking === null || importance === null || visualIdentity === null) {
    return failure(
      createPlannerPersistenceError(
        'data_integrity_failure',
        'The persisted initial habit aggregate is incomplete.',
        { operation: 'readInitialHabitAggregate' },
      ),
    );
  }
  const plannedTime = await database.getFirstAsync<{
    id: string; habit_id: string; version_number: number;
    effective_from: string; effective_to: string | null;
    planned_local_time: string | null; created_at: number; updated_at: number;
  }>('SELECT * FROM habit_planned_time_versions WHERE habit_id=$habitId AND version_number=1;', parameters);
  if (
    plannedTime === null || plannedTime.id !== expected?.plannedTimeVersionId && expected !== null ||
    plannedTime.habit_id !== habitId || plannedTime.version_number !== 1 ||
    plannedTime.planned_local_time !== (expected?.plannedLocalTime ?? null)
  ) {
    return failure(createPlannerPersistenceError('data_integrity_failure', 'The initial planned-time row failed readback.', { operation: 'readInitialHabitAggregate' }));
  }
  const mapped = mapInitialHabitRows(
    { habit, schedule, tracking, importance, reminders },
    expected,
  );
  if (!mapped.ok) return mapped;
  const identity = mapHabitVisualIdentityRow(visualIdentity);
  if (!identity.ok) return identity;
  if (identity.value.habitId !== habitId) {
    return failure(createPlannerPersistenceError('data_integrity_failure', 'The persisted visual identity owner is inconsistent.', { operation: 'readInitialHabitAggregate' }));
  }
  return success(Object.freeze({ ...mapped.value, visualIdentity: identity.value }));
}
