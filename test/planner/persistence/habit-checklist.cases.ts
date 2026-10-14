import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAddHabitChecklistLines,
  createGetHabitChecklists,
  createGetHabitClosureRules,
  createSetHabitClosureRule,
  createRemoveHabitChecklistLine,
  createSetHabitChecklistLineDone,
} from '../../../src/features/planner/application';
import { parsePlannerLocalDate, type PlannerLocalDate } from '../../../src/features/planner/domain';
import { ACTIVE_FROM, FIXED_NOW, baseCommand, createHarness, domainValue, type TestHarness } from './test-fixtures';

const DAY_ONE = date('2026-08-03');
const DAY_TWO = date('2026-08-04');

function date(value: string): PlannerLocalDate {
  return domainValue(parsePlannerLocalDate(value));
}

function commands(harness: TestHarness) {
  const dependencies = {
    clock: { nowEpochMilliseconds: () => FIXED_NOW },
    idGenerator: harness.idGenerator,
    unitOfWork: harness.unitOfWork,
  };
  return {
    add: createAddHabitChecklistLines(dependencies),
    get: createGetHabitChecklists(dependencies),
    remove: createRemoveHabitChecklistLine(dependencies),
    rules: createGetHabitClosureRules(dependencies),
    setRule: createSetHabitClosureRule(dependencies),
    tick: createSetHabitChecklistLineDone(dependencies),
  };
}

async function item(harness: TestHarness, name: string) {
  const created = await harness.createHabit(baseCommand({ name }));
  assert.equal(created.ok, true, `${name} fixture`);
  if (!created.ok) assert.fail('Expected the item fixture.');
  return created.value;
}

test('a subtask is a line with a tick per day, and yesterday keeps its own answer', async (t) => {
  const harness = await createHarness(95_000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  const { add, get, tick } = commands(harness);

  const added = await add({ habitId: gym.id, localDate: ACTIVE_FROM, texts: ['Warm up', 'Stretch'] });
  assert.equal(added.ok, true, JSON.stringify(added));
  if (!added.ok) return;
  assert.deepEqual(added.value.map((line) => line.text), ['Warm up', 'Stretch']);

  const warmUp = added.value[0];
  assert.notEqual(warmUp, undefined);
  if (warmUp === undefined) return;

  const ticked = await tick({
    closesByChecklist: true,
    checklistItemId: warmUp.id,
    closeItem: async () => ({ ok: true as const, value: null }),
    done: true,
    habitId: gym.id,
    itemIsClosed: false,
    localDate: DAY_ONE,
    reopenItem: async () => ({ ok: true as const, value: null }),
  });
  assert.equal(ticked.ok, true, JSON.stringify(ticked));

  // **The day that was ticked keeps it; the next day starts clean.** This is the
  // whole reason the tick moved off the line and onto the day.
  const first = await get({ habitIds: [gym.id], localDate: DAY_ONE });
  const second = await get({ habitIds: [gym.id], localDate: DAY_TWO });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value.get(gym.id)?.map((line) => [line.text, line.done]), [['Warm up', true], ['Stretch', false]]);
  assert.deepEqual(second.value.get(gym.id)?.map((line) => [line.text, line.done]), [['Warm up', false], ['Stretch', false]]);
});

