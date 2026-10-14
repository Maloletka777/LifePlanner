import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlannerHabitCatalogueItem, PlannerLocalDate } from '../../../src/features/planner';
import {
  buildManageSections,
  isManageRoot,
  manageDueBucket,
  manageDueChipLabel,
  manageGutterLabel,
  manageGutterWidth,
  manageItemKind,
  manageOverdueLabel,
  manageTaskDueDate,
  manageTypeCounts,
  MANAGE_GUTTER,
  MANAGE_GUTTER_WIDE,
  nextManageSortOrder,
  sortByCreation,
} from '../../../src/features/planner/presentation/manage-items-model';

const date = (value: string) => value as unknown as PlannerLocalDate;
const id = (value: string) => value as unknown as PlannerHabitCatalogueItem['habitId'];
const TODAY = date('2026-07-28');

/**
 * The catalogue row reduced to the fields the model actually reads. Everything
 * else is cast in: this suite is about the rules, not about the read model.
 */
function item(name: string, overrides: Partial<PlannerHabitCatalogueItem> = {}): PlannerHabitCatalogueItem {
  return {
    activeRange: { effectiveFrom: date('2026-07-28'), effectiveTo: null },
    createdAt: 1_000,
    habitId: name,
    name,
    ordinaryChildCount: 0,
    ordinaryParentHabitId: null,
    ordinaryParentName: null,
    schedule: { definition: { scheduleType: 'weekly' } },
    temporalContext: { displayConfiguration: { needsSchedule: false } },
    ...overrides,
  } as unknown as PlannerHabitCatalogueItem;
}

