import {
  failure,
  parsePlannerLocalDate,
  success,
  type PlannerLocalDate,
  type Result,
} from '../../domain';
import type { HabitVisualIdentityRecord, PlannerUnitOfWork } from '../../repositories';
import {
  buildSelectedDatePlannerReadModel,
  type PlannerOccurrenceQueryError,
} from './get-planner-occurrences-for-date';

export interface PlannerDateMarkerSummary {
  readonly scheduled: number;
  readonly completed: number;
  readonly indicators: readonly Readonly<{ habitId: string; completed: boolean; visualIdentity: HabitVisualIdentityRecord }>[];
}

export interface GetPlannerDateSummariesForRangeQuery {
  readonly startDate: PlannerLocalDate;
  readonly endDate: PlannerLocalDate;
  readonly evaluationBoundary: PlannerLocalDate;
}

export interface PlannerDateSummaryRangeReadModel {
  readonly startDate: PlannerLocalDate;
  readonly endDate: PlannerLocalDate;
  readonly summaries: Readonly<Record<string, PlannerDateMarkerSummary>>;
}

export type GetPlannerDateSummariesForRange = (
  query: GetPlannerDateSummariesForRangeQuery,
) => Promise<Result<PlannerDateSummaryRangeReadModel, PlannerOccurrenceQueryError>>;

export function createGetPlannerDateSummariesForRange(
  dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork }>,
): GetPlannerDateSummariesForRange {
  return async (query) => {
    const start = parsePlannerLocalDate(query?.startDate, 'startDate');
    const end = parsePlannerLocalDate(query?.endDate, 'endDate');
    const boundary = parsePlannerLocalDate(query?.evaluationBoundary, 'evaluationBoundary');
    if (!start.ok || !end.ok || !boundary.ok || start.value > end.value) {
      return failure(queryError(
        'occurrence_read_model_data_integrity_failure',
        'The Planner marker range is invalid.',
      ));
    }

    let loaded;
    try {
      loaded = await dependencies.unitOfWork.loadPlannerOccurrenceDataRange(
        start.value,
        end.value,
      );
    } catch (cause: unknown) {
      return failure(queryError(
        'occurrence_read_model_database_failure',
        'The Planner marker range could not be read.',
        cause,
      ));
    }
    if (!loaded.ok) {
      return failure(queryError(
        loaded.error.code === 'occurrence_read_model_database_failure'
          ? 'occurrence_read_model_database_failure'
          : 'occurrence_read_model_data_integrity_failure',
        loaded.error.message,
        loaded.error,
      ));
    }

    const summaries: Record<string, PlannerDateMarkerSummary> = {};
    for (const dataSet of loaded.value) {
      const model = buildSelectedDatePlannerReadModel(dataSet, boundary.value);
      if (!model.ok) return model;
      const roots = model.value.rootGroups.flatMap((group) => {
        const { rows } = group;
        const root = rows[0];
        return root === undefined ||
          root.ordinaryParentHabitId !== null ||
          group.routineContainer.applicability === 'no_applicable_steps'
          ? []
          : [{ row: root, completed: group.routineContainer.isCanonicallyComplete }];
      });
      summaries[dataSet.selectedLocalDate] = Object.freeze({
        scheduled: roots.length,
        completed: roots.filter(({ completed }) => completed).length,
        indicators: Object.freeze(roots.slice(0, 3).map(({ row, completed }) =>
          Object.freeze({ habitId: row.habitId, completed, visualIdentity: row.visualIdentity }))),
      });
    }
    return success(Object.freeze({
      startDate: start.value,
      endDate: end.value,
      summaries: Object.freeze(summaries),
    }));
  };
}

function queryError(
  code: PlannerOccurrenceQueryError['code'],
  message: string,
  cause?: unknown,
): PlannerOccurrenceQueryError {
  return Object.freeze({
    name: 'PlannerOccurrenceQueryError',
    code,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}
