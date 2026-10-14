import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_HABIT_GROWTH_SCHEMA_VERSION = 15;

const TABLE_NAME = 'habit_growth';

/**
 * The routines a person is deliberately growing, and when each attempt began.
 *
 * **This is the second floor, and it is a table of its own so that the separation is
 * structural rather than remembered.** The product has two levels: ordinary analytics
 * describes everything in the diary, while states, counters, medals and diagnosis
 * accompany only the one to three routines a person marked. Held as columns on `habits`,
 * that boundary would be a rule somebody has to keep in mind while writing every query.
 * Held as a separate table, the first floor **cannot see the second at all** — a query
 * that counts completions never joins here, and could not accidentally.
 *
 * **A row is an attempt, not a routine, and that is the owner's instruction applied
 * literally**: data is written on top of old data rather than over it, so that progress
 * stays visible. Someone who marks a habit, stops six weeks later and takes it up again
 * in the spring has two rows and two stories; overwriting one row would have silently
 * erased the first attempt, which is exactly the shape of loss this project's append-only
 * observations and effective-dated versions exist to prevent.
 *
 * **`tracked_from` is why the table can be this small.** Everything on the second floor
 * counts from the marking rather than from the habit's whole history: a routine that has
 * quietly run for six months and is only now being *built* starts at zero, because the
 * marking is the person saying «I am taking this on now». The date sits in the same row
 * as the fact it qualifies, so no separate mechanism is needed to express it.
 *
 * `stopped_from` is a date rather than a flag, for the same reason `deleted_from` is one
 * on a checklist line (PD-SUBTASK-001): an attempt that ended did not stop having
 * happened, and a day inside it must still read as a day inside it.
 *
 * **`uq_habit_growth_open` is the invariant.** At most one attempt per habit may be open,
 * enforced by a partial unique index — the same device `uq_habit_planned_time_open` uses
 * for exactly the same kind of guarantee. The **cap of three open attempts across all
 * habits is deliberately not here**: three is a product judgement that may move, and a
 * number a person argued about does not belong in a constraint that would need a
 * migration to change.
 *
 * `cue` is the answer to «after what do you do this?» — an implementation intention, the
 * largest single effect in the behaviour-change literature. It is free text because a
 * cue is the person's own sentence; the surface may offer one from the block's sequence,
 * but what gets stored is what they accepted.
 *
 * `enjoyment` is recorded because enjoyment of the behaviour predicts habit strength, and
 * a routine somebody hates is worth naming as such at the moment it is taken on rather
 * than diagnosing three weeks later. Both are nullable: an attempt is valid before either
 * question is answered, and refusing to answer is not an error.
 *
 * A pure addition, like Migrations 008, 011 and 012, so the verification is about what it
 * must **not** have disturbed: every existing table is snapshotted before and compared
 * after.
 */
const TABLE_DDL = String.raw`
CREATE TABLE habit_growth (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  tracked_from TEXT NOT NULL CHECK (length(tracked_from) = 10),
  stopped_from TEXT NULL CHECK (
      stopped_from IS NULL
      OR (length(stopped_from) = 10 AND stopped_from > tracked_from)
  ),
  cue TEXT NULL CHECK (cue IS NULL OR length(trim(cue)) BETWEEN 1 AND 120),
  enjoyment TEXT NULL CHECK (enjoyment IS NULL OR enjoyment IN ('yes', 'tolerated', 'no')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (habit_id, attempt_number),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_habit_growth_open ON habit_growth(habit_id) WHERE stopped_from IS NULL;
CREATE INDEX idx_habit_growth_range ON habit_growth(habit_id, tracked_from, stopped_from);`;

const EXPECTED_COLUMN_COUNT = 9;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 015 scalar verification failed.');
  return row.value;
}

async function snapshotTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 015 requires bounded row reads.');
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Migration 015 found an unsupported source table name.');
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${name}" ORDER BY rowid;`)),
    }));
  }
  return Object.freeze(snapshots);
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 14) throw new Error('Migration 015 requires source schema version 14.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 015 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 015 source integrity failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name='${TABLE_NAME}';`) !== 0) throw new Error('Migration 015 found a pre-existing growth table.');
  // An attempt points at a habit, so the habits it points at have to be there.
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('habits');`) === 0) throw new Error('Migration 015 requires the habits table.');

  const before = await snapshotTables(database);
  await database.execAsync(TABLE_DDL);

  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}');`) !== EXPECTED_COLUMN_COUNT ||
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${TABLE_NAME}') WHERE "table"='habits' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1
  ) {
    throw new Error('Migration 015 growth table verification failed.');
  }

  // The one invariant the schema is allowed to hold: at most one open attempt per habit.
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE type='index' AND name='uq_habit_growth_open';`) !== 1) {
    throw new Error('Migration 015 open-attempt index verification failed.');
  }
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE type='index' AND name='idx_habit_growth_range';`) !== 1) {
    throw new Error('Migration 015 range index verification failed.');
  }

  // A pure addition may not have moved a single row of anything that was here.
  for (const snapshot of before) {
    if (database.getAllAsync === undefined) throw new Error('Migration 015 requires bounded row reads.');
    const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 015 changed preserved table ${snapshot.name}.`);
  }
  // The first floor in particular is untouched: this table records what a person chose to
  // grow and has no business editing what they did.
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('habits');`) !== 11) throw new Error('Migration 015 changed the habits table.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 015 foreign-key verification failed.');
}

export const PLANNER_HABIT_GROWTH_MIGRATION: Migration = Object.freeze({
  version: PLANNER_HABIT_GROWTH_SCHEMA_VERSION,
  name: 'planner-habit-growth',
  setUserVersionSql: 'PRAGMA user_version = 15;',
  apply,
});
