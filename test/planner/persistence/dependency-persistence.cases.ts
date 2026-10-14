import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AddHabitDependencyCommand,
  CreateAndLinkDependencyCommand,
  LinkExistingDependencyCommand,
} from '../../../src/features/planner/application';
import {
  parsePlannerLocalDate,
  type ImportanceLevel,
  type PlannerLocalDate,
  type PlannerLocalTime,
  type TrackingDefinition,
} from '../../../src/features/planner/domain';
import {
  mapHabitDependencyRow,
  type HabitDependencyVersionRow,
} from '../../../src/features/planner/infrastructure/sqlite';
import {
  ACTIVE_FROM,
  ACTIVE_TO,
  FIXED_NOW,
  REMINDER_TIME,
  baseCommand,
  createHarness,
  domainValue,
  insertCategory,
  plannerId,
  scheduleFixture,
  tableCount,
  trackingFixture,
  type TestHarness,
} from './test-fixtures';

const OCTOBER = domainValue(parsePlannerLocalDate('2026-10-01'));

test('link-existing creates an open follow-up with typed summaries', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const dependent = await createRoot(harness, 'Dependent');

  const result = await harness.addHabitDependency(
    linkCommand(parent.id, dependent.id),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.relationship.dependencyType, 'follow_up');
  assert.equal(result.value.relationship.occurrenceMode, 'inherited_parent');
  assert.equal(result.value.relationship.versionNumber, 1);
  assert.equal(result.value.relationship.effectiveRange.effectiveTo, null);
  assert.equal(result.value.relationship.endReason, null);
  assert.equal(result.value.relationshipState, 'open');
  assert.equal(result.value.parent.id, parent.id);
  assert.equal(result.value.parent.name, 'Parent');
  assert.equal(result.value.dependent.id, dependent.id);
  assert.equal(result.value.dependent.name, 'Dependent');
  assert.equal(result.value.dependentWasCreated, false);
  const stored = await harness.database.getFirstAsync<{
    effective_to: string | null;
    end_reason: string | null;
  }>('SELECT effective_to, end_reason FROM habit_dependency_versions;');
  assert.equal(stored?.effective_to, null);
  assert.equal(stored?.end_reason, null);
});

test('link-existing creates an open prerequisite', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const dependent = await createRoot(harness, 'Dependent');
  const result = await harness.addHabitDependency(
    linkCommand(parent.id, dependent.id, { dependencyType: 'prerequisite' }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.relationship.dependencyType, 'prerequisite');
});

test('finite link-existing derives and stores scheduled_end', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const dependent = await createRoot(harness, 'Dependent');
  const result = await harness.addHabitDependency(
    linkCommand(parent.id, dependent.id, { effectiveTo: ACTIVE_TO }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.relationship.effectiveRange.effectiveTo, ACTIVE_TO);
  assert.equal(result.value.relationship.endReason, 'scheduled_end');
  assert.equal(result.value.relationshipState, 'planned_finite');
  const row = await harness.database.getFirstAsync<{
    effective_to: string | null;
    end_reason: string | null;
  }>('SELECT effective_to, end_reason FROM habit_dependency_versions;');
  assert.equal(row?.effective_to, ACTIVE_TO);
  assert.equal(row?.end_reason, 'scheduled_end');
});

test('linking leaves the existing dependent schedule and aggregate unchanged', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const dependent = await createRoot(harness, 'Dependent');
  const before = await harness.database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM habit_schedule_versions WHERE habit_id = $habitId;',
    { $habitId: dependent.id },
  );
  const result = await harness.addHabitDependency(
    linkCommand(parent.id, dependent.id),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    await harness.database.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM habit_schedule_versions WHERE habit_id = $habitId;',
      { $habitId: dependent.id },
    ),
    before,
  );
  assert.equal(await tableCount(harness.database, 'habits'), 2);
  assert.equal(await tableCount(harness.database, 'habit_tracking_versions'), 2);
  assert.equal(await tableCount(harness.database, 'habit_importance_versions'), 2);
});

