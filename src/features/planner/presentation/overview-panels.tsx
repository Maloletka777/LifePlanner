import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type PropsWithChildren } from 'react';
import { Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PlannerLocalDate, PlannerOverviewAnalytics, PlannerOverviewDayFact } from '@/src/features/planner';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { GrainSegment, RecordBars } from './overview-components';
import {
  overviewAverageDelta,
  overviewCountdownText,
  overviewDeltaText,
  overviewStreakLead,
  selectOverviewSlips,
  selectOverviewWindows,
  type OverviewCardId,
  type OverviewGrain,
  type OverviewPeriod,
  type OverviewToday,
} from './overview-model';
import { formatPlannerDate } from './ui-adapters';

/**
 * The opened dashboard, from `design_handoff_overview_records` §B.
 *
 * The motion is the iPhone folder gesture rather than a pushed screen, and the
 * consequence is deliberate: **there is no back button**. The panel is always
 * full-screen; what travels is the *window* onto it, from the tapped card's
 * rectangle out to the whole stage. Nothing is scaled, so no text is ever
 * distorted in flight.
 *
 * Only the two travelling phases carry a transition. Parking the panel back on its
 * card and then resetting must be instant, or the close reads as a second little
 * flight into the middle of the screen — that was a real bug in the prototype and
 * the reason `phase` exists at all.
 */

export interface OverviewFolderFrame {
  /** The card's rectangle in the stage's own points, and the stage it sits in. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
}

const REVEAL_DURATION = 460;
const REVEAL_EASING = Easing.bezier(0.32, 0.72, 0, 1);
/** The content is gone by the halfway mark of the flight, in both directions. */
const CONTENT_HALFWAY = 0.5;
const REDUCED_FADE = 140;
const CLOSE_DISTANCE = 80;
/** A sideways travel that means "back" rather than a stray finger. */
const BACK_DISTANCE = 64;
const SPRING_HOME = 320;

/**
 * Two values for one reveal: layout properties cannot cross to the native driver,
 * and the page behind must not be animated from JavaScript. They run on the same
 * timing, so they stay in step.
 */
export function useFolderReveal(open: boolean, reduceMotion: boolean) {
  const layout = useRef(new Animated.Value(0)).current;
  const native = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const toValue = open ? 1 : 0;
    if (reduceMotion) {
      layout.setValue(toValue);
      native.setValue(toValue);
      return;
    }
    const duration = REVEAL_DURATION;
    const animations = [
      Animated.timing(layout, { duration, easing: REVEAL_EASING, toValue, useNativeDriver: false }),
      Animated.timing(native, { duration, easing: REVEAL_EASING, toValue, useNativeDriver: true }),
    ];
    animations.forEach((animation) => animation.start(({ finished }) => {
      if (!finished) { layout.setValue(toValue); native.setValue(toValue); }
    }));
    // Settle rather than stop: a stopped animation freezes where it stands, and a
    // half-open window is not a state this screen has.
    const guard = setTimeout(() => { layout.setValue(toValue); native.setValue(toValue); }, duration + 160);
    return () => { clearTimeout(guard); };
  }, [layout, native, open, reduceMotion]);
  return { layout, native };
}

