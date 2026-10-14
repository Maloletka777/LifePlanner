import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GROWTH_CONTINUITY_LADDER,
  GROWTH_SILENCE_DAYS,
  missesBeforeBreaking,
  routineGrowthStatus,
  routineGrowthTone,
  type RoutineGrowthOccurrence,
} from '../../../src/features/planner/application/growth/routine-growth-model';
import { addPlannerCalendarDays, parsePlannerLocalDate, type PlannerLocalDate } from '../../../src/features/planner/domain';

const START = date('2026-08-04');

function date(value: string): PlannerLocalDate {
  const parsed = parsePlannerLocalDate(value);
  if (!parsed.ok) throw new Error(`bad fixture date ${value}`);
  return parsed.value;
}

function shift(from: PlannerLocalDate, days: number): PlannerLocalDate {
  const moved = addPlannerCalendarDays(from, days);
  if (!moved.ok) throw new Error('bad fixture offset');
  return moved.value;
}

/** A daily routine: one occurrence per day from the start, closed where the pattern says. */
function daily(pattern: readonly boolean[]): readonly RoutineGrowthOccurrence[] {
  return pattern.map((closed, index) => Object.freeze({ closed, date: shift(START, index) }));
}

/** Mon/Wed/Fri: an occurrence every second day, which is what «in occurrences» means. */
function everyOtherDay(pattern: readonly boolean[]): readonly RoutineGrowthOccurrence[] {
  return pattern.map((closed, index) => Object.freeze({ closed, date: shift(START, index * 2) }));
}

function status(occurrences: readonly RoutineGrowthOccurrence[], asOfOffset?: number) {
  const last = occurrences[occurrences.length - 1]?.date ?? START;
  return routineGrowthStatus({
    asOf: asOfOffset === undefined ? last : shift(START, asOfOffset),
    occurrences,
    trackedFrom: START,
  });
}

test('one miss changes nothing at all, and that is the only rule here taken from data', () => {
  const clean = status(daily([true, true, true, true, true]));
  const oneMiss = status(daily([true, true, true, true, true, false]));

  assert.equal(clean.state, 'growing');
  assert.equal(oneMiss.state, 'growing', 'a single miss must not move the state');
  assert.equal(routineGrowthTone(oneMiss.state), 'growing', 'nor the colour');
  assert.equal(oneMiss.displayedRun, 5, 'nor the number the counter shows');

  // Where the sketch said «one or two misses» and the measurement said one miss does
  // nothing, the measurement won. It is stated here so the choice is visible.
  assert.equal(oneMiss.consecutiveMisses, 1);
  assert.equal(missesBeforeBreaking(oneMiss), 2);
});

test('two misses raise attention, and the counter freezes rather than resetting', () => {
  const wobbling = status(daily([true, true, true, true, true, true, true, true, true, true, true, true, false, false]));

  assert.equal(wobbling.state, 'attention');
  assert.equal(routineGrowthTone(wobbling.state), 'attention');
  // The stretch is not broken by misses, only by a break. Twelve times happened, and two
  // misses did not unhappen them — that is the whole difference from a streak.
  assert.equal(wobbling.currentRun, 12);
  assert.equal(wobbling.displayedRun, 12);
  assert.equal(missesBeforeBreaking(wobbling), 1);
});

test('coming back inside attention continues the old count', () => {
  const recovered = status(daily([true, true, true, true, true, true, true, true, true, true, true, true, false, false, true]));

  assert.equal(recovered.state, 'growing', 'the wobble is over');
  assert.equal(recovered.displayedRun, 13, 'thirteen, not one: the count was frozen, not lost');
  assert.equal(recovered.currentRun, 13);
});

test('three misses break the routine, the number goes to zero, and the medals stay', () => {
  const closed = Array.from({ length: 30 }, () => true);
  const broken = status(daily([...closed, false, false, false]));

  assert.equal(broken.state, 'interrupted');
  assert.equal(routineGrowthTone(broken.state), 'dormant', 'dormant, not alarming: red already means overdue');
  assert.equal(broken.displayedRun, 0);
  assert.equal(broken.breaks, 1);

  // The whole difference from a streak: what was earned is not taken away.
  assert.deepEqual([...broken.medals], [7, 14, 30]);
  assert.equal(broken.bestRun, 30, 'a record only goes up');
});

test('one completion after a break starts the return, and it takes only one', () => {
  const returned = status(daily([true, true, true, true, false, false, false, true]));

  assert.equal(returned.state, 'recovering');
  assert.equal(returned.returns, 1);
  assert.equal(returned.currentRun, 1);

  // Three to break, one to start coming back. Symmetry would mean somebody who has done
  // the thing three times running is still filed as broken.
  assert.equal(returned.breaks, 1);
});

