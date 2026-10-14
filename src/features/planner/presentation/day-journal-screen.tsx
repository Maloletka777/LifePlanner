import { useFocusEffect, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type DimensionValue, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Reanimated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  Easing as ReanimatedEasing,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PlannerLocalDate, SelectedDatePlannerOccurrenceRow } from '@/src/features/planner';
import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';
import { TAB_BAR_CLEARANCE } from '@/src/ui/tab-bar';
import { useLifePlannerTheme, withAlpha } from '@/src/ui/theme';

import type { PlannerDayBlockKey } from '../domain/values/day-block';

import {
  blockDurationLabel,
  currentDayBlock,
  dayElapsedShare,
  selectDayBlocks,
  type DayBlockSection,
  type DayJournalSectionKey,
} from './day-blocks-model';

import {
  dayBarWindow,
  dayFreeWindowOptions,
  dayJournalHero,
  dayJournalReminderLocalTimes,
  dayJournalTally,
  dayJournalTaskHabitIds,
  isDeliberateJournalTap,
  journalCategoryColor,
  dayJournalPlateFacts,
  journalParkedJourney,
  journalDurationLabel,
  journalLocalTimeOfMinute,
  journalMinuteOfLocalTime,
  journalDominantMonthDate,
  journalMonthLabel,
  JOURNAL_HEADER_LIFT_INSET,
  JOURNAL_HEADER_LIFT_RADIUS,
  JOURNAL_HEADER_LIFT_SHADOW,
  JOURNAL_HEADER_LIFT_SCALE,
  JOURNAL_DATE_ROW,
  JOURNAL_DATE_TYPE_SIZE,
  JOURNAL_DAY_CAPTION_AHEAD,
  JOURNAL_DAY_CAPTION_TODAY,
  JOURNAL_DAY_CAPTION_WIDEST,
  JOURNAL_DROP_BAND,
  JOURNAL_DROP_COVER_HALF,
  JOURNAL_HERO_ARRIVAL_FLOOR,
  JOURNAL_TODAY_FADE,
  journalPageOffset,
  journalPageWindow,
  journalWeekColumnWidth,
  JOURNAL_HEADER_INSET,
  JOURNAL_WEEK_ROW_TOP,
  JOURNAL_HEADER_BOUNCE,
  JOURNAL_HEADER_FAST,
  JOURNAL_HEADER_LIFT_TRAVEL,
  JOURNAL_CHECK,
  JOURNAL_TOUCH_TARGET,
  PLATE_CHECKBOX,
  PLATE_CHECKBOX_OVERHANG,
  PLATE_CRITICAL_DOT,
  PLATE_GAP,
  PLATE_GROUND_PADDING,
  PLATE_MARK,
  PLATE_MIN_HEIGHT,
  PLATE_PADDING,
  PLATE_RADIUS,
  PLATE_RANK_SPINE,
  PLATE_ROW_GAP,
  PLATE_SELECTION_RING,
  PLATE_STEPS_SLOP,
  PLATE_SUBTASK_BOX,
  PLATE_SUBTASK_GAP,
  PLATE_SUBTASK_ROW,
  journalTaskMarkRow,
  journalTaskMarks,
  journalWeekDates,
  journalWeekRail,
  journalWeekStart,
  journalWeekdayIndex,
  selectDayJournalItems,
  JOURNAL_FAB_ROTATE_MS,
  JOURNAL_LABEL_MAX_SCALE,
  journalDropTrackX,
  JOURNAL_DROP_RADIUS,
  journalDropCentre,
  JOURNAL_NOW_ROW,
  JOURNAL_WEEK_LETTER,
  JOURNAL_WEEK_ROW,
  JOURNAL_POP_CURVE,
  JOURNAL_WEEKDAY_LETTERS,
  type DayJournalFact,
  type DayJournalFactKind,
  type DayJournalItem,
  type DayJournalStep,
  type DayJournalTaskMark,
} from './day-journal-model';
import { travelCurve, travelSpring, type TravelCurve } from '@/src/ui/motion';

import { DropLens, type DropLensDigit } from './drop-refraction';
import { CategoryChip, useMetFade } from './item-chip';
import { MonthTitle } from './month-title';
import { useHabitClosureRules, usePlannerChecklists, usePlannerHabitCatalogue, usePlannerOccurrencePrefetch, usePlannerOccurrences, usePlannerServices } from './planner-provider';
import { JournalCalendarScreen } from './journal-calendar-screen';
import { formatPlannerDateEntry, habitDetailNavigation, IMPORTANCE_LABELS, movePlannerDate, plannerDaysBetween, plannerLocalDateFromDevice, plannerLocalDateToDate } from './ui-adapters';

/**
 * Today — the day as three parts with things in them.
 *
 * **The one idea is that a day is a sequence, not a timetable.** Morning, day, evening;
 * inside each, the order the person put things in; and a clock time only where the
 * outside world set one — a train, a class, an appointment — which on an ordinary day is
 * a minority of items. What each thing states is **how long it takes**, because that is
 * the fact a person actually plans against and the one they can answer.
 *
 * **This retires the axis, and it retires its premise rather than its numbers.** The axis
 * drew every plate on its own minute at a constant scale, which is right only if a
 * planned minute means something — and for somebody who does not get up at the same hour
 * every day it does not, so it demanded a precision life has not got. Three device rounds
 * before it, the rail had already died of the opposite contradiction: a ruler and a list
 * of text cannot share one column. Blocks need neither ruler.
 *
 * **A block is read from the item, never from its minute** (schema v14). That rule is what
 * the whole diagnosis rests on: derived from the hour, a morning routine done at 12:40
 * would file itself under «day», and no failed morning would survive in the data long
 * enough to be noticed three weeks later.
 *
 * **The opening asks the layout.** There are three positions on the page and `onLayout`
 * reports them, so the page opens on the part of the day the clock is in — parked at its
 * top, because a block leads with the heading that says which part it is.
 *
 * **The NOW line** stands in the header and only on a day that has a clock. Repeating
 * «now» above the day is the fault six versions of the NOW card kept rediscovering; what
 * this line says is the one thing the list does not — what is happening and how far away
 * the next thing is.
 *
 * **What is still not built, and why:**
 *
 * - **The drag, the lift and the drop slots** — held by owner decision D (PD-PLATE-010).
 *   Moving something between parts of the day is a plus on a block for now, and it opens
 *   the create screen with that part already chosen.
 * - **The growth ring on a mark** — the second floor's own signal, which arrives with
 *   its tab.
 * - **The reschedule `↻` and editing time/repeats/category in place** — the
 *   effective-dated configuration contract owns those (PD-EDIT-004), so a tap carries the
 *   item to Edit.
 */
/** What the drop is travelling between: two dates for the page, two points for itself. */
interface Journey {
  readonly from: PlannerLocalDate;
  readonly fromX: number;
  readonly to: PlannerLocalDate;
  readonly toX: number;
  readonly curve: TravelCurve;
  /**
   * The stretch of `travel` this journey occupies.
   *
   * **`travel` is never reset, and that is the whole point.** It used to run 0 to 1 per
   * journey, so a new one began with `travel.setValue(0)` — which lands on the native side
   * *now*, while the interpolation describing it lands with the next render. For that one
   * frame the value was read against the **previous** journey's range, and zero there is
   * the date the drop set out from: the teleport back to the original date. It survived
   * the first correction because that one fixed the origin and left the reset.
   *
   * A journey claims `[at, at + 1]` from wherever the value already stands, and nothing is
   * written to `travel` when one begins. The frame before the render therefore draws the
   * old range at an unchanged value — which is exactly where the drop already was.
   */
  readonly inStart: number;
  readonly inEnd: number;
}

