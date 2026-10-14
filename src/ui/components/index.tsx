import Ionicons from '@expo/vector-icons/Ionicons';
import { type PropsWithChildren, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type ViewStyle,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';

import { useLifePlannerTheme } from '@/src/ui/theme';

import { BOTTOM_LAYER_BANDS, bottomLayerAlpha, colorWithAlpha, type BottomLayerCurve } from './bottom-layer';

export { BOTTOM_LAYER_BANDS, BOTTOM_LAYER_CURVES, bottomLayerAlpha, colorWithAlpha, type BottomLayerCurve } from './bottom-layer';
export { TravellingSegment, type TravellingSegmentSlot } from './travelling-segment';

export function Screen({
  children,
  scroll = true,
  contentStyle,
  backgroundColor,
  onScrollBeginDrag,
  scrollRef,
}: PropsWithChildren<{
  readonly scroll?: boolean;
  readonly contentStyle?: ViewStyle;
  /** Overrides the shared screen ground. Today passes its own sage surface. */
  readonly backgroundColor?: string;
  readonly onScrollBeginDrag?: () => void;
  readonly scrollRef?: RefObject<ScrollView | null>;
}>) {
  const theme = useLifePlannerTheme();
  const content = scroll ? (
    <ScrollView
      ref={scrollRef}
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      contentContainerStyle={[
        styles.screenContent,
        {
          gap: theme.layout.screen.contentGap,
          paddingHorizontal: theme.layout.screen.inlinePadding,
          paddingVertical: theme.spacing.md,
        },
        contentStyle,
      ]}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="never"
      onScrollBeginDrag={onScrollBeginDrag}
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.screenContent,
        {
          paddingHorizontal: theme.layout.screen.inlinePadding,
          paddingVertical: theme.spacing.md,
        },
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: backgroundColor ?? theme.colors.background }]}
    >
      {content}
    </SafeAreaView>
  );
}

export interface SwipeRowAction {
  readonly name: string;
  readonly label: string;
  readonly icon: React.ComponentProps<typeof Ionicons>['name'];
  readonly tone?: 'default' | 'danger';
  readonly onPress: () => void;
  readonly disabled?: boolean;
}

/**
 * How far the keys settle over the last of the reveal, in points.
 *
 * Small on purpose: the row is the mask, so the travel is a finishing move rather
 * than the reveal itself. More than this and the keys visibly lag the finger.
 */
const SWIPE_KEY_SETTLE = 14;

/**
 * The row travels exactly as far as the finger does.
 *
 * `Swipeable` divides the drag by `friction`, so the 2 this carried moved the plate
 * **half** the distance the finger did — which is not a slow reveal but a row that is
 * never under the finger, and it reads as lag. 1 is the library's own default and the
 * only value at which the plate is the thing being dragged rather than a thing
 * responding to a drag.
 */
const SWIPE_FRICTION = 1;

/**
 * How far the finger travels before the row starts moving.
 *
 * The library's default is 10, which the vertical scroll needs so a diagonal drag is
 * not stolen — but 10 pt of dead travel is felt as a pause before the plate answers.
 * 8 keeps the axis honest and takes 2 pt off the wait.
 */
const SWIPE_ACTIVATION = 8;

