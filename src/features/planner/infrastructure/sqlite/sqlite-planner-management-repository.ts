import {
  failure,
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerDayBlock,
  parsePlannerDurationMinutes,
  parsePlannerLocalTime,
  parsePlannerTimezone,
  resolveHabitLifecycleAsOf,
  success,
  type HabitLifecycleAsOfTransitionInput,
  type EffectiveRange,
  type PlannerId,
  type PlannerLocalDate,
  type PlannerLocalTime,
  type Result,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type HabitImportanceVersion,
  type HabitReminderIntent,
  type HabitScheduleVersion,
  type HabitTrackingVersion,
  type HabitVisualIdentityRecord,
  type ListPlannerHabitsInput,
  type PlannerHabitCatalogueItem,
  type PlannerHabitDependencyDetail,
  type PlannerHabitDetail,
  type PlannerHabitIdentity,
  type PlannerHabitPlannedTimeVersion,
  type PlannerHabitOrdinaryRelationshipDetail,
  type PlannerHabitConfigurationSnapshot,
  type PlannerHabitTemporalContext,
  type PlannerPersistenceError,
} from '../../repositories';
import { mapDependencyGraphRows, mapHabitDependencyRow } from './planner-dependency-row-mappers';
import { mapHabitObservationRow } from './planner-observation-row-mappers';
import {
  mapHabitRow,
  mapHabitVisualIdentityRow,
  mapImportanceRow,
  mapReminderRow,
  mapScheduleRow,
  mapTrackingRow,
} from './planner-row-mappers';
import type {
  HabitDependencyVersionRow,
  HabitImportanceVersionRow,
  HabitObservationRow,
  HabitReminderRow,
  HabitRow,
  HabitScheduleVersionRow,
  HabitTrackingVersionRow,
  HabitVisualIdentityRow,
} from './planner-row-types';
import { reconstructObservationChains } from './sqlite-habit-observation-repository';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

interface CategoryRow { readonly id: unknown; readonly name: unknown; }
interface LifecycleRow { readonly habit_id: unknown; readonly sequence_number: unknown; readonly lifecycle: unknown; readonly effective_local_date: unknown; readonly boundary_timezone: unknown; readonly transitioned_at: unknown; readonly created_at: unknown; }

interface ManagementData {
  readonly habits: readonly PlannerHabitIdentity[];
  readonly categories: ReadonlyMap<PlannerId, string>;
  readonly schedules: readonly Owned<HabitScheduleVersion>[];
  readonly tracking: readonly Owned<HabitTrackingVersion>[];
  readonly importance: readonly Owned<HabitImportanceVersion>[];
  readonly plannedTimes: readonly Owned<PlannerHabitPlannedTimeVersion>[];
  readonly ordinaryRelationships: readonly PlannerHabitOrdinaryRelationshipDetail[];
  readonly reminders: readonly Owned<HabitReminderIntent>[];
  readonly dependencies: readonly PlannerHabitDependencyDetail[];
  readonly observations: PlannerHabitDetail['observationHistory'];
  readonly lifecycleTransitions: readonly Owned<HabitLifecycleAsOfTransitionInput>[];
}

interface Owned<T> { readonly habitId: PlannerId; readonly model: T; }