export function OverviewFolder({ open, frame, reveal, reduceMotion, canGoBack, onBack, onClose, children }: PropsWithChildren<{
  readonly open: boolean;
  readonly frame: OverviewFolderFrame | null;
  readonly reveal: ReturnType<typeof useFolderReveal>;
  readonly reduceMotion: boolean;
  /** True while a drill is open inside the panel: a sideways swipe leaves that first. */
  readonly canGoBack: boolean;
  readonly onBack: () => void;
  readonly onClose: () => void;
}>) {
  const theme = useLifePlannerTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(open);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  const axis = useRef<'vertical' | 'horizontal' | null>(null);
  // The panel's own scroll position, so the dismiss drag only takes over at the top.
  const scrollTop = useRef(0);
  const closeRef = useRef(onClose);
  const backRef = useRef(onBack);
  const canGoBackRef = useRef(canGoBack);
  closeRef.current = onClose;
  backRef.current = onBack;
  canGoBackRef.current = canGoBack;

  useEffect(() => {
    if (open) { setMounted(true); dragY.setValue(0); dragX.setValue(0); return; }
    if (!mounted) return;
    /**
     * The panel flies home **from wherever the finger left it**.
     *
     * The drag offset used to survive the close: the frame shrank towards the
     * card while a `translateY` of two or three hundred points still sat on top
     * of it, so the panel came to rest beside its dashboard and vanished there.
     * A quick flick left it hanging at the card's own height, a slow drag to the
     * bottom left it hanging at the bottom — which is exactly what the owner saw.
     * Both offsets now travel back to zero on the same timing as the window, so
     * the two motions compose into one flight into the card.
     */
    const settle = reduceMotion ? 0 : REVEAL_DURATION;
    Animated.parallel([
      Animated.timing(dragY, { duration: settle, easing: REVEAL_EASING, toValue: 0, useNativeDriver: false }),
      Animated.timing(dragX, { duration: settle, easing: REVEAL_EASING, toValue: 0, useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (!finished) { dragY.setValue(0); dragX.setValue(0); }
    });
    const timer = setTimeout(() => setMounted(false), reduceMotion ? REDUCED_FADE : REVEAL_DURATION);
    return () => clearTimeout(timer);
  }, [dragX, dragY, mounted, open, reduceMotion]);

  /**
   * One responder for both ways out, and it **captures** rather than waits.
   *
   * A band of dead space over the content was the first attempt and it swallowed
   * every tap beneath it — the segment and the drill's back row stopped working.
   * Capturing on a *move* instead leaves taps to the buttons that own them and
   * only takes the gesture once a finger has travelled: sideways for back, down
   * for close, and down only while the panel is scrolled to its top, so the list
   * keeps its own scrolling.
   */
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      const horizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 12;
      const vertical = gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) && scrollTop.current <= 2;
      return horizontal || vertical;
    },
    onPanResponderGrant: (_event, gesture) => {
      axis.current = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? 'horizontal' : 'vertical';
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    // No transition while the finger is down: the panel is where the hand puts it.
    onPanResponderMove: (_event, gesture) => {
      if (axis.current === 'horizontal') dragX.setValue(gesture.dx);
      else dragY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      const wasHorizontal = axis.current === 'horizontal';
      axis.current = null;
      if (wasHorizontal) {
        // Either direction counts: the gesture means "back", and back is a
        // drill's own step out where there is one and the folder itself where
        // there is not.
        if (Math.abs(gesture.dx) > BACK_DISTANCE) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (canGoBackRef.current) backRef.current(); else closeRef.current();
          dragX.setValue(0);
          return;
        }
        Animated.timing(dragX, { duration: SPRING_HOME, easing: REVEAL_EASING, toValue: 0, useNativeDriver: false }).start();
        return;
      }
      if (gesture.dy > CLOSE_DISTANCE) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        closeRef.current();
        return;
      }
      Animated.timing(dragY, { duration: SPRING_HOME, easing: REVEAL_EASING, toValue: 0, useNativeDriver: false }).start();
    },
    onPanResponderTerminationRequest: () => false,
    onStartShouldSetPanResponderCapture: () => false,
  })).current;

  if (!mounted) return null;

  /**
   * The window travels in **points**, from the card's own rectangle to the whole
   * stage. It was expressed as percentages of four edges at first and landed
   * beside the card rather than in it: `right` and `bottom` each resolve against a
   * different axis, and one arithmetic slip in either puts the whole rectangle
   * somewhere plausible but wrong. A position and a size cannot drift apart.
   */
  const travel = (from: number, to: number) => reveal.layout.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  const windowStyle = frame === null
    ? { height: '100%' as const, left: 0, top: 0, width: '100%' as const }
    : {
      height: travel(frame.height, frame.stageHeight),
      left: travel(frame.x, 0),
      top: travel(frame.y, 0),
      width: travel(frame.width, frame.stageWidth),
    };

  return <View pointerEvents={open ? 'auto' : 'none'} style={StyleSheet.absoluteFill}>
    <Animated.View
      accessibilityViewIsModal
      style={[styles.window, windowStyle, {
        /**
         * At the end of the flight the window **is** the card it came from.
         *
         * It used to stay the colour of the screen's ground and empty right up to
         * the last frame, so a grey rectangle sat on the dashboard and then blinked
         * out — the seam the owner saw. An iPhone folder is not translucent either;
         * it simply matches what it folds into and disappears at the moment it gets
         * there. So the fill crosses to the card's own surface, the radius comes
         * back to 24, and the whole window fades only over the last stretch of the
         * path, by which point what is underneath is identical to it.
         */
        backgroundColor: reveal.layout.interpolate({
          inputRange: [0, 1],
          outputRange: [theme.today.dashboardSurface, theme.today.appSurface],
        }),
        borderRadius: reveal.layout.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
        opacity: reduceMotion
          ? reveal.native
          : reveal.layout.interpolate({ inputRange: [0, 0.14, 1], outputRange: [0, 1, 1] }),
        /**
         * The drag moves the panel and does **not** scale it.
         *
         * The brief shrinks it by up to a tenth as the finger pulls, and that tenth
         * had to be given back at the moment of release — so the window grew, spread
         * across the screen and only then flew home. One motion cannot begin by
         * undoing another. The pull reads perfectly well as travel alone.
         */
        transform: [
          { translateX: dragX },
          { translateY: dragY },
        ],
      }]}
    >
      {/**
        * The content is laid out **once, at the size of the stage**, and never
        * reflows while the window travels.
        *
        * This is what the brief means by "what animates is the window onto it".
        * With the panel at `flex: 1` inside an animating frame, every frame of the
        * 460 ms asked React Native for a whole new layout of the panel — the
        * screen froze, the animation never showed, and the folder simply vanished
        * when the timer ran out. Fixed to the stage it costs one layout, and the
        * frame above only clips it.
        */}
      <Animated.View
        style={[styles.panel, {
          height: frame?.stageHeight,
          // The content is gone by the halfway mark, so the last half of the flight
          // is an empty card travelling into an identical one.
          opacity: reduceMotion ? 1 : reveal.native.interpolate({
            inputRange: [0, CONTENT_HALFWAY, 1],
            outputRange: [0, 0, 1],
          }),
          // The panel is full-screen, so without this the grabber lands inside the
          // status bar — where a downward swipe belongs to iOS, not to us.
          paddingTop: insets.top,
          width: frame?.stageWidth,
        }]}
        {...responder.panHandlers}
      >
        <Pressable
          accessibilityHint="Closes this detail"
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.grabberArea}
        >
          <View style={[styles.grabber, { backgroundColor: theme.today.tone300 }]} />
          <Text style={[styles.hint, { color: theme.today.tertiaryText }]}>
            {canGoBack ? 'Swipe sideways to go back · drag down to close' : 'Swipe sideways or drag down to close'}
          </Text>
        </Pressable>
        <PanelScrollContext.Provider value={scrollTop}>{children}</PanelScrollContext.Provider>
      </Animated.View>
    </Animated.View>
  </View>;
}

