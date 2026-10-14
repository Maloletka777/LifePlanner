import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Keyboard, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HABIT_ACCENT_OPTIONS,
  type CanonicalHabitAccentKey,
  type PersistedHabitAccentKey,
  type RegisteredHabitSymbolKey,
} from '@/src/features/planner';
import { useLifePlannerTheme, SWITCH_TRAVEL } from '@/src/ui/theme';

import { CREATE_EXTRA_SCHEDULE_MODES, CREATE_SCHEDULE_MODE_LABELS, type CreateScheduleMode } from './create-habit-schedule-model';
import { HABIT_ICON_CATEGORIES, HABIT_SYMBOL_GLYPHS, type HabitIconOption } from './planner-iconography';
import { filterHabitIconOptions, suggestedHabitSymbols } from './habit-identity-picker-model';
import { PlannerDateField } from './planner-date-time-controls';
import { moveStep, namedRoutineSteps, withPendingStep, type RoutineStepDraft } from './routine-step-drafts';
import { formatPlannerDate } from './ui-adapters';

/**
 * One bottom sheet for every second-level decision on Create.
 *
 * Top corners 30, a 38 × 4 grab handle and Cancel / title / Done, so the habit
 * card behind stays visible and nothing on this screen is ever a full-screen
 * push. Done commits, Cancel restores what the sheet opened with — the drafts
 * live in the caller, so a cancelled sheet writes nothing at all.
 */
/** One fixed square per symbol: percentages put the glyph off-centre. */
const SYMBOL_TILE = 74;

/** Opening the time sheet preselects this rather than leaving the wheels blank. */
export const DEFAULT_PLANNED_TIME = '07:00';

export function PlannerFormSheet({ title, visible, onCancel, onDone, doneLabel = 'Done', trailing, children }: PropsWithChildren<{
  readonly title: string;
  readonly visible: boolean;
  readonly onCancel: () => void;
  /** Absent where the sheet carries its own action in the body, as the drum does. */
  readonly onDone?: () => void;
  readonly doneLabel?: string;
  /**
   * What stands where `Done` would, when the sheet commits from somewhere else.
   *
   * The trailing slot keeps its 60 × 44 target either way, so the title stays centred
   * on the sheet rather than shifting with whatever is beside it.
   */
  readonly trailing?: ReactNode;
}>) {
  const theme = useLifePlannerTheme();
  const insets = useSafeAreaInsets();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  // A 5 pt handle is not a gesture target. The whole 44 pt header band catches the
  // drag, so a swipe from anywhere along it dismisses — the sheet on `тест9` could
  // only be closed from the very edge of the screen.
  const dismiss = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 56 || gesture.vy > 0.7) cancelRef.current();
    },
    onStartShouldSetPanResponder: () => false,
  })).current;
  // The sheet never leaves the bottom edge. Lifting it with the keyboard left its
  // surface ending in mid-air, with the app's ground showing at the keyboard's
  // corners; instead its own bottom padding grows to the keyboard's height, so the
  // white runs on underneath and only the content moves up.
  const keyboard = useKeyboardInset();
  return <Modal animationType="slide" onRequestClose={onCancel} transparent visible={visible}>
    <View style={[styles.sheetBackdrop, { backgroundColor: theme.today.sheetBackdrop }]}>
      <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onCancel} style={StyleSheet.absoluteFill} />
      <View
        accessibilityViewIsModal
        style={[styles.sheet, {
          backgroundColor: theme.today.dashboardSurface,
          paddingBottom: Math.max(insets.bottom, keyboard),
          shadowColor: theme.today.primaryText,
        }]}
      >
        <View accessibilityLabel="Drag down to close" style={styles.sheetHandleRow} {...dismiss.panHandlers}><View style={[styles.sheetHandle, { backgroundColor: theme.today.tone200 }]} /></View>
        <View style={styles.sheetHeader}>
          <Pressable accessibilityRole="button" onPress={onCancel} style={styles.sheetCancel}><Text style={[styles.sheetCancelText, { color: theme.today.secondaryText }]}>Cancel</Text></Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.sheetTitle, { color: theme.today.primaryText }]}>{title}</Text>
          {trailing === undefined
            ? <Pressable accessibilityRole="button" onPress={onDone} style={styles.sheetDoneTarget}><View style={[styles.sheetDone, { backgroundColor: theme.today.completion }]}><Text style={[styles.sheetDoneText, { color: theme.today.onAccent }]}>{doneLabel}</Text></View></Pressable>
            : <View style={styles.sheetDoneTarget}>{trailing}</View>}
        </View>
        {children}
      </View>
    </View>
  </Modal>;
}

