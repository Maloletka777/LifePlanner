import { failure, parsePlannerId, parsePlannerLocalDate, parsePlannerLocalTime, parsePlannerTimezone, success, validateScheduleDefinition, type PlannerId, type Result } from '../../domain';
import {
  createPlannerPersistenceError,
  type DeleteHabitReceipt,
  type DeleteHabitChainImpact,
  type DeleteHabitChainReceipt,
  type LifecycleWriteReceipt,
  type PlannerPersistenceError,
  type PlannerUnitOfWork,
} from '../../repositories';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';

export type HabitLifecycleCommand = Readonly<{ habitId:string; effectiveLocalDate:string; boundaryTimezone:string }>;
export type RestoreHabitCommand = HabitLifecycleCommand & Readonly<{ restoreSchedule?: unknown; restorePlannedLocalTime?: string | null }>;
export type DeleteHabitCommand = HabitLifecycleCommand & Readonly<{ confirmed:boolean }>;
export type HabitLifecycleResult = Result<LifecycleWriteReceipt, PlannerPersistenceError>;
export type DeleteHabitResult = Result<DeleteHabitReceipt, PlannerPersistenceError>;
export type PreviewDeleteHabitChainResult = Result<DeleteHabitChainImpact, PlannerPersistenceError>;
export type DeleteHabitChainResult = Result<DeleteHabitChainReceipt, PlannerPersistenceError>;
type Dependencies = Readonly<{ unitOfWork:PlannerUnitOfWork; idGenerator:IdGenerator; clock:Clock }>;

export function createArchiveHabit(dependencies: Dependencies) {
  return (command:HabitLifecycleCommand) => executeLifecycle(command, dependencies, 'archive');
}
export function createRestoreHabit(dependencies: Dependencies) {
  return (command:RestoreHabitCommand) => executeLifecycle(command, dependencies, 'restore');
}
export function createPermanentlyDeleteHabit(dependencies: Dependencies) {
  return async (command:DeleteHabitCommand):Promise<DeleteHabitResult> => {
    if (!command.confirmed) return failure(error('delete_confirmation_required','Permanent deletion requires explicit confirmation.'));
    const habitId = parsePlannerId(command.habitId, 'habitId');
    const effectiveLocalDate = parsePlannerLocalDate(command.effectiveLocalDate, 'effectiveLocalDate');
    if (!habitId.ok || !effectiveLocalDate.ok) return failure(error('data_integrity_failure', 'The deletion command is invalid.'));
    const preview = await dependencies.unitOfWork.previewDeleteHabitChain({ rootHabitId: habitId.value, asOfLocalDate: effectiveLocalDate.value });
    if (!preview.ok) return preview;
    const prepared=prepare(command,dependencies, preview.value.targetCount * 32);
    if (!prepared.ok) return prepared;
    const deleted = await dependencies.unitOfWork.deleteHabitChain({
      ...prepared.value,
      expectedOrderedTargetHabitIds: preview.value.orderedTargetHabitIds,
      confirmed: true,
    });
    return deleted.ok
      ? success(Object.freeze({
          deleted: true as const,
          affectedDependentCount: deleted.value.affectedDependentCount,
          detachedObservationCount: deleted.value.detachedObservationCount,
        }))
      : deleted;
  };
}
export function createPreviewDeleteHabitChain(dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork }>) {
  return async (command: Readonly<{ rootHabitId: string; asOfLocalDate: string }>): Promise<PreviewDeleteHabitChainResult> => {
    const rootHabitId = parsePlannerId(command.rootHabitId, 'rootHabitId');
    const asOfLocalDate = parsePlannerLocalDate(command.asOfLocalDate, 'asOfLocalDate');
    if (!rootHabitId.ok || !asOfLocalDate.ok) return failure(error('delete_routine_invalid_selection', 'The deletion preview request is invalid.'));
    return dependencies.unitOfWork.previewDeleteHabitChain({ rootHabitId: rootHabitId.value, asOfLocalDate: asOfLocalDate.value });
  };
}
export function createDeleteHabitChain(dependencies: Dependencies) {
  return async (command: DeleteHabitCommand & Readonly<{ expectedOrderedTargetHabitIds: readonly string[] }>): Promise<DeleteHabitChainResult> => {
    if (!command.confirmed) return failure(error('delete_confirmation_required', 'Permanent deletion requires explicit confirmation.'));
    const expected = parseDeleteChainIds(command.expectedOrderedTargetHabitIds, 'expectedOrderedTargetHabitIds');
    if (!expected.ok || expected.value.length === 0) return failure(error('delete_routine_invalid_selection', 'The deletion target snapshot is invalid.'));
    const prepared = prepare(command, dependencies, expected.value.length * 32);
    if (!prepared.ok) return prepared;
    return dependencies.unitOfWork.deleteHabitChain({ ...prepared.value, expectedOrderedTargetHabitIds: expected.value, confirmed: true });
  };
}

