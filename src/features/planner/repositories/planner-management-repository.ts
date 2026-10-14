import type {
  HabitLifecycleAsOfResult,
  Lifecycle,
  EffectiveRange,
  ObservationChain,
  OrdinaryCompletionRole,
  PlannerId,
  PlannerLocalDate,
  PlannerDayBlock,
  PlannerDurationMinutes,
  PlannerLocalTime,
} from '../domain';
import type {
  HabitImportanceVersion,
  HabitReminderIntent,
  HabitScheduleVersion,
  HabitTrackingVersion,
  HabitVisualIdentityRecord,
} from './habit-aggregate';
import type { HabitDependencyVersion } from './habit-dependency-aggregate';

export interface PlannerHabitIdentity {
  readonly id: PlannerId;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: PlannerId | null;
  readonly activeRange: EffectiveRange;
  readonly lifecycle: Lifecycle;
  readonly archivedAt: number | null;
  readonly sortOrder: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly visualIdentity: HabitVisualIdentityRecord;
}

export type PlannerHabitLifecycleFilter = 'all' | 'active' | 'archived';
export type PlannerHabitSortMode = 'management_default';

export interface ListPlannerHabitsInput {
  readonly searchText?: string;
  readonly lifecycle?: PlannerHabitLifecycleFilter;
  readonly sort?: PlannerHabitSortMode;
  readonly asOfLocalDate: PlannerLocalDate;
}

export interface PlannerHabitCatalogueItem {
  readonly habitId: PlannerId;
  readonly name: string;
  readonly description: string | null;
  readonly lifecycle: Lifecycle;
  readonly archivedAt: number | null;
  readonly activeRange: EffectiveRange;
  readonly visualIdentity: HabitVisualIdentityRecord;
  readonly temporalContext: PlannerHabitTemporalContext;
  readonly categoryName: string | null;
  readonly schedule: HabitScheduleVersion | null;
  readonly inheritsOccurrence: boolean;
  readonly needsSchedule: boolean;
  readonly tracking: HabitTrackingVersion;
  readonly importance: HabitImportanceVersion;
  readonly plannedLocalTime: PlannerLocalTime | null;
  /**
   * The local time the habit's own reminder fires at, or `null` for none.
   *
   * Additive, and it costs nothing: `loadManagementData` already reads
   * `habit_reminders` because the detail read model needs it, so this is the same
   * rows exposed one level further out. **No table, column, migration, command or
   * query changed.** It is here rather than on the occurrence read model because
   * a reminder belongs to the habit and not to one of its days, and because the
   * journal already holds the catalogue for its task detection and density marks.
   */
  readonly reminderLocalTime: PlannerLocalTime | null;
  /**
   * Which reminder that time belongs to.
   *
   * The projection of what the operating system was told is keyed by reminder id
   * (Migration 012), so reconciliation needs the id and not only the minute. Additive,
   * from rows `loadManagementData` already reads: **no table, column, query or command
   * changed** — the same shape of field as `reminderLocalTime` beside it.
   */
  readonly reminderId: PlannerId | null;
  /**
   * The item this one is a subtask of, by **identity** rather than by name.
   *
   * The catalogue carried only the parent's name, so every surface that had to
   * match a subtask to its item matched on a string: two items called the same
   * thing traded their subtasks, and one renamed while the app was open matched
   * nothing at all. The id was already loaded — `ordinaryParent` carries it — and
   * the name stays for what a name is for, which is being displayed. **No table,
   * column, migration, command or query changed.**
   */
  readonly ordinaryParentHabitId: PlannerId | null;
  readonly ordinaryParentName: string | null;
  readonly ordinaryChildCount: number;
  readonly parentCount: number;
  readonly dependentCount: number;
  readonly hasObservations: boolean;
  /**
   * When the habit itself was written, which is what Manage orders by.
   *
   * Additive and free: `PlannerHabitIdentity.createdAt` is already loaded, the
   * catalogue simply never passed it on. `latestRelevantUpdateTimestamp` beside it
   * answers a different question — the last time anything about the item changed —
   * and ordering by that would shuffle the list every time something was edited.
   */
  readonly createdAt: number;
  readonly latestRelevantUpdateTimestamp: number;
  readonly stableSortKey: string;
}