export function DayJournalScreen() {
  const theme = useLifePlannerTheme();
  const router = useRouter();
  const { recordHabitObservation, correctHabitObservation, refreshOccurrences, setHabitChecklistLineDone } = usePlannerServices();

  /**
   * The clock, and the date it belongs to.
   *
   * Both come from one reading of the device, so the date and the time can never
   * disagree across the midnight they are read at — an app left open past it used to
   * keep yesterday marked as today.
   */
  /**
   * **What the floating bar actually stands over.**
   *
   * `TAB_BAR_CLEARANCE` is the bar's own height plus its inset, and that was the whole
   * of it while the bar held the home-indicator room inside itself. An oval that comes
   * off every edge sits *above* the indicator, so the room it occupies is measured from
   * the safe area — and without it the create button was drawn behind the bar.
   */
  const insets = useSafeAreaInsets();
  const barClearance = TAB_BAR_CLEARANCE + insets.bottom;
  const clock = useDeviceClock();
  const reduceMotion = useReduceMotion();
  const today = clock.localDate;
  const [selected, setSelected] = useState<PlannerLocalDate>(today);
  const [weekStart, setWeekStart] = useState<PlannerLocalDate>(() => journalWeekStart(today));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * Which parts of the day are folded away, «Когда угодно» among them.
   *
   * **In memory, and the same fold on every date.** A collapse is a statement about how a
   * person wants to read the list, not a fact about the 6th of August — carrying it per
   * day would mean folding the same block again on every page turn. Nothing is stored:
   * the day's own facts are canonical and a view preference is not one of them, so a
   * relaunch opens everything, which is also the state that can never hide something from
   * somebody who has forgotten they folded it.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<DayJournalSectionKey>>(() => new Set());
  const [monthOpen, setMonthOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * **A probe, not a feature.** Three changes to the scroll mechanism have not moved the
   * page and the cause has not been established from the repository, so this puts the
   * runtime's own numbers where a person can read them instead of a fourth guess. It is
   * `__DEV__` only and comes out the moment the answer is known.
   */
  /**
   * What a mark made on a day that is over actually does.
   *
   * Not a question — «are you sure you did it?» asks a person to assert something the
   * application cannot check, and asks it every time. A statement of the consequence
   * teaches the rule once and the `Undo` beside it covers what a question protected.
   *
   * **Habits only**: a task carries no statistic to be kept out of.
   */
  const [notice, setNotice] = useState<Readonly<{ message: string; habitId: string }> | null>(null);
  const pending = useRef<Set<string>>(new Set());

  const query = usePlannerOccurrences(selected);
  const catalogue = usePlannerHabitCatalogue('', 'active', selected);
  /**
   * The month the week mostly belongs to, **derived and not deferred**.
   *
   * It used to be held a frame behind `weekStart`, because the label dissolved a letter at
   * a time and queuing that fade behind the settle's own commit dropped its first frames.
   * The label does not animate any more (owner instruction, «колхозно и устаревше»), so
   * the deferral has nothing left to protect and only added a frame to a change that was
   * already the last thing on screen to happen.
   */
  const weekMonth = useMemo(
    () => journalMonthLabel(journalDominantMonthDate(journalWeekDates(weekStart))),
    [weekStart],
  );
  /**
   * Which way the week went, so the month travels with it.
   *
   * Read from the **date**, not from a scroll: a week that moved forward is a later week
   * whichever way the finger got there — a swipe, a tap on the rail, or the Today button —
   * and one source means the three ways in cannot disagree about the direction.
   */
  const [monthHeading, setMonthHeading] = useState<-1 | 0 | 1>(0);
  const monthHeadingFrom = useRef(weekStart);
  useEffect(() => {
    if (monthHeadingFrom.current === weekStart) return;
    setMonthHeading(weekStart > monthHeadingFrom.current ? 1 : -1);
    monthHeadingFrom.current = weekStart;
  }, [weekStart]);
  // Held still on purpose: rebuilt inline it would carry every repaint of this screen into
  // the label, rebuilding its layers' native nodes in mid-fade.
  const monthLabelStyle = useMemo(
    () => [styles.monthLabel, { color: theme.today.primaryText }],
    [theme.today.primaryText],
  );
  const taskMarks = useMemo(() => journalTaskMarks(catalogue.data ?? []), [catalogue.data]);

  // The clock belongs to the day it is on; every other day is a plan.
  const nowLocalTime = selected === today ? clock.localTime : null;
  const nowMinuteOfDay = journalMinuteOfLocalTime(nowLocalTime);

  const model = query.data?.selectedLocalDate === selected ? query.data : null;
  /**
   * Whether this day has actually been read, as opposed to merely being on screen.
   *
   * It decides what an empty block is allowed to *say*, and nothing else — no opacity, no
   * timing. The fade this replaces gated whether the page could be **seen**, which is what
   * blanked it; this gates whether it may make a claim it cannot yet support.
   */
  const dayKnown = model !== null;

  /**
   * **The days one gesture away, read before the gesture.**
   *
   * The page arrived as an empty frame and filled in afterwards — reported twice — and no
   * animation can fix that, because the cause is the order of two things: `selected` moves
   * when the finger commits and the read for it begins only then. Warmed, the new page's
   * read is a cache hit and its rows are in the frame it arrives in.
   *
   * **The neighbours first, then the rest of the visible week**, because that is the order
   * a person reaches them in: the swipe and the arrows move by a day, and everything else
   * on the strip is one tap. Held until the selected day itself has landed, so a warm-up
   * never queues ahead of the day being looked at.
   */
  const prefetchDates = useMemo(() => {
    const wanted = [
      movePlannerDate(selected, 1),
      movePlannerDate(selected, -1),
      ...journalWeekDates(weekStart),
      /**
       * **Today is always warm, wherever the selection has wandered.**
       *
       * Every other date here is one the strip can reach in a tap, so proximity is what puts
       * it on the list. Today is reachable in a tap from *anywhere* — that is what the button
       * is — and it was the one date the list could not see, because from a distant day it is
       * nobody's neighbour. Reported as «отзыв на нажатие Today очень долгий, порядка полу
       * секунды»: the turn waits for the day it goes to to be whole, and from far away all
       * four of its reads started from nothing.
       *
       * One extra day held warm, and it is the only day in the calendar with a control of
       * its own.
       */
      today,
    ];
    return [...new Set(wanted)].filter((date) => date !== selected);
  }, [selected, today, weekStart]);
  usePlannerOccurrencePrefetch(prefetchDates, query.status === 'ready');

  // Subtasks, on their own query. They are never part of the day's occurrence read
  // model, so nothing that computes a record can see them.
  const itemHabitIds = useMemo(
    () => (model?.rootGroups ?? []).map((group) => group.rootHabitId),
    [model],
  );
  const checklists = usePlannerChecklists(itemHabitIds, selected);
  /**
   * **The screen keeps only the readiness, not the rules.** Which items close by their
   * lines is a fact about a page's rows and moved to `DayPage` with them; whether that
   * question has been answered about *this* day is what decides the header is whole.
   */
  const closure = useHabitClosureRules(itemHabitIds);
  const taskHabitIds = useMemo(() => dayJournalTaskHabitIds(catalogue.data ?? []), [catalogue.data]);
  const reminderLocalTimes = useMemo(() => dayJournalReminderLocalTimes(catalogue.data ?? []), [catalogue.data]);
  const day = useMemo(
    () => selectDayJournalItems({
      checklists: checklists.data ?? undefined,
      dayIsPast: selected < today,
      nowMinuteOfDay,
      reminderLocalTimes,
      rootGroups: model?.rootGroups ?? [],
      taskHabitIds,
    }),
    [checklists.data, model, nowMinuteOfDay, reminderLocalTimes, selected, taskHabitIds, today],
  );

  /**
   * **The day on screen is the last one that was actually ready, never a half-built one.**
   *
   * Reported over and over as «задачи мерцают», «галочки сбрасываются до перехода», «сначала
   * появляются задачи новой даты, потом исчезают» — all of it one thing. `selected` commits
   * the instant a finger lands, but the four reads that describe a day answer at different
   * moments, so for a few frames the page was assembled from a mixture: this day's rows with
   * that day's ticks, a heading from one and a counter from the other. A row whose *text* is
   * grey beside an empty checkbox is that contradiction made visible.
   *
   * Holding the previous day whole until the new one is complete is what iOS itself does with
   * a pushed screen: it does not show a half-built controller, it waits. **Priced honestly:**
   * on a *cold* day the tap is silent for as long as the read takes. The neighbours are
   * prefetched, so that is rare — and tens of milliseconds of stillness is not noticed, while
   * a torn frame is exactly what has been noticed for two days.
   *
   * A ref, not state: it is read in the same render that produced it, and a `setState` would
   * be a second render per turn for a value nothing else consumes.
   */
  /**
   * **A day is ready when all four of its reads have answered about it, not when one has.**
   *
   * The rows come from the day's own query; whether a row is a task comes from the catalogue;
   * its ticks come from the checklists; whether it closes by those ticks comes from the
   * closure rules. They answer at different moments, and a page built from a mixture is the
   * «через пару кадров ещё одна подгрузка, дублирует блоки» that survives a settled query.
   * Waiting for one of the four is how a second rebuild landed in the middle of a turn.
   */
  const dayIsWhole = dayKnown
    && catalogue.status === 'ready'
    && checklists.status === 'ready'
    && closure.ready;
  const readyDay = useRef<{ date: PlannerLocalDate; value: typeof day }>({ date: selected, value: day });
  if (dayIsWhole) readyDay.current = { date: selected, value: day };
  const shownDay = readyDay.current;

  /** How far the chosen day has run, for the header's meter. Null on any other date. */
  const dayElapsed = useMemo(() => dayElapsedShare(nowMinuteOfDay), [nowMinuteOfDay]);
  const tally = useMemo(() => dayJournalTally(shownDay.value.timed), [shownDay]);
  const window = useMemo(
    () => dayBarWindow({
      minutes: shownDay.value.timed.map((item) => item.minuteOfDay ?? 0),
      nowMinuteOfDay,
    }),
    [shownDay, nowMinuteOfDay],
  );

  /** The open free window, by its own start minute. */
  const [picking, setPicking] = useState<number | null>(null);
  /**
   * What a free window can be filled with: the day's untimed items, rank first.
   *
   * **Filtered by nothing else**, because an item states a length only if somebody said
   * one — filtering by whether it fits would hide the very items the drum has not been
   * used on yet.
   */
  const hero = useMemo(
    () => dayJournalHero({ items: shownDay.value.timed, nowMinuteOfDay, window }),
    [shownDay, nowMinuteOfDay, window],
  );
  const anytimeOptions = useMemo(() => dayFreeWindowOptions({ anytime: shownDay.value.anytime }), [shownDay]);

  // ── The week strip ────────────────────────────────────────────────────────
  /**
   * A year of weeks either side, written once and never rebuilt.
   *
   * The strip used to be three pages recycled around the selection, and every settle
   * rebuilt their contents and scrolled back to the middle — `scrollTo` is a command
   * to the native list rather than something that happens with the render, so the
   * offset and the content disagreed for a frame however that was ordered. Nothing is
   * recycled here, so the scroll offset simply *is* the week.
   */
  const strip = useRef<FlatList<PlannerLocalDate>>(null);
  const [measuredStripWidth, setStripWidth] = useState(0);
  /**
   * **A fallback the web bench needs and the phone never uses.**
   *
   * `react-native-web` does not reliably deliver `onLayout` for a view sitting inside an
   * animated, transformed parent — and this one sits inside two. The week never reported a
   * width, so `stripWidth` stayed 0 and the pager was never mounted: the strip rendered as a
   * 60 pt empty band with the dates missing entirely. Nothing about it is guesswork; the
   * header states its own inset and the window states its width, and the two agree with what
   * the browser measures for the row (347 on a 375 pt viewport).
   *
   * **Guarded to `web` on purpose.** On a device `onLayout` is the truth — it follows text
   * scale and safe areas, which an arithmetic width does not — so the phone keeps waiting for
   * it exactly as before, and this line is dead code there.
   */
  const windowWidth = useWindowDimensions().width;
  const stripWidth = measuredStripWidth !== 0 || Platform.OS !== 'web'
    ? measuredStripWidth
    : Math.max(0, windowWidth - JOURNAL_HEADER_INSET * 2);
  const railAnchor = useRef(journalWeekStart(today)).current;
  const weekRail = useMemo(() => journalWeekRail(railAnchor), [railAnchor]);
  const weekIndex = (week: PlannerLocalDate) => weekRail.indexOf(week);

  const settleWeek = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, stripWidth));
    const settled = weekRail[index];
    if (settled === undefined || settled === weekStart) return;
    setWeekStart(settled);
    setFailure(null);
  };
  /**
   * An animated move lets the settle follow it; a jump has to say so itself.
   *
   * iOS raises `onMomentumScrollEnd` from a finger's deceleration and from the end of
   * an *animated* programmatic scroll — never from a non-animated one. So a jump used
   * to scroll the strip and leave `weekStart` on the week it came from.
   */
  // Held stable, because `travelTo` closes over it and a `travelTo` rebuilt every render
  // rebuilds the gesture with it — a drag in flight would lose its own handler.
  const scrollToWeek = useCallback((week: PlannerLocalDate, animated: boolean) => {
    const index = weekRail.indexOf(week);
    if (index < 0 || stripWidth === 0) {
      setWeekStart(week);
      return;
    }
    /**
     * **The week the selection is on is known now, not when the scroll stops.**
     *
     * It used to be set only for a non-animated jump, so an animated one left `weekStart`
     * on the week it came from until `onMomentumScrollEnd` fired. Measured off `тест4.MP4`
     * on the Today jump: the list settled at 167 ms, the strip at 300 ms, and the month
     * label changed **alone, in one frame, at 433 ms** — after four frames in which
     * nothing else on the screen moved at all. Three endings for one gesture, and the last
     * of them read as a hiccup rather than as an arrival.
     *
     * `settleWeek` is unharmed: it returns early when the week it settles on is the one
     * already held, which after this is always.
     */
    setWeekStart(week);
    strip.current?.scrollToIndex({ animated, index });
  }, [stripWidth, weekRail]);

  // ── Choosing a day ───────────────────────────────────────────────────────
  // The whole of it now lives below, beside `weekRowWidth`: a journey has to know how
  // wide a column is before it can say how far the drop travels, and a value read before
  // the row has been measured is a journey computed against zero.

  /**
   * A swipe across the page is a day, and a vertical drag is still the scroll.
   *
   * The responder is claimed in the **capture** phase, because the pane's own
   * `ScrollView` is a child and would otherwise own the gesture from its first move;
   * the predicate is what keeps a scroll a scroll — the horizontal component has to
   * both be real and dominate. The commit threshold is the brief's own 56 pt, and the
   * claim threshold is deliberately smaller so the page does not scroll a little
   * before the day changes.
   */
  /**
   * The drop, the strip, the page, and the **one value** all three obey.
   *
   * `travel` runs 0 → 1 for the length of a date change and sits at 1 the rest of the
   * time. The drop's place, its stretch, the digits' inversion and the day page's slide
   * are every one of them an `interpolate` of it, so there is no second animation for a
   * button to disagree with the finger, and nothing can arrive at a different moment
   * from anything else.
   *
   * **It never leaves the UI thread.** The old path wrote two animated values *and*
   * a React `setPour` from a `requestAnimationFrame` loop, so every frame of every date
   * change re-rendered the week strip — which is most of what «дёргается» was. One
   * natively driven value replaces all three, and the only JS in a transition is the 33
   * numbers of its stretch table, computed once when it starts.
   */
  /**
   * **`travel` is a Reanimated shared value now, and the port is the whole of the change.**
   *
   * Nothing about the model moves: monotonic, a journey claiming `[at, at + 1]` from where
   * the value already stands, nothing written when one begins, every reader bound to the
   * journey's own range and clamped. Six device defects bought those rules and every one of
   * them survives here.
   *
   * What it buys is that **Skia can read it**. A `Animated.Value` is opaque to anything
   * outside React Native's own graph, so refraction — which has to know where the bead is
   * relative to the digits it bends — could only have been driven by a per-frame listener
   * on the JS thread, which is the fault this file has recorded five times.
   *
   * It also deletes a workaround: a shared value is **readable synchronously from JS**, so
   * the listener that mirrored the old value into a ref, and the ref itself, are gone. That
   * was there because a natively driven `Animated.Value` has no truthful JS copy.
   */
  const travel = useSharedValue(1);
  /** Whether a flight owns the value. Set from the spring's own completion, once a journey. */
  const flying = useRef(false);
  const paneFallbackWidth = useWindowDimensions().width;
  const [measuredPageWidth, setPageWidth] = useState(0);
  /**
   * The pane's width, with the same web-only fallback the strip needs and for the same
   * reason: `react-native-web` does not deliver `onLayout` for a view inside an animated,
   * transformed parent, and a track of seven pages at width zero is seven pages stacked.
   * On a device `onLayout` is the truth and this line is dead code.
   */
  const pageWidth = measuredPageWidth !== 0 || Platform.OS !== 'web'
    ? measuredPageWidth
    : paneFallbackWidth;
  /**
   * The pane's own height, measured rather than assembled from the window and four insets.
   *
   * It exists to give a day **a floor**, which is the whole answer to the screen lurching on
   * a page turn: see `pageMinHeight` below.
   */
  const [paneHeight, setPaneHeight] = useState(0);

  /**
   * **The header's lift, and it is one number.**
   *
   * Everything the header does — the inset, the radius, the glass, the shadow — is an
   * interpolation of the same scroll offset, so the four can never disagree about how far
   * off the page it is, and it returns by exactly the path it left by.
   *
   * **Nothing here is layout, and that is the whole trick.** An inset, a radius and a
   * shadow cannot be driven natively, and this screen's rule is that only `opacity` and
   * transforms animate, always on the native driver — a rule that exists because a
   * scroll handler on the JS thread is exactly what tears a list. So the plate does not
   * travel inward: it is **already** inset and rounded, and it fades in, which cannot be
   * told apart from travelling, because at zero opacity there is nothing to watch
   * travel. A 2 % settle gives it somewhere to arrive from.
   */
  const scrollY = useRef(new Animated.Value(0)).current;
  const [headerHeight, setHeaderHeight] = useState(0);
  /**
   * **Two halves, on Overview's own terms.**
   *
   * The glass is **bound** to the offset over sixteen points: it is opacity alone, costs
   * no layout, and therefore answers the first pixel — which it must, or a row slides
   * under a plate nobody has drawn. The **collapse** is timed, because measuring a screen
   * recording showed a height tracked per frame is the stutter, not the smoothness.
   *
   * The timed half is a pair, which is the trick `overview-panels.tsx` uses and the reason
   * that screen reads smooth: one value on the native driver for opacity and transforms,
   * one on the JS thread for layout, run in parallel with the same curve and duration so
   * the two cannot drift apart. Mixing them on a single value is what once sent
   * `paddingTop` to the native module and broke the header outright.
   */
  /**
   * **And now it can follow the finger, because following it costs nothing.**
   *
   * Bound to the offset it was the smoothest model tried and also the jerkiest, which sounds
   * like a contradiction and was not: the binding was fine and the height it drove was not.
   * With no layout left in the header, every value below is a transform or an opacity on a
   * natively bound offset — the whole thing runs on the UI thread and is exactly where the
   * scroll is. No duration to tune, no threshold to fall between, no state machine.
   */
  const lift = useMemo(() => scrollY.interpolate({
    extrapolate: 'clamp',
    inputRange: [0, JOURNAL_HEADER_LIFT_TRAVEL],
    outputRange: [0, 1],
  }), [scrollY]);
  /**
   * **One plate, and at rest there is no plate.**
   *
   * There were two for a while — one edge to edge, one inset — cross-faded, and both were
   * visible as two: through the middle of the change the text belonged to neither box and
   * hung over the edge of one or the other. The plan they were built against says the plate
   * is indistinguishable from the ground when the page is at the top, and that is the
   * sentence that dissolves the problem: a plate nobody can see needs no second plate to
   * fade from. It is one, it is transparent at rest, and it comes up as the day goes under.
   */
  const veil = useMemo(() => lift.interpolate({ extrapolate: 'clamp', inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }), [lift]);
  /**
   * **One value, and it never leaves the UI thread.**
   *
   * It was a pair — one native, one on the JS thread for the month row's height — because a
   * height is the honest way to free the room a row occupies. Then the finished build was
   * measured off a screen recording: across **406 frames of movement the header missed one
   * frame in nine**, and through a date change it stalled almost completely, five frames out
   * of six. The scroll is native and held its pace throughout; what waited was the half that
   * needed React.
   *
   * So nothing here animates layout. The month row is **squashed** rather than un-housed and
   * everything below slides up over its box — a scale and a translate say the same thing and
   * say it where a dropped frame is not possible, because React is not in the loop.
   */
  const bounce = useRef(new Animated.Value(0)).current;
  /**
   * **The ceiling.** Returned to the top by a flick rather than a drag, the header
   * overshoots seven points and settles back — it arrives with momentum and the momentum
   * has to go somewhere. A slow return has none and gets none: the bounce fires only
   * above the speed that made it.
   */
  const onDayScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    // The header itself is bound and needs nothing from here. This listener exists for the
    // one thing a bound value cannot express: arriving at the ceiling with momentum.
    const arriving = y <= 0 && lastScrollY.current > 0;
    if (arriving && !reduceMotion && lastScrollStep.current <= -JOURNAL_HEADER_FAST) {
      bounce.setValue(-JOURNAL_HEADER_BOUNCE);
      Animated.spring(bounce, { bounciness: 6, speed: 14, toValue: 0, useNativeDriver: true }).start();
    }
    lastScrollStep.current = y - lastScrollY.current;
    lastScrollY.current = y;
  }, [bounce, reduceMotion]);
  const lastScrollY = useRef(0);
  const lastScrollStep = useRef(0);
  /**
   * **Everything the header does hangs off this one value, and it runs on the JS thread.**
   *
   * A height is the only thing that frees room — opacity leaves the space occupied and a
   * scale leaves it reserved — so the collapse has to animate layout, and layout is not
   * something the native driver carries. Authorised by the owner on 2026-08-04 against the
   * standing rule, in as many words.
   *
   * **One driver, not two.** The first attempt kept the scroll native and crossed a second
   * value over for the height; mixing the two on one layer made React Native try to send
   * the whole style node to the native module, which answered «Style property paddingTop
   * is not supported» thirty-odd times on the device. Whatever the cost of a JS-thread
   * frame, half-and-half costs that and a broken layout on top.
   *
   * The cost is a device question: watch the list under the finger.
   */
  const [monthRowHeight, setMonthRowHeight] = useState(0);
  /**
   * `scaleY` to nothing looks like a height going to nothing and costs no layout; the
   * translate below takes back exactly the room the row was standing in. The row is
   * invisible by 55 % of the travel, so it never spends the last stretch as a sliver of
   * squashed text.
   */
  const headerSquash = useMemo(() => lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.01] }), [lift]);
  const headerMonthFade = useMemo(() => lift.interpolate({ extrapolate: 'clamp', inputRange: [0, 0.55, 1], outputRange: [1, 0, 0] }), [lift]);
  const headerShift = useMemo(
    () => lift.interpolate({ inputRange: [0, 1], outputRange: [0, -monthRowHeight] }),
    [lift, monthRowHeight],
  );
  /** The header does not only lose a row — what is left gets smaller with it. */
  const headerScale = useMemo(() => lift.interpolate({ inputRange: [0, 1], outputRange: [1, JOURNAL_HEADER_LIFT_SCALE] }), [lift]);
  /**
   * **The plate shrinks by exactly what the month row takes with it.**
   *
   * Its box is the open header and never changes; a `scaleY` about its own top edge closes
   * the bottom by the same amount the content above it moves, so the text is never outside
   * the plate at any point of the travel — which is what two plates could not manage
   * through the middle of a cross-fade. It carries the header's own scale as well, for the
   * same reason: whatever the content does, the surface under it does too.
   *
   * Priced: a corner is 22 across and 22 × the squash down, so at the closed end it is
   * slightly oval. Against text hanging over an edge, an oval corner is the cheaper fault.
   */
  const plateSquash = useMemo(
    () => lift.interpolate({
      inputRange: [0, 1],
      outputRange: [1, headerHeight === 0 ? 1 : Math.max(0.5, 1 - monthRowHeight / headerHeight)],
    }),
    [headerHeight, lift, monthRowHeight],
  );
  const [measuredWeekRowWidth, setWeekRowWidth] = useState(0);
  /** The same fallback, for the coordinate the drop travels along. See `stripWidth` above. */
  const weekRowWidth = measuredWeekRowWidth !== 0 || Platform.OS !== 'web'
    ? measuredWeekRowWidth
    : Math.max(0, windowWidth - JOURNAL_HEADER_INSET * 2);
  /**
   * Where the strip's content stands, bound natively.
   *
   * The drop lives over the strip rather than inside one of its pages, so its screen
   * place is its place in the content minus this — one `Animated.subtract`, native at
   * both ends, exactly as the Planner rail's pill already does it. That is what lets the
   * finger browse the weeks and the drop travel between them without either knowing the
   * other exists.
   */
  /**
   * The strip's own scroll, on the same value system as `travel`.
   *
   * The bead's place is `trackX − scrollX`, so the two have to be readable together — a
   * shared value cannot be subtracted from an `Animated.Value`. It stays on the UI thread:
   * `useAnimatedScrollHandler` is a worklet, which is what the header's own rules require
   * of anything every digit in the strip depends on.
   */
  const scrollX = useSharedValue(0);
  const stripScroll = useAnimatedScrollHandler({
    onScroll: (event) => { scrollX.value = event.contentOffset.x; },
  });
  /**
   * **Seeded, because `initialScrollIndex` raises no scroll event.**
   *
   * The strip opens on page 52 of a year of weeks, so the content is already ~18 800 pt
   * along before a finger has touched it — and `Animated.event` only ever hears about
   * movement. Left at zero the subtraction put the drop that far off the right edge,
   * and the digits, which invert for wherever the drop *says* it is, went white on white
   * in Light and near-black on near-black in Dark. That is «дат не видно вообще», and it
   * is one fault rather than two. `planner-date-rail.tsx` seeds its own pill's scroll for
   * exactly this reason; this is the same correction in the same shape.
   */
  useEffect(() => {
    if (stripWidth === 0) return;
    scrollX.value = Math.max(0, weekRail.indexOf(weekStart)) * stripWidth;
    // Only when the row is first measured: after that the strip's own events own it, and
    // re-seeding on `weekStart` would fight the scroll that changed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollX, stripWidth]);

  /** A date's place in the strip's content — the coordinate the drop and the digits share. */
  const trackXOf = useCallback((date: PlannerLocalDate) => journalDropTrackX({
    column: journalWeekdayIndex(date),
    page: Math.max(0, weekRail.indexOf(journalWeekStart(date))),
    stripWidth: weekRowWidth,
  }), [weekRail, weekRowWidth]);

  /**
   * What the current interpolation spans, and the stretch table for it.
   *
   * Equal ends mean nothing is in flight. It is state rather than a ref because the
   * interpolations are built in render: an interpolation is a description of a journey,
   * and a journey that changed without a render would be drawn against the old one.
   */
  const initialJourney = useRef<Readonly<Journey>>({
    curve: travelCurve({ distanceDays: 0, screenDistance: 0 }), from: selected, fromX: 0, inEnd: 1, inStart: 0, to: selected, toX: 0,
  }).current;
  /**
   * The journey, readable **now**, in JavaScript.
   *
   * An interruption has to know what it is interrupting in the moment it interrupts — which
   * endpoints the drop is currently travelling between, so the new journey can start from the
   * point it had reached rather than from a date it had not. **It is no longer React state**:
   * the only thing that ever read it in render was the drop's own interpolation, and that has
   * moved to the shared value below, where it can be read in the frame it changed.
   */
  const journeyRef = useRef(initialJourney);
  /**
   * The same journey, readable **on the UI thread, in the frame it changed**.
   *
   * This is the whole of the fix: every worklet that draws the drop reads this, and it is
   * written synchronously by `commitJourney` before anything native moves. Nothing about the
   * drop is a render input any more, so there is no commit for the animation to wait behind.
   */
  const dropSample = useSharedValue<DropSample>(dropSampleOf(initialJourney));
  /**
   * One place that moves a journey, because there were four and they have to agree.
   *
   * The ref is what an interruption reads; the shared value is what the frame draws. Writing
   * one without the other is exactly the divergence this replaces, so neither is written
   * anywhere else.
   */
  /**
   * **Where the drop stands in the strip's own content — derived once, read by everything.**
   *
   * The bead is placed by it, the lens is shifted by it, and each date cell asks it whether
   * the glass is over them. Derived in one place because three readers of one journey that
   * each build their own interpolation are three chances to disagree about where the glass is.
   */
  const dropTrackX = useDerivedValue(() => {
    const now = dropSample.value;
    return interpolate(
      travel.value, [now.inStart, now.inEnd], [now.fromX, now.toX], Extrapolation.CLAMP,
    );
  });
  /**
   * One render at the end of a journey, and it exists to unmount rather than to draw.
   *
   * Nothing reads the counter: what it is for is the pass that recomputes `pageDirection`
   * from the collapsed journey, so `committed` turns false and the day that has left stops
   * being mounted. Everything the frame draws comes from the shared value and needs no
   * render at all.
   */
  const [, arrived] = useReducer((count: number) => count + 1, 0);
  const commitJourney = useCallback((next: Readonly<Journey>) => {
    journeyRef.current = next;
    dropSample.value = dropSampleOf(next);
  }, [dropSample]);
  /**
   * Where `travel` actually stands, kept in JS.
   *
   * **Because there is no other honest way to ask.** The value is driven natively, so its
   * JS copy is stale, and `stopAnimation` only returns the true one while an animation is
   * live — with none running it hands back the stale copy without saying so. Two device
   * defects came out of that: a journey built on a wrong `at` claims a range the value is
   * nowhere near, and the spring then walks the drop across several dates on its own.
   *
   * A listener costs one number per frame **while something is moving**, and nothing at
   * rest, because a natively driven value only reports when it changes. Against reading a
   * wrong position, that is not a cost worth arguing about.
   */
  const selectedRef = useRef(selected);
  selectedRef.current = selected;


  /**
   * **Park the drop on the selected date once the row has a width.**
   *
   * Reported from the device: at launch there is no drop at all, and changing the date is
   * what makes one appear. The cause is the same shape as the `scrollX` seeding above and
   * the same one this file has now paid for three times — **a value that is only knowable
   * after a measurement, left at the zero its initialiser gave it.**
   *
   * The journey's initial state carries `fromX: 0, toX: 0`, because at mount `weekRowWidth`
   * is 0 and `trackXOf` has no width to answer with. Nothing ever revisited it. So
   * `dropTrackX` interpolated to 0 while `scrollX` was correctly seeded to page 52 —
   * roughly 18 800 pt — and the subtraction put the drop that far off the *left* edge.
   * The digits, which invert for wherever the drop says it is, saw it a screen's width
   * away and stayed uninverted. One cause, both symptoms, and the first date change fixed
   * it only because that built a journey with real endpoints.
   *
   * It collapses the journey onto the selection rather than animating to it: at launch the
   * drop has not travelled from anywhere, and a flight from the left edge on the first
   * frame would be motion that never happened. **A journey in flight owns the value** and
   * is left alone, which is what keeps a rotation mid-travel from teleporting the drop.
   */
  useEffect(() => {
    if (weekRowWidth === 0 || flying.current) return;
    const parked = journalParkedJourney(journeyRef.current, trackXOf(selectedRef.current));
    if (parked === null) return;
    commitJourney({ ...parked, from: selectedRef.current, to: selectedRef.current });
  }, [commitJourney, trackXOf, weekRowWidth]);

  /**
   * **The days on the track, and the one value a turn animates.**
   *
   * Seven pages stand side by side, each owning its date for its whole life and each reading
   * its own day. A turn slides the container and touches nothing else — no page's content is
   * rewritten, so there is no frame where new content sits at an old position. That frame is
   * what cost sixteen attempts under the carousel this replaces
   * (`docs/DayTransitionAnimation.md`).
   *
   * **The window is stable across a turn on purpose.** Rebuilding it mid-turn would change
   * every page's index, and an index is a position — which is the same defect entering from
   * the other end. It is recentred only once the spring has settled, and the offset is put
   * back in the same commit so the picture does not move.
   */
  const [pageWindow, setPageWindow] = useState<readonly PlannerLocalDate[]>(() => journalPageWindow(selected));
  /**
   * The same window, readable **now**.
   *
   * `begin` is deferred until the day it goes to is whole, so it runs a render after the
   * tap that decided it — and by then the window may have been rebuilt to put a distant
   * date within reach. Reading the state there would read the window that existed before
   * the rebuild, which is a page that is no longer on the track.
   */
  const pageWindowRef = useRef(pageWindow);
  pageWindowRef.current = pageWindow;
  const pageX = useSharedValue(0);
  const pageTrack = useAnimatedStyle(() => ({ transform: [{ translateX: pageX.value }] }));
  /**
   * Put the track where the chosen day already is, without animating.
   *
   * Used at rest — the first layout, a width change, and the recentring after a turn — where
   * the offset must follow the window rather than travel to it.
   */
  const parkTrack = useCallback((window: readonly PlannerLocalDate[], date: PlannerLocalDate, width: number) => {
    const index = window.indexOf(date);
    if (index < 0 || width === 0) return;
    pageX.value = journalPageOffset(index, width);
  }, [pageX]);
  useEffect(() => {
    // **Parking answers a change of geometry, never a change of date.**
    //
    // With `selected` in the deps this fired the moment a date was tapped and put the track
    // straight on its destination — before the spring had even been allowed to start, since
    // the start is deferred until the day is whole and `flying` is therefore still false.
    // The turn then had nowhere to travel, which is why the animation played exactly once:
    // «анимация проигрывается всего раз после открытия приложения».
    //
    // The three moments that genuinely need it are the first layout, a width change, and the
    // recentring after a turn — and the recentring calls `parkTrack` itself. A journey that is
    // running, or one merely waiting for its day, owns the track and is left alone.
    if (flying.current || pendingJourney.current !== null) return;
    parkTrack(pageWindow, selectedRef.current, pageWidth);
  }, [pageWidth, pageWindow, parkTrack]);

  /**
   * A date change, from wherever the drop currently is to wherever it is going.
   *
   * **The selection commits at the start, not at the end.** The old path moved the state
   * only once the pour had finished, so the query for the new day started after its
   * animation — which is why the page arrived empty and then filled. Committing first
   * lets the two run together: the page slides on the spring and its content fades in
   * when the data lands, and the outgoing day is held on screen by `DayCarousel` for
   * exactly as long as the slide takes.
   */
  const travelTo = useCallback((date: PlannerLocalDate, velocity = 0) => {
    const from = selectedRef.current;
    if (date === from || weekRowWidth === 0) {
      /**
       * **Nothing is written to `travel` here, and the absence is the fix.**
       *
       * The selection commits at the *start* of a journey, so «the date that is already
       * selected» is also «the destination of a journey in flight» — tapping a date twice
       * lands in this branch while the bead is still moving to it. Assigning `travel.value
       * = 1` then rewound it: `travel` is monotonic and every reader is clamped to the
       * running journey's own `[inStart, inEnd]`, so 1 is at or below the start of every
       * range after the first, all of them collapsed to `fromX`, and the bead jumped back
       * onto the date it had just left — with `flying` cleared, so nothing moved it again.
       *
       * It was invisible while settled because a collapsed journey carries `fromX === toX`,
       * which makes the interpolation constant and any value of `travel` the same place.
       * Reported from the device, 2026-08-06.
       *
       * A journey in flight is left alone to finish; a bead already parked is already there.
       */
      return;
    }
    setNotice(null);
    setExpanded(new Set());
    // **A folded section is not reset here**, and that is the difference from the steps
    // above it. Open steps belong to one item on one day; a folded part of the day is how
    // a person wants to read the list, and refolding «Утро» on every page turn would make
    // the control useless to the only person who would ever use it.
    setFailure(null);
    const toX = trackXOf(date);

    const begin = (fromX: number, at: number) => {
      const distanceDays = plannerDaysBetween(from, date);
      // How far the drop moves **on the glass**, which is what it actually crosses rather
      // than what the calendar says: its path down the strip's content, less however far
      // the strip itself pages underneath it. A jump of exactly a week is a page along and
      // a column across, so the two cancel and the drop stands still — which is the
      // measured nil in the model's own table, arrived at here rather than special-cased.
      const pages = weekRail.indexOf(journalWeekStart(date)) - weekRail.indexOf(journalWeekStart(from));
      const screenDistance = (toX - fromX) - pages * weekRowWidth;
      const curve = travelCurve({ distanceDays, screenDistance, velocity });
      const next = { curve, from, fromX, inEnd: at + 1, inStart: at, to: date, toX };
      // **Before `scrollToWeek`, and that order is the defect.** The scroll is native and
      // lands in this frame; a range that arrived a commit later left the bead a page adrift.
      commitJourney(next);
      scrollToWeek(journalWeekStart(date), !reduceMotion);
      if (reduceMotion) {
        travel.value = at + 1;
        commitJourney({ ...next, from: date, fromX: toX });
        // **Recentred only now, and the offset moves with it.** The chosen day sits in
        // the middle of the new window, so the same page stays under the same pixels and
        // nothing on screen moves; the pages that fell off the ends unmount, and new
        // ones mount off-screen where nobody can see them arrive.
        const recentred = journalPageWindow(date);
        setPageWindow(recentred);
        parkTrack(recentred, date, pageWidth);
        return;
      }
      // **Nothing is written to `travel` when a journey begins**: it carries on from
      // wherever it stands, because the new range begins there. `withSpring` reads the
      // value's current position as its own start, which is the same contract the old
      // `Animated.spring` had and the reason the range trick works at all.
      flying.current = true;
      const settle = (finished: boolean) => {
        flying.current = false;
        if (!finished) return;
        // Collapsing the journey onto its destination takes every reader back to a
        // constant, so nothing is left describing a movement that is over. The range is
        // kept, because `travel` is standing at its end.
        commitJourney({ ...next, from: date, fromX: toX });
        // **And the page that left has to be taken off the screen, which needs a render.**
        // Collapsing the journey makes `from === to`, so its direction is zero — and a
        // carousel worklet reading zero puts *both* pages at `translateX: 0`. The outgoing
        // day therefore comes **back** on top of the current one and stays there until some
        // unrelated render happens to unmount it: «баг с дублированием задач никуда не ушел,
        // они снова появляются спустя секунду», and the second is that unrelated render.
        // This is the cost of the journey no longer being React state — the shared value is
        // what the frame reads, but whether the outgoing tree is mounted at all is still
        // React's to decide, and it was never told. One render, once per journey.
        arrived();
      };
      // **The track travels on a spring of its own with the drop's own parameters**, so the
      // page and the bead arrive together without either being a reader of the other. A date
      // outside the window is not a turn at all — see the parking above.
      const targetIndex = pageWindowRef.current.indexOf(date);
      if (targetIndex < 0) {
        // **A date beyond the track is a jump, not a turn.** The window holds seven days;
        // anything further has no page mounted, so there is nothing to slide to and the
        // day simply never appeared — «если переключаться на даты больше 5 дней вперед или
        // назад, то они не грузятся». Rebuilt around the destination and parked, the page
        // exists before anything asks to see it. There is no animation because there is no
        // continuity to animate: nothing on screen is adjacent to where we are going.
        const jumped = journalPageWindow(date);
        setPageWindow(jumped);
        parkTrack(jumped, date, pageWidth);
      } else if (pageWidth > 0) {
        pageX.value = withSpring(journalPageOffset(targetIndex, pageWidth), {
          ...travelSpring(distanceDays), mass: 1, velocity: 0,
        });
      }
      travel.value = withSpring(at + 1, {
        ...travelSpring(distanceDays),
        mass: 1,
        // Reanimated states one energy threshold where the old spring took a displacement
        // and a speed. `6e-9` is its own default and the trajectory is unchanged; the two
        // thresholds it replaces were the RN defaults written out.
        velocity,
      }, (finished) => {
        'worklet';
        // Once per journey, not per frame: the completion is the only thing that has to
        // cross back to JS, and it carries whether the spring arrived or was replaced.
        runOnJS(settle)(finished === true);
      });
    };

    /**
     * **An interrupted journey starts where the drop is, and it is decided synchronously.**
     *
     * This used to go through `travel.stopAnimation`, whose callback is asynchronous — and
     * nothing stopped a second tap arriving before the first callback had run. Taps then
     * queued up, each building a journey from a position captured before the one ahead of
     * it had moved anything, and `stopAnimation` on a value with no live animation quietly
     * returns the **stale JS copy** rather than the native truth. That is both halves of
     * the report: a tap that appears to do nothing, and then a drop that sets off across
     * the dates by itself, because the spring is walking a range the value was never in.
     *
     * With the position mirrored in JS there is nothing to wait for. One tap, one stop, one
     * journey, in the order they were made.
     */
    // **A shared value is readable now, synchronously and truthfully.** The whole apparatus
    // this replaces — a listener mirroring the native value into a ref, so that an
    // interruption had something honest to read — existed because an `Animated.Value` has no
    // truthful JS copy and `stopAnimation`'s callback is asynchronous. There is nothing left
    // to wait for and nothing left to mirror.
    const at = travel.value;
    const current = journeyRef.current;
    const span = current.inEnd - current.inStart;
    const share = span === 0 ? 1 : (at - current.inStart) / span;
    const reached = current.fromX + (current.toX - current.fromX) * Math.max(0, Math.min(1, share));
    /**
     * **The selection moves now; the journey waits until the day it goes to is whole.**
     *
     * The spring used to start in this handler while the day it carries arrived whenever it
     * arrived — two schedules for one movement. On a cold day the page therefore appeared
     * *at its destination*, because by the time the content existed the spring had already
     * run: «сначала появляется страница, а потом происходит анимация». No amount of easing
     * reaches that, because the animation was never the thing that was late.
     *
     * Moving the selection first is what *starts* the read. The journey is held in a ref and
     * run by the effect below the moment all four reads have answered — the same frame, for
     * a day the prefetch has already warmed, and tens of milliseconds later for one it has
     * not. Either way the page and its content set off together.
     */
    /**
     * **A distant date is brought alongside rather than jumped to.**
     *
     * The track holds seven days, so anything further has no page mounted and there was
     * nothing to slide to — the turn simply did not play. Sliding across the real distance
     * is not the answer either: thirty screens of travel says nothing a person wants to
     * read. Every calendar solves this the same way, by moving **one** screen however far
     * the date is, and that is what a two-page window does — the day being left and the
     * day being gone to, side by side in the direction of travel.
     *
     * Rebuilt here rather than in `begin` because `begin` waits for the day to be whole:
     * by the time it runs, the pages must already be mounted and the track parked on the
     * one being left, so the spring has somewhere to start from and somewhere to arrive.
     */
    if (!pageWindow.includes(date)) {
      const pair = Object.freeze(date > from ? [from, date] : [date, from]);
      setPageWindow(pair);
      pageWindowRef.current = pair;
      parkTrack(pair, from, pageWidth);
    }
    pendingJourney.current = () => begin(reached, at);
    setSelected(date);
  }, [commitJourney, pageWidth, pageWindow, pageX, parkTrack, reduceMotion, scrollToWeek, trackXOf, travel, weekRail, weekRowWidth]);

  /** A journey decided but not yet started, because the day it goes to was not yet whole. */
  const pendingJourney = useRef<(() => void) | null>(null);
  useEffect(() => {
    const start = pendingJourney.current;
    if (start === null || !dayIsWhole) return;
    pendingJourney.current = null;
    start();
    // `shownDay` rather than `dayIsWhole` alone: a warm day is already whole in the render
    // that follows the tap, so the flag never changes and an effect watching only it would
    // never run. What does change is which day is complete.
  }, [dayIsWhole, shownDay]);

  /**
   * A day away, and the strip follows the selection to it.
   *
   * The chevrons move the **selection** by a day and the page gesture moves it by a day,
   * exactly as 1c's interaction table has them. Sliding the strip itself still only
   * browses — that rule came from a device round, and the two coexist because the drop's
   * screen place is a subtraction: the finger browses, a control chooses.
   */
  const jumpTo = useCallback((date: PlannerLocalDate) => {
    setMonthOpen(false);
    travelTo(date);
  }, [travelTo]);

  /**
   * **Today travels.** It used to set the date and scroll the strip, so the drop did not
   * move — it *was* there. It goes through the same one path everything else does now,
   * and from a fortnight away that is the strip paging under a drop that crosses the
   * screen once rather than fourteen times.
   */
  const returnToToday = useCallback(() => {
    setFailure(null);
    if (selectedRef.current === today) {
      scrollToWeek(journalWeekStart(today), true);
      return;
    }
    travelTo(today);
  }, [scrollToWeek, today, travelTo]);

  /**
   * **The page no longer answers a finger, and the whole drag path is gone with it**
   * (owner decision, 2026-08-05).
   *
   * It was an alternative to a control that is already on screen: seven dates, each one
   * tap away, which is what Apple's day view has *not* got and why that one swipes. What it
   * cost is on the record — the axis that stuck for the life of a screen after one vertical
   * scroll, the page pushed a full width off twice, a stretch table read against a hand's
   * pace, a release that rewound, a carousel keyed on element identity because a drag
   * re-renders. Every one of them lived only in this path, and so did the last defect still
   * open on this screen: a page cannot move until React has rendered, and only a gesture
   * needs it to.
   *
   * **Removed rather than finished**, and the difference matters: nothing here is disabled
   * or short-circuited, so there is no dormant half a later change can wake up.
   */

  /**
   * The drop's place, its stretch, and the digits' inversion — all of them this one
   * value, and every one of them native.
   *
   * `dropTrackX` is in the strip's own content coordinates, so the digits' inversion is a
   * subtraction that does not contain the scroll and therefore survives a browse without
   * being recomputed.
   */
  /**
   * **The drop reads the journey itself now, inside a worklet.**
   *
   * Three `interpolate` calls used to be built here and handed down as animated nodes. A
   * shared value is read where it is drawn instead, which is what lets the same value reach
   * a Skia canvas later — and it keeps the rule that mattered: *every* reader is bound to
   * `[inStart, inEnd]` and clamped, because a monotonic value read against `[0, 1]` walks a
   * surface off the screen a width per date change.
   */
  /**
   * The numerals the lens may have to bend, in the strip's own **content** coordinates.
   *
   * Three weeks — the one on screen and its neighbours — because a journey may cross a page
   * boundary and the glass must have something to bend on the far side of it. Twenty-one
   * numerals is a list, not a cost: it is rebuilt when the week changes, never per frame,
   * and a worklet may only close over plain values in the first place.
   */
  const dropDigits = useMemo<readonly DropLensDigit[]>(() => {
    if (weekRowWidth === 0) return [];
    const centre = weekRail.indexOf(weekStart);
    const digits: DropLensDigit[] = [];
    for (const page of [centre - 1, centre, centre + 1]) {
      const start = weekRail[page];
      if (start === undefined) continue;
      journalWeekDates(start).forEach((date, column) => {
        digits.push({
          key: date,
          text: String(plannerLocalDateToDate(date).getDate()),
          // The column's **centre**. The baseline used to be handed over from here as a
          // constant — `round(row / 2 + 6)`, a guessed cap-height ratio — and the lens now
          // measures the glyph's own ink box instead, in both axes.
          x: journalDropTrackX({ column, page, stripWidth: weekRowWidth }),
        });
      });
    }
    return digits;
  }, [weekRail, weekRowWidth, weekStart]);

  /**
   * **A day is never shorter than the pane it stands in, and that is how every calendar
   * built does it.**
   *
   * Reported from the device and measured off `тест7.MP4`: the page lurched **78 px in a
   * single frame**, three times, always the same distance — one block's heading and one
   * plate, about 80 pt. The cause is structural rather than a timing fault: this screen is
   * one vertical scroll with a horizontal carousel inside it, so the carousel's height *is*
   * the height of whichever day is on it. A day with one task fewer is one block shorter,
   * and everything below moves by exactly that much the instant the content commits.
   *
   * Apple's own day view, Fantastical and Google Calendar all avoid this the same way, and
   * none of them does it with animation: **a page is the height of the viewport and its
   * scrolling happens inside it**, so turning a page cannot change any height at all. This
   * is that rule in the smallest form this layout can take it — a floor, measured from the
   * pane rather than assembled from the window and four insets.
   *
   * **What it does not cover, stated rather than discovered:** two days that are *both*
   * taller than the pane and of different heights still differ, and the page will still
   * settle by their difference. That needs the carousel to hold the taller of the two for
   * the length of the turn, which is a second change and is not this one.
   */
  const pageMinHeight = Math.max(0, paneHeight - headerHeight - JOURNAL_PANE_BOTTOM - barClearance);

  /**
   * **The NOW line arrives on the same value the rows do.**
   *
   * Reported from the device: «плашка текущего дня и задачи… появляется на манер старых
   * задач, резко и с рывком». It was the last thing on this screen still changing at the
   * moment of the commit rather than over the length of the journey — the rows had been
   * moved onto `travel` and this had not, so a page that now arrives gently still had one
   * element snapping into place inside it.
   *
   * The same share, the same range, the same clamp: it cannot drift from the list it
   * describes because it is not a second timing, it is the same one read twice.
   */
  const heroArrival = useAnimatedStyle(() => {
    const now = dropSample.value;
    const turning = pageWidth > 0 && !reduceMotion && now.direction !== 0;
    const share = turning
      ? interpolate(travel.value, [now.inStart, now.inEnd], [0, 1], Extrapolation.CLAMP)
      : 1;
    // Never to nothing: this line is alone in the header, so it has nothing to print
    // through and nothing to hand over to — it only has to stop landing hard.
    return { opacity: interpolate(share, [0, 1], [JOURNAL_HERO_ARRIVAL_FLOOR, 1], Extrapolation.CLAMP) };
  }, [pageWidth, reduceMotion]);

  /**
   * **Today arrives and leaves gradually, because it is the only thing a date change makes
   * appear from nothing.** Reported from the device: «рвань проявляется только при каком-то
   * контакте с сегодняшней датой» — and that is exactly right, because the elapsed meter is
   * the one element on this screen whose *existence* depends on which date is chosen. It
   * flipped in a single frame at the moment of the tap, a third of a second before the page
   * it belongs to had finished arriving.
   *
   * One value, on the UI thread, so it cannot fall behind a commit the way the drop's range
   * used to. Reduce Motion takes the end state and no ramp.
   */
  const todayPresence = useSharedValue(dayElapsed === null ? 0 : 1);
  useEffect(() => {
    const target = dayElapsed === null ? 0 : 1;
    todayPresence.value = reduceMotion
      ? target
      : withTiming(target, { duration: JOURNAL_TODAY_FADE, easing: ReanimatedEasing.out(ReanimatedEasing.cubic) });
  }, [dayElapsed, reduceMotion, todayPresence]);
  const arrivingToday = useAnimatedStyle(() => ({ opacity: todayPresence.value }));
  const leavingToday = useAnimatedStyle(() => ({ opacity: 1 - todayPresence.value }));
  /**
   * The last elapsed share this screen actually had, so the meter fades out **as a meter**
   * rather than collapsing to zero width the instant the date stops being today.
   */
  const elapsedHeld = useRef(dayElapsed);
  if (dayElapsed !== null) elapsedHeld.current = dayElapsed;
  const heldElapsed = elapsedHeld.current;

  // ── Opening ──────────────────────────────────────────────────────────────
  /**
   * **The page opens at the top of the day, and nothing scrolls it after that.**
   *
   * It used to open on the part of the day the clock was in, which was right while the
   * day was a timeline: on a scale two screens tall, landing at the top meant landing
   * on hours already spent. A day of three blocks is a short page, and the thing most
   * worth seeing — what has no place yet — now stands at the very top, so scrolling
   * past it to reach «evening» hid the one list that needs a decision.
   *
   * Removed with everything that served it: the pane and content measurements, the
   * per-block tops, the focus token, and `dayJournalFocusScrollOffset` with its own
   * assertions — a measurement apparatus kept for a behaviour nobody wants is dead
   * code that keeps passing its tests.
   *
   * Arriving here still collapses open step lists, which is about state and not scroll:
   * a list left open on Tuesday, seen again on Thursday, shows steps under a day that
   * may not even schedule the thing (PD-TODAY-043).
   */
  useFocusEffect(useCallback(() => {
    setExpanded(new Set());
  }, []));

  // ── Writing ──────────────────────────────────────────────────────────────
  /**
   * A subtask's tick.
   *
   * The line itself writes nothing canonical — it is text with a tick per day. What
   * is canonical is the **item**: closing the last line closes it through the same
   * command a tapped checkbox uses, and reopening a line opens it again, so the
   * item's state can never disagree with the lines that closed it.
   */
  const toggleStep = async (item: DayJournalItem, step: DayJournalStep, date: PlannerLocalDate) => {
    const key = `${item.habitId}:${step.id}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    setFailure(null);
    const closesByChecklist = closure.rules.get(item.habitId) ?? false;
    const result = await setHabitChecklistLineDone({
      checklistItemId: step.id,
      // An item with no canonical action of its own — a measured habit, say — simply
      // is not closed by its lines. Nothing is invented for it.
      closeItem: item.completable
        ? () => recordHabitObservation({ ...item.row.commandContext, value: { type: 'checkbox', booleanValue: true } })
        : async () => ({ ok: true as const, value: null }),
      closesByChecklist,
      done: !step.done,
      habitId: item.habitId,
      itemIsClosed: item.done,
      localDate: date,
      reopenItem: item.completable
        ? () => undoRow(item.row, correctHabitObservation)
        : async () => ({ ok: true as const, value: null }),
    });
    pending.current.delete(key);
    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // **Only this day changes**, so only this day is dropped: the other fifteen held stay
    // warm and a return to one of them reads nothing.
    refreshOccurrences(date);
  };

  const toggleSteps = (habitId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(habitId)) next.delete(habitId); else next.add(habitId);
      return next;
    });
  };

  const toggleSection = (key: DayJournalSectionKey) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    void Haptics.selectionAsync();
  };

  /**
   * The checkbox writes through the canonical commands and nothing else.
   *
   * A measured habit cannot be closed by a tick — a tick invents no quantity — and a
   * derived routine container has no action of its own at all (ADR-007).
   */
  const toggleDone = async (row: SelectedDatePlannerOccurrenceRow, done: boolean, date: PlannerLocalDate) => {
    // A day that is over keeps its record: the control is not drawn, and this is the
    // same rule said again where an accessibility action could otherwise reach it.
    // **The day is the row's own, not the screen's selection** — a page for the 5th is
    // still a page for the 5th while the selection has moved on.
    if (done && date < today) return;
    const key = row.habitId;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    setFailure(null);
    const result = done
      ? await undoRow(row, correctHabitObservation)
      : await recordHabitObservation({ ...row.commandContext, value: { type: 'checkbox', booleanValue: true } });
    pending.current.delete(key);
    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!done && selected < today && !taskHabitIds.has(row.habitId)) {
      setNotice({
        habitId: row.habitId,
        message: `Recorded for ${formatPlannerDateEntry(selected)}. A day cannot be met after it is over, so the record keeps it missed.`,
      });
    }
    refreshOccurrences(date);
  };

  const undoNotice = (habitId: string) => {
    setNotice(null);
    const item = [...day.timed, ...day.anytime].find((candidate) => candidate.habitId === habitId);
    if (item === undefined || !item.done) return;
    // The notice belongs to the page that raised it, which is the one on screen.
    void toggleDone(item.row, true, shownDay.date);
  };

  /**
   * A tap on a title opens the editor, and nothing in between (PD-JOURNAL-001).
   */
  const openEditor = (item: DayJournalItem, date: PlannerLocalDate) => {
    router.push(habitDetailNavigation(item.row.habitId, date));
  };

  const openCreate = () => {
    router.push({ params: { date: selected }, pathname: '/planner/create' });
  };

  /**
   * Creating **into** a part of the day.
   *
   * The block travels as a parameter rather than being chosen again on the next screen:
   * a person who tapped the plus on «Утро» has already said where it goes, and asking
   * twice is the kind of friction that makes a first item never get created.
   */
  const openCreateIn = (block: PlannerDayBlockKey, date: PlannerLocalDate) => {
    router.push({ params: { block, date }, pathname: '/planner/create' });
  };

  /*
   * `plateLead` is deleted with the column it filled.
   *
   * It answered `time ?? duration` — one slot for two facts — which is why no item with
   * a clock time could ever show how long it takes. Both are facts on the plate now
   * (`dayJournalPlateFacts`), stated side by side, and neither has to win.
   */


  const ink = theme.today.primaryText;
  return <View style={[styles.root, { backgroundColor: theme.today.appSurface }]}>
    {/* **No `SafeAreaView`, and that is what the opaque bands were.** It padded the top
        by the status bar and the bottom by the tab bar, so the ground was painted in both
        insets and the glass had nothing to blur there — a visible seam where the header
        stopped. The content runs edge to edge now and each floating surface takes its own
        inset: the header pads its content by `insets.top`, the list reserves the bar. */}
    <View style={styles.safe}>
      {/* **There are two surface levels: the ground and the plate** (PD-PLATE-001).
          The card that used to hold the whole screen is gone, and it is what forced
          everything inside it to be a second plate — a plate lying on a card is a
          third level, and the eye has to learn which of them means what.

          The header keeps a surface of its own until package 3 gives it the blurred
          material it is meant to have; the list below it lies directly on the ground,
          which is the only reason a white plate can be seen at all. */}
      <View style={styles.stage}>
        {/* **The header lifts off the page instead of sitting on it.**
            At the top it is not an object: full width, square corners, no shadow, its
            glass fully transparent — nothing to see because there is nothing under it.
            Scrolling brings it in from the edges by the tab bar's own 14, rounds it to
            the tab bar's own 22, and fades its material in, so the day passes underneath
            blurred rather than under an opaque lid. Every value is a function of the
            scroll offset, so it stops where the finger stops.

            **The month row does not collapse, and the prototype's does.** Recorded as a
            departure: there it was a label and two chevrons, and here it carries «Today»
            and the week arrows. Hiding the way back to today to save 34 pt while
            scrolling costs more than the room is worth. */}
        <View
          onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
          style={[styles.headerLayer, { paddingTop: insets.top }]}
        >
          {/* The plate: already inset and already rounded, and invisible until there is
              something under it to sit over. The blur is mounted once and never rebuilt —
              what changes is this layer's opacity. The clip is a child of the shadow
              because iOS draws no shadow on a view that clips its own overflow. */}
          <Animated.View
            pointerEvents="none"
            // **The plate is only ever seen closed, so it is only ever sized closed.** Its
            // box is a plain number — the header without the month row — and never an
            // animation: open, its opacity is zero and nobody can see that its geometry
            // belongs to the other state. That is the last layout value off the JS thread.
            // **The plate does not take the header's scale, and that is the padding.**
            // Carrying it, the surface shrank at the same rate as the thing standing on it,
            // so the gap between them stayed exactly what it was at rest — nothing. The
            // content pulls in as it scales and the plate holds its width, so the closed
            // header has the same air inside its plate that the open one has against the
            // screen. It still takes `scaleY`, because vertically it does have to follow.
            style={[styles.headerPlate, { opacity: veil, top: insets.top, shadowColor: theme.today.primaryText, transform: [{ translateY: bounce }, { scaleY: plateSquash }] }]}
          >
            <View style={styles.headerPlateClip}>
              <BlurView
                intensity={theme.today.materialBlur}
                style={StyleSheet.absoluteFill}
                tint={theme.dark ? 'dark' : 'light'}
              />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.today.materialFill }]} />
            </View>
          </Animated.View>

          {/* **Everything in the header shrinks as one object, about its own top edge.**
              Scaled element by element they drifted apart — each one shrank about its own
              centre, so the week, the NOW line and the day bar stopped agreeing about
              where the middle of the header was and how wide it was. One wrapper keeps
              them in proportion and centred in both states, which is what the prototype
              had and this did not. */}
          <Animated.View style={[styles.headerShrink, { transform: [{ translateY: bounce }, { scale: headerScale }] }]}>

        {/* 1 · The week: which day is shown, and how to reach another. */}
        {/* **One material, and no band inside it.** The week used to paint its own
            `headerWash` inside the blurred surface, with a hairline under it and the NOW
            line below that — so the head of the screen read as three stacked colour
            strips rather than as one thing. The header is exactly two surfaces now: its
            own material, and the day beneath it. */}
        <View style={styles.weekBand}>
          {/* **The month goes into itself, and the band closes over it.** Fading it in place
              left its 34 pt standing empty, which is why the first build looked as though
              nothing had happened. The inner view keeps its natural height whatever the
              clipping parent does, so the measurement it reports is stable. */}
          {/* **Two views, one driver each, and that is not a style choice.** The height comes
              off the JS thread and the fade off the native one; on a single view React Native
              moves the whole style node to the native driver and then refuses the height with
              «Attempting to run JS driven animation on animated node that has been moved to
              native» — a red box, reported from the device. Splitting the values was not
              enough; the views have to be split too. */}
          <Animated.View style={[styles.monthCollapse, { opacity: headerMonthFade, transform: [{ scaleY: headerSquash }] }]}>
              <View
                onLayout={(event) => { const measured = event.nativeEvent.layout.height; setMonthRowHeight((previous) => (previous === measured ? previous : measured)); }}
                style={styles.weekTop}
              >
              {/* The month **is** the control: a chevron beside it was one more thing to
                  aim at and one more thing for the longest month to run under. */}
              <Pressable
                accessibilityHint="Opens the calendar"
                accessibilityLabel={weekMonth}
                accessibilityRole="button"
                onPress={() => setMonthOpen(true)}
                style={styles.monthButton}
              >
                {/* **The calendar's own fade, on the calendar's own component.**
                    What was refused here was `FlipLabel` — a word typed out letter by
                    letter, «колхозно и устаревше», and that refusal stands. This is a
                    different animation and the owner asked for it here after seeing it on
                    the full-screen calendar: one fade, one value, the word travelling the
                    way the week went, native driver, nothing in layout. **One module
                    serves both**, so the two surfaces cannot drift into showing a month
                    change two different ways. The room is still reserved, so the control
                    beside it does not shift when a long month arrives. */}
                <MonthTitle
                  heading={monthHeading}
                  lineHeight={JOURNAL_MONTH_LABEL_LINE}
                  reservedWidth={JOURNAL_MONTH_LABEL_WIDTH}
                  text={weekMonth}
                  textStyle={monthLabelStyle}
                />
              </Pressable>
              <View style={styles.spacer} />
              {selected === today && weekStart === journalWeekStart(today) ? null : <Pressable
                accessibilityHint="Returns to the current day"
                accessibilityLabel="Today"
                accessibilityRole="button"
                onPress={returnToToday}
                style={[styles.todayAction, { borderColor: theme.today.system }]}
              >
                <Text
                  maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
                  style={[styles.todayActionText, { color: theme.today.system }]}
                >Today</Text>
              </Pressable>}
              {/* **The chevrons are gone** (owner instruction, 2026-08-05: «нам точно не
                  нужны стрелочки как механизм переключения дат»). They were the fourth way
                  to reach a date on a header that shows seven of them a tap away, and they
                  were 22 pt targets under a 13 pt glyph — the smallest controls on the
                  screen for the least necessary job.

                  They were also **lying about what they did**: both spoke as «Previous
                  week» and «Next week» to a screen reader and moved the selection by a
                  *day*. That was true for as long as they existed and nothing caught it,
                  because a spoken label is read by nobody who can see the arrow. */}
            </View>
          </Animated.View>

          {/* **Everything under the month slides up over its box.** The row's space is not
              freed — nothing in this header changes layout any more — so the translate takes
              back exactly the height the row was standing in, and the picture is the same
              one the height animation drew, with no reflow under it and no frame to miss. */}
          <Animated.View style={{ transform: [{ translateY: headerShift }] }}>
            <View
              onLayout={(event) => {
                setStripWidth(event.nativeEvent.layout.width);
                setWeekRowWidth(event.nativeEvent.layout.width);
              }}
              style={styles.weekRow}
            >
              {/* **One drop, over the strip rather than inside a page of it.** It used
                  to be a child of whichever week held the selection, which is why it
                  could only ever be born and killed at a week boundary instead of
                  crossing one. Here its screen place is its place in the strip's content
                  minus the scroll — both natively bound, so browsing and travelling are
                  the same subtraction. */}
              {weekRowWidth === 0 ? null : <DateDrop columnWidth={journalWeekColumnWidth(weekRowWidth)} digits={dropDigits} sample={dropSample} scrollX={scrollX} trackX={dropTrackX} travel={travel} />}
              {stripWidth === 0 ? null : <Reanimated.FlatList
                data={weekRail}
                getItemLayout={(_unused, index) => ({ index, length: stripWidth, offset: stripWidth * index })}
                horizontal
                initialScrollIndex={Math.max(0, weekIndex(weekStart))}
                keyExtractor={(week: PlannerLocalDate) => week}
                onMomentumScrollEnd={settleWeek}
                // Native, and it has to be: a scroll handler on the JS thread is what the
                // header's own five rules exist to forbid, and this one is read by every
                // digit in the strip.
                onScroll={stripScroll}
                pagingEnabled
                ref={strip}
                scrollEventThrottle={16}
                renderItem={({ item, index: page }: { item: PlannerLocalDate; index: number }) => {
                  const dates = journalWeekDates(item);
                  // **Fourteen points of air under a week with nothing in it.** The marks band is a
                  // fixed height under every date, so a week whose days carry no tasks reserves it
                  // anyway — and that reserve is the gap between the dates and the line below them.
                  // Judged per **week**: per cell the seven columns would come out ragged.
                  const weekHasMarks = dates.some((date) => (taskMarks.get(date) ?? EMPTY_MARKS).length > 0);
                  return <View style={[styles.weekPage, { width: stripWidth }]}>
                    {dates.map((date, index) => <DateCell
                      // Where this cell stands in the strip's own content, which is the
                      // coordinate the drop travels along — so «is the glass over me?» is a
                      // subtraction of two numbers in the same space, on the UI thread.
                      cellX={journalDropTrackX({ column: index, page, stripWidth: weekRowWidth })}
                      date={date}
                      // Both sides of this are the strip's content coordinates, so the
                      // difference does not contain the scroll: a value that is right
                      // while the week is browsed without being recomputed for it.
                      key={date}
                      letter={JOURNAL_WEEKDAY_LETTERS[index]}
                      marks={taskMarks.get(date) ?? EMPTY_MARKS}
                      reserveMarks={weekHasMarks}
                      onPress={() => travelTo(date)}
                      selected={date === selected}
                      today={date === today}
                      trackX={dropTrackX}
                    />)}
                  </View>;
                }}
                showsHorizontalScrollIndicator={false}
                windowSize={3}
              />}
            </View>

            {/* **The card became a line** (PD-PLATE-006). Six packages of a surface whose
                recurring fault was that it repeated the list: it carried a kicker, a rank
                pill, a counter, a control, a row of chips and a queue, all of which the
                rows below already said. What it knew that the list did not is *what is
                next and how far away it is*, and that is one line.

                **The kicker says `NOW` at last.** It could not before: naming the item
                the clock is inside needs `start ≤ now < end`, and five packages recorded
                the missing end as the reason (PD-TODAY-058, `-069`, `-098`). Schema v13
                stores the length, so the state is arithmetic over two stored values —
                and where nothing is running it still says `NEXT`, or `FREE` when the run
                ahead is long enough by the list's own threshold. */}
            {/* **A line that is only a count is not a line.** Where the hero has no subject
                and no timer it printed «3 LEFT» and nothing else, directly above a day row
                already stating the day's arithmetic — the same sentence twice, twenty points
                apart, which is PD-TODAY-119 in the one case it did not cover. The prototype
                has one row here and so does this now. */}
            {/* **The row keeps its room whether or not it has anything to say.**
                It used to be rendered conditionally, so moving to or from today unmounted
                it in one frame and took its height out of the header's measured box —
                which is `paddingTop` on the pane, so the whole list jolted with it.
                Measured off `тест4.MP4`: the top of the list moved **16 px in a single
                frame, twelve times in twenty-seven seconds**.

                Nothing in this header may animate layout — the rule the header was built
                on and paid for frame by frame — so the row cannot shrink smoothly either.
                It is reserved instead, and only its contents come and go. **Priced:** a day
                with nothing running carries an empty band of `JOURNAL_NOW_ROW`. Against a
                16 px jolt on every arrival at today, a static band is the cheaper fault,
                and it is the same trade the marks band under the dates already makes. */}
            <View style={styles.nowRow}>
              {hero === null || (hero.kind === 'behind' && hero.subject === null && hero.timerMinutes === null)
                ? null
                : <Reanimated.View style={[styles.nowLine, heroArrival]}>
              <Text
                maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
                style={[styles.nowKicker, { color: theme.today.system }]}
              >{hero.kind === 'closed'
                  ? 'DAY CLOSED'
                  : hero.kind === 'behind' ? `${hero.openCount} LEFT`
                    : hero.kind === 'running' ? 'NOW' : hero.freeIsWorthSaying ? 'FREE' : 'NEXT'}</Text>
              {hero.subject === null ? null : <Text
                numberOfLines={1}
                style={[styles.nowSubject, { color: theme.today.primaryText }]}
              >{hero.subject.title}</Text>}
              <View style={styles.spacer} />
              {/* **The day's counter is the list's and is printed once** (PD-TODAY-119):
                  `DAY … 10 of 11 done` and a card's own band printed the same sentence
                  40 pt apart. What this says is the one thing the list does not — how
                  far away the next thing is — and where there is no next thing it says
                  nothing at all rather than borrowing a sentence. */}
              {/* **A running item counts down what is left; anything ahead counts up to
                  its start.** The share is drawn as a hairline under the line rather than
                  as a number, because «61 %» is a figure nobody acts on while a bar says
                  the same thing at a glance and costs no words. */}
              {hero.timerMinutes === null ? null : <Text
                maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
                numberOfLines={1}
                style={[styles.nowNext, { color: theme.today.secondaryText }]}
              >{hero.kind === 'running'
                  ? `${journalDurationLabel(hero.timerMinutes)} left`
                  : `in ${journalDurationLabel(hero.timerMinutes)}`}</Text>}
              {/* **The offer moved onto the blocks.** It used to stand here because the
                  axis had free stretches to fill and a minute to fill them with; a block
                  has neither — placing something is choosing a part of the day, and the
                  key that does it belongs on the part. What the line keeps is what only
                  it can say: what is happening and how far away the next thing is. */}
            </Reanimated.View>}
            {picking === null ? null : <View style={styles.pickList}>
              {anytimeOptions.map((option) => (
                <Pressable
                  accessibilityRole="button"
                  key={option.habitId}
                  onPress={() => {
                    setPicking(null);
                    router.push({
                      params: { date: selected, id: option.habitId, time: journalLocalTimeOfMinute(picking) },
                      pathname: '/planner/edit/[id]',
                    });
                  }}
                  style={[styles.pickRow, { backgroundColor: theme.today.dashboardSurface }]}
                >
                  <CategoryChip
                    accentKey={option.accentKey}
                    categoryKey={option.categoryKey}
                    identity={option.row.visualIdentity.iconIdentity}
                    kind={option.kind}
                    size={18}
                  />
                  <Text numberOfLines={1} style={[styles.pickText, { color: theme.today.primaryText }]}>{option.title}</Text>
                </Pressable>
              ))}
            </View>}
            </View>
            {hero === null || (hero.runningShare ?? hero.waitShare ?? null) === null ? null : <NowProgress
              running={hero.runningShare !== null}
              share={hero.runningShare ?? hero.waitShare ?? 0}
            />}

            {/* **The day's own metric belongs to the day's own surface.** It used to be the
                first thing in the list, so on scroll the calendar lifted and this stayed —
                two halves of one band on two different surfaces, which is exactly how it
                read on the device. It rides with the header now. */}
          {/* 4 · The day header, which is where the arithmetic lives precisely
              because nothing in it moves. */}
          {/* **Everything here describes the chosen day, so it arrives when the day does.**
              Measured off `тест2.MP4`, frames 46–52 and 128–134: the caption flipped from
              `DAY CLOSED` to `THE DAY AHEAD` — and the meter with it — a whole frame *before*
              the list began to move, while the rows were still the previous day's and still
              standing still. The header is an ordinary render and commits synchronously; the
              list's position is an animated style and lands on the next frame. That gap
              cannot be closed in time, but it can be made invisible: dimmed to
              `JOURNAL_HERO_ARRIVAL_FLOOR` and brought up over the journey, the words change
              while nobody is reading them and finish exactly when the day they describe has
              arrived. */}
          <Reanimated.View style={[styles.dayHeader, heroArrival]}>
            {/* **The caption reserves the width of the widest thing it can say.**
                Reported from the device as a tear that only ever appears on contact with
                today: this swaps `THE DAY AHEAD` for `DAY` — about 92 pt for 21 at 10/600
                with a point of letterspacing — and the meter beside it is `flex: 1`, so the
                bar's *length* jumped by some seventy points in a single frame while the page
                was still sliding. No fade reaches that, because it is geometry.
                **The reserve is a rendered copy, not a number.** A `minWidth` would be a
                measurement of a font this file cannot make, wrong at every text size but the
                default and at every future wording; an invisible copy of the longer caption
                is exactly as wide as the caption really is, in whatever face and scale the
                phone is using. */}
            <View style={styles.eyebrowSlot}>
              <Text
                aria-hidden
                maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
                style={[styles.eyebrow, styles.eyebrowReserve]}
              >{JOURNAL_DAY_CAPTION_WIDEST}</Text>
              <Text
                maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
                style={[styles.eyebrow, styles.eyebrowLabel, { color: theme.today.tertiaryText }]}
              >{nowMinuteOfDay === null ? JOURNAL_DAY_CAPTION_AHEAD : JOURNAL_DAY_CAPTION_TODAY}</Text>
            </View>
            {/* **It looked like a meter and was a divider, so it is a meter now.**
                A hairline of that weight, lying between a label and a number, reads
                as an empty trough — the owner reported it as «the bar does not work
                at all», which is a fair reading of a thing that was never a bar. It
                measures from 04:00, the boundary the blocks use, so the bar and the
                list beneath it describe one day. On any other date there is no
                elapsed part and it stays the hairline it was. */}
            {/* **Both states are always mounted and cross-fade in one fixed box.**
                Reported from the device: the tear only ever appears on contact with today,
                because this is the only thing on the screen that changes when a date crosses
                it — and it changed in a single frame, at the moment of the tap, while the
                page beneath was still sliding. Held open and faded, the hairline becomes a
                filled meter over `JOURNAL_TODAY_FADE` instead of instead of at once, and
                the box around them never resizes, so nothing beside them moves either. */}
            <View style={styles.dayMeter}>
              <Reanimated.View style={[styles.dayRuleLayer, { backgroundColor: withAlpha(ink, 0.09) }, leavingToday]} />
              <Reanimated.View
                accessibilityLabel={heldElapsed === null ? undefined : `${Math.round(heldElapsed * 100)} % of the day gone`}
                accessibilityRole={dayElapsed === null ? 'none' : 'progressbar'}
                accessibilityValue={heldElapsed === null ? undefined : { max: 100, min: 0, now: Math.round(heldElapsed * 100) }}
                style={[styles.dayTrack, { backgroundColor: withAlpha(ink, 0.09) }, arrivingToday]}
              >
                {/* The last elapsed share is **held**, so the meter has something to fade out
                    with. Without it the width would collapse to zero at the same instant the
                    opacity started, which is the hard change wearing a slower coat. */}
                <View style={[styles.dayFill, { backgroundColor: theme.today.structFill, width: `${((heldElapsed ?? 0) * 100).toFixed(1)}%` as DimensionValue }]} />
              </Reanimated.View>
            </View>
            {/* **One figure, and it is what is left.** The row printed «N of M done» and
                «N overdue» side by side, above a line that printed the open count again —
                three statements of the same day, two of them about failure, on a screen
                whose own rule is that it never states one (DIA-2). The prototype states one
                thing here and it is «осталось N»; every late row already says it is late,
                in its own words and its own colour. */}
            {tally.total - tally.done === 0
              ? null
              : <Text
                maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
                style={[styles.tally, { color: tally.overdue === 0 ? theme.today.secondaryText : theme.today.attentionText }]}
              >{`${tally.total - tally.done} left`}</Text>}
          </Reanimated.View>
          </Animated.View>
            </View>
          </Animated.View>
        </View>

        {/* 3 · The list. */}
        {/* The day's content follows the finger, and the drop is drawn from the same
            `dx` in the same frame — so what moves under the hand and what pours above it
            are one gesture rather than two things that agree by timing. */}
        <View
          onLayout={(event) => {
            setPageWidth(event.nativeEvent.layout.width);
            setPaneHeight(event.nativeEvent.layout.height);
          }}
          style={styles.paneHolder}
        >
          <Animated.ScrollView
            // The room the header used to occupy in flow is now padding, measured from
            // the header itself rather than added up from constants — its height follows
            // the text scale, and a reconstructed number would be wrong the first time
            // somebody enlarges type.
            contentContainerStyle={[styles.pane, { paddingBottom: JOURNAL_PANE_BOTTOM + barClearance, paddingTop: headerHeight }]}
            // The binding is native — the glass is opacity and nothing else, so it costs
            // no layout and can answer the first pixel. The listener alongside it decides
            // the collapse and the bounce; neither touches this value.
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
              listener: onDayScroll,
              useNativeDriver: true,
            })}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            {/* **Seven days side by side; a turn slides the track and nothing else.**
                Each page owns its date for its whole life and reads its own day, so a change
                of date rewrites no content anywhere — which is precisely why the position and
                the content can no longer disagree. */}
            <DayCarousel minHeight={pageMinHeight}>
              <Reanimated.View style={[styles.pageTrack, { width: pageWidth * pageWindow.length }, pageTrack]}>
                {pageWindow.map((date) => <View key={date} style={[styles.pageSlot, { width: pageWidth }]}>
                  <DayPage
                    active={date === shownDay.date}
                    clockLocalTime={clock.localTime}
                    collapsed={collapsed}
                    date={date}
                    expanded={expanded}
                    failure={failure}
                    notice={notice}
                    onCreateIn={openCreateIn}
                    onOpenEditor={openEditor}
                    onRetry={refreshOccurrences}
                    onToggleDone={(item, on) => void toggleDone(item.row, item.done, on)}
                    onToggleSection={toggleSection}
                    onToggleStep={(item, step, on) => void toggleStep(item, step, on)}
                    onToggleSteps={toggleSteps}
                    onUndoNotice={undoNotice}
                    today={today}
                  />
                </View>)}
              </Reanimated.View>
            </DayCarousel>
          </Animated.ScrollView>
        </View>
      </View>
    </View>

    {/* 7 · The one way to create, and it is one tap. It stands above the bar rather
        than level with it, and the pane reserves its own room for it. */}
    {/* **The one glass surface that is a control.** It was a solid disc of `structFill`,
        which in graphite is ink — a white puck on a black page, and the last opaque thing
        floating over the list. It wears the same material as the header and the bar now:
        a real blur of what is under it, the shared `structGlass` tint, and a hairline,
        which is what gives a translucent shape an edge. The glyph moves to `primaryText`
        with it — `onAccent` is the colour for something drawn *on* a fill, and there is no
        fill any more. */}
    <Pressable
      accessibilityHint="Opens the create screen for the day you are looking at."
      accessibilityLabel="Create"
      accessibilityRole="button"
      onPress={openCreate}
      style={[styles.fab, {
        borderColor: theme.today.hairline,
        borderWidth: StyleSheet.hairlineWidth,
        bottom: barClearance + JOURNAL_FAB_LIFT,
        shadowColor: ink,
      }]}
    >
      <BlurView
        intensity={theme.today.materialBlur}
        style={[StyleSheet.absoluteFill, styles.fabMaterial]}
        tint={theme.dark ? 'dark' : 'light'}
      />
      <View style={[StyleSheet.absoluteFill, styles.fabMaterial, { backgroundColor: theme.today.structGlass }]} />
      <FabGlyph />
    </Pressable>

    <JournalCalendarScreen
      onClose={() => setMonthOpen(false)}
      onSelect={jumpTo}
      selectedDate={selected}
      today={today}
      visible={monthOpen}
    />
  </View>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The day bar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The name of a part of the day, as a person says it.
 *
 * Words rather than hours, deliberately. `4:00 — 12:00` is a range somebody has to check
 * themselves against; «Утро» is where they already know they are, and the whole point of
 * the block is that it needs no arithmetic.
 */
const BLOCK_LABELS: Readonly<Record<PlannerDayBlockKey, string>> = Object.freeze({
  morning: 'Morning',
  day: 'Afternoon',
  evening: 'Evening',
});

/**
 * «Когда угодно», folded by the same chevron as the three parts of the day.
 *
 * **It replaces a partial disclosure with a whole one.** The header used to offer «ещё 3»
 * and show only the first two items — a different affordance from the blocks below it,
 * appearing only past a threshold, and one that left the reader unable to fold the
 * section away at all. Owner instruction of 2026-08-05 is that all four sections carry
 * the same arrow, so the two-row cap and its slice are withdrawn: what is shown is
 * everything or nothing, and the count in the heading always agrees with it.
 *
 * It carries no plus button. A block's plus places an item *in that part of the day*, and
 * «когда угодно» is the absence of one — the FAB already creates without a block.
 */
function AnytimeHeader({ count, overdueCount, collapsed, onToggle }: {
  readonly count: number;
  readonly overdueCount: number;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}) {
  const theme = useLifePlannerTheme();
  return <View style={styles.dayHeader}>
    <Pressable
      accessibilityHint={collapsed ? 'Expands this section.' : 'Collapses this section.'}
      accessibilityLabel={[
        'Anytime',
        `${count}`,
        overdueCount === 0 ? null : `${overdueCount} overdue`,
      ].filter((part) => part !== null).join(', ')}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      hitSlop={{ bottom: 8, top: 8 }}
      onPress={onToggle}
      style={styles.blockDisclosure}
    >
      <Ionicons
        color={theme.today.tertiaryText}
        name={collapsed ? 'chevron-forward' : 'chevron-down'}
        size={14}
      />
      <Text
        maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
        style={[styles.eyebrow, { color: theme.today.tertiaryText }]}
      >{`ANYTIME · ${count}`}</Text>
      {overdueCount === 0 ? null : <Text
        maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
        style={[styles.blockOverdue, { color: theme.today.attention }]}
      >{`${overdueCount} overdue`}</Text>}
    </Pressable>
    <View style={[styles.headerRule, { backgroundColor: withAlpha(theme.today.primaryText, 0.09) }]} />
  </View>;
}

/**
 * A part of the day, named, counted, and offering a way in.
 *
 * The counter says `2 / 5` rather than a bare total, because a number that only ever
 * grows says nothing about the day; the pair says how much of this part is behind you.
 * It is deliberately not a bar — a progress bar on a part of a day invites finishing it
 * for the bar's sake, and there is nothing here worth optimising against.
 */
function BlockHeader({ section, current, collapsed, onAdd, onToggle }: {
  readonly section: DayBlockSection;
  /** The clock is standing in this part of the day. */
  readonly current: boolean;
  readonly collapsed: boolean;
  readonly onAdd: () => void;
  readonly onToggle: () => void;
}) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  const duration = blockDurationLabel(section.plannedMinutes);
  const label = BLOCK_LABELS[section.block];

  return <View style={styles.blockHeader}>
    {/* **The name and its counts are the disclosure control.** A chevron alone is a 16 pt
        target beside a 44 pt one; the whole leading group is pressable, so the thing a
        finger actually aims at — the word «Утро» — is the thing that answers. The plus
        keeps its own target at the far side and the two cannot overlap. */}
    <Pressable
      accessibilityHint={collapsed ? 'Expands this part of the day.' : 'Collapses this part of the day.'}
      accessibilityLabel={[
        label,
        section.count === 0 ? 'empty' : `${section.doneCount} of ${section.count}`,
        section.overdueCount === 0 ? null : `${section.overdueCount} overdue`,
      ].filter((part) => part !== null).join(', ')}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      hitSlop={{ bottom: 8, top: 8 }}
      onPress={onToggle}
      style={styles.blockDisclosure}
    >
      <Ionicons
        color={theme.today.tertiaryText}
        name={collapsed ? 'chevron-forward' : 'chevron-down'}
        size={14}
      />
      <Text
        maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
        style={[styles.blockName, { color: current ? theme.today.system : ink }]}
      >{label}</Text>
      {section.count === 0 ? null : <Text
        maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
        style={[styles.blockCount, { color: theme.today.secondaryText }]}
      >{`${section.doneCount} / ${section.count}`}</Text>}
      {/* **Lateness is counted at the heading and nowhere else in the list.** It is where
          it is actually noticed, it costs the plates nothing, and a collapsed block still
          says that something under it is behind — which is the whole reason a collapse is
          safe to offer at all. */}
      {section.overdueCount === 0 ? null : <Text
        maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
        style={[styles.blockOverdue, { color: theme.today.attention }]}
      >{`${section.overdueCount} overdue`}</Text>}
      {/* How long this part of the day is spoken for, where anybody has said. It is the
          sum of the lengths actually stated, so a block of unmeasured things says
          nothing rather than «0 м». */}
      {duration === null ? null : <Text
        maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
        style={[styles.blockDuration, { color: theme.today.tertiaryText }]}
      >{duration}</Text>}
    </Pressable>
    <View style={[styles.headerRule, { backgroundColor: withAlpha(ink, 0.09) }]} />
    <Pressable
      accessibilityLabel={`Add to ${label.toLowerCase()}`}
      accessibilityRole="button"
      hitSlop={12}
      onPress={onAdd}
      style={styles.blockAdd}
    >
      <Ionicons color={theme.today.secondaryText} name="add" size={16} />
    </Pressable>
  </View>;
}

/**
 * **The plate, led by its mark.**
 *
 * `[3 rank spine][mark 32][10][title, then its facts][10][checkbox 24]`
 *
 * A 44 pt time column used to stand ahead of the mark, reserved whether or not the item
 * had a minute — so on the majority of plates, which have none, the title began 54 pt in
 * for nothing. The column was held so the marks behind it would stand on one vertical;
 * with the mark leading, the mark **is** that vertical.
 *
 * The facts stand in a row under the title, in the order the owner asked for on
 * 2026-08-05: time → duration → reminder → steps. They used to compete for one lead slot
 * and one second line, and three of the five lost silently — no item with a clock time
 * could show its length, and nothing overdue or with steps could show its reminder.
 *
 * **Rank is a spine as well as a weight.** PD-PLATE-005 gave it weight and a critical dot;
 * PD-TODAY-143 then made rank the leading edge on the axis after a device report, and the
 * axis is gone but the finding is not. Low and normal draw no spine and stay deliberately
 * indistinguishable — a marker beside every item ranks nothing.
 */
function Plate({ item, expanded, closesByChecklist, onToggle, onToggleSteps, onStepToggle, onOpen }: {
  readonly item: DayJournalItem;
  readonly expanded: boolean;
  /**
   * Its last line closes it, so it has **no checkbox of its own**.
   *
   * That is the whole of the split: an item closed by its lines is closed by ticking
   * them, and an item closed by hand has lines that are its own business.
   */
  readonly closesByChecklist: boolean;
  readonly onToggle: () => void;
  readonly onToggleSteps: () => void;
  readonly onStepToggle: (step: DayJournalStep) => void;
  readonly onOpen: () => void;
}) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  const tap = useDeliberateTap(onOpen);
  const facts = dayJournalPlateFacts(item);
  const important = item.importance === 'high' || item.importance === 'critical';
  const spine = item.importance === 'critical'
    ? theme.today.attention
    : item.importance === 'high' ? theme.today.rankHigh : null;
  const spoken = [
    item.title,
    IMPORTANCE_LABELS[item.importance].toLowerCase(),
    item.overdue ? 'overdue' : null,
    ...facts.filter((fact) => fact.kind !== 'steps').map((fact) => fact.text),
  ].filter((part) => part !== null).join(', ');

  return <View style={[styles.plate, {
    // **No hero plate in this package.** The palette carries `heroSurface` and the
    // proposal drew a structural plate for «the item the clock is inside», but that state
    // is `start ≤ now < end` and **no item stores an end** (PD-CREATE-020) — the same
    // reason the NOW card above has no `running` state for most items. A surface built on
    // a fact nothing records would be a guess with a colour.
    backgroundColor: theme.today.dashboardSurface,
    // **A hairline, and it is the only thing that draws a plate's edge in Dark.** The
    // plate carried `borderColor: 'transparent'` and a shadow, and in Dark that shadow is
    // black at 10 % on a near-black ground — so the boundary of an item was drawn by
    // nothing at all, at 1.11:1 against the page. It is still not one of PD-PLATE-001's
    // two *state* borders: those are the 2 pt selection ring and the dashed drop slot,
    // and this is the plate's own edge at hairline weight.
    borderColor: theme.today.hairline,
    shadowColor: theme.dark ? '#000000' : ink,
  }]}
  >
    {/* Rank, drawn inside the plate's own clip so it takes the plate's radius. */}
    {spine === null ? null : <View style={[styles.plateSpine, { backgroundColor: spine }]} />}

    <View style={[styles.plateRow, spine === null ? null : { marginLeft: PLATE_RANK_SPINE }]}>
      <CategoryChip
        accentKey={item.accentKey}
        categoryKey={item.categoryKey}
        identity={item.row.visualIdentity.iconIdentity}
        kind={item.kind}
        size={PLATE_MARK}
      />

      {/* **The text column reserves nothing.** No fixed height and no slot held for a
          facts line that may not exist: an empty box still earns the column's gap, and
          that reservation is exactly what hung the title against the top edge. */}
      <View style={styles.plateWords}>
        <Pressable
          accessibilityHint="Opens the editor"
          accessibilityLabel={spoken}
          accessibilityRole="button"
          onPressIn={tap.onPressIn}
          onPressOut={tap.onPressOut}
          style={styles.plateTitleRow}
        >
          {/* **A met title is not struck through**, and the proposal that drew one was
              wrong about this surface: a struck row reads as cancelled where the day
              means it was met, and the item stays exactly where it is rather than moving
              into a done bin. Completion is the checkbox and the muted ink. */}
          <Text numberOfLines={1} style={[styles.plateTitle, {
            color: item.done ? theme.today.secondaryText : ink,
            fontWeight: important ? '600' : '400',
          }]}
          >{item.title}</Text>
          {item.importance === 'critical'
            ? <View style={[styles.criticalDot, { backgroundColor: theme.today.attention }]} />
            : null}
        </Pressable>
        {facts.length === 0 ? null : <PlateFacts
          expanded={expanded}
          facts={facts}
          onToggleSteps={onToggleSteps}
        />}
      </View>

      {/* **An item closed by its lines carries no checkbox**: ticking the lines is how
          it closes, and a second control beside them could only disagree with them. */}
      {closesByChecklist ? null : <View style={styles.plateCheck}><Checkbox
        color={theme.today.completion}
        completable={item.completable}
        done={item.done}
        locked={!item.reopenable}
        measured={item.measured}
        onPress={onToggle}
        size={PLATE_CHECKBOX}
      /></View>}
    </View>

    {/* **The steps open inside the plate, under the title and at its leading edge.**
        No new box appears; the plate grows. The indent is derived from the columns it
        has to clear rather than restated, so it follows them when they move. */}
    {!expanded ? null : <View style={[styles.plateSteps, { marginLeft: PLATE_MARK + PLATE_ROW_GAP + (spine === null ? 0 : PLATE_RANK_SPINE) }]}>
      {item.steps.map((step) => <StepRow
        color={theme.today.completion}
        // **A line repeats its parent.** Behind the parent's minute and still open, it
        // is dull — which covers the case the row's own state cannot describe: a closed
        // item whose hour has gone, with a line inside it left unticked.
        dulled={item.elapsed && !step.done}
        key={step.id}
        onToggle={() => onStepToggle(step)}
        step={step}
      />)}
    </View>}
  </View>;
}

/**
 * The facts, on one line, separated by a middot — and the steps counter is a control.
 *
 * **Everything here is `secondaryText` or the alarm, and never `tertiaryText`.** The first
 * draft set the whole line in `ink3`, which measures 3.02:1 in Light: a mark's threshold,
 * not a label's, and this line is labels. What separates a start time from the bell time
 * beside it is **weight** — 600 on the clock, regular on the rest — plus the bell's own
 * glyph, so the distinction survives at one colour and one size.
 *
 * `flexWrap` rather than truncation: at the largest text sizes four facts do not fit a
 * phone's width, and a plate that grows a line is right where a plate that hides a fact is
 * not.
 */
function PlateFacts({ facts, expanded, onToggleSteps }: {
  readonly facts: readonly DayJournalFact[];
  readonly expanded: boolean;
  readonly onToggleSteps: () => void;
}) {
  const theme = useLifePlannerTheme();
  const late = (kind: DayJournalFactKind) => kind === 'late';
  return <View style={styles.plateFacts}>
    {facts.map((fact, index) => <View key={fact.kind} style={styles.plateFact}>
      {index === 0 ? null : <Text style={[styles.plateFactDot, { color: theme.today.tertiaryText }]}>·</Text>}
      {fact.kind === 'reminder'
        ? <Ionicons color={theme.today.secondaryText} name="notifications-outline" size={11} />
        : null}
      {fact.kind === 'steps'
        ? <Pressable
          accessibilityLabel={expanded ? 'Hide steps' : `Show steps, ${fact.text}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          // **Vertical only**, as it has always been: a horizontal slop overlaps
          // invisibly, and this counter now stands beside other facts rather than alone
          // on a row. 18 pt of line reaches 44 with 13 either side, and the checkbox
          // stands in its own 44 pt column at the far edge — so the two extended areas
          // cannot meet and a near-miss can never tick the wrong thing.
          hitSlop={{ bottom: PLATE_STEPS_SLOP, top: PLATE_STEPS_SLOP }}
          onPress={onToggleSteps}
          style={styles.plateFactSteps}
        >
          <Text style={[styles.plateFactText, { color: theme.today.secondaryText }]}>{fact.text}</Text>
          <Ionicons color={theme.today.secondaryText} name={expanded ? 'chevron-up' : 'chevron-down'} size={11} />
        </Pressable>
        : <Text
          numberOfLines={1}
          style={[styles.plateFactText, {
            color: late(fact.kind) ? theme.today.attention : theme.today.secondaryText,
            fontWeight: fact.kind === 'time' ? '600' : '400',
          }]}
        >{fact.text}</Text>}
    </View>)}
  </View>;
}
/*
 * There is no separate Anytime row any more.
 *
 * It existed to draw `—` where a start would be, back when a plate's whole identity was
 * its minute. With blocks, having no minute is ordinary — most items do not have one —
 * so an item with no block is the same plate standing under a different heading, and one
 * component draws every item on the screen.
 */

