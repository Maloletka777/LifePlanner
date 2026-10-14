import { useLocalSearchParams, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  beginPlannerPerformanceSpan,
  endPlannerPerformanceSpan,
  measurePlannerOperation,
  measurePlannerSynchronousOperation,
  parsePlannerLocalDate,
  requestReminderPermission,
  parsePlannerTimezone,
  type EffectiveRange,
  type ImportanceLevel,
  type PersistedHabitAccentKey,
  type PlannerLocalDate,
  type ReminderPermission,
} from '@/src/features/planner';
import { InlineError, TravellingSegment, type TravellingSegmentSlot } from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { plannerScheduleNextDates } from './create-habit-schedule-model';
import { PLATE_MARK, selectDayJournalItems } from './day-journal-model';
import { HabitIdentitySheet } from './create-habit-sheets';
import { TimeDrumSheet } from './time-drum-sheet';
import { type TimeDrumBusy } from './time-drum-model';
import { CategoryChip } from './item-chip';
import type { HabitIconIdentity } from '../domain/identity/habit-visual-identity';
import {
  parsePlannerDayBlock,
  PLANNER_MAX_GROWING_ROUTINES,
  type PlannerDayBlockKey,
  type PlannerGrowthEnjoyment,
} from '../domain/values/day-block';

import { currentDayBlock } from './day-blocks-model';
import {
  applyCreateItemType,
  applyCreateRepeatMode,
  CREATE_BLOCK_CHOICES,
  CREATE_BLOCK_LABELS,
  CREATE_ITEM_ACTION_LABELS,
  CREATE_ITEM_TYPE_LABELS,
  CREATE_ITEM_TYPES,
  createBlockChoice,
  createBlockSuggestion,
  createBlockValue,
  createDurationLabel,
  createQuickSymbolKeys,
  createRepeatSummary,
  CREATE_CATEGORY_OPTIONS,
  CREATE_NAME_PLACEHOLDERS,
  CREATE_TASK_PAST_MESSAGE,
  CREATE_REMINDER_NONE,
  createGrowthAvailable,
  createGrowthHasRoom,
  createGrowthSlotsLabel,
  createItemTypeFor,
  createRepeatModeFor,
  createTaskMomentIsPast,
  reminderSummary,
  reminderTriggerTime,
  type CreateBlockChoice,
  type CreateItemType,
  type CreateReminderDraft,
  type CreateRepeatMode,
} from './create-item-model';
import { CreateDateSheet, CreateDurationSheet, CreateReminderSheet, CreateRepeatSheet } from './create-item-sheets';
import {
  DEFAULT_HABIT_CATEGORY,
  habitCategory,
  habitCategoryAccentKey,
  habitCategoryColor,
  habitCategoryForAccentKey,
  habitCategoryTone,
  type HabitCategoryKey,
} from './habit-category-catalogue';
import { habitIconography } from './planner-iconography';
import type { RegisteredHabitSymbolKey } from '../domain/identity/habit-symbol-catalogue';
import { useHabitClosureRules, usePlannerGrowingRoutines, usePlannerOccurrences, usePlannerServices } from './planner-provider';
import { PrioritySlider } from './priority-slider';
import { namedRoutineSteps, withPendingStep, type RoutineStepDraft } from './routine-step-drafts';
import {
  buildCreateHabitCommand,
  buildScheduleDefinition,
  createDefaultScheduleDraft,
  createDefaultTrackingDraft,
  formatPlannerDate,
  formatPlannerDateEntry,
  plannerDaysBetween,
  plannerLocalDateFromDevice,
  plannerTimezoneFromDevice,
  type ParentHabitDraft,
  type ScheduleDraft,
  type UiAdapterError,
} from './ui-adapters';

/**
 * Three answers and no scale.
 *
 * A number here would invite a threshold — «below 4 out of 10, suggest changing it» — and
 * there is no evidence for where one would sit. Three words are what a person can answer
 * honestly in a second, which is the only kind of answer this question gets.
 */
const GROWTH_ENJOYMENT_LABELS: readonly Readonly<{ key: PlannerGrowthEnjoyment; label: string }>[] = Object.freeze([
  Object.freeze({ key: 'yes' as const, label: 'Yes' }),
  Object.freeze({ key: 'tolerated' as const, label: 'It is OK' }),
  Object.freeze({ key: 'no' as const, label: 'No' }),
]);

/**
 * One create sheet for the whole application, from `IA Options.dc.html` 11a/11b.
 *
 * The two frames are one window in two modes: the same blocks in the same order,
 * with the type chosen by a segment *after* the name has been started rather than
 * before anything is typed. Switching it exchanges exactly one block — a task has a
 * due date, a habit has a repeat — and touches nothing else, which is what lets a
 * person change their mind halfway through without losing a field.
 *
 * A task is not a second kind of record here. The Planner schema has no one-off
 * type, and inventing one would be a migration, so a task is written the way
 * PD-CREATE-003 already writes `Once`: a daily schedule whose active range is the
 * single day it is due. Everything else — identity, priority, steps, the note — is
 * the habit contract untouched.
 *
 * What the frames draw and this does not build, with reasons:
 *
 * - **Duration** (the seven chips). No field in the domain carries the length of an
 *   item; `duration` there is a metric *tracking mode*, which is a different thing
 *   entirely. Seven chips writing nowhere would be a fabrication.
 * - **Notifications are delivered now** (PD-NOTIFY-001 through `-003`). Setting a
 *   reminder asks for permission **here**, at the point it is set, because that is the
 *   only place the question means anything — a dialog at launch asks about something
 *   nobody has done yet. Refusal keeps the reminder exactly as configured and leaves it
 *   reading `permission_required`: the contract is explicit that scheduling never
 *   changes what the person planned.
 */
/**
 * What the editor supplies so that this one screen can serve both modes.
 *
 * The rules an edit runs on — the effective-dated correction, the tracking
 * definition carried through untouched, the archive and the previewed deletion —
 * stay in the editor, because they are its own and this screen has no business
 * knowing them. What it lends is its **language**: the same blocks in the same
 * order, so an item is changed in the window it was made in.
 */
export interface CreateItemEditMode {
  /** Which item is being edited, so its own closure rule can be read and written. */
  readonly habitId: string;
  readonly initial: Readonly<{
    name: string;
    note: string;
    importance: ImportanceLevel;
    plannedTime: string;
    /** The length the item carries, or `null` when nobody stated one. */
    plannedDurationMinutes: number | null;
    /** The part of the day it belongs to, or `null` for none. */
    plannedBlock: PlannerDayBlockKey | null;
    /**
     * The minute the item's reminder fires at, or empty for none.
     *
     * Without it this screen opened every saved item on `None` whatever was stored, which
     * is what read as the choice resetting itself the moment the sheet closed.
     */
    reminderTime: string;
    activeRange: Readonly<{ activeFrom: string; activeTo: string }>;
    schedule: ScheduleDraft;
    accentKey: PersistedHabitAccentKey | null;
    /** The stored symbol, so an item opened for editing shows the one it has. */
    symbolKey: RegisteredHabitSymbolKey | null;
  }>;
  /** The item's subtasks, live: this screen adds and removes them as they are typed. */
  readonly lines: readonly Readonly<{ id: string; text: string }>[];
  readonly save: (values: Readonly<{
    reminderTime: string;
    name: string;
    note: string;
    importance: ImportanceLevel;
    plannedTime: string;
    plannedDurationMinutes: number | null;
    plannedBlock: PlannerDayBlockKey | null;
    activeRange: Readonly<{ activeFrom: string; activeTo: string }>;
    schedule: ScheduleDraft;
    accentKey: PersistedHabitAccentKey;
    /** Null keeps the automatic symbol; a key is an explicit choice. */
    symbolKey: RegisteredHabitSymbolKey | null;
  }>) => Promise<string | null>;
  readonly addLine: (text: string) => Promise<string | null>;
  readonly removeLine: (lineId: string) => Promise<string | null>;
  readonly archive: () => void;
  readonly remove: () => void;
  /** Set when today could not be corrected and the change opened from tomorrow. */
  readonly appliedFrom: string | null;
}

