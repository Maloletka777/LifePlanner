import { StyleSheet, View } from 'react-native';

/**
 * Four strokes, cycled down the list, so a finished day does not read as printed
 * rules. Each is composed from thin bars at slight angles: a wave, a double pass,
 * a slant and a stroke with a hook. **Recorded deviation** — the design draws
 * these as bezier paths, and no vector library is a dependency of this project,
 * so they are built from the primitives that are.
 */
/** Four strokes, cycled down a list, so a page of done things is not printed rules. */
export const HAND_STRIKE_VARIANTS = 4;

export function handStrikeVariant(index: number): number {
  return ((index % HAND_STRIKE_VARIANTS) + HAND_STRIKE_VARIANTS) % HAND_STRIKE_VARIANTS;
}

export function HandStrike({ variant, color }: { readonly color: string; readonly variant: number }) {
  return (
    <View accessibilityElementsHidden pointerEvents="none" style={styles.strike}>
      {STRIKE_STROKES[variant % STRIKE_STROKES.length]!.map((bar, index) => (
        <View
          key={index}
          style={{
            backgroundColor: color,
            borderRadius: 1,
            height: bar.height,
            left: bar.left,
            opacity: bar.opacity,
            position: 'absolute',
            top: '50%',
            marginTop: bar.offset,
            transform: [{ rotate: bar.rotate }],
            width: bar.width,
          }}
        />
      ))}
    </View>
  );
}

interface StrikeBar {
  readonly left: `${number}%`;
  readonly width: `${number}%`;
  readonly offset: number;
  readonly rotate: string;
  readonly height: number;
  readonly opacity: number;
}

const STRIKE_STROKES: readonly (readonly StrikeBar[])[] = Object.freeze([
  // Wave — three passes at alternating angles.
  Object.freeze([
    { left: '0%', width: '38%', offset: -1.4, rotate: '-1.1deg', height: 1.7, opacity: 0.72 },
    { left: '33%', width: '38%', offset: 0.2, rotate: '1deg', height: 1.7, opacity: 0.72 },
    { left: '65%', width: '37%', offset: -1.2, rotate: '-0.9deg', height: 1.7, opacity: 0.72 },
  ] as const),
  // Double pass — gone over twice, the second lighter.
  Object.freeze([
    { left: '0%', width: '100%', offset: -1.6, rotate: '-0.5deg', height: 1.7, opacity: 0.72 },
    { left: '3%', width: '95%', offset: 0.9, rotate: '0.5deg', height: 1.1, opacity: 0.5 },
  ] as const),
  // Slant — one confident line across.
  Object.freeze([
    { left: '-1%', width: '102%', offset: -0.6, rotate: '-1.5deg', height: 1.7, opacity: 0.72 },
  ] as const),
  // Stroke with a hook at the end.
  Object.freeze([
    { left: '0%', width: '97%', offset: -1, rotate: '-0.7deg', height: 1.7, opacity: 0.72 },
    { left: '90%', width: '11%', offset: -2.6, rotate: '58deg', height: 1.4, opacity: 0.66 },
  ] as const),
]);

const styles = StyleSheet.create({
  strike: { bottom: 0, left: -4, position: 'absolute', right: -4, top: 0 },
});