function StepRow({ step, color, dulled, onToggle }: {
  readonly step: DayJournalStep;
  /** The parent's own category colour: a line's box is filled with it, never its own. */
  readonly color: string;
  /** The parent's minute has gone and this line is still open. */
  readonly dulled: boolean;
  readonly onToggle: () => void;
}) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  const met = useMetFade(step.done);
  // A line is always tickable: it has no schedule, no lifecycle and no action
  // availability to read — it is text and a box. Alone on its row it may take a slop
  // to a 44 pt target, because there is no neighbour for the slop to overlap.
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked: step.done }}
    hitSlop={{ bottom: 8, left: 8, right: 8, top: 8 }}
    onPress={onToggle}
    style={styles.stepRow}
  >
    {/* **The box leads the line, at the title's own leading edge.** A checklist is
        read down its boxes, so they stand in one column under the title they belong
        to rather than at the far side of the plate. */}
    <View style={[styles.stepBox, { borderColor: theme.today.tertiaryText }]}>
      <Animated.View style={[styles.stepBoxMet, { backgroundColor: color, opacity: met }]}>
        <Ionicons color={theme.today.onAccent} name="checkmark" size={10} />
      </Animated.View>
    </View>
    <Text
      numberOfLines={1}
      style={[styles.stepTitle, {
        // **The same three weights the rows use.** Done keeps its own muted tone,
        // a line behind its parent's minute is dull, and one still ahead is ordinary
        // ink — so a checklist reads by exactly the rule the list above it reads by.
        color: step.done || dulled ? theme.today.secondaryText : ink,
      }]}
    >{step.title}</Text>
  </Pressable>;
}

