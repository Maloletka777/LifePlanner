import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_HABIT_GROWTH_SCHEMA_VERSION } from '../../../src/core/database/migrations/015-planner-habit-growth';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const columns = async (database: NodeSqliteTestDatabase, table: string) =>
  (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`)).map(({ name }) => name);

const count = async (database: NodeSqliteTestDatabase, sql: string) =>
  (await database.getFirstAsync<{ value: number }>(sql))?.value;

const seedHabit = async (database: NodeSqliteTestDatabase, id: string) => {
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('${id}','Gym',NULL,NULL,'2026-07-31',NULL,'active',NULL,1,1);`);
};

interface AttemptInput {
  readonly id: string;
  readonly habitId: string;
  readonly attemptNumber: number;
  readonly trackedFrom: string;
  readonly stoppedFrom?: string | null;
  readonly cue?: string | null;
  readonly enjoyment?: string | null;
}

const insertAttempt = async (database: NodeSqliteTestDatabase, input: AttemptInput) => {
  const stopped = input.stoppedFrom === undefined || input.stoppedFrom === null ? 'NULL' : `'${input.stoppedFrom}'`;
  const cue = input.cue === undefined || input.cue === null ? 'NULL' : `'${input.cue}'`;
  const enjoyment = input.enjoyment === undefined || input.enjoyment === null ? 'NULL' : `'${input.enjoyment}'`;
  await database.execAsync(`INSERT INTO habit_growth(id,habit_id,attempt_number,tracked_from,stopped_from,cue,enjoyment,created_at,updated_at)
    VALUES('${input.id}','${input.habitId}',${input.attemptNumber},'${input.trackedFrom}',${stopped},${cue},${enjoyment},1,1);`);
};

test('Migration 015 adds the growth table and nothing else', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  assert.equal(PLANNER_HABIT_GROWTH_SCHEMA_VERSION, 15);
  assert.deepEqual(
    await columns(database, 'habit_growth'),
    ['id', 'habit_id', 'attempt_number', 'tracked_from', 'stopped_from', 'cue', 'enjoyment', 'created_at', 'updated_at'],
  );
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_growth;'), 0);

  // The habits table is what the second floor points at, and it is untouched: eleven
  // columns, exactly as Migration 001 and 003 left it.
  assert.equal(await count(database, `SELECT count(*) AS value FROM pragma_table_info('habits');`), 11);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('an attempt belongs to a habit, and the habit cannot be dropped from under it', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h1');
  await insertAttempt(database, { id: 'g1', habitId: 'h1', attemptNumber: 1, trackedFrom: '2026-08-04' });

  await assert.rejects(
    insertAttempt(database, { id: 'g-orphan', habitId: 'missing', attemptNumber: 1, trackedFrom: '2026-08-04' }),
    'an attempt at growing a habit that does not exist must be refused',
  );
  await assert.rejects(
    database.execAsync(`DELETE FROM habits WHERE id='h1';`),
    'RESTRICT: a habit with an attempt against it cannot be deleted out from under it',
  );
});

test('a habit may have several attempts, and only one of them may be open', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h1');

  // The owner's instruction, held by the schema: data is written on top of old data
  // rather than over it, so a second attempt at the same routine does not erase the
  // first. Two rows, two stories, and the spring attempt starts from zero of its own.
  await insertAttempt(database, { id: 'g1', habitId: 'h1', attemptNumber: 1, trackedFrom: '2026-02-01', stoppedFrom: '2026-03-15' });
  await insertAttempt(database, { id: 'g2', habitId: 'h1', attemptNumber: 2, trackedFrom: '2026-08-04' });
  assert.equal(await count(database, `SELECT count(*) AS value FROM habit_growth WHERE habit_id='h1';`), 2);

  // But at most one may be open, and that is the one invariant the schema holds.
  await assert.rejects(
    insertAttempt(database, { id: 'g3', habitId: 'h1', attemptNumber: 3, trackedFrom: '2026-09-01' }),
    'a second open attempt at the same routine must be refused',
  );

  // Closing the open one makes room for the next.
  await database.execAsync(`UPDATE habit_growth SET stopped_from='2026-08-20' WHERE id='g2';`);
  await insertAttempt(database, { id: 'g3', habitId: 'h1', attemptNumber: 3, trackedFrom: '2026-09-01' });
  assert.equal(await count(database, `SELECT count(*) AS value FROM habit_growth WHERE habit_id='h1' AND stopped_from IS NULL;`), 1);

  await assert.rejects(
    insertAttempt(database, { id: 'g-dup', habitId: 'h1', attemptNumber: 3, trackedFrom: '2026-10-01', stoppedFrom: '2026-10-02' }),
    'two attempts cannot share a number for one habit',
  );
});

