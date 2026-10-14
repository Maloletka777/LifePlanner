import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_CHECKLIST_SHAPE_REPAIR_SCHEMA_VERSION = 10;

const ITEMS = 'habit_checklist_items';
const TICKS = 'habit_checklist_ticks';
const STAGING = 'habit_checklist_items_new';

/** The two shapes Migration 009 is supposed to have left behind. */
const ITEM_COLUMNS = Object.freeze(['id', 'habit_id', 'text', 'sort_order', 'created_from', 'created_at', 'deleted_from']);
const TICK_COLUMNS = Object.freeze(['checklist_item_id', 'occurrence_local_date', 'done_at']);

/**
 * A database that says it is version 9 and is shaped like version 8.
 *
 * **This repairs a measured state, not a suspected history.** A device reported
 * `no such column: item.created_from`, and the shape of that message is itself
 * evidence: the same query answers `no such table: habit_checklist_ticks` when the
 * tick table is the missing half. So that database carries the **tick table from
 * Migration 009 beside the line table from Migration 008**, with `user_version`
 * already at 9 — which is why 009 is skipped on every launch and why nothing ever
 * failed loudly. How it got there cannot be established from the repository, and
 * this migration does not pretend to know: it looks at the two tables and brings
 * whichever has diverged back to the canonical shape.
 *
 * **On a healthy database it does nothing at all** — not one DDL statement — and
 * that is asserted rather than assumed.
 *
 * **Nothing can be lost, and that is provable rather than hoped.** The only insert
 * into `habit_checklist_items` names `created_from`, so on a version 8 shape it has
 * always failed; and a tick cannot be written without first reading its line
 * through a statement that fails the same way. A diverged pair is therefore empty.
 * The rebuild carries rows regardless, because "provably empty" is a claim about
 * today's code and the carry costs one SELECT.
 *
 * Foreign keys are **deferred rather than disabled**, as Migration 007 does: the
 * tick table may hold a reference to the line table while the line table is being
 * replaced underneath it, and deferring lets the whole exchange settle before the
 * commit checks it.
 */
const CANONICAL_ITEMS_DDL = (name: string) => String.raw`
CREATE TABLE ${name} (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) > 0),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_from TEXT NOT NULL CHECK (created_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  deleted_from TEXT NULL CHECK (deleted_from IS NULL OR deleted_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND deleted_from > created_from),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

const CANONICAL_TICKS_DDL = String.raw`
CREATE TABLE habit_checklist_ticks (
  checklist_item_id TEXT NOT NULL,
  occurrence_local_date TEXT NOT NULL CHECK (occurrence_local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_at INTEGER NOT NULL CHECK (done_at >= 0),
  PRIMARY KEY (checklist_item_id, occurrence_local_date),
  FOREIGN KEY (checklist_item_id) REFERENCES habit_checklist_items(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX habit_checklist_ticks_date_idx ON habit_checklist_ticks(occurrence_local_date);`;

interface TableSnapshot {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 010 scalar verification failed.');
  return row.value;
}

async function columnsOf(database: MigrationDatabase, table: string): Promise<readonly string[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 010 requires bounded row reads.');
  const rows = await database.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid;`);
  return rows.map(({ name }) => name);
}

function sameColumns(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

async function tableExists(database: MigrationDatabase, table: string): Promise<boolean> {
  return await scalar(database, `SELECT count(*) AS value FROM sqlite_schema WHERE type='table' AND name='${table}';`) > 0;
}

/** Every table except the two being repaired, so the repair can prove its blast radius. */
async function snapshotTables(database: MigrationDatabase): Promise<readonly TableSnapshot[]> {
  if (database.getAllAsync === undefined) throw new Error('Migration 010 requires bounded row reads.');
  const names = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name NOT IN ('${ITEMS}', '${TICKS}', '${STAGING}') ORDER BY name;`,
  );
  const snapshots: TableSnapshot[] = [];
  for (const { name } of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Migration 010 found an unsupported source table name.');
    snapshots.push(Object.freeze({
      name,
      rows: Object.freeze(await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${name}" ORDER BY rowid;`)),
    }));
  }
  return Object.freeze(snapshots);
}

async function rebuildItems(database: MigrationDatabase, existing: readonly string[]): Promise<void> {
  await database.execAsync(CANONICAL_ITEMS_DDL(STAGING));
  if (existing.length > 0) {
    // A line that predates the column begins on the day it was written, read in
    // UTC — the same fallback Migration 009 carries, and one no row has met.
    for (const required of ['id', 'habit_id', 'text', 'sort_order', 'created_at']) {
      if (!existing.includes(required)) throw new Error(`Migration 010 cannot carry lines without ${required}.`);
    }
    const createdFrom = existing.includes('created_from') ? 'created_from' : `date(created_at / 1000, 'unixepoch')`;
    const deletedFrom = existing.includes('deleted_from') ? 'deleted_from' : 'NULL';
    await database.execAsync(
      `INSERT INTO ${STAGING} (id, habit_id, text, sort_order, created_from, created_at, deleted_from)
         SELECT id, habit_id, text, sort_order, ${createdFrom}, created_at, ${deletedFrom} FROM ${ITEMS};
       DROP TABLE ${ITEMS};`,
    );
  }
  await database.execAsync(
    `ALTER TABLE ${STAGING} RENAME TO ${ITEMS};
     CREATE INDEX IF NOT EXISTS habit_checklist_items_habit_idx ON ${ITEMS}(habit_id, sort_order);`,
  );
}

