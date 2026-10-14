import { addPlannerCalendarDays, evaluateSchedule, failure, success, type PlannerLocalDate, type PlannerTimezone, type Result } from '../../domain';
import type { PlannerHabitCatalogueItem, PlannerPersistenceError, PlannerUnitOfWork } from '../../repositories';
import type { Clock } from '../ports/clock';

import {
  reconcileReminderNotifications,
  type ReminderNotificationGateway,
  type ReminderReconciliationReport,
} from './reconcile-reminder-notifications';
import { REMINDER_WINDOW_DAYS, type ReminderIntent } from './reminder-notification-plan';

/**
 * The whole reconciliation, composed: intent from the catalogue, days from the schedule,
 * the plan, and the operating system.
 *
 * This is where the one question the plan deliberately refuses to answer gets answered —
 * **whether a reminder fires at all** — because that is a question about a habit's
 * schedule and its lifecycle, and this is the layer that holds both.
 */

export interface ReconcileRemindersDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly gateway: ReminderNotificationGateway;
  readonly clock: Clock;
}

/**
 * The days inside the window a habit actually runs on.
 *
 * `evaluateSchedule` is asked one day at a time, which is the same walk the create sheet
 * uses to confirm a repeat — the domain has no «give me the next N dates» and building one
 * here would be a second answer to a question that already has one. The walk is bounded by
 * the window rather than by a count, so a habit with nothing in the fortnight simply
 * returns nothing.
 *
 * A **flexible period** — «three times a week» — names no dates at all, and a reminder for
 * it would have to invent a day. It returns nothing, so such a habit's reminder is
 * `cancelled` rather than fired on a day the schedule never chose.
 */
export function reminderDatesInWindow(input: Readonly<{
  item: PlannerHabitCatalogueItem;
  from: PlannerLocalDate;
  timezone: PlannerTimezone;
  windowDays?: number;
}>): readonly PlannerLocalDate[] {
  const schedule = input.item.schedule;
  if (schedule === null) return Object.freeze([]);
  const days = input.windowDays ?? REMINDER_WINDOW_DAYS;
  const found: PlannerLocalDate[] = [];
  let cursor = input.from;
  for (let step = 0; step < days; step += 1) {
    const evaluation = evaluateSchedule({
      evaluatedLocalDate: cursor,
      evaluationTimezone: schedule.definition.evaluationTimezone,
      habitActiveRange: input.item.activeRange,
      schedule: schedule.definition,
    });
    if (!evaluation.ok) break;
    if (evaluation.value.kind === 'applicable_flexible_period') return Object.freeze([]);
    if (evaluation.value.kind === 'applicable_fixed_date') found.push(cursor);
    const next = addPlannerCalendarDays(cursor, 1);
    if (!next.ok) break;
    cursor = next.value;
  }
  return Object.freeze(found);
}

/**
 * Whether this item's reminder should fire at all, and why not when it should not.
 *
 * Three reasons, each of which the plan itself could not know: the item has no reminder,
 * it has been archived, or its schedule is gone and needs repair. A **task already
 * closed** is the fourth the contract names, and it is not decided here — closure is an
 * observation against a date and this walk holds none; a reminder for a task done early
 * therefore still fires, which is recorded rather than hidden.
 */
export function reminderFires(item: PlannerHabitCatalogueItem): boolean {
  if (item.reminderId === null || item.reminderLocalTime === null) return false;
  if (item.lifecycle === 'archived') return false;
  return !item.temporalContext.displayConfiguration.needsSchedule;
}

export function createReconcileReminders(dependencies: ReconcileRemindersDependencies) {
  return async function reconcileReminders(input: Readonly<{
    today: PlannerLocalDate;
    timezone: PlannerTimezone;
  }>): Promise<Result<ReminderReconciliationReport, PlannerPersistenceError>> {
    const catalogue = await dependencies.unitOfWork.listPlannerHabits({
      asOfLocalDate: input.today,
      lifecycle: 'all',
    });
    if (!catalogue.ok) return failure(catalogue.error);

    // A projection whose reminder has gone is swept before the plan reads them, so a row
    // for something deleted cannot make reconciliation reason about an item that is not
    // there. Failing to sweep is not a reason to skip the run.
    await dependencies.unitOfWork.pruneReminderSchedules();

    const intents: ReminderIntent[] = [];
    for (const item of catalogue.value) {
      if (item.reminderId === null || item.reminderLocalTime === null) continue;
      const fires = reminderFires(item);
      intents.push(Object.freeze({
        dates: fires ? reminderDatesInWindow({ from: input.today, item, timezone: input.timezone }) : Object.freeze([]),
        fires,
        habitId: item.habitId,
        plannedLocalTime: item.plannedLocalTime,
        reminderId: item.reminderId,
        title: item.name,
        triggerLocalTime: item.reminderLocalTime,
      }));
    }

    const reconciled = await reconcileReminderNotifications({
      gateway: dependencies.gateway,
      intents,
      loadProjections: () => dependencies.unitOfWork.loadReminderSchedules(),
      saveProjections: (writes) => dependencies.unitOfWork.saveReminderSchedules(writes, dependencies.clock.nowEpochMilliseconds()),
    });
    if (!reconciled.ok) return failure(reconciled.error);
    return success(reconciled.value);
  };
}
