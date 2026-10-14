import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePlannerId,
  parsePlannerLocalDate,
  validateDependencyGraph,
  validateEffectiveRange,
  type DependencyGraphValidationErrorCode,
  type EffectiveDependencyEdge,
  type PlannerId,
  type PlannerLocalDate,
} from '../../../src/features/planner/domain';
import { expectSuccess } from './test-helpers';

const JAN = date('2026-01-01');
const FEB = date('2026-02-01');
const MAR = date('2026-03-01');
const APR = date('2026-04-01');
const MAY = date('2026-05-01');

test('valid follow-up A to B is accepted', () => {
  assert.equal(validateDependencyGraph([], edge(1, 2)).ok, true);
});

test('valid prerequisite A to B is accepted', () => {
  assert.equal(validateDependencyGraph([], edge(1, 2, JAN, null, 'prerequisite')).ok, true);
});

test('a self-link is rejected', () => {
  expectGraphError([], edge(1, 1), 'dependency_self_link');
});

test('an applicable duplicate parent/dependent pair is rejected', () => {
  expectGraphError([edge(1, 2)], edge(1, 2), 'dependency_duplicate_relationship');
});

test('a second applicable parent is rejected', () => {
  expectGraphError([edge(3, 2)], edge(1, 2), 'dependency_second_active_parent');
});

test('adjacent historical incoming parents are accepted', () => {
  const result = validateDependencyGraph(
    [edge(3, 2, JAN, FEB)],
    edge(1, 2, FEB),
  );
  assert.equal(result.ok, true);
});

test('overlapping historical incoming parents are rejected', () => {
  expectGraphError(
    [edge(3, 2, JAN, MAR)],
    edge(1, 2, FEB, APR),
    'dependency_second_active_parent',
  );
});

test('a direct cycle is rejected', () => {
  expectGraphError([edge(2, 1)], edge(1, 2), 'dependency_cycle');
});

test('an indirect three-edge cycle is rejected', () => {
  expectGraphError(
    [edge(2, 3), edge(3, 1)],
    edge(1, 2),
    'dependency_cycle',
  );
});

test('a longer indirect cycle is rejected', () => {
  expectGraphError(
    [edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 1)],
    edge(1, 2),
    'dependency_cycle',
  );
});

test('a cycle present only during one candidate partition is rejected', () => {
  const error = expectGraphError(
    [edge(2, 3, MAR, APR), edge(3, 1, MAR, APR)],
    edge(1, 2, FEB, MAY),
    'dependency_cycle',
  );
  assert.equal(error.details.interval.effectiveFrom, MAR);
  assert.equal(error.details.interval.effectiveTo, APR);
});

test('a one-edge path is accepted', () => {
  const result = validateDependencyGraph([], edge(1, 2));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.maximumDepth, 1);
});

test('a five-edge path is accepted', () => {
  const result = validateDependencyGraph(
    [edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 6)],
    edge(1, 2),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.maximumDepth, 5);
});

test('a sixth edge is rejected', () => {
  expectGraphError(
    [edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 6), edge(6, 7)],
    edge(1, 2),
    'dependency_depth_exceeded',
  );
});

test('depth through ancestors above the candidate parent is rejected', () => {
  expectGraphError(
    [edge(1, 2), edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 6)],
    edge(6, 7),
    'dependency_depth_exceeded',
  );
});

test('depth through descendants below the candidate dependent is rejected', () => {
  expectGraphError(
    [edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 6), edge(6, 7)],
    edge(1, 2),
    'dependency_depth_exceeded',
  );
});

test('depth through both sides of the candidate is rejected', () => {
  expectGraphError(
    [edge(1, 2), edge(2, 3), edge(4, 5), edge(5, 6), edge(6, 7)],
    edge(3, 4),
    'dependency_depth_exceeded',
  );
});

