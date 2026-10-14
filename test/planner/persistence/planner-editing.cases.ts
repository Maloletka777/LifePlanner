import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIVE_FROM, LONDON, baseCommand, createHarness, domainValue, scheduleFixture, trackingFixture } from './test-fixtures';
import { parsePlannerLocalDate, parsePlannerLocalTime } from '../../../src/features/planner/domain';

const TOMORROW = '2026-08-02';

test('Edit Habit changes identity and safely replaces unused same-day configuration', async (t) => {
  const h = await createHarness(50_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
  const before = await h.database.getFirstAsync<{ id: string }>('SELECT id FROM habit_schedule_versions WHERE habit_id=$id;', { $id: created.value.id });
  const edited = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: ACTIVE_FROM, name: 'Read deeply', description: 'Twenty quiet minutes', schedule: scheduleFixture('selected_weekdays'), tracking: trackingFixture('counter'), importance: 'high', plannedLocalTime: '07:30' });
  assert.equal(edited.ok, true, JSON.stringify(edited)); if (!edited.ok) return;
  assert.deepEqual(edited.value.changedFamilies, ['identity', 'schedule', 'tracking', 'importance', 'planned_time']);
  const after = await h.database.getFirstAsync<{ id: string; schedule_type: string }>('SELECT id,schedule_type FROM habit_schedule_versions WHERE habit_id=$id;', { $id: created.value.id });
  assert.equal(after?.id, before?.id); assert.equal(after?.schedule_type, 'selected_weekdays');
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_tracking_versions WHERE habit_id=$id;', { $id: created.value.id }))?.count, 1);
});

/**
 * **Reported from a device: filing an item that already had a time into a part of the
 * day failed with «The lifecycle transaction failed.»**
 *
 * That message is the fallback branch of `lifecycleTransaction` — the one reached only
 * when something other than a clean domain refusal escaped the transaction, which means
 * the database itself rejected a statement. `uq_habit_planned_time_open` allows one open
 * planned-time version per habit, and replacing a pending version reopened the row
 * before it deleted the pending one, so for the width of a single statement the habit
 * had two.
 *
 * The habit here is open-ended, because that is what an item created in the application
 * is: with an `activeTo` the versions are closed and the index never applies.
 */
test('a second edit dated the same future day does not collide on the open-version index', async (t) => {
  const h = await createHarness(51_500); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand({ activeTo: null, schedule: scheduleFixture('daily', ACTIVE_FROM, null), tracking: trackingFixture('checkbox', ACTIVE_FROM, null) }));
  assert.equal(created.ok, true, JSON.stringify(created)); if (!created.ok) return;

  const first = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Read', description: null, schedule: scheduleFixture('daily', ACTIVE_FROM, null), tracking: trackingFixture('checkbox', ACTIVE_FROM, null), importance: 'normal', plannedLocalTime: '10:30' });
  assert.equal(first.ok, true, JSON.stringify(first)); if (!first.ok) return;
  // The pending version is open, which is the shape the index guards.
  const pending = await h.database.getFirstAsync<{ effective_to: string | null }>('SELECT effective_to FROM habit_planned_time_versions WHERE habit_id=$id AND effective_from=$from;', { $id: created.value.id, $from: TOMORROW });
  assert.equal(pending?.effective_to, null);

  // The move that failed on the device: same day, same time, now filed into the morning.
  const second = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Read', description: null, schedule: scheduleFixture('daily', ACTIVE_FROM, null), tracking: trackingFixture('checkbox', ACTIVE_FROM, null), importance: 'normal', plannedLocalTime: '10:30', plannedBlock: 'morning' });
  assert.equal(second.ok, true, JSON.stringify(second)); if (!second.ok) return;

  const rows = await h.database.getAllAsync<{ effective_from: string; effective_to: string | null; planned_local_time: string | null; planned_block: string | null }>('SELECT effective_from,effective_to,planned_local_time,planned_block FROM habit_planned_time_versions WHERE habit_id=$id ORDER BY effective_from;', { $id: created.value.id });
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { effective_from: ACTIVE_FROM, effective_to: TOMORROW, planned_local_time: null, planned_block: null },
    { effective_from: TOMORROW, effective_to: null, planned_local_time: '10:30', planned_block: 'morning' },
  ]);
  // One open version, which is what the index is for and what the day it plans needs.
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_planned_time_versions WHERE habit_id=$id AND effective_to IS NULL;', { $id: created.value.id }))?.count, 1);
});

