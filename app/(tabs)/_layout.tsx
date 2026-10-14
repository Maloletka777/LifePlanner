import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { Tabs } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import { Animated, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { travelCurve, travelSpring, TAB_STRETCH_MAX } from '@/src/ui/motion';
import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';
import {
  TAB_BAR_ICON_LABEL_GAP,
  TAB_BAR_ICON_SIZE,
  TAB_BAR_INSET,
  TAB_BAR_LABEL_SIZE,
  TAB_BAR_PADDING,
  TAB_BAR_RADIUS,
  TAB_BAR_SLOT_HEIGHT,
  TAB_BAR_SLOT_RADIUS,
} from '@/src/ui/tab-bar';
import { useLifePlannerTheme } from '@/src/ui/theme';

/**
 * The bottom bar (PD-PLATE-009).
 *
 * **Full width on the header's own material, with top corners 22.** The 14 pt inset
 * went with the surface level it implied: a bar floating clear of the ground on three
 * sides is a plate, and a plate is one item. Anchored to the edge it adds no level —
 * it is the bottom of the screen the way the header is the top of it.
 *
 * The labels stay (PD-GLOBAL-010) and the active tab keeps a plate, so selection is
 * never only a colour.
 *
 * The bar is still drawn here rather than configured through `tabBarStyle`.
 * React Navigation's own bar carries `start: 0` and `end: 0`, and in Yoga those
 * outrank the `left`/`right` a floating bar needs, so its geometry can only be
 * requested, never guaranteed. Owning it outright is what makes the inset real.
 */
export default function TabLayout() {
  const theme = useLifePlannerTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  /**
   * **A tab change is the same gesture as a date change** (owner instruction, 2026-08-05).
   *
   * The scene slides in from the side it lies on and the one being left slides out the
   * other way, on the same spring family the drop travels by — `current.progress` is −1
   * for a screen to the left of the active one, 0 for the active one and 1 for a screen
   * to the right, which is exactly a direction and a share in one value.
   *
   * Priced, because it is not free: for the length of the transition **both scenes are
   * mounted and drawn**, so Today's list renders beside whatever it is sliding away from.
   * That is the cost of the two pages being visible at once, and there is no version of
   * a cross-slide that avoids it. Reduce Motion turns the whole thing off rather than
   * shortening it — a slide is spatial information, and at 1 ms it is only a flicker.
   */
  const transition = useMemo(() => ({
    animationEnabled: !reduceMotion,
    sceneStyleInterpolator: ({ current }: { current: { progress: Animated.AnimatedInterpolation<number> } }) => ({
      sceneStyle: {
        // Off-screen scenes are transparent as well as displaced, so a scene that is
        // still laying out is never a half-drawn page sliding past.
        opacity: current.progress.interpolate({ inputRange: [-1, -0.6, 0, 0.6, 1], outputRange: [0, 0.35, 1, 0.35, 0] }),
        transform: [{
          translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-width, 0, width] }),
        }],
      },
    }),
    transitionSpec: {
      animation: 'spring' as const,
      config: { ...travelSpring(1), mass: 1, useNativeDriver: true },
    },
  }), [reduceMotion, width]);
  return (
    <Tabs
      screenOptions={{
        ...transition,
        tabBarActiveTintColor: theme.today.system,
        tabBarInactiveTintColor: theme.today.tertiaryText,
        headerShown: false,
      }}
      tabBar={(props) => <JournalTabBar {...props} />}>
      <Tabs.Screen
        name="index"
        options={{
          // A journal, not a house: the tab is a day journal, and a house says
          // "start screen" — which this application does not have.
          title: 'Today',
          tabBarIcon: ({ color, focused }) => <Ionicons size={TAB_BAR_ICON_SIZE} name={focused ? 'journal' : 'journal-outline'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="growth"
        options={{
          // **Second, beside Today, rather than last.** The two floors are used at the
          // same moment — the day is worked here and the one to three routines being
          // grown are checked on next door — while Overview answers the «over time»
          // question. Last would have made it the tab nobody opens.
          //
          // **The word is the one the switch uses.** The create sheet's toggle says
          // «строю»; a person throws it and arrives here, so the destination carries
          // the same word rather than a second name for one place. Working title —
          // the tab's name is still an open question.
          //
          // **And the leaf had to go, for a reason the registry states.**
          // `leaf-outline` is `habit_generic`, it is `vegetables`, and — the one that
          // decides it — it is the glyph `planner-iconography.ts:165` draws when a
          // symbol cannot be identified. The tab for what a person is building wore
          // the mark for «unknown». `pulse-outline` is used by none of the 94.
          //
          // Priced, because it is not free: `pulse` and `pulse-outline` are near
          // identical — measured at 495 against 494 inked pixels rasterised at 48 px,
          // where `journal` against `journal-outline` is 1236 to 768. A line has no
          // fill. So on this tab the outline/fill rule carries nothing and selection
          // rests on the slot's plate and the label, which PD-GLOBAL-010 already
          // requires be more than colour.
          title: 'Growth',
          tabBarIcon: ({ color, focused }) => <Ionicons size={TAB_BAR_ICON_SIZE} name={focused ? 'pulse' : 'pulse-outline'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          // The route keeps its path for the deep links beneath it; only the tab
          // was renamed, and it is a dashboard now rather than a day list.
          title: 'Overview',
          tabBarIcon: ({ color, focused }) => <Ionicons size={TAB_BAR_ICON_SIZE} name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          href: null,
          title: 'Tasks',
          tabBarIcon: ({ color, focused }) => <Ionicons size={TAB_BAR_ICON_SIZE} name={focused ? 'checkmark-done-circle' : 'checkmark-done-circle-outline'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="finance"
        options={{
          href: null,
          title: 'Finance',
          tabBarIcon: ({ color, focused }) => <Ionicons size={TAB_BAR_ICON_SIZE} name={focused ? 'wallet' : 'wallet-outline'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, focused }) => <Ionicons size={TAB_BAR_ICON_SIZE} name={focused ? 'ellipsis-horizontal-circle' : 'ellipsis-horizontal-circle-outline'} color={color} />,
        }}
      />
    </Tabs>
  );
}

function JournalTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const theme = useLifePlannerTheme();
  const reduceMotion = useReduceMotion();
  const focusedRoute = state.routes[state.index];
  const { tabBarActiveTintColor, tabBarInactiveTintColor } = descriptors[focusedRoute.key].options;
  const routes = state.routes.filter((route) => !isHiddenTab(descriptors[route.key].options.tabBarItemStyle));
  const focusedIndex = Math.max(0, routes.findIndex((route) => route.key === focusedRoute.key));

  /**
   * **The plate travels, and it is the date drop's own model.**
   *
   * It used to be a `backgroundColor` on whichever slot was focused, so selection
   * *appeared* on the new tab rather than moving to it — the same fault the metaball had
   * on the dates, in a different place. One value 0 → 1, the plate's slot interpolated
   * along it, and the stretch sampled from the same spring, so the two surfaces read as
   * one language.
   *
   * The slot has to be measured rather than derived: the bar flexes, a hidden module
   * changes how many slots there are, and a width reconstructed from constants is a
   * standing assumption that breaks the first time one of them moves.
   */
  const [barWidth, setBarWidth] = useState(0);
  const slot = routes.length === 0 ? 0 : (barWidth - TAB_BAR_PADDING * 2) / routes.length;
  /**
   * **`travel` is monotonic and nothing ever writes it.**
   *
   * It ran 0 → 1 per journey and each one began with `travel.setValue(0)`, which is the
   * defect reported from the device as «едет на выбранную, на долю секунды возвращается
   * назад и снова едет». `setValue` lands on the native side **now**; the
   * `setJourney` that says what the value *means* lands with the next render. In the frame
   * between them the plate is drawn at 0 against the **previous** journey's range — and 0
   * there is the tab before last. That is the snap.
   *
   * **This is the fifth defect of exactly this shape in this repository**, and the date
   * drop already carries the cure: a journey claims `[at, at + 1]` from wherever the value
   * happens to stand, and the spring is told to end at `at + 1`. The frame before the
   * render then draws the old range at an unchanged number — which is precisely where the
   * plate already was, so there is nothing to see.
   */
  const travel = useRef(new Animated.Value(1)).current;
  const [journey, setJourney] = useState(() => ({
    curve: travelCurve({ distanceDays: 0, screenDistance: 0 }),
    from: focusedIndex, inEnd: 1, inStart: 0, to: focusedIndex,
  }));
  const settled = useRef(focusedIndex);
  /** Where `travel` actually stands. A natively driven value has no truthful JS copy. */
  const travelValue = useRef(1);
  useEffect(() => {
    const id = travel.addListener(({ value }) => { travelValue.current = value; });
    return () => travel.removeListener(id);
  }, [travel]);

  useEffect(() => {
    if (focusedIndex === settled.current || slot === 0) return;
    const from = settled.current;
    settled.current = focusedIndex;
    const distance = focusedIndex - from;
    const curve = travelCurve({
      distanceDays: distance,
      max: TAB_STRETCH_MAX,
      screenDistance: distance * slot,
    });
    // The range is claimed from where the value stands, never from zero.
    const at = travelValue.current;
    setJourney({ curve, from, inEnd: at + 1, inStart: at, to: focusedIndex });
    if (reduceMotion) {
      travel.setValue(at + 1);
      return;
    }
    const spring = Animated.spring(travel, {
      ...travelSpring(distance),
      mass: 1,
      toValue: at + 1,
      useNativeDriver: true,
    });
    spring.start();
    return () => spring.stop();
  }, [focusedIndex, reduceMotion, slot, travel]);

  // **Every reader is bound to `[inStart, inEnd]`.** Leaving one on `[0, 1]` does not fail
  // loudly — the value keeps growing and the default extrapolation keeps extending, so the
  // surface walks off the screen a slot per tab change.
  const plateX = travel.interpolate({
    extrapolate: 'clamp',
    inputRange: [journey.inStart, journey.inEnd],
    outputRange: [TAB_BAR_PADDING + journey.from * slot, TAB_BAR_PADDING + journey.to * slot],
  });
  const plateStretch = travel.interpolate({
    extrapolate: 'clamp',
    inputRange: (journey.curve.progress as number[]).map((at) => journey.inStart + at),
    outputRange: journey.curve.stretch as number[],
  });
  const plateSquash = travel.interpolate({
    extrapolate: 'clamp',
    inputRange: (journey.curve.progress as number[]).map((at) => journey.inStart + at),
    outputRange: journey.curve.squash as number[],
  });
  // **The safe area is under a floating bar rather than inside it.** Full width and
  // anchored to the edge, the bar had to hold the home-indicator room itself; an oval
  // that comes off all four edges sits above the indicator instead.
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.layer, { bottom: TAB_BAR_INSET + insets.bottom }]}>
      {/* One of exactly **two** blurred surfaces on a screen — this and the header.
          Plates are opaque on purpose: a `BlurView` under every list row is a blur
          recomputed on every scroll frame, which is precisely the cost that tears a
          list. Visually one material; in cost, two different things. */}
      <BlurView
        accessibilityRole="tablist"
        intensity={theme.today.materialBlur}
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
        style={[styles.bar, { shadowColor: theme.today.primaryText }]}
        tint={theme.dark ? 'dark' : 'light'}
      >
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.today.materialFill }]} />
        {/* One plate, under the slots, travelling. **It is glass now, the same glass the
            date drop wears** (owner decision, 2026-08-05): `primaryText` at a low alpha
            plus a hairline, which is near-black over a light bar and near-white over a
            black one. It used to be `systemTint` — the structural accent washed — and with
            structure no longer carrying a hue that token would have painted a grey wash
            with no edge, which reads as a rendering artefact rather than as the selection.
            The hairline is what makes a translucent region a shape. */}
        {slot === 0 ? null : <Animated.View
          pointerEvents="none"
          style={[styles.plate, {
            backgroundColor: theme.today.structGlass,
            borderColor: theme.today.hairline,
            borderWidth: StyleSheet.hairlineWidth,
            transform: [{ translateX: plateX }, { scaleX: plateStretch }, { scaleY: plateSquash }],
            width: slot,
          }]}
        />}
        {routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = route.key === focusedRoute.key;
          const color = (focused ? tabBarActiveTintColor : tabBarInactiveTintColor) ?? theme.today.tertiaryText;
          const label = options.title ?? route.name;
          return (
            <HapticTab
              key={route.key}
              // The spoken label follows the visible one: a bar reading «Сегодня»
              // announced as "Today, tab, 1 of 4" is two names for one control.
              accessibilityLabel={`${label}, tab ${index + 1} of ${routes.length}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              style={styles.slot}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              onPress={() => {
                const event = navigation.emit({ canPreventDefault: true, target: route.key, type: 'tabPress' });
                if (focused || event.defaultPrevented) return;
                navigation.dispatch({ ...CommonActions.navigate(route.name, route.params), target: state.key });
              }}
            >
              {options.tabBarIcon?.({ color, focused, size: TAB_BAR_ICON_SIZE })}
              {/* The word never scales: a bar that grows with Dynamic Type would
                  push the ground it floats on, and the icon already carries the
                  meaning for anyone who needs the larger type. */}
              <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, { color }]}>{label}</Text>
            </HapticTab>
          );
        })}
      </BlurView>
    </View>
  );
}

/**
 * A module that is not built yet is parked with a null `href`. Expo Router turns
 * that into `tabBarItemStyle: { display: 'none' }`, which is the only mark a custom
 * bar can read back — a hidden route is otherwise an ordinary route.
 */
function isHiddenTab(itemStyle: StyleProp<ViewStyle>): boolean {
  return StyleSheet.flatten(itemStyle)?.display === 'none';
}

const styles = StyleSheet.create({
  // The layer paints nothing and passes touches through, so the day's ground runs
  // unbroken beneath the bar rather than stopping at it.
  layer: { bottom: TAB_BAR_INSET, left: TAB_BAR_INSET, position: 'absolute', right: TAB_BAR_INSET },
  /**
   * **An oval, on all four edges.** The radius is half the height, so the ends are
   * semicircles rather than a rounded rectangle's corners, and the shadow falls
   * outwards on every side because the bar is over the page rather than under it.
   */
  bar: {
    borderRadius: TAB_BAR_RADIUS,
    elevation: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    paddingHorizontal: TAB_BAR_PADDING,
    paddingVertical: TAB_BAR_PADDING,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
  // `600` on the active label is one of the **three** places the weight rule allows
  // it; an inactive one is regular (PD-PLATE-003).
  label: { fontSize: TAB_BAR_LABEL_SIZE, fontWeight: '500' },
  // The travelling plate keeps the bar's own curve minus the padding around it, and it
  // is placed by a transform rather than by `left` so nothing about it is layout.
  plate: {
    borderRadius: TAB_BAR_SLOT_RADIUS,
    height: TAB_BAR_SLOT_HEIGHT,
    left: 0,
    position: 'absolute',
    top: TAB_BAR_PADDING,
  },
  slot: {
    alignItems: 'center',
    borderRadius: TAB_BAR_SLOT_RADIUS,
    flex: 1,
    gap: TAB_BAR_ICON_LABEL_GAP,
    height: TAB_BAR_SLOT_HEIGHT,
    justifyContent: 'center',
  },
});