/** How the panel's scroll offset reaches the folder's gesture, without a prop chain. */
const PanelScrollContext = createContext<MutableRefObject<number> | null>(null);

export function OverviewPanelContent({ card, analytics, period, grain, onGrain, drill, onDrill, todayFacts, windows, slips, today, onOpenActivities }: {
  readonly card: OverviewCardId;
  readonly analytics: PlannerOverviewAnalytics | null;
  readonly period: OverviewPeriod;
  readonly grain: OverviewGrain;
  readonly onGrain: (grain: OverviewGrain) => void;
  /** The bar being drilled into, owned above so the swipe knows what "back" means. */
  readonly drill: number | null;
  readonly onDrill: (index: number | null) => void;
  readonly todayFacts: OverviewToday;
  readonly windows: ReturnType<typeof selectOverviewWindows>;
  readonly slips: ReturnType<typeof selectOverviewSlips>;
  readonly today: PlannerLocalDate;
  readonly onOpenActivities: () => void;
}) {
  const scrollTop = useContext(PanelScrollContext);
  return <ScrollView
    contentContainerStyle={styles.content}
    onScroll={(event) => { if (scrollTop !== null) scrollTop.current = event.nativeEvent.contentOffset.y; }}
    scrollEventThrottle={16}
    showsVerticalScrollIndicator={false}
  >
    {card === 'today' ? <TodayPanel facts={todayFacts} today={today} /> : null}
    {card === 'streak' ? <StreakPanel analytics={analytics} today={today} /> : null}
    {card === 'records' ? <RecordsPanel drill={drill} grain={grain} onDrill={onDrill} onGrain={onGrain} period={period} /> : null}
    {card === 'best' ? <BestHoursPanel onOpenActivities={onOpenActivities} windows={windows} /> : null}
    {card === 'slip' ? <SlippingPanel onOpenActivities={onOpenActivities} slips={slips} /> : null}
  </ScrollView>;
}

