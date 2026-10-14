import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  createExactQuantity,
  parsePlannerId,
  parsePlannerLocalDate,
  type ExactQuantity,
  type PlannerId,
  type PlannerLocalDate,
} from '../../../src/features/planner/domain';
import {
  createHabitGroupDisclosureState,
  habitGroupIsExpanded,
  reduceHabitGroupDisclosureState,
} from '../../../src/features/planner/presentation/habit-group-disclosure-state';
import { measurementQuickActions } from '../../../src/features/planner/presentation/measurement-quick-actions';
import { createQuickCreatePresentationDefaults } from '../../../src/features/planner/presentation/quick-create-presentation-defaults';

const DATE = localDate('2026-07-23');
const NEXT_DATE = localDate('2026-07-24');
const ROOT_A = plannerId('11111111-1111-4111-8111-111111111111');
const ROOT_B = plannerId('22222222-2222-4222-8222-222222222222');

test('v0.3.3 hierarchy disclosure starts empty and toggles only canonical root IDs', () => {
  const initial = createHabitGroupDisclosureState(DATE);
  assert.equal(initial.expandedRootIds.size, 0);

  const expanded = reduceHabitGroupDisclosureState(initial, { type: 'toggle', rootId: ROOT_A });
  assert.equal(habitGroupIsExpanded(expanded, ROOT_A), true);
  assert.equal(habitGroupIsExpanded(expanded, ROOT_B), false);

  const withSecondRoot = reduceHabitGroupDisclosureState(expanded, { type: 'toggle', rootId: ROOT_B });
  assert.equal(habitGroupIsExpanded(withSecondRoot, ROOT_A), true);
  assert.equal(habitGroupIsExpanded(withSecondRoot, ROOT_B), true);

  const collapsed = reduceHabitGroupDisclosureState(withSecondRoot, { type: 'toggle', rootId: ROOT_A });
  assert.equal(habitGroupIsExpanded(collapsed, ROOT_A), false);
  assert.equal(habitGroupIsExpanded(collapsed, ROOT_B), true);
});

test('Today Search can reveal an owning Planner root without toggling it closed', () => {
  const initial = createHabitGroupDisclosureState(DATE);
  const revealed = reduceHabitGroupDisclosureState(initial, { type: 'reveal', rootId: ROOT_A });
  assert.equal(habitGroupIsExpanded(revealed, ROOT_A), true);
  assert.equal(reduceHabitGroupDisclosureState(revealed, { type: 'reveal', rootId: ROOT_A }), revealed);
});

test('v0.3.3 hierarchy disclosure reconciles same-date roots and resets on date change', () => {
  const expanded = reduceHabitGroupDisclosureState(
    reduceHabitGroupDisclosureState(createHabitGroupDisclosureState(DATE), { type: 'toggle', rootId: ROOT_A }),
    { type: 'toggle', rootId: ROOT_B },
  );
  const refreshed = reduceHabitGroupDisclosureState(expanded, {
    type: 'canonical_refresh',
    selectedDate: DATE,
    canonicalRootIds: [ROOT_B],
  });
  assert.deepEqual([...refreshed.expandedRootIds], [ROOT_B]);

  const changed = reduceHabitGroupDisclosureState(refreshed, {
    type: 'selected_date_changed',
    selectedDate: NEXT_DATE,
  });
  assert.equal(changed.selectedDate, NEXT_DATE);
  assert.equal(changed.expandedRootIds.size, 0);

  const independentlyOwned = createHabitGroupDisclosureState(DATE);
  assert.equal(independentlyOwned.expandedRootIds.size, 0);
  assert.equal(refreshed.expandedRootIds.size, 1);
});

test('v0.3.3 disclosure model has no index or title identity path', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/features/planner/presentation/habit-group-disclosure-state.ts'), 'utf8');
  assert.doesNotMatch(source, /\b(rowIndex|listIndex|habitTitle|title)\b/);
  assert.match(source, /rootId: PlannerId/);
});

test('v0.3.3 Quick Create defaults map to every day from the selected date with Checkbox tracking', () => {
  const defaults = createQuickCreatePresentationDefaults(DATE);
  assert.deepEqual(defaults.activeRange, { activeFrom: DATE, activeTo: '' });
  assert.equal(defaults.schedule.scheduleType, 'daily');
  assert.equal(defaults.schedule.anchorDate, DATE);
  assert.equal(defaults.tracking.trackingMode, 'checkbox');
});