export async function listPlannerHabits(
  database: PlannerSqliteDatabase,
  input: ListPlannerHabitsInput,
): Promise<Result<readonly PlannerHabitCatalogueItem[], PlannerPersistenceError>> {
  const loaded = await loadManagementData(database);
  if (!loaded.ok) return loaded;
  const search = normalize(input.searchText ?? '');
  const lifecycle = input.lifecycle ?? 'all';
  const items: PlannerHabitCatalogueItem[] = [];
  for (const habit of loaded.value.habits) {
    if (lifecycle !== 'all' && habit.lifecycle !== lifecycle) continue;
    if (search !== '' && !normalize(habit.name).includes(search)) continue;
    const schedules = ownedFor(loaded.value.schedules, habit.id);
    const tracking = ownedFor(loaded.value.tracking, habit.id);
    const importance = ownedFor(loaded.value.importance, habit.id);
    const incoming = loaded.value.dependencies.filter(({ version }) => version.dependentHabitId === habit.id);
    const outgoing = loaded.value.dependencies.filter(({ version }) => version.parentHabitId === habit.id);
    const temporalContext = resolveTemporalContext(loaded.value, habit, input.asOfLocalDate);
    if (!temporalContext.ok) return temporalContext;
    const display = temporalContext.value.displayConfiguration;
    const relevantTimes = [habit.updatedAt, habit.visualIdentity.updatedAt, ...schedules.map((v) => v.updatedAt), ...tracking.map((v) => v.updatedAt), ...importance.map((v) => v.updatedAt), ...incoming.map((v) => v.version.updatedAt), ...outgoing.map((v) => v.version.updatedAt)];
    items.push(Object.freeze({
      habitId: habit.id,
      name: habit.name,
      description: habit.description,
      lifecycle: habit.lifecycle,
      archivedAt: habit.archivedAt,
      activeRange: habit.activeRange,
      visualIdentity: habit.visualIdentity,
      temporalContext: temporalContext.value,
      categoryName: habit.categoryId === null ? null : loaded.value.categories.get(habit.categoryId) ?? null,
      schedule: display.schedule,
      inheritsOccurrence: display.inheritsOccurrence,
      needsSchedule: display.needsSchedule,
      tracking: display.tracking,
      importance: display.importance,
      plannedLocalTime: display.plannedTime.plannedLocalTime,
      // The same rows the detail read model already asks for, one level further
      // out — `loadManagementData` loads them either way, so a catalogue that
      // knows about reminders costs no query and no column.
      reminderLocalTime: activeReminderTime(loaded.value.reminders, habit.id),
      reminderId: activeReminderId(loaded.value.reminders, habit.id),
      ordinaryParentHabitId: display.ordinaryParent?.parentHabitId ?? null,
      ordinaryParentName: display.ordinaryParent?.parentName ?? null,
      ordinaryChildCount: display.ordinaryChildren.length,
      parentCount: incoming.length,
      dependentCount: outgoing.length,
      hasObservations: loaded.value.observations.some((chain) => chain.root.habitId === habit.id),
      createdAt: habit.createdAt,
      latestRelevantUpdateTimestamp: Math.max(...relevantTimes),
      stableSortKey: `${normalize(habit.name)}\u0000${habit.id}`,
    }));
  }
  items.sort((left, right) =>
    lifecycleRank(left.lifecycle) - lifecycleRank(right.lifecycle) ||
    Number(left.activeRange.effectiveTo !== null) - Number(right.activeRange.effectiveTo !== null) ||
    left.stableSortKey.localeCompare(right.stableSortKey),
  );
  return success(Object.freeze(items));
}

