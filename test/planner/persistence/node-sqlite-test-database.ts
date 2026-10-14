import { DatabaseSync } from 'node:sqlite';

import { runMigrations } from '../../../src/core/database/migration-runner';
import type { MigrationRunnerDatabase } from '../../../src/core/database/migration';
import type {
  PlannerSqlParameters,
  PlannerSqliteDatabase,
} from '../../../src/features/planner/infrastructure/sqlite';

export class NodeSqliteTestDatabase
  implements PlannerSqliteDatabase, MigrationRunnerDatabase
{
  readonly #database: DatabaseSync;

  constructor(filename = ':memory:') {
    this.#database = new DatabaseSync(filename);
    this.#database.exec('PRAGMA foreign_keys = ON;');
  }

  async migrate(): Promise<void> {
    await runMigrations(this);
  }

  async execAsync(source: string): Promise<void> {
    this.#database.exec(source);
  }

  async runAsync(
    source: string,
    parameters: PlannerSqlParameters = {},
  ): Promise<void> {
    this.#database.prepare(source).run({ ...parameters });
  }

  async getFirstAsync<T>(
    source: string,
    parameters: PlannerSqlParameters = {},
  ): Promise<T | null> {
    const row = this.#database.prepare(source).get({ ...parameters });
    return row === undefined ? null : (row as T);
  }

  async getAllAsync<T>(
    source: string,
    parameters: PlannerSqlParameters = {},
  ): Promise<T[]> {
    return this.#database.prepare(source).all({ ...parameters }) as T[];
  }

  /** What the runner uses to notice a transaction closed out from under it. */
  isInTransactionSync(): boolean {
    return this.#database.isTransaction;
  }

  async withTransactionAsync<T>(task: () => Promise<T>): Promise<T> {
    this.#database.exec('BEGIN IMMEDIATE;');
    try {
      const result = await task();
      this.#database.exec('COMMIT;');
      return result;
    } catch (cause: unknown) {
      this.#database.exec('ROLLBACK;');
      throw cause;
    }
  }

  close(): void {
    this.#database.close();
  }
}
