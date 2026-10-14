import { failure, success, type Result } from '../result';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';

export interface HabitAccentOption {
  readonly key: CanonicalHabitAccentKey;
  readonly label: string;
}

function accentOption<const TKey extends string>(key: TKey, label: string) {
  return Object.freeze({ key, label });
}

/** The complete canonical palette contract for new identity choices. */
export const HABIT_ACCENT_OPTIONS = Object.freeze([
  accentOption('blue', 'Blue'),
  accentOption('indigo', 'Indigo'),
  accentOption('violet', 'Violet'),
  accentOption('purple', 'Purple'),
  accentOption('pink', 'Pink'),
  accentOption('red', 'Red'),
  accentOption('orange', 'Orange'),
  accentOption('amber', 'Amber'),
  accentOption('yellow', 'Yellow'),
  accentOption('lime', 'Lime'),
  accentOption('green', 'Green'),
  accentOption('mint', 'Mint'),
  accentOption('teal', 'Teal'),
  accentOption('cyan', 'Cyan'),
  accentOption('brown', 'Brown'),
  accentOption('grey', 'Grey'),
] as const);

export type CanonicalHabitAccentKey = (typeof HABIT_ACCENT_OPTIONS)[number]['key'];

export const CANONICAL_HABIT_ACCENT_KEYS: readonly CanonicalHabitAccentKey[] = Object.freeze(
  HABIT_ACCENT_OPTIONS.map(({ key }) => key),
);

/**
 * v5/v6 storage keys that are not names in the canonical 16-colour palette.
 * They remain valid persisted facts and retain their existing presentation.
 */
export const LEGACY_HABIT_ACCENT_KEYS = Object.freeze([
  'coral',
  'rose',
  'peach',
  'sky',
  'lavender',
] as const);

export type LegacyHabitAccentKey = (typeof LEGACY_HABIT_ACCENT_KEYS)[number];
export type PersistedHabitAccentKey = CanonicalHabitAccentKey | LegacyHabitAccentKey;

/**
 * Frozen v5 automatic-assignment palette. Its order is a compatibility
 * contract: expanding the canonical catalogue must never recolour a habit.
 */
export const LEGACY_AUTOMATIC_HABIT_ACCENT_KEYS = Object.freeze([
  'coral',
  'rose',
  'peach',
  'amber',
  'mint',
  'teal',
  'sky',
  'blue',
  'lavender',
  'violet',
] as const);

/** @deprecated Current presentation compatibility only; use HABIT_ACCENT_OPTIONS for new UI. */
export const HABIT_ACCENT_KEYS = LEGACY_AUTOMATIC_HABIT_ACCENT_KEYS;
/** @deprecated Current presentation compatibility only. */
export type HabitAccentKey = (typeof HABIT_ACCENT_KEYS)[number];

export const ALL_PERSISTED_HABIT_ACCENT_KEYS: readonly PersistedHabitAccentKey[] = Object.freeze([
  ...CANONICAL_HABIT_ACCENT_KEYS,
  ...LEGACY_HABIT_ACCENT_KEYS,
]);

export interface LegacyHabitAccentCompatibility {
  readonly key: LegacyHabitAccentKey;
  readonly label: string;
  readonly suggestedCanonicalKey: CanonicalHabitAccentKey;
}

/** Suggestions apply only after an explicit user reselection; storage is never rewritten automatically. */
export const LEGACY_HABIT_ACCENT_COMPATIBILITY: readonly LegacyHabitAccentCompatibility[] = Object.freeze([
  Object.freeze({ key: 'coral', label: 'Coral', suggestedCanonicalKey: 'red' }),
  Object.freeze({ key: 'rose', label: 'Rose', suggestedCanonicalKey: 'pink' }),
  Object.freeze({ key: 'peach', label: 'Peach', suggestedCanonicalKey: 'orange' }),
  Object.freeze({ key: 'sky', label: 'Sky', suggestedCanonicalKey: 'cyan' }),
  Object.freeze({ key: 'lavender', label: 'Lavender', suggestedCanonicalKey: 'violet' }),
]);

const PERSISTED_ACCENT_KEYS = new Set<string>(ALL_PERSISTED_HABIT_ACCENT_KEYS);

export function parsePersistedHabitAccentKey(
  input: unknown,
  field = 'accentKey',
): Result<PersistedHabitAccentKey, PlannerDomainError> {
  return typeof input === 'string' && PERSISTED_ACCENT_KEYS.has(input)
    ? success(input as PersistedHabitAccentKey)
    : failure(createPlannerDomainError('unsupported_stored_value', 'Choose a registered habit accent.', { field }));
}

/** Compatibility name retained for existing application callers. */
export const parseHabitAccentKey = parsePersistedHabitAccentKey;

const PRESENTATION_FALLBACKS: Readonly<Record<PersistedHabitAccentKey, HabitAccentKey>> = Object.freeze({
  blue: 'blue',
  indigo: 'blue',
  violet: 'violet',
  purple: 'violet',
  pink: 'rose',
  red: 'coral',
  orange: 'peach',
  amber: 'amber',
  yellow: 'amber',
  lime: 'mint',
  green: 'mint',
  mint: 'mint',
  teal: 'teal',
  cyan: 'sky',
  brown: 'peach',
  grey: 'blue',
  coral: 'coral',
  rose: 'rose',
  peach: 'peach',
  sky: 'sky',
  lavender: 'lavender',
});

/** Non-persisted fallback for the pre-Phase-4C presentation layer. */
export function habitAccentPresentationFallback(key: PersistedHabitAccentKey): HabitAccentKey {
  return PRESENTATION_FALLBACKS[key];
}
