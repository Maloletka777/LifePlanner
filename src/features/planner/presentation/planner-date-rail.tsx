import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { beginPlannerRenderWindow, endPlannerRenderWindow, type PlannerLocalDate } from '@/src/features/planner';
import { IconButton, PrimaryButton, SecondaryButton } from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import type { PlannerDateSummary } from './planner-provider';
import { isPlannerDateInRailWindow } from './planner-date-state';
import { formatPlannerDate, formatPlannerDateEntry, isCurrentDateRailSettlement, movePlannerDate, movePlannerMonth, nativeDateRailDayOffset, plannerDateRailCenterIndex, plannerDateRailInitialIndex, plannerLocalDateFromDevice, plannerMonthGrid, PLANNER_DATE_RAIL_VISIBLE_CELLS } from './ui-adapters';

const PLANNER_DATE_RAIL_WINDOW_DAYS = 21;
/**
 * Equal 51.6 pt slots, one 61 pt pill.
 *
 * The pill overhangs its layout slot by about 5 pt each side, so the selected date
 * gets visible room without the row re-laying out. `snapToInterval`, `getItemLayout`
 * and `nativeDateRailDayOffset` therefore stay valid (§0 spike, Option A).
 */
const PLANNER_DATE_PILL_WIDTH = 61;
/** One curve for the whole gesture: the pill travels, the day number grows. */
const RAIL_TRAVEL_EASING = Easing.bezier(0.32, 0.72, 0, 1);
/**
 * One gesture, and it is meant to be seen. 300 ms read as the interface stuttering
 * rather than as a page being turned, so selection now takes 640 ms — slower than
 * it feels it should be, which is the point.
 */
export const PLANNER_SELECTION_DURATION = 640;
/** The number is drawn at 26 pt and scaled to 17 pt when it is not the day. */
const PLANNER_NUMBER_REST_SCALE = 17 / 26;

