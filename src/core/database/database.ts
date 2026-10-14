import { Platform } from 'react-native';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import {
  DATABASE_ERROR_CODES,
  DatabaseError,
  isDatabaseError,
} from './database-error';
import { runMigrations } from './migration-runner';

export const DATABASE_FILENAME = 'lifeplanner.db';

const ENABLE_FOREIGN_KEYS_SQL = 'PRAGMA foreign_keys = ON;';
const READ_FOREIGN_KEYS_SQL = 'PRAGMA foreign_keys;';
const ENABLE_WAL_SQL = 'PRAGMA journal_mode = WAL;';
const READ_JOURNAL_MODE_SQL = 'PRAGMA journal_mode;';
const EXPECTED_FOREIGN_KEYS_VALUE = 1;
const EXPECTED_JOURNAL_MODE = 'wal';
const PLANNER_PREFERENCES_ID = 1;
const DEFAULT_PROGRESS_MODE = 'equal';
const INITIALIZE_PLANNER_PREFERENCES_SQL = `
INSERT INTO planner_preferences (
    id,
    progress_mode,
    created_at,
    updated_at
) VALUES ($id, $progressMode, $createdAt, $updatedAt)
ON CONFLICT(id) DO NOTHING;
`;
const READ_PLANNER_PREFERENCES_SQL = `
SELECT id, progress_mode
FROM planner_preferences
WHERE id = $id;
`;

type ForeignKeysRow = Readonly<{
  foreign_keys: number;
}>;

type JournalModeRow = Readonly<{
  journal_mode: string;
}>;

type PlannerPreferencesRow = Readonly<{
  id: number;
  progress_mode: 'equal' | 'weighted';
}>;

/**
 * The connection and its initialization outlive this module being re-evaluated.
 *
 * These were three module-level `let`s, and that is a hazard rather than a detail:
 * Fast Refresh re-evaluates a module and resets them, while the native database and
 * the file on disk carry on existing. A second `runMigrations` could then start over
 * a connection whose first one had not finished — and two overlapping transactions
 * on one connection is exactly how a migration ends up half-applied with its schema
 * version committed anyway.
 *
 * Holding the state on `globalThis` keeps one connection and one initialization per
 * running application, whatever the bundler does to this file. It changes nothing in
 * a release build, where the module is evaluated once.
 */
interface DatabaseRuntimeState {
  connection: Promise<SQLiteDatabase> | null;
  initialization: Promise<void> | null;
  operationTail: Promise<void>;
}

const DATABASE_STATE_KEY = '__lifePlannerDatabaseRuntimeState__';

function databaseState(): DatabaseRuntimeState {
  const container = globalThis as unknown as Record<string, DatabaseRuntimeState | undefined>;
  const existing = container[DATABASE_STATE_KEY];
  if (existing !== undefined) {
    return existing;
  }

  const created: DatabaseRuntimeState = {
    connection: null,
    initialization: null,
    operationTail: Promise.resolve(),
  };
  container[DATABASE_STATE_KEY] = created;
  return created;
}

async function configureDatabase(database: SQLiteDatabase): Promise<void> {
  await database.execAsync(ENABLE_FOREIGN_KEYS_SQL);
  const foreignKeys = await database.getFirstAsync<ForeignKeysRow>(
    READ_FOREIGN_KEYS_SQL,
  );

  if (foreignKeys?.foreign_keys !== EXPECTED_FOREIGN_KEYS_VALUE) {
    throw new Error('SQLite foreign-key enforcement is not active.');
  }

  /**
   * **WAL is asked for where WAL exists, which is every platform this application ships on.**
   *
   * The web target is not one of them and is not meant to be: it is a bench for watching the
   * interface, added because there is no iOS simulator on the machine this is developed from.
   * There `expo-sqlite` runs on `wa-sqlite`, whose store is a browser one — a write-ahead log
   * over a file is not a thing it can have, and it answers `memory`. Demanding WAL there
   * fails the open, which is what «Local data needs attention» was reporting.
   *
   * **This weakens nothing that ships.** On iOS and Android the request and the check are
   * exactly what they were, and a device that will not give WAL still refuses to start —
   * which is the guarantee the check exists for, since WAL is what makes a reader and a
   * writer safe together.
   */
  if (Platform.OS !== 'web') {
    await database.execAsync(ENABLE_WAL_SQL);
    const journalMode = await database.getFirstAsync<JournalModeRow>(
      READ_JOURNAL_MODE_SQL,
    );

    if (journalMode?.journal_mode.toLowerCase() !== EXPECTED_JOURNAL_MODE) {
      throw new Error('SQLite WAL journal mode is not active.');
    }
  }
}

