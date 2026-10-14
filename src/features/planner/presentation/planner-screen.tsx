import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  parsePlannerLocalDate,
  countPlannerRender,
  beginPlannerPerformanceSpan,
  endPlannerPerformanceSpan,
  measurePlannerOperation,
  type ObservationValue,
  type PlannerId,
  type SelectedDatePlannerOccurrenceRow,
} from '@/src/features/planner';
import { TAB_BAR_CLEARANCE } from '@/src/ui/tab-bar';
import {
  BottomScrim,
  EmptyState,
  InlineError,
  LoadingState,
  Screen,
  SecondaryButton,
} from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { HabitOccurrenceGroup } from './habit-occurrence-group';
import {
  createHabitGroupDisclosureState,
  habitGroupIsExpanded,
  reduceHabitGroupDisclosureState,
} from './habit-group-disclosure-state';
import { composePlannerPresentationGroups } from './planner-presentation-groups';
import { finishPlannerPendingAction, runPlannerPresentationAction, tryBeginPlannerPendingAction } from './planner-action-runner';
import { ObservationEntryModal, type ObservationEntryDraft } from './observation-entry-modal';
import { usePlannerDateSummaries, usePlannerOccurrences, usePlannerServices } from './planner-provider';
import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';

import { PlannerDateRail } from './planner-date-rail';
import {
  durationDraftToSeconds,
  habitCatalogueNavigation,
  occurrenceAction,
  plannerLocalDateFromDevice,
  plannerRowIsCanonicallyDone,
  quantityObservationFromDraft,
} from './ui-adapters';

type RecordableValue = Exclude<ObservationValue, { type: 'void' }>;

