import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlannerId } from '../../../src/features/planner/domain';
import type { DeleteHabitChainImpact } from '../../../src/features/planner/repositories';
import {
  ACTIVE_FROM,
  LONDON,
  REMINDER_TIME,
  baseCommand,
  createHarness,
  tableCount,
  type TestHarness,
} from './test-fixtures';

test('delete-chain preview is deterministic, read-only, and spans ordinary plus conditional descendants', async (t) => {
  const h = await createHarness(90_000); t.after(() => h.database.close());
  const tree = await createMixedTree(h);
  const before = await tableCounts(h);

  const first = await expectPreview(h, tree.root.id);
  const second = await expectPreview(h, tree.root.id);
  assert.deepEqual(first, second);
  assert.equal(first.rootHabitId, tree.root.id);
  assert.equal(first.rootHabitName, 'Routine');
  assert.equal(first.targetCount, 6);
  assert.deepEqual(new Set(first.orderedTargetHabitIds), new Set([
    tree.root.id,
    tree.ordinaryA.id,
    tree.ordinaryB.id,
    tree.nested.id,
    tree.followUp.id,
    tree.prerequisite.id,
  ]));
  assert.equal(first.orderedTargetHabitIds.at(-1), tree.root.id);
  assert.equal(first.relationshipCount, 5);
  assert.equal(first.visualIdentityCount, 6);
  assert.equal(first.unrelatedPreservedCount, 2);
  assert.deepEqual(await tableCounts(h), before);
});

test('mandatory recursive deletion removes mixed descendants and owned history while preserving unrelated habits', async (t) => {
  const h = await createHarness(91_000); t.after(() => h.database.close());
  const tree = await createMixedTree(h);
  const rootFact = await h.recordHabitObservation(observation(tree.root.id));
  const childFact = await h.recordHabitObservation(observation(tree.ordinaryB.id));
  assert.equal(rootFact.ok && childFact.ok, true); if (!childFact.ok) return;
  const correction = await h.correctHabitObservation({
    observationId: childFact.value.id,
    correctionReason: 'correct_value',
    correctedOccurrenceLocalDate: ACTIVE_FROM,
    correctedOccurrenceTimezone: LONDON,
    replacement: { type: 'checkbox', booleanValue: false },
  });
  assert.equal(correction.ok, true);
  assert.equal((await h.archiveHabit({ habitId: tree.ordinaryA.id, effectiveLocalDate: ACTIVE_FROM, boundaryTimezone: LONDON })).ok, true);

  const preview = await expectPreview(h, tree.root.id);
  assert.equal(preview.observationCount, 3);
  assert.equal(preview.correctionCount, 1);
  const deleted = await deletePreview(h, preview);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.deepEqual(await habitNames(h), ['Unrelated root', 'Unrelated sibling']);
  assert.equal(await tableCount(h.database, 'habit_observations'), 0);
  assert.equal(await tableCount(h.database, 'habit_reminders'), 0);
  assert.equal(await lifecycleCount(h), 2);
  assert.equal(await tableCount(h.database, 'habit_ordinary_parent_versions'), 0);
  assert.equal(await tableCount(h.database, 'habit_dependency_versions'), 0);
  assert.equal(await tableCount(h.database, 'habit_visual_identities'), 2);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'), []);

  const reopenedRead = await h.listPlannerHabits({ asOfLocalDate: ACTIVE_FROM, lifecycle: 'all', searchText: '', sort: 'management_default' });
  assert.equal(reopenedRead.ok, true);
  if (reopenedRead.ok) assert.deepEqual(reopenedRead.value.map(({ name }) => name).sort(), ['Unrelated root', 'Unrelated sibling']);
});

