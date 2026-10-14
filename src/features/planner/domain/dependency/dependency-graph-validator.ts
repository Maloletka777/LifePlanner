import {
  createPlannerDomainError,
  type PlannerDomainError,
} from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import {
  comparePlannerLocalDates,
  type PlannerLocalDate,
} from '../values/local-date';
import type { PlannerId } from '../values/planner-id';
import type {
  DependencyOccurrenceMode,
  DependencyType,
} from '../values/stored-values';
import type { EffectiveRange } from '../validation/effective-range';

export const MAX_DEPENDENCY_GRAPH_DEPTH = 5;

export interface EffectiveDependencyEdge {
  readonly relationshipId: PlannerId;
  readonly relationshipVersionId: PlannerId;
  readonly parentHabitId: PlannerId;
  readonly dependentHabitId: PlannerId;
  readonly dependencyType: DependencyType;
  readonly occurrenceMode: DependencyOccurrenceMode;
  readonly effectiveRange: EffectiveRange;
}

export type CandidateDependencyEdge = EffectiveDependencyEdge;

export interface DependencyTopologyInterval {
  readonly effectiveFrom: PlannerLocalDate;
  readonly effectiveTo: PlannerLocalDate | null;
}

export type DependencyGraphValidationErrorCode =
  | 'dependency_self_link'
  | 'dependency_duplicate_relationship'
  | 'dependency_second_active_parent'
  | 'dependency_cycle'
  | 'dependency_depth_exceeded';

export interface DependencyGraphErrorDetails {
  readonly interval: DependencyTopologyInterval;
  readonly parentHabitId?: PlannerId;
  readonly dependentHabitId?: PlannerId;
  readonly evidencePath?: readonly PlannerId[];
  readonly incomingParentIds?: readonly PlannerId[];
  readonly maximumDepth?: number;
}

export interface DependencyGraphValidationError extends PlannerDomainError {
  readonly code: DependencyGraphValidationErrorCode;
  readonly details: DependencyGraphErrorDetails;
}

export interface DependencyGraphValidationResult {
  readonly intervals: readonly DependencyTopologyInterval[];
  readonly maximumDepth: number;
}

export function validateDependencyGraph(
  existingEdges: readonly EffectiveDependencyEdge[],
  candidate: CandidateDependencyEdge,
): Result<DependencyGraphValidationResult, DependencyGraphValidationError> {
  const intervals = partitionCandidateRange(existingEdges, candidate);
  let maximumDepth = 0;

  for (const interval of intervals) {
    const applicableEdges = [...existingEdges]
      .filter((edge) => isEdgeApplicableAt(edge, interval.effectiveFrom))
      .concat(candidate)
      .sort(compareEdges);

    const intervalResult = validateTopology(applicableEdges, interval);
    if (!intervalResult.ok) {
      return intervalResult;
    }
    maximumDepth = Math.max(maximumDepth, intervalResult.value);
  }

  return success(
    Object.freeze({
      intervals: Object.freeze(intervals),
      maximumDepth,
    }),
  );
}

export function partitionCandidateRange(
  existingEdges: readonly EffectiveDependencyEdge[],
  candidate: CandidateDependencyEdge,
): readonly DependencyTopologyInterval[] {
  const boundaries = new Set<PlannerLocalDate>([
    candidate.effectiveRange.effectiveFrom,
  ]);
  if (candidate.effectiveRange.effectiveTo !== null) {
    boundaries.add(candidate.effectiveRange.effectiveTo);
  }

  for (const edge of existingEdges) {
    if (!rangesIntersect(edge.effectiveRange, candidate.effectiveRange)) {
      continue;
    }
    if (isStrictlyInsideCandidate(edge.effectiveRange.effectiveFrom, candidate)) {
      boundaries.add(edge.effectiveRange.effectiveFrom);
    }
    if (
      edge.effectiveRange.effectiveTo !== null &&
      isStrictlyInsideCandidate(edge.effectiveRange.effectiveTo, candidate)
    ) {
      boundaries.add(edge.effectiveRange.effectiveTo);
    }
  }

  const ordered = [...boundaries].sort(compareDates);
  const intervals: DependencyTopologyInterval[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const effectiveFrom = ordered[index];
    const nextBoundary = ordered[index + 1] ?? null;
    const effectiveTo =
      nextBoundary ?? candidate.effectiveRange.effectiveTo ?? null;
    if (
      effectiveTo !== null &&
      comparePlannerLocalDates(effectiveFrom, effectiveTo) >= 0
    ) {
      continue;
    }
    intervals.push(Object.freeze({ effectiveFrom, effectiveTo }));
    if (effectiveTo === candidate.effectiveRange.effectiveTo) {
      break;
    }
  }
  return Object.freeze(intervals);
}