export async function getPlannerHabitDetail(
  database: PlannerSqliteDatabase,
  habitId: PlannerId,
  asOfLocalDate: PlannerLocalDate,
): Promise<Result<PlannerHabitDetail | null, PlannerPersistenceError>> {
  const loaded = await loadManagementData(database);
  if (!loaded.ok) return loaded;
  const habit = loaded.value.habits.find(({ id }) => id === habitId);
  if (habit === undefined) return success(null);
  const schedules = ownedFor(loaded.value.schedules, habit.id);
  const tracking = ownedFor(loaded.value.tracking, habit.id);
  const importance = ownedFor(loaded.value.importance, habit.id);
  const plannedTimes = ownedFor(loaded.value.plannedTimes, habit.id);
  const incoming = loaded.value.dependencies.filter(({ version }) => version.dependentHabitId === habit.id);
  const outgoing = loaded.value.dependencies.filter(({ version }) => version.parentHabitId === habit.id);
  const temporalContext = resolveTemporalContext(loaded.value, habit, asOfLocalDate);
  if (!temporalContext.ok) return temporalContext;
  const display = temporalContext.value.displayConfiguration;
  const ordinaryHistory = loaded.value.ordinaryRelationships.filter((relationship) => relationship.parentHabitId === habit.id || relationship.childHabitId === habit.id);
  return success(Object.freeze({
    habit,
    temporalContext: temporalContext.value,
    categoryName: habit.categoryId === null ? null : loaded.value.categories.get(habit.categoryId) ?? null,
    currentSchedule: display.schedule,
    inheritsOccurrence: display.inheritsOccurrence,
    currentTracking: display.tracking,
    currentImportance: display.importance,
    currentPlannedTime: display.plannedTime,
    ordinaryParent: display.ordinaryParent,
    ordinaryChildren: display.ordinaryChildren,
    currentReminders: Object.freeze(ownedFor(loaded.value.reminders, habit.id).filter((reminder) => reminder.lifecycle === 'active')),
    incomingDependencies: display.incomingDependencies,
    outgoingDependencies: Object.freeze(outgoing.filter(({ version }) => contains(version.effectiveRange, asOfLocalDate))),
    scheduleHistory: Object.freeze(schedules),
    trackingHistory: Object.freeze(tracking),
    importanceHistory: Object.freeze(importance),
    plannedTimeHistory: Object.freeze(plannedTimes),
    ordinaryRelationshipHistory: Object.freeze(ordinaryHistory),
    dependencyHistory: Object.freeze([...incoming, ...outgoing].sort((a, b) => compareRanges(a.version.effectiveRange, b.version.effectiveRange) || a.version.id.localeCompare(b.version.id))),
    observationHistory: Object.freeze(loaded.value.observations.filter((chain) => chain.root.habitId === habit.id).sort((a, b) => b.root.observedAt - a.root.observedAt || a.root.id.localeCompare(b.root.id))),
  }));
}