test('create-new creates a checkbox dependent and relationship atomically', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const result = await harness.addHabitDependency(newCommand(parent.id));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.dependentWasCreated, true);
  assert.equal(result.value.dependent.name, 'Dependent');
  assert.equal(result.value.dependentTracking.versionNumber, 1);
  assert.equal(result.value.dependentTracking.definition.trackingMode, 'checkbox');
  assert.equal(result.value.dependentImportance.versionNumber, 1);
  assert.equal(result.value.dependentImportance.importance, 'normal');
  assert.equal(result.value.dependentReminders.length, 0);
  assert.equal(
    await countByOwner(
      harness,
      'habit_schedule_versions',
      result.value.dependent.id,
    ),
    0,
  );
  assert.deepEqual(
    result.value.dependent.activeRange,
    result.value.relationship.effectiveRange,
  );
});

test('create-new persists exact quantity tracking without a schedule', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const result = await harness.addHabitDependency(
    newCommand(parent.id, {
      dependent: {
        ...newCommand(parent.id).dependent,
        tracking: trackingFixture('quantity', ACTIVE_FROM, null),
      },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const definition = result.value.dependentTracking.definition;
  assert.equal(definition.trackingMode, 'quantity');
  if (definition.trackingMode === 'quantity') {
    assert.equal(definition.target.significand, 200n);
    assert.equal(definition.target.scale, 2);
  }
  assert.equal(
    await countByOwner(
      harness,
      'habit_schedule_versions',
      result.value.dependent.id,
    ),
    0,
  );
});

test('create-new finite range aligns dependent configuration and scheduled expiry', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const result = await harness.addHabitDependency(
    newCommand(parent.id, {
      effectiveTo: ACTIVE_TO,
      dependent: {
        ...newCommand(parent.id).dependent,
        tracking: trackingFixture('checkbox', ACTIVE_FROM, ACTIVE_TO),
      },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.relationship.endReason, 'scheduled_end');
  assert.equal(result.value.dependent.activeRange.effectiveTo, ACTIVE_TO);
  assert.equal(
    result.value.dependentTracking.definition.effectiveRange.effectiveTo,
    ACTIVE_TO,
  );
  assert.equal(result.value.dependentImportance.effectiveRange.effectiveTo, ACTIVE_TO);
});

test('create-new persists the optional reminder using the shared timestamp', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const result = await harness.addHabitDependency(
    newCommand(parent.id, {
      dependent: {
        ...newCommand(parent.id).dependent,
        reminder: {
          triggerLocalTime: REMINDER_TIME,
          timezoneMode: 'schedule_timezone',
          timezoneId: null,
        },
      },
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.dependentReminders.length, 1);
  assert.equal(result.value.dependentReminders[0].createdAt, FIXED_NOW);
  assert.equal(result.value.relationship.createdAt, FIXED_NOW);
});

test('missing parent and dependent return stable errors', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const existing = await createRoot(harness, 'Existing');
  const missingParent = await harness.addHabitDependency(
    linkCommand(plannerId(8000), existing.id),
  );
  assertDependencyError(missingParent, 'dependency_parent_not_found');
  const missingDependent = await harness.addHabitDependency(
    linkCommand(existing.id, plannerId(8001)),
  );
  assertDependencyError(missingDependent, 'dependency_dependent_not_found');
});

test('archived parent and dependent cannot be linked', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const dependent = await createRoot(harness, 'Dependent');
  await archiveHabit(harness, parent.id);
  assertDependencyError(
    await harness.addHabitDependency(linkCommand(parent.id, dependent.id)),
    'dependency_parent_archived',
  );

  const secondParent = await createRoot(harness, 'Second parent');
  await archiveHabit(harness, dependent.id);
  assertDependencyError(
    await harness.addHabitDependency(
      linkCommand(secondParent.id, dependent.id),
    ),
    'dependency_dependent_archived',
  );
});

test('missing and archived categories block create-new without creating a habit', async (t) => {
  const missingHarness = await createHarness();
  t.after(() => missingHarness.database.close());
  const missingParent = await createRoot(missingHarness, 'Parent');
  assertDependencyError(
    await missingHarness.addHabitDependency(
      newCommand(missingParent.id, {
        dependent: {
          ...newCommand(missingParent.id).dependent,
          categoryId: plannerId(9000),
        },
      }),
    ),
    'dependency_category_not_found',
  );
  assert.equal(await tableCount(missingHarness.database, 'habits'), 1);

  const archivedHarness = await createHarness();
  t.after(() => archivedHarness.database.close());
  const archivedParent = await createRoot(archivedHarness, 'Parent');
  const categoryId = plannerId(9001);
  await insertCategory(archivedHarness.database, 'archived', categoryId);
  assertDependencyError(
    await archivedHarness.addHabitDependency(
      newCommand(archivedParent.id, {
        dependent: {
          ...newCommand(archivedParent.id).dependent,
          categoryId,
        },
      }),
    ),
    'dependency_category_archived',
  );
  assert.equal(await tableCount(archivedHarness.database, 'habits'), 1);
});

test('an active category is preserved on a newly created dependent', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const categoryId = plannerId(9002);
  await insertCategory(harness.database, 'active', categoryId);
  const result = await harness.addHabitDependency(
    newCommand(parent.id, {
      dependent: {
        ...newCommand(parent.id).dependent,
        categoryId,
      },
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.dependent.categoryId, categoryId);
});

test('an invalid relationship effective range is rejected before ID generation', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const dependent = await createRoot(harness, 'Dependent');
  assertDependencyError(
    await harness.addHabitDependency(
      linkCommand(parent.id, dependent.id, {
        effectiveTo: ACTIVE_FROM,
      }),
    ),
    'dependency_invalid_effective_range',
  );
  assert.equal(await tableCount(harness.database, 'habit_dependency_versions'), 0);
});

test('invalid new-dependent name, tracking, importance, and reminder are rejected', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const base = newCommand(parent.id);
  const invalidCommands: readonly AddHabitDependencyCommand[] = [
    newCommand(parent.id, { dependent: { ...base.dependent, name: '   ' } }),
    newCommand(parent.id, {
      dependent: {
        ...base.dependent,
        tracking: {
          ...base.dependent.tracking,
          trackingMode: 'quantity',
        } as unknown as TrackingDefinition,
      },
    }),
    newCommand(parent.id, {
      dependent: {
        ...base.dependent,
        importance: 'important' as ImportanceLevel,
      },
    }),
    newCommand(parent.id, {
      dependent: {
        ...base.dependent,
        reminder: {
          triggerLocalTime: '25:00' as PlannerLocalTime,
          timezoneMode: 'schedule_timezone',
          timezoneId: null,
        },
      },
    }),
  ];
  for (const command of invalidCommands) {
    assertDependencyError(
      await harness.addHabitDependency(command),
      'dependency_invalid_dependent_definition',
    );
  }
  assert.equal(await tableCount(harness.database, 'habits'), 1);
});

test('relationship ranges must fit the parent and existing dependent ranges', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const finiteParent = await createRoot(harness, 'Finite parent', ACTIVE_TO);
  const openDependent = await createRoot(harness, 'Open dependent');
  assertDependencyError(
    await harness.addHabitDependency(
      linkCommand(finiteParent.id, openDependent.id, { effectiveTo: OCTOBER }),
    ),
    'dependency_outside_parent_active_range',
  );

  const openParent = await createRoot(harness, 'Open parent');
  const finiteDependent = await createRoot(
    harness,
    'Finite dependent',
    ACTIVE_TO,
  );
  assertDependencyError(
    await harness.addHabitDependency(
      linkCommand(openParent.id, finiteDependent.id, { effectiveTo: OCTOBER }),
    ),
    'dependency_outside_dependent_active_range',
  );
});

