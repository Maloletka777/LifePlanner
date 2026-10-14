import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  HABIT_ACCENT_KEYS,
  HABIT_ACCENT_OPTIONS,
  HABIT_EMOJI_MAX_UTF8_BYTES,
  HABIT_ICON_KEYS,
  parseHabitEmoji,
  utf8ByteLength,
  type CanonicalHabitAccentKey,
  type HabitAccentKey,
  type HabitEmoji,
  type HabitIconIdentity,
  type PersistedHabitAccentKey,
  type RegisteredHabitSymbolKey,
} from '@/src/features/planner';
import { HabitIdentityIcon, PrimaryButton, SecondaryButton, TextField } from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { HabitVisualPreview } from './habit-visual-components';
import {
  accentLabel,
  filterHabitIconOptions,
  habitIdentitySummary,
  iconLabel,
  validateHabitEmojiInput,
  type HabitIdentityPickerDraft,
  type IdentitySelectionMode,
} from './habit-identity-picker-model';
import {
  HABIT_ICON_CATEGORIES,
  habitIconography,
  type HabitIconCategory,
  type HabitIconOption,
} from './planner-iconography';

export { accentLabel, filterHabitIconOptions, habitIdentitySummary, iconLabel, validateHabitEmojiInput } from './habit-identity-picker-model';
export type { HabitIdentityPickerDraft, IdentitySelectionMode } from './habit-identity-picker-model';

const RECOMMENDED_SYMBOLS: readonly RegisteredHabitSymbolKey[] = Object.freeze([
  'morning',
  'water',
  'walking',
  'workout',
  'reading',
  'study',
  'sleep',
  'habit_generic',
]);

type IdentityPickerView = 'overview' | 'symbols' | 'emoji' | 'colours';

const CANONICAL_EMOJI_INPUT_BOUNDARY = Object.freeze({
  maxUtf8Bytes: HABIT_EMOJI_MAX_UTF8_BYTES,
  parse: parseHabitEmoji,
  utf8ByteLength,
});

