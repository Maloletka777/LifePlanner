import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLANNER_TASK_RETENTION_DAYS,
  createAddHabitChecklistLines,
  createRunPlannerMaintenance,
} from '../../../src/features/planner/application';
import { parsePlannerLocalDate, type PlannerLocalDate } from '../../../src/features/planner/domain';
import { FIXED_NOW, LONDON, baseCommand, createHarness, domainValue, scheduleFixture, trackingFixture, type TestHarness } from './test-fixtures';

const AUG_1 = date('2026-08-01');
const AUG_2 = date('2026-08-02');
const AUG_20 = date('2026-08-20');

function date(value: string): PlannerLocalDate {
  return domainValue(parsePlannerLocalDate(value));
}

function sweep(harness: TestHarness) {
  return createRunPlannerMaintenance({
    deleteHabit: (command) => harness.permanentlyDeleteHabit(command),
    unitOfWork: harness.unitOfWork,
  });
}

async function task(harness: TestHarness, name: string, due: PlannerLocalDate, until: PlannerLocalDate) {
  const created = await harness.createHabit(baseCommand({
    activeFrom: due,
    activeTo: until,
    name,
    schedule: scheduleFixture('daily', due, until),
    tracking: trackingFixture('checkbox', due, until),
  }));
  assert.equal(created.ok, true, `${name} fixture`);
  if (!created.ok) assert.fail('Expected the task fixture.');
  return created.value;
}

test('a subtask left over from the old model is removed, and habits are never swept', async (t) => {
  const harness = await createHarness(110_000);
  t.after(() => harness.database.close());
  // The old shape: a whole habit attached as an ordinary child.
  const parent = await harness.createHabit(baseCommand({ name: 'Cook dinner' }));
  const child = await harness.createHabit(baseCommand({ name: 'Buy food' }));
  assert.equal(parent.ok && child.ok, true);
  if (!parent.ok || !child.ok) return;
  assert.equal((await harness.changeOrdinaryParent({
    action: 'attach',
    childHabitId: child.value.id,
    effectiveLocalDate: AUG_1,
    parentHabitId: parent.value.id,
  })).ok, true);

  const report = await sweep(harness)({ boundaryTimezone: LONDON, today: AUG_2 });
  assert.equal(report.retiredSubtasks, 1);
  assert.equal(report.purgedTasks, 0);
  assert.equal(report.failures, 0);

  const left = await harness.database.getAllAsync<{ name: string }>('SELECT name FROM habits ORDER BY name;');
  // The item survives; only the row that expressed the old model goes.
  assert.deepEqual(left.map((row) => row.name), ['Cook dinner']);
});

test('a task a week past its day is removed whole, and a recent one is left alone', async (t) => {
  const harness = await createHarness(111_000);
  t.after(() => harness.database.close());
  await task(harness, 'Old errand', AUG_1, AUG_2);
  await task(harness, 'Recent errand', date('2026-08-19'), AUG_20);
  const habit = await harness.createHabit(baseCommand({ name: 'Vitamins' }));
  assert.equal(habit.ok, true);

  assert.equal(PLANNER_TASK_RETENTION_DAYS, 7);
  const report = await sweep(harness)({ boundaryTimezone: LONDON, today: AUG_20 });
  assert.equal(report.purgedTasks, 1);
  assert.equal(report.failures, 0);

  const left = await harness.database.getAllAsync<{ name: string }>('SELECT name FROM habits ORDER BY name;');
  // A habit is history and is never swept, however old it is.
  assert.deepEqual(left.map((row) => row.name), ['Recent errand', 'Vitamins']);
});

test('a purged task takes its subtasks and their ticks with it', async (t) => {
  const harness = await createHarness(112_000);
  t.after(() => harness.database.close());
  const errand = await task(harness, 'Old errand', AUG_1, AUG_2);
  const add = createAddHabitChecklistLines({
    clock: { nowEpochMilliseconds: () => FIXED_NOW },
    idGenerator: harness.idGenerator,
    unitOfWork: harness.unitOfWork,
  });
  const lines = await add({ habitId: errand.id, localDate: AUG_1, texts: ['Onions', 'Bread'] });
  assert.equal(lines.ok, true, JSON.stringify(lines));
  if (!lines.ok || lines.value[0] === undefined) return;
  await harness.unitOfWork.setHabitChecklistTick({
    checklistItemId: lines.value[0].id,
    done: true,
    doneAt: FIXED_NOW,
    occurrenceLocalDate: AUG_1,
  });

  const report = await sweep(harness)({ boundaryTimezone: LONDON, today: AUG_20 });
  assert.equal(report.purgedTasks, 1, JSON.stringify(report));

  // Nothing is left pointing at a task that no longer exists — a deletion that
  // left the lines behind would have been refused by the foreign key anyway.
  const items = await harness.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_checklist_items;');
  const ticks = await harness.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_checklist_ticks;');
  assert.equal(items?.count, 0);
  assert.equal(ticks?.count, 0);
  assert.deepEqual(await harness.database.getAllAsync('PRAGMA foreign_key_check;'), []);
});
