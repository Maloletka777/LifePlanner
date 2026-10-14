import { withAlpha, ensureContrast, mixColors } from './color-math';

/**
 * The appearance map — **two themes, and the phone chooses** (PD-APPEARANCE-007).
 *
 * `design_handoff_plate_language` ships one visual language in two themes, and the
 * owner chose the system switch: Light and Dark as Apple supplies them. The five
 * palettes existed **because** the application never read `Appearance` — remove the
 * cause and the need goes with it, and so do `themeId`, its preference store and the
 * picker screen.
 *
 * The values are **authored per theme rather than derived from nine**, which is the
 * one thing that changed about the method. Five derived palettes could not be checked
 * — two of the recorded limits (`alone`'s attention under 2:1 on its own ground,
 * `papaya`'s 3.4:1 white-on-accent) were properties of palettes nobody could correct
 * without breaking the derivation. Two authored themes can be, and every value below
 * carries the OKLCH it was generated from: **change the OKLCH and regenerate, never
 * nudge the hex.**
 *
 * The one rule, from `palette.md`: **chroma carries state, hue carries category.**
 * The six categories sit at one lightness and one low chroma; the two states take
 * roughly twice that chroma and are therefore louder than any category whatever hue
 * it happens to be. Structure is drawn only on the header material and categories
 * only on plates, so the eye is never asked what blue means.
 */
export const COLOR_THEME_IDS = Object.freeze(['light', 'dark'] as const);

export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

/**
 * What a phone that reports no preference gets. It is not a stored default and
 * nothing writes it: `useColorScheme()` returns `null` before the first read on some
 * devices, and a screen has to paint in that frame.
 */
export const DEFAULT_COLOR_THEME_ID: ColorThemeId = 'light';

export interface ColorThemePalette {
  readonly id: ColorThemeId;
  readonly name: string;
  readonly group: 'light' | 'dark';
  /** True when `ink` is lighter than `bg`. Drives blur tint and the status bar only. */
  readonly dark: boolean;

  // The nine the older derivation was built on. They are kept — every screen still
  // reads the semantic sets these feed — but they are now **mapped** from the plate
  // tokens below rather than being the source.
  readonly bg: string;
  readonly surface: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly accentTintColor: string;
  readonly accentTintAlpha: number;
  readonly lineColor: string;
  readonly lineAlpha: number;
  readonly attention: string;

  // The plate language's own roles, which the nine cannot express.
  /** L1, the running item: `struct` 10 % over `plate`. */
  readonly heroPlate: string;
  /** L1 with blur. Header and tab bar only — exactly two per screen. */
  readonly material: string;
  /**
   * **The blur is what separates a glass surface, and the alpha is what lets colour
   * through.** Confusing the two is what produced a floating panel twice over.
   *
   * 40 was a modest defocus under a heavy wash, so neither half did its job: too little
   * blur to read as a lens, too much fill to read as glass. At 90 the content under the bar
   * is plainly out of focus while the content beside it is sharp, and *that* difference is
   * the boundary — the same way iOS draws one. It costs a real-time blur on two surfaces
   * per screen, which is exactly the two the design language allows.
   */
  readonly materialBlur: number;
  /** Never carries information on its own: resting rings, weekday letters, hour ticks. */
  readonly ink3: string;
  /** Rail, selected date, now ticks, FAB, selection ring. */
  readonly struct: string;
  /** The readable form of `struct`: "Today", the active tab, an active slot label. */
  readonly structInk: string;
  /** The rail's groove. */
  readonly track: string;
  /** The dashed drop-slot outline. The only dashed border in the system. */
  readonly slot: string;
  /** Completed, and nothing else in the application. */
  readonly done: string;
  /** Overdue: the time, the second line, the checkbox ring, the critical-rank dot. */
  readonly over: string;
  /*
   * `behind` is **deleted, not left dormant.** It was the plate of something the clock had
   * passed, and the quiet plate it was made for never shipped: the owner chose block items
   * being properly overdue instead, so nothing ever painted it.
   */
  /**
   * **High rank is amber; critical keeps `over`** (owner instruction, 2026-08-06: «high —
   * должен быть жёлтым, а critical — сохранить свой цвет»).
   *
   * It used to be `over` washed 75 % over the plate, which made the two ranks one hue at
   * two strengths — and told the eye that high is *a weaker overdue* rather than a
   * different thing. Amber says a different thing.
   *
   * **A true yellow was not available and that is arithmetic, not taste.** A graphical
   * object needs 3:1, and on a white plate nothing at `L 0.70` reaches it at any chroma;
   * the ceiling is `L 0.66` at 3.14:1. The exact amber PD-PLATE-004 retired — `#D9A21B` —
   * measures **2.30:1**, which is why it could never have survived. So Light takes
   * `L 0.62` and reads as dark gold, while Dark, which has room, takes a proper yellow.
   *
   * **Hue 85 is chosen against `over`, not against `meal`.** The two ranks are drawn in
   * one place in one shape, so confusing them is the failure that matters: 85 is **58°**
   * from `over`, against the 15° of the bronze and the 33° of the apricot that
   * PD-APPEARANCE-009 refused for structure — so that refusal is cleared rather than
   * overridden. It does land on the `meal` category's hue, and the palette already runs
   * that case tighter: `done` is 150 and the `body` category is 155, five degrees apart,
   * held apart because **chroma separates a state from a category**. Here the margin is
   * wider — 0.121 against `meal`'s 0.079, ×1.53, where `done`/`body` live on ×1.24 — and
   * a 3 pt edge and a 32 pt mark share neither place nor shape.
   */
  readonly rankHigh: string;
}