test('leaf deletion removes only the leaf and keeps its ancestor, sibling, and sibling relationship', async (t) => {
  const h = await createHarness(92_000); t.after(() => h.database.close());
  const root = await requiredHabit(h, 'Root');
  const leaf = await requiredConditional(h, root.id, 'Leaf', 'follow_up');
  const sibling = await requiredConditional(h, root.id, 'Sibling', 'prerequisite');
  const preview = await expectPreview(h, leaf.id);
  assert.deepEqual(preview.orderedTargetHabitIds, [leaf.id]);
  assert.equal(preview.targetCount, 1);
  assert.equal((await deletePreview(h, preview)).ok, true);
  assert.deepEqual(await habitNames(h), ['Root', 'Sibling']);
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_dependency_versions WHERE dependent_habit_id=$id;', { $id: sibling.id }))?.count, 1);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('parent with five ordinary children deletes all five and preserves an unrelated root', async (t) => {
  const h = await createHarness(93_000); t.after(() => h.database.close());
  const root = await requiredHabit(h, 'Root');
  for (let index = 1; index <= 5; index += 1) {
    const child = await requiredHabit(h, `Child ${index}`);
    assert.equal((await h.changeOrdinaryParent({ action: 'attach', childHabitId: child.id, parentHabitId: root.id, effectiveLocalDate: ACTIVE_FROM })).ok, true);
  }
  await requiredHabit(h, 'Unrelated');
  const preview = await expectPreview(h, root.id);
  assert.equal(preview.targetCount, 6);
  assert.equal((await deletePreview(h, preview)).ok, true);
  assert.deepEqual(await habitNames(h), ['Unrelated']);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('delete-chain confirmation rejects a changed graph without writing', async (t) => {
  const h = await createHarness(94_000); t.after(() => h.database.close());
  const root = await requiredHabit(h, 'Root');
  const child = await requiredHabit(h, 'Child');
  assert.equal((await h.changeOrdinaryParent({ action: 'attach', childHabitId: child.id, parentHabitId: root.id, effectiveLocalDate: ACTIVE_FROM })).ok, true);
  const preview = await expectPreview(h, root.id);
  const later = await requiredHabit(h, 'Later child');
  assert.equal((await h.changeOrdinaryParent({ action: 'attach', childHabitId: later.id, parentHabitId: root.id, effectiveLocalDate: ACTIVE_FROM })).ok, true);
  const before = await tableCounts(h);
  const stale = await deletePreview(h, preview);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, 'delete_routine_stale_confirmation');
  assert.deepEqual(await tableCounts(h), before);
  assert.deepEqual(await habitNames(h), ['Child', 'Later child', 'Root']);
});

for (const failurePoint of ['descendant', 'root'] as const) {
  test(`delete-chain rollback is all-or-nothing when ${failurePoint} deletion fails`, async (t) => {
    const h = await createHarness(failurePoint === 'descendant' ? 95_000 : 96_000); t.after(() => h.database.close());
    const root = await requiredHabit(h, 'Root');
    const child = await requiredHabit(h, 'Child');
    assert.equal((await h.changeOrdinaryParent({ action: 'attach', childHabitId: child.id, parentHabitId: root.id, effectiveLocalDate: ACTIVE_FROM })).ok, true);
    assert.equal((await h.recordHabitObservation(observation(child.id))).ok, true);
    const preview = await expectPreview(h, root.id);
    const failedId = failurePoint === 'descendant' ? child.id : root.id;
    await h.database.execAsync(`CREATE TEMP TRIGGER fail_chain_delete BEFORE DELETE ON habits WHEN OLD.id='${failedId}' BEGIN SELECT RAISE(ABORT,'forced chain failure'); END;`);
    const before = await tableCounts(h);
    const result = await deletePreview(h, preview);
    assert.equal(result.ok, false);
    assert.deepEqual(await tableCounts(h), before);
    assert.deepEqual(await habitNames(h), ['Child', 'Root']);
    assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'), []);
  });
}

async function createMixedTree(h: TestHarness) {
  const root = await requiredHabit(h, 'Routine', true);
  const ordinaryA = await requiredHabit(h, 'Ordinary A');
  const ordinaryB = await requiredHabit(h, 'Ordinary B');
  const nested = await requiredHabit(h, 'Nested ordinary');
  for (const [childHabitId, parentHabitId] of [[ordinaryA.id, root.id], [ordinaryB.id, root.id], [nested.id, ordinaryA.id]] as const) {
    assert.equal((await h.changeOrdinaryParent({ action: 'attach', childHabitId, parentHabitId, effectiveLocalDate: ACTIVE_FROM })).ok, true);
  }
  const followUp = await requiredConditional(h, root.id, 'Follow-up child', 'follow_up');
  const prerequisite = await requiredConditional(h, followUp.id, 'Prerequisite descendant', 'prerequisite');
  const unrelatedRoot = await requiredHabit(h, 'Unrelated root');
  const unrelatedSibling = await requiredHabit(h, 'Unrelated sibling');
  return { root, ordinaryA, ordinaryB, nested, followUp, prerequisite, unrelatedRoot, unrelatedSibling };
}

async function requiredHabit(h: TestHarness, name: string, reminder = false) {
  const result = await h.createHabit(baseCommand({
    name,
    reminder: reminder ? { triggerLocalTime: REMINDER_TIME, timezoneMode: 'schedule_timezone', timezoneId: null } : null,
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error(`Could not create ${name}.`);
  return result.value;
}

async function requiredConditional(h: TestHarness, parentHabitId: PlannerId, name: string, dependencyType: 'follow_up' | 'prerequisite') {
  const result = await h.addHabitDependency({
    parentHabitId,
    dependentSource: 'new',
    dependent: { name, description: null, categoryId: null, tracking: baseCommand().tracking, importance: 'normal', reminder: null },
    dependencyType,
    effectiveFrom: ACTIVE_FROM,
    effectiveTo: baseCommand().activeTo,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error(`Could not create ${name}.`);
  return result.value.dependent;
}

async function expectPreview(h: TestHarness, rootHabitId: PlannerId): Promise<DeleteHabitChainImpact> {
  const result = await h.previewDeleteHabitChain({ rootHabitId, asOfLocalDate: ACTIVE_FROM });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('Delete-chain preview failed.');
  return result.value;
}

function deletePreview(h: TestHarness, preview: DeleteHabitChainImpact) {
  return h.deleteHabitChain({
    habitId: preview.rootHabitId,
    effectiveLocalDate: ACTIVE_FROM,
    boundaryTimezone: preview.targets.find(({ habitId }) => habitId === preview.rootHabitId)?.boundaryTimezone ?? LONDON,
    expectedOrderedTargetHabitIds: preview.orderedTargetHabitIds,
    confirmed: true,
  });
}

function observation(habitId: PlannerId) {
  return { habitId, occurrenceLocalDate: ACTIVE_FROM, occurrenceLocalTime: null, occurrenceTimezone: LONDON, value: { type: 'checkbox' as const, booleanValue: true }, note: null };
}

async function habitNames(h: TestHarness): Promise<readonly string[]> {
  return (await h.database.getAllAsync<{ readonly name: string }>('SELECT name FROM habits ORDER BY name;')).map(({ name }) => name);
}

async function tableCounts(h: TestHarness) {
  return {
    habits: await tableCount(h.database, 'habits'),
    ordinary: await tableCount(h.database, 'habit_ordinary_parent_versions'),
    conditional: await tableCount(h.database, 'habit_dependency_versions'),
    observations: await tableCount(h.database, 'habit_observations'),
    reminders: await tableCount(h.database, 'habit_reminders'),
    lifecycle: await lifecycleCount(h),
    identities: await tableCount(h.database, 'habit_visual_identities'),
  };
}

async function lifecycleCount(h: TestHarness): Promise<number> {
  return (await h.database.getFirstAsync<{ readonly count: number }>('SELECT count(*) AS count FROM habit_lifecycle_transitions;'))?.count ?? -1;
}

test('an item with subtasks deletes, and takes its lines, ticks and closure rule with it', async (t) => {
  // **The defect, reproduced.** Three tables arrived after `permanentlyDeleteHabit`
  // was written — `habit_checklist_items` (008), `habit_checklist_ticks` (009) and
  // `habit_closure_rules` (011) — and each references its owner `ON DELETE
  // RESTRICT`. The delete chain removed none of them, so `DELETE FROM habits` passed
  // only because foreign keys are deferred, and the `foreign_key_check` at the foot
  // of the delete then found the orphans: *"Permanent deletion verification failed"*.
  // An item with a subtask could not be deleted at all.
  const h = await createHarness(91_000); t.after(() => h.database.close());
  const habitId = (await requiredHabit(h, 'Bob')).id;

  // The rows exactly as the checklist writes them, including a line **retired by a
  // date rather than deleted** — which is why removing the subtask in the editor did
  // not help: the row and its foreign key outlive the removal on purpose.
  await h.database.runAsync(
    'INSERT INTO habit_checklist_items (id, habit_id, text, sort_order, created_from, created_at, deleted_from) VALUES ($a, $h, $t, 0, $d, 1, NULL), ($b, $h, $u, 1, $d, 1, $g);',
    { $a: 'line-live', $b: 'line-retired', $h: habitId, $t: 'Bob', $u: 'Retired', $d: ACTIVE_FROM, $g: '2999-01-01' },
  );
  await h.database.runAsync(
    'INSERT INTO habit_checklist_ticks (checklist_item_id, occurrence_local_date, done_at) VALUES ($a, $d, 1);',
    { $a: 'line-live', $d: ACTIVE_FROM },
  );
  await h.database.runAsync(
    'INSERT INTO habit_closure_rules (habit_id, closes_by_checklist, updated_at) VALUES ($h, 1, 1);',
    { $h: habitId },
  );
  assert.deepEqual(await checklistCounts(h), { items: 2, ticks: 1, rules: 1 });

  const preview = await expectPreview(h, habitId);
  const deleted = await deletePreview(h, preview);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));

  // The habit is gone, and so is everything that referenced it: an orphan left in
  // any of the three would fail the chain's own `foreign_key_check`.
  assert.deepEqual(await habitNames(h), []);
  assert.deepEqual(await checklistCounts(h), { items: 0, ticks: 0, rules: 0 });
  assert.equal((await h.database.getAllAsync<unknown>('PRAGMA foreign_key_check;')).length, 0);
});

test('deleting one item leaves another item subtasks alone', async (t) => {
  // The delete is scoped by `habit_id`, so a neighbour's checklist is untouched —
  // the obvious way to get this wrong is a `DELETE FROM habit_checklist_items` that
  // forgets its `WHERE`.
  const h = await createHarness(92_000); t.after(() => h.database.close());
  const doomed = await requiredHabit(h, 'Doomed');
  const keeper = await requiredHabit(h, 'Keeper');

  for (const [lineId, habitId] of [['a', doomed.id], ['b', keeper.id]] as const) {
    await h.database.runAsync(
      'INSERT INTO habit_checklist_items (id, habit_id, text, sort_order, created_from, created_at, deleted_from) VALUES ($i, $h, $t, 0, $d, 1, NULL);',
      { $i: lineId, $h: habitId, $t: `line ${lineId}`, $d: ACTIVE_FROM },
    );
    await h.database.runAsync(
      'INSERT INTO habit_checklist_ticks (checklist_item_id, occurrence_local_date, done_at) VALUES ($i, $d, 1);',
      { $i: lineId, $d: ACTIVE_FROM },
    );
  }

  const deleted = await deletePreview(h, await expectPreview(h, doomed.id));
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.deepEqual(await habitNames(h), ['Keeper']);
  const survivors = await h.database.getAllAsync<{ readonly id: string }>('SELECT id FROM habit_checklist_items;');
  assert.deepEqual(survivors.map(({ id }) => id), ['b']);
  assert.deepEqual(await checklistCounts(h), { items: 1, ticks: 1, rules: 0 });
});

/** The three tables `tableCount`'s own union predates, counted directly. */
async function checklistCounts(h: TestHarness) {
  const count = async (table: string) =>
    (await h.database.getFirstAsync<{ readonly count: number }>(`SELECT count(*) AS count FROM ${table};`))?.count ?? -1;
  return {
    items: await count('habit_checklist_items'),
    rules: await count('habit_closure_rules'),
    ticks: await count('habit_checklist_ticks'),
  };
}

test('an item with a reminder deletes, and takes what the system was told with it', async (t) => {
  // **The same defect as the subtasks one above, caught before it shipped.**
  // `habit_reminder_schedules` (012) references `habit_reminders` `ON DELETE RESTRICT`,
  // so a chain that removed the reminder without the projection would leave an orphan —
  // and the `foreign_key_check` at the foot of the delete would report *"Permanent
  // deletion verification failed"*, making any item with a reminder undeletable. That is
  // exactly what PD-SUBTASK-005 recorded, which is why this was looked for at all.
  const h = await createHarness(93_000); t.after(() => h.database.close());
  const habitId = (await requiredHabit(h, 'Bob')).id;

  await h.database.runAsync(
    'INSERT INTO habit_reminders (id, habit_id, trigger_local_time, timezone_mode, timezone_id, enabled, lifecycle, created_at, updated_at, archived_at) VALUES ($r, $h, $t, $m, NULL, 1, $l, 1, 1, NULL);',
    { $h: habitId, $l: 'active', $m: 'schedule_timezone', $r: 'reminder-1', $t: '07:00' },
  );
  await h.database.runAsync(
    'INSERT INTO habit_reminder_schedules (reminder_id, system_identifier, status, scheduled_for, failure_reason, updated_at) VALUES ($r, $i, $s, $t, NULL, 1);',
    { $i: 'lifeplanner.reminder.reminder-1.2026-08-01', $r: 'reminder-1', $s: 'scheduled', $t: '07:00' },
  );
  assert.deepEqual(await reminderCounts(h), { reminders: 1, schedules: 1 });

  const preview = await expectPreview(h, habitId);
  const deleted = await deletePreview(h, preview);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));

  assert.deepEqual(await habitNames(h), []);
  assert.deepEqual(await reminderCounts(h), { reminders: 0, schedules: 0 });
  assert.equal((await h.database.getAllAsync<unknown>('PRAGMA foreign_key_check;')).length, 0);
});

async function reminderCounts(h: TestHarness): Promise<Readonly<{ reminders: number; schedules: number }>> {
  const reminders = (await h.database.getFirstAsync<{ readonly count: number }>('SELECT count(*) AS count FROM habit_reminders;'))?.count ?? -1;
  const schedules = (await h.database.getFirstAsync<{ readonly count: number }>('SELECT count(*) AS count FROM habit_reminder_schedules;'))?.count ?? -1;
  return { reminders, schedules };
}
