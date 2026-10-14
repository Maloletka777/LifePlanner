import {
  failure,
  parsePlannerLocalDate,
  success,
  type PlannerId,
  type PlannerLocalDate,
  type PlannerLocalTime,
  type Result,
} from '../../domain';
import type { HabitVisualIdentityRecord, PlannerUnitOfWork } from '../../repositories';
import {
  createGetPlannerOccurrencesForDate,
  plannerOccurrenceActionAvailable,
  type GetPlannerOccurrencesForDate,
  type PlannerOccurrenceQueryError,
  type SelectedDatePlannerOccurrenceRow,
  type SelectedDatePlannerReadModel,
  type SelectedDatePlannerRootGroup,
} from './get-planner-occurrences-for-date';

export type PlannerScheduleRootType =
  | 'simple_root'
  | 'routine_container'
  | 'legacy_organizational_parent';

export interface PlannerScheduleActionEntry {
  readonly habitId: PlannerId;
  readonly title: string;
  readonly owningRootHabitId: PlannerId;
  readonly plannedLocalTime: PlannerLocalTime | null;
  readonly timing: 'timed' | 'all_day';
  readonly availability: 'available' | 'blocked' | 'unavailable';
  readonly state: SelectedDatePlannerOccurrenceRow['state'];
  readonly reason: SelectedDatePlannerOccurrenceRow['reason'];
  readonly ordinaryCompletionRole: SelectedDatePlannerOccurrenceRow['ordinaryCompletionRole'];
  readonly countsAsScheduledAction: boolean;
  readonly canonicalOrder: number;
}

export interface PlannerScheduleGroupEntry {
  readonly rootHabitId: PlannerId;
  readonly rootTitle: string;
  readonly rootVisualIdentity: HabitVisualIdentityRecord;
  readonly rootType: PlannerScheduleRootType;
  readonly rootApplicability: 'applicable' | 'no_applicable_steps';
  readonly rootPlannedLocalTime: PlannerLocalTime | null;
  readonly rootActionAvailability: 'available' | 'blocked' | 'unavailable' | 'not_applicable';
  readonly directScheduledActions: readonly PlannerScheduleActionEntry[];
  readonly nestedGroups: readonly PlannerScheduleGroupEntry[];
  readonly applicableStepCount: number;
  readonly timedDirectStepCount: number;
  readonly allDayDirectStepCount: number;
  readonly canonicalOrder: number;
}

export interface PlannerScheduleSummaryForDate {
  readonly localDate: PlannerLocalDate;
  /** Applicable top-level canonical roots only. */
  readonly rootCount: number;
  /** Applicable routine containers at any grouped depth. */
  readonly routineCount: number;
  /** Applicable top-level independently scheduled roots without ordinary children. */
  readonly simpleRootCount: number;
  /** Applicable top-level organizational parents that retain an independent action. */
  readonly legacyOrganizationalParentCount: number;
  /** Available independent completion actions after canonical grouping. */
  readonly scheduledActionCount: number;
  readonly timedActionCount: number;
  readonly allDayActionCount: number;
  readonly unavailableActionCount: number;
  readonly earliestTimedAction: PlannerScheduleActionEntry | null;
  readonly groupedEntries: readonly PlannerScheduleGroupEntry[];
}

export interface GetPlannerScheduleSummaryForDateQuery {
  readonly localDate: string;
  readonly evaluationBoundary: string;
}

export type GetPlannerScheduleSummaryForDateResult = Result<
  PlannerScheduleSummaryForDate,
  PlannerOccurrenceQueryError
>;

export type GetPlannerScheduleSummaryForDate = (
  query: GetPlannerScheduleSummaryForDateQuery,
) => Promise<GetPlannerScheduleSummaryForDateResult>;