function validateTopology(
  edges: readonly EffectiveDependencyEdge[],
  interval: DependencyTopologyInterval,
): Result<number, DependencyGraphValidationError> {
  for (const edge of edges) {
    if (edge.parentHabitId === edge.dependentHabitId) {
      return graphFailure(
        'dependency_self_link',
        'A habit cannot depend on itself.',
        interval,
        {
          parentHabitId: edge.parentHabitId,
          dependentHabitId: edge.dependentHabitId,
        },
      );
    }
  }

  for (let index = 1; index < edges.length; index += 1) {
    const previous = edges[index - 1];
    const current = edges[index];
    if (
      previous.parentHabitId === current.parentHabitId &&
      previous.dependentHabitId === current.dependentHabitId
    ) {
      return graphFailure(
        'dependency_duplicate_relationship',
        'The parent and dependent already have an applicable relationship.',
        interval,
        {
          parentHabitId: current.parentHabitId,
          dependentHabitId: current.dependentHabitId,
        },
      );
    }
  }

  const incoming = new Map<PlannerId, PlannerId[]>();
  for (const edge of edges) {
    const parents = incoming.get(edge.dependentHabitId) ?? [];
    parents.push(edge.parentHabitId);
    incoming.set(edge.dependentHabitId, parents);
  }
  for (const dependentHabitId of [...incoming.keys()].sort()) {
    const parents = incoming.get(dependentHabitId) ?? [];
    const uniqueParents = [...new Set(parents)].sort() as PlannerId[];
    if (uniqueParents.length > 1) {
      return graphFailure(
        'dependency_second_active_parent',
        'A dependent cannot have more than one applicable parent.',
        interval,
        {
          dependentHabitId,
          incomingParentIds: Object.freeze(uniqueParents),
        },
      );
    }
  }

  const adjacency = buildAdjacency(edges);
  const cyclePath = findCycle(adjacency);
  if (cyclePath !== null) {
    return graphFailure(
      'dependency_cycle',
      'The dependency would create a cycle.',
      interval,
      { evidencePath: Object.freeze(cyclePath) },
    );
  }

  const depthEvidence = findMaximumDepth(adjacency, incoming);
  if (depthEvidence.depth > MAX_DEPENDENCY_GRAPH_DEPTH) {
    return graphFailure(
      'dependency_depth_exceeded',
      'The dependency would create a path longer than five edges.',
      interval,
      {
        evidencePath: Object.freeze(depthEvidence.path),
        maximumDepth: depthEvidence.depth,
      },
    );
  }

  return success(depthEvidence.depth);
}

function buildAdjacency(
  edges: readonly EffectiveDependencyEdge[],
): ReadonlyMap<PlannerId, readonly PlannerId[]> {
  const mutable = new Map<PlannerId, Set<PlannerId>>();
  for (const edge of edges) {
    const children = mutable.get(edge.parentHabitId) ?? new Set<PlannerId>();
    children.add(edge.dependentHabitId);
    mutable.set(edge.parentHabitId, children);
    if (!mutable.has(edge.dependentHabitId)) {
      mutable.set(edge.dependentHabitId, new Set<PlannerId>());
    }
  }
  const adjacency = new Map<PlannerId, readonly PlannerId[]>();
  for (const node of [...mutable.keys()].sort()) {
    adjacency.set(node, Object.freeze([...(mutable.get(node) ?? [])].sort()));
  }
  return adjacency;
}

