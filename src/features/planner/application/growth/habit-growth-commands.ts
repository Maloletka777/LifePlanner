import { failure, parsePlannerLocalDate, success, type Result } from '../../domain';
import {
  PLANNER_MAX_GROWING_ROUTINES,
  parsePlannerGrowthCue,
  parsePlannerGrowthEnjoyment,
  type PlannerGrowthEnjoyment,
} from '../../domain/values/day-block';
import type {
  PlannerGrowthAttemptRow,
  PlannerPersistenceError,
  PlannerUnitOfWork,
} from '../../repositories';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';

/**
 * Taking a routine on, putting it down, and saying what it hangs off.
 *
 * **This is the whole write surface of the second floor**, and none of it writes an
 * observation. Marking a routine as one you are growing is not a fact about a day, so it
 * can never reach a completion figure — the separation is in the wiring, not in a rule.
 *
 * **The cap of three lives here rather than in the schema.** Three is a product judgement
 * that may move, and a number somebody argued about does not belong in a constraint that
 * would need a migration to change. It is also, honestly, the thinnest-evidenced rule in
 * the design: starting many routines at once is widely said to fail, and the controlled
 * studies of sequential against simultaneous change report inconsistent results. A value
 * is the right shape for something that may have to move.
 */

export interface HabitGrowthDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface HabitGrowthError {
  readonly name: 'HabitGrowthError';
  readonly code: 'invalid_input' | 'too_many_routines' | 'already_growing' | 'growth_unavailable';
  readonly message: string;
}

function growthError(code: HabitGrowthError['code'], message: string): HabitGrowthError {
  return Object.freeze({ name: 'HabitGrowthError' as const, code, message });
}

function fromPersistence(error: PlannerPersistenceError): HabitGrowthError {
  return growthError('growth_unavailable', error.message);
}

/** Validated answers to the two questions, or their deliberate absence. */
function readDetails(
  command: Readonly<{ cue?: string | null; enjoyment?: string | null }>,
): Result<Readonly<{ cue: string | null; enjoyment: PlannerGrowthEnjoyment | null }>, HabitGrowthError> {
  let cue: string | null = null;
  if (command.cue !== undefined && command.cue !== null) {
    const parsed = parsePlannerGrowthCue(command.cue);
    if (!parsed.ok) return failure(growthError('invalid_input', parsed.error.message));
    cue = parsed.value;
  }
  let enjoyment: PlannerGrowthEnjoyment | null = null;
  if (command.enjoyment !== undefined && command.enjoyment !== null) {
    const parsed = parsePlannerGrowthEnjoyment(command.enjoyment);
    if (!parsed.ok) return failure(growthError('invalid_input', parsed.error.message));
    enjoyment = parsed.value;
  }
  return success(Object.freeze({ cue, enjoyment }));
}

/**
 * Every routine currently being grown.
 *
 * Read separately from the day rather than folded into it: the first floor asks for a
 * day and gets the day, and nothing about growth is in that answer.
 */
export type GetGrowingRoutines = () => Promise<Result<readonly PlannerGrowthAttemptRow[], HabitGrowthError>>;

export function createGetGrowingRoutines(dependencies: HabitGrowthDependencies): GetGrowingRoutines {
  return async () => {
    const open = await dependencies.unitOfWork.loadOpenHabitGrowth();
    return open.ok ? success(open.value) : failure(fromPersistence(open.error));
  };
}

/** Every attempt these routines have had, oldest first — the history, not just the open one. */
export type GetRoutineGrowthHistory = (command: Readonly<{
  habitIds: readonly string[];
}>) => Promise<Result<ReadonlyMap<string, readonly PlannerGrowthAttemptRow[]>, HabitGrowthError>>;

export function createGetRoutineGrowthHistory(dependencies: HabitGrowthDependencies): GetRoutineGrowthHistory {
  return async (command) => {
    const loaded = await dependencies.unitOfWork.loadHabitGrowth(command.habitIds);
    return loaded.ok ? success(loaded.value) : failure(fromPersistence(loaded.error));
  };
}

