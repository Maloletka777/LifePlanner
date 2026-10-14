import {
  failure,
  parseImportanceLevel,
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerDayBlock,
  parsePlannerDurationMinutes,
  parsePlannerLocalTime,
  parseHabitAccentKey,
  parseHabitIconKey,
  parseHabitIconIdentity,
  createHabitVisualIdentity,
  success,
  type HabitIconIdentityInput,
  type ImportanceLevel,
  type Result,
  type ScheduleDefinition,
  type TrackingDefinition,
} from '../../domain';
import type {
  EditHabitPersistenceInput,
  EditHabitReceipt,
  PlannerUnitOfWork,
} from '../../repositories';
import {
  normalizeHabitDescriptionInput,
  normalizeHabitNameInput,
  revalidateHabitTracking,
} from '../habit-input-validation';
import { revalidateSchedule } from '../create-habit/create-habit';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';

export interface EditHabitCommand {
  readonly habitId: string;
  readonly currentLocalDate: string;
  readonly effectiveLocalDate: string;
  readonly name: string;
  readonly description: string | null;
  readonly schedule: ScheduleDefinition;
  readonly tracking: TrackingDefinition;
  readonly importance: ImportanceLevel;
  readonly plannedLocalTime: string | null;
  /**
   * Whole minutes, or `null` for «nobody said». Absent is the same as `null`.
   *
   * It belongs to the time family and is written by the same correction or appended
   * version the minute is, because the two are halves of one fact.
   */
  readonly plannedDurationMinutes?: number | null;
  /**
   * The part of the day, or `null` for none. Absent is the same as `null`.
   *
   * The third member of the time family, effective-dated with the other two: what a
   * past day meant depends on where the thing belonged as much as on when it started.
   */
  readonly plannedBlock?: string | null;
  /** `HH:MM` for a reminder, or `null` for none. Absent is the same as `null`. */
  readonly reminderLocalTime?: string | null;
  readonly iconKey?: string;
  readonly iconIdentity?: HabitIconIdentityInput;
  readonly accentKey?: string;
}

export interface EditHabitError {
  readonly name: 'EditHabitError';
  readonly code:
    | 'invalid_input'
    | 'not_found'
    | 'archived_habit'
    | 'past_effective_date'
    | 'same_day_correction_not_eligible'
    | 'future_version_conflict'
    | 'stale_conflict'
    | 'data_integrity_failure'
    | 'database_failure';
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
}

export type EditHabitResult = Result<EditHabitReceipt, EditHabitError>;
export type EditHabit = (command: EditHabitCommand) => Promise<EditHabitResult>;

export interface EditHabitDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export function createEditHabit(dependencies: EditHabitDependencies): EditHabit {
  return async (command) => {
    const prepared = prepareEdit(command, dependencies);
    if (!prepared.ok) return prepared;
    try {
      const result = await dependencies.unitOfWork.editHabit(prepared.value);
      return result.ok ? success(result.value) : failure(mapPersistenceError(result.error));
    } catch (cause: unknown) {
      return failure(editError('database_failure', 'The habit changes could not be saved.', undefined, cause));
    }
  };
}

