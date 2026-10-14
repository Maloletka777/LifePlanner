import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';

import {
  addReminderResponseListener,
  configureReminderNotificationActions,
  lastReminderResponse,
  type ReminderResponseIntent,
  addHabitDependencyWithProductionPersistence,
  correctHabitObservationWithProductionPersistence,
  createHabitWithProductionPersistence,
  getPlannerOccurrencesForDateWithProductionPersistence,
  getPlannerScheduleSummaryForDateWithProductionPersistence,
  getPlannerDateSummariesForRangeWithProductionPersistence,
  getPlannerOverviewAnalyticsWithProductionPersistence,
  getPlannerHabitDetailWithProductionPersistence,
  listPlannerHabitsWithProductionPersistence,
  addHabitChecklistLinesWithProductionPersistence,
  reconcileRemindersWithProductionPersistence,
  reportPlannerFailure,
  runPlannerMaintenanceWithProductionPersistence,
  getHabitChecklistsWithProductionPersistence,
  getGrowingRoutinesWithProductionPersistence,
  getHabitClosureRulesWithProductionPersistence,
  getRoutineGrowthHistoryWithProductionPersistence,
  setRoutineGrowthDetailsWithProductionPersistence,
  startGrowingRoutineWithProductionPersistence,
  stopGrowingRoutineWithProductionPersistence,
  setHabitClosureRuleWithProductionPersistence,
  recordHabitObservationWithProductionPersistence,
  removeHabitChecklistLineWithProductionPersistence,
  setHabitChecklistLineDoneWithProductionPersistence,
  archiveHabitWithProductionPersistence,
  restoreHabitWithProductionPersistence,
  permanentlyDeleteHabitWithProductionPersistence,
  previewDeleteHabitChainWithProductionPersistence,
  deleteHabitChainWithProductionPersistence,
  editHabitWithProductionPersistence,
  changeOrdinaryParentWithProductionPersistence,
  createHabitBundleWithProductionPersistence,
  type AddHabitDependency,
  type CorrectHabitObservation,
  type CreateHabit,
  type GetPlannerOccurrencesForDate,
  type GetPlannerScheduleSummaryForDate,
  type GetPlannerDateSummariesForRange,
  type GetPlannerOverviewAnalytics,
  type PlannerOverviewAnalytics,
  type GetPlannerHabitDetail,
  type ListPlannerHabits,
  type PlannerChecklistsByHabit,
  type PlannerHabitCatalogueItem,
  type PlannerGrowthAttemptRow,
  type PlannerHabitDetail,
  type PlannerHabitLifecycleFilter,
  type PlannerId,
  type PlannerLocalDate,
  type PlannerDateMarkerSummary,
  type RecordHabitObservation,
  type SelectedDatePlannerReadModel,
  type PlannerScheduleSummaryForDate,
  type CreateHabitBundle,
  type EditHabit,
  type ChangeOrdinaryParent,
  beginPlannerPerformanceSpan,
  endPlannerPerformanceSpan,
  measurePlannerOperation,
} from '@/src/features/planner';

import { selectDayJournalItems } from './day-journal-model';
import { reminderCloseTarget } from './reminder-response-model';
import { habitDetailQueryInput, managementQueryDate, plannerLocalDateFromDevice, plannerTimezoneFromDevice, selectedDateFailureMessage } from './ui-adapters';
import {
  createPlannerDateState,
  reducePlannerDateState,
  type PlannerVisibleDateRange,
} from './planner-date-state';
import { createPlannerRevisionRequestCoalescer, isLatestPlannerRequest, plannerCatalogueCacheKey, plannerChecklistCacheKey, plannerClosureCacheKey } from './planner-query-coordinator';

/**
 * Closing from a banner does not care which items are tasks — `completable` and `done` are
 * the whole rule — so the set is empty rather than queried, and frozen so it is one object.
 */
const REMINDER_RESPONSE_NO_TASKS: ReadonlySet<string> = new Set<string>();

