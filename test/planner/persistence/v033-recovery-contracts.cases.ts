import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  type PlannerId,
  type PlannerLocalDate,
} from '../../../src/features/planner/domain';
import type { HabitAggregate } from '../../../src/features/planner/repositories';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';
import {
  ACTIVE_FROM,
  ACTIVE_TO,
  FIXED_NOW,
  LONDON,
  baseCommand,
  createHarness,
  createHarnessForDatabase,
  domainValue,
  plannerId,
  scheduleFixture,
  trackingFixture,
  type TestHarness,
} from './test-fixtures';

const AUGUST_2 = date('2026-08-02');
const AUGUST_3 = date('2026-08-03');
const AUGUST_5 = date('2026-08-05');

test('legacy organizational conversion preserves history and changes selected-day semantics only from its boundary', async (t) => {
  const h = await createHarness(110_000); t.after(() => h.database.close());
  const parent = await create(h, 'Legacy parent');
  const child = await create(h, 'Legacy child');
  await attach(h, parent.id, child.id, 'organizational');

  const before = await occurrences(h, ACTIVE_FROM);
  assert.equal(group(before, parent.id).routineContainer.hasIndependentCompletionAction, true);
  assert.deepEqual(before.rootProgress, { completedRootCount: 0, scheduledRootCount: 1, remainingRootCount: 1 });
  const preview = await h.getRoutineConversionPreview({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_2 });
  assert.equal(preview.ok, true, preview.ok ? '' : preview.error.message);
  if (!preview.ok) return;
  assert.equal(preview.value.conversionAllowed, true);
  assert.equal(preview.value.eligibleRelationships.length, 1);
  assert.equal(preview.value.earliestSafeEffectiveDate, AUGUST_2);
  assert.equal(preview.value.resultingDirectRoutineStepCount, 1);
  assert.equal(preview.value.wouldBecomeRoutineContainer, true);

  const converted = await h.convertOrganizationalParentToRoutine({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_2 });
  assert.equal(converted.ok, true, converted.ok ? '' : converted.error.message);
  if (!converted.ok) return;
  assert.equal(converted.value.directRoutineStepCount, 1);
  const versions = await h.database.getAllAsync<{
    relationship_id: string; version_number: number; completion_role: string; effective_from: string; effective_to: string | null;
  }>('SELECT relationship_id,version_number,completion_role,effective_from,effective_to FROM habit_ordinary_parent_versions WHERE child_habit_id=$child ORDER BY effective_from;', { $child: child.id });
  assert.deepEqual(versions.map((row) => ({ ...row })), [
    { relationship_id: versions[0].relationship_id, version_number: 1, completion_role: 'organizational', effective_from: ACTIVE_FROM, effective_to: AUGUST_2 },
    { relationship_id: versions[0].relationship_id, version_number: 2, completion_role: 'routine_step', effective_from: AUGUST_2, effective_to: ACTIVE_TO },
  ]);

  const historical = await occurrences(h, ACTIVE_FROM);
  assert.equal(group(historical, parent.id).routineContainer.hasIndependentCompletionAction, true);
  const after = await occurrences(h, AUGUST_2);
  assert.equal(group(after, parent.id).routineContainer.hasIndependentCompletionAction, false);
  assert.equal(group(after, parent.id).routineContainer.isRoutineContainer, true);
  assert.deepEqual(after.rootProgress, { completedRootCount: 0, scheduledRootCount: 1, remainingRootCount: 1 });
  assert.equal((await h.recordHabitObservation(checkboxRecord(parent.id, AUGUST_2))).ok, false);
  assert.equal((await h.recordHabitObservation(checkboxRecord(child.id, AUGUST_2))).ok, true);
  assert.deepEqual((await occurrences(h, AUGUST_2)).rootProgress, { completedRootCount: 1, scheduledRootCount: 1, remainingRootCount: 0 });
  await h.database.migrate();
  assert.equal(group(await occurrences(h, AUGUST_2), parent.id).routineContainer.isRoutineContainer, true);
});

