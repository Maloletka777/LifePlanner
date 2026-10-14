import assert from 'node:assert/strict';
import test from 'node:test';

import { HABIT_ACCENT_OPTIONS, HABIT_SYMBOL_CATALOGUE } from '../../../src/features/planner/domain';
import { filterHabitIconOptions } from '../../../src/features/planner/presentation/habit-identity-picker-model';

test('identity picker reaches the exact canonical catalogues', () => {
  assert.equal(HABIT_ACCENT_OPTIONS.length, 16);
  assert.equal(HABIT_SYMBOL_CATALOGUE.length, 94);
  assert.equal(filterHabitIconOptions('', 'All').length, 94);
});

test('identity search and categories use canonical metadata', () => {
  assert.equal(filterHabitIconOptions('hydrate', 'All').some(({ key }) => key === 'water_bottle'), true);
  assert.equal(filterHabitIconOptions('', 'Fitness').some(({ key }) => key === 'cycling'), true);
  assert.equal(filterHabitIconOptions('', 'Personal care').some(({ key }) => key === 'dental_care'), true);
});
