import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExactQuantity,
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  validateTrackingDefinition,
  type ImportanceLevel,
  type ObservationValue,
  type PlannerLocalDate,
  type PlannerLocalTime,
  type TrackingDefinition,
} from '../../../src/features/planner/domain';
import {
  createGetPlannerOccurrencesForDate,
  createGetPlannerDateSummariesForRange,
  type CorrectHabitObservationCommand,
  type RecordHabitObservationCommand,
  type SelectedDatePlannerOccurrenceRow,
  type SelectedDatePlannerReadModel,
} from '../../../src/features/planner/application';
import {
  ACTIVE_FROM,
  ACTIVE_TO,
  FIXED_NOW,
  LONDON,
  baseCommand,
  createHarness,
  domainValue,
  plannerId,
  scheduleFixture,
  tableCount,
  trackingFixture,
  type TestHarness,
} from './test-fixtures';

const AUGUST_3 = date('2026-08-03');
const AUGUST_10 = date('2026-08-10');
const AUGUST_15 = date('2026-08-15');
const AUGUST_20 = date('2026-08-20');

test('date markers use one bounded range request and count only visible roots', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createHabit(harness, 'Routine');
  const child = await createHabit(harness, 'Child');
  const attached = await harness.changeOrdinaryParent({
    action: 'attach',
    childHabitId: child.id,
    parentHabitId: parent.id,
    effectiveLocalDate: ACTIVE_FROM,
  });
  assert.equal(attached.ok, true);

  let rangeCalls = 0;
  let selectedDateCalls = 0;
  const unitOfWork = {
    ...harness.unitOfWork,
    loadPlannerOccurrenceData: async (selectedDate: string) => {
      selectedDateCalls += 1;
      return harness.unitOfWork.loadPlannerOccurrenceData(selectedDate);
    },
    loadPlannerOccurrenceDataRange: async (startDate: string, endDate: string) => {
      rangeCalls += 1;
      return harness.unitOfWork.loadPlannerOccurrenceDataRange(startDate, endDate);
    },
  };
  const getSummaries = createGetPlannerDateSummariesForRange({ unitOfWork });
  const result = await getSummaries({
    startDate: AUGUST_3,
    endDate: AUGUST_10,
    evaluationBoundary: AUGUST_3,
  });

  assert.equal(result.ok, true, result.ok ? 'Expected marker range success.' : result.error.message);
  assert.equal(rangeCalls, 1);
  assert.equal(selectedDateCalls, 0);
  if (result.ok) {
    assert.equal(Object.keys(result.value.summaries).length, 8);
    assert.equal(result.value.summaries[AUGUST_3]?.scheduled, 1);
    assert.deepEqual(result.value.summaries[AUGUST_3]?.indicators.map(({ habitId }) => habitId), [parent.id]);
    assert.equal(result.value.summaries[AUGUST_3]?.indicators[0]?.visualIdentity.iconKey, 'checkbox');
    assert.ok(result.value.summaries[AUGUST_3]?.indicators[0]?.visualIdentity.accentKey);
  }
});

test('selected-day progress counts only canonical roots and keeps its denominator stable', async (t) => {
  const harness = await createHarness(600);
  t.after(() => harness.database.close());
  const parent = await createHabit(harness, 'Routine root');
  const child = await createHabit(harness, 'Ordinary child');
  const secondRoot = await createHabit(harness, 'Second root');
  const alreadyCompleteRoot = await createHabit(harness, 'Already complete root');
  const blockedFollowUp = await createHabit(harness, 'Blocked follow-up');
  assert.equal((await harness.changeOrdinaryParent({
    action: 'attach',
    childHabitId: child.id,
    parentHabitId: parent.id,
    effectiveLocalDate: ACTIVE_FROM,
  })).ok, true);
  await link(harness, parent.id, blockedFollowUp.id, 'follow_up', ACTIVE_FROM, ACTIVE_TO);
  assert.equal((await harness.recordHabitObservation(record(alreadyCompleteRoot.id, checkbox(true), AUGUST_3))).ok, true);

  let model = await readModel(harness, AUGUST_3);
  assert.deepEqual(model.rootProgress, {
    completedRootCount: 1,
    scheduledRootCount: 3,
    remainingRootCount: 2,
  });
  assert.equal(findRow(model, blockedFollowUp.id).state, 'blocked');

  assert.equal((await harness.recordHabitObservation(record(child.id, checkbox(true), AUGUST_3))).ok, true);
  model = await readModel(harness, AUGUST_3);
  assert.deepEqual(model.rootProgress, {
    completedRootCount: 1,
    scheduledRootCount: 3,
    remainingRootCount: 2,
  });

  assert.equal((await harness.recordHabitObservation(record(secondRoot.id, checkbox(true), AUGUST_3))).ok, true);
  model = await readModel(harness, AUGUST_3);
  assert.deepEqual(model.rootProgress, {
    completedRootCount: 2,
    scheduledRootCount: 3,
    remainingRootCount: 1,
  });
  assert.ok(model.rootProgress.completedRootCount <= model.rootProgress.scheduledRootCount);
});

