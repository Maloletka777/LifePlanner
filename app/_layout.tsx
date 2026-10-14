import { ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { configureReminderNotificationPresentation } from '@/src/features/planner';
import { DatabaseProvider } from '@/src/application/providers/database-provider';
import { PlannerProvider } from '@/src/features/planner/presentation/planner-provider';
import { AppearanceProvider, useAppearance } from '@/src/ui/theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

void SplashScreen.preventAutoHideAsync();

/**
 * At module scope, beside the splash screen, and for the same reason.
 *
 * iOS hands a notification that arrives while the application is open to the application
 * and shows nothing itself; a handler installed inside a render would be installed after
 * the first one could already have been handed over.
 */
configureReminderNotificationPresentation();

export default function RootLayout() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><AppearanceProvider><ThemedApplication /></AppearanceProvider></SafeAreaProvider>;
}

function ThemedApplication() {
  const { theme: lifePlannerTheme, ready } = useAppearance();
  useEffect(() => { if (ready) void SplashScreen.hideAsync(); }, [ready]);
  const navigationTheme: Theme = {
    // The phone decides this now (PD-APPEARANCE-007). Navigation's own theme has to
    // agree with ours or the frame around a pushed screen is the wrong ground.
    dark: lifePlannerTheme.dark,
    colors: {
      primary: lifePlannerTheme.colors.accent,
      background: lifePlannerTheme.colors.background,
      card: lifePlannerTheme.colors.elevatedSurface,
      text: lifePlannerTheme.colors.text,
      border: lifePlannerTheme.colors.border,
      notification: lifePlannerTheme.colors.info,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '700' },
      heavy: { fontFamily: 'System', fontWeight: '800' },
    },
  };

  if (!ready) return null;
  return (
      <GestureHandlerRootView style={{ flex: 1 }}><ThemeProvider value={navigationTheme}>
        <DatabaseProvider>
          <PlannerProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="planner/create" options={{ fullScreenGestureEnabled: false, gestureEnabled: true }} />
              <Stack.Screen name="planner/habits/index" options={{ fullScreenGestureEnabled: false, gestureEnabled: true }} />
              <Stack.Screen name="planner/habits/[id]" options={{ fullScreenGestureEnabled: false, gestureEnabled: true }} />
              <Stack.Screen name="planner/habits/archived" options={{ fullScreenGestureEnabled: false, gestureEnabled: true }} />
              <Stack.Screen name="planner/edit/[id]" options={{ fullScreenGestureEnabled: false, gestureEnabled: true }} />
              <Stack.Screen name="planner/habits/restore/[id]" options={{ fullScreenGestureEnabled: false, gestureEnabled: true }} />
            </Stack>
          </PlannerProvider>
        </DatabaseProvider>
        <StatusBar style={lifePlannerTheme.dark ? 'light' : 'dark'} />
      </ThemeProvider></GestureHandlerRootView>
  );
}
