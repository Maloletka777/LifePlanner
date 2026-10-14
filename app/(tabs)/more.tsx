import { StyleSheet, Text, View } from 'react-native';

import { AppHeader, Screen, VersionBadge } from '@/src/ui/components';
import { TAB_BAR_CLEARANCE } from '@/src/ui/tab-bar';
import { applicationVersion } from '@/src/config/version';
import { useLifePlannerTheme } from '@/src/ui/theme';

/**
 * More.
 *
 * The Appearance row is gone with the picker it opened (PD-APPEARANCE-007): there
 * are two themes and the phone chooses between them, so there is nothing here to
 * choose. What replaces the row is the answer to the question it used to raise —
 * where the colour comes from — stated once, as a caption rather than as a control
 * that does nothing.
 *
 * Nothing else is listed, because nothing else in the application is configurable.
 * The design's other rows — first day of week, reminders, archive, categories,
 * export — name settings that do not exist, and a row leading nowhere is worse than
 * an empty screen.
 */
export default function MoreScreen() {
  const theme = useLifePlannerTheme();
  return (
    <Screen backgroundColor={theme.today.appSurface} contentStyle={{ paddingBottom: TAB_BAR_CLEARANCE + 22 }}>
      <AppHeader title="More" trailing={<VersionBadge {...applicationVersion} />} />
      <Text style={[styles.sectionLabel, { color: theme.today.secondaryText }]}>APPEARANCE</Text>
      <View style={[styles.card, { backgroundColor: theme.today.dashboardSurface }]}>
        <Text style={[styles.note, { color: theme.today.secondaryText }]}>
          Light and Dark follow your device. Change it in Settings, and this application changes with it.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 11, fontWeight: '500', letterSpacing: 0.6, paddingHorizontal: 4 },
  card: { borderRadius: 12, overflow: 'hidden' },
  note: { fontSize: 13, lineHeight: 18, padding: 12 },
});
