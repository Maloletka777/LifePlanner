import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  parsePlannerId,
  parsePlannerLocalDate,
  type PlannerId,
  type PlannerLocalDate,
} from '../../../src/features/planner/domain';
import {
  createHabitGroupDisclosureState,
  habitGroupIsExpanded,
  reduceHabitGroupDisclosureState,
} from '../../../src/features/planner/presentation/habit-group-disclosure-state';

const DATE = localDate('2026-07-23');
const NEXT_DATE = localDate('2026-07-24');
const ROOT_A = plannerId('11111111-1111-4111-8111-111111111111');
const ROOT_B = plannerId('22222222-2222-4222-8222-222222222222');

const planner = source('src/features/planner/presentation/planner-screen.tsx');
const group = source('src/features/planner/presentation/habit-occurrence-group.tsx');
const row = source('src/features/planner/presentation/habit-occurrence-row.tsx');
const surface = source('src/features/planner/presentation/habit-visual-components.tsx');

test('Phase 3 disclosure starts collapsed, supports independent roots, reconciles refresh, and resets by selected date', () => {
  const initial = createHabitGroupDisclosureState(DATE);
  assert.equal(initial.expandedRootIds.size, 0);

  const rootAExpanded = reduceHabitGroupDisclosureState(initial, { type: 'toggle', rootId: ROOT_A });
  const bothExpanded = reduceHabitGroupDisclosureState(rootAExpanded, { type: 'toggle', rootId: ROOT_B });
  assert.equal(habitGroupIsExpanded(bothExpanded, ROOT_A), true);
  assert.equal(habitGroupIsExpanded(bothExpanded, ROOT_B), true);

  const sameDateRefresh = reduceHabitGroupDisclosureState(bothExpanded, {
    type: 'canonical_refresh',
    selectedDate: DATE,
    canonicalRootIds: [ROOT_B],
  });
  assert.deepEqual([...sameDateRefresh.expandedRootIds], [ROOT_B]);

  const dateChanged = reduceHabitGroupDisclosureState(sameDateRefresh, {
    type: 'selected_date_changed',
    selectedDate: NEXT_DATE,
  });
  assert.equal(dateChanged.selectedDate, NEXT_DATE);
  assert.equal(dateChanged.expandedRootIds.size, 0);
});

test('Phase 3 full Planner owns the existing disclosure seam by canonical root ID', () => {
  assert.match(planner, /createHabitGroupDisclosureState\(selectedDate\)/);
  assert.match(planner, /type: 'canonical_refresh'/);
  assert.match(planner, /canonicalRootIds/);
  assert.match(planner, /type: 'selected_date_changed'/);
  assert.match(planner, /onToggle\(root\.rootHabitId\)/);
  assert.match(planner, /disclosureState\.selectedDate === selectedDate/);
  assert.doesNotMatch(group, /useState\([^)]*expanded|setExpanded/);
});