async function executeLifecycle(command:HabitLifecycleCommand | RestoreHabitCommand, dependencies:Dependencies, operation:'archive'|'restore'):Promise<HabitLifecycleResult> {
  const prepared=prepare(command,dependencies);
  if (!prepared.ok) return prepared;
  return operation==='archive' ? dependencies.unitOfWork.archiveHabit(prepared.value) : dependencies.unitOfWork.restoreHabit(prepared.value);
}

function prepare(command:HabitLifecycleCommand | RestoreHabitCommand, dependencies:Dependencies, generatedCount = 32) {
  const id=parsePlannerId(command.habitId,'habitId');
  const date=parsePlannerLocalDate(command.effectiveLocalDate,'effectiveLocalDate');
  const timezone=parsePlannerTimezone(command.boundaryTimezone,'boundaryTimezone');
  if (!id.ok || !date.ok || !timezone.ok) return failure(error('data_integrity_failure','The lifecycle command is invalid.'));
  let now:number;
  const generated:string[]=[];
  try { now=dependencies.clock.nowEpochMilliseconds(); for(let i=0;i<generatedCount;i+=1) generated.push(dependencies.idGenerator.generateId()); }
  catch(cause:unknown) { return failure(error('data_integrity_failure','Lifecycle command preparation failed.',cause)); }
  if (!Number.isSafeInteger(now) || now<0 || new Set(generated).size!==generated.length) return failure(error('data_integrity_failure','Lifecycle command sources are invalid.'));
  const parsed=[];
  for (const raw of generated) { const value=parsePlannerId(raw,'generatedId'); if(!value.ok) return failure(error('data_integrity_failure','A lifecycle identifier is invalid.')); parsed.push(value.value); }
  let restoreSchedule;
  let restorePlannedLocalTime;
  if ('restoreSchedule' in command && command.restoreSchedule !== undefined) {
    const candidate = command.restoreSchedule as Record<string, unknown>;
    const effectiveRange = candidate?.effectiveRange as Record<string, unknown> | undefined;
    const schedule = validateScheduleDefinition(effectiveRange === undefined ? candidate : Object.fromEntries([
      ...Object.entries(candidate).filter(([key]) => key !== 'effectiveRange'),
      ['effectiveFrom', effectiveRange.effectiveFrom],
      ['effectiveTo', effectiveRange.effectiveTo],
    ]));
    if (!schedule.ok || schedule.value.effectiveRange.effectiveFrom !== date.value) return failure(error('data_integrity_failure','The restore schedule is invalid.'));
    restoreSchedule = schedule.value;
  }
  if ('restorePlannedLocalTime' in command && command.restorePlannedLocalTime !== undefined) {
    if (command.restorePlannedLocalTime === null) restorePlannedLocalTime = null;
    else {
      const time = parsePlannerLocalTime(command.restorePlannedLocalTime, 'restorePlannedLocalTime');
      if (!time.ok) return failure(error('data_integrity_failure','The restore planned time is invalid.'));
      restorePlannedLocalTime = time.value;
    }
  }
  return success(Object.freeze({habitId:id.value,effectiveLocalDate:date.value,boundaryTimezone:timezone.value,transitionedAt:now,generatedIds:Object.freeze(parsed),...(restoreSchedule===undefined?{}:{restoreSchedule}),...(restorePlannedLocalTime===undefined?{}:{restorePlannedLocalTime})}));
}

function parseDeleteChainIds(values: readonly string[], field: string): Result<readonly PlannerId[], PlannerPersistenceError> {
  if (!Array.isArray(values)) return failure(error('delete_routine_invalid_selection', `${field} must be a list.`));
  const ids: PlannerId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const parsed = parsePlannerId(value, field);
    if (!parsed.ok || seen.has(value)) return failure(error('delete_routine_invalid_selection', `${field} contains an invalid or duplicate identifier.`));
    ids.push(parsed.value);
    seen.add(value);
  }
  return success(Object.freeze(ids));
}

function error(code:PlannerPersistenceError['code'],message:string,cause?:unknown) { return createPlannerPersistenceError(code,message,{operation:'habitLifecycle',...(cause===undefined?{}:{cause})}); }