test('Edit Habit appends only changed future families and preserves historical rows', async (t) => {
  const h = await createHarness(51_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
  const edited = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Read', description: null, schedule: scheduleFixture('weekly'), tracking: trackingFixture('checkbox'), importance: 'critical', plannedLocalTime: null });
  assert.equal(edited.ok, true, JSON.stringify(edited)); if (!edited.ok) return;
  assert.deepEqual(edited.value.changedFamilies, ['schedule', 'importance']);
  const schedules = await h.database.getAllAsync<{ schedule_type: string; effective_from: string; effective_to: string | null }>('SELECT schedule_type,effective_from,effective_to FROM habit_schedule_versions WHERE habit_id=$id ORDER BY effective_from;', { $id: created.value.id });
  assert.deepEqual(schedules.map((row) => ({ ...row })), [
    { schedule_type: 'daily', effective_from: ACTIVE_FROM, effective_to: TOMORROW },
    { schedule_type: 'weekly', effective_from: TOMORROW, effective_to: '2026-09-01' },
  ]);
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_tracking_versions WHERE habit_id=$id;', { $id: created.value.id }))?.count, 1);
});

test('Edit Habit reports no change without advancing canonical timestamps', async (t) => {
  const h = await createHarness(52_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
  const before = await h.database.getFirstAsync<{ updated_at: number }>('SELECT updated_at FROM habits WHERE id=$id;', { $id: created.value.id });
  const result = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Read', description: null, schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'), importance: 'normal', plannedLocalTime: null });
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.value.outcome, 'no_change');
  assert.deepEqual(await h.database.getFirstAsync('SELECT updated_at FROM habits WHERE id=$id;', { $id: created.value.id }), before);
});

test('Edit Habit changes only mutable visual identity when no versioned configuration changed', async (t) => {
  const h = await createHarness(52_500); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand({ iconKey: 'reading', accentKey: 'blue' }));
  assert.equal(created.ok, true); if (!created.ok) return;
  const beforeCounts = {
    schedules: await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_schedule_versions;'),
    tracking: await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_tracking_versions;'),
    importance: await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_importance_versions;'),
  };
  const edited = await h.editHabit({
    habitId: created.value.id,
    currentLocalDate: ACTIVE_FROM,
    effectiveLocalDate: ACTIVE_FROM,
    name: created.value.name,
    description: created.value.description,
    schedule: scheduleFixture('daily'),
    tracking: trackingFixture('checkbox'),
    importance: 'normal',
    plannedLocalTime: null,
    iconKey: 'workout',
    accentKey: 'mint',
  });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  if (!edited.ok) return;
  assert.deepEqual(edited.value.changedFamilies, ['visual_identity']);
  const identity = await h.database.getFirstAsync<{ icon_kind: string; symbol_key: string; emoji_value: null; accent_key: string }>('SELECT icon_kind,symbol_key,emoji_value,accent_key FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: created.value.id });
  assert.deepEqual(identity === null ? null : { ...identity }, { icon_kind: 'symbol', symbol_key: 'workout', emoji_value: null, accent_key: 'mint' });
  assert.deepEqual({
    schedules: await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_schedule_versions;'),
    tracking: await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_tracking_versions;'),
    importance: await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_importance_versions;'),
  }, beforeCounts);
});

