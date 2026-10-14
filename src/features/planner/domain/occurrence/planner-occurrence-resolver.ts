import {
  createPlannerDomainError,
  type PlannerDomainError,
} from '../errors/planner-domain-error';
import type { ObservationChain } from '../observation/observation';
import type {
  ObservationScheduleVersionContext,
  ObservationTrackingVersionContext,
} from '../observation/observation-context-validator';
import {
  evaluateHabitQualification,
  type HabitQualificationResult,
} from '../qualification/habit-qualification-evaluator';
import { failure, success, type Result } from '../result';
import {
  evaluateSchedule,
  type ScheduleEvaluation,
} from '../schedule/schedule-evaluator';
import { isLocalDateInEffectiveRange, type EffectiveRange } from '../validation/effective-range';
import type { ImportanceWeight } from '../values/importance';
import {
  addPlannerCalendarDays,
  comparePlannerLocalDates,
  type PlannerLocalDate,
} from '../values/local-date';
import type { PlannerId } from '../values/planner-id';
import type { ImportanceLevel, Lifecycle } from '../values/stored-values';
import {
  resolveDependencyExpectations,
  type DependencyExpectationReason,
  type DependencyExpectationState,
} from '../dependency/dependency-expectation-resolver';
import type { EffectiveDependencyEdge } from '../dependency/dependency-graph-validator';

export interface PlannerOccurrenceHabitInput {
  readonly id: PlannerId;
  readonly name: string;
  readonly categoryId: PlannerId | null;
  readonly activeRange: EffectiveRange;
  readonly lifecycle: Lifecycle;
  readonly sortOrder: number;
}

export interface PlannerOccurrenceImportanceVersionInput {
  readonly id: PlannerId;
  readonly habitId: PlannerId;
  readonly importance: ImportanceLevel;
  readonly weight: ImportanceWeight;
  readonly effectiveRange: EffectiveRange;
}

export interface ResolvePlannerOccurrencesInput {
  readonly selectedLocalDate: PlannerLocalDate;
  readonly evaluationBoundary: PlannerLocalDate;
  readonly habits: readonly PlannerOccurrenceHabitInput[];
  readonly scheduleVersions: readonly ObservationScheduleVersionContext[];
  readonly trackingVersions: readonly ObservationTrackingVersionContext[];
  readonly importanceVersions: readonly PlannerOccurrenceImportanceVersionInput[];
  readonly relationships: readonly EffectiveDependencyEdge[];
  readonly observationChains: readonly ObservationChain[];
  readonly maximumDepth?: number;
}

export interface ResolvedOccurrenceWindow {
  readonly start: PlannerLocalDate;
  readonly endExclusive: PlannerLocalDate;
  readonly isOpen: boolean;
}

export interface ResolvedPlannerOccurrenceRow {
  readonly habit: PlannerOccurrenceHabitInput;
  readonly rootHabitId: PlannerId;
  readonly parentHabitId: PlannerId | null;
  readonly relationshipVersionId: PlannerId | null;
  readonly dependencyType: EffectiveDependencyEdge['dependencyType'] | null;
  readonly depth: number;
  readonly displayOrder: number;
  readonly state: DependencyExpectationState;
  readonly reason: DependencyExpectationReason;
  readonly qualification: HabitQualificationResult;
  readonly trackingVersion: ObservationTrackingVersionContext;
  readonly importanceVersion: PlannerOccurrenceImportanceVersionInput;
  readonly observationChains: readonly ObservationChain[];
}

export interface ResolvedPlannerOccurrenceGroup {
  readonly rootHabitId: PlannerId;
  readonly scheduleVersion: ObservationScheduleVersionContext;
  readonly scheduleEvaluation: Extract<
    ScheduleEvaluation,
    { kind: 'applicable_fixed_date' | 'applicable_flexible_period' }
  >;
  readonly occurrenceWindow: ResolvedOccurrenceWindow;
  readonly rows: readonly ResolvedPlannerOccurrenceRow[];
}

export interface ResolvedPlannerOccurrences {
  readonly selectedLocalDate: PlannerLocalDate;
  readonly evaluationBoundary: PlannerLocalDate;
  readonly groups: readonly ResolvedPlannerOccurrenceGroup[];
}

