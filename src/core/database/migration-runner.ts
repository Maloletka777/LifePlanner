import {
  DATABASE_ERROR_CODES,
  DatabaseError,
  isDatabaseError,
} from './database-error';
import type { Migration, MigrationRunnerDatabase } from './migration';
import { PLANNER_CORE_MIGRATION } from './migrations/001-planner-core';
import { SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION } from './migrations/002-scheduled-dependency-expiry';
import { PLANNER_LIFECYCLE_MIGRATION } from './migrations/003-planner-lifecycle';
import { PLANNER_SUBHABITS_TIME_MIGRATION } from './migrations/004-planner-subhabits-and-time';
import { PLANNER_VISUAL_IDENTITY_MIGRATION } from './migrations/005-planner-visual-identity';
import { PLANNER_ROUTINE_STEPS_MIGRATION } from './migrations/006-planner-routine-steps';
import { PLANNER_EXPANDED_HABIT_IDENTITY_MIGRATION } from './migrations/007-planner-expanded-habit-identity';
import { PLANNER_CHECKLIST_ITEMS_MIGRATION } from './migrations/008-planner-checklist-items';
import { PLANNER_CHECKLIST_DAY_TICKS_MIGRATION } from './migrations/009-planner-checklist-day-ticks';
import { PLANNER_CHECKLIST_SHAPE_REPAIR_MIGRATION } from './migrations/010-planner-checklist-shape-repair';
import { PLANNER_CLOSURE_RULES_MIGRATION } from './migrations/011-planner-closure-rules';
import { PLANNER_REMINDER_SCHEDULES_MIGRATION } from './migrations/012-planner-reminder-schedules';
import { PLANNER_PLANNED_DURATION_MIGRATION } from './migrations/013-planner-planned-duration';
import { PLANNER_PLANNED_BLOCK_MIGRATION } from './migrations/014-planner-planned-block';
import { PLANNER_HABIT_GROWTH_MIGRATION } from './migrations/015-planner-habit-growth';
import { EXPECTED_SCHEMA } from './schema-expectations';

const READ_USER_VERSION_SQL = 'PRAGMA user_version;';
const READ_FOREIGN_KEYS_SQL = 'PRAGMA foreign_keys;';

const MIGRATIONS: readonly Migration[] = Object.freeze([
  PLANNER_CORE_MIGRATION,
  SCHEDULED_DEPENDENCY_EXPIRY_MIGRATION,
  PLANNER_LIFECYCLE_MIGRATION,
  PLANNER_SUBHABITS_TIME_MIGRATION,
  PLANNER_VISUAL_IDENTITY_MIGRATION,
  PLANNER_ROUTINE_STEPS_MIGRATION,
  PLANNER_EXPANDED_HABIT_IDENTITY_MIGRATION,
  PLANNER_CHECKLIST_ITEMS_MIGRATION,
  PLANNER_CHECKLIST_DAY_TICKS_MIGRATION,
  PLANNER_CHECKLIST_SHAPE_REPAIR_MIGRATION,
  PLANNER_CLOSURE_RULES_MIGRATION,
  PLANNER_REMINDER_SCHEDULES_MIGRATION,
  PLANNER_PLANNED_DURATION_MIGRATION,
  PLANNER_PLANNED_BLOCK_MIGRATION,
  PLANNER_HABIT_GROWTH_MIGRATION,
]);

export const LATEST_DATABASE_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

type UserVersionRow = Readonly<{
  user_version: number;
}>;

type ForeignKeysRow = Readonly<{
  foreign_keys: number;
}>;

async function readUserVersion(
  database: MigrationRunnerDatabase,
): Promise<number> {
  const row = await database.getFirstAsync<UserVersionRow>(READ_USER_VERSION_SQL);

  if (
    row === null ||
    !Number.isInteger(row.user_version) ||
    row.user_version < 0
  ) {
    throw new DatabaseError(
      DATABASE_ERROR_CODES.MIGRATION,
      'SQLite returned an invalid application schema version.',
    );
  }

  return row.user_version;
}

