import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applicationVersion } from '../../src/config/version';

test('v0.5.9 release preparation exposes the requested displayed version and build', () => {
  assert.deepEqual(applicationVersion, {
    applicationName: 'LifePlanner',
    semanticVersion: '0.5.9',
    releaseStage: 'Alpha',
    buildNumber: 40,
  });
});

test('the badge in the app cannot disagree with the build in TestFlight', () => {
  const appConfig = JSON.parse(readFileSync('app.json', 'utf8')) as { expo: { version: string; ios: { buildNumber: string; bundleIdentifier: string } } };
  const eas = JSON.parse(readFileSync('eas.json', 'utf8')) as { cli: { appVersionSource: string }; build: Record<string, { autoIncrement?: boolean }> };
  assert.equal(appConfig.expo.version, '0.5.9');
  assert.equal(appConfig.expo.ios.buildNumber, '40');
  assert.equal(appConfig.expo.ios.bundleIdentifier, 'com.olegkotikov.lifeplanner.alpha');
  // `applicationVersion` is a frozen literal the More badge renders, so the
  // numbers EAS ships with have to come from the same committed files. Remote
  // versioning would have let EAS choose a build number the badge never sees, and
  // `autoIncrement` would have rewritten app.json behind the commit.
  assert.equal(eas.cli.appVersionSource, 'local');
  assert.equal(Object.values(eas.build).some((profile) => profile.autoIncrement === true), false);
  assert.equal(String(applicationVersion.buildNumber), appConfig.expo.ios.buildNumber);
  assert.equal(applicationVersion.semanticVersion, appConfig.expo.version);
});

test('v0.3.2.1 physical gate contains exactly 63 unclaimed checks', () => {
  const checklist = readFileSync('docs/UIV0321PhysicalIPhoneChecklist.md', 'utf8');
  const rows = checklist.match(/^\|\s*\d+\s*\|.*$/gm) ?? [];
  assert.equal(rows.length, 63);
  assert.equal(rows.every((row) => row.includes('| Not tested |')), true);
  assert.doesNotMatch(rows.join('\n'), /\|\s*(?:Passed|Failed|Needs improvement)\s*\|/i);
});

test('candidate presentation consumes canonical progress and root-only marker identity', () => {
  const surface = readFileSync('src/features/planner/presentation/habit-visual-components.tsx', 'utf8');
  const group = readFileSync('src/features/planner/presentation/habit-occurrence-group.tsx', 'utf8');
  const observation = readFileSync('src/features/planner/presentation/observation-entry-modal.tsx', 'utf8');
  const tokens = readFileSync('src/ui/theme/tokens.ts', 'utf8');
  const markerQuery = readFileSync('src/features/planner/application/occurrence/get-planner-date-summaries-for-range.ts', 'utf8');
  const rail = readFileSync('src/features/planner/presentation/planner-date-rail.tsx', 'utf8');
  assert.match(surface, /boundedDisplayProgress\(displayProgress\)/);
  assert.match(surface, /isReduceMotionEnabled/);
  assert.match(surface, /theme\.motion\.progress/);
  assert.match(group, /displayProgressOverride={plannerRoutineDisplayProgress\(group\)}/);
  assert.match(group, /theme\.motion\.compact/);
  assert.doesNotMatch(group, /qualified.*length|children\.filter/);
  assert.match(markerQuery, /root\.ordinaryParentHabitId !== null/);
  assert.match(markerQuery, /visualIdentity/);
  // v0.3.3 removes per-date markers from the rail. The bounded range read and its
  // root-only indicator query stay canonical; only the presentation is gone.
  assert.doesNotMatch(rail, /DateMarkerStrip|markerSlot/);
  // The rail carries nothing but the day: no markers and no progress dots.
  assert.doesNotMatch(rail, /styles\.dots|styles\.dot/);
  assert.doesNotMatch(rail, /getOccurrencesForDate|loadPlannerOccurrenceData/);
  assert.match(tokens, /compact: 180, progress: 200/);
  for (const shortcut of ['+1', '15 min', '30 min', '60 min', 'Custom']) assert.match(observation, new RegExp(shortcut.replace('+', '\\+')));
  assert.match(observation, /quantityQuickActions/);
  assert.doesNotMatch(observation, /Selected\s/);
});