export function resolvePlannerOccurrencesForDate(
  input: ResolvePlannerOccurrencesInput,
): Result<ResolvedPlannerOccurrences, PlannerDomainError> {
  const habits = uniqueById(input.habits, input.selectedLocalDate);
  if (!habits.ok) return habits;
  const applicableRelationships = input.relationships.filter((relationship) =>
    isLocalDateInEffectiveRange(
      input.selectedLocalDate,
      relationship.effectiveRange,
    ),
  );
  const incoming = new Map<PlannerId, EffectiveDependencyEdge>();
  for (const relationship of applicableRelationships) {
    if (!habits.value.has(relationship.parentHabitId)) {
      return readIntegrity(
        'expectation_parent_missing',
        'An applicable relationship parent is not active for the selected date.',
      );
    }
    if (!habits.value.has(relationship.dependentHabitId)) {
      return readIntegrity(
        'expectation_dependent_missing',
        'An applicable relationship dependent is not active for the selected date.',
      );
    }
    if (incoming.has(relationship.dependentHabitId)) {
      return readIntegrity(
        'expectation_relationship_context_invalid',
        'A dependent has multiple applicable incoming relationships.',
      );
    }
    incoming.set(relationship.dependentHabitId, relationship);
  }
  const topology = validateApplicableTopology(
    applicableRelationships,
    input.maximumDepth ?? 5,
  );
  if (!topology.ok) return topology;

  const roots = [...habits.value.values()]
    .filter((habit) => !incoming.has(habit.id))
    .sort(compareHabits);
  const groups: ResolvedPlannerOccurrenceGroup[] = [];
  const represented = new Set<PlannerId>();
  for (const root of roots) {
    const schedules = applicableForHabit(
      input.scheduleVersions,
      root.id,
      input.selectedLocalDate,
      (version) => version.definition.effectiveRange,
    );
    if (schedules.length === 0) {
      return readIntegrity(
        'expectation_configuration_missing',
        'An independently scheduled habit has no applicable schedule.',
      );
    }
    if (schedules.length > 1) {
      return readIntegrity(
        'expectation_configuration_ambiguous',
        'An independently scheduled habit has multiple applicable schedules.',
      );
    }
    const schedule = schedules[0];
    if (schedule.habitId !== root.id) {
      return readIntegrity(
        'expectation_relationship_context_invalid',
        'The root schedule belongs to another habit.',
      );
    }
    const evaluated = evaluateSchedule({
      evaluatedLocalDate: input.selectedLocalDate,
      habitActiveRange: root.activeRange,
      schedule: schedule.definition,
      evaluationTimezone: schedule.definition.evaluationTimezone,
      comparisonBoundary: input.evaluationBoundary,
    });
    if (!evaluated.ok) return evaluated;
    if (
      evaluated.value.kind === 'not_scheduled' ||
      evaluated.value.kind === 'outside_habit_active_range' ||
      evaluated.value.kind === 'outside_schedule_effective_range'
    ) {
      continue;
    }
    const window = occurrenceWindow(evaluated.value, input.evaluationBoundary);
    if (!window.ok) return window;

    const groupRelationships = collectReachableRelationships(
      root.id,
      applicableRelationships,
    );
    const groupHabitIds = new Set<PlannerId>([root.id]);
    for (const relationship of groupRelationships) {
      groupHabitIds.add(relationship.parentHabitId);
      groupHabitIds.add(relationship.dependentHabitId);
    }
    const qualificationInputs = [];
    const rowContext = new Map<
      PlannerId,
      Readonly<{
        tracking: ObservationTrackingVersionContext;
        importance: PlannerOccurrenceImportanceVersionInput;
        chains: readonly ObservationChain[];
        qualification: HabitQualificationResult;
      }>
    >();
    for (const habitId of [...groupHabitIds].sort()) {
      const habit = habits.value.get(habitId);
      if (habit === undefined) {
        return readIntegrity(
          'expectation_configuration_missing',
          'A reachable occurrence habit is missing.',
        );
      }
      const tracking = applicableForHabit(
        input.trackingVersions,
        habitId,
        input.selectedLocalDate,
        (version) => version.definition.effectiveRange,
      );
      const importance = applicableForHabit(
        input.importanceVersions,
        habitId,
        input.selectedLocalDate,
        (version) => version.effectiveRange,
      );
      if (tracking.length === 0 || importance.length === 0) {
        return readIntegrity(
          'expectation_configuration_missing',
          'A reachable habit is missing tracking or importance configuration.',
        );
      }
      if (tracking.length > 1 || importance.length > 1) {
        return readIntegrity(
          'expectation_configuration_ambiguous',
          'A reachable habit has ambiguous tracking or importance configuration.',
        );
      }
      const relationship = incoming.get(habitId) ?? null;
      const chains = input.observationChains
        .filter((chain) =>
          chain.currentLeaf.habitId === habitId &&
          chain.currentLeaf.scheduleVersionId === schedule.id &&
          chain.currentLeaf.occurrenceLocalDate >= window.value.start &&
          chain.currentLeaf.occurrenceLocalDate < window.value.endExclusive &&
          (relationship === null
            ? chain.currentLeaf.dependencyVersionId === null
            : chain.currentLeaf.dependencyVersionId ===
              relationship.relationshipVersionId),
        )
        .sort((left, right) => left.root.id.localeCompare(right.root.id));
      const contradictory = input.observationChains.some((chain) =>
        chain.currentLeaf.habitId === habitId &&
        chain.currentLeaf.occurrenceLocalDate >= window.value.start &&
        chain.currentLeaf.occurrenceLocalDate < window.value.endExclusive &&
        (chain.currentLeaf.scheduleVersionId !== schedule.id ||
          chain.currentLeaf.trackingVersionId !== tracking[0].id ||
          chain.currentLeaf.importanceVersionId !== importance[0].id ||
          (relationship === null
            ? chain.currentLeaf.dependencyVersionId !== null
            : chain.currentLeaf.dependencyVersionId !==
              relationship.relationshipVersionId)),
      );
      if (contradictory) {
        return readIntegrity(
          'expectation_observation_context_invalid',
          'A current observation references context outside the selected occurrence.',
        );
      }
      const qualification = evaluateHabitQualification({
        tracking: tracking[0].definition,
        observationChains: chains,
        evaluationWindow: window.value.isOpen ? 'open' : 'closed',
      });
      if (!qualification.ok) return qualification;
      qualificationInputs.push({
        habitId,
        sortOrder: habit.sortOrder,
        qualification: qualification.value,
      });
      rowContext.set(
        habitId,
        Object.freeze({
          tracking: tracking[0],
          importance: importance[0],
          chains: Object.freeze(chains),
          qualification: qualification.value,
        }),
      );
    }

    const expectation = resolveDependencyExpectations({
      selectedLocalDate: input.selectedLocalDate,
      rootHabitId: root.id,
      rootOccurrenceScheduled: true,
      relationships: groupRelationships,
      habits: qualificationInputs,
      ...(input.maximumDepth === undefined
        ? {}
        : { maximumDepth: input.maximumDepth }),
    });
    if (!expectation.ok) return expectation;
    const rows: ResolvedPlannerOccurrenceRow[] = [];
    for (const expected of expectation.value.rows) {
      const context = rowContext.get(expected.habitId);
      const habit = habits.value.get(expected.habitId);
      if (context === undefined || habit === undefined) {
        return readIntegrity(
          'expectation_configuration_missing',
          'A resolved expectation row is missing configuration.',
        );
      }
      represented.add(habit.id);
      rows.push(
        Object.freeze({
          habit,
          rootHabitId: root.id,
          parentHabitId: expected.parentHabitId,
          relationshipVersionId: expected.relationshipVersionId,
          dependencyType: expected.dependencyType,
          depth: expected.depth,
          displayOrder: expected.displayOrder,
          state: expected.state,
          reason: expected.reason,
          qualification: context.qualification,
          trackingVersion: context.tracking,
          importanceVersion: context.importance,
          observationChains: context.chains,
        }),
      );
    }
    groups.push(
      Object.freeze({
        rootHabitId: root.id,
        scheduleVersion: schedule,
        scheduleEvaluation: evaluated.value,
        occurrenceWindow: window.value,
        rows: Object.freeze(rows),
      }),
    );
  }

  for (const relationship of applicableRelationships) {
    if (
      !represented.has(relationship.parentHabitId) &&
      !represented.has(relationship.dependentHabitId)
    ) {
      const root = findRoot(relationship.parentHabitId, incoming);
      if (!habits.value.has(root)) {
        return readIntegrity(
          'expectation_relationship_context_invalid',
          'An applicable relationship has no valid root.',
        );
      }
    }
  }
  return success(
    Object.freeze({
      selectedLocalDate: input.selectedLocalDate,
      evaluationBoundary: input.evaluationBoundary,
      groups: Object.freeze(groups),
    }),
  );
}

