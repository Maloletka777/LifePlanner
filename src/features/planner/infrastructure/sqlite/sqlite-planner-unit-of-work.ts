import {
  failure,
  parsePlannerId,
  parsePlannerLocalDate,
  parsePlannerTimezone,
  success,
  validateObservationValueShape,
  type Result,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type PlannerPersistenceError,
  type PlannerUnitOfWork,
} from '../../repositories';
import {
  insertInitialHabitRows,
  readInitialHabitAggregate,
  validateCategoryForCreation,
} from './sqlite-habit-repository';
import { validateAndInsertDependencyAggregate } from './sqlite-habit-dependency-repository';
import {
  correctHabitObservation,
  findObservation,
  loadApplicableObservationContext,
  loadObservationChain,
  recordHabitObservation,
} from './sqlite-habit-observation-repository';
import {
  loadReminderSchedules,
  pruneReminderSchedules,
  saveReminderSchedules,
} from './sqlite-reminder-schedule-repository';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';
import { loadPlannerOccurrenceData, loadPlannerOccurrenceDataRange } from './sqlite-planner-occurrence-repository';
import {
  deleteHabitChecklist,
  loadHabitChecklists,
  loadHabitClosureRules,
  setHabitClosureRule,
  removeHabitChecklistLine,
  setHabitChecklistTick,
  writeHabitChecklistLines,
} from './sqlite-planner-checklist-repository';
import {
  loadHabitGrowth,
  loadOpenHabitGrowth,
  setHabitGrowthDetails,
  startHabitGrowth,
  stopHabitGrowth,
} from './sqlite-planner-growth-repository';
import { getPlannerHabitDetail, listPlannerHabits } from './sqlite-planner-management-repository';
import { archiveHabit, deleteHabitChain, permanentlyDeleteHabit, previewDeleteHabitChain, restoreHabit } from './sqlite-habit-lifecycle-repository';
import { editHabit } from './sqlite-habit-edit-repository';
import { changeOrdinaryParent } from './sqlite-habit-ordinary-parent-repository';
import { convertOrganizationalParentToRoutine } from './sqlite-habit-routine-conversion-repository';

export type PlannerDatabaseAccess = <T>(
  operation: (database: PlannerSqliteDatabase) => Promise<T>,
) => Promise<T>;

class PlannerTransactionAbort extends Error {
  constructor(readonly persistenceError: PlannerPersistenceError) {
    super(persistenceError.message);
    this.name = 'PlannerTransactionAbort';
  }
}

