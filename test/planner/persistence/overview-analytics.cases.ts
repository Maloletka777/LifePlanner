import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  type PlannerLocalDate,
} from '../../../src/features/planner/domain';
import {
  createGetPlannerOverviewAnalytics,
  windowKeyForHour,
} from '../../../src/features/planner/application';
import {
  LONDON,
  baseCommand,
  createHarness,
  domainValue,
  scheduleFixture,
  trackingFixture,
  type TestHarness,
} from './test-fixtures';

const AUGUST_3 = date('2026-08-03');
const AUGUST_4 = date('2026-08-04');
const AUGUST_5 = date('2026-08-05');

/**
 * Overview's numbers are aggregation over days the repository already loads. These
 * cases pin the three rules that decide what they *mean*: tasks are not activities,
 * punctuality is same-day, and a back-filled mark is done but not on time.
 */
test('Overview analytics counts activities rather than tasks, and measures punctuality on the day', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());

  const vitamins = await activity(harness, 'Vitamins', '07:00');
  await activity(harness, 'Journal', null);
  // A task is a daily schedule whose active range is a single day, which is what
  // Create writes for `Task`. It must not appear in a single figure below.
  await task(harness, 'Call the bank');

  const recorded = await harness.recordHabitObservation({
    habitId: vitamins.id,
    occurrenceLocalDate: AUGUST_3,
    occurrenceTimezone: LONDON,
    value: { type: 'checkbox', booleanValue: true },
  });
  assert.equal(recorded.ok, true);

  const analytics = createGetPlannerOverviewAnalytics({ unitOfWork: harness.unitOfWork });
  const result = await analytics({
    startDate: AUGUST_3,
    endDate: AUGUST_4,
    evaluationBoundary: AUGUST_5,
    // The mark was written on the day it belongs to, at 06:52 — before its plan.
    localDayOfTimestamp: () => AUGUST_3,
    localMinuteOfTimestamp: () => 6 * 60 + 52,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const third = result.value.days.find((day) => day.localDate === AUGUST_3);
  const fourth = result.value.days.find((day) => day.localDate === AUGUST_4);
  assert.notEqual(third, undefined);
  assert.notEqual(fourth, undefined);
  if (third === undefined || fourth === undefined) return;

  assert.equal(third.scheduled, 2, 'the task is not an activity');
  assert.equal(third.timedScheduled, 1, 'an anytime activity carries no plan');
  assert.equal(third.closed, 1);
  assert.equal(third.onTime, 1);
  assert.equal(third.late, 0);
  assert.equal(third.punctualityMeasured, 1);
  assert.equal(third.fullyClosed, true, 'every activity with a time was closed');

  assert.equal(fourth.closed, 0);
  assert.equal(fourth.fullyClosed, false);
  assert.deepEqual([...fourth.missedNames], ['Vitamins'], 'a day that is over can miss things');

  // Aug 4 broke the run, and Aug 3 is the longest it ever reached.
  assert.equal(result.value.streak.current, 0);
  assert.equal(result.value.streak.longest, 1);
  assert.equal(result.value.streak.breaks[0]?.localDate, AUGUST_4);

  const morning = result.value.windows.find((window) => window.key === 'morning');
  assert.equal(morning?.planned, 2, '07:00 falls in the morning window on both days');
  assert.equal(morning?.closed, 1);

  const vitaminsFact = result.value.activities.find((entry) => entry.name === 'Vitamins');
  assert.equal(vitaminsFact?.scheduledDays, 2);
  assert.equal(vitaminsFact?.closedDays, 1);
  assert.equal(vitaminsFact?.missedDays, 1);
  assert.equal(result.value.activities.some((entry) => entry.name === 'Call the bank'), false);
  assert.equal(result.value.empty, false);
});