function PanelLead({ title, subtitle }: { readonly title: string; readonly subtitle: string }) {
  const theme = useLifePlannerTheme();
  return <View style={styles.lead}>
    <Text accessibilityRole="header" style={[styles.leadTitle, { color: theme.today.primaryText }]}>{title}</Text>
    <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>{subtitle}</Text>
  </View>;
}

function PanelCard({ title, subtitle, children }: PropsWithChildren<{ readonly title: string; readonly subtitle?: string }>) {
  const theme = useLifePlannerTheme();
  return <View style={[styles.panelCard, { backgroundColor: theme.today.dashboardSurface, borderColor: theme.today.hairline }]}>
    <View style={styles.panelCardHeader}>
      <Text style={[styles.cardTitle, { color: theme.today.primaryText }]}>{title}</Text>
      {subtitle === undefined ? null : <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>{subtitle}</Text>}
    </View>
    {children}
  </View>;
}

function Footnote({ children }: PropsWithChildren) {
  const theme = useLifePlannerTheme();
  return <Text style={[styles.footnote, { color: theme.today.tertiaryText }]}>{children}</Text>;
}

function TodayPanel({ facts, today }: { readonly facts: OverviewToday; readonly today: PlannerLocalDate }) {
  const theme = useLifePlannerTheme();
  const closed = facts.entries.filter((entry) => entry.done);
  const open = facts.entries.filter((entry) => !entry.done);
  const average = overviewAverageDelta(closed);
  return <>
    <PanelLead subtitle={`${formatPlannerDate(today)} · read-only`} title="How today is going" />
    <View>
      <Text style={[styles.bigNumber, { color: theme.today.primaryText }]}>{facts.closed} of {facts.scheduled} closed</Text>
      <Text style={[styles.label, { color: theme.today.tertiaryText }]}>One segment per activity, in the order it was planned</Text>
    </View>
    {/* What the ring cannot say, which is why the ring is not repeated here. */}
    <View style={styles.segments}>
      {facts.segments.map((segment, index) => <View
        key={`${segment}-${index}`}
        style={[styles.segmentBar, {
          backgroundColor: segment === 'closed'
            ? theme.today.completion
            : segment === 'overdue' ? theme.today.attentionText : theme.today.tone200,
        }]}
      />)}
    </View>
    <View style={styles.dotLines}>
      <DotLine color={theme.today.completion} label={`${facts.closedBeforePlan} closed before plan`} />
      <DotLine color={theme.today.scheduleText} label={`${facts.closedLate} closed late`} />
      <DotLine color={theme.today.attentionText} label={`${facts.pastDue} past their time`} tinted />
    </View>
    {closed.length === 0 ? null : <PanelCard subtitle="When you planned it, when you actually closed it" title={`Done today — ${closed.length}`}>
      {closed.map((entry, index) => <View
        key={entry.habitId}
        style={[styles.closureRow, index === 0 ? null : { borderTopColor: theme.today.separator, borderTopWidth: 1 }]}
      >
        <View style={styles.closureHeader}>
          <Text numberOfLines={1} style={[styles.label, styles.closureName, { color: theme.today.primaryText }]}>{entry.name}</Text>
          <Text style={[styles.label, {
            color: entry.deltaMinutes === null
              ? theme.today.tertiaryText
              : entry.deltaMinutes <= 0 ? theme.today.completion : theme.today.scheduleText,
          }]}>
            {entry.backFilled ? 'recorded later' : entry.deltaMinutes === null ? 'no planned time' : overviewDeltaText(entry.deltaMinutes)}
          </Text>
        </View>
        <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>
          {entry.plannedLocalTime === null ? 'anytime' : `planned ${entry.plannedLocalTime}`}
          {entry.closedLocalTime === null ? '' : ` · closed ${entry.closedLocalTime}`}
        </Text>
      </View>)}
      {average === null ? null : <Text style={[styles.cardTitle, { color: theme.today.primaryText }]}>
        {overviewDeltaText(average)} on average
      </Text>}
    </PanelCard>}
    {open.length === 0 ? null : <PanelCard subtitle="Anything still open at midnight counts as late tomorrow" title={`Not done yet — ${open.length} left`}>
      {open.map((entry) => <View key={entry.habitId} style={styles.openRow}>
        <Text style={[styles.openTime, { color: theme.today.secondaryText }]}>{entry.plannedLocalTime ?? '—'}</Text>
        <Text numberOfLines={1} style={[styles.label, styles.closureName, { color: theme.today.primaryText }]}>{entry.name}</Text>
        <OpenStatus entry={entry} />
      </View>)}
    </PanelCard>}
    <Footnote>
      An activity is on time when it is closed before its planned minute, on its planned day. Left open past midnight it
      is late, and stays late whenever it is eventually closed. Activities with no planned time carry no plan and are
      left out of every punctuality figure, and tasks are excluded entirely. Nothing on this screen is editable — the
      journal on Today owns that.
    </Footnote>
  </>;
}

