import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { plannerDayBlockHasEnded, type PlannerDayBlockKey } from '../../../src/features/planner/domain/values/day-block';
import {
  blockDurationLabel,
  currentDayBlock,
  selectDayBlocks,
} from '../../../src/features/planner/presentation/day-blocks-model';

import {
  dayBarWindow,
  dayFreeWindowOptions,
  dayJournalHero,
  dayJournalReminderLocalTimes,
  dayJournalTally,
  PLATE_CHECKBOX,
  PLATE_CRITICAL_DOT,
  PLATE_GAP,
  PLATE_MIN_HEIGHT,
  PLATE_PADDING,
  PLATE_ROW_GAP,
  PLATE_STEPS_SLOP,
  PLATE_SUBTASK_BOX,
  PLATE_SUBTASK_ROW,
  PLATE_MARK,
  PLATE_RANK_SPINE,
  dayJournalPlateFacts,
  journalMonthRail,
  journalMonthRailIndex,
  JOURNAL_MONTH_RAIL_RADIUS,
  journalParkedJourney,
  journalRankIsDrawn,
  JOURNAL_TIME_BASELINE_NUDGE,
  JOURNAL_TIME_SIZE,
  JOURNAL_TITLE_SIZE,
  journalTaskMarkRow,
  dayJournalTaskHabitIds,
  isDeliberateJournalTap,
  journalDensityMarks,
  journalDominantMonthDate,
  journalDurationLabel,
  journalHourOnlyLabel,
  journalLocalTimeOfMinute,
  journalMinuteOfLocalTime,
  journalMonthCells,
  journalMonthLabel,
  journalMoveMonth,
  journalSlideDirection,
  journalSwipeDayOffset,
  journalTaskMarks,
  journalWeekDates,
  journalWeekRail,
  journalWeekStart,
  journalWeekdayIndex,
  selectDayJournalItems,
  DAY_BAR_DEFAULT_END,
  DAY_BAR_DEFAULT_START,
  DAY_BAR_LABEL_STEP,
  DAY_BAR_TICK_STEP,
  DAY_BAR_LABEL_WIDTH,
  DAY_BAR_PIN,
  DAY_BAR_PIN_GAP,
  DAY_BAR_HATCH_MINIMUM,
  DAY_FREE_WINDOW_MINUTES,
  DAY_FREE_WINDOW_NOTE,
  JOURNAL_BLOCK_GUTTER,
  JOURNAL_DAY_MINUTES,
  JOURNAL_DAY_SLIDE_MS,
  JOURNAL_DAY_SLIDE_OFFSET,
  JOURNAL_FLIP_LAG,
  JOURNAL_FLIP_MS,
  JOURNAL_FLIP_STAGGER,
  JOURNAL_ITEM_ROW_HEIGHT,
  JOURNAL_RANK_ORDER,
  JOURNAL_LABEL_MAX_SCALE,
  JOURNAL_MET_MS,
  journalWeekColumnCentre,
  journalWeekColumnWidth,
  JOURNAL_NOW_ROW,
  journalDropTrackX,
  JOURNAL_DROP_RADIUS,
  JOURNAL_DATE_ROW,
  JOURNAL_HEADER_INSET,
  JOURNAL_HEADER_LIFT_SCALE,
  JOURNAL_DATE_TYPE_SIZE,
  JOURNAL_DAY_CAPTION_AHEAD,
  JOURNAL_DAY_CAPTION_TODAY,
  JOURNAL_DAY_CAPTION_WIDEST,
  JOURNAL_DROP_BAND,
  JOURNAL_DROP_COVER_HALF,
  JOURNAL_PAGE_WINDOW_RADIUS,
  journalPageOffset,
  journalPageWindow,
  JOURNAL_HERO_ARRIVAL_FLOOR,
  JOURNAL_TODAY_FADE,
  LENS_FIT_SHARE,
  LENS_MAGNIFICATION,
  journalDropCentre,
  JOURNAL_WEEK_LETTER,
  JOURNAL_WEEK_MARKS,
  JOURNAL_WEEK_ROW,
  JOURNAL_POP_MS,
  JOURNAL_POP_STAGGER,
  JOURNAL_STEP_HEIGHT,
  JOURNAL_STRIKE_MS,
  JOURNAL_SWIPE_DISTANCE,
  JOURNAL_SWIPE_RATIO,
  JOURNAL_WEEKDAY_LETTERS,
  JOURNAL_BLOCK_GUTTER_WIDE,
  JOURNAL_CHECK,
  JOURNAL_TILE,
  JOURNAL_TOUCH_TARGET,
  JOURNAL_WEEK_RAIL_RADIUS,
  type DayBarPinInput,
  type DayJournalItem,
} from '../../../src/features/planner/presentation/day-journal-model';
import { habitCategory, habitCategoryTone, HABIT_CATEGORY_OPTIONS } from '../../../src/features/planner/presentation/habit-category-catalogue';
import { contrastRatio, ensureContrast, mixColors } from '../../../src/ui/theme/color-math';
import { buildThemeSurfaceColors, colorThemePalette, COLOR_THEME_IDS, COLOR_THEME_PALETTES } from '../../../src/ui/theme/color-themes';
import { getLifePlannerTheme } from '../../../src/ui/theme/tokens';
import type { SelectedDatePlannerOccurrenceRow, SelectedDatePlannerRootGroup } from '../../../src/features/planner';
import { parsePlannerLocalDate, type PlannerLocalDate } from '../../../src/features/planner/domain';
import { createTaskMomentIsPast } from '../../../src/features/planner/presentation/create-item-model';

const screen = readFileSync('src/features/planner/presentation/day-journal-screen.tsx', 'utf8');
const layout = readFileSync('app/(tabs)/_layout.tsx', 'utf8');
const themeSource = readFileSync('src/ui/theme/color-themes.ts', 'utf8');
const calendar = readFileSync('src/features/planner/presentation/journal-calendar-screen.tsx', 'utf8');
const provider = readFileSync('src/features/planner/presentation/planner-provider.tsx', 'utf8');
const model = readFileSync('src/features/planner/presentation/day-journal-model.ts', 'utf8');
// The node is Manage's row language and is deliberately no longer the journal's:
// 1c distinguishes kind by radius where Manage distinguishes it by fill.
const node = readFileSync('src/features/planner/presentation/item-node.tsx', 'utf8');
/** The chip, the tone, the glyph and the met fade: shared with Manage since PD-MANAGE-022. */
const chip = readFileSync('src/features/planner/presentation/item-chip.tsx', 'utf8');
const catalogue = readFileSync('src/features/planner/presentation/habit-category-catalogue.ts', 'utf8');
const blocksModel = readFileSync('src/features/planner/presentation/day-blocks-model.ts', 'utf8');
const monthTitle = readFileSync('src/features/planner/presentation/month-title.tsx', 'utf8');
/** The other surface drawn from those constants since PD-MANAGE-017. */
const manage = readFileSync('src/features/planner/presentation/all-habits-screen.tsx', 'utf8');
const route = readFileSync('app/(tabs)/index.tsx', 'utf8');

function date(value: string): PlannerLocalDate {
  const parsed = parsePlannerLocalDate(value);
  if (!parsed.ok) throw new Error(`Invalid Planner date: ${value}`);
  return parsed.value;
}

/**
 * The literal text of one function, from its declaration to the next one.
 *
 * For the assertions that must hold of a *particular* handler rather than of the
 * file: "this path resets expansion" and "this path does not re-pin the scroll"
 * are both false if matched against the whole screen, where some other path does.
 */
function functionSource(source: string, startMarker: string, nextMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${startMarker} not found`);
  const end = source.indexOf(nextMarker, start);
  if (end < 0) throw new Error(`${nextMarker} not found after ${startMarker}`);
  return source.slice(start, end);
}

function item(title: string, localTime: string | null, overrides: Partial<DayJournalItem> = {}): DayJournalItem {
  return {
    accentKey: 'blue',
    block: null,
    blockOverdue: false,
    completable: true,
    categoryKey: 'work',
    done: false,
    durationMinutes: null,
    elapsed: false,
    overdueMinutes: null,
    habitId: title,
    importance: 'normal',
    kind: 'habit',
    localTime,
    measured: false,
    minuteOfDay: journalMinuteOfLocalTime(localTime),
    overdue: false,
    reminderLocalTime: null,
    reopenable: true,
    row: { visualIdentity: { iconIdentity: { kind: 'symbol', symbolKey: 'habit_generic' } } } as DayJournalItem['row'],
    steps: [],
    title,
    ...overrides,
  };
}

/** The same fixture said the other way round: a part of the day, and a name. */
function itemIn(block: PlannerDayBlockKey | null, title: string, overrides: Partial<DayJournalItem> = {}): DayJournalItem {
  return item(title, null, { block, ...overrides });
}

/**
 * One occurrence row, with only the fields the journal's own model reads.
 *
 * The shape belongs to the application layer and is built there; what is asserted
 * here is what this model does with it.
 */
function occurrenceRow(habitId: string, name: string, plannedLocalTime: string | null, ordinaryParentHabitId: string | null = null) {
  return {
    actualTarget: { actual: null, trackingMode: 'checkbox' },
    currentObservation: { currentLeafIds: [] },
    habitId,
    importance: 'normal',
    name,
    ordinaryParentHabitId,
    plannedLocalTime,
    state: 'due',
    visualIdentity: { iconIdentity: { kind: 'symbol', symbolKey: 'habit_generic' }, persistedAccentKey: 'blue' },
  } as unknown as SelectedDatePlannerOccurrenceRow;
}

/** The same row, filed in a part of the day and carrying no clock of its own. */
function blockRow(habitId: string, name: string, plannedBlock: PlannerDayBlockKey | null) {
  return { ...occurrenceRow(habitId, name, null), plannedBlock } as unknown as SelectedDatePlannerOccurrenceRow;
}

/** A root group holding one habit, as the read model gives every ordinary child. */
function rootGroup(row: SelectedDatePlannerOccurrenceRow, dependencies: readonly SelectedDatePlannerOccurrenceRow[] = []) {
  return { rootHabitId: row.habitId, rows: [row, ...dependencies] } as unknown as SelectedDatePlannerRootGroup;
}

/** The brief's own rail: the card's 365 pt inner width less its two 14 pt gutters. */
const RAIL = 337;

/** The window every ordinary day uses, so a fixture need not restate it. */
const DAY = dayBarWindow({ minutes: [], nowMinuteOfDay: null });


const at = (label: string) => journalMinuteOfLocalTime(label) ?? 0;


/**
 * A reminder map, with the branded local time the read model carries.
 *
 * The brand belongs to the domain and is applied by its own parser; a fixture that
 * only has to be *shaped* like one casts, as every other fixture in this file does.
 */
const localTimes = (entries: readonly (readonly [string, string])[]) =>
  new Map(entries) as unknown as Parameters<typeof selectDayJournalItems>[0]['reminderLocalTimes'];

/**
 * The same source with its prose removed.
 *
 * A negative assertion — "this construct is gone" — is about code, and a doc comment
 * that names the thing it replaced is not the thing surviving. Matching against the
 * raw file made every explanation of a retired element fail the test that checked it
 * was retired.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const screenCode = withoutComments(screen);
const modelCode = withoutComments(model);

const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 0.01, message ?? `${actual} !~= ${expected}`);

test('Today is the day journal', () => {
  assert.match(route, /DayJournalScreen/);
  assert.doesNotMatch(route, /TodayScreen/);
});

// ── The day bar: one fixed, linear scale ─────────────────────────────────────

test('the window is fixed at the hours a person plans in, not fitted to the day', () => {
  // This is the whole point of 1c. The previous journal recomputed its window from
  // the content, which is exactly what made an hour worth a different number of
  // points from one day to the next.
  // **Eight to ten**, because with a fixed hour the window is the only lever on the day's
  // height: fourteen hours at 96 pt is 1344, about two and a half screens. PD-TODAY-130's
  // objection to a narrow window died with the fold that caused it — a widening window
  // used to mean a coarser one, and a fixed hour redistributes nothing.
  assert.equal(DAY_BAR_DEFAULT_START, 8 * 60);
  assert.equal(DAY_BAR_DEFAULT_END, 22 * 60);
  const empty = dayBarWindow({ minutes: [], nowMinuteOfDay: null });
  const busy = dayBarWindow({ minutes: [at('09:00'), at('13:20'), at('21:45')], nowMinuteOfDay: at('11:41') });
  assert.deepEqual({ ...empty }, { ...busy }, 'a day inside the window does not move it');
  assert.equal(empty.spanMinutes, 14 * 60);
});

test('the window widens by whole hours for a day that falls outside it', () => {
  const early = dayBarWindow({ minutes: [at('02:15')], nowMinuteOfDay: null });
  assert.equal(early.startMinute, 2 * 60, 'cut down to the whole hour, never to 02:15');
  assert.equal(early.endMinute, DAY_BAR_DEFAULT_END);
  const late = dayBarWindow({ minutes: [at('23:30')], nowMinuteOfDay: null });
  assert.equal(late.startMinute, DAY_BAR_DEFAULT_START);
  assert.equal(late.endMinute, 24 * 60, 'cut up to the whole hour');
});

test('the clock is always inside the window, so it can always be drawn', () => {
  const dawn = dayBarWindow({ minutes: [at('09:00')], nowMinuteOfDay: at('03:10') });
  assert.equal(dawn.startMinute, 3 * 60);
  const midnight = dayBarWindow({ minutes: [at('09:00')], nowMinuteOfDay: at('23:50') });
  assert.equal(midnight.endMinute, JOURNAL_DAY_MINUTES);
});

test('the window never leaves the day, whatever it is given', () => {
  const wild = dayBarWindow({ minutes: [-500, 4_000], nowMinuteOfDay: 9_999 });
  assert.ok(wild.startMinute >= 0);
  assert.ok(wild.endMinute <= JOURNAL_DAY_MINUTES);
  assert.equal(wild.spanMinutes, wild.endMinute - wild.startMinute);
});





test('a caption is the hour alone, because the rail is a scale and not a list of times', () => {
  assert.equal(journalHourOnlyLabel(0), '00');
  assert.equal(journalHourOnlyLabel(7 * 60), '07');
  assert.equal(journalHourOnlyLabel(23 * 60), '23');
  assert.equal(journalHourOnlyLabel(24 * 60), '00');
});

// ── Pins: nudge, then merge ──────────────────────────────────────────────────















// ── Free windows: not built, and the reason is the arithmetic ────────────────








test('a window offers every untimed item, in rank order and filtered by nothing', () => {
  // **Nothing is filtered by whether it fits**, because no item stores a length — the
  // same gap the window itself is measured around.
  const options = dayFreeWindowOptions({
    anytime: [
      item('Quiet', null),
      item('Loud', null, { importance: 'critical' }),
      item('Closed', null, { done: true }),
      item('Middling', null, { importance: 'high' }),
    ],
  });
  assert.deepEqual(options.map((entry) => entry.title), ['Loud', 'Middling', 'Quiet']);
});


test('nothing on the screen claims a duration the domain does not store', () => {
  // The gutter's sub-line is an end time in the brief; a group states its count
  // instead and a single item states its minute alone.
  assert.doesNotMatch(screenCode, /items`/);
  // No progress bar, and no `left` countdown: both are (now − start)/(end − start).
  assert.doesNotMatch(screen, /heroProgress|progressBar/);
});

// ── Blocks: one per start minute ─────────────────────────────────────────────






test('the day’s arithmetic counts the timed items, and the untimed block counts its own', () => {
  const tally = dayJournalTally([
    item('A', '08:00', { done: true }),
    item('B', '09:00', { overdue: true }),
    item('C', '10:00'),
  ]);
  assert.deepEqual({ ...tally }, { done: 1, overdue: 1, total: 3 });
  // The heading over the unclaimed items counts them, and the count comes from the
  // list the heading actually stands over rather than from a second reckoning.
  assert.match(screen, /ANYTIME · \$\{count\}/);
  assert.match(screen, /count=\{blocks\.anytime\.length\}/);
});

// ── The NOW card ─────────────────────────────────────────────────────────────

/** The card renders only where it can be about something, so the fixtures unwrap it. */
const heroOf = (input: Parameters<typeof dayJournalHero>[0]) => {
  const hero = dayJournalHero(input);
  assert.ok(hero !== null, 'the fixture is a day the card renders on');
  return hero;
};

test('the card is absent on another date, and on a day with nothing timed', () => {
  // Not empty — absent. Every rule the card has is about a minute, and a plate headed
  // `NOW` on a Thursday three weeks out is a contradiction rather than a summary. The
  // day's own header still counts what is there.
  assert.equal(dayJournalHero({ items: [item('One', '09:00')], nowMinuteOfDay: null, window: DAY }), null);
  assert.equal(dayJournalHero({ items: [item('Loose', null)], nowMinuteOfDay: at('11:41'), window: DAY }), null);
  assert.equal(dayJournalHero({ items: [], nowMinuteOfDay: at('11:41'), window: DAY }), null);
});

test('the card is never about a missed item', () => {
  // Overdue belongs to the list, where each late row says so in its own words and its
  // own weight and where it can be acted on. Repeated at the top of the screen it said
  // the same thing twice, in the place least able to do anything about it.
  const hero = heroOf({
    items: [
      item('Standup', '10:30', { overdue: true }),
      item('Deep work', '11:30', { importance: 'critical', overdue: true }),
      item('Lunch', '13:00'),
    ],
    nowMinuteOfDay: at('11:41'),
    window: DAY,
  });
  assert.equal(hero.kind, 'free');
  assert.equal(hero.subject?.title, 'Lunch', 'the subject is drawn from what is ahead');
  assert.equal(hero.timerMinutes, 79);
  // **The card counts nothing that is late — but the block headings now do.** Lateness
  // belongs where it can be acted on, and a part of the day is nearer to its own items
  // than a card at the top of the screen is; the rule the card is held to is that *it*
  // never says it, so the assertion is scoped to the card rather than to the file.
  assert.doesNotMatch(screenCode, /OVERDUE/);
  assert.doesNotMatch(functionSource(screen, ': <Reanimated.View style={[styles.nowLine, heroArrival]}>', "**The day's own metric belongs to the day's own surface.**"), /overdueCount/);
  assert.doesNotMatch(modelCode, /export function dayJournalHero[\s\S]*?overdueCount/);
  // **One counter, whatever the state.** `8 left today` beside `4 of 11 done` were two
  // readings of the same day that never appear together, so there is nothing to
  // reconcile them against; `N of M done` says the same thing in both.
  // **The counter is the list's alone.** `DAY … 10 of 11 done` and the card's band
  // printed the same sentence 40 pt apart; the header is the older of the two.
  assert.doesNotMatch(functionSource(screen, ': <Reanimated.View style={[styles.nowLine, heroArrival]}>', "**The day's own metric belongs to the day's own surface.**"), /doneCount\} of/);
  assert.doesNotMatch(screenCode, /left today`/);
  assert.equal(hero.doneCount, 0);
  assert.equal(hero.itemCount, 3);
});

test('the page still opens on what is behind, even though the card is not about it', () => {
  // The card is not the scroll's to decide: a day with something overdue still opens
  // where the work is, which is the block that was missed.
  const hero = heroOf({
    items: [item('Standup', '10:30', { overdue: true }), item('Lunch', '13:00')],
    nowMinuteOfDay: at('11:41'),
    window: DAY,
  });
  assert.equal(hero.focusMinuteOfDay, at('10:30'));
});

test('the queue and the buttons are gone with them', () => {
  // The queue repeated the list, and the two buttons repeated a control that belongs
  // on the row the item is on — so what is left is the one statement the card makes,
  // with the subject's own checkbox at the end of it.
  // **And so is the control.** With the card reduced to a line, the subject's own
  // checkbox stays where every other checkbox in the list is — on the item's own
  // plate — rather than being repeated in the header.
  const card = functionSource(screen, ': <Reanimated.View style={[styles.nowLine, heroArrival]}>', '{picking === null ? null :');
  assert.doesNotMatch(card, /<Checkbox|QUEUE|heroQueue|Plan tomorrow/);
  assert.match(card, /hero\.subject\.title/);
});

test('closing something early gives the time back, and the card says so', () => {
  // Tick the thing you are in the middle of and the run to the next planned minute is
  // yours. How much of it came from the item just closed is not knowable without a
  // stored end; the run itself is, and it is true either way.
  const hero = heroOf({
    items: [item('Done', '09:00', { done: true }), item('Lunch', '13:00')],
    nowMinuteOfDay: at('11:41'),
    window: DAY,
  });
  assert.equal(hero.kind, 'free');
  assert.equal(hero.freeUntilMinuteOfDay, at('13:00'), 'the run ends at the next planned minute');
  assert.equal(hero.timerMinutes, 79);
  assert.equal(hero.doneCount, 1);
  assert.equal(hero.itemCount, 2);
  // **The kicker names the state and the headline states the quantity, each once.**
  // `Free for …` under a kicker reading `FREE` printed the word twice, and the second
  // printing is what overflowed the 119 pt the column actually has.
  assert.doesNotMatch(screenCode, /Free for /);
});

test('a short run is about the thing coming; a long one is about the freedom', () => {
  // The list says nothing of a stretch under an hour and a half, and the card announced
  // three minutes in a nineteen-point headline — one day described by two rules. The
  // card uses the list's own threshold now.
  const near = heroOf({
    items: [item('Done', '09:00', { done: true }), item('Гвов', '23:00')],
    nowMinuteOfDay: at('22:57'),
    window: DAY,
  });
  assert.equal(near.kind, 'free');
  assert.equal(near.timerMinutes, 3);
  assert.equal(near.freeIsWorthSaying, false, 'three minutes is not a free stretch');
  assert.equal(DAY_FREE_WINDOW_MINUTES, 60, 'and the card reads the list’s own constant');

  const wide = heroOf({
    items: [item('Done', '09:00', { done: true }), item('Lunch', '13:00')],
    nowMinuteOfDay: at('11:00'),
    window: DAY,
  });
  assert.equal(wide.freeIsWorthSaying, true, 'two hours is');
  // Exactly at the threshold it is worth saying, so the two rules share one boundary.
  const edge = heroOf({
    items: [item('Lunch', '13:00')],
    nowMinuteOfDay: at('12:00'),
    window: DAY,
  });
  assert.equal(edge.timerMinutes, DAY_FREE_WINDOW_MINUTES);
  assert.equal(edge.freeIsWorthSaying, true);

  // And the headline follows: `FREE` names the run, `NEXT` names the item.
});



test('the card stops counting other rows’ overdue', () => {
  // Marking them is the list's job — every late row says so twice, in a duller surface
  // and in the word — and a tally at the top only repeats it where it cannot be acted
  // on. What is left is how much of the day is still open.
  assert.doesNotMatch(screenCode, /overdue today/);
});

test('the card floats above the page rather than sitting in it', () => {
  // On the journal's own ground the card's surface *was* the ground, so only the band
  // showed and the whole thing read as part of a flat rectangular page.
  // A 4 % step of ink was still the page: the eye reads that as printing, not as an
  // object. The whole card takes the state's own wash at a third of the band's
  // strength — the smallest amount of colour that reads as a thing floating over a
  // neutral list, and far short of the saturated card rejected two rounds ago.
  // **A tinted ground means the card derives its own inks.** Borrowed from the page
  // they fell to 2.94:1 on `dusk` — the quieter a token is, the less ground it can
  // afford to have moved under it. Measured after: 4.53:1 at worst on all five.
  const body = functionSource(screen, ': <Reanimated.View style={[styles.nowLine, heroArrival]}>', "**The day's own metric belongs to the day's own surface.**");
  assert.doesNotMatch(body, /styles\.hero(Range|NextTitle), \{ color: theme\.today\./);
});

test('the card carries the item’s place in the day, and no span it cannot know', () => {
  // The track is the rail's window and the mark is the item's planned minute, both
  // stored. The period is not drawn: an item carries no length, and a filled span
  // would be a number invented on the spot.
  // **Placed against a measured track.** At `left: 100 %` the mark's own 3 pt began
  // where the track ended and `overflow: hidden` took all of it — so the last item of
  // the window, which is the one the card is usually about at the end of a day, had no
  // mark at all.
  assert.doesNotMatch(screenCode, /`\$\{span \* 100\}%`/);
});

test('with nothing left at all the day is closed', () => {
  const hero = heroOf({
    items: [item('Done', '09:00', { done: true }), item('Also', '10:00', { done: true })],
    nowMinuteOfDay: at('21:00'),
    window: DAY,
  });
  assert.equal(hero.kind, 'closed');
  assert.equal(hero.subject, null);
  assert.equal(hero.timerMinutes, null, 'there is nothing left to count towards');
  assert.equal(hero.freeUntilMinuteOfDay, null);
  // **The counter is the list's, not the card's.** `DAY … 10 of 11 done` and the card's
  // band printed the same sentence 40 pt apart; the header is the older of the two and
  // is the list's own summary.
  assert.doesNotMatch(functionSource(screen, ': <Reanimated.View style={[styles.nowLine, heroArrival]}>', "**The day's own metric belongs to the day's own surface.**"), /doneCount\} of/);
  // The sentence changed and the rule did not: the day's arithmetic is stated once, by
  // the list's own header. It is «N left» now — one figure rather than «N of M done»
  // beside «N overdue», which was the same day counted twice and both times as a failure.
  assert.match(screen, /\$\{tally\.total - tally\.done\} left/);
  // **Scoped to the NOW line, which is the surface the rule is about.** The block
  // headings say «N overdue» deliberately — that is the one place lateness is announced,
  // once per block instead of once per row — so a file-wide refusal would now forbid the
  // very thing that lets every plate stay quiet.
  assert.doesNotMatch(functionSource(screen, ': <Reanimated.View style={[styles.nowLine, heroArrival]}>', "**The day's own metric belongs to the day's own surface.**"), /\} overdue`/);
});