function palette(value: ColorThemePalette): ColorThemePalette {
  return Object.freeze(value);
}

export const COLOR_THEME_PALETTES: Readonly<Record<ColorThemeId, ColorThemePalette>> = Object.freeze({
  light: palette({
    id: 'light', name: 'Light', group: 'light', dark: false,
    // **Graphite: structure has no hue at all** (owner decision, 2026-08-05). The FAB, the
    // NOW track and the active tab's label are ink, so the only colour anywhere on the
    // screen is a category mark, `done` and `over`. This retires the green structural
    // accent, which had been the third green on a screen already carrying `done` and a
    // green-tinted ground — one colour in three roles, and the whole of «swamp».
    //
    // Every value is generated from the OKLCH beside it and clamped into sRGB. **Change
    // the OKLCH and regenerate; never nudge the hex.**
    bg: '#EBEDEF',            // oklch(0.945 0.004 250)
    surface: '#FFFFFF',
    ink: '#13161A',           // oklch(0.200 0.008 250) — 18.14:1 on plate
    inkMuted: '#646A70',      // oklch(0.520 0.012 250) — 5.47 plate / 4.66 ground
    accent: '#1E2226',        // = struct
    onAccent: '#FFFFFF',      // 16.01 on struct, 5.18 on done, 6.32 on over
    accentTintColor: '#1E2226', accentTintAlpha: 0.12,
    lineColor: '#13161A', lineAlpha: 0.10,
    attention: '#AA3832',     // = over
    heroPlate: '#F2F2F2',     // plate 5.5 % towards ink
    // **Half of what is behind reaches the eye**, which is the whole of the complaint that
    // this was «просто плавающая плашка». It has been two wrong things in a row: first a
    // 72 % wash **towards** the plates' own colour, which composited to `#FFFFFF` exactly
    // and made the bar the row beneath it; then a 88 % wash *away* from them, which parted
    // the two by turning the glass into paint. Separation is the **blur's** job, not the
    // alpha's — see `materialBlur`. The tint only says which way the glass leans.
    material: 'rgba(216,220,225,0.50)',
    materialBlur: 90,
    // Kept under 4.5 by design — it never carries information on its own — and over 3:1
    // on every ground it is actually drawn on, which the weekday letters need.
    ink3: '#82878C',          // oklch(0.620 0.010 250) — 3.62 plate / 3.09 ground
    struct: '#1E2226',        // oklch(0.250 0.010 250) — 16.01 plate / 13.64 ground
    structInk: '#1E2226',
    track: '#DEE0E2',         // ground 6 % towards ink
    slot: '#909396',          // ground 42 % towards ink — the dashed drop outline
    done: '#1D7D3E',          // oklch(0.520 0.130 150) — 5.18 plate / 4.41 ground
    over: '#AA3832',          // oklch(0.505 0.150 27) — 6.32 plate / 5.39 ground
    rankHigh: '#A77F17',      // oklch(0.620 0.121 85) — 3.69 plate / 3.14 ground
  }),
  dark: palette({
    id: 'dark', name: 'Dark', group: 'dark', dark: true,
    // **The ground is true black** (owner decision, 2026-08-05, against the Tiimo
    // reference). It was `#121715` — a green-tinted near-black, and chroma is more visible
    // the darker the surface, so 0.009 of it at L 0.198 tinted every pixel of the screen
    // while the same amount at L 0.94 in Light was invisible. That asymmetry is exactly
    // why «light is still OK and dark is awful» was the accurate report. On `#000000`
    // there is nothing left to tint, and every coloured thing is deliberate.
    bg: '#000000',
    surface: '#1C1E21',       // oklch(0.235 0.006 250) — 1.257:1 over black
    ink: '#F0F2F4',           // oklch(0.960 0.003 250) — 14.89:1 on plate
    inkMuted: '#A4A8AD',      // oklch(0.730 0.008 250) — 6.99 plate / 8.78 ground
    accent: '#F0F2F4',        // = struct = ink: graphite has no structural hue
    // **`onAccent` is the ground, not an assumed white.** Dark's `struct`, `done` and
    // `over` are *light* colours, so white on them is around 2.5:1 — below the 3:1 a mark
    // needs, on the FAB's glyph and a completed checkbox's tick.
    onAccent: '#000000',      // 18.71 on struct, 11.49 on done, 7.95 on over
    accentTintColor: '#F0F2F4', accentTintAlpha: 0.16,
    lineColor: '#F0F2F4', lineAlpha: 0.12,
    attention: '#F27D72',
    heroPlate: '#292B2E',     // plate 6 % towards ink — 1.177:1, and `ink3` still reads on it
    // The same alpha for the same reason. A tint on black transmits differently from a
    // tint on white, and the *blur* is what carries the difference.
    material: 'rgba(56,60,64,0.50)',
    materialBlur: 90,
    ink3: '#717579',          // oklch(0.560 0.008 250) — 3.60 plate / 4.52 ground / 3.06 hero
    struct: '#F0F2F4',        // 14.89 plate / 18.71 ground
    structInk: '#F0F2F4',
    track: '#181818',         // ground 10 % towards ink
    slot: '#606162',          // ground 40 % towards ink
    done: '#6BD586',          // oklch(0.790 0.150 150) — 9.14 plate / 11.49 ground
    over: '#F27D72',          // oklch(0.720 0.145 27) — 6.33 plate / 7.95 ground
    rankHigh: '#EBB425',      // oklch(0.800 0.156 85) — 8.82 plate / 11.09 ground
  }),
});

