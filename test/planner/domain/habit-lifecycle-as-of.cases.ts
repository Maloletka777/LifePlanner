import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePlannerLocalDate,
  resolveHabitLifecycleAsOf,
  type PlannerLocalDate,
} from '../../../src/features/planner/domain';

const date = (value: string): PlannerLocalDate => {
  const parsed = parsePlannerLocalDate(value);
  if (!parsed.ok) assert.fail(parsed.error.message);
  return parsed.value;
};

const activeFrom = date('2026-07-25');
const activeRange = Object.freeze({ effectiveFrom: activeFrom, effectiveTo: date('2026-08-25') });

test('pre-active lifecycle exposes one truthful state and future-effective Archive boundary', () => {
  const result = resolveHabitLifecycleAsOf({
    activeRange,
    aggregateLifecycle: 'active',
    asOfLocalDate: date('2026-07-24'),
    transitions: [{ sequenceNumber: 1, lifecycle: 'active', effectiveLocalDate: activeFrom }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.lifecycleState, 'pre_active');
  assert.equal(result.value.isPreActive, true);
  assert.equal(result.value.activeFrom, activeFrom);
  assert.equal(result.value.nextLifecycleState, 'active');
  assert.equal(result.value.nextLifecycleEffectiveLocalDate, activeFrom);
  assert.deepEqual(result.value.actionAvailability.archive, {
    available: true,
    unavailableReason: null,
    earliestEffectiveLocalDate: activeFrom,
  });
  // A habit that has not started has no marks against it, so it is the safest
  // thing in the catalogue to remove and the likeliest to have been a mistake.
  // Refusing it read backwards; the guard that remains is about integrity rather
  // than about the calendar.
  assert.deepEqual(result.value.actionAvailability.edit, {
    available: true,
    unavailableReason: null,
    earliestEffectiveLocalDate: activeFrom,
  });
  assert.deepEqual(result.value.actionAvailability.delete, result.value.actionAvailability.edit);
  assert.equal(result.value.actionAvailability.pause.unavailableReason, 'not_supported');
  assert.equal(result.value.actionAvailability.resume.unavailableReason, 'not_supported');
});

test('a future-effective archived transition remains pre-active and offers Restore rather than Archive', () => {
  const result = resolveHabitLifecycleAsOf({
    activeRange,
    aggregateLifecycle: 'archived',
    asOfLocalDate: date('2026-07-24'),
    transitions: [
      { sequenceNumber: 1, lifecycle: 'active', effectiveLocalDate: activeFrom },
      { sequenceNumber: 2, lifecycle: 'archived', effectiveLocalDate: activeFrom },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.lifecycleState, 'pre_active');
  assert.equal(result.value.nextLifecycleState, 'archived');
  assert.equal(result.value.actionAvailability.archive.available, false);
  assert.equal(result.value.actionAvailability.archive.unavailableReason, 'habit_already_archived');
  assert.equal(result.value.actionAvailability.restore.available, true);
  assert.equal(result.value.actionAvailability.restore.earliestEffectiveLocalDate, activeFrom);
});

test('active boundary resolution is deterministic and corrupt history stays distinct from pre-active state', () => {
  const active = resolveHabitLifecycleAsOf({
    activeRange,
    aggregateLifecycle: 'active',
    asOfLocalDate: activeFrom,
    transitions: [{ sequenceNumber: 1, lifecycle: 'active', effectiveLocalDate: activeFrom }],
  });
  assert.equal(active.ok, true);
  if (active.ok) {
    assert.equal(active.value.lifecycleState, 'active');
    assert.equal(active.value.lifecycleEffectiveLocalDate, activeFrom);
    assert.equal(active.value.actionAvailability.archive.available, true);
    assert.equal(active.value.actionAvailability.delete.available, true);
  }
  for (const corrupt of [
    resolveHabitLifecycleAsOf({ activeRange, aggregateLifecycle: 'active', asOfLocalDate: date('2026-07-24'), transitions: [] }),
    resolveHabitLifecycleAsOf({ activeRange, aggregateLifecycle: 'archived', asOfLocalDate: activeFrom, transitions: [{ sequenceNumber: 1, lifecycle: 'active', effectiveLocalDate: activeFrom }] }),
    resolveHabitLifecycleAsOf({ activeRange, aggregateLifecycle: 'active', asOfLocalDate: activeFrom, transitions: [
      { sequenceNumber: 1, lifecycle: 'active', effectiveLocalDate: activeFrom },
      { sequenceNumber: 2, lifecycle: 'active', effectiveLocalDate: activeFrom },
    ] }),
    resolveHabitLifecycleAsOf({ activeRange, aggregateLifecycle: 'active', asOfLocalDate: activeFrom, transitions: [
      { sequenceNumber: 1, lifecycle: 'active', effectiveLocalDate: activeFrom },
      { sequenceNumber: 2, lifecycle: 'archived', effectiveLocalDate: date('2026-07-26') },
      { sequenceNumber: 3, lifecycle: 'active', effectiveLocalDate: activeFrom },
    ] }),
  ]) {
    assert.equal(corrupt.ok, false);
    if (!corrupt.ok) assert.equal(corrupt.error.code, 'lifecycle_history_invalid');
  }
});
