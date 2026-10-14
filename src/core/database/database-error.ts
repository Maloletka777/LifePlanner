export const DATABASE_ERROR_CODES = {
  OPEN_OR_CONFIGURATION: 'open_or_configuration',
  MIGRATION: 'migration',
  UNSUPPORTED_SCHEMA_VERSION: 'unsupported_schema_version',
  INITIALIZATION: 'initialization',
} as const;

export type DatabaseErrorCode =
  (typeof DATABASE_ERROR_CODES)[keyof typeof DATABASE_ERROR_CODES];

const DATABASE_USER_MESSAGES: Readonly<Record<DatabaseErrorCode, string>> = {
  [DATABASE_ERROR_CODES.OPEN_OR_CONFIGURATION]:
    'LifePlanner could not open or configure its local data.',
  [DATABASE_ERROR_CODES.MIGRATION]:
    'LifePlanner could not prepare the local data structure.',
  [DATABASE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]:
    'This local data was created by a newer version of LifePlanner.',
  [DATABASE_ERROR_CODES.INITIALIZATION]:
    'LifePlanner could not finish preparing its local data.',
};

export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;
  readonly userMessage: string;
  readonly cause: unknown;

  constructor(code: DatabaseErrorCode, internalMessage: string, cause?: unknown) {
    super(internalMessage);
    this.name = 'DatabaseError';
    this.code = code;
    this.userMessage = DATABASE_USER_MESSAGES[code];
    this.cause = cause;
  }
}

export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}
