import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parsePlannerLocalDate, parsePlannerTimezone, type PlannerLocalDate } from '../../../src/features/planner/domain';
import {
  applyCreateScheduleMode,
  createScheduleModeFor,
  CREATE_EXTRA_SCHEDULE_MODES,
  CREATE_PRIMARY_SCHEDULE_MODES,
  CREATE_SCHEDULE_MODES,
  isOnceRange,
  plannerScheduleNextDates,
} from '../../../src/features/planner/presentation/create-habit-schedule-model';
import { moveStep, namedRoutineSteps, withPendingStep, type RoutineStepDraft } from '../../../src/features/planner/presentation/routine-step-drafts';
import { suggestedHabitSymbols } from '../../../src/features/planner/presentation/habit-identity-picker-model';
import {
  priorityTrackBands,
  priorityTrackWeights,
  prioritySliderLevel,
  prioritySliderRatio,
  prioritySliderStopIndex,
} from '../../../src/features/planner/presentation/priority-slider-model';
import { IMPORTANCE_STOPS } from '../../../src/features/planner/presentation/planner-form-control-model';
import { buildScheduleDefinition, createDefaultScheduleDraft, plannerRoutineDisplayProgress, plannerRowIsCanonicallyDone } from '../../../src/features/planner/presentation/ui-adapters';

const source = (path: string) => readFileSync(path, 'utf8');
const create = source('src/features/planner/presentation/create-item-screen.tsx');
const sheets = source('src/features/planner/presentation/create-habit-sheets.tsx');
const slider = source('src/features/planner/presentation/priority-slider.tsx');
const row = source('src/features/planner/presentation/habit-occurrence-row.tsx');
const planner = source('src/features/planner/presentation/planner-screen.tsx');

const START = '2026-07-26';
const TIMEZONE = 'Europe/London';

function date(value: string): PlannerLocalDate {
  const parsed = parsePlannerLocalDate(value);
  if (!parsed.ok) throw new Error(`Invalid date: ${value}`);
  return parsed.value;
}

function nextDates(draft: ReturnType<typeof createDefaultScheduleDraft>, range: Readonly<{ activeFrom: string; activeTo: string }>, limit = 3): readonly string[] {
  const built = buildScheduleDefinition(draft, range, TIMEZONE);
  if (!built.ok) throw new Error(`Schedule did not build: ${built.errors.map(({ message }) => message).join(', ')}`);
  const zone = parsePlannerTimezone(TIMEZONE, 'evaluationTimezone');
  if (!zone.ok) throw new Error('Timezone did not parse.');
  const to = range.activeTo === '' ? null : date(range.activeTo);
  return plannerScheduleNextDates(built.value, { effectiveFrom: date(range.activeFrom), effectiveTo: to }, zone.value, date(range.activeFrom), limit);
}

// ── Create Habit - Final · six modes over nine schema types ──────────────────

test('six modes cover the nine schedule types and survive a round trip', () => {
  assert.deepEqual([...CREATE_SCHEDULE_MODES], ['daily', 'days', 'interval', 'times', 'date', 'once']);
  const range = { activeFrom: START, activeTo: '' };
  const base = createDefaultScheduleDraft(date(START));
  for (const mode of CREATE_SCHEDULE_MODES) {
    const applied = applyCreateScheduleMode(mode, base, range);
    assert.equal(createScheduleModeFor(applied.schedule, applied.range), mode, mode);
  }
  // Every type the schema has is reachable, and nothing invents a tenth.
  assert.equal(applyCreateScheduleMode('daily', base, range).schedule.scheduleType, 'daily');
  assert.equal(applyCreateScheduleMode('days', base, range).schedule.scheduleType, 'selected_weekdays');
  assert.equal(applyCreateScheduleMode('interval', base, range).schedule.scheduleType, 'every_n_days');
  assert.equal(applyCreateScheduleMode('times', base, range).schedule.scheduleType, 'times_per_week');
  assert.equal(applyCreateScheduleMode('date', base, range).schedule.scheduleType, 'monthly');
  // A legacy `weekly` habit reads back as Days rather than as an unknown mode.
  assert.equal(createScheduleModeFor({ ...base, scheduleType: 'weekly' }, range), 'days');
  // A period already chosen is kept when the mode is re-entered.
  const yearly = applyCreateScheduleMode('date', { ...base, scheduleType: 'yearly' }, range);
  assert.equal(yearly.schedule.scheduleType, 'yearly');
});

