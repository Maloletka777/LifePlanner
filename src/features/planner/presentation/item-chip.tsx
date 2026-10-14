import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import type { PersistedHabitAccentKey } from '@/src/features/planner';
import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';
import { mixColors, useLifePlannerTheme, withAlpha } from '@/src/ui/theme';

import type { HabitIconIdentity } from '../domain/identity/habit-visual-identity';
import { JOURNAL_MET_MS } from './day-journal-model';
import { habitCategory, habitCategoryTone, type HabitCategoryKey } from './habit-category-catalogue';
import { HABIT_SYMBOL_GLYPHS } from './planner-iconography';

/**
 * The mark an item wears, and the colour its rank is — in the one place both surfaces
 * read them from.
 *
 * The journal and Manage draw the same item, and until this module they drew it from
 * two copies of the same rule. That is exactly the divergence `item-node.tsx` exists to
 * prevent, so the chip, its tone, its glyph and the rank's tint moved here whole rather
 * than being copied a second time (PD-MANAGE-022). Nothing about what either screen
 * draws changed on the way: this is a move, and the journal's behaviour is unchanged.
 *
 * `item-node.tsx` stays where it is — the create sheet still draws the bare node beside
 * its name field, and that is a different mark for a different job.
 */

/**
 * **A mark has no border** (PD-PLATE-001).
 *
 * It was 1.25 pt of the category colour around a 15 % wash of it — two statements of
 * one hue, and a border on an object that is not a box. The mark is the fill and the
 * glyph now: 13 % over the plate, the glyph in the colour itself, both clearing 3:1.
 *
 * The constant survives at zero because the met layer's inset is read from it: a fill
 * that has to reach *over* a border where there is one, and exactly to the edge where
 * there is not, is one expression either way rather than two that can disagree.
 */
export const CHIP_BORDER = 0;

/** What an item is: the one distinction the shape carries. */
export type ItemChipKind = 'task' | 'habit';

/**
 * Everything the mark needs about an item, and nothing about a day.
 *
 * Stated as its own type rather than as the journal's row so that Manage — which holds
 * a catalogue item and no occurrence at all — can ask for the same mark.
 */
export interface ItemChipSubject {
  readonly categoryKey: HabitCategoryKey | null;
  readonly accentKey: PersistedHabitAccentKey | null;
}

/** An item's category tone against the surface it is actually drawn on. */
export function categoryTone(theme: ReturnType<typeof useLifePlannerTheme>, subject: ItemChipSubject) {
  const ground = theme.today.dashboardSurface;
  if (subject.categoryKey !== null) return habitCategoryTone(habitCategory(subject.categoryKey), ground, theme.dark);
  // An item painted before categories existed keeps the accent it was actually saved
  // with rather than a neutral, which is what used to leave every mark grey. The tone
  // is derived by the same two rules the catalogue uses, so a legacy item and a
  // categorised one fill and read identically.
  const color = subject.accentKey === null
    ? theme.today.completion
    : theme.habitAccents[subject.accentKey].selectedSwatch;
  return Object.freeze({
    color,
    fill: mixColors(ground, color, 0.13),
    softFill: withAlpha(color, 0.6),
  });
}

/**
 * The item's mark: **the category filled solid**, its own symbol knocked out of it, and
 * the kind in its shape.
 *
 * A habit is a rounded square and a task a circle, which is the one place the two are
 * told apart — so no label has to explain which is which. The square is reserved for
 * habits against a coming habit checkbox table, so the shape means one thing app-wide
 * (PD-TODAY-065). The **checkbox** stays a circle for both: a square one was drawn in the
 * proposal and the owner refused it on 2026-08-05.
 *
 * **The fill went from a 13 % wash to the colour itself**, and it is the change that
 * answers «однотипные плашки». Six washes at one lightness differ from each other by
 * 1.004–1.011:1 and from the plate by 1.15–1.22:1 — that is not a faint colour, it is
 * arithmetically the same colour, so category was carried by an 18 pt glyph and nothing
 * else. Filled, the glyph is knocked out in the plate's own colour and measures 4.01–4.48:1
 * in Light and 5.93–6.51:1 in Dark. Luminance still cannot separate two categories — they
 * share a lightness by design — so **the glyph remains the primary cue and colour is the
 * reinforcement**, which is also what keeps the mark honest for colour-blind reading.
 *
 * **A completed item keeps its own mark, and nothing here reads `done` any more**
 * (PD-PLATE-012). The green overlay this component used to fade in contradicted that
 * decision outright: the recorded intent and `CURRENT_STATE` both say the mark keeps its
 * identity and only the checkbox goes green, while the code repainted the mark the moment
 * an item closed. Solid, that overlay would have been a full green tile on every closed
 * row.
 *
 * A softer veil of the plate's own colour was drawn as the replacement and **measured out
 * of the design**: at any veil strong enough to read as «receded», the knocked-out glyph
 * fell to 1.74–2.27:1 against what was left of the fill, so an item stopped being
 * recognisable exactly when it was closed. There is no measurement supporting a middle
 * value, so none is invented — the mark is left alone, completion is said by the checkbox
 * and the struck title, and whether a list of closed items reads too loud is a device
 * finding rather than a guess from here.
 */
