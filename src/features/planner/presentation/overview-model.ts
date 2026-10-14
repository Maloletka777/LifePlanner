import type {
  PlannerLocalDate,
  PlannerOverviewActivityFact,
  PlannerOverviewAnalytics,
  PlannerOverviewDayFact,
  PlannerOverviewWindowFact,
} from '@/src/features/planner';

import { movePlannerDate, plannerLocalDateFromDate, plannerLocalDateToDate } from './ui-adapters';

/**
 * Overview's arithmetic and its wording, from `design_handoff_overview_records`.
 *
 * Everything a card or a panel prints is derived here, for one reason the brief
 * states outright: *the headline percentage always equals the mean of the bars
 * beneath it*, and *a day's headline counts everything closed, early or late — the
 * same rule the week bar above it uses*. Two surfaces computing the same number
 * two ways is how a screen starts lying, so they compute it once, here.
 *
 * The module is React-free, so every rule below is asserted as behaviour.
 */

export type OverviewGrain = 'week' | 'month' | 'year';

export const OVERVIEW_GRAINS: readonly OverviewGrain[] = Object.freeze(['week', 'month', 'year']);
export const OVERVIEW_GRAIN_LABELS: Readonly<Record<OverviewGrain, string>> = Object.freeze({
  week: 'Week',
  month: 'Month',
  year: 'Year',
});

export interface OverviewBar {
  readonly key: string;
  /** `M`, `1–5`, `J` — the short form under the bar. */
  readonly label: string;
  /** `Mon`, `1–5 Jul`, `January` — the full form the opened panel uses. */
  readonly longLabel: string;
  /** Null when nothing was scheduled in that unit: an outline and an em dash. */
  readonly percent: number | null;
  readonly closed: number;
  readonly scheduled: number;
  /** The unit the day being viewed falls in: drawn softer, and never a door backwards. */
  readonly current: boolean;
  /** A unit that has not happened yet carries no fill at all. */
  readonly future: boolean;
  /** The days this bar stands for, so a drill has something to open. */
  readonly days: readonly PlannerOverviewDayFact[];
}

export interface OverviewPeriod {
  readonly grain: OverviewGrain;
  readonly startDate: PlannerLocalDate;
  readonly endDate: PlannerLocalDate;
  readonly bars: readonly OverviewBar[];
  /** The mean of the bars that have a value — the headline, by construction. */
  readonly percent: number;
  readonly caption: string;
  readonly daysFullyClosed: number;
  readonly daysCounted: number;
  readonly onTimePercent: number | null;
  readonly plannedPerDay: number;
  readonly closedPerDay: number;
}

const MONTH_NAMES = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);
const MONTH_INITIALS = Object.freeze(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']);
const WEEKDAY_INITIALS = Object.freeze(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
const WEEKDAY_NAMES = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

export function overviewWeekStart(date: PlannerLocalDate): PlannerLocalDate {
  const weekday = (plannerLocalDateToDate(date).getDay() + 6) % 7;
  return movePlannerDate(date, -weekday);
}

export function overviewPeriodRange(grain: OverviewGrain, anchor: PlannerLocalDate): Readonly<{
  startDate: PlannerLocalDate;
  endDate: PlannerLocalDate;
}> {
  const date = plannerLocalDateToDate(anchor);
  if (grain === 'week') {
    const start = overviewWeekStart(anchor);
    return Object.freeze({ startDate: start, endDate: movePlannerDate(start, 6) });
  }
  if (grain === 'month') {
    return Object.freeze({
      startDate: plannerLocalDateFromDate(new Date(date.getFullYear(), date.getMonth(), 1, 12)),
      endDate: plannerLocalDateFromDate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)),
    });
  }
  return Object.freeze({
    startDate: plannerLocalDateFromDate(new Date(date.getFullYear(), 0, 1, 12)),
    endDate: plannerLocalDateFromDate(new Date(date.getFullYear(), 11, 31, 12)),
  });
}

/**
 * One component for all three grains: the bars differ only in how the days are
 * bucketed. The month was first drawn as a 31-cell heatmap and replaced, because
 * "how productive was I" is a number rather than a tint.
 */