/**
 * How much of the screen the keyboard is covering.
 *
 * `KeyboardAvoidingView` moves the whole sheet, which is wrong for a surface that
 * is supposed to be attached to the bottom edge — it ends up floating with the
 * ground visible beneath it. This lets the sheet stay put and pad instead.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const showing = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      (event: KeyboardEvent) => setInset(Math.max(0, event.endCoordinates?.height ?? 0)),
    );
    const hiding = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setInset(0),
    );
    return () => { showing.remove(); hiding.remove(); };
  }, []);
  return inset;
}

/**
 * The wheels are kept exactly as they were — a native spinner, not a rebuilt
 * control. What changed is around them: a sheet instead of a full-screen modal,
 * and "Any time of day" as a state of the habit rather than an "All day" action.
 */
export function HabitTimeSheet({ visible, value, onCancel, onDone }: {
  readonly visible: boolean;
  readonly value: string;
  readonly onCancel: () => void;
  readonly onDone: (value: string) => void;
}) {
  const theme = useLifePlannerTheme();
  // Opening the sheet is the intent to set a time, so the wheels are always live
  // and the switch always starts off — whatever the habit currently carries. It
  // used to mirror the current value, so a habit with no time opened with the
  // wheels disabled behind a switch that was already on: exactly the block the
  // sheet exists to remove, reported again on `тест10`.
  const [draft, setDraft] = useState(() => value.trim() === '' ? DEFAULT_PLANNED_TIME : value);
  const [anyTime, setAnyTime] = useState(false);
  const opened = useRef(visible);
  if (visible && !opened.current) {
    setDraft(value.trim() === '' ? DEFAULT_PLANNED_TIME : value);
    setAnyTime(false);
  }
  opened.current = visible;
  const [hours, minutes] = draft.split(':').map(Number);
  return <PlannerFormSheet onCancel={onCancel} onDone={() => onDone(anyTime ? '' : draft)} title="Time" visible={visible}>
    <View style={styles.sheetBody}>
      {/* No band of our own over the spinner. The native picker draws its own
          selection highlight, and a hand-placed one sat at a fixed offset the real
          control never matched — the white panel adrift over the wheels. */}
      <View style={[styles.wheelWell, anyTime ? styles.wheelWellMuted : null]} pointerEvents={anyTime ? 'none' : 'auto'}>
        <DateTimePicker
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          mode="time"
          onChange={(_event, date) => {
            if (date === undefined) return;
            setDraft(`${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`);
          }}
          themeVariant="light"
          value={new Date(2000, 0, 1, hours, minutes, 0, 0)}
        />
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: anyTime }}
        onPress={() => setAnyTime((current) => !current)}
        style={[styles.anyTimeRow, { backgroundColor: theme.today.rowTint }]}
      >
        <Ionicons accessibilityElementsHidden color={theme.today.secondaryText} name="time-outline" size={19} />
        <Text style={[styles.anyTimeLabel, { color: theme.today.primaryText }]}>All day, no time</Text>
        <View style={[styles.switchTrack, { backgroundColor: anyTime ? theme.today.system : theme.today.tone200 }]}>
          <View style={[styles.switchKnob, { marginLeft: anyTime ? SWITCH_TRAVEL : 0, shadowColor: theme.today.primaryText }]} />
        </View>
      </Pressable>
      <Text style={[styles.sheetFootnote, { color: theme.today.tertiaryText }]}>Opening this means you want a time, so the wheels are live and 07:00 is chosen. Switch it off above to leave the habit in the Anytime group.</Text>
    </View>
  </PlannerFormSheet>;
}

/**
 * Icon and colour in one sheet, because the choice is one choice.
 *
 * The previous route was four screens — a row, a symbol catalogue, a category, and
 * a separate colour screen. Here the selected symbol is drawn in the selected
 * colour, so the preview and the choice are the same object.
 *
 * The drawn palette carries 21 swatches; this ships the canonical 16. The other
 * five are the v5/v6 legacy keys, and PD-IDENTITY-004 reserves those for habits
 * that already carry them rather than offering them for new choices.
 */
