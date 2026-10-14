import {
  createExactQuantity,
  calculateHabitCompletionProgress,
  calculatePlannerGroupProgress,
  calculateRoutineStepProgress,
  failure,
  multiplyProgressFraction,
  parsePlannerLocalDate,
  resolvePlannerOccurrencesForDate,
  success,
  type DependencyExpectationReason,
  type DependencyExpectationState,
  type ExactQuantity,
  type ExactProgressFraction,
  type HabitProgressExclusionReason,
  type HabitProgressValue,
  type HabitQualificationActual,
  type ImportanceLevel,
  type ImportanceWeight,
  type ObservationFact,
  type ObservationType,
  type PlannerDomainError,
  type PlannerId,
  type PlannerLocalDate,
  type PlannerDayBlock,
  type PlannerDurationMinutes,
  type PlannerLocalTime,
  type PlannerTimezone,
  type Result,
  type PlannerGroupProgress,
  type PlannerProgressMode,
  type TrackingDefinition,
} from '../../domain';
import type {
  ApplicableOrdinaryParent,
  HabitVisualIdentityRecord,
  PlannerOccurrenceDataSet,
  PlannerPersistenceError,
  PlannerUnitOfWork,
} from '../../repositories';

export interface GetPlannerOccurrencesForDateQuery {
  readonly selectedLocalDate: PlannerLocalDate;
  readonly evaluationBoundary: PlannerLocalDate;
}

export type PlannerOccurrenceActualTargetContext =
  | Readonly<{
      trackingMode: 'checkbox' | 'avoidance';
      actual: boolean | null;
      target: true;
    }>
  | Readonly<{
      trackingMode: 'counter';
      actual: ExactQuantity & { readonly scale: 0 };
      target: ExactQuantity & { readonly scale: 0 };
      comparisonOperator: 'at_least' | 'at_most' | 'equal';
      unit: Extract<TrackingDefinition, { trackingMode: 'counter' }>['unit'];
    }>
  | Readonly<{
      trackingMode: 'quantity';
      actual: ExactQuantity;
      target: ExactQuantity;
      comparisonOperator: 'at_least' | 'at_most' | 'equal';
      unit: Extract<TrackingDefinition, { trackingMode: 'quantity' }>['unit'];
    }>
  | Readonly<{
      trackingMode: 'duration';
      actualSeconds: number;
      targetSeconds: number;
      comparisonOperator: 'at_least' | 'at_most' | 'equal';
    }>;

export interface PlannerOccurrenceObservationSummary {
  readonly currentLeafCount: number;
  readonly currentLeafIds: readonly PlannerId[];
  readonly currentTypes: readonly ObservationType[];
  readonly currentEntries: readonly PlannerOccurrenceCurrentEntry[];
  readonly voidedChainCount: number;
}

export interface PlannerOccurrenceCurrentEntry {
  readonly rootObservationId: PlannerId;
  readonly currentObservationId: PlannerId;
  readonly observationType: ObservationType;
  readonly originalValue: ObservationFact['value'];
  readonly currentValue: ObservationFact['value'];
  readonly observedAt: number;
  /**
   * The time the observation says the thing happened at, as opposed to
   * {@link observedAt}, which is when the record was written. Null until
   * something sets it. The day surface places a row on this when it is present,
   * so a habit stands where it was actually done rather than where it was planned.
   */
  readonly occurrenceLocalTime: PlannerLocalTime | null;
  readonly note: string | null;
  readonly correctionCount: number;
}

export interface SelectedDatePlannerOccurrenceRow {
  readonly habitId: PlannerId;
  readonly name: string;
  readonly categoryId: PlannerId | null;
  readonly rootHabitId: PlannerId;
  readonly parentHabitId: PlannerId | null;
  readonly relationshipVersionId: PlannerId | null;
  readonly dependencyType: 'follow_up' | 'prerequisite' | null;
  readonly ordinaryParentHabitId: PlannerId | null;
  readonly ordinaryParentName: string | null;
  readonly ordinaryCompletionRole: ApplicableOrdinaryParent['completionRole'] | null;
  readonly ordinaryDepth: number;
  readonly plannedLocalTime: PlannerLocalTime | null;
  /**
   * How long this occurrence is meant to take, or `null` when nobody said.
   *
   * It reads from the same effective-dated version the minute does, so a day drawn in
   * the past shows the length that day was planned with rather than today's.
   */
  readonly plannedDurationMinutes: PlannerDurationMinutes | null;
  /**
   * Which part of the day this occurrence belongs to, or `null` for an Anytime item.
   *
   * Stored on the item and never derived from the minute: a morning routine done at
   * 12:40 stays a morning routine, which is the only way a failed morning survives in
   * the data long enough to be noticed.
   */
  readonly plannedBlock: PlannerDayBlock | null;
  readonly depth: number;
  readonly displayOrder: number;
  readonly stableSortOrder: number;
  readonly state: DependencyExpectationState;
  readonly reason: DependencyExpectationReason;
  readonly trackingMode: TrackingDefinition['trackingMode'];
  readonly importance: ImportanceLevel;
  readonly progress: PlannerOccurrenceProgressReadModel;
  readonly highlightRank: number;
  readonly highlightReason: PlannerHighlightReason;
  readonly visualIdentity: HabitVisualIdentityRecord;
  readonly actualTarget: PlannerOccurrenceActualTargetContext;
  readonly currentObservation: PlannerOccurrenceObservationSummary;
  readonly occurrenceWindowOpen: boolean;
  readonly commandContext: Readonly<{
    habitId: PlannerId;
    occurrenceLocalDate: PlannerLocalDate;
    occurrenceTimezone: PlannerTimezone;
  }>;
  /** Present only on canonical root rows; shared with the owning root group. */
  readonly routineContainer: RoutineContainerPresentation | null;
}

