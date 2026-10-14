import {
  failure,
  getImportanceWeight,
  parseImportanceLevel,
  parsePlannerId,
  parsePlannerDayBlock,
  parsePlannerDurationMinutes,
  parsePlannerLocalTime,
  resolveHabitVisualIdentity,
  success,
  validateEffectiveRange,
  validateScheduleDefinition,
  type EffectiveRange,
  type PlannerId,
  type Result,
  type ScheduleDefinition,
} from '../../domain';
import {
  type InitialHabitAggregatePersistenceInput,
  type PlannerPersistenceError,
  type PlannerUnitOfWork,
} from '../../repositories';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import {
  normalizeHabitDescriptionInput,
  normalizeHabitNameInput,
  revalidateHabitTracking,
  validateHabitReminder,
  type HabitInputValidationError,
} from '../habit-input-validation';
import type { CreateHabitCommand } from './create-habit-command';
import {
  createHabitError,
  invalidDomainInput,
  type CreateHabitError,
  type CreateHabitResult,
} from './create-habit-result';

export { MAX_HABIT_NAME_LENGTH } from '../habit-input-validation';

export interface CreateHabitDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export type CreateHabit = (
  command: CreateHabitCommand,
) => Promise<CreateHabitResult>;

export function createCreateHabit(
  dependencies: CreateHabitDependencies,
): CreateHabit {
  return async (command) => createHabit(command, dependencies);
}

export async function createHabit(
  command: CreateHabitCommand,
  dependencies: CreateHabitDependencies,
): Promise<CreateHabitResult> {
  const preparedResult = prepareInitialHabit(command, dependencies);
  if (!preparedResult.ok) {
    return preparedResult;
  }

  try {
    const persistenceResult =
      await dependencies.unitOfWork.createInitialHabitAggregate(
        preparedResult.value,
      );
    if (!persistenceResult.ok) {
      return failure(mapPersistenceError(persistenceResult.error));
    }
    return success(persistenceResult.value);
  } catch (cause: unknown) {
    return failure(
      createHabitError(
        'database_failure',
        'The habit could not be saved to local storage.',
        { cause },
      ),
    );
  }
}