function OpenStatus({ entry }: { readonly entry: OverviewToday['entries'][number] }) {
  const theme = useLifePlannerTheme();
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  if (entry.plannedMinute === null) {
    return <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>anytime</Text>;
  }
  const difference = nowMinute - entry.plannedMinute;
  return <Text style={[styles.caption, { color: difference > 0 ? theme.today.attentionText : theme.today.secondaryText }]}>
    {difference > 0 ? overviewDeltaText(difference) : overviewCountdownText(-difference)}
  </Text>;
}

function DotLine({ label, color, tinted = false }: { readonly label: string; readonly color: string; readonly tinted?: boolean }) {
  const theme = useLifePlannerTheme();
  return <View style={styles.dotLine}>
    <View style={[styles.dot, { backgroundColor: color }]} />
    <Text style={[styles.label, { color: tinted ? color : theme.today.primaryText }]}>{label}</Text>
  </View>;
}

function StreakPanel({ analytics, today }: { readonly analytics: PlannerOverviewAnalytics | null; readonly today: PlannerLocalDate }) {
  const theme = useLifePlannerTheme();
  const days = (analytics?.days ?? []).filter((day) => day.localDate <= today).slice(-30);
  const closed = days.filter((day) => day.fullyClosed).length;
  return <>
    <PanelLead subtitle="A day counts when every activity with a planned time was closed" title="Days closed end to end" />
    <View style={styles.hugeRow}>
      <Text style={[styles.huge, { color: theme.today.completion }]}>{analytics?.streak.current ?? 0}</Text>
      <Text style={[styles.label, styles.hugeCaption, { color: theme.today.tertiaryText }]}>
        {overviewStreakLead(analytics?.streak.current ?? 0)}
      </Text>
    </View>
    <PanelCard subtitle="Filled means the day closed completely" title="Last 30 days">
      <View style={styles.grid}>
        {days.map((day) => <View
          key={day.localDate}
          style={[styles.gridCell, day.localDate === today && !day.fullyClosed
            ? { borderColor: theme.today.completion, borderWidth: 2 }
            : { backgroundColor: day.fullyClosed ? theme.today.completion : theme.today.tone200 }]}
        />)}
      </View>
      <View style={styles.footerRow}>
        <Text style={[styles.label, styles.closureName, { color: theme.today.primaryText }]}>{closed} of {days.length} days closed</Text>
        <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>longest run {analytics?.streak.longest ?? 0}</Text>
      </View>
    </PanelCard>
    {(analytics?.streak.breaks.length ?? 0) === 0 ? null : <PanelCard title="What broke the last runs">
      {(analytics?.streak.breaks ?? []).map((entry) => <View key={entry.localDate} style={styles.breakRow}>
        <Text style={[styles.caption, styles.breakDate, { color: theme.today.tertiaryText }]}>{formatPlannerDate(entry.localDate, 'short')}</Text>
        <Text numberOfLines={2} style={[styles.label, styles.closureName, { color: theme.today.primaryText }]}>
          {entry.activityNames.length === 0 ? 'nothing recorded' : entry.activityNames.join(', ')}
        </Text>
      </View>)}
    </PanelCard>}
    <Footnote>
      Activities with no planned time cannot break a run — they have no deadline to miss. Tasks never count.
    </Footnote>
  </>;
}

