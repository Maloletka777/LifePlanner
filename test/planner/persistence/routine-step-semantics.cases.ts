import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExactQuantity,
  parsePlannerLocalDate,
  validateTrackingDefinition,
  type PlannerId,
  type PlannerLocalDate,
  type TrackingDefinition,
} from '../../../src/features/planner/domain';
import type { HabitAggregate } from '../../../src/features/planner/repositories';
import {
  ACTIVE_FROM,
  ACTIVE_TO,
  LONDON,
  baseCommand,
  createHarness,
  domainValue,
  scheduleFixture,
  tableCount,
  trackingFixture,
  type TestHarness,
} from './test-fixtures';

const AUGUST_2 = date('2026-08-02');
const AUGUST_5 = date('2026-08-05');

test('simple roots of every supported tracking mode retain independent selected-date actions', async (t) => {
  const h = await createHarness(89_000); t.after(() => h.database.close());
  const roots = [];
  for (const trackingMode of ['checkbox', 'avoidance', 'counter', 'duration', 'quantity'] as const) {
    roots.push(await create(h, `Routine-looking ${trackingMode}`, trackingFixture(trackingMode)));
  }

  const model = await read(h, ACTIVE_FROM);
  assert.deepEqual(model.rootProgress, {
    completedRootCount: 0,
    scheduledRootCount: 5,
    remainingRootCount: 5,
  });
  for (const root of roots) {
    assert.deepEqual(group(model, root.id).routineContainer, {
      completionSource: 'independent_observation',
      isRoutineContainer: false,
      hasIndependentCompletionAction: true,
      ordinaryStepCount: 0,
      completedOrdinaryStepCount: 0,
      remainingOrdinaryStepCount: 0,
      exactProgress: null,
      displayProgress: null,
      isCanonicallyComplete: false,
      applicability: 'not_container',
    });
  }
});

test('organizational relationships remain independent and conditional relationships never create containers', async (t) => {
  const h = await createHarness(90_000); t.after(() => h.database.close());
  const parent = await create(h, 'Organizational parent');
  const child = await create(h, 'Organizational child');
  const conditional = await create(h, 'Conditional child');
  const attached = await h.changeOrdinaryParent({
    action: 'attach', childHabitId: child.id, parentHabitId: parent.id,
    effectiveLocalDate: ACTIVE_FROM,
  });
  assert.equal(attached.ok, true, attached.ok ? '' : attached.error.message);
  if (attached.ok) assert.equal(attached.value.completionRole, 'organizational');
  assert.equal((await h.addHabitDependency({
    dependentSource: 'existing', parentHabitId: parent.id, dependentHabitId: conditional.id,
    dependencyType: 'follow_up', effectiveFrom: ACTIVE_FROM, effectiveTo: ACTIVE_TO,
  })).ok, true);

  const model = await read(h, ACTIVE_FROM);
  const parentGroup = group(model, parent.id);
  assert.deepEqual(parentGroup.routineContainer, {
    completionSource: 'independent_observation',
    isRoutineContainer: false,
    hasIndependentCompletionAction: true,
    ordinaryStepCount: 0,
    completedOrdinaryStepCount: 0,
    remainingOrdinaryStepCount: 0,
    exactProgress: null,
    displayProgress: null,
    isCanonicallyComplete: false,
    applicability: 'not_container',
  });
  assert.equal(parentGroup.rows[0]?.routineContainer, parentGroup.routineContainer);
  assert.equal((await h.recordHabitObservation(checkboxRecord(parent.id, ACTIVE_FROM))).ok, true);
  assert.equal(
    (await h.database.getFirstAsync<{ completion_role: string }>(
      'SELECT completion_role FROM habit_ordinary_parent_versions WHERE child_habit_id=$child;',
      { $child: child.id },
    ))?.completion_role,
    'organizational',
  );
});

