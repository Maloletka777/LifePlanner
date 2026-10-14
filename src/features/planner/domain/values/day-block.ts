import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';

import type { PlannerLocalDate } from './local-date';

/**
 * The three parts a day is divided into.
 *
 * **A block is stored on the item, and the clock never assigns one.** That is the whole
 * reason this value exists rather than being computed from the planned minute. Derived
 * from the hour, a morning routine performed at 12:40 would be filed under «day» — and
 * then every failed morning quietly becomes an afternoon, so the pattern «mornings
 * collapse on Wednesdays» stops being computable at all. Where a thing *belongs* and when
 * it was *done* have to stay two separate facts, and only the first of them is here.
 *
 * **Absence is a fourth state, and it is a real one**: an item with no block is an
 * Anytime item, claimed by no part of the day. That is why nothing in this module invents
 * a default — `null` travels as `null`, exactly as a missing duration does.
 */
export const PLANNER_DAY_BLOCKS = Object.freeze(['morning', 'day', 'evening'] as const);

export type PlannerDayBlockKey = (typeof PLANNER_DAY_BLOCKS)[number];

/**
 * The stored form, and it is deliberately the same closed union rather than a branded
 * string.
 *
 * A brand earns its keep where any string could be passed and only some are valid — a
 * local date, a timezone. Three named values already exclude every wrong string on their
 * own, so branding them would buy nothing and cost an assignment at every boundary the
 * value crosses.
 */
export type PlannerDayBlock = PlannerDayBlockKey;

/**
 * The clock ranges a surface may use to *suggest* a block, and may never use to assign
 * one.
 *
 * They are here so that one set of hours serves the create sheet, the day view and the
 * analytics bucketing rather than three copies drifting apart. Evening runs to the start
 * of morning so the twenty-four hours are covered whole: a thing done at one in the
 * morning belongs to the evening it followed, not to nowhere.
 *
 * Four in the morning is where the day is taken to begin — the hour before which almost
 * nothing is planned — and it is the same boundary the day window already used.
 */
export const PLANNER_DAY_BLOCK_HOURS: Readonly<Record<PlannerDayBlockKey, Readonly<{ fromHour: number; toHour: number }>>> = Object.freeze({
  morning: Object.freeze({ fromHour: 4, toHour: 12 }),
  day: Object.freeze({ fromHour: 12, toHour: 17 }),
  evening: Object.freeze({ fromHour: 17, toHour: 4 }),
});

/**
 * Whether a part of **today** is already behind the clock.
 *
 * This is the one place a block becomes a deadline, and it is deliberately narrow: it
 * answers about the block's own boundary and says nothing about any item. Filing is still
 * the item's stored block and never the hour — that separation is what the whole module
 * exists to protect.
 *
 * **The evening never ends inside its own day.** It runs 17:00 → 04:00, so its boundary
 * falls on the following date and no comparison against a minute-of-day can reach it. An
 * evening item is behind only once the day itself is over, which is a different rule in a
 * different place. Returning `false` here is the honest answer rather than an omission.
 *
 * Before 04:00 nothing has ended either, and the plain comparison already says so: at
 * 01:00 the minute of day is 60, and 60 is short of every boundary.
 */
export function plannerDayBlockHasEnded(block: PlannerDayBlockKey, nowMinuteOfDay: number): boolean {
  const { toHour } = PLANNER_DAY_BLOCK_HOURS[block];
  // A block whose end wraps past midnight cannot be behind a minute measured from it.
  if (toHour <= PLANNER_DAY_BLOCK_HOURS.morning.fromHour) return false;
  return nowMinuteOfDay >= toHour * 60;
}

export function parsePlannerDayBlock(
  input: unknown,
  field = 'block',
): Result<PlannerDayBlock, PlannerDomainError> {
  if (typeof input !== 'string') return invalidDayBlock(field, 'type');
  if (!PLANNER_DAY_BLOCKS.includes(input as PlannerDayBlockKey)) return invalidDayBlock(field, 'value');
  return success(input as PlannerDayBlockKey);
}

/**
 * The block a minute falls in — a **suggestion**, never a decision.
 *
 * Callers offer this when a person sets an exact time and has not chosen a block. What
 * gets stored is what they accepted, which is why nothing here writes anything.
 */