export function createGetPlannerScheduleSummaryForDate(
  dependencies: Readonly<
    | { unitOfWork: PlannerUnitOfWork }
    | { getPlannerOccurrencesForDate: GetPlannerOccurrencesForDate }
  >,
): GetPlannerScheduleSummaryForDate {
  const getOccurrences = 'getPlannerOccurrencesForDate' in dependencies
    ? dependencies.getPlannerOccurrencesForDate
    : createGetPlannerOccurrencesForDate({ unitOfWork: dependencies.unitOfWork });
  return async (query) => {
    const localDate = parsePlannerLocalDate(query?.localDate, 'localDate');
    const boundary = parsePlannerLocalDate(query?.evaluationBoundary, 'evaluationBoundary');
    if (!localDate.ok || !boundary.ok) {
      return failure(Object.freeze({
        name: 'PlannerOccurrenceQueryError' as const,
        code: 'occurrence_read_model_data_integrity_failure' as const,
        message: 'The schedule-summary date or evaluation boundary is invalid.',
        cause: !localDate.ok ? localDate.error : !boundary.ok ? boundary.error : undefined,
      }));
    }
    const occurrences = await getOccurrences({
      selectedLocalDate: localDate.value,
      evaluationBoundary: boundary.value,
    });
    return occurrences.ok
      ? buildPlannerScheduleSummaryForDate(occurrences.value)
      : failure(occurrences.error);
  };
}

export function buildPlannerScheduleSummaryForDate(
  occurrences: SelectedDatePlannerReadModel,
): GetPlannerScheduleSummaryForDateResult {
  const byRoot = new Map(occurrences.rootGroups.map((group) => [group.rootHabitId, group] as const));
  const childrenByParent = new Map<PlannerId, SelectedDatePlannerRootGroup[]>();
  for (const group of occurrences.rootGroups) {
    const root = group.rows[0];
    if (root === undefined) return summaryIntegrity('A schedule group is missing its canonical root row.');
    if (root.ordinaryParentHabitId === null || !byRoot.has(root.ordinaryParentHabitId)) continue;
    const children = childrenByParent.get(root.ordinaryParentHabitId) ?? [];
    children.push(group);
    childrenByParent.set(root.ordinaryParentHabitId, children);
  }

  let nextGroupOrder = 0;
  let nextActionOrder = 0;
  const actions: PlannerScheduleActionEntry[] = [];
  const visiting = new Set<PlannerId>();
  const buildGroup = (group: SelectedDatePlannerRootGroup): Result<PlannerScheduleGroupEntry | null, PlannerOccurrenceQueryError> => {
    if (visiting.has(group.rootHabitId)) return summaryIntegrity('The grouped schedule contains an ordinary-parent cycle.');
    const root = group.rows[0];
    if (root === undefined) return summaryIntegrity('A schedule group is missing its canonical root row.');
    visiting.add(group.rootHabitId);
    const groupOrder = nextGroupOrder++;
    const ordinaryChildren = childrenByParent.get(group.rootHabitId) ?? [];
    const rootType = classifyRootType(group, ordinaryChildren);
    const directRows = rootType === 'routine_container' ? [...group.rows.slice(1)] : [...group.rows];
    const nestedGroups: PlannerScheduleGroupEntry[] = [];
    for (const child of ordinaryChildren) {
      const childType = classifyRootType(child, childrenByParent.get(child.rootHabitId) ?? []);
      if (childType === 'simple_root') directRows.push(...child.rows);
      else {
        const nested = buildGroup(child);
        if (!nested.ok) return nested;
        if (nested.value !== null) nestedGroups.push(nested.value);
      }
    }
    const directActions = directRows.map((row) => {
      const available = plannerOccurrenceActionAvailable(row);
      const availability = available
        ? 'available' as const
        : row.state === 'blocked' || row.state === 'prerequisite_blocked_parent'
          ? 'blocked' as const
          : 'unavailable' as const;
      const action = Object.freeze({
        habitId: row.habitId,
        title: row.name,
        owningRootHabitId: group.rootHabitId,
        plannedLocalTime: row.plannedLocalTime,
        timing: row.plannedLocalTime === null ? 'all_day' as const : 'timed' as const,
        availability,
        state: row.state,
        reason: row.reason,
        ordinaryCompletionRole: row.ordinaryCompletionRole,
        countsAsScheduledAction: available,
        canonicalOrder: nextActionOrder++,
      });
      actions.push(action);
      return action;
    });
    visiting.delete(group.rootHabitId);
    if (
      group.routineContainer.applicability === 'no_applicable_steps' &&
      directActions.length === 0 &&
      nestedGroups.length === 0
    ) return success(null);
    const rootAvailability = rootType === 'routine_container'
      ? 'not_applicable' as const
      : directActions[0]?.availability ?? 'unavailable' as const;
    return success(Object.freeze({
      rootHabitId: group.rootHabitId,
      rootTitle: root.name,
      rootVisualIdentity: root.visualIdentity,
      rootType,
      rootApplicability: group.routineContainer.applicability === 'no_applicable_steps'
        ? 'no_applicable_steps' as const
        : 'applicable' as const,
      rootPlannedLocalTime: rootType === 'routine_container' ? null : root.plannedLocalTime,
      rootActionAvailability: rootAvailability,
      directScheduledActions: Object.freeze(orderActions(directActions)),
      nestedGroups: Object.freeze(nestedGroups),
      applicableStepCount: group.routineContainer.completionSource === 'ordinary_children_derived'
        ? group.routineContainer.ordinaryStepCount
        : 0,
      timedDirectStepCount: directActions.filter((action) => action.countsAsScheduledAction && action.timing === 'timed').length,
      allDayDirectStepCount: directActions.filter((action) => action.countsAsScheduledAction && action.timing === 'all_day').length,
      canonicalOrder: groupOrder,
    }));
  };

  const groupedEntries: PlannerScheduleGroupEntry[] = [];
  for (const group of occurrences.rootGroups) {
    const root = group.rows[0];
    if (root?.ordinaryParentHabitId !== null) continue;
    const built = buildGroup(group);
    if (!built.ok) return built;
    if (built.value !== null) groupedEntries.push(built.value);
  }
  const countedActions = orderActions(actions.filter((action) => action.countsAsScheduledAction));
  const timed = countedActions.filter((action) => action.timing === 'timed');
  const routineCount = countGroups(groupedEntries, (group) =>
    group.rootApplicability === 'applicable' && group.rootType === 'routine_container');
  return success(Object.freeze({
    localDate: occurrences.selectedLocalDate,
    rootCount: groupedEntries.filter((group) => group.rootApplicability === 'applicable').length,
    routineCount,
    simpleRootCount: groupedEntries.filter((group) => group.rootApplicability === 'applicable' && group.rootType === 'simple_root').length,
    legacyOrganizationalParentCount: groupedEntries.filter((group) => group.rootApplicability === 'applicable' && group.rootType === 'legacy_organizational_parent').length,
    scheduledActionCount: countedActions.length,
    timedActionCount: timed.length,
    allDayActionCount: countedActions.length - timed.length,
    unavailableActionCount: actions.filter((action) => !action.countsAsScheduledAction).length,
    earliestTimedAction: timed[0] ?? null,
    groupedEntries: Object.freeze(groupedEntries),
  }));
}