test('Edit Habit switches exactly between emoji and expanded symbols without changing configuration history', async (t) => {
  const h = await createHarness(52_750); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand({ iconIdentity: { kind: 'emoji', emoji: '👍🏽' }, accentKey: 'pink' }));
  assert.equal(created.ok, true); if (!created.ok) return;
  const beforeConfiguration = await h.database.getAllAsync(`SELECT 'schedule' AS family,id FROM habit_schedule_versions UNION ALL SELECT 'tracking',id FROM habit_tracking_versions UNION ALL SELECT 'importance',id FROM habit_importance_versions ORDER BY family,id;`);
  const edited = await h.editHabit({
    habitId: created.value.id,
    currentLocalDate: ACTIVE_FROM,
    effectiveLocalDate: ACTIVE_FROM,
    name: created.value.name,
    description: created.value.description,
    schedule: scheduleFixture('daily'),
    tracking: trackingFixture('checkbox'),
    importance: 'normal',
    plannedLocalTime: null,
    iconIdentity: { kind: 'symbol', symbolKey: 'language_learning' },
    accentKey: 'indigo',
  });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  if (!edited.ok) return;
  assert.deepEqual(edited.value.changedFamilies, ['visual_identity']);
  assert.deepEqual(await h.database.getAllAsync(`SELECT 'schedule' AS family,id FROM habit_schedule_versions UNION ALL SELECT 'tracking',id FROM habit_tracking_versions UNION ALL SELECT 'importance',id FROM habit_importance_versions ORDER BY family,id;`), beforeConfiguration);
  const detail = await h.getPlannerHabitDetail({ habitId: created.value.id, asOfLocalDate: ACTIVE_FROM });
  assert.equal(detail.ok, true);
  if (detail.ok && detail.value !== null) {
    assert.deepEqual(detail.value.habit.visualIdentity.iconIdentity, { kind: 'symbol', symbolKey: 'language_learning' });
    assert.equal(detail.value.habit.visualIdentity.persistedAccentKey, 'indigo');
  }
  const backToEmoji = await h.editHabit({
    habitId: created.value.id,
    currentLocalDate: ACTIVE_FROM,
    effectiveLocalDate: TOMORROW,
    name: created.value.name,
    description: created.value.description,
    schedule: scheduleFixture('daily'),
    tracking: trackingFixture('checkbox'),
    importance: 'normal',
    plannedLocalTime: null,
    iconIdentity: { kind: 'emoji', emoji: '👩‍💻' },
    accentKey: 'cyan',
  });
  assert.equal(backToEmoji.ok, true, JSON.stringify(backToEmoji));
  const exact = await h.database.getFirstAsync<{ icon_kind: string; symbol_key: null; emoji_value: string; accent_key: string }>('SELECT icon_kind,symbol_key,emoji_value,accent_key FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: created.value.id });
  assert.deepEqual(exact === null ? null : { ...exact }, { icon_kind: 'emoji', symbol_key: null, emoji_value: '👩‍💻', accent_key: 'cyan' });
});

