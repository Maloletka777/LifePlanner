import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applicationVersion } from '../../src/config/version';
import type { DeleteHabitChainImpact, SelectedDatePlannerRootGroup } from '../../src/features/planner';
import { getLifePlannerTheme, habitAccentTokenKeys, SWITCH_TRAVEL } from '../../src/ui/theme/tokens';
import { COLOR_THEME_IDS } from '../../src/ui/theme/color-themes';
import { displayProgressFromFraction } from '../../src/features/planner/application/occurrence/get-planner-occurrences-for-date';
import { resolveAppearance } from '../../src/ui/theme/appearance';
import { filterHabitIconOptions } from '../../src/features/planner/presentation/habit-identity-picker-model';
import { deleteChainConfirmationAction, deleteChainConfirmationMessage, deleteChainConfirmationTitle } from '../../src/features/planner/presentation/planner-delete-confirmation';
import { composePlannerPresentationGroups } from '../../src/features/planner/presentation/planner-presentation-groups';

import './app-variant.cases';
import './appearance-themes.cases';
import './motion.cases';

test('semantic theme resolves distinct, complete light and dark appearances', () => {
  const light = getLifePlannerTheme('light');
  const dark = getLifePlannerTheme('dark');

  assert.equal(light.dark, false);
  assert.equal(dark.dark, true);
  assert.notEqual(light.colors.background, dark.colors.background);
  assert.notEqual(light.colors.accent, dark.colors.accent);
  for (const role of ['materialSurface', 'plannerAccent', 'taskAccent', 'financeAccent', 'analyticsAccent', 'shadow', 'progressTrack', 'progressFill'] as const) {
    assert.ok(light.colors[role]);
    assert.ok(dark.colors[role]);
  }
});

test('shared interaction tokens preserve accessible minimums', () => {
  const theme = getLifePlannerTheme('light');
  assert.equal(theme.layout.control.minimumTouchTarget, 44);
  assert.ok(theme.layout.control.standardHeight >= 44);
  assert.ok(theme.motion.fast < theme.motion.standard);
  assert.ok(theme.motion.standard < theme.motion.deliberate);
});

test('canonical and legacy habit accents resolve every semantic surface in Light and Dark', () => {
  assert.equal(habitAccentTokenKeys.length, 21);
  const light = getLifePlannerTheme('light');
  const dark = getLifePlannerTheme('dark');
  for (const key of habitAccentTokenKeys) {
    for (const role of ['iconBackground', 'iconForeground', 'surface', 'progressSurface', 'border', 'selectedSwatch', 'childSurface'] as const) {
      assert.ok(light.habitAccents[key][role]);
      assert.ok(dark.habitAccents[key][role]);
      assert.notEqual(light.habitAccents[key][role], dark.habitAccents[key][role]);
    }
    assert.notEqual(light.habitAccents[key].surface, light.colors.background);
    assert.notEqual(dark.habitAccents[key].surface, dark.colors.background);
  }
});

test('Planner read models expose bounded presentation progress without React formulas', () => {
  assert.equal(displayProgressFromFraction({ numerator: 0n, denominator: 1n }), 0);
  assert.equal(displayProgressFromFraction({ numerator: 1n, denominator: 2n }), 0.5);
  assert.equal(displayProgressFromFraction({ numerator: 1n, denominator: 3n }), 0.3333);
  assert.equal(displayProgressFromFraction({ numerator: 7n, denominator: 7n }), 1);
  const surface = readFileSync('src/features/planner/presentation/habit-visual-components.tsx', 'utf8');
  assert.match(surface, /displayProgress/);
  assert.match(surface, /Math\.max\(0, Math\.min\(1, value\)\)/);
  assert.match(surface, /isReduceMotionEnabled/);
  assert.doesNotMatch(surface, /completionCredit|childCompletedCount|calculatePlannerGroupProgress/);
});

