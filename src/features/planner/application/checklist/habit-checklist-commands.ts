import { failure, parsePlannerLocalDate, success, type Result } from '../../domain';
import type {
  PlannerChecklistLine,
  PlannerChecklistsByHabit,
  PlannerPersistenceError,
  PlannerUnitOfWork,
} from '../../repositories';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';

/**
 * Subtasks: read a day's lines, write one, tick one, remove one.
 *
 * **Nothing here writes an observation for the line itself.** A subtask is a line
 * of text with a tick per day, and the two tables it lives in are read by nothing
 * that computes a record — that is what makes «сабтаски не идут в статистику» a
 * property of the wiring rather than a rule somebody has to remember.
 *
 * The one place a subtask does reach the canonical world is the rule the owner
 * asked for: **closing the last line closes the item**. That closure is a real
 * observation, written through the same command a tapped checkbox writes, because
 * the item is an activity and has to keep counting like one. There is no stored
 * setting behind it — the person chooses by acting: tick the item, or tick its
 * lines until none is left.
 */

export interface HabitChecklistDependencies {
  readonly unitOfWork: PlannerUnitOfWork;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface HabitChecklistError {
  readonly name: 'HabitChecklistError';
  readonly code: 'invalid_input' | 'checklist_unavailable';
  readonly message: string;
}

function checklistError(code: HabitChecklistError['code'], message: string): HabitChecklistError {
  return Object.freeze({ name: 'HabitChecklistError' as const, code, message });
}

function fromPersistence(error: PlannerPersistenceError): HabitChecklistError {
  return checklistError('checklist_unavailable', error.message);
}

/** The lines of these items, as they stood on that day. */
export type GetHabitChecklists = (command: Readonly<{
  habitIds: readonly string[];
  localDate: string;
}>) => Promise<Result<PlannerChecklistsByHabit, HabitChecklistError>>;

export function createGetHabitChecklists(dependencies: HabitChecklistDependencies): GetHabitChecklists {
  return async (command) => {
    const date = parsePlannerLocalDate(command.localDate);
    if (!date.ok) return failure(checklistError('invalid_input', 'The day is not a local date.'));
    const loaded = await dependencies.unitOfWork.loadHabitChecklists(command.habitIds, date.value);
    return loaded.ok ? success(loaded.value) : failure(fromPersistence(loaded.error));
  };
}

/** Adds lines to an item, from the day they were written and never before it. */
export type AddHabitChecklistLines = (command: Readonly<{
  habitId: string;
  texts: readonly string[];
  localDate: string;
}>) => Promise<Result<readonly PlannerChecklistLine[], HabitChecklistError>>;

export function createAddHabitChecklistLines(dependencies: HabitChecklistDependencies): AddHabitChecklistLines {
  return async (command) => {
    const date = parsePlannerLocalDate(command.localDate);
    if (!date.ok) return failure(checklistError('invalid_input', 'The day is not a local date.'));
    const texts = command.texts.map((text) => text.trim()).filter((text) => text.length > 0);
    if (texts.length === 0) return failure(checklistError('invalid_input', 'A subtask needs something written on it.'));

    const existing = await dependencies.unitOfWork.loadHabitChecklists([command.habitId], date.value);
    if (!existing.ok) return failure(fromPersistence(existing.error));
    // New lines go after the ones already there, and the order they are given in
    // is the order they keep.
    const from = (existing.value.get(command.habitId) ?? []).reduce((highest, line) => Math.max(highest, line.sortOrder + 1), 0);

    const written = await dependencies.unitOfWork.writeHabitChecklistLines({
      createdAt: dependencies.clock.nowEpochMilliseconds(),
      createdFrom: date.value,
      habitId: command.habitId,
      lines: texts.map((text, index) => Object.freeze({
        id: dependencies.idGenerator.generateId(),
        sortOrder: from + index,
        text,
      })),
    });
    return written.ok ? success(written.value) : failure(fromPersistence(written.error));
  };
}

export interface HabitChecklistTickResult {
  readonly lines: readonly PlannerChecklistLine[];
  /** True when this tick left no line open and the item was closed with it. */
  readonly closedTheItem: boolean;
  /** True when unticking a line reopened an item its lines had closed. */
  readonly reopenedTheItem: boolean;
}

/** Ticks or unticks one line for one day, and closes the item on the last one. */
export type SetHabitChecklistLineDone = (command: Readonly<{
  habitId: string;
  checklistItemId: string;
  localDate: string;
  done: boolean;
  /** How the item itself is closed and reopened, supplied by the caller. */
  closeItem: () => Promise<Result<unknown, unknown>>;
  reopenItem: () => Promise<Result<unknown, unknown>>;
  /** Whether the item is already closed, so a redundant write is never made. */
  itemIsClosed: boolean;
  /**
   * **Whether this item is closed by its lines at all.**
   *
   * The two shapes are separate and neither is a half of the other: an item closed by
   * its lines has no checkbox of its own, and an item closed by hand has lines that
   * are its own business. Closing an item from its lines *and* leaving it a checkbox
   * produced exactly the state the owner reported — the last tick closed the item, and
   * unticking the item left every line ticked, with nothing able to say which was
   * true.
   */
  closesByChecklist: boolean;
}>) => Promise<Result<HabitChecklistTickResult, HabitChecklistError>>;

export function createSetHabitChecklistLineDone(dependencies: HabitChecklistDependencies): SetHabitChecklistLineDone {
  return async (command) => {
    const date = parsePlannerLocalDate(command.localDate);
    if (!date.ok) return failure(checklistError('invalid_input', 'The day is not a local date.'));

    const ticked = await dependencies.unitOfWork.setHabitChecklistTick({
      checklistItemId: command.checklistItemId,
      done: command.done,
      doneAt: dependencies.clock.nowEpochMilliseconds(),
      occurrenceLocalDate: date.value,
    });
    if (!ticked.ok) return failure(fromPersistence(ticked.error));

    const after = await dependencies.unitOfWork.loadHabitChecklists([command.habitId], date.value);
    if (!after.ok) return failure(fromPersistence(after.error));
    const lines = after.value.get(command.habitId) ?? [];

    // **The last line closes the item, and reopening one opens it again.** The
    // item's own state stays an observation either way: it is an activity, and an
    // activity that stopped being an observation would stop being counted.
    if (!command.closesByChecklist) return success(Object.freeze({ closedTheItem: false, lines, reopenedTheItem: false }));

    const allDone = lines.length > 0 && lines.every((line) => line.done);
    if (allDone && !command.itemIsClosed) {
      const closed = await command.closeItem();
      if (!closed.ok) return failure(checklistError('checklist_unavailable', 'The subtask was recorded, but the item could not be closed.'));
      return success(Object.freeze({ closedTheItem: true, lines, reopenedTheItem: false }));
    }
    if (!allDone && command.itemIsClosed && !command.done) {
      const reopened = await command.reopenItem();
      if (!reopened.ok) return failure(checklistError('checklist_unavailable', 'The subtask was recorded, but the item could not be reopened.'));
      return success(Object.freeze({ closedTheItem: false, lines, reopenedTheItem: true }));
    }
    return success(Object.freeze({ closedTheItem: false, lines, reopenedTheItem: false }));
  };
}

/** How the items asked for close, by id. Absent means the default: by hand. */
export type GetHabitClosureRules = (query: Readonly<{
  habitIds: readonly string[];
}>) => Promise<Result<ReadonlyMap<string, boolean>, HabitChecklistError>>;

export function createGetHabitClosureRules(dependencies: HabitChecklistDependencies): GetHabitClosureRules {
  return async (query) => {
    const loaded = await dependencies.unitOfWork.loadHabitClosureRules(query.habitIds);
    return loaded.ok ? success(loaded.value) : failure(fromPersistence(loaded.error));
  };
}

/**
 * Chooses how one item closes.
 *
 * **Not effective-dated, deliberately.** A schedule decides what a past day *meant*;
 * this decides what happens when a finger lands on a checkbox, and a day already
 * recorded is not reinterpreted by it either way (PD-SUBTASK-004).
 */
export type SetHabitClosureRule = (command: Readonly<{
  habitId: string;
  closesByChecklist: boolean;
}>) => Promise<Result<boolean, HabitChecklistError>>;

export function createSetHabitClosureRule(dependencies: HabitChecklistDependencies): SetHabitClosureRule {
  return async (command) => {
    const written = await dependencies.unitOfWork.setHabitClosureRule({
      closesByChecklist: command.closesByChecklist,
      habitId: command.habitId,
      updatedAt: dependencies.clock.nowEpochMilliseconds(),
    });
    return written.ok ? success(written.value) : failure(fromPersistence(written.error));
  };
}

/** Removes a line from a day onwards, leaving every earlier day as it was. */
export type RemoveHabitChecklistLine = (command: Readonly<{
  checklistItemId: string;
  localDate: string;
}>) => Promise<Result<string, HabitChecklistError>>;

export function createRemoveHabitChecklistLine(dependencies: HabitChecklistDependencies): RemoveHabitChecklistLine {
  return async (command) => {
    const date = parsePlannerLocalDate(command.localDate);
    if (!date.ok) return failure(checklistError('invalid_input', 'The day is not a local date.'));
    const removed = await dependencies.unitOfWork.removeHabitChecklistLine({
      checklistItemId: command.checklistItemId,
      deletedFrom: date.value,
    });
    return removed.ok ? success(removed.value) : failure(fromPersistence(removed.error));
  };
}