async function apply(database: MigrationDatabase): Promise<void> {
  if (await scalar(database, 'SELECT user_version AS value FROM pragma_user_version;') !== 9) throw new Error('Migration 010 requires source schema version 9.');
  if (await scalar(database, 'SELECT foreign_keys AS value FROM pragma_foreign_keys;') !== 1) throw new Error('Migration 010 requires foreign keys enabled.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 010 source integrity failed.');

  const itemColumns = await columnsOf(database, ITEMS);
  const tickColumns = await columnsOf(database, TICKS);
  const itemsAreCanonical = sameColumns(itemColumns, ITEM_COLUMNS);
  const ticksAreCanonical = sameColumns(tickColumns, TICK_COLUMNS);

  if (!itemsAreCanonical || !ticksAreCanonical) {
    const before = await snapshotTables(database);
    const carriedLines = itemColumns.length === 0 ? 0 : await scalar(database, `SELECT count(*) AS value FROM ${ITEMS};`);

    // Deferred, not disabled: the tick table can reference the line table across
    // the exchange, and the commit still checks the result (Migration 007's rule).
    await database.execAsync('PRAGMA defer_foreign_keys = ON;');
    if (await scalar(database, 'SELECT defer_foreign_keys AS value FROM pragma_defer_foreign_keys;') !== 1) throw new Error('Migration 010 could not defer foreign-key checks.');

    // A half-finished rebuild may have left its staging table standing.
    if (await tableExists(database, STAGING)) await database.execAsync(`DROP TABLE ${STAGING};`);

    if (!ticksAreCanonical && tickColumns.length > 0) {
      // A tick table of an unknown shape cannot be reinterpreted, only replaced —
      // and it can only be non-canonical on a database where no tick was writable.
      if (await scalar(database, `SELECT count(*) AS value FROM ${TICKS};`) !== 0) throw new Error('Migration 010 found ticks it cannot attribute.');
      await database.execAsync(`DROP TABLE ${TICKS};`);
    }

    if (!itemsAreCanonical) await rebuildItems(database, itemColumns);
    if (!ticksAreCanonical) await database.execAsync(CANONICAL_TICKS_DDL);

    if (await scalar(database, `SELECT count(*) AS value FROM ${ITEMS};`) !== carriedLines) throw new Error('Migration 010 lost a checklist line.');

    // The repair owns two tables and may not have moved a row of anything else.
    for (const snapshot of before) {
      if (database.getAllAsync === undefined) throw new Error('Migration 010 requires bounded row reads.');
      const after = await database.getAllAsync<Readonly<Record<string, unknown>>>(`SELECT * FROM "${snapshot.name}" ORDER BY rowid;`);
      if (JSON.stringify(after) !== JSON.stringify(snapshot.rows)) throw new Error(`Migration 010 changed preserved table ${snapshot.name}.`);
    }
  }

  if (!sameColumns(await columnsOf(database, ITEMS), ITEM_COLUMNS)) throw new Error('Migration 010 left the checklist line uncanonical.');
  if (!sameColumns(await columnsOf(database, TICKS), TICK_COLUMNS)) throw new Error('Migration 010 left the checklist tick uncanonical.');
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${ITEMS}') WHERE "table"='habits' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1) throw new Error('Migration 010 lost the line-to-habit reference.');
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_foreign_key_list('${TICKS}') WHERE "table"='${ITEMS}' AND on_update='RESTRICT' AND on_delete='RESTRICT';`) !== 1) throw new Error('Migration 010 lost the tick-to-line reference.');
  if (await scalar(database, `SELECT count(*) AS value FROM pragma_table_info('habit_observations');`) === 0) throw new Error('Migration 010 lost the observation table.');
  if (await scalar(database, 'SELECT count(*) AS value FROM pragma_foreign_key_check;') !== 0) throw new Error('Migration 010 foreign-key verification failed.');
}

export const PLANNER_CHECKLIST_SHAPE_REPAIR_MIGRATION: Migration = Object.freeze({
  version: PLANNER_CHECKLIST_SHAPE_REPAIR_SCHEMA_VERSION,
  name: 'planner-checklist-shape-repair',
  setUserVersionSql: 'PRAGMA user_version = 10;',
  apply,
});
