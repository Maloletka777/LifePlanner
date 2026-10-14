import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addExactQuantities,
  createExactQuantity,
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  type ObservationValue,
  type PlannerLocalDate,
  type TrackingDefinition,
} from '../../../src/features/planner/domain';
import {
  createRecordHabitObservation,
  type CorrectHabitObservationCommand,
  type RecordHabitObservationCommand,
} from '../../../src/features/planner/application';
import {
  mapHabitObservationRow,
  type HabitObservationRow,
} from '../../../src/features/planner/infrastructure/sqlite';
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
const AUGUST_4 = date('2026-08-04');
const AUGUST_10 = date('2026-08-10');
const AUGUST_15 = date('2026-08-15');
const AUGUST_20 = date('2026-08-20');

test('RecordHabitObservation persists every measured tracking mode and skipped', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const fixtures: readonly [TrackingDefinition['trackingMode'], ObservationValue][] = [
    ['checkbox', { type: 'checkbox', booleanValue: true }],
    ['avoidance', { type: 'avoidance', booleanValue: false }],
    ['counter', { type: 'counter', counterDelta: 2 }],
    ['quantity', quantity(125, 2)],
    ['duration', { type: 'duration', durationSeconds: 900 }],
  ];
  for (const [mode, value] of fixtures) {
    const habit = await createHabit(harness, mode, `Habit ${mode}`);
    const result = await harness.recordHabitObservation(recordCommand(habit.id, value));
    assert.equal(result.ok, true, mode);
    if (result.ok) {
      assert.deepEqual(result.value.value, value);
      assert.equal(result.value.dependencyVersionId, null);
      assert.equal(result.value.observedAt, FIXED_NOW);
      assert.equal(result.value.createdAt, FIXED_NOW);
    }
  }
  const skippedHabit = await createHabit(harness, 'checkbox', 'Skipped habit');
  const skipped = await harness.recordHabitObservation(
    recordCommand(skippedHabit.id, { type: 'skipped' }),
  );
  assert.equal(skipped.ok, true);
  if (skipped.ok) assert.deepEqual(skipped.value.value, { type: 'skipped' });
});

test('observation time, null time, note, and internally resolved context round-trip', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const timedHabit = await createHabit(harness, 'checkbox', 'Timed');
  const timed = await harness.recordHabitObservation({
    ...recordCommand(timedHabit.id, { type: 'checkbox', booleanValue: true }),
    occurrenceLocalTime: domainValue(parsePlannerLocalTime('07:30')),
    note: 'Private note',
  });
  assert.equal(timed.ok, true);
  if (!timed.ok) return;
  assert.equal(timed.value.occurrenceLocalTime, '07:30');
  assert.equal(timed.value.note, 'Private note');
  assert.equal(timed.value.scheduleVersionId, timedHabit.scheduleVersion.id);
  assert.equal(timed.value.trackingVersionId, timedHabit.trackingVersion.id);
  assert.equal(timed.value.importanceVersionId, timedHabit.importanceVersion.id);
  assert.equal(timed.value.dependencyVersionId, null);

  const untimedHabit = await createHabit(harness, 'checkbox', 'Untimed');
  const untimed = await harness.recordHabitObservation(
    recordCommand(untimedHabit.id, { type: 'checkbox', booleanValue: true }),
  );
  assert.equal(untimed.ok, true);
  if (untimed.ok) assert.equal(untimed.value.occurrenceLocalTime, null);
});

test('additive quantity, counter, and duration entries create separate roots', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const water = await createHabit(harness, 'quantity', 'Water');
  const waterValues = [quantity(50, 2), quantity(50, 2), quantity(25, 2)] as const;
  const waterFacts = [];
  for (const value of waterValues) {
    const result = await harness.recordHabitObservation(recordCommand(water.id, value));
    assert.equal(result.ok, true);
    if (result.ok) waterFacts.push(result.value);
  }
  assert.equal(new Set(waterFacts.map(({ id }) => id)).size, 3);
  assert.ok(waterFacts.every((fact) => fact.supersedesObservationId === null));
  const total = waterFacts.reduce(
    (sum, fact) => {
      assert.equal(fact.value.type, 'quantity');
      if (fact.value.type !== 'quantity') return sum;
      return domainValue(addExactQuantities(sum, fact.value.quantity));
    },
    domainValue(createExactQuantity({ significand: 0n, scale: 2 })),
  );
  assert.deepEqual(total, domainValue(createExactQuantity({ significand: 125n, scale: 2 })));

  for (const mode of ['counter', 'duration'] as const) {
    const habit = await createHabit(harness, mode, `Multiple ${mode}`);
    const value: ObservationValue =
      mode === 'counter'
        ? { type: 'counter', counterDelta: 1 }
        : { type: 'duration', durationSeconds: 60 };
    assert.equal((await harness.recordHabitObservation(recordCommand(habit.id, value))).ok, true);
    assert.equal((await harness.recordHabitObservation(recordCommand(habit.id, value))).ok, true);
  }
  assert.equal(await tableCount(harness.database, 'habit_observations'), 7);
});