/**
 * Taking a routine on, from a given day.
 *
 * Everything on this floor counts from `trackedFrom` rather than from the habit's whole
 * history, so a routine that has quietly run for months and is only now being *built*
 * starts at zero. The marking is the person saying «I am taking this on now».
 */
export type StartGrowingRoutine = (command: Readonly<{
  habitId: string;
  trackedFrom: string;
  cue?: string | null;
  enjoyment?: string | null;
}>) => Promise<Result<PlannerGrowthAttemptRow, HabitGrowthError>>;

export function createStartGrowingRoutine(dependencies: HabitGrowthDependencies): StartGrowingRoutine {
  return async (command) => {
    const trackedFrom = parsePlannerLocalDate(command.trackedFrom, 'trackedFrom');
    if (!trackedFrom.ok) return failure(growthError('invalid_input', 'The day a routine is taken on is not a local date.'));

    const details = readDetails(command);
    if (!details.ok) return failure(details.error);

    const open = await dependencies.unitOfWork.loadOpenHabitGrowth();
    if (!open.ok) return failure(fromPersistence(open.error));

    if (open.value.some((attempt) => attempt.habitId === command.habitId)) {
      return failure(growthError('already_growing', 'This routine is already one of the ones being grown.'));
    }
    // The cap is counted here, over what is actually open, rather than trusted from a
    // caller that may be looking at a stale screen.
    if (open.value.length >= PLANNER_MAX_GROWING_ROUTINES) {
      return failure(growthError(
        'too_many_routines',
        `You are already growing ${PLANNER_MAX_GROWING_ROUTINES} routines. Put one down to take another on.`,
      ));
    }

    const started = await dependencies.unitOfWork.startHabitGrowth({
      createdAt: dependencies.clock.nowEpochMilliseconds(),
      cue: details.value.cue,
      enjoyment: details.value.enjoyment,
      habitId: command.habitId,
      id: dependencies.idGenerator.generateId(),
      trackedFrom: trackedFrom.value,
    });
    return started.ok ? success(started.value) : failure(fromPersistence(started.error));
  };
}

/**
 * Putting a routine down, from a given day.
 *
 * The attempt is closed rather than deleted, so the days it covered stay covered and the
 * next attempt is visibly a second one. `false` means there was nothing open to close,
 * which is not an error — a command that threw there would make every caller check first.
 */
export type StopGrowingRoutine = (command: Readonly<{
  habitId: string;
  stoppedFrom: string;
}>) => Promise<Result<boolean, HabitGrowthError>>;

export function createStopGrowingRoutine(dependencies: HabitGrowthDependencies): StopGrowingRoutine {
  return async (command) => {
    const stoppedFrom = parsePlannerLocalDate(command.stoppedFrom, 'stoppedFrom');
    if (!stoppedFrom.ok) return failure(growthError('invalid_input', 'The day a routine is put down is not a local date.'));

    const stopped = await dependencies.unitOfWork.stopHabitGrowth({
      habitId: command.habitId,
      stoppedFrom: stoppedFrom.value,
      updatedAt: dependencies.clock.nowEpochMilliseconds(),
    });
    return stopped.ok ? success(stopped.value) : failure(fromPersistence(stopped.error));
  };
}

/**
 * The two questions, answered or changed.
 *
 * Both fields are stated in full rather than merged, so clearing one is expressible: an
 * absent key would make «leave it alone» and «clear it» the same request.
 */
export type SetRoutineGrowthDetails = (command: Readonly<{
  habitId: string;
  cue: string | null;
  enjoyment: string | null;
}>) => Promise<Result<boolean, HabitGrowthError>>;

export function createSetRoutineGrowthDetails(dependencies: HabitGrowthDependencies): SetRoutineGrowthDetails {
  return async (command) => {
    const details = readDetails(command);
    if (!details.ok) return failure(details.error);

    const written = await dependencies.unitOfWork.setHabitGrowthDetails({
      cue: details.value.cue,
      enjoyment: details.value.enjoyment,
      habitId: command.habitId,
      updatedAt: dependencies.clock.nowEpochMilliseconds(),
    });
    return written.ok ? success(written.value) : failure(fromPersistence(written.error));
  };
}
