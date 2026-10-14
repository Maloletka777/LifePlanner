import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlannerLocalTime } from '../../../src/features/planner/domain';
import { ACTIVE_FROM, ACTIVE_TO, LONDON, baseCommand, createHarness, domainValue, scheduleFixture, tableCount } from './test-fixtures';

const TOMORROW = '2026-08-02';
const DAY_THREE = '2026-08-03';

test('ordinary sub-habits attach, reparent, and detach without changing independent schedules', async (t) => {
  const h = await createHarness(60_000); t.after(() => h.database.close());
  const parent = await h.createHabit(baseCommand({ name: 'Morning routine', schedule: scheduleFixture('daily') }));
  const secondParent = await h.createHabit(baseCommand({ name: 'Evening routine', schedule: scheduleFixture('weekly') }));
  const child = await h.createHabit(baseCommand({ name: 'Drink water', schedule: scheduleFixture('selected_weekdays'), plannedTime: domainValue(parsePlannerLocalTime('08:15')) }));
  assert.equal(parent.ok && secondParent.ok && child.ok, true); if (!parent.ok || !secondParent.ok || !child.ok) return;

  const attached = await h.changeOrdinaryParent({ action: 'attach', childHabitId: child.value.id, parentHabitId: parent.value.id, effectiveLocalDate: ACTIVE_FROM });
  assert.equal(attached.ok, true, JSON.stringify(attached)); if (attached.ok) assert.equal(attached.value.outcome, 'attached');
  const reparented = await h.changeOrdinaryParent({ action: 'reparent', childHabitId: child.value.id, parentHabitId: secondParent.value.id, effectiveLocalDate: TOMORROW });
  assert.equal(reparented.ok, true, JSON.stringify(reparented)); if (reparented.ok) assert.equal(reparented.value.outcome, 'reparented');
  const detached = await h.changeOrdinaryParent({ action: 'detach', childHabitId: child.value.id, parentHabitId: null, effectiveLocalDate: DAY_THREE });
  assert.equal(detached.ok, true, JSON.stringify(detached)); if (detached.ok) assert.equal(detached.value.outcome, 'detached');

  const schedule = await h.database.getFirstAsync<{ schedule_type: string }>('SELECT schedule_type FROM habit_schedule_versions WHERE habit_id=$id;', { $id: child.value.id });
  const planned = await h.database.getFirstAsync<{ planned_local_time: string | null }>('SELECT planned_local_time FROM habit_planned_time_versions WHERE habit_id=$id;', { $id: child.value.id });
  const history = await h.database.getAllAsync<{ parent_habit_id: string; effective_from: string; effective_to: string | null; end_reason: string | null }>('SELECT parent_habit_id,effective_from,effective_to,end_reason FROM habit_ordinary_parent_versions WHERE child_habit_id=$id ORDER BY effective_from;', { $id: child.value.id });
  assert.equal(schedule?.schedule_type, 'selected_weekdays');
  assert.equal(planned?.planned_local_time, '08:15');
  assert.deepEqual(history.map((row) => ({ ...row })), [
    { parent_habit_id: parent.value.id, effective_from: ACTIVE_FROM, effective_to: TOMORROW, end_reason: 'reparented' },
    { parent_habit_id: secondParent.value.id, effective_from: TOMORROW, effective_to: DAY_THREE, end_reason: 'detached' },
  ]);
});

