import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const planner = readFileSync('src/features/planner/presentation/planner-screen.tsx', 'utf8');
const rail = readFileSync('src/features/planner/presentation/planner-date-rail.tsx', 'utf8');
const row = readFileSync('src/features/planner/presentation/habit-occurrence-row.tsx', 'utf8');
const group = readFileSync('src/features/planner/presentation/habit-occurrence-group.tsx', 'utf8');

test('definitive Planner uses one date picker, one Add, and compact progress', () => {
  assert.equal((planner.match(/styles\.addControl/g) ?? []).length, 1);
  assert.match(planner, /title="Scheduled"/);
  assert.match(planner, /title="Anytime"/);
  assert.match(planner, /onReturnToToday=\{selectedDate === today \? undefined : selectToday\}/);
  assert.match(planner, /sectionCounts\(/);
  assert.doesNotMatch(rail, /Browse previous week|Browse next week/);
  assert.match(rail, /Opens the full date picker/);
});

test('routine presentation consumes supplied canonical fields', () => {
  for (const field of ['ordinaryStepCount', 'completedOrdinaryStepCount', 'remainingOrdinaryStepCount', 'applicability', 'isRoutineContainer']) assert.match(group, new RegExp(field));
  assert.match(row, /No steps apply today/);
  assert.match(row, /No steps apply today/);
  assert.doesNotMatch(row, /children\.filter\([^)]*qualified|reduce\([^)]*completed/);
});

test('Planner onboarding is global-catalogue aware and saves no quick start', () => {
  assert.match(planner, /model\.createdHabitCount === 0/);
  for (const label of ['Morning routine', 'Drink water', 'Read', 'Exercise', 'Create your own']) assert.match(planner, new RegExp(label));
  assert.match(planner, /pathname: '\/planner\/create'/);
  assert.doesNotMatch(planner, /createHabitBundle|createHabitWithProductionPersistence/);
});
