import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DATABASE_ERROR_CODES,
  DatabaseError,
} from '../../../src/core/database/database-error';
import {
  LATEST_DATABASE_VERSION,
  runMigrations,
} from '../../../src/core/database/migration-runner';
import type { MigrationRunnerDatabase } from '../../../src/core/database/migration';
import { PLANNER_CORE_MIGRATION } from '../../../src/core/database/migrations/001-planner-core';
import { SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION } from '../../../src/core/database/migrations/002-scheduled-dependency-expiry';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const DEPENDENCY_INDEX_NAMES = [
  'idx_habit_dependency_dependent_range',
  'idx_habit_dependency_logical_range',
  'idx_habit_dependency_parent_range',
  'uq_habit_dependency_open_incoming',
  'uq_habit_dependency_open_pair',
  'uq_habit_dependency_open_relationship',
] as const;

type DependencyEndReason =
  | 'scheduled_end'
  | 'replaced'
  | 'unlinked'
  | 'parent_archived'
  | 'dependent_archived';

type DependencyRow = Readonly<{
  id: string;
  relationship_id: string;
  version_number: number;
  parent_habit_id: string;
  dependent_habit_id: string;
  dependency_type: string;
  occurrence_mode: string;
  effective_from: string;
  effective_to: string | null;
  end_reason: string | null;
  created_at: number;
  updated_at: number;
}>;

type SqliteMetadataRow = Readonly<Record<string, string | number | null>>;

test('a fresh version-0 database applies the complete ordered migration chain', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());

  await runMigrations(database);

  assert.equal(LATEST_DATABASE_VERSION, 15);
  assert.equal(await readUserVersion(database), 15);
  assert.equal(await readForeignKeys(database), 1);
});

test('Migration 002 preserves open and every legacy finite dependency row', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await applyMigration001Only(database);
  await seedLegacyDependencyRows(database);
  const before = await readDependencyRows(database);

  await applyMigration002Only(database);

  assert.equal(await readUserVersion(database), 2);
  assert.deepEqual(await readDependencyRows(database), before);
});

test('a database already at the latest version skips all migrations idempotently', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  let execCount = 0;
  const observingDatabase: MigrationRunnerDatabase = {
    async execAsync(source) {
      execCount += 1;
      await database.execAsync(source);
    },
    getFirstAsync: <T>(source: string) => database.getFirstAsync<T>(source),
    getAllAsync: <T>(source: string) => database.getAllAsync<T>(source),
    withTransactionAsync: (task) => database.withTransactionAsync(task),
  };

  await runMigrations(observingDatabase);

  assert.equal(execCount, 0);
  assert.equal(await readUserVersion(database), 15);
});

test('a schema newer than the latest version remains a typed blocking error', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  // Derived, not written down: a literal here silently stops testing anything the
  // moment the chain grows past it — which is exactly what 14 did when Migration 014
  // arrived and turned «newer than supported» into an ordinary intermediate version.
  await database.execAsync(`PRAGMA user_version = ${LATEST_DATABASE_VERSION + 1};`);

  await assert.rejects(
    runMigrations(database),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseError);
      assert.equal(
        error.code,
        DATABASE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      );
      return true;
    },
  );
});

test('post-Migration-002 dependency end-reason constraints are exact', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabits(database, 8);

  await insertDependency(database, {
    id: 'dependency-scheduled',
    relationshipId: 'relationship-scheduled',
    parentHabitId: 'habit-0',
    dependentHabitId: 'habit-1',
    effectiveTo: '2026-09-01',
    endReason: 'scheduled_end',
  });
  assert.equal((await readDependencyRows(database))[0]?.end_reason, 'scheduled_end');

  await assert.rejects(
    insertDependency(database, {
      id: 'dependency-open-scheduled',
      relationshipId: 'relationship-open-scheduled',
      parentHabitId: 'habit-2',
      dependentHabitId: 'habit-3',
      effectiveTo: null,
      endReason: 'scheduled_end',
    }),
  );
  await assert.rejects(
    insertDependency(database, {
      id: 'dependency-finite-null',
      relationshipId: 'relationship-finite-null',
      parentHabitId: 'habit-4',
      dependentHabitId: 'habit-5',
      effectiveTo: '2026-09-01',
      endReason: null,
    }),
  );
  await assert.rejects(
    insertDependency(database, {
      id: 'dependency-unknown',
      relationshipId: 'relationship-unknown',
      parentHabitId: 'habit-6',
      dependentHabitId: 'habit-7',
      effectiveTo: '2026-09-01',
      endReason: 'expired',
    }),
  );
});