export interface PlannerOccurrenceProgressReadModel {
  readonly completionCredit: ExactProgressFraction;
  readonly actual: HabitProgressValue;
  readonly target: HabitProgressValue;
  readonly inclusion: 'included' | 'excluded';
  readonly exclusionReason: HabitProgressExclusionReason | null;
  readonly importance: ImportanceLevel;
  readonly historicalWeight: ImportanceWeight;
  readonly weightedCredit: ExactProgressFraction;
  /** Presentation-ready bounded scalar derived from canonical exact credit. */
  readonly displayProgress: number | null;
}

export type PlannerHighlightReason =
  | 'critical_incomplete'
  | 'high_incomplete'
  | 'next_timed_incomplete'
  | 'other_incomplete'
  | 'completed'
  | 'neutral';

export interface HabitGroupProgressRowCredit {
  readonly habitId: PlannerId;
  readonly completionCredit: ExactProgressFraction;
  readonly included: boolean;
  readonly exclusionReason: HabitProgressExclusionReason | null;
}

export interface HabitGroupProgressExclusion {
  readonly reason: HabitProgressExclusionReason;
  readonly count: number;
}

export interface HabitGroupProgress extends PlannerGroupProgress {
  readonly completionCredit: ExactProgressFraction | null;
  readonly includedCount: number;
  readonly includedExpectationCount: number;
  readonly rootCompletionCredit: ExactProgressFraction;
  readonly rowCredits: readonly HabitGroupProgressRowCredit[];
  readonly exclusionReasons: readonly HabitGroupProgressExclusion[];
  readonly selectedMode: PlannerProgressMode;
  readonly selectedProgress: ExactProgressFraction | null;
  /** Presentation-ready bounded scalar for the selected canonical group mode. */
  readonly displayProgress: number | null;
}

export type PlannerGroupProgressReadModel = HabitGroupProgress;

export interface SelectedDayRootProgress {
  readonly completedRootCount: number;
  readonly scheduledRootCount: number;
  readonly remainingRootCount: number;
}

export interface RoutineContainerPresentation {
  readonly completionSource: 'independent_observation' | 'ordinary_children_derived';
  readonly isRoutineContainer: boolean;
  readonly hasIndependentCompletionAction: boolean;
  readonly ordinaryStepCount: number;
  readonly completedOrdinaryStepCount: number;
  readonly remainingOrdinaryStepCount: number;
  readonly exactProgress: ExactProgressFraction | null;
  readonly displayProgress: number | null;
  readonly isCanonicallyComplete: boolean;
  readonly applicability: 'not_container' | 'applicable' | 'no_applicable_steps';
}

export interface SelectedDatePlannerRootGroup {
  readonly rootHabitId: PlannerId;
  readonly scheduleVersionId: PlannerId;
  readonly evaluationTimezone: PlannerTimezone;
  readonly occurrenceStart: PlannerLocalDate;
  readonly occurrenceEndExclusive: PlannerLocalDate;
  readonly occurrenceWindowOpen: boolean;
  readonly rows: readonly SelectedDatePlannerOccurrenceRow[];
  readonly progress: PlannerGroupProgressReadModel;
  readonly routineContainer: RoutineContainerPresentation;
  readonly directOrdinaryChildren: readonly PlannerOrdinaryChildPresentation[];
}

export interface PlannerOrdinaryChildPresentation {
  readonly childHabitId: PlannerId;
  readonly completionRole: ApplicableOrdinaryParent['completionRole'];
  readonly applicableOnSelectedDate: boolean;
}

type UnscoredPlannerRootGroup = Omit<SelectedDatePlannerRootGroup, 'progress' | 'routineContainer' | 'directOrdinaryChildren'>;
type ScoredPlannerRootGroup = Omit<SelectedDatePlannerRootGroup, 'routineContainer' | 'directOrdinaryChildren'>;

export interface SelectedDatePlannerReadModel {
  readonly selectedLocalDate: PlannerLocalDate;
  readonly evaluationBoundary: PlannerLocalDate;
  readonly createdHabitCount: number;
  readonly progressMode: PlannerProgressMode;
  readonly resolution: 'success' | 'no_scheduled_habits' | 'recoverable_exclusions';
  readonly recoverableExclusions: readonly SelectedDatePlannerRecoverableExclusion[];
  readonly evaluationTimezones: readonly PlannerTimezone[];
  readonly rootProgress: SelectedDayRootProgress;
  readonly rootGroups: readonly SelectedDatePlannerRootGroup[];
}

export interface SelectedDatePlannerRecoverableExclusion {
  readonly habitId: PlannerId;
  readonly reason: 'no_applicable_schedule';
}

export type PlannerOccurrenceQueryErrorCode =
  | 'occurrence_read_model_data_integrity_failure'
  | 'occurrence_read_model_database_failure';