test('one or many routine steps derive exact bounded container and selected-root progress', async (t) => {
  const h = await createHarness(91_000); t.after(() => h.database.close());
  const parent = await create(h, 'Routine');
  const first = await create(h, 'First step');
  const second = await create(h, 'Second step');
  await attachStep(h, parent.id, first.id);
  await attachStep(h, parent.id, second.id);

  let model = await read(h, ACTIVE_FROM);
  let container = group(model, parent.id).routineContainer;
  assert.equal(container.isRoutineContainer, true);
  assert.equal(container.hasIndependentCompletionAction, false);
  assert.equal(container.ordinaryStepCount, 2);
  assert.deepEqual(container.exactProgress, { numerator: 0n, denominator: 1n });
  assert.deepEqual(model.rootProgress, { completedRootCount: 0, scheduledRootCount: 1, remainingRootCount: 1 });
  const blockedParentWrite = await h.recordHabitObservation(checkboxRecord(parent.id, ACTIVE_FROM));
  assert.equal(blockedParentWrite.ok, false);
  if (!blockedParentWrite.ok) assert.equal(blockedParentWrite.error.code, 'observation_routine_container_derived');
  assert.equal(await observationsFor(h, parent.id), 0);

  assert.equal((await h.recordHabitObservation(checkboxRecord(first.id, ACTIVE_FROM))).ok, true);
  model = await read(h, ACTIVE_FROM);
  container = group(model, parent.id).routineContainer;
  assert.equal(container.completedOrdinaryStepCount, 1);
  assert.equal(container.remainingOrdinaryStepCount, 1);
  assert.deepEqual(container.exactProgress, { numerator: 1n, denominator: 2n });
  assert.equal(container.displayProgress, 0.5);
  assert.equal(container.isCanonicallyComplete, false);

  assert.equal((await h.recordHabitObservation(checkboxRecord(second.id, ACTIVE_FROM))).ok, true);
  model = await read(h, ACTIVE_FROM);
  container = group(model, parent.id).routineContainer;
  assert.equal(container.completedOrdinaryStepCount, 2);
  assert.equal(container.remainingOrdinaryStepCount, 0);
  assert.deepEqual(container.exactProgress, { numerator: 1n, denominator: 1n });
  assert.equal(container.isCanonicallyComplete, true);
  assert.deepEqual(model.rootProgress, { completedRootCount: 1, scheduledRootCount: 1, remainingRootCount: 0 });
  assert.equal(await observationsFor(h, parent.id), 0);
});

test('routine progress keeps metric partial credit and blocked applicable steps in the direct denominator', async (t) => {
  const h = await createHarness(92_000); t.after(() => h.database.close());
  const parent = await create(h, 'Measured routine');
  const quantityStep = await create(h, 'Water step', trackingFixture('quantity'));
  const gatedStep = await create(h, 'Gated step');
  const prerequisite = await create(h, 'Prerequisite');
  await attachStep(h, parent.id, quantityStep.id);
  await attachStep(h, parent.id, gatedStep.id);
  assert.equal((await h.addHabitDependency({
    dependentSource: 'existing', parentHabitId: gatedStep.id, dependentHabitId: prerequisite.id,
    dependencyType: 'prerequisite', effectiveFrom: ACTIVE_FROM, effectiveTo: ACTIVE_TO,
  })).ok, true);
  assert.equal((await h.recordHabitObservation(checkboxRecord(gatedStep.id, ACTIVE_FROM))).ok, true);
  assert.equal((await h.recordHabitObservation({
    habitId: quantityStep.id,
    occurrenceLocalDate: ACTIVE_FROM,
    occurrenceTimezone: LONDON,
    value: { type: 'quantity', quantity: domainValue(createExactQuantity({ significand: 125n, scale: 2 })) },
  })).ok, true);

  const model = await read(h, ACTIVE_FROM);
  const container = group(model, parent.id).routineContainer;
  assert.equal(group(model, gatedStep.id).rows[0]?.state, 'prerequisite_blocked_parent');
  assert.equal(container.ordinaryStepCount, 2);
  assert.equal(container.completedOrdinaryStepCount, 0);
  assert.deepEqual(container.exactProgress, { numerator: 5n, denominator: 16n });
  assert.equal(container.displayProgress, 0.3125);
});

