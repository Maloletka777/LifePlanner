import type { PlannerHabitCatalogueItem, PlannerLocalDate } from '@/src/features/planner';

// The domain module directly, not the feature barrel: this model is asserted in
// the Node test runner, and the barrel drags React Native in with it.
import { isOneDayScheduledItem } from '../domain/schedule/one-day-item';
import { OVERVIEW_DELTA_DAY_LIMIT } from './overview-model';
import { movePlannerDate, plannerLocalDateToDate } from './ui-adapters';

/**
 * Manage, from `design_handoff_manage_subtasks` §A.
 *
 * The screen stops being a list of habits and becomes a list of **items**: tasks
 * and habits together, told apart by the shape of a coloured node rather than by
 * an icon or a label — the journal's own language, carried onto the surface where
 * things are found, repaired, archived and deleted.
 *
 * Everything here is a pure function over the catalogue, so the grouping, the
 * ordering and the type split are asserted in the Node test runner rather than
 * inspected on a device. React Native is not imported, and neither is the feature
 * barrel that would drag it in.
 */

/** What an item is. Derived from its schedule, never stored. */
export type ManageItemKind = 'task' | 'habit';
/** Which of the three type slots the screen is showing. */
export type ManageTypeScope = 'all' | 'tasks' | 'habits';
/** Two orders and no third: the toggle returns to where it started. */
export type ManageSortOrder = 'newest' | 'oldest';
/** Where a task sits relative to today. Habits have no bucket. */
export type ManageDueBucket = 'overdue' | 'today' | 'later';

export interface ManageSection {
  readonly key: 'needsSchedule' | 'overdue' | 'today' | 'later' | 'habits';
  readonly label: string;
  readonly items: readonly PlannerHabitCatalogueItem[];
}

/**
 * A task is a one-day item, and that is the whole of the distinction.
 *
 * The rule is the one the journal already runs on: a `daily` schedule whose active
 * range is a single day is exactly what Create writes for `Task` (PD-CREATE-017),
 * and `effectiveTo` is exclusive, so one day is the day plus one. It is exported
 * from here and consumed by the journal rather than restated there, because two
 * copies of this rule are two chances for Manage and Today to disagree about what
 * a thing is.
 *
 * The README names `createItemTypeFor` for this. That function takes the create
 * screen's **drafts**, not a catalogue row, so reusing it here would mean building
 * a draft out of a stored item to ask it a question the stored item can answer.
 */
export function manageItemKind(item: PlannerHabitCatalogueItem): ManageItemKind {
  return isOneDayScheduledItem({
    effectiveFrom: item.activeRange.effectiveFrom,
    effectiveTo: item.activeRange.effectiveTo,
    scheduleType: item.schedule?.definition.scheduleType,
  }) ? 'task' : 'habit';
}

/** A task's due date is its active range — the model carries no separate field. */
export function manageTaskDueDate(item: PlannerHabitCatalogueItem): PlannerLocalDate {
  return item.activeRange.effectiveFrom;
}

export function manageDueBucket(due: PlannerLocalDate, today: PlannerLocalDate): ManageDueBucket {
  if (due < today) return 'overdue';
  return due === today ? 'today' : 'later';
}

/**
 * The chip under a task's title: `Today`, `Tomorrow`, or the day and its month.
 *
 * Named days are worth their words because they are the two a person acts on; a
 * date three weeks out is read as a date.
 */
export function manageDueChipLabel(due: PlannerLocalDate, today: PlannerLocalDate): string {
  if (due === today) return 'Today';
  if (due === movePlannerDate(today, 1)) return 'Tomorrow';
  const date = plannerLocalDateToDate(due);
  return `${date.getDate()} ${MONTH_ABBREVIATIONS[date.getMonth()]}`;
}

const MONTH_ABBREVIATIONS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

/** What the gutter's ink means, decided here and coloured by the screen. */
export type ManageGutterTone = 'overdue' | 'today' | 'later' | 'timed' | 'anytime';

export interface ManageGutterLabel {
  readonly label: string;
  readonly tone: ManageGutterTone;
}

