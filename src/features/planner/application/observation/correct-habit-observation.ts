import { failure, success } from '../../domain';
import type { PlannerUnitOfWork } from '../../repositories';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CorrectHabitObservationCommand } from './correct-habit-observation-command';
import {
  parseCorrectionReason,
  parseObservationId,
  prepareGeneratedObservationIdentity,
  prepareObservationFields,
  validateCommandKeys,
  validateCorrectionIntent,
} from './observation-command-validation';
import {
  createObservationOperationError,
  type CorrectHabitObservationResult,
} from './observation-operation-result';
import { mapObservationPersistenceError } from './record-habit-observation';

export interface CorrectHabitObservationDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export type CorrectHabitObservation = (
  command: CorrectHabitObservationCommand,
) => Promise<CorrectHabitObservationResult>;

export function createCorrectHabitObservation(
  dependencies: CorrectHabitObservationDependencies,
): CorrectHabitObservation {
  return async (command) => {
    const keys = validateCommandKeys(command, [
      'observationId',
      'correctionReason',
      'correctedOccurrenceLocalDate',
      'correctedOccurrenceLocalTime',
      'correctedOccurrenceTimezone',
      'correctedNote',
      'replacement',
    ]);
    if (!keys.ok) return keys;
    const selectedId = parseObservationId(keys.value.observationId, 'observationId');
    if (!selectedId.ok) return selectedId;
    const reason = parseCorrectionReason(keys.value.correctionReason);
    if (!reason.ok) return reason;
    const fields = prepareObservationFields(
      keys.value,
      {
        date: 'correctedOccurrenceLocalDate',
        time: 'correctedOccurrenceLocalTime',
        timezone: 'correctedOccurrenceTimezone',
        note: 'correctedNote',
        value: 'replacement',
      },
      true,
    );
    if (!fields.ok) return fields;
    const intent = validateCorrectionIntent(reason.value, fields.value.value);
    if (!intent.ok) return intent;
    const identity = prepareGeneratedObservationIdentity(
      dependencies.idGenerator,
      dependencies.clock,
    );
    if (!identity.ok) return identity;
    if (identity.value.observationId === selectedId.value) {
      return failure(
        createObservationOperationError(
          'observation_correction_cycle',
          'A correction cannot reuse the selected observation identifier.',
        ),
      );
    }

    try {
      const result = await dependencies.unitOfWork.correctObservation({
        observationId: identity.value.observationId,
        selectedObservationId: selectedId.value,
        correctionReason: reason.value,
        ...fields.value,
        observedAt: identity.value.timestamp,
        createdAt: identity.value.timestamp,
      });
      return result.ok
        ? success(result.value)
        : failure(mapObservationPersistenceError(result.error));
    } catch {
      return failure(
        createObservationOperationError(
          'observation_database_failure',
          'The correction could not be saved to local storage.',
        ),
      );
    }
  };
}
