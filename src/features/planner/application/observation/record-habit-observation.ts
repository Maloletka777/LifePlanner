import { failure, success } from '../../domain';
import type {
  PlannerPersistenceError,
  PlannerUnitOfWork,
} from '../../repositories';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { RecordHabitObservationCommand } from './record-habit-observation-command';
import {
  prepareGeneratedObservationIdentity,
  prepareObservationFields,
  parseObservationId,
  validateCommandKeys,
} from './observation-command-validation';
import {
  createObservationOperationError,
  type ObservationOperationError,
  type RecordHabitObservationResult,
} from './observation-operation-result';

export interface RecordHabitObservationDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export type RecordHabitObservation = (
  command: RecordHabitObservationCommand,
) => Promise<RecordHabitObservationResult>;

export function createRecordHabitObservation(
  dependencies: RecordHabitObservationDependencies,
): RecordHabitObservation {
  return async (command) => {
    const keys = validateCommandKeys(command, [
      'habitId',
      'occurrenceLocalDate',
      'occurrenceLocalTime',
      'occurrenceTimezone',
      'note',
      'value',
    ]);
    if (!keys.ok) return keys;
    const habitId = parseObservationId(keys.value.habitId, 'habitId');
    if (!habitId.ok) return habitId;
    const fields = prepareObservationFields(
      keys.value,
      {
        date: 'occurrenceLocalDate',
        time: 'occurrenceLocalTime',
        timezone: 'occurrenceTimezone',
        note: 'note',
        value: 'value',
      },
      false,
    );
    if (!fields.ok) return fields;
    const identity = prepareGeneratedObservationIdentity(
      dependencies.idGenerator,
      dependencies.clock,
    );
    if (!identity.ok) return identity;

    try {
      const result = await dependencies.unitOfWork.recordObservation({
        observationId: identity.value.observationId,
        habitId: habitId.value,
        ...fields.value,
        observedAt: identity.value.timestamp,
        createdAt: identity.value.timestamp,
      });
      return result.ok ? success(result.value) : failure(mapPersistenceError(result.error));
    } catch {
      return failure(
        createObservationOperationError(
          'observation_database_failure',
          'The observation could not be saved to local storage.',
        ),
      );
    }
  };
}

export function mapObservationPersistenceError(
  error: PlannerPersistenceError,
): ObservationOperationError {
  if (
    error.code === 'dependency_occurrence_resolution_required' ||
    error.code.startsWith('observation_')
  ) {
    return createObservationOperationError(
      error.code as ObservationOperationError['code'],
      error.message,
    );
  }
  return createObservationOperationError(
    'observation_data_integrity_failure',
    'The observation operation encountered unsupported local data.',
  );
}

function mapPersistenceError(error: PlannerPersistenceError): ObservationOperationError {
  return mapObservationPersistenceError(error);
}
