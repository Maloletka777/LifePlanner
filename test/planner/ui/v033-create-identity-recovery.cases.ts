import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  HABIT_ACCENT_OPTIONS,
  HABIT_EMOJI_MAX_UTF8_BYTES,
  HABIT_SYMBOL_CATALOGUE,
  parseHabitEmoji,
  utf8ByteLength,
} from '../../../src/features/planner/domain';
import {
  habitIdentitySummary,
  validateHabitEmojiInput,
} from '../../../src/features/planner/presentation/habit-identity-picker-model';
import {
  HABIT_SYMBOL_GLYPHS,
  habitIconography,
} from '../../../src/features/planner/presentation/planner-iconography';
import { getLifePlannerTheme } from '../../../src/ui/theme/tokens';

const createSource = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
const stagesSource = readFileSync('src/features/planner/presentation/habit-form-stages.tsx', 'utf8');
const identitySource = readFileSync('src/features/planner/presentation/habit-identity-controls.tsx', 'utf8');
const emojiBoundary = Object.freeze({ maxUtf8Bytes: HABIT_EMOJI_MAX_UTF8_BYTES, parse: parseHabitEmoji, utf8ByteLength });

test('Recovery 6B.1 keeps the habit name mounted first and Create title-gated', () => {
  // The name still comes before the schedule. The repeat is a row into a sheet now
  // rather than a chip row on the page, so the anchor is the row, not the chips.
  const title = createSource.indexOf('accessibilityLabel="Name"');
  const schedule = createSource.indexOf('label="Repeats"');
  assert.ok(title >= 0 && title < schedule, 'the name leads the schedule');
  // The name leads, and it is a placeholder rather than a value — that is what
  // makes it vanish on the first touch. The keyboard is still the user's to open
  // (PD-CREATE-001, reinstated on their instruction).
  assert.match(createSource, /CREATE_NAME_PLACEHOLDERS\[itemType\]/);
  assert.doesNotMatch(createSource, /autoFocus/);
  assert.match(createSource, /const canCreate = !saving && name\.trim\(\) !== ''/);
  // Leaving the form is the discard: the draft lives in component state and
  // unmounting already throws it away, so holding the back gesture to ask was
  // an alert on the screen behind a sheet that had already slid off.
  assert.doesNotMatch(createSource, /addListener\('beforeRemove'|Alert\.alert/);
});

test('all 94 canonical symbols have explicit non-fallback presentation mappings', () => {
  assert.equal(HABIT_SYMBOL_CATALOGUE.length, 94);
  assert.equal(Object.keys(HABIT_SYMBOL_GLYPHS).length, 94);
  for (const symbol of HABIT_SYMBOL_CATALOGUE) {
    assert.ok(HABIT_SYMBOL_GLYPHS[symbol.key], symbol.key);
    const presentation = habitIconography(symbol.key, 'blue');
    assert.equal(presentation.fallback, false, symbol.key);
    assert.equal(presentation.label, symbol.label);
  }
  assert.equal(habitIconography('corrupt-symbol', 'blue').fallback, true);
  assert.equal(HABIT_SYMBOL_GLYPHS.water, 'water-outline');
  assert.equal(HABIT_SYMBOL_GLYPHS.reading, 'book-outline');
  assert.equal(HABIT_SYMBOL_GLYPHS.workout, 'barbell-outline');
});

test('symbol catalogue is searchable, horizontally categorized, adaptive, and bottom-safe', () => {
  assert.match(identitySource, /filterHabitIconOptions\(query, category\)/);
  assert.match(identitySource, /horizontal contentContainerStyle=\{styles\.categoryRail\}/);
  assert.match(identitySource, /width >= 430 && fontScale < 1\.3 \? 4 : 3/);
  assert.match(identitySource, /key=\{`symbol-grid-\$\{columns\}`\}/);
  assert.match(identitySource, /paddingBottom: 32/);
  assert.match(identitySource, /numberOfLines=\{2\}/);
});

test('the 16 canonical colours resolve to six hues, and every role still resolves', () => {
  const light = getLifePlannerTheme('light');
  const dark = getLifePlannerTheme('dark');
  const roles = ['iconBackground', 'iconForeground', 'surface', 'progressSurface', 'border', 'selectedSwatch', 'childSurface'] as const;
  // **Reversed by PD-PLATE-004, and this is the assertion that records it.** Sixteen
  // distinct treatments were the point when a habit's colour was a free choice; a
  // category is the only chromatic language an item has now, so sixteen stored keys
  // land on **six** hues and any key naming no category resolves to `work`. The
  // storage contract is untouched — every one of the sixteen still reads back.
  assert.equal(HABIT_ACCENT_OPTIONS.length, 16);
  for (const theme of [light, dark]) {
    const signatures = HABIT_ACCENT_OPTIONS.map(({ key }) => roles.map((role) => theme.habitAccents[key][role]).join('|'));
    assert.equal(new Set(signatures).size, 6);
    assert.equal(new Set(HABIT_ACCENT_OPTIONS.map(({ key }) => theme.habitAccents[key].selectedSwatch)).size, 6);
    // Every role still resolves for every stored key: nothing falls through to
    // undefined because its hue was retired.
    for (const { key } of HABIT_ACCENT_OPTIONS) {
      for (const role of roles) assert.match(theme.habitAccents[key][role], /^#[0-9A-F]{6}$/i, `${key}.${role}`);
    }
  }
  assert.match(identitySource, /columns = width < 360 \|\| fontScale >= 1\.3 \? 3 : 4/);
  assert.match(identitySource, /accessibilityRole="radio"/);
  assert.match(identitySource, /checkmark/);
});

test('emoji input preserves exact raw strings and exposes concise consumer errors', () => {
  const examples = ['🌿', '☀️', '👋', '👍🏽', '👨‍👩‍👧‍👦', '🇬🇧', '1️⃣'];
  for (const value of examples) {
    const canonical = parseHabitEmoji(value);
    const consumer = validateHabitEmojiInput(value, emojiBoundary);
    assert.equal(canonical.ok, true, value);
    assert.equal(consumer.ok, true, value);
    if (consumer.ok) assert.equal(consumer.value, value);
  }
  assert.deepEqual(validateHabitEmojiInput('🌿🌿', emojiBoundary), { ok: false, message: 'Choose one emoji' });
  assert.deepEqual(validateHabitEmojiInput('🌿'.repeat(17), emojiBoundary), { ok: false, message: 'That emoji is not supported' });
  assert.doesNotMatch(identitySource, /\.normalize\(|\.slice\(|\.charAt\(|Array\.from\(|\[\s*0\s*\]|\[\.\.\.value\]/);
  assert.doesNotMatch(identitySource, />[^<]*(grapheme|variation selector|ZWJ|UTF-8 bytes)/i);
  assert.match(identitySource, /onChangeText=\{\(nextValue\) => \{ setValue\(nextValue\)/);
  assert.match(identitySource, /parse: parseHabitEmoji/);
  assert.doesNotMatch(readFileSync('src/features/planner/presentation/habit-identity-picker-model.ts', 'utf8'), /from '\.\.\/domain'/);
});

test('automatic and explicit icon/colour modes remain exact and mutually exclusive', () => {
  assert.equal(habitIdentitySummary({ iconMode: 'automatic', iconSymbolKey: 'water', iconEmoji: null, accentMode: 'automatic', accentKey: 'blue' }), 'Automatic icon · Automatic colour');
  assert.equal(habitIdentitySummary({ iconMode: 'explicit', iconSymbolKey: 'reading', iconEmoji: null, accentMode: 'explicit', accentKey: 'green' }), 'Reading · Green');
  assert.equal(habitIdentitySummary({ iconMode: 'explicit', iconSymbolKey: 'water', iconEmoji: '🌿', accentMode: 'automatic', accentKey: 'mint' }), 'Emoji 🌿 · Automatic colour');
  // Edit, Restore and the template preview keep the exact automatic-versus-explicit
  // mapping; Create expresses the same distinction through its own two choices.
  assert.match(stagesSource, /persistedAccentKey: next\.accentMode === 'explicit' \? next\.accentKey : null/);
  assert.match(stagesSource, /iconSymbolKey: next\.iconMode === 'explicit' && next\.iconEmoji === null/);
  // The create sheet expresses neither choice any more: it picks no symbol at all
  // and its colour is always a category, so identity is automatic and the accent
  // explicit in every case.
  // The create surface chooses a symbol again, so the selection is no longer a
  // constant: automatic until something is actually chosen, explicit after.
  assert.match(createSource, /iconSelection: symbolKey === null \? \('automatic' as const\) : \('explicit' as const\)/);
  assert.match(createSource, /accentSelection: 'explicit'/);
  assert.match(identitySource, /iconMode: 'automatic'.*accentMode: 'automatic'/s);
});

test('routine drafts retain atomic save and consumer-facing summary copy', () => {
  const sheets = readFileSync('src/features/planner/presentation/create-habit-sheets.tsx', 'utf8');
  assert.match(sheets, /How this looks in Today/);
  // The closes-by choice is back on the owner's instruction: making every routine
  // derive took the parent's own checkbox away, and some habits want it.
  assert.match(sheets, /By all steps/);
  assert.match(sheets, /Manually/);
  // A step is a checklist line now, not a child of any completion role, so the
  // item is saved alone and the lines are written after it.
  assert.match(createSource, /createHabitBundle/);
  assert.match(createSource, /addHabitChecklistLines/);
  assert.match(createSource, /drafts are still available/);
});

test('identity recovery keeps 44-point controls, semantic typography, and platform sheet motion', () => {
  assert.match(identitySource, /minHeight: 44/);
  assert.match(identitySource, /theme\.typography\.(headline|label|caption|body)/);
  assert.match(identitySource, /presentationStyle="pageSheet"/);
  assert.match(identitySource, /animationType="slide"/);
  assert.doesNotMatch(identitySource, /Animated\.|LayoutAnimation|setInterval|withRepeat/);
  assert.match(identitySource, /accessibilityViewIsModal/);
  assert.match(identitySource, /accessibilityState=\{\{ checked:/);
});
