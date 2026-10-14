import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';


import './child-draft-collection.cases';
import { getReactNavigationConfig } from 'expo-router/build/getReactNavigationConfig';
import { getRoutes } from 'expo-router/build/getRoutes';
import { resolveHref } from 'expo-router/build/link/href';

import './create-item-sheet.cases';
import './day-blocks.cases';
import './day-journal.cases';
import './growth-tab.cases';
import './manage-items.cases';
import './overview.cases';
import './routine-growth.cases';
import './routine-diagnosis.cases';
import './routine-awards.cases';
import './planner-action-runner.cases';
import './reminder-notifications.cases';
import './time-drum.cases';
import './v033-create-habit.cases';
import './v033-create-identity-recovery.cases';
import './v033-definitive-planner.cases';
import './v033-identity-picker.cases';
import './v033-management-modules.cases';
import './v033-presentation-seams.cases';
import './v033-pre-active-ui-recovery.cases';
import './v033-planner-hierarchy.cases';
import './v033-planner-shell.cases';
import './v033-shell-routes.cases';

import {
  createExactQuantity,
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerTimezone,
  type PlannerId,
  type PlannerLocalDate,
  type PlannerTimezone,
} from '../../../src/features/planner/domain';
import type {
  SelectedDatePlannerOccurrenceRow,
  SelectedDatePlannerReadModel,
} from '../../../src/features/planner/application';
import {
  buildCreateDependencyCommand,
  buildCreateHabitCommand,
  buildScheduleDefinition,
  buildTrackingDefinition,
  actualTargetText,
  createDefaultScheduleDraft,
  createDefaultTrackingDraft,
  currentEntryValueText,
  durationDraftToSeconds,
  formatQuantityProgressInUnit,
  habitCatalogueNavigation,
  habitDetailNavigation,
  habitDetailQueryInput,
  managementQueryDate,
  observationModalSaveDisabled,
  observationValueText,
  occurrenceAction,
  parsePlannerDecimalInput,
  parsePlannerDateEntry,
  constrainPlannerDateEntry,
  movePlannerMonth,
  plannerMonthGrid,
  plannerManagementActionNames,
  nextOpenSwipeRow,
  isCurrentDateRailSettlement,
  nativeDateRailDate,
  nativeDateRailDayOffset,
  plannerDateRailCenterIndex,
  plannerDateRailInitialIndex,
  trackingSummary,
  plannerFailureMessage,
  quantityObservationFromDraft,
  quantityQuickActions,
  resolveHabitDetailRouteParams,
  OBSERVATION_MODAL_KEYBOARD_POLICY,
  statusPresentation,
  selectedDateFailureMessage,
  type ActiveRangeDraft,
  type DependencyDraft,
  type ParentHabitDraft,
  type ScheduleDraft,
  type TrackingDraft,
} from '../../../src/features/planner/presentation/ui-adapters';
import {
  createPlannerDateState,
  reducePlannerDateState,
} from '../../../src/features/planner/presentation/planner-date-state';
import {
  createPlannerRevisionRequestCoalescer,
  plannerCatalogueCacheKey,
  plannerChecklistCacheKey,
  plannerClosureCacheKey,
  isLatestPlannerRequest,
} from '../../../src/features/planner/presentation/planner-query-coordinator';
import {
  compatibleUnitGroups,
  IMPORTANCE_STOPS,
} from '../../../src/features/planner/presentation/planner-form-control-model';


test('Planner date entry accepts explicit complete formats and rejects calendar rollover', () => {
  for (const [input, value] of [
    ['220926', '2026-09-22'],
    ['22092026', '2026-09-22'],
    ['22.09.2026', '2026-09-22'],
    ['22/09/2026', '2026-09-22'],
    ['2026-09-22', '2026-09-22'],
    ['29022028', '2028-02-29'],
  ] as const) {
    const result = parsePlannerDateEntry(input);
    assert.equal(result.ok, true, input);
    if (result.ok) {
      assert.equal(result.value, value);
      assert.equal(result.display, value.split('-').reverse().join('.'));
    }
  }

  for (const input of ['2209', '31022026', '32012026', '31042026', '29022025', '00012026', '01132026', '21072026545454']) {
    assert.equal(parsePlannerDateEntry(input).ok, false, input);
  }
});


test('manual date guard accepts eight meaningful digits and refuses a ninth or excessive paste', () => {
  assert.deepEqual(constrainPlannerDateEntry('21.07.202', '21.07.2026'), { value: '21.07.2026', excessive: false });
  assert.deepEqual(constrainPlannerDateEntry('21.07.2026', '21.07.20265'), { value: '21.07.2026', excessive: true });
  assert.deepEqual(constrainPlannerDateEntry('21.07.2026', '21.07.2026545454'), { value: '21.07.2026', excessive: true });
  assert.deepEqual(constrainPlannerDateEntry('21.07.2026', '2026-09-22'), { value: '2026-09-22', excessive: false });
});


test('manual date entry progressively groups digits and expands a six-digit year', () => {
  assert.equal(constrainPlannerDateEntry('', '2').value, '2');
  assert.equal(constrainPlannerDateEntry('2', '25').value, '25');
  assert.equal(constrainPlannerDateEntry('25', '250').value, '25.0');
  assert.equal(constrainPlannerDateEntry('25.0', '2506').value, '25.06');
  assert.equal(constrainPlannerDateEntry('25.06', '25062').value, '25.06.2');
  assert.equal(constrainPlannerDateEntry('25.06.2', '250626').value, '25.06.2026');
});


