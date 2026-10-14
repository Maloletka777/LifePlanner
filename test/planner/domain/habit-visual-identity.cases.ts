import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_PERSISTED_HABIT_ACCENT_KEYS,
  CANONICAL_HABIT_ACCENT_KEYS,
  HABIT_ACCENT_KEYS,
  HABIT_ACCENT_OPTIONS,
  HABIT_EMOJI_MAX_UTF8_BYTES,
  HABIT_ICON_KEYS,
  HABIT_SYMBOL_CATALOGUE,
  HABIT_SYMBOL_CATEGORIES,
  habitAccentKeyForId,
  habitIconKeyForTrackingMode,
  habitIconIdentityPresentationFallback,
  parseHabitAccentKey,
  parseHabitEmoji,
  parseHabitIconIdentity,
  parseHabitIconKey,
  parseRegisteredHabitSymbolKey,
  resolveHabitVisualIdentity,
  stableHabitIdentityHash,
  utf8ByteLength,
} from '../../../src/features/planner/domain';

test('canonical accent catalogue has exactly 16 immutable semantic options while every v5 key remains valid', () => {
  assert.deepEqual(CANONICAL_HABIT_ACCENT_KEYS, [
    'blue', 'indigo', 'violet', 'purple', 'pink', 'red', 'orange', 'amber',
    'yellow', 'lime', 'green', 'mint', 'teal', 'cyan', 'brown', 'grey',
  ]);
  assert.equal(HABIT_ACCENT_OPTIONS.length, 16);
  assert.equal(new Set(HABIT_ACCENT_OPTIONS.map(({ key }) => key)).size, 16);
  assert.ok(HABIT_ACCENT_OPTIONS.every(({ key, label }) => key.length > 0 && label.length > 0));
  assert.equal(Object.isFrozen(HABIT_ACCENT_OPTIONS), true);
  assert.ok(HABIT_ACCENT_OPTIONS.every(Object.isFrozen));
  assert.deepEqual(HABIT_ACCENT_KEYS, ['coral', 'rose', 'peach', 'amber', 'mint', 'teal', 'sky', 'blue', 'lavender', 'violet']);
  assert.ok(HABIT_ACCENT_KEYS.every((key) => ALL_PERSISTED_HABIT_ACCENT_KEYS.includes(key)));
  assert.equal(parseHabitAccentKey('coral').ok, true);
  assert.equal(parseHabitAccentKey('grey').ok, true);
  assert.equal(parseHabitAccentKey('arbitrary-blue').ok, false);
});

test('registered symbol catalogue is public, immutable, unique, searchable, and keeps the 14 legacy keys', () => {
  assert.equal(HABIT_SYMBOL_CATALOGUE.length >= 72, true);
  assert.equal(HABIT_SYMBOL_CATALOGUE.length, 94);
  assert.deepEqual(HABIT_SYMBOL_CATEGORIES, [
    'General', 'Morning', 'Health', 'Fitness', 'Food', 'Water', 'Mindfulness',
    'Sleep', 'Study', 'Work', 'Home', 'Finance', 'Social', 'Creativity',
    'Personal care', 'Lifestyle',
  ]);
  assert.equal(new Set(HABIT_SYMBOL_CATALOGUE.map(({ key }) => key)).size, HABIT_SYMBOL_CATALOGUE.length);
  assert.equal(Object.isFrozen(HABIT_SYMBOL_CATALOGUE), true);
  assert.ok(HABIT_SYMBOL_CATALOGUE.every((entry) =>
    Object.isFrozen(entry) && Object.isFrozen(entry.searchTerms) && entry.label.length > 0 &&
    entry.searchTerms.length > 0 && HABIT_SYMBOL_CATEGORIES.includes(entry.category)));
  assert.deepEqual(HABIT_ICON_KEYS, [
    'habit_generic', 'water', 'morning', 'reading', 'workout', 'sleep', 'vitamins',
    'walking', 'study', 'checkbox', 'counter', 'quantity', 'duration', 'avoidance',
  ]);
  assert.ok(HABIT_ICON_KEYS.every((key) => HABIT_SYMBOL_CATALOGUE.some((entry) => entry.key === key)));
  assert.equal(parseRegisteredHabitSymbolKey('coding').ok, true);
  assert.equal(parseRegisteredHabitSymbolKey('unknown-symbol').ok, false);
  assert.equal(parseHabitIconKey('water').ok, true);
  assert.equal(parseHabitIconKey('coding').ok, false);
});

test('default visual identity preserves tracking semantics and the frozen v5 FNV-1a policy', () => {
  const habitId = '00000000-0000-4000-8000-000000000123';
  const first = resolveHabitVisualIdentity({ habitId, trackingMode: 'quantity' });
  const second = resolveHabitVisualIdentity({ habitId, trackingMode: 'quantity' });
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  if (!first.ok) return;
  assert.deepEqual(first.value.iconIdentity, { kind: 'symbol', symbolKey: habitIconKeyForTrackingMode('quantity') });
  assert.equal(first.value.iconKey, habitIconKeyForTrackingMode('quantity'));
  assert.equal(first.value.persistedAccentKey, habitAccentKeyForId(habitId));
  assert.equal(first.value.accentKey, habitAccentKeyForId(habitId));
  assert.equal(stableHabitIdentityHash(habitId), stableHabitIdentityHash(habitId));
  assert.deepEqual(
    ['habit-a', 'habit-b', habitId, 'draft:test'].map(habitAccentKeyForId),
    ['rose', 'coral', 'teal', 'mint'],
  );
});

