import type { Migration, MigrationDatabase } from '../migration';

export const SCHEDULED_DEPENDENCY_EXPIRY_SCHEMA_VERSION = 2;
const REQUIRED_SOURCE_SCHEMA_VERSION = 1;
const SET_SCHEDULED_DEPENDENCY_EXPIRY_SCHEMA_VERSION_SQL =
  'PRAGMA user_version = 2;';

const CREATE_REPLACEMENT_TABLE_SQL = `
CREATE TABLE habit_dependency_versions_v2 (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    relationship_id TEXT NOT NULL CHECK (length(trim(relationship_id)) > 0),
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    parent_habit_id TEXT NOT NULL,
    dependent_habit_id TEXT NOT NULL,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN (
        'follow_up', 'prerequisite'
    )),
    occurrence_mode TEXT NOT NULL DEFAULT 'inherited_parent'
        CHECK (occurrence_mode = 'inherited_parent'),
    effective_from TEXT NOT NULL CHECK (length(effective_from) = 10),
    effective_to TEXT,
    end_reason TEXT CHECK (end_reason IN (
        'scheduled_end', 'replaced', 'unlinked',
        'parent_archived', 'dependent_archived'
    )),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (relationship_id, version_number),
    UNIQUE (relationship_id, effective_from),
    CHECK (parent_habit_id <> dependent_habit_id),
    CHECK (
        (effective_to IS NULL AND end_reason IS NULL)
        OR
        (effective_to IS NOT NULL AND length(effective_to) = 10
            AND effective_to > effective_from AND end_reason IS NOT NULL)
    ),
    FOREIGN KEY (parent_habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (dependent_habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);
`;

const COPY_ROWS_SQL = `
INSERT INTO habit_dependency_versions_v2 (
    id,
    relationship_id,
    version_number,
    parent_habit_id,
    dependent_habit_id,
    dependency_type,
    occurrence_mode,
    effective_from,
    effective_to,
    end_reason,
    created_at,
    updated_at
)
SELECT
    id,
    relationship_id,
    version_number,
    parent_habit_id,
    dependent_habit_id,
    dependency_type,
    occurrence_mode,
    effective_from,
    effective_to,
    end_reason,
    created_at,
    updated_at
FROM habit_dependency_versions;
`;

const DEPENDENCY_INDEXES_SQL = Object.freeze([
  `CREATE UNIQUE INDEX uq_habit_dependency_open_relationship
    ON habit_dependency_versions (relationship_id)
    WHERE effective_to IS NULL;`,
  `CREATE UNIQUE INDEX uq_habit_dependency_open_pair
    ON habit_dependency_versions (parent_habit_id, dependent_habit_id)
    WHERE effective_to IS NULL;`,
  `CREATE UNIQUE INDEX uq_habit_dependency_open_incoming
    ON habit_dependency_versions (dependent_habit_id)
    WHERE effective_to IS NULL;`,
  `CREATE INDEX idx_habit_dependency_parent_range
    ON habit_dependency_versions (
        parent_habit_id, effective_from, effective_to, dependent_habit_id
    );`,
  `CREATE INDEX idx_habit_dependency_dependent_range
    ON habit_dependency_versions (
        dependent_habit_id, effective_from, effective_to, parent_habit_id
    );`,
  `CREATE INDEX idx_habit_dependency_logical_range
    ON habit_dependency_versions (
        relationship_id, effective_from, effective_to
    );`,
] as const);

type UserVersionRow = Readonly<{
  user_version: number;
}>;

type CountRow = Readonly<{
  count: number;
}>;

type ForeignKeyViolationRow = Readonly<{
  table: string;
}>;

async function requireSourceSchemaVersion(
  database: MigrationDatabase,
): Promise<void> {
  const row = await database.getFirstAsync<UserVersionRow>(
    'PRAGMA user_version;',
  );

  if (row?.user_version !== REQUIRED_SOURCE_SCHEMA_VERSION) {
    throw new Error(
      `Migration 002 requires schema version ${REQUIRED_SOURCE_SCHEMA_VERSION}.`,
    );
  }
}

async function readRowCount(
  database: MigrationDatabase,
  table: string,
): Promise<number> {
  const row = await database.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count FROM ${table};`,
  );

  if (row === null || !Number.isSafeInteger(row.count) || row.count < 0) {
    throw new Error(`SQLite returned an invalid row count for ${table}.`);
  }

  return row.count;
}

async function verifyForeignKeyIntegrity(
  database: MigrationDatabase,
): Promise<void> {
  const violation =
    await database.getFirstAsync<ForeignKeyViolationRow>(
      'PRAGMA foreign_key_check;',
    );

  if (violation !== null) {
    throw new Error(
      `Migration 002 produced a foreign-key violation in ${violation.table}.`,
    );
  }
}

export const SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION: Migration = Object.freeze({
  version: SCHEDULED_DEPENDENCY_EXPIRY_SCHEMA_VERSION,
  name: 'scheduled-dependency-expiry',
  setUserVersionSql: SET_SCHEDULED_DEPENDENCY_EXPIRY_SCHEMA_VERSION_SQL,
  requiresForeignKeysDisabled: true,
  async apply(database: MigrationDatabase): Promise<void> {
    await requireSourceSchemaVersion(database);
    const sourceRowCount = await readRowCount(
      database,
      'habit_dependency_versions',
    );

    await database.execAsync(CREATE_REPLACEMENT_TABLE_SQL);
    await database.execAsync(COPY_ROWS_SQL);

    const replacementRowCount = await readRowCount(
      database,
      'habit_dependency_versions_v2',
    );
    if (replacementRowCount !== sourceRowCount) {
      throw new Error(
        `Migration 002 copied ${replacementRowCount} of ${sourceRowCount} dependency rows.`,
      );
    }

    await database.execAsync('DROP TABLE habit_dependency_versions;');
    await database.execAsync(
      'ALTER TABLE habit_dependency_versions_v2 RENAME TO habit_dependency_versions;',
    );

    for (const indexSql of DEPENDENCY_INDEXES_SQL) {
      await database.execAsync(indexSql);
    }

    await verifyForeignKeyIntegrity(database);
  },
});
