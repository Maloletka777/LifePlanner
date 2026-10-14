import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  growthAwardLabel,
  growthLadderComplete,
  growthStateCaption,
  growthStateLabel,
  selectGrowthCards,
} from '../../../src/features/planner/presentation/growth-model';
import {
  routineGrowthStatus,
  type RoutineGrowthOccurrence,
  type RoutineGrowthStatus,
} from '../../../src/features/planner/application/growth/routine-growth-model';
import {
  addPlannerCalendarDays,
  parsePlannerLocalDate,
  type PlannerLocalDate,
} from '../../../src/features/planner/domain';
import type { PlannerGrowthAttemptRow } from '../../../src/features/planner/repositories/planner-growth-repository';
import type { PlannerHabitCatalogueItem } from '../../../src/features/planner/repositories/planner-management-repository';

const screen = readFileSync('src/features/planner/presentation/growth-screen.tsx', 'utf8');
const layout = readFileSync('app/(tabs)/_layout.tsx', 'utf8');

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

function statusOf(pattern: readonly boolean[]): RoutineGrowthStatus {
  const occurrences: readonly RoutineGrowthOccurrence[] = pattern.map((closed, index) =>
    Object.freeze({ closed, date: shift(index) }));
  return routineGrowthStatus({ asOf: shift(pattern.length - 1), occurrences, trackedFrom: START });
}

function attempt(habitId: string, overrides: Partial<PlannerGrowthAttemptRow> = {}): PlannerGrowthAttemptRow {
  return {
    attemptNumber: 1,
    cue: null,
    enjoyment: null,
    habitId,
    id: `attempt-${habitId}`,
    stoppedFrom: null,
    trackedFrom: '2026-01-05',
    ...overrides,
  };
}

function catalogueItem(habitId: string, name: string): PlannerHabitCatalogueItem {
  return {
    habitId,
    name,
    visualIdentity: {
      persistedAccentKey: 'green',
      iconIdentity: { kind: 'symbol', symbolKey: 'workout' },
    },
  } as unknown as PlannerHabitCatalogueItem;
}

