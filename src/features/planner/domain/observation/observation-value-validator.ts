import {
  createExactQuantity,
} from '../exact-quantity/exact-quantity';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';
import type { TrackingDefinition } from '../tracking/tracking-definition';
import { parseObservationType } from '../values/stored-values';
import type { ObservationValue } from './observation';

const VALUE_KEYS = [
  'type',
  'booleanValue',
  'counterDelta',
  'quantity',
  'durationSeconds',
] as const;

export interface ObservationValueValidationOptions {
  readonly allowVoid: boolean;
}

export function validateObservationValue(
  input: unknown,
  tracking: TrackingDefinition,
  options: ObservationValueValidationOptions,
): Result<ObservationValue, PlannerDomainError> {
  const shapeResult = validateObservationValueShape(input, options);
  if (!shapeResult.ok) return shapeResult;
  const value = shapeResult.value;
  if (value.type === 'skipped' || value.type === 'void') return shapeResult;
  if (!trackingAcceptsType(tracking, value.type)) {
    return failure(
      createPlannerDomainError(
        'observation_type_mismatch',
        'The observation type does not match the applicable tracking definition.',
        { field: 'observationValue.type' },
      ),
    );
  }
  if (
    value.type === 'quantity' &&
    (tracking.trackingMode !== 'quantity' || value.quantity.scale !== tracking.target.scale)
  ) {
    return failure(
      createPlannerDomainError(
        'observation_quantity_scale_mismatch',
        'The quantity scale must match the applicable tracking version.',
        { field: 'observationValue.quantity.scale' },
      ),
    );
  }
  return shapeResult;
}

export function validateObservationValueShape(
  input: unknown,
  options: ObservationValueValidationOptions,
): Result<ObservationValue, PlannerDomainError> {
  if (!isRecord(input)) return invalidValue('Observation value must be an object.');
  const typeResult = parseObservationType(input.type, 'observationValue.type');
  if (!typeResult.ok) {
    return failure(
      createPlannerDomainError(
        'observation_invalid_value',
        'The observation type is unsupported.',
        { field: 'observationValue.type' },
      ),
    );
  }
  const type = typeResult.value;
  if (hasUnknownKeys(input)) {
    return invalidValue('The observation contains fields that do not belong to its value type.');
  }
  if (type === 'void') {
    if (!options.allowVoid || Object.keys(input).length !== 1) {
      return failure(
        createPlannerDomainError(
          'observation_invalid_correction',
          'Void is allowed only as a correction and contains no measured value.',
          { field: 'observationValue' },
        ),
      );
    }
    return success(Object.freeze({ type: 'void' }));
  }
  if (type === 'skipped') {
    if (Object.keys(input).length !== 1) {
      return invalidValue('Skipped observations contain no measured value.');
    }
    return success(Object.freeze({ type: 'skipped' }));
  }
  switch (type) {
    case 'checkbox':
    case 'avoidance':
      if (
        typeof input.booleanValue !== 'boolean' ||
        !hasExactlyKeys(input, ['type', 'booleanValue'])
      ) {
        return invalidValue('Boolean observations require exactly one boolean value.');
      }
      return success(Object.freeze({ type, booleanValue: input.booleanValue }));
    case 'counter':
      if (
        !isPositiveSafeInteger(input.counterDelta) ||
        !hasExactlyKeys(input, ['type', 'counterDelta'])
      ) {
        return invalidValue('Counter observations require one positive integer delta.');
      }
      return success(Object.freeze({ type, counterDelta: input.counterDelta }));
    case 'quantity': {
      if (!hasExactlyKeys(input, ['type', 'quantity']) || !isRecord(input.quantity)) {
        return invalidValue('Quantity observations require one exact quantity.');
      }
      const quantityResult = createExactQuantity(
        { significand: input.quantity.significand, scale: input.quantity.scale },
        'observationValue.quantity',
      );
      if (!quantityResult.ok || quantityResult.value.significand <= 0n) {
        return invalidValue('Quantity observations require one positive exact quantity.');
      }
      return success(Object.freeze({ type, quantity: quantityResult.value }));
    }
    case 'duration':
      if (
        !isPositiveSafeInteger(input.durationSeconds) ||
        !hasExactlyKeys(input, ['type', 'durationSeconds'])
      ) {
        return invalidValue('Duration observations require positive whole seconds.');
      }
      return success(Object.freeze({ type, durationSeconds: input.durationSeconds }));
    default:
      return unreachableValue(type);
  }
}

export function validateMappedObservationValue(
  type: ObservationValue['type'],
  columns: Readonly<{
    booleanValue: unknown;
    counterDelta: unknown;
    quantitySignificand: unknown;
    quantityScale: unknown;
    durationSeconds: unknown;
  }>,
): Result<ObservationValue, PlannerDomainError> {
  const allNull = (...values: readonly unknown[]) => values.every((value) => value === null);
  switch (type) {
    case 'checkbox':
    case 'avoidance':
      if (
        (columns.booleanValue !== 0 && columns.booleanValue !== 1) ||
        !allNull(columns.counterDelta, columns.quantitySignificand, columns.quantityScale, columns.durationSeconds)
      ) return invalidValue('Persisted boolean observation columns are malformed.');
      return success(Object.freeze({ type, booleanValue: columns.booleanValue === 1 }));
    case 'counter':
      if (
        !isPositiveSafeInteger(columns.counterDelta) ||
        !allNull(columns.booleanValue, columns.quantitySignificand, columns.quantityScale, columns.durationSeconds)
      ) return invalidValue('Persisted counter observation columns are malformed.');
      return success(Object.freeze({ type, counterDelta: columns.counterDelta }));
    case 'quantity': {
      if (!allNull(columns.booleanValue, columns.counterDelta, columns.durationSeconds)) {
        return invalidValue('Persisted quantity observation columns are malformed.');
      }
      const quantity = createExactQuantity({
        significand: columns.quantitySignificand,
        scale: columns.quantityScale,
      });
      if (!quantity.ok || quantity.value.significand <= 0n) {
        return invalidValue('Persisted quantity observation columns are malformed.');
      }
      return success(Object.freeze({ type, quantity: quantity.value }));
    }
    case 'duration':
      if (
        !isPositiveSafeInteger(columns.durationSeconds) ||
        !allNull(columns.booleanValue, columns.counterDelta, columns.quantitySignificand, columns.quantityScale)
      ) return invalidValue('Persisted duration observation columns are malformed.');
      return success(Object.freeze({ type, durationSeconds: columns.durationSeconds }));
    case 'skipped':
    case 'void':
      if (!allNull(columns.booleanValue, columns.counterDelta, columns.quantitySignificand, columns.quantityScale, columns.durationSeconds)) {
        return invalidValue('Persisted non-measured observation columns are malformed.');
      }
      return success(Object.freeze({ type }));
    default:
      return unreachableValue(type);
  }
}

function trackingAcceptsType(
  tracking: TrackingDefinition,
  type: Exclude<ObservationValue['type'], 'skipped' | 'void'>,
): boolean {
  return tracking.trackingMode === type;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnknownKeys(value: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(value).some((key) => !(VALUE_KEYS as readonly string[]).includes(key));
}

function hasExactlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function invalidValue(message: string): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError('observation_invalid_value', message, {
      field: 'observationValue',
    }),
  );
}

function unreachableValue(value: never): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'observation_data_integrity_failure',
      'The observation value discriminator is unsupported.',
      { diagnostics: { observationType: String(value) } },
    ),
  );
}
