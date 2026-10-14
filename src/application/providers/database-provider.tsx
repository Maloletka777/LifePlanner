import { type PropsWithChildren, useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';

import { useLifePlannerTheme } from '@/src/ui/theme';
import {
  DATABASE_ERROR_CODES,
  DatabaseError,
  initializeDatabase,
  isDatabaseError,
} from '@/src/core/database';

type StartupState =
  | Readonly<{ status: 'preparing' }>
  | Readonly<{ status: 'ready' }>
  | Readonly<{ status: 'error'; error: DatabaseError }>;

const PREPARING_STATE: StartupState = Object.freeze({ status: 'preparing' });
const READY_STATE: StartupState = Object.freeze({ status: 'ready' });

function toDatabaseError(error: unknown): DatabaseError {
  if (isDatabaseError(error)) {
    return error;
  }

  return new DatabaseError(
    DATABASE_ERROR_CODES.INITIALIZATION,
    'An unexpected local database initialization failure occurred.',
    error,
  );
}

export function DatabaseProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const theme = useLifePlannerTheme();
  const [startupState, setStartupState] =
    useState<StartupState>(PREPARING_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrentAttempt = true;
    setStartupState(PREPARING_STATE);

    void initializeDatabase().then(
      () => {
        if (isCurrentAttempt) {
          setStartupState(READY_STATE);
        }
      },
      (error: unknown) => {
        if (!isCurrentAttempt) {
          return;
        }

        const databaseError = toDatabaseError(error);
        console.error('LifePlanner database initialization failed.', {
          code: databaseError.code,
        });
        setStartupState({ status: 'error', error: databaseError });
      },
    );

    return () => {
      isCurrentAttempt = false;
    };
  }, [attempt]);

  if (startupState.status === 'ready') {
    return <>{children}</>;
  }

  // The startup screen is the first thing the chosen palette has to paint, so it
  // reads the same tokens every other surface does rather than the Expo template's
  // own light/dark constants.
  const ground = { backgroundColor: theme.colors.background };
  const title = [theme.typography.sectionTitle, { color: theme.colors.text }];
  const body = [theme.typography.body, styles.message, { color: theme.colors.secondaryText }];

  if (startupState.status === 'error') {
    return (
      <View accessibilityLiveRegion="polite" style={[styles.container, ground]}>
        <Text style={title}>Local data needs attention</Text>
        <Text style={body}>
          {startupState.error.userMessage} Your existing local data has not been
          reset or removed.
        </Text>
        <Button
          color={theme.colors.accent}
          onPress={() => setAttempt((currentAttempt) => currentAttempt + 1)}
          title="Retry"
        />
      </View>
    );
  }

  return (
    <View accessibilityLiveRegion="polite" style={[styles.container, ground]}>
      <ActivityIndicator accessibilityLabel="Preparing local data" color={theme.colors.accent} />
      <Text style={title}>Preparing local data</Text>
      <Text style={body}>
        LifePlanner is getting your offline data ready.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    maxWidth: 440,
    textAlign: 'center',
  },
});