test('follow-up recording and the selected-date read model follow parent activation', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const fixture = await linkedPair(harness, 'follow_up');
  const sibling = await createHabit(harness, 'Sibling follow-up');
  await link(
    harness,
    fixture.parent.id,
    sibling.id,
    'follow_up',
    ACTIVE_FROM,
    ACTIVE_TO,
  );

  let model = await readModel(harness, AUGUST_3);
  assert.equal(findRow(model, fixture.parent.id).state, 'expected_incomplete');
  const blocked = findRow(model, fixture.dependent.id);
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.parentHabitId, fixture.parent.id);
  assert.equal(blocked.depth, 1);
  assertObservationError(
    await harness.recordHabitObservation(
      record(fixture.dependent.id, checkbox(true), AUGUST_3),
    ),
    'observation_dependency_blocked',
  );

  const parentFact = await harness.recordHabitObservation(
    record(fixture.parent.id, checkbox(true), AUGUST_3),
  );
  assert.equal(parentFact.ok, true);
  model = await readModel(harness, AUGUST_3);
  assert.equal(findRow(model, fixture.parent.id).state, 'qualified');
  assert.equal(findRow(model, fixture.dependent.id).state, 'expected_incomplete');
  assert.equal(findRow(model, sibling.id).state, 'expected_incomplete');

  const dependentFact = await harness.recordHabitObservation(
    record(fixture.dependent.id, checkbox(true), AUGUST_3),
  );
  assert.equal(dependentFact.ok, true);
  if (!dependentFact.ok) return;
  assert.equal(dependentFact.value.scheduleVersionId, fixture.parent.scheduleVersion.id);
  assert.equal(dependentFact.value.trackingVersionId, fixture.dependent.trackingVersion.id);
  assert.equal(dependentFact.value.importanceVersionId, fixture.dependent.importanceVersion.id);
  assert.equal(dependentFact.value.dependencyVersionId, fixture.relationship.id);

  model = await readModel(harness, AUGUST_3);
  assert.equal(findRow(model, fixture.parent.id).state, 'qualified');
  assert.equal(findRow(model, fixture.dependent.id).state, 'qualified');
  assert.equal(await tableCount(harness.database, 'habit_observations'), 2);
  const facts = await harness.database.getAllAsync<{ habit_id: string }>(
    'SELECT habit_id FROM habit_observations ORDER BY habit_id;',
  );
  assert.deepEqual(
    facts.map(({ habit_id }) => habit_id).sort(),
    [fixture.parent.id, fixture.dependent.id].sort(),
  );
});

test('parent qualification never transfers observations, tracking identity, or totals to a follow-up', async () => {
  const cases = [
    { mode: 'checkbox', value: checkbox(true) },
    { mode: 'avoidance', value: { type: 'avoidance', booleanValue: true } as ObservationValue },
    { mode: 'counter', value: { type: 'counter', counterDelta: 3 } as ObservationValue },
    { mode: 'quantity', value: quantity(200, 2) },
    { mode: 'duration', value: { type: 'duration', durationSeconds: 2700 } as ObservationValue },
  ] as const;

  for (let index = 0; index < cases.length; index += 1) {
    const current = cases[index];
    const harness = await createHarness(10_000 + index * 100);
    try {
      const tracking = trackingFixture(current.mode);
      const fixture = await linkedPair(harness, 'follow_up', tracking, tracking);
      const parentFact = await harness.recordHabitObservation(
        record(fixture.parent.id, current.value, AUGUST_3),
      );
      assert.equal(parentFact.ok, true, current.mode);
      if (!parentFact.ok) continue;

      let model = await readModel(harness, AUGUST_3);
      const parentRow = findRow(model, fixture.parent.id);
      const dependentRow = findRow(model, fixture.dependent.id);
      assert.equal(parentRow.state, 'qualified', current.mode);
      assert.equal(dependentRow.state, 'expected_incomplete', current.mode);
      assert.equal(dependentRow.currentObservation.currentLeafCount, 0, current.mode);
      assert.equal(dependentActual(dependentRow), zeroActual(current.mode), current.mode);

      let facts = await observationIdentityRows(harness);
      assert.deepEqual(facts, [{
        habit_id: fixture.parent.id,
        tracking_version_id: fixture.parent.trackingVersion.id,
        dependency_version_id: null,
      }], current.mode);

      const dependentFact = await harness.recordHabitObservation(
        record(fixture.dependent.id, current.value, AUGUST_3),
      );
      assert.equal(dependentFact.ok, true, current.mode);
      if (!dependentFact.ok) continue;
      assert.equal(dependentFact.value.trackingVersionId, fixture.dependent.trackingVersion.id, current.mode);
      assert.notEqual(dependentFact.value.trackingVersionId, fixture.parent.trackingVersion.id, current.mode);

      model = await readModel(harness, AUGUST_3);
      assert.equal(findRow(model, fixture.dependent.id).state, 'qualified', current.mode);
      assert.equal(dependentActual(findRow(model, fixture.parent.id)), completedActual(current.mode), current.mode);
      assert.equal(dependentActual(findRow(model, fixture.dependent.id)), completedActual(current.mode), current.mode);

      facts = await observationIdentityRows(harness);
      assert.deepEqual(facts, [
        {
          habit_id: fixture.parent.id,
          tracking_version_id: fixture.parent.trackingVersion.id,
          dependency_version_id: null,
        },
        {
          habit_id: fixture.dependent.id,
          tracking_version_id: fixture.dependent.trackingVersion.id,
          dependency_version_id: fixture.relationship.id,
        },
      ], current.mode);

      const restartedQuery = createGetPlannerOccurrencesForDate({ unitOfWork: harness.unitOfWork });
      const restartedResult = await restartedQuery({
        selectedLocalDate: AUGUST_3,
        evaluationBoundary: AUGUST_3,
      });
      assert.equal(restartedResult.ok, true, current.mode);
      if (!restartedResult.ok) continue;
      const restartedReadback = restartedResult.value;
      assert.equal(findRow(restartedReadback, fixture.parent.id).state, 'qualified', current.mode);
      assert.equal(findRow(restartedReadback, fixture.dependent.id).state, 'qualified', current.mode);
    } finally {
      harness.database.close();
    }
  }
});

