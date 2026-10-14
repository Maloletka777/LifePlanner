import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import type { MigrationRunnerDatabase } from '../../../src/core/database/migration';
import { PLANNER_CORE_MIGRATION } from '../../../src/core/database/migrations/001-planner-core';
import { SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION } from '../../../src/core/database/migrations/002-scheduled-dependency-expiry';
import { PLANNER_LIFECYCLE_MIGRATION } from '../../../src/core/database/migrations/003-planner-lifecycle';
import { PLANNER_SUBHABITS_TIME_MIGRATION } from '../../../src/core/database/migrations/004-planner-subhabits-and-time';
import { PLANNER_VISUAL_IDENTITY_MIGRATION } from '../../../src/core/database/migrations/005-planner-visual-identity';
import {
  HABIT_ACCENT_KEYS,
  HABIT_ICON_KEYS,
  habitAccentKeyForId,
} from '../../../src/features/planner/domain';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

test('Migration 005 upgrades populated v4 with deterministic identities and preserves every v4 row', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await prepareV4(database);
  await seedV4Habits(database);
  const before = await snapshotV4(database);

  await apply(database, PLANNER_VISUAL_IDENTITY_MIGRATION);

  assert.equal(await userVersion(database), 5);
  assert.deepEqual(await snapshotV4(database), before);
  assert.deepEqual(
    (await database.getAllAsync<Record<string, unknown>>('SELECT * FROM habit_visual_identities ORDER BY habit_id;')).map((row) => ({ ...row })),
    [
      {
        id: 'habit-a', habit_id: 'habit-a', icon_key: 'quantity',
        accent_key: habitAccentKeyForId('habit-a'), created_at: 1000, updated_at: 1000,
      },
      {
        id: 'habit-b', habit_id: 'habit-b', icon_key: 'avoidance',
        accent_key: habitAccentKeyForId('habit-b'), created_at: 2000, updated_at: 2000,
      },
    ],
  );
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('Migration 005 creates the exact restrictive table and registry-valid empty path', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await prepareV4(database);
  await apply(database, PLANNER_VISUAL_IDENTITY_MIGRATION);

  assert.equal(await userVersion(database), 5);
  assert.equal(
    (await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_visual_identities;'))?.count,
    0,
  );
  const foreignKeys = await database.getAllAsync<{ table: string; on_update: string; on_delete: string }>(
    `SELECT "table",on_update,on_delete FROM pragma_foreign_key_list('habit_visual_identities');`,
  );
  assert.deepEqual(foreignKeys.map((row) => ({ ...row })), [{ table: 'habits', on_update: 'RESTRICT', on_delete: 'RESTRICT' }]);
  assert.equal(HABIT_ICON_KEYS.length >= 14, true);
  assert.deepEqual(HABIT_ACCENT_KEYS, ['coral','rose','peach','amber','mint','teal','sky','blue','lavender','violet']);
  await assert.rejects(database.execAsync(
    `INSERT INTO habit_visual_identities(id,habit_id,icon_key,accent_key,created_at,updated_at)
     VALUES('bad','missing','','coral',0,0);`,
  ));
});

test('Migration 005 rolls back the DDL and seed when the latest tracking source is malformed', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await prepareV4(database);
  await seedV4Habits(database);
  const before = await snapshotV4(database);
  await database.execAsync('PRAGMA ignore_check_constraints=ON;');
  await database.runAsync(
    `UPDATE habit_tracking_versions SET tracking_mode='unsupported' WHERE id='habit-a-tracking-2';`,
  );
  await database.execAsync('PRAGMA ignore_check_constraints=OFF;');
  const malformed = await snapshotV4(database);

  await assert.rejects(apply(database, PLANNER_VISUAL_IDENTITY_MIGRATION));

  assert.equal(await userVersion(database), 4);
  assert.equal(
    (await database.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM sqlite_schema WHERE name='habit_visual_identities';`,
    ))?.count,
    0,
  );
  assert.notDeepEqual(malformed, before);
  assert.deepEqual(await snapshotV4(database), malformed);
});

test('the complete chain through Migration 008 reopens idempotently', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  const before = await database.getAllAsync(
    `SELECT name,type,sql FROM sqlite_schema WHERE name LIKE 'habit_%' ORDER BY name;`,
  );
  await runMigrations(database);
  assert.equal(await userVersion(database), 15);
  assert.deepEqual(
    await database.getAllAsync(`SELECT name,type,sql FROM sqlite_schema WHERE name LIKE 'habit_%' ORDER BY name;`),
    before,
  );
});

test('Migration 005 rolls back DDL, seed, verification, version-recording, and commit failures to exact v4 rows', async () => {
  const boundaries = ['ddl', 'seed', 'verification', 'version', 'commit'] as const;
  for (const boundary of boundaries) {
    const database = new NodeSqliteTestDatabase();
    try {
      await prepareV4(database);
      await seedV4Habits(database);
      const before = await snapshotV4(database);
      const faulting = faultingDatabase(database, boundary);
      await assert.rejects(runMigrations(faulting));
      assert.equal(await userVersion(database), 4, boundary);
      assert.deepEqual(await snapshotV4(database), before, boundary);
      assert.equal(
        (await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM sqlite_schema WHERE name='habit_visual_identities';`))?.count,
        0,
        boundary,
      );
      assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), [], boundary);
    } finally {
      database.close();
    }
  }
});

