import {
  addPlannerCalendarDays,
  failure,
  parsePlannerId,
  parsePlannerLocalDate,
  success,
  type ObservationChain,
  type PlannerId,
  type PlannerLocalDate,
  type Result,
} from '../../domain';
import type {
  PlannerHabitDependencyDetail,
  PlannerHabitOrdinaryRelationshipDetail,
  PlannerPersistenceError,
  PlannerUnitOfWork,
  RoutineConversionPersistenceConflict,
  RoutineConversionReceipt,
} from '../../repositories';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';

export interface RoutineConversionPreviewQuery {
  readonly parentHabitId: string;
  readonly requestedEffectiveLocalDate: string;
  readonly childHabitIds?: readonly string[];
}

export interface RoutineConversionRelationshipPreview {
  readonly relationshipId: PlannerId;
  readonly currentRelationshipVersionId: PlannerId;
  readonly currentVersionNumber: number;
  readonly childHabitId: PlannerId;
  readonly childTitle: string;
  readonly effectiveFrom: PlannerLocalDate;
  readonly effectiveTo: PlannerLocalDate | null;
}

export interface RoutineConversionIneligibleRelationship {
  readonly childHabitId: PlannerId;
  readonly relationshipId: PlannerId | null;
  readonly reason:
    | 'child_inactive'
    | 'selected_child_not_direct'
    | 'selected_relationship_not_organizational';
}

export interface RoutineConversionConditionalExclusion {
  readonly relationshipId: PlannerId;
  readonly childHabitId: PlannerId;
  readonly childTitle: string;
  readonly dependencyType: 'follow_up' | 'prerequisite';
}

export interface RoutineConversionParentObservation {
  readonly rootObservationId: PlannerId;
  readonly currentObservationId: PlannerId;
  readonly occurrenceLocalDate: PlannerLocalDate;
  readonly isVoided: boolean;
}

export interface RoutineConversionConflict {
  readonly code:
    | 'parent_inactive'
    | 'requested_date_outside_parent_range'
    | 'no_eligible_organizational_children'
    | 'selected_child_not_eligible'
    | 'parent_observation_on_or_after_boundary'
    | 'ordinary_hierarchy_cycle'
    | 'ordinary_hierarchy_depth_exceeded';
  readonly childHabitId?: PlannerId;
  readonly observationCount?: number;
  readonly earliestSafeEffectiveDate?: PlannerLocalDate;
}

export interface RoutineConversionPreview {
  readonly parentHabitId: PlannerId;
  readonly requestedEffectiveLocalDate: PlannerLocalDate;
  readonly eligibleRelationships: readonly RoutineConversionRelationshipPreview[];
  readonly ineligibleRelationships: readonly RoutineConversionIneligibleRelationship[];
  readonly retainedOrganizationalRelationships: readonly RoutineConversionRelationshipPreview[];
  readonly conditionalRelationshipsExcluded: readonly RoutineConversionConditionalExclusion[];
  readonly alreadyRoutineStepRelationships: readonly RoutineConversionRelationshipPreview[];
  readonly parentObservationsOnOrAfterBoundary: readonly RoutineConversionParentObservation[];
  readonly earliestSafeEffectiveDate: PlannerLocalDate | null;
  readonly conversionAllowed: boolean;
  readonly conflicts: readonly RoutineConversionConflict[];
  readonly resultingDirectRoutineStepCount: number;
  readonly retainedOrganizationalChildCount: number;
  readonly mixedStructure: boolean;
  readonly wouldBecomeRoutineContainer: boolean;
}

export interface RoutineConversionPreviewError {
  readonly name: 'RoutineConversionPreviewError';
  readonly code: 'invalid_input' | 'not_found' | 'data_integrity_failure' | 'database_failure';
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
}

export type GetRoutineConversionPreviewResult = Result<RoutineConversionPreview, RoutineConversionPreviewError>;
export type GetRoutineConversionPreview = (query: RoutineConversionPreviewQuery) => Promise<GetRoutineConversionPreviewResult>;

export type ConvertOrganizationalParentToRoutineCommand = RoutineConversionPreviewQuery;

