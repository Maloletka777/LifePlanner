import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useLifePlannerTheme } from '@/src/ui/theme';

import { PlannerFormSheet } from './create-habit-sheets';
import {
  CREATE_DURATION_CHOICES,
  CREATE_MIN_DURATION_MINUTES,
  CREATE_REMINDER_OFFSETS,
  CREATE_REPEAT_MODES,
  CREATE_REPEAT_MODE_CAPTIONS,
  CREATE_REPEAT_MODE_LABELS,
  CREATE_WEEKDAY_CAPS,
  CREATE_WEEKDAY_NAMES,
  DEFAULT_REMINDER_TIME,
  createDurationLabel,
  reminderOffsetLabel,
  reminderTriggerTime,
  repeatNumberFields,
  scheduleNumber,
  stepScheduleNumber,
  type CreateReminderDraft,
  type CreateRepeatMode,
} from './create-item-model';
import { formatPlannerDateEntry, movePlannerMonth, plannerMonthGrid, type ScheduleDraft } from './ui-adapters';

/**
 * The two second-level decisions the single create sheet adds.
 *
 * Both follow the rule the other Create sheets already follow: the draft lives in
 * the caller, the sheet writes nothing until Done, and Cancel restores exactly what
 * it opened with.
 */

/**
 * Every repeat the schema has, in one list.
 *
 * The row on the sheet carries the two that answer nearly every case; this is what
 * the trailing key opens, and it is also how the create surface reaches the schema
 * types a two-chip row never could. Choosing here applies immediately and closes,
 * because a repeat is a single choice and a Done step would only add a tap.
 */
export function CreateRepeatSheet({ visible, value, schedule, onCancel, onChoose, onSchedule, onClose }: {
  readonly visible: boolean;
  readonly value: CreateRepeatMode;
  /** The draft the weekday grid and the counters edit, live. */
  readonly schedule: ScheduleDraft;
  readonly onCancel: () => void;
  readonly onChoose: (mode: CreateRepeatMode) => void;
  readonly onSchedule: (schedule: ScheduleDraft) => void;
  readonly onClose: () => void;
}) {
  const theme = useLifePlannerTheme();
  return <PlannerFormSheet doneLabel="Done" onCancel={onCancel} onDone={onClose} title="Repeat" visible={visible}>
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
      <View style={[styles.optionWell, { borderColor: theme.today.hairline }]}>
        {CREATE_REPEAT_MODES.map((mode, index) => {
          const selected = mode === value;
          return <Pressable
            key={mode}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChoose(mode)}
            style={[styles.repeatRow, index === 0 ? null : { borderTopColor: theme.today.hairline, borderTopWidth: 1 }]}
          >
            <View style={styles.repeatCopy}>
              <Text style={[styles.repeatLabel, { color: theme.today.primaryText }]}>{CREATE_REPEAT_MODE_LABELS[mode]}</Text>
              <Text style={[styles.repeatCaption, { color: theme.today.tertiaryText }]}>{CREATE_REPEAT_MODE_CAPTIONS[mode]}</Text>
            </View>
            <Ionicons color={selected ? theme.today.structFill : theme.today.tone200} name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} />
          </Pressable>;
        })}
      </View>

      {/* **The weekday grid and the counters live here now, not in the form.**
          On the form they appeared *underneath* the chosen mode and changed the page's
          height under the finger — a person choosing `Chosen days` watched everything
          below jump seven circles down. Here the sheet already is the surface, and the
          stack behind it does not move at all. */}
      {value !== 'days' ? null : <View style={styles.weekdayRow}>
        {CREATE_WEEKDAY_CAPS.map((cap, index) => {
          const day = index + 1;
          const selected = schedule.selectedWeekdays.includes(day);
          return <Pressable
            key={CREATE_WEEKDAY_NAMES[index]}
            accessibilityLabel={CREATE_WEEKDAY_NAMES[index]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            // 40 pt drawn and 44 reached: seven circles at 44 do not fit between the
            // sheet's own margins, so the target is extended rather than the circle.
            hitSlop={4}
            onPress={() => onSchedule({
              ...schedule,
              selectedWeekdays: selected
                ? schedule.selectedWeekdays.filter((weekday: number) => weekday !== day)
                : [...schedule.selectedWeekdays, day],
            })}
            style={[styles.weekday, selected
              ? { backgroundColor: theme.today.structFill }
              : { borderColor: theme.today.hairline, borderWidth: 1 }]}
          >
            <Text style={[styles.weekdayText, { color: selected ? theme.today.onAccent : theme.today.secondaryText }]}>{cap}</Text>
          </Pressable>;
        })}
      </View>}

      {/* The frames name the chip "N a week" and never draw the N, so the smallest
          control that supplies one ships: two targets and the number between them, and
          no keyboard for a value under a hundred. */}
      {repeatNumberFields(value).map(({ field, caption }) => <View key={field} style={styles.counterRow}>
        <Pressable
          accessibilityLabel={`One fewer, ${caption}`}
          accessibilityRole="button"
          onPress={() => onSchedule(stepScheduleNumber(schedule, field, -1))}
          style={[styles.counterKey, { borderColor: theme.today.hairline }]}
        >
          <Ionicons color={theme.today.secondaryText} name="remove" size={18} />
        </Pressable>
        <Text style={[styles.counterValue, { color: theme.today.primaryText }]}>{scheduleNumber(schedule, field)}</Text>
        <Pressable
          accessibilityLabel={`One more, ${caption}`}
          accessibilityRole="button"
          onPress={() => onSchedule(stepScheduleNumber(schedule, field, 1))}
          style={[styles.counterKey, { borderColor: theme.today.hairline }]}
        >
          <Ionicons color={theme.today.secondaryText} name="add" size={18} />
        </Pressable>
        <Text style={[styles.counterCaption, { color: theme.today.secondaryText }]}>{caption}</Text>
      </View>)}
    </ScrollView>
  </PlannerFormSheet>;
}

