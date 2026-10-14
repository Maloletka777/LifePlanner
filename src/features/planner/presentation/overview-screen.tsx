import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type View as NativeView } from 'react-native';

import {
  countPlannerRender,
  type PlannerLocalDate,
  type SelectedDatePlannerOccurrenceRow,
  type SelectedDatePlannerRootGroup,
} from '@/src/features/planner';
import { BottomScrim, InlineError, Screen, SecondaryButton } from '@/src/ui/components';
import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';
import { TAB_BAR_CLEARANCE } from '@/src/ui/tab-bar';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { GrainSegment, ProgressRing, RecordBars } from './overview-components';
import { OverviewFolder, OverviewPanelContent, useFolderReveal, type OverviewFolderFrame } from './overview-panels';
import {
  formatOverviewHeaderDate,
  OVERVIEW_BEST_HOURS_EMPTY,
  OVERVIEW_SLIPPING_EMPTY,
  overviewActivityCountLine,
  overviewBestWindowLine,
  overviewStreakFooter,
  overviewMeasured,
  selectOverviewPeriod,
  selectOverviewSlips,
  selectOverviewStreakDots,
  selectOverviewToday,
  selectOverviewWindows,
  type OverviewCardId,
  type OverviewGrain,
} from './overview-model';
import {
  usePlannerHabitCatalogue,
  usePlannerOccurrences,
  usePlannerOverviewAnalytics,
} from './planner-provider';
import { habitCatalogueNavigation, movePlannerDate, plannerLocalDateFromDevice, plannerRowIsCanonicallyDone } from './ui-adapters';

/**
 * Overview — the second tab, from `design_handoff_overview_records`.
 *
 * The tab used to be Planner: a date rail over a per-day list of habit rows, which
 * is the journal that now lives on Today. Three things went with the redesign — the
 * 126 pt rail, the per-day list and the floating Add — because creation and editing
 * belong to the journal and scheduling far-off items belongs behind **All
 * activities**. Nothing here is editable.
 *
 * The screen answers five questions and then hands over: how today is going,
 * whether the chain holds, what the stretch looks like, when the person actually
 * delivers, and what keeps slipping.
 */

/** Four months is what the week, the month, the streak and the 30-day cards need. */
const OVERVIEW_HISTORY_DAYS = 120;
const RING_SIZE = 88;
const RING_STROKE = 7;
/** The page behind the opened folder falls back rather than disappearing. */
const PAGE_FALLBACK_SCALE = 0.94;
const PAGE_FALLBACK_OPACITY = 0.45;