export function CategoryChip({ accentKey, categoryKey, identity, kind, size }: {
  readonly accentKey: PersistedHabitAccentKey | null;
  readonly categoryKey: HabitCategoryKey | null;
  readonly identity: HabitIconIdentity | null;
  readonly kind: ItemChipKind;
  readonly size: number;
}) {
  const theme = useLifePlannerTheme();
  const tone = categoryTone(theme, { accentKey, categoryKey });

  return <View style={[styles.chip, {
    backgroundColor: tone.color,
    borderColor: tone.color,
    borderRadius: kind === 'habit' ? Math.round(size * 0.29) : size / 2,
    height: size,
    width: size,
  }]}
  >
    <ItemGlyph color={theme.today.dashboardSurface} identity={identity} size={Math.round(size * 0.63)} />
  </View>;
}

/**
 * An item's own symbol, from the identity it already stores.
 *
 * **An exact emoji is drawn as itself and never reduced to a symbol key** — it is the
 * person's own character and is not substituted for a registered symbol that merely
 * resembles it (PD-IDENTITY-002). Anything else resolves through the shared glyph map,
 * which falls back to a generic symbol rather than to nothing, so an item that never
 * chose one still has a mark instead of a hole.
 *
 * On a met mark the glyph inverts to the ground colour; an emoji cannot be recoloured
 * and simply stays itself over the solid fill, which is recorded rather than worked
 * around.
 */
export function ItemGlyph({ identity, size, color }: {
  readonly identity: HabitIconIdentity | null;
  readonly size: number;
  readonly color: string;
}) {
  if (identity !== null && identity.kind === 'emoji') {
    return <Text
      accessibilityElementsHidden
      maxFontSizeMultiplier={1}
      style={{ fontSize: size, lineHeight: size + 3 }}
    >{identity.emoji}</Text>;
  }
  const glyph = identity !== null && identity.kind === 'symbol'
    ? HABIT_SYMBOL_GLYPHS[identity.symbolKey] ?? HABIT_SYMBOL_GLYPHS.habit_generic
    : HABIT_SYMBOL_GLYPHS.habit_generic;
  return <Ionicons accessibilityElementsHidden color={color} name={glyph} size={size} />;
}

/**
 * Completion is the one animation on either surface, and it is a cross-fade of layers.
 *
 * Never an animated `backgroundColor`: a colour driven through `Animated` cannot take
 * the native driver, and a JS-thread interpolation down ten rows is what made the old
 * completion fill climb in steps (PD-PLANNER-V033-UI-017). Reduce Motion commits it in
 * one frame.
 */
export function useMetFade(done: boolean) {
  const reduceMotion = useReduceMotion();
  const met = useRef(new Animated.Value(done ? 1 : 0)).current;
  useEffect(() => {
    const target = done ? 1 : 0;
    if (reduceMotion) {
      met.setValue(target);
      return;
    }
    const run = Animated.timing(met, {
      duration: JOURNAL_MET_MS,
      easing: Easing.inOut(Easing.ease),
      toValue: target,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [done, met, reduceMotion]);
  return met;
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', borderWidth: CHIP_BORDER, justifyContent: 'center' },
  chipMet: { alignItems: 'center', justifyContent: 'center', position: 'absolute' },
});
