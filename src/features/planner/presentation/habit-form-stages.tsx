import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  HABIT_ACCENT_KEYS,
  habitAccentPresentationFallback,
  habitAccentKeyForId,
  habitIconKeyForTrackingMode,
  type HabitIconKey,
  type HabitIconIdentity,
  type ImportanceLevel,
  type RegisteredHabitSymbolKey,
  type ScheduleType,
  type TrackingMode,
} from '@/src/features/planner';
import {
  BodyText,
  Card,
  InlineError,
  NumberField,
  SecondaryButton,
  SectionHeader,
  SelectionRow,
  TextField,
} from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { PlannerDateField } from './planner-date-time-controls';
import { HabitIdentityPicker, HabitIconPicker, accentLabel, habitIdentitySummary, iconLabel, type HabitIdentityPickerDraft } from './habit-identity-controls';
import { HabitIdentityMark, HabitVisualPreview } from './habit-visual-components';
import { ComparisonSelector, PrioritySegmentedControl, UnitSelectionField } from './planner-form-controls';
import {
  SCHEDULE_LABELS,
  TRACKING_LABELS,
  type ParentHabitDraft,
  type ScheduleDraft,
  type TrackingDraft,
  type UiAdapterError,
} from './ui-adapters';

/**
 * The habit-form stages, now used by **Restore** alone.
 *
 * They began in `create-habit-screen.tsx` and outlived it twice. The Create
 * redesign moved them here rather than deleting them, because the editor and the
 * template preview still rendered them; both of those are gone now — the editor is
 * the create sheet in its other mode (PD-EDIT-005) and the template catalogue was
 * removed — and what is left is `ScheduleStage`, which Restore needs to give a
 * returning habit the schedule its restoration requires.
 *
 * The rest is kept deliberately: PD-TRACK-002 guarantees a saved counter, quantity
 * or duration habit stays editable, and the edit path still carries that definition
 * through untouched even though no surface displays it.
 */