export function OverviewScreen() {
  // The diagnostics counter names the two tabs it watches; Overview is the second
  // one, whatever the tab is called this month.
  countPlannerRender('Planner');
  const theme = useLifePlannerTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const stageRef = useRef<NativeView>(null);
  const now = new Date();
  const today = plannerLocalDateFromDevice(now);
  const nowMinuteOfDay = now.getHours() * 60 + now.getMinutes();

  const [grain, setGrain] = useState<OverviewGrain>('week');
  const [open, setOpen] = useState<OverviewCardId | null>(null);
  const [frame, setFrame] = useState<OverviewFolderFrame | null>(null);
  // The drill lives here rather than inside the panel, because the sideways swipe
  // has to know whether "back" means leaving a bar or leaving the folder.
  const [drill, setDrill] = useState<number | null>(null);

  // The year grain is the only one that reaches past the rolling window, and it
  // asks for exactly its own year rather than a third of a decade.
  const range = useMemo(() => grain === 'year'
    ? { startDate: yearStart(today), endDate: today }
    : { startDate: movePlannerDate(today, -(OVERVIEW_HISTORY_DAYS - 1)), endDate: today },
  [grain, today]);
  const analyticsQuery = usePlannerOverviewAnalytics(range);
  const dayQuery = usePlannerOccurrences(today);
  const catalogue = usePlannerHabitCatalogue('', 'active', today);

  const analytics = analyticsQuery.data;
  const dayModel = dayQuery.data?.selectedLocalDate === today ? dayQuery.data : null;
  const activityCount = useMemo(
    () => (catalogue.data ?? []).filter((item) => item.ordinaryParentName === null).length,
    [catalogue.data],
  );
  const todayFacts = useMemo(() => selectOverviewToday({
    rows: dayModel === null ? [] : dayModel.rootGroups.flatMap((group) => overviewRow(group)),
    nowMinuteOfDay,
    localDayOfTimestamp: (timestamp) => plannerLocalDateFromDevice(new Date(timestamp)),
    localMinuteOfTimestamp: (timestamp) => {
      const moment = new Date(timestamp);
      return moment.getHours() * 60 + moment.getMinutes();
    },
    today,
  }), [dayModel, nowMinuteOfDay, today]);
  const period = useMemo(() => selectOverviewPeriod({
    grain,
    anchor: today,
    today,
    days: analytics?.days ?? [],
  }), [analytics, grain, today]);
  const windows = useMemo(() => selectOverviewWindows(analytics?.windows ?? []), [analytics]);
  const slips = useMemo(() => selectOverviewSlips(analytics?.activities ?? []), [analytics]);
  const streakDots = useMemo(() => selectOverviewStreakDots(analytics?.days ?? [], today), [analytics, today]);
  const measured = useMemo(() => overviewMeasured(analytics), [analytics]);
  const nothingCreated = activityCount === 0 && catalogue.status === 'ready';

  const openCard = useCallback((cardId: OverviewCardId, cardRef: NativeView | null) => {
    void Haptics.selectionAsync();
    setDrill(null);
    if (cardRef === null || stageRef.current === null) {
      setFrame(null);
      setOpen(cardId);
      return;
    }
    stageRef.current.measureInWindow((stageX, stageY, stageWidth, stageHeight) => {
      cardRef.measureInWindow((cardX, cardY, cardWidth, cardHeight) => {
        // The card's own rectangle, in the stage's points. It was held as four
        // edge fractions first and the window landed beside the card rather than
        // in it: two of those edges resolve against different axes, and a position
        // with a size cannot drift apart the way four edges can.
        setFrame(stageWidth === 0 || stageHeight === 0 ? null : {
          x: cardX - stageX,
          y: cardY - stageY,
          width: cardWidth,
          height: cardHeight,
          stageWidth,
          stageHeight,
        });
        setOpen(cardId);
      });
    });
  }, []);

  const failure = analyticsQuery.status === 'error' ? analyticsQuery.error : null;
  const reveal = useFolderReveal(open !== null, reduceMotion);
  // The panel keeps drawing what it was showing while it travels home. Emptying it
  // the moment it starts to close is why the close read as a blank rectangle
  // sliding off rather than as a dashboard folding back into its card.
  const shownRef = useRef<OverviewCardId | null>(null);
  if (open !== null) shownRef.current = open;
  const shown = open ?? shownRef.current;

  return <View collapsable={false} ref={stageRef} style={styles.stage}>
    {/* The page falls back and returns **while the window still covers it** — in
        the first and last quarter of the travel, where it cannot be seen doing it.
        Given the middle of the flight, its 6 % of growth reads as the whole screen
        spreading out just before the folder lands. */}
    <Animated.View style={[styles.stage, {
      opacity: reveal.native.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, PAGE_FALLBACK_OPACITY] }),
      transform: [{ scale: reveal.native.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, PAGE_FALLBACK_SCALE] }) }],
    }]}>
    <Screen
      backgroundColor={theme.today.appSurface}
      contentStyle={{ gap: 14, paddingBottom: TAB_BAR_CLEARANCE + 16, paddingHorizontal: 16, paddingTop: 16 }}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.headerTitle, { color: theme.today.primaryText }]}>Overview</Text>
        <Text style={[styles.headerDate, { color: theme.today.tertiaryText }]}>{formatOverviewHeaderDate(today)}</Text>
      </View>

      {failure === null ? null : <InlineError message={failure} />}

      {nothingCreated ? <OverviewCard cardId="today" onOpen={() => undefined} openable={false} summary="">
        <Text style={[styles.cardTitle, { color: theme.today.primaryText }]}>This fills in as you go</Text>
        <Text style={[styles.bodyText, { color: theme.today.secondaryText }]}>
          Overview counts activities — the things you repeat. Create a few on Today and this screen starts answering
          how the day went, whether the chain holds and what keeps slipping.
        </Text>
        <SecondaryButton onPress={() => router.push('/(tabs)')} title="Go to Today" />
      </OverviewCard> : <>
        <View style={styles.pairRow}>
          <TodayCard
            closed={todayFacts.closed}
            onTime={todayFacts.closedBeforePlan}
            onOpen={openCard}
            overdue={todayFacts.pastDue}
            reduceMotion={reduceMotion}
            scheduled={todayFacts.scheduled}
          />
          <StreakCard
            current={analytics?.streak.current ?? 0}
            dots={streakDots}
            longest={analytics?.streak.longest ?? 0}
            onOpen={openCard}
          />
        </View>
      </>}

      <AllActivitiesRow
        count={activityCount}
        onPress={() => router.push(habitCatalogueNavigation(today))}
      />


      {nothingCreated ? null : <RecordsCard
        grain={grain}
        onGrain={(next) => { void Haptics.selectionAsync(); setGrain(next); }}
        onOpen={openCard}
        period={period}
        reduceMotion={reduceMotion}
      />}

      {/* Both cards keep their place from the first day; one with nothing to
          measure says so rather than leaving a gap where a dashboard was. */}
      {nothingCreated ? null : <View style={styles.pairRow}>
        <BestHoursCard measured={measured.best} onOpen={openCard} windows={windows} />
        <SlippingCard measured={measured.slip} onOpen={openCard} slips={slips.slice(0, 3)} />
      </View>}
    </Screen>

    <Animated.View
      pointerEvents="none"
      style={[styles.scrimLayer, { opacity: reveal.native.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
    >
      <BottomScrim groundColor={theme.today.appSurface} />
    </Animated.View>
    </Animated.View>

    <OverviewFolder
      canGoBack={open === 'records' && drill !== null}
      frame={frame}
      onBack={() => setDrill(null)}
      // The drill is dropped when the next card opens, not on the way out: resetting
      // it here would change the panel's content mid-flight.
      onClose={() => setOpen(null)}
      open={open !== null}
      reduceMotion={reduceMotion}
      reveal={reveal}
    >
      {shown === null ? null : <OverviewPanelContent
        analytics={analytics}
        card={shown}
        drill={drill}
        grain={grain}
        onDrill={setDrill}
        onGrain={(next) => { setGrain(next); setDrill(null); }}
        onOpenActivities={() => { setOpen(null); router.push(habitCatalogueNavigation(today)); }}
        period={period}
        slips={slips}
        today={today}
        todayFacts={todayFacts}
        windows={windows}
      />}
    </OverviewFolder>
  </View>;
}

/** Root activities only, and never a task: Overview counts activities. */
function overviewRow(group: SelectedDatePlannerRootGroup): readonly Readonly<{
  habitId: string;
  name: string;
  plannedLocalTime: string | null;
  done: boolean;
  closedAt: number | null;
  isTask: boolean;
}>[] {
  const row: SelectedDatePlannerOccurrenceRow | undefined = group.rows.find((candidate) => candidate.habitId === group.rootHabitId) ?? group.rows[0];
  if (row === undefined || row.ordinaryParentHabitId !== null) return [];
  const timestamps = row.currentObservation.currentEntries.map((entry) => entry.observedAt);
  return [Object.freeze({
    habitId: row.habitId,
    name: row.name,
    plannedLocalTime: row.plannedLocalTime,
    done: plannerRowIsCanonicallyDone({ state: row.state, routineContainer: group.routineContainer }),
    closedAt: timestamps.length === 0 ? null : Math.max(...timestamps),
    // The occurrence read model cannot tell a task from an activity; the analytics
    // query does it from the active range, and today's card follows the same rule
    // through the catalogue rather than guessing here.
    isTask: false,
  })];
}

function yearStart(date: PlannerLocalDate): PlannerLocalDate {
  return `${date.slice(0, 4)}-01-01` as PlannerLocalDate;
}

/**
 * The card, with the values the previous dashboard card carried: surface, hairline,
 * radius 24, padding 18, gap 14, and a press that scales to 0.97 rather than
 * changing colour alone.
 */
function OverviewCard({ cardId, summary, openable = true, spread = false, onOpen, children }: PropsWithChildren<{
  readonly cardId: OverviewCardId;
  readonly summary: string;
  readonly openable?: boolean;
  /** Streak spreads its content so it stands the same height as Today beside it. */
  readonly spread?: boolean;
  readonly onOpen: (cardId: OverviewCardId, node: NativeView | null) => void;
}>) {
  const theme = useLifePlannerTheme();
  const nodeRef = useRef<NativeView>(null);
  const press = useRef(new Animated.Value(0)).current;
  const to = (value: number, duration: number) => Animated.timing(press, {
    duration, toValue: value, useNativeDriver: true,
  }).start();
  return <Animated.View style={[styles.cardFlex, { transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }] }]}>
    <Pressable
      accessibilityHint={openable ? 'Opens the detail' : undefined}
      accessibilityLabel={summary}
      accessibilityRole={openable ? 'button' : undefined}
      collapsable={false}
      disabled={!openable}
      onPress={() => onOpen(cardId, nodeRef.current)}
      onPressIn={() => to(1, 60)}
      onPressOut={() => to(0, 120)}
      ref={nodeRef}
      // `flex: 1` on the surface itself, not only on the wrapper: without it the
      // two cards in a row stand at their own content heights and the pair reads
      // as two different sizes.
      style={[styles.card, styles.cardFill, spread ? styles.cardSpread : null, {
        backgroundColor: theme.today.dashboardSurface,
        borderColor: theme.today.hairline,
        shadowColor: theme.today.primaryText,
      }]}
    >
      {children}
    </Pressable>
  </Animated.View>;
}

