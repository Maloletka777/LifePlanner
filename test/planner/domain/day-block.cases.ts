import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLANNER_DAY_BLOCKS,
  PLANNER_DAY_BLOCK_HOURS,
  PLANNER_GROWTH_CUE_MAX_LENGTH,
  PLANNER_GROWTH_ENJOYMENTS,
  PLANNER_MAX_GROWING_ROUTINES,
  isPlannerGrowthAttemptActiveOn,
  parsePlannerDayBlock,
  parsePlannerGrowthCue,
  parsePlannerGrowthEnjoyment,
  suggestPlannerDayBlock,
  type PlannerHabitGrowthAttempt,
} from '../../../src/features/planner/domain/values/day-block';
import { parsePlannerLocalDate } from '../../../src/features/planner/domain/values/local-date';

const date = (value: string) => {
  const parsed = parsePlannerLocalDate(value);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('unreachable');
  return parsed.value;
};

const attempt = (overrides: Partial<PlannerHabitGrowthAttempt> = {}): PlannerHabitGrowthAttempt => ({
  id: 'g1',
  habitId: 'h1',
  attemptNumber: 1,
  trackedFrom: date('2026-08-04'),
  stoppedFrom: null,
  cue: null,
  enjoyment: null,
  ...overrides,
});

test('a day has exactly three blocks, and they cover the twenty-four hours whole', () => {
  assert.deepEqual([...PLANNER_DAY_BLOCKS], ['morning', 'day', 'evening']);

  // Evening runs to the start of morning, so a thing done at one in the morning belongs
  // to the evening it followed rather than to nowhere.
  assert.equal(PLANNER_DAY_BLOCK_HOURS.evening.toHour, PLANNER_DAY_BLOCK_HOURS.morning.fromHour);
  assert.equal(PLANNER_DAY_BLOCK_HOURS.morning.toHour, PLANNER_DAY_BLOCK_HOURS.day.fromHour);
  assert.equal(PLANNER_DAY_BLOCK_HOURS.day.toHour, PLANNER_DAY_BLOCK_HOURS.evening.fromHour);

  for (const hour of Array.from({ length: 24 }, (_v, index) => index)) {
    assert.ok(PLANNER_DAY_BLOCKS.includes(suggestPlannerDayBlock(hour * 60)), `hour ${hour} must belong to a block`);
  }
});

test('a minute suggests a block, and the small hours belong to the evening before them', () => {
  assert.equal(suggestPlannerDayBlock(4 * 60), 'morning');
  assert.equal(suggestPlannerDayBlock(11 * 60 + 59), 'morning');
  assert.equal(suggestPlannerDayBlock(12 * 60), 'day');
  assert.equal(suggestPlannerDayBlock(16 * 60 + 59), 'day');
  assert.equal(suggestPlannerDayBlock(17 * 60), 'evening');
  assert.equal(suggestPlannerDayBlock(23 * 60 + 30), 'evening');
  assert.equal(suggestPlannerDayBlock(1 * 60), 'evening', 'one in the morning follows the evening');
  assert.equal(suggestPlannerDayBlock(3 * 60 + 59), 'evening');

  // A minute outside the day is folded rather than refused: this is a suggestion, and a
  // suggestion that throws is a suggestion a caller has to guard.
  assert.equal(suggestPlannerDayBlock(-30), 'evening');
  assert.equal(suggestPlannerDayBlock(1440 + 8 * 60), 'morning');
});

test('the block is a closed set, and nothing outside it can be stored', () => {
  for (const block of PLANNER_DAY_BLOCKS) {
    const parsed = parsePlannerDayBlock(block);
    assert.equal(parsed.ok, true);
  }
  for (const invalid of ['night', 'Morning', 'утро', '', 7, null, undefined]) {
    const parsed = parsePlannerDayBlock(invalid);
    assert.equal(parsed.ok, false, `«${String(invalid)}» must be refused`);
    if (!parsed.ok) assert.equal(parsed.error.code, 'invalid_day_block');
  }
});

test('enjoyment is three answers and no scale', () => {
  assert.deepEqual([...PLANNER_GROWTH_ENJOYMENTS], ['yes', 'tolerated', 'no']);
  for (const value of PLANNER_GROWTH_ENJOYMENTS) assert.equal(parsePlannerGrowthEnjoyment(value).ok, true);

  // A number would invite a threshold, and there is no evidence for where one sits.
  for (const invalid of [3, '3', 'maybe', 'YES', '']) {
    assert.equal(parsePlannerGrowthEnjoyment(invalid).ok, false, `«${String(invalid)}» must be refused`);
  }
});

test('a cue is trimmed, bounded, and never empty', () => {
  const parsed = parsePlannerGrowthCue('  после ужина  ');
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value, 'после ужина');

  assert.equal(parsePlannerGrowthCue('a'.repeat(PLANNER_GROWTH_CUE_MAX_LENGTH)).ok, true);
  assert.equal(parsePlannerGrowthCue('a'.repeat(PLANNER_GROWTH_CUE_MAX_LENGTH + 1)).ok, false);
  for (const invalid of ['', '   ', 42, null]) {
    assert.equal(parsePlannerGrowthCue(invalid).ok, false, `«${String(invalid)}» must be refused`);
  }
});

test('an attempt covers its own days, half-open at the end', () => {
  const open = attempt();
  assert.equal(isPlannerGrowthAttemptActiveOn(open, date('2026-08-03')), false, 'the day before it began');
  assert.equal(isPlannerGrowthAttemptActiveOn(open, date('2026-08-04')), true, 'the day it began');
  assert.equal(isPlannerGrowthAttemptActiveOn(open, date('2027-01-01')), true, 'an open attempt has no end');

  const closed = attempt({ stoppedFrom: date('2026-09-01') });
  assert.equal(isPlannerGrowthAttemptActiveOn(closed, date('2026-08-31')), true, 'the last day inside it');
  assert.equal(
    isPlannerGrowthAttemptActiveOn(closed, date('2026-09-01')),
    false,
    'half-open: the attempt ends the day it stops, exactly as a removed checklist line does',
  );
});

test('a routine taken up again is a second attempt, and the first is still there', () => {
  // The owner's rule, held in the shape rather than in a comment: data is written on top
  // of old data, so a spring attempt does not erase a February one.
  const first = attempt({ id: 'g1', attemptNumber: 1, trackedFrom: date('2026-02-01'), stoppedFrom: date('2026-03-15') });
  const second = attempt({ id: 'g2', attemptNumber: 2, trackedFrom: date('2026-08-04') });

  assert.equal(isPlannerGrowthAttemptActiveOn(first, date('2026-03-01')), true);
  assert.equal(isPlannerGrowthAttemptActiveOn(second, date('2026-03-01')), false);
  assert.equal(isPlannerGrowthAttemptActiveOn(first, date('2026-08-10')), false);
  assert.equal(isPlannerGrowthAttemptActiveOn(second, date('2026-08-10')), true);

  // And the second starts from zero of its own: nothing about February is inside it.
  assert.equal(second.trackedFrom > (first.stoppedFrom ?? second.trackedFrom), true);
});

test('the cap on simultaneous routines is a value, not a wall', () => {
  // Three lives here rather than in a database constraint, so moving it is a decision
  // rather than a migration.
  assert.equal(PLANNER_MAX_GROWING_ROUTINES, 3);
});
