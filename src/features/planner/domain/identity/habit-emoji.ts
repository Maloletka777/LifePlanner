import { failure, success, type Result } from '../result';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';

declare const habitEmojiBrand: unique symbol;
export type HabitEmoji = string & { readonly [habitEmojiBrand]: true };

/** Strict persisted byte bound, shared with schema v7. */
export const HABIT_EMOJI_MAX_UTF8_BYTES = 64;

const VARIATION_SELECTOR_16 = 0xfe0f;
const ZERO_WIDTH_JOINER = 0x200d;
const KEYCAP = 0x20e3;

export function parseHabitEmoji(
  input: unknown,
  field = 'emoji',
): Result<HabitEmoji, PlannerDomainError> {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.trim() !== input ||
    utf8ByteLength(input) > HABIT_EMOJI_MAX_UTF8_BYTES
  ) {
    return invalidEmoji(field);
  }

  const codePoints = Array.from(input, (value) => value.codePointAt(0) as number);
  if (!isSingleSupportedEmojiSequence(codePoints)) return invalidEmoji(field);
  return success(input as HabitEmoji);
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function isSingleSupportedEmojiSequence(codePoints: readonly number[]): boolean {
  if (codePoints.length === 0) return false;

  if (isKeycapBase(codePoints[0])) {
    return codePoints.length === 2 && codePoints[1] === KEYCAP ||
      codePoints.length === 3 && codePoints[1] === VARIATION_SELECTOR_16 && codePoints[2] === KEYCAP;
  }

  if (isRegionalIndicator(codePoints[0])) {
    return codePoints.length === 2 && isRegionalIndicator(codePoints[1]);
  }

  let cursor = consumeEmojiComponent(codePoints, 0);
  if (cursor === -1) return false;
  while (cursor < codePoints.length) {
    if (codePoints[cursor] !== ZERO_WIDTH_JOINER) return false;
    cursor = consumeEmojiComponent(codePoints, cursor + 1);
    if (cursor === -1) return false;
  }
  return true;
}

function consumeEmojiComponent(codePoints: readonly number[], start: number): number {
  if (start >= codePoints.length || !isEmojiBase(codePoints[start])) return -1;
  let cursor = start + 1;
  if (codePoints[cursor] === VARIATION_SELECTOR_16) cursor += 1;
  if (isSkinTone(codePoints[cursor])) cursor += 1;
  return cursor;
}

function isKeycapBase(codePoint: number): boolean {
  return codePoint === 0x23 || codePoint === 0x2a || codePoint >= 0x30 && codePoint <= 0x39;
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function isSkinTone(codePoint: number | undefined): boolean {
  return codePoint !== undefined && codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
}

function isEmojiBase(codePoint: number): boolean {
  if (isSkinTone(codePoint) || isRegionalIndicator(codePoint)) return false;
  return codePoint === 0x00a9 || codePoint === 0x00ae || codePoint === 0x203c ||
    codePoint === 0x2049 || codePoint === 0x2122 || codePoint === 0x2139 ||
    codePoint >= 0x2194 && codePoint <= 0x21ff ||
    codePoint >= 0x2300 && codePoint <= 0x23ff ||
    codePoint >= 0x2460 && codePoint <= 0x24ff ||
    codePoint >= 0x25a0 && codePoint <= 0x27ff ||
    codePoint >= 0x2934 && codePoint <= 0x2935 ||
    codePoint >= 0x2b00 && codePoint <= 0x2bff ||
    codePoint >= 0x3030 && codePoint <= 0x303d ||
    codePoint === 0x3297 || codePoint === 0x3299 ||
    codePoint >= 0x1f000 && codePoint <= 0x1faff;
}

function invalidEmoji(field: string): Result<never, PlannerDomainError> {
  return failure(createPlannerDomainError(
    'unsupported_stored_value',
    'Choose one supported emoji grapheme (including an optional variation selector, skin tone, or valid ZWJ sequence).',
    { field },
  ));
}