test('ordinary hierarchy rejects self-links, cycles, depth beyond five, and mixed relationship modes', async (t) => {
  const h = await createHarness(61_000); t.after(() => h.database.close());
  const habits = [];
  for (let index = 0; index < 7; index += 1) {
    const created = await h.createHabit(baseCommand({ name: `Node ${index + 1}` }));
    assert.equal(created.ok, true); if (!created.ok) return; habits.push(created.value);
  }
  const self = await h.changeOrdinaryParent({ action: 'attach', childHabitId: habits[0].id, parentHabitId: habits[0].id, effectiveLocalDate: ACTIVE_FROM });
  assert.equal(self.ok, false); if (!self.ok) assert.equal(self.error.code, 'cycle');
  for (let index = 1; index <= 5; index += 1) {
    const result = await h.changeOrdinaryParent({ action: 'attach', childHabitId: habits[index].id, parentHabitId: habits[index - 1].id, effectiveLocalDate: ACTIVE_FROM });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const tooDeep = await h.changeOrdinaryParent({ action: 'attach', childHabitId: habits[6].id, parentHabitId: habits[5].id, effectiveLocalDate: ACTIVE_FROM });
  assert.equal(tooDeep.ok, false); if (!tooDeep.ok) assert.equal(tooDeep.error.code, 'depth');
  const cycle = await h.changeOrdinaryParent({ action: 'reparent', childHabitId: habits[1].id, parentHabitId: habits[5].id, effectiveLocalDate: ACTIVE_FROM });
  assert.equal(cycle.ok, false); if (!cycle.ok) assert.equal(cycle.error.code, 'cycle');

  const conditional = await h.addHabitDependency({ dependentSource: 'existing', parentHabitId: habits[6].id, dependentHabitId: habits[0].id, dependencyType: 'follow_up', effectiveFrom: ACTIVE_FROM, effectiveTo: ACTIVE_TO });
  assert.equal(conditional.ok, true, JSON.stringify(conditional));
  const mixed = await h.changeOrdinaryParent({ action: 'attach', childHabitId: habits[0].id, parentHabitId: habits[6].id, effectiveLocalDate: ACTIVE_FROM });
  assert.equal(mixed.ok, false); if (!mixed.ok) assert.equal(mixed.error.code, 'relationship_mode_conflict');
});

test('conditional dependency creation rejects a child already grouped as an ordinary sub-habit', async (t) => {
  const h = await createHarness(62_000); t.after(() => h.database.close());
  const parent = await h.createHabit(baseCommand({ name: 'Parent' }));
  const child = await h.createHabit(baseCommand({ name: 'Child' }));
  assert.equal(parent.ok && child.ok, true); if (!parent.ok || !child.ok) return;
  assert.equal((await h.changeOrdinaryParent({ action: 'attach', childHabitId: child.value.id, parentHabitId: parent.value.id, effectiveLocalDate: ACTIVE_FROM })).ok, true);
  const result = await h.addHabitDependency({ dependentSource: 'existing', parentHabitId: parent.value.id, dependentHabitId: child.value.id, dependencyType: 'prerequisite', effectiveFrom: ACTIVE_FROM, effectiveTo: ACTIVE_TO });
  assert.equal(result.ok, false);
});

test('archive preserves an ordinary child while permanent deletion removes the complete descendant chain', async (t) => {
  const h = await createHarness(63_000); t.after(() => h.database.close());
  const parent = await h.createHabit(baseCommand({ name: 'Parent' }));
  const child = await h.createHabit(baseCommand({ name: 'Child' }));
  assert.equal(parent.ok && child.ok, true); if (!parent.ok || !child.ok) return;
  assert.equal((await h.changeOrdinaryParent({ action: 'attach', childHabitId: child.value.id, parentHabitId: parent.value.id, effectiveLocalDate: ACTIVE_FROM })).ok, true);
  assert.equal((await h.archiveHabit({ habitId: parent.value.id, effectiveLocalDate: ACTIVE_FROM, boundaryTimezone: LONDON })).ok, true);
  const edge = await h.database.getFirstAsync<{ effective_to: string | null; end_reason: string | null }>('SELECT effective_to,end_reason FROM habit_ordinary_parent_versions WHERE child_habit_id=$id;', { $id: child.value.id });
  assert.deepEqual(edge === null ? null : { ...edge }, { effective_to: TOMORROW, end_reason: 'parent_archived' });
  const childRow = await h.database.getFirstAsync<{ lifecycle: string }>('SELECT lifecycle FROM habits WHERE id=$id;', { $id: child.value.id });
  assert.equal(childRow?.lifecycle, 'active');
  assert.equal((await h.permanentlyDeleteHabit({ habitId: parent.value.id, effectiveLocalDate: ACTIVE_FROM, boundaryTimezone: LONDON, confirmed: true })).ok, true);
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habits WHERE id=$id;', { $id: child.value.id }))?.count, 0);
});

test('ordinary relationship mutations roll back completely after a forced write failure', async (t) => {
  const h = await createHarness(64_000); t.after(() => h.database.close());
  const parent = await h.createHabit(baseCommand({ name: 'Parent' }));
  const child = await h.createHabit(baseCommand({ name: 'Child' }));
  assert.equal(parent.ok && child.ok, true); if (!parent.ok || !child.ok) return;
  await h.database.execAsync(`CREATE TEMP TRIGGER fail_ordinary_readback AFTER INSERT ON habit_ordinary_parent_versions BEGIN DELETE FROM habit_ordinary_parent_versions WHERE id=NEW.id; END;`);
  const result = await h.changeOrdinaryParent({ action: 'attach', childHabitId: child.value.id, parentHabitId: parent.value.id, effectiveLocalDate: ACTIVE_FROM });
  assert.equal(result.ok, false);
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_ordinary_parent_versions;', {}))?.count, 0);
});

test('planned-time ordering nests ordinary children while completion and observations stay independent', async (t) => {
  const h = await createHarness(65_000); t.after(() => h.database.close());
  const parent = await h.createHabit(baseCommand({ name: 'Routine', plannedTime: domainValue(parsePlannerLocalTime('09:00')) }));
  const child = await h.createHabit(baseCommand({ name: 'Child first', plannedTime: domainValue(parsePlannerLocalTime('08:00')) }));
  const allDay = await h.createHabit(baseCommand({ name: 'All day', plannedTime: null }));
  assert.equal(parent.ok && child.ok && allDay.ok, true); if (!parent.ok || !child.ok || !allDay.ok) return;
  assert.equal((await h.changeOrdinaryParent({ action: 'attach', childHabitId: child.value.id, parentHabitId: parent.value.id, effectiveLocalDate: ACTIVE_FROM })).ok, true);
  const before = await h.getPlannerOccurrencesForDate({ selectedLocalDate: ACTIVE_FROM, evaluationBoundary: ACTIVE_FROM });
  assert.equal(before.ok, true, before.ok ? 'Expected selected-date success.' : before.error.message); if (!before.ok) return;
  assert.deepEqual(before.value.rootGroups.map(({ rootHabitId }) => rootHabitId), [parent.value.id, child.value.id, allDay.value.id]);
  const childRow = before.value.rootGroups[1].rows[0];
  assert.equal(childRow.ordinaryParentHabitId, parent.value.id); assert.equal(childRow.ordinaryDepth, 1); assert.equal(childRow.plannedLocalTime, '08:00');
  assert.equal(before.value.rootGroups.length, 3);
  assert.equal((await h.recordHabitObservation({ habitId: parent.value.id, occurrenceLocalDate: ACTIVE_FROM, occurrenceLocalTime: null, occurrenceTimezone: LONDON, value: { type: 'checkbox', booleanValue: true }, note: null })).ok, true);
  const afterParent = await h.getPlannerOccurrencesForDate({ selectedLocalDate: ACTIVE_FROM, evaluationBoundary: ACTIVE_FROM });
  assert.equal(afterParent.ok, true); if (!afterParent.ok) return;
  assert.equal(afterParent.value.rootGroups[1].rows[0].state, 'expected_incomplete');
  assert.equal((await h.recordHabitObservation({ habitId: child.value.id, occurrenceLocalDate: ACTIVE_FROM, occurrenceLocalTime: null, occurrenceTimezone: LONDON, value: { type: 'checkbox', booleanValue: true }, note: null })).ok, true);
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_observations WHERE habit_id=$id;', { $id: child.value.id }))?.count, 1);
});

test('planned time accepts all-day or HH:mm and rejects invalid local time before writes', async (t) => {
  const h = await createHarness(66_000); t.after(() => h.database.close());
  assert.equal((await h.createHabit(baseCommand({ name: 'All day', plannedTime: null }))).ok, true);
  const invalid = await h.createHabit(baseCommand({ name: 'Invalid time', plannedTime: '24:00' as never }));
  assert.equal(invalid.ok, false); if (!invalid.ok) assert.equal(invalid.error.code, 'invalid_input');
  assert.equal(await tableCount(h.database, 'habits'), 1);
});