export function HabitIdentityPicker({
  title,
  value,
  automaticIconKey,
  automaticAccentKey,
  onCancel,
  onDone,
}: {
  readonly title: string;
  readonly value: HabitIdentityPickerDraft;
  readonly automaticIconKey: RegisteredHabitSymbolKey;
  readonly automaticAccentKey: PersistedHabitAccentKey;
  readonly onCancel: () => void;
  readonly onDone: (value: HabitIdentityPickerDraft) => void;
}) {
  const theme = useLifePlannerTheme();
  const [view, setView] = useState<IdentityPickerView>('overview');
  const [draft, setDraft] = useState(value);
  const resolvedAccent = draft.accentMode === 'automatic' ? automaticAccentKey : draft.accentKey;
  const resolvedIdentity = pickerIdentity(draft, automaticIconKey);

  return <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={view === 'overview' ? onCancel : () => setView('overview')}>
    <SafeAreaView accessibilityViewIsModal style={[styles.pickerSafeArea, { backgroundColor: theme.colors.background }]}>
      {view === 'overview' ? <>
        <PickerHeader title="Icon and colour" onCancel={onCancel} onDone={() => onDone(draft)} />
        <ScrollView contentContainerStyle={styles.overviewContent} keyboardShouldPersistTaps="handled">
          <HabitVisualPreview accentKey={resolvedAccent} iconIdentity={resolvedIdentity} sampleProgress={0} title={title} />
          <Pressable
            accessibilityLabel="Automatic icon and colour"
            accessibilityRole="radio"
            accessibilityState={{ checked: draft.iconMode === 'automatic' && draft.accentMode === 'automatic' }}
            onPress={() => setDraft({ ...draft, iconMode: 'automatic', iconEmoji: null, iconSymbolKey: automaticIconKey, accentMode: 'automatic', accentKey: automaticAccentKey })}
            style={({ pressed }) => [styles.choiceRow, {
              backgroundColor: pressed || draft.iconMode === 'automatic' && draft.accentMode === 'automatic' ? theme.colors.accentSubtle : theme.colors.elevatedSurface,
              borderColor: draft.iconMode === 'automatic' && draft.accentMode === 'automatic' ? theme.colors.accent : theme.colors.border,
            }]}
          >
            <IdentityPickerGlyph accentKey={automaticAccentKey} iconKey={automaticIconKey} />
            <View style={styles.flex}><Text style={[theme.typography.label, { color: theme.colors.text }]}>Automatic</Text><Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>Uses tracking and habit details</Text></View>
            {draft.iconMode === 'automatic' && draft.accentMode === 'automatic' ? <Ionicons color={theme.colors.accent} name="checkmark-circle" size={22} /> : null}
          </Pressable>

          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Recommended</Text>
          <View accessibilityRole="radiogroup" style={styles.recommendedGrid}>
            {RECOMMENDED_SYMBOLS.map((key) => {
              const selected = draft.iconMode === 'explicit' && draft.iconEmoji === null && draft.iconSymbolKey === key;
              return <Pressable
                key={key}
                accessibilityLabel={iconLabel(key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setDraft({ ...draft, iconMode: 'explicit', iconEmoji: null, iconSymbolKey: key })}
                style={({ pressed }) => [styles.recommendedCell, {
                  backgroundColor: selected || pressed ? theme.colors.accentSubtle : theme.colors.elevatedSurface,
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                }]}
              >
                <IdentityPickerGlyph accentKey={resolvedAccent} iconKey={key} />
                <Text numberOfLines={2} style={[theme.typography.caption, styles.centeredText, { color: theme.colors.text }]}>{iconLabel(key)}</Text>
              </Pressable>;
            })}
          </View>

          <IdentityDestinationRow icon="apps-outline" title="Symbol catalogue" value={draft.iconMode === 'automatic' ? 'Automatic' : draft.iconEmoji === null ? iconLabel(draft.iconSymbolKey) : 'Choose a symbol'} onPress={() => setView('symbols')} />
          <IdentityDestinationRow icon="happy-outline" title="Emoji" value={draft.iconMode === 'explicit' && draft.iconEmoji !== null ? draft.iconEmoji : 'Choose one emoji'} onPress={() => setView('emoji')} />
          <IdentityDestinationRow icon="color-palette-outline" title="Colour" value={draft.accentMode === 'automatic' ? 'Automatic' : accentLabel(draft.accentKey)} onPress={() => setView('colours')} />
          <Text style={[theme.typography.caption, styles.summaryText, { color: theme.colors.secondaryText }]}>{habitIdentitySummary(draft)}</Text>
        </ScrollView>
      </> : null}

      {view === 'symbols' ? <SymbolCatalogueView
        accentKey={resolvedAccent}
        selectedKey={draft.iconSymbolKey}
        selected={draft.iconMode === 'explicit' && draft.iconEmoji === null}
        onBack={() => setView('overview')}
        onSelect={(iconSymbolKey) => setDraft({ ...draft, iconMode: 'explicit', iconEmoji: null, iconSymbolKey })}
      /> : null}

      {view === 'emoji' ? <EmojiPickerView
        initialValue={draft.iconMode === 'explicit' ? draft.iconEmoji ?? '' : ''}
        onBack={() => setView('overview')}
        onUse={(iconEmoji) => {
          setDraft({ ...draft, iconMode: 'explicit', iconEmoji, iconSymbolKey: automaticIconKey });
          setView('overview');
        }}
      /> : null}

      {view === 'colours' ? <ColourCatalogueView
        automaticKey={automaticAccentKey}
        selectedKey={draft.accentKey}
        selectionMode={draft.accentMode}
        onBack={() => setView('overview')}
        onSelectAutomatic={() => setDraft({ ...draft, accentMode: 'automatic', accentKey: automaticAccentKey })}
        onSelect={(accentKey) => setDraft({ ...draft, accentMode: 'explicit', accentKey })}
      /> : null}
    </SafeAreaView>
  </Modal>;
}

function SymbolCatalogueView({ accentKey, selectedKey, selected, onBack, onSelect }: {
  readonly accentKey: PersistedHabitAccentKey;
  readonly selectedKey: RegisteredHabitSymbolKey;
  readonly selected: boolean;
  readonly onBack: () => void;
  readonly onSelect: (key: RegisteredHabitSymbolKey) => void;
}) {
  const theme = useLifePlannerTheme();
  const { width, fontScale } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HabitIconCategory | 'All'>('All');
  const options = useMemo(() => filterHabitIconOptions(query, category), [category, query]);
  const columns = width >= 430 && fontScale < 1.3 ? 4 : 3;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.catalogueLayout}>
    <SubpickerHeader title="Symbols" onBack={onBack} />
    <TextField label="Search symbols" placeholder="Water, study, timer…" returnKeyType="search" value={query} onChangeText={setQuery} />
    <ScrollView accessibilityLabel="Symbol categories" horizontal contentContainerStyle={styles.categoryRail} showsHorizontalScrollIndicator={false}>
      {(['All', ...HABIT_ICON_CATEGORIES] as const).map((item) => <Pressable
        key={item}
        accessibilityRole="radio"
        accessibilityState={{ checked: category === item }}
        onPress={() => setCategory(item)}
        style={({ pressed }) => [styles.category, {
          backgroundColor: category === item || pressed ? theme.colors.accentSubtle : 'transparent',
          borderColor: category === item ? theme.colors.accent : theme.colors.border,
        }]}
      ><Text style={[theme.typography.caption, { color: category === item ? theme.colors.accent : theme.colors.text }]}>{item}</Text></Pressable>)}
    </ScrollView>
    <FlatList
      key={`symbol-grid-${columns}`}
      accessibilityLabel="Habit symbol grid"
      columnWrapperStyle={styles.iconRow}
      contentContainerStyle={styles.iconGrid}
      data={options}
      initialNumToRender={18}
      keyExtractor={({ key }) => key}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<Text style={[theme.typography.body, styles.emptyIcons, { color: theme.colors.secondaryText }]}>No matching symbols.</Text>}
      numColumns={columns}
      renderItem={({ item }) => <IconCell accentKey={accentKey} option={item} selected={selected && selectedKey === item.key} onPress={() => onSelect(item.key)} />}
    />
  </KeyboardAvoidingView>;
}

