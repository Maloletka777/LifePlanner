import {
  addPlannerCalendarDays,
  failure,
  isOneDayScheduledItem,
  parsePlannerLocalDate,
  success,
  type PlannerLocalDate,
  type Result,
} from '../../domain';
import type { PlannerUnitOfWork } from '../../repositories';
import {
  buildSelectedDatePlannerReadModel,
  type PlannerOccurrenceQueryError,
  type SelectedDatePlannerOccurrenceRow,
  type SelectedDatePlannerRootGroup,
} from '../occurrence/get-planner-occurrences-for-date';

/**
 * What Overview knows about the person, and nothing else.
 *
 * `design_handoff_overview_records` asks five questions of history — how today is
 * going, whether the chain holds, what the week looks like, when the person
 * actually delivers, and what keeps slipping. None of it existed as a read model,
 * and all of it turns out to be **aggregation over a range of days the repository
 * can already load**: `loadPlannerOccurrenceDataRange` is the same loader the date
 * markers use. No table, column, migration, command or repository method changes
 * here — this file only reads.
 *
 * Three rules from the brief are enforced in this layer rather than in a screen,
 * because they decide what the numbers *mean*:
 *
 * 1. **Activities only.** A task — a daily schedule whose active range is one day
 *    (PD-CREATE-017) — never enters a statistic. The brief is explicit that habits
 *    and tasks are different formats of planning.
 * 2. **Punctuality is narrow.** On time means closed before its planned minute on
 *    its planned day. An activity with no planned time carries no plan and is
 *    excluded from every punctuality figure.
 * 3. **Back-filled marks are done, not on time.** If yesterday's checkbox is
 *    ticked this morning, the naive reading is a lie: the observation's own
 *    `observedAt` falls on another local day. Those are counted as closed and left
 *    out of the punctuality measure, which is the option the brief's mock assumes.
 */

/** The four fixed windows. They are not learned from the data, by decision. */
export const OVERVIEW_HOUR_WINDOWS = Object.freeze([
  Object.freeze({ key: 'morning' as const, label: '06:00–10:00', startHour: 6, endHour: 10 }),
  Object.freeze({ key: 'day' as const, label: '10:00–17:00', startHour: 10, endHour: 17 }),
  Object.freeze({ key: 'evening' as const, label: '17:00–22:00', startHour: 17, endHour: 22 }),
  Object.freeze({ key: 'night' as const, label: '22:00–06:00', startHour: 22, endHour: 6 }),
]);

export type OverviewHourWindowKey = (typeof OVERVIEW_HOUR_WINDOWS)[number]['key'];

export interface GetPlannerOverviewAnalyticsQuery {
  readonly startDate: PlannerLocalDate;
  /** Inclusive. */
  readonly endDate: PlannerLocalDate;
  readonly evaluationBoundary: PlannerLocalDate;
  /**
   * The local day each observation's machine timestamp fell on, supplied by the
   * caller so this layer never reads a clock or a timezone of its own.
   */
  readonly localDayOfTimestamp: (timestamp: number) => PlannerLocalDate;
  /** Minutes past midnight of that same timestamp, in the same local reckoning. */
  readonly localMinuteOfTimestamp: (timestamp: number) => number;
}

export interface PlannerOverviewDayFact {
  readonly localDate: PlannerLocalDate;
  /** Root activities scheduled that day. Tasks are already gone. */
  readonly scheduled: number;
  readonly closed: number;
  readonly timedScheduled: number;
  readonly timedClosed: number;
  /** Every activity carrying a planned time was closed — the streak's own rule. */
  readonly fullyClosed: boolean;
  readonly onTime: number;
  readonly late: number;
  /** On time plus late: what the percentage is a share of. */
  readonly punctualityMeasured: number;
  /** Closed, but recorded on another day, so it says nothing about punctuality. */
  /**
   * Closed, but written down on a **later** day.
   *
   * It draws closed on its own day and counts toward nothing that is a record: a
   * day cannot be met once it is over. Marking a day early or later the same day
   * is ordinary and is not counted here.
   */
  readonly backFilled: number;
  /** The activities that were scheduled with a time and never closed. */
  readonly missedNames: readonly string[];
}

export interface PlannerOverviewActivityFact {
  readonly habitId: string;
  readonly name: string;
  readonly scheduledDays: number;
  readonly closedDays: number;
  readonly missedDays: number;
}

export interface PlannerOverviewWindowFact {
  readonly key: OverviewHourWindowKey;
  readonly label: string;
  readonly planned: number;
  readonly closed: number;
}

export interface PlannerOverviewHourFact {
  readonly hour: number;
  readonly planned: number;
  readonly closed: number;
}

