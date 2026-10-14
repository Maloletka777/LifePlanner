import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CATEGORY_HUES,
  CATEGORY_HUE_KEYS,
  COLOR_THEME_IDS,
  COLOR_THEME_PALETTES,
  DEFAULT_COLOR_THEME_ID,
  buildThemeSurfaceColors,
  colorThemeIdForScheme,
  isColorThemeId,
} from '../../src/ui/theme/color-themes';
import { contrastRatio, ensureContrast, mixColors, parseHexColor, toHexColor, withAlpha } from '../../src/ui/theme/color-math';
import { getLifePlannerTheme, habitAccentTokenKeys } from '../../src/ui/theme/tokens';
import { DEFAULT_APPEARANCE_THEME_ID, resolveAppearance } from '../../src/ui/theme/appearance';

const source = (path: string) => readFileSync(path, 'utf8');

/** WCAG 2.1 relative luminance, stated here so a lightness claim is measured not asserted. */
function relativeLuminanceOf(hex: string): number {
  const { red, green, blue } = parseHexColor(hex);
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue) + 0.02;
}
const provider = source('src/ui/theme/appearance-provider.tsx');
const more = source('app/(tabs)/more.tsx');

// ── The map ─────────────────────────────────────────────────────────────────

test('the map is two themes and nothing else', () => {
  assert.deepEqual([...COLOR_THEME_IDS], ['light', 'dark']);
  assert.equal(DEFAULT_COLOR_THEME_ID, 'light');
  assert.equal(DEFAULT_APPEARANCE_THEME_ID, 'light');
  // The five palettes are gone, name and all (PD-APPEARANCE-007).
  for (const retired of ['traditional', 'papaya', 'oyster', 'alone', 'dusk', 'pantone']) {
    assert.equal(isColorThemeId(retired), false, retired);
  }
  assert.equal(isColorThemeId('dark'), true);
  assert.equal(isColorThemeId(undefined), false);
});