/**
 * How long a thing takes — **the one place that fact is now settled.**
 *
 * It used to be five chips on the form beside a `Custom` key, plus a second chip row
 * inside the time drum on a different set of values: 45 and 120 could not be reached
 * from the drum, 5 and 10 could not be reached from the form, and touching the drum's
 * row wrote a length nobody had stated. One sheet, one set, and «no matter» is a row
 * rather than a state you can only reach by not touching anything.
 *
 * The step is `CREATE_MIN_DURATION_MINUTES`, which is the domain's own floor, so a
 * length the sheet can produce is always a length the command will accept.
 */
export function CreateDurationSheet({ visible, value, onCancel, onDone }: {
  readonly visible: boolean;
  readonly value: number | null;
  readonly onCancel: () => void;
  readonly onDone: (minutes: number | null) => void;
}) {
  const theme = useLifePlannerTheme();
  const [draft, setDraft] = useState<number | null>(value);
  const opened = useRef(visible);
  if (visible && !opened.current) setDraft(value);
  opened.current = visible;

  const step = (offset: -1 | 1) => setDraft((current) => {
    const from = current ?? CREATE_DURATION_CHOICES[1] ?? 30;
    const next = from + offset * CREATE_MIN_DURATION_MINUTES;
    return Math.min(CREATE_MAXIMUM_DURATION_MINUTES, Math.max(CREATE_MIN_DURATION_MINUTES, next));
  });

  return <PlannerFormSheet onCancel={onCancel} onDone={() => onDone(draft)} title="Takes" visible={visible}>
    <View style={styles.sheetBody}>
      <View style={styles.durationRow}>
        {CREATE_DURATION_CHOICES.map((minutes) => {
          const chosen = draft === minutes;
          return <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: chosen }}
            key={minutes}
            onPress={() => setDraft(minutes)}
            style={[styles.durationChip, chosen
              ? { backgroundColor: theme.today.structFill, borderColor: theme.today.structFill }
              : { borderColor: theme.today.hairline }]}
          >
            <Text style={[styles.durationChipText, { color: chosen ? theme.today.onAccent : theme.today.secondaryText }]}>{createDurationLabel(minutes)}</Text>
          </Pressable>;
        })}
      </View>

      <View style={styles.counterRow}>
        <Pressable
          accessibilityLabel="Fifteen minutes shorter"
          accessibilityRole="button"
          onPress={() => step(-1)}
          style={[styles.counterKey, { borderColor: theme.today.hairline }]}
        >
          <Ionicons color={theme.today.secondaryText} name="remove" size={18} />
        </Pressable>
        <Text style={[styles.counterValue, { color: theme.today.primaryText, minWidth: 78 }]}>
          {draft === null ? '—' : createDurationLabel(draft)}
        </Text>
        <Pressable
          accessibilityLabel="Fifteen minutes longer"
          accessibilityRole="button"
          onPress={() => step(1)}
          style={[styles.counterKey, { borderColor: theme.today.hairline }]}
        >
          <Ionicons color={theme.today.secondaryText} name="add" size={18} />
        </Pressable>
        <Text style={[styles.counterCaption, { color: theme.today.secondaryText }]}>a quarter of an hour a step</Text>
      </View>

      {/* **«Nobody said» is a choice, not an omission.** A length is nullable in the
          schema on purpose, and a sheet that could only ever return a number would make
          the column's whole point unreachable once anything had been picked. */}
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: draft === null }}
        onPress={() => setDraft(null)}
        style={[styles.optionRow, { borderTopColor: theme.today.hairline, borderTopWidth: 1 }]}
      >
        <Text style={[styles.optionLabel, { color: theme.today.primaryText }]}>No matter</Text>
        <Ionicons color={draft === null ? theme.today.structFill : theme.today.tone200} name={draft === null ? 'checkmark-circle' : 'ellipse-outline'} size={22} />
      </Pressable>

      <Text style={[styles.footnote, { color: theme.today.tertiaryText }]}>
        The day is drawn from this: an item that says how long it takes stands as a span, and one that does not stands as a point. Nothing is chosen by default, because a made-up half hour on everybody&apos;s day is worse than a day that admits it does not know.
      </Text>
    </View>
  </PlannerFormSheet>;
}