test('parent and child scheduling produce explicit no-applicable and parent-bounded states', async (t) => {
  const h = await createHarness(93_000); t.after(() => h.database.close());
  const parent = await create(h, 'Daily parent');
  const weeklyChild = await create(h, 'Wednesday step', trackingFixture('checkbox'), scheduleFixture('weekly'));
  await attachStep(h, parent.id, weeklyChild.id);
  const outerParent = await create(h, 'Wednesday parent', trackingFixture('checkbox'), scheduleFixture('weekly'));
  const dailyChild = await create(h, 'Daily bounded step');
  await attachStep(h, outerParent.id, dailyChild.id);

  const saturday = await read(h, ACTIVE_FROM);
  const noApplicable = group(saturday, parent.id).routineContainer;
  assert.deepEqual(noApplicable, {
    completionSource: 'ordinary_children_derived',
    isRoutineContainer: false,
    hasIndependentCompletionAction: false,
    ordinaryStepCount: 0,
    completedOrdinaryStepCount: 0,
    remainingOrdinaryStepCount: 0,
    exactProgress: null,
    displayProgress: null,
    isCanonicallyComplete: false,
    applicability: 'no_applicable_steps',
  });
  assert.equal(saturday.rootGroups.some(({ rootHabitId }) => rootHabitId === dailyChild.id), false);
  assert.deepEqual(saturday.rootProgress, { completedRootCount: 0, scheduledRootCount: 0, remainingRootCount: 0 });

  const wednesday = await read(h, AUGUST_5);
  assert.equal(group(wednesday, parent.id).routineContainer.applicability, 'applicable');
  assert.equal(group(wednesday, outerParent.id).routineContainer.applicability, 'applicable');
  assert.equal(wednesday.rootProgress.scheduledRootCount, 2);
});

test('skipped steps are excluded while provisional, future, and blocked steps retain bounded applicability', async (t) => {
  const h = await createHarness(93_500); t.after(() => h.database.close());
  const skippedParent = await create(h, 'Skipped parent');
  const skippedStep = await create(h, 'Skipped step');
  await attachStep(h, skippedParent.id, skippedStep.id);
  assert.equal((await h.recordHabitObservation({
    habitId: skippedStep.id,
    occurrenceLocalDate: ACTIVE_FROM,
    occurrenceTimezone: LONDON,
    value: { type: 'skipped' },
  })).ok, true);

  const atMost = domainValue(validateTrackingDefinition({
    trackingMode: 'counter',
    comparisonOperator: 'at_most',
    target: { significand: 10n, scale: 0 },
    unit: { unitType: 'standard', standardUnitCode: 'session' },
    effectiveFrom: ACTIVE_FROM,
    effectiveTo: ACTIVE_TO,
  }));
  const provisionalParent = await create(h, 'Provisional parent');
  const provisionalStep = await create(h, 'Provisional step', atMost);
  await attachStep(h, provisionalParent.id, provisionalStep.id);
  assert.equal((await h.recordHabitObservation({
    habitId: provisionalStep.id,
    occurrenceLocalDate: ACTIVE_FROM,
    occurrenceTimezone: LONDON,
    value: { type: 'counter', counterDelta: 5 },
  })).ok, true);

  const current = await read(h, ACTIVE_FROM);
  assert.equal(group(current, skippedParent.id).routineContainer.applicability, 'no_applicable_steps');
  assert.equal(group(current, skippedParent.id).routineContainer.ordinaryStepCount, 0);
  assert.equal(group(current, provisionalParent.id).rows[0]?.routineContainer?.applicability, 'applicable');
  assert.equal(group(current, provisionalParent.id).routineContainer.ordinaryStepCount, 1);
  assert.deepEqual(group(current, provisionalParent.id).routineContainer.exactProgress, { numerator: 0n, denominator: 1n });

  const futureResult = await h.getPlannerOccurrencesForDate({
    selectedLocalDate: AUGUST_2,
    evaluationBoundary: ACTIVE_FROM,
  });
  assert.equal(futureResult.ok, true, futureResult.ok ? '' : futureResult.error.message);
  if (!futureResult.ok) return;
  assert.equal(group(futureResult.value, provisionalParent.id).routineContainer.ordinaryStepCount, 1);
  assert.deepEqual(group(futureResult.value, provisionalParent.id).routineContainer.exactProgress, { numerator: 0n, denominator: 1n });
});