function findCycle(
  adjacency: ReadonlyMap<PlannerId, readonly PlannerId[]>,
): PlannerId[] | null {
  const visiting = new Set<PlannerId>();
  const visited = new Set<PlannerId>();
  const path: PlannerId[] = [];

  const visit = (node: PlannerId): PlannerId[] | null => {
    if (visited.has(node)) return null;
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      return [...path.slice(start), node];
    }
    visiting.add(node);
    path.push(node);
    for (const child of adjacency.get(node) ?? []) {
      const cycle = visit(child);
      if (cycle !== null) return cycle;
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const node of [...adjacency.keys()].sort()) {
    const cycle = visit(node);
    if (cycle !== null) return cycle;
  }
  return null;
}

function findMaximumDepth(
  adjacency: ReadonlyMap<PlannerId, readonly PlannerId[]>,
  incoming: ReadonlyMap<PlannerId, readonly PlannerId[]>,
): Readonly<{ depth: number; path: PlannerId[] }> {
  const roots = [...adjacency.keys()]
    .filter((node) => (incoming.get(node)?.length ?? 0) === 0)
    .sort();
  let maximum = { depth: 0, path: [] as PlannerId[] };

  const visit = (node: PlannerId, path: PlannerId[]): void => {
    const nextPath = [...path, node];
    const children = adjacency.get(node) ?? [];
    if (children.length === 0) {
      const depth = Math.max(0, nextPath.length - 1);
      if (depth > maximum.depth) {
        maximum = { depth, path: nextPath };
      }
      return;
    }
    for (const child of children) visit(child, nextPath);
  };

  for (const root of roots) visit(root, []);
  return maximum;
}

function graphFailure(
  code: DependencyGraphValidationErrorCode,
  message: string,
  interval: DependencyTopologyInterval,
  details: Omit<DependencyGraphErrorDetails, 'interval'>,
): Result<never, DependencyGraphValidationError> {
  const completeDetails = Object.freeze({ interval, ...details });
  return failure(
    Object.freeze({
      ...createPlannerDomainError(code, message, {
        path: 'dependencyGraph',
        diagnostics: {
          intervalFrom: interval.effectiveFrom,
          intervalTo: interval.effectiveTo,
          ...(details.maximumDepth === undefined
            ? {}
            : { maximumDepth: details.maximumDepth }),
        },
      }),
      code,
      details: completeDetails,
    }),
  );
}

function isEdgeApplicableAt(
  edge: EffectiveDependencyEdge,
  date: PlannerLocalDate,
): boolean {
  return (
    comparePlannerLocalDates(edge.effectiveRange.effectiveFrom, date) <= 0 &&
    (edge.effectiveRange.effectiveTo === null ||
      comparePlannerLocalDates(date, edge.effectiveRange.effectiveTo) < 0)
  );
}

function rangesIntersect(left: EffectiveRange, right: EffectiveRange): boolean {
  return !(
    (left.effectiveTo !== null &&
      comparePlannerLocalDates(left.effectiveTo, right.effectiveFrom) <= 0) ||
    (right.effectiveTo !== null &&
      comparePlannerLocalDates(right.effectiveTo, left.effectiveFrom) <= 0)
  );
}

function isStrictlyInsideCandidate(
  date: PlannerLocalDate,
  candidate: CandidateDependencyEdge,
): boolean {
  return (
    comparePlannerLocalDates(date, candidate.effectiveRange.effectiveFrom) > 0 &&
    (candidate.effectiveRange.effectiveTo === null ||
      comparePlannerLocalDates(date, candidate.effectiveRange.effectiveTo) < 0)
  );
}

function compareDates(left: PlannerLocalDate, right: PlannerLocalDate): number {
  return comparePlannerLocalDates(left, right);
}

function compareEdges(
  left: EffectiveDependencyEdge,
  right: EffectiveDependencyEdge,
): number {
  return (
    left.parentHabitId.localeCompare(right.parentHabitId) ||
    left.dependentHabitId.localeCompare(right.dependentHabitId) ||
    left.relationshipId.localeCompare(right.relationshipId) ||
    left.relationshipVersionId.localeCompare(right.relationshipVersionId)
  );
}
