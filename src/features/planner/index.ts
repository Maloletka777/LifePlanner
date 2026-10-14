import {
  createAddHabitDependency,
  createCorrectHabitObservation,
  createCreateHabit,
  createGetPlannerOccurrencesForDate,
  createGetPlannerDateSummariesForRange,
  createGetPlannerOverviewAnalytics,
  createRecordHabitObservation,
  createListPlannerHabits,
  createGetPlannerHabitDetail,
  createArchiveHabit,
  createRestoreHabit,
  createPermanentlyDeleteHabit,
  createPreviewDeleteHabitChain,
  createDeleteHabitChain,
  createEditHabit,
  createChangeOrdinaryParent,
  createCreateHabitBundle,
  createGetRoutineConversionPreview,
  createConvertOrganizationalParentToRoutine,
  createGetPlannerScheduleSummaryForDate,
  createGetLikelyHabitDuplicates,
  createAddHabitChecklistLines,
  createGetHabitChecklists,
  createGetGrowingRoutines,
  createGetHabitClosureRules,
  createGetRoutineGrowthHistory,
  createSetRoutineGrowthDetails,
  createStartGrowingRoutine,
  createStopGrowingRoutine,
  createSetHabitClosureRule,
  createRemoveHabitChecklistLine,
  createSetHabitChecklistLineDone,
  createRunPlannerMaintenance,
  createReconcileReminders,
} from './application';
import {
  createExpoReminderNotificationGateway,
  createProductionPlannerUnitOfWork,
  expoCryptoIdGenerator,
  systemClock,
} from './infrastructure';

const plannerUnitOfWork = createProductionPlannerUnitOfWork();

export const createHabitWithProductionPersistence = createCreateHabit({
  unitOfWork: plannerUnitOfWork,
  idGenerator: expoCryptoIdGenerator,
  clock: systemClock,
});

export const addHabitDependencyWithProductionPersistence =
  createAddHabitDependency({
    unitOfWork: plannerUnitOfWork,
    idGenerator: expoCryptoIdGenerator,
    clock: systemClock,
  });

export const recordHabitObservationWithProductionPersistence =
  createRecordHabitObservation({
    unitOfWork: plannerUnitOfWork,
    idGenerator: expoCryptoIdGenerator,
    clock: systemClock,
  });

export const correctHabitObservationWithProductionPersistence =
  createCorrectHabitObservation({
    unitOfWork: plannerUnitOfWork,
    idGenerator: expoCryptoIdGenerator,
    clock: systemClock,
  });

/**
 * Subtasks, composed like everything else — and read through a query of their
 * own, so nothing that computes a record ever loads them.
 */
const checklistDependencies = { clock: systemClock, idGenerator: expoCryptoIdGenerator, unitOfWork: plannerUnitOfWork };

export const getHabitChecklistsWithProductionPersistence = createGetHabitChecklists(checklistDependencies);
export const addHabitChecklistLinesWithProductionPersistence = createAddHabitChecklistLines(checklistDependencies);
export const setHabitChecklistLineDoneWithProductionPersistence = createSetHabitChecklistLineDone(checklistDependencies);
export const removeHabitChecklistLineWithProductionPersistence = createRemoveHabitChecklistLine(checklistDependencies);
export const getHabitClosureRulesWithProductionPersistence = createGetHabitClosureRules(checklistDependencies);
export const setHabitClosureRuleWithProductionPersistence = createSetHabitClosureRule(checklistDependencies);

/**
 * The second floor, composed on the same three dependencies.
 *
 * It shares them because a growth attempt is an ordinary row written at a moment with an
 * id — nothing about it needs a different clock or a different generator. What keeps the
 * two floors apart is the **table**, which nothing else joins to, rather than a second
 * set of plumbing.
 */
export const getGrowingRoutinesWithProductionPersistence = createGetGrowingRoutines(checklistDependencies);
export const getRoutineGrowthHistoryWithProductionPersistence = createGetRoutineGrowthHistory(checklistDependencies);
export const startGrowingRoutineWithProductionPersistence = createStartGrowingRoutine(checklistDependencies);
export const stopGrowingRoutineWithProductionPersistence = createStopGrowingRoutine(checklistDependencies);
export const setRoutineGrowthDetailsWithProductionPersistence = createSetRoutineGrowthDetails(checklistDependencies);

