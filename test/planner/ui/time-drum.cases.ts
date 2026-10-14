import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  timeDrumBusyAt,
  timeDrumCaption,
  timeDrumChipLabel,
  timeDrumDayNote,
  timeDrumDragRows,
  timeDrumDurationLabel,
  timeDrumIndexOf,
  timeDrumClampIndex,
  timeDrumLocalTime,
  timeDrumMinuteOfLocalTime,
  timeDrumOwnDuration,
  timeDrumRowGeometry,
  timeDrumRows,
  timeDrumSnap,
  timeDrumWarning,
  timeDrumWindow,
  TIME_DRUM_CENTRE,
  TIME_DRUM_DRAG_ROW,
  TIME_DRUM_REACH,
  TIME_DRUM_ROW_HEIGHT,
  TIME_DRUM_WELL_HEIGHT,
  TIME_DRUM_WINDOW_END,
  TIME_DRUM_WINDOW_START,
} from '../../../src/features/planner/presentation/time-drum-model';

const sheet = readFileSync('src/features/planner/presentation/time-drum-sheet.tsx', 'utf8');
const create = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
const sheets = readFileSync('src/features/planner/presentation/create-habit-sheets.tsx', 'utf8');

const WINDOW = timeDrumWindow(null);
const minutes = (rows: readonly { minute: number }[]) => rows.map(({ minute }) => timeDrumLocalTime(minute));

// ── The cut (`Time drum.dc.html` frame 1a) ──────────────────────────────────

test('the day is cut by the chosen length, so every start is where the last one ended', () => {
  const half = timeDrumRows({ durationMinutes: 30, window: WINDOW });
  assert.deepEqual(minutes(half).slice(0, 4), ['06:00', '06:30', '07:00', '07:30']);
  // Each notch begins exactly where its predecessor would have ended: that is the
  // whole of 1a, and it is why the drum cannot rest anywhere the day does not meet.
  half.forEach((row, at) => { if (at > 0) assert.equal(row.minute - half[at - 1].minute, 30); });
  const hour = timeDrumRows({ durationMinutes: 60, window: WINDOW });
  assert.deepEqual(minutes(hour).slice(0, 3), ['06:00', '07:00', '08:00']);
  // **The priced cost, from the design's own note:** 1.5 h gives uneven starts, and
  // a thing cannot be put at 10:15 at all while the length is an hour.
  const long = timeDrumRows({ durationMinutes: 90, window: WINDOW });
  assert.deepEqual(minutes(long).slice(0, 4), ['06:00', '07:30', '09:00', '10:30']);
  assert.equal(hour.some((row) => row.minute === 10 * 60 + 15), false);
});

test('a notch is offered only where the whole length still fits the window', () => {
  const hour = timeDrumRows({ durationMinutes: 60, window: WINDOW });
  const last = hour[hour.length - 1];
  assert.equal(timeDrumLocalTime(last.minute), '22:00');
  assert.ok(last.minute + 60 <= TIME_DRUM_WINDOW_END);
  // 90 minutes cannot start at 22:00 and be over by 23:00, so it is not offered.
  const long = timeDrumRows({ durationMinutes: 90, window: WINDOW });
  // 06:00 stepped by 90 reaches 21:00, and 22:30 would run past 23:00 — so the last
  // notch is where a 90-minute thing still finishes inside the day.
  assert.equal(timeDrumLocalTime(long[long.length - 1].minute), '21:00');
  assert.ok(long[long.length - 1].minute + 90 <= TIME_DRUM_WINDOW_END);
  // A window too short for even one length keeps a row rather than emptying: a wheel
  // with nothing on it is a wheel that cannot be answered.
  const tight = timeDrumRows({ durationMinutes: 180, window: { end: 7 * 60, start: 6 * 60 } });
  assert.deepEqual(minutes(tight), ['06:00']);
});

