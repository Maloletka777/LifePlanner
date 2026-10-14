import { plannerIsoWeekday, type PlannerLocalDate } from '../../domain';
import type { PlannerDayBlockKey } from '../../domain/values/day-block';

/**
 * What the application is allowed to say about a routine that is not going well.
 *
 * **Five patterns, and every one of them is computable from data already stored.** That
 * is the whole constraint: nothing here guesses, and where no pattern is strong enough
 * the answer is silence rather than a sentence about motivation. A suggestion that turns
 * out to be wrong costs more than no suggestion — after two misses a person stops
 * reading everything the application says.
 *
 * **It never states the failure.** «You missed the gym three times» is a reproach, and
 * one the person already knows. «Wednesdays haven't worked for three weeks — move it to
 * Thursday?» tells them something they did not know: that the problem is the Wednesday,
 * not them. Each diagnosis therefore carries the shape of a concrete change, because a
 * specific plan is the thing with a measured effect behind it; advice to try harder is
 * not.
 *
 * **The thresholds below are chosen, not derived.** No study says a pattern becomes
 * actionable at three repetitions or that a block is crowded at two extra items. They
 * are the dials this model exposes deliberately, in one place, so that tuning them on
 * real people is an edit rather than an excavation.
 */

/** A pattern must have repeated this many times before it may be spoken about. */
export const DIAGNOSIS_MIN_REPEATS = 3;

/** How much worse a weekday must be than the rest before it is named. */
export const DIAGNOSIS_WEEKDAY_MISS_RATE = 0.6;
export const DIAGNOSIS_OTHER_WEEKDAY_MISS_RATE = 0.3;

/** How many extra items in a block mark it as the crowded kind of day. */
export const DIAGNOSIS_CROWDING_MARGIN = 2;

/** Below this share of its own plan, a routine is over-scheduled rather than failing. */
export const DIAGNOSIS_FREQUENCY_RATE = 0.6;
export const DIAGNOSIS_FREQUENCY_MIN_SCHEDULED = 6;

/** How far down a block counts as «late in the chain». */
export const DIAGNOSIS_LATE_POSITION_SHARE = 0.66;

export type RoutineDiagnosisKind =
  | 'weekday'
  | 'wrong_block'
  | 'crowded_block'
  | 'too_frequent'
  | 'late_in_chain';

/**
 * One scheduled day of a routine, with everything the five patterns need.
 *
 * `plannedBlock` is where the item **belongs** and `closedInBlock` is where it actually
 * got done. Keeping them apart is the reason the second pattern is computable at all: if
 * the block were derived from the hour, a morning routine done after noon would have
 * quietly become an afternoon one and no failed morning would survive to be counted.
 */
export interface RoutineDiagnosisOccurrence {
  readonly date: PlannerLocalDate;
  readonly closed: boolean;
  readonly plannedBlock: PlannerDayBlockKey | null;
  readonly closedInBlock: PlannerDayBlockKey | null;
  /** How many items stood in that block on that day, this one included. */
  readonly blockItemCount: number;
  /** Where in the block this item stood, 1-based. */
  readonly positionInBlock: number;
}

interface DiagnosisBase {
  readonly repeats: number;
}

export type RoutineDiagnosis =
  | (DiagnosisBase & { readonly kind: 'weekday'; readonly weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7 })
  | (DiagnosisBase & { readonly kind: 'wrong_block'; readonly plannedBlock: PlannerDayBlockKey; readonly actualBlock: PlannerDayBlockKey })
  | (DiagnosisBase & { readonly kind: 'crowded_block'; readonly block: PlannerDayBlockKey; readonly crowdedAt: number })
  | (DiagnosisBase & { readonly kind: 'too_frequent'; readonly scheduled: number; readonly closed: number; readonly suggestedPerWeek: number })
  | (DiagnosisBase & { readonly kind: 'late_in_chain'; readonly block: PlannerDayBlockKey; readonly position: number });

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * «Wednesdays don't work.»
 *
 * Named only when the routine genuinely fails on that weekday and genuinely succeeds on
 * the others — a routine failing everywhere has a different problem, and calling it a
 * Wednesday problem would send the person to fix the wrong thing.
 */
