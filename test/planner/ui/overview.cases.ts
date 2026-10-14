import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlannerLocalDate } from '../../../src/features/planner/domain';
import type { PlannerOverviewDayFact } from '../../../src/features/planner/application';
import {
  OVERVIEW_BEST_HOURS_EMPTY,
  OVERVIEW_SLIPPING_EMPTY,
  formatOverviewHeaderDate,
  overviewActivityCountLine,
  overviewAverageDelta,
  overviewBestWindowLine,
  overviewCountdownText,
  overviewDeltaText,
  overviewStreakFooter,
  overviewStreakLead,
  overviewMeasured,
  overviewVisibleCards,
  selectOverviewPeriod,
  selectOverviewSlips,
  selectOverviewStreakDots,
  selectOverviewToday,
  selectOverviewWindows,
} from '../../../src/features/planner/presentation/overview-model';

/**
 * Overview's arithmetic, asserted where it is computed. The screen prints these
 * results and nothing else, so a rule that holds here holds on the card and inside
 * the opened panel alike.
 */

test('a delta under a day reads in minutes and hours, and from a day in days and months', () => {
  assert.equal(overviewDeltaText(-8), '8 min early');
  assert.equal(overviewDeltaText(12), '12 min late');
  assert.equal(overviewDeltaText(0), 'on time');
  assert.equal(overviewDeltaText(60), '1 h late');
  assert.equal(overviewDeltaText(320), '5 h 20 m late');
  // Never "37 h late": from a day it changes unit, because nobody converts hours.
  assert.equal(overviewDeltaText(24 * 60), '1 day late');
  assert.equal(overviewDeltaText(2 * 24 * 60), '2 days late');
  // **No weeks.** A habit repeats weekly at the outside, so the band covered a
  // range that does not occur, and "3 weeks early" is arithmetic the reader has to
  // redo. Days run to a month; months take over after that.
  assert.equal(overviewDeltaText(21 * 24 * 60), '21 days late');
  assert.equal(overviewDeltaText(30 * 24 * 60), '30 days late');
  assert.equal(overviewDeltaText(-31 * 24 * 60), '1 month early');
  assert.equal(overviewDeltaText(60 * 24 * 60), '2 months late');
  // Closed the evening before something planned for the morning is hours early,
  // not "a day": the distance is what it is, and the wording follows it.
  assert.equal(overviewDeltaText(-11 * 60), '11 h early');
  assert.equal(overviewDeltaText(-2 * 24 * 60), '2 days early');
  assert.equal(overviewCountdownText(250), 'in 4 h 10 m');
  assert.equal(overviewCountdownText(40), 'in 40 min');
});

test('the headline is the mean of the bars beneath it, at every grain', () => {
  const week = selectOverviewPeriod({
    grain: 'week',
    anchor: date('2026-07-29'),
    today: date('2026-07-29'),
    days: [
      day('2026-07-27', 5, 5),
      day('2026-07-28', 5, 4),
      day('2026-07-29', 5, 2),
    ],
  });
  assert.deepEqual(week.bars.map((bar) => bar.percent), [100, 80, 40, null, null, null, null]);
  // 100 + 80 + 40 over the three bars that have a value.
  assert.equal(week.percent, 73);
  assert.equal(week.bars[2]?.current, true, 'today is the unit in progress');
  assert.equal(week.bars[3]?.future, true, 'a unit that has not happened has no fill');
  assert.equal(week.daysCounted, 3);
  assert.equal(week.daysFullyClosed, 1);
  assert.equal(week.plannedPerDay, 5);
  assert.equal(week.closedPerDay, 3.7);
  assert.equal(week.caption, "of this week's activities done");
});

test('a month is bucketed by the calendar weeks inside it, so the first bucket is the partial one', () => {
  const month = selectOverviewPeriod({
    grain: 'month',
    anchor: date('2026-07-15'),
    today: date('2026-07-31'),
    days: [day('2026-07-01', 4, 4), day('2026-07-06', 4, 2), day('2026-07-27', 4, 1)],
  });
  assert.deepEqual(month.bars.map((bar) => bar.label), ['1–5', '6–12', '13–19', '20–26', '27–31']);
  assert.deepEqual(month.bars.map((bar) => bar.percent), [100, 50, null, null, 25]);
  assert.equal(month.percent, 58);
  assert.match(month.caption, /of July done, week by week/);
});

