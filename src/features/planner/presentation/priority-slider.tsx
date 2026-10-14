import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import type { ImportanceLevel } from '@/src/features/planner';
import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { IMPORTANCE_STOPS } from './planner-form-control-model';
import { priorityTrackBands, priorityTrackWeights, prioritySliderLevel, prioritySliderRatio } from './priority-slider-model';
import { IMPORTANCE_LABELS } from './ui-adapters';

const THUMB = 26;
const TRACK_HEIGHT = 6;
/** How far a flick carries past the finger before the magnet takes over, per px/ms. */
const RELEASE_INERTIA = 55;

/*
 * `PRIORITY_CONSEQUENCE`, the `card` variant and the `preview` row are **deleted.**
 *
 * The caption described a row that has not existed since PD-PLATE-016 — "Three ticks
 * and a full-height edge" for a plate that draws no ticks at all — and it was
 * unreachable besides: the only caller has passed `variant="inline"` since Edit became
 * this same screen, and `inline` is the branch that hides the caption. A string nothing
 * renders, describing a thing nothing draws, is the exact pair this project keeps
 * finding behind a green suite.
 *
 * What the levels actually do is now said by the **track**, which is painted in the
 * colours the plate will take, and by the stop labels under it.
 */

/**
 * PD-PRIORITY-001: four stops, snapping, with a haptic at each one.
 *
 * The thumb follows the finger continuously and is magnetised onto the nearest stop
 * when it is let go — it used to be drawn at whichever of four positions the current
 * value implied, so it could only ever click from one to the next. A flick carries a
 * little past where the finger left, and the stop that carry reaches is the stop
 * that is chosen.
 *
 * Built from `PanResponder` rather than a slider dependency — none is installed and
 * adding one is not authorised — and the track is stacked bands for the same reason
 * the bottom-layer scrim is. The consequence is visible while the finger is still
 * down: the ticks and the edge on the row above are the point.
 */
