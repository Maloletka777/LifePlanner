import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { useLifePlannerTheme, withAlpha, SWITCH_TRAVEL } from '@/src/ui/theme';

import { DEFAULT_PLANNED_TIME, PlannerFormSheet } from './create-habit-sheets';
import {
  timeDrumBusyAt,
  timeDrumCaption,
  timeDrumChipLabel,
  timeDrumDayNote,
  timeDrumDragRows,
  timeDrumDurationLabel,
  timeDrumIndexOf,
  timeDrumClampIndex,
  timeDrumLocalTime,
  timeDrumMinuteOfLocalTime,
  timeDrumOwnDuration,
  timeDrumRowGeometry,
  timeDrumRows,
  timeDrumSnap,
  timeDrumWarning,
  timeDrumWindow,
  TIME_DRUM_CENTRE,
  TIME_DRUM_DEFAULT_DURATION,
  TIME_DRUM_DURATIONS,
  TIME_DRUM_OWN_DEFAULT,
  TIME_DRUM_OWN_STEP,
  TIME_DRUM_ROW_HEIGHT,
  TIME_DRUM_TILT,
  TIME_DRUM_WELL_HEIGHT,
  type TimeDrumBusy,
} from './time-drum-model';

/**
 * The time sheet, with a drum where the native spinner was — `Time drum.dc.html` `1a`.
 *
 * **The sheet itself does not change**: top radius 30, the 44 pt handle band, `Cancel`
 * on the left and `Time` centred, all of it `PlannerFormSheet`. What goes is the
 * two-wheel `DateTimePicker`, which asks for an hour and a minute and knows nothing
 * about the day it is choosing inside.
 *
 * **The notch is the length.** The day is cut by the chosen duration, so every start is
 * exactly where the one before it would have ended and the drum cannot rest anywhere a
 * thing would not stand squarely in the day. The step is therefore not a setting of its
 * own — it is a consequence of the one choice the person is already making.
 *
 * **What is already planned that day is marked**, so the clear notches read at a glance.
 *
 * Two things the design draws are deliberately not drawn here, both for the same reason
 * and both recorded: the pill states the **start** rather than an interval, and a busy
 * mark names a *minute* rather than a block — an item stores a planned time and no
 * length (PD-CREATE-020), so an end is not the application's to promise. The design's
 * own domain note offers exactly this fallback.
 */
