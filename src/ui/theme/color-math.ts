/**
 * Colour arithmetic for the theme map.
 *
 * The appearance package ships five palettes of nine values each. Every other
 * token in the application is derived from those nine rather than authored per
 * theme, so the arithmetic lives here — React-free, so it is asserted as
 * behaviour rather than as source text.
 *
 * Two rules hold across all five palettes and are what make one derivation work
 * for both light and dark grounds:
 *
 * - mixing a colour **towards `ink`** always moves it away from the ground,
 *   because `ink` is by definition the colour that reads on `bg`;
 * - mixing **towards `bg`** always moves it into the ground.
 *
 * So `mix(x, ink, t)` raises contrast and `mix(x, bg, t)` lowers it, in a sand
 * theme and in a midnight one alike, without any `if (dark)` in the caller.
 */

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

export function parseHexColor(value: string): Rgb {
  const match = HEX_PATTERN.exec(value.trim());
  if (match === null) throw new Error(`A six-digit hex colour was expected, received "${value}".`);
  const channels = Number.parseInt(match[1], 16);
  return Object.freeze({ red: (channels >> 16) & 255, green: (channels >> 8) & 255, blue: channels & 255 });
}

export function toHexColor({ red, green, blue }: Rgb): string {
  return `#${[red, green, blue].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** `amount` 0 keeps `from`, 1 returns `towards`. */
export function mixColors(from: string, towards: string, amount: number): string {
  const start = parseHexColor(from);
  const end = parseHexColor(towards);
  const ratio = clampUnit(amount);
  return toHexColor({
    red: Math.round(start.red + (end.red - start.red) * ratio),
    green: Math.round(start.green + (end.green - start.green) * ratio),
    blue: Math.round(start.blue + (end.blue - start.blue) * ratio),
  });
}

export function withAlpha(color: string, alpha: number): string {
  const { red, green, blue } = parseHexColor(color);
  return `rgba(${red}, ${green}, ${blue}, ${Math.round(clampUnit(alpha) * 1000) / 1000})`;
}

/** WCAG relative luminance. */
export function relativeLuminance(color: string): number {
  const { red, green, blue } = parseHexColor(color);
  const [r, g, b] = [red, green, blue].map((channel) => {
    const sequential = channel / 255;
    return sequential <= 0.03928 ? sequential / 12.92 : ((sequential + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Raise a colour until it reads on its own ground.
 *
 * The palettes carry the reference colours as drawn, and some of them are chosen
 * for a swatch rather than for 12 pt text: `alone`'s attention `#861211` on its
 * `#0E2931` ground is under 2:1. Rather than hand-correct five palettes — which
 * would put design values in the code and lose the reference — the readable form
 * is derived, by walking towards `ink` until the ratio is met. A colour that
 * already passes is returned unchanged, so every light palette keeps its drawn
 * value exactly.
 */
export function ensureContrast(color: string, ground: string, minimumRatio: number, towards: string): string {
  if (contrastRatio(color, ground) >= minimumRatio) return color;
  for (let step = 1; step <= CONTRAST_STEPS; step += 1) {
    const candidate = mixColors(color, towards, step / CONTRAST_STEPS);
    if (contrastRatio(candidate, ground) >= minimumRatio) return candidate;
  }
  return towards;
}

const CONTRAST_STEPS = 20;

function clampChannel(channel: number): number {
  return Math.min(255, Math.max(0, Math.round(channel)));
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