test('month calendar has stable geometry across leap and year boundaries', () => {
  const february2025 = plannerMonthGrid(2025, 2);
  const february2028 = plannerMonthGrid(2028, 2);
  assert.equal(february2025.length, 42);
  assert.equal(february2025.filter(Boolean).length, 28);
  assert.equal(february2028.filter(Boolean).length, 29);
  assert.equal(february2028.includes(localDate('2028-02-29')), true);
  assert.deepEqual(movePlannerMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(movePlannerMonth(2026, 12, 1), { year: 2027, month: 1 });
});


test('management swipe contracts are contextual and keep only one row open', () => {
  assert.deepEqual(plannerManagementActionNames('active'), ['edit', 'archive', 'delete']);
  assert.deepEqual(plannerManagementActionNames('active', true), ['repair', 'archive', 'delete']);
  assert.deepEqual(plannerManagementActionNames('archived'), ['restore', 'delete']);
  assert.equal(nextOpenSwipeRow(null, { type: 'open', rowId: 'a' }), 'a');
  assert.equal(nextOpenSwipeRow('a', { type: 'open', rowId: 'b' }), 'b');
  assert.equal(nextOpenSwipeRow('b', { type: 'scroll' }), null);
});


test('native date rail maps fixed-cell offsets to one canonical day each', () => {
  const cellWidth = 50;
  const initialIndex = plannerDateRailInitialIndex();
  const initialOffset = initialIndex * cellWidth;
  assert.equal(plannerDateRailCenterIndex(), 365);
  assert.equal(initialIndex, 362);
  assert.equal(nativeDateRailDayOffset(initialOffset, cellWidth), 0);
  assert.equal(nativeDateRailDayOffset(initialOffset + cellWidth, cellWidth), 1);
  assert.equal(nativeDateRailDayOffset(initialOffset - cellWidth, cellWidth), -1);
  assert.equal(nativeDateRailDayOffset(initialOffset + cellWidth * 7, cellWidth), 7);
  assert.equal(nativeDateRailDayOffset(Number.NaN, cellWidth), 0);
});


test('native date rail crosses month and year boundaries without permissive rollover', () => {
  const initialOffset = plannerDateRailInitialIndex() * 50;
  assert.equal(nativeDateRailDate(localDate('2026-01-31'), initialOffset + 50, 50), '2026-02-01');
  assert.equal(nativeDateRailDate(localDate('2026-12-31'), initialOffset + 50, 50), '2027-01-01');
  assert.equal(nativeDateRailDate(localDate('2028-03-01'), initialOffset - 50, 50), '2028-02-29');
});


test('native date rail ignores stale settlement results after selection changes', () => {
  const anchor = localDate('2026-07-21');
  assert.equal(isCurrentDateRailSettlement(anchor, anchor, 4, 4), true);
  assert.equal(isCurrentDateRailSettlement(anchor, localDate('2026-07-22'), 4, 4), false);
  assert.equal(isCurrentDateRailSettlement(anchor, anchor, 3, 4), false);
});


test('Planner date state keeps browsing, selection, and marker range independent', () => {
  const initial = createPlannerDateState(localDate('2026-07-21'));
  const browsed = reducePlannerDateState(initial, {
    type: 'browse',
    railAnchorDate: localDate('2026-07-28'),
  });
  assert.equal(browsed.selectedDate, '2026-07-21');
  assert.equal(browsed.railAnchorDate, '2026-07-28');
  assert.deepEqual(browsed.visibleDateRange, {
    startDate: '2026-07-24',
    endDate: '2026-08-01',
  });

  // 30 July is one of the seven days the rail is showing around 28 July, so it is
  // selected where it stands: the rail holds still and one pill travels to it.
  const selected = reducePlannerDateState(browsed, {
    type: 'select',
    selectedDate: localDate('2026-07-30'),
  });
  assert.equal(selected.selectedDate, '2026-07-30');
  assert.equal(selected.railAnchorDate, '2026-07-28');
  assert.deepEqual(selected.visibleDateRange, browsed.visibleDateRange);
  assert.equal(reducePlannerDateState(selected, {
    type: 'select',
    selectedDate: localDate('2026-07-30'),
  }), selected);

  // A date the rail is not showing re-anchors it, and the pill flies in.
  const jumped = reducePlannerDateState(selected, {
    type: 'select',
    selectedDate: localDate('2026-08-14'),
  });
  assert.equal(jumped.selectedDate, '2026-08-14');
  assert.equal(jumped.railAnchorDate, '2026-08-14');

  const today = reducePlannerDateState(selected, {
    type: 'today',
    today: localDate('2026-07-21'),
  });
  assert.equal(today.selectedDate, '2026-07-21');
  assert.equal(today.railAnchorDate, '2026-07-21');
});


const provider = readFileSync('src/features/planner/presentation/planner-provider.tsx', 'utf8');

test('the fourth query is prepared like the other three, and answers only its own question', () => {
  // **Measured from `тест6.MP4`, frames 108–126.** A page turn drew the *new* day's headings
  // with the *old* day's ticks for four frames, then corrected itself — «задачи мерцают и
  // исчезают». Four queries feed one page; three had a cache, a `peek` and a place in the
  // prefetch, and `useHabitClosureRules` had none of them. It also returned whatever it had
  // last been told **whatever it had been asked about**, so a turn onto a different set of
  // items kept the previous set's rules — and «closes by its checklist» decides whether a
  // row reads as done.

  // The rule is a property of the items and **not** of the date, which is why this query
  // exists separately at all: keyed by the date too, it would reload on every page turn.
  assert.equal(plannerClosureCacheKey(['b', 'a']), plannerClosureCacheKey(['a', 'b']),
    'the order the items arrive in is not part of the question');
  assert.notEqual(plannerClosureCacheKey(['a']), plannerClosureCacheKey(['a', 'b']));
  assert.equal(plannerClosureCacheKey([]), '', 'no items is a question with an empty answer');

  // Coalesced and retained like its three neighbours, so a warm set costs no read.
  assert.match(provider, /const closureRequests = createPlannerRevisionRequestCoalescer</);
  assert.match(provider, /closureRequests\.peek\(\{ revision: refreshRevision, key \}\)/);
  // Warmed **in the prefetch**, beside the checklists, where the item set is already known.
  assert.match(provider, /await closureRequest\(getHabitClosureRules, refreshRevision, habitIds\);/);
  // And never applied to another set's items: absent is the honest answer while the
  // question is outstanding, and absent already meant «closes by hand» everywhere else.
  assert.match(provider, /return held\.key === key\s*\?\s*Object\.freeze\(\{ ready: held\.answered, rules: held\.rules \}\)\s*:\s*Object\.freeze\(\{ ready: false, rules: NO_CLOSURE_RULES \}\);/);
  // **«Absent» and «not asked yet» are the same map**, so the answer carries whether it is
  // about these items at all — a screen that cannot tell them apart draws a day it does not
  // yet know.
  assert.match(provider, /ready: boolean;/);
  assert.match(provider, /if \(key === ''\) return Object\.freeze\(\{ ready: true, rules: NO_CLOSURE_RULES \}\);/);
  assert.doesNotMatch(provider, /\n  return rules;\n\}/, 'the unkeyed answer may not come back');
});

