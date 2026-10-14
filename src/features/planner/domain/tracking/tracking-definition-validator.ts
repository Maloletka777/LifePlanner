import {
  createExactQuantity,
  validatePositiveExactQuantity,
  type ExactQuantity,
} from '../exact-quantity/exact-quantity';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import { validateEffectiveRange } from '../validation/effective-range';
import { hasOnlyKeys, isRecord, isSafeIntegerInRange } from '../validation/input';
import {
  parseComparisonOperator,
  parseTrackingMode,
  parseUnitType,
  type NumericComparisonOperator,
} from '../values/stored-values';
import type {
  CounterTrackingDefinition,
  CustomUnit,
  DurationTrackingDefinition,
  NoUnit,
  QuantityTrackingDefinition,
  StandardUnit,
  TrackingDefinition,
} from './tracking-definition';
import {
  COUNTER_STANDARD_UNIT_CODES,
  QUANTITY_STANDARD_UNIT_CODES,
  parseStandardUnitCode,
  type CounterStandardUnitCode,
  type QuantityStandardUnitCode,
  type StandardUnitCode,
} from './unit-registry';

export const MAX_CUSTOM_UNIT_LABEL_LENGTH = 40;

const BASE_KEYS = [
  'trackingMode',
  'comparisonOperator',
  'effectiveFrom',
  'effectiveTo',
] as const;

type ParsedUnit =
  | NoUnit
  | StandardUnit<StandardUnitCode>
  | CustomUnit;

export function validateTrackingDefinition(
  input: unknown,
): Result<TrackingDefinition, PlannerDomainError> {
  if (!isRecord(input)) {
    return invalidTracking('trackingDefinition', 'definition_type');
  }

  const modeResult = parseTrackingMode(input.trackingMode, 'trackingMode');
  if (!modeResult.ok) {
    return modeResult;
  }
  const operatorResult = parseComparisonOperator(
    input.comparisonOperator,
    'comparisonOperator',
  );
  if (!operatorResult.ok) {
    return operatorResult;
  }
  const rangeResult = validateEffectiveRange({
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  });
  if (!rangeResult.ok) {
    return rangeResult;
  }

  switch (modeResult.value) {
    case 'checkbox':
    case 'avoidance':
      if (!hasOnlyKeys(input, BASE_KEYS)) {
        return invalidTracking('trackingDefinition', 'irrelevant_boolean_field');
      }
      if (operatorResult.value !== 'boolean_success') {
        return invalidTracking('comparisonOperator', 'boolean_operator');
      }
      return success(
        Object.freeze({
          trackingMode: modeResult.value,
          comparisonOperator: 'boolean_success',
          effectiveRange: rangeResult.value,
        }),
      );

    case 'counter': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'target', 'unit'])) {
        return invalidTracking('trackingDefinition', 'irrelevant_counter_field');
      }
      const numericOperatorResult = numericOperator(operatorResult.value);
      if (!numericOperatorResult.ok) {
        return numericOperatorResult;
      }
      const targetResult = positiveTarget(input.target, 'target');
      if (!targetResult.ok) {
        return targetResult;
      }
      if (targetResult.value.scale !== 0) {
        return invalidTracking('target.scale', 'counter_scale');
      }
      const unitResult = parseUnit(input.unit);
      if (!unitResult.ok) {
        return unitResult;
      }
      const counterUnitResult = counterUnit(unitResult.value);
      if (!counterUnitResult.ok) {
        return counterUnitResult;
      }
      return success(
        Object.freeze({
          trackingMode: 'counter',
          comparisonOperator: numericOperatorResult.value,
          target: targetResult.value as CounterTrackingDefinition['target'],
          unit: counterUnitResult.value,
          effectiveRange: rangeResult.value,
        } satisfies CounterTrackingDefinition),
      );
    }

    case 'quantity': {
      if (!hasOnlyKeys(input, [...BASE_KEYS, 'target', 'unit'])) {
        return invalidTracking('trackingDefinition', 'irrelevant_quantity_field');
      }
      const numericOperatorResult = numericOperator(operatorResult.value);
      if (!numericOperatorResult.ok) {
        return numericOperatorResult;
      }
      const targetResult = positiveTarget(input.target, 'target');
      if (!targetResult.ok) {
        return targetResult;
      }
      const unitResult = parseUnit(input.unit);
      if (!unitResult.ok) {
        return unitResult;
      }
      const quantityUnitResult = quantityUnit(unitResult.value);
      if (!quantityUnitResult.ok) {
        return quantityUnitResult;
      }
      return success(
        Object.freeze({
          trackingMode: 'quantity',
          comparisonOperator: numericOperatorResult.value,
          target: targetResult.value,
          unit: quantityUnitResult.value,
          effectiveRange: rangeResult.value,
        } satisfies QuantityTrackingDefinition),
      );
    }

    case 'duration': {
      if (
        !hasOnlyKeys(input, [
          ...BASE_KEYS,
          'targetDurationSeconds',
          'unit',
        ])
      ) {
        return invalidTracking('trackingDefinition', 'irrelevant_duration_field');
      }
      const numericOperatorResult = numericOperator(operatorResult.value);
      if (!numericOperatorResult.ok) {
        return numericOperatorResult;
      }
      if (
        !isSafeIntegerInRange(
          input.targetDurationSeconds,
          1,
          Number.MAX_SAFE_INTEGER,
        )
      ) {
        return invalidTracking(
          'targetDurationSeconds',
          'positive_whole_seconds',
        );
      }
      const unitResult = parseUnit(input.unit);
      if (!unitResult.ok) {
        return unitResult;
      }
      if (
        unitResult.value.unitType !== 'standard' ||
        unitResult.value.standardUnitCode !== 'second'
      ) {
        return invalidTracking('unit', 'duration_second_unit');
      }
      return success(
        Object.freeze({
          trackingMode: 'duration',
          comparisonOperator: numericOperatorResult.value,
          targetDurationSeconds: input.targetDurationSeconds,
          unit: Object.freeze({
            unitType: 'standard' as const,
            standardUnitCode: 'second' as const,
          }),
          effectiveRange: rangeResult.value,
        } satisfies DurationTrackingDefinition),
      );
    }

    default:
      return unreachableTrackingMode(modeResult.value);
  }
}