test('checkbox and avoidance require correction instead of competing roots', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  for (const mode of ['checkbox', 'avoidance'] as const) {
    const habit = await createHabit(harness, mode, `State ${mode}`);
    const value: ObservationValue =
      mode === 'checkbox'
        ? { type: 'checkbox', booleanValue: false }
        : { type: 'avoidance', booleanValue: false };
    assert.equal((await harness.recordHabitObservation(recordCommand(habit.id, value))).ok, true);
    assertObservationError(
      await harness.recordHabitObservation(recordCommand(habit.id, value)),
      'observation_state_already_exists',
    );
  }
});

test('additive skipped and measured current states cannot silently coexist', async (t) => {
  const firstHarness = await createHarness();
  t.after(() => firstHarness.database.close());
  const first = await createHabit(firstHarness, 'quantity', 'Skip first');
  assert.equal(
    (await firstHarness.recordHabitObservation(recordCommand(first.id, { type: 'skipped' }))).ok,
    true,
  );
  assertObservationError(
    await firstHarness.recordHabitObservation(recordCommand(first.id, quantity(25, 2))),
    'observation_state_already_exists',
  );

  const secondHarness = await createHarness();
  t.after(() => secondHarness.database.close());
  const second = await createHabit(secondHarness, 'quantity', 'Measured first');
  assert.equal(
    (await secondHarness.recordHabitObservation(recordCommand(second.id, quantity(25, 2)))).ok,
    true,
  );
  assertObservationError(
    await secondHarness.recordHabitObservation(recordCommand(second.id, { type: 'skipped' })),
    'observation_state_already_exists',
  );
});

test('flexible-period additive roots may exceed target while skipped uses the whole period', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const habit = await createHabit(
    harness,
    'quantity',
    'Flexible quantity',
    scheduleFixture('times_per_week'),
  );
  for (const occurrenceLocalDate of [
    date('2026-08-03'),
    date('2026-08-04'),
    date('2026-08-05'),
    date('2026-08-06'),
  ]) {
    const result = await harness.recordHabitObservation({
      ...recordCommand(habit.id, quantity(25, 2)),
      occurrenceLocalDate,
    });
    assert.equal(result.ok, true);
  }
  assertObservationError(
    await harness.recordHabitObservation({
      ...recordCommand(habit.id, { type: 'skipped' }),
      occurrenceLocalDate: date('2026-08-07'),
    }),
    'observation_state_already_exists',
  );
  assert.equal(await tableCount(harness.database, 'habit_observations'), 4);
});

test('record context failures are typed for missing, archived, ranges, and fixed recurrence', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  assertObservationError(
    await harness.recordHabitObservation(
      recordCommand(plannerId(9999), { type: 'checkbox', booleanValue: true }),
    ),
    'observation_habit_not_found',
  );
  const archived = await createHabit(harness, 'checkbox', 'Archived');
  await harness.database.runAsync(
    `UPDATE habits SET lifecycle = 'archived', archived_at = $now, updated_at = $now
     WHERE id = $habitId;`,
    { $habitId: archived.id, $now: FIXED_NOW + 1 },
  );
  assertObservationError(
    await harness.recordHabitObservation(recordCommand(archived.id, { type: 'checkbox', booleanValue: true })),
    'observation_habit_archived',
  );
  const outside = await createHabit(harness, 'checkbox', 'Outside');
  assertObservationError(
    await harness.recordHabitObservation({
      ...recordCommand(outside.id, { type: 'checkbox', booleanValue: true }),
      occurrenceLocalDate: date('2026-09-01'),
    }),
    'observation_outside_active_range',
  );
  const mondayOnly = await createHabit(
    harness,
    'checkbox',
    'Monday only',
    scheduleFixture('selected_weekdays'),
  );
  assertObservationError(
    await harness.recordHabitObservation({
      ...recordCommand(mondayOnly.id, { type: 'checkbox', booleanValue: true }),
      occurrenceLocalDate: AUGUST_4,
    }),
    'observation_not_scheduled',
  );
});