test('conversion preview explains selected mixed roles, nested ownership, and excluded conditional relationships', async (t) => {
  const h = await createHarness(111_000); t.after(() => h.database.close());
  const parent = await create(h, 'Mixed parent');
  const convertMe = await create(h, 'Convert me');
  const retainMe = await create(h, 'Retain me');
  const existingStep = await create(h, 'Existing step');
  const grandchild = await create(h, 'Nested organizational child');
  const conditional = await create(h, 'Conditional child');
  await attach(h, parent.id, convertMe.id, 'organizational');
  await attach(h, parent.id, retainMe.id, 'organizational');
  await attach(h, parent.id, existingStep.id, 'routine_step');
  await attach(h, convertMe.id, grandchild.id, 'organizational');
  assert.equal((await h.addHabitDependency({
    dependentSource: 'existing', parentHabitId: parent.id, dependentHabitId: conditional.id,
    dependencyType: 'follow_up', effectiveFrom: ACTIVE_FROM, effectiveTo: ACTIVE_TO,
  })).ok, true);

  const preview = await h.getRoutineConversionPreview({
    parentHabitId: parent.id,
    requestedEffectiveLocalDate: AUGUST_2,
    childHabitIds: [convertMe.id],
  });
  assert.equal(preview.ok, true, preview.ok ? '' : preview.error.message);
  if (!preview.ok) return;
  assert.equal(preview.value.conversionAllowed, true);
  assert.deepEqual(preview.value.eligibleRelationships.map(({ childHabitId }) => childHabitId), [convertMe.id]);
  assert.deepEqual(preview.value.retainedOrganizationalRelationships.map(({ childHabitId }) => childHabitId), [retainMe.id]);
  assert.deepEqual(preview.value.alreadyRoutineStepRelationships.map(({ childHabitId }) => childHabitId), [existingStep.id]);
  assert.deepEqual(preview.value.conditionalRelationshipsExcluded.map(({ childHabitId, dependencyType }) => ({ childHabitId, dependencyType })), [{ childHabitId: conditional.id, dependencyType: 'follow_up' }]);
  assert.equal(preview.value.resultingDirectRoutineStepCount, 2);
  assert.equal(preview.value.retainedOrganizationalChildCount, 1);
  assert.equal(preview.value.mixedStructure, true);
  const converted = await h.convertOrganizationalParentToRoutine({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_2, childHabitIds: [convertMe.id] });
  assert.equal(converted.ok, true, converted.ok ? '' : converted.error.message);
  if (!converted.ok) return;
  assert.equal(converted.value.mixedStructure, true);
  const roles = await h.database.getAllAsync<{ child_habit_id: string; completion_role: string }>(
    `SELECT child_habit_id,completion_role FROM habit_ordinary_parent_versions
     WHERE parent_habit_id=$parent AND effective_from<=$date AND (effective_to IS NULL OR effective_to>$date)
     ORDER BY child_habit_id;`,
    { $parent: parent.id, $date: AUGUST_2 },
  );
  assert.deepEqual(new Map(roles.map((row) => [row.child_habit_id, row.completion_role])), new Map([
    [convertMe.id, 'routine_step'], [retainMe.id, 'organizational'], [existingStep.id, 'routine_step'],
  ]));
  assert.equal((await h.database.getFirstAsync<{ completion_role: string }>('SELECT completion_role FROM habit_ordinary_parent_versions WHERE parent_habit_id=$parent AND child_habit_id=$child;', { $parent: convertMe.id, $child: grandchild.id }))?.completion_role, 'organizational');
});