export function PlannerScreen() {
  countPlannerRender('Planner');
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; focusRootId?: string; focusHabitId?: string }>();
  const theme = useLifePlannerTheme();
  const {
    browseRail,
    recordHabitObservation,
    correctHabitObservation,
    refreshOccurrences,
    refreshRevision,
    selectedDate,
    railAnchorDate,
    visibleDateRange,
    selectDate,
    selectToday,
  } = usePlannerServices();
  const query = usePlannerOccurrences(selectedDate);
  const dateSummaries = usePlannerDateSummaries(visibleDateRange);
  const pendingObservationIdsRef = useRef(new Set<string>());
  const pendingRefreshIdsRef = useRef(new Set<string>());
  const [savingHabitIds, setSavingHabitIds] = useState<ReadonlySet<string>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [disclosureState, setDisclosureState] = useState(() => createHabitGroupDisclosureState(selectedDate));
  const [entryRow, setEntryRow] = useState<SelectedDatePlannerOccurrenceRow | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [highlightedRootId, setHighlightedRootId] = useState<PlannerId | null>(null);
  const plannerScrollRef = useRef<ScrollView>(null);
  const sectionOffsetsRef = useRef(new Map<string, number>());
  const groupOffsetsRef = useRef(new Map<string, Readonly<{ section: string; y: number }>>());
  const handledFocusRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const requestedDate = parsePlannerLocalDate(params.date);
    if (requestedDate.ok) selectDate(requestedDate.value);
    endPlannerPerformanceSpan('create_navigation');
  }, [params.date, selectDate]);

  useEffect(() => {
    setDisclosureState((current) => reduceHabitGroupDisclosureState(current, {
      type: 'selected_date_changed',
      selectedDate,
    }));
    setRowErrors(new Map());
  }, [selectedDate]);

  useEffect(() => () => {
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
  }, []);

  useEffect(() => {
    if (pendingRefreshIdsRef.current.size === 0) return;
    if (query.status === 'ready' && query.revision === refreshRevision && query.data.selectedLocalDate === selectedDate) {
      for (const habitId of pendingRefreshIdsRef.current) pendingObservationIdsRef.current.delete(habitId);
      pendingRefreshIdsRef.current.clear();
      setSavingHabitIds(new Set(pendingObservationIdsRef.current));
      endPlannerPerformanceSpan('observation_refresh');
    } else if (query.status === 'error' && query.revision === refreshRevision) {
      const failedHabitIds = [...pendingRefreshIdsRef.current];
      for (const habitId of failedHabitIds) pendingObservationIdsRef.current.delete(habitId);
      pendingRefreshIdsRef.current.clear();
      setSavingHabitIds(new Set(pendingObservationIdsRef.current));
      setRowErrors((current) => {
        const next = new Map(current);
        for (const habitId of failedHabitIds) next.set(habitId, 'Saved locally, but Planner could not refresh this row. Retry the Planner view.');
        return next;
      });
      endPlannerPerformanceSpan('observation_refresh');
    }
  }, [query.data, query.revision, query.status, refreshRevision, selectedDate]);

  const beginObservation = (habitId: string): boolean => {
    if (!tryBeginPlannerPendingAction(pendingObservationIdsRef.current, habitId)) return false;
    setSavingHabitIds(new Set(pendingObservationIdsRef.current));
    return true;
  };

  const clearObservation = (habitId: string) => {
    finishPlannerPendingAction(pendingObservationIdsRef.current, habitId);
    pendingRefreshIdsRef.current.delete(habitId);
    setSavingHabitIds(new Set(pendingObservationIdsRef.current));
  };

  const refreshAfterObservation = (habitId: string) => {
    pendingRefreshIdsRef.current.add(habitId);
    beginPlannerPerformanceSpan('observation_refresh');
    refreshOccurrences();
  };

  const handleRowAction = async (row: SelectedDatePlannerOccurrenceRow) => {
    const action = occurrenceAction(row);
    setRowErrors((current) => withoutMapKey(current, row.habitId));
    if (
      action.kind === 'choose_avoidance' ||
      action.kind === 'add_counter' ||
      action.kind === 'add_quantity' ||
      action.kind === 'add_duration'
    ) {
      setEntryError(null);
      setEntryRow(row);
      return;
    }
    if (action.kind === 'none') return;
    if (!beginObservation(row.habitId)) return;
    const result = await measurePlannerOperation('observation_command', () =>
      runPlannerPresentationAction(() => action.kind === 'record_checkbox'
        ? recordValue(row, { type: 'checkbox', booleanValue: true })
        : correctValue(row, { type: 'checkbox', booleanValue: action.value })),
    );
    if (!result.ok) {
      clearObservation(row.habitId);
      setRowErrors((current) => withMapValue(current, row.habitId, result.message));
      return;
    }
    refreshAfterObservation(row.habitId);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const recordValue = async (row: SelectedDatePlannerOccurrenceRow, value: RecordableValue) => {
    const result = await recordHabitObservation({ ...row.commandContext, value });
    return result.ok
      ? { ok: true as const }
      : { ok: false as const, message: result.error.message };
  };

  const correctValue = async (
    row: SelectedDatePlannerOccurrenceRow,
    replacement: ObservationValue,
    selectedObservationId?: PlannerId | null,
  ) => {
    const observationId = selectedObservationId ?? row.currentObservation.currentLeafIds[0];
    if (observationId === undefined) {
      return { ok: false as const, message: 'The current observation could not be found safely.' };
    }
    const result = await correctHabitObservation({
      observationId,
      correctionReason: replacement.type === 'void' ? 'reversal' : 'correct_value',
      correctedOccurrenceLocalDate: row.commandContext.occurrenceLocalDate,
      correctedOccurrenceTimezone: row.commandContext.occurrenceTimezone,
      replacement,
    });
    return result.ok
      ? { ok: true as const }
      : { ok: false as const, message: result.error.message };
  };

  const saveEntry = async (draft: ObservationEntryDraft) => {
    const row = entryRow;
    if (row === null) return;
    setEntryError(null);
    if (!beginObservation(row.habitId)) return;
    if (draft.operation !== 'add' && draft.selectedObservationId === null) {
      setEntryError('Choose the entry to change.');
      clearObservation(row.habitId);
      return;
    }
    let value: RecordableValue | null = null;
    if (draft.operation === 'remove') {
      const result = await measurePlannerOperation('observation_command', () =>
        runPlannerPresentationAction(() => correctValue(row, { type: 'void' }, draft.selectedObservationId)),
      );
      if (!result.ok) {
        clearObservation(row.habitId);
        setEntryError(result.message);
        return;
      }
      setEntryRow(null);
      refreshAfterObservation(row.habitId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    } else if (row.trackingMode === 'avoidance') {
      if (draft.avoidanceValue === null) {
        setEntryError('Choose Did not occur or Occurred.');
        clearObservation(row.habitId);
        return;
      }
      value = { type: 'avoidance', booleanValue: draft.avoidanceValue };
    } else if (row.trackingMode === 'counter') {
      if (!/^\d+$/.test(draft.value) || Number(draft.value) <= 0 || !Number.isSafeInteger(Number(draft.value))) {
        setEntryError('Enter a positive whole-number increment.');
        clearObservation(row.habitId);
        return;
      }
      value = { type: 'counter', counterDelta: Number(draft.value) };
    } else if (row.trackingMode === 'quantity' && row.actualTarget.trackingMode === 'quantity') {
      const quantity = quantityObservationFromDraft(draft.value, row.actualTarget.target);
      if (!quantity.ok) {
        setEntryError(quantity.errors[0]?.message ?? 'Enter a valid amount.');
        clearObservation(row.habitId);
        return;
      }
      value = { type: 'quantity', quantity: quantity.value };
    } else if (row.trackingMode === 'duration') {
      const seconds = durationDraftToSeconds(draft.hours, draft.minutes, draft.seconds);
      if (!seconds.ok) {
        setEntryError(seconds.errors[0]?.message ?? 'Enter a valid duration.');
        clearObservation(row.habitId);
        return;
      }
      value = { type: 'duration', durationSeconds: seconds.value };
    }
    if (value === null) {
      setEntryError('This observation type is not available.');
      clearObservation(row.habitId);
      return;
    }
    const result = await measurePlannerOperation('observation_command', () =>
      runPlannerPresentationAction(() =>
        draft.operation === 'correct' ||
        (row.trackingMode === 'avoidance' && row.actualTarget.trackingMode === 'avoidance' && row.actualTarget.actual !== null)
          ? correctValue(row, value, draft.selectedObservationId)
          : recordValue(row, value)),
    );
    if (!result.ok) {
      clearObservation(row.habitId);
      setEntryError(result.message);
      return;
    }
    setEntryRow(null);
    refreshAfterObservation(row.habitId);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const model = query.data?.selectedLocalDate === selectedDate ? query.data : null;
  const presentationGroups = useMemo(() => model === null ? [] : composePlannerPresentationGroups(model.rootGroups), [model]);
  const scheduledGroups = useMemo(() => presentationGroups.filter(({ root }) => root.rows[0]?.plannedLocalTime !== null), [presentationGroups]);
  const anytimeGroups = useMemo(() => presentationGroups.filter(({ root }) => root.rows[0]?.plannedLocalTime === null), [presentationGroups]);
  // The shift encodes the direction of time, and the design reversed which way:
  // going **forward** the page now arrives from the **right** and going back from
  // the left, one direction per transition and never both at once. Group headers
  // stay put — they are labels, not content, and moving them made the screen feel
  // loose.
  const listReduceMotion = useReduceMotion();
  const previousDateRef = useRef(selectedDate);
  const entranceRef = useRef({ direction: -PLANNER_DAY_ENTRANCE_TRAVEL, token: 0 });
  if (previousDateRef.current !== selectedDate) {
    // Direction comes from comparing the dates, never from the distance: a jump of
    // eleven days must read exactly like a step of one.
    entranceRef.current = {
      direction: selectedDate > previousDateRef.current ? PLANNER_DAY_ENTRANCE_TRAVEL : -PLANNER_DAY_ENTRANCE_TRAVEL,
      token: entranceRef.current.token + 1,
    };
    previousDateRef.current = selectedDate;
  }
  const entrance = entranceRef.current;

  // Overdue exists only on today: a past date's unfinished habit is history, not a
  // call to action, so it gets no wash (handoff §6.4).
  const overdueHabitIds = useMemo(() => {
    const overdue = new Set<string>();
    if (model === null || model.selectedLocalDate !== plannerLocalDateFromDevice()) return overdue;
    const now = new Date();
    const currentLocalTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const group of model.rootGroups) {
      for (const row of group.rows) {
        if (row.plannedLocalTime !== null && row.plannedLocalTime < currentLocalTime && row.state === 'expected_incomplete') overdue.add(row.habitId);
      }
    }
    return overdue;
  }, [model]);
  const canonicalRootIds = useMemo(() => presentationGroups.map(({ root }) => root.rootHabitId), [presentationGroups]);
  useEffect(() => {
    if (model === null) return;
    setDisclosureState((current) => reduceHabitGroupDisclosureState(current, {
      type: 'canonical_refresh',
      selectedDate,
      canonicalRootIds,
    }));
  }, [canonicalRootIds, model, selectedDate]);
  useEffect(() => {
    if (model === null || params.focusRootId === undefined || selectedDate !== params.date) return;
    const rootId = canonicalRootIds.find((candidate) => candidate === params.focusRootId);
    if (rootId === undefined) return;
    const signature = `${selectedDate}|${rootId}|${params.focusHabitId ?? rootId}`;
    if (handledFocusRef.current === signature) return;
    handledFocusRef.current = signature;
    setDisclosureState((current) => reduceHabitGroupDisclosureState(current, { type: 'reveal', rootId }));
    setHighlightedRootId(rootId);
    AccessibilityInfo.announceForAccessibility(params.focusHabitId === rootId ? 'Habit revealed in Planner.' : 'Habit and its owning group revealed in Planner.');
    setTimeout(() => {
      const group = groupOffsetsRef.current.get(rootId);
      if (group === undefined) return;
      const y = (sectionOffsetsRef.current.get(group.section) ?? 0) + group.y;
      plannerScrollRef.current?.scrollTo({ animated: true, y: Math.max(0, y - 24) });
    }, 80);
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedRootId((current) => current === rootId ? null : current), 2400);
  }, [canonicalRootIds, model, params.date, params.focusHabitId, params.focusRootId, selectedDate]);
  const today = plannerLocalDateFromDevice();
  const openAdd = () => router.push({ pathname: '/planner/create', params: { date: selectedDate } });
  return (
    <>
      <View style={styles.root}>
      <Screen backgroundColor={theme.today.appSurface} contentStyle={styles.screenContent} scrollRef={plannerScrollRef}>
        <View style={styles.plannerHeader}>
          <Text accessibilityRole="header" style={[theme.typography.largeTitle, styles.plannerTitle, { color: theme.today.primaryText }]}>Planner</Text>
          <Pressable
            accessibilityHint="Opens habit management."
            accessibilityLabel="Open habit management"
            accessibilityRole="button"
            onPress={() => router.push(habitCatalogueNavigation(selectedDate))}
            style={({ pressed }) => [styles.headerAction, { backgroundColor: pressed ? theme.today.pressedSurface : 'transparent' }]}
          >
            <Text style={[theme.typography.label, { color: theme.today.system }]}>Manage</Text>
          </Pressable>
        </View>
        <PlannerDateRail
          onBrowse={browseRail}
          onReturnToToday={selectedDate === today ? undefined : selectToday}
          onSelect={(date) => selectDate(date)}
          railAnchorDate={railAnchorDate}
          selectedDate={selectedDate}
          summaries={dateSummaries}
        />
        {query.status === 'loading' && model === null ? <LoadingState label="Preparing selected day" /> : null}
        {query.status === 'error' ? (
          <View style={{ gap: theme.spacing.sm }}>
            <InlineError message={query.error} />
            <SecondaryButton onPress={query.retry} title="Retry" />
          </View>
        ) : null}
        {model?.resolution === 'recoverable_exclusions' ? (
          <InlineError message={`${model.recoverableExclusions.length === 1 ? 'One habit needs' : `${model.recoverableExclusions.length} habits need`} a schedule. Other scheduled habits are shown below. Open Habit Management to repair ${model.recoverableExclusions.length === 1 ? 'it' : 'them'}.`} />
        ) : null}
        {model !== null && model.rootGroups.length === 0 ? (
          model.createdHabitCount === 0 ? (
            <View style={[styles.onboarding, { backgroundColor: theme.colors.elevatedSurface, borderColor: theme.colors.border }]}>
              <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text }]}>Start with one small habit</Text>
              <Text style={[theme.typography.body, { color: theme.colors.secondaryText }]}>Choose a starting point. You can review it before anything is saved.</Text>
              <View style={styles.quickStarts}>
                {[
                  ['Morning routine', 'morning'],
                  ['Drink water', 'hydration'],
                  ['Read', 'reading'],
                  ['Exercise', 'workout'],
                ].map(([label, template]) => <Pressable key={template} accessibilityRole="button" onPress={() => router.push({ pathname: '/planner/create', params: { date: selectedDate, template } })} style={({ pressed }) => [styles.quickStart, { backgroundColor: pressed ? theme.colors.accentSubtle : theme.colors.groupedBackground, borderColor: theme.colors.border }]}><Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text><Ionicons name="chevron-forward" size={18} color={theme.colors.accent} /></Pressable>)}
              </View>
              <SecondaryButton title="Create your own" onPress={() => router.push({ pathname: '/planner/create', params: { date: selectedDate } })} />
            </View>
          ) : (
            <EmptyState
              action={<SecondaryButton onPress={selectToday} title="Go to Today" />}
              message="Habits exist, but none are scheduled for this date. Date navigation is generated from the calendar."
              title="Nothing scheduled"
            />
          )
        ) : null}
        <PlannerDayEntrance direction={entrance.direction} reduceMotion={listReduceMotion} token={entrance.token}>
        <View style={styles.sections}>
        <PlannerSection counts={sectionCounts(scheduledGroups)} overdueHabitIds={overdueHabitIds} title="Scheduled" groups={scheduledGroups} highlightedRootId={highlightedRootId} selectedDate={selectedDate} disclosureState={disclosureState} rowErrors={rowErrors} savingHabitIds={savingHabitIds} onAction={handleRowAction} onRootLayout={(rootId, y) => groupOffsetsRef.current.set(rootId, { section: 'scheduled', y })} onSectionLayout={(y) => sectionOffsetsRef.current.set('scheduled', y)} onToggle={(rootId) => setDisclosureState((current) => reduceHabitGroupDisclosureState(current, { type: 'toggle', rootId }))} />
        <PlannerSection counts={sectionCounts(anytimeGroups)} overdueHabitIds={overdueHabitIds} title="Anytime" groups={anytimeGroups} highlightedRootId={highlightedRootId} selectedDate={selectedDate} disclosureState={disclosureState} rowErrors={rowErrors} savingHabitIds={savingHabitIds} onAction={handleRowAction} onRootLayout={(rootId, y) => groupOffsetsRef.current.set(rootId, { section: 'anytime', y })} onSectionLayout={(y) => sectionOffsetsRef.current.set('anytime', y)} onToggle={(rootId) => setDisclosureState((current) => reduceHabitGroupDisclosureState(current, { type: 'toggle', rootId }))} />
        </View>
        </PlannerDayEntrance>
      </Screen>
      {/* The list continues under the glass and dissolves into the ground. */}
      <BottomScrim groundColor={theme.today.appSurface} />
      {/* Add stays out of the capsule: the tab bar is reserved for modules. */}
      <View style={styles.floatingAdd}>
        <Pressable
          accessibilityHint="Choose a template or create a habit."
          accessibilityLabel="Add habit"
          accessibilityRole="button"
          onPress={openAdd}
          style={({ pressed }) => [styles.addControl, {
            backgroundColor: pressed ? theme.today.completionPressed : theme.today.completion,
            shadowColor: theme.colors.shadow,
          }]}
        >
          <Ionicons color={theme.today.onAccent} name="add" size={20} />
        </Pressable>
      </View>
      </View>
      <ObservationEntryModal
        error={entryError}
        onCancel={() => { if (entryRow === null || !savingHabitIds.has(entryRow.habitId)) setEntryRow(null); }}
        onSave={(draft) => void saveEntry(draft)}
        row={entryRow}
        saving={entryRow !== null && savingHabitIds.has(entryRow.habitId)}
        visible={entryRow !== null}
      />
    </>
  );
}

