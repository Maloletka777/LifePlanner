import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_REMINDER_SCHEDULES_SCHEMA_VERSION = 12;

const TABLE_NAME = 'habit_reminder_schedules';

/**
 * What the operating system was actually told, for each reminder the person set.
 *
 * `docs/Notifications.md` draws the line this migration is built on: **a reminder row
 * stores intent, and the system identifier and its status are projections.** So this is
 * a separate table keyed by the reminder rather than four more columns on
 * `habit_reminders` — a projection that lived on the intent row would make the two
 * indistinguishable, and a reconciliation that rewrote intent to record a scheduling
 * outcome could lose the very thing it is reconciling against.
 *
 * **The intent side needed nothing.** `habit_reminders` has carried an id, a habit, an
 * absolute `trigger_local_time`, a timezone mode, `enabled` and a lifecycle since
 * Migration 001, and its unique indexes already permit **several** reminders per habit.
 * The contract's list of choices — 15/30/60 minutes before, one day before, morning-of,
 * a custom offset — is a list of ways to *arrive at* a trigger time, and Create already
 * resolves an offset against the planned time before storing it (PD-CREATE-019). None of
 * that is a new column.
 *
 * **One row per reminder, and absence means «nothing has been told to the OS».** That is
 * the contract's own `not_requested`, so a reminder written before this migration reads
 * back as exactly what it is rather than needing a backfill that would have to guess
 * whether the system had ever heard of it.
 *
 * `system_identifier` is nullable on purpose: a reminder can be `permission_required`,
 * `queued` or `failed` without the OS ever having issued one, and the column would
 * otherwise force a placeholder that reads like an identifier.
 *
 * `scheduled_for` is the local minute the request was made **for**, not when it was
 * made. It is what lets reconciliation notice that intent has moved — a habit whose
 * planned time changed has a projection pointing at a minute nobody is expecting any
 * more, and that is precisely the row to replace.
 *
 * A pure addition, like Migration 008 and 011, so the verification is about what it must
 * **not** have disturbed: every existing table is snapshotted before and compared after.
 */
const TABLE_DDL = String.raw`
CREATE TABLE habit_reminder_schedules (
  reminder_id TEXT NOT NULL PRIMARY KEY,
  system_identifier TEXT NULL CHECK (system_identifier IS NULL OR length(trim(system_identifier)) > 0),
  status TEXT NOT NULL CHECK (status IN (
      'not_requested', 'permission_required', 'queued', 'scheduled', 'failed', 'cancelled'
  )),
  scheduled_for TEXT NULL CHECK (
      scheduled_for IS NULL
      OR (scheduled_for GLOB '[0-2][0-9]:[0-5][0-9]'
          AND CAST(substr(scheduled_for, 1, 2) AS INTEGER) <= 23)
  ),
  failure_reason TEXT NULL CHECK (failure_reason IS NULL OR length(trim(failure_reason)) > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  FOREIGN KEY (reminder_id) REFERENCES habit_reminders(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX habit_reminder_schedules_status_idx ON habit_reminder_schedules(status);`;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 012 scalar verification failed.');
  return row.value;
}

async function snapshotTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 012 requires bounded row reads.');
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Migration 012 found an unsupported source table name.');
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${name}" ORDER BY rowid;`)),
    }));
  }
  return Object.freeze(snapshots);
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 11) throw new Error('Migration 012 requires source schema version 11.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 012 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 012 source integrity failed.');
  if (await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE name='${TABLE_NAME}';`) !== 0) throw new Error('Migration 012 found a pre-existing reminder schedule table.');
  // The projection points at intent, so the intent it points at has to be there.
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('habit_reminders');`) === 0) throw new Error('Migration 012 requires the reminder table.');

  const before = await snapshotTables(database);
  await database.execAsync(TABLE_DDL);

  if (
    await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('${TABLE_NAME}');`) !== 6 ||
    await scalar(database, `SELECT count(*) AS value FROM ${TABLE_NAME};`) !== 0 ||
    await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${TABLE_NAME}') WHERE "table"='habit_reminders' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1
  ) {
    throw new Error('Migration 012 reminder schedule table verification failed.');
  }

  // A pure addition may not have moved a single row of anything that was here.
  for (const snapshot of before) {
    if (database.getAllAsync === undefined) throw new Error('Migration 012 requires bounded row reads.');
    const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
    if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 012 changed preserved table ${snapshot.name}.`);
  }
  // Intent in particular is untouched: this migration records what was told to the OS
  // and has no business editing what the person asked for.
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('habit_reminders');`) !== 10) throw new Error('Migration 012 changed the reminder table.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 012 foreign-key verification failed.');
}

export const PLANNER_REMINDER_SCHEDULES_MIGRATION: Migration = Object.freeze({
  version: PLANNER_REMINDER_SCHEDULES_SCHEMA_VERSION,
  name: 'planner-reminder-schedules',
  setUserVersionSql: 'PRAGMA user_version = 12;',
  apply,
});
