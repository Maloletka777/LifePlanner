import {
  HABIT_ACCENT_KEYS,
  HABIT_ICON_KEYS,
  habitAccentKeyForId,
  habitIconKeyForTrackingMode,
  type TrackingMode,
} from '../../../features/planner/domain';
import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_VISUAL_IDENTITY_SCHEMA_VERSION = 5;

const TABLE_NAME = 'habit_visual_identities';

const TABLE_DDL = String.raw`
CREATE TABLE habit_visual_identities (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL UNIQUE,
  icon_key TEXT NOT NULL CHECK (length(trim(icon_key)) BETWEEN 1 AND 64),
  accent_key TEXT NOT NULL CHECK (length(trim(accent_key)) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

interface HabitSeedRow {
  readonly id: string;
  readonly created_at: number;
  readonly tracking_mode: unknown;
  readonly latest_count: number;
}

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) {
    throw new Error('Migration 005 scalar verification failed.');
  }
  return row.value;
}

async function captureV4Tables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) {
    throw new Error('Migration 005 requires bounded row reads.');
  }
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema
     WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<> '${TABLE_NAME}'
     ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error('Migration 005 found an unsupported source table name.');
    }
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(
        await database.getAllAsync<Readonly<Record<string, unknown>>>(
          `SELECT * FROM "${name}" ORDER BY rowid;`,
        ),
      ),
    }));
  }
  return Object.freeze(snapshots);
}

async function verifyV4Tables(
  database: MigrationDatabase,
  before: readonly TableSnapshot[],
): Promise<void> {
  if (database.getAllAsync === undefined) {
    throw new Error('Migration 005 requires bounded row reads.');
  }
  for (const snapshot of before) {
    const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(
      `SELECT * FROM "${snapshot.name}" ORDER BY rowid;`,
    );
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) {
      throw new Error(`Migration 005 changed schema-v4 table ${snapshot.name}.`);
    }
  }
}

async function loadSeedRows(database: MigrationDatabase): Promise<readonly HabitSeedRow[]> {
  if (database.getAllAsync === undefined) {
    throw new Error('Migration 005 requires bounded row reads.');
  }
  return database.getAllAsync<HabitSeedRow>(String.raw`
    SELECT h.id,
           h.created_at,
           latest.tracking_mode,
           (
             SELECT count(*)
             FROM habit_tracking_versions duplicate
             WHERE duplicate.habit_id = h.id
               AND duplicate.version_number = latest.version_number
           ) AS latest_count
    FROM habits h
    JOIN habit_tracking_versions latest
      ON latest.habit_id = h.id
     AND latest.version_number = (
       SELECT max(candidate.version_number)
       FROM habit_tracking_versions candidate
       WHERE candidate.habit_id = h.id
     )
    ORDER BY h.id;
  `);
}

function parseTrackingMode(input: unknown): TrackingMode {
  if (
    input === 'checkbox' ||
    input === 'counter' ||
    input === 'quantity' ||
    input === 'duration' ||
    input === 'avoidance'
  ) {
    return input;
  }
  throw new Error('Migration 005 found an unsupported latest tracking mode.');
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 4) {
    throw new Error('Migration 005 requires source schema version 4.');
  }
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) {
    throw new Error('Migration 005 requires foreign keys enabled.');
  }
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) {
    throw new Error('Migration 005 source integrity failed.');
  }
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name='${TABLE_NAME}';`) !== 0) {
    throw new Error('Migration 005 found a pre-existing visual identity object.');
  }

  const before = await captureV4Tables(database);
  const habitCount = await scalar(database, 'SELECT count(*) AS value FROM habits;');
  const seeds = await loadSeedRows(database);
  if (seeds.length !== habitCount || seeds.some((row) => row.latest_count !== 1)) {
    throw new Error('Migration 005 could not resolve one latest tracking row per habit.');
  }

  await database.execAsync(TABLE_DDL);
  for (const seed of seeds) {
    if (!Number.isSafeInteger(seed.created_at) || seed.created_at < 0) {
      throw new Error('Migration 005 found an invalid habit creation timestamp.');
    }
    const iconKey = habitIconKeyForTrackingMode(parseTrackingMode(seed.tracking_mode));
    const accentKey = habitAccentKeyForId(seed.id);
    await database.execAsync(
      `INSERT INTO habit_visual_identities(id,habit_id,icon_key,accent_key,created_at,updated_at)
       VALUES(${sqlText(seed.id)},${sqlText(seed.id)},${sqlText(iconKey)},${sqlText(accentKey)},${seed.created_at},${seed.created_at});`,
    );
  }

  if (await scalar(database, 'SELECT count(*) AS value FROM habit_visual_identities;') !== habitCount) {
    throw new Error('Migration 005 visual identity seed count failed.');
  }
  if (await scalar(database, `SELECT count(*) AS value FROM habits h LEFT JOIN habit_visual_identities v ON v.habit_id=h.id WHERE v.habit_id IS NULL OR v.id<>h.id OR v.created_at<>h.created_at OR v.updated_at<>h.created_at;`) !== 0) {
    throw new Error('Migration 005 visual identity seed mapping failed.');
  }
  if (await scalar(database, `SELECT count(*) AS value FROM habit_visual_identities v LEFT JOIN habits h ON h.id=v.habit_id WHERE h.id IS NULL;`) !== 0) {
    throw new Error('Migration 005 created an orphan visual identity.');
  }
  const iconSql = HABIT_ICON_KEYS.map(sqlText).join(',');
  const accentSql = HABIT_ACCENT_KEYS.map(sqlText).join(',');
  if (await scalar(database, `SELECT count(*) AS value FROM habit_visual_identities WHERE icon_key NOT IN (${iconSql}) OR accent_key NOT IN (${accentSql});`) !== 0) {
    throw new Error('Migration 005 seeded an unsupported registry key.');
  }
  if (database.getAllAsync === undefined) {
    throw new Error('Migration 005 requires bounded row reads.');
  }
  const readback = await database.getAllAsync<{ id: string; icon_key: string; accent_key: string }>(
    'SELECT id,icon_key,accent_key FROM habit_visual_identities ORDER BY id;',
  );
  for (const row of readback) {
    const seed = seeds.find((candidate) => candidate.id === row.id);
    if (
      seed === undefined ||
      row.icon_key !== habitIconKeyForTrackingMode(parseTrackingMode(seed.tracking_mode)) ||
      row.accent_key !== habitAccentKeyForId(seed.id)
    ) {
      throw new Error('Migration 005 deterministic seed verification failed.');
    }
  }
  await verifyV4Tables(database, before);
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) {
    throw new Error('Migration 005 foreign-key verification failed.');
  }
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export const PLANNER_VISUAL_IDENTITY_MIGRATION: Migration = Object.freeze({
  version: PLANNER_VISUAL_IDENTITY_SCHEMA_VERSION,
  name: 'planner-visual-identity',
  setUserVersionSql: 'PRAGMA user_version = 5;',
  apply,
});