test('Once is an ordinary daily schedule that stops the next day, not a tenth type', () => {
  const base = createDefaultScheduleDraft(date(START));
  const once = applyCreateScheduleMode('once', base, { activeFrom: START, activeTo: '' });
  assert.equal(once.schedule.scheduleType, 'daily');
  assert.equal(once.range.activeTo, '2026-07-27');
  assert.equal(isOnceRange(once.range), true);
  assert.equal(createScheduleModeFor(once.schedule, once.range), 'once');
  // Reading it back as Daily must clear the end date, or Once would be sticky.
  const daily = applyCreateScheduleMode('daily', once.schedule, once.range);
  assert.equal(daily.range.activeTo, '');
  assert.equal(createScheduleModeFor(daily.schedule, daily.range), 'daily');
  // A one-off lands on exactly one day.
  assert.deepEqual([...nextDates(once.schedule, once.range)], ['2026-07-26']);
});

test('the confirmation dates come from the domain, never from a rule restated in the UI', () => {
  const base = createDefaultScheduleDraft(date(START));
  const open = { activeFrom: START, activeTo: '' };
  // 26 July 2026 is a Sunday.
  assert.deepEqual([...nextDates(base, open)], ['2026-07-26', '2026-07-27', '2026-07-28']);
  const weekdays = applyCreateScheduleMode('days', { ...base, selectedWeekdays: [1, 3, 5] }, open);
  assert.deepEqual([...nextDates(weekdays.schedule, weekdays.range)], ['2026-07-27', '2026-07-29', '2026-07-31']);
  const interval = applyCreateScheduleMode('interval', { ...base, anchorDate: START, intervalDays: '3' }, open);
  assert.deepEqual([...nextDates(interval.schedule, interval.range)], ['2026-07-26', '2026-07-29', '2026-08-01']);
  const monthly = applyCreateScheduleMode('date', { ...base, monthDay: '30' }, open);
  assert.deepEqual([...nextDates(monthly.schedule, monthly.range)], ['2026-07-30', '2026-08-30', '2026-09-30']);
  // A flexible period has no dates to name, so it returns none rather than
  // inventing three days the schema never promised.
  const times = applyCreateScheduleMode('times', { ...base, periodTargetCount: '3' }, open);
  assert.deepEqual([...nextDates(times.schedule, times.range)], []);
});

// ── The priority slider ──────────────────────────────────────────────────────

test('the slider snaps to the nearest of four stops and reads back symmetrically', () => {
  assert.equal(prioritySliderStopIndex(0), 0);
  assert.equal(prioritySliderStopIndex(0.16), 0);
  assert.equal(prioritySliderStopIndex(0.17), 1);
  assert.equal(prioritySliderStopIndex(0.5), 2);
  assert.equal(prioritySliderStopIndex(1), 3);
  // Out of range and nonsense both land on a real stop rather than undefined.
  assert.equal(prioritySliderStopIndex(-4), 0);
  assert.equal(prioritySliderStopIndex(9), 3);
  assert.equal(prioritySliderStopIndex(Number.NaN), 0);
  for (const level of ['low', 'normal', 'high', 'critical'] as const) {
    assert.equal(prioritySliderLevel(prioritySliderRatio(level)), level);
  }
  assert.equal(prioritySliderRatio('low'), 0);
  assert.equal(prioritySliderRatio('critical'), 1);
});