export interface ConvertOrganizationalParentToRoutineError {
  readonly name: 'ConvertOrganizationalParentToRoutineError';
  readonly code:
    | 'invalid_input'
    | 'not_found'
    | 'conversion_conflict'
    | 'stale_conflict'
    | 'data_integrity_failure'
    | 'database_failure';
  readonly message: string;
  readonly preview?: RoutineConversionPreview;
  readonly earliestSafeEffectiveDate?: PlannerLocalDate;
  readonly cause?: unknown;
}

export type ConvertOrganizationalParentToRoutineResult = Result<RoutineConversionReceipt, ConvertOrganizationalParentToRoutineError>;
export type ConvertOrganizationalParentToRoutine = (
  command: ConvertOrganizationalParentToRoutineCommand,
) => Promise<ConvertOrganizationalParentToRoutineResult>;

export function createGetRoutineConversionPreview(
  dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork }>,
): GetRoutineConversionPreview {
  return async (query) => {
    const parsed = parsePreviewQuery(query);
    if (!parsed.ok) return parsed;
    const { parentHabitId, requestedEffectiveLocalDate, childHabitIds } = parsed.value;
    try {
      const [detail, catalogue, occurrenceData] = await Promise.all([
        dependencies.unitOfWork.getPlannerHabitDetail(parentHabitId, requestedEffectiveLocalDate),
        dependencies.unitOfWork.listPlannerHabits({ lifecycle: 'all', asOfLocalDate: requestedEffectiveLocalDate }),
        dependencies.unitOfWork.loadPlannerOccurrenceData(requestedEffectiveLocalDate),
      ]);
      if (!detail.ok || !catalogue.ok || !occurrenceData.ok) {
        const error = !detail.ok ? detail.error : !catalogue.ok ? catalogue.error : !occurrenceData.ok ? occurrenceData.error : undefined;
        return failure(mapPreviewPersistenceError(error));
      }
      if (detail.value === null) return previewFailure('not_found', 'The routine parent does not exist.');

      const selected = childHabitIds === null ? null : new Set(childHabitIds);
      const lifecycleById = new Map(catalogue.value.map((habit) => [habit.habitId, habit.lifecycle] as const));
      const currentOrganizational = detail.value.ordinaryChildren.filter((relationship) => relationship.completionRole === 'organizational');
      const currentRoutine = detail.value.ordinaryChildren.filter((relationship) => relationship.completionRole === 'routine_step');
      const eligible: RoutineConversionRelationshipPreview[] = [];
      const retained: RoutineConversionRelationshipPreview[] = [];
      const ineligible: RoutineConversionIneligibleRelationship[] = [];
      for (const relationship of currentOrganizational) {
        const model = relationshipPreview(relationship);
        if (selected !== null && !selected.has(relationship.childHabitId)) {
          retained.push(model);
          continue;
        }
        if (lifecycleById.get(relationship.childHabitId) !== 'active') {
          ineligible.push(Object.freeze({
            childHabitId: relationship.childHabitId,
            relationshipId: relationship.relationshipId,
            reason: 'child_inactive' as const,
          }));
          continue;
        }
        eligible.push(model);
      }
      if (selected !== null) {
        for (const childHabitId of selected) {
          if (eligible.some((relationship) => relationship.childHabitId === childHabitId) || ineligible.some((relationship) => relationship.childHabitId === childHabitId)) continue;
          const existing = detail.value.ordinaryChildren.find((relationship) => relationship.childHabitId === childHabitId);
          ineligible.push(Object.freeze({
            childHabitId,
            relationshipId: existing?.relationshipId ?? null,
            reason: existing === undefined
              ? 'selected_child_not_direct' as const
              : 'selected_relationship_not_organizational' as const,
          }));
        }
      }

      const observations = parentObservationPreviews(
        detail.value.observationHistory,
        requestedEffectiveLocalDate,
      );
      const latestObservationDate = observations
        .map((observation) => observation.occurrenceLocalDate)
        .sort()
        .at(-1) ?? null;
      let earliestSafeEffectiveDate: PlannerLocalDate | null = requestedEffectiveLocalDate;
      if (latestObservationDate !== null) {
        const nextSafe = addPlannerCalendarDays(latestObservationDate, 1);
        earliestSafeEffectiveDate = nextSafe.ok ? nextSafe.value : null;
      }
      const conflicts: RoutineConversionConflict[] = [];
      if (detail.value.habit.lifecycle !== 'active') conflicts.push(Object.freeze({ code: 'parent_inactive' as const }));
      if (!contains(detail.value.habit.activeRange, requestedEffectiveLocalDate)) conflicts.push(Object.freeze({ code: 'requested_date_outside_parent_range' as const }));
      if (eligible.length === 0) conflicts.push(Object.freeze({ code: 'no_eligible_organizational_children' as const }));
      for (const relationship of ineligible) {
        if (selected !== null && selected.has(relationship.childHabitId)) {
          conflicts.push(Object.freeze({ code: 'selected_child_not_eligible' as const, childHabitId: relationship.childHabitId }));
        }
      }
      if (observations.length > 0) {
        conflicts.push(Object.freeze({
          code: 'parent_observation_on_or_after_boundary' as const,
          observationCount: observations.length,
          ...(earliestSafeEffectiveDate === null ? {} : { earliestSafeEffectiveDate }),
        }));
      }
      const graphConflict = validateOrdinaryHierarchy(occurrenceData.value.ordinaryParents);
      if (graphConflict === 'cycle') conflicts.push(Object.freeze({ code: 'ordinary_hierarchy_cycle' as const }));
      if (graphConflict === 'depth') conflicts.push(Object.freeze({ code: 'ordinary_hierarchy_depth_exceeded' as const }));

      const resultingRoutineCount = currentRoutine.length + eligible.length;
      const retainedCount = retained.length + ineligible.filter((relationship) => relationship.relationshipId !== null).length;
      return success(Object.freeze({
        parentHabitId,
        requestedEffectiveLocalDate,
        eligibleRelationships: Object.freeze(eligible),
        ineligibleRelationships: Object.freeze(ineligible),
        retainedOrganizationalRelationships: Object.freeze(retained),
        conditionalRelationshipsExcluded: Object.freeze(detail.value.outgoingDependencies.map(conditionalPreview)),
        alreadyRoutineStepRelationships: Object.freeze(currentRoutine.map(relationshipPreview)),
        parentObservationsOnOrAfterBoundary: Object.freeze(observations),
        earliestSafeEffectiveDate,
        conversionAllowed: conflicts.length === 0,
        conflicts: Object.freeze(conflicts),
        resultingDirectRoutineStepCount: resultingRoutineCount,
        retainedOrganizationalChildCount: retainedCount,
        mixedStructure: resultingRoutineCount > 0 && retainedCount > 0,
        wouldBecomeRoutineContainer: resultingRoutineCount > 0,
      }));
    } catch (cause: unknown) {
      return previewFailure('database_failure', 'The routine conversion preview could not be read.', undefined, cause);
    }
  };
}

