import {
  failure,
  addPlannerCalendarDays,
  evaluateSchedule,
  measurePlannerCalendarDays,
  parsePlannerId,
  success,
  validateEffectiveRange,
  type EffectiveRange,
  type PlannerId,
  type PlannerLocalDate,
  type Result,
  type ScheduleDefinition,
  type TrackingDefinition,
} from '../../domain';
import type { PlannerPersistenceError, PlannerUnitOfWork } from '../../repositories';
import { normalizeHabitNameInput } from '../habit-input-validation';
import { revalidateSchedule } from '../create-habit/create-habit';

export type HabitDuplicateScope = 'root' | 'child';
export type LikelyHabitDuplicateReason = 'exact_title_and_schedule_overlap';

export interface LikelyHabitDuplicateCandidate {
  readonly title: string;
  readonly activeFrom: string;
  readonly activeTo: string | null;
  readonly schedule: ScheduleDefinition;
  readonly scope: HabitDuplicateScope;
  readonly trackingMode?: TrackingDefinition['trackingMode'];
}

export interface GetLikelyHabitDuplicatesQuery {
  readonly candidate: LikelyHabitDuplicateCandidate;
  readonly excludeHabitId?: string;
}

export interface LikelyHabitDuplicateMatch {
  readonly habitId: PlannerId;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly scheduleSummary: string;
  readonly activeRange: EffectiveRange;
  readonly scope: HabitDuplicateScope;
  readonly trackingMode: TrackingDefinition['trackingMode'];
  readonly reason: LikelyHabitDuplicateReason;
  readonly confidence: 'exact_title_and_schedule_overlap';
}

export interface LikelyHabitDuplicatePreview {
  readonly normalizedCandidateTitle: string;
  readonly candidateScope: HabitDuplicateScope;
  readonly archivedHabitPolicy: 'excluded';
  readonly warningOnly: true;
  readonly matches: readonly LikelyHabitDuplicateMatch[];
}

export interface LikelyHabitDuplicateError {
  readonly name: 'LikelyHabitDuplicateError';
  readonly code: 'invalid_input' | 'data_integrity_failure' | 'database_failure';
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
}

export type GetLikelyHabitDuplicatesResult = Result<LikelyHabitDuplicatePreview, LikelyHabitDuplicateError>;
export type GetLikelyHabitDuplicates = (query: GetLikelyHabitDuplicatesQuery) => Promise<GetLikelyHabitDuplicatesResult>;

export function createGetLikelyHabitDuplicates(
  dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork }>,
): GetLikelyHabitDuplicates {
  return async (query) => {
    const candidate = validateCandidate(query?.candidate);
    if (!candidate.ok) return candidate;
    let excludeHabitId: PlannerId | null = null;
    if (query.excludeHabitId !== undefined) {
      const parsed = parsePlannerId(query.excludeHabitId, 'excludeHabitId');
      if (!parsed.ok) return duplicateFailure('invalid_input', parsed.error.message, 'excludeHabitId', parsed.error);
      excludeHabitId = parsed.value;
    }
    try {
      const listed = await dependencies.unitOfWork.listPlannerHabits({
        lifecycle: 'active',
        asOfLocalDate: candidate.value.activeRange.effectiveFrom,
      });
      if (!listed.ok) return failure(mapPersistenceError(listed.error));
      const titleAndRangeMatches = listed.value.filter((habit) =>
        habit.habitId !== excludeHabitId &&
        normalizeDuplicateTitle(habit.name) === candidate.value.normalizedTitle &&
        rangesOverlap(habit.activeRange, candidate.value.activeRange),
      );
      const details = await Promise.all(titleAndRangeMatches.map(async (habit) => {
        const overlapStart = maxDate(habit.activeRange.effectiveFrom, candidate.value.activeRange.effectiveFrom);
        const detail = await dependencies.unitOfWork.getPlannerHabitDetail(habit.habitId, overlapStart);
        return { habit, detail } as const;
      }));
      const matches: LikelyHabitDuplicateMatch[] = [];
      for (const { habit, detail } of details) {
        if (!detail.ok) return failure(mapPersistenceError(detail.error));
        if (detail.value === null) return duplicateFailure('data_integrity_failure', 'A duplicate candidate disappeared during preview.');
        const scope: HabitDuplicateScope = detail.value.ordinaryParent !== null || detail.value.incomingDependencies.length > 0 ? 'child' : 'root';
        if (scope !== candidate.value.scope || detail.value.currentSchedule === null) continue;
        if (!sameSchedulePattern(candidate.value.schedule, detail.value.currentSchedule.definition)) continue;
        if (!schedulesMateriallyOverlap(
          candidate.value.schedule,
          candidate.value.activeRange,
          detail.value.currentSchedule.definition,
          habit.activeRange,
        )) continue;
        matches.push(Object.freeze({
          habitId: habit.habitId,
          title: habit.name,
          normalizedTitle: candidate.value.normalizedTitle,
          scheduleSummary: canonicalScheduleSummary(detail.value.currentSchedule.definition),
          activeRange: habit.activeRange,
          scope,
          trackingMode: detail.value.currentTracking.definition.trackingMode,
          reason: 'exact_title_and_schedule_overlap' as const,
          confidence: 'exact_title_and_schedule_overlap' as const,
        }));
      }
      matches.sort((left, right) => left.habitId.localeCompare(right.habitId));
      return success(Object.freeze({
        normalizedCandidateTitle: candidate.value.normalizedTitle,
        candidateScope: candidate.value.scope,
        archivedHabitPolicy: 'excluded' as const,
        warningOnly: true as const,
        matches: Object.freeze(matches),
      }));
    } catch (cause: unknown) {
      return duplicateFailure('database_failure', 'Likely duplicate habits could not be read.', undefined, cause);
    }
  };
}