test('the track is one band per stop, painted in what the plate will draw', () => {
  // **The 24-band gradient is deleted with `mixHexColors`.** It walked from the low ink
  // to the alarm and so drew a continuous severity scale — and the plate has no such
  // scale: low and normal put no spine on it at all (PD-PLATE-017). One band per stop,
  // and the two quiet ones share a colour because they share an outcome.
  const bands = priorityTrackBands('#DEE0E2', '#A77F17', '#AA3832');
  assert.deepEqual([...bands], ['#DEE0E2', '#DEE0E2', '#A77F17', '#AA3832']);
  assert.equal(bands.length, IMPORTANCE_STOPS.length, 'a band per stop, so a fifth level cannot go unpainted');

  // **A band is the region that snaps to its stop, not an equal quarter.** Rounding in
  // `prioritySliderStopIndex` gives the end stops half a region and the inner ones a
  // whole one, so equal quarters would put the thumb over amber while releasing to
  // `normal`. Asserted against the snapper itself rather than against `1:2:2:1`.
  const weights = priorityTrackWeights();
  assert.equal(weights.length, IMPORTANCE_STOPS.length);
  assert.ok(Math.abs(weights.reduce((sum, part) => sum + part, 0) - 1) < 1e-9, 'the bands fill the track');
  let edge = 0;
  for (const [index, weight] of weights.entries()) {
    // The middle of each band lands on a position that snaps back to that same stop.
    const middle = edge + weight / 2;
    assert.equal(prioritySliderLevel(middle), IMPORTANCE_STOPS[index], `band ${index} shows a stop it does not give`);
    edge += weight;
  }

  const packageJson = JSON.parse(source('package.json')) as { dependencies: Record<string, string> };
  assert.equal('expo-linear-gradient' in packageJson.dependencies, false);
  assert.equal('@react-native-community/slider' in packageJson.dependencies, false);
  // Built from PanResponder, and reachable without one: VoiceOver adjusts it.
  assert.match(slider, /PanResponder\.create/);
  assert.match(slider, /accessibilityRole="adjustable"/);
  assert.match(slider, /actionName === 'increment'/);
  assert.match(slider, /Haptics\.selectionAsync/);
});

// ── Identity ─────────────────────────────────────────────────────────────────

test('the identity sheet leads with symbols that match what the habit is called', () => {
  // Every word in the name counts, so "Morning run" offers both readings rather
  // than guessing which of the two the person meant.
  const morningRun = suggestedHabitSymbols('Morning run').map(({ key }) => key);
  assert.equal(morningRun.includes('running'), true, morningRun.join(','));
  assert.equal(morningRun.includes('morning'), true, morningRun.join(','));
  assert.equal(suggestedHabitSymbols('Drink water')[0]?.key, 'water');
  assert.equal(suggestedHabitSymbols('Read a book').some(({ key }) => key === 'reading'), true);
  // Two-letter noise must not rank anything: no match is better than a wrong one.
  assert.deepEqual([...suggestedHabitSymbols('a b c')], []);
  assert.deepEqual([...suggestedHabitSymbols('')], []);
  assert.ok(suggestedHabitSymbols('Morning run').length <= 4);
});

test('the identity sheet offers the canonical sixteen, not the legacy twenty-one', () => {
  // The frame draws 21 swatches; five of those are v5/v6 legacy keys, which
  // PD-IDENTITY-004 reserves for habits that already carry them.
  assert.match(sheets, /HABIT_ACCENT_OPTIONS\.map/);
  assert.doesNotMatch(sheets, /HABIT_ACCENT_KEYS|LEGACY_HABIT_ACCENT_KEYS/);
  // New emoji entry is gone from Create; stored emoji still renders elsewhere.
  assert.doesNotMatch(sheets, /Emoji|iconEmoji/);
  // One sheet, not four pushes: colour and symbol are chosen in the same place.
  assert.match(sheets, /export function HabitIdentitySheet/);
  assert.match(sheets, /suggestedHabitSymbols/);
  assert.doesNotMatch(create, /iconEmoji/);
});