function RecordsPanel({ period, grain, onGrain, drill, onDrill }: {
  readonly period: OverviewPeriod;
  readonly grain: OverviewGrain;
  readonly onGrain: (grain: OverviewGrain) => void;
  readonly drill: number | null;
  readonly onDrill: (index: number | null) => void;
}) {
  const theme = useLifePlannerTheme();
  const setDrill = onDrill;
  const bar = drill === null ? null : period.bars[drill] ?? null;

  if (bar !== null) return <>
    <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setDrill(null)} style={styles.backRow}>
      <Ionicons color={theme.today.system} name="chevron-back" size={16} />
      <Text style={[styles.label, { color: theme.today.system }]}>
        {grain === 'week' ? 'Week' : grain === 'month' ? 'Month' : 'Year'}
      </Text>
    </Pressable>
    <PanelLead
      subtitle={grain === 'week' ? 'That day, activity by activity' : grain === 'month' ? 'That week, day by day' : 'That month, week by week'}
      title={bar.longLabel}
    />
    <View style={styles.hugeRow}>
      <Text style={[styles.huge, { color: theme.today.completion }]}>{bar.percent ?? 0}%</Text>
      <Text style={[styles.label, styles.hugeCaption, { color: theme.today.tertiaryText }]}>
        {bar.closed} of {bar.scheduled} closed, early or late
      </Text>
    </View>
    <DrillDetail days={bar.days} grain={grain} />
    <Footnote>
      A day&apos;s figure counts everything closed, early or late — the same rule the bar above it uses. The drill stops
      at a day, because a day is where facts live rather than aggregates.
    </Footnote>
  </>;

  return <>
    <PanelLead subtitle="The same two numbers at three grains — days closed, and the share closed on time" title="What your record looks like" />
    <GrainSegment grain={grain} onGrain={onGrain} reduceMotion={false} />
    <View style={styles.hugeRow}>
      <Text style={[styles.huge, { color: theme.today.completion }]}>{period.percent}%</Text>
      <Text style={[styles.label, styles.hugeCaption, { color: theme.today.tertiaryText }]}>{period.caption}</Text>
    </View>
    <PanelCard title={grain === 'week' ? 'Day by day' : grain === 'month' ? 'Week by week' : 'Month by month'}>
      <RecordBars bars={period.bars} height={104} longLabels={grain !== 'year'} onSelect={setDrill} />
      <View style={[styles.panelFooter, { borderTopColor: theme.today.separator }]}>
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
    </PanelCard>
    <Footnote>
      Every bar is a door: open one to see the unit below it. Tasks are never counted here — Overview counts activities.
    </Footnote>
  </>;
}

/**
 * One level down. A week opens into its days, a month into its weeks, and a day
 * into the facts it actually holds — which is where the drill stops.
 */
function DrillDetail({ days, grain }: { readonly days: readonly PlannerOverviewDayFact[]; readonly grain: OverviewGrain }) {
  const theme = useLifePlannerTheme();
  if (grain === 'week') {
    const day = days[0];
    if (day === undefined) return null;
    return <PanelCard subtitle="What the day carried" title="That day">
      <DrillLine label="Scheduled" value={`${day.scheduled}`} />
      <DrillLine label="Closed" value={`${day.closed}`} />
      <DrillLine label="Closed on time" value={day.punctualityMeasured === 0 ? '—' : `${day.onTime} of ${day.punctualityMeasured}`} />
      <DrillLine label="Recorded on another day" value={`${day.backFilled}`} />
      {day.missedNames.length === 0 ? null : <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>
        Left open: {day.missedNames.join(', ')}
      </Text>}
    </PanelCard>;
  }
  return <PanelCard subtitle="Day by day" title={grain === 'month' ? 'That week' : 'That month'}>
    {days.map((day) => <View key={day.localDate} style={styles.drillRow}>
      <Text style={[styles.caption, styles.breakDate, { color: theme.today.tertiaryText }]}>{formatPlannerDate(day.localDate, 'short')}</Text>
      <Text style={[styles.label, styles.closureName, { color: theme.today.primaryText }]}>
        {day.scheduled === 0 ? 'nothing planned' : `${day.closed} of ${day.scheduled} closed`}
      </Text>
      <Text style={[styles.label, { color: day.fullyClosed ? theme.today.completion : theme.today.tertiaryText }]}>
        {day.scheduled === 0 ? '—' : `${Math.round((day.closed / day.scheduled) * 100)}%`}
      </Text>
    </View>)}
  </PanelCard>;
}