export function SwipeActionRow({ rowId, openRowId, onOpen, actions, appearance = 'bar', children }: PropsWithChildren<{ readonly rowId: string; readonly openRowId: string | null; readonly onOpen: (rowId: string | null) => void; readonly actions: readonly SwipeRowAction[];
  /** `cards` matches a list whose rows are separate cards: 56 pt keys, radius 18. */
  readonly appearance?: 'bar' | 'cards' }>) {
  const theme = useLifePlannerTheme();
  const swipeable = useRef<Swipeable>(null);
  const cards = appearance === 'cards';
  useEffect(() => { if (openRowId !== rowId) swipeable.current?.close(); }, [openRowId, rowId]);
  /**
   * The keys are revealed by the row sliding off them, and they ease in as it goes.
   *
   * **Two things were wrong and they compounded.** `Swipeable` parks its action
   * container at `translateX: -10000` and puts it back at `0` the instant the drag
   * leaves zero — `inputRange: [0, Number.MIN_VALUE]`, a switch rather than a
   * reveal — because the library expects the caller to animate the reveal from the
   * `progress` value it passes in. This one ignored it. And the row it wraps had
   * **no ground of its own**: on a list whose card is one per section rather than one
   * per row, the keys were therefore visible *through* the row. Together that is the
   * defect: all three appeared at the first pixel of movement, before the row had
   * gone anywhere.
   *
   * The ground is what fixes it — an opaque row is the mask, so the keys are
   * uncovered in order from the right edge as it travels. `progress` then carries the
   * polish: they fade and settle the last few points rather than being switched on.
   */
  const ground = cards ? theme.today.dashboardSurface : theme.colors.surface;
  /**
   * What the keys stand on once the row has slid off them.
   *
   * The row uncovers whatever is behind it, and on a list whose card is one per
   * section (PD-MANAGE-011) that is the **card's own surface** — so the keys came to
   * rest on a pale slab that read as a second plate rather than as the page. They
   * belong on the screen's ground, which is what a key floating beside a card sits
   * on everywhere else.
   */
  const behind = cards ? theme.today.appSurface : 'transparent';
  return <Swipeable ref={swipeable} overshootRight={false} dragOffsetFromRightEdge={SWIPE_ACTIVATION} friction={SWIPE_FRICTION} rightThreshold={44} useNativeAnimations onSwipeableOpen={() => onOpen(rowId)} onSwipeableClose={() => { if (openRowId === rowId) onOpen(null); }} renderRightActions={(progress) => <Animated.View style={[styles.swipeActions, cards ? styles.swipeActionCards : null, { backgroundColor: behind, opacity: progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }), transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [SWIPE_KEY_SETTLE, 0], extrapolate: 'clamp' }) }] }]}>{actions.map((action) => <Pressable key={action.name} accessibilityRole="button" accessibilityLabel={action.label} accessibilityState={{ disabled: action.disabled }} disabled={action.disabled} onPress={() => { swipeable.current?.close(); action.onPress(); }} style={[styles.swipeAction, cards ? [styles.swipeActionCard, { borderColor: action.tone === 'danger' ? 'transparent' : theme.today.hairline }] : null, { backgroundColor: action.tone === 'danger' ? theme.colors.danger : theme.colors.elevatedSurface, opacity: action.disabled ? 0.62 : 1 }]}><Ionicons color={action.tone === 'danger' ? theme.today.onAccent : theme.colors.text} name={action.icon} size={cards ? 18 : 20} /><Text style={[cards ? styles.swipeActionCardLabel : theme.typography.caption, { color: action.tone === 'danger' ? theme.today.onAccent : theme.colors.text }]}>{action.label}</Text></Pressable>)}</Animated.View>}>
    <View accessible accessibilityActions={actions.filter(({ disabled }) => !disabled).map(({ name, label }) => ({ name, label }))} onAccessibilityAction={(event) => actions.find(({ name, disabled }) => !disabled && name === event.nativeEvent.actionName)?.onPress()} style={{ backgroundColor: ground }}>{children}</View>
  </Swipeable>;
}