test('Edit Habit rejects malformed identity without changing the persisted row', async (t) => {
  const h = await createHarness(52_900); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand({ iconKey: 'reading', accentKey: 'coral' }));
  assert.equal(created.ok, true); if (!created.ok) return;
  const before = await h.database.getFirstAsync('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: created.value.id });
  const edited = await h.editHabit({
    habitId: created.value.id,
    currentLocalDate: ACTIVE_FROM,
    effectiveLocalDate: ACTIVE_FROM,
    name: created.value.name,
    description: created.value.description,
    schedule: scheduleFixture('daily'),
    tracking: trackingFixture('checkbox'),
    importance: 'normal',
    plannedLocalTime: null,
    iconIdentity: { kind: 'emoji', emoji: 'two 😀😀' },
    accentKey: 'red',
  });
  assert.equal(edited.ok, false);
  assert.deepEqual(await h.database.getFirstAsync('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: created.value.id }), before);
});

test('Edit Habit application boundary persists common fern input exactly', async (t) => {
  const h = await createHarness(52_950); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand({ iconKey: 'reading', accentKey: 'coral' }));
  assert.equal(created.ok, true); if (!created.ok) return;
  const fern = '\u{1F33F}';
  const edited = await h.editHabit({
    habitId: created.value.id,
    currentLocalDate: ACTIVE_FROM,
    effectiveLocalDate: ACTIVE_FROM,
    name: created.value.name,
    description: created.value.description,
    schedule: scheduleFixture('daily'),
    tracking: trackingFixture('checkbox'),
    importance: 'normal',
    plannedLocalTime: null,
    iconIdentity: { kind: 'emoji', emoji: fern },
    accentKey: 'green',
  });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.equal((await h.database.getFirstAsync<{ emoji_value: string }>('SELECT emoji_value FROM habit_visual_identities WHERE habit_id=$id;', { $id: created.value.id }))?.emoji_value, fern);
});

test('Edit Habit rejects archived habits and protected same-day corrections', async (t) => {
  const h = await createHarness(53_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
  const observation = await h.recordHabitObservation({ habitId: created.value.id, occurrenceLocalDate: ACTIVE_FROM, occurrenceLocalTime: null, occurrenceTimezone: LONDON, value: { type: 'checkbox', booleanValue: true }, note: null });
  assert.equal(observation.ok, true);
  const protectedEdit = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: ACTIVE_FROM, name: 'Read', description: null, schedule: scheduleFixture('weekly'), tracking: trackingFixture('checkbox'), importance: 'normal', plannedLocalTime: null });
  assert.equal(protectedEdit.ok, false); if (!protectedEdit.ok) assert.equal(protectedEdit.error.code, 'same_day_correction_not_eligible');
  assert.equal((await h.archiveHabit({ habitId: created.value.id, effectiveLocalDate: ACTIVE_FROM, boundaryTimezone: LONDON })).ok, true);
  const archivedEdit = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Archived edit', description: null, schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'), importance: 'normal', plannedLocalTime: null });
  assert.equal(archivedEdit.ok, false); if (!archivedEdit.ok) assert.equal(archivedEdit.error.code, 'archived_habit');
});

test('Edit Habit rolls back identity and all families when a later insert fails', async (t) => {
  const h = await createHarness(54_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
  await h.database.execAsync(`CREATE TRIGGER fail_edit_importance BEFORE INSERT ON habit_importance_versions WHEN NEW.version_number=2 BEGIN SELECT RAISE(ABORT,'forced edit failure'); END;`);
  const result = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Must roll back', description: 'draft', schedule: scheduleFixture('weekly'), tracking: trackingFixture('counter'), importance: 'high', plannedLocalTime: '09:00' });
  assert.equal(result.ok, false);
  const habit = await h.database.getFirstAsync<{ name: string; description: string | null }>('SELECT name,description FROM habits WHERE id=$id;', { $id: created.value.id });
  assert.deepEqual(habit === null ? null : { ...habit }, { name: 'Read', description: null });
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_schedule_versions WHERE habit_id=$id;', { $id: created.value.id }))?.count, 1);
  assert.equal((await h.database.getFirstAsync<{ effective_to: string | null }>('SELECT effective_to FROM habit_schedule_versions WHERE habit_id=$id;', { $id: created.value.id }))?.effective_to, '2026-09-01');
});

/** The same date the file already uses, in the branded form the domain hands out. */
const NEXT_DAY = domainValue(parsePlannerLocalDate(TOMORROW));

test('a one-day item has no tomorrow to open a version in, and says so cleanly', async (t) => {
  // The defect the owner hit: change a task's priority and get *The current importance
  // range is missing or ambiguous* — an integrity error for what is really a calendar
  // fact. A task is a daily schedule whose active range is the single due day, so its
  // configuration versions end **at** the next day; the append looks for a version
  // spanning that boundary and finds none.
  const h = await createHarness(55_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand({
    activeTo: NEXT_DAY,
    schedule: scheduleFixture('daily', ACTIVE_FROM, NEXT_DAY),
    tracking: trackingFixture('checkbox', ACTIVE_FROM, NEXT_DAY),
  }));
  assert.equal(created.ok, true); if (!created.ok) return;

  // Untouched, the same-day correction is the right path and it works.
  const fresh = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: ACTIVE_FROM, name: 'Read', description: null, schedule: scheduleFixture('daily', ACTIVE_FROM, NEXT_DAY), tracking: trackingFixture('checkbox', ACTIVE_FROM, NEXT_DAY), importance: 'high', plannedLocalTime: null });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));

  // **One mark is enough to lose it.** Observations are append-only, so a tick that was
  // undone still protects the day — and the advice the refusal gives cannot be taken.
  assert.equal((await h.recordHabitObservation({ habitId: created.value.id, occurrenceLocalDate: ACTIVE_FROM, occurrenceLocalTime: null, occurrenceTimezone: LONDON, value: { type: 'checkbox', booleanValue: true }, note: null })).ok, true);
  const sameDay = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: ACTIVE_FROM, name: 'Read', description: null, schedule: scheduleFixture('daily', ACTIVE_FROM, NEXT_DAY), tracking: trackingFixture('checkbox', ACTIVE_FROM, NEXT_DAY), importance: 'critical', plannedLocalTime: null });
  assert.equal(sameDay.ok, false);
  if (!sameDay.ok) assert.equal(sameDay.error.code, 'same_day_correction_not_eligible');

  // And the fallback the editor used to take is impossible for this item, which is
  // why the editor no longer takes it: the item's own range is what says so.
  const fallback = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Read', description: null, schedule: scheduleFixture('daily', ACTIVE_FROM, NEXT_DAY), tracking: trackingFixture('checkbox', ACTIVE_FROM, NEXT_DAY), importance: 'critical', plannedLocalTime: null });
  assert.equal(fallback.ok, false);
  if (!fallback.ok) assert.match(fallback.error.message, /current importance range is missing or ambiguous/);
});