interface PlannerServices {
  readonly createHabit: CreateHabit;
  readonly addHabitDependency: AddHabitDependency;
  readonly recordHabitObservation: RecordHabitObservation;
  /** Subtasks: their own query and their own commands, off the record path. */
  readonly getHabitChecklists: typeof getHabitChecklistsWithProductionPersistence;
  readonly getHabitClosureRules: typeof getHabitClosureRulesWithProductionPersistence;
  /**
   * The second floor: the routines being grown, and the four ways that changes.
   *
   * Beside everything else rather than behind a second provider, because a screen that
   * needs both floors — the create sheet does — would otherwise need two contexts to
   * ask one question.
   */
  readonly getGrowingRoutines: typeof getGrowingRoutinesWithProductionPersistence;
  readonly getRoutineGrowthHistory: typeof getRoutineGrowthHistoryWithProductionPersistence;
  readonly startGrowingRoutine: typeof startGrowingRoutineWithProductionPersistence;
  readonly stopGrowingRoutine: typeof stopGrowingRoutineWithProductionPersistence;
  readonly setRoutineGrowthDetails: typeof setRoutineGrowthDetailsWithProductionPersistence;
  readonly setHabitClosureRule: typeof setHabitClosureRuleWithProductionPersistence;
  readonly addHabitChecklistLines: typeof addHabitChecklistLinesWithProductionPersistence;
  readonly setHabitChecklistLineDone: typeof setHabitChecklistLineDoneWithProductionPersistence;
  readonly removeHabitChecklistLine: typeof removeHabitChecklistLineWithProductionPersistence;
  readonly correctHabitObservation: CorrectHabitObservation;
  readonly getOccurrencesForDate: GetPlannerOccurrencesForDate;
  readonly getScheduleSummaryForDate: GetPlannerScheduleSummaryForDate;
  readonly getDateSummariesForRange: GetPlannerDateSummariesForRange;
  readonly getOverviewAnalytics: GetPlannerOverviewAnalytics;
  readonly listHabits: ListPlannerHabits;
  /**
   * Makes the operating system hold what the reminders now say.
   *
   * Exposed because **saving a reminder has to enqueue its scheduling** — the contract's
   * own first step. It is the one moment reconciliation cannot wait for the next
   * foreground: a person who sets a reminder and stays in the application would otherwise
   * have nothing scheduled at all until they left it and came back.
   */
  readonly reconcileReminders: () => void;
  readonly getHabitDetail: GetPlannerHabitDetail;
  readonly archiveHabit: typeof archiveHabitWithProductionPersistence;
  readonly restoreHabit: typeof restoreHabitWithProductionPersistence;
  readonly permanentlyDeleteHabit: typeof permanentlyDeleteHabitWithProductionPersistence;
  readonly previewDeleteHabitChain: typeof previewDeleteHabitChainWithProductionPersistence;
  readonly deleteHabitChain: typeof deleteHabitChainWithProductionPersistence;
  readonly editHabit: EditHabit;
  readonly changeOrdinaryParent: ChangeOrdinaryParent;
  readonly createHabitBundle: CreateHabitBundle;
  readonly refreshRevision: number;
  readonly refreshOccurrences: (scope?: PlannerLocalDate) => void;
  readonly selectedDate: PlannerLocalDate;
  readonly railAnchorDate: PlannerLocalDate;
  readonly visibleDateRange: PlannerVisibleDateRange;
  readonly browseRail: (date: PlannerLocalDate) => void;
  readonly selectDate: (date: PlannerLocalDate) => void;
  readonly selectToday: () => void;
}

const PlannerServicesContext = createContext<PlannerServices | null>(null);

