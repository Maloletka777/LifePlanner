import {
  addPlannerCalendarDays,
  failure,
  isOrdinaryCompletionRole,
  success,
  type PlannerLocalDate,
  parsePlannerId,
  parsePlannerDayBlock,
  parsePlannerDurationMinutes,
  parsePlannerLocalTime,
  type Result,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type PlannerOccurrenceDataSet,
  type PlannerPersistenceError,
} from '../../repositories';
import {
  mapDependencyGraphRows,
} from './planner-dependency-row-mappers';
import { mapHabitObservationRow } from './planner-observation-row-mappers';
import {
  mapHabitRow,
  mapHabitVisualIdentityRow,
  mapImportanceRow,
  mapScheduleRow,
  mapTrackingRow,
} from './planner-row-mappers';
import type {
  HabitDependencyVersionRow,
  HabitImportanceVersionRow,
  HabitObservationRow,
  HabitRow,
  HabitScheduleVersionRow,
  HabitTrackingVersionRow,
  HabitVisualIdentityRow,
} from './planner-row-types';
import { reconstructObservationChains } from './sqlite-habit-observation-repository';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

function activeHabitPredicate(dateExpression: string): string {
  return `
  h.active_from <= ${dateExpression}
  AND (h.active_to IS NULL OR h.active_to > ${dateExpression})
  AND (SELECT lt.lifecycle FROM habit_lifecycle_transitions lt
       WHERE lt.habit_id = h.id AND lt.effective_local_date <= ${dateExpression}
       ORDER BY lt.effective_local_date DESC, lt.sequence_number DESC LIMIT 1) = 'active'
`;
}

const ACTIVE_HABIT_PREDICATE = activeHabitPredicate('$selectedLocalDate');

interface OrdinaryParentRow {
  readonly parent_habit_id: unknown;
  readonly child_habit_id: unknown;
  readonly completion_role: unknown;
}

interface PlannedTimeRow {
  readonly habit_id: unknown;
  readonly planned_local_time: unknown;
  readonly planned_duration_minutes: unknown;
  readonly planned_block: unknown;
}

interface PlannerOccurrenceRows {
  readonly habits: readonly HabitRow[];
  readonly schedules: readonly HabitScheduleVersionRow[];
  readonly tracking: readonly HabitTrackingVersionRow[];
  readonly importance: readonly HabitImportanceVersionRow[];
  readonly relationships: readonly HabitDependencyVersionRow[];
  readonly ordinaryParents: readonly OrdinaryParentRow[];
  readonly plannedTimes: readonly PlannedTimeRow[];
  readonly visualIdentities: readonly HabitVisualIdentityRow[];
  readonly observations: readonly HabitObservationRow[];
}

