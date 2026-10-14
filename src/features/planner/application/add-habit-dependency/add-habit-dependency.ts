import {
  failure,
  getImportanceWeight,
  parseDependencyType,
  parseImportanceLevel,
  parsePlannerId,
  resolveHabitVisualIdentity,
  success,
  validateEffectiveRange,
  type EffectiveRange,
  type ImportanceLevel,
  type PlannerId,
  type Result,
  type TrackingDefinition,
} from '../../domain';
import type {
  AddDependencyAggregatePersistenceInput,
  PlannerPersistenceError,
  PlannerUnitOfWork,
} from '../../repositories';
import {
  normalizeHabitDescriptionInput,
  normalizeHabitNameInput,
  revalidateHabitTracking,
  validateHabitReminder,
  type ValidatedHabitReminder,
} from '../habit-input-validation';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { AddHabitDependencyCommand } from './add-habit-dependency-command';
import {
  addHabitDependencyError,
  type AddHabitDependencyError,
  type AddHabitDependencyResult,
} from './add-habit-dependency-result';

export interface AddHabitDependencyDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export type AddHabitDependency = (
  command: AddHabitDependencyCommand,
) => Promise<AddHabitDependencyResult>;

const FORBIDDEN_COMMAND_FIELDS = [
  'relationshipId',
  'relationshipVersionId',
  'versionNumber',
  'occurrenceMode',
  'endReason',
  'createdAt',
  'updatedAt',
  'graphDepth',
  'maxDepth',
  'importanceWeight',
  'completion',
  'progress',
  'sql',
  'rawSql',
] as const;

const SHARED_COMMAND_FIELDS = [
  'dependentSource',
  'parentHabitId',
  'dependencyType',
  'effectiveFrom',
  'effectiveTo',
] as const;

export function createAddHabitDependency(
  dependencies: AddHabitDependencyDependencies,
): AddHabitDependency {
  return async (command) => addHabitDependency(command, dependencies);
}

export async function addHabitDependency(
  command: AddHabitDependencyCommand,
  dependencies: AddHabitDependencyDependencies,
): Promise<AddHabitDependencyResult> {
  const prepared = prepareDependency(command, dependencies);
  if (!prepared.ok) return prepared;

  try {
    const persisted = await dependencies.unitOfWork.addDependencyAggregate(
      prepared.value,
    );
    return persisted.ok
      ? success(persisted.value)
      : failure(mapPersistenceError(persisted.error));
  } catch (cause: unknown) {
    return failure(
      addHabitDependencyError(
        'dependency_database_failure',
        'The dependency could not be saved to local storage.',
        { cause },
      ),
    );
  }
}

