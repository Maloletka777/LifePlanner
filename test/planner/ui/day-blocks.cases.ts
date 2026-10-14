import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blockDurationLabel,
  currentDayBlock,
  dayElapsedShare,
  selectDayBlocks,
} from '../../../src/features/planner/presentation/day-blocks-model';
import type { DayJournalItem } from '../../../src/features/planner/presentation/day-journal-model';

function item(overrides: Partial<DayJournalItem> & Pick<DayJournalItem, 'habitId'>): DayJournalItem {
  return {
    accentKey: 'blue',
    block: null,
    categoryKey: null,
    checklistDoneCount: 0,
    checklistTotalCount: 0,
    closesByChecklist: false,
    completable: true,
    done: false,
    durationMinutes: null,
    elapsed: false,
    identity: null,
    importance: 'normal',
    isTask: false,
    minuteOfDay: null,
    overdue: false,
    overdueMinutes: null,
    reminderLocalTime: null,
    reopenable: true,
    title: overrides.habitId,
    ...overrides,
  } as DayJournalItem;
}

test('every block is returned even when the day has nothing in it', () => {
  const layout = selectDayBlocks([]);

  assert.deepEqual(layout.sections.map((section) => section.block), ['morning', 'day', 'evening']);
  assert.deepEqual(layout.sections.map((section) => section.count), [0, 0, 0]);
  assert.deepEqual(layout.anytime, []);
  assert.equal(layout.totalCount, 0);
});

test('an item is filed by its stored block and never by its minute', () => {
  // The whole reason the column exists: a morning routine done at 12:40 stays a morning
  // routine, so a failed morning is still countable three weeks later.
  const layout = selectDayBlocks([
    item({ block: 'morning', habitId: 'breakfast', minuteOfDay: 760 }),
  ]);

  const morning = layout.sections.find((section) => section.block === 'morning');
  const day = layout.sections.find((section) => section.block === 'day');

  assert.equal(morning?.count, 1);
  assert.equal(day?.count, 0, '12:40 would have put it here if the minute decided');
});

test('a stated minute files an item that chose no block, so a timed thing is never Anytime', () => {
  // **Reported from a device.** Every item that had a time and no block fell into
  // Anytime, so a whole real day sat below three empty headings and had to be scrolled
  // to. A stated minute is not «whenever». This is the contract's own sentence — a
  // minute may *suggest* a block, and only where nothing was chosen — and it does not
  // touch the rule above it: the hour a thing was **done** still moves nothing.
  const layout = selectDayBlocks([
    item({ habitId: 'breakfast', minuteOfDay: 630 }),                 // 10:30 → morning
    item({ habitId: 'lunch', minuteOfDay: 930 }),                     // 15:30 → day
    item({ habitId: 'dinner', minuteOfDay: 1050 }),                   // 17:30 → evening
    item({ habitId: 'someday' }),                                     // no block, no minute
    item({ block: 'evening', habitId: 'reading', minuteOfDay: 480 }), // 08:00, said outright
  ]);
  const named = (block: 'morning' | 'day' | 'evening') =>
    layout.sections.find((section) => section.block === block)?.items.map((entry) => entry.habitId);

  assert.deepEqual(named('morning'), ['breakfast']);
  assert.deepEqual(named('day'), ['lunch']);
  // A stored block still wins: 08:00 stays in the evening because somebody said so.
  assert.deepEqual(named('evening'), ['reading', 'dinner']);
  // Only the thing nothing places at all is left waiting.
  assert.deepEqual(layout.anytime.map((entry) => entry.habitId), ['someday']);
});

test('an item with no block is Anytime, and that is a state rather than a gap', () => {
  const layout = selectDayBlocks([
    item({ block: null, habitId: 'call-mum' }),
    item({ block: 'day', habitId: 'lunch' }),
  ]);

  assert.deepEqual(layout.anytime.map((entry) => entry.habitId), ['call-mum']);
  assert.equal(layout.totalCount, 2);
});

test('anchored items inside a block stand in clock order', () => {
  const layout = selectDayBlocks([
    item({ block: 'morning', habitId: 'later', minuteOfDay: 600 }),
    item({ block: 'morning', habitId: 'earlier', minuteOfDay: 420 }),
  ]);

  const morning = layout.sections.find((section) => section.block === 'morning');
  assert.deepEqual(morning?.items.map((entry) => entry.habitId), ['earlier', 'later']);
});