test('self-link, duplicate, and second incoming parent are rejected', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const first = await createRoot(harness, 'First');
  const second = await createRoot(harness, 'Second');
  const third = await createRoot(harness, 'Third');
  assertDependencyError(
    await harness.addHabitDependency(linkCommand(first.id, first.id)),
    'dependency_self_link',
  );
  assert.equal(
    (await harness.addHabitDependency(linkCommand(first.id, second.id))).ok,
    true,
  );
  assertDependencyError(
    await harness.addHabitDependency(linkCommand(first.id, second.id)),
    'dependency_duplicate_relationship',
  );
  assertDependencyError(
    await harness.addHabitDependency(linkCommand(third.id, second.id)),
    'dependency_second_active_parent',
  );
});

test('transactional graph validation rejects cycles and paths over five edges', async (t) => {
  const cycleHarness = await createHarness();
  t.after(() => cycleHarness.database.close());
  const cycleA = await createRoot(cycleHarness, 'A');
  const cycleB = await createRoot(cycleHarness, 'B');
  assert.equal(
    (await cycleHarness.addHabitDependency(linkCommand(cycleB.id, cycleA.id))).ok,
    true,
  );
  assertDependencyError(
    await cycleHarness.addHabitDependency(linkCommand(cycleA.id, cycleB.id)),
    'dependency_cycle',
  );

  const depthHarness = await createHarness();
  t.after(() => depthHarness.database.close());
  const nodes = [];
  for (let index = 0; index < 7; index += 1) {
    nodes.push(await createRoot(depthHarness, `Node ${index}`));
  }
  for (let index = 0; index < 5; index += 1) {
    assert.equal(
      (
        await depthHarness.addHabitDependency(
          linkCommand(nodes[index].id, nodes[index + 1].id),
        )
      ).ok,
      true,
    );
  }
  assertDependencyError(
    await depthHarness.addHabitDependency(
      linkCommand(nodes[5].id, nodes[6].id),
    ),
    'dependency_depth_exceeded',
  );
});