export interface PlannerOccurrenceQueryError {
  readonly name: 'PlannerOccurrenceQueryError';
  readonly code: PlannerOccurrenceQueryErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export type GetPlannerOccurrencesForDateResult = Result<
  SelectedDatePlannerReadModel,
  PlannerOccurrenceQueryError
>;

export interface GetPlannerOccurrencesForDateDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
}

export type GetPlannerOccurrencesForDate = (
  query: GetPlannerOccurrencesForDateQuery,
) => Promise<GetPlannerOccurrencesForDateResult>;

export function createGetPlannerOccurrencesForDate(
  dependencies: GetPlannerOccurrencesForDateDependencies,
): GetPlannerOccurrencesForDate {
  return async (query) => {
    const selectedDate = parsePlannerLocalDate(
      query?.selectedLocalDate,
      'selectedLocalDate',
    );
    const evaluationBoundary = parsePlannerLocalDate(
      query?.evaluationBoundary,
      'evaluationBoundary',
    );
    if (!selectedDate.ok || !evaluationBoundary.ok) {
      const cause = !selectedDate.ok
        ? selectedDate.error
        : !evaluationBoundary.ok
          ? evaluationBoundary.error
          : undefined;
      return queryFailure(
        'occurrence_read_model_data_integrity_failure',
        'The selected date or evaluation boundary is invalid.',
        cause,
      );
    }

    let loaded;
    try {
      loaded = await dependencies.unitOfWork.loadPlannerOccurrenceData(
        selectedDate.value,
      );
    } catch (cause: unknown) {
      return queryFailure(
        'occurrence_read_model_database_failure',
        'The selected-date Planner data could not be read.',
        cause,
      );
    }
    if (!loaded.ok) return failure(mapPersistenceError(loaded.error));

    return buildSelectedDatePlannerReadModel(
      loaded.value,
      evaluationBoundary.value,
    );
  };
}