test('missing and ambiguous schedule, tracking, and importance history is never guessed', async (t) => {
  for (const [table, missingCode, ambiguousCode] of [
    ['habit_schedule_versions', 'observation_schedule_missing', 'observation_schedule_ambiguous'],
    ['habit_tracking_versions', 'observation_tracking_missing', 'observation_tracking_ambiguous'],
    ['habit_importance_versions', 'observation_importance_missing', 'observation_importance_ambiguous'],
  ] as const) {
    const missingHarness = await createHarness();
    t.after(() => missingHarness.database.close());
    const missingHabit = await createHabit(missingHarness, 'checkbox', `Missing ${table}`);
    await missingHarness.database.runAsync(`DELETE FROM ${table} WHERE habit_id = $habitId;`, {
      $habitId: missingHabit.id,
    });
    assertObservationError(
      await missingHarness.recordHabitObservation(
        recordCommand(missingHabit.id, { type: 'checkbox', booleanValue: true }),
      ),
      missingCode,
    );

    const ambiguousHarness = await createHarness();
    t.after(() => ambiguousHarness.database.close());
    const ambiguousHabit = await createHabit(ambiguousHarness, 'checkbox', `Ambiguous ${table}`);
    await duplicateVersion(ambiguousHarness, table, ambiguousHabit.id);
    assertObservationError(
      await ambiguousHarness.recordHabitObservation(
        recordCommand(ambiguousHabit.id, { type: 'checkbox', booleanValue: true }),
      ),
      ambiguousCode,
    );
  }
});

test('applicable inherited follow-up is typed as blocked before parent qualification', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createHabit(harness, 'checkbox', 'Parent');
  const dependent = await createHabit(harness, 'checkbox', 'Dependent');
  const linked = await harness.addHabitDependency({
    dependentSource: 'existing',
    parentHabitId: parent.id,
    dependentHabitId: dependent.id,
    dependencyType: 'follow_up',
    effectiveFrom: ACTIVE_FROM,
    effectiveTo: ACTIVE_TO,
  });
  assert.equal(linked.ok, true);
  assertObservationError(
    await harness.recordHabitObservation(
      recordCommand(dependent.id, { type: 'checkbox', booleanValue: true }),
    ),
    'observation_dependency_blocked',
  );
  assert.equal(await tableCount(harness.database, 'habit_observations'), 0);
});

test('invalid command fields, root void, tracking mismatch, and quantity scale fail before writes', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const checkbox = await createHabit(harness, 'checkbox', 'Checkbox');
  assertObservationError(
    await harness.recordHabitObservation({
      ...recordCommand(checkbox.id, { type: 'checkbox', booleanValue: true }),
      occurrenceLocalDate: '2026-02-30' as PlannerLocalDate,
    }),
    'observation_invalid_value',
  );
  assertObservationError(
    await harness.recordHabitObservation({
      ...recordCommand(checkbox.id, { type: 'checkbox', booleanValue: true }),
      value: { type: 'void' },
    } as unknown as RecordHabitObservationCommand),
    'observation_invalid_correction',
  );
  assertObservationError(
    await harness.recordHabitObservation(
      recordCommand(checkbox.id, quantity(25, 2)) as RecordHabitObservationCommand,
    ),
    'observation_type_mismatch',
  );
  const quantityHabit = await createHabit(harness, 'quantity', 'Quantity');
  assertObservationError(
    await harness.recordHabitObservation(recordCommand(quantityHabit.id, quantity(25, 1))),
    'observation_quantity_scale_mismatch',
  );
  assertObservationError(
    await harness.recordHabitObservation({
      ...recordCommand(checkbox.id, { type: 'checkbox', booleanValue: true }),
      occurrenceTimezone: 'Mars/Olympus' as typeof LONDON,
    }),
    'observation_invalid_value',
  );
  assertObservationError(
    await harness.recordHabitObservation({
      ...recordCommand(checkbox.id, { type: 'checkbox', booleanValue: true }),
      occurrenceLocalTime: '25:00' as never,
    }),
    'observation_invalid_value',
  );
  assertObservationError(
    await harness.recordHabitObservation({
      ...recordCommand(checkbox.id, { type: 'checkbox', booleanValue: true }),
      scheduleVersionId: checkbox.scheduleVersion.id,
    } as unknown as RecordHabitObservationCommand),
    'observation_invalid_correction',
  );
  assert.equal(await tableCount(harness.database, 'habit_observations'), 0);
});