export function PrioritySlider({ value, onChange, onDragStateChange }: {
  readonly value: ImportanceLevel;
  readonly onChange: (value: ImportanceLevel) => void;
  /**
   * Raised while a finger is on the track. The screen holds its scroll still for
   * the duration: a drag that is a few degrees off horizontal otherwise gives its
   * vertical component to the scroll view, and the page moves under the thumb.
   */
  readonly onDragStateChange?: (dragging: boolean) => void;
}) {
  const theme = useLifePlannerTheme();
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const widthRef = useRef(0);
  /**
   * **The track is what the plate will draw, not a ramp towards it.**
   *
   * The quiet half is the rail's own groove rather than the low ink: low and normal put
   * no spine on a plate, so the band that stands for them may not look like a colour
   * that means something. High and critical take the spine's own `rankHigh` and
   * `attention` — the values the day paints, not their readable label forms.
   */
  const bands = useMemo(
    () => priorityTrackBands(theme.today.rail, theme.today.rankHigh, theme.today.attention),
    [theme.today.attention, theme.today.rail, theme.today.rankHigh],
  );
  const weights = useMemo(() => priorityTrackWeights(), []);
  const ink = priorityInk(theme, value);

  // The thumb's own position in points along the track. While a finger is on it this
  // is not derived from the value: deriving it is exactly what made it click from
  // stop to stop instead of moving.
  const position = useRef(new Animated.Value(0)).current;
  const draggingRef = useRef(false);
  const dragStateRef = useRef(onDragStateChange);
  dragStateRef.current = onDragStateChange;
  const offsetRef = useRef(0);
  const originRef = useRef(0);
  const trackRef = useRef<View>(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  // One update per frame, and only when the stop changes. A drag emits move events
  // far faster than the screen can re-render.
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<ImportanceLevel | null>(null);
  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); }, []);

  const span = () => Math.max(1, widthRef.current - THUMB);
  const stopOffset = (level: ImportanceLevel) => prioritySliderRatio(level) * Math.max(0, widthRef.current - THUMB);
  const clampOffset = (offset: number) => Math.min(Math.max(0, offset), Math.max(0, widthRef.current - THUMB));

  const announce = (next: ImportanceLevel) => {
    if (next === valueRef.current) return;
    valueRef.current = next;
    void Haptics.selectionAsync();
    pendingRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const settled = pendingRef.current;
      pendingRef.current = null;
      if (settled !== null) onChange(settled);
    });
  };

  // `locationX` is measured against whichever view the touch landed on, and the
  // track is 24 band views wide, so it flipped between their coordinate spaces frame
  // by frame. The gesture's absolute page position minus this control's own measured
  // origin is the only reading that means the same thing each time.
  const follow = (pageX: number) => {
    const offset = clampOffset(pageX - originRef.current - THUMB / 2);
    offsetRef.current = offset;
    position.setValue(offset);
    announce(prioritySliderLevel(offset / span()));
  };

  const settle = (velocityX: number) => {
    draggingRef.current = false;
    dragStateRef.current?.(false);
    const projected = clampOffset(offsetRef.current + velocityX * RELEASE_INERTIA);
    const landing = prioritySliderLevel(projected / span());
    announce(landing);
    const target = stopOffset(landing);
    offsetRef.current = target;
    if (reduceMotionRef.current) {
      position.setValue(target);
      return;
    }
    Animated.spring(position, {
      damping: 20,
      mass: 0.9,
      stiffness: 240,
      toValue: target,
      useNativeDriver: true,
      velocity: velocityX * 1000,
    }).start();
  };

  // The whole gesture belongs to the track, in both axes: a drag that is a few
  // degrees off horizontal used to give its vertical part to the scroll view, so the
  // page slid up and down while the priority was being chosen. Capturing it here
  // stops an ancestor claiming it, and the screen freezes its scroll meanwhile —
  // on iOS the native scroll pan can otherwise still win against a JS responder.
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: (_event, gesture) => {
      draggingRef.current = true;
      dragStateRef.current?.(true);
      follow(gesture.x0);
    },
    onPanResponderMove: (_event, gesture) => follow(gesture.moveX),
    onPanResponderRelease: (_event, gesture) => settle(gesture.vx),
    onPanResponderTerminate: (_event, gesture) => settle(gesture.vx),
    onShouldBlockNativeResponder: () => true,
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
  })).current;

  const step = (offset: -1 | 1) => {
    const index = IMPORTANCE_STOPS.indexOf(valueRef.current);
    const next = IMPORTANCE_STOPS[Math.min(IMPORTANCE_STOPS.length - 1, Math.max(0, index + offset))];
    if (next === undefined || next === valueRef.current) return;
    valueRef.current = next;
    void Haptics.selectionAsync();
    onChange(next);
  };

  // A value or a width arriving from outside a drag puts the thumb on its stop.
  useEffect(() => {
    if (draggingRef.current) return;
    const target = prioritySliderRatio(value) * Math.max(0, width - THUMB);
    offsetRef.current = target;
    position.setValue(target);
  }, [position, value, width]);

  const measure = (event: LayoutChangeEvent) => {
    widthRef.current = event.nativeEvent.layout.width;
    setWidth(event.nativeEvent.layout.width);
    // Where the track starts on screen, so a page coordinate becomes a position
    // along it. Re-read on every layout: the card moves as the form grows.
    trackRef.current?.measureInWindow((x) => { originRef.current = x; });
  };

  return <View style={styles.inline}>
    <View style={styles.headline}>
      <View style={[styles.dot, { backgroundColor: ink }]} />
      <Text numberOfLines={1} style={[styles.label, { color: theme.today.tertiaryText }]}>Priority</Text>
      <Text style={[styles.levelInline, { color: ink }]}>{IMPORTANCE_LABELS[value]}</Text>
    </View>
    <View
      accessibilityActions={PRIORITY_ACTIONS}
      accessibilityLabel="Habit priority"
      accessibilityRole="adjustable"
      accessibilityValue={{ text: IMPORTANCE_LABELS[value] }}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') step(1);
        if (event.nativeEvent.actionName === 'decrement') step(-1);
      }}
      onLayout={measure}
      ref={trackRef}
      style={styles.slider}
      {...responder.panHandlers}
    >
      {/* The visuals never take the touch: the responder view has to stay the
          target, or the coordinate stops meaning the same thing each frame. */}
      <View pointerEvents="none" style={[styles.track, { height: TRACK_HEIGHT }]}>
        {/* Weighted, not equal: a band is exactly the region that snaps to its stop,
            so the colour under the thumb is the colour the plate is about to take. */}
        {bands.map((band, index) => <View key={index} style={{ backgroundColor: band, flex: weights[index] ?? 1 }} />)}
      </View>
      {/* The stops drawn on the track itself, so the four positions are visible
          before the thumb is touched rather than only named underneath. */}
      <View pointerEvents="none" style={styles.ticks}>
        {IMPORTANCE_STOPS.map((stop) => <View key={stop} style={[styles.tick, { backgroundColor: theme.today.tone300 }]} />)}
      </View>
      <Animated.View
        pointerEvents="none"
        style={[styles.thumb, {
          backgroundColor: theme.today.elevatedSurface,
          borderColor: ink,
          shadowColor: theme.today.primaryText,
          transform: [{ translateX: position }],
        }]}
      />
    </View>
    <View style={styles.stops}>
      {IMPORTANCE_STOPS.map((stop) => <Text
        key={stop}
        style={[styles.stopLabel, {
          color: stop === value ? ink : theme.today.tertiaryText,
          // 600 rather than 700: the plate language allows no 700 anywhere (PD-PLATE-003).
          fontWeight: stop === value ? '600' : '400',
        }]}
      >
        {IMPORTANCE_LABELS[stop]}
      </Text>)}
    </View>
  </View>;
}

