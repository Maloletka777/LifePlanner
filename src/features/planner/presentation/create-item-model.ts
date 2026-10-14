import type { RegisteredHabitSymbolKey } from '../domain';
import {
  PLANNER_DAY_BLOCKS,
  suggestPlannerDayBlock,
  type PlannerDayBlockKey,
} from '../domain/values/day-block';

import {
  applyCreateScheduleMode,
  createScheduleModeFor,
  isOnceRange,
  type CreateScheduleMode,
} from './create-habit-schedule-model';
import { HABIT_CATEGORY_OPTIONS } from './habit-category-catalogue';
import { suggestedHabitSymbols } from './habit-identity-picker-model';
import type { ActiveRangeDraft, ScheduleDraft } from './ui-adapters';

/**
 * The decisions the single create sheet makes, with no React in them.
 *
 * `IA Options.dc.html` frames 11a and 11b are one window in two modes, so every
 * rule that differs between a task and a habit is here rather than in the screen:
 * which schedule a type writes, which repeat a schedule reads back as, which six
 * categories the row offers, which seven symbols sit beside the full catalogue, and
 * what a reminder actually resolves to. The screen draws; this decides.
 */

/**
 * A task is not a second kind of record.
 *
 * The Planner schema has no one-off type and inventing one would be a migration,
 * so a task is written exactly as PD-CREATE-003 already writes `Once`: a daily
 * schedule whose active range is the single day it is due. That is why switching
 * the segment loses nothing — both types are the same habit with a different
 * schedule, and the segment reads back from the schedule rather than from a flag.
 */
export type CreateItemType = 'task' | 'habit';

export const CREATE_ITEM_TYPES: readonly CreateItemType[] = Object.freeze(['task', 'habit'] as const);

export const CREATE_ITEM_TYPE_LABELS: Readonly<Record<CreateItemType, string>> = Object.freeze({
  habit: 'Habit',
  task: 'Task',
});

/**
 * What the empty name field says, by type.
 *
 * It is a **placeholder and never a value**, which is the whole point: a
 * pre-filled name would have to be selected and deleted, while a placeholder
 * vanishes on the first touch with the caret already at the left edge.
 */
export const CREATE_NAME_PLACEHOLDERS: Readonly<Record<CreateItemType, string>> = Object.freeze({
  habit: 'Create a new habit',
  task: 'Create a new task',
});

export const CREATE_ITEM_ACTION_LABELS: Readonly<Record<CreateItemType, string>> = Object.freeze({
  habit: 'Create habit',
  task: 'Create task',
});

/**
 * Two repeats on the row, the rest behind the `+`.
 *
 * Four chips wrapped to two lines and cost the sheet a whole row of height for a
 * choice that is nearly always one of the first two. The row now carries `Every
 * day` and `Chosen days`, and the trailing key opens the rest — which is also what
 * makes the sheet reach the schema types the four-chip row could not: every day,
 * chosen weekdays, every N days, N a week, N a month, a day of the month and a day
 * of the year. When an extended repeat is chosen the trailing key wears its name,
 * so the row still says what the item does without growing.
 */
export type CreateRepeatMode = 'daily' | 'days' | 'perWeek' | 'perMonth' | 'perYear' | 'interval' | 'monthDay' | 'yearly';

export const CREATE_REPEAT_MODES: readonly CreateRepeatMode[] = Object.freeze([
  'daily', 'days', 'interval', 'perWeek', 'perMonth', 'perYear', 'monthDay', 'yearly',
] as const);

/** The two that sit on the row itself. */
export const CREATE_PRIMARY_REPEAT_MODES: readonly CreateRepeatMode[] = Object.freeze([
  'daily', 'days',
] as const);

/** The five behind the trailing key, in the order the sheet lists them. */
export const CREATE_EXTENDED_REPEAT_MODES: readonly CreateRepeatMode[] = Object.freeze([
  'interval', 'perWeek', 'perMonth', 'perYear', 'monthDay', 'yearly',
] as const);