export function AppHeader({
  title,
  subtitle,
  leading,
  trailing,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
}) {
  const theme = useLifePlannerTheme();
  const { fontScale, width } = useWindowDimensions();
  const stackContent = trailing !== undefined && (fontScale >= 1.3 || width < 360);
  return (
    <View
      style={[
        styles.header,
        {
          alignItems: stackContent ? 'flex-start' : 'center',
          flexDirection: stackContent ? 'column' : 'row',
          gap: theme.spacing.sm,
          minHeight: theme.layout.header.minimumHeight,
        },
      ]}
      accessibilityRole="header"
    >
      {leading === undefined ? null : <View>{leading}</View>}
      <View style={styles.headerText}>
        <Text style={[theme.typography.title, { color: theme.colors.text }]}>{title}</Text>
        {subtitle === undefined ? null : (
          <Text style={[theme.typography.callout, { color: theme.colors.secondaryText }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing === undefined ? null : (
        <View style={stackContent ? styles.stackedHeaderTrailing : undefined}>{trailing}</View>
      )}
    </View>
  );
}

export function Card({
  children,
  accessibilityLabel,
  style,
}: PropsWithChildren<{ readonly accessibilityLabel?: string; readonly style?: ViewStyle }>) {
  const theme = useLifePlannerTheme();
  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      style={[{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderRadius: theme.components.card.radius,
        borderWidth: StyleSheet.hairlineWidth,
        gap: theme.components.card.gap,
        padding: theme.components.card.padding,
      }, style]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({ title, action }: { readonly title: string; readonly action?: ReactNode }) {
  const theme = useLifePlannerTheme();
  return (
    <View
      style={[styles.sectionHeader, { minHeight: theme.layout.control.minimumTouchTarget }]}
      accessibilityRole="header"
    >
      <Text style={[theme.typography.headline, { color: theme.colors.text, flex: 1 }]}>{title}</Text>
      {action}
    </View>
  );
}

interface ButtonProps {
  readonly title: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
}

export function DestructiveButton({ title, onPress, disabled = false, accessibilityHint }: ButtonProps) {
  const theme = useLifePlannerTheme();
  return (
    <Pressable accessibilityHint={accessibilityHint} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: pressed ? theme.colors.danger : 'transparent', borderColor: theme.colors.danger, borderRadius: theme.components.button.radius, borderWidth: 1, minHeight: theme.layout.control.standardHeight, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }]}>
      <Text style={[theme.typography.headline, { color: theme.colors.danger, textAlign: 'center' }]}>{title}</Text>
    </Pressable>
  );
}

export function PrimaryButton({ title, onPress, disabled = false, accessibilityHint }: ButtonProps) {
  const theme = useLifePlannerTheme();
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        [
          styles.button,
          {
            minHeight: theme.layout.control.standardHeight,
            paddingHorizontal: theme.components.button.horizontalPadding,
            paddingVertical: theme.components.button.verticalPadding,
          },
        ],
        {
          backgroundColor: disabled
            ? theme.colors.disabled
            : pressed
              ? theme.colors.accentPressed
              : theme.colors.accent,
          borderRadius: theme.components.button.radius,
        },
      ]}
    >
      <Text style={[theme.typography.headline, { color: theme.colors.onAccent, textAlign: 'center' }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled = false, accessibilityHint }: ButtonProps) {
  const theme = useLifePlannerTheme();
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        [
          styles.button,
          {
            minHeight: theme.layout.control.standardHeight,
            paddingHorizontal: theme.components.button.horizontalPadding,
            paddingVertical: theme.components.button.verticalPadding,
          },
        ],
        {
          backgroundColor: pressed ? theme.colors.accentSubtle : 'transparent',
          borderColor: disabled ? theme.colors.disabled : theme.colors.strongBorder,
          borderRadius: theme.components.button.radius,
          borderWidth: 1,
        },
      ]}
    >
      <Text
        style={[
          theme.typography.headline,
          { color: disabled ? theme.colors.disabled : theme.colors.accent, textAlign: 'center' },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  readonly icon: React.ComponentProps<typeof Ionicons>['name'];
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  const theme = useLifePlannerTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          height: theme.layout.control.minimumTouchTarget,
          width: theme.layout.control.minimumTouchTarget,
        },
        {
          backgroundColor: pressed ? theme.colors.accentSubtle : 'transparent',
          borderRadius: theme.radii.pill,
        },
      ]}
    >
      <Ionicons
        color={disabled ? theme.colors.disabled : theme.colors.accent}
        name={icon}
        size={24}
      />
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  help,
  onEditDone,
  ...inputProps
}: TextInputProps & {
  readonly label: string;
  readonly error?: string;
  readonly help?: string;
  readonly onEditDone?: () => boolean | void;
}) {
  const theme = useLifePlannerTheme();
  const [focused, setFocused] = useState(false);
  const initialValue = useRef(inputProps.value?.toString() ?? '');
  const accessoryId = `lifeplanner-field-${useId().replace(/:/g, '')}`;
  const cancelEdit = () => {
    inputProps.onChangeText?.(initialValue.current);
    Keyboard.dismiss();
    setFocused(false);
  };
  const finishEdit = () => {
    if (onEditDone?.() === false) return;
    Keyboard.dismiss();
    setFocused(false);
  };
  const accessory = <KeyboardAccessoryBar onCancel={cancelEdit} onDone={finishEdit} />;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? help}
        accessibilityState={{ disabled: inputProps.editable === false }}
        inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
        placeholderTextColor={theme.colors.tertiaryText}
        selectionColor={theme.colors.accent}
        {...inputProps}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        onFocus={(event) => {
          initialValue.current = inputProps.value?.toString() ?? '';
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        style={[
          styles.textInput,
          theme.typography.body,
          {
            backgroundColor: theme.colors.inputSurface,
            borderColor: error !== undefined
              ? theme.colors.danger
              : focused
                ? theme.colors.focus
                : theme.colors.border,
            borderRadius: theme.components.input.radius,
            borderWidth: focused ? 2 : 1,
            color: theme.colors.text,
            minHeight: theme.layout.control.standardHeight,
            paddingHorizontal: theme.components.input.horizontalPadding,
            paddingVertical: theme.components.input.verticalPadding,
          },
          inputProps.multiline
            ? [styles.multilineInput, { minHeight: theme.components.input.multilineMinimumHeight }]
            : null,
          inputProps.style,
        ]}
      />
      {Platform.OS === 'ios' ? <InputAccessoryView nativeID={accessoryId}>{accessory}</InputAccessoryView> : focused ? accessory : null}
      {error === undefined ? null : <InlineError message={error} />}
      {help === undefined ? null : (
        <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{help}</Text>
      )}
    </View>
  );
}