const BASIC_SCHEDULES: readonly ScheduleType[] = ['daily', 'selected_weekdays'];
const ADVANCED_SCHEDULES: readonly ScheduleType[] = [
  'every_n_days', 'times_per_week', 'times_per_month', 'times_per_year', 'weekly', 'monthly', 'yearly',
];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export function HabitIdentityStage({ draft, onChange, allowAutomatic = true, extendedIdentity = true }: { readonly draft: ParentHabitDraft; readonly onChange: (draft: ParentHabitDraft) => void; readonly allowAutomatic?: boolean; readonly extendedIdentity?: boolean }) {
  const theme = useLifePlannerTheme();
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [identityPickerOpen, setIdentityPickerOpen] = useState(false);
  const automaticIcon = habitIconKeyForTrackingMode(draft.tracking.trackingMode);
  const automaticAccent = draft.accentKey ?? habitAccentKeyForId(`draft:${draft.activeRange.activeFrom}:${draft.name.trim() || 'habit'}`);
  const iconMode = allowAutomatic && draft.iconEmoji == null && draft.iconSymbolKey == null && (draft.iconSelection === 'automatic' || draft.iconSelection === undefined && (draft.iconKey === null || draft.iconKey === undefined)) ? 'automatic' : 'explicit';
  const accentMode = allowAutomatic && (draft.accentSelection === 'automatic' || draft.accentSelection === undefined && (draft.accentKey === null || draft.accentKey === undefined)) ? 'automatic' : 'explicit';
  const previewIcon: RegisteredHabitSymbolKey = iconMode === 'automatic' ? automaticIcon : draft.iconSymbolKey ?? draft.iconKey ?? automaticIcon;
  const previewAccent = accentMode === 'automatic' ? automaticAccent : draft.persistedAccentKey ?? draft.accentKey ?? automaticAccent;
  const pickerDraft: HabitIdentityPickerDraft = {
    iconMode,
    iconSymbolKey: previewIcon,
    iconEmoji: iconMode === 'explicit' ? draft.iconEmoji ?? null : null,
    accentMode,
    accentKey: previewAccent,
  };
  if (extendedIdentity) return <>
    <Pressable accessibilityLabel={`Icon and colour, ${habitIdentitySummary(pickerDraft)}`} accessibilityRole="button" onPress={() => setIdentityPickerOpen(true)} style={({ pressed }) => [styles.identitySummaryRow, { backgroundColor: pressed ? theme.colors.accentSubtle : theme.colors.groupedBackground }]}>
      <HabitIdentityMark accentKey={previewAccent} child iconIdentity={draft.iconEmoji == null ? { kind: 'symbol', symbolKey: previewIcon } : { kind: 'emoji', emoji: draft.iconEmoji as Extract<HabitIconIdentity, { kind: 'emoji' }>['emoji'] }} seed={draft.name || 'habit'} />
      <View style={styles.identityChoiceCopy}><Text style={[theme.typography.label, { color: theme.colors.text }]}>Icon and colour</Text><Text numberOfLines={2} style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{habitIdentitySummary(pickerDraft)}</Text></View>
      <View accessibilityElementsHidden style={[styles.compactSwatch, { backgroundColor: theme.habitAccents[previewAccent].selectedSwatch }]} />
      <Ionicons accessibilityElementsHidden color={theme.colors.tertiaryText} name="chevron-forward" size={18} />
    </Pressable>
    {identityPickerOpen ? <HabitIdentityPicker automaticAccentKey={automaticAccent} automaticIconKey={automaticIcon} onCancel={() => setIdentityPickerOpen(false)} onDone={(next) => {
      setIdentityPickerOpen(false);
      onChange({
        ...draft,
        iconEmoji: next.iconMode === 'explicit' ? next.iconEmoji : null,
        iconSymbolKey: next.iconMode === 'explicit' && next.iconEmoji === null ? next.iconSymbolKey : null,
        iconKey: null,
        iconSelection: next.iconMode,
        persistedAccentKey: next.accentMode === 'explicit' ? next.accentKey : null,
        accentKey: next.accentMode === 'automatic' ? automaticAccent : habitAccentPresentationFallback(next.accentKey),
        accentSelection: next.accentMode,
      });
    }} title={draft.name} value={pickerDraft} /> : null}
  </>;
  return <View style={{ gap: theme.spacing.sm }}>
    <HabitVisualPreview accentKey={previewAccent} iconKey={previewIcon} sampleProgress={0} title={draft.name} />
    <SecondaryButton title={`Icon · ${iconMode === 'automatic' ? 'Automatic' : iconLabel(previewIcon)}`} onPress={() => setIconPickerOpen(true)} />
    <View accessibilityLabel="Habit colour palette" style={styles.directSwatches}>{HABIT_ACCENT_KEYS.map((key) => { const swatch = theme.habitAccents[key]; const selected = accentMode === 'explicit' && draft.accentKey === key; return <Pressable key={key} accessibilityLabel={`${accentLabel(key)} colour`} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onChange({ ...draft, persistedAccentKey: null, accentKey: key, accentSelection: 'explicit' })} style={styles.directSwatchTarget}><View style={[styles.directSwatch, { backgroundColor: swatch.selectedSwatch, borderColor: selected ? theme.colors.focus : swatch.border, borderWidth: selected ? 3 : 1 }]}>{selected ? <Ionicons color={theme.colors.onAccent} name="checkmark" size={18} /> : null}</View><Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{accentLabel(key)}</Text></Pressable>; })}</View>
    {allowAutomatic ? <SecondaryButton title={`Automatic colour · ${accentLabel(automaticAccent)}`} onPress={() => onChange({ ...draft, persistedAccentKey: null, accentKey: automaticAccent, accentSelection: 'automatic' })} /> : null}
    {iconPickerOpen ? <HabitIconPicker accentKey={previewAccent} allowAutomatic={allowAutomatic} automaticKey={automaticIcon} legacyOnly onCancel={() => setIconPickerOpen(false)} onDone={({ mode, key }) => { setIconPickerOpen(false); onChange({ ...draft, iconEmoji: null, iconSymbolKey: null, iconKey: key as HabitIconKey, iconSelection: mode }); }} selectedKey={previewIcon} selectionMode={iconMode} title={draft.name} /> : null}
  </View>;
}

