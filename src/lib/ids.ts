import { createHash, randomBytes, randomUUID } from 'node:crypto';

// n random bytes → 4n/3 URL-safe chars (no padding when n % 3 === 0)
const token = (bytes: number) => randomBytes(bytes).toString('base64url');

export const newPaymentId = () => token(18); // 24 chars
export const newStoreId = () => randomUUID(); // UUID v4, hex with dashes
export const newApiKey = () => `ck_live_${token(24)}`; // 32 chars after prefix
export const newWebhookSecret = () => `whsec_${token(24)}`;
export const newEventId = () => randomUUID();

export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const keyPrefix = (key: string) => key.slice(0, 16);