export function KeyboardAccessoryBar({ onCancel, onDone }: { readonly onCancel: () => void; readonly onDone: () => void }) {
  const theme = useLifePlannerTheme();
  return <View style={[styles.keyboardAccessory, { backgroundColor: theme.colors.materialSurface, borderTopColor: theme.colors.border }]}><Pressable accessibilityRole="button" onPress={onCancel} style={styles.keyboardAccessoryAction}><Text style={[theme.typography.label, { color: theme.colors.secondaryText }]}>Cancel</Text></Pressable><Pressable accessibilityRole="button" onPress={onDone} style={styles.keyboardAccessoryAction}><Text style={[theme.typography.label, { color: theme.colors.accent }]}>Done</Text></Pressable></View>;
}

export function HabitIdentityIcon({ seed, icon, child = false, size: sizeOverride, backgroundColor, foregroundColor }: { readonly seed: string; readonly icon: React.ComponentProps<typeof Ionicons>['name']; readonly child?: boolean; readonly size?: number; readonly backgroundColor?: string; readonly foregroundColor?: string }) {
  const theme = useLifePlannerTheme();
  // The fallback palette comes from the habit accents, which already switch
  // families with the ground, so a mark with no stored accent is never a pastel
  // tile on a midnight screen.
  const palettes = theme.identityFallbacks;
  const hash = Array.from(seed).reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 0);
  const palette = backgroundColor !== undefined && foregroundColor !== undefined
    ? [backgroundColor, foregroundColor] as const
    : palettes[hash % palettes.length]!;
  const size = child ? 28 : 40;
  // Management asks for a 34 pt mark. The ratios reproduce both original sizes
  // exactly (40 → 13/20, 28 → 9/14), so no existing surface shifts.
  const box = sizeOverride ?? size;
  return <View accessibilityElementsHidden style={{ alignItems: 'center', backgroundColor: palette[0], borderRadius: Math.round(box * 0.325), height: box, justifyContent: 'center', width: box }}><Ionicons color={palette[1]} name={icon} size={Math.round(box * 0.5)} /></View>;
}

/**
 * The bottom-layer rule.
 *
 * The screen ground runs to the very bottom and a floating control sits above it
 * on a cushion of gradient and shadow. Content passes underneath and dissolves —
 * there is no opaque bar and no cut-off line where the ground stops.
 *
 * The scrim is stacked bands rather than a real gradient because no gradient
 * library is a dependency of this project and adding one is not authorised. Over
 * a low-contrast fade the banding is not visible.
 */
export function BottomActionLayer({ groundColor, height = 150, inset = 16, bottom = 46, curve = 'cta', children }: PropsWithChildren<{
  readonly groundColor: string;
  /** 150 for an action panel, 132 for a single button, per the design. */
  readonly height?: number;
  readonly inset?: number;
  readonly bottom?: number;
  readonly curve?: BottomLayerCurve;
}>) {
  return <>
    <BottomScrim curve={curve} groundColor={groundColor} height={height} />
    <View style={[styles.bottomLayerContent, { bottom, left: inset, right: inset }]}>{children}</View>
  </>;
}

/**
 * The cushion on its own, for a screen whose floating element is owned by someone
 * else — the tab bar capsule belongs to the navigator, not to the screen.
 */
