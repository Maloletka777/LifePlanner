import assert from 'node:assert/strict';

import {
  createAddHabitDependency,
  createCorrectHabitObservation,
  createCreateHabit,
  createGetPlannerOccurrencesForDate,
  createGetPlannerDateSummariesForRange,
  createRecordHabitObservation,
  createListPlannerHabits,
  createGetPlannerHabitDetail,
  createArchiveHabit,
  createRestoreHabit,
  createPermanentlyDeleteHabit,
  createPreviewDeleteHabitChain,
  createDeleteHabitChain,
  createEditHabit,
  createChangeOrdinaryParent,
  createCreateHabitBundle,
  createGetRoutineConversionPreview,
  createConvertOrganizationalParentToRoutine,
  createGetPlannerScheduleSummaryForDate,
  createGetLikelyHabitDuplicates,
  type AddHabitDependency,
  type Clock,
  type CorrectHabitObservation,
  type CreateHabit,
  type CreateHabitCommand,
  type IdGenerator,
  type GetPlannerOccurrencesForDate,
  type GetPlannerDateSummariesForRange,
  type RecordHabitObservation,
  type ListPlannerHabits,
  type GetPlannerHabitDetail,
  type EditHabit,
  type ChangeOrdinaryParent,
  type CreateHabitBundle,
  type GetRoutineConversionPreview,
  type ConvertOrganizationalParentToRoutine,
  type GetPlannerScheduleSummaryForDate,
  type GetLikelyHabitDuplicates,
} from '../../../src/features/planner/application';
import {
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  parsePlannerTimezone,
  validateScheduleDefinition,
  validateTrackingDefinition,
  type PlannerId,
  type Result,
  type ScheduleDefinition,
  type TrackingDefinition,
} from '../../../src/features/planner/domain';
import {
  createSqlitePlannerUnitOfWork,
  type PlannerDatabaseAccess,
} from '../../../src/features/planner/infrastructure/sqlite';
import type { PlannerUnitOfWork } from '../../../src/features/planner/repositories';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

export const FIXED_NOW = 1_789_000_000_000;
export const ACTIVE_FROM = domainValue(parsePlannerLocalDate('2026-08-01'));
export const ACTIVE_TO = domainValue(parsePlannerLocalDate('2026-09-01'));
export const LONDON = domainValue(parsePlannerTimezone('Europe/London'));
export const REMINDER_TIME = domainValue(parsePlannerLocalTime('18:00'));
export const ACTIVE_CATEGORY_ID = plannerId(900);

export interface TestHarness {
  readonly database: NodeSqliteTestDatabase;
  readonly unitOfWork: PlannerUnitOfWork;
  readonly idGenerator: SequentialIdGenerator;
  readonly createHabit: CreateHabit;
  readonly addHabitDependency: AddHabitDependency;
  readonly recordHabitObservation: RecordHabitObservation;
  readonly correctHabitObservation: CorrectHabitObservation;
  readonly getPlannerOccurrencesForDate: GetPlannerOccurrencesForDate;
  readonly getPlannerDateSummariesForRange: GetPlannerDateSummariesForRange;
  readonly listPlannerHabits: ListPlannerHabits;
  readonly getPlannerHabitDetail: GetPlannerHabitDetail;
  readonly archiveHabit: ReturnType<typeof createArchiveHabit>;
  readonly restoreHabit: ReturnType<typeof createRestoreHabit>;
  readonly permanentlyDeleteHabit: ReturnType<typeof createPermanentlyDeleteHabit>;
  readonly previewDeleteHabitChain: ReturnType<typeof createPreviewDeleteHabitChain>;
  readonly deleteHabitChain: ReturnType<typeof createDeleteHabitChain>;
  readonly editHabit: EditHabit;
  readonly changeOrdinaryParent: ChangeOrdinaryParent;
  readonly createHabitBundle: CreateHabitBundle;
  readonly getRoutineConversionPreview: GetRoutineConversionPreview;
  readonly convertOrganizationalParentToRoutine: ConvertOrganizationalParentToRoutine;
  readonly getPlannerScheduleSummaryForDate: GetPlannerScheduleSummaryForDate;
  readonly getLikelyHabitDuplicates: GetLikelyHabitDuplicates;
}