function prepareDependency(
  command: AddHabitDependencyCommand,
  dependencies: Pick<AddHabitDependencyDependencies, 'idGenerator' | 'clock'>,
): Result<AddDependencyAggregatePersistenceInput, AddHabitDependencyError> {
  if (typeof command !== 'object' || command === null) {
    return invalidCommand('The dependency command is malformed.');
  }
  for (const field of FORBIDDEN_COMMAND_FIELDS) {
    if (field in command) {
      return invalidCommand(
        'The dependency command contains a protected persistence field.',
        field,
      );
    }
  }

  const parentResult = parsePlannerId(command.parentHabitId, 'parentHabitId');
  if (!parentResult.ok) {
    return invalidCommand('The parent identifier is invalid.', 'parentHabitId');
  }
  const typeResult = parseDependencyType(
    command.dependencyType,
    'dependencyType',
  );
  if (!typeResult.ok) {
    return invalidCommand('The dependency type is invalid.', 'dependencyType');
  }
  const rangeResult = validateEffectiveRange(
    {
      effectiveFrom: command.effectiveFrom,
      effectiveTo: command.effectiveTo,
    },
    'relationship.effectiveRange',
  );
  if (!rangeResult.ok) {
    return failure(
      addHabitDependencyError(
        'dependency_invalid_effective_range',
        'The dependency effective range is invalid.',
        { field: 'effectiveRange', cause: rangeResult.error },
      ),
    );
  }

  if (
    command.dependentSource !== 'existing' &&
    command.dependentSource !== 'new'
  ) {
    return invalidCommand(
      'The dependent source is invalid.',
      'dependentSource',
    );
  }

  const unexpectedCommandField = findUnexpectedOwnField(
    command,
    command.dependentSource === 'existing'
      ? [...SHARED_COMMAND_FIELDS, 'dependentHabitId']
      : [...SHARED_COMMAND_FIELDS, 'dependent'],
  );
  if (unexpectedCommandField !== null) {
    return invalidCommand(
      'The dependency command contains an unsupported field.',
      unexpectedCommandField,
    );
  }

  const preparedDependent =
    command.dependentSource === 'existing'
      ? prepareExistingDependent(command.dependentHabitId)
      : prepareNewDependent(command.dependent, rangeResult.value);
  if (!preparedDependent.ok) return preparedDependent;

  const generatedIds = generateIds(
    dependencies.idGenerator,
    command.dependentSource,
    preparedDependent.value.source === 'new' &&
      preparedDependent.value.reminder !== null,
  );
  if (!generatedIds.ok) return generatedIds;

  const createdAtResult = readCreationTimestamp(dependencies.clock);
  if (!createdAtResult.ok) return createdAtResult;

  const dependentHabitId =
    preparedDependent.value.source === 'existing'
      ? preparedDependent.value.dependentHabitId
      : generatedIds.value.dependentHabitId;
  if (dependentHabitId === null) {
    return integrityFailure('A new dependent identifier was not generated.');
  }
  if (dependentHabitId === parentResult.value) {
    return failure(
      addHabitDependencyError(
        'dependency_self_link',
        'A habit cannot depend on itself.',
      ),
    );
  }

  const relationship = Object.freeze({
    relationshipId: generatedIds.value.relationshipId,
    relationshipVersionId: generatedIds.value.relationshipVersionId,
    parentHabitId: parentResult.value,
    dependentHabitId,
    dependencyType: typeResult.value,
    occurrenceMode: 'inherited_parent' as const,
    effectiveRange: rangeResult.value,
    endReason:
      rangeResult.value.effectiveTo === null
        ? null
        : ('scheduled_end' as const),
    createdAt: createdAtResult.value,
  });

  if (preparedDependent.value.source === 'existing') {
    return success(
      Object.freeze({
        source: 'existing' as const,
        relationship,
        newDependent: null,
      }),
    );
  }

  const ids = generatedIds.value;
  if (
    ids.trackingVersionId === null ||
    ids.lifecycleTransitionId === null ||
    ids.importanceVersionId === null ||
    ids.plannedTimeVersionId === null ||
    (preparedDependent.value.reminder !== null && ids.reminderId === null)
  ) {
    return integrityFailure(
      'The identifier source omitted a required dependent identifier.',
    );
  }
  const visualIdentity = resolveHabitVisualIdentity({
    habitId: dependentHabitId,
    trackingMode: preparedDependent.value.tracking.trackingMode,
    iconKey: preparedDependent.value.iconKey,
    accentKey: preparedDependent.value.accentKey,
  });
  if (!visualIdentity.ok) {
    return invalidDependent('dependent.visualIdentity', 'Choose a supported dependent icon and accent.', visualIdentity.error);
  }
  return success(
    Object.freeze({
      source: 'new' as const,
      relationship,
      newDependent: Object.freeze({
        habitId: dependentHabitId,
        lifecycleTransitionId: ids.lifecycleTransitionId,
        trackingVersionId: ids.trackingVersionId,
        importanceVersionId: ids.importanceVersionId,
        plannedTimeVersionId: ids.plannedTimeVersionId,
        visualIdentity: visualIdentity.value,
        name: preparedDependent.value.name,
        description: preparedDependent.value.description,
        categoryId: preparedDependent.value.categoryId,
        activeRange: rangeResult.value,
        tracking: preparedDependent.value.tracking,
        importance: preparedDependent.value.importance,
        importanceWeight: getImportanceWeight(
          preparedDependent.value.importance,
        ),
        reminder:
          preparedDependent.value.reminder === null || ids.reminderId === null
            ? null
            : Object.freeze({
                id: ids.reminderId,
                ...preparedDependent.value.reminder,
              }),
        createdAt: createdAtResult.value,
      }),
    }),
  );
}

function prepareExistingDependent(
  dependentHabitId: unknown,
): Result<
  Readonly<{ source: 'existing'; dependentHabitId: PlannerId }>,
  AddHabitDependencyError
> {
  const result = parsePlannerId(dependentHabitId, 'dependentHabitId');
  return result.ok
    ? success(
        Object.freeze({
          source: 'existing' as const,
          dependentHabitId: result.value,
        }),
      )
    : invalidCommand(
        'The dependent identifier is invalid.',
        'dependentHabitId',
      );
}