async function loadManagementData(database: PlannerSqliteDatabase): Promise<Result<ManagementData, PlannerPersistenceError>> {
  try {
    const [habitRows, visualIdentityRows, categoryRows, scheduleRows, trackingRows, importanceRows, plannedTimeRows, ordinaryRows, reminderRows, dependencyRows, observationRows, lifecycleRows] = await Promise.all([
      database.getAllAsync<HabitRow>('SELECT * FROM habits ORDER BY id;'),
      database.getAllAsync<HabitVisualIdentityRow>('SELECT * FROM habit_visual_identities ORDER BY habit_id;'),
      database.getAllAsync<CategoryRow>('SELECT id, name FROM habit_categories ORDER BY id;'),
      database.getAllAsync<HabitScheduleVersionRow>('SELECT * FROM habit_schedule_versions ORDER BY habit_id, effective_from, version_number, id;'),
      database.getAllAsync<HabitTrackingVersionRow>('SELECT * FROM habit_tracking_versions ORDER BY habit_id, effective_from, version_number, id;'),
      database.getAllAsync<HabitImportanceVersionRow>('SELECT * FROM habit_importance_versions ORDER BY habit_id, effective_from, version_number, id;'),
      database.getAllAsync<Record<string, unknown>>('SELECT * FROM habit_planned_time_versions ORDER BY habit_id, effective_from, version_number, id;'),
      database.getAllAsync<Record<string, unknown>>('SELECT * FROM habit_ordinary_parent_versions ORDER BY effective_from, relationship_id, version_number, id;'),
      database.getAllAsync<HabitReminderRow>('SELECT * FROM habit_reminders ORDER BY habit_id, trigger_local_time, id;'),
      database.getAllAsync<HabitDependencyVersionRow>('SELECT * FROM habit_dependency_versions ORDER BY effective_from, relationship_id, version_number, id;'),
      database.getAllAsync<HabitObservationRow>('SELECT * FROM habit_observations ORDER BY habit_id, created_at, id;'),
      database.getAllAsync<LifecycleRow>('SELECT habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at FROM habit_lifecycle_transitions ORDER BY habit_id,sequence_number;'),
    ]);
    const visualIdentities = new Map<PlannerId, HabitVisualIdentityRecord>();
    for (const row of visualIdentityRows) {
      const mapped = mapHabitVisualIdentityRow(row);
      if (!mapped.ok) return managementIntegrity('A habit visual identity is malformed.');
      if (visualIdentities.has(mapped.value.habitId)) return managementIntegrity('A habit visual identity is duplicated.');
      visualIdentities.set(mapped.value.habitId, mapped.value);
    }
    const habits: PlannerHabitIdentity[] = [];
    for (const row of habitRows) {
      const mapped = mapHabitRow(row);
      if (!mapped.ok) return managementIntegrity(mapped.error.message);
      const visualIdentity = visualIdentities.get(mapped.value.id);
      if (visualIdentity === undefined) return managementIntegrity('A habit is missing its visual identity.');
      habits.push(Object.freeze({ ...mapped.value, archivedAt: mapped.value.lifecycle === 'archived' ? Number(row.archived_at) : null, visualIdentity }));
    }
    if (visualIdentities.size !== habits.length) return managementIntegrity('A visual identity references a missing habit.');
    const names = new Map(habits.map((habit) => [habit.id, habit.name] as const));
    const categories = new Map<PlannerId, string>();
    for (const row of categoryRows) {
      const categoryId = parsePlannerId(row.id, 'category.id');
      if (!categoryId.ok || typeof row.name !== 'string' || row.name.trim() !== row.name || row.name === '') return managementIntegrity('A category row is malformed.');
      categories.set(categoryId.value, row.name);
    }
    const schedules = mapOwned(scheduleRows, mapScheduleRow); if (!schedules.ok) return schedules;
    const tracking = mapOwned(trackingRows, mapTrackingRow); if (!tracking.ok) return tracking;
    const importance = mapOwned(importanceRows, mapImportanceRow); if (!importance.ok) return importance;
    const plannedTimes: Owned<PlannerHabitPlannedTimeVersion>[] = [];
    for (const row of plannedTimeRows) {
      const mapped = mapPlannedTime(row); if (!mapped.ok) return mapped; plannedTimes.push(mapped.value);
    }
    const reminders: Owned<HabitReminderIntent>[] = [];
    for (const row of reminderRows) { const mapped = mapReminderRow(row); if (!mapped.ok) return managementIntegrity(mapped.error.message); reminders.push(mapped.value); }
    const dependencies: PlannerHabitDependencyDetail[] = [];
    const dependencyGraph = mapDependencyGraphRows(dependencyRows);
    if (!dependencyGraph.ok) return managementIntegrity(dependencyGraph.error.message);
    for (const row of dependencyRows) {
      const mapped = mapHabitDependencyRow(row); if (!mapped.ok) return managementIntegrity(mapped.error.message);
      const parentName = names.get(mapped.value.parentHabitId); const dependentName = names.get(mapped.value.dependentHabitId);
      if (parentName === undefined || dependentName === undefined) return managementIntegrity('A dependency references a missing habit.');
      dependencies.push(Object.freeze({ version: mapped.value, parentName, dependentName }));
    }
    const ordinaryRelationships: PlannerHabitOrdinaryRelationshipDetail[] = [];
    for (const row of ordinaryRows) {
      const mapped = mapOrdinaryRelationship(row, names); if (!mapped.ok) return mapped; ordinaryRelationships.push(mapped.value);
    }
    const facts = [];
    for (const row of observationRows) { const mapped = mapHabitObservationRow(row); if (!mapped.ok) return managementIntegrity(mapped.error.message); facts.push(mapped.value); }
    const chains = reconstructObservationChains(facts); if (!chains.ok) return managementIntegrity(chains.error.message);
    const lifecycleTransitions: Owned<HabitLifecycleAsOfTransitionInput>[] = [];
    for (const row of lifecycleRows) {
      const mapped = mapLifecycleTransition(row); if (!mapped.ok) return mapped; lifecycleTransitions.push(mapped.value);
    }
    for (const habit of habits) {
      if (habit.categoryId !== null && !categories.has(habit.categoryId)) return managementIntegrity('A habit references a missing category.');
      if (!validateHistory(ownedFor(schedules.value, habit.id)) || !validateHistory(ownedFor(tracking.value, habit.id)) || !validateHistory(ownedFor(importance.value, habit.id)) || !validateHistory(ownedFor(plannedTimes, habit.id))) return managementIntegrity('Effective-dated configuration versions overlap or conflict.');
    }
    return success(Object.freeze({ habits: Object.freeze(habits), categories, schedules: schedules.value, tracking: tracking.value, importance: importance.value, plannedTimes: Object.freeze(plannedTimes), ordinaryRelationships: Object.freeze(ordinaryRelationships), reminders: Object.freeze(reminders), dependencies: Object.freeze(dependencies), observations: chains.value, lifecycleTransitions: Object.freeze(lifecycleTransitions) }));
  } catch (cause: unknown) {
    return failure(createPlannerPersistenceError('database_failure', 'Planner management data could not be read.', { operation: 'loadPlannerManagementData', cause }));
  }
}

