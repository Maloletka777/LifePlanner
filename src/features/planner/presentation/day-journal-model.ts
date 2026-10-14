import type {
  ImportanceLevel,
  PersistedHabitAccentKey,
  PlannerChecklistsByHabit,
  PlannerDateMarkerSummary,
  PlannerHabitCatalogueItem,
  PlannerLocalDate,
  PlannerLocalTime,
  SelectedDatePlannerOccurrenceRow,
  SelectedDatePlannerRootGroup,
} from '@/src/features/planner';

// The domain module directly, not the feature barrel: this model is asserted as
// behaviour in the Node test runner, and the barrel drags React Native in with it.
import { habitAccentKeyForId } from '../domain/identity/habit-visual-identity';
import { plannerDayBlockHasEnded, type PlannerDayBlockKey } from '../domain/values/day-block';
import {
  habitCategory,
  habitCategoryDensityColor,
  habitCategoryForAccentKey,
  type HabitCategoryKey,
} from './habit-category-catalogue';
import { manageItemKind } from './manage-items-model';
import { composePlannerPresentationGroups } from './planner-presentation-groups';
import {
  movePlannerDate,
  occurrenceAction,
  plannerLocalDateFromDate,
  plannerLocalDateToDate,
  plannerRowAxisLocalTime,
  plannerRowIsCanonicallyDone,
} from './ui-adapters';

/**
 * The day journal — `design_handoff_timeline_1c`, the option the owner chose.
 *
 * **One column cannot be both a ruler and a list of text, and this is where the two
 * stop trying.** A row cannot be shorter than its text, so on a day fitted to a
 * phone one row occupied 70–100 minutes of scale; the previous journal answered that
 * by *deriving* the ruler from the layout — a monotone projection through the row
 * centres (PD-TODAY-041). The drift became zero and the price was that an hour
 * stopped being a fixed number of points and every hour label moved whenever the
 * content did. That is the «шкала соскакивает» the owner reported.
 *
 * 1c separates the two jobs instead of reconciling them:
 *
 * 1. **A pinned day bar carries the metric** — one rail, `07:00–23:00` mapped
 *    linearly across its measured width, one mark per item. It never bends, because
 *    it holds no text that could be pushed.
 * 2. **The list below carries the text** — plain vertical flow, no hour labels, no
 *    NOW line, no projection. Nothing in it can lie about a minute because it never
 *    claims one positionally: a block *states* its time rather than standing at it.
 * 3. **A hero card answers "what now, what next"** and never scrolls away.
 *
 * So there is no layout pass, no anchor list and no projection through row centres
 * left in this file. What replaces them is the rail's own arithmetic — a fixed
 * linear `x(minute)`, and a nudge-then-merge walk that keeps two marks from
 * overlapping — and it is asserted here rather than in the screen that draws it.
 *
 * **What 1c specifies and the domain cannot supply: an item's end.** The occurrence
 * read model carries `plannedLocalTime` and nothing else — a start, no length
 * (PD-CREATE-020 records the same gap for the create sheet's duration chips, and the
 * `duration` in the domain is a metric *tracking mode*, a different thing). Every
 * part of 1c that reads an `end` is therefore either derived from what does exist or
 * left unbuilt, each recorded where it happens:
 *
 * **Most of that list is now built, because schema v13 stores a length.** An item's span
 * is its plate's height, a free window is measured end-to-start and is exact, and
 * `start ≤ now < end` has both halves at last. What remains undrawn is a running item's
 * progress bar and countdown — constructible now, simply not built — and the drag, which
 * is held by owner decision D (PD-PLATE-010).
 *
 * The day-bar functions below (`dayBarWindow` aside, which the axis still asks for its
 * window) are the rail's own model and are drawn by nothing since the axis replaced it.
 * They are a bounded deletion of their own and are left standing rather than removed in
 * the same package that changed the screen underneath them.
 */

/**
 * The plate's own metric, and it is the brief's rather than a step up from the last one.
 *
 * The rows were low and the time beside them truncated to `17:...` — twice reported —
 * because the column was narrow and the height was counted from one line of text. The
 * brief answers both at **78** and **92**, and on the device that was too much of a good
 * thing twice over: the owner read the plates as oversized at 78 and again at 64.
 *
 * The row is **52**, which is not a fourth judgement about density but the height its
 * own content already comes to: 11 pt of padding, the 30 pt mark and its two lines of
 * text, 11 pt of padding. At 56 the four extra points had nowhere to go — the content
 * is top-aligned, so they pooled at the foot of every row and left everything sitting
 * two points above the box's own middle. It is still 8 pt clear of the 44 pt target its
 * controls carry. The column stays **76**.
 */
export const JOURNAL_ITEM_ROW_HEIGHT = 52;
export const JOURNAL_STEP_HEIGHT = 30;
/**
 * The header's lift.
 *
 * **At the top the header does not exist as an object**: full width, no corners, no
 * shadow, its glass fully transparent — the top of the screen rather than a panel on it.
 * Scrolling lifts it off: it comes in from the edges by the tab bar's own inset, rounds
 * to the tab bar's own radius, and its material fades in, so the two floating surfaces on
 * the screen are the same surface.
 *
 * **Travel, not duration.** Every value below is a function of the scroll offset, so the
 * panel stops where the finger stops and returns by the same path. 64 pt is roughly one
 * plate: less and the header flinches at a touch, more and the lift arrives after the
 * scroll it belongs to.
 */
/**
 * **The header follows the scroll, and lags just enough to be seen.**
 *
 * Bound rigidly to the offset it started on the first pixel and was smooth — but a fling
 * crosses the whole travel inside one frame, so the move never played. Made a two-state
 * transition instead, it played on a fling and then did nothing at all for the first
 * forty-seven points of a slow drag, which is worse: rows slid under a header that had
 * not begun to change.
 *
 * So it **chases** the offset rather than being bound to it. Every scroll event retargets
 * a short animation, and the duration is proportional to how far it still has to go: a
 * few points of drag settle in 60 ms and read as tracking, a fling has the whole 260 to
 * cross and is therefore visible. One mechanism, both behaviours, no threshold to fall
 * between.
 */
/** The header's one horizontal inset — the tab bar's, so the two floating surfaces line up. */
export const JOURNAL_HEADER_INSET = 14;
/** The air between the month row and the dates. The prototype's, measured off it. */
export const JOURNAL_WEEK_ROW_TOP = 8;
export const JOURNAL_HEADER_LIFT_TRAVEL = 64;
/** How far the header overshoots when a fast scroll returns it to the ceiling. */
export const JOURNAL_HEADER_BOUNCE = 7;
/** Pixels per scroll event that count as fast. Below it the return is plain. */
export const JOURNAL_HEADER_FAST = 9;
/** The tab bar's inset and radius, because the two are one kind of surface. */
export const JOURNAL_HEADER_LIFT_INSET = 14;
export const JOURNAL_HEADER_LIFT_RADIUS = 22;
export const JOURNAL_HEADER_LIFT_SHADOW = 0.26;
/**
 * How far the header shrinks as it closes.
 *
 * The floating plate is a smaller object than the seated header, and the prototype made
 * that visible: the week gets smaller rather than merely losing the row above it. Without
 * it the month simply goes out and nothing else acknowledges the change.
 */
export const JOURNAL_HEADER_LIFT_SCALE = 0.93;

export const JOURNAL_BLOCK_GUTTER_WIDE = 96;
/** The mark's tile, the checkbox, and the target the checkbox must fill whatever it is. */
export const JOURNAL_TILE = 30;
export const JOURNAL_CHECK = 24;
export const JOURNAL_TOUCH_TARGET = 44;

/**
 * **The plate** (PD-PLATE-001). One item, one object, one material.
 *
 * A group of its own rather than an edit to the row constants above, because those are
 * shared with Manage and Manage is rebuilt in a package of its own: a surface still on
 * the older geometry keeps reading the older names, and nothing repaints halfway.
 *
 * Two radii in the whole system and **both are derived**: the screen's 22, and the
 * plate's `22 − 10` — the ground's own padding, so a plate is concentric with the
 * screen corner it lies inside. Circles (the checkbox, a task's mark) are half of a
 * size rather than a step on the scale.
 */
export const PLATE_GROUND_PADDING = 10;
export const PLATE_RADIUS = 12;
export const PLATE_PADDING = 12;
/** Between two plates, and between a plate and whatever else is in the list. */
export const PLATE_GAP = 8;
/** Between the columns inside one: mark, words, control. */
export const PLATE_ROW_GAP = 10;
/** A minimum and never a height: a plate grows with its text and with its steps. */
export const PLATE_MIN_HEIGHT = 48;
/** The running item, and the one place structure enters the list. */
export const PLATE_HERO_MIN_HEIGHT = 56;
/**
 * **There is no time column, and its absence is the point.**
 *
 * A 44 pt column stood ahead of the mark and was reserved whether or not the item had
 * anything to put in it — so the title of every plate began 54 pt in, including the
 * majority of plates whose column was empty. It was held because the marks behind it had
 * to stand on one vertical down the block; with the mark leading, **the mark is that
 * vertical**, and the alignment is stricter rather than weaker.
 *
 * What the column carried was `time ?? duration` — one slot for two facts, so no item
 * with a clock time could ever show how long it takes. Both stand in the plate's facts
 * line now (`dayJournalPlateFacts`).
 */
export const PLATE_MARK = 32;
export const PLATE_CHECKBOX = 24;
/** Rank, as a full-height edge at the plate's leading side. High and critical only. */
export const PLATE_RANK_SPINE = 3;
/**
 * The checkbox's 44 pt target reaches the screen edge while the mark stays inside the
 * plate's padding, which is what a negative right margin is for.
 */
export const PLATE_CHECKBOX_OVERHANG = 10;
/**
 * What the steps line takes to reach a real target.
 *
 * The line is 18 pt tall and as wide as the plate's text column — wide enough already,
 * short enough to miss. It is the one control in a plate that may take a slop rather
 * than a box, because the only other control on the plate is the checkbox, and that
 * stands in a 44 pt column of its own at the far side: the two extended areas cannot
 * meet, so a near-miss can never land on the wrong one. That is the whole test
 * PD-TODAY-044 set for a slop, and this is the case that passes it.
 */
export const PLATE_STEPS_SLOP = 13;
export const PLATE_CRITICAL_DOT = 6;
export const PLATE_SUBTASK_BOX = 18;
export const PLATE_SUBTASK_ROW = 30;
export const PLATE_SUBTASK_GAP = 10;
/** A free window is one line of text at this height — no box, no border, no plate. */
export const PLATE_GAP_LINE_HEIGHT = 28;
/**
 * One of the **two** borders in the system, and it means state rather than "this is a
 * box". The other is the 1.5 pt dashed drop slot, which the drag will draw when it is
 * built; dashed is allowed nowhere else and means only "you can put something here".
 */