interface PreparedNewDependent {
  readonly source: 'new';
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: PlannerId | null;
  readonly tracking: TrackingDefinition;
  readonly importance: ImportanceLevel;
  readonly reminder: ValidatedHabitReminder | null;
  readonly iconKey: unknown;
  readonly accentKey: unknown;
}

function prepareNewDependent(
  dependent: Extract<
    AddHabitDependencyCommand,
    { dependentSource: 'new' }
  >['dependent'],
  effectiveRange: EffectiveRange,
): Result<PreparedNewDependent, AddHabitDependencyError> {
  if (typeof dependent !== 'object' || dependent === null) {
    return invalidDependent('dependent', 'The dependent definition is missing.');
  }
  const unexpectedDependentField = findUnexpectedOwnField(dependent, [
    'name',
    'description',
    'categoryId',
    'tracking',
    'importance',
    'reminder',
    'iconKey',
    'accentKey',
  ]);
  if (unexpectedDependentField !== null) {
    return invalidDependent(
      `dependent.${unexpectedDependentField}`,
      'The dependent definition contains an unsupported field.',
    );
  }
  const name = normalizeHabitNameInput(dependent.name);
  if (!name.ok) return invalidDependent(name.error.field, name.error.message, name.error);
  const description = normalizeHabitDescriptionInput(
    dependent.description ?? null,
  );
  if (!description.ok) {
    return invalidDependent(
      description.error.field,
      description.error.message,
      description.error,
    );
  }
  let categoryId: PlannerId | null = null;
  if (dependent.categoryId !== null && dependent.categoryId !== undefined) {
    const category = parsePlannerId(dependent.categoryId, 'dependent.categoryId');
    if (!category.ok) {
      return invalidDependent(
        'dependent.categoryId',
        'The dependent category identifier is invalid.',
        category.error,
      );
    }
    categoryId = category.value;
  }
  const tracking = revalidateHabitTracking(dependent.tracking);
  if (!tracking.ok) {
    return invalidDependent(
      `dependent.${tracking.error.field}`,
      tracking.error.message,
      tracking.error,
    );
  }
  if (!sameRange(tracking.value.effectiveRange, effectiveRange)) {
    return invalidDependent(
      'dependent.tracking.effectiveRange',
      'The dependent tracking range must match the relationship range.',
    );
  }
  const importance = parseImportanceLevel(
    dependent.importance,
    'dependent.importance',
  );
  if (!importance.ok) {
    return invalidDependent(
      'dependent.importance',
      'The dependent importance is invalid.',
      importance.error,
    );
  }
  const reminder = validateHabitReminder(dependent.reminder ?? null);
  if (!reminder.ok) {
    return invalidDependent(
      `dependent.${reminder.error.field}`,
      reminder.error.message,
      reminder.error,
    );
  }
  return success(
    Object.freeze({
      source: 'new' as const,
      name: name.value,
      description: description.value,
      categoryId,
      tracking: tracking.value,
      importance: importance.value,
      reminder: reminder.value,
      iconKey: dependent.iconKey,
      accentKey: dependent.accentKey,
    }),
  );
}

interface GeneratedDependencyIds {
  readonly dependentHabitId: PlannerId | null;
  readonly lifecycleTransitionId: PlannerId | null;
  readonly trackingVersionId: PlannerId | null;
  readonly importanceVersionId: PlannerId | null;
  readonly plannedTimeVersionId: PlannerId | null;
  readonly reminderId: PlannerId | null;
  readonly relationshipId: PlannerId;
  readonly relationshipVersionId: PlannerId;
}