export interface PlannerOverviewStreak {
  /** Consecutive fully closed days ending at the last complete day in the range. */
  readonly current: number;
  readonly longest: number;
  /** Most recent first: the days that ended a run, and what was left open. */
  readonly breaks: readonly Readonly<{ localDate: PlannerLocalDate; activityNames: readonly string[] }>[];
}

export interface PlannerOverviewAnalytics {
  readonly startDate: PlannerLocalDate;
  readonly endDate: PlannerLocalDate;
  readonly days: readonly PlannerOverviewDayFact[];
  readonly activities: readonly PlannerOverviewActivityFact[];
  readonly windows: readonly PlannerOverviewWindowFact[];
  readonly hours: readonly PlannerOverviewHourFact[];
  readonly streak: PlannerOverviewStreak;
  /** True when no day in the range carried a single scheduled activity. */
  readonly empty: boolean;
}

export type GetPlannerOverviewAnalytics = (
  query: GetPlannerOverviewAnalyticsQuery,
) => Promise<Result<PlannerOverviewAnalytics, PlannerOccurrenceQueryError>>;

export function createGetPlannerOverviewAnalytics(
  dependencies: Readonly<{ unitOfWork: PlannerUnitOfWork }>,
): GetPlannerOverviewAnalytics {
  return async (query) => {
    const start = parsePlannerLocalDate(query?.startDate, 'startDate');
    const end = parsePlannerLocalDate(query?.endDate, 'endDate');
    const boundary = parsePlannerLocalDate(query?.evaluationBoundary, 'evaluationBoundary');
    if (!start.ok || !end.ok || !boundary.ok || start.value > end.value) {
      return failure(queryError(
        'occurrence_read_model_data_integrity_failure',
        'The Overview range is invalid.',
      ));
    }

    // The repository refuses a range longer than a month — one request builds a
    // read model per day, and that bound is deliberate. Overview needs four months,
    // so it asks in month-sized pieces rather than raising someone else's guard.
    const loaded = await loadInChunks(dependencies.unitOfWork, start.value, end.value);
    if (!loaded.ok) return failure(loaded.error);

    const days: PlannerOverviewDayFact[] = [];
    const activities = new Map<string, { name: string; scheduledDays: number; closedDays: number }>();
    const windows = new Map<OverviewHourWindowKey, { planned: number; closed: number }>(
      OVERVIEW_HOUR_WINDOWS.map((window) => [window.key, { planned: 0, closed: 0 }]),
    );
    const hours = new Map<number, { planned: number; closed: number }>();

    for (const dataSet of [...loaded.value].sort(byLocalDate)) {
      const model = buildSelectedDatePlannerReadModel(dataSet, boundary.value);
      if (!model.ok) return model;
      const taskHabitIds = oneDayHabitIds(dataSet);
      const localDate = dataSet.selectedLocalDate;
      const past = localDate < boundary.value;

      let scheduled = 0;
      let closed = 0;
      let timedScheduled = 0;
      let timedClosed = 0;
      let onTime = 0;
      let late = 0;
      let backFilled = 0;
      const missedNames: string[] = [];

      for (const group of model.value.rootGroups) {
        // `rootRow` already answers `null` for a subtask — it is not an activity
        // of its own — so the only exclusion left to make here is the task, which
        // is a different format of planning rather than a line inside something.
        const row = rootRow(group);
        if (row === null || taskHabitIds.has(row.habitId)) continue;
        const done = isCanonicallyDone(group, row);
        const recordedAt = closureTimestamp(row);
        const recordedDay = recordedAt === null ? null : query.localDayOfTimestamp(recordedAt);
        /**
         * **A day cannot be met after it is over.**
         *
         * Ticking it early is doing it early and ticking it late in the evening is
         * still doing it that day — both count. Ticking *yesterday* tomorrow is
         * remembering, not doing, and the record says so and keeps saying so: the
         * day itself still draws the item closed, because that is what happened to
         * the item, but nothing about a record ever counts it.
         *
         * Without a recorded moment there is nothing to prove lateness with, and a
         * fact is not assumed against the person: it counts.
         */
        const recordedLate = done && recordedDay !== null && recordedDay > localDate;
        const counts = done && !recordedLate;
        scheduled += 1;
        if (counts) closed += 1;
        if (recordedLate) backFilled += 1;

        // **Only a day that is over is evidence.** What has not come due yet is not
        // a miss, and today's still-open items were being counted as one — a habit
        // planned for this evening turned up under "Slipping" at three in the
        // morning. Today therefore contributes to the day's own figures, which are
        // about now, and to nothing that is about a record.
        if (past) {
          const entry = activities.get(row.habitId) ?? { name: row.name, scheduledDays: 0, closedDays: 0 };
          entry.scheduledDays += 1;
          if (counts) entry.closedDays += 1;
          activities.set(row.habitId, entry);
        }

        const plannedMinute = minuteOfLocalTime(row.plannedLocalTime);
        if (plannedMinute === null) continue;
        timedScheduled += 1;
        const hour = Math.floor(plannedMinute / 60);
        const window = windowKeyForHour(hour);
        const windowFact = past ? windows.get(window) : undefined;
        if (windowFact !== undefined) windowFact.planned += 1;
        const hourFact = hours.get(hour) ?? { planned: 0, closed: 0 };
        if (past) {
          hourFact.planned += 1;
          hours.set(hour, hourFact);
        }
        if (!counts) {
          if (past) missedNames.push(row.name);
          continue;
        }
        timedClosed += 1;
        if (windowFact !== undefined) windowFact.closed += 1;
        if (past) hourFact.closed += 1;

        if (recordedAt === null) continue;
        // **Closed before the day it was planned for is early, and early is on
        // time.** The days between are a distance, not a failure — a person who
        // does tomorrow's work tonight has not missed anything.
        if (recordedDay !== null && recordedDay < localDate) { onTime += 1; continue; }
        if (recordedDay !== localDate) continue;
        if (query.localMinuteOfTimestamp(recordedAt) <= plannedMinute) onTime += 1; else late += 1;
      }

      days.push(Object.freeze({
        localDate,
        scheduled,
        closed,
        timedScheduled,
        timedClosed,
        // A day with nothing timed cannot break a run and cannot make one either;
        // it is only "fully closed" when it actually closed something.
        fullyClosed: timedScheduled > 0 && timedClosed === timedScheduled,
        onTime,
        late,
        punctualityMeasured: onTime + late,
        backFilled,
        missedNames: Object.freeze(missedNames),
      }));
    }

    return success(Object.freeze({
      startDate: start.value,
      endDate: end.value,
      days: Object.freeze(days),
      activities: Object.freeze([...activities.entries()]
        .map(([habitId, entry]) => Object.freeze({
          habitId,
          name: entry.name,
          scheduledDays: entry.scheduledDays,
          closedDays: entry.closedDays,
          missedDays: Math.max(0, entry.scheduledDays - entry.closedDays),
        }))
        .sort((left, right) => right.missedDays - left.missedDays || left.name.localeCompare(right.name))),
      windows: Object.freeze(OVERVIEW_HOUR_WINDOWS.map((window) => Object.freeze({
        key: window.key,
        label: window.label,
        planned: windows.get(window.key)?.planned ?? 0,
        closed: windows.get(window.key)?.closed ?? 0,
      }))),
      hours: Object.freeze([...hours.entries()]
        .map(([hour, fact]) => Object.freeze({ hour, planned: fact.planned, closed: fact.closed }))
        .sort((left, right) => left.hour - right.hour)),
      streak: streakOf(days, boundary.value),
      empty: days.every((day) => day.scheduled === 0),
    }));
  };
}

