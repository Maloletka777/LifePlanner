import type { EffectiveRange } from '../validation/effective-range';
import type { PlannerLocalDate, PlannerTimezone } from '../values/local-date';
import type { ScheduleType } from '../values/stored-values';

declare const weekdaysMaskBrand: unique symbol;
export type WeekdaysMask = number & { readonly [weekdaysMaskBrand]: true };
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface ScheduleDefinitionBase {
  readonly scheduleType: ScheduleType;
  readonly effectiveRange: EffectiveRange;
  readonly evaluationTimezone: PlannerTimezone;
}

export interface DailyScheduleDefinition extends ScheduleDefinitionBase {
  readonly scheduleType: 'daily';
}

export interface SelectedWeekdaysScheduleDefinition
  extends ScheduleDefinitionBase {
  readonly scheduleType: 'selected_weekdays';
  readonly weekdaysMask: WeekdaysMask;
}

export interface EveryNDaysScheduleDefinition extends ScheduleDefinitionBase {
  readonly scheduleType: 'every_n_days';
  readonly intervalDays: number;
  readonly anchorDate: PlannerLocalDate;
}

export interface TimesPerWeekScheduleDefinition extends ScheduleDefinitionBase {
  readonly scheduleType: 'times_per_week';
  readonly periodTargetCount: number;
  readonly weekStart: IsoWeekday;
}

export interface TimesPerMonthScheduleDefinition extends ScheduleDefinitionBase {
  readonly scheduleType: 'times_per_month';
  readonly periodTargetCount: number;
}

export interface TimesPerYearScheduleDefinition extends ScheduleDefinitionBase {
  readonly scheduleType: 'times_per_year';
  readonly periodTargetCount: number;
}

export interface WeeklyScheduleDefinition extends ScheduleDefinitionBase {
  readonly scheduleType: 'weekly';
  readonly weekday: IsoWeekday;
  readonly weekStart: IsoWeekday;
}

export interface MonthlyScheduleDefinition extends ScheduleDefinitionBase {
  readonly scheduleType: 'monthly';
  readonly monthDay: number;
}

export interface YearlyScheduleDefinition extends ScheduleDefinitionBase {
  readonly scheduleType: 'yearly';
  readonly monthNumber: number;
  readonly monthDay: number;
}

export type ScheduleDefinition =
  | DailyScheduleDefinition
  | SelectedWeekdaysScheduleDefinition
  | EveryNDaysScheduleDefinition
  | TimesPerWeekScheduleDefinition
  | TimesPerMonthScheduleDefinition
  | TimesPerYearScheduleDefinition
  | WeeklyScheduleDefinition
  | MonthlyScheduleDefinition
  | YearlyScheduleDefinition;