export function BottomScrim({ groundColor, height = 150, curve = 'screen' }: { readonly groundColor: string; readonly height?: number; readonly curve?: BottomLayerCurve }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[styles.bottomScrim, { height }]}>
    {Array.from({ length: BOTTOM_LAYER_BANDS }, (_, index) => <View
      key={index}
      style={{ backgroundColor: colorWithAlpha(groundColor, bottomLayerAlpha((index + 0.5) / BOTTOM_LAYER_BANDS, curve)), flex: 1 }}
    />)}
  </View>;
}

export function FloatingActionBar({ onToday, onManage, onAdd }: { readonly onToday: () => void; readonly onManage: () => void; readonly onAdd: () => void }) {
  const theme = useLifePlannerTheme();
  const action = (label: string, icon: React.ComponentProps<typeof Ionicons>['name'], onPress: () => void, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.floatingBarAction, { backgroundColor: primary ? (pressed ? theme.colors.accentPressed : theme.colors.accent) : pressed ? theme.colors.accentSubtle : 'transparent' }]}><Ionicons name={icon} size={22} color={primary ? theme.colors.onAccent : theme.colors.accent} /><Text style={[theme.typography.caption, { color: primary ? theme.colors.onAccent : theme.colors.text }]}>{label}</Text></Pressable>;
  return <View style={[styles.floatingBar, { backgroundColor: theme.colors.materialSurface, borderColor: theme.colors.border, shadowColor: theme.colors.shadow }, theme.elevation.raised]}>{action('Today', 'today-outline', onToday)}{action('Manage', 'list-outline', onManage)}{action('Add', 'add', onAdd, true)}</View>;
}

export function NumberField({
  keyboardType = 'number-pad',
  ...props
}: React.ComponentProps<typeof TextField>) {
  return <TextField {...props} keyboardType={keyboardType} selectTextOnFocus />;
}

export function SelectionRow({
  title,
  description,
  selected,
  onPress,
  disabled = false,
}: {
  readonly title: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  const theme = useLifePlannerTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: selected || pressed ? theme.colors.accentSubtle : theme.colors.surface,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        borderRadius: theme.radii.md,
        borderWidth: selected ? 2 : 1,
        flexDirection: 'row',
        gap: theme.spacing.sm,
        minHeight: theme.layout.control.rowHeight,
        padding: theme.spacing.sm,
      })}
    >
      <Ionicons
        color={disabled ? theme.colors.disabled : selected ? theme.colors.accent : theme.colors.secondaryText}
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={24}
      />
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <Text style={[theme.typography.body, { color: disabled ? theme.colors.disabled : theme.colors.text }]}>
          {title}
        </Text>
        {description === undefined ? null : (
          <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>
            {description}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function StatusLabel({
  label,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const theme = useLifePlannerTheme();
  const toneColor = {
    neutral: theme.colors.secondaryText,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
    info: theme.colors.info,
  }[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderColor: toneColor,
        borderRadius: theme.components.status.radius,
        borderWidth: 1,
        paddingHorizontal: theme.components.status.horizontalPadding,
        paddingVertical: theme.components.status.verticalPadding,
      }}
    >
      <Text style={[theme.typography.caption, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

export function DirectProgress({ completed, total, label = 'Daily progress' }: { readonly completed: number; readonly total: number; readonly label?: string }) {
  const theme = useLifePlannerTheme();
  const fraction = total === 0 ? 0 : Math.max(0, Math.min(1, completed / total));
  return (
    <View accessible accessibilityLabel={`${label}: ${completed} of ${total}`} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: completed, text: total === 0 ? 'Nothing scheduled' : `${completed} of ${total}` }} style={{ gap: theme.spacing.xs }}>
      <View style={styles.progressHeader}><Text style={[theme.typography.progress, { color: theme.colors.text }]}>{total === 0 ? 'Nothing scheduled' : `${completed} of ${total}`}</Text><Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{label}</Text></View>
      <View style={[styles.progressTrack, { backgroundColor: theme.colors.progressTrack }]}><View style={[styles.progressFill, { backgroundColor: theme.colors.progressFill, width: `${fraction * 100}%` }]} /></View>
    </View>
  );
}

export function DashboardCard({ title, icon, children, action, style }: PropsWithChildren<{ readonly title: string; readonly icon?: React.ComponentProps<typeof Ionicons>['name']; readonly action?: ReactNode; readonly style?: ViewStyle }>) {
  const theme = useLifePlannerTheme();
  return <Card style={style}><View style={[styles.dashboardHeader, { gap: theme.spacing.sm }]}>{icon === undefined ? null : <View style={[styles.dashboardIcon, { backgroundColor: theme.colors.accentSubtle }]}><Ionicons name={icon} size={theme.iconSizes.row} color={theme.colors.plannerAccent} /></View>}<Text numberOfLines={1} style={[theme.typography.sectionTitle, { color: theme.colors.text, flex: 1, flexShrink: 1 }]}>{title}</Text>{action}</View>{children}</Card>;
}

export function FloatingActionButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const theme = useLifePlannerTheme();
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.floatingAction, { backgroundColor: pressed ? theme.colors.accentPressed : theme.colors.accent, borderRadius: theme.radii.pill, shadowColor: theme.colors.shadow }, theme.elevation.raised]}><Ionicons name="add" size={28} color={theme.colors.onAccent} /></Pressable>;
}

