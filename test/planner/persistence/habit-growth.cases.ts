import assert from 'node:assert/strict';
import test from 'node:test';

import { FIXED_NOW, baseCommand, createHarness, type TestHarness } from './test-fixtures';

/**
 * The second floor against a real database.
 *
 * Everything here goes through the unit of work rather than raw SQL, because what is
 * being asserted is the contract a caller sees — including the two properties the whole
 * design rests on: an attempt is a period rather than a flag, and nothing on this floor
 * writes an observation.
 */

async function item(harness: TestHarness, name: string): Promise<string> {
  const created = await harness.createHabit(baseCommand({ name }));
  assert.equal(created.ok, true, `${name} fixture`);
  if (!created.ok) assert.fail(`Expected the ${name} fixture.`);
  return created.value.id;
}

test('taking a routine on records an attempt, and taking it on twice is refused', async (t) => {
  const harness = await createHarness(701000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');

  const started = await harness.unitOfWork.startHabitGrowth({
    createdAt: FIXED_NOW, cue: 'после ужина', enjoyment: 'yes', habitId: gym, id: 'growth-1', trackedFrom: '2026-08-04',
  });
  assert.equal(started.ok, true);
  if (started.ok) {
    assert.equal(started.value.attemptNumber, 1);
    assert.equal(started.value.stoppedFrom, null);
    assert.equal(started.value.cue, 'после ужина');
  }

  const again = await harness.unitOfWork.startHabitGrowth({
    createdAt: FIXED_NOW, cue: null, enjoyment: null, habitId: gym, id: 'growth-2', trackedFrom: '2026-08-05',
  });
  assert.equal(again.ok, false, 'a routine already being grown cannot be taken on a second time');
});

test('putting a routine down closes the attempt and leaves it in the record', async (t) => {
  const harness = await createHarness(702000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  await harness.unitOfWork.startHabitGrowth({
    createdAt: FIXED_NOW, cue: null, enjoyment: null, habitId: gym, id: 'growth-1', trackedFrom: '2026-02-01',
  });

  const stopped = await harness.unitOfWork.stopHabitGrowth({ habitId: gym, stoppedFrom: '2026-03-15', updatedAt: FIXED_NOW });
  assert.equal(stopped.ok, true);
  if (stopped.ok) assert.equal(stopped.value, true);

  // The row is closed, not deleted: the six weeks it covered stay covered.
  const loaded = await harness.unitOfWork.loadHabitGrowth([gym]);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    const attempts = loaded.value.get(gym) ?? [];
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.trackedFrom, '2026-02-01');
    assert.equal(attempts[0]?.stoppedFrom, '2026-03-15');
  }

  // Putting down what is not being grown is not an error, it is simply nothing.
  const nothing = await harness.unitOfWork.stopHabitGrowth({ habitId: gym, stoppedFrom: '2026-04-01', updatedAt: FIXED_NOW });
  assert.equal(nothing.ok, true);
  if (nothing.ok) assert.equal(nothing.value, false);
});

test('taking the same routine up again is a second attempt, and the first is still there', async (t) => {
  const harness = await createHarness(703000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');

  await harness.unitOfWork.startHabitGrowth({ createdAt: FIXED_NOW, cue: null, enjoyment: null, habitId: gym, id: 'g1', trackedFrom: '2026-02-01' });
  await harness.unitOfWork.stopHabitGrowth({ habitId: gym, stoppedFrom: '2026-03-15', updatedAt: FIXED_NOW });
  const second = await harness.unitOfWork.startHabitGrowth({ createdAt: FIXED_NOW, cue: 'после ужина', enjoyment: 'tolerated', habitId: gym, id: 'g2', trackedFrom: '2026-08-04' });

  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.value.attemptNumber, 2, 'the number is derived from what is there, not passed in');

  // Data written on top of old data rather than over it: two rows, two stories, and the
  // August attempt starts from its own zero.
  const loaded = await harness.unitOfWork.loadHabitGrowth([gym]);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    const attempts = loaded.value.get(gym) ?? [];
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map((attempt) => attempt.trackedFrom), ['2026-02-01', '2026-08-04']);
    assert.deepEqual(attempts.map((attempt) => attempt.stoppedFrom), ['2026-03-15', null]);
    assert.deepEqual(attempts.map((attempt) => attempt.cue), [null, 'после ужина']);
  }
});

