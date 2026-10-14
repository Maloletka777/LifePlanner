import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { MigrationRunnerDatabase } from '../../../src/core/database/migration';
import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_CORE_MIGRATION } from '../../../src/core/database/migrations/001-planner-core';
import { SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION } from '../../../src/core/database/migrations/002-scheduled-dependency-expiry';
import { PLANNER_LIFECYCLE_MIGRATION } from '../../../src/core/database/migrations/003-planner-lifecycle';
import { PLANNER_SUBHABITS_TIME_MIGRATION } from '../../../src/core/database/migrations/004-planner-subhabits-and-time';
import { PLANNER_VISUAL_IDENTITY_MIGRATION } from '../../../src/core/database/migrations/005-planner-visual-identity';
import { PLANNER_ROUTINE_STEPS_MIGRATION } from '../../../src/core/database/migrations/006-planner-routine-steps';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const MIGRATIONS_TO_V5 = [
  PLANNER_CORE_MIGRATION,
  SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION,
  PLANNER_LIFECYCLE_MIGRATION,
  PLANNER_SUBHABITS_TIME_MIGRATION,
  PLANNER_VISUAL_IDENTITY_MIGRATION,
] as const;

test('Migration 006 advances an empty v5 database without fabricating relationship facts', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  for (const migration of MIGRATIONS_TO_V5) await apply(database, migration);

  await apply(database, PLANNER_ROUTINE_STEPS_MIGRATION);

  assert.equal(await userVersion(database), 6);
  assert.equal(
    (await database.getFirstAsync<{ count: number }>(
      'SELECT count(*) AS count FROM habit_ordinary_parent_versions;',
    ))?.count,
    0,
  );
  assert.equal(
    (await database.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM pragma_table_info('habit_ordinary_parent_versions') WHERE name='completion_role';`,
    ))?.count,
    1,
  );
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('Migration 006 maps every legacy ordinary relationship to organizational and preserves all facts', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await preparePopulatedV5(database);
  const before = await snapshotTablesExceptOrdinary(database);
  const ordinaryBefore = await readLegacyOrdinaryRows(database);

  await apply(database, PLANNER_ROUTINE_STEPS_MIGRATION);

  assert.equal(await userVersion(database), 6);
  assert.deepEqual(await snapshotTablesExceptOrdinary(database), before);
  assert.deepEqual(
    (await database.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM habit_ordinary_parent_versions ORDER BY effective_from,id;',
    )).map((row) => ({ ...row })),
    ordinaryBefore.map((row) => ({
      id: row.id,
      relationship_id: row.relationship_id,
      version_number: row.version_number,
      parent_habit_id: row.parent_habit_id,
      child_habit_id: row.child_habit_id,
      completion_role: 'organizational',
      effective_from: row.effective_from,
      effective_to: row.effective_to,
      end_reason: row.end_reason,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  );
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('Migration 006 creates the exact role constraint, restrictive keys, and unchanged named indexes', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await preparePopulatedV5(database);
  await runMigrations(database);

  const roleColumn = await database.getFirstAsync<{ type: string; not_null: number; dflt_value: unknown }>(
    `SELECT type,"notnull" AS not_null,dflt_value FROM pragma_table_info('habit_ordinary_parent_versions') WHERE name='completion_role';`,
  );
  assert.deepEqual(roleColumn === null ? null : { ...roleColumn }, { type: 'TEXT', not_null: 1, dflt_value: null });
  const foreignKeys = await database.getAllAsync<{ table: string; on_update: string; on_delete: string }>(
    `SELECT "table",on_update,on_delete FROM pragma_foreign_key_list('habit_ordinary_parent_versions') ORDER BY id;`,
  );
  assert.equal(foreignKeys.length, 2);
  assert.ok(foreignKeys.every((row) => row.table === 'habits' && row.on_update === 'RESTRICT' && row.on_delete === 'RESTRICT'));
  assert.deepEqual(
    (await database.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='habit_ordinary_parent_versions' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name;`,
    )).map(({ name }) => name),
    [
      'idx_habit_ordinary_child_range',
      'idx_habit_ordinary_parent_range',
      'uq_habit_ordinary_open_child',
      'uq_habit_ordinary_open_pair',
    ],
  );
  await assert.rejects(database.execAsync(
    `INSERT INTO habit_ordinary_parent_versions(id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,effective_from,effective_to,end_reason,created_at,updated_at)
     VALUES('bad-role','bad-role',1,'parent','free-child','derived','2026-08-01',NULL,NULL,1000,1000);`,
  ));
  await assert.rejects(database.execAsync(
    `INSERT INTO habit_ordinary_parent_versions(id,relationship_id,version_number,parent_habit_id,child_habit_id,effective_from,effective_to,end_reason,created_at,updated_at)
     VALUES('missing-role','missing-role',1,'parent','free-child','2026-08-01',NULL,NULL,1000,1000);`,
  ));
  await database.execAsync(
    `INSERT INTO habit_ordinary_parent_versions(id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,effective_from,effective_to,end_reason,created_at,updated_at)
     VALUES('routine-role','routine-role',1,'parent','free-child','routine_step','2026-08-01',NULL,NULL,1000,1000);`,
  );
  assert.equal(
    (await database.getFirstAsync<{ completion_role: string }>(
      `SELECT completion_role FROM habit_ordinary_parent_versions WHERE id='routine-role';`,
    ))?.completion_role,
    'routine_step',
  );
});

