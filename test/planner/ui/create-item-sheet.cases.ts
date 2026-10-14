import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  applyCreateItemType,
  applyCreateRepeatMode,
  CREATE_BLOCK_CHOICES,
  CREATE_BLOCK_LABELS,
  CREATE_DURATION_CHOICES,
  CREATE_CATEGORY_OPTIONS,
  CREATE_NAME_PLACEHOLDERS,
  createBlockChoice,
  createBlockSuggestion,
  createBlockValue,
  createGrowthAvailable,
  createGrowthHasRoom,
  createGrowthSlotsLabel,
  CREATE_PRIMARY_REPEAT_MODES,
  CREATE_QUICK_SYMBOL_COUNT,
  CREATE_REPEAT_MODES,
  createItemTypeFor,
  createPeriodTargetCount,
  createQuickSymbolKeys,
  createRepeatModeFor,
  createRepeatSummary,
  isExtendedRepeatMode,
  reminderSummary,
  reminderTriggerTime,
  repeatNumberFields,
  scheduleNumber,
  stepPeriodTargetCount,
  stepScheduleNumber,
} from '../../../src/features/planner/presentation/create-item-model';
import { CANONICAL_HABIT_ACCENT_KEYS } from '../../../src/features/planner/domain/identity/habit-accent-catalogue';
import {
  DEFAULT_HABIT_CATEGORY,
  HABIT_CATEGORY_OPTIONS,
  habitCategory,
  habitCategoryAccentKey,
  habitCategoryDensityColor,
  habitCategoryForAccentKey,
  habitCategoryTone,
} from '../../../src/features/planner/presentation/habit-category-catalogue';
import { buildCreateHabitCommand, createDefaultScheduleDraft, createDefaultTrackingDraft } from '../../../src/features/planner/presentation/ui-adapters';

const screen = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
const route = readFileSync('app/planner/create.tsx', 'utf8');

const schedule = createDefaultScheduleDraft('2026-07-27');
const open = { activeFrom: '2026-07-27', activeTo: '' };

test('the create route is the single sheet', () => {
  assert.match(route, /CreateItemScreen/);
});

test('a task is a one-off item, and its due day is its only active day', () => {
  const task = applyCreateItemType('task', schedule, open);
  assert.equal(task.schedule.scheduleType, 'daily');
  assert.equal(task.range.activeFrom, '2026-07-27');
  // `effectiveTo` is exclusive, so a range of one day is the day plus one.
  assert.equal(task.range.activeTo, '2026-07-28');
  assert.equal(createItemTypeFor(task.schedule, task.range), 'task');
});

test('switching back to a habit reopens the range from the same date', () => {
  const task = applyCreateItemType('task', schedule, open);
  const habit = applyCreateItemType('habit', task.schedule, task.range);
  assert.equal(habit.range.activeFrom, '2026-07-27');
  assert.equal(habit.range.activeTo, '');
  assert.equal(createItemTypeFor(habit.schedule, habit.range), 'habit');
});

test('the type is read back from the schedule, so nothing carries a separate flag', () => {
  assert.equal(createItemTypeFor(schedule, open), 'habit');
});

test('the four repeats map onto the schema types and read back', () => {
  const days = applyCreateRepeatMode('days', schedule, open);
  assert.equal(days.schedule.scheduleType, 'selected_weekdays');
  assert.equal(createRepeatModeFor(days.schedule, days.range), 'days');

  const perWeek = applyCreateRepeatMode('perWeek', schedule, open);
  assert.equal(perWeek.schedule.scheduleType, 'times_per_week');
  assert.equal(createRepeatModeFor(perWeek.schedule, perWeek.range), 'perWeek');

  const perMonth = applyCreateRepeatMode('perMonth', perWeek.schedule, perWeek.range);
  assert.equal(perMonth.schedule.scheduleType, 'times_per_month');
  assert.equal(createRepeatModeFor(perMonth.schedule, perMonth.range), 'perMonth');

  const daily = applyCreateRepeatMode('daily', perMonth.schedule, perMonth.range);
  assert.equal(daily.schedule.scheduleType, 'daily');
  assert.equal(createRepeatModeFor(daily.schedule, daily.range), 'daily');
});