export function suggestPlannerDayBlock(minuteOfDay: number): PlannerDayBlockKey {
  const bounded = ((Math.trunc(minuteOfDay) % 1440) + 1440) % 1440;
  const hour = Math.floor(bounded / 60);
  if (hour >= PLANNER_DAY_BLOCK_HOURS.morning.fromHour && hour < PLANNER_DAY_BLOCK_HOURS.morning.toHour) return 'morning';
  if (hour >= PLANNER_DAY_BLOCK_HOURS.day.fromHour && hour < PLANNER_DAY_BLOCK_HOURS.day.toHour) return 'day';
  return 'evening';
}

/**
 * Whether the person enjoys doing the thing.
 *
 * Recorded because enjoyment of the behaviour predicts habit strength, so a routine
 * somebody dreads is worth naming when it is taken on rather than diagnosing three weeks
 * later. Three answers and no scale: a number here would invite a threshold, and there is
 * no evidence for where one would sit.
 */
export const PLANNER_GROWTH_ENJOYMENTS = Object.freeze(['yes', 'tolerated', 'no'] as const);

export type PlannerGrowthEnjoyment = (typeof PLANNER_GROWTH_ENJOYMENTS)[number];

export function parsePlannerGrowthEnjoyment(
  input: unknown,
  field = 'enjoyment',
): Result<PlannerGrowthEnjoyment, PlannerDomainError> {
  if (typeof input !== 'string') return invalidEnjoyment(field, 'type');
  if (!PLANNER_GROWTH_ENJOYMENTS.includes(input as PlannerGrowthEnjoyment)) return invalidEnjoyment(field, 'value');
  return success(input as PlannerGrowthEnjoyment);
}

/** What a person may write as the thing they do this after. */
export const PLANNER_GROWTH_CUE_MAX_LENGTH = 120;

export function parsePlannerGrowthCue(
  input: unknown,
  field = 'cue',
): Result<string, PlannerDomainError> {
  if (typeof input !== 'string') return invalidCue(field, 'type');
  const trimmed = input.trim();
  if (trimmed.length === 0) return invalidCue(field, 'empty');
  if (trimmed.length > PLANNER_GROWTH_CUE_MAX_LENGTH) return invalidCue(field, 'range');
  return success(trimmed);
}

/**
 * One attempt at growing a routine.
 *
 * **A row is an attempt, not a routine.** Somebody who takes a habit on, stops six weeks
 * later and picks it up again in the spring has two of these, and the second starts from
 * zero of its own — because the marking is the person saying «I am taking this on now»,
 * and everything on this floor counts from `trackedFrom` rather than from the habit's
 * whole history. Overwriting one row would have erased the first attempt silently.
 *
 * `stoppedFrom` is a date rather than a flag: an attempt that ended did not stop having
 * happened, and a day inside it must still read as a day inside it.
 */
export interface PlannerHabitGrowthAttempt {
  readonly id: string;
  readonly habitId: string;
  readonly attemptNumber: number;
  readonly trackedFrom: PlannerLocalDate;
  readonly stoppedFrom: PlannerLocalDate | null;
  readonly cue: string | null;
  readonly enjoyment: PlannerGrowthEnjoyment | null;
}

/**
 * How many routines a person may be growing at once.
 *
 * Three, and it lives here rather than in a database constraint: it is a product
 * judgement that may move, and a number somebody argued about does not belong in a
 * schema that would need a migration to change it. Starting many routines at once is a
 * known way to form none of them — though the evidence for the exact figure is thinner
 * than the rule usually claims, which is why it is a value and not a wall.
 */
export const PLANNER_MAX_GROWING_ROUTINES = 3;

/** Whether an attempt covers a given day. Half-open: it ends the day it stops. */
export function isPlannerGrowthAttemptActiveOn(
  attempt: PlannerHabitGrowthAttempt,
  date: PlannerLocalDate,
): boolean {
  if (date < attempt.trackedFrom) return false;
  return attempt.stoppedFrom === null || date < attempt.stoppedFrom;
}

function invalidDayBlock(field: string, reason: string): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_day_block',
      'Choose morning, day or evening, or leave the item without a block.',
      { field, diagnostics: { reason } },
    ),
  );
}

function invalidEnjoyment(field: string, reason: string): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_growth_enjoyment',
      'Say whether you enjoy doing this, tolerate it, or do not.',
      { field, diagnostics: { reason } },
    ),
  );
}

function invalidCue(field: string, reason: string): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_growth_cue',
      `Name what you do this after, in up to ${PLANNER_GROWTH_CUE_MAX_LENGTH} characters.`,
      { field, diagnostics: { reason } },
    ),
  );
}
