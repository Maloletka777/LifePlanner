import type {
  ObservationChain,
  ObservationFact,
  ObservationValue,
  Result,
} from '../domain';
import type {
  HabitAggregate,
  InitialHabitAggregatePersistenceInput,
} from './habit-aggregate';
import type {
  AddDependencyAggregatePersistenceInput,
  HabitDependencyAggregate,
} from './habit-dependency-aggregate';
import type {
  PlannerChecklistLine,
  PlannerChecklistRemovalInput,
  PlannerChecklistTickInput,
  PlannerChecklistWriteInput,
  PlannerChecklistsByHabit,
} from './planner-checklist-repository';
import type {
  PlannerGrowthAttemptRow,
  PlannerGrowthDetailsInput,
  PlannerGrowthStartInput,
  PlannerGrowthStopInput,
} from './planner-growth-repository';
import type {
  ReminderProjection,
  ReminderProjectionWrite,
} from '../application/notifications/reminder-notification-plan';
import type { PlannerPersistenceError } from './planner-persistence-error';
import type { PlannerOccurrenceDataSet } from './planner-occurrence-repository';
import type {
  ListPlannerHabitsInput,
  PlannerHabitCatalogueItem,
  PlannerHabitDetail,
} from './planner-management-repository';
import type {
  ApplicableObservationContextReadModel,
  CorrectObservationPersistenceInput,
  ObservationCorrectionReadModel,
  ObservationRecordReadModel,
  RecordObservationPersistenceInput,
} from './observation-repository';
import type {
  DeleteHabitInput,
  DeleteHabitChainInput,
  DeleteHabitChainImpact,
  DeleteHabitChainReceipt,
  DeleteHabitReceipt,
  LifecycleWriteInput,
  LifecycleWriteReceipt,
  PreviewDeleteHabitChainInput,
} from './habit-lifecycle-repository';
import type { EditHabitPersistenceInput, EditHabitReceipt } from './habit-edit-repository';
import type { OrdinaryParentChangeInput, OrdinaryParentChangeReceipt } from './habit-ordinary-parent-repository';
import type { RoutineConversionPersistenceInput, RoutineConversionReceipt } from './habit-routine-conversion-repository';

export interface PlannerUnitOfWork {
  createHabitBundle(input: Readonly<{ habits: readonly InitialHabitAggregatePersistenceInput[]; ordinaryRelationships: readonly OrdinaryParentChangeInput[]; conditionalRelationships?: readonly AddDependencyAggregatePersistenceInput[] }>): Promise<Result<readonly HabitAggregate[], PlannerPersistenceError>>;
  changeOrdinaryParent(input: OrdinaryParentChangeInput): Promise<Result<OrdinaryParentChangeReceipt, PlannerPersistenceError>>;
  convertOrganizationalParentToRoutine(input: RoutineConversionPersistenceInput): Promise<Result<RoutineConversionReceipt, PlannerPersistenceError>>;
  editHabit(input: EditHabitPersistenceInput): Promise<Result<EditHabitReceipt, PlannerPersistenceError>>;
  archiveHabit(input: LifecycleWriteInput): Promise<Result<LifecycleWriteReceipt, PlannerPersistenceError>>;
  restoreHabit(input: LifecycleWriteInput): Promise<Result<LifecycleWriteReceipt, PlannerPersistenceError>>;
  permanentlyDeleteHabit(input: DeleteHabitInput): Promise<Result<DeleteHabitReceipt, PlannerPersistenceError>>;
  previewDeleteHabitChain(input: PreviewDeleteHabitChainInput): Promise<Result<DeleteHabitChainImpact, PlannerPersistenceError>>;
  deleteHabitChain(input: DeleteHabitChainInput): Promise<Result<DeleteHabitChainReceipt, PlannerPersistenceError>>;
  listPlannerHabits(
    input: ListPlannerHabitsInput,
  ): Promise<Result<readonly PlannerHabitCatalogueItem[], PlannerPersistenceError>>;

  getPlannerHabitDetail(
    habitId: string,
    asOfLocalDate: string,
  ): Promise<Result<PlannerHabitDetail | null, PlannerPersistenceError>>;

  loadPlannerOccurrenceData(
    selectedLocalDate: string,
  ): Promise<Result<PlannerOccurrenceDataSet, PlannerPersistenceError>>;

  /**
   * Subtasks are loaded by their **own** query and never folded into the day's
   * occurrence read model, so nothing that computes a record can see them.
   */
  loadHabitChecklists(
    habitIds: readonly string[],
    localDate: string,
  ): Promise<Result<PlannerChecklistsByHabit, PlannerPersistenceError>>;

