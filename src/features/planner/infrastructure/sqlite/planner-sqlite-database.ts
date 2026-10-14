import type { SQLiteDatabase } from 'expo-sqlite';

export type PlannerSqlValue = string | number | null;
export type PlannerSqlParameters = Readonly<Record<string, PlannerSqlValue>>;

export interface PlannerSqliteDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, parameters?: PlannerSqlParameters): Promise<void>;
  getFirstAsync<T>(
    source: string,
    parameters?: PlannerSqlParameters,
  ): Promise<T | null>;
  getAllAsync<T>(
    source: string,
    parameters?: PlannerSqlParameters,
  ): Promise<T[]>;
  withTransactionAsync<T>(task: () => Promise<T>): Promise<T>;
}

export function adaptExpoSqliteDatabase(
  database: SQLiteDatabase,
): PlannerSqliteDatabase {
  return {
    execAsync: (source) => database.execAsync(source),
    async runAsync(source, parameters = {}) {
      await database.runAsync(source, { ...parameters });
    },
    getFirstAsync: (source, parameters = {}) =>
      database.getFirstAsync(source, { ...parameters }),
    getAllAsync: (source, parameters = {}) =>
      database.getAllAsync(source, { ...parameters }),
    async withTransactionAsync<T>(task: () => Promise<T>): Promise<T> {
      let result: T | undefined;
      await database.withTransactionAsync(async () => {
        result = await task();
      });
      if (result === undefined) {
        throw new Error('The SQLite transaction returned no result.');
      }
      return result;
    },
  };
}
