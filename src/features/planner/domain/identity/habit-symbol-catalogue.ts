import { failure, success, type Result } from '../result';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';

export const HABIT_SYMBOL_CATEGORIES = Object.freeze([
  'General',
  'Morning',
  'Health',
  'Fitness',
  'Food',
  'Water',
  'Mindfulness',
  'Sleep',
  'Study',
  'Work',
  'Home',
  'Finance',
  'Social',
  'Creativity',
  'Personal care',
  'Lifestyle',
] as const);

export type HabitSymbolCategory = (typeof HABIT_SYMBOL_CATEGORIES)[number];

function symbol<const TKey extends string>(
  key: TKey,
  label: string,
  category: HabitSymbolCategory,
  searchTerms: readonly string[],
) {
  return Object.freeze({ key, label, category, searchTerms: Object.freeze([...searchTerms]) });
}

/** Platform-neutral metadata. Presentation owns the eventual glyph mapping. */
export const HABIT_SYMBOL_CATALOGUE = Object.freeze([
  symbol('habit_generic', 'General habit', 'General', ['habit', 'routine', 'leaf']),
  symbol('checkbox', 'Complete', 'General', ['check', 'done', 'task']),
  symbol('counter', 'Counter', 'General', ['count', 'number', 'repeat']),
  symbol('quantity', 'Quantity', 'General', ['amount', 'measure', 'value']),
  symbol('duration', 'Duration', 'General', ['timer', 'time', 'minutes']),
  symbol('avoidance', 'Avoidance', 'General', ['avoid', 'stop', 'resist']),
  symbol('target', 'Target', 'General', ['goal', 'aim', 'focus']),
  symbol('checklist', 'Checklist', 'General', ['list', 'steps', 'plan']),
  symbol('calendar', 'Calendar', 'General', ['date', 'schedule', 'plan']),
  symbol('planning', 'Planning', 'General', ['organise', 'prepare', 'schedule']),

  symbol('morning', 'Morning', 'Morning', ['sunrise', 'wake', 'routine']),
  symbol('wake_up', 'Wake up', 'Morning', ['alarm', 'rise', 'morning']),
  symbol('morning_routine', 'Morning routine', 'Morning', ['start', 'ritual', 'prepare']),
  symbol('alarm', 'Alarm', 'Morning', ['clock', 'reminder', 'wake']),

  symbol('water', 'Water', 'Water', ['drink', 'hydration', 'liquid']),
  symbol('vitamins', 'Vitamins', 'Health', ['supplement', 'medicine', 'health']),
  symbol('medication', 'Medication', 'Health', ['medicine', 'tablet', 'prescription']),
  symbol('medical_appointment', 'Medical appointment', 'Health', ['doctor', 'clinic', 'checkup']),
  symbol('heart_health', 'Heart health', 'Health', ['heart', 'pulse', 'cardio']),
  symbol('first_aid', 'First aid', 'Health', ['care', 'medical', 'bandage']),
  symbol('therapy', 'Therapy', 'Health', ['counselling', 'support', 'wellbeing']),

  symbol('workout', 'Workout', 'Fitness', ['exercise', 'gym', 'training']),
  symbol('walking', 'Walking', 'Fitness', ['walk', 'steps', 'movement']),
  symbol('strength', 'Strength training', 'Fitness', ['weights', 'lifting', 'gym']),
  symbol('running', 'Running', 'Fitness', ['run', 'jog', 'cardio']),
  symbol('cycling', 'Cycling', 'Fitness', ['bike', 'bicycle', 'ride']),
  symbol('swimming', 'Swimming', 'Fitness', ['pool', 'water', 'laps']),
  symbol('stretching', 'Stretching', 'Fitness', ['mobility', 'flexibility', 'warmup']),
  symbol('yoga', 'Yoga', 'Fitness', ['pose', 'mobility', 'practice']),
  symbol('sports', 'Sport', 'Fitness', ['game', 'team', 'training']),
  symbol('outdoors', 'Outdoor activity', 'Fitness', ['outside', 'nature', 'hike']),

  symbol('water_bottle', 'Water bottle', 'Water', ['hydrate', 'drink', 'bottle']),
  symbol('coffee', 'Coffee', 'Food', ['caffeine', 'cup', 'drink']),
  symbol('tea', 'Tea', 'Food', ['cup', 'drink', 'brew']),
  symbol('meal', 'Meal', 'Food', ['food', 'eat', 'nutrition']),
  symbol('breakfast', 'Breakfast', 'Food', ['morning', 'meal', 'eat']),
  symbol('lunch', 'Lunch', 'Food', ['midday', 'meal', 'eat']),
  symbol('dinner', 'Dinner', 'Food', ['evening', 'meal', 'eat']),
  symbol('fruit', 'Fruit', 'Food', ['healthy', 'food', 'nutrition']),
  symbol('vegetables', 'Vegetables', 'Food', ['healthy', 'food', 'nutrition']),
  symbol('cooking', 'Cooking', 'Food', ['kitchen', 'prepare', 'recipe']),

  symbol('meditation', 'Meditation', 'Mindfulness', ['calm', 'reflect', 'mindful']),
  symbol('breathing', 'Breathing', 'Mindfulness', ['breath', 'calm', 'relax']),
  symbol('mindfulness', 'Mindfulness', 'Mindfulness', ['awareness', 'present', 'calm']),
  symbol('gratitude', 'Gratitude', 'Mindfulness', ['thanks', 'journal', 'reflect']),
  symbol('journal', 'Journal', 'Mindfulness', ['diary', 'write', 'reflect']),

  symbol('sleep', 'Sleep', 'Sleep', ['bed', 'rest', 'night']),
  symbol('bed', 'Bedtime', 'Sleep', ['sleep', 'night', 'rest']),
  symbol('wind_down', 'Wind down', 'Sleep', ['evening', 'relax', 'bedtime']),
  symbol('no_screens', 'No screens', 'Sleep', ['phone', 'digital', 'bedtime']),

  symbol('reading', 'Reading', 'Study', ['book', 'library', 'learn']),
  symbol('study', 'Study', 'Study', ['school', 'learn', 'education']),
  symbol('school', 'School', 'Study', ['class', 'education', 'learn']),
  symbol('university', 'University', 'Study', ['college', 'degree', 'education']),
  symbol('language_learning', 'Language learning', 'Study', ['vocabulary', 'speak', 'practice']),
  symbol('writing', 'Writing', 'Study', ['notes', 'essay', 'compose']),
  symbol('coding', 'Coding', 'Study', ['programming', 'software', 'develop']),

  symbol('work', 'Work', 'Work', ['job', 'office', 'career']),
  symbol('meeting', 'Meeting', 'Work', ['call', 'team', 'appointment']),
  symbol('email', 'Email', 'Work', ['inbox', 'message', 'reply']),
  symbol('phone_call', 'Phone call', 'Work', ['call', 'contact', 'speak']),
  symbol('deep_work', 'Deep work', 'Work', ['focus', 'concentrate', 'project']),
  symbol('commute', 'Commute', 'Work', ['travel', 'office', 'journey']),

  symbol('home', 'Home', 'Home', ['house', 'household', 'family']),
  symbol('cleaning', 'Cleaning', 'Home', ['tidy', 'chores', 'house']),
  symbol('laundry', 'Laundry', 'Home', ['clothes', 'wash', 'chores']),
  symbol('shopping', 'Shopping', 'Home', ['buy', 'groceries', 'store']),
  symbol('declutter', 'Declutter', 'Home', ['organise', 'tidy', 'simplify']),
  symbol('garden', 'Garden', 'Home', ['plants', 'yard', 'outdoors']),

  symbol('finance', 'Finance', 'Finance', ['money', 'budget', 'account']),
  symbol('saving', 'Saving', 'Finance', ['money', 'deposit', 'goal']),
  symbol('investing', 'Investing', 'Finance', ['money', 'portfolio', 'fund']),
  symbol('budget', 'Budget', 'Finance', ['money', 'spending', 'plan']),
  symbol('bill', 'Bill', 'Finance', ['payment', 'invoice', 'money']),

  symbol('family', 'Family', 'Social', ['home', 'relative', 'together']),
  symbol('relationship', 'Relationship', 'Social', ['partner', 'connection', 'love']),
  symbol('friends', 'Friends', 'Social', ['friendship', 'people', 'together']),
  symbol('social', 'Social time', 'Social', ['people', 'meet', 'community']),
  symbol('message', 'Message someone', 'Social', ['chat', 'text', 'contact']),

  symbol('music', 'Music', 'Creativity', ['listen', 'instrument', 'song']),
  symbol('creativity', 'Creativity', 'Creativity', ['make', 'art', 'idea']),
  symbol('photography', 'Photography', 'Creativity', ['camera', 'photo', 'picture']),
  symbol('drawing', 'Drawing', 'Creativity', ['sketch', 'art', 'illustration']),
  symbol('craft', 'Craft', 'Creativity', ['make', 'hands', 'creative']),

  symbol('shower', 'Shower', 'Personal care', ['wash', 'bathroom', 'clean']),
  symbol('bath', 'Bath', 'Personal care', ['wash', 'relax', 'clean']),
  symbol('dental_care', 'Dental care', 'Personal care', ['teeth', 'brush', 'floss']),
  symbol('skincare', 'Skincare', 'Personal care', ['face', 'cream', 'care']),
  symbol('personal_care', 'Personal care', 'Personal care', ['grooming', 'hygiene', 'care']),

  symbol('no_smoking', 'No smoking', 'Lifestyle', ['avoid', 'tobacco', 'quit']),
  symbol('no_alcohol', 'No alcohol', 'Lifestyle', ['avoid', 'drink', 'sober']),
  symbol('travel', 'Travel', 'Lifestyle', ['trip', 'journey', 'holiday']),
  symbol('pet_care', 'Pet care', 'Lifestyle', ['animal', 'feed', 'walk']),
  symbol('nature', 'Nature', 'Lifestyle', ['outside', 'green', 'environment']),
] as const);

