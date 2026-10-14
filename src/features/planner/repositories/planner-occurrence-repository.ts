import type {
  EffectiveDependencyEdge,
  ObservationChain,
  ObservationScheduleVersionContext,
  ObservationTrackingVersionContext,
  PlannerDayBlock,
  PlannerDurationMinutes,
  PlannerLocalDate,
  PlannerLocalTime,
  PlannerId,
  PlannerOccurrenceHabitInput,
  PlannerOccurrenceImportanceVersionInput,
  PlannerProgressMode,
  OrdinaryCompletionRole,
} from '../domain';
import type { HabitVisualIdentityRecord } from './habit-aggregate';

export interface ApplicablePlannedTime {
  readonly habitId: PlannerId;
  readonly plannedLocalTime: PlannerLocalTime | null;
  /** Whole minutes, or `null` when nobody stated a length for this version. */
  readonly plannedDurationMinutes: PlannerDurationMinutes | null;
  /** Which part of the day, or `null` for an item no part of the day claims. */
  readonly plannedBlock: PlannerDayBlock | null;
}

export interface ApplicableOrdinaryParent {
  readonly parentHabitId: PlannerId;
  readonly childHabitId: PlannerId;
  readonly completionRole: OrdinaryCompletionRole;
}

export interface PlannerOccurrenceDataSet {
  readonly selectedLocalDate: PlannerLocalDate;
  readonly createdHabitCount: number;
  readonly progressMode: PlannerProgressMode;
  readonly habits: readonly PlannerOccurrenceHabitInput[];
  readonly scheduleVersions: readonly ObservationScheduleVersionContext[];
  readonly trackingVersions: readonly ObservationTrackingVersionContext[];
  readonly importanceVersions: readonly PlannerOccurrenceImportanceVersionInput[];
  readonly relationships: readonly EffectiveDependencyEdge[];
  readonly ordinaryParents: readonly ApplicableOrdinaryParent[];
  readonly plannedTimes: readonly ApplicablePlannedTime[];
  readonly visualIdentities: readonly HabitVisualIdentityRecord[];
  readonly observationChains: readonly ObservationChain[];
}