// ── The sheets and the bottom layer ──────────────────────────────────────────

test('every second-level decision is a sheet that writes nothing until Done', () => {
  assert.match(sheets, /borderTopLeftRadius: 30, borderTopRightRadius: 30/);
  // The grab zone is the whole 44 pt header band, not the handle inside it.
  assert.match(sheets, /sheetHandleRow: \{ alignItems: 'center', height: 44, justifyContent: 'center' \}/);
  assert.match(sheets, /sheetHandle: \{ borderRadius: 3, height: 5, width: 44 \}/);
  assert.match(sheets, /PanResponder\.create/);
  assert.match(sheets, /gesture\.dy > 56 \|\| gesture\.vy > 0\.7/);
  assert.match(sheets, /onCancel/);
  // Cancel restores what the sheet opened with: the drafts live in the caller.
  assert.match(sheets, /if \(visible && !opened\.current\)/);
  // The screen that opened all four is gone; `create-item-sheet.cases.ts` covers
  // which of them the create sheet still opens. What is asserted here is the
  // shell's own contract, which every caller of it inherits.
  // Opening the time sheet means wanting a time: the wheels are live and 07:00 is
  // already chosen, with All day an ordinary switch that starts off.
  assert.match(sheets, /DEFAULT_PLANNED_TIME = '07:00'/);
  assert.match(sheets, /value\.trim\(\) === '' \? DEFAULT_PLANNED_TIME : value/);
  assert.match(sheets, /onDone\(anyTime \? '' : draft\)/);
  // Fixed square symbol cells: percentages put the glyph off-centre.
  assert.match(sheets, /SYMBOL_TILE = 74/);
  assert.doesNotMatch(sheets, /flexBasis: '22%'/);
  // The ground still reaches the bottom edge; the action is block 13 inside the
  // sheet now rather than a control floating on a layer of its own.
  assert.match(create, /backgroundColor: theme\.today\.appSurface/);
  assert.doesNotMatch(create, /theme\.colors\.background/);
});

test('step order is a canonical fact, and moving one keeps every other in place', () => {
  const steps: readonly RoutineStepDraft[] = [
    { draftId: 'a', name: 'Warm up', plannedTime: '07:00' },
    { draftId: 'b', name: 'Run', plannedTime: '07:10' },
    { draftId: 'c', name: 'Stretch', plannedTime: '' },
  ];
  assert.deepEqual(moveStep(steps, 2, -1).map(({ draftId }) => draftId), ['a', 'c', 'b']);
  assert.deepEqual(moveStep(steps, 0, 1).map(({ draftId }) => draftId), ['b', 'a', 'c']);
  // Off either end is a no-op returning the same list, not a truncated one.
  assert.equal(moveStep(steps, 0, -1), steps);
  assert.equal(moveStep(steps, 2, 1), steps);
  assert.equal(moveStep(steps, -1, 1), steps);
  // An unnamed row is the empty line at the end of the list, never a saved step.
  assert.deepEqual(namedRoutineSteps([...steps, { draftId: 'd', name: '  ', plannedTime: '' }]).map(({ draftId }) => draftId), ['a', 'b', 'c']);
  // Pointer drag is drawn but not built; these keep reordering reachable.
  assert.match(sheets, /accessibilityActions=\{STEP_ACTIONS\}/);
  assert.match(sheets, /name: 'moveUp'/);
});

// ── Create Habit - Fixes · the seven defects on тест9 ────────────────────────