export function buildSelectedDatePlannerReadModel(
  dataSet: PlannerOccurrenceDataSet,
  boundary: PlannerLocalDate,
): GetPlannerOccurrencesForDateResult {
    const loaded = { value: dataSet } as const;
    const selectedDate = { value: dataSet.selectedLocalDate } as const;
    const evaluationBoundary = { value: boundary } as const;

    const applicableScheduleOwners = new Set(
      loaded.value.scheduleVersions.map((version) => version.habitId),
    );
    const incomingByDependent = new Map(
      loaded.value.relationships.map((relationship) => [
        relationship.dependentHabitId,
        relationship.parentHabitId,
      ] as const),
    );
    const excludedRootIds = new Set<PlannerId>();
    for (const habit of loaded.value.habits) {
      if (!incomingByDependent.has(habit.id) && !applicableScheduleOwners.has(habit.id)) {
        excludedRootIds.add(habit.id);
      }
    }
    const excludedHabitIds = new Set<PlannerId>(excludedRootIds);
    let exclusionAdded = true;
    while (exclusionAdded) {
      exclusionAdded = false;
      for (const relationship of loaded.value.relationships) {
        if (
          excludedHabitIds.has(relationship.parentHabitId) &&
          !excludedHabitIds.has(relationship.dependentHabitId)
        ) {
          excludedHabitIds.add(relationship.dependentHabitId);
          exclusionAdded = true;
        }
      }
    }
    const recoverableExclusions = Object.freeze(
      [...excludedRootIds].sort().map((habitId) =>
        Object.freeze({
          habitId,
          reason: 'no_applicable_schedule' as const,
        }),
      ),
    );
    const resolved = resolvePlannerOccurrencesForDate({
      selectedLocalDate: selectedDate.value,
      evaluationBoundary: evaluationBoundary.value,
      habits: loaded.value.habits.filter((habit) => !excludedHabitIds.has(habit.id)),
      scheduleVersions: loaded.value.scheduleVersions,
      trackingVersions: loaded.value.trackingVersions,
      importanceVersions: loaded.value.importanceVersions,
      relationships: loaded.value.relationships.filter(
        (relationship) =>
          !excludedHabitIds.has(relationship.parentHabitId) &&
          !excludedHabitIds.has(relationship.dependentHabitId),
      ),
      observationChains: loaded.value.observationChains.filter(
        (chain) => !excludedHabitIds.has(chain.currentLeaf.habitId),
      ),
    });
    if (!resolved.ok) return failure(mapDomainError(resolved.error));

    const unsortedGroups: UnscoredPlannerRootGroup[] = [];
    const habitNames = new Map(loaded.value.habits.map((habit) => [habit.id, habit.name] as const));
    const ordinaryParentByChild = new Map(loaded.value.ordinaryParents.map((edge) => [edge.childHabitId, edge.parentHabitId] as const));
    const ordinaryRoleByChild = new Map(loaded.value.ordinaryParents.map((edge) => [edge.childHabitId, edge.completionRole] as const));
    const routineParentByChild = new Map(
      loaded.value.ordinaryParents
        .filter((edge) => edge.completionRole === 'routine_step')
        .map((edge) => [edge.childHabitId, edge.parentHabitId] as const),
    );
    const plannedTimeByHabit = new Map(loaded.value.plannedTimes.map((entry) => [entry.habitId, entry] as const));
    const visualIdentityByHabit = new Map(loaded.value.visualIdentities.map((entry) => [entry.habitId, entry] as const));
    for (const group of resolved.value.groups) {
      const rows: SelectedDatePlannerOccurrenceRow[] = [];
      for (const row of group.rows) {
        const visualIdentity = visualIdentityByHabit.get(row.habit.id);
        if (visualIdentity === undefined) {
          return queryFailure(
            'occurrence_read_model_data_integrity_failure',
            'A selected-date habit is missing its visual identity.',
          );
        }
        const actualTarget = buildActualTarget(
          row.trackingVersion.definition,
          row.qualification.actual,
        );
        if (!actualTarget.ok) return actualTarget;
        const calculatedProgress = calculateHabitCompletionProgress({
          tracking: row.trackingVersion.definition,
          qualificationActual: row.qualification.actual,
          expectationState: row.state,
          expectationReason: row.reason,
          selectedLocalDate: selectedDate.value,
          evaluationBoundary: evaluationBoundary.value,
        });
        if (!calculatedProgress.ok) return failure(mapDomainError(calculatedProgress.error));
        const historicalWeight = row.importanceVersion.weight;
        const progress = Object.freeze({
          ...calculatedProgress.value,
          importance: row.importanceVersion.importance,
          historicalWeight,
          weightedCredit: multiplyProgressFraction(calculatedProgress.value.completionCredit, historicalWeight),
          displayProgress: calculatedProgress.value.inclusion === 'included'
            ? displayProgressFromFraction(calculatedProgress.value.completionCredit)
            : null,
        });
        const currentEntries = Object.freeze(
          row.observationChains
            .filter((chain) => !chain.isVoided)
            .sort((left, right) =>
              left.root.observedAt - right.root.observedAt ||
              left.root.id.localeCompare(right.root.id),
            )
            .map((chain) => Object.freeze({
              rootObservationId: chain.root.id,
              currentObservationId: chain.currentLeaf.id,
              observationType: chain.currentLeaf.observationType,
              originalValue: chain.root.value,
              currentValue: chain.currentLeaf.value,
              observedAt: chain.currentLeaf.observedAt,
              occurrenceLocalTime: chain.currentLeaf.occurrenceLocalTime,
              note: chain.currentLeaf.note,
              correctionCount: chain.facts.length - 1,
            })),
        );
        rows.push(
          Object.freeze({
            habitId: row.habit.id,
            name: row.habit.name,
            categoryId: row.habit.categoryId,
            rootHabitId: row.rootHabitId,
            parentHabitId: row.parentHabitId,
            relationshipVersionId: row.relationshipVersionId,
            dependencyType: row.dependencyType,
            ordinaryParentHabitId: ordinaryParentByChild.get(row.habit.id) ?? null,
            ordinaryParentName: habitNames.get(ordinaryParentByChild.get(row.habit.id)!) ?? null,
            ordinaryCompletionRole: ordinaryRoleByChild.get(row.habit.id) ?? null,
            ordinaryDepth: 0,
            plannedLocalTime: plannedTimeByHabit.get(row.habit.id)?.plannedLocalTime ?? null,
            plannedDurationMinutes: plannedTimeByHabit.get(row.habit.id)?.plannedDurationMinutes ?? null,
            plannedBlock: plannedTimeByHabit.get(row.habit.id)?.plannedBlock ?? null,
            depth: row.depth,
            displayOrder: row.displayOrder,
            stableSortOrder: row.habit.sortOrder,
            state: row.state,
            reason: row.reason,
            trackingMode: row.trackingVersion.definition.trackingMode,
            importance: row.importanceVersion.importance,
            progress,
            highlightRank: 0,
            highlightReason: 'neutral' as const,
            visualIdentity,
            actualTarget: actualTarget.value,
            currentObservation: Object.freeze({
              currentLeafCount: row.qualification.currentLeafCount,
              currentLeafIds: Object.freeze(
                currentEntries.map((entry) => entry.currentObservationId).sort(),
              ),
              currentTypes: Object.freeze(
                currentEntries.map((entry) => entry.observationType).sort(),
              ),
              currentEntries,
              voidedChainCount: row.observationChains.filter(
                (chain) => chain.isVoided,
              ).length,
            }),
            occurrenceWindowOpen: group.occurrenceWindow.isOpen,
            commandContext: Object.freeze({
              habitId: row.habit.id,
              occurrenceLocalDate: selectedDate.value,
              occurrenceTimezone:
                group.scheduleVersion.definition.evaluationTimezone,
            }),
            routineContainer: null,
          }),
        );
      }
      unsortedGroups.push(
        Object.freeze({
          rootHabitId: group.rootHabitId,
          scheduleVersionId: group.scheduleVersion.id,
          evaluationTimezone:
            group.scheduleVersion.definition.evaluationTimezone,
          occurrenceStart: group.occurrenceWindow.start,
          occurrenceEndExclusive: group.occurrenceWindow.endExclusive,
          occurrenceWindowOpen: group.occurrenceWindow.isOpen,
          rows: Object.freeze(rows),
        }),
      );
    }
    const parentBoundedGroups = suppressRoutineStepsOutsideParentBoundary(
      unsortedGroups,
      routineParentByChild,
    );
    const orderedGroups = orderOrdinaryGroups(parentBoundedGroups, ordinaryParentByChild);
    if (orderedGroups.length !== parentBoundedGroups.length) {
      return queryFailure(
        'occurrence_read_model_data_integrity_failure',
        'The ordinary parent hierarchy contains a cycle or an unreachable habit.',
      );
    }
    const highlightedGroups = assignPlannerHighlightRanks(orderedGroups, selectedDate.value, evaluationBoundary.value);
    const groupedProgress = attachPlannerGroupProgress(highlightedGroups, ordinaryParentByChild, loaded.value.progressMode);
    if (!groupedProgress.ok) return groupedProgress;
    const routineGroups = attachRoutineContainerPresentations(
      groupedProgress.value,
      loaded.value.ordinaryParents,
    );
    if (!routineGroups.ok) return routineGroups;
    const rootGroups = routineGroups.value;
    const rootProgress = buildSelectedDayRootProgress(rootGroups);
    if (!rootProgress.ok) return rootProgress;
    return success(
      Object.freeze({
        selectedLocalDate: selectedDate.value,
        evaluationBoundary: evaluationBoundary.value,
        createdHabitCount: loaded.value.createdHabitCount,
        progressMode: loaded.value.progressMode,
        resolution:
          recoverableExclusions.length > 0
            ? 'recoverable_exclusions'
            : rootProgress.value.scheduledRootCount === 0
              ? 'no_scheduled_habits'
              : 'success',
        recoverableExclusions,
        evaluationTimezones: Object.freeze(
          [...new Set(rootGroups.map((group) => group.evaluationTimezone))].sort(),
        ),
        rootProgress: rootProgress.value,
        rootGroups: Object.freeze(rootGroups),
      }),
    );
}

