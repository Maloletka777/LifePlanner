import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_PLANNED_DURATION_SCHEMA_VERSION } from '../../../src/core/database/migrations/013-planner-planned-duration';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const V12_PLANNED_TIME_COLUMNS = [
  'id', 'habit_id', 'version_number', 'effective_from', 'effective_to',
  'planned_local_time', 'created_at', 'updated_at',
] as const;

const columns = async (database: NodeSqliteTestDatabase, table: string) =>
  (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`)).map(({ name }) => name);

const count = async (database: NodeSqliteTestDatabase, sql: string) =>
  (await database.getFirstAsync<{ value: number }>(sql))?.value;

const seedHabit = async (database: NodeSqliteTestDatabase, id: string) => {
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('${id}','Gym',NULL,NULL,'2026-07-31',NULL,'active',NULL,1,1);`);
};

const seedPlannedTime = async (
  database: NodeSqliteTestDatabase,
  id: string,
  habitId: string,
  versionNumber: number,
  effectiveFrom: string,
  effectiveTo: string | null,
  plannedLocalTime: string | null,
) => {
  const to = effectiveTo === null ? 'NULL' : `'${effectiveTo}'`;
  const time = plannedLocalTime === null ? 'NULL' : `'${plannedLocalTime}'`;
  await database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at)
    VALUES('${id}','${habitId}',${versionNumber},'${effectiveFrom}',${to},${time},1,1);`);
};

/**
 * A genuine version 12 database carrying real rows.
 *
 * The chain is run whole and then rewound by exactly what Migration 013 adds — one
 * column and the version number — so what 013 then runs over is data that was written
 * before it existed, which is the only case worth testing. The rewind drops the column
 * it added and nothing else, because a fixture that claims one version while carrying
 * another shape is precisely the divergence PD-DATA-001 exists to catch, and this
 * repository has already had one go stale that way.
 */
const rewoundToV12 = async (database: NodeSqliteTestDatabase) => {
  await runMigrations(database);
  // Everything a later migration added has to come off too, or the fixture claims to be
  // version 12 while wearing a shape version 12 never had — which is the exact staleness
  // the comment above warns about, and which this helper has now hit once.
  await database.execAsync('DROP TABLE habit_growth;');
  await database.execAsync('ALTER TABLE habit_planned_time_versions DROP COLUMN planned_block;');
  await database.execAsync('ALTER TABLE habit_planned_time_versions DROP COLUMN planned_duration_minutes;');
  await database.execAsync('PRAGMA user_version = 12;');
  assert.deepEqual(await columns(database, 'habit_planned_time_versions'), [...V12_PLANNED_TIME_COLUMNS], 'the rewind must produce the real version 12 shape');
  assert.equal(await count(database, 'SELECT user_version AS value FROM pragma_user_version;'), 12);
};

test('Migration 013 adds the planned duration beside the planned time', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  assert.equal(PLANNER_PLANNED_DURATION_SCHEMA_VERSION, 13);
  assert.equal(await count(database, 'SELECT user_version AS value FROM pragma_user_version;'), 15);

  // The length lives in the time family's own effective-dated row, not in a table of
  // its own: a version carrying a time from one era and a length from another would
  // describe a day that never existed.
  assert.deepEqual(
    await columns(database, 'habit_planned_time_versions'),
    [...V12_PLANNED_TIME_COLUMNS, 'planned_duration_minutes', 'planned_block'],
  );
  assert.equal(
    await count(database, `SELECT count(*) AS value FROM pragma_table_info('habit_planned_time_versions') WHERE name='planned_duration_minutes' AND "notnull"=0 AND dflt_value IS NULL;`),
    1,
    'the column is nullable and carries no default, because absence means unknown',
  );
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('a length is a positive number of minutes inside a day, or it is absent', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h1');

  await seedPlannedTime(database, 'pt-none', 'h1', 1, '2026-07-31', '2026-08-01', '07:00');
  assert.equal(
    await count(database, `SELECT count(*) AS value FROM habit_planned_time_versions WHERE id='pt-none' AND planned_duration_minutes IS NULL;`),
    1,
    'a version written without a length reads back as having none',
  );

  await database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes)
    VALUES('pt-90','h1',2,'2026-08-01',NULL,'07:00',1,1,90);`);
  assert.equal(await count(database, `SELECT planned_duration_minutes AS value FROM habit_planned_time_versions WHERE id='pt-90';`), 90);

  // Zero is not a short thing, it is a thing that does not happen; a negative length is
  // not a length; and nothing planned inside one day can run longer than the day.
  await seedHabit(database, 'h2');
  for (const invalid of ['0', '-30', '1441']) {
    await assert.rejects(
      database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes)
        VALUES('pt-bad-${invalid}','h2',1,'2026-07-31',NULL,'07:00',1,1,${invalid});`),
      `a planned duration of ${invalid} minutes must be refused`,
    );
  }

  // Both ends of the range are storable.
  await seedHabit(database, 'h3');
  await database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes)
    VALUES('pt-min','h3',1,'2026-07-31','2026-08-01','07:00',1,1,1);`);
  await database.execAsync(`INSERT INTO habit_planned_time_versions(id,habit_id,version_number,effective_from,effective_to,planned_local_time,created_at,updated_at,planned_duration_minutes)
    VALUES('pt-max','h3',2,'2026-08-01',NULL,'07:00',1,1,1440);`);
  assert.equal(await count(database, `SELECT count(*) AS value FROM habit_planned_time_versions WHERE habit_id='h3';`), 2);
});