export function prepareInitialHabit(
  command: CreateHabitCommand,
  dependencies: Pick<CreateHabitDependencies, 'idGenerator' | 'clock'>,
): Result<InitialHabitAggregatePersistenceInput, CreateHabitError> {
  const nameResult = normalizeHabitNameInput(command.name);
  if (!nameResult.ok) {
    return failure(mapHabitInputError(nameResult.error));
  }

  const descriptionResult = normalizeHabitDescriptionInput(command.description);
  if (!descriptionResult.ok) {
    return failure(mapHabitInputError(descriptionResult.error));
  }

  let categoryId: PlannerId | null = null;
  if (command.categoryId !== null) {
    const categoryResult = parsePlannerId(command.categoryId, 'categoryId');
    if (!categoryResult.ok) {
      return failure(invalidDomainInput('categoryId', categoryResult.error));
    }
    categoryId = categoryResult.value;
  }

  const activeRangeResult = validateEffectiveRange(
    {
      effectiveFrom: command.activeFrom,
      effectiveTo: command.activeTo,
    },
    'activeRange',
  );
  if (!activeRangeResult.ok) {
    return failure(invalidDomainInput('activeRange', activeRangeResult.error));
  }

  const scheduleResult = revalidateSchedule(command.schedule);
  if (!scheduleResult.ok) {
    return scheduleResult;
  }
  if (!sameEffectiveRange(scheduleResult.value.effectiveRange, activeRangeResult.value)) {
    return failure(
      createHabitError(
        'validation_conflict',
        'The initial schedule must use the habit active range.',
        { field: 'schedule.effectiveRange' },
      ),
    );
  }

  const trackingResult = revalidateHabitTracking(command.tracking);
  if (!trackingResult.ok) {
    return failure(mapHabitInputError(trackingResult.error));
  }
  if (!sameEffectiveRange(trackingResult.value.effectiveRange, activeRangeResult.value)) {
    return failure(
      createHabitError(
        'validation_conflict',
        'The initial tracking definition must use the habit active range.',
        { field: 'tracking.effectiveRange' },
      ),
    );
  }

  const importanceResult = parseImportanceLevel(
    command.importance,
    'importance',
  );
  if (!importanceResult.ok) {
    return failure(invalidDomainInput('importance', importanceResult.error));
  }

  const reminderResult = validateHabitReminder(command.reminder);
  if (!reminderResult.ok) {
    return failure(mapHabitInputError(reminderResult.error));
  }

  const plannedTimeResult = command.plannedTime == null
    ? success(null)
    : parsePlannerLocalTime(command.plannedTime, 'plannedTime');
  if (!plannedTimeResult.ok) {
    return failure(invalidDomainInput('plannedTime', plannedTimeResult.error));
  }

  const plannedDurationResult = command.plannedDurationMinutes == null
    ? success(null)
    : parsePlannerDurationMinutes(command.plannedDurationMinutes, 'plannedDurationMinutes');
  if (!plannedDurationResult.ok) {
    return failure(invalidDomainInput('plannedDurationMinutes', plannedDurationResult.error));
  }

  const plannedBlockResult = command.plannedBlock == null
    ? success(null)
    : parsePlannerDayBlock(command.plannedBlock, 'plannedBlock');
  if (!plannedBlockResult.ok) {
    return failure(invalidDomainInput('plannedBlock', plannedBlockResult.error));
  }

  const generatedIdsResult = generateAggregateIds(
    dependencies.idGenerator,
    reminderResult.value !== null,
  );
  if (!generatedIdsResult.ok) {
    return generatedIdsResult;
  }

  let createdAt: number;
  try {
    createdAt = dependencies.clock.nowEpochMilliseconds();
  } catch (cause: unknown) {
    return failure(
      createHabitError(
        'data_integrity_failure',
        'The creation timestamp source failed.',
        { cause },
      ),
    );
  }
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    return failure(
      createHabitError(
        'data_integrity_failure',
        'The creation timestamp source returned an invalid instant.',
      ),
    );
  }

  const ids = generatedIdsResult.value;
  if (reminderResult.value !== null && ids.reminderId === null) {
    return failure(
      createHabitError(
        'data_integrity_failure',
        'The identifier source did not provide a reminder identifier.',
      ),
    );
  }

  const visualIdentity = resolveHabitVisualIdentity({
    habitId: ids.habitId,
    trackingMode: trackingResult.value.trackingMode,
    iconIdentity: command.iconIdentity,
    iconKey: command.iconKey,
    accentKey: command.accentKey,
  });
  if (!visualIdentity.ok) {
    return failure(invalidDomainInput('visualIdentity', visualIdentity.error));
  }

  return success(
    Object.freeze({
      habitId: ids.habitId,
      lifecycleTransitionId: ids.lifecycleTransitionId,
      scheduleVersionId: ids.scheduleVersionId,
      trackingVersionId: ids.trackingVersionId,
      importanceVersionId: ids.importanceVersionId,
      plannedTimeVersionId: ids.plannedTimeVersionId,
      visualIdentity: visualIdentity.value,
      name: nameResult.value,
      description: descriptionResult.value,
      categoryId,
      activeRange: activeRangeResult.value,
      schedule: scheduleResult.value,
      tracking: trackingResult.value,
      importance: importanceResult.value,
      importanceWeight: getImportanceWeight(importanceResult.value),
      plannedLocalTime: plannedTimeResult.value,
      plannedDurationMinutes: plannedDurationResult.value,
      plannedBlock: plannedBlockResult.value,
      reminder:
        reminderResult.value === null || ids.reminderId === null
          ? null
          : Object.freeze({
              id: ids.reminderId,
              ...reminderResult.value,
            }),
      createdAt,
    }),
  );
}

