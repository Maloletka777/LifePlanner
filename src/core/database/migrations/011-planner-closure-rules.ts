import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_CLOSURE_RULES_SCHEMA_VERSION = 11;

const TABLE_NAME = 'habit_closure_rules';

/**
 * How an item is closed becomes the person's choice again.
 *
 * Ticking every line of a checklist closes the item, and that has been
 * unconditional since PD-SUBTASK-003. The owner wants the choice back: an item
 * either closes when its last line is ticked, or only by its own checkbox.
 *
 * **It is one row per item, in a table of its own, and absence is the default.**
 * Two reasons rather than one. The habit aggregate stays untouched, so nothing in
 * the create/edit command chain, `prepareInitialHabit` or the observation contract
 * has to learn a new field — the same trade the checklist itself made in
 * Migration 008. And a rule that is stored only when it differs from the default
 * means every habit written before this migration reads back exactly as it behaves
 * today, without a backfill that would have to guess.
 *
 * **It is deliberately not effective-dated.** Schedules, tracking and importance
 * are, because they decide what a past day *meant*. This decides what happens when
 * a finger lands on a checkbox, and re-reading it for a past day would change
 * nothing about that day's record: closing through the last line writes the same
 * observation, through the same command, as closing by hand — which is what makes
 * a mark on a day that is over stay missed (PD-OVERVIEW-012) whichever way it was
 * made.
 *
 * A pure addition, so the verification is about what it must **not** have
 * disturbed: every existing table is snapshotted before and compared after.
 */
const TABLE_DDL = String.raw`
CREATE TABLE habit_closure_rules (
  habit_id TEXT NOT NULL PRIMARY KEY,
  closes_by_checklist INTEGER NOT NULL CHECK (closes_by_checklist IN (0, 1)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 011 scalar verification failed.');
  return row.value;
}

async function snapshotTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 011 requires bounded row reads.');
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Migration 011 found an unsupported source table name.');
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${name}" ORDER BY rowid;`)),
    }));
  }
  return Object.freeze(snapshots);
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 10) throw new Error('Migration 011 requires source schema version 10.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 011 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 011 source integrity failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name='${TABLE_NAME}';`) !== 0) throw new Error('Migration 011 found a pre-existing closure-rule table.');

  const before = await snapshotTables(database);
  await database.execAsync(TABLE_DDL);

  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}');`) !== 3 ||
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${TABLE_NAME}') WHERE "table"='habits' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1
  ) {
    throw new Error('Migration 011 closure-rule table verification failed.');
  }

  for (const snapshot of before) {
    if (database.getAllAsync === undefined) throw new Error('Migration 011 requires bounded row reads.');
    const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 011 changed preserved table ${snapshot.name}.`);
  }
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('habit_observations');`) === 0) throw new Error('Migration 011 lost the observation table.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 011 foreign-key verification failed.');
}

export const PLANNER_CLOSURE_RULES_MIGRATION: Migration = Object.freeze({
  version: PLANNER_CLOSURE_RULES_SCHEMA_VERSION,
  name: 'planner-closure-rules',
  setUserVersionSql: 'PRAGMA user_version = 11;',
  apply,
});