test('nested routine containers contribute once without flattening descendants', async (t) => {
  const h = await createHarness(94_000); t.after(() => h.database.close());
  const root = await create(h, 'Root routine');
  const nested = await create(h, 'Nested routine');
  const first = await create(h, 'Nested first');
  const second = await create(h, 'Nested second');
  await attachStep(h, root.id, nested.id);
  await attachStep(h, nested.id, first.id);
  await attachStep(h, nested.id, second.id);

  assert.equal((await h.recordHabitObservation(checkboxRecord(first.id, ACTIVE_FROM))).ok, true);
  let model = await read(h, ACTIVE_FROM);
  assert.equal(group(model, root.id).routineContainer.ordinaryStepCount, 1);
  assert.equal(group(model, nested.id).routineContainer.ordinaryStepCount, 2);
  assert.deepEqual(group(model, nested.id).routineContainer.exactProgress, { numerator: 1n, denominator: 2n });
  assert.deepEqual(group(model, root.id).routineContainer.exactProgress, { numerator: 1n, denominator: 2n });
  assert.deepEqual(model.rootProgress, { completedRootCount: 0, scheduledRootCount: 1, remainingRootCount: 1 });

  assert.equal((await h.recordHabitObservation(checkboxRecord(second.id, ACTIVE_FROM))).ok, true);
  model = await read(h, ACTIVE_FROM);
  assert.equal(group(model, root.id).routineContainer.isCanonicallyComplete, true);
  assert.deepEqual(model.rootProgress, { completedRootCount: 1, scheduledRootCount: 1, remainingRootCount: 0 });
  assert.deepEqual(model.rootGroups.map(({ rootHabitId }) => rootHabitId), [root.id, nested.id, first.id, second.id]);
});

