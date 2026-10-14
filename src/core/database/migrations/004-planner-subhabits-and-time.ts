import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_SUBHABITS_TIME_SCHEMA_VERSION = 4;

const TABLE_DDL = String.raw`
CREATE TABLE habit_ordinary_parent_versions (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  relationship_id TEXT NOT NULL CHECK (length(trim(relationship_id)) > 0),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  parent_habit_id TEXT NOT NULL,
  child_habit_id TEXT NOT NULL,
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
);

CREATE TABLE habit_planned_time_versions (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  effective_from TEXT NOT NULL CHECK (length(effective_from) = 10),
  effective_to TEXT,
  planned_local_time TEXT CHECK (planned_local_time IS NULL OR (planned_local_time GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(planned_local_time,1,2) AS INTEGER)<=23)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (effective_to IS NULL OR (length(effective_to)=10 AND effective_to>effective_from)),
  UNIQUE (habit_id,version_number),
  UNIQUE (habit_id,effective_from),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

const INDEX_DDL = String.raw`
CREATE INDEX idx_habit_ordinary_parent_range ON habit_ordinary_parent_versions(parent_habit_id,effective_from,effective_to,child_habit_id);
CREATE INDEX idx_habit_ordinary_child_range ON habit_ordinary_parent_versions(child_habit_id,effective_from,effective_to,parent_habit_id);
CREATE UNIQUE INDEX uq_habit_ordinary_open_child ON habit_ordinary_parent_versions(child_habit_id) WHERE effective_to IS NULL;
CREATE UNIQUE INDEX uq_habit_ordinary_open_pair ON habit_ordinary_parent_versions(parent_habit_id,child_habit_id) WHERE effective_to IS NULL;
CREATE INDEX idx_habit_planned_time_range ON habit_planned_time_versions(habit_id,effective_from,effective_to);
CREATE UNIQUE INDEX uq_habit_planned_time_open ON habit_planned_time_versions(habit_id) WHERE effective_to IS NULL;
CREATE INDEX idx_habit_planned_time_order ON habit_planned_time_versions(planned_local_time,habit_id,effective_from);`;

const V4_OBJECT_NAMES = [
  'habit_ordinary_parent_versions',
  'habit_planned_time_versions',
  'idx_habit_ordinary_parent_range',
  'idx_habit_ordinary_child_range',
  'uq_habit_ordinary_open_child',
  'uq_habit_ordinary_open_pair',
  'idx_habit_planned_time_range',
  'uq_habit_planned_time_open',
  'idx_habit_planned_time_order',
] as const;

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 004 count verification failed.');
  return row.value;
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 3) throw new Error('Migration 004 requires source schema version 3.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 004 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 004 source integrity failed.');
  const quotedNames = V4_OBJECT_NAMES.map((name) => `'${name}'`).join(',');
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name IN (${quotedNames});`) !== 0) throw new Error('Migration 004 found pre-existing v4 objects.');
  const habitCount = await scalar(database, 'SELECT count(*) AS value FROM habits;');
  const v3Counts = await database.getFirstAsync<{
    schedules: number; tracking: number; importance: number; dependencies: number;
    observations: number; lifecycle: number; contexts: number;
  }>(`SELECT
    (SELECT count(*) FROM habit_schedule_versions) AS schedules,
    (SELECT count(*) FROM habit_tracking_versions) AS tracking,
    (SELECT count(*) FROM habit_importance_versions) AS importance,
    (SELECT count(*) FROM habit_dependency_versions) AS dependencies,
    (SELECT count(*) FROM habit_observations) AS observations,
    (SELECT count(*) FROM habit_lifecycle_transitions) AS lifecycle,
    (SELECT count(*) FROM habit_observation_schedule_contexts) AS contexts;`);
  if (v3Counts === null) throw new Error('Migration 004 could not capture v3 counts.');

  await database.execAsync(TABLE_DDL);
  await database.execAsync(INDEX_DDL);
  await database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at) SELECT id,id,1,active_from,active_to,NULL,created_at,created_at FROM habits;`);

  if (await scalar(database, 'SELECT count(*) AS value FROM habit_planned_time_versions;') !== habitCount) throw new Error('Migration 004 planned-time seed count failed.');
  if (await scalar(database, 'SELECT count(*) AS value FROM habit_ordinary_parent_versions;') !== 0) throw new Error('Migration 004 ordinary hierarchy must start empty.');
  if (await scalar(database, `SELECT count(*) AS value FROM (
      SELECT id,id AS habit_id,1 AS version_number,active_from AS effective_from,active_to AS effective_to,NULL AS planned_local_time,created_at,created_at AS updated_at FROM habits
      EXCEPT
      SELECT id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at FROM habit_planned_time_versions
    );`) !== 0) throw new Error('Migration 004 planned-time seed mapping failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name IN (${quotedNames});`) !== V4_OBJECT_NAMES.length) throw new Error('Migration 004 schema objects are incomplete.');
  const afterCounts = await database.getFirstAsync<typeof v3Counts>(`SELECT
    (SELECT count(*) FROM habit_schedule_versions) AS schedules,
    (SELECT count(*) FROM habit_tracking_versions) AS tracking,
    (SELECT count(*) FROM habit_importance_versions) AS importance,
    (SELECT count(*) FROM habit_dependency_versions) AS dependencies,
    (SELECT count(*) FROM habit_observations) AS observations,
    (SELECT count(*) FROM habit_lifecycle_transitions) AS lifecycle,
    (SELECT count(*) FROM habit_observation_schedule_contexts) AS contexts;`);
  if (afterCounts === null || Object.keys(v3Counts).some((key) => afterCounts[key as keyof typeof v3Counts] !== v3Counts[key as keyof typeof v3Counts])) throw new Error('Migration 004 changed v3 canonical counts.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 004 foreign-key verification failed.');
}

export const PLANNER_SUBHABITS_TIME_MIGRATION: Migration = Object.freeze({
  version: PLANNER_SUBHABITS_TIME_SCHEMA_VERSION,
  name: 'planner-ordinary-subhabits-and-planned-time',
  setUserVersionSql: 'PRAGMA user_version = 4;',
  apply,
});