test('completion is green, and structure is not a state', () => {
  // **Reversed by PD-PLATE-004.** Completion used to be the accent, which is why a
  // progress bar, a check and a selected segment were all one colour. Green means
  // done and nothing else now, so `success` is its own value and the structural
  // colour is not a state at all.
  for (const themeId of COLOR_THEME_IDS) {
    const { colors, palette } = getLifePlannerTheme(themeId);
    assert.equal(colors.plannerAccent, colors.accent);
    assert.equal(colors.success, palette.done);
    assert.notEqual(colors.success, colors.accent);
    assert.notEqual(colors.accent, colors.danger);
    assert.notEqual(colors.accent, colors.warning);
  }
});

test('displayed version comes from one central source', () => {
  assert.deepEqual(applicationVersion, {
    applicationName: 'LifePlanner',
    semanticVersion: '0.5.9',
    releaseStage: 'Alpha',
    buildNumber: 40,
  });
});

test('the appearance is inherited from the phone, and there is nothing to choose', () => {
  // **Reversed by PD-APPEARANCE-007.** The pin and the picker went together: five
  // palettes existed *because* the switch was never read, so reading it removes the
  // reason for them. The route that carried the choice is gone from the root stack.
  assert.equal(resolveAppearance('dark'), 'dark');
  assert.equal(resolveAppearance('light'), 'light');
  assert.equal(resolveAppearance(null), 'light');

  const provider = readFileSync('src/ui/theme/appearance-provider.tsx', 'utf8');
  const root = readFileSync('app/_layout.tsx', 'utf8');

  assert.match(provider, /useColorScheme/);
  assert.doesNotMatch(provider, /readStoredColorThemeId|writeStoredColorThemeId/);
  assert.doesNotMatch(root, /settings\/appearance/);
  // Navigation's own theme and the status bar still follow ours, or the frame
  // around a pushed screen is the wrong ground.
  assert.match(root, /dark: lifePlannerTheme\.dark/);
  assert.match(root, /<StatusBar style=\{lifePlannerTheme\.dark \? 'light' : 'dark'\}/);
});

test('date UI uses the month grid and reserves the native wheel for time only', () => {
  const source = readFileSync('src/features/planner/presentation/planner-date-time-controls.tsx', 'utf8');
  assert.match(source, /plannerMonthGrid/);
  assert.doesNotMatch(source, /mode="date"/);
  assert.match(source, /mode="time"/);
  assert.match(source, /themeVariant={theme\.dark \? 'dark' : 'light'}/);
  assert.match(source, /hiddenActions/);
});

