import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parsePlannerLocalDate, parsePlannerLocalTime } from '../../../src/features/planner/domain';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';
import {
  FIXED_NOW,
  LONDON,
  baseCommand,
  createHarness,
  createHarnessForDatabase,
  domainValue,
  scheduleFixture,
  tableCount,
  trackingFixture,
} from './test-fixtures';

const JULY_24 = domainValue(parsePlannerLocalDate('2026-07-24'));
const JULY_25 = domainValue(parsePlannerLocalDate('2026-07-25'));
const AUGUST_25 = domainValue(parsePlannerLocalDate('2026-08-25'));
const EIGHT_PM = domainValue(parsePlannerLocalTime('20:00'));

test('pre-active Archive is future-effective, deterministic on retry, and stable after file reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lifeplanner-pre-active-'));
  const filename = join(directory, 'planner.sqlite');
  let database: NodeSqliteTestDatabase | null = new NodeSqliteTestDatabase(filename);
  try {
    await database.migrate();
    await database.runAsync(
      `INSERT INTO planner_preferences(id,progress_mode,created_at,updated_at)
       VALUES(1,'equal',$now,$now);`,
      { $now: FIXED_NOW },
    );
    let harness = createHarnessForDatabase(database, 130_000);
    const created = await createFutureRead(harness);
    const before = await managementAndDetail(harness, created.id);
    assert.equal(before.catalogue.temporalContext.lifecycleState, 'pre_active');
    assert.equal(before.catalogue.temporalContext.isPreActive, true);
    assert.equal(before.catalogue.temporalContext.asOfConfiguration, null);
    assert.equal(before.catalogue.temporalContext.nextEffectiveConfiguration?.effectiveLocalDate, JULY_25);
    assert.equal(before.catalogue.temporalContext.nextEffectiveConfiguration?.schedule?.definition.scheduleType, 'daily');
    assert.equal(before.catalogue.temporalContext.nextEffectiveConfiguration?.plannedTime.plannedLocalTime, EIGHT_PM);
    assert.equal(before.catalogue.temporalContext.displayConfigurationTemporalRelation, 'next_effective');
    assert.equal(before.catalogue.needsSchedule, false);
    assert.equal(before.catalogue.plannedLocalTime, EIGHT_PM);
    assert.deepEqual(before.catalogue.temporalContext, before.detail.temporalContext);
    assert.equal(before.catalogue.temporalContext.actionAvailability.archive.available, true);
    assert.equal(before.catalogue.temporalContext.actionAvailability.archive.earliestEffectiveLocalDate, JULY_25);
    // Not yet started is no longer a reason to refuse either.
    assert.equal(before.catalogue.temporalContext.actionAvailability.edit.available, true);
    assert.equal(before.catalogue.temporalContext.actionAvailability.delete.available, true);

    const command = { habitId: created.id, effectiveLocalDate: JULY_24, boundaryTimezone: LONDON };
    const archived = await harness.archiveHabit(command);
    assert.equal(archived.ok, true, JSON.stringify(archived));
    if (!archived.ok) return;
    assert.equal(archived.value.outcome, 'changed');
    assert.equal(archived.value.requestedEffectiveLocalDate, JULY_24);
    assert.equal(archived.value.effectiveLocalDate, JULY_25);
    assert.equal(archived.value.transition?.effectiveLocalDate, JULY_25);
    assert.equal(archived.value.transition?.lifecycle, 'archived');
    const retry = await harness.archiveHabit(command);
    assert.equal(retry.ok, true, JSON.stringify(retry));
    if (retry.ok) {
      assert.equal(retry.value.outcome, 'already_archived');
      assert.equal(retry.value.effectiveLocalDate, JULY_25);
    }
    assert.equal(await tableCount(database, 'habit_lifecycle_transitions'), 2);
    assert.deepEqual(
      (await database.getAllAsync<{ sequence_number: number; lifecycle: string; effective_local_date: string }>(
        'SELECT sequence_number,lifecycle,effective_local_date FROM habit_lifecycle_transitions WHERE habit_id=$habitId ORDER BY sequence_number;',
        { $habitId: created.id },
      )).map((row) => ({ ...row })),
      [
        { sequence_number: 1, lifecycle: 'active', effective_local_date: JULY_25 },
        { sequence_number: 2, lifecycle: 'archived', effective_local_date: JULY_25 },
      ],
    );
    database.close();
    database = new NodeSqliteTestDatabase(filename);
    await database.migrate();
    harness = createHarnessForDatabase(database, 131_000);
    const reopened = await managementAndDetail(harness, created.id);
    assert.equal(reopened.catalogue.lifecycle, 'archived');
    assert.equal(reopened.catalogue.temporalContext.lifecycleState, 'pre_active');
    assert.equal(reopened.catalogue.temporalContext.nextLifecycleState, 'archived');
    assert.equal(reopened.catalogue.temporalContext.actionAvailability.archive.available, false);
    assert.equal(reopened.catalogue.temporalContext.actionAvailability.archive.unavailableReason, 'habit_already_archived');
    assert.equal(reopened.catalogue.temporalContext.actionAvailability.restore.available, true);
    const restored = await harness.restoreHabit(command);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (restored.ok) {
      assert.equal(restored.value.outcome, 'changed');
      assert.equal(restored.value.effectiveLocalDate, JULY_25);
    }
    assert.equal((await harness.restoreHabit(command)).ok, true);
    assert.equal(await tableCount(database, 'habit_lifecycle_transitions'), 3);
    assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a forced pre-active Archive write failure rolls back every lifecycle fact', async (t) => {
  const harness = await createHarness(132_000);
  t.after(() => harness.database.close());
  const created = await createFutureRead(harness);
  await harness.database.execAsync(
    `CREATE TEMP TRIGGER fail_pre_active_archive
     BEFORE INSERT ON habit_lifecycle_transitions
     WHEN NEW.lifecycle='archived'
     BEGIN SELECT RAISE(ABORT,'forced pre-active archive failure'); END;`,
  );
  const result = await harness.archiveHabit({ habitId: created.id, effectiveLocalDate: JULY_24, boundaryTimezone: LONDON });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'archive_database_failure');
  const habitRow = await harness.database.getFirstAsync<{ lifecycle: string; archived_at: number | null }>(
    'SELECT lifecycle,archived_at FROM habits WHERE id=$habitId;',
    { $habitId: created.id },
  );
  assert.deepEqual(
    habitRow === null ? null : { ...habitRow },
    { lifecycle: 'active', archived_at: null },
  );
  assert.equal(await tableCount(harness.database, 'habit_lifecycle_transitions'), 1);
  assert.deepEqual(await harness.database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('pre-active routine parent Archive closes only canonical future relationships and preserves children', async (t) => {
  const harness = await createHarness(133_000);
  t.after(() => harness.database.close());
  const result = await harness.createHabitBundle({ habits: [
    { parentIndex: null, command: futureCommand('Future routine') },
    { parentIndex: 0, completionRole: 'routine_step', command: futureCommand('Future step') },
  ] });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const archived = await harness.archiveHabit({ habitId: result.value[0]!.id, effectiveLocalDate: JULY_24, boundaryTimezone: LONDON });
  assert.equal(archived.ok, true, JSON.stringify(archived));
  assert.equal(await tableCount(harness.database, 'habits'), 2);
  const relationshipRow = await harness.database.getFirstAsync<{ effective_to: string | null; end_reason: string | null }>(
    'SELECT effective_to,end_reason FROM habit_ordinary_parent_versions;',
  );
  assert.deepEqual(
    relationshipRow === null ? null : { ...relationshipRow },
    { effective_to: '2026-07-26', end_reason: 'parent_archived' },
  );
  assert.deepEqual(await harness.database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

async function createFutureRead(harness: Awaited<ReturnType<typeof createHarness>>) {
  const result = await harness.createHabit(futureCommand('Read'));
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function futureCommand(name: string) {
  return baseCommand({
    name,
    activeFrom: JULY_25,
    activeTo: AUGUST_25,
    schedule: scheduleFixture('daily', JULY_25, AUGUST_25),
    tracking: trackingFixture('duration', JULY_25, AUGUST_25),
    plannedTime: EIGHT_PM,
  });
}

async function managementAndDetail(harness: Awaited<ReturnType<typeof createHarness>>, habitId: string) {
  const catalogue = await harness.listPlannerHabits({ asOfLocalDate: JULY_24, lifecycle: 'all', searchText: 'Read', sort: 'management_default' });
  const detail = await harness.getPlannerHabitDetail({ habitId, asOfLocalDate: JULY_24 });
  assert.equal(catalogue.ok, true, JSON.stringify(catalogue));
  assert.equal(detail.ok, true, JSON.stringify(detail));
  if (!catalogue.ok || !detail.ok || detail.value === null || catalogue.value[0] === undefined) throw new Error('Expected the future habit in both read models.');
  return { catalogue: catalogue.value[0], detail: detail.value };
}