export class SequentialIdGenerator implements IdGenerator {
  #next: number;

  constructor(start = 1) {
    this.#next = start;
  }

  generateId(): string {
    const value = plannerId(this.#next);
    this.#next += 1;
    return value;
  }
}

export async function createHarness(startId = 1): Promise<TestHarness> {
  const database = new NodeSqliteTestDatabase();
  await database.migrate();
  await database.runAsync(
    `INSERT INTO planner_preferences(id,progress_mode,created_at,updated_at)
     VALUES(1,'equal',$now,$now);`,
    { $now: FIXED_NOW },
  );
  return createHarnessForDatabase(database, startId);
}

export function createHarnessForDatabase(database: NodeSqliteTestDatabase, startId = 1): TestHarness {
  const access: PlannerDatabaseAccess = (operation) => operation(database);
  const unitOfWork = createSqlitePlannerUnitOfWork(access);
  const idGenerator = new SequentialIdGenerator(startId);
  const clock: Clock = { nowEpochMilliseconds: () => FIXED_NOW };
  return {
    database,
    unitOfWork,
    idGenerator,
    createHabit: createCreateHabit({ unitOfWork, idGenerator, clock }),
    addHabitDependency: createAddHabitDependency({
      unitOfWork,
      idGenerator,
      clock,
    }),
    recordHabitObservation: createRecordHabitObservation({
      unitOfWork,
      idGenerator,
      clock,
    }),
    correctHabitObservation: createCorrectHabitObservation({
      unitOfWork,
      idGenerator,
      clock,
    }),
    getPlannerOccurrencesForDate: createGetPlannerOccurrencesForDate({
      unitOfWork,
    }),
    getPlannerDateSummariesForRange: createGetPlannerDateSummariesForRange({
      unitOfWork,
    }),
    listPlannerHabits: createListPlannerHabits({ unitOfWork }),
    getPlannerHabitDetail: createGetPlannerHabitDetail({ unitOfWork }),
    archiveHabit: createArchiveHabit({ unitOfWork, idGenerator, clock }),
    restoreHabit: createRestoreHabit({ unitOfWork, idGenerator, clock }),
    permanentlyDeleteHabit: createPermanentlyDeleteHabit({ unitOfWork, idGenerator, clock }),
    previewDeleteHabitChain: createPreviewDeleteHabitChain({ unitOfWork }),
    deleteHabitChain: createDeleteHabitChain({ unitOfWork, idGenerator, clock }),
    editHabit: createEditHabit({ unitOfWork, idGenerator, clock }),
    changeOrdinaryParent: createChangeOrdinaryParent({ unitOfWork, idGenerator, clock }),
    createHabitBundle: createCreateHabitBundle({ unitOfWork, idGenerator, clock }),
    getRoutineConversionPreview: createGetRoutineConversionPreview({ unitOfWork }),
    convertOrganizationalParentToRoutine: createConvertOrganizationalParentToRoutine({ unitOfWork, idGenerator, clock }),
    getPlannerScheduleSummaryForDate: createGetPlannerScheduleSummaryForDate({ unitOfWork }),
    getLikelyHabitDuplicates: createGetLikelyHabitDuplicates({ unitOfWork }),
  };
}

export function baseCommand(
  overrides: Partial<CreateHabitCommand> = {},
): CreateHabitCommand {
  return {
    name: 'Read',
    description: null,
    categoryId: null,
    activeFrom: ACTIVE_FROM,
    activeTo: ACTIVE_TO,
    schedule: scheduleFixture('daily'),
    tracking: trackingFixture('checkbox'),
    importance: 'normal',
    reminder: null,
    ...overrides,
  };
}

export function scheduleFixture(
  scheduleType:
    | 'daily'
    | 'selected_weekdays'
    | 'every_n_days'
    | 'times_per_week'
    | 'times_per_month'
    | 'times_per_year'
    | 'weekly'
    | 'monthly'
    | 'yearly',
  effectiveFrom = ACTIVE_FROM,
  effectiveTo: typeof ACTIVE_TO | null = ACTIVE_TO,
): ScheduleDefinition {
  const base = {
    scheduleType,
    effectiveFrom,
    effectiveTo,
    evaluationTimezone: LONDON,
  };
  switch (scheduleType) {
    case 'daily':
      return domainValue(validateScheduleDefinition(base));
    case 'selected_weekdays':
      return domainValue(validateScheduleDefinition({ ...base, weekdaysMask: 21 }));
    case 'every_n_days':
      return domainValue(validateScheduleDefinition({ ...base, intervalDays: 2, anchorDate: ACTIVE_FROM }));
    case 'times_per_week':
      return domainValue(validateScheduleDefinition({ ...base, periodTargetCount: 3, weekStart: 1 }));
    case 'times_per_month':
    case 'times_per_year':
      return domainValue(validateScheduleDefinition({ ...base, periodTargetCount: 4 }));
    case 'weekly':
      return domainValue(validateScheduleDefinition({ ...base, weekday: 3, weekStart: 1 }));
    case 'monthly':
      return domainValue(validateScheduleDefinition({ ...base, monthDay: 31 }));
    case 'yearly':
      return domainValue(validateScheduleDefinition({ ...base, monthNumber: 2, monthDay: 29 }));
  }
}

export function trackingFixture(
  trackingMode: 'checkbox' | 'counter' | 'quantity' | 'duration' | 'avoidance',
  effectiveFrom = ACTIVE_FROM,
  effectiveTo: typeof ACTIVE_TO | null = ACTIVE_TO,
): TrackingDefinition {
  const base = {
    trackingMode,
    effectiveFrom,
    effectiveTo,
  };
  switch (trackingMode) {
    case 'checkbox':
    case 'avoidance':
      return domainValue(validateTrackingDefinition({ ...base, comparisonOperator: 'boolean_success' }));
    case 'counter':
      return domainValue(validateTrackingDefinition({ ...base, comparisonOperator: 'at_least', target: { significand: 3n, scale: 0 }, unit: { unitType: 'standard', standardUnitCode: 'session' } }));
    case 'quantity':
      return domainValue(validateTrackingDefinition({ ...base, comparisonOperator: 'at_least', target: { significand: 200n, scale: 2 }, unit: { unitType: 'standard', standardUnitCode: 'litre' } }));
    case 'duration':
      return domainValue(validateTrackingDefinition({ ...base, comparisonOperator: 'at_least', targetDurationSeconds: 2700, unit: { unitType: 'standard', standardUnitCode: 'second' } }));
  }
}

export function plannerId(value: number): PlannerId {
  const raw = `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  return domainValue(parsePlannerId(raw));
}

export function domainValue<T, E>(result: Result<T, E>): T {
  if (!result.ok) assert.fail('Expected a valid domain fixture.');
  return result.value;
}

export async function insertCategory(
  database: NodeSqliteTestDatabase,
  lifecycle: 'active' | 'archived',
  id = ACTIVE_CATEGORY_ID,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO habit_categories (
      id, name, normalized_name, sort_order, lifecycle,
      created_at, updated_at, archived_at
    ) VALUES (
      $id, 'Health', 'health', 0, $lifecycle,
      $now, $now, $archivedAt
    );`,
    {
      $id: id,
      $lifecycle: lifecycle,
      $now: FIXED_NOW,
      $archivedAt: lifecycle === 'archived' ? FIXED_NOW : null,
    },
  );
}

export async function tableCount(
  database: NodeSqliteTestDatabase,
  table:
    | 'habits'
    | 'habit_schedule_versions'
    | 'habit_tracking_versions'
    | 'habit_importance_versions'
    | 'habit_reminders'
    | 'habit_dependency_versions'
    | 'habit_ordinary_parent_versions'
    | 'habit_planned_time_versions'
    | 'habit_visual_identities'
    | 'habit_lifecycle_transitions'
    | 'habit_observations'
    | 'daily_focus_entries'
    | 'daily_focus_items',
): Promise<number> {
  const row = await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM ${table};`);
  return row?.count ?? -1;
}
