import type {
  HabitEmoji,
  PlannerDomainError,
  PersistedHabitAccentKey,
  RegisteredHabitSymbolKey,
  Result,
} from '@/src/features/planner';

import { HABIT_ICON_OPTIONS, type HabitIconCategory, type HabitIconOption } from './planner-iconography';

export function filterHabitIconOptions(query: string, category: HabitIconCategory | 'All'): readonly HabitIconOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  return HABIT_ICON_OPTIONS.filter((option) =>
    (category === 'All' || option.category === category) &&
    (normalized === '' || [option.label, option.key, ...option.searchTerms].some((term) => term.toLocaleLowerCase().includes(normalized))),
  );
}

/**
 * Symbols that match what the habit is called, best match first.
 *
 * The identity sheet leads with these so the common case needs no search and no
 * category: a habit called "Morning run" opens on running, walking and cycling.
 * A word must match a whole search term, a label word or the key — a substring
 * match on two letters would put anything first and be worse than nothing.
 */
export function suggestedHabitSymbols(name: string, limit = 4): readonly HabitIconOption[] {
  const words = name.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  if (words.length === 0) return Object.freeze([]);
  const scored = HABIT_ICON_OPTIONS
    .map((option) => Object.freeze({ option, score: symbolMatchScore(option, words) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  return Object.freeze(scored.slice(0, limit).map(({ option }) => option));
}

function symbolMatchScore(option: HabitIconOption, words: readonly string[]): number {
  const terms = [...option.searchTerms, ...option.label.toLocaleLowerCase().split(' '), option.key].map((term) => term.toLocaleLowerCase());
  let score = 0;
  for (const word of words) {
    if (terms.includes(word)) score += 2;
    else if (terms.some((term) => term.startsWith(word))) score += 1;
  }
  return score;
}

export function accentLabel(key: PersistedHabitAccentKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function iconLabel(key: RegisteredHabitSymbolKey): string {
  return HABIT_ICON_OPTIONS.find((option) => option.key === key)?.label ?? key.replaceAll('_', ' ');
}

export type IdentitySelectionMode = 'automatic' | 'explicit';

export interface HabitIdentityPickerDraft {
  readonly iconMode: IdentitySelectionMode;
  readonly iconSymbolKey: RegisteredHabitSymbolKey;
  readonly iconEmoji: string | null;
  readonly accentMode: IdentitySelectionMode;
  readonly accentKey: PersistedHabitAccentKey;
}

export function habitIdentitySummary(draft: HabitIdentityPickerDraft): string {
  const icon = draft.iconMode === 'automatic'
    ? 'Automatic icon'
    : draft.iconEmoji === null
      ? iconLabel(draft.iconSymbolKey)
      : `Emoji ${draft.iconEmoji}`;
  const colour = draft.accentMode === 'automatic' ? 'Automatic colour' : accentLabel(draft.accentKey);
  return `${icon} · ${colour}`;
}

export type HabitEmojiInputResult =
  | Readonly<{ readonly ok: true; readonly value: HabitEmoji }>
  | Readonly<{ readonly ok: false; readonly message: 'Choose one emoji' | 'That emoji is not supported' }>;

export interface HabitEmojiInputBoundary {
  readonly maxUtf8Bytes: number;
  readonly parse: (input: unknown, field?: string) => Result<HabitEmoji, PlannerDomainError>;
  readonly utf8ByteLength: (value: string) => number;
}

export function validateHabitEmojiInput(value: string, boundary: HabitEmojiInputBoundary): HabitEmojiInputResult {
  const parsed = boundary.parse(value, 'iconEmoji');
  if (parsed.ok) return Object.freeze({ ok: true, value: parsed.value });
  return Object.freeze({
    ok: false,
    message: boundary.utf8ByteLength(value) > boundary.maxUtf8Bytes
      ? 'That emoji is not supported'
      : 'Choose one emoji',
  });
}