function classifyRootType(
  group: SelectedDatePlannerRootGroup,
  _ordinaryChildren: readonly SelectedDatePlannerRootGroup[],
): PlannerScheduleRootType {
  if (group.routineContainer.completionSource === 'ordinary_children_derived') return 'routine_container';
  return group.directOrdinaryChildren.some((child) => child.completionRole === 'organizational')
    ? 'legacy_organizational_parent'
    : 'simple_root';
}

function orderActions(actions: readonly PlannerScheduleActionEntry[]): PlannerScheduleActionEntry[] {
  return [...actions].sort((left, right) =>
    Number(left.plannedLocalTime === null) - Number(right.plannedLocalTime === null) ||
    (left.plannedLocalTime ?? '').localeCompare(right.plannedLocalTime ?? '') ||
    left.canonicalOrder - right.canonicalOrder ||
    left.habitId.localeCompare(right.habitId),
  );
}

function countGroups(
  groups: readonly PlannerScheduleGroupEntry[],
  predicate: (group: PlannerScheduleGroupEntry) => boolean,
): number {
  return groups.reduce((count, group) =>
    count + Number(predicate(group)) + countGroups(group.nestedGroups, predicate), 0);
}

function summaryIntegrity<T = never>(message: string): Result<T, PlannerOccurrenceQueryError> {
  return failure(Object.freeze({
    name: 'PlannerOccurrenceQueryError' as const,
    code: 'occurrence_read_model_data_integrity_failure' as const,
    message,
  }));
}