function uniqueById(
  values: readonly PlannerOccurrenceHabitInput[],
  selectedLocalDate: PlannerLocalDate,
): Result<ReadonlyMap<PlannerId, PlannerOccurrenceHabitInput>, PlannerDomainError> {
  const map = new Map<PlannerId, PlannerOccurrenceHabitInput>();
  for (const value of values) {
    if (map.has(value.id)) {
      return readIntegrity(
        'expectation_configuration_ambiguous',
        'The selected-date data contains duplicate habits.',
      );
    }
    if (
      value.lifecycle !== 'active' ||
      !isLocalDateInEffectiveRange(selectedLocalDate, value.activeRange)
    ) {
      return readIntegrity(
        'expectation_relationship_context_invalid',
        'The selected-date data contains an ineligible habit.',
      );
    }
    map.set(value.id, value);
  }
  return success(map);
}

function validateApplicableTopology(
  relationships: readonly EffectiveDependencyEdge[],
  maximumDepth: number,
): Result<null, PlannerDomainError> {
  if (!Number.isInteger(maximumDepth) || maximumDepth < 0) {
    return readIntegrity(
      'expectation_depth_exceeded',
      'The occurrence depth limit is invalid.',
    );
  }
  const outgoing = new Map<PlannerId, PlannerId[]>();
  const incoming = new Set<PlannerId>();
  const nodes = new Set<PlannerId>();
  for (const relationship of relationships) {
    nodes.add(relationship.parentHabitId);
    nodes.add(relationship.dependentHabitId);
    incoming.add(relationship.dependentHabitId);
    const children = outgoing.get(relationship.parentHabitId) ?? [];
    children.push(relationship.dependentHabitId);
    outgoing.set(relationship.parentHabitId, children);
  }
  for (const children of outgoing.values()) children.sort();
  const visiting = new Set<PlannerId>();
  const visited = new Set<PlannerId>();
  const walk = (
    node: PlannerId,
    depth: number,
  ): Result<null, PlannerDomainError> => {
    if (depth > maximumDepth) {
      return readIntegrity(
        'expectation_depth_exceeded',
        'The persisted occurrence graph exceeds the approved depth.',
      );
    }
    if (visiting.has(node)) {
      return readIntegrity(
        'expectation_cycle_detected',
        'The persisted occurrence graph contains a cycle.',
      );
    }
    if (visited.has(node)) return success(null);
    visiting.add(node);
    for (const child of outgoing.get(node) ?? []) {
      const result = walk(child, depth + 1);
      if (!result.ok) return result;
    }
    visiting.delete(node);
    visited.add(node);
    return success(null);
  };
  for (const root of [...nodes].filter((node) => !incoming.has(node)).sort()) {
    const result = walk(root, 0);
    if (!result.ok) return result;
  }
  if (visited.size !== nodes.size) {
    return readIntegrity(
      'expectation_cycle_detected',
      'The persisted occurrence graph contains a disconnected cycle.',
    );
  }
  return success(null);
}