function suppressRoutineStepsOutsideParentBoundary(
  groups: readonly UnscoredPlannerRootGroup[],
  routineParentByChild: ReadonlyMap<PlannerId, PlannerId>,
): readonly UnscoredPlannerRootGroup[] {
  const visible = new Set(groups.map((group) => group.rootHabitId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [childId, parentId] of routineParentByChild) {
      if (visible.has(childId) && !visible.has(parentId)) {
        visible.delete(childId);
        changed = true;
      }
    }
  }
  return Object.freeze(groups.filter((group) => visible.has(group.rootHabitId)));
}

function orderOrdinaryGroups(
  groups: readonly UnscoredPlannerRootGroup[],
  parentByChild: ReadonlyMap<PlannerId, PlannerId>,
): readonly UnscoredPlannerRootGroup[] {
  const byRoot = new Map(groups.map((group) => [group.rootHabitId, group] as const));
  const children = new Map<PlannerId, PlannerId[]>();
  for (const [child, parent] of parentByChild) {
    if (!byRoot.has(child) || !byRoot.has(parent)) continue;
    const current = children.get(parent) ?? [];
    current.push(child);
    children.set(parent, current);
  }
  const compare = (leftId: PlannerId, rightId: PlannerId) => {
    const left = byRoot.get(leftId)!.rows[0];
    const right = byRoot.get(rightId)!.rows[0];
    const leftKey = left.plannedLocalTime ?? '99:99';
    const rightKey = right.plannedLocalTime ?? '99:99';
    return leftKey.localeCompare(rightKey) ||
      importanceSortValue(right.importance) - importanceSortValue(left.importance) ||
      left.stableSortOrder - right.stableSortOrder ||
      leftId.localeCompare(rightId);
  };
  const top = groups.map((group) => group.rootHabitId).filter((id) => !byRoot.has(parentByChild.get(id)!)).sort(compare);
  const ordered: UnscoredPlannerRootGroup[] = [];
  const visit = (id: PlannerId, depth: number) => {
    const group = byRoot.get(id);
    if (group === undefined) return;
    ordered.push(Object.freeze({ ...group, rows: Object.freeze(group.rows.map((row) => Object.freeze({ ...row, ordinaryDepth: row.habitId === id ? depth : depth + row.depth }))) }));
    for (const child of (children.get(id) ?? []).sort(compare)) visit(child, depth + 1);
  };
  for (const id of top) visit(id, 0);
  return Object.freeze(ordered);
}

function importanceSortValue(importance: ImportanceLevel): number {
  return ({ low: 1, normal: 2, high: 3, critical: 4 } as const)[importance];
}

