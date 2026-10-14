import type {
  PlannerId,
  PlannerLocalDate,
} from '../domain';

export interface HabitGroupDisclosureState {
  readonly selectedDate: PlannerLocalDate;
  readonly expandedRootIds: ReadonlySet<PlannerId>;
}

export type HabitGroupDisclosureAction =
  | Readonly<{ type: 'toggle'; rootId: PlannerId }>
  | Readonly<{ type: 'reveal'; rootId: PlannerId }>
  | Readonly<{
      type: 'canonical_refresh';
      selectedDate: PlannerLocalDate;
      canonicalRootIds: readonly PlannerId[];
    }>
  | Readonly<{ type: 'selected_date_changed'; selectedDate: PlannerLocalDate }>;

export function createHabitGroupDisclosureState(
  selectedDate: PlannerLocalDate,
): HabitGroupDisclosureState {
  return disclosureState(selectedDate, []);
}

export function habitGroupIsExpanded(
  state: HabitGroupDisclosureState,
  rootId: PlannerId,
): boolean {
  return state.expandedRootIds.has(rootId);
}

export function reduceHabitGroupDisclosureState(
  state: HabitGroupDisclosureState,
  action: HabitGroupDisclosureAction,
): HabitGroupDisclosureState {
  switch (action.type) {
    case 'toggle': {
      const expandedRootIds = new Set(state.expandedRootIds);
      if (expandedRootIds.has(action.rootId)) {
        expandedRootIds.delete(action.rootId);
      } else {
        expandedRootIds.add(action.rootId);
      }
      return disclosureState(state.selectedDate, expandedRootIds);
    }
    case 'reveal': {
      if (state.expandedRootIds.has(action.rootId)) return state;
      return disclosureState(state.selectedDate, [...state.expandedRootIds, action.rootId]);
    }
    case 'canonical_refresh': {
      if (action.selectedDate !== state.selectedDate) {
        return createHabitGroupDisclosureState(action.selectedDate);
      }
      const canonicalRootIds = new Set(action.canonicalRootIds);
      return disclosureState(
        state.selectedDate,
        [...state.expandedRootIds].filter((rootId) => canonicalRootIds.has(rootId)),
      );
    }
    case 'selected_date_changed':
      return action.selectedDate === state.selectedDate
        ? state
        : createHabitGroupDisclosureState(action.selectedDate);
  }
}

function disclosureState(
  selectedDate: PlannerLocalDate,
  expandedRootIds: Iterable<PlannerId>,
): HabitGroupDisclosureState {
  return Object.freeze({
    selectedDate,
    expandedRootIds: new Set(expandedRootIds),
  });
}