function prepareEdit(
  command: EditHabitCommand,
  dependencies: Pick<EditHabitDependencies, 'idGenerator' | 'clock'>,
): Result<EditHabitPersistenceInput, EditHabitError> {
  const habitId = parsePlannerId(command.habitId, 'habitId');
  const currentDate = parsePlannerLocalDate(command.currentLocalDate, 'currentLocalDate');
  const effectiveDate = parsePlannerLocalDate(command.effectiveLocalDate, 'effectiveLocalDate');
  const name = normalizeHabitNameInput(command.name);
  const description = normalizeHabitDescriptionInput(command.description);
  const schedule = revalidateSchedule(command.schedule);
  const tracking = revalidateHabitTracking(command.tracking);
  const importance = parseImportanceLevel(command.importance, 'importance');
  const plannedTime = command.plannedLocalTime === null ? success(null) : parsePlannerLocalTime(command.plannedLocalTime, 'plannedLocalTime');
  const plannedBlock = (command.plannedBlock ?? null) === null
    ? success(null)
    : parsePlannerDayBlock(command.plannedBlock, 'plannedBlock');
  const plannedDuration = (command.plannedDurationMinutes ?? null) === null
    ? success(null)
    : parsePlannerDurationMinutes(command.plannedDurationMinutes, 'plannedDurationMinutes');
  // Validated exactly as the planned time is: a reminder is a local minute, and one that
  // is not gets the same refusal rather than a silently dropped field.
  const reminderTime = (command.reminderLocalTime ?? null) === null
    ? success(null)
    : parsePlannerLocalTime(command.reminderLocalTime as string, 'reminderLocalTime');
  const suppliedIconCount = Number(command.iconKey !== undefined) + Number(command.iconIdentity !== undefined);
  const visualIdentity = suppliedIconCount === 0 && command.accentKey === undefined
    ? success(null)
    : suppliedIconCount !== 1 || command.accentKey === undefined
      ? failure(editError('invalid_input', 'Choose both a habit icon and accent.', 'visualIdentity'))
      : (() => {
          const icon = command.iconIdentity === undefined
            ? (() => {
                const legacy = parseHabitIconKey(command.iconKey, 'iconKey');
                return legacy.ok
                  ? success(Object.freeze({ kind: 'symbol' as const, symbolKey: legacy.value }))
                  : legacy;
              })()
            : parseHabitIconIdentity(command.iconIdentity, 'iconIdentity');
          const accent = parseHabitAccentKey(command.accentKey, 'accentKey');
          return icon.ok && accent.ok
            ? success(createHabitVisualIdentity(icon.value, accent.value))
            : failure(editError('invalid_input', 'Choose a supported habit icon and accent.', 'visualIdentity', icon.ok ? (accent.ok ? undefined : accent.error) : icon.error));
        })();
  if (!habitId.ok) return failure(editError('invalid_input', habitId.error.message, 'habitId', habitId.error));
  if (!currentDate.ok) return failure(editError('invalid_input', currentDate.error.message, 'currentLocalDate', currentDate.error));
  if (!effectiveDate.ok) return failure(editError('invalid_input', effectiveDate.error.message, 'effectiveLocalDate', effectiveDate.error));
  if (effectiveDate.value < currentDate.value) return failure(editError('past_effective_date', 'Habit changes cannot begin in the past.', 'effectiveLocalDate'));
  if (!name.ok) return failure(editError('invalid_input', name.error.message, name.error.field, name.error.cause));
  if (!description.ok) return failure(editError('invalid_input', description.error.message, description.error.field, description.error.cause));
  if (!schedule.ok) return failure(editError('invalid_input', schedule.error.message, schedule.error.field, schedule.error.cause));
  if (!tracking.ok) return failure(editError('invalid_input', tracking.error.message, tracking.error.field, tracking.error.cause));
  if (!importance.ok) return failure(editError('invalid_input', importance.error.message, 'importance', importance.error));
  if (!plannedTime.ok) return failure(editError('invalid_input', plannedTime.error.message, 'plannedLocalTime', plannedTime.error));
  if (!plannedDuration.ok) return failure(editError('invalid_input', plannedDuration.error.message, 'plannedDurationMinutes', plannedDuration.error));
  if (!plannedBlock.ok) return failure(editError('invalid_input', plannedBlock.error.message, 'plannedBlock', plannedBlock.error));
  if (!reminderTime.ok) return failure(editError('invalid_input', reminderTime.error.message, 'reminderLocalTime', reminderTime.error));
  if (!visualIdentity.ok) return visualIdentity;

  let updatedAt: number;
  const generatedIds: string[] = [];
  try {
    updatedAt = dependencies.clock.nowEpochMilliseconds();
    for (let index = 0; index < 5; index += 1) generatedIds.push(dependencies.idGenerator.generateId());
  } catch (cause: unknown) {
    return failure(editError('data_integrity_failure', 'The edit identifier or clock source failed.', undefined, cause));
  }
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0 || new Set(generatedIds).size !== 5) {
    return failure(editError('data_integrity_failure', 'The edit identifier or clock source returned invalid data.'));
  }
  const parsedIds = generatedIds.map((id, index) => parsePlannerId(id, `generatedIds[${index}]`));
  if (parsedIds.some((id) => !id.ok)) {
    return failure(editError('data_integrity_failure', 'The edit identifier source returned an invalid UUID.'));
  }

  return success(Object.freeze({
    habitId: habitId.value,
    currentLocalDate: currentDate.value,
    effectiveLocalDate: effectiveDate.value,
    name: name.value,
    description: description.value,
    schedule: schedule.value,
    tracking: tracking.value,
    importance: importance.value,
    plannedLocalTime: plannedTime.value,
    plannedBlock: plannedBlock.value,
    plannedDurationMinutes: plannedDuration.value,
    reminderLocalTime: reminderTime.value,
    // The last of the five: the four configuration families take the first four, and a
    // reminder that has to be created takes this one.
    reminderId: (() => {
      const id = parsedIds[4];
      if (id === undefined || !id.ok) throw new Error('Validated edit identifier unexpectedly failed.');
      return id.value;
    })(),
    visualIdentity: visualIdentity.value,
    generatedIds: Object.freeze(parsedIds.slice(0, 4).map((id) => {
      if (!id.ok) throw new Error('Validated edit identifier unexpectedly failed.');
      return id.value;
    })),
    updatedAt,
  }));
}

function mapPersistenceError(error: { readonly code: string; readonly message: string }): EditHabitError {
  switch (error.code) {
    case 'edit_habit_not_found': return editError('not_found', error.message, undefined, error);
    case 'edit_habit_archived': return editError('archived_habit', error.message, undefined, error);
    case 'edit_past_effective_date': return editError('past_effective_date', error.message, 'effectiveLocalDate', error);
    case 'edit_same_day_correction_not_eligible': return editError('same_day_correction_not_eligible', error.message, 'effectiveLocalDate', error);
    case 'edit_future_version_conflict': return editError('future_version_conflict', error.message, 'effectiveLocalDate', error);
    case 'edit_stale_conflict': return editError('stale_conflict', error.message, undefined, error);
    case 'edit_database_failure': return editError('database_failure', error.message, undefined, error);
    default: return editError('data_integrity_failure', error.message, undefined, error);
  }
}

function editError(code: EditHabitError['code'], message: string, field?: string, cause?: unknown): EditHabitError {
  return Object.freeze({ name: 'EditHabitError', code, message, ...(field === undefined ? {} : { field }), ...(cause === undefined ? {} : { cause }) });
}
