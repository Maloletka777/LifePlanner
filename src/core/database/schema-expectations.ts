/**
 * The schema the application believes it is querying, table by table.
 *
 * `user_version` is a number a database asserts about itself, and a database can
 * be wrong: one arrived at version 9 wearing the shape of version 8, and the first
 * thing that said so was a checklist query failing three screens away from the
 * cause. The runner checks this map after every startup, so a divergence is named
 * at launch instead of surfacing as `no such column` inside a feature.
 *
 * **It is measured, not authored.** `schema-verification.cases.ts` builds a
 * database from the migration chain and asserts this map equals what the chain
 * actually produces, in both directions — so it cannot quietly drift from the
 * migrations, and a new migration that forgets to update it fails there rather
 * than on a device.
 *
 * Column order is `cid` order, which is the order the table was declared in.
 */
export const EXPECTED_SCHEMA: Readonly<Record<string, readonly string[]>> = Object.freeze({
  daily_focus_entries: ['id', 'focus_date', 'title', 'body', 'lifecycle', 'provenance_type', 'source_focus_id', 'pinned_from', 'pinned_to', 'converted_task_id', 'created_at', 'updated_at', 'archived_at'],
  daily_focus_items: ['id', 'daily_focus_id', 'text', 'is_checked', 'sort_order', 'lifecycle', 'created_at', 'updated_at', 'archived_at'],
  habit_categories: ['id', 'name', 'normalized_name', 'sort_order', 'lifecycle', 'created_at', 'updated_at', 'archived_at'],
  habit_checklist_items: ['id', 'habit_id', 'text', 'sort_order', 'created_from', 'created_at', 'deleted_from'],
  habit_checklist_ticks: ['checklist_item_id', 'occurrence_local_date', 'done_at'],
  habit_closure_rules: ['habit_id', 'closes_by_checklist', 'updated_at'],
  habit_dependency_versions: ['id', 'relationship_id', 'version_number', 'parent_habit_id', 'dependent_habit_id', 'dependency_type', 'occurrence_mode', 'effective_from', 'effective_to', 'end_reason', 'created_at', 'updated_at'],
  habit_growth: ['id', 'habit_id', 'attempt_number', 'tracked_from', 'stopped_from', 'cue', 'enjoyment', 'created_at', 'updated_at'],
  habit_importance_versions: ['id', 'habit_id', 'version_number', 'importance_level', 'weight', 'effective_from', 'effective_to', 'created_at', 'updated_at'],
  habit_lifecycle_transitions: ['id', 'habit_id', 'sequence_number', 'lifecycle', 'effective_local_date', 'boundary_timezone', 'transitioned_at', 'created_at'],
  habit_observation_schedule_contexts: ['id', 'habit_id', 'schedule_type', 'schedule_effective_from', 'schedule_effective_to', 'evaluation_timezone', 'interval_days', 'weekdays_mask', 'weekday', 'period_target_count', 'anchor_date', 'month_day', 'month_number', 'week_start', 'dependency_type', 'occurrence_mode', 'dependency_effective_from', 'dependency_effective_to', 'detachment_reason', 'detached_at', 'created_at'],
  habit_observations: ['id', 'habit_id', 'context_mode', 'schedule_version_id', 'detached_schedule_context_id', 'tracking_version_id', 'importance_version_id', 'dependency_version_id', 'occurrence_local_date', 'occurrence_local_time', 'occurrence_timezone', 'observation_type', 'boolean_value', 'counter_delta', 'quantity_significand', 'quantity_scale', 'duration_seconds', 'note', 'supersedes_observation_id', 'correction_reason', 'observed_at', 'created_at'],
  habit_ordinary_parent_versions: ['id', 'relationship_id', 'version_number', 'parent_habit_id', 'child_habit_id', 'completion_role', 'effective_from', 'effective_to', 'end_reason', 'created_at', 'updated_at'],
  habit_planned_time_versions: ['id', 'habit_id', 'version_number', 'effective_from', 'effective_to', 'planned_local_time', 'created_at', 'updated_at', 'planned_duration_minutes', 'planned_block'],
  habit_reminder_schedules: ['reminder_id', 'system_identifier', 'status', 'scheduled_for', 'failure_reason', 'updated_at'],
  habit_reminders: ['id', 'habit_id', 'trigger_local_time', 'timezone_mode', 'timezone_id', 'enabled', 'lifecycle', 'created_at', 'updated_at', 'archived_at'],
  habit_schedule_versions: ['id', 'habit_id', 'version_number', 'schedule_type', 'effective_from', 'effective_to', 'evaluation_timezone', 'interval_days', 'weekdays_mask', 'weekday', 'period_target_count', 'anchor_date', 'month_day', 'month_number', 'week_start', 'created_at', 'updated_at'],
  habit_tracking_versions: ['id', 'habit_id', 'version_number', 'tracking_mode', 'comparison_operator', 'unit_type', 'standard_unit_code', 'custom_unit_label', 'target_significand', 'target_scale', 'target_duration_seconds', 'effective_from', 'effective_to', 'created_at', 'updated_at'],
  habit_visual_identities: ['id', 'habit_id', 'icon_kind', 'symbol_key', 'emoji_value', 'accent_key', 'created_at', 'updated_at'],
  habits: ['id', 'name', 'description', 'category_id', 'active_from', 'active_to', 'sort_order', 'lifecycle', 'created_at', 'updated_at', 'archived_at'],
  planner_preferences: ['id', 'progress_mode', 'created_at', 'updated_at'],
});