function PlannerSection({ title, counts, groups, highlightedRootId, selectedDate, disclosureState, rowErrors, savingHabitIds, overdueHabitIds, onAction, onRootLayout, onSectionLayout, onToggle }: {
  readonly title: string;
  readonly counts: Readonly<{ done: number; total: number }>;
  readonly groups: ReturnType<typeof composePlannerPresentationGroups>;
  readonly highlightedRootId: PlannerId | null;
  readonly selectedDate: string;
  readonly disclosureState: ReturnType<typeof createHabitGroupDisclosureState>;
  readonly rowErrors: ReadonlyMap<string, string>;
  readonly savingHabitIds: ReadonlySet<string>;
  readonly overdueHabitIds: ReadonlySet<string>;
  readonly onAction: (row: SelectedDatePlannerOccurrenceRow) => Promise<void>;
  readonly onRootLayout: (rootId: PlannerId, y: number) => void;
  readonly onSectionLayout: (y: number) => void;
  readonly onToggle: (rootId: PlannerId) => void;
}) {
  if (groups.length === 0) return null;
  return <View onLayout={(event) => onSectionLayout(event.nativeEvent.layout.y)} style={styles.rootGroupList}>
    <PlannerGroupHeader counts={counts} title={title} />
    {groups.map(({ root, ordinaryChildren }) => <HabitOccurrenceGroup
      key={root.rootHabitId}
      expanded={disclosureState.selectedDate === selectedDate && habitGroupIsExpanded(disclosureState, root.rootHabitId)}
      group={root}
      highlighted={highlightedRootId === root.rootHabitId}
      ordinaryChildren={ordinaryChildren}
      overdueHabitIds={overdueHabitIds}
      rowErrors={rowErrors}
      savingHabitIds={savingHabitIds}
      onAction={(row) => void onAction(row)}
      onLayout={(event) => onRootLayout(root.rootHabitId, event.nativeEvent.layout.y)}
      onToggle={() => onToggle(root.rootHabitId)}
    />)}
  </View>;
}

