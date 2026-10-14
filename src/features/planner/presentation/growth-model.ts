import type { PlannerId } from '../domain';
import type { PlannerHabitCatalogueItem } from '../repositories/planner-management-repository';
import type { PlannerGrowthAttemptRow } from '../repositories/planner-growth-repository';
import {
  GROWTH_CONTINUITY_LADDER,
  type RoutineGrowthState,
  type RoutineGrowthStatus,
} from '../application/growth/routine-growth-model';

import { habitCategoryForAccentKey, type HabitCategoryKey } from './habit-category-catalogue';

/**
 * What the growth tab draws, decided here and nowhere else.
 *
 * React-free and clock-free, like every model in this layer: the screen renders what this
 * returns rather than deriving anything while it draws. That split is why the words on
 * the cards can be asserted at all.
 */

export interface GrowthCard {
  readonly habitId: PlannerId;
  readonly name: string;
  readonly accentKey: PlannerHabitCatalogueItem['visualIdentity']['persistedAccentKey'];
  readonly categoryKey: HabitCategoryKey | null;
  readonly identity: PlannerHabitCatalogueItem['visualIdentity']['iconIdentity'];
  /** What the person said they do this after, or `null` where they said nothing. */
  readonly cue: string | null;
  readonly status: RoutineGrowthStatus;
}

/**
 * The card's own state, with **no occurrences to walk yet**.
 *
 * The full status needs the days a routine was scheduled for, which is the day loader's
 * work and is a query of its own; until that lands the card states what the attempt row
 * itself carries and nothing it cannot know. **A number that would have to be invented is
 * not drawn** — every figure here is zero because zero is what is known, and the moment
 * the occurrence walk is wired the same shape carries the real ones.
 */
const UNWALKED: RoutineGrowthStatus = Object.freeze({
  bestRun: 0,
  breaks: 0,
  consecutiveMisses: 0,
  currentRun: 0,
  displayedRun: 0,
  medals: Object.freeze([] as readonly number[]),
  returns: 0,
  silentDays: 0,
  state: 'growing' as const,
  totalClosed: 0,
  totalScheduled: 0,
});

export function selectGrowthCards(input: Readonly<{
  attempts: readonly PlannerGrowthAttemptRow[];
  catalogue: readonly PlannerHabitCatalogueItem[];
  /** The walked status per habit, where the caller has one. */
  statuses?: ReadonlyMap<string, RoutineGrowthStatus>;
}>): readonly GrowthCard[] {
  const byId = new Map(input.catalogue.map((item) => [String(item.habitId), item] as const));
  const cards: GrowthCard[] = [];

  for (const attempt of input.attempts) {
    const item = byId.get(attempt.habitId);
    // An attempt whose habit is not in the active catalogue is not drawn: it was
    // archived or deleted while the attempt was open, and the routine it accompanied is
    // not there to accompany. It is left in the table rather than cleaned up here —
    // a read model does not write.
    if (item === undefined) continue;
    cards.push(Object.freeze({
      accentKey: item.visualIdentity.persistedAccentKey,
      categoryKey: habitCategoryForAccentKey(item.visualIdentity.persistedAccentKey)?.key ?? null,
      cue: attempt.cue,
      habitId: item.habitId,
      identity: item.visualIdentity.iconIdentity,
      name: item.name,
      status: input.statuses?.get(attempt.habitId) ?? UNWALKED,
    }));
  }

  // Oldest attempt first, so the order is the order they were taken on and a card does
  // not move because something happened to it. Stable on the habit id.
  return Object.freeze(cards.sort((left, right) => {
    const leftAttempt = input.attempts.find((attempt) => attempt.habitId === left.habitId);
    const rightAttempt = input.attempts.find((attempt) => attempt.habitId === right.habitId);
    const byDate = (leftAttempt?.trackedFrom ?? '').localeCompare(rightAttempt?.trackedFrom ?? '');
    if (byDate !== 0) return byDate;
    return left.habitId < right.habitId ? -1 : left.habitId > right.habitId ? 1 : 0;
  }));
}

/** The state, in one word, for a screen reader and for a label. */
export function growthStateLabel(state: RoutineGrowthState): string {
  switch (state) {
    case 'growing': return 'growing';
    case 'attention': return 'wobbling';
    case 'interrupted': return 'interrupted';
    case 'recovering': return 'recovering';
    case 'strengthened': return 'strengthened';
  }
}

/**
 * What the card says about the state, in a sentence.
 *
 * **Never a reproach.** «Прервано» states a fact and offers the way back; it does not say
 * what was lost, because the medals were not lost and the count was frozen rather than
 * spent. A product that scolds gets deleted, and that is not reversible.
 */
export function growthStateCaption(status: RoutineGrowthStatus): string {
  switch (status.state) {
    case 'growing':
      return status.currentRun === 0 ? 'Only just started' : 'Running steadily';
    case 'attention':
      return 'Missed twice — the count is not spent, it is waiting';
    case 'interrupted':
      return 'Interrupted. One mark and it runs again';
    case 'recovering':
      return 'Back — the count starts again';
    case 'strengthened':
      return 'Holding longer than before the break';
  }
}

/** What an earned rung is called out loud. */
export function growthAwardLabel(rung: number): string {
  return `${rung} in a row`;
}

/**
 * Whether the ladder has run out, which is a fact about the ladder and not about the
 * habit.
 *
 * 66 is a median; the mean is 106–154 days and the range runs from 4 to 335, so reaching
 * the last rung means only that there is nothing left to reward about an unbroken run.
 * Past it the axis is the routine's age, which nothing can take away.
 */
export function growthLadderComplete(status: RoutineGrowthStatus): boolean {
  return status.medals.length === GROWTH_CONTINUITY_LADDER.length;
}
