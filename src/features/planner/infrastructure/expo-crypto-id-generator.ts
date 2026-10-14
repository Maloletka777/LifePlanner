import { randomUUID } from 'expo-crypto';

import type { IdGenerator } from '../application';

export const expoCryptoIdGenerator: IdGenerator = Object.freeze({
  generateId: randomUUID,
});