export function HabitIdentitySheet({ visible, name, symbolKey, accentKey, automatic, colours = true, onCancel, onDone }: {
  readonly visible: boolean;
  readonly name: string;
  readonly symbolKey: RegisteredHabitSymbolKey;
  readonly accentKey: PersistedHabitAccentKey;
  readonly automatic: boolean;
  /**
   * Whether the sixteen-swatch palette is offered.
   *
   * The single create sheet chooses a **category**, and the Today module is explicit
   * that an item has no free colour picker — so it opens this sheet for symbols
   * alone. Edit still opens it whole, because a habit saved with any of the sixteen
   * keys has to stay editable.
   */
  readonly colours?: boolean;
  readonly onCancel: () => void;
  readonly onDone: (next: Readonly<{ symbolKey: RegisteredHabitSymbolKey; accentKey: CanonicalHabitAccentKey | null }>) => void;
}) {
  const theme = useLifePlannerTheme();
  const [symbol, setSymbol] = useState(symbolKey);
  const [accent, setAccent] = useState<CanonicalHabitAccentKey | null>(automatic ? null : canonicalOrNull(accentKey));
  const opened = useRef(visible);
  if (visible && !opened.current) {
    setSymbol(symbolKey);
    setAccent(automatic ? null : canonicalOrNull(accentKey));
  }
  opened.current = visible;
  const shownAccent: PersistedHabitAccentKey = accent ?? accentKey;
  const swatch = theme.habitAccents[shownAccent];
  const suggested = useMemo(() => suggestedHabitSymbols(name), [name]);
  const groups = useMemo(() => buildSymbolGroups(suggested, name), [name, suggested]);
  return <PlannerFormSheet onCancel={onCancel} onDone={() => onDone({ accentKey: accent, symbolKey: symbol })} title={colours ? 'Icon and colour' : 'Icon'} visible={visible}>
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
      <View style={[styles.identityPreview, { backgroundColor: theme.today.rowTint }]}>
        <View style={[styles.identityPreviewMark, { backgroundColor: swatch.iconBackground }]}>
          <Ionicons color={swatch.iconForeground} name={HABIT_SYMBOL_GLYPHS[symbol]} size={23} />
        </View>
        <View style={styles.identityPreviewCopy}>
          <Text numberOfLines={1} style={[styles.identityPreviewName, { color: theme.today.primaryText }]}>{name.trim() || 'New habit'}</Text>
          <Text numberOfLines={1} style={[styles.identityPreviewMeta, { color: theme.today.secondaryText }]}>This is the mark the habit carries everywhere.</Text>
        </View>
      </View>

      {colours ? <>
      <View style={styles.identityLabelRow}>
        <Text style={[styles.sheetGroupLabel, { color: theme.today.tertiaryText }]}>COLOUR</Text>
        <Pressable accessibilityHint="Returns the colour to the automatic choice" accessibilityRole="button" disabled={accent === null} onPress={() => setAccent(null)}>
          <Text style={[styles.identityAutoAction, { color: accent === null ? theme.today.tertiaryText : theme.today.system }]}>{accent === null ? 'Automatic' : 'Custom · reset'}</Text>
        </Pressable>
      </View>
      <View accessibilityLabel="Habit colour palette" accessibilityRole="radiogroup" style={styles.swatchGrid}>
        {HABIT_ACCENT_OPTIONS.map((option) => {
          const selected = accent === option.key;
          return <Pressable
            key={option.key}
            accessibilityLabel={`${option.label} colour`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => setAccent(option.key)}
            style={[styles.swatch, {
              backgroundColor: theme.habitAccents[option.key].selectedSwatch,
              borderColor: selected ? theme.today.primaryText : 'transparent',
            }]}
          >
            {selected ? <Ionicons color={theme.today.onAccent} name="checkmark" size={17} /> : null}
          </Pressable>;
        })}
      </View>

      <View style={[styles.sheetDivider, { backgroundColor: theme.today.hairline }]} />
      </> : null}

      {groups.map((group) => <View key={group.title} style={styles.symbolGroup}>
        <Text style={[styles.sheetGroupLabel, { color: theme.today.tertiaryText }]}>{group.title}</Text>
        <View style={styles.symbolGrid}>
          {group.options.map((option) => {
            const selected = option.key === symbol;
            return <Pressable
              key={`${group.title}:${option.key}`}
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setSymbol(option.key)}
              style={[styles.symbolTile, { backgroundColor: selected ? swatch.selectedSwatch : theme.today.rowTint }]}
            >
              <Ionicons color={selected ? theme.today.onAccent : theme.today.secondaryText} name={HABIT_SYMBOL_GLYPHS[option.key]} size={23} />
            </Pressable>;
          })}
        </View>
      </View>)}
    </ScrollView>
  </PlannerFormSheet>;
}

