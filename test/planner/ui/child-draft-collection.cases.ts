import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendChildDraft,
  beginChildDraftEdit,
  cancelChildDraftEdit,
  createChildDraftCollection,
  finishChildDraftEdit,
  moveChildDraft,
  removeChildDraft,
  updateChildDraft,
  type ChildHabitDraft,
} from '../../../src/features/planner/presentation/child-draft-collection';
import {
  buildCreateHabitCommand,
  createDefaultScheduleDraft,
  createDefaultTrackingDraft,
  type ParentHabitDraft,
} from '../../../src/features/planner/presentation/ui-adapters';

test('child draft collection appends ordered stable IDs for 0, 1, 2, 5, and 10 children', () => {
  let collection = createChildDraftCollection();
  assert.equal(collection.items.length, 0);
  for (let index = 1; index <= 10; index += 1) {
    collection = appendChildDraft(finishChildDraftEdit(collection), child(index));
    if ([1, 2, 5, 10].includes(index)) assert.equal(collection.items.length, index);
    assert.deepEqual(collection.items.map(({ draftId }) => draftId), Array.from({ length: index }, (_, itemIndex) => `child-${itemIndex + 1}`));
  }
});

test('any child can be edited, removed, reordered, or cancelled without losing siblings', () => {
  let collection = createChildDraftCollection([child(1), child(2), child(3), child(4), child(5)]);
  collection = beginChildDraftEdit(collection, 'child-3');
  collection = updateChildDraft(collection, 'child-3', { ...collection.items[2]!, habit: { ...collection.items[2]!.habit, name: 'Edited third' } });
  collection = finishChildDraftEdit(collection);
  assert.equal(collection.items[2]?.habit.name, 'Edited third');

  collection = beginChildDraftEdit(collection, 'child-3');
  collection = updateChildDraft(collection, 'child-3', { ...collection.items[2]!, habit: { ...collection.items[2]!.habit, name: 'Discard me' } });
  collection = cancelChildDraftEdit(collection);
  assert.equal(collection.items[2]?.habit.name, 'Edited third');

  collection = moveChildDraft(collection, 'child-5', -1);
  assert.deepEqual(collection.items.map(({ draftId }) => draftId), ['child-1', 'child-2', 'child-3', 'child-5', 'child-4']);
  collection = removeChildDraft(collection, 'child-2');
  assert.deepEqual(collection.items.map(({ draftId }) => draftId), ['child-1', 'child-3', 'child-5', 'child-4']);
});

test('cancelling a newly appended child removes only that unsaved row and retains the complete prior draft', () => {
  const before = createChildDraftCollection([child(1), child(2)]);
  const editing = appendChildDraft(before, child(3));
  const cancelled = cancelChildDraftEdit(editing);
  assert.deepEqual(cancelled.items, before.items);
  assert.equal(cancelled.editingDraftId, null);
});

test('an invalid child reopens by stable ID while every parent and sibling draft remains available', () => {
  const parent = habit('Parent');
  let collection = createChildDraftCollection([child(1), child(2), { ...child(3), habit: habit('') }, child(4), child(5)]);
  const built = [parent, ...collection.items.map(({ habit: draft }) => draft)].map((draft) => buildCreateHabitCommand(draft, 'Europe/London'));
  const invalidIndex = built.findIndex((result) => !result.ok);
  assert.equal(invalidIndex, 3);
  const invalidDraft = collection.items[invalidIndex - 1]!;
  collection = beginChildDraftEdit(collection, invalidDraft.draftId);
  assert.equal(collection.editingDraftId, 'child-3');
  assert.equal(collection.items.length, 5);
  assert.equal(parent.name, 'Parent');
});

function child(index: number): ChildHabitDraft {
  return Object.freeze({
    draftId: `child-${index}`,
    relationshipMode: 'ordinary' as const,
    habit: habit(`Child ${index}`),
  });
}

function habit(name: string): ParentHabitDraft {
  return {
    name,
    description: '',
    activeRange: { activeFrom: '2026-08-01', activeTo: '2026-09-01' },
    schedule: createDefaultScheduleDraft('2026-08-01'),
    tracking: createDefaultTrackingDraft(),
    importance: 'normal',
    plannedTime: '',
  };
}
