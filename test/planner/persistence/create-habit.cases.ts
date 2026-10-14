import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreateHabitCommand } from '../../../src/features/planner/application';
import type {
  ImportanceLevel,
  PlannerLocalTime,
  PlannerTimezone,
  ScheduleDefinition,
  TrackingDefinition,
} from '../../../src/features/planner/domain';
import { CANONICAL_HABIT_ACCENT_KEYS } from '../../../src/features/planner/domain';
import {
  ACTIVE_FROM,
  ACTIVE_CATEGORY_ID,
  LONDON,
  REMINDER_TIME,
  baseCommand,
  createHarness,
  insertCategory,
  scheduleFixture,
  trackingFixture,
} from './test-fixtures';

test('CreateHabit saves the Checkbox Gym aggregate and reminder intent', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());

  const result = await harness.createHabit(
    baseCommand({
      name: '  Gym  ',
      description: 'Strength session',
      schedule: scheduleFixture('selected_weekdays'),
      tracking: trackingFixture('checkbox'),
      importance: 'high',
      reminder: {
        triggerLocalTime: REMINDER_TIME,
        timezoneMode: 'schedule_timezone',
        timezoneId: null,
      },
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, 'Gym');
  assert.equal(result.value.scheduleVersion.definition.scheduleType, 'selected_weekdays');
  assert.equal(result.value.trackingVersion.definition.trackingMode, 'checkbox');
  assert.equal(result.value.importanceVersion.importance, 'high');
  assert.equal(result.value.importanceVersion.weight, 3);
  assert.deepEqual(result.value.reminder, {
    id: result.value.reminder?.id,
    triggerLocalTime: '18:00',
    timezoneMode: 'schedule_timezone',
    timezoneId: null,
    enabled: true,
    lifecycle: 'active',
    createdAt: result.value.createdAt,
    updatedAt: result.value.createdAt,
  });
});

