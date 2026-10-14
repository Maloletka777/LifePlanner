import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AWARD_AGE_MILESTONES,
  LADDER_END_MEANS_HABIT_FORMED,
  routineAwards,
  routineHeadlineAxis,
} from '../../../src/features/planner/application/growth/routine-awards-model';
import {
  routineGrowthStatus,
  routinesNeedingAttention,
  type RoutineGrowthOccurrence,
} from '../../../src/features/planner/application/growth/routine-growth-model';
import { addPlannerCalendarDays, parsePlannerLocalDate, type PlannerLocalDate } from '../../../src/features/planner/domain';

const START = date('2026-01-05');

function date(value: string): PlannerLocalDate {
  const parsed = parsePlannerLocalDate(value);
  if (!parsed.ok) throw new Error(`bad fixture date ${value}`);
  return parsed.value;
}

function shift(days: number): PlannerLocalDate {
  const moved = addPlannerCalendarDays(START, days);
  if (!moved.ok) throw new Error('bad fixture offset');
  return moved.value;
}

function daily(pattern: readonly boolean[]): readonly RoutineGrowthOccurrence[] {
  return pattern.map((closed, index) => Object.freeze({ closed, date: shift(index) }));
}

function statusOf(pattern: readonly boolean[]) {
  return routineGrowthStatus({ asOf: shift(pattern.length - 1), occurrences: daily(pattern), trackedFrom: START });
}

function awardsOf(pattern: readonly boolean[], options: Partial<{ dayOffset: number; accepted: number }> = {}) {
  return routineAwards({
    acceptedSuggestionsThatHeld: options.accepted ?? 0,
    asOf: shift(options.dayOffset ?? pattern.length - 1),
    status: statusOf(pattern),
    trackedFrom: START,
  });
}

test('a break costs the current stretch and not one earned medal', () => {
  const thirtyDays = Array.from({ length: 30 }, () => true);
  const before = awardsOf(thirtyDays);
  const after = awardsOf([...thirtyDays, false, false, false]);

  const continuityBefore = before.filter((award) => award.axis === 'continuity').map((award) => award.milestone);
  const continuityAfter = after.filter((award) => award.axis === 'continuity').map((award) => award.milestone);

  assert.deepEqual(continuityBefore, [7, 14, 30]);
  assert.deepEqual(continuityAfter, [7, 14, 30], 'this is the whole difference from a streak');
  assert.equal(statusOf([...thirtyDays, false, false, false]).displayedRun, 0, 'the stretch does go');
});

test('nothing here counts down to the next award', () => {
  // An expected reward is the kind the evidence says undermines hardest, so the module
  // deliberately exposes no «four more days» anywhere. This asserts the absence.
  const module = routineAwards({
    acceptedSuggestionsThatHeld: 0,
    asOf: shift(6),
    status: statusOf(Array.from({ length: 6 }, () => true)),
    trackedFrom: START,
  });
  assert.deepEqual(module, [], 'six days earns nothing, and the model says nothing about the seventh');
  for (const award of awardsOf(Array.from({ length: 8 }, () => true))) {
    assert.deepEqual(Object.keys(award).sort(), ['axis', 'milestone'], 'an award is what was earned, and no progress bar');
  }
});

test('survival is awarded for the routine still being here, three times and then no more', () => {
  // Four breaks and four returns.
  const pattern: boolean[] = [];
  for (let round = 0; round < 4; round += 1) pattern.push(true, false, false, false);
  pattern.push(true);

  const status = statusOf(pattern);
  assert.equal(status.returns, 4);

  const survival = awardsOf(pattern).filter((award) => award.axis === 'survival');
  assert.deepEqual(survival.map((award) => award.milestone), [1, 2, 3], 'the fourth is a pattern to diagnose, not to congratulate');
});

