import { ensureContrast, mixColors } from './color-math';
import {
  buildThemeBaseColors,
  buildThemeSurfaceColors,
  CATEGORY_HUES,
  colorThemePalette,
  DEFAULT_COLOR_THEME_ID,
  IDENTITY_MARK_CONTRAST,
  type CategoryHueKey,
  type ColorThemeId,
  type ColorThemePalette,
  type ThemeBaseColors,
  type ThemeSurfaceColors,
} from './color-themes';

export const spacing = Object.freeze({
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
});

export const radii = Object.freeze({
  sm: 6,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  pill: 999,
});

export const typography = Object.freeze({
  largeTitle: Object.freeze({ fontSize: 34, lineHeight: 41, fontWeight: '700' as const }),
  title: Object.freeze({ fontSize: 28, lineHeight: 34, fontWeight: '700' as const }),
  sectionTitle: Object.freeze({ fontSize: 22, lineHeight: 28, fontWeight: '700' as const }),
  headline: Object.freeze({ fontSize: 17, lineHeight: 22, fontWeight: '600' as const }),
  body: Object.freeze({ fontSize: 17, lineHeight: 24, fontWeight: '400' as const }),
  callout: Object.freeze({ fontSize: 15, lineHeight: 21, fontWeight: '400' as const }),
  label: Object.freeze({ fontSize: 15, lineHeight: 21, fontWeight: '600' as const }),
  caption: Object.freeze({ fontSize: 13, lineHeight: 18, fontWeight: '500' as const }),
  metric: Object.freeze({ fontSize: 28, lineHeight: 32, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as ('tabular-nums')[] }),
  progress: Object.freeze({ fontSize: 20, lineHeight: 25, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as ('tabular-nums')[] }),
});

/**
 * **The plate language's six steps** (PD-PLATE-003). No half points, nothing under
 * 11, and every size already present in the scale above — what changed is the
 * distribution of weight, not the sizes.
 *
 * The weight rule is the substance: **regular by default, `600` in exactly three
 * places** — the month, an item title that is important or running, and the active
 * tab label — and **no 700 or 800 anywhere**. Measured before it was decided: the
 * journal carries 22 of its 29 weight declarations at 700/800 and every one of them
 * is on a service caption, while the item title runs 500/600. That inversion is the
 * single largest cause of the "heavy" reading, and no colour change reaches it.
 *
 * It is a separate group rather than an edit to `typography` because the screens are
 * rebuilt one package at a time: a screen still on the older scale keeps reading the
 * older names, and nothing repaints halfway.
 */
export const plateType = Object.freeze({
  /** The month. One per screen. */
  title: Object.freeze({ fontSize: 28, lineHeight: 32, fontWeight: '600' as const, letterSpacing: -0.6 }),
  /** Item titles, and the date in the week strip. */
  item: Object.freeze({ fontSize: 17, lineHeight: 22, fontWeight: '400' as const, letterSpacing: -0.2 }),
  /** The same step at the one weight an item title is allowed to take. */
  itemStrong: Object.freeze({ fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.2 }),
  /** Subtasks, "Today", the status-bar clock. */
  body: Object.freeze({ fontSize: 15, lineHeight: 20, fontWeight: '400' as const }),
  /** Second lines, the free-window line, the NOW line. */
  sub: Object.freeze({ fontSize: 13, lineHeight: 18, fontWeight: '400' as const }),
  /** An item's start, a slot label. */
  time: Object.freeze({ fontSize: 12, lineHeight: 16, fontWeight: '400' as const, fontVariant: ['tabular-nums'] as ('tabular-nums')[] }),
  /** ANYTIME, NOW, hour ticks, tab labels. */
  label: Object.freeze({ fontSize: 11, lineHeight: 14, fontWeight: '500' as const, letterSpacing: 0.6 }),
});

export const motion = Object.freeze({ fast: 120, compact: 180, progress: 200, standard: 220, deliberate: 320, glassMorph: 300, glassClose: 240, reducedGlassFade: 140, progressFollow: 240, progressFollowDelay: 80, disclosure: 220, checkDraw: 180, fillTransition: 140, pressIn: 60, pressOut: 120 });

/**
 * Today v2 glass geometry. Today-scoped on purpose: the surrounding Planner,
 * Create, Edit, Management and Detail surfaces keep the shared tokens above.
 */