test('a year is twelve months, and the on-time share comes from what was measured', () => {
  const year = selectOverviewPeriod({
    grain: 'year',
    anchor: date('2026-03-02'),
    today: date('2026-03-02'),
    days: [
      { ...day('2026-01-05', 4, 2), onTime: 2, punctualityMeasured: 2 },
      { ...day('2026-02-05', 4, 4), onTime: 1, punctualityMeasured: 4 },
    ],
  });
  assert.equal(year.bars.length, 12);
  assert.deepEqual(year.bars.slice(0, 3).map((bar) => bar.label), ['J', 'F', 'M']);
  assert.deepEqual(year.bars.slice(0, 2).map((bar) => bar.percent), [50, 100]);
  assert.equal(year.onTimePercent, 50, '3 of 6 measured marks landed before their minute');
  assert.equal(year.bars[2]?.current, true);
});

/**
 * The screen keeps its shape from the first day. The brief asked for the opposite
 * — cards appearing once there was enough history — and on a device that read as
 * the dashboards having been removed, so the owner reversed it: every card is
 * always there, and one with nothing to measure says so in a sentence.
 */
test('every card is always on the screen, and an unmeasured one says so', () => {
  assert.deepEqual([...overviewVisibleCards()], ['today', 'streak', 'records', 'best', 'slip']);
  assert.deepEqual(overviewMeasured(null), { best: false, slip: false });
  const thin = analytics([day('2026-07-27', 2, 1)], []);
  assert.deepEqual(overviewMeasured(thin), { best: false, slip: false });
  const rich = analytics(
    Array.from({ length: 10 }, (_, index) => day(`2026-07-${String(index + 10).padStart(2, '0')}`, 3, 2)),
    [{ habitId: 'a', name: 'Vitamins', scheduledDays: 30, closedDays: 27, missedDays: 3 }],
    12,
  );
  assert.deepEqual(overviewMeasured(rich), { best: true, slip: true });
  // The empty state is a sentence about the rule, never a drawn zero.
  assert.match(OVERVIEW_BEST_HOURS_EMPTY, /fills in as days close/);
  assert.match(OVERVIEW_SLIPPING_EMPTY, /scheduled day that ends with nothing recorded/);
});

test('windows rank best first and the footer names the part of the day that carries you', () => {
  const rows = selectOverviewWindows([
    { key: 'morning', label: '06:00–10:00', planned: 44, closed: 38 },
    { key: 'day', label: '10:00–17:00', planned: 64, closed: 41 },
    { key: 'evening', label: '17:00–22:00', planned: 38, closed: 27 },
    { key: 'night', label: '22:00–06:00', planned: 18, closed: 4 },
  ]);
  assert.deepEqual(rows.map((row) => row.key), ['morning', 'evening', 'day', 'night']);
  assert.deepEqual(rows.map((row) => row.percent), [86, 71, 64, 22]);
  assert.equal(overviewBestWindowLine(rows), 'Mornings carry you.');
  // A window nothing was ever planned in is not a window with a 0 % score.
  assert.equal(selectOverviewWindows([{ key: 'night', label: '22:00–06:00', planned: 0, closed: 0 }]).length, 0);
});

test('slipping counts misses, and the panel measures how often each one happens', () => {
  const slips = selectOverviewSlips([
    { habitId: 'a', name: 'Vitamins', scheduledDays: 30, closedDays: 27, missedDays: 3 },
    { habitId: 'b', name: 'Cold shower', scheduledDays: 21, closedDays: 12, missedDays: 9 },
    { habitId: 'c', name: 'Read', scheduledDays: 30, closedDays: 24, missedDays: 6 },
    { habitId: 'd', name: 'Nothing missed', scheduledDays: 10, closedDays: 10, missedDays: 0 },
  ]);
  assert.deepEqual(slips.map((slip) => slip.name), ['Cold shower', 'Read', 'Vitamins']);
  assert.deepEqual(slips.map((slip) => slip.percent), [57, 80, 90]);
  assert.equal(selectOverviewSlips([], 3).length, 0);
});

test('the streak dots run up to today, and today is still open', () => {
  const dots = selectOverviewStreakDots(
    [day('2026-07-26', 2, 2), { ...day('2026-07-27', 2, 1), fullyClosed: false }],
    date('2026-07-27'),
  );
  assert.equal(dots.length, 7);
  assert.equal(dots[dots.length - 1]?.isToday, true);
  assert.equal(dots[dots.length - 2]?.closed, true);
  assert.equal(dots[dots.length - 1]?.closed, false);
  assert.equal(overviewStreakFooter(21), 'Best 21 · timed activities only');
  assert.match(overviewStreakLead(12), /12 days in a row, and today is still open/);
  assert.match(overviewStreakLead(0), /Close everything with a time today/);
});