test('the window is fixed, and widens by whole hours only to reach what is stored', () => {
  assert.deepEqual(timeDrumWindow(null), { end: TIME_DRUM_WINDOW_END, start: TIME_DRUM_WINDOW_START });
  // A time inside it moves nothing: the same minute is the same place on every day.
  assert.deepEqual(timeDrumWindow(9 * 60), { end: TIME_DRUM_WINDOW_END, start: TIME_DRUM_WINDOW_START });
  // An item saved at 05:15 must be reachable, so the start comes back to 05:00.
  assert.deepEqual(timeDrumWindow(5 * 60 + 15), { end: TIME_DRUM_WINDOW_END, start: 5 * 60 });
  assert.deepEqual(timeDrumWindow(23 * 60 + 40), { end: 24 * 60, start: TIME_DRUM_WINDOW_START });
  // And a widened window still holds the value it was widened for.
  const rows = timeDrumRows({ durationMinutes: 15, window: timeDrumWindow(5 * 60 + 15) });
  assert.equal(rows.some((row) => row.minute === 5 * 60 + 15), true);
});

// ── Turning it ──────────────────────────────────────────────────────────────

test('the drum turns with the finger, upward for a later start', () => {
  // Four fifths of a row per notch, and dragging **up** is later — the rows travel
  // down past the choice, which is what a wheel does.
  assert.equal(timeDrumDragRows(-TIME_DRUM_DRAG_ROW), 1);
  assert.equal(timeDrumDragRows(TIME_DRUM_DRAG_ROW * 2), -2);
  assert.equal(timeDrumDragRows(0), 0);
  // A drag shorter than half a step turns nothing, so a tap cannot move the choice.
  assert.equal(timeDrumDragRows(TIME_DRUM_DRAG_ROW * 0.4), 0);
});

test('the drum is bounded by its own ends and never wraps', () => {
  const rows = timeDrumRows({ durationMinutes: 30, window: WINDOW });
  assert.equal(timeDrumClampIndex(rows, -8), 0);
  assert.equal(timeDrumClampIndex(rows, rows.length + 8), rows.length - 1);
  // Wrapping would let a drag from the evening land in the morning, which is a lie
  // about which way the finger went.
  assert.notEqual(timeDrumClampIndex(rows, rows.length + 1), 0);
});

test('changing the length re-cuts the day and the choice lands on the nearest notch', () => {
  const half = timeDrumRows({ durationMinutes: 30, window: WINDOW });
  assert.equal(timeDrumSnap(half, 10 * 60), 10 * 60);
  // 10:00 survives an hour-long cut untouched; 10:30 has nowhere to be and lands on
  // the notch nearest it rather than being thrown away.
  const hour = timeDrumRows({ durationMinutes: 60, window: WINDOW });
  assert.equal(timeDrumSnap(hour, 10 * 60), 10 * 60);
  assert.equal(timeDrumLocalTime(timeDrumSnap(hour, 10 * 60 + 30)), '10:00');
  const long = timeDrumRows({ durationMinutes: 90, window: WINDOW });
  assert.equal(timeDrumLocalTime(timeDrumSnap(long, 10 * 60)), '10:30');
  // The snap is idempotent: re-cutting twice at the same length cannot drift.
  assert.equal(timeDrumSnap(long, timeDrumSnap(long, 10 * 60)), timeDrumSnap(long, 10 * 60));
});

test('the index of a minute is the nearest notch, and ties go to the earlier one', () => {
  const hour = timeDrumRows({ durationMinutes: 60, window: WINDOW });
  assert.equal(timeDrumLocalTime(hour[timeDrumIndexOf(hour, 10 * 60 + 29)].minute), '10:00');
  assert.equal(timeDrumLocalTime(hour[timeDrumIndexOf(hour, 10 * 60 + 31)].minute), '11:00');
  assert.equal(timeDrumLocalTime(hour[timeDrumIndexOf(hour, 10 * 60 + 30)].minute), '10:00');
  // Outside the window it lands on the end it is nearest rather than throwing.
  assert.equal(timeDrumIndexOf(hour, 0), 0);
  assert.equal(timeDrumIndexOf(hour, 24 * 60), hour.length - 1);
});

// ── What is already planned ─────────────────────────────────────────────────

