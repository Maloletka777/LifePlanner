import {
  effectiveRangesIntersect,
  failure,
  parseDependencyEndReason,
  parseDependencyOccurrenceMode,
  parseDependencyType,
  parsePlannerId,
  success,
  validateEffectiveRange,
  type EffectiveDependencyEdge,
  type PlannerId,
  type Result,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type AddDependencyAggregatePersistenceInput,
  type DependencyHabitSummary,
  type HabitDependencyAggregate,
  type HabitDependencyVersion,
  type HabitReminderIntent,
  type PlannerPersistenceError,
} from '../../repositories';
import {
  mapHabitRow,
  mapImportanceRow,
  mapReminderRow,
  mapTrackingRow,
  trackingDefinitionToParameters,
  type MappedHabitIdentity,
} from './planner-row-mappers';
import type {
  HabitDependencyVersionRow,
  HabitImportanceVersionRow,
  HabitReminderRow,
  HabitRow,
  HabitTrackingVersionRow,
} from './planner-row-types';

export interface DependencyAggregateRows {
  readonly relationship: HabitDependencyVersionRow;
  readonly parent: HabitRow;
  readonly dependent: HabitRow;
  readonly dependentTracking: HabitTrackingVersionRow;
  readonly dependentImportance: HabitImportanceVersionRow;
  readonly dependentReminders: readonly HabitReminderRow[];
  readonly dependentScheduleCount: number;
  readonly dependentObservationCount: number;
}

export function mapHabitDependencyRow(
  row: HabitDependencyVersionRow,
): Result<HabitDependencyVersion, PlannerPersistenceError> {
  const id = parsePlannerId(row.id, 'dependency.id');
  const relationshipId = parsePlannerId(
    row.relationship_id,
    'dependency.relationshipId',
  );
  const parentHabitId = parsePlannerId(
    row.parent_habit_id,
    'dependency.parentHabitId',
  );
  const dependentHabitId = parsePlannerId(
    row.dependent_habit_id,
    'dependency.dependentHabitId',
  );
  const dependencyType = parseDependencyType(
    row.dependency_type,
    'dependency.dependencyType',
  );
  const occurrenceMode = parseDependencyOccurrenceMode(
    row.occurrence_mode,
    'dependency.occurrenceMode',
  );
  const effectiveRange = validateEffectiveRange(
    { effectiveFrom: row.effective_from, effectiveTo: row.effective_to },
    'dependency.effectiveRange',
  );
  const endReason =
    row.end_reason === null
      ? success(null)
      : parseDependencyEndReason(row.end_reason, 'dependency.endReason');
  const timestamps = parseTimestamps(row.created_at, row.updated_at);

  if (
    !id.ok ||
    !relationshipId.ok ||
    !parentHabitId.ok ||
    !dependentHabitId.ok ||
    !dependencyType.ok ||
    !occurrenceMode.ok ||
    !effectiveRange.ok ||
    !endReason.ok ||
    !isPositiveSafeInteger(row.version_number) ||
    timestamps === null
  ) {
    return integrityFailure('A persisted dependency row is malformed.');
  }
  if (parentHabitId.value === dependentHabitId.value) {
    return integrityFailure('A persisted dependency row is a self-link.');
  }
  if (
    (effectiveRange.value.effectiveTo === null && endReason.value !== null) ||
    (effectiveRange.value.effectiveTo !== null && endReason.value === null)
  ) {
    return integrityFailure(
      'A persisted dependency range and end reason are contradictory.',
    );
  }

  return success(
    Object.freeze({
      id: id.value,
      relationshipId: relationshipId.value,
      versionNumber: row.version_number,
      parentHabitId: parentHabitId.value,
      dependentHabitId: dependentHabitId.value,
      dependencyType: dependencyType.value,
      occurrenceMode: occurrenceMode.value,
      effectiveRange: effectiveRange.value,
      endReason: endReason.value,
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
    }),
  );
}

