import type {
  ImportanceLevel,
  PlannerDayBlock,
  PlannerDurationMinutes,
  PlannerId,
  PlannerLocalDate,
  PlannerLocalTime,
  Result,
  ScheduleDefinition,
  TrackingDefinition,
  HabitVisualIdentity,
} from '../domain';
import type { PlannerPersistenceError } from './planner-persistence-error';

export interface EditHabitPersistenceInput {
  readonly habitId: PlannerId;
  readonly currentLocalDate: PlannerLocalDate;
  readonly effectiveLocalDate: PlannerLocalDate;
  readonly name: string;
  readonly description: string | null;
  readonly schedule: ScheduleDefinition;
  readonly tracking: TrackingDefinition;
  readonly importance: ImportanceLevel;
  readonly plannedLocalTime: PlannerLocalTime | null;
  /**
   * How long it is meant to take, or `null` for «nobody said».
   *
   * **Effective-dated, unlike the reminder below, and written by the time family's own
   * correction or appended version.** It belongs there because it decides what a past
   * day's plan *was* — the same reason schedule, tracking and importance are dated —
   * and because storing it anywhere else would let a version carry a minute from one
   * era beside a length from another.
   */
  readonly plannedDurationMinutes: PlannerDurationMinutes | null;
  /**
   * The part of the day, or `null` for none.
   *
   * The same family and the same machinery as the two above, because where a thing
   * belonged is part of what a past day's plan was.
   */
  readonly plannedBlock: PlannerDayBlock | null;
  /**
   * The minute this item's reminder fires at, or `null` for no reminder.
   *
   * **Not effective-dated, and that is the decision rather than an omission.** Schedules,
   * tracking and importance are, because they decide what a past day *meant*; a reminder
   * decides whether a phone buzzes on a day that has not happened yet, and re-reading it
   * for a day already gone would change nothing about that day. It is the same reasoning
   * PD-SUBTASK-004 gave for the closure rule, and it is why this family is applied in
   * place beside `visual_identity` rather than through the version machinery.
   */
  readonly reminderLocalTime: PlannerLocalTime | null;
  /**
   * The identity a **new** reminder would be written under.
   *
   * Supplied whether or not one is needed, because an id generator that only runs on some
   * paths is an id generator whose failure only shows on some paths.
   */
  readonly reminderId: PlannerId;
  readonly visualIdentity: HabitVisualIdentity | null;
  readonly generatedIds: readonly PlannerId[];
  readonly updatedAt: number;
}

export interface EditHabitReceipt {
  readonly habitId: PlannerId;
  readonly outcome: 'changed' | 'no_change';
  readonly changedFamilies: readonly (
    | 'identity'
    | 'schedule'
    | 'tracking'
    | 'importance'
    | 'planned_time'
    | 'visual_identity'
    | 'reminder'
  )[];
  readonly effectiveLocalDate: PlannerLocalDate;
}

export type EditHabitPersistenceResult = Promise<
  Result<EditHabitReceipt, PlannerPersistenceError>
>;