/** No task split is needed to read a day's minutes, so the drum asks for none. */
const EMPTY_HABIT_IDS: ReadonlySet<string> = new Set();

/**
 * The clock, read once, only to decide which part of the day a new item opens on.
 *
 * Read directly rather than through the journal's own clock hook: nothing on this screen
 * ticks, and a hook that re-rendered the form every minute would be a cost paid for one
 * initial value.
 */
function createDeviceMinuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function CreateItemScreen({ edit }: { readonly edit?: CreateItemEditMode } = {}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; block?: string }>();
  const theme = useLifePlannerTheme();
  // Both bars are glass and both are outside the scroll, so the top inset is the bar's
  // own padding and the bottom inset is the action bar's.
  const insets = useSafeAreaInsets();
  const { addHabitChecklistLines, createHabitBundle, reconcileReminders, refreshOccurrences, startGrowingRoutine, stopGrowingRoutine } = usePlannerServices();

  const startDate = useMemo(() => {
    const parsed = parsePlannerLocalDate(params.date);
    return parsed.ok ? parsed.value : plannerLocalDateFromDevice();
  }, [params.date]);
  const timezone = useMemo(() => plannerTimezoneFromDevice(), []);
  const today = useMemo(() => plannerLocalDateFromDevice() as string, []);

  const [name, setName] = useState(edit?.initial.name ?? '');
  const [note, setNote] = useState(edit?.initial.note ?? '');
  const [importance, setImportance] = useState<ImportanceLevel>(edit?.initial.importance ?? 'normal');
  const [plannedTime, setPlannedTime] = useState(edit?.initial.plannedTime ?? '');
  // The length the drum was cut by, carried with the minute because they are one fact.
  const [plannedDuration, setPlannedDuration] = useState<number | null>(edit?.initial.plannedDurationMinutes ?? null);
  /**
   * Which part of the day it belongs to.
   *
   * A **new item opens on the part the day journal was showing** when the plus was
   * pressed — a person who tapped the plus on «Утро» has already answered this, and
   * asking again is the friction that stops a first item ever being created. Where the
   * plus carried nothing, it opens on the block the clock is in, which is the answer
   * somebody adding something now nearly always means.
   */
  const [blockChoice, setBlockChoice] = useState<CreateBlockChoice>(
    () => edit !== undefined
      ? createBlockChoice(edit.initial.plannedBlock)
      : parsePlannerDayBlock(params.block).ok
        ? params.block as CreateBlockChoice
        : currentDayBlock(createDeviceMinuteOfDay()) ?? 'anytime',
  );

  /**
   * Whether this routine is being grown, and how much room is left.
   *
   * The cap is counted from the attempts that are **actually open** rather than trusted
   * from anywhere: it is a product judgement that lives above the schema, so the only
   * honest place to enforce it is against the rows.
   */
  const growing = usePlannerGrowingRoutines();
  const growthUsed = growing.data?.length ?? 0;
  const alreadyGrowing = edit !== undefined && (growing.data ?? []).some((attempt) => attempt.habitId === edit.habitId);
  const [growth, setGrowth] = useState(alreadyGrowing);
  const [growthCue, setGrowthCue] = useState('');
  const [growthEnjoyment, setGrowthEnjoyment] = useState<PlannerGrowthEnjoyment | null>(null);
  const growthRoom = createGrowthHasRoom({ alreadyGrowing: growth, max: PLANNER_MAX_GROWING_ROUTINES, used: growthUsed });
  const [activeRange, setActiveRange] = useState(edit?.initial.activeRange ?? { activeFrom: startDate as string, activeTo: '' });
  const [schedule, setSchedule] = useState(() => edit?.initial.schedule ?? createDefaultScheduleDraft(startDate));
  // `Cancel` on the keyboard bar restores what the field held when it was focused;
  // `Done` keeps what was typed and dismisses. The bar already existed and was
  // already worn by `TextField` — create simply never wired it up.
  // Which slot the top bar shows: the journal's date at rest, `Done` while a
  // field is focused. It is the only thing the removed accessory bar carried that
  // the Return key does not.
  const [typing, setTyping] = useState(false);
  const dismissKeyboard = () => { Keyboard.dismiss(); setTyping(false); };
  // A category, not a free colour: the design gives an item exactly one chromatic
  // choice, and it is stored as the canonical accent key that hue already names.
  // An item saved with one of the sixteen keys that names no category keeps the
  // default here rather than being repainted behind the user's back; its stored
  // accent is only overwritten if the row is actually touched.
  const [category, setCategory] = useState<HabitCategoryKey>(
    () => habitCategoryForAccentKey(edit?.initial.accentKey ?? null)?.key ?? DEFAULT_HABIT_CATEGORY,
  );
  // **Opened on what the item carries, not on None.** A stored reminder is an absolute
  // minute; whether it was originally chosen as «ten minutes before» is not stored and
  // cannot be recovered, so it is shown as the fixed time it actually is rather than as a
  // guess at the offset that might have produced it.
  const [reminder, setReminder] = useState<CreateReminderDraft>(
    () => edit?.initial.reminderTime ? { kind: 'at', time: edit.initial.reminderTime } : CREATE_REMINDER_NONE,
  );
  // What the phone has already allowed. Asked for only when a reminder is actually set,
  // so an item created without one never raises the question at all.
  const [reminderPermission, setReminderPermission] = useState<ReminderPermission | null>(null);
  /*
   * `customDuration` is **deleted with the `Custom` key it labelled.** It existed to
   * describe a length the five chips could not offer, and there are no chips on this
   * screen now: the `Takes` row says whatever the length is, and the sheet behind it
   * holds both the presets and the stepper. A derived value whose only reader is gone
   * is the exact thing this project keeps finding alive behind a green suite.
   */
  const [steps, setSteps] = useState<readonly RoutineStepDraft[]>([]);
  const [pendingStep, setPendingStep] = useState('');

  const [openSheet, setOpenSheet] = useState<'time' | 'duration' | 'due' | 'reminder' | 'repeat' | null>(null);
  const [adjustingPriority, setAdjustingPriority] = useState(false);
  const [errors, setErrors] = useState<readonly UiAdapterError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const stepSequence = useRef(1);

  /**
   * The chosen symbol, or null for the automatic one.
   *
   * **The picker was unreachable, not removed.** PD-CREATE-024 took the block off
   * this surface and recorded that Edit kept it — which stopped being true the moment
   * Edit *became* this surface (PD-EDIT-005) and the old form was deleted. So the
   * catalogue, the sheet and the storage were all intact and nothing could reach
   * them, and every item wore the automatic symbol whether or not that suited it.
   */
  const [symbolKey, setSymbolKey] = useState<RegisteredHabitSymbolKey | null>(edit?.initial.symbolKey ?? null);
  const [symbolSheet, setSymbolSheet] = useState(false);
  // Decided by the name alone, so a tap never reorders the row under the finger
  // (PD-IDENTITY-007); the choice is carried by colour instead.
  const quickSymbols = useMemo(() => createQuickSymbolKeys(name), [name]);
  const accentKey: PersistedHabitAccentKey = habitCategoryAccentKey(category);
  // Hue is the item's data and never moves; lightness follows the theme, because a
  // 0.60 colour on a dark ground is not a readable mark (PD-CATEGORY-006).
  const tone = habitCategoryTone(habitCategory(category), theme.today.dashboardSurface, theme.dark);
  /**
   * **What the mark in the name row shows, and it is the day's own answer rather than a
   * guess at it.**
   *
   * `null` is not «no symbol» — it is what an unchosen symbol *stores*: `buildCreateHabitCommand`
   * leaves `iconIdentity` undefined, and `ItemGlyph` falls back to `habit_generic` for exactly
   * that case. So a mark drawn from `null` here is the same mark the plate will draw, and
   * predicting an automatic pick — which would have to guess at the domain's own rule — is
   * not needed and would be the wrong kind of confident.
   */
  const identity: HabitIconIdentity | null = symbolKey === null
    ? null
    : Object.freeze({ kind: 'symbol' as const, symbolKey });

  /**
   * The day the time drum cuts, and whose plan it marks as taken.
   *
   * The item's own first day: a task's due date, a habit's start. **For a habit that is
   * an example rather than the day** — a habit recurs — which is why the sheet states
   * the date it is showing rather than leaving the marks to be read as universal.
   */
  const drumDate = (activeRange.activeFrom === '' ? today : activeRange.activeFrom) as PlannerLocalDate;
  const dayPlan = usePlannerOccurrences(drumDate);
  const busyOnDay = useMemo<readonly TimeDrumBusy[]>(() => {
    // The journal's own selector, so the two surfaces cannot disagree about what stands
    // on a day. Nothing here needs a clock, a task split or a checklist: the drum wants
    // a minute, a name and — since schema v13 — however long the thing takes, so a notch
    // can say what is *happening* in it rather than only what starts in it.
    const { timed } = selectDayJournalItems({ nowMinuteOfDay: null, rootGroups: dayPlan.data?.rootGroups ?? [], taskHabitIds: EMPTY_HABIT_IDS });
    return timed
      // The item being edited is not something it collides with.
      .filter((item) => item.habitId !== edit?.habitId && item.minuteOfDay !== null)
      .map((item) => Object.freeze({
        durationMinutes: item.durationMinutes,
        minute: item.minuteOfDay as number,
        name: item.title,
      }));
  }, [dayPlan.data, edit?.habitId]);

  const itemType = createItemTypeFor(schedule, activeRange);
  const repeatMode = createRepeatModeFor(schedule, activeRange);
  // What the row says while the rule itself is behind the sheet: the days or the
  // number, not the mode's name — «Chosen days» tells nobody which days.
  const repeatSummary = createRepeatSummary(repeatMode, schedule);
  const scheduleResult = useMemo(
    () => buildScheduleDefinition(schedule, activeRange, timezone),
    [activeRange, schedule, timezone],
  );
  const confirmation = useScheduleConfirmation(scheduleResult, activeRange, timezone, repeatMode, itemType);

  const clearErrors = () => {
    setErrors((current) => current.length === 0 ? current : []);
    setSaveError((current) => current === null ? current : null);
  };

  const chooseType = (next: CreateItemType) => {
    if (next === itemType) return;
    clearErrors();
    // A task opened from a day that has gone would be due in the past before a
    // single field was touched, so it starts on today instead.
    const from = next === 'task' && activeRange.activeFrom < today ? today : activeRange.activeFrom;
    const applied = applyCreateItemType(next, schedule, { activeFrom: from, activeTo: activeRange.activeTo });
    setSchedule(applied.schedule);
    setActiveRange(applied.range);
  };

  const chooseRepeat = (mode: CreateRepeatMode) => {
    clearErrors();
    const applied = applyCreateRepeatMode(mode, schedule, activeRange);
    setSchedule(applied.schedule);
    setActiveRange(applied.range);
  };

  const chooseDueDate = (date: string) => {
    clearErrors();
    const applied = applyCreateItemType('task', schedule, { activeFrom: date, activeTo: '' });
    setSchedule(applied.schedule);
    setActiveRange(applied.range);
  };

  // The id comes from a counter rather than from the list's length: removing a step
  // and typing another would otherwise hand two rows the same key.
  const addPendingStep = () => {
    const stepName = pendingStep.trim();
    if (stepName === '') return;
    // **On an item that exists, a subtask is written the moment it is typed.**
    // There is nothing to save it with — it is a line of text and a tick per day,
    // and the item it belongs to is already there.
    if (edit !== undefined) {
      setPendingStep('');
      void edit.addLine(stepName).then((message) => { if (message !== null) setSaveError(message); });
      return;
    }
    const draftId = `step-${stepSequence.current}`;
    stepSequence.current += 1;
    setSteps((current) => [...current, { draftId, name: stepName, plannedTime: '' }]);
    setPendingStep('');
  };

  // Leaving the sheet is the discard: the draft is component state and unmounting
  // already throws it away, so asking about it buys nothing back (PD-CREATE-015).
  const requestCancel = () => router.back();

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    beginPlannerPerformanceSpan('create_to_visible_result');
    if (edit !== undefined) {
      // The editor owns what an edit *means* — the effective-dated correction and
      // everything it carries through untouched. This screen owns what it looks
      // like, and hands over the values it collected.
      const message = await edit.save({ accentKey, activeRange, importance, name, note, plannedBlock: createBlockValue(blockChoice), plannedTime, plannedDurationMinutes: plannedDuration, reminderTime: reminderTriggerTime(reminder, plannedTime) ?? '', schedule, symbolKey });
      savingRef.current = false;
      setSaving(false);
      endPlannerPerformanceSpan('create_to_visible_result');
      if (message !== null) {
        setSaveError(message);
        return;
      }
      // The switch, on an item that already exists. Starting and stopping are separate
      // commands rather than one setter, because an attempt is a row and stopping one
      // closes it rather than deleting it — somebody who takes a routine on again in the
      // spring starts a second attempt from zero, and the first one still happened.
      if (growth !== alreadyGrowing) {
        const changed = growth
          ? await startGrowingRoutine({
            cue: growthCue.trim() === '' ? null : growthCue.trim(),
            enjoyment: growthEnjoyment,
            habitId: edit.habitId,
            trackedFrom: today,
          })
          : await stopGrowingRoutine({ habitId: edit.habitId, stoppedFrom: today });
        if (!changed.ok) {
          setSaveError(changed.error.message);
          return;
        }
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      // Wrapped rather than passed: `requestAnimationFrame` would hand its timestamp in as
      // the scope, and a number is not a date to spare from the drop.
      requestAnimationFrame(() => refreshOccurrences());
      // **Saving a reminder is what enqueues its scheduling**, which is the contract's own
      // first step and the one moment reconciliation cannot wait for the next foreground:
      // somebody who sets a reminder and stays in the application would otherwise have
      // nothing scheduled until they left it and came back.
      reconcileReminders();
      return;
    }
    const named = namedRoutineSteps(withPendingStep(steps, pendingStep));
    const parent: ParentHabitDraft = {
      accentSelection: 'explicit',
      activeRange,
      description: note,
      iconKey: null,
      // Automatic until a symbol is actually chosen, so an item nobody bothered with
      // still has a mark rather than a hole — and an explicit choice is stored as one.
      iconSelection: symbolKey === null ? ('automatic' as const) : ('explicit' as const),
      iconSymbolKey: symbolKey,
      importance,
      name,
      persistedAccentKey: accentKey,
      plannedBlock: createBlockValue(blockChoice),
      plannedTime,
      plannedDurationMinutes: plannedDuration,
      reminderTime: reminderTriggerTime(reminder, plannedTime) ?? '',
      schedule,
      tracking: createDefaultTrackingDraft(),
    };
    /**
     * **A subtask is a line, not a habit.**
     *
     * It used to be written as an ordinary child — a whole habit with its own
     * schedule, its own observations and its own place in the catalogue, which is
     * how a checklist ended up able to reach a statistic and to appear as a row of
     * the day. It is a line of text with a tick per day now, so only the item
     * itself is a habit and the lines are written after it.
     */
    const built = measurePlannerSynchronousOperation('create_validation', () => buildCreateHabitCommand(parent, timezone));
    if (!built.ok) {
      setErrors(built.errors);
      setSaveError('Review this before saving.');
      savingRef.current = false;
      setSaving(false);
      endPlannerPerformanceSpan('create_to_visible_result');
      return;
    }
    setSaveError(null);
    const result = await measurePlannerOperation('create_command', () => createHabitBundle({
      habits: [{ command: built.value, parentIndex: null, relationshipMode: 'independent' as const }],
    }));
    if (!result.ok) {
      savingRef.current = false;
      setSaving(false);
      endPlannerPerformanceSpan('create_to_visible_result');
      setSaveError(`${result.error.message} Nothing was changed, and your drafts are still available.`);
      return;
    }
    const saved = result.value[0];
    if (named.length > 0 && saved !== undefined) {
      // The lines begin on the day the item does, so a habit created today does
      // not put an unticked checklist on days that have already gone.
      const lines = await addHabitChecklistLines({
        habitId: saved.id,
        localDate: activeRange.activeFrom,
        texts: named.map((step) => step.name),
      });
      if (!lines.ok) {
        savingRef.current = false;
        setSaving(false);
        endPlannerPerformanceSpan('create_to_visible_result');
        setSaveError(`${lines.error.message} The item was created; its subtasks were not.`);
        return;
      }
    }
    // **The second floor is written after the item exists**, and a failure here does not
    // undo the item: somebody who made a routine and could not take it on still made a
    // routine. That is why it is a separate write rather than a field on the create
    // command — the two floors fail independently because they *are* independent.
    if (growth && saved !== undefined) {
      const started = await startGrowingRoutine({
        cue: growthCue.trim() === '' ? null : growthCue.trim(),
        enjoyment: growthEnjoyment,
        habitId: saved.id,
        trackedFrom: activeRange.activeFrom,
      });
      if (!started.ok) {
        savingRef.current = false;
        setSaving(false);
        endPlannerPerformanceSpan('create_to_visible_result');
        setSaveError(`${started.error.message} It was created, but taking it on for growth failed.`);
        return;
      }
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    savingRef.current = false;
    setSaving(false);
    beginPlannerPerformanceSpan('create_refresh');
    beginPlannerPerformanceSpan('create_navigation');
    // Back to whichever screen opened this, rather than onto Planner. Creation
    // starts from Today now, and being moved to another module for having made
    // something is a place nobody asked to go.
    router.back();
    requestAnimationFrame(() => refreshOccurrences());
    reconcileReminders();
  };

  const stepCount = namedRoutineSteps(withPendingStep(steps, pendingStep)).length;
  // The rule is read once for the item being edited and written on save; a new item
  // has no id to attach it to until it exists, so it is written after creation.
  const editedHabitIds = useMemo(() => (edit === undefined ? [] : [edit.habitId]), [edit]);
  const closureRules = useHabitClosureRules(editedHabitIds).rules;
  const storedClosure = edit === undefined ? false : closureRules.get(edit.habitId) ?? false;
  const [closureChoice, setClosureChoice] = useState<boolean | null>(null);
  const closesByChecklist = closureChoice ?? storedClosure;
  const { setHabitClosureRule } = usePlannerServices();
  const setClosesByChecklist = (next: boolean) => {
    setClosureChoice(next);
    // **Written where it is chosen**, because a checklist on an item that already
    // exists is written as it is typed and the rule that governs it cannot lag behind.
    if (edit !== undefined) void setHabitClosureRule({ closesByChecklist: next, habitId: edit.habitId });
  };
  const nowMinuteOfDay = new Date().getHours() * 60 + new Date().getMinutes();
  const pastMoment = createTaskMomentIsPast({
    dueDate: activeRange.activeFrom,
    nowMinuteOfDay,
    plannedTime,
    today,
    type: itemType,
  });
  const canCreate = !saving && name.trim() !== '' && !pastMoment;

  return <View style={[styles.screen, { backgroundColor: theme.today.appSurface }]}>
    {/* **Glass, and outside the scroll.** The same `BlurView` over `materialFill` that
        carries Today's header and its FAB — Create had no material at all, which is what
        made it read as a form pasted onto the application rather than a page of it. The
        bar keeps `Done` reachable at any scroll position, which is the one job the
        removed accessory slab had that the Return key does not cover, and it finally
        states which screen this is: creating and editing used to differ only by a word
        on a button at the very bottom. */}
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <BlurView intensity={theme.today.materialBlur} style={StyleSheet.absoluteFill} tint={theme.dark ? 'dark' : 'light'} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.today.materialFill }]} />
      <View style={[styles.barEdge, { backgroundColor: theme.today.hairline }]} />
      <View style={styles.topBar}>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" disabled={saving} onPress={requestCancel} style={styles.topBarAction}>
          <Text style={[styles.topBarText, { color: saving ? theme.today.pending : theme.today.secondaryText }]}>Cancel</Text>
        </Pressable>
        <Text numberOfLines={1} style={[styles.topBarTitle, { color: theme.today.primaryText }]}>
          {edit === undefined ? 'New item' : 'Edit'}
        </Text>
        {typing
          ? <Pressable accessibilityLabel="Done" accessibilityRole="button" onPress={dismissKeyboard} style={styles.topBarTrailing}>
            <Text style={[styles.topBarDoneText, { color: theme.today.system }]}>Done</Text>
          </Pressable>
          : <View style={styles.topBarTrailing}>
            <Text numberOfLines={1} style={[styles.topBarDate, { color: theme.today.tertiaryText }]}>{formatPlannerDateEntry(today)}</Text>
          </View>}
      </View>
    </View>

    {/* **The sheet rises exactly one keyboard and no more.** The over-scroll was
        two offsets stacking: the keyboard inset *plus* an automatic scroll to the
        focused input. The inset alone puts the field being typed above the
        keyboard, because it is in the lower half of the sheet anyway. */}
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      scrollEnabled={!adjustingPriority}
    >
      {/* The type, chosen first and steerable throughout. Each slot carries its
          own node, which is the same shape language the two pills above the plus
          were meant to teach — and this is where it can be changed rather than
          only decided (PD-CREATE-022). Switching exchanges exactly one block.

          **It is a choice only while the item is being made.** Editing is for
          changing an item, not for turning it into a different kind of thing: a
          habit is a rule that recurs and a task is one day's work, so the switch
          would silently rewrite the schedule of something that already has marks
          against it. The block the type governs — Repeat or Due date — is still
          the right one, because the type is read back from the schedule. */}
      {/* **The two plates for the two shapes, and the selection travels between them**
          (owner instruction, 2026-08-06). It is the same chooser PD-CREATE-022
          approved — two full-width slots in a track — and it still carries the shape
          language, except that the language has moved on: the node is the *mark* the
          item will actually wear, a circle for a task and a rounded square for a habit
          (`item-chip.tsx`), rather than the filled dot and ring of the older node.

          **A choice only while the item is being made.** Editing changes an item, it does
          not turn it into a different kind of thing, so the segment is absent there and
          the schedule keeps the type it has. */}
      {edit !== undefined ? null : <TravellingSegment
        onChange={(key) => chooseType(key as CreateItemType)}
        slots={TYPE_SLOTS}
        value={itemType}
      />}

      {/* ── The item: what it is, and what it will look like ─────────────────── */}
      <View style={[styles.plate, { backgroundColor: theme.today.dashboardSurface }]}>
        {/* **The name row leads with the mark the day will draw, not with a stand-in.**
            It used to be `ItemNode` with no identity, which returns the bare 11 pt dot —
            so choosing a colour repainted a dot and a chosen symbol appeared nowhere on
            this screen at all. `CategoryChip` is the component Today and Manage already
            draw an item with, at `PLATE_MARK`, so the row is a preview by construction
            rather than by resemblance, and two surfaces cannot drift apart. */}
        <View style={styles.nameRow}>
          <View accessibilityElementsHidden>
            <CategoryChip accentKey={accentKey} categoryKey={category} identity={identity} kind={itemType} size={PLATE_MARK} />
          </View>
          <TextInput
            accessibilityLabel="Name"
            autoCapitalize="sentences"
            onChangeText={(next) => { clearErrors(); setName(next); }}
            onBlur={() => setTyping(false)}
            onFocus={() => setTyping(true)}
            returnKeyType="done"
            /* A placeholder, never a value: that is what makes it vanish on the
               first touch with the caret at the left edge and nothing selected. */
            placeholder={CREATE_NAME_PLACEHOLDERS[itemType]}
            placeholderTextColor={theme.today.tertiaryText}
            style={[styles.nameField, { color: theme.today.primaryText }]}
            value={name}
          />
        </View>

        {/* **Colour and symbol are one decision in one plate, under the mark they both
            change.** They used to stand four blocks and a divider apart. The names are
            back: the six categories sit at one lightness *by design* (PD-PLATE-018), so
            they are not separable by brightness at all and a bare circle tells a person
            nothing — which is what the owner reported and the canonical drawing already
            says. Storage is untouched; the six are still canonical accent keys. */}
        <Text style={[styles.blockLabel, { color: theme.today.tertiaryText }]}>Category</Text>
        <View accessibilityRole="radiogroup" style={styles.wrapRow}>
          {CREATE_CATEGORY_OPTIONS.map((option) => {
            const selected = option.key === category;
            const swatch = habitCategoryColor(option, theme.dark);
            return <Pressable
              key={option.key}
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => { clearErrors(); setCategory(option.key); }}
              style={[styles.categoryPill, {
                borderColor: selected ? swatch : theme.today.hairline,
                borderWidth: selected ? 1.5 : 1,
              }]}
            >
              <View style={[styles.categoryDot, { backgroundColor: swatch }]} />
              <Text numberOfLines={1} style={[styles.categoryLabel, {
                color: selected ? theme.today.primaryText : theme.today.secondaryText,
                fontWeight: selected ? '600' : '400',
              }]}
              >{option.label}</Text>
            </Pressable>;
          })}
        </View>

        <Text style={[styles.blockLabel, { color: theme.today.tertiaryText }]}>Symbol</Text>
        {/* The tiles are what the item's own name suggests and the `…` opens the whole
            catalogue; **the row never reorders**, because it depends on the name alone
            (PD-IDENTITY-007), and the selection is carried by colour. */}
        <View accessibilityRole="radiogroup" style={styles.wrapRow}>
          {quickSymbols.map((key) => {
            const selected = key === symbolKey;
            return <Pressable
              key={key}
              accessibilityLabel={habitIconography(key, accentKey).label}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              // Tapping the chosen one again returns the item to its automatic
              // symbol, so a choice made by accident has a way back that does not
              // require guessing which tile was the original.
              onPress={() => { clearErrors(); setSymbolKey(selected ? null : key); }}
              style={[styles.iconTile, {
                backgroundColor: selected ? tone.fill : 'transparent',
                borderColor: selected ? tone.color : theme.today.hairline,
              }]}
            >
              <Ionicons
                color={selected ? tone.color : theme.today.secondaryText}
                name={habitIconography(key, accentKey).icon}
                size={20}
              />
            </Pressable>;
          })}
          <Pressable
            accessibilityLabel="All symbols"
            accessibilityRole="button"
            onPress={() => setSymbolSheet(true)}
            style={[styles.iconTile, { borderColor: theme.today.hairline, borderStyle: 'dashed' }]}
          >
            <Ionicons color={theme.today.secondaryText} name="ellipsis-horizontal" size={20} />
          </Pressable>
        </View>
      </View>

      {/* ── The day: when inside it, in the order a person answers ───────────────
          Which part of the day, then how long it takes, and only then — if the
          outside world set one — the minute. Asking for the minute first is what
          made everybody invent one. */}
      <View style={[styles.plate, { backgroundColor: theme.today.dashboardSurface }]}>
        <Text style={[styles.blockLabel, { color: theme.today.tertiaryText }]}>When</Text>
        <View accessibilityRole="radiogroup" style={styles.wrapRow}>
          {CREATE_BLOCK_CHOICES.map((choice) => <Chip
            key={choice}
            label={CREATE_BLOCK_LABELS[choice]}
            onPress={() => { clearErrors(); setBlockChoice(choice); }}
            selected={choice === blockChoice}
          />)}
        </View>

        {/* **How long it takes lives here and nowhere else.** It used to be five chips
            on the page *and* a chip row inside the drum, on two different sets — 45 and
            120 unreachable in one, 5 and 10 in the other — so one fact had two homes
            that disagreed. Nothing is chosen by default: an item with no length stores
            `NULL`, meaning «nobody said». */}
        <FieldRow
          icon="hourglass-outline"
          label="Takes"
          onClear={plannedDuration === null ? undefined : () => { clearErrors(); setPlannedDuration(null); }}
          onPress={() => setOpenSheet('duration')}
          value={plannedDuration === null ? 'no matter' : createDurationLabel(plannedDuration)}
        />

        {/* The minute, off unless the outside world set one — a train, a class, an
            appointment. **The only door to the drum**, where there were two: `Custom`
            and this row opened the same sheet under two different names. */}
        <FieldRow
          icon="alarm-outline"
          label="Starts at"
          onClear={plannedTime === '' ? undefined : () => { clearErrors(); setPlannedTime(''); }}
          onPress={() => setOpenSheet('time')}
          value={plannedTime === '' ? 'not set' : plannedTime}
        />
      </View>

      {/* ── The rhythm: how often, and whether to be told ────────────────────────
          One row is exchanged by type — a habit has a repeat, a task has a day —
          and nothing else moves. */}
      <View style={[styles.plate, { backgroundColor: theme.today.dashboardSurface }]}>
        {itemType === 'task'
          ? <FieldRow
            icon="calendar-outline"
            label="Due date"
            onPress={() => setOpenSheet('due')}
            value={formatPlannerDateEntry(activeRange.activeFrom)}
          />
          : <FieldRow
            icon="repeat-outline"
            label="Repeats"
            onPress={() => setOpenSheet('repeat')}
            value={repeatSummary}
          />}

        {/* Reminder. Scheduled on the days the item runs, and asked for the
            permission it needs at the moment it is set rather than at launch. */}
        <FieldRow
          icon="notifications-outline"
          label="Reminder"
          onPress={() => setOpenSheet('reminder')}
          value={reminderPermission === 'denied' && reminderTriggerTime(reminder, plannedTime) !== null
            ? 'needs permission'
            : reminderSummary(reminder, plannedTime)}
        />
        {confirmation === null || itemType === 'task' ? null : <Text style={[styles.confirmation, { color: theme.today.tertiaryText }]}>{confirmation}</Text>}
      </View>

      {/* ── How important, and the control says what the plate will draw ───────── */}
      <View style={[styles.plate, { backgroundColor: theme.today.dashboardSurface }]}>
        <PrioritySlider
          onChange={(next) => { clearErrors(); setImportance(next); }}
          onDragStateChange={setAdjustingPriority}
          value={importance}
        />
      </View>

        {/* 11 · The second floor, and it is a switch the person throws rather than a
            state the application infers. The whole meaning of «growing» is that somebody
            said «this one matters to me now» — inferred from priority or frequency it
            would be a decision nobody made, and there would be nothing to accompany.

            **Habits only**: a task is one day's work and has no rhythm to grow. */}
        {!createGrowthAvailable(itemType) ? null : <View style={[styles.plate, { backgroundColor: theme.today.dashboardSurface }]}>
          <View>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: growth, disabled: !growthRoom }}
              onPress={() => { if (growthRoom) setGrowth((on) => !on); }}
              style={styles.growthRow}
            >
              <View style={styles.growthWords}>
                <Text style={[styles.growthTitle, { color: growthRoom ? theme.today.primaryText : theme.today.tertiaryText }]}>I am growing this</Text>
                <Text style={[styles.growthCaption, { color: theme.today.secondaryText }]}>
                  {growthRoom
                    ? 'The app will follow this routine and say when it starts to wobble'
                    : 'All three places are taken. Free one on the Growth tab'}
                </Text>
              </View>
              <Text style={[styles.growthSlots, { color: theme.today.secondaryText }]}>
                {createGrowthSlotsLabel({ max: PLANNER_MAX_GROWING_ROUTINES, used: growthUsed })}
              </Text>
              {/* **Structure, not completion.** This switch was `completion` — the green
                  that means «done» and nothing else in the application (PD-PLATE-004) —
                  on a screen where there is nothing to complete. */}
              <View style={[styles.growthMark, {
                backgroundColor: growth ? theme.today.structFill : 'transparent',
                borderColor: growth ? theme.today.structFill : theme.today.hairline,
              }]}
              >
                {growth ? <Ionicons color={theme.today.onAccent} name="checkmark" size={14} /> : null}
              </View>
            </Pressable>

            {/* **Two questions, and both are asked once, here.** They are asked at all
                because the answers are cheap now and expensive later: what a person does
                this *after* is the strongest single predictor of a habit forming, and
                whether they enjoy it predicts how strongly — a routine somebody dreads is
                worth naming when it is taken on rather than diagnosing three weeks in.
                Both may be left blank; neither is a gate. */}
            {!growth ? null : <View style={styles.growthQuestions}>
              <Text style={[styles.growthQuestion, { color: theme.today.secondaryText }]}>What do you do this after?</Text>
              <TextInput
                maxLength={120}
                onBlur={() => setTyping(false)}
                onChangeText={setGrowthCue}
                onFocus={() => setTyping(true)}
                placeholder="For example: after the morning coffee"
                placeholderTextColor={theme.today.tertiaryText}
                returnKeyType="done"
                style={[styles.growthInput, { borderColor: theme.today.hairline, color: theme.today.primaryText }]}
                value={growthCue}
              />
              <Text style={[styles.growthQuestion, { color: theme.today.secondaryText }]}>Do you enjoy doing this?</Text>
              <View accessibilityRole="radiogroup" style={styles.wrapRow}>
                {GROWTH_ENJOYMENT_LABELS.map((option) => <Chip
                  key={option.key}
                  label={option.label}
                  onPress={() => setGrowthEnjoyment(option.key)}
                  selected={option.key === growthEnjoyment}
                />)}
              </View>
            </View>}
          </View>
        </View>}

        {/* ── Steps: a checklist, not small items. No day, no time, no reminder. ── */}
        <View style={[styles.plate, { backgroundColor: theme.today.dashboardSurface }]}>
          <View style={styles.stepsHeader}>
            <Text style={[styles.blockLabel, { color: theme.today.tertiaryText, flex: 1 }]}>Steps</Text>
            {stepCount === 0 ? null : <Text style={[styles.stepsCount, { color: theme.today.tertiaryText }]}>{stepCount}</Text>}
          </View>
          {/* **How this item closes, and the two shapes are separate.** Ticking every
              line closes the item and it carries no checkbox of its own; or the item
              has its checkbox and the lines are its own business. Closing from the
              lines *and* keeping a checkbox is the state that had no answer — the last
              tick closed the item and unticking the item left every line ticked.

              Stored as one row per item, absence being «by hand», so every item written
              before it behaves exactly as it did (PD-SUBTASK-004). It is **not**
              effective-dated: a schedule decides what a past day meant, this decides
              what happens when a finger lands on a checkbox. */}
          {/* The same travelling chooser the type takes: one control shape, one
              expression of selection, so a person does not meet two ways of showing a
              choice between two things on one screen. */}
          {stepCount === 0 ? null : <View style={styles.closureRow}>
            <TravellingSegment
              compact
              onChange={(key) => setClosesByChecklist(key === 'lines')}
              slots={CLOSURE_SLOTS}
              value={closesByChecklist ? 'lines' : 'manual'}
            />
          </View>}
          {edit === undefined
            ? steps.map((step, index) => <View
              key={step.draftId}
              accessibilityActions={STEP_ACTIONS}
              onAccessibilityAction={() => setSteps((current) => current.filter((item) => item.draftId !== step.draftId))}
              style={styles.stepRow}
            >
              <View accessibilityElementsHidden style={[styles.stepBox, { borderColor: theme.today.tone300 }]} />
              <TextInput
                accessibilityLabel={`Step ${index + 1}`}
                onChangeText={(next) => setSteps((current) => current.map((item) => item.draftId === step.draftId ? { ...item, name: next } : item))}
                placeholder="Step"
                placeholderTextColor={theme.today.tertiaryText}
                style={[styles.stepText, { color: theme.today.primaryText }]}
                value={step.name}
              />
            </View>)
            // On an existing item the lines are the stored ones, and removing one
            // is dated: every day before today keeps it.
            : edit.lines.map((line) => <View key={line.id} style={styles.stepRow}>
              <View accessibilityElementsHidden style={[styles.stepBox, { borderColor: theme.today.tone300 }]} />
              <Text style={[styles.stepText, { color: theme.today.primaryText }]}>{line.text}</Text>
              <Pressable
                accessibilityLabel={`Remove ${line.text}`}
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => void edit.removeLine(line.id).then((message) => { if (message !== null) setSaveError(message); })}
                style={styles.stepRemove}
              >
                <Text style={[styles.stepRemoveGlyph, { color: theme.today.tertiaryText }]}>×</Text>
              </Pressable>
            </View>)}
          <View style={styles.stepRow}>
            <View accessibilityElementsHidden style={[styles.stepBox, styles.stepBoxPending, { borderColor: theme.today.tone300 }]} />
            <TextInput
              accessibilityLabel="New step"
              // **One line per visit to the keyboard.** Holding focus queued a second
              // line immediately, and the sheet had already risen exactly one
              // keyboard — so that second field was the one thing on the page the
              // keyboard covered. Committing now dismisses, and an **empty** line
              // dismisses too without writing anything, because `addPendingStep`
              // returns on a blank name: the submit key is then simply a way out of a
              // field tapped by accident. Overrides the step clause of PD-CREATE-026.
              blurOnSubmit
              onBlur={() => setTyping(false)}
              onChangeText={setPendingStep}
              onFocus={() => setTyping(true)}
              onSubmitEditing={addPendingStep}
              placeholder="New step"
              placeholderTextColor={theme.today.tertiaryText}
              returnKeyType="done"
              style={[styles.stepText, styles.stepPendingText, { borderBottomColor: theme.today.hairline, color: theme.today.primaryText }]}
              value={pendingStep}
            />
          </View>
        </View>

        {/* ── The item's own words ─────────────────────────────────────────────── */}
        <View style={[styles.plate, { backgroundColor: theme.today.dashboardSurface }]}>
          <Text style={[styles.blockLabel, { color: theme.today.tertiaryText }]}>Note</Text>
          <TextInput
            accessibilityLabel="Note"
            multiline
            onBlur={() => setTyping(false)}
            onChangeText={setNote}
            onFocus={() => setTyping(true)}
            placeholder="Anything worth remembering"
            placeholderTextColor={theme.today.tertiaryText}
            style={[styles.note, { color: theme.today.primaryText }]}
            value={note}
          />
        </View>

        {pastMoment ? <InlineError message={CREATE_TASK_PAST_MESSAGE} /> : null}
        {errors.length === 0 ? null : <View style={styles.errorList}>{errors.map((item) => <InlineError key={`${item.field}:${item.message}`} message={item.message} />)}</View>}
        {saveError === null ? null : <InlineError message={saveError} />}

        {/* Archive is reversible and keeps every mark, so it asks nothing.
            Deleting previews the chain and confirms with the one number that
            matters: how much history goes with it. */}
        {edit === undefined ? null : <View style={[styles.plate, { backgroundColor: theme.today.dashboardSurface }]}>
          {edit.appliedFrom === null ? null : <Text style={[styles.lifecycleNote, { color: theme.today.secondaryText }]}>
            Today already has marks against it, so the change starts from {formatPlannerDateEntry(edit.appliedFrom)}.
          </Text>}
          <Pressable accessibilityRole="button" disabled={saving} onPress={edit.archive} style={styles.lifecycleRow}>
            <Text style={[styles.lifecycleText, { color: theme.today.primaryText }]}>Archive</Text>
            <Text style={[styles.lifecycleHint, { color: theme.today.tertiaryText }]}>Keeps every mark</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={saving} onPress={edit.remove} style={styles.lifecycleRow}>
            <Text style={[styles.lifecycleText, { color: theme.today.attentionText }]}>Delete</Text>
            <Text style={[styles.lifecycleHint, { color: theme.today.tertiaryText }]}>Removes its history</Text>
          </Pressable>
        </View>}
    </ScrollView>

    {/* **The action hangs, and it is reachable the moment a name exists** (owner
        instruction, 2026-08-06: «кнопка create должна быть висящей… чтобы не мотать
        вниз»). It used to be the last thing inside the scroll: on a habit with growth,
        steps and a note it stood a screen and a half below the fold, so making something
        meant scrolling past everything you had just decided not to fill in.

        Nothing else gates it — a name is the whole requirement, and it always was;
        what was missing was the ability to reach the button.

        **Recorded cost:** while the keyboard is up this bar is behind it, as any pinned
        bar on iOS is. That is why `Done` sits in the top bar, which is not behind
        anything. Raising it with a `KeyboardAvoidingView` was refused: the scroll
        already carries `automaticallyAdjustKeyboardInsets`, and the two offsets stack —
        the exact over-scroll this screen was fixed for once already. */}
    <View style={[styles.bar, styles.actionBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <BlurView intensity={theme.today.materialBlur} style={StyleSheet.absoluteFill} tint={theme.dark ? 'dark' : 'light'} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.today.materialFill }]} />
      <View style={[styles.barEdge, styles.barEdgeTop, { backgroundColor: theme.today.hairline }]} />
      <Pressable
        accessibilityHint={canCreate ? undefined : 'Give it a name first'}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canCreate }}
        disabled={!canCreate}
        onPress={() => void save()}
        style={({ pressed }) => [styles.action, {
          backgroundColor: !canCreate
            ? theme.today.tone200
            : pressed ? theme.today.pressedSurface : theme.today.structFill,
        }]}
      >
        <Text style={[styles.actionText, { color: canCreate ? theme.today.onAccent : theme.today.tertiaryText }]}>
          {edit === undefined
            ? (saving ? 'Creating…' : CREATE_ITEM_ACTION_LABELS[itemType])
            : (saving ? 'Saving…' : 'Save changes')}
        </Text>
      </Pressable>
    </View>

    {/* The whole catalogue, for the symbol the seven tiles did not suggest. Symbols
        only — an item's colour is a category here (PD-IDENTITY-003), so the sixteen
        swatches stay out of this sheet even though it can draw them. */}
    <HabitIdentitySheet
      accentKey={accentKey}
      automatic={symbolKey === null}
      colours={false}
      name={name}
      onCancel={() => setSymbolSheet(false)}
      onDone={({ symbolKey: chosen }) => { clearErrors(); setSymbolKey(chosen); setSymbolSheet(false); }}
      symbolKey={symbolKey ?? 'habit_generic'}
      visible={symbolSheet}
    />

    {/* The drum, not a spinner: the day is cut by the chosen length, so every start
        lands where the one before it would have ended (PD-CREATE-029). */}
    <TimeDrumSheet
      busy={busyOnDay}
      dayLabel={formatPlannerDateEntry(drumDate)}
      dayOffset={plannerDaysBetween(today as PlannerLocalDate, drumDate)}
      onCancel={() => setOpenSheet(null)}
      durationValue={plannedDuration}
      onDone={(value) => {
        clearErrors();
        setPlannedTime(value);
        // **The drum no longer returns a length, and that is a defect closed rather
        // than a feature dropped.** Touching a notch size to see the day cut differently
        // used to set `durationStated`, so re-cutting the day *to find a start* wrote a
        // duration nobody had stated — which the sheet's own comment says must never
        // happen. The length now lives in one place, the `Takes` row.
        //
        // **Setting a minute suggests a part of the day, and only where none was
        // chosen.** Somebody who has said «в 7:20» has answered «when» well enough that
        // asking again is asking twice; somebody who already picked «Вечер» has made a
        // choice the clock is not allowed to overrule.
        if (blockChoice === 'anytime') {
          const suggested = createBlockSuggestion(value);
          if (suggested !== null) setBlockChoice(suggested);
        }
        setOpenSheet(null);
      }}
      value={plannedTime}
      visible={openSheet === 'time'}
    />
    <CreateDurationSheet
      onCancel={() => setOpenSheet(null)}
      onDone={(minutes) => { clearErrors(); setPlannedDuration(minutes); setOpenSheet(null); }}
      value={plannedDuration}
      visible={openSheet === 'duration'}
    />
    <CreateRepeatSheet
      onCancel={() => setOpenSheet(null)}
      onChoose={(mode) => chooseRepeat(mode)}
      onClose={() => setOpenSheet(null)}
      onSchedule={(next) => { clearErrors(); setSchedule(next); }}
      schedule={schedule}
      value={repeatMode}
      visible={openSheet === 'repeat'}
    />
    <CreateDateSheet
      minimumDate={today}
      onCancel={() => setOpenSheet(null)}
      onDone={(value) => { chooseDueDate(value); setOpenSheet(null); }}
      title="Due date"
      value={activeRange.activeFrom}
      visible={openSheet === 'due'}
    />
    <CreateReminderSheet
      onCancel={() => setOpenSheet(null)}
      onDone={(value) => {
        clearErrors();
        setReminder(value);
        setOpenSheet(null);
        // **Contextually, and only when there is something to deliver.** Choosing «none»
        // asks nothing. Refusal is kept rather than thrown: the reminder stays exactly as
        // configured and the row says it needs permission (PD-NOTIFY-002).
        if (reminderTriggerTime(value, plannedTime) !== null) {
          void requestReminderPermission().then(setReminderPermission);
        }
      }}
      plannedTime={plannedTime}
      value={reminder}
      visible={openSheet === 'reminder'}
    />
  </View>;
}

