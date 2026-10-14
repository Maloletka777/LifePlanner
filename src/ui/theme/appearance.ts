import { colorThemeIdForScheme, DEFAULT_COLOR_THEME_ID, type ColorThemeId } from './color-themes';

/**
 * **The appearance is the phone's** (PD-APPEARANCE-007).
 *
 * It was pinned to one theme for the whole of v0.3.x and v0.5.x, and the five
 * palettes existed precisely because of that pin: with the system switch unread, the
 * only way to offer a dark ground was to let somebody pick one. The owner chose Light
 * and Dark as Apple supplies them, so the pin, the choice and the screen that carried
 * it all go together.
 *
 * `null` is what `useColorScheme()` reports before the phone has answered, and it
 * resolves to Light rather than to nothing: a screen has to paint in that frame.
 */
export function resolveAppearance(systemScheme?: 'light' | 'dark' | null): ColorThemeId {
  return colorThemeIdForScheme(systemScheme);
}

export const DEFAULT_APPEARANCE_THEME_ID: ColorThemeId = DEFAULT_COLOR_THEME_ID;
