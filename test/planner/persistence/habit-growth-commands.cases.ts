import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGetGrowingRoutines,
  createGetRoutineGrowthHistory,
  createSetRoutineGrowthDetails,
  createStartGrowingRoutine,
  createStopGrowingRoutine,
} from '../../../src/features/planner/application';
import { PLANNER_MAX_GROWING_ROUTINES } from '../../../src/features/planner/domain/values/day-block';
import { FIXED_NOW, baseCommand, createHarness, type TestHarness } from './test-fixtures';

function commands(harness: TestHarness) {
  const dependencies = {
    clock: { nowEpochMilliseconds: () => FIXED_NOW },
    idGenerator: harness.idGenerator,
    unitOfWork: harness.unitOfWork,
  };
  return {
    growing: createGetGrowingRoutines(dependencies),
    history: createGetRoutineGrowthHistory(dependencies),
    setDetails: createSetRoutineGrowthDetails(dependencies),
    start: createStartGrowingRoutine(dependencies),
    stop: createStopGrowingRoutine(dependencies),
  };
}

async function item(harness: TestHarness, name: string): Promise<string> {
  const created = await harness.createHabit(baseCommand({ name }));
  assert.equal(created.ok, true, `${name} fixture`);
  if (!created.ok) assert.fail(`Expected the ${name} fixture.`);
  return created.value.id;
}

test('three routines may be grown at once, and the fourth is refused by the command', async (t) => {
  const harness = await createHarness(810_000);
  t.after(() => harness.database.close());
  const { growing, start } = commands(harness);

  for (const name of ['Gym', 'English', 'Reading']) {
    const habitId = await item(harness, name);
    const started = await start({ habitId, trackedFrom: '2026-08-04' });
    assert.equal(started.ok, true, `${name} must be takeable on`);
  }

  const fourth = await item(harness, 'Walking');
  const refused = await start({ habitId: fourth, trackedFrom: '2026-08-04' });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.error.code, 'too_many_routines');
    assert.match(refused.error.message, new RegExp(String(PLANNER_MAX_GROWING_ROUTINES)));
  }

  const open = await growing();
  assert.equal(open.ok, true);
  if (open.ok) assert.equal(open.value.length, PLANNER_MAX_GROWING_ROUTINES);
});

test('putting one down frees the slot, and the freed slot is countable', async (t) => {
  const harness = await createHarness(820_000);
  t.after(() => harness.database.close());
  const { growing, start, stop } = commands(harness);

  const ids: string[] = [];
  for (const name of ['Gym', 'English', 'Reading']) {
    const habitId = await item(harness, name);
    ids.push(habitId);
    await start({ habitId, trackedFrom: '2026-08-04' });
  }
  const fourth = await item(harness, 'Walking');
  assert.equal((await start({ habitId: fourth, trackedFrom: '2026-08-04' })).ok, false);

  const stopped = await stop({ habitId: ids[0] ?? '', stoppedFrom: '2026-08-20' });
  assert.equal(stopped.ok, true);
  if (stopped.ok) assert.equal(stopped.value, true);

  const taken = await start({ habitId: fourth, trackedFrom: '2026-08-21' });
  assert.equal(taken.ok, true, 'the slot the stopped routine held is now free');

  const open = await growing();
  if (open.ok) assert.equal(open.value.length, 3);
});

test('the same routine cannot be taken on twice, and that is a different refusal', async (t) => {
  const harness = await createHarness(830_000);
  t.after(() => harness.database.close());
  const { start } = commands(harness);
  const gym = await item(harness, 'Gym');

  assert.equal((await start({ habitId: gym, trackedFrom: '2026-08-04' })).ok, true);
  const again = await start({ habitId: gym, trackedFrom: '2026-08-05' });

  assert.equal(again.ok, false);
  // Distinguished from the cap on purpose: «you already grow this» and «you grow three
  // already» need different sentences on screen, so they need different codes here.
  if (!again.ok) assert.equal(again.error.code, 'already_growing');
});

