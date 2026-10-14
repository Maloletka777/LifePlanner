import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../src/core/database/migration-runner';
import { PLANNER_REMINDER_SCHEDULES_SCHEMA_VERSION } from '../../../src/core/database/migrations/012-planner-reminder-schedules';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

const seedReminder = async (database: NodeSqliteTestDatabase, id: string, triggerLocalTime = '07:00') => {
  await database.execAsync(`INSERT INTO habits(id,name,description,category_id,active_from,active_to,lifecycle,archived_at,created_at,updated_at)
    VALUES('h-${id}','Gym',NULL,NULL,'2026-07-31',NULL,'active',NULL,1,1);`);
  await database.execAsync(`INSERT INTO habit_reminders(id,habit_id,trigger_local_time,timezone_mode,timezone_id,enabled,lifecycle,created_at,updated_at,archived_at)
    VALUES('${id}','h-${id}','${triggerLocalTime}','schedule_timezone',NULL,1,'active',1,1,NULL);`);
};

const columns = async (database: NodeSqliteTestDatabase, table: string) =>
  (await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`)).map(({ name }) => name);

const count = async (database: NodeSqliteTestDatabase, sql: string) =>
  (await database.getFirstAsync<{ value: number }>(sql))?.value;

test('Migration 012 adds the projection and leaves intent exactly as it was', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  assert.equal(PLANNER_REMINDER_SCHEDULES_SCHEMA_VERSION, 12);
  assert.deepEqual(
    await columns(database, 'habit_reminder_schedules'),
    ['reminder_id', 'system_identifier', 'status', 'scheduled_for', 'failure_reason', 'updated_at'],
  );
  // **The intent side needed nothing.** `habit_reminders` has carried its ten columns
  // since Migration 001, and several reminders per habit have always been storable —
  // so the contract's offsets are ways of arriving at a trigger time, not new columns.
  assert.deepEqual(
    await columns(database, 'habit_reminders'),
    ['id', 'habit_id', 'trigger_local_time', 'timezone_mode', 'timezone_id', 'enabled', 'lifecycle', 'created_at', 'updated_at', 'archived_at'],
  );
  // Absence is `not_requested`: nothing is written for a reminder the OS has not heard
  // of, so every reminder stored before this migration reads back as what it is.
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_reminder_schedules;'), 0);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('a projection belongs to one reminder, and only the six statuses exist', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedReminder(database, 'r1');

  await database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,system_identifier,status,scheduled_for,failure_reason,updated_at)
    VALUES('r1','sys-1','scheduled','07:00',NULL,17);`);
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_reminder_schedules;'), 1);

  // One row per reminder: a second projection for the same reminder is not a thing.
  await assert.rejects(database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,status,updated_at) VALUES('r1','queued',18);`));
  // A status outside the contract's six is refused rather than stored and interpreted.
  await seedReminder(database, 'r2');
  await assert.rejects(database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,status,updated_at) VALUES('r2','pending',18);`));
  // And an identifier is an identifier or it is absent — never a blank standing in for one.
  await assert.rejects(database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,system_identifier,status,updated_at) VALUES('r2','   ','scheduled',18);`));
  // `scheduled_for` is a local minute, checked the way the trigger time is checked.
  await assert.rejects(database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,status,scheduled_for,updated_at) VALUES('r2','scheduled','24:00',18);`));
});

test('the four statuses that carry no identifier are all storable', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  // A reminder can be waiting on permission, queued or failed without the OS ever
  // having issued an identifier — which is why the column is nullable.
  for (const [at, status] of ['not_requested', 'permission_required', 'queued', 'failed', 'cancelled'].entries()) {
    await seedReminder(database, `s${at}`, `0${at}:15`);
    await database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,status,updated_at) VALUES('s${at}','${status}',20);`);
  }
  assert.equal(await count(database, 'SELECT count(*) AS value FROM habit_reminder_schedules WHERE system_identifier IS NULL;'), 5);
  // A failure says why, and a reason that is only whitespace is not a reason.
  await seedReminder(database, 'why', '09:45');
  await database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,status,failure_reason,updated_at) VALUES('why','failed','the OS refused it',21);`);
  await seedReminder(database, 'blank', '09:50');
  await assert.rejects(database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,status,failure_reason,updated_at) VALUES('blank','failed','  ',21);`));
});

test('a projection cannot outlive the reminder it is about', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);
  await seedReminder(database, 'owned');
  await database.execAsync(`INSERT INTO habit_reminder_schedules(reminder_id,system_identifier,status,scheduled_for,failure_reason,updated_at)
    VALUES('owned','sys-9','scheduled','07:00',NULL,22);`);

  // `RESTRICT` both ways, like every other row that belongs to something: the delete
  // chain has to remove the projection itself rather than orphan it — which is the
  // failure PD-SUBTASK-005 found the last time a table arrived after that chain.
  await assert.rejects(database.execAsync(`DELETE FROM habit_reminders WHERE id='owned';`));
  await database.execAsync(`DELETE FROM habit_reminder_schedules WHERE reminder_id='owned';`);
  await database.execAsync(`DELETE FROM habit_reminders WHERE id='owned';`);
  assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
});