test('a second edit dated tomorrow rewrites the plan it made rather than being refused by it', async (t) => {
  // **Reported from the device twice over: a priority that could not be changed, and a
  // placement into a free window that failed on confirmation.** Both are one defect.
  // The editor tries the same-day correction first and falls back to tomorrow when
  // history protects today (PD-EDIT-007); the fallback appends a version starting
  // tomorrow — and `findFutureConflict` then counts *any* version at or after that date
  // and refuses. So the version the first edit created is what forbids the second, and
  // the item's configuration becomes permanently unchangeable after one fallback edit.
  const h = await createHarness(64_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;

  const first = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Read', description: null, schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'), importance: 'high', plannedLocalTime: '09:00' });
  assert.equal(first.ok, true, JSON.stringify(first)); if (!first.ok) return;
  assert.deepEqual(first.value.changedFamilies, ['importance', 'planned_time']);

  // Changing one's mind about the same pending day: nothing has happened on it yet, so
  // there is no history to protect and this is the plan being rewritten, not rewritten
  // history.
  const second = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Read', description: null, schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'), importance: 'critical', plannedLocalTime: '11:30' });
  assert.equal(second.ok, true, JSON.stringify(second)); if (!second.ok) return;
  assert.deepEqual(second.value.changedFamilies, ['importance', 'planned_time']);

  // **One pending version, not two.** The first plan is replaced rather than stacked, so
  // the day the person is planning has exactly one answer.
  const importance = await h.database.getAllAsync<{ importance_level: string; effective_from: string; effective_to: string | null }>('SELECT importance_level,effective_from,effective_to FROM habit_importance_versions WHERE habit_id=$id ORDER BY effective_from,version_number;', { $id: created.value.id });
  assert.deepEqual(importance.map((row) => ({ ...row })), [
    { importance_level: 'normal', effective_from: ACTIVE_FROM, effective_to: TOMORROW },
    { importance_level: 'critical', effective_from: TOMORROW, effective_to: '2026-09-01' },
  ]);
  const planned = await h.database.getAllAsync<{ planned_local_time: string | null; effective_from: string; effective_to: string | null }>('SELECT planned_local_time,effective_from,effective_to FROM habit_planned_time_versions WHERE habit_id=$id ORDER BY effective_from,version_number;', { $id: created.value.id });
  assert.deepEqual(planned.map((row) => ({ ...row })), [
    { planned_local_time: null, effective_from: ACTIVE_FROM, effective_to: TOMORROW },
    { planned_local_time: '11:30', effective_from: TOMORROW, effective_to: '2026-09-01' },
  ]);
});