function CardHeader({ title }: { readonly title: string }) {
  const theme = useLifePlannerTheme();
  return <View style={styles.cardHeader}>
    <Text style={[styles.cardTitle, { color: theme.today.primaryText }]}>{title}</Text>
    <Ionicons color={theme.today.tertiaryText} name="chevron-forward" size={16} />
  </View>;
}

function TodayCard({ scheduled, closed, onTime, overdue, reduceMotion, onOpen }: {
  readonly scheduled: number;
  readonly closed: number;
  readonly onTime: number;
  readonly overdue: number;
  readonly reduceMotion: boolean;
  readonly onOpen: (cardId: OverviewCardId, node: NativeView | null) => void;
}) {
  const theme = useLifePlannerTheme();
  return <OverviewCard cardId="today" onOpen={onOpen} summary={`Today. ${closed} of ${scheduled} done`}>
    <CardHeader title="Today" />
    <View style={styles.ringRow}>
      <ProgressRing
        animate={!reduceMotion}
        fillColor={theme.today.completion}
        fraction={scheduled === 0 ? 0 : closed / scheduled}
        size={RING_SIZE}
        stroke={RING_STROKE}
        trackColor={theme.today.tone200}
      >
        <Text style={[styles.ringValue, { color: theme.today.primaryText }]}>{closed}/{scheduled}</Text>
        <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>done</Text>
      </ProgressRing>
    </View>
    {/* Two short phrases that do not fit one line on a half-width card at every
        type size: they wrap as whole phrases rather than breaking inside one. */}
    <View style={styles.footerRow}>
      <Text numberOfLines={1} style={[styles.caption, { color: theme.today.tertiaryText }]}>{onTime} on time</Text>
      <Text numberOfLines={1} style={[styles.caption, { color: theme.today.attentionText }]}>
        {overdue === 0 ? 'none overdue' : `${overdue} overdue`}
      </Text>
    </View>
  </OverviewCard>;
}