test('choosing a repeat never leaves a habit looking like a task', () => {
  const task = applyCreateItemType('task', schedule, open);
  const days = applyCreateRepeatMode('days', task.schedule, task.range);
  assert.equal(createItemTypeFor(days.schedule, days.range), 'habit');
});

test('the period count stays a whole number the domain will take', () => {
  const stepped = stepPeriodTargetCount({ ...schedule, periodTargetCount: '' }, -1);
  assert.equal(createPeriodTargetCount(stepped), 1);
  const raised = stepPeriodTargetCount(stepped, 1);
  assert.equal(createPeriodTargetCount(raised), 2);
});

test('the create row offers the six categories and nothing else', () => {
  assert.equal(CREATE_CATEGORY_OPTIONS, HABIT_CATEGORY_OPTIONS);
  assert.deepEqual(CREATE_CATEGORY_OPTIONS.map((option) => option.key), ['routine', 'meal', 'work', 'body', 'mind', 'home']);
});

test('a category is stored as a canonical accent key, so nothing new is persisted', () => {
  for (const option of HABIT_CATEGORY_OPTIONS) {
    assert.ok(CANONICAL_HABIT_ACCENT_KEYS.includes(option.accentKey as never), `${option.accentKey} is not canonical`);
  }
  // One key each: two categories sharing a key would be indistinguishable on read.
  assert.equal(new Set(HABIT_CATEGORY_OPTIONS.map((option) => option.accentKey)).size, HABIT_CATEGORY_OPTIONS.length);
  assert.equal(new Set(HABIT_CATEGORY_OPTIONS.map((option) => option.color)).size, HABIT_CATEGORY_OPTIONS.length);
});

test('a category round-trips through the key it is stored as', () => {
  for (const option of HABIT_CATEGORY_OPTIONS) {
    assert.equal(habitCategoryAccentKey(option.key), option.accentKey);
    assert.equal(habitCategoryForAccentKey(option.accentKey), option);
    assert.equal(habitCategory(option.key), option);
  }
});

test('a habit saved before categories existed still reads back, with no category', () => {
  // `cyan` and `grey` are canonical keys that name no category. They must not be
  // reinterpreted as one, and they must not throw.
  assert.equal(habitCategoryForAccentKey('cyan'), null);
  assert.equal(habitCategoryForAccentKey('lavender'), null);
  assert.equal(habitCategoryForAccentKey(null), null);
});