test('every version written before the migration survives it, and none gains a length', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await rewoundToV12(database);

  // Real rows of the kind the table actually holds: a closed version, an open one, and
  // one with no planned time at all — an Anytime item, which must stay lengthless.
  await seedHabit(database, 'h1');
  await seedHabit(database, 'h2');
  await seedPlannedTime(database, 'pt-1', 'h1', 1, '2026-07-01', '2026-07-15', '07:00');
  await seedPlannedTime(database, 'pt-2', 'h1', 2, '2026-07-15', null, '08:30');
  await seedPlannedTime(database, 'pt-3', 'h2', 1, '2026-07-01', null, null);

  const before = JSON.stringify(await database.getAllAsync(
    `SELECT ${V12_PLANNED_TIME_COLUMNS.join(',')} FROM habit_planned_time_versions ORDER BY rowid;`,
  ));

  await runMigrations(database);

  assert.equal(await count(database, 'SELECT user_version AS value FROM pragma_user_version;'), 15);
  const after = JSON.stringify(await database.getAllAsync(
    `SELECT ${V12_PLANNED_TIME_COLUMNS.join(',')} FROM habit_planned_time_versions ORDER BY rowid;`,
  ));
  assert.equal(after, before, 'the columns the table already had are untouched, row for row');

  // No backfill. «Half an hour, probably» would be a fabrication in the database, and
  // the surfaces that draw a length are built to draw its absence instead.
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_planned_time_versions;'), 3);
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_planned_time_versions WHERE planned_duration_minutes IS NOT NULL;'), 0);

  // The indexes Migration 004 put on this table are still there — which is the reason
  // this is an ADD COLUMN rather than a rebuild that would have to re-create them.
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

  // Reaching version 13 twice is a no-op, not a second ALTER: the runner skips what is
  // already applied, and the guard inside the migration is what would catch a database
  // whose version disagreed with its shape (PD-DATA-001).
  await runMigrations(database);
  assert.deepEqual(
    await columns(database, 'habit_planned_time_versions'),
    [...V12_PLANNED_TIME_COLUMNS, 'planned_duration_minutes', 'planned_block'],
  );

  await database.execAsync('PRAGMA user_version = 12;');
  await assert.rejects(
    runMigrations(database),
    'a version 12 claim over a later shape must be named, not silently re-applied',
  );
});