test('the segment carries three legible modes and the rare three move to the sheet', () => {
  // Six segments gave 55 pt cells with "Inte…" clipped. Three fit whole, and every
  // one of the six is still reachable, so no schema type became unreachable.
  assert.deepEqual([...CREATE_PRIMARY_SCHEDULE_MODES], ['daily', 'days', 'interval']);
  assert.deepEqual([...CREATE_EXTRA_SCHEDULE_MODES], ['times', 'date', 'once']);
  assert.deepEqual(
    [...CREATE_PRIMARY_SCHEDULE_MODES, ...CREATE_EXTRA_SCHEDULE_MODES].sort(),
    [...CREATE_SCHEDULE_MODES].sort(),
  );
  assert.equal(CREATE_PRIMARY_SCHEDULE_MODES.some((mode) => CREATE_EXTRA_SCHEDULE_MODES.includes(mode)), false);
  // Only the sheet still draws these; the create surface splits its own two
  // primary repeats from the extended list behind the key.
  assert.match(sheets, /CREATE_EXTRA_SCHEDULE_MODES\.map/);
});

test('a routine closed by its last step is done, whoever closed it', () => {
  const derived = (steps: Readonly<{ container: boolean; complete: boolean }>) => ({
    routineContainer: {
      completionSource: 'ordinary_children_derived' as const,
      isCanonicallyComplete: steps.complete,
      isRoutineContainer: steps.container,
    },
    state: 'expected_incomplete' as const,
  });
  // The defect: every step done, the parent still reading incomplete because the
  // container has no observation of its own to qualify.
  assert.equal(plannerRowIsCanonicallyDone(derived({ complete: true, container: true })), true);
  assert.equal(plannerRowIsCanonicallyDone(derived({ complete: false, container: true })), false);
  // Not a container: its own state is the only truth, exactly as before.
  assert.equal(plannerRowIsCanonicallyDone(derived({ complete: true, container: false })), false);
  assert.equal(plannerRowIsCanonicallyDone({ routineContainer: undefined, state: 'qualified' }), true);
  assert.equal(plannerRowIsCanonicallyDone({ routineContainer: undefined, state: 'expected_incomplete' }), false);
  // A habit with an independent action still answers from its own observation.
  assert.equal(plannerRowIsCanonicallyDone({
    routineContainer: { completionSource: 'independent_observation', isCanonicallyComplete: false, isRoutineContainer: false },
    state: 'qualified',
  }), true);
  // Both the row and the day counter read the one rule.
  assert.match(row, /plannerRowIsCanonicallyDone\(row\)/);
  assert.match(planner, /roots\.filter\(plannerRowIsCanonicallyDone\)/);
  // And the parent draws the mark rather than a chevron once it is closed.
  assert.match(row, /backgroundColor: theme\.today\.completion, borderColor: theme\.today\.completion, borderRadius: 15/);
});