export const CREATE_REPEAT_MODE_LABELS: Readonly<Record<CreateRepeatMode, string>> = Object.freeze({
  daily: 'Every day',
  days: 'Chosen days',
  interval: 'Every N days',
  monthDay: 'A day of the month',
  perMonth: 'N a month',
  perWeek: 'N a week',
  perYear: 'N a year',
  yearly: 'A day of the year',
});

export const CREATE_REPEAT_MODE_CAPTIONS: Readonly<Record<CreateRepeatMode, string>> = Object.freeze({
  daily: 'Every single day.',
  days: 'On the weekdays you choose.',
  interval: 'Every second day, every third day, and so on.',
  monthDay: 'The same date each month.',
  perMonth: 'A target for the month, on any days you like.',
  perWeek: 'A target for the week, on any days you like.',
  perYear: 'A target for the year, on any days you like.',
  yearly: 'The same date each year.',
});

export function isExtendedRepeatMode(mode: CreateRepeatMode): boolean {
  return !CREATE_PRIMARY_REPEAT_MODES.includes(mode);
}

export function createItemTypeFor(schedule: ScheduleDraft, range: ActiveRangeDraft): CreateItemType {
  return isOnceRange(range) && schedule.scheduleType === 'daily' ? 'task' : 'habit';
}

export function createRepeatModeFor(schedule: ScheduleDraft, range: ActiveRangeDraft): CreateRepeatMode {
  const mode: CreateScheduleMode = createScheduleModeFor(schedule, range);
  if (mode === 'days') return 'days';
  if (mode === 'interval') return 'interval';
  if (schedule.scheduleType === 'times_per_month') return 'perMonth';
  if (schedule.scheduleType === 'times_per_week') return 'perWeek';
  if (schedule.scheduleType === 'times_per_year') return 'perYear';
  if (schedule.scheduleType === 'monthly') return 'monthDay';
  if (schedule.scheduleType === 'yearly') return 'yearly';
  return 'daily';
}

/**
 * Switching type keeps every filled field.
 *
 * Only the schedule moves: a task collapses to its due day, and a habit that was a
 * task reopens as `Every day` from the same date. Nothing about the name, the
 * mark, the priority, the steps or the note is touched, which is the whole reason
 * the segment can sit above them.
 */
export function applyCreateItemType(
  type: CreateItemType,
  schedule: ScheduleDraft,
  range: ActiveRangeDraft,
): Readonly<{ schedule: ScheduleDraft; range: ActiveRangeDraft }> {
  return applyCreateScheduleMode(type === 'task' ? 'once' : 'daily', schedule, range);
}

/**
 * A repeat is one of the shared schedule modes plus, where a mode covers more than
 * one schema type, the type itself. The shared mapping runs first so every default
 * it supplies — the anchor date, the interval, the day of the month — is the same
 * one the previous screen used, and only the type is decided here.
 */
export function applyCreateRepeatMode(
  mode: CreateRepeatMode,
  schedule: ScheduleDraft,
  range: ActiveRangeDraft,
): Readonly<{ schedule: ScheduleDraft; range: ActiveRangeDraft }> {
  if (mode === 'daily' || mode === 'days' || mode === 'interval') {
    return applyCreateScheduleMode(mode, schedule, range);
  }
  if (mode === 'monthDay' || mode === 'yearly') {
    const applied = applyCreateScheduleMode('date', schedule, range);
    return Object.freeze({
      range: applied.range,
      schedule: Object.freeze({
        ...applied.schedule,
        scheduleType: mode === 'monthDay' ? 'monthly' as const : 'yearly' as const,
      }),
    });
  }
  const applied = applyCreateScheduleMode('times', schedule, range);
  return Object.freeze({
    range: applied.range,
    schedule: Object.freeze({
      ...applied.schedule,
      scheduleType: mode === 'perWeek'
        ? 'times_per_week' as const
        : mode === 'perMonth' ? 'times_per_month' as const : 'times_per_year' as const,
    }),
  });
}

