import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_CHECKLIST_DAY_TICKS_SCHEMA_VERSION = 9;

const ITEMS = 'habit_checklist_items';
const TICKS = 'habit_checklist_ticks';

/**
 * A subtask is ticked **for a day**, not once and for ever.
 *
 * Migration 008 stored the tick as `done_at` on the line itself — one moment in
 * time and nothing that says which day it was about. For a task that is exactly
 * right: a task exists on one day, so "ticked at all" and "ticked for its day"
 * are the same sentence. For a habit it is not: a line ticked on Monday stayed
 * ticked on Tuesday, because the row Tuesday reads is the same row Monday wrote.
 *
 * The owner's rule is that habits and their subtasks are **repeatable and
 * reviewable** — «сегодня я сходил в зал и сделал разминку, а завтра не сделал» —
 * so yesterday has to keep its own answer. A tick therefore becomes a row of its
 * own, keyed by the line and the occurrence's local date, and the line goes back
 * to being only what it is: text and an order.
 *
 * **Presence is the tick.** A row means done, no row means not done, and undoing
 * removes it — so "not done" costs nothing to store and there is no second flag
 * that could disagree with the row's existence. `done_at` stays on the tick as
 * *when*, which is what the column always meant.
 *
 * **A line also has to be able to begin.** 008 gave it `deleted_from` so removing
 * one would not rewrite the past; with every day now keeping its own answer, the
 * other end matters as much — without `created_from` a line added today would
 * appear, unticked, on every day that has already gone, and make each of them
 * read as unfinished. A line exists from `created_from` until `deleted_from`,
 * the second exclusive, which is the same effective-dated shape the rest of the
 * Planner runs on. Carried rows take the UTC day of their `created_at`; that
 * fallback has never had a row to apply to.
 *
 * **Two sources for one fact is what this removes**, so `done_at` leaves the line
 * rather than staying beside the ticks as a second answer to the same question.
 * That is a rebuild, and it is the only thing in the database this touches:
 * every other table is snapshotted before and compared after.
 *
 * Nothing has ever written to `habit_checklist_items` — no repository, no
 * command, no screen — so in every real database it is empty and the rebuild
 * carries nothing. It is written to carry rows anyway, and to **refuse** rather
 * than guess if it ever meets a `done_at` it cannot attribute to a day.
 */
const REBUILD_DDL = String.raw`
CREATE TABLE habit_checklist_items_new (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) > 0),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_from TEXT NOT NULL CHECK (created_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  deleted_from TEXT NULL CHECK (deleted_from IS NULL OR deleted_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND deleted_from > created_from),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
INSERT INTO habit_checklist_items_new (id, habit_id, text, sort_order, created_from, created_at, deleted_from)
  SELECT id, habit_id, text, sort_order, date(created_at / 1000, 'unixepoch'), created_at, deleted_from FROM habit_checklist_items;
DROP TABLE habit_checklist_items;
ALTER TABLE habit_checklist_items_new RENAME TO habit_checklist_items;
CREATE INDEX habit_checklist_items_habit_idx ON habit_checklist_items(habit_id, sort_order);

CREATE TABLE habit_checklist_ticks (
  checklist_item_id TEXT NOT NULL,
  occurrence_local_date TEXT NOT NULL CHECK (occurrence_local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_at INTEGER NOT NULL CHECK (done_at >= 0),
  PRIMARY KEY (checklist_item_id, occurrence_local_date),
  FOREIGN KEY (checklist_item_id) REFERENCES habit_checklist_items(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX habit_checklist_ticks_date_idx ON habit_checklist_ticks(occurrence_local_date);`;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 009 scalar verification failed.');
  return row.value;
}

async function snapshotTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 009 requires bounded row reads.');
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'${ITEMS}' ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Migration 009 found an unsupported source table name.');
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${name}" ORDER BY rowid;`)),
    }));
  }
  return Object.freeze(snapshots);
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 8) throw new Error('Migration 009 requires source schema version 8.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 009 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 009 source integrity failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name='${TICKS}';`) !== 0) throw new Error('Migration 009 found a pre-existing tick table.');
  // A tick with no day cannot be given one without inventing it, and a subtask's
  // history is exactly what this migration exists to keep honest.
  if (await scalar(database, `SELECT count(*) AS value FROM ${ITEMS} WHERE done_at IS NOT NULL;`) !== 0) throw new Error('Migration 009 found a tick that belongs to no day.');

  const before = await snapshotTables(database);
  const lines = await scalar(database, `SELECT count(*) AS value FROM ${ITEMS};`);
  await database.execAsync(REBUILD_DDL);

  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${ITEMS}');`) !== 7 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${ITEMS}') WHERE name='created_from';`) !== 1 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${ITEMS}') WHERE name='done_at';`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM ${ITEMS};`) !== lines ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TICKS}');`) !== 3 ||
    await scalar(database, `SELECT count(*) AS value FROM ${TICKS};`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${ITEMS}') WHERE "table"='habits' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${TICKS}') WHERE "table"='${ITEMS}' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1
  ) {
    throw new Error('Migration 009 checklist verification failed.');
  }

  // Only the checklist line changed shape. Nothing else may have moved a row.
  for (const snapshot of before) {
    if (database.getAllAsync === undefined) throw new Error('Migration 009 requires bounded row reads.');
    const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 009 changed preserved table ${snapshot.name}.`);
  }
  // And the observation contract in particular is untouched, which is still the
  // reason a subtask can never reach a statistic: there is nothing to aggregate.
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('habit_observations');`) === 0) throw new Error('Migration 009 lost the observation table.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 009 foreign-key verification failed.');
}

export const PLANNER_CHECKLIST_DAY_TICKS_MIGRATION: Migration = Object.freeze({
  version: PLANNER_CHECKLIST_DAY_TICKS_SCHEMA_VERSION,
  name: 'planner-checklist-day-ticks',
  setUserVersionSql: 'PRAGMA user_version = 9;',
  apply,
});
