import { createPlannerDomainError, type PlannerDomainError } from '../errors/planner-domain-error';
import { failure, success, type Result } from '../result';

export const MIN_EXACT_QUANTITY_SCALE = 0;
export const MAX_EXACT_QUANTITY_SCALE = 6;
export const SQLITE_SIGNED_64_MIN = -(2n ** 63n);
export const SQLITE_SIGNED_64_MAX = 2n ** 63n - 1n;
export const JAVASCRIPT_SAFE_INTEGER_MIN = BigInt(Number.MIN_SAFE_INTEGER);
export const JAVASCRIPT_SAFE_INTEGER_MAX = BigInt(Number.MAX_SAFE_INTEGER);

declare const exactQuantityScaleBrand: unique symbol;
export type ExactQuantityScale = number & {
  readonly [exactQuantityScaleBrand]: true;
};

export interface ExactQuantity {
  readonly significand: bigint;
  readonly scale: ExactQuantityScale;
}

export interface ExactQuantityInput {
  readonly significand: unknown;
  readonly scale: unknown;
}

export interface ExactQuantityFormatOptions {
  readonly fixedScale?: boolean;
}

export function createExactQuantity(
  input: ExactQuantityInput,
  path = 'exactQuantity',
): Result<ExactQuantity, PlannerDomainError> {
  const scaleResult = parseScale(input.scale, path);
  if (!scaleResult.ok) {
    return scaleResult;
  }

  const significandResult = parseSignificand(input.significand, path);
  if (!significandResult.ok) {
    return significandResult;
  }

  return boundedQuantity(significandResult.value, scaleResult.value, path);
}

export function parseExactQuantity(
  input: unknown,
  path = 'exactQuantity',
): Result<ExactQuantity, PlannerDomainError> {
  if (typeof input !== 'string' || input !== input.trim()) {
    return invalidQuantity(path, 'decimal_format');
  }

  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(input);
  if (match === null) {
    return invalidQuantity(path, 'decimal_format');
  }

  const fraction = match[3] ?? '';
  if (fraction.length > MAX_EXACT_QUANTITY_SCALE) {
    return failure(
      createPlannerDomainError(
        'exact_quantity_precision_exceeded',
        'Planner quantities support at most six decimal places.',
        {
          path,
          diagnostics: {
            requestedScale: fraction.length,
            maximumScale: MAX_EXACT_QUANTITY_SCALE,
          },
        },
      ),
    );
  }

  const magnitudeText = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, '');
  let significand = BigInt(magnitudeText);
  if (match[1] === '-' && significand !== 0n) {
    significand = -significand;
  }

  return boundedQuantity(
    significand,
    fraction.length as ExactQuantityScale,
    path,
  );
}

export function normalizeExactQuantity(
  quantity: ExactQuantity,
  requestedScale: number,
  path = 'exactQuantity',
): Result<ExactQuantity, PlannerDomainError> {
  const scaleResult = parseScale(requestedScale, path);
  if (!scaleResult.ok) {
    return scaleResult;
  }

  if (scaleResult.value === quantity.scale) {
    return success(quantity);
  }

  if (scaleResult.value > quantity.scale) {
    const factor = powerOfTen(scaleResult.value - quantity.scale);
    return boundedQuantity(
      quantity.significand * factor,
      scaleResult.value,
      path,
    );
  }

  const divisor = powerOfTen(quantity.scale - scaleResult.value);
  if (quantity.significand % divisor !== 0n) {
    return failure(
      createPlannerDomainError(
        'exact_quantity_precision_exceeded',
        'The quantity cannot be normalized to the requested scale without losing precision.',
        {
          path,
          diagnostics: {
            sourceScale: quantity.scale,
            requestedScale: scaleResult.value,
          },
        },
      ),
    );
  }

  return boundedQuantity(
    quantity.significand / divisor,
    scaleResult.value,
    path,
  );
}

export function addExactQuantities(
  left: ExactQuantity,
  right: ExactQuantity,
  path = 'exactQuantity',
): Result<ExactQuantity, PlannerDomainError> {
  const scale = Math.max(left.scale, right.scale) as ExactQuantityScale;
  const significand =
    scaleForCalculation(left, scale) + scaleForCalculation(right, scale);
  return boundedQuantity(significand, scale, path);
}