function mapOwned<R, T>(rows: readonly R[], mapper: (row: R) => Result<Owned<T>, PlannerPersistenceError>): Result<readonly Owned<T>[], PlannerPersistenceError> {
  const values: Owned<T>[] = [];
  for (const row of rows) { const mapped = mapper(row); if (!mapped.ok) return managementIntegrity(mapped.error.message); values.push(mapped.value); }
  return success(Object.freeze(values));
}
function ownedFor<T>(values: readonly Owned<T>[], habitId: PlannerId): T[] { return values.filter((value) => value.habitId === habitId).map((value) => value.model); }

/**
 * The one reminder a habit is actually going to be woken by, or none.
 *
 * Both conditions are the stored ones and neither is inferred: an archived
 * reminder is history and a disabled one is switched off, so only an `active`,
 * `enabled` row counts. Persistence rejects a second active reminder on an
 * initial habit, so taking the earliest is a tie-break that should never be
 * reached rather than a policy about multiple reminders.
 */
function activeReminderTime(reminders: readonly Owned<HabitReminderIntent>[], habitId: PlannerId): PlannerLocalTime | null {
  const live = ownedFor(reminders, habitId)
    .filter((reminder) => reminder.lifecycle === 'active' && reminder.enabled)
    .map((reminder) => reminder.triggerLocalTime)
    .sort();
  return live[0] ?? null;
}

/**
 * Which reminder the catalogue's own time came from.
 *
 * The same live rows, ordered the same way, so the id and the minute can never disagree
 * about which reminder they describe.
 */
function activeReminderId(reminders: readonly Owned<HabitReminderIntent>[], habitId: PlannerId): PlannerId | null {
  const live = ownedFor(reminders, habitId)
    .filter((reminder) => reminder.lifecycle === 'active' && reminder.enabled)
    .sort((left, right) => left.triggerLocalTime.localeCompare(right.triggerLocalTime));
  return live[0]?.id ?? null;
}