test('the cap of three is deliberately not in the schema', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  for (const id of ['h1', 'h2', 'h3', 'h4']) await seedHabit(database, id);

  // Three open attempts is a product judgement that may move, and a number somebody
  // argued about does not belong in a constraint that would need a migration to change.
  // The schema permits a fourth; the command is what refuses one.
  for (const [index, habitId] of ['h1', 'h2', 'h3', 'h4'].entries()) {
    await insertAttempt(database, { id: `g${index}`, habitId, attemptNumber: 1, trackedFrom: '2026-08-04' });
  }
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_growth WHERE stopped_from IS NULL;'), 4);
});

test('an attempt cannot end before it began, and the two questions are closed sets', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h1');

  await assert.rejects(
    insertAttempt(database, { id: 'g-back', habitId: 'h1', attemptNumber: 1, trackedFrom: '2026-08-04', stoppedFrom: '2026-08-01' }),
    'an attempt that stops before it starts must be refused',
  );
  await assert.rejects(
    insertAttempt(database, { id: 'g-same', habitId: 'h1', attemptNumber: 1, trackedFrom: '2026-08-04', stoppedFrom: '2026-08-04' }),
    'an attempt that stops on the day it starts has no days in it',
  );
  await assert.rejects(
    insertAttempt(database, { id: 'g-nodate', habitId: 'h1', attemptNumber: 1, trackedFrom: 'soon' }),
    'a start that is not a date must be refused',
  );

  for (const invalid of ['maybe', 'YES', 'нравится']) {
    await assert.rejects(
      insertAttempt(database, { id: 'g-bad', habitId: 'h1', attemptNumber: 1, trackedFrom: '2026-08-04', enjoyment: invalid }),
      `an enjoyment of «${invalid}» must be refused`,
    );
  }

  // Both questions are optional: an attempt is valid before either is answered, because
  // refusing to answer is not an error.
  await insertAttempt(database, { id: 'g-quiet', habitId: 'h1', attemptNumber: 1, trackedFrom: '2026-08-04' });
  assert.equal(await count(database, `SELECT count(*) AS value FROM habit_growth WHERE cue IS NULL AND enjoyment IS NULL;`), 1);

  await database.execAsync(`UPDATE habit_growth SET cue='после ужина', enjoyment='yes' WHERE id='g-quiet';`);
  assert.equal(await count(database, `SELECT count(*) AS value FROM habit_growth WHERE cue='после ужина' AND enjoyment='yes';`), 1);
});

test('the growth table writes no observation, so the first floor cannot see the second', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedHabit(database, 'h1');

  const observationsBefore = await count(database, 'SELECT count(*) AS value FROM habit_observations;');
  await insertAttempt(database, { id: 'g1', habitId: 'h1', attemptNumber: 1, trackedFrom: '2026-08-04', cue: 'после ужина', enjoyment: 'yes' });
  await database.execAsync(`UPDATE habit_growth SET stopped_from='2026-09-01' WHERE id='g1';`);

  // Marking a routine as one you are growing is not a fact about a day, so it can never
  // reach a completion figure. That separation is structural rather than remembered:
  // ordinary analytics never joins this table, and could not accidentally.
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_observations;'), observationsBefore);
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_checklist_ticks;'), 0);
});