test('each theme carries the plate tokens exactly as the palette derives them', () => {
  // Owner instruction of 2026-08-05. The three rules below this test are what actually
  // guard the palette; these lines only record which values were accepted.
  const light = COLOR_THEME_PALETTES.light;
  assert.equal(light.bg, '#EBEDEF');
  assert.equal(light.surface, '#FFFFFF');
  assert.equal(light.ink, '#13161A');
  assert.equal(light.inkMuted, '#646A70');
  assert.equal(light.ink3, '#82878C');
  assert.equal(light.struct, '#1E2226');
  assert.equal(light.structInk, '#1E2226');
  assert.equal(light.done, '#1D7D3E');
  assert.equal(light.over, '#AA3832');
  assert.equal(light.heroPlate, '#F2F2F2');
  assert.equal(light.rankHigh, '#A77F17');
  assert.equal(light.track, '#DEE0E2');
  assert.equal(light.slot, '#909396');

  const dark = COLOR_THEME_PALETTES.dark;
  // **True black**, on the owner's instruction of 2026-08-05 and against the Tiimo
  // reference. There is nothing left for a chroma to tint.
  assert.equal(dark.bg, '#000000');
  assert.equal(dark.surface, '#1C1E21');
  assert.equal(dark.ink, '#F0F2F4');
  // Graphite: structure is ink, so it carries no hue of its own in either theme.
  assert.equal(dark.struct, '#F0F2F4');
  assert.equal(dark.struct, dark.ink, 'structure has no hue in graphite');
  assert.equal(light.struct, light.accent);
  assert.equal(dark.done, '#6BD586');
  assert.equal(dark.over, '#F27D72');
  assert.equal(dark.rankHigh, '#EBB425');

  for (const id of COLOR_THEME_IDS) {
    const palette = COLOR_THEME_PALETTES[id];
    assert.equal(palette.id, id);
    assert.equal(palette.dark, palette.group === 'dark');
    for (const role of ['bg', 'surface', 'ink', 'inkMuted', 'ink3', 'struct', 'structInk', 'track', 'slot', 'done', 'over', 'heroPlate', 'rankHigh', 'onAccent'] as const) {
      assert.match(palette[role], /^#[0-9A-F]{6}$/i, `${id}.${role}`);
    }
    assert.match(palette.material, /^rgba\(/, `${id}.material`);
  }
});

test('a plate is separated from the page it lies on, in both themes', () => {
  // **This is the measurement the whole repaint answers to.** The plate stood at 1.085:1
  // over the ground in Light and 1.110:1 in Dark, with `borderColor: 'transparent'` and
  // — in Dark — a black shadow at 10 % on a near-black page. An item's own boundary was
  // drawn by almost nothing, which is what «однотипные плашки» came down to.
  for (const [id, floor] of [['light', 1.17], ['dark', 1.20]] as const) {
    const palette = COLOR_THEME_PALETTES[id];
    const step = contrastRatio(palette.surface, palette.bg);
    assert.ok(step >= floor, `${id}: plate on ground is ${step.toFixed(3)}:1, under ${floor}`);
    assert.ok(contrastRatio(palette.heroPlate, palette.surface) > 1.05, `${id}.heroPlate`);
    // Both rank spines are graphical objects and clear the 3:1 such a thing needs, on
    // the plate they actually stand on.
    const spine = contrastRatio(palette.rankHigh, palette.surface);
    assert.ok(spine >= 3, `${id}: the high-rank spine is ${spine.toFixed(2)}:1 on the plate`);
    assert.ok(contrastRatio(palette.over, palette.surface) >= 3, `${id}: the critical spine`);
  }
});

test('the two ranks are told apart by hue, and no longer by strength', () => {
  // **The old assertion here was `over` louder than `rankHigh`, and it is deliberately
  // gone.** It held while high was `over` washed 75 % over the plate — one hue at two
  // strengths, which is why it could be ordered by luminance at all. Amber is a
  // different colour, so the ordering flips between themes and means nothing: Light has
  // `over` at 6.32 against amber's 3.69, Dark has amber at 8.82 against `over`'s 6.33.
  //
  // **The recorded limit, stated rather than hidden:** in Dark the high spine is the
  // brighter of the two. What marks critical is not strength — it is the hue and the
  // 6 pt dot the plate draws beside it (PD-PLATE-017), which is the same construction
  // PD-PLATE-018 uses when it says luminance cannot separate two categories.
  const hueOf = (hex: string) => {
    const { red, green, blue } = parseHexColor(hex);
    const [r, g, b] = [red / 255, green / 255, blue / 255];
    const max = Math.max(r, g, b);
    const span = max - Math.min(r, g, b);
    if (span === 0) return 0;
    const raw = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
    return (raw * 60 + 360) % 360;
  };
  for (const id of COLOR_THEME_IDS) {
    const palette = COLOR_THEME_PALETTES[id];
    const apart = Math.abs(hueOf(palette.rankHigh) - hueOf(palette.over));
    const separation = Math.min(apart, 360 - apart);
    assert.ok(separation >= 25, `${id}: the ranks are ${separation.toFixed(0)}° apart, which reads as one colour`);
  }
  // And the dot is what the plate actually draws for critical alone.
  assert.match(source('src/features/planner/presentation/day-journal-screen.tsx'), /PLATE_CRITICAL_DOT/);
});

test('the chooser is derived from the spine, so the two cannot drift', () => {
  // This is the defect it replaces: `priorityHigh` was `structInk` — *exactly* the
  // colour of body text — so the raised thumb matched the word beside it, and the
  // chooser named a colour the plate never drew.
  for (const id of COLOR_THEME_IDS) {
    const palette = COLOR_THEME_PALETTES[id];
    const { today } = getLifePlannerTheme(id);
    assert.notEqual(today.priorityHigh, palette.structInk, `${id}: high is body ink again`);
    assert.equal(today.priorityHigh, ensureContrast(palette.rankHigh, palette.bg, 4.5, palette.ink), id);
    // A label, so 4.5:1 — where the spine it is derived from only owes 3:1.
    assert.ok(contrastRatio(today.priorityHigh, palette.bg) >= 4.5, `${id}: the high label`);
    assert.ok(contrastRatio(today.priorityCritical, palette.bg) >= 4.5, `${id}: the critical label`);
  }
});

test('the neutrals are neutral, which is the whole of what went wrong before', () => {
  // **A tint is more visible the darker the surface it is on.** The dark ground carried
  // 0.009 of chroma at L 0.198 and read as a green cast over every pixel, while the same
  // amount at L 0.94 in Light was invisible — which is exactly why the report was «light
  // is still OK, dark is awful». The ceiling below is what stops that returning, and it is
  // tighter than the value that failed rather than merely different from it.
  const spreadOf = (hex: string) => {
    const { red, green, blue } = parseHexColor(hex);
    return (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
  };
  for (const id of COLOR_THEME_IDS) {
    for (const role of ['bg', 'surface', 'heroPlate', 'track'] as const) {
      const spread = spreadOf(COLOR_THEME_PALETTES[id][role]);
      assert.ok(spread <= 0.024, `${id}.${role} is tinted: channel spread ${spread.toFixed(3)}`);
    }
  }
  // And the dark ground is black outright, so there is nothing there to tint at all.
  assert.equal(COLOR_THEME_PALETTES.dark.bg, '#000000');
});

test('anything drawn on a filled mark reads on it, in both themes', () => {
  // The bundle gives both themes a white `onState`. In Dark, `struct` and `done` are
  // light colours and white on them is 2.5:1 — below the 3:1 a mark needs — so the
  // dark theme's `onAccent` is the ground instead. This is the assertion that keeps
  // that correction from being quietly undone.
  for (const id of COLOR_THEME_IDS) {
    const palette = COLOR_THEME_PALETTES[id];
    for (const fill of ['struct', 'done', 'over'] as const) {
      assert.ok(
        contrastRatio(palette.onAccent, palette[fill]) >= 3,
        `${id}: onAccent ${palette.onAccent} on ${fill} ${palette[fill]} is ${contrastRatio(palette.onAccent, palette[fill]).toFixed(2)}`,
      );
    }
  }
});

// ── The one rule: chroma carries state, hue carries category ────────────────

test('the two states are louder than any category, and green means done alone', () => {
  for (const id of COLOR_THEME_IDS) {
    const palette = COLOR_THEME_PALETTES[id];
    const surfaces = buildThemeSurfaceColors(palette);
    // Completion is `done`, not the structural accent: green is completed and
    // nothing else in the application (PD-PLATE-004).
    assert.equal(surfaces.completion, palette.done);
    assert.notEqual(surfaces.completion, palette.struct);
    // There are exactly two state colours. The `schedule*` family was a third and
    // now resolves to the second rather than inventing one.
    assert.equal(surfaces.scheduleAccent, palette.over);
    assert.equal(surfaces.attention, palette.over);
    assert.equal(surfaces.error, palette.over);
    // Structure and lateness are not neighbours: `now` is structural, `late` is the
    // alarm, and they merged once when they shared a hue.
    assert.equal(surfaces.nowMarker, palette.struct);
    assert.notEqual(surfaces.nowMarker, surfaces.attention);
    // Every category is a different colour from both states.
    for (const key of CATEGORY_HUE_KEYS) {
      const hue = CATEGORY_HUES[id][key];
      assert.notEqual(hue, palette.done);
      assert.notEqual(hue, palette.over);
    }
  }
});

test('the six categories are one family, and only their lightness follows the theme', () => {
  assert.deepEqual([...CATEGORY_HUE_KEYS], ['routine', 'meal', 'body', 'home', 'work', 'mind']);
  for (const id of COLOR_THEME_IDS) {
    const hues = CATEGORY_HUES[id];
    const values = CATEGORY_HUE_KEYS.map((key) => hues[key]);
    // Six distinct colours, none repeated.
    assert.equal(new Set(values).size, 6, id);
    for (const value of values) assert.match(value, /^#[0-9A-F]{6}$/i, `${id} ${value}`);
    // **The mark is filled with the colour itself and the glyph is knocked out of it**,
    // so what has to clear 3:1 is the *plate* on the hue. The 13 % wash it replaces could
    // never carry a category: six washes at one lightness differ from each other by
    // 1.004–1.011:1, so the colour was present only in an 18 pt glyph.
    const plate = COLOR_THEME_PALETTES[id].surface;
    for (const key of CATEGORY_HUE_KEYS) {
      const knockout = contrastRatio(plate, hues[key]);
      assert.ok(knockout >= 3, `${id}.${key}: the knocked-out glyph is ${knockout.toFixed(2)}:1`);
    }
    // And they are one family: at a constant share of each hue's own maximum chroma the
    // six sit within a narrow band of lightness rather than at 30 % and 88 % of what
    // their hue can reach, which is what made `home` look saturated and `mind` washed.
    const lightness = CATEGORY_HUE_KEYS.map((key) => relativeLuminanceOf(hues[key]));
    assert.ok(
      Math.max(...lightness) / Math.min(...lightness) < 1.9,
      `${id}: the six categories are not one lightness (${Math.max(...lightness) / Math.min(...lightness)})`,
    );
  }
  // Hue is the item's data and never moves; lightness does (PD-CATEGORY-006), so a
  // category is a different value in the two themes and the same category in both.
  for (const key of CATEGORY_HUE_KEYS) {
    assert.notEqual(CATEGORY_HUES.light[key], CATEGORY_HUES.dark[key], key);
  }
});

test('the twenty-one stored accent keys resolve to the six hues', () => {
  const theme = getLifePlannerTheme('light');
  // The six the catalogue names carry their category...
  assert.equal(theme.habitAccents.amber.selectedSwatch, CATEGORY_HUES.light.routine);
  assert.equal(theme.habitAccents.brown.selectedSwatch, CATEGORY_HUES.light.meal);
  assert.equal(theme.habitAccents.green.selectedSwatch, CATEGORY_HUES.light.body);
  assert.equal(theme.habitAccents.teal.selectedSwatch, CATEGORY_HUES.light.home);
  assert.equal(theme.habitAccents.blue.selectedSwatch, CATEGORY_HUES.light.work);
  assert.equal(theme.habitAccents.purple.selectedSwatch, CATEGORY_HUES.light.mind);
  // ...and every stored key resolves to one of the six rather than to a grey.
  const family = new Set(CATEGORY_HUE_KEYS.map((key) => CATEGORY_HUES.light[key]));
  for (const key of habitAccentTokenKeys) {
    assert.ok(family.has(theme.habitAccents[key].selectedSwatch), key);
    assert.ok(contrastRatio(theme.habitAccents[key].iconForeground, theme.habitAccents[key].iconBackground) >= 3, key);
  }
});

// ── The derivation ──────────────────────────────────────────────────────────

test('colour arithmetic moves towards ink and towards the ground predictably', () => {
  assert.deepEqual(parseHexColor('#0A141E'), { red: 10, green: 20, blue: 30 });
  assert.equal(toHexColor({ red: 10, green: 20, blue: 30 }), '#0A141E');
  assert.equal(mixColors('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(mixColors('#000000', '#FFFFFF', 1), '#FFFFFF');
  assert.equal(mixColors('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(withAlpha('#606E8C', 0.12), 'rgba(96, 110, 140, 0.12)');
  assert.ok(contrastRatio('#000000', '#FFFFFF') > 20);
  assert.ok(Math.abs(contrastRatio('#FFFFFF', '#FFFFFF') - 1) < 1e-9);
  assert.throws(() => parseHexColor('sage'));
});

test('a colour that already reads on its ground is returned untouched', () => {
  assert.equal(ensureContrast('#191F28', '#E7E9EE', 4.5, '#191F28'), '#191F28');
  const raised = ensureContrast('#D33B36', '#14171C', 4.5, '#EDEFF3');
  assert.ok(contrastRatio(raised, '#14171C') >= 4.5);
});

test('every derived role resolves, and text roles read on their own ground', () => {
  for (const id of COLOR_THEME_IDS) {
    const palette = COLOR_THEME_PALETTES[id];
    const surfaces = buildThemeSurfaceColors(palette);
    for (const [role, value] of Object.entries(surfaces)) {
      if (typeof value === 'number') continue;
      assert.ok(/^(#[0-9A-F]{6}|rgba\()/.test(value), `${id}.${role}: ${value}`);
    }
    for (const role of ['primaryText', 'system', 'attentionText', 'scheduleText', 'priorityHigh', 'priorityCritical'] as const) {
      assert.ok(contrastRatio(surfaces[role], palette.bg) >= 4.5, `${id}.${role} is ${surfaces[role]} on ${palette.bg}`);
    }
    assert.ok(contrastRatio(surfaces.secondaryText, palette.surface) >= 4.5, `${id}.secondaryText on surface`);
    assert.ok(contrastRatio(surfaces.secondaryText, palette.bg) >= 4, `${id}.secondaryText on ground`);
    // `ink3` never carries information on its own — it is a resting ring, a weekday
    // letter, an hour tick — so it is deliberately below the text threshold and is
    // asserted as such rather than being quietly raised.
    assert.ok(contrastRatio(surfaces.tertiaryText, palette.surface) < 4.5, `${id}.tertiaryText`);
    // The two surfaces the eye has to separate stay separate.
    assert.notEqual(surfaces.appSurface, surfaces.dashboardSurface, id);
    assert.notEqual(surfaces.dashboardSurface, surfaces.pressedSurface, id);
    assert.notEqual(surfaces.dashboardSurface, surfaces.heroSurface, id);
    assert.equal(new Set([surfaces.priorityLow, surfaces.priorityNormal, surfaces.priorityHigh, surfaces.priorityCritical]).size, 4, id);
  }
});

test('the ground follows the theme and the same id resolves to one frozen object', () => {
  for (const id of COLOR_THEME_IDS) {
    const theme = getLifePlannerTheme(id);
    assert.equal(theme.themeId, id);
    assert.equal(theme.today.appSurface, theme.palette.bg);
    assert.equal(theme.today.onAccent, theme.palette.onAccent);
    assert.equal(theme.colors.background, theme.palette.bg);
    assert.equal(theme.colors.text, theme.palette.ink);
    assert.equal(theme.colors.success, theme.palette.done);
  }
  const first = getLifePlannerTheme('dark');
  assert.equal(getLifePlannerTheme('dark'), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(getLifePlannerTheme().themeId, DEFAULT_COLOR_THEME_ID);
  assert.notEqual(getLifePlannerTheme('light').today.appSurface, getLifePlannerTheme('dark').today.appSurface);
});

// ── Where the choice is made: nowhere ───────────────────────────────────────

test('the appearance is the phone’s, and nothing stores it', () => {
  assert.equal(resolveAppearance('dark'), 'dark');
  assert.equal(resolveAppearance('light'), 'light');
  // A phone that has not answered yet still has to paint a frame.
  assert.equal(resolveAppearance(null), 'light');
  assert.equal(resolveAppearance(undefined), 'light');
  assert.equal(colorThemeIdForScheme('dark'), 'dark');

  // The provider subscribes to the system switch, so flipping it in Control Centre
  // repaints without a relaunch.
  assert.match(provider, /useColorScheme\(\)/);
  assert.match(provider, /resolveAppearance\(scheme\)/);
  // Nothing is read, written or waited for.
  assert.doesNotMatch(provider, /readStoredColorThemeId|writeStoredColorThemeId|selectThemeId/);

  // The picker, its route and its preference store are deleted rather than hidden.
  assert.equal(existsSync('src/ui/screens/appearance-screen.tsx'), false);
  assert.equal(existsSync('src/ui/theme/theme-preference-store.ts'), false);
  assert.equal(existsSync('app/settings/appearance.tsx'), false);
  assert.equal(existsSync('src/ui/theme/appearance-provider.tsx'), true);

  // More states where the colour comes from and offers no control that does nothing.
  assert.doesNotMatch(more, /settings\/appearance|selectThemeId|palette\.name/);
  assert.match(more, /follow your device/);
});

test('the native configuration follows the phone too', () => {
  const config = JSON.parse(source('app.json')) as { expo: { userInterfaceStyle: string; ios: { userInterfaceStyle: string } } };
  assert.equal(config.expo.userInterfaceStyle, 'automatic');
  assert.equal(config.expo.ios.userInterfaceStyle, 'automatic');
});

test('green means done, and the two sheets stopped using it for anything else', () => {
  // **PD-PLATE-004 states it in as many words**: «Green is `done` and nothing else in the
  // application. Nothing else is allowed to be this saturated.» Both create sheets had drifted
  // off it — the Anytime switch's track when on, the «Custom · reset» link, a focused field's
  // border, a step's ordinal, a chosen time chip. None of those is a completed thing, and a
  // colour that means five things means none of them.
  //
  // `system` is what a control that is merely *active* is painted with, and it is what the
  // rest of the application already uses for exactly that.
  for (const file of [
    'src/features/planner/presentation/create-habit-sheets.tsx',
    'src/features/planner/presentation/time-drum-sheet.tsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    for (const misuse of [
      /anyTime \? theme\.today\.completion/,
      /chosen \? theme\.today\.completion/,
      /borderColor: theme\.today\.completion/,
    ]) assert.doesNotMatch(source, misuse, `${file} paints an active control with the done colour`);
  }
  // What legitimately keeps it: the sheet's own Done button, and the completion-mode chooser
  // — both of which are about completion and nothing else.
  const sheets = readFileSync('src/features/planner/presentation/create-habit-sheets.tsx', 'utf8');
  assert.match(sheets, /styles\.sheetDone, \{ backgroundColor: theme\.today\.completion \}/);
});
