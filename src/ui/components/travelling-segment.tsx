import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';
import { travelCurve, travelSpring } from '@/src/ui/motion';
import { useLifePlannerTheme } from '@/src/ui/theme';

/**
 * A chooser of two or three slots whose selection **travels** rather than switching.
 *
 * Owner instruction, 2026-08-06: «для переключения плашек task — habit должна быть
 * анимация, как у apple reminder, где капля перескакивает с плашки на плашку».
 *
 * **It is not a third animation.** `src/ui/motion.ts` already carries the one travel
 * model the application has, and the date drop and the tab bar's plate are already its
 * two readers; this is the third, and it adds no constant. The spring is
 * `travelSpring(1)` — a segment always moves exactly one slot, so it always takes the
 * stiffest member of the family — and the stretch table is `travelCurve` sampled against
 * the distance the drop actually crosses **on screen**, which is why the width is
 * measured rather than computed from the screen.
 *
 * **The drop is `structGlass`, exactly as the header's bead is built** (PD-PLATE-019):
 * tint, a hairline, and a shadow that is transparent on the dark ground. The hairline is
 * load-bearing — a translucent region without an edge reads as a rendering artefact
 * rather than as the selection.
 *
 * That it is glass is not decoration here. The opaque slot it replaces measured **1.03:1**
 * against its own track in Dark — `dashboardSurface` `#1C1E21` over a `segmentTrack` that
 * composites to `#1B1B1B` on a black ground — so the selected slot was held apart from
 * the unselected ones by a shadow at 8 % and nothing else. The glass drop measures 1.71:1.
 * In Light it composites *darker* than the track rather than lighter, which is the same
 * token behaving as its own note describes: one expression that lifts a shape on black
 * and sinks one on white.
 *
 * **`Animated` rather than Reanimated**, unlike the date drop. That one moved because
 * Skia reads shared values and a lens rides inside it; there is no lens here, and a
 * transform on the native driver never touches the JS thread either way. Reaching for
 * Reanimated would buy nothing and cost a second idiom in one control.
 */
export interface TravellingSegmentSlot {
  readonly key: string;
  readonly label: string;
  /** Drawn before the label. The type chooser carries the shape its mark will take. */
  readonly node?: ReactNode;
  readonly accessibilityLabel?: string;
}

/** The track's own padding, from the control this replaces. The radii follow it. */
const SEGMENT_PADDING = 3;
const SEGMENT_GAP = 6;

export function TravellingSegment({ slots, value, onChange, disabled = false, compact = false }: {
  readonly slots: readonly TravellingSegmentSlot[];
  readonly value: string;
  readonly onChange: (key: string) => void;
  readonly disabled?: boolean;
  /** Drops the label a step, for a chooser that sits inside a plate rather than above one. */
  readonly compact?: boolean;
}) {
  const theme = useLifePlannerTheme();
  const reduceMotion = useReduceMotion();
  const slotRadius = theme.todayGlass.controlRadius;

  // **Measured, never reconstructed.** A slot width derived from the screen less the
  // margins is a standing assumption that breaks the moment a padding or a text size
  // moves; `onLayout` costs a frame and removes the whole class of error.
  const [inner, setInner] = useState(0);
  const measure = (event: LayoutChangeEvent) => setInner(event.nativeEvent.layout.width);
  const count = Math.max(1, slots.length);
  const slotWidth = inner === 0 ? 0 : (inner - SEGMENT_GAP * (count - 1)) / count;
  const step = slotWidth + SEGMENT_GAP;

  const index = Math.max(0, slots.findIndex((slot) => slot.key === value));
  const progress = useRef(new Animated.Value(1)).current;
  const standingAt = useRef(index);
  const [journey, setJourney] = useState({ from: index, to: index });

  useEffect(() => {
    if (index === standingAt.current) return;
    const from = standingAt.current;
    standingAt.current = index;
    setJourney({ from, to: index });
    progress.setValue(0);
    // Reduce Motion commits in one frame — the drop is where it belongs, it simply
    // never travelled there.
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const run = Animated.spring(progress, { ...travelSpring(1), mass: 1, toValue: 1, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [index, progress, reduceMotion]);

  /**
   * Stretch is a function of velocity, and velocity is the derivative of progress —
   * which no `Animated` graph can take. So the spring is integrated once per width and
   * handed over as an input/output pair, which is the same trick the date drop uses.
   */
  const curve = useMemo(() => travelCurve({ distanceDays: 1, screenDistance: step }), [step]);

  const travel = {
    transform: [
      {
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [journey.from * step, journey.to * step],
          extrapolate: 'clamp' as const,
        }),
      },
      // The stretch runs along the journey and the squash across it, so the drop reads
      // as having mass rather than as growing.
      { scaleX: progress.interpolate({ inputRange: [...curve.progress], outputRange: [...curve.stretch], extrapolate: 'clamp' as const }) },
      { scaleY: progress.interpolate({ inputRange: [...curve.progress], outputRange: [...curve.squash], extrapolate: 'clamp' as const }) },
    ],
  };

  return <View
    accessibilityRole="tablist"
    onLayout={measure}
    style={[styles.track, { backgroundColor: theme.today.segmentTrack, borderRadius: slotRadius + SEGMENT_PADDING }]}
  >
    {/* **Written before the slots so the slots paint over it.** Order alone, and
        deliberately not `zIndex`: lifting the bead over its own labels is the defect
        that made the date selection read as a flat fill for a whole package. */}
    {slotWidth === 0 ? null : <Animated.View
      pointerEvents="none"
      style={[styles.drop, travel, {
        backgroundColor: theme.today.structGlass,
        borderColor: theme.today.hairline,
        borderRadius: slotRadius,
        height: Math.max(0, theme.layout.control.minimumTouchTarget),
        shadowColor: theme.dark ? 'transparent' : theme.colors.shadow,
        width: slotWidth,
      }]}
    />}

    {slots.map((slot) => {
      const selected = slot.key === value;
      const ink = selected ? theme.today.primaryText : theme.today.secondaryText;
      return <Pressable
        accessibilityLabel={slot.accessibilityLabel ?? slot.label}
        accessibilityRole="tab"
        accessibilityState={{ disabled, selected }}
        disabled={disabled}
        key={slot.key}
        onPress={() => { if (!disabled) onChange(slot.key); }}
        style={styles.slot}
      >
        {slot.node ?? null}
        <Text numberOfLines={1} style={[compact ? styles.labelCompact : styles.label, { color: ink }]}>{slot.label}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: SEGMENT_GAP, padding: SEGMENT_PADDING, position: 'relative' },
  // `left: SEGMENT_PADDING` puts the drop's origin on the first slot's own edge, so the
  // journey is whole slots and the padding is never part of the distance.
  drop: {
    borderWidth: StyleSheet.hairlineWidth,
    left: SEGMENT_PADDING,
    position: 'absolute',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    top: SEGMENT_PADDING,
  },
  slot: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 44, minWidth: 0 },
  // `plateType.body` and `plateType.sub`: no 700 anywhere, and the selected slot is
  // marked by the drop under it rather than by a heavier word.
  label: { fontSize: 15, fontWeight: '500' },
  labelCompact: { fontSize: 13, fontWeight: '500' },
});