function weekdayPattern(occurrences: readonly RoutineDiagnosisOccurrence[]): RoutineDiagnosis | null {
  const byWeekday = new Map<number, { scheduled: number; missed: number }>();
  for (const occurrence of occurrences) {
    const weekday = plannerIsoWeekday(occurrence.date);
    const bucket = byWeekday.get(weekday) ?? { missed: 0, scheduled: 0 };
    bucket.scheduled += 1;
    if (!occurrence.closed) bucket.missed += 1;
    byWeekday.set(weekday, bucket);
  }

  let worst: RoutineDiagnosis | null = null;
  for (const [weekday, bucket] of byWeekday) {
    if (bucket.missed < DIAGNOSIS_MIN_REPEATS) continue;
    if (bucket.missed / bucket.scheduled < DIAGNOSIS_WEEKDAY_MISS_RATE) continue;

    const others = occurrences.filter((occurrence) => plannerIsoWeekday(occurrence.date) !== weekday);
    if (others.length === 0) continue;
    const otherMissRate = others.filter((occurrence) => !occurrence.closed).length / others.length;
    if (otherMissRate > DIAGNOSIS_OTHER_WEEKDAY_MISS_RATE) continue;

    if (worst === null || bucket.missed > worst.repeats) {
      worst = Object.freeze({ kind: 'weekday' as const, repeats: bucket.missed, weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7 });
    }
  }
  return worst;
}

/** «It sits in Morning and gets done after noon.» */
function wrongBlockPattern(occurrences: readonly RoutineDiagnosisOccurrence[]): RoutineDiagnosis | null {
  const moved = new Map<PlannerDayBlockKey, number>();
  let plannedBlock: PlannerDayBlockKey | null = null;
  for (const occurrence of occurrences) {
    if (!occurrence.closed) continue;
    if (occurrence.plannedBlock === null || occurrence.closedInBlock === null) continue;
    if (occurrence.plannedBlock === occurrence.closedInBlock) continue;
    plannedBlock = occurrence.plannedBlock;
    moved.set(occurrence.closedInBlock, (moved.get(occurrence.closedInBlock) ?? 0) + 1);
  }
  if (plannedBlock === null) return null;

  let actualBlock: PlannerDayBlockKey | null = null;
  let repeats = 0;
  for (const [block, count] of moved) {
    if (count > repeats) {
      actualBlock = block;
      repeats = count;
    }
  }
  if (actualBlock === null || repeats < DIAGNOSIS_MIN_REPEATS) return null;
  return Object.freeze({ actualBlock, kind: 'wrong_block' as const, plannedBlock, repeats });
}

/** «The evening falls apart when there are more than four things in it.» */
function crowdedBlockPattern(occurrences: readonly RoutineDiagnosisOccurrence[]): RoutineDiagnosis | null {
  const missed = occurrences.filter((occurrence) => !occurrence.closed);
  const closed = occurrences.filter((occurrence) => occurrence.closed);
  if (missed.length < DIAGNOSIS_MIN_REPEATS || closed.length === 0) return null;

  const missedLoad = mean(missed.map((occurrence) => occurrence.blockItemCount));
  const closedLoad = mean(closed.map((occurrence) => occurrence.blockItemCount));
  if (missedLoad - closedLoad < DIAGNOSIS_CROWDING_MARGIN) return null;

  const block = missed[0]?.plannedBlock ?? null;
  if (block === null) return null;
  return Object.freeze({
    block,
    crowdedAt: Math.ceil(closedLoad) + 1,
    kind: 'crowded_block' as const,
    repeats: missed.length,
  });
}

/**
 * «You plan it daily and do it three times a week.»
 *
 * The most useful of the five, and the one no tracker with a streak can offer: there,
 * reducing the plan is admitting defeat. Here it turns a permanently failing routine into
 * one that succeeds, without asking the person to change.
 */
