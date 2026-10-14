import { measurePlannerCalendarDays, type PlannerLocalDate } from '../../domain';

/**
 * What a routine being grown is doing, and how it got there.
 *
 * React-free, SQL-free, clock-free: every input is stated, so the whole model is
 * asserted as behaviour rather than exercised through a screen. That is deliberate —
 * the project has already had five defects survive a green suite because the tests
 * matched source text instead of running the rule.
 *
 * **Everything here is counted in occurrences, not in calendar days.** For someone who
 * runs on Mondays, Wednesdays and Fridays, three misses are a lost week; for a daily
 * routine they are three days. One rule serves both rhythms and needs no per-habit
 * tuning. The calendar appears exactly once, in the silence rule below, and for a reason
 * that is stated where it is used.
 */

export const GROWTH_MISSES_TO_ATTENTION = 2;
export const GROWTH_MISSES_TO_INTERRUPTED = 3;

/**
 * The other way a routine breaks: a fortnight with nothing done at all.
 *
 * Rare routines are objectively more fragile. Over two months a daily habit gets about
 * sixty repetitions and a twice-weekly one about seventeen, so three misses cost the
 * second one four times as much. This clause catches that without per-rhythm
 * coefficients: for a daily routine the miss count always fires first, and for a weekly
 * one the silence does.
 */
export const GROWTH_SILENCE_DAYS = 14;

/**
 * Where the continuity ladder stops.
 *
 * 66 is the median time to automaticity, and the ladder ends there because past it
 * there is nothing left to reward about an unbroken run. **Reaching the last rung is not
 * a claim that the habit is formed** — the mean is 106–154 days and the range runs from
 * 4 to 335 — it only means this ladder has run out. Beyond it the axis becomes the
 * routine's age, which nothing can take away.
 *
 * The cap is also what keeps a single break cheap: nobody ever accumulates a
 * three-hundred-day number whose loss would be a catastrophe.
 */
export const GROWTH_CONTINUITY_LADDER = Object.freeze([7, 14, 30, 66] as const);

export type RoutineGrowthState =
  | 'growing'
  | 'attention'
  | 'interrupted'
  | 'recovering'
  | 'strengthened';

/** One day the routine was actually scheduled for, and whether it was closed. */
export interface RoutineGrowthOccurrence {
  readonly date: PlannerLocalDate;
  readonly closed: boolean;
}

export interface RoutineGrowthStatus {
  readonly state: RoutineGrowthState;
  /**
   * The number the counter shows.
   *
   * In `attention` it is **frozen** rather than reset: two misses have not destroyed the
   * twelve times that came before them. It returns to zero only when the routine breaks.
   */
  readonly displayedRun: number;
  /**
   * Closures in the current stretch.
   *
   * **A miss does not end a stretch; only a break does.** Twelve times, two misses and a
   * return is thirteen rather than one — the two misses froze the count, and freezing is
   * not losing. That is the whole difference from a streak, expressed in one variable.
   */
  readonly currentRun: number;
  /** The longest stretch ever reached. A record, and records only go up. */
  readonly bestRun: number;
  readonly consecutiveMisses: number;
  readonly totalClosed: number;
  readonly totalScheduled: number;
  /** How many times the routine has broken, and how many times it has come back. */
  readonly breaks: number;
  readonly returns: number;
  /** Continuity medals earned, permanently. A break never takes one away. */
  readonly medals: readonly number[];
  /** Days since anything was done — the input to the silence rule. */
  readonly silentDays: number;
}

/**
 * The state of a routine, walked from the day it was taken on.
 *
 * The caller passes the occurrences the routine was **scheduled** for, ascending, from
 * `trackedFrom` to `asOf` — days it was never due are not misses, and including them
 * would leave every routine except a daily one permanently broken.
 */