export function EmptyState({
  title,
  message,
  action,
}: {
  readonly title: string;
  readonly message: string;
  readonly action?: ReactNode;
}) {
  const theme = useLifePlannerTheme();
  return (
    <Card>
      <Ionicons accessibilityElementsHidden color={theme.colors.secondaryText} name="leaf-outline" size={28} />
      <Text style={[theme.typography.sectionTitle, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[theme.typography.body, { color: theme.colors.secondaryText }]}>{message}</Text>
      {action}
    </Card>
  );
}

export function InlineError({ message }: { readonly message: string }) {
  const theme = useLifePlannerTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.inlineMessage, { gap: theme.spacing.xs }]}
    >
      <Ionicons color={theme.colors.danger} name="alert-circle-outline" size={18} />
      <Text style={[theme.typography.callout, { color: theme.colors.danger, flex: 1 }]}>{message}</Text>
    </View>
  );
}

export function LoadingState({ label = 'Loading Planner' }: { readonly label?: string }) {
  const theme = useLifePlannerTheme();
  return (
    <Card>
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.loadingState,
          { gap: theme.spacing.sm, minHeight: theme.layout.control.standardHeight },
        ]}
      >
        <ActivityIndicator accessibilityLabel={label} color={theme.colors.accent} />
        <Text style={[theme.typography.body, { color: theme.colors.secondaryText }]}>{label}</Text>
      </View>
    </Card>
  );
}

export function DependencyConnector({ children }: PropsWithChildren) {
  const theme = useLifePlannerTheme();
  return (
    <View
      style={{
        borderLeftColor: theme.colors.strongBorder,
        borderLeftWidth: 2,
        marginLeft: theme.spacing.sm,
        paddingLeft: theme.spacing.sm,
      }}
    >
      {children}
    </View>
  );
}