test('the two answers are validated, and refusing to answer is not an error', async (t) => {
  const harness = await createHarness(840_000);
  t.after(() => harness.database.close());
  const { history, start } = commands(harness);
  const gym = await item(harness, 'Gym');

  for (const enjoyment of ['maybe', 'YES', '']) {
    const refused = await start({ enjoyment, habitId: gym, trackedFrom: '2026-08-04' });
    assert.equal(refused.ok, false, `«${enjoyment}» is not one of the three answers`);
    if (!refused.ok) assert.equal(refused.error.code, 'invalid_input');
  }
  const emptyCue = await start({ cue: '   ', habitId: gym, trackedFrom: '2026-08-04' });
  assert.equal(emptyCue.ok, false);
  const badDate = await start({ habitId: gym, trackedFrom: 'soon' });
  assert.equal(badDate.ok, false);

  // Silence is allowed: an attempt is valid before either question is answered.
  const quiet = await start({ habitId: gym, trackedFrom: '2026-08-04' });
  assert.equal(quiet.ok, true);
  if (quiet.ok) {
    assert.equal(quiet.value.cue, null);
    assert.equal(quiet.value.enjoyment, null);
  }

  const loaded = await history({ habitIds: [gym] });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal((loaded.value.get(gym) ?? []).length, 1, 'the four refusals wrote nothing');
});

test('the cue is trimmed on the way in, and clearing it is expressible', async (t) => {
  const harness = await createHarness(850_000);
  t.after(() => harness.database.close());
  const { history, setDetails, start } = commands(harness);
  const gym = await item(harness, 'Gym');
  await start({ cue: '  после ужина  ', enjoyment: 'yes', habitId: gym, trackedFrom: '2026-08-04' });

  const first = await history({ habitIds: [gym] });
  if (first.ok) assert.equal((first.value.get(gym) ?? [])[0]?.cue, 'после ужина');

  // Both fields stated in full: an absent key would make «leave it» and «clear it» the
  // same request, and clearing a cue is something a person may want.
  const cleared = await setDetails({ cue: null, enjoyment: null, habitId: gym });
  assert.equal(cleared.ok, true);
  const second = await history({ habitIds: [gym] });
  if (second.ok) {
    assert.equal((second.value.get(gym) ?? [])[0]?.cue, null);
    assert.equal((second.value.get(gym) ?? [])[0]?.enjoyment, null);
  }
});

test('putting down what is not being grown is nothing, not a failure', async (t) => {
  const harness = await createHarness(860_000);
  t.after(() => harness.database.close());
  const { stop } = commands(harness);
  const gym = await item(harness, 'Gym');

  const stopped = await stop({ habitId: gym, stoppedFrom: '2026-08-20' });
  assert.equal(stopped.ok, true, 'a command that threw here would make every caller check first');
  if (stopped.ok) assert.equal(stopped.value, false);
});

test('a routine taken up again starts from its own day, and the first attempt is still readable', async (t) => {
  const harness = await createHarness(870_000);
  t.after(() => harness.database.close());
  const { history, start, stop } = commands(harness);
  const gym = await item(harness, 'Gym');

  await start({ cue: 'после завтрака', habitId: gym, trackedFrom: '2026-02-01' });
  await stop({ habitId: gym, stoppedFrom: '2026-03-15' });
  const second = await start({ cue: 'после ужина', habitId: gym, trackedFrom: '2026-08-04' });

  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.value.attemptNumber, 2);

  const loaded = await history({ habitIds: [gym] });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    const attempts = loaded.value.get(gym) ?? [];
    assert.equal(attempts.length, 2, 'written on top of the first, not over it');
    assert.deepEqual(attempts.map((attempt) => attempt.cue), ['после завтрака', 'после ужина']);
  }
});