export function selectOverviewPeriod(input: Readonly<{
  grain: OverviewGrain;
  anchor: PlannerLocalDate;
  today: PlannerLocalDate;
  days: readonly PlannerOverviewDayFact[];
}>): OverviewPeriod {
  const range = overviewPeriodRange(input.grain, input.anchor);
  const within = input.days.filter((day) => day.localDate >= range.startDate && day.localDate <= range.endDate);
  const buckets = input.grain === 'week'
    ? weekBuckets(range.startDate, within)
    : input.grain === 'month'
      ? monthBuckets(range.startDate, range.endDate, within)
      : yearBuckets(range.startDate, within);

  const bars = buckets.map((bucket) => {
    const scheduled = bucket.days.reduce((total, day) => total + day.scheduled, 0);
    const closed = bucket.days.reduce((total, day) => total + day.closed, 0);
    const containsToday = bucket.days.some((day) => day.localDate === input.today)
      || (bucket.startDate <= input.today && bucket.endDate >= input.today);
    return Object.freeze({
      key: bucket.key,
      label: bucket.label,
      longLabel: bucket.longLabel,
      percent: scheduled === 0 ? null : Math.round((closed / scheduled) * 100),
      closed,
      scheduled,
      current: containsToday,
      future: bucket.startDate > input.today,
      days: Object.freeze(bucket.days),
    });
  });

  const measured = bars.filter((bar) => bar.percent !== null);
  const counted = within.filter((day) => day.scheduled > 0 && day.localDate <= input.today);
  const punctualityMeasured = within.reduce((total, day) => total + day.punctualityMeasured, 0);
  const onTime = within.reduce((total, day) => total + day.onTime, 0);
  const elapsed = Math.max(1, counted.length);
  return Object.freeze({
    grain: input.grain,
    startDate: range.startDate,
    endDate: range.endDate,
    bars: Object.freeze(bars),
    // The headline is the mean of the bars, not a separate sum: the brief refuses
    // a screen whose total disagrees with the shapes under it.
    percent: measured.length === 0
      ? 0
      : Math.round(measured.reduce((total, bar) => total + (bar.percent ?? 0), 0) / measured.length),
    caption: periodCaption(input.grain, range.startDate),
    daysFullyClosed: counted.filter((day) => day.fullyClosed).length,
    daysCounted: counted.length,
    onTimePercent: punctualityMeasured === 0 ? null : Math.round((onTime / punctualityMeasured) * 100),
    plannedPerDay: round1(counted.reduce((total, day) => total + day.scheduled, 0) / elapsed),
    closedPerDay: round1(counted.reduce((total, day) => total + day.closed, 0) / elapsed),
  });
}

function periodCaption(grain: OverviewGrain, start: PlannerLocalDate): string {
  const date = plannerLocalDateToDate(start);
  if (grain === 'week') return "of this week's activities done";
  if (grain === 'month') return `of ${MONTH_NAMES[date.getMonth()]} done, week by week`;
  return `of everything planned in ${date.getFullYear()} done`;
}

interface Bucket {
  readonly key: string;
  readonly label: string;
  readonly longLabel: string;
  readonly startDate: PlannerLocalDate;
  readonly endDate: PlannerLocalDate;
  readonly days: readonly PlannerOverviewDayFact[];
}

function weekBuckets(weekStart: PlannerLocalDate, days: readonly PlannerOverviewDayFact[]): readonly Bucket[] {
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => {
    const date = movePlannerDate(weekStart, offset);
    return Object.freeze({
      key: date,
      label: WEEKDAY_INITIALS[offset],
      longLabel: WEEKDAY_NAMES[offset],
      startDate: date,
      endDate: date,
      days: days.filter((day) => day.localDate === date),
    });
  });
}

/** Calendar weeks inside the month, so the first bucket is the partial one. */
function monthBuckets(
  monthStart: PlannerLocalDate,
  monthEnd: PlannerLocalDate,
  days: readonly PlannerOverviewDayFact[],
): readonly Bucket[] {
  const buckets: Bucket[] = [];
  let cursor = monthStart;
  while (cursor <= monthEnd) {
    const weekEnd = movePlannerDate(overviewWeekStart(cursor), 6);
    const end = weekEnd > monthEnd ? monthEnd : weekEnd;
    const firstDay = Number(cursor.slice(8, 10));
    const lastDay = Number(end.slice(8, 10));
    buckets.push(Object.freeze({
      key: cursor,
      label: `${firstDay}–${lastDay}`,
      longLabel: `${firstDay}–${lastDay} ${MONTH_NAMES[plannerLocalDateToDate(cursor).getMonth()].slice(0, 3)}`,
      startDate: cursor,
      endDate: end,
      days: days.filter((day) => day.localDate >= cursor && day.localDate <= end),
    }));
    cursor = movePlannerDate(end, 1);
  }
  return Object.freeze(buckets);
}

