import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type PropsWithChildren } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import {
  beginPlannerPerformanceSpan,
  measurePlannerOperation,
  reportPlannerFailure,
  type PlannerId,
  type PlannerLocalDate,
  type DeleteHabitChainImpact,
} from '@/src/features/planner';
import {
  AppHeader,
  BodyText,
  Card,
  DestructiveButton,
  EmptyState,
  IconButton,
  InlineError,
  LoadingState,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusLabel,
} from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { HabitIdentityMark, HabitSurface } from './habit-visual-components';
import { PlannerArchiveConfirmation } from './planner-archive-confirmation';
import { deleteChainConfirmationAction, deleteChainConfirmationMessage, deleteChainConfirmationTitle } from './planner-delete-confirmation';
import { usePlannerHabitDetail, usePlannerServices } from './planner-provider';
import {
  observationValueText,
  formatPlannerLifecycleDate,
  plannerFailureMessage,
  plannerHabitTemporalPresentation,
  plannerLocalDateFromDevice,
  plannerTimezoneFromDevice,
  resolveHabitDetailRouteParams,
  scheduleSummary,
  trackingSummary,
} from './ui-adapters';

export function HabitDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[]; date?: string | string[] }>();
  const route = resolveHabitDetailRouteParams(params, plannerLocalDateFromDevice());
  if (!route.ok) {
    return <Screen>
      <AppHeader leading={<IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />} title="Habit Detail" />
      <EmptyState title="Invalid habit link" message="This link is missing or invalid." />
    </Screen>;
  }
  return <ResolvedHabitDetailScreen habitId={route.habitId} asOfLocalDate={route.asOfLocalDate} />;
}

