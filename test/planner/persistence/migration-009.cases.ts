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
import { PLANNER_CHECKLIST_ITEMS_MIGRATION } from '../../../src/core/database/migrations/008-planner-checklist-items';
import { PLANNER_CHECKLIST_DAY_TICKS_SCHEMA_VERSION } from '../../../src/core/database/migrations/009-planner-checklist-day-ticks';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const MIGRATIONS_TO_V8 = [
  PLANNER_CORE_MIGRATION,
  SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION,
  PLANNER_LIFECYCLE_MIGRATION,
  PLANNER_SUBHABITS_TIME_MIGRATION,
  PLANNER_VISUAL_IDENTITY_MIGRATION,
  PLANNER_ROUTINE_STEPS_MIGRATION,
  PLANNER_EXPANDED_HABIT_IDENTITY_MIGRATION,
  PLANNER_CHECKLIST_ITEMS_MIGRATION,
] as const;

async function applyMigration(
  database: NodeSqliteTestDatabase,
  migration: { apply(db: NodeSqliteTestDatabase): Promise<void>; setUserVersionSql: string },
): Promise<void> {
  await database.withTransactionAsync(async () => {
    await migration.apply(database);
    await database.execAsync(migration.setUserVersionSql);
  });
}

const userVersion = async (database: NodeSqliteTestDatabase) =>
  (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version;

const columns = async (database: NodeSqliteTestDatabase, table: string) =>
  (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`)).map(({ name }) => name);

const seedHabit = async (database: NodeSqliteTestDatabase, id: string) => {
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('${id}','Gym',NULL,NULL,'2026-07-28',NULL,'active',NULL,1,1);`);
};

test('Migration 009 moves the tick off the line and onto the day', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  assert.equal(PLANNER_CHECKLIST_DAY_TICKS_SCHEMA_VERSION, 9);
  assert.equal(await userVersion(database), 15);
  // The line is text and an order again. `done_at` is gone from it, because a
  // tick that belongs to a day and a tick that belongs to the line are two
  // answers to one question, and the owner asked for one model.
  assert.deepEqual(
    await columns(database, 'habit_checklist_items'),
    ['id', 'habit_id', 'text', 'sort_order', 'created_from', 'created_at', 'deleted_from'],
  );
  assert.deepEqual(
    await columns(database, 'habit_checklist_ticks'),
    ['checklist_item_id', 'occurrence_local_date', 'done_at'],
  );
  // Still nothing that a statistic could aggregate: the observation table is
  // untouched and no tick ever reaches it.
  assert.equal((await columns(database, 'habit_observations')).length > 0, true);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('a tick belongs to one line and one day, and cannot be written twice for it', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h');
  await database.execAsync(`INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,created_from,created_at,deleted_from)
    VALUES('line','h','Warm up',0,'2026-07-01',1,NULL);`);

  await database.execAsync(`INSERT INTO habit_checklist_ticks(checklist_item_id,occurrence_local_date,done_at) VALUES('line','2026-07-28',10);`);
  await assert.rejects(database.execAsync(
    `INSERT INTO habit_checklist_ticks(checklist_item_id,occurrence_local_date,done_at) VALUES('line','2026-07-28',20);`,
  ), 'one line, one day, one tick');

  // **Yesterday keeps its own answer**, which is the whole reason for the table:
  // done in the gym today and skipped tomorrow are two facts, not one.
  await database.execAsync(`INSERT INTO habit_checklist_ticks(checklist_item_id,occurrence_local_date,done_at) VALUES('line','2026-07-29',30);`);
  const days = await database.getAllAsync<{ occurrence_local_date: string }>(
    `SELECT occurrence_local_date FROM habit_checklist_ticks WHERE checklist_item_id='line' ORDER BY occurrence_local_date;`,
  );
  assert.deepEqual(days.map((row) => row.occurrence_local_date), ['2026-07-28', '2026-07-29']);

  // Undoing is removing the row: "not done" is the absence of a fact and costs
  // nothing to store, so no flag can ever disagree with the row's existence.
  await database.execAsync(`DELETE FROM habit_checklist_ticks WHERE checklist_item_id='line' AND occurrence_local_date='2026-07-28';`);
  const left = await database.getFirstAsync<{ value: number }>(`SELECT count(*) AS value FROM habit_checklist_ticks;`);
  assert.equal(left?.value, 1);
});

test('a line cannot end before it begins', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h');
  await assert.rejects(database.execAsync(`INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,created_from,created_at,deleted_from)
    VALUES('line','h','Warm up',0,'2026-07-28',1,'2026-07-27');`), 'removed before it existed is not a life');
  await assert.rejects(database.execAsync(`INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,created_from,created_at,deleted_from)
    VALUES('line','h','Warm up',0,'yesterday',1,NULL);`), 'a local date or nothing');
  await database.execAsync(`INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,created_from,created_at,deleted_from)
    VALUES('line','h','Warm up',0,'2026-07-28',1,'2026-07-29');`);
  const row = await database.getFirstAsync<{ created_from: string; deleted_from: string }>(`SELECT created_from, deleted_from FROM habit_checklist_items WHERE id='line';`);
  assert.equal(row?.created_from, '2026-07-28');
  assert.equal(row?.deleted_from, '2026-07-29');
});

test('a tick refuses a day that is not a day, and a line that is not there', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h');
  await database.execAsync(`INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,created_from,created_at,deleted_from)
    VALUES('line','h','Warm up',0,'2026-07-01',1,NULL);`);

  await assert.rejects(database.execAsync(
    `INSERT INTO habit_checklist_ticks(checklist_item_id,occurrence_local_date,done_at) VALUES('line','28-07-2026',10);`,
  ), 'a local date or nothing');
  await assert.rejects(database.execAsync(
    `INSERT INTO habit_checklist_ticks(checklist_item_id,occurrence_local_date,done_at) VALUES('missing','2026-07-28',10);`,
  ), 'a tick with no line is not a fact about anything');

  // And the line cannot be dropped from under its own ticks: the weekly purge of
  // a finished task has to take them in order, explicitly.
  await database.execAsync(`INSERT INTO habit_checklist_ticks(checklist_item_id,occurrence_local_date,done_at) VALUES('line','2026-07-28',10);`);
  await assert.rejects(database.execAsync(`DELETE FROM habit_checklist_items WHERE id='line';`), 'RESTRICT, as everywhere else in this schema');
});

test('the rebuild carries the lines over and disturbs nothing else', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  // Stop at 8, write a line the way Migration 008 shaped it, then run 009 over it.
  for (const migration of MIGRATIONS_TO_V8) await applyMigration(database, migration);
  assert.equal(await userVersion(database), 8);
  await seedHabit(database, 'h');
  await database.execAsync(`INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,done_at,created_at,deleted_from)
    VALUES('line','h','Warm up',3,NULL,17,'2026-08-01');`);

  await runMigrations(database);
  assert.equal(await userVersion(database), 15);
  const carried = await database.getFirstAsync<Record<string, unknown>>(`SELECT * FROM habit_checklist_items WHERE id='line';`);
  assert.deepEqual({ ...carried }, {
    id: 'line',
    habit_id: 'h',
    text: 'Warm up',
    sort_order: 3,
    // A line that predates the column begins on the day it was written, read in
    // UTC. No real database has ever held one — nothing writes this table yet.
    created_from: '1970-01-01',
    created_at: 17,
    deleted_from: '2026-08-01',
  });
  const habits = await database.getFirstAsync<{ value: number }>(`SELECT count(*) AS value FROM habits;`);
  assert.equal(habits?.value, 1);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});
