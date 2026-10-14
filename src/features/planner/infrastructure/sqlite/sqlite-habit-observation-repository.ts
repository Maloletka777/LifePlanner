import {
  exactQuantitySignificandForPersistence,
  failure,
  resolvePlannerOccurrencesForDate,
  success,
  validateIndependentObservationContext,
  validateObservationChain,
  validateObservationValue,
  type IndependentObservationContext,
  type ObservationChain,
  type ObservationFact,
  type ObservationValue,
  type PlannerDomainError,
  type PlannerId,
  type PlannerLocalDate,
  type PlannerTimezone,
  type Result,
  type TrackingDefinition,
} from '../../domain';
import {
  createPlannerPersistenceError,
  type CorrectObservationPersistenceInput,
  type PlannerPersistenceError,
  type RecordObservationPersistenceInput,
} from '../../repositories';
import { mapHabitDependencyRow } from './planner-dependency-row-mappers';
import { mapHabitObservationRow } from './planner-observation-row-mappers';
import {
  mapHabitRow,
  mapImportanceRow,
  mapScheduleRow,
  mapTrackingRow,
} from './planner-row-mappers';
import type {
  HabitDependencyVersionRow,
  HabitImportanceVersionRow,
  HabitObservationRow,
  HabitRow,
  HabitScheduleVersionRow,
  HabitTrackingVersionRow,
} from './planner-row-types';
import type { PlannerSqliteDatabase } from './planner-sqlite-database';
import { loadPlannerOccurrenceData as loadOccurrenceData } from './sqlite-planner-occurrence-repository';

interface ObservationPersistenceContext {
  readonly habitId: PlannerId;
  readonly scheduleVersionId: PlannerId;
  readonly trackingVersionId: PlannerId;
  readonly importanceVersionId: PlannerId;
  readonly dependencyVersionId: PlannerId | null;
  readonly occurrenceWindow: Readonly<{
    start: PlannerLocalDate;
    endExclusive: PlannerLocalDate;
  }>;
  readonly tracking: TrackingDefinition;
}

