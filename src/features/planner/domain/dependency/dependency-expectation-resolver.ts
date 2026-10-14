import {
  createPlannerDomainError,
  type PlannerDomainError,
} from '../errors/planner-domain-error';
import type { HabitQualificationResult } from '../qualification/habit-qualification-evaluator';
import { failure, success, type Result } from '../result';
import { isLocalDateInEffectiveRange } from '../validation/effective-range';
import type { PlannerId } from '../values/planner-id';
import type { PlannerLocalDate } from '../values/local-date';
import type { DependencyType } from '../values/stored-values';
import {
  MAX_DEPENDENCY_GRAPH_DEPTH,
  type EffectiveDependencyEdge,
} from './dependency-graph-validator';

export type DependencyExpectationState =
  | 'expected_incomplete'
  | 'qualified'
  | 'provisional'
  | 'blocked'
  | 'prerequisite_blocked_parent'
  | 'skipped_policy_unresolved';

export type DependencyExpectationReason =
  | 'no_current_fact'
  | 'voided'
  | 'parent_not_qualified'
  | 'prerequisite_not_qualified'
  | 'evaluation_window_open'
  | 'skipped_policy_pending'
  | null;

export interface DependencyExpectationHabitInput {
  readonly habitId: PlannerId;
  readonly sortOrder: number;
  readonly qualification: HabitQualificationResult;
}

export interface DependencyExpectationInput {
  readonly selectedLocalDate: PlannerLocalDate;
  readonly rootHabitId: PlannerId;
  readonly rootOccurrenceScheduled: boolean;
  readonly relationships: readonly EffectiveDependencyEdge[];
  readonly habits: readonly DependencyExpectationHabitInput[];
  readonly maximumDepth?: number;
}

export interface DependencyExpectationRow {
  readonly habitId: PlannerId;
  readonly rootHabitId: PlannerId;
  readonly parentHabitId: PlannerId | null;
  readonly relationshipVersionId: PlannerId | null;
  readonly dependencyType: DependencyType | null;
  readonly depth: number;
  readonly displayOrder: number;
  readonly state: DependencyExpectationState;
  readonly reason: DependencyExpectationReason;
  readonly qualification: HabitQualificationResult;
}

export interface DependencyExpectationResult {
  readonly rootHabitId: PlannerId;
  readonly rows: readonly DependencyExpectationRow[];
}

interface ResolvedNode {
  readonly state: DependencyExpectationState;
  readonly reason: DependencyExpectationReason;
  readonly children: readonly ResolvedChild[];
}

interface ResolvedChild {
  readonly relationship: EffectiveDependencyEdge;
  readonly node: ResolvedNode;
}

