import type { ImportanceLevel } from './stored-values';

export const IMPORTANCE_WEIGHTS = Object.freeze({
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
} satisfies Readonly<Record<ImportanceLevel, 1 | 2 | 3 | 4>>);

export type ImportanceWeight = (typeof IMPORTANCE_WEIGHTS)[ImportanceLevel];

export function getImportanceWeight(
  importanceLevel: ImportanceLevel,
): ImportanceWeight {
  return IMPORTANCE_WEIGHTS[importanceLevel];
}
