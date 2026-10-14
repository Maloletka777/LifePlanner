import {
  addPlannerCalendarDays,
  COUNTER_STANDARD_UNIT_CODES,
  convertExactStandardUnit,
  formatExactQuantity,
  isoWeekdaysToMask,
  normalizeExactQuantity,
  parseExactQuantity,
  parsePlannerId,
  parseHabitEmoji,
  parsePlannerLocalDate,
  parsePlannerLocalTime,
  parsePlannerTimezone,
  QUANTITY_STANDARD_UNIT_CODES,
  standardUnitLabel,
  validateScheduleDefinition,
  validateTrackingDefinition,
  type ExactQuantity,
  type HabitAccentKey,
  type HabitIconKey,
  type PersistedHabitAccentKey,
  type RegisteredHabitSymbolKey,
  type ImportanceLevel,
  type NumericComparisonOperator,
  type ObservationFact,
  type PlannerDomainError,
  type PlannerId,
  type PlannerLocalDate,
  type PlannerTimezone,
  type QuantityStandardUnitCode,
  type ScheduleDefinition,
  type ScheduleType,
  type StandardUnitCode,
  type TrackingDefinition,
  type TrackingMode,
} from '../domain';
import type { PlannerDayBlockKey } from '../domain/values/day-block';
import type {
  AddHabitDependencyCommand,
  CreateHabitCommand,
  PlannerOccurrenceCurrentEntry,
  SelectedDatePlannerOccurrenceRow,
} from '../application';
import type { PlannerHabitTemporalContext } from '@/src/features/planner';

export interface UiAdapterError {
  readonly field: string;
  readonly message: string;
}

export type PlannerDateEntryResult =
  | { readonly ok: true; readonly value: PlannerLocalDate; readonly display: string }
  | { readonly ok: false; readonly message: string };

export function formatPlannerDateEntry(date: string): string {
  const parsed = parsePlannerLocalDate(date);
  return parsed.ok ? `${parsed.value.slice(8, 10)}.${parsed.value.slice(5, 7)}.${parsed.value.slice(0, 4)}` : date;
}

export function parsePlannerDateEntry(input: string): PlannerDateEntryResult {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, message: 'Enter the complete date.' };
  let canonical: string;
  if (/^\d{6}$/.test(trimmed)) canonical = `20${trimmed.slice(4, 6)}-${trimmed.slice(2, 4)}-${trimmed.slice(0, 2)}`;
  else if (/^\d{8}$/.test(trimmed)) canonical = `${trimmed.slice(4, 8)}-${trimmed.slice(2, 4)}-${trimmed.slice(0, 2)}`;
  else if (/^\d{2}[./-]\d{2}[./-]\d{4}$/.test(trimmed)) canonical = `${trimmed.slice(6, 10)}-${trimmed.slice(3, 5)}-${trimmed.slice(0, 2)}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) canonical = trimmed;
  else return { ok: false, message: 'Enter the complete date.' };
  const parsed = parsePlannerLocalDate(canonical);
  return parsed.ok
    ? { ok: true, value: parsed.value, display: formatPlannerDateEntry(parsed.value) }
    : { ok: false, message: 'This date does not exist.' };
}

export function constrainPlannerDateEntry(previous: string, next: string): Readonly<{ value: string; excessive: boolean }> {
  const digits = next.match(/\d/g)?.length ?? 0;
  if (digits > 8) return { value: previous, excessive: true };
  if (/^\d{4}-\d{0,2}-?\d{0,2}$/.test(next)) return { value: next, excessive: false };
  const compact = next.replace(/\D/g, '');
  if (compact.length <= 2) return { value: compact, excessive: false };
  if (compact.length <= 4) return { value: `${compact.slice(0, 2)}.${compact.slice(2)}`, excessive: false };
  if (compact.length === 6) return { value: `${compact.slice(0, 2)}.${compact.slice(2, 4)}.20${compact.slice(4)}`, excessive: false };
  return { value: `${compact.slice(0, 2)}.${compact.slice(2, 4)}.${compact.slice(4)}`, excessive: false };
}

export function plannerMonthGrid(year: number, month: number): readonly (PlannerLocalDate | null)[] {
  const days = month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  const firstWeekday = new Date(year, month - 1, 1, 12).getDay();
  const mondayOffset = (firstWeekday + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - mondayOffset + 1;
    if (day < 1 || day > days) return null;
    const parsed = parsePlannerLocalDate(`${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`);
    return parsed.ok ? parsed.value : null;
  });
}

export function movePlannerMonth(year: number, month: number, offset: number): Readonly<{ year: number; month: number }> {
  const absolute = year * 12 + month - 1 + offset;
  return { year: Math.floor(absolute / 12), month: absolute % 12 + 1 };
}

export function plannerManagementActionNames(lifecycle: 'active' | 'archived', needsSchedule = false): readonly string[] {
  return lifecycle === 'archived' ? ['restore', 'delete'] : [needsSchedule ? 'repair' : 'edit', 'archive', 'delete'];
}

export function nextOpenSwipeRow(current: string | null, event: Readonly<{ type: 'open'; rowId: string } | { type: 'close' | 'scroll' | 'filter' }>): string | null {
  return event.type === 'open' ? event.rowId : null;
}

export const PLANNER_DATE_RAIL_RANGE = 731;
export const PLANNER_DATE_RAIL_VISIBLE_CELLS = 7;

export function plannerDateRailCenterIndex(rangeLength = PLANNER_DATE_RAIL_RANGE): number {
  return Math.floor(Math.max(1, rangeLength) / 2);
}

export function plannerDateRailInitialIndex(
  rangeLength = PLANNER_DATE_RAIL_RANGE,
  visibleCells = PLANNER_DATE_RAIL_VISIBLE_CELLS,
): number {
  return Math.max(0, plannerDateRailCenterIndex(rangeLength) - Math.floor(Math.max(1, visibleCells) / 2));
}

export function nativeDateRailDayOffset(
  contentOffsetX: number,
  cellWidth: number,
  rangeLength = PLANNER_DATE_RAIL_RANGE,
  visibleCells = PLANNER_DATE_RAIL_VISIBLE_CELLS,
): number {
  if (!Number.isFinite(contentOffsetX) || !Number.isFinite(cellWidth) || cellWidth <= 0) return 0;
  const firstVisibleIndex = Math.round(contentOffsetX / cellWidth);
  return firstVisibleIndex - plannerDateRailInitialIndex(rangeLength, visibleCells);
}

export function nativeDateRailDate(
  anchorDate: PlannerLocalDate,
  contentOffsetX: number,
  cellWidth: number,
): PlannerLocalDate {
  return movePlannerDate(anchorDate, nativeDateRailDayOffset(contentOffsetX, cellWidth));
}

export function isCurrentDateRailSettlement(
  interactionAnchor: PlannerLocalDate,
  selectedDate: PlannerLocalDate,
  interactionToken: number,
  currentToken: number,
): boolean {
  return interactionAnchor === selectedDate && interactionToken === currentToken;
}

export function plannerLocalDateToDate(date: PlannerLocalDate): Date {
  return new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12);
}

export function plannerLocalDateFromDate(date: Date): PlannerLocalDate {
  const canonical = `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  const parsed = parsePlannerLocalDate(canonical);
  if (!parsed.ok) throw new Error('Native date picker returned an unsupported date.');
  return parsed.value;
}