async function setForeignKeyEnforcement(
  database: MigrationRunnerDatabase,
  enabled: boolean,
): Promise<void> {
  await database.execAsync(`PRAGMA foreign_keys = ${enabled ? 'ON' : 'OFF'};`);
  const row = await database.getFirstAsync<ForeignKeysRow>(
    READ_FOREIGN_KEYS_SQL,
  );
  const expectedValue = enabled ? 1 : 0;

  if (row?.foreign_keys !== expectedValue) {
    throw new DatabaseError(
      DATABASE_ERROR_CODES.MIGRATION,
      `SQLite foreign-key enforcement could not be ${enabled ? 'enabled' : 'disabled'} for migration.`,
    );
  }
}

/**
 * The runner owns its own transaction, and checks it is still standing.
 *
 * It used to hand the whole migration to `database.withTransactionAsync`, which in
 * `expo-sqlite` is `try { BEGIN; task(); COMMIT } catch { ROLLBACK; throw }` on the
 * **shared** connection — the driver's own documentation says the ordering is not
 * controlled and points at `withExclusiveTransactionAsync` for anything that cares.
 * Two consequences followed, and both were reproduced before this was written.
 *
 * A second caller entering that method while a migration is in flight fails its
 * `BEGIN` — "cannot start a transaction within a transaction" — and its `catch`
 * then issues a bare `ROLLBACK` **on the migration's transaction**. From that point
 * the migration runs in autocommit, where every remaining statement commits on its
 * own: a table created near the end of the work survives while the rebuild at the
 * start is gone, and `PRAGMA user_version` persists over the top of the wreck.
 * Reading the version back cannot detect this, because autocommit stored it
 * faithfully.
 *
 * So: refuse to start inside somebody else's transaction, and — the antidote to the
 * case above — **verify the transaction is still ours immediately before the
 * commit**. A migration that lost it fails loudly instead of half-landing.
 */
async function applyMigration(
  database: MigrationRunnerDatabase,
  migration: Migration,
): Promise<void> {
  let failed = false;
  let failure: unknown;

  if (database.isInTransactionSync?.() === true) {
    throw new DatabaseError(
      DATABASE_ERROR_CODES.MIGRATION,
      `Migration ${migration.version} found a transaction already open on the database connection.`,
    );
  }

  try {
    if (migration.requiresForeignKeysDisabled === true) {
      // SQLite's documented table-rebuild procedure requires enforcement to be
      // disabled before the transaction. The migration still runs an explicit
      // foreign_key_check before its schema-version change can commit.
      await setForeignKeyEnforcement(database, false);
    }

    // `IMMEDIATE` takes the write lock at the start rather than on first write, so
    // a migration cannot get half-way and then discover it has to wait.
    await database.execAsync('BEGIN IMMEDIATE;');

    try {
      await migration.apply(database);
      await database.execAsync(migration.setUserVersionSql);

      const appliedVersion = await readUserVersion(database);
      if (appliedVersion !== migration.version) {
        throw new DatabaseError(
          DATABASE_ERROR_CODES.MIGRATION,
          `Migration ${migration.version} did not set its schema version.`,
        );
      }

      if (database.isInTransactionSync?.() === false) {
        throw new DatabaseError(
          DATABASE_ERROR_CODES.MIGRATION,
          `Migration ${migration.version} lost its transaction before it could commit. Nothing about it can be trusted, and it has not been recorded as applied.`,
        );
      }

      await database.execAsync('COMMIT;');
    } catch (cause: unknown) {
      // Only roll back what is actually ours: after the failure above there is no
      // transaction left, and a bare ROLLBACK there is the very thing that started
      // this — it would reach whatever transaction happens to be open next.
      if (database.isInTransactionSync?.() !== false) {
        try {
          await database.execAsync('ROLLBACK;');
        } catch {
          // Nothing was left to roll back; the original cause is what matters.
        }
      }
      throw cause;
    }
  } catch (cause: unknown) {
    failed = true;
    failure = cause;
  }

  if (migration.requiresForeignKeysDisabled === true) {
    try {
      await setForeignKeyEnforcement(database, true);
    } catch (cause: unknown) {
      if (!failed) {
        failed = true;
        failure = cause;
      }
    }
  }

  if (!failed) {
    return;
  }

  if (isDatabaseError(failure)) {
    throw failure;
  }

  throw new DatabaseError(
    DATABASE_ERROR_CODES.MIGRATION,
    `Migration ${migration.version} (${migration.name}) failed.`,
    failure,
  );
}