export function PlannerProvider({ children }: PropsWithChildren) {
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [dateState, dispatchDate] = useReducer(
    reducePlannerDateState,
    undefined,
    () => createPlannerDateState(plannerLocalDateFromDevice()),
  );
  const selectedDateRef = useRef(dateState.selectedDate);
  /**
   * Say that something changed — and, where it is known, **what**.
   *
   * Without a date this is what it always was: everything held is dropped. That is right
   * for a habit created, edited, archived or deleted, whose schedule can reach any day.
   *
   * With one it drops that day alone. Ticking a checkbox changes exactly one day and used
   * to discard the other fifteen — so returning to a day looked at a moment ago read it
   * from disk again, which is what «чтобы при возврате к ним не прогружать их по новой»
   * is asking about. The catalogue and the closure rules are untouched by an observation:
   * the first is keyed by date and the second is a property of the items, not of a day.
   *
   * **Narrowed before the bump, never after.** The coalescers consume the narrowing when
   * the new revision arrives, so a caller cannot retroactively spare answers about a day
   * that has since changed.
   */
  const refreshOccurrences = useCallback((scope?: PlannerLocalDate) => {
    if (scope !== undefined) {
      const touches = (key: string) => key.includes(scope);
      selectedOccurrenceRequests.dropOnly(touches);
      checklistRequests.dropOnly(touches);
      catalogueRequests.dropOnly(touches);
      closureRequests.dropOnly(() => false);
    }
    setRefreshRevision((current) => current + 1);
  }, []);
  const browseRail = useCallback((date: PlannerLocalDate) => {
    dispatchDate({ type: 'browse', railAnchorDate: date });
  }, []);
  const selectDate = useCallback((date: PlannerLocalDate) => {
    if (selectedDateRef.current !== date) {
      selectedDateRef.current = date;
      beginPlannerPerformanceSpan('date_tap_to_content_ready');
    }
    dispatchDate({ type: 'select', selectedDate: date });
  }, []);
  const selectToday = useCallback(() => {
    const today = plannerLocalDateFromDevice();
    if (selectedDateRef.current !== today) {
      selectedDateRef.current = today;
      beginPlannerPerformanceSpan('date_tap_to_content_ready');
    }
    dispatchDate({ type: 'today', today });
  }, []);

  /**
   * Reminders are reconciled at launch and every time the application comes back.
   *
   * `docs/Notifications.md` names those two moments and a third — after a permission
   * change — which the create sheet triggers itself by reconciling once the person has
   * answered. Nothing here waits for it: a notification that is a minute late to be
   * scheduled is a notification, and a screen that waits for the operating system is not.
   *
   * It is deliberately **not** attached to `refreshRevision`. Every tick of a checkbox
   * bumps that, and re-walking a fortnight of occurrences per tick would spend the day's
   * battery to discover that nothing moved.
   */
  const reconcileReminders = useCallback(() => {
    void reconcileRemindersWithProductionPersistence({
      timezone: plannerTimezoneFromDevice(),
      today: plannerLocalDateFromDevice(),
    }).then((result) => {
      // A failure here changes nothing about the habit and is not shown: the contract is
      // explicit that scheduling never alters what the person planned, and a reminder
      // that could not be set says so on its own row rather than in a screen-wide error.
      if (!result.ok) reportPlannerFailure('reconcileReminders', result.error.code, []);
    });
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshOccurrences();
        reconcileReminders();
      }
    });
    return () => subscription.remove();
  }, [reconcileReminders, refreshOccurrences]);

  /**
   * What the person did with a reminder, and the day it was about.
   *
   * A notification carries the item **and the day it fired for**, because a reminder acted
   * on at ten past midnight is about yesterday: opening today would be the one date the
   * person did not ask for, and closing today's occurrence would write a mark against the
   * wrong day. Both branches take `intent.localDate` and neither reads the clock.
   *
   * `Done` is the journal's own command with the journal's own three rules
   * (`reminderCloseTarget`), so a banner can never close something a checkbox could not.
   * A tap opens the journal on that day rather than the editor: a reminder is about doing
   * the thing, and the editor is where its rules are changed.
   */
  const handleReminderResponse = useCallback((intent: ReminderResponseIntent) => {
    if (intent === null) return;
    const date = managementQueryDate(intent.localDate, plannerLocalDateFromDevice());
    selectDate(date);
    if (intent.kind === 'open') {
      router.navigate('/');
      return;
    }
    void (async () => {
      const day = await getPlannerOccurrencesForDateWithProductionPersistence({
        evaluationBoundary: plannerLocalDateFromDevice(),
        selectedLocalDate: date,
      });
      if (!day.ok) return;
      const rules = await getHabitClosureRulesWithProductionPersistence({ habitIds: [intent.habitId] });
      const { timed, anytime } = selectDayJournalItems({
        nowMinuteOfDay: null,
        rootGroups: day.value.rootGroups,
        taskHabitIds: REMINDER_RESPONSE_NO_TASKS,
      });
      const target = reminderCloseTarget({
        closesByChecklist: rules.ok ? rules.value : new Map<string, boolean>(),
        habitId: intent.habitId,
        items: [...timed, ...anytime],
      });
      if (target === null) return;
      const recorded = await recordHabitObservationWithProductionPersistence({
        ...target.row.commandContext,
        value: { type: 'checkbox', booleanValue: true },
      });
      // The day is refreshed either way: on success because something closed, and on
      // failure because whatever the screen is showing was decided before this ran.
      if (!recorded.ok) reportPlannerFailure('reminderDone', recorded.error.code, []);
      refreshOccurrences();
    })();
  }, [refreshOccurrences, selectDate]);

  useEffect(() => {
    // Registered here rather than at module scope: it is one `await` against the OS, and
    // nothing shows a banner before the first render anyway.
    void configureReminderNotificationActions();
    // Two sources, and both are needed. The listener catches a response while the
    // application is running; the last-response read catches the one that **launched** it,
    // which the listener never sees — and that is the ordinary case, because a reminder is
    // usually acted on from a phone that was not being used.
    void lastReminderResponse().then(handleReminderResponse);
    return addReminderResponseListener(handleReminderResponse);
  }, [handleReminderResponse]);

  /**
   * The application tidies up after itself once a launch.
   *
   * Two sweeps and no more: the retired subtask model, whose rows would otherwise
   * stand beside the new one as items of their own, and tasks a week past the day
   * they belonged to. A habit is history and is never swept.
   *
   * It runs after the first paint and never blocks it — nothing on screen waits
   * for a deletion — and it refreshes the day only if it actually removed
   * something, so an ordinary launch costs one catalogue read.
   */
  const sweptRef = useRef(false);
  useEffect(() => {
    if (sweptRef.current) return;
    sweptRef.current = true;
    void runPlannerMaintenanceWithProductionPersistence({
      boundaryTimezone: plannerTimezoneFromDevice(),
      today: plannerLocalDateFromDevice(),
    }).then((report) => {
      if (report.retiredSubtasks + report.purgedTasks > 0) refreshOccurrences();
      // After the sweep rather than before it: a reminder belonging to something the
      // sweep has just removed is an orphan, and reconciling first would schedule it and
      // then have to cancel it again on the next launch.
      reconcileReminders();
    });
  }, [reconcileReminders, refreshOccurrences]);

  const value = useMemo<PlannerServices>(
    () => ({
      createHabit: createHabitWithProductionPersistence,
      addHabitDependency: addHabitDependencyWithProductionPersistence,
      addHabitChecklistLines: addHabitChecklistLinesWithProductionPersistence,
      getHabitChecklists: getHabitChecklistsWithProductionPersistence,
      getGrowingRoutines: getGrowingRoutinesWithProductionPersistence,
      getHabitClosureRules: getHabitClosureRulesWithProductionPersistence,
      getRoutineGrowthHistory: getRoutineGrowthHistoryWithProductionPersistence,
      setRoutineGrowthDetails: setRoutineGrowthDetailsWithProductionPersistence,
      startGrowingRoutine: startGrowingRoutineWithProductionPersistence,
      stopGrowingRoutine: stopGrowingRoutineWithProductionPersistence,
      setHabitClosureRule: setHabitClosureRuleWithProductionPersistence,
      recordHabitObservation: recordHabitObservationWithProductionPersistence,
      removeHabitChecklistLine: removeHabitChecklistLineWithProductionPersistence,
      setHabitChecklistLineDone: setHabitChecklistLineDoneWithProductionPersistence,
      correctHabitObservation: correctHabitObservationWithProductionPersistence,
      getOccurrencesForDate: getPlannerOccurrencesForDateWithProductionPersistence,
      getScheduleSummaryForDate: getPlannerScheduleSummaryForDateWithProductionPersistence,
      getDateSummariesForRange: getPlannerDateSummariesForRangeWithProductionPersistence,
      getOverviewAnalytics: getPlannerOverviewAnalyticsWithProductionPersistence,
      listHabits: listPlannerHabitsWithProductionPersistence,
      reconcileReminders,
      getHabitDetail: getPlannerHabitDetailWithProductionPersistence,
      archiveHabit: archiveHabitWithProductionPersistence,
      restoreHabit: restoreHabitWithProductionPersistence,
      permanentlyDeleteHabit: permanentlyDeleteHabitWithProductionPersistence,
      previewDeleteHabitChain: previewDeleteHabitChainWithProductionPersistence,
      deleteHabitChain: deleteHabitChainWithProductionPersistence,
      editHabit: editHabitWithProductionPersistence,
      changeOrdinaryParent: changeOrdinaryParentWithProductionPersistence,
      createHabitBundle: createHabitBundleWithProductionPersistence,
      refreshRevision,
      refreshOccurrences,
      selectedDate: dateState.selectedDate,
      railAnchorDate: dateState.railAnchorDate,
      visibleDateRange: dateState.visibleDateRange,
      browseRail,
      selectDate,
      selectToday,
    }),
    [browseRail, dateState, reconcileReminders, refreshOccurrences, refreshRevision, selectDate, selectToday],
  );

  return <PlannerServicesContext.Provider value={value}>{children}</PlannerServicesContext.Provider>;
}

