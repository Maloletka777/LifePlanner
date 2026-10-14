import type { Result } from '../../domain';
import type { HabitDependencyAggregate } from '../../repositories';

export const ADD_HABIT_DEPENDENCY_ERROR_CODES = [
  'dependency_parent_not_found',
  'dependency_dependent_not_found',
  'dependency_parent_archived',
  'dependency_dependent_archived',
  'dependency_self_link',
  'dependency_duplicate_relationship',
  'dependency_second_active_parent',
  'dependency_relationship_mode_conflict',
  'dependency_cycle',
  'dependency_depth_exceeded',
  'dependency_invalid_effective_range',
  'dependency_outside_parent_active_range',
  'dependency_outside_dependent_active_range',
  'dependency_category_not_found',
  'dependency_category_archived',
  'dependency_invalid_dependent_definition',
  'dependency_invalid_command',
  'dependency_data_integrity_failure',
  'dependency_database_failure',
] as const;

export type AddHabitDependencyErrorCode =
  (typeof ADD_HABIT_DEPENDENCY_ERROR_CODES)[number];

export interface AddHabitDependencyError {
  readonly name: 'AddHabitDependencyError';
  readonly code: AddHabitDependencyErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
}

export type AddHabitDependencyResult = Result<
  HabitDependencyAggregate,
  AddHabitDependencyError
>;

export function addHabitDependencyError(
  code: AddHabitDependencyErrorCode,
  message: string,
  options: Readonly<{ field?: string; cause?: unknown }> = {},
): AddHabitDependencyError {
  return Object.freeze({
    name: 'AddHabitDependencyError' as const,
    code,
    message,
    ...(options.field === undefined ? {} : { field: options.field }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}