test("today's readout is facts: planned order, one segment each, and early measured across days", () => {
  const closedDay: Readonly<Record<number, string>> = { 1: '2026-07-27', 2: '2026-07-27', 3: '2026-07-26', 4: '2026-07-29' };
  const closedMinute: Readonly<Record<number, number>> = { 1: 6 * 60 + 52, 2: 10 * 60 + 12, 3: 20 * 60, 4: 9 * 60 };
  const facts = selectOverviewToday({
    rows: [
      { habitId: 'a', name: 'Morning routine', plannedLocalTime: '07:00', done: true, closedAt: 1, isTask: false },
      { habitId: 'b', name: 'Drink water', plannedLocalTime: '10:00', done: true, closedAt: 2, isTask: false },
      { habitId: 'c', name: 'Vitamins', plannedLocalTime: '09:00', done: false, closedAt: null, isTask: false },
      { habitId: 'd', name: 'Workout', plannedLocalTime: '18:30', done: false, closedAt: null, isTask: false },
      { habitId: 'e', name: 'Journal', plannedLocalTime: null, done: false, closedAt: null, isTask: false },
      // Closed the evening before, for something planned at 08:00 this morning.
      { habitId: 'f', name: 'Water the plants', plannedLocalTime: '08:00', done: true, closedAt: 3, isTask: false },
      // Written down two days after the day it is about: remembering, not doing.
      { habitId: 'h', name: 'Stretch', plannedLocalTime: '12:00', done: true, closedAt: 4, isTask: false },
      { habitId: 'g', name: 'Call the bank', plannedLocalTime: '11:00', done: false, closedAt: null, isTask: true },
    ],
    nowMinuteOfDay: 14 * 60 + 20,
    localDayOfTimestamp: (timestamp) => date(closedDay[timestamp] ?? '2026-07-27'),
    localMinuteOfTimestamp: (timestamp) => closedMinute[timestamp] ?? 0,
    today: date('2026-07-27'),
  });
  assert.equal(facts.scheduled, 7, 'the task is not an activity');
  assert.deepEqual(facts.entries.map((entry) => entry.name), [
    'Morning routine', 'Water the plants', 'Vitamins', 'Drink water', 'Stretch', 'Workout', 'Journal',
  ]);
  assert.equal(facts.closed, 4);
  assert.equal(facts.closedBeforePlan, 2);
  assert.equal(facts.closedLate, 1);
  assert.equal(facts.pastDue, 1, 'only Vitamins is open with its time behind it');
  assert.deepEqual([...facts.segments], ['closed', 'closed', 'overdue', 'closed', 'closed', 'left', 'left']);

  // **Early is measured, and the days between are part of the distance.** Closed
  // at 20:00 yesterday for 08:00 today is twelve hours early — not "a day", and
  // not silence.
  const early = facts.entries.find((entry) => entry.name === 'Water the plants');
  assert.equal(early?.backFilled, false);
  assert.equal(early?.deltaMinutes, -12 * 60);
  assert.equal(overviewDeltaText(early?.deltaMinutes ?? 0), '12 h early');

  // **Later is not measured at all**, because a day cannot be met once it is over.
  const late = facts.entries.find((entry) => entry.name === 'Stretch');
  assert.equal(late?.backFilled, true);
  assert.equal(late?.deltaMinutes, null);

  assert.equal(overviewDeltaText(facts.entries[0]?.deltaMinutes ?? 0), '8 min early');
  // −8, −720 and +12 over the three that are measured.
  assert.equal(overviewAverageDelta(facts.entries.filter((entry) => entry.done)), -239);
});

test('the door counts activities in words, and the header names the day', () => {
  assert.equal(overviewActivityCountLine(14), '14 activities · change any schedule, any date');
  assert.equal(overviewActivityCountLine(1), '1 activity · change any schedule, any date');
  assert.match(formatOverviewHeaderDate(date('2026-07-27')), /27/);
});

function day(localDate: string, scheduled: number, closed: number): PlannerOverviewDayFact {
  return {
    localDate: date(localDate),
    scheduled,
    closed,
    timedScheduled: scheduled,
    timedClosed: closed,
    fullyClosed: scheduled > 0 && closed === scheduled,
    onTime: closed,
    late: 0,
    punctualityMeasured: closed,
    backFilled: 0,
    missedNames: [],
  };
}

function analytics(
  days: readonly PlannerOverviewDayFact[],
  activities: readonly Readonly<{ habitId: string; name: string; scheduledDays: number; closedDays: number; missedDays: number }>[],
  plannedInWindows = 0,
) {
  return {
    startDate: days[0]?.localDate ?? date('2026-07-01'),
    endDate: days[days.length - 1]?.localDate ?? date('2026-07-01'),
    days,
    activities,
    windows: [{ key: 'morning' as const, label: '06:00–10:00', planned: plannedInWindows, closed: 0 }],
    hours: [],
    streak: { current: 0, longest: 0, breaks: [] },
    empty: days.length === 0,
  };
}

function date(value: string): PlannerLocalDate {
  return value as PlannerLocalDate;
}
