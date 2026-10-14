import { addPlannerCalendarDays, isOneDayScheduledItem, type PlannerLocalDate } from '../../domain';
import type { PlannerHabitCatalogueItem, PlannerUnitOfWork } from '../../repositories';

/**
 * The two things the application tidies up by itself, and nothing else.
 *
 * **1 · The retired subtask model.** A subtask used to be a whole habit — an
 * ordinary child with its own schedule and its own observations — and it is a
 * line of text now. The rows that expressed the old model are removed rather than
 * left beside the new one: two sources for one thing is what the owner ruled out,
 * and a leftover child would show up as an item of its own on every surface.
 *
 * **2 · Tasks a week past their day.** A task belongs to one day and is over when
 * that day is; keeping a thousand of them is a database a phone has to carry for
 * nothing. Seven days is the window, done or not, and it is deleted **whole** —
 * the item, its subtasks and its marks — because a task never enters a statistic,
 * so removing it changes no figure anywhere.
 *
 * Both go through the canonical deletion rather than raw SQL: it already knows
 * what a habit is made of, and a hand-written cascade is a second definition of
 * that waiting to disagree with the first.
 *
 * **Nothing here touches a habit.** A habit is history and is never swept.
 */

/** How long a task outlives its day before the application removes it. */
export const PLANNER_TASK_RETENTION_DAYS = 7;

export interface PlannerMaintenanceReport {
  readonly retiredSubtasks: number;
  readonly purgedTasks: number;
  readonly failures: number;
}

export interface PlannerMaintenanceDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly deleteHabit: (command: Readonly<{
    habitId: string;
    effectiveLocalDate: string;
    boundaryTimezone: string;
    confirmed: true;
  }>) => Promise<Readonly<{ ok: boolean }>>;
}

export type RunPlannerMaintenance = (command: Readonly<{
  today: PlannerLocalDate;
  boundaryTimezone: string;
}>) => Promise<PlannerMaintenanceReport>;

/** True for a habit that only exists because the old subtask model made it one. */
export function isRetiredSubtask(item: PlannerHabitCatalogueItem): boolean {
  return item.ordinaryParentHabitId !== null;
}

/** True for a task whose day is far enough behind that it is no longer of use. */
export function isExpiredTask(item: PlannerHabitCatalogueItem, today: PlannerLocalDate): boolean {
  if (!isOneDayScheduledItem({
    effectiveFrom: item.activeRange.effectiveFrom,
    effectiveTo: item.activeRange.effectiveTo,
    scheduleType: item.schedule?.definition.scheduleType,
  })) return false;
  const cutoff = addPlannerCalendarDays(today, -PLANNER_TASK_RETENTION_DAYS);
  return cutoff.ok && item.activeRange.effectiveFrom < cutoff.value;
}

export function createRunPlannerMaintenance(dependencies: PlannerMaintenanceDependencies): RunPlannerMaintenance {
  return async (command) => {
    const catalogue = await dependencies.unitOfWork.listPlannerHabits({
      asOfLocalDate: command.today,
      lifecycle: 'all',
      searchText: '',
      sort: 'management_default',
    });
    if (!catalogue.ok) return Object.freeze({ failures: 1, purgedTasks: 0, retiredSubtasks: 0 });

    let retiredSubtasks = 0;
    let purgedTasks = 0;
    let failures = 0;
    for (const item of catalogue.value) {
      const retired = isRetiredSubtask(item);
      if (!retired && !isExpiredTask(item, command.today)) continue;
      // The checklist goes first: its foreign key is RESTRICT like every other in
      // this schema, so a deletion that left the lines behind would simply fail.
      const checklist = await dependencies.unitOfWork.deleteHabitChecklist(item.habitId);
      if (!checklist.ok) { failures += 1; continue; }
      const deleted = await dependencies.deleteHabit({
        boundaryTimezone: command.boundaryTimezone,
        confirmed: true,
        effectiveLocalDate: command.today,
        habitId: item.habitId,
      });
      if (!deleted.ok) { failures += 1; continue; }
      if (retired) retiredSubtasks += 1; else purgedTasks += 1;
    }
    return Object.freeze({ failures, purgedTasks, retiredSubtasks });
  };
}
