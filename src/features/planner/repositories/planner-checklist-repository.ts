import type { PlannerLocalDate } from '../domain';

/**
 * Subtasks, as a **line of text with a tick per day**.
 *
 * A subtask is not a habit. It has no schedule, no time, no reminder, no priority
 * and — deliberately — no observation, which is what makes it unable to reach a
 * statistic: there is nothing in these two tables for Overview, history or a
 * streak to aggregate, and neither of them is ever read by anything that counts.
 *
 * It is loaded by its **own** query rather than folded into the day's occurrence
 * read model, and that is a decision rather than a convenience: the layer that
 * computes records cannot count what it cannot see.
 *
 * A line lives `[createdFrom, deletedFrom)` and a tick belongs to one day, so a
 * past day keeps its own answer — «делал ли я вчера разминку» is a question the
 * data can answer, which the single `done_at` of schema v8 could not.
 */
export interface PlannerChecklistLine {
  readonly id: string;
  readonly habitId: string;
  readonly text: string;
  readonly sortOrder: number;
  /** Ticked **for the day that was asked for**, and for no other. */
  readonly done: boolean;
  /** When that tick was made, or null when the line is not ticked for the day. */
  readonly doneAt: number | null;
}

export interface PlannerChecklistLineDraft {
  readonly id: string;
  readonly text: string;
  readonly sortOrder: number;
}

export interface PlannerChecklistWriteInput {
  readonly habitId: string;
  readonly lines: readonly PlannerChecklistLineDraft[];
  /** The first day the lines exist on, so earlier days are not rewritten. */
  readonly createdFrom: PlannerLocalDate;
  readonly createdAt: number;
}

export interface PlannerChecklistTickInput {
  readonly checklistItemId: string;
  readonly occurrenceLocalDate: PlannerLocalDate;
  readonly done: boolean;
  readonly doneAt: number;
}

export interface PlannerChecklistRemovalInput {
  readonly checklistItemId: string;
  /** The first day the line no longer exists on. Every earlier day keeps it. */
  readonly deletedFrom: PlannerLocalDate;
}

/** The lines of each habit asked for, as they stand on one day, in their order. */
export type PlannerChecklistsByHabit = ReadonlyMap<string, readonly PlannerChecklistLine[]>;