test('v0.3.3 volume quick actions convert approved millilitre presets exactly', () => {
  const litreActions = measurementQuickActions({
    trackingMode: 'quantity',
    unit: { unitType: 'standard', standardUnitCode: 'litre' },
  });
  assert.deepEqual(litreActions, [
    preset('volume-250-millilitres', '+250 ml', 'Add 250 millilitres', 'add', { type: 'quantity', quantity: exact(25n, 2) }),
    preset('volume-500-millilitres', '+500 ml', 'Add 500 millilitres', 'add', { type: 'quantity', quantity: exact(5n, 1) }),
    preset('volume-1000-millilitres', '+1 L', 'Add 1 litre', 'add', { type: 'quantity', quantity: exact(1n, 0) }),
    custom('Enter a custom quantity'),
  ]);
});

test('v0.3.3 duration and count quick actions use exact seconds and whole numbers', () => {
  assert.deepEqual(measurementQuickActions({ trackingMode: 'duration' }), [
    preset('duration-5-minutes', '+5 min', 'Add 5 minutes', 'add', { type: 'duration', durationSeconds: 300 }),
    preset('duration-15-minutes', '+15 min', 'Add 15 minutes', 'add', { type: 'duration', durationSeconds: 900 }),
    preset('duration-30-minutes', '+30 min', 'Add 30 minutes', 'add', { type: 'duration', durationSeconds: 1_800 }),
    custom('Enter a custom duration'),
  ]);
  assert.deepEqual(measurementQuickActions({ trackingMode: 'counter' }), [
    preset('count-1', '+1', 'Add 1', 'add', { type: 'counter', counterDelta: 1 }),
    preset('count-5', '+5', 'Add 5', 'add', { type: 'counter', counterDelta: 5 }),
    preset('count-10', '+10', 'Add 10', 'add', { type: 'counter', counterDelta: 10 }),
    custom('Enter a custom count'),
  ]);
});

test('v0.3.3 avoidance quick actions preserve explicit success and violation truth', () => {
  assert.deepEqual(measurementQuickActions({ trackingMode: 'avoidance' }), [
    preset('avoidance-success', 'Success', 'Record avoidance success', 'record', { type: 'avoidance', booleanValue: true }),
    preset('avoidance-violation', 'Violation', 'Record avoidance violation', 'record', { type: 'avoidance', booleanValue: false }),
  ]);
});

test('v0.3.3 unsupported quantity dimensions and custom units expose only Custom', () => {
  assert.deepEqual(measurementQuickActions({
    trackingMode: 'quantity',
    unit: { unitType: 'standard', standardUnitCode: 'kilogram' },
  }), [custom('Enter a custom quantity')]);
  assert.deepEqual(measurementQuickActions({
    trackingMode: 'quantity',
    unit: { unitType: 'custom', customUnitLabel: 'glasses' },
  }), [custom('Enter a custom quantity')]);
});

test('v0.3.3 quick-action descriptors do not invent progress, qualification, or completion', () => {
  for (const action of measurementQuickActions({ trackingMode: 'counter' })) {
    assert.equal('progress' in action, false);
    assert.equal('qualification' in action, false);
    assert.equal('completion' in action, false);
    assert.equal('command' in action, false);
  }
});

function localDate(value: string): PlannerLocalDate {
  const result = parsePlannerLocalDate(value);
  if (!result.ok) throw new Error(`Invalid test date: ${value}`);
  return result.value;
}

function plannerId(value: string): PlannerId {
  const result = parsePlannerId(value);
  if (!result.ok) throw new Error(`Invalid test Planner ID: ${value}`);
  return result.value;
}

function exact(significand: bigint, scale: number): ExactQuantity {
  const result = createExactQuantity({ significand, scale });
  if (!result.ok) throw new Error(`Invalid test quantity: ${significand} at scale ${scale}`);
  return result.value;
}

function preset(
  id: string,
  label: string,
  accessibilityLabel: string,
  operation: 'add' | 'record',
  value: unknown,
) {
  return { kind: 'preset', id, label, accessibilityLabel, operation, value };
}

function custom(accessibilityLabel: string) {
  return { kind: 'custom', id: 'custom', label: 'Custom', accessibilityLabel, operation: 'open_custom' };
}