test('parent and dependent corrections remain isolated across canonical readback', async (t) => {
  const harness = await createHarness(20_000);
  t.after(() => harness.database.close());
  const fixture = await linkedPair(harness, 'follow_up');
  const parentFact = await harness.recordHabitObservation(
    record(fixture.parent.id, checkbox(true), AUGUST_3),
  );
  assert.equal(parentFact.ok, true);
  if (!parentFact.ok) return;
  const dependentFact = await harness.recordHabitObservation(
    record(fixture.dependent.id, checkbox(true), AUGUST_3),
  );
  assert.equal(dependentFact.ok, true);
  if (!dependentFact.ok) return;

  const dependentCorrection = await harness.correctHabitObservation(
    correction(dependentFact.value.id, checkbox(false), AUGUST_3),
  );
  assert.equal(dependentCorrection.ok, true);
  let model = await readModel(harness, AUGUST_3);
  assert.equal(dependentActual(findRow(model, fixture.parent.id)), 'checkbox:true');
  assert.equal(dependentActual(findRow(model, fixture.dependent.id)), 'checkbox:false');

  const parentCorrection = await harness.correctHabitObservation(
    correction(parentFact.value.id, checkbox(false), AUGUST_3),
  );
  assert.equal(parentCorrection.ok, true);
  model = await readModel(harness, AUGUST_3);
  const parentRow = findRow(model, fixture.parent.id);
  const dependentRow = findRow(model, fixture.dependent.id);
  assert.equal(parentRow.state, 'expected_incomplete');
  assert.equal(dependentRow.state, 'blocked');
  assert.equal(dependentActual(parentRow), 'checkbox:false');
  assert.equal(dependentActual(dependentRow), 'checkbox:false');
  assert.equal(dependentRow.currentObservation.currentLeafCount, 1);

  const factRows = await harness.database.getAllAsync<{
    readonly habit_id: string;
    readonly count: number;
  }>(
    `SELECT habit_id, COUNT(*) AS count
     FROM habit_observations
     GROUP BY habit_id
     ORDER BY habit_id;`,
  );
  const factsByHabit = factRows.map(({ habit_id, count }) => ({ habit_id, count }));
  assert.deepEqual(factsByHabit, [
    { habit_id: fixture.parent.id, count: 2 },
    { habit_id: fixture.dependent.id, count: 2 },
  ].sort((left, right) => left.habit_id.localeCompare(right.habit_id)));
});

test('nested dependent recording evaluates the complete activation chain', async (t) => {
  const harness = await createHarness(750);
  t.after(() => harness.database.close());
  const fixture = await linkedPair(harness, 'follow_up');
  const nested = await createHabit(harness, 'Nested follow-up');
  await link(
    harness,
    fixture.dependent.id,
    nested.id,
    'follow_up',
    ACTIVE_FROM,
    ACTIVE_TO,
  );

  assertObservationError(
    await harness.recordHabitObservation(record(nested.id, checkbox(true), AUGUST_3)),
    'observation_dependency_blocked',
  );
  await qualifyParent(harness, fixture.parent.id, AUGUST_3);
  assertObservationError(
    await harness.recordHabitObservation(record(nested.id, checkbox(true), AUGUST_3)),
    'observation_dependency_blocked',
  );
  const middle = await harness.recordHabitObservation(
    record(fixture.dependent.id, checkbox(true), AUGUST_3),
  );
  assert.equal(middle.ok, true);
  const nestedFact = await harness.recordHabitObservation(
    record(nested.id, checkbox(true), AUGUST_3),
  );
  assert.equal(nestedFact.ok, true);
  if (nestedFact.ok) {
    assert.equal(nestedFact.value.scheduleVersionId, fixture.parent.scheduleVersion.id);
    assert.notEqual(nestedFact.value.dependencyVersionId, null);
  }
});

test('prerequisite is recordable from occurrence start and gates only derived parent qualification', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const fixture = await linkedPair(harness, 'prerequisite');

  let model = await readModel(harness, AUGUST_3);
  assert.equal(findRow(model, fixture.dependent.id).state, 'expected_incomplete');
  const parent = await harness.recordHabitObservation(
    record(fixture.parent.id, checkbox(true), AUGUST_3),
  );
  assert.equal(parent.ok, true);
  model = await readModel(harness, AUGUST_3);
  assert.equal(findRow(model, fixture.parent.id).state, 'prerequisite_blocked_parent');
  assert.deepEqual(model.rootProgress, { completedRootCount: 0, scheduledRootCount: 1, remainingRootCount: 1 });

  const prerequisite = await harness.recordHabitObservation(
    record(fixture.dependent.id, checkbox(true), AUGUST_3),
  );
  assert.equal(prerequisite.ok, true);
  model = await readModel(harness, AUGUST_3);
  assert.equal(findRow(model, fixture.parent.id).state, 'qualified');
  assert.equal(findRow(model, fixture.dependent.id).state, 'qualified');
  assert.deepEqual(model.rootProgress, { completedRootCount: 1, scheduledRootCount: 1, remainingRootCount: 0 });
  assert.equal(await tableCount(harness.database, 'habit_observations'), 2);
});

test('dependent checkbox and quantity observations retain existing state/additive rules', async (t) => {
  const checkboxHarness = await createHarness();
  t.after(() => checkboxHarness.database.close());
  const checkboxPair = await linkedPair(checkboxHarness, 'follow_up');
  await qualifyParent(checkboxHarness, checkboxPair.parent.id, AUGUST_3);
  assert.equal(
    (await checkboxHarness.recordHabitObservation(
      record(checkboxPair.dependent.id, checkbox(true), AUGUST_3),
    )).ok,
    true,
  );
  assertObservationError(
    await checkboxHarness.recordHabitObservation(
      record(checkboxPair.dependent.id, checkbox(false), AUGUST_3),
    ),
    'observation_state_already_exists',
  );

  const quantityHarness = await createHarness(1000);
  t.after(() => quantityHarness.database.close());
  const quantityPair = await linkedPair(
    quantityHarness,
    'follow_up',
    trackingFixture('quantity'),
  );
  await qualifyParent(quantityHarness, quantityPair.parent.id, AUGUST_3);
  for (const value of [quantity(50, 2), quantity(75, 2)]) {
    assert.equal(
      (await quantityHarness.recordHabitObservation(
        record(quantityPair.dependent.id, value, AUGUST_3),
      )).ok,
      true,
    );
  }
  const row = findRow(await readModel(quantityHarness, AUGUST_3), quantityPair.dependent.id);
  assert.equal(row.state, 'expected_incomplete');
  assert.equal(
    row.actualTarget.trackingMode === 'quantity'
      ? row.actualTarget.actual.significand
      : null,
    125n,
  );
  assert.equal(row.currentObservation.currentLeafCount, 2);
});