test('two items with nothing to separate them never swap between renders', () => {
  const first = selectDayBlocks([
    item({ block: 'evening', habitId: 'zeta' }),
    item({ block: 'evening', habitId: 'alpha' }),
  ]);
  const second = selectDayBlocks([
    item({ block: 'evening', habitId: 'alpha' }),
    item({ block: 'evening', habitId: 'zeta' }),
  ]);

  const order = (layout: ReturnType<typeof selectDayBlocks>) =>
    layout.sections.find((section) => section.block === 'evening')?.items.map((entry) => entry.habitId);

  assert.deepEqual(order(first), ['alpha', 'zeta']);
  assert.deepEqual(order(second), ['alpha', 'zeta']);
});

test('a block adds up only the lengths somebody actually stated', () => {
  const layout = selectDayBlocks([
    item({ block: 'morning', durationMinutes: 30, habitId: 'a' }),
    item({ block: 'morning', durationMinutes: 45, habitId: 'b' }),
    item({ block: 'morning', durationMinutes: null, habitId: 'c' }),
  ]);

  const morning = layout.sections.find((section) => section.block === 'morning');
  assert.equal(morning?.plannedMinutes, 75, 'the one nobody measured contributes nothing');
  assert.equal(morning?.count, 3, 'and it is still in the block');
});

test('a block where nobody stated a length says nothing rather than zero', () => {
  const layout = selectDayBlocks([item({ block: 'day', habitId: 'a' })]);
  const day = layout.sections.find((section) => section.block === 'day');

  assert.equal(day?.plannedMinutes, null, '«takes no time» and «nobody said» are different sentences');
});

test('a block counts what is closed inside it', () => {
  const layout = selectDayBlocks([
    item({ block: 'evening', done: true, habitId: 'a' }),
    item({ block: 'evening', done: false, habitId: 'b' }),
    item({ block: 'morning', done: true, habitId: 'c' }),
  ]);

  const evening = layout.sections.find((section) => section.block === 'evening');
  assert.equal(evening?.doneCount, 1);
  assert.equal(evening?.count, 2);
  assert.equal(layout.totalDoneCount, 2);
});

test('a duration reads the way a person says it, and says nothing where nobody measured', () => {
  assert.equal(blockDurationLabel(null), null);
  assert.equal(blockDurationLabel(0), null, 'zero is not a length somebody chose');
  assert.equal(blockDurationLabel(25), '25m');
  assert.equal(blockDurationLabel(60), '1h');
  assert.equal(blockDurationLabel(70), '1h 10m');
  assert.equal(blockDurationLabel(195), '3h 15m');
});

test('the clock names a block only for itself, and the whole day is covered', () => {
  assert.equal(currentDayBlock(null), null);
  assert.equal(currentDayBlock(4 * 60), 'morning');
  assert.equal(currentDayBlock(11 * 60 + 59), 'morning');
  assert.equal(currentDayBlock(12 * 60), 'day');
  assert.equal(currentDayBlock(16 * 60 + 59), 'day');
  assert.equal(currentDayBlock(17 * 60), 'evening');
  assert.equal(currentDayBlock(23 * 60 + 59), 'evening');
  // One in the morning belongs to the evening it followed rather than to nowhere.
  assert.equal(currentDayBlock(60), 'evening');
  assert.equal(currentDayBlock(3 * 60 + 59), 'evening');
});

test('the day bar measures the day the blocks divide, not the calendar day', () => {
  // **From 04:00, because that is where the day starts here.** Measured from midnight,
  // a sixth of the bar would be spent before «Утро» even begins, and the bar and the
  // list below it would be describing two different days.
  assert.equal(dayElapsedShare(4 * 60), 0, 'the day opens at 04:00');
  assert.equal(dayElapsedShare(16 * 60), 0.5, 'half a day is 16:00');
  // The reported evening: 20:44 is 16 h 44 m past four.
  assert.equal(Math.round((dayElapsedShare(20 * 60 + 44) ?? 0) * 1000) / 10, 69.7);
  // The small hours belong to the day that is ending, not to the one starting.
  assert.equal(dayElapsedShare(2 * 60), (22 * 60) / 1440);
  // Another date has no elapsed part at all: a full bar on tomorrow would be a lie.
  assert.equal(dayElapsedShare(null), null);
});