function StreakCard({ current, longest, dots, onOpen }: {
  readonly current: number;
  readonly longest: number;
  readonly dots: readonly Readonly<{ localDate: string; closed: boolean; isToday: boolean }>[];
  readonly onOpen: (cardId: OverviewCardId, node: NativeView | null) => void;
}) {
  const theme = useLifePlannerTheme();
  return <OverviewCard cardId="streak" onOpen={onOpen} spread summary={`Streak. ${current} days`}>
    <CardHeader title="Streak" />
    <View style={styles.streakValueRow}>
      <Text style={[styles.streakValue, { color: theme.today.completion }]}>{current}</Text>
      <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>days</Text>
    </View>
    <View style={styles.streakDots}>
      {dots.map((dot) => <View
        key={dot.localDate}
        style={[styles.streakDot, dot.isToday && !dot.closed
          ? { borderColor: theme.today.completion, borderWidth: 2 }
          : { backgroundColor: dot.closed ? theme.today.completion : theme.today.tone200 }]}
      />)}
    </View>
    <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>{overviewStreakFooter(longest)}</Text>
  </OverviewCard>;
}

/**
 * The door into the extended planner. Not a dashboard — a navigation row, which is
 * why it carries no chevron-opening animation and no detail of its own.
 */
function AllActivitiesRow({ count, onPress }: { readonly count: number; readonly onPress: () => void }) {
  const theme = useLifePlannerTheme();
  return <Pressable
    accessibilityHint="Opens all activities"
    accessibilityLabel={`All activities. ${overviewActivityCountLine(count)}`}
    accessibilityRole="button"
    onPress={onPress}
    style={[styles.doorCard, { backgroundColor: theme.today.dashboardSurface, borderColor: theme.today.hairline, shadowColor: theme.today.primaryText }]}
  >
    <View style={[styles.doorTile, { backgroundColor: theme.today.completionTint }]}>
      <Ionicons color={theme.today.completion} name="list-outline" size={20} />
    </View>
    <View style={styles.doorColumn}>
      <Text style={[styles.cardTitle, { color: theme.today.primaryText }]}>All activities</Text>
      <Text numberOfLines={1} style={[styles.caption, { color: theme.today.tertiaryText }]}>{overviewActivityCountLine(count)}</Text>
    </View>
    <Ionicons color={theme.today.tertiaryText} name="chevron-forward" size={16} />
  </Pressable>;
}

