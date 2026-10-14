import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlannerLocalDate } from '../../../src/features/planner/domain';

import { createHarness, baseCommand, scheduleFixture, ACTIVE_FROM, ACTIVE_TO, LONDON, REMINDER_TIME, domainValue, tableCount } from './test-fixtures';

const WEEKLY_OCCURRENCE = domainValue(parsePlannerLocalDate('2026-08-05'));

test('Planner management lists every habit with normalized search, lifecycle filters, and stable sorting', async () => {
  const harness = await createHarness();
  try {
    const zebra = await harness.createHabit(baseCommand({ name: 'Zebra' })); assert.equal(zebra.ok, true);
    const alpha = await harness.createHabit(baseCommand({ name: 'Álpha' })); assert.equal(alpha.ok, true);
    if (!alpha.ok) return;
    const archivedAlpha = await harness.archiveHabit({ habitId: alpha.value.id, effectiveLocalDate: ACTIVE_FROM, boundaryTimezone: LONDON });
    assert.equal(archivedAlpha.ok, true, JSON.stringify(archivedAlpha));
    const all = await harness.listPlannerHabits({ searchText: '', lifecycle: 'all', sort: 'management_default', asOfLocalDate: ACTIVE_FROM });
    assert.equal(all.ok, true);
    if (all.ok) assert.deepEqual(all.value.map(({ name }) => name), ['Zebra', 'Álpha']);
    const search = await harness.listPlannerHabits({ searchText: '  ZEB  ', lifecycle: 'all', asOfLocalDate: ACTIVE_FROM });
    assert.equal(search.ok, true); if (search.ok) assert.deepEqual(search.value.map(({ name }) => name), ['Zebra']);
    const archived = await harness.listPlannerHabits({ lifecycle: 'archived', asOfLocalDate: ACTIVE_FROM });
    assert.equal(archived.ok, true); if (archived.ok) assert.deepEqual(archived.value.map(({ name }) => name), ['Álpha']);
    const active = await harness.listPlannerHabits({ lifecycle: 'active', asOfLocalDate: ACTIVE_FROM });
    assert.equal(active.ok, true); if (active.ok) assert.deepEqual(active.value.map(({ name }) => name), ['Zebra']);
  } finally { harness.database.close(); }
});

test('the catalogue carries the reminder a habit was created with, and null for none', async () => {
  // The journal draws a ring around the node of anything set to wake you, and it
  // reads that from the catalogue it already loads. `loadManagementData` has always
  // read `habit_reminders` for the detail model, so this is the same rows exposed
  // one level out: no table, column, migration, command or query changed.
  const harness = await createHarness();
  try {
    const reminded = await harness.createHabit(baseCommand({
      name: 'Reminded',
      reminder: { triggerLocalTime: REMINDER_TIME, timezoneMode: 'schedule_timezone', timezoneId: null },
    }));
    assert.equal(reminded.ok, true);
    const silent = await harness.createHabit(baseCommand({ name: 'Silent', reminder: null }));
    assert.equal(silent.ok, true);
    const list = await harness.listPlannerHabits({ searchText: '', lifecycle: 'all', asOfLocalDate: ACTIVE_FROM });
    assert.equal(list.ok, true);
    if (!list.ok) return;
    assert.equal(list.value.find(({ name }) => name === 'Reminded')?.reminderLocalTime, '18:00');
    assert.equal(list.value.find(({ name }) => name === 'Silent')?.reminderLocalTime, null);
  } finally { harness.database.close(); }
});