export function PlannerDateRail({ selectedDate, railAnchorDate, summaries, onBrowse, onSelect, onReturnToToday }: {
  readonly selectedDate: PlannerLocalDate;
  readonly railAnchorDate: PlannerLocalDate;
  readonly summaries: Readonly<Record<string, PlannerDateSummary>>;
  readonly onBrowse: (date: PlannerLocalDate) => void;
  readonly onSelect: (date: PlannerLocalDate) => void;
  readonly onReturnToToday?: () => void;
}) {
  const theme = useLifePlannerTheme();
  const { fontScale, width } = useWindowDimensions();
  // §0 spike, Option A: every cell keeps an equal layout slot, so snapToInterval,
  // getItemLayout, nativeDateRailDayOffset, recenter() and the canonical
  // settlement guard are all untouched. The selected day reads as larger through
  // the pill that overhangs its slot and through its 26 pt number, never through
  // extra width.
  const cellWidth = Math.max(44, (width - theme.layout.screen.inlinePadding * 2) / 7);
  const pillWidth = Math.max(PLANNER_DATE_PILL_WIDTH, cellWidth);
  const railHeight = fontScale >= 1.35 ? 86 : 74;
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const listRef = useRef<Animated.FlatList<PlannerLocalDate>>(null);
  const railAnchorDateRef = useRef(railAnchorDate);
  const interactionAnchorRef = useRef(railAnchorDate);
  const interactionTokenRef = useRef(0);
  const endDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = new Date(`${railAnchorDate}T12:00:00`);
  const today = plannerLocalDateFromDevice();
  const dates = useMemo(() => Array.from({ length: PLANNER_DATE_RAIL_WINDOW_DAYS }, (_, index) => movePlannerDate(railAnchorDate, index - plannerDateRailCenterIndex(PLANNER_DATE_RAIL_WINDOW_DAYS))), [railAnchorDate]);
  const initialIndex = plannerDateRailInitialIndex(PLANNER_DATE_RAIL_WINDOW_DAYS);
  const initialOffset = initialIndex * cellWidth;

  // One white pill on its own layer. It lives in content coordinates — its screen
  // position is the selected slot minus the rail's scroll offset — so it stays glued
  // to its date while the rail is browsed and travels only when a date is selected.
  const selectedIndex = dates.indexOf(selectedDate);
  const slotOffset = (index: number) => index * cellWidth + (cellWidth - pillWidth) / 2;
  const scrollX = useRef(new Animated.Value(initialOffset)).current;
  // Driven natively. Setting this from an `onScroll` callback meant a JS round
  // trip every frame of every browse, and the pill's own travel was JS-driven too
  // — together that is the tearing on a date change. Both ends are native now, so
  // `Animated.subtract` composes without crossing the bridge at all.
  //
  // The list itself has to be an `Animated` component for that: a native
  // `onScroll` on a plain `VirtualizedList` throws at render, which is the crash
  // on opening Planner.
  const scrollHandler = useRef(
    Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true }),
  ).current;
  const pillX = useRef(new Animated.Value(slotOffset(selectedIndex < 0 ? initialIndex : selectedIndex))).current;
  const pillOpacity = useRef(new Animated.Value(selectedIndex < 0 ? 0 : 1)).current;
  const pillScale = useRef(new Animated.Value(1)).current;
  const pillAnchorRef = useRef(railAnchorDate);
  const previousSelectionRef = useRef({ date: selectedDate, index: selectedIndex });

  const clearEndDragTimer = useCallback(() => {
    if (endDragTimerRef.current !== null) clearTimeout(endDragTimerRef.current);
    endDragTimerRef.current = null;
  }, []);

  const recenter = useCallback(() => {
    listRef.current?.scrollToOffset({ animated: false, offset: initialOffset });
    scrollX.setValue(initialOffset);
  }, [initialOffset, scrollX]);

  useEffect(() => {
    railAnchorDateRef.current = railAnchorDate;
    interactionTokenRef.current += 1;
    clearEndDragTimer();
    requestAnimationFrame(recenter);
  }, [clearEndDragTimer, railAnchorDate, recenter]);

  useEffect(() => () => clearEndDragTimer(), [clearEndDragTimer]);
  useEffect(() => () => { if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current); }, []);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  // One pill, three ways for it to arrive.
  //
  // · Travel — the date it left is still on screen beside the date it is going to,
  //   so it slides from one slot to the other over 300 ms.
  // · Fly-in — there is no old slot on screen to leave from, so it enters from
  //   beyond the rail edge on the side the old date sits, growing 0.55 → 1.
  // · Commit — only the window moved under it. Settlement rebuilds the dates and
  //   recentres in the same frame, so the pill's screen position never changed and
  //   animating here would invent a jump.
  useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = { date: selectedDate, index: selectedIndex };
    const previousAnchor = pillAnchorRef.current;
    const anchorChanged = previousAnchor !== railAnchorDate;
    pillAnchorRef.current = railAnchorDate;
    if (selectedIndex < 0) {
      // Outside the window the pill is simply absent; it never sits on an edge.
      pillOpacity.setValue(0);
      return;
    }
    const target = slotOffset(selectedIndex);
    if (reduceMotion) {
      pillOpacity.setValue(1);
      pillX.setValue(target);
      pillScale.setValue(1);
      return;
    }
    const selectionChanged = previous.date !== selectedDate;
    // The rail holds still for a selection inside its own window, which is the only
    // case where both slots exist in one frame. Everything else — a month-sheet
    // jump, a date left behind by browsing — has nothing on screen to travel from.
    const travelsFromItsOldSlot = selectionChanged
      && !anchorChanged
      && previous.index >= 0
      && isPlannerDateInRailWindow(previousAnchor, previous.date);
    if (travelsFromItsOldSlot) {
      pillOpacity.setValue(1);
    } else if (selectionChanged || previous.index < 0) {
      const fromBefore = previous.date < selectedDate;
      const railWidth = PLANNER_DATE_RAIL_VISIBLE_CELLS * cellWidth;
      pillX.setValue(initialOffset + (fromBefore ? -(pillWidth + 8) : railWidth + 8));
      pillScale.setValue(0.55);
      pillOpacity.setValue(0);
    } else {
      pillOpacity.setValue(1);
      pillX.setValue(target);
      pillScale.setValue(1);
      return;
    }
    const travel = Animated.parallel([
      Animated.timing(pillX, { duration: PLANNER_SELECTION_DURATION, easing: RAIL_TRAVEL_EASING, toValue: target, useNativeDriver: true }),
      Animated.timing(pillScale, { duration: PLANNER_SELECTION_DURATION, easing: RAIL_TRAVEL_EASING, toValue: 1, useNativeDriver: true }),
      // Fully opaque by 70 % of the path, so it is solid well before it lands.
      Animated.timing(pillOpacity, { duration: Math.round(PLANNER_SELECTION_DURATION * 0.33), easing: RAIL_TRAVEL_EASING, toValue: 1, useNativeDriver: true }),
    ]);
    travel.start();
    return () => travel.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellWidth, initialOffset, pillOpacity, pillScale, pillWidth, pillX, railAnchorDate, reduceMotion, selectedDate, selectedIndex]);

  const settleNativeScroll = useCallback((contentOffsetX: number, token: number, anchorDate: PlannerLocalDate) => {
    if (!isCurrentDateRailSettlement(anchorDate, railAnchorDateRef.current, token, interactionTokenRef.current)) return;
    const dayOffset = nativeDateRailDayOffset(contentOffsetX, cellWidth, PLANNER_DATE_RAIL_WINDOW_DAYS);
    if (dayOffset === 0) recenter();
    else onBrowse(movePlannerDate(anchorDate, dayOffset));
    endPlannerRenderWindow();
  }, [cellWidth, onBrowse, recenter]);

  const beginNativeScroll = useCallback(() => {
    clearEndDragTimer();
    beginPlannerRenderWindow();
    interactionTokenRef.current += 1;
    interactionAnchorRef.current = railAnchorDateRef.current;
  }, [clearEndDragTimer]);

  const endNativeDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const token = interactionTokenRef.current;
    const anchorDate = interactionAnchorRef.current;
    const nativeEvent = event.nativeEvent as NativeScrollEvent & { readonly targetContentOffset?: { readonly x: number } };
    const finalOffset = nativeEvent.targetContentOffset?.x ?? nativeEvent.contentOffset.x;
    clearEndDragTimer();
    endDragTimerRef.current = setTimeout(() => settleNativeScroll(finalOffset, token, anchorDate), 90);
  }, [clearEndDragTimer, settleNativeScroll]);

  const endNativeMomentum = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    clearEndDragTimer();
    settleNativeScroll(event.nativeEvent.contentOffset.x, interactionTokenRef.current, interactionAnchorRef.current);
  }, [clearEndDragTimer, settleNativeScroll]);

  // Acknowledgement first, content after: the selection haptic fires at settle and
  // the list refresh follows it, never the other way round.
  const pressDate = useCallback((date: PlannerLocalDate) => {
    // An explicit tap outranks a settlement that has not run yet. A tap no longer
    // moves the anchor, so it no longer invalidates a pending browse by itself, and
    // without this the rail would scroll out from under the date just chosen.
    clearEndDragTimer();
    interactionTokenRef.current += 1;
    onSelect(date);
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => { void Haptics.selectionAsync(); }, reduceMotion ? 0 : 200);
  }, [clearEndDragTimer, onSelect, reduceMotion]);

  return <View style={{ gap: theme.spacing.xs }}>
    <View style={styles.header}>
      <Pressable
        accessibilityHint="Opens the full date picker."
        accessibilityLabel={`${anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}, choose date`}
        accessibilityRole="button"
        onPress={() => setCalendarVisible(true)}
        style={({ pressed }) => [styles.monthButton, { backgroundColor: pressed ? theme.today.pressedSurface : 'transparent' }]}
      >
        <Text style={[theme.typography.headline, { color: theme.today.primaryText }]}>{anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <Ionicons color={theme.today.tertiaryText} name="chevron-down" size={16} />
      </Pressable>
      {onReturnToToday === undefined ? null : <Pressable
        accessibilityLabel="Return to today"
        accessibilityRole="button"
        onPress={onReturnToToday}
        style={({ pressed }) => [styles.todayAction, { backgroundColor: pressed ? theme.today.pressedSurface : 'transparent' }]}
      >
        <Text style={[theme.typography.label, { color: theme.today.system }]}>Today</Text>
      </Pressable>}
    </View>
    <View style={[styles.railStack, { height: railHeight }]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.pill, {
          // `dashboardSurface` is a blue-grey in Dusk, and on that brown ground it
          // read as a foreign patch rather than as the selected day. The theme's
          // own accent tint holds the shape in every palette; the border does the
          // work the shadow used to, which on a dark ground only made dirt.
          backgroundColor: theme.today.completionTint,
          borderColor: reduceMotion ? theme.today.completion : theme.today.segmentTrack,
          borderWidth: reduceMotion ? 2 : 1,
          height: railHeight,
          opacity: pillOpacity,
          shadowColor: theme.dark ? 'transparent' : theme.colors.shadow,
          shadowOpacity: theme.dark ? 0 : 0.1,
          transform: [{ translateX: Animated.subtract(pillX, scrollX) }, { scale: pillScale }],
          width: pillWidth,
        }]}
      />
      <Animated.FlatList
      ref={listRef}
      accessibilityLabel="Planner date rail. Swipe horizontally to browse dates, then tap a date to select it."
      data={dates}
      decelerationRate="fast"
      disableIntervalMomentum={false}
      directionalLockEnabled
      getItemLayout={(_, index) => ({ index, length: cellWidth, offset: cellWidth * index })}
      horizontal
      initialNumToRender={21}
      initialScrollIndex={initialIndex}
      keyExtractor={(date) => date}
      maxToRenderPerBatch={21}
      nestedScrollEnabled
      onMomentumScrollBegin={clearEndDragTimer}
      onMomentumScrollEnd={endNativeMomentum}
      onScroll={scrollHandler}
      onScrollBeginDrag={beginNativeScroll}
      onScrollEndDrag={endNativeDrag}
      onScrollToIndexFailed={() => recenter()}
      removeClippedSubviews={false}
      scrollEnabled
      scrollEventThrottle={16}
      renderItem={({ item: date }) => <PlannerDateCell
        date={date}
        height={railHeight}
        isSelected={date === selectedDate}
        isToday={date === today}
        onPress={() => pressDate(date)}
        reduceMotion={reduceMotion}
        summary={summaries[date]}
        width={cellWidth}
      />}
      showsHorizontalScrollIndicator={false}
      snapToAlignment="start"
      snapToInterval={cellWidth}
      style={[styles.railViewport, { height: railHeight }]}
      windowSize={5}
    />
    </View>
    <MonthCalendarSheet selectedDate={selectedDate} visible={calendarVisible} onCancel={() => setCalendarVisible(false)} onDone={(date) => { setCalendarVisible(false); onSelect(date); }} />
  </View>;
}

