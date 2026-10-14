import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_CORE_MIGRATION } from '../../../src/core/database/migrations/001-planner-core';
import { SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION } from '../../../src/core/database/migrations/002-scheduled-dependency-expiry';
import { PLANNER_LIFECYCLE_MIGRATION } from '../../../src/core/database/migrations/003-planner-lifecycle';
import { PLANNER_SUBHABITS_TIME_MIGRATION } from '../../../src/core/database/migrations/004-planner-subhabits-and-time';
import type { Migration } from '../../../src/core/database/migration';
import { createHarnessForDatabase, plannerId, tableCount } from './test-fixtures';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const MIGRATIONS = [PLANNER_CORE_MIGRATION, SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION, PLANNER_LIFECYCLE_MIGRATION, PLANNER_SUBHABITS_TIME_MIGRATION] as const;

for (const sourceVersion of [1, 2, 3, 4] as const) {
  test(`permanent delete accepts a habit created under schema v${sourceVersion}${sourceVersion === 1 ? ' through the complete 001 to 004 chain' : ''}`, async (t) => {
    const database = new NodeSqliteTestDatabase();
    t.after(() => database.close());
    for (const migration of MIGRATIONS.slice(0, sourceVersion)) await apply(database, migration);
    const habitId = plannerId(80_000 + sourceVersion);
    await seedVersionedHabit(database, sourceVersion, habitId);
    await runMigrations(database);

    const harness = createHarnessForDatabase(database, 90_000 + sourceVersion * 100);
    const archive = await harness.archiveHabit({ habitId, effectiveLocalDate: '2026-08-15', boundaryTimezone: 'Europe/London' });
    assert.equal(archive.ok, true, JSON.stringify(archive));
    const deletion = await harness.permanentlyDeleteHabit({ habitId, effectiveLocalDate: '2026-08-15', boundaryTimezone: 'Europe/London', confirmed: true });
    assert.equal(deletion.ok, true, JSON.stringify(deletion));
    assert.equal(await tableCount(database, 'habits'), 0);
    assert.equal(await tableCount(database, 'habit_schedule_versions'), 0);
    assert.equal(await tableCount(database, 'habit_tracking_versions'), 0);
    assert.equal(await tableCount(database, 'habit_importance_versions'), 0);
    assert.equal((await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_lifecycle_transitions;'))?.count, 0);
    assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
  });
}

async function apply(database: NodeSqliteTestDatabase, migration: Migration): Promise<void> {
  await database.withTransactionAsync(async () => {
    await migration.apply(database);
    await database.execAsync(migration.setUserVersionSql);
  });
}

async function seedVersionedHabit(database: NodeSqliteTestDatabase, sourceVersion: number, id: string): Promise<void> {
  const scheduleId = plannerId(81_000 + sourceVersion * 10);
  const trackingId = plannerId(81_001 + sourceVersion * 10);
  const importanceId = plannerId(81_002 + sourceVersion * 10);
  const plannedTimeId = plannerId(81_003 + sourceVersion * 10);
  const lifecycleId = plannerId(81_004 + sourceVersion * 10);
  await database.execAsync(`
    INSERT INTO habits(id,name,description,category_id,active_from,active_to,sort_order,lifecycle,created_at,updated_at,archived_at)
      VALUES('${id}','Legacy ${sourceVersion}',NULL,NULL,'2026-08-01',NULL,0,'active',1000,1000,NULL);
    INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at)
      VALUES('${scheduleId}','${id}',1,'daily','2026-08-01',NULL,'Europe/London',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1000,1000);
    INSERT INTO habit_tracking_versions(id,habit_id,version_number,tracking_mode,comparison_operator,unit_type,standard_unit_code,custom_unit_label,target_significand,target_scale,target_duration_seconds,effective_from,effective_to,created_at,updated_at)
      VALUES('${trackingId}','${id}',1,'checkbox','boolean_success','none',NULL,NULL,NULL,NULL,NULL,'2026-08-01',NULL,1000,1000);
    INSERT INTO habit_importance_versions(id,habit_id,version_number,importance_level,weight,effective_from,effective_to,created_at,updated_at)
      VALUES('${importanceId}','${id}',1,'normal',2,'2026-08-01',NULL,1000,1000);
  `);
  if (sourceVersion >= 3) {
    await database.runAsync(`INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at) VALUES($id,$habitId,1,'active','2026-08-01','Europe/London',1000,1000);`, { $id: lifecycleId, $habitId: id });
  }
  if (sourceVersion >= 4) {
    await database.runAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at) VALUES($id,$habitId,1,'2026-08-01',NULL,NULL,1000,1000);`, { $id: plannedTimeId, $habitId: id });
  }
}