export function WizardShell({
  title = 'Create Habit',
  stage,
  stageNumber,
  stageCount,
  onCancel,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled = false,
  children,
}: PropsWithChildren<{
  readonly title?: string;
  readonly stage: string;
  readonly stageNumber: number;
  readonly stageCount: number;
  readonly onCancel: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly continueLabel?: string;
  readonly continueDisabled?: boolean;
}>) {
  const theme = useLifePlannerTheme();
  const { fontScale, width } = useWindowDimensions();
  const stackActions = fontScale >= 1.3 || width < 360;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <View
          style={[
            styles.wizardHeader,
            {
              borderBottomColor: theme.colors.border,
              minHeight: theme.layout.header.wizardMinimumHeight,
              paddingHorizontal: theme.layout.screen.inlinePadding,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            hitSlop={theme.spacing.xs}
            onPress={onCancel}
            style={[
              styles.headerAction,
              {
                minHeight: theme.layout.control.minimumTouchTarget,
                minWidth: theme.layout.control.minimumTouchTarget,
              },
            ]}
          >
            <Text style={[theme.typography.body, { color: theme.colors.accent }]}>Cancel</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[theme.typography.headline, { color: theme.colors.text }]}>{title}</Text>
            <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>
              {stageNumber} of {stageCount} · {stage}
            </Text>
          </View>
          <View
            style={[
              styles.headerAction,
              {
                minHeight: theme.layout.control.minimumTouchTarget,
                minWidth: theme.layout.control.minimumTouchTarget,
              },
            ]}
          />
        </View>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={{
            gap: theme.layout.screen.contentGap,
            paddingHorizontal: theme.layout.screen.inlinePadding,
            paddingVertical: theme.spacing.md,
          }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="never"
        >
          {children}
        </ScrollView>
        <View
          style={[
            styles.wizardActions,
            {
              backgroundColor: theme.colors.elevatedSurface,
              borderTopColor: theme.colors.border,
              flexDirection: stackActions ? 'column' : 'row',
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
            },
          ]}
        >
          <View style={styles.wizardButton}><SecondaryButton onPress={onBack} title="Back" /></View>
          <View style={styles.wizardButton}>
            <PrimaryButton disabled={continueDisabled} onPress={onContinue} title={continueLabel} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function BodyText({ children, secondary = false }: PropsWithChildren<{ readonly secondary?: boolean }>) {
  const theme = useLifePlannerTheme();
  return (
    <Text style={[theme.typography.body, { color: secondary ? theme.colors.secondaryText : theme.colors.text }]}>
      {children}
    </Text>
  );
}

export function VersionBadge({
  applicationName,
  semanticVersion,
  releaseStage,
  buildNumber,
}: {
  readonly applicationName: string;
  readonly semanticVersion: string;
  readonly releaseStage: string;
  readonly buildNumber: number;
}) {
  const theme = useLifePlannerTheme();
  const label = `${applicationName}, version ${semanticVersion} ${releaseStage}, build ${buildNumber}`;
  return (
    <View accessible accessibilityLabel={label} style={styles.versionBadge}>
      <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>{applicationName}</Text>
      <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>v{semanticVersion} {releaseStage}</Text>
      <Text style={[theme.typography.caption, { color: theme.colors.secondaryText }]}>Build {buildNumber}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenContent: { flexGrow: 1 },
  header: { alignItems: 'center', flexDirection: 'row' },
  headerText: { flex: 1 },
  stackedHeaderTrailing: { alignSelf: 'stretch', alignItems: 'flex-end' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row' },
  button: { alignItems: 'center', justifyContent: 'center' },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  textInput: { borderWidth: 1 },
  multilineInput: { textAlignVertical: 'top' },
  inlineMessage: { alignItems: 'flex-start', flexDirection: 'row' },
  loadingState: { alignItems: 'center', flexDirection: 'row' },
  wizardHeader: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  headerAction: { alignItems: 'flex-start', justifyContent: 'center', minWidth: 64 },
  wizardActions: { borderTopWidth: StyleSheet.hairlineWidth },
  wizardButton: { flex: 1 },
  versionBadge: { alignItems: 'flex-end' },
  progressHeader: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  progressTrack: { borderRadius: 999, height: 8, overflow: 'hidden' },
  progressFill: { borderRadius: 999, height: '100%' },
  dashboardHeader: { alignItems: 'center', flexDirection: 'row' },
  dashboardIcon: { alignItems: 'center', borderRadius: 10, height: 36, justifyContent: 'center', width: 36 },
  floatingAction: { alignItems: 'center', height: 56, justifyContent: 'center', width: 56 },
  keyboardAccessory: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 12 },
  bottomScrim: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  bottomLayerContent: { position: 'absolute' },
  keyboardAccessoryAction: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 72, paddingHorizontal: 12 },
  floatingBar: { alignItems: 'center', alignSelf: 'center', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, bottom: 8, flexDirection: 'row', gap: 4, padding: 6, position: 'absolute' },
  floatingBarAction: { alignItems: 'center', borderRadius: 16, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 48, minWidth: 88, paddingHorizontal: 12 },
  swipeActions: { flexDirection: 'row' },
  swipeAction: { alignItems: 'center', justifyContent: 'center', minWidth: 72, paddingHorizontal: 10 },
  swipeActionCards: { elevation: 3, gap: 6, marginLeft: 6, shadowOffset: { height: 0, width: -10 }, shadowOpacity: 0.1, shadowRadius: 18 },
  swipeActionCard: { borderRadius: 18, borderWidth: 1, gap: 5, minWidth: 0, paddingHorizontal: 0, width: 56 },
  swipeActionCardLabel: { fontSize: 11, fontWeight: '600', lineHeight: 14 },
});
