import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { PlannerHabitTemporalContext } from '../../../src/features/planner';
import {
  plannerEditStageNames,
  plannerFailureMessage,
  plannerHabitTemporalPresentation,
} from '../../../src/features/planner/presentation/ui-adapters';

const management = source('src/features/planner/presentation/all-habits-screen.tsx');
// Manage reads `displayConfiguration` through its own React-free model now, so
// the pair is what has to consume canonical context, not the screen file alone.
const manageModel = source('src/features/planner/presentation/manage-items-model.ts');
const detail = source('src/features/planner/presentation/habit-detail-screen.tsx');
const edit = source('src/features/planner/presentation/edit-habit-screen.tsx');
const identity = source('src/features/planner/presentation/habit-visual-components.tsx');
const confirmation = source('src/features/planner/presentation/planner-archive-confirmation.tsx');
const diagnostics = source('src/features/planner/application/diagnostics/planner-diagnostics.ts');

test('pre-active presentation labels one canonical future snapshot without schedule-time contradiction', () => {
  const presentation = plannerHabitTemporalPresentation(temporal('next_effective', true, false));
  assert.equal(presentation.statusLabel, 'Scheduled');
  assert.match(presentation.statusDetail ?? '', /^Starts /);
  assert.equal(presentation.settingsHeading, 'Future settings');
  assert.equal(presentation.schedule, 'Every day');
  assert.equal(presentation.plannedTime, '20:00');
  assert.match(presentation.primarySummary, /^Starts .+ · Every day · 20:00$/);
  assert.doesNotMatch(presentation.primarySummary, /Needs schedule|pre_active|next_effective/);
});

test('active and later-effective presentations use only the supplied display snapshot', () => {
  const active = plannerHabitTemporalPresentation(temporal('as_of', false, false));
  const futureRepair = plannerHabitTemporalPresentation(temporal('next_effective', false, true));
  assert.deepEqual([active.statusLabel, active.settingsHeading, active.primarySummary], ['Active', 'Current setup', '20:00 · Every day']);
  assert.match(futureRepair.primarySummary, /^Starts .+ · Schedule required$/);
  assert.doesNotMatch(futureRepair.primarySummary, /20:00/);
});

test('Management and Detail consume canonical temporal context and action availability', () => {
  for (const consumer of [management + manageModel, detail]) {
    assert.match(consumer, /plannerHabitTemporalPresentation/);
    assert.match(consumer, /temporalContext\.actionAvailability/);
    assert.match(consumer, /displayConfiguration/);
    assert.doesNotMatch(consumer, /new Date\([^)]*activeFrom|activeFrom\s*[<>]=?|addPlannerCalendarDays/);
  }
  assert.match(management, /availability\.edit\.available/);
  assert.match(management, /availability\.archive\.available/);
  assert.match(management, /availability\.delete\.available/);
});

test('future-effective Archive remains modal while pending and acknowledges only persisted success', () => {
  assert.match(confirmation, /accessibilityViewIsModal/);
  assert.match(confirmation, /if \(!pending\) onCancel/);
  assert.match(confirmation, /disabled=\{pending\}/);
  assert.match(confirmation, /accessibilityLiveRegion="polite"/);
  assert.match(detail, /earliestEffectiveLocalDate/);
  assert.match(detail, /before it begins on/);
  const success = detail.indexOf('if (!result.ok)');
  assert.ok(success >= 0);
  assert.ok(detail.indexOf('NotificationFeedbackType.Success', success) > success);
  assert.match(management + detail, /already_archived/);
});

test('typed lifecycle failure stays consumer-safe and raw diagnostics remain development logging only', () => {
  assert.equal(plannerFailureMessage('lifecycle_history_invalid'), 'This habit could not be updated safely. No data was changed. Try again.');
  assert.doesNotMatch(management + detail + confirmation, /failureClass|recordIds|lifecycle_history_invalid|data_integrity_failure/);
  assert.match(diagnostics, /console\.info\('\[LP_DIAGNOSTIC\]'/);
  assert.doesNotMatch(diagnostics, /console\.error\('Planner operation failed/);
  assert.match(management + detail, /Dismiss error/);
});

test('Edit hides tracking choice for Checkbox and routines and locks legacy metric mode', () => {
  // The stage names stay canonical for anything still reading them; Edit itself is
  // now the create form in its other mode and no longer a wizard.
  assert.deepEqual(plannerEditStageNames('checkbox', false), ['Identity', 'Plan', 'Review']);
  assert.deepEqual(plannerEditStageNames('duration', true), ['Identity', 'Plan', 'Review']);
  assert.deepEqual(plannerEditStageNames('duration', false), ['Identity', 'Plan', 'Legacy tracking', 'Review']);
  // **The locked stage is gone from the surface.** It rendered a piece of the old
  // form, which has no home in the create sheet's language. What PD-TRACK-002
  // actually requires survives and is asserted below: the definition is carried
  // through untouched, so a saved metric habit stays exactly what it was and no
  // conversion is offered anywhere.
  assert.doesNotMatch(edit, /lockedMode/);
  assert.match(edit, /iconIdentity,/);
  // The tracking definition is carried through untouched: no conversion is offered.
  assert.match(edit, /trackingDraftFromDefinition\(configuration\.tracking\.definition\)/);
});

test('canonical identity renderer preserves exact emoji and all affected consumers use iconIdentity', () => {
  assert.match(identity, /candidate\.emoji/);
  assert.match(identity, />\{exactEmoji\}<\/Text>/);
  assert.match(identity, /candidate\?\.kind === 'symbol'/);
  assert.match(identity, /: 'habit_generic'/);
  for (const file of [
    'habit-occurrence-row.tsx',
    'all-habits-screen.tsx',
    'habit-detail-screen.tsx',
    'edit-habit-screen.tsx',
  ]) {
    const consumer = source(`src/features/planner/presentation/${file}`);
    assert.match(consumer, /iconIdentity/);
    assert.doesNotMatch(consumer, /visualIdentity\.iconKey/);
  }
});

function temporal(
  relation: PlannerHabitTemporalContext['displayConfigurationTemporalRelation'],
  isPreActive: boolean,
  needsSchedule: boolean,
): PlannerHabitTemporalContext {
  const snapshot = {
    effectiveLocalDate: '2026-07-25',
    schedule: needsSchedule ? null : { definition: { scheduleType: 'daily' } },
    tracking: { definition: { trackingMode: 'checkbox' } },
    importance: { importance: 'normal' },
    plannedTime: { plannedLocalTime: needsSchedule ? null : '20:00' },
    inheritsOccurrence: false,
    needsSchedule,
    ordinaryParent: null,
    ordinaryChildren: [],
    incomingDependencies: [],
  };
  return {
    asOfLocalDate: '2026-07-24',
    lifecycleState: isPreActive ? 'pre_active' : 'active',
    isPreActive,
    activeFrom: '2026-07-25',
    lifecycleEffectiveLocalDate: isPreActive ? null : '2026-07-24',
    nextLifecycleState: isPreActive ? 'active' : null,
    nextLifecycleEffectiveLocalDate: isPreActive ? '2026-07-25' : null,
    latestSequenceNumber: 1,
    actionAvailability: {} as PlannerHabitTemporalContext['actionAvailability'],
    asOfConfiguration: relation === 'as_of' ? snapshot : null,
    nextEffectiveConfiguration: relation === 'next_effective' ? snapshot : null,
    displayConfiguration: snapshot,
    displayConfigurationTemporalRelation: relation,
  } as unknown as PlannerHabitTemporalContext;
}

function source(path: string): string {
  return readFileSync(path, 'utf8');
}