export function normalizeDuplicateTitle(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').normalize('NFKC').toLocaleLowerCase('en-GB');
}

export function sameSchedulePattern(left: ScheduleDefinition, right: ScheduleDefinition): boolean {
  return schedulePatternKey(left) === schedulePatternKey(right);
}

export function canonicalScheduleSummary(schedule: ScheduleDefinition): string {
  switch (schedule.scheduleType) {
    case 'daily': return `daily @ ${schedule.evaluationTimezone}`;
    case 'selected_weekdays': return `weekdays:${schedule.weekdaysMask} @ ${schedule.evaluationTimezone}`;
    case 'every_n_days': return `every:${schedule.intervalDays}:from:${schedule.anchorDate} @ ${schedule.evaluationTimezone}`;
    case 'times_per_week': return `${schedule.periodTargetCount}/week:start:${schedule.weekStart} @ ${schedule.evaluationTimezone}`;
    case 'times_per_month': return `${schedule.periodTargetCount}/month @ ${schedule.evaluationTimezone}`;
    case 'times_per_year': return `${schedule.periodTargetCount}/year @ ${schedule.evaluationTimezone}`;
    case 'weekly': return `weekly:${schedule.weekday}:start:${schedule.weekStart} @ ${schedule.evaluationTimezone}`;
    case 'monthly': return `monthly:${schedule.monthDay} @ ${schedule.evaluationTimezone}`;
    case 'yearly': return `yearly:${schedule.monthNumber}-${schedule.monthDay} @ ${schedule.evaluationTimezone}`;
  }
}

function validateCandidate(candidate: LikelyHabitDuplicateCandidate): Result<Readonly<{
  normalizedTitle: string;
  activeRange: EffectiveRange;
  schedule: ScheduleDefinition;
  scope: HabitDuplicateScope;
}>, LikelyHabitDuplicateError> {
  if (typeof candidate !== 'object' || candidate === null) return duplicateFailure('invalid_input', 'A duplicate candidate is required.', 'candidate');
  const title = normalizeHabitNameInput(candidate.title);
  if (!title.ok) return duplicateFailure('invalid_input', title.error.message, 'candidate.title', title.error);
  const range = validateEffectiveRange({ effectiveFrom: candidate.activeFrom, effectiveTo: candidate.activeTo }, 'candidate.activeRange');
  if (!range.ok) return duplicateFailure('invalid_input', range.error.message, 'candidate.activeRange', range.error);
  const schedule = revalidateSchedule(candidate.schedule);
  if (!schedule.ok) return duplicateFailure('invalid_input', schedule.error.message, 'candidate.schedule', schedule.error);
  if (schedule.value.effectiveRange.effectiveFrom !== range.value.effectiveFrom || schedule.value.effectiveRange.effectiveTo !== range.value.effectiveTo) {
    return duplicateFailure('invalid_input', 'The candidate schedule must use the candidate active range.', 'candidate.schedule.effectiveRange');
  }
  if (candidate.scope !== 'root' && candidate.scope !== 'child') return duplicateFailure('invalid_input', 'Choose root or child duplicate scope.', 'candidate.scope');
  return success(Object.freeze({
    normalizedTitle: normalizeDuplicateTitle(title.value),
    activeRange: range.value,
    schedule: schedule.value,
    scope: candidate.scope,
  }));
}

