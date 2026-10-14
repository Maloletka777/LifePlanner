import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, LayoutAnimation } from 'react-native';

import {
  type HabitIconIdentity,
  type ImportanceLevel,
  type PersistedHabitAccentKey,
  type PlannerHabitDetail,
  type PlannerId,
  type PlannerLocalDate,
  type RegisteredHabitSymbolKey,
} from '@/src/features/planner';
import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';
import { EmptyState, InlineError, LoadingState, Screen } from '@/src/ui/components';

import type { PlannerDayBlockKey } from '../domain/values/day-block';

import { CreateItemScreen } from './create-item-screen';
import { JOURNAL_STRIKE_MS } from './day-journal-model';
import { usePlannerChecklists, usePlannerHabitDetail, usePlannerServices } from './planner-provider';
import {
  deleteChainConfirmationAction,
  deleteChainConfirmationMessage,
  deleteChainConfirmationTitle,
} from './planner-delete-confirmation';
import {
  buildScheduleDefinition,
  buildTrackingDefinition,
  formatPlannerLifecycleDate,
  movePlannerDate,
  plannerLocalDateFromDevice,
  plannerTimezoneFromDevice,
  resolveHabitDetailRouteParams,
  scheduleDraftFromDefinition,
  trackingDraftFromDefinition,
  type ScheduleDraft,
} from './ui-adapters';

/**
 * What the loaded habit reads back as, and what a save hands over.
 *
 * These two shapes used to live in `create-habit-screen.tsx` — the old form, which
 * the editor stopped rendering when it became the create sheet in its other mode
 * and which is now gone. They belong to the editor and to nothing else, so they
 * live here rather than in a module kept alive for two interfaces.
 */
interface HabitFormInitialValues {
  readonly name: string;
  readonly note: string;
  readonly importance: ImportanceLevel;
  readonly plannedTime: string;
  /** The length the item carries, or `null` when nobody stated one. */
  readonly plannedDurationMinutes: number | null;
  /** The part of the day it belongs to, or `null` for none. */
  readonly plannedBlock: PlannerDayBlockKey | null;
  /** The minute this item's reminder fires at, or empty for none. */
  readonly reminderTime: string;
  readonly activeRange: Readonly<{ activeFrom: string; activeTo: string }>;
  readonly schedule: ScheduleDraft;
}

interface HabitFormValues extends HabitFormInitialValues {
  /** `null` keeps whatever symbol the habit was saved with; this surface picks none. */
  readonly symbolKey: RegisteredHabitSymbolKey | null;
  readonly accentKey: PersistedHabitAccentKey | null;
}

/**
 * Edit is the **create sheet** in its other mode.
 *
 * Not one new block and not one new row: an item is changed in exactly the window
 * it was made in, with the fields already filled. Three things differ — the action
 * says `Save changes`, the archive and delete rows stand under it, and the
 * subtasks are the stored ones, written and removed as they are typed because the
 * item they belong to already exists.
 *
 * **What stays here is what an edit *means*.** The effective-dated correction, the
 * tracking definition carried through untouched, the previewed deletion — none of
 * that is the create sheet's business, and none of it moved.
 *
 * **The legacy metric row is gone from this surface.** It rendered a locked stage
 * of the old form, which no longer has a home in this language; a saved counter,
 * quantity or duration habit still keeps its exact tracking contract, because the
 * edit carries the definition through untouched (PD-TRACK-002) — what it no longer
 * does is *display* it. Recorded rather than quietly dropped.
 */
export function EditHabitScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; date?: string | string[]; time?: string | string[] }>();
  const route = resolveHabitDetailRouteParams(params, plannerLocalDateFromDevice());
  if (!route.ok) {
    return <Screen><EmptyState title="Invalid habit link" message="The edit link is missing or invalid." /></Screen>;
  }
  /**
   * A time the caller proposes, which the journal's free window uses.
   *
   * **It is a proposal and not a write.** Placing an untimed item into an open stretch
   * of the day is a change to the item's configuration, and the effective-dated
   * contract that owns such a change lives on this screen — so the window fills the
   * field and the person confirms it here, rather than the journal writing behind them.
   */
  const proposed = Array.isArray(params.time) ? params.time[0] : params.time;
  return <ResolvedEdit
    date={route.asOfLocalDate}
    habitId={route.habitId}
    proposedTime={typeof proposed === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(proposed) ? proposed : null}
  />;
}

