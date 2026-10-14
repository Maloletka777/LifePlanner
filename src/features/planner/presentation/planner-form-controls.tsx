import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { standardUnitLabel, type ImportanceLevel, type NumericComparisonOperator, type StandardUnitCode, type TrackingMode } from '@/src/features/planner';
import { PrimaryButton, SecondaryButton, TextField } from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { compatibleUnitGroups, IMPORTANCE_STOPS, type UnitChoice } from './planner-form-control-model';
import { IMPORTANCE_LABELS } from './ui-adapters';

export function PrioritySegmentedControl({ value, onChange }: { readonly value: ImportanceLevel; readonly onChange: (value: ImportanceLevel) => void }) {
  const theme = useLifePlannerTheme();
  return <View style={styles.priorityRoot}>
    <View accessibilityLabel="Importance" accessibilityRole="radiogroup" style={[styles.prioritySegment, { borderColor: theme.colors.border }]}>{IMPORTANCE_STOPS.map((stop, index) => {
      const selected = value === stop;
      return <Pressable key={stop} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => { if (!selected) { onChange(stop); void Haptics.selectionAsync(); } }} style={({ pressed }) => [styles.priorityChoice, index === 0 ? null : { borderLeftColor: theme.colors.border, borderLeftWidth: StyleSheet.hairlineWidth }, { backgroundColor: selected || pressed ? theme.colors.accentSubtle : 'transparent' }]}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={[theme.typography.caption, { color: selected ? theme.colors.accent : theme.colors.text, textAlign: 'center' }]}>{IMPORTANCE_LABELS[stop]}</Text></Pressable>;
    })}</View>
    <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>Higher importance helps LifePlanner surface this habit when the day is busy.</Text>
  </View>;
}

export function ComparisonSelector({ value, onChange }: { readonly value: NumericComparisonOperator; readonly onChange: (value: NumericComparisonOperator) => void }) {
  const theme = useLifePlannerTheme();
  const { fontScale, width } = useWindowDimensions();
  const vertical = fontScale >= 1.25 || width < 360;
  const options = Object.freeze([
    { value: 'at_least' as const, label: 'At least' },
    { value: 'at_most' as const, label: 'At most' },
    { value: 'equal' as const, label: 'Exactly' },
  ]);
  return <View accessibilityRole="radiogroup" style={[vertical ? styles.comparisonVertical : styles.comparisonSegment, { borderColor: theme.colors.border }]}>{options.map((option, index) => {
    const selected = option.value === value;
    return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onChange(option.value)} style={({ pressed }) => [styles.comparisonChoice, vertical ? { borderBottomColor: theme.colors.border, borderBottomWidth: index === options.length - 1 ? 0 : StyleSheet.hairlineWidth } : { borderLeftColor: theme.colors.border, borderLeftWidth: index === 0 ? 0 : StyleSheet.hairlineWidth }, { backgroundColor: selected || pressed ? theme.colors.accentSubtle : 'transparent' }]}><Ionicons accessibilityElementsHidden color={selected ? theme.colors.accent : theme.colors.tertiaryText} name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={18} /><Text style={[theme.typography.label, { color: selected ? theme.colors.accent : theme.colors.text }]}>{option.label}</Text></Pressable>;
  })}</View>;
}

