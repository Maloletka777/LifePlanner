import {
  createExactQuantity,
  convertExactStandardUnit,
  STANDARD_UNIT_DEFINITIONS,
  type ObservationValue,
  type QuantityStandardUnitCode,
} from '../domain';

type PresetObservationValue = Extract<
  ObservationValue,
  | { type: 'counter' }
  | { type: 'quantity' }
  | { type: 'duration' }
  | { type: 'avoidance' }
>;

export type MeasurementQuickActionDescriptor =
  | Readonly<{
      kind: 'preset';
      id: string;
      label: string;
      accessibilityLabel: string;
      operation: 'add' | 'record';
      value: PresetObservationValue;
    }>
  | Readonly<{
      kind: 'custom';
      id: 'custom';
      label: 'Custom';
      accessibilityLabel: string;
      operation: 'open_custom';
    }>;

export type MeasurementQuickActionContext =
  | Readonly<{
      trackingMode: 'quantity';
      unit:
        | Readonly<{ unitType: 'standard'; standardUnitCode: QuantityStandardUnitCode }>
        | Readonly<{ unitType: 'custom'; customUnitLabel: string }>;
    }>
  | Readonly<{ trackingMode: 'duration' }>
  | Readonly<{ trackingMode: 'counter' }>
  | Readonly<{ trackingMode: 'avoidance' }>;

export function measurementQuickActions(
  context: MeasurementQuickActionContext,
): readonly MeasurementQuickActionDescriptor[] {
  switch (context.trackingMode) {
    case 'quantity':
      return quantityActions(context.unit);
    case 'duration':
      return Object.freeze([
        durationAction(5),
        durationAction(15),
        durationAction(30),
        customAction('Enter a custom duration'),
      ]);
    case 'counter':
      return Object.freeze([
        countAction(1),
        countAction(5),
        countAction(10),
        customAction('Enter a custom count'),
      ]);
    case 'avoidance':
      return Object.freeze([
        avoidanceAction('success', true),
        avoidanceAction('violation', false),
      ]);
  }
}

function quantityActions(
  unit: Extract<MeasurementQuickActionContext, { trackingMode: 'quantity' }>['unit'],
): readonly MeasurementQuickActionDescriptor[] {
  if (
    unit.unitType !== 'standard'
    || STANDARD_UNIT_DEFINITIONS[unit.standardUnitCode].dimension !== 'volume'
  ) {
    return Object.freeze([customAction('Enter a custom quantity')]);
  }

  return Object.freeze([
    volumeAction(250, '250 ml', '250 millilitres', unit.standardUnitCode),
    volumeAction(500, '500 ml', '500 millilitres', unit.standardUnitCode),
    volumeAction(1_000, '1 L', '1 litre', unit.standardUnitCode),
    customAction('Enter a custom quantity'),
  ]);
}

function volumeAction(
  millilitres: number,
  label: string,
  spokenAmount: string,
  targetUnit: QuantityStandardUnitCode,
): MeasurementQuickActionDescriptor {
  const source = createExactQuantity({ significand: BigInt(millilitres), scale: 0 }, 'measurementQuickAction');
  if (!source.ok) throw new Error('Approved volume preset is invalid.');
  const converted = convertExactStandardUnit(source.value, 'millilitre', targetUnit, 'measurementQuickAction');
  if (!converted.ok) throw new Error('Approved volume preset cannot be converted exactly.');
  return Object.freeze({
    kind: 'preset' as const,
    id: `volume-${millilitres}-millilitres`,
    label: `+${label}`,
    accessibilityLabel: `Add ${spokenAmount}`,
    operation: 'add' as const,
    value: Object.freeze({ type: 'quantity' as const, quantity: converted.value }),
  });
}

function durationAction(minutes: 5 | 15 | 30): MeasurementQuickActionDescriptor {
  return Object.freeze({
    kind: 'preset' as const,
    id: `duration-${minutes}-minutes`,
    label: `+${minutes} min`,
    accessibilityLabel: `Add ${minutes} minutes`,
    operation: 'add' as const,
    value: Object.freeze({ type: 'duration' as const, durationSeconds: minutes * 60 }),
  });
}

function countAction(count: 1 | 5 | 10): MeasurementQuickActionDescriptor {
  return Object.freeze({
    kind: 'preset' as const,
    id: `count-${count}`,
    label: `+${count}`,
    accessibilityLabel: `Add ${count}`,
    operation: 'add' as const,
    value: Object.freeze({ type: 'counter' as const, counterDelta: count }),
  });
}

function avoidanceAction(
  outcome: 'success' | 'violation',
  booleanValue: boolean,
): MeasurementQuickActionDescriptor {
  const label = outcome === 'success' ? 'Success' : 'Violation';
  return Object.freeze({
    kind: 'preset' as const,
    id: `avoidance-${outcome}`,
    label,
    accessibilityLabel: `Record avoidance ${outcome}`,
    operation: 'record' as const,
    value: Object.freeze({ type: 'avoidance' as const, booleanValue }),
  });
}

function customAction(accessibilityLabel: string): MeasurementQuickActionDescriptor {
  return Object.freeze({
    kind: 'custom' as const,
    id: 'custom' as const,
    label: 'Custom' as const,
    accessibilityLabel,
    operation: 'open_custom' as const,
  });
}
