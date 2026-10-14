import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import type { PlannerId } from '../values/planner-id';
import type { ObservationChain, ObservationFact } from './observation';

export interface ObservationChainValidationOptions {
  readonly selectedObservationId?: PlannerId;
}

export function validateObservationChain(
  unorderedFacts: readonly ObservationFact[],
  options: ObservationChainValidationOptions = {},
): Result<ObservationChain, PlannerDomainError> {
  if (unorderedFacts.length === 0) {
    return chainFailure('observation_not_found', 'The observation chain is empty.');
  }

  const byId = new Map<PlannerId, ObservationFact>();
  for (const fact of unorderedFacts) {
    if (byId.has(fact.id)) {
      return chainFailure(
        'observation_data_integrity_failure',
        'The observation chain contains duplicate identifiers.',
      );
    }
    byId.set(fact.id, fact);
  }

  const habitId = unorderedFacts[0].habitId;
  const childByParent = new Map<PlannerId, ObservationFact>();
  const roots: ObservationFact[] = [];
  let measuredType: ObservationChain['measuredType'] = null;

  for (const fact of unorderedFacts) {
    if (fact.habitId !== habitId) {
      return chainFailure(
        'observation_context_mismatch',
        'Observation chain facts must belong to one habit.',
      );
    }
    if (fact.value.type !== fact.observationType) {
      return chainFailure(
        'observation_data_integrity_failure',
        'An observation fact has contradictory value discriminators.',
      );
    }
    if (fact.value.type !== 'skipped' && fact.value.type !== 'void') {
      if (measuredType !== null && measuredType !== fact.value.type) {
        return chainFailure(
          'observation_context_mismatch',
          'A correction chain cannot change between measured tracking types.',
        );
      }
      measuredType = fact.value.type;
    }

    if (fact.supersedesObservationId === null) {
      if (fact.correctionReason !== null || fact.value.type === 'void') {
        return chainFailure(
          'observation_invalid_correction',
          'A root fact cannot contain correction metadata or be void.',
        );
      }
      roots.push(fact);
      continue;
    }
    if (fact.correctionReason === null || fact.supersedesObservationId === fact.id) {
      return chainFailure(
        fact.supersedesObservationId === fact.id
          ? 'observation_correction_cycle'
          : 'observation_invalid_correction',
        'A correction fact contains malformed chain metadata.',
      );
    }
    const parent = byId.get(fact.supersedesObservationId);
    if (parent === undefined) {
      return chainFailure(
        'observation_data_integrity_failure',
        'The correction chain references a missing parent fact.',
      );
    }
    if (parent.habitId !== fact.habitId) {
      return chainFailure(
        'observation_context_mismatch',
        'A correction cannot cross habit boundaries.',
      );
    }
    if (childByParent.has(parent.id)) {
      return chainFailure(
        'observation_correction_branch',
        'One observation fact is superseded by multiple corrections.',
      );
    }
    childByParent.set(parent.id, fact);
  }

  if (roots.length === 0) {
    return chainFailure(
      'observation_correction_cycle',
      'The correction chain contains no reachable root.',
    );
  }
  if (roots.length !== 1) {
    return chainFailure(
      'observation_data_integrity_failure',
      'A correction chain must contain exactly one root.',
    );
  }

  const ordered: ObservationFact[] = [];
  const visited = new Set<PlannerId>();
  let current: ObservationFact | undefined = roots[0];
  while (current !== undefined) {
    if (visited.has(current.id)) {
      return chainFailure(
        'observation_correction_cycle',
        'The correction chain contains a cycle.',
      );
    }
    visited.add(current.id);
    ordered.push(current);
    current = childByParent.get(current.id);
  }
  if (visited.size !== unorderedFacts.length) {
    return chainFailure(
      'observation_correction_cycle',
      'The correction chain contains a disconnected cycle or malformed branch.',
    );
  }

  const currentLeaf = ordered[ordered.length - 1];
  if (
    options.selectedObservationId !== undefined &&
    options.selectedObservationId !== currentLeaf.id
  ) {
    return chainFailure(
      'observation_not_current_leaf',
      'Only the current observation leaf may be corrected.',
    );
  }

  return success(Object.freeze({
    root: ordered[0],
    facts: Object.freeze(ordered),
    currentLeaf,
    isVoided: currentLeaf.value.type === 'void',
    measuredType,
  }));
}

function chainFailure(
  code: Parameters<typeof createPlannerDomainError>[0],
  message: string,
): Result<never, PlannerDomainError> {
  return failure(createPlannerDomainError(code, message));
}