function assignPlannerHighlightRanks(
  groups: readonly UnscoredPlannerRootGroup[],
  selectedLocalDate: PlannerLocalDate,
  evaluationBoundary: PlannerLocalDate,
): readonly UnscoredPlannerRootGroup[] {
  const rows = groups.flatMap((group) => group.rows);
  const incomplete = rows.filter((row) =>
    row.state === 'expected_incomplete' &&
    row.occurrenceWindowOpen &&
    selectedLocalDate <= evaluationBoundary,
  );
  const critical = incomplete.filter(({ importance }) => importance === 'critical').sort(compareHighlightRows);
  const high = incomplete.filter(({ importance }) => importance === 'high').sort(compareHighlightRows);
  const other = incomplete.filter(({ importance }) => importance !== 'critical' && importance !== 'high').sort(compareHighlightRows);
  const nextTimed = other.find(({ plannedLocalTime }) => plannedLocalTime !== null) ?? null;
  const ordered = [
    ...critical.map((row) => ({ row, reason: 'critical_incomplete' as const })),
    ...high.map((row) => ({ row, reason: 'high_incomplete' as const })),
    ...(nextTimed === null ? [] : [{ row: nextTimed, reason: 'next_timed_incomplete' as const }]),
    ...other.filter((row) => row !== nextTimed).map((row) => ({ row, reason: 'other_incomplete' as const })),
    ...rows.filter((row) => row.state !== 'qualified' && !incomplete.includes(row)).sort(compareHighlightRows).map((row) => ({ row, reason: 'neutral' as const })),
    ...rows.filter(({ state }) => state === 'qualified').sort(compareHighlightRows).map((row) => ({ row, reason: 'completed' as const })),
  ];
  const rankByHabit = new Map(ordered.map(({ row, reason }, index) => [row.habitId, { rank: index + 1, reason }] as const));
  return Object.freeze(groups.map((group) => Object.freeze({
    ...group,
    rows: Object.freeze(group.rows.map((row) => {
      const highlight = rankByHabit.get(row.habitId);
      return Object.freeze({
        ...row,
        highlightRank: highlight?.rank ?? ordered.length + 1,
        highlightReason: highlight?.reason ?? 'neutral',
      });
    })),
  })));
}

function compareHighlightRows(left: SelectedDatePlannerOccurrenceRow, right: SelectedDatePlannerOccurrenceRow): number {
  return (left.plannedLocalTime ?? '99:99').localeCompare(right.plannedLocalTime ?? '99:99') ||
    importanceSortValue(right.importance) - importanceSortValue(left.importance) ||
    left.stableSortOrder - right.stableSortOrder ||
    left.habitId.localeCompare(right.habitId);
}

function attachPlannerGroupProgress(
  groups: readonly UnscoredPlannerRootGroup[],
  parentByChild: ReadonlyMap<PlannerId, PlannerId>,
  selectedMode: PlannerProgressMode,
): Result<readonly ScoredPlannerRootGroup[], PlannerOccurrenceQueryError> {
  const byRoot = new Map(groups.map((group) => [group.rootHabitId, group] as const));
  const ordinaryChildren = new Map<PlannerId, PlannerId[]>();
  for (const [child, parent] of parentByChild) {
    if (!byRoot.has(child) || !byRoot.has(parent)) continue;
    const children = ordinaryChildren.get(parent) ?? [];
    children.push(child);
    ordinaryChildren.set(parent, children);
  }
  const result: ScoredPlannerRootGroup[] = [];
  for (const group of groups) {
    const descendantRootIds: PlannerId[] = [];
    const visited = new Set<PlannerId>([group.rootHabitId]);
    const visit = (rootId: PlannerId): boolean => {
      for (const childId of ordinaryChildren.get(rootId) ?? []) {
        if (visited.has(childId)) return false;
        visited.add(childId);
        descendantRootIds.push(childId);
        if (!visit(childId)) return false;
      }
      return true;
    };
    if (!visit(group.rootHabitId)) {
      return queryFailure(
        'occurrence_read_model_data_integrity_failure',
        'The ordinary parent hierarchy contains a cycle.',
      );
    }
    const scopeRows = [group.rootHabitId, ...descendantRootIds]
      .flatMap((rootId) => byRoot.get(rootId)?.rows ?? []);
    const calculated = calculatePlannerGroupProgress(scopeRows.map((row) => ({
      included: row.progress.inclusion === 'included',
      completionCredit: row.progress.completionCredit,
      historicalWeight: row.progress.historicalWeight,
      isChild: row.habitId !== group.rootHabitId,
      qualified: row.state === 'qualified',
    })));
    if (!calculated.ok) return failure(mapDomainError(calculated.error));
    const exclusionCounts = new Map<HabitProgressExclusionReason, number>();
    for (const row of scopeRows) {
      if (row.progress.exclusionReason === null) continue;
      exclusionCounts.set(row.progress.exclusionReason, (exclusionCounts.get(row.progress.exclusionReason) ?? 0) + 1);
    }
    const rootRow = scopeRows.find((row) => row.habitId === group.rootHabitId);
    if (rootRow === undefined) {
      return queryFailure(
        'occurrence_read_model_data_integrity_failure',
        'A Planner group is missing its canonical root occurrence.',
      );
    }
    const selectedProgress = selectedMode === 'weighted'
      ? calculated.value.weightedProgress
      : calculated.value.equalProgress;
    const progress = Object.freeze({
      ...calculated.value,
      completionCredit: calculated.value.equalProgress,
      includedCount: calculated.value.includedRowCount,
      includedExpectationCount: calculated.value.includedRowCount,
      rootCompletionCredit: rootRow.progress.completionCredit,
      rowCredits: Object.freeze(scopeRows.map((row) => Object.freeze({
        habitId: row.habitId,
        completionCredit: row.progress.completionCredit,
        included: row.progress.inclusion === 'included',
        exclusionReason: row.progress.exclusionReason,
      }))),
      exclusionReasons: Object.freeze([...exclusionCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, count]) => Object.freeze({ reason, count }))),
      selectedMode,
      selectedProgress,
      displayProgress: selectedProgress === null ? null : displayProgressFromFraction(selectedProgress),
    });
    result.push(Object.freeze({ ...group, progress }));
  }
  return success(Object.freeze(result));
}