/**
 * The numbers a repeat needs, kept inside the range the domain accepts.
 *
 * Every extended repeat needs exactly one or two whole numbers — how many times a
 * period, how many days apart, which day, which month — so they share one control
 * on the screen and one rule here rather than four keyboards.
 */
export type CreateScheduleNumberField = 'periodTargetCount' | 'intervalDays' | 'monthDay' | 'monthNumber';

export const CREATE_SCHEDULE_NUMBER_BOUNDS: Readonly<Record<CreateScheduleNumberField, Readonly<{ min: number; max: number }>>> = Object.freeze({
  intervalDays: Object.freeze({ max: 365, min: 2 }),
  monthDay: Object.freeze({ max: 31, min: 1 }),
  monthNumber: Object.freeze({ max: 12, min: 1 }),
  periodTargetCount: Object.freeze({ max: 30, min: 1 }),
});

export function scheduleNumber(schedule: ScheduleDraft, field: CreateScheduleNumberField): number {
  const bounds = CREATE_SCHEDULE_NUMBER_BOUNDS[field];
  const parsed = Number.parseInt(schedule[field], 10);
  if (!Number.isFinite(parsed)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}

export function stepScheduleNumber(schedule: ScheduleDraft, field: CreateScheduleNumberField, offset: -1 | 1): ScheduleDraft {
  const bounds = CREATE_SCHEDULE_NUMBER_BOUNDS[field];
  const next = Math.min(bounds.max, Math.max(bounds.min, scheduleNumber(schedule, field) + offset));
  return Object.freeze({ ...schedule, [field]: String(next) });
}

/**
 * A task cannot be due in a time that has already gone.
 *
 * A habit is a rule and may begin whenever it likes; a task is a thing to do on a
 * particular day, and a day that has passed is not one. So the due date is bounded
 * below by today, and when the task is due **today** its time of day is bounded by
 * the clock. An all-day task on today is fine — it has not missed anything.
 *
 * It refuses rather than clamps: silently moving a chosen time is how a person
 * ends up with a task at a minute they never picked.
 */
export function createTaskMomentIsPast(input: Readonly<{
  type: CreateItemType;
  dueDate: string;
  plannedTime: string;
  today: string;
  nowMinuteOfDay: number;
}>): boolean {
  if (input.type !== 'task') return false;
  if (input.dueDate < input.today) return true;
  if (input.dueDate > input.today || input.plannedTime.trim() === '') return false;
  const minute = localTimeMinutes(input.plannedTime);
  return minute !== null && minute < input.nowMinuteOfDay;
}

export const CREATE_TASK_PAST_MESSAGE = 'A task cannot be due at a time that has already passed. Choose a later time or another day.';

/** How many times a period, as a whole number the domain will accept. */
export function createPeriodTargetCount(schedule: ScheduleDraft): number {
  return scheduleNumber(schedule, 'periodTargetCount');
}

export function stepPeriodTargetCount(schedule: ScheduleDraft, offset: -1 | 1): ScheduleDraft {
  return stepScheduleNumber(schedule, 'periodTargetCount', offset);
}

/**
 * The weekdays as a row of letters and as words.
 *
 * The letters are for the seven-circle grid, where position disambiguates the two `T`s
 * and the two `S`s; the words are for the summary row, where nothing does.
 */
export const CREATE_WEEKDAY_CAPS: readonly string[] = Object.freeze(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
export const CREATE_WEEKDAY_SHORT: readonly string[] = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
export const CREATE_WEEKDAY_NAMES: readonly string[] = Object.freeze([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);
const CREATE_MONTH_SHORT: readonly string[] = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

/**
 * What the `Repeats` row says when the rule is behind a sheet.
 *
 * **It states the rule, not the mode.** «Chosen days» tells a person nothing they did
 * not already know from having chosen them, so the row carries the days themselves —
 * and the seven-of-seven case says `Every day`, because that is what it is however it
 * was arrived at. A rule that carries a number carries it here too; a mode with no
 * number is its own label.
 *
 * Lives in the model rather than in the screen so it can be asserted against the
 * schedule draft directly, which is the only way to catch a summary that stops matching
 * the schedule it claims to describe.
 */
export function createRepeatSummary(mode: CreateRepeatMode, schedule: ScheduleDraft): string {
  if (mode === 'days') {
    const chosen = [...schedule.selectedWeekdays].filter((day) => day >= 1 && day <= 7).sort((left, right) => left - right);
    if (chosen.length === 0) return 'No days yet';
    if (chosen.length === 7) return CREATE_REPEAT_MODE_LABELS.daily;
    return chosen.map((day) => CREATE_WEEKDAY_SHORT[day - 1] ?? '').join(' · ');
  }
  if (mode === 'interval') return `Every ${scheduleNumber(schedule, 'intervalDays')} days`;
  if (mode === 'perWeek') return `${scheduleNumber(schedule, 'periodTargetCount')} a week`;
  if (mode === 'perMonth') return `${scheduleNumber(schedule, 'periodTargetCount')} a month`;
  if (mode === 'perYear') return `${scheduleNumber(schedule, 'periodTargetCount')} a year`;
  if (mode === 'monthDay') return `Day ${scheduleNumber(schedule, 'monthDay')} each month`;
  if (mode === 'yearly') {
    const month = CREATE_MONTH_SHORT[scheduleNumber(schedule, 'monthNumber') - 1] ?? '';
    return `${month} ${scheduleNumber(schedule, 'monthDay')}`.trim();
  }
  return CREATE_REPEAT_MODE_LABELS.daily;
}

/** Which numbers the chosen repeat asks for, and what each of them is called. */
export function repeatNumberFields(mode: CreateRepeatMode): readonly Readonly<{ field: CreateScheduleNumberField; caption: string }>[] {
  if (mode === 'interval') return Object.freeze([Object.freeze({ caption: 'days apart', field: 'intervalDays' as const })]);
  if (mode === 'perWeek') return Object.freeze([Object.freeze({ caption: 'times a week, on any days', field: 'periodTargetCount' as const })]);
  if (mode === 'perMonth') return Object.freeze([Object.freeze({ caption: 'times a month, on any days', field: 'periodTargetCount' as const })]);
  if (mode === 'perYear') return Object.freeze([Object.freeze({ caption: 'times a year, on any days', field: 'periodTargetCount' as const })]);
  if (mode === 'monthDay') return Object.freeze([Object.freeze({ caption: 'day of the month', field: 'monthDay' as const })]);
  if (mode === 'yearly') {
    return Object.freeze([
      Object.freeze({ caption: 'month', field: 'monthNumber' as const }),
      Object.freeze({ caption: 'day of that month', field: 'monthDay' as const }),
    ]);
  }
  return Object.freeze([]);
}

/**
 * The colour row became the category row.
 *
 * `IA Options.dc.html` draws a row of colour circles; `design_handoff_today` says
 * what those circles mean — "Category is chosen when creating an item; there is no
 * free color picker" — and that a category's colour is the only chromatic language
 * an item has. So the row keeps the drawn geometry and gains the meaning: six
 * circles, each a category, each carrying its own exact colour and its name.
 *
 * Nothing new is persisted; a category is stored as the canonical accent key its
 * hue already names. See `habit-category-catalogue.ts`.
 */
export const CREATE_CATEGORY_OPTIONS = HABIT_CATEGORY_OPTIONS;

// ── When: the part of the day, and how long it takes ────────────────────────

/**
 * Which part of the day a thing belongs to.
 *
 * **This is the field the whole first floor rests on, and it comes before the clock
 * time deliberately.** A person asked «when?» answers «утром» far more often than they
 * answer «в 7:20», and a form that asks for the minute first makes them invent one —
 * after which every day is measured against a precision they never meant. So the block
 * is offered first and the minute is an extra, off unless the outside world set one.
 *
 * The fourth option is absence, and it is a real answer rather than a skipped question:
 * «когда угодно» is a thing with no part of the day, and it is stored as `null`.
 */
export type CreateBlockChoice = PlannerDayBlockKey | 'anytime';

export const CREATE_BLOCK_CHOICES: readonly CreateBlockChoice[] = Object.freeze([
  ...PLANNER_DAY_BLOCKS, 'anytime',
] as const);

export const CREATE_BLOCK_LABELS: Readonly<Record<CreateBlockChoice, string>> = Object.freeze({
  morning: 'Morning',
  day: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
});

/** What the chooser holds → what is stored. */
export function createBlockValue(choice: CreateBlockChoice): PlannerDayBlockKey | null {
  return choice === 'anytime' ? null : choice;
}

/** What is stored → what the chooser holds. */
export function createBlockChoice(value: PlannerDayBlockKey | null): CreateBlockChoice {
  return value ?? 'anytime';
}

/**
 * The block a chosen minute suggests, and never a block it assigns.
 *
 * Offered when somebody sets a clock time on an item with no part of the day yet — at
 * which point they have said something about when, and re-asking would be asking twice.
 * A person who then moves the item to another part of the day keeps that choice: this is
 * consulted only where nothing has been chosen.
 */
export function createBlockSuggestion(plannedTime: string): CreateBlockChoice | null {
  const minute = createMinuteOfLocalTime(plannedTime);
  return minute === null ? null : suggestPlannerDayBlock(minute);
}

function createMinuteOfLocalTime(localTime: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) return null;
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3, 5));
}