/**
 * The schema is checked against what the application queries, not just counted.
 *
 * `user_version` is the database's own claim about itself, and the runner used to
 * take it at its word: anything at or above a migration's version was skipped. A
 * database that reached version 9 wearing the shape of version 8 therefore passed
 * startup in silence, and the first report of it was `no such column` inside a
 * feature — three screens from the cause, and two wrong diagnoses later.
 *
 * This asks the database what it actually has. It names the first divergence it
 * finds rather than counting them, because the fix for one is the fix for the
 * chain that produced it. It reads the schema only; it never repairs — repairing
 * is a migration's job, where it is versioned and verified.
 */
export async function verifyDatabaseSchema(
  database: MigrationRunnerDatabase,
): Promise<void> {
  if (database.getAllAsync === undefined) {
    throw new DatabaseError(
      DATABASE_ERROR_CODES.MIGRATION,
      'The local database schema could not be read for verification.',
    );
  }

  for (const [table, expected] of Object.entries(EXPECTED_SCHEMA)) {
    const rows = await database.getAllAsync<{ name: string }>(
      `SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`,
    );
    const actual = rows.map(({ name }) => name);

    if (actual.length === 0) {
      throw new DatabaseError(
        DATABASE_ERROR_CODES.MIGRATION,
        `The local database is missing the ${table} table.`,
      );
    }

    const missing = expected.filter((column) => !actual.includes(column));
    if (missing.length > 0) {
      throw new DatabaseError(
        DATABASE_ERROR_CODES.MIGRATION,
        `The local database's ${table} table is missing ${missing.join(', ')}.`,
      );
    }
  }
}

export async function runMigrations(
  database: MigrationRunnerDatabase,
): Promise<void> {
  let currentVersion: number;

  try {
    currentVersion = await readUserVersion(database);
  } catch (cause: unknown) {
    if (isDatabaseError(cause)) {
      throw cause;
    }

    throw new DatabaseError(
      DATABASE_ERROR_CODES.MIGRATION,
      'The current application schema version could not be read.',
      cause,
    );
  }

  if (currentVersion > LATEST_DATABASE_VERSION) {
    throw new DatabaseError(
      DATABASE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      `Database schema version ${currentVersion} is newer than supported version ${LATEST_DATABASE_VERSION}.`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }

    const expectedVersion = currentVersion + 1;
    if (migration.version !== expectedVersion) {
      throw new DatabaseError(
        DATABASE_ERROR_CODES.MIGRATION,
        `Expected migration version ${expectedVersion}, but found ${migration.version}.`,
      );
    }

    await applyMigration(database, migration);

    try {
      currentVersion = await readUserVersion(database);
    } catch (cause: unknown) {
      if (isDatabaseError(cause)) {
        throw cause;
      }

      throw new DatabaseError(
        DATABASE_ERROR_CODES.MIGRATION,
        `Migration ${migration.version} could not verify its schema version.`,
        cause,
      );
    }

    if (currentVersion !== migration.version) {
      throw new DatabaseError(
        DATABASE_ERROR_CODES.MIGRATION,
        `Migration ${migration.version} did not persist its schema version.`,
      );
    }
  }

  // Every launch, including the ones where no migration ran: a database that was
  // already at the latest version is exactly the case this exists to catch.
  await verifyDatabaseSchema(database);
}