/**
 * The two shapes an item can be, as the travelling chooser takes them.
 *
 * **The node is the mark, not the older dot.** PD-CREATE-022 asked the slots to carry
 * «the same shape language»; the shape language has since become the one `item-chip.tsx`
 * draws — a circle for a task, a rounded square for a habit (PD-TODAY-065) — and the
 * filled dot and ring the slots carried were the *previous* one. A person now learns the
 * shape here and meets the same shape on the plate.
 */
const TYPE_SLOTS: readonly TravellingSegmentSlot[] = Object.freeze(CREATE_ITEM_TYPES.map((type) => Object.freeze({
  key: type,
  label: CREATE_ITEM_TYPE_LABELS[type],
  node: <TypeNode kind={type} />,
})));

/**
 * The two shapes, named for what happens rather than for what is stored.
 *
 * «By hand» is the default and is what absence means, so the left slot is the one an
 * item has always had.
 */
const CLOSURE_SLOTS: readonly TravellingSegmentSlot[] = Object.freeze([
  Object.freeze({ key: 'manual', label: 'Close by hand' }),
  Object.freeze({ key: 'lines', label: 'Close by steps' }),
]);

const STEP_ACTIONS = Object.freeze([Object.freeze({ label: 'Remove step', name: 'removeStep' })]);

