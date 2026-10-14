import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations, verifyDatabaseSchema, LATEST_DATABASE_VERSION } from '../../../src/core/database/migration-runner';
import { EXPECTED_SCHEMA } from '../../../src/core/database/schema-expectations';
import { PLANNER_CHECKLIST_SHAPE_REPAIR_SCHEMA_VERSION } from '../../../src/core/database/migrations/010-planner-checklist-shape-repair';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

/**
 * The state a device actually reported, rebuilt exactly.
 *
 * Version 9 by `user_version`, version 8 by shape: the tick table from Migration
 * 009 standing beside the line table from Migration 008. Nothing in the repository
 * can produce it, and the repair does not depend on knowing what did — it reads
 * the two tables and corrects whichever has diverged.
 */
const V8_ITEMS_DDL = `
CREATE TABLE habit_checklist_items (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) > 0),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  done_at INTEGER NULL CHECK (done_at IS NULL OR done_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  deleted_from TEXT NULL,
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX habit_checklist_items_habit_idx ON habit_checklist_items(habit_id, sort_order);`;

const CANONICAL_TICKS_DDL = `
CREATE TABLE habit_checklist_ticks (
  checklist_item_id TEXT NOT NULL,
  occurrence_local_date TEXT NOT NULL CHECK (occurrence_local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_at INTEGER NOT NULL CHECK (done_at >= 0),
  PRIMARY KEY (checklist_item_id, occurrence_local_date),
  FOREIGN KEY (checklist_item_id) REFERENCES habit_checklist_items(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

const columns = async (database: NodeSqliteTestDatabase, table: string) =>
  (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`)).map(({ name }) => name);