function DrillLine({ label, value }: { readonly label: string; readonly value: string }) {
  const theme = useLifePlannerTheme();
  return <View style={styles.drillRow}>
    <Text style={[styles.label, styles.closureName, { color: theme.today.secondaryText }]}>{label}</Text>
    <Text style={[styles.label, { color: theme.today.primaryText }]}>{value}</Text>
  </View>;
}

function BestHoursPanel({ windows, onOpenActivities }: {
  readonly windows: ReturnType<typeof selectOverviewWindows>;
  readonly onOpenActivities: () => void;
}) {
  const theme = useLifePlannerTheme();
  const sample = windows.reduce((total, window) => total + window.planned, 0);
  const best = windows[0];
  const worst = windows[windows.length - 1];
  // An empty card opens on an empty panel rather than on a page of zeroes: the
  // owner keeps the card in place, and the honest content of it is one sentence.
  if (sample === 0) return <>
    <PanelLead subtitle="Nothing with a planned time has come due yet" title="When you actually deliver" />
    <PanelCard subtitle="Share of planned activities you closed in each window" title="Part of the day">
      <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>
        The four windows are fixed — 06:00–10:00, 10:00–17:00, 17:00–22:00, 22:00–06:00 — and they fill in as days
        close. An activity with no planned time has no window, and tasks are excluded entirely.
      </Text>
    </PanelCard>
  </>;
  return <>
    <PanelLead subtitle={`Last 120 days · ${sample} activities with a planned time`} title="When you actually deliver" />
    {best === undefined ? null : <View style={styles.hugeRow}>
      <Text style={[styles.huge, { color: theme.today.completion }]}>{best.percent}%</Text>
      <Text style={[styles.label, styles.hugeCaption, { color: theme.today.tertiaryText }]}>
        of what you plan between {best.label} gets done
      </Text>
    </View>}
    <PanelCard subtitle="Share of planned activities you closed in each window" title="Part of the day">
      {windows.map((window, index) => <View key={window.key} style={styles.windowBlock}>
        <View style={styles.footerRow}>
          <Text style={[styles.label, styles.closureName, {
            color: index === windows.length - 1 && window.percent < 50 ? theme.today.attentionText : theme.today.primaryText,
          }]}>
            {window.label}
          </Text>
          <Text style={[styles.label, { color: theme.today.primaryText }]}>{window.percent}%</Text>
        </View>
        <View style={[styles.windowTrack, { backgroundColor: theme.today.tone200 }]}>
          <View style={[styles.windowFill, {
            backgroundColor: index === windows.length - 1 && window.percent < 50 ? theme.today.attentionText : theme.today.completion,
            width: `${window.percent}%`,
          }]} />
        </View>
        <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>{window.closed} of {window.planned}</Text>
      </View>)}
    </PanelCard>
    <Footnote>
      The windows are fixed, not learned. An activity with no planned time has no window and is not counted, and tasks
      are excluded entirely.
      {worst === undefined || worst.percent >= 50 ? '' : ` Most of what you lose sits in ${worst.label}.`}
    </Footnote>
    <Pressable accessibilityRole="button" onPress={onOpenActivities}>
      <Text style={[styles.textAction, { color: theme.today.system }]}>Move something out of your worst window</Text>
    </Pressable>
  </>;
}

