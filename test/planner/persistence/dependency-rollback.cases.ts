import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAddHabitDependency,
  type CreateAndLinkDependencyCommand,
} from '../../../src/features/planner/application';
import {
  ACTIVE_FROM,
  FIXED_NOW,
  REMINDER_TIME,
  baseCommand,
  createHarness,
  plannerId,
  scheduleFixture,
  tableCount,
  trackingFixture,
  type TestHarness,
} from './test-fixtures';

const DEPENDENCY_TABLES = [
  'habits',
  'habit_schedule_versions',
  'habit_tracking_versions',
  'habit_importance_versions',
  'habit_reminders',
  'habit_dependency_versions',
] as const;

test('failure after the new dependent habit insert rolls back all dependent rows', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parentId = await createRoot(harness);
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER fail_after_dependent_habit
    AFTER INSERT ON habits
    WHEN NEW.name = 'Dependent'
    BEGIN
      SELECT RAISE(ABORT, 'forced-after-dependent-habit');
    END;
  `);
  const result = await harness.addHabitDependency(newCommand(parentId));
  assert.equal(result.ok, false);
  await assertCounts(harness, [1, 1, 1, 1, 0, 0]);
});

test('failure after dependent tracking insert rolls back the dependent habit', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parentId = await createRoot(harness);
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER fail_after_dependent_tracking
    AFTER INSERT ON habit_tracking_versions
    WHEN (SELECT name FROM habits WHERE id = NEW.habit_id) = 'Dependent'
    BEGIN
      SELECT RAISE(ABORT, 'forced-after-dependent-tracking');
    END;
  `);
  assert.equal((await harness.addHabitDependency(newCommand(parentId))).ok, false);
  await assertCounts(harness, [1, 1, 1, 1, 0, 0]);
});

test('failure after dependent importance insert rolls back prior dependent rows', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parentId = await createRoot(harness);
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER fail_after_dependent_importance
    AFTER INSERT ON habit_importance_versions
    WHEN (SELECT name FROM habits WHERE id = NEW.habit_id) = 'Dependent'
    BEGIN
      SELECT RAISE(ABORT, 'forced-after-dependent-importance');
    END;
  `);
  assert.equal((await harness.addHabitDependency(newCommand(parentId))).ok, false);
  await assertCounts(harness, [1, 1, 1, 1, 0, 0]);
});

test('failure after dependent reminder insert rolls back the full dependent aggregate', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parentId = await createRoot(harness);
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER fail_after_dependent_reminder
    AFTER INSERT ON habit_reminders
    BEGIN
      SELECT RAISE(ABORT, 'forced-after-dependent-reminder');
    END;
  `);
  const command = newCommand(parentId, true);
  assert.equal((await harness.addHabitDependency(command)).ok, false);
  await assertCounts(harness, [1, 1, 1, 1, 0, 0]);
});

test('failure immediately before relationship insert leaves no dependent rows', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parentId = await createRoot(harness);
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER fail_before_dependency
    BEFORE INSERT ON habit_dependency_versions
    BEGIN
      SELECT RAISE(ABORT, 'forced-before-dependency');
    END;
  `);
  assert.equal((await harness.addHabitDependency(newCommand(parentId))).ok, false);
  await assertCounts(harness, [1, 1, 1, 1, 0, 0]);
});

test('relationship primary-key constraint failure rolls back a newly created dependent', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parentId = await createRoot(harness, 'Parent');
  const existingDependentId = await createRoot(harness, 'Existing dependent');
  const first = await harness.addHabitDependency({
    dependentSource: 'existing',
    parentHabitId: parentId,
    dependentHabitId: existingDependentId,
    dependencyType: 'follow_up',
    effectiveFrom: ACTIVE_FROM,
    effectiveTo: null,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const generated = [
    plannerId(8001),
    plannerId(8002),
    plannerId(8003),
    plannerId(8004),
    first.value.relationship.id,
  ];
  let index = 0;
  const addWithCollision = createAddHabitDependency({
    unitOfWork: harness.unitOfWork,
    idGenerator: { generateId: () => generated[index++] },
    clock: { nowEpochMilliseconds: () => FIXED_NOW },
  });
  const failed = await addWithCollision(newCommand(parentId));
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.error.code, 'dependency_data_integrity_failure');
  }
  await assertCounts(harness, [2, 2, 2, 2, 0, 1]);
});

test('transactional readback integrity failure prevents commit', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parentId = await createRoot(harness);
  await harness.database.execAsync(`
    CREATE TEMP TRIGGER remove_dependency_before_readback
    AFTER INSERT ON habit_dependency_versions
    BEGIN
      DELETE FROM habit_dependency_versions WHERE id = NEW.id;
    END;
  `);
  const result = await harness.addHabitDependency(newCommand(parentId));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'dependency_data_integrity_failure');
  }
  await assertCounts(harness, [1, 1, 1, 1, 0, 0]);
});

async function createRoot(
  harness: TestHarness,
  name = 'Parent',
) {
  const result = await harness.createHabit(
    baseCommand({
      name,
      activeTo: null,
      schedule: scheduleFixture('daily', ACTIVE_FROM, null),
      tracking: trackingFixture('checkbox', ACTIVE_FROM, null),
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('Expected root creation to succeed.');
  return result.value.id;
}

function newCommand(
  parentHabitId: ReturnType<typeof plannerId>,
  includeReminder = false,
): CreateAndLinkDependencyCommand {
  return {
    dependentSource: 'new',
    parentHabitId,
    dependencyType: 'follow_up',
    effectiveFrom: ACTIVE_FROM,
    effectiveTo: null,
    dependent: {
      name: 'Dependent',
      description: null,
      categoryId: null,
      tracking: trackingFixture('checkbox', ACTIVE_FROM, null),
      importance: 'normal',
      reminder: includeReminder
        ? {
            triggerLocalTime: REMINDER_TIME,
            timezoneMode: 'schedule_timezone',
            timezoneId: null,
          }
        : null,
    },
  };
}

async function assertCounts(
  harness: TestHarness,
  expected: readonly number[],
): Promise<void> {
  const actual = await Promise.all(
    DEPENDENCY_TABLES.map((table) => tableCount(harness.database, table)),
  );
  assert.deepEqual(actual, expected);
}