test('a card is built only where the routine is still there to accompany', () => {
  const cards = selectGrowthCards({
    attempts: [attempt('a'), attempt('gone')],
    catalogue: [catalogueItem('a', 'Зарядка')],
  });

  assert.deepEqual(cards.map((card) => card.name), ['Зарядка']);
  // An attempt whose habit was archived or deleted while it was open is not drawn, and
  // is deliberately **not cleaned up here**: a read model does not write. Asserted
  // against the calls rather than the prose, which is the difference between checking a
  // rule and checking that somebody wrote it down.
  const model = readFileSync('src/features/planner/presentation/growth-model.ts', 'utf8');
  assert.doesNotMatch(model, /stopHabitGrowth\(|startHabitGrowth\(|unitOfWork/);
});

test('cards stand in the order they were taken on, and never reorder themselves', () => {
  const cards = selectGrowthCards({
    attempts: [
      attempt('later', { trackedFrom: '2026-02-01' }),
      attempt('earlier', { trackedFrom: '2026-01-05' }),
    ],
    catalogue: [catalogueItem('later', 'Позже'), catalogueItem('earlier', 'Раньше')],
  });

  // A card that moved because something happened to it would make the screen unreadable
  // at exactly the moment it matters — the one that broke would jump.
  assert.deepEqual(cards.map((card) => card.name), ['Раньше', 'Позже']);
});

test('a card states nothing it cannot know yet', () => {
  const cards = selectGrowthCards({
    attempts: [attempt('a')],
    catalogue: [catalogueItem('a', 'Зарядка')],
  });

  // Without the occurrence walk every figure is zero, because zero is what is known.
  // **A number that would have to be invented is not drawn**, which is the rule the whole
  // project runs on and the reason the fallback is a named constant rather than a guess.
  assert.equal(cards[0]?.status.displayedRun, 0);
  assert.equal(cards[0]?.status.returns, 0);
  assert.deepEqual([...(cards[0]?.status.medals ?? [])], []);

  // And where the caller has walked one, it is used rather than recomputed.
  const walked = statusOf([true, true, true]);
  const withStatus = selectGrowthCards({
    attempts: [attempt('a')],
    catalogue: [catalogueItem('a', 'Зарядка')],
    statuses: new Map([['a', walked]]),
  });
  assert.equal(withStatus[0]?.status.displayedRun, 3);
});

test('the cue is carried to the card, because a cue nobody sees is a cue nobody uses', () => {
  const cards = selectGrowthCards({
    attempts: [attempt('a', { cue: 'после утреннего кофе' })],
    catalogue: [catalogueItem('a', 'Зарядка')],
  });
  assert.equal(cards[0]?.cue, 'после утреннего кофе');
  assert.match(screen, /After: \$\{card\.cue\}/);
});

test('nothing on this screen counts down to the next medal', () => {
  // An expected, completion-contingent reward is the kind measured to undermine
  // intrinsic motivation hardest, so a medal appears when earned and never as «four more
  // days». The absence is asserted, because an absence is what a later package would
  // quietly fill in — and it is asserted against **what is computed**, not against the
  // prose, since the screen says out loud that the distance is deliberately missing.
  assert.doesNotMatch(screen, /toNext|nextMilestone|progressTo|remainingTo|daysUntil/);
  // The model exposes no such function either, so there is nothing for a later screen to
  // reach for. That is the enforcement; the words on screen are only the explanation.
  const awards = readFileSync('src/features/planner/application/growth/routine-awards-model.ts', 'utf8');
  assert.doesNotMatch(awards, /export function .*(?:next|remaining|until|toGo)/i);

  // The one countdown on the screen is the warning that a routine is about to break,
  // which is a fact about now rather than a target to reach.
  assert.match(screen, /\$\{missesBeforeBreaking\(card\.status\)\} more and it breaks/);
});

test('a broken routine is dormant grey and never a reproach', () => {
  // Red already means «overdue» in this application, and a product that scolds gets
  // deleted — which is not reversible.
  assert.match(screen, /tone === 'dormant'\s*\?\s*theme\.today\.tertiaryText/);
  assert.match(growthStateCaption(statusOf([true, false, false, false])), /One mark and it runs again/);
  assert.doesNotMatch(growthStateCaption(statusOf([true, false, false, false])), /потер|сгорел|провал/i);
});

test('the caption says the count was frozen rather than spent', () => {
  // That is the whole difference from a streak, said in words on the one screen where
  // somebody is looking at the number.
  const wobbling = statusOf([...Array.from({ length: 12 }, () => true), false, false]);
  assert.equal(wobbling.state, 'attention');
  assert.equal(wobbling.displayedRun, 12, 'two misses do not spend twelve');
  assert.match(growthStateCaption(wobbling), /the count is not spent/);
});

test('every state has a word, and the ladder’s end is a fact about the ladder', () => {
  for (const state of ['growing', 'attention', 'interrupted', 'recovering', 'strengthened'] as const) {
    assert.ok(growthStateLabel(state).length > 0, state);
  }
  assert.equal(growthAwardLabel(30), '30 in a row');

  assert.equal(growthLadderComplete(statusOf(Array.from({ length: 30 }, () => true))), false);
  assert.equal(growthLadderComplete(statusOf(Array.from({ length: 66 }, () => true))), true);
});

test('the tab is second in the bar, beside Today', () => {
  // The two floors are used at the same moment — the day is worked on Today and the one
  // to three routines being grown are checked next door — while Overview answers the
  // «over time» question. Last would have made it the tab nobody opens.
  const growth = layout.indexOf('name="growth"');
  const today = layout.indexOf('name="index"');
  const overview = layout.indexOf('name="planner"');
  assert.ok(today < growth, 'Today comes first');
  assert.ok(growth < overview, 'and growth stands before Overview');
});