test('strengthened needs beating what the routine managed before the break, not its record', () => {
  // Ninety days once, then a long run of four, a break, and a return of five.
  const longAgo = Array.from({ length: 9 }, () => true);
  const before = [...longAgo, false, false, false, ...Array.from({ length: 4 }, () => true)];
  const stillRecovering = status(daily([...before, false, false, false, true, true, true]));
  assert.equal(stillRecovering.state, 'recovering', 'three is not yet more than the four it managed last time');

  const strengthened = status(daily([...before, false, false, false, true, true, true, true, true]));
  assert.equal(strengthened.state, 'strengthened', 'five beats the four before the break');

  // Compared against the run the last break interrupted rather than the all-time best:
  // otherwise a routine that once ran ninety days could never strengthen again.
  assert.equal(strengthened.bestRun, 9);
});

test('a routine that never broke cannot be strengthened, however long it runs', () => {
  const long = status(daily(Array.from({ length: 70 }, () => true)));

  assert.equal(long.state, 'growing');
  assert.equal(long.breaks, 0);
  assert.deepEqual([...long.medals], [...GROWTH_CONTINUITY_LADDER]);
});

test('a fortnight of silence breaks a routine the miss count would have let stand', () => {
  // A weekly routine: two occurrences, one closed, one missed. One miss is nothing by
  // the count — but fourteen days have passed with nothing done.
  const weekly: readonly RoutineGrowthOccurrence[] = [
    Object.freeze({ closed: true, date: START }),
    Object.freeze({ closed: false, date: shift(START, 7) }),
  ];

  const inside = routineGrowthStatus({ asOf: shift(START, GROWTH_SILENCE_DAYS - 1), occurrences: weekly, trackedFrom: START });
  assert.equal(inside.state, 'growing', 'thirteen days of silence is not yet a break');
  assert.equal(inside.silentDays, GROWTH_SILENCE_DAYS - 1);

  const outside = routineGrowthStatus({ asOf: shift(START, GROWTH_SILENCE_DAYS), occurrences: weekly, trackedFrom: START });
  assert.equal(outside.state, 'interrupted', 'a fortnight with nothing done is a break by any reading');
  assert.equal(outside.breaks, 1);
});

test('silence is measured from the last thing done, not from the day it was taken on', () => {
  const done = [Object.freeze({ closed: true, date: shift(START, 20) })];
  const fresh = routineGrowthStatus({ asOf: shift(START, 21), occurrences: done, trackedFrom: START });

  assert.equal(fresh.silentDays, 1, 'twenty quiet days before the first completion are behind it');
  assert.equal(fresh.state, 'growing');
});

test('a routine taken on today, with nothing due yet, is simply growing', () => {
  const nothing = routineGrowthStatus({ asOf: START, occurrences: [], trackedFrom: START });

  assert.equal(nothing.state, 'growing');
  assert.equal(nothing.displayedRun, 0);
  assert.equal(nothing.totalScheduled, 0);
  assert.equal(nothing.silentDays, 0);
});

test('counting is in occurrences, so a rhythm needs no tuning', () => {
  // Three misses is three misses whether they took three days or a week.
  const dailyBroken = status(daily([true, false, false, false]));
  const otherDayBroken = status(everyOtherDay([true, false, false, false]));

  assert.equal(dailyBroken.state, 'interrupted');
  assert.equal(otherDayBroken.state, 'interrupted');
  assert.equal(dailyBroken.consecutiveMisses, otherDayBroken.consecutiveMisses);
});

test('days the routine was never due are not misses', () => {
  // A Mon/Wed/Fri routine, every occurrence closed, seen a fortnight later. If the model
  // counted calendar days the empty Tuesdays would have broken it three times over.
  const closed = everyOtherDay([true, true, true, true, true, true, true]);
  const kept = routineGrowthStatus({ asOf: shift(START, 12), occurrences: closed, trackedFrom: START });

  assert.equal(kept.state, 'growing');
  assert.equal(kept.currentRun, 7);
  assert.equal(kept.breaks, 0);
});

test('occurrences after the day being asked about are not counted yet', () => {
  const withFuture = daily([true, true, false, false, false]);
  const asOfSecondDay = routineGrowthStatus({ asOf: shift(START, 1), occurrences: withFuture, trackedFrom: START });

  assert.equal(asOfSecondDay.state, 'growing', 'tomorrow has not failed yet');
  assert.equal(asOfSecondDay.totalScheduled, 2);
  assert.equal(asOfSecondDay.currentRun, 2);
});

test('breaking twice is counted twice, and returning twice as well', () => {
  const twice = status(daily([
    true, true, false, false, false,
    true, true, false, false, false,
    true,
  ]));

  assert.equal(twice.breaks, 2);
  assert.equal(twice.returns, 2);
  assert.equal(twice.state, 'recovering');
  assert.equal(twice.totalClosed, 5);
});