test('age is measured in days lived and cannot be reduced by anything', () => {
  const broken = [true, false, false, false];
  const early = awardsOf(broken, { dayOffset: 29 }).filter((award) => award.axis === 'age');
  const later = awardsOf(broken, { dayOffset: 200 }).filter((award) => award.axis === 'age');

  assert.deepEqual(early, [], 'twenty-nine days is not yet a month');
  assert.deepEqual(later.map((award) => award.milestone), [30, 182]);
  assert.equal(AWARD_AGE_MILESTONES[0], 30);
});

test('total completions survive every break there has ever been', () => {
  const pattern: boolean[] = [];
  for (let round = 0; round < 20; round += 1) pattern.push(true, true, true, false, false, false);

  const status = statusOf(pattern);
  assert.equal(status.totalClosed, 60);
  assert.equal(status.breaks, 20);

  const total = awardsOf(pattern).filter((award) => award.axis === 'total');
  assert.deepEqual(total.map((award) => award.milestone), [50], 'sixty done is sixty done, whatever happened in between');
});

test('optimisation is awarded for a plan corrected, and is silent until something records one', () => {
  const pattern = Array.from({ length: 10 }, () => true);

  const withoutRecord = awardsOf(pattern).filter((award) => award.axis === 'optimisation');
  assert.deepEqual(withoutRecord, [], 'nothing stores accepted suggestions yet, so this axis stays honestly empty');

  const withRecord = awardsOf(pattern, { accepted: 3 }).filter((award) => award.axis === 'optimisation');
  assert.deepEqual(withRecord.map((award) => award.milestone), [1, 3]);
});

test('the headline moves from the stretch to the age once the ladder is behind it', () => {
  const short = statusOf(Array.from({ length: 30 }, () => true));
  const graduated = statusOf(Array.from({ length: 66 }, () => true));

  assert.equal(routineHeadlineAxis({ ageInDays: 30, status: short }), 'run');
  assert.equal(routineHeadlineAxis({ ageInDays: 66, status: graduated }), 'age');

  // And reaching the end of the ladder is a fact about the ladder, not about the habit:
  // 66 is a median, the mean is 106–154 days, and on large panel data there is no single
  // number at all.
  assert.equal(LADDER_END_MEANS_HABIT_FORMED, false);
});

test('only routines in trouble are queued, and how badly outranks how important', () => {
  const queue = routinesNeedingAttention([
    { habitId: 'a-growing', importance: 'critical', state: 'growing' },
    { habitId: 'b-wobbling', importance: 'low', state: 'attention' },
    { habitId: 'c-broken', importance: 'low', state: 'interrupted' },
    { habitId: 'd-strengthened', importance: 'critical', state: 'strengthened' },
  ]);

  assert.deepEqual(queue.map((candidate) => candidate.habitId), ['c-broken', 'b-wobbling']);
});

test('among equally troubled routines, priority decides, and ties never swap', () => {
  const queue = routinesNeedingAttention([
    { habitId: 'z', importance: 'normal', state: 'attention' },
    { habitId: 'a', importance: 'normal', state: 'attention' },
    { habitId: 'm', importance: 'critical', state: 'attention' },
  ]);

  assert.deepEqual(queue.map((candidate) => candidate.habitId), ['m', 'a', 'z']);

  // Stable on the id, so two equal routines do not change places between renders.
  const again = routinesNeedingAttention([
    { habitId: 'a', importance: 'normal', state: 'attention' },
    { habitId: 'z', importance: 'normal', state: 'attention' },
    { habitId: 'm', importance: 'critical', state: 'attention' },
  ]);
  assert.deepEqual(again.map((candidate) => candidate.habitId), ['m', 'a', 'z']);
});

test('a day where everything is fine has an empty queue, which is the point', () => {
  const queue = routinesNeedingAttention([
    { habitId: 'a', importance: 'critical', state: 'growing' },
    { habitId: 'b', importance: 'high', state: 'recovering' },
    { habitId: 'c', importance: 'normal', state: 'strengthened' },
  ]);
  assert.deepEqual(queue, [], 'a screen that lists everything has not chosen');
});
