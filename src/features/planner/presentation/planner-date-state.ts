import type { PlannerLocalDate } from '@/src/features/planner';

import { movePlannerDate, PLANNER_DATE_RAIL_VISIBLE_CELLS } from './ui-adapters';

export const PLANNER_MARKER_RANGE_RADIUS = 4;

/**
 * Half of the seven days the rail shows around its anchor.
 *
 * Derived rather than written down: the window the user can tap is exactly the
 * window the rail renders, and one of the two must not drift from the other.
 */
export const PLANNER_RAIL_WINDOW_RADIUS = Math.floor(PLANNER_DATE_RAIL_VISIBLE_CELLS / 2);

/** Whether a date is one of the seven the rail is currently showing. */
export function isPlannerDateInRailWindow(
  railAnchorDate: PlannerLocalDate,
  date: PlannerLocalDate,
  radius = PLANNER_RAIL_WINDOW_RADIUS,
): boolean {
  return date >= movePlannerDate(railAnchorDate, -radius)
    && date <= movePlannerDate(railAnchorDate, radius);
}

export interface PlannerVisibleDateRange {
  readonly startDate: PlannerLocalDate;
  readonly endDate: PlannerLocalDate;
}

export interface PlannerDateState {
  readonly selectedDate: PlannerLocalDate;
  readonly railAnchorDate: PlannerLocalDate;
  readonly visibleDateRange: PlannerVisibleDateRange;
}

export type PlannerDateAction =
  | Readonly<{ type: 'browse'; railAnchorDate: PlannerLocalDate }>
  | Readonly<{ type: 'select'; selectedDate: PlannerLocalDate }>
  | Readonly<{ type: 'today'; today: PlannerLocalDate }>;

export function createPlannerDateState(date: PlannerLocalDate): PlannerDateState {
  return Object.freeze({
    selectedDate: date,
    railAnchorDate: date,
    visibleDateRange: plannerVisibleDateRange(date),
  });
}

export function plannerVisibleDateRange(
  railAnchorDate: PlannerLocalDate,
  radius = PLANNER_MARKER_RANGE_RADIUS,
): PlannerVisibleDateRange {
  return Object.freeze({
    startDate: movePlannerDate(railAnchorDate, -radius),
    endDate: movePlannerDate(railAnchorDate, radius),
  });
}

export function reducePlannerDateState(
  state: PlannerDateState,
  action: PlannerDateAction,
): PlannerDateState {
  const nextDate = action.type === 'browse'
    ? action.railAnchorDate
    : action.type === 'select'
      ? action.selectedDate
      : action.today;

  if (action.type === 'browse') {
    if (state.railAnchorDate === nextDate) return state;
    return Object.freeze({
      ...state,
      railAnchorDate: nextDate,
      visibleDateRange: plannerVisibleDateRange(nextDate),
    });
  }

  // Return to Today is the one selection that also brings the rail back, because
  // its whole purpose is to end up looking at today rather than merely owning it.
  if (action.type === 'today') {
    if (state.selectedDate === nextDate && state.railAnchorDate === nextDate) return state;
    return createPlannerDateState(nextDate);
  }

  // Selecting the date already selected is not an event; where the rail happens to
  // be scrolled is the rail's business, not the selection's.
  if (state.selectedDate === nextDate) return state;

  // Selecting a date the rail is already showing leaves the anchor where it is, so
  // the dates stay put and one pill travels between them. Re-anchoring on every tap
  // rebuilt the window under the finger: the old and new slots never existed in the
  // same frame, which is why the pill could only ever be repainted in place. A date
  // further away — the month sheet, a deep link — still re-anchors, and there the
  // pill flies in from beyond the rail edge instead.
  if (isPlannerDateInRailWindow(state.railAnchorDate, nextDate)) {
    return Object.freeze({ ...state, selectedDate: nextDate });
  }

  return createPlannerDateState(nextDate);
}
