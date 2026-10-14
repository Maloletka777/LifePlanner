import { PLANNER_DAY_BLOCKS, PLANNER_DAY_BLOCK_HOURS, suggestPlannerDayBlock, type PlannerDayBlockKey } from '../domain/values/day-block';

import type { DayJournalItem } from './day-journal-model';

/**
 * The day as three parts with things in them, which is what replaces the axis.
 *
 * **The axis was right about its own premise and wrong about the world.** It drew a plate
 * on its exact minute at a constant scale, which is correct only if a planned minute
 * means something — and the owner does not get up at the same time every day, so it
 * required a precision that life does not have. What people actually keep is an order:
 * this, then this, then that, somewhere in the morning.
 *
 * So a block holds a **sequence**, not a timetable. An item states how long it takes and
 * where it stands; the clock appears only where the outside world set one — a train, a
 * class, an appointment — and those are a minority of any day.
 *
 * **A block is read from the item and never from its minute.** That is the rule the whole
 * diagnosis rests on: derived from the hour, a morning routine done at 12:40 would file
 * itself under «day», and no failed morning would survive in the data to be noticed three
 * weeks later.
 */

export interface DayBlockSection {
  readonly block: PlannerDayBlockKey;
  readonly items: readonly DayJournalItem[];
  /** How many things stand here — the number in the block's own chip. */
  readonly count: number;
  /** How many are already closed, for the block's own quiet progress. */
  readonly doneCount: number;
  /**
   * How many of them the clock is already past.
   *
   * The heading is where lateness is actually noticed, and it costs the list nothing: a
   * block whose hour has gone says so once, at the top, instead of every plate under it
   * shouting. It counts the items' own `overdue`, so a thing late by its minute and a
   * thing late because this part of the day ended are one number — which is what the
   * owner's decision of 2026-08-05 made them.
   */
  readonly overdueCount: number;
  /** Minutes the block's items add up to, or `null` when none of them stated a length. */
  readonly plannedMinutes: number | null;
}

export interface DayBlockLayout {
  readonly sections: readonly DayBlockSection[];
  /**
   * Things no part of the day claims **and no clock places** — neither a block nor a
   * minute, so nothing about them says when.
   *
   * They stand above the blocks rather than below them, because an item with no block is
   * something waiting to be placed, and what is waiting belongs where it will be seen.
   * Underneath three headings it is not seen at all, which is how a real day ended up
   * hidden below three empty ones.
   */
  readonly anytime: readonly DayJournalItem[];
  readonly totalCount: number;
  readonly totalDoneCount: number;
}

/**
 * A foldable section of the day's list: the three parts, and «Когда угодно» beside them.
 *
 * Anytime is a section rather than a special case because the owner asked for the same
 * chevron on all four, and a key that has to be tested for before it can be folded is how
 * three of them end up behaving one way and the fourth another.
 */
export type DayJournalSectionKey = PlannerDayBlockKey | 'anytime';

/**
 * Order inside a block.
 *
 * An anchored item — one the outside world gave a minute — stands at its minute among the
 * items around it; everything else keeps the order the person put it in. Sorting the
 * whole block by time would be wrong twice over: most items have no time, and the ones
 * that do would drag the sequence apart for no reason the person asked for.
 *
 * Stable on the habit id, so two items with nothing to separate them never swap places
 * between renders.
 */
function orderWithinBlock(items: readonly DayJournalItem[]): readonly DayJournalItem[] {
  return [...items].sort((left, right) => {
    const leftAnchored = left.minuteOfDay !== null;
    const rightAnchored = right.minuteOfDay !== null;
    if (leftAnchored && rightAnchored) {
      const byMinute = (left.minuteOfDay ?? 0) - (right.minuteOfDay ?? 0);
      if (byMinute !== 0) return byMinute;
    }
    // An anchored item and a free one keep the sequence's own order: the anchor says
    // when that one thing happens, not that everything around it must be re-sorted.
    if (left.habitId === right.habitId) return 0;
    return left.habitId < right.habitId ? -1 : 1;
  });
}