  /**
   * How each of those items closes: by its own checkbox, or by its last line.
   *
   * Absence is the default and the default is «by hand», so every habit written before
   * Migration 011 reads back `false` and behaves as it did.
   */
  loadHabitClosureRules(
    habitIds: readonly string[],
  ): Promise<Result<ReadonlyMap<string, boolean>, PlannerPersistenceError>>;

  setHabitClosureRule(
    input: Readonly<{ habitId: string; closesByChecklist: boolean; updatedAt: number }>,
  ): Promise<Result<boolean, PlannerPersistenceError>>;

  /**
   * The routines a person is deliberately growing (Migration 015).
   *
   * These five are the **second floor**, and none of them reads or writes an observation.
   * Ordinary analytics never calls them, which is what keeps «the growth model cannot
   * reach a completion figure» a property of the wiring rather than a rule to remember.
   *
   * A row is an **attempt**: `loadHabitGrowth` returns every attempt a habit has had,
   * oldest first, because one that ended still happened and the later one starts from
   * zero of its own.
   */
  loadHabitGrowth(
    habitIds: readonly string[],
  ): Promise<Result<ReadonlyMap<string, readonly PlannerGrowthAttemptRow[]>, PlannerPersistenceError>>;

  /** Every open attempt, across all habits — what the Growing surface lists. */
  loadOpenHabitGrowth(): Promise<Result<readonly PlannerGrowthAttemptRow[], PlannerPersistenceError>>;

  startHabitGrowth(
    input: PlannerGrowthStartInput,
  ): Promise<Result<PlannerGrowthAttemptRow, PlannerPersistenceError>>;

  /** Closes the open attempt. `false` when there was none, which is not an error. */
  stopHabitGrowth(
    input: PlannerGrowthStopInput,
  ): Promise<Result<boolean, PlannerPersistenceError>>;

  setHabitGrowthDetails(
    input: PlannerGrowthDetailsInput,
  ): Promise<Result<boolean, PlannerPersistenceError>>;

  /**
   * What the operating system was told about each reminder (Migration 012).
   *
   * Intent lives in `habit_reminders` and is read through the catalogue like every other
   * reminder fact; these three are the **projection** — an outcome, recorded — and none of
   * them writes to intent.
   */
  loadReminderSchedules(): Promise<Result<readonly ReminderProjection[], PlannerPersistenceError>>;

  saveReminderSchedules(
    writes: readonly ReminderProjectionWrite[],
    updatedAt: number,
  ): Promise<Result<number, PlannerPersistenceError>>;

  pruneReminderSchedules(): Promise<Result<number, PlannerPersistenceError>>;

  writeHabitChecklistLines(
    input: PlannerChecklistWriteInput,
  ): Promise<Result<readonly PlannerChecklistLine[], PlannerPersistenceError>>;

  setHabitChecklistTick(
    input: PlannerChecklistTickInput,
  ): Promise<Result<PlannerChecklistLine, PlannerPersistenceError>>;

  removeHabitChecklistLine(
    input: PlannerChecklistRemovalInput,
  ): Promise<Result<string, PlannerPersistenceError>>;

  /** Everything a hard deletion of the item has to take with it. */
  deleteHabitChecklist(habitId: string): Promise<Result<number, PlannerPersistenceError>>;

  loadPlannerOccurrenceDataRange(
    startDate: string,
    endDate: string,
  ): Promise<Result<readonly PlannerOccurrenceDataSet[], PlannerPersistenceError>>;

  addDependencyAggregate(
    input: AddDependencyAggregatePersistenceInput,
  ): Promise<Result<HabitDependencyAggregate, PlannerPersistenceError>>;

  createInitialHabitAggregate(
    input: InitialHabitAggregatePersistenceInput,
  ): Promise<Result<HabitAggregate, PlannerPersistenceError>>;

  readInitialHabitAggregateById(
    habitId: string,
  ): Promise<Result<HabitAggregate | null, PlannerPersistenceError>>;

  recordObservation(
    input: RecordObservationPersistenceInput,
  ): Promise<Result<ObservationRecordReadModel, PlannerPersistenceError>>;

  correctObservation(
    input: CorrectObservationPersistenceInput,
  ): Promise<Result<ObservationCorrectionReadModel, PlannerPersistenceError>>;

  findObservationById(
    observationId: string,
  ): Promise<Result<ObservationFact | null, PlannerPersistenceError>>;

  loadObservationChain(
    observationId: string,
  ): Promise<Result<ObservationChain | null, PlannerPersistenceError>>;

  loadApplicableObservationContext(input: Readonly<{
    habitId: string;
    occurrenceLocalDate: string;
    occurrenceTimezone: string;
    value: ObservationValue;
    allowVoid: boolean;
  }>): Promise<Result<ApplicableObservationContextReadModel, PlannerPersistenceError>>;
}