/**
 * Making the operating system hold what the person asked for.
 *
 * The gateway is the only thing in the application that knows `expo-notifications`
 * exists; everything above it — the plan, the statuses, the reconciliation — is written
 * against a port and asserted in the Node runner against a fake.
 */
/**
 * Asking for permission belongs to the surface that sets a reminder, and reading what the
 * person did with a notification belongs to the shell, so those functions are re-exported
 * and the gateway itself is not.
 */
export {
  addReminderResponseListener,
  configureReminderNotificationActions,
  configureReminderNotificationPresentation,
  lastReminderResponse,
  requestReminderPermission,
} from './infrastructure';

export const reconcileRemindersWithProductionPersistence = createReconcileReminders({
  clock: systemClock,
  gateway: createExpoReminderNotificationGateway(),
  unitOfWork: plannerUnitOfWork,
});

/**
 * The two sweeps the application runs on itself: the retired subtask model, and
 * tasks a week past the day they belonged to.
 */
export const runPlannerMaintenanceWithProductionPersistence = createRunPlannerMaintenance({
  deleteHabit: (command) => permanentlyDeleteHabitWithProductionPersistence(command),
  unitOfWork: plannerUnitOfWork,
});

export const getPlannerOccurrencesForDateWithProductionPersistence =
  createGetPlannerOccurrencesForDate({ unitOfWork: plannerUnitOfWork });

export const getPlannerDateSummariesForRangeWithProductionPersistence =
  createGetPlannerDateSummariesForRange({ unitOfWork: plannerUnitOfWork });

export const getPlannerOverviewAnalyticsWithProductionPersistence =
  createGetPlannerOverviewAnalytics({ unitOfWork: plannerUnitOfWork });

export const listPlannerHabitsWithProductionPersistence =
  createListPlannerHabits({ unitOfWork: plannerUnitOfWork });

export const getPlannerHabitDetailWithProductionPersistence =
  createGetPlannerHabitDetail({ unitOfWork: plannerUnitOfWork });

export const archiveHabitWithProductionPersistence = createArchiveHabit({ unitOfWork: plannerUnitOfWork, idGenerator: expoCryptoIdGenerator, clock: systemClock });
export const restoreHabitWithProductionPersistence = createRestoreHabit({ unitOfWork: plannerUnitOfWork, idGenerator: expoCryptoIdGenerator, clock: systemClock });
export const permanentlyDeleteHabitWithProductionPersistence = createPermanentlyDeleteHabit({ unitOfWork: plannerUnitOfWork, idGenerator: expoCryptoIdGenerator, clock: systemClock });
export const previewDeleteHabitChainWithProductionPersistence = createPreviewDeleteHabitChain({ unitOfWork: plannerUnitOfWork });
export const deleteHabitChainWithProductionPersistence = createDeleteHabitChain({ unitOfWork: plannerUnitOfWork, idGenerator: expoCryptoIdGenerator, clock: systemClock });
export const editHabitWithProductionPersistence = createEditHabit({ unitOfWork: plannerUnitOfWork, idGenerator: expoCryptoIdGenerator, clock: systemClock });
export const changeOrdinaryParentWithProductionPersistence = createChangeOrdinaryParent({ unitOfWork: plannerUnitOfWork, idGenerator: expoCryptoIdGenerator, clock: systemClock });
export const createHabitBundleWithProductionPersistence = createCreateHabitBundle({ unitOfWork: plannerUnitOfWork, idGenerator: expoCryptoIdGenerator, clock: systemClock });
export const getRoutineConversionPreviewWithProductionPersistence = createGetRoutineConversionPreview({ unitOfWork: plannerUnitOfWork });
export const convertOrganizationalParentToRoutineWithProductionPersistence = createConvertOrganizationalParentToRoutine({ unitOfWork: plannerUnitOfWork, idGenerator: expoCryptoIdGenerator, clock: systemClock });
export const getPlannerScheduleSummaryForDateWithProductionPersistence = createGetPlannerScheduleSummaryForDate({ unitOfWork: plannerUnitOfWork });
export const getLikelyHabitDuplicatesWithProductionPersistence = createGetLikelyHabitDuplicates({ unitOfWork: plannerUnitOfWork });

export * from './application';
export * from './domain';
export type * from './repositories';