test('Migration 002 preserves columns, foreign keys, and all six indexes', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await applyMigration001Only(database);

  const columnsBefore = await database.getAllAsync<SqliteMetadataRow>(
    'PRAGMA table_info(habit_dependency_versions);',
  );
  const dependencyForeignKeysBefore =
    await database.getAllAsync<SqliteMetadataRow>(
      'PRAGMA foreign_key_list(habit_dependency_versions);',
    );
  const observationForeignKeysBefore =
    await database.getAllAsync<SqliteMetadataRow>(
      'PRAGMA foreign_key_list(habit_observations);',
    );

  await applyMigration002Only(database);

  assert.deepEqual(
    await database.getAllAsync<SqliteMetadataRow>(
      'PRAGMA table_info(habit_dependency_versions);',
    ),
    columnsBefore,
  );
  assert.deepEqual(
    await database.getAllAsync<SqliteMetadataRow>(
      'PRAGMA foreign_key_list(habit_dependency_versions);',
    ),
    dependencyForeignKeysBefore,
  );
  assert.deepEqual(
    await database.getAllAsync<SqliteMetadataRow>(
      'PRAGMA foreign_key_list(habit_observations);',
    ),
    observationForeignKeysBefore,
  );
  assert.deepEqual(await readDependencyIndexNames(database), DEPENDENCY_INDEX_NAMES);
  assert.deepEqual(
    await database.getAllAsync<SqliteMetadataRow>(
      'PRAGMA foreign_key_check;',
    ),
    [],
  );
  assert.equal(await readForeignKeys(database), 1);

  await assert.rejects(
    insertDependency(database, {
      id: 'dependency-missing-habits',
      relationshipId: 'relationship-missing-habits',
      parentHabitId: 'missing-parent',
      dependentHabitId: 'missing-dependent',
      effectiveTo: null,
      endReason: null,
    }),
  );
});

