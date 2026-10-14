export type PlannerPresentationActionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

export async function runPlannerPresentationAction(
  action: () => Promise<PlannerPresentationActionResult>,
): Promise<PlannerPresentationActionResult> {
  try {
    return await action();
  } catch {
    return Object.freeze({
      ok: false,
      message: 'The Planner action did not complete. No success was recorded. Try again.',
    });
  }
}

export function tryBeginPlannerPendingAction(
  pendingKeys: Set<string>,
  key: string,
): boolean {
  if (pendingKeys.has(key)) return false;
  pendingKeys.add(key);
  return true;
}

export function finishPlannerPendingAction(
  pendingKeys: Set<string>,
  key: string,
): void {
  pendingKeys.delete(key);
}