export async function loadPlannerOccurrenceData(
  database: PlannerSqliteDatabase,
  selectedLocalDate: PlannerLocalDate,
): Promise<Result<PlannerOccurrenceDataSet, PlannerPersistenceError>> {
  const parameters = { $selectedLocalDate: selectedLocalDate } as const;
  try {
    const [createdHabitCountRow, preferenceRow, habitRows, visualIdentityRows, scheduleRows, trackingRows, importanceRows, relationshipRows, ordinaryRows, plannedTimeRows, observationRows] =
      await Promise.all([
        database.getFirstAsync<{ readonly count: number }>(
          'SELECT COUNT(*) AS count FROM habits;',
        ),
        database.getFirstAsync<{ readonly progress_mode: unknown }>('SELECT progress_mode FROM planner_preferences WHERE id=1;'),
        database.getAllAsync<HabitRow>(
          `SELECT h.* FROM habits h
           WHERE ${ACTIVE_HABIT_PREDICATE}
           ORDER BY h.sort_order, h.id;`,
          parameters,
        ),
        database.getAllAsync<HabitVisualIdentityRow>(
          `SELECT v.* FROM habit_visual_identities v
           JOIN habits h ON h.id=v.habit_id
           WHERE ${ACTIVE_HABIT_PREDICATE}
           ORDER BY v.habit_id;`,
          parameters,
        ),
        database.getAllAsync<HabitScheduleVersionRow>(
          `SELECT v.* FROM habit_schedule_versions v
           JOIN habits h ON h.id = v.habit_id
           WHERE ${ACTIVE_HABIT_PREDICATE}
             AND v.effective_from <= $selectedLocalDate
             AND (v.effective_to IS NULL OR v.effective_to > $selectedLocalDate)
           ORDER BY v.habit_id, v.version_number, v.id;`,
          parameters,
        ),
        database.getAllAsync<HabitTrackingVersionRow>(
          `SELECT v.* FROM habit_tracking_versions v
           JOIN habits h ON h.id = v.habit_id
           WHERE ${ACTIVE_HABIT_PREDICATE}
             AND v.effective_from <= $selectedLocalDate
             AND (v.effective_to IS NULL OR v.effective_to > $selectedLocalDate)
           ORDER BY v.habit_id, v.version_number, v.id;`,
          parameters,
        ),
        database.getAllAsync<HabitImportanceVersionRow>(
          `SELECT v.* FROM habit_importance_versions v
           JOIN habits h ON h.id = v.habit_id
           WHERE ${ACTIVE_HABIT_PREDICATE}
             AND v.effective_from <= $selectedLocalDate
             AND (v.effective_to IS NULL OR v.effective_to > $selectedLocalDate)
           ORDER BY v.habit_id, v.version_number, v.id;`,
          parameters,
        ),
        database.getAllAsync<HabitDependencyVersionRow>(
          `SELECT d.* FROM habit_dependency_versions d
           WHERE d.effective_from <= $selectedLocalDate
             AND (d.effective_to IS NULL OR d.effective_to > $selectedLocalDate)
           ORDER BY d.parent_habit_id, d.dependent_habit_id,
                    d.relationship_id, d.version_number, d.id;`,
          parameters,
        ),
        database.getAllAsync<OrdinaryParentRow>(
          `SELECT parent_habit_id, child_habit_id, completion_role FROM habit_ordinary_parent_versions
           WHERE effective_from <= $selectedLocalDate
             AND (effective_to IS NULL OR effective_to > $selectedLocalDate)
           ORDER BY parent_habit_id, child_habit_id;`,
          parameters,
        ),
        database.getAllAsync<PlannedTimeRow>(
          `SELECT habit_id, planned_local_time, planned_duration_minutes, planned_block FROM habit_planned_time_versions
           WHERE effective_from <= $selectedLocalDate
             AND (effective_to IS NULL OR effective_to > $selectedLocalDate)
           ORDER BY habit_id, version_number, id;`,
          parameters,
        ),
        database.getAllAsync<HabitObservationRow>(
          `SELECT o.* FROM habit_observations o
           JOIN habits h ON h.id = o.habit_id
           WHERE ${ACTIVE_HABIT_PREDICATE}
           ORDER BY o.habit_id, o.created_at, o.id;`,
          parameters,
        ),
      ]);

    return mapPlannerOccurrenceRows(selectedLocalDate, createdHabitCountRow, preferenceRow, {
      habits: habitRows,
      visualIdentities: visualIdentityRows,
      schedules: scheduleRows,
      tracking: trackingRows,
      importance: importanceRows,
      relationships: relationshipRows,
      ordinaryParents: ordinaryRows,
      plannedTimes: plannedTimeRows,
      observations: observationRows,
    });
  } catch (cause: unknown) {
    return failure(
      createPlannerPersistenceError(
        'occurrence_read_model_database_failure',
        'The selected-date Planner data could not be read.',
        { operation: 'loadPlannerOccurrenceData', cause },
      ),
    );
  }
}

const MAX_MARKER_RANGE_DAYS = 31;

const MARKER_RANGE_CTE = `WITH RECURSIVE requested_dates(selected_local_date) AS (
  SELECT $startDate
  UNION ALL
  SELECT date(selected_local_date, '+1 day') FROM requested_dates
  WHERE selected_local_date < $endDate
)`;

type Dated<Row> = Row & Readonly<{ selected_local_date: unknown }>;

