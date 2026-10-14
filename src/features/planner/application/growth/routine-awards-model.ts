import { measurePlannerCalendarDays, type PlannerLocalDate } from '../../domain';

import { GROWTH_CONTINUITY_LADDER, type RoutineGrowthStatus } from './routine-growth-model';
import { GROWTH_REWARDED_RETURNS } from './routine-diagnosis-model';

/**
 * What a routine has earned, on five axes, none of which can be taken away.
 *
 * **That is the entire design constraint, and it is what separates this from a streak.**
 * The problem with a streak was never that it rewards consistency — consistency is what a
 * habit is — but that a single event destroys everything accumulated, and the more
 * somebody has tried, the worse the loss. Here a break costs the current stretch and
 * nothing else: every medal already earned stays earned.
 *
 * **This is also the riskiest part of the product, and it is worth writing down where the
 * risk lives.** A meta-analysis of 128 studies found that tangible, expected,
 * completion-contingent rewards undermine intrinsic motivation — for engagement at
 * d = −0.40. Three of the five axes here deliberately reward something other than the act
 * itself: surviving a break, fixing a plan, and lasting. The continuity ladder is the one
 * that sits squarely in what was measured, which is exactly why it is capped rather than
 * endless, and why nothing here ever shows progress *towards* an award: an expected
 * reward is the kind that undermines hardest.
 */

/** Days lived, on the axis nothing can destroy. */
export const AWARD_AGE_MILESTONES = Object.freeze([30, 182, 365] as const);

/** Times done in total, across every break and return. */
export const AWARD_TOTAL_MILESTONES = Object.freeze([50, 100, 365] as const);

/** Plans corrected, and the routine then held. */
export const AWARD_OPTIMISATION_MILESTONES = Object.freeze([1, 3] as const);

export type RoutineAwardAxis = 'continuity' | 'survival' | 'optimisation' | 'age' | 'total';

export interface RoutineAward {
  readonly axis: RoutineAwardAxis;
  readonly milestone: number;
}

export interface RoutineAwardInput {
  readonly status: RoutineGrowthStatus;
  readonly trackedFrom: PlannerLocalDate;
  readonly asOf: PlannerLocalDate;
  /**
   * Suggestions the person accepted after which the routine actually held.
   *
   * **Nothing stores this yet.** It is an input rather than something derived, because
   * recording «a suggestion was accepted» needs a table of its own and no such migration
   * has been authorised. Callers pass 0 until it exists, which costs this axis its awards
   * and costs the other four nothing — an honest empty is better than a derived guess.
   */
  readonly acceptedSuggestionsThatHeld: number;
}

/**
 * Everything earned so far, in no particular order of importance.
 *
 * There is deliberately **no function here that says how far the next award is**. A
 * visible «4 more days» is what turns a reward into an expected one, and an expected
 * reward is the kind the evidence says undermines hardest. Awards arrive; they are not
 * counted down to.
 */
export function routineAwards(input: RoutineAwardInput): readonly RoutineAward[] {
  const awards: RoutineAward[] = [];

  // Continuity: capped at the ladder's end, and every rung already reached is kept even
  // once the routine breaks. `bestRun` is a record and records only go up.
  for (const rung of GROWTH_CONTINUITY_LADDER) {
    if (input.status.bestRun >= rung) awards.push(Object.freeze({ axis: 'continuity' as const, milestone: rung }));
  }

  // Survival, not «returning»: the award is for the routine still being here after a
  // break, which cannot be manufactured by breaking on purpose — to collect it you have
  // to carry on. It stops at the third, because a fifth return in two months is a
  // pattern to diagnose rather than an achievement to congratulate.
  const survived = Math.min(input.status.returns, GROWTH_REWARDED_RETURNS);
  for (let times = 1; times <= survived; times += 1) {
    awards.push(Object.freeze({ axis: 'survival' as const, milestone: times }));
  }

  // Optimisation: for a plan brought into line with a life. Everywhere else reducing a
  // plan is admitting defeat; here it is the thing that turns a permanently failed
  // routine into one that works, and the person did that.
  for (const milestone of AWARD_OPTIMISATION_MILESTONES) {
    if (input.acceptedSuggestionsThatHeld >= milestone) {
      awards.push(Object.freeze({ axis: 'optimisation' as const, milestone }));
    }
  }

  // Age: «half a year with this routine» is a stronger sentence than «47 days in a row»,
  // it contains the breaks rather than erasing them, and no event can reduce it.
  const age = Math.max(0, measurePlannerCalendarDays(input.trackedFrom, input.asOf));
  for (const milestone of AWARD_AGE_MILESTONES) {
    if (age >= milestone) awards.push(Object.freeze({ axis: 'age' as const, milestone }));
  }

  // Total: monotone by construction, across every break there has ever been.
  for (const milestone of AWARD_TOTAL_MILESTONES) {
    if (input.status.totalClosed >= milestone) awards.push(Object.freeze({ axis: 'total' as const, milestone }));
  }

  return Object.freeze(awards);
}

/**
 * The one number the routine's card leads with once the ladder is behind it.
 *
 * Before 66 the interesting figure is the stretch; after it the ladder has nothing left
 * to say and age takes over — which is also the moment the product stops implying that
 * an unbroken run is the point.
 */
export function routineHeadlineAxis(input: Readonly<{
  status: RoutineGrowthStatus;
  ageInDays: number;
}>): 'run' | 'age' {
  const lastRung = GROWTH_CONTINUITY_LADDER[GROWTH_CONTINUITY_LADDER.length - 1] ?? 66;
  return input.status.bestRun >= lastRung ? 'age' : 'run';
}

/**
 * Whether reaching the last rung may be called «the habit is formed».
 *
 * It may not, and this exists to make that hard to forget. 66 is the **median** time to
 * automaticity; the mean is 106–154 days and the individual range runs from 4 to 335, and
 * on large panel data there is no single number at all — going to the gym takes months
 * where washing hands takes weeks. The ladder ending is a fact about the ladder.
 */
export const LADDER_END_MEANS_HABIT_FORMED = false;