export const OBSERVATION_MODAL_KEYBOARD_POLICY = Object.freeze({
  iosAvoidingBehavior: 'padding' as const,
  keyboardDismissMode: 'interactive' as const,
  keyboardShouldPersistTaps: 'handled' as const,
  contentPressAction: 'dismiss_keyboard' as const,
  backdropPressAction: 'dismiss_modal' as const,
  resetDraftOnKeyboardDismiss: false,
  scrollable: true,
});

export function observationModalSaveDisabled(
  saving: boolean,
  trackingMode: TrackingMode,
  avoidanceValue: boolean | null,
): boolean {
  return saving || (trackingMode === 'avoidance' && avoidanceValue === null);
}

export type UiAdapterResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; errors: readonly UiAdapterError[] }>;

export interface ActiveRangeDraft {
  readonly activeFrom: string;
  readonly activeTo: string;
}

export interface ScheduleDraft {
  readonly scheduleType: ScheduleType;
  readonly selectedWeekdays: readonly number[];
  readonly intervalDays: string;
  readonly anchorDate: string;
  readonly periodTargetCount: string;
  readonly weekStart: string;
  readonly weekday: string;
  readonly monthDay: string;
  readonly monthNumber: string;
}

export interface TrackingDraft {
  readonly trackingMode: TrackingMode;
  readonly comparisonOperator: NumericComparisonOperator;
  readonly target: string;
  readonly unitType: 'none' | 'standard' | 'custom';
  readonly standardUnitCode: StandardUnitCode;
  readonly customUnitLabel: string;
  readonly durationHours: string;
  readonly durationMinutes: string;
  readonly durationSeconds: string;
}

export interface ParentHabitDraft {
  readonly name: string;
  readonly description: string;
  readonly iconKey?: HabitIconKey | null;
  readonly iconSymbolKey?: RegisteredHabitSymbolKey | null;
  readonly iconEmoji?: string | null;
  readonly accentKey?: HabitAccentKey | null;
  readonly persistedAccentKey?: PersistedHabitAccentKey | null;
  readonly iconSelection?: 'automatic' | 'explicit';
  readonly accentSelection?: 'automatic' | 'explicit';
  readonly activeRange: ActiveRangeDraft;
  readonly schedule: ScheduleDraft;
  readonly tracking: TrackingDraft;
  readonly importance: ImportanceLevel;
  readonly plannedTime: string;
  /**
   * How long the thing is meant to take, or `null` when nobody stated a length.
   *
   * The time drum has always asked for it — the day is cut by it so a start can be
   * picked — and until schema v13 it was thrown away on the way here (PD-CREATE-030).
   */
  readonly plannedDurationMinutes?: number | null;
  /**
   * Which part of the day the thing belongs to, or `null` for none.
   *
   * **Not derived from `plannedTime`, and that is the point** (schema v14): a morning
   * routine done at 12:40 has to stay a morning routine, or every failed morning quietly
   * becomes an afternoon and the pattern «mornings collapse on Wednesdays» stops being
   * computable. Where a thing belongs and when it was done are two facts.
   *
   * Unlike the duration, it survives an item having no minute at all: a thing can belong
   * to the evening without anybody saying which minute of it.
   */
  readonly plannedBlock?: PlannerDayBlockKey | null;
  /**
   * The absolute local time a reminder fires at, or `''` for no reminder.
   *
   * `CreateHabitCommand.reminder` has carried this since schema v1 and the create
   * screen simply never sent it. Relative choices ("10 minutes before") are
   * resolved against the planned time before they reach here, because the domain
   * stores a time and not an offset.
   */
  readonly reminderTime?: string;
}

export interface DependencyDraft {
  readonly enabled: boolean;
  readonly dependencyType: 'follow_up' | 'prerequisite';
  readonly name: string;
  readonly description: string;
  readonly tracking: TrackingDraft;
  readonly importance: ImportanceLevel;
}

/**
 * Whether a root row is done, whoever closed it.
 *
 * A derived routine container carries no observation of its own, so its `state`
 * stays incomplete however many steps are finished; the canonical fact is the one
 * the read model computes from the steps. Reading `state` alone is what left the
 * parent unmarked at "2 of 2 steps" on the owner's recording.
 */
/**
 * The progress a routine's own bar should show.
 *
 * The root group's progress counts the container itself alongside its steps, and a
 * derived container never qualifies — it holds no observation of its own. So the
 * bar could not reach the end however many steps were ticked: one step of one read
 * as a part-filled bar under a struck-through title. A derived container shows the
 * progress the read model already computed from its steps; everything else keeps
 * the group's own figure.
 */
export function plannerRoutineDisplayProgress(group: RoutineProgressInput): number | null {
  const container = group.routineContainer;
  return container !== undefined && container !== null
    && container.completionSource === 'ordinary_children_derived'
    && container.isRoutineContainer
    ? container.displayProgress
    : group.progress.displayProgress;
}

export interface RoutineProgressInput {
  readonly progress: Readonly<{ displayProgress: number | null }>;
  readonly routineContainer?: Readonly<{
    completionSource: string;
    isRoutineContainer: boolean;
    displayProgress: number | null;
  }> | null;
}

export interface CanonicallyDoneInput {
  readonly state: SelectedDatePlannerOccurrenceRow['state'];
  readonly routineContainer?: Readonly<{
    completionSource: string;
    isRoutineContainer: boolean;
    isCanonicallyComplete: boolean;
  }> | null;
}

export function plannerRowIsCanonicallyDone(row: CanonicallyDoneInput): boolean {
  const container = row.routineContainer;
  return container !== undefined && container !== null
    && container.completionSource === 'ordinary_children_derived'
    && container.isRoutineContainer
    ? container.isCanonicallyComplete
    : row.state === 'qualified';
}

/**
 * The two times a day surface has to tell apart.
 *
 * The **plan** comes from the habit's schedule and no gesture ever touches it.
 * The **fact** is when the thing was actually done, carried by the current
 * observation's own `occurrenceLocalTime`. A row stands on its fact where there
 * is one, and on its plan otherwise; the difference between them is what the
 * ghost and the counter are for.
 */
export function plannerRowFactLocalTime(row: FactTimeInput): string | null {
  const entries = row.currentObservation?.currentEntries ?? [];
  for (const entry of entries) {
    if (entry.occurrenceLocalTime !== null && entry.occurrenceLocalTime !== undefined) return entry.occurrenceLocalTime;
  }
  return null;
}

/** Where the row belongs on the axis: the fact if it has one, else the plan. */
export function plannerRowAxisLocalTime(row: FactTimeInput): string | null {
  return plannerRowFactLocalTime(row) ?? row.plannedLocalTime ?? null;
}

/** True when the fact and the plan disagree — the only case that earns a ghost. */
export function plannerRowFactDiffersFromPlan(row: FactTimeInput): boolean {
  const fact = plannerRowFactLocalTime(row);
  return fact !== null && row.plannedLocalTime !== null && fact !== row.plannedLocalTime;
}

interface FactTimeInput {
  readonly plannedLocalTime: string | null;
  readonly currentObservation?: Readonly<{
    readonly currentEntries: readonly Readonly<{ readonly occurrenceLocalTime?: string | null }>[];
  }>;
}

/** The 15-minute grid the gesture snaps to; finer than a minute is a tap's job. */
export const PLANNER_FACT_GRID_MINUTES = 15;

