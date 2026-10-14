import assert from 'node:assert/strict';
import test from 'node:test';

import { createCreateHabit } from '../../../src/features/planner/application';
import {
  FIXED_NOW,
  REMINDER_TIME,
  baseCommand,
  createHarness,
  plannerId,
  tableCount,
} from './test-fixtures';

const AGGREGATE_TABLES = [
  'habits',
  'habit_schedule_versions',
  'habit_tracking_versions',
  'habit_importance_versions',
  'habit_reminders',
] as const;

test('failure after the habit insert rolls back every aggregate row', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER force_failure_after_habit
    AFTER INSERT ON habits
    BEGIN
      SELECT RAISE(ABORT, 'forced-after-habit');
    END;
  `);
  const result = await harness.createHabit(baseCommand());
  assert.equal(result.ok, false);
  await assertAggregateCounts(harness.database, [0, 0, 0, 0, 0]);
});

test('failure after the schedule insert rolls back every earlier row', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER force_failure_after_schedule
    AFTER INSERT ON habit_schedule_versions
    BEGIN
      SELECT RAISE(ABORT, 'forced-after-schedule');
    END;
  `);
  const result = await harness.createHabit(baseCommand());
  assert.equal(result.ok, false);
  await assertAggregateCounts(harness.database, [0, 0, 0, 0, 0]);
});

test('failure before the optional reminder insert rolls back the aggregate', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER force_failure_before_reminder
    BEFORE INSERT ON habit_reminders
    BEGIN
      SELECT RAISE(ABORT, 'forced-before-reminder');
    END;
  `);
  const result = await harness.createHabit(
    baseCommand({
      reminder: {
        triggerLocalTime: REMINDER_TIME,
        timezoneMode: 'schedule_timezone',
        timezoneId: null,
      },
    }),
  );
  assert.equal(result.ok, false);
  await assertAggregateCounts(harness.database, [0, 0, 0, 0, 0]);
});

test('a SQLite uniqueness constraint cannot leave a partial second aggregate', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const first = await harness.createHabit(baseCommand({ name: 'First' }));
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const collidingIds = [
    plannerId(100),
    plannerId(101),
    first.value.scheduleVersion.id,
    plannerId(102),
    plannerId(103),
    plannerId(104),
  ];
  let index = 0;
  const createCollidingHabit = createCreateHabit({
    unitOfWork: harness.unitOfWork,
    idGenerator: { generateId: () => collidingIds[index++] },
    clock: { nowEpochMilliseconds: () => FIXED_NOW },
  });
  const failed = await createCollidingHabit(baseCommand({ name: 'Second' }));
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error.code, 'validation_conflict');
  const readback = await harness.unitOfWork.readInitialHabitAggregateById(
    plannerId(100),
  );
  assert.equal(readback.ok, true);
  if (readback.ok) assert.equal(readback.value, null);
  await assertAggregateCounts(harness.database, [1, 1, 1, 1, 0]);
});

test('transactional readback exposes aligned version-one configuration', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const created = await harness.createHabit(baseCommand({ name: 'Readback' }));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const readback = await harness.unitOfWork.readInitialHabitAggregateById(
    created.value.id,
  );
  assert.equal(readback.ok, true);
  if (!readback.ok || readback.value === null) return;
  assert.equal(readback.value.id, created.value.id);
  assert.equal(readback.value.scheduleVersion.versionNumber, 1);
  assert.equal(readback.value.trackingVersion.versionNumber, 1);
  assert.equal(readback.value.importanceVersion.versionNumber, 1);
  assert.deepEqual(
    readback.value.scheduleVersion.definition.effectiveRange,
    readback.value.activeRange,
  );
  assert.deepEqual(
    readback.value.trackingVersion.definition.effectiveRange,
    readback.value.activeRange,
  );
  assert.deepEqual(
    readback.value.importanceVersion.effectiveRange,
    readback.value.activeRange,
  );
});

test('malformed persisted discriminators become data_integrity_failure', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const created = await harness.createHabit(baseCommand());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await harness.database.execAsync('PRAGMA ignore_check_constraints = ON;');
  await harness.database.runAsync(
    `UPDATE habit_schedule_versions
     SET schedule_type = $scheduleType
     WHERE habit_id = $habitId;`,
    { $scheduleType: 'fortnightly', $habitId: created.value.id },
  );
  const readback = await harness.unitOfWork.readInitialHabitAggregateById(
    created.value.id,
  );
  assert.equal(readback.ok, false);
  if (!readback.ok) assert.equal(readback.error.code, 'data_integrity_failure');
});

test('ordered migration startup is idempotent and creates no aggregate tables', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  await harness.database.migrate();
  const version = await harness.database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version;',
  );
  assert.equal(version?.user_version, 15);
  const absentTables = await harness.database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND (name LIKE '%occurrence%' OR name LIKE '%progress%' OR name LIKE '%analytics%');`,
  );
  assert.deepEqual(absentTables, []);
});

test('CreateHabit inserts no dependencies, observations, or Daily Focus data', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const result = await harness.createHabit(baseCommand());
  assert.equal(result.ok, true);
  assert.equal(await tableCount(harness.database, 'habit_dependency_versions'), 0);
  assert.equal(await tableCount(harness.database, 'habit_observations'), 0);
  assert.equal(await tableCount(harness.database, 'daily_focus_entries'), 0);
  assert.equal(await tableCount(harness.database, 'daily_focus_items'), 0);
});

async function assertAggregateCounts(
  database: Parameters<typeof tableCount>[0],
  expected: readonly number[],
): Promise<void> {
  const actual = await Promise.all(
    AGGREGATE_TABLES.map((table) => tableCount(database, table)),
  );
  assert.deepEqual(actual, expected);
}