function applicableForHabit<T extends Readonly<{ habitId: PlannerId }>>(
  values: readonly T[],
  habitId: PlannerId,
  date: PlannerLocalDate,
  range: (value: T) => EffectiveRange,
): T[] {
  return values.filter(
    (value) =>
      value.habitId === habitId && isLocalDateInEffectiveRange(date, range(value)),
  );
}

function collectReachableRelationships(
  rootHabitId: PlannerId,
  relationships: readonly EffectiveDependencyEdge[],
): EffectiveDependencyEdge[] {
  const outgoing = new Map<PlannerId, EffectiveDependencyEdge[]>();
  for (const relationship of relationships) {
    const children = outgoing.get(relationship.parentHabitId) ?? [];
    children.push(relationship);
    outgoing.set(relationship.parentHabitId, children);
  }
  const result: EffectiveDependencyEdge[] = [];
  const queue = [rootHabitId];
  const visited = new Set<PlannerId>();
  while (queue.length > 0) {
    const parent = queue.shift()!;
    if (visited.has(parent)) continue;
    visited.add(parent);
    const children = [...(outgoing.get(parent) ?? [])].sort((left, right) =>
      left.dependentHabitId.localeCompare(right.dependentHabitId),
    );
    for (const child of children) {
      result.push(child);
      queue.push(child.dependentHabitId);
    }
  }
  return result;
}

function occurrenceWindow(
  evaluation: Extract<
    ScheduleEvaluation,
    { kind: 'applicable_fixed_date' | 'applicable_flexible_period' }
  >,
  boundary: PlannerLocalDate,
): Result<ResolvedOccurrenceWindow, PlannerDomainError> {
  if (evaluation.kind === 'applicable_flexible_period') {
    return success(
      Object.freeze({
        start: evaluation.periodStart,
        endExclusive: evaluation.periodEndExclusive,
        isOpen:
          comparePlannerLocalDates(boundary, evaluation.periodEndExclusive) < 0,
      }),
    );
  }
  const end = addPlannerCalendarDays(evaluation.occurrenceLocalDate, 1);
  if (!end.ok) return end;
  return success(
    Object.freeze({
      start: evaluation.occurrenceLocalDate,
      endExclusive: end.value,
      isOpen: comparePlannerLocalDates(boundary, end.value) < 0,
    }),
  );
}

function findRoot(
  habitId: PlannerId,
  incoming: ReadonlyMap<PlannerId, EffectiveDependencyEdge>,
): PlannerId {
  const visited = new Set<PlannerId>();
  let current = habitId;
  while (incoming.has(current) && !visited.has(current)) {
    visited.add(current);
    current = incoming.get(current)!.parentHabitId;
  }
  return current;
}

function compareHabits(
  left: PlannerOccurrenceHabitInput,
  right: PlannerOccurrenceHabitInput,
): number {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

function readIntegrity(
  code: Parameters<typeof createPlannerDomainError>[0],
  message: string,
): Result<never, PlannerDomainError> {
  return failure(createPlannerDomainError(code, message));
}