test('Migration 006 produces a stable v6 schema snapshot before later migrations', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await preparePopulatedV5(database);
  await apply(database, PLANNER_ROUTINE_STEPS_MIGRATION);
  const before = await database.getAllAsync('SELECT name,type,sql FROM sqlite_schema ORDER BY name;');
  assert.equal(await userVersion(database), 6);
  assert.deepEqual(await database.getAllAsync('SELECT name,type,sql FROM sqlite_schema ORDER BY name;'), before);
});

test('a file database reopens at v6 with routine roles and legacy facts unchanged', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lifeplanner-v6-'));
  const filename = join(directory, 'planner.sqlite');
  let database = new NodeSqliteTestDatabase(filename);
  try {
    await preparePopulatedV5(database);
    await apply(database, PLANNER_ROUTINE_STEPS_MIGRATION);
    await database.execAsync(
      `INSERT INTO habit_ordinary_parent_versions(id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,effective_from,effective_to,end_reason,created_at,updated_at)
       VALUES('reopen-routine','reopen-routine',1,'parent','free-child','routine_step','2026-08-01',NULL,NULL,1500,1500);`,
    );
    const before = await snapshotAllTables(database);
    database.close();
    database = new NodeSqliteTestDatabase(filename);
    assert.equal(await userVersion(database), 6);
    assert.deepEqual(await snapshotAllTables(database), before);
    assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Migration 006 rolls back DDL, copy, swap, verification, version, and commit failures to exact v5', async () => {
  const boundaries = ['ddl', 'copy', 'swap', 'verification', 'version', 'commit'] as const;
  for (const boundary of boundaries) {
    const database = new NodeSqliteTestDatabase();
    try {
      await preparePopulatedV5(database);
      const before = await snapshotAllTables(database);
      await assert.rejects(runMigrations(faultingDatabase(database, boundary)));
      assert.equal(await userVersion(database), 5, boundary);
      assert.deepEqual(await snapshotAllTables(database), before, boundary);
      assert.equal(
        (await database.getFirstAsync<{ count: number }>(
          `SELECT count(*) AS count FROM sqlite_schema WHERE name='habit_ordinary_parent_versions_v6';`,
        ))?.count,
        0,
        boundary,
      );
      assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), [], boundary);
    } finally {
      database.close();
    }
  }
});