/**
 * One date, and nothing else.
 *
 * The rail carries no markers and no progress dots — a dot under a date does not
 * survive a busy month (motion prototype correction 1). `PlannerDateSummary`, its
 * indicators and its bounded range request stay in the code, unread by this cell
 * except for the spoken summary.
 *
 * Selection is a movement rather than a repaint. The cell owns no pill: one shared
 * pill travels to the tapped date, and the cell only grows its day number by font
 * size, never by transform, so the glyph stays sharp and its baseline holds. Press
 * is a 60 ms tint under the finger and nothing else — resizing the number on press
 * and again on select was two movements where one was needed.
 *
 * Reduce Motion commits in one frame; the travelling pill keeps a 2 pt ring so
 * selection is still carried without tone.
 */
function PlannerDateCell({ date, summary, width, height, isSelected, isToday, reduceMotion, onPress }: {
  readonly date: PlannerLocalDate;
  readonly summary: PlannerDateSummary | undefined;
  readonly width: number;
  readonly height: number;
  readonly isSelected: boolean;
  readonly isToday: boolean;
  readonly reduceMotion: boolean;
  readonly onPress: () => void;
}) {
  const theme = useLifePlannerTheme();
  const current = new Date(`${date}T12:00:00`);
  // One constant letter: a label that reflows mid-travel breaks the single moving object.
  const weekday = current.toLocaleDateString(undefined, { weekday: 'narrow' });
  const scheduled = summary?.scheduled ?? 0;
  const completed = summary?.completed ?? 0;
  const restNumberColor = isToday ? theme.today.completion : theme.today.secondaryText;
  const restCapColor = isToday ? theme.today.completion : theme.today.tertiaryText;
  const selection = useRef(new Animated.Value(isSelected ? 1 : 0)).current;
  useEffect(() => {
    const target = isSelected ? 1 : 0;
    if (reduceMotion) {
      selection.setValue(target);
      return;
    }
    const grow = Animated.timing(selection, {
      duration: PLANNER_SELECTION_DURATION,
      easing: RAIL_TRAVEL_EASING,
      toValue: target,
      useNativeDriver: true,
    });
    grow.start();
    return () => grow.stop();
  }, [isSelected, reduceMotion, selection]);
  return <Pressable
    accessibilityLabel={`${formatPlannerDate(date)}, ${scheduled} planned, ${completed} done`}
    accessibilityRole="button"
    accessibilityState={{ selected: isSelected }}
    onPress={onPress}
    style={[styles.cell, { height, width }]}
  >
    {({ pressed }) => <>
      <View style={[styles.pressTint, {
        backgroundColor: pressed && !isSelected ? theme.today.tone100 : 'transparent',
      }]}
      />
      <Text style={[styles.cap, {
        color: isSelected ? theme.today.secondaryText : restCapColor,
        fontWeight: isSelected || isToday ? '600' : '400',
      }]}
      >
        {weekday.toLocaleUpperCase()}
      </Text>
      {/* The number is drawn at its selected size and scaled down when it is not
          the day: a transform, so nothing is relaid out, and the glyph stays
          sharp because it is never re-rasterised at a fractional point size. */}
      <Animated.Text
        allowFontScaling={false}
        style={[styles.number, {
          color: isSelected ? theme.today.completion : restNumberColor,
          fontWeight: isSelected ? '700' : isToday ? '600' : '400',
          transform: [{ scale: selection.interpolate({ inputRange: [0, 1], outputRange: [PLANNER_NUMBER_REST_SCALE, 1] }) }],
        }]}
      >
        {current.getDate()}
      </Animated.Text>
    </>}
  </Pressable>;
}

