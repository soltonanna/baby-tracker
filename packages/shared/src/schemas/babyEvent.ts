import { z } from 'zod';
import { BABY_EVENT_TYPES } from '../constants.js';

/**
 * Tracker event input schemas.
 *
 * Deliberately not type-specific: FEEDING does not require an amount, SLEEP
 * does not require an end, DIAPER has no fixed vocabulary. The shape of each
 * event is a product question the UI has not answered yet, and guessing now
 * would mean rejecting entries a parent legitimately wants to make.
 */

/** Enough for a note a tired parent types one-handed, not enough to be abused. */
export const eventDetailsSchema = z.string().trim().max(1000);

/** `ml`, `oz`, `g`… a label, not a unit system. Conversion comes later. */
export const eventUnitSchema = z.string().trim().min(1).max(16);

/**
 * Links events created by one action — the twins' two documents share one.
 * Not an authorization field: it groups, it does not grant.
 */
export const eventGroupIdSchema = z.string().trim().min(1).max(64);

export const createBabyEventSchema = z.object({
  type: z.enum(BABY_EVENT_TYPES),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  // `z.number()` already rejects NaN and Infinity, so this is the whole of
  // "finite and non-negative".
  amount: z.number().nonnegative().optional(),
  unit: eventUnitSchema.optional(),
  details: eventDetailsSchema.optional(),
  groupId: eventGroupIdSchema.optional(),
});

/** The one query parameter the list endpoint takes: how many recent events. */
export const listBabyEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateBabyEventInput = z.infer<typeof createBabyEventSchema>;
export type ListBabyEventsQuery = z.infer<typeof listBabyEventsQuerySchema>;
