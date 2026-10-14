import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPARISON_OPERATORS,
  DAILY_FOCUS_PROVENANCE_TYPES,
  DEPENDENCY_END_REASONS,
  DEPENDENCY_OCCURRENCE_MODES,
  DEPENDENCY_TYPES,
  getImportanceWeight,
  IMPORTANCE_LEVELS,
  LIFECYCLES,
  OBSERVATION_CORRECTION_REASONS,
  OBSERVATION_TYPES,
  parseComparisonOperator,
  parseDailyFocusLifecycle,
  parseDailyFocusProvenanceType,
  parseDependencyEndReason,
  parseDependencyOccurrenceMode,
  parseDependencyType,
  parseImportanceLevel,
  parseLifecycle,
  parseObservationCorrectionReason,
  parseObservationType,
  parsePlannerId,
  parsePlannerProgressMode,
  parseReminderTimezoneMode,
  parseScheduleType,
  parseTrackingMode,
  parseUnitType,
  PLANNER_PROGRESS_MODES,
  REMINDER_TIMEZONE_MODES,
  SCHEDULE_TYPES,
  TRACKING_MODES,
  UNIT_TYPES,
  type PlannerDomainError,
  type Result,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

type StoredValueParser = (
  input: unknown,
) => Result<string, PlannerDomainError>;

const storedValueParsers: readonly [
  readonly string[],
  StoredValueParser,
][] = [
  [PLANNER_PROGRESS_MODES, parsePlannerProgressMode],
  [LIFECYCLES, parseLifecycle],
  [LIFECYCLES, parseDailyFocusLifecycle],
  [SCHEDULE_TYPES, parseScheduleType],
  [TRACKING_MODES, parseTrackingMode],
  [COMPARISON_OPERATORS, parseComparisonOperator],
  [UNIT_TYPES, parseUnitType],
  [IMPORTANCE_LEVELS, parseImportanceLevel],
  [DEPENDENCY_TYPES, parseDependencyType],
  [DEPENDENCY_OCCURRENCE_MODES, parseDependencyOccurrenceMode],
  [DEPENDENCY_END_REASONS, parseDependencyEndReason],
  [OBSERVATION_TYPES, parseObservationType],
  [OBSERVATION_CORRECTION_REASONS, parseObservationCorrectionReason],
  [REMINDER_TIMEZONE_MODES, parseReminderTimezoneMode],
  [DAILY_FOCUS_PROVENANCE_TYPES, parseDailyFocusProvenanceType],
];

test('every frozen Planner stored value is accepted at its boundary', () => {
  for (const [values, parser] of storedValueParsers) {
    for (const value of values) {
      assert.equal(expectSuccess(parser(value)), value);
    }
  }
});

test('scheduled dependency expiry is an approved exhaustive stored value', () => {
  assert.ok(DEPENDENCY_END_REASONS.includes('scheduled_end'));
  assert.equal(expectSuccess(parseDependencyEndReason('scheduled_end')), 'scheduled_end');
});

test('unknown persisted values consistently produce typed errors', () => {
  for (const [, parser] of storedValueParsers) {
    const error = expectError(parser('__unsupported__'), 'unsupported_stored_value');
    assert.equal(error.name, 'PlannerDomainError');
    assert.equal(typeof error.message, 'string');
  }
});

test('importance uses the one exhaustive frozen mapping', () => {
  assert.deepEqual(
    IMPORTANCE_LEVELS.map((level) => [level, getImportanceWeight(level)]),
    [
      ['low', 1],
      ['normal', 2],
      ['high', 3],
      ['critical', 4],
    ],
  );
});

test('Planner identifiers accept canonical UUIDs and reject malformed values', () => {
  assert.equal(
    expectSuccess(parsePlannerId('00000000-0000-4000-8000-000000000001')),
    '00000000-0000-4000-8000-000000000001',
  );
  expectError(parsePlannerId('not-a-uuid'), 'invalid_identifier');
  expectError(
    parsePlannerId('00000000-0000-4000-7000-000000000001'),
    'invalid_identifier',
  );
});
