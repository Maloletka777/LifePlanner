import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PlannerLocalDate } from '@/src/features/planner';
import { mixColors, useLifePlannerTheme, withAlpha } from '@/src/ui/theme';

import {
  dayJournalTaskHabitIds,
  journalCategoryColor,
  journalMonthCells,
  journalMonthLabel,
  journalMonthRail,
  journalMonthRailIndex,
  journalTaskMarkRow,
  journalTaskMarks,
  journalWeekdayIndex,
  JOURNAL_MONTH_RAIL_RADIUS,
  JOURNAL_WEEKDAY_LETTERS,
  selectDayJournalItems,
  type DayJournalItem,
  type DayJournalTaskMark,
} from './day-journal-model';
import { MonthTitle } from './month-title';
import { HABIT_SYMBOL_GLYPHS } from './planner-iconography';
import { usePlannerHabitCatalogue, usePlannerOccurrences } from './planner-provider';
import { plannerLocalDateToDate } from './ui-adapters';

/**
 * The calendar, opened from the month label and behaving the way the phone's own
 * does — the owner asked for its **functions**, not its look.
 *
 * Three of those functions matter and none of them existed: it fills the window
 * rather than sitting in a sheet, months are **swiped** rather than only stepped
 * with arrows, and under the chosen date it lists that day's items. The list is
 * **tasks only**: a habit is a rule that recurs and says nothing about one date, so
 * putting it here would make every day look identical.
 *
 * A task is not a stored kind — it is a one-day item, exactly what Create writes
 * for `Task` — so the list is the day's own occurrences filtered by the catalogue's
 * own answer to "is this habit's active range a single day".
 *
 * Picking a date does **not** close the calendar, because the list under it is the
 * reason to keep looking. `Done` carries the choice back to the journal.
 */