test('expanded symbols and canonical accents remain exact while legacy UI fallbacks are explicitly derived', () => {
  const result = resolveHabitVisualIdentity({
    habitId: 'same-id',
    trackingMode: 'counter',
    iconIdentity: { kind: 'symbol', symbolKey: 'language_learning' },
    accentKey: 'indigo',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.iconIdentity, { kind: 'symbol', symbolKey: 'language_learning' });
  assert.equal(result.value.persistedAccentKey, 'indigo');
  assert.equal(result.value.iconKey, 'habit_generic');
  assert.equal(result.value.accentKey, 'blue');
});

test('emoji identity accepts one supported grapheme sequence and preserves exact input', () => {
  for (const emoji of ['😀', '☕️', '👍🏽', '👩‍💻', '👨‍👩‍👧‍👦', '🇬🇧', '1️⃣']) {
    const parsed = parseHabitEmoji(emoji);
    assert.equal(parsed.ok, true, emoji);
    if (parsed.ok) assert.equal(parsed.value, emoji);
    assert.equal(utf8ByteLength(emoji) <= HABIT_EMOJI_MAX_UTF8_BYTES, true);
  }
  const resolved = resolveHabitVisualIdentity({
    habitId: 'emoji-id',
    trackingMode: 'checkbox',
    iconIdentity: { kind: 'emoji', emoji: '👩🏽‍💻' },
    accentKey: 'pink',
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.deepEqual(resolved.value.iconIdentity, { kind: 'emoji', emoji: '👩🏽‍💻' });
  assert.equal(resolved.value.persistedAccentKey, 'pink');
  assert.equal(resolved.value.iconKey, 'habit_generic');
  assert.equal(resolved.value.accentKey, 'rose');
  assert.equal(habitIconIdentityPresentationFallback(resolved.value.iconIdentity), 'habit_generic');
});

test('emoji validation rejects empty, words, unrelated graphemes, malformed ZWJ, and oversized input', () => {
  for (const value of ['', '   ', 'hello', '😀😀', '😀 👩', '👩‍', ' 👍', '🏽', '🇬', `${'😀'.repeat(17)}`]) {
    assert.equal(parseHabitEmoji(value).ok, false, JSON.stringify(value));
  }
  assert.equal(parseHabitIconIdentity({ kind: 'emoji', emoji: 'hello' }).ok, false);
  assert.equal(parseHabitIconIdentity({ kind: 'symbol', symbolKey: 'coding', emoji: '😀' }).ok, false);
  assert.equal(parseHabitIconIdentity({ kind: 'emoji', emoji: '😀', symbolKey: 'coding' }).ok, false);
  assert.equal(resolveHabitVisualIdentity({ habitId: 'x', trackingMode: 'checkbox', iconKey: 'reading', iconIdentity: { kind: 'emoji', emoji: '😀' } }).ok, false);
});

test('common emoji contract accepts exact Unicode sequences without normalization', () => {
  const cases = [
    { value: '\u{1F33F}', codePoints: [0x1f33f] },
    { value: '\u2600\uFE0F', codePoints: [0x2600, 0xfe0f] },
    { value: '\u{1F44B}', codePoints: [0x1f44b] },
    { value: '\u{1F44D}\u{1F3FD}', codePoints: [0x1f44d, 0x1f3fd] },
    { value: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}', codePoints: [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466] },
    { value: '\u{1F1EC}\u{1F1E7}', codePoints: [0x1f1ec, 0x1f1e7] },
    { value: '1\uFE0F\u20E3', codePoints: [0x31, 0xfe0f, 0x20e3] },
  ] as const;
  for (const example of cases) {
    assert.deepEqual(Array.from(example.value, (character) => character.codePointAt(0)), example.codePoints);
    const parsed = parseHabitEmoji(example.value);
    assert.equal(parsed.ok, true, example.value);
    if (parsed.ok) assert.equal(parsed.value, example.value);
    const identity = parseHabitIconIdentity({ kind: 'emoji', emoji: example.value });
    assert.equal(identity.ok, true, example.value);
  }
});

test('emoji whitespace and malformed standalone components remain strict typed failures', () => {
  const fern = '\u{1F33F}';
  for (const value of [` ${fern}`, `${fern} `, `${fern}\n`, '\uFE0F', '\u200D', '\u{1F3FD}', '\u{1F1EC}']) {
    const parsed = parseHabitEmoji(value);
    assert.equal(parsed.ok, false, JSON.stringify(value));
    if (!parsed.ok) {
      assert.equal(parsed.error.code, 'unsupported_stored_value');
      assert.equal(parsed.error.field, 'emoji');
    }
  }
});
