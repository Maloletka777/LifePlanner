import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, LayoutAnimation, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { beginPlannerPerformanceSpan, measurePlannerOperation, reportPlannerFailure, type DeleteHabitChainImpact, type PlannerChecklistLine, type PlannerHabitCatalogueItem, type PlannerLocalDate } from '@/src/features/planner';
import { BottomActionLayer, EmptyState, InlineError, LoadingState, Screen, SecondaryButton, StatusLabel, SwipeActionRow, TextField, type SwipeRowAction } from '@/src/ui/components';
import { useLifePlannerTheme, withAlpha } from '@/src/ui/theme';

import { habitAccentKeyForId } from '../domain/identity/habit-visual-identity';
import { usePlannerChecklists, usePlannerHabitCatalogue, usePlannerServices } from './planner-provider';
import {
  JOURNAL_BODY_GAP,
  JOURNAL_BODY_PADDING,
  JOURNAL_BODY_PADDING_Y,
  JOURNAL_STEP_HEIGHT,
  JOURNAL_TILE,
  PLATE_CRITICAL_DOT,
  PLATE_GAP,
  PLATE_MIN_HEIGHT,
  PLATE_PADDING,
  PLATE_RADIUS,
  PLATE_ROW_GAP,
  JOURNAL_TOUCH_TARGET,
} from './day-journal-model';
import { habitCategoryForAccentKey } from './habit-category-catalogue';
import { HabitIdentityMark, HabitSurface } from './habit-visual-components';
import { CategoryChip, type ItemChipSubject } from './item-chip';
import {
  buildManageSections,
  manageGutterLabel,
  manageGutterWidth,
  MANAGE_GUTTER_MAX_SCALE,
  manageItemKind,
  manageNeedsSchedule,
  manageOverdueLabel,
  manageTaskDueDate,
  manageTypeCounts,
  nextManageSortOrder,
  type ManageGutterTone,
  type ManageSection,
  type ManageSortOrder,
  type ManageTypeScope,
} from './manage-items-model';
import { PlannerArchiveConfirmation } from './planner-archive-confirmation';
import { deleteChainConfirmationAction, deleteChainConfirmationMessage, deleteChainConfirmationTitle } from './planner-delete-confirmation';
import { formatPlannerLifecycleDate, habitDetailNavigation, IMPORTANCE_LABELS, managementQueryDate, plannerFailureMessage, plannerHabitTemporalPresentation, plannerLifecycleActionUnavailableMessage, plannerLocalDateFromDevice, plannerTimezoneFromDevice } from './ui-adapters';

/** Active and Archived are the only canonical lifecycles; there is no paused state. */
type ManagementScope = 'active' | 'archived';

/**
 * Manage, from `design_handoff_manage_subtasks` §A.
 *
 * It stops being a list of habits and becomes a list of **items**. Tasks and
 * habits share one row, told apart by the shape of a coloured node rather than by
 * an icon or a label — the journal's own language, carried onto the surface where
 * things are found, repaired, archived and deleted. The 34 pt identity mark and
 * the glyph are gone with the split: a colour and a shape are the whole mark.
 *
 * Three structural changes follow from that.
 *
 * **The segment splits by type, not by lifecycle.** `All / Tasks / Habits` reads
 * the type from the schedule the way the journal already does, and `Active` /
 * `Archive` moves down into the chips. Tasks group by when they are due; habits
 * are one flat list, because the six colours lost their names and a colour cannot
 * be a heading — and a composite habit says so with a chevron on its own row
 * instead of a `ROUTINES` heading over its children.
 *
 * **What is broken is pinned rather than filtered.** `NEEDS A SCHEDULE` sits above
 * everything when it has anything in it; the `Broken N` chip is gone, because
 * something broken is repaired, not looked for.
 *
 * **Nothing can be completed here.** An observation is written against a date and
 * this screen has none, so the only surface that can close an item is Today. The
 * square appears solely in `Select` mode, where it means selected.
 */