test('a notch says what is already planned inside it, by name and by minute', () => {
  // **A minute where no length is stated, and that is still the domain rather than a
  // choice**: an item nobody gave a length to is a point in time, and a notch can only
  // report where it begins. Where a length *is* stored the notch marks the block —
  // covered by its own cases below, since schema v13.
  const busy = [{ minute: 9 * 60, name: 'Standup' }, { minute: 13 * 60, name: 'Lunch' }];
  const rows = timeDrumRows({ busy, durationMinutes: 30, window: WINDOW });
  const named = rows.filter((row) => row.busyName !== null);
  assert.deepEqual(named.map((row) => [timeDrumLocalTime(row.minute), row.busyName]), [['09:00', 'Standup'], ['13:00', 'Lunch']]);
  // The interval is half-open, so a thing starting exactly where this notch ends does
  // not collide with it — which is the point of cutting the day this way at all.
  assert.equal(timeDrumBusyAt(busy, 8 * 60 + 30, 30), null);
  assert.equal(timeDrumBusyAt(busy, 8 * 60 + 30, 60)?.name, 'Standup');
  // An hour-long notch at 08:30 runs over 09:00, so it is the first one it names.
  assert.equal(timeDrumBusyAt([{ minute: 9 * 60 + 20, name: 'Late' }, { minute: 9 * 60, name: 'Early' }], 9 * 60, 60)?.name, 'Early');
  assert.equal(timeDrumWarning(null), null);
  assert.equal(timeDrumWarning({ minute: 9 * 60, name: 'Standup' }), 'Standup starts at 09:00, inside this notch.');
});

// ── How a row stands ────────────────────────────────────────────────────────

test('a row is smaller, turned and quieter the further it is from the choice', () => {
  const centre = timeDrumRowGeometry(0);
  assert.deepEqual([centre.translateY, centre.rotateX, centre.scale, centre.opacity], [0, 0, 1, 1]);
  const next = timeDrumRowGeometry(1);
  assert.equal(next.scale, 0.95);
  assert.equal(next.rotateX, -17);
  // The travel is reduced by exactly what the row has shrunk, so the rows stay a
  // stack instead of opening gaps as they recede.
  assert.equal(next.translateY, TIME_DRUM_ROW_HEIGHT * 0.95);
  assert.equal(timeDrumRowGeometry(-1).translateY, -TIME_DRUM_ROW_HEIGHT * 0.95);
  // Shrinking stops after three rows; drawing stops just past it.
  assert.equal(timeDrumRowGeometry(3).scale, timeDrumRowGeometry(5).scale);
  assert.equal(timeDrumRowGeometry(3).drawn, true);
  assert.equal(timeDrumRowGeometry(4).drawn, false);
  assert.ok(TIME_DRUM_REACH < 4);
  // Nothing ever fades past invisible.
  for (let distance = 0; distance <= 8; distance += 1) assert.ok(timeDrumRowGeometry(distance).opacity >= 0);
});

test('the well holds six rows and the choice sits in its middle', () => {
  assert.equal(TIME_DRUM_WELL_HEIGHT / TIME_DRUM_ROW_HEIGHT, 6);
  assert.equal(TIME_DRUM_CENTRE, (TIME_DRUM_WELL_HEIGHT - TIME_DRUM_ROW_HEIGHT) / 2);
  // Three rows either side of the choice, which is exactly what the reach draws.
  assert.equal(Math.floor(TIME_DRUM_REACH), 3);
});

// ── Words ───────────────────────────────────────────────────────────────────

test('a length reads the same way everywhere, and a chip has room for it', () => {
  assert.equal(timeDrumDurationLabel(5), '5 min');
  assert.equal(timeDrumDurationLabel(60), '1 h');
  assert.equal(timeDrumDurationLabel(90), '1 h 30 min');
  assert.equal(timeDrumDurationLabel(120), '2 h');
  assert.deepEqual([5, 15, 60, 90].map(timeDrumChipLabel), ['5', '15', '1h', '1.5h']);
});

test('a length of your own steps five minutes at a time and stays inside its bounds', () => {
  assert.equal(timeDrumOwnDuration(25, 5), 30);
  assert.equal(timeDrumOwnDuration(25, -5), 20);
  assert.equal(timeDrumOwnDuration(5, -5), 5);
  assert.equal(timeDrumOwnDuration(180, 5), 180);
});

test('the day the drum cuts is named in the fewest words that are true', () => {
  assert.equal(timeDrumDayNote(0), 'today');
  assert.equal(timeDrumDayNote(1), 'tomorrow');
  assert.equal(timeDrumDayNote(-1), 'yesterday');
  assert.equal(timeDrumDayNote(-4), '4 days ago');
  assert.equal(timeDrumDayNote(3), 'in 3 days');
});

