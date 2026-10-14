import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NodeSqliteTestDatabase } from './node-sqlite-test-database';
import {
  ACTIVE_FROM,
  FIXED_NOW,
  baseCommand,
  createHarnessForDatabase,
} from './test-fixtures';

const FERN = '\u{1F33F}';
const FERN_IDENTITY = Object.freeze({ kind: 'emoji' as const, emoji: FERN });

test('manual fern identity remains exact through Create, SQLite, reopen, occurrence, summary, management, Detail, and Edit input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lifeplanner-emoji-readback-'));
  const filename = join(directory, 'planner.sqlite');
  let database: NodeSqliteTestDatabase | null = new NodeSqliteTestDatabase(filename);
  try {
    await database.migrate();
    await database.runAsync(
      `INSERT INTO planner_preferences(id,progress_mode,created_at,updated_at)
       VALUES(1,'equal',$now,$now);`,
      { $now: FIXED_NOW },
    );
    let harness = createHarnessForDatabase(database, 140_000);
    const created = await harness.createHabit(baseCommand({
      name: 'Fern readback',
      iconIdentity: FERN_IDENTITY,
      accentKey: 'green',
    }));
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;
    assert.deepEqual(created.value.visualIdentity.iconIdentity, FERN_IDENTITY);
    assert.deepEqual(Array.from(FERN, (character) => character.codePointAt(0)), [0x1f33f]);
    await assertCanonicalReadback(harness, created.value.id);
    const identityRow = await database.getFirstAsync<{
      icon_kind: string;
      symbol_key: string | null;
      emoji_value: string | null;
      accent_key: string;
    }>(
        'SELECT icon_kind,symbol_key,emoji_value,accent_key FROM habit_visual_identities WHERE habit_id=$habitId;',
        { $habitId: created.value.id },
      );
    assert.deepEqual(
      identityRow === null ? null : { ...identityRow },
      { icon_kind: 'emoji', symbol_key: null, emoji_value: FERN, accent_key: 'green' },
    );
    database.close();
    database = new NodeSqliteTestDatabase(filename);
    await database.migrate();
    harness = createHarnessForDatabase(database, 141_000);
    await assertCanonicalReadback(harness, created.value.id);
    assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check;'), []);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function assertCanonicalReadback(
  harness: ReturnType<typeof createHarnessForDatabase>,
  habitId: string,
): Promise<void> {
  const occurrences = await harness.getPlannerOccurrencesForDate({ selectedLocalDate: ACTIVE_FROM, evaluationBoundary: ACTIVE_FROM });
  assert.equal(occurrences.ok, true);
  if (occurrences.ok) {
    const row = occurrences.value.rootGroups.flatMap(({ rows }) => rows).find((candidate) => candidate.habitId === habitId);
    assert.deepEqual(row?.visualIdentity.iconIdentity, FERN_IDENTITY);
  }
  const summaries = await harness.getPlannerDateSummariesForRange({ startDate: ACTIVE_FROM, endDate: ACTIVE_FROM, evaluationBoundary: ACTIVE_FROM });
  assert.equal(summaries.ok, true);
  if (summaries.ok) assert.deepEqual(summaries.value.summaries[ACTIVE_FROM]?.indicators[0]?.visualIdentity.iconIdentity, FERN_IDENTITY);
  const management = await harness.listPlannerHabits({ asOfLocalDate: ACTIVE_FROM, lifecycle: 'all' });
  assert.equal(management.ok, true, JSON.stringify(management));
  if (management.ok) assert.deepEqual(management.value.find((item) => item.habitId === habitId)?.visualIdentity.iconIdentity, FERN_IDENTITY);
  const detail = await harness.getPlannerHabitDetail({ habitId, asOfLocalDate: ACTIVE_FROM });
  assert.equal(detail.ok, true, JSON.stringify(detail));
  if (detail.ok && detail.value !== null) {
    assert.deepEqual(detail.value.habit.visualIdentity.iconIdentity, FERN_IDENTITY);
    const editDraftIdentity = detail.value.habit.visualIdentity.iconIdentity;
    assert.deepEqual(editDraftIdentity, FERN_IDENTITY);
  }
}
