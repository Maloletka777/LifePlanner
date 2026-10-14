import type {
  ObservationValue,
  PlannerId,
  PlannerLocalDate,
  PlannerLocalTime,
  PlannerTimezone,
} from '../../domain';

export type RecordableObservationValue = Exclude<ObservationValue, { type: 'void' }>;

export interface RecordHabitObservationCommand {
  readonly habitId: PlannerId;
  readonly occurrenceLocalDate: PlannerLocalDate;
  readonly occurrenceLocalTime?: PlannerLocalTime | null;
  readonly occurrenceTimezone: PlannerTimezone;
  readonly note?: string | null;
  readonly value: RecordableObservationValue;
}
