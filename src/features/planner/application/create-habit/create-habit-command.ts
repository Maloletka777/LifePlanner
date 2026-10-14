import type {
  ImportanceLevel,
  PlannerId,
  PlannerLocalDate,
  PlannerLocalTime,
  PlannerTimezone,
  ReminderTimezoneMode,
  ScheduleDefinition,
  TrackingDefinition,
  HabitIconIdentityInput,
  HabitIconKey,
  PersistedHabitAccentKey,
} from '../../domain';

export interface CreateHabitReminderCommand {
  readonly triggerLocalTime: PlannerLocalTime;
  readonly timezoneMode: ReminderTimezoneMode;
  readonly timezoneId: PlannerTimezone | null;
}

export interface CreateHabitCommand {
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: PlannerId | null;
  readonly activeFrom: PlannerLocalDate;
  readonly activeTo: PlannerLocalDate | null;
  readonly schedule: ScheduleDefinition;
  readonly tracking: TrackingDefinition;
  readonly importance: ImportanceLevel;
  readonly plannedTime?: PlannerLocalTime | null;
  /**
   * How long it is meant to take, in whole minutes, or `null` when nobody said.
   *
   * Optional in the same way `plannedTime` is: the overwhelming majority of items
   * carry no length, and an absent one is stored as absent rather than defaulted.
   */
  readonly plannedDurationMinutes?: number | null;
  /**
   * Which part of the day it belongs to — morning, day, evening — or `null` for an item
   * no part of the day claims.
   *
   * **The clock never fills this in.** A surface may suggest a block from a minute the
   * person typed, but what is stored is what they accepted: derived from the hour, a
   * morning routine done at 12:40 would be filed under «day», and then no failed morning
   * would survive in the data to be noticed later.
   */
  readonly plannedBlock?: string | null;
  readonly reminder: CreateHabitReminderCommand | null;
  readonly iconKey?: HabitIconKey | null;
  readonly iconIdentity?: HabitIconIdentityInput | null;
  readonly accentKey?: PersistedHabitAccentKey | null;
}