/**
 * What a drop is allowed to do, decided before anything is written.
 *
 * Rule 1 is the whole of the first release: a drop into the past records or
 * corrects the fact. Rule 2 — dropping an unfinished habit into the future — is
 * deferred, because it needs a per-date occurrence override the domain does not
 * carry, and inventing one here would be a second schedule editor.
 */
export type PlannerFactDrop =
  | Readonly<{ kind: 'record'; localTime: string }>
  | Readonly<{ kind: 'correct'; localTime: string; observationId: string }>
  | Readonly<{ kind: 'refused'; reason: string }>;

export const SCHEDULE_LABELS: Readonly<Record<ScheduleType, string>> = Object.freeze({
  daily: 'Every day',
  selected_weekdays: 'Selected weekdays',
  every_n_days: 'Every N days',
  times_per_week: 'N times per week',
  times_per_month: 'N times per month',
  times_per_year: 'N times per year',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
});

export const TRACKING_LABELS: Readonly<Record<TrackingMode, string>> = Object.freeze({
  checkbox: 'Checkbox',
  counter: 'Counter',
  quantity: 'Quantity',
  duration: 'Duration',
  avoidance: 'Avoidance',
});

export const IMPORTANCE_LABELS: Readonly<Record<ImportanceLevel, string>> = Object.freeze({
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
});

const WEEKDAY_NAMES = Object.freeze([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const);

export function createDefaultScheduleDraft(activeFrom: string): ScheduleDraft {
  return Object.freeze({
    scheduleType: 'daily',
    selectedWeekdays: Object.freeze([]),
    intervalDays: '2',
    anchorDate: activeFrom,
    periodTargetCount: '1',
    weekStart: '1',
    weekday: '1',
    monthDay: '1',
    monthNumber: '1',
  });
}

export function createDefaultTrackingDraft(): TrackingDraft {
  return Object.freeze({
    trackingMode: 'checkbox',
    comparisonOperator: 'at_least',
    target: '1',
    unitType: 'none',
    standardUnitCode: 'repetition',
    customUnitLabel: '',
    durationHours: '0',
    durationMinutes: '30',
    durationSeconds: '0',
  });
}

export function scheduleDraftFromDefinition(definition: ScheduleDefinition): ScheduleDraft {
  const draft = createDefaultScheduleDraft(definition.effectiveRange.effectiveFrom);
  switch (definition.scheduleType) {
    case 'daily': return draft;
    case 'selected_weekdays': return { ...draft, scheduleType: definition.scheduleType, selectedWeekdays: [1, 2, 3, 4, 5, 6, 7].filter((day) => (definition.weekdaysMask & (1 << (day - 1))) !== 0) };
    case 'every_n_days': return { ...draft, scheduleType: definition.scheduleType, intervalDays: String(definition.intervalDays), anchorDate: definition.anchorDate };
    case 'times_per_week': return { ...draft, scheduleType: definition.scheduleType, periodTargetCount: String(definition.periodTargetCount), weekStart: String(definition.weekStart) };
    case 'times_per_month':
    case 'times_per_year': return { ...draft, scheduleType: definition.scheduleType, periodTargetCount: String(definition.periodTargetCount) };
    case 'weekly': return { ...draft, scheduleType: definition.scheduleType, weekday: String(definition.weekday), weekStart: String(definition.weekStart) };
    case 'monthly': return { ...draft, scheduleType: definition.scheduleType, monthDay: String(definition.monthDay) };
    case 'yearly': return { ...draft, scheduleType: definition.scheduleType, monthNumber: String(definition.monthNumber), monthDay: String(definition.monthDay) };
  }
}

export function trackingDraftFromDefinition(definition: TrackingDefinition): TrackingDraft {
  const draft = createDefaultTrackingDraft();
  if (definition.trackingMode === 'checkbox' || definition.trackingMode === 'avoidance') return { ...draft, trackingMode: definition.trackingMode };
  if (definition.trackingMode === 'duration') return {
    ...draft,
    trackingMode: 'duration',
    comparisonOperator: definition.comparisonOperator,
    durationHours: String(Math.floor(definition.targetDurationSeconds / 3600)),
    durationMinutes: String(Math.floor((definition.targetDurationSeconds % 3600) / 60)),
    durationSeconds: String(definition.targetDurationSeconds % 60),
  };
  const unit = definition.unit;
  return {
    ...draft,
    trackingMode: definition.trackingMode,
    comparisonOperator: definition.comparisonOperator,
    target: formatExactQuantity(definition.target),
    unitType: unit.unitType,
    standardUnitCode: unit.unitType === 'standard' ? unit.standardUnitCode : 'repetition',
    customUnitLabel: unit.unitType === 'custom' ? unit.customUnitLabel : '',
  };
}

export function plannerLocalDateFromDevice(date = new Date()): PlannerLocalDate {
  const text = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const parsed = parsePlannerLocalDate(text);
  if (!parsed.ok) throw new Error('The device returned an unsupported local date.');
  return parsed.value;
}

export function plannerTimezoneFromDevice(): PlannerTimezone {
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const parsed = parsePlannerTimezone(candidate);
  if (!parsed.ok) {
    const fallback = parsePlannerTimezone('UTC');
    if (!fallback.ok) throw new Error('No supported local timezone is available.');
    return fallback.value;
  }
  return parsed.value;
}

/**
 * Whole days from one local date to another, signed: before is negative.
 *
 * Both dates are read at noon (`plannerLocalDateToDate`), so a daylight-saving boundary
 * between them cannot round the difference to the wrong day — which is the one thing a
 * naive millisecond division of two midnights gets wrong twice a year.
 */
export function plannerDaysBetween(from: PlannerLocalDate, to: PlannerLocalDate): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((plannerLocalDateToDate(to).getTime() - plannerLocalDateToDate(from).getTime()) / day);
}

export function movePlannerDate(date: PlannerLocalDate, offset: number): PlannerLocalDate {
  const result = addPlannerCalendarDays(date, offset);
  if (!result.ok) return date;
  return result.value;
}

export function formatPlannerDate(date: PlannerLocalDate, style: 'full' | 'short' = 'full'): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: style === 'full' ? 'long' : undefined,
    day: 'numeric',
    month: style === 'full' ? 'long' : 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day, 12));
}

export function formatPlannerLifecycleDate(date: PlannerLocalDate): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
  }).format(new Date(year, month - 1, day, 12));
}

export type PlannerHabitTemporalPresentation = Readonly<{
  statusLabel: 'Scheduled' | 'Active' | 'Archived';
  statusDetail: string | null;
  settingsHeading: 'Current setup' | 'Future settings' | 'Historical settings';
  schedule: string;
  plannedTime: string;
  tracking: string;
  importance: string;
  primarySummary: string;
  needsSchedule: boolean;
}>;