/** The day's content arrives as one sheet: 32 pt of travel, 220 ms, with a fade. */
const PLANNER_DAY_ENTRANCE_TRAVEL = 32;
const PLANNER_DAY_ENTRANCE_DURATION = 620;
const PLANNER_DAY_ENTRANCE_EASING = Easing.bezier(0.32, 0.72, 0, 1);
/** How long past the entrance the guard waits before forcing the day visible. */
const PLANNER_DAY_ENTRANCE_GUARD = 160;

/**
 * The day arrives as one sheet — and, whatever happens to that arrival, it must
 * never be what the day's visibility depends on.
 *
 * This is the empty Planner. The entrance sets `opacity` to 0 and used to rely
 * solely on a native-driven animation reaching 1, with a cleanup that called
 * `stop()` — which freezes the values exactly where they stand. Saving a habit
 * ends in `router.replace` onto Planner with a new `date`, so the token advances
 * in the same moment the screen is covered by the pushed one; a native animation
 * on a covered, detached view can stop advancing, and nothing else in the screen
 * would ever restore opacity. The rows were mounted and correct the whole time,
 * which is why no empty state showed and why relaunching fixed it.
 *
 * Three guarantees now make the invisible state unreachable, and they hold no
 * matter which of those mechanisms actually fires: the animation settles itself
 * when it finishes, a guard settles it if it never does, and regaining focus
 * settles it whenever no entrance is in flight.
 */
