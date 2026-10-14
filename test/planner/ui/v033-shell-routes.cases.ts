import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * What survived the Today rebuild.
 *
 * The six suites that pinned the collapsed-dashboard Today went with the screens
 * they described — a test may not outlive the code it asserts. These are the facts
 * in them that are about something still shipping: which tabs exist, where Planner
 * reveals a habit, and that no reference sample data ever reached production.
 */
const source = (path: string) => readFileSync(path, 'utf8');

const tabs = source('app/(tabs)/_layout.tsx');
const planner = source('src/features/planner/presentation/planner-screen.tsx');
const journal = source('src/features/planner/presentation/day-journal-screen.tsx');
const create = source('src/features/planner/presentation/create-item-screen.tsx');

test('three visible tabs preserve the two parked module routes', () => {
  for (const name of ['index', 'planner', 'tasks', 'finance', 'more']) {
    assert.match(tabs, new RegExp(`name="${name}"`));
  }
  assert.doesNotMatch(tabs, /name="timeline"|name="analytics"/);
  // Tasks and Finance are routes with no href: they are parked, not invented.
  assert.equal((tabs.match(/href: null/g) ?? []).length, 2);
  assert.match(tabs, /tabBarActiveTintColor: theme\.today\.system/);
});

test('Planner keeps the canonical reveal target, and the journal does not duplicate it', () => {
  assert.match(planner, /focusRootId/);
  assert.match(planner, /type: 'reveal'/);
  assert.match(planner, /scrollTo\(\{ animated: true/);
  assert.match(planner, /setHighlightedRootId/);
  assert.doesNotMatch(journal, /focusRootId|focusHabitId/);
});

test('production presentation ships no reference sample data', () => {
  const production = [journal, create].join('\n');
  for (const sample of ['Alex', '£18.20', 'Submit assignment', 'Call clinic', 'Dentist', 'Meeting with team', '22°', 'Morning routine', 'Team call']) {
    assert.equal(production.includes(sample), false, `unexpected sample value: ${sample}`);
  }
});