export function plannerHabitTemporalPresentation(
  temporalContext: PlannerHabitTemporalContext,
): PlannerHabitTemporalPresentation {
  const snapshot = temporalContext.displayConfiguration;
  const schedule = snapshot.inheritsOccurrence
    ? 'Follows its relationship'
    : snapshot.needsSchedule
      ? 'Schedule required'
      : snapshot.schedule === null
        ? 'No schedule history'
        : scheduleSummary(snapshot.schedule.definition);
  const plannedTime = snapshot.plannedTime.plannedLocalTime ?? 'All day';
  const lifecycleStart = `Starts ${formatPlannerLifecycleDate(temporalContext.activeFrom)}`;
  const configurationStart = `Starts ${formatPlannerLifecycleDate(snapshot.effectiveLocalDate)}`;
  const settingsHeading = temporalContext.displayConfigurationTemporalRelation === 'next_effective'
    ? 'Future settings'
    : temporalContext.displayConfigurationTemporalRelation === 'latest_historical'
      ? 'Historical settings'
      : 'Current setup';
  const statusLabel = temporalContext.isPreActive
    ? 'Scheduled'
    : temporalContext.lifecycleState === 'archived'
      ? 'Archived'
      : 'Active';
  const statusDetail = temporalContext.isPreActive
    ? lifecycleStart
    : temporalContext.displayConfigurationTemporalRelation === 'latest_historical'
      ? 'Historical settings shown'
      : null;
  const primarySummary = temporalContext.displayConfigurationTemporalRelation === 'next_effective'
    ? [configurationStart, schedule, snapshot.plannedTime.plannedLocalTime].filter(Boolean).join(' · ')
    : [plannedTime, schedule].join(' · ');
  return Object.freeze({
    statusLabel,
    statusDetail,
    settingsHeading,
    schedule,
    plannedTime,
    tracking: trackingSummary(snapshot.tracking.definition),
    importance: snapshot.importance.importance,
    primarySummary,
    needsSchedule: snapshot.needsSchedule,
  });
}

export function plannerLifecycleActionUnavailableMessage(
  action: 'edit' | 'archive' | 'delete' | 'restore',
  unavailableReason: string | null,
  earliestEffectiveLocalDate: PlannerLocalDate | null,
): string {
  if (unavailableReason === 'habit_not_active_yet') {
    return earliestEffectiveLocalDate === null
      ? `This habit is not active yet. ${capitalize(action)} is unavailable.`
      : `This habit is not active yet. ${capitalize(action)} is available from ${formatPlannerLifecycleDate(earliestEffectiveLocalDate)}.`;
  }
  if (unavailableReason === 'habit_already_archived') return 'This habit is already archived.';
  if (unavailableReason === 'habit_not_archived') return 'This habit is not archived.';
  if (unavailableReason === 'not_supported') return `${capitalize(action)} is not available.`;
  const participle = { edit: 'edited', archive: 'archived', delete: 'deleted', restore: 'restored' }[action];
  return `This habit cannot be ${participle} from this date.`;
}

export function plannerEditStageNames(
  trackingMode: TrackingMode,
  isRoutineContainer: boolean,
): readonly ('Identity' | 'Plan' | 'Legacy tracking' | 'Review')[] {
  return trackingMode === 'checkbox' || isRoutineContainer
    ? Object.freeze(['Identity', 'Plan', 'Review'] as const)
    : Object.freeze(['Identity', 'Plan', 'Legacy tracking', 'Review'] as const);
}

export function buildActiveRange(draft: ActiveRangeDraft): UiAdapterResult<Readonly<{
  activeFrom: PlannerLocalDate;
  activeTo: PlannerLocalDate | null;
}>> {
  const start = parsePlannerLocalDate(draft.activeFrom, 'activeFrom');
  const end = draft.activeTo.trim().length === 0
    ? null
    : parsePlannerLocalDate(draft.activeTo, 'activeTo');
  const errors: UiAdapterError[] = [];
  if (!start.ok) errors.push(error('activeFrom', 'Enter a real start date as YYYY-MM-DD.'));
  if (end !== null && !end.ok) errors.push(error('activeTo', 'Enter a real end date as YYYY-MM-DD.'));
  if (start.ok && end !== null && end.ok && end.value <= start.value) {
    errors.push(error('activeTo', 'The exclusive end date must be later than the start date.'));
  }
  if (errors.length > 0 || !start.ok || (end !== null && !end.ok)) return invalid(errors);
  return valid(Object.freeze({ activeFrom: start.value, activeTo: end?.value ?? null }));
}

export function buildScheduleDefinition(
  draft: ScheduleDraft,
  range: ActiveRangeDraft,
  timezone: string,
): UiAdapterResult<ScheduleDefinition> {
  const activeRange = buildActiveRange(range);
  if (!activeRange.ok) return activeRange;
  const zone = parsePlannerTimezone(timezone, 'evaluationTimezone');
  if (!zone.ok) return invalid([error('evaluationTimezone', 'The current timezone is not supported.')]);
  const base = {
    scheduleType: draft.scheduleType,
    effectiveFrom: activeRange.value.activeFrom,
    effectiveTo: activeRange.value.activeTo,
    evaluationTimezone: zone.value,
  };
  let input: unknown;
  switch (draft.scheduleType) {
    case 'daily':
      input = base;
      break;
    case 'selected_weekdays': {
      const mask = isoWeekdaysToMask(draft.selectedWeekdays);
      if (!mask.ok) return invalid([error('selectedWeekdays', 'Choose at least one valid weekday.')]);
      input = { ...base, weekdaysMask: mask.value };
      break;
    }
    case 'every_n_days': {
      const interval = positiveWhole(draft.intervalDays, 'intervalDays', 'Enter a positive whole-day interval.');
      const anchor = parsePlannerLocalDate(draft.anchorDate, 'anchorDate');
      const errors = [...(interval.ok ? [] : interval.errors)];
      if (!anchor.ok) errors.push(error('anchorDate', 'Enter a real anchor date as YYYY-MM-DD.'));
      if (anchor.ok && anchor.value > activeRange.value.activeFrom) {
        errors.push(error('anchorDate', 'The anchor date must be on or before the active start date.'));
      }
      if (errors.length > 0 || !interval.ok || !anchor.ok) return invalid(errors);
      input = { ...base, intervalDays: interval.value, anchorDate: anchor.value };
      break;
    }
    case 'times_per_week': {
      const count = positiveWhole(draft.periodTargetCount, 'periodTargetCount', 'Enter a positive weekly target.');
      const weekStart = weekdayNumber(draft.weekStart, 'weekStart');
      if (!count.ok || !weekStart.ok) return invalid([...errorsOf(count), ...errorsOf(weekStart)]);
      input = { ...base, periodTargetCount: count.value, weekStart: weekStart.value };
      break;
    }
    case 'times_per_month':
    case 'times_per_year': {
      const count = positiveWhole(
        draft.periodTargetCount,
        'periodTargetCount',
        `Enter a positive ${draft.scheduleType === 'times_per_month' ? 'monthly' : 'yearly'} target.`,
      );
      if (!count.ok) return count;
      input = { ...base, periodTargetCount: count.value };
      break;
    }
    case 'weekly': {
      const weekday = weekdayNumber(draft.weekday, 'weekday');
      const weekStart = weekdayNumber(draft.weekStart, 'weekStart');
      if (!weekday.ok || !weekStart.ok) return invalid([...errorsOf(weekday), ...errorsOf(weekStart)]);
      input = { ...base, weekday: weekday.value, weekStart: weekStart.value };
      break;
    }
    case 'monthly': {
      const monthDay = wholeInRange(draft.monthDay, 1, 31, 'monthDay', 'Enter a day from 1 through 31.');
      if (!monthDay.ok) return monthDay;
      input = { ...base, monthDay: monthDay.value };
      break;
    }
    case 'yearly': {
      const monthNumber = wholeInRange(draft.monthNumber, 1, 12, 'monthNumber', 'Enter a month from 1 through 12.');
      const monthDay = wholeInRange(draft.monthDay, 1, 31, 'monthDay', 'Enter a valid day for the selected month.');
      if (!monthNumber.ok || !monthDay.ok) return invalid([...errorsOf(monthNumber), ...errorsOf(monthDay)]);
      input = { ...base, monthNumber: monthNumber.value, monthDay: monthDay.value };
      break;
    }
  }
  const validated = validateScheduleDefinition(input);
  return validated.ok ? valid(validated.value) : invalid([domainError(validated.error)]);
}