test('selected occurrence exposes current additive roots and leaves for correction controls', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const habit = await createHabit(harness, 'Water', trackingFixture('quantity'));
  const first = await harness.recordHabitObservation(record(habit.id, quantity(100, 2), AUGUST_3));
  const second = await harness.recordHabitObservation(record(habit.id, quantity(50, 2), AUGUST_3));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  const corrected = await harness.correctHabitObservation(
    correction(first.value.id, quantity(25, 2), AUGUST_3),
  );
  assert.equal(corrected.ok, true);
  if (!corrected.ok) return;

  let row = findRow(await readModel(harness, AUGUST_3), habit.id);
  assert.equal(row.currentObservation.currentEntries.length, 2);
  const correctedEntry = row.currentObservation.currentEntries.find(
    (entry) => entry.rootObservationId === first.value.id,
  );
  assert.equal(correctedEntry?.currentObservationId, corrected.value.currentLeaf.id);
  assert.equal(correctedEntry?.correctionCount, 1);
  assert.equal(correctedEntry?.originalValue.type, 'quantity');
  assert.equal(correctedEntry?.currentValue.type, 'quantity');
  if (correctedEntry?.currentValue.type === 'quantity') {
    assert.equal(correctedEntry.currentValue.quantity.significand, 25n);
  }
  assert.equal(
    row.actualTarget.trackingMode === 'quantity' ? row.actualTarget.actual.significand : null,
    75n,
  );

  const voided = await harness.correctHabitObservation(
    correction(second.value.id, { type: 'void' }, AUGUST_3, 'duplicate_entry'),
  );
  assert.equal(voided.ok, true);
  row = findRow(await readModel(harness, AUGUST_3), habit.id);
  assert.equal(row.currentObservation.currentEntries.length, 1);
  assert.equal(row.currentObservation.voidedChainCount, 1);
  assert.equal(
    row.actualTarget.trackingMode === 'quantity' ? row.actualTarget.actual.significand : null,
    25n,
  );
});

test('dependent correction appends history and round-trips relationship context', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const fixture = await linkedPair(harness, 'follow_up');
  await qualifyParent(harness, fixture.parent.id, AUGUST_3);
  const root = await harness.recordHabitObservation(
    record(fixture.dependent.id, checkbox(false), AUGUST_3),
  );
  assert.equal(root.ok, true);
  if (!root.ok) return;
  const corrected = await harness.correctHabitObservation(
    correction(root.value.id, checkbox(true), AUGUST_3),
  );
  assert.equal(corrected.ok, true);
  if (!corrected.ok) return;
  assert.equal(corrected.value.facts.length, 2);
  assert.equal(corrected.value.root.id, root.value.id);
  assert.equal(corrected.value.currentLeaf.dependencyVersionId, fixture.relationship.id);
  assert.equal(
    corrected.value.currentLeaf.scheduleVersionId,
    fixture.parent.scheduleVersion.id,
  );
  assert.equal((await harness.unitOfWork.findObservationById(root.value.id)).ok, true);
});

test('dependent date correction resolves a different valid relationship version', async (t) => {
  const harness = await createHarness(2000);
  t.after(() => harness.database.close());
  const parent = await createHabit(harness, 'Parent');
  const dependent = await createHabit(harness, 'Dependent');
  const first = await link(
    harness,
    parent.id,
    dependent.id,
    'follow_up',
    ACTIVE_FROM,
    AUGUST_15,
  );
  const second = await link(
    harness,
    parent.id,
    dependent.id,
    'follow_up',
    AUGUST_15,
    ACTIVE_TO,
  );
  await qualifyParent(harness, parent.id, AUGUST_10);
  await qualifyParent(harness, parent.id, AUGUST_20);
  const root = await harness.recordHabitObservation(
    record(dependent.id, checkbox(false), AUGUST_10),
  );
  assert.equal(root.ok, true);
  if (!root.ok) return;
  assert.equal(root.value.dependencyVersionId, first.id);
  assert.equal(
    findRow(await readModel(harness, AUGUST_10), dependent.id).relationshipVersionId,
    first.id,
  );
  assert.equal(
    findRow(await readModel(harness, AUGUST_20), dependent.id).relationshipVersionId,
    second.id,
  );
  const corrected = await harness.correctHabitObservation(
    correction(root.value.id, checkbox(true), AUGUST_20, 'correct_date'),
  );
  assert.equal(corrected.ok, true);
  if (!corrected.ok) return;
  assert.equal(corrected.value.root.dependencyVersionId, first.id);
  assert.equal(corrected.value.currentLeaf.dependencyVersionId, second.id);
  assert.equal(corrected.value.facts.length, 2);
});

test('dependent correction to a blocked follow-up date is rejected without branching', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const fixture = await linkedPair(harness, 'follow_up');
  await qualifyParent(harness, fixture.parent.id, AUGUST_3);
  const root = await harness.recordHabitObservation(
    record(fixture.dependent.id, checkbox(false), AUGUST_3),
  );
  assert.equal(root.ok, true);
  if (!root.ok) return;
  assertObservationError(
    await harness.correctHabitObservation(
      correction(root.value.id, checkbox(true), AUGUST_10, 'correct_date'),
    ),
    'observation_dependency_blocked',
  );
  const chain = await harness.unitOfWork.loadObservationChain(root.value.id);
  assert.equal(chain.ok, true);
  if (chain.ok) assert.equal(chain.value?.facts.length, 1);
});