export function createConvertOrganizationalParentToRoutine(
  dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork; idGenerator: IdGenerator; clock: Clock }>,
): ConvertOrganizationalParentToRoutine {
  const getPreview = createGetRoutineConversionPreview({ unitOfWork: dependencies.unitOfWork });
  return async (command) => {
    const preview = await getPreview(command);
    if (!preview.ok) return failure(convertError(
      preview.error.code === 'not_found' ? 'not_found' : preview.error.code,
      preview.error.message,
      undefined,
      undefined,
      preview.error,
    ));
    if (!preview.value.conversionAllowed) {
      return failure(convertError(
        'conversion_conflict',
        'The organizational parent cannot be converted at the requested boundary.',
        preview.value,
        preview.value.earliestSafeEffectiveDate ?? undefined,
      ));
    }
    let updatedAt: number;
    const relationships = [];
    const generated = new Set<string>();
    try {
      updatedAt = dependencies.clock.nowEpochMilliseconds();
      for (const relationship of preview.value.eligibleRelationships) {
        let newRelationshipVersionId: PlannerId | null = null;
        if (relationship.effectiveFrom < preview.value.requestedEffectiveLocalDate) {
          const generatedId = dependencies.idGenerator.generateId();
          const parsedId = parsePlannerId(generatedId, 'newRelationshipVersionId');
          if (!parsedId.ok || generated.has(generatedId)) {
            return failure(convertError('data_integrity_failure', 'The conversion identifier source returned invalid data.', preview.value, undefined, parsedId.ok ? undefined : parsedId.error));
          }
          generated.add(generatedId);
          newRelationshipVersionId = parsedId.value;
        }
        relationships.push(Object.freeze({
          relationshipId: relationship.relationshipId,
          currentRelationshipVersionId: relationship.currentRelationshipVersionId,
          childHabitId: relationship.childHabitId,
          newRelationshipVersionId,
        }));
      }
    } catch (cause: unknown) {
      return failure(convertError('data_integrity_failure', 'The conversion identifier or clock source failed.', preview.value, undefined, cause));
    }
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
      return failure(convertError('data_integrity_failure', 'The conversion clock source returned invalid data.', preview.value));
    }
    try {
      const saved = await dependencies.unitOfWork.convertOrganizationalParentToRoutine({
        parentHabitId: preview.value.parentHabitId,
        effectiveLocalDate: preview.value.requestedEffectiveLocalDate,
        relationships: Object.freeze(relationships),
        updatedAt,
      });
      if (saved.ok) return success(saved.value);
      const conflict = persistenceConflict(saved.error);
      return failure(convertError(
        conflict === null ? mapConversionPersistenceCode(saved.error) : 'stale_conflict',
        saved.error.message,
        preview.value,
        conflict?.earliestSafeEffectiveDate,
        saved.error,
      ));
    } catch (cause: unknown) {
      return failure(convertError('database_failure', 'The routine conversion could not be saved.', preview.value, undefined, cause));
    }
  };
}

