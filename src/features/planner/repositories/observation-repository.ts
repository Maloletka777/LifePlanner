import type {
  IndependentObservationContext,
  ObservationChain,
  ObservationFact,
  ObservationValue,
  PlannerId,
  PlannerLocalDate,
  PlannerLocalTime,
  PlannerTimezone,
  ObservationCorrectionReason,
} from '../domain';

export interface RecordObservationPersistenceInput {
  readonly observationId: PlannerId;
  readonly habitId: PlannerId;
  readonly occurrenceLocalDate: PlannerLocalDate;
  readonly occurrenceLocalTime: PlannerLocalTime | null;
  readonly occurrenceTimezone: PlannerTimezone;
  readonly note: string | null;
  readonly value: ObservationValue;
  readonly observedAt: number;
  readonly createdAt: number;
}

export interface CorrectObservationPersistenceInput {
  readonly observationId: PlannerId;
  readonly selectedObservationId: PlannerId;
  readonly correctionReason: ObservationCorrectionReason;
  readonly occurrenceLocalDate: PlannerLocalDate;
  readonly occurrenceLocalTime: PlannerLocalTime | null;
  readonly occurrenceTimezone: PlannerTimezone;
  readonly note: string | null;
  readonly value: ObservationValue;
  readonly observedAt: number;
  readonly createdAt: number;
}

export type ApplicableObservationContextReadModel = IndependentObservationContext;

export type ObservationRecordReadModel = ObservationFact;
export type ObservationCorrectionReadModel = ObservationChain;
