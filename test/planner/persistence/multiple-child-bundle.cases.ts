import assert from 'node:assert/strict';
import test from 'node:test';

import { baseCommand, createHarness, tableCount } from './test-fixtures';

/**
 * A parent and three named children, with identities of their own.
 *
 * This used to be one of the shipped templates. The catalogue is gone, but what
 * the case is actually about — a named routine reaching persistence through the
 * bundle command with each row's icon and accent intact — is not, so the fixture
 * is written here instead of being borrowed from a screen that no longer exists.
 */
const ROUTINE = Object.freeze({
  name: 'Workout',
  iconKey: 'workout',
  accentKey: 'peach',
  children: Object.freeze([
    Object.freeze({ name: 'Warm up for 30 minutes', iconKey: 'workout', accentKey: 'amber' }),
    Object.freeze({ name: 'Main workout', iconKey: 'workout', accentKey: 'coral' }),
    Object.freeze({ name: 'Stretch for 30 minutes', iconKey: 'workout', accentKey: 'mint' }),
  ]),
});

test('canonical bundle transaction saves manual groups containing 0, 1, 2, 5, and 10 ordinary children', async () => {
  for (const childCount of [0, 1, 2, 5, 10]) {
    const h = await createHarness(80_000 + childCount * 100);
    try {
      const result = await h.createHabitBundle({ habits: [
        { parentIndex: null, command: baseCommand({ name: `Parent ${childCount}` }) },
        ...Array.from({ length: childCount }, (_, index) => ({ parentIndex: 0, command: baseCommand({ name: `Child ${index + 1}` }) })),
      ] });
      assert.equal(result.ok, true, `child count ${childCount}`);
      assert.equal(await tableCount(h.database, 'habits'), childCount + 1);
      assert.equal(await tableCount(h.database, 'habit_visual_identities'), childCount + 1);
      assert.equal(await tableCount(h.database, 'habit_ordinary_parent_versions'), childCount);
      assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'), []);
    } finally {
      h.database.close();
    }
  }
});

test('routine-step child drafts inherit the resolved parent accent once while keeping their own symbols and overrides', async (t) => {
  const h = await createHarness(81_500); t.after(() => h.database.close());
  const result = await h.createHabitBundle({ habits: [
    { parentIndex: null, command: baseCommand({ name: 'Parent', iconIdentity: { kind: 'symbol', symbolKey: 'morning_routine' }, accentKey: 'purple' }) },
    { parentIndex: 0, completionRole: 'routine_step', command: baseCommand({ name: 'Inherited child', iconIdentity: { kind: 'symbol', symbolKey: 'dental_care' } }) },
    { parentIndex: 0, completionRole: 'routine_step', command: baseCommand({ name: 'Overridden child', iconIdentity: { kind: 'emoji', emoji: '🧘' }, accentKey: 'green' }) },
    { parentIndex: 0, completionRole: 'routine_step', command: baseCommand({ name: 'Automatic child' }) },
  ] });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const byName = new Map(result.value.map((habit) => [habit.name, habit.visualIdentity] as const));
  assert.equal(byName.get('Parent')?.persistedAccentKey, 'purple');
  assert.equal(byName.get('Inherited child')?.persistedAccentKey, 'purple');
  assert.deepEqual(byName.get('Inherited child')?.iconIdentity, { kind: 'symbol', symbolKey: 'dental_care' });
  assert.equal(byName.get('Overridden child')?.persistedAccentKey, 'green');
  assert.deepEqual(byName.get('Overridden child')?.iconIdentity, { kind: 'emoji', emoji: '🧘' });
  assert.equal(byName.get('Automatic child')?.persistedAccentKey, 'purple');
  assert.deepEqual(byName.get('Automatic child')?.iconIdentity, { kind: 'symbol', symbolKey: 'checkbox' });
});