function ResolvedHabitDetailScreen({ habitId, asOfLocalDate }: { readonly habitId: PlannerId; readonly asOfLocalDate: PlannerLocalDate }) {
  const router = useRouter();
  const theme = useLifePlannerTheme();
  const query = usePlannerHabitDetail(habitId, asOfLocalDate);
  const { archiveHabit, deleteHabitChain, previewDeleteHabitChain, refreshOccurrences } = usePlannerServices();
  const [actionError, setActionError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'archive' | 'preview_delete' | 'delete' | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<DeleteHabitChainImpact | null>(null);

  if (query.status === 'loading') return <Screen><LoadingState label="Loading habit detail" /></Screen>;
  if (query.status === 'error') return <Screen><InlineError message={query.error} /><SecondaryButton title="Retry" onPress={query.retry} /></Screen>;
  if (query.data === null) return <Screen><EmptyState title="Habit not found" message="This habit is unavailable." /></Screen>;
  const detail = query.data;
  const temporal = plannerHabitTemporalPresentation(detail.temporalContext);
  const displayConfiguration = detail.temporalContext.displayConfiguration;
  const availability = detail.temporalContext.actionAvailability;

  const archive = () => {
    const effectiveLocalDate = availability.archive.earliestEffectiveLocalDate;
    if (pendingAction !== null || !availability.archive.available || effectiveLocalDate === null) return;
    setPendingAction('archive');
    setArchiveError(null);
    void measurePlannerOperation('archive_command', () => archiveHabit({
      habitId,
      effectiveLocalDate,
      boundaryTimezone: plannerTimezoneFromDevice(),
    })).then((result) => {
      if (!result.ok) {
        reportPlannerFailure('archiveHabit', result.error.code, [habitId]);
        setPendingAction(null);
        setArchiveError(plannerFailureMessage(result.error.code));
        return;
      }
      setPendingAction(null);
      setArchiveOpen(false);
      setSuccessMessage(result.value.outcome === 'already_archived' ? `${detail.habit.name} was already archived.` : `${detail.habit.name} archived.`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      beginPlannerPerformanceSpan('archive_refresh');
      refreshOccurrences();
    });
  };

  const loadDeletionPreview = () => {
    if (pendingAction !== null) return;
    setPendingAction('preview_delete');
    setActionError(null);
    void measurePlannerOperation('delete_preview', () => previewDeleteHabitChain({
      rootHabitId: habitId,
      asOfLocalDate,
    })).then((result) => {
      setPendingAction(null);
      if (!result.ok) {
        reportPlannerFailure('previewDeleteHabitChain', result.error.code, [habitId]);
        setActionError(plannerFailureMessage(result.error.code));
        return;
      }
      setDeletionPreview(result.value);
    });
  };

  const remove = () => {
    const preview = deletionPreview;
    if (preview === null || pendingAction !== null) return;
    Alert.alert(
      deleteChainConfirmationTitle(preview),
      deleteChainConfirmationMessage(preview),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: deleteChainConfirmationAction(preview),
          style: 'destructive',
          onPress: () => {
            if (pendingAction !== null) return;
            setPendingAction('delete');
            setActionError(null);
            void measurePlannerOperation('delete_command', () => deleteHabitChain({
              habitId,
              effectiveLocalDate: asOfLocalDate,
              boundaryTimezone: preview.targets.find(({ habitId: targetId }) => targetId === habitId)?.boundaryTimezone ?? plannerTimezoneFromDevice(),
              expectedOrderedTargetHabitIds: preview.orderedTargetHabitIds,
              confirmed: true,
            })).then((result) => {
              if (!result.ok) {
                reportPlannerFailure('deleteHabitChain', result.error.code, [habitId]);
                setPendingAction(null);
                setActionError(plannerFailureMessage(result.error.code));
                if (result.error.code === 'delete_routine_stale_confirmation') setDeletionPreview(null);
                return;
              }
              beginPlannerPerformanceSpan('delete_refresh');
              refreshOccurrences();
              router.back();
            });
          },
        },
      ],
    );
  };

  return <Screen>
    {actionError === null ? null : <View><InlineError message={actionError} /><SecondaryButton title="Dismiss error" onPress={() => setActionError(null)} /></View>}
    {successMessage === null ? null : <Text accessibilityLiveRegion="polite" style={[theme.typography.callout, { color: theme.colors.success }]}>{successMessage}</Text>}
    <AppHeader
      leading={<IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />}
      title="Habit Detail"
      subtitle={temporal.statusLabel === 'Archived' ? 'Archived · read-only' : temporal.statusLabel === 'Scheduled' ? 'Scheduled · not active yet' : 'Habit Detail'}
    />
    <HabitSurface accessibilityLabel={`${detail.habit.name}, ${temporal.statusLabel}${temporal.statusDetail === null ? '' : `, ${temporal.statusDetail}`}`} accentKey={detail.habit.visualIdentity.persistedAccentKey} contentStyle={styles.identityHeader}>
      <HabitIdentityMark accessibilityLabel={`${detail.habit.name} identity`} accentKey={detail.habit.visualIdentity.persistedAccentKey} iconIdentity={detail.habit.visualIdentity.iconIdentity} seed={detail.habit.id} />
      <View style={styles.identityText}><Text style={[theme.typography.sectionTitle, { color: theme.colors.text }]}>{detail.habit.name}</Text><Text style={[theme.typography.callout, { color: theme.colors.secondaryText }]}>{detail.habit.description ?? 'No description'}</Text></View>
    </HabitSurface>
    <Section title="Overview">
      <Fact label="Status" value={[temporal.statusLabel, temporal.statusDetail].filter(Boolean).join(' · ')} />
      <Fact label="Description" value={detail.habit.description ?? 'No description'} />
      <Fact label="Active range" value={rangeText(detail.habit.activeRange)} />
    </Section>
    <Section title={temporal.settingsHeading}>
      {detail.temporalContext.displayConfigurationTemporalRelation === 'next_effective' ? <Fact label="Starts" value={formatPlannerLifecycleDate(displayConfiguration.effectiveLocalDate)} /> : null}
      <Fact label="Schedule" value={temporal.schedule} />
      <Fact label="Planned time" value={temporal.plannedTime} />
      <Fact label="Tracking" value={temporal.tracking} />
      <Fact label="Importance" value={temporal.importance} />
    </Section>
    <Section title="Habit group">
      <Fact label="Part of" value={displayConfiguration.ordinaryParent?.parentName ?? 'No group'} />
      {displayConfiguration.ordinaryChildren.length === 0
        ? <BodyText secondary>No sub-habits.</BodyText>
        : displayConfiguration.ordinaryChildren.map((relationship) => <HistoryRow key={relationship.id} title={relationship.childName} lines={['Planned and completed independently', rangeText(relationship.effectiveRange)]} />)}
    </Section>
    <Section title="Conditional dependencies">
      {detail.dependencyHistory.length === 0
        ? <BodyText secondary>No conditional relationships.</BodyText>
        : detail.dependencyHistory.map(({ version, parentName, dependentName }) => <HistoryRow key={version.id} title={`${version.dependencyType === 'follow_up' ? 'Follow-up' : 'Prerequisite'}: ${parentName} → ${dependentName}`} lines={[rangeText(version.effectiveRange)]} />)}
    </Section>
    <Section title="Configuration history">
      <HistoryGroup title="Schedule" rows={detail.scheduleHistory.map((version) => ({ key: version.id, title: scheduleSummary(version.definition), line: rangeText(version.definition.effectiveRange) }))} />
      <HistoryGroup title="Planned time" rows={detail.plannedTimeHistory.map((version) => ({ key: version.id, title: version.plannedLocalTime ?? 'All day', line: rangeText(version.effectiveRange) }))} />
      <HistoryGroup title="Tracking" rows={detail.trackingHistory.map((version) => ({ key: version.id, title: trackingSummary(version.definition), line: rangeText(version.definition.effectiveRange) }))} />
      <HistoryGroup title="Importance" rows={detail.importanceHistory.map((version) => ({ key: version.id, title: version.importance, line: rangeText(version.effectiveRange) }))} />
    </Section>
    <Section title="Completion history">
      {detail.observationHistory.length === 0
        ? <BodyText secondary>No completions recorded.</BodyText>
        : detail.observationHistory.map((chain) => <View key={chain.root.id} style={{ gap: theme.spacing.xs }}>
          <Text style={[theme.typography.headline, { color: theme.colors.text }]}>{chain.root.occurrenceLocalDate} · {observationValueText(chain.currentLeaf)}</Text>
          <StatusLabel label={chain.isVoided ? 'Removed' : chain.facts.length > 1 ? 'Corrected' : 'Original'} tone={chain.isVoided ? 'neutral' : 'info'} />
        </View>)}
    </Section>
    <Section title="Actions">
      {availability.edit.available ? <>
        <SecondaryButton disabled={pendingAction !== null} title="Edit habit" onPress={() => router.push({ pathname: '/planner/edit/[id]', params: { id: habitId, date: asOfLocalDate } })} />
      </> : null}
      {availability.archive.available ? <SecondaryButton disabled={pendingAction !== null} accessibilityHint={detail.temporalContext.isPreActive ? `Archives before this habit begins on ${formatPlannerLifecycleDate(availability.archive.earliestEffectiveLocalDate ?? detail.temporalContext.activeFrom)}.` : 'Reversible. Keeps all habit history.'} title={pendingAction === 'archive' ? 'Archiving…' : 'Archive'} onPress={() => { setArchiveError(null); setArchiveOpen(true); }} /> : null}
      {availability.delete.available ? <BodyText secondary>Permanent deletion is irreversible and removes this habit, every descendant, and their history. Archive is safer.</BodyText> : <BodyText secondary>{detail.temporalContext.isPreActive ? `Not active yet. Edit and Delete are available from ${formatPlannerLifecycleDate(detail.temporalContext.activeFrom)}.` : 'No additional actions are available from this date.'}</BodyText>}
      {!availability.delete.available ? null : deletionPreview === null
        ? <DestructiveButton disabled={pendingAction !== null} accessibilityHint="Opens a preview before anything is permanently removed" title={pendingAction === 'preview_delete' ? 'Preparing preview…' : 'Review permanent deletion'} onPress={loadDeletionPreview} />
        : <DeletionPreviewControls
          pending={pendingAction !== null}
          preview={deletionPreview}
          onCancel={() => setDeletionPreview(null)}
          onConfirm={remove}
        />}
    </Section>
    <PlannerArchiveConfirmation
      error={archiveError}
      habitName={detail.habit.name}
      message={detail.temporalContext.isPreActive
        ? `This habit will be archived before it begins on ${formatPlannerLifecycleDate(availability.archive.earliestEffectiveLocalDate ?? detail.temporalContext.activeFrom)}. History remains available.`
        : `This habit will leave active planning on ${formatPlannerLifecycleDate(availability.archive.earliestEffectiveLocalDate ?? asOfLocalDate)}. History remains available.`}
      onCancel={() => { if (pendingAction !== 'archive') { setArchiveOpen(false); setArchiveError(null); } }}
      onConfirm={archive}
      onDismissError={() => setArchiveError(null)}
      pending={pendingAction === 'archive'}
      visible={archiveOpen}
    />
  </Screen>;
}