function tooFrequentPattern(occurrences: readonly RoutineDiagnosisOccurrence[], spanDays: number): RoutineDiagnosis | null {
  if (occurrences.length < DIAGNOSIS_FREQUENCY_MIN_SCHEDULED) return null;
  const closed = occurrences.filter((occurrence) => occurrence.closed).length;
  const rate = closed / occurrences.length;
  if (rate > DIAGNOSIS_FREQUENCY_RATE) return null;
  if (occurrences.length - closed < DIAGNOSIS_MIN_REPEATS) return null;

  const weeks = Math.max(1, spanDays / 7);
  const suggestedPerWeek = Math.max(1, Math.round(closed / weeks));
  return Object.freeze({
    closed,
    kind: 'too_frequent' as const,
    repeats: occurrences.length - closed,
    scheduled: occurrences.length,
    suggestedPerWeek,
  });
}

/** «It stands last, and the block never reaches it.» */
function lateInChainPattern(occurrences: readonly RoutineDiagnosisOccurrence[]): RoutineDiagnosis | null {
  const missed = occurrences.filter(
    (occurrence) => !occurrence.closed
      && occurrence.blockItemCount > 1
      && occurrence.positionInBlock / occurrence.blockItemCount >= DIAGNOSIS_LATE_POSITION_SHARE,
  );
  if (missed.length < DIAGNOSIS_MIN_REPEATS) return null;

  const block = missed[0]?.plannedBlock ?? null;
  if (block === null) return null;
  return Object.freeze({
    block,
    kind: 'late_in_chain' as const,
    position: missed[0]?.positionInBlock ?? 0,
    repeats: missed.length,
  });
}

/**
 * Every pattern strong enough to be spoken about, strongest first.
 *
 * The surface shows **at most one**: the screen answers one question at a time, and a
 * list of five things wrong with a routine is a list nobody acts on. The rest are
 * returned so that a test can see them and so that «why this one» is answerable.
 */
export function diagnoseRoutine(input: Readonly<{
  occurrences: readonly RoutineDiagnosisOccurrence[];
  spanDays: number;
}>): readonly RoutineDiagnosis[] {
  const found = [
    weekdayPattern(input.occurrences),
    wrongBlockPattern(input.occurrences),
    tooFrequentPattern(input.occurrences, input.spanDays),
    crowdedBlockPattern(input.occurrences),
    lateInChainPattern(input.occurrences),
  ].filter((diagnosis): diagnosis is RoutineDiagnosis => diagnosis !== null);

  // Ranked by how much of the trouble each explains. Ties keep the order above, which
  // puts the two patterns with a one-tap fix — the weekday and the wrong block — ahead
  // of the three that ask the person to rethink something.
  return Object.freeze([...found].sort((left, right) => right.repeats - left.repeats));
}

/** The one thing worth saying, or nothing at all. */
export function bestRoutineDiagnosis(input: Readonly<{
  occurrences: readonly RoutineDiagnosisOccurrence[];
  spanDays: number;
}>): RoutineDiagnosis | null {
  return diagnoseRoutine(input)[0] ?? null;
}

/**
 * After this many returns, a break stops being an event and becomes a pattern.
 *
 * The first, second and third return are achievements — most people never come back at
 * all. The fifth in two months is not; rewarding it would put a positive reinforcement
 * on the loop «quit, return, medal», and that is how inconstancy becomes the norm. From
 * here the application stops congratulating and starts diagnosing, which is a change of
 * subject rather than of tone.
 */
export const GROWTH_REWARDED_RETURNS = 3;

export function returnDeservesReward(returns: number): boolean {
  return returns > 0 && returns <= GROWTH_REWARDED_RETURNS;
}

/**
 * When the application should offer to stop tracking a routine altogether.
 *
 * The hardest true thing it can say, and nobody in the category says it because everyone
 * profits from you tracking more. The routine stays in the diary; only the slot is freed.
 * Offered when it has broken repeatedly **and** suggestions have already been made and
 * have not helped — never on the strength of failure alone.
 */
export function shouldOfferToStopTracking(input: Readonly<{
  breaks: number;
  acceptedSuggestions: number;
}>): boolean {
  return input.breaks > GROWTH_REWARDED_RETURNS && input.acceptedSuggestions >= 2;
}