/**
 * The lengths offered as chips.
 *
 * Five, and they are the ones a person actually says: a quarter of an hour, half an
 * hour, three quarters, an hour, two. **They are offered rather than defaulted** — an
 * item with no length chosen stores `NULL`, which means «nobody said» and is what every
 * surface draws the absence of. A default here would put a made-up half hour on the day
 * of everybody who never opened this row.
 *
 * Anything else goes through the drum, which is where an arbitrary length was already
 * being chosen; the chips exist because five taps are not five taps when four of them
 * cover most of what anybody plans.
 */
export const CREATE_DURATION_CHOICES: readonly number[] = Object.freeze([15, 30, 45, 60, 120]);

export function createDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The smallest length a thing may be planned at.
 *
 * A quarter of an hour, and it is a product judgement rather than a measurement: below
 * it a plate stops being able to hold a mark, a title and a checkbox at once, and a day
 * of five-minute items is a list somebody will not keep. Stated here so the form and the
 * drum cannot disagree about it.
 */
export const CREATE_MIN_DURATION_MINUTES = 15;

/**
 * Whether the person is taking this routine on — the second floor's own switch.
 *
 * **It is a switch and not a state the application infers**, because the whole meaning of
 * the second floor is that the person said «this one matters to me now». Inferring it
 * from priority, or from frequency, would put the application in charge of a decision
 * that is only worth anything when it was made deliberately.
 *
 * Offered on habits alone: a task is one day's work and has no rhythm to grow.
 */