export type { RoutineStepDraft };

/**
 * A step is a row, not a hidden habit.
 *
 * Dates, schedule, priority and identity are the parent's; the only thing a step
 * owns is an optional time. The segment underneath is the one decision beyond the
 * names, and it is canonical rather than cosmetic: closing by all steps writes the
 * children as `routine_step`, closing manually leaves them organisational so the
 * parent keeps its own completion action (ADR-007).
 */
export function HabitStepsSheet({ visible, steps, derivedCompletion, accentKey, symbolKey, parentName, onCancel, onDone }: {
  readonly visible: boolean;
  readonly steps: readonly RoutineStepDraft[];
  readonly derivedCompletion: boolean;
  readonly accentKey: PersistedHabitAccentKey;
  readonly symbolKey: RegisteredHabitSymbolKey;
  readonly parentName: string;
  readonly onCancel: () => void;
  readonly onDone: (next: Readonly<{ steps: readonly RoutineStepDraft[]; derivedCompletion: boolean }>) => void;
}) {
  const theme = useLifePlannerTheme();
  const swatch = theme.habitAccents[accentKey];
  const [draft, setDraft] = useState<readonly RoutineStepDraft[]>(steps);
  const [derived, setDerived] = useState(derivedCompletion);
  const [timeFor, setTimeFor] = useState<string | null>(null);
  const [pending, setPending] = useState('');
  const sequence = useRef(1);
  const opened = useRef(visible);
  if (visible && !opened.current) {
    setDraft(steps);
    setDerived(derivedCompletion);
    setPending('');
  }
  opened.current = visible;

  // The step being typed is part of the list, whether or not Return was pressed.
  // `Done` used to call `commitPending()` and then hand over a list captured from
  // this render, so the state update never reached it: a routine typed in one go
  // and confirmed with Done saved no steps at all.
  const withPending = (current: readonly RoutineStepDraft[]) => withPendingStep(current, pending);
  const commitPending = () => {
    if (pending.trim() === '') return;
    sequence.current += 1;
    setDraft(withPending);
    setPending('');
  };
  const named = namedRoutineSteps(draft);
  const editing = draft.find((step) => step.draftId === timeFor) ?? null;

  return <PlannerFormSheet onCancel={onCancel} onDone={() => onDone({ derivedCompletion: derived, steps: namedRoutineSteps(withPending(draft)) })} title="Routine steps" visible={visible}>
    {/* The field is pinned at the top of the sheet and the list grows beneath it,
        so the cursor never travels under the keyboard as the routine gets longer. */}
    <View style={styles.stepEntry}>
      <View style={[styles.stepEntryField, { borderColor: theme.today.system }]}>
        <View style={[styles.stepOrdinal, { backgroundColor: theme.today.tone100 }]}><Text style={[styles.stepOrdinalText, { color: theme.today.system }]}>{draft.length + 1}</Text></View>
        <TextInput
          accessibilityLabel="New step name"
          blurOnSubmit={false}
          onChangeText={setPending}
          onSubmitEditing={commitPending}
          placeholder="Step name"
          placeholderTextColor={theme.today.tertiaryText}
          returnKeyType="next"
          style={[styles.stepInput, { color: theme.today.primaryText }]}
          value={pending}
        />
      </View>
      <Text style={[styles.sheetFootnote, { color: theme.today.tertiaryText }]}>Return adds the next step; an empty line ends the list.</Text>
    </View>
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
      {draft.length === 0
        ? <Text style={[styles.sheetFootnote, { color: theme.today.tertiaryText }]}>No steps yet. Type the first one above.</Text>
        : null}
      <View style={[styles.stepList, { borderColor: theme.today.hairline }]}>
        {draft.map((step, index) => <View
          key={step.draftId}
          // The frame draws a drag handle; pointer reordering is not built, so the
          // order is the order they were typed. These keep it reachable meanwhile.
          accessibilityActions={STEP_ACTIONS}
          onAccessibilityAction={(event) => {
            const offset = event.nativeEvent.actionName === 'moveUp' ? -1 : 1;
            setDraft((current) => moveStep(current, index, offset));
          }}
          style={[styles.stepRow, index === 0 ? null : { borderTopColor: theme.today.hairline, borderTopWidth: 1 }]}
        >
          <View style={[styles.stepOrdinal, { backgroundColor: theme.today.tone100 }]}><Text style={[styles.stepOrdinalText, { color: theme.today.secondaryText }]}>{index + 1}</Text></View>
          <TextInput
            accessibilityLabel={`Step ${index + 1} name`}
            onChangeText={(name) => setDraft((current) => current.map((item) => item.draftId === step.draftId ? { ...item, name } : item))}
            placeholder="Step name"
            placeholderTextColor={theme.today.tertiaryText}
            style={[styles.stepInput, { color: theme.today.primaryText }]}
            value={step.name}
          />
          <Pressable
            accessibilityLabel={step.plannedTime === '' ? `Add a time to step ${index + 1}` : `Step ${index + 1} at ${step.plannedTime}`}
            accessibilityRole="button"
            onPress={() => setTimeFor(step.draftId)}
            style={[styles.stepTimeChip, step.plannedTime === ''
              ? { borderColor: theme.today.hairline, borderStyle: 'dashed', borderWidth: 1 }
              : { backgroundColor: theme.today.tone100 }]}
          >
            <Ionicons color={step.plannedTime === '' ? theme.today.tertiaryText : theme.today.system} name="time-outline" size={13} />
            <Text style={[styles.stepTimeText, { color: step.plannedTime === '' ? theme.today.tertiaryText : theme.today.system }]}>{step.plannedTime === '' ? 'Time' : step.plannedTime}</Text>
          </Pressable>
          <Pressable accessibilityLabel={`Remove step ${index + 1}`} accessibilityRole="button" onPress={() => setDraft((current) => current.filter((item) => item.draftId !== step.draftId))} style={styles.stepRemove}>
            <Ionicons color={theme.today.tertiaryText} name="trash-outline" size={18} />
          </Pressable>
        </View>)}
      </View>

      {/* Restored on the owner's instruction: making every routine close by its
          steps took away the parent's own checkbox, and some habits want it. The
          choice is canonical rather than cosmetic — by all steps writes the
          children as `routine_step`, so the parent derives and has no action of
          its own; manually leaves them organisational, so the parent keeps one and
          the steps are independent (ADR-007). */}
      <View style={styles.completionRow}>
        <Text style={[styles.completionLabel, { color: theme.today.primaryText }]}>The routine closes</Text>
        <View style={[styles.completionSegment, { borderColor: theme.today.hairline }]}>
          {([[true, 'By all steps'], [false, 'Manually']] as const).map(([mode, label], index) => <Pressable
            key={label}
            accessibilityRole="radio"
            accessibilityState={{ checked: derived === mode }}
            onPress={() => setDerived(mode)}
            style={[styles.completionChoice, index === 0 ? null : { borderLeftColor: theme.today.hairline, borderLeftWidth: 1 }, derived === mode ? { backgroundColor: theme.today.completionTint } : null]}
          >
            <Text style={[styles.completionChoiceText, { color: derived === mode ? theme.today.completion : theme.today.secondaryText }]}>{label}</Text>
          </Pressable>)}
        </View>
      </View>
      <Text style={[styles.sheetFootnote, { color: theme.today.tertiaryText }]}>{derived
        ? 'Dates, schedule, priority and the mark come from the habit itself. The last step completed closes the routine, and the habit has no separate checkbox.'
        : 'The habit keeps its own checkbox and you tick it yourself. Its steps are listed under it and completed independently.'}</Text>

      {named.length === 0 ? null : <View style={[styles.routinePreviewWell, { backgroundColor: theme.today.rowTint }]}>
        <Text style={[styles.routinePreviewTitle, { color: theme.today.primaryText }]}>How this looks in Today</Text>
        <View style={[styles.routinePreviewCard, { backgroundColor: swatch.iconBackground }]}>
          <View style={styles.routinePreviewParent}>
            <View style={[styles.routinePreviewMark, { backgroundColor: theme.today.tileWash }]}><Ionicons color={swatch.iconForeground} name={HABIT_SYMBOL_GLYPHS[symbolKey]} size={20} /></View>
            <View style={styles.identityPreviewCopy}>
              <Text numberOfLines={1} style={[styles.routinePreviewName, { color: theme.today.primaryText }]}>{parentName.trim() || 'New habit'}</Text>
              <Text style={[styles.routinePreviewMeta, { color: theme.today.secondaryText }]}>{`0 of ${named.length} ${named.length === 1 ? 'step' : 'steps'}`}</Text>
            </View>
          </View>
          <View style={[styles.routinePreviewSteps, { backgroundColor: swatch.surface }]}>
            {named.slice(0, 3).map((step) => <View key={step.draftId} style={styles.routinePreviewStep}>
              <View style={[styles.routinePreviewRail, { backgroundColor: theme.today.hairline }]} />
              <Text numberOfLines={1} style={[styles.routinePreviewStepName, { color: theme.today.primaryText }]}>{step.name}</Text>
              {step.plannedTime === '' ? null : <Text style={[styles.routinePreviewStepTime, { color: theme.today.secondaryText }]}>{step.plannedTime}</Text>}
              <View style={[styles.routinePreviewControl, { borderColor: theme.today.tone200 }]} />
            </View>)}
            {named.length > 3 ? <Text style={[styles.routinePreviewMore, { color: theme.today.secondaryText }]}>{`+${named.length - 3} more`}</Text> : null}
          </View>
        </View>
      </View>}
    </ScrollView>
    <HabitTimeSheet
      onCancel={() => setTimeFor(null)}
      onDone={(plannedTime) => {
        setDraft((current) => current.map((item) => item.draftId === timeFor ? { ...item, plannedTime } : item));
        setTimeFor(null);
      }}
      value={editing?.plannedTime ?? ''}
      visible={editing !== null}
    />
  </PlannerFormSheet>;
}