test('checkbox, avoidance, counter, quantity, and duration corrections append one new current leaf', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  for (const [mode, original, replacement] of [
    ['checkbox', { type: 'checkbox', booleanValue: false }, { type: 'checkbox', booleanValue: true }],
    ['avoidance', { type: 'avoidance', booleanValue: false }, { type: 'avoidance', booleanValue: true }],
    ['counter', { type: 'counter', counterDelta: 3 }, { type: 'counter', counterDelta: 2 }],
    ['quantity', quantity(25, 2), quantity(20, 2)],
    ['duration', { type: 'duration', durationSeconds: 90 }, { type: 'duration', durationSeconds: 45 }],
  ] as const) {
    const habit = await createHabit(harness, mode, `Correct ${mode}`);
    const root = await harness.recordHabitObservation(recordCommand(habit.id, original));
    assert.equal(root.ok, true);
    if (!root.ok) continue;
    const corrected = await harness.correctHabitObservation(
      correctCommand(root.value.id, replacement, 'correct_value'),
    );
    assert.equal(corrected.ok, true);
    if (!corrected.ok) continue;
    assert.equal(corrected.value.facts.length, 2);
    assert.equal(corrected.value.root.id, root.value.id);
    assert.deepEqual(corrected.value.currentLeaf.value, replacement);
    assert.equal(corrected.value.currentLeaf.supersedesObservationId, root.value.id);
    assert.equal(corrected.value.isVoided, false);
    assert.deepEqual(
      await harness.unitOfWork.findObservationById(root.value.id),
      { ok: true, value: root.value },
    );
  }
});

test('quantity correction may append void and preserves the original fact', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const habit = await createHabit(harness, 'quantity', 'Duplicate quantity');
  const root = await harness.recordHabitObservation(recordCommand(habit.id, quantity(25, 2)));
  assert.equal(root.ok, true);
  if (!root.ok) return;
  const voided = await harness.correctHabitObservation(
    correctCommand(root.value.id, { type: 'void' }, 'duplicate_entry'),
  );
  assert.equal(voided.ok, true);
  if (!voided.ok) return;
  assert.equal(voided.value.isVoided, true);
  assert.equal(voided.value.currentLeaf.value.type, 'void');
  const original = await harness.unitOfWork.findObservationById(root.value.id);
  assert.equal(original.ok, true);
  if (original.ok) assert.deepEqual(original.value, root.value);
});

test('date correction resolves new applicable historical context IDs', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const habit = await createHabit(harness, 'checkbox', 'Versioned');
  const root = await harness.recordHabitObservation({
    ...recordCommand(habit.id, { type: 'checkbox', booleanValue: false }),
    occurrenceLocalDate: AUGUST_10,
  });
  assert.equal(root.ok, true);
  if (!root.ok) return;
  const newIds = [plannerId(7001), plannerId(7002), plannerId(7003)] as const;
  await splitApplicableVersions(harness, habit.id, newIds);
  const corrected = await harness.correctHabitObservation({
    ...correctCommand(root.value.id, { type: 'checkbox', booleanValue: true }, 'correct_date'),
    correctedOccurrenceLocalDate: AUGUST_20,
  });
  assert.equal(corrected.ok, true);
  if (!corrected.ok) return;
  assert.equal(corrected.value.currentLeaf.scheduleVersionId, newIds[0]);
  assert.equal(corrected.value.currentLeaf.trackingVersionId, newIds[1]);
  assert.equal(corrected.value.currentLeaf.importanceVersionId, newIds[2]);
  assert.equal(corrected.value.root.scheduleVersionId, habit.scheduleVersion.id);
});