test('a category is one hue, and only its lightness follows the theme', () => {
  const work = habitCategory('work');
  const onPlate = habitCategoryTone(work, '#FFFFFF', false);
  const onPlateAgain = habitCategoryTone(work, '#EFF1F4', false);
  // Within one theme the colour is the item's data: only the wash into the ground
  // moves, never the colour itself.
  assert.equal(onPlate.color, work.color);
  assert.equal(onPlateAgain.color, work.color);
  assert.notEqual(onPlate.fill, onPlateAgain.fill);
  // Between the two themes the lightness steps, because a 0.60 colour on a
  // `#14171C` ground is not a readable mark (PD-CATEGORY-006).
  assert.notEqual(habitCategoryTone(work, '#21252C', true).color, work.color);
  assert.match(habitCategoryDensityColor(work, false), /^rgba\(/);
});

test('the default category is one of the six', () => {
  assert.ok(HABIT_CATEGORY_OPTIONS.some((option) => option.key === DEFAULT_HABIT_CATEGORY));
});

test('the symbol row depends on the name alone, so choosing one never reorders it', () => {
  const keys = createQuickSymbolKeys('morning run');
  assert.equal(keys.length, CREATE_QUICK_SYMBOL_COUNT);
  assert.equal(new Set(keys).size, keys.length);
  // The same name gives the same row whatever is currently selected — the row is
  // not a function of the selection, which is what made tiles jump to the left.
  assert.deepEqual(createQuickSymbolKeys('morning run'), keys);
});

test('the repeat row carries two, and every schema type stays reachable behind them', () => {
  assert.deepEqual([...CREATE_PRIMARY_REPEAT_MODES], ['daily', 'days']);
  for (const mode of CREATE_REPEAT_MODES) {
    assert.equal(CREATE_PRIMARY_REPEAT_MODES.includes(mode) === !isExtendedRepeatMode(mode), true);
  }
  const types = CREATE_REPEAT_MODES.map((mode) => applyCreateRepeatMode(mode, schedule, open).schedule.scheduleType);
  assert.deepEqual(types, ['daily', 'selected_weekdays', 'every_n_days', 'times_per_week', 'times_per_month', 'times_per_year', 'monthly', 'yearly']);
});

test('every extended repeat reads back as the mode that wrote it', () => {
  for (const mode of CREATE_REPEAT_MODES) {
    const applied = applyCreateRepeatMode(mode, schedule, open);
    assert.equal(createRepeatModeFor(applied.schedule, applied.range), mode, mode);
  }
});

test('the numbers a repeat asks for stay inside the range the domain accepts', () => {
  const interval = applyCreateRepeatMode('interval', schedule, open).schedule;
  assert.deepEqual(repeatNumberFields('interval').map(({ field }) => field), ['intervalDays']);
  assert.deepEqual(repeatNumberFields('yearly').map(({ field }) => field), ['monthNumber', 'monthDay']);
  assert.equal(repeatNumberFields('daily').length, 0);
  // Two apart is the floor: "every one day" is `Every day`, which is its own mode.
  assert.equal(scheduleNumber(stepScheduleNumber(interval, 'intervalDays', -1), 'intervalDays'), 2);
  assert.equal(scheduleNumber(stepScheduleNumber({ ...schedule, monthNumber: '99' }, 'monthNumber', 1), 'monthNumber'), 12);
});

test('a relative reminder resolves against the planned time', () => {
  assert.equal(reminderTriggerTime({ kind: 'before', minutes: 10 }, '07:00'), '06:50');
  assert.equal(reminderSummary({ kind: 'before', minutes: 10 }, '07:00'), '10 min before · 06:50');
});

test('a reminder that cannot be resolved is refused rather than clamped', () => {
  // No planned time to count back from.
  assert.equal(reminderTriggerTime({ kind: 'before', minutes: 10 }, ''), null);
  // Counting back would land in yesterday, and the command stores no day offset.
  assert.equal(reminderTriggerTime({ kind: 'before', minutes: 30 }, '00:15'), null);
  assert.equal(reminderSummary({ kind: 'before', minutes: 30 }, '00:15'), 'None');
  assert.equal(reminderTriggerTime({ kind: 'none' }, '07:00'), null);
});

test('an absolute reminder is taken as it stands', () => {
  assert.equal(reminderTriggerTime({ kind: 'at', time: '12:00' }, ''), '12:00');
  assert.equal(reminderSummary({ kind: 'at', time: '12:00' }, ''), 'At 12:00');
  assert.equal(reminderTriggerTime({ kind: 'at', time: '25:00' }, ''), null);
});

test('the reminder reaches the command instead of being dropped at the boundary', () => {
  const built = buildCreateHabitCommand({
    activeRange: open,
    description: '',
    importance: 'normal',
    name: 'Morning run',
    plannedTime: '07:00',
    reminderTime: '06:50',
    schedule,
    tracking: createDefaultTrackingDraft(),
  }, 'UTC');
  assert.ok(built.ok);
  assert.deepEqual(built.value.reminder, { timezoneId: null, timezoneMode: 'schedule_timezone', triggerLocalTime: '06:50' });
});

test('no reminder is still no reminder', () => {
  const built = buildCreateHabitCommand({
    activeRange: open,
    description: '',
    importance: 'normal',
    name: 'Morning run',
    plannedTime: '07:00',
    reminderTime: '',
    schedule,
    tracking: createDefaultTrackingDraft(),
  }, 'UTC');
  assert.ok(built.ok);
  assert.equal(built.value.reminder, null);
});

test('a subtask is written as a line, not as a habit of its own', () => {
  // It used to be an ordinary child — a whole habit with its own schedule and its
  // own observations, which is how a checklist became able to reach a statistic
  // and to turn up as a row of the day. Only the item is a habit now.
  assert.doesNotMatch(screen, /completionRole/);
  assert.doesNotMatch(screen, /relationshipMode: index === 0/);
  assert.match(screen, /habits: \[\{ command: built\.value, parentIndex: null, relationshipMode: 'independent' as const \}\]/);
  assert.match(screen, /addHabitChecklistLines\(\{/);
  // The lines begin on the day the item does, so a habit created today puts no
  // unticked checklist on days that are already over.
  assert.match(screen, /localDate: activeRange\.activeFrom,/);
  assert.match(screen, /texts: named\.map\(\(step\) => step\.name\),/);
});

test('a step carries no time of its own', () => {
  assert.doesNotMatch(screen, /plannedTime: step\.plannedTime/);
});

test('duration is offered and never defaulted', () => {
  // **This reverses PD-CREATE-020, and it reverses it by removing its premise.** The
  // seven chips were withheld because no field carried the length of an item — «chips
  // writing nowhere would be a fabrication». Schema v13 stores one, so the chips write
  // to a real column and the refusal has nothing left to protect.
  //
  // What survives is the half that still matters: **nothing is chosen for anybody.** An
  // item nobody measured stores `NULL`, which means «nobody said», and a default here
  // would put a made-up half hour on the day of every person who never opened the row.
  assert.deepEqual([...CREATE_DURATION_CHOICES], [15, 30, 45, 60, 120]);
  assert.match(screen, /useState<number \| null>\(edit\?\.initial\.plannedDurationMinutes \?\? null\)/);
  assert.doesNotMatch(screen, /useState<number>\(30\)|plannedDuration \?\? 30/);
  // And it can be taken back off, so a length chosen by accident is not permanent.
  assert.match(screen, /setPlannedDuration\(null\)/);
});

test('the day is asked for in the order a person answers it', () => {
  // **The part of the day comes before the minute**, and that ordering is the change.
  // Asked for the minute first, a person invents one — after which every day is measured
  // against a precision they never meant. The chips are what they actually say.
  assert.deepEqual([...CREATE_BLOCK_CHOICES], ['morning', 'day', 'evening', 'anytime']);
  assert.equal(CREATE_BLOCK_LABELS.anytime, 'Anytime', 'absence is an answer, not a skipped question');
  assert.equal(createBlockValue('anytime'), null, 'and it is stored as none');
  assert.equal(createBlockValue('evening'), 'evening');
  assert.equal(createBlockChoice(null), 'anytime', 'and it reads back as itself');

  // The three stand in that order inside one plate, which is the order the person meets
  // them in: the part of the day, then how long it takes, and the minute last.
  assert.ok(screen.indexOf('>When<') < screen.indexOf('label="Takes"'), 'when, then how long');
  assert.ok(screen.indexOf('label="Takes"') < screen.indexOf('label="Starts at"'), 'and the minute last');

  // **One door to the drum, and one home for the length.** They used to be two each:
  // `Custom` and `Exact time` opened the same sheet, and the length could be set on the
  // form or inside the drum, on sets that did not match.
  assert.equal(screen.match(/openSheet === 'time'/g)?.length, 1, 'the drum has one caller');
  assert.doesNotMatch(screen, /Custom length|>Custom</, 'the second door is gone');
  assert.doesNotMatch(screen, /CREATE_DURATION_CHOICES/, 'the length is settled in its own sheet');
});

test('the action hangs, and a name is the whole of what it waits for', () => {
  // Owner instruction, 2026-08-06: «кнопка create должна быть висящей и для нее должна
  // быть всегда возможность создать задачу, чтобы не мотать вниз». It used to be the
  // last thing *inside* the scroll, so on a habit carrying growth, steps and a note it
  // stood below the fold — making something meant scrolling past everything you had
  // just decided not to fill in.
  const scrollEnds = screen.indexOf('</ScrollView>');
  const action = screen.indexOf('styles.actionBar');
  assert.ok(scrollEnds >= 0 && action > scrollEnds, 'the action bar is outside the scroll');
  // Nothing else gates it, and nothing else ever did: a name is the requirement, and
  // what was missing was the ability to reach the button.
  assert.match(screen, /const canCreate = !saving && name\.trim\(\) !== '' && !pastMoment/);
  // It is structure, not `completion`: green means done and there is nothing to
  // complete on this screen (PD-PLATE-004).
  assert.match(screen, /backgroundColor: !canCreate[\s\S]{0,120}theme\.today\.structFill/);
  assert.doesNotMatch(screen, /theme\.today\.completion/, 'no green survives on Create');
});

test('the drum answers one question, and no longer writes a length nobody stated', () => {
  const drum = readFileSync('src/features/planner/presentation/time-drum-sheet.tsx', 'utf8');
  // The defect: `recut` set `durationStated` on any chip press, so re-cutting the day
  // **to find a start** committed a duration — which the sheet's own comment two
  // screens above says must never happen. The length lives in one place now, and the
  // drum's second return value has no caller.
  assert.match(screen, /onDone=\{\(value\) => \{/, 'the drum hands back a minute and nothing else');
  assert.doesNotMatch(screen, /setPlannedDuration\(durationMinutes\)/);
  // And the two sets that disagreed are one: the form no longer carries a chip row at
  // all, so 45 and 120 cannot be unreachable from one side and 5 and 10 from the other.
  assert.ok(drum.length > 0);
  assert.doesNotMatch(screen, /CREATE_DURATION_CHOICES/);
});

test('the repeat row says the rule, not the mode’s name', () => {
  // «Chosen days» tells a person nothing they did not know from having chosen them, so
  // the row carries the days themselves — and seven of seven is `Every day`, because
  // that is what it is however it was arrived at.
  const days = (...chosen: number[]) => ({ ...schedule, selectedWeekdays: chosen });
  assert.equal(createRepeatSummary('days', days(1, 3, 5)), 'Mon · Wed · Fri');
  assert.equal(createRepeatSummary('days', days(1, 2, 3, 4, 5, 6, 7)), 'Every day');
  assert.equal(createRepeatSummary('days', days()), 'No days yet');
  // Order is the week's, not the order they were tapped in.
  assert.equal(createRepeatSummary('days', days(5, 1, 3)), 'Mon · Wed · Fri');
  // A rule that carries a number carries it here too.
  assert.equal(createRepeatSummary('interval', { ...schedule, intervalDays: '3' }), 'Every 3 days');
  assert.equal(createRepeatSummary('perWeek', { ...schedule, periodTargetCount: '4' }), '4 a week');
  assert.equal(createRepeatSummary('daily', schedule), 'Every day');
  // Out-of-range weekdays are dropped rather than printed as an empty gap.
  assert.equal(createRepeatSummary('days', days(0, 1, 9, 3)), 'Mon · Wed');
});

test('a minute suggests a part of the day and never overrules one', () => {
  assert.equal(createBlockSuggestion('07:20'), 'morning');
  assert.equal(createBlockSuggestion('13:00'), 'day');
  assert.equal(createBlockSuggestion('21:30'), 'evening');
  assert.equal(createBlockSuggestion(''), null, 'no minute suggests nothing');
  // Consulted **only** where nothing was chosen: somebody who picked «Вечер» has made a
  // choice the clock is not allowed to take back.
  assert.match(screen, /if \(blockChoice === 'anytime'\) \{/);
});

test('growing is a switch somebody throws, and only on a habit', () => {
  // Inferred from priority or frequency it would be a decision nobody made, and there
  // would be nothing to accompany — the meaning of the second floor is that the person
  // said «this one matters to me now».
  assert.equal(createGrowthAvailable('habit'), true);
  assert.equal(createGrowthAvailable('task'), false, 'a task is one day’s work and has no rhythm');

  // The cap is stated as a count rather than as a refusal: «2 / 3» invites a choice.
  assert.equal(createGrowthSlotsLabel({ max: 3, used: 2 }), '2 / 3');
  assert.equal(createGrowthHasRoom({ alreadyGrowing: false, max: 3, used: 2 }), true);
  assert.equal(createGrowthHasRoom({ alreadyGrowing: false, max: 3, used: 3 }), false);
  // An item already being grown can always be switched off, whatever the count says —
  // otherwise the last three routines could never be released.
  assert.equal(createGrowthHasRoom({ alreadyGrowing: true, max: 3, used: 3 }), true);
});

test('leaving the sheet is still the discard', () => {
  assert.doesNotMatch(screen, /beforeRemove|Discard/);
});

// ── design_handoff_manage_subtasks §B: the create screen ─────────────────────

test('the plus opens create directly, and the type is chosen by a segment', () => {
  const journal = readFileSync('src/features/planner/presentation/day-journal-screen.tsx', 'utf8');
  // The scrim and the two right-aligned pills are gone. No `type` param is passed
  // either: the segment inside is the chooser, and it stays steerable throughout
  // rather than deciding before a word is typed.
  assert.match(journal, /const openCreate = \(\) => \{\s*\n\s*router\.push\(\{ params: \{ date: selected \}, pathname: '\/planner\/create' \}\);/);
  assert.doesNotMatch(journal, /AddPill|addMenu|setAddOpen|addOpen/);
  assert.doesNotMatch(journal, /openCreate\('task'\)|openCreate\('habit'\)/);
  // Two full-width slots at the top of the screen, each carrying its own node — and
  // **the selection now travels between them** on the one motion model the application
  // has, rather than switching (owner instruction, 2026-08-06).
  assert.match(screen, /<TravellingSegment[\s\S]*?slots=\{TYPE_SLOTS\}/);
  assert.match(screen, /const TYPE_SLOTS: readonly TravellingSegmentSlot\[\]/);
  // **The node is the mark, not the older dot.** The shape language moved on: a circle
  // is a task and a rounded square is a habit (`item-chip.tsx`), and the chooser teaches
  // the shape a person then meets on the plate.
  assert.match(screen, /kind === 'habit' \? Math\.round\(TYPE_NODE \* 0\.29\) : TYPE_NODE \/ 2/);
  assert.doesNotMatch(screen, /typeDot|typeSlotSelected/, 'the filled dot and the opaque slot are gone');
  // Switching still exchanges exactly one block and keeps every other field.
  assert.match(screen, /applyCreateItemType/);
});

test('the name is a placeholder by type, and never a value', () => {
  assert.match(screen, /placeholder=\{CREATE_NAME_PLACEHOLDERS\[itemType\]\}/);
  assert.doesNotMatch(screen, /value=\{CREATE_NAME_PLACEHOLDERS/);
  assert.equal(CREATE_NAME_PLACEHOLDERS.task, 'Create a new task');
  assert.equal(CREATE_NAME_PLACEHOLDERS.habit, 'Create a new habit');
  // **The name row leads with the mark the day will draw**, not with a stand-in for it.
  // `ItemNode` with no identity returns the bare 11 pt dot, so a chosen symbol appeared
  // nowhere on this screen and choosing a colour repainted a dot — which is exactly what
  // the owner reported. `CategoryChip` is the component Today and Manage already use, at
  // the plate's own `PLATE_MARK`, so the two surfaces cannot draw one item differently.
  assert.match(screen, /<CategoryChip accentKey=\{accentKey\} categoryKey=\{category\} identity=\{identity\} kind=\{itemType\} size=\{PLATE_MARK\} \/>/);
  assert.doesNotMatch(screen, /<ItemNode/, 'the bare node has no caller here any more');
  // `plateType.itemStrong` — the size and weight the plate draws a title at, so the row
  // previews the item rather than resembling it. No 700 anywhere (PD-PLATE-003).
  assert.match(screen, /nameField: \{ flex: 1, fontSize: 17, fontWeight: '600', letterSpacing: -0\.2/);
  assert.doesNotMatch(screen, /fontWeight: '700'/, 'the plate language allows no 700');
  // The draft caption is gone with the mark that it explained.
  assert.doesNotMatch(screen, /tap the mark to change the icon/);
});

test('the accessory slab leaves, and Done moves into the top bar', () => {
  // `InputAccessoryView` is rectangular and full width and cannot be made to match
  // a keyboard rounded at the top, so the bar goes and its job is split.
  // Anchored to code rather than to the word: the comment above the top bar says
  // why `InputAccessoryView` cannot match a rounded keyboard, and should.
  assert.doesNotMatch(screen, /<InputAccessoryView|<KeyboardAccessoryBar|inputAccessoryViewID=/);
  assert.doesNotMatch(screen, /^import \{[^}]*KeyboardAccessoryBar/m);
  // The top bar is outside the scroll view, which is what makes Done reachable at
  // any position; the slot carries the journal's date until a field is focused.
  assert.match(screen, /\{typing[\s\S]{0,200}accessibilityLabel="Done"/);
  assert.match(screen, /topBarTrailing: \{ alignItems: 'flex-end', justifyContent: 'center', minHeight: 44, minWidth: 76 \}/);
  assert.match(screen, /topBarDoneText: \{ fontSize: 15, fontWeight: '600' \}/);
  // **Both bars are glass**, the same `BlurView` over `materialFill` that Today's header
  // and its FAB take — Create carried no material at all.
  assert.equal(screen.match(/<BlurView/g)?.length, 2, 'a top bar and an action bar, both glass');
  assert.match(screen, /intensity=\{theme\.today\.materialBlur\}/);
  // And the screen finally says which one it is: creating and editing used to differ
  // only by a word on a button at the very bottom of a scroll.
  assert.match(screen, /edit === undefined \? 'New item' : 'Edit'/);
  // **One return key for the whole app**: the system's own submit key, which is
  // the blue check. `next` drew a grey chevron and meant something different on
  // every field it appeared on.
  assert.match(screen, /returnKeyType="done"/);
  assert.doesNotMatch(screen, /returnKeyType="next"/);
  // **And a step line no longer holds focus after committing**, which overrides the
  // step clause of PD-CREATE-026 on the owner's instruction. Holding it queued a
  // second line at once, and the sheet had already risen exactly one keyboard — so
  // that second field was the one thing on the page the keyboard covered. Committing
  // dismisses now, and an empty line dismisses without writing anything, because
  // `addPendingStep` returns on a blank name.
  assert.doesNotMatch(screen, /blurOnSubmit=\{false\}/);
  assert.match(screen, /blurOnSubmit\s+onBlur=\{\(\) => setTyping\(false\)\}/);
  assert.match(screen, /const stepName = pendingStep\.trim\(\);\s+if \(stepName === ''\) return;/);
  // The sheet rises exactly one keyboard: the inset, and no scroll-to-focused
  // input on top of it. The two offsets stacking is what threw the page up past
  // the line being typed.
  assert.match(screen, /automaticallyAdjustKeyboardInsets/);
});

test('the symbol is choosable again, and the picker was unreachable rather than gone', () => {
  const screen = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
  // **PD-CREATE-024 recorded that Edit kept the block, and that stopped being true**
  // the moment Edit *became* this surface (PD-EDIT-005) and the old form was deleted
  // (PD-TEMPLATE-002). The catalogue, the sheet and the storage were all intact and
  // nothing on any live screen could reach them, so every item wore the automatic
  // symbol whether or not it suited. One surface serves both, so restoring it here
  // restores it for create and for edit at once.
  assert.match(screen, /createQuickSymbolKeys/);
  assert.match(screen, /<HabitIdentitySheet/);
  // Symbols only: an item's colour is a category on this surface (PD-IDENTITY-003),
  // so the sixteen swatches stay out of the sheet even though it can draw them.
  assert.match(screen, /colours=\{false\}/);
  // Automatic until something is actually chosen, so an item nobody bothered with
  // still has a mark rather than a hole.
  assert.match(screen, /iconSelection: symbolKey === null \? \('automatic' as const\) : \('explicit' as const\)/);
  assert.match(screen, /iconSymbolKey: symbolKey/);
  // The row depends on the name alone, so a tap never reorders it under the finger
  // (PD-IDENTITY-007), and tapping the chosen tile returns the item to automatic.
  assert.match(screen, /createQuickSymbolKeys\(name\), \[name\]/);
  assert.match(screen, /setSymbolKey\(selected \? null : key\)/);
  // And the editor carries the stored symbol both ways.
  const editor = readFileSync('src/features/planner/presentation/edit-habit-screen.tsx', 'utf8');
  assert.match(editor, /symbolKey: storedSymbolKey\(detail\.habit\.visualIdentity\.iconIdentity\)/);
  assert.doesNotMatch(editor, /symbolKey: null,/);
  // An exact emoji is never reduced to a symbol key: it is the person's own
  // character (PD-IDENTITY-002), so there is simply nothing to pre-select.
  assert.match(editor, /candidate\?\.kind === 'symbol' && typeof candidate\.symbolKey === 'string'/);
});

test('the colour row carries no words', () => {
  // A person recognises the colour by the colour; "category" reads as a taxonomy
  // when it is a label, and naming the chosen one said nothing visible.
  assert.doesNotMatch(screen, />CATEGORY</);
  assert.doesNotMatch(screen, /habitCategory\(category\)\.label/);
  // Storage is untouched: the six are still canonical accent keys.
  assert.equal(CREATE_CATEGORY_OPTIONS.length, 6);
  assert.match(screen, /habitCategoryAccentKey\(category\)/);
});
