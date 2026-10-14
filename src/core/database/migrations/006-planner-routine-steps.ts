import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_ROUTINE_STEPS_SCHEMA_VERSION = 6;

const TABLE_NAME = 'habit_ordinary_parent_versions';
const REBUILD_TABLE_NAME = 'habit_ordinary_parent_versions_v6';

const TABLE_DDL = String.raw`
CREATE TABLE habit_ordinary_parent_versions_v6 (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  relationship_id TEXT NOT NULL CHECK (length(trim(relationship_id)) > 0),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  parent_habit_id TEXT NOT NULL,
  child_habit_id TEXT NOT NULL,
  completion_role TEXT NOT NULL CHECK (completion_role IN ('organizational','routine_step')),
  effective_from TEXT NOT NULL CHECK (length(effective_from) = 10),
  effective_to TEXT,
  end_reason TEXT CHECK (end_reason IN ('scheduled_end','detached','reparented','parent_archived','child_archived')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (parent_habit_id <> child_habit_id),
  CHECK ((effective_to IS NULL AND end_reason IS NULL) OR (effective_to IS NOT NULL AND length(effective_to)=10 AND effective_to>effective_from AND end_reason IS NOT NULL)),
  UNIQUE (relationship_id,version_number),
  UNIQUE (child_habit_id,effective_from),
  FOREIGN KEY (parent_habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (child_habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

const INDEX_DDL = String.raw`
CREATE INDEX idx_habit_ordinary_parent_range ON habit_ordinary_parent_versions(parent_habit_id,effective_from,effective_to,child_habit_id);
CREATE INDEX idx_habit_ordinary_child_range ON habit_ordinary_parent_versions(child_habit_id,effective_from,effective_to,parent_habit_id);
CREATE UNIQUE INDEX uq_habit_ordinary_open_child ON habit_ordinary_parent_versions(child_habit_id) WHERE effective_to IS NULL;
CREATE UNIQUE INDEX uq_habit_ordinary_open_pair ON habit_ordinary_parent_versions(parent_habit_id,child_habit_id) WHERE effective_to IS NULL;`;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) {
    throw new Error('Migration 006 scalar verification failed.');
  }
  return row.value;
}

async function snapshotPreservedTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) {
    throw new Error('Migration 006 requires bounded row reads.');
  }
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema
     WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'${TABLE_NAME}'
     ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error('Migration 006 found an unsupported source table name.');
    }
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await database.getAllAsync<Readonly<Record<string, unknown>>>(
        `SELECT * FROM "${name}" ORDER BY rowid;`,
      )),
    }));
  }
  return Object.freeze(snapshots);
}

async function verifyPreservedTables(
  database: MigrationDatabase,
  before: readonly TableSnapshot[],
): Promise<void> {
  if (database.getAllAsync === undefined) {
    throw new Error('Migration 006 requires bounded row reads.');
  }
  for (const snapshot of before) {
    const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(
      `SELECT * FROM "${snapshot.name}" ORDER BY rowid;`,
    );
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) {
      throw new Error(`Migration 006 changed preserved table ${snapshot.name}.`);
    }
  }
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 5) {
    throw new Error('Migration 006 requires source schema version 5.');
  }
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) {
    throw new Error('Migration 006 requires foreign keys enabled.');
  }
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) {
    throw new Error('Migration 006 source integrity failed.');
  }
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name='${REBUILD_TABLE_NAME}';`) !== 0) {
    throw new Error('Migration 006 found a pre-existing rebuild table.');
  }
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}') WHERE name='completion_role';`) !== 0) {
    throw new Error('Migration 006 source already contains a completion role.');
  }
  if (database.getAllAsync === undefined) {
    throw new Error('Migration 006 requires bounded row reads.');
  }

  const preserved = await snapshotPreservedTables(database);
  const ordinaryBefore = await database.getAllAsync<Readonly<Record<string, unknown>>>(
    `SELECT id,relationship_id,version_number,parent_habit_id,child_habit_id,
            effective_from,effective_to,end_reason,created_at,updated_at
     FROM ${TABLE_NAME} ORDER BY rowid;`,
  );

  await database.execAsync('PRAGMA defer_foreign_keys = ON;');
  if (await scalar(database, 'SELECT defer_foreign_keys AS value FROM pragma_defer_foreign_keys;') !== 1) {
    throw new Error('Migration 006 could not defer foreign-key checks.');
  }
  await database.execAsync(TABLE_DDL);
  await database.execAsync(String.raw`
    INSERT INTO habit_ordinary_parent_versions_v6(
      id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,
      effective_from,effective_to,end_reason,created_at,updated_at
    )
    SELECT id,relationship_id,version_number,parent_habit_id,child_habit_id,'organizational',
           effective_from,effective_to,end_reason,created_at,updated_at
    FROM habit_ordinary_parent_versions
    ORDER BY rowid;
  `);

  const copied = await database.getAllAsync<Readonly<Record<string, unknown>>>(
    `SELECT id,relationship_id,version_number,parent_habit_id,child_habit_id,
            effective_from,effective_to,end_reason,created_at,updated_at
     FROM ${REBUILD_TABLE_NAME} ORDER BY rowid;`,
  );
  if (
    JSON.stringify(copied) !== JSON.stringify(ordinaryBefore) ||
    await scalar(database, `SELECT count(*) AS value FROM ${REBUILD_TABLE_NAME} WHERE completion_role<>'organizational';`) !== 0
  ) {
    throw new Error('Migration 006 ordinary relationship copy verification failed.');
  }

  await database.execAsync(String.raw`
    DROP TABLE habit_ordinary_parent_versions;
    ALTER TABLE habit_ordinary_parent_versions_v6 RENAME TO habit_ordinary_parent_versions;
  `);
  await database.execAsync(INDEX_DDL);

  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}') WHERE name='completion_role' AND type='TEXT' AND "notnull"=1 AND dflt_value IS NULL;`) !== 1 ||
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`) !== ordinaryBefore.length ||
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME} WHERE completion_role NOT IN ('organizational','routine_step');`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE type='index' AND name IN ('idx_habit_ordinary_parent_range','idx_habit_ordinary_child_range','uq_habit_ordinary_open_child','uq_habit_ordinary_open_pair');`) !== 4
  ) {
    throw new Error('Migration 006 final table or index verification failed.');
  }
  await verifyPreservedTables(database, preserved);
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) {
    throw new Error('Migration 006 foreign-key verification failed.');
  }
}

export const PLANNER_ROUTINE_STEPS_MIGRATION: Migration = Object.freeze({
  version: PLANNER_ROUTINE_STEPS_SCHEMA_VERSION,
  name: 'planner-explicit-routine-step-semantics',
  setUserVersionSql: 'PRAGMA user_version = 6;',
  apply,
});