function EmojiPickerView({ initialValue, onBack, onUse }: { readonly initialValue: string; readonly onBack: () => void; readonly onUse: (value: HabitEmoji) => void }) {
  const theme = useLifePlannerTheme();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const result = validateHabitEmojiInput(value, CANONICAL_EMOJI_INPUT_BOUNDARY);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    onUse(result.value);
  };
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.subpickerContent}>
    <SubpickerHeader title="Emoji" onBack={onBack} />
    <Text style={[theme.typography.body, { color: theme.colors.secondaryText }]}>Enter one emoji for this habit.</Text>
    <TextField autoFocus error={error ?? undefined} label="Emoji" onChangeText={(nextValue) => { setValue(nextValue); setError(null); }} placeholder="🌿" value={value} />
    <PrimaryButton title="Use emoji" onPress={submit} />
  </KeyboardAvoidingView>;
}

function ColourCatalogueView({ automaticKey, selectedKey, selectionMode, onBack, onSelectAutomatic, onSelect }: {
  readonly automaticKey: PersistedHabitAccentKey;
  readonly selectedKey: PersistedHabitAccentKey;
  readonly selectionMode: IdentitySelectionMode;
  readonly onBack: () => void;
  readonly onSelectAutomatic: () => void;
  readonly onSelect: (key: CanonicalHabitAccentKey) => void;
}) {
  const theme = useLifePlannerTheme();
  const { width, fontScale } = useWindowDimensions();
  const columns = width < 360 || fontScale >= 1.3 ? 3 : 4;
  return <View style={styles.catalogueLayout}>
    <SubpickerHeader title="Colour" onBack={onBack} />
    <ScrollView contentContainerStyle={styles.colourContent}>
      <Pressable
        accessibilityLabel={`Automatic colour, ${accentLabel(automaticKey)}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: selectionMode === 'automatic' }}
        onPress={onSelectAutomatic}
        style={({ pressed }) => [styles.choiceRow, {
          backgroundColor: pressed || selectionMode === 'automatic' ? theme.colors.accentSubtle : theme.colors.elevatedSurface,
          borderColor: selectionMode === 'automatic' ? theme.colors.accent : theme.colors.border,
        }]}
      >
        <View style={[styles.automaticSwatch, { backgroundColor: theme.habitAccents[automaticKey].selectedSwatch }]} />
        <View style={styles.flex}><Text style={[theme.typography.label, { color: theme.colors.text }]}>Automatic</Text><Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{accentLabel(automaticKey)} preview</Text></View>
        {selectionMode === 'automatic' ? <Ionicons color={theme.colors.accent} name="checkmark-circle" size={22} /> : null}
      </Pressable>
      <View accessibilityLabel="Habit colour palette" style={styles.swatchGrid}>
        {HABIT_ACCENT_OPTIONS.map(({ key, label }) => <AccentSwatchCell
          key={key}
          accentKey={key}
          columns={columns}
          label={label}
          selected={selectionMode === 'explicit' && selectedKey === key}
          onPress={() => onSelect(key)}
        />)}
      </View>
    </ScrollView>
  </View>;
}

function IdentityDestinationRow({ icon, title, value, onPress }: { readonly icon: React.ComponentProps<typeof Ionicons>['name']; readonly title: string; readonly value: string; readonly onPress: () => void }) {
  const theme = useLifePlannerTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.destinationRow, { backgroundColor: pressed ? theme.colors.accentSubtle : theme.colors.elevatedSurface, borderColor: theme.colors.border }]}>
    <Ionicons color={theme.colors.accent} name={icon} size={22} />
    <View style={styles.flex}><Text style={[theme.typography.label, { color: theme.colors.text }]}>{title}</Text><Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{value}</Text></View>
    <Ionicons accessibilityElementsHidden color={theme.colors.tertiaryText} name="chevron-forward" size={18} />
  </Pressable>;
}

function pickerIdentity(draft: HabitIdentityPickerDraft, automaticIconKey: RegisteredHabitSymbolKey): HabitIconIdentity {
  if (draft.iconMode === 'automatic') return Object.freeze({ kind: 'symbol', symbolKey: automaticIconKey });
  if (draft.iconEmoji !== null) return Object.freeze({ kind: 'emoji', emoji: draft.iconEmoji as HabitEmoji });
  return Object.freeze({ kind: 'symbol', symbolKey: draft.iconSymbolKey });
}

export function HabitAccentPicker({ title, selectedKey, selectionMode, automaticKey, iconKey, allowAutomatic = true, onCancel, onDone }: { readonly title: string; readonly selectedKey: HabitAccentKey; readonly selectionMode: IdentitySelectionMode; readonly automaticKey: HabitAccentKey; readonly iconKey: RegisteredHabitSymbolKey; readonly allowAutomatic?: boolean; readonly onCancel: () => void; readonly onDone: (selection: Readonly<{ mode: IdentitySelectionMode; key: HabitAccentKey }>) => void }) {
  const theme = useLifePlannerTheme();
  const [draftKey, setDraftKey] = useState(selectedKey);
  const [draftMode, setDraftMode] = useState(selectionMode);
  return <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
    <SafeAreaView accessibilityViewIsModal style={[styles.legacySheet, { backgroundColor: theme.colors.background }]}>
      <PickerHeader title="Choose colour" onCancel={onCancel} onDone={() => onDone({ mode: draftMode, key: draftMode === 'automatic' ? automaticKey : draftKey })} />
      <HabitVisualPreview title={title} iconKey={iconKey} accentKey={draftMode === 'automatic' ? automaticKey : draftKey} sampleProgress={0.38} />
      {allowAutomatic ? <SecondaryButton title={`Automatic · ${accentLabel(automaticKey)}`} onPress={() => { setDraftMode('automatic'); setDraftKey(automaticKey); }} /> : null}
      <View accessibilityLabel="Habit colour palette" style={styles.swatchGrid}>{HABIT_ACCENT_KEYS.map((key) => <AccentSwatchCell key={key} accentKey={key} columns={5} label={accentLabel(key)} selected={draftMode === 'explicit' && draftKey === key} onPress={() => { setDraftMode('explicit'); setDraftKey(key); }} />)}</View>
    </SafeAreaView>
  </Modal>;
}

export function HabitIconPicker({ title, selectedKey, selectionMode, automaticKey, accentKey, allowAutomatic = true, legacyOnly = false, onCancel, onDone }: { readonly title: string; readonly selectedKey: RegisteredHabitSymbolKey; readonly selectionMode: IdentitySelectionMode; readonly automaticKey: RegisteredHabitSymbolKey; readonly accentKey: PersistedHabitAccentKey; readonly allowAutomatic?: boolean; readonly legacyOnly?: boolean; readonly onCancel: () => void; readonly onDone: (selection: Readonly<{ mode: IdentitySelectionMode; key: RegisteredHabitSymbolKey }>) => void }) {
  const theme = useLifePlannerTheme();
  const [draftKey, setDraftKey] = useState(selectedKey);
  const [draftMode, setDraftMode] = useState(selectionMode);
  return <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
    <SafeAreaView accessibilityViewIsModal style={[styles.pickerSafeArea, { backgroundColor: theme.colors.background }]}>
      <PickerHeader title="Choose icon" onCancel={onCancel} onDone={() => onDone({ mode: draftMode, key: draftMode === 'automatic' ? automaticKey : draftKey })} />
      {allowAutomatic ? <View style={styles.legacyAutomatic}><SecondaryButton title={`Automatic · ${iconLabel(automaticKey)}`} onPress={() => { setDraftMode('automatic'); setDraftKey(automaticKey); }} /></View> : null}
      {legacyOnly ? <LegacySymbolGrid accentKey={accentKey} selectedKey={draftKey} selected={draftMode === 'explicit'} onSelect={(key) => { setDraftMode('explicit'); setDraftKey(key); }} /> : <SymbolCatalogueView accentKey={accentKey} selectedKey={draftKey} selected={draftMode === 'explicit'} onBack={onCancel} onSelect={(key) => { setDraftMode('explicit'); setDraftKey(key); }} />}
    </SafeAreaView>
  </Modal>;
}

function LegacySymbolGrid({ accentKey, selectedKey, selected, onSelect }: { readonly accentKey: PersistedHabitAccentKey; readonly selectedKey: RegisteredHabitSymbolKey; readonly selected: boolean; readonly onSelect: (key: RegisteredHabitSymbolKey) => void }) {
  const options = filterHabitIconOptions('', 'All').filter(({ key }) => HABIT_ICON_KEYS.includes(key as (typeof HABIT_ICON_KEYS)[number]));
  return <FlatList contentContainerStyle={styles.iconGrid} data={options} keyExtractor={({ key }) => key} numColumns={3} renderItem={({ item }) => <IconCell accentKey={accentKey} option={item} selected={selected && selectedKey === item.key} onPress={() => onSelect(item.key)} />} />;
}

function PickerHeader({ title, onCancel, onDone }: { readonly title: string; readonly onCancel: () => void; readonly onDone: () => void }) {
  const theme = useLifePlannerTheme();
  return <View style={styles.header}><SecondaryButton title="Cancel" onPress={onCancel} /><Text accessibilityRole="header" style={[theme.typography.headline, { color: theme.colors.text }]}>{title}</Text><PrimaryButton title="Done" onPress={onDone} /></View>;
}

function SubpickerHeader({ title, onBack }: { readonly title: string; readonly onBack: () => void }) {
  const theme = useLifePlannerTheme();
  return <View style={styles.subpickerHeader}><Pressable accessibilityLabel={`Back to identity overview`} accessibilityRole="button" onPress={onBack} style={styles.backAction}><Ionicons color={theme.colors.accent} name="chevron-back" size={24} /></Pressable><Text accessibilityRole="header" style={[theme.typography.headline, styles.subpickerTitle, { color: theme.colors.text }]}>{title}</Text><View style={styles.backAction} /></View>;
}

function AccentSwatchCell({ accentKey, label, columns, selected, onPress }: { readonly accentKey: PersistedHabitAccentKey; readonly label: string; readonly columns: number; readonly selected: boolean; readonly onPress: () => void }) {
  const theme = useLifePlannerTheme();
  const [focused, setFocused] = useState(false);
  const accent = theme.habitAccents[accentKey];
  return <Pressable accessibilityLabel={`${label} colour`} accessibilityRole="radio" accessibilityState={{ checked: selected }} focusable onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={onPress} style={[styles.swatchTarget, { width: `${100 / columns}%` }]}>
    <View style={[styles.swatch, { backgroundColor: accent.selectedSwatch, borderColor: selected || focused ? theme.colors.focus : accent.border, borderWidth: selected || focused ? 3 : 1 }]}>{selected ? <Ionicons color={theme.colors.onAccent} name="checkmark" size={22} /> : null}</View>
    <Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{label}</Text>
  </Pressable>;
}

function IconCell({ option, selected, accentKey, onPress }: { readonly option: HabitIconOption; readonly selected: boolean; readonly accentKey: PersistedHabitAccentKey; readonly onPress: () => void }) {
  const theme = useLifePlannerTheme();
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityLabel={option.label} accessibilityRole="radio" accessibilityState={{ checked: selected }} focusable onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={onPress} style={({ pressed }) => [styles.iconCell, { backgroundColor: selected || pressed ? theme.colors.accentSubtle : theme.colors.elevatedSurface, borderColor: selected || focused ? theme.colors.focus : theme.colors.border }]}>
    <IdentityPickerGlyph accentKey={accentKey} iconKey={option.key} />
    <Text numberOfLines={2} style={[theme.typography.caption, styles.centeredText, { color: theme.colors.text }]}>{option.label}</Text>
    {selected ? <Ionicons accessibilityElementsHidden color={theme.colors.accent} name="checkmark-circle" size={18} style={styles.iconCheck} /> : null}
  </Pressable>;
}

function IdentityPickerGlyph({ accentKey, iconKey }: { readonly accentKey: PersistedHabitAccentKey; readonly iconKey: RegisteredHabitSymbolKey }) {
  const theme = useLifePlannerTheme();
  const accent = theme.habitAccents[accentKey];
  const icon = habitIconography(iconKey, accentKey);
  return <HabitIdentityIcon backgroundColor={accent.iconBackground} foregroundColor={accent.iconForeground} icon={icon.icon} seed={iconKey} />;
}

const styles = StyleSheet.create({
  pickerSafeArea: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 60, paddingHorizontal: 16 },
  overviewContent: { gap: 12, padding: 16, paddingBottom: 32 },
  choiceRow: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 56, padding: 10 },
  flex: { flex: 1, minWidth: 0 },
  recommendedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recommendedCell: { alignItems: 'center', borderRadius: 12, borderWidth: 1, gap: 4, justifyContent: 'center', minHeight: 82, padding: 6, width: '23%' },
  centeredText: { textAlign: 'center' },
  destinationRow: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 6 },
  summaryText: { textAlign: 'center' },
  catalogueLayout: { flex: 1, gap: 10, minHeight: 0, paddingHorizontal: 16 },
  subpickerContent: { flex: 1, gap: 16, paddingHorizontal: 16 },
  subpickerHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 56 },
  subpickerTitle: { flex: 1, textAlign: 'center' },
  backAction: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  categoryRail: { gap: 6, paddingBottom: 2 },
  category: { alignItems: 'center', borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 44, minWidth: 44, paddingHorizontal: 12 },
  iconGrid: { flexGrow: 1, gap: 8, paddingBottom: 32 },
  iconRow: { gap: 8 },
  iconCell: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flex: 1, gap: 4, justifyContent: 'center', minHeight: 88, padding: 6, position: 'relative' },
  iconCheck: { position: 'absolute', right: 4, top: 4 },
  emptyIcons: { alignSelf: 'center', marginTop: 24, textAlign: 'center' },
  colourContent: { gap: 12, paddingBottom: 32 },
  automaticSwatch: { borderRadius: 14, height: 28, width: 28 },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  swatchTarget: { alignItems: 'center', gap: 3, justifyContent: 'center', minHeight: 76 },
  swatch: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  legacySheet: { flex: 1, gap: 12, padding: 16 },
  legacyAutomatic: { paddingHorizontal: 16 },
});
