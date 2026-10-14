import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_PLANNED_BLOCK_SCHEMA_VERSION } from '../../../src/core/database/migrations/014-planner-planned-block';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const V13_PLANNED_TIME_COLUMNS = [
  'id', 'habit_id', 'version_number', 'effective_from', 'effective_to',
  'planned_local_time', 'created_at', 'updated_at', 'planned_duration_minutes',
] as const;

const columns = async (database: NodeSqliteTestDatabase, table: string) =>
  (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`)).map(({ name }) => name);

const count = async (database: NodeSqliteTestDatabase, sql: string) =>
  (await database.getFirstAsync<{ value: number }>(sql))?.value;

const seedHabit = async (database: NodeSqliteTestDatabase, id: string) => {
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('${id}','Gym',NULL,NULL,'2026-07-31',NULL,'active',NULL,1,1);`);
};

/** A planned-time row written the way version 13 wrote them — with no block column. */
const seedV13PlannedTime = async (
  database: NodeSqliteTestDatabase,
  id: string,
  habitId: string,
  versionNumber: number,
  plannedLocalTime: string | null,
  plannedDurationMinutes: number | null,
) => {
  const time = plannedLocalTime === null ? 'NULL' : `'${plannedLocalTime}'`;
  const duration = plannedDurationMinutes === null ? 'NULL' : String(plannedDurationMinutes);
  await database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes)
    VALUES('${id}','${habitId}',${versionNumber},'2026-07-01',NULL,${time},1,1,${duration});`);
};

/**
 * A genuine version 13 database.
 *
 * The chain is run whole and rewound by exactly what comes after 13 — one column, one
 * table and the version number. A fixture that claims one version while wearing another
 * is the divergence PD-DATA-001 exists to catch, and both rewind helpers in this suite
 * have already gone stale that way once.
 */
const rewoundToV13 = async (database: NodeSqliteTestDatabase) => {
  await runMigrations(database);
  await database.execAsync('DROP TABLE habit_growth;');
  await database.execAsync('ALTER TABLE habit_planned_time_versions DROP COLUMN planned_block;');
  await database.execAsync('PRAGMA user_version = 13;');
  assert.deepEqual(await columns(database, 'habit_planned_time_versions'), [...V13_PLANNED_TIME_COLUMNS], 'the rewind must produce the real version 13 shape');
  assert.equal(await count(database, 'SELECT user_version AS value FROM pragma_user_version;'), 13);
};

test('Migration 014 adds the planned block beside the minute and the length', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  assert.equal(PLANNER_PLANNED_BLOCK_SCHEMA_VERSION, 14);

  // «When» is three facts now — which part of the day, how long, and sometimes at what
  // minute — and they are versioned together, in one row, so a day described by two eras
  // at once is unconstructible.
  assert.deepEqual(
    await columns(database, 'habit_planned_time_versions'),
    [...V13_PLANNED_TIME_COLUMNS, 'planned_block'],
  );
  assert.equal(
    await count(database, `SELECT count(*) AS value FROM pragma_table_info('habit_planned_time_versions') WHERE name='planned_block' AND "notnull"=0 AND dflt_value IS NULL;`),
    1,
    'the column is nullable with no default, because absence means «no block» — an Anytime item',
  );
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('the block is closed to three parts of the day, and absence is a fourth real state', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  // One habit per block: `uq_habit_planned_time_open` permits a single open version per
  // habit, and that invariant is older than this column and stays exactly as it was.
  for (const block of ['morning', 'day', 'evening']) {
    await seedHabit(database, `h-${block}`);
    await database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes,planned_block)
      VALUES('pt-${block}','h-${block}',1,'2026-07-01',NULL,'07:00',1,1,30,'${block}');`);
  }
  assert.equal(await count(database, `SELECT count(*) AS value FROM habit_planned_time_versions WHERE planned_block IS NOT NULL;`), 3);

  // Anytime: no part of the day claims this item, and that is a state rather than
  // missing data.
  await seedHabit(database, 'h2');
  await database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes,planned_block)
    VALUES('pt-anytime','h2',1,'2026-07-01',NULL,NULL,1,1,NULL,NULL);`);
  assert.equal(await count(database, `SELECT count(*) AS value FROM habit_planned_time_versions WHERE habit_id='h2' AND planned_block IS NULL;`), 1);

  for (const invalid of ['night', 'MORNING', 'утро', '']) {
    await assert.rejects(
      database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes,planned_block)
        VALUES('pt-bad','h2',9,'2026-07-01',NULL,'07:00',1,1,30,'${invalid}');`),
      `a planned block of «${invalid}» must be refused`,
    );
  }
});

test('no row gains a block, and in particular none is derived from the minute it carries', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await rewoundToV13(database);

  // Three rows whose minutes sit squarely inside what the surface would call morning,
  // day and evening. If the migration ever guessed, this is where it would show.
  await seedHabit(database, 'h1');
  await seedHabit(database, 'h2');
  await seedV13PlannedTime(database, 'pt-morning', 'h1', 1, '07:00', 30);
  await seedV13PlannedTime(database, 'pt-evening', 'h2', 1, '19:30', 90);
  await seedHabit(database, 'h3');
  await seedV13PlannedTime(database, 'pt-none', 'h3', 1, null, null);

  const before = JSON.stringify(await database.getAllAsync(
    `SELECT ${V13_PLANNED_TIME_COLUMNS.join(',')} FROM habit_planned_time_versions ORDER BY rowid;`,
  ));

  await runMigrations(database);

  const after = JSON.stringify(await database.getAllAsync(
    `SELECT ${V13_PLANNED_TIME_COLUMNS.join(',')} FROM habit_planned_time_versions ORDER BY rowid;`,
  ));
  assert.equal(after, before, 'the columns the table already had are untouched, row for row');

  // The whole point of storing the block rather than deriving it: a morning routine done
  // at 12:40 must not be filed under «day», or every failed morning quietly becomes an
  // afternoon and the pattern «mornings collapse on Wednesdays» stops being computable.
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_planned_time_versions;'), 3);
  assert.equal(
    await count(database, 'SELECT count(*) AS value FROM habit_planned_time_versions WHERE planned_block IS NOT NULL;'),
    0,
    'the migration assigns a block to nobody, not even to a row whose minute suggests one',
  );

  for (const indexName of ['idx_habit_planned_time_range', 'uq_habit_planned_time_open', 'idx_habit_planned_time_order']) {
    assert.equal(
      await count(database, `SELECT count(*) AS value FROM sqlite_schema WHERE type='index' AND name='${indexName}';`),
      1,
      `index ${indexName} must survive`,
    );
  }
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('the migration refuses a database that already carries the column', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  // Reaching the latest version twice is a no-op: the runner skips what is applied, and
  // the guard inside the migration is what catches a version disagreeing with a shape.
  await runMigrations(database);
  assert.deepEqual(
    await columns(database, 'habit_planned_time_versions'),
    [...V13_PLANNED_TIME_COLUMNS, 'planned_block'],
  );

  await database.execAsync('PRAGMA user_version = 13;');
  await assert.rejects(
    runMigrations(database),
    'a version 13 claim over a shape that already has the block must be named, not re-applied',
  );
});