test('Planner management includes inherited dependents and complete read-only detail', async () => {
  const harness = await createHarness();
  try {
    const parent = await harness.createHabit(baseCommand({ name: 'Parent', schedule: scheduleFixture('weekly') })); assert.equal(parent.ok, true); if (!parent.ok) return;
    const linked = await harness.addHabitDependency({ parentHabitId: parent.value.id, dependentSource: 'new', dependencyType: 'follow_up', effectiveFrom: ACTIVE_FROM, effectiveTo: ACTIVE_TO, dependent: { name: 'Dependent', description: null, categoryId: null, tracking: baseCommand().tracking, importance: 'high', reminder: null } });
    assert.equal(linked.ok, true); if (!linked.ok) return;
    const list = await harness.listPlannerHabits({ searchText: '', lifecycle: 'all', sort: 'management_default', asOfLocalDate: ACTIVE_FROM });
    assert.equal(list.ok, true);
    if (list.ok) {
      assert.deepEqual(list.value.map(({ habitId }) => habitId).sort(), [parent.value.id, linked.value.dependent.id].sort());
      const root = list.value.find(({ habitId }) => habitId === parent.value.id);
      const dependent = list.value.find(({ habitId }) => habitId === linked.value.dependent.id);
      assert.equal(root?.inheritsOccurrence, false);
      assert.equal(root?.schedule?.definition.scheduleType, 'weekly');
      assert.equal(dependent?.inheritsOccurrence, true);
      assert.equal(dependent?.schedule, null);
    }
    const rootDetail = await harness.getPlannerHabitDetail({ habitId: parent.value.id, asOfLocalDate: ACTIVE_FROM });
    assert.equal(rootDetail.ok, true);
    if (rootDetail.ok && rootDetail.value !== null) {
      assert.equal(rootDetail.value.habit.id, parent.value.id);
      assert.equal(rootDetail.value.inheritsOccurrence, false);
    }
    const parentObservation = await harness.recordHabitObservation({
      habitId: parent.value.id,
      occurrenceLocalDate: WEEKLY_OCCURRENCE,
      occurrenceTimezone: LONDON,
      value: { type: 'checkbox', booleanValue: true },
    });
    assert.equal(parentObservation.ok, true);
    const detail = await harness.getPlannerHabitDetail({ habitId: linked.value.dependent.id, asOfLocalDate: ACTIVE_FROM });
    assert.equal(detail.ok, true); if (detail.ok && detail.value !== null) { assert.equal(detail.value.habit.id, linked.value.dependent.id); assert.equal(detail.value.inheritsOccurrence, true); assert.equal(detail.value.trackingHistory.length, 1); assert.equal(detail.value.importanceHistory.length, 1); assert.equal(detail.value.dependencyHistory.length, 1); assert.equal(detail.value.incomingDependencies[0]?.parentName, 'Parent'); assert.equal(detail.value.observationHistory.length, 0); }
    const parentAfterObservation = await harness.getPlannerHabitDetail({ habitId: parent.value.id, asOfLocalDate: ACTIVE_FROM });
    assert.equal(parentAfterObservation.ok, true);
    if (parentAfterObservation.ok) assert.equal(parentAfterObservation.value?.observationHistory.length, 1);
    const missing = await harness.getPlannerHabitDetail({ habitId: '00000000-0000-4000-8000-999999999999', asOfLocalDate: ACTIVE_FROM });
    assert.deepEqual(missing, { ok: true, value: null });
  } finally { harness.database.close(); }
});

test('Planner management reads do not mutate canonical row counts', async () => {
  const harness = await createHarness();
  try {
    const created = await harness.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
    const before = await tableCount(harness.database, 'habits');
    await harness.listPlannerHabits({ lifecycle: 'all', asOfLocalDate: ACTIVE_FROM });
    await harness.getPlannerHabitDetail({ habitId: created.value.id, asOfLocalDate: ACTIVE_FROM });
    assert.equal(await tableCount(harness.database, 'habits'), before);
    assert.equal(await tableCount(harness.database, 'habit_observations'), 0);
  } finally { harness.database.close(); }
});

test('Planner management fails safely for overlapping current configuration', async () => {
  const harness = await createHarness();
  try {
    const created = await harness.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
    await harness.database.runAsync(`INSERT INTO habit_importance_versions (id, habit_id, version_number, importance_level, weight, effective_from, effective_to, created_at, updated_at) VALUES ('00000000-0000-4000-8000-999999999998', $habitId, 2, 'high', 3, '2026-08-02', $to, 1789000000002, 1789000000002);`, { $habitId: created.value.id, $to: ACTIVE_TO });
    const detail = await harness.getPlannerHabitDetail({ habitId: created.value.id, asOfLocalDate: '2026-08-02' });
    assert.equal(detail.ok, false);
    assert.equal(await tableCount(harness.database, 'habit_importance_versions'), 2);
  } finally { harness.database.close(); }
});

test('empty Planner management catalogue is explicit and deterministic', async () => {
  const harness = await createHarness();
  try { const result = await harness.listPlannerHabits({ lifecycle: 'all', asOfLocalDate: ACTIVE_FROM }); assert.deepEqual(result, { ok: true, value: [] }); }
  finally { harness.database.close(); }
});

test('Planner management identifies an active root without an applicable schedule', async () => {
  const harness = await createHarness(91_000);
  try {
    const created = await harness.createHabit(baseCommand({ name: 'Needs schedule' }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await harness.database.runAsync(
      `UPDATE habit_schedule_versions SET effective_from = $futureDate
       WHERE habit_id = $habitId;`,
      { $futureDate: '2026-08-15', $habitId: created.value.id },
    );
    const result = await harness.listPlannerHabits({ lifecycle: 'active', asOfLocalDate: ACTIVE_FROM });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value[0]?.needsSchedule, true);
  } finally { harness.database.close(); }
});