export function subtractExactQuantities(
  left: ExactQuantity,
  right: ExactQuantity,
  path = 'exactQuantity',
): Result<ExactQuantity, PlannerDomainError> {
  const scale = Math.max(left.scale, right.scale) as ExactQuantityScale;
  const significand =
    scaleForCalculation(left, scale) - scaleForCalculation(right, scale);
  return boundedQuantity(significand, scale, path);
}

export function compareExactQuantities(
  left: ExactQuantity,
  right: ExactQuantity,
): -1 | 0 | 1 {
  const scale = Math.max(left.scale, right.scale) as ExactQuantityScale;
  const leftSignificand = scaleForCalculation(left, scale);
  const rightSignificand = scaleForCalculation(right, scale);
  if (leftSignificand < rightSignificand) {
    return -1;
  }
  if (leftSignificand > rightSignificand) {
    return 1;
  }
  return 0;
}

export function exactQuantitiesEqual(
  left: ExactQuantity,
  right: ExactQuantity,
): boolean {
  return compareExactQuantities(left, right) === 0;
}

export function validatePositiveExactQuantity(
  quantity: ExactQuantity,
  path = 'target',
): Result<ExactQuantity, PlannerDomainError> {
  if (quantity.significand <= 0n) {
    return failure(
      createPlannerDomainError(
        'invalid_exact_quantity',
        'The exact quantity target must be greater than zero.',
        { path, diagnostics: { reason: 'non_positive_target' } },
      ),
    );
  }
  return success(quantity);
}

export function formatExactQuantity(
  quantity: ExactQuantity,
  options: ExactQuantityFormatOptions = {},
): string {
  const negative = quantity.significand < 0n;
  const magnitude = (negative ? -quantity.significand : quantity.significand)
    .toString()
    .padStart(quantity.scale + 1, '0');

  if (quantity.scale === 0) {
    return `${negative ? '-' : ''}${magnitude}`;
  }

  const whole = magnitude.slice(0, -quantity.scale);
  const fixedFraction = magnitude.slice(-quantity.scale);
  const fraction = options.fixedScale
    ? fixedFraction
    : fixedFraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction.length > 0 ? `.${fraction}` : ''}`;
}

export function exactQuantitySignificandForPersistence(
  quantity: ExactQuantity,
): number {
  return Number(quantity.significand);
}

function parseScale(
  input: unknown,
  path: string,
): Result<ExactQuantityScale, PlannerDomainError> {
  if (
    typeof input !== 'number' ||
    !Number.isInteger(input) ||
    input < MIN_EXACT_QUANTITY_SCALE ||
    input > MAX_EXACT_QUANTITY_SCALE
  ) {
    return invalidQuantity(path, 'scale');
  }
  return success(input as ExactQuantityScale);
}

function parseSignificand(
  input: unknown,
  path: string,
): Result<bigint, PlannerDomainError> {
  if (typeof input === 'bigint') {
    return success(input);
  }
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) {
      return invalidQuantity(path, 'significand_integer');
    }
    if (!Number.isSafeInteger(input)) {
      return overflow(path, 'javascript_safe_integer');
    }
    return success(BigInt(input));
  }
  return invalidQuantity(path, 'significand_type');
}

function boundedQuantity(
  significand: bigint,
  scale: ExactQuantityScale,
  path: string,
): Result<ExactQuantity, PlannerDomainError> {
  if (significand < SQLITE_SIGNED_64_MIN || significand > SQLITE_SIGNED_64_MAX) {
    return overflow(path, 'sqlite_signed_64');
  }
  if (
    significand < JAVASCRIPT_SAFE_INTEGER_MIN ||
    significand > JAVASCRIPT_SAFE_INTEGER_MAX
  ) {
    return overflow(path, 'javascript_safe_integer');
  }
  return success(Object.freeze({ significand, scale }));
}

function scaleForCalculation(
  quantity: ExactQuantity,
  targetScale: ExactQuantityScale,
): bigint {
  return quantity.significand * powerOfTen(targetScale - quantity.scale);
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function invalidQuantity(
  path: string,
  reason: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'invalid_exact_quantity',
      'Enter an exact Planner quantity using an integer significand and scale from zero through six.',
      { path, diagnostics: { reason } },
    ),
  );
}

function overflow(
  path: string,
  limit: string,
): Result<never, PlannerDomainError> {
  return failure(
    createPlannerDomainError(
      'exact_quantity_overflow',
      'The exact quantity is outside the supported persistence range.',
      { path, diagnostics: { limit } },
    ),
  );
}