export function resolveDependencyExpectations(
  input: DependencyExpectationInput,
): Result<DependencyExpectationResult, PlannerDomainError> {
  if (!input.rootOccurrenceScheduled) {
    return expectationFailure(
      'expectation_root_not_scheduled',
      'The root habit has no scheduled occurrence for the selected date.',
    );
  }
  const maximumDepth = input.maximumDepth ?? MAX_DEPENDENCY_GRAPH_DEPTH;
  if (!Number.isInteger(maximumDepth) || maximumDepth < 0) {
    return expectationFailure(
      'expectation_depth_exceeded',
      'The expectation depth limit is invalid.',
    );
  }

  const habits = new Map<PlannerId, DependencyExpectationHabitInput>();
  for (const habit of input.habits) {
    if (habits.has(habit.habitId)) {
      return expectationFailure(
        'expectation_configuration_ambiguous',
        'A habit has more than one expectation configuration.',
      );
    }
    habits.set(habit.habitId, habit);
  }
  if (!habits.has(input.rootHabitId)) {
    return expectationFailure(
      'expectation_configuration_missing',
      'The root habit expectation configuration is missing.',
    );
  }

  const applicable = input.relationships
    .filter((relationship) =>
      isLocalDateInEffectiveRange(
        input.selectedLocalDate,
        relationship.effectiveRange,
      ),
    )
    .sort((left, right) => compareRelationships(left, right, habits));
  const outgoing = new Map<PlannerId, EffectiveDependencyEdge[]>();
  const incoming = new Map<PlannerId, EffectiveDependencyEdge>();
  for (const relationship of applicable) {
    if (relationship.occurrenceMode !== 'inherited_parent') {
      return expectationFailure(
        'expectation_relationship_context_invalid',
        'The relationship occurrence mode is unsupported.',
      );
    }
    if (!habits.has(relationship.parentHabitId)) {
      return expectationFailure(
        'expectation_parent_missing',
        'An expectation relationship parent is missing.',
      );
    }
    if (!habits.has(relationship.dependentHabitId)) {
      return expectationFailure(
        'expectation_dependent_missing',
        'An expectation relationship dependent is missing.',
      );
    }
    if (incoming.has(relationship.dependentHabitId)) {
      return expectationFailure(
        'expectation_relationship_context_invalid',
        'A dependent has more than one applicable incoming relationship.',
      );
    }
    incoming.set(relationship.dependentHabitId, relationship);
    const children = outgoing.get(relationship.parentHabitId) ?? [];
    children.push(relationship);
    outgoing.set(relationship.parentHabitId, children);
  }
  if (containsCycle(applicable)) {
    return expectationFailure(
      'expectation_cycle_detected',
      'The persisted expectation graph contains a cycle.',
    );
  }
  if (incoming.has(input.rootHabitId)) {
    return expectationFailure(
      'expectation_relationship_context_invalid',
      'The selected expectation root has an incoming relationship.',
    );
  }
  for (const children of outgoing.values()) {
    children.sort((left, right) => compareRelationships(left, right, habits));
  }

  const visiting = new Set<PlannerId>();
  const visited = new Set<PlannerId>();
  const resolveNode = (
    habitId: PlannerId,
    expected: boolean,
    depth: number,
  ): Result<ResolvedNode, PlannerDomainError> => {
    if (depth > maximumDepth) {
      return expectationFailure(
        'expectation_depth_exceeded',
        'The persisted expectation graph exceeds the approved depth.',
      );
    }
    if (visiting.has(habitId)) {
      return expectationFailure(
        'expectation_cycle_detected',
        'The persisted expectation graph contains a cycle.',
      );
    }
    visiting.add(habitId);
    visited.add(habitId);

    const childRelationships = outgoing.get(habitId) ?? [];
    const prerequisiteChildren: ResolvedChild[] = [];
    for (const relationship of childRelationships.filter(
      ({ dependencyType }) => dependencyType === 'prerequisite',
    )) {
      const child = resolveNode(relationship.dependentHabitId, true, depth + 1);
      if (!child.ok) return child;
      prerequisiteChildren.push(Object.freeze({ relationship, node: child.value }));
    }

    const habit = habits.get(habitId);
    if (habit === undefined) {
      return expectationFailure(
        'expectation_configuration_missing',
        'A habit expectation configuration is missing.',
      );
    }
    const own = stateFromQualification(habit.qualification, expected);
    const prerequisiteQualified = prerequisiteChildren.every(
      ({ node }) => node.state === 'qualified',
    );
    const state =
      own.state === 'qualified' && !prerequisiteQualified
        ? ('prerequisite_blocked_parent' as const)
        : own.state;
    const reason =
      state === 'prerequisite_blocked_parent'
        ? ('prerequisite_not_qualified' as const)
        : own.reason;

    const followUpChildren: ResolvedChild[] = [];
    for (const relationship of childRelationships.filter(
      ({ dependencyType }) => dependencyType === 'follow_up',
    )) {
      const child = resolveNode(
        relationship.dependentHabitId,
        state === 'qualified',
        depth + 1,
      );
      if (!child.ok) return child;
      followUpChildren.push(Object.freeze({ relationship, node: child.value }));
    }
    visiting.delete(habitId);
    return success(
      Object.freeze({
        state,
        reason,
        children: Object.freeze(
          [...prerequisiteChildren, ...followUpChildren].sort((left, right) =>
            compareRelationships(left.relationship, right.relationship, habits),
          ),
        ),
      }),
    );
  };

  const root = resolveNode(input.rootHabitId, true, 0);
  if (!root.ok) return root;
  if (visited.size !== applicable.length + 1) {
    return expectationFailure(
      'expectation_relationship_context_invalid',
      'The supplied expectation graph contains a disconnected relationship.',
    );
  }

  const rows: DependencyExpectationRow[] = [];
  let displayOrder = 0;
  const append = (
    habitId: PlannerId,
    node: ResolvedNode,
    depth: number,
    relationship: EffectiveDependencyEdge | null,
  ): void => {
    rows.push(
      Object.freeze({
        habitId,
        rootHabitId: input.rootHabitId,
        parentHabitId: relationship?.parentHabitId ?? null,
        relationshipVersionId: relationship?.relationshipVersionId ?? null,
        dependencyType: relationship?.dependencyType ?? null,
        depth,
        displayOrder,
        state: node.state,
        reason: node.reason,
        qualification: habits.get(habitId)!.qualification,
      }),
    );
    displayOrder += 1;
    for (const child of node.children) {
      append(
        child.relationship.dependentHabitId,
        child.node,
        depth + 1,
        child.relationship,
      );
    }
  };
  append(input.rootHabitId, root.value, 0, null);
  return success(
    Object.freeze({ rootHabitId: input.rootHabitId, rows: Object.freeze(rows) }),
  );
}