test('minutes and local times convert both ways, and nothing else parses', () => {
  assert.equal(timeDrumLocalTime(0), '00:00');
  assert.equal(timeDrumLocalTime(7 * 60 + 5), '07:05');
  assert.equal(timeDrumMinuteOfLocalTime('07:05'), 7 * 60 + 5);
  assert.equal(timeDrumMinuteOfLocalTime(''), null);
  assert.equal(timeDrumMinuteOfLocalTime('7:05'), null);
  assert.equal(timeDrumMinuteOfLocalTime('24:00'), null);
  assert.equal(timeDrumMinuteOfLocalTime('07:60'), null);
});

// ── What the sheet does not promise ─────────────────────────────────────────

test('the drum hands back the length it cut the day by, not only the start', () => {
  // **This reverses PD-CREATE-030, and the reversal is the point of schema v13.** The
  // length used to cut the day so a start could be picked and then go nowhere, because
  // nothing stored it; the item stores it now, so throwing it away here would discard
  // a choice the person had already made and leave the day unable to draw a span.
  assert.match(sheet, /onDone\(anyTime \? '' : timeDrumLocalTime\(selected\), anyTime \|\| !durationStated \? null : length\)/);
  assert.match(sheet, /anyTime \? 'Any time of day' : timeDrumLocalTime\(selected\)/);
  // An item with no minute carries no length either: a length is measured from a start.
  assert.match(sheet, /anyTime \|\| !durationStated \? null : length/);
  // And the caption stops promising that the length is discarded.
  assert.match(timeDrumCaption(30), /^Notches are 30 min apart/);
  assert.doesNotMatch(timeDrumCaption(30), /not saved with the item/);
  assert.match(timeDrumCaption(30), /saved with the item/);
});

test('the drum reopens on the length the item carries, not on the default', () => {
  // The minute always reopens live (PD-CREATE-008), but a cut is a decision: reopening
  // at 30 minutes would silently re-cut a day somebody had already shaped at 1.5 h.
  assert.match(sheet, /readonly durationValue\?: number \| null;/);
  assert.match(sheet, /setDuration\(storedDuration !== null && !storedIsOwn \? storedDuration : TIME_DRUM_DEFAULT_DURATION\)/);
  // A stored length the chip row does not carry is the person's own, not a preset.
  assert.match(sheet, /storedIsOwn = storedDuration !== null && !TIME_DRUM_DURATIONS\.includes\(storedDuration\)/);
});

test('the native spinner is gone from the create surface, and the sheet is unchanged', () => {
  assert.doesNotMatch(create, /HabitTimeSheet|DateTimePicker/);
  assert.match(create, /<TimeDrumSheet/);
  // The sheet around the drum is the one that was already there: the handle band, the
  // 30 pt corners and `Cancel` all belong to `PlannerFormSheet`.
  assert.match(sheet, /<PlannerFormSheet/);
  assert.match(sheet, /title="Time"/);
  // `Done` gives its slot to the `…` menu, and the trailing slot keeps its target so
  // the title stays centred whatever stands beside it.
  assert.match(sheets, /readonly trailing\?: ReactNode;/);
  assert.match(sheets, /: <View style=\{styles\.sheetDoneTarget\}>\{trailing\}<\/View>/);
  assert.match(sheet, /name="ellipsis-horizontal"/);
  // `All day` is a state of the item, so it is in the menu rather than beside the drum.
  assert.match(sheet, /All day, no time/);
  assert.match(sheet, /Back to \$\{DEFAULT_PLANNED_TIME\}/);
  // The commit is in the body, where the design puts it.
  assert.match(sheet, /Continue/);
});

test('the drum is reachable without the gesture, and the fade needs no dependency', () => {
  // A wheel that can only be dragged is a wheel a switch user cannot answer.
  assert.match(sheet, /accessibilityRole="adjustable"/);
  assert.match(sheet, /\{ name: 'increment' \}, \{ name: 'decrement' \}/);
  // Every row is also its own target, which is the design's own «тап по строке».
  assert.match(sheet, /onPress=\{\(\) => \{ setMinute\(row\.minute\); setAnyTime\(false\); setMenu\(false\); \}\}/);
  // Composed from bands: no gradient library is a dependency and adding one is not
  // authorised — the same technique the bottom scrim uses.
  assert.match(sheet, /function Veil/);
  assert.doesNotMatch(sheet, /expo-linear-gradient|react-native-svg/);
});