type ManagementQueryState<T> =
  | Readonly<{ status: 'loading'; data: T | null; error: null }>
  | Readonly<{ status: 'ready'; data: T; error: null }>
  | Readonly<{ status: 'error'; data: T | null; error: string }>;

export function usePlannerHabitCatalogue(searchText: string, lifecycle: PlannerHabitLifecycleFilter, asOfLocalDate: PlannerLocalDate) {
  const { listHabits, refreshRevision, refreshOccurrences } = usePlannerServices();
  const key = plannerCatalogueCacheKey(searchText, lifecycle, asOfLocalDate);
  const [held, setHeld] = useState<Held<readonly PlannerHabitCatalogueItem[]>>({ key, query: PENDING });
  useEffect(() => {
    let current = true;
    void catalogueRequests.request({
      revision: refreshRevision,
      key,
      load: () => listHabits({ searchText, lifecycle, sort: 'management_default', asOfLocalDate }),
    }).then((result) => {
      if (!current) return;
      setHeld({
        key,
        query: result.ok
          ? { status: 'ready', data: result.value, error: null }
          : { status: 'error', data: null, error: result.error.message },
      });
      if (result.ok) {
        endPlannerPerformanceSpan('archive_refresh');
        endPlannerPerformanceSpan('delete_refresh');
      }
    });
    return () => { current = false; };
  }, [asOfLocalDate, key, lifecycle, listHabits, refreshRevision, searchText]);
  const warm = held.key === key ? undefined : catalogueRequests.peek({ revision: refreshRevision, key });
  if (warm !== undefined && warm.ok) {
    return Object.freeze({ status: 'ready' as const, data: warm.value, error: null, retry: refreshOccurrences });
  }
  /**
   * **Held only while it is the answer to the question being asked.**
   *
   * The catalogue is keyed by the date it is «as of», and it used to be returned whatever
   * date that was — so on a date change the previous day's answer stood in until the new
   * one landed. It decides which rows are tasks and what times their reminders carry,
   * which is most of «задачи уже не помечаются выделенными»: not a missing tick, a tick
   * belonging to another day.
   */
  return Object.freeze({ ...(held.key === key ? held.query : PENDING), retry: refreshOccurrences });
}

/**
 * The subtasks of these items, as they stand on one day.
 *
 * A query of its own, deliberately: the day's occurrence read model is what
 * every record is computed from, and a line that never enters it can never be
 * counted by mistake. The habit ids are joined into one key so a day costs one
 * read however many items are on it.
 */
export function usePlannerChecklists(habitIds: readonly string[], localDate: PlannerLocalDate) {
  const { getHabitChecklists, refreshRevision, refreshOccurrences } = usePlannerServices();
  const key = plannerChecklistCacheKey(habitIds, localDate);
  const [held, setHeld] = useState<Held<PlannerChecklistsByHabit>>({ key, query: PENDING });
  useEffect(() => {
    let current = true;
    void checklistRequest(getHabitChecklists, refreshRevision, habitIds, localDate).then((result) => {
      if (!current) return;
      setHeld({
        key,
        query: result.ok
          ? { status: 'ready', data: result.value, error: null }
          : { status: 'error', data: null, error: result.error.message },
      });
    });
    return () => { current = false; };
  }, [getHabitChecklists, habitIds, key, localDate, refreshRevision]);
  const warm = held.key === key ? undefined : checklistRequests.peek({ revision: refreshRevision, key });
  if (warm !== undefined && warm.ok) {
    return Object.freeze({ status: 'ready' as const, data: warm.value, error: null, retry: refreshOccurrences });
  }
  /**
   * **A day's ticks are never shown under another day's date.**
   *
   * `state.data` used to survive every change of date and of item set, because it was only
   * ever written in the `then`. So a page turn kept the previous day's lines until the new
   * ones arrived — and where the two days hold different items, kept them indefinitely for
   * the items they had in common. The key is the day *and* its items, and the state is
   * used only while it still answers it.
   */
  return Object.freeze({ ...(held.key === key ? held.query : PENDING), retry: refreshOccurrences });
}

/**
 * How each of those items closes: by its own checkbox, or by its last line.
 *
 * A **separate** query rather than a field on the checklist one, because the rule is a
 * property of the item and the lines are a property of the day: folding them together
 * would reload the rule every time the date changed, for no reason.
 */