const userVersion = async (database: NodeSqliteTestDatabase) =>
  (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version;

const schemaOf = async (database: NodeSqliteTestDatabase) =>
  (await database.getAllAsync<{ name: string; sql: string }>(
    `SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name;`,
  ));

/** The divergence, assembled on top of a database the chain has taken to 9. */
async function brokenDatabase(): Promise<NodeSqliteTestDatabase> {
  const database = new NodeSqliteTestDatabase();
  await runMigrations(database);
  // Put the pair back into the shape the device reported, then reset the claim.
  // **Everything a later migration added has to go with it**, or the fixture claims to
  // be version 9 while carrying tables version 9 never had — and each of those
  // migrations refuses to create a table that is already there, which is exactly the
  // guard that catches a database disagreeing with its own version (PD-DATA-001).
  // **A column counts as much as a table**: Migration 013 adds one rather than creating
  // anything, and it refuses a planned-time table that is not the version 12 shape.
  await database.execAsync(`
    DROP TABLE habit_growth;
    ALTER TABLE habit_planned_time_versions DROP COLUMN planned_block;
    ALTER TABLE habit_planned_time_versions DROP COLUMN planned_duration_minutes;
    DROP TABLE habit_reminder_schedules;
    DROP TABLE habit_closure_rules;
    DROP TABLE habit_checklist_ticks;
    DROP TABLE habit_checklist_items;
    ${V8_ITEMS_DDL}
    ${CANONICAL_TICKS_DDL}
    PRAGMA user_version = 9;`);
  return database;
}

test('a healthy database reaches 10 and the repair changes nothing at all', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  assert.equal(PLANNER_CHECKLIST_SHAPE_REPAIR_SCHEMA_VERSION, 10);
  assert.equal(await userVersion(database), 15);
  assert.equal(LATEST_DATABASE_VERSION, 15);
  assert.deepEqual(
    await columns(database, 'habit_checklist_items'),
    ['id', 'habit_id', 'text', 'sort_order', 'created_from', 'created_at', 'deleted_from'],
  );
  assert.deepEqual(await columns(database, 'habit_checklist_ticks'), ['checklist_item_id', 'occurrence_local_date', 'done_at']);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('the reported divergence is repaired, and the query that failed on the device prepares', async (t) => {
  const database = await brokenDatabase();
  t.after(() => database.close());

  // Exactly the shape the device was in: it claims 9 and has no `created_from`.
  assert.equal(await userVersion(database), 9);
  assert.equal((await columns(database, 'habit_checklist_items')).includes('created_from'), false);
  assert.equal((await columns(database, 'habit_checklist_ticks')).length, 3);

  await runMigrations(database);

  assert.equal(await userVersion(database), 15);
  assert.deepEqual(
    await columns(database, 'habit_checklist_items'),
    ['id', 'habit_id', 'text', 'sort_order', 'created_from', 'created_at', 'deleted_from'],
  );
  // The statement whose failure was the whole report. It is prepared, not merely
  // matched against a column list, because preparing is what the device could not do.
  await database.getAllAsync(`
    SELECT item.id, item.habit_id, item.text, item.sort_order, tick.done_at
    FROM habit_checklist_items AS item
    LEFT JOIN habit_checklist_ticks AS tick
      ON tick.checklist_item_id = item.id AND tick.occurrence_local_date = '2026-07-29'
    WHERE item.habit_id IN ('h')
      AND item.created_from <= '2026-07-29'
      AND (item.deleted_from IS NULL OR item.deleted_from > '2026-07-29')
    ORDER BY item.habit_id, item.sort_order, item.id;`);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('a line written under the old shape is carried over rather than dropped', async (t) => {
  const database = await brokenDatabase();
  t.after(() => database.close());
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,created_at,updated_at)
    VALUES('h','Gym',NULL,NULL,'2026-07-28',NULL,'active',1,1);`);
  // No real database can hold one — the only insert names `created_from` and has
  // always failed on this shape — so the carry is written for a row that cannot
  // exist rather than trusted not to be needed.
  await database.execAsync(`INSERT INTO habit_checklist_items(id,habit_id,text,sort_order,done_at,created_at,deleted_from)
    VALUES('line','h','Warm up',3,NULL,17,'2026-08-01');`);

  await runMigrations(database);

  const carried = await database.getFirstAsync<Record<string, unknown>>(`SELECT * FROM habit_checklist_items WHERE id='line';`);
  assert.deepEqual({ ...carried }, {
    id: 'line',
    habit_id: 'h',
    text: 'Warm up',
    sort_order: 3,
    created_from: '1970-01-01',
    created_at: 17,
    deleted_from: '2026-08-01',
  });
  assert.equal((await database.getFirstAsync<{ value: number }>('SELECT count(*) AS value FROM habits;'))?.value, 1);
});

test('the repair leaves every other table byte for byte as it found it', async (t) => {
  const reference = new NodeSqliteTestDatabase();
  t.after(() => reference.close());
  await runMigrations(reference);
  const expected = (await schemaOf(reference)).filter(({ name }) => !name.startsWith('habit_checklist') && name !== 'habit_closure_rules');

  const database = await brokenDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  const actual = (await schemaOf(database)).filter(({ name }) => !name.startsWith('habit_checklist') && name !== 'habit_closure_rules');

  assert.deepEqual(actual, expected);
});

test('the schema map is what the migrations actually build, in both directions', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  const tables = (await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`,
  )).map(({ name }) => name);

  // Neither side may carry a table the other does not: a migration that adds one
  // and forgets the map fails here rather than on somebody's phone.
  assert.deepEqual(tables, Object.keys(EXPECTED_SCHEMA).sort());
  for (const table of tables) {
    assert.deepEqual(await columns(database, table), EXPECTED_SCHEMA[table], table);
  }
});

test('verification names the missing column instead of letting a feature find it', async (t) => {
  const database = await brokenDatabase();
  t.after(() => database.close());

  await assert.rejects(
    verifyDatabaseSchema(database),
    (error: Error) => /habit_checklist_items table is missing created_from/.test(error.message),
    'the divergence is named at startup, not three screens away',
  );
});