test('a day’s marks are keyed to the day, so they cannot be shown under another one', () => {
  // **Everything that marks a row is keyed by what it describes.** The rows come from the
  // day's occurrences, which are prefetched; the ticks, the task/habit split and the
  // reminder times come from three other queries that could only begin once the day had
  // landed — and whose state survived every change of date, because it was written only
  // in the `then`. A page turn therefore kept the previous day's marks, and where two days
  // share items it kept them indefinitely.
  assert.notEqual(
    plannerChecklistCacheKey(['a', 'b'], '2026-08-05'),
    plannerChecklistCacheKey(['a', 'b'], '2026-08-06'),
    'the same items on another day are a different answer',
  );
  assert.equal(
    plannerChecklistCacheKey(['b', 'a'], '2026-08-05'),
    plannerChecklistCacheKey(['a', 'b'], '2026-08-05'),
    'and the order they arrive in is not part of the question',
  );
  assert.notEqual(
    plannerChecklistCacheKey(['a'], '2026-08-05'),
    plannerChecklistCacheKey(['a', 'b'], '2026-08-05'),
  );
  // The catalogue is «as of» a date and decides which rows are tasks at all.
  assert.notEqual(
    plannerCatalogueCacheKey('', 'active', '2026-08-05'),
    plannerCatalogueCacheKey('', 'active', '2026-08-06'),
  );
  assert.notEqual(plannerCatalogueCacheKey('', 'active', '2026-08-05'), plannerCatalogueCacheKey('', 'archived', '2026-08-05'));

  // Held beside the state rather than merged into it, or the query stops being a
  // discriminated union and every consumer loses `error` being a string exactly when the
  // status is `error` — which is how the first attempt broke two other screens.
  assert.match(provider, /interface Held<T> \{[\s\S]{0,40}readonly key: string;[\s\S]{0,40}readonly query: ManagementQueryState<T>;/);
  assert.match(provider, /held\.key === key \? held\.query : PENDING/);
  // And the prefetch warms them too, in the order they become knowable: the day, then the
  // catalogue, then the checklists — which need the item set the day just produced.
  assert.match(provider, /const habitIds = day\.value\.rootGroups\.map\(\(group\) => group\.rootHabitId\);/);
  assert.match(provider, /await checklistRequest\(getHabitChecklists, refreshRevision, habitIds, date\);/);
});

test('the coordinator retains days only when asked, and only for the live revision', async () => {
  // **Retention is opt-in and this is what it buys.** Without it a prefetch is pointless:
  // the entry is deleted the instant its promise settles, so warming a day costs a query
  // and keeps nothing. The default above is unchanged, which is why both tests exist.
  let calls = 0;
  const load = async () => { calls += 1; return { ok: true as const, value: calls }; };
  const cache = createPlannerRevisionRequestCoalescer<{ ok: boolean; value: number }>({
    retain: 3,
    retainWhen: (result) => result.ok,
  });
  await cache.request({ revision: 1, key: 'a', load });
  await cache.request({ revision: 1, key: 'a', load });
  assert.equal(calls, 1, 'a settled day is served again rather than re-read');
  // Readable during a render, without promising anything: a value that only arrives on
  // the next microtask is still a frame of empty page.
  assert.deepEqual(cache.peek({ revision: 1, key: 'a' }), { ok: true, value: 1 });
  assert.equal(cache.peek({ revision: 1, key: 'b' }), undefined, 'unknown is undefined, never a load');
  assert.equal(calls, 1, 'and peeking starts nothing');

  // A write bumps the revision, and every held day goes with it — which is what makes
  // retention safe at all.
  assert.equal(cache.peek({ revision: 2, key: 'a' }), undefined);
  await cache.request({ revision: 2, key: 'a', load });
  assert.equal(calls, 2);

  // Bounded, and the oldest goes first.
  await cache.request({ revision: 2, key: 'b', load });
  await cache.request({ revision: 2, key: 'c', load });
  await cache.request({ revision: 2, key: 'd', load });
  assert.equal(cache.peek({ revision: 2, key: 'a' }), undefined, 'evicted at the bound');
  assert.notEqual(cache.peek({ revision: 2, key: 'd' }), undefined);

  // **A failure is never kept.** These loaders resolve with their errors rather than
  // rejecting, so without `retainWhen` a failed day would be served as though it were an
  // answer for the whole revision.
  let failures = 0;
  const failing = async () => { failures += 1; return { ok: false as const, value: 0 }; };
  await cache.request({ revision: 3, key: 'x', load: failing });
  assert.equal(cache.peek({ revision: 3, key: 'x' }), undefined);
  await cache.request({ revision: 3, key: 'x', load: failing });
  assert.equal(failures, 2, 'a failed day is read again rather than remembered');
});

test('Planner request coordinator coalesces concurrent duplicates without reusing settled work', async () => {
  const coalescer = createPlannerRevisionRequestCoalescer<number>();
  let calls = 0;
  const load = async () => { calls += 1; return calls; };
  const [first, duplicate] = await Promise.all([
    coalescer.request({ revision: 1, key: '2026-07-21', load }),
    coalescer.request({ revision: 1, key: '2026-07-21', load }),
  ]);
  assert.equal(first, 1);
  assert.equal(duplicate, 1);
  assert.equal(calls, 1);
  await coalescer.request({ revision: 1, key: '2026-07-21', load });
  assert.equal(calls, 2);
  await coalescer.request({ revision: 1, key: '2026-07-22', load });
  assert.equal(calls, 3);
  await coalescer.request({ revision: 2, key: '2026-07-21', load });
  assert.equal(calls, 4);
  assert.equal(isLatestPlannerRequest(3, 3), true);
  assert.equal(isLatestPlannerRequest(2, 3), false);
});


test('native rail handlers browse only and keep explicit selection on completed presses', () => {
  const source = readFileSync(path.resolve('src/features/planner/presentation/planner-date-rail.tsx'), 'utf8');
  assert.doesNotMatch(source, /onPressIn\s*=/);
  assert.match(source, /onScrollEndDrag=\{endNativeDrag\}/);
  assert.match(source, /onMomentumScrollEnd=\{endNativeMomentum\}/);
  assert.match(source, /else onBrowse\(movePlannerDate\(anchorDate, dayOffset\)\)/);
  assert.match(source, /interactionAnchorRef\.current = railAnchorDateRef\.current/);
  assert.match(source, /accessibilityLabel="Planner date rail\. Swipe horizontally to browse dates, then tap a date to select it\."/);
  assert.doesNotMatch(source, /label="Browse (?:previous|next) week"/);
  assert.match(source, /const pressDate = useCallback\(\(date: PlannerLocalDate\) => \{/);
  assert.match(source, /onSelect\(date\);/);
  assert.match(source, /PLANNER_DATE_RAIL_WINDOW_DAYS = 21/);
  assert.doesNotMatch(source, /Array\.from\(\{ length: PLANNER_DATE_RAIL_RANGE/);
});


test('Planner completion remains per-habit during date and marker loading', () => {
  const planner = readFileSync(path.resolve('src/features/planner/presentation/planner-screen.tsx'), 'utf8');
  const provider = readFileSync(path.resolve('src/features/planner/presentation/planner-provider.tsx'), 'utf8');
  const occurrenceRepository = readFileSync(path.resolve('src/features/planner/infrastructure/sqlite/sqlite-planner-occurrence-repository.ts'), 'utf8');
  assert.doesNotMatch(planner, /pointerEvents=\{transitioning \? 'none'/);
  assert.match(planner, /tryBeginPlannerPendingAction\(pendingObservationIdsRef\.current, habitId\)/);
  assert.match(planner, /savingHabitIds=\{savingHabitIds\}/);
  assert.match(planner, /saved locally, but Planner could not refresh/i);
  assert.match(provider, /markerRangeRequest\(/);
  assert.doesNotMatch(provider, /Promise\.all\(dates\.map/);
  assert.match(occurrenceRepository, /MARKER_RANGE_CTE/);
  assert.doesNotMatch(occurrenceRepository, /dates\.map\(\(selectedDate\) => loadPlannerOccurrenceData/);
});


test('create and lifecycle writes expose narrow immediate pending feedback', () => {
  const create = readFileSync(path.resolve('src/features/planner/presentation/create-item-screen.tsx'), 'utf8');
  const catalogue = readFileSync(path.resolve('src/features/planner/presentation/all-habits-screen.tsx'), 'utf8');
  assert.match(create, /if \(savingRef\.current\) return;[\s\S]*savingRef\.current = true;[\s\S]*setSaving\(true\)/);
  assert.match(create, /drafts are still available/);
  assert.match(catalogue, /Archiving…/);
  assert.match(catalogue, /Reviewing…/);
  assert.match(catalogue, /if \(!result\.ok\)[\s\S]*pendingActionsRef\.current\.delete/);
  assert.match(catalogue, /LayoutAnimation\.configureNext/);
});


test('native time picker follows resolved appearance without hardcoded wheel text', () => {
  const source = readFileSync(path.resolve('src/features/planner/presentation/planner-date-time-controls.tsx'), 'utf8');
  assert.match(source, /themeVariant=\{theme\.dark \? 'dark' : 'light'\}/);
  assert.match(source, /backgroundColor: theme\.colors\.background/);
  assert.match(source, /title="Cancel"/);
  assert.match(source, /title="Done"/);
  assert.match(source, /title="All day"/);
  assert.doesNotMatch(source, /textColor=|#FFFFFF[^\n]*DateTimePicker|#000000[^\n]*DateTimePicker/);
});


test('typed Planner failures map to actionable wording without implementation details', () => {
  const cases = [
    ['restore_schedule_required', 'choose a new schedule'],
    ['archive_data_integrity_failure', 'No data was changed'],
    ['delete_data_integrity_failure', 'could not safely delete'],
    ['delete_routine_invalid_selection', 'selection is no longer valid'],
    ['delete_routine_stale_confirmation', 'routine changed after the preview'],
    ['edit_future_version_conflict', 'future configuration'],
    ['dependency_cycle', 'create a cycle'],
    ['ordinary_depth_exceeded', 'five-level nesting limit'],
    ['delete_habit_not_found', 'could not be found'],
    ['database_failure', 'local save did not complete'],
  ] as const;
  for (const [code, expected] of cases) assert.match(plannerFailureMessage(code), new RegExp(expected, 'i'));
  for (const message of [
    ...cases.map(([code]) => plannerFailureMessage(code)),
    selectedDateFailureMessage('occurrence_read_model_data_integrity_failure'),
    selectedDateFailureMessage('occurrence_read_model_database_failure'),
  ]) {
    assert.doesNotMatch(message, /\b(?:SELECT|INSERT|DELETE FROM|foreign key|schema|uuid|habit_[a-z_]+)\b/i);
  }
  assert.match(selectedDateFailureMessage('occurrence_read_model_data_integrity_failure'), /No data was changed.*Habit Management or retry/i);
});


test('Habit Detail exposes one previewed mandatory descendant-chain deletion control', () => {
  const source = readFileSync(path.resolve('src/features/planner/presentation/habit-detail-screen.tsx'), 'utf8');
  assert.match(source, /Review permanent deletion/);
  assert.match(source, /expectedOrderedTargetHabitIds: preview\.orderedTargetHabitIds/);
  assert.match(source, /every descendant/);
  assert.match(source, /observationCount/);
  assert.doesNotMatch(source, /Keep sub-habits|Choose sub-habits|Delete entire routine/);
});


test('Planner milestone controls coexist with the protected date-rail and scoped-action contract', () => {
  const create = readFileSync(path.resolve('src/features/planner/presentation/create-item-screen.tsx'), 'utf8');
  const identity = readFileSync(path.resolve('src/features/planner/presentation/habit-identity-controls.tsx'), 'utf8');
  const observation = readFileSync(path.resolve('src/features/planner/presentation/observation-entry-modal.tsx'), 'utf8');
  const rail = readFileSync(path.resolve('src/features/planner/presentation/planner-date-rail.tsx'), 'utf8');
  const planner = readFileSync(path.resolve('src/features/planner/presentation/planner-screen.tsx'), 'utf8');

  const stages = readFileSync(path.resolve('src/features/planner/presentation/habit-form-stages.tsx'), 'utf8');
  // A step is a row with a name and an optional time; the four relationship modes
  // and the per-child settings screen are gone from Create with the redesign.
  const sheets = readFileSync(path.resolve('src/features/planner/presentation/create-habit-sheets.tsx'), 'utf8');
  // Steps are an inline checklist on the create sheet now, not a summary row
  // opening one — but they are still a name and nothing else.
  assert.match(create, /accessibilityLabel="New step"/);
  for (const control of ['Step name', 'Remove step', 'New step name']) {
    assert.match(sheets, new RegExp(control));
  }
  assert.match(identity, /HABIT_ACCENT_OPTIONS\.map/);
  assert.match(identity, /accessibilityLabel="Habit colour palette"/);
  assert.match(identity, /accessibilityRole="radio" accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(stages, /persistedAccentKey: next\.accentMode/);
  assert.match(stages, /HabitIconPicker/);
  assert.match(stages, /UnitSelectionField/);
  assert.match(stages, /ComparisonSelector/);
  assert.match(observation, /Add amount/);
  assert.match(observation, /Correct entry/);
  assert.match(observation, /Remove entry/);
  assert.doesNotMatch(rail, /onBrowse\([^)]*selectedDate/);
  assert.match(rail, /onSelect\(date\)/);
  assert.doesNotMatch(planner, /pointerEvents=\{transitioning \? 'none'/);
  assert.match(planner, /pendingObservationIdsRef\.current/);
});


test('priority control presents the four canonical values as accessible segments', () => {
  assert.deepEqual(IMPORTANCE_STOPS, ['low', 'normal', 'high', 'critical']);
  const controls = readFileSync(path.resolve('src/features/planner/presentation/planner-form-controls.tsx'), 'utf8');
  assert.match(controls, /PrioritySegmentedControl/);
  assert.match(controls, /accessibilityRole="radiogroup"/);
  assert.match(controls, /accessibilityRole="radio"/);
  assert.doesNotMatch(controls, /PanResponder|accessibilityRole="adjustable"/);
});


test('tracking, comparison, and unit controls remain compact and mode-compatible', () => {
  const controls = readFileSync(path.resolve('src/features/planner/presentation/planner-form-controls.tsx'), 'utf8');
  const create = readFileSync(path.resolve('src/features/planner/presentation/create-item-screen.tsx'), 'utf8');
  const quantity = compatibleUnitGroups('quantity').flatMap(({ choices }) => choices);
  const counter = compatibleUnitGroups('counter').flatMap(({ choices }) => choices);
  assert.deepEqual(quantity.filter(({ kind }) => kind === 'standard').map(({ group }) => group), ['Volume', 'Volume', 'Mass', 'Mass', 'Distance', 'Distance']);
  assert.equal(quantity.some(({ group }) => group === 'Count'), false);
  assert.equal(quantity.some(({ key }) => key === 'custom'), true);
  assert.equal(counter.some(({ key }) => key === 'none'), true);
  assert.equal(counter.some(({ key }) => key === 'litre'), false);
  assert.deepEqual(compatibleUnitGroups('quantity', 'kg').flatMap(({ choices }) => choices).map(({ key }) => key), ['kilogram']);
  const adapterSource = readFileSync(path.resolve('src/features/planner/presentation/ui-adapters.ts'), 'utf8');
  const stages = readFileSync(path.resolve('src/features/planner/presentation/habit-form-stages.tsx'), 'utf8');
  for (const mode of ['checkbox', 'counter', 'quantity', 'duration', 'avoidance']) assert.match(adapterSource, new RegExp(`${mode}: '`));
  assert.match(controls, /fontScale >= 1\.25 \|\| width < 360/);
  assert.match(controls, /open \? <UnitSelectionSheet/);
  assert.match(controls, /Search units/);
  // Legacy metric editing moved out of Create with the redesign; it did not go away.
  assert.match(stages, /trackingMode === 'checkbox' \|\| draft\.trackingMode === 'avoidance'\) return null/);
  assert.match(stages, /draft\.trackingMode === 'duration' \? null/);
  assert.doesNotMatch(create, /title="Standard unit"/);
});


test('Expo Router resolves the literal catalogue URL without an index detail segment', () => {
  const selectedDate = localDate('2026-08-14');
  const href = resolveHref(habitCatalogueNavigation(selectedDate));
  const url = new URL(href, 'https://lifeplanner.local');

  assert.equal(href, `/planner/habits?date=${selectedDate}`);
  assert.equal(url.pathname, '/planner/habits');
  assert.notEqual(url.pathname.split('/').at(-1), 'index');
  assert.deepEqual(url.searchParams.getAll('date'), [selectedDate]);
});


test('Expo Router generated config keeps catalogue literal and detail dynamic routes distinct', () => {
  const appDirectory = path.resolve('app');
  const keys = routeFiles(appDirectory);
  const context = Object.assign(
    () => ({ default: () => null }),
    { keys: () => keys, resolve: (key: string) => key, id: 'planner-route-contract' },
  );
  const routes = getRoutes(context as never);
  assert.notEqual(routes, null);
  const screens = getReactNavigationConfig(routes!, false).screens as Record<string, {
    readonly path: string;
    readonly _route: { readonly dynamic: readonly Readonly<{ name: string; deep: boolean }>[] | null };
  }>;

  assert.equal(screens['planner/habits/index']?.path, 'planner/habits');
  assert.equal(screens['planner/habits/[id]']?.path, 'planner/habits/:id');
  assert.equal(screens['planner/habits/index']?._route.dynamic, null);
  assert.deepEqual(screens['planner/habits/[id]']?._route.dynamic, [{ name: 'id', deep: false }]);
});


test('Habit Detail navigation keeps canonical root and dependent IDs separate from the selected date', () => {
  const rootId = plannerId('11111111-1111-4111-8111-111111111111');
  const dependentId = plannerId('22222222-2222-4222-8222-222222222222');
  const selectedDate = localDate('2026-08-14');

  // Habit detail is withdrawn: opening a habit opens the screen that can change it.
  // The ID and the date stay separate parameters, which is what this guards.
  assert.deepEqual(habitDetailNavigation(rootId, selectedDate), {
    pathname: '/planner/edit/[id]',
    params: { id: rootId, date: selectedDate },
  });
  assert.deepEqual(habitDetailNavigation(dependentId, selectedDate), {
    pathname: '/planner/edit/[id]',
    params: { id: dependentId, date: selectedDate },
  });
});


test('Expo Router resolves the Planner href into the dynamic habit ID and independent date query', () => {
  const id = plannerId('11111111-1111-4111-8111-111111111111');
  const selectedDate = localDate('2026-08-14');
  const href = resolveHref(habitDetailNavigation(id, selectedDate));
  const url = new URL(href, 'https://lifeplanner.local');
  const routeId = url.pathname.split('/').filter(Boolean).at(-1);
  const routeDates = url.searchParams.getAll('date');

  assert.equal(href, `/planner/edit/${id}?date=${selectedDate}`);
  assert.deepEqual(
    resolveHabitDetailRouteParams({ id: routeId, date: routeDates }, localDate('2026-07-20')),
    { ok: true, habitId: id, asOfLocalDate: selectedDate },
  );
});


test('Habit Detail route parameters keep the required ID independent from optional date context', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const fallbackDate = localDate('2026-07-20');

  assert.deepEqual(resolveHabitDetailRouteParams({ id, date: '2026-08-14' }, fallbackDate), {
    ok: true,
    habitId: id,
    asOfLocalDate: '2026-08-14',
  });
  assert.deepEqual(resolveHabitDetailRouteParams({ id: [id], date: ['2026-08-14'] }, fallbackDate), {
    ok: true,
    habitId: id,
    asOfLocalDate: '2026-08-14',
  });
  assert.deepEqual(resolveHabitDetailRouteParams({ id, date: undefined }, fallbackDate), {
    ok: true,
    habitId: id,
    asOfLocalDate: fallbackDate,
  });
  assert.deepEqual(resolveHabitDetailRouteParams({ id, date: 'invalid' }, fallbackDate), {
    ok: true,
    habitId: id,
    asOfLocalDate: fallbackDate,
  });
  assert.deepEqual(resolveHabitDetailRouteParams({ id, date: ['2026-08-14', '2026-08-14'] }, fallbackDate), {
    ok: true,
    habitId: id,
    asOfLocalDate: fallbackDate,
  });
  for (const params of [
    {},
    { id: 'invalid', date: '2026-08-14' },
    { id: 'index', date: '2026-08-14' },
    { id: [id, id], date: '2026-08-14' },
  ]) {
    assert.deepEqual(resolveHabitDetailRouteParams(params, fallbackDate), { ok: false, reason: 'invalid_route' });
  }
});


test('Habit Detail provider input preserves canonical root and dependent IDs', () => {
  const date = localDate('2026-08-14');
  const rootId = plannerId('11111111-1111-4111-8111-111111111111');
  const dependentId = plannerId('22222222-2222-4222-8222-222222222222');

  assert.deepEqual(habitDetailQueryInput(rootId, date), { habitId: rootId, asOfLocalDate: date });
  assert.deepEqual(habitDetailQueryInput(dependentId, date), { habitId: dependentId, asOfLocalDate: date });
});


test('observation modal policy keeps keyboard and backdrop dismissal distinct', () => {
  assert.deepEqual(OBSERVATION_MODAL_KEYBOARD_POLICY, {
    iosAvoidingBehavior: 'padding',
    keyboardDismissMode: 'interactive',
    keyboardShouldPersistTaps: 'handled',
    contentPressAction: 'dismiss_keyboard',
    backdropPressAction: 'dismiss_modal',
    resetDraftOnKeyboardDismiss: false,
    scrollable: true,
  });
  assert.equal(observationModalSaveDisabled(false, 'counter', null), false);
  assert.equal(observationModalSaveDisabled(false, 'quantity', null), false);
  assert.equal(observationModalSaveDisabled(false, 'duration', null), false);
  assert.equal(observationModalSaveDisabled(false, 'avoidance', null), true);
  assert.equal(observationModalSaveDisabled(false, 'avoidance', true), false);
});


test('management queries preserve a valid selected route date and safely fall back', () => {
  assert.equal(managementQueryDate('2026-08-14', DATE), '2026-08-14');
  assert.equal(managementQueryDate(undefined, DATE), DATE);
  assert.equal(managementQueryDate('not-a-date', DATE), DATE);
});


test('Habit Detail presents avoidance truth using the approved did-not-occur meaning', () => {
  assert.equal(observationValueText({ value: { type: 'avoidance', booleanValue: true } } as never), 'Did not occur');
  assert.equal(observationValueText({ value: { type: 'avoidance', booleanValue: false } } as never), 'Occurred');
});

const RANGE: ActiveRangeDraft = { activeFrom: '2026-07-20', activeTo: '' };
const FINITE_RANGE: ActiveRangeDraft = { activeFrom: '2026-07-20', activeTo: '2026-08-01' };
const TIMEZONE = 'Europe/London';
const ID = plannerId('22222222-2222-4222-8222-222222222222');
const DATE = localDate('2026-07-22');
const ZONE = timezone(TIMEZONE);


test('all nine schedule drafts map to their approved domain definitions', () => {
  const base = createDefaultScheduleDraft(RANGE.activeFrom);
  const cases: readonly [ScheduleDraft, string][] = [
    [{ ...base, scheduleType: 'daily' }, 'daily'],
    [{ ...base, scheduleType: 'selected_weekdays', selectedWeekdays: [1, 3, 5] }, 'selected_weekdays'],
    [{ ...base, scheduleType: 'every_n_days', intervalDays: '3', anchorDate: RANGE.activeFrom }, 'every_n_days'],
    [{ ...base, scheduleType: 'times_per_week', periodTargetCount: '2', weekStart: '1' }, 'times_per_week'],
    [{ ...base, scheduleType: 'times_per_month', periodTargetCount: '4' }, 'times_per_month'],
    [{ ...base, scheduleType: 'times_per_year', periodTargetCount: '12' }, 'times_per_year'],
    [{ ...base, scheduleType: 'weekly', weekday: '3', weekStart: '1' }, 'weekly'],
    [{ ...base, scheduleType: 'monthly', monthDay: '31' }, 'monthly'],
    [{ ...base, scheduleType: 'yearly', monthNumber: '2', monthDay: '29' }, 'yearly'],
  ];
  for (const [draft, expectedType] of cases) {
    const result = buildScheduleDefinition(draft, RANGE, TIMEZONE);
    assert.equal(result.ok, true, expectedType);
    if (result.ok) assert.equal(result.value.scheduleType, expectedType);
  }
});


test('invalid schedule values return field-specific validation', () => {
  const base = createDefaultScheduleDraft(RANGE.activeFrom);
  const selected = buildScheduleDefinition({ ...base, scheduleType: 'selected_weekdays' }, RANGE, TIMEZONE);
  assert.equal(selected.ok, false);
  if (!selected.ok) assert.equal(selected.errors[0]?.field, 'selectedWeekdays');
  const interval = buildScheduleDefinition({ ...base, scheduleType: 'every_n_days', intervalDays: '0' }, RANGE, TIMEZONE);
  assert.equal(interval.ok, false);
  if (!interval.ok) assert.equal(interval.errors.some(({ field }) => field === 'intervalDays'), true);
});


test('all five tracking drafts map to their approved domain definitions', () => {
  const base = createDefaultTrackingDraft();
  const cases: readonly [TrackingDraft, string][] = [
    [{ ...base, trackingMode: 'checkbox' }, 'checkbox'],
    [{ ...base, trackingMode: 'avoidance' }, 'avoidance'],
    [{ ...base, trackingMode: 'counter', target: '3', unitType: 'none' }, 'counter'],
    [{ ...base, trackingMode: 'quantity', target: '2.50', unitType: 'standard', standardUnitCode: 'litre' }, 'quantity'],
    [{ ...base, trackingMode: 'duration', durationHours: '1', durationMinutes: '30', durationSeconds: '45' }, 'duration'],
  ];
  for (const [draft, expectedMode] of cases) {
    const result = buildTrackingDefinition(draft, RANGE);
    assert.equal(result.ok, true, expectedMode);
    if (result.ok) assert.equal(result.value.trackingMode, expectedMode);
  }
});


test('exact quantity drafts preserve significand and scale', () => {
  const result = buildTrackingDefinition({
    ...createDefaultTrackingDraft(),
    trackingMode: 'quantity',
    target: '2.50',
    unitType: 'standard',
    standardUnitCode: 'litre',
  }, RANGE);
  assert.equal(result.ok, true);
  if (result.ok && result.value.trackingMode === 'quantity') {
    assert.equal(result.value.target.significand, 250n);
    assert.equal(result.value.target.scale, 2);
  }
});


test('quantity input accepts dot or comma and normalizes exactly to the target scale', () => {
  const target = exact(200n, 2);
  const invalid = quantityObservationFromDraft('0.1234567', target);
  assert.equal(invalid.ok, false);
  for (const input of ['0.5', '0,5', '0.50'] as const) {
    const valid = quantityObservationFromDraft(input, target);
    assert.equal(valid.ok, true, input);
    if (valid.ok) assert.deepEqual(valid.value, exact(50n, 2), input);
  }
  assert.deepEqual(parsePlannerDecimalInput('0.5'), { ok: true, value: exact(5n, 1) });
  assert.deepEqual(parsePlannerDecimalInput('0,50'), { ok: true, value: exact(50n, 2) });
  assert.equal(parsePlannerDecimalInput('0,5.0').ok, false);
});


test('duration drafts map deterministically to whole seconds', () => {
  const result = durationDraftToSeconds('1', '30');
  assert.deepEqual(result, { ok: true, value: 5400 });
  assert.deepEqual(durationDraftToSeconds('0', '0', '45'), { ok: true, value: 45 });
  assert.equal(durationDraftToSeconds('0', '0', '60').ok, false);
});


test('current entry copy preserves the exact measured value with a compact unit', () => {
  const occurrence = row({ actualTarget: quantityActual() });
  assert.equal(currentEntryValueText({
    rootObservationId: ID,
    currentObservationId: ID,
    observationType: 'quantity',
    occurrenceLocalTime: null,
    originalValue: { type: 'quantity', quantity: exact(25n, 2) },
    currentValue: { type: 'quantity', quantity: exact(25n, 2) },
    observedAt: 1,
    note: null,
    correctionCount: 0,
  }, occurrence), '0.25 L');
});


test('quantity quick actions label their source unit and convert exactly to the target unit', () => {
  const litreRow = row({ actualTarget: {
    trackingMode: 'quantity',
    actual: exact(50n, 2),
    target: exact(100n, 2),
    comparisonOperator: 'at_least',
    unit: { unitType: 'standard', standardUnitCode: 'litre' },
  } });
  assert.deepEqual(quantityQuickActions(litreRow), [
    { label: '+250 ml', accessibilityLabel: 'Add 250 millilitres', inputValue: '0.25' },
    { label: '+500 ml', accessibilityLabel: 'Add 500 millilitres', inputValue: '0.5' },
  ]);
  assert.equal(actualTargetText(litreRow), '0.5 / 1 L');

  const first = quantityQuickActions(litreRow)[0];
  assert.ok(first);
  const observation = quantityObservationFromDraft(first.inputValue, exact(100n, 2));
  assert.deepEqual(observation, { ok: true, value: exact(25n, 2) });
});


test('quantity progress converts numerator and target to one exact display unit', () => {
  assert.deepEqual(formatQuantityProgressInUnit(exact(500n, 0), 'millilitre', exact(1n, 0), 'litre', 'litre'), { ok: true, value: '0.5 / 1 L' });
  assert.deepEqual(formatQuantityProgressInUnit(exact(250n, 0), 'millilitre', exact(1n, 0), 'litre', 'litre'), { ok: true, value: '0.25 / 1 L' });
  assert.deepEqual(formatQuantityProgressInUnit(exact(1000n, 0), 'millilitre', exact(1n, 0), 'litre', 'litre'), { ok: true, value: '1 / 1 L' });
  assert.deepEqual(formatQuantityProgressInUnit(exact(500n, 0), 'millilitre', exact(1000n, 0), 'millilitre', 'millilitre'), { ok: true, value: '500 / 1000 ml' });
  assert.equal(formatQuantityProgressInUnit(exact(500n, 0), 'millilitre', exact(1n, 0), 'kilogram', 'litre').ok, false);
});


test('parent draft maps to the CreateHabit command without category or reminder', () => {
  const draft = parentDraft(RANGE);
  const result = buildCreateHabitCommand(draft, TIMEZONE);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, 'Gym');
    assert.equal(result.value.categoryId, null);
    assert.equal(result.value.reminder, null);
    assert.equal(result.value.schedule.scheduleType, 'selected_weekdays');
  }
});


test('dependency draft maps to create-new AddHabitDependency command', () => {
  const result = buildCreateDependencyCommand(ID, RANGE, dependencyDraft());
  assert.equal(result.ok, true);
  if (result.ok && result.value !== null) {
    assert.equal(result.value.dependentSource, 'new');
    assert.equal(result.value.dependencyType, 'follow_up');
    assert.equal(result.value.dependent.name, 'Protein shake');
  }
});


test('finite parent range produces a finite dependency command', () => {
  const finite = buildCreateDependencyCommand(ID, FINITE_RANGE, dependencyDraft());
  assert.equal(finite.ok, true);
  if (finite.ok && finite.value !== null) assert.equal(finite.value.effectiveTo, localDate('2026-08-01'));
});


test('open parent range produces an open dependency command', () => {
  const open = buildCreateDependencyCommand(ID, RANGE, dependencyDraft());
  assert.equal(open.ok, true);
  if (open.ok && open.value !== null) assert.equal(open.value.effectiveTo, null);
});


test('integer quantity targets retain exact hundredth-scale additive entry support', () => {
  const tracking = buildTrackingDefinition({
    ...createDefaultTrackingDraft(),
    trackingMode: 'quantity',
    target: '2',
    unitType: 'standard',
    standardUnitCode: 'litre',
  }, RANGE);
  assert.equal(tracking.ok, true);
  if (tracking.ok && tracking.value.trackingMode === 'quantity') {
    assert.deepEqual(tracking.value.target, exact(200n, 2));
    const entry = quantityObservationFromDraft('0.50', tracking.value.target);
    assert.equal(entry.ok, true);
    if (entry.ok) assert.deepEqual(entry.value, exact(50n, 2));
  }
});


test('blocked rows expose no record action', () => {
  assert.equal(occurrenceAction(row({ state: 'blocked' })).kind, 'none');
});


test('routine action suppression consumes the canonical presentation contract', () => {
  const routine = {
    completionSource: 'ordinary_children_derived' as const,
    isRoutineContainer: true,
    hasIndependentCompletionAction: false,
    ordinaryStepCount: 1,
    completedOrdinaryStepCount: 0,
    remainingOrdinaryStepCount: 1,
    exactProgress: { numerator: 0n, denominator: 1n },
    displayProgress: 0,
    isCanonicallyComplete: false,
    applicability: 'applicable' as const,
  };
  assert.equal(occurrenceAction(row({ routineContainer: routine })).kind, 'none');
  assert.equal(occurrenceAction(row({ routineContainer: {
    ...routine,
    isRoutineContainer: false,
    ordinaryStepCount: 0,
    remainingOrdinaryStepCount: 0,
    exactProgress: null,
    displayProgress: null,
    applicability: 'no_applicable_steps',
  } })).kind, 'none');
  assert.equal(occurrenceAction(row({ routineContainer: {
    ...routine,
    completionSource: 'independent_observation',
    isRoutineContainer: false,
    hasIndependentCompletionAction: true,
    ordinaryStepCount: 0,
    remainingOrdinaryStepCount: 0,
    exactProgress: null,
    displayProgress: null,
    applicability: 'not_container',
  } })).kind, 'record_checkbox');
});


test('expected rows expose mode-specific actions', () => {
  const checkboxAction = occurrenceAction(row());
  assert.equal(checkboxAction.kind, 'record_checkbox');
  assert.equal(checkboxAction.label, 'Record completion');
  assert.equal(occurrenceAction(row({ actualTarget: counterActual() })).kind, 'add_counter');
  assert.equal(occurrenceAction(row({ actualTarget: quantityActual() })).kind, 'add_quantity');
  assert.equal(occurrenceAction(row({ actualTarget: durationActual() })).kind, 'add_duration');
  assert.equal(occurrenceAction(row({ actualTarget: { trackingMode: 'avoidance', actual: null, target: true } })).kind, 'choose_avoidance');
});


test('dependency presentation distinguishes locked, available, incomplete, and completed', () => {
  assert.deepEqual(statusPresentation(row()), {
    label: 'Incomplete', tone: 'neutral', explanation: null,
  });
  assert.deepEqual(statusPresentation(row({
    dependencyType: 'follow_up',
    parentHabitId: plannerId('33333333-3333-4333-8333-333333333333'),
    depth: 1,
  })), {
    label: 'Available · incomplete',
    tone: 'neutral',
    explanation: 'Record this habit separately to complete it.',
  });
  assert.deepEqual(statusPresentation(row({
    state: 'blocked',
    dependencyType: 'follow_up',
    parentHabitId: plannerId('33333333-3333-4333-8333-333333333333'),
    depth: 1,
  })), {
    label: 'Locked · incomplete',
    tone: 'neutral',
    explanation: 'Complete the parent habit first.',
  });
  assert.deepEqual(statusPresentation(row({
    state: 'qualified',
    actualTarget: { trackingMode: 'checkbox', actual: true, target: true },
  })), {
    label: 'Completed',
    tone: 'success',
    explanation: 'Completion comes from this habit’s own observation.',
  });
});


test('prerequisite-blocked parent never exposes a completion action', () => {
  assert.equal(occurrenceAction(row({ state: 'prerequisite_blocked_parent' })).kind, 'none');
});


test('qualified checkbox exposes correction rather than a second root', () => {
  const action = occurrenceAction(row({ state: 'qualified', actualTarget: { trackingMode: 'checkbox', actual: true, target: true } }));
  assert.equal(action.kind, 'correct_checkbox');
});


test('skipped rows expose no invented completion meaning', () => {
  assert.equal(occurrenceAction(row({ state: 'skipped_policy_unresolved' })).kind, 'none');
});






test('tracking summaries use plain completion grammar', () => {
  const counter = buildTrackingDefinition({ ...createDefaultTrackingDraft(), trackingMode: 'counter', target: '3' }, RANGE);
  assert.equal(counter.ok, true);
  if (counter.ok) {
    assert.match(trackingSummary(counter.value), /^Complete at least 3/);
    assert.doesNotMatch(trackingSummary(counter.value), /Complete at at least/);
  }
});

function parentDraft(range: ActiveRangeDraft): ParentHabitDraft {
  return {
    name: '  Gym  ',
    description: '',
    activeRange: range,
    schedule: { ...createDefaultScheduleDraft(range.activeFrom), scheduleType: 'selected_weekdays', selectedWeekdays: [1, 3, 5] },
    tracking: createDefaultTrackingDraft(),
    importance: 'high',
    plannedTime: '',
  };
}

function dependencyDraft(): DependencyDraft {
  return {
    enabled: true,
    dependencyType: 'follow_up',
    name: 'Protein shake',
    description: '',
    tracking: createDefaultTrackingDraft(),
    importance: 'low',
  };
}

function row(overrides: Partial<SelectedDatePlannerOccurrenceRow> = {}): SelectedDatePlannerOccurrenceRow {
  return {
    habitId: ID,
    name: 'Gym',
    categoryId: null,
    rootHabitId: ID,
    parentHabitId: null,
    relationshipVersionId: null,
    dependencyType: null,
    ordinaryParentHabitId: null,
    ordinaryParentName: null,
    ordinaryCompletionRole: null,
    ordinaryDepth: 0,
    plannedLocalTime: null,
    plannedDurationMinutes: null,
    plannedBlock: null,
    depth: 0,
    displayOrder: 0,
    stableSortOrder: 0,
    state: 'expected_incomplete',
    reason: 'no_current_fact',
    trackingMode: 'checkbox',
    importance: 'normal',
    progress: {
      completionCredit: { numerator: 0n, denominator: 1n },
      actual: { kind: 'boolean', value: null },
      target: { kind: 'boolean', value: true },
      inclusion: 'included',
      exclusionReason: null,
      importance: 'normal',
      historicalWeight: 2,
      weightedCredit: { numerator: 0n, denominator: 1n },
      displayProgress: 0,
    },
    highlightRank: 1,
    highlightReason: 'other_incomplete',
    visualIdentity: {
      id: ID,
      habitId: ID,
      iconIdentity: Object.freeze({ kind: 'symbol', symbolKey: 'checkbox' }),
      persistedAccentKey: 'coral',
      iconKey: 'checkbox',
      accentKey: 'coral',
      createdAt: 1,
      updatedAt: 1,
    },
    actualTarget: { trackingMode: 'checkbox', actual: null, target: true },
    currentObservation: { currentLeafCount: 0, currentLeafIds: [], currentTypes: [], currentEntries: [], voidedChainCount: 0 },
    occurrenceWindowOpen: false,
    commandContext: { habitId: ID, occurrenceLocalDate: DATE, occurrenceTimezone: ZONE },
    routineContainer: null,
    ...overrides,
  };
}

function counterActual(): SelectedDatePlannerOccurrenceRow['actualTarget'] {
  const zero = exact(0n, 0) as ReturnType<typeof exact> & { readonly scale: 0 };
  const target = exact(3n, 0) as ReturnType<typeof exact> & { readonly scale: 0 };
  return { trackingMode: 'counter', actual: zero, target, comparisonOperator: 'at_least', unit: { unitType: 'none' } };
}

function quantityActual(): SelectedDatePlannerOccurrenceRow['actualTarget'] {
  return { trackingMode: 'quantity', actual: exact(0n, 2), target: exact(200n, 2), comparisonOperator: 'at_least', unit: { unitType: 'standard', standardUnitCode: 'litre' } };
}

function durationActual(): SelectedDatePlannerOccurrenceRow['actualTarget'] {
  return { trackingMode: 'duration', actualSeconds: 0, targetSeconds: 1800, comparisonOperator: 'at_least' };
}

function exact(significand: bigint, scale: number) {
  const result = createExactQuantity({ significand, scale });
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function plannerId(value: string): PlannerId {
  const result = parsePlannerId(value);
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function localDate(value: string): PlannerLocalDate {
  const result = parsePlannerLocalDate(value);
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function timezone(value: string): PlannerTimezone {
  const result = parsePlannerTimezone(value);
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function routeFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute, root);
    return /\.[tj]sx?$/.test(entry.name)
      ? [`./${path.relative(root, absolute).replaceAll('\\', '/')}`]
      : [];
  });
}

test('a tick drops its own day, not the fifteen others held beside it', async () => {
  /**
   * **Owner's question: «можем ли мы заносить страницы… в кэш, чтобы при возврате к ним не
   * прогружать их по новой?»** They were already cached — sixteen days of them — and then
   * thrown away wholesale by the next checkbox, because a revision bump meant «everything
   * might have changed» and cleared the store. Returning to a day looked at a moment earlier
   * read it from disk again.
   *
   * A caller that knows the blast radius now says so. A habit created, edited, archived or
   * deleted still drops everything: its schedule can reach any day at all.
   */
  const coalescer = createPlannerRevisionRequestCoalescer<{ ok: true; value: string }>({
    retain: 8, retainWhen: () => true,
  });
  const load = (value: string) => async () => ({ ok: true as const, value });
  await coalescer.request({ revision: 1, key: '2026-08-05', load: load('a') });
  await coalescer.request({ revision: 1, key: '2026-08-06', load: load('b') });
  assert.deepEqual(coalescer.peek({ revision: 1, key: '2026-08-05' }), { ok: true, value: 'a' });

  // Narrowed to one day: the other survives the bump.
  coalescer.dropOnly((key) => key.includes('2026-08-06'));
  await coalescer.request({ revision: 2, key: 'unrelated', load: load('c') });
  assert.deepEqual(coalescer.peek({ revision: 2, key: '2026-08-05' }), { ok: true, value: 'a' },
    'a day nobody touched is still held');
  assert.equal(coalescer.peek({ revision: 2, key: '2026-08-06' }), undefined, 'the day that changed is gone');

  // **The narrowing is one-shot**, or a caller could spare answers about a day that has since
  // changed by narrowing a revision already applied.
  await coalescer.request({ revision: 3, key: 'other', load: load('d') });
  assert.equal(coalescer.peek({ revision: 3, key: '2026-08-05' }), undefined,
    'an un-narrowed bump still clears everything');

  // And the screen names the day it changed.
  const journal = readFileSync('src/features/planner/presentation/day-journal-screen.tsx', 'utf8');
  assert.equal((journal.match(/refreshOccurrences\(date\)/g) ?? []).length, 2);
  assert.doesNotMatch(journal, /refreshOccurrences\(\);/, 'the journal always knows which day it changed');
});