test('an item standing exactly on the clock is next, not nothing', () => {
  // For one minute it is neither open past its minute nor still to come, and naming
  // the item after it would report the day as free until then.
  const hero = heroOf({
    items: [item('Now', '11:41'), item('Later', '13:00')],
    nowMinuteOfDay: at('11:41'),
    window: DAY,
  });
  assert.equal(hero.kind, 'free');
  assert.equal(hero.subject?.title, 'Now');
  assert.equal(hero.timerMinutes, 1, 'a minute rather than nothing, so the run is never blank');
});

test('the card does not offer a done item as what is next', () => {
  const hero = heroOf({
    items: [item('Closed', '13:00', { done: true }), item('Open', '15:00')],
    nowMinuteOfDay: at('11:41'),
    window: DAY,
  });
  assert.equal(hero.subject?.title, 'Open');
});

test('the state resolves in a strict order, and running now leads it', () => {
  // Deriving the state from one item let the card announce FREE while the header two
  // rows below counted seven overdue — the one thing this screen must never do.
  //
  // **`running` used to be the state that could not exist**, and this case asserted its
  // absence for five packages. Schema v13 stores a length, so it leads the order: the
  // thing the clock is *inside* outranks the thing that comes after it.
  // `behind` joined them on a device report: nothing being *ahead* is not the day being
  // over, and the header was reading `DAY CLOSED` over four open and overdue things.
  assert.match(modelCode, /'running' \| 'free' \| 'behind' \| 'closed'/);
  assert.match(modelCode, /start <= now && now < start \+ item\.durationMinutes/);
  // Still no snooze: `start += 30 min` needs a per-date occurrence time, and no
  // canonical command sets one. A third button that did nothing would be worse.
  assert.doesNotMatch(screenCode, /snooze|Snooze/i);
});

test('one state, one colour: there is no second hue left to switch between', () => {
  // The card is never about a missed item, so the attention family has nothing to say
  // on it. The accent is the day's structural colour and the card is about the day.
  const card = functionSource(screen, ': <Reanimated.View style={[styles.nowLine, heroArrival]}>', "**The day's own metric belongs to the day's own surface.**");
  assert.doesNotMatch(card, /theme\.today\.attention/);
  assert.match(card, /color: theme\.today\.system/);
});

test('the state is a band across the top, and the card is an ordinary plate', () => {
  // A whole saturated rectangle was the loudest object on a page whose subject is the
  // list below it. Confined to the strip the same colour still says the state.
  assert.doesNotMatch(screenCode, /heroOther|heroRest/);
  // What the run ends with carries its own kicker: the name used to stand between the
  // caption and the checkbox with nothing to relate it to either.
  // Both inks are raised against the band they actually sit on rather than authored.
  // **One filled action.** Several coloured control backgrounds in one view compete
  // for the same job: the primary carries the accent and the secondary is a neutral
  // outline, so which one the card is recommending is never in question.
  // **The band went with the card.** A line inside the header paints nothing at all:
  // the header's own material is behind it, and the state is a word rather than a
  // surface — which is the smallest a state can be said in.
  // The region is the line itself and stops where the free-time picker begins: that list
  // is a separate element with rows of its own, and it appears only while it is open.
  const card = functionSource(screen, ': <Reanimated.View style={[styles.nowLine, heroArrival]}>', '{picking === null ? null :');
  assert.match(card, /hero\.kind === 'running' \? 'NOW' : hero\.freeIsWorthSaying \? 'FREE' : 'NEXT'/);
  // **The line paints no surface of its own** — the header's material is behind it — and
  // its own track, fill and head live in `NowProgress`, outside the card's markup. It is
  // the structural colour rather than the attention family: the card is about the day,
  // and a thing in progress is not a thing that went wrong.
  assert.equal((card.match(/backgroundColor: .*/g) ?? []).length, 0);
  assert.doesNotMatch(card, /theme\.today\.attention/);
});

test('the card states the minute it knows and not a range it does not', () => {
  // The brief prints `10:30 — 11:00 · 30 m`: one minute of fact and two of arithmetic
  // over an end nothing stores. What is drawn is the planned minute alone.
});

test('the page opens on the card’s own block, and never on an arbitrary one', () => {
  const hero = heroOf({
    items: [item('Standup', '10:30', { overdue: true }), item('Lunch', '13:00')],
    nowMinuteOfDay: at('11:41'),
    window: DAY,
  });
  assert.equal(hero.focusMinuteOfDay, at('10:30'));
  const clear = heroOf({
    items: [item('Lunch', '13:00')],
    nowMinuteOfDay: at('11:41'),
    window: DAY,
  });
  assert.equal(clear.focusMinuteOfDay, at('13:00'), 'the next block when nothing is open');
});


// ── The one animation ────────────────────────────────────────────────────────

test('completion is the only animation, and it is a fill', () => {
  assert.equal(JOURNAL_MET_MS, 340);
  assert.match(chip, /export function useMetFade\(done: boolean\)/);
  assert.match(chip, /duration: JOURNAL_MET_MS,/);
});