export function UnitSelectionField({ mode, unitType, standardUnitCode, customUnitLabel, onChange }: { readonly mode: Extract<TrackingMode, 'counter' | 'quantity'>; readonly unitType: 'none' | 'standard' | 'custom'; readonly standardUnitCode: StandardUnitCode; readonly customUnitLabel: string; readonly onChange: (value: Readonly<{ unitType: 'none' | 'standard' | 'custom'; standardUnitCode: StandardUnitCode }>) => void }) {
  const theme = useLifePlannerTheme();
  const [open, setOpen] = useState(false);
  const label = unitType === 'none' ? 'No unit' : unitType === 'custom' ? customUnitLabel.trim() || 'Custom unit' : standardUnitLabel(standardUnitCode);
  return <View style={styles.unitRoot}>
    <Text style={[theme.typography.label, { color: theme.colors.text }]}>Unit</Text>
    <Pressable accessibilityHint="Opens compatible units" accessibilityLabel={`Unit, ${label}`} accessibilityRole="button" onPress={() => setOpen(true)} style={({ pressed }) => [styles.unitField, { backgroundColor: pressed ? theme.colors.accentSubtle : theme.colors.inputSurface, borderColor: theme.colors.border }]}><Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>{label}</Text><Ionicons accessibilityElementsHidden color={theme.colors.tertiaryText} name="chevron-forward" size={20} /></Pressable>
    {open ? <UnitSelectionSheet mode={mode} unitType={unitType} standardUnitCode={standardUnitCode} onCancel={() => setOpen(false)} onDone={(selection) => { setOpen(false); onChange(selection); }} /> : null}
  </View>;
}

function UnitSelectionSheet({ mode, unitType, standardUnitCode, onCancel, onDone }: { readonly mode: Extract<TrackingMode, 'counter' | 'quantity'>; readonly unitType: 'none' | 'standard' | 'custom'; readonly standardUnitCode: StandardUnitCode; readonly onCancel: () => void; readonly onDone: (value: Readonly<{ unitType: 'none' | 'standard' | 'custom'; standardUnitCode: StandardUnitCode }>) => void }) {
  const theme = useLifePlannerTheme();
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<UnitChoice['key']>(unitType === 'standard' ? standardUnitCode : unitType);
  const groups = compatibleUnitGroups(mode, query);
  const finish = () => onDone(selection === 'none' ? { unitType: 'none', standardUnitCode } : selection === 'custom' ? { unitType: 'custom', standardUnitCode } : { unitType: 'standard', standardUnitCode: selection });
  return <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
    <SafeAreaView accessibilityViewIsModal style={[styles.unitSheet, { backgroundColor: theme.colors.background }]}>
      <View style={styles.sheetHeader}><SecondaryButton title="Cancel" onPress={onCancel} /><Text style={[theme.typography.headline, { color: theme.colors.text }]}>Choose unit</Text><PrimaryButton title="Done" onPress={finish} /></View>
      <TextField label="Search units" placeholder="Litres, kg, pages…" returnKeyType="search" value={query} onChangeText={setQuery} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.unitList}>{groups.map((group) => <View key={group.title} style={styles.unitGroup}><Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{group.title.toLocaleUpperCase()}</Text>{group.choices.map((choice) => {
        const selected = selection === choice.key;
        return <Pressable key={choice.key} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => setSelection(choice.key)} style={({ pressed }) => [styles.unitChoice, { backgroundColor: selected || pressed ? theme.colors.accentSubtle : 'transparent', borderBottomColor: theme.colors.border }]}><View style={styles.flex}><Text style={[theme.typography.body, { color: theme.colors.text }]}>{choice.label}</Text>{choice.symbol === '' ? null : <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{choice.symbol}</Text>}</View><Ionicons accessibilityElementsHidden color={selected ? theme.colors.accent : theme.colors.tertiaryText} name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={20} /></Pressable>;
      })}</View>)}</ScrollView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  priorityRoot: { gap: 8 },
  prioritySegment: { borderRadius: 12, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  priorityChoice: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 44, minWidth: 0, paddingHorizontal: 4 },
  comparisonSegment: { borderRadius: 12, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  comparisonVertical: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  comparisonChoice: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  unitRoot: { gap: 6 },
  unitField: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', minHeight: 48, paddingHorizontal: 12 },
  unitSheet: { flex: 1, gap: 12, padding: 16 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  unitList: { gap: 16, paddingBottom: 24 },
  unitGroup: { gap: 2 },
  unitChoice: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 48, paddingHorizontal: 8 },
  flex: { flex: 1, minWidth: 0 },
});
