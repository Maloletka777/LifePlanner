import { addProgressFractions, divideProgressFraction, type ExactProgressFraction } from '../progress/habit-progress-calculator';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';

export const ORDINARY_COMPLETION_ROLES = Object.freeze([
  'organizational',
  'routine_step',
] as const);

export type OrdinaryCompletionRole = (typeof ORDINARY_COMPLETION_ROLES)[number];

export function isOrdinaryCompletionRole(value: unknown): value is OrdinaryCompletionRole {
  return ORDINARY_COMPLETION_ROLES.includes(value as OrdinaryCompletionRole);
}

export interface RoutineStepProgressInput {
  readonly applicable: boolean;
  readonly completionCredit: ExactProgressFraction;
  readonly isCanonicallyComplete: boolean;
}

export interface RoutineStepProgress {
  readonly applicableStepCount: number;
  readonly completedStepCount: number;
  readonly remainingStepCount: number;
  readonly exactProgress: ExactProgressFraction | null;
  readonly isCanonicallyComplete: boolean;
}

const ZERO: ExactProgressFraction = Object.freeze({ numerator: 0n, denominator: 1n });

export function calculateRoutineStepProgress(
  steps: readonly RoutineStepProgressInput[],
): Result<RoutineStepProgress, PlannerDomainError> {
  let applicableStepCount = 0;
  let completedStepCount = 0;
  let credit = ZERO;
  for (const step of steps) {
    if (
      step.completionCredit.denominator <= 0n ||
      step.completionCredit.numerator < 0n ||
      step.completionCredit.numerator > step.completionCredit.denominator
    ) {
      return failure(createPlannerDomainError(
        'qualification_invalid_tracking_context',
        'A routine-step completion credit must be bounded from zero through one.',
      ));
    }
    if (!step.applicable) continue;
    applicableStepCount += 1;
    if (step.isCanonicallyComplete) completedStepCount += 1;
    credit = addProgressFractions(credit, step.completionCredit);
  }
  if (
    !Number.isSafeInteger(applicableStepCount) ||
    !Number.isSafeInteger(completedStepCount) ||
    completedStepCount > applicableStepCount
  ) {
    return failure(createPlannerDomainError(
      'qualification_invalid_tracking_context',
      'Routine-step counts violate their bounded invariant.',
    ));
  }
  const exactProgress = applicableStepCount === 0
    ? null
    : divideProgressFraction(credit, applicableStepCount);
  return success(Object.freeze({
    applicableStepCount,
    completedStepCount,
    remainingStepCount: applicableStepCount - completedStepCount,
    exactProgress,
    isCanonicallyComplete:
      applicableStepCount > 0 && completedStepCount === applicableStepCount,
  }));
}