function yearBuckets(yearStart: PlannerLocalDate, days: readonly PlannerOverviewDayFact[]): readonly Bucket[] {
  const year = plannerLocalDateToDate(yearStart).getFullYear();
  return Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((month) => {
    const start = plannerLocalDateFromDate(new Date(year, month, 1, 12));
    const end = plannerLocalDateFromDate(new Date(year, month + 1, 0, 12));
    return Object.freeze({
      key: start,
      label: MONTH_INITIALS[month],
      longLabel: MONTH_NAMES[month],
      startDate: start,
      endDate: end,
      days: days.filter((day) => day.localDate >= start && day.localDate <= end),
    });
  }));
}

/**
 * The one definition of punctuality, in words.
 *
 * Under a day it reads in minutes and hours; from a day it reads in days, and past
 * a month in months. Never in hours beyond a day, because "37 h late" is a number
 * nobody converts.
 *
 * **Weeks are gone.** A habit repeats weekly at the outside, so nothing is ever
 * closed weeks before it — the band existed for a range that does not occur, and
 * "3 weeks early" is arithmetic a reader has to do in their head anyway. Days run
 * all the way to a month, which is as far as this can plausibly go, and months
 * take over after that.
 */
export const OVERVIEW_DELTA_DAY_LIMIT = 30;

export function overviewDeltaText(minutes: number): string {
  const magnitude = Math.abs(Math.round(minutes));
  const suffix = minutes < 0 ? 'early' : 'late';
  if (magnitude === 0) return 'on time';
  if (magnitude < 60) return `${magnitude} min ${suffix}`;
  if (magnitude < 24 * 60) {
    const hours = Math.floor(magnitude / 60);
    const rest = magnitude % 60;
    return rest === 0 ? `${hours} h ${suffix}` : `${hours} h ${rest} m ${suffix}`;
  }
  const days = Math.floor(magnitude / (24 * 60));
  if (days <= OVERVIEW_DELTA_DAY_LIMIT) return `${days} ${days === 1 ? 'day' : 'days'} ${suffix}`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ${suffix}`;
}

/** How long until something planned comes due, for a row that is still open. */
export function overviewCountdownText(minutesAhead: number): string {
  const magnitude = Math.max(0, Math.round(minutesAhead));
  if (magnitude < 60) return `in ${magnitude} min`;
  const hours = Math.floor(magnitude / 60);
  const rest = magnitude % 60;
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} m`;
}

export type OverviewCardId = 'today' | 'streak' | 'records' | 'best' | 'slip';

/**
 * Every card is always on the screen, and an unmeasured one says so.
 *
 * The brief asked for the opposite — cards appearing on their own once there was
 * enough history, with a line underneath explaining the absence — and on a device
 * that read as the dashboards having been taken away. The owner's decision stands:
 * the screen keeps its shape from the first day, and a card with nothing to
 * measure states that in a sentence instead of drawing bars from no data. It is
 * still never a fabricated figure — the difference is between an empty card and an
 * absent one.
 */
export function overviewVisibleCards(): readonly OverviewCardId[] {
  return OVERVIEW_CARDS;
}

const OVERVIEW_CARDS: readonly OverviewCardId[] = Object.freeze(['today', 'streak', 'records', 'best', 'slip']);

/** Which of the two history cards actually have something to draw. */
export function overviewMeasured(analytics: PlannerOverviewAnalytics | null): Readonly<{ best: boolean; slip: boolean }> {
  if (analytics === null) return Object.freeze({ best: false, slip: false });
  return Object.freeze({
    best: analytics.windows.some((window) => window.planned > 0),
    slip: analytics.activities.some((activity) => activity.missedDays > 0),
  });
}

export const OVERVIEW_BEST_HOURS_EMPTY =
  'Nothing with a planned time has come due yet. This fills in as days close.';
export const OVERVIEW_SLIPPING_EMPTY =
  'Nothing has been missed yet. A miss is a scheduled day that ends with nothing recorded.';

export interface OverviewWindowRow {
  readonly key: string;
  readonly label: string;
  readonly percent: number;
  readonly closed: number;
  readonly planned: number;
}

