import { useAppearance } from './appearance-provider';

export function useLifePlannerTheme() {
  return useAppearance().theme;
}