/**
 * Six categories, six hues — **one lightness and one share of each hue's own maximum**.
 *
 * The share is the correction. Both themes used to state a single absolute chroma, and
 * an absolute chroma is a *different* colour entirely depending on the hue, because the
 * sRGB solid is not round. At `oklch(0.60 0.09 H)` the six stood at 48 %, 73 %, 61 %,
 * 88 %, 41 % and 30 % of what their hue could actually reach — so `home` looked saturated
 * and `mind` looked washed out, and the family did not read as one. At a constant **62 %
 * of maximum** they do, and the six are visibly six.
 *
 * Both rows are generated at that share and clamped into sRGB. **Change the share or the
 * lightness and regenerate; never nudge a hex.** The comment beside each value is the
 * OKLCH it came from, and the ratio is the glyph against a *solid* mark — the mark is
 * filled with the hue now and the glyph is knocked out in the plate colour, which is what
 * the 13 % wash could never do: six washes at one lightness differ from each other by
 * 1.004–1.011:1, so the wash was never going to tell two plates apart.
 *
 * They live here rather than in the planner's catalogue because they are palette data
 * that two layers read — the catalogue for an item's own mark, and the identity
 * derivation below for every stored accent key.
 */
export const CATEGORY_HUE_KEYS = Object.freeze(['routine', 'meal', 'body', 'home', 'work', 'mind'] as const);