/**
 * The checkbox, in a real 40 pt column the full height of its row.
 *
 * `hitSlop` is withdrawn in favour of a box, because a slop overlaps invisibly and a
 * near-miss then lands on the control next door — the chevron is right beside it
 * (PD-TODAY-044). The drawn ring does not grow with the target.
 *
 * Its filled state is a **layer**, not an animated border: two boxes cross-fading on
 * opacity, so the border, the fill and the check arrive together on the native driver.
 */
function Checkbox({ done, completable, locked, measured, size, color, onPress }: {
  readonly done: boolean;
  readonly completable: boolean;
  /** Drawn exactly as it stands and not pressable: a record rather than a control. */
  readonly locked?: boolean;
  readonly measured: boolean;
  readonly size: number;
  readonly color: string;
  readonly onPress: () => void;
}) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  const met = useMetFade(done);
  /**
   * **The ring never carries lateness.** It went to the alarm colour on an overdue item,
   * which put six red circles on one screen the moment a part of the day ended — and a
   * red *control* says «it is dangerous to press this», while pressing it is precisely
   * what a late item wants. Owner instruction, 2026-08-05: «не рисовать красные кружки,
   * оставь чекбоксы обычными». Lateness is said in words, once, and counted in the
   * block's heading.
   */
  const resting = withAlpha(ink, 0.28);

  const box = <View style={[styles.checkbox, { borderColor: resting, height: size, width: size }]}>
    {measured ? <Ionicons color={theme.today.tertiaryText} name="ellipsis-horizontal" size={size - 7} /> : null}
    {!completable ? null : <Animated.View style={[styles.checkboxMet, {
      backgroundColor: color,
      borderColor: color,
      opacity: met,
    }]}
    >
      <Ionicons color={theme.today.dashboardSurface} name="checkmark" size={11} />
    </Animated.View>}
  </View>;

  // A derived routine container has no action of its own, and a measured habit cannot
  // be closed by a tick that invents no quantity — neither gets a control, but both
  // keep the column, so nothing in the row shifts under them. A **locked** box is the
  // third case and the only one that is still filled: it is what was recorded on a day
  // that is over, and the fill is gated on `completable` rather than on `locked` for
  // exactly that reason.
  if (!completable || locked === true) return <View style={styles.checkboxTarget}>{box}</View>;
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked: done }}
    onPress={onPress}
    style={styles.checkboxTarget}
  >{box}</Pressable>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chrome and small parts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The selected day, as **one drop that travels from date to date**.
 *
 * It is a single object: it is never destroyed on one date and rebuilt on another, which
 * is the whole difference from the metaball this replaces. Where the old shape had a
 * middle in which neither end existed, this one is always somewhere, and the eye can
 * follow it there.
 *
 * **Three transforms and nothing else.** `translateX` is its place in the strip's content
 * minus the strip's scroll — one native subtraction, so it stays glued to its date while
 * the weeks are browsed and moves only when a date is chosen. `scaleX` and `scaleY` are
 * the sampled stretch: the body leads with its speed and rounds again as it lands, which
 * is what makes a travelling disc read as a drop rather than as a puck.
 *
 * **It is glass now, and the digit no longer inverts** (owner decision, 2026-08-05:
 * «капли прозрачными, но видимыми, как у apple»). This reverses the opaque bead, and the
 * reversal is the *whole* of it rather than a repaint: the bead was opaque **because** the
 * digit inverted against it, and an inversion has to know what colour is behind it.
 *
 * Dropping the inversion dissolves that constraint instead of fighting it. The digit
 * simply stays ink and reads on whatever the glass composites to — measured at 13.75:1 in
 * Light and 9.57:1 in Dark, against the 9.03 and 7.84 the inversion used to buy. A
 * translucent bead on an already-blurred header refracts nothing, which is true and no
 * longer matters: what makes this shape visible is a **tint plus a hairline plus a top
 * arc**, not a refraction.
 *
 * The fill is `primaryText` at low alpha, which is near-black in Light and near-white in
 * Dark — one expression, and the only one that lifts a shape on a black ground and sinks
 * one on a white page. The arc scales with the body, so at full stretch it is a point and
 * a half at the sides and a point across the top; against animating a width, that is the
 * cheaper fault.
 */
