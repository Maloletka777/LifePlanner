import type {
  ObservationCorrectionReason,
  ObservationValue,
  PlannerId,
  PlannerLocalDate,
  PlannerLocalTime,
  PlannerTimezone,
} from '../../domain';

export interface CorrectHabitObservationCommand {
  readonly observationId: PlannerId;
  readonly correctionReason: ObservationCorrectionReason;
  readonly correctedOccurrenceLocalDate: PlannerLocalDate;
  readonly correctedOccurrenceLocalTime?: PlannerLocalTime | null;
  readonly correctedOccurrenceTimezone: PlannerTimezone;
  readonly correctedNote?: string | null;
  readonly replacement: ObservationValue;
}