function MonthCalendarSheet({ selectedDate, visible, onCancel, onDone }: { readonly selectedDate: PlannerLocalDate; readonly visible: boolean; readonly onCancel: () => void; readonly onDone: (date: PlannerLocalDate) => void }) {
  const theme = useLifePlannerTheme(); const initialYear = Number(selectedDate.slice(0, 4)); const initialMonth = Number(selectedDate.slice(5, 7)); const [draft, setDraft] = useState(selectedDate); const [month, setMonth] = useState({ year: initialYear, month: initialMonth });
  useEffect(() => { if (visible) { setDraft(selectedDate); setMonth({ year: Number(selectedDate.slice(0, 4)), month: Number(selectedDate.slice(5, 7)) }); } }, [selectedDate, visible]);
  const cells = plannerMonthGrid(month.year, month.month);
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}><SafeAreaView style={[styles.sheet, { backgroundColor: theme.colors.background }]}><View style={styles.header}><SecondaryButton title="Cancel" onPress={onCancel} /><Text style={[theme.typography.headline, { color: theme.colors.text }]}>Choose date</Text><PrimaryButton title="Done" onPress={() => onDone(draft)} /></View><View style={styles.header}><IconButton icon="chevron-back" label="Previous month" onPress={() => setMonth(movePlannerMonth(month.year, month.month, -1))} /><Text style={[theme.typography.headline, { color: theme.colors.text }]}>{new Date(month.year, month.month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text><IconButton icon="chevron-forward" label="Next month" onPress={() => setMonth(movePlannerMonth(month.year, month.month, 1))} /></View><View style={styles.grid}>{['M','T','W','T','F','S','S'].map((label, index) => <Text key={`${label}-${index}`} style={[styles.gridCell, theme.typography.caption, { color: theme.colors.tertiaryText }]}>{label}</Text>)}{cells.map((date,index) => date === null ? <View key={`blank-${index}`} style={styles.gridCell} /> : <Pressable key={date} accessibilityRole="button" accessibilityLabel={formatPlannerDateEntry(date)} accessibilityState={{ selected: draft === date }} onPress={() => setDraft(date)} style={[styles.gridCell, draft === date && { backgroundColor: theme.colors.accent, borderRadius: 22 }]}><Text style={[theme.typography.body, { color: draft === date ? theme.colors.onAccent : theme.colors.text }]}>{Number(date.slice(8))}</Text></Pressable>)}</View></SafeAreaView></Modal>;
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  monthButton: { alignItems: 'center', borderRadius: 12, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'flex-start', minHeight: 44, paddingHorizontal: 6 },
  todayAction: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  railStack: { overflow: 'hidden' },
  railViewport: { backgroundColor: 'transparent', flexGrow: 0, overflow: 'hidden' },
  pill: { borderRadius: 22, elevation: 2, left: 0, position: 'absolute', shadowOffset: { height: 2, width: 0 }, shadowOpacity: 0.1, shadowRadius: 8, top: 0 },
  cell: { alignItems: 'center', gap: 2, justifyContent: 'center', paddingVertical: 4 },
  pressTint: { borderRadius: 16, height: 58, position: 'absolute', width: 44 },
  cap: { fontSize: 11, letterSpacing: 0.3, lineHeight: 14 },
  number: { fontSize: 26, fontVariant: ['tabular-nums'], letterSpacing: -0.4, lineHeight: 32 },
  sheet: { flex: 1, gap: 16, padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { alignItems: 'center', height: 44, justifyContent: 'center', textAlign: 'center', width: '14.2857%' },
});
