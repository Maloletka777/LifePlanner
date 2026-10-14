import { failure, parsePlannerLocalDate, type Result } from '../../domain';
import {
  createPlannerPersistenceError,
  type ListPlannerHabitsInput,
  type PlannerHabitCatalogueItem,
  type PlannerPersistenceError,
  type PlannerUnitOfWork,
} from '../../repositories';

export type ListPlannerHabits = (
  input: ListPlannerHabitsInput,
) => Promise<Result<readonly PlannerHabitCatalogueItem[], PlannerPersistenceError>>;

export function createListPlannerHabits(dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork }>): ListPlannerHabits {
  return async (input) => {
    const date = parsePlannerLocalDate(input.asOfLocalDate, 'asOfLocalDate');
    if (!date.ok || !['all', 'active', 'archived'].includes(input.lifecycle ?? 'all') || (input.sort ?? 'management_default') !== 'management_default') {
      return failure(createPlannerPersistenceError('data_integrity_failure', 'The Planner catalogue query is invalid.', { operation: 'listPlannerHabits' }));
    }
    return dependencies.unitOfWork.listPlannerHabits(Object.freeze({
      searchText: input.searchText?.trim().normalize('NFKC') ?? '',
      lifecycle: input.lifecycle ?? 'all',
      sort: 'management_default',
      asOfLocalDate: date.value,
    }));
  };
}
