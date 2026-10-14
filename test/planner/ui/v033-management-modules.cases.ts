import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { bottomLayerAlpha, colorWithAlpha } from '../../../src/ui/components/bottom-layer';

const source = (path: string) => readFileSync(path, 'utf8');

const management = source('src/features/planner/presentation/all-habits-screen.tsx');
const identity = source('src/features/planner/presentation/habit-visual-components.tsx');
const components = source('src/ui/components/index.tsx');
const create = source('src/features/planner/presentation/create-item-screen.tsx');
const tabs = source('app/(tabs)/_layout.tsx');
const planner = source('src/features/planner/presentation/planner-screen.tsx');

// ── Manage becomes a list of items (design_handoff_manage_subtasks §A) ───────

test('Manage is one plate per item, on the ground', () => {
  assert.match(management, /backgroundColor=\{theme\.today\.appSurface\}/);
  // **The section's one card is gone** (PD-PLATE-001): it was the surface that made
  // every row inside it a second level. A row is a plate now — radius 12, no border,
  // a soft shadow — lying on the ground with 8 pt of air between it and the next.
  assert.doesNotMatch(management, /card: \{ borderRadius: 16/);
  assert.doesNotMatch(management, /rowRule/);
  assert.match(management, /sectionPlates: \{ gap: PLATE_GAP \}/);
  assert.match(management, /borderRadius: PLATE_RADIUS,/);
  assert.match(management, /minHeight: PLATE_MIN_HEIGHT,/);
  // **The plate stays opaque, and that is load-bearing rather than decorative**: it is
  // the mask the swipe uncovers its keys from behind (PD-MANAGE-014).
  assert.match(management, /backgroundColor: pressed \? theme\.today\.pressedSurface : theme\.today\.dashboardSurface,/);
  assert.match(management, /plateHolder: \{ borderRadius: PLATE_RADIUS, overflow: 'hidden' \}/);
  // The row's two columns are the journal's, read from the journal's own constants
  // rather than restated — which is what keeps the two surfaces one language.
  // **The label is centred in the slice.** It is the full height of the row — 52 pt
  // against a 16 pt line — so pinned to the top-left corner it read as adrift in a
  // coloured rectangle, and the strings differ most on that axis: `Today`, `26 Jul`
  // and `Tomorrow` are 33-63 pt wide, ragged left-aligned and a column centred.
  assert.match(management, /itemGutter: \{ alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center'/);
  assert.match(management, /gutterLabel: \{[^}]*textAlign: 'center' \}/);
  assert.match(management, /itemBody: \{[^}]*gap: PLATE_ROW_GAP[^}]*paddingHorizontal: PLATE_PADDING/);
  // **The text column reserves nothing** (PD-PLATE-002): a row with no caption is as
  // centred as one with a caption, because the absent line is not rendered at all.
  assert.match(management, /itemWords: \{ flex: 1, gap: 2, justifyContent: 'center', minWidth: 0 \}/);
  // The mark is the shared chip, so Manage and the day cannot disagree on a shape.
  assert.match(management, /from '\.\/item-chip'/);
  assert.match(management, /<CategoryChip[\s\S]*?accentKey=\{subject\.accentKey\}/);
  assert.match(management, /size=\{JOURNAL_TILE\}/);
  // A task's title is heavier than a habit's — the journal's own rule for the two.
  // **Weight is rank, not kind** (PD-PLATE-003/`-005`): 600 marks an important item,
  // and the kind is carried by the mark's own shape, which is where it belongs.
  assert.match(management, /fontWeight: important \? '600' : '400'/);
  // The headings the flat list withdrew: a colour has no name to be a heading of.
  assert.doesNotMatch(management, />ROUTINES<|>SINGLE HABITS</);
});

test('the gutter carries when the item comes round, and the rank is its tint', () => {
  // PD-MANAGE-018: the column Today gives to a minute answers the same question here.
  assert.match(management, /manageGutterLabel\(\{ due, kind, plannedLocalTime: row\.plannedLocalTime, today \}\)/);
  assert.match(management, /gutterLabel: \{ fontSize: 12, fontVariant: \['tabular-nums'\], fontWeight: '400'/);
  // PD-MANAGE-019: the tint is the whole of the rank. The 3 pt edge said the same
  // thing in the same corner, and two statements of one fact read as two facts.
  assert.doesNotMatch(management, /rank\.gutter|priorityEdge/);
  assert.match(management, /criticalDot: \{ borderRadius: PLATE_CRITICAL_DOT \/ 2/);
  assert.doesNotMatch(management, /theme\.today\.priorityHigh|theme\.today\.priorityCritical/);
  // Two facts in one cell, so the ink is raised until it reads on the tint under it.
  assert.match(management, /const gutterInk = MANAGE_GUTTER_INK\[gutter\.tone\]\(theme\);/);
  assert.doesNotMatch(management, /rankGutterInk/);
  // PD-MANAGE-018 again: the trailing due chip is gone, because the gutter says it.
  assert.doesNotMatch(management, /dueChip|DueChip/);
  // PD-MANAGE-020: what takes the freed corner is the counter, tasks included.
  assert.match(management, /\$\{closed\}\/\$\{steps\.length\}/);
});

test('the lines stay inside the plate, under a column that does not stop', () => {
  // PD-MANAGE-021: the gutter continues beside the block in the parent's own tint.
  assert.match(management, /<View style=\{\[styles\.itemGutter, \{ width: gutterWidth \}\]\} \/>/);
  // The indent is derived from the columns it has to clear, never restated.
  assert.match(management, /paddingLeft: JOURNAL_TILE \+ JOURNAL_BODY_GAP \+ JOURNAL_BODY_PADDING/);
  assert.match(management, /stepRow: \{ alignItems: 'center', flexDirection: 'row'/);
  // **Nothing here ticks.** An observation belongs to a date and Manage has none, so
  // the box is drawn as a record: no `Pressable`, no `hitSlop` (PD-MANAGE-012).
  const steps = management.slice(management.indexOf('function StepRow'), management.indexOf('function PanelAction'));
  assert.doesNotMatch(steps, /Pressable|hitSlop/);
  assert.match(steps, /backgroundColor: color/);
});

test('the identity mark and the glyph leave the row, and nothing replaces them', () => {
  // A colour and a shape are the whole mark now, which is what lets a task and a
  // habit sit in one list without a label explaining which is which.
  assert.doesNotMatch(management, /MANAGEMENT_MARK_SIZE/);
  assert.doesNotMatch(management, /<HabitIdentityMark[\s\S]{0,80}size=\{/);
  // The shared component keeps its two sizes for the screens that still draw it.
  assert.match(components, /const size = child \? 28 : 40/);
  assert.match(components, /const box = sizeOverride \?\? size/);
  assert.match(components, /borderRadius: Math\.round\(box \* 0\.325\)/);
  assert.match(identity, /const box = size \?\? \(child \? 28 : 40\)/);
});

test('the segment splits by type, and lifecycle moves down into the chips', () => {
  assert.match(management, /type ManagementScope = 'active' \| 'archived'/);
  assert.match(management, /usePlannerHabitCatalogue\(searchText, 'all', asOfLocalDate\)/);
  // Three type slots with live counts, from a type that is derived and never stored.
  assert.match(management, /\['all', 'All', counts\.all\], \['tasks', 'Tasks', counts\.tasks\], \['habits', 'Habits', counts\.habits\]/);
  assert.match(management, /manageTypeCounts/);
  // Active / Archive is a chip now, and the archive still carries its count.
  assert.match(management, /\['active', 'Active', null\], \['archived', 'Archive', archivedRows\.length\]/);
  assert.match(management, /row\.lifecycle === 'archived'/);
  // There is no canonical paused lifecycle, so no third state may claim one.
  assert.doesNotMatch(management, /'paused'|Paused/);
});

test('what is broken is pinned, and the order is a two-state toggle', () => {
  // The Broken chip is gone: something broken is repaired, not looked for.
  assert.doesNotMatch(management, /ManagementFacet/);
  assert.match(management, /pinNeedsSchedule: scope === 'active'/);
  assert.match(management, /NEEDS A SCHEDULE/);
  // Newest by default, one tap to Oldest, the next back. No third order, no menu.
  assert.match(management, /setSortOrder\(nextManageSortOrder\)/);
  assert.match(management, /sortOrder === 'newest' \? 'Newest' : 'Oldest'/);
  assert.match(management, /name="swap-vertical-outline"/);
});

test('search is behind the header icon rather than permanently occupying the screen', () => {
  assert.match(management, /const \[searchVisible, setSearchVisible\] = useState\(false\)/);
  assert.match(management, /accessibilityLabel=\{searchVisible \? 'Hide search' : 'Search items'\}/);
  assert.match(management, /'Search active items'/);
  assert.match(management, /!searchVisible \|\| selecting \? null : <TextField/);
});

test('a broken item states its repair in words and taps straight to Edit', () => {
  assert.match(management, /Repeat is missing — tap to fix/);
  assert.match(management, /manageNeedsSchedule\(row\) && availability\.edit\.available/);
  assert.match(management, /pathname: '\/planner\/edit\/\[id\]'/);
  // The disclosed lines no longer state a schedule of their own: a subtask is a
  // line of text now, so there is nothing under an item that can be broken.
  assert.doesNotMatch(management, /broken \? 'no schedule'/);
  assert.match(management, /childrenOf=\{\(parent\) => checklists\.data\?\.get\(parent\.habitId\) \?\? \[\]\}/);
});

test('nothing can be completed on Manage, and the square means selected', () => {
  // An observation is written against a date and this screen has none, so the only
  // surface that can close an item is Today.
  assert.match(management, /Nothing can be completed here/);
  // It stands in the trailing column, where every checkbox in the application stands
  // and where the counter it replaces was: a square opening on the leading edge moved
  // the whole row sideways under the finger.
  assert.match(management, /\{selecting \? <View style=\{styles\.selectionTarget\}><SelectionMark selected=\{selected\} \/><\/View> : null\}/);
  assert.match(management, /selectionTarget: \{[^}]*width: JOURNAL_TOUCH_TARGET \}/);
  assert.match(management, /accessibilityRole=\{selecting \? 'checkbox' : 'button'\}/);
  assert.doesNotMatch(management, /recordHabitObservation|correctHabitObservation/);
});

test('selection mode states its cascade and coexists with swipe', () => {
  assert.match(management, /const \[selecting, setSelecting\] = useState\(false\)/);
  assert.match(management, /onLongPress=\{selecting \? undefined : onLongPress\}/);
  assert.match(management, /cascadeCount = selectedRoots\.reduce\(\(total, root\) => total \+ root\.ordinaryChildCount, 0\)/);
  assert.match(management, /\['all', 'Select all'\], \['none', 'Select none'\], \['invert', 'Invert'\]/);
});

test('swipe acts on one item and never contends with Select', () => {
  assert.match(management, /<SwipeActionRow actions=\{actions\} appearance="cards"/);
  assert.match(management, /if \(!enabled \|\| actions\.length === 0\) return <>\{children\}<\/>/);
  assert.match(management, /enabled=\{!selecting\}/);
  // Three keys, each gated on canonical availability, and delete still previews.
  assert.match(management, /name: 'edit'/);
  assert.match(management, /name: 'archive'/);
  assert.match(management, /name: 'restore'/);
  assert.match(management, /name: 'delete'[\s\S]*?requestDelete\(\[row\]\)/);
  assert.match(management, /primaryTargets = swipeTarget === null \? eligibleForPrimary : \[swipeTarget\]/);
  // With three keys open the text column shrinks to about 118 pt, so no caption may
  // wrap: a wrapping caption pushes the row's height around under the finger.
  assert.match(management, /style=\{\[styles\.itemCaption/);
  assert.doesNotMatch(management, /<Text style=\{\[styles\.itemCaption/);
  // **The plate travels exactly as far as the finger.** `Swipeable` divides the drag by
  // `friction`, so the 2 this carried moved the row half the distance the finger did —
  // a row that is never under the finger, which is what read as lag rather than as a
  // slow reveal. The transform is native, so nothing crosses the bridge per frame.
  assert.match(components, /const SWIPE_FRICTION = 1;/);
  assert.match(components, /friction=\{SWIPE_FRICTION\}/);
  assert.match(components, /useNativeAnimations/);
  assert.doesNotMatch(components, /friction=\{2\}/);
  // The dead travel before the row answers, kept honest for the vertical scroll.
  assert.match(components, /const SWIPE_ACTIVATION = 8;/);
  // The card appearance is opt-in; the archived screen keeps the original bar.
  assert.match(components, /appearance = 'bar'/);
  assert.match(components, /swipeActionCard: \{ borderRadius: 18[^}]*width: 56 \}/);
});

test('one floating action, named for the segment it was pressed on', () => {
  assert.match(management, /typeScope === 'tasks' \? 'New task' : typeScope === 'habits' \? 'New habit' : 'New'/);
  assert.match(management, /pathname: '\/planner\/create'/);
  assert.doesNotMatch(management, /Add to Planner|Browse templates|label="Add habit or template"/);
});

test('consequences are stated before the press, and delete keeps its preview', () => {
  assert.match(management, /also affects \$\{cascadeCount\}/);
  assert.match(management, /History is kept\. Deleting would remove those steps permanently\./);
  assert.match(management, /previewDeleteHabitChain/);
  assert.match(management, /deleteChainConfirmationTitle/);
  assert.match(management, /confirmed: true/);
  assert.match(management, /expectedOrderedTargetHabitIds: impact\.orderedTargetHabitIds/);
  // No timed undo stands in for the confirmation of a permanent recursive delete.
  assert.doesNotMatch(management, /label="Undo"|title="Undo"|undoTimer/);
});

test('the action panel offers only commands the domain actually has', () => {
  assert.match(management, /primaryBulk === 'archive' \? 'archive-outline' : 'refresh-outline'/);
  assert.match(management, /label="Delete"|label="Archive"|label=\{primaryBulk === 'archive' \? 'Archive' : 'Restore'\}/);
  // Reschedule and Pause were drawn but have no canonical command behind them.
  assert.doesNotMatch(management, /Reschedule|'Pause'/);
  // A restore that needs a schedule cannot be completed silently in a batch.
  assert.match(management, /result\.value\.outcome === 'schedule_required'/);
  assert.match(management, /needs a schedule before it can return/);
});

test('management shows no progress percentage the catalogue cannot supply', () => {
  assert.doesNotMatch(management, /displayProgress|%`|percent/i);
});

// ── the bottom-layer rule ────────────────────────────────────────────────────

test('the scrim fades from nothing to the ground on each drawn curve', () => {
  assert.equal(bottomLayerAlpha(0), 0);
  assert.equal(bottomLayerAlpha(-1), 0);
  // A screen fades later and softer: 65 % at 40 %, fully the ground by 76 %.
  assert.equal(Math.round(bottomLayerAlpha(0.4) * 100), 65);
  assert.equal(bottomLayerAlpha(0.76), 1);
  assert.equal(bottomLayerAlpha(1), 1);
  // A docked call to action has less room and must resolve sooner.
  assert.equal(Math.round(bottomLayerAlpha(0.34, 'cta') * 100), 72);
  assert.equal(bottomLayerAlpha(0.68, 'cta'), 1);
  assert.equal(bottomLayerAlpha(0.76, 'cta'), 1);
  // Monotonic on both: a band may never be lighter than the one above it.
  for (const curve of ['screen', 'cta'] as const) {
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const alpha = bottomLayerAlpha(step / 20, curve);
      assert.equal(alpha >= previous, true, `${curve} alpha fell at ${step / 20}`);
      previous = alpha;
    }
  }
});

test('the scrim is built from the ground colour without a gradient dependency', () => {
  assert.equal(colorWithAlpha('#DFE9E1', 0), 'rgba(223, 233, 225, 0)');
  assert.equal(colorWithAlpha('#DFE9E1', 0.7), 'rgba(223, 233, 225, 0.7)');
  assert.equal(colorWithAlpha('#FDF8F6', 1), 'rgba(253, 248, 246, 1)');
  // A colour it cannot decompose degrades safely rather than painting a wrong hue.
  assert.equal(colorWithAlpha('rgba(0,0,0,0.5)', 0.4), 'transparent');
  assert.equal(colorWithAlpha('rgba(0,0,0,0.5)', 1), 'rgba(0,0,0,0.5)');
  const packageJson = JSON.parse(source('package.json')) as { dependencies: Record<string, string> };
  assert.equal('expo-linear-gradient' in packageJson.dependencies, false);
  assert.equal('react-native-svg' in packageJson.dependencies, false);
});

test('the tab capsule leaves room for future modules and every screen clears it', () => {
  // Add is out of the capsule: Tasks and Finance already wait in the layout.
  assert.equal((tabs.match(/href: null/g) ?? []).length, 2);
  assert.match(planner, /Add stays out of the capsule/);
  assert.match(planner, /floatingAdd: \{ bottom: TAB_BAR_CLEARANCE \+ 12/);
  assert.match(planner, /addControl: \{ alignItems: 'center', borderRadius: 15, elevation: 8, height: 44/);
  assert.match(planner, /shadowRadius: 22, width: 44 \}/);
  assert.match(planner, /screenContent: \{ paddingBottom: TAB_BAR_CLEARANCE \+ 12 \+ 44 \+ 16 \}/);
  assert.match(planner, /<BottomScrim groundColor=\{theme\.today\.appSurface\} \/>/);
  // Every tabbed screen clears the bar, including the one with almost nothing in it.
  assert.match(source('app/(tabs)/more.tsx'), /paddingBottom: TAB_BAR_CLEARANCE \+ 22/);
  assert.match(source('src/ui/tab-bar.ts'), /TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT \+ TAB_BAR_INSET/);
});

test('floating bottom controls sit on the layer instead of an opaque bar', () => {
  assert.match(components, /export function BottomActionLayer/);
  assert.match(components, /bottomScrim: \{ bottom: 0, left: 0, position: 'absolute', right: 0 \}/);
  assert.match(components, /pointerEvents="none"/);
  // Management: 140 pt scrim carrying either the create action or the panel.
  assert.match(management, /<BottomActionLayer groundColor=\{theme\.today\.appSurface\} height=\{140\} inset=\{20\}>/);
  assert.doesNotMatch(management, /panel: \{[^}]*position: 'absolute'/);
  assert.match(management, /selectingContent: \{ gap: 14, paddingBottom: 150 \}/);
  // Create: the 1g button, 132 pt scrim, 20 pt inset, content clearing it by 18 pt.
  // Create's action is block 13 inside the sheet now, so it floats on no layer
  // of its own — and it never went back to an opaque footer either.
  assert.doesNotMatch(create, /BottomActionLayer|createFooter/);
});
