import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_CHECKLIST_ITEMS_SCHEMA_VERSION = 8;

const TABLE_NAME = 'habit_checklist_items';

/**
 * Subtasks, from `design_handoff_manage_subtasks` §C2.
 *
 * **A subtask is a line inside an item, not a record.** It carries text and a
 * `done / not done` and nothing else: no date, no time, no reminder, no priority
 * and — deliberately — **no observation**. The tick is stored **directly**, in
 * `done_at`, rather than as an append-only observation.
 *
 * That is a conscious exception to the observation contract, and it is exactly
 * what makes these lines unable to reach statistics: there is nothing in this
 * table to aggregate. Overview, history and streaks read `habit_observations`,
 * which this migration does not touch, and neither does it touch
 * `habit_categories` or anything else. **The whole change is one new table.**
 *
 * `deleted_from` is what keeps deletion from rewriting the past. A line removed
 * today stops existing from today; a day that stayed open because of it stays
 * open, and its statistics are not recomputed. That is the principle the whole
 * Planner already runs on — observations are append-only and configuration is
 * effective-dated (PD-EDIT-004) — expressed for a line of text.
 *
 * Unlike Migration 007 this rebuilds nothing: it is a pure addition, so the
 * verification is about what it must **not** have disturbed.
 */
const TABLE_DDL = String.raw`
CREATE TABLE habit_checklist_items (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) > 0),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  done_at INTEGER NULL CHECK (done_at IS NULL OR done_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  deleted_from TEXT NULL CHECK (deleted_from IS NULL OR deleted_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX habit_checklist_items_habit_idx ON habit_checklist_items(habit_id, sort_order);`;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 008 scalar verification failed.');
  return row.value;
}

async function snapshotTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 008 requires bounded row reads.');
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Migration 008 found an unsupported source table name.');
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${name}" ORDER BY rowid;`)),
    }));
  }
  return Object.freeze(snapshots);
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 7) throw new Error('Migration 008 requires source schema version 7.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 008 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 008 source integrity failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name='${TABLE_NAME}';`) !== 0) throw new Error('Migration 008 found a pre-existing checklist table.');

  const before = await snapshotTables(database);
  await database.execAsync(TABLE_DDL);

  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}');`) !== 7 ||
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${TABLE_NAME}') WHERE "table"='habits' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1
  ) {
    throw new Error('Migration 008 checklist table verification failed.');
  }

  // A pure addition may not have moved a single row of anything that was here.
  for (const snapshot of before) {
    if (database.getAllAsync === undefined) throw new Error('Migration 008 requires bounded row reads.');
    const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 008 changed preserved table ${snapshot.name}.`);
  }
  // And the observation contract in particular is untouched, which is the whole
  // reason these lines can never reach a statistic.
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('habit_observations');`) === 0) throw new Error('Migration 008 lost the observation table.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 008 foreign-key verification failed.');
}

export const PLANNER_CHECKLIST_ITEMS_MIGRATION: Migration = Object.freeze({
  version: PLANNER_CHECKLIST_ITEMS_SCHEMA_VERSION,
  name: 'planner-checklist-items',
  setUserVersionSql: 'PRAGMA user_version = 8;',
  apply,
});
