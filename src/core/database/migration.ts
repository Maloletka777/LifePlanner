export interface MigrationDatabase {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string): Promise<T | null>;
  getAllAsync?<T>(source: string): Promise<T[]>;
}

export interface MigrationRunnerDatabase extends MigrationDatabase {
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  /**
   * Whether a transaction is currently open on this connection.
   *
   * The runner needs this because a transaction it started can be **closed by
   * somebody else**: `expo-sqlite`'s own `withTransactionAsync` is
   * `try { BEGIN … COMMIT } catch { ROLLBACK }` on the shared connection, so a
   * second caller whose `BEGIN` fails — as it must, inside an open transaction —
   * rolls back the transaction it did not start. Everything the migration does
   * after that runs in autocommit and commits statement by statement, including
   * its own `PRAGMA user_version`, which is why the version could end up ahead of
   * the schema with nothing raising a word.
   *
   * Optional so a database that cannot answer is still usable; the runner then
   * loses the guard rather than refusing to run.
   */
  isInTransactionSync?(): boolean;
}

export type Migration = Readonly<{
  version: number;
  name: string;
  setUserVersionSql: string;
  requiresForeignKeysDisabled?: boolean;
  apply(database: MigrationDatabase): Promise<void>;
}>;