/** Ranked best first, which is what makes the footer line true. */
export function selectOverviewWindows(windows: readonly PlannerOverviewWindowFact[]): readonly OverviewWindowRow[] {
  return Object.freeze(windows
    .filter((window) => window.planned > 0)
    .map((window) => Object.freeze({
      key: window.key,
      label: window.label,
      percent: Math.round((window.closed / window.planned) * 100),
      closed: window.closed,
      planned: window.planned,
    }))
    .sort((left, right) => right.percent - left.percent));
}

/** The footer under Best hours states which part of the day carries the person. */
export function overviewBestWindowLine(rows: readonly OverviewWindowRow[]): string {
  const best = rows[0];
  if (best === undefined) return '';
  if (best.key === 'morning') return 'Mornings carry you.';
  if (best.key === 'day') return 'The middle of the day carries you.';
  if (best.key === 'evening') return 'Evenings carry you.';
  return 'The small hours carry you.';
}

export interface OverviewSlipRow {
  readonly habitId: string;
  readonly name: string;
  readonly missedDays: number;
  readonly scheduledDays: number;
  readonly closedDays: number;
  readonly percent: number;
}

/**
 * Counts on the card, completion shares in the panel.
 *
 * A percentage on the card would have to be a *miss* rate, and a short bar reading
 * "10 %" is read as "you only did 10 %" — so the card counts misses and the panel
 * draws how often each one actually happens, where a long bar is good.
 */
