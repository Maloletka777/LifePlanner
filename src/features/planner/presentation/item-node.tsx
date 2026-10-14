import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { PersistedHabitAccentKey } from '@/src/features/planner';
import { mixColors, useLifePlannerTheme } from '@/src/ui/theme';

import type { RegisteredHabitSymbolKey } from '../domain/identity/habit-symbol-catalogue';
import { habitIconography } from './planner-iconography';

/** What an item is, in the one place both surfaces read it from. */
export type ItemNodeKind = 'task' | 'habit';

/** The stored identity, exactly as the catalogue already carries it. */
export type ItemNodeIdentity = Readonly<{ kind?: unknown; symbolKey?: unknown; emoji?: unknown }> | null | undefined;

/** The bare dot, and the mark that carries a symbol. */
export const ITEM_NODE_DOT = 11;
export const ITEM_NODE_MARK = 24;

/**
 * One mark, and it says two things: which of the two shapes this is, and — where
 * there is room for it — which item.
 *
 * A **task** is filled and a **habit** is a ring around its own washed colour, and
 * that is the whole shape language. Neither changes because the item has a minute or
 * has not (PD-TODAY-035): having no time is already said by the empty time cell and
 * by sitting under `Anytime`.
 *
 * **The symbol is drawn inside that same shape rather than instead of it.** An
 * identity tile would have carried the glyph and lost the shape, and the shape is
 * what lets a task and a habit sit in one list without a label explaining which is
 * which (PD-MANAGE-011). Filled with the glyph knocked out, or ringed with the glyph
 * in the item's own colour — both meanings survive, and the mark grows from 11 pt to
 * 24 to make room for one.
 *
 * **A caller that passes no identity gets the bare 11 pt dot**, unchanged. That is a
 * decision rather than transitional plumbing: the journal is a timeline whose row
 * rhythm stands on a 17 pt node column, and it keeps the dot until its own redesign
 * asks for the glyph. One module either way, so the two surfaces cannot drift into
 * drawing the same item differently — which is the whole reason this file exists.
 *
 * The fill is always opaque: translucent, it let the day's axis show straight
 * through, so the line appeared to run over the item rather than behind it. A
 * reminder is a ring **around** the mark (PD-TODAY-036) which never fills, because a
 * filled halo would mask the axis and break the day's one line.
 */
export function ItemNode({ kind, color, reminded = false, identity, accentKey }: {
  readonly kind: ItemNodeKind;
  readonly color: string;
  /** Only the journal passes this: Manage's row draws no reminder. */
  readonly reminded?: boolean;
  /**
   * The item's stored identity. **Passing it is what asks for the symbol**, and with
   * it the mark is 24 pt rather than 11; omitting it keeps the bare dot.
   */
  readonly identity?: ItemNodeIdentity;
  /** Read only to resolve a symbol's own tone; the mark itself paints from `color`. */
  readonly accentKey?: PersistedHabitAccentKey;
}) {
  const theme = useLifePlannerTheme();
  const ground = theme.today.dashboardSurface;
  const wash = mixColors(ground, color, 0.28);

  if (identity === undefined || identity === null) {
    const dot = kind === 'task'
      ? <View style={[styles.dot, { backgroundColor: color, borderColor: color }]} />
      : <View style={[styles.dot, { backgroundColor: wash, borderColor: color }]} />;
    if (!reminded) return dot;
    return <View style={styles.reminder}>
      <View style={[styles.reminderRing, { borderColor: mixColors(ground, color, 0.55) }]} />
      {dot}
    </View>;
  }

  // An item saved with an exact emoji keeps it (PD-IDENTITY-002): it is the person's
  // own character and is never substituted for a registered symbol that merely
  // resembles it. Anything else resolves through the shared iconography, which falls
  // back to a generic symbol rather than to nothing — so an item that never chose
  // one still has a mark instead of a hole.
  const emoji = identity.kind === 'emoji' && typeof identity.emoji === 'string' && identity.emoji.length > 0
    ? identity.emoji
    : null;
  const symbolKey = identity.kind === 'symbol' && typeof identity.symbolKey === 'string'
    ? identity.symbolKey as RegisteredHabitSymbolKey
    : 'habit_generic';
  const glyph = habitIconography(symbolKey, accentKey ?? 'green').icon;
  // On a filled task the glyph is knocked out in the ground, which is the same
  // relationship the application already uses for anything drawn on an accent — and
  // it carries the same recorded limit (PD-APPEARANCE-004): on the lightest of the
  // six category colours this is the weakest contrast on the screen, and it is a
  // device check at minimum brightness rather than a number asserted here.
  const filled = kind === 'task';
  return <View style={[styles.mark, { backgroundColor: filled ? color : wash, borderColor: color }]}>
    {emoji === null
      ? <Ionicons accessibilityElementsHidden color={filled ? ground : color} name={glyph} size={13} />
      : <Text accessibilityElementsHidden maxFontSizeMultiplier={1} style={styles.emoji}>{emoji}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  dot: { borderRadius: ITEM_NODE_DOT / 2, borderWidth: 2, height: ITEM_NODE_DOT, width: ITEM_NODE_DOT },
  // The ring is absolute and the dot stays in flow, so a reminder can never move the
  // node off the vertical the axis and every other row stand on.
  reminder: { alignItems: 'center', justifyContent: 'center' },
  reminderRing: { borderRadius: 8.5, borderWidth: 1.5, height: 17, position: 'absolute', width: 17 },
  // A circle rather than a rounded tile: the shape is the one the dot already was, so
  // a person who learnt filled-versus-ringed on the journal reads Manage unchanged.
  mark: { alignItems: 'center', borderRadius: ITEM_NODE_MARK / 2, borderWidth: 2, height: ITEM_NODE_MARK, justifyContent: 'center', width: ITEM_NODE_MARK },
  // Capped, because an emoji that grew with Dynamic Type would outgrow the circle.
  emoji: { fontSize: 13, lineHeight: 16 },
});
