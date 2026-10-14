import type {
  DependencyEndReason,
  DependencyOccurrenceMode,
  DependencyType,
  EffectiveRange,
  ImportanceLevel,
  ImportanceWeight,
  HabitVisualIdentity,
  Lifecycle,
  PlannerId,
  TrackingDefinition,
} from '../domain';
import type {
  HabitImportanceVersion,
  HabitReminderIntent,
  HabitTrackingVersion,
  InitialReminderPersistenceInput,
} from './habit-aggregate';

export interface DependencyHabitSummary {
  readonly id: PlannerId;
  readonly name: string;
  readonly categoryId: PlannerId | null;
  readonly activeRange: EffectiveRange;
  readonly lifecycle: Lifecycle;
}

export interface HabitDependencyVersion {
  readonly id: PlannerId;
  readonly relationshipId: PlannerId;
  readonly versionNumber: number;
  readonly parentHabitId: PlannerId;
  readonly dependentHabitId: PlannerId;
  readonly dependencyType: DependencyType;
  readonly occurrenceMode: DependencyOccurrenceMode;
  readonly effectiveRange: EffectiveRange;
  readonly endReason: DependencyEndReason | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HabitDependencyAggregate {
  readonly relationship: HabitDependencyVersion;
  readonly parent: DependencyHabitSummary;
  readonly dependent: DependencyHabitSummary;
  readonly dependentWasCreated: boolean;
  readonly dependentTracking: HabitTrackingVersion;
  readonly dependentImportance: HabitImportanceVersion;
  readonly dependentReminders: readonly HabitReminderIntent[];
  readonly relationshipState: 'open' | 'planned_finite';
}

export interface DependencyRelationshipPersistenceInput {
  readonly relationshipId: PlannerId;
  readonly relationshipVersionId: PlannerId;
  readonly parentHabitId: PlannerId;
  readonly dependentHabitId: PlannerId;
  readonly dependencyType: DependencyType;
  readonly occurrenceMode: 'inherited_parent';
  readonly effectiveRange: EffectiveRange;
  readonly endReason: 'scheduled_end' | null;
  readonly createdAt: number;
}

export interface NewDependentPersistenceInput {
  readonly habitId: PlannerId;
  readonly lifecycleTransitionId: PlannerId;
  readonly trackingVersionId: PlannerId;
  readonly importanceVersionId: PlannerId;
  readonly plannedTimeVersionId: PlannerId;
  readonly visualIdentity: HabitVisualIdentity;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: PlannerId | null;
  readonly activeRange: EffectiveRange;
  readonly tracking: TrackingDefinition;
  readonly importance: ImportanceLevel;
  readonly importanceWeight: ImportanceWeight;
  readonly reminder: InitialReminderPersistenceInput | null;
  readonly createdAt: number;
}

export type AddDependencyAggregatePersistenceInput =
  | Readonly<{
      source: 'existing';
      relationship: DependencyRelationshipPersistenceInput;
      newDependent: null;
    }>
  | Readonly<{
      source: 'new';
      relationship: DependencyRelationshipPersistenceInput;
      newDependent: NewDependentPersistenceInput;
    }>;