export async function loadPlannerOccurrenceDataRange(
  database: PlannerSqliteDatabase,
  startDate: PlannerLocalDate,
  endDate: PlannerLocalDate,
): Promise<Result<readonly PlannerOccurrenceDataSet[], PlannerPersistenceError>> {
  const dates: PlannerLocalDate[] = [];
  let date = startDate;
  while (date <= endDate && dates.length < MAX_MARKER_RANGE_DAYS) {
    dates.push(date);
    const next = addPlannerCalendarDays(date, 1);
    if (!next.ok) return occurrenceIntegrity(next.error);
    date = next.value;
  }
  if (dates.length === 0 || date <= endDate) {
    return occurrenceIntegrity(new Error('The marker-summary range is empty or too large.'));
  }

  const parameters = { $startDate: startDate, $endDate: endDate } as const;
  const rangeDate = 'requested.selected_local_date';
  const rangeActiveHabitPredicate = activeHabitPredicate(rangeDate);
  try {
    const [createdHabitCountRow, preferenceRow, habitRows, visualIdentityRows, scheduleRows, trackingRows, importanceRows, relationshipRows, ordinaryRows, plannedTimeRows, observationRows] = await Promise.all([
      database.getFirstAsync<{ readonly count: number }>('SELECT COUNT(*) AS count FROM habits;'),
      database.getFirstAsync<{ readonly progress_mode: unknown }>('SELECT progress_mode FROM planner_preferences WHERE id=1;'),
      database.getAllAsync<Dated<HabitRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, h.* FROM requested_dates requested
         JOIN habits h ON 1 = 1
         WHERE ${rangeActiveHabitPredicate}
         ORDER BY requested.selected_local_date, h.sort_order, h.id;`,
        parameters,
      ),
      database.getAllAsync<Dated<HabitVisualIdentityRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, visual.* FROM requested_dates requested
         JOIN habit_visual_identities visual ON 1 = 1
         JOIN habits h ON h.id=visual.habit_id
         WHERE ${rangeActiveHabitPredicate}
         ORDER BY requested.selected_local_date, visual.habit_id;`,
        parameters,
      ),
      database.getAllAsync<Dated<HabitScheduleVersionRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, v.* FROM requested_dates requested
         JOIN habit_schedule_versions v ON 1 = 1
         JOIN habits h ON h.id = v.habit_id
         WHERE ${rangeActiveHabitPredicate}
           AND v.effective_from <= ${rangeDate}
           AND (v.effective_to IS NULL OR v.effective_to > ${rangeDate})
         ORDER BY requested.selected_local_date, v.habit_id, v.version_number, v.id;`,
        parameters,
      ),
      database.getAllAsync<Dated<HabitTrackingVersionRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, v.* FROM requested_dates requested
         JOIN habit_tracking_versions v ON 1 = 1
         JOIN habits h ON h.id = v.habit_id
         WHERE ${rangeActiveHabitPredicate}
           AND v.effective_from <= ${rangeDate}
           AND (v.effective_to IS NULL OR v.effective_to > ${rangeDate})
         ORDER BY requested.selected_local_date, v.habit_id, v.version_number, v.id;`,
        parameters,
      ),
      database.getAllAsync<Dated<HabitImportanceVersionRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, v.* FROM requested_dates requested
         JOIN habit_importance_versions v ON 1 = 1
         JOIN habits h ON h.id = v.habit_id
         WHERE ${rangeActiveHabitPredicate}
           AND v.effective_from <= ${rangeDate}
           AND (v.effective_to IS NULL OR v.effective_to > ${rangeDate})
         ORDER BY requested.selected_local_date, v.habit_id, v.version_number, v.id;`,
        parameters,
      ),
      database.getAllAsync<Dated<HabitDependencyVersionRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, relationship.* FROM requested_dates requested
         JOIN habit_dependency_versions relationship ON 1 = 1
         WHERE relationship.effective_from <= ${rangeDate}
           AND (relationship.effective_to IS NULL OR relationship.effective_to > ${rangeDate})
         ORDER BY requested.selected_local_date, relationship.parent_habit_id, relationship.dependent_habit_id,
                  relationship.relationship_id, relationship.version_number, relationship.id;`,
        parameters,
      ),
      database.getAllAsync<Dated<OrdinaryParentRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, relationship.parent_habit_id, relationship.child_habit_id, relationship.completion_role
         FROM requested_dates requested
         JOIN habit_ordinary_parent_versions relationship ON 1 = 1
         WHERE relationship.effective_from <= ${rangeDate}
           AND (relationship.effective_to IS NULL OR relationship.effective_to > ${rangeDate})
         ORDER BY requested.selected_local_date, relationship.parent_habit_id, relationship.child_habit_id;`,
        parameters,
      ),
      database.getAllAsync<Dated<PlannedTimeRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, planned.habit_id, planned.planned_local_time
         FROM requested_dates requested
         JOIN habit_planned_time_versions planned ON 1 = 1
         WHERE planned.effective_from <= ${rangeDate}
           AND (planned.effective_to IS NULL OR planned.effective_to > ${rangeDate})
         ORDER BY requested.selected_local_date, planned.habit_id, planned.version_number, planned.id;`,
        parameters,
      ),
      database.getAllAsync<Dated<HabitObservationRow>>(
        `${MARKER_RANGE_CTE}
         SELECT requested.selected_local_date, observation.* FROM requested_dates requested
         JOIN habit_observations observation ON 1 = 1
         JOIN habits h ON h.id = observation.habit_id
         WHERE ${rangeActiveHabitPredicate}
         ORDER BY requested.selected_local_date, observation.habit_id, observation.created_at, observation.id;`,
        parameters,
      ),
    ]);

    const dataSets: PlannerOccurrenceDataSet[] = [];
    for (const selectedLocalDate of dates) {
      const mapped = mapPlannerOccurrenceRows(selectedLocalDate, createdHabitCountRow, preferenceRow, {
        habits: rowsForDate(habitRows, selectedLocalDate),
        visualIdentities: rowsForDate(visualIdentityRows, selectedLocalDate),
        schedules: rowsForDate(scheduleRows, selectedLocalDate),
        tracking: rowsForDate(trackingRows, selectedLocalDate),
        importance: rowsForDate(importanceRows, selectedLocalDate),
        relationships: rowsForDate(relationshipRows, selectedLocalDate),
        ordinaryParents: rowsForDate(ordinaryRows, selectedLocalDate),
        plannedTimes: rowsForDate(plannedTimeRows, selectedLocalDate),
        observations: rowsForDate(observationRows, selectedLocalDate),
      });
      if (!mapped.ok) return mapped;
      dataSets.push(mapped.value);
    }
    return success(Object.freeze(dataSets));
  } catch (cause: unknown) {
    return occurrenceDatabaseFailure('loadPlannerOccurrenceDataRange', cause);
  }
}

