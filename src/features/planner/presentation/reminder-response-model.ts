import type { DayJournalItem } from './day-journal-model';

/**
 * What a reminder's «Done» is allowed to close, decided away from React and the OS.
 *
 * A notification button reaches the same command a checkbox does, so it has to obey the
 * same three rules — and the one that is easy to miss is the third. An item that closes
 * **by its lines** carries no checkbox of its own on the journal (PD-SUBTASK-010), and a
 * button that closed it from a banner would quietly undo the choice the person made about
 * how that item finishes. Absence of a rule is the default, and the default is by hand.
 *
 * The other two are the journal's own: a derived routine container has no action of its
 * own to take (ADR-007, `completable`), and something already closed is left alone rather
 * than written twice — an observation is append-only, so a second one is a second fact.
 */
export function reminderCloseTarget(input: Readonly<{
  closesByChecklist: ReadonlyMap<string, boolean>;
  habitId: string;
  items: readonly DayJournalItem[];
}>): DayJournalItem | null {
  const item = input.items.find((candidate) => candidate.habitId === input.habitId);
  if (item === undefined) return null;
  if (!item.completable || item.done) return null;
  return input.closesByChecklist.get(input.habitId) === true ? null : item;
}
