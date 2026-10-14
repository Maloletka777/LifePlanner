import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_PLANNED_DURATION_SCHEMA_VERSION = 13;

const TABLE_NAME = 'habit_planned_time_versions';
const COLUMN_NAME = 'planned_duration_minutes';

/**
 * How long a planned thing is meant to take.
 *
 * **It lives beside the planned time, in the same effective-dated row, and that is the
 * whole decision.** A duration is not an independent fact about an item — it is the
 * other half of «when»: a version carrying a time from one era and a length from
 * another would describe a day that never existed. `habit_planned_time_versions` is
 * already the time family (PD-EDIT-008 names it), already effective-dated, and already
 * the row an edit appends to, so the length is appended and corrected by exactly the
 * machinery the minute is.
 *
 * **The interface that asks for it was built before the column existed.** The time drum
 * already cuts the day by a chosen length so a start can be picked (PD-CREATE-029), and
 * PD-CREATE-030 recorded, in as many words, that the length was thrown away because
 * nothing stored it — the sheet carries a caption saying so. This is that caption's
 * retirement.
 *
 * **`NULL` means «unknown», never «zero» and never a default.** Every row written before
 * this migration reads back as what it is: an item whose length nobody ever stated. A
 * backfill would have to invent one — «half an hour, probably» — which is precisely the
 * fabrication in a database that `AGENTS.md` forbids, and the surfaces that draw a
 * length are built to draw its absence instead.
 *
 * **`ALTER TABLE ... ADD COLUMN`, deliberately, rather than a rebuild.** A rebuild would
 * have to re-create the table, carry every row and re-create three indexes, and this
 * project has already paid for a rebuild that went half-done: Migration 010 exists to
 * repair a checklist table that diverged from its own version, and PD-DATA-001 records
 * what that cost. `ADD COLUMN` writes one row of `sqlite_schema` and touches no data at
 * all, so there is no half-done state for it to reach.
 *
 * The bound is the day: a positive number of minutes, at most 1440. Whether a length may
 * run past the end of the day's own window is a question about the window and is
 * answered where the window lives, not in a column constraint that cannot see the minute
 * it would have to be measured from.
 */
const ADD_COLUMN_DDL = String.raw`
ALTER TABLE habit_planned_time_versions
  ADD COLUMN planned_duration_minutes INTEGER NULL
  CHECK (planned_duration_minutes IS NULL OR (planned_duration_minutes > 0 AND planned_duration_minutes <= 1440));`;

/** The eight columns the table carried before this migration, in `cid` order. */
const PRESERVED_COLUMNS = [
  'id', 'habit_id', 'version_number', 'effective_from', 'effective_to',
  'planned_local_time', 'created_at', 'updated_at',
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
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 013 scalar verification failed.');
  return row.value;
}

async function rows(database: MigrationDatabase, sql: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 013 requires bounded row reads.');
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
      throw new Error('Migration 013 found an unsupported source table name.');
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
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 12) throw new Error('Migration 013 requires source schema version 12.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 013 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 013 source integrity failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}');`) !== PRESERVED_COLUMNS.length) throw new Error('Migration 013 requires the version 12 planned-time table.');
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}') WHERE name='${COLUMN_NAME}';`) !== 0) throw new Error('Migration 013 found a pre-existing planned-duration column.');

  const otherTablesBefore = await snapshotOtherTables(database);
  const plannedTimeBefore = await snapshotPreservedColumns(database);
  const rowCountBefore = await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`);

  await database.execAsync(ADD_COLUMN_DDL);

  // The column exists, it is the ninth, and it is nullable.
  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}');`) !== PRESERVED_COLUMNS.length + 1 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}') WHERE name='${COLUMN_NAME}' AND "notnull"=0 AND dflt_value IS NULL;`) !== 1
  ) {
    throw new Error('Migration 013 planned-duration column verification failed.');
  }

  // Absence means unknown: this migration invents a length for nobody.
  if (await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME} WHERE ${COLUMN_NAME} IS NOT NULL;`) !== 0) {
    throw new Error('Migration 013 wrote a planned duration.');
  }

  // Every row of the altered table survives, in every column it already had.
  if (await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`) !== rowCountBefore) throw new Error('Migration 013 lost planned-time rows.');
  if (await snapshotPreservedColumns(database) !== plannedTimeBefore) throw new Error('Migration 013 changed preserved planned-time columns.');

  // And so does every index Migration 004 put on it.
  for (const indexName of PRESERVED_INDEXES) {
    if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE type='index' AND name='${indexName}';`) !== 1) {
      throw new Error(`Migration 013 lost index ${indexName}.`);
    }
  }

  // A pure addition may not have moved a single row of anything else.
  for (const snapshot of otherTablesBefore) {
    const after = await rows(database, `SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 013 changed preserved table ${snapshot.name}.`);
  }
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 013 foreign-key verification failed.');
}

export const PLANNER_PLANNED_DURATION_MIGRATION: Migration = Object.freeze({
  version: PLANNER_PLANNED_DURATION_SCHEMA_VERSION,
  name: 'planner-planned-duration',
  setUserVersionSql: 'PRAGMA user_version = 13;',
  apply,
});
