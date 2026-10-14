import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import {
  comparePlannerLocalDates,
  parsePlannerLocalDate,
  type PlannerLocalDate,
} from '../values/local-date';

export interface EffectiveRange {
  readonly effectiveFrom: PlannerLocalDate;
  readonly effectiveTo: PlannerLocalDate | null;
}

export interface EffectiveRangeInput {
  readonly effectiveFrom: unknown;
  readonly effectiveTo: unknown;
}

export function validateEffectiveRange(
  input: EffectiveRangeInput,
  path = 'effectiveRange',
): Result<EffectiveRange, PlannerDomainError> {
  const fromResult = parsePlannerLocalDate(
    input.effectiveFrom,
    'effectiveFrom',
  );
  if (!fromResult.ok) {
    return failure(
      createPlannerDomainError(
        'invalid_effective_range',
        'The effective range start must be a valid local date.',
        { field: 'effectiveFrom', path, diagnostics: { reason: 'invalid_start' } },
      ),
    );
  }

  let effectiveTo: PlannerLocalDate | null = null;
  if (input.effectiveTo !== null) {
    const toResult = parsePlannerLocalDate(input.effectiveTo, 'effectiveTo');
    if (!toResult.ok) {
      return failure(
        createPlannerDomainError(
          'invalid_effective_range',
          'The effective range end must be a valid local date or null.',
          { field: 'effectiveTo', path, diagnostics: { reason: 'invalid_end' } },
        ),
      );
    }
    effectiveTo = toResult.value;
  }

  if (
    effectiveTo !== null &&
    comparePlannerLocalDates(effectiveTo, fromResult.value) <= 0
  ) {
    return failure(
      createPlannerDomainError(
        'invalid_effective_range',
        'The exclusive effective end must be later than the effective start.',
        {
          field: 'effectiveTo',
          path,
          diagnostics: { reason: 'non_positive_range' },
        },
      ),
    );
  }

  return success(
    Object.freeze({
      effectiveFrom: fromResult.value,
      effectiveTo,
    }),
  );
}

export function isLocalDateInEffectiveRange(
  date: PlannerLocalDate,
  range: EffectiveRange,
): boolean {
  return (
    comparePlannerLocalDates(date, range.effectiveFrom) >= 0 &&
    (range.effectiveTo === null ||
      comparePlannerLocalDates(date, range.effectiveTo) < 0)
  );
}

export function effectiveRangesIntersect(
  left: EffectiveRange,
  right: EffectiveRange,
): boolean {
  const leftEndsBeforeRight =
    left.effectiveTo !== null &&
    comparePlannerLocalDates(left.effectiveTo, right.effectiveFrom) <= 0;
  const rightEndsBeforeLeft =
    right.effectiveTo !== null &&
    comparePlannerLocalDates(right.effectiveTo, left.effectiveFrom) <= 0;
  return !leftEndsBeforeRight && !rightEndsBeforeLeft;
}

export function validateNoEffectiveRangeOverlap(
  candidate: EffectiveRange,
  existingRanges: readonly EffectiveRange[],
  path = 'effectiveRange',
): Result<null, PlannerDomainError> {
  const overlapIndex = existingRanges.findIndex((existing) =>
    effectiveRangesIntersect(candidate, existing),
  );
  if (overlapIndex >= 0) {
    return failure(
      createPlannerDomainError(
        'overlapping_effective_range',
        'The effective range overlaps an existing version.',
        {
          path,
          diagnostics: { existingRangeIndex: overlapIndex },
        },
      ),
    );
  }
  return success(null);
}

export function validateEffectiveRangesDoNotOverlap(
  ranges: readonly EffectiveRange[],
  path = 'effectiveRanges',
): Result<null, PlannerDomainError> {
  for (let leftIndex = 0; leftIndex < ranges.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ranges.length;
      rightIndex += 1
    ) {
      if (effectiveRangesIntersect(ranges[leftIndex], ranges[rightIndex])) {
        return failure(
          createPlannerDomainError(
            'overlapping_effective_range',
            'Effective-dated versions must not overlap.',
            {
              path,
              diagnostics: { leftIndex, rightIndex },
            },
          ),
        );
      }
    }
  }
  return success(null);
}
