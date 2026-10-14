import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_PLANNED_BLOCK_SCHEMA_VERSION = 14;

const TABLE_NAME = 'habit_planned_time_versions';
const COLUMN_NAME = 'planned_block';

/**
 * Which part of the day a planned thing belongs to.
 *
 * **The block lives beside the minute and the length, because it is the third part of
 * one answer.** «Когда» is now three facts — which part of the day, how long it takes,
 * and, only sometimes, at exactly what minute — and a version carrying a block from one
 * era beside a time from another would describe a day that never existed. This is the
 * same reasoning Migration 013 gave for the duration, applied to the fact that arrived
 * after it, and it means the block inherits the whole time family's machinery: the same
 * append, the same same-day correction, the same conflict check (PD-EDIT-008).
 *
 * **Every habit already has a row here, and that is what makes this possible.** The
 * creation path inserts a planned-time version unconditionally — unlike the reminder
 * insert three statements below it, which is guarded — so an item with no time of day
 * still owns a row with `planned_local_time` NULL. There is always somewhere to put the
 * block, including for the items that will never carry a minute.
 *
 * **The clock never assigns the block; only a person does.** That is a product rule with
 * a data consequence, so it is worth writing down where the column is created: if the
 * block were derived from the hour, a morning routine performed at 12:40 would be
 * recorded under «day», and the pattern «mornings collapse on Wednesdays» would become
 * unconstructible — every failed morning would have quietly moved into the afternoon.
 * The column exists precisely so that where a thing *belongs* and when it was *done* stay
 * two separate facts.
 *
 * **`NULL` means «no block», and that is a real state rather than missing data.** It is
 * how an item says «anytime»: no part of the day claims it. Every row written before this
 * migration therefore reads back correctly without a backfill — those items had no block
 * because the concept did not exist, and «no block» is exactly what they should be. A
 * surface that wants to suggest one derives it from the planned minute at read time and
 * never writes that guess back.
 *
 * **`ALTER TABLE ... ADD COLUMN`, not a rebuild**, for the reason Migration 013 records:
 * a rebuild carries every row and re-creates three indexes, Migration 010 exists because
 * one went half-done, and adding a column writes one row of `sqlite_schema` and touches
 * no data, so it has no half-done state to reach.
 *
 * The three values are closed by a CHECK. They are parts of a day rather than clock
 * ranges — the ranges belong to the surface that suggests a block, because they are a
 * default a person may contradict, and a default does not belong in a constraint.
 */
const ADD_COLUMN_DDL = String.raw`
ALTER TABLE habit_planned_time_versions
  ADD COLUMN planned_block TEXT NULL
  CHECK (planned_block IS NULL OR planned_block IN ('morning','day','evening'));`;

/** The nine columns the table carried before this migration, in `cid` order. */
const PRESERVED_COLUMNS = [
  'id', 'habit_id', 'version_number', 'effective_from', 'effective_to',
  'planned_local_time', 'created_at', 'updated_at', 'planned_duration_minutes',
] as const;

/** The indexes Migration 004 put on this table. A pure addition may not lose one. */
const PRESERVED_INDEXES = [
  'idx_habit_planned_time_range',
  'uq_habit_planned_time_open',
  'idx_habit_planned_time_order',
] as const;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 014 scalar verification failed.');
  return row.value;
}

async function rows(database: MigrationDatabase, sql: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 014 requires bounded row reads.');
  return await database.getAllAsync<Readonly<Record<string, unknown>>>(sql);
}

/** Every table except the one being altered, so «nothing else moved» is provable. */
async function snapshotOtherTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  const names = await rows(
    database,
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'${TABLE_NAME}' ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const entry of names) {
    const name = entry.name;
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error('Migration 014 found an unsupported source table name.');
    }
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await rows(database, `SELECT * FROM "${name}" ORDER BY rowid;`)),
    }));
  }
  return Object.freeze(snapshots);
}

/** The altered table read through its *old* shape, which is what must survive unchanged. */
async function snapshotPreservedColumns(database: MigrationDatabase): Promise<string> {
  const projection = PRESERVED_COLUMNS.join(',');
  return JSON.stringify(await rows(database, `SELECT ${projection} FROM ${TABLE_NAME} ORDER BY rowid;`));
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 13) throw new Error('Migration 014 requires source schema version 13.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 014 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 014 source integrity failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}');`) !== PRESERVED_COLUMNS.length) throw new Error('Migration 014 requires the version 13 planned-time table.');
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}') WHERE name='${COLUMN_NAME}';`) !== 0) throw new Error('Migration 014 found a pre-existing planned-block column.');

  const otherTablesBefore = await snapshotOtherTables(database);
  const plannedTimeBefore = await snapshotPreservedColumns(database);
  const rowCountBefore = await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`);

  await database.execAsync(ADD_COLUMN_DDL);

  // The column exists, it is the tenth, and it is nullable with no default.
  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}');`) !== PRESERVED_COLUMNS.length + 1 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}') WHERE name='${COLUMN_NAME}' AND "notnull"=0 AND dflt_value IS NULL;`) !== 1
  ) {
    throw new Error('Migration 014 planned-block column verification failed.');
  }

  // Absence means «no block»: this migration assigns one to nobody, and in particular
  // does not derive one from the minute a row happens to carry.
  if (await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME} WHERE ${COLUMN_NAME} IS NOT NULL;`) !== 0) {
    throw new Error('Migration 014 wrote a planned block.');
  }

  // Every row of the altered table survives, in every column it already had.
  if (await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`) !== rowCountBefore) throw new Error('Migration 014 lost planned-time rows.');
  if (await snapshotPreservedColumns(database) !== plannedTimeBefore) throw new Error('Migration 014 changed preserved planned-time columns.');

  // And so does every index Migration 004 put on it.
  for (const indexName of PRESERVED_INDEXES) {
    if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE type='index' AND name='${indexName}';`) !== 1) {
      throw new Error(`Migration 014 lost index ${indexName}.`);
    }
  }

  // A pure addition may not have moved a single row of anything else.
  for (const snapshot of otherTablesBefore) {
    const after = await rows(database, `SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 014 changed preserved table ${snapshot.name}.`);
  }
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 014 foreign-key verification failed.');
}

export const PLANNER_PLANNED_BLOCK_MIGRATION: Migration = Object.freeze({
  version: PLANNER_PLANNED_BLOCK_SCHEMA_VERSION,
  name: 'planner-planned-block',
  setUserVersionSql: 'PRAGMA user_version = 14;',
  apply,
});
