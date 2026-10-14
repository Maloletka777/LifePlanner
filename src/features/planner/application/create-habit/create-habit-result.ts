import type { PlannerDomainError, Result } from '../../domain';
import type { HabitAggregate } from '../../repositories';

export const CREATE_HABIT_ERROR_CODES = [
  'invalid_input',
  'category_not_found',
  'category_archived',
  'validation_conflict',
  'database_failure',
  'data_integrity_failure',
] as const;

export type CreateHabitErrorCode =
  (typeof CREATE_HABIT_ERROR_CODES)[number];

export interface CreateHabitError {
  readonly name: 'CreateHabitError';
  readonly code: CreateHabitErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
}

export type CreateHabitResult = Result<HabitAggregate, CreateHabitError>;

export function createHabitError(
  code: CreateHabitErrorCode,
  message: string,
  options: Readonly<{
    field?: string;
    cause?: unknown;
  }> = {},
): CreateHabitError {
  return Object.freeze({
    name: 'CreateHabitError' as const,
    code,
    message,
    ...(options.field === undefined ? {} : { field: options.field }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}

export function invalidDomainInput(
  field: string,
  cause: PlannerDomainError,
): CreateHabitError {
  return createHabitError(
    'invalid_input',
    'One or more habit details are invalid.',
    { field, cause },
  );
}
