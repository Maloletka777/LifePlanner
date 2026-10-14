import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { parsePlannerLocalDate, reportPlannerFailure, type ScheduleDefinition } from '@/src/features/planner';
import {
  BodyText,
  Card,
  InlineError,
  LoadingState,
  Screen,
  SectionHeader,
  SelectionRow,
  WizardShell,
} from '@/src/ui/components';

import { ScheduleStage } from './habit-form-stages';
import { PlannerDateField, PlannerTimeField } from './planner-date-time-controls';
import { usePlannerHabitDetail, usePlannerServices } from './planner-provider';
import {
  buildScheduleDefinition,
  createDefaultScheduleDraft,
  formatPlannerDate,
  plannerLocalDateFromDevice,
  plannerFailureMessage,
  plannerTimezoneFromDevice,
  resolveHabitDetailRouteParams,
  scheduleDraftFromDefinition,
  scheduleSummary,
  type ScheduleDraft,
  type UiAdapterError,
} from './ui-adapters';

const STAGES = ['Start date', 'Schedule', 'Planned time', 'Review'] as const;

export function RestoreHabitScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[]; date?: string | string[] }>();
  const route = resolveHabitDetailRouteParams(params, plannerLocalDateFromDevice());
  if (!route.ok) return <Screen><InlineError message="This restore link is invalid. No data was changed." /></Screen>;
  return <RestoreHabitFlow habitId={route.habitId} initialDate={route.asOfLocalDate} onDone={() => router.back()} />;
}

