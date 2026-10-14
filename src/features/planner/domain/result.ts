export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Failure<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Success<T> | Failure<E>;

export function success<T>(value: T): Success<T> {
  return Object.freeze({ ok: true as const, value });
}

export function failure<E>(error: E): Failure<E> {
  return Object.freeze({ ok: false as const, error });
}
