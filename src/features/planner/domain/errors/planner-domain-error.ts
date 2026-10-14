export const PLANNER_DOMAIN_ERROR_CODES = [
  'invalid_identifier',
  'invalid_local_date',
  'invalid_local_time',
  'invalid_planned_duration',
  'invalid_day_block',
  'invalid_growth_enjoyment',
  'invalid_growth_cue',
  'invalid_timezone',
  'invalid_effective_range',
  'overlapping_effective_range',
  'invalid_schedule_definition',
  'invalid_tracking_definition',
  'invalid_exact_quantity',
  'exact_quantity_precision_exceeded',
  'exact_quantity_overflow',
  'unsupported_stored_value',
  'lifecycle_history_invalid',
  'dependency_self_link',
  'dependency_duplicate_relationship',
  'dependency_second_active_parent',
  'dependency_cycle',
  'dependency_depth_exceeded',
  'expectation_root_not_scheduled',
  'expectation_parent_missing',
  'expectation_dependent_missing',
  'expectation_relationship_context_invalid',
  'expectation_cycle_detected',
  'expectation_depth_exceeded',
  'expectation_configuration_missing',
  'expectation_configuration_ambiguous',
  'expectation_observation_context_invalid',
  'qualification_invalid_tracking_context',
  'qualification_exact_value_overflow',
  'observation_habit_not_found',
  'observation_habit_archived',
  'observation_not_scheduled',
  'observation_outside_active_range',
  'observation_schedule_missing',
  'observation_schedule_ambiguous',
  'observation_tracking_missing',
  'observation_tracking_ambiguous',
  'observation_importance_missing',
  'observation_importance_ambiguous',
  'dependency_occurrence_resolution_required',
  'observation_dependency_blocked',
  'observation_dependency_not_expected',
  'observation_parent_occurrence_missing',
  'observation_prerequisite_context_invalid',
  'observation_type_mismatch',
  'observation_invalid_value',
  'observation_quantity_scale_mismatch',
  'observation_state_already_exists',
  'observation_routine_container_derived',
  'observation_not_found',
  'observation_not_current_leaf',
  'observation_correction_branch',
  'observation_correction_cycle',
  'observation_context_mismatch',
  'observation_invalid_correction',
  'observation_data_integrity_failure',
  'observation_database_failure',
  'occurrence_read_model_data_integrity_failure',
  'occurrence_read_model_database_failure',
] as const;

export type PlannerDomainErrorCode =
  (typeof PLANNER_DOMAIN_ERROR_CODES)[number];

export type PlannerDomainDiagnosticValue = string | number | boolean | null;

export interface PlannerDomainError {
  readonly name: 'PlannerDomainError';
  readonly code: PlannerDomainErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly path?: string;
  readonly diagnostics?: Readonly<
    Record<string, PlannerDomainDiagnosticValue>
  >;
}

export interface PlannerDomainErrorOptions {
  readonly field?: string;
  readonly path?: string;
  readonly diagnostics?: Readonly<
    Record<string, PlannerDomainDiagnosticValue>
  >;
}

export function createPlannerDomainError(
  code: PlannerDomainErrorCode,
  message: string,
  options: PlannerDomainErrorOptions = {},
): PlannerDomainError {
  return Object.freeze({
    name: 'PlannerDomainError' as const,
    code,
    message,
    ...(options.field === undefined ? {} : { field: options.field }),
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.diagnostics === undefined
      ? {}
      : { diagnostics: Object.freeze({ ...options.diagnostics }) }),
  });
}