export function ScheduleStage({ draft, errors, onChange, showAdvanced, onShowAdvanced, summary }: {
  readonly draft: ScheduleDraft;
  readonly errors: readonly UiAdapterError[];
  readonly onChange: (draft: ScheduleDraft) => void;
  readonly showAdvanced: boolean;
  readonly onShowAdvanced: () => void;
  readonly summary: string | null;
}) {
  const isAdvancedSchedule = ADVANCED_SCHEDULES.includes(draft.scheduleType);
  return (
    <>
      <Card>
        <SectionHeader title="When should it be expected?" />
        {BASIC_SCHEDULES.map((scheduleType) => (
          <SelectionRow
            key={scheduleType}
            onPress={() => onChange({ ...draft, scheduleType })}
            selected={draft.scheduleType === scheduleType}
            title={SCHEDULE_LABELS[scheduleType]}
          />
        ))}
        <SelectionRow description="More recurrence choices" onPress={onShowAdvanced} selected={isAdvancedSchedule} title="Custom / Advanced" />
        {showAdvanced ? ADVANCED_SCHEDULES.map((scheduleType) => <SelectionRow key={scheduleType} onPress={() => onChange({ ...draft, scheduleType })} selected={draft.scheduleType === scheduleType} title={SCHEDULE_LABELS[scheduleType]} />) : null}
      </Card>
      <ScheduleConditionalFields draft={draft} errors={errors} onChange={onChange} />
      <Card>
        <SectionHeader title="Schedule summary" />
        <BodyText>{summary ?? 'Complete the schedule fields to see a summary.'}</BodyText>
        {draft.scheduleType === 'monthly' && Number(draft.monthDay) >= 29 ? <BodyText secondary>Shorter months use their last valid day.</BodyText> : null}
        {draft.scheduleType === 'yearly' && draft.monthNumber === '2' && draft.monthDay === '29' ? <BodyText secondary>Non-leap years use 28 February.</BodyText> : null}
        {draft.scheduleType.startsWith('times_per_') ? <BodyText secondary>Open periods remain provisional until their calendar period closes.</BodyText> : null}
      </Card>
    </>
  );
}

function ScheduleConditionalFields({ draft, errors, onChange }: { readonly draft: ScheduleDraft; readonly errors: readonly UiAdapterError[]; readonly onChange: (draft: ScheduleDraft) => void }) {
  if (draft.scheduleType === 'daily') return null;
  if (draft.scheduleType === 'selected_weekdays') {
    return (
      <Card>
        <SectionHeader title="Weekdays" />
        {WEEKDAYS.map((name, index) => {
          const day = index + 1;
          const selected = draft.selectedWeekdays.includes(day);
          return <SelectionRow key={name} title={name} selected={selected} onPress={() => onChange({ ...draft, selectedWeekdays: selected ? draft.selectedWeekdays.filter((item) => item !== day) : [...draft.selectedWeekdays, day] })} />;
        })}
        {fieldError(errors, 'selectedWeekdays') === undefined ? null : <InlineError message={fieldError(errors, 'selectedWeekdays')!} />}
      </Card>
    );
  }
  if (draft.scheduleType === 'every_n_days') {
    return <Card><NumberField error={fieldError(errors, 'intervalDays')} label="Interval in days" onChangeText={(intervalDays) => onChange({ ...draft, intervalDays })} value={draft.intervalDays} /><PlannerDateField label="Anchor date" value={draft.anchorDate} onChange={(anchorDate) => onChange({ ...draft, anchorDate })} /></Card>;
  }
  if (draft.scheduleType === 'times_per_week') {
    return <Card><NumberField error={fieldError(errors, 'periodTargetCount')} label="Times per week" onChangeText={(periodTargetCount) => onChange({ ...draft, periodTargetCount })} value={draft.periodTargetCount} /><WeekdayChoice label="Week starts" selected={draft.weekStart} onChange={(weekStart) => onChange({ ...draft, weekStart })} /></Card>;
  }
  if (draft.scheduleType === 'times_per_month' || draft.scheduleType === 'times_per_year') {
    return <Card><NumberField error={fieldError(errors, 'periodTargetCount')} label={draft.scheduleType === 'times_per_month' ? 'Times per month' : 'Times per year'} onChangeText={(periodTargetCount) => onChange({ ...draft, periodTargetCount })} value={draft.periodTargetCount} /></Card>;
  }
  if (draft.scheduleType === 'weekly') {
    return <Card><WeekdayChoice label="Expected weekday" selected={draft.weekday} onChange={(weekday) => onChange({ ...draft, weekday })} /><WeekdayChoice label="Week starts" selected={draft.weekStart} onChange={(weekStart) => onChange({ ...draft, weekStart })} /></Card>;
  }
  if (draft.scheduleType === 'monthly') {
    return <Card><NumberField error={fieldError(errors, 'monthDay')} label="Day of month · 1–31" onChangeText={(monthDay) => onChange({ ...draft, monthDay })} value={draft.monthDay} /></Card>;
  }
  return <Card><NumberField error={fieldError(errors, 'monthNumber')} label="Month · 1–12" onChangeText={(monthNumber) => onChange({ ...draft, monthNumber })} value={draft.monthNumber} /><NumberField error={fieldError(errors, 'monthDay')} label="Day" onChangeText={(monthDay) => onChange({ ...draft, monthDay })} value={draft.monthDay} /></Card>;
}

