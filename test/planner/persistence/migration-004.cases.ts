import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_CORE_MIGRATION } from '../../../src/core/database/migrations/001-planner-core';
import { SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION } from '../../../src/core/database/migrations/002-scheduled-dependency-expiry';
import { PLANNER_LIFECYCLE_MIGRATION } from '../../../src/core/database/migrations/003-planner-lifecycle';
import { PLANNER_SUBHABITS_TIME_MIGRATION } from '../../../src/core/database/migrations/004-planner-subhabits-and-time';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

test('Migration 004 upgrades populated v3 with exact all-day seed and preserves v3 rows', async (t) => {
  const database = new NodeSqliteTestDatabase(); t.after(() => database.close());
  await prepareV2(database); await seedRoot(database); await apply(database, PLANNER_LIFECYCLE_MIGRATION);
  const before = await snapshotV3(database);
  await apply(database, PLANNER_SUBHABITS_TIME_MIGRATION);
  assert.equal((await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version, 4);
  assert.deepEqual(await snapshotV3(database), before);
  const time = await database.getFirstAsync<{ id: string; habit_id: string; version_number: number; effective_from: string; effective_to: string | null; planned_local_time: string | null; created_at: number; updated_at: number }>('SELECT * FROM habit_planned_time_versions WHERE habit_id=$id;', { $id: 'root' });
  assert.deepEqual(time === null ? null : { ...time }, { id: 'root', habit_id: 'root', version_number: 1, effective_from: '2026-08-01', effective_to: null, planned_local_time: null, created_at: 1000, updated_at: 1000 });
  assert.equal((await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_ordinary_parent_versions;'))?.count, 0);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('Migration 004 creates exact tables, restrictive foreign keys, checks, and named indexes', async (t) => {
  const database = new NodeSqliteTestDatabase(); t.after(() => database.close()); await runMigrations(database);
  const indexes = (await database.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type='index' ORDER BY name;`)).map((row) => row.name);
  for (const name of ['idx_habit_ordinary_parent_range','idx_habit_ordinary_child_range','uq_habit_ordinary_open_child','uq_habit_ordinary_open_pair','idx_habit_planned_time_range','uq_habit_planned_time_open','idx_habit_planned_time_order']) assert.ok(indexes.includes(name), name);
  const foreignKeys = await database.getAllAsync<{ table: string; on_update: string; on_delete: string }>(`SELECT "table",on_update,on_delete FROM pragma_foreign_key_list('habit_ordinary_parent_versions') ORDER BY id;`);
  assert.equal(foreignKeys.length, 2); assert.ok(foreignKeys.every((row) => row.table === 'habits' && row.on_update === 'RESTRICT' && row.on_delete === 'RESTRICT'));
  await assert.rejects(database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at) VALUES('bad','missing',1,'2026-08-01',NULL,'25:00',1,1);`));
});

test('Migration 004 rolls back completely on malformed v3 seed source', async (t) => {
  const database = new NodeSqliteTestDatabase(); t.after(() => database.close());
  await prepareV2(database); await seedRoot(database); await apply(database, PLANNER_LIFECYCLE_MIGRATION);
  await database.execAsync('PRAGMA ignore_check_constraints=ON;');
  await database.runAsync('UPDATE habits SET created_at=-1 WHERE id=\'root\';');
  await database.execAsync('PRAGMA ignore_check_constraints=OFF;');
  await assert.rejects(apply(database, PLANNER_SUBHABITS_TIME_MIGRATION));
  assert.equal((await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version, 3);
  assert.equal((await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('habit_planned_time_versions','habit_ordinary_parent_versions');`))?.count, 0);
});

test('Migration 004 full chain is reopen-idempotent', async (t) => {
  const database = new NodeSqliteTestDatabase(); t.after(() => database.close());
  await runMigrations(database); const before = await database.getAllAsync(`SELECT name,type,sql FROM sqlite_schema WHERE name LIKE 'habit_%' ORDER BY name;`);
  await runMigrations(database); const after = await database.getAllAsync(`SELECT name,type,sql FROM sqlite_schema WHERE name LIKE 'habit_%' ORDER BY name;`);
  assert.deepEqual(after, before); assert.equal((await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version, 15);
});

async function apply(database: NodeSqliteTestDatabase, migration: { apply(db: NodeSqliteTestDatabase): Promise<void>; setUserVersionSql: string }) {
  await database.withTransactionAsync(async () => { await migration.apply(database); await database.execAsync(migration.setUserVersionSql); });
}

async function prepareV2(database: NodeSqliteTestDatabase) { await apply(database, PLANNER_CORE_MIGRATION); await apply(database, SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION); }

async function seedRoot(database: NodeSqliteTestDatabase) {
  await database.execAsync(`
    INSERT INTO habits(id,name,description,category_id,active_from,active_to,sort_order,lifecycle,created_at,updated_at,archived_at) VALUES('root','Root',NULL,NULL,'2026-08-01',NULL,0,'active',1000,1000,NULL);
    INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at) VALUES('root-schedule','root',1,'daily','2026-08-01',NULL,'Europe/London',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1000,1000);
    INSERT INTO habit_tracking_versions(id,habit_id,version_number,tracking_mode,comparison_operator,unit_type,standard_unit_code,custom_unit_label,target_significand,target_scale,target_duration_seconds,effective_from,effective_to,created_at,updated_at) VALUES('root-tracking','root',1,'checkbox','boolean_success','none',NULL,NULL,NULL,NULL,NULL,'2026-08-01',NULL,1000,1000);
    INSERT INTO habit_importance_versions(id,habit_id,version_number,importance_level,weight,effective_from,effective_to,created_at,updated_at) VALUES('root-importance','root',1,'normal',2,'2026-08-01',NULL,1000,1000);
  `);
}

async function snapshotV3(database: NodeSqliteTestDatabase) {
  const tables = ['habits','habit_schedule_versions','habit_tracking_versions','habit_importance_versions','habit_dependency_versions','habit_observations','habit_lifecycle_transitions','habit_observation_schedule_contexts'];
  const snapshot: Record<string, unknown[]> = {};
  for (const table of tables) snapshot[table] = await database.getAllAsync(`SELECT * FROM ${table} ORDER BY rowid;`);
  return snapshot;
}
