import assert from 'node:assert/strict';

import type {
  PlannerDomainError,
  PlannerDomainErrorCode,
  Result,
} from '../../../src/features/planner/domain';

export function expectSuccess<T>(
  result: Result<T, PlannerDomainError>,
): T {
  if (!result.ok) {
    assert.fail(`Expected success, received ${result.error.code}.`);
  }
  return result.value;
}

export function expectError(
  result: Result<unknown, PlannerDomainError>,
  code: PlannerDomainErrorCode,
): PlannerDomainError {
  if (result.ok) {
    assert.fail(`Expected ${code}, received success.`);
  }
  assert.equal(result.error.code, code);
  return result.error;
}
