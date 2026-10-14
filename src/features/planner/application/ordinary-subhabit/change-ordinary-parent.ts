import { failure, isOrdinaryCompletionRole, parsePlannerId, parsePlannerLocalDate, success, type OrdinaryCompletionRole, type Result } from '../../domain';
import type { OrdinaryParentChangeReceipt, PlannerUnitOfWork } from '../../repositories';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';

export interface ChangeOrdinaryParentCommand {
  readonly action: 'attach' | 'reparent' | 'detach';
  readonly childHabitId: string;
  readonly parentHabitId: string | null;
  readonly effectiveLocalDate: string;
  readonly completionRole?: OrdinaryCompletionRole;
}

export interface ChangeOrdinaryParentError {
  readonly name: 'ChangeOrdinaryParentError';
  readonly code: 'invalid_input' | 'not_found' | 'lifecycle_conflict' | 'relationship_mode_conflict' | 'duplicate' | 'cycle' | 'depth' | 'boundary_conflict' | 'data_integrity_failure' | 'database_failure';
  readonly message: string;
  readonly cause?: unknown;
}

export type ChangeOrdinaryParentResult = Result<OrdinaryParentChangeReceipt, ChangeOrdinaryParentError>;
export type ChangeOrdinaryParent = (command: ChangeOrdinaryParentCommand) => Promise<ChangeOrdinaryParentResult>;

export function createChangeOrdinaryParent(dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork; idGenerator: IdGenerator; clock: Clock }>): ChangeOrdinaryParent {
  return async (command) => {
    const child = parsePlannerId(command.childHabitId, 'childHabitId');
    const date = parsePlannerLocalDate(command.effectiveLocalDate, 'effectiveLocalDate');
    const parent = command.parentHabitId === null ? success(null) : parsePlannerId(command.parentHabitId, 'parentHabitId');
    const completionRole = command.completionRole ?? 'organizational';
    if (!child.ok || !date.ok || !parent.ok || !isOrdinaryCompletionRole(completionRole) || (command.action === 'detach' ? parent.value !== null : parent.value === null)) return failure(changeError('invalid_input', 'The ordinary sub-habit command is invalid.'));
    let relationshipId = null;
    let relationshipVersionId = null;
    let updatedAt: number;
    try {
      updatedAt = dependencies.clock.nowEpochMilliseconds();
      if (command.action !== 'detach') {
        const first = parsePlannerId(dependencies.idGenerator.generateId(), 'relationshipId');
        const second = parsePlannerId(dependencies.idGenerator.generateId(), 'relationshipVersionId');
        if (!first.ok || !second.ok || first.value === second.value) return failure(changeError('data_integrity_failure', 'The relationship identifier source returned invalid data.'));
        relationshipId = first.value; relationshipVersionId = second.value;
      }
    } catch (cause: unknown) { return failure(changeError('data_integrity_failure', 'The relationship identifier or clock source failed.', cause)); }
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) return failure(changeError('data_integrity_failure', 'The relationship clock source returned invalid data.'));
    const result = await dependencies.unitOfWork.changeOrdinaryParent({ action: command.action, childHabitId: child.value, parentHabitId: parent.value, effectiveLocalDate: date.value, relationshipId, relationshipVersionId, completionRole, updatedAt });
    return result.ok ? success(result.value) : failure(mapError(result.error));
  };
}

function mapError(error: { readonly code: string; readonly message: string }): ChangeOrdinaryParentError {
  const mapping: Record<string, ChangeOrdinaryParentError['code']> = {
    ordinary_habit_not_found: 'not_found', ordinary_habit_archived: 'lifecycle_conflict', ordinary_relationship_mode_conflict: 'relationship_mode_conflict', ordinary_duplicate: 'duplicate', ordinary_cycle: 'cycle', ordinary_depth_exceeded: 'depth', ordinary_boundary_conflict: 'boundary_conflict', ordinary_database_failure: 'database_failure',
  };
  return changeError(mapping[error.code] ?? 'data_integrity_failure', error.message, error);
}

function changeError(code: ChangeOrdinaryParentError['code'], message: string, cause?: unknown): ChangeOrdinaryParentError {
  return Object.freeze({ name: 'ChangeOrdinaryParentError', code, message, ...(cause === undefined ? {} : { cause }) });
}