function ResolvedEdit({ habitId, date, proposedTime }: {
  readonly habitId: PlannerId;
  readonly date: PlannerLocalDate;
  readonly proposedTime: string | null;
}) {
  const query = usePlannerHabitDetail(habitId, date);
  if (query.status === 'loading') return <Screen><LoadingState label="Loading habit" /></Screen>;
  if (query.status === 'error') return <Screen><InlineError message={query.error} /></Screen>;
  if (query.data === null) return <Screen><EmptyState title="Habit not found" message="This habit is unavailable." /></Screen>;
  if (!query.data.temporalContext.actionAvailability.edit.available) {
    return <Screen><EmptyState
      title={query.data.temporalContext.isPreActive ? 'Not active yet' : 'Editing unavailable'}
      message={query.data.temporalContext.isPreActive
        ? `Editing is available from ${formatPlannerLifecycleDate(query.data.temporalContext.activeFrom)}.`
        : 'This habit cannot be edited from the selected date.'}
    /></Screen>;
  }
  return <EditForm date={date} detail={query.data} proposedTime={proposedTime} />;
}

function EditForm({ detail, date, proposedTime }: {
  readonly detail: PlannerHabitDetail;
  readonly date: PlannerLocalDate;
  readonly proposedTime: string | null;
}) {
  const router = useRouter();
  // Set when today could not be corrected and the change opened from the next day.
  const reduceMotion = useReduceMotion();
  const [appliedFrom, setAppliedFrom] = useState<PlannerLocalDate | null>(null);
  const {
    addHabitChecklistLines,
    archiveHabit,
    deleteHabitChain,
    editHabit,
    previewDeleteHabitChain,
    refreshOccurrences,
    removeHabitChecklistLine,
  } = usePlannerServices();
  const habitIds = useMemo(() => [detail.habit.id as string], [detail.habit.id]);
  const checklist = usePlannerChecklists(habitIds, date);
  const configuration = detail.temporalContext.displayConfiguration;
  const currentSchedule = configuration.schedule;

  const initial: HabitFormInitialValues | null = useMemo(() => {
    if (currentSchedule === null) return null;
    const identity = detail.habit.visualIdentity;
    return {
      accentKey: identity.persistedAccentKey,
      activeRange: {
        activeFrom: detail.habit.activeRange.effectiveFrom,
        activeTo: detail.habit.activeRange.effectiveTo ?? '',
      },
      importance: configuration.importance.importance,
      name: detail.habit.name,
      note: detail.habit.description ?? '',
      // A proposed time wins over the stored one, because it is why this screen was
      // opened; the form is otherwise exactly what the item already says.
      plannedTime: proposedTime ?? configuration.plannedTime.plannedLocalTime ?? '',
      // The length the version actually carries, so reopening the drum shows the cut
      // the person chose rather than silently re-cutting the day at the default.
      plannedDurationMinutes: configuration.plannedTime.plannedDurationMinutes,
      // Read rather than derived from the minute, because that is the point of
      // storing it: a morning routine done at 12:40 stays a morning routine.
      plannedBlock: configuration.plannedTime.plannedBlock,
      // **The reminder the item actually carries**, read the way the catalogue reads it:
      // active, enabled, earliest first. The editor used to show `None` for every item,
      // whatever was stored, because this was simply never loaded.
      reminderTime: storedReminderTime(detail.currentReminders),
      schedule: scheduleDraftFromDefinition(currentSchedule.definition),
    };
  }, [configuration.importance.importance, configuration.plannedTime.plannedBlock, configuration.plannedTime.plannedDurationMinutes, configuration.plannedTime.plannedLocalTime, currentSchedule, detail.currentReminders, detail.habit, proposedTime]);

  const archive = useCallback(() => {
    void archiveHabit({ boundaryTimezone: plannerTimezoneFromDevice(), effectiveLocalDate: date, habitId: detail.habit.id }).then((result) => {
      if (!result.ok) {
        Alert.alert('Not archived', result.error.message);
        return;
      }
      refreshOccurrences();
      router.back();
    });
  }, [archiveHabit, date, detail.habit.id, refreshOccurrences, router]);

  const remove = useCallback(() => {
    // One number, and it is the one that matters: how much history disappears. The
    // alternative to losing it is the Archive row above, not a third button here.
    void previewDeleteHabitChain({ asOfLocalDate: date, rootHabitId: detail.habit.id }).then((preview) => {
      if (!preview.ok) {
        Alert.alert('Cannot delete yet', preview.error.message);
        return;
      }
      const impact = preview.value;
      Alert.alert(
        deleteChainConfirmationTitle(impact),
        deleteChainConfirmationMessage(impact),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: deleteChainConfirmationAction(impact),
            style: 'destructive',
            onPress: () => {
              void deleteHabitChain({
                boundaryTimezone: impact.targets.find(({ habitId }) => habitId === detail.habit.id)?.boundaryTimezone ?? plannerTimezoneFromDevice(),
                confirmed: true,
                effectiveLocalDate: detail.temporalContext.actionAvailability.delete.earliestEffectiveLocalDate ?? date,
                expectedOrderedTargetHabitIds: impact.orderedTargetHabitIds,
                habitId: detail.habit.id,
              }).then((result) => {
                if (!result.ok) {
                  Alert.alert('Not deleted', result.error.message);
                  return;
                }
                refreshOccurrences();
                router.back();
              });
            },
          },
        ],
      );
    });
  }, [date, deleteHabitChain, detail.habit.id, detail.temporalContext.actionAvailability.delete.earliestEffectiveLocalDate, previewDeleteHabitChain, refreshOccurrences, router]);

  const commit = useCallback(async (values: HabitFormValues): Promise<string | null> => {
    if (currentSchedule === null) return 'This habit follows another habit and has no schedule of its own.';
    const range = values.activeRange;
    const schedule = buildScheduleDefinition(values.schedule, range, currentSchedule.definition.evaluationTimezone);
    if (!schedule.ok) return schedule.errors[0]?.message ?? 'Review the schedule before saving.';
    // The tracking definition is carried through unchanged: a saved metric habit
    // keeps its exact contract, and this screen never offers a conversion.
    const tracking = buildTrackingDefinition(trackingDraftFromDefinition(configuration.tracking.definition), range);
    if (!tracking.ok) return tracking.errors[0]?.message ?? 'This habit’s tracking could not be carried through.';
    const iconIdentity: HabitIconIdentity = values.symbolKey === null
      ? detail.habit.visualIdentity.iconIdentity
      : { kind: 'symbol', symbolKey: values.symbolKey };
    const command = {
      accentKey: values.accentKey ?? detail.habit.visualIdentity.persistedAccentKey,
      currentLocalDate: date,
      description: values.note.trim() || null,
      habitId: detail.habit.id,
      iconIdentity,
      importance: values.importance,
      name: values.name.trim(),
      plannedLocalTime: values.plannedTime.trim() || null,
      // An item with no minute carries no length: a length is measured from a start.
      plannedDurationMinutes: values.plannedTime.trim() === '' ? null : values.plannedDurationMinutes,
      // A block survives having no minute — it is where the thing belongs, not when
      // it starts — so it is written whatever the clock says.
      plannedBlock: values.plannedBlock,
      reminderLocalTime: values.reminderTime.trim() || null,
      schedule: schedule.value,
      tracking: tracking.value,
    };
    // An edit dated today is a *correction* of today's configuration, and the
    // persistence layer only allows that while nothing depends on it: no marks on
    // or after today, and today is where the current version began. For any habit
    // older than today that is never true, so every ordinary edit was refused with
    // "Recorded history protects today's configuration".
    //
    // A refusal is not an answer. When today cannot be corrected the change opens a
    // new effective-dated version from the next day instead — which is exactly what
    // the message was asking the user to do by hand — and the marks already made
    // keep meaning what they meant when they were made.
    const sameDay = await editHabit({ ...command, effectiveLocalDate: date });
    if (sameDay.ok) return null;
    if (sameDay.error.code !== 'same_day_correction_not_eligible') return sameDay.error.message;
    /**
     * **A one-day item has no tomorrow to open a version in, and the refusal's advice
     * cannot be taken.** Reproduced against a real database: a task is a daily
     * schedule whose active range is the single due day, so its configuration versions
     * end *at* the next day; the append looks for a version spanning the boundary,
     * finds none, and reports `The current importance range is missing or ambiguous` —
     * an integrity error for what is really a calendar fact, three screens from the
     * cause. Observations are append-only, so a tick that was undone is enough to
     * refuse the correction and put an ordinary priority change on that path.
     *
     * So the fallback is offered only to an item that actually lives past the date it
     * would start from, and everything else is told the truth instead.
     */
    const tomorrow = movePlannerDate(date, 1);
    const activeTo = detail.habit.activeRange.effectiveTo;
    if (activeTo !== null && tomorrow >= activeTo) {
      return 'This item lives on one day, and that day already carries a mark. '
        + 'Its rules cannot be changed afterwards without rewriting what the mark meant.';
    }
    const fromTomorrow = await editHabit({ ...command, effectiveLocalDate: tomorrow });
    if (!fromTomorrow.ok) return fromTomorrow.error.message;
    setAppliedFrom(tomorrow);
    return null;
  }, [configuration.tracking.definition, currentSchedule, date, detail.habit, editHabit]);

  if (initial === null) {
    return <Screen><EmptyState title="Schedule follows another habit" message="Open the related parent habit to change when this habit becomes available." /></Screen>;
  }

  /**
   * One line arrives or leaves, and the rows below it slide rather than jump.
   *
   * `LayoutAnimation` is the right tool here and `Animated` is not: what moves is
   * every row *after* the one that changed, and their new positions are decided by
   * the layout rather than by a value this screen could drive. Reduce Motion commits
   * the change in one frame, as everything else in the application does.
   */
  function animateLines() {
    if (reduceMotion) return;
    LayoutAnimation.configureNext({
      duration: JOURNAL_STRIKE_MS,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
    });
  }

  return <CreateItemScreen
    edit={{
      habitId: detail.habit.id,
      addLine: async (text) => {
        const result = await addHabitChecklistLines({ habitId: detail.habit.id, localDate: date, texts: [text] });
        if (!result.ok) return result.error.message;
        // The list is what changes, so the list is what animates. This is only
        // reachable now that a refresh keeps the detail it already had: while the
        // editor was torn down and rebuilt per write, there was no list to animate.
        animateLines();
        refreshOccurrences();
        return null;
      },
      appliedFrom,
      archive,
      initial: {
        accentKey: detail.habit.visualIdentity.persistedAccentKey,
        activeRange: initial.activeRange,
        importance: initial.importance,
        name: initial.name,
        note: initial.note,
        plannedTime: initial.plannedTime,
        plannedBlock: initial.plannedBlock,
        plannedDurationMinutes: initial.plannedDurationMinutes,
        reminderTime: initial.reminderTime,
        schedule: initial.schedule,
        // The symbol the item actually carries, so opening it for editing shows the
        // one it has rather than offering the automatic fallback as a fresh choice.
        symbolKey: storedSymbolKey(detail.habit.visualIdentity.iconIdentity),
      },
      lines: (checklist.data?.get(detail.habit.id) ?? []).map((line) => ({ id: line.id, text: line.text })),
      remove,
      removeLine: async (lineId) => {
        const result = await removeHabitChecklistLine({ checklistItemId: lineId, localDate: date });
        if (!result.ok) return result.error.message;
        animateLines();
        refreshOccurrences();
        return null;
      },
      // The symbol is the surface's again: it was never removed from storage or from
      // the picker, only from every screen that could reach them.
      save: async (values) => commit(values),
    }}
  />;
}

