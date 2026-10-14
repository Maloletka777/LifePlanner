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
import { PLANNER_EXPANDED_HABIT_IDENTITY_MIGRATION } from '../../../src/core/database/migrations/007-planner-expanded-habit-identity';
import { mapHabitVisualIdentityRow } from '../../../src/features/planner/infrastructure/sqlite/planner-row-mappers';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const MIGRATIONS_TO_V6 = [
  PLANNER_CORE_MIGRATION,
  SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION,
  PLANNER_LIFECYCLE_MIGRATION,
  PLANNER_SUBHABITS_TIME_MIGRATION,
  PLANNER_VISUAL_IDENTITY_MIGRATION,
  PLANNER_ROUTINE_STEPS_MIGRATION,
] as const;

test('Migration 007 advances an empty v6 database to the exact expanded identity shape', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  for (const migration of MIGRATIONS_TO_V6) await apply(database, migration);

  await apply(database, PLANNER_EXPANDED_HABIT_IDENTITY_MIGRATION);

  assert.equal(await userVersion(database), 7);
  assert.deepEqual(
    (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('habit_visual_identities') ORDER BY cid;`)).map(({ name }) => name),
    ['id', 'habit_id', 'icon_kind', 'symbol_key', 'emoji_value', 'accent_key', 'created_at', 'updated_at'],
  );
  assert.equal((await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_visual_identities;'))?.count, 0);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('Migration 007 maps every v6 identity to an exact symbol and preserves every other fact', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await preparePopulatedV6(database);
  const preserved = await snapshotTablesExceptIdentity(database);

  await runMigrations(database);

  assert.equal(await userVersion(database), 15);
  assert.deepEqual(await snapshotTablesExceptIdentity(database), preserved);
  assert.deepEqual(
    (await database.getAllAsync<Record<string, unknown>>('SELECT * FROM habit_visual_identities ORDER BY habit_id;')).map((row) => ({ ...row })),
    [
      { id: 'child', habit_id: 'child', icon_kind: 'symbol', symbol_key: 'checkbox', emoji_value: null, accent_key: 'coral', created_at: 1000, updated_at: 1000 },
      { id: 'parent', habit_id: 'parent', icon_kind: 'symbol', symbol_key: 'reading', emoji_value: null, accent_key: 'lavender', created_at: 1000, updated_at: 1200 },
    ],
  );
  assert.equal((await database.getFirstAsync<{ completion_role: string }>(`SELECT completion_role FROM habit_ordinary_parent_versions WHERE id='routine';`))?.completion_role, 'routine_step');
  assert.equal((await database.getFirstAsync<{ note: string }>(`SELECT note FROM habit_observations WHERE id='parent-observation';`))?.note, 'legacy fact');
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('schema v7 enforces icon variants, registered symbols, semantic accents, byte bounds, and restrictive ownership', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  const ownerId = '00000000-0000-4000-8000-000000000007';
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,sort_order,lifecycle,created_at,updated_at,archived_at) VALUES('${ownerId}','Owner',NULL,NULL,'2026-08-01',NULL,0,'active',1,1,NULL);`);

  await database.execAsync(`INSERT INTO habit_visual_identities(id,habit_id,icon_kind,symbol_key,emoji_value,accent_key,created_at,updated_at) VALUES('${ownerId}','${ownerId}','emoji',NULL,'👩🏽‍💻','indigo',1,1);`);
  const row = await database.getFirstAsync<Record<string, unknown>>(`SELECT * FROM habit_visual_identities WHERE habit_id='${ownerId}';`);
  assert.equal(row === null ? false : mapHabitVisualIdentityRow(row as never).ok, true);
  assert.equal(row?.emoji_value, '👩🏽‍💻');

  await assert.rejects(database.execAsync(`UPDATE habit_visual_identities SET icon_kind='symbol',symbol_key='unknown',emoji_value=NULL WHERE habit_id='${ownerId}';`));
  await assert.rejects(database.execAsync(`UPDATE habit_visual_identities SET icon_kind='symbol',symbol_key='coding',emoji_value='😀' WHERE habit_id='${ownerId}';`));
  await assert.rejects(database.execAsync(`UPDATE habit_visual_identities SET icon_kind='emoji',symbol_key='coding',emoji_value='😀' WHERE habit_id='${ownerId}';`));
  await assert.rejects(database.execAsync(`UPDATE habit_visual_identities SET icon_kind='emoji',symbol_key=NULL,emoji_value='' WHERE habit_id='${ownerId}';`));
  await assert.rejects(database.execAsync(`UPDATE habit_visual_identities SET accent_key='magenta' WHERE habit_id='${ownerId}';`));
  await assert.rejects(database.execAsync(`UPDATE habit_visual_identities SET emoji_value='${'😀'.repeat(17)}' WHERE habit_id='${ownerId}';`));
  await assert.rejects(database.execAsync(`INSERT INTO habit_visual_identities(id,habit_id,icon_kind,symbol_key,emoji_value,accent_key,created_at,updated_at) VALUES('missing','missing','symbol','coding',NULL,'grey',1,1);`));
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('persistence mapping rejects malformed emoji sequences even when structural SQL checks are bypassed', () => {
  const mapped = mapHabitVisualIdentityRow({
    id: '00000000-0000-4000-8000-000000000001',
    habit_id: '00000000-0000-4000-8000-000000000001',
    icon_kind: 'emoji',
    symbol_key: null,
    emoji_value: '😀😀',
    accent_key: 'blue',
    created_at: 1,
    updated_at: 1,
  });
  assert.equal(mapped.ok, false);
});

test('a file database reopens at the latest version with emoji, symbols, routine roles, and history unchanged', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lifeplanner-v7-'));
  const filename = join(directory, 'planner.sqlite');
  let database = new NodeSqliteTestDatabase(filename);
  try {
    await preparePopulatedV6(database);
    await runMigrations(database);
    await database.execAsync(`UPDATE habit_visual_identities SET icon_kind='emoji',symbol_key=NULL,emoji_value='☕️',accent_key='brown',updated_at=1300 WHERE habit_id='parent';`);
    const before = await snapshotState(database);
    database.close();
    database = new NodeSqliteTestDatabase(filename);
    await runMigrations(database);
    assert.equal(await userVersion(database), 15);
    assert.deepEqual(await snapshotState(database), before);
    assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Migration 007 rolls back DDL, copy, swap, verification, version, and commit failures to exact v6', async () => {
  const boundaries = ['ddl', 'copy', 'swap', 'verification', 'version', 'commit'] as const;
  for (const boundary of boundaries) {
    const database = new NodeSqliteTestDatabase();
    try {
      await preparePopulatedV6(database);
      const before = await snapshotState(database);
      await assert.rejects(runMigrations(faultingDatabase(database, boundary)));
      assert.equal(await userVersion(database), 6, boundary);
      assert.deepEqual(await snapshotState(database), before, boundary);
      assert.equal((await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM sqlite_schema WHERE name='habit_visual_identities_v7';`))?.count, 0, boundary);
      assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), [], boundary);
    } finally {
      database.close();
    }
  }
});

async function preparePopulatedV6(database: NodeSqliteTestDatabase): Promise<void> {
  for (const migration of MIGRATIONS_TO_V6) await apply(database, migration);
  await database.execAsync(String.raw`
    INSERT INTO habits(id,name,description,category_id,active_from,active_to,sort_order,lifecycle,created_at,updated_at,archived_at)
      VALUES('parent','Parent',NULL,NULL,'2026-08-01',NULL,0,'active',1000,1200,NULL),
            ('child','Child',NULL,NULL,'2026-08-01',NULL,1,'active',1000,1000,NULL);
    INSERT INTO habit_schedule_versions(id,habit_id,version_number,schedule_type,effective_from,effective_to,evaluation_timezone,interval_days,weekdays_mask,weekday,period_target_count,anchor_date,month_day,month_number,week_start,created_at,updated_at)
      VALUES('parent-schedule','parent',1,'daily','2026-08-01',NULL,'Europe/London',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1000,1000),
            ('child-schedule','child',1,'daily','2026-08-01',NULL,'Europe/London',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1000,1000);
    INSERT INTO habit_tracking_versions(id,habit_id,version_number,tracking_mode,comparison_operator,unit_type,standard_unit_code,custom_unit_label,target_significand,target_scale,target_duration_seconds,effective_from,effective_to,created_at,updated_at)
      VALUES('parent-tracking','parent',1,'checkbox','boolean_success','none',NULL,NULL,NULL,NULL,NULL,'2026-08-01',NULL,1000,1000),
            ('child-tracking','child',1,'checkbox','boolean_success','none',NULL,NULL,NULL,NULL,NULL,'2026-08-01',NULL,1000,1000);
    INSERT INTO habit_importance_versions(id,habit_id,version_number,importance_level,weight,effective_from,effective_to,created_at,updated_at)
      VALUES('parent-importance','parent',1,'high',3,'2026-08-01',NULL,1000,1000),
            ('child-importance','child',1,'normal',2,'2026-08-01',NULL,1000,1000);
    INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at)
      VALUES('parent-lifecycle','parent',1,'active','2026-08-01','Europe/London',1000,1000),
            ('child-lifecycle','child',1,'active','2026-08-01','Europe/London',1000,1000);
    INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at)
      VALUES('parent-time','parent',1,'2026-08-01',NULL,NULL,1000,1000),
            ('child-time','child',1,'2026-08-01',NULL,'09:00',1000,1000);
    INSERT INTO habit_visual_identities(id,habit_id,icon_key,accent_key,created_at,updated_at)
      VALUES('parent','parent','reading','lavender',1000,1200),
            ('child','child','checkbox','coral',1000,1000);
    INSERT INTO habit_ordinary_parent_versions(id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,effective_from,effective_to,end_reason,created_at,updated_at)
      VALUES('routine','routine',1,'parent','child','routine_step','2026-08-01',NULL,NULL,1000,1000);
    INSERT INTO habit_observations(id,habit_id,context_mode,schedule_version_id,detached_schedule_context_id,tracking_version_id,importance_version_id,dependency_version_id,occurrence_local_date,occurrence_local_time,occurrence_timezone,observation_type,boolean_value,counter_delta,quantity_significand,quantity_scale,duration_seconds,note,supersedes_observation_id,correction_reason,observed_at,created_at)
      VALUES('parent-observation','parent','live_independent','parent-schedule',NULL,'parent-tracking','parent-importance',NULL,'2026-08-02',NULL,'Europe/London','checkbox',1,NULL,NULL,NULL,NULL,'legacy fact',NULL,NULL,1100,1100);
  `);
  assert.equal(await userVersion(database), 6);
}

async function apply(database: NodeSqliteTestDatabase, migration: { apply(db: NodeSqliteTestDatabase): Promise<void>; setUserVersionSql: string }): Promise<void> {
  await database.withTransactionAsync(async () => {
    await migration.apply(database);
    await database.execAsync(migration.setUserVersionSql);
  });
}

/**
 * Everything except the table 007 rebuilds — and except the one Migration 008
 * adds, which does not exist before the chain runs and is empty after it, so
 * comparing it would only assert that a later migration ran.
 */
async function snapshotTablesExceptIdentity(database: NodeSqliteTestDatabase): Promise<Record<string, unknown[]>> {
  const names = await database.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('habit_visual_identities','habit_checklist_items','habit_checklist_ticks','habit_closure_rules','habit_reminder_schedules','habit_growth') ORDER BY name;`);
  const snapshot: Record<string, unknown[]> = {};
  for (const { name } of names) {
    // **A column a later migration adds is not a fact that moved.** Migration 013 adds
    // `planned_duration_minutes` to the planned-time table and Migration 014 adds
    // `planned_block`, so every row legitimately gains a key between the two snapshots;
    // the test is about whether anything the v6 database *said* changed, and that is what
    // the projection preserves. Whether an added column is null everywhere is the
    // assertion of the migration that added it, not this one's.
    const rows = await database.getAllAsync<Record<string, unknown>>(`SELECT * FROM "${name}" ORDER BY rowid;`);
    snapshot[name] = rows.map(({ planned_duration_minutes: _duration, planned_block: _block, ...fact }) => fact);
  }
  return snapshot;
}

async function snapshotState(database: NodeSqliteTestDatabase): Promise<Readonly<{ schema: unknown[]; tables: Record<string, unknown[]> }>> {
  const schema = await database.getAllAsync(`SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name;`);
  const names = await database.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`);
  const tables: Record<string, unknown[]> = {};
  for (const { name } of names) tables[name] = await database.getAllAsync(`SELECT * FROM "${name}" ORDER BY rowid;`);
  return Object.freeze({ schema, tables });
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
      if (boundary === 'ddl' && source.includes('CREATE TABLE habit_visual_identities_v7')) throw new Error('forced DDL failure');
      if (boundary === 'copy' && source.includes('INSERT INTO habit_visual_identities_v7')) throw new Error('forced copy failure');
      if (boundary === 'swap' && source.includes('DROP TABLE habit_visual_identities')) throw new Error('forced swap failure');
      if (boundary === 'version' && source.includes('PRAGMA user_version = 7')) throw new Error('forced version failure');
      await database.execAsync(source);
    },
    async getFirstAsync<T>(source: string) {
      if (boundary === 'verification' && source.includes("name IN ('icon_kind','symbol_key','emoji_value') AND type='TEXT'")) throw new Error('forced verification failure');
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
