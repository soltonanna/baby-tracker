import rateLimit, { MemoryStore, type RateLimitRequestHandler } from 'express-rate-limit';
import { HttpError } from '../lib/httpError.js';

/**
 * Brute-force protection for the auth routes (decision D20).
 *
 * The default store is per-process, which is correct for a single instance. If
 * the API is ever run as more than one process, swap the store rather than
 * rewriting the logic. Behind a proxy the app needs `trust proxy` set, or every
 * request looks like it comes from the proxy — a deployment concern (D16).
 */
const stores: MemoryStore[] = [];

function createLimiter(windowMs: number, limit: number): RateLimitRequestHandler {
  const store = new MemoryStore();
  stores.push(store);

  return rateLimit({
    windowMs,
    limit,
    store,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Route the rejection through our error middleware so the response body is
    // the same envelope as every other error.
    handler: (_req, _res, next) => {
      next(new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please try again later.'));
    },
  });
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

export const loginLimiter = createLimiter(FIFTEEN_MINUTES, 10);
export const registerLimiter = createLimiter(ONE_HOUR, 5);
export const refreshLimiter = createLimiter(FIFTEEN_MINUTES, 60);

/** Test helper: clears every counter so one test's attempts cannot fail the next. */
export function resetAuthRateLimits(): void {
  for (const store of stores) {
    store.resetAll();
  }
}