/** The repository's own bound on one range request. */
const RANGE_CHUNK_DAYS = 31;

async function loadInChunks(
  unitOfWork: PlannerUnitOfWork,
  startDate: PlannerLocalDate,
  endDate: PlannerLocalDate,
): Promise<Result<readonly PlannerOccurrenceDataSetLike[], PlannerOccurrenceQueryError>> {
  const dataSets: PlannerOccurrenceDataSetLike[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const lastOfChunk = addPlannerCalendarDays(cursor, RANGE_CHUNK_DAYS - 1);
    if (!lastOfChunk.ok) {
      return failure(queryError('occurrence_read_model_data_integrity_failure', 'The Overview range is invalid.'));
    }
    const chunkEnd = lastOfChunk.value > endDate ? endDate : lastOfChunk.value;
    let loaded;
    try {
      loaded = await unitOfWork.loadPlannerOccurrenceDataRange(cursor, chunkEnd);
    } catch (cause: unknown) {
      return failure(queryError('occurrence_read_model_database_failure', 'The Overview range could not be read.', cause));
    }
    if (!loaded.ok) {
      return failure(queryError(
        loaded.error.code === 'occurrence_read_model_database_failure'
          ? 'occurrence_read_model_database_failure'
          : 'occurrence_read_model_data_integrity_failure',
        loaded.error.message,
        loaded.error,
      ));
    }
    dataSets.push(...loaded.value);
    const next = addPlannerCalendarDays(chunkEnd, 1);
    if (!next.ok) break;
    cursor = next.value;
  }
  return success(Object.freeze(dataSets));
}

type PlannerOccurrenceDataSetLike = Awaited<
  ReturnType<PlannerUnitOfWork['loadPlannerOccurrenceDataRange']>
