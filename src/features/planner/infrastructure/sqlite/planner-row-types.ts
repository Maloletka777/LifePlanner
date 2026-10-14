export interface HabitCategoryStatusRow {
  readonly id: unknown;
  readonly lifecycle: unknown;
}

export interface HabitRow {
  readonly id: unknown;
  readonly name: unknown;
  readonly description: unknown;
  readonly category_id: unknown;
  readonly active_from: unknown;
  readonly active_to: unknown;
  readonly sort_order: unknown;
  readonly lifecycle: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly archived_at: unknown;
}

export interface HabitScheduleVersionRow {
  readonly id: unknown;
  readonly habit_id: unknown;
  readonly version_number: unknown;
  readonly schedule_type: unknown;
  readonly effective_from: unknown;
  readonly effective_to: unknown;
  readonly evaluation_timezone: unknown;
  readonly interval_days: unknown;
  readonly weekdays_mask: unknown;
  readonly weekday: unknown;
  readonly period_target_count: unknown;
  readonly anchor_date: unknown;
  readonly month_day: unknown;
  readonly month_number: unknown;
  readonly week_start: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export interface HabitTrackingVersionRow {
  readonly id: unknown;
  readonly habit_id: unknown;
  readonly version_number: unknown;
  readonly tracking_mode: unknown;
  readonly comparison_operator: unknown;
  readonly unit_type: unknown;
  readonly standard_unit_code: unknown;
  readonly custom_unit_label: unknown;
  readonly target_significand: unknown;
  readonly target_scale: unknown;
  readonly target_duration_seconds: unknown;
  readonly effective_from: unknown;
  readonly effective_to: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export interface HabitImportanceVersionRow {
  readonly id: unknown;
  readonly habit_id: unknown;
  readonly version_number: unknown;
  readonly importance_level: unknown;
  readonly weight: unknown;
  readonly effective_from: unknown;
  readonly effective_to: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export interface HabitReminderRow {
  readonly id: unknown;
  readonly habit_id: unknown;
  readonly trigger_local_time: unknown;
  readonly timezone_mode: unknown;
  readonly timezone_id: unknown;
  readonly enabled: unknown;
  readonly lifecycle: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly archived_at: unknown;
}

export interface HabitVisualIdentityRow {
  readonly id: unknown;
  readonly habit_id: unknown;
  readonly icon_kind: unknown;
  readonly symbol_key: unknown;
  readonly emoji_value: unknown;
  readonly accent_key: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export interface HabitDependencyVersionRow {
  readonly id: unknown;
  readonly relationship_id: unknown;
  readonly version_number: unknown;
  readonly parent_habit_id: unknown;
  readonly dependent_habit_id: unknown;
  readonly dependency_type: unknown;
  readonly occurrence_mode: unknown;
  readonly effective_from: unknown;
  readonly effective_to: unknown;
  readonly end_reason: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export interface HabitObservationRow {
  readonly id: unknown;
  readonly habit_id: unknown;
  readonly context_mode?: unknown;
  readonly schedule_version_id: unknown;
  readonly detached_schedule_context_id?: unknown;
  readonly tracking_version_id: unknown;
  readonly importance_version_id: unknown;
  readonly dependency_version_id: unknown;
  readonly occurrence_local_date: unknown;
  readonly occurrence_local_time: unknown;
  readonly occurrence_timezone: unknown;
  readonly observation_type: unknown;
  readonly boolean_value: unknown;
  readonly counter_delta: unknown;
  readonly quantity_significand: unknown;
  readonly quantity_scale: unknown;
  readonly duration_seconds: unknown;
  readonly note: unknown;
  readonly supersedes_observation_id: unknown;
  readonly correction_reason: unknown;
  readonly observed_at: unknown;
  readonly created_at: unknown;
}