test('a day cannot be met after it is over, and the record keeps saying so', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const vitamins = await activity(harness, 'Vitamins', '07:00');
  const recorded = await harness.recordHabitObservation({
    habitId: vitamins.id,
    occurrenceLocalDate: AUGUST_3,
    occurrenceTimezone: LONDON,
    value: { type: 'checkbox', booleanValue: true },
  });
  assert.equal(recorded.ok, true);

  const analytics = createGetPlannerOverviewAnalytics({ unitOfWork: harness.unitOfWork });
  const late = await analytics({
    startDate: AUGUST_3,
    endDate: AUGUST_3,
    evaluationBoundary: AUGUST_5,
    // Yesterday's checkbox, ticked this morning: the day it is about is over, so
    // the mark is remembering rather than doing.
    localDayOfTimestamp: () => AUGUST_4,
    localMinuteOfTimestamp: () => 9 * 60,
  });
  assert.equal(late.ok, true);
  if (!late.ok) return;
  const lateDay = late.value.days[0];
  // The day still draws it closed — that is what happened to the item — but every
  // figure that is about a record keeps it missed, and keeps it missed for good.
  assert.equal(lateDay?.closed, 0);
  assert.equal(lateDay?.fullyClosed, false);
  assert.equal(lateDay?.backFilled, 1);
  assert.equal(lateDay?.punctualityMeasured, 0);
  assert.deepEqual([...(lateDay?.missedNames ?? [])], ['Vitamins']);
  assert.equal(late.value.streak.longest, 0);
  assert.equal(late.value.activities.find((entry) => entry.name === 'Vitamins')?.missedDays, 1);

  // Marked **later the same day** is ordinary: the day was still there to meet.
  const sameDay = await analytics({
    startDate: AUGUST_3,
    endDate: AUGUST_3,
    evaluationBoundary: AUGUST_5,
    localDayOfTimestamp: () => AUGUST_3,
    localMinuteOfTimestamp: () => 21 * 60,
  });
  assert.equal(sameDay.ok, true);
  if (!sameDay.ok) return;
  assert.equal(sameDay.value.days[0]?.closed, 1);
  assert.equal(sameDay.value.days[0]?.fullyClosed, true);
  assert.equal(sameDay.value.days[0]?.late, 1, 'late in the day is late, and still closed');

  // And marked **before** the day is doing it early, which counts as well — there
  // is simply no minute of that day to measure punctuality against.
  const early = await analytics({
    startDate: AUGUST_3,
    endDate: AUGUST_3,
    evaluationBoundary: AUGUST_5,
    localDayOfTimestamp: () => date('2026-08-02'),
    localMinuteOfTimestamp: () => 20 * 60,
  });
  assert.equal(early.ok, true);
  if (!early.ok) return;
  assert.equal(early.value.days[0]?.closed, 1);
  assert.equal(early.value.days[0]?.fullyClosed, true);
  assert.equal(early.value.days[0]?.backFilled, 0, 'early is not late');
  // And early **is** on time: doing tomorrow's work tonight misses nothing, so it
  // is measured rather than skipped. How early is a matter of wording, in days.
  assert.equal(early.value.days[0]?.onTime, 1);
  assert.equal(early.value.days[0]?.punctualityMeasured, 1);
});

/**
 * The repository refuses a range longer than a month — `MAX_MARKER_RANGE_DAYS` is
 * 31 and one request builds a read model per day. Overview asks for four months,
 * so it has to ask in pieces; when it did not, the whole screen came back with an
 * error line and every figure empty, which is exactly what the owner photographed.
 */
test('a range longer than the repository allows is loaded in pieces rather than refused', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  await activity(harness, 'Vitamins', '07:00');

  const analytics = createGetPlannerOverviewAnalytics({ unitOfWork: harness.unitOfWork });
  const result = await analytics({
    startDate: AUGUST_3,
    endDate: date('2026-08-31'),
    evaluationBoundary: date('2026-09-01'),
    localDayOfTimestamp: () => AUGUST_3,
    localMinuteOfTimestamp: () => 6 * 60,
  });
  assert.equal(result.ok, true, 'a 29-day range still fits one request');

  const long = await analytics({
    startDate: date('2026-06-01'),
    endDate: date('2026-08-31'),
    evaluationBoundary: date('2026-09-01'),
    localDayOfTimestamp: () => AUGUST_3,
    localMinuteOfTimestamp: () => 6 * 60,
  });
  assert.equal(long.ok, true, 'and 92 days are asked for in month-sized pieces');
  if (!long.ok) return;
  assert.equal(long.value.days.length, 92, 'every day in the range comes back exactly once');
  assert.deepEqual(
    long.value.days.map((day) => day.localDate).slice(0, 2),
    [date('2026-06-01'), date('2026-06-02')],
    'and they stay in order across the seams',
  );
});

/**
 * Today is not evidence about a record. An activity planned for this evening is
 * not a miss at three in the morning — the owner photographed exactly that, three
 * unfinished items of the current day listed under Slipping.
 */