export function mapDependencyGraphRows(
  rows: readonly HabitDependencyVersionRow[],
): Result<readonly EffectiveDependencyEdge[], PlannerPersistenceError> {
  const versions: HabitDependencyVersion[] = [];
  for (const row of rows) {
    const mapped = mapHabitDependencyRow(row);
    if (!mapped.ok) return mapped;
    versions.push(mapped.value);
  }

  const byRelationship = new Map<PlannerId, HabitDependencyVersion[]>();
  for (const version of versions) {
    const history = byRelationship.get(version.relationshipId) ?? [];
    history.push(version);
    byRelationship.set(version.relationshipId, history);
  }
  for (const relationshipId of [...byRelationship.keys()].sort()) {
    const history = [...(byRelationship.get(relationshipId) ?? [])].sort(
      (left, right) => left.versionNumber - right.versionNumber,
    );
    const first = history[0];
    const versionNumbers = new Set<number>();
    for (let index = 0; index < history.length; index += 1) {
      const version = history[index];
      if (
        versionNumbers.has(version.versionNumber) ||
        version.parentHabitId !== first.parentHabitId ||
        version.dependentHabitId !== first.dependentHabitId
      ) {
        return integrityFailure(
          'Persisted versions of one dependency relationship have conflicting identities.',
        );
      }
      versionNumbers.add(version.versionNumber);
      for (let other = index + 1; other < history.length; other += 1) {
        if (
          effectiveRangesIntersect(
            version.effectiveRange,
            history[other].effectiveRange,
          )
        ) {
          return integrityFailure(
            'Persisted versions of one dependency relationship overlap.',
          );
        }
      }
    }
  }

  return success(
    Object.freeze(
      versions
        .map((version) =>
          Object.freeze({
            relationshipId: version.relationshipId,
            relationshipVersionId: version.id,
            parentHabitId: version.parentHabitId,
            dependentHabitId: version.dependentHabitId,
            dependencyType: version.dependencyType,
            occurrenceMode: version.occurrenceMode,
            effectiveRange: version.effectiveRange,
          }),
        )
        .sort(compareGraphEdges),
    ),
  );
}

export function mapDependencyAggregateRows(
  rows: DependencyAggregateRows,
  expected: AddDependencyAggregatePersistenceInput,
): Result<HabitDependencyAggregate, PlannerPersistenceError> {
  const relationship = mapHabitDependencyRow(rows.relationship);
  if (!relationship.ok) return relationship;
  const parent = mapHabitRow(rows.parent);
  if (!parent.ok) return parent;
  const dependent = mapHabitRow(rows.dependent);
  if (!dependent.ok) return dependent;
  const tracking = mapTrackingRow(rows.dependentTracking);
  if (!tracking.ok) return tracking;
  const importance = mapImportanceRow(rows.dependentImportance);
  if (!importance.ok) return importance;

  const reminders: HabitReminderIntent[] = [];
  for (const row of rows.dependentReminders) {
    const reminder = mapReminderRow(row);
    if (!reminder.ok) return reminder;
    if (reminder.value.habitId !== dependent.value.id) {
      return integrityFailure(
        'A dependent reminder belongs to another habit.',
      );
    }
    reminders.push(reminder.value.model);
  }

  if (
    relationship.value.parentHabitId !== parent.value.id ||
    relationship.value.dependentHabitId !== dependent.value.id ||
    tracking.value.habitId !== dependent.value.id ||
    importance.value.habitId !== dependent.value.id
  ) {
    return integrityFailure(
      'Dependency aggregate rows do not share the expected owners.',
    );
  }
  if (!matchesExpectedRelationship(relationship.value, expected)) {
    return integrityFailure(
      'The dependency readback does not match the inserted relationship.',
    );
  }
  if (
    expected.source === 'new' &&
    (!matchesNewDependent(
      rows,
      expected,
      dependent.value,
      tracking.value.model,
      importance.value.model,
      reminders,
    ) ||
      rows.dependentScheduleCount !== 0 ||
      rows.dependentObservationCount !== 0)
  ) {
    return integrityFailure(
      'The new dependent readback contains an unexpected configuration.',
    );
  }

  return success(
    Object.freeze({
      relationship: relationship.value,
      parent: toSummary(parent.value),
      dependent: toSummary(dependent.value),
      dependentWasCreated: expected.source === 'new',
      dependentTracking: tracking.value.model,
      dependentImportance: importance.value.model,
      dependentReminders: Object.freeze(reminders),
      relationshipState:
        relationship.value.effectiveRange.effectiveTo === null
          ? ('open' as const)
          : ('planned_finite' as const),
    }),
  );
}

function matchesExpectedRelationship(
  actual: HabitDependencyVersion,
  expected: AddDependencyAggregatePersistenceInput,
): boolean {
  const relationship = expected.relationship;
  return (
    actual.id === relationship.relationshipVersionId &&
    actual.relationshipId === relationship.relationshipId &&
    actual.versionNumber === 1 &&
    actual.parentHabitId === relationship.parentHabitId &&
    actual.dependentHabitId === relationship.dependentHabitId &&
    actual.dependencyType === relationship.dependencyType &&
    actual.occurrenceMode === relationship.occurrenceMode &&
    actual.effectiveRange.effectiveFrom ===
      relationship.effectiveRange.effectiveFrom &&
    actual.effectiveRange.effectiveTo ===
      relationship.effectiveRange.effectiveTo &&
    actual.endReason === relationship.endReason &&
    actual.createdAt === relationship.createdAt &&
    actual.updatedAt === relationship.createdAt
  );
}