export type CategoryHueKey = (typeof CATEGORY_HUE_KEYS)[number];

export const CATEGORY_HUES: Readonly<Record<ColorThemeId, Readonly<Record<CategoryHueKey, string>>>> = Object.freeze({
  light: Object.freeze({   // L 0.585, 66 % of each hue's max chroma, capped at 0.135
    routine: '#B76041',    // glyph 3.99:1 on the solid mark
    meal: '#917842',       // 4.24
    body: '#488D62',       // 4.03
    home: '#48878E',       // 4.06
    work: '#4A7ACB',       // 4.25
    mind: '#9462B7',       // 4.48
  }),
  // **Raised a step for the black ground.** The dark plate is `#1C1E21` now rather than
  // `#242A27`, so a mark at the old lightness sat closer to it; L 0.760 keeps the six
  // reading as objects on a near-black page rather than as stains on it.
  dark: Object.freeze({    // L 0.760, the same 66 %, capped at 0.130
    routine: '#E79C82',    // glyph 7.44:1 on the solid mark
    meal: '#CFAC61',       // 8.17
    body: '#6AC88E',       // 7.94
    home: '#69C1CB',       // 7.85
    work: '#93B2E5',       // 7.53
    mind: '#C69DE5',       // 7.44
  }),
});

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === 'string' && (COLOR_THEME_IDS as readonly string[]).includes(value);
}

export function colorThemePalette(themeId: ColorThemeId): ColorThemePalette {
  return COLOR_THEME_PALETTES[themeId];
}

/** What the system's own scheme resolves to. `null` is what a phone reports before it knows. */
export function colorThemeIdForScheme(scheme: 'light' | 'dark' | null | undefined): ColorThemeId {
  return scheme === 'dark' ? 'dark' : 'light';
}

/**
 * The primary semantic set — the one Today, Planner, Management, Create and Edit
 * consume. Its **names are unchanged**, so no screen had to be edited to repaint:
 * what changed is that most of them are now a plate token rather than a derivation,
 * and the three that carried a third state colour resolve to the two that are left.
 */
export interface ThemeSurfaceColors {
  readonly appSurface: string;
  readonly elevatedSurface: string;
  readonly dashboardSurface: string;
  readonly glassFill: string;
  readonly glassOpaqueSurface: string;
  readonly glassEdge: string;
  readonly glassScrim: string;
  readonly pressedSurface: string;
  readonly hairline: string;
  readonly separator: string;
  readonly rail: string;
  readonly rowTint: string;
  readonly primaryText: string;
  readonly secondaryText: string;
  readonly tertiaryText: string;
  /** Three tonal steps from the ground towards ink; used for wells, dots and rules. */
  readonly tone100: string;
  readonly tone200: string;
  readonly tone300: string;
  readonly completion: string;
  readonly completionPressed: string;
  readonly completionTint: string;
  readonly completedRowTint: string;
  /** Anything drawn **on** `completion` or on `structFill`. Never white by assumption. */
  readonly onAccent: string;
  readonly scheduleAccent: string;
  readonly scheduleTint: string;
  readonly scheduleText: string;
  readonly scheduleEdge: string;
  readonly attention: string;
  readonly attentionTint: string;
  readonly attentionEdge: string;
  readonly attentionText: string;
  readonly nowMarker: string;
  readonly onNowMarker: string;
  readonly nowRule: string;
  readonly headerWash: string;
  /** The interactive label colour — `Manage`, `Today`, the active tab. */
  readonly system: string;
  readonly systemTint: string;
  /*
   * `beadSheen` is **deleted with the single arc it described.** The rim is two edges now
   * — `glassRim` above and `glassShade` under it — and one token that only ever meant the
   * bright half would be a value nothing paints.
   */
  readonly creative: string;
  readonly pending: string;
  readonly error: string;
  readonly segmentTrack: string;
  readonly capsuleFill: string;
  readonly tileWash: string;
  readonly sheetBackdrop: string;
  readonly panelFill: string;
  readonly priorityLow: string;
  readonly priorityNormal: string;
  readonly priorityHigh: string;
  readonly priorityCritical: string;