export const PLATE_SELECTION_RING = 2;

/**
 * The row body's own inset and the gap to its mark, which the steps have to clear.
 *
 * Here rather than in the screen because **two** surfaces lay a row out with them now:
 * the journal's block and Manage's plate. The steps' indent is derived from the three
 * of them rather than restated, so a wider column at a larger text scale carries the
 * lines with it.
 */
export const JOURNAL_BODY_PADDING = 12;
export const JOURNAL_BODY_GAP = 10;

/**
 * The row's own vertical inset and the title's leading.
 *
 * Both columns read them, which is the whole point: the time and the title begin at the
 * same y and share a line box, so they cannot drift apart the way they had.
 */
export const JOURNAL_BODY_PADDING_Y = 11;
export const JOURNAL_TITLE_LEADING = 16;

/** The two sizes that share that leading: the subject, and the metric beside it. */
export const JOURNAL_TITLE_SIZE = 15;
export const JOURNAL_TIME_SIZE = 13;

/**
 * What the time has to come down by to stand on the title's own baseline.
 *
 * Two texts of different size in the **same** line box do not share a baseline: the
 * shorter one is centred in the box with more half-leading above it and less ascender
 * below, so it sits high. Sharing a leading is what made the columns start at one `y`
 * (PD-TODAY-118) and it is not the same thing as sharing a line.
 *
 * The correction is `(title − time) × (ascent − ½)`, and it needs **no font metric**:
 * every text face has an ascent between 0.9 and 1 of its em, so for a 2 pt difference
 * the correction is 0.8–1.0 pt and **1 is inside that band for all of them**. Exact
 * where the ascent fills the em, and within 0.2 pt everywhere else — against a 0.9 pt
 * error, which is what it is there to remove.
 */
export const JOURNAL_TIME_BASELINE_NUDGE = (JOURNAL_TITLE_SIZE - JOURNAL_TIME_SIZE) / 2;

/** The day itself, which the rail's window is cut out of and never larger than. */
export const JOURNAL_DAY_MINUTES = 24 * 60;

/**
 * Where the tiniest labels stop growing.
 *
 * The 8.5–9.5 pt captions in the bar and the headers are the tightest type in the
 * application and they sit in boxes whose height the design fixes, so a label that
 * went on scaling past its box would be clipped — the lesson the old time column
 * paid for twice. Every such text carries this cap; the **list rows** carry none,
 * because they are `min-height` and already stretch.
 */
export const JOURNAL_LABEL_MAX_SCALE = 1.4;

/**
 * The block's gutter, and the width it actually needs.
 *
 * The brief fixes it at 52 pt, which holds `09:00` at 12 pt with its 10 pt of padding
 * at scale 1.0 and nothing beyond it. On device at a larger text size the time
 * truncated to `10:...`, which is the **third** time this application has learnt that a
 * time column cannot be a constant: PD-TODAY-032 paid for it at 38 pt and again at 46.
 * So the gutter grows with the scale that is actually on, capped where its own label
 * stops growing, and is never narrower than the drawn value.
 */
export const JOURNAL_BLOCK_GUTTER = 76;


// ─────────────────────────────────────────────────────────────────────────────
// The day bar: one rail, one fixed linear scale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The window the rail draws, and the whole reason the scale cannot jump: it is
 * **fixed**, not fitted to the day's content.
 *
 * `07:00 — 23:00` is the span a person plans in, and on an ordinary day it is the
 * span every page uses — so the same minute is the same distance along the rail
 * today, tomorrow and on a day with one item in it. The previous journal's window
 * was recomputed from the content, which is exactly what made an hour worth a
 * different number of points from one day to the next.
 *
 * It widens only when the day genuinely falls outside it, by **whole hours**, which
 * is what the brief's own §"Day bar model" authorises — and it always contains the
 * clock, because a rail that cannot draw `now` is worse than a slightly longer one.
 */
/**
 * **Eight in the morning to ten at night, and the window is the only lever left.**
 *
 * With a fixed hour the day's height is the window and nothing else: fourteen hours at
 * 96 pt is 1344, about two and a half screens, which is what a day costs in any calendar
 * on a phone. Nineteen would be 1824 and three and a half.
 *
 * **PD-TODAY-130's objection to a narrow window dies with the fold that caused it.** Four
 * in the morning was chosen because a widening window used to mean a *coarser* one — the
 * rail redistributed a fixed width, so every extra hour shortened every other. A fixed
 * hour redistributes nothing: widening makes the day longer and changes no distance in
 * it, so a habit at 06:00 costs two hours of scroll and costs the rest of the day nothing
 * at all. The widening rule is untouched and simply matters less.
 */
export const DAY_BAR_DEFAULT_START = 8 * 60;
export const DAY_BAR_DEFAULT_END = 22 * 60;

export interface DayBarWindow {
  readonly startMinute: number;
  readonly endMinute: number;
  readonly spanMinutes: number;
}

function wholeHourBelow(minute: number): number {
  return Math.max(0, Math.floor(minute / 60) * 60);
}

function wholeHourAbove(minute: number): number {
  return Math.min(JOURNAL_DAY_MINUTES, Math.ceil(minute / 60) * 60);
}

export function dayBarWindow(input: Readonly<{
  /** Every timed item's minute. Order does not matter. */
  minutes: readonly number[];
  /** The clock, which the rail is obliged to contain. Null on any other day. */
  nowMinuteOfDay: number | null;
}>): DayBarWindow {
  let start = DAY_BAR_DEFAULT_START;
  let end = DAY_BAR_DEFAULT_END;
  for (const minute of input.minutes) {
    if (minute < start) start = wholeHourBelow(minute);
    if (minute > end) end = wholeHourAbove(minute);
  }
  if (input.nowMinuteOfDay !== null) {
    if (input.nowMinuteOfDay < start) start = wholeHourBelow(input.nowMinuteOfDay);
    if (input.nowMinuteOfDay > end) end = wholeHourAbove(input.nowMinuteOfDay);
  }
  return Object.freeze({ endMinute: end, spanMinutes: end - start, startMinute: start });
}


/** The rail's captions: every four hours, and always both of its own ends. */
/**
 * **Only every fourth hour is named.**
 *
 * Hourly captions were tried and measured: seventeen of them across a 337 pt rail is a
 * 21 pt pitch against a 14 pt caption — seven points of air, three on the smallest
 * supported phone — which reads as a band of digits rather than as a scale. Four-hourly
 * they stand 84 pt apart with 70 of air, and the hours between them are said by the
 * ticks instead. Deliberately the same relationship a ruler has: many divisions, few
 * numbers.
 */
export const DAY_BAR_LABEL_STEP = 4 * 60;

/** Every hour is a division, whether or not it is named. */
export const DAY_BAR_TICK_STEP = 60;

export interface DayBarHourTick {
  readonly key: string;
  readonly left: number;
  readonly minuteOfDay: number;
  /** A named hour: taller, darker, and the only kind that carries a caption. */
  readonly major: boolean;
}

/** What a two-digit caption occupies, so the last one is not drawn off the rail. */
export const DAY_BAR_LABEL_WIDTH = 14;

export interface DayBarHourLabel {
  readonly key: string;
  readonly minuteOfDay: number;
  readonly text: string;
  readonly left: number;
}

/** The hour alone — `07` — because the rail's captions are a scale, not times. */
export function journalHourOnlyLabel(minuteOfDay: number): string {
  return String(Math.floor(minuteOfDay / 60) % 24).padStart(2, '0');
}


/**
 * A pin is the item itself on the rail: 20 pt, and nothing about it may extend past
 * that box except its 1 pt halo.
 *
 * State rings are **inner** borders on purpose — an outer ring on two pins 22 pt
 * apart merges into one blob.
 */
export const DAY_BAR_PIN = 24;
/** 22 pt centre to centre is the closest two marks may stand. */
export const DAY_BAR_PIN_GAP = 2;

/**
 * What a pin can say about its item beyond which item it is.
 *
 * `running` is absent deliberately: it means `start ≤ now < end`, and no item stores
 * an end. `overdue` is the repository's own rule — its minute has passed and it is
 * not closed — so the ring states something the rest of the screen already states.
 */
export type DayBarPinState = 'none' | 'overdue';

export interface DayBarPinInput {
  readonly key: string;
  readonly minuteOfDay: number;
  readonly state: DayBarPinState;
  readonly done: boolean;
  readonly kind: DayJournalItemKind;
  readonly categoryKey: HabitCategoryKey | null;
  readonly accentKey: PersistedHabitAccentKey | null;
  readonly identity: DayJournalIconIdentity | null;
}

/** The stored icon identity, exactly as the occurrence read model already carries it. */
export type DayJournalIconIdentity = SelectedDatePlannerOccurrenceRow['visualIdentity']['iconIdentity'];

export interface DayBarPin {
  readonly key: string;
  readonly left: number;
  /** The first member's minute, which is the minute the pin was placed for. */
  readonly minuteOfDay: number;
  readonly memberKeys: readonly string[];
  readonly count: number;
  /** Two or more items behind one counted chip, which carries no glyph. */
  readonly merged: boolean;
  readonly state: DayBarPinState;
  readonly allDone: boolean;
  /** The first member's, which is what a lone pin draws its shape and glyph from. */
  readonly kind: DayJournalItemKind;
  readonly categoryKey: HabitCategoryKey | null;
  readonly accentKey: PersistedHabitAccentKey | null;
  readonly identity: DayJournalIconIdentity | null;
}


export interface DayBarBracket {
  readonly key: string;
  readonly left: number;
  readonly width: number;
}


/**
 * **Free windows are not built, and an approximation would have lied.**
 *
 * 1c's §6 draws a gap as a separator, hatches it on the rail, and offers to fill it
 * with an untimed item in two taps. All three read `end`: a raw gap is
 * `[previous.end → next.start]`, and every option in the picker is filtered by the
 * untimed item's own length.
 *
 * Neither is stored. Computing the gap between consecutive **starts** instead is the
 * only arithmetic the data allows, and on the brief's own sample day it produces five
 * windows where the design has three — and one of them, `11:41 — 13:00`, opens inside
 * the item the person is in the middle of. A screen that offers an hour that is
 * already taken is worse than one that offers nothing.
 *
 * The picker is separately unbuildable and the brief says so itself: what placing an
 * untimed item into a window should *write* is an open product decision, and no
 * canonical command sets a per-date occurrence time — the same gap that blocked bulk
 * `Reschedule` and the drawn `↻`.
 *
 * What it would take: a stored item length, and a command to place an untimed item on
 * a minute. Both are domain decisions this surface does not own.
 */