test('last-step detach and child archive restore independent parent semantics at the effective boundary', async (t) => {
  const h = await createHarness(95_000); t.after(() => h.database.close());
  const parent = await create(h, 'Boundary parent');
  const child = await create(h, 'Boundary step');
  await attachStep(h, parent.id, child.id);
  assert.equal(group(await read(h, ACTIVE_FROM), parent.id).routineContainer.isRoutineContainer, true);
  const detached = await h.changeOrdinaryParent({
    action: 'detach', childHabitId: child.id, parentHabitId: null,
    effectiveLocalDate: AUGUST_2,
  });
  assert.equal(detached.ok, true, detached.ok ? '' : detached.error.message);
  let after = await read(h, AUGUST_2);
  assert.equal(group(after, parent.id).routineContainer.isRoutineContainer, false);
  assert.equal(after.rootProgress.scheduledRootCount, 2);
  assert.equal((await h.recordHabitObservation(checkboxRecord(parent.id, AUGUST_2))).ok, true);

  const archivedParent = await create(h, 'Archive parent');
  const archivedChild = await create(h, 'Archive step');
  await attachStep(h, archivedParent.id, archivedChild.id);
  assert.equal((await h.archiveHabit({
    habitId: archivedChild.id, effectiveLocalDate: ACTIVE_FROM, boundaryTimezone: LONDON,
  })).ok, true);
  assert.equal((await h.restoreHabit({
    habitId: archivedChild.id, effectiveLocalDate: ACTIVE_FROM, boundaryTimezone: LONDON,
  })).ok, true);
  after = await read(h, AUGUST_2);
  assert.equal(group(after, archivedParent.id).routineContainer.isRoutineContainer, false);

  const deletedParent = await create(h, 'Delete parent');
  const deletedChild = await create(h, 'Delete step');
  await attachStep(h, deletedParent.id, deletedChild.id);
  assert.equal((await h.permanentlyDeleteHabit({
    habitId: deletedChild.id,
    effectiveLocalDate: ACTIVE_FROM,
    boundaryTimezone: LONDON,
    confirmed: true,
  })).ok, true);
  after = await read(h, ACTIVE_FROM);
  assert.equal(group(after, deletedParent.id).routineContainer.isRoutineContainer, false);

  const expiringParent = await create(h, 'Expiring parent');
  const expiringResult = await h.createHabit(baseCommand({
    name: 'Expiring step',
    activeTo: AUGUST_2,
    schedule: scheduleFixture('daily', ACTIVE_FROM, AUGUST_2),
    tracking: trackingFixture('checkbox', ACTIVE_FROM, AUGUST_2),
  }));
  if (!expiringResult.ok) assert.fail(expiringResult.error.message);
  await attachStep(h, expiringParent.id, expiringResult.value.id);
  assert.equal(group(await read(h, ACTIVE_FROM), expiringParent.id).routineContainer.isRoutineContainer, true);
  assert.equal(group(await read(h, AUGUST_2), expiringParent.id).routineContainer.isRoutineContainer, false);

  const roleParent = await create(h, 'Role boundary parent');
  const roleChild = await create(h, 'Role boundary step');
  await attachStep(h, roleParent.id, roleChild.id);
  const roleChanged = await h.changeOrdinaryParent({
    action: 'reparent', childHabitId: roleChild.id, parentHabitId: roleParent.id,
    effectiveLocalDate: AUGUST_2, completionRole: 'organizational',
  });
  assert.equal(roleChanged.ok, true, roleChanged.ok ? '' : roleChanged.error.message);
  assert.equal(group(await read(h, ACTIVE_FROM), roleParent.id).routineContainer.isRoutineContainer, true);
  assert.equal(group(await read(h, AUGUST_2), roleParent.id).routineContainer.isRoutineContainer, false);
  assert.deepEqual(
    (await h.database.getAllAsync<{ completion_role: string; effective_from: string; effective_to: string | null }>(
      'SELECT completion_role,effective_from,effective_to FROM habit_ordinary_parent_versions WHERE child_habit_id=$child ORDER BY effective_from;',
      { $child: roleChild.id },
    )).map((row) => ({ ...row })),
    [
      { completion_role: 'routine_step', effective_from: ACTIVE_FROM, effective_to: AUGUST_2 },
      { completion_role: 'organizational', effective_from: AUGUST_2, effective_to: ACTIVE_TO },
    ],
  );
});

