import { failure, parsePlannerId, parsePlannerLocalDate, type Result } from '../../domain';
import {
  createPlannerPersistenceError,
  type PlannerHabitDetail,
  type PlannerPersistenceError,
  type PlannerUnitOfWork,
} from '../../repositories';

export type GetPlannerHabitDetail = (input: Readonly<{ habitId: string; asOfLocalDate: string }>) => Promise<Result<PlannerHabitDetail | null, PlannerPersistenceError>>;

export function createGetPlannerHabitDetail(dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork }>): GetPlannerHabitDetail {
  return async (input) => {
    const id = parsePlannerId(input.habitId, 'habitId');
    const date = parsePlannerLocalDate(input.asOfLocalDate, 'asOfLocalDate');
    if (!id.ok || !date.ok) return failure(createPlannerPersistenceError('data_integrity_failure', 'The requested habit detail is invalid.', { operation: 'getPlannerHabitDetail' }));
    return dependencies.unitOfWork.getPlannerHabitDetail(id.value, date.value);
  };
}