function positiveTarget(
  input: unknown,
  path: string,
): Result<ExactQuantity, PlannerDomainError> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['significand', 'scale'])) {
    return invalidTracking(path, 'exact_target_shape');
  }
  const quantityResult = createExactQuantity(
    { significand: input.significand, scale: input.scale },
    path,
  );
  if (!quantityResult.ok) {
    return quantityResult;
  }
  return validatePositiveExactQuantity(quantityResult.value, path);
}

function numericOperator(
  input: string,
): Result<NumericComparisonOperator, PlannerDomainError> {
  if (input === 'at_least' || input === 'at_most' || input === 'equal') {
    return success(input);
  }
  return invalidTracking('comparisonOperator', 'numeric_operator');
}

function parseUnit(input: unknown): Result<ParsedUnit, PlannerDomainError> {
  if (!isRecord(input)) {
    return invalidTracking('unit', 'unit_shape');
  }
  const typeResult = parseUnitType(input.unitType, 'unit.unitType');
  if (!typeResult.ok) {
    return typeResult;
  }

  switch (typeResult.value) {
    case 'none':
      if (!hasOnlyKeys(input, ['unitType'])) {
        return invalidTracking('unit', 'none_unit_fields');
      }
      return success(Object.freeze({ unitType: 'none' as const }));

    case 'standard': {
      if (!hasOnlyKeys(input, ['unitType', 'standardUnitCode'])) {
        return invalidTracking('unit', 'standard_unit_fields');
      }
      const codeResult = parseStandardUnitCode(
        input.standardUnitCode,
        'unit.standardUnitCode',
      );
      if (!codeResult.ok) {
        return codeResult;
      }
      return success(
        Object.freeze({
          unitType: 'standard' as const,
          standardUnitCode: codeResult.value,
        }),
      );
    }

    case 'custom': {
      if (!hasOnlyKeys(input, ['unitType', 'customUnitLabel'])) {
        return invalidTracking('unit', 'custom_unit_fields');
      }
      if (typeof input.customUnitLabel !== 'string') {
        return invalidTracking('unit.customUnitLabel', 'custom_label_type');
      }
      const label = input.customUnitLabel.trim();
      const characterCount = Array.from(label).length;
      if (
        characterCount < 1 ||
        characterCount > MAX_CUSTOM_UNIT_LABEL_LENGTH
      ) {
        return invalidTracking('unit.customUnitLabel', 'custom_label_length');
      }
      return success(
        Object.freeze({ unitType: 'custom' as const, customUnitLabel: label }),
      );
    }

    default:
      return unreachableUnitType(typeResult.value);
  }
}

function counterUnit(
  unit: ParsedUnit,
): Result<CounterTrackingDefinition['unit'], PlannerDomainError> {
  if (unit.unitType === 'none' || unit.unitType === 'custom') {
    return success(unit);
  }
  if ((COUNTER_STANDARD_UNIT_CODES as readonly StandardUnitCode[]).includes(unit.standardUnitCode)) {
    return success(
      unit as StandardUnit<CounterStandardUnitCode>,
    );
  }
  return invalidTracking('unit.standardUnitCode', 'counter_unit_dimension');
}

function quantityUnit(
  unit: ParsedUnit,
): Result<QuantityTrackingDefinition['unit'], PlannerDomainError> {
  if (unit.unitType === 'custom') {
    return success(unit);
  }
  if (unit.unitType === 'none') {
    return invalidTracking('unit', 'quantity_unit_required');
  }
  if ((QUANTITY_STANDARD_UNIT_CODES as readonly StandardUnitCode[]).includes(unit.standardUnitCode)) {
    return success(unit as StandardUnit<QuantityStandardUnitCode>);
  }
  return invalidTracking('unit.standardUnitCode', 'quantity_unit_dimension');
}

function invalidTracking(
  field: string,
  reason: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_tracking_definition',
      'The tracking definition contains an invalid or incompatible value.',
      { field, diagnostics: { reason } },
    ),
  );
}

function unreachableTrackingMode(
  trackingMode: never,
): Result<never, PlannerDomainError> {
  return invalidTracking('trackingMode', 'unreachable_discriminator');
}

function unreachableUnitType(unitType: never): Result<never, PlannerDomainError> {
  return invalidTracking('unit.unitType', 'unreachable_discriminator');
}
