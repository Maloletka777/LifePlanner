import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { HabitIconIdentity, PersistedHabitAccentKey, RegisteredHabitSymbolKey } from '@/src/features/planner';
import { HabitIdentityIcon } from '@/src/ui/components';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { habitIconography } from './planner-iconography';

interface HabitSurfaceProps {
  readonly accentKey: PersistedHabitAccentKey;
  readonly displayProgress?: number | null;
  readonly variant?: 'root' | 'child';
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityLabel?: string;
  readonly contentStyle?: ViewStyle;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
}

export function HabitSurface({ accentKey, displayProgress = null, variant = 'root', style, accessibilityLabel, contentStyle, onLayout, children }: PropsWithChildren<HabitSurfaceProps>) {
  const theme = useLifePlannerTheme();
  const accent = theme.habitAccents[accentKey];
  const progress = boundedDisplayProgress(displayProgress);
  const animatedProgress = useRef(new Animated.Value(progress ?? 0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const next = progress ?? 0;
    if (reduceMotion) {
      animatedProgress.setValue(next);
      return;
    }
    // A transform, not a width. Today renders its own rows, so the Planner fix
    // never reached this surface and the fill kept climbing in steps here.
    Animated.timing(animatedProgress, {
      duration: theme.motion.progress,
      toValue: next,
      useNativeDriver: true,
    }).start();
  }, [animatedProgress, progress, reduceMotion, theme.motion.progress]);

  const percentage = progress === null ? null : Math.round(progress * 100);
  return <View
    accessibilityLabel={accessibilityLabel === undefined ? undefined : `${accessibilityLabel}${percentage === null ? '' : `, ${percentage}% progress`}`}
    onLayout={onLayout}
    style={[
      styles.surface,
      {
        backgroundColor: variant === 'child' ? accent.childSurface : accent.surface,
        borderColor: accent.border,
        borderRadius: theme.radii.xl,
      },
      style,
    ]}
  >
    {progress === null ? null : <Animated.View
      accessibilityElementsHidden
      pointerEvents="none"
      style={[
        styles.progressFill,
        {
          backgroundColor: accent.progressSurface,
          transform: [{ scaleX: animatedProgress }],
        },
      ]}
    />}
    <View style={[styles.content, contentStyle]}>{children}</View>
  </View>;
}

export function HabitVisualPreview({ title, target, iconKey, iconIdentity, accentKey, sampleProgress = 0, trailing }: { readonly title: string; readonly target?: string | null; readonly iconKey?: RegisteredHabitSymbolKey; readonly iconIdentity?: HabitIconIdentity; readonly accentKey: PersistedHabitAccentKey; readonly sampleProgress?: number | null; readonly trailing?: ReactNode }) {
  const theme = useLifePlannerTheme();
  const accent = theme.habitAccents[accentKey];
  const resolvedIdentity = iconIdentity ?? { kind: 'symbol' as const, symbolKey: iconKey ?? 'habit_generic' };
  const resolvedTitle = title.trim() || 'Habit name';
  return <View style={{ gap: theme.spacing.xs }}>
    <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>Live preview</Text>
    <HabitSurface
      accessibilityLabel={`Habit preview, ${resolvedTitle}${target ? `, ${target}` : ''}`}
      accentKey={accentKey}
      displayProgress={sampleProgress}
      contentStyle={styles.previewContent}
    >
      <HabitIdentityMark accessibilityLabel={`${resolvedTitle} identity`} accentKey={accentKey} iconIdentity={resolvedIdentity} seed={resolvedTitle} />
      <View style={styles.previewText}>
        <Text numberOfLines={2} style={[theme.typography.headline, { color: theme.colors.text }]}>{resolvedTitle}</Text>
        {target ? <Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{target}</Text> : null}
      </View>
      {trailing ?? <View accessibilityElementsHidden style={[styles.previewControl, { borderColor: accent.border }]} />}
    </HabitSurface>
  </View>;
}

