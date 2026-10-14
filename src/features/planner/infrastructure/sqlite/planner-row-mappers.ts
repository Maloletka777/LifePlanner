import {
  createExactQuantity,
  exactQuantitySignificandForPersistence,
  failure,
  getImportanceWeight,
  parseImportanceLevel,
  parseHabitAccentKey,
  parseHabitIconIdentity,
  createHabitVisualIdentity,
  parseLifecycle,
  parsePlannerId,
  parsePlannerLocalTime,
  parsePlannerTimezone,
  parseReminderTimezoneMode,
  parseScheduleType,
  parseTrackingMode,
  success,
  validateEffectiveRange,
  validateScheduleDefinition,
  validateTrackingDefinition,
  type EffectiveRange,
  type HabitVisualIdentity,
  type CounterTrackingDefinition,
  type PlannerId,
  type QuantityTrackingDefinition,
  type Result,
  type ScheduleDefinition,
  type TrackingDefinition,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type HabitAggregate,
  type HabitImportanceVersion,
  type HabitReminderIntent,
  type HabitScheduleVersion,
  type HabitTrackingVersion,
  type HabitVisualIdentityRecord,
  type InitialHabitAggregatePersistenceInput,
  type PlannerPersistenceError,
} from '../../repositories';
import type { PlannerSqlParameters } from './planner-sqlite-database';
import type {
  HabitImportanceVersionRow,
  HabitReminderRow,
  HabitRow,
  HabitScheduleVersionRow,
  HabitTrackingVersionRow,
  HabitVisualIdentityRow,
} from './planner-row-types';

const SCHEDULE_NULL_COLUMNS = [
  'interval_days',
  'weekdays_mask',
  'weekday',
  'period_target_count',
  'anchor_date',
  'month_day',
  'month_number',
  'week_start',
] as const satisfies readonly (keyof HabitScheduleVersionRow)[];

const TRACKING_NULL_COLUMNS = [
  'standard_unit_code',
  'custom_unit_label',
  'target_significand',
  'target_scale',
  'target_duration_seconds',
] as const satisfies readonly (keyof HabitTrackingVersionRow)[];

export interface InitialHabitRows {
  readonly habit: HabitRow;
  readonly schedule: HabitScheduleVersionRow;
  readonly tracking: HabitTrackingVersionRow;
  readonly importance: HabitImportanceVersionRow;
  readonly reminders: readonly HabitReminderRow[];
}

