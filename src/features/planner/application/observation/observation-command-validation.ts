import {
  failure,
  parseObservationCorrectionReason,
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  parsePlannerTimezone,
  success,
  validateObservationValueShape,
  type ObservationCorrectionReason,
  type ObservationValue,
  type PlannerId,
  type PlannerLocalDate,
  type PlannerLocalTime,
  type PlannerTimezone,
  type Result,
} from '../../domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import {
  createObservationOperationError,
  type ObservationOperationError,
} from './observation-operation-result';

export interface PreparedObservationFields {
  readonly occurrenceLocalDate: PlannerLocalDate;
  readonly occurrenceLocalTime: PlannerLocalTime | null;
  readonly occurrenceTimezone: PlannerTimezone;
  readonly note: string | null;
  readonly value: ObservationValue;
}

export function validateCommandKeys(
  command: unknown,
  allowedKeys: readonly string[],
): Result<Readonly<Record<string, unknown>>, ObservationOperationError> {
  if (typeof command !== 'object' || command === null || Array.isArray(command)) {
    return invalidCorrection('The observation command must be an object.');
  }
  const record = command as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    return invalidCorrection('The observation command contains protected or unsupported fields.');
  }
  return success(record);
}

export function prepareObservationFields(
  input: Readonly<Record<string, unknown>>,
  names: Readonly<{
    date: string;
    time: string;
    timezone: string;
    note: string;
    value: string;
  }>,
  allowVoid: boolean,
): Result<PreparedObservationFields, ObservationOperationError> {
  const date = parsePlannerLocalDate(input[names.date], names.date);
  if (!date.ok) return invalidValue(names.date, date.error);
  let time: PlannerLocalTime | null = null;
  const rawTime = input[names.time];
  if (rawTime !== undefined && rawTime !== null) {
    const parsedTime = parsePlannerLocalTime(rawTime, names.time);
    if (!parsedTime.ok) return invalidValue(names.time, parsedTime.error);
    time = parsedTime.value;
  }
  const timezone = parsePlannerTimezone(input[names.timezone], names.timezone);
  if (!timezone.ok) return invalidValue(names.timezone, timezone.error);
  const note = normalizeNote(input[names.note]);
  if (!note.ok) return note;
  const value = validateObservationValueShape(input[names.value], { allowVoid });
  if (!value.ok) {
    return failure(
      createObservationOperationError(
        value.error.code as ObservationOperationError['code'],
        value.error.message,
        { field: names.value },
      ),
    );
  }
  return success(Object.freeze({
    occurrenceLocalDate: date.value,
    occurrenceLocalTime: time,
    occurrenceTimezone: timezone.value,
    note: note.value,
    value: value.value,
  }));
}

export function prepareGeneratedObservationIdentity(
  idGenerator: IdGenerator,
  clock: Clock,
): Result<Readonly<{ observationId: PlannerId; timestamp: number }>, ObservationOperationError> {
  let rawId: string;
  let timestamp: number;
  try {
    rawId = idGenerator.generateId();
    timestamp = clock.nowEpochMilliseconds();
  } catch (cause: unknown) {
    return failure(
      createObservationOperationError(
        'observation_data_integrity_failure',
        'The observation identity source failed.',
        { cause },
      ),
    );
  }
  const id = parsePlannerId(rawId, 'generatedObservationId');
  if (!id.ok || !Number.isSafeInteger(timestamp) || timestamp < 0) {
    return failure(
      createObservationOperationError(
        'observation_data_integrity_failure',
        'The observation identity source returned an invalid value.',
        { cause: id.ok ? undefined : id.error },
      ),
    );
  }
  return success(Object.freeze({ observationId: id.value, timestamp }));
}

export function parseObservationId(
  value: unknown,
  field: string,
): Result<PlannerId, ObservationOperationError> {
  const parsed = parsePlannerId(value, field);
  return parsed.ok ? success(parsed.value) : invalidValue(field, parsed.error);
}

export function parseCorrectionReason(
  value: unknown,
): Result<ObservationCorrectionReason, ObservationOperationError> {
  const parsed = parseObservationCorrectionReason(value, 'correctionReason');
  return parsed.ok
    ? success(parsed.value)
    : invalidCorrection('The correction reason is unsupported.', parsed.error);
}

export function validateCorrectionIntent(
  reason: ObservationCorrectionReason,
  value: ObservationValue,
): Result<null, ObservationOperationError> {
  const voidReason = reason === 'duplicate_entry' || reason === 'reversal';
  if (voidReason !== (value.type === 'void') && reason !== 'other') {
    return invalidCorrection(
      'Duplicate and reversal reasons require void; value/date corrections require a replacement fact.',
    );
  }
  return success(null);
}

function normalizeNote(
  input: unknown,
): Result<string | null, ObservationOperationError> {
  if (input === undefined || input === null) return success(null);
  if (typeof input !== 'string') {
    return invalidValue('note', undefined, 'The observation note must be text.');
  }
  return success(input.trim().length === 0 ? null : input);
}

function invalidValue<T = never>(
  field: string,
  cause?: unknown,
  message = 'One or more observation fields are invalid.',
): Result<T, ObservationOperationError> {
  return failure(
    createObservationOperationError('observation_invalid_value', message, {
      field,
      ...(cause === undefined ? {} : { cause }),
    }),
  );
}

function invalidCorrection<T = never>(
  message: string,
  cause?: unknown,
): Result<T, ObservationOperationError> {
  return failure(
    createObservationOperationError('observation_invalid_correction', message, {
      ...(cause === undefined ? {} : { cause }),
    }),
  );
}