export function buildTrackingDefinition(
  draft: TrackingDraft,
  range: ActiveRangeDraft,
): UiAdapterResult<TrackingDefinition> {
  const activeRange = buildActiveRange(range);
  if (!activeRange.ok) return activeRange;
  const base = {
    trackingMode: draft.trackingMode,
    effectiveFrom: activeRange.value.activeFrom,
    effectiveTo: activeRange.value.activeTo,
  };
  let input: unknown;
  if (draft.trackingMode === 'checkbox' || draft.trackingMode === 'avoidance') {
    input = { ...base, comparisonOperator: 'boolean_success' };
  } else if (draft.trackingMode === 'duration') {
    const duration = durationDraftToSeconds(draft.durationHours, draft.durationMinutes, draft.durationSeconds);
    if (!duration.ok) return duration;
    input = {
      ...base,
      comparisonOperator: draft.comparisonOperator,
      targetDurationSeconds: duration.value,
      unit: { unitType: 'standard', standardUnitCode: 'second' },
    };
  } else {
    let exactTarget: ExactQuantity;
    if (draft.trackingMode === 'counter') {
      const target = positiveWhole(
        draft.target,
        'target',
        'Enter a positive whole-number target.',
      );
      if (!target.ok) return target;
      exactTarget = { significand: BigInt(target.value), scale: 0 as ExactQuantity['scale'] };
    } else {
      const target = parsePositiveExactQuantity(draft.target, 'target');
      if (!target.ok) return target;
      if (target.value.scale < 2) {
        const normalized = normalizeExactQuantity(target.value, 2, 'target');
        if (!normalized.ok) return invalid([domainError(normalized.error)]);
        exactTarget = normalized.value;
      } else {
        exactTarget = target.value;
      }
    }
    const unit = buildUnit(draft, draft.trackingMode);
    if (!unit.ok) return unit;
    input = {
      ...base,
      comparisonOperator: draft.comparisonOperator,
      target: exactTarget,
      unit: unit.value,
    };
  }
  const validated = validateTrackingDefinition(input);
  return validated.ok ? valid(validated.value) : invalid([domainError(validated.error)]);
}

export function buildCreateHabitCommand(
  draft: ParentHabitDraft,
  timezone: string,
): UiAdapterResult<CreateHabitCommand> {
  const name = draft.name.trim();
  if (name.length === 0) return invalid([error('name', 'Enter a habit name.')]);
  const range = buildActiveRange(draft.activeRange);
  const schedule = buildScheduleDefinition(draft.schedule, draft.activeRange, timezone);
  const tracking = buildTrackingDefinition(draft.tracking, draft.activeRange);
  const emoji = draft.iconEmoji === undefined || draft.iconEmoji === null || draft.iconEmoji === '' ? null : parseHabitEmoji(draft.iconEmoji, 'iconEmoji');
  const plannedTime = draft.plannedTime.trim() === '' ? null : parsePlannerLocalTime(draft.plannedTime.trim(), 'plannedTime');
  const reminderText = (draft.reminderTime ?? '').trim();
  const reminderTime = reminderText === '' ? null : parsePlannerLocalTime(reminderText, 'reminder.triggerLocalTime');
  if (!range.ok || !schedule.ok || !tracking.ok || (plannedTime !== null && !plannedTime.ok) || (reminderTime !== null && !reminderTime.ok) || (emoji !== null && !emoji.ok)) {
    return invalid([...errorsOf(range), ...errorsOf(schedule), ...errorsOf(tracking), ...(plannedTime !== null && !plannedTime.ok ? [error('plannedTime', 'Enter a local time as HH:mm.')] : []), ...(reminderTime !== null && !reminderTime.ok ? [error('reminder', 'Enter a reminder time as HH:mm.')] : []), ...(emoji !== null && !emoji.ok ? [error('iconEmoji', emoji.error.message)] : [])]);
  }
  return valid(Object.freeze({
    name,
    description: normalizeDescription(draft.description),
    categoryId: null,
    activeFrom: range.value.activeFrom,
    activeTo: range.value.activeTo,
    schedule: schedule.value,
    tracking: tracking.value,
    importance: draft.importance,
    plannedTime: plannedTime === null ? null : plannedTime.value,
    // An item with no minute carries no length either: a length is measured from a start.
    plannedDurationMinutes: plannedTime === null ? null : (draft.plannedDurationMinutes ?? null),
    // A block survives having no minute — it is where the thing belongs, not when it
    // starts — so it is passed through whatever the clock says.
    plannedBlock: draft.plannedBlock ?? null,
    // A reminder follows the schedule's own timezone, so it has no fixed zone of
    // its own — which is the one shape `validateHabitReminder` accepts with a null
    // `timezoneId`.
    reminder: reminderTime === null || !reminderTime.ok
      ? null
      : Object.freeze({ timezoneId: null, timezoneMode: 'schedule_timezone' as const, triggerLocalTime: reminderTime.value }),
    iconKey: emoji === null && (draft.iconSymbolKey === undefined || draft.iconSymbolKey === null) ? draft.iconKey ?? null : undefined,
    iconIdentity: emoji !== null
      ? Object.freeze({ kind: 'emoji' as const, emoji: emoji.value })
      : draft.iconSymbolKey === undefined || draft.iconSymbolKey === null
        ? undefined
        : Object.freeze({ kind: 'symbol' as const, symbolKey: draft.iconSymbolKey }),
    accentKey: draft.persistedAccentKey ?? draft.accentKey ?? null,
  }));
}

export function buildCreateDependencyCommand(
  parentHabitId: PlannerId,
  parentRange: ActiveRangeDraft,
  draft: DependencyDraft,
): UiAdapterResult<AddHabitDependencyCommand | null> {
  if (!draft.enabled) return valid(null);
  const name = draft.name.trim();
  if (name.length === 0) return invalid([error('dependency.name', 'Enter a dependent habit name.')]);
  const range = buildActiveRange(parentRange);
  const tracking = buildTrackingDefinition(draft.tracking, parentRange);
  if (!range.ok || !tracking.ok) return invalid([...errorsOf(range), ...errorsOf(tracking)]);
  return valid(Object.freeze({
    dependentSource: 'new' as const,
    parentHabitId,
    dependencyType: draft.dependencyType,
    effectiveFrom: range.value.activeFrom,
    effectiveTo: range.value.activeTo,
    dependent: Object.freeze({
      name,
      description: normalizeDescription(draft.description),
      categoryId: null,
      tracking: tracking.value,
      importance: draft.importance,
      reminder: null,
    }),
  }));
}

export function durationDraftToSeconds(
  hoursText: string,
  minutesText: string,
  secondsText = '0',
): UiAdapterResult<number> {
  const hours = nonNegativeWhole(hoursText, 'durationHours', 'Enter zero or more whole hours.');
  const minutes = wholeInRange(minutesText, 0, 59, 'durationMinutes', 'Enter minutes from 0 through 59.');
  const secondsPart = wholeInRange(secondsText, 0, 59, 'durationSeconds', 'Enter seconds from 0 through 59.');
  if (!hours.ok || !minutes.ok || !secondsPart.ok) {
    return invalid([...errorsOf(hours), ...errorsOf(minutes), ...errorsOf(secondsPart)]);
  }
  const seconds = hours.value * 3600 + minutes.value * 60 + secondsPart.value;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return invalid([error('duration', 'Enter a duration greater than zero.')]);
  }
  return valid(seconds);
}