test('CreateHabit preserves Drink Water exact target (200, 2)', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const result = await harness.createHabit(
    baseCommand({
      name: 'Drink Water',
      schedule: scheduleFixture('daily'),
      tracking: trackingFixture('quantity'),
      importance: 'normal',
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const tracking = result.value.trackingVersion.definition;
  assert.equal(tracking.trackingMode, 'quantity');
  if (tracking.trackingMode === 'quantity') {
    assert.equal(tracking.target.significand, 200n);
    assert.equal(tracking.target.scale, 2);
    assert.deepEqual(tracking.unit, {
      unitType: 'standard',
      standardUnitCode: 'litre',
    });
  }
  assert.equal(result.value.reminder, null);
});

test('CreateHabit stores explicit visual identity and deterministic defaults without using habit text', async (t) => {
  const harness = await createHarness(1_500);
  t.after(() => harness.database.close());
  const explicit = await harness.createHabit(baseCommand({
    name: 'Anything the user writes',
    tracking: trackingFixture('counter'),
    iconKey: 'reading',
    accentKey: 'violet',
  }));
  const automatic = await harness.createHabit(baseCommand({
    name: 'Drink water is only text',
    tracking: trackingFixture('duration'),
  }));
  assert.equal(explicit.ok, true);
  assert.equal(automatic.ok, true);
  if (!explicit.ok || !automatic.ok) return;
  assert.deepEqual(
    { iconKey: explicit.value.visualIdentity.iconKey, accentKey: explicit.value.visualIdentity.accentKey },
    { iconKey: 'reading', accentKey: 'violet' },
  );
  assert.equal(automatic.value.visualIdentity.iconKey, 'duration');
  const stored = await harness.database.getAllAsync<{ habit_id: string; icon_kind: string; symbol_key: string; emoji_value: null; accent_key: string }>(
    'SELECT habit_id,icon_kind,symbol_key,emoji_value,accent_key FROM habit_visual_identities ORDER BY habit_id;',
  );
  assert.equal(stored.length, 2);
  await harness.database.migrate();
  const reopened = await harness.listPlannerHabits({ asOfLocalDate: ACTIVE_FROM });
  assert.equal(reopened.ok, true);
  if (reopened.ok) {
    const explicitReadback = reopened.value.find(({ habitId }) => habitId === explicit.value.id);
    assert.deepEqual(explicitReadback?.visualIdentity, explicit.value.visualIdentity);
  }
  assert.deepEqual(await harness.database.getAllAsync('PRAGMA foreign_key_check;'), []);
});

test('CreateHabit persists expanded symbols, emoji, and canonical accents with exact reopen readback', async (t) => {
  const harness = await createHarness(1_750);
  t.after(() => harness.database.close());
  const symbol = await harness.createHabit(baseCommand({
    name: 'Code',
    iconIdentity: { kind: 'symbol', symbolKey: 'coding' },
    accentKey: 'grey',
  }));
  const emoji = await harness.createHabit(baseCommand({
    name: 'Coffee',
    iconIdentity: { kind: 'emoji', emoji: '☕️' },
    accentKey: 'brown',
  }));
  assert.equal(symbol.ok, true, JSON.stringify(symbol));
  assert.equal(emoji.ok, true, JSON.stringify(emoji));
  if (!symbol.ok || !emoji.ok) return;
  assert.deepEqual(symbol.value.visualIdentity.iconIdentity, { kind: 'symbol', symbolKey: 'coding' });
  assert.equal(symbol.value.visualIdentity.persistedAccentKey, 'grey');
  assert.deepEqual(emoji.value.visualIdentity.iconIdentity, { kind: 'emoji', emoji: '☕️' });
  assert.equal(emoji.value.visualIdentity.persistedAccentKey, 'brown');
  assert.deepEqual(
    (await harness.database.getAllAsync<Record<string, unknown>>(
      'SELECT icon_kind,symbol_key,emoji_value,accent_key FROM habit_visual_identities ORDER BY habit_id;',
    )).map((row) => ({ ...row })),
    [
      { icon_kind: 'symbol', symbol_key: 'coding', emoji_value: null, accent_key: 'grey' },
      { icon_kind: 'emoji', symbol_key: null, emoji_value: '☕️', accent_key: 'brown' },
    ],
  );
  await harness.database.migrate();
  const reopened = await harness.listPlannerHabits({ asOfLocalDate: ACTIVE_FROM });
  assert.equal(reopened.ok, true);
  if (reopened.ok) {
    assert.deepEqual(reopened.value.find(({ habitId }) => habitId === symbol.value.id)?.visualIdentity, symbol.value.visualIdentity);
    assert.deepEqual(reopened.value.find(({ habitId }) => habitId === emoji.value.id)?.visualIdentity, emoji.value.visualIdentity);
  }
});

test('CreateHabit rejects malformed expanded identity before any persistence write', async (t) => {
  const harness = await createHarness(1_900);
  t.after(() => harness.database.close());
  for (const iconIdentity of [
    { kind: 'emoji', emoji: 'not emoji' },
    { kind: 'emoji', emoji: '😀😀' },
    { kind: 'symbol', symbolKey: 'not_registered' },
  ]) {
    const result = await harness.createHabit(baseCommand({ iconIdentity: iconIdentity as never, accentKey: 'red' }));
    assert.equal(result.ok, false);
  }
  const badAccent = await harness.createHabit({ ...baseCommand(), accentKey: 'magenta' as never });
  assert.equal(badAccent.ok, false);
  assert.equal((await harness.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habits;'))?.count, 0);
  assert.equal((await harness.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_visual_identities;'))?.count, 0);
});

test('CreateHabit application boundary accepts fern exactly and rejection performs no partial write', async (t) => {
  const harness = await createHarness(2_000);
  t.after(() => harness.database.close());
  const fern = '\u{1F33F}';
  assert.deepEqual(Array.from(fern, (character) => character.codePointAt(0)), [0x1f33f]);
  const created = await harness.createHabit(baseCommand({
    name: 'Fern boundary',
    iconIdentity: { kind: 'emoji', emoji: fern },
    accentKey: 'green',
  }));
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  const beforeRejected = (await harness.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habits;'))?.count;
  const rejected = await harness.createHabit(baseCommand({
    name: 'Rejected emoji',
    iconIdentity: { kind: 'emoji', emoji: `${fern}\n` },
    accentKey: 'green',
  }));
  assert.equal(rejected.ok, false);
  assert.equal((await harness.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habits;'))?.count, beforeRejected);
  assert.equal((await harness.database.getFirstAsync<{ emoji_value: string }>('SELECT emoji_value FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: created.value.id }))?.emoji_value, fern);
  await harness.database.migrate();
  const reopened = await harness.getPlannerHabitDetail({ habitId: created.value.id, asOfLocalDate: ACTIVE_FROM });
  assert.equal(reopened.ok, true);
  if (reopened.ok) assert.equal(reopened.value?.habit.visualIdentity.iconIdentity.kind === 'emoji' ? reopened.value.habit.visualIdentity.iconIdentity.emoji : null, fern);
});

test('CreateHabit round-trips every canonical accent family without index-based meaning', async (t) => {
  const harness = await createHarness(2_100);
  t.after(() => harness.database.close());
  for (const [index, accentKey] of CANONICAL_HABIT_ACCENT_KEYS.entries()) {
    const result = await harness.createHabit(baseCommand({ name: `Accent ${index}`, accentKey }));
    assert.equal(result.ok, true, accentKey);
    if (result.ok) assert.equal(result.value.visualIdentity.persistedAccentKey, accentKey);
  }
  assert.deepEqual(
    (await harness.database.getAllAsync<{ accent_key: string }>('SELECT accent_key FROM habit_visual_identities ORDER BY created_at,habit_id;')).map(({ accent_key }) => accent_key),
    CANONICAL_HABIT_ACCENT_KEYS,
  );
});

test('all nine schedule definitions survive repository round-trip', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const scheduleTypes = [
    'daily',
    'selected_weekdays',
    'every_n_days',
    'times_per_week',
    'times_per_month',
    'times_per_year',
    'weekly',
    'monthly',
    'yearly',
  ] as const;

  for (const scheduleType of scheduleTypes) {
    const schedule = scheduleFixture(scheduleType);
    const result = await harness.createHabit(
      baseCommand({ name: `Schedule ${scheduleType}`, schedule }),
    );
    assert.equal(result.ok, true, scheduleType);
    if (result.ok) {
      assert.deepEqual(result.value.scheduleVersion.definition, schedule);
    }
  }
});

test('all five tracking definitions survive repository round-trip', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const trackingModes = [
    'checkbox',
    'counter',
    'quantity',
    'duration',
    'avoidance',
  ] as const;

  for (const trackingMode of trackingModes) {
    const tracking = trackingFixture(trackingMode);
    const result = await harness.createHabit(
      baseCommand({ name: `Tracking ${trackingMode}`, tracking }),
    );
    assert.equal(result.ok, true, trackingMode);
    if (result.ok) {
      assert.deepEqual(result.value.trackingVersion.definition, tracking);
    }
  }
});

test('CreateHabit rejects invalid user intent before persistence', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());

  const invalidCommands: readonly CreateHabitCommand[] = [
    baseCommand({ name: '   ' }),
    baseCommand({ name: 'x'.repeat(201) }),
    baseCommand({ activeTo: baseCommand().activeFrom }),
    baseCommand({
      schedule: {
        ...scheduleFixture('daily'),
        scheduleType: 'selected_weekdays',
        weekdaysMask: 0,
      } as unknown as ScheduleDefinition,
    }),
    baseCommand({
      tracking: {
        ...trackingFixture('quantity'),
        target: { significand: 0n, scale: 0 },
      } as unknown as TrackingDefinition,
    }),
    baseCommand({ importance: 'important' as ImportanceLevel }),
    baseCommand({
      reminder: {
        triggerLocalTime: '6pm' as PlannerLocalTime,
        timezoneMode: 'schedule_timezone',
        timezoneId: null,
      },
    }),
    baseCommand({
      reminder: {
        triggerLocalTime: REMINDER_TIME,
        timezoneMode: 'fixed_timezone',
        timezoneId: 'Mars/Olympus' as PlannerTimezone,
      },
    }),
  ];

  for (const command of invalidCommands) {
    const result = await harness.createHabit(command);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'invalid_input');
  }
});

test('CreateHabit rejects schedule or tracking ranges that conflict with the habit', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const openSchedule = {
    ...scheduleFixture('daily'),
    effectiveRange: {
      ...scheduleFixture('daily').effectiveRange,
      effectiveTo: null,
    },
  } as ScheduleDefinition;
  const result = await harness.createHabit(baseCommand({ schedule: openSchedule }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'validation_conflict');
});

test('active categories are accepted; missing and archived categories are typed failures', async (t) => {
  const activeHarness = await createHarness();
  t.after(() => activeHarness.database.close());
  await insertCategory(activeHarness.database, 'active');
  const accepted = await activeHarness.createHabit(
    baseCommand({ categoryId: ACTIVE_CATEGORY_ID }),
  );
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.value.categoryId, ACTIVE_CATEGORY_ID);

  const missingHarness = await createHarness();
  t.after(() => missingHarness.database.close());
  const missing = await missingHarness.createHabit(
    baseCommand({ categoryId: ACTIVE_CATEGORY_ID }),
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'category_not_found');

  const archivedHarness = await createHarness();
  t.after(() => archivedHarness.database.close());
  await insertCategory(archivedHarness.database, 'archived');
  const archived = await archivedHarness.createHabit(
    baseCommand({ categoryId: ACTIVE_CATEGORY_ID }),
  );
  assert.equal(archived.ok, false);
  if (!archived.ok) assert.equal(archived.error.code, 'category_archived');
});

test('fixed-timezone reminders preserve their explicit IANA timezone', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.database.close());
  const result = await harness.createHabit(
    baseCommand({
      reminder: {
        triggerLocalTime: REMINDER_TIME,
        timezoneMode: 'fixed_timezone',
        timezoneId: LONDON,
      },
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reminder?.timezoneId, LONDON);
});