/** Three hours. Above it a thing is a part of the day rather than an item in it. */
const CREATE_MAXIMUM_DURATION_MINUTES = 180;

/** A month at a time, in the sheet's own language rather than the old cream one. */
export function CreateDateSheet({ visible, value, title, minimumDate, onCancel, onDone }: {
  readonly visible: boolean;
  readonly value: string;
  readonly title: string;
  readonly minimumDate?: string;
  readonly onCancel: () => void;
  readonly onDone: (value: string) => void;
}) {
  const theme = useLifePlannerTheme();
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(() => monthOf(value));
  const opened = useRef(visible);
  if (visible && !opened.current) {
    setDraft(value);
    setMonth(monthOf(value));
  }
  opened.current = visible;

  const cells = plannerMonthGrid(month.year, month.month);
  const monthTitle = new Date(month.year, month.month - 1, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return <PlannerFormSheet onCancel={onCancel} onDone={() => onDone(draft)} title={title} visible={visible}>
    <View style={styles.sheetBody}>
      <View style={styles.monthHeader}>
        <Pressable accessibilityLabel="Previous month" accessibilityRole="button" onPress={() => setMonth(movePlannerMonth(month.year, month.month, -1))} style={styles.monthAction}>
          <Ionicons color={theme.today.completion} name="chevron-back" size={22} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.monthTitle, { color: theme.today.primaryText }]}>{monthTitle}</Text>
        <Pressable accessibilityLabel="Next month" accessibilityRole="button" onPress={() => setMonth(movePlannerMonth(month.year, month.month, 1))} style={styles.monthAction}>
          <Ionicons color={theme.today.completion} name="chevron-forward" size={22} />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {WEEKDAY_CAPS.map((day, index) => <Text key={`${day}-${index}`} style={[styles.gridHead, { color: theme.today.tertiaryText }]}>{day}</Text>)}
        {cells.map((date, index) => {
          if (date === null) return <View key={`blank-${index}`} style={styles.gridCell} />;
          const disabled = minimumDate !== undefined && minimumDate !== '' && date < minimumDate;
          const selected = date === draft;
          return <Pressable
            key={date}
            accessibilityLabel={formatPlannerDateEntry(date)}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            onPress={() => setDraft(date)}
            style={styles.gridCell}
          >
            <View style={[styles.gridDay, selected ? { backgroundColor: theme.today.completion } : null]}>
              <Text style={[styles.gridDayText, { color: selected ? theme.today.onAccent : disabled ? theme.today.tertiaryText : theme.today.primaryText }]}>{Number(date.slice(8, 10))}</Text>
            </View>
          </Pressable>;
        })}
      </View>
      <Text style={[styles.footnote, { color: theme.today.tertiaryText }]}>{draft === '' ? 'Choose a day.' : formatPlannerDateEntry(draft)}</Text>
    </View>
  </PlannerFormSheet>;
}

/**
 * A reminder said in the words the choice was made in.
 *
 * The domain stores one absolute local time, so "10 minutes before" is resolved
 * against the planned time here and the resolved time is shown beside the offset —
 * an offset that cannot be resolved (no planned time, or a subtraction that would
 * fall into yesterday) is disabled rather than quietly clamped.
 */
