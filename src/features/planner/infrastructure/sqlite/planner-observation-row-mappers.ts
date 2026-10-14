import {
  failure,
  parseObservationCorrectionReason,
  parseObservationType,
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  parsePlannerTimezone,
  success,
  validateMappedObservationValue,
  type ObservationFact,
  type PlannerId,
  type Result,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type PlannerPersistenceError,
} from '../../repositories';
import type { HabitObservationRow } from './planner-row-types';

export function mapHabitObservationRow(
  row: HabitObservationRow,
): Result<ObservationFact, PlannerPersistenceError> {
  const id = parsePlannerId(row.id, 'observation.id');
  const habitId = parsePlannerId(row.habit_id, 'observation.habitId');
  const scheduleVersionId = nullableId(row.schedule_version_id, 'observation.scheduleVersionId');
  const detachedScheduleContextId = nullableId(row.detached_schedule_context_id ?? null, 'observation.detachedScheduleContextId');
  const trackingVersionId = parsePlannerId(
    row.tracking_version_id,
    'observation.trackingVersionId',
  );
  const importanceVersionId = parsePlannerId(
    row.importance_version_id,
    'observation.importanceVersionId',
  );
  const date = parsePlannerLocalDate(
    row.occurrence_local_date,
    'observation.occurrenceLocalDate',
  );
  const timezone = parsePlannerTimezone(
    row.occurrence_timezone,
    'observation.occurrenceTimezone',
  );
  const type = parseObservationType(
    row.observation_type,
    'observation.observationType',
  );
  if (
    !id.ok ||
    !habitId.ok ||
    !scheduleVersionId.ok || !detachedScheduleContextId.ok ||
    !trackingVersionId.ok ||
    !importanceVersionId.ok ||
    !date.ok ||
    !timezone.ok ||
    !type.ok
  ) {
    return integrityFailure('A persisted observation identity or discriminator is malformed.');
  }

  const dependencyVersionId = nullableId(
    row.dependency_version_id,
    'observation.dependencyVersionId',
  );
  const supersedesObservationId = nullableId(
    row.supersedes_observation_id,
    'observation.supersedesObservationId',
  );
  if (!dependencyVersionId.ok || !supersedesObservationId.ok) {
    return integrityFailure('A persisted observation reference is malformed.');
  }
  const contextMode = row.context_mode ?? (dependencyVersionId.value === null ? 'live_independent' : 'live_dependent');
  const validContext =
    (contextMode === 'live_independent' && scheduleVersionId.value !== null && dependencyVersionId.value === null && detachedScheduleContextId.value === null) ||
    (contextMode === 'live_dependent' && scheduleVersionId.value !== null && dependencyVersionId.value !== null && detachedScheduleContextId.value === null) ||
    (contextMode === 'detached_dependent' && scheduleVersionId.value === null && dependencyVersionId.value === null && detachedScheduleContextId.value !== null);
  if (!validContext) return integrityFailure('A persisted observation context mode is contradictory.');
  if (supersedesObservationId.value === id.value) {
    return integrityFailure('A persisted observation supersedes itself.');
  }

  let occurrenceLocalTime = null;
  if (row.occurrence_local_time !== null) {
    const time = parsePlannerLocalTime(
      row.occurrence_local_time,
      'observation.occurrenceLocalTime',
    );
    if (!time.ok) return integrityFailure('A persisted observation time is malformed.');
    occurrenceLocalTime = time.value;
  }

  let correctionReason = null;
  if (row.correction_reason !== null) {
    const reason = parseObservationCorrectionReason(
      row.correction_reason,
      'observation.correctionReason',
    );
    if (!reason.ok) return integrityFailure('A persisted correction reason is unsupported.');
    correctionReason = reason.value;
  }
  if (
    (supersedesObservationId.value === null && correctionReason !== null) ||
    (supersedesObservationId.value !== null && correctionReason === null) ||
    (supersedesObservationId.value === null && type.value === 'void')
  ) {
    return integrityFailure('A persisted observation has contradictory correction metadata.');
  }

  const value = validateMappedObservationValue(type.value, {
    booleanValue: row.boolean_value,
    counterDelta: row.counter_delta,
    quantitySignificand: row.quantity_significand,
    quantityScale: row.quantity_scale,
    durationSeconds: row.duration_seconds,
  });
  if (!value.ok) {
    return integrityFailure('A persisted observation value is malformed.');
  }
  if (
    (row.note !== null && typeof row.note !== 'string') ||
    !isNonnegativeSafeInteger(row.observed_at) ||
    !isNonnegativeSafeInteger(row.created_at)
  ) {
    return integrityFailure('A persisted observation note or timestamp is malformed.');
  }

  return success(Object.freeze({
    id: id.value,
    habitId: habitId.value,
    contextMode,
    scheduleVersionId: scheduleVersionId.value,
    detachedScheduleContextId: detachedScheduleContextId.value,
    trackingVersionId: trackingVersionId.value,
    importanceVersionId: importanceVersionId.value,
    dependencyVersionId: dependencyVersionId.value,
    occurrenceLocalDate: date.value,
    occurrenceLocalTime,
    occurrenceTimezone: timezone.value,
    observationType: type.value,
    value: value.value,
    note: row.note,
    supersedesObservationId: supersedesObservationId.value,
    correctionReason,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  }));
}

function nullableId(
  value: unknown,
  field: string,
): Result<PlannerId | null, PlannerPersistenceError> {
  if (value === null) return success(null);
  const parsed = parsePlannerId(value, field);
  return parsed.ok
    ? success(parsed.value)
    : integrityFailure('A persisted observation identifier is malformed.');
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function integrityFailure(
  message: string,
): Result<never, PlannerPersistenceError> {
  return failure(
    createPlannerPersistenceError('observation_data_integrity_failure', message, {
      operation: 'mapHabitObservationRow',
    }),
  );
}
