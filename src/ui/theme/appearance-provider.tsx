import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { getLifePlannerTheme, type LifePlannerTheme } from './tokens';
import { resolveAppearance } from './appearance';
import { type ColorThemeId } from './color-themes';

type AppearanceContextValue = Readonly<{
  theme: LifePlannerTheme;
  themeId: ColorThemeId;
  /**
   * Kept in the shape every caller already had. It is always true now: there is
   * nothing to read from storage before the first paint, so the splash screen no
   * longer waits on a database open for a colour.
   */
  ready: boolean;
}>;

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/**
 * Two themes, and the phone chooses (PD-APPEARANCE-007).
 *
 * `useColorScheme()` subscribes to the system switch, so flipping it in Control
 * Centre repaints the application without a relaunch — which is the whole of what the
 * picker, its preference store and `lifeplanner-appearance.db` used to do by hand,
 * and none of them survives.
 */
export function AppearanceProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme();
  const themeId = resolveAppearance(scheme);

  const value = useMemo<AppearanceContextValue>(() => Object.freeze({
    theme: getLifePlannerTheme(themeId),
    themeId,
    ready: true,
  }), [themeId]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (context === null) throw new Error('AppearanceProvider is missing from the application root.');
  return context;
}