export function createSqlitePlannerUnitOfWork(
  databaseAccess: PlannerDatabaseAccess,
): PlannerUnitOfWork {
  return {
    async createHabitBundle(input) {
      try {
        const aggregates = await databaseAccess((database) => database.withTransactionAsync(async () => {
          const values = [];
          for (const habit of input.habits) {
            const category = await validateCategoryForCreation(database, habit.categoryId);
            if (!category.ok) throw new PlannerTransactionAbort(category.error);
            await insertInitialHabitRows(database, habit);
            const readback = await readInitialHabitAggregate(database, habit.habitId, habit);
            if (!readback.ok || readback.value === null) throw new PlannerTransactionAbort(readback.ok ? createPlannerPersistenceError('data_integrity_failure', 'A bundled habit was absent during readback.', { operation: 'createHabitBundle' }) : readback.error);
            values.push(readback.value);
          }
          for (const relationship of input.ordinaryRelationships) {
            const changed = await changeOrdinaryParent(database, relationship);
            if (!changed.ok) throw new PlannerTransactionAbort(changed.error);
          }
          for (const relationship of input.conditionalRelationships ?? []) {
            const changed = await validateAndInsertDependencyAggregate(database, relationship);
            if (!changed.ok) throw new PlannerTransactionAbort(changed.error);
          }
          return Object.freeze(values);
        }));
        return success(aggregates);
      } catch (cause: unknown) {
        if (cause instanceof PlannerTransactionAbort) return failure(cause.persistenceError);
        return failure(createPlannerPersistenceError(isConstraintError(cause) ? 'validation_conflict' : 'database_failure', 'The habit bundle transaction failed.', { operation: 'createHabitBundle', cause }));
      }
    },
    async changeOrdinaryParent(input) {
      return lifecycleTransaction(databaseAccess, (database) => changeOrdinaryParent(database, input), 'ordinary_database_failure');
    },
    async convertOrganizationalParentToRoutine(input) {
      return lifecycleTransaction(databaseAccess, (database) => convertOrganizationalParentToRoutine(database, input), 'ordinary_database_failure');
    },
    async editHabit(input) {
      return lifecycleTransaction(databaseAccess, (database) => editHabit(database, input), 'edit_database_failure');
    },
    async archiveHabit(input) {
      return lifecycleTransaction(databaseAccess, (database) => archiveHabit(database, input), 'archive_database_failure');
    },
    async restoreHabit(input) {
      return lifecycleTransaction(databaseAccess, (database) => restoreHabit(database, input), 'restore_database_failure');
    },
    async permanentlyDeleteHabit(input) {
      return lifecycleTransaction(databaseAccess, (database) => permanentlyDeleteHabit(database, input), 'delete_database_failure');
    },
    async previewDeleteHabitChain(input) {
      try { return await databaseAccess((database) => previewDeleteHabitChain(database, input)); }
      catch (cause: unknown) { return failure(createPlannerPersistenceError('delete_database_failure', 'The deletion impact could not be read.', { operation: 'previewDeleteHabitChain', cause })); }
    },
    async deleteHabitChain(input) {
      return lifecycleTransaction(databaseAccess, (database) => deleteHabitChain(database, input), 'delete_database_failure');
    },
    async listPlannerHabits(input) {
      try { return await databaseAccess((database) => listPlannerHabits(database, input)); }
      catch (cause: unknown) { return failure(createPlannerPersistenceError('database_failure', 'The Planner habit catalogue could not be read.', { operation: 'listPlannerHabits', cause })); }
    },

    async getPlannerHabitDetail(habitId, asOfLocalDate) {
      const id = parsePlannerId(habitId, 'habitId');
      const date = parsePlannerLocalDate(asOfLocalDate, 'asOfLocalDate');
      if (!id.ok || !date.ok) return observationInputIntegrityFailure('getPlannerHabitDetail');
      try { return await databaseAccess((database) => getPlannerHabitDetail(database, id.value, date.value)); }
      catch (cause: unknown) { return failure(createPlannerPersistenceError('database_failure', 'The Planner habit detail could not be read.', { operation: 'getPlannerHabitDetail', cause })); }
    },

    async loadPlannerOccurrenceData(selectedLocalDate) {
      const date = parsePlannerLocalDate(selectedLocalDate, 'selectedLocalDate');
      if (!date.ok) {
        return failure(
          createPlannerPersistenceError(
            'occurrence_read_model_data_integrity_failure',
            'The selected Planner date is invalid.',
            { operation: 'loadPlannerOccurrenceData', cause: date.error },
          ),
        );
      }
      try {
        return await databaseAccess((database) =>
          loadPlannerOccurrenceData(database, date.value),
        );
      } catch (cause: unknown) {
        return failure(
          createPlannerPersistenceError(
            'occurrence_read_model_database_failure',
            'The selected-date Planner data could not be read.',
            { operation: 'loadPlannerOccurrenceData', cause },
          ),
        );
      }
    },

    /**
     * Subtasks, on their own query.
     *
     * They are deliberately not part of the occurrence read model: what computes
     * a record cannot count what it never reads, so «сабтаски не идут в
     * статистику» is a property of the wiring rather than a rule to remember.
     */
    async loadHabitChecklists(habitIds, localDate) {
      const date = parsePlannerLocalDate(localDate, 'localDate');
      if (!date.ok) return checklistDateFailure('loadHabitChecklists', date.error);
      return checklistOperation(databaseAccess, (database) => loadHabitChecklists(database, habitIds, date.value), 'loadHabitChecklists');
    },

    async loadHabitClosureRules(habitIds) {
      return checklistOperation(databaseAccess, (database) => loadHabitClosureRules(database, habitIds), 'loadHabitClosureRules');
    },

    async setHabitClosureRule(input) {
      return checklistOperation(databaseAccess, (database) => setHabitClosureRule(database, input), 'setHabitClosureRule');
    },

    async loadHabitGrowth(habitIds) {
      return checklistOperation(databaseAccess, (database) => loadHabitGrowth(database, habitIds), 'loadHabitGrowth');
    },

    async loadOpenHabitGrowth() {
      return checklistOperation(databaseAccess, (database) => loadOpenHabitGrowth(database), 'loadOpenHabitGrowth');
    },

    async startHabitGrowth(input) {
      return checklistOperation(databaseAccess, (database) => startHabitGrowth(database, input), 'startHabitGrowth');
    },

    async stopHabitGrowth(input) {
      return checklistOperation(databaseAccess, (database) => stopHabitGrowth(database, input), 'stopHabitGrowth');
    },

    async setHabitGrowthDetails(input) {
      return checklistOperation(databaseAccess, (database) => setHabitGrowthDetails(database, input), 'setHabitGrowthDetails');
    },

    async loadReminderSchedules() {
      return checklistOperation(databaseAccess, (database) => loadReminderSchedules(database), 'loadReminderSchedules');
    },

    async saveReminderSchedules(writes, updatedAt) {
      return checklistOperation(databaseAccess, (database) => saveReminderSchedules(database, writes, updatedAt), 'saveReminderSchedules');
    },

    async pruneReminderSchedules() {
      return checklistOperation(databaseAccess, (database) => pruneReminderSchedules(database), 'pruneReminderSchedules');
    },

    async writeHabitChecklistLines(input) {
      return checklistOperation(databaseAccess, (database) => database.withTransactionAsync(
        () => writeHabitChecklistLines(database, input),
      ), 'writeHabitChecklistLines');
    },

    async setHabitChecklistTick(input) {
      return checklistOperation(databaseAccess, (database) => setHabitChecklistTick(database, input), 'setHabitChecklistTick');
    },

    async removeHabitChecklistLine(input) {
      return checklistOperation(databaseAccess, (database) => database.withTransactionAsync(
        () => removeHabitChecklistLine(database, input),
      ), 'removeHabitChecklistLine');
    },

    async deleteHabitChecklist(habitId) {
      return checklistOperation(databaseAccess, (database) => database.withTransactionAsync(
        () => deleteHabitChecklist(database, habitId),
      ), 'deleteHabitChecklist');
    },

    async loadPlannerOccurrenceDataRange(startDate, endDate) {
      const start = parsePlannerLocalDate(startDate, 'startDate');
      const end = parsePlannerLocalDate(endDate, 'endDate');
      if (!start.ok || !end.ok || start.value > end.value) {
        return failure(
          createPlannerPersistenceError(
            'occurrence_read_model_data_integrity_failure',
            'The Planner marker range is invalid.',
            { operation: 'loadPlannerOccurrenceDataRange' },
          ),
        );
      }
      try {
        return await databaseAccess((database) =>
          loadPlannerOccurrenceDataRange(database, start.value, end.value),
        );
      } catch (cause: unknown) {
        return failure(
          createPlannerPersistenceError(
            'occurrence_read_model_database_failure',
            'The Planner marker range could not be read.',
            { operation: 'loadPlannerOccurrenceDataRange', cause },
          ),
        );
      }
    },

    async addDependencyAggregate(input) {
      try {
        const aggregate = await databaseAccess((database) =>
          database.withTransactionAsync(async () => {
            const result = await validateAndInsertDependencyAggregate(
              database,
              input,
            );
            if (!result.ok) {
              throw new PlannerTransactionAbort(result.error);
            }
            return result.value;
          }),
        );
        return success(aggregate);
      } catch (cause: unknown) {
        if (cause instanceof PlannerTransactionAbort) {
          return failure(cause.persistenceError);
        }
        return failure(
          createPlannerPersistenceError(
            isConstraintError(cause)
              ? 'dependency_data_integrity_failure'
              : 'dependency_database_failure',
            'The dependency aggregate transaction failed.',
            { operation: 'addDependencyAggregate', cause },
          ),
        );
      }
    },

    async createInitialHabitAggregate(input) {
      try {
        const aggregate = await databaseAccess((database) =>
          database.withTransactionAsync(async () => {
            const categoryResult = await validateCategoryForCreation(
              database,
              input.categoryId,
            );
            if (!categoryResult.ok) {
              throw new PlannerTransactionAbort(categoryResult.error);
            }

            await insertInitialHabitRows(database, input);
            const readbackResult = await readInitialHabitAggregate(
              database,
              input.habitId,
              input,
            );
            if (!readbackResult.ok) {
              throw new PlannerTransactionAbort(readbackResult.error);
            }
            if (readbackResult.value === null) {
              throw new PlannerTransactionAbort(
                createPlannerPersistenceError(
                  'data_integrity_failure',
                  'The created habit was absent during transactional readback.',
                  { operation: 'createInitialHabitAggregate' },
                ),
              );
            }
            return readbackResult.value;
          }),
        );
        return success(aggregate);
      } catch (cause: unknown) {
        if (cause instanceof PlannerTransactionAbort) {
          return failure(cause.persistenceError);
        }
        return failure(
          createPlannerPersistenceError(
            isConstraintError(cause)
              ? 'validation_conflict'
              : 'database_failure',
            'The initial habit aggregate transaction failed.',
            { operation: 'createInitialHabitAggregate', cause },
          ),
        );
      }
    },

    async readInitialHabitAggregateById(habitId) {
      const idResult = parsePlannerId(habitId, 'habitId');
      if (!idResult.ok) {
        return failure(
          createPlannerPersistenceError(
            'data_integrity_failure',
            'The requested habit identifier is invalid.',
            { operation: 'readInitialHabitAggregateById', cause: idResult.error },
          ),
        );
      }
      try {
        return await databaseAccess((database) =>
          readInitialHabitAggregate(database, idResult.value),
        );
      } catch (cause: unknown) {
        return failure(
          createPlannerPersistenceError(
            'database_failure',
            'The initial habit aggregate could not be read.',
            { operation: 'readInitialHabitAggregateById', cause },
          ),
        );
      }
    },

    async recordObservation(input) {
      try {
        const observation = await databaseAccess((database) =>
          database.withTransactionAsync(async () => {
            const result = await recordHabitObservation(database, input);
            if (!result.ok) throw new PlannerTransactionAbort(result.error);
            return result.value;
          }),
        );
        return success(observation);
      } catch (cause: unknown) {
        return observationTransactionFailure(cause, 'recordObservation');
      }
    },

    async correctObservation(input) {
      try {
        const chain = await databaseAccess((database) =>
          database.withTransactionAsync(async () => {
            const result = await correctHabitObservation(database, input);
            if (!result.ok) throw new PlannerTransactionAbort(result.error);
            return result.value;
          }),
        );
        return success(chain);
      } catch (cause: unknown) {
        return observationTransactionFailure(cause, 'correctObservation');
      }
    },

    async findObservationById(observationId) {
      const id = parsePlannerId(observationId, 'observationId');
      if (!id.ok) return observationInputIntegrityFailure('findObservationById');
      try {
        return await databaseAccess((database) => findObservation(database, id.value));
      } catch (cause: unknown) {
        return failure(
          createPlannerPersistenceError(
            'observation_database_failure',
            'The observation could not be read from local storage.',
            { operation: 'findObservationById', cause },
          ),
        );
      }
    },

    async loadObservationChain(observationId) {
      const id = parsePlannerId(observationId, 'observationId');
      if (!id.ok) return observationInputIntegrityFailure('loadObservationChain');
      try {
        return await databaseAccess((database) => loadObservationChain(database, id.value));
      } catch (cause: unknown) {
        return failure(
          createPlannerPersistenceError(
            'observation_database_failure',
            'The observation chain could not be read from local storage.',
            { operation: 'loadObservationChain', cause },
          ),
        );
      }
    },

    async loadApplicableObservationContext(input) {
      const id = parsePlannerId(input.habitId, 'habitId');
      const date = parsePlannerLocalDate(input.occurrenceLocalDate, 'occurrenceLocalDate');
      const timezone = parsePlannerTimezone(input.occurrenceTimezone, 'occurrenceTimezone');
      const value = validateObservationValueShape(input.value, {
        allowVoid: input.allowVoid,
      });
      if (!id.ok || !date.ok || !timezone.ok || !value.ok) {
        return observationInputIntegrityFailure('loadApplicableObservationContext');
      }
      try {
        return await databaseAccess((database) =>
          loadApplicableObservationContext(database, {
            habitId: id.value,
            occurrenceLocalDate: date.value,
            occurrenceTimezone: timezone.value,
            value: value.value,
            allowVoid: input.allowVoid,
          }),
        );
      } catch (cause: unknown) {
        return failure(
          createPlannerPersistenceError(
            'observation_database_failure',
            'The observation context could not be read from local storage.',
            { operation: 'loadApplicableObservationContext', cause },
          ),
        );
      }
    },
  };
}

