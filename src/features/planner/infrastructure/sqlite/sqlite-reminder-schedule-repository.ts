import { failure, success, type Result } from '../../domain';
import { createPlannerPersistenceError, type PlannerPersistenceError } from '../../repositories';
import type {
  ReminderProjection,
  ReminderProjectionWrite,
  ReminderScheduleStatus,
} from '../../application/notifications/reminder-notification-plan';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

/**
 * What the operating system was told, in SQLite.
 *
 * Two statements over `habit_reminder_schedules` (Migration 012), and neither of them
 * touches `habit_reminders`: **this table records an outcome and has no business editing
 * the intent it is about.** That separation is the whole reason the projection is its own
 * table rather than four more columns on the intent row.
 *
 * The reminder intent itself is read where every other reminder fact is read — through
 * the management catalogue, which has loaded `habit_reminders` since the detail model
 * needed it. So a reconciliation costs one extra query, not two.
 */

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function scheduleFailure(message: string, cause?: unknown): Result<never, PlannerPersistenceError> {
  return failure(createPlannerPersistenceError(
    cause === undefined ? 'data_integrity_failure' : 'database_failure',
    message,
    { operation: 'habitReminderSchedule', ...(cause === undefined ? {} : { cause }) },
  ));
}

interface ScheduleRow {
  readonly reminder_id: string;
  readonly system_identifier: string | null;
  readonly status: string;
  readonly scheduled_for: string | null;
  readonly failure_reason: string | null;
}

/**
 * Every projection there is.
 *
 * Unbounded on purpose, and bounded in fact: the table holds at most one row per
 * reminder, and a reminder exists only because somebody set one. Reading the lot is also
 * what reconciliation actually needs — it compares the whole of intent against the whole
 * of what the OS holds, so a per-habit query would only be the same read in pieces.
 */
export async function loadReminderSchedules(
  database: PlannerSqliteDatabase,
): Promise<Result<readonly ReminderProjection[], PlannerPersistenceError>> {
  try {
    const rows = await database.getAllAsync<ScheduleRow>(
      'SELECT reminder_id, system_identifier, status, scheduled_for, failure_reason FROM habit_reminder_schedules;',
    );
    return success(Object.freeze(rows.map((row) => Object.freeze({
      reminderId: row.reminder_id,
      scheduledFor: row.scheduled_for,
      status: row.status as ReminderScheduleStatus,
      systemIdentifier: row.system_identifier,
    }))));
  } catch (cause: unknown) {
    return scheduleFailure(`The reminder schedules could not be read. ${describe(cause)}`, cause);
  }
}

/**
 * Records what happened, for the reminders whose state actually moved.
 *
 * An upsert rather than a delete-and-insert, so a row's identity survives — and only the
 * rows the plan produced are written at all, because a reconciliation of an unchanged day
 * produces none.
 *
 * **A projection for a reminder that has since gone is skipped rather than failing the
 * batch.** The foreign key would refuse it, and rightly: the OS may still have been
 * holding a notification for an item deleted a moment ago, which is exactly the orphan
 * the plan cancels. Cancelling it is the useful half; recording it against a row that no
 * longer exists is not.
 */
export async function saveReminderSchedules(
  database: PlannerSqliteDatabase,
  writes: readonly ReminderProjectionWrite[],
  now: number,
): Promise<Result<number, PlannerPersistenceError>> {
  if (writes.length === 0) return success(0);
  try {
    let written = 0;
    for (const write of writes) {
      const reminder = await database.getFirstAsync<{ id: string }>(
        'SELECT id FROM habit_reminders WHERE id=$id;',
        { $id: write.reminderId },
      );
      if (reminder === null) continue;
      await database.runAsync(
        `INSERT INTO habit_reminder_schedules(reminder_id, system_identifier, status, scheduled_for, failure_reason, updated_at)
         VALUES($reminder, $identifier, $status, $for, $reason, $now)
         ON CONFLICT(reminder_id) DO UPDATE SET
           system_identifier=excluded.system_identifier,
           status=excluded.status,
           scheduled_for=excluded.scheduled_for,
           failure_reason=excluded.failure_reason,
           updated_at=excluded.updated_at;`,
        {
          $for: write.scheduledFor,
          $identifier: write.systemIdentifier,
          $now: now,
          $reason: write.failureReason ?? null,
          $reminder: write.reminderId,
          $status: write.status,
        },
      );
      written += 1;
    }
    return success(written);
  } catch (cause: unknown) {
    return scheduleFailure(`The reminder schedules could not be written. ${describe(cause)}`, cause);
  }
}

/**
 * Every projection whose reminder is gone, removed.
 *
 * The delete chain owns removing a habit's own rows (PD-SUBTASK-005 found what happens
 * when a table arrives after that chain and nobody tells it), and this is the sweep for
 * the case that chain cannot see: a reminder retired through its own lifecycle rather
 * than through a delete.
 */
export async function pruneReminderSchedules(
  database: PlannerSqliteDatabase,
): Promise<Result<number, PlannerPersistenceError>> {
  try {
    // `runAsync` answers nothing here, so what was removed is counted rather than
    // reported — one read of a table that holds at most one row per reminder.
    const stale = await database.getFirstAsync<{ value: number }>(
      `SELECT count(*) AS value FROM habit_reminder_schedules
       WHERE reminder_id NOT IN (SELECT id FROM habit_reminders);`,
    );
    await database.runAsync(
      `DELETE FROM habit_reminder_schedules
       WHERE reminder_id NOT IN (SELECT id FROM habit_reminders);`,
    );
    return success(stale?.value ?? 0);
  } catch (cause: unknown) {
    return scheduleFailure(`The stale reminder schedules could not be removed. ${describe(cause)}`, cause);
  }
}
