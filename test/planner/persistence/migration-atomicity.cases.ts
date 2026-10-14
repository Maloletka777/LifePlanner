import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations, verifyDatabaseSchema, LATEST_DATABASE_VERSION } from '../../../src/core/database/migration-runner';
import { NodeSqliteTestDatabase } from './node-sqlite-test-database';

/**
 * The failure that put a device's schema behind its own version, reproduced.
 *
 * `expo-sqlite`'s `withTransactionAsync` is `try { BEGIN; task(); COMMIT } catch
 * { ROLLBACK; throw }` on the **shared** connection — its own documentation says
 * the ordering is not controlled. A second caller entering it while a migration is
 * in flight fails its `BEGIN` and its `catch` rolls back a transaction it never
 * started. That is all this database does: it issues the stray `ROLLBACK` at a
 * chosen point and then behaves normally.
 *
 * What follows is not a hypothetical. Everything after the rollback runs in
 * autocommit and commits statement by statement — including `PRAGMA user_version`,
 * which is why reading the version back cannot detect the damage.
 */
class InterruptedDatabase extends NodeSqliteTestDatabase {
  #fired = false;

  /**
   * `where` chooses when the stray rollback lands.
   *
   * `'work'` puts it in the middle of a migration's own statements, where that
   * migration's verification is the thing that notices. `'beforeCommit'` puts it
   * after the schema version has been written and read back — the one place no
   * existing check could see it, because autocommit stored the version faithfully.
   */
  constructor(private readonly where: 'work' | 'beforeCommit') {
    super();
  }

  #interrupt = async (): Promise<void> => {
    this.#fired = true;
    await super.execAsync('ROLLBACK;');
  };

  override async execAsync(source: string): Promise<void> {
    await super.execAsync(source);
    if (this.where === 'work' && !this.#fired && source.includes('defer_foreign_keys') && this.isInTransactionSync()) {
      await this.#interrupt();
    }
  }

  override async getFirstAsync<T>(source: string): Promise<T | null> {
    const row = await super.getFirstAsync<T>(source);
    if (this.where === 'beforeCommit' && !this.#fired && source.includes('PRAGMA user_version;') && this.isInTransactionSync()) {
      await this.#interrupt();
    }
    return row;
  }

  get interrupted(): boolean {
    return this.#fired;
  }
}

const userVersion = async (database: NodeSqliteTestDatabase) =>
  (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version;

test('a migration that loses its transaction before committing is refused, not recorded', async (t) => {
  const database = new InterruptedDatabase('beforeCommit');
  t.after(() => database.close());

  await assert.rejects(
    runMigrations(database),
    (error: Error) => /lost its transaction before it could commit/.test(error.message),
    'the runner notices that the transaction it is about to commit is no longer its own',
  );
  assert.equal(database.interrupted, true, 'the interruption actually happened');

  // This is the case nothing else could catch. The version had been written and
  // read back successfully — autocommit stored it faithfully — so the readback,
  // which was the runner's only check, was satisfied by the damage itself.
  assert.notEqual(await userVersion(database), LATEST_DATABASE_VERSION);
});

test('a rollback in the middle of a migration is caught by that migration itself', async (t) => {
  const database = new InterruptedDatabase('work');
  t.after(() => database.close());

  await assert.rejects(runMigrations(database), 'the chain stops rather than carrying on over a wreck');
  assert.equal(database.interrupted, true);
  assert.notEqual(await userVersion(database), LATEST_DATABASE_VERSION);
});

test('the damage such a run leaves behind is named by schema verification', async (t) => {
  const database = new InterruptedDatabase('beforeCommit');
  t.after(() => database.close());
  await assert.rejects(runMigrations(database));

  // Second line of defence, and the one that would have caught the device on the
  // launch after the accident rather than three screens later.
  await assert.rejects(
    verifyDatabaseSchema(database),
    (error: Error) => /missing/.test(error.message),
    'the schema is checked against what the application queries, not against a number',
  );
});

test('the runner refuses to start inside a transaction it did not open', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await database.execAsync('BEGIN IMMEDIATE;');

  await assert.rejects(
    runMigrations(database),
    (error: Error) => /found a transaction already open/.test(error.message),
    'joining somebody else’s transaction is how a migration stops being atomic',
  );

  await database.execAsync('ROLLBACK;');
});

test('an uninterrupted chain still commits every migration and leaves no transaction open', async (t) => {
  const database = new NodeSqliteTestDatabase();
  t.after(() => database.close());
  await runMigrations(database);

  assert.equal(await userVersion(database), LATEST_DATABASE_VERSION);
  assert.equal(database.isInTransactionSync(), false, 'the runner closes what it opens');
  await verifyDatabaseSchema(database);
});
