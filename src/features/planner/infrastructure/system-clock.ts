import type { Clock } from '../application';

export const systemClock: Clock = Object.freeze({
  nowEpochMilliseconds: Date.now,
});