async function prepareV4(database: NodeSqliteTestDatabase): Promise<void> {
  for (const migration of [
    PLANNER_CORE_MIGRATION,
    SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION,
    PLANNER_LIFECYCLE_MIGRATION,
    PLANNER_SUBHABITS_TIME_MIGRATION,
  ]) {
    await apply(database, migration);
  }
}

async function seedV4Habits(database: NodeSqliteTestDatabase): Promise<void> {
  await database.execAsync(String.raw`
    INSERT INTO habits(id,name,description,category_id,active_from,active_to,sort_order,lifecycle,created_at,updated_at,archived_at)
      VALUES('habit-a','A',NULL,NULL,'2026-08-01',NULL,0,'active',1000,1000,NULL),
            ('habit-b','B',NULL,NULL,'2026-08-01',NULL,1,'active',2000,2000,NULL);
    INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at)
      VALUES('habit-a-schedule','habit-a',1,'daily','2026-08-01',NULL,'Europe/London',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1000,1000),
            ('habit-b-schedule','habit-b',1,'daily','2026-08-01',NULL,'Europe/London',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,2000,2000);
    INSERT INTO habit_tracking_versions(id,habit_id,version_number,tracking_mode,comparison_operator,unit_type,standard_unit_code,custom_unit_label,target_significand,target_scale,target_duration_seconds,effective_from,effective_to,created_at,updated_at)
      VALUES('habit-a-tracking-1','habit-a',1,'checkbox','boolean_success','none',NULL,NULL,NULL,NULL,NULL,'2026-08-01','2026-08-02',1000,1000),
            ('habit-a-tracking-2','habit-a',2,'quantity','at_least','standard','litre',NULL,100,2,NULL,'2026-08-02',NULL,1100,1100),
            ('habit-b-tracking','habit-b',1,'avoidance','boolean_success','none',NULL,NULL,NULL,NULL,NULL,'2026-08-01',NULL,2000,2000);
    INSERT INTO habit_importance_versions(id,habit_id,version_number,importance_level,weight,effective_from,effective_to,created_at,updated_at)
      VALUES('habit-a-importance','habit-a',1,'normal',2,'2026-08-01',NULL,1000,1000),
            ('habit-b-importance','habit-b',1,'high',3,'2026-08-01',NULL,2000,2000);
    INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at)
      VALUES('habit-a','habit-a',1,'active','2026-08-01','Europe/London',1000,1000),
            ('habit-b','habit-b',1,'active','2026-08-01','Europe/London',2000,2000);
    INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at)
      VALUES('habit-a','habit-a',1,'2026-08-01',NULL,NULL,1000,1000),
            ('habit-b','habit-b',1,'2026-08-01',NULL,NULL,2000,2000);
  `);
}

async function snapshotV4(database: NodeSqliteTestDatabase): Promise<Record<string, unknown[]>> {
  const rows = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'habit_visual_identities' ORDER BY name;`,
  );
  const snapshot: Record<string, unknown[]> = {};
  for (const { name } of rows) snapshot[name] = await database.getAllAsync(`SELECT * FROM "${name}" ORDER BY rowid;`);
  return snapshot;
}

async function apply(
  database: NodeSqliteTestDatabase,
  migration: { apply(database: NodeSqliteTestDatabase): Promise<void>; setUserVersionSql: string },
): Promise<void> {
  await database.withTransactionAsync(async () => {
    await migration.apply(database);
    await database.execAsync(migration.setUserVersionSql);
  });
}

async function userVersion(database: NodeSqliteTestDatabase): Promise<number | undefined> {
  return (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version;
}

function faultingDatabase(
  database: NodeSqliteTestDatabase,
  boundary: 'ddl' | 'seed' | 'verification' | 'version' | 'commit',
): MigrationRunnerDatabase {
  let insertedVisualRows = 0;
  return {
    async execAsync(source) {
      // The runner issues its own COMMIT, so that is where this lands now.
      if (boundary === 'commit' && source.includes('COMMIT')) throw new Error('forced commit failure');
      if (boundary === 'ddl' && source.includes('CREATE TABLE habit_visual_identities')) throw new Error('forced DDL failure');
      if (boundary === 'version' && source.includes('PRAGMA user_version = 5')) throw new Error('forced version failure');
      if (boundary === 'seed' && source.includes('INSERT INTO habit_visual_identities')) {
        insertedVisualRows += 1;
        if (insertedVisualRows === 2) throw new Error('forced seed failure');
      }
      await database.execAsync(source);
    },
    async getFirstAsync<T>(source: string) {
      if (boundary === 'verification' && source.includes('SELECT count(*) AS value FROM habit_visual_identities')) throw new Error('forced verification failure');
      return database.getFirstAsync<T>(source);
    },
    async getAllAsync<T>(source: string) {
      return database.getAllAsync<T>(source);
    },
    async withTransactionAsync<T>(task: () => Promise<T>): Promise<T> {
      await database.execAsync('BEGIN IMMEDIATE;');
      try {
        const result = await task();
        await database.execAsync('COMMIT;');
        return result;
      } catch (cause: unknown) {
        await database.execAsync('ROLLBACK;');
        throw cause;
      }
    },
  };
}