export function createGrowthAvailable(type: CreateItemType): boolean {
  return type === 'habit';
}

/**
 * What the switch says when there is no room left.
 *
 * The cap is three, and it is stated as a count rather than as a refusal: «2 / 3» invites
 * a choice, «нельзя» invites an argument. Where the last slot is taken the row says which
 * routines hold them, so the way out is visible without leaving the form.
 */
export function createGrowthSlotsLabel(input: Readonly<{ used: number; max: number }>): string {
  return `${input.used} / ${input.max}`;
}

export function createGrowthHasRoom(input: Readonly<{ used: number; max: number; alreadyGrowing: boolean }>): boolean {
  return input.alreadyGrowing || input.used < input.max;
}

/** Seven tiles beside the `+`, the chosen symbol always the first of them. */
export const CREATE_QUICK_SYMBOL_COUNT = 7;

const CREATE_FALLBACK_SYMBOL_KEYS: readonly RegisteredHabitSymbolKey[] = Object.freeze([
  'habit_generic', 'checklist', 'wake_up', 'workout', 'reading', 'water', 'work', 'shopping',
] as const);

/**
 * The row of symbols the name itself suggests — and **only** the name.
 *
 * It used to hold the selected symbol at the front, which meant every tap
 * reordered the row under the finger: the tile just chosen jumped to the left and
 * the rest shuffled behind it. The row is now decided by the name alone, so
 * choosing a symbol moves nothing and selection is carried by colour, which is all
 * a selection has to do. A symbol picked from the full catalogue may not be in this
 * row at all; the mark in the header is what shows it.
 */