export const DAY_FREE_WINDOW_NOTE = 'A window is measured from the previous item\u2019s own minute, because no item stores a length.';

/**
 * Shorter than this is rhythm rather than an opportunity, and is marked nowhere.
 *
 * **An hour**, on the owner's reading of the built day. It went to ninety on an earlier
 * one and back again: at sixty a working day showed more separators than the owner
 * wanted, and at ninety the ordinary hour between two things stopped being named at
 * all. The card reads the same constant, so the two never describe one day by two
 * rules.
 */
export const DAY_FREE_WINDOW_MINUTES = 60;

export interface DayFreeWindow {
  readonly key: string;
  readonly fromMinute: number;
  readonly toMinute: number;
  readonly minutes: number;
  /** The clock has run past the whole of it: a fact about the day, not an opening. */
  readonly past: boolean;
}


export interface DayBarHatch {
  readonly key: string;
  readonly left: number;
  readonly width: number;
}

/** Narrower than this the stripe has no room to read as one, so nothing is drawn. */
export const DAY_BAR_HATCH_MINIMUM = 6;


/** A block, or the open stretch that stands before one. */
export type DayJournalRow =
  | Readonly<{ kind: 'block'; key: string; block: DayJournalBlock }>
  | Readonly<{ kind: 'free'; key: string; free: DayFreeWindow }>;


/**
 * Which untimed items a window offers.
 *
 * **Nothing is filtered by whether it fits**, because no item stores a length — the
 * same gap the window itself is measured around. Every open untimed item is offered in
 * rank order, so the one that matters most is offered first, and the window's own start
 * is the minute a placement would set.
 */
export function dayFreeWindowOptions(input: Readonly<{
  anytime: readonly DayJournalItem[];
  limit?: number;
}>): readonly DayJournalItem[] {
  return Object.freeze(input.anytime
    .filter((item) => !item.done)
    .slice()
    .sort((left, right) => {
      const rank = JOURNAL_RANK_ORDER[right.importance] - JOURNAL_RANK_ORDER[left.importance];
      return rank !== 0 ? rank : left.habitId.localeCompare(right.habitId);
    })
    .slice(0, input.limit ?? 4));
}

// ─────────────────────────────────────────────────────────────────────────────
// The list: blocks of text that state their time rather than standing at it
// ─────────────────────────────────────────────────────────────────────────────

export type DayJournalItemKind = 'task' | 'habit';

/**
 * A subtask: a line of text with a tick for the day being read.
 *
 * It used to be a whole habit — an ordinary child with its own schedule and its
 * own observations, which is how a checklist became able to reach a statistic.
 * It is a line now, and the two tables it lives in are read by nothing that
 * computes a record.
 */
export interface DayJournalStep {
  /** The checklist line's own id, which is what a tick is written against. */
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

export interface DayJournalItem {
  readonly habitId: string;
  readonly row: SelectedDatePlannerOccurrenceRow;
  readonly title: string;
  readonly kind: DayJournalItemKind;
  /** Null when the stored accent names no category — the item then keeps its own. */
  readonly categoryKey: HabitCategoryKey | null;
  /** The stored accent, which is what an item painted before categories still has. */
  readonly accentKey: PersistedHabitAccentKey | null;
  /** The axis time — the fact where there is one, the plan otherwise. */
  readonly localTime: string | null;
  readonly minuteOfDay: number | null;
  readonly done: boolean;
  readonly overdue: boolean;
  /**
   * The item's own minute has gone, **whether or not it was closed**.
   *
   * `overdue` cannot answer this: it is false the moment a thing is ticked. A line
   * inside an item whose hour has passed is behind even when the item itself was
   * closed, and that is the one case the row's own state cannot describe.
   */
  readonly elapsed: boolean;
  /**
   * Minutes since its own start, or null where it has not passed or has no minute.
   *
   * The plate's second line states `Overdue · 1 h 17 m ago` from this, and it is the
   * **only** derived figure the design draws — everything else it wanted (a progress
   * bar, a countdown, an interval) reads an end no item stores.
   */
  readonly overdueMinutes: number | null;
  /**
   * Late because **its part of the day is over**, rather than because a minute passed.
   *
   * Both are `overdue` and both are drawn in the alarm colour — that was the owner's
   * decision of 2026-08-05: either lateness applies to blocks too or it is withdrawn
   * altogether. The distinction survives here because the two say different sentences.
   * A minute supports «опоздание 1 ч 40 м»; a block boundary does not — nobody missed a
   * morning habit *by* three hours, the morning simply ended — so a block-late item says
   * «утро прошло», which is the cause rather than an arithmetic nobody meant.
   */
  readonly blockOverdue: boolean;
  /**
   * Which part of the day the item belongs to, or `null` for an Anytime item.
   *
   * Read from the item rather than derived from its minute, and that is the whole
   * reason it is stored: a morning routine done at 12:40 stays a morning routine, so a
   * failed morning survives in the data long enough to be noticed.
   */
  readonly block: PlannerDayBlockKey | null;
  /**
   * How long this is meant to take, or `null` when nobody stated a length.
   *
   * Read from the same effective-dated version the minute is (schema v13), so a day
   * drawn in the past shows the length that day was planned with rather than today's.
   * `null` is «unknown» and is drawn as absence — never as a default half hour.
   */
  readonly durationMinutes: number | null;
  /** A reminder is stored against this item, and the row states the minute it fires. */
  readonly reminderLocalTime: string | null;
  readonly importance: SelectedDatePlannerOccurrenceRow['importance'];
  readonly steps: readonly DayJournalStep[];
  /** A derived routine container carries no action of its own (ADR-007). */
  readonly completable: boolean;
  /** Whether a closed item may be opened again — false on a day that is over. */
  readonly reopenable: boolean;
  /** A counter, quantity, duration or avoidance habit is recorded through the entry modal. */
  readonly measured: boolean;
}

/**
 * One block per **start minute**, and items that share a minute share one block.
 *
 * That is what retires the "tasks are overlapping" problem rather than detecting it:
 * two items at 15:00 are two rows of one block, the block states the minute once in
 * its gutter, and there is nothing left for an overlap to be constructed out of.
 */
export interface DayJournalBlock {
  readonly key: string;
  readonly minuteOfDay: number;
  readonly localTime: string;
  readonly items: readonly DayJournalItem[];
  readonly overdue: boolean;
  /**
   * The highest rank the block carries, which its gutter is tinted and spined by — so
   * the list's left margin reads as a profile of the day's importance.
   */
  readonly rank: ImportanceLevel;
}


/**
 * Rank, and the order it is read in.
 *
 * The two top ranks are the only ones that colour anything: `low` and `normal` are
 * silent, because a marker beside every item ranks nothing. High is **amber** and
 * critical is **rust** — they used to be two steps of one red, which a glance cannot
 * order — and each carries its own word, so rank is never colour alone
 * (PD-PRIORITY-003).
 */
export const JOURNAL_RANK_ORDER: Readonly<Record<ImportanceLevel, number>> = Object.freeze({
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
});

/** Whether this rank says anything: only the top two are drawn. */
export function journalRankIsDrawn(rank: ImportanceLevel): boolean {
  return rank === 'high' || rank === 'critical';
}



export interface DayJournalTally {
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
}

/**
 * The day's arithmetic, which lives in the day header **because nothing there moves**.
 *
 * It counted the timed items in the brief and it counts them here: the untimed block
 * states its own count in its own header, so neither figure stands for the other and
 * nothing is hidden by the split.
 */
export function dayJournalTally(items: readonly DayJournalItem[]): DayJournalTally {
  let done = 0;
  let overdue = 0;
  for (const item of items) {
    if (item.done) done += 1;
    if (item.overdue) overdue += 1;
  }
  return Object.freeze({ done, overdue, total: items.length });
}

// ─────────────────────────────────────────────────────────────────────────────
// The hero: the one-second answer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the NOW card is about.
 *
 * ```
 * free    — the day is clear until whatever comes next
 * closed  — nothing is left ahead
 * ```
 *
 * **The card is never about a missed item.** Overdue belongs to the list, where each
 * late row says so in its own words and its own weight and where it can be acted on;
 * repeating it at the top of the screen said the same thing twice in the place least
 * able to do anything about it. So the subject is drawn from what is still **ahead**,
 * and the strip's `N of M done` is what keeps a day with things behind it from reading
 * as a day with nothing in it.
 *
 * **`free` is also what closing something early produces.** Tick the thing you are in
 * the middle of and the time it was going to take is yours: the card names how long the
 * run lasts and what ends it, rather than jumping to the next item as though the gap
 * were not there. How much of the run came from the item just closed is not knowable —
 * that needs the same stored end everything else here needs — so what is stated is the
 * run to the next planned minute, which is true either way.
 *
 * The order is the point. Deriving the state from one item let the card announce
 * `FREE` while the header two rows below counted seven overdue — "the one thing a
 * screen built to answer «что сейчас» must never do".
 *
 * **`running` is missing from that list, and it is the design's one real casualty.**
 * The card's first state is about the item the clock is *inside*, which needs
 * `start ≤ now < end`; an item stores no end (PD-CREATE-020). `late` is the nearest
 * state the data supports and it is not a substitute invented here — it is the
 * repository's own `overdue`, and the design added exactly this state in its own
 * second pass for the same reason. So `late` is built to the design's specification
 * and `running` is absent, along with the progress bar that only it carries.
 */
export type DayJournalHeroKind = 'running' | 'free' | 'behind' | 'closed';

export interface DayJournalHero {
  readonly kind: DayJournalHeroKind;
  /** The item the card is about, and whose control it carries. Null when `closed`. */
  readonly subject: DayJournalItem | null;
  /**
   * The timer beside the title: how late the subject is, or how long the day is clear.
   *
   * Null when `closed`. Both readings are arithmetic over an item's own minute, which
   * is the only end of an interval the domain stores.
   */
  readonly timerMinutes: number | null;
  /** Where the clear run ends: the next planned minute. Null unless `free`. */
  readonly freeUntilMinuteOfDay: number | null;
  /**
   * Whether the run is long enough to be worth calling free.
   *
   * **The same threshold the list uses**, or the two describe one day by two rules: the
   * separators say nothing about a stretch under an hour and a half while the card
   * announced three minutes in a nineteen-point headline. Under it the card is about
   * the thing that is coming instead, which is true either way and is the more useful
   * of the two sentences when the gap is short.
   */
  readonly freeIsWorthSaying: boolean;
  /**
   * How far through the running item the clock is, from 0 to 1, or null.
   *
   * **Constructible at last.** `start ≤ now < end` needs an end, and five packages
   * recorded its absence as the reason this state could not exist (PD-TODAY-058,
   * `-069`, `-098`, PD-CREATE-020). Schema v13 stores the length, so the share is
   * arithmetic over two stored values rather than a figure invented on the spot.
   */
  readonly runningShare: number | null;
  /** Minutes left of the running item, or null. Never negative and never invented. */
  readonly runningLeftMinutes: number | null;
  /**
   * How far through the **wait** the clock is, from 0 to 1, or null.
   *
   * A line that only moves while something runs is a line that stands still for most of
   * a day — and the owner reported exactly that: it hangs on «starts in N» and does not
   * budge. The wait has a shape as real as the task's: it runs from the end of the last
   * thing to the start of the next, both stored, so the bar moves every minute of it.
   */
  readonly waitShare: number | null;
  /** How many of the day's timed things are still open. */
  readonly openCount: number;
  /** How many of the day's timed items are closed, for `N of M done`. */
  readonly doneCount: number;
  readonly itemCount: number;
  /** Which block the page opens on, or null when there is nothing to open on. */
  readonly focusMinuteOfDay: number | null;
}

export function dayJournalHero(input: Readonly<{
  /** Timed items, in any order. */
  items: readonly DayJournalItem[];
  /** Null on a day that is not today, which is what makes the card a plan. */
  nowMinuteOfDay: number | null;
  window: DayBarWindow;
}>): DayJournalHero | null {
  const sorted = input.items
    .filter((item) => item.minuteOfDay !== null)
    .slice()
    .sort((left, right) => (left.minuteOfDay ?? 0) - (right.minuteOfDay ?? 0));
  const now = input.nowMinuteOfDay;

  // **The card is about now, so it exists only on today and only where there is
  // something for it to be about.** On another date it is not empty, it is absent —
  // the day's own header still counts what is there, and a card headed `NOW` on a
  // Thursday three weeks out is a contradiction rather than a summary. A day with
  // nothing timed is the same case: every rule the card has is about a minute.
  if (now === null || sorted.length === 0) return null;

  // **The primary is the highest rank, then whatever started earliest.** The oldest
  // open item is the one that has been waiting longest; rank outranks age, because a
  // critical thing left open is what the card exists to say.
  // **Inclusive of the current minute**, or an item standing exactly on the clock is
  // neither open past its minute nor still to come: for that one minute the card would
  // have named the item *after* it and reported the day as free until then, which is
  // the larger of the two available falsehoods. An item due this very minute is next.
  /**
   * **The item the clock is inside**, which the card could never name before.
   *
   * Half-open on both ends, the same rule the drum cuts the day by and the axis divides
   * width by: a thing starting exactly on the clock has not begun, and a thing ending on
   * it is over. A closed item is not running — closure is what the person said about it,
   * and the clock does not overrule that. An item with no stated length cannot be
   * running, because nothing says when it would stop.
   */
  const running = sorted.find((item) => {
    if (item.done || item.durationMinutes === null || item.durationMinutes <= 0) return false;
    const start = item.minuteOfDay ?? 0;
    return start <= now && now < start + item.durationMinutes;
  });

  // **The primary is the highest rank, then whatever started earliest.** The oldest
  // open item is the one that has been waiting longest; rank outranks age, because a
  // critical thing left open is what the card exists to say.
  // **Inclusive of the current minute**, or an item standing exactly on the clock is
  // neither open past its minute nor still to come: for that one minute the card would
  // have named the item *after* it and reported the day as free until then, which is
  // the larger of the two available falsehoods. An item due this very minute is next.
  const ahead = sorted.find((item) => !item.done && (item.minuteOfDay ?? 0) >= now);
  const subject = running ?? ahead;
  /**
   * **`closed` is a claim, and it has to be true.**
   *
   * Reported from a device: the header read `DAY CLOSED` with four things open and
   * overdue on the screen beneath it. Nothing being *ahead* is not the day being over —
   * it only means the clock has passed everything. PD-TODAY-109 keeps the card off the
   * subject of a missed item, and it still does: what is said is a count, which is a fact
   * about the day rather than a name the list already carries.
   */
  const openCount = sorted.filter((item) => !item.done).length;
  const kind: DayJournalHeroKind = running !== undefined
    ? 'running'
    : ahead !== undefined ? 'free' : openCount > 0 ? 'behind' : 'closed';
  const runningLeft = running === undefined
    ? null
    : Math.max(0, (running.minuteOfDay ?? 0) + (running.durationMinutes ?? 0) - now);
  const runningShare = running === undefined || running.durationMinutes === null
    ? null
    : Math.min(1, Math.max(0, (now - (running.minuteOfDay ?? 0)) / running.durationMinutes));

  /**
   * The wait's own span: from where the last thing was over to where the next begins.
   *
   * A thing with no stated length ends where it starts, so it cannot lengthen a wait by
   * a duration nobody gave it — the same rule the axis measures free stretches by.
   */
  const waitFrom = running !== undefined || ahead === undefined
    ? null
    : sorted
      .filter((item) => (item.minuteOfDay ?? 0) < (ahead.minuteOfDay ?? 0))
      .reduce<number | null>((end, item) => {
        const over = (item.minuteOfDay ?? 0) + (item.durationMinutes ?? 0);
        return end === null || over > end ? over : end;
      }, null);
  const waitShare = ahead === undefined || waitFrom === null || (ahead.minuteOfDay ?? 0) <= waitFrom
    ? null
    : Math.min(1, Math.max(0, (now - waitFrom) / ((ahead.minuteOfDay ?? 0) - waitFrom)));

  return Object.freeze({
    doneCount: sorted.filter((item) => item.done).length,
    // The page still opens on whatever is behind when there is something behind: the
    // card is not about it, and the scroll is not the card's to decide.
    focusMinuteOfDay: (sorted.find((item) => item.overdue) ?? subject ?? sorted[0])?.minuteOfDay ?? null,
    // A run that is already under way is not free time, whatever its length.
    freeIsWorthSaying: running === undefined && ahead !== undefined
      && (ahead.minuteOfDay ?? 0) - now >= DAY_FREE_WINDOW_MINUTES,
    freeUntilMinuteOfDay: running === undefined ? ahead?.minuteOfDay ?? null : null,
    itemCount: sorted.length,
    kind,
    openCount,
    runningLeftMinutes: runningLeft,
    runningShare,
    waitShare,
    subject: subject ?? null,
    // Running, the timer counts down what is left; ahead, it counts up to the start.
    timerMinutes: running !== undefined
      ? runningLeft
      : ahead === undefined ? null : Math.max(1, (ahead.minuteOfDay ?? 0) - now),
  });
}

// `dayJournalFocusScrollOffset` is gone with the opening scroll it existed for. It was
// the last consumer of the pane, content and block measurements, and keeping a function
// whose only caller has been deleted is how a green suite ends up describing a page
// nobody draws.


// ─────────────────────────────────────────────────────────────────────────────
// Times, durations and the day's items
// ─────────────────────────────────────────────────────────────────────────────

export function journalMinuteOfLocalTime(localTime: string | null): number | null {
  if (localTime === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) return null;
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3, 5));
}