test('missing and non-leaf corrections fail without branching', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  assertObservationError(
    await harness.correctHabitObservation(
      correctCommand(plannerId(9999), { type: 'checkbox', booleanValue: true }, 'correct_value'),
    ),
    'observation_not_found',
  );
  const habit = await createHabit(harness, 'checkbox', 'Chain');
  const root = await harness.recordHabitObservation(recordCommand(habit.id, { type: 'checkbox', booleanValue: false }));
  assert.equal(root.ok, true);
  if (!root.ok) return;
  const first = await harness.correctHabitObservation(
    correctCommand(root.value.id, { type: 'checkbox', booleanValue: true }, 'correct_value'),
  );
  assert.equal(first.ok, true);
  assertObservationError(
    await harness.correctHabitObservation(
      correctCommand(root.value.id, { type: 'checkbox', booleanValue: false }, 'correct_value'),
    ),
    'observation_not_current_leaf',
  );
  assert.equal(await tableCount(harness.database, 'habit_observations'), 2);
});

test('invalid correction value/reason combinations append nothing', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const habit = await createHabit(harness, 'quantity', 'Invalid correction');
  const root = await harness.recordHabitObservation(recordCommand(habit.id, quantity(25, 2)));
  assert.equal(root.ok, true);
  if (!root.ok) return;
  assertObservationError(
    await harness.correctHabitObservation(
      correctCommand(
        root.value.id,
        { type: 'quantity', quantity: { significand: 0n, scale: 2 as never } },
        'correct_value',
      ),
    ),
    'observation_invalid_value',
  );
  assertObservationError(
    await harness.correctHabitObservation(
      correctCommand(root.value.id, { type: 'void' }, 'correct_value'),
    ),
    'observation_invalid_correction',
  );
  assert.equal(await tableCount(harness.database, 'habit_observations'), 1);
});

test('forced record and correction failures roll back every appended row', async (t) => {
  const recordHarness = await createHarness();
  t.after(() => recordHarness.database.close());
  const recordHabit = await createHabit(recordHarness, 'checkbox', 'Rollback record');
  await recordHarness.database.execAsync(`
    CREATE TEMP TRIGGER fail_observation_insert
    BEFORE INSERT ON habit_observations
    BEGIN SELECT RAISE(ABORT, 'forced-observation-failure'); END;
  `);
  assertObservationError(
    await recordHarness.recordHabitObservation(
      recordCommand(recordHabit.id, { type: 'checkbox', booleanValue: true }),
    ),
    'observation_database_failure',
  );
  assert.equal(await tableCount(recordHarness.database, 'habit_observations'), 0);

  const correctionHarness = await createHarness();
  t.after(() => correctionHarness.database.close());
  const correctionHabit = await createHabit(correctionHarness, 'checkbox', 'Rollback correction');
  const root = await correctionHarness.recordHabitObservation(
    recordCommand(correctionHabit.id, { type: 'checkbox', booleanValue: false }),
  );
  assert.equal(root.ok, true);
  if (!root.ok) return;
  await correctionHarness.database.execAsync(`
    CREATE TEMP TRIGGER remove_observation_before_readback
    AFTER INSERT ON habit_observations
    WHEN NEW.supersedes_observation_id IS NOT NULL
    BEGIN DELETE FROM habit_observations WHERE id = NEW.id; END;
  `);
  assertObservationError(
    await correctionHarness.correctHabitObservation(
      correctCommand(root.value.id, { type: 'checkbox', booleanValue: true }, 'correct_value'),
    ),
    'observation_data_integrity_failure',
  );
  assert.equal(await tableCount(correctionHarness.database, 'habit_observations'), 1);
  const chain = await correctionHarness.unitOfWork.loadObservationChain(root.value.id);
  assert.equal(chain.ok, true);
  if (chain.ok) assert.equal(chain.value?.facts.length, 1);
});

