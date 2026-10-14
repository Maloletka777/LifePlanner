import { failure, success, type Result } from '../../domain';
import type { PlannerGrowthEnjoyment } from '../../domain/values/day-block';
import {
  createPlannerPersistenceError,
  type PlannerGrowthAttemptRow,
  type PlannerGrowthDetailsInput,
  type PlannerGrowthStartInput,
  type PlannerGrowthStopInput,
  type PlannerPersistenceError,
} from '../../repositories';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';

/**
 * The routines a person is growing, in SQLite.
 *
 * One table and five statements, and **not one of them touches `habit_observations`,
 * `habit_checklist_ticks` or anything else the first floor reads.** That is what makes
 * the two levels separate by construction: ordinary analytics never joins here, and
 * could not accidentally, so «the growth model cannot reach a completion figure» is a
 * property of the wiring rather than a rule somebody has to remember.
 *
 * The ids are placeholders rather than text spliced into a statement, and the reads are
 * bounded by habit ids the caller already holds — the same shape the checklist queries
 * settled on after `json_each` turned out to be an extension a build may not have.
 */

interface GrowthRow {
  readonly id: string;
  readonly habit_id: string;
  readonly attempt_number: number;
  readonly tracked_from: string;
  readonly stopped_from: string | null;
  readonly cue: string | null;
  readonly enjoyment: string | null;
}

function toAttempt(row: GrowthRow): PlannerGrowthAttemptRow {
  return Object.freeze({
    attemptNumber: row.attempt_number,
    cue: row.cue,
    enjoyment: row.enjoyment as PlannerGrowthEnjoyment | null,
    habitId: row.habit_id,
    id: row.id,
    stoppedFrom: row.stopped_from,
    trackedFrom: row.tracked_from,
  });
}