function matchesNewDependent(
  rows: DependencyAggregateRows,
  expected: Extract<AddDependencyAggregatePersistenceInput, { source: 'new' }>,
  dependent: MappedHabitIdentity,
  tracking: HabitDependencyAggregate['dependentTracking'],
  importance: HabitDependencyAggregate['dependentImportance'],
  reminders: readonly HabitReminderIntent[],
): boolean {
  const expectedReminder = expected.newDependent.reminder;
  return (
    rows.dependent.id === expected.newDependent.habitId &&
    dependent.name === expected.newDependent.name &&
    dependent.description === expected.newDependent.description &&
    dependent.categoryId === expected.newDependent.categoryId &&
    dependent.lifecycle === 'active' &&
    dependent.sortOrder === 0 &&
    dependent.activeRange.effectiveFrom ===
      expected.newDependent.activeRange.effectiveFrom &&
    dependent.activeRange.effectiveTo ===
      expected.newDependent.activeRange.effectiveTo &&
    dependent.createdAt === expected.newDependent.createdAt &&
    dependent.updatedAt === expected.newDependent.createdAt &&
    rows.dependentTracking.id === expected.newDependent.trackingVersionId &&
    tracking.versionNumber === 1 &&
    sameSqlParameters(
      trackingDefinitionToParameters(tracking.definition),
      trackingDefinitionToParameters(expected.newDependent.tracking),
    ) &&
    tracking.createdAt === expected.newDependent.createdAt &&
    tracking.updatedAt === expected.newDependent.createdAt &&
    rows.dependentImportance.id === expected.newDependent.importanceVersionId &&
    importance.versionNumber === 1 &&
    importance.importance === expected.newDependent.importance &&
    importance.weight === expected.newDependent.importanceWeight &&
    importance.effectiveRange.effectiveFrom ===
      expected.newDependent.activeRange.effectiveFrom &&
    importance.effectiveRange.effectiveTo ===
      expected.newDependent.activeRange.effectiveTo &&
    importance.createdAt === expected.newDependent.createdAt &&
    importance.updatedAt === expected.newDependent.createdAt &&
    rows.dependent.active_from ===
      expected.relationship.effectiveRange.effectiveFrom &&
    rows.dependent.active_to === expected.relationship.effectiveRange.effectiveTo &&
    (expectedReminder === null
      ? reminders.length === 0
      : reminders.length === 1 &&
        reminders[0].id === expectedReminder.id &&
        reminders[0].triggerLocalTime === expectedReminder.triggerLocalTime &&
        reminders[0].timezoneMode === expectedReminder.timezoneMode &&
        reminders[0].timezoneId === expectedReminder.timezoneId &&
        reminders[0].enabled &&
        reminders[0].lifecycle === 'active' &&
        reminders[0].createdAt === expected.newDependent.createdAt &&
        reminders[0].updatedAt === expected.newDependent.createdAt)
  );
}

function sameSqlParameters(
  left: Readonly<Record<string, string | number | null>>,
  right: Readonly<Record<string, string | number | null>>,
): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => left[key] === right[key]);
}

function toSummary(
  habit: MappedHabitIdentity,
): DependencyHabitSummary {
  return Object.freeze({
    id: habit.id,
    name: habit.name,
    categoryId: habit.categoryId,
    activeRange: habit.activeRange,
    lifecycle: habit.lifecycle,
  });
}

function compareGraphEdges(
  left: EffectiveDependencyEdge,
  right: EffectiveDependencyEdge,
): number {
  return (
    left.effectiveRange.effectiveFrom.localeCompare(
      right.effectiveRange.effectiveFrom,
    ) ||
    left.parentHabitId.localeCompare(right.parentHabitId) ||
    left.dependentHabitId.localeCompare(right.dependentHabitId) ||
    left.relationshipId.localeCompare(right.relationshipId) ||
    left.relationshipVersionId.localeCompare(right.relationshipVersionId)
  );
}

function parseTimestamps(
  createdAt: unknown,
  updatedAt: unknown,
): Readonly<{ createdAt: number; updatedAt: number }> | null {
  return isNonnegativeSafeInteger(createdAt) &&
    isNonnegativeSafeInteger(updatedAt) &&
    updatedAt >= createdAt
    ? { createdAt, updatedAt }
    : null;
}

function isNonnegativeSafeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0;
}

function isPositiveSafeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0;
}

function integrityFailure<T>(
  message: string,
): Result<T, PlannerPersistenceError> {
  return failure(
    createPlannerPersistenceError(
      'dependency_data_integrity_failure',
      message,
      { operation: 'mapDependencyRows' },
    ),
  );
}