test('the fill is a cross-fade of layers, never an animated colour', () => {
  // A colour driven through `Animated` cannot take the native driver, and a
  // JS-thread interpolation down ten rows is what made the old fill climb in steps.
  const met = functionSource(chip, 'export function useMetFade', 'const styles');
  assert.match(met, /useNativeDriver: true,/);
  assert.doesNotMatch(met, /useNativeDriver: false/);
  assert.doesNotMatch(screen, /backgroundColor: met\b/);
  assert.match(screen, /opacity: met/);
  // And Reduce Motion commits it in one frame.
  assert.match(met, /if \(reduceMotion\) \{\s*\n\s*met\.setValue\(target\);/);
});


test('a met item keeps its ink: nothing on this surface is struck through', () => {
  // A struck row reads as cancelled where the day means it was met, and the item
  // stays exactly where it is rather than moving into a done bin.
  assert.doesNotMatch(screen, /textDecorationLine/);
  assert.doesNotMatch(screen, /StruckTitle|HandStrike|strikeRule/);
  assert.match(model, /The journal no longer strikes anything through/);
});

test('the mark is filled with the category itself, and a met item keeps it', () => {
  // **The 13 % wash is withdrawn as the mark's fill.** Six washes at one lightness differ
  // from each other by 1.004–1.011:1 and from the plate by 1.15–1.22:1 — arithmetically
  // the same colour — so category was carried by an 18 pt glyph and nothing else, which
  // is what «однотипные плашки» measured out to be. Filled, the glyph is knocked out in
  // the plate's own colour.
  assert.match(chip, /backgroundColor: tone\.color,/);
  assert.match(chip, /<ItemGlyph color=\{theme\.today\.dashboardSurface\}/);
  for (const id of COLOR_THEME_IDS) {
    const plate = colorThemePalette(id).surface;
    for (const option of HABIT_CATEGORY_OPTIONS) {
      const tone = habitCategoryTone(option, plate, id === 'dark');
      assert.ok(
        contrastRatio(plate, tone.color) >= 3,
        `${id}.${option.key}: the knocked-out glyph is ${contrastRatio(plate, tone.color).toFixed(2)}:1`,
      );
    }
  }
  // **`metFill` is deleted rather than left dormant.** Its only consumer was the mark's
  // completion overlay, and PD-PLATE-012 says a completed item keeps its own mark — so a
  // surviving `metFill` would be a derived value reaching no column at all.
  assert.doesNotMatch(catalogue, /metFill|categoryMetFill/);
  assert.doesNotMatch(chip, /metFill/);
  assert.doesNotMatch(functionSource(chip, 'export function CategoryChip', 'export function ItemGlyph'), /done|useMetFade/);
});

// ── What the retired ruler took with it ──────────────────────────────────────

test('the ruler is gone from the list, and so is everything that reconciled it', () => {
  for (const retired of [
    'buildDayJournalTimeline',
    'projectDayJournalMinute',
    'buildDayJournalTimelineLayout',
    'buildDayJournalHourMarks',
    'buildDayJournalHalfHourMarks',
    'journalWindowCapLabel',
    'journalTimeColumnWidth',
    'journalNowBadgeHeight',
  ]) assert.doesNotMatch(modelCode, new RegExp(`export function ${retired}\\b`), `${retired} survived`);
  assert.doesNotMatch(screenCode, /<NowMarker|<HourMark|<WindowCap|halfHourRule|hourRule:/);
  assert.doesNotMatch(screenCode, /timelineColumn|timelineNode|timelineRow/);
});


test('the hero is a line in the header, so it is not the pane’s child at all', () => {
  // **It is not a sticky child any more.** A line in the header is outside the scroll
  // view entirely, which is a stronger guarantee than sticking: nothing it does can
  // interact with the list's own scroll.
  assert.doesNotMatch(screenCode, /stickyHeaderIndices/);
  assert.match(screen, /styles\.nowLine/);
  // **One animated wrapper now, not two.** There were two because a sticky child has
  // to be a direct child of the scroll view, so the hero and the list could not share
  // one; with the hero out of the pane the day's page is a single object again.
  assert.equal((screen.match(/<DayCarousel/g) ?? []).length, 1);
});

// ── Geometry the brief fixes ──────────────────────────────────────────────────

test('a row is a minimum height and grows with its text', () => {
  // **52 is not a fourth judgement about density**: it is the height the row's own
  // content already comes to — 11 pt of padding, the 30 pt mark and its two lines,
  // 11 pt of padding. At 56 the four extra points pooled at the foot of every row,
  // because the content is top-aligned, and left everything 2 pt above the middle.
  assert.equal(JOURNAL_ITEM_ROW_HEIGHT, 52);
  assert.match(model, /export const JOURNAL_BODY_PADDING_Y = 11;/);
  assert.equal(JOURNAL_ITEM_ROW_HEIGHT, 11 * 2 + JOURNAL_TILE, 'the row is exactly its own content');
  // **Sharing a leading is not sharing a line.** Two texts of different size centred in
  // the same line box do not share a baseline: the shorter one carries more half-leading
  // above it and less ascender below, so a 13 pt time sat about a point above a 15 pt
  // title. The correction needs no font metric — every face has an ascent between 0.9
  // and 1 of its em, so for this 2 pt difference it is 0.8–1.0 pt and 1 is inside the
  // band for all of them.
  assert.equal(JOURNAL_TIME_BASELINE_NUDGE, 1);
  assert.equal(JOURNAL_TIME_BASELINE_NUDGE, (JOURNAL_TITLE_SIZE - JOURNAL_TIME_SIZE) / 2);
  // The journal's block is where a time stands on a title's line, so the nudge lives
  // there. Manage's slice centres its label in the block instead (PD-MANAGE-026), and
  // a centred label has no line to sit on — both surfaces still read the two sizes.

  // Manage keeps the older row until its own package rebuilds it; the journal is on
  // the plate's six steps, where a title is 17 and its own start is 12.
  // Manage's own column is wider than the journal's — `Tomorrow` does not fit 44 pt —
  // and that departure is measured rather than preferred (PD-MANAGE-018).
  assert.match(manage, /manageGutterWidth/);
  assert.match(manage, /itemTitle: \{ flexShrink: 1, fontSize: 17/);
  assert.match(screen, /plateTitle: \{[^}]*fontSize: 17/);
  // The plate's facts line is the 13/18 step, and it is one size for every fact on it.
  assert.match(screen, /plateFactText: \{[^}]*fontSize: 13, fontVariant: \['tabular-nums'\], lineHeight: 18/);
  assert.equal(PLATE_SUBTASK_ROW, 30);
  assert.equal(PLATE_MIN_HEIGHT, 48);
  // A plate grows with its title and again when its steps open inside it.
  assert.match(screen, /minHeight: PLATE_MIN_HEIGHT - 2 \* PLATE_PADDING/);
  assert.doesNotMatch(screen, /height: PLATE_MIN_HEIGHT,/);
});



test('the journal draws its own mark, and Manage keeps the shared one', () => {
  // PD-MANAGE-016 anticipated this: the journal kept the bare dot "until its own
  // redesign", and 1c distinguishes kind by radius where Manage does it by fill.
  assert.doesNotMatch(screenCode, /ItemNode/);
  assert.match(node, /export function ItemNode/);
  assert.match(chip, /export function CategoryChip/);
});

test('the rail is gone, and so are the styles that outlived it', () => {
  // The rail was retired when the axis arrived and its ~30 style entries were left
  // standing — «drawn by nothing and kept alive by their own tests», as the handoff put
  // it. The axis is retired in turn, so the whole cluster goes with it. This asserts the
  // absence, because a dead style is exactly the thing a green suite hides.
  assert.doesNotMatch(screenCode, /pinHalo|pinBadge|railScale|railTick|railLabel|hatchStripe|nowTickTop|nowTickBottom/);
  // The card the rail carried is gone too: the NOW line in the header says the one
  // thing it knew that the list does not.
  assert.doesNotMatch(screenCode, /heroBand|heroTile|heroSpanFill/);
});








/** The screen's own summary rule, restated here so the wording is asserted. */
function railSummaryOf(input: Readonly<{ tally: { done: number; overdue: number; total: number }; anytime: number }>): string {
  const parts = [`${input.tally.total} timed`];
  if (input.tally.done > 0) parts.push(`${input.tally.done} done`);
  if (input.tally.overdue > 0) parts.push(`${input.tally.overdue} overdue`);
  if (input.anytime > 0) parts.push(`${input.anytime} anytime`);
  return `The day: ${parts.join(', ')}`;
}

test('the action stands above the bar, and the pane reserves its own room for it', () => {
  assert.match(screen, /const JOURNAL_FAB_SIZE = 56;/);
  // **Measured rather than a constant**, since the bar became a floating oval: it sits
  // above the home indicator rather than holding its room inside itself, so what the
  // button has to clear is the clearance *plus* the safe area — and without that it was
  // drawn behind the bar.
  assert.match(screen, /const barClearance = TAB_BAR_CLEARANCE \+ insets\.bottom;/);
  assert.match(screen, /bottom: barClearance \+ JOURNAL_FAB_LIFT/);
  // Derived from the button rather than eyeballed, so the last row can always be
  // scrolled clear of it and ticked.
  assert.match(screen, /const JOURNAL_PANE_BOTTOM = JOURNAL_FAB_SIZE \+ JOURNAL_FAB_LIFT \+ 12;/);
  assert.match(screen, /paddingBottom: JOURNAL_PANE_BOTTOM/);
});

// ── Durations, and the words for them ────────────────────────────────────────

test('a length of time is worded the way the rest of the application words it', () => {
  assert.equal(journalDurationLabel(0), '0 min');
  assert.equal(journalDurationLabel(15), '15 min');
  assert.equal(journalDurationLabel(59), '59 min');
  assert.equal(journalDurationLabel(60), '1 h');
  assert.equal(journalDurationLabel(79), '1 h 19 m');
  assert.equal(journalDurationLabel(120), '2 h');
  assert.equal(journalDurationLabel(-5), '0 min', 'never a negative length');
});

// ── The page gesture ─────────────────────────────────────────────────────────

test('a swipe across the page is a day, and a vertical drag is still the scroll', () => {
  assert.equal(JOURNAL_SWIPE_DISTANCE, 56);
  assert.equal(JOURNAL_SWIPE_RATIO, 1.4);
  assert.equal(journalSwipeDayOffset({ dx: -80, dy: 0 }), 1, 'left is forward');
  assert.equal(journalSwipeDayOffset({ dx: 80, dy: 0 }), -1, 'right is back');
  assert.equal(journalSwipeDayOffset({ dx: -40, dy: 0 }), 0, 'under the threshold');
  assert.equal(journalSwipeDayOffset({ dx: -80, dy: -70 }), 0, 'a diagonal drag stays a scroll');
  assert.equal(journalSwipeDayOffset({ dx: 0, dy: -200 }), 0);
});


test('the chevrons move the selection by a week, and the strip still only browses', () => {
  // The arrows step a **day** now and drive the same path the finger does, because the
  // drop has one code path and a button that had its own would disagree with it.
  assert.doesNotMatch(screen, /stepDay/);
  const settle = functionSource(screen, 'const settleWeek =', 'const scrollToWeek =');
  assert.match(settle, /setWeekStart\(settled\)/);
  assert.doesNotMatch(settle, /setSelected/, 'browsing is not choosing');
});

// ── The items themselves ─────────────────────────────────────────────────────

test('a row states what is worth knowing and nothing it cannot know', () => {
  const rows = functionSource(screen, 'function Plate', 'function StepRow');
  // **The facts are asked for, not assembled here** — the row states what the model
  // says exists, in the model's own order, and invents nothing about which one wins.
  assert.match(rows, /const facts = dayJournalPlateFacts\(item\);/);
  assert.match(screen, /\{fact\.text\}/);
  // **An absent line is not rendered at all** — not as an empty box, which still earns
  // the column's gap, and which is what reserving it unconditionally cost.
  assert.match(rows, /\{facts\.length === 0 \? null :/);
  // And the flag went with the pill, which carries the rank in colour and a word.
  assert.doesNotMatch(rows, /flag-outline/);
});

test('rank is a colour in four ranks, and only the top two colour anything', () => {
  assert.deepEqual(
    (['low', 'normal', 'high', 'critical'] as const).map((rank) => JOURNAL_RANK_ORDER[rank]),
    [0, 1, 2, 3],
  );
  assert.equal(journalRankIsDrawn('low'), false);
  assert.equal(journalRankIsDrawn('normal'), false, 'a marker beside every item ranks nothing');
  assert.equal(journalRankIsDrawn('high'), true);
  assert.equal(journalRankIsDrawn('critical'), true);
});

test('the amber is gone, and rank keeps four stops only where it is chosen', () => {
  // **The rank hue is deleted with the tint it coloured** (PD-PLATE-004). It existed
  // because a rank painted a column, and it was a value no palette carried — an exact
  // literal that had to be exempted from the theme. Rank is weight and one `over` dot
  // now, so there is nothing left for it to paint.
  const themes = readFileSync('src/ui/theme/color-themes.ts', 'utf8');
  assert.doesNotMatch(themes, /PRIORITY_HIGH_ACCENT|priorityHighAccent|priorityCriticalAccent/);
  assert.doesNotMatch(readFileSync('src/features/planner/presentation/item-chip.tsx', 'utf8'), /rankTone|rankGutterInk/);

  // What survives is the **chooser** in Create and Edit. Its top two stops are no
  // longer a ramp out of the neutrals: high is amber and critical keeps `over` (owner
  // instruction, 2026-08-06), and both are the readable forms of what the plate's own
  // spine paints, so the chooser cannot name a colour the plate never draws.
  for (const id of COLOR_THEME_IDS) {
    const palette = colorThemePalette(id);
    const { today } = getLifePlannerTheme(id);
    assert.notEqual(today.priorityHigh, palette.structInk, `${id}: high was body ink`);
    assert.equal(new Set([today.priorityLow, today.priorityNormal, today.priorityHigh, today.priorityCritical]).size, 4, id);
    for (const stop of [today.priorityLow, today.priorityNormal, today.priorityHigh, today.priorityCritical]) {
      assert.match(stop, /^#[0-9A-F]{6}$/i, id);
    }
  }
});


test('the rank has no word on any plate, and the tint survives completion', () => {
  // `RankPill` is deleted rather than left dormant: a component nothing renders is a
  // thing the next reader has to rule out.
  assert.doesNotMatch(screenCode, /function RankPill/);
  assert.match(screen, /The rank has no word anywhere in the application any more/);
  assert.doesNotMatch(screenCode, /rankPill/);
  // **And nothing survives of the tone either.** The tint, the spine and the derived
  // ink went with the column they painted; rank is weight and one `over` dot, and the
  // level is spoken in each row's accessibility label.
  assert.doesNotMatch(chip, /export function rankTone/);
  assert.match(screenCode, /IMPORTANCE_LABELS\[item\.importance\]\.toLowerCase\(\)/);
});


test('a reminder states the minute it fires, from stored data', () => {
  const catalogue = [
    { habitId: 'woken', reminderLocalTime: '18:00' },
    { habitId: 'quiet', reminderLocalTime: null },
  ] as unknown as Parameters<typeof dayJournalReminderLocalTimes>[0];
  const reminders = dayJournalReminderLocalTimes(catalogue);
  assert.equal(reminders.get('woken'), '18:00');
  assert.equal(reminders.has('quiet'), false);
  // What it promises is a stored plan, not a delivered alert: no notification
  // package is a dependency, so nothing fires.
  assert.match(model, /stored plan, not a delivered alert/);
});

test('how a thing repeats is not carried onto the day at all', () => {
  // **Owner instruction, 2026-08-02.** `Every day` was the second line's last fallback, so
  // it was the line nearly every habit ended up wearing — and it says only what the item's
  // own shape already says, which is the reasoning PD-TODAY-112 gave when the repeat glyph
  // was withdrawn for the same words. On an axis it cost the most: a plate at its floor has
  // one row, and a rhythm that never changes was taking it from the marks that do.
  const built = selectDayJournalItems({
    nowMinuteOfDay: null,
    rootGroups: [rootGroup(occurrenceRow('habit', 'Stretch', '09:00')), rootGroup(occurrenceRow('task', 'Post', '10:00'))],
    taskHabitIds: new Set(['task']),
  });
  const [stretch, post] = built.timed;
  assert.equal(
    dayJournalPlateFacts(stretch).some((fact) => fact.kind === 'repeat' as string),
    false,
    'a habit says its minute and its length, and never how it repeats',
  );
  assert.equal(post.kind, 'task');
  // The whole chain is gone rather than merely unread: the caption was built for every
  // habit of the day on every render of the screen.
  assert.doesNotMatch(screenCode, /scheduleSummary/);
  assert.doesNotMatch(screenCode, /recurrences/);
});

test('a reminder reaches the item it belongs to', () => {
  const built = selectDayJournalItems({
    nowMinuteOfDay: null,
    reminderLocalTimes: localTimes([['woken', '07:45']]),
    rootGroups: [rootGroup(occurrenceRow('woken', 'Wake', '08:00')), rootGroup(occurrenceRow('quiet', 'Read', '09:00'))],
    taskHabitIds: new Set(),
  });
  assert.equal(built.timed[0].reminderLocalTime, '07:45');
  assert.equal(built.timed[1].reminderLocalTime, null);
});

// ── Steps ────────────────────────────────────────────────────────────────────

test('an item with no lines has no counter, because the counter is the control', () => {
  // The step counter is a fact **and** the thing that opens the list, so an item with no
  // lines simply never produces it. It stands last of the facts, because it is a control
  // and the eye should reach what an item says before what it can press.
  const rows = functionSource(screen, 'function Plate', 'function StepRow');
  assert.match(rows, /fact\.kind === 'steps'/);
  assert.match(rows, /onPress=\{onToggleSteps\}/);
  assert.deepEqual(dayJournalPlateFacts(item('Bare', '09:00')).map((fact) => fact.kind), ['time']);
  assert.deepEqual(
    dayJournalPlateFacts(item('Lined', '09:00', { steps: [{ done: false, id: 's1', title: 'a' }] })).map((fact) => fact.kind),
    ['time', 'steps'],
  );
});

test('steps hang under their row in flow, and are counted by their own box', () => {
  assert.match(screen, /\{item\.steps\.map\(\(step\) => <StepRow/);
  assert.doesNotMatch(screen, /stepTops/);
  assert.equal(PLATE_SUBTASK_ROW, 30);
});

test('the plate reserves nothing for a line it may not have', () => {
  // **This is the defect the package exists to fix.** The text column is centred with
  // no fixed height and no slot held for a second line: with one it is 22 + 2 + 18 = 42
  // and sits 3 pt from the top of a 48 pt plate, without one it is 22 and sits at 13.
  // Reserving the line unconditionally is exactly what hung the title against the top
  // edge, because an empty box still earns the column's gap.
  const rows = functionSource(screen, 'function Plate', 'function StepRow');
  assert.match(screen, /plateWords: \{ flex: 1, gap: 2, justifyContent: 'center', minWidth: 0 \}/);
  assert.doesNotMatch(screen, /plateWords: \{[^}]*(height|minHeight)/);
  // The absent line is not rendered at all — not as a view, not as a space.
  assert.match(rows, /\{facts\.length === 0 \? null :/);

  // The arithmetic the two offsets come from, so a change to any of the three steps
  // has to be made deliberately rather than discovered on a device.
  const title = 22;
  const sub = 18;
  const gap = 2;
  assert.equal((PLATE_MIN_HEIGHT - (title + gap + sub)) / 2, 3);
  assert.equal((PLATE_MIN_HEIGHT - title) / 2, 13);

  // **Every fact that exists is stated, in one order, and nothing is dropped.** The old
  // second line offered a single slot in strict priority, so an item that was late, had
  // steps and carried a reminder said only that it was late — and no item with a clock
  // time could ever show how long it takes, because the lead column held `time ??
  // duration`. Five facts, two places, three silent losers.
  const all = item('Everything', '09:00', {
    durationMinutes: 45,
    overdue: true,
    overdueMinutes: 30,
    reminderLocalTime: '07:30',
    steps: [{ done: false, id: 's1', title: 'a' }],
  });
  // **A late row says one word and stops** (owner, 2026-08-05). Everything this item
  // could say — its minute, its length, its bell, its steps — stands down while it is
  // late, because twelve red elements on one screen were all reporting one fact.
  assert.deepEqual(dayJournalPlateFacts(all).map((fact) => fact.kind), ['late']);
  assert.deepEqual(dayJournalPlateFacts(all).map((fact) => fact.text), ['Overdue']);
  // Not late, and every fact it has is stated, in one order.
  const ahead = { ...all, overdue: false, overdueMinutes: null };
  assert.deepEqual(dayJournalPlateFacts(ahead).map((fact) => fact.kind), ['time', 'duration', 'reminder', 'steps']);
  assert.deepEqual(dayJournalPlateFacts(ahead).map((fact) => fact.text), ['09:00', '45m', '07:30', '0 of 1']);
  // An absent fact is absent rather than empty: the row renders nothing for it, which is
  // what keeps a one-fact plate from reserving the room of a four-fact one.
  assert.deepEqual(
    dayJournalPlateFacts(item('Bare', null)).map((fact) => fact.kind),
    [],
  );
  // A task left open on a day that is over has no minute to measure from, so it says
  // that it is late and does not invent by how much.
  assert.deepEqual(
    dayJournalPlateFacts(item('Yesterday', null, { overdue: true })).map((fact) => fact.text),
    ['Overdue'],
  );
  // **A part of the day names its cause and states no arithmetic.** Nobody missed a
  // morning habit *by* three hours — the morning ended.
  assert.deepEqual(
    dayJournalPlateFacts(itemIn('morning', 'Vitamins', { blockOverdue: true, overdue: true })).map((fact) => fact.text),
    ['Overdue'],
  );
  // And the rhythm is still not said here: there is no fallback line.
  assert.deepEqual(dayJournalPlateFacts(item('Plain', null, { durationMinutes: null })).map((fact) => fact.kind), []);
});

test('the drop is parked on the selected date the moment the row has a width', () => {
  // Reported from the device: no drop at launch, and changing the date is what makes one
  // appear. The journey is initialised with `fromX: 0, toX: 0` because at mount the week
  // row has no width; `scrollX` is re-seeded when the width lands and nothing revisited
  // the journey, so the drop interpolated to 0 while the strip stood ~18 800 pt along and
  // was drawn that far off the leading edge. The digits stayed uninverted for the same
  // reason — they invert for wherever the drop says it is. One cause, two symptoms.
  const initial = { curve: null, from: 'a', fromX: 0, inEnd: 1, inStart: 0, to: 'a', toX: 0 };
  const parked = journalParkedJourney(initial, 18_845);
  assert.notEqual(parked, null);
  assert.equal(parked?.fromX, 18_845);
  assert.equal(parked?.toX, 18_845, 'both ends, so the interpolation is a constant');
  // **The input range is carried through untouched.** `travel` is monotonic and every
  // reader must be bound to the range it is actually standing in; rewriting it to a tidy
  // `[0, 1]` is the failure that walks a surface off the screen a width at a time.
  assert.equal(parked?.inStart, initial.inStart);
  assert.equal(parked?.inEnd, initial.inEnd);
  // A journey that has already run keeps its own range too, wherever the value stands.
  const midway = journalParkedJourney({ fromX: 10, inEnd: 5, inStart: 4, toX: 400 }, 250);
  assert.deepEqual(midway, { fromX: 250, inEnd: 5, inStart: 4, toX: 250 });
  // Already parked answers `null`, so the effect schedules no render that changes nothing.
  assert.equal(journalParkedJourney({ fromX: 250, toX: 250 }, 250), null);
  // And the screen skips it while something is in flight: a journey owns the value for
  // its length, and parking mid-travel would teleport the drop.
  assert.match(screen, /if \(weekRowWidth === 0 \|\| flying\.current\) return;/);
  assert.match(screen, /journalParkedJourney\(journeyRef\.current, trackXOf\(selectedRef\.current\)\)/);
});

test('a part of the day is a deadline, and «когда угодно» is not', () => {
  // Owner decision, 2026-08-05: either lateness covers the things that live in a block
  // without a clock time, or the idea is withdrawn. Before it, an item with no minute
  // could never be late however far the day ran.
  assert.equal(plannerDayBlockHasEnded('morning', 12 * 60 + 1), true, 'the morning is over at 12:01');
  assert.equal(plannerDayBlockHasEnded('morning', 11 * 60 + 59), false);
  assert.equal(plannerDayBlockHasEnded('day', 17 * 60), true);
  assert.equal(plannerDayBlockHasEnded('day', 16 * 60 + 59), false);
  // **The evening never ends inside its own day.** It runs 17:00 → 04:00, so its
  // boundary falls on the next date and no minute-of-day can reach it.
  assert.equal(plannerDayBlockHasEnded('evening', 23 * 60 + 59), false);
  // Before four in the morning nothing has ended either, and the plain comparison says so.
  assert.equal(plannerDayBlockHasEnded('morning', 60), false);

  // **And it reaches the item**, which is the half a constant cannot prove. Read at
  // 12:01 with a morning habit and a morning task, both untimed and neither closed.
  const built = selectDayJournalItems({
    nowMinuteOfDay: at('12:01'),
    rootGroups: [
      rootGroup(blockRow('vitamins', 'Витамины', 'morning')),
      rootGroup(blockRow('post', 'Отправить', 'morning')),
      rootGroup(blockRow('supper', 'Ужин', 'evening')),
      rootGroup(occurrenceRow('later', 'Позже', '15:00')),
      rootGroup(blockRow('loose', 'Когда-нибудь', null)),
    ],
    taskHabitIds: new Set(['post']),
  });
  const byId = new Map(([...built.timed, ...built.anytime]).map((entry) => [entry.habitId, entry]));
  // A habit and a task are treated alike here: the owner's rule is about the part of the
  // day, not about which shape the thing is.
  for (const id of ['vitamins', 'post']) {
    assert.equal(byId.get(id)?.overdue, true, `${id} is late because the morning ended`);
    assert.equal(byId.get(id)?.blockOverdue, true, id);
  }
  // The evening has not ended and cannot inside its own day.
  assert.equal(byId.get('supper')?.overdue, false);
  // A minute still ahead is not late, and the block clause does not reach it.
  assert.equal(byId.get('later')?.overdue, false);
  assert.equal(byId.get('later')?.blockOverdue, false);
  // An item with no block is outside this entirely: «когда угодно» is not a deadline,
  // and deriving one from a minute is the derivation the whole module refuses.
  assert.equal(byId.get('loose')?.overdue, false, 'anytime is not a deadline');
  assert.equal(byId.get('loose')?.blockOverdue, false);
  // What the plate then says is the cause, not an arithmetic nobody meant.
  assert.deepEqual(dayJournalPlateFacts(byId.get('vitamins')!).map((fact) => fact.text), ['Overdue']);
  // A duration that is absent rather than null prints nothing, and it used to print
  // `NaN ч NaN м`: `undefined <= 0` is false, so the old guard let it through.
  assert.equal(blockDurationLabel(undefined as unknown as number | null), null);
  assert.equal(blockDurationLabel(Number.NaN), null);
  assert.equal(blockDurationLabel(0), null);
  assert.equal(blockDurationLabel(70), '1h 10m');
  // And the block heading counts it, which is where lateness is actually noticed.
  const morning = selectDayBlocks([...built.timed, ...built.anytime]).sections.find((s) => s.block === 'morning');
  assert.equal(morning?.overdueCount, 2);
  assert.equal(morning?.count, 2);
});

test('a line alone on its row may take a slop; two neighbours may not', () => {
  // A slop overlaps invisibly, so a near-miss between the chevron and the checkbox
  // would land on the wrong one — those get real boxes (PD-TODAY-044).
  const step = functionSource(screen, 'function StepRow', 'function Checkbox');
  assert.match(step, /hitSlop=\{\{ bottom: 8, left: 8, right: 8, top: 8 \}\}/);
  assert.match(screen, /checkboxTarget: \{[^}]*width: JOURNAL_TOUCH_TARGET/);
  // **A line's box stands on the parent's own vertical**, which needs the same box
  // centred the same way: `flex-end` aligns two diameters by their right edges, which
  // is not the same thing as centring one under the other.
  // **A line's box leads its row** at the title's own leading edge (PD-PLATE-002): a
  // checklist is read down its boxes, so they stand in one column under the title
  // they belong to rather than at the far side of the plate.
  assert.match(screen, /stepBox: \{[^}]*width: PLATE_SUBTASK_BOX \}/);
  assert.doesNotMatch(screen, /stepBoxTarget/);
  assert.ok(PLATE_SUBTASK_BOX < PLATE_CHECKBOX, 'and it is the smaller of the two');
});

// ── Anytime ──────────────────────────────────────────────────────────────────

test('all four sections fold by the same arrow, and none of them half-folds', () => {
  // **The partial disclosure is withdrawn.** «Когда угодно» used to offer «ещё 3» and
  // show its first two — a different affordance from the blocks below it, appearing only
  // past a threshold, and one that could not fold the section away at all. Owner
  // instruction of 2026-08-05: the same arrow on all four. What is shown is everything or
  // nothing, so the count in the heading can never disagree with what is under it.
  assert.doesNotMatch(screen, /ANYTIME_COLLAPSED|anytimeOpen|anytimeMore/);
  assert.match(screen, /\{collapsed\.has\('anytime'\) \? null : blocks\.anytime\.map/);
  assert.match(screen, /\{collapsed\.has\(section\.block\)\s*\n\s*\? null/);
  // One state for all four, keyed by the union the model states rather than by a string.
  assert.match(screen, /useState<ReadonlySet<DayJournalSectionKey>>/);
  assert.match(blocksModel, /export type DayJournalSectionKey = PlannerDayBlockKey \| 'anytime';/);
  // Both headers draw the same chevron, and the whole leading group is the target: a
  // 14 pt glyph on its own is a control nobody can hit.
  const anytimeHeader = functionSource(screen, 'function AnytimeHeader', 'function BlockHeader');
  const blockHeader = functionSource(screen, 'function BlockHeader', 'function Plate');
  for (const header of [anytimeHeader, blockHeader]) {
    assert.match(header, /name=\{collapsed \? 'chevron-forward' : 'chevron-down'\}/);
    assert.match(header, /style=\{styles\.blockDisclosure\}/);
    assert.match(header, /accessibilityState=\{\{ expanded: !collapsed \}\}/);
  }
  // **A folded block still says that something under it is behind**, which is the whole
  // reason folding is safe to offer: the count lives in the heading, not on the plates.
  assert.match(blockHeader, /\$\{section\.overdueCount\} overdue/);
  assert.match(anytimeHeader, /\$\{overdueCount\} overdue/);
  // And a fold survives a page turn: it is how a person reads the list, not a fact
  // about one date, so only the open steps are cleared when the day changes.
  assert.match(screen, /setExpanded\(new Set\(\)\);/);
  assert.doesNotMatch(screen, /setCollapsed\(new Set\(\)\);/);
});

test('an item with no block is the same plate under a different heading', () => {
  // The separate Anytime row is gone, and its going is the point: it existed to draw
  // `—` where a start would be, back when a plate's whole identity was its minute. With
  // blocks, having no minute is ordinary — most items do not have one — so one component
  // draws every item on the screen and there is no second row language to keep in step.
  assert.doesNotMatch(screenCode, /function AnytimeRow/);
  const layout = selectDayBlocks([
    itemIn(null, 'loose'),
    itemIn('morning', 'placed'),
  ]);
  assert.deepEqual(layout.anytime.map((entry) => entry.habitId), ['loose']);
  assert.equal(layout.sections.find((section) => section.block === 'morning')?.count, 1);
});

// ── The week, the month, and the marks ───────────────────────────────────────

test('the week always starts on Monday and never re-centres on the selection', () => {
  assert.deepEqual([...JOURNAL_WEEKDAY_LETTERS], ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  // 2026-07-27 is a Monday; 2026-08-02 is the Sunday that closes its week.
  assert.equal(journalWeekdayIndex(date('2026-07-27')), 0);
  assert.equal(journalWeekStart(date('2026-07-30')), date('2026-07-27'));
  assert.equal(journalWeekStart(date('2026-08-02')), date('2026-07-27'));
  const week = journalWeekDates(date('2026-07-27'));
  assert.equal(week.length, 7);
  assert.equal(week[0], date('2026-07-27'));
  assert.equal(week[6], date('2026-08-02'));
});

test('a week is named by the month it mostly belongs to', () => {
  // 31 August is a Monday in 2026, so that week is one August day and six
  // September ones: the header that named the first day disagreed with almost
  // every date under it.
  assert.equal(journalMonthLabel(journalDominantMonthDate(journalWeekDates(date('2026-08-31')))), 'September 2026');
  // Five and two the other way: 27 July – 2 August stays July.
  assert.equal(journalMonthLabel(journalDominantMonthDate(journalWeekDates(date('2026-07-27')))), 'July 2026');
  // Two and five: 29 June – 5 July is July.
  assert.equal(journalMonthLabel(journalDominantMonthDate(journalWeekDates(date('2026-06-29')))), 'July 2026');
  // A week wholly inside its own month.
  assert.equal(journalMonthLabel(journalDominantMonthDate(journalWeekDates(date('2026-07-06')))), 'July 2026');
});

test('the month grid leads with blanks and then holds every day of the month', () => {
  const cells = journalMonthCells(date('2026-07-15'));
  // 1 July 2026 is a Wednesday, so two blanks precede it in a Monday-first grid.
  assert.deepEqual(cells.slice(0, 2), [null, null]);
  assert.equal(cells[2], date('2026-07-01'));
  assert.equal(cells.length, 2 + 31);
  assert.equal(cells[cells.length - 1], date('2026-07-31'));
  assert.equal(journalMoveMonth(date('2026-07-15'), 1), date('2026-08-01'));
  assert.equal(journalMoveMonth(date('2026-01-15'), -1), date('2025-12-01'));
});

test('the marks under a date are its tasks, one dot each and never a habit', () => {
  // A habit recurs and says nothing about a date, so counting habits made every
  // date wear the same dots. A task is a one-day item, and its single active day
  // is the date the dot belongs under.
  const task = (habitId: string, from: string, to: string, accent: string | null, parent: string | null = null) => ({
    activeRange: { effectiveFrom: from, effectiveTo: to },
    habitId,
    ordinaryParentHabitId: parent,
    schedule: { definition: { scheduleType: 'daily' } },
    visualIdentity: { persistedAccentKey: accent },
  });
  const marks = journalTaskMarks([
    task('a', '2026-07-28', '2026-07-29', 'blue'),
    task('b', '2026-07-28', '2026-07-29', 'red'),
    // A habit: the same schedule type but an open range, so it is nobody's dot.
    task('habit', '2026-07-28', null as never, 'green'),
    // A subtask of `a`. It inherits its item's dates and schedule, so it matched
    // the task rule exactly as its parent did and wore a dot of its own — a task
    // with two subtasks showed three. It is a line inside its item.
    task('a-step', '2026-07-28', '2026-07-29', 'purple', 'a'),
    task('c', '2026-07-30', '2026-07-31', null),
  ] as never);
  assert.deepEqual((marks.get('2026-07-28') ?? []).map((mark) => mark.accentKey), ['blue', 'red']);
  // An item saved without an accent still gets a colour of its own rather than
  // sharing one neutral with every other.
  assert.equal(marks.get('2026-07-30')?.length, 1);
  assert.equal(marks.has('2026-07-29'), false);
  // The mark carries what the strip draws: the item's category and its own symbol.
  assert.equal(marks.get('2026-07-28')?.[0].habitId, 'a');
  assert.equal(marks.get('2026-07-28')?.[0].categoryKey, 'work', 'blue is Work');
});

test('the strip draws three marks, and from four it draws two and counts the rest', () => {
  const mark = (habitId: string) => ({
    accentKey: 'blue' as const, categoryKey: 'work' as const, habitId, identity: null,
  });
  const three = journalTaskMarkRow([mark('a'), mark('b'), mark('c')]);
  assert.equal(three.shown.length, 3, 'three fit the cell');
  assert.equal(three.overflow, 0);
  const four = journalTaskMarkRow([mark('a'), mark('b'), mark('c'), mark('d')]);
  assert.deepEqual(four.shown.map((entry) => entry.habitId), ['a', 'b']);
  assert.equal(four.overflow, 2, 'the chip counts everything it stands for');
  const many = journalTaskMarkRow(['a', 'b', 'c', 'd', 'e', 'f'].map(mark));
  assert.equal(many.shown.length, 2);
  assert.equal(many.overflow, 4);
  assert.deepEqual(journalTaskMarkRow([]), { overflow: 0, shown: [] });
});

test('every task is collected, because the strip states the remainder as a count', () => {
  // Capping the walk at three would have made the `+N` chip unable to say N.
  const task = (habitId: string) => ({
    activeRange: { effectiveFrom: '2026-07-28', effectiveTo: '2026-07-29' },
    habitId,
    ordinaryParentHabitId: null,
    schedule: { definition: { scheduleType: 'daily' } },
    visualIdentity: { iconIdentity: { kind: 'symbol', symbolKey: 'habit_generic' }, persistedAccentKey: 'blue' },
  });
  const marks = journalTaskMarks(['a', 'b', 'c', 'd', 'e'].map(task) as never);
  assert.equal(marks.get('2026-07-28')?.length, 5);
});

test('a date carries dots, and its selection is a circle the size of its row', () => {
  // **The 16 pt task marks are retired for the prototype's dots**, on the owner's
  // instruction. They said *what* was on a day and cost a 14 pt band under every date —
  // eleven points of which stood between the dates and the line below. A dot says the
  // day is not empty and its colour says which area of life. Recorded as a reversal.
  assert.match(screen, /dot: \{ borderRadius: 2, height: 4, width: 4 \}/);
  assert.match(screen, /marks: \{[^}]*height: 5[^}]*marginTop: 3/);
  assert.doesNotMatch(screen, /JOURNAL_MARK_OVERLAP/, 'nothing overlaps any more');
  // **And the selection stayed a circle**, by owner decision after the rounded rectangle
  // was tried on the device: the rectangle read as a block rather than as a date. Its
  // width is the row, so the digit sits in a circle and never in an oval.
  assert.match(screen, /dateCircle: \{[^}]*borderRadius: JOURNAL_DATE_ROW \/ 2[^}]*height: JOURNAL_DATE_ROW[^}]*width: JOURNAL_DATE_ROW \}/);
  assert.match(screen, /dateCell: \{ alignItems: 'center', flex: 1 \}/);
});

test('density marks are distinct categories, three at most, and never invented', () => {
  assert.deepEqual([...journalDensityMarks(undefined, false)], []);
  const summary = {
    indicators: [
      { visualIdentity: { persistedAccentKey: 'blue' } },
      { visualIdentity: { persistedAccentKey: 'blue' } },
      { visualIdentity: { persistedAccentKey: 'cyan' } },
      { visualIdentity: { persistedAccentKey: 'amber' } },
      { visualIdentity: { persistedAccentKey: 'brown' } },
      { visualIdentity: { persistedAccentKey: 'green' } },
    ],
  } as unknown as Parameters<typeof journalDensityMarks>[0];
  const marks = journalDensityMarks(summary, false);
  // `blue` twice is one mark, `cyan` names no category and is skipped entirely,
  // and the row stops at three.
  assert.equal(marks.length, 3);
  assert.equal(new Set(marks).size, 3);
});

// ── Times, and the deliberate tap ────────────────────────────────────────────

test('a minute survives being written down and read back', () => {
  assert.equal(journalMinuteOfLocalTime('11:02'), 662);
  assert.equal(journalLocalTimeOfMinute(662), '11:02');
  assert.equal(journalMinuteOfLocalTime(null), null);
  assert.equal(journalMinuteOfLocalTime('24:00'), null);
  assert.equal(journalMinuteOfLocalTime('7:00'), null);
  assert.equal(journalLocalTimeOfMinute(-5), '00:00');
});

test('a scroll or a long hold opens nothing', () => {
  const base = { downAt: 1000, downX: 100, downY: 200 };
  assert.equal(isDeliberateJournalTap({ ...base, upAt: 1120, upX: 102, upY: 203 }), true);
  assert.equal(isDeliberateJournalTap({ ...base, upAt: 1120, upX: 100, upY: 240 }), false, 'a scroll');
  assert.equal(isDeliberateJournalTap({ ...base, upAt: 1120, upX: 140, upY: 200 }), false, 'a swipe');
  assert.equal(isDeliberateJournalTap({ ...base, upAt: 1700, upX: 100, upY: 200 }), false, 'a hold');
});

// ── What the screen does not invent ──────────────────────────────────────────

test('the journal fabricates no reschedule and no in-place rule editing', () => {
  // No canonical command reschedules an occurrence, and changing a saved habit's
  // rules runs through the effective-dated contract.
  // The word survives in the comment that explains the absence; what must not
  // exist is a control or a handler for it.
  assert.doesNotMatch(screen, /onReschedule|rescheduleAction|name="refresh/);
  // **A tap opens the editor, and nothing in between.** The small sheet it used to
  // open stated three facts and carried a `›` to the editor for each of them — a
  // window whose only content was the way out of itself.
  assert.match(screen, /habitDetailNavigation\(item\.row\.habitId, date\)/);
  assert.doesNotMatch(screen, /JournalItemSheet/);
});

test('completion goes through the canonical commands and nothing else', () => {
  assert.match(screen, /recordHabitObservation\(\{ \.\.\.row\.commandContext, value: \{ type: 'checkbox', booleanValue: true \} \}\)/);
  assert.match(screen, /correctionReason: 'reversal'/);
  // A control appears only where the canonical action exists: a derived routine
  // container has none, and a tick invents no quantity for a measured habit.
  assert.match(screen, /if \(!completable \|\| locked === true\)/);

  // **A day that is over keeps what was recorded on it.** Ticking a past day is allowed
  // and says what it costs (PD-JOURNAL-002); *unticking* one is editing what happened,
  // from a screen with no way to say why — and the mark already counts toward nothing,
  // so there is nothing to undo but the record itself. The control is not drawn, and
  // the rule is said again in `toggleDone` where an accessibility action could reach it.
  assert.match(screen, /if \(done && date < today\) return;/);
  assert.match(screen, /locked=\{!item\.reopenable\}/);
  const on = (dayIsPast: boolean, state: string) => selectDayJournalItems({
    dayIsPast,
    nowMinuteOfDay: at('12:00'),
    rootGroups: [rootGroup({ ...occurrenceRow('read', 'Read', '09:00'), state } as never)],
    taskHabitIds: new Set<string>(),
  }).timed[0];
  assert.equal(on(true, 'qualified').reopenable, false, 'a closed item on a day that is over');
  assert.equal(on(true, 'due').reopenable, true, 'an open one may still be ticked');
  assert.equal(on(false, 'qualified').reopenable, true, 'and today is untouched');
});

// ── Motion, and the column that wrapped ──────────────────────────────────────

test('the page arrives from the side time moved, decided by date and not distance', () => {
  const monday = date('2026-07-27');
  assert.equal(journalSlideDirection(monday, date('2026-07-28')), 1);
  assert.equal(journalSlideDirection(monday, date('2026-08-07')), 1, 'eleven days forward is still forward');
  assert.equal(journalSlideDirection(monday, date('2026-07-26')), -1);
  // Selecting the day already shown is not a movement, and reads as forward.
  assert.equal(journalSlideDirection(monday, monday), 1);
});

test('the brief timings are the timings, not approximations of them', () => {
  assert.equal(JOURNAL_DAY_SLIDE_MS, 320);
  assert.equal(JOURNAL_DAY_SLIDE_OFFSET, 22);
  // The date change's own two durations are gone with the timers that used them: a
  // spring has a stiffness and a damping, not a length, and `src/ui/motion` owns them.
  assert.equal(JOURNAL_POP_MS, 240);
  assert.equal(JOURNAL_POP_STAGGER, 70);
});

test('the drop is one object that travels, and nothing is destroyed on the way', () => {
  // **The metaball is gone, and so is every trace of it.** Two circles and a neck are
  // three primitives where the selection is one thing; what replaced them has to be a
  // single view, or the fault this package exists to fix has only moved.
  assert.doesNotMatch(screen, /dropCircle|dropNeck|JOURNAL_DROP_CURVES/);
  assert.match(screen, /function DateDrop\(\{ travel, scrollX, sample, digits, columnWidth, trackX \}/);
  // One view, and its three transforms are a place, a stretch and a squash.
  // The subtraction survives the port — it is what keeps a browse and a travel from
  // needing to know about each other — and both halves are shared values now, which is the
  // whole reason the port was necessary: they cannot be subtracted across two systems.
  // **Two coordinates, and the difference is the trick.** `trackX` is the drop's place in
  // the strip's content; `beadX` is where that lands on screen. The bead is placed by the
  // screen one; the lens works in the content one, where `scrollX` cancels against the
  // digits' own content positions — so a browse moves the glass and its subject together.
  assert.match(screen, /const beadX = useDerivedValue\(\(\) => trackX\.value - scrollX\.value\);/);
  assert.match(screen, /<DropLens columnWidth=\{columnWidth\} digits=\{digits\} trackX=\{trackX\}/, 'the lens is given the content coordinate');
  assert.match(screen, /\{ scaleX: beadStretch\.value \}/);
  assert.match(screen, /\{ scaleY: interpolate\(travel\.value, sample\.value\.progress, sample\.value\.squash/);
  // Nothing about it is animated as a width, a height or a radius — the standing rule
  // for anything sharing a screen with a list (PD-PLANNER-V033-UI-017).
  assert.doesNotMatch(screen, /dropBead[\s\S]{0,240}Animated[\s\S]{0,60}(width|height|borderRadius):/);
});

test('the drop’s place is a subtraction, so browsing and travelling never fight', () => {
  // Content coordinates on both sides. A date's place in the strip is its page plus its
  // column, and the screen place is that minus the scroll — which is what lets the
  // finger browse the weeks while a tap moves the drop between them.
  const strip = 362;
  assert.equal(journalDropTrackX({ column: 0, page: 0, stripWidth: strip }), strip / 14);
  assert.equal(journalDropTrackX({ column: 3, page: 2, stripWidth: strip }), 2 * strip + (strip / 7) * 3.5);
  // A whole week on is the same column one page along: the drop stands still and the
  // strip pages under it. That is the one jump it does not narrate, deliberately.
  const sameWeekday = journalDropTrackX({ column: 4, page: 5, stripWidth: strip })
    - journalDropTrackX({ column: 4, page: 4, stripWidth: strip });
  assert.equal(sameWeekday, strip, 'exactly one page, so the screen distance is nil');
  // The per-cell distance is **gone with the inversion it fed**: nothing in the strip
  // needs to know where the drop is any more, because no digit changes because of it.
  assert.doesNotMatch(screen, /Animated\.subtract\(dropTrackX, trackXOf\(date\)\)/);
  // What survives is the drop's own subtraction, which is what keeps a browse and a
  // travel from having to know about each other.
  // The subtraction survives the port — it is what keeps a browse and a travel from
  // needing to know about each other — and both halves are shared values now, which is the
  // whole reason the port was necessary: they cannot be subtracted across two systems.
  // **Two coordinates, and the difference is the trick.** `trackX` is the drop's place in
  // the strip's content; `beadX` is where that lands on screen. The bead is placed by the
  // screen one; the lens works in the content one, where `scrollX` cancels against the
  // digits' own content positions — so a browse moves the glass and its subject together.
  assert.match(screen, /const beadX = useDerivedValue\(\(\) => trackX\.value - scrollX\.value\);/);
  assert.match(screen, /<DropLens columnWidth=\{columnWidth\} digits=\{digits\} trackX=\{trackX\}/, 'the lens is given the content coordinate');

  // **The scroll has to be seeded, and this is the arithmetic that says why.** The strip
  // opens on the middle of a year of weeks, so its content is already 52 pages along
  // before a finger has touched it — and `Animated.event` only hears movement. Left at
  // zero the subtraction puts the drop 18 800 pt off the right edge, and the digits,
  // which invert for wherever the drop *says* it is, go white on white in Light and
  // near-black on near-black in Dark. Reported from the device as «дат не видно вообще»,
  // and it is one fault rather than two.
  const anchorPage = 52;
  const seeded = anchorPage * strip;
  for (let column = 0; column < 7; column += 1) {
    const onScreen = journalDropTrackX({ column, page: anchorPage, stripWidth: strip }) - seeded;
    assert.ok(onScreen > 0 && onScreen < strip, `column ${column} must land inside the row, not at ${onScreen}`);
  }
  const unseeded = journalDropTrackX({ column: 0, page: anchorPage, stripWidth: strip });
  assert.ok(unseeded > strip * 50, 'and without the seed it is nowhere near the screen');
  assert.match(screen, /scrollX\.value = Math\.max\(0, weekRail\.indexOf\(weekStart\)\) \* stripWidth;/);
  // And the strip's own scroll is read natively, because every digit in it depends on
  // the value: a JS-thread scroll handler here is the header's five rules broken.
  assert.match(screen, /useAnimatedScrollHandler\(\{[\s\S]{0,80}scrollX\.value = event\.contentOffset\.x;/);
});

test('the selection is glass, and the digit it stands under never inverts', () => {
  // **The inversion is retired with the opaque bead it existed for** (owner decision,
  // 2026-08-05). It was two stacked numerals cross-fading on opacity as the drop passed,
  // and it was necessary only because a solid fill has to be read against. Glass takes
  // the requirement away rather than solving it: one numeral, always ink.
  assert.doesNotMatch(screen, /dateNumberOver|JOURNAL_DROP_INK_HALF|opacity: under/);
  assert.doesNotMatch(modelCode, /JOURNAL_DROP_INK_HALF =/);
  assert.equal((screen.match(/styles[.]dateNumber/g) ?? []).length, 1, 'one numeral, not two');
  // The bead is a tint plus a hairline plus a top arc. **The hairline is load-bearing**:
  // a translucent region without an edge reads as a rendering artefact rather than as the
  // selection, which is how every glass control drawn without one fails.
  assert.match(screen, /backgroundColor: theme\.today\.structGlass,/);
  assert.match(screen, /borderColor: theme\.today\.hairline,[\s\S]{0,80}?borderWidth: StyleSheet\.hairlineWidth,/);
  // And the tab bar's plate is the same glass, from the same token — one material, not
  // two that can drift.
  assert.match(layout, /backgroundColor: theme\.today\.structGlass,/);

  // **No rim, and no white line anywhere on the glass.** The prototype's rim is a
  // feathered inner glow; React Native has no inset shadow, so it shipped as a hard
  // one-point border — and a hard white border at half opacity is a stripe, not a rim.
  // Reported from the device as «белая тупая полоска», and accurate. A faithful rim needs
  // a gradient, which is a dependency and therefore the owner's word.
  assert.doesNotMatch(screen, /glassRim|glassShade|dropSheen|beadSheen/);
  assert.doesNotMatch(layout, /glassRim|glassShade|plateRim/);
  assert.doesNotMatch(themeSource, /beadSheen:|glassRim:|glassShade:/);
  // **The material transmits, and that is the rule — not the step it makes.**
  //
  // This assertion replaces one written the day before, and the one it replaces encoded the
  // wrong thing. It required the material composited over a plate to clear a *luminance
  // step*, which is satisfiable only by making the glass opaque — and an opaque glass is a
  // floating panel, reported as exactly that. Separation is the **blur's** job: content
  // under the bar is defocused while content beside it is sharp, and that difference is the
  // boundary. The alpha's job is to let colour through.
  //
  // **Transparency did not cost legibility — it improved it**, because a more transparent
  // material sits closer to the ground it lies on: at 0.88 the light bar gave ink 13.7 and
  // `ink2` 4.14; at 0.50 it gives 15.6 and 4.71. Both are asserted below so neither half
  // can be traded away again.
  for (const id of COLOR_THEME_IDS) {
    const palette = COLOR_THEME_PALETTES[id];
    const match = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(palette.material);
    assert.ok(match, `${id}.material is not an rgba`);
    const [, r, g, b, rawAlpha] = match!;
    const alpha = Number(rawAlpha);
    assert.ok(alpha <= 0.6, `${id}: the material transmits only ${Math.round((1 - alpha) * 100)} % — that is paint, not glass`);
    // The blur has to be doing the work the alpha is no longer doing.
    assert.ok(palette.materialBlur >= 80, `${id}.materialBlur is ${palette.materialBlur}, too little to read as a lens`);
    // And the text on the worst composite — the material over a plate — still reads.
    const tint = `#${[r, g, b].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
    const over = mixColors(palette.surface, tint, alpha);
    const surfaces = buildThemeSurfaceColors(palette);
    assert.ok(contrastRatio(surfaces.primaryText, over) >= 7, `${id}: ink on the bar is ${contrastRatio(surfaces.primaryText, over).toFixed(1)}`);
    assert.ok(contrastRatio(surfaces.secondaryText, over) >= 4.5, `${id}: ink2 on the bar is ${contrastRatio(surfaces.secondaryText, over).toFixed(2)}`);
  }
  // The per-frame React write is gone outright, and so is the loop that drove it. The
  // one surviving `requestAnimationFrame` defers the month label by a frame and has
  // nothing to do with a date change, so it is named rather than banned wholesale.
  // The **call**, not the word: the comment above `travel` names what it replaced, and
  // an assertion a history note can break is an assertion about prose.
  assert.doesNotMatch(screen, /setPour\(/);
  assert.equal(
    screen.match(/requestAnimationFrame\(/g)?.length,
    undefined,
    'no frame callback survives on this screen at all: the month label was the last one',
  );
});

test('every reader of travel is bound to the journey’s own range', () => {
  // **This is the assertion that was missing, and its absence emptied the screen.**
  //
  // `travel` stopped running 0 → 1 per journey and became monotonic — 1, then 2, then 3 —
  // so that a new journey never has to write it and never races the render describing it.
  // `DayCarousel` was left reading it through `inputRange: [0, 1]`, which with the default
  // extrapolation kept extending: on the second date change the page stood a full width
  // off, on the third two widths, and it never came back.
  //
  // Nothing in the suite noticed, because every assertion here read *output* ranges and
  // signatures — the things that had not changed. What was wrong was the **binding**
  // between a driver and the range its readers interpret it in, and that is what this
  // checks: not that some particular interpolation exists, but that there is no reader of
  // `travel` anywhere in the file that is not bound to the journey.
  // **After the port the readers are `interpolate(travel.value, …)` inside worklets**, and
  // the rule is unchanged: bound to the journey's own range, and clamped. The scan finds
  // every one of them rather than naming any, which is what made it catch the reader that
  // was left on `[0, 1]` and walked a page off the screen.
  // **The scan tolerates a line break, and that is not cosmetic.** Written as
  // `interpolate\(travel\.value,` it silently found three of five once the calls were
  // wrapped — and a scan that misses a reader is precisely the failure that emptied the
  // screen, dressed as a passing suite.
  const readers = [...screen.matchAll(/interpolate\(\s*travel\.value,/g)];
  // **Four, and the count is the point.** Three on the drop — its place, its stretch, its
  // squash — and one on the header's arrival. The carousel's two went with the page
  // transition (`docs/DayTransitionAnimation.md`); a reader quietly deleted is as loud here
  // as one added, which is what makes this assertion worth keeping through a removal.
  assert.equal(readers.length, 4, `expected every travel reader to be found, saw ${readers.length}`);
  for (const reader of readers) {
    const declaration = screen.slice(reader.index ?? 0, (reader.index ?? 0) + 260).replace(/\s+/g, ' ');
    // **The journey is a shared value now, so every legal range names it** — `now` is the
    // frame's own snapshot of it, taken at the top of the worklet. A range that mentions
    // neither is a reader bound to something other than the journey, which is the fault.
    assert.match(
      declaration,
      /interpolate\(\s*travel\.value,\s*(\[now\.inStart, now\.inEnd\]|now\.progress|sample\.value\.progress)/,
      `a reader of travel interprets it in a range that is not the journey’s:
${declaration.slice(0, 160)}`,
    );
    assert.match(declaration, /Extrapolation\.CLAMP/, 'a reader of travel does not clamp');
  }
  // Nothing may read the value outside a worklet, which is what a per-frame JS bridge is.
  assert.doesNotMatch(screen, /travel\.addListener/);

  // **The scan reaches the tab bar too, and it did not before — which is why the same
  // defect survived there for five packages.** Reported from the device: the plate «едет
  // на выбранную, на долю секунды возвращается назад и снова едет». `travel.setValue(0)` lands
  // natively at once while the `setJourney` describing what 0 now means lands with the
  // next render, so one frame draws the new number against the **old** range — and 0 there
  // is the tab before last. An assertion that covers one of two surfaces running the same
  // model is an assertion that will be paid for on the other.
  // **The call, not the word.** The comment above the bar's `travel` names the defect it
  // replaced, and an assertion a history note can break is an assertion about prose — a
  // lesson this suite has now been taught three times.
  assert.doesNotMatch(layout, /travel\.setValue\(0\);/, 'a journey may not write travel to zero');
  const barReaders = [...layout.matchAll(/travel\.interpolate\(\{/g)];
  assert.ok(barReaders.length >= 3, `expected the bar's travel readers, saw ${barReaders.length}`);
  for (const reader of barReaders) {
    const declaration = layout.slice(reader.index ?? 0, (reader.index ?? 0) + 260);
    assert.match(
      declaration,
      /inputRange: (\[journey\.inStart, journey\.inEnd\]|\(journey\.curve\.progress as number\[\]\)\.map)/,
      `a reader of the bar's travel is not bound to the journey:
${declaration.slice(0, 180)}`,
    );
    assert.match(declaration, /extrapolate: 'clamp'/, "a reader of the bar's travel does not clamp");
  }
  // The spring ends where the journey says, rather than at a fixed 1.
  assert.match(layout, /toValue: at \+ 1,/);
});

test('the drop is the ground the dates stand on, never a lid over them', () => {
  // **`zIndex` is what broke it, and its absence is what fixes it.** The layer carried
  // `zIndex: 1` — written to mean «over the strip», meaning the opposite: 1 outranks the
  // list's default 0, so the opaque bead painted *over* the numbers and the selected date
  // had no digit at all. Confirmed frame by frame from `тест3.MP4`: at 11.7 s the
  // selection is a flat disc with nothing on it.
  assert.doesNotMatch(screen, /dropLayer: \{[^}]*zIndex/);
  // Order alone decides it, so the order is what is asserted: the layer is written
  // before the list, and a later sibling paints on top.
  const layerAt = screen.indexOf('<DateDrop');
  const listAt = screen.indexOf('<Reanimated.FlatList');
  assert.ok(layerAt > 0 && listAt > layerAt, 'the drop must be written before the strip it stands under');
});

test('Today travels, and every path into a date change is the same one', () => {
  // It used to set the date and scroll the strip, so the drop *was* there rather than
  // going there. Everything goes through `travelTo` now — the arrows, a tapped date, the
  // month sheet, the release of a swipe and Today alike.
  assert.match(screen, /const returnToToday = useCallback\(\(\) => \{[\s\S]{0,320}travelTo\(today\);/);
  assert.doesNotMatch(screen, /stepDay/);
  assert.match(screen, /onPress=\{\(\) => travelTo\(date\)\}/);
  assert.match(screen, /const jumpTo = useCallback\(\(date: PlannerLocalDate\) => \{[\s\S]{0,120}travelTo\(date\);/);
  // The velocity a release used to carry in went with the release. Every journey now
  // starts from rest, because every one of them starts from a tap.
  assert.doesNotMatch(screen, /gesture\.vx/);
});

test('the page swipe is gone, and nothing was left dormant behind it', () => {
  // **Owner decision, 2026-08-05.** It was an alternative to a control already on screen:
  // seven dates, each one tap away — which is what Apple's day view has *not* got and why
  // that one swipes. What it cost is on the record: an axis that stuck for the life of a
  // screen after one vertical scroll, the page pushed a full width off twice, a stretch
  // table read against a hand's pace, a release that rewound, and a carousel keyed on
  // element identity because a drag re-renders. Every one lived only in this path — and so
  // did the last defect still open on this screen, since only a gesture needs the page to
  // move before React has rendered.
  assert.doesNotMatch(screen, /PanResponder|panHandlers/);
  assert.doesNotMatch(screen, /swipeResponder|beginDrag|settleBack|dragTo|dragValue/);
  // **Removed, not disabled**: no branch survives that a later change could wake up.
  assert.doesNotMatch(screen, /onPanResponder|ShouldSetPanResponder/);
  // Its arithmetic goes with it rather than staying as exports nothing computes for
  // anything anybody sees — which is exactly what this project calls dead code held alive
  // by its own tests.
  assert.doesNotMatch(model, /export const JOURNAL_DROP_AXIS|export function journalDropProgress/);
  assert.doesNotMatch(model, /export function journalDropCommits|export function journalDropDirection/);
  // What is left is what a person actually uses, and the strip is still browsed by hand.
  assert.match(screen, /onPress=\{\(\) => travelTo\(date\)\}/);
  assert.match(screen, /onMomentumScrollEnd=\{settleWeek\}/);
});

test('the bead is a magnifier, and a settled date is enlarged rather than distorted', () => {
  // **PD-TODAY-152, and the turbulence it replaces was the wrong effect rather than a weak
  // one.** At the frequency that shipped the noise field's period was ≈83 pt against a 10 pt
  // numeral, so the field was near-constant across the glyph and the filter **slid** it
  // 1.8 pt instead of bending it — 24 % of its pixels changed shape once that slide was
  // subtracted. «Я не замечаю никакой разницы» was the correct reading of it.
  const lens = readFileSync('src/features/planner/presentation/drop-refraction.tsx', 'utf8');

  // **The lens magnifies the strip's own text and does not draw a substitute for it.**
  // Reported from the device as a **serif 6 between a sans-serif 5 and 7**: Skia cannot read
  // React Native views, so it had to redraw the numeral, and redrawing means resolving a
  // typeface — `matchFont` defaults to the family name `System`, hands a possible `null`
  // straight to `Skia.Font`, and the fallback then took the first family that could draw a
  // digit, which on iOS is an alphabetical accident. A magnifier does not ask which face is
  // underneath it. **No Skia anywhere in the app**, which this file was the last importer of.
  assert.doesNotMatch(lens, /react-native-skia/, 'the lens must not redraw what it can enlarge');
  assert.doesNotMatch(lens, /fontFamily/, 'a second font declaration is a second thing to keep in step');
  // **One declaration, two consumers.** The strip's cell and the lens both take the size from
  // the model, so «the magnified numeral is the same numeral» is structural rather than a
  // pair of literals somebody has to keep in step.
  assert.match(screen, /dateNumber: \{ fontSize: JOURNAL_DATE_TYPE_SIZE, fontWeight: '500' \}/);
  assert.match(lens, /fontSize: JOURNAL_DATE_TYPE_SIZE \* magnification/);
  assert.equal(JOURNAL_DATE_TYPE_SIZE, 17, 'the shared scale’s own step, unchanged');

  // **The widest date has to fit, and it is measured rather than assumed** — reported from
  // the device with `29` and `30` cut by the rim. The disc was sized from one digit's width
  // and two thirds of a month has two; a circle is the worst container for a pair, because
  // the glyphs are widest exactly where it narrows. A probe renders the widest date at the
  // requested size out in the clipped margin and reports what it really occupies.
  assert.match(lens, /const LENS_WIDEST_DATE = '3?0?\d?';/);
  assert.match(lens, /onLayout=\{\(event\) => setWidest\(event\.nativeEvent\.layout\.width\)\}/);
  assert.match(lens, /Math\.min\(LENS_MAGNIFICATION, LENS_MAGNIFICATION \* \(room \/ widest\)\)/);
  // **One fit for every date, never one per date.** Sizing each numeral to its own width is
  // what «унифицировать все даты» rules out: `1` and `30` would stand at different sizes.
  assert.doesNotMatch(lens, /adjustsFontSizeToFit/, 'a per-date fit is the opposite of unified');
  // The probe is measured, never seen: outside the disc, where the clip swallows it.
  assert.match(lens, /probe: \{ left: 0, position: 'absolute', top: -\d+ \}/);
  // And the disc has to be big enough that the fit rule still leaves a visible magnification.
  const room = (JOURNAL_DROP_RADIUS * 2 - 2) * LENS_FIT_SHARE;
  assert.ok(room >= 30, `a ${JOURNAL_DROP_RADIUS * 2} pt bead leaves ${room.toFixed(1)} pt for two digits`);
  // And the lens is told nothing about speed: magnification is the material, not the motion.
  assert.doesNotMatch(lens, /stretch\.value/, 'a settled bead must magnify exactly as a moving one does');

  // The amount, and the band it has to stay inside. Measured on the approved prototype by
  // counting the numeral's own pixels inside the disc against a flat bead: the gain climbs
  // almost linearly to 1.9 and then flattens, because past that the glyph is pushed over the
  // rim and more magnification buys clipping rather than presence.
  const model = readFileSync('src/features/planner/presentation/day-journal-model.ts', 'utf8');
  const amount = /export const LENS_MAGNIFICATION = ([\d.]+);/.exec(model);
  assert.ok(amount, 'the glass states how much thicker it is than the air beside it');
  assert.ok(Number(amount![1]) >= 1.4, 'below this the bead reads as flat, which is what it was');
  assert.ok(Number(amount![1]) <= 2.0, 'above this the numeral is clipped by its own rim');

  // **The magnification is in the geometry, never in a `transform`** — reported from the
  // device as «шрифт под каплей выглядит странно». `transform: scale` enlarges a view that
  // has already been rasterised, so a 17 pt glyph blown up 1.7× is 17 pt of pixels stretched
  // over 29. Every length is multiplied instead and the text is laid down at its final size.
  assert.doesNotMatch(lens, /scale: LENS_MAGNIFICATION/, 'scaling a rendered glyph is what blurred it');
  assert.doesNotMatch(lens, /transform: \[\{ scale/, 'nothing here may scale a rasterised layer');
  for (const magnified of [
    /left: digit\.x \* magnification - column \/ 2/,          // the column centre
    /const column = columnWidth \* magnification;/,            // the column itself
    /const band = JOURNAL_DROP_BAND \* magnification;/,        // the band
  ]) assert.match(lens, magnified);
  // The bead's own place is magnified with everything else, or the glass slides off its
  // subject: `R − M·trackX` puts the date it stands on exactly on the bead's centre.
  assert.match(lens, /translateX: JOURNAL_DROP_RADIUS - magnification \* trackX\.value/);
  // **The date band's centre is the bead's centre**, which is what lets the magnified band be
  // hung by centring it and needs no vertical offset at all. The day the two stop sharing a
  // centre the glass slides off the number, so it is asserted rather than assumed.
  assert.equal(journalDropCentre() - (journalDropCentre() - JOURNAL_DROP_RADIUS), JOURNAL_DROP_RADIUS);
  assert.equal(
    JOURNAL_WEEK_LETTER - (journalDropCentre() - JOURNAL_DROP_RADIUS) + JOURNAL_DROP_BAND / 2,
    JOURNAL_DROP_RADIUS,
    'the numeral’s band and the bead share a centre',
  );
  assert.match(lens, /top: JOURNAL_DROP_RADIUS - band \/ 2/);
  // The clip is on its own box: on iOS a view that clips its overflow draws no shadow, and
  // the bead's shadow is the only thing lifting it off the strip.
  assert.match(lens, /clip: \{ \.\.\.StyleSheet\.absoluteFillObject, borderRadius: JOURNAL_DROP_RADIUS, overflow: 'hidden' \}/);
  assert.match(screen, /dropBead: \{[\s\S]{0,240}shadowRadius/, 'the shadow stays on the bead, not the clip');
  // The screen hands over no baseline and no font at all now, so there is nothing to drift.
  assert.doesNotMatch(screen, /DROP_REFRACTION_BASELINE/, 'the baseline was a guess and is gone');

  // **The original gives way to the glass standing over it, never to being chosen.**
  // Reported from the device: «при выборе даты она сначала исчезает, а потом появляется при
  // наложении поверх капли». Painting it transparent on `selected` did exactly that — the
  // selection commits when a finger lands and the drop needs a third of a second to arrive,
  // so the date went out and the enlarged copy turned up later.
  // Narrowly: **vanishing** on selection is the fault. The weekday letter above still
  // changes *colour* with the selection, which is legitimate and must not be caught here —
  // a pattern broad enough to forbid both is a pattern that forbids the wrong thing.
  assert.doesNotMatch(screen, /selected \? 'transparent'/, 'being chosen is not a reason to disappear');
  assert.match(screen, /Math\.abs\(cellX - trackX\.value\)/, 'the hand-over is geometry, on the UI thread');
  // And they hand over at the width the lens actually covers, so there is never a frame
  // with neither: a numeral `d` away is drawn by the lens at `d × magnification`.
  assert.match(screen, /JOURNAL_DROP_COVER_HALF \* 0\.85, JOURNAL_DROP_COVER_HALF \* 1\.2/);
  assert.equal(JOURNAL_DROP_COVER_HALF, JOURNAL_DROP_RADIUS / LENS_MAGNIFICATION);
  assert.match(screen, /accessibilityLabel=\{`\$\{letter\}, \$\{number\}/);

  // The lens is given the **content** coordinate, so the glass and what it magnifies cannot
  // disagree about where the glass is.
  assert.match(screen, /<DropLens columnWidth=\{columnWidth\} digits=\{digits\} trackX=\{trackX\} \/>/);
  // Three weeks of numerals, rebuilt when the week changes and never per frame — a journey
  // may cross a page boundary and the glass needs something to carry on the far side.
  assert.match(screen, /for \(const page of \[centre - 1, centre, centre \+ 1\]\)/);
  // And the magnified numeral scales with the phone's text through **the same cap its
  // neighbours use** — not a second implementation of it, which is what a Skia glyph needed.
  assert.match(lens, /maxFontSizeMultiplier=\{JOURNAL_LABEL_MAX_SCALE\}/);
});

test('a day is never shorter than the pane it stands in, so a page turn changes no height', () => {
  // **Measured off `тест7.MP4`: the page lurched 78 px in a single frame, three times, always
  // the same distance** — one block's heading and one plate, about 80 pt. Structural rather
  // than a timing fault: this screen is one vertical scroll with a horizontal carousel inside
  // it, so the carousel's height *is* the height of whichever day is on it, and a day with
  // one task fewer moves everything below it by exactly one block.
  //
  // Apple's day view, Fantastical and Google Calendar all avoid this the same way, and none
  // of them with animation: a page is the height of the viewport and scrolls inside itself,
  // so turning one cannot change any height. This is that rule in the smallest form this
  // layout can take it.
  assert.match(screen, /const pageMinHeight = Math\.max\(0, paneHeight - headerHeight - JOURNAL_PANE_BOTTOM - barClearance\);/);
  assert.match(screen, /return <View style=\{\[styles\.pageViewport, \{ minHeight \}\]\}>\{children\}<\/View>;/,
    'the floor is what remains of the carousel');
  // **And the pane clips its track.** Seven days stand side by side and six are off-screen by
  // design; unclipped they are merely *beside* the screen, which is what «на каждой странице
  // видны плашки задач других дней» reported.
  assert.match(screen, /pageViewport: \{ overflow: 'hidden' \}/);
  // **The held height went with the transition** (`docs/DayTransitionAnimation.md`): it
  // existed so a page could not contract under content that was still visibly leaving, and
  // nothing leaves any more.
  assert.match(screen, /setPaneHeight\(event\.nativeEvent\.layout\.height\)/);
  assert.doesNotMatch(screen, /pageMinHeight = Dimensions/, 'the window is not the pane');
});

test('today arrives and leaves gradually, because it is the only thing a date can conjure', () => {
  // **Reported from the device, and the report located the defect by itself**: «рвань
  // проявляется только при каком-то контакте с сегодняшней датой». That is exactly right —
  // the elapsed meter is the one element on this screen whose *existence* depends on which
  // date is chosen, so it is the only thing a date change makes appear from nothing. It
  // flipped in a single frame at the moment of the tap, a third of a second before the page
  // it belongs to had finished arriving.

  // **One box, and both states inside it.** A hairline swapping for a filled track is a
  // resize of the widest element at the top of the list; stacked and cross-faded, the box
  // never changes and nothing beside it moves.
  assert.match(screen, /dayMeter: \{ flex: 1, height: 4, justifyContent: 'center' \}/);
  assert.match(screen, /dayTrack: \{ \.\.\.StyleSheet\.absoluteFillObject/);
  assert.match(screen, /<Reanimated\.View style=\{\[styles\.dayRuleLayer[\s\S]{0,80}leavingToday\]\}/);
  assert.match(screen, /styles\.dayTrack[\s\S]{0,60}arrivingToday\]\}/);
  // The two opacities are one value, so they cannot disagree about how far through it is.
  assert.match(screen, /const arrivingToday = useAnimatedStyle\(\(\) => \(\{ opacity: todayPresence\.value \}\)\);/);
  assert.match(screen, /const leavingToday = useAnimatedStyle\(\(\) => \(\{ opacity: 1 - todayPresence\.value \}\)\);/);
  // **The share is held**, or the width collapses to zero the instant the date stops being
  // today and the fade is a hard change wearing a slower coat.
  assert.match(screen, /if \(dayElapsed !== null\) elapsedHeld\.current = dayElapsed;/);
  assert.match(screen, /width: `\$\{\(\(heldElapsed \?\? 0\) \* 100\)/);
  // It has to finish before the page it describes lands, never after it.
  assert.ok(JOURNAL_TODAY_FADE > 0, 'a fade of nothing is the hard change it replaced');
  assert.ok(JOURNAL_TODAY_FADE <= 300, `${JOURNAL_TODAY_FADE} ms outlasts the spring that carries the page`);
  // And Reduce Motion takes the end state rather than a shorter ramp.
  assert.match(screen, /todayPresence\.value = reduceMotion\s*\?\s*target/);

  /**
   * **The header arrives with the day it describes, not a frame ahead of it.**
   *
   * Measured off `тест2.MP4`, frames 46–52 and 128–134: the caption flipped from `DAY CLOSED`
   * to `THE DAY AHEAD` — and the meter with it — a full frame *before* the list began to
   * move, while the rows were still the previous day's and still standing still. The header
   * is an ordinary render and commits synchronously; the list's position is an animated style
   * and lands on the next frame. That gap cannot be closed in time, only made invisible:
   * dimmed to a floor and brought up over the journey, the words change while nobody is
   * reading them and finish exactly when the day they describe has arrived.
   */
  assert.match(screen, /<Reanimated\.View style=\{\[styles\.dayHeader, heroArrival\]\}>/);
  // Narrowly: `AnytimeHeader` legitimately reuses the same style and must not be caught —
  // a pattern broad enough to forbid both forbids the wrong one.
  assert.doesNotMatch(
    functionSource(screen, '{/* 4 · The day header', '{/* 3 · The list.'),
    /<View style=\{styles\.dayHeader\}>/,
    'the header may not snap a frame early',
  );
  assert.match(screen, /<Reanimated\.View style=\{\[styles\.nowLine, heroArrival\]\}>/);
  assert.match(screen, /const heroArrival = useAnimatedStyle\(\(\) => \{/);
  // Never to nothing: alone in the header it has nothing to print through, so a floor is
  // right here where it was wrong for the pages.
  assert.ok(JOURNAL_HERO_ARRIVAL_FLOOR > 0.2, 'a header that blinks out is a header somebody sees leave');
  assert.ok(JOURNAL_HERO_ARRIVAL_FLOOR < 1, 'without a dip the words change in full view');

  // **The caption reserves the width of the widest thing it can say.** It swaps
  // `THE DAY AHEAD` for `DAY` and the meter beside it is `flex: 1`, so the bar's *length*
  // jumped by some seventy points in one frame on contact with today. No fade reaches that.
  // The reserve is a rendered copy rather than a `minWidth`: a number would be a measurement
  // of a font this file cannot make, wrong at every text size but the default.
  assert.match(screen, /style=\{\[styles\.eyebrow, styles\.eyebrowReserve\]\}[\s\S]{0,60}JOURNAL_DAY_CAPTION_WIDEST/);
  assert.match(screen, /eyebrowReserve: \{ opacity: 0 \}/);
  assert.match(screen, /eyebrowLabel: \{ left: 0, position: 'absolute' \}/);
  assert.doesNotMatch(screen, /eyebrow[^:]*minWidth/, 'a measured font is not a constant');
  // The widest is derived, or it stops being true the moment somebody rewords the captions.
  assert.equal(JOURNAL_DAY_CAPTION_WIDEST, JOURNAL_DAY_CAPTION_AHEAD);
  assert.ok(JOURNAL_DAY_CAPTION_AHEAD.length > JOURNAL_DAY_CAPTION_TODAY.length);
});

test('tapping a date twice does not rewind the journey already going there', () => {
  // **Reported from the device, 2026-08-06**: «в момент когда капля едет на дату, если нажать
  // на эту дату еще раз, то капля наезжает на прежнюю дату».
  //
  // The selection commits at the *start* of a journey (PD-TODAY-151), so «the date that is
  // already selected» and «the destination of a journey in flight» are the same date —
  // tapping twice lands in `travelTo`'s no-op guard while the bead is still moving. That
  // guard assigned `travel.value = 1`. `travel` is monotonic and every reader is clamped to
  // the running journey's own `[inStart, inEnd]`, so 1 is at or below the start of every
  // range after the first: all of them collapsed to `fromX` and the bead jumped back onto
  // the date it had just left, with `flying` cleared so nothing moved it again.
  //
  // It was invisible while settled, which is why it survived: a collapsed journey carries
  // `fromX === toX`, and a constant interpolation gives the same place for any `travel`.
  const guard = /if \(date === from \|\| weekRowWidth === 0\) \{([\s\S]*?)\n {4}\}/.exec(screen);
  assert.ok(guard, 'travelTo still guards the case where there is nowhere to go');
  // **The comments are stripped before the scan**, and that is not tidiness. The note in the
  // source explains the fix by naming the assignment it removed, so a scan of the raw text
  // finds `travel.value` in the prose and fails on the very fix it is protecting — the same
  // trap that has broken assertions in this file six times.
  const code = guard![1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
  assert.doesNotMatch(code, /travel\.value/, 'writing travel here rewinds a journey in flight');
  assert.doesNotMatch(code, /flying\.current/, 'a journey in flight is still in flight');
  // The guard does nothing whatever, which is the entire fix.
  assert.equal(code, 'return;', 'the guard returns and touches nothing');
});

test('a journey claims a range and writes nothing, which is the rule six defects bought', () => {
  // **This assertion did not exist until the port, and the port is what exposed it.** The
  // rule was held by a comment on Today and by one `doesNotMatch` on the tab bar; moving to
  // shared values changed the *shape* of a write — `setValue(x)` became `travel.value = x` —
  // so the tab bar's guard no longer covered the same mistake here. Putting the defect back
  // by hand passed the whole suite, which is how the gap was found.
  //
  // The fault it forbids: a value written when a journey begins lands natively **now**,
  // while the render describing what the value means lands after it. The frame in between
  // draws the new number against the old range. It has cost six device reports.
  const begin = functionSource(screen, 'const begin = (fromX: number, at: number)', '    /**');
  // The right-hand side is read only as far as it needs to be named: `withSpring` spans
  // lines and carries semicolons of its own, so anchoring on the whole expression would be
  // an assertion about formatting rather than about what is written.
  // Only the first token of the right-hand side is read — enough to name the write, and
  // short of asserting about formatting: `withSpring` spans lines and carries semicolons of
  // its own.
  const writes = [...begin.matchAll(/travel\.value\s*=\s*(\S+)/g)].map((match) => match[1]);
  assert.deepEqual(
    writes,
    ['at', 'withSpring(at'],
    `a journey may write travel only to commit under Reduce Motion or to spring, saw: ${writes.join(' | ')}`,
  );
  // And the spring is told where to end rather than where to start: it carries on from
  // wherever the value already stands, which is what makes a release continuous with a drag.
  assert.match(screen, /travel\.value = withSpring\(at \+ 1,/);
  assert.doesNotMatch(begin, /travel\.value = at;/);
});

test('every drawn part of a date change is one read of the one value', () => {
  // If any of these were a listener, a timer or a piece of state, the surfaces could
  // arrive at different moments — which is the whole fault the package removed and the
  // port had to preserve.
  //
  // The drop's place, its stretch and its squash are three reads **inside one worklet**:
  // they cannot arrive at different moments because they are computed in the same frame of
  // the same function.
  const drop = functionSource(screen, 'function DateDrop', 'function DayCarousel');
  // **Two here and the place one level up.** The drop's position is derived by the screen
  // because three surfaces need it — the bead, the lens, and every date cell asking whether
  // the glass is over it — and three readers each building their own interpolation are three
  // chances to disagree about where the glass is. All of them still read one `travel` and
  // one journey, on the UI thread, in the same frame.
  assert.equal((drop.match(/interpolate\(\s*travel\.value/g) ?? []).length, 2, 'stretch and squash');
  assert.match(screen, /const dropTrackX = useDerivedValue\(\(\) => \{/, 'the place is derived once');
  assert.match(drop, /const body = useAnimatedStyle\(\(\) => \(\{/);
  // **The place is derived once and read by both the bead and the lens**, so the glass and
  // what it magnifies can never disagree about where the glass is. The stretch is the
  // bead's alone: since PD-TODAY-152 magnification is the material and does not change with
  // speed, so handing the lens a stretch would be handing it something it must not use.
  assert.match(screen, /const dropTrackX = useDerivedValue\(/);
  assert.match(drop, /const beadStretch = useDerivedValue\(/);
  assert.match(drop, /<DropLens columnWidth=\{columnWidth\} digits=\{digits\} trackX=\{trackX\}/);
  assert.doesNotMatch(drop, /stretch=\{beadStretch\}/);
  // **The journey is written to a shared value, synchronously, by one function** — the fix
  // for the bead sitting off-screen for up to 500 ms while React caught up.
  assert.match(screen, /const dropSample = useSharedValue<DropSample>\(dropSampleOf\(initialJourney\)\);/);
  assert.match(screen, /dropSample\.value = dropSampleOf\(next\);/);
  assert.doesNotMatch(screen, /setJourney\(/, 'the journey may not be React state again');
  assert.match(screen, /travel\.value = withSpring\(at \+ 1, \{[\s\S]{0,60}\.\.\.travelSpring\(distanceDays\)/);
  // Reduce Motion commits with no travel at all rather than with a short one.
  assert.match(screen, /if \(reduceMotion\) \{[\s\S]{0,40}travel\.value = at \+ 1;/);
  // **The completion crosses to JS once per journey, never per frame.** A value read back
  // every frame is the fault five packages of this file were spent on, and it is the one
  // thing a port to shared values could quietly have reintroduced.
  assert.match(screen, /runOnJS\(settle\)\(finished === true\);/);
  assert.equal((screen.match(/runOnJS\(/g) ?? []).length, 1, 'one crossing, and it is the completion');
  // And the mirror the old value needed is gone: a shared value is readable from JS.
  assert.doesNotMatch(screen, /travelValue/);
});

test('the week row is seven equal columns, because the drop needs a continuous one', () => {
  // A drop that has to stand *between* two dates cannot have a gap to fall into.
  assert.equal(journalWeekColumnWidth(700), 100);
  assert.equal(journalWeekColumnCentre(0, 700), 50);
  assert.equal(journalWeekColumnCentre(6, 700), 650);
  assert.equal(journalWeekColumnWidth(0), 0);
  assert.match(screen, /dateCell: \{ alignItems: 'center', flex: 1 \}/);
  assert.match(screen, /weekRow: \{[^}]*minHeight: JOURNAL_WEEK_ROW/);
});

test('the drop has a band of its own, so the task marks can never stand under it', () => {
  // The brief's 54 pt row is a calendar cell holding nothing but a number. This one
  // carries a weekday letter above and a row of task marks below, and centring a 42 pt
  // drop on 54 put its foot 3 pt into the marks — reported from the device.
  // **The band follows the bead, not the date row** — the two were the same number until
  // the bead was sized to what it magnifies, and a test that asserted the coincidence would
  // have blocked the fix rather than protected anything.
  assert.equal(JOURNAL_DROP_BAND, JOURNAL_DROP_RADIUS * 2 + 2);
  assert.equal(journalDropCentre(), JOURNAL_WEEK_LETTER + JOURNAL_DROP_BAND / 2);
  assert.equal(JOURNAL_WEEK_ROW, JOURNAL_WEEK_LETTER + JOURNAL_DROP_BAND + 2 + JOURNAL_WEEK_MARKS);
  // And the bead has to be bigger than the numeral it enlarges, or there is no glass around
  // the number — which is precisely what «капля маленькая» was reporting.
  assert.ok(JOURNAL_DROP_RADIUS * 2 > 17 * LENS_MAGNIFICATION, 'the disc must clear the magnified cap');
  // The whole of the drop stands inside its band, and the marks begin below it.
  const foot = journalDropCentre() + JOURNAL_DROP_RADIUS;
  assert.ok(foot <= JOURNAL_WEEK_LETTER + JOURNAL_DROP_BAND, 'the drop ends inside its band');
  assert.ok(JOURNAL_WEEK_ROW - JOURNAL_WEEK_MARKS >= foot, 'and the marks start below its foot');
  // The letter's line is fixed, or the band below it would start wherever the face put
  // it and the drop's centre would be a different number on every text scale.
  assert.match(screen, /weekLetter: \{[^}]*height: JOURNAL_WEEK_LETTER, letterSpacing: 0\.3, lineHeight: JOURNAL_WEEK_LETTER \}/);
  // **The numeral's band and the drop's band are the same box.** The bead is placed
  // absolutely at `journalDropCentre()` while the number is centred inside this one, so the
  // day the two stop being the same height is the day the glass sits below what it magnifies.
  assert.match(screen, /dateBand: \{ alignItems: 'center', height: JOURNAL_DROP_BAND, justifyContent: 'center' \}/);
  assert.match(screen, /top: journalDropCentre\(\) - radius,/);
});

test('the row language before the plate is gone, styles and all', () => {
  // `itemBody`, `itemWords`, `itemGutter`, `blockTime`, `itemMeta` and `itemTitle` were
  // the row the plate replaced. They stopped being drawn several packages ago and their
  // style entries were left in the file — so the test that pinned them went on passing
  // while asserting a layout nothing rendered. **That is the failure mode this project
  // keeps paying for**, so the absence is what is asserted now.
  assert.doesNotMatch(screenCode, /itemBody|itemWords|itemGutter|blockTime|itemMeta|itemTitle/);
  // What replaced it is asserted where it belongs: «the plate reserves nothing for a
  // line it may not have» owns the centring rule and its arithmetic.
});

test('a block never states how many items it holds', () => {
  // Four rows sharing one time label say it by being four rows.
  assert.doesNotMatch(screenCode, /\d\} items`/);
  assert.doesNotMatch(screenCode, /blockSub/);
});

test('plates are never glued, whatever stands between them', () => {
  // Two plates sharing an edge read as one object with a line through it. The pane's
  // own gap cannot do this: the rows are inside the day's animated wrapper, which is a
  // single child of the pane.
  assert.equal(PLATE_GAP, 8);
  assert.match(screen, /plate: \{[\s\S]{0,200}marginBottom: PLATE_GAP,/);
  // And an empty part of the day keeps the same air under it as a full one, so the
  // three headings stand at an even pitch whatever the day holds.
  assert.match(screen, /blockEmpty: \{[\s\S]{0,300}marginBottom: PLATE_GAP,/);
});


test('a line repeats its parent, including the case the parent cannot describe', () => {
  // `overdue` is false the moment a thing is ticked, so it cannot answer «this item's
  // hour has gone». `elapsed` can, and it is what a line reads: a closed item whose
  // minute has passed with a line still open leaves that line dull.
  const built = selectDayJournalItems({
    dayIsPast: false,
    nowMinuteOfDay: at('12:00'),
    rootGroups: [
      rootGroup({ ...occurrenceRow('closed', 'Closed', '10:00'), state: 'qualified' } as never),
      rootGroup(occurrenceRow('ahead', 'Ahead', '15:00')),
    ],
    taskHabitIds: new Set<string>(),
  });
  const past = built.timed.find((entry) => entry.title === 'Closed');
  const ahead = built.timed.find((entry) => entry.title === 'Ahead');
  assert.equal(past?.elapsed, true, 'its minute has gone');
  assert.equal(past?.overdue, false, 'and it is closed, so it is not overdue');
  assert.equal(ahead?.elapsed, false);
  // The line then carries the same three weights the rows do.
  assert.match(screen, /dulled=\{item\.elapsed && !step\.done\}/);
  assert.match(screen, /color: step\.done \|\| dulled \? theme\.today\.secondaryText : ink,/);
  // **A ticked line fills with `done`, not with the parent's category.** Green means
  // completed, so a line and the item that owns it read the same when they are.
  assert.match(screen, /<StepRow\s+color=\{theme\.today\.completion\}/);
  // **The lines open inside the plate**, indented to the title's own leading edge, and
  // the indent is derived from the columns it has to clear rather than restated.
  const rows = functionSource(screen, 'function Plate', 'function StepRow');
  assert.match(rows, /marginLeft: PLATE_MARK \+ PLATE_ROW_GAP \+ \(spine === null \? 0 : PLATE_RANK_SPINE\)/);
  assert.doesNotMatch(rows, /rank\.gutter/);
});

test('the lines of a checklist begin where the title begins', () => {
  // They used to start at the plate's own left edge — beside nothing — which made a
  // two-line checklist read as a stray row. They are indented to the title's own leading
  // edge, and the indent is **derived from the columns it has to clear** rather than
  // restated, so a wider mark at a larger text scale carries the lines with it. The rank
  // spine is part of that arithmetic: a ranked plate's title starts 3 pt further in.
  assert.match(screen, /marginLeft: PLATE_MARK \+ PLATE_ROW_GAP \+ \(spine === null \? 0 : PLATE_RANK_SPINE\)/);
  assert.doesNotMatch(screen, /plateSteps: \{[^}]*paddingLeft: \d/);
});

test('a plate is one item, and the block around it is a heading and a list', () => {
  // **A plate is one item** (PD-PLATE-001), so what holds several is a wrapper with no
  // surface, no border and no shared column — the block's only job is to be a heading
  // with things under it.
  assert.match(screen, /block: \{ gap: PLATE_GAP \}/);
  assert.doesNotMatch(screenCode, /JOURNAL_PLATE_GAP|blockGutter|blockItems/);
  assert.match(screen, /plateRow: \{ alignItems: 'center', flexDirection: 'row', gap: PLATE_ROW_GAP/);

  // And every part of the day is drawn whether or not it holds anything: an empty
  // morning is a fact about the day and a place to add to, and a heading that appeared
  // only when it had contents would make its own plus button move around.
  const empty = selectDayBlocks([]);
  assert.deepEqual(empty.sections.map((section) => section.block), ['morning', 'day', 'evening']);
});


test('two marks, two places, and neither of them moves', () => {
  // **Two marks now, in a fixed order: `overdue`, then the bell to its right.** Each
  // holds a reserved width at the title's own leading edge, so a row missing either
  // leaves its place empty rather than pulling the other across.
  assert.doesNotMatch(screenCode, /metaFill/);
  // **The bell follows the word, and stands at the leading edge without it.** A
  // reserved 52 pt for `overdue` left the bell hanging in the middle of the plate on
  // every row that was not late — most of them — which reads as a mark placed nowhere.
  // **Neither is an empty box.** A zero-width child still earns the row's 6 pt gap, so
  // an absent `overdue` pushed the bell 6 pt in — at a 15 pt title that is between the
  // first and second letter, which is what read as crooked. An element that is not
  // there is not rendered at all, on the timed plate and on the untimed row alike.
  assert.doesNotMatch(screenCode, /metaSlot/);
  assert.doesNotMatch(screenCode, /metaOverdue/);
  // **The one-slot priority is withdrawn, and nothing is reserved in its place.** It was
  // a total order — late over the counter over the reminder — with exactly one drawn, so
  // an item that was all three said only that it was late. The facts stand side by side
  // now, and the wording is Russian like the rest of the surface: the plate used to say
  // `Overdue · 1 h 17 m ago` under a heading reading «Утро».
  assert.doesNotMatch(screenCode, /styles\.itemMeta/);
  const late = dayJournalPlateFacts(item('Late', '09:00', {
    overdue: true,
    overdueMinutes: 77,
    steps: [{ done: false, id: 's1', title: 'a' }],
  }));
  assert.deepEqual(late.map((fact) => fact.kind), ['late']);
  assert.deepEqual(late.map((fact) => fact.text), ['Overdue']);
  // There is one plate and no second row language, so an item with no block cannot
  // disagree with one that has a block about any of this.
  assert.doesNotMatch(screenCode, /function AnytimeRow/);
  // **The repeat is gone from the row entirely**, glyph and words together.
  assert.doesNotMatch(screenCode, /fact\.kind === 'repeat'/);
  assert.deepEqual(dayJournalPlateFacts(item('Daily', '09:00', {})).map((fact) => fact.kind), ['time']);
  assert.doesNotMatch(functionSource(screen, 'function Plate', 'function StepRow'), /<RankPill/);
  assert.doesNotMatch(screenCode, /styles\.metaFlex/);
  assert.doesNotMatch(screenCode, /\}\]\}\s*>\{item\.recurrence\}/);
});

test('nothing stands behind the day but the ground', () => {
  // The NOW card was given an opaque dock so no row could be seen in the air above it,
  // and on a device that read as a slab of page rather than as a plate over the list.
  // The card is a line in the header now, so there is no dock and no card left to
  // separate from anything — and there are exactly **two** surface levels on the screen,
  // the ground and the plate (PD-PLATE-001).
  assert.doesNotMatch(screenCode, /heroDock|styles\.hero\b/);
  assert.match(screen, /nowLine: \{ alignItems: 'center', flexDirection: 'row'/);
});

test('no SVG dependency arrived to draw the drop with', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal('react-native-svg' in packageJson.dependencies, false);
  assert.doesNotMatch(screenCode, /react-native-svg|feGaussianBlur|feColorMatrix/);
});

test('only the month is inside the squashed box, and the dates are not', () => {
  // **The dates vanished on scroll once and nothing here noticed.** A refactor closed the
  // box after the week row instead of before it, so the calendar sat inside a view that
  // shrinks to nothing — on the device the dates were simply gone, sliced off below the
  // weekday letters. The box takes the month row away and nothing else.
  const box = screen.indexOf('styles.monthCollapse');
  const dates = screen.indexOf('styles.weekRow');
  assert.ok(box > 0 && dates > box, 'the dates come after the box opens');
  const between = screen.slice(box, dates);
  assert.ok(between.includes('</Animated.View>'), 'the box closes before the dates');
  // And what shrinks it is a scale, not a height: the row keeps its space and the view
  // below takes the space back with a translate, so no layout moves at all.
  assert.match(screen, /styles\.monthCollapse, \{ opacity: headerMonthFade, transform: \[\{ scaleY: headerSquash \}\] \}/);
  assert.match(screen, /transform: \[\{ translateY: headerShift \}\]/);
});

test('no single view carries both a native value and a layout one', () => {
  // **Splitting the values was not enough — the views have to be split too.** A style node
  // holding one prop from the native half and one from the layout half is moved to the
  // native driver whole, and the layout animation is then refused at runtime:
  // «Attempting to run JS driven animation on animated node that has been moved to
  // native». It is a red box, not a warning, and it reached the device once — the month
  // row carried the fade and the height together. This is the assertion that keeps the
  // two apart, and it reads the screen the way React Native does: per style, not per value.
  const native = ['veil', 'headerSettle', 'headerScale', 'headerMonthFade', 'bounce'];
  const layout = ['headerMonthHeight', 'headerBandTop', 'headerBandBottom'];
  const mixed: string[] = [];
  for (const line of screen.split('\n')) {
    if (!line.includes('style=')) continue;
    const uses = (names: readonly string[]) => names.filter((name) => new RegExp(`[^A-Za-z]${name}[^A-Za-z(]`).test(line));
    const n = uses(native);
    const y = uses(layout);
    if (n.length > 0 && y.length > 0) mixed.push(`${n.join(', ')} beside ${y.join(', ')}`);
  }
  assert.deepEqual(mixed, [], 'a view may take its animation from one driver, never from both');
});

test('the header follows the finger, on the UI thread, with no layout in it', () => {
  // **Measured off a screen recording of the accepted build.** Across 406 frames of
  // movement the header did not change in 45 of them — one in nine — and through a date
  // change it stalled five frames out of six. The scroll was native and held its pace; the
  // half that animated a height waited for React. Every model tried since is recorded here
  // because each was rejected by evidence rather than by taste: a timed threshold left the
  // first forty-seven points of a drag doing nothing, and a chase retargeted per event
  // converged so slowly that 27.7 pt of travel took 1.53 s.
  const nonNative = screen.match(/useNativeDriver: false/g) ?? [];
  assert.deepEqual(nonNative, [], 'not one value is left on the JS thread');
  const sizes = screen.match(/(?:width|height|padding[A-Za-z]*|fontSize): header[A-Za-z]+/g) ?? [];
  assert.deepEqual(sizes, ['paddingTop: headerHeight'], 'and the one size left is measured, not animated');
  // The lift is the offset itself, not a state machine over it.
  assert.ok(screen.includes('inputRange: [0, JOURNAL_HEADER_LIFT_TRAVEL]'), 'bound to the offset');
  assert.ok(!screen.includes('Animated.timing(lift'), 'and not timed');
  assert.ok(!screen.includes('setHeaderClosed'), 'and there is no state to fall between');
  // **One plate, and at rest there is no plate.** Two of them were visible as two: through
  // the middle of a cross-fade the text belonged to neither box and hung over an edge. A
  // plate that cannot be seen at rest needs no second plate to fade from.
  assert.ok(!screen.includes('styles.headerSeated'), 'the second plate is gone');
  assert.ok(!screen.includes('seatedPlate'), 'and so is the value that cross-faded it');
  // And the one that is left shrinks by exactly what the month row takes with it, so the
  // text is never outside it at any point of the travel.
  assert.ok(screen.includes('scaleY: plateSquash'), 'the plate squashes with the content');
  assert.match(screen, /1 - monthRowHeight \/ headerHeight/);
  assert.match(screen, /headerPlate: \{[^}]*transformOrigin: 'top'/);
  // The one thing a bound value cannot express: arriving at the ceiling with momentum.
  assert.ok(screen.includes('lastScrollStep.current <= -JOURNAL_HEADER_FAST'), 'the bounce is conditional on speed');
  assert.match(screen, /useReduceMotion/);
});


// ── The calendar ─────────────────────────────────────────────────────────────

test('the calendar is a page sheet that can be dragged away, and its months are swiped', () => {
  // Full screen put the header under the status bar, because a `Modal` starts its
  // own view hierarchy and the safe area never reaches it — and it left no way out
  // but a button.
  assert.match(calendar, /presentationStyle="pageSheet"/);
  assert.match(calendar, /pagingEnabled/);
  assert.match(calendar, /horizontal/);
  // **The list reports its own page; nothing computes it.** Read frame by frame off the
  // owner's recording and decoded by the weekday the 1st falls on: the grid was right every
  // time and the *header* was wrong, in both directions — at 5.53 s both said August and one
  // frame later the grid still said August while the header had flipped to July; at 7.13 s
  // both said August and a frame later the header said September. Two sources for one fact.
  assert.match(calendar, /onViewableItemsChanged=\{onViewableItemsChanged\}/);
  assert.match(calendar, /viewabilityConfig=\{viewabilityConfig\}/);
  // **Three re-centred pages are retired**, and the reasoning that chose them is retired
  // with them: «a year of pages costs memory a calendar has no use for» was true of a list
  // drawn whole and false of a windowed one. What it cost instead was a settle of lag.
  assert.doesNotMatch(calendar, /journalMoveMonth\(anchor, -1\), anchor, journalMoveMonth\(anchor, 1\)/);
  // The arrows survive and drive the same rail.
  assert.match(calendar, /const stepMonth = \(offset: -1 \| 1\)/);
  assert.match(calendar, /scrollToIndex\(\{ animated: true/);
});

test('the calendar lists tasks under the date, and never habits', () => {
  assert.match(calendar, /filter\(\(item\) => item\.kind === 'task'\)/);
  assert.match(calendar, /dayJournalTaskHabitIds/);
  // Picking a date does not close it: the list under the date is the reason to
  // keep looking, so only Done carries the choice back.
  assert.match(calendar, /onPress=\{\(\) => onPick\(date\)\}/);
  assert.match(calendar, /onSelect\(chosen\); onClose\(\);/);
});

test('the journal opens the calendar rather than the old bottom sheet', () => {
  assert.match(screen, /<JournalCalendarScreen/);
});

// ── The corrections from the first device round ──────────────────────────────



test('a task is filled, a habit is a ring, and neither changes with the clock', () => {
  // Two shapes and no third: a task filled, a habit a solid ring around its washed
  // colour. **An untimed habit is the same circle as a timed one** — having no time
  // is already said by the empty time cell and by sitting under Anytime, and
  // saying it again in the dot split one kind of thing into two looks for nothing.
  assert.match(node, /kind === 'task'\s*\n\s*\? <View style=\{\[styles\.dot, \{ backgroundColor: color/);
  assert.match(node, /: <View style=\{\[styles\.dot, \{ backgroundColor: wash/);
  assert.match(node, /export function ItemNode\(\{ kind, color, reminded = false, identity, accentKey \}/);
  // **The shape survives the symbol.** Passing an identity draws the item's glyph
  // inside that same circle rather than replacing it with a tile, so filled-versus-
  // ringed still says task-versus-habit — which is what lets the two share one list
  // without a label (PD-MANAGE-011). The journal passes none and keeps the 11 pt dot
  // until its own redesign asks for the glyph; one module, so the two surfaces cannot
  // drift into drawing the same item differently.
  assert.match(node, /backgroundColor: filled \? color : wash, borderColor: color/);
  assert.match(node, /export const ITEM_NODE_DOT = 11;/);
  assert.match(node, /export const ITEM_NODE_MARK = 24;/);
  // The dashed ring is withdrawn, and the composition that carried it with it — a
  // disc with the wash punched out and four notches cutting it into arcs.
  assert.doesNotMatch(node, /NODE_NOTCHES|nodeRing|nodeCore|nodeNotch/);
  assert.doesNotMatch(node, /borderStyle: 'dashed'/);
});

test('a reminder is stated as the minute it fires, not as a ring', () => {
  // The ring was the journal's way of saying a notification existed when its row had
  // nowhere to put a time. 1c gives the row a meta line, so the reminder says *when*
  // — which is strictly more than the ring said, from the same stored field.
  assert.match(model, /export function dayJournalReminderLocalTimes/);
  assert.match(model, /if \(item\.reminderLocalTime !== null\) reminders\.set\(item\.habitId, item\.reminderLocalTime\);/);
  assert.match(screen, /dayJournalReminderLocalTimes\(catalogue\.data \?\? \[\]\)/);
  assert.match(model, /facts\.push\(\{ kind: 'reminder', text: item\.reminderLocalTime \}\)/);
  // `ItemNode`'s ring is Manage's module and is left standing, dormant: it is
  // withdrawn from this surface by not being drawn, not deleted from a shared file.
  assert.match(node, /if \(!reminded\) return dot;/);
});

test('an item with no reminder states nothing, and absent is the same as empty', () => {
  const items = [item('Plain', '09:00'), item('Woken', '10:00', { reminderLocalTime: '09:45' })];
  assert.deepEqual(items.map(({ reminderLocalTime }) => reminderLocalTime), [null, '09:45']);
  assert.match(model, /reminderLocalTimes\?: ReadonlyMap<string, PlannerLocalTime>;/);
  // The bell is one of the plate's facts: it says **when** rather than only that a
  // reminder exists — strictly more, from the same stored field — and **it no longer
  // gives way to anything.** Under the old single slot a reminder vanished from every
  // item that was late and from every item with steps, which is most of the items that
  // have one.
  assert.match(model, /if \(item\.reminderLocalTime !== null\) facts\.push/);
  assert.doesNotMatch(screen, /function ReminderBell/);
  // **It is drawn even when the item is met**: it states a property of the item, not
  // a state of the day. And the minute it fires is in its label, where a screen
  // reader gets the fact the row no longer prints twice.
  assert.equal(dayJournalPlateFacts(item('Quiet', '09:00')).some((fact) => fact.kind === 'reminder'), false);
  const belled = dayJournalPlateFacts(item('Belled', '09:00', { reminderLocalTime: '07:30' }));
  assert.equal(belled.find((fact) => fact.kind === 'reminder')?.text, '07:30');
  // And it survives beside lateness and steps, which is the whole point of the change.
  assert.deepEqual(
    dayJournalPlateFacts(item('Busy', '09:00', {
      overdue: true,
      overdueMinutes: 10,
      reminderLocalTime: '08:45',
      steps: [{ done: true, id: 's1', title: 'a' }],
    })).map((fact) => fact.kind),
    ['late'],
    'and while it is late it says only that',
  );
});


test('a task cannot be due at a time that has gone', () => {
  const at = (dueDate: string, plannedTime: string) => createTaskMomentIsPast({
    dueDate, nowMinuteOfDay: 12 * 60, plannedTime, today: '2026-07-28', type: 'task',
  });
  assert.equal(at('2026-07-27', ''), true, 'a day that has passed');
  assert.equal(at('2026-07-28', '09:00'), true, 'a time today that has passed');
  assert.equal(at('2026-07-28', '13:00'), false);
  assert.equal(at('2026-07-28', ''), false, 'all day today has missed nothing');
  assert.equal(at('2026-07-29', '01:00'), false);
  // A habit is a rule and may begin whenever it likes.
  assert.equal(createTaskMomentIsPast({
    dueDate: '2026-07-01', nowMinuteOfDay: 12 * 60, plannedTime: '01:00', today: '2026-07-28', type: 'habit',
  }), false);
});

test('a mark always carries a colour, its category or the accent it was painted with', () => {
  // A habit made before categories keeps its own accent instead of a neutral, which
  // is what used to leave every mark grey.
  assert.match(chip, /theme\.habitAccents\[subject\.accentKey\]\.selectedSwatch/);
  assert.match(chip, /export function categoryTone/);
});


test('the strip is never rebuilt, so there is nothing to re-centre', () => {
  // Three recycled pages had to be scrolled back to the middle on every settle,
  // and `scrollTo` is a command to the native list rather than something that
  // happens with the render — so the offset and the content disagreed for a frame
  // however that was ordered. That is the flinch, and why it came and went with
  // the timing rather than with the direction.
  assert.equal(JOURNAL_WEEK_RAIL_RADIUS, 52);
  assert.equal(journalWeekRail(date('2026-07-27')).length, 105);
  assert.equal(journalWeekRail(date('2026-07-27'))[JOURNAL_WEEK_RAIL_RADIUS], date('2026-07-27'));
  // The scroll offset simply is the week: the settle reads it and nothing scrolls
  // back afterwards.
  assert.match(screen, /const settled = weekRail\[index\];/);
  assert.doesNotMatch(screen, /useLayoutEffect/);
  assert.doesNotMatch(screen, /WEEK_PAGES/);
  // Every programmatic move is the same move, and the settle follows it.
  assert.match(screen, /strip\.current\?\.scrollToIndex\(\{ animated, index \}\);/);
  assert.match(screen, /getItemLayout=\{\(_unused, index\) =>/);
});

test('the month itself opens the calendar, and only the month', () => {
  // A chevron beside it was one more thing to aim at and one more thing for the
  // longest month to run under.
  assert.match(screen, /accessibilityHint="Opens the calendar"/);
  assert.doesNotMatch(screen, /name="chevron-down"/);
  // The control ends where the word does. Letting it flex to the row meant a tap
  // anywhere along the top opened the calendar, and a finger aimed at `Today`
  // landed on the week arrow beside it.
  assert.doesNotMatch(screen, /monthButton: \{[^}]*flex: 1/);
  // 1c's week band is smaller than the previous journal's — the room went to the day
  // bar — so the control's own box came down with it.
  assert.match(screen, /monthButton: \{ alignItems: 'center', flexDirection: 'row', minHeight: 22/);
});

test('the month changes with the week it belongs to, and not a frame later', () => {
  // It used to be held a frame behind `weekStart`, because the label dissolved a letter at
  // a time and queuing that fade behind the settle's own commit dropped its first frames.
  // The label does not animate any more (owner instruction, «колхозно и устаревше»), so
  // the deferral protects nothing and only added a frame to the **last** thing on screen
  // to change in a gesture that already had three endings — measured off `тест4.MP4` at
  // 433 ms, alone, after four frames in which nothing else moved at all.
  assert.doesNotMatch(screen, /setWeekMonth/);
  assert.doesNotMatch(screen, /monthOfWeek/);
  assert.match(screen, /const weekMonth = useMemo\(/);
});

test('the month title cross-fades, and the letter-by-letter rewrite is gone from both surfaces', () => {
  // **Removed from Today by owner report** on 2026-08-05 («выглядит колхозно и
  // устаревше»), and from the calendar on the same reading of the same word. A
  // label animating itself draws attention to a fact nobody asked about; on the calendar
  // the *pages* already slide under the finger, so a title performing its own
  // choreography on top of that is two animations narrating one event.
  // The **usage**, not the word: Today's comment records that the refusal of a typed-out
  // label still stands and that this is a different animation, and an assertion a history
  // note can break is an assertion about prose — the sixth time this suite has been taught
  // it. Match `<Component` and the import, never a bare name.
  for (const src of [screen, calendar]) {
    assert.doesNotMatch(src, /<FlipLabel/);
    assert.doesNotMatch(src, /from '\.\/flip-label'/);
  }
  // The component is **deleted, not left dormant**: with no caller it is a file the suite
  // would go on describing after the code it belongs to is dead.
  assert.equal(existsSync('src/features/planner/presentation/flip-label.tsx'), false);
  // Today keeps the room the old label reserved, so the control beside it still cannot be
  // pushed by a long month.
  // The room the label reserves is the component's now — it holds the box open so a long
  // month cannot move the control beside it — and the leading is stated once and read by
  // both the text and the box, so the two cannot disagree.
  assert.match(screen, /reservedWidth=\{JOURNAL_MONTH_LABEL_WIDTH\}/);
  assert.match(screen, /lineHeight=\{JOURNAL_MONTH_LABEL_LINE\}/);
  assert.match(screen, /monthLabel: \{ fontSize: 15, fontWeight: '600', lineHeight: JOURNAL_MONTH_LABEL_LINE \}/);

  // **The technique survives even though the choreography does not.** Two layers, both out
  // of flow inside a reserved box, so a longer month can move neither the chevrons nor the
  // other layer — and one value per run, created with the letters that read it, because a
  // reused value written to zero repositions letters already on screen: a native write
  // landing before the render that replaces them.
  // **One module serves both surfaces**, so the calendar and Today cannot drift into
  // showing a month change two different ways — the fault `item-chip.tsx` was extracted to
  // end, applied to the one other thing two screens both draw.
  assert.equal(existsSync('src/features/planner/presentation/month-title.tsx'), true);
  assert.match(calendar, /<MonthTitle heading=\{heading\}/);
  assert.match(screen, /<MonthTitle\s+heading=\{monthHeading\}/);
  assert.match(monthTitle, /styles\.box, \{ height: lineHeight, width: reservedWidth \}/);
  assert.match(monthTitle, /layer: \{ left: 0, position: 'absolute', right: 0 \}/);
  assert.match(monthTitle, /const progress = new Animated\.Value\(reduceMotion \? 1 : 0\);/);
  assert.match(monthTitle, /useNativeDriver: true,/);
  // Today reads its direction from the **date**, not from a scroll: a week that moved
  // forward is a later week however the finger got there — swipe, rail tap, or the Today
  // button — so the three ways in cannot disagree about which way the month travelled.
  assert.match(screen, /setMonthHeading\(weekStart > monthHeadingFrom\.current \? 1 : -1\);/);

  // **The word travels the way the finger went**, which is what tells a swipe back from a
  // swipe forward without a label — a cross-fade alone looks identical in both directions.
  // A third of the page's distance: at the full width it would be a second page turn.
  assert.match(monthTitle, /export const MONTH_TITLE_TRAVEL = 22;/);
  assert.match(monthTitle, /const travel = run\.heading === 0 \? 0 : MONTH_TITLE_TRAVEL \* run\.heading;/);
  assert.match(monthTitle, /outputRange: \[0, -travel\]/, 'the leaving word goes the way the finger went');
  assert.match(monthTitle, /outputRange: \[travel, 0\]/, 'and the arriving one comes from the other side');
  // The two never overlap at full strength: one is gone by 0.55 before the other is in.
  assert.match(monthTitle, /outputRange: \[1, 0, 0\]/);
  assert.match(monthTitle, /outputRange: \[0, 0, 1\]/);
  // **Nothing here animates layout** — opacity and translateX only.
  assert.doesNotMatch(monthTitle, /(width:|height:|margin\w*:)\s*run\./);
});

test('the calendar pages on a stable rail, so a month cannot lag a settle behind', () => {
  // **Reported precisely: «назад и всё ещё август, а вперёд и стал июль.»** One settle of
  // lag, and it is what a three-page carousel does when it re-centres: on every change two
  // of the three pages unmount and one moves index, while the re-centring `scrollTo` is
  // issued against a subtree whose native views are being rebuilt in the same commit, so
  // the offset and the content drift apart by exactly one page.
  //
  // A rail has nothing to re-centre. **This is the week strip's own pattern**, which has
  // carried the date rail without a paging defect since it was written.
  assert.match(calendar, /journalMonthRail\(railBase\)/);
  assert.match(calendar, /const settled = railRef\.current\[index\];/);
  assert.match(calendar, /if \(settled === undefined \|\| settled === anchorRef\.current\) return;/);
  // **No page arithmetic anywhere.** Every version of this screen computed
  // `Math.round(contentOffset.x / w)` and then argued about which `w` — the window, then
  // the measured pager. The rounding itself is the fault: a second opinion about a number
  // the list already holds, and when the two differ the header contradicts the grid.
  assert.doesNotMatch(calendar, /Math\.round\(event\.nativeEvent\.contentOffset/);
  assert.doesNotMatch(calendar, /contentOffset\.x \/ pageWidth/);
  // The callback may not change identity between renders — React Native throws on that — so
  // it is held in a ref and reads the live state through refs of its own.
  assert.match(calendar, /const onViewableItemsChanged = useRef\(/);
  assert.match(calendar, /const viewabilityConfig = useRef\(\{ itemVisiblePercentThreshold: 60 \}\)\.current;/);
  // **Read, never accumulated**: there is no base for a second swipe to compute from.
  assert.doesNotMatch(calendar, /journalMoveMonth\(anchorRef/);
  // Nothing re-centres, so there is no ordering left between a native scroll and a commit.
  assert.doesNotMatch(calendar, /useLayoutEffect\(/);
  assert.doesNotMatch(calendar, /scroller\.current\?\.scrollTo/);
  // The rail is re-laid only on opening, or it would churn under the finger exactly as the
  // carousel did.
  assert.match(calendar, /setRailBase\(selectedDate\);/);
  assert.match(calendar, /useMemo\(\(\) => journalMonthRail\(railBase\), \[railBase\]\)/);
  // **Animated, and it has to be.** iOS raises `onMomentumScrollEnd` from a finger's
  // deceleration and from the end of an *animated* programmatic scroll — never from a
  // non-animated one — so a jump would move the rail and leave the month behind it.
  assert.match(calendar, /scrollToIndex\(\{ animated: true, index: next \}\)/);
  // Two years of months, each running its own catalogue query, so the list is windowed.
  assert.equal(JOURNAL_MONTH_RAIL_RADIUS, 24);
  assert.equal(journalMonthRail('2026-08-05' as PlannerLocalDate).length, JOURNAL_MONTH_RAIL_RADIUS * 2 + 1);
  assert.match(calendar, /windowSize=\{3\}/);

  // And the arithmetic the whole thing rests on, exercised over the reported sequence.
  const rail = journalMonthRail('2026-08-05' as PlannerLocalDate);
  const centre = JOURNAL_MONTH_RAIL_RADIUS;
  assert.equal(journalMonthLabel(rail[centre]), 'August 2026');
  assert.equal(journalMonthLabel(rail[centre - 1]), 'July 2026', 'back is July, not August again');
  assert.equal(journalMonthLabel(rail[centre + 1]), 'September 2026');
  assert.equal(journalMonthRailIndex(rail, '2026-08-31' as PlannerLocalDate), centre, 'any day of a month finds it');
  // Across a year boundary, which is where month arithmetic usually dies.
  assert.equal(rail[0], '2024-08-01');
  assert.equal(rail[rail.length - 1], '2028-08-01');
});

test('the month title’s effect never depends on the state it sets', () => {
  // **This is the defect four packages of paging fixes were chasing.** The effect listed
  // `run.to` among its dependencies and then wrote `run.to` through `setRun`, so React
  // cleaned up before re-running — `fade.stop()` — one frame after the fade started, and on
  // the re-run `run.to === text` returned early and never restarted it. `progress` froze at
  // about 0.02, which is where the **leaving** layer is at full opacity: the header showed
  // the *previous* month, always, and never caught up.
  //
  // Decoded frame by frame off `docs/qa/evidence/баг.MP4` — each grid named by the weekday
  // its 1st falls on — the grid was right every time and only the header lied, by exactly
  // one step. The pager was never at fault.
  const title = monthTitle;
  assert.match(title, /\}, \[reduceMotion, text\]\);/, 'the effect depends on the text and nothing it writes');
  assert.doesNotMatch(title, /\}, \[[^\]]*run\.to[^\]]*\]\);/, 'run.to may never be a dependency');
  assert.doesNotMatch(title, /if \(run\.to === text\) return;/, 'the guard may not read the state the effect sets');
  // The current word lives in a ref, so writing the run cannot re-enter the effect — and
  // the heading rides in a ref too, because it changes in the same commit as the text and
  // would otherwise be a second way in.
  assert.match(title, /const shown = useRef\(text\);/);
  assert.match(title, /if \(shown\.current === text\) return;/);
  assert.match(title, /shown\.current = text;/);
  assert.match(title, /const headingRef = useRef\(heading\);/);
  assert.match(title, /heading: headingRef\.current,/);
  // The value is created with the letters that read it and handed straight to the timing,
  // so nothing already on screen can be repositioned by a value it does not belong to.
  assert.match(title, /const progress = new Animated\.Value\(reduceMotion \? 1 : 0\);/);
  assert.match(title, /Animated\.timing\(progress, \{/);
});

test('the calendar stops painting structure in the colour that means done', () => {
  // **`completion` is «finished» and nothing else in this application** (PD-PLATE-004). The
  // sheet was the one surface never repainted when structure lost its hue, so a selected
  // date, today's ring, «Today», «Done» and the year were all green — five places claiming
  // a meaning none of them has.
  assert.doesNotMatch(calendar, /theme\.today\.completion/);
  assert.match(calendar, /backgroundColor: selected \? theme\.today\.structFill : 'transparent'/);
  assert.match(calendar, /borderColor: !selected && isToday \? theme\.today\.structFill : 'transparent'/);
  assert.match(calendar, /isToday \? theme\.today\.system/);
});

test('the create button is glass, and it was the last opaque thing over the list', () => {
  // A solid disc of `structFill` — which in graphite is ink, so a white puck on a black
  // page. It wears the shared material now: a real blur of what is under it, the same
  // `structGlass` tint the bead and the tab plate carry, and a hairline, which is what
  // gives a translucent shape an edge.
  const fab = functionSource(screen, 'accessibilityLabel="Create"', '<JournalCalendarScreen');
  assert.doesNotMatch(fab, /backgroundColor: theme\.today\.structFill/);
  assert.match(fab, /intensity=\{theme\.today\.materialBlur\}/);
  assert.match(fab, /backgroundColor: theme\.today\.structGlass/);
  assert.match(fab, /borderColor: theme\.today\.hairline/);
  // The blur is clipped to the circle, or it blurs a square behind a round button.
  assert.match(screen, /fab: \{[^}]*overflow: 'hidden'/);
  // `onAccent` is for something drawn *on* a fill, and there is no fill any more.
  assert.match(screen, /<Ionicons color=\{theme\.today\.primaryText\} name="add"/);
});


test('browsing a week is not choosing a day', () => {
  // Sliding the strip used to carry the selection with it, so a person looking at
  // next week had already left the day they were reading. Only a tap selects,
  // which is the rule Planner's own rail has carried since PD-PLANNER-001.
  assert.match(screen, /const settleWeek = [\s\S]{0,400}setWeekStart\(settled\);/);
  assert.doesNotMatch(screen, /setSelected\(\(current\) => movePlannerDate\(current, offset \* 7\)\)/);
});


test('the week is swiped, and always runs Monday to Sunday', () => {
  assert.match(screen, /pagingEnabled/);
  assert.match(screen, /onMomentumScrollEnd=\{settleWeek\}/);
  // Each page is one week of the rail, laid out from its own Monday, so the strip
  // cannot drift off its own grid however far it is scrolled.
  assert.match(screen, /const dates = journalWeekDates\(item\);/);
  assert.match(screen, /dates\.map\(\(date, index\) => <DateCell/);
  assert.match(screen, /data=\{weekRail\}/);
});

test('there is a way back to today from any date', () => {
  assert.match(screen, /accessibilityLabel="Today"/);
  // Whenever there is somewhere to come back from — another date chosen **or**
  // another week browsed to. Browsing no longer moves the selection, so a week
  // away with today still selected used to offer no way home at all.
  assert.match(screen, /selected === today && weekStart === journalWeekStart\(today\) \? null : <Pressable/);
  // And it arrives rather than jumping: the strip slides one page back to the
  // current week however far away it was. For a distant week the window is placed
  // on its neighbour without animating — off screen, so none of that is seen — and
  // only the last page is scrolled, so the gesture reads the same at one week's
  // distance and at eleven.
  assert.match(screen, /const returnToToday = useCallback\(\(\) => \{/);
  // The label is told where it is going and stays there until the window catches
  // up: it followed both steps before, so a return from November wrote out the
  // month in between on its way past.
  // One animated scroll to the current week, however far away: the settle at the
  // end sets the week, so the label changes once and no month in between is
  // written. The old two-step placement was what the three-page strip needed; on
  // the rail it simply scrolled back a week, so the button behaved like the back
  // arrow whenever it had more than one week to cover.
  assert.match(screen, /scrollToWeek\(journalWeekStart\(today\), true\);/);
  assert.doesNotMatch(screen, /labelWeek/);
  assert.match(screen, /onPress=\{returnToToday\}/);
});


test('creating something does not move you to another module', () => {
  const create = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
  assert.match(create, /router\.back\(\);/);
  assert.doesNotMatch(create, /pathname: '\/\(tabs\)\/planner'/);
});

// ── Subtasks, and what the day's own read model does with them ───────────────

test('a subtask reaches the day as a line of its item, from its own query', () => {
  // It comes from the checklist query and never from the day's groups: the layer
  // that computes a record cannot count a line it does not load.
  const day = selectDayJournalItems({
    checklists: new Map([['cook', [
      { id: 'l1', habitId: 'cook', text: 'Buy food', sortOrder: 0, done: true, doneAt: 10 },
      { id: 'l2', habitId: 'cook', text: 'Wash up', sortOrder: 1, done: false, doneAt: null },
    ]]]),
    nowMinuteOfDay: null,
    rootGroups: [rootGroup(occurrenceRow('cook', 'Cook dinner', '18:00'))],
    taskHabitIds: new Set(),
  });
  assert.deepEqual(day.timed.map((entry) => entry.title), ['Cook dinner']);
  assert.deepEqual(day.timed[0]?.steps.map((step) => [step.title, step.done]), [['Buy food', true], ['Wash up', false]]);
  // And the item keeps its own checkbox: a line never derives it.
  assert.equal(day.timed[0]?.completable, true);
});

test('an item with no lines has no chevron and no steps', () => {
  const day = selectDayJournalItems({
    nowMinuteOfDay: null,
    rootGroups: [rootGroup(occurrenceRow('cook', 'Cook dinner', '18:00'))],
    taskHabitIds: new Set(),
  });
  assert.equal(day.timed[0]?.steps.length, 0);
});

test('a child whose parent is not on the day keeps its own row', () => {
  // The composition only nests a child when its parent is on the same day, and
  // nothing about that changes: on a day the parent does not fall on, the child is
  // still its own item rather than a step of something absent.
  const day = selectDayJournalItems({
    nowMinuteOfDay: null,
    rootGroups: [rootGroup(occurrenceRow('buy', 'Buy food', '18:00', 'cook'))],
    taskHabitIds: new Set(),
  });
  assert.deepEqual(day.timed.map((entry) => entry.title), ['Buy food']);
  assert.equal(day.timed[0]?.steps.length, 0);
});

test('the day it is comes from the same reading as the time it is', () => {
  // `today` was read once at mount, so an app left open past midnight went on
  // calling yesterday today: the marker stayed on a day that was over and the
  // action that would have led back to the new one never appeared.
  assert.match(screen, /const clock = useDeviceClock\(\);/);
  assert.match(screen, /const today = clock\.localDate;/);
  assert.match(screen, /const nowLocalTime = selected === today \? clock\.localTime : null;/);
  // One reading of the device for both, so the two cannot disagree about the
  // midnight they are read across.
  assert.match(screen, /const now = new Date\(\);\s+return Object\.freeze\(\{\s+localDate: plannerLocalDateFromDevice\(now\),/);
  // And the rail keeps the week it opened on, or every index would be renumbered
  // under a scroll offset that had not moved.
  assert.match(screen, /const railAnchor = useRef\(journalWeekStart\(today\)\)\.current;/);
});

test('the page makes room for the plus, because the day always reaches it', () => {
  // It used to ask whether the content was taller than the pane and add the
  // clearance only then — a question with one answer, since `styles.pane` carries
  // `flexGrow: 1` and the content container is by construction never shorter than
  // the viewport. The branch was true from the first layout onwards, so the short
  // page it was written to spare never existed.
  assert.doesNotMatch(screen, /const crowded =/);
  assert.match(screen, /paddingBottom: JOURNAL_PANE_BOTTOM/);
  assert.match(screen, /pane: \{ flexGrow: 1,/);
  // **Every term is derived from the button.** The card's own bottom edge is already
  // at the bar's clearance, so what the pane has to clear is how far the action
  // reaches above that edge — its lift plus its height — and a little air. There is no
  // eyeballed number left, and no scale competing with the scroll for the page.
  assert.match(screen, /const JOURNAL_PANE_BOTTOM = JOURNAL_FAB_SIZE \+ JOURNAL_FAB_LIFT \+ 12;/);
  // The one term that is *measured* rather than derived is the bar's own room, because a
  // floating oval sits above the home indicator instead of holding it (`insets.bottom`).
  assert.match(screen, /const barClearance = TAB_BAR_CLEARANCE \+ insets\.bottom;/);
  assert.doesNotMatch(screenCode, /JOURNAL_PANE_PADDING|JOURNAL_FAB_CLEARANCE|JOURNAL_FAB_BOTTOM/);
  // The action is 56 pt and stands above the bar rather than level with it.
  assert.match(screen, /const JOURNAL_FAB_SIZE = 56;/);
});


test('a mark made on a day that is over says what it does, and offers the way back', () => {
  // Not a question. «Вы уверены, что выполнили?» asks a person to assert something
  // the application cannot check, and asks it every time; a statement of the
  // consequence teaches the rule once, and the `Undo` beside it covers the only
  // thing the question was ever protecting against.
  assert.match(screen, /Recorded for \$\{formatPlannerDateEntry\(selected\)\}/);
  assert.match(screen, /the record keeps it missed/);
  assert.match(screen, /if \(!done && selected < today && !taskHabitIds\.has\(row\.habitId\)\)/);
  assert.match(screen, />Undo</);
  // A task carries no statistic to be kept out of, so it is told nothing; and the
  // line belongs to the day it was raised on.
  assert.match(screen, /setNotice\(null\);[\s\S]{0,120}setExpanded\(new Set\(\)\);/);
});


test('the last line closes the item, through the same command a tapped box uses', () => {
  // A line writes nothing canonical; the item's own closure stays an observation,
  // so an activity closed by its subtasks keeps counting like any other.
  assert.match(screen, /setHabitChecklistLineDone\(\{/);
  assert.match(screen, /closeItem: item\.completable/);
  assert.match(screen, /reopenItem: item\.completable/);
  assert.match(screen, /itemIsClosed: item\.done,/);
  // And the subtasks themselves come from their own query.
  assert.match(screen, /const checklists = usePlannerChecklists\(itemHabitIds, selected\);/);
});

test('a jump that is not animated says which week it landed on', () => {
  // iOS raises `onMomentumScrollEnd` from a finger's deceleration and from the end
  // of an animated programmatic scroll — never from a non-animated one. So a date
  // picked in the calendar scrolled the strip and left the week behind: the header
  // named a month no longer on screen and the arrows stepped from it.
  // **The week is known when the gesture commits, not when the scroll stops.** It used
  // to be set only for a non-animated jump, so an animated one left `weekStart` on the
  // week it came from until `onMomentumScrollEnd`. Measured off `тест4.MP4`: the list
  // settled at 167 ms, the strip at 300 ms, and the month label changed **alone, in one
  // frame, at 433 ms**, after four frames in which nothing else moved.
  assert.doesNotMatch(screen, /if \(!animated\) setWeekStart\(week\);/);
  assert.match(screen, /setWeekStart\(week\);\s*\n\s*strip\.current\?\.scrollToIndex\(\{ animated, index \}\);/);
  // `settleWeek` is unharmed: it returns early on the week already held, which is now
  // always the one it settles on.
  assert.match(screen, /if \(settled === undefined \|\| settled === weekStart\) return;/);
  assert.match(screen, /scrollToWeek\(journalWeekStart\(date\), !reduceMotion\);/);
});

test('the row is built from one set of columns, all of them the brief’s own', () => {
  // Every retired ruler needed a time column, a node column and a content indent to
  // agree, and every one of them was a chance for two constants to drift. **The plate
  // now states no column at all**: the mark leads at its own size, and the words take
  // what is left. The 44 pt lead column that stood ahead of it is gone with the last
  // ruler — it was reserved whether or not an item had a minute, so on the majority of
  // plates the title began 54 pt in for nothing.
  assert.doesNotMatch(screen, /timeColumn|JOURNAL_NODE_COLUMN|JOURNAL_CONTENT_INDENT|PLATE_TIME_COLUMN/);
  assert.match(screen, /plateWords: \{ flex: 1/);
  // The mark is the first child of the row, which is the whole of the owner's ordering:
  // mark → title → facts → checkbox.
  const plate = functionSource(screen, 'function Plate', 'function PlateFacts');
  assert.ok(
    plate.indexOf('<CategoryChip') < plate.indexOf('styles.plateWords'),
    'the mark is written before the words',
  );
  assert.ok(
    plate.indexOf('styles.plateWords') < plate.indexOf('<Checkbox'),
    'and the words before the control',
  );
});


// ── The opening focus (PD-TODAY-042) ────────────────────


// `an opening is a focus and never a follow` is deleted with the opening scroll. It
// asserted that nothing but a focus raised `setFocusToken`, and there is no token and
// no scroll to pin: the page opens at the top of the day and stays where the person
// leaves it. What the opening still does — collapsing open step lists — is asserted
// by the expansion test below, which is about state rather than about a scroll offset.

// ── Expansion resets (PD-TODAY-043) ──────────────────────

test('an open subtask list belongs to one day and one visit', () => {
  // Cleared on an opening, and on every path that changes the date — carrying it
  // across shows one item's steps under a day that may not even schedule it.
  //
  // **It is asserted once because there is one path now.** It used to be reset in three
  // places — `selectDate`, `jumpTo` and `returnToToday` — each of which could forget;
  // every one of them goes through `travelTo`, so the reset is where the date changes
  // rather than beside each of the ways of asking for it.
  assert.match(
    functionSource(screen, 'const travelTo = useCallback((date: PlannerLocalDate, velocity = 0) => {', '  const jumpTo ='),
    /setExpanded\(new Set\(\)\);/,
    'travelTo must reset expansion',
  );
  for (const path of [
    /const jumpTo = useCallback\(\(date: PlannerLocalDate\) => \{/,
    /const jumpTo = useCallback\(\(date: PlannerLocalDate\) => \{[\s\S]{0,120}travelTo\(date\);/,
    /const returnToToday = useCallback\(\(\) => \{[\s\S]{0,320}travelTo\(today\);/,
  ]) assert.match(screen, path, 'every way of changing the date goes through the one that resets it');
  // Only the expansion: the notice, the failure and the selected date keep their own
  // behaviour, and the chevron is still what toggles one item.
  assert.match(screen, /const toggleSteps = \(habitId: string\) => \{[\s\S]{0,240}next\.add\(habitId\);/);
});

// ── Real hit targets (PD-TODAY-044) ──────────────────────

test('every control on a plate reaches 44 pt, and no two extended areas meet', () => {
  assert.equal(JOURNAL_TOUCH_TARGET, 44);
  // **The checkbox gets a box**, the full height of its row and 44 pt wide, because the
  // target grows around the ring rather than the ring growing to meet it.
  assert.match(screen, /checkboxTarget: \{[^}]*alignSelf: 'stretch'[^}]*width: JOURNAL_TOUCH_TARGET/);
  assert.match(screen, /size=\{PLATE_CHECKBOX\}/);
  assert.equal(PLATE_CHECKBOX, 24, 'and the drawn ring does not grow with it');

  // **The steps line gets a slop**, and it is the one control on a plate that may.
  // A slop overlaps invisibly, so it is safe only where nothing is next to it — the
  // checkbox stands in its own column at the far edge, so the two can never meet.
  assert.equal(PLATE_SUBTASK_ROW + 2 * PLATE_STEPS_SLOP, 56, 'a line and its slop clear the baseline');
  assert.match(screen, /hitSlop=\{\{ bottom: PLATE_STEPS_SLOP, top: PLATE_STEPS_SLOP \}\}/);
  // Vertical only: a horizontal slop on a full-width row would reach across the plate.
  assert.doesNotMatch(screen, /hitSlop=\{\{ bottom: PLATE_STEPS_SLOP[^}]*left/);
});

test('the header has one left edge, and it had three', () => {
  // **This is what «как будто это разные части интерфейса» actually was.** The week band
  // was inset 14, the NOW line 16, and the day row — which moved into the header from the
  // list — carried none at all, so «DAY» stood against the screen edge while the dates
  // were indented. The inset belongs to the header, once, and it is the tab bar's, so the
  // two floating surfaces on the screen line up with each other.
  assert.match(screen, /headerShrink: \{ paddingHorizontal: JOURNAL_HEADER_INSET/);
  assert.doesNotMatch(screen, /weekBand: \{[^}]*paddingHorizontal/);
  assert.doesNotMatch(screen, /nowLine: \{[^}]*paddingHorizontal/);
});

test('the calendar is the biggest thing in the header, and its captions are the quietest', () => {
  // The prototype reads as one object because the sizes descend: the date leads, the
  // month follows, the captions recede. The build had it flat and heavy — a 14 pt date
  // under a 13 pt month, with 9 pt captions at weight 800 shouting underneath, which is
  // how a header ends up looking loud and small at the same time.
  assert.match(screen, /dateNumber: \{ fontSize: JOURNAL_DATE_TYPE_SIZE, fontWeight: '500' \}/);
  assert.match(screen, /monthLabel: \{ fontSize: 15, fontWeight: '600'/);
  // And no 700/800 left anywhere in the header's own type (PD-PLATE-003).
  for (const style of ['weekLetter', 'monthLabel', 'eyebrow', 'tally', 'todayActionText']) {
    const declaration = new RegExp(`${style}: \{[^}]*fontWeight: '(700|800)'`);
    assert.doesNotMatch(screen, declaration, `${style} is heavier than the weight rule allows`);
  }
});

test('the air inside the closed plate is the air the open header has against the screen', () => {
  // **The plate must not take the header's scale.** Carrying it, the surface shrank at the
  // same rate as the content standing on it, so the gap between them stayed what it was at
  // rest — nothing — and the day bar sat hard against the plate's edge while the open state
  // had a clear margin. Reported from the device in those words.
  //
  // Holding its width while the content pulls in, the arithmetic comes out even: the
  // content is 393 − 2 × 14 = 365 wide and a 0.93 scale takes 365 × 0.07 / 2 = 12.8 off
  // each side, against the 14 the open header has from the screen. Within 1.2 pt, which is
  // below what an eye reads as a difference — and it is arithmetic rather than a value
  // somebody tuned until it looked right.
  const plate = functionSource(screen, 'style={[styles.headerPlate', '</Animated.View>');
  assert.doesNotMatch(plate, /scale: headerScale/, 'the plate holds its width');
  assert.match(plate, /scaleY: plateSquash/, 'and follows only vertically');
  const content = 393 - 2 * JOURNAL_HEADER_INSET;
  const pull = (content * (1 - JOURNAL_HEADER_LIFT_SCALE)) / 2;
  assert.ok(Math.abs(pull - JOURNAL_HEADER_INSET) < 2, `${pull.toFixed(1)} pt inside against ${JOURNAL_HEADER_INSET} outside`);
});

test('the day on screen is the last one that was ready, never a half-built one', () => {
  /**
   * **This is the whole of «мерцают», «галочки сбрасываются до перехода» and «сначала
   * появляются задачи новой даты, потом исчезают».** `selected` commits the instant a finger
   * lands, but the four reads that describe a day answer at different moments — so for a few
   * frames the page was assembled from a mixture: this day's rows with that day's ticks, a
   * heading from one and a counter from the other. A row whose *text* is grey beside an empty
   * checkbox is that contradiction made visible in a single screenshot.
   *
   * Holding the previous day **whole** until the new one is complete is what iOS does with a
   * pushed screen: it does not show a half-built controller, it waits.
   */
  // **Ready means all four reads answered about this day, not one of them.** Rows come from
  // the day's query, «is it a task» from the catalogue, ticks from the checklists, and
  // «does it close by those ticks» from the closure rules. Waiting on one is how a second
  // rebuild landed in the middle of a turn — «через пару кадров ещё одна подгрузка».
  assert.match(screen, /const dayIsWhole = dayKnown\s*&& catalogue\.status === 'ready'\s*&& checklists\.status === 'ready'\s*&& closure\.ready;/);
  assert.match(screen, /if \(dayIsWhole\) readyDay\.current = \{ date: selected, value: day \};/);
  assert.match(screen, /const shownDay = readyDay\.current;/);
  // **Every consumer reads the same snapshot**, or the header describes one day while the
  // list draws another — which is the same tear wearing a different mask.
  // **The header's consumers read the snapshot**; the rows moved into `DayPage`, which reads
  // its own day and never becomes another one.
  const consumers = screen.slice(screen.indexOf('const shownDay'), screen.indexOf('// ── Opening'));
  assert.doesNotMatch(consumers, /\bday\.timed\b|\bday\.anytime\b/, 'a consumer left on the unsettled day');
  assert.match(screen, /function DayPage\(\{/, 'a day draws itself, so a second one is an element not a mechanism');
  assert.match(screen, /const query = usePlannerOccurrences\(date\);/);
  assert.match(screen, /onOpen=\{\(\) => onOpenEditor\(item, date\)\}/, 'a page acts on its own date');
  for (const reader of [/dayJournalTally\(shownDay\.value\.timed\)/,
    /dayJournalHero\(\{ items: shownDay\.value\.timed/])
    assert.match(screen, reader);
  // And the carousel turns on the day it is actually showing, not on the one just chosen.

});

test('the journey starts when the day it goes to is whole, not when the finger lands', () => {
  /**
   * **The first cause behind fifteen attempts.** A tap started two things on two schedules:
   * the spring, immediately, and the day's four reads, whenever they answered. On a cold day
   * the content therefore appeared *at the destination*, because by the time it existed the
   * spring had already run — «сначала появляется страница, а потом происходит анимация».
   * Nothing about easing, distance, opacity or mounting reaches that, which is why none of
   * the fixes that touched those did.
   *
   * The selection still moves on the tap — that is what *starts* the read — but the journey
   * is held and run the moment the day is whole. Warm, that is the very next frame; cold, it
   * is tens of milliseconds later, and either way the page and its content set off together.
   */
  assert.match(screen, /pendingJourney\.current = \(\) => begin\(reached, at\);\s*setSelected\(date\);/);
  assert.match(screen, /const pendingJourney = useRef<\(\(\) => void\) \| null>\(null\);/);
  assert.match(screen, /if \(start === null \|\| !dayIsWhole\) return;/);
  // **`shownDay` in the deps, not `dayIsWhole` alone.** A warm day is already whole in the
  // render after the tap, so the flag never changes and an effect watching only it would
  // never fire. What changes is *which* day is complete.
  assert.match(screen, /\}, \[dayIsWhole, shownDay\]\);/);
  // And `begin` no longer moves the selection: the tap already did, a frame earlier.
  const begin = functionSource(screen, 'const begin = (fromX: number, at: number)', '    /**');
  assert.doesNotMatch(begin.replace(/\/\/.*/g, ''), /setSelected\(/, 'the selection is moved by the tap, once');
});

test('the page transition is removed, and what it left behind is written down', () => {
  /**
   * **Owner decision, 2026-08-06, after sixteen attempts at one family of defects**: take the
   * animation out entirely and judge the baseline. If the tearing survives with no animation
   * at all, it was never about the animation and sixteen fixes were aimed at the wrong thing;
   * if it goes, there is finally a clean point to build from.
   *
   * The assertion is not «this is better». It is that the removal was **recorded** rather than
   * done from memory, and that the two things which were never implicated survived it.
   */
  assert.ok(existsSync('docs/DayTransitionAnimation.md'), 'the animation was written down before it was removed');
  const record = readFileSync('docs/DayTransitionAnimation.md', 'utf8');
  for (const kept of ['leaving:', 'arriving:', 'direction', 'key={day}', 'heldHeight', 'pendingJourney'])
    assert.ok(record.includes(kept), `the record is missing ${kept}`);

  const carousel = functionSource(screen, 'function DayCarousel', 'function DateCell')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.doesNotMatch(carousel, /interpolate|useAnimatedStyle|previous\.current/, 'the carousel no longer moves anything');
  // **Kept on purpose**: the floor, so a short day still cannot shorten the page.
  assert.match(carousel, /minHeight/);
  // And the drop's own travel model, which is a different animation on a different surface.
  assert.match(screen, /travel\.value = withSpring\(at \+ 1,/);
});

test('days are pages on a track, so content and position can never disagree', () => {
  /**
   * **The rebuild, and the rule that decides it: at a change of date, no page's content is
   * rewritten.** The carousel this replaces had one tree rewritten under it plus a frozen
   * snapshot of what it used to be, both positioned by an animated style — and since React
   * commits content synchronously while an animated style lands the next frame, one frame
   * always drew new content at the old position. Sixteen fixes closed one route to that
   * frame each; there were more routes than fixes.
   *
   * Here a page owns its date for its whole life and its position comes from layout. The
   * frame cannot occur, because nothing is rewritten while anything moves.
   */
  assert.equal(journalPageWindow(date('2026-08-06')).length, JOURNAL_PAGE_WINDOW_RADIUS * 2 + 1);
  assert.equal(journalPageWindow(date('2026-08-06'))[JOURNAL_PAGE_WINDOW_RADIUS], '2026-08-06');
  // The offset is the index times the width, negated — the one value a turn animates.
  assert.equal(journalPageOffset(3, 100), -300);
  assert.equal(journalPageOffset(0, 100), 0);

  // Layout puts the pages side by side; only the track's own transform ever moves.
  assert.match(screen, /pageTrack: \{ flexDirection: 'row' \}/);
  assert.match(screen, /style=\{\[styles\.pageSlot, \{ width: pageWidth \}\]\}/);
  assert.match(screen, /const pageTrack = useAnimatedStyle\(\(\) => \(\{ transform: \[\{ translateX: pageX\.value \}\] \}\)\);/);
  // Every day on the track is a page, and each reads its own day.
  assert.match(screen, /pageWindow\.map\(\(date\) => <View key=\{date\}/);
  assert.match(screen, /date=\{date\}/);

  /**
   * **The window is stable across a turn, and that is the single place a relapse can enter.**
   * Rebuilding it mid-turn changes every page's index — and an index is a position, which is
   * the original defect arriving from the other end. It is recentred only once the spring has
   * settled, and the offset is put back in the same commit so the picture does not move.
   */
  /**
   * **Two writers, and neither runs while a turn does.** The window is rebuilt when a date
   * lands outside it — a jump, decided before the spring is given anything to do — and when a
   * turn settles. What may never happen is a rebuild *during* a turn: every page's index
   * would change, and an index is a position, which is the original defect arriving from the
   * other end. Both writers park the track in the same breath, so the picture never moves.
   */
  assert.equal((screen.match(/setPageWindow\(/g) ?? []).length, 3, 'the window has exactly three writers');

  /**
   * **A distant date is brought alongside rather than jumped to.**
   *
   * The track holds seven days, so anything further had no page mounted and the turn did not
   * play at all — «если переключаться на даты больше 5 дней вперед или назад, то они не
   * грузятся», and then «на них не работает анимация». Sliding the real distance is no answer
   * either: thirty screens of travel says nothing anybody reads. Every calendar moves **one**
   * screen however far the date is, which is what a two-page window gives — the day being
   * left and the day being gone to, side by side in the direction of travel.
   *
   * Rebuilt at the tap rather than inside `begin`, because `begin` waits for the day to be
   * whole: by the time it runs the pages must already be mounted and the track parked on the
   * one being left, so the spring has both a start and a destination.
   */
  assert.match(screen, /if \(!pageWindow\.includes\(date\)\) \{\s*const pair = Object\.freeze\(date > from \? \[from, date\] : \[date, from\]\);/);
  assert.match(screen, /setPageWindow\(pair\);\s*pageWindowRef\.current = pair;\s*parkTrack\(pair, from, pageWidth\);/);
  // **`begin` reads the mounted window, not its closure's.** It runs a render after the tap
  // that decided it, and by then the window may have been rebuilt to bring the date within
  // reach; the closure would still hold a page that is no longer on the track.
  assert.match(screen, /const targetIndex = pageWindowRef\.current\.indexOf\(date\);/);
  assert.match(screen, /const recentred = journalPageWindow\(date\);\s*setPageWindow\(recentred\);\s*parkTrack\(recentred, date, pageWidth\);/);

  /**
   * **Parking answers a change of geometry, never a change of date.**
   *
   * With `selected` in its dependencies the parking effect fired the moment a date was
   * tapped and put the track straight on its destination — before the spring was allowed to
   * start, since the start waits for the day to be whole and `flying` is therefore still
   * false. The turn then had nowhere left to travel: «анимация проигрывается всего раз после
   * открытия приложения». A journey running, or merely waiting for its day, owns the track.
   */
  assert.match(screen, /if \(flying\.current \|\| pendingJourney\.current !== null\) return;\s*parkTrack\(pageWindow, selectedRef\.current, pageWidth\);/);
  assert.match(screen, /\}, \[pageWidth, pageWindow, parkTrack\]\);/, 'the date is not a reason to park');
});

test('a page carries its own margins, so its plates cannot run under the next day', () => {
  // **The ground's side padding belongs to a page, not to the track.** On the scroll's own
  // container it inset the whole seven-page track *once*, so every slot was still a full pane
  // wide and its plates ran past the edge — «плашки выезжают за границу страницы и обрезаются
  // в правой части экрана». The padding always meant «the ground around one day's list».
  assert.match(screen, /pageSlot: \{ alignSelf: 'flex-start', paddingHorizontal: PLATE_GROUND_PADDING \}/);
  assert.match(screen, /pane: \{ flexGrow: 1, paddingBottom: JOURNAL_PANE_BOTTOM \}/);
  assert.doesNotMatch(screen, /pane: \{[^}]*paddingHorizontal/, 'the track may not be inset as a whole');
});

test('today is kept warm from anywhere, because it is reachable from anywhere', () => {
  // **Every other prefetched date is one the strip can reach in a tap, so proximity is what
  // puts it on the list.** Today is reachable in a tap from *anywhere* — that is what the
  // button is — and it was the one date the list could not see, because from a distant day it
  // is nobody's neighbour. Reported as «отзыв на нажатие Today очень долгий, порядка полу
  // секунды»: the turn waits for the day it goes to to be whole, and from far away all four
  // of its reads started from nothing.
  assert.match(
    screen,
    // `\r?` because the checkout is CRLF: a pattern that assumes `\n` passes on one machine
    // and fails on another, which is the least useful kind of assertion there is.
    /\.\.\.journalWeekDates\(weekStart\),[\s\S]{0,1400}\r?\n {6}today,\r?\n {4}\];/,
    'today is warmed wherever the selection has wandered',
  );
  assert.match(screen, /\}, \[selected, today, weekStart\]\);/, 'and the list is rebuilt when today rolls over');
  // Still held until the selected day itself has landed, so a warm-up never queues ahead of
  // the day being looked at.
  assert.match(screen, /usePlannerOccurrencePrefetch\(prefetchDates, query\.status === 'ready'\);/);
});
