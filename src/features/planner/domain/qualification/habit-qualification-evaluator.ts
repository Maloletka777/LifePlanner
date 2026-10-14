import {
  addExactQuantities,
  compareExactQuantities,
  createExactQuantity,
  type ExactQuantity,
} from '../exact-quantity/exact-quantity';
import {
  createPlannerDomainError,
  type PlannerDomainError,
} from '../errors/planner-domain-error';
import type { ObservationChain, ObservationValue } from '../observation/observation';
import { failure, success, type Result } from '../result';
import type { TrackingDefinition } from '../tracking/tracking-definition';

export type HabitQualificationState =
  | 'qualified'
  | 'incomplete'
  | 'provisional'
  | 'skipped_policy_unresolved'
  | 'no_current_fact'
  | 'voided';

export type HabitQualificationActual =
  | Readonly<{ kind: 'boolean'; value: boolean }>
  | Readonly<{ kind: 'counter'; value: ExactQuantity & { readonly scale: 0 } }>
  | Readonly<{ kind: 'quantity'; value: ExactQuantity }>
  | Readonly<{ kind: 'duration'; seconds: number }>;

export interface HabitQualificationResult {
  readonly state: HabitQualificationState;
  readonly actual: HabitQualificationActual | null;
  readonly currentLeafCount: number;
  readonly currentLeafIds: readonly string[];
}

export interface HabitQualificationInput {
  readonly tracking: TrackingDefinition;
  readonly observationChains: readonly ObservationChain[];
  readonly evaluationWindow: 'open' | 'closed';
}

export function evaluateHabitQualification(
  input: HabitQualificationInput,
): Result<HabitQualificationResult, PlannerDomainError> {
  const ordered = [...input.observationChains].sort((left, right) =>
    left.root.id.localeCompare(right.root.id),
  );
  if (ordered.length === 0) {
    return qualification('no_current_fact', null, []);
  }

  const active = ordered.filter((chain) => !chain.isVoided);
  if (active.length === 0) {
    return qualification('voided', null, []);
  }
  const leaves = active.map((chain) => chain.currentLeaf);
  const leafIds = leaves.map((leaf) => leaf.id).sort();
  const skipped = leaves.filter((leaf) => leaf.value.type === 'skipped');
  if (skipped.length > 0) {
    if (skipped.length !== leaves.length || skipped.length > 1) {
      return invalidContext(
        'Skipped and measured current facts cannot coexist for one occurrence.',
      );
    }
    return qualification('skipped_policy_unresolved', null, leafIds);
  }

  switch (input.tracking.trackingMode) {
    case 'checkbox':
    case 'avoidance': {
      if (leaves.length !== 1) {
        return invalidContext(
          'Boolean tracking requires exactly one current state fact.',
        );
      }
      const value = leaves[0].value;
      if (value.type !== input.tracking.trackingMode) {
        return invalidContext(
          'The current observation type does not match the tracking definition.',
        );
      }
      const actual = Object.freeze({
        kind: 'boolean' as const,
        value: value.booleanValue,
      });
      return qualification(
        value.booleanValue ? 'qualified' : 'incomplete',
        actual,
        leafIds,
      );
    }
    case 'counter': {
      const total = sumCounterValues(leaves.map((leaf) => leaf.value));
      if (!total.ok) return total;
      return numericQualification(
        input.tracking.comparisonOperator,
        total.value,
        input.tracking.target,
        input.evaluationWindow,
        Object.freeze({ kind: 'counter' as const, value: total.value }),
        leafIds,
      );
    }
    case 'quantity': {
      const total = sumQuantityValues(
        leaves.map((leaf) => leaf.value),
        input.tracking.target,
      );
      if (!total.ok) return total;
      return numericQualification(
        input.tracking.comparisonOperator,
        total.value,
        input.tracking.target,
        input.evaluationWindow,
        Object.freeze({ kind: 'quantity' as const, value: total.value }),
        leafIds,
      );
    }
    case 'duration': {
      let seconds = 0n;
      for (const leaf of leaves) {
        if (leaf.value.type !== 'duration') {
          return invalidContext(
            'The current observation type does not match duration tracking.',
          );
        }
        seconds += BigInt(leaf.value.durationSeconds);
      }
      if (seconds > BigInt(Number.MAX_SAFE_INTEGER)) {
        return overflow();
      }
      const actualSeconds = Number(seconds);
      const state = compareNumbers(
        input.tracking.comparisonOperator,
        actualSeconds,
        input.tracking.targetDurationSeconds,
        input.evaluationWindow,
      );
      return qualification(
        state,
        Object.freeze({ kind: 'duration' as const, seconds: actualSeconds }),
        leafIds,
      );
    }
    default:
      return unreachableTracking(input.tracking);
  }
}