export function quantityObservationFromDraft(
  input: string,
  target: ExactQuantity,
): UiAdapterResult<ExactQuantity> {
  const parsed = parsePlannerDecimalInput(input, 'quantity');
  if (!parsed.ok || parsed.value.significand <= 0n) {
    return invalid([error('quantity', parsed.ok ? 'Enter an amount greater than zero.' : exactErrorMessage(parsed.error))]);
  }
  const normalized = normalizeExactQuantity(parsed.value, target.scale, 'quantity');
  if (!normalized.ok) return invalid([error('quantity', exactErrorMessage(normalized.error))]);
  return valid(normalized.value);
}

export interface QuantityQuickAction {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly inputValue: string;
}

export function quantityQuickActions(
  row: SelectedDatePlannerOccurrenceRow,
): readonly QuantityQuickAction[] {
  if (row.actualTarget.trackingMode !== 'quantity') return Object.freeze([]);
  const unit = row.actualTarget.unit;
  if (unit.unitType === 'custom') {
    return Object.freeze([250, 500].map((amount) => Object.freeze({
      label: `+${amount} ${unit.customUnitLabel}`,
      accessibilityLabel: `Add ${amount} ${unit.customUnitLabel}`,
      inputValue: String(amount),
    })));
  }

  const targetUnit = unit.standardUnitCode;
  const sourceUnit = targetUnit === 'litre' || targetUnit === 'millilitre'
    ? 'millilitre'
    : targetUnit === 'kilogram' || targetUnit === 'gram'
      ? 'gram'
      : 'metre';
  const sourceSymbol = standardUnitLabel(sourceUnit, 'symbol');
  const sourceName = standardUnitLabel(sourceUnit, 'plural');
  const actions: QuantityQuickAction[] = [];
  for (const amount of [250, 500]) {
    const parsed = parseExactQuantity(String(amount), 'quantityQuickAction');
    if (!parsed.ok) continue;
    const converted = convertExactStandardUnit(parsed.value, sourceUnit, targetUnit, 'quantityQuickAction');
    if (!converted.ok) continue;
    actions.push(Object.freeze({
      label: `+${amount} ${sourceSymbol}`,
      accessibilityLabel: `Add ${amount} ${sourceName}`,
      inputValue: formatExactQuantity(converted.value),
    }));
  }
  return Object.freeze(actions);
}

export function parsePlannerDecimalInput(
  input: string,
  field = 'quantity',
): ReturnType<typeof parseExactQuantity> {
  const trimmed = input.trim();
  const normalized = trimmed.includes(',') && !trimmed.includes('.')
    ? trimmed.replace(',', '.')
    : trimmed;
  return parseExactQuantity(normalized, field);
}

export type OccurrenceAction =
  | Readonly<{ kind: 'record_checkbox'; value: true; label: 'Record completion' }>
  | Readonly<{ kind: 'correct_checkbox'; value: boolean; label: 'Mark complete' | 'Mark incomplete' }>
  | Readonly<{ kind: 'choose_avoidance'; label: 'Record outcome' }>
  | Readonly<{ kind: 'add_counter'; label: 'Add count' }>
  | Readonly<{ kind: 'add_quantity'; label: 'Add amount' }>
  | Readonly<{ kind: 'add_duration'; label: 'Add duration' }>
  | Readonly<{ kind: 'none'; label: string; disabledReason: string }>;

export function occurrenceAction(row: SelectedDatePlannerOccurrenceRow): OccurrenceAction {
  if (
    row.routineContainer?.completionSource === 'ordinary_children_derived' &&
    !row.routineContainer.hasIndependentCompletionAction
  ) {
    return Object.freeze({
      kind: 'none',
      label: 'Complete routine steps',
      disabledReason: 'Routine completion is derived from its applicable steps.',
    });
  }
  if (row.state === 'blocked') {
    return Object.freeze({ kind: 'none', label: 'Blocked', disabledReason: 'Complete the parent habit first.' });
  }
  if (row.state === 'skipped_policy_unresolved') {
    return Object.freeze({ kind: 'none', label: 'No action', disabledReason: 'Skipped policy is not yet defined.' });
  }
  if (row.state === 'prerequisite_blocked_parent') {
    if (row.actualTarget.trackingMode === 'checkbox' && row.actualTarget.actual === true) {
      return Object.freeze({ kind: 'correct_checkbox', value: false, label: 'Mark incomplete' });
    }
    return Object.freeze({ kind: 'none', label: 'Waiting', disabledReason: 'Complete the prerequisite first.' });
  }
  switch (row.actualTarget.trackingMode) {
    case 'checkbox':
      if (row.actualTarget.actual === null) return Object.freeze({ kind: 'record_checkbox', value: true, label: 'Record completion' });
      return Object.freeze({
        kind: 'correct_checkbox',
        value: !row.actualTarget.actual,
        label: row.actualTarget.actual ? 'Mark incomplete' : 'Mark complete',
      });
    case 'avoidance':
      return Object.freeze({ kind: 'choose_avoidance', label: 'Record outcome' });
    case 'counter':
      return Object.freeze({ kind: 'add_counter', label: 'Add count' });
    case 'quantity':
      return Object.freeze({ kind: 'add_quantity', label: 'Add amount' });
    case 'duration':
      return Object.freeze({ kind: 'add_duration', label: 'Add duration' });
  }
}

export function scheduleSummary(schedule: ScheduleDefinition): string {
  switch (schedule.scheduleType) {
    case 'daily': return 'Every day';
    case 'selected_weekdays': {
      const days = WEEKDAY_NAMES.filter((_, index) => (schedule.weekdaysMask & (1 << index)) !== 0);
      return `Every ${joinWords(days)}`;
    }
    case 'every_n_days': return `Every ${schedule.intervalDays} days from ${schedule.anchorDate}`;
    case 'times_per_week': return `${schedule.periodTargetCount} times per week, week starts ${WEEKDAY_NAMES[schedule.weekStart - 1]}`;
    case 'times_per_month': return `${schedule.periodTargetCount} times per month`;
    case 'times_per_year': return `${schedule.periodTargetCount} times per year`;
    case 'weekly': return `Every ${WEEKDAY_NAMES[schedule.weekday - 1]}`;
    case 'monthly': return `Monthly on day ${schedule.monthDay}, using the last valid day when needed`;
    case 'yearly': return `Yearly on ${WEEKDAY_MONTHS[schedule.monthNumber - 1]} ${schedule.monthDay}`;
  }
}

export function trackingSummary(tracking: TrackingDefinition): string {
  const operator = tracking.trackingMode === 'checkbox' || tracking.trackingMode === 'avoidance'
    ? ''
    : { at_least: 'at least', at_most: 'at most', equal: 'exactly' }[tracking.comparisonOperator];
  switch (tracking.trackingMode) {
    case 'checkbox': return 'Complete when checked';
    case 'avoidance': return 'Success means the event did not occur';
    case 'counter': return `Complete ${operator} ${formatExactQuantity(tracking.target)}${unitSuffix(tracking.unit)}`;
    case 'quantity': return `Complete ${operator} ${formatExactQuantity(tracking.target)}${unitSuffix(tracking.unit)}`;
    case 'duration': return `Complete ${operator} ${formatDuration(tracking.targetDurationSeconds)}`;
  }
}

