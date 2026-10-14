import type { ExactQuantity } from '../exact-quantity/exact-quantity';
import type { EffectiveRange } from '../validation/effective-range';
import type { NumericComparisonOperator } from '../values/stored-values';
import type {
  CounterStandardUnitCode,
  QuantityStandardUnitCode,
} from './unit-registry';

export interface NoUnit {
  readonly unitType: 'none';
}

export interface StandardUnit<TCode extends string> {
  readonly unitType: 'standard';
  readonly standardUnitCode: TCode;
}

export interface CustomUnit {
  readonly unitType: 'custom';
  readonly customUnitLabel: string;
}

interface TrackingDefinitionBase {
  readonly effectiveRange: EffectiveRange;
}

export interface CheckboxTrackingDefinition extends TrackingDefinitionBase {
  readonly trackingMode: 'checkbox';
  readonly comparisonOperator: 'boolean_success';
}

export interface AvoidanceTrackingDefinition extends TrackingDefinitionBase {
  readonly trackingMode: 'avoidance';
  readonly comparisonOperator: 'boolean_success';
}

export interface CounterTrackingDefinition extends TrackingDefinitionBase {
  readonly trackingMode: 'counter';
  readonly comparisonOperator: NumericComparisonOperator;
  readonly target: ExactQuantity & { readonly scale: 0 };
  readonly unit:
    | NoUnit
    | StandardUnit<CounterStandardUnitCode>
    | CustomUnit;
}

export interface QuantityTrackingDefinition extends TrackingDefinitionBase {
  readonly trackingMode: 'quantity';
  readonly comparisonOperator: NumericComparisonOperator;
  readonly target: ExactQuantity;
  readonly unit: StandardUnit<QuantityStandardUnitCode> | CustomUnit;
}

export interface DurationTrackingDefinition extends TrackingDefinitionBase {
  readonly trackingMode: 'duration';
  readonly comparisonOperator: NumericComparisonOperator;
  readonly targetDurationSeconds: number;
  readonly unit: StandardUnit<'second'>;
}

export type TrackingDefinition =
  | CheckboxTrackingDefinition
  | AvoidanceTrackingDefinition
  | CounterTrackingDefinition
  | QuantityTrackingDefinition
  | DurationTrackingDefinition;