  // The plate language's own roles. New names, because nothing in the older set
  // meant these: a plate is not a card, and structure is not an accent.
  /** L1, the running item's plate. */
  readonly heroSurface: string;
  /** The blurred material — header and tab bar only, exactly two per screen. */
  readonly materialFill: string;
  readonly materialBlur: number;
  /** The rail's fill, the selected date, the now ticks, the FAB. */
  readonly structFill: string;
  /** The dashed drop-slot outline. The only dashed border in the system. */
  readonly slotOutline: string;
  /** The quieter rank spine. Critical takes `attention` itself. */
  readonly rankHigh: string;
  /**
   * **The glass a travelling selection is made of** — the date bead and the tab bar's
   * plate, and nothing else.
   *
   * `ink` at a low alpha, which is near-black over a light page and near-white over a
   * black one: the only single expression that *lifts* a shape on black and *sinks* one on
   * white. Composited it is `#E0E0E0` in Light (1.32:1 against the plate beside it, ink on
   * it 13.75:1) and `#3C3E40` in Dark (1.56:1, ink 9.57:1). Dark carries more alpha
   * because a tint on black has less to work with than a tint on white.
   *
   * **It replaces an opaque structural fill, and the digit it used to be read against no
   * longer inverts** (owner decision, 2026-08-05). A translucent bead on an already-blurred
   * header refracts nothing — true, and no longer the point: what makes this shape visible
   * is the tint, a hairline and a top arc, not a refraction.
   */
  readonly structGlass: string;
  /*
   * `glassRim` and `glassShade` are **deleted, and the owner was right about why.**
   *
   * The prototype's rim is a *feathered inner glow* — `inset 0 1px 0` together with
   * `inset 0 6px 14px -8px`, a highlight that falls off over six points. React Native has
   * no inset shadow, so it shipped as a hard one-point border, and a hard white border at
   * half opacity is not a rim: it is a stripe. «Белая тупая полоска», reported
   * from the device, and accurate.
   *
   * A faithful rim needs a gradient — `expo-linear-gradient`, which is a dependency and
   * therefore the owner's word. Until then the glass is tint, blur and shape, and the tint
   * is raised to carry what the rim was carrying.
   */
}

/**
 * Map the semantic set from the two themes.
 *
 * Where the plate language names a colour, it is used exactly. Where it does not, the
 * value is derived from the ground the way it always was — never invented. Three
 * roles are worth reading twice:
 *
 * - **`completion` is `done`, not the accent.** Green means completed and nothing
 *   else in the application (PD-PLATE-004). It used to be each palette's accent,
 *   which is why a progress bar, a check and a selected segment were all one colour.
 * - **the `schedule*` family resolves to the `over` family.** It carried a third
 *   state colour — the alarm hue washed towards the ground — and there are now
 *   exactly two states. Resolving rather than deleting is deliberate: it removes the
 *   third colour from the screen without editing a single consumer, and the tokens go
 *   when their last caller does.
 * - **`system` is `structInk`,** which is what the design already calls the readable
 *   form of structure: "Today", the active tab, an active slot label.
 */