async function preparePopulatedV5(database: NodeSqliteTestDatabase): Promise<void> {
  for (const migration of MIGRATIONS_TO_V5.slice(0, 4)) await apply(database, migration);
  for (const [index, id] of ['parent', 'child', 'free-child'].entries()) {
    await database.execAsync(String.raw`
      INSERT INTO habits(id,name,description,category_id,active_from,active_to,sort_order,lifecycle,created_at,updated_at,archived_at)
        VALUES('${id}','${id}',NULL,NULL,'2026-08-01',NULL,${index},'active',1000,1000,NULL);
      INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at)
        VALUES('${id}-schedule','${id}',1,'daily','2026-08-01',NULL,'Europe/London',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1000,1000);
      INSERT INTO habit_tracking_versions(id,habit_id,version_number,tracking_mode,comparison_operator,unit_type,standard_unit_code,custom_unit_label,target_significand,target_scale,target_duration_seconds,effective_from,effective_to,created_at,updated_at)
        VALUES('${id}-tracking','${id}',1,'${id === 'parent' ? 'quantity' : 'checkbox'}','${id === 'parent' ? 'at_least' : 'boolean_success'}','${id === 'parent' ? 'standard' : 'none'}',${id === 'parent' ? "'litre'" : 'NULL'},NULL,${id === 'parent' ? '200' : 'NULL'},${id === 'parent' ? '2' : 'NULL'},NULL,'2026-08-01',NULL,1000,1000);
      INSERT INTO habit_importance_versions(id,habit_id,version_number,importance_level,weight,effective_from,effective_to,created_at,updated_at)
        VALUES('${id}-importance','${id}',1,'normal',2,'2026-08-01',NULL,1000,1000);
      INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at)
        VALUES('${id}-lifecycle','${id}',1,'active','2026-08-01','Europe/London',1000,1000);
      INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at)
        VALUES('${id}-time','${id}',1,'2026-08-01',NULL,NULL,1000,1000);
    `);
  }
  await database.execAsync(String.raw`
    INSERT INTO habit_ordinary_parent_versions(id,relationship_id,version_number,parent_habit_id,child_habit_id,effective_from,effective_to,end_reason,created_at,updated_at)
      VALUES('ordinary-old','ordinary-old',1,'parent','child','2026-08-01','2026-08-10','detached',1000,1100),
            ('ordinary-current','ordinary-current',1,'parent','child','2026-08-10',NULL,NULL,1200,1200);
    INSERT INTO habit_dependency_versions(id,relationship_id,version_number,parent_habit_id,dependent_habit_id,dependency_type,occurrence_mode,effective_from,effective_to,end_reason,created_at,updated_at)
      VALUES('conditional-current','conditional-current',1,'parent','free-child','follow_up','inherited_parent','2026-08-01',NULL,NULL,1250,1250);
    INSERT INTO habit_observations(id,habit_id,context_mode,schedule_version_id,detached_schedule_context_id,tracking_version_id,importance_version_id,dependency_version_id,occurrence_local_date,occurrence_local_time,occurrence_timezone,observation_type,boolean_value,counter_delta,quantity_significand,quantity_scale,duration_seconds,note,supersedes_observation_id,correction_reason,observed_at,created_at)
      VALUES('parent-observation','parent','live_independent','parent-schedule',NULL,'parent-tracking','parent-importance',NULL,'2026-08-02',NULL,'Europe/London','quantity',NULL,NULL,100,2,NULL,'legacy',NULL,NULL,1300,1300),
            ('parent-correction','parent','live_independent','parent-schedule',NULL,'parent-tracking','parent-importance',NULL,'2026-08-02',NULL,'Europe/London','quantity',NULL,NULL,150,2,NULL,'corrected','parent-observation','correct_value',1400,1400);
  `);
  await apply(database, PLANNER_VISUAL_IDENTITY_MIGRATION);
  assert.equal(await userVersion(database), 5);
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

async function readLegacyOrdinaryRows(database: NodeSqliteTestDatabase): Promise<Record<string, unknown>[]> {
  return database.getAllAsync<Record<string, unknown>>(
    `SELECT id,relationship_id,version_number,parent_habit_id,child_habit_id,effective_from,effective_to,end_reason,created_at,updated_at
     FROM habit_ordinary_parent_versions ORDER BY effective_from,id;`,
  );
}

async function snapshotTablesExceptOrdinary(database: NodeSqliteTestDatabase): Promise<Record<string, unknown[]>> {
  return snapshotTables(database, true);
}

async function snapshotAllTables(database: NodeSqliteTestDatabase): Promise<Record<string, unknown[]>> {
  return snapshotTables(database, false);
}

async function snapshotTables(database: NodeSqliteTestDatabase, excludeOrdinary: boolean): Promise<Record<string, unknown[]>> {
  const rows = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'
     ${excludeOrdinary ? "AND name<>'habit_ordinary_parent_versions'" : ''} ORDER BY name;`,
  );
  const snapshot: Record<string, unknown[]> = {};
  for (const { name } of rows) snapshot[name] = await database.getAllAsync(`SELECT * FROM "${name}" ORDER BY rowid;`);
  return snapshot;
}

async function userVersion(database: NodeSqliteTestDatabase): Promise<number | undefined> {
  return (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version;
}

function faultingDatabase(
  database: NodeSqliteTestDatabase,
  boundary: 'ddl' | 'copy' | 'swap' | 'verification' | 'version' | 'commit',
): MigrationRunnerDatabase {
  return {
    async execAsync(source) {
      // The runner issues its own COMMIT, so that is where this lands now.
      if (boundary === 'commit' && source.includes('COMMIT')) throw new Error('forced commit failure');
      if (boundary === 'ddl' && source.includes('CREATE TABLE habit_ordinary_parent_versions_v6')) throw new Error('forced DDL failure');
      if (boundary === 'copy' && source.includes('INSERT INTO habit_ordinary_parent_versions_v6')) throw new Error('forced copy failure');
      if (boundary === 'swap' && source.includes('DROP TABLE habit_ordinary_parent_versions')) throw new Error('forced swap failure');
      if (boundary === 'version' && source.includes('PRAGMA user_version = 6')) throw new Error('forced version failure');
      await database.execAsync(source);
    },
    async getFirstAsync<T>(source: string) {
      if (boundary === 'verification' && source.includes("pragma_table_info('habit_ordinary_parent_versions') WHERE name='completion_role'")) throw new Error('forced verification failure');
      return database.getFirstAsync<T>(source);
    },
    getAllAsync: <T>(source: string) => database.getAllAsync<T>(source),
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