export function actualTargetText(row: SelectedDatePlannerOccurrenceRow): string {
  switch (row.actualTarget.trackingMode) {
    case 'checkbox': return row.actualTarget.actual === true ? 'Checked' : row.actualTarget.actual === false ? 'Not complete' : 'No observation';
    case 'avoidance': return row.actualTarget.actual === true ? 'Did not occur' : row.actualTarget.actual === false ? 'Occurred' : 'No observation';
    case 'counter': return `${formatExactQuantity(row.actualTarget.actual)} / ${formatExactQuantity(row.actualTarget.target)}${compactUnitSuffix(row.actualTarget.unit)}`;
    case 'quantity': {
      if (row.actualTarget.unit.unitType === 'custom') {
        return `${formatExactQuantity(row.actualTarget.actual)} / ${formatExactQuantity(row.actualTarget.target)} ${row.actualTarget.unit.customUnitLabel}`;
      }
      const progress = formatQuantityProgressInUnit(
        row.actualTarget.actual,
        row.actualTarget.unit.standardUnitCode,
        row.actualTarget.target,
        row.actualTarget.unit.standardUnitCode,
        row.actualTarget.unit.standardUnitCode,
      );
      return progress.ok ? progress.value : 'Amount unavailable';
    }
    case 'duration': return `${formatDuration(row.actualTarget.actualSeconds)} / ${formatDuration(row.actualTarget.targetSeconds)}`;
  }
}

export function formatQuantityProgressInUnit(
  actual: ExactQuantity,
  actualUnit: QuantityStandardUnitCode,
  target: ExactQuantity,
  targetUnit: QuantityStandardUnitCode,
  displayUnit: QuantityStandardUnitCode,
): UiAdapterResult<string> {
  const displayActual = convertExactStandardUnit(actual, actualUnit, displayUnit, 'actual');
  const displayTarget = convertExactStandardUnit(target, targetUnit, displayUnit, 'target');
  if (!displayActual.ok || !displayTarget.ok) {
    return invalid([error('quantity', 'The recorded amount and target do not use compatible units.')]);
  }
  return valid(`${formatExactQuantity(displayActual.value)} / ${formatExactQuantity(displayTarget.value)} ${standardUnitLabel(displayUnit, 'symbol')}`);
}

export function currentEntryValueText(
  entry: PlannerOccurrenceCurrentEntry,
  row: SelectedDatePlannerOccurrenceRow,
): string {
  switch (entry.currentValue.type) {
    case 'counter':
      return `${entry.currentValue.counterDelta}${row.actualTarget.trackingMode === 'counter' ? compactUnitSuffix(row.actualTarget.unit) : ''}`;
    case 'quantity':
      return `${formatExactQuantity(entry.currentValue.quantity, { fixedScale: true })}${row.actualTarget.trackingMode === 'quantity' ? compactUnitSuffix(row.actualTarget.unit) : ''}`;
    case 'duration': {
      const seconds = entry.currentValue.durationSeconds;
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainder = seconds % 60;
      return [
        hours > 0 ? `${hours}h` : '',
        minutes > 0 ? `${minutes}m` : '',
        remainder > 0 || (hours === 0 && minutes === 0) ? `${remainder}s` : '',
      ].filter(Boolean).join(' ');
    }
    case 'checkbox': return entry.currentValue.booleanValue ? 'Completed' : 'Not completed';
    case 'avoidance': return entry.currentValue.booleanValue ? 'Did not occur' : 'Occurred';
    case 'skipped': return 'Skipped';
    case 'void': return 'Removed';
    default: return 'Unknown entry';
  }
}

export function managementQueryDate(
  routeDate: string | readonly string[] | undefined,
  fallbackDate: PlannerLocalDate,
): PlannerLocalDate {
  const parsed = parsePlannerLocalDate(singleRouteValue(routeDate) ?? '', 'date');
  return parsed.ok ? parsed.value : fallbackDate;
}

/**
 * Habit detail is withdrawn: everything it showed now lives on Edit, so opening a
 * habit opens the screen that can change it. The route stays registered — it is a
 * deep-link target and nothing about the habit's data changed — but nothing in the
 * app navigates to it any more.
 */
export function habitDetailNavigation(habitId: PlannerId, date: PlannerLocalDate) {
  return habitEditNavigation(habitId, date);
}

export function habitEditNavigation(habitId: PlannerId, date: PlannerLocalDate) {
  return Object.freeze({
    pathname: '/planner/edit/[id]' as const,
    params: Object.freeze({ id: habitId, date }),
  });
}

export function habitCatalogueNavigation(date: PlannerLocalDate) {
  return Object.freeze({
    pathname: '/planner/habits' as const,
    params: Object.freeze({ date }),
  });
}

export function habitDetailQueryInput(habitId: PlannerId, asOfLocalDate: PlannerLocalDate) {
  return Object.freeze({ habitId, asOfLocalDate });
}

export type PlannerRouteParameter = string | readonly string[] | undefined;

export function resolveHabitDetailRouteParams(
  params: Readonly<{ id?: PlannerRouteParameter; date?: PlannerRouteParameter }>,
  fallbackDate: PlannerLocalDate,
):
  | Readonly<{ ok: true; habitId: PlannerId; asOfLocalDate: PlannerLocalDate }>
  | Readonly<{ ok: false; reason: 'invalid_route' }> {
  const rawId = singleRouteValue(params.id);
  const id = parsePlannerId(rawId, 'id');
  if (!id.ok) return Object.freeze({ ok: false, reason: 'invalid_route' });
  return Object.freeze({
    ok: true,
    habitId: id.value,
    asOfLocalDate: managementQueryDate(params.date, fallbackDate),
  });
}

function singleRouteValue(value: PlannerRouteParameter): string | undefined {
  if (typeof value === 'string') return value;
  return value?.length === 1 ? value[0] : undefined;
}

export function observationValueText(fact: ObservationFact): string {
  switch (fact.value.type) {
    case 'checkbox': return fact.value.booleanValue ? 'Completed' : 'Not completed';
    case 'avoidance': return fact.value.booleanValue ? 'Did not occur' : 'Occurred';
    case 'counter': return `${fact.value.counterDelta}`;
    case 'quantity': return formatExactQuantity(fact.value.quantity);
    case 'duration': {
      const seconds = fact.value.durationSeconds;
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainder = seconds % 60;
      const readable = [hours > 0 ? `${hours}h` : '', minutes > 0 ? `${minutes}m` : '', remainder > 0 || (hours === 0 && minutes === 0) ? `${remainder}s` : ''].filter(Boolean).join(' ');
      return `${seconds} seconds (${readable})`;
    }
    case 'skipped': return 'Skipped · completion policy unresolved';
    case 'void': return 'Voided';
  }
}