function parsePreviewQuery(query: RoutineConversionPreviewQuery): Result<Readonly<{
  parentHabitId: PlannerId;
  requestedEffectiveLocalDate: PlannerLocalDate;
  childHabitIds: readonly PlannerId[] | null;
}>, RoutineConversionPreviewError> {
  const parent = parsePlannerId(query?.parentHabitId, 'parentHabitId');
  const date = parsePlannerLocalDate(query?.requestedEffectiveLocalDate, 'requestedEffectiveLocalDate');
  if (!parent.ok) return previewFailure('invalid_input', parent.error.message, 'parentHabitId', parent.error);
  if (!date.ok) return previewFailure('invalid_input', date.error.message, 'requestedEffectiveLocalDate', date.error);
  if (query.childHabitIds !== undefined && !Array.isArray(query.childHabitIds)) {
    return previewFailure('invalid_input', 'Child selection must be an array of habit identifiers.', 'childHabitIds');
  }
  const children: PlannerId[] = [];
  for (const [index, value] of (query.childHabitIds ?? []).entries()) {
    const child = parsePlannerId(value, `childHabitIds[${index}]`);
    if (!child.ok) return previewFailure('invalid_input', child.error.message, `childHabitIds[${index}]`, child.error);
    children.push(child.value);
  }
  if (new Set(children).size !== children.length) return previewFailure('invalid_input', 'Child selection contains duplicate identifiers.', 'childHabitIds');
  return success(Object.freeze({
    parentHabitId: parent.value,
    requestedEffectiveLocalDate: date.value,
    childHabitIds: query.childHabitIds === undefined ? null : Object.freeze(children),
  }));
}

function relationshipPreview(relationship: PlannerHabitOrdinaryRelationshipDetail): RoutineConversionRelationshipPreview {
  return Object.freeze({
    relationshipId: relationship.relationshipId,
    currentRelationshipVersionId: relationship.id,
    currentVersionNumber: relationship.versionNumber,
    childHabitId: relationship.childHabitId,
    childTitle: relationship.childName,
    effectiveFrom: relationship.effectiveRange.effectiveFrom,
    effectiveTo: relationship.effectiveRange.effectiveTo,
  });
}

function conditionalPreview(relationship: PlannerHabitDependencyDetail): RoutineConversionConditionalExclusion {
  return Object.freeze({
    relationshipId: relationship.version.relationshipId,
    childHabitId: relationship.version.dependentHabitId,
    childTitle: relationship.dependentName,
    dependencyType: relationship.version.dependencyType,
  });
}