export interface PlannerHabitDetail {
  readonly habit: PlannerHabitIdentity;
  readonly temporalContext: PlannerHabitTemporalContext;
  readonly categoryName: string | null;
  readonly currentSchedule: HabitScheduleVersion | null;
  readonly inheritsOccurrence: boolean;
  readonly currentTracking: HabitTrackingVersion;
  readonly currentImportance: HabitImportanceVersion;
  readonly currentPlannedTime: PlannerHabitPlannedTimeVersion;
  readonly ordinaryParent: PlannerHabitOrdinaryRelationshipDetail | null;
  readonly ordinaryChildren: readonly PlannerHabitOrdinaryRelationshipDetail[];
  readonly currentReminders: readonly HabitReminderIntent[];
  readonly incomingDependencies: readonly PlannerHabitDependencyDetail[];
  readonly outgoingDependencies: readonly PlannerHabitDependencyDetail[];
  readonly scheduleHistory: readonly HabitScheduleVersion[];
  readonly trackingHistory: readonly HabitTrackingVersion[];
  readonly importanceHistory: readonly HabitImportanceVersion[];
  readonly plannedTimeHistory: readonly PlannerHabitPlannedTimeVersion[];
  readonly ordinaryRelationshipHistory: readonly PlannerHabitOrdinaryRelationshipDetail[];
  readonly dependencyHistory: readonly PlannerHabitDependencyDetail[];
  readonly observationHistory: readonly ObservationChain[];
}

export type PlannerHabitConfigurationTemporalRelation =
  | 'as_of'
  | 'next_effective'
  | 'latest_historical';

export interface PlannerHabitConfigurationSnapshot {
  readonly effectiveLocalDate: PlannerLocalDate;
  readonly schedule: HabitScheduleVersion | null;
  readonly tracking: HabitTrackingVersion;
  readonly importance: HabitImportanceVersion;
  readonly plannedTime: PlannerHabitPlannedTimeVersion;
  readonly inheritsOccurrence: boolean;
  readonly needsSchedule: boolean;
  readonly ordinaryParent: PlannerHabitOrdinaryRelationshipDetail | null;
  readonly ordinaryChildren: readonly PlannerHabitOrdinaryRelationshipDetail[];
  readonly incomingDependencies: readonly PlannerHabitDependencyDetail[];
}

export interface PlannerHabitTemporalContext extends HabitLifecycleAsOfResult {
  readonly asOfConfiguration: PlannerHabitConfigurationSnapshot | null;
  readonly nextEffectiveConfiguration: PlannerHabitConfigurationSnapshot | null;
  readonly displayConfiguration: PlannerHabitConfigurationSnapshot;
  readonly displayConfigurationTemporalRelation: PlannerHabitConfigurationTemporalRelation;
}

export interface PlannerHabitPlannedTimeVersion {
  readonly id: PlannerId;
  readonly versionNumber: number;
  readonly plannedLocalTime: PlannerLocalTime | null;
  /** Whole minutes, or `null` when this version states no length. */
  readonly plannedDurationMinutes: PlannerDurationMinutes | null;
  /**
   * The part of the day, or `null` for none.
   *
   * Effective-dated with the minute and the length rather than kept apart, because the
   * three are one fact: a version carrying a block from one era beside a time from
   * another would describe a day that never existed.
   */
  readonly plannedBlock: PlannerDayBlock | null;
  readonly effectiveRange: EffectiveRange;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlannerHabitOrdinaryRelationshipDetail {
  readonly id: PlannerId;
  readonly relationshipId: PlannerId;
  readonly versionNumber: number;
  readonly parentHabitId: PlannerId;
  readonly childHabitId: PlannerId;
  readonly completionRole: OrdinaryCompletionRole;
  readonly parentName: string;
  readonly childName: string;
  readonly effectiveRange: EffectiveRange;
  readonly endReason: 'scheduled_end' | 'detached' | 'reparented' | 'parent_archived' | 'child_archived' | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlannerHabitDependencyDetail {
  readonly version: HabitDependencyVersion;
  readonly parentName: string;
  readonly dependentName: string;
}