test('a day that is not over yet counts toward nothing that is about a record', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  await activity(harness, 'Breakfast', '10:00');

  const analytics = createGetPlannerOverviewAnalytics({ unitOfWork: harness.unitOfWork });
  const result = await analytics({
    startDate: AUGUST_3,
    endDate: AUGUST_4,
    // Aug 4 is today: it is still open, whatever the clock says.
    evaluationBoundary: AUGUST_4,
    localDayOfTimestamp: () => AUGUST_3,
    localMinuteOfTimestamp: () => 9 * 60,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const breakfast = result.value.activities.find((entry) => entry.name === 'Breakfast');
  assert.equal(breakfast?.scheduledDays, 1, 'only the third counts; the fourth has not happened');
  assert.equal(breakfast?.missedDays, 1);
  // 10:00 is the middle-of-the-day window, not the morning one.
  const midday = result.value.windows.find((window) => window.key === 'day');
  assert.equal(midday?.planned, 1, 'and the same day is out of the hour windows');

  const fourth = result.value.days.find((day) => day.localDate === AUGUST_4);
  assert.equal(fourth?.scheduled, 1, "but today still reports its own day, which is about now");
  assert.deepEqual([...(fourth?.missedNames ?? [])], [], 'and it has missed nothing yet');
});

test('the four windows are fixed, and the night one wraps midnight', () => {
  assert.equal(windowKeyForHour(6), 'morning');
  assert.equal(windowKeyForHour(9), 'morning');
  assert.equal(windowKeyForHour(10), 'day');
  assert.equal(windowKeyForHour(16), 'day');
  assert.equal(windowKeyForHour(17), 'evening');
  assert.equal(windowKeyForHour(21), 'evening');
  assert.equal(windowKeyForHour(22), 'night');
  assert.equal(windowKeyForHour(2), 'night');
  assert.equal(windowKeyForHour(5), 'night');
});

test('a subtask carries no weight in a single figure on Overview', async (t) => {
  const harness = await createHarness(70_000);
  t.after(() => harness.database.close());

  // One activity with two subtasks, written the way the create sheet writes them:
  // ordinary children with the organisational role, inheriting the item's dates
  // and schedule — so they are scheduled on the same days it is.
  const created = await harness.createHabitBundle({ habits: [
    { parentIndex: null, relationshipMode: 'independent', command: baseCommand({ name: 'Cook dinner', plannedTime: domainValue(parsePlannerLocalTime('18:00')) }) },
    { parentIndex: 0, relationshipMode: 'ordinary', completionRole: 'organizational', command: baseCommand({ name: 'Buy food' }) },
    { parentIndex: 0, relationshipMode: 'ordinary', completionRole: 'organizational', command: baseCommand({ name: 'Wash up' }) },
  ] });
  assert.equal(created.ok, true, JSON.stringify(created));

  const analytics = createGetPlannerOverviewAnalytics({ unitOfWork: harness.unitOfWork });
  const result = await analytics({
    startDate: AUGUST_3,
    endDate: AUGUST_3,
    evaluationBoundary: AUGUST_4,
    localDayOfTimestamp: () => AUGUST_3,
    localMinuteOfTimestamp: () => 9 * 60,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The read model gives an ordinary child a root group of its own, so without a
  // rule all three would be counted — an item with two subtasks reading as three
  // activities. `rootRow` is that rule, and this pins it: a subtask is not an
  // activity, on the day's own figures and in the per-activity ones alike.
  assert.deepEqual(result.value.activities.map((entry) => entry.name), ['Cook dinner']);
  assert.equal(result.value.days[0]?.scheduled, 1);
});

async function activity(harness: TestHarness, name: string, plannedLocalTime: string | null) {
  const result = await harness.createHabit(baseCommand({
    name,
    ...(plannedLocalTime === null ? {} : { plannedTime: domainValue(parsePlannerLocalTime(plannedLocalTime)) }),
  }));
  assert.equal(result.ok, true, `${name} fixture`);
  if (!result.ok) assert.fail('Expected the activity fixture to be created.');
  return result.value;
}

async function task(harness: TestHarness, name: string) {
  const result = await harness.createHabit(baseCommand({
    name,
    activeFrom: AUGUST_3,
    activeTo: AUGUST_4,
    schedule: scheduleFixture('daily', AUGUST_3, AUGUST_4),
    tracking: trackingFixture('checkbox', AUGUST_3, AUGUST_4),
  }));
  assert.equal(result.ok, true, `${name} fixture`);
  if (!result.ok) assert.fail('Expected the task fixture to be created.');
  return result.value;
}

function date(value: string): PlannerLocalDate {
  return domainValue(parsePlannerLocalDate(value));
}
