import { failure, success, type Result } from '../../domain';
import {
  createPlannerPersistenceError,
  type PlannerChecklistLine,
  type PlannerChecklistRemovalInput,
  type PlannerChecklistTickInput,
  type PlannerChecklistWriteInput,
  type PlannerChecklistsByHabit,
  type PlannerPersistenceError,
} from '../../repositories';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

/**
 * Subtasks in SQLite: a line, and a tick per day.
 *
 * Two tables and four statements, and nothing here touches `habit_observations`
 * — which is the whole reason a subtask carries no weight. The queries are
 * bounded by the habit ids the caller already has, so a day costs one read.
 */

interface LineRow {
  readonly id: string;
  readonly habit_id: string;
  readonly text: string;
  readonly sort_order: number;
  readonly done_at: number | null;
}

/**
 * The items are named one placeholder each rather than passed as JSON.
 *
 * `json_each` is a table-valued function from an extension, and an extension is a
 * thing a build either has or does not — on the device it did not, and every
 * checklist read failed with it. A bound `IN` list needs nothing but SQL, and the
 * ids are placeholders rather than text in the statement, so nothing is spliced
 * into it either.
 */
function selectLines(count: number): string {
  const placeholders = Array.from({ length: count }, (_unused, index) => `$habit${index}`).join(', ');
  return `
  SELECT item.id, item.habit_id, item.text, item.sort_order, tick.done_at
  FROM habit_checklist_items AS item
  LEFT JOIN habit_checklist_ticks AS tick
    ON tick.checklist_item_id = item.id AND tick.occurrence_local_date = $date
  WHERE item.habit_id IN (${placeholders})
    AND item.created_from <= $date
    AND (item.deleted_from IS NULL OR item.deleted_from > $date)
  ORDER BY item.habit_id, item.sort_order, item.id;`;
}

/** Enough of the cause to act on, without a stack in a person's face. */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function checklistFailure(message: string, cause?: unknown): Result<never, PlannerPersistenceError> {
  return failure(createPlannerPersistenceError(
    cause === undefined ? 'data_integrity_failure' : 'database_failure',
    message,
    { operation: 'habitChecklist', ...(cause === undefined ? {} : { cause }) },
  ));
}

/**
 * Every line of the habits asked for, as each stands on that one day.
 *
 * A line that had not been written yet on that day is absent, and one removed
 * before it is absent too — the same `[createdFrom, deletedFrom)` window the
 * schema enforces, so looking back at a past day shows the checklist that was
 * actually there.
 */
export async function loadHabitChecklists(
  database: PlannerSqliteDatabase,
  habitIds: readonly string[],
  localDate: string,
): Promise<Result<PlannerChecklistsByHabit, PlannerPersistenceError>> {
  if (habitIds.length === 0) return success(new Map());
  try {
    const parameters: Record<string, string> = { $date: localDate };
    habitIds.forEach((habitId, index) => { parameters[`$habit${index}`] = habitId; });
    const rows = await database.getAllAsync<LineRow>(selectLines(habitIds.length), parameters);
    const byHabit = new Map<string, PlannerChecklistLine[]>();
    for (const row of rows) {
      const lines = byHabit.get(row.habit_id) ?? [];
      lines.push(Object.freeze({
        id: row.id,
        habitId: row.habit_id,
        text: row.text,
        sortOrder: row.sort_order,
        // Presence is the tick: a row for this day means done, and no row means
        // not done. There is no flag that could disagree with it.
        done: row.done_at !== null,
        doneAt: row.done_at,
      }));
      byHabit.set(row.habit_id, lines);
    }
    const frozen = new Map<string, readonly PlannerChecklistLine[]>();
    for (const [habitId, lines] of byHabit) frozen.set(habitId, Object.freeze(lines));
    return success(frozen);
  } catch (cause: unknown) {
    return checklistFailure(`The checklist could not be read. ${describe(cause)}`, cause);
  }
}

/**
 * **How each of these items closes**, for the habits asked for.
 *
 * Absence is the default and the default is «by hand»: every habit written before
 * Migration 011 has no row, reads back `false`, and behaves exactly as it did. Nothing
 * is backfilled, because a backfill would have to guess.
 */