test('invalid parent or child icon identity rolls back the complete atomic bundle', async () => {
  for (const invalidIndex of [0, 1]) {
    const h = await createHarness(81_700 + invalidIndex * 20);
    try {
      const result = await h.createHabitBundle({ habits: [
        { parentIndex: null, command: baseCommand({ name: 'Parent', ...(invalidIndex === 0 ? { iconIdentity: { kind: 'emoji', emoji: 'word' } as never } : {}) }) },
        { parentIndex: 0, command: baseCommand({ name: 'Child', ...(invalidIndex === 1 ? { iconIdentity: { kind: 'symbol', symbolKey: 'unknown' } as never } : {}) }) },
      ] });
      assert.equal(result.ok, false);
      assert.equal(await tableCount(h.database, 'habits'), 0);
      assert.equal(await tableCount(h.database, 'habit_visual_identities'), 0);
      assert.equal(await tableCount(h.database, 'habit_ordinary_parent_versions'), 0);
    } finally {
      h.database.close();
    }
  }
});

test('parent and child bundle application boundary preserves common emoji exactly', async (t) => {
  const h = await createHarness(81_800); t.after(() => h.database.close());
  const fern = '\u{1F33F}';
  const wavingHand = '\u{1F44B}';
  const result = await h.createHabitBundle({ habits: [
    { parentIndex: null, command: baseCommand({ name: 'Emoji parent', iconIdentity: { kind: 'emoji', emoji: fern }, accentKey: 'green' }) },
    { parentIndex: 0, completionRole: 'routine_step', command: baseCommand({ name: 'Emoji child', iconIdentity: { kind: 'emoji', emoji: wavingHand }, accentKey: 'yellow' }) },
  ] });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual((await h.database.getAllAsync<{ emoji_value: string }>('SELECT emoji_value FROM habit_visual_identities ORDER BY habit_id;')).map(({ emoji_value }) => emoji_value).sort(), [fern, wavingHand].sort());
});

test('one invalid child blocks the complete canonical bundle before any database write', async (t) => {
  const h = await createHarness(82_000); t.after(() => h.database.close());
  const result = await h.createHabitBundle({ habits: [
    { parentIndex: null, command: baseCommand({ name: 'Parent' }) },
    { parentIndex: 0, command: baseCommand({ name: 'Valid child' }) },
    { parentIndex: 0, command: baseCommand({ name: '   ' }) },
    { parentIndex: 0, command: baseCommand({ name: 'Retained later child' }) },
  ] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /name/i);
  assert.equal(await tableCount(h.database, 'habits'), 0);
  assert.equal(await tableCount(h.database, 'habit_ordinary_parent_versions'), 0);
});

test('a later relationship failure rolls back a five-child transaction completely', async (t) => {
  const h = await createHarness(82_500); t.after(() => h.database.close());
  await h.database.execAsync(`CREATE TEMP TRIGGER fail_fifth_child_relationship BEFORE INSERT ON habit_ordinary_parent_versions WHEN (SELECT count(*) FROM habit_ordinary_parent_versions)=4 BEGIN SELECT RAISE(ABORT,'forced fifth child failure'); END;`);
  const result = await h.createHabitBundle({ habits: [
    { parentIndex: null, command: baseCommand({ name: 'Parent' }) },
    ...Array.from({ length: 5 }, (_, index) => ({ parentIndex: 0, command: baseCommand({ name: `Child ${index + 1}` }) })),
  ] });
  assert.equal(result.ok, false);
  assert.equal(await tableCount(h.database, 'habits'), 0);
  assert.equal(await tableCount(h.database, 'habit_visual_identities'), 0);
  assert.equal(await tableCount(h.database, 'habit_ordinary_parent_versions'), 0);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('a named routine and a renamed one enter the same bundle command and ordinary relationship path', async () => {
  for (const source of ['named', 'renamed'] as const) {
    const h = await createHarness(source === 'named' ? 83_000 : 84_000);
    try {
      const entries = source === 'named'
        ? [ROUTINE, ...ROUTINE.children]
        : [
            { ...ROUTINE, name: 'Manual workout' },
            ...ROUTINE.children.map((child, index) => ({ ...child, name: `Manual child ${index + 1}` })),
          ];
      const result = await h.createHabitBundle({ habits: entries.map((entry, index) => ({
        parentIndex: index === 0 ? null : 0,
        relationshipMode: index === 0 ? 'independent' as const : 'ordinary' as const,
        command: baseCommand({ name: entry.name, iconKey: entry.iconKey, accentKey: entry.accentKey }),
      })) });
      assert.equal(result.ok, true);
      assert.equal(await tableCount(h.database, 'habits'), 4);
      assert.equal(await tableCount(h.database, 'habit_ordinary_parent_versions'), 3);
    } finally {
      h.database.close();
    }
  }
});
