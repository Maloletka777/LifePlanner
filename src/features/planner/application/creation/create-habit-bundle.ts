import { failure, isOrdinaryCompletionRole, parsePlannerId, success, type OrdinaryCompletionRole, type Result } from '../../domain';
import type { AddDependencyAggregatePersistenceInput, HabitAggregate, InitialHabitAggregatePersistenceInput } from '../../repositories';
import { prepareInitialHabit, type CreateHabitDependencies } from '../create-habit/create-habit';
import type { CreateHabitCommand } from '../create-habit/create-habit-command';

export interface CreateHabitBundleCommand {
  readonly habits: readonly Readonly<{
    command: CreateHabitCommand;
    parentIndex: number | null;
    relationshipMode?: 'ordinary' | 'follow_up' | 'prerequisite' | 'independent';
    completionRole?: OrdinaryCompletionRole;
  }>[];
}
export interface CreateHabitBundleError { readonly name: 'CreateHabitBundleError'; readonly code: 'invalid_input' | 'data_integrity_failure' | 'database_failure'; readonly message: string; readonly cause?: unknown }
export type CreateHabitBundle = (command: CreateHabitBundleCommand) => Promise<Result<readonly HabitAggregate[], CreateHabitBundleError>>;

export function createCreateHabitBundle(dependencies: CreateHabitDependencies): CreateHabitBundle {
  return async (command) => {
    if (!Array.isArray(command?.habits) || command.habits.length === 0) return failure(bundleError('invalid_input', 'Choose at least one habit to save.'));
    const prepared: InitialHabitAggregatePersistenceInput[] = [];
    for (const [index, entry] of command.habits.entries()) {
      const mode = entry.relationshipMode ?? (entry.parentIndex === null ? 'independent' : 'ordinary');
      if (!['ordinary','follow_up','prerequisite','independent'].includes(mode)) return failure(bundleError('invalid_input', `Child ${index + 1} has an invalid relationship mode.`));
      if (entry.completionRole !== undefined && (mode !== 'ordinary' || !isOrdinaryCompletionRole(entry.completionRole))) return failure(bundleError('invalid_input', `Child ${index + 1} has an invalid completion role.`));
      if (mode === 'independent' ? entry.parentIndex !== null : entry.parentIndex === null || !Number.isInteger(entry.parentIndex) || entry.parentIndex < 0 || entry.parentIndex >= index) return failure(bundleError('invalid_input', 'The bundle hierarchy is invalid.'));
      const commandForPreparation = mode === 'ordinary' && (entry.completionRole ?? 'organizational') === 'routine_step' && entry.parentIndex !== null && entry.command.accentKey == null
        ? Object.freeze({ ...entry.command, accentKey: prepared[entry.parentIndex].visualIdentity.persistedAccentKey })
        : entry.command;
      const result = prepareInitialHabit(commandForPreparation, dependencies); if (!result.ok) return failure(bundleError(result.error.code === 'data_integrity_failure' ? 'data_integrity_failure' : 'invalid_input', result.error.message, result.error)); prepared.push(result.value);
    }
    const relationships = [];
    const conditionalRelationships: AddDependencyAggregatePersistenceInput[] = [];
    try {
      for (const [index, entry] of command.habits.entries()) {
        const mode = entry.relationshipMode ?? (entry.parentIndex === null ? 'independent' : 'ordinary');
        if (entry.parentIndex === null || mode === 'independent') continue;
        const relationshipId = parsePlannerId(dependencies.idGenerator.generateId(), 'relationshipId'); const versionId = parsePlannerId(dependencies.idGenerator.generateId(), 'relationshipVersionId');
        if (!relationshipId.ok || !versionId.ok || relationshipId.value === versionId.value) return failure(bundleError('data_integrity_failure', 'The bundle relationship identifiers are invalid.'));
        if (mode === 'ordinary') relationships.push(Object.freeze({ action: 'attach' as const, childHabitId: prepared[index].habitId, parentHabitId: prepared[entry.parentIndex].habitId, effectiveLocalDate: prepared[index].activeRange.effectiveFrom, relationshipId: relationshipId.value, relationshipVersionId: versionId.value, completionRole: entry.completionRole ?? 'organizational', updatedAt: prepared[index].createdAt }));
        else conditionalRelationships.push(Object.freeze({ source: 'existing' as const, newDependent: null, relationship: Object.freeze({ relationshipId: relationshipId.value, relationshipVersionId: versionId.value, parentHabitId: prepared[entry.parentIndex].habitId, dependentHabitId: prepared[index].habitId, dependencyType: mode, occurrenceMode: 'inherited_parent' as const, effectiveRange: prepared[index].activeRange, endReason: prepared[index].activeRange.effectiveTo === null ? null : 'scheduled_end' as const, createdAt: prepared[index].createdAt }) }));
      }
    } catch (cause: unknown) { return failure(bundleError('data_integrity_failure', 'The bundle relationship identifiers could not be created.', cause)); }
    try {
      const saved = await dependencies.unitOfWork.createHabitBundle({ habits: Object.freeze(prepared), ordinaryRelationships: Object.freeze(relationships), conditionalRelationships: Object.freeze(conditionalRelationships) });
      return saved.ok ? success(saved.value) : failure(bundleError(saved.error.code.endsWith('database_failure') || saved.error.code === 'database_failure' ? 'database_failure' : 'data_integrity_failure', saved.error.message, saved.error));
    } catch (cause: unknown) { return failure(bundleError('database_failure', 'The habit bundle could not be saved locally.', cause)); }
  };
}
function bundleError(code: CreateHabitBundleError['code'], message: string, cause?: unknown): CreateHabitBundleError { return Object.freeze({ name: 'CreateHabitBundleError', code, message, ...(cause === undefined ? {} : { cause }) }); }