function PlannerDayEntrance({ direction, reduceMotion, token, children }: {
  readonly direction: number;
  readonly reduceMotion: boolean;
  readonly token: number;
  readonly children: ReactNode;
}) {
  const shift = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const animating = useRef(false);
  const settle = useCallback(() => {
    animating.current = false;
    shift.setValue(0);
    fade.setValue(1);
  }, [fade, shift]);

  // The day arrives **every time the screen is opened**, not once per mount. The
  // screen is a tab, so it stays mounted behind Manage, Edit and Today and a
  // mount-only entrance played exactly once in a session. Focus drives it, and
  // the resting values are the visible ones, so nothing is hidden waiting for it.
  const [openings, setOpenings] = useState(0);
  useFocusEffect(useCallback(() => {
    setOpenings((current) => current + 1);
  }, []));

  useEffect(() => {
    if (openings === 0) return;
    if (reduceMotion) {
      settle();
      return;
    }
    animating.current = true;
    shift.setValue(direction);
    fade.setValue(0);
    const arrival = Animated.parallel([
      Animated.timing(shift, { duration: PLANNER_DAY_ENTRANCE_DURATION, easing: PLANNER_DAY_ENTRANCE_EASING, toValue: 0, useNativeDriver: true }),
      Animated.timing(fade, { duration: PLANNER_DAY_ENTRANCE_DURATION, easing: PLANNER_DAY_ENTRANCE_EASING, toValue: 1, useNativeDriver: true }),
    ]);
    arrival.start(() => settle());
    const guard = setTimeout(settle, PLANNER_DAY_ENTRANCE_DURATION + PLANNER_DAY_ENTRANCE_GUARD);
    return () => {
      clearTimeout(guard);
      arrival.stop();
      // Settling rather than freezing: an interrupted entrance resolves to the
      // day being visible, never to it being half-faded or gone.
      settle();
    };
    // A completion refresh must not replay the day: only a new date, or the screen
    // being opened again, re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openings, reduceMotion, token]);

  return <Animated.View style={{ opacity: fade, transform: [{ translateX: shift }] }}>{children}</Animated.View>;
}

/** `SCHEDULED  2 / 5` — the counter the removed "N remaining" surface used to carry. */
function PlannerGroupHeader({ title, counts }: { readonly title: string; readonly counts: Readonly<{ done: number; total: number }> }) {
  const theme = useLifePlannerTheme();
  return <View accessible accessibilityRole="header" accessibilityLabel={`${title}, ${counts.done} of ${counts.total} done`} style={styles.groupHeader}>
    <Text style={[styles.groupHeaderLabel, { color: theme.today.tertiaryText }]}>{title.toLocaleUpperCase()}</Text>
    <Text style={[styles.groupHeaderCount, { color: theme.today.tertiaryText }]}>{`${counts.done} / ${counts.total}`}</Text>
  </View>;
}

function sectionCounts(groups: ReturnType<typeof composePlannerPresentationGroups>): Readonly<{ done: number; total: number }> {
  const roots = groups.map(({ root }) => root.rows[0]).filter((row): row is SelectedDatePlannerOccurrenceRow => row !== undefined);
  // A routine closed by its steps counts for the day exactly like a hand-checked
  // habit: its completion is canonical, it simply has a different author.
  return Object.freeze({ done: roots.filter(plannerRowIsCanonicallyDone).length, total: roots.length });
}

function withMapValue(map: ReadonlyMap<string, string>, key: string, value: string): ReadonlyMap<string, string> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

function withoutMapKey(map: ReadonlyMap<string, string>, key: string): ReadonlyMap<string, string> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootGroupList: { gap: 8 },
  sections: { gap: 14 },
  /** Clears the Add control, which itself sits 12 pt above the tab capsule. */
  screenContent: { paddingBottom: TAB_BAR_CLEARANCE + 12 + 44 + 16 },
  plannerHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 44 },
  plannerTitle: { flex: 1, letterSpacing: -0.5 },
  headerAction: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  groupHeader: { alignItems: 'baseline', flexDirection: 'row', gap: 8, paddingTop: 4 },
  groupHeaderLabel: { flex: 1, fontSize: 12, fontWeight: '600', letterSpacing: 0.84 },
  groupHeaderCount: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '600' },
  floatingAdd: { bottom: TAB_BAR_CLEARANCE + 12, position: 'absolute', right: 20 },
  addControl: { alignItems: 'center', borderRadius: 15, elevation: 8, height: 44, justifyContent: 'center', shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.22, shadowRadius: 22, width: 44 },
  onboarding: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, gap: 12, padding: 16 },
  quickStarts: { gap: 8 },
  quickStart: { alignItems: 'center', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 14 },
});