/** A task is what Create writes for `Task`: a daily schedule active for one day. */
function task(name: string, due: string, overrides: Partial<PlannerHabitCatalogueItem> = {}): PlannerHabitCatalogueItem {
  const next = new Date(`${due}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return item(name, {
    activeRange: { effectiveFrom: date(due), effectiveTo: date(next.toISOString().slice(0, 10)) },
    schedule: { definition: { scheduleType: 'daily' } },
    ...overrides,
  } as Partial<PlannerHabitCatalogueItem>);
}

test('a task is a one-day daily item, and everything else is a habit', () => {
  assert.equal(manageItemKind(task('Pay rent', '2026-07-28')), 'task');
  assert.equal(manageItemKind(item('Read')), 'habit');
  // A daily schedule that does not end tomorrow is an ordinary daily habit.
  assert.equal(manageItemKind(item('Water', {
    activeRange: { effectiveFrom: date('2026-07-28'), effectiveTo: null },
    schedule: { definition: { scheduleType: 'daily' } },
  } as Partial<PlannerHabitCatalogueItem>)), 'habit');
  // And a one-day range on a non-daily schedule is not a task either.
  assert.equal(manageItemKind(item('Odd', {
    activeRange: { effectiveFrom: date('2026-07-28'), effectiveTo: date('2026-07-29') },
    schedule: { definition: { scheduleType: 'weekly' } },
  } as Partial<PlannerHabitCatalogueItem>)), 'habit');
});

test('a task due date is its active range, because the model carries no other', () => {
  assert.equal(manageTaskDueDate(task('Pay rent', '2026-08-04')), '2026-08-04');
});

test('the three due buckets are decided against today alone', () => {
  assert.equal(manageDueBucket(date('2026-07-26'), TODAY), 'overdue');
  assert.equal(manageDueBucket(date('2026-07-28'), TODAY), 'today');
  assert.equal(manageDueBucket(date('2026-07-29'), TODAY), 'later');
});

test('two days are worth their words and the rest are read as dates', () => {
  assert.equal(manageDueChipLabel(date('2026-07-28'), TODAY), 'Today');
  assert.equal(manageDueChipLabel(date('2026-07-29'), TODAY), 'Tomorrow');
  assert.equal(manageDueChipLabel(date('2026-08-04'), TODAY), '4 Aug');
  assert.equal(manageDueChipLabel(date('2026-07-26'), TODAY), '26 Jul');
});

test('the type counts are over roots and agree with the split', () => {
  const counts = manageTypeCounts([task('A', '2026-07-28'), task('B', '2026-07-29'), item('C')]);
  assert.deepEqual(counts, { all: 3, habits: 1, tasks: 2 });
});

test('newest first by default, and the toggle has exactly two states', () => {
  const rows = [item('old', { createdAt: 1 }), item('new', { createdAt: 9 }), item('mid', { createdAt: 5 })];
  assert.deepEqual(sortByCreation(rows, 'newest').map(({ name }) => name), ['new', 'mid', 'old']);
  assert.deepEqual(sortByCreation(rows, 'oldest').map(({ name }) => name), ['old', 'mid', 'new']);
  assert.equal(nextManageSortOrder('newest'), 'oldest');
  assert.equal(nextManageSortOrder('oldest'), 'newest');
  // Stable on the id, so two items written in the same millisecond — which a
  // template bundle does produce — keep one order instead of swapping per render.
  const tied = [item('b', { createdAt: 4 }), item('a', { createdAt: 4 })];
  assert.deepEqual(sortByCreation(tied, 'newest').map(({ name }) => name), ['a', 'b']);
});

test('tasks group by when they are due and habits are one flat list', () => {
  const sections = buildManageSections({
    items: [task('Late', '2026-07-26'), task('Now', '2026-07-28'), task('Soon', '2026-08-04'), item('Read')],
    sortOrder: 'newest',
    today: TODAY,
    typeScope: 'all',
  });
  assert.deepEqual(sections.map(({ key }) => key), ['overdue', 'today', 'later', 'habits']);
  assert.deepEqual(sections.map(({ label }) => label), ['OVERDUE', 'TODAY', 'LATER', 'HABITS']);
  // No section is drawn empty: a heading over nothing says nothing.
  assert.equal(sections.every(({ items }) => items.length > 0), true);
});

test('the type segment withholds the other kind entirely', () => {
  const rows = [task('Now', '2026-07-28'), item('Read')];
  const tasks = buildManageSections({ items: rows, sortOrder: 'newest', today: TODAY, typeScope: 'tasks' });
  const habits = buildManageSections({ items: rows, sortOrder: 'newest', today: TODAY, typeScope: 'habits' });
  assert.deepEqual(tasks.map(({ key }) => key), ['today']);
  assert.deepEqual(habits.map(({ key }) => key), ['habits']);
});

test('what needs a schedule is pinned above everything, and only where repair means something', () => {
  const rows = [
    item('Broken', { temporalContext: { displayConfiguration: { needsSchedule: true } } } as Partial<PlannerHabitCatalogueItem>),
    item('Fine'),
    task('Now', '2026-07-28'),
  ];
  const active = buildManageSections({ items: rows, sortOrder: 'newest', today: TODAY, typeScope: 'all' });
  assert.equal(active[0]?.key, 'needsSchedule');
  assert.deepEqual(active[0]?.items.map(({ name }) => name), ['Broken']);
  // It appears once: pinned above, and not again in the list it came out of.
  assert.equal(active.flatMap(({ items }) => items).filter(({ name }) => name === 'Broken').length, 1);
  // An archived item has no repair to make towards, so the section is withheld.
  const archived = buildManageSections({ items: rows, pinNeedsSchedule: false, sortOrder: 'newest', today: TODAY, typeScope: 'all' });
  assert.equal(archived.some(({ key }) => key === 'needsSchedule'), false);
});

test('a habit left over from the sub-habit model never becomes a row of this list', () => {
  // Nothing creates one now and the launch sweep removes them, but a database is
  // only swept once it is opened — until then it must not stand in the list.
  const parent = item('Morning', { ordinaryChildCount: 2 });
  const rows = [parent, item('Stretch', { ordinaryParentHabitId: id('Morning') }), item('Coffee', { ordinaryParentHabitId: id('Morning') })];
  assert.equal(isManageRoot(parent), true);
  assert.equal(isManageRoot(rows[1]), false);
  const sections = buildManageSections({ items: rows, sortOrder: 'newest', today: TODAY, typeScope: 'all' });
  assert.deepEqual(sections.flatMap(({ items }) => items).map(({ name }) => name), ['Morning']);
});


// ── The plate in the journal's language (design_handoff_manage_plate) ────────

test('the gutter says when the item comes round, in the form its kind actually has', () => {
  // PD-MANAGE-018. A task has a due day and a habit has a time of day, so one column
  // answers one question in the two forms the two kinds have between them.
  assert.deepEqual(
    manageGutterLabel({ due: date('2026-07-26'), kind: 'task', plannedLocalTime: null, today: TODAY }),
    { label: '26 Jul', tone: 'overdue' },
  );
  assert.deepEqual(
    manageGutterLabel({ due: TODAY, kind: 'task', plannedLocalTime: null, today: TODAY }),
    { label: 'Today', tone: 'today' },
  );
  assert.deepEqual(
    manageGutterLabel({ due: date('2026-07-29'), kind: 'task', plannedLocalTime: null, today: TODAY }),
    { label: 'Tomorrow', tone: 'later' },
  );
  // A habit's minute, and `Anytime` where it has none — the word the journal already
  // calls the section it puts such an item in.
  assert.deepEqual(
    manageGutterLabel({ due: TODAY, kind: 'habit', plannedLocalTime: '07:00', today: TODAY }),
    { label: '07:00', tone: 'timed' },
  );
  assert.deepEqual(
    manageGutterLabel({ due: TODAY, kind: 'habit', plannedLocalTime: null, today: TODAY }),
    { label: 'Anytime', tone: 'anytime' },
  );
  // A task's own time never reaches the gutter: the cell is its due day, and the time
  // is the one fact the caption beside it carries.
  assert.equal(
    manageGutterLabel({ due: TODAY, kind: 'task', plannedLocalTime: '09:30', today: TODAY }).label,
    'Today',
  );
});

test('the gutter is wide enough for the longest thing it can say', () => {
  // **Measured rather than drawn.** The design's column is the journal's 76 pt, which
  // holds `HH:MM`; this one has to hold `Tomorrow`, and at 13/700 that measures ~63 pt
  // against the 56 pt that 76 leaves after its 2 x 10 padding. The mock never draws
  // that word, which is why the clipping was not visible there.
  assert.equal(MANAGE_GUTTER, 84);
  assert.ok(MANAGE_GUTTER - 20 >= 63, 'the widest label has to fit at scale 1');
  // It follows the text scale that is actually on: three times in this application a
  // time column has been a constant and three times it has clipped (PD-TODAY-032).
  assert.equal(manageGutterWidth(1), MANAGE_GUTTER);
  assert.equal(manageGutterWidth(1.2), Math.ceil(MANAGE_GUTTER * 1.2));
  // Below 1 it never shrinks, and the cap is what the capped label itself needs — so
  // the column cannot clip at any supported text size.
  assert.equal(manageGutterWidth(0.85), MANAGE_GUTTER);
  assert.equal(manageGutterWidth(2), MANAGE_GUTTER_WIDE);
  assert.equal(MANAGE_GUTTER_WIDE, Math.ceil(MANAGE_GUTTER * 1.4));
});

test('an overdue task says how long it has stood, in the wording the app already uses', () => {
  // The section says a task is overdue and the gutter says which day it was due;
  // neither says how long, which is what makes an old task read differently from
  // yesterday's. Days run to a month and months take over (PD-OVERVIEW-013).
  assert.equal(manageOverdueLabel(date('2026-07-27'), TODAY), '1 day overdue');
  assert.equal(manageOverdueLabel(date('2026-07-26'), TODAY), '2 days overdue');
  assert.equal(manageOverdueLabel(date('2026-06-28'), TODAY), '30 days overdue');
  assert.equal(manageOverdueLabel(date('2026-05-28'), TODAY), '2 months overdue');
  // Nothing that has not arrived is late, and today is not late either.
  assert.equal(manageOverdueLabel(TODAY, TODAY), null);
  assert.equal(manageOverdueLabel(date('2026-07-29'), TODAY), null);
});
