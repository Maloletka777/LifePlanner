import assert from 'node:assert/strict';
import test from 'node:test';

import { finishPlannerPendingAction, runPlannerPresentationAction, tryBeginPlannerPendingAction } from '../../../src/features/planner/presentation/planner-action-runner';

test('Planner presentation actions preserve typed command failures', async () => {
  assert.deepEqual(await runPlannerPresentationAction(async () => ({ ok: false, message: 'Visible failure' })), {
    ok: false,
    message: 'Visible failure',
  });
});

test('Planner pending-action guard accepts one press and rejects a rapid duplicate', () => {
  const pending = new Set<string>();
  assert.equal(tryBeginPlannerPendingAction(pending, 'habit'), true);
  assert.equal(tryBeginPlannerPendingAction(pending, 'habit'), false);
  assert.equal(tryBeginPlannerPendingAction(pending, 'other-habit'), true);
  finishPlannerPendingAction(pending, 'habit');
  assert.equal(tryBeginPlannerPendingAction(pending, 'habit'), true);
});

test('Planner presentation actions convert unexpected rejection into visible non-success', async () => {
  const result = await runPlannerPresentationAction(async () => {
    throw new Error('private implementation detail');
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /did not complete/i);
    assert.match(result.message, /No success was recorded/i);
    assert.doesNotMatch(result.message, /private implementation detail/);
  }
});