/**
 * The column Today gives to a minute, and what Manage puts in it: **when the item
 * comes round**.
 *
 * A task has a due day and a habit has a time of day, so the same cell answers the same
 * question in the two forms the two kinds actually have. The three task forms are
 * `manageDueChipLabel`'s own and are not rewritten — they moved out of the trailing chip
 * and into the gutter, which is the whole of PD-MANAGE-018.
 *
 * A habit with no time reads `Anytime`, which is what the journal calls the section it
 * puts such an item in. **A broken item reads `Anytime` too**: it has no schedule to
 * take a time from, and the section it is pinned under already says what is wrong with
 * it — inventing a fourth word for the cell would say it twice.
 */
export function manageGutterLabel(input: Readonly<{
  kind: ManageItemKind;
  due: PlannerLocalDate;
  plannedLocalTime: string | null;
  today: PlannerLocalDate;
}>): ManageGutterLabel {
  if (input.kind === 'task') {
    return Object.freeze({
      label: manageDueChipLabel(input.due, input.today),
      tone: manageDueBucket(input.due, input.today),
    });
  }
  return input.plannedLocalTime === null
    ? Object.freeze({ label: 'Anytime', tone: 'anytime' as const })
    : Object.freeze({ label: input.plannedLocalTime, tone: 'timed' as const });
}

/**
 * How late a task is, in the wording the rest of the application already uses.
 *
 * The section says a task is overdue and the gutter says which day it was due; neither
 * says **how long** it has stood, which is the one thing that makes an old task read
 * differently from yesterday's. Days run to a month and months take over after that,
 * which is PD-OVERVIEW-013's rule — shared through its own constant rather than
 * restated, so the two surfaces cannot drift into two answers.
 */
