/**
 * Pure geometry for the bottom-layer rule.
 *
 * Kept free of React Native imports so the curve can be tested as behaviour
 * rather than asserted as source text.
 */

/** Enough bands that the fade reads as continuous over a low-contrast ground. */
export const BOTTOM_LAYER_BANDS = 16;

/**
 * The two stop sets the spec draws: a screen fades later and softer than a docked
 * call to action, which has less room and must resolve sooner.
 */
export const BOTTOM_LAYER_CURVES = Object.freeze({
  screen: Object.freeze({ midAlpha: 0.65, midStop: 0.4, endStop: 0.76 }),
  cta: Object.freeze({ midAlpha: 0.72, midStop: 0.34, endStop: 0.68 }),
});

export type BottomLayerCurve = keyof typeof BOTTOM_LAYER_CURVES;

/**
 * Transparent at the top, the curve's mid alpha at its mid stop, fully the ground
 * by its end stop — below which the scrim is the screen ground itself, which is
 * what makes the background reach the bottom edge.
 */
export function bottomLayerAlpha(position: number, curve: BottomLayerCurve = 'screen'): number {
  const { midAlpha, midStop, endStop } = BOTTOM_LAYER_CURVES[curve];
  if (position <= 0) return 0;
  if (position >= endStop) return 1;
  if (position <= midStop) return (position / midStop) * midAlpha;
  return midAlpha + ((position - midStop) / (endStop - midStop)) * (1 - midAlpha);
}

/**
 * `#RRGGBB` at a given alpha. A colour that cannot be decomposed degrades to
 * transparent rather than painting a wrong hue over the content.
 */
export function colorWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match === null) return alpha >= 1 ? color : 'transparent';
  const value = Number.parseInt(match[1] as string, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.round(alpha * 1000) / 1000})`;
}
