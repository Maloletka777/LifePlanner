import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PlannerId, SelectedDatePlannerOccurrenceRow } from '@/src/features/planner';
import {
  BodyText,
  Card,
  InlineError,
  NumberField,
  PrimaryButton,
} from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import {
  actualTargetText,
  currentEntryValueText,
  formatPlannerDate,
  observationModalSaveDisabled,
  OBSERVATION_MODAL_KEYBOARD_POLICY,
  quantityQuickActions,
} from './ui-adapters';

export type ObservationEntryOperation = 'add' | 'correct' | 'remove';

export interface ObservationEntryDraft {
  readonly operation: ObservationEntryOperation;
  readonly selectedObservationId: PlannerId | null;
  readonly value: string;
  readonly hours: string;
  readonly minutes: string;
  readonly seconds: string;
  readonly avoidanceValue: boolean | null;
}

export function ObservationEntryModal({
  row,
  visible,
  saving,
  error,
  onCancel,
  onSave,
}: {
  readonly row: SelectedDatePlannerOccurrenceRow | null;
  readonly visible: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSave: (draft: ObservationEntryDraft) => void;
}) {
  const theme = useLifePlannerTheme();
  const [value, setValue] = useState('');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [seconds, setSeconds] = useState('0');
  const [customEntry, setCustomEntry] = useState(false);
  const [avoidanceValue, setAvoidanceValue] = useState<boolean | null>(null);
  const [operation, setOperation] = useState<ObservationEntryOperation>('add');
  const [selectedObservationId, setSelectedObservationId] = useState<PlannerId | null>(null);
  const quantityActions = row === null ? [] : quantityQuickActions(row);
  const defaultQuantityValue = quantityActions[0]?.inputValue ?? '';

  useEffect(() => {
    if (!visible) return;
    setValue(row?.trackingMode === 'counter' ? '1' : row?.trackingMode === 'quantity' ? defaultQuantityValue : '');
    setHours('0');
    setMinutes('30');
    setSeconds('0');
    setCustomEntry(false);
    setAvoidanceValue(null);
    setOperation('add');
    setSelectedObservationId(null);
  }, [defaultQuantityValue, row?.habitId, row?.trackingMode, visible]);

  if (row === null) return null;
  const mode = row.trackingMode;
  const measurable = mode === 'counter' || mode === 'quantity' || mode === 'duration';
  const selectingExistingEntry = measurable && operation !== 'add';
  const saveDisabled = observationModalSaveDisabled(saving, mode, avoidanceValue) ||
    (selectingExistingEntry && selectedObservationId === null);
  const addLabel = mode === 'counter' ? 'Add count' : mode === 'duration' ? 'Add duration' : 'Add amount';
  const saveLabel = operation === 'remove' ? 'Remove entry' : operation === 'correct' ? 'Save correction' : 'Save completion';
  const chooseDuration = (totalMinutes: number) => {
    setHours(String(Math.floor(totalMinutes / 60)));
    setMinutes(String(totalMinutes % 60));
    setSeconds('0');
    setCustomEntry(false);
  };

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? OBSERVATION_MODAL_KEYBOARD_POLICY.iosAvoidingBehavior : undefined}
        style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable accessible={false} onPress={onCancel} style={StyleSheet.absoluteFill} />
        <SafeAreaView
          accessibilityViewIsModal
          edges={['bottom']}
          style={[styles.sheet, { backgroundColor: theme.colors.elevatedSurface, borderTopLeftRadius: theme.radii.xxl, borderTopRightRadius: theme.radii.xxl }]}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardDismissMode={OBSERVATION_MODAL_KEYBOARD_POLICY.keyboardDismissMode}
            keyboardShouldPersistTaps={OBSERVATION_MODAL_KEYBOARD_POLICY.keyboardShouldPersistTaps}
          >
            <Pressable
              accessible={false}
              onPress={Keyboard.dismiss}
              style={{ gap: theme.spacing.md, padding: theme.spacing.md }}
            >
              <View style={styles.titleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[theme.typography.sectionTitle, { color: theme.colors.text }]}>{row.name}</Text>
                  <Text style={[theme.typography.callout, { color: theme.colors.secondaryText }]}>
                    {formatPlannerDate(row.commandContext.occurrenceLocalDate, 'short')}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={onCancel}>
                  <Text style={[theme.typography.body, { color: theme.colors.accent }]}>Cancel</Text>
                </Pressable>
              </View>
              <Card>
                <BodyText secondary>Current: {actualTargetText(row)}</BodyText>
                {measurable && row.currentObservation.currentEntries.length > 0 ? (
                  <View style={{ gap: theme.spacing.xs }}>
                    <BodyText>What do you want to do?</BodyText>
                    <ChoiceButton
                      selected={operation === 'add'}
                      onPress={() => { setOperation('add'); setSelectedObservationId(null); setCustomEntry(false); }}
                      label={addLabel}
                    />
                    <ChoiceButton
                      selected={operation === 'correct'}
                      onPress={() => { setOperation('correct'); setSelectedObservationId(null); setCustomEntry(true); }}
                      label="Correct entry"
                    />
                    <ChoiceButton
                      selected={operation === 'remove'}
                      onPress={() => { setOperation('remove'); setSelectedObservationId(null); }}
                      label="Remove mistaken entry"
                    />
                  </View>
                ) : null}
                {selectingExistingEntry ? (
                  <View style={{ gap: theme.spacing.xs }}>
                    <BodyText>{operation === 'remove' ? 'Choose the mistaken entry' : 'Choose the entry to correct'}</BodyText>
                    {row.currentObservation.currentEntries.map((entry, index) => (
                      <ChoiceButton
                        key={entry.currentObservationId}
                        accessibilityHint={entry.correctionCount > 0 ? `This entry has ${entry.correctionCount} prior corrections.` : undefined}
                        selected={selectedObservationId === entry.currentObservationId}
                        onPress={() => setSelectedObservationId(entry.currentObservationId)}
                        label={`Entry ${index + 1} · ${currentEntryValueText(entry, row)}`}
                      />
                    ))}
                  </View>
                ) : null}
                {operation === 'remove' ? (
                  <BodyText secondary>The original entry stays in local history and a removal correction becomes current.</BodyText>
                ) : null}
                {measurable && operation === 'add' ? <View style={{ gap: theme.spacing.xs }}><BodyText>Quick add</BodyText><View style={styles.quickActions}>
                  {mode === 'counter' ? <QuickAction label="+1" selected={!customEntry && value === '1'} onPress={() => { setValue('1'); setCustomEntry(false); }} /> : null}
                  {mode === 'quantity' ? quantityActions.map((action) => <QuickAction accessibilityLabel={action.accessibilityLabel} key={action.label} label={action.label} selected={!customEntry && value === action.inputValue} onPress={() => { setValue(action.inputValue); setCustomEntry(false); }} />) : null}
                  {mode === 'duration' ? <><QuickAction label="15 min" selected={!customEntry && hours === '0' && minutes === '15' && seconds === '0'} onPress={() => chooseDuration(15)} /><QuickAction label="30 min" selected={!customEntry && hours === '0' && minutes === '30' && seconds === '0'} onPress={() => chooseDuration(30)} /><QuickAction label="60 min" selected={!customEntry && hours === '1' && minutes === '0' && seconds === '0'} onPress={() => chooseDuration(60)} /></> : null}
                  <QuickAction label="Custom" selected={customEntry} onPress={() => setCustomEntry(true)} />
                </View></View> : null}
                {mode === 'avoidance' ? (
                  <>
                    <BodyText>What happened?</BodyText>
                    <ChoiceButton
                      selected={avoidanceValue === true}
                      onPress={() => setAvoidanceValue(true)}
                      label="Did not occur"
                    />
                    <ChoiceButton
                      selected={avoidanceValue === false}
                      onPress={() => setAvoidanceValue(false)}
                      label="Occurred"
                    />
                  </>
                ) : mode === 'duration' && operation !== 'remove' && (operation === 'correct' || customEntry) ? (
                  <View style={[styles.durationFields, { gap: theme.spacing.sm }]}>
                    <View>
                      <NumberField label="Hours" onChangeText={setHours} value={hours} />
                    </View>
                    <View>
                      <NumberField label="Minutes" onChangeText={setMinutes} value={minutes} />
                    </View>
                    <View>
                      <NumberField label="Seconds" onChangeText={setSeconds} value={seconds} />
                    </View>
                  </View>
                ) : operation !== 'remove' && (operation === 'correct' || customEntry) ? (
                  <NumberField
                    keyboardType={mode === 'quantity' ? 'decimal-pad' : 'number-pad'}
                    label={mode === 'quantity'
                      ? operation === 'correct' ? 'Corrected amount' : 'Amount to add'
                      : operation === 'correct' ? 'Corrected count' : 'Count to add'}
                    onChangeText={setValue}
                    value={value}
                  />
                ) : null}
              </Card>
              {error === null ? null : <InlineError message={error} />}
              <PrimaryButton
                disabled={saveDisabled}
                onPress={() => onSave({ operation, selectedObservationId, value, hours, minutes, seconds, avoidanceValue })}
                title={saving ? 'Saving…' : saveLabel}
              />
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ChoiceButton({ accessibilityHint, label, selected, onPress }: { readonly accessibilityHint?: string; readonly label: string; readonly selected: boolean; readonly onPress: () => void }) {
  const theme = useLifePlannerTheme();
  return <Pressable accessibilityHint={accessibilityHint} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.choiceButton, { backgroundColor: selected || pressed ? theme.colors.accentSubtle : 'transparent', borderColor: selected ? theme.colors.accent : theme.colors.strongBorder }]}><Text style={[theme.typography.label, { color: selected ? theme.colors.accent : theme.colors.text }]}>{label}</Text></Pressable>;
}

function QuickAction({ accessibilityLabel, label, selected, onPress }: { readonly accessibilityLabel?: string; readonly label: string; readonly selected: boolean; readonly onPress: () => void }) {
  const theme = useLifePlannerTheme();
  return <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.quickAction, { backgroundColor: selected || pressed ? theme.colors.accentSubtle : 'transparent', borderColor: selected ? theme.colors.accent : theme.colors.border }]}><Text style={[theme.typography.label, { color: selected ? theme.colors.accent : theme.colors.text }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', overflow: 'hidden' },
  scrollContent: { flexGrow: 1 },
  titleRow: { alignItems: 'center', flexDirection: 'row' },
  durationFields: {},
  choiceButton: { borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickAction: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexGrow: 1, justifyContent: 'center', minHeight: 44, minWidth: 72, paddingHorizontal: 12 },
});
