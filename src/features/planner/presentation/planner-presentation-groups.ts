import type { PlannerId } from '../domain';
import type { SelectedDatePlannerRootGroup } from '../application';

export interface PlannerPresentationGroup {
  readonly root: SelectedDatePlannerRootGroup;
  readonly ordinaryChildren: readonly SelectedDatePlannerRootGroup[];
}

/**
 * Presentation-only composition. Canonical occurrence rows and group progress
 * remain untouched; ordinary child root groups are merely nested for display.
 */
export function composePlannerPresentationGroups(groups: readonly SelectedDatePlannerRootGroup[]): readonly PlannerPresentationGroup[] {
  const byRoot = new Map(groups.map((group) => [group.rootHabitId, group] as const));
  const childrenByParent = new Map<PlannerId, SelectedDatePlannerRootGroup[]>();
  const topLevel: SelectedDatePlannerRootGroup[] = [];
  for (const group of groups) {
    const parentId = group.rows[0]?.ordinaryParentHabitId ?? null;
    if (parentId === null || !byRoot.has(parentId)) {
      topLevel.push(group);
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(group);
    childrenByParent.set(parentId, children);
  }
  const descendants = (rootId: PlannerId): readonly SelectedDatePlannerRootGroup[] => {
    const result: SelectedDatePlannerRootGroup[] = [];
    const visit = (parentId: PlannerId) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        result.push(child);
        visit(child.rootHabitId);
      }
    };
    visit(rootId);
    return Object.freeze(result);
  };
  return Object.freeze(topLevel.map((root) => Object.freeze({ root, ordinaryChildren: descendants(root.rootHabitId) })));
}