function sectionOf(block: PlannerDayBlockKey, items: readonly DayJournalItem[]): DayBlockSection {
  const stated = items.filter((item) => item.durationMinutes !== null);
  return Object.freeze({
    block,
    count: items.length,
    doneCount: items.filter((item) => item.done).length,
    overdueCount: items.filter((item) => item.overdue).length,
    items: Object.freeze(orderWithinBlock(items)),
    // Null rather than zero when nobody stated a length: «this block takes no time» and
    // «nobody said how long these take» are different sentences, and only one is true.
    plannedMinutes: stated.length === 0
      ? null
      : stated.reduce((total, item) => total + (item.durationMinutes ?? 0), 0),
  });
}

/**
 * The day, grouped.
 *
 * Every block is returned whether or not it holds anything: an empty morning is a fact
 * about the day and a place to add to, and a block that appeared only when it had
 * contents would make the plus button move around.
 */
export function selectDayBlocks(items: readonly DayJournalItem[]): DayBlockLayout {
  const byBlock = new Map<PlannerDayBlockKey, DayJournalItem[]>();
  const anytime: DayJournalItem[] = [];

  for (const item of items) {
    // **A stated minute files the thing, where nothing was chosen.** 04–12 morning,
    // 12–17 day, 17–04 evening. An item that names a clock time is not «whenever», and
    // leaving it unplaced is what put a whole real day underneath three empty headings
    // on the owner's device. This is the sentence the contract already allowed — a
    // minute may *suggest* a block, and only where nothing was chosen — and it is not
    // DAY-2: the hour a thing was **done** still moves nothing, ever, which is the
    // reason the diagnosis can say «mornings collapse on Wednesdays» at all.
    //
    // A stored block always wins, so «this is a morning thing at 14:00» stays possible
    // for anyone who says it outright.
    const block = item.block ?? (item.minuteOfDay === null ? null : suggestPlannerDayBlock(item.minuteOfDay));
    if (block === null) {
      anytime.push(item);
      continue;
    }
    const bucket = byBlock.get(block) ?? [];
    bucket.push(item);
    byBlock.set(block, bucket);
  }

  const sections = PLANNER_DAY_BLOCKS.map((block) => sectionOf(block, byBlock.get(block) ?? []));

  return Object.freeze({
    anytime: Object.freeze(orderWithinBlock(anytime)),
    sections: Object.freeze(sections),
    totalCount: items.length,
    totalDoneCount: items.filter((item) => item.done).length,
  });
}

/**
 * How long a thing takes, said the way a person says it — `1 ч 10 м`, `25 м`, and
 * nothing at all where nobody stated a length.
 *
 * **It moved to `day-journal-model.ts` and is re-exported here.** The plate's facts line
 * now states the same kind of quantity — a length, and how long a thing has been late by
 * — and two copies of one wording is the defect this codebase keeps rediscovering. The
 * re-export is what lets every existing caller keep its import.
 */
export { blockDurationLabel } from './day-journal-model';

/**
 * How much of the day has gone, as a share of it.
 *
 * **Measured from 04:00, the same boundary the blocks use**, so the day the bar reports
 * and the day the list is divided into are one day. Measured from midnight instead, a
 * quarter of the bar would be spent before the first block even begins.
 *
 * `null` on any date but today: a day that is not happening has no elapsed part, and a
 * full bar on tomorrow would be a lie about a day that has not started.
 */
export function dayElapsedShare(nowMinuteOfDay: number | null): number | null {
  if (nowMinuteOfDay === null) return null;
  const fromFour = (((Math.trunc(nowMinuteOfDay) - PLANNER_DAY_BLOCK_HOURS.morning.fromHour * 60) % 1440) + 1440) % 1440;
  return fromFour / 1440;
}

/**
 * Which block the clock is standing in, for the header's own line.
 *
 * This is the one place a minute may name a block, and it names it for the **clock**
 * rather than for any item — nothing is filed by it.
 */
export function currentDayBlock(nowMinuteOfDay: number | null): PlannerDayBlockKey | null {
  // Delegated rather than repeated: this used to carry its own 4/12/17, which is the
  // same rule written twice and two places to forget when one of them moves.
  if (nowMinuteOfDay === null) return null;
  return suggestPlannerDayBlock(nowMinuteOfDay);
}