export function JournalCalendarScreen({ visible, selectedDate, today, onSelect, onClose }: {
  readonly visible: boolean;
  readonly selectedDate: PlannerLocalDate;
  readonly today: PlannerLocalDate;
  readonly onSelect: (date: PlannerLocalDate) => void;
  readonly onClose: () => void;
}) {
  const theme = useLifePlannerTheme();
  const [chosen, setChosen] = useState<PlannerLocalDate>(selectedDate);
  const [anchor, setAnchor] = useState<PlannerLocalDate>(selectedDate);
  const [railBase, setRailBase] = useState<PlannerLocalDate>(selectedDate);
  const opened = useRef(visible);
  if (visible && !opened.current) {
    setChosen(selectedDate);
    setAnchor(selectedDate);
    // The rail is re-laid **only on opening**. Rebuilding it from the live anchor would
    // churn the pages under the finger for the same reason the carousel did.
    setRailBase(selectedDate);
  }
  opened.current = visible;

  // Three pages — the month before, the month shown and the month after — so a
  // swipe has somewhere to go in either direction and the strip re-centres on
  // settle. A single page cannot be swiped; a whole year of pages costs memory a
  // calendar has no use for.
  // Held still on purpose. Settling on a month re-renders this screen several times
  // over — the anchor, the re-centring scroll, and a fresh catalogue query for each
  // of the three grids — and a style rebuilt inline would carry every one of those
  // repaints into the title, rebuilding its letters' native nodes in mid-flight.
  const monthTitleStyle = useMemo(
    () => [styles.monthTitle, { color: theme.today.primaryText }],
    [theme.today.primaryText],
  );
  const pager = useRef<FlatList<PlannerLocalDate>>(null);
  /**
   * **The page's width is measured, never taken from the window.**
   *
   * Every page computation here is against the width of the thing that actually pages. The
   * window is a different number the moment anything insets the sheet, and when the two
   * disagree the failure is silent and total: `pagingEnabled` snaps to multiples of one
   * width while the page is computed against another, so a settle rounds to the middle and
   * returns early. The runtime knows this number; asking it costs one frame.
   */
  const [pageWidth, setPageWidth] = useState(0);
  /** Which way the last change went, so the title can travel with the pages. */
  const [heading, setHeading] = useState<-1 | 0 | 1>(0);

  /**
   * **A stable rail, fixed when the sheet opens, and nothing re-centres.**
   *
   * The sheet used to hold the month shown and its two neighbours and re-centre on every
   * settle. On each change two of the three pages unmounted and one moved index, while the
   * re-centring `scrollTo` was issued against a subtree whose native views were being
   * rebuilt in the same commit — so the offset and the content drifted apart by exactly one
   * page. That is «назад и всё ещё август, а вперёд и стал июль»: one settle of lag,
   * reported precisely.
   *
   * The rail is built from the date the sheet **opened** on and never from the live anchor,
   * or it would churn for the same reason the carousel did. Every month keeps its identity
   * for the life of the sheet, the page index *is* the answer, and there is no ordering
   * left between a native scroll and a React commit.
   */
  const rail = useMemo(() => journalMonthRail(railBase), [railBase]);
  const openingIndex = JOURNAL_MONTH_RAIL_RADIUS;
  const anchorIndex = useMemo(() => journalMonthRailIndex(rail, anchor), [anchor, rail]);

  /**
   * **The list is asked which page it is showing. Nothing computes it.**
   *
   * Read frame by frame off the owner's recording (`docs/qa/evidence/баг.MP4`, decoded by
   * the weekday the 1st falls on): the **grid was right every time and the title was
   * wrong**, in both directions — at 5.53 s both said August, and one frame later the grid
   * still said August while the header had flipped to July; at 7.13 s both said August, and
   * a frame later the header said September. Two sources for one fact, and the arithmetic
   * one was losing.
   *
   * Every version of this screen computed the page as `Math.round(contentOffset.x / w)` and
   * then argued about which `w` to use — the window, then the measured pager. The rounding
   * itself is the fault: it is a second opinion about a number the list already holds, and
   * whenever the two opinions differ the header contradicts the grid under it. **The list
   * reports its own viewable page**; there is no width in this path at all, nothing to
   * round, and no way for the header to disagree with what is on screen.
   *
   * `onViewableItemsChanged` may not change identity between renders — React Native throws
   * on that — so the callback and its config are held in refs and read the live state
   * through `anchorIndexRef`.
   */
  const anchorIndexRef = useRef(0);
  anchorIndexRef.current = anchorIndex;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: readonly { index: number | null }[] }) => {
    const index = viewableItems.find((entry) => entry.index !== null)?.index;
    if (index === undefined || index === null) return;
    const settled = railRef.current[index];
    if (settled === undefined || settled === anchorRef.current) return;
    setHeading(index > anchorIndexRef.current ? 1 : -1);
    setAnchor(settled);
  }).current;
  const railRef = useRef(rail);
  railRef.current = rail;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  /**
   * **Animated, and it has to be.** iOS raises `onMomentumScrollEnd` from a finger's
   * deceleration and from the end of an *animated* programmatic scroll — never from a
   * non-animated one. A jump would otherwise move the rail and leave the month behind it,
   * which is the same lesson the week strip already carries.
   */
  const stepMonth = (offset: -1 | 1) => {
    if (pageWidth === 0 || anchorIndex < 0) return;
    const next = anchorIndex + offset;
    if (next < 0 || next >= rail.length) return;
    pager.current?.scrollToIndex({ animated: true, index: next });
  };

  // A page sheet rather than a full screen: full screen put the header under the
  // status bar and the Dynamic Island — a `Modal` starts its own view hierarchy,
  // so the safe area never reached it — and it could only be left through a
  // button. A page sheet is inset from the top by the system and is dismissed by
  // dragging it down, which is what the phone's own calendar does.
  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.today.appSurface }]}>
      <View style={[styles.grabber, { backgroundColor: theme.today.tone200 }]} />
      <View style={styles.header}>
        <Pressable accessibilityLabel="Close the calendar" accessibilityRole="button" onPress={onClose} style={styles.headerBack}>
          <Ionicons color={theme.today.system} name="chevron-back" size={20} />
          <Text style={[styles.headerBackText, { color: theme.today.system }]}>{plannerLocalDateToDate(anchor).getFullYear()}</Text>
        </Pressable>
        <Pressable accessibilityLabel="Go to today" accessibilityRole="button" onPress={() => { setChosen(today); setAnchor(today); }} style={styles.headerAction}>
          <Text style={[styles.headerActionText, { color: theme.today.system }]}>Today</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { onSelect(chosen); onClose(); }} style={styles.headerAction}>
          <Text style={[styles.headerActionText, styles.headerDone, { color: theme.today.system }]}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.titleRow}>
        {/* **The word is cross-faded, not typed.** It used to be erased and rewritten a
            letter at a time — two heads running along the word, one erasing and one
            writing three letters behind it. That belonged to a header where the month was
            the only thing that moved; here the *pages* already slide under the finger, and
            a title performing its own choreography on top of that is two animations
            narrating one event. One value, one fade, native driver. */}
        <View accessibilityLabel={journalMonthLabel(anchor)} accessibilityRole="header" style={styles.monthTitleRow}>
          <MonthTitle heading={heading} lineHeight={CALENDAR_TITLE_LINE} reservedWidth={CALENDAR_TITLE_WIDTH} text={journalMonthLabel(anchor)} textStyle={monthTitleStyle} />
        </View>
        <Pressable accessibilityLabel="Previous month" accessibilityRole="button" onPress={() => stepMonth(-1)} style={styles.arrow}>
          <Ionicons color={theme.today.tertiaryText} name="chevron-back" size={18} />
        </Pressable>
        <Pressable accessibilityLabel="Next month" accessibilityRole="button" onPress={() => stepMonth(1)} style={styles.arrow}>
          <Ionicons color={theme.today.tertiaryText} name="chevron-forward" size={18} />
        </Pressable>
      </View>
      <View style={styles.weekdayRow}>
        {JOURNAL_WEEKDAY_LETTERS.map((letter, index) => <Text
          key={`${letter}-${index}`}
          style={[styles.weekday, { color: index > 4 ? theme.today.tertiaryText : theme.today.secondaryText }]}
        >{letter}</Text>)}
      </View>

      {/* The width is measured on the wrapper, and the rail is only mounted once it is
          known — a `FlatList` needs a real page width before `getItemLayout` can answer,
          and answering it from a constant is the fault this screen was built on. */}
      <View onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)} style={styles.pager}>
        {pageWidth === 0 ? null : <FlatList
          data={rail}
          getItemLayout={(_unused, index) => ({ index, length: pageWidth, offset: pageWidth * index })}
          horizontal
          initialScrollIndex={openingIndex}
          keyExtractor={(month: PlannerLocalDate) => month}
          onViewableItemsChanged={onViewableItemsChanged}
          pagingEnabled
          ref={pager}
          renderItem={({ item }: { item: PlannerLocalDate }) => <MonthGrid
            chosen={chosen}
            month={item}
            onPick={setChosen}
            today={today}
            width={pageWidth}
          />}
          showsHorizontalScrollIndicator={false}
          viewabilityConfig={viewabilityConfig}
          // Two years of months is 49 pages and each one runs its own catalogue query, so
          // the list is windowed rather than drawn whole — which the carousel could not do
          // and is the second thing a rail buys.
          windowSize={3}
        />}
      </View>

      <View style={[styles.listDivider, { backgroundColor: theme.today.hairline }]} />
      <DayTasks date={chosen} />
    </SafeAreaView>
  </Modal>;
}