/**
 * Everything the drop's worklet needs about the journey, and nothing about React.
 *
 * A worklet may only close over plain values, so the journey is flattened here once per
 * change rather than reached into on every frame. The progress table is pre-offset into the
 * journey's own range, which is what keeps the binding rule — every reader bound to
 * `[inStart, inEnd]` — true of the stretch as well as of the position.
 */
/**
 * Everything the drawn drop reads per frame, in the form the worklets want it.
 *
 * **It is built here and put in a shared value rather than in React state, and that is the
 * fix for two device defects rather than a preference.** It was a `useMemo` over the journey,
 * so the UI thread learned a new journey only when React committed one — while `begin` calls
 * `scrollToWeek` in the same tick and that scroll is *native*. For the frames in between,
 * `scrollX` had moved a whole page and `trackX` was still clamped to the previous range, so
 * `beadX = trackX − scrollX` was wrong by a page width and the bead sat off the left edge of
 * the screen. Measured from `тест5.MP4`: **up to 500 ms with no bead on screen at all**, and
 * frame 142 catches it as a grey arc clipped at the edge while the strip has already paged.
 *
 * The same lag was the stutter. The spring runs on the UI thread and is smooth; its *inputs*
 * were waiting behind a commit that also carried the day's query, five `setState` calls and a
 * re-render of the whole list.
 *
 * **Points, not dates.** An interrupted journey begins wherever the drop had reached, which
 * is not a date and cannot be named by one.
 */
