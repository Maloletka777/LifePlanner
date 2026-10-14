import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_CORE_MIGRATION } from '../../../src/core/database/migrations/001-planner-core';
import { SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION } from '../../../src/core/database/migrations/002-scheduled-dependency-expiry';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const LEGACY_OBSERVATION_COLUMNS = `id,habit_id,schedule_version_id,tracking_version_id,
  importance_version_id,dependency_version_id,occurrence_local_date,occurrence_local_time,
  occurrence_timezone,observation_type,boolean_value,counter_delta,quantity_significand,
  quantity_scale,duration_seconds,note,supersedes_observation_id,correction_reason,observed_at,created_at`;

test('Migration 003 upgrades populated v2 data without changing observation facts', async (t) => {
  const database = new NodeSqliteTestDatabase(); t.after(() => database.close());
  await prepareV2(database); await seedRoot(database, 'active-habit', 'active', null);
  await database.execAsync(`
    INSERT INTO habit_observations(id,habit_id,schedule_version_id,tracking_version_id,importance_version_id,dependency_version_id,occurrence_local_date,occurrence_local_time,occurrence_timezone,observation_type,boolean_value,counter_delta,quantity_significand,quantity_scale,duration_seconds,note,supersedes_observation_id,correction_reason,observed_at,created_at)
      VALUES('observation-1','active-habit','active-habit-schedule','active-habit-tracking','active-habit-importance',NULL,'2026-08-01','09:30','Europe/London','checkbox',1,NULL,NULL,NULL,NULL,'kept',NULL,NULL,1100,1100);
    INSERT INTO habit_observations(id,habit_id,schedule_version_id,tracking_version_id,importance_version_id,dependency_version_id,occurrence_local_date,occurrence_local_time,occurrence_timezone,observation_type,boolean_value,counter_delta,quantity_significand,quantity_scale,duration_seconds,note,supersedes_observation_id,correction_reason,observed_at,created_at)
      VALUES('observation-2','active-habit','active-habit-schedule','active-habit-tracking','active-habit-importance',NULL,'2026-08-01','09:30','Europe/London','checkbox',0,NULL,NULL,NULL,NULL,'corrected','observation-1','correct_value',1200,1200);
  `);
  const before = await database.getAllAsync(`SELECT ${LEGACY_OBSERVATION_COLUMNS} FROM habit_observations ORDER BY id;`);

  await runMigrations(database);

  assert.equal((await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version, 15);
  assert.deepEqual(await database.getAllAsync(`SELECT ${LEGACY_OBSERVATION_COLUMNS} FROM habit_observations ORDER BY id;`), before);
  assert.deepEqual((await database.getAllAsync<{ context_mode: string; detached_schedule_context_id: string | null }>('SELECT context_mode,detached_schedule_context_id FROM habit_observations ORDER BY id;')).map((row) => ({ ...row })), [
    { context_mode: 'live_independent', detached_schedule_context_id: null },
    { context_mode: 'live_independent', detached_schedule_context_id: null },
  ]);
  const seed = await database.getFirstAsync<{ id:string; sequence_number:number; lifecycle:string; effective_local_date:string; boundary_timezone:string; transitioned_at:number; created_at:number }>('SELECT id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at FROM habit_lifecycle_transitions WHERE habit_id=$id;', { $id:'active-habit' });
  assert.deepEqual(seed === null ? null : { ...seed }, { id:'active-habit',sequence_number:1,lifecycle:'active',effective_local_date:'2026-08-01',boundary_timezone:'Europe/London',transitioned_at:1000,created_at:1000 });
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('Migration 003 creates exact mode constraints, uniqueness, and indexes', async (t) => {
  const database = new NodeSqliteTestDatabase(); t.after(() => database.close());
  await prepareV2(database); await seedRoot(database, 'root', 'active', null); await runMigrations(database);
  const names = (await database.getAllAsync<{ name:string }>(`SELECT name FROM sqlite_schema WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name;`)).map(({name}) => name);
  for (const name of ['idx_habit_lifecycle_effective','idx_habits_lifecycle_sort','idx_habit_observation_contexts_habit','uq_habit_observations_detached_context','idx_habit_observations_habit_date','idx_habit_dependency_parent_range']) assert.ok(names.includes(name), name);
  await assert.rejects(database.execAsync(`INSERT INTO habit_observations(id,habit_id,context_mode,schedule_version_id,tracking_version_id,importance_version_id,dependency_version_id,detached_schedule_context_id,occurrence_local_date,occurrence_timezone,observation_type,boolean_value,observed_at,created_at) VALUES('bad','root','live_dependent','root-schedule','root-tracking','root-importance',NULL,NULL,'2026-08-01','Europe/London','checkbox',1,1,1);`));
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('Migration 003 failure leaves malformed v2 data and version untouched', async (t) => {
  const database = new NodeSqliteTestDatabase(); t.after(() => database.close());
  await prepareV2(database); await seedRoot(database, 'broken', 'active', null);
  await database.execAsync('PRAGMA ignore_check_constraints=ON;');
  await database.runAsync(`UPDATE habits SET lifecycle='archived',archived_at=NULL WHERE id='broken';`);
  await database.execAsync('PRAGMA ignore_check_constraints=OFF;');
  await assert.rejects(runMigrations(database));
  assert.equal((await database.getFirstAsync<{ user_version:number }>('PRAGMA user_version;'))?.user_version, 2);
  assert.equal((await database.getFirstAsync<{ count:number }>(`SELECT count(*) AS count FROM sqlite_schema WHERE name='habit_lifecycle_transitions';`))?.count, 0);
  assert.equal((await database.getFirstAsync<{ lifecycle:string }>(`SELECT lifecycle FROM habits WHERE id='broken';`))?.lifecycle, 'archived');
});

async function prepareV2(database:NodeSqliteTestDatabase) {
  await database.withTransactionAsync(async () => { await PLANNER_CORE_MIGRATION.apply(database); await database.execAsync(PLANNER_CORE_MIGRATION.setUserVersionSql); });
  await database.withTransactionAsync(async () => { await SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION.apply(database); await database.execAsync(SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION.setUserVersionSql); });
}

async function seedRoot(database:NodeSqliteTestDatabase,id:string,lifecycle:'active'|'archived',archivedAt:number|null) {
  await database.execAsync(`
    INSERT INTO habits(id,name,description,category_id,active_from,active_to,sort_order,lifecycle,created_at,updated_at,archived_at) VALUES('${id}','Root',NULL,NULL,'2026-08-01',NULL,0,'${lifecycle}',1000,${archivedAt ?? 1000},${archivedAt ?? 'NULL'});
    INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at) VALUES('${id}-schedule','${id}',1,'daily','2026-08-01',NULL,'Europe/London',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1000,1000);
    INSERT INTO habit_tracking_versions(id,habit_id,version_number,tracking_mode,comparison_operator,unit_type,standard_unit_code,custom_unit_label,target_significand,target_scale,target_duration_seconds,effective_from,effective_to,created_at,updated_at) VALUES('${id}-tracking','${id}',1,'checkbox','boolean_success','none',NULL,NULL,NULL,NULL,NULL,'2026-08-01',NULL,1000,1000);
    INSERT INTO habit_importance_versions(id,habit_id,version_number,importance_level,weight,effective_from,effective_to,created_at,updated_at) VALUES('${id}-importance','${id}',1,'normal',2,'2026-08-01',NULL,1000,1000);
  `);
}