function rowsForDate<Row extends Readonly<{ selected_local_date: unknown }>>(
  rows: readonly Row[],
  selectedLocalDate: PlannerLocalDate,
): readonly Row[] {
  return rows.filter((row) => row.selected_local_date === selectedLocalDate);
}

function mapPlannerOccurrenceRows(
  selectedLocalDate: PlannerLocalDate,
  createdHabitCountRow: Readonly<{ count: number }> | null,
  preferenceRow: Readonly<{ progress_mode: unknown }> | null,
  rows: PlannerOccurrenceRows,
): Result<PlannerOccurrenceDataSet, PlannerPersistenceError> {
  if (createdHabitCountRow === null || !Number.isSafeInteger(createdHabitCountRow.count) || createdHabitCountRow.count < 0) {
    return occurrenceIntegrity(new Error('The created habit count is invalid.'));
  }
  if (preferenceRow === null || (preferenceRow.progress_mode !== 'equal' && preferenceRow.progress_mode !== 'weighted')) {
    return occurrenceIntegrity(new Error('The Planner progress preference is invalid.'));
  }

  const habits = [];
  for (const row of rows.habits) {
    const mapped = mapHabitRow(row);
    if (!mapped.ok) return occurrenceIntegrity(mapped.error);
    habits.push(Object.freeze({
      id: mapped.value.id,
      name: mapped.value.name,
      categoryId: mapped.value.categoryId,
      activeRange: mapped.value.activeRange,
      lifecycle: 'active' as const,
      sortOrder: mapped.value.sortOrder,
    }));
  }

  const visualIdentities = [];
  const visualOwners = new Set<string>();
  for (const row of rows.visualIdentities) {
    const mapped = mapHabitVisualIdentityRow(row);
    if (!mapped.ok) return occurrenceIntegrity(mapped.error);
    if (visualOwners.has(mapped.value.habitId)) return occurrenceIntegrity(new Error('A visual identity is duplicated.'));
    visualOwners.add(mapped.value.habitId);
    visualIdentities.push(mapped.value);
  }
  if (visualIdentities.length !== habits.length || habits.some((habit) => !visualOwners.has(habit.id))) {
    return occurrenceIntegrity(new Error('An active habit is missing its visual identity.'));
  }

  const schedules = [];
  for (const row of rows.schedules) {
    const mapped = mapScheduleRow(row);
    if (!mapped.ok) return occurrenceIntegrity(mapped.error);
    schedules.push(Object.freeze({ id: mapped.value.model.id, habitId: mapped.value.habitId, definition: mapped.value.model.definition }));
  }

  const tracking = [];
  for (const row of rows.tracking) {
    const mapped = mapTrackingRow(row);
    if (!mapped.ok) return occurrenceIntegrity(mapped.error);
    tracking.push(Object.freeze({ id: mapped.value.model.id, habitId: mapped.value.habitId, definition: mapped.value.model.definition }));
  }

  const importance = [];
  for (const row of rows.importance) {
    const mapped = mapImportanceRow(row);
    if (!mapped.ok) return occurrenceIntegrity(mapped.error);
    importance.push(Object.freeze({
      id: mapped.value.model.id,
      habitId: mapped.value.habitId,
      importance: mapped.value.model.importance,
      weight: mapped.value.model.weight,
      effectiveRange: mapped.value.model.effectiveRange,
    }));
  }

  const relationships = mapDependencyGraphRows(rows.relationships);
  if (!relationships.ok) return occurrenceIntegrity(relationships.error);

  const ordinaryParents = [];
  for (const row of rows.ordinaryParents) {
    const parent = parsePlannerId(row.parent_habit_id, 'ordinaryParent.parentHabitId');
    const child = parsePlannerId(row.child_habit_id, 'ordinaryParent.childHabitId');
    if (!parent.ok || !child.ok || !isOrdinaryCompletionRole(row.completion_role)) return occurrenceIntegrity(new Error('An ordinary-parent row is malformed.'));
    ordinaryParents.push(Object.freeze({ parentHabitId: parent.value, childHabitId: child.value, completionRole: row.completion_role }));
  }

  const plannedTimes = [];
  const plannedHabitIds = new Set<string>();
  for (const row of rows.plannedTimes) {
    const habit = parsePlannerId(row.habit_id, 'plannedTime.habitId');
    const time = row.planned_local_time === null ? success(null) : parsePlannerLocalTime(row.planned_local_time, 'plannedTime.plannedLocalTime');
    // A stored length is validated on the way out, not trusted: the column's own CHECK
    // bounds it, but a database that disagrees with its schema is the failure this
    // project has already met once (PD-DATA-001), so a malformed one is refused here
    // rather than drawn as a plate of some arbitrary height.
    const duration = row.planned_duration_minutes === null || row.planned_duration_minutes === undefined
      ? success(null)
      : parsePlannerDurationMinutes(row.planned_duration_minutes, 'plannedTime.plannedDurationMinutes');
    // The block is validated on the way out for the same reason the length is: the
    // column's CHECK bounds it, and a database that disagrees with its schema is a
    // failure this project has met once.
    const block = row.planned_block === null || row.planned_block === undefined
      ? success(null)
      : parsePlannerDayBlock(row.planned_block, 'plannedTime.plannedBlock');
    if (!habit.ok || !time.ok || !duration.ok || !block.ok || plannedHabitIds.has(habit.ok ? habit.value : '')) return occurrenceIntegrity(new Error('A planned-time row is malformed or ambiguous.'));
    plannedHabitIds.add(habit.value);
    plannedTimes.push(Object.freeze({ habitId: habit.value, plannedLocalTime: time.value, plannedDurationMinutes: duration.value, plannedBlock: block.value }));
  }

  const facts = [];
  for (const row of rows.observations) {
    const mapped = mapHabitObservationRow(row);
    if (!mapped.ok) return occurrenceIntegrity(mapped.error);
    facts.push(mapped.value);
  }
  const chains = reconstructObservationChains(facts);
  if (!chains.ok) return occurrenceIntegrity(chains.error);

  return success(Object.freeze({
    selectedLocalDate,
    createdHabitCount: createdHabitCountRow.count,
    progressMode: preferenceRow.progress_mode,
    habits: Object.freeze(habits),
    scheduleVersions: Object.freeze(schedules),
    trackingVersions: Object.freeze(tracking),
    importanceVersions: Object.freeze(importance),
    relationships: relationships.value,
    ordinaryParents: Object.freeze(ordinaryParents),
    plannedTimes: Object.freeze(plannedTimes),
    visualIdentities: Object.freeze(visualIdentities),
    observationChains: chains.value,
  }));
}

function occurrenceDatabaseFailure<T>(operation: string, cause: unknown): Result<T, PlannerPersistenceError> {
  return failure(createPlannerPersistenceError(
    'occurrence_read_model_database_failure',
    'The selected-date Planner data could not be read.',
    { operation, cause },
  ));
}

function occurrenceIntegrity<T>(
  cause: unknown,
): Result<T, PlannerPersistenceError> {
  return failure(
    createPlannerPersistenceError(
      'occurrence_read_model_data_integrity_failure',
      'The selected-date Planner data is inconsistent.',
      { operation: 'loadPlannerOccurrenceData', cause },
    ),
  );
}