function attachRoutineContainerPresentations(
  groups: readonly ScoredPlannerRootGroup[],
  ordinaryParents: readonly ApplicableOrdinaryParent[],
): Result<readonly SelectedDatePlannerRootGroup[], PlannerOccurrenceQueryError> {
  const byRoot = new Map(groups.map((group) => [group.rootHabitId, group] as const));
  const routineChildren = new Map<PlannerId, PlannerId[]>();
  for (const edge of ordinaryParents) {
    if (edge.completionRole !== 'routine_step') continue;
    const children = routineChildren.get(edge.parentHabitId) ?? [];
    children.push(edge.childHabitId);
    routineChildren.set(edge.parentHabitId, children);
  }
  for (const children of routineChildren.values()) children.sort((left, right) => left.localeCompare(right));

  const presentations = new Map<PlannerId, RoutineContainerPresentation>();
  const visiting = new Set<PlannerId>();
  const resolve = (
    rootId: PlannerId,
  ): Result<RoutineContainerPresentation, PlannerOccurrenceQueryError> => {
    const existing = presentations.get(rootId);
    if (existing !== undefined) return success(existing);
    const group = byRoot.get(rootId);
    const rootRow = group?.rows[0];
    if (group === undefined || rootRow === undefined) {
      return queryFailure(
        'occurrence_read_model_data_integrity_failure',
        'A routine container is missing its canonical root occurrence.',
      );
    }
    if (visiting.has(rootId)) {
      return queryFailure(
        'occurrence_read_model_data_integrity_failure',
        'The routine-step hierarchy contains a cycle.',
      );
    }
    visiting.add(rootId);
    const childIds = routineChildren.get(rootId) ?? [];
    if (childIds.length === 0) {
      const presentation = Object.freeze({
        completionSource: 'independent_observation' as const,
        isRoutineContainer: false,
        hasIndependentCompletionAction: plannerOccurrenceActionAvailable(rootRow),
        ordinaryStepCount: 0,
        completedOrdinaryStepCount: 0,
        remainingOrdinaryStepCount: 0,
        exactProgress: null,
        displayProgress: null,
        isCanonicallyComplete: rootRow.state === 'qualified',
        applicability: 'not_container' as const,
      });
      visiting.delete(rootId);
      presentations.set(rootId, presentation);
      return success(presentation);
    }

    const stepInputs = [];
    for (const childId of childIds) {
      const childGroup = byRoot.get(childId);
      const childRow = childGroup?.rows[0];
      if (childGroup === undefined || childRow === undefined) {
        stepInputs.push(Object.freeze({
          applicable: false,
          completionCredit: Object.freeze({ numerator: 0n, denominator: 1n }),
          isCanonicallyComplete: false,
        }));
        continue;
      }
      const childPresentation = resolve(childId);
      if (!childPresentation.ok) return childPresentation;
      if (childPresentation.value.completionSource === 'ordinary_children_derived') {
        stepInputs.push(Object.freeze({
          applicable: childPresentation.value.applicability === 'applicable',
          completionCredit: childPresentation.value.exactProgress ?? Object.freeze({ numerator: 0n, denominator: 1n }),
          isCanonicallyComplete: childPresentation.value.isCanonicallyComplete,
        }));
        continue;
      }
      stepInputs.push(Object.freeze({
        applicable: childRow.progress.exclusionReason !== 'skipped_policy_unresolved',
        completionCredit: childRow.progress.completionCredit,
        isCanonicallyComplete: childRow.state === 'qualified',
      }));
    }
    const calculated = calculateRoutineStepProgress(stepInputs);
    if (!calculated.ok) return failure(mapDomainError(calculated.error));
    const presentation = Object.freeze({
      completionSource: 'ordinary_children_derived' as const,
      isRoutineContainer: calculated.value.applicableStepCount > 0,
      hasIndependentCompletionAction: false,
      ordinaryStepCount: calculated.value.applicableStepCount,
      completedOrdinaryStepCount: calculated.value.completedStepCount,
      remainingOrdinaryStepCount: calculated.value.remainingStepCount,
      exactProgress: calculated.value.exactProgress,
      displayProgress: calculated.value.exactProgress === null
        ? null
        : displayProgressFromFraction(calculated.value.exactProgress),
      isCanonicallyComplete: calculated.value.isCanonicallyComplete,
      applicability: calculated.value.applicableStepCount === 0
        ? 'no_applicable_steps' as const
        : 'applicable' as const,
    });
    visiting.delete(rootId);
    presentations.set(rootId, presentation);
    return success(presentation);
  };

  const result: SelectedDatePlannerRootGroup[] = [];
  for (const group of groups) {
    const presentation = resolve(group.rootHabitId);
    if (!presentation.ok) return presentation;
    result.push(Object.freeze({
      ...group,
      rows: Object.freeze(group.rows.map((row, index) => index === 0
        ? Object.freeze({ ...row, routineContainer: presentation.value })
        : row)),
      routineContainer: presentation.value,
      directOrdinaryChildren: Object.freeze(ordinaryParents
        .filter((edge) => edge.parentHabitId === group.rootHabitId)
        .sort((left, right) => left.childHabitId.localeCompare(right.childHabitId))
        .map((edge) => Object.freeze({
          childHabitId: edge.childHabitId,
          completionRole: edge.completionRole,
          applicableOnSelectedDate: byRoot.has(edge.childHabitId),
        }))),
    }));
  }
  return success(Object.freeze(result));
}