async function openConfiguredDatabase(): Promise<SQLiteDatabase> {
  let database: SQLiteDatabase | null = null;

  try {
    database = await openDatabaseAsync(DATABASE_FILENAME);
    await configureDatabase(database);
    return database;
  } catch (cause: unknown) {
    if (database !== null) {
      try {
        await database.closeAsync();
      } catch {
        // The original open/configuration failure remains the actionable cause.
      }
    }

    throw new DatabaseError(
      DATABASE_ERROR_CODES.OPEN_OR_CONFIGURATION,
      'The canonical SQLite database could not be opened and configured.',
      cause,
    );
  }
}

function getDatabaseConnection(): Promise<SQLiteDatabase> {
  const state = databaseState();
  state.connection ??= openConfiguredDatabase();
  return state.connection;
}

async function initializePlannerPreferences(
  database: SQLiteDatabase,
): Promise<void> {
  try {
    await database.withTransactionAsync(async () => {
      const now = Date.now();
      await database.runAsync(INITIALIZE_PLANNER_PREFERENCES_SQL, {
        $id: PLANNER_PREFERENCES_ID,
        $progressMode: DEFAULT_PROGRESS_MODE,
        $createdAt: now,
        $updatedAt: now,
      });

      const preferences =
        await database.getFirstAsync<PlannerPreferencesRow>(
          READ_PLANNER_PREFERENCES_SQL,
          { $id: PLANNER_PREFERENCES_ID },
        );

      if (
        preferences?.id !== PLANNER_PREFERENCES_ID ||
        (preferences.progress_mode !== 'equal' &&
          preferences.progress_mode !== 'weighted')
      ) {
        throw new Error('Planner preferences were not initialized.');
      }
    });
  } catch (cause: unknown) {
    throw new DatabaseError(
      DATABASE_ERROR_CODES.INITIALIZATION,
      'Initial Planner preferences could not be prepared.',
      cause,
    );
  }
}

async function initializeCanonicalDatabase(): Promise<void> {
  const database = await getDatabaseConnection();
  await runMigrations(database);
  await initializePlannerPreferences(database);
}

async function closeFailedConnection(): Promise<void> {
  const state = databaseState();
  const failedConnectionPromise = state.connection;
  state.connection = null;

  if (failedConnectionPromise === null) {
    return;
  }

  try {
    const database = await failedConnectionPromise;
    await database.closeAsync();
  } catch {
    // Retry will reopen the same database filename; no fallback file is created.
  }
}

export function initializeDatabase(): Promise<void> {
  const state = databaseState();
  if (state.initialization === null) {
    state.initialization = initializeCanonicalDatabase().catch(
      async (cause: unknown) => {
        databaseState().initialization = null;
        await closeFailedConnection();

        if (isDatabaseError(cause)) {
          throw cause;
        }

        throw new DatabaseError(
          DATABASE_ERROR_CODES.INITIALIZATION,
          'The canonical database initialization path failed.',
          cause,
        );
      },
    );
  }

  return state.initialization;
}

export async function withDatabase<T>(
  operation: (database: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  await initializeDatabase();
  const database = await getDatabaseConnection();

  const state = databaseState();
  const queuedOperation = state.operationTail.then(() => operation(database));
  state.operationTail = queuedOperation.then(
    () => undefined,
    () => undefined,
  );
  return queuedOperation;
}