function DeletionPreviewControls({ pending, preview, onCancel, onConfirm }: {
  readonly pending: boolean;
  readonly preview: DeleteHabitChainImpact;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const theme = useLifePlannerTheme();
  return <View style={{ gap: theme.spacing.sm }}>
    <SectionHeader title="Deletion preview" />
    <HistoryRow title={`Delete · ${preview.rootHabitName}`} lines={[`${preview.targetCount} ${preview.targetCount === 1 ? 'habit' : 'habits'} · ${preview.observationCount} observation/history ${preview.observationCount === 1 ? 'row' : 'rows'} · ${preview.correctionCount} ${preview.correctionCount === 1 ? 'correction' : 'corrections'}`]} />
    {preview.targets.filter(({ habitId }) => habitId !== preview.rootHabitId).length === 0
      ? <BodyText secondary>This is a leaf habit; no descendants are attached.</BodyText>
      : preview.targets.filter(({ habitId }) => habitId !== preview.rootHabitId).sort((left, right) => left.depth - right.depth || left.name.localeCompare(right.name)).map((target) => <HistoryRow key={target.habitId} title={`${'  '.repeat(Math.max(0, target.depth - 1))}Delete · ${target.name}`} lines={[`Descendant level ${target.depth}`]} />)}
    <BodyText secondary>{preview.unrelatedPreservedCount} unrelated ${preview.unrelatedPreservedCount === 1 ? 'habit remains' : 'habits remain'} unchanged.</BodyText>
    <SecondaryButton disabled={pending} title="Cancel deletion review" onPress={onCancel} />
    <DestructiveButton disabled={pending} accessibilityHint="Permanently deletes this habit and every listed descendant" title={pending ? 'Working…' : `Delete ${preview.targetCount} ${preview.targetCount === 1 ? 'habit' : 'habits'} permanently`} onPress={onConfirm} />
  </View>;
}

function Section({ title, children }: PropsWithChildren<{ readonly title: string }>) {
  return <Card><SectionHeader title={title} />{children}</Card>;
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return <View><BodyText>{label}</BodyText><BodyText secondary>{value}</BodyText></View>;
}

function HistoryGroup({ title, rows }: { readonly title: string; readonly rows: readonly { key: string; title: string; line: string }[] }) {
  return <View><BodyText>{title}</BodyText>{rows.map((row) => <HistoryRow key={row.key} title={row.title} lines={[row.line]} />)}</View>;
}

function HistoryRow({ title, lines }: { readonly title: string; readonly lines: readonly string[] }) {
  return <View><BodyText>{title}</BodyText>{lines.map((line) => <BodyText key={line} secondary>{line}</BodyText>)}</View>;
}

function rangeText(range: { readonly effectiveFrom: string; readonly effectiveTo: string | null }) {
  return `${range.effectiveFrom} to ${range.effectiveTo ?? 'open-ended'}`;
}

const styles = StyleSheet.create({
  identityHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 76, padding: 14 },
  identityText: { flex: 1, gap: 2, minWidth: 0 },
});
