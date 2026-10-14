import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';

declare const plannerIdBrand: unique symbol;

export type PlannerId = string & { readonly [plannerIdBrand]: true };

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parsePlannerId(
  input: unknown,
  field = 'id',
): Result<PlannerId, PlannerDomainError> {
  if (typeof input === 'string' && CANONICAL_UUID_PATTERN.test(input)) {
    return success(input as PlannerId);
  }

  return failure(
    createPlannerDomainError(
      'invalid_identifier',
      'The Planner identifier is not a canonical UUID.',
      { field, diagnostics: { reason: 'uuid_format' } },
    ),
  );
}
