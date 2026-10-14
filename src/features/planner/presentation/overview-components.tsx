import { useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { useLifePlannerTheme } from '@/src/ui/theme';

import {
  OVERVIEW_GRAINS,
  OVERVIEW_GRAIN_LABELS,
  type OverviewBar,
  type OverviewGrain,
} from './overview-model';

/**
 * The three pieces Overview draws in more than one place — the ring, the grain
 * segment and the bars. They live here rather than in the screen so the opened
 * panel can use the same ones without importing the screen that opens it.
 */

const SEGMENT_HEIGHT = 34;
const SEGMENT_DURATION = 240;

/**
 * The completion ring, restored from the dashboard component the journal package
 * removed. No vector dependency ships, so the arc is two clipped halves of a
 * bordered circle: the coloured span runs −45° to 135°, and rotating each half ends
 * that span exactly where the fraction asks.
 */
export function ProgressRing({ fraction, size, stroke, trackColor, fillColor, animate = true, children }: PropsWithChildren<{
  readonly fraction: number;
  readonly size: number;
  readonly stroke: number;
  readonly trackColor: string;
  readonly fillColor: string;
  readonly animate?: boolean;
}>): ReactNode {
  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const progress = useRef(new Animated.Value(clamped)).current;
  const previous = useRef(clamped);
  if (previous.current !== clamped) {
    previous.current = clamped;
    if (animate) {
      Animated.timing(progress, { duration: 240, easing: Easing.out(Easing.cubic), toValue: clamped, useNativeDriver: true }).start();
    } else {
      progress.setValue(clamped);
    }
  }
  const half = size / 2;
  const arc = { borderRadius: half, borderWidth: stroke, height: size, position: 'absolute' as const, top: 0, width: size };
  const arcColors = { borderBottomColor: 'transparent', borderLeftColor: 'transparent', borderRightColor: fillColor, borderTopColor: fillColor };
  const trailing = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-135deg', '45deg', '45deg'] });
  const leading = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['45deg', '45deg', '225deg'] });
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: size, width: size }}>
    <View style={[StyleSheet.absoluteFill, { borderColor: trackColor, borderRadius: half, borderWidth: stroke }]} />
    <View style={[styles.ringClip, { height: size, left: half, width: half }]}>
      <Animated.View style={[arc, arcColors, { left: -half, transform: [{ rotate: trailing }] }]} />
    </View>
    <View style={[styles.ringClip, { height: size, left: 0, width: half }]}>
      <Animated.View style={[arc, arcColors, { left: 0, transform: [{ rotate: leading }] }]} />
    </View>
    <View style={[StyleSheet.absoluteFill, styles.ringCentre]}>{children}</View>
  </View>;
}

/**
 * The selected third is one surface that slides rather than three that repaint —
 * and the press stops here, because changing the grain is not opening the card.
 */
export function GrainSegment({ grain, reduceMotion, onGrain }: {
  readonly grain: OverviewGrain;
  readonly reduceMotion: boolean;
  readonly onGrain: (grain: OverviewGrain) => void;
}) {
  const theme = useLifePlannerTheme();
  const [width, setWidth] = useState(0);
  const index = OVERVIEW_GRAINS.indexOf(grain);
  const travel = useRef(new Animated.Value(index)).current;
  // Two of these exist — one on the card, one inside the opened panel — over one
  // piece of state. The pill follows the grain wherever it was changed, so the
  // card is never left with its pill under the wrong word.
  const settled = useRef(index);
  if (settled.current !== index) {
    settled.current = index;
    travel.setValue(index);
  }
  const slide = (next: number) => {
    // Claim the destination before the state comes back, or the sync above would
    // snap this pill to where it is already travelling and eat its own animation.
    settled.current = next;
    if (reduceMotion) { travel.setValue(next); return; }
    Animated.timing(travel, {
      duration: SEGMENT_DURATION,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      toValue: next,
      useNativeDriver: true,
    }).start(({ finished }) => { if (!finished) travel.setValue(next); });
  };
  const third = Math.max(0, (width - 4) / OVERVIEW_GRAINS.length);
  return <View
    onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    style={[styles.segment, { backgroundColor: theme.today.segmentTrack }]}
  >
    <Animated.View style={[styles.segmentPill, {
      backgroundColor: theme.today.dashboardSurface,
      shadowColor: theme.today.primaryText,
      transform: [{ translateX: travel.interpolate({ inputRange: [0, 2], outputRange: [0, third * 2] }) }],
      width: third,
    }]} />
    {OVERVIEW_GRAINS.map((option, position) => <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: option === grain }}
      key={option}
      onPress={() => { slide(position); onGrain(option); }}
      style={styles.segmentSlot}
    >
      <Text style={[styles.caption, { color: option === grain ? theme.today.primaryText : theme.today.secondaryText }]}>
        {OVERVIEW_GRAIN_LABELS[option]}
      </Text>
    </Pressable>)}
  </View>;
}