function growthFailure(message: string, cause?: unknown): Result<never, PlannerPersistenceError> {
  return failure(createPlannerPersistenceError(
    cause === undefined ? 'data_integrity_failure' : 'database_failure',
    message,
    { operation: 'habitGrowth', ...(cause === undefined ? {} : { cause }) },
  ));
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Every attempt recorded against the habits asked for, oldest first.
 *
 * All of them, not only the open one: an attempt that ended still happened, and the
 * history is the reason the table holds one row per attempt rather than one per routine.
 */
export async function loadHabitGrowth(
  database: PlannerSqliteDatabase,
  habitIds: readonly string[],
): Promise<Result<ReadonlyMap<string, readonly PlannerGrowthAttemptRow[]>, PlannerPersistenceError>> {
  if (habitIds.length === 0) return success(new Map());
  try {
    const parameters: Record<string, string> = {};
    habitIds.forEach((habitId, index) => { parameters[`$habit${index}`] = habitId; });
    const placeholders = habitIds.map((_id, index) => `$habit${index}`).join(',');
    const rows = await database.getAllAsync<GrowthRow>(
      `SELECT id, habit_id, attempt_number, tracked_from, stopped_from, cue, enjoyment
       FROM habit_growth WHERE habit_id IN (${placeholders})
       ORDER BY habit_id, attempt_number;`,
      parameters,
    );
    const byHabit = new Map<string, PlannerGrowthAttemptRow[]>();
    for (const row of rows) {
      const attempts = byHabit.get(row.habit_id) ?? [];
      attempts.push(toAttempt(row));
      byHabit.set(row.habit_id, attempts);
    }
    return success(byHabit);
  } catch (cause: unknown) {
    return growthFailure(`The routines being grown could not be read. ${describe(cause)}`, cause);
  }
}

/**
 * The attempts that are still open, across every habit.
 *
 * This is what the Growing surface lists and what the cap is counted against — and the
 * cap is counted in the command rather than here, because three is a product judgement
 * and this file's job is to say what is true, not what is allowed.
 */
export async function loadOpenHabitGrowth(
  database: PlannerSqliteDatabase,
): Promise<Result<readonly PlannerGrowthAttemptRow[], PlannerPersistenceError>> {
  try {
    const rows = await database.getAllAsync<GrowthRow>(
      `SELECT id, habit_id, attempt_number, tracked_from, stopped_from, cue, enjoyment
       FROM habit_growth WHERE stopped_from IS NULL ORDER BY tracked_from, habit_id;`,
    );
    return success(Object.freeze(rows.map(toAttempt)));
  } catch (cause: unknown) {
    return growthFailure(`The routines being grown could not be read. ${describe(cause)}`, cause);
  }
}

/**
 * Taking a routine on.
 *
 * The attempt number is derived from what is already there rather than passed in, so two
 * callers cannot disagree about it, and the open-attempt index refuses a second one for
 * the same habit — which is the invariant the schema is allowed to hold.
 */
export async function startHabitGrowth(
  database: PlannerSqliteDatabase,
  input: PlannerGrowthStartInput,
): Promise<Result<PlannerGrowthAttemptRow, PlannerPersistenceError>> {
  const habit = await database.getFirstAsync<{ id: string }>('SELECT id FROM habits WHERE id=$id;', { $id: input.habitId });
  if (habit === null) return growthFailure('The item being grown no longer exists.');
  try {
    const open = await database.getFirstAsync<{ value: number }>(
      'SELECT count(*) AS value FROM habit_growth WHERE habit_id=$habit AND stopped_from IS NULL;',
      { $habit: input.habitId },
    );
    if ((open?.value ?? 0) > 0) return growthFailure('This routine is already being grown.');

    const previous = await database.getFirstAsync<{ value: number }>(
      'SELECT coalesce(max(attempt_number),0) AS value FROM habit_growth WHERE habit_id=$habit;',
      { $habit: input.habitId },
    );
    const attemptNumber = (previous?.value ?? 0) + 1;

    await database.runAsync(
      `INSERT INTO habit_growth(id,habit_id,attempt_number,tracked_from,stopped_from,cue,enjoyment,created_at,updated_at)
       VALUES($id,$habit,$attempt,$from,NULL,$cue,$enjoyment,$at,$at);`,
      {
        $at: input.createdAt,
        $attempt: attemptNumber,
        $cue: input.cue,
        $enjoyment: input.enjoyment,
        $from: input.trackedFrom,
        $habit: input.habitId,
        $id: input.id,
      },
    );
    return success(Object.freeze({
      attemptNumber,
      cue: input.cue,
      enjoyment: input.enjoyment,
      habitId: input.habitId,
      id: input.id,
      stoppedFrom: null,
      trackedFrom: input.trackedFrom,
    }));
  } catch (cause: unknown) {
    return growthFailure(`The routine could not be taken on. ${describe(cause)}`, cause);
  }
}

/**
 * Putting one down, without erasing that it happened.
 *
 * The row is closed rather than deleted, so the days it covered stay covered — and so
 * the next attempt is visibly a second one rather than a fresh start with no past.
 */
export async function stopHabitGrowth(
  database: PlannerSqliteDatabase,
  input: PlannerGrowthStopInput,
): Promise<Result<boolean, PlannerPersistenceError>> {
  try {
    const open = await database.getFirstAsync<{ id: string; tracked_from: string }>(
      'SELECT id, tracked_from FROM habit_growth WHERE habit_id=$habit AND stopped_from IS NULL;',
      { $habit: input.habitId },
    );
    if (open === null) return success(false);
    if (input.stoppedFrom <= open.tracked_from) {
      return growthFailure('A routine cannot stop being grown before the day it was taken on.');
    }
    await database.runAsync(
      'UPDATE habit_growth SET stopped_from=$stopped, updated_at=$at WHERE id=$id;',
      { $at: input.updatedAt, $id: open.id, $stopped: input.stoppedFrom },
    );
    return success(true);
  } catch (cause: unknown) {
    return growthFailure(`The routine could not be put down. ${describe(cause)}`, cause);
  }
}

/**
 * The cue and the enjoyment, stated in full.
 *
 * They belong to the open attempt: a cue named for the February attempt is not a claim
 * about the August one, and rewriting a closed row would be editing a story that is over.
 */
export async function setHabitGrowthDetails(
  database: PlannerSqliteDatabase,
  input: PlannerGrowthDetailsInput,
): Promise<Result<boolean, PlannerPersistenceError>> {
  try {
    const open = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM habit_growth WHERE habit_id=$habit AND stopped_from IS NULL;',
      { $habit: input.habitId },
    );
    if (open === null) return success(false);
    await database.runAsync(
      'UPDATE habit_growth SET cue=$cue, enjoyment=$enjoyment, updated_at=$at WHERE id=$id;',
      { $at: input.updatedAt, $cue: input.cue, $enjoyment: input.enjoyment, $id: open.id },
    );
    return success(true);
  } catch (cause: unknown) {
    return growthFailure(`The routine's cue could not be saved. ${describe(cause)}`, cause);
  }
}