export function AllHabitsScreen() {
  const router = useRouter();
  const theme = useLifePlannerTheme();
  const { date } = useLocalSearchParams<{ date?: string | string[] }>();
  const [typeScope, setTypeScope] = useState<ManageTypeScope>('all');
  const [scope, setScope] = useState<ManagementScope>('active');
  const [sortOrder, setSortOrder] = useState<ManageSortOrder>('newest');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<'archive' | 'restore' | null>(null);
  // Swipe acts on one item, Select acts on a batch; they never fight for the same row.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [swipeTarget, setSwipeTarget] = useState<PlannerHabitCatalogueItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const pendingActionsRef = useRef(new Map<string, 'archive' | 'restore' | 'delete'>());
  const [pendingActions, setPendingActions] = useState<ReadonlyMap<string, 'archive' | 'restore' | 'delete'>>(() => new Map());
  const [removedHabitIds, setRemovedHabitIds] = useState<ReadonlySet<string>>(() => new Set());
  const asOfLocalDate = managementQueryDate(date, plannerLocalDateFromDevice());
  // The gutter follows the text scale that is actually on: three times in this
  // application a time column has been a constant and three times it has clipped.
  const { fontScale } = useWindowDimensions();
  const gutterWidth = manageGutterWidth(fontScale);
  // One query for both lifecycles: the chips then carry live counts and switching
  // between them costs no refetch.
  const query = usePlannerHabitCatalogue(searchText, 'all', asOfLocalDate);
  const allRows = useMemo(() => (query.data ?? []).filter((row) => !removedHabitIds.has(row.habitId)), [query.data, removedHabitIds]);
  const { archiveHabit, restoreHabit, deleteHabitChain, previewDeleteHabitChain, refreshOccurrences } = usePlannerServices();

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  const animateNext = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const setPending = (habitId: string, action: 'archive' | 'restore' | 'delete' | null) => {
    if (action === null) pendingActionsRef.current.delete(habitId);
    else pendingActionsRef.current.set(habitId, action);
    setPendingActions(new Map(pendingActionsRef.current));
  };

  const activeRows = allRows.filter((row) => row.lifecycle !== 'archived');
  const archivedRows = allRows.filter((row) => row.lifecycle === 'archived');
  const scopeRows = scope === 'archived' ? archivedRows : activeRows;
  // Subtasks come from their own query here too, so this list and the journal
  // cannot disagree about what an item is made of. `asOfLocalDate` is the day the
  // ticks are read for — Manage shows what stands today and ticks nothing.
  const checklistIds = useMemo(() => scopeRows.map((row) => row.habitId as string), [scopeRows]);
  const checklists = usePlannerChecklists(checklistIds, asOfLocalDate);
  const counts = useMemo(() => manageTypeCounts(scopeRows.filter((row) => row.ordinaryParentName === null)), [scopeRows]);
  const sections = useMemo(() => buildManageSections({
    items: scopeRows,
    // An archived item has no repair to make towards, so the pinned section is
    // withheld there rather than listing everything that lost its schedule on the
    // way out.
    pinNeedsSchedule: scope === 'active',
    sortOrder,
    today: asOfLocalDate,
    typeScope,
  }), [asOfLocalDate, scope, scopeRows, sortOrder, typeScope]);
  const nothingVisible = sections.length === 0;

  // Selection is by root. A composite habit's steps follow their parent as one
  // summary line rather than five checkboxes, which is also how the write behaves.
  const selectableRoots = useMemo(() => sections.flatMap((section) => [...section.items]), [sections]);
  const selectedRoots = selectableRoots.filter((row) => selectedIds.has(row.habitId));
  const cascadeCount = selectedRoots.reduce((total, root) => total + root.ordinaryChildCount, 0);
  const primaryBulk: 'archive' | 'restore' = scope === 'archived' ? 'restore' : 'archive';
  // Every action is gated on canonical availability, never on a derived guess.
  const eligibleForPrimary = selectedRoots.filter((row) => {
    const availability = row.temporalContext.actionAvailability;
    return primaryBulk === 'archive' ? availability.archive.available : availability.restore.available;
  });
  const eligibleForDelete = selectedRoots.filter((row) => row.temporalContext.actionAvailability.delete.available);
  // A swipe supplies its own single target; otherwise the batch is the selection.
  const primaryTargets = swipeTarget === null ? eligibleForPrimary : [swipeTarget];
  const busy = pendingActions.size > 0;

  const exitSelection = () => {
    animateNext();
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const toggleSelection = (habitId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(habitId)) next.delete(habitId); else next.add(habitId);
      return next;
    });
    void Haptics.selectionAsync();
  };

  const beginSelection = (habitId: string) => {
    animateNext();
    setSelecting(true);
    setSelectedIds(new Set([habitId]));
    void Haptics.selectionAsync();
  };

  const openRow = (row: PlannerHabitCatalogueItem) => {
    if (selecting) { toggleSelection(row.habitId); return; }
    if (pendingActionsRef.current.has(row.habitId)) return;
    // "Repeat is missing — tap to fix" means exactly that: the row goes to Edit.
    const availability = row.temporalContext.actionAvailability;
    if (manageNeedsSchedule(row) && availability.edit.available) {
      router.push({ pathname: '/planner/edit/[id]', params: { id: row.habitId, date: asOfLocalDate } });
      return;
    }
    router.push(habitDetailNavigation(row.habitId, asOfLocalDate));
  };

  const finishRemoval = (habitIds: readonly string[]) => {
    animateNext();
    setRemovedHabitIds((current) => new Set([...current, ...habitIds]));
  };

  const runArchive = async (row: PlannerHabitCatalogueItem) => {
    const availability = row.temporalContext.actionAvailability;
    if (!availability.archive.available) {
      setArchiveError(plannerLifecycleActionUnavailableMessage('archive', availability.archive.unavailableReason, availability.archive.earliestEffectiveLocalDate));
      return false;
    }
    const effectiveLocalDate = availability.archive.earliestEffectiveLocalDate;
    if (effectiveLocalDate === null) {
      setArchiveError('Archive is unavailable for this date.');
      return false;
    }
    setPending(row.habitId, 'archive');
    const result = await measurePlannerOperation('archive_command', () => archiveHabit({ habitId: row.habitId, effectiveLocalDate, boundaryTimezone: plannerTimezoneFromDevice() }));
    if (!result.ok) {
      reportPlannerFailure('archiveHabit', result.error.code, [row.habitId]);
      pendingActionsRef.current.delete(row.habitId);
      setPendingActions(new Map(pendingActionsRef.current));
      setArchiveError(plannerFailureMessage(result.error.code));
      return false;
    }
    setPending(row.habitId, null);
    if ('outcome' in result.value && result.value.outcome === 'already_archived') setSuccessMessage(`${row.name} was already archived.`);
    return true;
  };

  const runRestore = async (row: PlannerHabitCatalogueItem) => {
    const availability = row.temporalContext.actionAvailability;
    const effectiveLocalDate = availability.restore.earliestEffectiveLocalDate;
    if (!availability.restore.available || effectiveLocalDate === null) return false;
    setPending(row.habitId, 'restore');
    const result = await measurePlannerOperation('archive_command', () => restoreHabit({ habitId: row.habitId, effectiveLocalDate, boundaryTimezone: plannerTimezoneFromDevice() }));
    if (!result.ok) {
      reportPlannerFailure('restoreHabit', result.error.code, [row.habitId]);
      pendingActionsRef.current.delete(row.habitId);
      setPendingActions(new Map(pendingActionsRef.current));
      setArchiveError(plannerFailureMessage(result.error.code));
      return false;
    }
    setPending(row.habitId, null);
    // An item whose schedule did not survive archiving needs the repair screen; it
    // cannot be restored silently in a batch.
    if (result.value.outcome === 'schedule_required') {
      setActionError(`${row.name} needs a schedule before it can return. Open it to repair.`);
      return false;
    }
    return true;
  };

  const confirmPrimaryBulk = async () => {
    const targets = primaryTargets;
    setBulkConfirm(null);
    setSwipeTarget(null);
    setArchiveError(null);
    setSuccessMessage(null);
    const completed: string[] = [];
    for (const row of targets) {
      const ok = primaryBulk === 'archive' ? await runArchive(row) : await runRestore(row);
      if (ok) completed.push(row.habitId);
    }
    if (completed.length > 0) {
      finishRemoval(completed);
      setSuccessMessage(`${subjectLabel(targets.length, targets[0]?.name)} ${primaryBulk === 'archive' ? 'archived' : 'restored'}.`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      beginPlannerPerformanceSpan('archive_refresh');
      refreshOccurrences();
    }
    exitSelection();
  };

  const runDeleteChain = async (row: PlannerHabitCatalogueItem, impact: DeleteHabitChainImpact) => {
    setPending(row.habitId, 'delete');
    const result = await measurePlannerOperation('delete_command', () => deleteHabitChain({
      habitId: row.habitId,
      effectiveLocalDate: row.temporalContext.actionAvailability.delete.earliestEffectiveLocalDate ?? asOfLocalDate,
      boundaryTimezone: impact.targets.find(({ habitId }) => habitId === row.habitId)?.boundaryTimezone ?? plannerTimezoneFromDevice(),
      expectedOrderedTargetHabitIds: impact.orderedTargetHabitIds,
      confirmed: true,
    }));
    if (!result.ok) {
      reportPlannerFailure('deleteHabitChain', result.error.code, [row.habitId]);
      pendingActionsRef.current.delete(row.habitId);
      setPendingActions(new Map(pendingActionsRef.current));
      setActionError(plannerFailureMessage(result.error.code));
      return [];
    }
    setPending(row.habitId, null);
    return impact.orderedTargetHabitIds;
  };

  // Deletion keeps its preview and its confirmation. Undo cannot stand in for a
  // permanent recursive delete, so the consequence is stated and then agreed to.
  const requestDelete = async (explicitTargets?: readonly PlannerHabitCatalogueItem[]) => {
    const targets = explicitTargets ?? eligibleForDelete;
    if (targets.length === 0) return;
    setActionError(null);
    for (const row of targets) setPending(row.habitId, 'delete');
    const previews: { row: PlannerHabitCatalogueItem; impact: DeleteHabitChainImpact }[] = [];
    for (const row of targets) {
      const preview = await measurePlannerOperation('delete_preview', () => previewDeleteHabitChain({ rootHabitId: row.habitId, asOfLocalDate }));
      if (!preview.ok) {
        reportPlannerFailure('previewDeleteHabitChain', preview.error.code, [row.habitId]);
        for (const pendingRow of targets) pendingActionsRef.current.delete(pendingRow.habitId);
        setPendingActions(new Map(pendingActionsRef.current));
        setActionError(plannerFailureMessage(preview.error.code));
        return;
      }
      previews.push({ row, impact: preview.value });
    }
    for (const row of targets) setPending(row.habitId, null);
    const single = previews.length === 1 ? previews[0] : undefined;
    const totalTargets = previews.reduce((total, { impact }) => total + impact.orderedTargetHabitIds.length, 0);
    const title = single === undefined ? `Delete ${previews.length} items?` : deleteChainConfirmationTitle(single.impact);
    const message = single === undefined
      ? `${previews.length} selected items and ${totalTargets - previews.length} linked habits will be permanently deleted with their history. This cannot be undone.`
      : deleteChainConfirmationMessage(single.impact);
    const confirmLabel = single === undefined ? `Delete ${totalTargets} items` : deleteChainConfirmationAction(single.impact);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirmLabel,
        style: 'destructive',
        onPress: () => void (async () => {
          const removed: string[] = [];
          for (const { row, impact } of previews) removed.push(...await runDeleteChain(row, impact));
          if (removed.length > 0) {
            finishRemoval(removed);
            beginPlannerPerformanceSpan('delete_refresh');
            refreshOccurrences();
          }
          exitSelection();
        })(),
      },
    ]);
  };

  const selectionSubject = subjectLabel(primaryTargets.length, primaryTargets[0]?.name);

  // One swipe row: Edit, Archive, Delete, each gated on canonical availability.
  const swipeActions = (row: PlannerHabitCatalogueItem) => {
    const availability = row.temporalContext.actionAvailability;
    const pending = pendingActions.get(row.habitId);
    return [
      ...(availability.edit.available ? [{ name: 'edit', label: manageNeedsSchedule(row) ? 'Repair' : 'Edit', icon: 'create-outline' as const, disabled: pending !== undefined, onPress: () => router.push({ pathname: '/planner/edit/[id]', params: { id: row.habitId, date: asOfLocalDate } }) }] : []),
      ...(scope === 'archived'
        ? availability.restore.available ? [{ name: 'restore', label: 'Restore', icon: 'refresh-outline' as const, disabled: pending !== undefined, onPress: () => { setArchiveError(null); setSwipeTarget(row); setBulkConfirm('restore'); } }] : []
        : availability.archive.available ? [{ name: 'archive', label: 'Archive', icon: 'archive-outline' as const, disabled: pending !== undefined, onPress: () => { setArchiveError(null); setSwipeTarget(row); setBulkConfirm('archive'); } }] : []),
      ...(availability.delete.available ? [{ name: 'delete', label: 'Delete', icon: 'trash-outline' as const, tone: 'danger' as const, disabled: pending !== undefined, onPress: () => void requestDelete([row]) }] : []),
    ];
  };

  const createLabel = typeScope === 'tasks' ? 'New task' : typeScope === 'habits' ? 'New habit' : 'New';

  return <>
    <View style={styles.root}>
      <Screen backgroundColor={theme.today.appSurface} contentStyle={selecting ? styles.selectingContent : styles.content}>
        {selecting
          ? <View style={styles.header}>
            <View style={styles.headerText}>
              <Text accessibilityRole="header" style={[styles.selectionTitle, { color: theme.today.primaryText }]}>{`${selectedRoots.length} selected`}</Text>
              <Text numberOfLines={1} style={[styles.headerCaption, { color: theme.today.secondaryText }]}>{`of ${selectableRoots.length} ${scope === 'archived' ? 'archived' : 'active'} items`}</Text>
            </View>
            <Pressable
              accessibilityLabel="Leave selection mode"
              accessibilityRole="button"
              onPress={exitSelection}
              style={({ pressed }) => [styles.donePill, { backgroundColor: pressed ? theme.today.tone100 : theme.today.dashboardSurface, borderColor: theme.today.hairline }]}
            >
              <Text style={[styles.doneLabel, { color: theme.today.completion }]}>Done</Text>
            </Pressable>
          </View>
          : <View style={styles.header}>
            <View style={styles.headerText}>
              {/* The design draws `TODAY` here. Manage is reachable only from
                  Overview's All activities door — Planner's own entry went with
                  the tab (PD-OVERVIEW-001) — so the eyebrow names where back
                  actually goes. `PLANNER` was stale from the rename. */}
              <Pressable
                accessibilityHint="Returns to Overview."
                accessibilityLabel="Back to Overview"
                accessibilityRole="button"
                onPress={() => router.back()}
                style={({ pressed }) => [styles.eyebrow, { opacity: pressed ? 0.55 : 1 }]}
              >
                <Ionicons accessibilityElementsHidden color={theme.today.tertiaryText} name="chevron-back" size={14} />
                <Text style={[styles.eyebrowLabel, { color: theme.today.tertiaryText }]}>OVERVIEW</Text>
              </Pressable>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.today.primaryText }]}>Manage</Text>
            </View>
            <Pressable
              accessibilityLabel={searchVisible ? 'Hide search' : 'Search items'}
              accessibilityRole="button"
              accessibilityState={{ expanded: searchVisible }}
              onPress={() => { animateNext(); setSearchVisible((value) => { if (value) setSearchText(''); return !value; }); }}
              style={({ pressed }) => [styles.headerButton, { backgroundColor: pressed ? theme.today.tone100 : theme.today.dashboardSurface, borderColor: theme.today.hairline }]}
            >
              <Ionicons color={theme.today.completion} name="search" size={18} />
            </Pressable>
          </View>}

        {!searchVisible || selecting ? null : <TextField
          label={scope === 'archived' ? 'Search archived items' : 'Search active items'}
          onChangeText={setSearchText}
          placeholder="Name"
          returnKeyType="search"
          value={searchText}
        />}

        {/* The type is read from the schedule, never stored: a `daily` schedule
            active for a single day is what Create writes for `Task`. */}
        {selecting ? null : <View accessibilityRole="tablist" style={[styles.segment, { backgroundColor: theme.today.segmentTrack }]}>
          {([['all', 'All', counts.all], ['tasks', 'Tasks', counts.tasks], ['habits', 'Habits', counts.habits]] as const).map(([value, label, count]) => <Pressable
            accessibilityLabel={`${label}, ${count} items`}
            accessibilityRole="tab"
            accessibilityState={{ selected: typeScope === value }}
            key={value}
            onPress={() => { if (typeScope === value) return; animateNext(); setTypeScope(value); void Haptics.selectionAsync(); }}
            style={[styles.segmentOption, typeScope === value ? [styles.segmentSelected, { backgroundColor: theme.today.dashboardSurface, shadowColor: theme.colors.shadow }] : null]}
          >
            <Text numberOfLines={1} style={[styles.segmentLabel, { color: typeScope === value ? theme.today.primaryText : theme.today.secondaryText }]}>{`${label} ${count}`}</Text>
          </Pressable>)}
        </View>}

        <View style={styles.filterRow}>
          {selecting
            ? <View style={styles.chips}>
              {([['all', 'Select all'], ['none', 'Select none'], ['invert', 'Invert']] as const).map(([action, label]) => <Pressable
                accessibilityLabel={label}
                accessibilityRole="button"
                key={action}
                onPress={() => setSelectedIds(nextSelection(action, selectableRoots, selectedIds))}
                style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? theme.today.tone100 : theme.today.dashboardSurface, borderColor: theme.today.hairline }]}
              >
                <Text style={[styles.chipLabel, { color: theme.today.primaryText }]}>{label}</Text>
              </Pressable>)}
            </View>
            : <>
              <View style={styles.chips}>
                {([['active', 'Active', null], ['archived', 'Archive', archivedRows.length]] as const).map(([value, label, count]) => {
                  const selected = scope === value;
                  return <Pressable
                    accessibilityLabel={count === null ? label : `${label}, ${count} items`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={value}
                    onPress={() => { if (scope === value) return; animateNext(); setScope(value); }}
                    style={({ pressed }) => [styles.chip, {
                      backgroundColor: selected ? theme.today.primaryText : pressed ? theme.today.tone100 : theme.today.dashboardSurface,
                      borderColor: selected ? theme.today.primaryText : theme.today.hairline,
                    }]}
                  >
                    <Text style={[styles.chipLabel, { color: selected ? theme.today.dashboardSurface : theme.today.secondaryText }]}>
                      {count === null ? label : `${label} ${count}`}
                    </Text>
                  </Pressable>;
                })}
              </View>
              <View style={styles.spacer} />
              {/* Two states and no third: a tap goes to Oldest, the next returns. */}
              <Pressable
                accessibilityHint="Orders every group by when its items were created."
                accessibilityLabel={sortOrder === 'newest' ? 'Sorted newest first' : 'Sorted oldest first'}
                accessibilityRole="button"
                onPress={() => { animateNext(); setSortOrder(nextManageSortOrder); }}
                style={({ pressed }) => [styles.sortAction, { opacity: pressed ? 0.55 : 1 }]}
              >
                <Ionicons accessibilityElementsHidden color={theme.today.tertiaryText} name="swap-vertical-outline" size={14} />
                <Text style={[styles.chipLabel, { color: theme.today.secondaryText }]}>{sortOrder === 'newest' ? 'Newest' : 'Oldest'}</Text>
              </Pressable>
              {selectableRoots.length === 0 ? null : <Pressable
                accessibilityHint="Lets you act on several items at once."
                accessibilityLabel="Select items"
                accessibilityRole="button"
                onPress={() => { animateNext(); setSelecting(true); }}
                style={({ pressed }) => [styles.selectAction, { opacity: pressed ? 0.55 : 1 }]}
              >
                <Text style={[styles.chipLabel, { color: theme.today.completion }]}>Select</Text>
              </Pressable>}
            </>}
        </View>

        {query.status === 'loading' && query.data === null ? <LoadingState label="Loading items" /> : null}
        {query.status === 'error' ? <View style={styles.errorBlock}><InlineError message={query.error} /><SecondaryButton title="Retry" onPress={query.retry} /></View> : null}
        {actionError === null ? null : <View style={styles.errorBlock}><InlineError message={actionError} /><SecondaryButton title="Dismiss error" onPress={() => setActionError(null)} /></View>}
        {successMessage === null ? null : <Text accessibilityLiveRegion="polite" style={[theme.typography.callout, { color: theme.today.completion }]}>{successMessage}</Text>}

        {query.status === 'ready' && nothingVisible ? <EmptyState
          action={searchText.trim() === '' ? undefined : <SecondaryButton title="Clear search" onPress={() => setSearchText('')} />}
          message={searchText.trim() === '' ? 'Anything you create on Today appears here.' : 'Try another name or clear the search.'}
          title={emptyTitle(scope, typeScope, searchText)}
        /> : null}

        {sections.map((section) => <ManageSectionView
          childrenOf={(parent) => checklists.data?.get(parent.habitId) ?? []}
          expandedIds={expandedIds}
          gutterWidth={gutterWidth}
          key={section.key}
          onLongPress={beginSelection}
          onOpen={openRow}
          onOpenRow={setOpenRowId}
          onToggleSteps={(habitId) => { animateNext(); setExpandedIds((current) => { const next = new Set(current); if (next.has(habitId)) next.delete(habitId); else next.add(habitId); return next; }); }}
          openRowId={openRowId}
          pendingActions={pendingActions}
          section={section}
          selectedIds={selectedIds}
          selecting={selecting}
          swipeActions={swipeActions}
          today={asOfLocalDate}
        />)}

        {/* The consequence is stated while the finger is still on the screen. */}
        {!selecting || cascadeCount === 0 ? null : <View style={[styles.consequence, { backgroundColor: theme.today.attentionTint, borderColor: theme.today.attentionEdge }]}>
          <Text style={[styles.consequenceTitle, { color: theme.today.attentionText }]}>
            {`${primaryBulk === 'archive' ? 'Archiving' : 'Restoring'} ${selectionSubject} also affects ${cascadeCount} ${cascadeCount === 1 ? 'step' : 'steps'}`}
          </Text>
          <Text style={[styles.consequenceBody, { color: theme.today.secondaryText }]}>History is kept. Deleting would remove those steps permanently.</Text>
        </View>}
      </Screen>

      {/* **A tap anywhere puts an open row back.**
          It used to close only on a tap on the row itself or on a swipe back the
          other way, which means the one gesture a person reaches for — touch
          somewhere else and carry on — did nothing at all, and the keys stayed out.
          While a row is open the screen carries a transparent layer that closes it
          and swallows that first touch, which is what every list of this shape does:
          the tap is spent dismissing rather than on whatever was underneath. */}
      {openRowId === null ? null : <Pressable
        accessibilityLabel="Close row actions"
        accessibilityRole="button"
        onPress={() => setOpenRowId(null)}
        style={StyleSheet.absoluteFill}
      />}

      {/* The ground runs to the screen edge; the action floats above it on a
          gradient cushion, so the list dissolves instead of being cut off. */}
      <BottomActionLayer groundColor={theme.today.appSurface} height={140} inset={20}>
        {selecting
          ? <View style={[styles.panel, { backgroundColor: theme.today.panelFill, borderColor: theme.today.hairline, shadowColor: theme.colors.shadow }]}>
            <PanelAction
              disabled={busy || eligibleForPrimary.length === 0}
              icon={primaryBulk === 'archive' ? 'archive-outline' : 'refresh-outline'}
              label={primaryBulk === 'archive' ? 'Archive' : 'Restore'}
              onPress={() => { setArchiveError(null); setSwipeTarget(null); setBulkConfirm(primaryBulk); }}
            />
            <PanelAction
              danger
              disabled={busy || eligibleForDelete.length === 0}
              icon="trash-outline"
              label="Delete"
              onPress={() => void requestDelete()}
            />
          </View>
          : <Pressable
            accessibilityHint="Opens the create screen."
            accessibilityLabel={createLabel}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/planner/create', params: { date: asOfLocalDate } })}
            style={({ pressed }) => [styles.newItem, { backgroundColor: pressed ? theme.today.completionPressed : theme.today.completion, shadowColor: theme.colors.shadow }]}
          >
            <Ionicons color={theme.today.onAccent} name="add" size={19} />
            <Text style={[styles.newItemLabel, { color: theme.today.onAccent }]}>{createLabel}</Text>
          </Pressable>}
      </BottomActionLayer>
    </View>

    <PlannerArchiveConfirmation
      error={archiveError}
      habitName={selectionSubject}
      message={bulkConfirm === 'restore'
        ? `${selectionSubject} returns to active planning. History stays available.`
        : `${selectionSubject} will leave active planning on ${formatPlannerLifecycleDate(eligibleForPrimary[0]?.temporalContext.actionAvailability.archive.earliestEffectiveLocalDate ?? asOfLocalDate)}. History remains available.`}
      onCancel={() => { if (!busy) { setBulkConfirm(null); setArchiveError(null); } }}
      onConfirm={() => void confirmPrimaryBulk()}
      onDismissError={() => setArchiveError(null)}
      pending={busy}
      visible={bulkConfirm !== null}
    />
  </>;
}