export function useHabitClosureRules(habitIds: readonly string[]): Readonly<{
  /** How each item asked for closes. Empty while the question is outstanding. */
  rules: ReadonlyMap<string, boolean>;
  /**
   * Whether this answer is about **these** items, rather than an empty stand-in.
   *
   * Absent and «not asked yet» are the same map, and a screen that cannot tell them apart
   * draws a day it does not yet know — which is half of what «блоки дублируются на 1 мс» was.
   */
  ready: boolean;
}> {
  const { getHabitClosureRules, refreshRevision } = usePlannerServices();
  const key = plannerClosureCacheKey(habitIds);
  const [held, setHeld] = useState<Readonly<{ answered: boolean; key: string; rules: ReadonlyMap<string, boolean> }>>(
    { answered: false, key, rules: NO_CLOSURE_RULES },
  );
  useEffect(() => {
    let current = true;
    const ids = key === '' ? [] : key.split(',');
    void closureRequest(getHabitClosureRules, refreshRevision, ids).then((result) => {
      if (!current || !result.ok) return;
      setHeld({ answered: true, key, rules: result.value });
    });
    return () => { current = false; };
  }, [getHabitClosureRules, key, refreshRevision]);
  /** A set already read answers in the render that asks, not on the microtask after it. */
  const warm = held.key === key ? undefined : closureRequests.peek({ revision: refreshRevision, key });
  if (warm !== undefined && warm.ok) return Object.freeze({ ready: true, rules: warm.value });
  // No items is a question with an answer: nothing closes by a checklist, and it is known.
  if (key === '') return Object.freeze({ ready: true, rules: NO_CLOSURE_RULES });
  /**
   * **One set's rules are never applied to another set's items**, which is the defect this
   * replaces. The answer used to be returned whatever it had been asked about, so a page
   * turn onto a different set of items kept the previous set's rules until a fresh read
   * landed — and «closes by its checklist» decides whether a row reads as done. Absent is
   * the honest answer while the question is outstanding, and absent means «by hand», which
   * is what an unread rule already meant everywhere else.
   */
  return held.key === key
    ? Object.freeze({ ready: held.answered, rules: held.rules })
    : Object.freeze({ ready: false, rules: NO_CLOSURE_RULES });
}

/**
 * The routines being grown — the second floor's own query.
 *
 * **Its own query, and that is structural rather than tidy.** The whole point of the two
 * floors is that the first counts everything and the second accompanies one to three
 * things; a field on the catalogue would have put the second floor's state inside the
 * first's read model, and every surface that loads a habit would have started carrying
 * it. A table nothing joins to, and a query nothing else calls, is what keeps them apart.
 *
 * The state survives a revision bump for the same reason the detail does: a bump means
 * this may have changed, not that what is on screen is wrong.
 */
export function usePlannerGrowingRoutines() {
  const { getGrowingRoutines, refreshRevision } = usePlannerServices();
  const [state, setState] = useState<ManagementQueryState<readonly PlannerGrowthAttemptRow[]>>({ status: 'loading', data: null, error: null });
  useEffect(() => {
    let current = true;
    void getGrowingRoutines().then((result) => {
      if (!current) return;
      setState(result.ok
        ? { status: 'ready', data: result.value, error: null }
        : { status: 'error', data: null, error: result.error.message });
    });
    return () => { current = false; };
  }, [getGrowingRoutines, refreshRevision]);
  return state;
}

/**
 * The habit's detail, and **a refresh is not a first load.**
 *
 * This used to clear itself to `{ status: 'loading', data: null }` on every bump of
 * `refreshRevision` — and the editor answers a loading detail by returning a
 * `LoadingState` instead of the form. So writing a subtask, which ends in
 * `refreshOccurrences()`, tore the whole editor down and rebuilt it: the screen
 * blanked and reloaded on every line added or removed, and no animation of the list
 * was even possible, because the tree holding it no longer existed.
 *
 * A revision bump means *this same subject may have changed*, so what is on screen
 * is a previous version of the right thing and stays until the next one arrives. A
 * change of **subject** still clears, because the previous habit's detail is not a
 * stale version of this one — it is a different habit, and showing it under the new
 * one's name would be a lie rather than a delay.
 */
export function usePlannerHabitDetail(habitId: PlannerId, asOfLocalDate: PlannerLocalDate) {
  const { getHabitDetail, refreshRevision, refreshOccurrences } = usePlannerServices();
  const [state, setState] = useState<ManagementQueryState<PlannerHabitDetail | null>>({ status: 'loading', data: null, error: null });
  const shownSubject = useRef<string | null>(null);
  const subject = `${habitId} ${asOfLocalDate}`;
  useEffect(() => {
    let current = true;
    if (shownSubject.current !== subject) setState({ status: 'loading', data: null, error: null });
    void getHabitDetail(habitDetailQueryInput(habitId, asOfLocalDate)).then((result) => {
      if (!current) return;
      shownSubject.current = result.ok ? subject : null;
      setState(result.ok ? { status: 'ready', data: result.value, error: null } : { status: 'error', data: null, error: result.error.message });
    });
    return () => { current = false; };
  }, [asOfLocalDate, getHabitDetail, habitId, refreshRevision, subject]);
  return Object.freeze({ ...state, retry: refreshOccurrences });
}

export function usePlannerServices(): PlannerServices {
  const context = useContext(PlannerServicesContext);
  if (context === null) throw new Error('PlannerProvider is missing from the application root.');
  return context;
}

type PlannerQueryState =
  | Readonly<{ status: 'loading'; data: SelectedDatePlannerReadModel | null; error: null; revision: number }>
  | Readonly<{ status: 'ready'; data: SelectedDatePlannerReadModel; error: null; revision: number }>
  | Readonly<{ status: 'error'; data: SelectedDatePlannerReadModel | null; error: string; revision: number }>;