test('an index-recreation failure rolls back to usable version 1 and can retry', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await applyMigration001Only(database);
  await seedLegacyDependencyRows(database);
  const before = await readDependencyRows(database);
  const failingDatabase = failOnceWhenSqlContains(
    database,
    'CREATE INDEX idx_habit_dependency_logical_range',
  );

  await assert.rejects(
    runMigrations(failingDatabase),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseError);
      assert.equal(error.code, DATABASE_ERROR_CODES.MIGRATION);
      return true;
    },
  );

  assert.equal(await readUserVersion(database), 1);
  assert.equal(await readForeignKeys(database), 1);
  assert.deepEqual(await readDependencyRows(database), before);
  assert.deepEqual(await readDependencyIndexNames(database), DEPENDENCY_INDEX_NAMES);
  assert.equal(
    await database.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'habit_dependency_versions_v2';`,
    ),
    null,
  );

  await applyMigration002Only(database);
  assert.equal(await readUserVersion(database), 2);
  assert.deepEqual(await readDependencyRows(database), before);
});

async function applyMigration001Only(
  database: NodeSqliteTestDatabase,
): Promise<void> {
  await database.withTransactionAsync(async () => {
    await PLANNER_CORE_MIGRATION.apply(database);
    await database.execAsync(PLANNER_CORE_MIGRATION.setUserVersionSql);
  });
  assert.equal(await readUserVersion(database), 1);
}

async function applyMigration002Only(database: MigrationRunnerDatabase): Promise<void> {
  await database.withTransactionAsync(async () => {
    await SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION.apply(database);
    await database.execAsync(SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION.setUserVersionSql);
  });
}

async function seedLegacyDependencyRows(
  database: NodeSqliteTestDatabase,
): Promise<void> {
  const legacyReasons = [
    null,
    'replaced',
    'unlinked',
    'parent_archived',
    'dependent_archived',
  ] as const;
  await seedHabits(database, legacyReasons.length * 2);

  for (const [index, endReason] of legacyReasons.entries()) {
    await insertDependency(database, {
      id: `dependency-${index}`,
      relationshipId: `relationship-${index}`,
      parentHabitId: `habit-${index * 2}`,
      dependentHabitId: `habit-${index * 2 + 1}`,
      effectiveTo: endReason === null ? null : '2026-09-01',
      endReason,
    });
  }
}

async function seedHabits(
  database: NodeSqliteTestDatabase,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await database.runAsync(
      `INSERT INTO habits (
        id, name, description, category_id, active_from, active_to,
        sort_order, lifecycle, created_at, updated_at, archived_at
      ) VALUES (
        $id, $name, NULL, NULL, '2026-08-01', NULL,
        0, 'active', 1000, 1000, NULL
      );`,
      { $id: `habit-${index}`, $name: `Habit ${index}` },
    );
  }
}

async function insertDependency(
  database: NodeSqliteTestDatabase,
  value: Readonly<{
    id: string;
    relationshipId: string;
    parentHabitId: string;
    dependentHabitId: string;
    effectiveTo: string | null;
    endReason: DependencyEndReason | 'expired' | null;
  }>,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO habit_dependency_versions (
      id, relationship_id, version_number, parent_habit_id,
      dependent_habit_id, dependency_type, occurrence_mode,
      effective_from, effective_to, end_reason, created_at, updated_at
    ) VALUES (
      $id, $relationshipId, 1, $parentHabitId,
      $dependentHabitId, 'follow_up', 'inherited_parent',
      '2026-08-01', $effectiveTo, $endReason, 1000, 1000
    );`,
    {
      $id: value.id,
      $relationshipId: value.relationshipId,
      $parentHabitId: value.parentHabitId,
      $dependentHabitId: value.dependentHabitId,
      $effectiveTo: value.effectiveTo,
      $endReason: value.endReason,
    },
  );
}

async function readDependencyRows(
  database: NodeSqliteTestDatabase,
): Promise<DependencyRow[]> {
  return database.getAllAsync<DependencyRow>(
    'SELECT * FROM habit_dependency_versions ORDER BY id;',
  );
}

async function readDependencyIndexNames(
  database: NodeSqliteTestDatabase,
): Promise<string[]> {
  const rows = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'index'
       AND tbl_name = 'habit_dependency_versions'
       AND name NOT LIKE 'sqlite_autoindex_%'
     ORDER BY name;`,
  );
  return rows.map(({ name }) => name);
}

async function readUserVersion(
  database: NodeSqliteTestDatabase,
): Promise<number | undefined> {
  const row = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version;',
  );
  return row?.user_version;
}

async function readForeignKeys(
  database: NodeSqliteTestDatabase,
): Promise<number | undefined> {
  const row = await database.getFirstAsync<{ foreign_keys: number }>(
    'PRAGMA foreign_keys;',
  );
  return row?.foreign_keys;
}

function failOnceWhenSqlContains(
  database: NodeSqliteTestDatabase,
  fragment: string,
): MigrationRunnerDatabase {
  let shouldFail = true;

  return {
    async execAsync(source) {
      if (shouldFail && source.includes(fragment)) {
        shouldFail = false;
        throw new Error('Forced migration failure.');
      }
      await database.execAsync(source);
    },
    getFirstAsync: <T>(source: string) => database.getFirstAsync<T>(source),
    getAllAsync: <T>(source: string) => database.getAllAsync<T>(source),
    withTransactionAsync: (task) => database.withTransactionAsync(task),
  };
}
