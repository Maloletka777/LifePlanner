import type {
  ObservationChain,
  ObservationFact,
  PlannerDomainErrorCode,
  Result,
} from '../../domain';

export type ObservationOperationErrorCode = Extract<
  PlannerDomainErrorCode,
  `observation_${string}` | 'dependency_occurrence_resolution_required'
>;

export interface ObservationOperationError {
  readonly name: 'ObservationOperationError';
  readonly code: ObservationOperationErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
}

export type RecordHabitObservationResult = Result<
  ObservationFact,
  ObservationOperationError
>;

export type CorrectHabitObservationResult = Result<
  ObservationChain,
  ObservationOperationError
>;

export function createObservationOperationError(
  code: ObservationOperationErrorCode,
  message: string,
  options: Readonly<{ field?: string; cause?: unknown }> = {},
): ObservationOperationError {
  return Object.freeze({
    name: 'ObservationOperationError' as const,
    code,
    message,
    ...(options.field === undefined ? {} : { field: options.field }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}