test('same-boundary conversion preserves the existing relationship version identity', async (t) => {
  const h = await createHarness(111_900); t.after(() => h.database.close());
  const parent = await create(h, 'Same-boundary parent');
  const child = await create(h, 'Same-boundary child');
  await attach(h, parent.id, child.id, 'organizational');
  const before = await h.database.getFirstAsync<{ id: string; relationship_id: string; version_number: number }>(
    'SELECT id,relationship_id,version_number FROM habit_ordinary_parent_versions WHERE child_habit_id=$child;',
    { $child: child.id },
  );
  const converted = await h.convertOrganizationalParentToRoutine({ parentHabitId: parent.id, requestedEffectiveLocalDate: ACTIVE_FROM });
  assert.equal(converted.ok, true, converted.ok ? '' : converted.error.message);
  const after = await h.database.getFirstAsync<{ id: string; relationship_id: string; version_number: number; completion_role: string }>(
    'SELECT id,relationship_id,version_number,completion_role FROM habit_ordinary_parent_versions WHERE child_habit_id=$child;',
    { $child: child.id },
  );
  assert.deepEqual(after === null ? null : { ...after }, { ...before, completion_role: 'routine_step' });
  assert.equal(group(await occurrences(h, ACTIVE_FROM), parent.id).routineContainer.hasIndependentCompletionAction, false);
});

test('parent observation chains block conversion and return the next safe calendar date without rewriting facts', async (t) => {
  const h = await createHarness(112_000); t.after(() => h.database.close());
  const parent = await create(h, 'Observed parent');
  const child = await create(h, 'Observed child');
  await attach(h, parent.id, child.id, 'organizational');
  const observation = await h.recordHabitObservation(checkboxRecord(parent.id, AUGUST_2));
  assert.equal(observation.ok, true); if (!observation.ok) return;
  const correction = await h.correctHabitObservation({
    observationId: observation.value.id,
    correctionReason: 'correct_value',
    correctedOccurrenceLocalDate: AUGUST_2,
    correctedOccurrenceTimezone: LONDON,
    replacement: { type: 'checkbox', booleanValue: false },
  });
  assert.equal(correction.ok, true); if (!correction.ok) return;
  assert.equal((await h.correctHabitObservation({
    observationId: correction.value.currentLeaf.id,
    correctionReason: 'reversal',
    correctedOccurrenceLocalDate: AUGUST_2,
    correctedOccurrenceTimezone: LONDON,
    replacement: { type: 'void' },
  })).ok, true);

  const beforeRows = await h.database.getAllAsync('SELECT * FROM habit_ordinary_parent_versions ORDER BY id;');
  const preview = await h.getRoutineConversionPreview({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_2 });
  assert.equal(preview.ok, true); if (!preview.ok) return;
  assert.equal(preview.value.conversionAllowed, false);
  assert.equal(preview.value.parentObservationsOnOrAfterBoundary.length, 1);
  assert.equal(preview.value.parentObservationsOnOrAfterBoundary[0].isVoided, true);
  assert.equal(preview.value.earliestSafeEffectiveDate, AUGUST_3);
  assert.equal(preview.value.conflicts.some(({ code }) => code === 'parent_observation_on_or_after_boundary'), true);
  const blocked = await h.convertOrganizationalParentToRoutine({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_2 });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.error.code, 'conversion_conflict');
    assert.equal(blocked.error.earliestSafeEffectiveDate, AUGUST_3);
  }
  assert.deepEqual(await h.database.getAllAsync('SELECT * FROM habit_ordinary_parent_versions ORDER BY id;'), beforeRows);
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_observations WHERE habit_id=$parent;', { $parent: parent.id }))?.count, 3);
  assert.equal((await h.convertOrganizationalParentToRoutine({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_3 })).ok, true);
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_observations WHERE habit_id=$parent;', { $parent: parent.id }))?.count, 3);
});