export function mapHabitVisualIdentityRow(
  row: HabitVisualIdentityRow,
): Result<HabitVisualIdentityRecord, PlannerPersistenceError> {
  const id = parsePlannerId(row.id, 'visualIdentity.id');
  const habitId = parsePlannerId(row.habit_id, 'visualIdentity.habitId');
  const icon = row.icon_kind === 'symbol'
    ? parseHabitIconIdentity({ kind: 'symbol', symbolKey: row.symbol_key }, 'visualIdentity.iconIdentity')
    : row.icon_kind === 'emoji'
      ? parseHabitIconIdentity({ kind: 'emoji', emoji: row.emoji_value }, 'visualIdentity.iconIdentity')
      : null;
  const accent = parseHabitAccentKey(row.accent_key, 'visualIdentity.accentKey');
  if (
    !id.ok || !habitId.ok || icon === null || !icon.ok || !accent.ok || id.value !== habitId.value ||
    (row.icon_kind === 'symbol' ? row.emoji_value !== null : row.symbol_key !== null) ||
    !Number.isSafeInteger(row.created_at) || Number(row.created_at) < 0 ||
    !Number.isSafeInteger(row.updated_at) || Number(row.updated_at) < Number(row.created_at)
  ) {
    return integrityFailure('A habit visual identity row is malformed.');
  }
  const identity = createHabitVisualIdentity(icon.value, accent.value);
  return success(Object.freeze({
    id: id.value,
    habitId: habitId.value,
    ...identity,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

export function habitVisualIdentityToParameters(identity: HabitVisualIdentity): PlannerSqlParameters {
  return identity.iconIdentity.kind === 'symbol'
    ? {
        $iconKind: 'symbol',
        $symbolKey: identity.iconIdentity.symbolKey,
        $emojiValue: null,
        $accentKey: identity.persistedAccentKey,
      }
    : {
        $iconKind: 'emoji',
        $symbolKey: null,
        $emojiValue: identity.iconIdentity.emoji,
        $accentKey: identity.persistedAccentKey,
      };
}

export function scheduleDefinitionToParameters(
  definition: ScheduleDefinition,
): PlannerSqlParameters {
  const parameters: Record<string, string | number | null> = {
    $scheduleType: definition.scheduleType,
    $effectiveFrom: definition.effectiveRange.effectiveFrom,
    $effectiveTo: definition.effectiveRange.effectiveTo,
    $evaluationTimezone: definition.evaluationTimezone,
    $intervalDays: null,
    $weekdaysMask: null,
    $weekday: null,
    $periodTargetCount: null,
    $anchorDate: null,
    $monthDay: null,
    $monthNumber: null,
    $weekStart: null,
  };

  switch (definition.scheduleType) {
    case 'daily':
      break;
    case 'selected_weekdays':
      parameters.$weekdaysMask = definition.weekdaysMask;
      break;
    case 'every_n_days':
      parameters.$intervalDays = definition.intervalDays;
      parameters.$anchorDate = definition.anchorDate;
      break;
    case 'times_per_week':
      parameters.$periodTargetCount = definition.periodTargetCount;
      parameters.$weekStart = definition.weekStart;
      break;
    case 'times_per_month':
    case 'times_per_year':
      parameters.$periodTargetCount = definition.periodTargetCount;
      break;
    case 'weekly':
      parameters.$weekday = definition.weekday;
      parameters.$weekStart = definition.weekStart;
      break;
    case 'monthly':
      parameters.$monthDay = definition.monthDay;
      break;
    case 'yearly':
      parameters.$monthNumber = definition.monthNumber;
      parameters.$monthDay = definition.monthDay;
      break;
    default:
      return unreachableScheduleDefinition(definition);
  }

  return parameters;
}

export function trackingDefinitionToParameters(
  definition: TrackingDefinition,
): PlannerSqlParameters {
  const parameters: Record<string, string | number | null> = {
    $trackingMode: definition.trackingMode,
    $comparisonOperator: definition.comparisonOperator,
    $unitType: 'none',
    $standardUnitCode: null,
    $customUnitLabel: null,
    $targetSignificand: null,
    $targetScale: null,
    $targetDurationSeconds: null,
    $effectiveFrom: definition.effectiveRange.effectiveFrom,
    $effectiveTo: definition.effectiveRange.effectiveTo,
  };

  switch (definition.trackingMode) {
    case 'checkbox':
    case 'avoidance':
      break;
    case 'counter':
    case 'quantity':
      parameters.$targetSignificand =
        exactQuantitySignificandForPersistence(definition.target);
      parameters.$targetScale = definition.target.scale;
      applyUnitParameters(parameters, definition.unit);
      break;
    case 'duration':
      parameters.$unitType = 'standard';
      parameters.$standardUnitCode = 'second';
      parameters.$targetDurationSeconds = definition.targetDurationSeconds;
      break;
    default:
      return unreachableTrackingDefinition(definition);
  }

  return parameters;
}

export function mapInitialHabitRows(
  rows: InitialHabitRows,
  expected: InitialHabitAggregatePersistenceInput | null = null,
): Result<Omit<HabitAggregate, 'visualIdentity'>, PlannerPersistenceError> {
  const habitResult = mapHabitRow(rows.habit);
  if (!habitResult.ok) return habitResult;
  const scheduleResult = mapScheduleRow(rows.schedule);
  if (!scheduleResult.ok) return scheduleResult;
  const trackingResult = mapTrackingRow(rows.tracking);
  if (!trackingResult.ok) return trackingResult;
  const importanceResult = mapImportanceRow(rows.importance);
  if (!importanceResult.ok) return importanceResult;
  if (rows.reminders.length > 1) {
    return integrityFailure('An initial habit has multiple active reminders.');
  }
  const reminderResult =
    rows.reminders.length === 0
      ? success(null)
      : mapReminderRow(rows.reminders[0]);
  if (!reminderResult.ok) return reminderResult;

  const habit = habitResult.value;
  const versions = [
    scheduleResult.value,
    trackingResult.value,
    importanceResult.value,
  ] as const;
  if (
    versions.some(
      (version) =>
        version.habitId !== habit.id || version.model.versionNumber !== 1,
    ) ||
    (reminderResult.value !== null &&
      reminderResult.value.habitId !== habit.id)
  ) {
    return integrityFailure('Initial habit rows do not share one owner.');
  }

  if (
    !sameRange(habit.activeRange, scheduleResult.value.model.definition.effectiveRange) ||
    !sameRange(habit.activeRange, trackingResult.value.model.definition.effectiveRange) ||
    !sameRange(habit.activeRange, importanceResult.value.model.effectiveRange)
  ) {
    return integrityFailure('Initial configuration ranges do not match the habit.');
  }

  if (expected !== null && !matchesExpectedIds(expected, rows)) {
    return integrityFailure('The created habit readback contains unexpected identifiers.');
  }

  return success(
    Object.freeze({
      ...habit,
      scheduleVersion: scheduleResult.value.model,
      trackingVersion: trackingResult.value.model,
      importanceVersion: importanceResult.value.model,
      reminder: reminderResult.value?.model ?? null,
    }),
  );
}

export type MappedHabitIdentity = Omit<
  HabitAggregate,
  'scheduleVersion' | 'trackingVersion' | 'importanceVersion' | 'reminder' | 'visualIdentity'
>;

export function mapHabitRow(
  row: HabitRow,
): Result<MappedHabitIdentity, PlannerPersistenceError> {
  const idResult = parsePlannerId(row.id, 'habit.id');
  const rangeResult = validateEffectiveRange(
    { effectiveFrom: row.active_from, effectiveTo: row.active_to },
    'habit.activeRange',
  );
  const lifecycleResult = parseLifecycle(row.lifecycle, 'habit.lifecycle');
  if (!idResult.ok || !rangeResult.ok || !lifecycleResult.ok) {
    return integrityFailure('The persisted habit identity is malformed.');
  }
  if (
    typeof row.name !== 'string' ||
    row.name !== row.name.trim() ||
    Array.from(row.name).length < 1 ||
    Array.from(row.name).length > 200 ||
    (row.description !== null && typeof row.description !== 'string') ||
    !isNonnegativeSafeInteger(row.sort_order)
  ) {
    return integrityFailure('The persisted habit fields are malformed.');
  }
  const timestamps = parseTimestamps(row.created_at, row.updated_at);
  if (timestamps === null) {
    return integrityFailure('The persisted habit timestamps are malformed.');
  }
  let categoryId: PlannerId | null = null;
  if (row.category_id !== null) {
    const categoryResult = parsePlannerId(row.category_id, 'habit.categoryId');
    if (!categoryResult.ok) {
      return integrityFailure('The persisted category identifier is malformed.');
    }
    categoryId = categoryResult.value;
  }
  if (
    (lifecycleResult.value === 'active' && row.archived_at !== null) ||
    (lifecycleResult.value === 'archived' &&
      (!isNonnegativeSafeInteger(row.archived_at) ||
        row.archived_at < timestamps.createdAt))
  ) {
    return integrityFailure('The persisted habit lifecycle is contradictory.');
  }
  return success(
    Object.freeze({
      id: idResult.value,
      name: row.name,
      description: row.description,
      categoryId,
      activeRange: rangeResult.value,
      lifecycle: lifecycleResult.value,
      sortOrder: row.sort_order,
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
    }),
  );
}

export function mapScheduleRow(
  row: HabitScheduleVersionRow,
): Result<OwnedModel<HabitScheduleVersion>, PlannerPersistenceError> {
  const idsResult = mapVersionIdentity(row, 'schedule');
  if (!idsResult.ok) return idsResult;
  const typeResult = parseScheduleType(row.schedule_type, 'schedule.scheduleType');
  if (!typeResult.ok) return integrityFailure('The persisted schedule type is unsupported.');

  const base = {
    scheduleType: typeResult.value,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    evaluationTimezone: row.evaluation_timezone,
  };
  let input: Readonly<Record<string, unknown>>;
  let relevant: readonly (keyof HabitScheduleVersionRow)[];
  switch (typeResult.value) {
    case 'daily':
      input = base;
      relevant = [];
      break;
    case 'selected_weekdays':
      input = { ...base, weekdaysMask: row.weekdays_mask };
      relevant = ['weekdays_mask'];
      break;
    case 'every_n_days':
      input = { ...base, intervalDays: row.interval_days, anchorDate: row.anchor_date };
      relevant = ['interval_days', 'anchor_date'];
      break;
    case 'times_per_week':
      input = { ...base, periodTargetCount: row.period_target_count, weekStart: row.week_start };
      relevant = ['period_target_count', 'week_start'];
      break;
    case 'times_per_month':
    case 'times_per_year':
      input = { ...base, periodTargetCount: row.period_target_count };
      relevant = ['period_target_count'];
      break;
    case 'weekly':
      input = { ...base, weekday: row.weekday, weekStart: row.week_start };
      relevant = ['weekday', 'week_start'];
      break;
    case 'monthly':
      input = { ...base, monthDay: row.month_day };
      relevant = ['month_day'];
      break;
    case 'yearly':
      input = { ...base, monthNumber: row.month_number, monthDay: row.month_day };
      relevant = ['month_number', 'month_day'];
      break;
    default:
      return unreachableStoredSchedule(typeResult.value);
  }
  if (!irrelevantColumnsAreNull(row, SCHEDULE_NULL_COLUMNS, relevant)) {
    return integrityFailure('The persisted schedule has contradictory subtype columns.');
  }
  const definitionResult = validateScheduleDefinition(input);
  if (!definitionResult.ok) {
    return integrityFailure('The persisted schedule definition is malformed.', definitionResult.error);
  }
  return success({
    habitId: idsResult.value.habitId,
    model: Object.freeze({
      id: idsResult.value.id,
      versionNumber: idsResult.value.versionNumber,
      definition: definitionResult.value,
      createdAt: idsResult.value.createdAt,
      updatedAt: idsResult.value.updatedAt,
    }),
  });
}

export function mapTrackingRow(
  row: HabitTrackingVersionRow,
): Result<OwnedModel<HabitTrackingVersion>, PlannerPersistenceError> {
  const idsResult = mapVersionIdentity(row, 'tracking');
  if (!idsResult.ok) return idsResult;
  const modeResult = parseTrackingMode(row.tracking_mode, 'tracking.trackingMode');
  if (!modeResult.ok) return integrityFailure('The persisted tracking mode is unsupported.');
  const base = {
    trackingMode: modeResult.value,
    comparisonOperator: row.comparison_operator,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
  let input: Readonly<Record<string, unknown>>;
  let relevant: readonly (keyof HabitTrackingVersionRow)[];
  switch (modeResult.value) {
    case 'checkbox':
    case 'avoidance':
      if (row.unit_type !== 'none') {
        return integrityFailure('Boolean tracking must use no unit.');
      }
      input = base;
      relevant = [];
      break;
    case 'counter':
    case 'quantity': {
      const exactResult = exactQuantityFromRow(row.target_significand, row.target_scale);
      if (!exactResult.ok) return exactResult;
      const unitResult = unitFromRow(row.unit_type, row.standard_unit_code, row.custom_unit_label);
      if (!unitResult.ok) return unitResult;
      input = { ...base, target: exactResult.value, unit: unitResult.value };
      relevant = ['target_significand', 'target_scale'];
      if (row.unit_type === 'standard') relevant = [...relevant, 'standard_unit_code'];
      if (row.unit_type === 'custom') relevant = [...relevant, 'custom_unit_label'];
      break;
    }
    case 'duration':
      input = {
        ...base,
        targetDurationSeconds: row.target_duration_seconds,
        unit: { unitType: row.unit_type, standardUnitCode: row.standard_unit_code },
      };
      relevant = ['standard_unit_code', 'target_duration_seconds'];
      break;
    default:
      return unreachableStoredTracking(modeResult.value);
  }
  if (!irrelevantColumnsAreNull(row, TRACKING_NULL_COLUMNS, relevant)) {
    return integrityFailure('The persisted tracking row has contradictory subtype columns.');
  }
  const definitionResult = validateTrackingDefinition(input);
  if (!definitionResult.ok) {
    return integrityFailure('The persisted tracking definition is malformed.', definitionResult.error);
  }
  return success({
    habitId: idsResult.value.habitId,
    model: Object.freeze({
      id: idsResult.value.id,
      versionNumber: idsResult.value.versionNumber,
      definition: definitionResult.value,
      createdAt: idsResult.value.createdAt,
      updatedAt: idsResult.value.updatedAt,
    }),
  });
}

export function mapImportanceRow(
  row: HabitImportanceVersionRow,
): Result<OwnedModel<HabitImportanceVersion>, PlannerPersistenceError> {
  const idsResult = mapVersionIdentity(row, 'importance');
  if (!idsResult.ok) return idsResult;
  const levelResult = parseImportanceLevel(row.importance_level, 'importance.level');
  const rangeResult = validateEffectiveRange(
    { effectiveFrom: row.effective_from, effectiveTo: row.effective_to },
    'importance.effectiveRange',
  );
  if (!levelResult.ok || !rangeResult.ok || row.weight !== (levelResult.ok ? getImportanceWeight(levelResult.value) : -1)) {
    return integrityFailure('The persisted importance version is malformed.');
  }
  return success({
    habitId: idsResult.value.habitId,
    model: Object.freeze({
      id: idsResult.value.id,
      versionNumber: idsResult.value.versionNumber,
      importance: levelResult.value,
      weight: getImportanceWeight(levelResult.value),
      effectiveRange: rangeResult.value,
      createdAt: idsResult.value.createdAt,
      updatedAt: idsResult.value.updatedAt,
    }),
  });
}

export function mapReminderRow(
  row: HabitReminderRow,
): Result<OwnedModel<HabitReminderIntent>, PlannerPersistenceError> {
  const idResult = parsePlannerId(row.id, 'reminder.id');
  const habitIdResult = parsePlannerId(row.habit_id, 'reminder.habitId');
  const timeResult = parsePlannerLocalTime(row.trigger_local_time, 'reminder.triggerLocalTime');
  const modeResult = parseReminderTimezoneMode(row.timezone_mode, 'reminder.timezoneMode');
  const lifecycleResult = parseLifecycle(row.lifecycle, 'reminder.lifecycle');
  const timestamps = parseTimestamps(row.created_at, row.updated_at);
  if (!idResult.ok || !habitIdResult.ok || !timeResult.ok || !modeResult.ok || !lifecycleResult.ok || timestamps === null || (row.enabled !== 0 && row.enabled !== 1)) {
    return integrityFailure('The persisted reminder is malformed.');
  }
  let timezoneId = null;
  if (modeResult.value === 'schedule_timezone') {
    if (row.timezone_id !== null) return integrityFailure('A schedule-timezone reminder contains a fixed timezone.');
  } else {
    const timezoneResult = parsePlannerTimezone(row.timezone_id, 'reminder.timezoneId');
    if (!timezoneResult.ok) return integrityFailure('A fixed-timezone reminder has an invalid timezone.');
    timezoneId = timezoneResult.value;
  }
  if ((lifecycleResult.value === 'active' && row.archived_at !== null) || (lifecycleResult.value === 'archived' && (!isNonnegativeSafeInteger(row.archived_at) || row.archived_at < timestamps.createdAt))) {
    return integrityFailure('The persisted reminder lifecycle is contradictory.');
  }
  return success({
    habitId: habitIdResult.value,
    model: Object.freeze({
      id: idResult.value,
      triggerLocalTime: timeResult.value,
      timezoneMode: modeResult.value,
      timezoneId,
      enabled: row.enabled === 1,
      lifecycle: lifecycleResult.value,
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
    }),
  });
}

interface VersionIdentityRow {
  readonly id: unknown;
  readonly habit_id: unknown;
  readonly version_number: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

interface VersionIdentity {
  readonly id: PlannerId;
  readonly habitId: PlannerId;
  readonly versionNumber: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface OwnedModel<T> {
  readonly habitId: PlannerId;
  readonly model: T;
}

function mapVersionIdentity(
  row: VersionIdentityRow,
  label: string,
): Result<VersionIdentity, PlannerPersistenceError> {
  const idResult = parsePlannerId(row.id, `${label}.id`);
  const habitIdResult = parsePlannerId(row.habit_id, `${label}.habitId`);
  const timestamps = parseTimestamps(row.created_at, row.updated_at);
  if (
    !idResult.ok ||
    !habitIdResult.ok ||
    !isPositiveSafeInteger(row.version_number) ||
    timestamps === null
  ) {
    return integrityFailure(`The persisted ${label} version identity is malformed.`);
  }
  return success({
    id: idResult.value,
    habitId: habitIdResult.value,
    versionNumber: row.version_number,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  });
}

function exactQuantityFromRow(
  significand: unknown,
  scale: unknown,
): Result<Readonly<{ significand: bigint; scale: number }>, PlannerPersistenceError> {
  if (
    typeof significand !== 'number' ||
    typeof scale !== 'number' ||
    !Number.isSafeInteger(significand) ||
    !Number.isSafeInteger(scale)
  ) {
    return integrityFailure('A persisted exact quantity is outside the safe integer boundary.');
  }
  const result = createExactQuantity({ significand: BigInt(significand), scale });
  return result.ok
    ? success(result.value)
    : integrityFailure('A persisted exact quantity is malformed.', result.error);
}

function unitFromRow(
  unitType: unknown,
  standardCode: unknown,
  customLabel: unknown,
): Result<Readonly<Record<string, unknown>>, PlannerPersistenceError> {
  switch (unitType) {
    case 'none':
      return success({ unitType: 'none' });
    case 'standard':
      return success({ unitType: 'standard', standardUnitCode: standardCode });
    case 'custom':
      return success({ unitType: 'custom', customUnitLabel: customLabel });
    default:
      return integrityFailure('The persisted tracking unit type is unsupported.');
  }
}

function applyUnitParameters(
  parameters: Record<string, string | number | null>,
  unit: CounterTrackingDefinition['unit'] | QuantityTrackingDefinition['unit'],
): void {
  parameters.$unitType = unit.unitType;
  if (unit.unitType === 'standard') parameters.$standardUnitCode = unit.standardUnitCode ?? null;
  if (unit.unitType === 'custom') parameters.$customUnitLabel = unit.customUnitLabel ?? null;
}

function irrelevantColumnsAreNull<TRow extends object>(
  row: TRow,
  allColumns: readonly (keyof TRow)[],
  relevantColumns: readonly (keyof TRow)[],
): boolean {
  return allColumns.every(
    (column) => relevantColumns.includes(column) || row[column] === null,
  );
}

function parseTimestamps(
  createdAt: unknown,
  updatedAt: unknown,
): Readonly<{ createdAt: number; updatedAt: number }> | null {
  if (
    !isNonnegativeSafeInteger(createdAt) ||
    !isNonnegativeSafeInteger(updatedAt) ||
    updatedAt < createdAt
  ) {
    return null;
  }
  return { createdAt, updatedAt };
}

function isNonnegativeSafeInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && typeof input === 'number' && input >= 0;
}

function isPositiveSafeInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && typeof input === 'number' && input > 0;
}

function sameRange(left: EffectiveRange, right: EffectiveRange): boolean {
  return left.effectiveFrom === right.effectiveFrom && left.effectiveTo === right.effectiveTo;
}

function matchesExpectedIds(expected: InitialHabitAggregatePersistenceInput, rows: InitialHabitRows): boolean {
  return rows.habit.id === expected.habitId && rows.schedule.id === expected.scheduleVersionId && rows.tracking.id === expected.trackingVersionId && rows.importance.id === expected.importanceVersionId && (expected.reminder === null ? rows.reminders.length === 0 : rows.reminders.length === 1 && rows.reminders[0].id === expected.reminder.id);
}

function integrityFailure<T>(message: string, cause?: unknown): Result<T, PlannerPersistenceError> {
  return failure(createPlannerPersistenceError('data_integrity_failure', message, { operation: 'mapInitialHabitRows', cause }));
}

function unreachableScheduleDefinition(definition: never): never {
  throw new Error(`Unreachable schedule definition: ${String(definition)}`);
}

function unreachableTrackingDefinition(definition: never): never {
  throw new Error(`Unreachable tracking definition: ${String(definition)}`);
}

function unreachableStoredSchedule(scheduleType: never): Result<never, PlannerPersistenceError> {
  return integrityFailure(`Unsupported schedule type: ${String(scheduleType)}`);
}

function unreachableStoredTracking(trackingMode: never): Result<never, PlannerPersistenceError> {
  return integrityFailure(`Unsupported tracking mode: ${String(trackingMode)}`);
}