export function routineGrowthStatus(input: Readonly<{
  occurrences: readonly RoutineGrowthOccurrence[];
  asOf: PlannerLocalDate;
  trackedFrom: PlannerLocalDate;
}>): RoutineGrowthStatus {
  const occurrences = input.occurrences.filter((occurrence) => occurrence.date <= input.asOf);

  let currentRun = 0;
  let bestRun = 0;
  let consecutiveMisses = 0;
  let totalClosed = 0;
  let breaks = 0;
  let returns = 0;
  let broken = false;
  let everBroken = false;
  /** The stretch the most recent break interrupted, which «strengthened» must beat. */
  let runBeforeBreak = 0;
  let lastClosedDate: PlannerLocalDate | null = null;

  const recordBreak = () => {
    broken = true;
    everBroken = true;
    breaks += 1;
    // Taken at the moment of the break, so «held longer than before» compares against
    // what the routine actually managed last time rather than against its all-time
    // record — a routine that once ran ninety days could otherwise never strengthen.
    runBeforeBreak = currentRun;
    currentRun = 0;
  };

  for (const occurrence of occurrences) {
    if (occurrence.closed) {
      if (broken) {
        broken = false;
        returns += 1;
      }
      consecutiveMisses = 0;
      currentRun += 1;
      if (currentRun > bestRun) bestRun = currentRun;
      totalClosed += 1;
      lastClosedDate = occurrence.date;
      continue;
    }

    consecutiveMisses += 1;
    // The stretch is deliberately left alone here. One or two misses freeze the count;
    // they do not spend it, because the twelve times that came before them happened.
    if (consecutiveMisses >= GROWTH_MISSES_TO_INTERRUPTED && !broken) recordBreak();
  }

  // The one place the calendar is consulted. Silence is measured from the last thing
  // actually done, or from the day the routine was taken on when nothing has been.
  const silenceFrom = lastClosedDate ?? input.trackedFrom;
  const silentDays = Math.max(0, measurePlannerCalendarDays(silenceFrom, input.asOf));
  if (silentDays >= GROWTH_SILENCE_DAYS && !broken) recordBreak();

  const medals = GROWTH_CONTINUITY_LADDER.filter((rung) => bestRun >= rung);

  const state: RoutineGrowthState = broken
    ? 'interrupted'
    : consecutiveMisses >= GROWTH_MISSES_TO_ATTENTION
      ? 'attention'
      : everBroken && currentRun > runBeforeBreak
        ? 'strengthened'
        : everBroken
          ? 'recovering'
          : 'growing';

  // The stretch is frozen rather than spent, so there is nothing to restore: the number
  // simply is what it was before the misses started.
  const displayedRun = state === 'interrupted' ? 0 : currentRun;

  return Object.freeze({
    bestRun,
    breaks,
    consecutiveMisses,
    currentRun,
    displayedRun,
    medals: Object.freeze(medals),
    returns,
    silentDays,
    state,
    totalClosed,
    totalScheduled: occurrences.length,
  });
}

/**
 * The colour the counter wears, which is the state made visible.
 *
 * Grey rather than red for a broken routine: red already means «overdue» in this
 * application, and a routine that stopped is dormant rather than alarming. The product
 * must never look reproachful — a widget that scolds gets removed, and that is not
 * reversible.
 */
export type RoutineGrowthTone = 'growing' | 'attention' | 'dormant';

export function routineGrowthTone(state: RoutineGrowthState): RoutineGrowthTone {
  if (state === 'interrupted') return 'dormant';
  if (state === 'attention') return 'attention';
  return 'growing';
}

/**
 * Whether the routine is close enough to breaking to be worth saying so.
 *
 * One miss is deliberately not enough. It is the only rule in this whole model taken
 * straight from data: missing a single opportunity reduced automaticity by less than
 * half a point and recovered quickly, so a product that reacted to it would be reacting
 * to nothing. **Where that finding and the «one or two misses» sketch disagreed, the
 * measured one won.**
 */
export function routineNeedsAttention(status: RoutineGrowthStatus): boolean {
  return status.state === 'attention';
}

/** How many more misses the routine can take before it is counted as broken. */
export function missesBeforeBreaking(status: RoutineGrowthStatus): number {
  if (status.state === 'interrupted') return 0;
  return Math.max(0, GROWTH_MISSES_TO_INTERRUPTED - status.consecutiveMisses);
}

/**
 * Which of the routines in trouble the application should speak about first.
 *
 * **This is the one real job the existing priority has.** Until now it drew a stripe and
 * did nothing else; it does not change when a routine breaks, how fast it recovers, or
 * what the rules are — it decides the order of a queue, and only among routines that are
 * actually in trouble.
 *
 * Routines that are fine are not in the queue at all: a screen that lists everything has
 * not chosen, and choosing is the whole point of showing one thing at a time.
 */
export type RoutineAttentionImportance = 'low' | 'normal' | 'high' | 'critical';

const IMPORTANCE_ORDER: Readonly<Record<RoutineAttentionImportance, number>> = Object.freeze({
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
});

const STATE_URGENCY: Readonly<Record<RoutineGrowthState, number>> = Object.freeze({
  // Broken first, then wobbling. The three healthy states are not urgencies at all and
  // never reach the comparison.
  interrupted: 0,
  attention: 1,
  recovering: 2,
  strengthened: 3,
  growing: 4,
});

export interface RoutineAttentionCandidate {
  readonly habitId: string;
  readonly state: RoutineGrowthState;
  readonly importance: RoutineAttentionImportance;
}

export function routinesNeedingAttention(
  candidates: readonly RoutineAttentionCandidate[],
): readonly RoutineAttentionCandidate[] {
  const inTrouble = candidates.filter(
    (candidate) => candidate.state === 'interrupted' || candidate.state === 'attention',
  );
  return Object.freeze([...inTrouble].sort((left, right) => {
    // How badly it is going outranks how important it is: a broken critical routine and
    // a broken ordinary one are both broken, and the wobble is the thing that can still
    // be saved today.
    const byState = STATE_URGENCY[left.state] - STATE_URGENCY[right.state];
    if (byState !== 0) return byState;
    const byImportance = IMPORTANCE_ORDER[left.importance] - IMPORTANCE_ORDER[right.importance];
    if (byImportance !== 0) return byImportance;
    // Stable on the id, so two equal routines never swap places between renders.
    return left.habitId < right.habitId ? -1 : left.habitId > right.habitId ? 1 : 0;
  }));
}