async function lifecycleTransaction<T>(
  databaseAccess: PlannerDatabaseAccess,
  operation: (database: PlannerSqliteDatabase) => Promise<Result<T, PlannerPersistenceError>>,
  databaseErrorCode: 'archive_database_failure' | 'restore_database_failure' | 'delete_database_failure' | 'edit_database_failure' | 'ordinary_database_failure',
) {
  try {
    const value = await databaseAccess((database) => database.withTransactionAsync(async () => {
      const result = await operation(database);
      if (!result.ok) throw new PlannerTransactionAbort(result.error);
      return result.value;
    }));
    return success(value);
  } catch (cause: unknown) {
    if (cause instanceof PlannerTransactionAbort) return failure(cause.persistenceError);
    return failure(createPlannerPersistenceError(databaseErrorCode, 'The lifecycle transaction failed.', { operation: 'habitLifecycle', cause }));
  }
}

function observationTransactionFailure(
  cause: unknown,
  operation: string,
) {
  if (cause instanceof PlannerTransactionAbort) {
    return failure(cause.persistenceError);
  }
  return failure(
    createPlannerPersistenceError(
      isConstraintError(cause)
        ? 'observation_data_integrity_failure'
        : 'observation_database_failure',
      'The observation transaction failed.',
      { operation, cause },
    ),
  );
}

function observationInputIntegrityFailure(operation: string) {
  return failure(
    createPlannerPersistenceError(
      'observation_data_integrity_failure',
      'The requested observation input is malformed.',
      { operation },
    ),
  );
}

function isConstraintError(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    /constraint/i.test(cause.message)
  );
}

function checklistDateFailure(operation: string, cause: unknown) {
  return failure(createPlannerPersistenceError('data_integrity_failure', 'The checklist date is invalid.', { operation, cause }));
}

async function checklistOperation<T>(
  databaseAccess: PlannerDatabaseAccess,
  operation: (database: PlannerSqliteDatabase) => Promise<Result<T, PlannerPersistenceError>>,
  name: string,
): Promise<Result<T, PlannerPersistenceError>> {
  try {
    return await databaseAccess(operation);
  } catch (cause: unknown) {
    return failure(createPlannerPersistenceError('database_failure', 'The checklist operation failed.', { operation: name, cause }));
  }
}