test('conversion is atomic when a later relationship version insert fails', async (t) => {
  const h = await createHarness(113_000); t.after(() => h.database.close());
  const parent = await create(h, 'Rollback parent');
  const first = await create(h, 'Rollback first');
  const second = await create(h, 'Rollback second');
  await attach(h, parent.id, first.id, 'organizational');
  await attach(h, parent.id, second.id, 'organizational');
  const before = await h.database.getAllAsync('SELECT * FROM habit_ordinary_parent_versions ORDER BY id;');
  await h.database.execAsync(`CREATE TEMP TRIGGER fail_second_conversion BEFORE INSERT ON habit_ordinary_parent_versions WHEN NEW.completion_role='routine_step' AND NEW.child_habit_id='${second.id}' BEGIN SELECT RAISE(ABORT,'forced conversion failure'); END;`);
  const result = await h.convertOrganizationalParentToRoutine({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_2 });
  assert.equal(result.ok, false);
  assert.deepEqual(await h.database.getAllAsync('SELECT * FROM habit_ordinary_parent_versions ORDER BY id;'), before);
  assert.equal((await h.getRoutineConversionPreview({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_2 })).ok, true);
});

test('conversion preview refuses persisted ordinary cycles and depth beyond five', async (t) => {
  const cycle = await createHarness(114_000); t.after(() => cycle.database.close());
  const a = await create(cycle, 'Cycle A');
  const b = await create(cycle, 'Cycle B');
  await attach(cycle, a.id, b.id, 'organizational');
  await insertOrdinaryRow(cycle, plannerId(999_001), plannerId(999_002), b.id, a.id);
  const cyclePreview = await cycle.getRoutineConversionPreview({ parentHabitId: a.id, requestedEffectiveLocalDate: ACTIVE_FROM });
  assert.equal(cyclePreview.ok, true); if (cyclePreview.ok) {
    assert.equal(cyclePreview.value.conversionAllowed, false);
    assert.equal(cyclePreview.value.conflicts.some(({ code }) => code === 'ordinary_hierarchy_cycle'), true);
  }

  const depth = await createHarness(115_000); t.after(() => depth.database.close());
  const nodes: HabitAggregate[] = [];
  for (let index = 0; index < 7; index += 1) nodes.push(await create(depth, `Depth ${index}`));
  for (let index = 0; index < 5; index += 1) await attach(depth, nodes[index].id, nodes[index + 1].id, 'organizational');
  await insertOrdinaryRow(depth, plannerId(999_011), plannerId(999_012), nodes[5].id, nodes[6].id);
  const depthPreview = await depth.getRoutineConversionPreview({ parentHabitId: nodes[0].id, requestedEffectiveLocalDate: ACTIVE_FROM });
  assert.equal(depthPreview.ok, true); if (depthPreview.ok) {
    assert.equal(depthPreview.value.conversionAllowed, false);
    assert.equal(depthPreview.value.conflicts.some(({ code }) => code === 'ordinary_hierarchy_depth_exceeded'), true);
  }
});