function resolveTemporalContext(
  data: ManagementData,
  habit: PlannerHabitIdentity,
  asOfLocalDate: PlannerLocalDate,
): Result<PlannerHabitTemporalContext, PlannerPersistenceError> {
  const lifecycle = resolveHabitLifecycleAsOf({
    activeRange: habit.activeRange,
    aggregateLifecycle: habit.lifecycle,
    asOfLocalDate,
    transitions: ownedFor(data.lifecycleTransitions, habit.id),
  });
  if (!lifecycle.ok) return managementIntegrity(lifecycle.error.message);
  const asOfConfiguration = configurationSnapshotAt(data, habit.id, asOfLocalDate);
  if (!asOfConfiguration.ok) return asOfConfiguration;
  const futureBoundaries = configurationBoundaryDates(data, habit.id).filter((date) => date > asOfLocalDate);
  const nextBoundary = futureBoundaries.sort()[0] ?? null;
  const nextEffectiveConfiguration = nextBoundary === null
    ? success(null)
    : configurationSnapshotAt(data, habit.id, nextBoundary);
  if (!nextEffectiveConfiguration.ok) return nextEffectiveConfiguration;
  const historicalBoundaries = configurationBoundaryDates(data, habit.id).filter((date) => date <= asOfLocalDate);
  const historicalBoundary = historicalBoundaries.sort().reverse()[0] ?? null;
  const latestHistoricalConfiguration = historicalBoundary === null
    ? success(null)
    : configurationSnapshotAt(data, habit.id, historicalBoundary);
  if (!latestHistoricalConfiguration.ok) return latestHistoricalConfiguration;
  const display = asOfConfiguration.value !== null
    ? { configuration: asOfConfiguration.value, relation: 'as_of' as const }
    : lifecycle.value.isPreActive && nextEffectiveConfiguration.value !== null
      ? { configuration: nextEffectiveConfiguration.value, relation: 'next_effective' as const }
      : latestHistoricalConfiguration.value !== null
        ? { configuration: latestHistoricalConfiguration.value, relation: 'latest_historical' as const }
        : null;
  if (display === null) return managementIntegrity('A habit is missing required configuration history.');
  return success(Object.freeze({
    ...lifecycle.value,
    asOfConfiguration: asOfConfiguration.value,
    nextEffectiveConfiguration: nextEffectiveConfiguration.value,
    displayConfiguration: display.configuration,
    displayConfigurationTemporalRelation: display.relation,
  }));
}

function configurationSnapshotAt(
  data: ManagementData,
  habitId: PlannerId,
  date: PlannerLocalDate,
): Result<PlannerHabitConfigurationSnapshot | null, PlannerPersistenceError> {
  const schedule = selectApplicable(ownedFor(data.schedules, habitId), date, 'schedule', habitId);
  const tracking = selectApplicable(ownedFor(data.tracking, habitId), date, 'tracking', habitId);
  const importance = selectApplicable(ownedFor(data.importance, habitId), date, 'importance', habitId);
  const plannedTime = selectApplicable(ownedFor(data.plannedTimes, habitId), date, 'planned time', habitId);
  if (!schedule.ok || !tracking.ok || !importance.ok || !plannedTime.ok) return managementIntegrity('Habit configuration history is inconsistent.');
  const required = [tracking.value, importance.value, plannedTime.value];
  if (required.every((value) => value === null)) return success(null);
  if (tracking.value === null || importance.value === null || plannedTime.value === null) return managementIntegrity('A habit is missing required configuration history.');
  const incomingDependencies = data.dependencies.filter(({ version }) => version.dependentHabitId === habitId && contains(version.effectiveRange, date));
  const ordinaryParent = data.ordinaryRelationships.filter((relationship) => relationship.childHabitId === habitId && contains(relationship.effectiveRange, date));
  const ordinaryChildren = data.ordinaryRelationships.filter((relationship) => relationship.parentHabitId === habitId && contains(relationship.effectiveRange, date));
  if (incomingDependencies.length > 1) return managementIntegrity('A habit has ambiguous current occurrence configuration.');
  if (ordinaryParent.length > 1) return managementIntegrity('A habit has ambiguous ordinary-parent configuration.');
  return success(Object.freeze({
    effectiveLocalDate: date,
    schedule: schedule.value,
    tracking: tracking.value,
    importance: importance.value,
    plannedTime: plannedTime.value,
    inheritsOccurrence: incomingDependencies.length === 1,
    needsSchedule: incomingDependencies.length === 0 && schedule.value === null,
    ordinaryParent: ordinaryParent[0] ?? null,
    ordinaryChildren: Object.freeze(ordinaryChildren),
    incomingDependencies: Object.freeze(incomingDependencies),
  }));
}