export function selectOverviewSlips(
  activities: readonly PlannerOverviewActivityFact[],
  limit = Number.MAX_SAFE_INTEGER,
): readonly OverviewSlipRow[] {
  return Object.freeze(activities
    .filter((activity) => activity.missedDays > 0)
    .slice()
    .sort((left, right) => right.missedDays - left.missedDays || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map((activity) => Object.freeze({
      habitId: activity.habitId,
      name: activity.name,
      missedDays: activity.missedDays,
      scheduledDays: activity.scheduledDays,
      closedDays: activity.closedDays,
      percent: activity.scheduledDays === 0 ? 0 : Math.round((activity.closedDays / activity.scheduledDays) * 100),
    })));
}

export interface OverviewStreakDot {
  readonly localDate: PlannerLocalDate;
  readonly closed: boolean;
  readonly isToday: boolean;
}

/** The seven dots under the streak figure: the week that led to today. */
export function selectOverviewStreakDots(
  days: readonly PlannerOverviewDayFact[],
  today: PlannerLocalDate,
  count = 7,
): readonly OverviewStreakDot[] {
  const byDate = new Map(days.map((day) => [day.localDate, day] as const));
  return Object.freeze([...Array(count).keys()].map((index) => {
    const date = movePlannerDate(today, index - (count - 1));
    return Object.freeze({
      localDate: date,
      closed: byDate.get(date)?.fullyClosed ?? false,
      isToday: date === today,
    });
  }));
}

export function overviewStreakFooter(longest: number): string {
  return `Best ${longest} · timed activities only`;
}

export function overviewStreakLead(current: number): string {
  return current === 0
    ? 'Close everything with a time today to start it'
    : `${current} ${current === 1 ? 'day' : 'days'} in a row, and today is still open`;
}

export interface OverviewTodayEntry {
  readonly habitId: string;
  readonly name: string;
  readonly plannedLocalTime: string | null;
  readonly plannedMinute: number | null;
  readonly done: boolean;
  /** Minutes between the planned minute and the minute it was actually closed. */
  readonly deltaMinutes: number | null;
  /** Closed on another day than the one it belongs to: done, but not punctual. */
  readonly backFilled: boolean;
  readonly closedLocalTime: string | null;
}

export interface OverviewToday {
  readonly scheduled: number;
  readonly closed: number;
  readonly closedBeforePlan: number;
  readonly closedLate: number;
  /** Still open with their time behind them. */
  readonly pastDue: number;
  readonly entries: readonly OverviewTodayEntry[];
  /** In planned order — one segment per activity, which is what the ring cannot say. */
  readonly segments: readonly ('closed' | 'overdue' | 'left')[];
}

/**
 * Today, as facts rather than as a second journal.
 *
 * The panel this feeds was first drawn as a repeat of the journal's rows and then
 * as a ±60-minute deviation axis; both were rejected — the first duplicated Today,
 * the second had to be decoded. What survives is a plain readout: what was closed,
 * when it was planned, when it was actually closed.
 */
export function selectOverviewToday(input: Readonly<{
  rows: readonly Readonly<{
    habitId: string;
    name: string;
    plannedLocalTime: string | null;
    done: boolean;
    closedAt: number | null;
    isTask: boolean;
  }>[];
  nowMinuteOfDay: number;
  localDayOfTimestamp: (timestamp: number) => PlannerLocalDate;
  localMinuteOfTimestamp: (timestamp: number) => number;
  today: PlannerLocalDate;
}>): OverviewToday {
  const entries = input.rows
    .filter((row) => !row.isTask)
    .map<OverviewTodayEntry>((row) => {
      const plannedMinute = minuteOfLocalTime(row.plannedLocalTime);
      const closedDay = row.done && row.closedAt !== null ? input.localDayOfTimestamp(row.closedAt) : null;
      // Written down after the day is remembering, not doing, and carries no
      // measure. Written down **before** it is doing it early, and that is
      // measured like anything else — the days between simply become part of the
      // distance, so the same wording answers "11 h early" and "2 days early".
      const backFilled = closedDay !== null && closedDay > input.today;
      const closedMinute = closedDay === null || backFilled || row.closedAt === null
        ? null
        : input.localMinuteOfTimestamp(row.closedAt);
      const dayOffset = closedDay === null ? 0 : overviewDaysBetween(input.today, closedDay);
      return Object.freeze({
        habitId: row.habitId,
        name: row.name,
        plannedLocalTime: row.plannedLocalTime,
        plannedMinute,
        done: row.done,
        deltaMinutes: closedMinute === null || plannedMinute === null
          ? null
          : dayOffset * 24 * 60 + closedMinute - plannedMinute,
        backFilled,
        closedLocalTime: closedMinute === null ? null : localTimeOfMinute(closedMinute),
      });
    })
    .sort(byPlannedMinute);
  const pastDue = entries.filter((entry) => !entry.done && entry.plannedMinute !== null && entry.plannedMinute < input.nowMinuteOfDay);
  return Object.freeze({
    scheduled: entries.length,
    closed: entries.filter((entry) => entry.done).length,
    closedBeforePlan: entries.filter((entry) => entry.deltaMinutes !== null && entry.deltaMinutes <= 0).length,
    closedLate: entries.filter((entry) => entry.deltaMinutes !== null && entry.deltaMinutes > 0).length,
    pastDue: pastDue.length,
    entries: Object.freeze(entries),
    segments: Object.freeze(entries.map((entry) => entry.done
      ? 'closed' as const
      : entry.plannedMinute !== null && entry.plannedMinute < input.nowMinuteOfDay ? 'overdue' as const : 'left' as const)),
  });
}

/** Whole days from one local date to another, signed: before is negative. */
function overviewDaysBetween(from: PlannerLocalDate, to: PlannerLocalDate): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((plannerLocalDateToDate(to).getTime() - plannerLocalDateToDate(from).getTime()) / day);
}

/** Anytime activities sort last: they carry no plan, so they cannot be early or late. */
function byPlannedMinute(left: OverviewTodayEntry, right: OverviewTodayEntry): number {
  if (left.plannedMinute === null && right.plannedMinute === null) return left.name.localeCompare(right.name);
  if (left.plannedMinute === null) return 1;
  if (right.plannedMinute === null) return -1;
  return left.plannedMinute - right.plannedMinute;
}

export function overviewAverageDelta(entries: readonly OverviewTodayEntry[]): number | null {
  const deltas = entries.map((entry) => entry.deltaMinutes).filter((delta): delta is number => delta !== null);
  if (deltas.length === 0) return null;
  return Math.round(deltas.reduce((total, delta) => total + delta, 0) / deltas.length);
}

function minuteOfLocalTime(localTime: string | null): number | null {
  if (localTime === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) return null;
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3, 5));
}

function localTimeOfMinute(minuteOfDay: number): string {
  const bounded = Math.max(0, Math.min(24 * 60 - 1, Math.round(minuteOfDay)));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

export function formatOverviewHeaderDate(date: PlannerLocalDate): string {
  const parsed = plannerLocalDateToDate(date);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', weekday: 'long' }).format(parsed);
}

export function overviewActivityCountLine(count: number): string {
  return `${count} ${count === 1 ? 'activity' : 'activities'} · change any schedule, any date`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
