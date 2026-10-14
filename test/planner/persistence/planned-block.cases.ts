import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlannerLocalTime } from '../../../src/features/planner/domain';
import { ACTIVE_FROM, baseCommand, createHarness, domainValue, scheduleFixture, trackingFixture, type TestHarness } from './test-fixtures';

const time = (value: string) => domainValue(parsePlannerLocalTime(value));

/**
 * An edit that changes nothing at all, so a case can change exactly one thing.
 *
 * Every field is what `baseCommand` writes; a test that wants to move the block sets the
 * block and nothing else, which is what makes «the block alone counts as a change»
 * assertable rather than incidental.
 */
const baseEdit = (habitId: string) => ({
  currentLocalDate: ACTIVE_FROM,
  description: null,
  effectiveLocalDate: ACTIVE_FROM,
  habitId,
  importance: 'normal' as const,
  name: 'Read',
  plannedLocalTime: null,
  schedule: scheduleFixture('daily'),
  tracking: trackingFixture('checkbox'),
});

/**
 * The block, from the command that states it to the day that draws it.
 *
 * **This file exists because of a trap the project has already fallen into once.** An
 * audit found five defects behind a green suite, and the shape of one was exactly this:
 * a value computed and then thrown away, with nothing asserting that it arrived. When
 * `plannedBlock` was first threaded through Create it type-checked, the whole suite
 * passed, and the value reached no column at all — every test here fails without the
 * wiring, which is the only thing that makes them worth having.
 */

async function dayRows(harness: TestHarness) {
  const day = await harness.getPlannerOccurrencesForDate({
    selectedLocalDate: ACTIVE_FROM,
    evaluationBoundary: ACTIVE_FROM,
  });
  assert.equal(day.ok, true, 'the day must load');
  if (!day.ok) assert.fail('Expected the day.');
  return day.value.rootGroups.flatMap((group) => group.rows);
}

test('a block stated at creation reaches the day it is drawn on', async (t) => {
  const harness = await createHarness(910_000);
  t.after(() => harness.database.close());

  const created = await harness.createHabit(baseCommand({ name: 'Gym', plannedBlock: 'evening' }));
  assert.equal(created.ok, true);
  if (!created.ok) assert.fail('Expected the item.');

  const rows = await dayRows(harness);
  const gym = rows.find((candidate) => candidate.habitId === created.value.id);
  assert.ok(gym, 'the item must be on the day');
  assert.equal(gym?.plannedBlock, 'evening', 'the block survives the round trip');
});

test('an item with no block reads back as having none, which is what Anytime is', async (t) => {
  const harness = await createHarness(920_000);
  t.after(() => harness.database.close());

  const created = await harness.createHabit(baseCommand({ name: 'Water' }));
  assert.equal(created.ok, true);
  if (!created.ok) assert.fail('Expected the item.');

  const rows = await dayRows(harness);
  const water = rows.find((candidate) => candidate.habitId === created.value.id);
  assert.equal(water?.plannedBlock, null, 'absence is a state, not missing data');
});

test('all three blocks are storable, and only those three', async (t) => {
  const harness = await createHarness(930_000);
  t.after(() => harness.database.close());

  const ids: Record<string, string> = {};
  for (const block of ['morning', 'day', 'evening']) {
    const created = await harness.createHabit(baseCommand({ name: `Item ${block}`, plannedBlock: block }));
    assert.equal(created.ok, true, `${block} must be storable`);
    if (created.ok) ids[block] = created.value.id;
  }

  const rows = await dayRows(harness);
  for (const block of ['morning', 'day', 'evening']) {
    const found = rows.find((candidate) => candidate.habitId === ids[block]);
    assert.equal(found?.plannedBlock, block);
  }

  for (const invalid of ['night', 'MORNING', 'утро', '']) {
    const refused = await harness.createHabit(baseCommand({ name: 'Bad', plannedBlock: invalid }));
    assert.equal(refused.ok, false, `«${invalid}» must be refused before it reaches the column`);
  }
});

test('the clock does not assign a block, and that is the whole point of storing one', async (t) => {
  const harness = await createHarness(940_000);
  t.after(() => harness.database.close());

  // A minute squarely inside what a surface would call morning, and no block chosen.
  const created = await harness.createHabit(baseCommand({ name: 'Stretch', plannedTime: time('07:00') }));
  assert.equal(created.ok, true);
  if (!created.ok) assert.fail('Expected the item.');

  const rows = await dayRows(harness);
  const stretch = rows.find((candidate) => candidate.habitId === created.value.id);
  assert.equal(stretch?.plannedLocalTime, '07:00');
  assert.equal(
    stretch?.plannedBlock,
    null,
    'a minute may suggest a block on screen, but nothing derives one behind the person',
  );
});

test('a block and an exact time coexist, because some things really do have one', async (t) => {
  const harness = await createHarness(950_000);
  t.after(() => harness.database.close());

  const created = await harness.createHabit(baseCommand({ name: 'Commute', plannedBlock: 'morning', plannedTime: time('08:40') }));
  assert.equal(created.ok, true);
  if (!created.ok) assert.fail('Expected the item.');

  const rows = await dayRows(harness);
  const commute = rows.find((candidate) => candidate.habitId === created.value.id);
  assert.equal(commute?.plannedBlock, 'morning');
  assert.equal(commute?.plannedLocalTime, '08:40', 'the train leaves when it leaves');
});

test('moving a thing to another part of the day is a change to when it is', async (t) => {
  const harness = await createHarness(960_000);
  t.after(() => harness.database.close());

  const created = await harness.createHabit(baseCommand({ name: 'Reading', plannedBlock: 'morning' }));
  assert.equal(created.ok, true);
  if (!created.ok) assert.fail('Expected the item.');

  // Nothing else moves — not the minute, not the length, not the name. **The block alone
  // has to count as a change**, or the edit reports «nothing changed», appends no version
  // and drops the move silently. That is the defect the length already had once.
  const moved = await harness.editHabit({
    ...baseEdit(created.value.id),
    plannedBlock: 'evening',
  });
  assert.equal(moved.ok, true, moved.ok ? '' : moved.error.message);
  if (!moved.ok) assert.fail('Expected the edit.');
  assert.notEqual(moved.value.outcome, 'no_change', 'moving it is a change');

  const rows = await dayRows(harness);
  const reading = rows.find((candidate) => candidate.habitId === created.value.id);
  assert.equal(reading?.plannedBlock, 'evening', 'and the move is what the day reads back');
});

test('an edit that changes nothing else does not lose the block it already had', async (t) => {
  const harness = await createHarness(970_000);
  t.after(() => harness.database.close());

  const created = await harness.createHabit(baseCommand({ name: 'Walk', plannedBlock: 'day' }));
  assert.equal(created.ok, true);
  if (!created.ok) assert.fail('Expected the item.');

  const renamed = await harness.editHabit({
    ...baseEdit(created.value.id),
    name: 'Long walk',
    plannedBlock: 'day',
  });
  assert.equal(renamed.ok, true, renamed.ok ? '' : renamed.error.message);

  const rows = await dayRows(harness);
  const walk = rows.find((candidate) => candidate.habitId === created.value.id);
  assert.equal(walk?.plannedBlock, 'day', 'a rename is not a reason to forget where it belongs');
});