/**
 * The reminder an item actually carries, in the minute it fires at.
 *
 * The same rule the catalogue uses — active, enabled, earliest first — so the editor and
 * every other surface name the same one of an item's reminders. Empty means none, which
 * is what the form's own «no reminder» is.
 */
function storedReminderTime(reminders: readonly Readonly<{ triggerLocalTime: string; enabled: boolean; lifecycle: string }>[]): string {
  const live = reminders
    .filter((reminder) => reminder.lifecycle === 'active' && reminder.enabled)
    .map((reminder) => reminder.triggerLocalTime)
    .sort();
  return live[0] ?? '';
}

/**
 * The symbol an item actually carries, or null where it carries none.
 *
 * An **exact emoji is not a symbol key** and must not be reduced to one: it is the
 * person's own character (PD-IDENTITY-002), so the editor offers no key for it and
 * the stored identity is left exactly as it is unless a symbol is chosen. Null is
 * therefore "nothing to pre-select" rather than "no identity".
 */
function storedSymbolKey(identity: unknown): RegisteredHabitSymbolKey | null {
  const candidate = identity as Readonly<{ kind?: unknown; symbolKey?: unknown }> | null | undefined;
  return candidate?.kind === 'symbol' && typeof candidate.symbolKey === 'string'
    ? candidate.symbolKey as RegisteredHabitSymbolKey
    : null;
}