function dropSampleOf(journey: Readonly<Journey>): DropSample {
  return {
    direction: Math.sign(plannerDaysBetween(journey.from, journey.to)) as -1 | 0 | 1,
    fromX: journey.fromX,
    inEnd: journey.inEnd,
    inStart: journey.inStart,
    progress: (journey.curve.progress as number[]).map((at) => journey.inStart + at),
    squash: journey.curve.squash as number[],
    stretch: journey.curve.stretch as number[],
    toX: journey.toX,
  };
}

interface DropSample {
  /**
   * Which way the page turns for **this** journey: forward brings the new day in from the
   * right. It rides here rather than in a prop because it is read by a worklet, and a
   * worklet that reads a render value is a worklet one commit behind — which is invisible
   * while the direction holds and violent the moment it flips. Tapping back and forth flips
   * it on every tap, so for a frame or two each page was drawn against the *previous*
   * journey's sign and threw itself a screen's width across.
   */
  readonly direction: -1 | 0 | 1;
  readonly fromX: number;
  readonly inEnd: number;
  readonly inStart: number;
  readonly progress: readonly number[];
  readonly squash: readonly number[];
  readonly stretch: readonly number[];
  readonly toX: number;
}

/**
 * One day, reading its own data and drawing its own rows.
 *
 * **This is what makes more than one day possible on screen at once**, and therefore what
 * makes a page transition that cannot tear. The carousel this replaces had a single tree
 * whose content was rewritten under it plus a frozen snapshot of what it used to be, both
 * positioned by an animated style — and since React commits content synchronously while an
 * animated style lands the next frame, one frame always drew new content at the old
 * position. `docs/DayTransitionAnimation.md` records that construction, the six
 * compensations it needed, and the verdict.
 *
 * A page owns its date for its whole life. It never becomes another day, so nothing it draws
 * has to change when the selection moves — which is the entire point: content that is not
 * rewritten cannot disagree with a position.
 *
 * **Its reads are its own** and cost nothing extra: all four are coalesced and keyed by date,
 * so a page the prefetch has already warmed asks no questions at all.
 *
 * **Every action carries this page's date, not the screen's selection.** A page for the 5th
 * closes the 5th, and that stays true while the selection is somewhere else — which it will
 * be, mid-turn, once the pager exists.
 */
function DayPage({
  active, clockLocalTime, collapsed, date, expanded, failure, notice, today,
  onCreateIn, onOpenEditor, onRetry, onToggleDone, onToggleSection, onToggleStep, onToggleSteps, onUndoNotice,
}: {
  readonly date: PlannerLocalDate;
  readonly today: PlannerLocalDate;
  /** The wall clock, or null where this page is not the day the clock is on. */
  readonly clockLocalTime: string | null;
  readonly collapsed: ReadonlySet<string>;
  readonly expanded: ReadonlySet<string>;
  /** Whether this is the page the person is on: only it may speak for the screen. */
  readonly active: boolean;
  readonly failure: string | null;
  readonly notice: Readonly<{ message: string; habitId: string }> | null;
  readonly onOpenEditor: (item: DayJournalItem, date: PlannerLocalDate) => void;
  readonly onCreateIn: (block: PlannerDayBlockKey, date: PlannerLocalDate) => void;
  readonly onToggleDone: (item: DayJournalItem, date: PlannerLocalDate) => void;
  readonly onToggleStep: (item: DayJournalItem, step: DayJournalStep, date: PlannerLocalDate) => void;
  readonly onToggleSection: (block: DayJournalSectionKey) => void;
  readonly onToggleSteps: (habitId: string) => void;
  readonly onUndoNotice: (habitId: string) => void;
  readonly onRetry: () => void;
}) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  const query = usePlannerOccurrences(date);
  const catalogue = usePlannerHabitCatalogue('', 'active', date);
  const model = query.data?.selectedLocalDate === date ? query.data : null;
  const dayKnown = model !== null;
  const nowMinuteOfDay = journalMinuteOfLocalTime(date === today ? clockLocalTime : null);
  const itemHabitIds = useMemo(() => (model?.rootGroups ?? []).map((group) => group.rootHabitId), [model]);
  const checklists = usePlannerChecklists(itemHabitIds, date);
  const closure = useHabitClosureRules(itemHabitIds);
  const closesByChecklistIds = useMemo(
    () => new Set([...closure.rules].filter(([, closes]) => closes).map(([habitId]) => habitId)),
    [closure.rules],
  );
  const taskHabitIds = useMemo(() => dayJournalTaskHabitIds(catalogue.data ?? []), [catalogue.data]);
  const reminderLocalTimes = useMemo(() => dayJournalReminderLocalTimes(catalogue.data ?? []), [catalogue.data]);
  const day = useMemo(
    () => selectDayJournalItems({
      checklists: checklists.data ?? undefined,
      dayIsPast: date < today,
      nowMinuteOfDay,
      reminderLocalTimes,
      rootGroups: model?.rootGroups ?? [],
      taskHabitIds,
    }),
    [checklists.data, date, model, nowMinuteOfDay, reminderLocalTimes, taskHabitIds, today],
  );
  const blocks = useMemo(() => selectDayBlocks([...day.timed, ...day.anytime]), [day]);
  const nowBlock = useMemo(() => currentDayBlock(nowMinuteOfDay), [nowMinuteOfDay]);
  const emptyDay = day.timed.length === 0 && day.anytime.length === 0;

  return <>
    {!active || failure === null ? null : <Text style={[styles.failure, { color: theme.today.attentionText }]}>{failure}</Text>}
    {!active || notice === null ? null : <View style={styles.notice}>
      <Text style={[styles.noticeText, { color: theme.today.secondaryText }]}>{notice.message}</Text>
      {/* The item is looked up when the button is pressed, not when the line was raised:
          holding the row meant holding the one from before the mark, whose observation did
          not exist yet. */}
      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onUndoNotice(notice.habitId)}>
        <Text style={[styles.noticeAction, { color: theme.today.system }]}>Undo</Text>
      </Pressable>
    </View>}

    {/* Anytime: things no part of the day claims **and no clock places**, above the three
        parts rather than below them — what is waiting to be placed belongs where it will be
        seen, and underneath three headings it is not seen at all. */}
    {blocks.anytime.length === 0 ? null : <>
      <AnytimeHeader
        collapsed={collapsed.has('anytime')}
        count={blocks.anytime.length}
        onToggle={() => onToggleSection('anytime')}
        overdueCount={blocks.anytime.filter((item) => item.overdue).length}
      />
      {collapsed.has('anytime') ? null : blocks.anytime.map((item) => <Plate
        closesByChecklist={closesByChecklistIds.has(item.habitId)}
        expanded={expanded.has(item.habitId)}
        item={item}
        key={item.habitId}
        onOpen={() => onOpenEditor(item, date)}
        onStepToggle={(step) => onToggleStep(item, step, date)}
        onToggle={() => onToggleDone(item, date)}
        onToggleSteps={() => onToggleSteps(item.habitId)}
      />)}
    </>}

    {/* The day as three parts with things in them. Every block is drawn whether or not it
        holds anything: an empty morning is a fact about the day and a place to add to. */}
    {blocks.sections.map((section) => <View key={section.block}>
      <BlockHeader
        collapsed={collapsed.has(section.block)}
        current={section.block === nowBlock}
        onAdd={() => onCreateIn(section.block, date)}
        onToggle={() => onToggleSection(section.block)}
        section={section}
      />
      {/* **«Free» is a statement, so it waits until it is true.** A day that has not been
          read does not know whether this part of it is free, and saying so anyway made a
          genuinely empty day pixel-identical to one still loading. Folded, a block is its
          heading and nothing else — not even the empty slot. */}
      {collapsed.has(section.block)
        ? null
        : section.items.length > 0
          ? section.items.map((item) => <Plate
            closesByChecklist={closesByChecklistIds.has(item.habitId)}
            expanded={expanded.has(item.habitId)}
            item={item}
            key={item.habitId}
            onOpen={() => onOpenEditor(item, date)}
            onStepToggle={(step) => onToggleStep(item, step, date)}
            onToggle={() => onToggleDone(item, date)}
            onToggleSteps={() => onToggleSteps(item.habitId)}
          />)
          : dayKnown
            ? <Pressable
              accessibilityLabel={`Add to ${BLOCK_LABELS[section.block].toLowerCase()}`}
              accessibilityRole="button"
              onPress={() => onCreateIn(section.block, date)}
              style={[styles.blockEmpty, { borderColor: withAlpha(ink, 0.11) }]}
            >
              <Text style={[styles.blockEmptyText, { color: theme.today.tertiaryText }]}>Free</Text>
            </Pressable>
            : <View style={styles.blockUnread} />}
    </View>)}

    {/* An empty day says so and is offered something to put in it. A day that could not be
        *read* is not an empty day, and says which it is. */}
    {!emptyDay || query.status === 'loading' ? null : query.status === 'error'
      ? <View style={styles.invitation}>
        <Text style={[styles.invitationLine, { color: theme.today.attentionText }]}>This day could not be loaded</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.invitationAction}>
          <Text style={[styles.invitationActionText, { color: theme.today.system }]}>Try again</Text>
        </Pressable>
      </View>
      : null}
  </>;
}


