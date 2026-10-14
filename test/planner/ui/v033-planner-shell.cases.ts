import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parsePlannerLocalDate, type PlannerLocalDate } from '../../../src/features/planner/domain';
import {
  createPlannerDateState,
  isPlannerDateInRailWindow,
  PLANNER_RAIL_WINDOW_RADIUS,
  reducePlannerDateState,
} from '../../../src/features/planner/presentation/planner-date-state';
import {
  TAB_BAR_CLEARANCE,
  TAB_BAR_HEIGHT,
  TAB_BAR_INSET,
  TAB_BAR_RADIUS,
  TAB_BAR_SLOT_RADIUS,
} from '../../../src/ui/tab-bar';

const source = (path: string) => readFileSync(path, 'utf8');

const tabs = source('app/(tabs)/_layout.tsx');
const bar = source('src/ui/tab-bar.ts');
const rail = source('src/features/planner/presentation/planner-date-rail.tsx');

function date(value: string): PlannerLocalDate {
  const parsed = parsePlannerLocalDate(value);
  if (!parsed.ok) throw new Error(`Invalid Planner date: ${value}`);
  return parsed.value;
}

// ── design_handoff_today §6 · the bar spans the screen inside its inset ──────

test('the bar floats on all four edges, and is a true oval', () => {
  // **Reversed on a device report**: PD-PLATE-009's full-width bar read as a slab, with
  // the day stopping at a wall rather than passing under something. It comes off every
  // edge again and the ground runs unbroken beneath it.
  assert.equal(TAB_BAR_INSET, 16);
  // **A true oval, not a rounded rectangle**: the radius is half the height, so the ends
  // are semicircles whatever the height becomes.
  assert.equal(TAB_BAR_RADIUS, TAB_BAR_HEIGHT / 2);
  // The active slot keeps the bar's own curve, minus the padding around it.
  assert.equal(TAB_BAR_SLOT_RADIUS, TAB_BAR_RADIUS - 6);
  // Content with the same padding above and below, and no home-indicator room: a bar
  // that does not reach the edge has none to hold, so the safe area is under it.
  assert.equal(TAB_BAR_HEIGHT, 56);
  assert.equal(TAB_BAR_CLEARANCE, TAB_BAR_HEIGHT + TAB_BAR_INSET);
  assert.match(bar, /TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT \+ TAB_BAR_INSET/);
  // No width is written for a plate count, because the slots flex.
  assert.doesNotMatch(bar, /tabCapsuleWidth|TAB_CAPSULE/);
});