test('record readback deletion and identifier constraint failures leave no partial root', async (t) => {
  const readbackHarness = await createHarness();
  t.after(() => readbackHarness.database.close());
  const readbackHabit = await createHabit(readbackHarness, 'checkbox', 'Readback root');
  await readbackHarness.database.execAsync(`
    CREATE TEMP TRIGGER remove_root_before_readback
    AFTER INSERT ON habit_observations
    BEGIN DELETE FROM habit_observations WHERE id = NEW.id; END;
  `);
  assertObservationError(
    await readbackHarness.recordHabitObservation(
      recordCommand(readbackHabit.id, { type: 'checkbox', booleanValue: true }),
    ),
    'observation_data_integrity_failure',
  );
  assert.equal(await tableCount(readbackHarness.database, 'habit_observations'), 0);

  const constraintHarness = await createHarness();
  t.after(() => constraintHarness.database.close());
  const constraintHabit = await createHabit(constraintHarness, 'quantity', 'Constraint');
  const first = await constraintHarness.recordHabitObservation(
    recordCommand(constraintHabit.id, quantity(25, 2)),
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const colliding = createRecordHabitObservation({
    unitOfWork: constraintHarness.unitOfWork,
    idGenerator: { generateId: () => first.value.id },
    clock: { nowEpochMilliseconds: () => FIXED_NOW + 1 },
  });
  assertObservationError(
    await colliding(recordCommand(constraintHabit.id, quantity(25, 2))),
    'observation_data_integrity_failure',
  );
  assert.equal(await tableCount(constraintHarness.database, 'habit_observations'), 1);
});

test('observation row mapper exhaustively enforces value and correction columns', () => {
  const fixtures: readonly HabitObservationRow[] = [
    observationRow({ observation_type: 'checkbox', boolean_value: 1 }),
    observationRow({ observation_type: 'avoidance', boolean_value: 0 }),
    observationRow({ observation_type: 'counter', counter_delta: 2 }),
    observationRow({
      observation_type: 'quantity',
      quantity_significand: 125,
      quantity_scale: 2,
    }),
    observationRow({ observation_type: 'duration', duration_seconds: 60 }),
    observationRow({ observation_type: 'skipped' }),
    observationRow({
      id: plannerId(9200),
      observation_type: 'void',
      supersedes_observation_id: plannerId(9199),
      correction_reason: 'reversal',
    }),
  ];
  for (const row of fixtures) assert.equal(mapHabitObservationRow(row).ok, true);
  for (const row of [
    observationRow({ observation_type: 'void' }),
    observationRow({ observation_type: 'counter', counter_delta: 0 }),
    observationRow({ observation_type: 'skipped', boolean_value: 1 }),
    observationRow({ supersedes_observation_id: plannerId(9199), correction_reason: null }),
    observationRow({ supersedes_observation_id: null, correction_reason: 'other' }),
    observationRow({ observation_type: 'rating' }),
  ]) {
    const result = mapHabitObservationRow(row);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'observation_data_integrity_failure');
  }
});