/**
 * What is left of "More options": two dates and one note.
 *
 * Priority is not here. It moved to the create screen as a slider because it is
 * the only one of the three with a consequence visible on that screen.
 */
export function HabitDatesNoteSheet({ visible, activeFrom, activeTo, note, mode, onCancel, onDone }: {
  readonly visible: boolean;
  readonly activeFrom: string;
  readonly activeTo: string;
  readonly note: string;
  readonly mode: CreateScheduleMode;
  readonly onCancel: () => void;
  readonly onDone: (next: Readonly<{ activeFrom: string; activeTo: string; note: string; mode: CreateScheduleMode | null }>) => void;
}) {
  const theme = useLifePlannerTheme();
  const [from, setFrom] = useState(activeFrom);
  const [to, setTo] = useState(activeTo);
  const [text, setText] = useState(note);
  const [rare, setRare] = useState<CreateScheduleMode | null>(null);
  const opened = useRef(visible);
  if (visible && !opened.current) {
    setFrom(activeFrom);
    setTo(activeTo);
    setText(note);
    setRare(CREATE_EXTRA_SCHEDULE_MODES.includes(mode) ? mode : null);
  }
  opened.current = visible;
  return <PlannerFormSheet onCancel={onCancel} onDone={() => onDone({ activeFrom: from, activeTo: to, mode: rare, note: text })} title="Dates and note" visible={visible}>
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
      <Text style={[styles.sheetGroupLabel, { color: theme.today.tertiaryText }]}>DATES</Text>
      <View style={[styles.datesWell, { borderColor: theme.today.hairline }]}>
        <PlannerDateField label="Starts" onChange={setFrom} value={from} />
        <PlannerDateField label="Ends" minimumDate={from} onChange={setTo} optional value={to} />
      </View>
      <Text style={[styles.sheetFootnote, { color: theme.today.tertiaryText }]}>No end date stays a value, not an empty field.</Text>

      {/* The three rare repeats. They left the create screen so its segment could
          carry three legible modes instead of six clipped ones. */}
      <Text style={[styles.sheetGroupLabel, { color: theme.today.tertiaryText }]}>REPEATS LESS OFTEN</Text>
      <View style={[styles.datesWell, { borderColor: theme.today.hairline }]}>
        {CREATE_EXTRA_SCHEDULE_MODES.map((option) => <Pressable
          key={option}
          accessibilityRole="radio"
          accessibilityState={{ checked: rare === option }}
          onPress={() => setRare((current) => current === option ? null : option)}
          style={styles.rareRow}
        >
          <Text style={[styles.rareLabel, { color: theme.today.primaryText }]}>{CREATE_SCHEDULE_MODE_LABELS[option]}</Text>
          <Ionicons color={rare === option ? theme.today.completion : theme.today.tone200} name={rare === option ? 'checkmark-circle' : 'ellipse-outline'} size={22} />
        </Pressable>)}
      </View>
      <Text style={[styles.sheetFootnote, { color: theme.today.tertiaryText }]}>Choosing one of these replaces the repeat chosen on the create screen.</Text>

      <Text style={[styles.sheetGroupLabel, { color: theme.today.tertiaryText }]}>NOTE</Text>
      <TextInput
        accessibilityLabel="Note"
        multiline
        onChangeText={setText}
        placeholder="Why this habit, and what counts as done"
        placeholderTextColor={theme.today.tertiaryText}
        style={[styles.noteField, { borderColor: theme.today.hairline, color: theme.today.primaryText }]}
        value={text}
      />
      <Text style={[styles.sheetFootnote, { color: theme.today.tertiaryText }]}>Priority lives on the create screen as a slider — it is not here.</Text>
    </ScrollView>
  </PlannerFormSheet>;
}