function WeekdayChoice({ label, selected, onChange }: { readonly label: string; readonly selected: string; readonly onChange: (value: string) => void }) {
  const theme = useLifePlannerTheme();
  return <View style={{ gap: theme.spacing.xs }}><SectionHeader title={label} />{WEEKDAYS.map((name, index) => <SelectionRow key={name} title={name} selected={selected === String(index + 1)} onPress={() => onChange(String(index + 1))} />)}</View>;
}

/**
 * Legacy tracking, kept editable rather than converted.
 *
 * New habits are checkboxes (PD-TRACK-001), so this is reached only through Edit
 * on a habit saved before that decision. `lockedMode` is the only mode left: the
 * tracking-type selector is gone with the Create redesign, because offering a
 * conversion is exactly what PD-TRACK-002 forbids.
 */
export function TrackingStage({ draft, errors, onChange, summary, lockedMode = false }: { readonly draft: TrackingDraft; readonly errors: readonly UiAdapterError[]; readonly onChange: (draft: TrackingDraft) => void; readonly summary: string | null; readonly lockedMode?: boolean }) {
  return (
    <>
      <Card>
        <SectionHeader title={lockedMode ? 'Legacy tracking' : 'How will it be tracked?'} />
        <BodyText>{TRACKING_LABELS[draft.trackingMode]}</BodyText>
        <BodyText secondary>This existing metric remains editable without offering a tracking-type conversion.</BodyText>
      </Card>
      <TrackingConditionalFields key={draft.trackingMode} draft={draft} errors={errors} onChange={onChange} />
      <Card><SectionHeader title="Completion rule" /><BodyText>{summary ?? 'Complete the tracking fields to see the rule.'}</BodyText>{draft.trackingMode === 'avoidance' ? <BodyText secondary>Success explicitly means the event did not occur.</BodyText> : null}</Card>
    </>
  );
}