test('forced dependent record and correction failures roll back appended facts', async (t) => {
  const recordHarness = await createHarness();
  t.after(() => recordHarness.database.close());
  const recordPair = await linkedPair(recordHarness, 'follow_up');
  await qualifyParent(recordHarness, recordPair.parent.id, AUGUST_3);
  await recordHarness.database.execAsync(`
    CREATE TEMP TRIGGER remove_dependent_before_readback
    AFTER INSERT ON habit_observations
    WHEN NEW.dependency_version_id IS NOT NULL
    BEGIN DELETE FROM habit_observations WHERE id = NEW.id; END;
  `);
  assertObservationError(
    await recordHarness.recordHabitObservation(
      record(recordPair.dependent.id, checkbox(true), AUGUST_3),
    ),
    'observation_data_integrity_failure',
  );
  assert.equal(await tableCount(recordHarness.database, 'habit_observations'), 1);

  const correctionHarness = await createHarness(3000);
  t.after(() => correctionHarness.database.close());
  const correctionPair = await linkedPair(correctionHarness, 'follow_up');
  await qualifyParent(correctionHarness, correctionPair.parent.id, AUGUST_3);
  const root = await correctionHarness.recordHabitObservation(
    record(correctionPair.dependent.id, checkbox(false), AUGUST_3),
  );
  assert.equal(root.ok, true);
  if (!root.ok) return;
  await correctionHarness.database.execAsync(`
    CREATE TEMP TRIGGER remove_dependent_correction_before_readback
    AFTER INSERT ON habit_observations
    WHEN NEW.supersedes_observation_id IS NOT NULL
    BEGIN DELETE FROM habit_observations WHERE id = NEW.id; END;
  `);
  assertObservationError(
    await correctionHarness.correctHabitObservation(
      correction(root.value.id, checkbox(true), AUGUST_3),
    ),
    'observation_data_integrity_failure',
  );
  assert.equal(await tableCount(correctionHarness.database, 'habit_observations'), 2);
});

test('read model exposes exact counter, quantity, and duration actual/target context', async (t) => {
  const harness = await createHarness(4000);
  t.after(() => harness.database.close());
  const counterHabit = await createHabit(harness, 'Counter', trackingFixture('counter'));
  const quantityHabit = await createHabit(harness, 'Quantity', trackingFixture('quantity'));
  const durationHabit = await createHabit(harness, 'Duration', trackingFixture('duration'));
  await harness.recordHabitObservation(record(counterHabit.id, { type: 'counter', counterDelta: 2 }, AUGUST_3));
  await harness.recordHabitObservation(record(quantityHabit.id, quantity(125, 2), AUGUST_3));
  await harness.recordHabitObservation(record(durationHabit.id, { type: 'duration', durationSeconds: 900 }, AUGUST_3));
  const model = await readModel(harness, AUGUST_3);
  const counterRow = findRow(model, counterHabit.id);
  const quantityRow = findRow(model, quantityHabit.id);
  const durationRow = findRow(model, durationHabit.id);
  assert.equal(counterRow.actualTarget.trackingMode === 'counter' ? counterRow.actualTarget.actual.significand : null, 2n);
  assert.equal(quantityRow.actualTarget.trackingMode === 'quantity' ? quantityRow.actualTarget.target.significand : null, 200n);
  assert.equal(durationRow.actualTarget.trackingMode === 'duration' ? durationRow.actualTarget.actualSeconds : null, 900);
  assert.deepEqual(counterRow.progress.completionCredit, { numerator: 2n, denominator: 3n });
  assert.deepEqual(quantityRow.progress.completionCredit, { numerator: 5n, denominator: 8n });
  assert.deepEqual(durationRow.progress.completionCredit, { numerator: 1n, denominator: 3n });
  assert.equal(counterRow.progress.displayProgress, 0.6666);
  assert.equal(quantityRow.progress.displayProgress, 0.625);
  assert.equal(durationRow.progress.displayProgress, 0.3333);
  assert.deepEqual(model.rootProgress, { completedRootCount: 0, scheduledRootCount: 3, remainingRootCount: 3 });
  assert.deepEqual(quantityRow.progress.actual, {
    kind: 'exact_quantity',
    value: domainValue(createExactQuantity({ significand: 125, scale: 2 })),
  });
  assert.equal(quantityRow.progress.inclusion, 'included');
  assert.equal(quantityRow.progress.historicalWeight, 2);
});

test('open at-most and skipped read-model states remain provisional and policy-unresolved', async (t) => {
  const harness = await createHarness(5000);
  t.after(() => harness.database.close());
  const atMost = domainValue(validateTrackingDefinition({
    trackingMode: 'counter',
    comparisonOperator: 'at_most',
    target: { significand: 10n, scale: 0 },
    unit: { unitType: 'standard', standardUnitCode: 'session' },
    effectiveFrom: ACTIVE_FROM,
    effectiveTo: ACTIVE_TO,
  }));
  const provisionalHabit = await createHabit(harness, 'At most', atMost);
  const skippedHabit = await createHabit(harness, 'Skipped');
  const recorded = await harness.recordHabitObservation(record(provisionalHabit.id, { type: 'counter', counterDelta: 5 }, AUGUST_3));
  assert.equal(recorded.ok, true);
  await harness.recordHabitObservation(record(skippedHabit.id, { type: 'skipped' }, AUGUST_3));
  const model = await readModel(harness, AUGUST_3);
  const provisionalRow = findRow(model, provisionalHabit.id);
  assert.equal(provisionalRow.state, 'provisional');
  assert.equal(provisionalRow.progress.inclusion, 'excluded');
  assert.equal(provisionalRow.progress.exclusionReason, 'provisional');
  assert.equal(provisionalRow.actualTarget.trackingMode === 'counter' ? provisionalRow.actualTarget.actual.significand : null, 5n);
  assert.equal(provisionalRow.actualTarget.trackingMode === 'counter' ? provisionalRow.actualTarget.target.significand : null, 10n);
  const skippedRow = findRow(model, skippedHabit.id);
  assert.equal(skippedRow.state, 'skipped_policy_unresolved');
  assert.equal(skippedRow.progress.inclusion, 'excluded');
  assert.equal(skippedRow.progress.exclusionReason, 'skipped_policy_unresolved');
});

