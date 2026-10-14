import {
  COUNTER_STANDARD_UNIT_CODES,
  DURATION_STANDARD_UNIT_CODES,
  QUANTITY_STANDARD_UNIT_CODES,
  STANDARD_UNIT_DEFINITIONS,
  standardUnitLabel,
  type ImportanceLevel,
  type StandardUnitCode,
  type TrackingMode,
} from '../domain';

export const IMPORTANCE_STOPS = Object.freeze(['low', 'normal', 'high', 'critical'] as const satisfies readonly ImportanceLevel[]);

export type UnitChoice = Readonly<{
  key: 'none' | 'custom' | StandardUnitCode;
  label: string;
  symbol: string;
  group: 'Volume' | 'Mass' | 'Distance' | 'Count' | 'Duration' | 'Custom';
  kind: 'none' | 'custom' | 'standard';
}>;

export interface UnitChoiceGroup {
  readonly title: UnitChoice['group'];
  readonly choices: readonly UnitChoice[];
}

export function compatibleUnitGroups(mode: Extract<TrackingMode, 'counter' | 'quantity' | 'duration'>, query = ''): readonly UnitChoiceGroup[] {
  const codes = mode === 'counter' ? COUNTER_STANDARD_UNIT_CODES : mode === 'quantity' ? QUANTITY_STANDARD_UNIT_CODES : DURATION_STANDARD_UNIT_CODES;
  const choices: UnitChoice[] = [
    ...(mode === 'counter' ? [unitChoice('none', 'No unit', '', 'Count', 'none')] : []),
    ...codes.map((code) => {
      const dimension = STANDARD_UNIT_DEFINITIONS[code].dimension;
      const group = ({ volume: 'Volume', mass: 'Mass', distance: 'Distance', count: 'Count', duration: 'Duration' } as const)[dimension];
      return unitChoice(code, standardUnitLabel(code), standardUnitLabel(code, 'symbol'), group, 'standard');
    }),
    unitChoice('custom', 'Custom unit', '', 'Custom', 'custom'),
  ];
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = normalized === '' ? choices : choices.filter((choice) => `${choice.label} ${choice.symbol} ${choice.group}`.toLocaleLowerCase().includes(normalized));
  const order: readonly UnitChoice['group'][] = ['Volume', 'Mass', 'Distance', 'Count', 'Duration', 'Custom'];
  return order.flatMap((title) => {
    const grouped = filtered.filter((choice) => choice.group === title);
    return grouped.length === 0 ? [] : [Object.freeze({ title, choices: Object.freeze(grouped) })];
  });
}

function unitChoice(key: UnitChoice['key'], label: string, symbol: string, group: UnitChoice['group'], kind: UnitChoice['kind']): UnitChoice {
  return Object.freeze({ key, label, symbol, group, kind });
}

/**
 * How many ticks a priority draws. The count carries the value and colour only
 * reinforces it, so the number is the contract rather than the hue (PD-PRIORITY-002).
 */
const PRIORITY_TICKS = Object.freeze({ low: 1, normal: 2, high: 3, critical: 4 } as const);

export function todayPriorityTickCount(importance: 'low' | 'normal' | 'high' | 'critical'): 1 | 2 | 3 | 4 {
  return PRIORITY_TICKS[importance];
}
