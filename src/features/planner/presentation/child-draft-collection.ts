import type { ParentHabitDraft } from './ui-adapters';

export type ChildRelationshipMode = 'ordinary' | 'follow_up' | 'prerequisite' | 'independent';

export interface ChildHabitDraft {
  readonly draftId: string;
  readonly relationshipMode: ChildRelationshipMode;
  readonly habit: ParentHabitDraft;
}

export interface ChildDraftCollection {
  readonly items: readonly ChildHabitDraft[];
  readonly editingDraftId: string | null;
  readonly editSnapshot: ChildHabitDraft | null;
}

export function createChildDraftCollection(
  items: readonly ChildHabitDraft[] = [],
): ChildDraftCollection {
  assertUniqueDraftIds(items);
  return freezeCollection(items, null, null);
}

export function appendChildDraft(
  collection: ChildDraftCollection,
  draft: ChildHabitDraft,
): ChildDraftCollection {
  if (collection.items.some(({ draftId }) => draftId === draft.draftId)) {
    throw new Error('A child draft identifier must be unique.');
  }
  return freezeCollection([...collection.items, freezeDraft(draft)], draft.draftId, null);
}

export function beginChildDraftEdit(
  collection: ChildDraftCollection,
  draftId: string,
): ChildDraftCollection {
  const draft = childDraftById(collection, draftId);
  if (draft === null) return collection;
  return freezeCollection(collection.items, draftId, freezeDraft(draft));
}

export function updateChildDraft(
  collection: ChildDraftCollection,
  draftId: string,
  next: ChildHabitDraft,
): ChildDraftCollection {
  if (next.draftId !== draftId) throw new Error('A child draft identifier is immutable.');
  if (!collection.items.some((draft) => draft.draftId === draftId)) return collection;
  return freezeCollection(
    collection.items.map((draft) => draft.draftId === draftId ? freezeDraft(next) : draft),
    collection.editingDraftId,
    collection.editSnapshot,
  );
}

export function finishChildDraftEdit(collection: ChildDraftCollection): ChildDraftCollection {
  return freezeCollection(collection.items, null, null);
}

export function cancelChildDraftEdit(collection: ChildDraftCollection): ChildDraftCollection {
  if (collection.editingDraftId === null) return collection;
  if (collection.editSnapshot === null) {
    return freezeCollection(
      collection.items.filter(({ draftId }) => draftId !== collection.editingDraftId),
      null,
      null,
    );
  }
  return freezeCollection(
    collection.items.map((draft) => draft.draftId === collection.editingDraftId ? collection.editSnapshot! : draft),
    null,
    null,
  );
}

export function removeChildDraft(
  collection: ChildDraftCollection,
  draftId: string,
): ChildDraftCollection {
  const items = collection.items.filter((draft) => draft.draftId !== draftId);
  if (items.length === collection.items.length) return collection;
  return freezeCollection(
    items,
    collection.editingDraftId === draftId ? null : collection.editingDraftId,
    collection.editingDraftId === draftId ? null : collection.editSnapshot,
  );
}

export function moveChildDraft(
  collection: ChildDraftCollection,
  draftId: string,
  offset: -1 | 1,
): ChildDraftCollection {
  const index = collection.items.findIndex((draft) => draft.draftId === draftId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= collection.items.length) return collection;
  const items = [...collection.items];
  const [moved] = items.splice(index, 1);
  items.splice(target, 0, moved!);
  return freezeCollection(items, collection.editingDraftId, collection.editSnapshot);
}

export function childDraftById(
  collection: ChildDraftCollection,
  draftId: string,
): ChildHabitDraft | null {
  return collection.items.find((draft) => draft.draftId === draftId) ?? null;
}

function freezeCollection(
  items: readonly ChildHabitDraft[],
  editingDraftId: string | null,
  editSnapshot: ChildHabitDraft | null,
): ChildDraftCollection {
  assertUniqueDraftIds(items);
  return Object.freeze({
    items: Object.freeze(items.map(freezeDraft)),
    editingDraftId,
    editSnapshot: editSnapshot === null ? null : freezeDraft(editSnapshot),
  });
}

function freezeDraft(draft: ChildHabitDraft): ChildHabitDraft {
  if (typeof draft.draftId !== 'string' || draft.draftId.trim() === '') {
    throw new Error('A child draft identifier is required.');
  }
  return Object.freeze({ ...draft, habit: Object.freeze({ ...draft.habit }) });
}

function assertUniqueDraftIds(items: readonly ChildHabitDraft[]): void {
  if (new Set(items.map(({ draftId }) => draftId)).size !== items.length) {
    throw new Error('Child draft identifiers must be unique.');
  }
}