export function plannerFailureMessage(code: string): string {
  if (code === 'lifecycle_history_invalid' || code === 'data_integrity_failure' || code.startsWith('archive_') && code.endsWith('_data_integrity_failure')) return 'This habit could not be updated safely. No data was changed. Try again.';
  if (code === 'restore_schedule_required') return 'This habit cannot be restored until you choose a new schedule. No data was changed.';
  if (code === 'archive_habit_not_found' || code === 'restore_habit_not_found' || code === 'delete_habit_not_found') return 'This habit could not be found. No data was changed. Refresh Habit Management and try again.';
  if (code === 'delete_confirmation_required') return 'Permanent deletion was not confirmed. No data was changed.';
  if (code === 'delete_routine_invalid_selection') return 'That sub-habit selection is no longer valid. No data was changed. Review the routine again.';
  if (code === 'delete_routine_stale_confirmation') return 'The routine changed after the preview. No data was changed. Refresh and review it again.';
  if (code === 'dependency_cycle' || code === 'ordinary_cycle') return 'That relationship would create a cycle. No data was changed. Choose another parent.';
  if (code === 'dependency_depth_exceeded' || code === 'ordinary_depth_exceeded') return 'That relationship would exceed the five-level nesting limit. No data was changed.';
  if (code.includes('relationship_mode_conflict') || code.includes('second_active_parent')) return 'This habit already has another parent relationship for that period. No data was changed.';
  if (code.includes('future_version_conflict')) return 'A future configuration already exists for that date. No data was changed. Choose a later date.';
  if (code.startsWith('delete_') && code.includes('integrity')) return 'Planner could not safely delete this habit. No data was changed. Retry, or keep it archived.';
  if (code.startsWith('archive_')) return 'Planner could not safely archive this habit. No data was changed. Refresh and try again.';
  if (code.startsWith('restore_')) return 'Planner could not safely restore this habit. No data was changed. Review its schedule or try again.';
  if (code.includes('database_failure')) return 'The local save did not complete. No data was changed. Try again.';
  return 'Planner could not complete this action safely. No data was changed. Review the habit and try again.';
}

export function selectedDateFailureMessage(code: string): string {
  if (code === 'occurrence_read_model_database_failure') {
    return 'Planner could not read this day from local storage. No data was changed. Retry.';
  }
  return 'Planner could not safely read this day. No data was changed. Open Habit Management or retry.';
}

export function statusPresentation(row: SelectedDatePlannerOccurrenceRow): Readonly<{
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'info';
  explanation: string | null;
}> {
  switch (row.state) {
    case 'expected_incomplete': return row.dependencyType === null
      ? { label: 'Incomplete', tone: 'neutral', explanation: null }
      : { label: 'Available · incomplete', tone: 'neutral', explanation: 'Record this habit separately to complete it.' };
    case 'qualified': return { label: 'Completed', tone: 'success', explanation: 'Completion comes from this habit’s own observation.' };
    case 'provisional': return { label: 'Provisional', tone: 'info', explanation: 'The evaluation window is still open.' };
    case 'blocked': return { label: 'Locked · incomplete', tone: 'neutral', explanation: 'Complete the parent habit first.' };
    case 'prerequisite_blocked_parent': return { label: 'Incomplete · waiting for prerequisite', tone: 'warning', explanation: 'This habit cannot complete until its prerequisite completes.' };
    case 'skipped_policy_unresolved': return { label: 'Skipped · policy unresolved', tone: 'info', explanation: 'No completion meaning is inferred.' };
  }
}

const WEEKDAY_MONTHS = Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December']);

function buildUnit(draft: TrackingDraft, mode: 'counter' | 'quantity'): UiAdapterResult<unknown> {
  if (mode === 'quantity' && draft.unitType === 'none') {
    return invalid([error('unitType', 'Quantity requires a standard or custom unit.')]);
  }
  if (draft.unitType === 'none') return valid(Object.freeze({ unitType: 'none' as const }));
  if (draft.unitType === 'custom') {
    const label = draft.customUnitLabel.trim();
    if (label.length === 0) return invalid([error('customUnitLabel', 'Enter a custom unit name.')]);
    return valid(Object.freeze({ unitType: 'custom' as const, customUnitLabel: label }));
  }
  const allowed = mode === 'counter'
    ? COUNTER_STANDARD_UNIT_CODES
    : QUANTITY_STANDARD_UNIT_CODES;
  if (!(allowed as readonly StandardUnitCode[]).includes(draft.standardUnitCode)) {
    return invalid([error('standardUnitCode', `Choose a ${mode} unit.`)]);
  }
  return valid(Object.freeze({ unitType: 'standard' as const, standardUnitCode: draft.standardUnitCode }));
}

function parsePositiveExactQuantity(input: string, field: string): UiAdapterResult<ExactQuantity> {
  const parsed = parsePlannerDecimalInput(input, field);
  if (!parsed.ok) return invalid([error(field, exactErrorMessage(parsed.error))]);
  if (parsed.value.significand <= 0n) return invalid([error(field, 'Enter a value greater than zero.')]);
  return valid(parsed.value);
}

function exactErrorMessage(errorValue: PlannerDomainError): string {
  return errorValue.code === 'exact_quantity_precision_exceeded'
    ? 'Use no more than six decimal places.'
    : 'Enter a positive decimal using digits and an optional decimal point or comma.';
}

function positiveWhole(input: string, field: string, message: string): UiAdapterResult<number> {
  return wholeInRange(input, 1, Number.MAX_SAFE_INTEGER, field, message);
}

function nonNegativeWhole(input: string, field: string, message: string): UiAdapterResult<number> {
  return wholeInRange(input, 0, Number.MAX_SAFE_INTEGER, field, message);
}

function weekdayNumber(input: string, field: string): UiAdapterResult<number> {
  return wholeInRange(input, 1, 7, field, 'Choose a weekday.');
}

function wholeInRange(input: string, minimum: number, maximum: number, field: string, message: string): UiAdapterResult<number> {
  if (!/^\d+$/.test(input.trim())) return invalid([error(field, message)]);
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) return invalid([error(field, message)]);
  return valid(value);
}

function normalizeDescription(description: string): string | null {
  const trimmed = description.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function domainError(value: PlannerDomainError): UiAdapterError {
  return error(value.field ?? value.path ?? 'form', value.message);
}

function error(field: string, message: string): UiAdapterError {
  return Object.freeze({ field, message });
}

function valid<T>(value: T): UiAdapterResult<T> {
  return Object.freeze({ ok: true as const, value });
}

function invalid<T = never>(errors: readonly UiAdapterError[]): UiAdapterResult<T> {
  return Object.freeze({ ok: false as const, errors: Object.freeze([...errors]) });
}

function errorsOf(result: UiAdapterResult<unknown>): readonly UiAdapterError[] {
  return result.ok ? [] : result.errors;
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')}, and ${words.at(-1)}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function unitSuffix(unit: { readonly unitType: string; readonly standardUnitCode?: string; readonly customUnitLabel?: string }): string {
  if (unit.unitType === 'none') return '';
  const standardLabel = unit.standardUnitCode === undefined
    ? ''
    : standardUnitLabel(unit.standardUnitCode as StandardUnitCode);
  return ` ${unit.unitType === 'custom' ? unit.customUnitLabel : standardLabel}`;
}

function compactUnitSuffix(unit: { readonly unitType: string; readonly standardUnitCode?: string; readonly customUnitLabel?: string }): string {
  if (unit.unitType === 'none') return '';
  const standardSymbol = unit.standardUnitCode === undefined
    ? ''
    : standardUnitLabel(unit.standardUnitCode as StandardUnitCode, 'symbol');
  return ` ${unit.unitType === 'custom' ? unit.customUnitLabel : standardSymbol}`;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0 minutes';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '', minutes > 0 ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '']
    .filter(Boolean)
    .join(' ');
}
