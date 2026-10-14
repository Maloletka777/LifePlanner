import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIAGNOSIS_MIN_REPEATS,
  GROWTH_REWARDED_RETURNS,
  bestRoutineDiagnosis,
  diagnoseRoutine,
  returnDeservesReward,
  shouldOfferToStopTracking,
  type RoutineDiagnosisOccurrence,
} from '../../../src/features/planner/application/growth/routine-diagnosis-model';
import { addPlannerCalendarDays, parsePlannerLocalDate, plannerIsoWeekday, type PlannerLocalDate } from '../../../src/features/planner/domain';
import type { PlannerDayBlockKey } from '../../../src/features/planner/domain/values/day-block';

/** 2026-08-03 is a Monday, which keeps every weekday fixture readable. */
const MONDAY = date('2026-08-03');

function date(value: string): PlannerLocalDate {
  const parsed = parsePlannerLocalDate(value);
  if (!parsed.ok) throw new Error(`bad fixture date ${value}`);
  return parsed.value;
}

function shift(days: number): PlannerLocalDate {
  const moved = addPlannerCalendarDays(MONDAY, days);
  if (!moved.ok) throw new Error('bad fixture offset');
  return moved.value;
}

function occurrence(overrides: Partial<RoutineDiagnosisOccurrence> & { readonly dayOffset: number }): RoutineDiagnosisOccurrence {
  const { dayOffset, ...rest } = overrides;
  return Object.freeze({
    blockItemCount: 1,
    closed: true,
    closedInBlock: 'evening' as PlannerDayBlockKey,
    date: shift(dayOffset),
    plannedBlock: 'evening' as PlannerDayBlockKey,
    positionInBlock: 1,
    ...rest,
  });
}

test('the anchor really is a Monday, so every weekday fixture below means what it says', () => {
  assert.equal(plannerIsoWeekday(MONDAY), 1);
  assert.equal(plannerIsoWeekday(shift(2)), 3, 'Wednesday');
});

test('a weekday is named only when it fails and the other days do not', () => {
  // Wednesdays missed three weeks running; everything else done.
  const occurrences: RoutineDiagnosisOccurrence[] = [];
  for (const week of [0, 1, 2]) {
    occurrences.push(occurrence({ closed: true, dayOffset: week * 7 }));
    occurrences.push(occurrence({ closed: false, dayOffset: week * 7 + 2 }));
    occurrences.push(occurrence({ closed: true, dayOffset: week * 7 + 4 }));
  }

  const best = bestRoutineDiagnosis({ occurrences, spanDays: 21 });
  assert.equal(best?.kind, 'weekday');
  if (best?.kind === 'weekday') {
    assert.equal(best.weekday, 3, 'Wednesday');
    assert.equal(best.repeats, 3);
  }
});

test('a routine failing everywhere is not a Wednesday problem', () => {
  // Missed on every weekday: naming one would send the person to fix the wrong thing.
  const occurrences = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((dayOffset) => occurrence({ closed: false, dayOffset }));

  const kinds = diagnoseRoutine({ occurrences, spanDays: 14 }).map((diagnosis) => diagnosis.kind);
  assert.equal(kinds.includes('weekday'), false);
  assert.equal(kinds.includes('too_frequent'), true, 'the honest reading is that the plan is too big');
});

test('two misses on a weekday are not yet a pattern', () => {
  const occurrences: RoutineDiagnosisOccurrence[] = [];
  for (const week of [0, 1]) {
    occurrences.push(occurrence({ closed: true, dayOffset: week * 7 }));
    occurrences.push(occurrence({ closed: false, dayOffset: week * 7 + 2 }));
  }

  assert.equal(bestRoutineDiagnosis({ occurrences, spanDays: 14 }), null, 'below the threshold the answer is silence');
  assert.equal(DIAGNOSIS_MIN_REPEATS, 3);
});

test('a routine filed in the morning and done after noon is told so', () => {
  const occurrences = [0, 1, 2, 3].map((dayOffset) => occurrence({
    closed: true,
    closedInBlock: 'day',
    dayOffset,
    plannedBlock: 'morning',
  }));

  const best = bestRoutineDiagnosis({ occurrences, spanDays: 4 });
  assert.equal(best?.kind, 'wrong_block');
  if (best?.kind === 'wrong_block') {
    assert.equal(best.plannedBlock, 'morning');
    assert.equal(best.actualBlock, 'day');
    assert.equal(best.repeats, 4);
  }
});

test('an item done in the block it belongs to says nothing at all', () => {
  const occurrences = [0, 1, 2, 3, 4, 5].map((dayOffset) => occurrence({ closed: true, dayOffset }));
  assert.equal(bestRoutineDiagnosis({ occurrences, spanDays: 6 }), null);
});