test('adjacent historical parents persist without changing earlier history', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parentA = await createRoot(harness, 'Parent A');
  const parentB = await createRoot(harness, 'Parent B');
  const dependent = await createRoot(harness, 'Dependent');
  const first = await harness.addHabitDependency(
    linkCommand(parentA.id, dependent.id, { effectiveTo: ACTIVE_TO }),
  );
  assert.equal(first.ok, true);
  const before = await harness.database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM habit_dependency_versions ORDER BY id;',
  );
  const second = await harness.addHabitDependency(
    linkCommand(parentB.id, dependent.id, {
      effectiveFrom: ACTIVE_TO,
      effectiveTo: null,
    }),
  );
  assert.equal(second.ok, true);
  const after = await harness.database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM habit_dependency_versions ORDER BY id;',
  );
  assert.equal(after.length, 2);
  assert.ok(before.every((row) => after.some((candidate) =>
    JSON.stringify(candidate) === JSON.stringify(row))));
});

test('dependency mapper accepts every approved finite operational reason', () => {
  for (const endReason of [
    'scheduled_end',
    'replaced',
    'unlinked',
    'parent_archived',
    'dependent_archived',
  ] as const) {
    const result = mapHabitDependencyRow(
      dependencyRow({ effective_to: ACTIVE_TO, end_reason: endReason }),
    );
    assert.equal(result.ok, true, endReason);
    if (result.ok) assert.equal(result.value.endReason, endReason);
  }
});

test('dependency mapper rejects contradictory and unknown end reasons', () => {
  const malformedRows = [
    dependencyRow({ effective_to: null, end_reason: 'scheduled_end' }),
    dependencyRow({ effective_to: ACTIVE_TO, end_reason: null }),
    dependencyRow({ effective_to: ACTIVE_TO, end_reason: 'expired' }),
  ];
  for (const row of malformedRows) {
    const result = mapHabitDependencyRow(row);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'dependency_data_integrity_failure');
    }
  }
});

