import type {
  EffectiveRange,
  ImportanceLevel,
  ImportanceWeight,
  Lifecycle,
  PlannerId,
  PlannerDayBlock,
  PlannerDurationMinutes,
  PlannerLocalTime,
  PlannerTimezone,
  ReminderTimezoneMode,
  ScheduleDefinition,
  TrackingDefinition,
  HabitVisualIdentity,
} from '../domain';

export interface HabitScheduleVersion {
  readonly id: PlannerId;
  readonly versionNumber: number;
  readonly definition: ScheduleDefinition;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HabitTrackingVersion {
  readonly id: PlannerId;
  readonly versionNumber: number;
  readonly definition: TrackingDefinition;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HabitImportanceVersion {
  readonly id: PlannerId;
  readonly versionNumber: number;
  readonly importance: ImportanceLevel;
  readonly weight: ImportanceWeight;
  readonly effectiveRange: EffectiveRange;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HabitReminderIntent {
  readonly id: PlannerId;
  readonly triggerLocalTime: PlannerLocalTime;
  readonly timezoneMode: ReminderTimezoneMode;
  readonly timezoneId: PlannerTimezone | null;
  readonly enabled: boolean;
  readonly lifecycle: Lifecycle;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HabitAggregate {
  readonly id: PlannerId;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: PlannerId | null;
  readonly activeRange: EffectiveRange;
  readonly lifecycle: Lifecycle;
  readonly sortOrder: number;
  readonly visualIdentity: HabitVisualIdentityRecord;
  readonly scheduleVersion: HabitScheduleVersion;
  readonly trackingVersion: HabitTrackingVersion;
  readonly importanceVersion: HabitImportanceVersion;
  readonly reminder: HabitReminderIntent | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HabitVisualIdentityRecord {
  readonly id: PlannerId;
  readonly habitId: PlannerId;
  readonly iconIdentity: HabitVisualIdentity['iconIdentity'];
  readonly persistedAccentKey: HabitVisualIdentity['persistedAccentKey'];
  readonly iconKey: HabitVisualIdentity['iconKey'];
  readonly accentKey: HabitVisualIdentity['accentKey'];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface InitialReminderPersistenceInput {
  readonly id: PlannerId;
  readonly triggerLocalTime: PlannerLocalTime;
  readonly timezoneMode: ReminderTimezoneMode;
  readonly timezoneId: PlannerTimezone | null;
}

export interface InitialHabitAggregatePersistenceInput {
  readonly habitId: PlannerId;
  readonly lifecycleTransitionId: PlannerId;
  readonly scheduleVersionId: PlannerId;
  readonly trackingVersionId: PlannerId;
  readonly importanceVersionId: PlannerId;
  readonly plannedTimeVersionId: PlannerId;
  readonly visualIdentity: HabitVisualIdentity;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: PlannerId | null;
  readonly activeRange: EffectiveRange;
  readonly schedule: ScheduleDefinition;
  readonly tracking: TrackingDefinition;
  readonly importance: ImportanceLevel;
  readonly importanceWeight: ImportanceWeight;
  readonly plannedLocalTime: PlannerLocalTime | null;
  /** How long it is meant to take. `null` is «nobody said», never «no time at all». */
  readonly plannedDurationMinutes: PlannerDurationMinutes | null;
  /**
   * Which part of the day it belongs to. `null` is «no block» — an Anytime item, which is
   * a state rather than missing data.
   */
  readonly plannedBlock: PlannerDayBlock | null;
  readonly reminder: InitialReminderPersistenceInput | null;
  readonly createdAt: number;
}