/** The mark's outline at chooser size: a circle for a task, a rounded square for a habit. */
function TypeNode({ kind }: { readonly kind: CreateItemType }) {
  const theme = useLifePlannerTheme();
  return <View
    accessibilityElementsHidden
    style={[styles.typeNode, {
      // `0.29` is `CategoryChip`'s own habit radius ratio, so the chooser and the mark
      // round identically at any size rather than by two numbers that must be kept level.
      borderColor: theme.today.secondaryText,
      borderRadius: kind === 'habit' ? Math.round(TYPE_NODE * 0.29) : TYPE_NODE / 2,
    }]}
  />;
}

const TYPE_NODE = 13;

function Chip({ label, selected, onPress }: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useLifePlannerTheme();
  // **Structure, never `completion`.** Green means completed and nothing else
  // (PD-PLATE-004), and there is nothing to complete on this screen; the selected chip
  // takes the same ink the FAB, the selected date and the active tab take.
  return <Pressable
    accessibilityRole="radio"
    accessibilityState={{ checked: selected }}
    onPress={onPress}
    style={[styles.chip, selected
      ? { backgroundColor: theme.today.structFill, borderColor: theme.today.structFill }
      : { borderColor: theme.today.hairline }]}
  >
    <Text numberOfLines={1} style={[styles.chipText, { color: selected ? theme.today.onAccent : theme.today.secondaryText }]}>{label}</Text>
  </Pressable>;
}

