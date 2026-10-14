import type { SQLiteDatabase } from 'expo-sqlite';

import type { Migration } from '../migration';

export const PLANNER_CORE_SCHEMA_VERSION = 1;
const SET_PLANNER_CORE_SCHEMA_VERSION_SQL = 'PRAGMA user_version = 1;';

export const PLANNER_CORE_SCHEMA_V1_SQL = String.raw`PRAGMA foreign_keys = ON;

CREATE TABLE planner_preferences (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    progress_mode TEXT NOT NULL DEFAULT 'equal'
        CHECK (progress_mode IN ('equal', 'weighted')),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
);

CREATE TABLE habit_categories (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    name TEXT NOT NULL CHECK (
        length(trim(name)) BETWEEN 1 AND 100
    ),
    normalized_name TEXT NOT NULL CHECK (
        length(normalized_name) BETWEEN 1 AND 100
    ),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    lifecycle TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle IN ('active', 'archived')),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    archived_at INTEGER,
    CHECK (
        (lifecycle = 'active' AND archived_at IS NULL)
        OR
        (lifecycle = 'archived' AND archived_at IS NOT NULL
            AND archived_at >= created_at)
    )
);

CREATE UNIQUE INDEX uq_habit_categories_active_name
    ON habit_categories (normalized_name)
    WHERE lifecycle = 'active';

CREATE INDEX idx_habit_categories_active_sort
    ON habit_categories (sort_order, id)
    WHERE lifecycle = 'active';

CREATE TABLE habits (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    name TEXT NOT NULL CHECK (
        length(trim(name)) BETWEEN 1 AND 200
    ),
    description TEXT,
    category_id TEXT,
    active_from TEXT NOT NULL CHECK (length(active_from) = 10),
    active_to TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    lifecycle TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle IN ('active', 'archived')),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    archived_at INTEGER,
    CHECK (
        active_to IS NULL
        OR (length(active_to) = 10 AND active_to > active_from)
    ),
    CHECK (
        (lifecycle = 'active' AND archived_at IS NULL)
        OR
        (lifecycle = 'archived' AND archived_at IS NOT NULL
            AND archived_at >= created_at)
    ),
    FOREIGN KEY (category_id) REFERENCES habit_categories (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_habits_active_sort
    ON habits (sort_order, id)
    WHERE lifecycle = 'active';

CREATE INDEX idx_habits_category_active_sort
    ON habits (category_id, sort_order, id)
    WHERE lifecycle = 'active';

CREATE TABLE habit_schedule_versions (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    habit_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    schedule_type TEXT NOT NULL CHECK (schedule_type IN (
        'daily', 'selected_weekdays', 'every_n_days',
        'times_per_week', 'times_per_month', 'times_per_year',
        'weekly', 'monthly', 'yearly'
    )),
    effective_from TEXT NOT NULL CHECK (length(effective_from) = 10),
    effective_to TEXT,
    evaluation_timezone TEXT NOT NULL
        CHECK (length(trim(evaluation_timezone)) > 0),
    interval_days INTEGER,
    weekdays_mask INTEGER,
    weekday INTEGER,
    period_target_count INTEGER,
    anchor_date TEXT,
    month_day INTEGER,
    month_number INTEGER,
    week_start INTEGER,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (habit_id, version_number),
    UNIQUE (habit_id, effective_from),
    CHECK (
        effective_to IS NULL
        OR (length(effective_to) = 10 AND effective_to > effective_from)
    ),
    CHECK (
        (schedule_type = 'daily'
            AND interval_days IS NULL AND weekdays_mask IS NULL
            AND weekday IS NULL AND period_target_count IS NULL
            AND anchor_date IS NULL AND month_day IS NULL
            AND month_number IS NULL AND week_start IS NULL)
        OR
        (schedule_type = 'selected_weekdays'
            AND weekdays_mask BETWEEN 1 AND 127
            AND interval_days IS NULL AND weekday IS NULL
            AND period_target_count IS NULL AND anchor_date IS NULL
            AND month_day IS NULL AND month_number IS NULL
            AND week_start IS NULL)
        OR
        (schedule_type = 'every_n_days'
            AND interval_days > 0 AND length(anchor_date) = 10
            AND anchor_date <= effective_from
            AND weekdays_mask IS NULL AND weekday IS NULL
            AND period_target_count IS NULL AND month_day IS NULL
            AND month_number IS NULL AND week_start IS NULL)
        OR
        (schedule_type = 'times_per_week'
            AND period_target_count > 0 AND week_start BETWEEN 1 AND 7
            AND interval_days IS NULL AND weekdays_mask IS NULL
            AND weekday IS NULL AND anchor_date IS NULL
            AND month_day IS NULL AND month_number IS NULL)
        OR
        (schedule_type IN ('times_per_month', 'times_per_year')
            AND period_target_count > 0
            AND interval_days IS NULL AND weekdays_mask IS NULL
            AND weekday IS NULL AND anchor_date IS NULL
            AND month_day IS NULL AND month_number IS NULL
            AND week_start IS NULL)
        OR
        (schedule_type = 'weekly'
            AND weekday BETWEEN 1 AND 7 AND week_start BETWEEN 1 AND 7
            AND interval_days IS NULL AND weekdays_mask IS NULL
            AND period_target_count IS NULL AND anchor_date IS NULL
            AND month_day IS NULL AND month_number IS NULL)
        OR
        (schedule_type = 'monthly'
            AND month_day BETWEEN 1 AND 31
            AND interval_days IS NULL AND weekdays_mask IS NULL
            AND weekday IS NULL AND period_target_count IS NULL
            AND anchor_date IS NULL AND month_number IS NULL
            AND week_start IS NULL)
        OR
        (schedule_type = 'yearly'
            AND month_number BETWEEN 1 AND 12
            AND month_day BETWEEN 1 AND 31
            AND interval_days IS NULL AND weekdays_mask IS NULL
            AND weekday IS NULL AND period_target_count IS NULL
            AND anchor_date IS NULL AND week_start IS NULL)
    ),
    FOREIGN KEY (habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_habit_schedule_open
    ON habit_schedule_versions (habit_id)
    WHERE effective_to IS NULL;

CREATE INDEX idx_habit_schedule_applicable
    ON habit_schedule_versions (habit_id, effective_from, effective_to);

CREATE TABLE habit_tracking_versions (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    habit_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    tracking_mode TEXT NOT NULL CHECK (tracking_mode IN (
        'checkbox', 'counter', 'quantity', 'duration', 'avoidance'
    )),
    comparison_operator TEXT NOT NULL CHECK (comparison_operator IN (
        'at_least', 'at_most', 'equal', 'boolean_success'
    )),
    unit_type TEXT NOT NULL CHECK (unit_type IN (
        'none', 'standard', 'custom'
    )),
    standard_unit_code TEXT,
    custom_unit_label TEXT,
    target_significand INTEGER,
    target_scale INTEGER,
    target_duration_seconds INTEGER,
    effective_from TEXT NOT NULL CHECK (length(effective_from) = 10),
    effective_to TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (habit_id, version_number),
    UNIQUE (habit_id, effective_from),
    CHECK (
        effective_to IS NULL
        OR (length(effective_to) = 10 AND effective_to > effective_from)
    ),
    CHECK (
        target_significand IS NULL
        OR typeof(target_significand) = 'integer'
    ),
    CHECK (target_scale IS NULL OR typeof(target_scale) = 'integer'),
    CHECK (
        target_duration_seconds IS NULL
        OR typeof(target_duration_seconds) = 'integer'
    ),
    CHECK (
        (unit_type = 'none'
            AND standard_unit_code IS NULL AND custom_unit_label IS NULL)
        OR
        (unit_type = 'standard'
            AND length(trim(standard_unit_code)) > 0
            AND custom_unit_label IS NULL)
        OR
        (unit_type = 'custom'
            AND standard_unit_code IS NULL
            AND length(trim(custom_unit_label)) BETWEEN 1 AND 40)
    ),
    CHECK (
        (tracking_mode IN ('checkbox', 'avoidance')
            AND comparison_operator = 'boolean_success'
            AND unit_type = 'none'
            AND target_significand IS NULL AND target_scale IS NULL
            AND target_duration_seconds IS NULL)
        OR
        (tracking_mode = 'counter'
            AND comparison_operator IN ('at_least', 'at_most', 'equal')
            AND target_significand > 0 AND target_scale = 0
            AND target_duration_seconds IS NULL)
        OR
        (tracking_mode = 'quantity'
            AND comparison_operator IN ('at_least', 'at_most', 'equal')
            AND unit_type IN ('standard', 'custom')
            AND target_significand > 0 AND target_scale BETWEEN 0 AND 6
            AND target_duration_seconds IS NULL)
        OR
        (tracking_mode = 'duration'
            AND comparison_operator IN ('at_least', 'at_most', 'equal')
            AND unit_type = 'standard'
            AND standard_unit_code = 'second'
            AND target_significand IS NULL AND target_scale IS NULL
            AND target_duration_seconds > 0)
    ),
    FOREIGN KEY (habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_habit_tracking_open
    ON habit_tracking_versions (habit_id)
    WHERE effective_to IS NULL;

CREATE INDEX idx_habit_tracking_applicable
    ON habit_tracking_versions (habit_id, effective_from, effective_to);

CREATE TABLE habit_importance_versions (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    habit_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    importance_level TEXT NOT NULL CHECK (importance_level IN (
        'low', 'normal', 'high', 'critical'
    )),
    weight INTEGER NOT NULL,
    effective_from TEXT NOT NULL CHECK (length(effective_from) = 10),
    effective_to TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (habit_id, version_number),
    UNIQUE (habit_id, effective_from),
    CHECK (
        (importance_level = 'low' AND weight = 1)
        OR (importance_level = 'normal' AND weight = 2)
        OR (importance_level = 'high' AND weight = 3)
        OR (importance_level = 'critical' AND weight = 4)
    ),
    CHECK (
        effective_to IS NULL
        OR (length(effective_to) = 10 AND effective_to > effective_from)
    ),
    FOREIGN KEY (habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_habit_importance_open
    ON habit_importance_versions (habit_id)
    WHERE effective_to IS NULL;

CREATE INDEX idx_habit_importance_applicable
    ON habit_importance_versions (habit_id, effective_from, effective_to);

CREATE TABLE habit_dependency_versions (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    relationship_id TEXT NOT NULL CHECK (length(trim(relationship_id)) > 0),
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    parent_habit_id TEXT NOT NULL,
    dependent_habit_id TEXT NOT NULL,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN (
        'follow_up', 'prerequisite'
    )),
    occurrence_mode TEXT NOT NULL DEFAULT 'inherited_parent'
        CHECK (occurrence_mode = 'inherited_parent'),
    effective_from TEXT NOT NULL CHECK (length(effective_from) = 10),
    effective_to TEXT,
    end_reason TEXT CHECK (end_reason IN (
        'replaced', 'unlinked', 'parent_archived', 'dependent_archived'
    )),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (relationship_id, version_number),
    UNIQUE (relationship_id, effective_from),
    CHECK (parent_habit_id <> dependent_habit_id),
    CHECK (
        (effective_to IS NULL AND end_reason IS NULL)
        OR
        (effective_to IS NOT NULL AND length(effective_to) = 10
            AND effective_to > effective_from AND end_reason IS NOT NULL)
    ),
    FOREIGN KEY (parent_habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (dependent_habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_habit_dependency_open_relationship
    ON habit_dependency_versions (relationship_id)
    WHERE effective_to IS NULL;

CREATE UNIQUE INDEX uq_habit_dependency_open_pair
    ON habit_dependency_versions (parent_habit_id, dependent_habit_id)
    WHERE effective_to IS NULL;

CREATE UNIQUE INDEX uq_habit_dependency_open_incoming
    ON habit_dependency_versions (dependent_habit_id)
    WHERE effective_to IS NULL;

CREATE INDEX idx_habit_dependency_parent_range
    ON habit_dependency_versions (
        parent_habit_id, effective_from, effective_to, dependent_habit_id
    );

CREATE INDEX idx_habit_dependency_dependent_range
    ON habit_dependency_versions (
        dependent_habit_id, effective_from, effective_to, parent_habit_id
    );

CREATE INDEX idx_habit_dependency_logical_range
    ON habit_dependency_versions (
        relationship_id, effective_from, effective_to
    );

CREATE TABLE habit_reminders (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    habit_id TEXT NOT NULL,
    trigger_local_time TEXT NOT NULL CHECK (
        trigger_local_time GLOB '[0-2][0-9]:[0-5][0-9]'
        AND CAST(substr(trigger_local_time, 1, 2) AS INTEGER) <= 23
    ),
    timezone_mode TEXT NOT NULL CHECK (timezone_mode IN (
        'schedule_timezone', 'fixed_timezone'
    )),
    timezone_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    lifecycle TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle IN ('active', 'archived')),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    archived_at INTEGER,
    CHECK (
        (timezone_mode = 'schedule_timezone' AND timezone_id IS NULL)
        OR
        (timezone_mode = 'fixed_timezone'
            AND length(trim(timezone_id)) > 0)
    ),
    CHECK (
        (lifecycle = 'active' AND archived_at IS NULL)
        OR
        (lifecycle = 'archived' AND archived_at IS NOT NULL
            AND archived_at >= created_at)
    ),
    FOREIGN KEY (habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_habit_reminder_active_schedule_zone
    ON habit_reminders (habit_id, trigger_local_time)
    WHERE lifecycle = 'active'
        AND timezone_mode = 'schedule_timezone';

CREATE UNIQUE INDEX uq_habit_reminder_active_fixed_zone
    ON habit_reminders (habit_id, trigger_local_time, timezone_id)
    WHERE lifecycle = 'active'
        AND timezone_mode = 'fixed_timezone';

CREATE INDEX idx_habit_reminders_active
    ON habit_reminders (habit_id, enabled, trigger_local_time)
    WHERE lifecycle = 'active';

CREATE TABLE habit_observations (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    habit_id TEXT NOT NULL,
    schedule_version_id TEXT NOT NULL,
    tracking_version_id TEXT NOT NULL,
    importance_version_id TEXT NOT NULL,
    dependency_version_id TEXT,
    occurrence_local_date TEXT NOT NULL
        CHECK (length(occurrence_local_date) = 10),
    occurrence_local_time TEXT CHECK (
        occurrence_local_time IS NULL
        OR (
            occurrence_local_time GLOB '[0-2][0-9]:[0-5][0-9]'
            AND CAST(substr(occurrence_local_time, 1, 2) AS INTEGER) <= 23
        )
    ),
    occurrence_timezone TEXT NOT NULL
        CHECK (length(trim(occurrence_timezone)) > 0),
    observation_type TEXT NOT NULL CHECK (observation_type IN (
        'checkbox', 'counter', 'quantity', 'duration', 'avoidance',
        'skipped', 'void'
    )),
    boolean_value INTEGER,
    counter_delta INTEGER,
    quantity_significand INTEGER,
    quantity_scale INTEGER,
    duration_seconds INTEGER,
    note TEXT,
    supersedes_observation_id TEXT,
    correction_reason TEXT CHECK (correction_reason IN (
        'correct_value', 'correct_date', 'duplicate_entry', 'reversal', 'other'
    )),
    observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    CHECK (
        (supersedes_observation_id IS NULL AND correction_reason IS NULL
            AND observation_type <> 'void')
        OR
        (supersedes_observation_id IS NOT NULL
            AND correction_reason IS NOT NULL)
    ),
    CHECK (
        supersedes_observation_id IS NULL
        OR supersedes_observation_id <> id
    ),
    CHECK (counter_delta IS NULL OR typeof(counter_delta) = 'integer'),
    CHECK (
        quantity_significand IS NULL
        OR typeof(quantity_significand) = 'integer'
    ),
    CHECK (quantity_scale IS NULL OR typeof(quantity_scale) = 'integer'),
    CHECK (
        duration_seconds IS NULL
        OR typeof(duration_seconds) = 'integer'
    ),
    CHECK (
        (observation_type IN ('checkbox', 'avoidance')
            AND boolean_value IN (0, 1)
            AND counter_delta IS NULL
            AND quantity_significand IS NULL AND quantity_scale IS NULL
            AND duration_seconds IS NULL)
        OR
        (observation_type = 'counter'
            AND boolean_value IS NULL AND counter_delta > 0
            AND quantity_significand IS NULL AND quantity_scale IS NULL
            AND duration_seconds IS NULL)
        OR
        (observation_type = 'quantity'
            AND boolean_value IS NULL AND counter_delta IS NULL
            AND quantity_significand > 0
            AND quantity_scale BETWEEN 0 AND 6
            AND duration_seconds IS NULL)
        OR
        (observation_type = 'duration'
            AND boolean_value IS NULL AND counter_delta IS NULL
            AND quantity_significand IS NULL AND quantity_scale IS NULL
            AND duration_seconds > 0)
        OR
        (observation_type IN ('skipped', 'void')
            AND boolean_value IS NULL AND counter_delta IS NULL
            AND quantity_significand IS NULL AND quantity_scale IS NULL
            AND duration_seconds IS NULL)
    ),
    FOREIGN KEY (habit_id) REFERENCES habits (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (schedule_version_id) REFERENCES habit_schedule_versions (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (tracking_version_id) REFERENCES habit_tracking_versions (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (importance_version_id) REFERENCES habit_importance_versions (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (dependency_version_id) REFERENCES habit_dependency_versions (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_observation_id) REFERENCES habit_observations (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_habit_observations_habit_date
    ON habit_observations (habit_id, occurrence_local_date, created_at);

CREATE INDEX idx_habit_observations_date_range
    ON habit_observations (occurrence_local_date, habit_id, created_at);

CREATE INDEX idx_habit_observations_schedule_version
    ON habit_observations (schedule_version_id);

CREATE INDEX idx_habit_observations_tracking_version
    ON habit_observations (tracking_version_id);

CREATE INDEX idx_habit_observations_importance_version
    ON habit_observations (importance_version_id);

CREATE INDEX idx_habit_observations_dependency_version
    ON habit_observations (dependency_version_id)
    WHERE dependency_version_id IS NOT NULL;

CREATE UNIQUE INDEX uq_habit_observations_superseded_once
    ON habit_observations (supersedes_observation_id)
    WHERE supersedes_observation_id IS NOT NULL;

CREATE TABLE daily_focus_entries (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    focus_date TEXT NOT NULL CHECK (length(focus_date) = 10),
    title TEXT,
    body TEXT,
    lifecycle TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle IN ('active', 'archived')),
    provenance_type TEXT NOT NULL DEFAULT 'original'
        CHECK (provenance_type IN (
            'original', 'copied_forward', 'extended'
        )),
    source_focus_id TEXT,
    pinned_from TEXT,
    pinned_to TEXT,
    converted_task_id TEXT CHECK (
        converted_task_id IS NULL OR length(trim(converted_task_id)) > 0
    ),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    archived_at INTEGER,
    CHECK (
        (provenance_type = 'original' AND source_focus_id IS NULL)
        OR
        (provenance_type IN ('copied_forward', 'extended')
            AND source_focus_id IS NOT NULL)
    ),
    CHECK (source_focus_id IS NULL OR source_focus_id <> id),
    CHECK (
        (pinned_from IS NULL AND pinned_to IS NULL)
        OR
        (pinned_from IS NOT NULL AND pinned_to IS NOT NULL
            AND length(pinned_from) = 10 AND length(pinned_to) = 10
            AND pinned_to > pinned_from)
    ),
    CHECK (
        (lifecycle = 'active' AND archived_at IS NULL)
        OR
        (lifecycle = 'archived' AND archived_at IS NOT NULL
            AND archived_at >= created_at)
    ),
    FOREIGN KEY (source_focus_id) REFERENCES daily_focus_entries (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_daily_focus_active_date
    ON daily_focus_entries (focus_date)
    WHERE lifecycle = 'active';

CREATE INDEX idx_daily_focus_history
    ON daily_focus_entries (focus_date DESC, created_at DESC);

CREATE INDEX idx_daily_focus_active_pinned
    ON daily_focus_entries (pinned_from, pinned_to)
    WHERE lifecycle = 'active' AND pinned_from IS NOT NULL;

CREATE INDEX idx_daily_focus_source
    ON daily_focus_entries (source_focus_id)
    WHERE source_focus_id IS NOT NULL;

CREATE TABLE daily_focus_items (
    id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
    daily_focus_id TEXT NOT NULL,
    text TEXT NOT NULL CHECK (length(trim(text)) > 0),
    is_checked INTEGER NOT NULL DEFAULT 0 CHECK (is_checked IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    lifecycle TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle IN ('active', 'archived')),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    archived_at INTEGER,
    CHECK (
        (lifecycle = 'active' AND archived_at IS NULL)
        OR
        (lifecycle = 'archived' AND archived_at IS NOT NULL
            AND archived_at >= created_at)
    ),
    FOREIGN KEY (daily_focus_id) REFERENCES daily_focus_entries (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_daily_focus_items_active_order
    ON daily_focus_items (daily_focus_id, sort_order)
    WHERE lifecycle = 'active';

CREATE INDEX idx_daily_focus_items_owner_order
    ON daily_focus_items (daily_focus_id, lifecycle, sort_order, id);
`;

export const PLANNER_CORE_MIGRATION: Migration = Object.freeze({
  version: PLANNER_CORE_SCHEMA_VERSION,
  name: 'planner-core',
  setUserVersionSql: SET_PLANNER_CORE_SCHEMA_VERSION_SQL,
  async apply(database: SQLiteDatabase): Promise<void> {
    await database.execAsync(PLANNER_CORE_SCHEMA_V1_SQL);
  },
});