export function usePlannerOccurrences(selectedDate: PlannerLocalDate): PlannerQueryState & {
  readonly retry: () => void;
} {
  const { getOccurrencesForDate, refreshRevision, refreshOccurrences } = usePlannerServices();
  const [state, setState] = useState<PlannerQueryState>({ status: 'loading', data: null, error: null, revision: -1 });
  const latestRequestTokenRef = useRef(0);

  useEffect(() => {
    let current = true;
    const requestToken = latestRequestTokenRef.current + 1;
    latestRequestTokenRef.current = requestToken;
    setState((previous) => ({
      status: 'loading',
      data: previous.data,
      error: null,
      revision: previous.revision,
    }));
    const evaluationBoundary = plannerLocalDateFromDevice();
    void selectedOccurrenceRequest(
      getOccurrencesForDate,
      refreshRevision,
      selectedDate,
      evaluationBoundary,
    ).then((result) => {
      if (!current || !isLatestPlannerRequest(requestToken, latestRequestTokenRef.current)) return;
      if (result.ok) {
        setState({ status: 'ready', data: result.value, error: null, revision: refreshRevision });
        endPlannerPerformanceSpan('date_tap_to_content_ready');
        endPlannerPerformanceSpan('create_refresh');
        endPlannerPerformanceSpan('create_to_visible_result');
        endPlannerPerformanceSpan('archive_refresh');
        endPlannerPerformanceSpan('delete_refresh');
      } else {
        endPlannerPerformanceSpan('date_tap_to_content_ready');
        setState((previous) => ({
          status: 'error',
          data: previous.data?.selectedLocalDate === selectedDate ? previous.data : null,
          error: selectedDateFailureMessage(result.error.code),
          revision: refreshRevision,
        }));
      }
    });
    return () => {
      current = false;
    };
  }, [getOccurrencesForDate, refreshRevision, selectedDate]);

  /**
   * **A day already read is shown in the render that asks for it, not the one after.**
   *
   * The effect above sets `loading` synchronously and resolves on a microtask, so even a
   * fully warm day rendered empty for one frame — and one frame of empty page at the head
   * of a slide is exactly the tear this package is chasing. `peek` answers from what is
   * already held, without starting a load and without waiting, so a prefetched day is
   * complete in its first frame. Where nothing is held it returns `undefined` and the
   * ordinary loading path is untouched.
   */
  const warm = state.data?.selectedLocalDate === selectedDate
    ? null
    : selectedOccurrencePeek(refreshRevision, selectedDate);
  if (warm !== null) {
    return Object.freeze({ status: 'ready' as const, data: warm, error: null, revision: refreshRevision, retry: refreshOccurrences });
  }

  return Object.freeze({ ...state, retry: refreshOccurrences });
}

/**
 * The days a person can reach in one gesture, read before they ask for one.
 *
 * **This is what makes a date change smooth, and no amount of animation could.** The page
 * used to arrive as an empty frame and fill in afterwards, because `selected` moves the
 * moment a finger commits and the read for it starts only then — so the slide and the
 * query ran one after the other instead of the query having already run. Warmed, the read
 * that the new page performs is a cache hit and its rows are there in the frame it
 * arrives in.
 *
 * **Sequential, and that is deliberate.** Each day waits for the one before it, so a
 * background warm-up can never queue ahead of the day somebody is actually looking at,
 * and the database is asked for one thing at a time. Cheap by construction: a day already
 * held resolves without touching SQLite at all.
 *
 * `enabled` exists so the caller can hold this until the selected day itself has landed.
 * A prefetch that starts first is a prefetch competing with the screen.
 */
