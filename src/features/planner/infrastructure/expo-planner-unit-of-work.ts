import { withDatabase } from '@/src/core/database';

import {
  adaptExpoSqliteDatabase,
  createSqlitePlannerUnitOfWork,
  type PlannerDatabaseAccess,
} from './sqlite';

const productionDatabaseAccess: PlannerDatabaseAccess = (operation) =>
  withDatabase((database) => operation(adaptExpoSqliteDatabase(database)));

export function createProductionPlannerUnitOfWork() {
  return createSqlitePlannerUnitOfWork(productionDatabaseAccess);
}