export function revalidateSchedule(
  schedule: ScheduleDefinition,
): Result<ScheduleDefinition, CreateHabitError> {
  if (typeof schedule !== 'object' || schedule === null) {
    return failure(
      createHabitError('invalid_input', 'The schedule is required.', {
        field: 'schedule',
      }),
    );
  }
  const base = {
    scheduleType: schedule.scheduleType,
    effectiveFrom: schedule.effectiveRange?.effectiveFrom,
    effectiveTo: schedule.effectiveRange?.effectiveTo,
    evaluationTimezone: schedule.evaluationTimezone,
  };
  let input: unknown;

  switch (schedule.scheduleType) {
    case 'daily':
      input = base;
      break;
    case 'selected_weekdays':
      input = { ...base, weekdaysMask: schedule.weekdaysMask };
      break;
    case 'every_n_days':
      input = {
        ...base,
        intervalDays: schedule.intervalDays,
        anchorDate: schedule.anchorDate,
      };
      break;
    case 'times_per_week':
      input = {
        ...base,
        periodTargetCount: schedule.periodTargetCount,
        weekStart: schedule.weekStart,
      };
      break;
    case 'times_per_month':
    case 'times_per_year':
      input = { ...base, periodTargetCount: schedule.periodTargetCount };
      break;
    case 'weekly':
      input = {
        ...base,
        weekday: schedule.weekday,
        weekStart: schedule.weekStart,
      };
      break;
    case 'monthly':
      input = { ...base, monthDay: schedule.monthDay };
      break;
    case 'yearly':
      input = {
        ...base,
        monthNumber: schedule.monthNumber,
        monthDay: schedule.monthDay,
      };
      break;
    default:
      return failure(
        createHabitError('invalid_input', 'The schedule type is unsupported.', {
          field: 'schedule.scheduleType',
        }),
      );
  }

  const result = validateScheduleDefinition(input);
  return result.ok
    ? success(result.value)
    : failure(invalidDomainInput('schedule', result.error));
}

function generateAggregateIds(
  generator: IdGenerator,
  includeReminder: boolean,
): Result<
  Readonly<{
    habitId: PlannerId;
    lifecycleTransitionId: PlannerId;
    scheduleVersionId: PlannerId;
    trackingVersionId: PlannerId;
    importanceVersionId: PlannerId;
    plannedTimeVersionId: PlannerId;
    reminderId: PlannerId | null;
  }>,
  CreateHabitError
> {
  let rawIds: readonly string[];
  try {
    rawIds = Object.freeze([
      generator.generateId(),
      generator.generateId(),
      generator.generateId(),
      generator.generateId(),
      generator.generateId(),
      generator.generateId(),
      ...(includeReminder ? [generator.generateId()] : []),
    ]);
  } catch (cause: unknown) {
    return failure(
      createHabitError(
        'data_integrity_failure',
        'The identifier source failed while preparing the habit.',
        { cause },
      ),
    );
  }

  if (new Set(rawIds).size !== rawIds.length) {
    return failure(
      createHabitError(
        'data_integrity_failure',
        'The identifier source returned duplicate values.',
      ),
    );
  }

  const parsedIds: PlannerId[] = [];
  for (let index = 0; index < rawIds.length; index += 1) {
    const parsed = parsePlannerId(rawIds[index], `generatedIds[${index}]`);
    if (!parsed.ok) {
      return failure(
        createHabitError(
          'data_integrity_failure',
          'The identifier source returned an invalid UUID.',
          { cause: parsed.error },
        ),
      );
    }
    parsedIds.push(parsed.value);
  }

  return success(
    Object.freeze({
      habitId: parsedIds[0],
      lifecycleTransitionId: parsedIds[1],
      scheduleVersionId: parsedIds[2],
      trackingVersionId: parsedIds[3],
      importanceVersionId: parsedIds[4],
      plannedTimeVersionId: parsedIds[5],
      reminderId: includeReminder ? parsedIds[6] : null,
    }),
  );
}

function sameEffectiveRange(left: EffectiveRange, right: EffectiveRange): boolean {
  return (
    left.effectiveFrom === right.effectiveFrom &&
    left.effectiveTo === right.effectiveTo
  );
}

function mapHabitInputError(error: HabitInputValidationError): CreateHabitError {
  return createHabitError('invalid_input', error.message, {
    field: error.field,
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  });
}

function mapPersistenceError(error: PlannerPersistenceError): CreateHabitError {
  switch (error.code) {
    case 'category_not_found':
      return createHabitError(
        'category_not_found',
        'The selected habit category no longer exists.',
        { field: 'categoryId', cause: error },
      );
    case 'category_archived':
      return createHabitError(
        'category_archived',
        'The selected habit category is archived.',
        { field: 'categoryId', cause: error },
      );
    case 'validation_conflict':
      return createHabitError(
        'validation_conflict',
        'The habit conflicts with current local data.',
        { cause: error },
      );
    case 'database_failure':
      return createHabitError(
        'database_failure',
        'The habit could not be saved to local storage.',
        { cause: error },
      );
    case 'data_integrity_failure':
      return createHabitError(
        'data_integrity_failure',
        'The saved habit could not be verified safely.',
        { cause: error },
      );
    default:
      return createHabitError(
        'data_integrity_failure',
        'An unsupported persistence error occurred.',
        { cause: error },
      );
  }
}