/**
 * A row inside a plate: icon, label, value, and a sheet behind the tap.
 *
 * `onClear` is what makes a set value releasable without opening the sheet it came
 * from — the length and the minute are both optional, and «nobody said» has to be
 * reachable in one tap rather than through a picker that has no way to say it.
 */
function FieldRow({ icon, label, value, onPress, onClear }: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly value: string;
  readonly onPress: () => void;
  readonly onClear?: () => void;
}) {
  const theme = useLifePlannerTheme();
  return <Pressable
    accessibilityLabel={`${label}, ${value}`}
    accessibilityRole="button"
    onPress={onPress}
    style={[styles.fieldRow, { borderTopColor: theme.today.hairline }]}
  >
    <Ionicons accessibilityElementsHidden color={theme.today.secondaryText} name={icon} size={18} />
    <Text style={[styles.fieldLabel, { color: theme.today.primaryText }]}>{label}</Text>
    <Text numberOfLines={1} style={[styles.fieldValue, { color: theme.today.secondaryText }]}>{value}</Text>
    {onClear === undefined
      ? <Ionicons accessibilityElementsHidden color={theme.today.tertiaryText} name="chevron-forward" size={15} />
      : <Pressable
        accessibilityLabel={`Clear ${label.toLowerCase()}`}
        accessibilityRole="button"
        hitSlop={10}
        onPress={onClear}
      >
        <Ionicons color={theme.today.tertiaryText} name="close-circle" size={18} />
      </Pressable>}
  </Pressable>;
}