function RecordsCard({ period, grain, reduceMotion, onGrain, onOpen }: {
  readonly period: ReturnType<typeof selectOverviewPeriod>;
  readonly grain: OverviewGrain;
  readonly reduceMotion: boolean;
  readonly onGrain: (grain: OverviewGrain) => void;
  readonly onOpen: (cardId: OverviewCardId, node: NativeView | null) => void;
}) {
  const theme = useLifePlannerTheme();
  return <OverviewCard cardId="records" onOpen={onOpen} summary={`Records. ${period.percent}% ${period.caption}`}>
    <CardHeader title="Records" />
    <GrainSegment grain={grain} onGrain={onGrain} reduceMotion={reduceMotion} />
    <View style={styles.headlineRow}>
      <Text style={[styles.headline, { color: theme.today.completion }]}>{period.percent}%</Text>
      <Text style={[styles.caption, styles.headlineCaption, { color: theme.today.tertiaryText }]}>{period.caption}</Text>
    </View>
    <RecordBars bars={period.bars} height={42} />
    <View style={[styles.recordsFooter, { borderTopColor: theme.today.separator }]}>
      <Text style={[styles.label, { color: theme.today.primaryText }]}>
        {period.daysFullyClosed} of {period.daysCounted} days fully closed
      </Text>
      <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>
        {period.onTimePercent === null ? 'on time not measured yet' : `${period.onTimePercent}% on time`}
      </Text>
    </View>
    <View style={styles.loadRow}>
      <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>You plan {period.plannedPerDay} activities a day</Text>
      <Text style={[styles.caption, styles.loadValue, { color: theme.today.primaryText }]}>you close {period.closedPerDay}</Text>
    </View>
  </OverviewCard>;
}

function BestHoursCard({ windows, measured, onOpen }: {
  readonly windows: ReturnType<typeof selectOverviewWindows>;
  readonly measured: boolean;
  readonly onOpen: (cardId: OverviewCardId, node: NativeView | null) => void;
}) {
  const theme = useLifePlannerTheme();
  if (!measured) return <OverviewCard cardId="best" onOpen={onOpen} spread summary="Best hours. Nothing measured yet">
    <CardHeader title="Best hours" />
    <Text style={[styles.emptyNote, { color: theme.today.tertiaryText }]}>{OVERVIEW_BEST_HOURS_EMPTY}</Text>
  </OverviewCard>;
  return <OverviewCard cardId="best" onOpen={onOpen} summary="Best hours. When you actually deliver">
    <CardHeader title="Best hours" />
    <View style={styles.bands}>
      {windows.map((window, index) => <View key={window.key} style={styles.band}>
        <View style={styles.bandRow}>
          <Text style={[styles.bandLabel, { color: index === 0 ? theme.today.completion : theme.today.secondaryText }]}>
            {window.label}
          </Text>
          <Text style={[styles.bandValue, { color: index === 0 ? theme.today.completion : theme.today.secondaryText }]}>
            {window.percent}%
          </Text>
        </View>
        <View style={[styles.bandTrack, { backgroundColor: theme.today.tone200 }]}>
          <View style={[styles.bandFill, { backgroundColor: theme.today.completion, width: `${window.percent}%` }]} />
        </View>
      </View>)}
    </View>
    <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>{overviewBestWindowLine(windows)}</Text>
  </OverviewCard>;
}