export function TimeDrumSheet({ visible, value, durationValue, dayLabel, dayOffset, busy, onCancel, onDone }: {
  readonly visible: boolean;
  /** What the item carries: `HH:MM`, or empty for an item with no time. */
  readonly value: string;
  /**
   * The length the item carries, or `null` when nobody stated one.
   *
   * The drum reopens on it rather than on the default, because the cut a person chose
   * is part of what they chose — reopening at 30 minutes would silently re-cut a day
   * they had already decided the shape of.
   */
  readonly durationValue?: number | null;
  /** The day the drum is cutting, as the rest of the application writes a date. */
  readonly dayLabel: string;
  /** That day relative to today, so the row can say what it is without a calendar. */
  readonly dayOffset: number;
  /** What is already planned on that day. Absent is the same as nothing planned. */
  readonly busy?: readonly TimeDrumBusy[];
  readonly onCancel: () => void;
  /**
   * The start, and the length it was cut by.
   *
   * The length used to be thrown away here: it cut the day so a start could be picked
   * and then went nowhere, which PD-CREATE-030 recorded as the reason a plate could not
   * be drawn as a span. It is the item's now.
   */
  readonly onDone: (value: string, durationMinutes: number | null) => void;
}) {
  const theme = useLifePlannerTheme();
  const stored = timeDrumMinuteOfLocalTime(value);
  const fallback = timeDrumMinuteOfLocalTime(DEFAULT_PLANNED_TIME) ?? 7 * 60;
  const storedDuration = typeof durationValue === 'number' && Number.isInteger(durationValue) && durationValue > 0
    ? durationValue
    : null;
  /** A stored length the chip row does not carry is the person's own, not a preset. */
  const storedIsOwn = storedDuration !== null && !TIME_DRUM_DURATIONS.includes(storedDuration);
  const [duration, setDuration] = useState<number>(storedDuration !== null && !storedIsOwn ? storedDuration : TIME_DRUM_DEFAULT_DURATION);
  const [own, setOwn] = useState<number>(storedIsOwn ? storedDuration : TIME_DRUM_OWN_DEFAULT);
  const [ownChosen, setOwnChosen] = useState(storedIsOwn);
  /**
   * **Whether anybody actually said how long this takes.**
   *
   * The drum always cuts the day by *some* length and the default is half an hour — but
   * choosing a start from a day cut into half-hours is not saying the thing takes half an
   * hour. Committing the default would write a length nobody stated, which is exactly the
   * fabrication Migration 013 refuses by making the column nullable in the first place.
   * It becomes a stated length the moment a chip or `Own` is touched, and it is already
   * one on an item that carries it.
   */
  const [durationStated, setDurationStated] = useState(storedDuration !== null);
  const [minute, setMinute] = useState<number>(stored ?? fallback);
  const [anyTime, setAnyTime] = useState(false);
  const [menu, setMenu] = useState(false);

  // Opening the sheet is the intent to set a time, so the drum always opens live and
  // the switch always opens off — whatever the item currently carries. It used to
  // mirror the stored value, which meant an item with no time opened with the control
  // disabled behind a switch already on: the block the sheet exists to remove
  // (PD-CREATE-008, PD-CREATE-011).
  const opened = useRef(visible);
  if (visible && !opened.current) {
    setMinute(stored ?? fallback);
    // The minute always reopens live (PD-CREATE-008), but the **length** reopens on what
    // the item carries: the cut is a decision, and re-cutting the day underneath somebody
    // who had already chosen 1.5 h would lose it without saying so.
    setDuration(storedDuration !== null && !storedIsOwn ? storedDuration : TIME_DRUM_DEFAULT_DURATION);
    setOwn(storedIsOwn ? storedDuration : TIME_DRUM_OWN_DEFAULT);
    setOwnChosen(storedIsOwn);
    setDurationStated(storedDuration !== null);
    setAnyTime(false);
    setMenu(false);
  }
  opened.current = visible;

  const length = ownChosen ? own : duration;
  const window = useMemo(() => timeDrumWindow(stored), [stored]);
  const rows = useMemo(() => timeDrumRows({ busy, durationMinutes: length, window }), [busy, length, window]);
  const index = timeDrumIndexOf(rows, minute);
  const selected = rows[index]?.minute ?? minute;
  const overlap = timeDrumBusyAt(busy ?? [], selected, length);
  const warning = timeDrumWarning(overlap);

  /**
   * Changing the length re-cuts the day, and the choice lands on the nearest new notch.
   *
   * Rebuilt here rather than in an effect: the rows for the *next* length are what the
   * snap has to be measured against, and an effect would settle it a frame later — with
   * the drum drawn once against a cut that no longer exists.
   */
  const recut = (next: number, isOwn: boolean) => {
    const nextRows = timeDrumRows({ busy, durationMinutes: next, window });
    setMinute(timeDrumSnap(nextRows, minute));
    setOwnChosen(isOwn);
    if (isOwn) setOwn(next); else setDuration(next);
    // Touching the length is what makes it a stated one.
    setDurationStated(true);
    setAnyTime(false);
    setMenu(false);
  };

  // The drum turns with the finger. The grab reads the row it started on so the walk is
  // measured from there rather than accumulated per frame, which is what keeps a slow
  // drag from drifting a notch at a time. The responder is created once, so it reads the
  // live minute and the live cut through refs rather than closing over a first render.
  const minuteRef = useRef(minute);
  minuteRef.current = minute;
  const drag = useRef({ index: 0, rows }).current;
  drag.rows = rows;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => { drag.index = timeDrumIndexOf(drag.rows, minuteRef.current); },
    onPanResponderMove: (_event, gesture) => {
      const landing = timeDrumClampIndex(drag.rows, drag.index + timeDrumDragRows(gesture.dy));
      const row = drag.rows[landing];
      if (row !== undefined && row.minute !== minuteRef.current) setMinute(row.minute);
    },
    onStartShouldSetPanResponder: () => false,
  })).current;

  return <PlannerFormSheet
    onCancel={onCancel}
    title="Time"
    trailing={<Pressable
      accessibilityLabel="More time options"
      accessibilityRole="button"
      accessibilityState={{ expanded: menu }}
      onPress={() => setMenu((open) => !open)}
      style={({ pressed }) => [styles.menuButton, { backgroundColor: pressed ? theme.today.tone200 : theme.today.rowTint }]}
    >
      <Ionicons color={theme.today.secondaryText} name="ellipsis-horizontal" size={17} />
    </Pressable>}
    visible={visible}
  >
    {/* **`All day` is a state of the item, not an action on the drum**, so it lives
        behind the header rather than beside the wheel it would disable. */}
    {!menu ? null : <View style={[styles.menu, {
      backgroundColor: theme.today.dashboardSurface,
      borderColor: withAlpha(theme.today.primaryText, 0.1),
      shadowColor: theme.today.primaryText,
    }]}
    >
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: anyTime }}
        onPress={() => { setAnyTime((current) => !current); setMenu(false); }}
        style={({ pressed }) => [styles.menuRow, { backgroundColor: pressed ? theme.today.rowTint : 'transparent' }]}
      >
        <Ionicons accessibilityElementsHidden color={theme.today.secondaryText} name="time-outline" size={19} />
        <Text style={[styles.menuLabel, { color: theme.today.primaryText }]}>All day, no time</Text>
        <View style={[styles.switchTrack, { backgroundColor: anyTime ? theme.today.system : theme.today.tone200 }]}>
          <View style={[styles.switchKnob, { marginLeft: anyTime ? SWITCH_TRAVEL : 0, shadowColor: theme.today.primaryText }]} />
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => { setMinute(timeDrumSnap(rows, fallback)); setAnyTime(false); setMenu(false); }}
        style={({ pressed }) => [styles.menuRow, { backgroundColor: pressed ? theme.today.rowTint : 'transparent' }]}
      >
        <Ionicons accessibilityElementsHidden color={theme.today.secondaryText} name="refresh-outline" size={19} />
        <Text style={[styles.menuLabel, { color: theme.today.primaryText }]}>{`Back to ${DEFAULT_PLANNED_TIME}`}</Text>
      </Pressable>
    </View>}

    <View style={styles.body}>
      {/* Which day the drum is cutting — and therefore whose plan the marks come from.
          A statement rather than a control: it leads nowhere, so it carries no chevron. */}
      <View accessible style={[styles.dayRow, { backgroundColor: theme.today.rowTint }]}>
        <Ionicons accessibilityElementsHidden color={theme.today.secondaryText} name="calendar-outline" size={19} />
        <Text numberOfLines={1} style={[styles.dayLabel, { color: theme.today.primaryText }]}>{dayLabel}</Text>
        <Text style={[styles.dayNote, { color: theme.today.tertiaryText }]}>{timeDrumDayNote(dayOffset)}</Text>
      </View>

      <View
        accessibilityHint="Drag up for a later start, down for an earlier one."
        accessibilityLabel={anyTime ? 'Start time, all day' : `Start time, ${timeDrumLocalTime(selected)}`}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: timeDrumLocalTime(selected) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (anyTime) return;
          const step = nativeEvent.actionName === 'increment' ? 1 : -1;
          const row = rows[timeDrumClampIndex(rows, index + step)];
          if (row !== undefined) setMinute(row.minute);
        }}
        pointerEvents={anyTime ? 'none' : 'auto'}
        style={[styles.well, { opacity: anyTime ? 0.35 : 1 }]}
        {...pan.panHandlers}
      >
        {rows.map((row, at) => {
          const geometry = timeDrumRowGeometry(at - index, TIME_DRUM_TILT);
          if (!geometry.drawn) return null;
          const chosen = at === index;
          const away = Math.abs(at - index);
          return <Pressable
            accessibilityElementsHidden
            key={row.minute}
            onPress={() => { setMinute(row.minute); setAnyTime(false); setMenu(false); }}
            pointerEvents={chosen ? 'none' : 'auto'}
            style={[styles.row, {
              // A notch something is already planned inside is tinted, so what is clear
              // reads without being marked at all.
              backgroundColor: row.busyName !== null && !chosen ? theme.today.scheduleTint : 'transparent',
              opacity: chosen ? 0 : geometry.opacity,
              transform: [
                { perspective: 900 },
                { translateY: geometry.translateY },
                { rotateX: `${geometry.rotateX}deg` },
                { scale: geometry.scale },
              ],
            }]}
          >
            <Text style={[styles.rowTime, {
              color: away >= 2 ? theme.today.tertiaryText : theme.today.secondaryText,
              fontSize: away < 1 ? 18 : 17,
            }]}
            >{timeDrumLocalTime(row.minute)}</Text>
            {row.busyName === null ? null : <Text
              numberOfLines={1}
              style={[styles.rowBusy, { color: theme.today.scheduleText }]}
            >{row.busyName}</Text>}
          </Pressable>;
        })}

        {/* The choice, and the only thing on the drum that does not move. */}
        <View
          pointerEvents="none"
          style={[styles.pill, {
            backgroundColor: anyTime ? theme.today.tone200 : theme.today.system,
            shadowColor: theme.today.primaryText,
          }]}
        >
          <Text style={[styles.pillText, { color: anyTime ? theme.today.secondaryText : theme.today.onAccent }]}>
            {anyTime ? 'Any time of day' : timeDrumLocalTime(selected)}
          </Text>
        </View>

        {/* The rows fade into the sheet at both ends. Composed from stacked bands,
            because no gradient library is a dependency of this project and adding one
            is not authorised — the same technique the bottom scrim uses. */}
        <Veil edge="top" ground={theme.today.dashboardSurface} />
        <Veil edge="bottom" ground={theme.today.dashboardSurface} />
      </View>

      <View style={styles.durationHeader}>
        <Text style={[styles.durationLabel, { color: theme.today.tertiaryText }]}>DURATION</Text>
        <Text style={[styles.durationNote, { color: theme.today.tertiaryText }]}>{`notches of ${timeDrumDurationLabel(length)}`}</Text>
      </View>

      <View style={[styles.chips, { backgroundColor: theme.today.rowTint }]}>
        {TIME_DRUM_DURATIONS.map((minutes) => {
          const chosen = !ownChosen && duration === minutes;
          return <Pressable
            accessibilityLabel={`Notches of ${timeDrumDurationLabel(minutes)}`}
            accessibilityRole="button"
            accessibilityState={{ selected: chosen }}
            key={minutes}
            onPress={() => recut(minutes, false)}
            style={[styles.chip, { backgroundColor: chosen ? theme.today.system : 'transparent' }]}
          >
            <Text style={[styles.chipLabel, { color: chosen ? theme.today.onAccent : theme.today.secondaryText }]}>{timeDrumChipLabel(minutes)}</Text>
          </Pressable>;
        })}
        <Pressable
          accessibilityLabel="A length of your own"
          accessibilityRole="button"
          accessibilityState={{ selected: ownChosen }}
          onPress={() => recut(own, true)}
          style={[styles.chip, { backgroundColor: ownChosen ? theme.today.system : 'transparent' }]}
        >
          <Text style={[styles.chipLabel, { color: ownChosen ? theme.today.onAccent : theme.today.secondaryText }]}>{ownChosen ? `${own}m` : 'Own'}</Text>
        </Pressable>
      </View>

      {!ownChosen ? null : <View style={styles.ownRow}>
        <Pressable
          accessibilityLabel="Five minutes shorter"
          accessibilityRole="button"
          onPress={() => recut(timeDrumOwnDuration(own, -TIME_DRUM_OWN_STEP), true)}
          style={({ pressed }) => [styles.ownStep, { backgroundColor: pressed ? theme.today.rowTint : 'transparent', borderColor: withAlpha(theme.today.primaryText, 0.1) }]}
        >
          <Ionicons color={theme.today.secondaryText} name="remove" size={16} />
        </Pressable>
        <Text style={[styles.ownValue, { color: theme.today.primaryText }]}>{`${own} min`}</Text>
        <Pressable
          accessibilityLabel="Five minutes longer"
          accessibilityRole="button"
          onPress={() => recut(timeDrumOwnDuration(own, TIME_DRUM_OWN_STEP), true)}
          style={({ pressed }) => [styles.ownStep, { backgroundColor: pressed ? theme.today.rowTint : 'transparent', borderColor: withAlpha(theme.today.primaryText, 0.1) }]}
        >
          <Ionicons color={theme.today.secondaryText} name="add" size={16} />
        </Pressable>
        <Text style={[styles.ownNote, { color: theme.today.tertiaryText }]}>Five minutes a step. The day is re-cut as it changes.</Text>
      </View>}

      <Text style={[styles.caption, { color: theme.today.tertiaryText }]}>{timeDrumCaption(length)}</Text>
      {warning === null || anyTime ? null : <Text
        accessibilityLiveRegion="polite"
        style={[styles.caption, { color: theme.today.attentionText }]}
      >{warning}</Text>}

      <Pressable
        accessibilityRole="button"
        onPress={() => onDone(anyTime ? '' : timeDrumLocalTime(selected), anyTime || !durationStated ? null : length)}
        style={({ pressed }) => [styles.commit, { backgroundColor: pressed ? theme.today.completionPressed : theme.today.completion }]}
      >
        <Text style={[styles.commitLabel, { color: theme.today.onAccent }]}>Continue</Text>
      </Pressable>
    </View>
  </PlannerFormSheet>;
}