test('Phase 5 Create stays one screen while Recovery 6C.2 gates Edit stages and preserves dirty-form protection', () => {
  const create = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
  const edit = readFileSync('src/features/planner/presentation/edit-habit-screen.tsx', 'utf8');
  const controls = readFileSync('src/features/planner/presentation/planner-form-controls.tsx', 'utf8');
  const identityControls = readFileSync('src/features/planner/presentation/habit-identity-controls.tsx', 'utf8');
  const identityModel = readFileSync('src/features/planner/presentation/habit-identity-picker-model.ts', 'utf8');
  const management = readFileSync('src/features/planner/presentation/all-habits-screen.tsx', 'utf8');
  assert.doesNotMatch(create, /STAGES = \['Identity', 'Plan', 'Tracking', 'Review'\]|<WizardShell/);
  // Edit is the create **sheet** now: the old form serves the template preview and
  // Restore, and the editor no longer renders any part of it.
  assert.match(edit, /<CreateItemScreen/);
  assert.doesNotMatch(edit, /WizardShell|EDIT_STAGES|<HabitFormScreen/);
  assert.doesNotMatch(create, /addListener\('beforeRemove'|Discard habit draft/);
  // The unsaved-changes guard lives in the form both modes render, once.
  assert.doesNotMatch(create, /addListener\('beforeRemove'|Discard habit draft/);
  assert.match(controls, /IMPORTANCE_STOPS/);
  // The tracking-type selector is retired with the Create redesign; the unit and
  // comparison controls stay, because Edit's locked legacy stage still needs them.
  assert.doesNotMatch(controls, /TrackingModeSelector/);
  assert.match(controls, /UnitSelectionSheet/);
  assert.match(controls, /PrioritySegmentedControl/);
  assert.match(create, /accessibilityLabel="Name"/);
  assert.doesNotMatch(create, /autoFocus/);
  assert.match(create, /const canCreate = !saving && name\.trim\(\) !== ''/);
  assert.match(identityControls, /parse: parseHabitEmoji/);
  assert.match(identityModel, /boundary\.parse\(value, 'iconEmoji'\)/);
  assert.doesNotMatch(create, /Nothing is written until Save Habit succeeds/);
  // Creation is one floating action, not a header Alert. It names the segment it
  // was pressed on now that Manage carries tasks as well as habits.
  assert.match(management, /accessibilityLabel=\{createLabel\}/);
  assert.match(management, /'New task' : typeScope === 'habits' \? 'New habit' : 'New'/);
  // The five-chip horizontal scroller went, and so did the three facets that
  // replaced it: the segment splits by type and what is broken is pinned instead.
  assert.doesNotMatch(management, /'everything', 'Everything'|'routines', 'Routines'|'broken', 'Broken'/);
});

test('candidate exposes only recursive permanent deletion in normal Planner UI', () => {
  const presentationFiles = [
    'src/features/planner/presentation/all-habits-screen.tsx',
    'src/features/planner/presentation/archived-habits-screen.tsx',
    'src/features/planner/presentation/habit-detail-screen.tsx',
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
  const confirmation = readFileSync('src/features/planner/presentation/planner-delete-confirmation.ts', 'utf8');
  assert.equal((presentationFiles.match(/previewDeleteHabitChain/g) ?? []).length >= 3, true);
  assert.equal((presentationFiles.match(/deleteHabitChain/g) ?? []).length >= 3, true);
  assert.doesNotMatch(presentationFiles, /permanentlyDeleteHabit|Keep children|Delete parent only/);
  assert.match(confirmation, /Delete routine/);
  assert.match(confirmation, /complete routine and its history/);
  assert.match(confirmation, /This cannot be undone/);
});

test('candidate uses edge-only native back gestures on scroll-heavy Planner routes', () => {
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  for (const route of ['planner/create', 'planner/habits/index', 'planner/habits/[id]', 'planner/habits/archived', 'planner/edit/[id]']) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(layout, new RegExp(`${escaped}.*fullScreenGestureEnabled: false`));
  }
  assert.doesNotMatch(layout, /fullScreenGestureEnabled: true/);
});