export function CreateReminderSheet({ visible, value, plannedTime, onCancel, onDone }: {
  readonly visible: boolean;
  readonly value: CreateReminderDraft;
  readonly plannedTime: string;
  readonly onCancel: () => void;
  readonly onDone: (value: CreateReminderDraft) => void;
}) {
  const theme = useLifePlannerTheme();
  const [draft, setDraft] = useState<CreateReminderDraft>(value);
  const opened = useRef(visible);
  if (visible && !opened.current) setDraft(value);
  opened.current = visible;

  const rows: readonly Readonly<{ key: string; label: string; detail: string; choice: CreateReminderDraft; disabled: boolean }>[] = [
    { choice: { kind: 'none' }, detail: '', disabled: false, key: 'none', label: 'No reminder' },
    ...CREATE_REMINDER_OFFSETS.map((minutes) => {
      const choice: CreateReminderDraft = { kind: 'before', minutes };
      const resolved = reminderTriggerTime(choice, plannedTime);
      return {
        choice,
        detail: resolved ?? 'needs a time of day',
        disabled: resolved === null,
        key: `before-${minutes}`,
        label: reminderOffsetLabel(minutes),
      };
    }),
    {
      choice: { kind: 'at', time: DEFAULT_REMINDER_TIME },
      detail: DEFAULT_REMINDER_TIME,
      disabled: false,
      key: 'at',
      label: 'At a fixed time',
    },
  ];

  return <PlannerFormSheet onCancel={onCancel} onDone={() => onDone(draft)} title="Reminder" visible={visible}>
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
      <View style={[styles.optionWell, { borderColor: theme.today.hairline }]}>
        {rows.map((row, index) => {
          const selected = sameReminder(draft, row.choice);
          return <Pressable
            key={row.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: row.disabled }}
            disabled={row.disabled}
            onPress={() => setDraft(row.choice)}
            style={[styles.optionRow, index === 0 ? null : { borderTopColor: theme.today.hairline, borderTopWidth: 1 }]}
          >
            <Text style={[styles.optionLabel, { color: row.disabled ? theme.today.tertiaryText : theme.today.primaryText }]}>{row.label}</Text>
            {row.detail === '' ? null : <Text style={[styles.optionDetail, { color: theme.today.tertiaryText }]}>{row.detail}</Text>}
            <Ionicons color={selected ? theme.today.completion : theme.today.tone200} name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} />
          </Pressable>;
        })}
      </View>
      <Text style={[styles.footnote, { color: theme.today.tertiaryText }]}>
        The reminder is stored with the item and follows its schedule&apos;s timezone. It is scheduled on the days the item actually runs, for a fortnight at a time, and topped up whenever the app is opened. A scheduled reminder has been accepted by the phone, which is not the same as delivered: focus modes and battery settings still have a say.
      </Text>
    </ScrollView>
  </PlannerFormSheet>;
}

function sameReminder(left: CreateReminderDraft, right: CreateReminderDraft): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'before' && right.kind === 'before') return left.minutes === right.minutes;
  return true;
}

function monthOf(value: string): Readonly<{ year: number; month: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    return Object.freeze({ month: now.getMonth() + 1, year: now.getFullYear() });
  }
  return Object.freeze({ month: Number(value.slice(5, 7)), year: Number(value.slice(0, 4)) });
}

const WEEKDAY_CAPS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const styles = StyleSheet.create({
  sheetBody: { gap: 13, paddingBottom: 18, paddingHorizontal: 18 },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  footnote: { fontSize: 13, lineHeight: 18 },

  monthHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  monthAction: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  monthTitle: { fontSize: 17, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridHead: { fontSize: 12, fontWeight: '600', paddingBottom: 6, textAlign: 'center', width: '14.2857%' },
  gridCell: { alignItems: 'center', height: 44, justifyContent: 'center', width: '14.2857%' },
  gridDay: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  gridDayText: { fontSize: 15, fontWeight: '600' },

  optionWell: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14 },
  optionRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 52 },
  optionLabel: { flex: 1, fontSize: 16, minWidth: 0 },
  optionDetail: { fontSize: 14 },
  repeatRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 56, paddingVertical: 8 },
  repeatCopy: { flex: 1, minWidth: 0 },
  repeatLabel: { fontSize: 16 },
  repeatCaption: { fontSize: 13, marginTop: 1 },

  weekdayRow: { flexDirection: 'row', justifyContent: 'space-between' },
  weekday: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  weekdayText: { fontSize: 14, fontWeight: '500' },
  counterRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  counterKey: { alignItems: 'center', borderRadius: 13, borderWidth: 1, height: 44, justifyContent: 'center', width: 48 },
  counterValue: { fontSize: 17, fontVariant: ['tabular-nums'], fontWeight: '600', minWidth: 28, textAlign: 'center' },
  counterCaption: { flex: 1, fontSize: 13, minWidth: 0 },

  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  durationChip: { alignItems: 'center', borderRadius: 13, borderWidth: 1, justifyContent: 'center', minHeight: 44, minWidth: 62, paddingHorizontal: 14 },
  durationChipText: { fontSize: 14, fontWeight: '500' },
});
