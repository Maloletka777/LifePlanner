import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlannerLocalDate, parsePlannerLocalTime } from '../../../src/features/planner/domain';
import {
  baseCommand,
  createHarness,
  domainValue,
  scheduleFixture,
  trackingFixture,
} from './test-fixtures';

const JULY_24 = domainValue(parsePlannerLocalDate('2026-07-24'));
const JULY_25 = domainValue(parsePlannerLocalDate('2026-07-25'));
const JULY_31 = domainValue(parsePlannerLocalDate('2026-07-31'));
const AUGUST_1 = domainValue(parsePlannerLocalDate('2026-08-01'));
const AUGUST_25 = domainValue(parsePlannerLocalDate('2026-08-25'));
const EIGHT_PM = domainValue(parsePlannerLocalTime('20:00'));

test('Management and Detail resolve pre-active schedule, time, tracking, and importance at one labelled boundary', async (t) => {
  const harness = await createHarness(134_000);
  t.after(() => harness.database.close());
  const created = await harness.createHabit(baseCommand({
    name: 'Read',
    activeFrom: JULY_25,
    activeTo: AUGUST_25,
    schedule: scheduleFixture('daily', JULY_25, AUGUST_25),
    tracking: trackingFixture('duration', JULY_25, AUGUST_25),
    plannedTime: EIGHT_PM,
  }));
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  const catalogue = await harness.listPlannerHabits({ asOfLocalDate: JULY_24, lifecycle: 'all' });
  const detail = await harness.getPlannerHabitDetail({ habitId: created.value.id, asOfLocalDate: JULY_24 });
  assert.equal(catalogue.ok, true, JSON.stringify(catalogue));
  assert.equal(detail.ok, true, JSON.stringify(detail));
  if (!catalogue.ok || !detail.ok || detail.value === null || catalogue.value[0] === undefined) return;
  const item = catalogue.value[0];
  assert.equal(item.temporalContext.asOfLocalDate, JULY_24);
  assert.equal(item.temporalContext.lifecycleState, 'pre_active');
  assert.equal(item.temporalContext.asOfConfiguration, null);
  assert.equal(item.temporalContext.displayConfigurationTemporalRelation, 'next_effective');
  assert.equal(item.temporalContext.displayConfiguration.effectiveLocalDate, JULY_25);
  assert.equal(item.temporalContext.displayConfiguration.schedule?.definition.scheduleType, 'daily');
  assert.equal(item.temporalContext.displayConfiguration.plannedTime.plannedLocalTime, EIGHT_PM);
  assert.equal(item.temporalContext.displayConfiguration.tracking.definition.trackingMode, 'duration');
  assert.equal(item.temporalContext.displayConfiguration.importance.importance, 'normal');
  assert.equal(item.needsSchedule, false);
  assert.equal(item.plannedLocalTime, EIGHT_PM);
  assert.deepEqual(item.temporalContext, detail.value.temporalContext);
  assert.equal(detail.value.currentSchedule?.definition.scheduleType, 'daily');
  assert.equal(detail.value.currentPlannedTime.plannedLocalTime, EIGHT_PM);

  const beforeStart = await harness.getPlannerOccurrencesForDate({ selectedLocalDate: JULY_24, evaluationBoundary: JULY_24 });
  const onStart = await harness.getPlannerOccurrencesForDate({ selectedLocalDate: JULY_25, evaluationBoundary: JULY_25 });
  assert.equal(beforeStart.ok, true);
  assert.equal(onStart.ok, true);
  if (beforeStart.ok && onStart.ok) {
    assert.equal(beforeStart.value.rootGroups.length, 0);
    assert.equal(onStart.value.rootGroups.length, 1);
    assert.equal(onStart.value.rootGroups[0]?.rows[0]?.plannedLocalTime, EIGHT_PM);
  }
});

test('later edits expose separate next-effective facts and never replace the earlier as-of snapshot', async (t) => {
  const harness = await createHarness(135_000);
  t.after(() => harness.database.close());
  const created = await harness.createHabit(baseCommand({
    name: 'As-of matrix',
    activeFrom: JULY_25,
    activeTo: AUGUST_25,
    schedule: scheduleFixture('daily', JULY_25, AUGUST_25),
    tracking: trackingFixture('checkbox', JULY_25, AUGUST_25),
    plannedTime: EIGHT_PM,
  }));
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  const edited = await harness.editHabit({
    habitId: created.value.id,
    currentLocalDate: JULY_25,
    effectiveLocalDate: AUGUST_1,
    name: 'As-of matrix',
    description: null,
    schedule: scheduleFixture('weekly', JULY_25, AUGUST_25),
    tracking: trackingFixture('checkbox', JULY_25, AUGUST_25),
    importance: 'normal',
    plannedLocalTime: '21:00',
  });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  const beforeBoundary = await harness.getPlannerHabitDetail({ habitId: created.value.id, asOfLocalDate: JULY_31 });
  const onBoundary = await harness.getPlannerHabitDetail({ habitId: created.value.id, asOfLocalDate: AUGUST_1 });
  assert.equal(beforeBoundary.ok, true, JSON.stringify(beforeBoundary));
  assert.equal(onBoundary.ok, true, JSON.stringify(onBoundary));
  if (!beforeBoundary.ok || beforeBoundary.value === null || !onBoundary.ok || onBoundary.value === null) return;
  assert.equal(beforeBoundary.value.temporalContext.asOfConfiguration?.schedule?.definition.scheduleType, 'daily');
  assert.equal(beforeBoundary.value.temporalContext.asOfConfiguration?.plannedTime.plannedLocalTime, EIGHT_PM);
  assert.equal(beforeBoundary.value.temporalContext.nextEffectiveConfiguration?.effectiveLocalDate, AUGUST_1);
  assert.equal(beforeBoundary.value.temporalContext.nextEffectiveConfiguration?.schedule?.definition.scheduleType, 'weekly');
  assert.equal(beforeBoundary.value.temporalContext.nextEffectiveConfiguration?.plannedTime.plannedLocalTime, '21:00');
  assert.equal(beforeBoundary.value.currentSchedule?.definition.scheduleType, 'daily');
  assert.equal(beforeBoundary.value.currentPlannedTime.plannedLocalTime, EIGHT_PM);
  assert.equal(onBoundary.value.temporalContext.asOfConfiguration?.schedule?.definition.scheduleType, 'weekly');
  assert.equal(onBoundary.value.temporalContext.asOfConfiguration?.plannedTime.plannedLocalTime, '21:00');
  assert.equal(onBoundary.value.currentSchedule?.definition.scheduleType, 'weekly');
  assert.equal(onBoundary.value.currentPlannedTime.plannedLocalTime, '21:00');
});