/** Room for a day with no tasks, so a cell never changes height. */
const CALENDAR_MARK_OVERLAP = -5;
const EMPTY_MARKS: readonly DayJournalTaskMark[] = Object.freeze([]);

function MonthGrid({ month, chosen, today, width, onPick }: {
  readonly month: PlannerLocalDate;
  readonly chosen: PlannerLocalDate;
  readonly today: PlannerLocalDate;
  readonly width: number;
  readonly onPick: (date: PlannerLocalDate) => void;
}) {
  const theme = useLifePlannerTheme();
  const cells = useMemo(() => journalMonthCells(month), [month]);
  // The same marks the week strip carries: one dot per task, in its own colour.
  const catalogue = usePlannerHabitCatalogue('', 'active', month);
  const marks = useMemo(() => journalTaskMarks(catalogue.data ?? []), [catalogue.data]);
  return <View style={[styles.grid, { width }]}>
    {cells.map((date, index) => {
      if (date === null) return <View key={`blank-${index}`} style={styles.cell} />;
      const selected = date === chosen;
      const isToday = date === today;
      const weekend = journalWeekdayIndex(date) > 4;
      return <Pressable
        accessibilityLabel={date}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        key={date}
        onPress={() => onPick(date)}
        style={styles.cell}
      >
        <View style={[styles.circle, {
          // **The calendar stopped painting structure green.** A selected date, today's
          // ring, «Today», «Done» and the year were all `completion` — the colour that
          // means *finished* and nothing else in this application (PD-PLATE-004). The
          // sheet simply never got repainted when structure lost its hue, so it was the
          // one surface still carrying the old accent.
          backgroundColor: selected ? theme.today.structFill : 'transparent',
          borderColor: !selected && isToday ? theme.today.structFill : 'transparent',
        }]}
        >
          <Text style={[styles.number, {
            color: selected ? theme.today.onAccent : isToday ? theme.today.system : weekend ? theme.today.tertiaryText : theme.today.primaryText,
            fontWeight: isToday || selected ? '700' : '500',
          }]}
          >{plannerLocalDateToDate(date).getDate()}</Text>
        </View>
        {/* **The same marks the strip carries**, at the same size and by the same
            rule: three fit, and from four it draws two and counts the rest. A dot said
            only how much was there; a mark says what — and a month whose cells and its
            week strip disagreed about how a day is drawn read as two calendars. */}
        <DayMarks marks={marks.get(date) ?? EMPTY_MARKS} />
      </Pressable>;
    })}
  </View>;
}

