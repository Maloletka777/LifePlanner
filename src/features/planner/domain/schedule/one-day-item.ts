import { addPlannerCalendarDays, type PlannerLocalDate } from '../values/local-date';

/**
 * What makes an item a **task** rather than a habit — in one place.
 *
 * The schema has no kind of its own: a task is a `daily` schedule whose active
 * range is a single day, which is exactly what Create writes for `Task`
 * (PD-CREATE-017), and `effectiveTo` is exclusive, so one day is the day plus one.
 *
 * **It lived in three places, and one of them was a fourth copy inline.** Manage
 * asked it of a catalogue row, Overview of a habit and its schedule versions, and
 * Create of the drafts on the screen — three inputs, one rule, and three chances
 * for the surfaces to disagree about what a thing is. They carry different inputs
 * and that is fine; what they may not carry is different *rules*, so each adapts
 * its own input to the two facts the rule is actually about and asks here.
 *
 * It is in the domain because every layer above may read it and none of them owns
 * it. A stored kind would end all of this, and would be a migration.
 */
export function isOneDayScheduledItem(input: Readonly<{
  scheduleType: string | null | undefined;
  effectiveFrom: PlannerLocalDate;
  effectiveTo: PlannerLocalDate | null;
}>): boolean {
  return input.scheduleType === 'daily' && isOneDayRange(input.effectiveFrom, input.effectiveTo);
}

/**
 * The range half of the rule, on its own.
 *
 * The create sheet asks the two halves separately — it knows its own schedule
 * type and holds its dates as half-typed strings — so it needs the arithmetic
 * without the schedule check. It is the same arithmetic either way, which is the
 * point: `effectiveTo` is exclusive, so a single day is the day plus one.
 */
export function isOneDayRange(effectiveFrom: PlannerLocalDate, effectiveTo: PlannerLocalDate | null): boolean {
  if (effectiveTo === null) return false;
  const nextDay = addPlannerCalendarDays(effectiveFrom, 1);
  return nextDay.ok && effectiveTo === nextDay.value;
}