function sumCounterValues(
  values: readonly ObservationValue[],
): Result<ExactQuantity & { readonly scale: 0 }, PlannerDomainError> {
  let total = createExactQuantity({ significand: 0n, scale: 0 });
  if (!total.ok) return overflow();
  for (const value of values) {
    if (value.type !== 'counter') {
      return invalidContext(
        'The current observation type does not match counter tracking.',
      );
    }
    const next = createExactQuantity({
      significand: BigInt(value.counterDelta),
      scale: 0,
    });
    if (!next.ok) return overflow();
    total = addExactQuantities(total.value, next.value);
    if (!total.ok) return overflow();
  }
  return success(total.value as ExactQuantity & { readonly scale: 0 });
}

function sumQuantityValues(
  values: readonly ObservationValue[],
  target: ExactQuantity,
): Result<ExactQuantity, PlannerDomainError> {
  let total = createExactQuantity({ significand: 0n, scale: target.scale });
  if (!total.ok) return overflow();
  for (const value of values) {
    if (value.type !== 'quantity' || value.quantity.scale !== target.scale) {
      return invalidContext(
        'The current observation type or scale does not match quantity tracking.',
      );
    }
    total = addExactQuantities(total.value, value.quantity);
    if (!total.ok) return overflow();
  }
  return success(total.value);
}

function numericQualification(
  operator: 'at_least' | 'at_most' | 'equal',
  actual: ExactQuantity,
  target: ExactQuantity,
  evaluationWindow: 'open' | 'closed',
  context: HabitQualificationActual,
  leafIds: readonly string[],
): Result<HabitQualificationResult, PlannerDomainError> {
  const comparison = compareExactQuantities(actual, target);
  const state = compareNumbers(
    operator,
    comparison,
    0,
    evaluationWindow,
  );
  return qualification(state, context, leafIds);
}

function compareNumbers(
  operator: 'at_least' | 'at_most' | 'equal',
  actual: number,
  target: number,
  evaluationWindow: 'open' | 'closed',
): 'qualified' | 'incomplete' | 'provisional' {
  if (operator === 'at_most' && evaluationWindow === 'open') {
    return 'provisional';
  }
  if (operator === 'at_least') return actual >= target ? 'qualified' : 'incomplete';
  if (operator === 'equal') return actual === target ? 'qualified' : 'incomplete';
  return actual <= target ? 'qualified' : 'incomplete';
}

function qualification(
  state: HabitQualificationState,
  actual: HabitQualificationActual | null,
  leafIds: readonly string[],
): Result<HabitQualificationResult, PlannerDomainError> {
  return success(
    Object.freeze({
      state,
      actual,
      currentLeafCount: leafIds.length,
      currentLeafIds: Object.freeze([...leafIds]),
    }),
  );
}

function invalidContext(
  message: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError('qualification_invalid_tracking_context', message),
  );
}

function overflow(): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'qualification_exact_value_overflow',
      'The exact observation total is outside the supported range.',
    ),
  );
}

function unreachableTracking(value: never): Result<never, PlannerDomainError> {
  return invalidContext(`Unsupported tracking definition: ${String(value)}`);
}