export async function recordHabitObservation(
  database: PlannerSqliteDatabase,
  input: RecordObservationPersistenceInput,
): Promise<Result<ObservationFact, PlannerPersistenceError>> {
  const routineContainer = await database.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count
     FROM habit_ordinary_parent_versions
     WHERE parent_habit_id=$habitId
       AND completion_role='routine_step'
       AND effective_from<=$occurrenceLocalDate
       AND (effective_to IS NULL OR effective_to>$occurrenceLocalDate);`,
    {
      $habitId: input.habitId,
      $occurrenceLocalDate: input.occurrenceLocalDate,
    },
  );
  if (routineContainer === null || !Number.isSafeInteger(routineContainer.count)) {
    return integrityFailure('The routine-container relationship state is malformed.');
  }
  if (routineContainer.count > 0) {
    return persistenceFailure(
      'observation_routine_container_derived',
      'Routine completion is derived from its applicable steps.',
    );
  }
  const context = await resolveObservationPersistenceContext(database, {
    habitId: input.habitId,
    occurrenceLocalDate: input.occurrenceLocalDate,
    occurrenceTimezone: input.occurrenceTimezone,
    value: input.value,
    allowVoid: false,
  }, 'any');
  if (!context.ok) return context;
  const policy = await enforceOccurrenceStatePolicy(
    database,
    context.value,
    input.value,
    null,
  );
  if (!policy.ok) return policy;
  await insertObservation(database, {
    ...input,
    scheduleVersionId: context.value.scheduleVersionId,
    trackingVersionId: context.value.trackingVersionId,
    importanceVersionId: context.value.importanceVersionId,
    dependencyVersionId: context.value.dependencyVersionId,
    supersedesObservationId: null,
    correctionReason: null,
  });
  const readback = await findObservation(database, input.observationId);
  if (!readback.ok) return readback;
  if (
    readback.value === null ||
    !factMatchesResolvedContext(readback.value, context.value) ||
    !factMatchesWrite(readback.value, input, null, null)
  ) {
    return integrityFailure('The inserted observation failed transactional readback verification.');
  }
  return success(readback.value);
}

export async function correctHabitObservation(
  database: PlannerSqliteDatabase,
  input: CorrectObservationPersistenceInput,
): Promise<Result<ObservationChain, PlannerPersistenceError>> {
  const existing = await loadObservationChain(database, input.selectedObservationId);
  if (!existing.ok) return existing;
  if (existing.value === null) {
    return persistenceFailure('observation_not_found', 'The selected observation does not exist.');
  }
  const selected = validateObservationChain(existing.value.facts, {
    selectedObservationId: input.selectedObservationId,
  });
  if (!selected.ok) return domainFailure(selected.error);

  const context = await resolveObservationPersistenceContext(database, {
    habitId: selected.value.currentLeaf.habitId,
    occurrenceLocalDate: input.occurrenceLocalDate,
    occurrenceTimezone: input.occurrenceTimezone,
    value: input.value,
    allowVoid: true,
  }, selected.value.root.dependencyVersionId === null ? 'independent' : 'dependent');
  if (!context.ok) return context;
  if (
    selected.value.measuredType !== null &&
    input.value.type !== 'skipped' &&
    input.value.type !== 'void' &&
    input.value.type !== selected.value.measuredType
  ) {
    return persistenceFailure(
      'observation_context_mismatch',
      'A correction cannot change the chain measured tracking type.',
    );
  }
  const policy = await enforceOccurrenceStatePolicy(
    database,
    context.value,
    input.value,
    selected.value.root.id,
  );
  if (!policy.ok) return policy;

  await insertObservation(database, {
    ...input,
    habitId: selected.value.currentLeaf.habitId,
    scheduleVersionId: context.value.scheduleVersionId,
    trackingVersionId: context.value.trackingVersionId,
    importanceVersionId: context.value.importanceVersionId,
    dependencyVersionId: context.value.dependencyVersionId,
    supersedesObservationId: input.selectedObservationId,
  });
  const readback = await loadObservationChain(database, input.observationId);
  if (!readback.ok) return readback;
  if (readback.value === null || readback.value.currentLeaf.id !== input.observationId) {
    return integrityFailure('The corrected observation chain failed transactional readback verification.');
  }
  const mappedLeaf = readback.value.currentLeaf;
  if (
    !factMatchesResolvedContext(mappedLeaf, context.value) ||
    !factMatchesWrite(
      mappedLeaf,
      input,
      input.selectedObservationId,
      input.correctionReason,
    )
  ) {
    return integrityFailure('The corrected observation references inconsistent historical context.');
  }
  return success(readback.value);
}

export async function findObservation(
  database: PlannerSqliteDatabase,
  observationId: PlannerId,
): Promise<Result<ObservationFact | null, PlannerPersistenceError>> {
  const row = await database.getFirstAsync<HabitObservationRow>(
    'SELECT * FROM habit_observations WHERE id = $observationId;',
    { $observationId: observationId },
  );
  if (row === null) return success(null);
  return mapHabitObservationRow(row);
}

export async function loadObservationChain(
  database: PlannerSqliteDatabase,
  observationId: PlannerId,
): Promise<Result<ObservationChain | null, PlannerPersistenceError>> {
  const selected = await findObservation(database, observationId);
  if (!selected.ok) return failure(selected.error);
  if (selected.value === null) return success(null);

  const facts = new Map<PlannerId, ObservationFact>([[selected.value.id, selected.value]]);
  let cursor = selected.value;
  while (cursor.supersedesObservationId !== null) {
    if (facts.has(cursor.supersedesObservationId)) break;
    const parent = await findObservation(database, cursor.supersedesObservationId);
    if (!parent.ok) return parent;
    if (parent.value === null) {
      return integrityFailure('The observation chain references a missing parent row.');
    }
    facts.set(parent.value.id, parent.value);
    cursor = parent.value;
  }

  const root = [...facts.values()].find((fact) => fact.supersedesObservationId === null);
  if (root !== undefined) {
    cursor = root;
    const traversed = new Set<PlannerId>();
    while (!traversed.has(cursor.id)) {
      traversed.add(cursor.id);
      const childRows = await database.getAllAsync<HabitObservationRow>(
        'SELECT * FROM habit_observations WHERE supersedes_observation_id = $observationId ORDER BY id;',
        { $observationId: cursor.id },
      );
      const children: ObservationFact[] = [];
      for (const row of childRows) {
        const child = mapHabitObservationRow(row);
        if (!child.ok) return child;
        children.push(child.value);
        facts.set(child.value.id, child.value);
      }
      if (children.length === 0) break;
      if (children.length > 1) {
        const branch = validateObservationChain([...facts.values()]);
        return branch.ok
          ? integrityFailure('The observation chain contains an undetected branch.')
          : domainFailure(branch.error);
      }
      cursor = children[0];
    }
  }

  const chain = validateObservationChain([...facts.values()]);
  return chain.ok ? success(chain.value) : domainFailure(chain.error);
}

export async function loadApplicableObservationContext(
  database: PlannerSqliteDatabase,
  input: Readonly<{
    habitId: PlannerId;
    occurrenceLocalDate: PlannerLocalDate;
    occurrenceTimezone: PlannerTimezone;
    value: ObservationValue;
    allowVoid: boolean;
  }>,
): Promise<Result<IndependentObservationContext, PlannerPersistenceError>> {
  const habitRow = await database.getFirstAsync<HabitRow>(
    'SELECT * FROM habits WHERE id = $habitId;',
    { $habitId: input.habitId },
  );
  const habit = habitRow === null ? null : mapHabitRow(habitRow);
  if (habit !== null && !habit.ok) return observationIntegrityFrom(habit.error);

  const parameters = {
    $habitId: input.habitId,
    $occurrenceLocalDate: input.occurrenceLocalDate,
  } as const;
  const dependencyRows = await database.getAllAsync<HabitDependencyVersionRow>(
      `SELECT * FROM habit_dependency_versions
       WHERE dependent_habit_id = $habitId
         AND effective_from <= $occurrenceLocalDate
         AND (effective_to IS NULL OR effective_to > $occurrenceLocalDate)
       ORDER BY effective_from, id;`,
      parameters,
    );
  const scheduleRows = await database.getAllAsync<HabitScheduleVersionRow>(
      `SELECT * FROM habit_schedule_versions
       WHERE habit_id = $habitId
         AND effective_from <= $occurrenceLocalDate
         AND (effective_to IS NULL OR effective_to > $occurrenceLocalDate)
       ORDER BY effective_from, version_number, id;`,
      parameters,
    );
  const trackingRows = await database.getAllAsync<HabitTrackingVersionRow>(
      `SELECT * FROM habit_tracking_versions
       WHERE habit_id = $habitId
         AND effective_from <= $occurrenceLocalDate
         AND (effective_to IS NULL OR effective_to > $occurrenceLocalDate)
       ORDER BY effective_from, version_number, id;`,
      parameters,
    );
  const importanceRows = await database.getAllAsync<HabitImportanceVersionRow>(
      `SELECT * FROM habit_importance_versions
       WHERE habit_id = $habitId
         AND effective_from <= $occurrenceLocalDate
         AND (effective_to IS NULL OR effective_to > $occurrenceLocalDate)
       ORDER BY effective_from, version_number, id;`,
      parameters,
    );

  const dependencies = [];
  for (const row of dependencyRows) {
    const mapped = mapHabitDependencyRow(row);
    if (!mapped.ok) return observationIntegrityFrom(mapped.error);
    dependencies.push({
      id: mapped.value.id,
      dependentHabitId: mapped.value.dependentHabitId,
      occurrenceMode: mapped.value.occurrenceMode,
      effectiveRange: mapped.value.effectiveRange,
    });
  }
  const schedules = [];
  for (const row of scheduleRows) {
    const mapped = mapScheduleRow(row);
    if (!mapped.ok) return observationIntegrityFrom(mapped.error);
    schedules.push({
      id: mapped.value.model.id,
      habitId: mapped.value.habitId,
      definition: mapped.value.model.definition,
    });
  }
  const tracking = [];
  for (const row of trackingRows) {
    const mapped = mapTrackingRow(row);
    if (!mapped.ok) return observationIntegrityFrom(mapped.error);
    tracking.push({
      id: mapped.value.model.id,
      habitId: mapped.value.habitId,
      definition: mapped.value.model.definition,
    });
  }
  const importance = [];
  for (const row of importanceRows) {
    const mapped = mapImportanceRow(row);
    if (!mapped.ok) return observationIntegrityFrom(mapped.error);
    importance.push({
      id: mapped.value.model.id,
      habitId: mapped.value.habitId,
      effectiveRange: mapped.value.model.effectiveRange,
    });
  }

  const context = validateIndependentObservationContext({
    habit:
      habit === null
        ? null
        : {
            id: habit.value.id,
            lifecycle: habit.value.lifecycle,
            activeRange: habit.value.activeRange,
          },
    occurrenceLocalDate: input.occurrenceLocalDate,
    occurrenceTimezone: input.occurrenceTimezone,
    scheduleVersions: schedules,
    trackingVersions: tracking,
    importanceVersions: importance,
    dependencyVersions: dependencies,
    value: input.value,
    allowVoid: input.allowVoid,
  });
  return context.ok ? success(context.value) : domainFailure(context.error);
}

async function resolveObservationPersistenceContext(
  database: PlannerSqliteDatabase,
  input: Readonly<{
    habitId: PlannerId;
    occurrenceLocalDate: PlannerLocalDate;
    occurrenceTimezone: PlannerTimezone;
    value: ObservationValue;
    allowVoid: boolean;
  }>,
  requiredContext: 'any' | 'independent' | 'dependent',
): Promise<Result<ObservationPersistenceContext, PlannerPersistenceError>> {
  if (requiredContext === 'dependent') {
    return resolveDependentObservationContext(database, input);
  }
  const independent = await loadApplicableObservationContext(database, input);
  if (independent.ok) {
    return success(
      Object.freeze({
        habitId: independent.value.habit.id,
        scheduleVersionId: independent.value.scheduleVersion.id,
        trackingVersionId: independent.value.trackingVersion.id,
        importanceVersionId: independent.value.importanceVersion.id,
        dependencyVersionId: null,
        occurrenceWindow: independent.value.occurrenceWindow,
        tracking: independent.value.trackingVersion.definition,
      }),
    );
  }
  if (
    requiredContext === 'independent' ||
    independent.error.code !== 'dependency_occurrence_resolution_required'
  ) {
    return independent;
  }
  return resolveDependentObservationContext(database, input);
}

async function resolveDependentObservationContext(
  database: PlannerSqliteDatabase,
  input: Readonly<{
    habitId: PlannerId;
    occurrenceLocalDate: PlannerLocalDate;
    occurrenceTimezone: PlannerTimezone;
    value: ObservationValue;
    allowVoid: boolean;
  }>,
): Promise<Result<ObservationPersistenceContext, PlannerPersistenceError>> {
  const loaded = await loadOccurrenceData(database, input.occurrenceLocalDate);
  if (!loaded.ok) {
    return loaded.error.code === 'occurrence_read_model_database_failure'
      ? persistenceFailure(
          'observation_database_failure',
          'The dependent occurrence context could not be read.',
          loaded.error,
        )
      : integrityFailure(
          'The dependent occurrence context contains inconsistent data.',
          loaded.error,
        );
  }
  const resolved = resolvePlannerOccurrencesForDate({
    selectedLocalDate: input.occurrenceLocalDate,
    evaluationBoundary: input.occurrenceLocalDate,
    habits: loaded.value.habits,
    scheduleVersions: loaded.value.scheduleVersions,
    trackingVersions: loaded.value.trackingVersions,
    importanceVersions: loaded.value.importanceVersions,
    relationships: loaded.value.relationships,
    observationChains: loaded.value.observationChains,
  });
  if (!resolved.ok) {
    return integrityFailure(
      'The dependent expectation graph could not be resolved.',
      resolved.error,
    );
  }
  const matches = resolved.value.groups.flatMap((group) =>
    group.rows
      .filter((row) => row.habit.id === input.habitId)
      .map((row) => ({ group, row })),
  );
  if (matches.length === 0) {
    const relationshipApplies = loaded.value.relationships.some(
      (relationship) => relationship.dependentHabitId === input.habitId,
    );
    return persistenceFailure(
      relationshipApplies
        ? 'observation_parent_occurrence_missing'
        : 'observation_dependency_not_expected',
      relationshipApplies
        ? 'The dependency parent has no occurrence on the selected date.'
        : 'The habit is not an expected dependent on the selected date.',
    );
  }
  if (matches.length > 1) {
    return integrityFailure(
      'The dependent resolves into more than one selected-date occurrence.',
    );
  }
  const { group, row } = matches[0];
  if (row.relationshipVersionId === null || row.parentHabitId === null) {
    return persistenceFailure(
      'observation_dependency_not_expected',
      'The selected habit does not have a dependent occurrence context.',
    );
  }
  if (row.state === 'blocked') {
    return persistenceFailure(
      'observation_dependency_blocked',
      'The follow-up is blocked until its parent qualifies.',
    );
  }
  if (
    row.dependencyType === 'prerequisite' &&
    row.reason === 'parent_not_qualified'
  ) {
    return persistenceFailure(
      'observation_prerequisite_context_invalid',
      'The prerequisite occurrence context is inconsistent.',
    );
  }
  if (
    input.occurrenceTimezone !==
    group.scheduleVersion.definition.evaluationTimezone
  ) {
    return persistenceFailure(
      'observation_context_mismatch',
      'The occurrence timezone must match the parent schedule context.',
    );
  }
  const value = validateObservationValue(
    input.value,
    row.trackingVersion.definition,
    { allowVoid: input.allowVoid },
  );
  if (!value.ok) return domainFailure(value.error);
  return success(
    Object.freeze({
      habitId: row.habit.id,
      scheduleVersionId: group.scheduleVersion.id,
      trackingVersionId: row.trackingVersion.id,
      importanceVersionId: row.importanceVersion.id,
      dependencyVersionId: row.relationshipVersionId,
      occurrenceWindow: Object.freeze({
        start: group.occurrenceWindow.start,
        endExclusive: group.occurrenceWindow.endExclusive,
      }),
      tracking: row.trackingVersion.definition,
    }),
  );
}

async function enforceOccurrenceStatePolicy(
  database: PlannerSqliteDatabase,
  context: ObservationPersistenceContext,
  value: ObservationValue,
  excludedRootId: PlannerId | null,
): Promise<Result<null, PlannerPersistenceError>> {
  if (value.type === 'void') return success(null);
  const chains = await loadAllHabitObservationChains(database, context.habitId);
  if (!chains.ok) return chains;
  const active = chains.value.filter((chain) =>
    chain.root.id !== excludedRootId &&
    !chain.isVoided &&
    chain.currentLeaf.occurrenceLocalDate >= context.occurrenceWindow.start &&
    chain.currentLeaf.occurrenceLocalDate < context.occurrenceWindow.endExclusive,
  );
  const mode = context.tracking.trackingMode;
  const conflicts =
    mode === 'checkbox' || mode === 'avoidance'
      ? active.length > 0
      : value.type === 'skipped'
        ? active.length > 0
        : active.some((chain) => chain.currentLeaf.value.type === 'skipped');
  return conflicts
    ? persistenceFailure(
        'observation_state_already_exists',
        'A competing current observation state already exists for this occurrence or period.',
      )
    : success(null);
}

async function loadAllHabitObservationChains(
  database: PlannerSqliteDatabase,
  habitId: PlannerId,
): Promise<Result<readonly ObservationChain[], PlannerPersistenceError>> {
  const rows = await database.getAllAsync<HabitObservationRow>(
    'SELECT * FROM habit_observations WHERE habit_id = $habitId ORDER BY created_at, id;',
    { $habitId: habitId },
  );
  const facts: ObservationFact[] = [];
  for (const row of rows) {
    const mapped = mapHabitObservationRow(row);
    if (!mapped.ok) return mapped;
    facts.push(mapped.value);
  }
  return reconstructObservationChains(facts);
}

export function reconstructObservationChains(
  facts: readonly ObservationFact[],
): Result<readonly ObservationChain[], PlannerPersistenceError> {
  const children = new Map<PlannerId, ObservationFact[]>();
  for (const fact of facts) {
    if (fact.supersedesObservationId !== null) {
      const list = children.get(fact.supersedesObservationId) ?? [];
      list.push(fact);
      children.set(fact.supersedesObservationId, list);
    }
  }
  const consumed = new Set<PlannerId>();
  const chains: ObservationChain[] = [];
  for (const root of facts.filter((fact) => fact.supersedesObservationId === null)) {
    const chainFacts: ObservationFact[] = [];
    let current: ObservationFact | undefined = root;
    const local = new Set<PlannerId>();
    while (current !== undefined && !local.has(current.id)) {
      local.add(current.id);
      chainFacts.push(current);
      const next: ObservationFact[] = children.get(current.id) ?? [];
      if (next.length > 1) chainFacts.push(...next.slice(1));
      current = next[0];
    }
    const chain = validateObservationChain(chainFacts);
    if (!chain.ok) return domainFailure(chain.error);
    for (const fact of chain.value.facts) consumed.add(fact.id);
    chains.push(chain.value);
  }
  if (consumed.size !== facts.length) {
    return integrityFailure('Persisted observation facts contain an orphaned or cyclic chain.');
  }
  return success(Object.freeze(chains));
}

interface InsertObservationInput
  extends Omit<RecordObservationPersistenceInput, 'habitId'> {
  readonly habitId: PlannerId;
  readonly scheduleVersionId: PlannerId;
  readonly trackingVersionId: PlannerId;
  readonly importanceVersionId: PlannerId;
  readonly dependencyVersionId: PlannerId | null;
  readonly supersedesObservationId: PlannerId | null;
  readonly correctionReason: CorrectObservationPersistenceInput['correctionReason'] | null;
}

async function insertObservation(
  database: PlannerSqliteDatabase,
  input: InsertObservationInput,
): Promise<void> {
  const columns = valueColumns(input.value);
  await database.runAsync(
    `INSERT INTO habit_observations (
      id, habit_id, context_mode, schedule_version_id,
      detached_schedule_context_id, tracking_version_id,
      importance_version_id, dependency_version_id,
      occurrence_local_date, occurrence_local_time, occurrence_timezone,
      observation_type, boolean_value, counter_delta,
      quantity_significand, quantity_scale, duration_seconds, note,
      supersedes_observation_id, correction_reason, observed_at, created_at
    ) VALUES (
      $id, $habitId, $contextMode, $scheduleVersionId,
      NULL, $trackingVersionId,
      $importanceVersionId, $dependencyVersionId,
      $occurrenceLocalDate, $occurrenceLocalTime, $occurrenceTimezone,
      $observationType, $booleanValue, $counterDelta,
      $quantitySignificand, $quantityScale, $durationSeconds, $note,
      $supersedesObservationId, $correctionReason, $observedAt, $createdAt
    );`,
    {
      $id: input.observationId,
      $habitId: input.habitId,
      $contextMode: input.dependencyVersionId === null ? 'live_independent' : 'live_dependent',
      $scheduleVersionId: input.scheduleVersionId,
      $trackingVersionId: input.trackingVersionId,
      $importanceVersionId: input.importanceVersionId,
      $dependencyVersionId: input.dependencyVersionId,
      $occurrenceLocalDate: input.occurrenceLocalDate,
      $occurrenceLocalTime: input.occurrenceLocalTime,
      $occurrenceTimezone: input.occurrenceTimezone,
      $observationType: input.value.type,
      ...columns,
      $note: input.note,
      $supersedesObservationId: input.supersedesObservationId,
      $correctionReason: input.correctionReason,
      $observedAt: input.observedAt,
      $createdAt: input.createdAt,
    },
  );
}

function valueColumns(value: ObservationValue) {
  const empty = {
    $booleanValue: null,
    $counterDelta: null,
    $quantitySignificand: null,
    $quantityScale: null,
    $durationSeconds: null,
  };
  switch (value.type) {
    case 'checkbox':
    case 'avoidance':
      return { ...empty, $booleanValue: value.booleanValue ? 1 : 0 };
    case 'counter':
      return { ...empty, $counterDelta: value.counterDelta };
    case 'quantity':
      return {
        ...empty,
        $quantitySignificand: exactQuantitySignificandForPersistence(value.quantity),
        $quantityScale: value.quantity.scale,
      };
    case 'duration':
      return { ...empty, $durationSeconds: value.durationSeconds };
    case 'skipped':
    case 'void':
      return empty;
    default:
      return assertNever(value);
  }
}

function factMatchesResolvedContext(
  fact: ObservationFact,
  context: ObservationPersistenceContext,
): boolean {
  return (
    fact.habitId === context.habitId &&
    fact.scheduleVersionId === context.scheduleVersionId &&
    fact.trackingVersionId === context.trackingVersionId &&
    fact.importanceVersionId === context.importanceVersionId &&
    fact.dependencyVersionId === context.dependencyVersionId
  );
}

function factMatchesWrite(
  fact: ObservationFact,
  input: Readonly<{
    observationId: PlannerId;
    occurrenceLocalDate: PlannerLocalDate;
    occurrenceLocalTime: RecordObservationPersistenceInput['occurrenceLocalTime'];
    occurrenceTimezone: PlannerTimezone;
    note: string | null;
    value: ObservationValue;
    observedAt: number;
    createdAt: number;
  }>,
  supersedesObservationId: PlannerId | null,
  correctionReason: CorrectObservationPersistenceInput['correctionReason'] | null,
): boolean {
  return (
    fact.id === input.observationId &&
    fact.occurrenceLocalDate === input.occurrenceLocalDate &&
    fact.occurrenceLocalTime === input.occurrenceLocalTime &&
    fact.occurrenceTimezone === input.occurrenceTimezone &&
    fact.note === input.note &&
    observationValuesEqual(fact.value, input.value) &&
    fact.supersedesObservationId === supersedesObservationId &&
    fact.correctionReason === correctionReason &&
    fact.observedAt === input.observedAt &&
    fact.createdAt === input.createdAt
  );
}

function observationValuesEqual(left: ObservationValue, right: ObservationValue): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case 'checkbox':
    case 'avoidance':
      return right.type === left.type && left.booleanValue === right.booleanValue;
    case 'counter':
      return right.type === 'counter' && left.counterDelta === right.counterDelta;
    case 'quantity':
      return (
        right.type === 'quantity' &&
        left.quantity.significand === right.quantity.significand &&
        left.quantity.scale === right.quantity.scale
      );
    case 'duration':
      return right.type === 'duration' && left.durationSeconds === right.durationSeconds;
    case 'skipped':
    case 'void':
      return right.type === left.type;
    default:
      return assertNever(left);
  }
}

function domainFailure<T = never>(
  error: PlannerDomainError,
): Result<T, PlannerPersistenceError> {
  if (
    error.code === 'dependency_occurrence_resolution_required' ||
    error.code.startsWith('observation_')
  ) {
    return persistenceFailure(
      error.code as PlannerPersistenceError['code'],
      error.message,
    );
  }
  return integrityFailure('Observation domain validation failed for persisted context.');
}

function observationIntegrityFrom<T = never>(
  error: PlannerPersistenceError,
): Result<T, PlannerPersistenceError> {
  return integrityFailure('Observation context contains malformed persisted data.', error);
}

function integrityFailure<T = never>(
  message: string,
  cause?: unknown,
): Result<T, PlannerPersistenceError> {
  return persistenceFailure('observation_data_integrity_failure', message, cause);
}

function persistenceFailure<T = never>(
  code: PlannerPersistenceError['code'],
  message: string,
  cause?: unknown,
): Result<T, PlannerPersistenceError> {
  return failure(
    createPlannerPersistenceError(code, message, {
      operation: 'habitObservation',
      ...(cause === undefined ? {} : { cause }),
    }),
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported observation value: ${String(value)}`);
}