export function journalLocalTimeOfMinute(minuteOfDay: number): string {
  const bounded = Math.max(0, Math.min(24 * 60 - 1, Math.trunc(minuteOfDay)));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

/**
 * The journey a drop should hold when it is standing still at a known place.
 *
 * **It exists because a measured value with an unrevised consumer is this file's most
 * expensive recurring defect.** At mount the week row has no width, so the journey is
 * initialised with `fromX: 0, toX: 0`; the width arrives a frame later and `scrollX` is
 * re-seeded from it, but nothing ever revisited the journey. The drop therefore
 * interpolated to 0 while the strip stood ~18 800 pt along, and was drawn that far off
 * the leading edge — no drop at launch, and no digit inverted either, because the digits
 * invert for wherever the drop says it is. The first date change hid it by building a
 * journey with real endpoints.
 *
 * **The input range is carried through untouched.** `travel` is monotonic and every
 * reader must be bound to the range it is actually standing in; rewriting the range here
 * to something tidy like `[0, 1]` is precisely the failure that empties the screen.
 * Collapsing the two *outputs* makes the interpolation a constant wherever the value is.
 *
 * `null` means «already there», so the caller can skip a render rather than scheduling
 * one that changes nothing.
 */
export function journalParkedJourney<T extends { readonly fromX: number; readonly toX: number }>(
  journey: T,
  at: number,
): T | null {
  if (journey.fromX === at && journey.toX === at) return null;
  return { ...journey, fromX: at, toX: at };
}

/**
 * A length of time, in the wording the rest of the application already uses:
 * `15 min`, `1 h`, `1 h 19 m` — the same forms Overview's own deltas take, so two
 * surfaces do not spell the same quantity two ways.
 */
export function journalDurationLabel(minutes: number): string {
  const bounded = Math.max(0, Math.round(minutes));
  if (bounded < 60) return `${bounded} min`;
  const hours = Math.floor(bounded / 60);
  const rest = bounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

/**
 * How long a thing takes, said the way a person says it: `1 ч 10 м`, `25 м`.
 *
 * `null` where nobody stated a length — an item with no duration prints no duration
 * rather than a zero or a guess. It is the plate's own wording for **every** quantity of
 * minutes, so a length and a lateness are spelt one way.
 */
export function blockDurationLabel(minutes: number | null): string | null {
  // **`Number.isFinite`, not `=== null`.** The guard used to be `minutes === null ||
  // minutes <= 0`, and `undefined <= 0` is `false` — so a row whose duration was absent
  // rather than explicitly null fell straight through and printed `NaN ч NaN м` on the
  // plate. Found by a test that read the value off a row instead of asserting the source.
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * **The facts a plate states, in one order, and only the ones that exist.**
 *
 * This replaces `dayJournalSecondLine`, which offered **one** slot in strict priority —
 * late, then steps, then reminder — so a reminder simply vanished from anything overdue
 * or anything with steps, and a length vanished from everything that had a clock time
 * (the lead column carried `time ?? duration`). Five facts were competing for two places
 * and three of them lost silently.
 *
 * They stand in a row now, in the order the owner asked for: **time → duration →
 * reminder → steps**, with lateness attached to the clock it belongs to. Absence costs
 * nothing, because an absent fact is not rendered rather than rendered empty — the same
 * rule the second line already carried, and the reason the title used to hang against the
 * top of the plate when a slot was reserved for it.
 *
 * The kind travels beside the text because the view treats them differently: `steps` is
 * the control that expands the list, `late` and `blockPast` are drawn in the alarm
 * colour, and `time` is the one fact set in a heavier weight so a start cannot be
 * mistaken for the bell beside it.
 *
 * **How a thing repeats is still not said here.** `Every day` was the old line's last
 * fallback, so it was the line nearly every habit wore, and it says only what the item's
 * own shape already says (PD-TODAY-112). The rule lives in the editor.
 */
export type DayJournalFactKind = 'time' | 'late' | 'duration' | 'reminder' | 'steps';

export interface DayJournalFact {
  readonly kind: DayJournalFactKind;
  readonly text: string;
}

export function dayJournalPlateFacts(item: DayJournalItem): readonly DayJournalFact[] {
  /**
   * **A late item says one word and stops.**
   *
   * Owner instruction, 2026-08-05: «ничего кроме overdue выводить при просрочке не нужно».
   * It reads as a rule about wording and is really a rule about *volume*. Counted off the
   * device: one screen carried twelve red elements — four block-past captions, six red
   * checkbox rings, two heading counts — for a single underlying fact, that a part of the
   * day had ended with things still open in it. A late row used to print its minute, how
   * late it was and its bell, each of the three in the alarm colour.
   *
   * So lateness is one fact and the rest of the row's facts stand down while it is true.
   * Nothing is lost that the person cannot get: the minute, the length and the bell are
   * all in the editor a tap away, and **the block heading still counts** — which is the
   * one place lateness is worth saying out loud, once per block rather than once per row.
   */
  if (item.overdue) return Object.freeze([{ kind: 'late' as const, text: 'Overdue' }]);

  const facts: DayJournalFact[] = [];
  // 1 · The minute the outside world set, where it set one.
  if (item.localTime !== null) facts.push({ kind: 'time', text: item.localTime });
  // 2 · How long it takes — the fact a person can actually answer, and the one the old
  //     lead column could never show beside a clock time.
  const duration = blockDurationLabel(item.durationMinutes);
  if (duration !== null) facts.push({ kind: 'duration', text: duration });
  // 3 · When the operating system will say something. It carries the bell in the view,
  //     which is what keeps it from reading as a second start time.
  if (item.reminderLocalTime !== null) facts.push({ kind: 'reminder', text: item.reminderLocalTime });
  // 4 · The steps, last, because it is a control rather than a fact and the eye should
  //     reach the facts before the thing it can press.
  if (item.steps.length > 0) {
    facts.push({ kind: 'steps', text: `${item.steps.filter((step) => step.done).length} of ${item.steps.length}` });
  }
  return Object.freeze(facts);
}

/**
 * Compose the day's items from the canonical read model.
 *
 * A root group is one journal entry and its ordinary children are its steps — the
 * same composition Planner draws, so a routine that is done on one surface is done
 * on the other. Completion and action availability are read through the shared
 * canonical rules rather than from `state` directly (PD-HABIT-002, PD-HABIT-005).
 */
export function selectDayJournalItems(input: Readonly<{
  rootGroups: readonly SelectedDatePlannerRootGroup[];
  taskHabitIds: ReadonlySet<string>;
  /** Absent is the same as empty: an item with no reminder simply states none. */
  reminderLocalTimes?: ReadonlyMap<string, PlannerLocalTime>;
  nowMinuteOfDay: number | null;
  /** Whether the day being read is already over. Absent reads as "not over". */
  dayIsPast?: boolean;
  /** The subtasks of each item as they stand on this day. */
  checklists?: PlannerChecklistsByHabit;
}>): Readonly<{ timed: readonly DayJournalItem[]; anytime: readonly DayJournalItem[] }> {
  const timed: DayJournalItem[] = [];
  const anytime: DayJournalItem[] = [];
  for (const group of composePlannerPresentationGroups(input.rootGroups)) {
    const parentRow = groupParentRow(group.root);
    if (parentRow === null) continue;
    // Subtasks come from their own query, never from the day's groups: what
    // computes a record cannot count a line it never loads.
    const steps = (input.checklists?.get(parentRow.habitId) ?? []).map<DayJournalStep>((line) => Object.freeze({
      done: line.done,
      id: line.id,
      title: line.text,
    }));
    const localTime = plannerRowAxisLocalTime(parentRow);
    const minuteOfDay = journalMinuteOfLocalTime(localTime);
    const done = plannerRowIsCanonicallyDone(parentRow);
    const isTask = input.taskHabitIds.has(parentRow.habitId);
    // Only a thing with no clock of its own is judged by its block: where there is a
    // minute the minute is the sharper fact and already answers.
    const blockOverdue = !done
      && minuteOfDay === null
      && parentRow.plannedBlock !== null
      && input.nowMinuteOfDay !== null
      && !(input.dayIsPast ?? false)
      && plannerDayBlockHasEnded(parentRow.plannedBlock, input.nowMinuteOfDay);
    const item: DayJournalItem = Object.freeze({
      habitId: parentRow.habitId,
      row: parentRow,
      title: parentRow.name,
      kind: isTask ? 'task' : 'habit',
      // An item saved before accents were persisted has none stored. The rest of
      // the application gives it the automatic accent of its own id rather than a
      // neutral, and so does this — otherwise every one of them shared one colour,
      // which is what made the timeline look as though colour was not applied.
      accentKey: parentRow.visualIdentity.persistedAccentKey ?? habitAccentKeyForId(parentRow.habitId),
      categoryKey: habitCategoryForAccentKey(parentRow.visualIdentity.persistedAccentKey)?.key ?? null,
      localTime,
      minuteOfDay,
      done,
      elapsed: minuteOfDay !== null && input.nowMinuteOfDay !== null && minuteOfDay < input.nowMinuteOfDay,
      overdue: !done && (
        (minuteOfDay !== null && input.nowMinuteOfDay !== null && minuteOfDay < input.nowMinuteOfDay)
        // **A part of the day is a deadline too.** Owner decision, 2026-08-05: either
        // lateness covers the things that live in a block without a clock time, or the
        // whole idea is withdrawn. An item with no minute could never be late however
        // far the day ran — a morning habit was still merely «not done» at eleven at
        // night — and that was the larger half of every day going unmeasured.
        //
        // It reads the **stored** block and nothing else. An item with no block is an
        // Anytime item and stays outside this: «когда угодно» is not a deadline, and
        // inventing one from a minute would be the derivation the whole module refuses.
        || blockOverdue
        // **A task has a deadline; a habit has a rhythm.** A task left open on a
        // day that is over is overdue for as long as it stays open, whether or
        // not it carried a time — it stays on the day it was planned for, and
        // that day says so. A habit missed yesterday is simply not done: it has
        // no deadline to have passed, and painting every past day red would say
        // it did.
        //
        // **Recorded seam:** the clause above makes a morning habit late at 12:01 and
        // this one lets it stop being late at midnight. That is defensible — on its own
        // day lateness is actionable and on a past day it is history — but it is a seam
        // rather than one rule, and it is written down rather than smoothed over.
        || ((input.dayIsPast ?? false) && isTask)
      ),
      blockOverdue,
      // **How long it has been late, and it is the one derived figure on the plate.**
      // It is time *since the start* — computed from the only value an item stores —
      // rather than a countdown, a progress share or a remaining time, all of which
      // would need an end no item carries (PD-CREATE-020).
      overdueMinutes: minuteOfDay !== null && input.nowMinuteOfDay !== null && minuteOfDay < input.nowMinuteOfDay
        ? input.nowMinuteOfDay - minuteOfDay
        : null,
      durationMinutes: parentRow.plannedDurationMinutes,
      block: parentRow.plannedBlock,
      reminderLocalTime: input.reminderLocalTimes?.get(parentRow.habitId) ?? null,
      importance: parentRow.importance,
      steps: Object.freeze(steps),
      completable: isCheckboxAction(parentRow),
      // **A day that is over keeps what was recorded on it.** Ticking a past day is
      // allowed and says what it costs (PD-JOURNAL-002); *unticking* one is editing
      // what happened, from a screen with no way to say why — and the mark is already
      // counted toward nothing, so there is nothing to undo but the record itself.
      reopenable: !(done && (input.dayIsPast ?? false)),
      measured: isMeasuredAction(parentRow),
    });
    if (minuteOfDay === null) anytime.push(item); else timed.push(item);
  }
  return Object.freeze({
    timed: Object.freeze(timed.sort((left, right) => (left.minuteOfDay ?? 0) - (right.minuteOfDay ?? 0))),
    anytime: Object.freeze(anytime),
  });
}

function groupParentRow(group: SelectedDatePlannerRootGroup): SelectedDatePlannerOccurrenceRow | null {
  return group.rows.find((row) => row.habitId === group.rootHabitId) ?? group.rows[0] ?? null;
}

function isCheckboxAction(row: SelectedDatePlannerOccurrenceRow): boolean {
  const action = occurrenceAction(row);
  return action.kind === 'record_checkbox' || action.kind === 'correct_checkbox';
}

function isMeasuredAction(row: SelectedDatePlannerOccurrenceRow): boolean {
  const action = occurrenceAction(row);
  return action.kind === 'choose_avoidance'
    || action.kind === 'add_counter'
    || action.kind === 'add_quantity'
    || action.kind === 'add_duration';
}

/**
 * When each item will wake the person, read from the catalogue the journal already has.
 *
 * A reminder belongs to the habit rather than to one of its days, so it is not on
 * the occurrence read model and does not need to be: the journal loads the
 * catalogue anyway, for its task detection and its density marks.
 *
 * **What it promises is a stored plan, not a delivered alert.** No notification
 * package is a dependency of this project, so nothing fires (PD-CREATE-019); the
 * create sheet says so in as many words, and the row's bell says exactly what the
 * sheet recorded and no more.
 */
export function dayJournalReminderLocalTimes(
  catalogue: readonly PlannerHabitCatalogueItem[],
): ReadonlyMap<string, PlannerLocalTime> {
  const reminders = new Map<string, PlannerLocalTime>();
  for (const item of catalogue) {
    if (item.reminderLocalTime !== null) reminders.set(item.habitId, item.reminderLocalTime);
  }
  return reminders;
}

export function dayJournalTaskHabitIds(catalogue: readonly PlannerHabitCatalogueItem[]): ReadonlySet<string> {
  const tasks = new Set<string>();
  // One definition of what a task is, shared with Manage rather than restated:
  // two copies of this rule are two chances for the two screens to disagree about
  // what a thing is, and they draw the same node from the answer.
  for (const item of catalogue) if (manageItemKind(item) === 'task') tasks.add(item.habitId);
  return tasks;
}

/** Monday-first weekday index, so the strip never re-centres on the selection. */
export function journalWeekdayIndex(date: PlannerLocalDate): number {
  return (plannerLocalDateToDate(date).getDay() + 6) % 7;
}

export function journalWeekStart(date: PlannerLocalDate): PlannerLocalDate {
  return movePlannerDate(date, -journalWeekdayIndex(date));
}

export function journalWeekDates(weekStart: PlannerLocalDate): readonly PlannerLocalDate[] {
  return Object.freeze([0, 1, 2, 3, 4, 5, 6].map((offset) => movePlannerDate(weekStart, offset)));
}

/**
 * How many weeks the strip holds each side of the one it opened on.
 *
 * The strip used to be three pages recycled around the selection, and every
 * settle rebuilt their contents and scrolled back to the middle. `scrollTo` is a
 * command to the native list rather than something that happens with the render,
 * so the offset and the content disagreed for a frame however that was ordered —
 * which is the flinch, and why it came and went with the timing rather than with
 * the direction. **A year each way is written once and never rebuilt**, so there
 * is nothing to re-centre and nothing to disagree. The list windows what it draws.
 */
export const JOURNAL_WEEK_RAIL_RADIUS = 52;

export function journalWeekRail(anchorWeekStart: PlannerLocalDate): readonly PlannerLocalDate[] {
  return Object.freeze(Array.from(
    { length: JOURNAL_WEEK_RAIL_RADIUS * 2 + 1 },
    (_unused, index) => movePlannerDate(anchorWeekStart, (index - JOURNAL_WEEK_RAIL_RADIUS) * 7),
  ));
}

/**
 * How far the calendar's rail reaches either way — two years, which is the same shape the
 * week strip already uses and for the same reason.
 */
export const JOURNAL_MONTH_RAIL_RADIUS = 24;

/**
 * **A stable rail of months, and it is what replaces a three-page carousel.**
 *
 * The sheet used to hold exactly the month shown and its two neighbours, re-centring on
 * every settle. That pattern is fragile by construction and it failed in the way it always
 * fails: on each change **two of the three pages unmount and one moves index**, and the
 * `scrollTo` that re-centres is issued against a subtree whose native views are being
 * rebuilt in the same commit. The offset and the content then drift apart by exactly one
 * page — «назад и всё ещё август, а вперёд и стал июль», which is one settle of lag,
 * reported exactly.
 *
 * A rail has nothing to re-centre. Every month keeps its identity for the life of the
 * sheet, the page index *is* the answer, and the anchor is read from it rather than
 * accumulated. There is no ordering left between a native scroll and a React commit,
 * because nothing about the content depends on where the scroll is.
 *
 * **This is the week strip's own pattern**, ten lines away in this same file, and it has
 * been carrying the date rail without a paging defect since it was written.
 */
export function journalMonthRail(anchorMonth: PlannerLocalDate): readonly PlannerLocalDate[] {
  return Object.freeze(Array.from(
    { length: JOURNAL_MONTH_RAIL_RADIUS * 2 + 1 },
    (_unused, index) => journalMoveMonth(anchorMonth, index - JOURNAL_MONTH_RAIL_RADIUS),
  ));
}

/** Where a month stands on a rail, or `-1` if the rail does not reach it. */
export function journalMonthRailIndex(rail: readonly PlannerLocalDate[], month: PlannerLocalDate): number {
  const target = journalMoveMonth(month, 0);
  return rail.findIndex((entry) => entry === target);
}

export const JOURNAL_WEEKDAY_LETTERS = Object.freeze(['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const);

const MONTH_NAMES = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

/**
 * The month a week mostly belongs to, not the month it happens to open in.
 *
 * The brief names the week by its first day, so 27 July – 2 August reads `July`
 * even though six of its seven days are August — the header then disagreed with
 * almost every date under it. The dominant month is the one that holds more of the
 * week, and a seven-day week can never split evenly, so there is no tie to break
 * and no rule needed for one. **Supersedes the first-day rule.**
 */
export function journalDominantMonthDate(weekDates: readonly PlannerLocalDate[]): PlannerLocalDate {
  const counted = new Map<string, Readonly<{ date: PlannerLocalDate; days: number }>>();
  for (const date of weekDates) {
    const month = date.slice(0, 7);
    const seen = counted.get(month);
    counted.set(month, { date: seen?.date ?? date, days: (seen?.days ?? 0) + 1 });
  }
  let dominant = weekDates[0];
  let most = 0;
  for (const { date, days } of counted.values()) {
    if (days > most) {
      most = days;
      dominant = date;
    }
  }
  return dominant;
}

/**
 * The month of a given date, written out. The week's own heading comes from
 * `journalDominantMonthDate`; a month sheet names the month it is showing.
 */
export function journalMonthLabel(anyDateInMonth: PlannerLocalDate): string {
  const date = plannerLocalDateToDate(anyDateInMonth);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** The month grid the sheet draws: leading blanks, then every day of the month. */
export function journalMonthCells(anyDateInMonth: PlannerLocalDate): readonly (PlannerLocalDate | null)[] {
  const date = plannerLocalDateToDate(anyDateInMonth);
  const year = date.getFullYear();
  const month = date.getMonth();
  const lead = (new Date(year, month, 1, 12).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0, 12).getDate();
  const cells: (PlannerLocalDate | null)[] = [];
  for (let index = 0; index < lead; index += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) cells.push(plannerLocalDateFromDate(new Date(year, month, day, 12)));
  return Object.freeze(cells);
}

export function journalMoveMonth(anyDateInMonth: PlannerLocalDate, offset: number): PlannerLocalDate {
  const date = plannerLocalDateToDate(anyDateInMonth);
  const moved = new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
  return plannerLocalDateFromDate(moved);
}

/**
 * Motion, and 1c has exactly one animation of its own.
 *
 * **Completion is a fill, not a jump**: a row, its chip, its checkbox and its mark on
 * the rail cross to the category's met tone over 340 ms, and everything else on the
 * screen is instant. That is the brief's whole motion section.
 *
 * It is drawn as **two stacked layers cross-fading on opacity**, never as an animated
 * `backgroundColor`. A colour driven through `Animated` cannot take the native
 * driver, which is the project's standing rule for anything inside a list
 * (PD-PLANNER-V033-UI-017): a JS-thread colour interpolation down ten rows is what
 * made the old completion fill climb in steps.
 *
 * The day page's own arrival and the week strip's are kept from the previous journal:
 * they are about changing date rather than about the timeline, the brief does not
 * revisit them, and removing motion the owner has already accepted is not this
 * package's business.
 */
export const JOURNAL_MET_MS = 340;

export const JOURNAL_DAY_SLIDE_MS = 320;
export const JOURNAL_DAY_SLIDE_OFFSET = 22;
export const JOURNAL_DAY_CURVE = Object.freeze([0.16, 0.84, 0.24, 1] as const);

export const JOURNAL_WEEK_SLIDE_MS = 300;
export const JOURNAL_WEEK_SLIDE_OFFSET = 26;
export const JOURNAL_WEEK_START_OPACITY = 0.25;
export const JOURNAL_WEEK_CURVE = Object.freeze([0.22, 0.9, 0.24, 1] as const);

/**
 * The selected day is **one drop that travels**, and moving between dates carries it.
 *
 * **This supersedes the metaball of PD-TODAY-084/085/086 whole**, and the reason is not
 * taste. That drop contracted the date being left to nothing and swelled the one arrived
 * at from nothing, with a neck stretching between them: the object was destroyed and
 * recreated rather than moved. At `p = 0.5` both circles stood at 12.9 pt against a 13 pt
 * inversion threshold, so *neither* digit was inverted and there was nothing on screen to
 * follow. What reads as «перетекающая капля» is exactly that absence.
 *
 * **One object, one progress.** The finger, a tap on another date, the arrows and the
 * Today button all drive a single `travel ∈ [0,1]`, and the date, the week strip and the
 * day page are all linear functions of it. Two objects cannot come apart when there is
 * one number.
 *
 * **The spring lives on the normalised progress, not on the distance**, and that was
 * measured rather than chosen. On a spring driven by the distance in days, the jump
 * «today → +11 days» peaked at 123 days/s and settled after 1.8 s — a lurch in the first
 * two frames and a long lazy tail, because a spring's acceleration is proportional to its
 * displacement. Normalised, the dynamics are identical at every distance and the visible
 * speed follows the distance by itself. Distance is allowed to change the *stiffness*,
 * which is a different thing: `1.25 → 0.80` from one day to seven, so a neighbouring day
 * is quick and a long jump is statelier — never eleven times longer.
 *
 * Measured on this model at a fixed 60 fps, and these are the numbers the package is
 * accountable to:
 *
 * | jump | screen path | settle | peak | stretch |
 * |---|---|---|---|---|
 * | one day | 52 pt | 300 ms | 472 pt/s | ×1.22 |
 * | three days | 155 pt | 317 ms | 1238 pt/s | ×1.41 |
 * | exactly a week | **0 pt** | 467 ms | 0 | ×1.00 |
 * | eleven days | 207 pt | 467 ms | 1165 pt/s | ×1.40 |
 *
 * Exactly a week is a nil path on purpose: the same weekday stands in the same column, so
 * the strip pages under a stationary drop. It is the one jump the drop does not narrate,
 * and the day page — which still travels a full width — is what carries it.
 */
/** The date's own row, the prototype's: 26, not the drop band's 38. */
export const JOURNAL_DATE_ROW = 26;
// **The drop is the size of the date it carries.** It was 18 against a 38 pt band, and
// the band is the prototype's 26 now — a 36 pt drop simply does not fit in it. Sized to
// the row, the thing that travels between dates is exactly the shape of the selection
// that lands, which is what it was always standing in for.
/**
 * **The bead is sized to the numeral it magnifies, not to the row it stands in.**
 *
 * Reported from the device as «капля маленькая», and the arithmetic agrees. At the old 26 pt
 * the disc was exactly the date row, so a numeral magnified 1.7× — cap 12.2 × 1.7 ≈ 20.8 pt
 * tall and about 16.2 pt wide — filled it edge to edge and left no glass around the number
 * at all. A bead with no margin is not a bead; it is a number on a grey circle, which is
 * what the screenshots show.
 *
 * **17 was sized for one digit and two thirds of the month have two** — reported from the
 * device with `29` and `30` cut by the rim on both sides. A single numeral magnified 1.7× is
 * about 16 pt wide and fits a 34 pt disc easily; a pair is about 35 pt wide and cannot. The
 * error was counting the cap's *height* and forgetting that a date is as wide as it is.
 *
 * 20 is what lets the widest date keep a meaningful magnification: at a 40 pt disc the fit
 * rule below trims 1.7 to about 1.56, which is still inside the measured band, where a 34 pt
 * disc would have trimmed it to 1.31 and the glass would have stopped reading as glass.
 * `LENS_FIT_SHARE` does the trimming from a **measurement**, so this number decides how much
 * magnification survives rather than whether the date fits.
 */
export const JOURNAL_DROP_RADIUS = 20;
/**
 * **How much thicker the glass is than the air beside it** — PD-TODAY-152, and the one
 * number here that wants an eye rather than an argument.
 *
 * Measured on the approved prototype by counting the numeral's own pixels inside the disc
 * against a flat bead: 1.0× → 1.03, 1.3 → 1.43, 1.6 → 1.74, 1.9 → 1.94, 2.2 → 2.08,
 * 2.8 → 2.15. It climbs almost linearly to about 1.9 and then **flattens**, because past
 * that the glyph is pushed over the rim and more magnification buys clipping rather than
 * presence. 1.4–2.0 is therefore the band, 1.7 sits in the middle of it, and 1.0 is what
 * the bead did before — which makes this the value to move first if the glass reads as too
 * much or as nothing at all.
 */
export const LENS_MAGNIFICATION = 1.7;
/**
 * The date numeral's size, stated once because **two surfaces draw it and they must agree**:
 * the strip's own cell, and the lens that enlarges it. The lens takes this times
 * `LENS_MAGNIFICATION` and lays the glyph down at that size rather than scaling a rendered
 * one — a `transform: scale` enlarges rasterised pixels, which is what read as «шрифт под
 * каплей выглядит странно», and text drawn at its final size is drawn from the outline.
 */
export const JOURNAL_DATE_TYPE_SIZE = 17;
/**
 * **How much of the bead's width the widest date may occupy** — the rule that stops a numeral
 * crossing the rim, and the reason the lens measures instead of trusting `LENS_MAGNIFICATION`.
 *
 * A circle is the worst container for two digits: the glyphs are widest exactly where the
 * disc is narrowing. Fitting the *corners* of the numeral's box inside the circle is the
 * real constraint, and for a short centred numeral it reduces to a single share of the
 * diameter — with a cap of about 0.72 em and a digit advance of about 0.6 em, the corner
 * constraint and `width ≤ 0.86 × diameter` are the same statement. One number instead of
 * two, and the one that can be checked against a measurement rather than a font table.
 *
 * **It is applied to a measured width, not an assumed one**, so those two ratios decide only
 * how conservative this constant is — not whether `30` fits. If a device still shows a date
 * touching the rim, this is the number to lower.
 */
export const LENS_FIT_SHARE = 0.86;
/**
 * **How far from the drop's centre the lens still has anything to show** — and therefore how
 * far the strip's own numeral must give way to it.
 *
 * A numeral standing `d` from the centre is drawn by the lens at `d × magnification`, so it
 * leaves the disc at `radius ÷ magnification`. Handing over at exactly that distance is what
 * keeps a date from ever being missing: the original is still there wherever the enlarged
 * copy is not. Any other number leaves either a gap or a doubling at the rim.
 */
export const JOURNAL_DROP_COVER_HALF = JOURNAL_DROP_RADIUS / LENS_MAGNIFICATION;

/*
 * **`JOURNAL_PAGE_BLOOM`, `JOURNAL_PAGE_BLOOM_FLOOR`, `JOURNAL_PAGE_FADE_THROUGH` and
 * `JOURNAL_PAGE_SHIFT_SHARE` are deleted, and what they were for is worth keeping.**
 *
 * Four constants across three rounds, all of them tuning the same wrong idea: that a page
 * turn between two nearly identical, fully opaque lists could be smoothed with opacity.
 *
 * - A **cross-fade** shows both pages at once, so they print through each other and read as
 *   duplicated rows.
 * - A **fade-through** shows neither, and its blank is not the one frame it looks like on
 *   paper: measured off `тест1.MP4`, the content sat below a quarter of its resting ink for
 *   **233–567 ms at a time, 3767 ms of 12433** — a third of the recording.
 * - A **short offset** was adopted to stop the duplicates, and it is what made the two pages
 *   overlap at all; at a full width they never share a pixel.
 * - The **bloom** dimmed a cold page, and a dimmed page is a transparent page.
 *
 * A pager does not fade. The pages are opaque and travel a full width, meeting at a moving
 * edge — see the note on `leaving` in the screen.
 */

/**
 * How faint the NOW line goes on its way in — **and never to nothing**.
 *
 * It is alone in the header: nothing lies under it to print through and nothing hands over
 * to it, so the fade that is wrong for the pages is right for this one line. All it has to
 * stop doing is landing hard, which is what «появляется на манер старых задач, резко и с
 * рывком» reported. A floor rather than zero, because a line that blinks out is a line
 * somebody notices leaving.
 */
export const JOURNAL_HERO_ARRIVAL_FLOOR = 0.35;

/**
 * **How long today takes to arrive in the header, and to leave it.**
 *
 * The elapsed meter is the one element on this screen whose *existence* depends on which
 * date is chosen, so it is the only thing a date change makes appear from nothing — which is
 * why the owner could report that the tear happens «только при каком-то контакте с
 * сегодняшней датой» and nowhere else. It flipped in one frame at the moment of the tap,
 * a third of a second before the page it belongs to had arrived.
 *
 * 280 ms sits just inside the spring that carries the page (about 300), so the meter has
 * finished by the time the day it describes has landed, and never after it.
 */
export const JOURNAL_TODAY_FADE = 280;

/**
 * What the day's meter is captioned, and **which of the two the row reserves room for**.
 *
 * Two words for two states — a date the clock has not reached is «the day ahead», today is
 * simply «day» — and the meter beside them is `flex: 1`, so the shorter caption lengthens
 * the bar by everything it saves. The widest is *derived* rather than named, because a
 * constant that says «the first one» stops being true the moment somebody rewords them.
 */
export const JOURNAL_DAY_CAPTION_AHEAD = 'THE DAY AHEAD';
export const JOURNAL_DAY_CAPTION_TODAY = 'DAY';
export const JOURNAL_DAY_CAPTION_WIDEST =
  JOURNAL_DAY_CAPTION_AHEAD.length >= JOURNAL_DAY_CAPTION_TODAY.length
    ? JOURNAL_DAY_CAPTION_AHEAD
    : JOURNAL_DAY_CAPTION_TODAY;
/**
 * The band the drop travels along: **its own diameter plus a point of clearance**.
 *
 * The brief states a 54 pt row, and that row is a calendar cell holding nothing but a
 * number. Ours carries a weekday letter above the number and a row of task marks below
 * it, and with the drop centred on a 54 pt row the marks stood 3 pt inside its foot —
 * reported from the device as the marks riding onto the date. So the drop's band is
 * stated separately from the cell that contains it, the letter and the marks are laid
 * out around it rather than inside it, and no arithmetic anywhere can put the three in
 * the same place again.
 */
export const JOURNAL_DROP_BAND = JOURNAL_DROP_RADIUS * 2 + 2;

/**
 * The NOW row's own height, **reserved on every day**.
 *
 * Rendered conditionally it unmounted in one frame on the way to and from today, taking
 * its height out of the header's measured box — and that box is the pane's top padding, so
 * the whole list jolted 16 px with it, twelve times in twenty-seven seconds of the owner's
 * `тест4.MP4`. Nothing in this header may animate layout, so the row cannot shrink
 * smoothly; it holds its room instead and only its contents come and go.
 */
export const JOURNAL_NOW_ROW = 20;

/** The weekday letter's own line, fixed so the band below it starts at a known point. */
export const JOURNAL_WEEK_LETTER = 11;

/** The task marks under the number. */
export const JOURNAL_WEEK_MARKS = 5;   // the prototype's own dot row; it was 14од метки задач

/** Letter, band, gap, marks — the whole cell, and the row the week strip reserves. */
export const JOURNAL_WEEK_ROW = JOURNAL_WEEK_LETTER + JOURNAL_DROP_BAND + 2 + JOURNAL_WEEK_MARKS;

/** Where the drop's centre stands in that row: the middle of its own band. */
export function journalDropCentre(): number {
  return JOURNAL_WEEK_LETTER + JOURNAL_DROP_BAND / 2;
}
/*
 * **The page swipe is gone, and its arithmetic goes with it** (owner decision, 2026-08-05).
 *
 * `JOURNAL_DROP_AXIS`, `JOURNAL_DROP_COMMIT`, `journalDropProgress`, `journalDropDirection`
 * and `journalDropCommits` described a gesture this screen no longer has: the axis claim at
 * 7 pt, the 22 % commit threshold, and the mapping from a finger's `dx` to a share of the
 * page. Kept as exports they would be exactly what this project calls dead code held alive
 * by its own tests — arithmetic nothing computes for anything anybody sees.
 *
 * A date is chosen by tapping one of the seven on screen, by `Today`, or in the month
 * sheet; weeks are still browsed by sliding the strip itself, which is a scroll and never
 * was this.
 */

export const JOURNAL_NUMBER_COLOR_MS = 120;

/**
 * The week row's own geometry, which the drop is placed by.
 *
 * Seven equal columns, so a column's centre is `colW × (i + 0.5)` — the brief's own
 * formula, and the reason the row is a seven-column grid rather than seven cells spread
 * by their spacing: a drop that has to stand *between* two dates needs a continuous
 * coordinate, not a gap it can fall into.
 */
export function journalWeekColumnWidth(rowWidth: number): number {
  return rowWidth <= 0 ? 0 : rowWidth / 7;
}

export function journalWeekColumnCentre(index: number, rowWidth: number): number {
  return journalWeekColumnWidth(rowWidth) * (index + 0.5);
}

/**
 * Where a date stands in the **strip's own content**, not on the glass.
 *
 * The strip is a year of week pages the finger can browse, so a date's screen position is
 * its content position minus wherever the scroll currently is. Stating the content
 * position separately is what lets the drop travel and the strip be browsed at the same
 * time without either knowing about the other: the drop's screen place is one native
 * `Animated.subtract`, exactly as the Planner rail's pill already does it.
 *
 * It is also what makes the digit's inversion scroll-proof. Both the drop and a cell are
 * in content coordinates, so their difference does not contain the scroll at all — a
 * value that would otherwise have to be recomputed on every frame of every browse.
 */
export function journalDropTrackX({ column, page, stripWidth }: {
  readonly column: number;
  readonly page: number;
  readonly stripWidth: number;
}): number {
  return page * stripWidth + journalWeekColumnCentre(column, stripWidth);
}

/*
 * `JOURNAL_DROP_INK_HALF` is **deleted with the inversion it measured.**
 *
 * It was how close the drop had to be for a digit to flip — `0.62R`, inherited from the
 * metaball — and it existed only because the bead was opaque and a numeral had to be read
 * against it. The bead is glass now (owner decision, 2026-08-05) and the digit stays ink,
 * so there is no distance left to test and no second text layer to cross-fade.
 */

export const JOURNAL_POP_MS = 240;
export const JOURNAL_POP_STAGGER = 70;
export const JOURNAL_POP_OFFSET = 10;
export const JOURNAL_POP_SCALE = 0.96;
export const JOURNAL_POP_CURVE = Object.freeze([0.2, 0.9, 0.2, 1] as const);
export const JOURNAL_FAB_ROTATE_MS = 280;

/**
 * The month changes a letter at a time.
 *
 * A whole label swapping in one frame is a flicker, and at a month boundary it
 * lands in the same frame as the week strip re-centring — two jumps at once, which
 * is what the owner saw twitching. The word dissolves into the next a letter at a
 * time instead.
 *
 * **The two words overlap; they do not take turns.** Each position holds the old
 * letter and the new one at once and cross-fades between them, so something is
 * always drawn there. Fading one out and only then fading the other in left every
 * position that had finished — and every one that had not started — empty, and an
 * empty letter still occupies its width: the word came apart into `u  2 26` in the
 * middle of the change. That is the artefact, not the timing.
 *
 * The old month **fades out and is overwritten**, one letter at a time, left to
 * right — two heads running along the word at the same speed, the writing one
 * three letters behind the erasing one.
 *
 * The invariant that makes it work is `JOURNAL_FLIP_MS <= JOURNAL_FLIP_LAG *
 * JOURNAL_FLIP_STAGGER`: the old letter has finished fading before the new one
 * begins. 110 ms of fade against 120 ms of lag leaves it true with a little to
 * spare, and a word of eleven finishes in about 630 ms.
 */
export const JOURNAL_FLIP_MS = 110;
export const JOURNAL_FLIP_STAGGER = 40;
/** How far the writing head trails the erasing one, in letters. */
export const JOURNAL_FLIP_LAG = 3;
/** A fixed line box per letter, so nothing in the row can shift as it changes. */
export const JOURNAL_FLIP_CELL = 18;
/**
 * How long a drawn stroke takes.
 *
 * **The journal no longer strikes anything through.** 1c is explicit that a met item
 * keeps its ink and fills instead — a struck row reads as cancelled where the day
 * means it was met — so this is Edit's now, and it stays because Edit still draws one.
 */
export const JOURNAL_STRIKE_MS = 300;

/**
 * Forward in time arrives from the right, backward from the left — decided by
 * comparing the dates and never the distance, so a jump of eleven days reads
 * exactly like a step of one.
 */
export function journalSlideDirection(from: PlannerLocalDate, to: PlannerLocalDate): 1 | -1 {
  return to >= from ? 1 : -1;
}

/** Three at most, so the strip stays a rhythm rather than a count. */
export const JOURNAL_DENSITY_MARK_LIMIT = 3;
/** Past the cap, two marks are drawn and the rest become a `+N` chip. */
export const JOURNAL_DENSITY_MARK_SHOWN = 2;

/**
 * One task under a date: everything the strip needs to draw the item's own mark.
 *
 * The strip used to carry a 4 pt dot in the item's accent. It carries the item's
 * **real mark** now — its category's fill and border, its own symbol — because a row
 * of miniature marks says what the day holds where a row of dots says only how much.
 */
export interface DayJournalTaskMark {
  readonly habitId: string;
  readonly accentKey: PersistedHabitAccentKey;
  readonly categoryKey: HabitCategoryKey | null;
  readonly identity: DayJournalIconIdentity | null;
}

/**
 * The marks under a date are its **tasks**, one per task.
 *
 * They used to be the distinct categories of everything on that day, habits
 * included — which meant every date wore the same two or three dots, because a
 * habit recurs and says nothing about one date. A task belongs to its day, so a
 * mark under a date means "there is a thing to do here", and its colour and glyph say
 * which. **Habits are not marked in the strip at all.** That is the same reason the
 * calendar lists tasks and not habits.
 *
 * It is read from the catalogue rather than from the date-summary model, because
 * the catalogue is what knows a task from a habit: a task is a one-day item, and
 * its single active day **is** the date the mark belongs under. That also makes the
 * marks correct for any range — a week, a month — without a second query.
 *
 * **Every task is collected, not just the first three.** The strip caps what it
 * *draws* and states the remainder as a count, so the total has to survive the walk.
 */
export function journalTaskMarks(
  catalogue: readonly PlannerHabitCatalogueItem[],
): ReadonlyMap<string, readonly DayJournalTaskMark[]> {
  const marks = new Map<string, DayJournalTaskMark[]>();
  for (const item of catalogue) {
    // **A subtask is not a mark of its own.** It inherits its item's dates and
    // schedule, so a subtask of a task is itself a one-day daily item and matched
    // this rule exactly as its parent did: a task with two subtasks wore three
    // marks. It is a line inside its item, and the item already has the mark.
    if (item.ordinaryParentHabitId !== null) continue;
    // The one definition of a task, shared rather than restated. This was a fourth
    // copy of it, and a copy is a place for the surfaces to start disagreeing.
    if (manageItemKind(item) !== 'task') continue;
    const { effectiveFrom } = item.activeRange;
    const day = marks.get(effectiveFrom) ?? [];
    const accentKey = item.visualIdentity.persistedAccentKey ?? habitAccentKeyForId(item.habitId);
    day.push(Object.freeze({
      accentKey,
      categoryKey: habitCategoryForAccentKey(item.visualIdentity.persistedAccentKey)?.key ?? null,
      habitId: item.habitId,
      identity: item.visualIdentity.iconIdentity,
    }));
    marks.set(effectiveFrom, day);
  }
  return marks;
}

/**
 * How a date's marks are drawn: some of them, and how many are left.
 *
 * Three fit the cell. From four, **two** are drawn and the rest become one `+N` chip
 * of the same size — the marks overlap by 5 pt, so `16 + 11 + 11 = 38` inside a 46 pt
 * cell is what actually fits with the ring around each one.
 */
export function journalTaskMarkRow(marks: readonly DayJournalTaskMark[]): Readonly<{
  shown: readonly DayJournalTaskMark[];
  overflow: number;
}> {
  if (marks.length <= JOURNAL_DENSITY_MARK_LIMIT) {
    return Object.freeze({ overflow: 0, shown: marks });
  }
  return Object.freeze({
    overflow: marks.length - JOURNAL_DENSITY_MARK_SHOWN,
    shown: marks.slice(0, JOURNAL_DENSITY_MARK_SHOWN),
  });
}

/**
 * The density marks under a date: the distinct categories of that day, in order of
 * appearance, three at most, each at 60 %.
 */
export function journalDensityMarks(summary: PlannerDateMarkerSummary | undefined, dark: boolean): readonly string[] {
  if (summary === undefined) return Object.freeze([]);
  const colors: string[] = [];
  for (const indicator of summary.indicators) {
    const category = habitCategoryForAccentKey(indicator.visualIdentity.persistedAccentKey);
    if (category === null) continue;
    const color = habitCategoryDensityColor(category, dark);
    if (!colors.includes(color)) colors.push(color);
    if (colors.length === JOURNAL_DENSITY_MARK_LIMIT) break;
  }
  return Object.freeze(colors);
}

export function journalCategoryColor(categoryKey: HabitCategoryKey | null, fallback: string): string {
  return categoryKey === null ? fallback : habitCategory(categoryKey).color;
}

/**
 * The deliberate-tap rule.
 *
 * Opening the editor is bound to the gesture rather than to a press: a scroll over
 * the list or a long hold must not open anything, so a title acts only on a
 * release that barely moved and did not linger.
 */
export const JOURNAL_TAP_SLOP = 8;
export const JOURNAL_TAP_DURATION = 500;

export function isDeliberateJournalTap(input: Readonly<{
  downX: number; downY: number; downAt: number;
  upX: number; upY: number; upAt: number;
}>): boolean {
  return Math.abs(input.upX - input.downX) <= JOURNAL_TAP_SLOP
    && Math.abs(input.upY - input.downY) <= JOURNAL_TAP_SLOP
    && input.upAt - input.downAt <= JOURNAL_TAP_DURATION;
}

/**
 * A swipe across the page moves the selected date by a day.
 *
 * `|dx| ≥ 56` **and** `|dx| ≥ 1.4 × |dy|`, so a vertical drag stays a scroll: the
 * list under it is the thing most often being dragged, and a gesture that stole from
 * it would make the day unreadable.
 */
export const JOURNAL_SWIPE_DISTANCE = 56;
export const JOURNAL_SWIPE_RATIO = 1.4;

export function journalSwipeDayOffset(input: Readonly<{ dx: number; dy: number }>): -1 | 0 | 1 {
  if (Math.abs(input.dx) < JOURNAL_SWIPE_DISTANCE) return 0;
  if (Math.abs(input.dx) < Math.abs(input.dy) * JOURNAL_SWIPE_RATIO) return 0;
  return input.dx < 0 ? 1 : -1;
}

/**
 * How many days stand either side of the one being read, mounted and ready.
 *
 * Three is what a turn needs and no more: a date change moves the selection by one, so a
 * neighbour is always already on the track, and the two beyond it absorb a second tap
 * arriving before the first has settled. Wider costs mounted trees for days nobody is about
 * to reach; narrower means the window has to be rebuilt mid-turn, which is the one way the
 * defect this replaces can come back.
 */
export const JOURNAL_PAGE_WINDOW_RADIUS = 3;

/** The days on the track, in order, with the given one in the middle. */
export function journalPageWindow(centre: PlannerLocalDate): readonly PlannerLocalDate[] {
  return Object.freeze(Array.from(
    { length: JOURNAL_PAGE_WINDOW_RADIUS * 2 + 1 },
    (_unused, index) => movePlannerDate(centre, index - JOURNAL_PAGE_WINDOW_RADIUS),
  ));
}

/**
 * Where a page stands on the track: its index times the pane's width, negated.
 *
 * **The only value the turn animates.** A page's own position comes from layout and never
 * changes for as long as it is mounted, which is what makes content and position unable to
 * disagree — the failure that cost sixteen attempts under the previous design.
 */
export function journalPageOffset(index: number, width: number): number {
  // Normalised, because `-0 * width` is `-0`: harmless in a transform and confusing in every
  // comparison that ever asks whether the track is at its start.
  const offset = -index * width;
  return offset === 0 ? 0 : offset;
}
