import type { DeleteHabitChainImpact } from '@/src/features/planner';

export function deleteChainConfirmationTitle(impact: DeleteHabitChainImpact): string {
  const linkedCount = Math.max(0, impact.targetCount - 1);
  return linkedCount === 0
    ? `Delete “${impact.rootHabitName}”?`
    : `Delete “${impact.rootHabitName}” and ${linkedCount} linked ${linkedCount === 1 ? 'habit' : 'habits'}?`;
}

export function deleteChainConfirmationMessage(impact: DeleteHabitChainImpact): string {
  const linked = impact.targets.filter(({ habitId }) => habitId !== impact.rootHabitId);
  const names = linked.slice(0, 4).map(({ name }) => name).join(', ');
  const extra = Math.max(0, linked.length - 4);
  const linkedPreview = linked.length === 0
    ? ''
    : ` Linked habits: ${names}${extra === 0 ? '' : ` and ${extra} more`}.`;
  const scope = linked.length === 0
    ? 'This permanently deletes this habit and its history.'
    : 'This permanently deletes the complete routine and its history.';
  return `${scope}${linkedPreview} ${impact.observationCount} observation/history ${impact.observationCount === 1 ? 'row' : 'rows'} and ${impact.correctionCount} ${impact.correctionCount === 1 ? 'correction' : 'corrections'} will be removed. This cannot be undone.`;
}

export function deleteChainConfirmationAction(impact: DeleteHabitChainImpact): string {
  return impact.targetCount > 1 ? 'Delete routine' : 'Delete habit';
}