test('ordinary groups expose exact equal and weighted progress without coupling child completion', async (t) => {
  const harness = await createHarness(5_500);
  t.after(() => harness.database.close());
  const parent = await createHabit(harness, 'Routine', trackingFixture('checkbox'), 'high');
  const ordinary = await createHabit(harness, 'Measured child', trackingFixture('quantity'));
  const conditional = await createHabit(harness, 'Follow-up child', trackingFixture('checkbox'), 'low');
  const attached = await harness.changeOrdinaryParent({
    action: 'attach',
    childHabitId: ordinary.id,
    parentHabitId: parent.id,
    effectiveLocalDate: ACTIVE_FROM,
  });
  assert.equal(attached.ok, true);
  await link(harness, parent.id, conditional.id, 'follow_up', ACTIVE_FROM, ACTIVE_TO);
  const blockedModel = await readModel(harness, AUGUST_3);
  const blockedGroup = blockedModel.rootGroups.find(({ rootHabitId }) => rootHabitId === parent.id);
  assert.ok(blockedGroup);
  assert.deepEqual(blockedGroup.progress.exclusionReasons, [{ reason: 'blocked', count: 1 }]);
  assert.equal(blockedGroup.progress.includedExpectationCount, 2);
  assert.equal(blockedGroup.progress.childApplicableCount, 1);
  assert.equal((await harness.recordHabitObservation(record(parent.id, checkbox(true), AUGUST_3))).ok, true);
  assert.equal((await harness.recordHabitObservation(record(ordinary.id, quantity(125, 2), AUGUST_3))).ok, true);
  await harness.database.runAsync("UPDATE planner_preferences SET progress_mode='weighted' WHERE id=1;");

  const model = await readModel(harness, AUGUST_3);
  const group = model.rootGroups.find(({ rootHabitId }) => rootHabitId === parent.id);
  assert.ok(group);
  assert.equal(model.progressMode, 'weighted');
  assert.equal(findRow(model, parent.id).state, 'qualified');
  assert.equal(findRow(model, ordinary.id).state, 'expected_incomplete');
  assert.equal(findRow(model, conditional.id).state, 'expected_incomplete');
  assert.deepEqual(group.progress, {
    includedRowCount: 3,
    completionCreditSum: { numerator: 13n, denominator: 8n },
    equalProgress: { numerator: 13n, denominator: 24n },
    weightedNumerator: { numerator: 17n, denominator: 4n },
    weightedDenominator: 6,
    weightedProgress: { numerator: 17n, denominator: 24n },
    childCompletedCount: 0,
    childApplicableCount: 2,
    completionCredit: { numerator: 13n, denominator: 24n },
    includedCount: 3,
    includedExpectationCount: 3,
    rootCompletionCredit: { numerator: 1n, denominator: 1n },
    rowCredits: [
      { habitId: parent.id, completionCredit: { numerator: 1n, denominator: 1n }, included: true, exclusionReason: null },
      { habitId: conditional.id, completionCredit: { numerator: 0n, denominator: 1n }, included: true, exclusionReason: null },
      { habitId: ordinary.id, completionCredit: { numerator: 5n, denominator: 8n }, included: true, exclusionReason: null },
    ],
    exclusionReasons: [],
    selectedMode: 'weighted',
    selectedProgress: { numerator: 17n, denominator: 24n },
    displayProgress: 0.7083,
  });
});

test('Planner ordering and highlight ranks honor time, importance, stability, and neutral blocking', async (t) => {
  const harness = await createHarness(5_750);
  t.after(() => harness.database.close());
  const timedNormal = await createHabit(harness, 'Timed normal', trackingFixture('checkbox'), 'normal', time('08:00'));
  const timedCritical = await createHabit(harness, 'Timed critical', trackingFixture('checkbox'), 'critical', time('08:00'));
  const timedHigh = await createHabit(harness, 'Timed high', trackingFixture('checkbox'), 'high', time('09:00'));
  const allDayLow = await createHabit(harness, 'All day low', trackingFixture('checkbox'), 'low');
  const allDayCritical = await createHabit(harness, 'All day critical', trackingFixture('checkbox'), 'critical');
  const blockedCritical = await createHabit(harness, 'Blocked critical', trackingFixture('checkbox'), 'critical');
  await link(harness, timedNormal.id, blockedCritical.id, 'follow_up', ACTIVE_FROM, ACTIVE_TO);
  assert.equal((await harness.recordHabitObservation(record(allDayLow.id, checkbox(true), AUGUST_3))).ok, true);

  const model = await readModel(harness, AUGUST_3);
  assert.deepEqual(model.rootGroups.map(({ rootHabitId }) => rootHabitId), [
    timedCritical.id,
    timedNormal.id,
    timedHigh.id,
    allDayCritical.id,
    allDayLow.id,
  ]);
  assert.deepEqual(model.rootProgress, { completedRootCount: 1, scheduledRootCount: 5, remainingRootCount: 4 });
  const critical = findRow(model, timedCritical.id);
  const high = findRow(model, timedHigh.id);
  const normal = findRow(model, timedNormal.id);
  const blocked = findRow(model, blockedCritical.id);
  const completed = findRow(model, allDayLow.id);
  assert.equal(critical.highlightReason, 'critical_incomplete');
  assert.equal(high.highlightReason, 'high_incomplete');
  assert.equal(normal.highlightReason, 'next_timed_incomplete');
  assert.equal(blocked.progress.exclusionReason, 'blocked');
  assert.equal(blocked.highlightReason, 'neutral');
  assert.equal(completed.highlightReason, 'completed');
  assert.ok(critical.highlightRank < high.highlightRank);
  assert.ok(high.highlightRank < normal.highlightRank);
  assert.ok(normal.highlightRank < blocked.highlightRank);
  assert.ok(blocked.highlightRank < completed.highlightRank);
});