function SlippingCard({ slips, measured, onOpen }: {
  readonly slips: ReturnType<typeof selectOverviewSlips>;
  readonly measured: boolean;
  readonly onOpen: (cardId: OverviewCardId, node: NativeView | null) => void;
}) {
  const theme = useLifePlannerTheme();
  if (!measured) return <OverviewCard cardId="slip" onOpen={onOpen} spread summary="Slipping. Nothing missed yet">
    <CardHeader title="Slipping" />
    <Text style={[styles.emptyNote, { color: theme.today.tertiaryText }]}>{OVERVIEW_SLIPPING_EMPTY}</Text>
  </OverviewCard>;
  return <OverviewCard cardId="slip" onOpen={onOpen} summary="Slipping. What keeps not happening">
    <CardHeader title="Slipping" />
    <View>
      {slips.map((slip, index) => <View
        key={slip.habitId}
        style={[styles.slipRow, index === 0 ? null : { borderTopColor: theme.today.separator, borderTopWidth: 1 }]}
      >
        <Text numberOfLines={1} style={[styles.label, styles.slipName, { color: theme.today.primaryText }]}>{slip.name}</Text>
        <Text style={[styles.label, { color: index === 0 ? theme.today.attentionText : theme.today.scheduleText }]}>
          {slip.missedDays}×
        </Text>
      </View>)}
    </View>
    <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>Times missed, last 30 days</Text>
  </OverviewCard>;
}

const styles = StyleSheet.create({
  emptyNote: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  band: { gap: 4 },
  bandFill: { borderRadius: 3, height: '100%' },
  bandLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.77 },
  bandRow: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  bandTrack: { borderRadius: 3, height: 6, overflow: 'hidden' },
  bandValue: { fontSize: 11, fontWeight: '600' },
  bands: { gap: 10 },
  barColumn: { alignItems: 'center', flex: 1, gap: 4 },
  barFill: { borderRadius: 3, bottom: 0, left: 0, position: 'absolute', right: 0 },
  barLabel: { fontSize: 11, fontWeight: '600' },
  barTrack: { alignSelf: 'stretch', borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' },
  barValue: { fontSize: 11, fontWeight: '700' },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 6 },
  bodyText: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: '500' },
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, elevation: 2, gap: 14, padding: 18, shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.08, shadowRadius: 12 },
  cardFill: { flex: 1 },
  cardFlex: { flex: 1 },
  cardSpread: { justifyContent: 'space-between' },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  doorCard: { alignItems: 'center', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, elevation: 2, flexDirection: 'row', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 12, shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.08, shadowRadius: 12 },
  doorColumn: { flex: 1, gap: 2 },
  doorTile: { alignItems: 'center', borderRadius: 13, height: 40, justifyContent: 'center', width: 40 },
  footerRow: { alignItems: 'baseline', columnGap: 8, flexDirection: 'row', flexWrap: 'wrap', rowGap: 2 },
  header: { gap: 2, minHeight: 44 },
  headerDate: { fontSize: 13, fontWeight: '500' },
  headerTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, lineHeight: 41 },
  headline: { fontSize: 34, fontWeight: '700', letterSpacing: -0.8, lineHeight: 38 },
  headlineCaption: { flex: 1 },
  headlineRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
  loadRow: { alignItems: 'baseline', flexDirection: 'row', gap: 6 },
  loadValue: { fontWeight: '600' },
  pairRow: { alignItems: 'stretch', flexDirection: 'row', gap: 14 },
  recordsFooter: { borderTopWidth: 1, gap: 2, paddingTop: 12 },
  ringCentre: { alignItems: 'center', justifyContent: 'center' },
  ringClip: { overflow: 'hidden', position: 'absolute', top: 0 },
  ringRow: { alignItems: 'center' },
  ringValue: { fontSize: 26, fontWeight: '700', lineHeight: 30 },
  slipName: { flex: 1 },
  slipRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 38 },
  scrimLayer: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  stage: { flex: 1 },
  streakDot: { borderRadius: 4.5, height: 9, width: 9 },
  streakDots: { flexDirection: 'row', gap: 5 },
  streakValue: { fontSize: 44, fontWeight: '700', letterSpacing: -1, lineHeight: 46 },
  streakValueRow: { alignItems: 'baseline', flexDirection: 'row', gap: 6 },
});