test('the priority slider updates once per frame instead of once per touch event', () => {
  assert.match(slider, /requestAnimationFrame\(\(\) => \{/);
  assert.match(slider, /cancelAnimationFrame/);
  assert.match(slider, /if \(next === valueRef\.current\) return;/);
  // The schedule build is memoised: unmemoised it re-walked up to 400 days for the
  // confirmation line on every frame of a drag, which is what made it judder.
  assert.match(create, /const scheduleResult = useMemo\(/);
  assert.match(create, /\[activeRange, schedule, timezone\]/);
  // **The `card` variant, the `preview` row and `PRIORITY_CONSEQUENCE` are deleted.**
  // The only caller has passed `inline` since Edit became this same screen, so the card
  // branch was unreachable — and the caption it carried described "Three ticks and a
  // full-height edge" for a plate that has drawn no ticks since PD-PLATE-016. A string
  // nothing renders about a thing nothing draws.
  // Anchored to code rather than to prose: the words `variant` and `preview` survive in
  // the comment that records why they went, and an assertion that cannot tell a
  // deletion from its own explanation proves nothing.
  assert.match(create, /<PrioritySlider\b/);
  assert.doesNotMatch(create, /variant="inline"/);
  assert.doesNotMatch(slider, /readonly variant\?|readonly preview\?|PRIORITY_CONSEQUENCE\[/);
  assert.doesNotMatch(slider, /PRIORITY · TODAY ROW|ticks and a full-height edge/);
  // The track is the colours the plate takes, and the label is a label not a shout.
  assert.match(slider, /priorityTrackBands\(theme\.today\.rail, theme\.today\.rankHigh, theme\.today\.attention\)/);
});

// ── тест10 · three defects that survived the first correction ────────────────

test('a step typed but not submitted is still a step when Done is pressed', () => {
  const typed: readonly RoutineStepDraft[] = [{ draftId: 'a', name: 'Warm up', plannedTime: '07:00' }];
  // The whole defect: one step typed and Done pressed straight away created nothing,
  // because Done handed over a list captured before the commit had landed.
  assert.deepEqual(withPendingStep([], 'Run').map(({ name }) => name), ['Run']);
  assert.deepEqual(withPendingStep(typed, 'Stretch').map(({ name }) => name), ['Warm up', 'Stretch']);
  // Whitespace is not a step, and an empty field returns the same list untouched.
  assert.equal(withPendingStep(typed, ''), typed);
  assert.equal(withPendingStep(typed, '   '), typed);
  assert.deepEqual(namedRoutineSteps(withPendingStep([], 'Run')).map(({ name }) => name), ['Run']);
  // Done reads the pending field rather than the committed state.
  assert.match(sheets, /onDone\(\{ derivedCompletion: derived, steps: namedRoutineSteps\(withPending\(draft\)\) \}\)/);
});

test('the slider reads one coordinate space, not whichever band is under the finger', () => {
  // `locationX` is measured against the touched view, and the track is 24 bands, so
  // during a drag it flipped between their coordinate spaces and the value flew.
  assert.doesNotMatch(slider, /nativeEvent\.locationX/);
  assert.match(slider, /onPanResponderGrant: \(_event, gesture\) => \{[\s\S]*?follow\(gesture\.x0\);/);
  assert.match(slider, /onPanResponderMove: \(_event, gesture\) => follow\(gesture\.moveX\)/);
  assert.match(slider, /measureInWindow/);
  assert.match(slider, /pageX - originRef\.current - THUMB \/ 2/);
  // And the visuals never take the touch, so the responder view stays the target.
  assert.match(slider, /<View pointerEvents="none" style=\{\[styles\.track/);
});

test('the time sheet opens live, and draws no band of its own over the spinner', () => {
  // The switch used to mirror the habit's current value, so a habit with no time
  // opened with the wheels disabled behind a switch that was already on.
  assert.match(sheets, /const \[anyTime, setAnyTime\] = useState\(false\)/);
  assert.match(sheets, /setAnyTime\(false\);/);
  assert.doesNotMatch(sheets, /setAnyTime\(value\.trim\(\) === ''\)/);
  // The native picker draws its own selection highlight; a hand-placed band sat at
  // a fixed offset the real control never matched.
  assert.doesNotMatch(sheets, /wheelBand/);
  // The sheet's percentage height needs a parent with a real one, or its content
  // has nothing to lay out against.
  assert.match(sheets, /sheetScroll: \{ flexGrow: 0, flexShrink: 1 \}/);
  assert.doesNotMatch(sheets, /sheetKeyboardHost|sheetDismissArea/);
  // The sheet stays on the bottom edge and pads for the keyboard: lifting it left
  // its surface ending in mid-air with the ground showing at the keyboard corners.
  assert.doesNotMatch(sheets, /<KeyboardAvoidingView/);
  assert.match(sheets, /function useKeyboardInset/);
  assert.match(sheets, /paddingBottom: Math\.max\(insets\.bottom, keyboard\)/);
});

test('a routine bar fills because it counts its steps, not a parent that cannot qualify', () => {
  const routine = (displayProgress: number | null, groupProgress: number | null) => ({
    progress: { displayProgress: groupProgress },
    routineContainer: {
      completionSource: 'ordinary_children_derived' as const,
      displayProgress,
      isRoutineContainer: true,
    },
  });
  // The defect: one step of one done, the group's own figure still short because it
  // counts the container itself, which holds no observation and never qualifies.
  assert.equal(plannerRoutineDisplayProgress(routine(1, 0.5)), 1);
  assert.equal(plannerRoutineDisplayProgress(routine(0.5, 0.33)), 0.5);
  // Not a derived container: the group's figure is the only one there is.
  assert.equal(plannerRoutineDisplayProgress({
    progress: { displayProgress: 0.4 },
    routineContainer: { completionSource: 'independent_observation', displayProgress: null, isRoutineContainer: false },
  }), 0.4);
  assert.equal(plannerRoutineDisplayProgress({ progress: { displayProgress: 0.25 } }), 0.25);
  assert.equal(plannerRoutineDisplayProgress({ progress: { displayProgress: null } }), null);
});

test('the thumb follows the finger, carries a little, and is magnetised to a stop', () => {
  // It used to be drawn at whichever of four positions the value implied, so it
  // could only click from one stop to the next.
  assert.match(slider, /const position = useRef\(new Animated\.Value\(0\)\)\.current/);
  assert.match(slider, /position\.setValue\(offset\)/);
  assert.match(slider, /transform: \[\{ translateX: position \}\]/);
  assert.match(slider, /<Animated\.View/);
  // A flick carries past the finger, and the stop that carry reaches is chosen.
  assert.match(slider, /RELEASE_INERTIA = 55/);
  assert.match(slider, /offsetRef\.current \+ velocityX \* RELEASE_INERTIA/);
  assert.match(slider, /Animated\.spring\(position, \{/);
  assert.match(slider, /velocity: velocityX \* 1000/);
  assert.match(slider, /useNativeDriver: true/);
  // Reduce Motion keeps the magnet and drops the spring.
  assert.match(slider, /if \(reduceMotionRef\.current\) \{\s*\n\s*position\.setValue\(target\);/);
  assert.match(slider, /useReduceMotion/);
  // The value still only changes on a crossed stop, once per frame.
  assert.match(slider, /if \(next === valueRef\.current\) return;/);
  assert.match(slider, /requestAnimationFrame/);
});

test('nothing but the thumb moves while the priority is being chosen', () => {
  // The slider lives inside a scroll view, and a drag a few degrees off horizontal
  // gave its vertical part away: the page slid under the finger.
  assert.match(slider, /onStartShouldSetPanResponderCapture: \(\) => true/);
  assert.match(slider, /onMoveShouldSetPanResponderCapture: \(\) => true/);
  assert.match(slider, /onShouldBlockNativeResponder: \(\) => true/);
  assert.match(slider, /onPanResponderTerminationRequest: \(\) => false/);
  // Capturing is not enough on iOS, where the native scroll pan can still win, so
  // the screen freezes its own scroll for the duration of the drag.
  assert.match(slider, /dragStateRef\.current\?\.\(true\)/);
  assert.match(slider, /dragStateRef\.current\?\.\(false\)/);
  assert.match(create, /scrollEnabled=\{!adjustingPriority\}/);
  assert.match(create, /onDragStateChange=\{setAdjustingPriority\}/);
});

// ── Edit Habit.dc.html · the same screen in its other mode ──────────────────

test('Edit is the create sheet in its other mode, and not one new block', () => {
  const edit = source('src/features/planner/presentation/edit-habit-screen.tsx');
  const sheet = source('src/features/planner/presentation/create-item-screen.tsx');
  // The whole point: one window, one layout, the fields already filled. It used to
  // be the *old* form in its other mode, which is why the editor looked like a
  // different application from the one that made the item.
  assert.match(edit, /<CreateItemScreen/);
  assert.doesNotMatch(edit, /<HabitFormScreen/);
  assert.match(sheet, /export function CreateItemScreen\(\{ edit \}/);
  // The action, and the two rows only an item that already exists can carry.
  assert.match(sheet, /saving \? 'Saving…' : 'Save changes'/);
  // Lifecycle is a plate of the stack now rather than a block inside one box, which is
  // what lets a plate appear or vanish by type or by mode without re-flowing its
  // neighbours. It is still the two rows only an item that exists can carry.
  assert.match(sheet, /edit === undefined \? null : <View style=\{\[styles\.plate/);
  assert.match(sheet, />Archive</);
  assert.match(sheet, />Delete</);
  // **The type chooser is absent in Edit**, and that has not moved: editing changes an
  // item, it does not turn it into a different kind of thing.
  assert.match(sheet, /\{edit !== undefined \? null : <TravellingSegment/);
  // Nothing that belongs to a report: no streaks, percentages or created-on.
  assert.doesNotMatch(edit, /completion rate|observationCount|HabitVisualPreview|HabitGroupSurface/i);
});

test('Edit keeps every canonical guarantee, and the sheet keeps none of them', () => {
  const edit = source('src/features/planner/presentation/edit-habit-screen.tsx');
  const sheet = source('src/features/planner/presentation/create-item-screen.tsx');
  // Archive is reversible and unconfirmed; delete previews and confirms.
  assert.match(edit, /archiveHabit\(\{ boundaryTimezone/);
  assert.match(edit, /previewDeleteHabitChain/);
  assert.match(edit, /expectedOrderedTargetHabitIds: impact\.orderedTargetHabitIds/);
  assert.match(edit, /confirmed: true/);
  // A saved metric habit keeps its exact contract: carried through, never
  // converted — the definition is rebuilt from what is stored and handed back.
  assert.match(edit, /trackingDraftFromDefinition\(configuration\.tracking\.definition\)/);
  // Pre-active and follower habits still refuse to open rather than half-work.
  assert.match(edit, /actionAvailability\.edit\.available/);
  assert.match(edit, /Schedule follows another habit/);
  // **What an edit means stays in the editor.** The sheet lends its language and
  // knows nothing about effective dates, tracking definitions or deletion.
  assert.doesNotMatch(sheet, /editHabit|previewDeleteHabitChain|trackingDraftFromDefinition/);
});

test('an ordinary edit is never refused for having history behind it', () => {
  const edit = source('src/features/planner/presentation/edit-habit-screen.tsx');
  // An edit dated today is a *correction* of today's configuration, and persistence
  // allows that only while nothing depends on it. For any habit older than today
  // that is never true, so every ordinary edit came back refused.
  assert.match(edit, /const sameDay = await editHabit\(\{ \.\.\.command, effectiveLocalDate: date \}\)/);
  assert.match(edit, /sameDay\.error\.code !== 'same_day_correction_not_eligible'/);
  assert.match(edit, /const tomorrow = movePlannerDate\(date, 1\)/);
  assert.match(edit, /editHabit\(\{ \.\.\.command, effectiveLocalDate: tomorrow \}\)/);
  // And it says so rather than landing silently on a different date.
  assert.match(edit, /setAppliedFrom\(tomorrow\)/);
  assert.match(create, /the change starts from \{formatPlannerDateEntry\(edit\.appliedFrom\)\}/);
});

test('Habit detail is withdrawn and its route sends the reader to Edit', () => {
  const adapters = source('src/features/planner/presentation/ui-adapters.ts');
  const route = source('app/planner/habits/[id].tsx');
  // Everything detail carried is on Edit, which can also change it.
  assert.match(adapters, /export function habitEditNavigation/);
  assert.match(adapters, /return habitEditNavigation\(habitId, date\)/);
  // The route stays registered so an existing deep link still resolves.
  assert.match(route, /<Redirect/);
  assert.match(route, /pathname: '\/planner\/edit\/\[id\]'/);
  assert.doesNotMatch(route, /HabitDetailScreen/);
});
