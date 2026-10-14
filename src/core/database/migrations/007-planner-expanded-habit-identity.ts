import {
  ALL_PERSISTED_HABIT_ACCENT_KEYS,
  HABIT_EMOJI_MAX_UTF8_BYTES,
  HABIT_ICON_KEYS,
  REGISTERED_HABIT_SYMBOL_KEYS,
} from '../../../features/planner/domain';
import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_EXPANDED_HABIT_IDENTITY_SCHEMA_VERSION = 7;

const TABLE_NAME = 'habit_visual_identities';
const REBUILD_TABLE_NAME = 'habit_visual_identities_v7';

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const SYMBOL_KEYS_SQL = REGISTERED_HABIT_SYMBOL_KEYS.map(sqlText).join(',');
const ACCENT_KEYS_SQL = ALL_PERSISTED_HABIT_ACCENT_KEYS.map(sqlText).join(',');
const LEGACY_ICON_KEYS_SQL = HABIT_ICON_KEYS.map(sqlText).join(',');

const TABLE_DDL = String.raw`
CREATE TABLE habit_visual_identities_v7 (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL UNIQUE,
  icon_kind TEXT NOT NULL CHECK (icon_kind IN ('symbol','emoji')),
  symbol_key TEXT,
  emoji_value TEXT,
  accent_key TEXT NOT NULL CHECK (accent_key IN (${ACCENT_KEYS_SQL})),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (icon_kind='symbol' AND symbol_key IN (${SYMBOL_KEYS_SQL}) AND emoji_value IS NULL) OR
    (icon_kind='emoji' AND symbol_key IS NULL AND emoji_value IS NOT NULL AND length(emoji_value)>0 AND length(CAST(emoji_value AS BLOB))<=${HABIT_EMOJI_MAX_UTF8_BYTES})
  ),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

type SchemaSnapshot = readonly Readonly<{
  name: string;
  type: string;
  tbl_name: string;
  sql: string | null;
}>[];

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 007 scalar verification failed.');
  return row.value;
}

async function snapshotPreservedTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 007 requires bounded row reads.');
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'${TABLE_NAME}' ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Migration 007 found an unsupported source table name.');
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${name}" ORDER BY rowid;`)),
    }));
  }
  return Object.freeze(snapshots);
}

async function verifyPreservedTables(database: MigrationDatabase, before: readonly TableSnapshot[]): Promise<void> {
  if (database.getAllAsync === undefined) throw new Error('Migration 007 requires bounded row reads.');
  for (const snapshot of before) {
    const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 007 changed preserved table ${snapshot.name}.`);
  }
}

async function snapshotPreservedSchema(database: MigrationDatabase): Promise<SchemaSnapshot> {
  if (database.getAllAsync === undefined) throw new Error('Migration 007 requires bounded schema reads.');
  return Object.freeze(await database.getAllAsync<Readonly<{ name: string; type: string; tbl_name: string; sql: string | null }>>(
    `SELECT name,type,tbl_name,sql FROM sqlite_schema
     WHERE name NOT LIKE 'sqlite_%' AND name<>'${TABLE_NAME}' AND tbl_name<>'${TABLE_NAME}'
     ORDER BY type,name;`,
  ));
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 6) throw new Error('Migration 007 requires source schema version 6.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 007 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 007 source integrity failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name='${REBUILD_TABLE_NAME}';`) !== 0) throw new Error('Migration 007 found a pre-existing rebuild table.');
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}') WHERE name IN ('icon_kind','symbol_key','emoji_value');`) !== 0) throw new Error('Migration 007 source already contains expanded identity columns.');
  if (database.getAllAsync === undefined) throw new Error('Migration 007 requires bounded row reads.');

  const preserved = await snapshotPreservedTables(database);
  const preservedSchema = await snapshotPreservedSchema(database);
  const identityBefore = await database.getAllAsync<Readonly<Record<string, unknown>>>(
    `SELECT id,habit_id,icon_key,accent_key,created_at,updated_at FROM ${TABLE_NAME} ORDER BY rowid;`,
  );
  if (
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME} WHERE id<>habit_id OR icon_key NOT IN (${LEGACY_ICON_KEYS_SQL}) OR accent_key NOT IN (${ACCENT_KEYS_SQL});`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM habits h LEFT JOIN ${TABLE_NAME} v ON v.habit_id=h.id WHERE v.habit_id IS NULL;`) !== 0
  ) {
    throw new Error('Migration 007 source identity facts are malformed or incomplete.');
  }

  await database.execAsync('PRAGMA defer_foreign_keys = ON;');
  if (await scalar(database, 'SELECT defer_foreign_keys AS value FROM pragma_defer_foreign_keys;') !== 1) throw new Error('Migration 007 could not defer foreign-key checks.');
  await database.execAsync(TABLE_DDL);
  await database.execAsync(String.raw`
    INSERT INTO habit_visual_identities_v7(id,habit_id,icon_kind,symbol_key,emoji_value,accent_key,created_at,updated_at)
    SELECT id,habit_id,'symbol',icon_key,NULL,accent_key,created_at,updated_at
    FROM habit_visual_identities ORDER BY rowid;
  `);

  const copied = await database.getAllAsync<Readonly<Record<string, unknown>>>(
    `SELECT id,habit_id,symbol_key AS icon_key,accent_key,created_at,updated_at FROM ${REBUILD_TABLE_NAME} ORDER BY rowid;`,
  );
  if (
    JSON.stringify(copied) !== JSON.stringify(identityBefore) ||
    await scalar(database, `SELECT count(*) AS value FROM ${REBUILD_TABLE_NAME} WHERE icon_kind<>'symbol' OR emoji_value IS NOT NULL;`) !== 0
  ) {
    throw new Error('Migration 007 identity copy verification failed.');
  }

  await database.execAsync(String.raw`
    DROP TABLE habit_visual_identities;
    ALTER TABLE habit_visual_identities_v7 RENAME TO habit_visual_identities;
  `);

  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}') WHERE name IN ('icon_kind','symbol_key','emoji_value') AND type='TEXT';`) !== 3 ||
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`) !== identityBefore.length ||
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME} WHERE icon_kind<>'symbol' OR emoji_value IS NOT NULL;`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_index_list('${TABLE_NAME}') WHERE "unique"=1;`) !== 2 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${TABLE_NAME}') WHERE "table"='habits' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1
  ) {
    throw new Error('Migration 007 final identity table verification failed.');
  }
  await verifyPreservedTables(database, preserved);
  if (JSON.stringify(await snapshotPreservedSchema(database)) !== JSON.stringify(preservedSchema)) {
    throw new Error('Migration 007 changed an unrelated schema object.');
  }
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 007 foreign-key verification failed.');
}

export const PLANNER_EXPANDED_HABIT_IDENTITY_MIGRATION: Migration = Object.freeze({
  version: PLANNER_EXPANDED_HABIT_IDENTITY_SCHEMA_VERSION,
  name: 'planner-expanded-habit-identity',
  setUserVersionSql: 'PRAGMA user_version = 7;',
  apply,
});