function generateIds(
  generator: IdGenerator,
  source: 'existing' | 'new',
  includeReminder: boolean,
): Result<GeneratedDependencyIds, AddHabitDependencyError> {
  const newDependentCount = source === 'new' ? 5 + (includeReminder ? 1 : 0) : 0;
  let rawIds: readonly string[];
  try {
    rawIds = Object.freeze(
      Array.from({ length: newDependentCount + 2 }, () =>
        generator.generateId(),
      ),
    );
  } catch (cause: unknown) {
    return integrityFailure('The identifier source failed.', cause);
  }
  if (new Set(rawIds).size !== rawIds.length) {
    return integrityFailure('The identifier source returned duplicate values.');
  }
  const parsed: PlannerId[] = [];
  for (let index = 0; index < rawIds.length; index += 1) {
    const result = parsePlannerId(rawIds[index], `generatedIds[${index}]`);
    if (!result.ok) {
      return integrityFailure(
        'The identifier source returned an invalid UUID.',
        result.error,
      );
    }
    parsed.push(result.value);
  }

  if (source === 'existing') {
    return success(
      Object.freeze({
        dependentHabitId: null,
        lifecycleTransitionId: null,
        trackingVersionId: null,
        importanceVersionId: null,
        plannedTimeVersionId: null,
        reminderId: null,
        relationshipId: parsed[0],
        relationshipVersionId: parsed[1],
      }),
    );
  }
  const relationshipOffset = 5 + (includeReminder ? 1 : 0);
  return success(
    Object.freeze({
      dependentHabitId: parsed[0],
      lifecycleTransitionId: parsed[1],
      trackingVersionId: parsed[2],
      importanceVersionId: parsed[3],
      plannedTimeVersionId: parsed[4],
      reminderId: includeReminder ? parsed[5] : null,
      relationshipId: parsed[relationshipOffset],
      relationshipVersionId: parsed[relationshipOffset + 1],
    }),
  );
}

function readCreationTimestamp(
  clock: Clock,
): Result<number, AddHabitDependencyError> {
  let createdAt: number;
  try {
    createdAt = clock.nowEpochMilliseconds();
  } catch (cause: unknown) {
    return integrityFailure('The creation timestamp source failed.', cause);
  }
  return Number.isSafeInteger(createdAt) && createdAt >= 0
    ? success(createdAt)
    : integrityFailure(
        'The creation timestamp source returned an invalid instant.',
      );
}

function sameRange(left: EffectiveRange, right: EffectiveRange): boolean {
  return (
    left.effectiveFrom === right.effectiveFrom &&
    left.effectiveTo === right.effectiveTo
  );
}

function findUnexpectedOwnField(
  input: object,
  allowedFields: readonly string[],
): string | null {
  return Object.keys(input).sort().find((field) => !allowedFields.includes(field)) ?? null;
}

function invalidCommand<T>(
  message: string,
  field?: string,
): Result<T, AddHabitDependencyError> {
  return failure(
    addHabitDependencyError('dependency_invalid_command', message, { field }),
  );
}

function invalidDependent<T>(
  field: string,
  message: string,
  cause?: unknown,
): Result<T, AddHabitDependencyError> {
  return failure(
    addHabitDependencyError(
      'dependency_invalid_dependent_definition',
      message,
      { field, cause },
    ),
  );
}

function integrityFailure<T>(
  message: string,
  cause?: unknown,
): Result<T, AddHabitDependencyError> {
  return failure(
    addHabitDependencyError('dependency_data_integrity_failure', message, {
      cause,
    }),
  );
}

function mapPersistenceError(
  error: PlannerPersistenceError,
): AddHabitDependencyError {
  switch (error.code) {
    case 'dependency_parent_not_found':
    case 'dependency_dependent_not_found':
    case 'dependency_parent_archived':
    case 'dependency_dependent_archived':
    case 'dependency_self_link':
    case 'dependency_duplicate_relationship':
    case 'dependency_second_active_parent':
    case 'dependency_relationship_mode_conflict':
    case 'dependency_cycle':
    case 'dependency_depth_exceeded':
    case 'dependency_invalid_effective_range':
    case 'dependency_outside_parent_active_range':
    case 'dependency_outside_dependent_active_range':
    case 'dependency_category_not_found':
    case 'dependency_category_archived':
    case 'dependency_data_integrity_failure':
    case 'dependency_database_failure':
      return addHabitDependencyError(error.code, error.message, { cause: error });
    case 'category_not_found':
      return addHabitDependencyError(
        'dependency_category_not_found',
        'The selected dependent category no longer exists.',
        { cause: error },
      );
    case 'category_archived':
      return addHabitDependencyError(
        'dependency_category_archived',
        'The selected dependent category is archived.',
        { cause: error },
      );
    case 'database_failure':
      return addHabitDependencyError(
        'dependency_database_failure',
        'The dependency could not be saved to local storage.',
        { cause: error },
      );
    case 'validation_conflict':
      return addHabitDependencyError(
        'dependency_database_failure',
        'The dependency conflicts with current local data.',
        { cause: error },
      );
    case 'data_integrity_failure':
    default:
      return addHabitDependencyError(
        'dependency_data_integrity_failure',
        'The saved dependency could not be verified safely.',
        { cause: error },
      );
  }
}