test('an attempt cannot be closed before the day it began', async (t) => {
  const harness = await createHarness(704000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  await harness.unitOfWork.startHabitGrowth({ createdAt: FIXED_NOW, cue: null, enjoyment: null, habitId: gym, id: 'g1', trackedFrom: '2026-08-04' });

  for (const stoppedFrom of ['2026-08-01', '2026-08-04']) {
    const stopped = await harness.unitOfWork.stopHabitGrowth({ habitId: gym, stoppedFrom, updatedAt: FIXED_NOW });
    assert.equal(stopped.ok, false, `stopping on ${stoppedFrom} must be refused`);
  }
});

test('the cue and the enjoyment belong to the open attempt, and a closed one is left alone', async (t) => {
  const harness = await createHarness(705000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  await harness.unitOfWork.startHabitGrowth({ createdAt: FIXED_NOW, cue: 'после завтрака', enjoyment: 'no', habitId: gym, id: 'g1', trackedFrom: '2026-02-01' });
  await harness.unitOfWork.stopHabitGrowth({ habitId: gym, stoppedFrom: '2026-03-15', updatedAt: FIXED_NOW });
  await harness.unitOfWork.startHabitGrowth({ createdAt: FIXED_NOW, cue: null, enjoyment: null, habitId: gym, id: 'g2', trackedFrom: '2026-08-04' });

  const set = await harness.unitOfWork.setHabitGrowthDetails({ cue: 'после ужина', enjoyment: 'yes', habitId: gym, updatedAt: FIXED_NOW });
  assert.equal(set.ok, true);

  const loaded = await harness.unitOfWork.loadHabitGrowth([gym]);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    const attempts = loaded.value.get(gym) ?? [];
    // The February attempt keeps what February said. Rewriting a closed row would be
    // editing a story that is over.
    assert.equal(attempts[0]?.cue, 'после завтрака');
    assert.equal(attempts[0]?.enjoyment, 'no');
    assert.equal(attempts[1]?.cue, 'после ужина');
    assert.equal(attempts[1]?.enjoyment, 'yes');
  }

  // Both are stated in full rather than merged, so clearing one is expressible.
  await harness.unitOfWork.setHabitGrowthDetails({ cue: null, enjoyment: null, habitId: gym, updatedAt: FIXED_NOW });
  const cleared = await harness.unitOfWork.loadHabitGrowth([gym]);
  if (cleared.ok) assert.equal((cleared.value.get(gym) ?? [])[1]?.cue, null);
});

test('the open attempts are what the Growing surface lists, and the cap is not enforced here', async (t) => {
  const harness = await createHarness(706000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');
  const english = await item(harness, 'English');
  const reading = await item(harness, 'Reading');
  const walking = await item(harness, 'Walking');

  for (const [index, habitId] of [gym, english, reading, walking].entries()) {
    await harness.unitOfWork.startHabitGrowth({ createdAt: FIXED_NOW, cue: null, enjoyment: null, habitId, id: `g${index}`, trackedFrom: `2026-08-0${index + 1}` });
  }
  await harness.unitOfWork.stopHabitGrowth({ habitId: walking, stoppedFrom: '2026-08-20', updatedAt: FIXED_NOW });

  const open = await harness.unitOfWork.loadOpenHabitGrowth();
  assert.equal(open.ok, true);
  if (open.ok) {
    assert.equal(open.value.length, 3, 'the closed one is not listed');
    assert.deepEqual(open.value.map((attempt) => attempt.trackedFrom), ['2026-08-01', '2026-08-02', '2026-08-03']);
  }

});

test('growing a routine writes no observation, so it can never reach a figure', async (t) => {
  const harness = await createHarness(707000);
  t.after(() => harness.database.close());
  const gym = await item(harness, 'Gym');

  const observations = async () =>
    (await harness.database.getFirstAsync<{ value: number }>('SELECT count(*) AS value FROM habit_observations;'))?.value;
  const ticks = async () =>
    (await harness.database.getFirstAsync<{ value: number }>('SELECT count(*) AS value FROM habit_checklist_ticks;'))?.value;

  const observationsBefore = await observations();
  const ticksBefore = await ticks();

  await harness.unitOfWork.startHabitGrowth({ createdAt: FIXED_NOW, cue: 'после ужина', enjoyment: 'yes', habitId: gym, id: 'g1', trackedFrom: '2026-08-04' });
  await harness.unitOfWork.setHabitGrowthDetails({ cue: 'после душа', enjoyment: 'tolerated', habitId: gym, updatedAt: FIXED_NOW });
  await harness.unitOfWork.stopHabitGrowth({ habitId: gym, stoppedFrom: '2026-09-01', updatedAt: FIXED_NOW });

  // Three writes to the second floor, and the day's own record is untouched. This is the
  // separation the whole design rests on, asserted where it can actually be seen.
  assert.equal(await observations(), observationsBefore, 'growing a routine is not a fact about a day');
  assert.equal(await ticks(), ticksBefore);
});

test('a routine that does not exist cannot be grown', async (t) => {
  const harness = await createHarness(708000);
  t.after(() => harness.database.close());

  const started = await harness.unitOfWork.startHabitGrowth({
    createdAt: FIXED_NOW, cue: null, enjoyment: null, habitId: 'nobody', id: 'g1', trackedFrom: '2026-08-04',
  });
  assert.equal(started.ok, false);
});
