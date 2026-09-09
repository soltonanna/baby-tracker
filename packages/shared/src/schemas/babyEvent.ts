import { z, type ZodType } from 'zod';
import { BABY_EVENT_TYPES, DIAPER_KINDS, type BabyEventType } from '../constants.js';

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

/**
 * What an edit may change.
 *
 * Derived from the create schema rather than restated, so every rule — the
 * non-negative amount, the 1000-character note, the date coercion — has exactly
 * one definition and an edit can never be checked more loosely than the create
 * that produced the event.
 *
 * Two fields are deliberately not editable:
 *
 *  - `groupId` is omitted. It links the two documents of one twin action: an
 *    identity, not a value a parent types. Re-pointing it would silently move an
 *    event between groups, and "change both" is its own opt-in endpoint
 *    (ARCHITECTURE_PROPOSAL.md §5.5).
 *  - `familyId` and `babyId` were never in the body at all. Unknown keys are
 *    stripped, so sending them is not an error — it simply changes nothing.
 *
 * `type` stays accepted, because an edit form naturally sends the event back
 * whole, but the service requires it to equal the stored type: what an event
 * *is* is not editable here.
 *
 * At least one real field must be present. A patch that would change nothing is
 * a client mistake, and answering 200 to it would hide that.
 */
export const updateBabyEventSchema = createBabyEventSchema
  .omit({ groupId: true })
  .partial()
  .refine((patch) => Object.keys(patch).some((field) => field !== 'type'), {
    message: 'An update must change at least one field',
  });

/**
 * The canonical nappy vocabulary, as stored. DIAPER carries its kind in the
 * generic `details` field (see `docs`/project memory on the event data shape),
 * so this is the one place that says which strings are meaningful there.
 */
export const diaperDetailsSchema = z.enum(DIAPER_KINDS);

const diaperFieldsSchema = z.object({ details: diaperDetailsSchema.optional() });
const noTypeSpecificFields = z.object({});

/**
 * The rules a flat schema cannot express, because they depend on which kind of
 * event this is.
 *
 * Kept separate from `updateBabyEventSchema` on purpose: the type they apply to
 * is the *stored* one, which only the server knows, so this is parsed after the
 * event has been loaded rather than in request validation.
 */
export function babyEventFieldsSchemaFor(type: BabyEventType): ZodType {
  return type === 'DIAPER' ? diaperFieldsSchema : noTypeSpecificFields;
}

/** The one query parameter the list endpoint takes: how many recent events. */
export const listBabyEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateBabyEventInput = z.infer<typeof createBabyEventSchema>;
export type UpdateBabyEventInput = z.infer<typeof updateBabyEventSchema>;
export type ListBabyEventsQuery = z.infer<typeof listBabyEventsQuerySchema>;