test('the bar is drawn by the layout, because tabBarStyle cannot make it inset', () => {
  // React Navigation's own bar carries start/end 0, which outrank left/right in
  // Yoga: a bar requested through tabBarStyle spans the full screen whatever inset
  // it is given. The custom bar is what makes the geometry real.
  assert.match(tabs, /tabBar=\{\(props\) => <JournalTabBar \{\.\.\.props\} \/>\}/);
  assert.match(tabs, /function JournalTabBar\(\{ state, descriptors, navigation \}: BottomTabBarProps\)/);
  assert.doesNotMatch(tabs, /tabBarStyle:|tabBarBackground:|tabBarActiveBackgroundColor:/);
  // The layer paints nothing and passes touches through, so the ground behind the
  // bar stays unbroken to the bottom edge.
  assert.match(tabs, /pointerEvents="box-none" style=\{\[styles\.layer/);
  assert.match(tabs, /layer: \{ bottom: TAB_BAR_INSET, left: TAB_BAR_INSET, position: 'absolute', right: TAB_BAR_INSET \}/);
  // The safe area is measured and added under it, because a floating bar sits **above**
  // the home indicator rather than around it.
  assert.match(tabs, /bottom: TAB_BAR_INSET \+ insets\.bottom/);
  // Every corner, because the bar meets no edge of the screen.
  assert.match(tabs, /borderRadius: TAB_BAR_RADIUS/);
  assert.doesNotMatch(tabs, /borderTopLeftRadius: TAB_BAR_RADIUS/);
  // **One of exactly two blurred surfaces on a screen** — this and the header. A
  // `BlurView` under every list row would be a blur recomputed on every scroll frame,
  // which is the cost that tears a list, so plates stay opaque.
  assert.match(tabs, /<BlurView/);
  assert.match(tabs, /intensity=\{theme\.today\.materialBlur\}/);
  // The labels came back on the owner's reference — `Today · Overview · More`
  // under the icons — and they never scale, because a bar that grew with Dynamic
  // Type would push the ground it floats on. Flexing slots keep the promise the
  // icons-only bar was made for: a fourth module narrows the slots instead of
  // reflowing the row.
  assert.match(tabs, /<Text allowFontScaling=\{false\} numberOfLines=\{1\} style=\{\[styles\.label/);
  assert.match(tabs, /label: \{ fontSize: TAB_BAR_LABEL_SIZE, fontWeight: '500' \}/);
  assert.match(tabs, /slot: \{[^}]*flex: 1/);
  // Selection carries a plate, so it is never only a colour — and the plate is **glass**
  // now (owner decision, 2026-08-05), the same token the date bead wears. `systemTint` was
  // the structural accent washed, and with structure carrying no hue that token would have
  // painted an edgeless grey. The hairline is what makes a translucent region a shape.
  assert.match(tabs, /backgroundColor: theme\.today\.structGlass,/);
  assert.match(tabs, /borderColor: theme\.today\.hairline,/);
  assert.match(tabs, /accessibilityRole="tablist"/);
  assert.match(tabs, /accessibilityRole="tab"/);
  assert.match(tabs, /accessibilityState=\{\{ selected: focused \}\}/);
  // A parked module is still a route: display:'none' is the only mark left to read.
  assert.match(tabs, /function isHiddenTab/);
  assert.match(tabs, /StyleSheet\.flatten\(itemStyle\)\?\.display === 'none'/);
});

test('selecting a date the rail already shows does not move the rail', () => {
  const state = createPlannerDateState(date('2026-07-25'));
  assert.equal(PLANNER_RAIL_WINDOW_RADIUS, 3);

  // A tap inside the window keeps the anchor, so the old and new slots exist in
  // one frame and a single pill can travel between them.
  const stepped = reducePlannerDateState(state, { type: 'select', selectedDate: date('2026-07-27') });
  assert.equal(stepped.selectedDate, '2026-07-27');
  assert.equal(stepped.railAnchorDate, '2026-07-25');
  assert.equal(stepped.visibleDateRange.startDate, state.visibleDateRange.startDate);

  // The far edge of the window is still the window.
  const edge = reducePlannerDateState(state, { type: 'select', selectedDate: date('2026-07-28') });
  assert.equal(edge.railAnchorDate, '2026-07-25');
  const backEdge = reducePlannerDateState(state, { type: 'select', selectedDate: date('2026-07-22') });
  assert.equal(backEdge.railAnchorDate, '2026-07-25');

  // One day further is not on the rail, so it re-anchors and the pill flies in.
  const jumped = reducePlannerDateState(state, { type: 'select', selectedDate: date('2026-07-29') });
  assert.equal(jumped.selectedDate, '2026-07-29');
  assert.equal(jumped.railAnchorDate, '2026-07-29');
  assert.equal(jumped.visibleDateRange.startDate, '2026-07-25');

  // Browsing still moves the anchor alone and leaves the selection behind.
  const browsed = reducePlannerDateState(state, { type: 'browse', railAnchorDate: date('2026-08-05') });
  assert.equal(browsed.selectedDate, '2026-07-25');
  assert.equal(browsed.railAnchorDate, '2026-08-05');

  // Returning to today from across the week re-anchors, because today is not on
  // the rail to travel to.
  const returned = reducePlannerDateState(browsed, { type: 'today', today: date('2026-07-25') });
  assert.equal(returned.selectedDate, '2026-07-25');
  assert.equal(returned.railAnchorDate, '2026-07-25');

  // Re-selecting the current date changes nothing at all.
  assert.equal(reducePlannerDateState(state, { type: 'select', selectedDate: date('2026-07-25') }), state);
});

test('the rail window is seven days wide and symmetric', () => {
  const anchor = date('2026-07-25');
  for (const offset of ['2026-07-22', '2026-07-25', '2026-07-28']) {
    assert.equal(isPlannerDateInRailWindow(anchor, date(offset)), true);
  }
  for (const offset of ['2026-07-21', '2026-07-29', '2026-08-05']) {
    assert.equal(isPlannerDateInRailWindow(anchor, date(offset)), false);
  }
  // Month and year boundaries are ordinary days, not special cases.
  assert.equal(isPlannerDateInRailWindow(date('2026-07-31'), date('2026-08-03')), true);
  assert.equal(isPlannerDateInRailWindow(date('2026-12-31'), date('2027-01-03')), true);
  assert.equal(isPlannerDateInRailWindow(date('2026-12-31'), date('2027-01-04')), false);
});

test('the pill travels, flies in, or commits — and the branch says which', () => {
  // Travel needs both slots on screen at once: the rail held still and the date it
  // left is one of the seven being shown.
  assert.match(rail, /const travelsFromItsOldSlot = selectionChanged\s*\n\s*&& !anchorChanged\s*\n\s*&& previous\.index >= 0\s*\n\s*&& isPlannerDateInRailWindow\(previousAnchor, previous\.date\)/);
  // Otherwise it enters from beyond the rail edge on the side the old date sits.
  assert.match(rail, /\} else if \(selectionChanged \|\| previous\.index < 0\) \{/);
  assert.match(rail, /const fromBefore = previous\.date < selectedDate/);
  assert.match(rail, /initialOffset \+ \(fromBefore \? -\(pillWidth \+ 8\) : railWidth \+ 8\)/);
  assert.match(rail, /pillScale\.setValue\(0\.55\)/);
  // Commit is the leftover: only the window moved, so nothing on screen did.
  assert.match(rail, /duration: PLANNER_SELECTION_DURATION, easing: RAIL_TRAVEL_EASING/);
  assert.match(rail, /translateX: Animated\.subtract\(pillX, scrollX\)/);
  // One source for the seven cells the rail shows and the seven the reducer keeps.
  assert.match(rail, /PLANNER_DATE_RAIL_VISIBLE_CELLS \} from '\.\/ui-adapters'/);
  assert.doesNotMatch(rail, /const PLANNER_DATE_RAIL_VISIBLE_CELLS =/);
  // An explicit tap outranks a settlement that has not run yet: a tap no longer
  // moves the anchor, so it no longer cancels a pending browse by itself.
  assert.match(rail, /clearEndDragTimer\(\);\s*\n\s*interactionTokenRef\.current \+= 1;\s*\n\s*onSelect\(date\);/);
});
