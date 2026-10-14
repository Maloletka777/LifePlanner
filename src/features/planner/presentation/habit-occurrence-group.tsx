import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, LayoutAnimation, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type View as NativeView } from 'react-native';

import type { SelectedDatePlannerOccurrenceRow, SelectedDatePlannerRootGroup } from '@/src/features/planner';
import { useLifePlannerTheme } from '@/src/ui/theme';


import { HabitOccurrenceRow } from './habit-occurrence-row';
import { plannerRoutineDisplayProgress } from './ui-adapters';

/**
 * One habit and its canonical children inside a single accent-filled surface.
 *
 * The habit's accent fills the row again (motion prototype correction 3), so the
 * surface takes the accent rather than white. Steps still stay inside the parent's
 * surface behind a lighter tone of the same accent and one relationship rail: no
 * second card, no second shadow, no second radius.
 */
export function HabitOccurrenceGroup({
  group,
  ordinaryChildren = [],
  expanded,
  highlighted = false,
  savingHabitIds,
  rowErrors,
  overdueHabitIds,
  onAction,
  onLayout,
  onToggle,
  onManageSteps,
}: {
  readonly group: SelectedDatePlannerRootGroup;
  readonly ordinaryChildren?: readonly SelectedDatePlannerRootGroup[];
  readonly expanded: boolean;
  readonly highlighted?: boolean;
  readonly savingHabitIds: ReadonlySet<string>;
  readonly rowErrors: ReadonlyMap<string, string>;
  readonly overdueHabitIds?: ReadonlySet<string>;
  readonly onAction: (row: SelectedDatePlannerOccurrenceRow) => void;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly onToggle: () => void;
  readonly onManageSteps?: () => void;
}) {
  const theme = useLifePlannerTheme();
  const parent = group.rows[0];
  const conditionalRows = group.rows.slice(1);
  const ordinaryRows = ordinaryChildren.flatMap((childGroup) => childGroup.rows.slice(0, 1));
  const children = [...ordinaryRows, ...conditionalRows].sort(compareCanonicalRows);
  const parentBodyRef = useRef<NativeView>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  const isOverdue = useCallback((habitId: string) => overdueHabitIds?.has(habitId) ?? false, [overdueHabitIds]);
  const toggleExpanded = () => {
    if (!reduceMotion) LayoutAnimation.configureNext({
      duration: theme.motion.compact,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    onToggle();
    if (expanded) requestAnimationFrame(() => {
      const tag = parentBodyRef.current === null ? null : findNodeHandle(parentBodyRef.current);
      if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
    });
  };
  if (parent === undefined) return null;

  const surface = [
    styles.surface,
    {
      // The group is the theme's surface too: twelve pastel fills down a list
      // cannot be under any palette's control, and they fought the priority edge.
      backgroundColor: theme.today.dashboardSurface,
      borderColor: highlighted ? theme.today.completion : theme.today.hairline,
      borderRadius: theme.radii.xl,
    },
    highlighted ? styles.highlight : null,
  ];

  if (children.length === 0) {
    return <View onLayout={onLayout} style={surface}>
      <HabitOccurrenceRow
        contained
        onAction={onAction}
        overdue={isOverdue(parent.habitId)}
        parentName={null}
        row={parent}
        rowError={rowErrors.get(parent.habitId) ?? null}
        saving={savingHabitIds.has(parent.habitId)}
      />
    </View>;
  }

  return <View onLayout={onLayout} style={surface}>
    <HabitOccurrenceRow
      contained
      displayProgressOverride={plannerRoutineDisplayProgress(group)}
      groupDisclosure={{
        ordinaryChildCount: ordinaryRows.length,
        conditionalCount: conditionalRows.length,
        dependencyState: conditionalDependencyState(conditionalRows),
        expanded,
        onToggle: toggleExpanded,
        pressableRef: parentBodyRef,
        routineStepCount: group.routineContainer.ordinaryStepCount,
        completedRoutineStepCount: group.routineContainer.completedOrdinaryStepCount,
        remainingRoutineStepCount: group.routineContainer.remainingOrdinaryStepCount,
        routineApplicability: group.routineContainer.applicability,
        isRoutineContainer: group.routineContainer.isRoutineContainer,
      }}
      onAction={onAction}
      overdue={isOverdue(parent.habitId)}
      parentName={null}
      row={parent}
      rowError={rowErrors.get(parent.habitId) ?? null}
      saving={savingHabitIds.has(parent.habitId)}
    />
    {!expanded ? null : <View style={[styles.steps, { backgroundColor: theme.today.rowTint }]}>
      <View style={[styles.rail, { backgroundColor: theme.today.tone200 }]} />
      {children.map((row) => <HabitOccurrenceRow
        key={row.habitId}
        compact
        connectedChild
        contained
        hideOrdinaryRelationship
        hierarchyDepth={Math.min(Math.max(row.ordinaryDepth, 1), 2)}
        onAction={onAction}
        overdue={isOverdue(row.habitId)}
        parentName={parent.name}
        row={row}
        rowError={rowErrors.get(row.habitId) ?? null}
        saving={savingHabitIds.has(row.habitId)}
        separated
      />)}
      {onManageSteps === undefined ? null : <Pressable
        accessibilityLabel={`Manage steps of ${parent.name}`}
        accessibilityRole="button"
        onPress={onManageSteps}
        style={({ pressed }) => [styles.manageSteps, {
          backgroundColor: pressed ? theme.today.pressedSurface : 'transparent',
          borderTopColor: theme.today.separator,
        }]}
      >
        <Text style={[theme.typography.caption, { color: theme.today.system }]}>Manage steps</Text>
      </Pressable>}
    </View>}
  </View>;
}

/** Presentation-only summary of a group's conditional rows. */
function conditionalDependencyState(
  conditionalRows: readonly SelectedDatePlannerOccurrenceRow[],
): 'none' | 'available' | 'blocked' | 'unavailable' {
  if (conditionalRows.length === 0) return 'none';
  if (conditionalRows.some(({ state }) => state === 'blocked' || state === 'prerequisite_blocked_parent')) return 'blocked';
  if (conditionalRows.some(({ state }) => state === 'expected_incomplete' || state === 'qualified')) return 'available';
  return 'unavailable';
}

function compareCanonicalRows(
  left: SelectedDatePlannerOccurrenceRow,
  right: SelectedDatePlannerOccurrenceRow,
): number {
  return Number(left.plannedLocalTime === null) - Number(right.plannedLocalTime === null)
    || (left.plannedLocalTime ?? '').localeCompare(right.plannedLocalTime ?? '')
    || left.stableSortOrder - right.stableSortOrder
    || left.habitId.localeCompare(right.habitId);
}

const styles = StyleSheet.create({
  surface: { borderWidth: 1.5, overflow: 'hidden' },
  highlight: { borderWidth: 1.5 },

  steps: { position: 'relative' },
  rail: { bottom: 8, left: 22, position: 'absolute', top: 0, width: 1 },
  manageSteps: { alignItems: 'flex-start', borderTopWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: 44, paddingLeft: 54 },
});
