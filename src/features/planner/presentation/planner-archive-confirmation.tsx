import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyText, Card, DestructiveButton, InlineError, SecondaryButton } from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

export function PlannerArchiveConfirmation({
  visible,
  habitName,
  message,
  pending,
  error,
  onCancel,
  onConfirm,
  onDismissError,
}: {
  readonly visible: boolean;
  readonly habitName: string;
  readonly message: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onDismissError: () => void;
}) {
  const theme = useLifePlannerTheme();
  return <Modal animationType="fade" onRequestClose={() => { if (!pending) onCancel(); }} transparent visible={visible}>
    <SafeAreaView accessibilityViewIsModal style={styles.overlay}>
      <Card style={styles.card}>
        <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text }]}>Archive {habitName}?</Text>
        <BodyText>{message}</BodyText>
        {pending ? <Text accessibilityLiveRegion="polite" style={[theme.typography.callout, { color: theme.colors.secondaryText }]}>Archiving…</Text> : null}
        {error === null ? null : <View accessibilityLiveRegion="assertive" style={styles.error}><InlineError message={error} /><SecondaryButton title="Dismiss error" onPress={onDismissError} /></View>}
        <View style={styles.actions}>
          <SecondaryButton disabled={pending} title="Cancel" onPress={onCancel} />
          <DestructiveButton disabled={pending} title={pending ? 'Archiving…' : 'Archive'} onPress={onConfirm} />
        </View>
      </Card>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'stretch', backgroundColor: 'rgba(0, 0, 0, 0.45)', flex: 1, justifyContent: 'center', padding: 20 },
  card: { alignSelf: 'center', maxWidth: 520, width: '100%' },
  actions: { gap: 10 },
  error: { gap: 8 },
});