test('legacy metric parent history remains append-only while new container observations are refused', async (t) => {
  const h = await createHarness(96_000); t.after(() => h.database.close());
  const parent = await create(h, 'Legacy metric parent', trackingFixture('quantity'));
  const child = await create(h, 'Future step');
  const initial = await h.recordHabitObservation({
    habitId: parent.id,
    occurrenceLocalDate: ACTIVE_FROM,
    occurrenceTimezone: LONDON,
    value: { type: 'quantity', quantity: domainValue(createExactQuantity({ significand: 100n, scale: 2 })) },
  });
  assert.equal(initial.ok, true, initial.ok ? '' : initial.error.message);
  if (!initial.ok) return;
  const sameDateParentFact = await h.recordHabitObservation({
    habitId: parent.id,
    occurrenceLocalDate: AUGUST_2,
    occurrenceTimezone: LONDON,
    value: { type: 'quantity', quantity: domainValue(createExactQuantity({ significand: 200n, scale: 2 })) },
  });
  assert.equal(sameDateParentFact.ok, true, sameDateParentFact.ok ? '' : sameDateParentFact.error.message);
  const attached = await h.changeOrdinaryParent({
    action: 'attach', childHabitId: child.id, parentHabitId: parent.id,
    effectiveLocalDate: AUGUST_2, completionRole: 'routine_step',
  });
  assert.equal(attached.ok, true, attached.ok ? '' : attached.error.message);
  const correction = await h.correctHabitObservation({
    observationId: initial.value.id,
    correctionReason: 'correct_value',
    correctedOccurrenceLocalDate: ACTIVE_FROM,
    correctedOccurrenceTimezone: LONDON,
    replacement: { type: 'quantity', quantity: domainValue(createExactQuantity({ significand: 150n, scale: 2 })) },
  });
  assert.equal(correction.ok, true, correction.ok ? '' : correction.error.message);
  if (!correction.ok) return;
  const voided = await h.correctHabitObservation({
    observationId: correction.value.currentLeaf.id,
    correctionReason: 'reversal',
    correctedOccurrenceLocalDate: ACTIVE_FROM,
    correctedOccurrenceTimezone: LONDON,
    replacement: { type: 'void' },
  });
  assert.equal(voided.ok, true, voided.ok ? '' : voided.error.message);
  const refused = await h.recordHabitObservation({
    habitId: parent.id,
    occurrenceLocalDate: AUGUST_2,
    occurrenceTimezone: LONDON,
    value: { type: 'quantity', quantity: domainValue(createExactQuantity({ significand: 50n, scale: 2 })) },
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, 'observation_routine_container_derived');
  assert.equal(await observationsFor(h, parent.id), 4);
  const chain = await h.unitOfWork.loadObservationChain(initial.value.id);
  assert.equal(chain.ok, true);
  if (chain.ok) {
    assert.equal(chain.value?.facts.length, 3);
    assert.equal(chain.value?.isVoided, true);
  }
  const model = await read(h, AUGUST_2);
  assert.deepEqual(group(model, parent.id).routineContainer.exactProgress, { numerator: 0n, denominator: 1n });
  assert.equal(group(model, parent.id).routineContainer.isCanonicallyComplete, false);
});

test('bundle creation persists organizational and routine-step roles atomically with stable child identity', async (t) => {
  const h = await createHarness(97_000); t.after(() => h.database.close());
  const saved = await h.createHabitBundle({ habits: [
    { parentIndex: null, command: baseCommand({ name: 'Bundle parent' }) },
    { parentIndex: 0, relationshipMode: 'ordinary', completionRole: 'organizational', command: baseCommand({ name: 'Organized child' }) },
    { parentIndex: 0, relationshipMode: 'ordinary', completionRole: 'routine_step', command: baseCommand({ name: 'Visible step' }) },
  ] });
  assert.equal(saved.ok, true, saved.ok ? '' : saved.error.message);
  if (!saved.ok) return;
  const roles = await h.database.getAllAsync<{ child_habit_id: string; completion_role: string }>(
    'SELECT child_habit_id,completion_role FROM habit_ordinary_parent_versions ORDER BY child_habit_id;',
  );
  assert.deepEqual(roles.map((row) => ({ ...row })), [
    { child_habit_id: saved.value[1].id, completion_role: 'organizational' },
    { child_habit_id: saved.value[2].id, completion_role: 'routine_step' },
  ].sort((left, right) => left.child_habit_id.localeCompare(right.child_habit_id)));
  assert.equal(group(await read(h, ACTIVE_FROM), saved.value[0].id).routineContainer.ordinaryStepCount, 1);

  const rollback = await createHarness(98_000); t.after(() => rollback.database.close());
  await rollback.database.execAsync(`CREATE TEMP TRIGGER fail_explicit_step BEFORE INSERT ON habit_ordinary_parent_versions WHEN NEW.completion_role='routine_step' BEGIN SELECT RAISE(ABORT,'forced role failure'); END;`);
  const failed = await rollback.createHabitBundle({ habits: [
    { parentIndex: null, command: baseCommand({ name: 'Rollback parent' }) },
    { parentIndex: 0, relationshipMode: 'ordinary', completionRole: 'routine_step', command: baseCommand({ name: 'Rollback step' }) },
  ] });
  assert.equal(failed.ok, false);
  assert.equal(await tableCount(rollback.database, 'habits'), 0);
  assert.equal(await tableCount(rollback.database, 'habit_ordinary_parent_versions'), 0);
});

test('atomic bundles support one, two, five, ten, and safely nested routine steps', async () => {
  for (const childCount of [1, 2, 5, 10]) {
    const h = await createHarness(99_000 + childCount * 100);
    try {
      const saved = await h.createHabitBundle({ habits: [
        { parentIndex: null, command: baseCommand({ name: `Routine ${childCount}` }) },
        ...Array.from({ length: childCount }, (_, index) => ({
          parentIndex: 0,
          relationshipMode: 'ordinary' as const,
          completionRole: 'routine_step' as const,
          command: baseCommand({ name: `Step ${index + 1}` }),
        })),
      ] });
      assert.equal(saved.ok, true, saved.ok ? '' : saved.error.message);
      if (!saved.ok) continue;
      assert.equal(new Set(saved.value.map(({ id }) => id)).size, childCount + 1);
      assert.equal(
        (await h.database.getFirstAsync<{ count: number }>(
          `SELECT count(*) AS count FROM habit_ordinary_parent_versions WHERE completion_role='routine_step';`,
        ))?.count,
        childCount,
      );
      assert.equal(group(await read(h, ACTIVE_FROM), saved.value[0].id).routineContainer.ordinaryStepCount, childCount);
    } finally {
      h.database.close();
    }
  }

  const nested = await createHarness(101_000);
  try {
    const saved = await nested.createHabitBundle({ habits: [
      { parentIndex: null, command: baseCommand({ name: 'Nested root' }) },
      { parentIndex: 0, relationshipMode: 'ordinary', completionRole: 'routine_step', command: baseCommand({ name: 'Nested container' }) },
      { parentIndex: 1, relationshipMode: 'ordinary', completionRole: 'routine_step', command: baseCommand({ name: 'Nested leaf' }) },
    ] });
    assert.equal(saved.ok, true, saved.ok ? '' : saved.error.message);
    if (!saved.ok) return;
    const model = await read(nested, ACTIVE_FROM);
    assert.equal(group(model, saved.value[0].id).routineContainer.ordinaryStepCount, 1);
    assert.equal(group(model, saved.value[1].id).routineContainer.ordinaryStepCount, 1);
  } finally {
    nested.database.close();
  }
});

test('unsupported completion roles are rejected before relationship persistence', async (t) => {
  const h = await createHarness(102_000); t.after(() => h.database.close());
  const parent = await create(h, 'Role parent');
  const child = await create(h, 'Role child');
  const result = await h.changeOrdinaryParent({
    action: 'attach', childHabitId: child.id, parentHabitId: parent.id,
    effectiveLocalDate: ACTIVE_FROM, completionRole: 'unsupported' as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'invalid_input');
  assert.equal(await tableCount(h.database, 'habit_ordinary_parent_versions'), 0);
});

async function create(
  h: TestHarness,
  name: string,
  tracking: TrackingDefinition = trackingFixture('checkbox'),
  schedule = scheduleFixture('daily'),
): Promise<HabitAggregate> {
  const result = await h.createHabit(baseCommand({ name, tracking, schedule }));
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

async function attachStep(h: TestHarness, parentHabitId: PlannerId, childHabitId: PlannerId): Promise<void> {
  const result = await h.changeOrdinaryParent({
    action: 'attach', childHabitId, parentHabitId,
    effectiveLocalDate: ACTIVE_FROM, completionRole: 'routine_step',
  });
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  if (result.ok) assert.equal(result.value.completionRole, 'routine_step');
}

async function read(h: TestHarness, selectedLocalDate: PlannerLocalDate) {
  const result = await h.getPlannerOccurrencesForDate({ selectedLocalDate, evaluationBoundary: selectedLocalDate });
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function group(model: Awaited<ReturnType<typeof read>>, habitId: PlannerId) {
  const found = model.rootGroups.find(({ rootHabitId }) => rootHabitId === habitId);
  assert.ok(found, `Missing group ${habitId}`);
  return found;
}

function checkboxRecord(habitId: PlannerId, occurrenceLocalDate: PlannerLocalDate) {
  return {
    habitId,
    occurrenceLocalDate,
    occurrenceTimezone: LONDON,
    value: { type: 'checkbox' as const, booleanValue: true },
  };
}

async function observationsFor(h: TestHarness, habitId: PlannerId): Promise<number> {
  return (await h.database.getFirstAsync<{ count: number }>(
    'SELECT count(*) AS count FROM habit_observations WHERE habit_id=$habitId;',
    { $habitId: habitId },
  ))?.count ?? -1;
}

function date(value: string): PlannerLocalDate {
  return domainValue(parsePlannerLocalDate(value));
}