test('a plan further out than the date being edited is still a conflict', async (t) => {
  // Replacing the pending day is one thing; silently discarding a change the person
  // scheduled for a *later* day is another, and this still refuses rather than guess.
  const h = await createHarness(65_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
  const later = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: '2026-08-10', name: 'Read', description: null, schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'), importance: 'high', plannedLocalTime: null });
  assert.equal(later.ok, true, JSON.stringify(later)); if (!later.ok) return;
  const clash = await h.editHabit({ habitId: created.value.id, currentLocalDate: ACTIVE_FROM, effectiveLocalDate: TOMORROW, name: 'Read', description: null, schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'), importance: 'critical', plannedLocalTime: null });
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.equal(clash.error.code, 'future_version_conflict');
});

// -- The reminder an edit can now change (PD-NOTIFY-007) ---------------------

const liveReminders = async (h: Awaited<ReturnType<typeof createHarness>>, habitId: string) =>
  h.database.getAllAsync<{ id: string; trigger_local_time: string; lifecycle: string; enabled: number }>(
    'SELECT id, trigger_local_time, lifecycle, enabled FROM habit_reminders WHERE habit_id=$id ORDER BY trigger_local_time;',
    { $id: habitId },
  );

test('an edit can add a reminder to an item that had none', async (t) => {
  // **The defect this closes:** `habit_reminders` had exactly two write paths — an INSERT
  // at creation and a DELETE at permanent deletion. There was no update, and `editHabit`
  // mentioned reminders nowhere, so anything chosen in the editor was silently dropped.
  const h = await createHarness(60_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
  assert.deepEqual(await liveReminders(h, created.value.id), []);

  const edited = await h.editHabit({
    currentLocalDate: ACTIVE_FROM, description: null, effectiveLocalDate: ACTIVE_FROM,
    habitId: created.value.id, importance: 'normal', name: baseCommand().name,
    plannedLocalTime: '07:30', reminderLocalTime: '07:20',
    schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'),
  });
  assert.equal(edited.ok, true, JSON.stringify(edited)); if (!edited.ok) return;
  assert.equal(edited.value.changedFamilies.includes('reminder'), true);
  const rows = await liveReminders(h, created.value.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]?.trigger_local_time, rows[0]?.lifecycle, rows[0]?.enabled], ['07:20', 'active', 1]);
});

test('an edit moves a reminder, and leaves exactly one', async (t) => {
  const h = await createHarness(61_000); t.after(() => h.database.close());
  const created = await h.createHabit({ ...baseCommand(), reminder: { timezoneId: null, timezoneMode: 'schedule_timezone', triggerLocalTime: domainValue(parsePlannerLocalTime('07:00', 'triggerLocalTime')) } });
  assert.equal(created.ok, true); if (!created.ok) return;
  assert.equal((await liveReminders(h, created.value.id)).length, 1);

  const edited = await h.editHabit({
    currentLocalDate: ACTIVE_FROM, description: null, effectiveLocalDate: ACTIVE_FROM,
    habitId: created.value.id, importance: 'normal', name: baseCommand().name,
    plannedLocalTime: null, reminderLocalTime: '21:45',
    schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'),
  });
  assert.equal(edited.ok, true, JSON.stringify(edited)); if (!edited.ok) return;
  const rows = await liveReminders(h, created.value.id);
  assert.deepEqual(rows.map((row) => row.trigger_local_time), ['21:45']);
});

test('an edit removes a reminder by deleting the row, not by archiving it', async (t) => {
  // **Load-bearing, not a preference.** The catalogue only ever exposes an *active*
  // reminder, so an archived row would be invisible to the reconciliation — and the
  // notifications it had already put in the operating system would never be cancelled.
  // Deleting makes them orphans, which the reconciliation's orphan rule cancels.
  const h = await createHarness(62_000); t.after(() => h.database.close());
  const created = await h.createHabit({ ...baseCommand(), reminder: { timezoneId: null, timezoneMode: 'schedule_timezone', triggerLocalTime: domainValue(parsePlannerLocalTime('07:00', 'triggerLocalTime')) } });
  assert.equal(created.ok, true); if (!created.ok) return;
  const reminderId = (await liveReminders(h, created.value.id))[0]?.id;
  assert.equal(typeof reminderId, 'string');
  // A projection standing against it, exactly as reconciliation would have left one.
  await h.database.runAsync(
    'INSERT INTO habit_reminder_schedules (reminder_id, system_identifier, status, scheduled_for, failure_reason, updated_at) VALUES ($r, $i, $s, $t, NULL, 1);',
    { $i: `lifeplanner.reminder.${reminderId}.2026-08-01`, $r: String(reminderId), $s: 'scheduled', $t: '07:00' },
  );

  const edited = await h.editHabit({
    currentLocalDate: ACTIVE_FROM, description: null, effectiveLocalDate: ACTIVE_FROM,
    habitId: created.value.id, importance: 'normal', name: baseCommand().name,
    plannedLocalTime: null, reminderLocalTime: null,
    schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'),
  });
  assert.equal(edited.ok, true, JSON.stringify(edited)); if (!edited.ok) return;
  assert.deepEqual(await liveReminders(h, created.value.id), []);
  // The projection went first, because it references the reminder `ON DELETE RESTRICT` —
  // the same ordering the delete chain had to learn (PD-SUBTASK-005).
  assert.equal((await h.database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM habit_reminder_schedules;'))?.count, 0);
  assert.equal((await h.database.getAllAsync<unknown>('PRAGMA foreign_key_check;')).length, 0);
});

test('an unchanged reminder is not a change, and is not rewritten', async (t) => {
  const h = await createHarness(63_000); t.after(() => h.database.close());
  const created = await h.createHabit({ ...baseCommand(), reminder: { timezoneId: null, timezoneMode: 'schedule_timezone', triggerLocalTime: domainValue(parsePlannerLocalTime('07:00', 'triggerLocalTime')) } });
  assert.equal(created.ok, true); if (!created.ok) return;
  const before = (await liveReminders(h, created.value.id))[0];

  const edited = await h.editHabit({
    currentLocalDate: ACTIVE_FROM, description: 'A different note', effectiveLocalDate: ACTIVE_FROM,
    habitId: created.value.id, importance: 'normal', name: baseCommand().name,
    plannedLocalTime: null, reminderLocalTime: '07:00',
    schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'),
  });
  assert.equal(edited.ok, true, JSON.stringify(edited)); if (!edited.ok) return;
  assert.equal(edited.value.changedFamilies.includes('reminder'), false);
  // The same row, with its identity intact: rewriting it would have made every unrelated
  // edit throw away the projection that points at it.
  assert.deepEqual((await liveReminders(h, created.value.id))[0], before);
});

test('a reminder that is not a local minute is refused rather than dropped', async (t) => {
  const h = await createHarness(64_000); t.after(() => h.database.close());
  const created = await h.createHabit(baseCommand()); assert.equal(created.ok, true); if (!created.ok) return;
  const edited = await h.editHabit({
    currentLocalDate: ACTIVE_FROM, description: null, effectiveLocalDate: ACTIVE_FROM,
    habitId: created.value.id, importance: 'normal', name: baseCommand().name,
    plannedLocalTime: null, reminderLocalTime: '25:00',
    schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'),
  });
  assert.equal(edited.ok, false);
  if (!edited.ok) assert.equal(edited.error.field, 'reminderLocalTime');
  // And nothing was written on the way to the refusal.
  assert.deepEqual(await liveReminders(h, created.value.id), []);
});

// ── The planned length (schema v13) ─────────────────────────────────────────

const plannedTimeRows = async (h: Awaited<ReturnType<typeof createHarness>>, habitId: string) =>
  await h.database.getAllAsync<{ planned_local_time: string | null; planned_duration_minutes: number | null; effective_from: string; version_number: number }>(
    `SELECT planned_local_time, planned_duration_minutes, effective_from, version_number
     FROM habit_planned_time_versions WHERE habit_id='${habitId}' ORDER BY version_number;`,
  );

test('a length chosen at creation is stored beside the minute it produced', async (t) => {
  // **The defect this closes:** the time drum has always cut the day by a chosen length
  // so a start could be picked, and then threw the length away because nothing stored
  // it — PD-CREATE-030 recorded exactly that, and it is why a plate could not be drawn
  // as a span. Schema v13 gives the planned-time version its own column.
  const h = await createHarness(70_000); t.after(() => h.database.close());
  const created = await h.createHabit({
    ...baseCommand(),
    plannedDurationMinutes: 90,
    plannedTime: domainValue(parsePlannerLocalTime('07:00', 'plannedTime')),
  });
  assert.equal(created.ok, true, JSON.stringify(created)); if (!created.ok) return;

  const rows = await plannedTimeRows(h, created.value.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]?.planned_local_time, rows[0]?.planned_duration_minutes], ['07:00', 90]);
});

test('an item created without a length has none, rather than a default', async (t) => {
  // Absence is «nobody said». A default of half an hour would be a fabrication in the
  // database, and the day is built to draw the absence instead.
  const h = await createHarness(71_000); t.after(() => h.database.close());
  const created = await h.createHabit({ ...baseCommand(), plannedTime: domainValue(parsePlannerLocalTime('07:00', 'plannedTime')) });
  assert.equal(created.ok, true); if (!created.ok) return;
  assert.equal((await plannedTimeRows(h, created.value.id))[0]?.planned_duration_minutes, null);
});

test('the length travels with the minute through a same-day correction', async (t) => {
  const h = await createHarness(72_000); t.after(() => h.database.close());
  const created = await h.createHabit({
    ...baseCommand(),
    plannedDurationMinutes: 30,
    plannedTime: domainValue(parsePlannerLocalTime('07:00', 'plannedTime')),
  });
  assert.equal(created.ok, true); if (!created.ok) return;

  const edited = await h.editHabit({
    currentLocalDate: ACTIVE_FROM, description: null, effectiveLocalDate: ACTIVE_FROM,
    habitId: created.value.id, importance: 'normal', name: baseCommand().name,
    plannedDurationMinutes: 90, plannedLocalTime: '09:00',
    schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'),
  });
  assert.equal(edited.ok, true, JSON.stringify(edited)); if (!edited.ok) return;

  // One version still, corrected in place — and both halves of «when» moved together.
  const rows = await plannedTimeRows(h, created.value.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]?.planned_local_time, rows[0]?.planned_duration_minutes], ['09:00', 90]);
});