test('conversion survives a real file close and reopen and lifecycle removal returns independent parent semantics', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lifeplanner-recovery-'));
  const filename = join(directory, 'planner.sqlite');
  let database: NodeSqliteTestDatabase | null = new NodeSqliteTestDatabase(filename);
  try {
    await database.migrate();
    await database.runAsync(`INSERT INTO planner_preferences(id,progress_mode,created_at,updated_at) VALUES(1,'equal',$now,$now);`, { $now: FIXED_NOW });
    let h = createHarnessForDatabase(database, 116_000);
    const fern = '\u{1F33F}';
    const createdParent = await h.createHabit(baseCommand({
      name: 'Reopen parent',
      iconIdentity: { kind: 'emoji', emoji: fern },
      accentKey: 'green',
    }));
    assert.equal(createdParent.ok, true); if (!createdParent.ok) return;
    const parent = createdParent.value;
    const child = await create(h, 'Reopen child');
    await attach(h, parent.id, child.id, 'organizational');
    assert.equal((await h.convertOrganizationalParentToRoutine({ parentHabitId: parent.id, requestedEffectiveLocalDate: AUGUST_2 })).ok, true);
    database.close();
    database = new NodeSqliteTestDatabase(filename);
    await database.migrate();
    h = createHarnessForDatabase(database, 117_000);
    assert.equal(group(await occurrences(h, AUGUST_2), parent.id).routineContainer.isRoutineContainer, true);
    const reopenedDetail = await h.getPlannerHabitDetail({ habitId: parent.id, asOfLocalDate: AUGUST_2 });
    assert.equal(reopenedDetail.ok, true);
    if (reopenedDetail.ok) {
      assert.equal(reopenedDetail.value?.habit.visualIdentity.iconIdentity.kind === 'emoji'
        ? reopenedDetail.value.habit.visualIdentity.iconIdentity.emoji
        : null, fern);
    }
    const reopenedSummary = await scheduleSummary(h, AUGUST_2);
    assert.equal(reopenedSummary.rootCount, 1);
    assert.equal(reopenedSummary.routineCount, 1);
    assert.equal(reopenedSummary.scheduledActionCount, 1);
    assert.equal((await h.archiveHabit({ habitId: child.id, effectiveLocalDate: AUGUST_2, boundaryTimezone: LONDON })).ok, true);
    assert.equal((await h.restoreHabit({ habitId: child.id, effectiveLocalDate: AUGUST_2, boundaryTimezone: LONDON })).ok, true);
    assert.equal(group(await occurrences(h, AUGUST_3), parent.id).routineContainer.isRoutineContainer, false);
    assert.equal((await h.permanentlyDeleteHabit({ habitId: child.id, effectiveLocalDate: AUGUST_3, boundaryTimezone: LONDON, confirmed: true })).ok, true);
    assert.equal(group(await occurrences(h, AUGUST_3), parent.id).routineContainer.hasIndependentCompletionAction, true);
    assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('schedule summary distinguishes simple timed and all-day roots from actions in deterministic order', async (t) => {
  const h = await createHarness(118_000); t.after(() => h.database.close());
  const late = await h.createHabit(baseCommand({ name: 'Late', plannedTime: time('09:00') }));
  const early = await h.createHabit(baseCommand({ name: 'Early', plannedTime: time('07:00') }));
  const allDay = await h.createHabit(baseCommand({ name: 'All day', plannedTime: null }));
  assert.equal(late.ok && early.ok && allDay.ok, true); if (!late.ok || !early.ok || !allDay.ok) return;
  const summary = await scheduleSummary(h, ACTIVE_FROM);
  assert.equal(summary.rootCount, 3);
  assert.equal(summary.simpleRootCount, 3);
  assert.equal(summary.routineCount, 0);
  assert.equal(summary.scheduledActionCount, 3);
  assert.equal(summary.timedActionCount, 2);
  assert.equal(summary.allDayActionCount, 1);
  assert.equal(summary.earliestTimedAction?.habitId, early.value.id);
  assert.deepEqual(summary.groupedEntries.map(({ rootType }) => rootType), ['simple_root', 'simple_root', 'simple_root']);
});

test('schedule summary groups routine steps once, preserves nested ownership, and classifies legacy parents truthfully', async (t) => {
  const h = await createHarness(119_000); t.after(() => h.database.close());
  const routine = await create(h, 'Routine header');
  const timedStep = await h.createHabit(baseCommand({ name: 'Timed step', plannedTime: time('06:30') }));
  const allDayStep = await create(h, 'All-day step');
  const nested = await create(h, 'Nested routine');
  const nestedLeaf = await h.createHabit(baseCommand({ name: 'Nested leaf', plannedTime: time('07:30') }));
  if (!timedStep.ok || !nestedLeaf.ok) assert.fail('Expected scheduled step fixtures.');
  await attach(h, routine.id, timedStep.value.id, 'routine_step');
  await attach(h, routine.id, allDayStep.id, 'routine_step');
  await attach(h, routine.id, nested.id, 'routine_step');
  await attach(h, nested.id, nestedLeaf.value.id, 'routine_step');
  const legacy = await create(h, 'Legacy header');
  const legacyChild = await h.createHabit(baseCommand({ name: 'Legacy child', plannedTime: time('08:00') }));
  if (!legacyChild.ok) assert.fail('Expected legacy child fixture.');
  await attach(h, legacy.id, legacyChild.value.id, 'organizational');

  const summary = await scheduleSummary(h, ACTIVE_FROM);
  assert.equal(summary.rootCount, 2);
  assert.equal(summary.routineCount, 2);
  assert.equal(summary.simpleRootCount, 0);
  assert.equal(summary.legacyOrganizationalParentCount, 1);
  assert.equal(summary.scheduledActionCount, 5);
  assert.equal(summary.timedActionCount, 3);
  assert.equal(summary.allDayActionCount, 2);
  assert.equal(summary.earliestTimedAction?.habitId, timedStep.value.id);
  const routineGroup = summary.groupedEntries.find(({ rootHabitId }) => rootHabitId === routine.id);
  assert.equal(routineGroup?.rootType, 'routine_container');
  assert.equal(routineGroup?.rootActionAvailability, 'not_applicable');
  assert.deepEqual(routineGroup?.directScheduledActions.map(({ habitId }) => habitId).sort(), [timedStep.value.id, allDayStep.id].sort());
  assert.deepEqual(routineGroup?.nestedGroups.map(({ rootHabitId }) => rootHabitId), [nested.id]);
  assert.equal(routineGroup?.timedDirectStepCount, 1);
  assert.equal(routineGroup?.allDayDirectStepCount, 1);
  const legacyGroup = summary.groupedEntries.find(({ rootHabitId }) => rootHabitId === legacy.id);
  assert.equal(legacyGroup?.rootType, 'legacy_organizational_parent');
  assert.equal(legacyGroup?.rootActionAvailability, 'available');
  assert.deepEqual(legacyGroup?.directScheduledActions.map(({ habitId }) => habitId).sort(), [legacy.id, legacyChild.value.id].sort());
});

test('schedule summary keeps a legacy parent independently actionable when its organizational child is not scheduled', async (t) => {
  const h = await createHarness(119_500); t.after(() => h.database.close());
  const legacy = await create(h, 'Legacy header');
  const wednesdayChild = await create(h, 'Wednesday child', undefined, scheduleFixture('weekly'));
  await attach(h, legacy.id, wednesdayChild.id, 'organizational');

  const saturday = await scheduleSummary(h, ACTIVE_FROM);
  assert.equal(saturday.rootCount, 1);
  assert.equal(saturday.legacyOrganizationalParentCount, 1);
  assert.equal(saturday.scheduledActionCount, 1);
  assert.deepEqual(saturday.groupedEntries[0].directScheduledActions.map(({ habitId }) => habitId), [legacy.id]);
  assert.equal(saturday.groupedEntries[0].rootActionAvailability, 'available');
});

test('schedule summary retains mixed-role organizational actions when routine steps are not applicable', async (t) => {
  const h = await createHarness(119_750); t.after(() => h.database.close());
  const parent = await create(h, 'Mixed parent');
  const retained = await create(h, 'Retained organizational action');
  const wednesdayStep = await create(h, 'Wednesday routine step', undefined, scheduleFixture('weekly'));
  await attach(h, parent.id, retained.id, 'organizational');
  await attach(h, parent.id, wednesdayStep.id, 'routine_step');

  const saturday = await scheduleSummary(h, ACTIVE_FROM);
  assert.equal(saturday.rootCount, 0);
  assert.equal(saturday.routineCount, 0);
  assert.equal(saturday.scheduledActionCount, 1);
  assert.equal(saturday.groupedEntries.length, 1);
  assert.equal(saturday.groupedEntries[0].rootType, 'routine_container');
  assert.equal(saturday.groupedEntries[0].rootApplicability, 'no_applicable_steps');
  assert.equal(saturday.groupedEntries[0].rootActionAvailability, 'not_applicable');
  assert.deepEqual(saturday.groupedEntries[0].directScheduledActions.map(({ habitId }) => habitId), [retained.id]);
});

test('schedule summary keeps blocked actions classified, omits no-applicable routines, and uses the same service tomorrow', async (t) => {
  const h = await createHarness(120_000); t.after(() => h.database.close());
  const root = await create(h, 'Blocked root');
  const followUp = await create(h, 'Blocked follow-up');
  assert.equal((await h.addHabitDependency({
    dependentSource: 'existing', parentHabitId: root.id, dependentHabitId: followUp.id,
    dependencyType: 'follow_up', effectiveFrom: ACTIVE_FROM, effectiveTo: ACTIVE_TO,
  })).ok, true);
  const noApplicable = await create(h, 'No-app routine');
  const weekly = await create(h, 'Wednesday only', undefined, scheduleFixture('weekly'));
  await attach(h, noApplicable.id, weekly.id, 'routine_step');

  const today = await scheduleSummary(h, ACTIVE_FROM);
  assert.equal(today.localDate, ACTIVE_FROM);
  assert.equal(today.rootCount, 1);
  assert.equal(today.scheduledActionCount, 1);
  assert.equal(today.unavailableActionCount, 1);
  const blocked = today.groupedEntries[0].directScheduledActions.find(({ habitId }) => habitId === followUp.id);
  assert.equal(blocked?.availability, 'blocked');
  assert.equal(blocked?.countsAsScheduledAction, false);
  assert.equal(today.groupedEntries.some(({ rootHabitId }) => rootHabitId === noApplicable.id), false);

  const tomorrow = await scheduleSummary(h, AUGUST_2);
  assert.equal(tomorrow.localDate, AUGUST_2);
  assert.equal(tomorrow.rootCount, 1);
  assert.equal(tomorrow.scheduledActionCount, 1);
  assert.equal(today.localDate, ACTIVE_FROM);
  const wednesday = await scheduleSummary(h, AUGUST_5);
  assert.equal(wednesday.rootCount, 2);
  assert.equal(wednesday.routineCount, 1);
});

test('likely duplicate preview normalizes title deterministically and is warning-only with no writes', async (t) => {
  const h = await createHarness(121_000); t.after(() => h.database.close());
  const first = await h.createHabit(baseCommand({ name: 'Take   Vitamins' }));
  const second = await h.createHabit(baseCommand({ name: 'take vitamins' }));
  assert.equal(first.ok && second.ok, true); if (!first.ok || !second.ok) return;
  const before = (await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habits;'))?.count;
  const preview = await h.getLikelyHabitDuplicates({
    candidate: { title: '  TAKE vitamins  ', activeFrom: ACTIVE_FROM, activeTo: ACTIVE_TO, schedule: scheduleFixture('daily'), scope: 'root' },
  });
  assert.equal(preview.ok, true, preview.ok ? '' : preview.error.message);
  if (!preview.ok) return;
  assert.equal(preview.value.normalizedCandidateTitle, 'take vitamins');
  assert.equal(preview.value.warningOnly, true);
  assert.equal(preview.value.archivedHabitPolicy, 'excluded');
  assert.deepEqual(preview.value.matches.map(({ habitId }) => habitId), [first.value.id, second.value.id].sort());
  assert.ok(preview.value.matches.every(({ reason, confidence }) => reason === 'exact_title_and_schedule_overlap' && confidence === 'exact_title_and_schedule_overlap'));
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habits;'))?.count, before);
});

test('likely duplicate preview excludes different schedules, disjoint ranges, archived habits, and incompatible child scope', async (t) => {
  const h = await createHarness(122_000); t.after(() => h.database.close());
  const root = await create(h, 'Candidate');
  const child = await create(h, 'Candidate');
  await attach(h, root.id, child.id, 'organizational');
  const different = await h.createHabit(baseCommand({ name: 'Candidate', schedule: scheduleFixture('selected_weekdays') }));
  const disjoint = await h.createHabit(baseCommand({
    name: 'Candidate', activeFrom: '2026-09-01' as PlannerLocalDate, activeTo: '2026-10-01' as PlannerLocalDate,
    schedule: scheduleFixture('daily', date('2026-09-01'), date('2026-10-01')),
    tracking: trackingFixture('checkbox', date('2026-09-01'), date('2026-10-01')),
  }));
  const archived = await h.createHabit(baseCommand({ name: 'Candidate' }));
  assert.equal(different.ok && disjoint.ok && archived.ok, true); if (!different.ok || !disjoint.ok || !archived.ok) return;
  assert.equal((await h.archiveHabit({ habitId: archived.value.id, effectiveLocalDate: ACTIVE_FROM, boundaryTimezone: LONDON })).ok, true);
  const rootPreview = await h.getLikelyHabitDuplicates({ candidate: { title: 'Candidate', activeFrom: ACTIVE_FROM, activeTo: ACTIVE_TO, schedule: scheduleFixture('daily'), scope: 'root' } });
  assert.equal(rootPreview.ok, true); if (!rootPreview.ok) return;
  assert.deepEqual(rootPreview.value.matches.map(({ habitId }) => habitId), [root.id]);
  const childPreview = await h.getLikelyHabitDuplicates({ candidate: { title: 'Candidate', activeFrom: ACTIVE_FROM, activeTo: ACTIVE_TO, schedule: scheduleFixture('daily'), scope: 'child' } });
  assert.equal(childPreview.ok, true); if (childPreview.ok) assert.deepEqual(childPreview.value.matches.map(({ habitId }) => habitId), [child.id]);
  const none = await h.getLikelyHabitDuplicates({ candidate: { title: 'Other', activeFrom: ACTIVE_FROM, activeTo: ACTIVE_TO, schedule: scheduleFixture('daily'), scope: 'root' } });
  assert.equal(none.ok, true); if (none.ok) assert.deepEqual(none.value.matches, []);
});

async function create(
  h: TestHarness,
  name: string,
  tracking = trackingFixture('checkbox'),
  schedule = scheduleFixture('daily'),
): Promise<HabitAggregate> {
  const result = await h.createHabit(baseCommand({ name, tracking, schedule }));
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

async function attach(
  h: TestHarness,
  parentHabitId: PlannerId,
  childHabitId: PlannerId,
  completionRole: 'organizational' | 'routine_step',
): Promise<void> {
  const result = await h.changeOrdinaryParent({ action: 'attach', parentHabitId, childHabitId, effectiveLocalDate: ACTIVE_FROM, completionRole });
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
}

async function occurrences(h: TestHarness, selectedLocalDate: PlannerLocalDate) {
  const result = await h.getPlannerOccurrencesForDate({ selectedLocalDate, evaluationBoundary: selectedLocalDate });
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function group(model: Awaited<ReturnType<typeof occurrences>>, habitId: PlannerId) {
  const found = model.rootGroups.find(({ rootHabitId }) => rootHabitId === habitId);
  assert.ok(found, `Missing group ${habitId}`);
  return found;
}

async function scheduleSummary(h: TestHarness, localDate: PlannerLocalDate) {
  const result = await h.getPlannerScheduleSummaryForDate({ localDate, evaluationBoundary: localDate });
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function checkboxRecord(habitId: PlannerId, occurrenceLocalDate: PlannerLocalDate) {
  return { habitId, occurrenceLocalDate, occurrenceTimezone: LONDON, value: { type: 'checkbox' as const, booleanValue: true } };
}

async function insertOrdinaryRow(
  h: TestHarness,
  id: PlannerId,
  relationshipId: PlannerId,
  parentHabitId: PlannerId,
  childHabitId: PlannerId,
): Promise<void> {
  await h.database.runAsync(
    `INSERT INTO habit_ordinary_parent_versions(id,relationship_id,version_number,parent_habit_id,child_habit_id,completion_role,effective_from,effective_to,end_reason,created_at,updated_at)
     VALUES($id,$relationship,1,$parent,$child,'organizational',$from,$to,'scheduled_end',$now,$now);`,
    { $id: id, $relationship: relationshipId, $parent: parentHabitId, $child: childHabitId, $from: ACTIVE_FROM, $to: ACTIVE_TO, $now: FIXED_NOW },
  );
}

function date(value: string): PlannerLocalDate {
  return domainValue(parsePlannerLocalDate(value));
}

function time(value: string) {
  return domainValue(parsePlannerLocalTime(value));
}