function parentObservationPreviews(
  chains: readonly ObservationChain[],
  boundary: PlannerLocalDate,
): RoutineConversionParentObservation[] {
  return chains
    .filter((chain) => chain.root.occurrenceLocalDate >= boundary)
    .map((chain) => Object.freeze({
      rootObservationId: chain.root.id,
      currentObservationId: chain.currentLeaf.id,
      occurrenceLocalDate: chain.root.occurrenceLocalDate,
      isVoided: chain.isVoided,
    }))
    .sort((left, right) => left.occurrenceLocalDate.localeCompare(right.occurrenceLocalDate) || left.rootObservationId.localeCompare(right.rootObservationId));
}

function validateOrdinaryHierarchy(
  edges: readonly Readonly<{ parentHabitId: PlannerId; childHabitId: PlannerId }>[],
): 'cycle' | 'depth' | null {
  const parentByChild = new Map<PlannerId, PlannerId>();
  for (const edge of edges) {
    if (parentByChild.has(edge.childHabitId)) return 'depth';
    parentByChild.set(edge.childHabitId, edge.parentHabitId);
  }
  const nodes = new Set<PlannerId>([...parentByChild.keys(), ...parentByChild.values()]);
  for (const node of nodes) {
    const seen = new Set<PlannerId>();
    let cursor = node;
    let depth = 0;
    while (parentByChild.has(cursor)) {
      if (seen.has(cursor)) return 'cycle';
      seen.add(cursor);
      cursor = parentByChild.get(cursor)!;
      depth += 1;
      if (depth > 5) return 'depth';
    }
  }
  return null;
}

function contains(range: Readonly<{ effectiveFrom: PlannerLocalDate; effectiveTo: PlannerLocalDate | null }>, date: PlannerLocalDate): boolean {
  return range.effectiveFrom <= date && (range.effectiveTo === null || date < range.effectiveTo);
}

function persistenceConflict(error: PlannerPersistenceError): RoutineConversionPersistenceConflict | null {
  if (typeof error.cause !== 'object' || error.cause === null || !('reason' in error.cause)) return null;
  return error.cause as RoutineConversionPersistenceConflict;
}

function mapPreviewPersistenceError(error: PlannerPersistenceError | undefined): RoutineConversionPreviewError {
  if (error === undefined) return previewError('data_integrity_failure', 'The routine conversion preview failed without an error.');
  return previewError(
    error.code.endsWith('database_failure') || error.code === 'database_failure' ? 'database_failure' : 'data_integrity_failure',
    error.message,
    undefined,
    error,
  );
}

function mapConversionPersistenceCode(error: PlannerPersistenceError): ConvertOrganizationalParentToRoutineError['code'] {
  if (error.code === 'ordinary_habit_not_found') return 'not_found';
  if (error.code.endsWith('database_failure') || error.code === 'database_failure') return 'database_failure';
  return 'data_integrity_failure';
}

function previewFailure<T = never>(
  code: RoutineConversionPreviewError['code'],
  message: string,
  field?: string,
  cause?: unknown,
): Result<T, RoutineConversionPreviewError> {
  return failure(previewError(code, message, field, cause));
}

function previewError(
  code: RoutineConversionPreviewError['code'],
  message: string,
  field?: string,
  cause?: unknown,
): RoutineConversionPreviewError {
  return Object.freeze({
    name: 'RoutineConversionPreviewError' as const,
    code,
    message,
    ...(field === undefined ? {} : { field }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function convertError(
  code: ConvertOrganizationalParentToRoutineError['code'],
  message: string,
  preview?: RoutineConversionPreview,
  earliestSafeEffectiveDate?: PlannerLocalDate,
  cause?: unknown,
): ConvertOrganizationalParentToRoutineError {
  return Object.freeze({
    name: 'ConvertOrganizationalParentToRoutineError' as const,
    code,
    message,
    ...(preview === undefined ? {} : { preview }),
    ...(earliestSafeEffectiveDate === undefined ? {} : { earliestSafeEffectiveDate }),
    ...(cause === undefined ? {} : { cause }),
  });
}