/**
 * One bar per unit, and every one of them a door once the panel is open. The unit
 * in progress is drawn softer because it is not a finished figure; a unit that has
 * not happened yet carries no fill at all and an em dash for a value.
 */
export function RecordBars({ bars, height, longLabels = false, onSelect }: {
  readonly bars: readonly OverviewBar[];
  readonly height: number;
  readonly longLabels?: boolean;
  readonly onSelect?: (index: number) => void;
}) {
  const theme = useLifePlannerTheme();
  return <View style={styles.bars}>
    {bars.map((bar, index) => {
      const body = <>
        <Text style={[styles.barValue, { color: bar.current ? theme.today.completion : theme.today.tertiaryText }]}>
          {bar.percent === null ? '—' : bar.percent}
        </Text>
        <View style={[styles.barTrack, {
          backgroundColor: bar.future ? 'transparent' : theme.today.tone200,
          borderColor: bar.future ? theme.today.tone200 : 'transparent',
          borderWidth: bar.future ? 1 : 0,
          height,
        }]}>
          <View style={[styles.barFill, {
            backgroundColor: theme.today.completion,
            height: `${Math.round(((bar.percent ?? 0) / 100) * 100)}%`,
            opacity: bar.current ? 0.45 : 1,
          }]} />
        </View>
        <Text
          numberOfLines={1}
          style={[styles.barLabel, { color: bar.current ? theme.today.completion : theme.today.tertiaryText }]}
        >
          {longLabels ? bar.longLabel : bar.label}
        </Text>
      </>;
      return onSelect === undefined || bar.percent === null
        ? <View key={bar.key} style={styles.barColumn}>{body}</View>
        : <Pressable
          accessibilityHint="Opens this unit"
          accessibilityLabel={`${bar.longLabel}, ${bar.percent}%`}
          accessibilityRole="button"
          key={bar.key}
          onPress={() => onSelect(index)}
          style={styles.barColumn}
        >
          {body}
        </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  barColumn: { alignItems: 'center', flex: 1, gap: 4 },
  barFill: { borderRadius: 3, bottom: 0, left: 0, position: 'absolute', right: 0 },
  barLabel: { fontSize: 11, fontWeight: '600' },
  barTrack: { alignSelf: 'stretch', borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' },
  barValue: { fontSize: 11, fontWeight: '700' },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 6 },
  caption: { fontSize: 13, fontWeight: '500' },
  ringCentre: { alignItems: 'center', justifyContent: 'center' },
  ringClip: { overflow: 'hidden', position: 'absolute', top: 0 },
  segment: { borderRadius: 11, flexDirection: 'row', height: SEGMENT_HEIGHT, padding: 2 },
  segmentPill: { borderRadius: 9, bottom: 2, elevation: 1, left: 2, position: 'absolute', shadowOffset: { height: 1, width: 0 }, shadowOpacity: 0.1, shadowRadius: 2, top: 2 },
  segmentSlot: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