function containsCycle(
  relationships: readonly EffectiveDependencyEdge[],
): boolean {
  const outgoing = new Map<PlannerId, PlannerId[]>();
  const nodes = new Set<PlannerId>();
  for (const relationship of relationships) {
    nodes.add(relationship.parentHabitId);
    nodes.add(relationship.dependentHabitId);
    const children = outgoing.get(relationship.parentHabitId) ?? [];
    children.push(relationship.dependentHabitId);
    outgoing.set(relationship.parentHabitId, children);
  }
  for (const children of outgoing.values()) children.sort();

  const visiting = new Set<PlannerId>();
  const visited = new Set<PlannerId>();
  const visit = (habitId: PlannerId): boolean => {
    if (visiting.has(habitId)) return true;
    if (visited.has(habitId)) return false;
    visiting.add(habitId);
    for (const childId of outgoing.get(habitId) ?? []) {
      if (visit(childId)) return true;
    }
    visiting.delete(habitId);
    visited.add(habitId);
    return false;
  };
  return [...nodes].sort().some(visit);
}

function stateFromQualification(
  qualification: HabitQualificationResult,
  expected: boolean,
): Readonly<{
  state: DependencyExpectationState;
  reason: DependencyExpectationReason;
}> {
  if (!expected) {
    return Object.freeze({ state: 'blocked', reason: 'parent_not_qualified' });
  }
  switch (qualification.state) {
    case 'qualified':
      return Object.freeze({ state: 'qualified', reason: null });
    case 'provisional':
      return Object.freeze({
        state: 'provisional',
        reason: 'evaluation_window_open',
      });
    case 'skipped_policy_unresolved':
      return Object.freeze({
        state: 'skipped_policy_unresolved',
        reason: 'skipped_policy_pending',
      });
    case 'voided':
      return Object.freeze({ state: 'expected_incomplete', reason: 'voided' });
    case 'no_current_fact':
      return Object.freeze({
        state: 'expected_incomplete',
        reason: 'no_current_fact',
      });
    case 'incomplete':
      return Object.freeze({ state: 'expected_incomplete', reason: null });
    default:
      return Object.freeze({ state: 'expected_incomplete', reason: null });
  }
}

function compareRelationships(
  left: EffectiveDependencyEdge,
  right: EffectiveDependencyEdge,
  habits: ReadonlyMap<PlannerId, DependencyExpectationHabitInput>,
): number {
  return (
    (habits.get(left.dependentHabitId)?.sortOrder ?? 0) -
      (habits.get(right.dependentHabitId)?.sortOrder ?? 0) ||
    left.dependentHabitId.localeCompare(right.dependentHabitId) ||
    left.relationshipId.localeCompare(right.relationshipId) ||
    left.relationshipVersionId.localeCompare(right.relationshipVersionId)
  );
}

function expectationFailure(
  code: Parameters<typeof createPlannerDomainError>[0],
  message: string,
): Result<never, PlannerDomainError> {
  return failure(createPlannerDomainError(code, message));
}