function TrackingConditionalFields({ draft, errors, onChange }: { readonly draft: TrackingDraft; readonly errors: readonly UiAdapterError[]; readonly onChange: (draft: TrackingDraft) => void }) {
  const theme = useLifePlannerTheme();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customDuration, setCustomDuration] = useState(() => durationPresetMinutes(draft) === null);
  if (draft.trackingMode === 'checkbox' || draft.trackingMode === 'avoidance') return null;
  const chooseDuration = (totalMinutes: number) => onChange({ ...draft, durationHours: String(Math.floor(totalMinutes / 60)), durationMinutes: String(totalMinutes % 60), durationSeconds: '0' });
  const selectedDuration = durationPresetMinutes(draft);
  return (
    <Card>
      {draft.trackingMode === 'duration' ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title="Target duration" />
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>{[15, 30, 45, 60].map((minutes) => <Pressable key={minutes} accessibilityRole="radio" accessibilityState={{ checked: !customDuration && selectedDuration === minutes }} onPress={() => { setCustomDuration(false); chooseDuration(minutes); }} style={({ pressed }) => ({ alignItems: 'center', backgroundColor: !customDuration && selectedDuration === minutes || pressed ? theme.colors.accentSubtle : 'transparent', borderColor: !customDuration && selectedDuration === minutes ? theme.colors.accent : theme.colors.border, borderRadius: theme.radii.pill, borderWidth: 1, flexGrow: 1, justifyContent: 'center', minHeight: 44, minWidth: 64, paddingHorizontal: theme.spacing.sm })}><Text style={[theme.typography.label, { color: !customDuration && selectedDuration === minutes ? theme.colors.accent : theme.colors.text }]}>{minutes} min</Text></Pressable>)}<Pressable accessibilityRole="radio" accessibilityState={{ checked: customDuration }} onPress={() => setCustomDuration(true)} style={({ pressed }) => ({ alignItems: 'center', backgroundColor: customDuration || pressed ? theme.colors.accentSubtle : 'transparent', borderColor: customDuration ? theme.colors.accent : theme.colors.border, borderRadius: theme.radii.pill, borderWidth: 1, flexGrow: 1, justifyContent: 'center', minHeight: 44, minWidth: 84, paddingHorizontal: theme.spacing.sm })}><Text style={[theme.typography.label, { color: customDuration ? theme.colors.accent : theme.colors.text }]}>Custom</Text></Pressable></View>
          {customDuration ? <><View><NumberField error={fieldError(errors, 'durationHours')} label="Hours" onChangeText={(durationHours) => onChange({ ...draft, durationHours })} value={draft.durationHours} /></View><View><NumberField error={fieldError(errors, 'durationMinutes')} label="Minutes" onChangeText={(durationMinutes) => onChange({ ...draft, durationMinutes })} value={draft.durationMinutes} /></View><View><NumberField error={fieldError(errors, 'durationSeconds')} label="Seconds" onChangeText={(durationSeconds) => onChange({ ...draft, durationSeconds })} value={draft.durationSeconds} /></View></> : null}
        </View>
      ) : <NumberField error={fieldError(errors, 'target')} keyboardType={draft.trackingMode === 'quantity' ? 'decimal-pad' : 'number-pad'} label="Target" onChangeText={(target) => onChange({ ...draft, target })} value={draft.target} />}
      {draft.trackingMode === 'duration' ? null : (
        <>
          <UnitSelectionField mode={draft.trackingMode} unitType={draft.unitType} standardUnitCode={draft.standardUnitCode} customUnitLabel={draft.customUnitLabel} onChange={(unit) => onChange({ ...draft, ...unit })} />
          {draft.unitType === 'custom' ? <TextField error={fieldError(errors, 'customUnitLabel')} label="Custom unit" onChangeText={(customUnitLabel) => onChange({ ...draft, customUnitLabel })} value={draft.customUnitLabel} /> : null}
        </>
      )}
      <SecondaryButton title={advancedOpen ? 'Hide advanced tracking' : 'Advanced'} onPress={() => setAdvancedOpen((open) => !open)} />
      {advancedOpen ? <View style={{ gap: theme.spacing.sm }}><SectionHeader title="Completion comparison" /><ComparisonSelector value={draft.comparisonOperator} onChange={(comparisonOperator) => onChange({ ...draft, comparisonOperator })} /></View> : null}
    </Card>
  );
}

function durationPresetMinutes(draft: TrackingDraft): number | null {
  if (draft.trackingMode !== 'duration') return null;
  const hours = Number(draft.durationHours);
  const minutes = Number(draft.durationMinutes);
  const seconds = Number(draft.durationSeconds);
  if (![hours, minutes, seconds].every(Number.isFinite) || seconds !== 0) return null;
  const total = hours * 60 + minutes;
  return [15, 30, 45, 60].includes(total) ? total : null;
}

export function ImportanceStage({ importance, onChange }: { readonly importance: ImportanceLevel; readonly onChange: (importance: ImportanceLevel) => void }) {
  return <Card><SectionHeader title="Importance" /><PrioritySegmentedControl value={importance} onChange={onChange} /></Card>;
}

export function fieldError(errors: readonly UiAdapterError[], field: string): string | undefined {
  return errors.find((item) => item.field === field)?.message;
}

/** Kept so a legacy metric habit reaching Edit still names its own mode. */
export type { TrackingMode };

const styles = StyleSheet.create({
  identitySummaryRow: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 10, minHeight: 56, padding: 10 },
  identityChoiceCopy: { flex: 1, gap: 2, minWidth: 0 },
  compactSwatch: { borderRadius: 10, height: 20, width: 20 },
  directSwatches: { flexDirection: 'row', flexWrap: 'wrap' },
  directSwatchTarget: { alignItems: 'center', gap: 2, minHeight: 68, justifyContent: 'center', width: '25%' },
  directSwatch: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
});
