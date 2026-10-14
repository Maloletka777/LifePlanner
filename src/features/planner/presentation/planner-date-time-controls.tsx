import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InlineError, PrimaryButton, SecondaryButton, TextField } from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { constrainPlannerDateEntry, formatPlannerDateEntry, movePlannerMonth, parsePlannerDateEntry, plannerMonthGrid } from './ui-adapters';

export function PlannerDateField({ label, value, optional = false, minimumDate, maximumDate, onChange }: { readonly label: string; readonly value: string; readonly optional?: boolean; readonly minimumDate?: string; readonly maximumDate?: string; readonly onChange: (value: string) => void }) {
  const theme = useLifePlannerTheme();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(value);
  const [manual, setManual] = useState(value === '' ? '' : formatPlannerDateEntry(value));
  const [error, setError] = useState<string | null>(null);
  const [excessiveInput, setExcessiveInput] = useState(false);
  const [editingManual, setEditingManual] = useState(false);
  const initial = parsePlannerDateEntry(value || minimumDate || '2000-01-01');
  const [visibleMonth, setVisibleMonth] = useState(() => ({ year: initial.ok ? Number(initial.value.slice(0, 4)) : 2000, month: initial.ok ? Number(initial.value.slice(5, 7)) : 1 }));
  const parsedMinimum = minimumDate === undefined ? null : parsePlannerDateEntry(minimumDate);
  const parsedMaximum = maximumDate === undefined ? null : parsePlannerDateEntry(maximumDate);

  useEffect(() => {
    if (!visible) {
      setDraft(value);
      setManual(value === '' ? '' : formatPlannerDateEntry(value));
      setError(null);
      setExcessiveInput(false);
      setEditingManual(false);
      const parsed = parsePlannerDateEntry(value || minimumDate || '2000-01-01');
      if (parsed.ok) setVisibleMonth({ year: Number(parsed.value.slice(0, 4)), month: Number(parsed.value.slice(5, 7)) });
    }
  }, [minimumDate, value, visible]);

  const validate = (input: string) => {
    if (optional && input.trim() === '') return { ok: true as const, value: '' };
    const result = parsePlannerDateEntry(input);
    if (!result.ok) return result;
    if (parsedMinimum?.ok && result.value < parsedMinimum.value) return { ok: false as const, message: `Choose ${formatPlannerDateEntry(parsedMinimum.value)} or later.` };
    if (parsedMaximum?.ok && result.value > parsedMaximum.value) return { ok: false as const, message: `Choose ${formatPlannerDateEntry(parsedMaximum.value)} or earlier.` };
    return result;
  };
  const applyManual = () => {
    if (excessiveInput) { setError('A pasted date cannot contain more than eight digits.'); return false; }
    const result = validate(manual);
    if (!result.ok) { setError(result.message); return false; }
    setDraft(result.value);
    setManual(result.value === '' ? '' : formatPlannerDateEntry(result.value));
    if (result.value !== '') setVisibleMonth({ year: Number(result.value.slice(0, 4)), month: Number(result.value.slice(5, 7)) });
    setError(null); setExcessiveInput(false);
    return true;
  };
  const done = () => {
    const result = validate(draft || manual);
    if (!result.ok) { setError(result.message); return; }
    onChange(result.value);
    setVisible(false);
  };
  const selectDay = (date: string) => {
    const result = validate(date);
    if (!result.ok) return;
    setDraft(result.value);
    setManual(formatPlannerDateEntry(result.value));
    setError(null);
  };

  const cells = plannerMonthGrid(visibleMonth.year, visibleMonth.month);
  const monthTitle = new Date(visibleMonth.year, visibleMonth.month - 1, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return <>
    <View style={{ gap: theme.spacing.xs }}><Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value === '' ? 'No end date' : formatPlannerDateEntry(value)}`} onPress={() => setVisible(true)} style={({ pressed }) => [styles.fieldRow, { backgroundColor: pressed ? theme.colors.accentSubtle : theme.colors.inputSurface, borderColor: theme.colors.border, borderRadius: theme.radii.md }]}><Text style={[theme.typography.body, { color: value === '' ? theme.colors.tertiaryText : theme.colors.text, flex: 1 }]}>{value === '' ? 'No end date' : formatPlannerDateEntry(value)}</Text><Ionicons color={theme.colors.secondaryText} name="calendar-outline" size={22} /></Pressable></View>
    <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={() => setVisible(false)}><SafeAreaView style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.sheetHeader, editingManual && styles.hiddenActions]} pointerEvents={editingManual ? 'none' : 'auto'}><SecondaryButton title="Cancel" onPress={() => setVisible(false)} /><Text style={[theme.typography.headline, { color: theme.colors.text }]}>{label}</Text><PrimaryButton title="Done" onPress={done} /></View>
      <View style={styles.monthHeader}><Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setVisibleMonth(movePlannerMonth(visibleMonth.year, visibleMonth.month, -1))} style={styles.monthAction}><Ionicons color={theme.colors.accent} name="chevron-back" size={24} /></Pressable><Text accessibilityRole="header" style={[theme.typography.headline, { color: theme.colors.text }]}>{monthTitle}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setVisibleMonth(movePlannerMonth(visibleMonth.year, visibleMonth.month, 1))} style={styles.monthAction}><Ionicons color={theme.colors.accent} name="chevron-forward" size={24} /></Pressable></View>
      <View style={styles.calendarGrid}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <Text key={day} style={[styles.calendarCell, theme.typography.caption, { color: theme.colors.tertiaryText }]}>{day}</Text>)}{cells.map((date, index) => date === null ? <View key={`blank-${index}`} style={styles.calendarCell} /> : <Pressable key={date} accessibilityRole="button" accessibilityLabel={formatPlannerDateEntry(date)} accessibilityState={{ selected: date === draft, disabled: parsedMinimum?.ok && date < parsedMinimum.value || parsedMaximum?.ok && date > parsedMaximum.value }} disabled={parsedMinimum?.ok && date < parsedMinimum.value || parsedMaximum?.ok && date > parsedMaximum.value} onPress={() => selectDay(date)} style={[styles.calendarCell, date === draft && { backgroundColor: theme.colors.accent, borderRadius: 22 }]}><Text style={[theme.typography.body, { color: date === draft ? theme.colors.onAccent : theme.colors.text }]}>{Number(date.slice(8, 10))}</Text></Pressable>)}</View>
      <TextField keyboardType="number-pad" label="Enter date" value={manual} placeholder="DD.MM.YYYY" selectTextOnFocus onFocus={() => setEditingManual(true)} onBlur={() => setEditingManual(false)} onChangeText={(next) => { const constrained = constrainPlannerDateEntry(manual, next); setManual(constrained.value); setExcessiveInput(constrained.excessive); setError(constrained.excessive ? 'A date can contain at most eight digits.' : null); }} onEditDone={applyManual} />
      {error === null ? null : <InlineError message={error} />}{optional ? <SecondaryButton title="No end date" onPress={() => { setDraft(''); setManual(''); setError(null); }} /> : null}
    </SafeAreaView></Modal>
  </>;
}

export function PlannerTimeField({ label = 'Planned time', value, onChange }: { readonly label?: string; readonly value: string; readonly onChange: (value: string) => void }) {
  const theme = useLifePlannerTheme(); const [visible, setVisible] = useState(false); const [draft, setDraft] = useState(value);
  useEffect(() => { if (!visible) setDraft(value); }, [value, visible]);
  const [hours, minutes] = (draft || '07:00').split(':').map(Number); const pickerValue = new Date(2000, 0, 1, hours, minutes, 0, 0);
  return <><View style={{ gap: theme.spacing.xs }}><Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value || 'All day'}`} onPress={() => setVisible(true)} style={({ pressed }) => [styles.fieldRow, { backgroundColor: pressed ? theme.colors.accentSubtle : theme.colors.inputSurface, borderColor: theme.colors.border, borderRadius: theme.radii.md }]}><Text style={[theme.typography.body, { color: value === '' ? theme.colors.tertiaryText : theme.colors.text, flex: 1 }]}>{value || 'All day'}</Text><Ionicons color={theme.colors.secondaryText} name="time-outline" size={22} /></Pressable></View><Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={() => setVisible(false)}><SafeAreaView style={[styles.sheet, { backgroundColor: theme.colors.background }]}><View style={styles.sheetHeader}><SecondaryButton title="Cancel" onPress={() => setVisible(false)} /><Text style={[theme.typography.headline, { color: theme.colors.text }]}>{label}</Text><PrimaryButton title="Done" onPress={() => { onChange(draft); setVisible(false); }} /></View><DateTimePicker display={Platform.OS === 'ios' ? 'spinner' : 'default'} mode="time" themeVariant={theme.dark ? 'dark' : 'light'} value={pickerValue} onChange={(_, date) => { if (date === undefined) return; setDraft(`${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`); }} /><SecondaryButton title="All day" onPress={() => setDraft('')} /></SafeAreaView></Modal></>;
}

const styles = StyleSheet.create({ fieldRow: { alignItems: 'center', borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 52, paddingHorizontal: 12 }, sheet: { flex: 1, gap: 16, padding: 16 }, sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, hiddenActions: { opacity: 0 }, monthHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, monthAction: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, calendarCell: { alignItems: 'center', height: 44, justifyContent: 'center', textAlign: 'center', width: '14.2857%' } });