test('a plan bigger than the life is named as the plan, not as a failure', () => {
  // Fourteen days scheduled, five done — about three times a week.
  const pattern = [true, false, false, true, false, false, true, false, false, true, false, false, true, false];
  const occurrences = pattern.map((closed, dayOffset) => occurrence({ closed, dayOffset }));

  const best = bestRoutineDiagnosis({ occurrences, spanDays: 14 });
  assert.equal(best?.kind, 'too_frequent');
  if (best?.kind === 'too_frequent') {
    assert.equal(best.scheduled, 14);
    assert.equal(best.closed, 5);
    assert.equal(best.suggestedPerWeek, 3, 'suggest what the person is actually managing');
  }
});

test('a routine doing well is left alone even when it slips once', () => {
  const pattern = [true, true, true, true, true, true, true, false, true, true];
  const occurrences = pattern.map((closed, dayOffset) => occurrence({ closed, dayOffset }));

  assert.deepEqual(diagnoseRoutine({ occurrences, spanDays: 10 }), []);
});

test('a block that only fails when it is full is named as crowding', () => {
  const occurrences = [
    occurrence({ blockItemCount: 2, closed: true, dayOffset: 0 }),
    occurrence({ blockItemCount: 2, closed: true, dayOffset: 1 }),
    occurrence({ blockItemCount: 2, closed: true, dayOffset: 2 }),
    occurrence({ blockItemCount: 6, closed: false, dayOffset: 3 }),
    occurrence({ blockItemCount: 6, closed: false, dayOffset: 4 }),
    occurrence({ blockItemCount: 5, closed: false, dayOffset: 5 }),
  ];

  const kinds = diagnoseRoutine({ occurrences, spanDays: 6 }).map((diagnosis) => diagnosis.kind);
  assert.equal(kinds.includes('crowded_block'), true);

  const crowded = diagnoseRoutine({ occurrences, spanDays: 6 }).find((diagnosis) => diagnosis.kind === 'crowded_block');
  if (crowded?.kind === 'crowded_block') {
    assert.equal(crowded.block, 'evening');
    assert.equal(crowded.crowdedAt, 3, 'it holds at two and stops holding above that');
  }
});

test('a routine standing last in a block that never reaches it is told where it stands', () => {
  const occurrences = [
    occurrence({ blockItemCount: 5, closed: false, dayOffset: 0, positionInBlock: 5 }),
    occurrence({ blockItemCount: 5, closed: false, dayOffset: 1, positionInBlock: 5 }),
    occurrence({ blockItemCount: 5, closed: false, dayOffset: 2, positionInBlock: 5 }),
  ];

  const kinds = diagnoseRoutine({ occurrences, spanDays: 3 }).map((diagnosis) => diagnosis.kind);
  assert.equal(kinds.includes('late_in_chain'), true);
});

test('an item standing first is never diagnosed as standing last', () => {
  const occurrences = [0, 1, 2].map((dayOffset) => occurrence({ blockItemCount: 5, closed: false, dayOffset, positionInBlock: 1 }));
  const kinds = diagnoseRoutine({ occurrences, spanDays: 3 }).map((diagnosis) => diagnosis.kind);
  assert.equal(kinds.includes('late_in_chain'), false);
});

test('the strongest pattern comes first, because the screen shows one', () => {
  // A Wednesday problem on top of a plan that is slightly too big.
  const occurrences: RoutineDiagnosisOccurrence[] = [];
  for (const week of [0, 1, 2, 3]) {
    occurrences.push(occurrence({ closed: true, dayOffset: week * 7 }));
    occurrence({ closed: true, dayOffset: week * 7 + 1 });
    occurrences.push(occurrence({ closed: false, dayOffset: week * 7 + 2 }));
    occurrences.push(occurrence({ closed: true, dayOffset: week * 7 + 4 }));
  }

  const all = diagnoseRoutine({ occurrences, spanDays: 28 });
  assert.ok(all.length >= 1);
  assert.deepEqual(bestRoutineDiagnosis({ occurrences, spanDays: 28 }), all[0], 'the surface takes the first');
  for (let index = 1; index < all.length; index += 1) {
    assert.ok((all[index - 1]?.repeats ?? 0) >= (all[index]?.repeats ?? 0), 'ranked by how much each explains');
  }
});

test('returning is an achievement three times, and after that it is a pattern', () => {
  assert.equal(returnDeservesReward(1), true);
  assert.equal(returnDeservesReward(GROWTH_REWARDED_RETURNS), true);
  assert.equal(
    returnDeservesReward(GROWTH_REWARDED_RETURNS + 1),
    false,
    'the fourth return stops being congratulated so the loop «quit, return, medal» gets no reinforcement',
  );
  assert.equal(returnDeservesReward(0), false);
});

test('stopping is offered only after help was given and did not help', () => {
  // Breaking a lot is not by itself grounds for telling somebody to give up.
  assert.equal(shouldOfferToStopTracking({ acceptedSuggestions: 0, breaks: 9 }), false);
  assert.equal(shouldOfferToStopTracking({ acceptedSuggestions: 2, breaks: 1 }), false);
  assert.equal(shouldOfferToStopTracking({ acceptedSuggestions: 2, breaks: 4 }), true);
});