test('date markers use one bounded nine-day range request', () => {
  const state = readFileSync('src/features/planner/presentation/planner-date-state.ts', 'utf8');
  const provider = readFileSync('src/features/planner/presentation/planner-provider.tsx', 'utf8');
  const query = readFileSync('src/features/planner/application/occurrence/get-planner-date-summaries-for-range.ts', 'utf8');
  const rail = readFileSync('src/features/planner/presentation/planner-date-rail.tsx', 'utf8');
  assert.match(state, /PLANNER_MARKER_RANGE_RADIUS = 4/);
  assert.match(provider, /markerRangeRequest\(/);
  assert.match(query, /loadPlannerOccurrenceDataRange\(/);
  assert.match(query, /visualIdentity/);
  // v0.3.3 removes per-date identity markers; the read model and its indicators stay.
  assert.doesNotMatch(rail, /HabitIdentityMark/);
  assert.match(rail, /summary\?\.scheduled/);
  assert.match(rail, /summary\?\.completed/);
  assert.doesNotMatch(rail, /markerSlot/);
  assert.doesNotMatch(provider, /getOccurrencesForDate\(\{ selectedLocalDate: date/);
});

test('review copy is user-facing and management deletion remains confirmed', () => {
  const review = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
  const management = readFileSync('src/features/planner/presentation/all-habits-screen.tsx', 'utf8');
  const confirmation = readFileSync('src/features/planner/presentation/planner-delete-confirmation.ts', 'utf8');
  assert.doesNotMatch(review, /one transaction/i);
  assert.match(management, /deleteChainConfirmationTitle/);
  assert.match(confirmation, /complete routine and its history/);
  assert.match(confirmation, /This cannot be undone/);
  assert.match(management, /confirmed: true/);
});

test('recursive delete confirmation names the root, linked count, consequence, and safe action', () => {
  const impact = {
    rootHabitId: 'root',
    rootHabitName: 'Morning routine',
    orderedTargetHabitIds: ['root', 'child-a', 'child-b'],
    targets: [
      { habitId: 'root', name: 'Morning routine', depth: 0, boundaryTimezone: 'Europe/London' },
      { habitId: 'child-a', name: 'Water', depth: 1, boundaryTimezone: 'Europe/London' },
      { habitId: 'child-b', name: 'Stretch', depth: 1, boundaryTimezone: 'Europe/London' },
    ],
    targetCount: 3,
    relationshipCount: 2,
    observationCount: 8,
    correctionCount: 1,
    visualIdentityCount: 3,
    unrelatedPreservedCount: 4,
  } as unknown as DeleteHabitChainImpact;
  assert.equal(deleteChainConfirmationTitle(impact), 'Delete “Morning routine” and 2 linked habits?');
  assert.equal(deleteChainConfirmationAction(impact), 'Delete routine');
  assert.match(deleteChainConfirmationMessage(impact), /Linked habits: Water, Stretch/);
  assert.match(deleteChainConfirmationMessage(impact), /8 observation\/history rows and 1 correction/);
  assert.match(deleteChainConfirmationMessage(impact), /cannot be undone/);
});

test('date rail uses native virtualized scrolling without a custom parent gesture', () => {
  const source = readFileSync('src/features/planner/presentation/planner-date-rail.tsx', 'utf8');
  // An Animated one, because the pill reads the scroll offset natively.
  assert.match(source, /<Animated\.FlatList/);
  assert.match(source, /snapToInterval={cellWidth}/);
  assert.match(source, /onScrollBeginDrag={beginNativeScroll}/);
  assert.match(source, /onMomentumScrollEnd={endNativeMomentum}/);
  assert.match(source, /initialScrollIndex={initialIndex}/);
  assert.match(source, /removeClippedSubviews={false}/);
  assert.doesNotMatch(source, /GestureDetector|Gesture\.Exclusive|Gesture\.Pan|PanResponder/);
  assert.doesNotMatch(source, /onPressIn|onTouchStart/);
  assert.doesNotMatch(source, /draggingRef|if \(.*drag.*\) return/);
});

test('completion controls avoid double rings and identity resolves semantic palettes', () => {
  const control = readFileSync('src/features/planner/presentation/habit-occurrence-row.tsx', 'utf8');
  const components = readFileSync('src/ui/components/index.tsx', 'utf8');
  assert.doesNotMatch(control, /ellipse-outline/);
  assert.match(control, /PRIORITY_WORDS/);
  assert.match(control, /lock-closed-outline/);
  assert.match(control, /shield-checkmark-outline/);
  assert.match(control, /timer-outline/);
  assert.match(control, /styles\.controlVisual/);
  assert.match(control, /control: \{ alignItems: 'center', flexShrink: 0, height: 44/);
  assert.match(components, /const size = child \? 28 : 40/);
  // The hash fallback is **one key per category** now: with the twenty-one accent
  // keys resolved to six hues, seven fallbacks drew two of them twice.
  assert.match(components, /theme\.identityFallbacks/);
  for (const themeId of COLOR_THEME_IDS) {
    const { identityFallbacks, habitAccents } = getLifePlannerTheme(themeId);
    assert.equal(identityFallbacks.length, 6);
    assert.equal(new Set(identityFallbacks.map(([background]) => background)).size, 6);
    for (const [background, foreground] of identityFallbacks) {
      assert.notEqual(background, foreground);
    }
    assert.deepEqual(identityFallbacks[0], [habitAccents.amber.iconBackground, habitAccents.amber.iconForeground]);
  }
});

test('visual identity pickers cover the expanded catalogue, direct palette, emoji, and persistence boundary', () => {
  const picker = readFileSync('src/features/planner/presentation/habit-identity-controls.tsx', 'utf8');
  const create = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
  const domain = readFileSync('src/features/planner/domain/identity/habit-visual-identity.ts', 'utf8');
  assert.equal(filterHabitIconOptions('', 'All').length, 94);
  assert.equal(filterHabitIconOptions('timer', 'All').some(({ key }) => key === 'duration'), true);
  assert.equal(filterHabitIconOptions('', 'Fitness').some(({ key }) => key === 'workout'), true);
  assert.match(picker, /HABIT_ACCENT_OPTIONS\.map/);
  assert.match(picker, /selectedSwatch/);
  assert.match(picker, /accessibilityState=\{\{ checked:/);
  assert.match(picker, /width >= 430.*\? 4 : 3/);
  assert.match(picker, /title="Cancel"/);
  assert.match(picker, /title="Done"/);
  assert.match(picker, /Automatic icon/);
  const stages = readFileSync('src/features/planner/presentation/habit-form-stages.tsx', 'utf8');
  assert.match(stages, /iconPickerOpen \? <HabitIconPicker/);
  assert.match(picker, /validateHabitEmojiInput/);
  assert.match(stages, /HabitVisualPreview/);
  // Create no longer offers new emoji entry; stored emoji still renders (PD-IDENTITY-002).
  assert.doesNotMatch(create, /iconEmoji: /);
  assert.match(domain, /HABIT_ICON_KEYS/);
  assert.match(picker, /title="Emoji"/);
});

test('presentation groups nest ordinary descendants without changing canonical groups', () => {
  const group = (rootHabitId: string, ordinaryParentHabitId: string | null) => ({
    rootHabitId,
    rows: [{ habitId: rootHabitId, ordinaryParentHabitId }],
    progress: { displayProgress: rootHabitId === 'root' ? 0.5 : 0 },
  }) as unknown as SelectedDatePlannerRootGroup;
  const root = group('root', null);
  const child = group('child', 'root');
  const grandchild = group('grandchild', 'child');
  const secondRoot = group('second-root', null);
  const result = composePlannerPresentationGroups([root, child, grandchild, secondRoot]);
  assert.deepEqual(result.map(({ root: item }) => item.rootHabitId), ['root', 'second-root']);
  assert.deepEqual(result[0]?.ordinaryChildren.map(({ rootHabitId }) => rootHabitId), ['child', 'grandchild']);
  assert.equal(result[0]?.root, root);
  assert.equal(result[0]?.root.progress.displayProgress, 0.5);
});

test('typed iconography and safe interactive navigation stay presentation-only', () => {
  const icons = readFileSync('src/features/planner/presentation/planner-iconography.ts', 'utf8');
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  const edit = readFileSync('src/features/planner/presentation/edit-habit-screen.tsx', 'utf8');
  // The eight template icons went with the catalogue they named. The registered
  // symbols they were drawn from are untouched: stored identity still renders.
  assert.doesNotMatch(icons, /TEMPLATE_ICONOGRAPHY|templateIconography/);
  assert.match(icons, /TRACKING_ICONOGRAPHY/);
  assert.match(icons, /MODULE_ICONOGRAPHY/);
  assert.doesNotMatch(icons, /Math\.random|emoji/i);
  for (const route of ['planner/create', 'planner/habits/index', 'planner/habits/\\[id\\]', 'planner/habits/archived', 'planner/edit/\\[id\\]']) {
    assert.match(layout, new RegExp(`${route}.*fullScreenGestureEnabled: false`));
  }
  assert.doesNotMatch(layout, /fullScreenGestureEnabled: true/);
  // Edit is the **create sheet** in its other mode; the wizard shell is gone and
  // so is the old form it was replaced by.
  assert.match(edit, /<CreateItemScreen/);
  assert.doesNotMatch(edit, /WizardShell|<HabitFormScreen/);
  // The locked legacy stage left the surface with the old form. What it existed to
  // protect survives: the tracking definition is carried through untouched, so a
  // saved metric habit is never converted by an edit.
  assert.doesNotMatch(edit, /lockedMode|EDIT_STAGES = \['Identity', 'Plan', 'Tracking', 'Review'\]/);
  assert.match(edit, /trackingDraftFromDefinition\(configuration\.tracking\.definition\)/);
  // The unsaved-changes guard lives in the sheet both modes render, once.
  assert.doesNotMatch(readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8'), /addListener\('beforeRemove'|Discard habit draft/);
  // The hierarchy card and the deletion-impact card are gone with the wizard: this
  // screen changes the rules, and the impact is now the one number in the alert.
  assert.doesNotMatch(edit, /HabitGroupSurface|Permanent deletion impact/);
  assert.match(edit, /deleteChainConfirmationTitle/);
  assert.match(edit, /deleteChainConfirmationMessage/);
  assert.match(edit, /archiveHabit\(/);
});

test('the swipe keys are uncovered by the row rather than switched on', () => {
  const components = readFileSync('src/ui/components/index.tsx', 'utf8');
  // `Swipeable` parks its action container at `translateX: -10000` and returns it to
  // `0` on `inputRange: [0, Number.MIN_VALUE]` — a switch, not a reveal — because it
  // expects the caller to animate from the `progress` it passes in. Ignoring that,
  // **and** wrapping a row that had no ground of its own, meant all three keys were
  // visible through the row at the first pixel of the drag.
  assert.match(components, /renderRightActions=\{\(progress\) =>/);
  assert.match(components, /const ground = cards \? theme\.today\.dashboardSurface : theme\.colors\.surface;/);
  assert.match(components, /style=\{\{ backgroundColor: ground \}\}>\{children\}<\/View>/);
  // The travel is a finishing move: the row is the mask, so the keys must not lag it.
  assert.match(components, /const SWIPE_KEY_SETTLE = 14;/);
  assert.match(components, /outputRange: \[SWIPE_KEY_SETTLE, 0\], extrapolate: 'clamp'/);
});

test('a refresh keeps the habit detail it already had, and a new subject does not', () => {
  const provider = readFileSync('src/features/planner/presentation/planner-provider.tsx', 'utf8');
  const editor = readFileSync('src/features/planner/presentation/edit-habit-screen.tsx', 'utf8');
  // The editor answers a loading detail by returning a `LoadingState` instead of the
  // form, so clearing to `data: null` on every `refreshRevision` tore the editor down
  // and rebuilt it on every subtask written — which is why the screen blanked and
  // reloaded, and why the list could not be animated at all.
  assert.match(editor, /if \(query\.status === 'loading'\) return <Screen><LoadingState/);
  assert.match(provider, /if \(shownSubject\.current !== subject\) setState\(\{ status: 'loading', data: null, error: null \}\);/);
  assert.match(provider, /const subject = `\$\{habitId\} \$\{asOfLocalDate\}`;/);
  // Now that the tree survives a write, the list is what animates.
  assert.match(editor, /function animateLines\(\)/);
  assert.match(editor, /if \(reduceMotion\) return;/);
  assert.match(editor, /animateLines\(\);\s*\n\s*refreshOccurrences\(\);/);
});

test('the Anytime switch states its travel once, so its two copies cannot drift', () => {
  // **They already had.** The knob's travel is `track − padding·2 − knob`, which is
  // `50 − 4 − 26 = 20`, and one of the two sheets that draw this switch carried **22** — so
  // in that sheet the knob overhung its own track by two points whenever the switch was on.
  // Two copies of one control is why: the number was written down twice and only corrected
  // once. Derived, it cannot be wrong while the three sizes it comes from are right.
  assert.equal(SWITCH_TRAVEL, 20);
  for (const file of [
    'src/features/planner/presentation/create-habit-sheets.tsx',
    'src/features/planner/presentation/time-drum-sheet.tsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /marginLeft: anyTime \? SWITCH_TRAVEL : 0/, `${file} states its own travel`);
    // The track and the knob still have to be the sizes the travel was derived from.
    assert.match(source, /switchTrack: \{ borderRadius: 15, flexDirection: 'row', height: 30, padding: 2, width: 50 \}/);
    assert.match(source, /switchKnob: \{[\s\S]{0,200}height: 26,[\s\S]{0,120}width: 26 \}/);
  }
});
