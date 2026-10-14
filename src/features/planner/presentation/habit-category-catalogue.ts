// The React-free colour module directly, not the theme barrel: this catalogue is
// asserted as behaviour in the Node test runner, and the barrel re-exports the
// appearance provider, which drags React Native in with it.
import { mixColors, withAlpha } from '../../../ui/theme/color-math';
import { CATEGORY_HUES } from '../../../ui/theme/color-themes';

import type { PersistedHabitAccentKey } from '../domain';

/**
 * Six categories, and they are the only chromatic language an item has.
 *
 * `design_handoff_today/README.md` — "Category is chosen when creating an item;
 * there is no free color picker" — replaces the per-habit colour with a category
 * whose colour carries meaning. All six sit at the same perceived saturation, so no
 * single one jumps out of a day.
 *
 * **Nothing new is persisted.** A category is stored as the canonical accent key
 * its hue already names, so `accent_key` keeps doing the work it has done since
 * schema v5 and no column, table, migration or command changes. That also means
 * every habit saved before categories existed still reads back: one whose key is
 * among the six shows that category, and one painted `cyan` or `grey` simply has
 * none and keeps rendering from the theme's own accent tones.
 *
 * **Hue is the item's data and never moves; lightness follows the theme**
 * (PD-CATEGORY-006). The six sit at `oklch(0.60 0.09 H)` in Light and
 * `oklch(0.72 0.09 H)` in Dark — one lightness step, no change of hue and no change
 * of chroma — because a 0.60 colour on a `#14171C` ground is not a readable mark.
 * That is the one clause of PD-CATEGORY-003 this amends: a category is still one
 * colour, and it is still recognisably the same one in both themes.
 *
 * The canonical `habit_categories` table is deliberately **not** used. It carries a
 * name and a sort order and no colour, nothing writes to it, and filling it would
 * mean a migration and a create-category command — domain and persistence work that
 * this surface does not own. When that module is built, this catalogue is what it
 * has to agree with.
 */
export type HabitCategoryKey = 'routine' | 'meal' | 'work' | 'body' | 'mind' | 'home';

export interface HabitCategoryOption {
  readonly key: HabitCategoryKey;
  readonly label: string;
  /** The Light value. Use `habitCategoryColor` wherever a theme is in hand. */
  readonly color: string;
  /** The canonical accent key it is stored as. */
  readonly accentKey: PersistedHabitAccentKey;
}

function category(
  key: HabitCategoryKey,
  label: string,
  accentKey: PersistedHabitAccentKey,
): HabitCategoryOption {
  return Object.freeze({ accentKey, color: CATEGORY_HUES.light[key], key, label });
}

export const HABIT_CATEGORY_OPTIONS: readonly HabitCategoryOption[] = Object.freeze([
  category('routine', 'Routine', 'amber'),
  category('meal', 'Meal', 'brown'),
  category('work', 'Work', 'blue'),
  category('body', 'Body', 'green'),
  category('mind', 'Mind', 'purple'),
  category('home', 'Home', 'teal'),
]);

/** The category's colour in the theme that is actually on. */
export function habitCategoryColor(option: HabitCategoryOption, dark: boolean): string {
  return CATEGORY_HUES[dark ? 'dark' : 'light'][option.key];
}

export const DEFAULT_HABIT_CATEGORY: HabitCategoryKey = 'body';

export function habitCategory(key: HabitCategoryKey): HabitCategoryOption {
  const found = HABIT_CATEGORY_OPTIONS.find((option) => option.key === key);
  // The list is exhaustive over the union, so this only guards a widened string.
  return found ?? HABIT_CATEGORY_OPTIONS[3];
}

/** The category a stored accent key names, or `null` when it names none. */
export function habitCategoryForAccentKey(accentKey: PersistedHabitAccentKey | null): HabitCategoryOption | null {
  if (accentKey === null) return null;
  return HABIT_CATEGORY_OPTIONS.find((option) => option.accentKey === accentKey) ?? null;
}

export function habitCategoryAccentKey(key: HabitCategoryKey): PersistedHabitAccentKey {
  return habitCategory(key).accentKey;
}

/**
 * How a category paints a mark: the colour washed into the ground for the fill and
 * the colour itself for the glyph, which is the create sheet's own rule — "заливка =
 * выбранный цвет @ 12–16 %, иконка полным цветом".
 */
export interface HabitCategoryTone {
  readonly color: string;
  readonly fill: string;
  readonly softFill: string;
}

export function habitCategoryTone(option: HabitCategoryOption, ground: string, dark: boolean): HabitCategoryTone {
  const color = habitCategoryColor(option, dark);
  return Object.freeze({
    color,
    fill: mixColors(ground, color, 0.15),
    softFill: withAlpha(color, 0.6),
  });
}

/*
 * The met fill is **deleted, not left dormant.**
 *
 * It was the surface a closed item took — the category at 30 % of the ground — and its
 * only consumer was the mark, which repainted itself on completion. PD-PLATE-012 says a
 * completed item keeps its own mark and only the checkbox goes green, so with the mark
 * left alone nothing paints them: a derived value that reaches no column is exactly the
 * kind of thing a green suite keeps describing after the code it belongs to is dead.
 */

/** The density mark under a date: the category colour at 60 %, as the strip draws it. */
export function habitCategoryDensityColor(option: HabitCategoryOption, dark: boolean): string {
  return withAlpha(habitCategoryColor(option, dark), 0.6);
}