export const todayGlass = Object.freeze({
  screenMargin: 20,
  sectionGap: 14,
  cardPadding: 18,
  cardGap: 14,
  rowPaddingVertical: 12,
  rowPaddingHorizontal: 13,
  dashboardRadius: 24,
  glassRadius: 30,
  rowRadius: 22,
  groupRadius: 18,
  controlRadius: 13,
  chipRadius: 11,
  attentionRadius: 16,
  identityMark: 30,
  childIdentityMark: 26,
  panelTopInset: 104,
  panelBottomCornerRadius: 44,
  pressInDuration: 60,
  pressOutDuration: 120,
  chevron: 16,
  headerDot: 6,
  headerDotGap: 9,
  collapsedRing: 88,
  collapsedRingStroke: 7,
  expandedRing: 66,
  expandedRingStroke: 6,
  expandedHeaderBand: 90,
  completionControl: 26,
  childCompletionControl: 22,
  priorityZone: 10,
  timeGutter: 52,
  largeTypeTimeGutter: 66,
  railOffset: 75,
  railColumn: 23,
  railDot: 9,
  nowDot: 14,
  nowRing: 3,
  contentInset: 12,
  statusColumn: 26,
  segmentHeight: 34,
  childIndent: 44,
  childConnector: 1.5,
  cardPressScale: 0.97,
  controlPressScale: 0.94,
  backgroundScale: 0.985,
  pastOpacity: 0.5,
  tightGapMinimum: 14,
  tightGapMaximum: 22,
  spacerGap: 24,
  compressedGap: 34,
  quietGapMinutes: 180,
  focusSoonMinutes: 120,
  focusRowLimit: 2,
  clusterThreshold: 4,
  clusterVisibleTitles: 3,
  bandLabelThreshold: 8,
  glassDim: 0.16,
  glassBlur: 44,
  glassSaturate: 1.5,
  compactHandoverProgress: 0.4,
  expandedRevealProgress: 0.35,
  expandedContentRise: 8,
  swipeDismissDistance: 120,
  stackedTypeScale: 1.25,
  largeTypeScale: 1.35,
});

export const layout = Object.freeze({
  screen: Object.freeze({ inlinePadding: spacing.md, contentGap: spacing.md }),
  header: Object.freeze({ minimumHeight: 52, wizardMinimumHeight: 60 }),
  control: Object.freeze({ minimumTouchTarget: 44, standardHeight: 48, rowHeight: 52 }),
});

export const iconSizes = Object.freeze({ inline: 16, row: 20, action: 24, empty: 28 });
export const elevation = Object.freeze({
  raised: Object.freeze({ shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: Object.freeze({ width: 0, height: 4 }), elevation: 2 }),
});

export const components = Object.freeze({
  card: Object.freeze({ gap: spacing.sm, padding: spacing.md, radius: radii.xl }),
  button: Object.freeze({
    horizontalPadding: spacing.md,
    verticalPadding: spacing.sm,
    radius: radii.md,
  }),
  input: Object.freeze({
    horizontalPadding: spacing.sm,
    verticalPadding: 10,
    radius: radii.md,
    multilineMinimumHeight: 96,
  }),
  status: Object.freeze({
    horizontalPadding: spacing.xs,
    verticalPadding: spacing.xxs,
    radius: radii.pill,
  }),
});

export const habitAccentTokenKeys = Object.freeze([
  'blue',
  'indigo',
  'violet',
  'purple',
  'pink',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'mint',
  'teal',
  'cyan',
  'brown',
  'grey',
  'coral',
  'rose',
  'peach',
  'sky',
  'lavender',
] as const);

export type HabitAccentTokenKey = (typeof habitAccentTokenKeys)[number];

export interface HabitAccentTokens {
  readonly iconBackground: string;
  readonly iconForeground: string;
  readonly surface: string;
  readonly progressSurface: string;
  readonly border: string;
  readonly selectedSwatch: string;
  readonly childSurface: string;
}

/**
 * **The 21 accent keys resolve to six category hues** (PD-PLATE-004).
 *
 * `accent_key` stays in the schema and **nothing migrates**: the six keys the
 * catalogue already maps carry the six categories, and every other stored key —
 * `cyan`, `grey`, `lavender` and the rest — resolves to `work` as the neutral
 * default. What goes is 42 hand-authored rows of seven values each, which existed to
 * give twenty-one hues their own readable set on five grounds; six hues on two
 * grounds are derived, and a derivation can be checked.
 *
 * A habit painted `teal` therefore still reads as Home and still reads as itself. It
 * changes value, because the whole palette did.
 */
const ACCENT_KEY_CATEGORY: Readonly<Record<HabitAccentTokenKey, CategoryHueKey>> = Object.freeze({
  amber: 'routine',
  brown: 'meal',
  green: 'body',
  teal: 'home',
  blue: 'work',
  purple: 'mind',
  // Neutral default. Named one by one rather than by a fallback, so adding a key to
  // `habitAccentTokenKeys` is a type error here rather than a silent grey.
  indigo: 'work',
  violet: 'mind',
  pink: 'mind',
  red: 'routine',
  orange: 'routine',
  yellow: 'meal',
  lime: 'body',
  mint: 'body',
  cyan: 'home',
  grey: 'work',
  coral: 'routine',
  rose: 'mind',
  peach: 'routine',
  sky: 'home',
  lavender: 'mind',
});