test('a future edit opens a version carrying its own length, and leaves the old one alone', async (t) => {
  // This is the reason the column lives in the planned-time table rather than on the
  // habit: a day drawn in the past shows the length that day was planned with.
  const h = await createHarness(73_000); t.after(() => h.database.close());
  const created = await h.createHabit({
    ...baseCommand(),
    plannedDurationMinutes: 30,
    plannedTime: domainValue(parsePlannerLocalTime('07:00', 'plannedTime')),
  });
  assert.equal(created.ok, true); if (!created.ok) return;

  const edited = await h.editHabit({
    currentLocalDate: ACTIVE_FROM, description: null, effectiveLocalDate: TOMORROW,
    habitId: created.value.id, importance: 'normal', name: baseCommand().name,
    plannedDurationMinutes: 60, plannedLocalTime: '07:00',
    schedule: scheduleFixture('daily'), tracking: trackingFixture('checkbox'),
  });
  assert.equal(edited.ok, true, JSON.stringify(edited)); if (!edited.ok) return;

  const rows = await plannedTimeRows(h, created.value.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.effective_from, row.planned_duration_minutes]), [[ACTIVE_FROM, 30], [TOMORROW, 60]]);
});

test('a length that is not a whole number of minutes inside a day is refused', async (t) => {
  const h = await createHarness(74_000); t.after(() => h.database.close());
  for (const invalid of [0, -30, 1441, 12.5]) {
    const created = await h.createHabit({
      ...baseCommand(),
      plannedDurationMinutes: invalid,
      plannedTime: domainValue(parsePlannerLocalTime('07:00', 'plannedTime')),
    });
    assert.equal(created.ok, false, `a planned duration of ${invalid} must be refused`);
  }
});
