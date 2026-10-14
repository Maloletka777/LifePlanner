/**
 * The drafts behind the routine-steps sheet.
 *
 * React-free so the ordering rule is tested as behaviour: order is a canonical
 * fact — it decides the order the bundle creates the children in — rather than a
 * detail of how the rows happen to be laid out.
 */
export interface RoutineStepDraft {
  readonly draftId: string;
  readonly name: string;
  readonly plannedTime: string;
}

/** Moves one step, and returns the same list untouched when it cannot. */
export function moveStep(steps: readonly RoutineStepDraft[], index: number, offset: number): readonly RoutineStepDraft[] {
  const target = index + offset;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return steps;
  next.splice(target, 0, moved);
  return Object.freeze(next);
}

/**
 * The list including whatever is still being typed.
 *
 * The entry field is a step the moment it has a name — Return only decides where
 * the cursor goes next. `Done` used to hand over the committed list alone, so a
 * routine typed in one go and confirmed straight away saved nothing at all.
 */
export function withPendingStep(steps: readonly RoutineStepDraft[], pending: string): readonly RoutineStepDraft[] {
  const name = pending.trim();
  return name === ''
    ? steps
    : Object.freeze([...steps, { draftId: `step-pending-${steps.length + 1}`, name, plannedTime: '' }]);
}

/** A step with no name is not a step; it is the empty row at the end of the list. */
export function namedRoutineSteps(steps: readonly RoutineStepDraft[]): readonly RoutineStepDraft[] {
  return Object.freeze(steps.filter((step) => step.name.trim() !== ''));
}
