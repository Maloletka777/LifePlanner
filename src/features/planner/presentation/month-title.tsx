import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';

/**
 * One fade for every month label in the application.
 *
 * It lives in its own module because **two surfaces show a month and they must change it
 * the same way**: the full-screen calendar, whose pages slide under the finger, and
 * Today's own label, which follows the week strip. A copy in each would be two animations
 * free to drift, which is the fault `item-chip.tsx` was extracted to end.
 *
 * Shorter than the movement it accompanies rather than longer, so the word has settled
 * before the surface under it has.
 */
export const MONTH_TITLE_FADE_MS = 260;

/**
 * How far the word travels, and it is deliberately **a fraction of the page's own
 * distance**. At the full width it would be a second page turn; at nothing it is a
 * cross-fade with no direction, and a swipe back would look the same as a swipe forward.
 */
export const MONTH_TITLE_TRAVEL = 22;

/**
 * The month's name, travelling on the same rail the pages do.
 *
 * **One value, two layers, and the direction is the whole idea.** The pages slide under the
 * finger; the word slides with them — the same way, a third of the distance, over a shorter
 * time — so the header reads as one object moving rather than as a caption performing. What
 * this replaces typed the word out letter by letter, which is a second animation narrating
 * the same event and is what read as clunky.
 *
 * The leaving word goes the way the finger went and the arriving one comes from the other
 * side, so a swipe left and a swipe right are told apart without a label. Stepping by the
 * chevrons uses the same `heading`, so both ways in agree.
 *
 * **Nothing here animates layout.** Both layers are absolutely positioned inside a reserved
 * box, so a longer month can move neither the chevrons nor the other layer; a caller must
 * therefore give a `reservedWidth`. `opacity` and `translateX` only, on the native driver.
 *
 * The run carries **its own value**, created with the letters that read it. Reusing one
 * across changes is what let a `setValue(0)` reposition letters already on screen — a
 * native write landing before the render that replaces them — and that lesson is kept whole
 * even though the motion it belonged to is gone.
 */
export function MonthTitle({ text, heading, reservedWidth, lineHeight, textStyle }: {
  readonly text: string;
  /** Which way the change went: `-1` back, `1` forward, `0` for the first paint. */
  readonly heading: -1 | 0 | 1;
  readonly reservedWidth: number;
  /** The box is held at the word's own leading, so nothing around it can be moved. */
  readonly lineHeight: number;
  readonly textStyle: StyleProp<TextStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const [run, setRun] = useState(() => ({
    from: null as string | null, heading: 0 as -1 | 0 | 1, progress: new Animated.Value(1), to: text,
  }));
  /**
   * **The effect may not depend on the state it sets, and this one did.**
   *
   * It listed `run.to` among its dependencies and then wrote `run.to` through `setRun`. So
   * React cleaned up **before re-running** — `fade.stop()` — one frame after the fade had
   * started, and on the re-run `run.to === text` returned early and never restarted it.
   * `progress` froze at about 0.02, which is where the *leaving* layer is at full opacity
   * and the arriving one at nothing: **the header displayed the previous month, always,
   * and never caught up.**
   *
   * That is the whole of «месяц переключается случайно». Decoded frame by frame off the
   * owner's recording, the grid was right every time and only the header lied — and it lied
   * by exactly one step, in whichever direction the last two swipes had gone. Four packages
   * were spent on the pager, which was not at fault, because the symptom was read as a
   * paging fault and never traced to the component that renders the word.
   *
   * The current word lives in a ref, so writing the run cannot re-enter the effect, and the
   * heading rides in a ref too — it changes in the same commit as the text and would
   * otherwise be a second way in.
   */
  const shown = useRef(text);
  const headingRef = useRef(heading);
  headingRef.current = heading;
  useEffect(() => {
    if (shown.current === text) return;
    const from = shown.current;
    shown.current = text;
    const progress = new Animated.Value(reduceMotion ? 1 : 0);
    setRun({ from, heading: headingRef.current, progress, to: text });
    if (reduceMotion) return;
    const fade = Animated.timing(progress, {
      duration: MONTH_TITLE_FADE_MS,
      // The page's own curve: quick to leave, settling rather than stopping, which is what
      // keeps the word and the grid under it reading as one movement.
      easing: Easing.bezier(0.22, 0.61, 0.36, 1),
      toValue: 1,
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [reduceMotion, text]);

  const travel = run.heading === 0 ? 0 : MONTH_TITLE_TRAVEL * run.heading;
  return <View style={[styles.box, { height: lineHeight, width: reservedWidth }]}>
    {run.from === null ? null : <Animated.Text
      numberOfLines={1}
      style={[textStyle, styles.layer, {
        opacity: run.progress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0, 0] }),
        transform: [{ translateX: run.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -travel] }) }],
      }]}
    >{run.from}</Animated.Text>}
    <Animated.Text
      key={run.to}
      numberOfLines={1}
      style={[textStyle, styles.layer, {
        opacity: run.progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, 1] }),
        transform: [{ translateX: run.progress.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }],
      }]}
    >{run.to}</Animated.Text>
  </View>;
}

const styles = StyleSheet.create({
  // Both layers are out of flow inside a reserved box, so a longer month can move neither
  // the control beside it nor the other layer. A caller must therefore give a width.
  box: { justifyContent: 'center' },
  layer: { left: 0, position: 'absolute', right: 0 },
});