test('future occurrence progress is a neutral exclusion', async (t) => {
  const harness = await createHarness(5_900);
  t.after(() => harness.database.close());
  const habit = await createHabit(harness, 'Future habit');
  const result = await harness.getPlannerOccurrencesForDate({
    selectedLocalDate: AUGUST_10,
    evaluationBoundary: AUGUST_3,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const row = findRow(result.value, habit.id);
  assert.equal(row.progress.inclusion, 'excluded');
  assert.equal(row.progress.exclusionReason, 'future');
  assert.equal(row.highlightReason, 'neutral');
});

test('selected-date groups are deterministic and omit archived or outside-range habits', async (t) => {
  const harness = await createHarness(6000);
  t.after(() => harness.database.close());
  const first = await createHabit(harness, 'First');
  const second = await createHabit(harness, 'Second');
  const before = await readModel(harness, AUGUST_3);
  const after = await readModel(harness, AUGUST_3);
  assert.deepEqual(before, after);
  assert.equal(before.createdHabitCount, 2);
  assert.deepEqual(
    before.rootGroups.map(({ rootHabitId }) => rootHabitId),
    [first.id, second.id].sort(),
  );
  await harness.database.runAsync(
    `UPDATE habits SET lifecycle = 'archived', archived_at = $now, updated_at = $now
     WHERE id = $habitId;`,
    { $habitId: first.id, $now: FIXED_NOW + 1 },
  );
  await harness.database.runAsync(
    `INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at)
     VALUES($id,$habitId,2,'archived',$date,'Europe/London',$now,$now);`,
    { $id: plannerId(999001), $habitId: first.id, $date: AUGUST_3, $now: FIXED_NOW + 1 },
  );
  const archived = await readModel(harness, AUGUST_3);
  assert.equal(archived.createdHabitCount, 2);
  assert.equal(archived.rootGroups.some(({ rootHabitId }) => rootHabitId === first.id), false);
  const outside = await readModel(harness, date('2026-09-01'));
  assert.equal(outside.createdHabitCount, 2);
  assert.equal(outside.rootGroups.length, 0);
  assert.equal(outside.resolution, 'no_scheduled_habits');
});

test('one active habit without an applicable schedule is excluded without hiding valid habits', async (t) => {
  const harness = await createHarness(6_500);
  t.after(() => harness.database.close());
  const valid = await createHabit(harness, 'Still visible');
  const needsSchedule = await createHabit(harness, 'Needs schedule');
  await harness.database.runAsync(
    `UPDATE habit_schedule_versions
     SET effective_from = $futureDate, updated_at = $now
     WHERE habit_id = $habitId;`,
    {
      $futureDate: AUGUST_15,
      $habitId: needsSchedule.id,
      $now: FIXED_NOW + 1,
    },
  );

  const model = await readModel(harness, AUGUST_3);
  assert.equal(model.resolution, 'recoverable_exclusions');
  assert.deepEqual(model.recoverableExclusions, [{
    habitId: needsSchedule.id,
    reason: 'no_applicable_schedule',
  }]);
  assert.equal(findRow(model, valid.id).name, 'Still visible');
  assert.equal(
    model.rootGroups.some(({ rootHabitId }) => rootHabitId === needsSchedule.id),
    false,
  );
});

test('selected-date queries are read-only and persist no derived occurrence state', async (t) => {
  const harness = await createHarness(7000);
  t.after(() => harness.database.close());
  await linkedPair(harness, 'follow_up');
  const countsBefore = {
    habits: await tableCount(harness.database, 'habits'),
    dependencies: await tableCount(harness.database, 'habit_dependency_versions'),
    observations: await tableCount(harness.database, 'habit_observations'),
  };
  const model = await readModel(harness, AUGUST_3);
  assert.equal('percentage' in model, false);
  assert.equal('streak' in model, false);
  assert.deepEqual(
    {
      habits: await tableCount(harness.database, 'habits'),
      dependencies: await tableCount(harness.database, 'habit_dependency_versions'),
      observations: await tableCount(harness.database, 'habit_observations'),
    },
    countsBefore,
  );
  const derivedTables = await harness.database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND (name LIKE '%occurrence%' OR name LIKE '%expected%'
         OR name LIKE '%blocked%' OR name LIKE '%progress%'
         OR name LIKE '%streak%' OR name LIKE '%aggregate%');`,
  );
  assert.deepEqual(derivedTables, []);
});

test('failed selected-date resolution does not mutate canonical data', async (t) => {
  const harness = await createHarness(8000);
  t.after(() => harness.database.close());
  const habit = await createHabit(harness, 'Ambiguous schedule');
  await harness.database.runAsync(
    `INSERT INTO habit_schedule_versions (
       id, habit_id, version_number, schedule_type, effective_from, effective_to,
       evaluation_timezone, interval_days, weekdays_mask, weekday,
       period_target_count, anchor_date, month_day, month_number, week_start,
       created_at, updated_at
     )
     SELECT $id, habit_id, 2, schedule_type, $effectiveFrom, $effectiveTo,
            evaluation_timezone, interval_days, weekdays_mask, weekday,
            period_target_count, anchor_date, month_day, month_number, week_start,
            $now, $now
     FROM habit_schedule_versions
     WHERE id = $sourceId;`,
    {
      $id: plannerId(8999),
      $sourceId: habit.scheduleVersion.id,
      $effectiveFrom: date('2026-08-02'),
      $effectiveTo: AUGUST_15,
      $now: FIXED_NOW + 1,
    },
  );
  const countsBefore = {
    schedules: await tableCount(harness.database, 'habit_schedule_versions'),
    observations: await tableCount(harness.database, 'habit_observations'),
  };
  const result = await harness.getPlannerOccurrencesForDate({
    selectedLocalDate: AUGUST_3,
    evaluationBoundary: AUGUST_3,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'occurrence_read_model_data_integrity_failure');
  }
  assert.deepEqual(
    {
      schedules: await tableCount(harness.database, 'habit_schedule_versions'),
      observations: await tableCount(harness.database, 'habit_observations'),
    },
    countsBefore,
  );
});

async function linkedPair(
  harness: TestHarness,
  dependencyType: 'follow_up' | 'prerequisite',
  dependentTracking: TrackingDefinition = trackingFixture('checkbox'),
  parentTracking: TrackingDefinition = trackingFixture('checkbox'),
) {
  const parent = await createHabit(harness, 'Gym', parentTracking);
  const dependent = await createHabit(harness, 'Protein shake', dependentTracking);
  const relationship = await link(
    harness,
    parent.id,
    dependent.id,
    dependencyType,
    ACTIVE_FROM,
    ACTIVE_TO,
  );
  return { parent, dependent, relationship };
}

async function createHabit(
  harness: TestHarness,
  name: string,
  tracking: TrackingDefinition = trackingFixture('checkbox'),
  importance: ImportanceLevel = 'normal',
  plannedTime: PlannerLocalTime | null = null,
) {
  const result = await harness.createHabit(baseCommand({
    name,
    schedule: scheduleFixture('daily'),
    tracking,
    importance,
    plannedTime,
  }));
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('Expected habit fixture creation to succeed.');
  return result.value;
}

async function link(
  harness: TestHarness,
  parentHabitId: ReturnType<typeof plannerId>,
  dependentHabitId: ReturnType<typeof plannerId>,
  dependencyType: 'follow_up' | 'prerequisite',
  effectiveFrom: PlannerLocalDate,
  effectiveTo: PlannerLocalDate | null,
) {
  const result = await harness.addHabitDependency({
    dependentSource: 'existing',
    parentHabitId,
    dependentHabitId,
    dependencyType,
    effectiveFrom,
    effectiveTo,
  });
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('Expected relationship fixture creation to succeed.');
  return result.value.relationship;
}

async function qualifyParent(
  harness: TestHarness,
  habitId: ReturnType<typeof plannerId>,
  occurrenceLocalDate: PlannerLocalDate,
): Promise<void> {
  const result = await harness.recordHabitObservation(
    record(habitId, checkbox(true), occurrenceLocalDate),
  );
  assert.equal(result.ok, true);
}

function record(
  habitId: ReturnType<typeof plannerId>,
  value: ObservationValue,
  occurrenceLocalDate: PlannerLocalDate,
): RecordHabitObservationCommand {
  return {
    habitId,
    occurrenceLocalDate,
    occurrenceTimezone: LONDON,
    value: value as RecordHabitObservationCommand['value'],
  };
}

function correction(
  observationId: ReturnType<typeof plannerId>,
  replacement: ObservationValue,
  correctedOccurrenceLocalDate: PlannerLocalDate,
  correctionReason: CorrectHabitObservationCommand['correctionReason'] = 'correct_value',
): CorrectHabitObservationCommand {
  return {
    observationId,
    correctionReason,
    correctedOccurrenceLocalDate,
    correctedOccurrenceTimezone: LONDON,
    replacement,
  };
}

async function readModel(
  harness: TestHarness,
  selectedLocalDate: PlannerLocalDate,
): Promise<SelectedDatePlannerReadModel> {
  const result = await harness.getPlannerOccurrencesForDate({
    selectedLocalDate,
    evaluationBoundary: selectedLocalDate,
  });
  if (!result.ok) {
    assert.fail(`Expected read model, received ${result.error.code}.`);
  }
  return result.value;
}

function findRow(
  model: SelectedDatePlannerReadModel,
  habitId: ReturnType<typeof plannerId>,
) {
  const row = model.rootGroups.flatMap((group) => group.rows).find(
    (candidate) => candidate.habitId === habitId,
  );
  assert.ok(row);
  return row;
}

function dependentActual(row: SelectedDatePlannerOccurrenceRow): string {
  switch (row.actualTarget.trackingMode) {
    case 'checkbox':
    case 'avoidance':
      return `${row.actualTarget.trackingMode}:${String(row.actualTarget.actual)}`;
    case 'counter':
    case 'quantity':
      return `${row.actualTarget.trackingMode}:${row.actualTarget.actual.significand}:${row.actualTarget.actual.scale}`;
    case 'duration':
      return `duration:${row.actualTarget.actualSeconds}`;
  }
}

function zeroActual(mode: 'checkbox' | 'avoidance' | 'counter' | 'quantity' | 'duration'): string {
  switch (mode) {
    case 'checkbox': return 'checkbox:null';
    case 'avoidance': return 'avoidance:null';
    case 'counter': return 'counter:0:0';
    case 'quantity': return 'quantity:0:2';
    case 'duration': return 'duration:0';
  }
}

function completedActual(mode: 'checkbox' | 'avoidance' | 'counter' | 'quantity' | 'duration'): string {
  switch (mode) {
    case 'checkbox': return 'checkbox:true';
    case 'avoidance': return 'avoidance:true';
    case 'counter': return 'counter:3:0';
    case 'quantity': return 'quantity:200:2';
    case 'duration': return 'duration:2700';
  }
}

async function observationIdentityRows(harness: TestHarness) {
  const rows = await harness.database.getAllAsync<{
    readonly habit_id: string;
    readonly tracking_version_id: string;
    readonly dependency_version_id: string | null;
  }>(
    `SELECT habit_id, tracking_version_id, dependency_version_id
     FROM habit_observations
     ORDER BY created_at, id;`,
  );
  return rows.map(({ habit_id, tracking_version_id, dependency_version_id }) => ({
    habit_id,
    tracking_version_id,
    dependency_version_id,
  }));
}

function checkbox(booleanValue: boolean): ObservationValue {
  return { type: 'checkbox', booleanValue };
}

function quantity(significand: number, scale: number): ObservationValue {
  return {
    type: 'quantity',
    quantity: domainValue(createExactQuantity({ significand, scale })),
  };
}

function date(value: string): PlannerLocalDate {
  return domainValue(parsePlannerLocalDate(value));
}

function time(value: string): PlannerLocalTime {
  return domainValue(parsePlannerLocalTime(value));
}

function assertObservationError(
  result: Readonly<{ ok: boolean; error?: Readonly<{ code: string }> }>,
  code: string,
): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error?.code, code);
}