function configurationBoundaryDates(data: ManagementData, habitId: PlannerId): PlannerLocalDate[] {
  return [...new Set([
    ...ownedFor(data.schedules, habitId).map((value) => value.definition.effectiveRange.effectiveFrom),
    ...ownedFor(data.tracking, habitId).map((value) => value.definition.effectiveRange.effectiveFrom),
    ...ownedFor(data.importance, habitId).map((value) => value.effectiveRange.effectiveFrom),
    ...ownedFor(data.plannedTimes, habitId).map((value) => value.effectiveRange.effectiveFrom),
    ...data.dependencies.filter(({ version }) => version.parentHabitId === habitId || version.dependentHabitId === habitId).map(({ version }) => version.effectiveRange.effectiveFrom),
    ...data.ordinaryRelationships.filter((relationship) => relationship.parentHabitId === habitId || relationship.childHabitId === habitId).map((relationship) => relationship.effectiveRange.effectiveFrom),
  ])];
}

function selectApplicable<T extends HabitScheduleVersion | HabitTrackingVersion | HabitImportanceVersion | PlannerHabitPlannedTimeVersion>(values: readonly T[], date: PlannerLocalDate, label: string, habitId: PlannerId): Result<T | null, PlannerPersistenceError> {
  const applicable = values.filter((value) => contains(rangeOf(value), date));
  if (applicable.length > 1) return managementIntegrity(`Multiple current ${label} versions exist for ${habitId}.`);
  return success(applicable[0] ?? null);
}
function rangeOf(value: HabitScheduleVersion | HabitTrackingVersion | HabitImportanceVersion | PlannerHabitPlannedTimeVersion): EffectiveRange { return 'definition' in value ? value.definition.effectiveRange : value.effectiveRange; }
function validateHistory(values: readonly (HabitScheduleVersion | HabitTrackingVersion | HabitImportanceVersion | PlannerHabitPlannedTimeVersion)[]): boolean {
  const versions = new Set<number>();
  for (let index = 0; index < values.length; index += 1) {
    if (versions.has(values[index].versionNumber)) return false; versions.add(values[index].versionNumber);
    for (let other = index + 1; other < values.length; other += 1) if (intersects(rangeOf(values[index]), rangeOf(values[other]))) return false;
  }
  return true;
}

function mapPlannedTime(row: Record<string, unknown>): Result<Owned<PlannerHabitPlannedTimeVersion>, PlannerPersistenceError> {
  const id = parsePlannerId(row.id, 'plannedTime.id'); const habitId = parsePlannerId(row.habit_id, 'plannedTime.habitId');
  const from = parsePlannerLocalDate(row.effective_from, 'plannedTime.effectiveFrom'); const to = row.effective_to === null ? success(null) : parsePlannerLocalDate(row.effective_to, 'plannedTime.effectiveTo');
  const time = row.planned_local_time === null ? success(null) : parsePlannerLocalTime(row.planned_local_time, 'plannedTime.plannedLocalTime');
  const duration = row.planned_duration_minutes === null || row.planned_duration_minutes === undefined
    ? success(null)
    : parsePlannerDurationMinutes(row.planned_duration_minutes, 'plannedTime.plannedDurationMinutes');
  // Validated on the way out rather than trusted: the column is only constrained by a
  // CHECK, and a row written by anything but this application would otherwise arrive as
  // a block nothing draws.
  const block = row.planned_block === null || row.planned_block === undefined
    ? success(null)
    : parsePlannerDayBlock(row.planned_block, 'plannedTime.plannedBlock');
  if (!id.ok || !habitId.ok || !from.ok || !to.ok || !time.ok || !duration.ok || !block.ok || !Number.isSafeInteger(row.version_number) || !Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(row.updated_at)) return managementIntegrity('A planned-time row is malformed.');
  return success(Object.freeze({ habitId: habitId.value, model: Object.freeze({ id: id.value, versionNumber: row.version_number as number, plannedLocalTime: time.value, plannedDurationMinutes: duration.value, plannedBlock: block.value, effectiveRange: Object.freeze({ effectiveFrom: from.value, effectiveTo: to.value }), createdAt: row.created_at as number, updatedAt: row.updated_at as number }) }));
}

