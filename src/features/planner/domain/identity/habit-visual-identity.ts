import type { TrackingDefinition } from '../tracking/tracking-definition';
import { failure, success, type Result } from '../result';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import {
  HABIT_ACCENT_KEYS,
  habitAccentPresentationFallback,
  parsePersistedHabitAccentKey,
  type HabitAccentKey,
  type PersistedHabitAccentKey,
} from './habit-accent-catalogue';
import { parseHabitEmoji, type HabitEmoji } from './habit-emoji';
import {
  HABIT_ICON_KEYS,
  parseRegisteredHabitSymbolKey,
  type HabitIconKey,
  type RegisteredHabitSymbolKey,
} from './habit-symbol-catalogue';

export * from './habit-accent-catalogue';
export * from './habit-emoji';
export * from './habit-symbol-catalogue';

type TrackingMode = TrackingDefinition['trackingMode'];

export type HabitIconIdentity =
  | Readonly<{ readonly kind: 'symbol'; readonly symbolKey: RegisteredHabitSymbolKey }>
  | Readonly<{ readonly kind: 'emoji'; readonly emoji: HabitEmoji }>;

export type HabitIconIdentityInput =
  | Readonly<{ readonly kind: 'symbol'; readonly symbolKey: string }>
  | Readonly<{ readonly kind: 'emoji'; readonly emoji: string }>;

/**
 * Canonical identity plus explicit, non-persisted fallbacks used by the v0.3.2
 * presentation layer until 301 UI consumes iconIdentity/persistedAccentKey.
 */
export interface HabitVisualIdentity {
  readonly iconIdentity: HabitIconIdentity;
  readonly persistedAccentKey: PersistedHabitAccentKey;
  readonly iconKey: HabitIconKey;
  readonly accentKey: HabitAccentKey;
}

export const TRACKING_MODE_ICON_KEYS: Readonly<Record<TrackingMode, HabitIconKey>> = Object.freeze({
  checkbox: 'checkbox',
  avoidance: 'avoidance',
  counter: 'counter',
  quantity: 'quantity',
  duration: 'duration',
});

export function habitIconKeyForTrackingMode(trackingMode: TrackingMode): HabitIconKey {
  return TRACKING_MODE_ICON_KEYS[trackingMode];
}

export function stableHabitIdentityHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Frozen v5 policy: the catalogue expansion deliberately cannot affect it. */
export function habitAccentKeyForId(habitId: string): HabitAccentKey {
  return HABIT_ACCENT_KEYS[stableHabitIdentityHash(habitId) % HABIT_ACCENT_KEYS.length];
}

export function parseHabitIconIdentity(
  input: unknown,
  field = 'iconIdentity',
): Result<HabitIconIdentity, PlannerDomainError> {
  if (typeof input !== 'object' || input === null) return invalidIconIdentity(field);
  const record = input as Readonly<Record<string, unknown>>;
  if (record.kind === 'symbol') {
    if (Object.keys(record).some((key) => key !== 'kind' && key !== 'symbolKey')) return invalidIconIdentity(field);
    const symbolKey = parseRegisteredHabitSymbolKey(record.symbolKey, `${field}.symbolKey`);
    return symbolKey.ok
      ? success(Object.freeze({ kind: 'symbol', symbolKey: symbolKey.value }))
      : symbolKey;
  }
  if (record.kind === 'emoji') {
    if (Object.keys(record).some((key) => key !== 'kind' && key !== 'emoji')) return invalidIconIdentity(field);
    const emoji = parseHabitEmoji(record.emoji, `${field}.emoji`);
    return emoji.ok ? success(Object.freeze({ kind: 'emoji', emoji: emoji.value })) : emoji;
  }
  return invalidIconIdentity(field);
}

export function createHabitVisualIdentity(
  iconIdentity: HabitIconIdentity,
  persistedAccentKey: PersistedHabitAccentKey,
): HabitVisualIdentity {
  const iconKey = habitIconIdentityPresentationFallback(iconIdentity);
  return Object.freeze({
    iconIdentity,
    persistedAccentKey,
    iconKey,
    accentKey: habitAccentPresentationFallback(persistedAccentKey),
  });
}

/** Non-persisted registered fallback when the current renderer cannot draw the exact identity. */
export function habitIconIdentityPresentationFallback(iconIdentity: HabitIconIdentity): HabitIconKey {
  return iconIdentity.kind === 'symbol' && HABIT_ICON_KEYS.includes(iconIdentity.symbolKey as HabitIconKey)
    ? iconIdentity.symbolKey as HabitIconKey
    : 'habit_generic';
}

export function habitIconIdentitiesEqual(left: HabitIconIdentity, right: HabitIconIdentity): boolean {
  return left.kind === right.kind && (left.kind === 'symbol'
    ? left.symbolKey === (right as Extract<HabitIconIdentity, { kind: 'symbol' }>).symbolKey
    : left.emoji === (right as Extract<HabitIconIdentity, { kind: 'emoji' }>).emoji);
}

export function resolveHabitVisualIdentity(input: Readonly<{
  habitId: string;
  trackingMode: TrackingMode;
  iconIdentity?: unknown;
  iconKey?: unknown;
  accentKey?: unknown;
}>): Result<HabitVisualIdentity, PlannerDomainError> {
  if (input.iconIdentity !== undefined && input.iconIdentity !== null && input.iconKey !== undefined && input.iconKey !== null) {
    return failure(createPlannerDomainError('unsupported_stored_value', 'Choose either a legacy icon key or an explicit icon identity, not both.', { field: 'iconIdentity' }));
  }
  const icon = input.iconIdentity !== undefined && input.iconIdentity !== null
    ? parseHabitIconIdentity(input.iconIdentity)
    : input.iconKey !== undefined && input.iconKey !== null
      ? (() => {
          const parsed = parseRegisteredHabitSymbolKey(input.iconKey, 'iconKey');
          return parsed.ok
            ? success(Object.freeze({ kind: 'symbol', symbolKey: parsed.value }) as HabitIconIdentity)
            : parsed;
        })()
      : success(Object.freeze({ kind: 'symbol', symbolKey: habitIconKeyForTrackingMode(input.trackingMode) }) as HabitIconIdentity);
  if (!icon.ok) return icon;

  const accent = input.accentKey === undefined || input.accentKey === null
    ? success(habitAccentKeyForId(input.habitId) as PersistedHabitAccentKey)
    : parsePersistedHabitAccentKey(input.accentKey);
  if (!accent.ok) return accent;
  return success(createHabitVisualIdentity(icon.value, accent.value));
}

function invalidIconIdentity(field: string): Result<never, PlannerDomainError> {
  return failure(createPlannerDomainError('unsupported_stored_value', 'Choose a registered symbol or one supported emoji.', { field }));
}
