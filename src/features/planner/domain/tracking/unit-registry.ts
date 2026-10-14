import {
  createExactQuantity,
  MAX_EXACT_QUANTITY_SCALE,
  type ExactQuantity,
} from '../exact-quantity/exact-quantity';
import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';

export const STANDARD_UNIT_DEFINITIONS = Object.freeze({
  millilitre: Object.freeze({ dimension: 'volume', canonicalLabel: 'millilitre', pluralLabel: 'millilitres', symbol: 'ml', baseFactor: 1n }),
  litre: Object.freeze({ dimension: 'volume', canonicalLabel: 'litre', pluralLabel: 'litres', symbol: 'L', baseFactor: 1_000n }),
  gram: Object.freeze({ dimension: 'mass', canonicalLabel: 'gram', pluralLabel: 'grams', symbol: 'g', baseFactor: 1n }),
  kilogram: Object.freeze({ dimension: 'mass', canonicalLabel: 'kilogram', pluralLabel: 'kilograms', symbol: 'kg', baseFactor: 1_000n }),
  metre: Object.freeze({ dimension: 'distance', canonicalLabel: 'metre', pluralLabel: 'metres', symbol: 'm', baseFactor: 1n }),
  kilometre: Object.freeze({ dimension: 'distance', canonicalLabel: 'kilometre', pluralLabel: 'kilometres', symbol: 'km', baseFactor: 1_000n }),
  repetition: Object.freeze({ dimension: 'count', canonicalLabel: 'repetition', pluralLabel: 'repetitions', symbol: 'reps', baseFactor: null }),
  page: Object.freeze({ dimension: 'count', canonicalLabel: 'page', pluralLabel: 'pages', symbol: 'pages', baseFactor: null }),
  serving: Object.freeze({ dimension: 'count', canonicalLabel: 'serving', pluralLabel: 'servings', symbol: 'servings', baseFactor: null }),
  session: Object.freeze({ dimension: 'count', canonicalLabel: 'session', pluralLabel: 'sessions', symbol: 'sessions', baseFactor: null }),
  second: Object.freeze({ dimension: 'duration', canonicalLabel: 'second', pluralLabel: 'seconds', symbol: 's', baseFactor: 1n }),
  minute: Object.freeze({ dimension: 'duration', canonicalLabel: 'minute', pluralLabel: 'minutes', symbol: 'min', baseFactor: 60n }),
  hour: Object.freeze({ dimension: 'duration', canonicalLabel: 'hour', pluralLabel: 'hours', symbol: 'hr', baseFactor: 3_600n }),
} as const);

export type StandardUnitCode = keyof typeof STANDARD_UNIT_DEFINITIONS;
export type CounterStandardUnitCode = Extract<
  StandardUnitCode,
  'repetition' | 'page' | 'serving' | 'session'
>;
export type QuantityStandardUnitCode = Extract<
  StandardUnitCode,
  'millilitre' | 'litre' | 'gram' | 'kilogram' | 'metre' | 'kilometre'
>;

export type DurationStandardUnitCode = Extract<
  StandardUnitCode,
  'second' | 'minute' | 'hour'
>;

export const COUNTER_STANDARD_UNIT_CODES = Object.freeze([
  'repetition',
  'page',
  'serving',
  'session',
] as const satisfies readonly CounterStandardUnitCode[]);

export const QUANTITY_STANDARD_UNIT_CODES = Object.freeze([
  'millilitre',
  'litre',
  'gram',
  'kilogram',
  'metre',
  'kilometre',
] as const satisfies readonly QuantityStandardUnitCode[]);

export const DURATION_STANDARD_UNIT_CODES = Object.freeze([
  'second',
  'minute',
  'hour',
] as const satisfies readonly DurationStandardUnitCode[]);

export function standardUnitLabel(
  code: StandardUnitCode,
  form: 'singular' | 'plural' | 'symbol' = 'plural',
): string {
  const definition = STANDARD_UNIT_DEFINITIONS[code];
  if (form === 'singular') return definition.canonicalLabel;
  if (form === 'symbol') return definition.symbol;
  return definition.pluralLabel;
}

/**
 * Converts only between explicitly compatible standard units. Count-like
 * meanings are intentionally not interchangeable. A conversion that cannot be
 * represented exactly within the canonical six-decimal limit is rejected.
 */
export function convertExactStandardUnit(
  quantity: ExactQuantity,
  from: StandardUnitCode,
  to: StandardUnitCode,
  path = 'quantity',
): Result<ExactQuantity, PlannerDomainError> {
  if (from === to) return success(quantity);

  const source = STANDARD_UNIT_DEFINITIONS[from];
  const target = STANDARD_UNIT_DEFINITIONS[to];
  if (
    source.dimension !== target.dimension ||
    source.baseFactor === null ||
    target.baseFactor === null
  ) {
    return failure(
      createPlannerDomainError(
        'invalid_tracking_definition',
        'Planner units can be converted only within the same compatible measurement dimension.',
        {
          path,
          diagnostics: { fromUnit: from, toUnit: to },
        },
      ),
    );
  }

  const numerator = quantity.significand * source.baseFactor;
  const sourceScaleDivisor = 10n ** BigInt(quantity.scale);
  const denominator = target.baseFactor * sourceScaleDivisor;
  for (let outputScale = 0; outputScale <= MAX_EXACT_QUANTITY_SCALE; outputScale += 1) {
    const scaledNumerator = numerator * 10n ** BigInt(outputScale);
    if (scaledNumerator % denominator !== 0n) continue;
    return createExactQuantity(
      {
        significand: scaledNumerator / denominator,
        scale: outputScale,
      },
      path,
    );
  }

  return failure(
    createPlannerDomainError(
      'exact_quantity_precision_exceeded',
      'The exact unit conversion needs more than six decimal places.',
      {
        path,
        diagnostics: {
          fromUnit: from,
          toUnit: to,
          maximumScale: MAX_EXACT_QUANTITY_SCALE,
        },
      },
    ),
  );
}

export function parseStandardUnitCode(
  input: unknown,
  field = 'standardUnitCode',
): Result<StandardUnitCode, PlannerDomainError> {
  if (
    typeof input === 'string' &&
    Object.prototype.hasOwnProperty.call(STANDARD_UNIT_DEFINITIONS, input)
  ) {
    return success(input as StandardUnitCode);
  }
  return failure(
    createPlannerDomainError(
      'unsupported_stored_value',
      'Unsupported Planner standard unit code.',
      {
        field,
        diagnostics: {
          storedValueKind: 'standard unit code',
          acceptedValueCount: Object.keys(STANDARD_UNIT_DEFINITIONS).length,
        },
      },
    ),
  );
}