const PRIORITY_ACTIONS = Object.freeze([
  Object.freeze({ label: 'Raise priority', name: 'increment' }),
  Object.freeze({ label: 'Lower priority', name: 'decrement' }),
]);

function priorityInk(theme: ReturnType<typeof useLifePlannerTheme>, level: ImportanceLevel): string {
  if (level === 'critical') return theme.today.priorityCritical;
  if (level === 'high') return theme.today.priorityHigh;
  if (level === 'normal') return theme.today.priorityNormal;
  return theme.today.priorityLow;
}

const styles = StyleSheet.create({
  inline: { gap: 2 },
  headline: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  dot: { borderRadius: 5, height: 9, width: 9 },
  // `plateType.label` and `plateType.sub`: the block heading and the level beside it.
  label: { flex: 1, fontSize: 11, fontWeight: '500', letterSpacing: 0.6, minWidth: 0, textTransform: 'uppercase' },
  levelInline: { fontSize: 13, fontWeight: '600' },
  // A 44 pt target around a 6 pt track: the track is what is seen, not what is hit.
  slider: { height: 44, justifyContent: 'center' },
  track: { borderRadius: 3, flexDirection: 'row', marginHorizontal: THUMB / 2, overflow: 'hidden' },
  // Absolute, so the track keeps the centre of the 44 pt target to itself.
  ticks: { flexDirection: 'row', justifyContent: 'space-between', left: THUMB / 2, position: 'absolute', right: THUMB / 2, top: 22 + TRACK_HEIGHT / 2 + 2 },
  tick: { height: 5, width: 1 },
  thumb: { borderRadius: THUMB / 2, borderWidth: 2, elevation: 3, height: THUMB, left: 0, position: 'absolute', shadowOffset: { height: 2, width: 0 }, shadowOpacity: 0.18, shadowRadius: 6, width: THUMB },
  stops: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 },
  stopLabel: { fontSize: 11 },
});