export type RegisteredHabitSymbol = (typeof HABIT_SYMBOL_CATALOGUE)[number];
export type RegisteredHabitSymbolKey = RegisteredHabitSymbol['key'];

export const REGISTERED_HABIT_SYMBOL_KEYS: readonly RegisteredHabitSymbolKey[] = Object.freeze(
  HABIT_SYMBOL_CATALOGUE.map(({ key }) => key),
);

/** The exact 14 v5 keys, retained as a presentation and command compatibility surface. */
export const HABIT_ICON_KEYS = Object.freeze([
  'habit_generic',
  'water',
  'morning',
  'reading',
  'workout',
  'sleep',
  'vitamins',
  'walking',
  'study',
  'checkbox',
  'counter',
  'quantity',
  'duration',
  'avoidance',
] as const);

/** @deprecated Use RegisteredHabitSymbolKey for new identity commands. */
export type HabitIconKey = (typeof HABIT_ICON_KEYS)[number];

const SYMBOL_KEYS = new Set<string>(REGISTERED_HABIT_SYMBOL_KEYS);
const LEGACY_ICON_KEYS = new Set<string>(HABIT_ICON_KEYS);

export function parseRegisteredHabitSymbolKey(
  input: unknown,
  field = 'symbolKey',
): Result<RegisteredHabitSymbolKey, PlannerDomainError> {
  return typeof input === 'string' && SYMBOL_KEYS.has(input)
    ? success(input as RegisteredHabitSymbolKey)
    : failure(createPlannerDomainError('unsupported_stored_value', 'Choose a registered habit symbol.', { field }));
}

export function parseHabitIconKey(
  input: unknown,
  field = 'iconKey',
): Result<HabitIconKey, PlannerDomainError> {
  return typeof input === 'string' && LEGACY_ICON_KEYS.has(input)
    ? success(input as HabitIconKey)
    : failure(createPlannerDomainError('unsupported_stored_value', 'Choose a legacy registered habit icon.', { field }));
}

export function habitSymbolPresentationFallback(key: RegisteredHabitSymbolKey): HabitIconKey {
  return LEGACY_ICON_KEYS.has(key) ? key as HabitIconKey : 'habit_generic';
}