export function createQuickSymbolKeys(name: string): readonly RegisteredHabitSymbolKey[] {
  const ordered: RegisteredHabitSymbolKey[] = [];
  const add = (key: RegisteredHabitSymbolKey) => {
    if (ordered.length < CREATE_QUICK_SYMBOL_COUNT && !ordered.includes(key)) ordered.push(key);
  };
  for (const option of suggestedHabitSymbols(name, CREATE_QUICK_SYMBOL_COUNT)) add(option.key);
  for (const key of CREATE_FALLBACK_SYMBOL_KEYS) add(key);
  return Object.freeze(ordered);
}

/**
 * A reminder is a time, and the sheet offers two ways of saying it.
 *
 * `CreateHabitCommand` carries one absolute `triggerLocalTime`, so "10 minutes
 * before" is resolved here against the planned time rather than stored as an offset
 * the domain has no field for. An offset that cannot be resolved — no planned time,
 * or a subtraction that would fall into yesterday — resolves to `null` and the
 * choice is refused rather than clamped, because a reminder shown at a time it will
 * not fire at is worse than no reminder.
 */
export type CreateReminderDraft =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'at'; time: string }>
  | Readonly<{ kind: 'before'; minutes: number }>;

export const CREATE_REMINDER_NONE: CreateReminderDraft = Object.freeze({ kind: 'none' });

/** The offsets the sheet offers a timed item, in minutes before its planned time. */
export const CREATE_REMINDER_OFFSETS: readonly number[] = Object.freeze([0, 5, 10, 15, 30, 60]);

export const DEFAULT_REMINDER_TIME = '12:00';

export function reminderTriggerTime(draft: CreateReminderDraft, plannedTime: string): string | null {
  if (draft.kind === 'none') return null;
  if (draft.kind === 'at') return isLocalTime(draft.time) ? draft.time : null;
  const planned = localTimeMinutes(plannedTime);
  if (planned === null) return null;
  const trigger = planned - draft.minutes;
  return trigger < 0 ? null : formatLocalTime(trigger);
}

export function reminderOffsetLabel(minutes: number): string {
  if (minutes === 0) return 'At the time';
  if (minutes < 60) return `${minutes} min before`;
  return minutes === 60 ? '1 hour before' : `${minutes / 60} hours before`;
}

/** What the row says on the sheet, in the same words the choice was made in. */
export function reminderSummary(draft: CreateReminderDraft, plannedTime: string): string {
  const trigger = reminderTriggerTime(draft, plannedTime);
  if (trigger === null) return 'None';
  return draft.kind === 'before' ? `${reminderOffsetLabel(draft.minutes)} · ${trigger}` : `At ${trigger}`;
}

function isLocalTime(value: string): boolean {
  return localTimeMinutes(value) !== null;
}

function localTimeMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatLocalTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * A step is text and nothing else.
 *
 * The design is explicit that a step owns no day, no time and no reminder, that it
 * never closes the item, and that a closed item does not close its steps. In this
 * domain that is exactly an `organizational` child: the parent keeps its own
 * completion action and the children are independent (ADR-007). A `routine_step`
 * child would derive the parent's completion, which is the behaviour the design
 * rules out in as many words.
 */
/**
 * Kept for the shape the *old* subtask was written in, and used by nothing.
 *
 * A subtask is a line of text with a tick per day now, not an ordinary child, so
 * no create path writes a completion role at all. The constant survives only as
 * the name of what Migration 010 goes looking for.
 */
export const CREATE_STEP_COMPLETION_ROLE = 'organizational' as const;

export function createStepsSummary(count: number): string {
  return count === 0 ? '' : `${count}`;
}
