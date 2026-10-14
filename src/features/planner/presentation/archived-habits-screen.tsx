import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, LayoutAnimation, View } from 'react-native';

import { beginPlannerPerformanceSpan, measurePlannerOperation, reportPlannerFailure, type PlannerHabitCatalogueItem } from '@/src/features/planner';
import { AppHeader, BodyText, EmptyState, IconButton, InlineError, LoadingState, Screen, SwipeActionRow, TextField } from '@/src/ui/components';

import { HabitCatalogueRow } from './all-habits-screen';
import { deleteChainConfirmationAction, deleteChainConfirmationMessage, deleteChainConfirmationTitle } from './planner-delete-confirmation';
import { usePlannerHabitCatalogue, usePlannerServices } from './planner-provider';
import { habitDetailNavigation, managementQueryDate, plannerFailureMessage, plannerLocalDateFromDevice, plannerTimezoneFromDevice } from './ui-adapters';

export function ArchivedHabitsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const pendingActionsRef = useRef(new Map<string, 'restore' | 'delete'>());
  const [pendingActions, setPendingActions] = useState<ReadonlyMap<string, 'restore' | 'delete'>>(() => new Map());
  const [removedHabitIds, setRemovedHabitIds] = useState<ReadonlySet<string>>(() => new Set());
  const date = managementQueryDate(params.date, plannerLocalDateFromDevice());
  const query = usePlannerHabitCatalogue(search, 'archived', date);
  const { deleteHabitChain, previewDeleteHabitChain, restoreHabit, refreshOccurrences } = usePlannerServices();
  const setPending = (habitId: string, action: 'restore' | 'delete' | null) => {
    if (action === null) pendingActionsRef.current.delete(habitId);
    else pendingActionsRef.current.set(habitId, action);
    setPendingActions(new Map(pendingActionsRef.current));
  };
  const finishRemoval = (habitId: string, operation: 'restore' | 'delete') => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setRemovedHabitIds((current) => new Set([...current, habitId]));
    setPending(habitId, null);
    if (operation === 'delete') beginPlannerPerformanceSpan('delete_refresh');
    refreshOccurrences();
  };
  const restore = (row: PlannerHabitCatalogueItem) => {
    const effectiveLocalDate = row.temporalContext.actionAvailability.restore.earliestEffectiveLocalDate;
    if (!row.temporalContext.actionAvailability.restore.available || effectiveLocalDate === null) return;
    Alert.alert(`Restore ${row.name}?`, 'The habit returns to active planning. Its history stays available.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Restore', onPress: () => { if (pendingActionsRef.current.has(row.habitId)) return; setPending(row.habitId, 'restore'); setError(null); void restoreHabit({ habitId: row.habitId, effectiveLocalDate, boundaryTimezone: plannerTimezoneFromDevice() }).then((result) => { if (!result.ok) { reportPlannerFailure('restoreHabit', result.error.code, [row.habitId]); setPending(row.habitId, null); setError(plannerFailureMessage(result.error.code)); return; } if (result.value.outcome === 'schedule_required') { setPending(row.habitId, null); router.push({ pathname: '/planner/habits/restore/[id]', params: { id: row.habitId, date: effectiveLocalDate } }); return; } finishRemoval(row.habitId, 'restore'); }); } }]);
  };
  const remove = async (row: PlannerHabitCatalogueItem) => {
    const habitId = row.habitId;
    const effectiveLocalDate = row.temporalContext.actionAvailability.delete.earliestEffectiveLocalDate;
    if (!row.temporalContext.actionAvailability.delete.available || effectiveLocalDate === null) return;
    if (pendingActionsRef.current.has(habitId)) return;
    setPending(habitId, 'delete');
    setError(null);
    const preview = await measurePlannerOperation('delete_preview', () => previewDeleteHabitChain({ rootHabitId: habitId, asOfLocalDate: effectiveLocalDate }));
    setPending(habitId, null);
    if (!preview.ok) {
      reportPlannerFailure('previewDeleteHabitChain', preview.error.code, [habitId]);
      setError(plannerFailureMessage(preview.error.code));
      return;
    }
    Alert.alert(deleteChainConfirmationTitle(preview.value), deleteChainConfirmationMessage(preview.value), [{ text: 'Cancel', style: 'cancel' }, { text: deleteChainConfirmationAction(preview.value), style: 'destructive', onPress: () => { if (pendingActionsRef.current.has(habitId)) return; setPending(habitId, 'delete'); setError(null); void measurePlannerOperation('delete_command', () => deleteHabitChain({ habitId, effectiveLocalDate, boundaryTimezone: preview.value.targets.find(({ habitId: targetId }) => targetId === habitId)?.boundaryTimezone ?? plannerTimezoneFromDevice(), expectedOrderedTargetHabitIds: preview.value.orderedTargetHabitIds, confirmed: true })).then((result) => { if (!result.ok) { reportPlannerFailure('deleteHabitChain', result.error.code, [habitId]); setPending(habitId, null); setError(plannerFailureMessage(result.error.code)); } else finishRemoval(habitId, 'delete'); }); } }]);
  };
  const rows = (query.data ?? []).filter((row) => !removedHabitIds.has(row.habitId));
  return <Screen onScrollBeginDrag={() => setOpenRowId(null)}><AppHeader leading={<IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />} title="Archived habits" subtitle="Out of daily planning, with history preserved" /><TextField label="Search archived habits" value={search} onChangeText={setSearch} />{error === null ? null : <InlineError message={error} />}{query.status === 'loading' && query.data === null ? <LoadingState label="Loading archived habits" /> : null}{query.status === 'error' ? <InlineError message={query.error} /> : null}{query.status === 'ready' && rows.length === 0 ? <EmptyState title="No archived habits" message="Archived habits appear here." /> : null}{rows.map((row) => { const pending = pendingActions.get(row.habitId); const availability = row.temporalContext.actionAvailability; const actions = [...(availability.restore.available ? [{ name: 'restore', label: pending === 'restore' ? 'Restoring…' : 'Restore', icon: 'refresh-outline' as const, disabled: pending !== undefined, onPress: () => restore(row) }] : []), ...(availability.delete.available ? [{ name: 'delete', label: pending === 'delete' ? 'Reviewing…' : 'Delete', icon: 'trash-outline' as const, tone: 'danger' as const, disabled: pending !== undefined, onPress: () => void remove(row) }] : [])]; return <SwipeActionRow key={row.habitId} rowId={row.habitId} openRowId={openRowId} onOpen={setOpenRowId} actions={actions}><View style={{ gap: 4 }}><HabitCatalogueRow row={row} pendingLabel={pending === 'restore' ? 'Restoring…' : pending === 'delete' ? 'Reviewing…' : null} onPress={() => { if (pending === undefined) router.push(habitDetailNavigation(row.habitId, date)); }} /><BodyText secondary>Archived {row.archivedAt === null ? '' : new Date(row.archivedAt).toLocaleDateString()}</BodyText></View></SwipeActionRow>; })}</Screen>;
}