function DateDrop({ travel, scrollX, sample, digits, columnWidth, trackX }: {
  readonly travel: SharedValue<number>;
  readonly scrollX: SharedValue<number>;
  /** The journey, read on the UI thread so no frame is drawn against the previous one. */
  readonly sample: SharedValue<DropSample>;
  /** The numerals the lens may have to enlarge, at their centres in the strip's content. */
  readonly digits: readonly DropLensDigit[];
  /** One column, so the lens centres a numeral in the box the real cell centres it in. */
  readonly columnWidth: number;
  /** The drop's place in the strip's content, derived once by the screen. */
  readonly trackX: SharedValue<number>;
}) {
  const theme = useLifePlannerTheme();
  const radius = JOURNAL_DROP_RADIUS;
  /**
   * **Every reader is bound to the journey's own range and clamps.** `travel` is monotonic
   — 1, then 2, then 3 — so a reader left on `[0, 1]` does not fail loudly: the default
   * extrapolation keeps extending and the surface walks off the screen a width per date
   * change. That cost a package once; it is a rule with a scan behind it now.
   */
  /**
   * **Two coordinates, and the difference between them is the whole trick.**
   *
   * `trackX` is where the drop stands in the strip's own **content**; `beadX` is where that
   * lands on the **screen**, which is the same thing less however far the strip has paged
   * underneath. The bead is placed by the screen one. The lens works in the content one —
   * where `scrollX` cancels against the digits' own content positions, so a browse moves
   * the glass and its subject together and neither has to know the other exists.
   */
  const beadX = useDerivedValue(() => trackX.value - scrollX.value);
  const beadStretch = useDerivedValue(() => {
    const now = sample.value;
    return interpolate(travel.value, now.progress, now.stretch, Extrapolation.CLAMP);
  });

  /**
   * The subtraction is what keeps a browse and a travel from needing to know about each
   * other, and `-radius` is what makes the value a *centre* rather than an edge.
   */
  const body = useAnimatedStyle(() => ({
    transform: [
      { translateX: beadX.value },
      { translateX: -radius },
      { scaleX: beadStretch.value },
      { scaleY: interpolate(travel.value, sample.value.progress, sample.value.squash, Extrapolation.CLAMP) },
    ],
  }), [radius]);

  return <View pointerEvents="none" style={styles.dropLayer}>
    <Reanimated.View
      style={[styles.dropBead, {
        backgroundColor: theme.today.structGlass,
        borderColor: theme.today.hairline,
        borderWidth: StyleSheet.hairlineWidth,
        shadowColor: theme.dark ? 'transparent' : theme.colors.shadow,
        top: journalDropCentre() - radius,
      }, body]}
    >
      {/* **The lens rides inside the bead**, so it inherits the bead's place and its stretch
          without either being computed twice. It takes no speed: magnification is the
          material and is the same standing still as travelling (PD-TODAY-152), and the
          stretch this view already wears is the only thing on the bead a journey changes.
          It magnifies the strip's own numerals rather than drawing substitutes, so there is
          no second typeface to keep in step with the first — which is what put a serif digit
          between two sans-serif ones. */}
      <DropLens columnWidth={columnWidth} digits={digits} trackX={trackX} />
    </Reanimated.View>
  </View>;
}

/**
 * Two days on one track, and only ever for as long as a turn takes.
 *
 * The old page left on the finger and then **came back from 22 pt** once the state had
 * moved: between the leaving and the arriving there was nothing on screen at all, which
 * is what read as the day blinking. Here the day being left is still drawn, one width
 * away, and the two slide together on the same value the drop uses.
 *
 * **The outgoing day is the previous element tree, kept.** A React element carries the
 * props it was built with, so rendering last commit's children again renders last
 * commit's day — no snapshot of the model, no second query, and nothing to fall out of
 * step with the rows it is standing in for. It is inert while it leaves: it holds stale
 * handlers, and a tap on a day that is halfway off the screen is not a tap anybody meant.
 */
function DayCarousel({ minHeight, children }: {
  /** The floor a day stands on, so a shorter day cannot shorten the page. */
  readonly minHeight: number;
  readonly children: React.ReactNode;
}) {
  /**
   * **The transition is removed, on purpose, and this is the baseline it left behind.**
   *
   * Owner decision of 2026-08-06 after sixteen attempts at one family of defects: take the
   * animation out entirely and judge what remains. If the tearing survives with no animation
   * at all, it was never about the animation — and sixteen fixes were aimed at the wrong
   * thing. If it goes, there is finally a clean point to build from.
   *
   * **`docs/DayTransitionAnimation.md` records what was here** — the two trees on one track,
   * the shared-value journey, both position worklets, and the six compensations layered over
   * them — in enough detail to rebuild without reading a diff. Nothing was thrown away
   * without being written down first.
   *
   * What is deliberately **kept**: the floor, so a short day still cannot shorten the page;
   * and the drop's own travel model, which is a different animation on a different surface
   * and was never implicated.
   */
  // **Clipped to the pane.** Seven days stand side by side and six of them are off-screen
  // by design; without this they are simply *beside* the screen, and the owner reported
  // exactly that — «на каждой странице видны плашки задач других дней».
  return <View style={[styles.pageViewport, { minHeight }]}>{children}</View>;
}

/**
 * One date, and the digit under a drop that may be anywhere.
 *
 * **The inversion is two stacked layers cross-fading on opacity**, driven by how far the
 * drop is from this column — never by a colour and never by React state. Both matter.
 * A colour cannot take the native driver (PD-PLANNER-V033-UI-017), and the old path set
 * React state for it on every frame of every date change, which re-rendered the whole
 * strip under the finger. Two layers and one opacity cost nothing and run on the UI
 * thread, where the drop already is.
 *
 * `distance` is a difference of two content coordinates, so it does not contain the
 * strip's scroll: browsing a week changes neither end of it.
 */
function DateCell({ date, letter, selected, today, marks, onPress, reserveMarks, cellX, trackX }: {
  readonly date: PlannerLocalDate;
  readonly letter: string;
  readonly selected: boolean;
  readonly today: boolean;
  readonly marks: readonly DayJournalTaskMark[];
  readonly reserveMarks: boolean;
  readonly onPress: () => void;
  /** This cell's centre in the strip's content — the same space the drop travels in. */
  readonly cellX: number;
  /** Where the drop is, now, on the UI thread. */
  readonly trackX: SharedValue<number>;
}) {
  const theme = useLifePlannerTheme();
  const number = plannerLocalDateToDate(date).getDate();
  const row = journalTaskMarkRow(marks);
  /**
   * How much of this numeral the glass is standing over, as an opacity.
   *
   * The hand-over points are the width the lens **actually draws**: a numeral `d` away from
   * the drop's centre is drawn by the lens at `d × magnification`, so it leaves the disc at
   * `radius ÷ magnification`. Fading the original out over that same distance means the two
   * swap exactly where one stops and the other starts, rather than at a distance chosen to
   * look about right.
   */
  const undertheGlass = useAnimatedStyle(() => ({
    opacity: interpolate(
      Math.abs(cellX - trackX.value),
      [JOURNAL_DROP_COVER_HALF * 0.85, JOURNAL_DROP_COVER_HALF * 1.2],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }), [cellX]);
  return <Pressable
    accessibilityLabel={`${letter}, ${number}${marks.length === 0 ? '' : `, ${marks.length} ${marks.length === 1 ? 'task' : 'tasks'}`}`}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={onPress}
    style={styles.dateCell}
  >
    <Text
      maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
      style={[styles.weekLetter, { color: selected ? theme.today.primaryText : theme.today.secondaryText }]}
    >{letter}</Text>
    <View style={styles.dateBand}>
      <View style={[styles.dateCircle, { borderColor: !selected && today ? theme.today.structFill : 'transparent' }]}>
        {/* **One numeral, and it never inverts.** There were two stacked layers cross-fading
            on opacity as the glass drop passed under them, because an opaque bead has to be
            read against. Glass takes that away: the digit stays ink over whatever the bead
            composites to — 13.75:1 in Light, 9.57:1 in Dark, both measured — and with the
            second layer goes the whole class of defect that came with it, including the
            launch where an unparked drop left every digit uninverted. */}
        {/* **A date is hidden by the glass standing over it, never by being chosen.**
            Reported from the device: «при выборе даты она сначала исчезает, а потом
            появляется при наложении поверх капли». That was exactly what the code did —
            the numeral was painted transparent on `selected`, which commits the instant a
            finger lands, while the drop needs a third of a second to arrive. So the date
            went out, and the enlarged copy turned up later. Being chosen is not a reason to
            disappear.
            It is geometry now, and it runs where the drop runs: the original gives way over
            the width the lens actually covers, so the two hand over at the rim and there is
            never a frame with neither. No React state is involved, which is why it cannot
            fall behind a commit — the same rule the drop's own range was moved to. */}
        <Reanimated.Text
          maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
          style={[styles.dateNumber, { color: today ? theme.today.system : theme.today.primaryText }, undertheGlass]}
        >{number}</Reanimated.Text>
      </View>
    </View>
    {/* **The day's own tasks, as their own marks.** A row of dots said only how much
        was there; a row of miniature marks says what. They overlap by 5 pt, and the
        ring around each one is what makes the overlap read as stacking rather than as
        a smear — later marks paint over earlier ones by document order alone. Habits
        are not marked at all: a habit recurs and says nothing about one date. */}
    <View style={[styles.marks, reserveMarks ? null : styles.marksUnused]}>
      {row.shown.map((mark) => <View
        key={mark.habitId}
        style={[styles.dot, { backgroundColor: markColor(theme, mark) }]}
      />)}
      {row.overflow === 0 ? null : <View
        style={[styles.dot, { backgroundColor: withAlpha(theme.today.primaryText, 0.35) }]}
      />}
    </View>
  </Pressable>;
}

/** A strip mark's own colour: its category's, or the accent the task was painted with. */
function markColor(theme: ReturnType<typeof useLifePlannerTheme>, mark: DayJournalTaskMark): string {
  return journalCategoryColor(mark.categoryKey, theme.habitAccents[mark.accentKey].selectedSwatch);
}

/** The cross that opens Create. */
function FabGlyph() {
  const theme = useLifePlannerTheme();
  const reduceMotion = useReduceMotion();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      turn.setValue(0);
      return;
    }
    const run = Animated.timing(turn, {
      duration: JOURNAL_FAB_ROTATE_MS,
      easing: Easing.bezier(JOURNAL_POP_CURVE[0], JOURNAL_POP_CURVE[1], JOURNAL_POP_CURVE[2], JOURNAL_POP_CURVE[3]),
      toValue: 0,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [reduceMotion, turn]);
  return <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }] }}>
    {/* `primaryText`, not `onAccent`: the button has no fill to be drawn *on* any more. */}
    <Ionicons color={theme.today.primaryText} name="add" size={26} />
  </Animated.View>;
}


/**
 * The device clock, to the minute: the time it is, and the day it is.
 *
 * Both values come from **one** reading, so they cannot disagree about the midnight
 * they are read across — the date used to be read once at mount, which on a screen
 * left open kept calling yesterday today.
 */
/**
 * The line under NOW, and the one thing on this screen that is *always* moving.
 *
 * **It travels rather than stepping.** The share is recomputed once a minute, and a bar
 * that jumped by a ninetieth of its width once a minute is a bar nobody sees move — which
 * is most of what «it hangs» was. It glides to each new value over three quarters of a
 * second, on `scaleX` and the native driver, so nothing crosses the bridge per frame and
 * a list scrolling beside it is untouched.
 *
 * **A track that fills rather than a rule that grows.** At 3 pt it was a hairline, and a
 * hairline needed a travelling dot on its leading edge to be findable at all; at 6 pt with
 * a groove behind it the fill's own edge is the head, and the empty part says how much is
 * left. On a wait it takes the quieter ink, because a wait is not work being done.
 */