export function usePlannerOccurrencePrefetch(
  dates: readonly PlannerLocalDate[],
  enabled = true,
): void {
  const { getOccurrencesForDate, getHabitChecklists, getHabitClosureRules, listHabits, refreshRevision } = usePlannerServices();
  // The identity of the array changes on every render; its contents do not.
  const key = dates.join(',');
  useEffect(() => {
    if (!enabled || key === '') return;
    let cancelled = false;
    const evaluationBoundary = plannerLocalDateFromDevice();
    void (async () => {
      for (const date of key.split(',') as PlannerLocalDate[]) {
        if (cancelled) return;
        const day = await selectedOccurrenceRequest(getOccurrencesForDate, refreshRevision, date, evaluationBoundary);
        if (cancelled) return;
        // **Everything that marks a row, not only the rows.** The item set is not known
        // until the day is read, which is precisely why these could never be started
        // earlier by the screen: they are a *consequence* of the day.
        await catalogueRequests.request({
          revision: refreshRevision,
          key: plannerCatalogueCacheKey('', 'active', date),
          load: () => listHabits({ searchText: '', lifecycle: 'active', sort: 'management_default', asOfLocalDate: date }),
        });
        if (cancelled || !day.ok) continue;
        const habitIds = day.value.rootGroups.map((group) => group.rootHabitId);
        if (habitIds.length === 0) continue;
        await checklistRequest(getHabitChecklists, refreshRevision, habitIds, date);
        if (cancelled) return;
        // **And how those items close**, which is the fourth of the four and was the one
        // left out: warm rows drawn against a cold rule read as the previous day's ticks.
        await closureRequest(getHabitClosureRules, refreshRevision, habitIds);
        // **And how those items close**, which is the fourth of the four and was the one
        // left out: warm rows drawn against a cold rule read as the previous day's ticks.
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, getHabitChecklists, getHabitClosureRules, getOccurrencesForDate, key, listHabits, refreshRevision]);
}

type PlannerScheduleSummaryQueryState =
  | Readonly<{ status: 'loading'; data: PlannerScheduleSummaryForDate | null; error: null }>
  | Readonly<{ status: 'ready'; data: PlannerScheduleSummaryForDate; error: null }>
  | Readonly<{ status: 'error'; data: PlannerScheduleSummaryForDate | null; error: string }>;

export function usePlannerScheduleSummary(localDate: PlannerLocalDate): PlannerScheduleSummaryQueryState & {
  readonly retry: () => void;
} {
  const { getScheduleSummaryForDate, refreshRevision, refreshOccurrences } = usePlannerServices();
  const [state, setState] = useState<PlannerScheduleSummaryQueryState>({ status: 'loading', data: null, error: null });
  const latestRequestTokenRef = useRef(0);
  useEffect(() => {
    let current = true;
    const requestToken = latestRequestTokenRef.current + 1;
    latestRequestTokenRef.current = requestToken;
    setState((previous) => ({ status: 'loading', data: previous.data?.localDate === localDate ? previous.data : null, error: null }));
    void getScheduleSummaryForDate({
      localDate,
      evaluationBoundary: plannerLocalDateFromDevice(),
    }).then((result) => {
      if (!current || !isLatestPlannerRequest(requestToken, latestRequestTokenRef.current)) return;
      setState(result.ok
        ? { status: 'ready', data: result.value, error: null }
        : { status: 'error', data: null, error: selectedDateFailureMessage(result.error.code) });
    });
    return () => { current = false; };
  }, [getScheduleSummaryForDate, localDate, refreshRevision]);
  return Object.freeze({ ...state, retry: refreshOccurrences });
}

export type PlannerDateSummary = PlannerDateMarkerSummary;

/**
 * **Days are kept, so that a day can be read before it is asked for.**
 *
 * Sixteen is a fortnight either side of a week and the whole of what the strip can show
 * without scrolling, which is the set a person can reach in one gesture from where they
 * are standing. It is a most-recently-used bound rather than a guess at a working set:
 * whatever is being looked at is touched on every read and therefore never the one
 * evicted.
 *
 * Held only for the **active revision**, and a checkbox tick bumps that, so nothing here
 * can serve a day that has changed. A failed read is not kept at all — `retainWhen` sees
 * the `Result` rather than a rejection, because these loaders resolve with their errors.
 */
const SELECTED_OCCURRENCE_RETAIN = 16;

const selectedOccurrenceRequests = createPlannerRevisionRequestCoalescer<
  Awaited<ReturnType<GetPlannerOccurrencesForDate>>
>({ retain: SELECTED_OCCURRENCE_RETAIN, retainWhen: (result) => result.ok });

/**
 * What is already known about a day, for the render that is happening now.
 *
 * The evaluation boundary is the device's own date, which is what the key is built from
 * on the way in as well — read here rather than threaded through, because a peek that
 * guessed a different boundary would silently never hit.
 */
function selectedOccurrencePeek(
  revision: number,
  selectedDate: PlannerLocalDate,
): SelectedDatePlannerReadModel | null {
  const key = `${selectedDate}|${plannerLocalDateFromDevice()}`;
  const held = selectedOccurrenceRequests.peek({ revision, key });
  return held !== undefined && held.ok ? held.value : null;
}

/**
 * The three queries that **decorate** a day, cached on the same terms as the day itself.
 *
 * A page turn was smooth in its rows and ragged in everything that marks them: the day's
 * occurrences were warm and its catalogue, its checklists and its closure rules were each
 * a fresh read that could only begin once the day had landed. Four queries, one page, and
 * only one of them prepared.
 *
 * Smaller bounds than the day's sixteen: the catalogue is one answer per date rather than
 * per date and item set, and the two item-scoped ones are only worth holding for the days
 * a person can still reach.
 */
const catalogueRequests = createPlannerRevisionRequestCoalescer<
  Awaited<ReturnType<ListPlannerHabits>>
>({ retain: 8, retainWhen: (result) => result.ok });

const checklistRequests = createPlannerRevisionRequestCoalescer<
  Awaited<ReturnType<typeof getHabitChecklistsWithProductionPersistence>>
>({ retain: 12, retainWhen: (result) => result.ok });

/**
 * **The fourth query, prepared at last.**
 *
 * The note above the prefetch says four queries feed one page and only one was prepared;
 * three were then given a cache, a `peek` and a place in the prefetch, and this one was
 * not. Measured from `тест6.MP4`, frames 108–126: a page turn drew the **new** day's
 * headings with the **old** day's ticks for four frames, because how an item closes decides
 * whether it reads as done, and this hook kept the previous set's answer until a fresh read
 * landed. Four visible changes of content in one transition — «задачи мерцают и исчезают».
 *
 * Held for more sets than the checklists, because the answer does not depend on the date:
 * one set of items keeps its rule across every day it appears on.
 */
const closureRequests = createPlannerRevisionRequestCoalescer<
  Awaited<ReturnType<typeof getHabitClosureRulesWithProductionPersistence>>
>({ retain: 16, retainWhen: (result) => result.ok });

function closureRequest(
  query: typeof getHabitClosureRulesWithProductionPersistence,
  revision: number,
  habitIds: readonly string[],
): ReturnType<typeof getHabitClosureRulesWithProductionPersistence> {
  return closureRequests.request({
    revision,
    key: plannerClosureCacheKey(habitIds),
    load: () => query({ habitIds: [...habitIds] }),
  });
}

/** Absent rules, as one stable value, so a re-read never invalidates a memo by identity. */
const NO_CLOSURE_RULES: ReadonlyMap<string, boolean> = Object.freeze(new Map<string, boolean>());

/**
 * The answer, **beside the question it answers**, rather than merged into it.
 *
 * Merged, the state stops being a discriminated union and every consumer loses the
 * narrowing that makes `error` a string exactly when the status is `error`. Held beside
 * it, the union is untouched and the identity check is one comparison.
 */
interface Held<T> {
  readonly key: string;
  readonly query: ManagementQueryState<T>;
}

const PENDING = Object.freeze({ status: 'loading' as const, data: null, error: null });



function checklistRequest(
  query: typeof getHabitChecklistsWithProductionPersistence,
  revision: number,
  habitIds: readonly string[],
  localDate: PlannerLocalDate,
): ReturnType<typeof getHabitChecklistsWithProductionPersistence> {
  return checklistRequests.request({
    revision,
    key: plannerChecklistCacheKey(habitIds, localDate),
    load: () => query({ habitIds: [...habitIds], localDate }),
  });
}

function selectedOccurrenceRequest(
  query: GetPlannerOccurrencesForDate,
  revision: number,
  selectedDate: PlannerLocalDate,
  evaluationBoundary: PlannerLocalDate,
): ReturnType<GetPlannerOccurrencesForDate> {
  const key = `${selectedDate}|${evaluationBoundary}`;
  return selectedOccurrenceRequests.request({
    revision,
    key,
    load: () => measurePlannerOperation(
      'selected_day_query',
      () => query({ selectedLocalDate: selectedDate, evaluationBoundary }),
    ),
  });
}

export function usePlannerDateSummaries(visibleRange: PlannerVisibleDateRange): Readonly<Record<string, PlannerDateSummary>> {
  const { getDateSummariesForRange, refreshRevision } = usePlannerServices();
  const { startDate, endDate } = visibleRange;
  const [summaries, setSummaries] = useState<Readonly<Record<string, PlannerDateSummary>>>({});
  const latestRequestTokenRef = useRef(0);
  useEffect(() => {
    let current = true;
    const requestToken = latestRequestTokenRef.current + 1;
    latestRequestTokenRef.current = requestToken;
    const evaluationBoundary = plannerLocalDateFromDevice();
    void markerRangeRequest(
      getDateSummariesForRange,
      refreshRevision,
      { startDate, endDate },
      evaluationBoundary,
    ).then((result) => {
      if (!current || !isLatestPlannerRequest(requestToken, latestRequestTokenRef.current)) return;
      if (result.ok) setSummaries((previous) => ({ ...previous, ...result.value.summaries }));
    });
    return () => { current = false; };
  }, [endDate, getDateSummariesForRange, refreshRevision, startDate]);
  return summaries;
}

type OverviewQueryState =
  | Readonly<{ status: 'loading'; data: PlannerOverviewAnalytics | null; error: null }>
  | Readonly<{ status: 'ready'; data: PlannerOverviewAnalytics; error: null }>
  | Readonly<{ status: 'error'; data: PlannerOverviewAnalytics | null; error: string }>;

/**
 * Overview's history, for a bounded range.
 *
 * The query builds one read model per day in the range, which is the same work the
 * date markers do over three weeks — here it is up to four months, so it is
 * measured, coalesced per refresh revision, and left to the screen to ask for the
 * narrowest range that answers the grain on screen.
 */
export function usePlannerOverviewAnalytics(range: Readonly<{ startDate: PlannerLocalDate; endDate: PlannerLocalDate }>): OverviewQueryState & {
  readonly retry: () => void;
} {
  const { getOverviewAnalytics, refreshRevision, refreshOccurrences } = usePlannerServices();
  const [state, setState] = useState<OverviewQueryState>({ status: 'loading', data: null, error: null });
  const latestRequestTokenRef = useRef(0);
  const { startDate, endDate } = range;
  useEffect(() => {
    let current = true;
    const requestToken = latestRequestTokenRef.current + 1;
    latestRequestTokenRef.current = requestToken;
    setState((previous) => ({ status: 'loading', data: previous.data, error: null }));
    void overviewAnalyticsRequest(getOverviewAnalytics, refreshRevision, startDate, endDate).then((result) => {
      if (!current || !isLatestPlannerRequest(requestToken, latestRequestTokenRef.current)) return;
      setState(result.ok
        ? { status: 'ready', data: result.value, error: null }
        : { status: 'error', data: null, error: selectedDateFailureMessage(result.error.code) });
    });
    return () => { current = false; };
  }, [endDate, getOverviewAnalytics, refreshRevision, startDate]);
  return Object.freeze({ ...state, retry: refreshOccurrences });
}

const overviewAnalyticsRequests = createPlannerRevisionRequestCoalescer<
  Awaited<ReturnType<GetPlannerOverviewAnalytics>>
>();

function overviewAnalyticsRequest(
  query: GetPlannerOverviewAnalytics,
  revision: number,
  startDate: PlannerLocalDate,
  endDate: PlannerLocalDate,
): ReturnType<GetPlannerOverviewAnalytics> {
  const evaluationBoundary = plannerLocalDateFromDevice();
  return overviewAnalyticsRequests.request({
    revision,
    key: `${startDate}|${endDate}|${evaluationBoundary}`,
    load: () => measurePlannerOperation(
      'overview_analytics_query',
      () => query({
        startDate,
        endDate,
        evaluationBoundary,
        // The clock and the timezone stay in the layer that is allowed to read
        // them; the query is handed two pure functions instead.
        localDayOfTimestamp: (timestamp) => plannerLocalDateFromDevice(new Date(timestamp)),
        localMinuteOfTimestamp: (timestamp) => {
          const moment = new Date(timestamp);
          return moment.getHours() * 60 + moment.getMinutes();
        },
      }),
    ),
  });
}

const markerRangeRequests = createPlannerRevisionRequestCoalescer<
  Awaited<ReturnType<GetPlannerDateSummariesForRange>>
>();

function markerRangeRequest(
  query: GetPlannerDateSummariesForRange,
  revision: number,
  range: PlannerVisibleDateRange,
  evaluationBoundary: PlannerLocalDate,
): ReturnType<GetPlannerDateSummariesForRange> {
  const key = `${range.startDate}|${range.endDate}|${evaluationBoundary}`;
  return markerRangeRequests.request({
    revision,
    key,
    load: () => measurePlannerOperation(
      'marker_range_query',
      () => query({ ...range, evaluationBoundary }),
      { rangeDays: 9 },
    ),
  });
}
