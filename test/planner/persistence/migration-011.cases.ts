import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_CLOSURE_RULES_SCHEMA_VERSION } from '../../../src/core/database/migrations/011-planner-closure-rules';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const seedHabit = async (database: NodeSqliteTestDatabase, id: string) => {
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('${id}','Gym',NULL,NULL,'2026-07-29',NULL,'active',NULL,1,1);`);
};

const columns = async (database: NodeSqliteTestDatabase, table: string) =>
  (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`)).map(({ name }) => name);

test('Migration 011 adds the closure rule and nothing else', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  assert.equal(PLANNER_CLOSURE_RULES_SCHEMA_VERSION, 11);
  assert.deepEqual(await columns(database, 'habit_closure_rules'), ['habit_id', 'closes_by_checklist', 'updated_at']);
  // Absence is the default, so nothing is written for an item that has not chosen.
  assert.equal((await database.getFirstAsync<{ value: number }>('SELECT count(*) AS value FROM habit_closure_rules;'))?.value, 0);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('a rule belongs to one item, is a boolean, and cannot outlive its habit', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h');

  await database.execAsync(`INSERT INTO habit_closure_rules(habit_id,closes_by_checklist,updated_at) VALUES('h',0,10);`);
  await assert.rejects(
    database.execAsync(`INSERT INTO habit_closure_rules(habit_id,closes_by_checklist,updated_at) VALUES('h',1,20);`),
    'one item, one rule',
  );
  await assert.rejects(
    database.execAsync(`INSERT INTO habit_closure_rules(habit_id,closes_by_checklist,updated_at) VALUES('missing',1,20);`),
    'a rule about no item is not a rule',
  );
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('other','Run',NULL,NULL,'2026-07-29',NULL,'active',NULL,1,1);`);
  await assert.rejects(
    database.execAsync(`INSERT INTO habit_closure_rules(habit_id,closes_by_checklist,updated_at) VALUES('other',2,20);`),
    'closes by its checklist, or it does not — there is no third answer',
  );

  // The item cannot be dropped from under its own rule: deletion takes them in
  // order, explicitly, as it does for a checklist line and its ticks.
  await assert.rejects(database.execAsync(`DELETE FROM habits WHERE id='h';`), 'RESTRICT, as everywhere else in this schema');
});

test('the rule writes no observation, so it can never reach a figure', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h');
  await database.execAsync(`INSERT INTO habit_closure_rules(habit_id,closes_by_checklist,updated_at) VALUES('h',0,10);`);

  // Choosing how an item closes is not an event in its history. What *is* an
  // event is the closure itself, and that stays an observation whichever way it
  // was made — which is why a mark on a day that is over keeps counting as missed.
  assert.equal((await database.getFirstAsync<{ value: number }>('SELECT count(*) AS value FROM habit_observations;'))?.value, 0);
});