const STEP_ACTIONS = Object.freeze([
  Object.freeze({ label: 'Move up', name: 'moveUp' }),
  Object.freeze({ label: 'Move down', name: 'moveDown' }),
]);

export function datesSummary(activeFrom: string, activeTo: string): string {
  const from = formatDraft(activeFrom);
  return activeTo === '' ? `From ${from}` : `${from} – ${formatDraft(activeTo)}`;
}

function formatDraft(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatPlannerDate(value as never, 'short') : value;
}

function canonicalOrNull(key: PersistedHabitAccentKey): CanonicalHabitAccentKey | null {
  return HABIT_ACCENT_OPTIONS.some((option) => option.key === key) ? key as CanonicalHabitAccentKey : null;
}

/** Suggestions first, then the catalogue's own meaning groups, four to a row. */
function buildSymbolGroups(suggested: readonly HabitIconOption[], name: string): readonly Readonly<{ title: string; options: readonly HabitIconOption[] }>[] {
  const groups = HABIT_ICON_CATEGORIES.map((category) => Object.freeze({
    options: filterHabitIconOptions('', category),
    title: category.toLocaleUpperCase(),
  })).filter(({ options }) => options.length > 0);
  if (suggested.length === 0) return Object.freeze(groups);
  const trimmed = name.trim();
  return Object.freeze([
    Object.freeze({ options: suggested, title: trimmed === '' ? 'SUGGESTED' : `SUITS “${trimmed.toLocaleUpperCase()}”` }),
    ...groups,
  ]);
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, elevation: 24, maxHeight: '86%', shadowOffset: { height: -12, width: 0 }, shadowOpacity: 0.18, shadowRadius: 40 },
  // 44 pt tall and full width: the band is the target, the handle only shows it.
  sheetHandleRow: { alignItems: 'center', height: 44, justifyContent: 'center' },
  sheetHandle: { borderRadius: 3, height: 5, width: 44 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingBottom: 12, paddingHorizontal: 18 },
  sheetCancel: { justifyContent: 'center', minHeight: 44, minWidth: 60 },
  sheetCancelText: { fontSize: 16 },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  sheetDoneTarget: { alignItems: 'flex-end', justifyContent: 'center', minHeight: 44, minWidth: 60 },
  sheetDone: { borderRadius: 11, paddingHorizontal: 13, paddingVertical: 8 },
  sheetDoneText: { fontSize: 14, fontWeight: '600' },
  sheetBody: { gap: 13, paddingBottom: 18, paddingHorizontal: 18 },
  // The sheet is capped at 86 % of the screen; the scrolling part shrinks inside it
  // rather than pushing the pinned field and the header off the top.
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetLead: { fontSize: 14, lineHeight: 20 },
  sheetFootnote: { fontSize: 13, lineHeight: 18 },
  sheetGroupLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
  sheetDivider: { height: 1 },

  wheelWell: { alignItems: 'stretch', justifyContent: 'center' },
  wheelWellMuted: { opacity: 0.35 },
  anyTimeRow: { alignItems: 'center', borderRadius: 16, flexDirection: 'row', gap: 12, minHeight: 56, paddingHorizontal: 14 },
  anyTimeLabel: { flex: 1, fontSize: 16 },
  switchTrack: { borderRadius: 15, flexDirection: 'row', height: 30, padding: 2, width: 50 },
  switchKnob: { backgroundColor: '#FFFFFF', borderRadius: 13, elevation: 2, height: 26, shadowOffset: { height: 1, width: 0 }, shadowOpacity: 0.2, shadowRadius: 3, width: 26 },

  identityPreview: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', gap: 13, padding: 13 },
  identityPreviewMark: { alignItems: 'center', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  identityPreviewCopy: { flex: 1, minWidth: 0 },
  identityPreviewName: { fontSize: 16, fontWeight: '600' },
  identityPreviewMeta: { fontSize: 13, marginTop: 1 },
  identityLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  identityAutoAction: { fontSize: 13, fontWeight: '600' },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { alignItems: 'center', borderRadius: 11, borderWidth: 2, height: 38, justifyContent: 'center', width: 38 },
  symbolGroup: { gap: 8 },
  symbolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Fixed 74 pt squares, centred on both axes. A percentage basis put the glyph
  // off-centre at fractional widths, which is what made the grid look crooked.
  symbolTile: { alignItems: 'center', borderRadius: 14, height: SYMBOL_TILE, justifyContent: 'center', width: SYMBOL_TILE },

  stepEntry: { gap: 8, paddingBottom: 12, paddingHorizontal: 18 },
  stepEntryField: { alignItems: 'center', borderRadius: 16, borderWidth: 2, flexDirection: 'row', gap: 9, minHeight: 56, paddingHorizontal: 14 },
  stepList: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 12 },
  stepRow: { alignItems: 'center', flexDirection: 'row', gap: 9, minHeight: 56, paddingHorizontal: 2 },
  stepOrdinal: { alignItems: 'center', borderRadius: 7, height: 22, justifyContent: 'center', width: 22 },
  stepOrdinalText: { fontSize: 12, fontWeight: '600' },
  stepInput: { flex: 1, fontSize: 16, minWidth: 0, paddingVertical: 8 },
  stepTimeChip: { alignItems: 'center', borderRadius: 11, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  stepTimeText: { fontSize: 13, fontWeight: '600' },
  stepRemove: { alignItems: 'center', height: 44, justifyContent: 'center', width: 28 },

  routinePreviewWell: { borderRadius: 16, gap: 10, padding: 14 },
  routinePreviewTitle: { fontSize: 14, fontWeight: '600' },
  routinePreviewCard: { borderRadius: 16, overflow: 'hidden' },
  routinePreviewParent: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 64, paddingHorizontal: 10 },
  routinePreviewMark: { alignItems: 'center', borderRadius: 13, height: 40, justifyContent: 'center', width: 40 },
  routinePreviewName: { fontSize: 16, fontWeight: '600' },
  routinePreviewMeta: { fontSize: 13, marginTop: 1 },
  routinePreviewSteps: { paddingVertical: 4 },
  routinePreviewStep: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 52, paddingHorizontal: 12 },
  routinePreviewRail: { height: 28, marginLeft: 10, width: 1 },
  routinePreviewStepName: { flex: 1, fontSize: 15, minWidth: 0 },
  routinePreviewStepTime: { fontSize: 13 },
  routinePreviewControl: { borderRadius: 15, borderWidth: 2, height: 30, width: 30 },
  routinePreviewMore: { fontSize: 13, paddingBottom: 8, paddingHorizontal: 34 },

  completionRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  completionLabel: { flex: 1, fontSize: 14, minWidth: 0 },
  completionSegment: { borderRadius: 12, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  completionChoice: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 10 },
  completionChoiceText: { fontSize: 12, fontWeight: '600' },
  datesWell: { borderRadius: 16, borderWidth: 1, gap: 12, padding: 14 },
  rareRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 44 },
  rareLabel: { flex: 1, fontSize: 16, minWidth: 0 },
  noteField: { borderRadius: 16, borderWidth: 1, fontSize: 15, lineHeight: 21, minHeight: 88, padding: 14, textAlignVertical: 'top' },
});
