import type {
  ImportanceLevel,
  HabitAccentKey,
  HabitIconKey,
  PlannerId,
  PlannerLocalDate,
  TrackingDefinition,
} from '../../domain';
import type { HabitReminderInput } from '../habit-input-validation';

interface DependencyRelationshipCommand {
  readonly parentHabitId: PlannerId;
  readonly dependencyType: 'follow_up' | 'prerequisite';
  readonly effectiveFrom: PlannerLocalDate;
  readonly effectiveTo: PlannerLocalDate | null;
}

export interface LinkExistingDependencyCommand
  extends DependencyRelationshipCommand {
  readonly dependentSource: 'existing';
  readonly dependentHabitId: PlannerId;
}

export interface CreateAndLinkDependencyCommand
  extends DependencyRelationshipCommand {
  readonly dependentSource: 'new';
  readonly dependent: Readonly<{
    name: string;
    description?: string | null;
    categoryId?: PlannerId | null;
    tracking: TrackingDefinition;
    importance: ImportanceLevel;
    iconKey?: HabitIconKey | null;
    accentKey?: HabitAccentKey | null;
    reminder?: HabitReminderInput | null;
  }>;
}

export type AddHabitDependencyCommand =
  | LinkExistingDependencyCommand
  | CreateAndLinkDependencyCommand;