function mapLifecycleTransition(row: LifecycleRow): Result<Owned<HabitLifecycleAsOfTransitionInput>, PlannerPersistenceError> {
  const habitId = parsePlannerId(row.habit_id, 'lifecycle.habitId');
  const effectiveLocalDate = parsePlannerLocalDate(row.effective_local_date, 'lifecycle.effectiveLocalDate');
  const timezone = parsePlannerTimezone(row.boundary_timezone, 'lifecycle.boundaryTimezone');
  if (!habitId.ok || !effectiveLocalDate.ok || !timezone.ok ||
      (row.lifecycle !== 'active' && row.lifecycle !== 'archived') ||
      !Number.isSafeInteger(row.sequence_number) || Number(row.sequence_number) < 1 ||
      !Number.isSafeInteger(row.transitioned_at) || !Number.isSafeInteger(row.created_at)) {
    return managementIntegrity('A lifecycle transition row is malformed.');
  }
  return success(Object.freeze({
    habitId: habitId.value,
    model: Object.freeze({
      sequenceNumber: Number(row.sequence_number),
      lifecycle: row.lifecycle,
      effectiveLocalDate: effectiveLocalDate.value,
    }),
  }));
}

function mapOrdinaryRelationship(row: Record<string, unknown>, names: ReadonlyMap<PlannerId, string>): Result<PlannerHabitOrdinaryRelationshipDetail, PlannerPersistenceError> {
  const id = parsePlannerId(row.id, 'ordinary.id'); const relationshipId = parsePlannerId(row.relationship_id, 'ordinary.relationshipId'); const parent = parsePlannerId(row.parent_habit_id, 'ordinary.parentHabitId'); const child = parsePlannerId(row.child_habit_id, 'ordinary.childHabitId');
  const from = parsePlannerLocalDate(row.effective_from, 'ordinary.effectiveFrom'); const to = row.effective_to === null ? success(null) : parsePlannerLocalDate(row.effective_to, 'ordinary.effectiveTo');
  const reasons = ['scheduled_end', 'detached', 'reparented', 'parent_archived', 'child_archived'] as const;
  const reason = row.end_reason === null || reasons.includes(row.end_reason as typeof reasons[number]) ? row.end_reason as typeof reasons[number] | null : undefined;
  if (!id.ok || !relationshipId.ok || !parent.ok || !child.ok || !from.ok || !to.ok || reason === undefined || (row.completion_role !== 'organizational' && row.completion_role !== 'routine_step') || !Number.isSafeInteger(row.version_number) || !Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(row.updated_at)) return managementIntegrity('An ordinary relationship row is malformed.');
  const parentName = names.get(parent.value); const childName = names.get(child.value); if (parentName === undefined || childName === undefined) return managementIntegrity('An ordinary relationship references a missing habit.');
  return success(Object.freeze({ id: id.value, relationshipId: relationshipId.value, versionNumber: row.version_number as number, parentHabitId: parent.value, childHabitId: child.value, completionRole: row.completion_role, parentName, childName, effectiveRange: Object.freeze({ effectiveFrom: from.value, effectiveTo: to.value }), endReason: reason, createdAt: row.created_at as number, updatedAt: row.updated_at as number }));
}
function contains(range: EffectiveRange, date: PlannerLocalDate): boolean { return range.effectiveFrom <= date && (range.effectiveTo === null || range.effectiveTo > date); }
function intersects(a: EffectiveRange, b: EffectiveRange): boolean { return (a.effectiveTo === null || b.effectiveFrom < a.effectiveTo) && (b.effectiveTo === null || a.effectiveFrom < b.effectiveTo); }
function compareRanges(a: EffectiveRange, b: EffectiveRange): number { return a.effectiveFrom.localeCompare(b.effectiveFrom) || (a.effectiveTo ?? '').localeCompare(b.effectiveTo ?? ''); }
function normalize(value: string): string { return value.trim().toLocaleLowerCase('en-GB').normalize('NFKC'); }
function lifecycleRank(value: 'active' | 'archived'): number { return value === 'active' ? 0 : 1; }
function managementIntegrity<T>(message: string): Result<T, PlannerPersistenceError> { return failure(createPlannerPersistenceError('data_integrity_failure', message, { operation: 'loadPlannerManagementData' })); }