export function buildThemeSurfaceColors(theme: ColorThemePalette): ThemeSurfaceColors {
  const { bg, surface, ink, inkMuted, ink3, struct, structInk, done, over, dark } = theme;
  const line = (alpha: number) => withAlpha(theme.lineColor, alpha);
  const tint = (alpha: number) => withAlpha(theme.accentTintColor, alpha);

  return Object.freeze({
    appSurface: bg,
    elevatedSurface: surface,
    dashboardSurface: surface,
    glassFill: theme.material,
    glassOpaqueSurface: surface,
    glassEdge: line(theme.lineAlpha),
    glassScrim: withAlpha(surface, 0.96),
    pressedSurface: mixColors(surface, ink, 0.07),
    hairline: line(theme.lineAlpha),
    separator: line(theme.lineAlpha * 0.7),
    rail: theme.track,
    rowTint: mixColors(surface, bg, 0.34),
    primaryText: ink,
    secondaryText: inkMuted,
    tertiaryText: ink3,
    tone100: mixColors(bg, surface, 0.6),
    tone200: mixColors(bg, ink, 0.10),
    tone300: mixColors(bg, ink, 0.34),
    completion: done,
    completionPressed: mixColors(done, ink, 0.20),
    completionTint: withAlpha(done, dark ? 0.20 : 0.12),
    completedRowTint: withAlpha(done, dark ? 0.12 : 0.07),
    onAccent: theme.onAccent,
    scheduleAccent: over,
    scheduleTint: withAlpha(over, dark ? 0.20 : 0.09),
    scheduleText: ensureContrast(over, bg, TEXT_CONTRAST, ink),
    scheduleEdge: withAlpha(over, dark ? 0.40 : 0.28),
    attention: over,
    attentionTint: withAlpha(over, dark ? 0.16 : 0.09),
    attentionEdge: withAlpha(over, dark ? 0.30 : 0.22),
    attentionText: ensureContrast(over, bg, TEXT_CONTRAST, ink),
    // `now` is structural and low chroma; `late` is the alarm. They shared a hue
    // once and merged, and the plate language keeps them apart by construction —
    // structure is `struct`, lateness is `over`, and the two are not neighbours.
    nowMarker: struct,
    onNowMarker: theme.onAccent,
    nowRule: withAlpha(struct, 0.5),
    headerWash: mixColors(surface, bg, 0.35),
    system: structInk,
    systemTint: tint(theme.accentTintAlpha * 0.8),
    // Lower in Dark because the bead there is a *light* colour: the same alpha that
    // reads as a rim on `#2F4F45` is a smear on `#8FB3A6`.
    // Nothing paints it; kept so the type stays whole.
    creative: mixColors(struct, over, 0.5),
    pending: ink3,
    error: over,
    segmentTrack: tint(theme.accentTintAlpha * 0.7),
    capsuleFill: theme.material,
    tileWash: withAlpha(dark ? ink : surface, dark ? 0.12 : 0.72),
    sheetBackdrop: withAlpha(dark ? '#000000' : ink, dark ? 0.5 : 0.28),
    panelFill: withAlpha(surface, dark ? 0.94 : 0.92),
    // **The chooser says exactly what the plate draws, and no more** (PD-PLATE-017).
    // Low and normal draw *no* spine and are deliberately indistinguishable there, so
    // they are the two quiet inks here and nothing louder; high and critical are the
    // two colours the plate actually paints.
    //
    // **`priorityHigh` is derived from `rankHigh` rather than stated**, which is what
    // stops the chooser and the plate drifting apart — they did, and that was the
    // defect: high was `structInk`, *exactly* the colour of body text, so a raised
    // thumb was the same colour as the word beside it. These two are the **readable**
    // forms, because a label needs 4.5:1 where a spine needs 3:1; the spine itself
    // takes `rankHigh` and `over` untouched.
    priorityLow: ink3,
    priorityNormal: inkMuted,
    priorityHigh: ensureContrast(theme.rankHigh, bg, TEXT_CONTRAST, ink),
    priorityCritical: ensureContrast(over, bg, TEXT_CONTRAST, ink),
    heroSurface: theme.heroPlate,
    materialFill: theme.material,
    materialBlur: theme.materialBlur,
    structFill: struct,
    structGlass: withAlpha(ink, dark ? GLASS_TINT_DARK : GLASS_TINT_LIGHT),
    slotOutline: theme.slot,
    rankHigh: theme.rankHigh,
  });
}