test('validation outcome is deterministic regardless of input-edge ordering', () => {
  const existing = [edge(2, 3), edge(3, 4), edge(4, 1)];
  const candidate = edge(1, 2);
  const forward = validateDependencyGraph(existing, candidate);
  const reversed = validateDependencyGraph([...existing].reverse(), candidate);
  assert.equal(forward.ok, false);
  assert.deepEqual(reversed, forward);
});

test('an open-ended candidate partitions all later topology boundaries', () => {
  const result = validateDependencyGraph(
    [edge(8, 9, FEB, MAR), edge(10, 11, APR, null)],
    edge(1, 2, JAN),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.intervals, [
      { effectiveFrom: JAN, effectiveTo: FEB },
      { effectiveFrom: FEB, effectiveTo: MAR },
      { effectiveFrom: MAR, effectiveTo: APR },
      { effectiveFrom: APR, effectiveTo: null },
    ]);
  }
});

test('a finite candidate ends at its exclusive boundary', () => {
  const result = validateDependencyGraph(
    [edge(8, 9, FEB, MAR)],
    edge(1, 2, JAN, APR),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.intervals.at(-1)?.effectiveTo, APR);
  }
});

test('non-intersecting historical edges are ignored', () => {
  const result = validateDependencyGraph(
    [edge(2, 1, JAN, FEB)],
    edge(1, 2, FEB, MAR),
  );
  assert.equal(result.ok, true);
});

test('a duplicate conflict in only one finite partition is rejected', () => {
  const error = expectGraphError(
    [edge(1, 2, MAR, APR)],
    edge(1, 2, FEB, MAY),
    'dependency_duplicate_relationship',
  );
  assert.equal(error.details.interval.effectiveFrom, MAR);
});

test('a second-parent conflict in only one finite partition is rejected', () => {
  const error = expectGraphError(
    [edge(3, 2, MAR, APR)],
    edge(1, 2, FEB, MAY),
    'dependency_second_active_parent',
  );
  assert.equal(error.details.interval.effectiveFrom, MAR);
});

test('a depth conflict in only one finite partition is rejected', () => {
  const error = expectGraphError(
    [
      edge(2, 3, MAR, APR),
      edge(3, 4, MAR, APR),
      edge(4, 5, MAR, APR),
      edge(5, 6, MAR, APR),
      edge(6, 7, MAR, APR),
    ],
    edge(1, 2, FEB, MAY),
    'dependency_depth_exceeded',
  );
  assert.equal(error.details.interval.effectiveFrom, MAR);
  assert.equal(error.details.maximumDepth, 6);
});

function edge(
  parent: number,
  dependent: number,
  effectiveFrom = JAN,
  effectiveTo: PlannerLocalDate | null = null,
  dependencyType: 'follow_up' | 'prerequisite' = 'follow_up',
): EffectiveDependencyEdge {
  const relationshipSeed =
    10_000 + parent * 100 + dependent * 10 + month(effectiveFrom);
  return Object.freeze({
    relationshipId: id(relationshipSeed),
    relationshipVersionId: id(relationshipSeed + 100_000),
    parentHabitId: id(parent),
    dependentHabitId: id(dependent),
    dependencyType,
    occurrenceMode: 'inherited_parent',
    effectiveRange: expectSuccess(
      validateEffectiveRange({ effectiveFrom, effectiveTo }),
    ),
  });
}

function expectGraphError(
  existing: readonly EffectiveDependencyEdge[],
  candidate: EffectiveDependencyEdge,
  code: DependencyGraphValidationErrorCode,
) {
  const result = validateDependencyGraph(existing, candidate);
  if (result.ok) assert.fail(`Expected ${code}, received success.`);
  assert.equal(result.error.code, code);
  return result.error;
}

function id(value: number): PlannerId {
  return expectSuccess(
    parsePlannerId(
      `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`,
    ),
  );
}

function date(value: string): PlannerLocalDate {
  return expectSuccess(parsePlannerLocalDate(value));
}

function month(value: PlannerLocalDate): number {
  return Number(value.slice(5, 7));
}