export function plannerOccurrenceActionAvailable(row: SelectedDatePlannerOccurrenceRow): boolean {
  if (row.state === 'blocked' || row.state === 'skipped_policy_unresolved') return false;
  if (row.state !== 'prerequisite_blocked_parent') return true;
  return row.actualTarget.trackingMode === 'checkbox' && row.actualTarget.actual === true;
}

export function buildSelectedDayRootProgress(
  groups: readonly SelectedDatePlannerRootGroup[],
): Result<SelectedDayRootProgress, PlannerOccurrenceQueryError> {
  const roots = groups.filter((group) => {
    const row = group.rows[0];
    return row !== undefined &&
      row.ordinaryParentHabitId === null &&
      group.routineContainer.applicability !== 'no_applicable_steps';
  });
  if (groups.some((group) => group.rows[0] === undefined)) {
    return queryFailure(
      'occurrence_read_model_data_integrity_failure',
      'A selected-day Planner group is missing its canonical root occurrence.',
    );
  }
  const scheduledRootCount = roots.length;
  const completedRootCount = roots.filter((group) => group.routineContainer.isCanonicallyComplete).length;
  if (
    !Number.isSafeInteger(scheduledRootCount) ||
    !Number.isSafeInteger(completedRootCount) ||
    completedRootCount < 0 ||
    completedRootCount > scheduledRootCount
  ) {
    return queryFailure(
      'occurrence_read_model_data_integrity_failure',
      'Selected-day root progress violates its bounded count invariant.',
    );
  }
  return success(Object.freeze({
    completedRootCount,
    scheduledRootCount,
    remainingRootCount: scheduledRootCount - completedRootCount,
  }));
}

export function displayProgressFromFraction(value: ExactProgressFraction): number {
  if (value.numerator <= 0n) return 0;
  if (value.numerator >= value.denominator) return 1;
  const basisPoints = value.numerator * 10_000n / value.denominator;
  return Number(basisPoints) / 10_000;
}

function buildActualTarget(
  tracking: TrackingDefinition,
  actual: HabitQualificationActual | null,
): Result<PlannerOccurrenceActualTargetContext, PlannerOccurrenceQueryError> {
  switch (tracking.trackingMode) {
    case 'checkbox':
    case 'avoidance':
      return success(
        Object.freeze({
          trackingMode: tracking.trackingMode,
          actual: actual?.kind === 'boolean' ? actual.value : null,
          target: true as const,
        }),
      );
    case 'counter': {
      const zero = createExactQuantity({ significand: 0n, scale: 0 });
      if (!zero.ok) return mapStaticExactFailure(zero.error);
      return success(
        Object.freeze({
          trackingMode: 'counter' as const,
          actual:
            actual?.kind === 'counter'
              ? actual.value
              : (zero.value as ExactQuantity & { readonly scale: 0 }),
          target: tracking.target,
          comparisonOperator: tracking.comparisonOperator,
          unit: tracking.unit,
        }),
      );
    }
    case 'quantity': {
      const zero = createExactQuantity({
        significand: 0n,
        scale: tracking.target.scale,
      });
      if (!zero.ok) return mapStaticExactFailure(zero.error);
      return success(
        Object.freeze({
          trackingMode: 'quantity' as const,
          actual: actual?.kind === 'quantity' ? actual.value : zero.value,
          target: tracking.target,
          comparisonOperator: tracking.comparisonOperator,
          unit: tracking.unit,
        }),
      );
    }
    case 'duration':
      return success(
        Object.freeze({
          trackingMode: 'duration' as const,
          actualSeconds: actual?.kind === 'duration' ? actual.seconds : 0,
          targetSeconds: tracking.targetDurationSeconds,
          comparisonOperator: tracking.comparisonOperator,
        }),
      );
    default:
      return queryFailure(
        'occurrence_read_model_data_integrity_failure',
        'The selected-date tracking mode is unsupported.',
      );
  }
}

function mapStaticExactFailure(
  error: PlannerDomainError,
): Result<never, PlannerOccurrenceQueryError> {
  return queryFailure(
    'occurrence_read_model_data_integrity_failure',
    'The selected-date exact value could not be represented.',
    error,
  );
}

function mapPersistenceError(
  error: PlannerPersistenceError,
): PlannerOccurrenceQueryError {
  return createQueryError(
    error.code === 'occurrence_read_model_database_failure'
      ? 'occurrence_read_model_database_failure'
      : 'occurrence_read_model_data_integrity_failure',
    error.message,
    error,
  );
}

function mapDomainError(error: PlannerDomainError): PlannerOccurrenceQueryError {
  return createQueryError(
    'occurrence_read_model_data_integrity_failure',
    'The selected-date Planner data could not be resolved.',
    error,
  );
}

function queryFailure<T = never>(
  code: PlannerOccurrenceQueryErrorCode,
  message: string,
  cause?: unknown,
): Result<T, PlannerOccurrenceQueryError> {
  return failure(createQueryError(code, message, cause));
}

function createQueryError(
  code: PlannerOccurrenceQueryErrorCode,
  message: string,
  cause?: unknown,
): PlannerOccurrenceQueryError {
  return Object.freeze({
    name: 'PlannerOccurrenceQueryError' as const,
    code,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}