/**
 * The repeat is confirmed by the dates the item actually lands on, asked of the
 * domain one day at a time rather than restated in other words. A flexible period
 * has no dates to name, so it says what the period is; a task has one day and needs
 * no confirmation at all.
 */
function useScheduleConfirmation(
  scheduleResult: ReturnType<typeof buildScheduleDefinition>,
  activeRange: Readonly<{ activeFrom: string; activeTo: string }>,
  timezone: string,
  repeatMode: CreateRepeatMode,
  itemType: CreateItemType,
): string | null {
  return useMemo(() => {
    if (itemType === 'task' || !scheduleResult.ok) return null;
    // A flexible period has no dates to name, and asking would walk 400 days to
    // find that out. `Every day` needs no confirming either — naming the next three
    // days would only restate the chip and cost the sheet a line it cannot spare.
    if (repeatMode === 'daily' || repeatMode === 'perWeek' || repeatMode === 'perMonth' || repeatMode === 'perYear') return null;
    const from = parsePlannerLocalDate(activeRange.activeFrom);
    const to = activeRange.activeTo === '' ? null : parsePlannerLocalDate(activeRange.activeTo);
    const zone = parsePlannerTimezone(timezone, 'evaluationTimezone');
    if (!from.ok || !zone.ok || (to !== null && !to.ok)) return null;
    const range: EffectiveRange = { effectiveFrom: from.value, effectiveTo: to !== null && to.ok ? to.value : null };
    const dates = plannerScheduleNextDates(scheduleResult.value, range, zone.value, from.value);
    if (dates.length === 0) return null;
    return `Next: ${dates.map((date: PlannerLocalDate) => formatPlannerDate(date, 'short')).join(' · ')}`;
  }, [activeRange.activeFrom, activeRange.activeTo, itemType, repeatMode, scheduleResult, timezone]);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // ── The two glass bars ───────────────────────────────────────────────────
  // `overflow: hidden` keeps the blur inside the bar, the same way the FAB keeps it
  // inside its circle.
  bar: { overflow: 'hidden', zIndex: 2 },
  actionBar: { paddingHorizontal: 20, paddingTop: 10 },
  barEdge: { bottom: 0, height: StyleSheet.hairlineWidth, left: 0, position: 'absolute', right: 0 },
  barEdgeTop: { bottom: undefined, top: 0 },
  topBar: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 20 },
  topBarAction: { justifyContent: 'center', minHeight: 44, minWidth: 76 },
  topBarTrailing: { alignItems: 'flex-end', justifyContent: 'center', minHeight: 44, minWidth: 76 },
  topBarText: { fontSize: 15 },
  topBarTitle: { flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: -0.2, minWidth: 0, textAlign: 'center' },
  topBarDate: { fontSize: 13 },
  topBarDoneText: { fontSize: 15, fontWeight: '600' },

  // ── The stack ────────────────────────────────────────────────────────────
  // `screenMargin` and `cardGap` are the day's own: the create page is a stack of
  // plates on the same ground, at the same rhythm, and the numbers say so rather
  // than resembling it.
  content: { paddingBottom: 20, paddingHorizontal: 20, paddingTop: 14 },
  // `rowRadius` and `components.card.padding`, both existing tokens.
  plate: { borderRadius: 22, gap: 8, marginBottom: 14, padding: 16 },

  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44 },
  // `plateType.itemStrong`, which is exactly what the day draws a title at — so the
  // row is the preview it claims to be, and no 700 anywhere (PD-PLATE-003).
  nameField: { flex: 1, fontSize: 17, fontWeight: '600', letterSpacing: -0.2, minWidth: 0, padding: 0 },
  typeNode: { borderWidth: 1.5, height: TYPE_NODE, width: TYPE_NODE },

  // `plateType.label`, sentence case: a block heading is a label, not a shout.
  blockLabel: { fontSize: 11, fontWeight: '500', letterSpacing: 0.6, textTransform: 'uppercase' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  // 44 pt, which is `layout.control.minimumTouchTarget` — the token this screen
  // declared and then missed on every control it drew.
  chip: { alignItems: 'center', borderRadius: 13, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  chipText: { fontSize: 14, fontWeight: '500' },
  confirmation: { fontSize: 13, lineHeight: 18, paddingTop: 2 },

  // The six with their names back: at one lightness by design, they are not separable
  // by brightness, so a bare circle carries nothing a person can read.
  categoryPill: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 8, minHeight: 44, paddingLeft: 11, paddingRight: 13 },
  categoryDot: { borderRadius: 6.5, height: 13, width: 13 },
  categoryLabel: { fontSize: 14 },

  iconTile: { alignItems: 'center', borderRadius: 13, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },

  fieldRow: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 44 },
  fieldLabel: { flex: 1, fontSize: 15, minWidth: 0 },
  fieldValue: { fontSize: 15, maxWidth: '48%' },

  closureRow: { paddingBottom: 6 },
  stepsHeader: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  stepsCount: { fontSize: 13 },

  // The second floor's switch. It is a row rather than a card: the whole point is that
  // it is one more decision on the same sheet, not a feature behind a door.
  growthRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44 },
  growthWords: { flex: 1, gap: 2, minWidth: 0 },
  growthTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  growthCaption: { fontSize: 12, lineHeight: 16 },
  growthSlots: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '600' },
  growthMark: { alignItems: 'center', borderRadius: 6, borderWidth: 1.5, height: 24, justifyContent: 'center', width: 24 },
  growthQuestions: { gap: 6, paddingTop: 10 },
  growthQuestion: { fontSize: 12, fontWeight: '500' },
  growthInput: { borderRadius: 10, borderWidth: 1, fontSize: 15, minHeight: 44, paddingHorizontal: 12 },
  stepRow: { alignItems: 'center', flexDirection: 'row', gap: 9, minHeight: 32 },
  stepBox: { borderRadius: 9, borderWidth: 1.5, height: 18, width: 18 },
  // Not a dashed border: React Native tears one on a rounded view.
  stepBoxPending: { opacity: 0.55 },
  stepText: { flex: 1, fontSize: 13.5, minWidth: 0, paddingVertical: 6 },
  stepPendingText: { borderBottomWidth: 1 },

  // **The note is what absorbs the slack**, which is why the page filling the screen
  // costs nothing: the space goes to the one field that can always use more of it.
  // `flexGrow` alone — `flex: 1` carries `flexBasis: 0` and would collapse the note
  // on a form that already overflows, and `flexShrink: 0` keeps its floor there.
  note: { flexGrow: 1, flexShrink: 0, fontSize: 14, lineHeight: 20, minHeight: 36, padding: 0, textAlignVertical: 'top' },
  errorList: { gap: 8 },
  action: { alignItems: 'center', borderRadius: 14, justifyContent: 'center', minHeight: 46, padding: 12 },
  stepRemove: { alignItems: 'center', justifyContent: 'center', minHeight: 28, width: 28 },
  stepRemoveGlyph: { fontSize: 17, fontWeight: '600' },
  lifecycle: { gap: 2, paddingTop: 10 },
  lifecycleNote: { fontSize: 12, lineHeight: 17, paddingBottom: 6 },
  lifecycleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 },
  lifecycleText: { fontSize: 15, fontWeight: '600' },
  lifecycleHint: { fontSize: 12 },
  actionText: { fontSize: 15, fontWeight: '600' },
});
