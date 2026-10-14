import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePlannerId,
  parsePlannerLocalDate,
  resolveDependencyExpectations,
  validateEffectiveRange,
  type DependencyExpectationHabitInput,
  type EffectiveDependencyEdge,
  type HabitQualificationResult,
  type PlannerId,
} from '../../../src/features/planner/domain';
import { expectError, expectSuccess } from './test-helpers';

const ROOT = id(1);
const CHILD = id(2);
const DATE = expectSuccess(parsePlannerLocalDate('2026-08-03'));
const RANGE = expectSuccess(
  validateEffectiveRange({ effectiveFrom: '2026-08-01', effectiveTo: null }),
);

test('scheduled root is expected and incomplete', () => {
  assert.equal(resolve({ [ROOT]: qualification('no_current_fact') }).rows[0].state, 'expected_incomplete');
});

test('qualified root resolves as qualified', () => {
  assert.equal(resolve({ [ROOT]: qualification('qualified') }).rows[0].state, 'qualified');
});

test('follow-up is blocked before parent qualification', () => {
  assert.equal(
    row(resolve({ [ROOT]: qualification('incomplete'), [CHILD]: qualification('no_current_fact') }, [edge(ROOT, CHILD, 'follow_up')]), CHILD).state,
    'blocked',
  );
});

test('follow-up becomes expected only after full parent qualification', () => {
  assert.equal(
    row(resolve({ [ROOT]: qualification('qualified'), [CHILD]: qualification('no_current_fact') }, [edge(ROOT, CHILD, 'follow_up')]), CHILD).state,
    'expected_incomplete',
  );
});

test('activated follow-up remains incomplete without its own fact', () => {
  const result = resolve(
    { [ROOT]: qualification('qualified'), [CHILD]: qualification('no_current_fact') },
    [edge(ROOT, CHILD, 'follow_up')],
  );
  assert.equal(row(result, CHILD).reason, 'no_current_fact');
});

test('follow-up qualifies only from its own fact', () => {
  const result = resolve(
    { [ROOT]: qualification('qualified'), [CHILD]: qualification('qualified') },
    [edge(ROOT, CHILD, 'follow_up')],
  );
  assert.equal(row(result, CHILD).state, 'qualified');
});

test('prerequisite is expected from occurrence start', () => {
  const result = resolve(
    { [ROOT]: qualification('incomplete'), [CHILD]: qualification('no_current_fact') },
    [edge(ROOT, CHILD, 'prerequisite')],
  );
  assert.equal(row(result, CHILD).state, 'expected_incomplete');
});

test('qualifying parent fact remains prerequisite-blocked while prerequisite is incomplete', () => {
  const result = resolve(
    { [ROOT]: qualification('qualified'), [CHILD]: qualification('incomplete') },
    [edge(ROOT, CHILD, 'prerequisite')],
  );
  assert.equal(row(result, ROOT).state, 'prerequisite_blocked_parent');
});

test('parent qualifies when its own fact and every prerequisite qualify', () => {
  const result = resolve(
    { [ROOT]: qualification('qualified'), [CHILD]: qualification('qualified') },
    [edge(ROOT, CHILD, 'prerequisite')],
  );
  assert.equal(row(result, ROOT).state, 'qualified');
});

test('incomplete follow-up does not undo parent qualification', () => {
  const result = resolve(
    { [ROOT]: qualification('qualified'), [CHILD]: qualification('incomplete') },
    [edge(ROOT, CHILD, 'follow_up')],
  );
  assert.equal(row(result, ROOT).state, 'qualified');
  assert.equal(row(result, CHILD).state, 'expected_incomplete');
});

test('nested follow-up chain activates in order', () => {
  const third = id(3);
  const relationships = [
    edge(ROOT, CHILD, 'follow_up'),
    edge(CHILD, third, 'follow_up'),
  ];
  const blocked = resolve(
    {
      [ROOT]: qualification('qualified'),
      [CHILD]: qualification('incomplete'),
      [third]: qualification('qualified'),
    },
    relationships,
  );
  assert.equal(row(blocked, CHILD).state, 'expected_incomplete');
  assert.equal(row(blocked, third).state, 'blocked');
  const active = resolve(
    {
      [ROOT]: qualification('qualified'),
      [CHILD]: qualification('qualified'),
      [third]: qualification('incomplete'),
    },
    relationships,
  );
  assert.equal(row(active, third).state, 'expected_incomplete');
});

test('nested prerequisite and follow-up mixture resolves deterministically', () => {
  const followUp = id(3);
  const nestedPrerequisite = id(4);
  const relationships = [
    edge(ROOT, CHILD, 'prerequisite'),
    edge(ROOT, followUp, 'follow_up'),
    edge(followUp, nestedPrerequisite, 'prerequisite'),
  ];
  const result = resolve(
    {
      [ROOT]: qualification('qualified'),
      [CHILD]: qualification('qualified'),
      [followUp]: qualification('qualified'),
      [nestedPrerequisite]: qualification('incomplete'),
    },
    relationships,
  );
  assert.equal(row(result, ROOT).state, 'qualified');
  assert.equal(row(result, followUp).state, 'prerequisite_blocked_parent');
  assert.equal(row(result, nestedPrerequisite).state, 'expected_incomplete');
});