export function HabitIdentityMark({
  iconIdentity,
  accentKey,
  seed,
  child = false,
  marker = false,
  size,
  accessibilityLabel,
  tileBackground,
}: {
  readonly iconIdentity: HabitIconIdentity | null | undefined;
  readonly accentKey: PersistedHabitAccentKey;
  readonly seed: string;
  readonly child?: boolean;
  readonly marker?: boolean;
  /** Explicit tile size; management uses 34 pt. Omitted keeps 40 pt, or 28 pt for a child. */
  readonly size?: number;
  readonly accessibilityLabel?: string;
  /** Overrides the tile fill; a row already filled with the accent needs a lighter tile. */
  readonly tileBackground?: string;
}) {
  const theme = useLifePlannerTheme();
  const accent = theme.habitAccents[accentKey];
  const candidate = iconIdentity as Readonly<{ kind?: unknown; symbolKey?: unknown; emoji?: unknown }> | null | undefined;
  const exactEmoji = candidate?.kind === 'emoji' && typeof candidate.emoji === 'string' && candidate.emoji.length > 0
    ? candidate.emoji
    : null;
  const symbolKey = candidate?.kind === 'symbol' && typeof candidate.symbolKey === 'string'
    ? candidate.symbolKey as RegisteredHabitSymbolKey
    : 'habit_generic';
  const icon = habitIconography(symbolKey, accentKey);
  const spokenIdentity = exactEmoji === null ? accessibilityLabel : `${accessibilityLabel ?? 'Habit'}, emoji ${exactEmoji}`;
  if (marker) {
    return <View accessible={spokenIdentity !== undefined} accessibilityLabel={spokenIdentity} style={styles.markerIdentity}>
      {exactEmoji === null
        ? <Ionicons accessibilityElementsHidden color={accent.iconForeground} name={icon.icon} size={7} />
        : <Text accessibilityElementsHidden maxFontSizeMultiplier={1} style={styles.markerEmoji}>{exactEmoji}</Text>}
    </View>;
  }
  if (exactEmoji === null) {
    return <View accessible={spokenIdentity !== undefined} accessibilityLabel={spokenIdentity}>
      <HabitIdentityIcon backgroundColor={tileBackground ?? accent.iconBackground} child={child} foregroundColor={accent.iconForeground} icon={icon.icon} seed={seed} size={size} />
    </View>;
  }
  const box = size ?? (child ? 28 : 40);
  return <View
    accessible
    accessibilityLabel={spokenIdentity}
    style={[
      styles.emojiIdentity,
      {
        backgroundColor: tileBackground ?? accent.iconBackground,
        borderRadius: Math.round(box * 0.325),
        height: box,
        width: box,
      },
    ]}
  >
    <Text accessibilityElementsHidden allowFontScaling={false} style={[styles.emojiGlyph, child ? styles.childEmojiGlyph : null, size === undefined ? null : { fontSize: Math.round(size * 0.6), lineHeight: Math.round(size * 0.75) }]}>{exactEmoji}</Text>
  </View>;
}

export function HabitGroupSurface({ accentKey, displayProgress = null, accessibilityLabel, root, style, onLayout, children }: PropsWithChildren<{ readonly accentKey: PersistedHabitAccentKey; readonly displayProgress?: number | null; readonly accessibilityLabel?: string; readonly root: ReactNode; readonly style?: StyleProp<ViewStyle>; readonly onLayout?: (event: LayoutChangeEvent) => void }>) {
  const theme = useLifePlannerTheme();
  const accent = theme.habitAccents[accentKey];
  return <HabitSurface accessibilityLabel={accessibilityLabel} accentKey={accentKey} contentStyle={styles.groupContent} displayProgress={displayProgress} onLayout={onLayout} style={style}>
    {root}
    {children === null || children === undefined ? null : <View style={[styles.groupChildren, { borderLeftColor: accent.border, marginLeft: theme.spacing.md, paddingLeft: theme.spacing.xs }]}>{children}</View>}
  </HabitSurface>;
}

export function boundedDisplayProgress(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

const styles = StyleSheet.create({
  surface: { borderWidth: 1, overflow: 'hidden', position: 'relative' },
  progressFill: { right: 0, transformOrigin: 'left', bottom: 0, left: 0, position: 'absolute', top: 0 },
  content: { position: 'relative' },
  previewContent: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 72, padding: 12 },
  previewText: { flex: 1, gap: 2, minWidth: 0 },
  previewControl: { borderRadius: 18, borderWidth: 1.5, height: 36, width: 36 },
  emojiIdentity: { alignItems: 'center', justifyContent: 'center' },
  emojiGlyph: { fontSize: 24, lineHeight: 30, textAlign: 'center' },
  childEmojiGlyph: { fontSize: 17, lineHeight: 21 },
  markerIdentity: { alignItems: 'center', height: 9, justifyContent: 'center', width: 9 },
  markerEmoji: { fontSize: 7, lineHeight: 8, textAlign: 'center' },
  groupContent: { gap: 0 },
  groupChildren: { borderLeftWidth: 2, overflow: 'hidden' },
});
