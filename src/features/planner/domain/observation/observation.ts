import type { ExactQuantity } from '../exact-quantity/exact-quantity';
import type { PlannerId } from '../values/planner-id';
import type {
  ObservationCorrectionReason,
  ObservationType,
} from '../values/stored-values';
import type {
  PlannerLocalDate,
  PlannerLocalTime,
  PlannerTimezone,
} from '../values/local-date';

export type ObservationValue =
  | Readonly<{ type: 'checkbox'; booleanValue: boolean }>
  | Readonly<{ type: 'counter'; counterDelta: number }>
  | Readonly<{ type: 'quantity'; quantity: ExactQuantity }>
  | Readonly<{ type: 'duration'; durationSeconds: number }>
  | Readonly<{ type: 'avoidance'; booleanValue: boolean }>
  | Readonly<{ type: 'skipped' }>
  | Readonly<{ type: 'void' }>;

export interface ObservationFact {
  readonly id: PlannerId;
  readonly habitId: PlannerId;
  readonly contextMode?: 'live_independent' | 'live_dependent' | 'detached_dependent';
  readonly scheduleVersionId: PlannerId | null;
  readonly detachedScheduleContextId?: PlannerId | null;
  readonly trackingVersionId: PlannerId;
  readonly importanceVersionId: PlannerId;
  readonly dependencyVersionId: PlannerId | null;
  readonly occurrenceLocalDate: PlannerLocalDate;
  readonly occurrenceLocalTime: PlannerLocalTime | null;
  readonly occurrenceTimezone: PlannerTimezone;
  readonly observationType: ObservationType;
  readonly value: ObservationValue;
  readonly note: string | null;
  readonly supersedesObservationId: PlannerId | null;
  readonly correctionReason: ObservationCorrectionReason | null;
  readonly observedAt: number;
  readonly createdAt: number;
}

export interface ObservationChain {
  readonly root: ObservationFact;
  readonly facts: readonly ObservationFact[];
  readonly currentLeaf: ObservationFact;
  readonly isVoided: boolean;
  readonly measuredType: Exclude<ObservationType, 'skipped' | 'void'> | null;
}