export function manageOverdueLabel(due: PlannerLocalDate, today: PlannerLocalDate): string | null {
  const days = Math.round(
    (plannerLocalDateToDate(today).getTime() - plannerLocalDateToDate(due).getTime()) / DAY_MILLISECONDS,
  );
  if (days <= 0) return null;
  if (days <= OVERVIEW_DELTA_DAY_LIMIT) return `${days} ${days === 1 ? 'day' : 'days'} overdue`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} overdue`;
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * The gutter's own width, and it is **not a constant**.
 *
 * Three times in this application a time column has been a fixed number and three times
 * it has clipped its own label (PD-TODAY-032, PD-TODAY-071), so it follows the text
 * scale that is actually on.
 *
 * **It is also wider than the journal's, and that is measured rather than preferred.**
 * The journal's 76 pt holds `HH:MM`; this column's longest string is `Tomorrow`, which
 * at 13/700 measures ≈63 pt against the 56 pt that 76 leaves after its 2 × 10 padding —
 * so the drawn column would have clipped the second most common due date there is. The
 * design's own mock never draws that word, which is why it was not visible there. 84 is
 * that measurement plus the padding; the cap is what the label needs at the largest
 * scale it is allowed to reach, so the column cannot clip at any supported text size.
 */
export const MANAGE_GUTTER = 84;
export const MANAGE_GUTTER_WIDE = 118;
export const MANAGE_GUTTER_MAX_SCALE = 1.4;

export function manageGutterWidth(fontScale: number): number {
  const bounded = Math.min(Math.max(Number.isFinite(fontScale) ? fontScale : 1, 1), MANAGE_GUTTER_MAX_SCALE);
  return Math.min(MANAGE_GUTTER_WIDE, Math.ceil(MANAGE_GUTTER * bounded));
}

/**
 * Only items of their own reach this list.
 *
 * Nothing creates a child habit any more (PD-HABIT-006) and the launch sweep
 * removes any that a previous version left, but a database is only swept once it
 * is opened — so the filter stays, and until then a leftover child stays out of
 * the flat list rather than standing in it as an item.
 */
export function isManageRoot(item: PlannerHabitCatalogueItem): boolean {
  return item.ordinaryParentHabitId === null;
}

/**
 * The step chevron counts **subtasks**, and the screen supplies them itself.
 *
 * A child lookup and a step count read from `ordinaryChildCount` used to live
 * here. Both were about the sub-habit; Manage was rewired to checklist lines
 * before that decision and never called either again.
 */
export function manageNeedsSchedule(item: PlannerHabitCatalogueItem): boolean {
  return item.temporalContext.displayConfiguration.needsSchedule;
}

/** Live counts for the three type slots, over whatever the scope chip is showing. */
export function manageTypeCounts(items: readonly PlannerHabitCatalogueItem[]): Readonly<{ all: number; tasks: number; habits: number }> {
  let tasks = 0;
  for (const item of items) if (manageItemKind(item) === 'task') tasks += 1;
  return Object.freeze({ all: items.length, habits: items.length - tasks, tasks });
}

/**
 * The list, in the order it is drawn.
 *
 * `NEEDS A SCHEDULE` comes first and is **pinned rather than filtered**: something
 * broken is repaired, not looked for, so it does not wait behind a chip. It is
 * withheld entirely while the archive is showing, because an archived item has
 * nothing to repair towards.
 *
 * Tasks are then grouped by when they are due and habits are one flat list. There
 * are no category headings and no `ROUTINES` / `SINGLE HABITS`: the six colours
 * lost their names (PD-CATEGORY-004), so a colour cannot be a heading, and a
 * composite habit says so with a chevron and a count on its own row.
 */
export function buildManageSections(input: Readonly<{
  items: readonly PlannerHabitCatalogueItem[];
  typeScope: ManageTypeScope;
  sortOrder: ManageSortOrder;
  today: PlannerLocalDate;
  /** False in the archive, where a missing schedule is not a repair to make. */
  pinNeedsSchedule?: boolean;
}>): readonly ManageSection[] {
  const ordered = sortByCreation(input.items.filter(isManageRoot), input.sortOrder);
  const pinned = (input.pinNeedsSchedule ?? true) ? ordered.filter(manageNeedsSchedule) : [];
  const pinnedIds = new Set(pinned.map(({ habitId }) => habitId));
  const rest = ordered.filter(({ habitId }) => !pinnedIds.has(habitId));
  const tasks = input.typeScope === 'habits' ? [] : rest.filter((item) => manageItemKind(item) === 'task');
  const habits = input.typeScope === 'tasks' ? [] : rest.filter((item) => manageItemKind(item) === 'habit');
  const inBucket = (bucket: ManageDueBucket) =>
    tasks.filter((item) => manageDueBucket(manageTaskDueDate(item), input.today) === bucket);

  return Object.freeze([
    { items: pinned, key: 'needsSchedule' as const, label: 'NEEDS A SCHEDULE' },
    { items: inBucket('overdue'), key: 'overdue' as const, label: 'OVERDUE' },
    { items: inBucket('today'), key: 'today' as const, label: 'TODAY' },
    { items: inBucket('later'), key: 'later' as const, label: 'LATER' },
    { items: habits, key: 'habits' as const, label: 'HABITS' },
  ].filter((section) => section.items.length > 0).map((section) => Object.freeze({ ...section, items: Object.freeze(section.items) })));
}

/**
 * Newest first by default, and the toggle has exactly two states.
 *
 * The sort is stable on the habit id so that two items created in the same
 * millisecond — which a template bundle does produce — keep one fixed order rather
 * than swapping places between renders.
 */
export function sortByCreation(
  items: readonly PlannerHabitCatalogueItem[],
  order: ManageSortOrder,
): readonly PlannerHabitCatalogueItem[] {
  const direction = order === 'newest' ? -1 : 1;
  return Object.freeze([...items].sort((left, right) =>
    (left.createdAt - right.createdAt) * direction || left.habitId.localeCompare(right.habitId)));
}

/** `Newest ⇄ Oldest`, and nothing else — there is no third order and no menu. */
export function nextManageSortOrder(order: ManageSortOrder): ManageSortOrder {
  return order === 'newest' ? 'oldest' : 'newest';
}