/**
 * How a category hue paints an identity mark. The 13 % icon fill is the design's own
 * and is **ground-dependent**, so it is mixed against the theme's plate rather than
 * hard-coded from the light values; the glyph is then raised against the fill it
 * actually sits on, never against the plate.
 */
function habitAccentFromHue(color: string, theme: ColorThemePalette): HabitAccentTokens {
  const iconBackground = mixColors(theme.surface, color, 0.13);
  return habitAccent(
    iconBackground,
    ensureContrast(color, iconBackground, IDENTITY_MARK_CONTRAST, theme.ink),
    mixColors(theme.surface, color, 0.06),
    mixColors(theme.surface, color, 0.2),
    mixColors(theme.surface, color, 0.35),
    color,
    mixColors(theme.surface, color, 0.04),
  );
}

function buildHabitAccents(theme: ColorThemePalette): Readonly<Record<HabitAccentTokenKey, HabitAccentTokens>> {
  const hues = CATEGORY_HUES[theme.id];
  return Object.freeze(Object.fromEntries(
    habitAccentTokenKeys.map((key) => [key, habitAccentFromHue(hues[ACCENT_KEY_CATEGORY[key]], theme)]),
  ) as Record<HabitAccentTokenKey, HabitAccentTokens>);
}

/**
 * The hash fallback behind an identity mark that carries no stored accent.
 *
 * One key per category, so a mark with nothing stored still lands inside the family
 * rather than beside it — with the accent keys resolved to six hues, seven keys drawn
 * from the old twenty-one would have repeated two of them.
 */
const IDENTITY_FALLBACK_KEYS = Object.freeze(['amber', 'brown', 'green', 'teal', 'blue', 'purple'] as const);

export type LifePlannerColors = ThemeBaseColors;
export type LifePlannerTodayColors = ThemeSurfaceColors;

export interface LifePlannerTheme {
  readonly themeId: ColorThemeId;
  readonly palette: ColorThemePalette;
  readonly dark: boolean;
  readonly colors: LifePlannerColors;
  readonly today: LifePlannerTodayColors;
  readonly todayGlass: typeof todayGlass;
  readonly spacing: typeof spacing;
  readonly radii: typeof radii;
  readonly typography: typeof typography;
  readonly plateType: typeof plateType;
  readonly motion: typeof motion;
  readonly layout: typeof layout;
  readonly components: typeof components;
  readonly iconSizes: typeof iconSizes;
  readonly elevation: typeof elevation;
  readonly habitAccents: Readonly<Record<HabitAccentTokenKey, HabitAccentTokens>>;
  /** Ordered background/foreground pairs for a mark with no stored accent. */
  readonly identityFallbacks: readonly (readonly [string, string])[];
}

const themeCache = new Map<ColorThemeId, LifePlannerTheme>();

export function getLifePlannerTheme(themeId: ColorThemeId = DEFAULT_COLOR_THEME_ID): LifePlannerTheme {
  const cached = themeCache.get(themeId);
  if (cached !== undefined) return cached;

  const palette = colorThemePalette(themeId);
  const today = buildThemeSurfaceColors(palette);
  const habitAccents = buildHabitAccents(palette);
  const theme = Object.freeze({
    themeId,
    palette,
    dark: palette.dark,
    colors: buildThemeBaseColors(palette, today),
    today,
    todayGlass,
    spacing,
    radii,
    typography,
    plateType,
    motion,
    layout,
    components,
    iconSizes,
    elevation,
    habitAccents,
    identityFallbacks: Object.freeze(
      IDENTITY_FALLBACK_KEYS.map((key) => Object.freeze([habitAccents[key].iconBackground, habitAccents[key].iconForeground] as const)),
    ),
  });
  themeCache.set(themeId, theme);
  return theme;
}

function habitAccent(
  iconBackground: string,
  iconForeground: string,
  surface: string,
  progressSurface: string,
  border: string,
  selectedSwatch: string,
  childSurface: string,
): HabitAccentTokens {
  return Object.freeze({ iconBackground, iconForeground, surface, progressSurface, border, selectedSwatch, childSurface });
}

/**
 * The Anytime switch, stated once so its two copies cannot drift apart again.
 *
 * **They already had**: the knob's travel is `track − padding·2 − knob`, which is
 * `50 − 4 − 26 = 20`, and one of the two sheets carried 22 — so in that sheet the knob
 * overhung its own track by two points whenever the switch was on. Derived rather than
 * written down, the number cannot be wrong while the three it comes from are right.
 */
const SWITCH_TRACK = 50;
const SWITCH_PADDING = 2;
const SWITCH_KNOB = 26;
export const SWITCH_TRAVEL = SWITCH_TRACK - SWITCH_PADDING * 2 - SWITCH_KNOB;
