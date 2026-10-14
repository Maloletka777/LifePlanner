import type { Migration, MigrationDatabase } from '../migration';

export const PLANNER_LIFECYCLE_SCHEMA_VERSION = 3;

const LIFECYCLE_DDL = String.raw`
CREATE TABLE habit_lifecycle_transitions (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived')),
  effective_local_date TEXT NOT NULL CHECK (length(effective_local_date) = 10),
  boundary_timezone TEXT NOT NULL CHECK (length(trim(boundary_timezone)) > 0),
  transitioned_at INTEGER NOT NULL CHECK (transitioned_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= transitioned_at),
  UNIQUE (habit_id, sequence_number),
  FOREIGN KEY (habit_id) REFERENCES habits (id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE habit_observation_schedule_contexts (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  habit_id TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('daily','selected_weekdays','every_n_days','times_per_week','times_per_month','times_per_year','weekly','monthly','yearly')),
  schedule_effective_from TEXT NOT NULL CHECK (length(schedule_effective_from) = 10),
  schedule_effective_to TEXT,
  evaluation_timezone TEXT NOT NULL CHECK (length(trim(evaluation_timezone)) > 0),
  interval_days INTEGER, weekdays_mask INTEGER, weekday INTEGER,
  period_target_count INTEGER, anchor_date TEXT, month_day INTEGER,
  month_number INTEGER, week_start INTEGER,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('follow_up','prerequisite')),
  occurrence_mode TEXT NOT NULL CHECK (occurrence_mode = 'inherited_parent'),
  dependency_effective_from TEXT NOT NULL CHECK (length(dependency_effective_from) = 10),
  dependency_effective_to TEXT,
  detachment_reason TEXT NOT NULL CHECK (detachment_reason = 'parent_deleted'),
  detached_at INTEGER NOT NULL CHECK (detached_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= detached_at),
  CHECK (schedule_effective_to IS NULL OR (length(schedule_effective_to)=10 AND schedule_effective_to > schedule_effective_from)),
  CHECK (dependency_effective_to IS NULL OR (length(dependency_effective_to)=10 AND dependency_effective_to > dependency_effective_from)),
  CHECK (
    (schedule_type='daily' AND interval_days IS NULL AND weekdays_mask IS NULL AND weekday IS NULL AND period_target_count IS NULL AND anchor_date IS NULL AND month_day IS NULL AND month_number IS NULL AND week_start IS NULL) OR
    (schedule_type='selected_weekdays' AND weekdays_mask BETWEEN 1 AND 127 AND interval_days IS NULL AND weekday IS NULL AND period_target_count IS NULL AND anchor_date IS NULL AND month_day IS NULL AND month_number IS NULL AND week_start IS NULL) OR
    (schedule_type='every_n_days' AND interval_days > 0 AND length(anchor_date)=10 AND anchor_date <= schedule_effective_from AND weekdays_mask IS NULL AND weekday IS NULL AND period_target_count IS NULL AND month_day IS NULL AND month_number IS NULL AND week_start IS NULL) OR
    (schedule_type='times_per_week' AND period_target_count > 0 AND week_start BETWEEN 1 AND 7 AND interval_days IS NULL AND weekdays_mask IS NULL AND weekday IS NULL AND anchor_date IS NULL AND month_day IS NULL AND month_number IS NULL) OR
    (schedule_type IN ('times_per_month','times_per_year') AND period_target_count > 0 AND interval_days IS NULL AND weekdays_mask IS NULL AND weekday IS NULL AND anchor_date IS NULL AND month_day IS NULL AND month_number IS NULL AND week_start IS NULL) OR
    (schedule_type='weekly' AND weekday BETWEEN 1 AND 7 AND week_start BETWEEN 1 AND 7 AND interval_days IS NULL AND weekdays_mask IS NULL AND period_target_count IS NULL AND anchor_date IS NULL AND month_day IS NULL AND month_number IS NULL) OR
    (schedule_type='monthly' AND month_day BETWEEN 1 AND 31 AND interval_days IS NULL AND weekdays_mask IS NULL AND weekday IS NULL AND period_target_count IS NULL AND anchor_date IS NULL AND month_number IS NULL AND week_start IS NULL) OR
    (schedule_type='yearly' AND month_number BETWEEN 1 AND 12 AND month_day BETWEEN 1 AND 31 AND interval_days IS NULL AND weekdays_mask IS NULL AND weekday IS NULL AND period_target_count IS NULL AND anchor_date IS NULL AND week_start IS NULL)
  ),
  FOREIGN KEY (habit_id) REFERENCES habits (id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

const OBSERVATION_DDL = String.raw`
CREATE TABLE habit_observations_v3 (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0), habit_id TEXT NOT NULL,
  context_mode TEXT NOT NULL CHECK (context_mode IN ('live_independent','live_dependent','detached_dependent')),
  schedule_version_id TEXT, detached_schedule_context_id TEXT,
  tracking_version_id TEXT NOT NULL, importance_version_id TEXT NOT NULL, dependency_version_id TEXT,
  occurrence_local_date TEXT NOT NULL CHECK (length(occurrence_local_date)=10),
  occurrence_local_time TEXT CHECK (occurrence_local_time IS NULL OR (occurrence_local_time GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(occurrence_local_time,1,2) AS INTEGER)<=23)),
  occurrence_timezone TEXT NOT NULL CHECK (length(trim(occurrence_timezone))>0),
  observation_type TEXT NOT NULL CHECK (observation_type IN ('checkbox','counter','quantity','duration','avoidance','skipped','void')),
  boolean_value INTEGER, counter_delta INTEGER, quantity_significand INTEGER, quantity_scale INTEGER, duration_seconds INTEGER,
  note TEXT, supersedes_observation_id TEXT,
  correction_reason TEXT CHECK (correction_reason IN ('correct_value','correct_date','duplicate_entry','reversal','other')),
  observed_at INTEGER NOT NULL CHECK (observed_at>=0), created_at INTEGER NOT NULL CHECK (created_at>=0),
  CHECK ((context_mode='live_independent' AND schedule_version_id IS NOT NULL AND dependency_version_id IS NULL AND detached_schedule_context_id IS NULL) OR (context_mode='live_dependent' AND schedule_version_id IS NOT NULL AND dependency_version_id IS NOT NULL AND detached_schedule_context_id IS NULL) OR (context_mode='detached_dependent' AND schedule_version_id IS NULL AND dependency_version_id IS NULL AND detached_schedule_context_id IS NOT NULL)),
  CHECK ((supersedes_observation_id IS NULL AND correction_reason IS NULL AND observation_type<>'void') OR (supersedes_observation_id IS NOT NULL AND correction_reason IS NOT NULL)),
  CHECK (supersedes_observation_id IS NULL OR supersedes_observation_id<>id),
  CHECK (counter_delta IS NULL OR typeof(counter_delta)='integer'),
  CHECK (quantity_significand IS NULL OR typeof(quantity_significand)='integer'),
  CHECK (quantity_scale IS NULL OR typeof(quantity_scale)='integer'),
  CHECK (duration_seconds IS NULL OR typeof(duration_seconds)='integer'),
  CHECK ((observation_type IN ('checkbox','avoidance') AND boolean_value IN (0,1) AND counter_delta IS NULL AND quantity_significand IS NULL AND quantity_scale IS NULL AND duration_seconds IS NULL) OR (observation_type='counter' AND boolean_value IS NULL AND counter_delta>0 AND quantity_significand IS NULL AND quantity_scale IS NULL AND duration_seconds IS NULL) OR (observation_type='quantity' AND boolean_value IS NULL AND counter_delta IS NULL AND quantity_significand>0 AND quantity_scale BETWEEN 0 AND 6 AND duration_seconds IS NULL) OR (observation_type='duration' AND boolean_value IS NULL AND counter_delta IS NULL AND quantity_significand IS NULL AND quantity_scale IS NULL AND duration_seconds>0) OR (observation_type IN ('skipped','void') AND boolean_value IS NULL AND counter_delta IS NULL AND quantity_significand IS NULL AND quantity_scale IS NULL AND duration_seconds IS NULL)),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (schedule_version_id) REFERENCES habit_schedule_versions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (detached_schedule_context_id) REFERENCES habit_observation_schedule_contexts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tracking_version_id) REFERENCES habit_tracking_versions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (importance_version_id) REFERENCES habit_importance_versions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (dependency_version_id) REFERENCES habit_dependency_versions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_observation_id) REFERENCES habit_observations_v3(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

const OBSERVATION_COLUMNS = 'id,habit_id,schedule_version_id,tracking_version_id,importance_version_id,dependency_version_id,occurrence_local_date,occurrence_local_time,occurrence_timezone,observation_type,boolean_value,counter_delta,quantity_significand,quantity_scale,duration_seconds,note,supersedes_observation_id,correction_reason,observed_at,created_at';

const INDEX_DDL = String.raw`
CREATE INDEX idx_habit_lifecycle_effective ON habit_lifecycle_transitions(habit_id,effective_local_date DESC,sequence_number DESC);
CREATE INDEX idx_habits_lifecycle_sort ON habits(lifecycle,sort_order,id);
CREATE INDEX idx_habit_observation_contexts_habit ON habit_observation_schedule_contexts(habit_id,id);
CREATE UNIQUE INDEX uq_habit_observations_detached_context ON habit_observations(detached_schedule_context_id) WHERE detached_schedule_context_id IS NOT NULL;
CREATE INDEX idx_habit_observations_detached_habit_date ON habit_observations(habit_id,occurrence_local_date,created_at) WHERE context_mode='detached_dependent';
CREATE INDEX idx_habit_observations_habit_date ON habit_observations(habit_id,occurrence_local_date,created_at);
CREATE INDEX idx_habit_observations_date_range ON habit_observations(occurrence_local_date,habit_id,created_at);
CREATE INDEX idx_habit_observations_schedule_version ON habit_observations(schedule_version_id);
CREATE INDEX idx_habit_observations_tracking_version ON habit_observations(tracking_version_id);
CREATE INDEX idx_habit_observations_importance_version ON habit_observations(importance_version_id);
CREATE INDEX idx_habit_observations_dependency_version ON habit_observations(dependency_version_id) WHERE dependency_version_id IS NOT NULL;
CREATE UNIQUE INDEX uq_habit_observations_superseded_once ON habit_observations(supersedes_observation_id) WHERE supersedes_observation_id IS NOT NULL;`;

type HabitSeedRow = Readonly<{ id:string; lifecycle:string; active_from:string; created_at:number; archived_at:number|null }>;
type ScheduleRow = Readonly<{ id:string; habit_id:string; evaluation_timezone:string; effective_from:string; effective_to:string|null }>;
type DependencyRow = Readonly<{ parent_habit_id:string; dependent_habit_id:string; effective_from:string; effective_to:string|null }>;

async function scalar(database: MigrationDatabase, sql: string): Promise<number> {
  const row = await database.getFirstAsync<{ value:number }>(sql);
  if (row === null || !Number.isInteger(row.value)) throw new Error('Migration 003 count verification failed.');
  return row.value;
}

function contains(from:string,to:string|null,date:string) { return from<=date && (to===null || date<to); }

async function seedLifecycle(database: MigrationDatabase): Promise<void> {
  if (database.getAllAsync === undefined) throw new Error('Migration 003 requires bounded row reads.');
  const habits = await database.getAllAsync<HabitSeedRow>('SELECT id,lifecycle,active_from,created_at,archived_at FROM habits ORDER BY id;');
  const schedules = await database.getAllAsync<ScheduleRow>('SELECT id,habit_id,evaluation_timezone,effective_from,effective_to FROM habit_schedule_versions;');
  const dependencies = await database.getAllAsync<DependencyRow>('SELECT parent_habit_id,dependent_habit_id,effective_from,effective_to FROM habit_dependency_versions;');
  for (const habit of habits) {
    const validProjection = habit.lifecycle==='active' ? habit.archived_at===null : habit.lifecycle==='archived' && Number.isSafeInteger(habit.archived_at) && (habit.archived_at as number)>=habit.created_at;
    if (!validProjection || !Number.isSafeInteger(habit.created_at) || habit.created_at<0) throw new Error('Migration 003 found malformed legacy lifecycle state.');
    let owner = habit.id;
    const visited = new Set<string>();
    for (let depth=0; depth<=5; depth+=1) {
      if (visited.has(owner)) throw new Error('Migration 003 found a cyclic dependency chain.');
      visited.add(owner);
      const incoming = dependencies.filter((d)=>d.dependent_habit_id===owner && contains(d.effective_from,d.effective_to,habit.active_from));
      if (incoming.length>1) throw new Error('Migration 003 found ambiguous dependency ancestry.');
      if (incoming.length===0) break;
      owner=incoming[0].parent_habit_id;
      if (depth===5) throw new Error('Migration 003 found dependency ancestry beyond the approved depth.');
    }
    const applicable=schedules.filter((s)=>s.habit_id===owner && contains(s.effective_from,s.effective_to,habit.active_from));
    if (applicable.length!==1) throw new Error('Migration 003 could not resolve one root schedule.');
    try { new Intl.DateTimeFormat('en',{timeZone:applicable[0].evaluation_timezone}).format(0); } catch { throw new Error('Migration 003 found an invalid root schedule timezone.'); }
    const instant=habit.lifecycle==='active' ? habit.created_at : habit.archived_at;
    if (instant===null) throw new Error('Migration 003 found a missing lifecycle instant.');
    await database.execAsync(`INSERT INTO habit_lifecycle_transitions(id,habit_id,sequence_number,lifecycle,effective_local_date,boundary_timezone,transitioned_at,created_at) VALUES (${quote(habit.id)},${quote(habit.id)},1,${quote(habit.lifecycle)},${quote(habit.active_from)},${quote(applicable[0].evaluation_timezone)},${instant},${instant});`);
  }
}

function quote(value:string) { return `'${value.replaceAll("'","''")}'`; }

async function apply(database: MigrationDatabase): Promise<void> {
  const version=await scalar(database,'SELECT user_version AS value FROM pragma_user_version;');
  if (version!==2) throw new Error('Migration 003 requires source schema version 2.');
  const foreignKeys=await scalar(database,'SELECT foreign_keys AS value FROM pragma_foreign_keys;');
  if (foreignKeys!==1) throw new Error('Migration 003 requires foreign keys enabled.');
  const existing=await scalar(database,"SELECT count(*) AS value FROM sqlite_schema WHERE name IN ('habit_lifecycle_transitions','habit_observation_schedule_contexts','habit_observations_v3','idx_habit_lifecycle_effective','idx_habits_lifecycle_sort');");
  if (existing!==0 || await scalar(database,'SELECT count(*) AS value FROM pragma_foreign_key_check;')!==0) throw new Error('Migration 003 source integrity failed.');
  const sourceCount=await scalar(database,'SELECT count(*) AS value FROM habit_observations;');
  await database.execAsync('PRAGMA defer_foreign_keys = ON;');
  if (await scalar(database,'SELECT defer_foreign_keys AS value FROM pragma_defer_foreign_keys;')!==1) throw new Error('Migration 003 could not defer foreign keys.');
  await database.execAsync(LIFECYCLE_DDL);
  await database.execAsync(OBSERVATION_DDL);
  await database.execAsync(`INSERT INTO habit_observations_v3(id,habit_id,context_mode,schedule_version_id,detached_schedule_context_id,tracking_version_id,importance_version_id,dependency_version_id,occurrence_local_date,occurrence_local_time,occurrence_timezone,observation_type,boolean_value,counter_delta,quantity_significand,quantity_scale,duration_seconds,note,supersedes_observation_id,correction_reason,observed_at,created_at) SELECT id,habit_id,CASE WHEN dependency_version_id IS NULL THEN 'live_independent' ELSE 'live_dependent' END,schedule_version_id,NULL,tracking_version_id,importance_version_id,dependency_version_id,occurrence_local_date,occurrence_local_time,occurrence_timezone,observation_type,boolean_value,counter_delta,quantity_significand,quantity_scale,duration_seconds,note,supersedes_observation_id,correction_reason,observed_at,created_at FROM habit_observations;`);
  if (await scalar(database,'SELECT count(*) AS value FROM habit_observations_v3;')!==sourceCount || await scalar(database,`SELECT count(*) AS value FROM (SELECT ${OBSERVATION_COLUMNS} FROM habit_observations EXCEPT SELECT ${OBSERVATION_COLUMNS} FROM habit_observations_v3);`)!==0 || await scalar(database,`SELECT count(*) AS value FROM (SELECT ${OBSERVATION_COLUMNS} FROM habit_observations_v3 EXCEPT SELECT ${OBSERVATION_COLUMNS} FROM habit_observations);`)!==0) throw new Error('Migration 003 observation copy verification failed.');
  await seedLifecycle(database);
  await database.execAsync('DROP TABLE habit_observations; ALTER TABLE habit_observations_v3 RENAME TO habit_observations;');
  await database.execAsync(INDEX_DDL);
  const habitCount=await scalar(database,'SELECT count(*) AS value FROM habits;');
  if (await scalar(database,'SELECT count(*) AS value FROM habit_lifecycle_transitions;')!==habitCount || await scalar(database,'SELECT count(*) AS value FROM habit_observation_schedule_contexts;')!==0 || await scalar(database,"SELECT count(*) AS value FROM habit_observations WHERE context_mode='detached_dependent' OR detached_schedule_context_id IS NOT NULL;")!==0 || await scalar(database,'SELECT count(*) AS value FROM pragma_foreign_key_check;')!==0) throw new Error('Migration 003 final verification failed.');
}

export const PLANNER_LIFECYCLE_MIGRATION: Migration = Object.freeze({
  version: PLANNER_LIFECYCLE_SCHEMA_VERSION,
  name: 'planner-lifecycle-and-detached-observation-context',
  setUserVersionSql: 'PRAGMA user_version = 3;',
  apply,
});
