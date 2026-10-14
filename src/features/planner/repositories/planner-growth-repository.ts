import type { PlannerGrowthEnjoyment } from '../domain/values/day-block';

/**
 * The second floor's own persistence contract.
 *
 * **A row is an attempt, not a routine**, so a person who takes a habit on, stops and
 * takes it up again months later has two records and the later one starts from zero.
 * Nothing in this file touches an observation or a tick: marking a routine as one you
 * are growing is not a fact about a day, and that is what keeps the second floor out of
 * every completion figure by construction rather than by rule.
 */
export interface PlannerGrowthAttemptRow {
  readonly id: string;
  readonly habitId: string;
  readonly attemptNumber: number;
  readonly trackedFrom: string;
  readonly stoppedFrom: string | null;
  readonly cue: string | null;
  readonly enjoyment: PlannerGrowthEnjoyment | null;
}

/** Taking a routine on. The caller supplies the id, as every other write here does. */
export interface PlannerGrowthStartInput {
  readonly id: string;
  readonly habitId: string;
  readonly trackedFrom: string;
  readonly cue: string | null;
  readonly enjoyment: PlannerGrowthEnjoyment | null;
  readonly createdAt: number;
}

/**
 * Putting one down.
 *
 * `stoppedFrom` is a date rather than a flag: the days inside the attempt stay inside
 * it, exactly as a removed checklist line stays on the days before its removal.
 */
export interface PlannerGrowthStopInput {
  readonly habitId: string;
  readonly stoppedFrom: string;
  readonly updatedAt: number;
}

/**
 * Answering the two questions, or changing an answer.
 *
 * Both are `null`-able on purpose — clearing a cue is a thing a person may do — so the
 * fields are stated rather than merged: an absent key would make «leave it alone» and
 * «clear it» indistinguishable.
 */
export interface PlannerGrowthDetailsInput {
  readonly habitId: string;
  readonly cue: string | null;
  readonly enjoyment: PlannerGrowthEnjoyment | null;
  readonly updatedAt: number;
}