/**
 * The fade at each end of the drum, composed rather than imported.
 *
 * Eight bands of the sheet's own surface at falling alpha. A gradient library is not a
 * dependency and adding one is not authorised, and the alternative — a hard edge — would
 * make the drum read as a list in a box rather than as a wheel.
 */
function Veil({ edge, ground }: { readonly edge: 'top' | 'bottom'; readonly ground: string }) {
  const bands = Array.from({ length: VEIL_BANDS }, (_unused, at) => at);
  return <View pointerEvents="none" style={[styles.veil, edge === 'top' ? { top: 0 } : { bottom: 0 }]}>
    {(edge === 'top' ? bands : [...bands].reverse()).map((at) => <View
      key={at}
      style={{
        backgroundColor: withAlpha(ground, 1 - at / (VEIL_BANDS - 1)),
        height: VEIL_HEIGHT / VEIL_BANDS,
      }}
    />)}
  </View>;
}

const VEIL_HEIGHT = 70;
const VEIL_BANDS = 8;

const styles = StyleSheet.create({
  menuButton: { alignItems: 'center', borderRadius: 17, height: 34, justifyContent: 'center', width: 34 },
  menu: { borderRadius: 16, borderWidth: 1, elevation: 10, padding: 6, position: 'absolute', right: 18, shadowOffset: { height: 14, width: 0 }, shadowOpacity: 0.18, shadowRadius: 34, top: 82, width: 252, zIndex: 6 },
  menuRow: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 12, minHeight: 48, paddingHorizontal: 10 },
  menuLabel: { flex: 1, fontSize: 15 },
  switchTrack: { borderRadius: 15, flexDirection: 'row', height: 30, padding: 2, width: 50 },
  switchKnob: { backgroundColor: '#FFFFFF', borderRadius: 13, elevation: 2, height: 26, shadowOffset: { height: 1, width: 0 }, shadowOpacity: 0.2, shadowRadius: 3, width: 26 },
  body: { gap: 13, paddingBottom: 20, paddingHorizontal: 18 },
  dayRow: { alignItems: 'center', borderRadius: 16, flexDirection: 'row', gap: 12, minHeight: 56, paddingHorizontal: 14 },
  dayLabel: { flex: 1, fontSize: 16 },
  dayNote: { fontSize: 14 },
  /** Six rows of room, and nothing inside it is in flow: every row is placed. */
  well: { height: TIME_DRUM_WELL_HEIGHT, overflow: 'hidden', position: 'relative' },
  row: { alignItems: 'center', borderRadius: 16, flexDirection: 'row', height: TIME_DRUM_ROW_HEIGHT, justifyContent: 'center', left: 14, paddingHorizontal: 14, position: 'absolute', right: 14, top: TIME_DRUM_CENTRE },
  rowTime: { fontVariant: ['tabular-nums'], fontWeight: '600', letterSpacing: -0.2 },
  rowBusy: { fontSize: 12.5, fontWeight: '600', letterSpacing: -0.1, position: 'absolute', right: 14 },
  pill: { alignItems: 'center', borderRadius: 16, elevation: 6, height: TIME_DRUM_ROW_HEIGHT, justifyContent: 'center', left: 14, position: 'absolute', right: 14, shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.16, shadowRadius: 20, top: TIME_DRUM_CENTRE },
  pillText: { fontSize: 20, fontVariant: ['tabular-nums'], fontWeight: '700', letterSpacing: -0.3 },
  veil: { height: VEIL_HEIGHT, left: 0, position: 'absolute', right: 0 },
  durationHeader: { alignItems: 'baseline', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  durationLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
  durationNote: { fontSize: 12 },
  chips: { borderRadius: 16, flexDirection: 'row', gap: 3, padding: 4 },
  chip: { alignItems: 'center', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 34, minWidth: 0 },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  ownRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  ownStep: { alignItems: 'center', borderRadius: 11, borderWidth: 1, height: 34, justifyContent: 'center', width: 40 },
  ownValue: { fontSize: 17, fontWeight: '700', minWidth: 64, textAlign: 'center' },
  ownNote: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  caption: { fontSize: 13, lineHeight: 18 },
  commit: { alignItems: 'center', borderRadius: 14, justifyContent: 'center', minHeight: 46 },
  commitLabel: { fontSize: 15, fontWeight: '600' },
});