/**
 * Only the tasks of that day.
 *
 * A habit is a rule that recurs; listing it here would put the same eight rows
 * under every date and say nothing about the one that was chosen. A task belongs
 * to its day, which is exactly why it is written as a one-day item.
 */
/**
 * A day's tasks under its number, drawn exactly as the week strip draws them.
 *
 * Ringed and overlapping, three then two-plus-a-count. The ring is what makes the
 * overlap read as stacking, and it is the band's own wash on the strip and the screen's
 * ground here, because that is what each of them actually sits on.
 */
function DayMarks({ marks }: { readonly marks: readonly DayJournalTaskMark[] }) {
  const theme = useLifePlannerTheme();
  const row = journalTaskMarkRow(marks);
  const wash = theme.today.appSurface;
  const color = (mark: DayJournalTaskMark) => journalCategoryColor(
    mark.categoryKey,
    theme.habitAccents[mark.accentKey].selectedSwatch,
  );
  return <View style={styles.marks}>
    {row.shown.map((mark, index) => <View
      key={mark.habitId}
      style={[styles.mark, {
        backgroundColor: mixColors(wash, color(mark), 0.15),
        borderColor: color(mark),
        marginLeft: index === 0 ? 0 : CALENDAR_MARK_OVERLAP,
        shadowColor: wash,
      }]}
    >
      <Ionicons accessibilityElementsHidden color={color(mark)} name={markGlyph(mark)} size={10} />
    </View>)}
    {row.overflow === 0 ? null : <View
      style={[styles.mark, styles.markRest, {
        backgroundColor: mixColors(wash, theme.today.primaryText, 0.09),
        borderColor: withAlpha(theme.today.primaryText, 0.22),
        marginLeft: CALENDAR_MARK_OVERLAP,
        shadowColor: wash,
      }]}
    >
      <Text maxFontSizeMultiplier={1} style={[styles.markRestText, { color: theme.today.secondaryText }]}>{`+${row.overflow}`}</Text>
    </View>}
  </View>;
}

/** An emoji has no Ionicons name; a mark this small falls back to the generic symbol. */
function markGlyph(mark: DayJournalTaskMark) {
  const identity = mark.identity;
  if (identity !== null && identity.kind === 'symbol') {
    return HABIT_SYMBOL_GLYPHS[identity.symbolKey] ?? HABIT_SYMBOL_GLYPHS.habit_generic;
  }
  return HABIT_SYMBOL_GLYPHS.habit_generic;
}