> extends Result<infer T, unknown> ? (T extends readonly (infer Item)[] ? Item : never) : never;

/**
 * The run ends at the last day that is over: today is still open, so it can
 * neither extend the chain nor break it.
 */
function streakOf(days: readonly PlannerOverviewDayFact[], boundary: PlannerLocalDate): PlannerOverviewStreak {
  const complete = days.filter((day) => day.localDate < boundary);
  let current = 0;
  for (let index = complete.length - 1; index >= 0; index -= 1) {
    const day = complete[index];
    if (day.fullyClosed) { current += 1; continue; }
    // A day with nothing timed is neutral: it passes the run through untouched.
    if (day.timedScheduled === 0) continue;
    break;
  }
  let longest = 0;
  let run = 0;
  for (const day of complete) {
    if (day.fullyClosed) { run += 1; longest = Math.max(longest, run); continue; }
    if (day.timedScheduled === 0) continue;
    run = 0;
  }
  const breaks = complete
    .filter((day) => day.timedScheduled > 0 && !day.fullyClosed)
    .slice(-3)
    .reverse()
    .map((day) => Object.freeze({ localDate: day.localDate, activityNames: day.missedNames }));
  return Object.freeze({ current, longest: Math.max(longest, current), breaks: Object.freeze(breaks) });
}

/**
 * A task is a daily schedule whose active range is a single day — the shape
 * Create writes for `Task` (PD-CREATE-017), and the only way to tell one apart
 * without a kind of its own in the schema.
 */
function oneDayHabitIds(dataSet: Readonly<{
  habits: readonly Readonly<{ id: string; activeRange: Readonly<{ effectiveFrom: PlannerLocalDate; effectiveTo: PlannerLocalDate | null }> }>[];
  scheduleVersions: readonly Readonly<{ habitId: string; definition: Readonly<{ scheduleType: string }> }>[];
}>): ReadonlySet<string> {
  const scheduleTypes = new Map(dataSet.scheduleVersions.map((version) => [version.habitId, version.definition.scheduleType] as const));
  const tasks = new Set<string>();
  for (const habit of dataSet.habits) {
    // The one rule, asked of the domain rather than restated here — this was one
    // of three copies, and three copies are three chances for two screens to
    // disagree about what a thing is.
    if (isOneDayScheduledItem({
      effectiveFrom: habit.activeRange.effectiveFrom,
      effectiveTo: habit.activeRange.effectiveTo,
      scheduleType: scheduleTypes.get(habit.id),
    })) tasks.add(habit.id);
  }
  return tasks;
}

function rootRow(group: SelectedDatePlannerRootGroup): SelectedDatePlannerOccurrenceRow | null {
  const row = group.rows.find((candidate) => candidate.habitId === group.rootHabitId) ?? group.rows[0] ?? null;
  // A step of a routine is not an activity of its own on this screen.
  return row === null || row.ordinaryParentHabitId !== null ? null : row;
}

function isCanonicallyDone(group: SelectedDatePlannerRootGroup, row: SelectedDatePlannerOccurrenceRow): boolean {
  const container = group.routineContainer;
  return container.completionSource === 'ordinary_children_derived' && container.isRoutineContainer
    ? container.isCanonicallyComplete
    : row.state === 'qualified';
}

/**
 * When the closing mark was written. A derived routine container holds no
 * observation of its own, so it closes when its last step was written — the
 * latest of its children's marks.
 */
function closureTimestamp(row: SelectedDatePlannerOccurrenceRow): number | null {
  const timestamps = row.currentObservation.currentEntries.map((entry) => entry.observedAt);
  return timestamps.length === 0 ? null : Math.max(...timestamps);
}

function minuteOfLocalTime(localTime: string | null): number | null {
  if (localTime === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) return null;
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3, 5));
}

export function windowKeyForHour(hour: number): OverviewHourWindowKey {
  const bounded = ((Math.trunc(hour) % 24) + 24) % 24;
  if (bounded >= 6 && bounded < 10) return 'morning';
  if (bounded >= 10 && bounded < 17) return 'day';
  if (bounded >= 17 && bounded < 22) return 'evening';
  return 'night';
}

function byLocalDate(
  left: Readonly<{ selectedLocalDate: PlannerLocalDate }>,
  right: Readonly<{ selectedLocalDate: PlannerLocalDate }>,
): number {
  return left.selectedLocalDate < right.selectedLocalDate ? -1 : left.selectedLocalDate > right.selectedLocalDate ? 1 : 0;
}

function queryError(
  code: PlannerOccurrenceQueryError['code'],
  message: string,
  cause?: unknown,
): PlannerOccurrenceQueryError {
  return Object.freeze({
    name: 'PlannerOccurrenceQueryError',
    code,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}