function SlippingPanel({ slips, onOpenActivities }: {
  readonly slips: ReturnType<typeof selectOverviewSlips>;
  readonly onOpenActivities: () => void;
}) {
  const theme = useLifePlannerTheme();
  const misses = slips.reduce((total, slip) => total + slip.missedDays, 0);
  if (misses === 0) return <>
    <PanelLead subtitle="Nothing has been missed yet" title="What keeps not happening" />
    <PanelCard subtitle="Share of the days it was planned and actually happened" title="How often each one happens">
      <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>
        A miss is a scheduled day that ends with nothing recorded. Today is never counted — it has not ended — and days
        before an activity existed are not counted either. Tasks never appear here.
      </Text>
    </PanelCard>
  </>;
  const leaders = slips.slice(0, 3);
  const leaderMisses = leaders.reduce((total, slip) => total + slip.missedDays, 0);
  const ordered = slips.slice().sort((left, right) => right.percent - left.percent);
  return <>
    <PanelLead subtitle={`Last 120 days · ${misses} misses across ${slips.length} activities`} title="What keeps not happening" />
    <View style={styles.hugeRow}>
      <Text style={[styles.huge, { color: theme.today.attentionText }]}>{leaders.length}</Text>
      <Text style={[styles.label, styles.hugeCaption, { color: theme.today.tertiaryText }]}>
        activities account for {leaderMisses} of your {misses} misses
      </Text>
    </View>
    <PanelCard subtitle="Share of the days it was planned and actually happened" title="How often each one happens">
      {ordered.map((slip) => <View key={slip.habitId} style={styles.windowBlock}>
        <View style={styles.footerRow}>
          <Text numberOfLines={1} style={[styles.label, styles.closureName, { color: theme.today.primaryText }]}>{slip.name}</Text>
          <Text style={[styles.label, { color: theme.today.primaryText }]}>{slip.percent}%</Text>
        </View>
        {/* The bar is completion, not misses: a long bar is good. A miss bar reading
            10 % was read as "you only did 10 %". */}
        <View style={[styles.windowTrack, { backgroundColor: theme.today.tone200 }]}>
          <View style={[styles.windowFill, { backgroundColor: theme.today.completion, width: `${slip.percent}%` }]} />
        </View>
        <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>
          {slip.closedDays} of {slip.scheduledDays} days · <Text style={{ color: theme.today.attentionText }}>{slip.missedDays} missed</Text>
        </Text>
      </View>)}
    </PanelCard>
    <Footnote>
      A miss is a scheduled day with nothing recorded by midnight. Days before an activity existed are not counted, and
      tasks never appear here.
    </Footnote>
    <Pressable accessibilityRole="button" onPress={onOpenActivities}>
      <Text style={[styles.textAction, { color: theme.today.system }]}>Open these in All activities</Text>
    </Pressable>
  </>;
}

const styles = StyleSheet.create({
  backRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  bigNumber: { fontSize: 44, fontWeight: '700', letterSpacing: -1.2, lineHeight: 48 },
  breakDate: { width: 96 },
  breakRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, paddingVertical: 6 },
  caption: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  closureHeader: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  closureName: { flex: 1 },
  closureRow: { gap: 2, paddingVertical: 8 },
  content: { gap: 16, paddingBottom: 40, paddingHorizontal: 16, paddingTop: 4 },
  dot: { borderRadius: 4.5, height: 9, width: 9 },
  dotLine: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  dotLines: { gap: 6 },
  drillRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 30 },
  footerRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  footnote: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  grabber: { borderRadius: 3, height: 5, width: 40 },
  grabberArea: { alignItems: 'center', gap: 6, paddingBottom: 12, paddingHorizontal: 16, paddingTop: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gridCell: { borderRadius: 4, height: 22, width: 22 },
  hint: { fontSize: 13, fontWeight: '500' },
  huge: { fontSize: 52, fontWeight: '700', letterSpacing: -1.6, lineHeight: 54 },
  hugeCaption: { flex: 1 },
  hugeRow: { alignItems: 'baseline', flexDirection: 'row', gap: 10 },
  label: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  lead: { gap: 4 },
  leadTitle: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  loadRow: { alignItems: 'baseline', flexDirection: 'row', gap: 6 },
  loadValue: { fontWeight: '600' },
  openRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 38 },
  openTime: { fontSize: 13, fontWeight: '600', width: 46 },
  panel: { flex: 1 },
  panelCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, gap: 10, padding: 16 },
  panelCardHeader: { gap: 2 },
  panelFooter: { borderTopWidth: 1, gap: 2, paddingTop: 12 },
  segmentBar: { borderRadius: 2, flex: 1, height: 12 },
  segments: { flexDirection: 'row', gap: 3 },
  textAction: { fontSize: 15, fontWeight: '600' },
  window: { overflow: 'hidden', position: 'absolute' },
  windowBlock: { gap: 4 },
  windowFill: { borderRadius: 4, height: '100%' },
  windowTrack: { borderRadius: 4, height: 8, overflow: 'hidden' },
});