test('Phase 3 collapsed groups render no ordinary or conditional rows and non-expandable roots have no disclosure', () => {
  assert.match(group, /const children = \[\.\.\.ordinaryRows, \.\.\.conditionalRows\]\.sort/);
  assert.match(group, /\{!expanded \? null :/);
  assert.doesNotMatch(group, /ordinaryRows\.slice\(0, 2\)/);
  assert.doesNotMatch(group, /conditionalRows\.map/);
  assert.match(group, /children\.length === 0[\s\S]*groupDisclosure/);
  assert.match(surface, /groupChildren: \{ borderLeftWidth: 2, overflow: 'hidden' \}/);
});

test('Phase 3 parent disclosure and canonical action are separate sibling controls', () => {
  assert.match(row, /const body = groupDisclosure === null/);
  assert.match(row, /accessibilityRole="button"/);
  assert.match(row, /accessibilityState=\{\{ expanded: groupDisclosure\.expanded \}\}/);
  assert.match(row, /onPress=\{groupDisclosure\.onToggle\}/);
  assert.match(row, /const control = derivedRoutine/);
  assert.match(row, /onPress=\{\(\) => onAction\(row\)\}/);
  assert.ok(row.indexOf('{body}') < row.indexOf('{control}'));
  assert.ok(row.indexOf('>{identity}</Pressable>') < row.indexOf('onPress={() => onAction(row)}'));
});

test('Phase 3 collapsed parent anatomy exposes identity, canonical progress, child count, dependency state, and disclosure', () => {
  assert.match(row, /HabitIdentityMark/);
  assert.match(row, /stepProgress/);
  assert.match(row, /Its own habit · \$\{groupDisclosure\.ordinaryChildCount\} linked/);
  assert.match(row, /\$\{groupDisclosure\.completedRoutineStepCount\} of \$\{groupDisclosure\.routineStepCount\} steps/);
  assert.match(row, /conditionalCount/);
  assert.match(row, /lock-closed-outline/);
  assert.match(row, /chevron-up/);
  assert.match(row, /chevron-down/);
  assert.doesNotMatch(row, /database|relationship type|evaluation rule/i);
});

test('Phase 3 expanded hierarchy keeps one group surface, canonical order, relationship context, and 44-point controls', () => {
  assert.match(group, /compareCanonicalRows/);
  assert.match(group, /stableSortOrder - right\.stableSortOrder/);
  assert.match(group, /stableSortOrder - right\.stableSortOrder/);
  assert.match(group, /stableSortOrder - right\.stableSortOrder/);
  assert.match(group, /hierarchyDepth=\{Math\.min\(Math\.max\(row\.ordinaryDepth, 1\), 2\)\}/);
  // One grouped surface per root; steps live inside it, not in a second card.
  assert.equal((group.match(/styles\.surface,/g) ?? []).length, 1);
  assert.doesNotMatch(group, /HabitGroupSurface/);
  assert.match(row, /step of \$\{parentName\}/);
  assert.match(row, /hideOrdinaryRelationship/);
  assert.match(row, /height: 44/);
  assert.match(row, /width: 44/);
});

test('Phase 3 daily rows retain only action-required value and exceptional state copy', () => {
  assert.match(row, /measurement/);
  assert.match(row, /row\.plannedLocalTime \?\? \(isChild \|\| isConditional \? null : 'Anytime'\)/);
  assert.match(row, /Not confirmed yet/);
  assert.match(row, /rowError/);
  assert.match(row, /status\.explanation/);
  for (const removed of ['description', 'comparison-rule', 'recurrence', 'archive', 'delete', 'history', 'edit control', 'tracking mode']) {
    assert.doesNotMatch(row, new RegExp(removed, 'i'));
  }
  // Priority now reads as a 4 pt leading edge plus the level word for the two
  // levels that need action (handoff §8).
  assert.match(row, /row\.importance === 'critical'/);
  assert.match(row, /priorityEdge/);
  assert.match(row, /PRIORITY_WORDS = Object\.freeze\(\{ low: null, normal: null, high: 'HIGH', critical: 'CRITICAL' \}/);
});

test('Phase 3 progress and existing commands remain canonical and scoped', () => {
  assert.match(planner, /sectionCounts\(scheduledGroups\)/);
  assert.match(group, /displayProgressOverride=\{plannerRoutineDisplayProgress\(group\)\}/);
  assert.match(row, /displayProgressOverride/);
  assert.doesNotMatch(group, /filter\([^)]*qualified|completed.*length|reduce\(/);
  assert.match(planner, /tryBeginPlannerPendingAction/);
  assert.match(planner, /runPlannerPresentationAction/);
  assert.match(planner, /recordHabitObservation/);
  assert.match(planner, /correctHabitObservation/);
  assert.match(planner, /ObservationEntryModal/);
  assert.match(planner, /row\.commandContext/);
});

test('Phase 5 Planner chrome has one floating Add entry, tertiary Manage, and contextual Back to today', () => {
  assert.equal((planner.match(/styles\.addControl/g) ?? []).length, 1);
  assert.match(planner, /accessibilityLabel="Add habit"/);
  assert.match(planner, /accessibilityLabel="Open habit management"/);
  assert.match(planner, /onReturnToToday=\{selectedDate === today \? undefined : selectToday\}/);
  assert.doesNotMatch(planner, /FloatingActionBar/);
  assert.match(planner, /pathname: '\/planner\/create'/);
  assert.match(planner, /habitCatalogueNavigation\(selectedDate\)/);
});

test('Phase 3 accessibility and motion contracts retain focus, reduced motion, readable progress, and independent states', () => {
  assert.match(group, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(group, /LayoutAnimation\.configureNext/);
  assert.match(group, /if \(!reduceMotion\)/);
  assert.match(group, /setAccessibilityFocus/);
  assert.match(row, /accessibilityHint=\{groupDisclosure\.expanded/);
  assert.match(row, /accessibilityLiveRegion=\{rowError !== null \|\| saving \? 'polite' : 'none'\}/);
  assert.match(row, /accessibilityState=\{\{ busy: saving, checked:/);
  assert.match(row, /busy: saving/);
  assert.match(row, /PRIORITY_WORDS\[row\.importance\]/);
});

function source(file: string): string {
  return readFileSync(file, 'utf8');
}

function localDate(value: string): PlannerLocalDate {
  const result = parsePlannerLocalDate(value);
  if (!result.ok) throw new Error(`Invalid test date: ${value}`);
  return result.value;
}

function plannerId(value: string): PlannerId {
  const result = parsePlannerId(value);
  if (!result.ok) throw new Error(`Invalid Planner ID: ${value}`);
  return result.value;
}

// ── motion prototype corrections (turn 3) ────────────────────────────────────

test('the date rail carries nothing but the day', () => {
  const rail = source('src/features/planner/presentation/planner-date-rail.tsx');
  assert.doesNotMatch(rail, /styles\.dots|styles\.dot\b|overflowDots|DateMarkerStrip|markerSlot|HabitIdentityMark/);
  assert.match(rail, /The rail carries no markers and no progress dots/);
  // The read model stays: only the presentation is gone.
  assert.match(rail, /summary\?\.scheduled/);
  assert.match(rail, /summary\?\.completed/);
});

test('selection is a movement: one pill travels to the tapped date', () => {
  const rail = source('src/features/planner/presentation/planner-date-rail.tsx');
  // One object moving, not one box switching off and another switching on.
  assert.match(rail, /RAIL_TRAVEL_EASING = Easing\.bezier\(0\.32, 0\.72, 0, 1\)/);
  assert.match(rail, /translateX: Animated\.subtract\(pillX, scrollX\)/);
  // Both ends native, so the subtraction never crosses the bridge — and the list
  // must be an Animated component for that, or a native `onScroll` throws at
  // render. That crash is what opening Planner did on `тест12`.
  assert.match(rail, /Animated\.event\(\[\{ nativeEvent: \{ contentOffset: \{ x: scrollX \} \} \}\], \{ useNativeDriver: true \}\)/);
  assert.match(rail, /<Animated\.FlatList/);
  assert.doesNotMatch(rail, /<FlatList/);
  assert.doesNotMatch(rail, /useNativeDriver: false/);
  assert.match(rail, /duration: PLANNER_SELECTION_DURATION, easing: RAIL_TRAVEL_EASING/);
  // 300 ms read as the interface stuttering rather than as a page turning.
  assert.match(rail, /PLANNER_SELECTION_DURATION = 640/);
  // With no old slot on screen to leave from it arrives from beyond the rail edge,
  // growing 0.55 → 1 and opaque by 70 % of the path — it never fades in on the date.
  assert.match(rail, /pillScale\.setValue\(0\.55\)/);
  assert.match(rail, /pillOpacity\.setValue\(0\)/);
  assert.match(rail, /initialOffset \+ \(fromBefore \? -\(pillWidth \+ 8\) : railWidth \+ 8\)/);
  assert.match(rail, /\{ scale: pillScale \}/);
  // Travel is the special case, not the default: it needs the rail to have held
  // still and the old date to be one of the seven on screen. The entrance covers
  // everything else, including a scroll that brings the selection back into view.
  assert.match(rail, /if \(travelsFromItsOldSlot\) \{[\s\S]*?\} else if \(selectionChanged \|\| previous\.index < 0\) \{/);
  // Only Reduce Motion commits with no movement at all.
  assert.match(rail, /if \(reduceMotion\) \{\s*\n\s*pillOpacity\.setValue\(1\);\s*\n\s*pillX\.setValue\(target\)/);
  // Equal layout slots, one wider pill: snapToInterval and getItemLayout stay valid.
  assert.match(rail, /PLANNER_DATE_PILL_WIDTH = 61/);
  assert.match(rail, /snapToInterval=\{cellWidth\}/);
  assert.match(rail, /getItemLayout=\{\(_, index\) => \(\{ index, length: cellWidth, offset: cellWidth \* index \}\)\}/);
  // The number grows by **transform**, on the same curve. The earlier rule said the
  // opposite — never transform, because a scaled glyph blurs — and the device
  // answered it: animating `fontSize` relaid out all seven cells on every date
  // change, and eight layout animations in one frame is the flicker. Drawn at its
  // selected size and scaled down at rest, the glyph is never re-rasterised.
  assert.match(rail, /const selection = useRef\(new Animated\.Value\(isSelected \? 1 : 0\)\)/);
  assert.match(rail, /transform: \[\{ scale: selection\.interpolate\(/);
  assert.match(rail, /PLANNER_NUMBER_REST_SCALE = 17 \/ 26/);
  assert.doesNotMatch(rail, /fontSize: selection\.interpolate/);
  assert.match(rail, /duration: PLANNER_SELECTION_DURATION,\s*\n\s*easing: RAIL_TRAVEL_EASING/);
  // Press is a tint and nothing else — it no longer resizes the number.
  assert.match(rail, /styles\.pressTint/);
  assert.doesNotMatch(rail, /pressed \? 19 : 17/);
  assert.doesNotMatch(rail, /fontWeight: isSelected \? '700' : pressed/);
  // Reduce Motion commits in one frame and keeps the ring on the travelling pill.
  assert.match(rail, /if \(reduceMotion\) \{\s*\n\s*selection\.setValue\(target\)/);
  // The 2 pt Reduce Motion ring is untouched; the ordinary state gained a 1 pt
  // border because the pill's fill is the accent tint now and its shadow is
  // gone on a dark ground, where it only made dirt.
  assert.match(rail, /borderWidth: reduceMotion \? 2 : 1/);
  assert.match(rail, /backgroundColor: theme\.today\.completionTint/);
  assert.doesNotMatch(rail, /backgroundColor: theme\.today\.dashboardSurface/);
  assert.match(rail, /shadowColor: theme\.dark \? 'transparent' : theme\.colors\.shadow/);
});

test('the day arrives as one sheet whose direction encodes the direction of time', () => {
  assert.match(planner, /PLANNER_DAY_ENTRANCE_TRAVEL = 32/);
  assert.match(planner, /PLANNER_DAY_ENTRANCE_DURATION = 620/);
  assert.match(planner, /PLANNER_DAY_ENTRANCE_EASING = Easing\.bezier\(0\.32, 0\.72, 0, 1\)/);
  // Forward in time the sheet arrives from the left, back from the right, and the
  // direction comes from comparing dates so an eleven-day jump reads as one step.
  // The design reversed it: forward now arrives from the right.
  assert.match(planner, /selectedDate > previousDateRef\.current \? PLANNER_DAY_ENTRANCE_TRAVEL : -PLANNER_DAY_ENTRANCE_TRAVEL/);
  assert.match(planner, /translateX: shift/);
  assert.match(planner, /opacity: fade/);
  assert.match(planner, /if \(reduceMotion\) \{/);
  // One sheet, not a per-row stagger: the whole day moves together.
  assert.match(planner, /<PlannerDayEntrance direction=\{entrance\.direction\}/);
  assert.doesNotMatch(planner, /PLANNER_ROW_ENTRANCE_STAGGER|staggerOffset|PlannerRowEntrance/);
  assert.doesNotMatch(planner, /listShift|listOpacity/);
});

test('the habit accent fills the row again, and priority keeps only High and Critical', () => {
  assert.match(row, /backgroundColor: connectedChild \? theme\.today\.rowTint : theme\.today\.dashboardSurface/);
  // The lighter tile over the fill is a token now, so it darkens with the ground
  // instead of staying a 72 % white wash on a midnight palette.
  assert.match(row, /tileBackground=\{theme\.today\.tileWash\}/);
  assert.match(row, /const priorityEdge = row\.importance === 'critical'/);
  assert.match(row, /row\.importance === 'high' \? theme\.today\.priorityHigh : 'transparent'/);
  // A tinted row cannot also carry an overdue wash; the word does that work.
  assert.doesNotMatch(row, /attentionTint/);
  assert.match(group, /backgroundColor: theme\.today\.dashboardSurface/);
  assert.match(group, /backgroundColor: theme\.today\.rowTint/);
  // Colour is a label now, not a fill: nothing in a Planner list is painted
  // with the habit's own accent except its 28 pt mark and the priority edge.
  assert.doesNotMatch(row, /backgroundColor: accent\./);
  assert.doesNotMatch(group, /accent\.(iconBackground|surface|border)/);
});

test('completion is a left-to-right sweep driven only by canonical state', () => {
  assert.match(row, /SWEEP_EASING = Easing\.bezier\(0\.22, 0\.61, 0\.36, 1\)/);
  assert.match(row, /const sweep = useRef\(new Animated\.Value\(fillTarget\)\)/);
  // A transform, not a width: animating a percentage relaid the row out on the
  // JS thread every frame, which is what made the fill climb in steps.
  assert.match(row, /transform: \[\{ scaleX: sweep \}\]/);
  assert.doesNotMatch(row, /outputRange: \['0%', '100%'\]/);
  assert.match(row, /styles\.sweep/);
  // Left to right on every row, so the direction never depends on the control.
  assert.match(row, /sweep: \{ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, transformOrigin: 'left' \}/);
  // A routine's fill measures its **steps**. With the row no longer tinted by the
  // habit's accent, driving the fill from `completed` left a parent reading 0 %
  // until the last step landed and 100 % the moment it did.
  assert.match(row, /duration: fillTarget >= 1 \? SWEEP_DURATION : SWEEP_UNDO_DURATION/);
  assert.match(row, /const fillTarget = routine && displayProgress !== null/);
  assert.match(row, /toValue: fillTarget/);
  assert.match(row, /SWEEP_DURATION = 420/);
  assert.match(row, /backgroundColor: theme\.today\.completionTint/);
  // The check pops after the sweep has started, and undo is the reverse.
  assert.match(row, /delay: completed \? CHECK_DELAY : 0/);
  assert.match(row, /CHECK_DELAY = 120/);
  // No overshoot anywhere: the back() throw was the second jolt.
  assert.doesNotMatch(row, /Easing\.back/);
  assert.match(row, /transform: \[\{ scale: pop \}\]/);
  // The title settles muted over 200 ms instead of switching colour in one frame.
  assert.match(row, /const mute = useRef\(new Animated\.Value\(completed \? 1 : 0\)\)/);
  assert.match(row, /duration: completed \? STRIKE_DURATION : 160/);
  // The title is struck by the diary's own hand, revealed by a clip, rather
  // than switching colour through a JS-driven interpolation.
  assert.match(row, /<HandStrike color=\{theme\.today\.secondaryText\}/);
  assert.match(row, /transform: \[\{ scaleX: mute \}\]/);
  assert.doesNotMatch(row, /color: mute\.interpolate\(/);
  assert.doesNotMatch(row, /textDecorationLine/);
  // A completed row has nothing left to prioritise.
  assert.match(row, /priorityWord === null \|\| completed \? null :/);
  // Only a confirmed change of canonical state drives it: pending shows neither.
  assert.match(row, /\}, \[completed, fillTarget, mute, pop, reduceMotion, sweep\]\)/);
  assert.match(row, /Completion animates only on a confirmed change of canonical state/);
});