function NowProgress({ share, running }: { readonly share: number; readonly running: boolean }) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  const reduceMotion = useReduceMotion();
  const travel = useRef(new Animated.Value(Math.max(0, Math.min(1, share)))).current;

  useEffect(() => {
    const next = Math.max(0, Math.min(1, share));
    if (reduceMotion) {
      travel.setValue(next);
      return;
    }
    const run = Animated.timing(travel, {
      duration: JOURNAL_NOW_TRAVEL_MS,
      easing: Easing.out(Easing.cubic),
      toValue: next,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [reduceMotion, share, travel]);

  const colour = running ? theme.today.system : withAlpha(ink, 0.32);
  return (
    <View style={[styles.nowTrack, { backgroundColor: withAlpha(ink, 0.09) }]}>
      <Animated.View
        style={[styles.nowFill, {
          backgroundColor: colour,
          transform: [{ scaleX: travel }],
        }]}
      />
    </View>
  );
}

/** How long the line takes to reach a new share. Long enough to be seen travelling. */
const JOURNAL_NOW_TRAVEL_MS = 750;

function useDeviceClock(): Readonly<{ localDate: PlannerLocalDate; localTime: string }> {
  const [value, setValue] = useState(deviceClock);
  useEffect(() => {
    const tick = () => setValue((current) => {
      const next = deviceClock();
      return next.localDate === current.localDate && next.localTime === current.localTime ? current : next;
    });
    tick();
    // **On the minute, not a minute after opening.** `setInterval` from mount put the
    // first tick wherever the screen happened to be opened, so a displayed minute could
    // be up to fifty-nine seconds stale and the NOW line appeared to stand still.
    let interval: ReturnType<typeof setInterval> | null = null;
    const now = new Date();
    const toNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    const align = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, toNextMinute);
    return () => {
      clearTimeout(align);
      if (interval !== null) clearInterval(interval);
    };
  }, []);
  return value;
}

function deviceClock(): Readonly<{ localDate: PlannerLocalDate; localTime: string }> {
  const now = new Date();
  return Object.freeze({
    localDate: plannerLocalDateFromDevice(now),
    localTime: journalLocalTimeOfMinute(now.getHours() * 60 + now.getMinutes()),
  });
}

async function undoRow(
  row: SelectedDatePlannerOccurrenceRow,
  correct: ReturnType<typeof usePlannerServices>['correctHabitObservation'],
) {
  const observationId = row.currentObservation.currentLeafIds[0];
  if (observationId === undefined) {
    return { ok: false as const, error: { message: 'The current observation could not be found safely.' } };
  }
  return correct({
    correctedOccurrenceLocalDate: row.commandContext.occurrenceLocalDate,
    correctedOccurrenceTimezone: row.commandContext.occurrenceTimezone,
    correctionReason: 'reversal',
    observationId,
    replacement: { type: 'void' },
  });
}

/**
 * A title opens the editor only on a deliberate tap: a scroll over the list or a long
 * hold must open nothing, so the release has to be close to where the press landed and
 * soon after it.
 */
function useDeliberateTap(onTap: () => void) {
  const down = useRef<Readonly<{ x: number; y: number; at: number }> | null>(null);
  return {
    onPressIn: (event: GestureResponderEvent) => {
      down.current = { at: Date.now(), x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    },
    onPressOut: (event: GestureResponderEvent) => {
      const start = down.current;
      down.current = null;
      if (start === null) return;
      const deliberate = isDeliberateJournalTap({
        downAt: start.at,
        downX: start.x,
        downY: start.y,
        upAt: Date.now(),
        upX: event.nativeEvent.pageX,
        upY: event.nativeEvent.pageY,
      });
      if (deliberate) onTap();
    },
  };
}

/**
 * **The rank has no word anywhere in the application any more.**
 *
 * `RankPill` is deleted rather than left dormant: it was the one place the level was
 * spelled out, the owner's instruction is that rank is carried by colour alone, and a
 * component nothing renders is a thing the next reader has to rule out.
 *
 * What survives is `rankTone` — the tint, the spine and the derived ink — and the word
 * itself, which goes into the row's **accessibility label** so the fact is not lost to
 * a screen reader. The visible redundancy is what is gone, and that is recorded against
 * PD-PRIORITY-003 rather than quietly dropped.
 */

/*
 * The metaball's three sampled curves are gone with it. A travelling drop's stretch
 * depends on how far it is actually going, so its table cannot be a module constant —
 * it is built per journey by `travelCurve`, which is thirty-three exponentials
 * and happens once when a date change starts.
 */
/*
 * `JOURNAL_ARRIVE_MS` is gone with the fade it timed. The day page no longer waits to be
 * visible: it arrives with its three parts and the rows appear in them, so there is
 * nothing left for a duration to cover.
 */
/** Room for the longest month a year can name, so the control beside it never shifts. */
const JOURNAL_MONTH_LABEL_WIDTH = 155;
/** The label's own leading, held so the reserved box cannot disagree with the text. */
const JOURNAL_MONTH_LABEL_LINE = 19;

const JOURNAL_FAB_SIZE = 56;
/**
 * The action stands **above** the bar rather than level with it, and both numbers are
 * derived from the bar so a change to its geometry carries here.
 */
const JOURNAL_FAB_LIFT = 10;
/**
 * What the pane reserves for the action, so the last row can always be scrolled clear
 * of it and ticked. The card's own bottom edge is already at `TAB_BAR_CLEARANCE`, so
 * what has to be cleared is how far the button reaches above that edge, plus air.
 */
const JOURNAL_PANE_BOTTOM = JOURNAL_FAB_SIZE + JOURNAL_FAB_LIFT + 12;
const EMPTY_MARKS: readonly DayJournalTaskMark[] = Object.freeze([]);

const styles = StyleSheet.create({
  root: { flex: 1 },
  // **No horizontal inset.** The header and the bar are full width and meet the
  // screen's own corners; everything between them carries the ground's own padding.
  safe: { flex: 1 },
  // **Two surface levels, so there is no card.** The stage paints nothing; the header
  // keeps a surface until package 3 gives it the blurred material, and the list below
  // it lies on the ground, which is the only reason a white plate can be seen at all.
  stage: { flex: 1 },
  // The header floats over the list rather than standing in flow above it, which is
  // what lets the day pass under its glass. `overflow` clips the blur to the radius.
  headerLayer: { left: 0, position: 'absolute', right: 0, top: 0, zIndex: 5 },
  headerPlate: { bottom: 0, elevation: 12, left: JOURNAL_HEADER_LIFT_INSET, position: 'absolute', right: JOURNAL_HEADER_LIFT_INSET, transformOrigin: 'top', shadowOffset: { height: 8, width: 0 }, shadowOpacity: JOURNAL_HEADER_LIFT_SHADOW, shadowRadius: 22, top: 0 },
  headerPlateClip: { borderRadius: JOURNAL_HEADER_LIFT_RADIUS, flex: 1, overflow: 'hidden' },

  // 1 · The week band, smaller than the journal's previous one: the room it gave up
  // went to the day bar, which is the screen's metric.
  // **The head of the screen gives its room to the list.** Every number here came down
  // a step on the owner's reading: the head was 217 pt before the list began, which is
  // four rows of the thing the screen is actually for. Nothing changed in kind — the
  // week is still a week, the bar is still the same scale — only the room each part
  // asks for.
  weekBand: { paddingBottom: 6, paddingTop: 7 },
  // The header shrinks from its own top edge: scaled about the centre it would lift off
  // the status bar and leave a gap nobody asked for.
  // **One inset for the whole header, and it was three.** The week band held 14, the NOW
  // line 16, and the day row — which moved in here from the list — held none at all, so
  // «DAY» stood against the screen edge while the dates were inset. Three left edges is
  // exactly «как будто это разные части интерфейса», and it was literally true.
  headerShrink: { paddingHorizontal: JOURNAL_HEADER_INSET, transformOrigin: 'top center' },
  // **Centred, exactly as the prototype centres it.** A shrinking box that keeps its
  // content in the middle clips it evenly from both sides, which is what reads as going
  // into itself. Pinned to the top it clips only from below and the label appears to
  // slide away downwards — which is what «август заезжает куда-то вниз» was, and it was
  // introduced by the previous round's own fix.
  monthCollapse: { justifyContent: 'center', overflow: 'hidden' },
  weekTop: { alignItems: 'center', flexDirection: 'row', minHeight: 22 },
  monthButton: { alignItems: 'center', flexDirection: 'row', minHeight: 22 },
  monthLabel: { fontSize: 15, fontWeight: '600', lineHeight: JOURNAL_MONTH_LABEL_LINE },
  // The room the flipping label used to reserve, kept: a long month must not push the
  // control beside it, and that was never what was wrong with the animation.
  monthLabelBox: { minWidth: JOURNAL_MONTH_LABEL_WIDTH },
  todayAction: { borderRadius: 10, borderWidth: 1, marginRight: 4, paddingHorizontal: 8, paddingVertical: 2 },
  todayActionText: { fontSize: 11, fontWeight: '600' },
  // The row is the drop's coordinate system as well as the numbers', so it is a fixed
  // height with the cells sharing it equally — a drop standing *between* two dates needs
  // a continuous coordinate rather than a gap it can fall into.
  // **The dates stood 3 pt under the month and the prototype gives them 8.** Tucked up
  // against the label they read as one crowded block instead of as a calendar with a
  // caption over it.
  weekRow: { marginTop: JOURNAL_WEEK_ROW_TOP, minHeight: JOURNAL_WEEK_ROW, position: 'relative' },
  weekPage: { flexDirection: 'row', justifyContent: 'space-between' },
  dateCell: { alignItems: 'center', flex: 1 },
  weekLetter: { fontSize: 10.5, fontWeight: '500', height: JOURNAL_WEEK_LETTER, letterSpacing: 0.3, lineHeight: JOURNAL_WEEK_LETTER },
  // The number stands in the middle of the drop's own band, so the marks below it are
  // clear of the drop by construction rather than by two heights happening to agree.
  // **The numeral's band is the drop's band, and that is load-bearing rather than tidy.**
  // The bead is placed absolutely at `journalDropCentre()` — the middle of the drop band —
  // while the numeral is centred inside this one. The two agreed only because both constants
  // happened to be 26; the moment the bead was sized to what it magnifies they would have
  // disagreed by 5 pt, and the glass would have sat below the number it was enlarging.
  dateBand: { alignItems: 'center', height: JOURNAL_DROP_BAND, justifyContent: 'center' },
  // **A circle, by owner decision.** The prototype fills a rounded rectangle the width of
  // the cell; tried on the device it read as a block rather than as a date, and the disc
  // stays. The width is the row, so the digit sits in a circle and not in an oval.
  dateCircle: { alignItems: 'center', borderRadius: JOURNAL_DATE_ROW / 2, borderWidth: 1.5, height: JOURNAL_DATE_ROW, justifyContent: 'center', width: JOURNAL_DATE_ROW },
  // The drop is the **ground** the numbers stand on, so its layer fills the row and
  // paints under them. Every shape in it is placed by a column centre and animated by a
  // transform alone; nothing about it is a width, a height or a radius in flight.
  /**
   * The layer paints nothing itself and stands **under** the dates, which is what the
   * drop is the ground for.
   *
   * **No `zIndex`, and that is the whole of it.** It carried `zIndex: 1` — written to
   * mean «over the strip» and meaning the opposite of what was wanted: 1 outranks the
   * list's default 0, so the opaque bead was painted *over* the numbers and the selected
   * date had no digit at all. Confirmed frame by frame from `тест3.MP4` at 11.7 s, where
   * the selection is a flat disc with nothing on it. Order alone is correct here: this
   * layer is written before the list, so the list paints on top of it.
   */
  // The track is a row of full-width slots; only its own transform ever moves.
  pageViewport: { overflow: 'hidden' },
  pageTrack: { flexDirection: 'row' },
  pageSlot: { alignSelf: 'flex-start', paddingHorizontal: PLATE_GROUND_PADDING },
  dropLayer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  dropBead: {
    borderRadius: JOURNAL_DROP_RADIUS,
    elevation: 2,
    height: JOURNAL_DROP_RADIUS * 2,
    left: 0,
    position: 'absolute',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    width: JOURNAL_DROP_RADIUS * 2,
  },
  // A border with only its top side coloured: on a fully round box that is an arc, which
  // is the one thing a straight highlight cannot be.
  // Stated in the model, because the lens draws this same numeral magnified and two
  // declarations of what a date is set in are two things to keep in step.
  dateNumber: { fontSize: JOURNAL_DATE_TYPE_SIZE, fontWeight: '500' },
  // The inverted layer stands exactly on the ink one; only opacity separates them.
  // The day being left, one width away and inert.
  carouselLeaving: { left: 0, position: 'absolute', right: 0, top: 0 },
  // No gap: the marks overlap, and the ring around each one is what makes the overlap
  // read as stacking. Later marks paint over earlier ones by document order alone.
  // **Dots, at the prototype's size.** The 16 pt task marks said what was there and cost
  // a 14 pt band under every date — eleven points of it standing between the dates and
  // the line below, which is the space the owner kept pointing at. A dot says the day is
  // not empty and its colour says which area of life; what is there, the day itself says.
  marks: { alignItems: 'center', flexDirection: 'row', gap: 2, height: 5, justifyContent: 'center', marginTop: 3 },
  // A band that holds nothing takes no room: reserved per week, so the columns stay level.
  marksUnused: { height: 0, marginTop: 0 },
  dot: { borderRadius: 2, height: 4, width: 4 },

  /*
   * The rail's and the NOW card's styles are gone with them.
   *
   * The rail was retired when the axis arrived and its ~30 style entries were left
   * standing — the handoff recorded them as «drawn by nothing and kept alive by their
   * own tests». The axis is retired in turn now, so the whole cluster goes: the day
   * bar, the clock badge, the pins with their halos and count badges, the hatching, the
   * hour strip, and the hero card's own eighteen entries. Anything a later package
   * genuinely needs is in the history rather than in the file.
   */

  // 3 · The pane. No top padding, because the NOW line sticks flush to its top edge.
  paneHolder: { flex: 1, minHeight: 0 },
  pane: { flexGrow: 1, paddingBottom: JOURNAL_PANE_BOTTOM },

  // 4 · The day header: the day's arithmetic, where nothing moves.
  dayHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 22 },
  // A part of the day names itself in words at reading size, not in a service caption:
  // it is a heading over a list rather than a label on a control.
  blockHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 30, paddingTop: 10 },
  // The whole leading group is the disclosure target: a 14 pt chevron on its own is a
  // control nobody can hit, and the word beside it is what a finger actually aims at.
  // `flexShrink` so a long count never pushes the rule off the row.
  blockDisclosure: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 6, minWidth: 0 },
  blockName: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  blockCount: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '500' },
  blockOverdue: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '500' },
  blockDuration: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '400' },
  blockAdd: { alignItems: 'center', height: 22, justifyContent: 'center', width: 22 },
  // An empty part of the day is a place to put something, so it is drawn as one: a
  // dashed outline is the one thing this language allows to mean «you can put something
  // here» (PD-PLATE-001), and it is exactly what this is.
  blockEmpty: {
    alignItems: 'center',
    borderRadius: PLATE_RADIUS,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    justifyContent: 'center',
    marginBottom: PLATE_GAP,
    minHeight: 44,
  },
  blockEmptyText: { fontSize: 13, fontWeight: '400' },
  /**
   * A block whose day has not been read yet: the room its slot would take, and nothing
   * drawn in it. Reserving the height is what keeps the page from growing under the
   * finger when the day lands — the rows arrive into space that was already theirs.
   */
  blockUnread: { marginBottom: PLATE_GAP, minHeight: 44 },
  eyebrow: { fontSize: 10, fontWeight: '600', letterSpacing: 1 },
  // The slot is as wide as the longer caption, always, so the meter beside it never resizes.
  eyebrowSlot: { justifyContent: 'center' },
  eyebrowReserve: { opacity: 0 },
  eyebrowLabel: { left: 0, position: 'absolute' },
  headerRule: { flex: 1, height: 1 },
  // 4 pt rather than the rule's 1: a trough has to look like a trough, or the fill in it
  // reads as a coloured line somebody left behind.
  // One box for both states of the meter, so nothing beside it moves when a date crosses
  // today: the hairline and the filled track lie on top of each other and cross-fade.
  dayMeter: { flex: 1, height: 4, justifyContent: 'center' },
  dayRuleLayer: { height: 1 },
  dayTrack: { ...StyleSheet.absoluteFillObject, borderRadius: 2, overflow: 'hidden' },
  dayFill: { borderRadius: 2, height: '100%' },
  tally: { fontSize: 10, fontVariant: ['tabular-nums'], fontWeight: '500' },

  // 5 · A block, and the items in it. Every size here is a step above the brief's own,
  // on the owner's reading of the built screen: at the drawn values the plates looked
  // undersized against the bar and the hero above them.
  // **Blocks are never glued.** Two plates sharing an edge read as one object with a
  // line through it — the same reason the time column came back inside the plate — so
  // every block carries its own air whether or not a free stretch separates it from
  // the next. The pane's own `gap` cannot do this: the rows are inside the day's
  // animated wrapper, which is a single child of the pane.
  block: { gap: PLATE_GAP },

  // `min-height`, not a height: a row grows with its text, which is what lets the
  // largest accessibility sizes work without a second layout rule.
  plate: {
    borderRadius: PLATE_RADIUS,
    borderWidth: PLATE_SELECTION_RING,
    elevation: 2,
    marginBottom: PLATE_GAP,
    padding: PLATE_PADDING,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  plateRow: { alignItems: 'center', flexDirection: 'row', gap: PLATE_ROW_GAP, minHeight: PLATE_MIN_HEIGHT - 2 * PLATE_PADDING },
  // Absolute and outside the padded row, so the spine reaches the plate's full height and
  // costs the text column nothing. The row takes a margin of the same width instead, which
  // is what keeps the mark on one vertical whether an item is ranked or not.
  plateSpine: { bottom: -PLATE_PADDING, left: -PLATE_PADDING, position: 'absolute', top: -PLATE_PADDING, width: PLATE_RANK_SPINE },
  // No fixed height and no reserved slot: the column is exactly its own content, which
  // is what centres a one-line plate and a two-line one alike.
  plateWords: { flex: 1, gap: 2, justifyContent: 'center', minWidth: 0 },
  plateTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  plateTitle: { flexShrink: 1, fontSize: 17, letterSpacing: -0.2, lineHeight: 22 },
  criticalDot: { borderRadius: PLATE_CRITICAL_DOT / 2, height: PLATE_CRITICAL_DOT, width: PLATE_CRITICAL_DOT },
  // Wrapping rather than truncating: at the largest text sizes four facts do not fit a
  // phone's width, and a plate that grows a line is right where one that hides a fact is
  // not. `rowGap` is 0 because the line's own leading already separates two rows of it.
  plateFacts: { alignItems: 'center', columnGap: 5, flexDirection: 'row', flexWrap: 'wrap', minWidth: 0 },
  plateFact: { alignItems: 'center', flexDirection: 'row', gap: 4, minWidth: 0 },
  plateFactDot: { fontSize: 13, lineHeight: 18 },
  plateFactSteps: { alignItems: 'center', flexDirection: 'row', gap: 3 },
  plateFactText: { flexShrink: 1, fontSize: 13, fontVariant: ['tabular-nums'], lineHeight: 18 },
  /**
   * The row's own box, held whatever is in it, so the header's height is a constant and
   * the pane's top padding cannot move. `JOURNAL_NOW_ROW` is stated once and read here and
   * by nothing else — the height was written inline as 20 and was the only place that knew.
   */
  nowRow: { height: JOURNAL_NOW_ROW, justifyContent: 'center' },
  nowLine: { alignItems: 'center', flexDirection: 'row', gap: 8, height: JOURNAL_NOW_ROW },
  nowFill: {
    borderRadius: 3, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0,
    transformOrigin: 'left',
  },
  nowTrack: { borderRadius: 3, height: 6, marginBottom: 2, marginHorizontal: 16, marginTop: 6, overflow: 'hidden' },
  nowKicker: { fontSize: 11, fontWeight: '500', letterSpacing: 0.6 },
  pickList: { gap: 4, paddingBottom: 6, paddingHorizontal: 16 },
  pickRow: { alignItems: 'center', borderRadius: 9, flexDirection: 'row', gap: 8, height: 34, paddingHorizontal: 8 },
  pickText: { flex: 1, fontSize: 13 },
  nowSubject: { flexShrink: 1, fontSize: 13, fontWeight: '400', lineHeight: 18 },
  nowNext: { flexShrink: 0, fontSize: 13, fontWeight: '400', lineHeight: 18 },
  plateCheck: { marginRight: -PLATE_CHECKBOX_OVERHANG },
  plateSteps: { gap: PLATE_SUBTASK_GAP - 8, paddingTop: 6 },
  // **Centred rather than flush right**, and at a fixed width, so a line's own box can
  // stand on the same vertical by using the same box — `justifyContent: 'flex-end'`
  // aligns two different diameters by their right edges, which is not the same thing.
  checkboxTarget: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', flexGrow: 0, flexShrink: 0, justifyContent: 'center', width: JOURNAL_TOUCH_TARGET },
  // **No `overflow: hidden`.** It clipped the met layer's negative insets, so a closed
  // item kept a pale ring of its resting border around a filled centre — the white
  // showing at the edge of every done task and habit. The layer has to reach *over* the
  // border to replace it, which is the one thing clipping made impossible.
  // 30 pt drawn inside a 44 pt target: the ring keeps its size and the hit area grows
  // around it, which is the brief's own instruction and the project's standing rule.
  checkbox: { alignItems: 'center', borderRadius: JOURNAL_CHECK / 2, borderWidth: 2, justifyContent: 'center' },
  checkboxMet: { alignItems: 'center', borderRadius: 10, borderWidth: 1.5, bottom: -1.5, justifyContent: 'center', left: -1.5, position: 'absolute', right: -1.5, top: -1.5 },
  // The same width as the parent's `checkboxTarget`, centred the same way, so the two
  // boxes share one vertical whatever either of them is drawn at.
  stepRow: { alignItems: 'center', flexDirection: 'row', gap: PLATE_SUBTASK_GAP, height: PLATE_SUBTASK_ROW },
  stepBox: { alignItems: 'center', borderRadius: PLATE_SUBTASK_BOX / 2, borderWidth: 1.5, flexGrow: 0, flexShrink: 0, height: PLATE_SUBTASK_BOX, justifyContent: 'center', width: PLATE_SUBTASK_BOX },
  stepBoxMet: { alignItems: 'center', borderRadius: PLATE_SUBTASK_BOX / 2, bottom: -1.5, justifyContent: 'center', left: -1.5, position: 'absolute', right: -1.5, top: -1.5 },
  stepTitle: { flex: 1, fontSize: 15, fontWeight: '400', lineHeight: 20, minWidth: 0 },

  // 6 · Anytime: things no part of the day claims.

  /*
   * The free window's own styles are gone with the axis.
   *
   * A gap between two plates was a thing that could be drawn because the page was a
   * scale; between two items in a sequence there is no gap to name, and what the offer
   * was for now lives on each block's own plus.
   */

  invitation: { alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 40 },
  invitationLine: { fontSize: 14 },
  invitationAction: { alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: 44, paddingHorizontal: 12 },
  invitationActionText: { fontSize: 15, fontWeight: '600' },
  failure: { fontSize: 13, lineHeight: 18, paddingBottom: 8 },
  notice: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, paddingBottom: 8 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  noticeAction: { fontSize: 13, fontWeight: '700' },

  spacer: { flex: 1 },

  // `overflow: hidden` is what keeps the blur inside the circle: a `BlurView` filling
  // the box would otherwise blur a square behind a round button.
  fabMaterial: { borderRadius: JOURNAL_FAB_SIZE / 2 },
  fab: { alignItems: 'center', borderRadius: JOURNAL_FAB_SIZE / 2, elevation: 8, overflow: 'hidden', height: JOURNAL_FAB_SIZE, justifyContent: 'center', position: 'absolute', right: 14, shadowOffset: { height: 5, width: 0 }, shadowOpacity: 0.3, shadowRadius: 11, width: JOURNAL_FAB_SIZE },
});