/**
 * One card per section, not per row.
 *
 * Five separate cards at 56 pt took the space eight rows take at 52, and glued
 * nothing together for it. The rows share one surface and are separated by a rule
 * inset past the node column, so the eye runs down the titles.
 */
function ManageSectionView({ section, today, gutterWidth, selecting, selectedIds, expandedIds, pendingActions, openRowId, childrenOf, swipeActions, onOpen, onLongPress, onToggleSteps, onOpenRow }: {
  readonly section: ManageSection;
  readonly today: PlannerLocalDate;
  /** Measured once by the screen from the text scale that is actually on. */
  readonly gutterWidth: number;
  readonly selecting: boolean;
  readonly selectedIds: ReadonlySet<string>;
  readonly expandedIds: ReadonlySet<string>;
  readonly pendingActions: ReadonlyMap<string, 'archive' | 'restore' | 'delete'>;
  readonly openRowId: string | null;
  readonly childrenOf: (parent: PlannerHabitCatalogueItem) => readonly PlannerChecklistLine[];
  readonly swipeActions: (row: PlannerHabitCatalogueItem) => readonly SwipeRowAction[];
  readonly onOpen: (row: PlannerHabitCatalogueItem) => void;
  readonly onLongPress: (habitId: string) => void;
  readonly onToggleSteps: (habitId: string) => void;
  readonly onOpenRow: (rowId: string | null) => void;
}) {
  const theme = useLifePlannerTheme();
  const broken = section.key === 'needsSchedule';
  const labelColor = broken
    ? theme.today.scheduleText
    : section.key === 'overdue'
      ? theme.today.attentionText
      : section.key === 'today'
        ? theme.today.completion
        : theme.today.tertiaryText;
  return <View style={styles.section}>
    <View style={styles.sectionHeader}>
      {broken ? <View style={[styles.sectionDot, { backgroundColor: theme.today.scheduleAccent }]} /> : null}
      <Text style={[styles.sectionLabel, { color: labelColor }]}>{section.label}</Text>
      <Text style={[styles.sectionCount, { color: labelColor }]}>{section.items.length}</Text>
    </View>
    {/* **One plate per item** (PD-PLATE-001), lying on the ground rather than ruled
        inside one card. The card was the surface that made every row inside it a
        second level; with it gone a row is an object, which is also what the swipe
        needs — the plate's own opaque fill is the mask that uncovers the keys behind
        it (PD-MANAGE-014). */}
    <View style={styles.sectionPlates}>
      {section.items.map((row) => {
        const steps = childrenOf(row);
        const expanded = expandedIds.has(row.habitId);
        return <View key={row.habitId} style={styles.plateHolder}>
          <SwipeableRow
            actions={swipeActions(row)}
            enabled={!selecting}
            onOpenRow={onOpenRow}
            openRowId={openRowId}
            rowId={row.habitId}
          >
            <ManageRow
              broken={broken}
              expanded={expanded}
              gutterWidth={gutterWidth}
              onLongPress={() => onLongPress(row.habitId)}
              onPress={() => onOpen(row)}
              onToggleSteps={() => onToggleSteps(row.habitId)}
              pendingLabel={pendingLabelFor(pendingActions.get(row.habitId))}
              row={row}
              selected={selectedIds.has(row.habitId)}
              selecting={selecting}
              steps={steps}
              today={today}
            />
          </SwipeableRow>
          {!expanded || selecting || steps.length === 0 ? null : <ManageSteps
            color={theme.today.completion}
            gutterWidth={gutterWidth}
            lines={steps}
          />}
        </View>;
      })}
    </View>
  </View>;
}