/**
 * How much ink the glass carries.
 *
 * **Re-derived, and the owner's 11 % is the reason rather than the value.** That number was
 * read against a material which has since moved by a third of a stop, and against a rim
 * which has been withdrawn — so 11 % on today's surfaces buys 1.204:1 in Light, which is
 * the «grey transparent blob» exactly. With the rim gone the tint is the *only* thing left
 * carrying the shape, so it is raised until the bead separates as strongly as it did in the
 * prototype **with** its rim: 0.18, measured at **1.440:1** in Light and **1.679:1** in
 * Dark against the header it lies on, with ink on the bead at 9.52 and 6.27.
 *
 * One value for both themes now. The old asymmetry existed because a tint on black has
 * less to work with than a tint on white; the material carries that difference itself now.
 */
const GLASS_TINT_DARK = 0.18;
const GLASS_TINT_LIGHT = 0.18;

/** 4.5:1 for a label, 3:1 for a mark or a dot that carries no text. */
const TEXT_CONTRAST = 4.5;
const MARK_CONTRAST = 3;

/**
 * The older shared set, still consumed by the observation modal, Restore and the
 * shared form controls. It follows the same two themes, so those screens are not the
 * one place an older ground survives.
 */
export interface ThemeBaseColors {
  readonly background: string;
  readonly groupedBackground: string;
  readonly surface: string;
  readonly elevatedSurface: string;
  readonly inputSurface: string;
  readonly text: string;
  readonly secondaryText: string;
  readonly tertiaryText: string;
  readonly border: string;
  readonly strongBorder: string;
  readonly materialSurface: string;
  readonly accent: string;
  readonly accentPressed: string;
  readonly accentSubtle: string;
  readonly plannerAccent: string;
  readonly taskAccent: string;
  readonly financeAccent: string;
  readonly analyticsAccent: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly info: string;
  readonly disabled: string;
  readonly focus: string;
  readonly onAccent: string;
  readonly overlay: string;
  readonly shadow: string;
  readonly progressTrack: string;
  readonly progressFill: string;
}

export function buildThemeBaseColors(theme: ColorThemePalette, surfaces: ThemeSurfaceColors): ThemeBaseColors {
  const { bg, surface, ink, inkMuted, struct, done, dark } = theme;
  return Object.freeze({
    background: bg,
    groupedBackground: mixColors(bg, ink, 0.05),
    surface,
    elevatedSurface: surface,
    inputSurface: mixColors(surface, ink, 0.05),
    text: ink,
    secondaryText: inkMuted,
    tertiaryText: surfaces.tertiaryText,
    border: mixColors(surface, ink, theme.lineAlpha * 1.6),
    strongBorder: mixColors(surface, ink, 0.34),
    materialSurface: withAlpha(surface, 0.94),
    accent: struct,
    accentPressed: mixColors(struct, ink, 0.20),
    accentSubtle: mixColors(bg, struct, theme.accentTintAlpha),
    // A theme has one structural colour. The per-module accents stay in the type
    // because the layout already reserves Tasks and Finance, but they resolve to it
    // rather than to four invented hues.
    plannerAccent: struct,
    taskAccent: struct,
    financeAccent: struct,
    analyticsAccent: struct,
    // Completion is `done`, and it is the one place in this set that is not
    // structure: green means completed everywhere or it means nothing.
    success: done,
    warning: surfaces.attentionText,
    danger: surfaces.attentionText,
    info: surfaces.system,
    disabled: surfaces.tertiaryText,
    focus: surfaces.system,
    onAccent: theme.onAccent,
    overlay: withAlpha(dark ? '#000000' : ink, dark ? 0.62 : 0.42),
    shadow: dark ? '#000000' : ink,
    progressTrack: surfaces.segmentTrack,
    progressFill: done,
  });
}

/** Exported so the identity derivation raises a glyph against the same threshold. */
export const IDENTITY_MARK_CONTRAST = MARK_CONTRAST;
