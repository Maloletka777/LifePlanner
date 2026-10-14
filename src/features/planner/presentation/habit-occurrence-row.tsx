import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, type RefObject } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions, type View as NativeView } from 'react-native';

import type { SelectedDatePlannerOccurrenceRow } from '@/src/features/planner';
import { useReduceMotion } from '@/src/ui/dashboard/use-reduce-motion';
import { useLifePlannerTheme } from '@/src/ui/theme';

import { HabitIdentityMark } from './habit-visual-components';
import { handStrikeVariant, HandStrike } from './hand-strike';
import { actualTargetText, occurrenceAction, plannerRowIsCanonicallyDone, statusPresentation } from './ui-adapters';

interface GroupDisclosure {
  readonly ordinaryChildCount: number;
  readonly conditionalCount: number;
  readonly dependencyState: 'none' | 'available' | 'blocked' | 'unavailable';
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly pressableRef: RefObject<NativeView | null>;
  readonly routineStepCount: number;
  readonly completedRoutineStepCount: number;
  readonly remainingRoutineStepCount: number;
  readonly routineApplicability: 'not_container' | 'applicable' | 'no_applicable_steps';
  readonly isRoutineContainer: boolean;
}

interface HabitOccurrenceRowProps {
  readonly row: SelectedDatePlannerOccurrenceRow;
  readonly parentName: string | null;
  readonly onAction: (row: SelectedDatePlannerOccurrenceRow) => void;
  readonly saving: boolean;
  readonly rowError: string | null;
  readonly compact?: boolean;
  readonly connectedChild?: boolean;
  readonly contained?: boolean;
  readonly groupDisclosure?: GroupDisclosure | null;
  readonly displayProgressOverride?: number | null;
  readonly hideOrdinaryRelationship?: boolean;
  readonly hierarchyDepth?: number;
  /** Hairline above the row; the group owns the surface, the row owns its divider. */
  readonly separated?: boolean;
  /** Only the caller knows whether the selected date is today and what time it is. */
  readonly overdue?: boolean;
}

const PRIORITY_WORDS = Object.freeze({ low: null, normal: null, high: 'HIGH', critical: 'CRITICAL' } as const);
/** One curve for every fill and every progress bar. */
const SWEEP_EASING = Easing.bezier(0.22, 0.61, 0.36, 1);
const SWEEP_DURATION = 420;
const SWEEP_UNDO_DURATION = 300;
const STRIKE_DURATION = 300;
const CHECK_DURATION = 180;
const CHECK_DELAY = 120;

/**
 * Planner row, v0.3.3.
 *
 * `[4 pt priority edge][10][28 pt identity tile][12][title + one supporting line][12][control]`
 *
 * The habit's accent fills the row, as it does inside Today's Habits card. The
 * priority edge sits outside the text column so it costs the title no width, and
 * it is drawn only for High and Critical — on a tinted row a Normal edge would
 * fight the fill. Completion is a sweep of the accent's deeper tone, left to right
 * across every row, and it may only start once persistence is confirmed.
 */