test('dependency writes create no observations or derived aggregate rows', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  assert.equal((await harness.addHabitDependency(newCommand(parent.id))).ok, true);
  assert.equal(await tableCount(harness.database, 'habit_observations'), 0);
  assert.equal(await tableCount(harness.database, 'daily_focus_entries'), 0);
  const derivedTables = await harness.database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND (name LIKE '%occurrence%' OR name LIKE '%progress%'
         OR name LIKE '%streak%' OR name LIKE '%analytics%');`,
  );
  assert.deepEqual(derivedTables, []);
});

test('protected end-reason input is rejected before persistence', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const parent = await createRoot(harness, 'Parent');
  const dependent = await createRoot(harness, 'Dependent');
  const command = {
    ...linkCommand(parent.id, dependent.id),
    endReason: 'unlinked',
  } as unknown as LinkExistingDependencyCommand;
  assertDependencyError(
    await harness.addHabitDependency(command),
    'dependency_invalid_command',
  );
  assert.equal(await tableCount(harness.database, 'habit_dependency_versions'), 0);
});

async function createRoot(
  harness: TestHarness,
  name: string,
  activeTo: PlannerLocalDate | null = null,
) {
  const result = await harness.createHabit(
    baseCommand({
      name,
      activeTo,
      schedule: scheduleFixture('daily', ACTIVE_FROM, activeTo),
      tracking: trackingFixture('checkbox', ACTIVE_FROM, activeTo),
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail('Expected root habit creation to succeed.');
  return result.value;
}

function linkCommand(
  parentHabitId: ReturnType<typeof plannerId>,
  dependentHabitId: ReturnType<typeof plannerId>,
  overrides: Partial<LinkExistingDependencyCommand> = {},
): LinkExistingDependencyCommand {
  return {
    dependentSource: 'existing',
    parentHabitId,
    dependentHabitId,
    dependencyType: 'follow_up',
    effectiveFrom: ACTIVE_FROM,
    effectiveTo: null,
    ...overrides,
  };
}

function newCommand(
  parentHabitId: ReturnType<typeof plannerId>,
  overrides: Partial<CreateAndLinkDependencyCommand> = {},
): CreateAndLinkDependencyCommand {
  return {
    dependentSource: 'new',
    parentHabitId,
    dependencyType: 'follow_up',
    effectiveFrom: ACTIVE_FROM,
    effectiveTo: null,
    dependent: {
      name: 'Dependent',
      description: null,
      categoryId: null,
      tracking: trackingFixture('checkbox', ACTIVE_FROM, null),
      importance: 'normal',
      reminder: null,
    },
    ...overrides,
  };
}

function assertDependencyError(
  result: Awaited<ReturnType<TestHarness['addHabitDependency']>>,
  code: string,
): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, code);
}

async function archiveHabit(
  harness: TestHarness,
  habitId: ReturnType<typeof plannerId>,
): Promise<void> {
  await harness.database.runAsync(
    `UPDATE habits
     SET lifecycle = 'archived', archived_at = $now, updated_at = $now
     WHERE id = $habitId;`,
    { $habitId: habitId, $now: FIXED_NOW + 1 },
  );
}

async function countByOwner(
  harness: TestHarness,
  table: 'habit_schedule_versions',
  habitId: ReturnType<typeof plannerId>,
): Promise<number> {
  const row = await harness.database.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM ${table} WHERE habit_id = $habitId;`,
    { $habitId: habitId },
  );
  return row?.count ?? -1;
}

function dependencyRow(
  overrides: Partial<HabitDependencyVersionRow> = {},
): HabitDependencyVersionRow {
  return {
    id: plannerId(7001),
    relationship_id: plannerId(7002),
    version_number: 1,
    parent_habit_id: plannerId(7003),
    dependent_habit_id: plannerId(7004),
    dependency_type: 'follow_up',
    occurrence_mode: 'inherited_parent',
    effective_from: ACTIVE_FROM,
    effective_to: null,
    end_reason: null,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}