/**
 * The row, and it is the journal's plate.
 *
 * `[gutter][chip][title over its meta line][subtask counter]`, on the geometry the day's
 * own blocks are drawn with — the same 30 pt chip, the same 15 pt title on a 16 pt
 * leading, the same 14 pt meta line, the two of them pushed to the ends of the chip's
 * own height so the title sits on its head and the marks on its foot.
 *
 * **The gutter carries when the item comes round** (PD-MANAGE-018): a task's due day, a
 * habit's time of day, or `Anytime`. That is the column Today gives to a minute, and it
 * is why the trailing due chip is gone — the same fact stated twice in one row reads as
 * two facts.
 *
 * **The rank is the gutter's tint and nothing else** (PD-MANAGE-019). The 3 pt edge that
 * used to stand at the trailing corner said what the tint says; what takes its place is
 * the subtask counter, which a task now has too.
 *
 * Every label is one line. With three swipe keys open the text column can shrink to about
 * 118 pt, and a label that wraps there pushes the row's height around under the finger.
 */
function ManageRow({ row, today, broken, selected, selecting, expanded, gutterWidth, pendingLabel, steps, onPress, onLongPress, onToggleSteps }: {
  readonly row: PlannerHabitCatalogueItem;
  readonly steps: readonly PlannerChecklistLine[];
  readonly today: PlannerLocalDate;
  readonly broken: boolean;
  readonly selected: boolean;
  readonly selecting: boolean;
  readonly expanded: boolean;
  readonly gutterWidth: number;
  readonly pendingLabel: string | null;
  readonly onPress: () => void;
  readonly onLongPress: () => void;
  readonly onToggleSteps: () => void;
}) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  const kind = manageItemKind(row);
  const temporal = plannerHabitTemporalPresentation(row.temporalContext);
  const subject = manageItemSubject(row);
  const due = manageTaskDueDate(row);
  const gutter = manageGutterLabel({ due, kind, plannedLocalTime: row.plannedLocalTime, today });
  // **The column says when, and nothing else.** It used to say when *and* how important
  // — the label's ink over the rank's fill — which is two facts in one cell and is why
  // a missed date on a critical row had to be raised out of rust on rust. Rank is
  // weight and one dot now (PD-PLATE-005), so the ink is simply the ink.
  const gutterInk = MANAGE_GUTTER_INK[gutter.tone](theme);
  const important = row.importance.importance === 'high' || row.importance.importance === 'critical';
  const overdue = kind === 'task' && !broken ? manageOverdueLabel(due, today) : null;
  const caption = broken
    ? 'Repeat is missing — tap to fix'
    // A habit's rule, and a task's time of day — the two facts the gutter does not
    // already carry. A task's schedule is a one-day `daily` and says nothing worth
    // printing, and a habit's minute is in the gutter beside it.
    : kind === 'task' ? row.plannedLocalTime : temporal.schedule;
  const closed = steps.filter((line) => line.done).length;
  const spoken = [
    row.name,
    kind,
    gutter.label,
    IMPORTANCE_LABELS[row.importance.importance].toLowerCase(),
    overdue,
    caption,
    selecting ? (selected ? 'selected' : 'not selected') : null,
  ].filter((part) => part !== null && part !== undefined && part !== '').join(', ');
  return <Pressable
    accessibilityHint={selecting ? undefined : broken ? 'Opens the item to repair its schedule.' : 'Opens item detail.'}
    accessibilityLabel={spoken}
    accessibilityRole={selecting ? 'checkbox' : 'button'}
    accessibilityState={selecting ? { checked: selected } : undefined}
    onLongPress={selecting ? undefined : onLongPress}
    onPress={onPress}
    style={({ pressed }) => [styles.row, {
      backgroundColor: pressed ? theme.today.pressedSurface : theme.today.dashboardSurface,
      shadowColor: theme.dark ? '#000000' : ink,
    }]}
  >
    {({ pressed }) => <>
      <View style={[styles.itemGutter, { width: gutterWidth }]}>
        <Text
          maxFontSizeMultiplier={MANAGE_GUTTER_MAX_SCALE}
          numberOfLines={1}
          style={[styles.gutterLabel, { color: gutterInk }]}
        >{gutter.label}</Text>
      </View>
      <View style={[styles.itemBody, {
        backgroundColor: selected ? theme.today.completionTint : 'transparent',
      }]}
      >
        <CategoryChip
          accentKey={subject.accentKey}
          categoryKey={subject.categoryKey}
          identity={row.visualIdentity.iconIdentity}
          kind={kind}
          size={JOURNAL_TILE}
        />
        <View style={styles.itemWords}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[styles.itemTitle, { color: ink, fontWeight: important ? '600' : '400' }]}>{row.name}</Text>
            {/* **Rank is weight and one dot.** Two readable states above ordinary, and
                the level survives in the row's own accessibility label. */}
            {row.importance.importance === 'critical'
              ? <View style={[styles.criticalDot, { backgroundColor: theme.today.attention }]} />
              : null}
          </View>
          {/* Nothing here may be an empty box: a zero-width child still earns the row's
              6 pt gap, which at a 15 pt title lands between the first and second letter
              of whatever follows it (PD-TODAY-134). An element that is not there is not
              rendered at all. */}
          <View style={styles.itemMeta}>
            {overdue === null ? null : <Text
              maxFontSizeMultiplier={MANAGE_GUTTER_MAX_SCALE}
              numberOfLines={1}
              style={[styles.metaStrong, { color: theme.today.attentionText }]}
            >{overdue}</Text>}
            {row.reminderLocalTime === null ? null : <Ionicons
              accessibilityLabel={`Reminder at ${row.reminderLocalTime}`}
              color={theme.today.tertiaryText}
              name="notifications-outline"
              size={14}
            />}
            {caption === null || caption === '' ? null : <Text
              numberOfLines={1}
              style={[styles.itemCaption, { color: broken ? theme.today.scheduleText : theme.today.secondaryText }]}
            >{caption}</Text>}
          </View>
        </View>
        {/* **The mark stands at the trailing edge**, in the column every checkbox in the
            application stands in — the journal's own control sits there, and a selection
            square that opened on the leading edge moved the whole row under the finger.
            The counter is hidden while selecting, so the two never contend for it. */}
        {selecting ? <View style={styles.selectionTarget}><SelectionMark selected={selected} /></View> : null}
        {pendingLabel !== null
          ? <StatusLabel label={pendingLabel} tone="info" />
          : steps.length > 0 && !selecting
            ? <Pressable
              accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${closed} of ${steps.length} steps of ${row.name}`}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={onToggleSteps}
              style={styles.stepsTarget}
            >
              <Text
                maxFontSizeMultiplier={MANAGE_GUTTER_MAX_SCALE}
                style={[styles.stepsCount, { color: theme.today.secondaryText }]}
              >{`${closed}/${steps.length}`}</Text>
              <Ionicons color={theme.today.secondaryText} name={expanded ? 'chevron-up' : 'chevron-down'} size={11} />
            </Pressable>
            : broken
              ? <Ionicons accessibilityElementsHidden color={theme.today.scheduleText} name="chevron-forward" size={16} />
              : null}
      </View>
    </>}
  </Pressable>;
}

/** The two identity facts the mark needs, derived the one way both surfaces derive them. */
function manageItemSubject(row: PlannerHabitCatalogueItem): ItemChipSubject {
  return {
    accentKey: row.visualIdentity.persistedAccentKey ?? habitAccentKeyForId(row.habitId),
    categoryKey: habitCategoryForAccentKey(row.visualIdentity.persistedAccentKey)?.key ?? null,
  };
}

/** What each gutter tone reads as. The rank tint under it may still raise the ink. */
const MANAGE_GUTTER_INK: Readonly<Record<ManageGutterTone, (theme: ReturnType<typeof useLifePlannerTheme>) => string>> = Object.freeze({
  anytime: (theme) => theme.today.tertiaryText,
  later: (theme) => theme.today.primaryText,
  overdue: (theme) => theme.today.attention,
  timed: (theme) => theme.today.primaryText,
  today: (theme) => theme.today.completion,
});

/**
 * Swipe acts on one item; Select acts on a batch. The two never contend, because
 * swipe is disabled the moment selection mode opens.
 */
function SwipeableRow({ rowId, openRowId, actions, enabled, onOpenRow, children }: PropsWithChildren<{
  readonly rowId: string;
  readonly openRowId: string | null;
  readonly actions: readonly SwipeRowAction[];
  readonly enabled: boolean;
  readonly onOpenRow: (rowId: string | null) => void;
}>) {
  if (!enabled || actions.length === 0) return <>{children}</>;
  return <SwipeActionRow actions={actions} appearance="cards" onOpen={onOpenRow} openRowId={openRowId} rowId={rowId}>{children}</SwipeActionRow>;
}

function pendingLabelFor(action: 'archive' | 'restore' | 'delete' | undefined): string | null {
  if (action === 'archive') return 'Archiving…';
  if (action === 'restore') return 'Restoring…';
  if (action === 'delete') return 'Reviewing…';
  return null;
}

function subjectLabel(count: number, firstName: string | undefined): string {
  if (count === 1 && firstName !== undefined) return firstName;
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function emptyTitle(scope: ManagementScope, typeScope: ManageTypeScope, searchText: string): string {
  if (searchText.trim() !== '') return 'No matching items';
  if (scope === 'archived') return 'Nothing archived';
  return typeScope === 'tasks' ? 'No tasks yet' : typeScope === 'habits' ? 'No habits yet' : 'Nothing here yet';
}

function nextSelection(
  action: 'all' | 'none' | 'invert',
  roots: readonly PlannerHabitCatalogueItem[],
  current: ReadonlySet<string>,
): ReadonlySet<string> {
  if (action === 'all') return new Set(roots.map((row) => row.habitId));
  if (action === 'none') return new Set();
  return new Set(roots.filter((row) => !current.has(row.habitId)).map((row) => row.habitId));
}

/** A selection checkbox, or nothing at all outside selection mode. */
function SelectionMark({ selected }: { readonly selected: boolean }) {
  const theme = useLifePlannerTheme();
  return <View
    accessibilityElementsHidden
    style={[styles.selectionMark, {
      backgroundColor: selected ? theme.today.completion : 'transparent',
      borderColor: selected ? 'transparent' : theme.today.tone300,
      borderWidth: selected ? 0 : 1.5,
    }]}
  >
    {selected ? <Ionicons color={theme.today.onAccent} name="checkmark" size={14} /> : null}
  </View>;
}

/**
 * The lines of an item, inside its own plate and under its own rank.
 *
 * The block stands in the row's body so it cannot come away from the row that owns it,
 * and the gutter simply **continues** beside it in the parent's tint — nothing is
 * assigned to a line, which has neither a rank nor a minute of its own; the column just
 * does not stop at the row that owns it (PD-MANAGE-021).
 */
function ManageSteps({ lines, color, gutterWidth }: {
  readonly lines: readonly PlannerChecklistLine[];
  readonly color: string;
  readonly gutterWidth: number;
}) {
  const theme = useLifePlannerTheme();
  return <View style={[styles.stepsRow, { backgroundColor: theme.today.dashboardSurface }]}>
    <View style={[styles.itemGutter, { width: gutterWidth }]} />
    <View style={[styles.steps, { borderTopColor: theme.today.separator }]}>
      {lines.map((line) => <StepRow color={color} key={line.id} line={line} />)}
    </View>
  </View>;
}

/**
 * A subtask, as this list shows one: text, and whether it is done **on the day being
 * asked about**.
 *
 * It used to be a whole habit here, with a schedule to be missing and a tracking mode to
 * state — because that is what a subtask was. It is a line now, so there is nothing to
 * repair and nothing to describe.
 *
 * **The box is a record and not a control** (PD-MANAGE-012): an observation is written
 * against a date and this screen has none, so it carries no `Pressable` and no `hitSlop`
 * at all. It is drawn exactly as the journal draws it — the parent's own category colour
 * fills a ticked one, because a line has no identity of its own.
 */
function StepRow({ line, color }: { readonly line: PlannerChecklistLine; readonly color: string }) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  return <View
    accessible
    accessibilityLabel={`${line.text}, ${line.done ? 'done today' : 'not done today'}`}
    style={styles.stepRow}
  >
    <Text numberOfLines={1} style={[styles.stepTitle, { color: line.done ? theme.today.secondaryText : ink }]}>{line.text}</Text>
    <View style={styles.stepBoxTarget}>
      <View style={[styles.stepBox, { borderColor: withAlpha(ink, 0.26) }]}>
        {!line.done ? null : <View style={[styles.stepBoxMet, { backgroundColor: color }]}>
          <Ionicons color={theme.today.dashboardSurface} name="checkmark" size={9} />
        </View>}
      </View>
    </View>
  </View>;
}

function PanelAction({ icon, label, danger = false, disabled, onPress }: {
  readonly icon: React.ComponentProps<typeof Ionicons>['name'];
  readonly label: string;
  readonly danger?: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const theme = useLifePlannerTheme();
  const tint = danger ? theme.today.attention : theme.today.primaryText;
  return <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.panelAction, {
      backgroundColor: danger ? theme.today.attentionTint : pressed ? theme.today.tone100 : 'transparent',
      opacity: disabled ? 0.4 : 1,
    }]}
  >
    <Ionicons color={tint} name={icon} size={21} />
    <Text style={[styles.panelLabel, { color: tint }]}>{label}</Text>
  </Pressable>;
}

/**
 * Archived management still renders one accent-framed row, so the archived screen
 * and its restore flow keep the presentation they were built against.
 */
export function HabitCatalogueRow({ row, onPress, compact = false, grouped = false, contained = false, pendingLabel = null }: { readonly row: PlannerHabitCatalogueItem; readonly onPress: () => void; readonly compact?: boolean; readonly grouped?: boolean; readonly contained?: boolean; readonly pendingLabel?: string | null }) {
  const theme = useLifePlannerTheme();
  const accent = theme.habitAccents[row.visualIdentity.persistedAccentKey];
  const temporal = plannerHabitTemporalPresentation(row.temporalContext);
  // A sub-habit is not a thing this product makes any more (PD-HABIT-006), so the
  // two clauses that named one are gone; a dependency is a different feature and
  // keeps its own words.
  const relationships = [row.parentCount > 0 ? `waits on ${row.parentCount} ${row.parentCount === 1 ? 'habit' : 'habits'}` : '', row.dependentCount > 0 ? `${row.dependentCount} linked ${row.dependentCount === 1 ? 'habit' : 'habits'}` : ''].filter(Boolean).join(', ');
  const primarySummary = temporal.primarySummary;
  const secondarySummary = `${temporal.tracking}${temporal.importance === 'normal' ? '' : ` · ${temporal.importance} importance`}${relationships === '' ? '' : ` · ${relationships}`}`;
  const content = <Pressable accessibilityHint="Opens habit detail" accessibilityLabel={[row.name, primarySummary, secondarySummary].join(', ')} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ backgroundColor: contained ? compact ? accent.childSurface : 'transparent' : pressed ? accent.progressSurface : 'transparent', borderBottomColor: accent.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: theme.spacing.xxs, minHeight: compact ? 48 : 68, paddingVertical: compact ? theme.spacing.xxs : theme.spacing.sm, paddingHorizontal: theme.spacing.xs })}>
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm }}><HabitIdentityMark accessibilityLabel={`${row.name} identity`} accentKey={row.visualIdentity.persistedAccentKey} child={row.ordinaryParentName !== null} iconIdentity={row.visualIdentity.iconIdentity} seed={row.habitId} /><Text style={[compact ? theme.typography.label : theme.typography.headline, { color: theme.colors.text, flex: 1 }]}>{row.name}</Text>{pendingLabel === null ? temporal.statusLabel === 'Scheduled' ? <StatusLabel label="Scheduled" tone="info" /> : temporal.needsSchedule ? <StatusLabel label="Needs schedule" tone="warning" /> : null : <StatusLabel label={pendingLabel} tone="info" />}</View>
    <Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{primarySummary}</Text>
    {compact ? null : <Text numberOfLines={2} style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{secondarySummary}</Text>}
  </Pressable>;
  return contained ? content : <HabitSurface accentKey={row.visualIdentity.persistedAccentKey}>{content}</HabitSurface>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 14, paddingBottom: 130 },
  /** Clears the floating panel: its inset plus its own height. */
  selectingContent: { gap: 14, paddingBottom: 150 },
  header: { alignItems: 'flex-end', flexDirection: 'row', gap: 8, minHeight: 52 },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 2, minHeight: 28 },
  eyebrowLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.78 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4, lineHeight: 34 },
  selectionTitle: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  headerCaption: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  headerButton: { alignItems: 'center', borderRadius: 13, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 },
  donePill: { alignItems: 'center', borderRadius: 11, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 13 },
  doneLabel: { fontSize: 14, fontWeight: '600' },
  segment: { borderRadius: 11, flexDirection: 'row', gap: 6, padding: 3 },
  segmentOption: { alignItems: 'center', borderRadius: 9, flex: 1, justifyContent: 'center', minHeight: 38 },
  segmentSelected: { elevation: 1, shadowOffset: { height: 1, width: 0 }, shadowOpacity: 0.08, shadowRadius: 2 },
  segmentLabel: { fontSize: 14, fontWeight: '600' },
  filterRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  chips: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', gap: 7 },
  chip: { alignItems: 'center', borderRadius: 11, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 11 },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  spacer: { flex: 1 },
  sortAction: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'center', minHeight: 44, paddingHorizontal: 4 },
  selectAction: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 4 },
  section: { gap: 6 },
  sectionHeader: { alignItems: 'baseline', flexDirection: 'row', gap: 7, paddingLeft: 2 },
  sectionDot: { borderRadius: 3, height: 6, width: 6 },
  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.72 },
  sectionCount: { fontSize: 12, fontWeight: '600', opacity: 0.7 },
  /**
   * One card per section, on the journal block's own geometry: radius 16 and a 1.5 pt
   * edge rather than a hairline.
   *
   * **Recorded divergence from Today, taken deliberately.** The journal's block is
   * transparent and stands on a card; under Manage there is only `appSurface`, so the
   * plate stays filled — otherwise the rows would show sand, and with the fill would go
   * the mask that uncovers the swipe keys (PD-MANAGE-014).
   */
  sectionPlates: { gap: PLATE_GAP },
  // The holder is what the swipe reveals from behind: the plate is the mask.
  plateHolder: { borderRadius: PLATE_RADIUS, overflow: 'hidden' },
  /**
   * Full width, and no longer inset past the mark.
   *
   * The gutter runs down the plate as one unbroken column, and a rule that stopped short
   * of it would cut that column rather than separate two rows.
   */
  row: {
    alignItems: 'stretch',
    borderRadius: PLATE_RADIUS,
    elevation: 2,
    flexDirection: 'row',
    minHeight: PLATE_MIN_HEIGHT,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  criticalDot: { borderRadius: PLATE_CRITICAL_DOT / 2, height: PLATE_CRITICAL_DOT, width: PLATE_CRITICAL_DOT },
  /**
   * The row's own slice of the "when" column, and **the label is centred in it**.
   *
   * The slice is the full height of the row beside it — 52 pt against a 16 pt line —
   * and pinned to its top-left corner the label read as adrift in a coloured rectangle
   * rather than as the label of one. Centring is what makes the cell look placed, and
   * it is the axis on which the strings differ most: `Today`, `26 Jul`, `Tomorrow` and
   * `07:00` are 33–63 pt wide, so left-aligned they are ragged down the column and
   * centred they are a column.
   *
   * **The baseline nudge goes with the top edge it was measured against.** It exists to
   * put a 13 pt time on a 15 pt title's line (PD-TODAY-136); centred in the block there
   * is no line to sit on, and the nudge would only push it a point low. The journal's
   * block keeps both, because there the time does stand on the title's line.
   */
  itemGutter: { alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: JOURNAL_BODY_PADDING_Y },
  gutterLabel: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '400', lineHeight: 16, textAlign: 'center' },
  /** Top-aligned, so the title stands level with the head of the mark. */
  itemBody: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: PLATE_ROW_GAP, minWidth: 0, paddingHorizontal: PLATE_PADDING, paddingVertical: PLATE_PADDING },
  /** Exactly the mark's height, with its two children pushed to the ends of it. */
  // Centred and reserving nothing: a row with no caption is as centred as one with a
  // caption, because the absent line is not rendered (PD-PLATE-002).
  itemWords: { flex: 1, gap: 2, justifyContent: 'center', minWidth: 0 },
  itemTitle: { flexShrink: 1, fontSize: 17, letterSpacing: -0.2, lineHeight: 22 },
  /** A fixed line whether or not it has anything in it, or a bare title floats. */
  itemMeta: { alignItems: 'center', flexDirection: 'row', gap: 6, height: 14 },
  metaStrong: { flexGrow: 0, flexShrink: 0, fontSize: 11, fontWeight: '700' },
  itemCaption: { flexShrink: 1, fontSize: 11, fontWeight: '600', minWidth: 0 },
  stepsTarget: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', flexGrow: 0, flexShrink: 0, gap: 4, justifyContent: 'center', minWidth: JOURNAL_TOUCH_TARGET },
  stepsCount: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '600' },
  /** The same 44 pt column the counter and the journal's checkbox stand in. */
  selectionTarget: { alignItems: 'center', alignSelf: 'stretch', flexGrow: 0, flexShrink: 0, justifyContent: 'center', width: JOURNAL_TOUCH_TARGET },
  selectionMark: { alignItems: 'center', borderRadius: 12, flexShrink: 0, height: 24, justifyContent: 'center', width: 24 },
  stepsRow: { flexDirection: 'row' },
  /** The lines begin where the title begins: the three columns they have to clear. */
  steps: { borderTopWidth: StyleSheet.hairlineWidth, flex: 1, gap: 2, minWidth: 0, paddingBottom: 8, paddingLeft: JOURNAL_TILE + JOURNAL_BODY_GAP + JOURNAL_BODY_PADDING, paddingRight: JOURNAL_BODY_PADDING, paddingTop: 6 },
  stepRow: { alignItems: 'center', flexDirection: 'row', gap: 9, height: JOURNAL_STEP_HEIGHT },
  stepTitle: { flex: 1, fontSize: 13.5, fontWeight: '500', minWidth: 0 },
  /** The line's box stands on the parent's own vertical: same column, both centred. */
  stepBoxTarget: { alignItems: 'center', flexGrow: 0, flexShrink: 0, justifyContent: 'center', width: JOURNAL_TOUCH_TARGET },
  stepBox: { alignItems: 'center', borderRadius: 8, borderWidth: 1.5, height: 15, justifyContent: 'center', width: 15 },
  stepBoxMet: { alignItems: 'center', borderRadius: 8, bottom: -1.5, justifyContent: 'center', left: -1.5, position: 'absolute', right: -1.5, top: -1.5 },
  consequence: { borderRadius: 16, borderWidth: 1, gap: 3, paddingHorizontal: 13, paddingVertical: 12 },
  consequenceTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  consequenceBody: { fontSize: 13, lineHeight: 18 },
  panel: { borderRadius: 22, borderWidth: 1, elevation: 8, flexDirection: 'row', gap: 8, padding: 10, shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.14, shadowRadius: 28 },
  newItem: { alignItems: 'center', borderRadius: 18, elevation: 10, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 52, shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.2, shadowRadius: 30 },
  newItemLabel: { fontSize: 16, fontWeight: '600' },
  panelAction: { alignItems: 'center', borderRadius: 13, flex: 1, gap: 4, justifyContent: 'center', minHeight: 56, paddingVertical: 8 },
  panelLabel: { fontSize: 12, fontWeight: '600' },
  errorBlock: { gap: 8 },
});