test('what a day already holds comes from the journal own selector, never a second rule', () => {
  assert.match(create, /selectDayJournalItems\(\{ nowMinuteOfDay: null, rootGroups: dayPlan\.data\?\.rootGroups \?\? \[\], taskHabitIds: EMPTY_HABIT_IDS \}\)/);
  // The item being edited is not something it collides with.
  assert.match(create, /item\.habitId !== edit\?\.habitId/);
});

// ── Busy time became a block (schema v13) ───────────────────────────────────

test('a thing with a stated length marks every notch it runs through', () => {
  // **This is what PD-CREATE-031 had to withhold.** The design marked busy *time*; an
  // occurrence stored a start and no end, so a notch could only ever say that something
  // *starts* inside it — true, and useless when the thing's whole hour surrounds you.
  const busy = [{ durationMinutes: 60, minute: 9 * 60, name: 'Standup' }];
  const rows = timeDrumRows({ busy, durationMinutes: 30, window: WINDOW });
  const named = rows.filter((row) => row.busyName !== null).map((row) => timeDrumLocalTime(row.minute));
  // 09:00–10:00 covers both half-hours it runs through, and neither neighbour.
  assert.deepEqual(named, ['09:00', '09:30']);
  assert.equal(timeDrumBusyAt(busy, 8 * 60 + 30, 30), null);
  assert.equal(timeDrumBusyAt(busy, 10 * 60, 30), null);
});

test('a thing with no stated length is still a point, and says so', () => {
  // Inventing a span for it would put a false block on the one control that decides
  // where a day's work goes. It keeps the older reading, and must.
  const busy = [{ durationMinutes: null, minute: 9 * 60, name: 'Walk' }];
  const rows = timeDrumRows({ busy, durationMinutes: 30, window: WINDOW });
  assert.deepEqual(
    rows.filter((row) => row.busyName !== null).map((row) => timeDrumLocalTime(row.minute)),
    ['09:00'],
  );
  assert.match(timeDrumWarning(busy[0]) ?? '', /^Walk starts at 09:00, inside this notch\.$/);
});

test('the warning states a range where one is known, and a minute where it is not', () => {
  assert.equal(
    timeDrumWarning({ durationMinutes: 90, minute: 18 * 60 + 30, name: 'Gym' }),
    'Gym runs 18:30 — 20:00.',
  );
  assert.equal(timeDrumWarning(null), null);
});

test('an overlap is half-open at both ends, as everywhere else in the application', () => {
  const busy = [{ durationMinutes: 60, minute: 9 * 60, name: 'Standup' }];
  // A notch ending exactly where it starts does not collide; nor does one starting
  // exactly where it ends. The same rule the axis divides width by.
  assert.equal(timeDrumBusyAt(busy, 8 * 60, 60), null);
  assert.equal(timeDrumBusyAt(busy, 10 * 60, 60), null);
  assert.notEqual(timeDrumBusyAt(busy, 8 * 60 + 59, 60), null);
  assert.notEqual(timeDrumBusyAt(busy, 9 * 60 + 59, 60), null);
});

test('where several collide the earliest is named, because a notch names one', () => {
  const busy = [
    { durationMinutes: 120, minute: 9 * 60, name: 'Design review' },
    { durationMinutes: 30, minute: 9 * 60 + 30, name: 'Standup' },
  ];
  assert.equal(timeDrumBusyAt(busy, 9 * 60 + 30, 30)?.name, 'Design review');
});

test('a length nobody stated is not committed as one', () => {
  // **The fabrication Migration 013 refuses.** The drum always cuts the day by some
  // length and the default is half an hour — but choosing a start from a day cut into
  // half-hours is not saying the thing takes half an hour, and writing 30 would put a
  // duration in the database that nobody ever gave. It becomes stated the moment a chip
  // or `Own` is touched, and it is already stated on an item that carries one.
  assert.match(sheet, /const \[durationStated, setDurationStated\] = useState\(storedDuration !== null\)/);
  assert.match(sheet, /setDurationStated\(true\);/);
  assert.match(sheet, /anyTime \|\| !durationStated \? null : length/);
  // Reopening an item that has a length keeps it stated, so an untouched sheet does not
  // quietly erase what is already there.
  assert.match(sheet, /setDurationStated\(storedDuration !== null\);/);
});