function RestoreHabitFlow({ habitId, initialDate, onDone }: Readonly<{ habitId: Parameters<typeof usePlannerHabitDetail>[0]; initialDate: Parameters<typeof usePlannerHabitDetail>[1]; onDone: () => void }>) {
  const query = usePlannerHabitDetail(habitId, initialDate);
  const { restoreHabit, refreshOccurrences } = usePlannerServices();
  const timezone = useMemo(() => plannerTimezoneFromDevice(), []);
  const [stage, setStage] = useState(0);
  const [startDate, setStartDate] = useState(initialDate as string);
  const [scheduleChoice, setScheduleChoice] = useState<'previous' | 'new'>('previous');
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() => createDefaultScheduleDraft(initialDate));
  const [plannedTime, setPlannedTime] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [errors, setErrors] = useState<readonly UiAdapterError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const detail = query.data;
    if (detail === null) return;
    if (detail.currentSchedule !== null) setScheduleDraft(scheduleDraftFromDefinition(detail.currentSchedule.definition));
    setPlannedTime(detail.currentPlannedTime.plannedLocalTime ?? '');
  }, [query.data]);

  const detail = query.data;
  const range = { activeFrom: startDate, activeTo: detail?.habit.activeRange.effectiveTo ?? '' };
  const builtSchedule = buildScheduleDefinition(scheduleDraft, range, timezone);
  const parsedStartDate = parsePlannerLocalDate(startDate);
  const previousSchedule: ScheduleDefinition | null = detail?.currentSchedule === null || detail?.currentSchedule === undefined
    ? null
    : Object.freeze({
        ...detail.currentSchedule.definition,
        effectiveRange: Object.freeze({
          effectiveFrom: parsedStartDate.ok ? parsedStartDate.value : detail.currentSchedule.definition.effectiveRange.effectiveFrom,
          effectiveTo: detail.habit.activeRange.effectiveTo,
        }),
      });

  const continueFlow = () => {
    setSaveError(null);
    if (stage === 0) {
      const parsed = parsePlannerLocalDate(startDate);
      if (!parsed.ok) { setErrors([{ field: 'startDate', message: 'Enter a valid start date as YYYY-MM-DD.' }]); return; }
    }
    if (stage === 1 && scheduleChoice === 'new' && !builtSchedule.ok) { setErrors(builtSchedule.errors); return; }
    setErrors([]);
    setStage((current) => Math.min(STAGES.length - 1, current + 1));
  };

  const save = async () => {
    const parsedDate = parsePlannerLocalDate(startDate);
    const schedule = scheduleChoice === 'previous' ? previousSchedule : builtSchedule.ok ? builtSchedule.value : null;
    if (!parsedDate.ok || schedule === null) {
      setSaveError(scheduleChoice === 'previous' ? 'No previous independent schedule is available. Choose and configure a new schedule.' : 'Review the schedule before restoring.');
      return;
    }
    setSaving(true); setSaveError(null);
    const result = await restoreHabit({
      habitId,
      effectiveLocalDate: parsedDate.value,
      boundaryTimezone: timezone,
      restoreSchedule: schedule,
      restorePlannedLocalTime: plannedTime.trim() === '' ? null : plannedTime.trim(),
    });
    setSaving(false);
    if (!result.ok) { reportPlannerFailure('restoreHabitWithSchedule', result.error.code, [habitId]); setSaveError(plannerFailureMessage(result.error.code)); return; }
    if (result.value.outcome === 'schedule_required') { setSaveError('This habit still needs a valid independent schedule. Review the schedule and try again. No data was changed.'); return; }
    refreshOccurrences(); onDone();
  };

  if (query.status === 'loading' && detail === null) return <Screen><LoadingState label="Preparing restore options" /></Screen>;
  if (query.status === 'error') return <Screen><InlineError message="Restore options could not be read safely. No data was changed. Retry from Archived Habits." /></Screen>;
  if (detail === null) return <Screen><InlineError message="This archived habit could not be found. No data was changed." /></Screen>;

  return <WizardShell
    continueDisabled={saving}
    continueLabel={stage === STAGES.length - 1 ? saving ? 'Restoring…' : 'Restore habit' : 'Continue'}
    onBack={() => stage === 0 ? onDone() : setStage((current) => current - 1)}
    onCancel={onDone}
    onContinue={() => stage === STAGES.length - 1 ? void save() : continueFlow()}
    stage={STAGES[stage]}
    stageCount={STAGES.length}
    stageNumber={stage + 1}
  >
    <Card><SectionHeader title={`Restore ${detail.habit.name}`} /><BodyText secondary>This habit no longer has an active schedule. Choose when it should appear after restoring. Its history remains, and former parent relationships will not reopen.</BodyText></Card>
    {stage === 0 ? <Card><PlannerDateField label="Restore from" value={startDate} onChange={(value) => { setStartDate(value); setErrors([]); }} />{errors.map((error) => <InlineError key={error.field} message={error.message} />)}</Card> : null}
    {stage === 1 ? <><Card><SectionHeader title="Schedule source" />{previousSchedule === null ? null : <SelectionRow title="Use previous independent schedule" description={scheduleSummary(previousSchedule)} selected={scheduleChoice === 'previous'} onPress={() => setScheduleChoice('previous')} />}<SelectionRow title="Configure a new independent schedule" description="Choose when this habit should appear after restoring." selected={scheduleChoice === 'new'} onPress={() => setScheduleChoice('new')} /></Card>{scheduleChoice === 'new' ? <ScheduleStage draft={scheduleDraft} errors={errors} onChange={setScheduleDraft} showAdvanced={advanced} onShowAdvanced={() => setAdvanced((value) => !value)} summary={builtSchedule.ok ? scheduleSummary(builtSchedule.value) : null} /> : null}</> : null}
    {stage === 2 ? <Card><SectionHeader title="Planned time" /><PlannerTimeField value={plannedTime} onChange={setPlannedTime} /><BodyText secondary>Planned time controls ordering only. It does not create a reminder or completion.</BodyText></Card> : null}
    {stage === 3 ? <Card><SectionHeader title="Review restore" /><BodyText>{formatPlannerDate(parsedStartDate.ok ? parsedStartDate.value : initialDate)}</BodyText><BodyText>{scheduleChoice === 'previous' && previousSchedule !== null ? scheduleSummary(previousSchedule) : builtSchedule.ok ? scheduleSummary(builtSchedule.value) : 'Schedule needs attention'}</BodyText><BodyText>{plannedTime.trim() || 'All day'}</BodyText><BodyText secondary>Restore, schedule, and planned time save atomically. A failure changes nothing.</BodyText></Card> : null}
    {saveError === null ? null : <InlineError message={saveError} />}
  </WizardShell>;
}