function DayTasks({ date }: { readonly date: PlannerLocalDate }) {
  const theme = useLifePlannerTheme();
  const query = usePlannerOccurrences(date);
  const catalogue = usePlannerHabitCatalogue('', 'active', date);
  const taskHabitIds = useMemo(() => dayJournalTaskHabitIds(catalogue.data ?? []), [catalogue.data]);
  const model = query.data?.selectedLocalDate === date ? query.data : null;
  const day = useMemo(
    () => selectDayJournalItems({ nowMinuteOfDay: null, rootGroups: model?.rootGroups ?? [], taskHabitIds }),
    [model, taskHabitIds],
  );
  const tasks = useMemo(
    () => [...day.timed, ...day.anytime].filter((item) => item.kind === 'task'),
    [day.anytime, day.timed],
  );
  const weekday = plannerLocalDateToDate(date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', weekday: 'long' });

  return <View style={styles.tasks}>
    <Text style={[styles.tasksHeader, { color: theme.today.secondaryText }]}>{weekday}</Text>
    {tasks.length === 0
      ? <Text style={[styles.tasksEmpty, { color: theme.today.tertiaryText }]}>
        {query.status === 'loading' ? ' ' : 'No tasks on this day.'}
      </Text>
      : <ScrollView contentContainerStyle={styles.tasksList} showsVerticalScrollIndicator={false}>
        {tasks.map((task) => <TaskRow item={task} key={task.habitId} />)}
      </ScrollView>}
  </View>;
}

function TaskRow({ item }: { readonly item: DayJournalItem }) {
  const theme = useLifePlannerTheme();
  const color = journalCategoryColor(item.categoryKey, theme.today.secondaryText);
  return <View style={styles.taskRow}>
    {/* Filled, because a task is filled everywhere in this application. */}
    <View style={[styles.taskDot, { backgroundColor: item.done ? theme.today.tone300 : color }]} />
    <Text
      numberOfLines={1}
      style={[styles.taskTitle, {
        color: item.done ? theme.today.tertiaryText : theme.today.primaryText,
        textDecorationLine: item.done ? 'line-through' : 'none',
      }]}
    >{item.title}</Text>
    <Text style={[styles.taskTime, { color: theme.today.secondaryText }]}>{item.localTime ?? 'all-day'}</Text>
  </View>;
}

/**
 * The title's line box, and room for `September 2026` at 30 pt. The label's own
 * content is out of flow, so this reserve is the only thing keeping the month off
 * the arrows beside it.
 */
const CALENDAR_TITLE_LINE = 38;
const CALENDAR_TITLE_WIDTH = 268;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grabber: { alignSelf: 'center', borderRadius: 3, height: 5, marginTop: 8, width: 40 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44, paddingHorizontal: 12 },
  headerBack: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 2, minHeight: 44 },
  headerBackText: { fontSize: 17, fontWeight: '600' },
  headerAction: { alignItems: 'flex-end', justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  headerActionText: { fontSize: 16 },
  headerDone: { fontWeight: '700' },

  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingTop: 4 },
  monthTitleRow: { flex: 1 },
  monthTitle: { fontSize: 30, fontWeight: '700', letterSpacing: -0.4, lineHeight: CALENDAR_TITLE_LINE },
  arrow: { alignItems: 'center', height: 40, justifyContent: 'center', width: 34 },
  weekdayRow: { flexDirection: 'row', paddingBottom: 4, paddingTop: 10 },
  weekday: { fontSize: 11, fontWeight: '700', textAlign: 'center', width: `${100 / 7}%` },

  pager: { flexGrow: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', gap: 3, height: 54, justifyContent: 'center', width: `${100 / 7}%` },
  circle: { alignItems: 'center', borderRadius: 17, borderWidth: 1.5, height: 34, justifyContent: 'center', width: 34 },
  number: { fontSize: 17 },
  // No gap: the marks overlap and each is ringed, so the overlap reads as stacking.
  marks: { alignItems: 'center', flexDirection: 'row', height: 15 },
  mark: { alignItems: 'center', borderRadius: 7.5, borderWidth: 1, height: 15, justifyContent: 'center', shadowOffset: { height: 0, width: 0 }, shadowOpacity: 1, shadowRadius: 0, width: 15 },
  markRest: { borderRadius: 7.5 },
  markRestText: { fontSize: 8, fontVariant: ['tabular-nums'], fontWeight: '800' },

  listDivider: { height: 1, marginTop: 6 },
  tasks: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  tasksHeader: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  tasksEmpty: { fontSize: 14, paddingTop: 16 },
  tasksList: { paddingBottom: 24, paddingTop: 6 },
  taskRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 40 },
  taskDot: { borderRadius: 5, height: 9, width: 9 },
  taskTitle: { flex: 1, fontSize: 15, fontWeight: '500', minWidth: 0 },
  taskTime: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
