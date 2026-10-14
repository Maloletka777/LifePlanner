export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export function hasOnlyKeys(
  input: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(input).every((key) => allowedKeys.includes(key));
}

export function isSafeIntegerInRange(
  input: unknown,
  minimum: number,
  maximum: number,
): input is number {
  return (
    typeof input === 'number' &&
    Number.isSafeInteger(input) &&
    input >= minimum &&
    input <= maximum
  );
}