export async function loadHabitClosureRules(
  database: PlannerSqliteDatabase,
  habitIds: readonly string[],
): Promise<Result<ReadonlyMap<string, boolean>, PlannerPersistenceError>> {
  if (habitIds.length === 0) return success(new Map());
  try {
    const parameters: Record<string, string> = {};
    habitIds.forEach((habitId, index) => { parameters[`$habit${index}`] = habitId; });
    const placeholders = habitIds.map((_id, index) => `$habit${index}`).join(',');
    const rows = await database.getAllAsync<{ habit_id: string; closes_by_checklist: number }>(
      `SELECT habit_id, closes_by_checklist FROM habit_closure_rules WHERE habit_id IN (${placeholders});`,
      parameters,
    );
    const byHabit = new Map<string, boolean>();
    for (const row of rows) byHabit.set(row.habit_id, row.closes_by_checklist === 1);
    return success(byHabit);
  } catch (cause: unknown) {
    return checklistFailure(`The closure rule could not be read. ${describe(cause)}`, cause);
  }
}

/**
 * Sets how one item closes.
 *
 * **The default is written away rather than stored**: choosing «by hand» removes the
 * row, so the table only ever holds the items that departed from it and absence keeps
 * meaning exactly one thing.
 */
export async function setHabitClosureRule(
  database: PlannerSqliteDatabase,
  input: Readonly<{ habitId: string; closesByChecklist: boolean; updatedAt: number }>,
): Promise<Result<boolean, PlannerPersistenceError>> {
  const habit = await database.getFirstAsync<{ id: string }>('SELECT id FROM habits WHERE id=$id;', { $id: input.habitId });
  if (habit === null) return checklistFailure('The item a closure rule belongs to no longer exists.');
  try {
    if (!input.closesByChecklist) {
      await database.runAsync('DELETE FROM habit_closure_rules WHERE habit_id=$habit;', { $habit: input.habitId });
      return success(false);
    }
    await database.runAsync(
      `INSERT INTO habit_closure_rules(habit_id,closes_by_checklist,updated_at) VALUES($habit,1,$at)
       ON CONFLICT(habit_id) DO UPDATE SET closes_by_checklist=1, updated_at=$at;`,
      { $at: input.updatedAt, $habit: input.habitId },
    );
    return success(true);
  } catch (cause: unknown) {
    return checklistFailure(`The closure rule could not be saved. ${describe(cause)}`, cause);
  }
}

/** Adds lines to a habit, from the day they were written and not before it. */
export async function writeHabitChecklistLines(
  database: PlannerSqliteDatabase,
  input: PlannerChecklistWriteInput,
): Promise<Result<readonly PlannerChecklistLine[], PlannerPersistenceError>> {
  const habit = await database.getFirstAsync<{ id: string }>('SELECT id FROM habits WHERE id=$id;', { $id: input.habitId });
  if (habit === null) return checklistFailure('The item a checklist belongs to no longer exists.');
  try {
    for (const line of input.lines) {
      await database.runAsync(
        `INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,created_from,created_at,deleted_from)
         VALUES($id,$habit,$text,$order,$from,$at,NULL);`,
        { $at: input.createdAt, $from: input.createdFrom, $habit: input.habitId, $id: line.id, $order: line.sortOrder, $text: line.text },
      );
    }
    return success(Object.freeze(input.lines.map((line) => Object.freeze({
      id: line.id,
      habitId: input.habitId,
      text: line.text,
      sortOrder: line.sortOrder,
      done: false,
      doneAt: null,
    }))));
  } catch (cause: unknown) {
    return checklistFailure('The checklist could not be saved.', cause);
  }
}

/**
 * Ticks or unticks one line **for one day**.
 *
 * Unticking deletes the row rather than clearing a column, so "not done" is the
 * absence of a fact and no day can inherit another day's answer.
 */