function schedulePatternKey(schedule: ScheduleDefinition): string {
  const summary = canonicalScheduleSummary(schedule);
  return `${schedule.scheduleType}\u0000${summary}`;
}

function rangesOverlap(left: EffectiveRange, right: EffectiveRange): boolean {
  return (left.effectiveTo === null || right.effectiveFrom < left.effectiveTo) &&
    (right.effectiveTo === null || left.effectiveFrom < right.effectiveTo);
}

function schedulesMateriallyOverlap(
  candidate: ScheduleDefinition,
  candidateRange: EffectiveRange,
  existing: ScheduleDefinition,
  existingRange: EffectiveRange,
): boolean {
  const start = [
    candidateRange.effectiveFrom,
    candidate.effectiveRange.effectiveFrom,
    existingRange.effectiveFrom,
    existing.effectiveRange.effectiveFrom,
  ].sort().at(-1)!;
  const ends = [
    candidateRange.effectiveTo,
    candidate.effectiveRange.effectiveTo,
    existingRange.effectiveTo,
    existing.effectiveRange.effectiveTo,
  ].filter((value): value is PlannerLocalDate => value !== null).sort();
  const end = ends[0] ?? null;
  if (end !== null && start >= end) return false;
  if (candidate.scheduleType === 'daily' || candidate.scheduleType.startsWith('times_per_')) return true;
  if (candidate.scheduleType === 'every_n_days') {
    const distance = measurePlannerCalendarDays(candidate.anchorDate, start);
    const offset = distance <= 0 ? -distance : (candidate.intervalDays - distance % candidate.intervalDays) % candidate.intervalDays;
    const next = addPlannerCalendarDays(start, offset);
    return next.ok && (end === null || next.value < end);
  }
  let cursor = start;
  for (let offset = 0; offset <= 366 && (end === null || cursor < end); offset += 1) {
    const evaluation = evaluateSchedule({
      evaluatedLocalDate: cursor,
      habitActiveRange: candidateRange,
      schedule: candidate,
      evaluationTimezone: candidate.evaluationTimezone,
    });
    if (evaluation.ok && evaluation.value.kind === 'applicable_fixed_date') return true;
    const next = addPlannerCalendarDays(cursor, 1);
    if (!next.ok) return false;
    cursor = next.value;
  }
  return false;
}

function maxDate(left: PlannerLocalDate, right: PlannerLocalDate): PlannerLocalDate {
  return left >= right ? left : right;
}

function mapPersistenceError(error: PlannerPersistenceError): LikelyHabitDuplicateError {
  return duplicateError(
    error.code.endsWith('database_failure') || error.code === 'database_failure' ? 'database_failure' : 'data_integrity_failure',
    error.message,
    undefined,
    error,
  );
}

function duplicateFailure<T = never>(
  code: LikelyHabitDuplicateError['code'],
  message: string,
  field?: string,
  cause?: unknown,
): Result<T, LikelyHabitDuplicateError> {
  return failure(duplicateError(code, message, field, cause));
}

function duplicateError(
  code: LikelyHabitDuplicateError['code'],
  message: string,
  field?: string,
  cause?: unknown,
): LikelyHabitDuplicateError {
  return Object.freeze({
    name: 'LikelyHabitDuplicateError' as const,
    code,
    message,
    ...(field === undefined ? {} : { field }),
    ...(cause === undefined ? {} : { cause }),
  });
}
