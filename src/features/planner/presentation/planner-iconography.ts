import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import type {
  HabitAccentKey,
  HabitSymbolCategory,
  PersistedHabitAccentKey,
  RegisteredHabitSymbolKey,
  TrackingMode,
} from '@/src/features/planner';
import { habitAccentPresentationFallback, HABIT_SYMBOL_CATEGORIES, HABIT_SYMBOL_CATALOGUE } from '../domain';
import type { HabitAccentTokenKey } from '@/src/ui/theme';

export interface PlannerIconPresentation {
  readonly icon: ComponentProps<typeof Ionicons>['name'];
  readonly label: string;
  /** Reads the habit accent set, which already switches family with the ground. */
  readonly accentTone: HabitAccentTokenKey;
  readonly fallback: boolean;
}

export type HabitIconCategory = HabitSymbolCategory;

export interface HabitIconOption {
  readonly key: RegisteredHabitSymbolKey;
  readonly label: string;
  readonly category: HabitIconCategory;
  readonly searchTerms: readonly string[];
}

export const HABIT_ICON_CATEGORIES = HABIT_SYMBOL_CATEGORIES;

export const HABIT_ICON_OPTIONS: readonly HabitIconOption[] = Object.freeze(HABIT_SYMBOL_CATALOGUE.map(({ key, label, category, searchTerms }) => Object.freeze({ key, label, category, searchTerms })));

export const TRACKING_ICONOGRAPHY: Readonly<Record<TrackingMode, PlannerIconPresentation>> = Object.freeze({
  checkbox: icon('checkmark-circle-outline', 'Check-off habit', 'coral'),
  avoidance: icon('shield-checkmark-outline', 'Avoidance habit', 'lavender'),
  counter: icon('add-circle-outline', 'Counter habit', 'amber'),
  quantity: icon('water-outline', 'Quantity habit', 'sky'),
  duration: icon('timer-outline', 'Duration habit', 'blue'),
});

export const HABIT_SYMBOL_GLYPHS: Readonly<Record<RegisteredHabitSymbolKey, PlannerIconPresentation['icon']>> = Object.freeze({
  habit_generic: 'leaf-outline',
  checkbox: 'checkmark-circle-outline',
  counter: 'add-circle-outline',
  quantity: 'water-outline',
  duration: 'timer-outline',
  avoidance: 'shield-checkmark-outline',
  target: 'flag-outline',
  checklist: 'list-outline',
  calendar: 'calendar-outline',
  planning: 'calendar-number-outline',
  morning: 'sunny-outline',
  wake_up: 'alarm-outline',
  morning_routine: 'partly-sunny-outline',
  alarm: 'time-outline',
  water: 'water-outline',
  vitamins: 'medical-outline',
  medication: 'medkit-outline',
  medical_appointment: 'calendar-clear-outline',
  heart_health: 'heart-outline',
  first_aid: 'bandage-outline',
  therapy: 'people-outline',
  workout: 'barbell-outline',
  walking: 'walk-outline',
  strength: 'fitness-outline',
  running: 'walk-outline',
  cycling: 'bicycle-outline',
  swimming: 'water-outline',
  stretching: 'accessibility-outline',
  yoga: 'body-outline',
  sports: 'football-outline',
  outdoors: 'trail-sign-outline',
  water_bottle: 'water-outline',
  coffee: 'cafe-outline',
  tea: 'cafe-outline',
  meal: 'restaurant-outline',
  breakfast: 'egg-outline',
  lunch: 'fast-food-outline',
  dinner: 'restaurant-outline',
  fruit: 'nutrition-outline',
  vegetables: 'leaf-outline',
  cooking: 'flame-outline',
  meditation: 'flower-outline',
  breathing: 'cloud-outline',
  mindfulness: 'sparkles-outline',
  gratitude: 'heart-circle-outline',
  journal: 'journal-outline',
  sleep: 'moon-outline',
  bed: 'bed-outline',
  wind_down: 'cloudy-night-outline',
  no_screens: 'phone-portrait-outline',
  reading: 'book-outline',
  study: 'school-outline',
  school: 'library-outline',
  university: 'business-outline',
  language_learning: 'language-outline',
  writing: 'create-outline',
  coding: 'code-slash-outline',
  work: 'briefcase-outline',
  meeting: 'people-circle-outline',
  email: 'mail-outline',
  phone_call: 'call-outline',
  deep_work: 'bulb-outline',
  commute: 'train-outline',
  home: 'home-outline',
  cleaning: 'brush-outline',
  laundry: 'shirt-outline',
  shopping: 'cart-outline',
  declutter: 'file-tray-outline',
  garden: 'flower-outline',
  finance: 'wallet-outline',
  saving: 'cash-outline',
  investing: 'trending-up-outline',
  budget: 'calculator-outline',
  bill: 'receipt-outline',
  family: 'people-outline',
  relationship: 'heart-outline',
  friends: 'people-circle-outline',
  social: 'chatbubbles-outline',
  message: 'chatbubble-outline',
  music: 'musical-notes-outline',
  creativity: 'color-palette-outline',
  photography: 'camera-outline',
  drawing: 'pencil-outline',
  craft: 'hammer-outline',
  shower: 'rainy-outline',
  bath: 'water-outline',
  dental_care: 'happy-outline',
  skincare: 'sparkles-outline',
  personal_care: 'person-outline',
  no_smoking: 'ban-outline',
  no_alcohol: 'wine-outline',
  travel: 'airplane-outline',
  pet_care: 'paw-outline',
  nature: 'earth-outline',
});

/**
 * The presentation fallback's ten keys each have a habit accent of their own, so
 * `rose`, `teal` and `violet` stop borrowing a neighbour's tone.
 */
const HABIT_ACCENTS: Readonly<Record<HabitAccentKey, HabitAccentTokenKey>> = Object.freeze({
  coral: 'coral',
  rose: 'rose',
  peach: 'peach',
  amber: 'amber',
  mint: 'mint',
  teal: 'teal',
  sky: 'sky',
  blue: 'blue',
  lavender: 'lavender',
  violet: 'violet',
});

export function habitIconography(
  iconKey: RegisteredHabitSymbolKey | string,
  accentKey: PersistedHabitAccentKey,
): PlannerIconPresentation {
  const accentTone = HABIT_ACCENTS[habitAccentPresentationFallback(accentKey)];
  const glyph = HABIT_SYMBOL_GLYPHS[iconKey as RegisteredHabitSymbolKey];
  const option = HABIT_ICON_OPTIONS.find(({ key }) => key === iconKey);
  return icon(
    glyph ?? 'leaf-outline',
    option?.label ?? 'Unknown habit symbol',
    accentTone,
    glyph === undefined,
  );
}

export const MODULE_ICONOGRAPHY = Object.freeze({
  planner: icon('calendar-outline', 'Planner', 'coral'),
  tasks: icon('checkmark-circle-outline', 'Tasks', 'blue'),
  finance: icon('wallet-outline', 'Finance', 'mint'),
  analytics: icon('stats-chart-outline', 'Analytics', 'lavender'),
});

function icon(iconName: PlannerIconPresentation['icon'], label: string, accentTone: HabitAccentTokenKey, fallback = false): PlannerIconPresentation {
  return Object.freeze({ icon: iconName, label, accentTone, fallback });
}