export async function setHabitChecklistTick(
  database: PlannerSqliteDatabase,
  input: PlannerChecklistTickInput,
): Promise<Result<PlannerChecklistLine, PlannerPersistenceError>> {
  const line = await database.getFirstAsync<{ id: string; habit_id: string; text: string; sort_order: number; created_from: string; deleted_from: string | null }>(
    'SELECT id,habit_id,text,sort_order,created_from,deleted_from FROM habit_checklist_items WHERE id=$id;',
    { $id: input.checklistItemId },
  );
  if (line === null) return checklistFailure('That subtask no longer exists.');
  if (line.created_from > input.occurrenceLocalDate) return checklistFailure('That subtask did not exist on that day.');
  if (line.deleted_from !== null && line.deleted_from <= input.occurrenceLocalDate) return checklistFailure('That subtask was removed before that day.');
  try {
    if (input.done) {
      await database.runAsync(
        `INSERT INTO habit_checklist_ticks(checklist_item_id,occurrence_local_date,done_at) VALUES($id,$date,$at)
         ON CONFLICT(checklist_item_id,occurrence_local_date) DO UPDATE SET done_at=excluded.done_at;`,
        { $at: input.doneAt, $date: input.occurrenceLocalDate, $id: input.checklistItemId },
      );
    } else {
      await database.runAsync(
        'DELETE FROM habit_checklist_ticks WHERE checklist_item_id=$id AND occurrence_local_date=$date;',
        { $date: input.occurrenceLocalDate, $id: input.checklistItemId },
      );
    }
    return success(Object.freeze({
      id: line.id,
      habitId: line.habit_id,
      text: line.text,
      sortOrder: line.sort_order,
      done: input.done,
      doneAt: input.done ? input.doneAt : null,
    }));
  } catch (cause: unknown) {
    return checklistFailure('That subtask could not be recorded.', cause);
  }
}

/**
 * Removes a line **from a day onwards**, leaving every earlier day as it was.
 *
 * The same principle the rest of the Planner runs on: observations are
 * append-only and configuration is effective-dated, so a day that has already
 * happened is never rewritten by something decided later.
 */
export async function removeHabitChecklistLine(
  database: PlannerSqliteDatabase,
  input: PlannerChecklistRemovalInput,
): Promise<Result<string, PlannerPersistenceError>> {
  const line = await database.getFirstAsync<{ id: string; created_from: string }>(
    'SELECT id,created_from FROM habit_checklist_items WHERE id=$id;',
    { $id: input.checklistItemId },
  );
  if (line === null) return checklistFailure('That subtask no longer exists.');
  try {
    if (line.created_from >= input.deletedFrom) {
      // Removed on the day it was written: it never stood on a day anybody read,
      // so there is no past to protect and the row goes with its ticks.
      await database.runAsync('DELETE FROM habit_checklist_ticks WHERE checklist_item_id=$id;', { $id: input.checklistItemId });
      await database.runAsync('DELETE FROM habit_checklist_items WHERE id=$id;', { $id: input.checklistItemId });
      return success(input.checklistItemId);
    }
    await database.runAsync(
      'UPDATE habit_checklist_items SET deleted_from=$from WHERE id=$id;',
      { $from: input.deletedFrom, $id: input.checklistItemId },
    );
    return success(input.checklistItemId);
  } catch (cause: unknown) {
    return checklistFailure('That subtask could not be removed.', cause);
  }
}

/**
 * Removes an item's whole checklist outright — lines, ticks and all.
 *
 * This is not the dated removal a person performs: it is what a **hard deletion**
 * of the item has to do first, because a line's foreign key is RESTRICT like
 * every other in this schema and a deletion that leaves orphans is not one.
 */
export async function deleteHabitChecklist(
  database: PlannerSqliteDatabase,
  habitId: string,
): Promise<Result<number, PlannerPersistenceError>> {
  try {
    const lines = await database.getAllAsync<{ id: string }>('SELECT id FROM habit_checklist_items WHERE habit_id=$habit;', { $habit: habitId });
    for (const line of lines) {
      await database.runAsync('DELETE FROM habit_checklist_ticks WHERE checklist_item_id=$id;', { $id: line.id });
    }
    await database.runAsync('DELETE FROM habit_checklist_items WHERE habit_id=$habit;', { $habit: habitId });
    return success(lines.length);
  } catch (cause: unknown) {
    return checklistFailure('The checklist could not be removed with its item.', cause);
  }
}