export function HabitOccurrenceRow({
  row,
  parentName,
  onAction,
  saving,
  rowError,
  compact = false,
  connectedChild = false,
  contained = false,
  groupDisclosure = null,
  displayProgressOverride,
  hideOrdinaryRelationship = false,
  hierarchyDepth = 0,
  separated = false,
  overdue = false,
}: HabitOccurrenceRowProps) {
  const theme = useLifePlannerTheme();
  const reduceMotion = useReduceMotion();
  const { fontScale } = useWindowDimensions();
  const action = occurrenceAction(row);
  const status = statusPresentation(row);
  // A derived routine container never carries an observation of its own, so its
  // `state` stays incomplete however many steps are done. The canonical fact is
  // `isCanonicallyComplete`, computed from the steps — on `тест9` the parent read
  // "2 of 2 steps" with a full bar and no mark because this row read `state`.
  const completed = plannerRowIsCanonicallyDone(row);
  const unavailable = action.kind === 'none';
  const additive = action.kind === 'add_counter' || action.kind === 'add_quantity' || action.kind === 'add_duration';
  const avoidance = action.kind === 'choose_avoidance';
  const isConditional = row.parentHabitId !== null;
  const isChild = row.ordinaryParentHabitId !== null;
  const displayProgress = displayProgressOverride === undefined ? row.progress.displayProgress : displayProgressOverride;
  const stackedTime = fontScale >= 1.35;
  const priorityWord = PRIORITY_WORDS[row.importance];
  const priorityEdge = row.importance === 'critical'
    ? theme.today.priorityCritical
    : row.importance === 'high' ? theme.today.priorityHigh : 'transparent';

  // One supporting line only. Order of precedence: failure, saving, blocked or
  // paused reason, routine step progress, exact measurement, then the time.
  const routine = groupDisclosure !== null && groupDisclosure.isRoutineContainer;
  const stepProgress = !routine
    ? null
    : groupDisclosure.routineApplicability === 'no_applicable_steps'
      ? 'No steps apply today'
      : `${groupDisclosure.completedRoutineStepCount} of ${groupDisclosure.routineStepCount} steps`;
  const legacyParent = groupDisclosure !== null && !groupDisclosure.isRoutineContainer && groupDisclosure.ordinaryChildCount > 0;
  const measurement = row.trackingMode === 'checkbox' ? null : actualTargetText(row);
  const supporting = rowError !== null
    ? 'Tap to retry'
    : saving
      ? 'Not confirmed yet'
      : unavailable && status.explanation !== null
        ? status.explanation
        : legacyParent
          ? `Its own habit · ${groupDisclosure.ordinaryChildCount} linked`
          : stepProgress !== null
            ? stepProgress
            : measurement !== null && !/^No observation$/i.test(measurement)
              ? measurement
              : completed
                ? `${row.plannedLocalTime ?? 'Anytime'} · Completed`
                : overdue && row.plannedLocalTime !== null
                  ? `${row.plannedLocalTime} · Overdue`
                  : row.plannedLocalTime ?? (isChild || isConditional ? null : 'Anytime');
  const supportingTone = rowError !== null
    ? theme.today.attentionText
    : overdue && !completed
      ? theme.today.attentionText
      : theme.today.tertiaryText;

  // Completion animates only on a confirmed change of canonical state, so a
  // pending write shows no fill and no check. Undo is the same sweep reversed.
  // What the fill measures.
  //
  // A routine's fill follows its **steps**, not its own completion: with the row
  // no longer tinted by the habit's accent, driving it from `completed` left a
  // parent reading 0 % until the last step landed and 100 % the moment it did.
  // Everything that is not a container is still binary, because there is nothing
  // in between for it to measure.
  const fillTarget = routine && displayProgress !== null ? Math.max(0, Math.min(1, displayProgress)) : completed ? 1 : 0;
  const sweep = useRef(new Animated.Value(fillTarget)).current;
  const pop = useRef(new Animated.Value(completed ? 1 : 0)).current;
  const mute = useRef(new Animated.Value(completed ? 1 : 0)).current;
  useEffect(() => {
    const target = completed ? 1 : 0;
    if (reduceMotion) {
      sweep.setValue(fillTarget);
      pop.setValue(target);
      mute.setValue(target);
      return;
    }
    // One gesture, all of it on the native driver: nothing here animates a width,
    // a size or a colour, so a busy JS thread cannot break it into steps.
    const animation = Animated.parallel([
      Animated.timing(sweep, {
        duration: fillTarget >= 1 ? SWEEP_DURATION : SWEEP_UNDO_DURATION,
        easing: SWEEP_EASING,
        toValue: fillTarget,
        useNativeDriver: true,
      }),
      // No overshoot anywhere any more: the back() throw was the second jolt.
      Animated.timing(pop, {
        delay: completed ? CHECK_DELAY : 0,
        duration: completed ? CHECK_DURATION : 120,
        easing: SWEEP_EASING,
        toValue: target,
        useNativeDriver: true,
      }),
      // The stroke follows the fill across, drawn by a clip rather than by growing.
      Animated.timing(mute, {
        delay: completed ? CHECK_DELAY : 0,
        duration: completed ? STRIKE_DURATION : 160,
        easing: SWEEP_EASING,
        toValue: target,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [completed, fillTarget, mute, pop, reduceMotion, sweep]);

  const spoken = [
    row.name,
    completed ? 'completed' : unavailable ? status.label : 'not completed',
    row.plannedLocalTime ?? 'anytime',
    priorityWord === null ? (row.importance === 'normal' ? 'normal priority' : 'low priority') : `${priorityWord.toLowerCase()} priority`,
    stepProgress,
    parentName === null || hideOrdinaryRelationship ? null : `step of ${parentName}`,
  ].filter((part) => part !== null && part !== undefined).join(', ');

  const identity = <>
    <HabitIdentityMark
      accessibilityLabel={`${row.name} identity`}
      accentKey={row.visualIdentity.persistedAccentKey}
      child={compact}
      iconIdentity={row.visualIdentity.iconIdentity}
      seed={row.habitId}
      tileBackground={theme.today.tileWash}
    />
    <View style={styles.text}>
      <View style={stackedTime ? styles.titleStacked : styles.titleLine}>
        <View style={styles.titleBox}>
          <Text
            numberOfLines={stackedTime ? 3 : 2}
            style={[
              compact ? theme.typography.label : theme.typography.headline,
              { color: completed || unavailable ? theme.today.tertiaryText : theme.today.primaryText, flexShrink: 1 },
            ]}
          >
            {row.name}
          </Text>
          {/* Crossed out by the same hand as the diary, revealed by a clip from the
              left so the stroke is drawn rather than faded in. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.strikeClip, { opacity: completed ? 1 : 0, transform: [{ scaleX: mute }] }]}
          >
            <HandStrike color={theme.today.secondaryText} variant={handStrikeVariant(row.name.length)} />
          </Animated.View>
        </View>
        {/* A completed row has nothing left to prioritise, so the word steps back. */}
        {priorityWord === null || completed ? null : <Text style={[styles.priorityWord, {
          color: row.importance === 'critical' ? theme.today.attentionText : theme.today.scheduleText,
        }]}
        >
          {priorityWord}
        </Text>}
      </View>
      {supporting === null ? null : <Text
        accessibilityLiveRegion={rowError !== null || saving ? 'polite' : 'none'}
        numberOfLines={2}
        style={[theme.typography.caption, { color: supportingTone }]}
      >
        {supporting}
      </Text>}
      {displayProgress === null || !routine ? null : <View style={[styles.progressTrack, { backgroundColor: theme.today.tone200 }]}>
        <View style={[styles.progressFill, { backgroundColor: theme.today.completion, width: `${Math.round(Math.max(0, Math.min(1, displayProgress)) * 100)}%` }]} />
      </View>}
    </View>
  </>;

  const body = groupDisclosure === null
    ? <View accessible accessibilityLabel={spoken} style={styles.body}>{identity}</View>
    : <Pressable
      ref={groupDisclosure.pressableRef}
      accessibilityHint={groupDisclosure.expanded ? 'Collapses the steps of this habit.' : 'Expands the steps of this habit.'}
      accessibilityLabel={spoken}
      accessibilityRole="button"
      accessibilityState={{ expanded: groupDisclosure.expanded }}
      onPress={groupDisclosure.onToggle}
      style={({ pressed }) => [styles.body, { backgroundColor: pressed ? theme.today.pressedSurface : 'transparent' }]}
    >{identity}</Pressable>;

  // A derived routine container carries a chevron where a control would be. A
  // legacy organizational parent keeps its own control and gains a chevron.
  const derivedRoutine = routine && !row.routineContainer?.hasIndependentCompletionAction;
  const control = derivedRoutine
    ? <View accessibilityElementsHidden style={styles.control}>
      {/* Closed by its last step: the same mark a hand-checked row carries, drawn
          rather than offered, because a derived container has no action of its own. */}
      {completed
        ? <View style={[styles.controlVisual, { backgroundColor: theme.today.completion, borderColor: theme.today.completion, borderRadius: 15 }]}>
          <Ionicons color={theme.today.onAccent} name="checkmark" size={18} />
        </View>
        : <Ionicons color={theme.today.tertiaryText} name={groupDisclosure.expanded ? 'chevron-up' : 'chevron-down'} size={20} />}
    </View>
    : <Pressable
      accessibilityHint={unavailable ? action.disabledReason : `Record ${row.name} for this date.`}
      accessibilityLabel={saving ? `Saving ${row.name}` : action.label}
      accessibilityRole={additive || avoidance ? 'button' : 'checkbox'}
      accessibilityState={{ busy: saving, checked: additive || avoidance ? undefined : completed, disabled: saving || unavailable }}
      disabled={saving || unavailable}
      onPress={() => onAction(row)}
      style={styles.control}
    >
      <View style={[
        styles.controlVisual,
        {
          backgroundColor: completed ? theme.today.completion : saving ? theme.today.tone100 : additive || avoidance ? theme.today.completionTint : 'transparent',
          borderColor: completed
            ? theme.today.completion
            : rowError !== null
              ? theme.today.attention
              : unavailable ? theme.today.tone200 : theme.today.tone300,
          borderRadius: additive || avoidance ? theme.radii.md : 15,
          borderStyle: row.state === 'blocked' ? 'dashed' : 'solid',
        },
      ]}
      >
        {saving
          ? <ActivityIndicator color={theme.today.pending} size="small" />
          : completed
            ? <Animated.View style={{ opacity: pop, transform: [{ scale: pop }] }}><Ionicons color={theme.today.onAccent} name="checkmark" size={18} /></Animated.View>
            : additive
              ? <Ionicons color={theme.today.completion} name={action.kind === 'add_duration' ? 'timer-outline' : 'add'} size={18} />
              : avoidance
                ? <Ionicons color={theme.today.completion} name="shield-checkmark-outline" size={18} />
                : unavailable
                  ? <Ionicons color={theme.today.tertiaryText} name="lock-closed-outline" size={16} />
                  : null}
      </View>
    </Pressable>;

  return (
    <View style={[
      styles.row,
      compact ? styles.compactRow : null,
      separated ? { borderTopColor: theme.today.separator, borderTopWidth: StyleSheet.hairlineWidth } : null,
      {
        backgroundColor: connectedChild ? theme.today.rowTint : theme.today.dashboardSurface,
        borderColor: theme.today.hairline,
        borderWidth: contained ? 0 : StyleSheet.hairlineWidth,
      },
      contained ? null : { borderRadius: 16 },
    ]}
    >
      {/* The fill is a transform, not a width: animating a percentage recomputes
          the row's layout on the JS thread every frame, which is what made it
          climb in steps down a list of ten. One tone for every habit. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.sweep, {
          backgroundColor: theme.today.completionTint,
          transform: [{ scaleX: sweep }],
        }]}
      />
      <View style={[styles.edge, { backgroundColor: priorityEdge }]} />
      <View style={[styles.inner, { paddingLeft: 10 + Math.min(hierarchyDepth, 2) * 6 }]}>
        {body}
        {control}
      </View>
    </View>
  );
}

/** Text-column inset for separators, derived so it cannot drift under Dynamic Type. */
export const PLANNER_ROW_SEPARATOR_INSET = 4 + 10 + 28 + 12;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', minHeight: 64, overflow: 'hidden' },
  sweep: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, transformOrigin: 'left' },
  strikeClip: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, transformOrigin: 'left' },
  compactRow: { minHeight: 52 },
  edge: { flexShrink: 0, width: 4 },
  inner: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12, paddingRight: 8, paddingVertical: 8 },
  body: { alignItems: 'center', borderRadius: 12, flex: 1, flexDirection: 'row', gap: 12, minWidth: 0 },
  text: { flex: 1, gap: 2, minWidth: 0 },
  titleLine: { alignItems: 'center', flexDirection: 'row', gap: 8, minWidth: 0 },
  titleBox: { alignSelf: 'flex-start', flexShrink: 1, maxWidth: '100%' },
  titleStacked: { alignItems: 'flex-start', flexDirection: 'column', gap: 2, minWidth: 0 },
  priorityWord: { flexShrink: 0, fontSize: 11, fontWeight: '700', letterSpacing: 0.08 * 11, lineHeight: 14 },
  progressTrack: { borderRadius: 2, height: 4, marginTop: 4, overflow: 'hidden', width: '62%' },
  progressFill: { borderRadius: 2, height: 4 },
  control: { alignItems: 'center', flexShrink: 0, height: 44, justifyContent: 'center', width: 44 },
  controlVisual: { alignItems: 'center', borderWidth: 2, height: 30, justifyContent: 'center', width: 30 },
});