test('a subtask writes no observation, which is what keeps it out of every figure', async (t) => {
  const harness = await createHarness(96_000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  const { add, tick } = commands(harness);
  const added = await add({ habitId: gym.id, localDate: ACTIVE_FROM, texts: ['Warm up'] });
  assert.equal(added.ok, true);
  if (!added.ok || added.value[0] === undefined) return;

  await tick({
    closesByChecklist: true,
    checklistItemId: added.value[0].id,
    // The item is *not* closed here, so nothing canonical is written at all.
    closeItem: async () => ({ ok: false as const, error: 'the test would fail if this ran' }),
    done: true,
    habitId: gym.id,
    itemIsClosed: true,
    localDate: DAY_ONE,
    reopenItem: async () => ({ ok: true as const, value: null }),
  });

  const observations = await harness.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_observations;');
  assert.equal(observations?.count, 0, 'there is nothing here for Overview, history or a streak to read');
});

test('an item closed by hand is never closed by its lines', async (t) => {
  // **The two shapes are separate and neither is half of the other.** Closing an item
  // from its lines *and* leaving it a checkbox produced the state the owner reported:
  // the last tick closed the item, and unticking the item left every line ticked, with
  // nothing able to say which was true.
  const harness = await createHarness(101_500);
  t.after(() => harness.database.close());
  const shop = await item(harness, 'Shop');
  const { add, tick, rules, setRule } = commands(harness);
  const added = await add({ habitId: shop.id, localDate: DAY_ONE, texts: ['Onions'] });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  // **Absence is the default and the default is by hand**, so an item written before
  // Migration 011 reads back exactly as it behaved.
  const before = await rules({ habitIds: [shop.id] });
  assert.equal(before.ok && before.value.get(shop.id), undefined);

  let closed = 0;
  const result = await tick({
    checklistItemId: added.value[0].id,
    closeItem: async () => { closed += 1; return { ok: true as const, value: null }; },
    closesByChecklist: false,
    done: true,
    habitId: shop.id,
    itemIsClosed: false,
    localDate: DAY_ONE,
    reopenItem: async () => ({ ok: true as const, value: null }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.closedTheItem, false, 'the item is the person’s to close');
  assert.equal(closed, 0);
  // And the tick itself is written either way: a line is still a line.
  assert.equal(result.ok && result.value.lines.every((line) => line.done), true);

  // Choosing the other shape stores a row; choosing back removes it, so absence never
  // stops meaning exactly one thing.
  assert.equal((await setRule({ closesByChecklist: true, habitId: shop.id })).ok, true);
  const after = await rules({ habitIds: [shop.id] });
  assert.equal(after.ok && after.value.get(shop.id), true);
  assert.equal((await setRule({ closesByChecklist: false, habitId: shop.id })).ok, true);
  const cleared = await rules({ habitIds: [shop.id] });
  assert.equal(cleared.ok && cleared.value.get(shop.id), undefined);
});

test('the last line closes the item, and reopening one opens it again', async (t) => {
  const harness = await createHarness(97_000);
  t.after(() => harness.database.close());
  const shop = await item(harness, 'Go shopping');
  const { add, tick } = commands(harness);
  const added = await add({ habitId: shop.id, localDate: ACTIVE_FROM, texts: ['Onions', 'Bread'] });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const [onions, bread] = added.value;
  if (onions === undefined || bread === undefined) return;

  let closed = 0;
  let reopened = 0;
  const closeItem = async () => { closed += 1; return { ok: true as const, value: null }; };
  const reopenItem = async () => { reopened += 1; return { ok: true as const, value: null }; };

  // One of two: nothing happens to the item yet.
  const first = await tick({ closesByChecklist: true, checklistItemId: onions.id, closeItem, done: true, habitId: shop.id, itemIsClosed: false, localDate: DAY_ONE, reopenItem });
  assert.equal(first.ok && first.value.closedTheItem, false);
  assert.equal(closed, 0);

  // The last one closes it.
  const second = await tick({ closesByChecklist: true, checklistItemId: bread.id, closeItem, done: true, habitId: shop.id, itemIsClosed: false, localDate: DAY_ONE, reopenItem });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.value.closedTheItem, true);
  assert.equal(closed, 1);

  // And unticking one opens it again, because the item's own state is never
  // allowed to disagree with the lines that closed it.
  const third = await tick({ closesByChecklist: true, checklistItemId: bread.id, closeItem, done: false, habitId: shop.id, itemIsClosed: true, localDate: DAY_ONE, reopenItem });
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.equal(third.value.reopenedTheItem, true);
  assert.equal(reopened, 1);
  assert.equal(closed, 1, 'and it is not closed twice for the same day');
});

test('a line added today does not appear on a day that has already gone', async (t) => {
  const harness = await createHarness(98_000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  const { add, get } = commands(harness);
  const added = await add({ habitId: gym.id, localDate: DAY_TWO, texts: ['Stretch'] });
  assert.equal(added.ok, true);

  const before = await get({ habitIds: [gym.id], localDate: DAY_ONE });
  const after = await get({ habitIds: [gym.id], localDate: DAY_TWO });
  assert.equal(before.ok && after.ok, true);
  if (!before.ok || !after.ok) return;
  // Without a first day, a line written now would stand unticked on every day
  // that is over and make each of them read as unfinished.
  assert.equal(before.value.get(gym.id), undefined);
  assert.deepEqual(after.value.get(gym.id)?.map((line) => line.text), ['Stretch']);
});

test('removing a line ends it from that day, and leaves the days before it alone', async (t) => {
  const harness = await createHarness(99_000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  const { add, get, remove, tick } = commands(harness);
  const added = await add({ habitId: gym.id, localDate: ACTIVE_FROM, texts: ['Warm up'] });
  assert.equal(added.ok, true);
  if (!added.ok || added.value[0] === undefined) return;
  const line = added.value[0];
  await tick({
    closesByChecklist: true,
    checklistItemId: line.id,
    closeItem: async () => ({ ok: true as const, value: null }),
    done: true,
    habitId: gym.id,
    itemIsClosed: true,
    localDate: DAY_ONE,
    reopenItem: async () => ({ ok: true as const, value: null }),
  });

  const removed = await remove({ checklistItemId: line.id, localDate: DAY_TWO });
  assert.equal(removed.ok, true, JSON.stringify(removed));

  const before = await get({ habitIds: [gym.id], localDate: DAY_ONE });
  const after = await get({ habitIds: [gym.id], localDate: DAY_TWO });
  assert.equal(before.ok && after.ok, true);
  if (!before.ok || !after.ok) return;
  // A day that has happened is never rewritten by something decided later.
  assert.deepEqual(before.value.get(gym.id)?.map((entry) => [entry.text, entry.done]), [['Warm up', true]]);
  assert.equal(after.value.get(gym.id), undefined);
});

test('a subtask cannot be ticked for a day it did not exist on', async (t) => {
  const harness = await createHarness(100_000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  const { add, tick } = commands(harness);
  const added = await add({ habitId: gym.id, localDate: DAY_TWO, texts: ['Stretch'] });
  assert.equal(added.ok, true);
  if (!added.ok || added.value[0] === undefined) return;

  const refused = await tick({
    closesByChecklist: true,
    checklistItemId: added.value[0].id,
    closeItem: async () => ({ ok: true as const, value: null }),
    done: true,
    habitId: gym.id,
    itemIsClosed: false,
    localDate: DAY_ONE,
    reopenItem: async () => ({ ok: true as const, value: null }),
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error.code, 'checklist_unavailable');
});
