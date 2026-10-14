import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_CORE_MIGRATION } from '../../../src/core/database/migrations/001-planner-core';
import { SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION } from '../../../src/core/database/migrations/002-scheduled-dependency-expiry';
import { PLANNER_LIFECYCLE_MIGRATION } from '../../../src/core/database/migrations/003-planner-lifecycle';
import { PLANNER_SUBHABITS_TIME_MIGRATION } from '../../../src/core/database/migrations/004-planner-subhabits-and-time';
import { PLANNER_VISUAL_IDENTITY_MIGRATION } from '../../../src/core/database/migrations/005-planner-visual-identity';
import { PLANNER_ROUTINE_STEPS_MIGRATION } from '../../../src/core/database/migrations/006-planner-routine-steps';
import { PLANNER_EXPANDED_HABIT_IDENTITY_MIGRATION } from '../../../src/core/database/migrations/007-planner-expanded-habit-identity';
import { PLANNER_CHECKLIST_ITEMS_MIGRATION, PLANNER_CHECKLIST_ITEMS_SCHEMA_VERSION } from '../../../src/core/database/migrations/008-planner-checklist-items';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

/**
 * This step is asserted **at its own version**, not at the latest one.
 *
 * Migration 009 reshapes the line — the tick moves off it and onto the day, so a
 * database that has run the whole chain no longer looks like this. What 008 does
 * when it runs is still worth pinning: a chain is only as trustworthy as each
 * link, and the next link is verified against exactly this shape.
 */
const CHAIN_TO_V8 = [
  PLANNER_CORE_MIGRATION,
  SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION,
  PLANNER_LIFECYCLE_MIGRATION,
  PLANNER_SUBHABITS_TIME_MIGRATION,
  PLANNER_VISUAL_IDENTITY_MIGRATION,
  PLANNER_ROUTINE_STEPS_MIGRATION,
  PLANNER_EXPANDED_HABIT_IDENTITY_MIGRATION,
  PLANNER_CHECKLIST_ITEMS_MIGRATION,
] as const;

async function migrateToV8(database: NodeSqliteTestDatabase): Promise<void> {
  for (const migration of CHAIN_TO_V8) {
    await database.withTransactionAsync(async () => {
      await migration.apply(database);
      await database.execAsync(migration.setUserVersionSql);
    });
  }
}

const userVersion = async (database: NodeSqliteTestDatabase) =>
  (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version;

const columns = async (database: NodeSqliteTestDatabase, table: string) =>
  (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`)).map(({ name }) => name);

test('Migration 008 adds the checklist table and nothing else', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());

  await migrateToV8(database);

  assert.equal(PLANNER_CHECKLIST_ITEMS_SCHEMA_VERSION, 8);
  assert.equal(await userVersion(database), 8);
  assert.deepEqual(
    await columns(database, 'habit_checklist_items'),
    ['id', 'habit_id', 'text', 'sort_order', 'done_at', 'created_at', 'deleted_from'],
  );
  // The observation contract is untouched, which is the whole reason a line can
  // never reach a statistic: there is nothing in this table to aggregate.
  assert.equal((await columns(database, 'habit_observations')).length > 0, true);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('a line belongs to a habit, and the habit cannot be dropped from under it', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  const foreignKeys = await database.getAllAsync<{ table: string; on_delete: string; on_update: string }>(
    `SELECT "table", on_delete, on_update FROM pragma_foreign_key_list('habit_checklist_items');`,
  );
  // Spread: the driver hands back null-prototype rows, which strict deep equality
  // will not match against an object literal however identical they read.
  assert.deepEqual(foreignKeys.map((row) => ({ ...row })), [{ table: 'habits', on_delete: 'RESTRICT', on_update: 'RESTRICT' }]);
});

test('the table refuses a line that says nothing and a deletion date that is not one', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await migrateToV8(database);
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('h','Task',NULL,NULL,'2026-07-28',NULL,'active',NULL,1,1);`);

  const insert = (values: string) => database.execAsync(
    `INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,done_at,created_at,deleted_from) VALUES(${values});`,
  );
  await insert(`'a','h','Buy milk',0,NULL,1,NULL`);
  // Empty text is not a line; a negative order is not an order.
  await assert.rejects(insert(`'b','h','',1,NULL,1,NULL`));
  await assert.rejects(insert(`'c','h','x',-1,NULL,1,NULL`));
  // `deleted_from` is a local date, because that is what keeps a deletion from
  // rewriting the past: the state for a day is computed over the lines alive on it.
  await assert.rejects(insert(`'d','h','x',1,NULL,1,'yesterday'`));
  await insert(`'e','h','Cancel the card',1,NULL,1,'2026-07-28'`);

  const rows = await database.getAllAsync<{ id: string }>('SELECT id FROM habit_checklist_items ORDER BY sort_order;');
  assert.deepEqual(rows.map(({ id }) => id), ['a', 'e']);
});

test('a line carries no observation, which is what keeps it out of statistics', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  // At the latest version, where the tick lives on its own day — the clause 008
  // wrote about `done_at` is superseded by Migration 009, and what survives it is
  // the rule that mattered: nothing a subtask does reaches the observation table.
  await runMigrations(database);
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('h','Task',NULL,NULL,'2026-07-28',NULL,'active',NULL,1,1);`);
  await database.execAsync(`INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,created_from,created_at,deleted_from)
    VALUES('a','h','Buy milk',0,'2026-07-28',1,NULL);`);

  await database.execAsync(`INSERT INTO habit_checklist_ticks(checklist_item_id,occurrence_local_date,done_at) VALUES('a','2026-07-28',1700);`);
  await database.execAsync(`DELETE FROM habit_checklist_ticks WHERE checklist_item_id='a' AND occurrence_local_date='2026-07-28';`);

  assert.equal((await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_observations;'))?.count, 0);
});