test('five-edge graph resolves', () => {
  const nodes = [ROOT, id(2), id(3), id(4), id(5), id(6)];
  const relationships = nodes.slice(0, -1).map((parent, index) =>
    edge(parent, nodes[index + 1], 'follow_up', index + 1),
  );
  const qualifications = Object.fromEntries(
    nodes.map((habitId) => [habitId, qualification('qualified')]),
  );
  assert.equal(resolve(qualifications, relationships).rows.length, 6);
});

test('impossible persisted cycle fails as data integrity', () => {
  const result = resolveDependencyExpectations({
    selectedLocalDate: DATE,
    rootHabitId: ROOT,
    rootOccurrenceScheduled: true,
    habits: habits({
      [ROOT]: qualification('qualified'),
      [CHILD]: qualification('qualified'),
    }),
    relationships: [
      edge(ROOT, CHILD, 'follow_up'),
      edge(CHILD, ROOT, 'follow_up', 2),
    ],
  });
  expectError(result, 'expectation_cycle_detected');
});

test('persisted depth beyond five fails as data integrity', () => {
  const nodes = [ROOT, id(2), id(3), id(4), id(5), id(6), id(7)];
  const result = resolveDependencyExpectations({
    selectedLocalDate: DATE,
    rootHabitId: ROOT,
    rootOccurrenceScheduled: true,
    habits: habits(
      Object.fromEntries(nodes.map((habitId) => [habitId, qualification('qualified')])),
    ),
    relationships: nodes.slice(0, -1).map((parent, index) =>
      edge(parent, nodes[index + 1], 'follow_up', index + 1),
    ),
  });
  expectError(result, 'expectation_depth_exceeded');
});

test('skipped parent does not activate follow-up', () => {
  const result = resolve(
    {
      [ROOT]: qualification('skipped_policy_unresolved'),
      [CHILD]: qualification('qualified'),
    },
    [edge(ROOT, CHILD, 'follow_up')],
  );
  assert.equal(row(result, ROOT).state, 'skipped_policy_unresolved');
  assert.equal(row(result, CHILD).state, 'blocked');
});

test('provisional at-most parent does not activate follow-up', () => {
  const result = resolve(
    { [ROOT]: qualification('provisional'), [CHILD]: qualification('qualified') },
    [edge(ROOT, CHILD, 'follow_up')],
  );
  assert.equal(row(result, ROOT).state, 'provisional');
  assert.equal(row(result, CHILD).state, 'blocked');
});

test('relationship input ordering does not change resolved output', () => {
  const second = id(3);
  const relationships = [
    edge(ROOT, CHILD, 'prerequisite'),
    edge(ROOT, second, 'follow_up', 2),
  ];
  const qualifications = {
    [ROOT]: qualification('qualified'),
    [CHILD]: qualification('qualified'),
    [second]: qualification('incomplete'),
  };
  assert.deepEqual(
    resolve(qualifications, relationships),
    resolve(qualifications, [...relationships].reverse()),
  );
});

function resolve(
  qualifications: Readonly<Record<string, HabitQualificationResult>>,
  relationships: readonly EffectiveDependencyEdge[] = [],
) {
  return expectSuccess(
    resolveDependencyExpectations({
      selectedLocalDate: DATE,
      rootHabitId: ROOT,
      rootOccurrenceScheduled: true,
      habits: habits(qualifications),
      relationships,
    }),
  );
}

function habits(
  qualifications: Readonly<Record<string, HabitQualificationResult>>,
): DependencyExpectationHabitInput[] {
  return Object.entries(qualifications).map(([habitId, value], index) => ({
    habitId: habitId as PlannerId,
    sortOrder: index,
    qualification: value,
  }));
}

function row(
  result: ReturnType<typeof resolve>,
  habitId: PlannerId,
) {
  const found = result.rows.find((candidate) => candidate.habitId === habitId);
  assert.ok(found);
  return found;
}

function qualification(
  state: HabitQualificationResult['state'],
): HabitQualificationResult {
  return Object.freeze({
    state,
    actual: null,
    currentLeafCount: state === 'no_current_fact' || state === 'voided' ? 0 : 1,
    currentLeafIds: Object.freeze([]),
  });
}

function edge(
  parentHabitId: PlannerId,
  dependentHabitId: PlannerId,
  dependencyType: 'follow_up' | 'prerequisite',
  seed = 1,
): EffectiveDependencyEdge {
  return Object.freeze({
    relationshipId: id(100 + seed),
    relationshipVersionId: id(200 + seed),
    parentHabitId,
    dependentHabitId,
    dependencyType,
    occurrenceMode: 'inherited_parent',
    effectiveRange: RANGE,
  });
}

function id(seed: number): PlannerId {
  return expectSuccess(
    parsePlannerId(`00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`),
  );
}