test('observation persistence creates no derived total, progress, streak, or dependency fact', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const habit = await createHabit(harness, 'quantity', 'No derived rows');
  assert.equal(
    (await harness.recordHabitObservation(recordCommand(habit.id, quantity(25, 2)))).ok,
    true,
  );
  const derived = await harness.database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND (name LIKE '%total%' OR name LIKE '%progress%'
         OR name LIKE '%streak%' OR name LIKE '%analytics%');`,
  );
  assert.deepEqual(derived, []);
  const row = await harness.database.getFirstAsync<{
    dependency_version_id: string | null;
    observation_type: string;
  }>('SELECT dependency_version_id, observation_type FROM habit_observations;');
  assert.equal(row?.dependency_version_id, null);
  assert.equal(row?.observation_type, 'quantity');
});

async function createHabit(
  harness: TestHarness,
  mode: TrackingDefinition['trackingMode'],
  name: string,
  schedule = scheduleFixture('daily'),
) {
  const result = await harness.createHabit(baseCommand({
    name,
    schedule,
    tracking: trackingFixture(mode),
  }));
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('Expected habit fixture creation to succeed.');
  return result.value;
}

function recordCommand(
  habitId: ReturnType<typeof plannerId>,
  value: ObservationValue,
): RecordHabitObservationCommand {
  return {
    habitId,
    occurrenceLocalDate: AUGUST_3,
    occurrenceTimezone: LONDON,
    value: value as RecordHabitObservationCommand['value'],
  };
}

function correctCommand(
  observationId: ReturnType<typeof plannerId>,
  replacement: ObservationValue,
  correctionReason: CorrectHabitObservationCommand['correctionReason'],
): CorrectHabitObservationCommand {
  return {
    observationId,
    correctionReason,
    correctedOccurrenceLocalDate: AUGUST_3,
    correctedOccurrenceTimezone: LONDON,
    replacement,
  };
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

function assertObservationError(
  result: Readonly<{ ok: boolean; error?: Readonly<{ code: string }> }>,
  code: string,
): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error?.code, code);
}

function observationRow(
  overrides: Partial<HabitObservationRow> = {},
): HabitObservationRow {
  return {
    id: plannerId(9100),
    habit_id: plannerId(9101),
    schedule_version_id: plannerId(9102),
    tracking_version_id: plannerId(9103),
    importance_version_id: plannerId(9104),
    dependency_version_id: null,
    occurrence_local_date: AUGUST_3,
    occurrence_local_time: null,
    occurrence_timezone: LONDON,
    observation_type: 'skipped',
    boolean_value: null,
    counter_delta: null,
    quantity_significand: null,
    quantity_scale: null,
    duration_seconds: null,
    note: null,
    supersedes_observation_id: null,
    correction_reason: null,
    observed_at: FIXED_NOW,
    created_at: FIXED_NOW,
    ...overrides,
  };
}

async function duplicateVersion(
  harness: TestHarness,
  table: 'habit_schedule_versions' | 'habit_tracking_versions' | 'habit_importance_versions',
  habitId: ReturnType<typeof plannerId>,
): Promise<void> {
  const id = plannerId(
    table === 'habit_schedule_versions'
      ? 8101
      : table === 'habit_tracking_versions'
        ? 8102
        : 8103,
  );
  await harness.database.runAsync(
    `INSERT INTO ${table}
     SELECT $id, habit_id, 2,
       ${table === 'habit_schedule_versions'
         ? "schedule_type, '2026-08-02', effective_to, evaluation_timezone, interval_days, weekdays_mask, weekday, period_target_count, anchor_date, month_day, month_number, week_start"
         : table === 'habit_tracking_versions'
           ? "tracking_mode, comparison_operator, unit_type, standard_unit_code, custom_unit_label, target_significand, target_scale, target_duration_seconds, '2026-08-02', effective_to"
           : "importance_level, weight, '2026-08-02', effective_to"},
       created_at, updated_at
     FROM ${table} WHERE habit_id = $habitId;`,
    { $id: id, $habitId: habitId },
  );
}

async function splitApplicableVersions(
  harness: TestHarness,
  habitId: ReturnType<typeof plannerId>,
  ids: readonly [ReturnType<typeof plannerId>, ReturnType<typeof plannerId>, ReturnType<typeof plannerId>],
): Promise<void> {
  for (const table of [
    'habit_schedule_versions',
    'habit_tracking_versions',
    'habit_importance_versions',
  ] as const) {
    await harness.database.runAsync(
      `UPDATE ${table} SET effective_to = $split, updated_at = $now WHERE habit_id = $habitId;`,
      { $split: AUGUST_15, $now: FIXED_NOW + 1, $habitId: habitId },
    );
  }
  await duplicateSplit(harness, 'habit_schedule_versions', ids[0], habitId);
  await duplicateSplit(harness, 'habit_tracking_versions', ids[1], habitId);
  await duplicateSplit(harness, 'habit_importance_versions', ids[2], habitId);
}

async function duplicateSplit(
  harness: TestHarness,
  table: 'habit_schedule_versions' | 'habit_tracking_versions' | 'habit_importance_versions',
  id: ReturnType<typeof plannerId>,
  habitId: ReturnType<typeof plannerId>,
): Promise<void> {
  await harness.database.runAsync(
    `INSERT INTO ${table}
     SELECT $id, habit_id, 2,
       ${table === 'habit_schedule_versions'
         ? 'schedule_type, $split, $end, evaluation_timezone, interval_days, weekdays_mask, weekday, period_target_count, anchor_date, month_day, month_number, week_start'
         : table === 'habit_tracking_versions'
           ? 'tracking_mode, comparison_operator, unit_type, standard_unit_code, custom_unit_label, target_significand, target_scale, target_duration_seconds, $split, $end'
           : 'importance_level, weight, $split, $end'},
       $now, $now
     FROM ${table} WHERE habit_id = $habitId AND version_number = 1;`,
    { $id: id, $habitId: habitId, $split: AUGUST_15, $end: ACTIVE_TO, $now: FIXED_NOW + 1 },
  );
}
